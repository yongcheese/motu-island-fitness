/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import * as THREE from 'three';
import { LEGACY_TORSO_SHAPE } from '../../../constants/characterRig';
import type { TorsoShape } from '../../../constants/characterRig';

/**
 * 服裝貼身 — carrying garments drawn on one torso onto a torso of a different SHAPE.
 *
 * ============================================================================
 * WHY A WARP AND NOT A SCALE
 * ============================================================================
 *
 * Every torso garment is drawn hugging legacy's circular capsule. A socket scale fixes SIZE and
 * nothing else, and the authored chest differs in shape three ways at once: it is shallower
 * front-to-back than it is wide, its straight section is shorter, and its caps are flatter. No
 * one number fits all three, so a uniformly scaled shirt floated 2 cm off the chest and hung its
 * rounded bottom 2 cm under the body — the pointed bib the wardrobe was reported for.
 *
 * So each vertex is moved instead, by a map that sends legacy's torso SURFACE exactly onto this
 * one's (see {@link warpTorsoPoint}). Anything drawn ON the legacy body lands on this body;
 * anything drawn N mm off it lands N mm off this one. That second half is the point: clearance
 * is what stops a garment z-fighting the skin or the layer under it, so it is carried over in
 * absolute terms instead of being scaled down with the body.
 *
 * ============================================================================
 * WHAT IT COSTS AND WHAT IT LEAVES ALONE
 * ============================================================================
 *
 * The garments are small (a few thousand vertices for the busiest outfit), and the warp runs
 * once per mesh when the outfit changes — never per frame. Geometry is CLONED before it is
 * moved: R3F's `<capsuleGeometry>` elements and the necklace's memoised tube are owned by their
 * components, and the shop's thumbnails may share them, so the originals are never touched.
 * Clones are disposed when their mesh leaves the subtree or the fit unmounts.
 *
 * A mesh is re-fitted if its geometry is replaced (an `args` change) or its transform relative to
 * the fit root changes; otherwise a re-render is a traversal and two comparisons per mesh.
 */

/**
 * Where on a torso's DRESSED surface a bearing (cx, cz — a unit vector in plan) meets height `y`.
 *
 * Without a hem that is the body itself. With one, the lower cap is replaced below the straight
 * section: the section eases out to the hem's size by the hem line — smoothstep, so the chest
 * does not crease where the flare starts — and only closes underneath past it.
 */
function surfaceRadius(shape: TorsoShape, y: number, cx: number, cz: number): number {
  const over = Math.abs(y) - shape.straightHalf;
  const hem = shape.hem;
  if (over <= 0 || !hem || y > 0) {
    const k = over <= 0 ? 1 : Math.sqrt(Math.max(0, 1 - (over / shape.capHeight) ** 2));
    return k / Math.hypot(cx / shape.halfX, cz / shape.halfZ);
  }
  const u = over / shape.capHeight;
  const uHem = (-hem.y - shape.straightHalf) / shape.capHeight;
  const t = Math.min(1, u / uHem);
  const ease = t * t * (3 - 2 * t);
  const hx = shape.halfX + (hem.halfX - shape.halfX) * ease;
  const hz = shape.halfZ + (hem.halfZ - shape.halfZ) * ease;
  const k = u <= uHem ? 1 : Math.sqrt(Math.max(0, 1 - ((u - uHem) / (1 - uHem)) ** 2));
  return k / Math.hypot(cx / hx, cz / hz);
}

/**
 * Height on `to` of height `y` on `from`: the straight sections match, each cap is stretched onto
 * the other's cap, and anything past the pole keeps its distance from it.
 */
function mapHeight(from: TorsoShape, to: TorsoShape, y: number): number {
  const a = Math.abs(y);
  const sign = y < 0 ? -1 : 1;
  if (a <= from.straightHalf) return y * (to.straightHalf / from.straightHalf);
  const fromPole = from.straightHalf + from.capHeight;
  if (a <= fromPole) {
    return sign * (to.straightHalf + ((a - from.straightHalf) * to.capHeight) / from.capHeight);
  }
  return sign * (to.straightHalf + to.capHeight + (a - fromPole));
}

/**
 * The warp, torso-local in and out. Keeps bearing; maps height as above; and in plan:
 *
 *   inside the body  scales with the body, so an inner lining stays inside;
 *   outside it       keeps its absolute distance off the surface.
 *
 * The two agree ON the surface, so the map is continuous. Past a pole the body has no surface
 * (radius 0 on both sides) and the point is carried over unchanged, which is also continuous.
 */
export function warpTorsoPoint(from: TorsoShape, to: TorsoShape, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const r = Math.hypot(p.x, p.z);
  const y = mapHeight(from, to, p.y);
  if (r < 1e-9) return out.set(0, y, 0);
  const cx = p.x / r;
  const cz = p.z / r;
  const rb = surfaceRadius(from, p.y, cx, cz);
  const re = surfaceRadius(to, y, cx, cz);
  const r2 = rb > 1e-9 && r <= rb ? r * (re / rb) : re + (r - rb);
  return out.set(cx * r2, y, cz * r2);
}

const sameShape = (a: TorsoShape, b: TorsoShape) =>
  a.halfX === b.halfX && a.halfZ === b.halfZ && a.straightHalf === b.straightHalf &&
  a.capHeight === b.capHeight && !a.hem && !b.hem;

interface FitRecord {
  /** The geometry the component owns — what every re-fit starts from. */
  source: THREE.BufferGeometry;
  /** The warped clone currently on the mesh. */
  fitted: THREE.BufferGeometry;
  /** Mesh-to-root matrix the clone was built under. */
  matrix: THREE.Matrix4;
}

const FIT_KEY = 'torsoFit';

/**
 * The geometry a mesh was given BEFORE it was fitted — its own if it has never been fitted,
 * otherwise the source the clone on it is carrying.
 *
 * Asked instead of assuming, because a fitted clone can outlive this component's record of
 * it: every time the subtree is torn down and put back — React's StrictMode does exactly
 * that on each mount in development, and a Suspense boundary does it whenever it hides and
 * re-shows its content — the cleanup below empties the map while the clones are still on
 * their meshes. Taking one of those as a source warps an already-warped garment: the second
 * pass reads its clearance off LEGACY's wider chest, so the shirt lands ~2 cm INSIDE this
 * body and the torso is left looking bare. See the fix's counterpart in the cleanup.
 */
function sourceOf(mesh: THREE.Mesh): THREE.BufferGeometry {
  return (mesh.geometry.userData?.[FIT_KEY] as THREE.BufferGeometry | undefined) ?? mesh.geometry;
}

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _j = new THREE.Matrix3();
const _nm = new THREE.Matrix3();
const _nmInv = new THREE.Matrix3();
const EPS = 1e-4;

function warpGeometry(
  source: THREE.BufferGeometry,
  toRoot: THREE.Matrix4,
  from: TorsoShape,
  to: TorsoShape,
): THREE.BufferGeometry {
  const geometry = source.clone();
  // The clone carries the geometry it was made from, so a fit can always be undone by
  // whoever finds the clone — see sourceOf. A fresh userData object and not the cloned
  // one: BufferGeometry.clone() hands the copy the SOURCE's userData BY REFERENCE, so
  // writing the mark straight onto it would mark the original as fitted as well.
  geometry.userData = { ...source.userData, [FIT_KEY]: source };
  const fromRoot = toRoot.clone().invert();
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  _nm.getNormalMatrix(toRoot);
  _nmInv.getNormalMatrix(fromRoot);

  for (let i = 0; i < position.count; i++) {
    _p.fromBufferAttribute(position, i).applyMatrix4(toRoot);

    if (normal) {
      // The normal goes through the inverse-transpose of the warp's Jacobian, taken numerically:
      // the map is piecewise and not worth differentiating by hand, and three central differences
      // on a few thousand vertices is nothing.
      const cols: number[] = [];
      for (let axis = 0; axis < 3; axis++) {
        _q.copy(_p).setComponent(axis, _p.getComponent(axis) + EPS);
        warpTorsoPoint(from, to, _q, _a);
        _q.copy(_p).setComponent(axis, _p.getComponent(axis) - EPS);
        warpTorsoPoint(from, to, _q, _b);
        _a.sub(_b).multiplyScalar(1 / (2 * EPS));
        cols.push(_a.x, _a.y, _a.z);
      }
      // Matrix3.set is row-major; the columns above are the partial derivatives.
      _j.set(cols[0], cols[3], cols[6], cols[1], cols[4], cols[7], cols[2], cols[5], cols[8]);
      if (Math.abs(_j.determinant()) > 1e-12) {
        _j.invert().transpose();
        _n.fromBufferAttribute(normal, i).applyMatrix3(_nm).applyMatrix3(_j).applyMatrix3(_nmInv).normalize();
        normal.setXYZ(i, _n.x, _n.y, _n.z);
      }
    }

    warpTorsoPoint(from, to, _p, _q).applyMatrix4(fromRoot);
    position.setXYZ(i, _q.x, _q.y, _q.z);
  }

  position.needsUpdate = true;
  if (normal) normal.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Wraps torso garments and fits them to `shape`. Children are drawn in LEGACY torso space, exactly
 * as they always have been; nothing inside needs to know this is here.
 */
export function TorsoFit({ shape, children }: { shape: TorsoShape; children: ReactNode }) {
  const root = useRef<THREE.Group>(null);
  const clones = useRef(new Map<THREE.Mesh, FitRecord>());

  // Every render, after the children have committed: R3F has attached any new geometry by the
  // time a parent's layout effect runs, so this sees the finished subtree.
  useLayoutEffect(() => {
    const group = root.current;
    if (!group) return;
    const from = LEGACY_TORSO_SHAPE;
    const identity = sameShape(from, shape);

    group.updateWorldMatrix(true, true);
    const rootInverse = group.matrixWorld.clone().invert();
    const seen = new Set<THREE.Mesh>();

    group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || identity) return;
      seen.add(mesh);
      const toRoot = rootInverse.clone().multiply(mesh.matrixWorld);
      const record = clones.current.get(mesh);

      if (record && mesh.geometry === record.fitted && record.matrix.equals(toRoot)) return;

      // A geometry that is not our clone is a new one from the component: fit that. Otherwise the
      // mesh moved, and the fit is rebuilt from the geometry it was originally given.
      const source = record && mesh.geometry === record.fitted ? record.source : sourceOf(mesh);
      if (record) record.fitted.dispose();
      const fitted = warpGeometry(source, toRoot, from, shape);
      mesh.geometry = fitted;
      clones.current.set(mesh, { source, fitted, matrix: toRoot });
    });

    for (const [mesh, record] of clones.current) {
      if (seen.has(mesh)) continue;
      // Gone from the subtree (or the fit became the identity): release the clone, and hand the
      // mesh its own geometry back if it is still alive somewhere.
      if (mesh.geometry === record.fitted) mesh.geometry = record.source;
      record.fitted.dispose();
      clones.current.delete(mesh);
    }
  });

  useLayoutEffect(() => {
    const map = clones.current;
    return () => {
      for (const [mesh, record] of map) {
        // Same restore as the removal loop above, and for the same reason: this cleanup also
        // runs when the subtree is only being HIDDEN, and a mesh left holding a clone this
        // component has forgotten is one that gets warped a second time when it comes back.
        if (mesh.geometry === record.fitted) mesh.geometry = record.source;
        record.fitted.dispose();
      }
      map.clear();
    };
  }, []);

  return <group ref={root}>{children}</group>;
}
