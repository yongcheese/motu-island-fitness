/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE OBJECT-REACTION RUNTIME — one hook a model calls, and the shared effects it can mount.
 *
 * ## What a model has to do to react to being used
 *
 * Two lines. A wardrobe:
 *
 *     const anim = useObjectAnimation(instanceId, item);
 *     …
 *     <group ref={anim.root} scale={scale}>
 *       <group position={[-0.71, 1.25, 0.38]} ref={anim.ref('doorLeft')}> … </group>
 *
 * Everything else — when the door starts moving relative to the player's own animation, how far it
 * swings, whether it stays open, how it eases, what it sounds like, when it stops being asked —
 * is the row in constants/objectAnimations.ts. There is no `useFrame` in the model, no timer, no
 * boost to lerp and no magic number. That is the entire point: adding a reaction to the next piece
 * of furniture must not mean writing another animation loop, because writing another animation
 * loop is what produced five bespoke ones and thirty-eight inert objects.
 *
 * ## How it rides the existing pass
 *
 * One registration in Three/outdoorAnimation.tsx's culled loop per PIECE, not per part — a
 * wardrobe with two doors and a hob with two knobs are one entry each. The loop already gives
 * distance culling, frustum culling and a stride ladder, and the reason those are safe here is the
 * same reason they are safe for the wind: lib/objectAnimation.ts is a pure function of the clock,
 * so a culled object is not paused, it is un-asked, and it is at exactly the right pose on the
 * frame it returns.
 *
 * §11 gets a second, stronger answer on top of that: a piece at rest with nothing armed
 * `unregisters` itself. An unlit hob, a shut fridge and an empty sofa are not slow — they are not
 * running at all, and the frame they are used they come back.
 */

import React, { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import {
  DEFAULT_OBJECT_CUE,
  ObjectAnimationSpec,
  ObjectPartSpec,
  ObjectSoundId,
  getObjectAnimation,
} from '../../constants/objectAnimations';
import { getPrimaryInteraction, interactionPosture } from '../../constants/furnitureInteractions';
import { getPosture } from '../../constants/interactionPostures';
import {
  IDLE_TIMELINE,
  objectCycleDone,
  objectIsSettled,
  objectOpen,
  partValue,
  resolveLaunchHeading,
  sampleLaunchSpread,
  selfClosing,
} from '../../lib/objectAnimation';
import {
  armObject,
  cancelPendingObject,
  flushObjectEdges,
  objectHasPendingEdge,
  objectIsOn,
  objectTimeline,
  releaseObject,
  retireObject,
  subscribeObjectState,
} from '../../lib/objectRuntimeState';
import {
  playApplianceClick,
  playBirdChirp,
  playCampfireCrackle,
  playCushionSettle,
  playDoorClose,
  playDoorOpen,
  playDrawerSlide,
  playFurnitureCreak,
  playGasIgnite,
  playGasOff,
  playMicrowaveDing,
  playTelescopeChime,
  playWaterRun,
  playWellSplash,
} from '../../lib/soundUtils';
import { useOutdoorAnimation } from './outdoorAnimation';

/* ------------------------------------------------------------------ sound dispatch */

const SOUNDS: Record<ObjectSoundId, (on: boolean) => void> = {
  door: (on) => (on ? playDoorOpen(0.26) : playDoorClose(0.22)),
  drawer: () => playDrawerSlide(0.24),
  ignite: () => playGasIgnite(0.3),
  extinguish: () => playGasOff(0.24),
  water: () => playWaterRun(0.26),
  appliance: () => playApplianceClick(0.24),
  chime: () => playMicrowaveDing(0.26),
  creak: () => playFurnitureCreak(0.2),
  // Settling in is the event; getting up is barely one. Same material, a third of the weight.
  cushion: (on) => playCushionSettle(on, on ? 0.22 : 0.12),
  crackle: () => playCampfireCrackle(0.3),
  twinkle: () => playTelescopeChime(0.26),
  chirp: () => playBirdChirp(0.28),
  splash: () => playWellSplash(0.3),
};

/* ------------------------------------------------------------------ the hook */

/** What a model gets back. Every member is stable across renders. */
export interface ObjectAnimation {
  /** Attach to the model's own root group — the anchor the cull is measured against. */
  root: React.RefObject<THREE.Group | null>;
  /**
   * Attach to the group a named part moves. Unknown names are inert.
   *
   * `slot` is for the common case where ONE named part is several groups — a sofa with two seat
   * cushions, a hob with two knobs, a bed whose mattress is in sections. Pass the map index and
   * they all move together off one row in the catalog, which is the right level of description:
   * 「the cushions compress」 is one fact about the sofa, not two.
   */
  ref: (part: string, slot?: number) => (o: THREE.Object3D | null) => void;
  /**
   * Whether the piece is logically ON, as a React value.
   *
   * Separate from the per-frame signal on purpose: a flame, a jet of water and a lit panel are
   * MESHES, and meshes have to be mounted and unmounted, which cannot happen inside a frame
   * callback. Gate effects on this and the shut-off case costs nothing at all — an unlit hob does
   * not render a flame it then hides, it renders no flame.
   */
  active: boolean;
  /**
   * The piece's eased 0..1 state signal RIGHT NOW — the same number every `open`-driven part is
   * written from. Call it inside a frame callback, never during render.
   *
   * For the reactions no transform can express but that are still a matter of DEGREE: a fire
   * flaring and settling, a lens catching the light, a lamp warming up. `active` answers 「should
   * the flame meshes exist」; this answers 「how bright is the flame this frame」. Reading the
   * shared timeline rather than keeping a private boost is what stops a model growing its own
   * trigger timestamp and lerp — the shape the four outdoor pieces had before they moved here.
   *
   * Pure function of the clock, like everything else, so it is correct on the first frame a culled
   * piece comes back on screen.
   */
  level: () => number;
  /**
   * When the current ON state landed, `performance.now()` ms — or null while the piece is off.
   *
   * A React value, and it changes on a repeat press as well as on the first one (a `run` piece
   * pressed again mid-cycle re-stamps its start). That is what one-shot effects key on:
   * `{anim.since != null && <ObjectBurst key={anim.since} since={anim.since} … />}` plays once
   * per landed press, from the object's own clock, and never stacks two copies of itself.
   */
  since: number | null;
}

/** A part's pose before anything drove it — whatever its JSX asked for. */
interface Rest {
  rotation: THREE.Euler;
  position: THREE.Vector3;
  scale: THREE.Vector3;
}

const INERT_REF = () => {};

/** One attached group and the pose its JSX put it in. */
interface Slot {
  node: THREE.Object3D;
  rest: Rest | null;
}

/**
 * What the player's press carries about the player — the other half of a dynamic direction.
 *
 * Optional on the event, and every field optional in turn, because the interaction event has
 * three senders (the E key, the on-screen prompt, the mobile action button) and one of them
 * could always be added without this one. A press with no context resolves no aim, which leaves
 * the piece's LAST heading in place rather than snapping it to a constant — see `resolveAim`.
 */
interface InteractDetail {
  instanceId?: string;
  player?: { x: number; z: number; yaw: number };
}

/** Scratch for the world-space reads below. Module-level: this runs on a key press, not a frame. */
const AIM_POS = new THREE.Vector3();
const AIM_QUAT = new THREE.Quaternion();
const AIM_FWD = new THREE.Vector3();

/**
 * WHICH WAY THIS THROW GOES, in the launch group's own parent frame — the one place the player's
 * context and the scene graph meet.
 *
 * Two conversions, and both have to happen HERE rather than in the pure resolver:
 *
 *   the PIECE'S position   the heading is measured player → piece, and where the piece is is a
 *                          world-space fact only the scene graph has (a placement on a deck, a
 *                          model whose root is offset from its own origin).
 *   the PARENT'S yaw       the value written is a LOCAL rotation, so the world heading has to
 *                          have the yaw of everything above the launch group taken back out —
 *                          which is what makes a frisbee dropped at any rotation, on a deck at
 *                          any rotation, still fly where it was thrown.
 *
 * Returns undefined when there is nothing to resolve — no launch spec, no player on the event,
 * or a model that has not attached the group yet. `armObject` then leaves the previous heading
 * alone, which is the honest answer: the alternative is inventing a direction, and inventing a
 * direction is the bug.
 */
function resolveAim(
  e: Event,
  spec: ObjectAnimationSpec,
  root: React.RefObject<THREE.Group | null>,
  targets: React.RefObject<Record<string, (Slot | null)[]>>,
): number | undefined {
  const launch = spec.launch;
  if (!launch) return undefined;
  const player = (e as CustomEvent<InteractDetail>).detail?.player;
  if (!player) return undefined;
  const node = targets.current?.[launch.part]?.[0]?.node;
  const anchor = root.current;
  if (!node || !anchor) return undefined;

  anchor.getWorldPosition(AIM_POS);
  const heading = resolveLaunchHeading(launch, {
    playerX: player.x,
    playerZ: player.z,
    playerYaw: player.yaw,
    objectX: AIM_POS.x,
    objectZ: AIM_POS.z,
  }, sampleLaunchSpread(launch));

  // The parent's own heading, read off its world quaternion rather than assumed — the launch
  // group hangs under the model's root, which hangs under the placement, which may hang under a
  // deck. Turning its +Z into world and taking the yaw of that is the only reading that survives
  // all three.
  const parent = node.parent;
  if (!parent) return heading;
  parent.getWorldQuaternion(AIM_QUAT);
  AIM_FWD.set(0, 0, 1).applyQuaternion(AIM_QUAT);
  return heading - Math.atan2(AIM_FWD.x, AIM_FWD.z);
}

/**
 * WIRES ONE PLACED PIECE TO ITS ROW in constants/objectAnimations.ts.
 *
 * `item` is the catalog entry (it carries the model id and the interaction, which is where the
 * cue's posture duration comes from). `instanceId` is which placed copy this is — matched against
 * the events, so putting two wardrobes side by side and opening one leaves the other shut.
 *
 * A piece whose model has no row, or which is rendered without an instance id (the drag ghost, the
 * shop's 3D preview, the build-time audits), gets an inert object back and registers nothing.
 */
export function useObjectAnimation(
  instanceId: string | undefined,
  item: { id?: string; model?: string } | undefined,
  /**
   * The model's own root group, when it already has one.
   *
   * A handful of pieces (the tent, the fountain) were animated before this system existed and
   * keep a root ref for their wind rig or their water. They must NOT grow a second root group:
   * the anchor is what the cull is measured against, and a piece whose anchor never attaches is a
   * piece that silently never animates — the exact failure this parameter exists to make
   * impossible to write by accident.
   */
  anchor?: React.RefObject<THREE.Group | null>,
): ObjectAnimation {
  const ownRoot = useRef<THREE.Group>(null);
  const root = anchor ?? ownRoot;
  const spec = getObjectAnimation(item?.model);

  const targets = useRef<Record<string, (Slot | null)[]>>({});
  const setters = useRef<Record<string, (o: THREE.Object3D | null) => void>>({});
  // Which way the sound has already been played, so an edge fires its cue exactly once.
  const soundedOn = useRef<boolean | null>(null);

  const ref = useCallback((part: string, slot = 0) => {
    const key = `${part}:${slot}`;
    const existing = setters.current[key];
    if (existing) return existing;
    const setter = (o: THREE.Object3D | null) => {
      const list = targets.current[part] ?? (targets.current[part] = []);
      // The rest pose is captured on the FIRST update rather than here, so it is read after R3F
      // has applied the JSX props rather than racing them.
      list[slot] = o ? { node: o, rest: null } : null;
    };
    setters.current[key] = setter;
    return setter;
  }, []);

  /**
   * How long after the press the object answers, seconds.
   *
   * The player's posture states its own duration, and the row states a FRACTION of it, so
   * 「the hand reaches the handle」 stays true if a posture is later retimed. An occupying posture
   * has no duration and needs no cue: the give in a cushion is eased over the same interval as the
   * body's descent, which the controller already owns.
   */
  const cueSeconds = useMemo(() => {
    if (!spec || spec.behaviour === 'occupied' || !item?.id) return 0;
    const interaction = getPrimaryInteraction(item.id);
    if (!interaction) return 0;
    const posture = getPosture(interactionPosture(interaction));
    return (posture.duration ?? 0) * (spec.cue ?? DEFAULT_OBJECT_CUE);
  }, [spec, item?.id]);

  // ---- events -------------------------------------------------------------
  useEffect(() => {
    if (!instanceId || !spec) return;

    const mine = (e: Event) =>
      (e as CustomEvent<{ instanceId?: string }>).detail?.instanceId === instanceId;

    const onInteract = (e: Event) => {
      if (!mine(e)) return;
      // What the press means depends on the behaviour and on nothing else — the model never sees
      // this, and no piece is named anywhere in it.
      const next = spec.behaviour === 'toggle' || spec.behaviour === 'latch'
        ? !objectIsOn(instanceId)
        : true;
      armObject(instanceId, cueSeconds, next, resolveAim(e, spec, root, targets));
    };
    const onOccupy = (e: Event) => {
      if (!mine(e) || spec.behaviour !== 'occupied') return;
      armObject(instanceId, 0, true);
    };
    const onRelease = (e: Event) => {
      if (!mine(e) || spec.behaviour !== 'occupied') return;
      releaseObject(instanceId);
    };
    /*
     * THE PLAYER WALKED OFF BEFORE THEIR HAND GOT THERE.
     *
     * Avatar.tsx sends this whenever an acting posture is abandoned — a movement key, the
     * joystick, an emote, leaving the view. What it may undo is deliberately narrow: only the
     * edge that is still waiting on its cue (see cancelPendingObject). A press that has already
     * landed stands, so a player who opens the fridge and walks away mid-hold still sees it
     * shut on its own clock rather than snap closed.
     */
    const onCancel = (e: Event) => {
      if (!mine(e)) return;
      cancelPendingObject(instanceId);
    };

    window.addEventListener('furniture-interact', onInteract);
    window.addEventListener('furniture-occupy', onOccupy);
    window.addEventListener('furniture-release', onRelease);
    window.addEventListener('furniture-cancel', onCancel);
    return () => {
      window.removeEventListener('furniture-interact', onInteract);
      window.removeEventListener('furniture-occupy', onOccupy);
      window.removeEventListener('furniture-release', onRelease);
      window.removeEventListener('furniture-cancel', onCancel);
      /*
       * THE CLEANUP, and it is one line because there is nothing else to clean.
       *
       * A piece unmounts for four reasons — deleted in build mode, the view changed, the island
       * reloaded, the player walked into the house — and every one of them should leave nothing
       * behind. There is no timer to cancel and no tween to stop (lib/objectAnimation.ts is a pure
       * function of the clock), so releasing the state is the whole of it.
       *
       * The one case this deliberately does NOT release is a `toggle`: a hob you lit before
       * walking outside should still be lit when you come back, and its model unmounting is not
       * the player turning it off. That is the only asymmetry, and it is the reason `toggle` is
       * spelt out as its own behaviour rather than being a latch that happens to persist.
       */
      if (spec.behaviour !== 'toggle') releaseObject(instanceId);
    };
  }, [instanceId, spec, cueSeconds]);

  // ---- the React-visible state -------------------------------------------
  const active = useSyncExternalStore(
    subscribeObjectState,
    () => objectIsOn(instanceId),
    () => false,
  );

  // ---- the frame ----------------------------------------------------------
  /**
   * `live` is what keeps a settled piece out of the animation loop entirely.
   *
   * §11 asks that 「靜止狀態的物件不應持續進行不必要的 Animation Update」, and the strong reading of
   * that is not 「return early」 — it is 「do not be in the list」. An unlit hob, a shut fridge and
   * an empty sofa hold no registry entry, so an island with two hundred placeables does not pay
   * two hundred distance tests a frame to discover that nothing is happening.
   *
   * It is deliberately ASYMMETRIC, and that is the whole subtlety: waking is a state fact (the
   * store says this piece is on, or has an edge armed) while sleeping is a TIME fact (its closing
   * animation has finished), which only the frame callback can know. So the subscription only ever
   * turns it on, and the update turns it off.
   */
  const [live, setLive] = React.useState(false);
  useEffect(() => {
    if (!instanceId || !spec) return;
    const check = () => {
      if (objectIsOn(instanceId) || objectHasPendingEdge(instanceId)) setLive(true);
    };
    check();
    return subscribeObjectState(check);
  }, [instanceId, spec]);
  const sleep = useCallback(() => setLive(false), []);

  useObjectFrame(root, instanceId, spec, live || active, targets, soundedOn, sleep);

  const level = useCallback(() => {
    if (!spec || !instanceId) return 0;
    const now = performance.now();
    // Flushed here as well as in the frame pass, because a model's own ambient loop may run
    // before this piece's entry does in the same frame — and a flare that starts a frame late
    // reads as the fire ignoring the log that was just put on it.
    flushObjectEdges(now);
    return objectOpen(spec, objectTimeline(instanceId), now);
  }, [spec, instanceId]);

  // A primitive snapshot, so React only re-renders when the ON edge actually lands or re-stamps —
  // not when the timeline's other fields move.
  const since = useSyncExternalStore(
    subscribeObjectState,
    () => (instanceId && spec ? objectTimeline(instanceId).onAt : null),
    () => null,
  );

  return useMemo(
    () => ({ root, ref: spec ? ref : () => INERT_REF, active, level, since }),
    [ref, spec, active, level, since],
  );
}

/**
 * The per-piece update. Split out so the hook above reads as wiring rather than as maths, and so
 * the registration's `enabled` flag is visible in one place.
 */
function useObjectFrame(
  root: React.RefObject<THREE.Group | null>,
  instanceId: string | undefined,
  spec: ObjectAnimationSpec | null,
  live: boolean,
  targets: React.RefObject<Record<string, (Slot | null)[]>>,
  soundedOn: React.RefObject<boolean | null>,
  sleep: () => void,
): void {
  const partList = useMemo(
    () => (spec?.parts ? Object.entries(spec.parts) as [string, ObjectPartSpec][] : []),
    [spec],
  );

  const update = useCallback(({ time }: { time: number }) => {
    if (!spec || !instanceId) return;
    const now = performance.now();
    flushObjectEdges(now);

    const tl = objectTimeline(instanceId) ?? IDLE_TIMELINE;
    const open = objectOpen(spec, tl, now);

    // The cue's own sound, at the state edge rather than at the key press — the door is heard
    // when it moves, which is the audible half of the sync.
    const on = tl.onAt != null;
    if (soundedOn.current !== on) {
      if (soundedOn.current !== null || on) {
        const id = on ? spec.sound?.on : spec.sound?.off;
        if (id) SOUNDS[id](on);
      }
      soundedOn.current = on;
    }

    for (let i = 0; i < partList.length; i++) {
      const [name, part] = partList[i];
      const slots = targets.current?.[name];
      if (!slots) continue;
      const value = partValue(part, open, time, tl, now);

      for (let s = 0; s < slots.length; s++) {
        const slot = slots[s];
        if (!slot) continue;
        const node = slot.node;
        if (!slot.rest) {
          // Captured on the first frame this part is driven, so it is the pose the JSX asked for
          // rather than whatever a ref callback happened to see mid-attach. It is also what the
          // build-time measurement sees (scripts/lib/measureFurnitureModel.ts never runs this),
          // so a piece's collider is always its REST shape — an open wardrobe door is not a wall.
          slot.rest = {
            rotation: node.rotation.clone(),
            position: node.position.clone(),
            scale: node.scale.clone(),
          };
        }
        const rest = slot.rest;
        switch (part.motion) {
          case 'hinge':
            node.rotation[part.axis] = rest.rotation[part.axis] + value;
            break;
          case 'slide':
            node.position[part.axis] = rest.position[part.axis] + value;
            break;
          default:
            node.scale[part.axis] = rest.scale[part.axis] * (1 + value);
            break;
        }
      }
    }

    /*
     * THE HEADING, written onto the one group that carries the flight.
     *
     * Every frame this piece is live rather than once at the press, and deliberately: the group
     * may attach after the press (a piece that scrolls into view mid-flight), and the write is
     * one assignment. It is NOT eased — a throw's direction is decided before the disc leaves
     * the hand and must not still be turning during the flight — and it is not cleared when the
     * flight ends, so a disc that came back lies where it was last thrown, which is where a
     * frisbee ends up.
     *
     * The rest pose carries whatever the JSX asked for, exactly as the parts above do, so a
     * model may still author a tilt on its aim group.
     */
    const launch = spec.launch;
    if (launch && tl.aim != null) {
      const slot = targets.current?.[launch.part]?.[0];
      if (slot) {
        if (!slot.rest) {
          slot.rest = {
            rotation: slot.node.rotation.clone(),
            position: slot.node.position.clone(),
            scale: slot.node.scale.clone(),
          };
        }
        slot.node.rotation.y = slot.rest.rotation.y + tl.aim;
      }
    }

    // A self-closing piece that has finished its own arc forgets it was ever on — so the fridge
    // that shut itself is indistinguishable from one that was never opened.
    if (selfClosing(spec) && objectCycleDone(spec, tl, now)) retireObject(instanceId);
    // Back at rest with nothing pending: leave the loop. See `live` above for why this is the
    // half of the decision only a frame can make.
    else if (objectIsSettled(spec, tl, now, open) && !objectHasPendingEdge(instanceId)) sleep();
  }, [spec, instanceId, partList, targets, soundedOn, sleep]);

  // The registration itself. `useOutdoorAnimation` always runs a hook (rules of hooks), so the
  // gating is inside: a piece that is not live is handed an update that returns immediately, and
  // more importantly its anchor test is the only cost it pays.
  const gated = useCallback((frame: { time: number }) => {
    if (!live) return;
    update(frame);
  }, [live, update]);

  useOutdoorAnimation(root, gated, { radius: 2.4, cullDistance: 46 });
}

/* ================================================================== shared effects
 *
 * The pieces of an object's reaction that no transform can express: fire, running water, steam,
 * a panel lighting up. Written as components rather than as a `ParticleSpec` row in the catalog
 * because each has real geometry and a real palette, and a table of numbers describing a flame is
 * a worse thing to read than a flame.
 *
 * Every one of them:
 *   - is MOUNTED BY STATE, so an object that is off costs nothing at all — no meshes, no registry
 *     entry, no update. This is the strongest form of §11's requirement.
 *   - declares `depthWrite={false}`, which is the flag lib/collisionShape.ts and
 *     scripts/audit-outdoor-quality.ts already use to tell 「a drawn effect」 from 「a part of the
 *     object」. An effect can therefore never change where the player may stand, and never
 *     inflates a model's structure score.
 *   - is a pure function of the shared clock, so it culls like everything else.
 */

const FLAME_CORE = '#fff2c4';
const FLAME_MID = '#ffb43d';
const FLAME_EDGE = '#ff7a2f';

export interface BurnerFlamesProps {
  /** Burner centres in the model's own frame — the same numbers its burner meshes use. */
  at: readonly (readonly [number, number, number])[];
  /** Flame height. */
  height?: number;
  /** Ring the flames stand on. */
  radius?: number;
  /** Tongues per burner. Six reads as a gas ring; more is cost with no picture behind it. */
  count?: number;
}

/**
 * A GAS RING, as tongues of flame standing on the burner's own circle.
 *
 * The brief's requirement is negative and specific — 「不要火焰漂浮在空中或從整個瓦斯爐中央冒出」
 * — and the shape that satisfies it is not a better particle system, it is taking the positions
 * from the burner meshes. `at` is the same array the model uses to draw its burners, so the flames
 * cannot be anywhere else, and a redrawn hob moves both together.
 *
 * Low-poly on purpose: four-sided cones, flat emissive colours, a triangle wave for the flicker.
 * A soft additive sprite flame would be the wrong game.
 */
export function BurnerFlames({ at, height = 0.16, radius = 0.115, count = 6 }: BurnerFlamesProps) {
  const groupRef = useRef<THREE.Group>(null);
  const tongues = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);

  const plan = useMemo(
    () => at.flatMap((centre, b) => Array.from({ length: count }, (_, i) => ({
      centre,
      angle: (i / count) * Math.PI * 2 + b * 0.4,
      // A per-tongue offset, so a ring never pulses as one block.
      phase: (i * 0.37 + b * 0.61) % 1,
      rate: 5.5 + (i % 3) * 1.4,
    }))),
    [at, count],
  );

  useOutdoorAnimation(groupRef, ({ time }) => {
    for (let i = 0; i < plan.length; i++) {
      const mesh = tongues.current[i];
      if (!mesh) continue;
      const p = plan[i];
      // Two incommensurate sines: the ring never repeats visibly, and it stays a pure function
      // of one clock.
      const flick = 0.62 + Math.sin(time * p.rate + p.phase * 7) * 0.2
        + Math.sin(time * p.rate * 2.7 + p.phase * 3) * 0.1;
      mesh.position.set(
        p.centre[0] + Math.cos(p.angle) * radius,
        p.centre[1] + height * flick * 0.5,
        p.centre[2] + Math.sin(p.angle) * radius,
      );
      mesh.scale.set(0.85 + flick * 0.2, flick, 0.85 + flick * 0.2);
      // Lean outward and wander, so the ring reads as gas rather than as spikes.
      mesh.rotation.set(
        Math.sin(p.angle) * 0.24,
        -p.angle,
        -Math.cos(p.angle) * 0.24 + Math.sin(time * 3 + p.phase * 6) * 0.06,
      );
    }
    if (lightRef.current) {
      lightRef.current.intensity = 0.55 + Math.sin(time * 11) * 0.09 + Math.sin(time * 26) * 0.04;
    }
  }, { radius: 1.4, cullDistance: 30 });

  const centre = at[0] ?? [0, 0, 0];

  return (
    <group ref={groupRef}>
      {plan.map((p, i) => (
        <mesh key={i} ref={(el) => { tongues.current[i] = el; }}>
          <coneGeometry args={[0.036, height, 4]} />
          {/* Mostly orange, with one pale tongue in six rather than one in three: a gas ring
              read at a distance is warm, and a majority of near-white cones washes out to a
              cold light on a dark hob. */}
          <meshStandardMaterial
            color={i % 6 === 0 ? FLAME_CORE : i % 2 === 0 ? FLAME_MID : FLAME_EDGE}
            emissive={i % 6 === 0 ? FLAME_MID : FLAME_EDGE}
            emissiveIntensity={1.5}
            transparent
            opacity={0.82}
            depthWrite={false}
          />
        </mesh>
      ))}
      {/* The blue base ring every gas burner has — flat, and only drawn while it is lit. */}
      {at.map((c, i) => (
        <mesh key={`base-${i}`} position={[c[0], c[1] + 0.006, c[2]]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius * 0.72, radius * 1.06, 14]} />
          {/* Blue, and it has to STAY blue: at the 2.4 emissive this started at, the ring blew
              out to white and read as a fluorescent tube rather than as the base of a gas flame. */}
          <meshStandardMaterial
            color="#38bdf8"
            emissive="#0ea5e9"
            emissiveIntensity={0.9}
            transparent
            opacity={0.7}
            depthWrite={false}
          />
        </mesh>
      ))}
      <pointLight
        ref={lightRef}
        position={[centre[0], centre[1] + 0.3, centre[2]]}
        color="#ffa64d"
        intensity={0.4}
        distance={1.5}
      />
    </group>
  );
}

export interface WaterStreamProps {
  /** The spout mouth, in the model's own frame. */
  from: readonly [number, number, number];
  /** The surface it lands on. */
  landY: number;
  /** Stream radius. */
  width?: number;
  /** Beads falling at once — the evidence of motion, over and above the column itself. */
  count?: number;
  color?: string;
}

/**
 * A TAP RUNNING: a column, beads accelerating down it, and a ring where it lands.
 *
 * The same three-part reading as the fountain's water (Three/outdoorAnimation.tsx's `WaterFalls`)
 * and for the same reason — a viewer believes water when they can see where it comes from, where
 * it goes, and that the surface notices — but as one component with a straight vertical drop,
 * because a tap is not a rim and reusing `WaterFalls` here would mean passing it a one-element
 * array and a fake spout.
 */
export function WaterStream({
  from, landY, width = 0.016, count = 3, color = '#bae6fd',
}: WaterStreamProps) {
  const groupRef = useRef<THREE.Group>(null);
  const beads = useRef<(THREE.Mesh | null)[]>([]);
  const ringRef = useRef<THREE.Mesh>(null);
  const drop = Math.max(0.02, from[1] - landY);

  useOutdoorAnimation(groupRef, ({ time }) => {
    for (let i = 0; i < count; i++) {
      const bead = beads.current[i];
      if (!bead) continue;
      const p = (time * 1.6 + i / count) % 1;
      // Accelerating: `p * p` is slow at the spout and quick at the basin, which is most of what
      // reads as falling rather than sliding.
      bead.position.set(from[0], from[1] - drop * p * p, from[2]);
      bead.scale.setScalar(width * (1.1 + p * 0.5));
    }
    const ring = ringRef.current;
    if (ring) {
      const p = (time * 1.6 + 0.1) % 1;
      const grow = p < 0.55 ? p / 0.55 : 0;
      ring.scale.setScalar(0.0001 + 0.09 * grow);
      (ring.material as THREE.MeshStandardMaterial).opacity = grow > 0 ? 0.55 * (1 - grow) : 0;
    }
  }, { radius: 1.2, cullDistance: 26 });

  return (
    <group ref={groupRef}>
      {/* The column. Slightly wider at the bottom, like a real falling stream. */}
      <mesh position={[from[0], from[1] - drop / 2, from[2]]}>
        <cylinderGeometry args={[width * 0.72, width, drop, 6]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.35}
          transparent
          opacity={0.55}
          depthWrite={false}
        />
      </mesh>
      {Array.from({ length: count }, (_, i) => (
        <mesh key={i} ref={(el) => { beads.current[i] = el; }}>
          <sphereGeometry args={[1, 6, 5]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.5}
            transparent
            opacity={0.8}
            depthWrite={false}
          />
        </mesh>
      ))}
      <mesh
        position={[from[0], landY + 0.008, from[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
        ref={ringRef}
      >
        <ringGeometry args={[0.6, 1, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.5}
          transparent
          opacity={0}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export interface SteamWispsProps {
  at: readonly [number, number, number];
  /** How far a wisp rises before it fades out. */
  rise?: number;
  /** How far it drifts sideways over that rise. */
  spread?: number;
  count?: number;
  size?: number;
  color?: string;
}

/** Steam off hot water or a hot oven — soft, slow, and gone by the top of its own rise. */
export function SteamWisps({
  at, rise = 0.55, spread = 0.22, count = 5, size = 0.032, color = '#eef7fb',
}: SteamWispsProps) {
  const groupRef = useRef<THREE.Group>(null);
  const puffs = useRef<(THREE.Mesh | null)[]>([]);
  const seeds = useMemo(
    () => Array.from({ length: count }, (_, i) => ({
      offset: i / count,
      angle: (i * 2.4) % (Math.PI * 2),
      rate: 0.24 + (i % 3) * 0.05,
    })),
    [count],
  );

  useOutdoorAnimation(groupRef, ({ time }) => {
    for (let i = 0; i < seeds.length; i++) {
      const mesh = puffs.current[i];
      if (!mesh) continue;
      const s = seeds[i];
      const p = (time * s.rate + s.offset) % 1;
      const wander = Math.sin(time * 0.9 + s.angle) * spread * p;
      mesh.position.set(at[0] + wander, at[1] + rise * p, at[2] + Math.cos(s.angle) * spread * p * 0.6);
      mesh.scale.setScalar(size * (0.6 + p * 1.4));
      // In from nothing and out to nothing: a puff never appears or vanishes with an edge.
      (mesh.material as THREE.MeshStandardMaterial).opacity = 0.26 * Math.sin(p * Math.PI);
    }
  }, { radius: 1.4, cullDistance: 26 });

  return (
    <group ref={groupRef}>
      {seeds.map((_, i) => (
        <mesh key={i} ref={(el) => { puffs.current[i] = el; }}>
          <sphereGeometry args={[1, 6, 5]} />
          {/* Emissive, not lit. A diffuse sphere in this lighting comes back as a grey pebble
              hanging in the air; steam has to make its own light or it is a rock. */}
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.65}
            transparent
            opacity={0}
            roughness={1}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

export interface GlowPanelProps {
  position: readonly [number, number, number];
  /** Width and height of the lit face. */
  size: readonly [number, number];
  rotation?: readonly [number, number, number];
  color?: string;
  intensity?: number;
  /** Adds a light of its own — for an interior that should spill onto the room. */
  cast?: number;
}

/**
 * A LIT INTERIOR — a fridge's cavity, an oven's window, a microwave's box.
 *
 * A flat emissive quad rather than a light, because that is what a low-poly appliance interior is:
 * the thing you see is the glowing rectangle, not what it illuminates. `cast` adds a short-range
 * light for the one case (a fridge in a dark kitchen) where the spill is the point.
 */
export function GlowPanel({
  position, size, rotation = [0, 0, 0], color = '#fff0cc', intensity = 1.4, cast,
}: GlowPanelProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  useOutdoorAnimation(groupRef, ({ time }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    // A hair of flicker so it does not read as a painted rectangle.
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = intensity * (0.94 + Math.sin(time * 3.1) * 0.06);
  }, { radius: 1.2, cullDistance: 26 });

  return (
    <group ref={groupRef}>
      <mesh
        ref={meshRef}
        position={position as unknown as [number, number, number]}
        rotation={rotation as unknown as [number, number, number]}
      >
        <planeGeometry args={[size[0], size[1]]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={intensity}
          transparent
          opacity={0.92}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {cast != null && (
        <pointLight
          position={position as unknown as [number, number, number]}
          color={color}
          intensity={cast}
          distance={2.6}
        />
      )}
    </group>
  );
}

export interface SoundWavesProps {
  /** Where the waves leave the cabinet. */
  at: readonly [number, number, number];
  /** Which way they travel — the speaker's own normal. */
  facing?: 'z' | 'x';
  count?: number;
  reach?: number;
  color?: string;
}

/** Arcs pulsing out of a speaker — the one honest way to draw 「it is playing」 without audio. */
export function SoundWaves({
  at, facing = 'z', count = 3, reach = 0.26, color = '#8fd3c7',
}: SoundWavesProps) {
  const groupRef = useRef<THREE.Group>(null);
  const arcs = useRef<(THREE.Mesh | null)[]>([]);

  useOutdoorAnimation(groupRef, ({ time }) => {
    for (let i = 0; i < count; i++) {
      const mesh = arcs.current[i];
      if (!mesh) continue;
      const p = (time * 0.9 + i / count) % 1;
      mesh.scale.setScalar(0.35 + p * 0.85);
      mesh.position[facing] = (facing === 'z' ? at[2] : at[0]) + reach * p;
      (mesh.material as THREE.MeshStandardMaterial).opacity = 0.55 * Math.sin(p * Math.PI);
    }
  }, { radius: 1, cullDistance: 22 });

  return (
    <group ref={groupRef}>
      {Array.from({ length: count }, (_, i) => (
        <mesh
          key={i}
          position={at as unknown as [number, number, number]}
          rotation={facing === 'z' ? [0, 0, 0] : [0, Math.PI / 2, 0]}
          ref={(el) => { arcs.current[i] = el; }}
        >
          {/* A near-complete ring rather than a 90-degree arc. The rings lie in the speaker's
              own plane and travel toward the viewer, so what reads as sound is a ring OPENING —
              a one-sided arc just reads as a bracket parked beside the cabinet. */}
          <ringGeometry args={[0.042, 0.06, 16, 1, Math.PI * 0.18, Math.PI * 1.64]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={1.1}
            transparent
            opacity={0}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

export interface WaterSwirlProps {
  at: readonly [number, number, number];
  radius?: number;
  color?: string;
}

export type BurstShape = 'spark' | 'ember' | 'feather' | 'ripple';

export interface ObjectBurstProps {
  /**
   * When the burst began, `performance.now()` ms — the object's own landed on-edge
   * (`anim.since`), NOT the moment this component mounted. Passing the timeline is what keeps
   * the effect a pure function of the clock: a piece scrolled back into view mid-burst shows the
   * burst at the right point in its life rather than starting it over.
   */
  since: number;
  /** Where it starts, in the model's own frame. */
  at: readonly [number, number, number];
  shape: BurstShape;
  count?: number;
  /** How far a piece rises over its life. Ignored by `ripple`, which lies on the surface. */
  rise?: number;
  /** How far it spreads sideways. For `ripple`, the radius the ring opens to. */
  spread?: number;
  /** Seconds each piece lives. */
  over?: number;
  /** Seconds after `since` before the first piece appears. */
  delay?: number;
  /** Seconds between successive pieces, so a burst reads as a sequence rather than one clump. */
  stagger?: number;
  size?: number;
  color?: string;
  emissive?: string;
}

/**
 * A SMALL ONE-SHOT BURST — embers off a fire, sparkles over a telescope, feathers from a birdhouse,
 * rings on the surface of a well.
 *
 * The one effect every 「it reacted!」 moment had been writing by hand, each inside its own model
 * with its own seed table and its own `elapsed < 1.4` test. As a component it is mounted by the
 * piece's state (`{anim.active && <ObjectBurst since={anim.since} … />}`) and keyed by `since`,
 * so a second press remounts it and a piece at rest has no burst meshes at all.
 *
 * Deliberately small: four to six low-poly pieces, one shared material, `depthWrite={false}` like
 * every other effect in this file. The brief's rule is 「有感但不吵」 — a burst is an accent on
 * the object moving, never a substitute for it.
 */
export function ObjectBurst({
  since, at, shape, count = 5, rise = 0.6, spread = 0.3, over = 1.0, delay = 0, stagger = 0.08,
  size = 0.06, color = '#fde68a', emissive,
}: ObjectBurstProps) {
  const groupRef = useRef<THREE.Group>(null);
  const pieces = useRef<(THREE.Mesh | null)[]>([]);
  // One material for the set, faded per piece through its own scale instead — opacity is shared,
  // and a burst whose pieces all fade at the same rate reads as one gesture.
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color,
    emissive: emissive ?? color,
    emissiveIntensity: shape === 'feather' ? 0.25 : 1.2,
    transparent: true,
    opacity: shape === 'ripple' ? 0.6 : 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
    roughness: 0.8,
  }), [color, emissive, shape]);
  useEffect(() => () => material.dispose(), [material]);

  const seeds = useMemo(
    () => Array.from({ length: count }, (_, i) => ({
      // Golden-angle spacing: evenly spread without any two pieces lining up, and deterministic,
      // so the burst is the same shape every time rather than a random spray.
      angle: i * 2.39996,
      reach: 0.65 + ((i * 37) % 10) / 28,
    })),
    [count],
  );

  useOutdoorAnimation(groupRef, () => {
    const elapsed = (performance.now() - since) / 1000 - delay;
    for (let i = 0; i < seeds.length; i++) {
      const mesh = pieces.current[i];
      if (!mesh) continue;
      const p = (elapsed - i * stagger) / over;
      const alive = p > 0 && p < 1;
      mesh.visible = alive;
      if (!alive) continue;
      const s = seeds[i];
      if (shape === 'ripple') {
        // A ring opening on the surface and thinning out. The radius eases out, because water
        // rings slow down as they spread.
        const open = 1 - (1 - p) * (1 - p);
        mesh.position.set(at[0], at[1], at[2]);
        mesh.scale.setScalar(Math.max(0.0001, spread * (0.15 + open * 0.85)));
        continue;
      }
      const out = spread * s.reach * p;
      mesh.position.set(
        at[0] + Math.cos(s.angle) * out,
        at[1] + rise * p * (shape === 'feather' ? 1 - p * 0.35 : 1),
        at[2] + Math.sin(s.angle) * out,
      );
      // In from nothing and out to nothing: a piece that appears or vanishes at full size is a pop.
      mesh.scale.setScalar(Math.max(0.0001, size * Math.sin(p * Math.PI)));
      mesh.rotation.set(p * 3 + s.angle, p * 5, shape === 'feather' ? Math.sin(p * 9) * 0.8 : 0);
    }
    // The shared fade follows the youngest piece still alive, which is the last one.
    const last = (elapsed - (seeds.length - 1) * stagger) / over;
    material.opacity = (shape === 'ripple' ? 0.6 : 0.9) * (last < 0.6 ? 1 : Math.max(0, (1 - last) / 0.4));
  }, { radius: 1.6, cullDistance: 34 });

  return (
    <group ref={groupRef}>
      {seeds.map((_, i) => (
        <mesh
          key={i}
          ref={(el) => { pieces.current[i] = el; }}
          material={material}
          visible={false}
          rotation={shape === 'ripple' ? [-Math.PI / 2, 0, 0] : undefined}
        >
          {shape === 'spark' && <octahedronGeometry args={[1, 0]} />}
          {shape === 'ember' && <icosahedronGeometry args={[1, 0]} />}
          {shape === 'feather' && <planeGeometry args={[0.7, 1]} />}
          {shape === 'ripple' && <ringGeometry args={[0.86, 1, 20]} />}
        </mesh>
      ))}
    </group>
  );
}

export interface ObjectTossProps {
  /** When the toss left the hand — the piece's own landed on-edge, see ObjectBurstProps.since. */
  since: number;
  /** Where it leaves from and where it lands, in the frame of the group it is mounted under. */
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  /** How far above the straight line the arc peaks. */
  arc?: number;
  /** Seconds in flight. */
  over?: number;
  /** Turns while it flies. */
  spins?: number;
  /** The token itself — a coin, a stick. Drawn at the origin. */
  children: React.ReactNode;
}

/**
 * A SMALL THING ARCING ONTO THE PIECE — the coin into the well, the stick onto the fire.
 *
 * It is the visible link between the player's hands and the object's reaction, which is exactly
 * the half of 「玩家 → 互動對象 → 環境」 a posture alone cannot show: the bow ends, something
 * leaves the hands, and the water answers where it lands.
 *
 * Mount it inside the piece's `launch` group with the player on that group's -Z side, and the
 * toss comes from wherever the player is standing — the aim is resolved from the player at the
 * press, and this component only has to know 「from behind me, to the middle」.
 */
export function ObjectToss({
  since, from, to, arc = 0.35, over = 0.5, spins = 2, children,
}: ObjectTossProps) {
  const groupRef = useRef<THREE.Group>(null);
  const tokenRef = useRef<THREE.Group>(null);

  useOutdoorAnimation(groupRef, () => {
    const token = tokenRef.current;
    if (!token) return;
    const p = ((performance.now() - since) / 1000) / over;
    const alive = p >= 0 && p < 1;
    token.visible = alive;
    if (!alive) return;
    token.position.set(
      from[0] + (to[0] - from[0]) * p,
      from[1] + (to[1] - from[1]) * p + Math.sin(p * Math.PI) * arc,
      from[2] + (to[2] - from[2]) * p,
    );
    token.rotation.set(p * spins * Math.PI * 2, 0, p * spins * Math.PI);
  }, { radius: 1.2, cullDistance: 30 });

  return (
    <group ref={groupRef}>
      <group ref={tokenRef} visible={false}>{children}</group>
    </group>
  );
}

/** A flushing bowl: two counter-turning arcs on the water surface. */
export function WaterSwirl({ at, radius = 0.2, color = '#7dd3fc' }: WaterSwirlProps) {
  const groupRef = useRef<THREE.Group>(null);
  const arcs = useRef<(THREE.Mesh | null)[]>([]);

  useOutdoorAnimation(groupRef, ({ time }) => {
    for (let i = 0; i < 2; i++) {
      const mesh = arcs.current[i];
      if (!mesh) continue;
      mesh.rotation.z = time * (i === 0 ? 6.5 : -4.2);
      mesh.scale.setScalar(1 - i * 0.34);
    }
  }, { radius: 0.9, cullDistance: 22 });

  return (
    <group ref={groupRef} position={at as unknown as [number, number, number]} rotation={[-Math.PI / 2, 0, 0]}>
      {[0, 1].map((i) => (
        <mesh key={i} ref={(el) => { arcs.current[i] = el; }}>
          <ringGeometry args={[radius * 0.55, radius, 16, 1, 0, Math.PI * 1.35]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.6}
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}
