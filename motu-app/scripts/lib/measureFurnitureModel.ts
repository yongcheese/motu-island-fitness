/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import React from 'react';
import { FurnitureModel } from '../../src/components/Three/FurnitureItem';
import { ALL_ITEMS } from '../../src/constants/items';

/**
 * MEASURING A FURNITURE MODEL WITHOUT A RENDERER.
 *
 * `FurnitureModel` returns a tree of React elements describing three.js primitives. This walks
 * that tree, composes each node's position/rotation/scale into a matrix and accumulates the
 * corners of every geometry it recognises — which gives the same box the runtime measures off the
 * live scene graph (lib/furniturePlacement.ts's `measureFootprint`), from a plain `tsx` run with
 * no WebGL context anywhere.
 *
 * Extracted from scripts/audit-placements.ts when a second audit needed it. Both the placement
 * audit and the interaction audit have to be measuring THE SAME model or they can pass while
 * disagreeing with each other, which is the failure a shared module rules out.
 *
 * Most furniture components are plain hook-free functions and can simply be called. The ones that
 * animate cannot — see {@link renderComponent} for what this module does about that, and why it
 * matters more than it sounds.
 */

export type Box = {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
};

export const GEO_BOUNDS: Record<string, (a: any[]) => [number, number, number]> = {
  boxGeometry: (a) => [a[0] ?? 1, a[1] ?? 1, a[2] ?? 1],
  planeGeometry: (a) => [a[0] ?? 1, a[1] ?? 1, 0],
  cylinderGeometry: (a) => {
    const r = Math.max(a[0] ?? 1, a[1] ?? 1);
    return [r * 2, a[2] ?? 1, r * 2];
  },
  coneGeometry: (a) => [(a[0] ?? 1) * 2, a[1] ?? 1, (a[0] ?? 1) * 2],
  sphereGeometry: (a) => [(a[0] ?? 1) * 2, (a[0] ?? 1) * 2, (a[0] ?? 1) * 2],
  circleGeometry: (a) => [(a[0] ?? 1) * 2, (a[0] ?? 1) * 2, 0],
  ringGeometry: (a) => [(a[1] ?? 1) * 2, (a[1] ?? 1) * 2, 0],
  torusGeometry: (a) => {
    const o = (a[0] ?? 1) + (a[1] ?? 0.4);
    return [o * 2, o * 2, (a[1] ?? 0.4) * 2];
  },
  capsuleGeometry: (a) => [(a[0] ?? 1) * 2, (a[1] ?? 1) + (a[0] ?? 1) * 2, (a[0] ?? 1) * 2],
  dodecahedronGeometry: (a) => [(a[0] ?? 1) * 2, (a[0] ?? 1) * 2, (a[0] ?? 1) * 2],
  icosahedronGeometry: (a) => [(a[0] ?? 1) * 2, (a[0] ?? 1) * 2, (a[0] ?? 1) * 2],
  octahedronGeometry: (a) => [(a[0] ?? 1) * 2, (a[0] ?? 1) * 2, (a[0] ?? 1) * 2],
  tetrahedronGeometry: (a) => [(a[0] ?? 1) * 2, (a[0] ?? 1) * 2, (a[0] ?? 1) * 2],
};

/* ------------------------------------------------------- calling a component without a renderer */

/**
 * WHY THIS EXISTS: five outdoor items used to be invisible to every audit in the project.
 *
 * 木製鞦韆, 溫馨營火, 黃銅望遠鏡, 手作鳥屋 and 許願井 animate, so their components call `useRef`,
 * `useMemo` and `useFrame`. Calling such a function outside a real render throws `Invalid hook
 * call`, and the old harness caught that, filed the name under {@link brokenComponents} and moved
 * on — which meant those five shipped with **no collider check, no interaction check and no
 * quality check at all**. The reports said so in one quiet line at the end (`items with no
 * measurable model: …`) and it was easy to read that as housekeeping rather than as a hole.
 *
 * It is a hole. Those are five of the island's twenty-six placeable outdoor pieces, they include
 * the most expensive one in the shelf (許願井), and they are exactly the pieces most likely to be
 * edited — because they are the interactive ones.
 *
 * ## What this does
 *
 * React resolves a hook by asking the *current dispatcher*, which lives on an internal slot. For
 * the duration of one component call this installs a dispatcher that answers every hook with the
 * simplest thing that keeps the component's own code running:
 *
 *  - `useRef` hands back a `{ current }` — the component stores it and never dereferences it
 *    during render, because the whole point of a ref is that it is read in a callback later.
 *  - `useMemo` just calls the factory. The models use it for seed arrays, which is exactly what
 *    the returned JSX indexes into.
 *  - effects are no-ops. Nothing about the geometry is decided in one.
 *  - `useContext` returns a stub zustand store, which is all `useFrame` needs: it reads
 *    `store.getState().internal.subscribe` and registers the callback in a layout effect that
 *    never runs here.
 *
 * The animation callback is therefore never invoked, so what gets measured is the model in its
 * REST POSE. That is the honest thing to measure — a swing's collider should be the swing at
 * rest, not at the top of its arc — and it is the same tree the renderer builds on frame one.
 *
 * ## The cost of doing it this way
 *
 * `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE` is, as the name says, private
 * to React, and its shape can change in a major version. That is a real cost and it is worth
 * paying here: this is a build-time audit, not shipped code, and the alternative — asking every
 * animated model to split its geometry into a second hook-free component and keeping a registry
 * that maps one to the other — is a parallel source of truth for what a model IS, which is the
 * class of bug constants/furnitureModels.ts exists to end.
 *
 * If React moves the slot, every audit fails loudly on day one with these five names in
 * {@link brokenComponents}, which is the failure mode to want.
 */
const ReactInternals: any =
  (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

const noop = () => {};
/** Enough of a zustand store for `useFrame` to subscribe to. */
const STUB_R3F_STORE = {
  getState: () => ({ internal: { subscribe: () => noop } }),
  subscribe: () => noop,
};

const MEASUREMENT_DISPATCHER: any = {
  useRef: (v: unknown) => ({ current: v }),
  useMemo: (f: () => unknown) => f(),
  useCallback: (f: unknown) => f,
  useEffect: noop,
  useLayoutEffect: noop,
  useInsertionEffect: noop,
  useState: (v: unknown) => [typeof v === 'function' ? (v as () => unknown)() : v, noop],
  useReducer: (_r: unknown, v: unknown) => [v, noop],
  useContext: () => STUB_R3F_STORE,
  useId: () => 'measure',
  useDebugValue: noop,
  useImperativeHandle: noop,
  useSyncExternalStore: (_s: unknown, get: () => unknown) => get(),
  useTransition: () => [false, noop],
  useDeferredValue: (v: unknown) => v,
};

/**
 * Calls a function component once, with hooks answered by {@link MEASUREMENT_DISPATCHER}, and
 * returns what it rendered. A component that throws for any OTHER reason is recorded in
 * {@link brokenComponents} and contributes nothing, as before.
 */
export function renderComponent(type: (props: any) => any, props: any): any {
  const previous = ReactInternals?.H;
  if (ReactInternals) ReactInternals.H = MEASUREMENT_DISPATCHER;
  try {
    return type(props);
  } catch {
    brokenComponents.add(type.name || 'anonymous');
    return undefined;
  } finally {
    if (ReactInternals) ReactInternals.H = previous;
  }
}

export const unknownGeometries = new Set<string>();
export const brokenComponents = new Set<string>();

export function toVec3(v: unknown, fallback: number): THREE.Vector3 {
  if (typeof v === 'number') return new THREE.Vector3(v, v, v);
  if (Array.isArray(v)) return new THREE.Vector3(v[0] ?? fallback, v[1] ?? fallback, v[2] ?? fallback);
  return new THREE.Vector3(fallback, fallback, fallback);
}

export function localMatrix(props: any): THREE.Matrix4 {
  const pos = toVec3(props.position, 0);
  const scl = toVec3(props.scale, 1);
  const rot = toVec3(props.rotation, 0);
  return new THREE.Matrix4().compose(
    pos,
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot.x, rot.y, rot.z)),
    scl,
  );
}

/**
 * Is this element a drawn EFFECT rather than the object's own substance?
 *
 * The same rule the shipping collider applies (lib/furniturePlacement.ts's `isSolidGeometry`),
 * asked of a React element instead of a `THREE.Mesh`: a mesh that does not write depth, or is
 * additively blended, or is explicitly flagged, is light rather than matter.
 *
 * WHY THE AUDIT NEEDED IT TOO. Without this the React walk measured what the runtime had already
 * learned to ignore — and measured it BEFORE the `useFrame` that shrinks it, which is the worst
 * possible moment. 溫馨營火's flames are nine `sphereGeometry(1)` particles authored at unit
 * radius, so `npm run audit:interactions` reported the campfire as a 2.63-unit cube with 1.32 of
 * it underground, against the 1.54 x 1.41 stone ring the game actually collides with. 噴泉,
 * 黃銅望遠鏡, 許願井 and 手作鳥屋 all carry the same kind of sparkle. Every geometry check those
 * five pieces passed was therefore being run against a box no player ever meets — an audit
 * reporting "ok" about a shape that does not exist.
 */
function isEffectElement(props: any): boolean {
  if (props?.userData?.noCollide) return true;
  const children = React.Children.toArray(props?.children ?? []);
  return children.some((child: any) => {
    if (!React.isValidElement(child)) return false;
    const t: any = (child as any).type;
    if (typeof t !== 'string' || !t.endsWith('Material')) return false;
    const p: any = (child as any).props ?? {};
    return p.depthWrite === false || p.blending === THREE.AdditiveBlending;
  });
}

export function walk(node: any, parent: THREE.Matrix4, out: THREE.Box3, depth = 0): void {
  if (node == null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return;
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, parent, out, depth));
    return;
  }
  if (!React.isValidElement(node)) return;

  const type: any = (node as any).type;
  const props: any = (node as any).props ?? {};

  // An invisible group prunes its whole subtree, not just itself — a burst of particles is
  // usually a hidden parent over visible children. Same order as the runtime's own walk.
  if (props.visible === false) return;
  if (isEffectElement(props)) return;

  // A fragment carries its children in props and has no transform of its own. Without this it
  // fell through the `typeof type !== 'string'` guard below and its whole subtree was silently
  // dropped from the measurement — which is invisible while every model is a single rooted
  // <group>, and stops being invisible the moment one returns a list of meshes.
  if (type === React.Fragment) {
    walk(props.children, parent, out, depth + 1);
    return;
  }

  // A component: call it and walk what it returns.
  if (typeof type === 'function') {
    walk(renderComponent(type, props), parent, out, depth + 1);
    return;
  }

  if (typeof type !== 'string') return;

  const here = new THREE.Matrix4().multiplyMatrices(parent, localMatrix(props));

  const bounds = GEO_BOUNDS[type];
  if (bounds) {
    const args = props.args ?? [];
    const [w, h, d] = bounds(args);
    const hx = w / 2, hy = h / 2, hz = d / 2;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? hx : -hx, i & 2 ? hy : -hy, i & 4 ? hz : -hz).applyMatrix4(here);
      out.expandByPoint(v);
    }
    return;
  }
  if (type.endsWith('Geometry')) unknownGeometries.add(type);

  walk(props.children, here, out, depth + 1);
}

/** The interior renders every piece at scale 1.15 (BuildingInteriorView's FurnitureItem). */
export const INTERIOR_SCALE = 1.15;

/**
 * The island renders a placed piece at FurnitureModel's own default of 0.85 (Three/
 * PlacementGhost's IslandPlacements). `FurnitureModel` then multiplies a BUILDING item by a
 * further 1.55 itself, so this is the number to hand it, not the final size.
 */
export const ISLAND_SCALE = 0.85;

/**
 * The measured local box of an item's model.
 *
 * `scale` must be the scale the piece is actually DRAWN at in the world it lives in — indoor
 * furniture at {@link INTERIOR_SCALE}, island pieces at {@link ISLAND_SCALE} — because a footprint
 * measured at the wrong scale is worse than none: it is a plausible number that is wrong by a
 * constant factor, which is exactly the kind of error an audit is supposed to catch rather than
 * commit.
 */
export function footprintOf(itemId: string, scale = INTERIOR_SCALE): Box | null {
  const item = ALL_ITEMS.find((i) => i.id === itemId);
  if (!item) return null;
  const box = new THREE.Box3();
  walk(
    React.createElement(FurnitureModel, { name: item.name, item, scale }),
    new THREE.Matrix4(),
    box,
  );
  if (box.isEmpty()) return null;
  return {
    minX: box.min.x, maxX: box.max.x,
    minY: box.min.y, maxY: box.max.y,
    minZ: box.min.z, maxZ: box.max.z,
  };
}

/* ------------------------------------------------------------------ real scene graphs */

/**
 * The geometry classes the procedural models are built from.
 *
 * Deliberately an explicit map rather than `(THREE as any)[type]`: an audit that silently
 * accepted a geometry it had never seen would report a collider measured off an incomplete
 * model, which is worse than reporting nothing. {@link buildModelObject3D} records anything
 * missing in {@link unknownGeometries} so the caller can fail on it.
 */
const GEO_CTORS: Record<string, new (...args: any[]) => THREE.BufferGeometry> = {
  boxGeometry: THREE.BoxGeometry,
  planeGeometry: THREE.PlaneGeometry,
  cylinderGeometry: THREE.CylinderGeometry,
  coneGeometry: THREE.ConeGeometry,
  sphereGeometry: THREE.SphereGeometry,
  circleGeometry: THREE.CircleGeometry,
  ringGeometry: THREE.RingGeometry,
  torusGeometry: THREE.TorusGeometry,
  capsuleGeometry: THREE.CapsuleGeometry,
  dodecahedronGeometry: THREE.DodecahedronGeometry,
  icosahedronGeometry: THREE.IcosahedronGeometry,
  octahedronGeometry: THREE.OctahedronGeometry,
  tetrahedronGeometry: THREE.TetrahedronGeometry,
};

/**
 * Builds a REAL `THREE.Object3D` for an item's model, with real geometries and materials.
 *
 * {@link footprintOf} above answers "how big is the box" by arithmetic on the React tree; this
 * answers the harder question, "what would the shipping `measureFootprint` produce", by handing
 * that function the same kind of scene graph the renderer would. It is what lets the collider
 * audit test the code players run rather than a re-implementation of it — the distinction that
 * matters most for a rule whose whole promise is "the collider is the model".
 *
 * Materials carry only the three properties collision looks at (`depthWrite`, `blending`,
 * `transparent`), because those are what separate a solid from a drawn effect.
 */
export function buildModelObject3D(itemId: string, scale = INTERIOR_SCALE): THREE.Object3D | null {
  const item = ALL_ITEMS.find((i) => i.id === itemId);
  if (!item) return null;

  const root = new THREE.Group();
  const build = (node: any, parent: THREE.Object3D): void => {
    if (node == null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return;
    if (Array.isArray(node)) { node.forEach((n) => build(n, parent)); return; }
    if (!React.isValidElement(node)) return;

    const type: any = (node as any).type;
    const props: any = (node as any).props ?? {};

    if (type === React.Fragment) { build(props.children, parent); return; }
    if (typeof type === 'function') {
      build(renderComponent(type, props), parent);
      return;
    }
    if (typeof type !== 'string') return;

    if (type.endsWith('Geometry')) {
      const Ctor = GEO_CTORS[type];
      if (!Ctor) { unknownGeometries.add(type); return; }
      const mesh = parent as THREE.Mesh;
      if ((mesh as any).isMesh) mesh.geometry = new Ctor(...(props.args ?? []));
      return;
    }
    if (type.endsWith('Material')) {
      const mesh = parent as THREE.Mesh;
      if ((mesh as any).isMesh) {
        mesh.material = new THREE.MeshStandardMaterial({
          depthWrite: props.depthWrite !== false,
          transparent: !!props.transparent,
          blending: props.blending ?? THREE.NormalBlending,
        });
      }
      return;
    }

    const obj: THREE.Object3D = type === 'mesh' ? new THREE.Mesh() : new THREE.Group();
    const pos = toVec3(props.position, 0);
    const rot = toVec3(props.rotation, 0);
    const scl = toVec3(props.scale, 1);
    obj.position.copy(pos);
    obj.rotation.set(rot.x, rot.y, rot.z);
    obj.scale.copy(scl);
    if (props.visible === false) obj.visible = false;
    if (props.userData) obj.userData = props.userData;
    parent.add(obj);
    build(props.children, obj);
  };

  build(React.createElement(FurnitureModel, { name: item.name, item, scale }), root);
  new THREE.Scene().add(root);
  root.updateMatrixWorld(true);
  // A mesh whose geometry never arrived (an unknown primitive) must not read as an empty solid.
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if ((m as any).isMesh && !m.geometry) m.visible = false;
  });
  return root;
}
