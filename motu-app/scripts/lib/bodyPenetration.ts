/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';

/**
 * IS ANY PART OF THE CHARACTER INSIDE THE FURNITURE? — measured on the meshes, not on boxes.
 *
 * Every other interaction check in the project works on a piece's BOUNDING BOX, which can say
 * "the anchor is over the sofa" but cannot say "the shin is inside the sofa's front panel": the
 * box of a sofa is solid from the floor to the top of the backrest, and a leg hanging in front of
 * the cushion is inside that box whether or not it touches the cushion. So a box check can only
 * ever be loose (and let the clipping through) or tight (and fail every correct seat).
 *
 * The furniture in this game is built from primitives — boxes, cylinders, cones, spheres,
 * capsules, tori — so "is this point inside the piece" has an exact answer: carry the point into
 * each primitive's own space and ask the primitive. That is what this module does, and it is the
 * whole of it. It takes two scene graphs (a posed character and a placed piece), so the same test
 * runs in the browser harness against the real rendered meshes and in `npm run audit:interactions`
 * against the same scene graph built without a renderer.
 *
 * What it does NOT try to be is a physics engine: it samples the character's own vertices (or
 * any points the caller hands it) and reports how deep the deepest one is. That is the number a
 * player sees — a vertex 3 cm inside a plank is a foot through a swing.
 */

export interface PenetrationHit {
  /** Which part of the character it is — the nearest named ancestor (a rig joint), or 'body'. */
  part: string;
  /** World-space depth of the deepest sample of that part inside any solid, world units. */
  depth: number;
  /** Samples of that part inside a solid. */
  count: number;
  /** The furniture mesh it was deepest inside, as a short description. */
  solid: string;
  /** Where that deepest sample was, world space. */
  at: [number, number, number];
}

export interface PenetrationReport {
  hits: PenetrationHit[];
  /** The deepest of all of them, 0 when nothing is inside anything. */
  maxDepth: number;
  /** Solid geometry types this module could not test (and so skipped). */
  unknown: string[];
}

/** A furniture primitive, ready to be asked "how far inside you is this point". */
interface Solid {
  mesh: THREE.Mesh;
  inverse: THREE.Matrix4;
  /** Local → world length factor (the largest axis scale), to report depth in world units. */
  worldScale: number;
  box: THREE.Box3;
  label: string;
}

/**
 * The same rule the shipping collider applies (lib/furniturePlacement.ts's `isSolidGeometry`) and
 * the React-tree measurement mirrors: a mesh that does not write depth, is additively blended or is
 * flagged `noCollide` is light, not matter — a flame, a sparkle, water. A body passing through a
 * flame is not clipping.
 */
function isSolidMesh(mesh: THREE.Mesh): boolean {
  if (!mesh.visible) return false;
  if (mesh.userData?.noCollide) return false;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return mats.some((m) => m && (m as THREE.Material).depthWrite !== false
    && (m as THREE.Material).blending !== THREE.AdditiveBlending);
}

function isVisibleInTree(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}

/** A piece's solid primitives, collected once and reusable across many poses. */
export interface SolidSet {
  solids: Solid[];
  unknown: string[];
}

export function solidsOf(piece: THREE.Object3D): SolidSet {
  const { solids, unknown } = collectSolids(piece);
  return { solids, unknown: [...unknown] };
}

function collectSolids(piece: THREE.Object3D): { solids: Solid[]; unknown: Set<string> } {
  const solids: Solid[] = [];
  const unknown = new Set<string>();
  piece.updateWorldMatrix(true, true);
  piece.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!(mesh as any).isMesh || !mesh.geometry || !isVisibleInTree(mesh) || !isSolidMesh(mesh)) return;
    const type = mesh.geometry.type;
    if (!(type in DEPTH)) {
      // Flat sheets (planes, circles, rings) have no inside; everything else unknown is reported.
      if (!/Plane|Circle|Ring|Shape|Edges|Line/.test(type)) unknown.add(type);
      return;
    }
    const e = mesh.matrixWorld.elements;
    const sx = Math.hypot(e[0], e[1], e[2]);
    const sy = Math.hypot(e[4], e[5], e[6]);
    const sz = Math.hypot(e[8], e[9], e[10]);
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    solids.push({
      mesh,
      inverse: new THREE.Matrix4().copy(mesh.matrixWorld).invert(),
      worldScale: Math.min(sx, sy, sz),
      box: mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld),
      label: `${type.replace('Geometry', '')}${mesh.name ? ` "${mesh.name}"` : ''} @ (${
        [mesh.position.x, mesh.position.y, mesh.position.z].map((v) => v.toFixed(2)).join(', ')})`,
    });
  });
  return { solids, unknown };
}

/**
 * Depth of a LOCAL-space point inside one primitive, in the primitive's local units — positive
 * inside, zero or negative outside. Exact for the shapes the models use; the polygonal cylinders
 * are treated as the circles they approximate, which over-reports by a hair at the facets and is
 * the conservative direction for a check whose job is to find clipping.
 */
const DEPTH: Record<string, (p: THREE.Vector3, g: any) => number> = {
  BoxGeometry: (p, g) => {
    const { width = 1, height = 1, depth = 1 } = g.parameters;
    return Math.min(width / 2 - Math.abs(p.x), height / 2 - Math.abs(p.y), depth / 2 - Math.abs(p.z));
  },
  CylinderGeometry: (p, g) => {
    const { radiusTop = 1, radiusBottom = 1, height = 1, thetaLength = Math.PI * 2 } = g.parameters;
    if (thetaLength < Math.PI * 2 - 1e-3) return partialCylinder(p, g.parameters);
    const t = (p.y + height / 2) / height;
    const r = radiusBottom + (radiusTop - radiusBottom) * Math.min(1, Math.max(0, t));
    return Math.min(height / 2 - Math.abs(p.y), r - Math.hypot(p.x, p.z));
  },
  ConeGeometry: (p, g) => {
    const { radius = 1, height = 1 } = g.parameters;
    const t = (p.y + height / 2) / height;
    const r = radius * (1 - Math.min(1, Math.max(0, t)));
    return Math.min(height / 2 - Math.abs(p.y), r - Math.hypot(p.x, p.z));
  },
  SphereGeometry: (p, g) => {
    const { radius = 1, thetaStart = 0, thetaLength = Math.PI, phiLength = Math.PI * 2 } = g.parameters;
    const d = radius - p.length();
    if (d <= 0) return d;
    // A partial sphere (a dome, a bowl) is a shell cut by a plane; only the full-ish ones are solid
    // in any useful sense. A hemisphere is solid on its own side of the cut.
    if (phiLength < Math.PI * 2 - 1e-3) return -1;
    const theta = Math.acos(Math.max(-1, Math.min(1, p.y / Math.max(1e-9, p.length()))));
    if (theta < thetaStart - 1e-6 || theta > thetaStart + thetaLength + 1e-6) return -1;
    return d;
  },
  CapsuleGeometry: (p, g) => {
    const radius = g.parameters.radius ?? 1;
    const len = g.parameters.height ?? g.parameters.length ?? 1;
    const y = Math.max(-len / 2, Math.min(len / 2, p.y));
    return radius - Math.hypot(p.x, p.y - y, p.z);
  },
  TorusGeometry: (p, g) => {
    const { radius = 1, tube = 0.4, arc = Math.PI * 2 } = g.parameters;
    if (arc < Math.PI * 2 - 1e-3) {
      let a = Math.atan2(p.y, p.x);
      if (a < 0) a += Math.PI * 2;
      if (a > arc) return -1;
    }
    const q = Math.hypot(p.x, p.y) - radius;
    return tube - Math.hypot(q, p.z);
  },
  DodecahedronGeometry: (p, g) => (g.parameters.radius ?? 1) * 0.79 - p.length(),
  IcosahedronGeometry: (p, g) => (g.parameters.radius ?? 1) * 0.79 - p.length(),
  OctahedronGeometry: (p, g) => (g.parameters.radius ?? 1) * 0.57 - p.length(),
  TetrahedronGeometry: (p, g) => (g.parameters.radius ?? 1) * 0.33 - p.length(),
};

function partialCylinder(p: THREE.Vector3, params: any): number {
  const { radiusTop = 1, radiusBottom = 1, height = 1, thetaStart = 0, thetaLength = Math.PI * 2 } = params;
  // three.js measures theta from +Z toward +X.
  let a = Math.atan2(p.x, p.z) - thetaStart;
  while (a < 0) a += Math.PI * 2;
  if (a > thetaLength) return -1;
  const t = (p.y + height / 2) / height;
  const r = radiusBottom + (radiusTop - radiusBottom) * Math.min(1, Math.max(0, t));
  return Math.min(height / 2 - Math.abs(p.y), r - Math.hypot(p.x, p.z));
}

/** One sample of the body: a world-space point and the part it belongs to. */
export interface BodySample {
  p: THREE.Vector3;
  part: string;
}

/**
 * The same measurement on POINTS rather than on a mesh's vertices — for a body described by
 * volumes (constants/characterRig.ts's `BodyVolumes`) that the caller samples as densely as it
 * likes. A mesh's vertices are as far apart as its tessellation, which on a 0.5-unit skull is
 * further than the clipping this is looking for.
 */
export function measurePointPenetration(
  samples: readonly BodySample[],
  set: SolidSet,
  tolerance = 0.005,
): PenetrationReport {
  const byPart = new Map<string, PenetrationHit>();
  const local = new THREE.Vector3();
  for (const { p, part } of samples) {
    for (const s of set.solids) {
      if (!s.box.containsPoint(p)) continue;
      local.copy(p).applyMatrix4(s.inverse);
      const d = DEPTH[s.mesh.geometry.type](local, s.mesh.geometry) * s.worldScale;
      if (d <= tolerance) continue;
      const hit = byPart.get(part);
      if (!hit) byPart.set(part, { part, depth: d, count: 1, solid: s.label, at: [p.x, p.y, p.z] });
      else {
        hit.count++;
        if (d > hit.depth) { hit.depth = d; hit.solid = s.label; hit.at = [p.x, p.y, p.z]; }
      }
    }
  }
  const hits = [...byPart.values()].sort((a, b) => b.depth - a.depth);
  return { hits, maxDepth: hits[0]?.depth ?? 0, unknown: set.unknown };
}

/** The label a character sample is reported under: its nearest ancestor with a joint name. */
function partOf(o: THREE.Object3D, names: Map<THREE.Object3D, string>): string {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    const label = names.get(n);
    if (label) return label;
  }
  return 'body';
}

/**
 * How deep the posed character is inside the placed piece.
 *
 * `joints` names the character's joint groups (the rig refs) so a hit can be reported as
 * "leftLeg 4 cm inside the seat" rather than as a vertex index. Both trees must already have
 * their world matrices current — the caller poses them, this only measures.
 *
 * `tolerance` (world units) is how deep a sample may be before it counts: a vertex a millimetre
 * into a cushion is contact, not clipping, and reporting it would bury the real hits in noise.
 */
export function measurePenetration(
  character: THREE.Object3D,
  piece: THREE.Object3D,
  joints: Map<THREE.Object3D, string>,
  tolerance = 0.005,
): PenetrationReport {
  const { solids, unknown } = collectSolids(piece);
  character.updateWorldMatrix(true, true);
  const byPart = new Map<string, PenetrationHit>();
  const world = new THREE.Vector3();
  const local = new THREE.Vector3();
  const charBox = new THREE.Box3().setFromObject(character);
  const live = solids.filter((s) => s.box.intersectsBox(charBox));

  character.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!(mesh as any).isMesh || !mesh.geometry?.attributes?.position || !isVisibleInTree(mesh)) return;
    if (!isSolidMesh(mesh)) return;
    const pos = mesh.geometry.attributes.position;
    const part = partOf(mesh, joints);
    for (let i = 0; i < pos.count; i++) {
      world.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      for (const s of live) {
        if (!s.box.containsPoint(world)) continue;
        local.copy(world).applyMatrix4(s.inverse);
        const d = DEPTH[s.mesh.geometry.type](local, s.mesh.geometry) * s.worldScale;
        if (d <= tolerance) continue;
        const hit = byPart.get(part);
        if (!hit) {
          byPart.set(part, { part, depth: d, count: 1, solid: s.label, at: [world.x, world.y, world.z] });
        } else {
          hit.count++;
          if (d > hit.depth) {
            hit.depth = d;
            hit.solid = s.label;
            hit.at = [world.x, world.y, world.z];
          }
        }
      }
    }
  });

  const hits = [...byPart.values()].sort((a, b) => b.depth - a.depth);
  return { hits, maxDepth: hits[0]?.depth ?? 0, unknown: [...unknown] };
}
