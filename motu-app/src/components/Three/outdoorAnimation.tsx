/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useStore } from '@react-three/fiber';
import * as THREE from 'three';
import {
  SuspendedTimeline,
  WindSample,
  advanceWindClock,
  sampleWind,
  seedRange,
  windClock,
  windRotorAngle,
} from '../../lib/outdoorMotion';
import type { WindNodeSpec, WindRotorSpec } from '../../constants/outdoorAnimation';

/**
 * THE OUTDOOR ANIMATION RUNTIME — one loop, one wind sample per object, and a cull.
 *
 * ## What was here before, and why it could not be extended
 *
 * Every animated outdoor piece owned a `useFrame` with its own copy of the same four lines:
 * read the clock, work out how long since the player poked it, lerp a boost, write a rotation.
 * Five pieces did it (swing, campfire, telescope, birdhouse, wishing well) and the pieces the
 * brief is about — the palm, the fountain, the mobile, the hammock — did not move at all,
 * because "add another `useFrame` with another set of magic numbers" is not a thing anyone wants
 * to do for the twentieth object.
 *
 * ## The three things this buys that a per-object `useFrame` cannot
 *
 *  1. **ONE update pass.** R3F already runs a single `requestAnimationFrame` loop and every
 *     `useFrame` is a subscription to it — so the old code was never N loops. What it WAS is N
 *     callbacks each re-deriving the shared state (the clock, the weather's wind multiplier, the
 *     camera). Here that work happens once and the per-object callback receives it.
 *  2. **DISTANCE AND FRUSTUM CULLING.** A palm forty units behind the camera does not evaluate.
 *     This is only safe because every animation in lib/outdoorMotion.ts is a pure function of
 *     time: a culled object is not paused, it is simply not asked, and the frame it comes back it
 *     is instantly at the right pose. There is no state to catch up and nothing pops.
 *  3. **A DETAIL LADDER.** Between "full rate" and "not at all" there are two strides, and
 *     entries are spread across frames by index so a grove of palms never all update on the same
 *     one.
 *
 * ## Why the loop is owned by an entry rather than by a driver component
 *
 * The obvious shape is `<OutdoorAnimationDriver />` mounted once in Three/Scene.tsx. It was
 * rejected because these models are also rendered where no such component exists — the placement
 * ghost, the shop's 3D preview, and (crucially) the build-time audits, which walk the same JSX
 * with a stub hook dispatcher (scripts/lib/measureFurnitureModel.ts). A driver that has to be
 * remembered in four places is a driver that will be forgotten in the fifth.
 *
 * Instead, the FIRST registered animation elects itself owner and runs the pass for everyone;
 * when it unmounts the next one takes over. Every other entry's `useFrame` is an integer compare
 * and a return. Nothing has to be mounted anywhere, and the system works the moment one animated
 * object exists.
 *
 * The one assumption that buys: every registered entry is in the SAME canvas as the owner, since
 * the owner's camera is what the cull is measured against. True by construction here — everything
 * that registers is an outdoor placeable, and outdoor placeables only ever render in the island
 * canvas. The house interior mounts its own Canvas over the island's for ~0.18 s during the door
 * crossfade, and registers nothing.
 */

/* ------------------------------------------------------------------ the registry */

/** What one animated object is handed each time it runs. Reused in place — never held. */
export interface OutdoorFrame {
  /** The shared wind clock, seconds. Weather-scaled and continuous across weather changes. */
  time: number;
  /** Seconds since THIS entry last ran — already correct under striding. */
  delta: number;
  /** The object's own world position, for sampling the wind field. Reused; copy if you keep it. */
  position: THREE.Vector3;
  /** Distance to the camera, world units. */
  distance: number;
  /** 1 at full rate, 0.5 or 0.25 when strided. Fade an expensive flourish out with it. */
  detail: number;
}

interface Entry {
  token: object;
  anchor: React.RefObject<THREE.Object3D | null>;
  update: (frame: OutdoorFrame) => void;
  radius: number;
  cullDistance: number;
  /** Wind-clock time this entry last ran at, for the delta. */
  last: number;
  /** Fixed slot so entries in the same stride bucket land on different frames. */
  slot: number;
}

/**
 * ONE REGISTRY PER CANVAS, not one per game.
 *
 * This used to be a single module-level `entries` array with a single elected owner, and the
 * module note above justified it with an assumption that has since stopped being true:
 * 「everything that registers is an outdoor placeable, and outdoor placeables only ever render in
 * the island canvas」. The house interior mounts its own `<Canvas>` (BuildingInteriorView.tsx) and
 * registered nothing — so one array WAS one canvas, and the assumption held by accident.
 *
 * The object-interaction pass (Three/objectAnimation.tsx) is what ends that: it puts indoor
 * furniture in here too. With one shared array the two canvases' entries would be culled against
 * whichever camera happens to belong to the elected owner — walk into the house and every indoor
 * drawer is measured against the island camera standing outside the wall, so it either never
 * animates or always does. Neither is a crash, which is exactly why it would have been found late.
 *
 * Keying on the R3F store — one store per `<Canvas>`, by construction — makes the partition
 * structural rather than remembered. The owner election, the frame counter and the stride slots
 * are all per-registry for the same reason.
 */
interface Registry {
  entries: Entry[];
  owner: object | null;
  frameIndex: number;
  slotCounter: number;
}

const registries = new Map<object, Registry>();

function registryFor(store: object): Registry {
  let r = registries.get(store);
  if (!r) {
    r = { entries: [], owner: null, frameIndex: 0, slotCounter: 0 };
    registries.set(store, r);
  }
  return r;
}

/**
 * Inside this, an object always animates at full rate regardless of the frustum.
 *
 * The frustum test asks "is it on screen", and the honest answer for a shadow-caster is "not
 * necessarily the same as: does it matter". A palm just off the left edge of the screen still
 * throws a moving shadow across ground the player CAN see. Rather than reconstruct the shadow
 * camera's own frustum here, everything near the player is exempt — which is where the shadow
 * map has any resolution anyway.
 */
const FRUSTUM_EXEMPT_DISTANCE = 14;
const FULL_RATE_DISTANCE = 22;
const HALF_RATE_DISTANCE = 40;
const DEFAULT_CULL_DISTANCE = 70;

const _camPos = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _projScreen = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();
const _frame: OutdoorFrame = { time: 0, delta: 0, position: _pos, distance: 0, detail: 1 };

function runPass(reg: Registry, camera: THREE.Camera, delta: number): void {
  const time = advanceWindClock(delta);
  reg.frameIndex++;

  _camPos.setFromMatrixPosition(camera.matrixWorld);
  _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_projScreen);

  for (let i = 0; i < reg.entries.length; i++) {
    const e = reg.entries[i];
    const obj = e.anchor.current;
    if (!obj) continue;

    // Read the matrix rather than `getWorldPosition`, which walks and recomposes every ancestor
    // on every call. One frame of staleness is nothing to a cull test, and this is the only
    // per-object cost paid by an object that is about to be skipped.
    _pos.setFromMatrixPosition(obj.matrixWorld);
    const distance = _pos.distanceTo(_camPos);
    if (distance > e.cullDistance) continue;

    if (distance > FRUSTUM_EXEMPT_DISTANCE) {
      _sphere.center.copy(_pos);
      _sphere.radius = e.radius;
      if (!_frustum.intersectsSphere(_sphere)) continue;
    }

    const stride = distance < FULL_RATE_DISTANCE ? 1 : distance < HALF_RATE_DISTANCE ? 2 : 4;
    if (stride > 1 && (reg.frameIndex + e.slot) % stride !== 0) continue;

    _frame.time = time;
    _frame.delta = e.last === 0 ? delta : Math.min(0.25, time - e.last);
    _frame.distance = distance;
    _frame.detail = 1 / stride;
    e.last = time;
    e.update(_frame);
  }
}

export interface OutdoorAnimationOptions {
  /** Bounding radius for the frustum test, world units. Generous is cheap; mean is a pop. */
  radius?: number;
  /** Beyond this the object does not animate at all. */
  cullDistance?: number;
}

/**
 * Registers one animated object.
 *
 * `anchor` is whatever object's world position decides how important this animation is — for a
 * piece of furniture, the model's own root. `update` is called with {@link OutdoorFrame} at
 * whatever rate the cull decides, and must be a pure function of `frame.time` (see the module
 * note): if it integrates, culling will show.
 */
export function useOutdoorAnimation(
  anchor: React.RefObject<THREE.Object3D | null>,
  update: (frame: OutdoorFrame) => void,
  options: OutdoorAnimationOptions = {},
): void {
  const token = useRef<object>({}).current;
  const updateRef = useRef(update);
  updateRef.current = update;
  const { radius = 3, cullDistance = DEFAULT_CULL_DISTANCE } = options;
  // Which canvas this entry belongs to. `useStore` is R3F's own context read, so the audit
  // harness's stub dispatcher (scripts/lib/measureFurnitureModel.ts) answers it like every other
  // hook here — and a MODEL still never touches it, which is the rule that keeps these components
  // callable outside a renderer.
  const store = useStore() as unknown as object;

  useEffect(() => {
    const reg = registryFor(store);
    const entry: Entry = {
      token,
      anchor,
      update: (f) => updateRef.current(f),
      radius,
      cullDistance,
      last: 0,
      slot: reg.slotCounter++,
    };
    reg.entries.push(entry);
    if (reg.owner === null) reg.owner = token;
    return () => {
      const i = reg.entries.indexOf(entry);
      if (i >= 0) reg.entries.splice(i, 1);
      if (reg.owner === token) reg.owner = reg.entries.length > 0 ? reg.entries[0].token : null;
      // The last entry out closes the registry, so a house interior visited fifty times does not
      // leave fifty empty maps behind.
      if (reg.entries.length === 0) registries.delete(store);
    };
  }, [anchor, radius, cullDistance, token, store]);

  useFrame((state, delta) => {
    const reg = registries.get(store);
    if (!reg || reg.owner !== token) return;
    runPass(reg, state.camera, delta);
  });
}

/* ------------------------------------------------------------------ wind rigs */

/** A wind rig node, plus the rest pose the model's own geometry needs it to hold. */
export type WindRigNode = WindNodeSpec & {
  /** The node's own rotation with no wind — a trunk section's lean, a frond's droop. */
  /**
   * The pose the node holds with no wind — a trunk’s lean, a frond’s droop.
   *
   * Only X and Z are used. Yaw belongs to the model (see the write in the frame callback), so
   * a part that has to point somewhere states that with an ordinary `rotation={[0, a, 0]}` in
   * its own JSX and the rig will not touch it.
   */
  rest?: readonly [number, number, number];
};

export interface WindRigOptions extends OutdoorAnimationOptions {
  /**
   * Per-instance variation, from the placement's instance id.
   *
   * 「避免畫面中所有椰子樹像複製貼上一樣同時移動」 has FOUR independent answers, and this is
   * only one of them — the wind field itself is spatial, so two plants standing apart are already
   * reading different parts of the same gust. The seed adds the rest: a phase offset, a rate and
   * a gain, so two plants standing in the SAME place (the shop preview, a tight cluster) still
   * differ.
   */
  seed?: string | number;
  /** Scales every node's bend — a small palm should not sway as far as a big one. */
  gain?: number;
}

export interface WindRig<K extends string> {
  /** Attach to the group this node bends. Stable across renders. */
  ref: (key: K) => (o: THREE.Object3D | null) => void;
}

const ZERO_REST = [0, 0, 0] as const;
const _wind: WindSample = { sway: 0, cross: 0, gust: 0 };

/**
 * A chain of groups that bend in the wind, driven as ONE registry entry.
 *
 * The nodes are a plain object because that is what makes a plant readable at the call site:
 * `{ trunkA: …, trunkB: …, crown: …, frond0: … }` next to the JSX that uses them. One entry for
 * the whole plant matters — a palm has thirteen bending parts, and thirteen registry entries per
 * tree would put a grove of twenty back where it started.
 *
 * The key SET is read once. A model's rig is a fixed piece of its own structure, so a node table
 * that grew or shrank between renders would be a bug rather than a feature.
 */
export function useWindRig<K extends string>(
  anchor: React.RefObject<THREE.Object3D | null>,
  nodes: Record<K, WindRigNode>,
  options: WindRigOptions = {},
): WindRig<K> {
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const keys = useMemo(() => Object.keys(nodes) as K[], []);
  const targets = useRef<Partial<Record<K, THREE.Object3D | null>>>({});
  const setters = useRef<Partial<Record<K, (o: THREE.Object3D | null) => void>>>({});

  const ref = useCallback((key: K): ((o: THREE.Object3D | null) => void) => {
    const existing = setters.current[key];
    if (existing) return existing;
    const setter = (o: THREE.Object3D | null) => { targets.current[key] = o; };
    setters.current[key] = setter;
    return setter;
  }, []);

  const { seed, gain = 1, radius = 3, cullDistance } = options;
  // Three seeded constants, resolved once. `rate` is applied as a time-varying lag rather than by
  // scaling a clock: sampling the shared field at `(1 - rate) * t` seconds in the past IS running
  // at `rate` times its speed, and it keeps the whole system a pure function of one clock.
  const variation = useMemo(() => ({
    phase: seedRange(seed, 1, 0, 7),
    gain: seedRange(seed, 2, 0.82, 1.2) * gain,
    rate: seedRange(seed, 3, 0.86, 1.18),
  }), [seed, gain]);

  useOutdoorAnimation(anchor, (frame) => {
    const drift = variation.phase + (1 - variation.rate) * frame.time;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const node = targets.current[key];
      if (!node) continue;
      const spec = nodesRef.current[key];
      if (!spec) continue;

      sampleWind(frame.position.x, frame.position.z, (spec.lag ?? 0) + drift, _wind);
      const bend = spec.bend * variation.gain;
      const cross = bend * (spec.cross ?? 0);
      const rest = spec.rest ?? ZERO_REST;
      // Y IS THE MODEL’S, NOT THE RIG’S.
      //
      // Bending is a lean — it lives entirely in X and Z (`bend` and `cross` write nothing
      // else). Yaw is how a model LAYS ITS PARTS OUT: the eight blades of a 草叢, the four
      // fronds of a 蕨類, the four leaves of a 小型葉片植物 and the three tufts of a
      // 野生植物叢 are all one shape repeated at `rotation={[0, a, 0]}` around the stem.
      //
      // Writing the whole Euler triple used to overwrite that yaw with `rest[1]`, which is 0
      // for every node in the project — so on the first animated frame all eight blades, all
      // four fronds and all four leaves snapped to the SAME heading and stacked on top of one
      // another. The plants were drawing a quarter of the parts they were built from, and the
      // build-time audits could not see it: they measure the React tree, where the JSX rotation
      // is still there, so every count and every collider was right. Only the running game was
      // wrong, and it read as "these plants are sparse" rather than as a bug.
      //
      // Assigning the two axes the rig actually drives leaves yaw where the model put it. No
      // rig node in the project has ever declared a non-zero `rest[1]`, so nothing that was
      // working depends on the old behaviour.
      if (spec.axis === 'x') {
        node.rotation.x = rest[0] + _wind.sway * bend;
        node.rotation.z = rest[2] + _wind.cross * cross;
      } else {
        node.rotation.x = rest[0] + _wind.cross * cross;
        node.rotation.z = rest[2] + _wind.sway * bend;
      }
    }
  }, { radius, cullDistance });

  return { ref };
}

/**
 * A part the wind TURNS rather than bends — the mobile's arms, and any future windmill or vane.
 *
 * The angle comes from `windRotorAngle`, which is the gust envelope integrated in closed form, so
 * the rotor accelerates in a gust and coasts nearly to a stall in a lull while remaining a pure
 * function of time. `tilt` adds a small wobble on the two other axes so the thing reads as hung
 * rather than as bolted to a motor.
 */
export function useWindRotor(
  anchor: React.RefObject<THREE.Object3D | null>,
  target: React.RefObject<THREE.Object3D | null>,
  spec: WindRotorSpec,
  options: WindRigOptions & { tilt?: number } = {},
): void {
  const { seed, radius = 3, cullDistance, tilt = 0 } = options;
  const variation = useMemo(() => ({
    phase: seedRange(seed, 4, 0, 7),
    offset: seedRange(seed, 5, 0, Math.PI * 2),
  }), [seed]);
  const specRef = useRef(spec);
  specRef.current = spec;

  useOutdoorAnimation(anchor, (frame) => {
    const node = target.current;
    if (!node) return;
    const s = specRef.current;
    const angle = windRotorAngle(frame.position.x, frame.position.z, s.turnsPerSecond);
    node.rotation.y = variation.offset + angle * (s.direction ?? 1);
    if (tilt !== 0) {
      sampleWind(frame.position.x, frame.position.z, variation.phase, _wind);
      node.rotation.x = _wind.cross * tilt;
      node.rotation.z = _wind.sway * tilt;
    }
  }, { radius, cullDistance });
}

/* ------------------------------------------------------------------ occupancy */

/**
 * WHEN THE PLAYER GOT ON THIS PIECE, and when they got off.
 *
 * The sibling of the press-driven object reactions (Three/objectAnimation.tsx's
 * `useObjectAnimation`), and the reason it could not just be one of them: a press is an INSTANT
 * (the player pressed E and the telescope chimed), while an occupancy is an INTERVAL, and a swing
 * needs to know how long it has been ridden rather than how long ago it was poked.
 *
 * The timestamps travel ON the event rather than being sampled here, so the model and
 * Three/Avatar.tsx — which dispatches it — are working from the identical number rather than from
 * two `performance.now()` calls that happen to be close. That is what makes the seat and the body
 * exactly, not approximately, in step.
 */
export function useFurnitureOccupancy(instanceId: string | undefined): React.RefObject<SuspendedTimeline> {
  const timeline = useRef<SuspendedTimeline>({ mountedAt: null, releasedAt: null, rode: 0 });

  useEffect(() => {
    if (!instanceId) return;
    const onOccupy = (e: Event) => {
      const d = (e as CustomEvent<{ instanceId?: string; at?: number }>).detail;
      if (d?.instanceId !== instanceId) return;
      timeline.current.mountedAt = d.at ?? performance.now();
    };
    const onRelease = (e: Event) => {
      const d = (e as CustomEvent<{ instanceId?: string; at?: number }>).detail;
      if (d?.instanceId !== instanceId) return;
      const at = d.at ?? performance.now();
      if (timeline.current.mountedAt != null) {
        timeline.current.rode = (at - timeline.current.mountedAt) / 1000;
      }
      timeline.current.mountedAt = null;
      timeline.current.releasedAt = at;
    };
    window.addEventListener('furniture-occupy', onOccupy);
    window.addEventListener('furniture-release', onRelease);
    return () => {
      window.removeEventListener('furniture-occupy', onOccupy);
      window.removeEventListener('furniture-release', onRelease);
    };
  }, [instanceId]);

  return timeline;
}

/* ------------------------------------------------------------------ water */

/**
 * WATER, as three composable pieces rather than as one fountain.
 *
 * The brief asks for a fountain and rules out a fluid simulation, so what is left is the question
 * of what the CHEAPEST honest reading of falling water is. The answer these three settle on: a
 * viewer believes water when they can see where it comes from, where it goes, and that the
 * surface it lands on notices. Three components, one for each of those, and any future stream,
 * spout or pond gets them without a line of new animation code.
 *
 * Every mesh they draw declares `depthWrite={false}`, which is not only correct for stacked
 * translucent water — it is also the flag both the shipping collider (lib/collisionShape.ts) and
 * the quality audit (scripts/audit-outdoor-quality.ts) already use to tell "a drawn effect" from
 * "a part of the object". Water therefore cannot change where the player is allowed to stand, and
 * cannot inflate a model's structure score.
 */

const WATER_LIGHT = '#bae6fd';

export interface WaterJetProps {
  /** The nozzle mouth. */
  from: readonly [number, number, number];
  /** How far above the mouth the arc peaks. */
  rise: number;
  /** Radius the droplets land at, measured from the mouth. */
  spread: number;
  /** The height they land on — a bowl's water, the pool. */
  landY: number;
  /** Droplets in flight at once. Four reads as a jet; more is a cost with no picture behind it. */
  count?: number;
  /** Flights per second. */
  rate?: number;
  size?: number;
  color?: string;
}

/**
 * Water thrown up out of a nozzle and falling back into a bowl.
 *
 * The arc is a straight line from mouth to landing point plus a parabolic bump, rather than a
 * ballistic solve. A real projectile whose apex is where a garden fountain's looks would have to
 * be launched hard enough to overshoot the model entirely; stating the apex directly is both
 * cheaper and the only way to keep the water inside the piece — which is the brief's
 * 「水落點明顯不合理」 in reverse.
 */
export function WaterJet({
  from, rise, spread, landY, count = 4, rate = 1.1, size = 0.045, color = WATER_LIGHT,
}: WaterJetProps) {
  const groupRef = useRef<THREE.Group>(null);
  const drops = useRef<(THREE.Mesh | null)[]>([]);
  const seeds = useMemo(
    () => Array.from({ length: count }, (_, i) => ({
      azimuth: (i / count) * Math.PI * 2 + 0.4,
      offset: i / count,
    })),
    [count],
  );

  useOutdoorAnimation(groupRef, ({ time }) => {
    for (let i = 0; i < seeds.length; i++) {
      const mesh = drops.current[i];
      if (!mesh) continue;
      const s = seeds[i];
      const p = (time * rate + s.offset) % 1;
      const r = spread * p;
      // Linear fall from mouth to landing, plus a bump that peaks halfway. `4 * p * (1 - p)` is
      // the unit parabola through (0,0) and (1,0) with a maximum of 1 at the middle.
      const y = from[1] + (landY - from[1]) * p + rise * 4 * p * (1 - p);
      mesh.position.set(from[0] + Math.cos(s.azimuth) * r, y, from[2] + Math.sin(s.azimuth) * r);
      // Fades out as it lands rather than vanishing — 「避免水流突然消失」.
      const fade = p > 0.78 ? (1 - p) / 0.22 : 1;
      mesh.scale.setScalar(size * (0.7 + 0.3 * Math.sin(p * Math.PI)) * fade);
    }
  }, { radius: 2 });

  return (
    <group ref={groupRef}>
      {seeds.map((_, i) => (
        <mesh key={i} ref={(el) => { drops.current[i] = el; }}>
          <sphereGeometry args={[1, 6, 5]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.45}
            transparent
            opacity={0.75}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

export interface WaterFallsProps {
  /** Where each stream leaves its rim. */
  spouts: readonly (readonly [number, number, number])[];
  /** The height the streams land on. */
  landY: number;
  /** Radius of the splash ring at each landing point. */
  splash?: number;
  size?: number;
  rate?: number;
  color?: string;
}

/**
 * Streams running off a rim, and the rings they make where they land.
 *
 * One droplet per stream, not a column of them: the static tapered cylinder in the model already
 * IS the stream, and what a low-poly falling stream is missing is not more water, it is EVIDENCE
 * OF MOTION. A single bead running down it at a believable speed supplies that for one draw call.
 */
export function WaterFalls({
  spouts, landY, splash = 0.16, size = 0.05, rate = 0.85, color = WATER_LIGHT,
}: WaterFallsProps) {
  const groupRef = useRef<THREE.Group>(null);
  const drops = useRef<(THREE.Mesh | null)[]>([]);
  const rings = useRef<(THREE.Mesh | null)[]>([]);

  useOutdoorAnimation(groupRef, ({ time }) => {
    for (let i = 0; i < spouts.length; i++) {
      const s = spouts[i];
      const offset = i / spouts.length;
      const p = (time * rate + offset) % 1;

      const drop = drops.current[i];
      if (drop) {
        // Accelerating, because water does: `p * p` puts the bead slow at the lip and quick at
        // the pool, which is most of what reads as "falling" rather than "sliding".
        const fall = p * p;
        drop.position.set(s[0], s[1] + (landY - s[1]) * fall, s[2]);
        drop.scale.setScalar(size * (0.75 + fall * 0.45) * (p > 0.9 ? (1 - p) / 0.1 : 1));
      }

      const ring = rings.current[i];
      if (ring) {
        // The splash belongs to the bead that just landed, so it runs on the same phase shifted
        // by one flight — the ring opens exactly when a bead reaches the water.
        const rp = (p + 0.06) % 1;
        const grow = rp < 0.5 ? rp / 0.5 : 0;
        ring.scale.setScalar(0.0001 + splash * grow);
        const mat = ring.material as THREE.MeshStandardMaterial;
        mat.opacity = grow > 0 ? 0.5 * (1 - grow) : 0;
      }
    }
  }, { radius: 2.5 });

  return (
    <group ref={groupRef}>
      {spouts.map((s, i) => (
        <React.Fragment key={i}>
          <mesh ref={(el) => { drops.current[i] = el; }}>
            <sphereGeometry args={[1, 6, 5]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.4}
              transparent
              opacity={0.8}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[s[0], landY + 0.02, s[2]]} rotation={[-Math.PI / 2, 0, 0]} ref={(el) => { rings.current[i] = el; }}>
            <ringGeometry args={[0.62, 1, 12]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.5}
              transparent
              opacity={0}
              depthWrite={false}
            />
          </mesh>
        </React.Fragment>
      ))}
    </group>
  );
}

/** One still water surface a ripple opens on. */
export interface WaterSurface {
  /** Its centre, at the water's own height. */
  at: readonly [number, number, number];
  /** How far a ring opens before it fades — the surface's own radius, near enough. */
  radius: number;
}

export interface WaterRipplesProps {
  /**
   * Every surface this one entry animates.
   *
   * Per-surface radius rather than one shared number, so a fountain's pool and its upper bowl —
   * which differ by a factor of three — are ONE registry entry rather than two. A future pond
   * with a birdbath beside it is the same call.
   */
  surfaces: readonly WaterSurface[];
  /** Rings in flight per surface. */
  count?: number;
  rate?: number;
  color?: string;
}

/** Rings opening and fading on a still surface — the 「水面有輕微動態效果」 half of the brief. */
export function WaterRipples({
  surfaces, count = 2, rate = 0.32, color = WATER_LIGHT,
}: WaterRipplesProps) {
  const groupRef = useRef<THREE.Group>(null);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  // Flattened once so the per-frame loop is a straight walk rather than two nested ones.
  const plan = useMemo(
    () => surfaces.flatMap((s, si) => Array.from({ length: count }, (_, ci) => ({
      at: s.at, radius: s.radius, phase: (ci / count) + si * 0.37,
    }))),
    [surfaces, count],
  );

  useOutdoorAnimation(groupRef, ({ time }) => {
    for (let i = 0; i < plan.length; i++) {
      const mesh = rings.current[i];
      if (!mesh) continue;
      const p = (time * rate + plan[i].phase) % 1;
      mesh.scale.setScalar(0.0001 + plan[i].radius * p);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      // Opens from nothing and fades to nothing, so a ring never appears or disappears with an
      // edge — the same reason the jet's droplets fade rather than being switched off.
      mat.opacity = 0.34 * Math.sin(p * Math.PI) * (1 - p * 0.4);
    }
  }, { radius: 2.5 });

  return (
    <group ref={groupRef}>
      {plan.map((r, index) => (
        <mesh
          key={index}
          position={[r.at[0], r.at[1] + 0.012, r.at[2]]}
          rotation={[-Math.PI / 2, 0, 0]}
          ref={(el) => { rings.current[index] = el; }}
        >
          <ringGeometry args={[0.78, 1, 16]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.4}
            transparent
            opacity={0}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

export { windClock };
