/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scene-graph audit for depth conflicts (z-fighting).
 *
 * ## Why this is a runtime check and not a lint rule
 *
 * Every model in this project is procedural: a mesh's real world-space position
 * is the product of its own `position` prop and every `group` scale/rotation
 * above it, several of which are computed at render time from the territory
 * level or the player's saved placements. Reading the JSX cannot tell you where
 * a mesh actually ends up, so a static check can only enforce *conventions*
 * (that is `scripts/audit-zfighting.mjs`). This one measures the real thing:
 * it walks the live scene, resolves world matrices, and reports every pair of
 * surfaces close enough to flicker.
 *
 * ## What counts as a finding
 *
 * A pair of meshes is reported when all of these hold:
 *
 *   - both are opaque and both write depth (a transparent, `depthWrite: false`
 *     layer such as the ocean's foam cannot z-fight - it is sorted, not
 *     depth-tested against its own kind);
 *   - neither carries `polygonOffset` (a decal declaring itself a decal is
 *     doing the right thing - see DECAL_DEPTH_BIAS in constants/terrain.ts);
 *   - they present near-parallel faces along the same axis, separated by less
 *     than {@link MIN_SURFACE_SEPARATION};
 *   - their extents overlap in the other two axes by more than a sliver, so
 *     they genuinely cover each other rather than merely abutting.
 *
 * ## Usage
 *
 * In the browser console, at any time:
 *
 * ```js
 * __auditZFighting()          // audit every mounted scene, print a table per scene
 * __auditZFighting({ json: true })   // same, returned as data
 * ```
 *
 * EVERY mounted scene, because this game has two: the island's <Canvas> and, while the player
 * is indoors, BuildingInteriorView's own. They are separate renderers with separate scene
 * graphs, so an audit that only ever looked at one of them reported half the game as clean
 * without ever having looked at the other half. Each Canvas registers itself through
 * {@link installZFightAudit} (see Three/ZFightAuditBridge.tsx) and unregisters on unmount, so
 * the report always covers exactly what is on screen right now.
 */

import * as THREE from 'three';
import { MIN_SURFACE_SEPARATION } from '../constants/terrain';

/** Below this thickness a mesh is treated as a flat plate rather than a solid. */
const FLAT_EPSILON = 1e-3;

/**
 * Minimum overlap area (in world units squared) before an overlapping pair is
 * worth reporting. Two solids that merely touch along an edge share a hairline
 * of area and never visibly flicker; a genuine conflict covers real screen
 * space.
 */
const MIN_OVERLAP_AREA = 0.05;

export type ZFightFinding = {
  /** Axis along which the two faces are separated. */
  axis: 'x' | 'y' | 'z';
  /** Distance between the two faces. 0 means exactly coplanar. */
  separation: number;
  /** Overlap area of the two faces in the other two axes. */
  overlapArea: number;
  /** Identifies the two meshes involved, so one pair is reported once. Not for display. */
  pair: string;
  a: string;
  b: string;
  /** World coordinate of the shared plane, for locating it in the scene. */
  planeCoord: number;
};

type Plate = {
  object: THREE.Mesh;
  /** Position in the traversal, used to identify a pair. See the dedupe in the audit below. */
  id: number;
  name: string;
  box: THREE.Box3;
};

const AXES = ['x', 'y', 'z'] as const;

/**
 * A readable identity for a mesh: its own name if it has one, else the nearest
 * named ancestor plus the geometry type, which for procedural meshes is usually
 * enough to find the JSX that produced it.
 */
function describe(obj: THREE.Object3D): string {
  const parts: string[] = [];
  let cur: THREE.Object3D | null = obj;
  while (cur && parts.length < 3) {
    if (cur.name) parts.unshift(cur.name);
    cur = cur.parent;
  }
  const geo = (obj as THREE.Mesh).geometry?.type ?? 'Geometry';
  const trail = parts.length ? parts.join(' / ') : '(unnamed)';
  return `${trail} <${geo}>`;
}

/** A material (or every material in an array) that opts out of depth conflicts. */
function isExemptMaterial(material: THREE.Material | THREE.Material[]): boolean {
  const list = Array.isArray(material) ? material : [material];
  return list.every(
    (m) =>
      // Declared itself a decal - this is the sanctioned fix, not a defect.
      m.polygonOffset === true ||
      // Cannot fight: it never writes depth, so it is resolved by sort order.
      m.depthWrite === false ||
      // Not depth-tested at all.
      m.depthTest === false
  );
}

/**
 * IS THIS MESH A SLEEVE ALONG `axis` — a tube with no ends?
 *
 * `openEnded` cylinders and cones are the island's own terrain: the ground is a
 * `RingGeometry` cap at y = 0.30 sitting on an open-ended cylinder that runs y = -0.70 … 0.30,
 * which in turn is capped by a `CircleGeometry` at its bottom. That is a correct join — a lid
 * filling an open tube — but a bounding box cannot see the hole, so this audit was reading the
 * sleeve as a solid with a top face at 0.30 and a bottom at -0.70, and reporting both caps as
 * exactly-coplanar conflicts covering 130 and 187 square units.
 *
 * They were the two loudest findings in the whole report, and they were the two most obviously
 * correct pieces of geometry in the scene, which is the failure mode that teaches everyone to
 * stop reading the report. The parameter is right there on the geometry, so read it.
 *
 * Only the cylinder's OWN axis is exempted: a tube lying on its side still presents two real
 * silhouette faces across the axes it was not extruded along. Anything rotated off the world
 * axes has a bounding box that is not its faces anyway, which this audit has never claimed to
 * resolve.
 */
function openEndedAlong(mesh: THREE.Mesh, axis: 'x' | 'y' | 'z'): boolean {
  const params = (mesh.geometry as { parameters?: { openEnded?: boolean } }).parameters;
  if (!params?.openEnded) return false;
  // Cylinders and cones are extruded along their own +Y; find where that ended up in the world.
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.getWorldQuaternion(SCRATCH_QUAT));
  return Math.abs(up[axis]) > 0.99;
}

const SCRATCH_QUAT = new THREE.Quaternion();

/**
 * Overlap of two boxes in the two axes that are NOT `axis`, as an area.
 * Negative extent in either axis means no overlap at all.
 */
function overlapArea(a: THREE.Box3, b: THREE.Box3, axis: 'x' | 'y' | 'z'): number {
  let area = 1;
  for (const other of AXES) {
    if (other === axis) continue;
    const lo = Math.max(a.min[other], b.min[other]);
    const hi = Math.min(a.max[other], b.max[other]);
    const extent = hi - lo;
    if (extent <= 0) return 0;
    area *= extent;
  }
  return area;
}

/**
 * Walk a scene and report every pair of surfaces that can z-fight.
 *
 * @param root usually the R3F `scene`
 */
export function auditSceneForZFighting(root: THREE.Object3D): ZFightFinding[] {
  root.updateWorldMatrix(true, true);

  const plates: Plate[] = [];
  root.traverseVisible((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!(mesh as any).isMesh || !mesh.geometry) return;
    if (!mesh.material || isExemptMaterial(mesh.material)) return;

    // Skinned/instanced meshes and anything animated per-frame in a shader
    // cannot be judged from a static bounding box, so they are out of scope.
    if ((mesh as any).isInstancedMesh || (mesh as any).isSkinnedMesh) return;

    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) return;
    plates.push({ object: mesh, id: plates.length, name: describe(mesh), box });
  });

  const findings: ZFightFinding[] = [];

  for (const axis of AXES) {
    // Collect every candidate face: for a flat plate that is the plate itself,
    // for a solid it is its two extreme faces along this axis. The terrain bug
    // this module was written for was exactly a "solid's top face vs another
    // solid's top face" pair, which a flat-plates-only check would have missed.
    type Face = { plate: Plate; coord: number };
    const faces: Face[] = [];
    for (const p of plates) {
      const thickness = p.box.max[axis] - p.box.min[axis];
      if (thickness < FLAT_EPSILON) {
        faces.push({ plate: p, coord: p.box.min[axis] });
      } else if (openEndedAlong(p.object, axis)) {
        // A SLEEVE, not a solid — see openEndedAlong. Its bounding box has a top and a bottom
        // but the mesh does not, so neither end can fight anything.
        continue;
      } else {
        faces.push({ plate: p, coord: p.box.min[axis] });
        faces.push({ plate: p, coord: p.box.max[axis] });
      }
    }

    // Sort by plane coordinate so only nearby faces are compared: without this
    // the island scene's few thousand meshes would be a quadratic sweep.
    faces.sort((f, g) => f.coord - g.coord);

    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        const separation = faces[j].coord - faces[i].coord;
        if (separation >= MIN_SURFACE_SEPARATION) break; // sorted: no later j is closer

        const a = faces[i].plate;
        const b = faces[j].plate;
        if (a === b) continue;
        // A mesh's own two faces, and any parent/child pair, are modelling
        // decisions rather than conflicts.
        if (a.object === b.object) continue;

        const area = overlapArea(a.box, b.box, axis);
        if (area < MIN_OVERLAP_AREA) continue;

        findings.push({
          axis,
          separation,
          overlapArea: area,
          pair: a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`,
          a: a.name,
          b: b.name,
          planeCoord: faces[i].coord,
        });
      }
    }
  }

  // Worst first: exactly coplanar and covering the most area.
  findings.sort((f, g) => f.separation - g.separation || g.overlapArea - f.overlapArea);

  // The same pair can be reported once per axis when two boxes are close in more than one
  // direction; keep only its worst axis.
  //
  // Keyed on WHICH TWO MESHES, not on what they are called. Every mesh in this project is
  // procedural and unnamed, so `describe()` returns the same '(unnamed) <BoxGeometry>' string for
  // all of them - and a name-keyed dedupe therefore collapsed every box-versus-box conflict in
  // the scene into a single row. The report came back with a handful of findings and read as
  // near-clean while hiding an unbounded number behind each one.
  const seen = new Set<string>();
  return findings.filter((f) => {
    if (seen.has(f.pair)) return false;
    seen.add(f.pair);
    return true;
  });
}

/**
 * Registers one scene with `window.__auditZFighting()`, and returns the function that
 * unregisters it again. Dev builds only - every caller is behind an `import.meta.env.DEV`
 * guard, and the whole module is dropped from production with them.
 *
 * `label` is what the report calls this scene ("island", "interior"), so a finding can be
 * traced to the Canvas it came from.
 */
export function installZFightAudit(label: string, getScene: () => THREE.Object3D | null): () => void {
  if (typeof window === 'undefined') return () => {};

  registry.set(label, getScene);
  (window as any).__auditZFighting = runAudit;

  return () => {
    registry.delete(label);
  };
}

/** Live scenes, by label. A Map so re-registering the same Canvas replaces rather than stacks. */
const registry = new Map<string, () => THREE.Object3D | null>();

function runAudit(opts?: { json?: boolean }) {
  const scenes = [...registry.entries()]
    .map(([label, getScene]) => ({ label, scene: getScene() }))
    .filter((entry): entry is { label: string; scene: THREE.Object3D } => !!entry.scene);

  if (!scenes.length) {
    console.warn('[z-fight audit] no scene mounted - is a 3D view on screen?');
    return [];
  }

  const all = scenes.flatMap(({ label, scene }) =>
    auditSceneForZFighting(scene).map((f) => ({ ...f, scene: label }))
  );

  if (opts?.json) return all;

  const scanned = scenes.map((s) => s.label).join(', ');

  if (!all.length) {
    console.log(
      `%c[z-fight audit] ${scanned} clean - no surface pair closer than ${MIN_SURFACE_SEPARATION} world units.`,
      'color:#2A9D8F;font-weight:bold'
    );
    return all;
  }

  console.groupCollapsed(
    `%c[z-fight audit] ${all.length} suspect pair(s) across: ${scanned}`,
    'color:#E8836A;font-weight:bold'
  );
  console.table(
    all.map((f) => ({
      scene: f.scene,
      axis: f.axis,
      separation: Number(f.separation.toFixed(4)),
      'overlap m²': Number(f.overlapArea.toFixed(2)),
      plane: Number(f.planeCoord.toFixed(3)),
      a: f.a,
      b: f.b,
    }))
  );
  console.info(
    'Fix by merging or deleting the redundant surface. If the pair is coplanar ' +
      'BY DESIGN (a decal lying on a floor), give it DECAL_DEPTH_BIAS from ' +
      'constants/terrain.ts instead - that also removes it from this report.'
  );
  console.info(
    'Note the overlap area is measured between AXIS-ALIGNED BOUNDING BOXES. Two round ' +
      'surfaces that only meet along a rim - an open-ended cone capped by a disc, say - ' +
      'share a whole square of bounding box and no actual area, and are reported here ' +
      'without being able to flicker. Check the geometry before moving anything.'
  );
  console.groupEnd();

  return all;
}
