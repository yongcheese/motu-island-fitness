/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { motion } from 'motion/react';
import { useApp } from '../../context/AppContext';
import { getItemById } from '../../constants/items';
import { CharacterModel } from './character';
import { resolveCharacterOutfit } from './character/outfit';
import type { CharacterRig } from './character/types';
import { useCharacterModel } from '../../constants/characterModel';
import { getCharacterModelDefinition } from './character';
import { CHARACTER_ROOT_SCALE, bodyClearanceRadius, flipPivotLocalY, toWorld } from '../../constants/characterRig';
import type { CharacterSkeleton } from '../../constants/characterRig';
// The hair/hat/pants/shoe/outfit imports that used to sit here are gone with the geometry that
// used them — the wardrobe is drawn by the character MODEL now (Three/character/), and this file
// only resolves WHAT is worn. See Three/character/types.ts.
import { FIRST_PERSON_ZOOM, avatarZoomOpacity } from '../../constants/cameraZoom';
import { usePlayerHome } from '../../hooks/usePlayerHome';
import { WATER_SURFACE_Y, SWIM_BODY_Y } from '../../constants/world';
import { DECAL_DEPTH_BIAS, SURFACE_DECAL_LIFT } from '../../constants/terrain';
import { View, CameraMode, WeatherType } from '../../types';
import {
  playFootstepThud, primeSynthAudio, startSwimAmbience, stopSwimAmbience, setSwimActivity,
  playStrokeSplash, playWaterEntrySplash, startBeachSurfAmbience, setBeachSurfIntensity,
  stopBeachSurfAmbience, playSound, playLightSwitch, SoundEffect, FootstepTerrain,
} from '../../lib/soundUtils';
import { playerBus, clampFrameDelta } from '../../lib/playerBus';
import { subscribeFocusSuspension } from '../../lib/inputManager';
import {
  getTerrainInfo,
  findNearbyHome,
  footLevelAt,
  resolveCollisions as resolveCollisionsShared,
  CRAWL_BODY_REACH,
  SWIM_BODY_REACH,
  FOOT_LIFT,
  nextSwimState,
  swimTransitionTimer,
  swimPitchAllowance,
  SWIM_TRANSITION_DURATION,
} from './characterMovement';
import {
  swimBodyPitch,
  swimCycleRate,
  swimRootMotion,
  swimArmPose,
  swimLegPose,
  swimHeadPose,
  swimTorsoPose,
  blendSwimAngle,
  swimEase,
} from './swimPose';
import {
  createJumpState,
  stepJump,
  jumpFrame,
  isJumpActive,
  isJumpAirborne,
} from './jumpPose';
import { isGroundedAt } from '../../lib/placementSurfaces';
import {
  hasFurnitureInteraction,
  liePitch,
} from '../../constants/furnitureInteractions';
import {
  BodyPose,
  PostureId,
  RigJointName,
  getPosture,
} from '../../constants/interactionPostures';
import {
  actionFinished,
  resolveActionFrame,
  resolveOccupancyFrame,
  settleFrom,
  solveLegSwing,
} from '../../lib/interactionPosture';
import {
  InteractionTarget,
  describeInteraction,
  findNearbyInteractable,
  resolveEntryPoint,
  resolveExitTarget,
} from '../../lib/furnitureInteraction';
import { SUSPENDED_MOTIONS } from '../../constants/outdoorAnimation';
import {
  type SuspendedTimeline,
  type WindSample,
  sampleWind,
  suspendedAngle,
  suspendedPhase,
  suspendedSag,
} from '../../lib/outdoorMotion';
import { getFootprintVersion } from '../../lib/furniturePlacement';
import { buildWalkableRects, toShellRooms, type WalkRect } from '../../constants/interiorShell';
import { parseUnlockedRooms } from '../../constants/rooms';
import { getWorldSolids } from '../../lib/worldSolids';
import { interiorLights, nearestLightSwitch, toggleInteriorLights } from '../../lib/interiorLights';
import { CandleInHand } from './CandleInHand';


/**
 * The nearest point inside the house's walkable area — or the point itself, outdoors or when it
 * is already legal.
 *
 * ## Why a dismount needs this and ordinary walking does not
 *
 * Walking is resolved against these same rectangles every frame (characterMovement.ts), so the
 * player simply cannot cross a wall. Getting off a piece of furniture is the one movement that
 * ISN'T: the mount and dismount own `position.current` outright and the collision resolve is
 * deliberately switched off for them, because every seat is inside its own collider and running
 * the push would shove the body back out of the chair it is trying to sit in.
 *
 * That left the exit step as the only way to leave the room. It is measured purely off the
 * piece — clear its own box along the direction the occupant faces — which is right in the
 * middle of a room and wrong with a wall just behind: a sofa turned to face the wall it stands
 * against put the body 0.95 units INTO that wall, and a bathtub did it at its shipped rotation
 * (see the `bathe` posture's exitFacing). The body then popped back the moment the dismount
 * finished and collision resumed.
 *
 * Clamping the landing point rather than re-aiming the step keeps the piece's own opinion about
 * which way you get out of it — you still stand up forwards out of a chair — and only refuses
 * to let that opinion end inside masonry.
 */
/**
 * How far the player may walk, with the same piece still in reach, before the interaction record
 * is rebuilt against where they are NOW. A quarter of a unit: less than the length of any piece
 * in the catalog, more than any amount of standing-still jitter. See the proximity scan.
 */
const DESCRIBE_REFRESH_DISTANCE = 0.25;

/**
 * THE WALK-UP TO A SEAT — how close to the piece's own open side counts as "arrived", and how
 * long the character may spend getting there.
 *
 * ## What this exists to stop
 *
 * Getting ON to a piece of furniture cannot be collision-resolved: every seat is inside its own
 * collider, so the push that keeps a body out of a sofa is exactly the push that would stop it
 * sitting on one. The mount therefore owns `position.current` outright and eases it to the
 * anchor — and a straight ease from wherever the player pressed E slid the body THROUGH the
 * piece to get there. Standing at one end of 雙人獨立浴缸 and pressing 泡澡 travelled 2.1 units
 * along the inside of the tub; the same at 木製鞦韆 went 2.0 through its A-frame.
 *
 * The half-plane in lib/furnitureInteraction.ts already removed the worst of it — you can no
 * longer be offered a seat from behind its backrest — but it cannot help with the case where the
 * player is legitimately in FRONT of a long piece and the anchor is at the other end of it.
 *
 * ## The shape of the fix
 *
 * Split the mount in two. First WALK to the piece's own entry point (the same spot the dismount
 * steps out to, which is by construction just clear of the piece on its open side) using the
 * ordinary movement path — real collision, real wall containment, real walk cycle, real
 * footsteps. Only once the body is standing there does the furniture take the body over and run
 * the ease onto the anchor, which is now a step of a few centimetres straight in.
 *
 * `ARRIVED` is about a body radius: close enough that the remaining ease is a settle rather than
 * a journey, loose enough that a doorway or a neighbouring piece nudging the walk off the exact
 * point does not leave the character shuffling at it. `TIMEOUT` is the guarantee that pressing E
 * always seats you: if something is in the way and the walk cannot close the gap, the mount
 * proceeds anyway after this long and behaves exactly as it did before this split existed.
 */
const SEAT_ENTRY_ARRIVED = 0.3;
const SEAT_APPROACH_TIMEOUT_MS = 1600;

function clampIntoWalkable(x: number, z: number, rects: readonly WalkRect[] | null): { x: number; z: number } {
  if (!rects || rects.length === 0) return { x, z };
  let best = { x, z };
  let bestDistSq = Infinity;
  for (const r of rects) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return { x, z };
    const cx = Math.min(Math.max(x, r.minX), r.maxX);
    const cz = Math.min(Math.max(z, r.minZ), r.maxZ);
    const distSq = (cx - x) * (cx - x) + (cz - z) * (cz - z);
    if (distSq < bestDistSq) { bestDistSq = distSq; best = { x: cx, z: cz }; }
  }
  return best;
}

// THREE.Object3D's default Euler order ('XYZ') is intrinsic: each axis rotates about the
// object's own, already-rotated frame. That means once `rotation.x` has tipped the body over
// (e.g. reclining in a hammock), changing `rotation.y` afterward rotates it around its OWN
// now-horizontal spine axis - a barrel-roll, not a turn - so it has no visible effect on which
// way the character actually lies. Composing the yaw and tilt as quaternions explicitly (yaw
// around the fixed world Y axis, applied as the outer/first transform, then tilt around the
// body's local X axis) gives the intuitive "face this direction, then lean back" result.
/** Scratch for the one wind sample a rider takes per frame. Module scope, so it allocates once. */
const occupantWind: WindSample = { sway: 0, cross: 0, gust: 0 };

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const RIGHT_AXIS = new THREE.Vector3(1, 0, 0);
function applyLyingOrientation(group: THREE.Group, targetYaw: number, pitch: number, delta: number, slerpRate: number) {
  const qYaw = new THREE.Quaternion().setFromAxisAngle(UP_AXIS, targetYaw);
  const qPitch = new THREE.Quaternion().setFromAxisAngle(RIGHT_AXIS, pitch);
  const targetQuat = qYaw.multiply(qPitch);
  group.quaternion.slerp(targetQuat, Math.min(1, slerpRate * delta));
}

// Same gimbal-lock problem as applyLyingOrientation above, hit by the swimming pose (tilted
// ~-82deg to lie flat/prone in the water): a plain `rotation.x = swimTilt` write on top of
// whatever `rotation.y` already holds rotates the body around its own now-horizontal spine
// instead of turning it, so the swim stroke always appeared to face the same fixed direction
// no matter which way the player steered. Unlike the hammock mount/dismount (which wants a
// slow ease), yaw and pitch here are already independently smoothed by their callers
// (rotation.current's own turn-rate easing, targetRotX's transition lerp), so this composes
// and applies them immediately rather than slerping a second time on top.
// `roll` (about the body's local Z, applied innermost) adds the gentle side-to-side
// wave rocking used by the idle back-float — composed here for the same gimbal
// reason as the pitch: written as a plain Euler it would wrap around the wrong axis
// once the body is horizontal.
const FORWARD_AXIS = new THREE.Vector3(0, 0, 1);
function applySwimOrientation(group: THREE.Group, yaw: number, pitch: number, roll = 0) {
  const qYaw = new THREE.Quaternion().setFromAxisAngle(UP_AXIS, yaw);
  const qPitch = new THREE.Quaternion().setFromAxisAngle(RIGHT_AXIS, pitch);
  const composed = qYaw.multiply(qPitch);
  if (roll !== 0) {
    composed.multiply(new THREE.Quaternion().setFromAxisAngle(FORWARD_AXIS, roll));
  }
  group.quaternion.copy(composed);
}

/**
 * Writes the on-land body orientation as a COMPLETE rotation: eased yaw, eased tilt, and an
 * explicit zero roll.
 *
 * Every site that orients the body on land must go through here, and must pass values it has
 * tracked itself rather than ones it read back off `group.rotation`. That is not stylistic - a
 * read-back is unsound, because this group's orientation is also written as a QUATERNION by
 * applySwimOrientation/applyLyingOrientation, and three.js keeps `.rotation` in sync by
 * decomposing that quaternion into XYZ Euler angles. Decomposition is not unique, and past a
 * quarter turn it does not pick the (tilt, yaw, 0) form the land code assumes: a pure 180deg yaw
 * comes back as (x=-180, y=0, z=-180), which is the same orientation expressed as "upside down,
 * turned, and rolled back upright again".
 *
 * Those three angles are only equivalent to a plain yaw TOGETHER. Easing `rotation.x` toward 0 on
 * top of that - which is exactly what the idle branch's tilt ease used to do - keeps the -180deg
 * roll while removing the -180deg flip that cancelled it, leaving the character standing on its
 * head. That is the "walks out of the sea and somersaults" bug: it needed no swim pitch at all,
 * only a swim (any quaternion write) followed by coming ashore facing further than 90deg from +Z,
 * and it stuck permanently because nothing on the idle path ever cleared `rotation.z`.
 *
 * Keeping yaw and tilt in refs and writing all three components every time means the land pose is
 * always built from the two angles that actually have meaning, and the roll is re-zeroed on every
 * frame instead of being inherited from a decomposition.
 */
const GROUND_EULER = new THREE.Euler(0, 0, 0, 'YXZ');

function applyGroundOrientation(group: THREE.Group, yaw: number, tilt: number) {
  // 'YXZ', NOT the default 'XYZ' - the order decides which axis the tilt is about.
  //
  // three.js composes 'XYZ' as qx*qy*qz, which applies the yaw first and the pitch LAST, in
  // world space. So `rotation.set(tilt, yaw, 0)` pitches about the world X axis no matter which
  // way the character is facing: a somersault came out as a proper head-over-heels flip only
  // while facing along Z, and turned into a sideways barrel roll when facing along X. Same for
  // the crawl, which tipped the body over its own shoulder instead of forward.
  //
  // 'YXZ' composes as qy*qx*qz, so the pitch is applied before the yaw carries it around - i.e.
  // about the body's OWN left-right axis. That is the only axis a flip or a crawl ever means.
  // Standing still is unaffected: at tilt 0 both orders reduce to the same pure yaw.
  group.quaternion.setFromEuler(GROUND_EULER.set(tilt, yaw, 0, 'YXZ'));
}

/** The joints a furniture posture may drive. A subset of CharacterRig, matched by name. */
type PostureJointRefs = Record<RigJointName, { current: THREE.Group | null }>;

/**
 * WRITE A POSTURE ONTO THE BODY — the one place a table of joint angles becomes three.js
 * rotations, and the last line of the chain the request asked for:
 *
 *   Furniture → Interaction Kind → Posture → joint targets → HERE
 *
 * Everything upstream of this function is data and pure maths; everything downstream is the
 * scene graph. That division is what makes the posture table checkable without a renderer
 * (`npm run audit:interactions`) and what keeps a new kind of interaction from ever needing a
 * new branch in this file.
 *
 * Three properties this deliberately has:
 *
 *   BY NAME       it walks the pose's own entries, so a posture that says nothing about the
 *                 legs leaves the legs to whatever else is animating them. That is what lets an
 *                 acting posture be laid straight over the ordinary idle instead of gating it.
 *   PER AXIS      an omitted axis is untouched, for the same reason.
 *   BLEND, not set  `weight` is the lerp factor. An occupying posture passes a per-frame ease
 *                 (nothing else is writing these joints, so the previous frame is the pose's own
 *                 history); an acting one passes its envelope, which reaches 0 at both ends and
 *                 so can never stranded a limb when it expires.
 */
function applyBodyPose(joints: PostureJointRefs, pose: BodyPose, weight: number) {
  if (weight <= 0) return;
  for (const name of Object.keys(pose) as RigJointName[]) {
    const target = pose[name];
    const group = joints[name]?.current;
    if (!target || !group) continue;
    if (target.x !== undefined) group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, target.x, weight);
    if (target.y !== undefined) group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, target.y, weight);
    if (target.z !== undefined) group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, target.z, weight);
  }
}

/**
 * Per-surface footstep VFX. One profile is fired per footfall by spawnFootstepVfx().
 *
 * Two ideas drive the shape of this table:
 *
 *  1. SOFT ground displaces, HARD ground does not. Grass and sand throw actual material into
 *     the air, so they get several coloured puffs that drift and hang. Wood and stone cannot
 *     kick up a cloud without looking wrong, so their read comes mostly from a flat "scuff
 *     ring" that snaps outward at the contact point, with only a couple of faint motes on top.
 *     That ring is what gives indoor walking (always 'wood') a visible effect at all - the old
 *     single dust puff was the only feedback anywhere, and a dust cloud on a living-room floor
 *     is exactly the thing that looked wrong.
 *
 *  2. The effect should read as a FOOTfall, not a body-fall. Particles spawn under the foot
 *     that just landed (offset left/right of the body centre, alternating) and drift backwards
 *     along the direction of travel, so a walk leaves a staggered trail behind the character
 *     rather than a single puff pulsing under its middle.
 *
 * `rise`/`drift`/`spread` are world units; `lifetime` is seconds.
 */
type FootstepVfxProfile = {
  /** Sampled per particle, so a single footfall is not flat-coloured. */
  colors: string[];
  count: number;
  /** Random scatter around the foot at spawn. */
  spread: number;
  /** How far the puff floats up over its life. */
  rise: number;
  /** How far it trails backwards, opposite the direction of travel. */
  drift: number;
  startScale: number;
  endScale: number;
  lifetime: number;
  opacity: number;
  /** Flat expanding ring at the contact point - the main read on hard floors. */
  ring: { color: string; radius: number; lifetime: number; opacity: number } | null;
};

// Scale reference, because these numbers are meaningless without it: the avatar's group is
// drawn at baseScale 2.25 with its head centred at 0.68, so the character stands roughly 2.1
// WORLD UNITS tall. A puff therefore has to reach ~0.25 radius (0.5 across) before it reads as
// anything at all at normal camera distance - roughly a quarter of the body height. The first
// pass at this table topped out at 0.16 across, i.e. under 8% of the character, which is why it
// registered as a faint smudge rather than as an effect.
const FOOTSTEP_VFX: Record<FootstepTerrain, FootstepVfxProfile> = {
  // Blade tips and dry soil kicked up in a broad fan, plus a soft ring pressing the grass flat.
  grass: {
    colors: ['#9dc466', '#c2dc94', '#e9f2d6'],
    count: 5,
    spread: 0.28,
    rise: 0.42,
    drift: 0.35,
    startScale: 0.08,
    endScale: 0.26,
    lifetime: 0.5,
    opacity: 0.85,
    ring: { color: '#b9d489', radius: 0.62, lifetime: 0.42, opacity: 0.5 },
  },
  // The most expressive surface: dry sand is thrown wide, hangs, and settles slowly, and the
  // foot leaves a broad shallow crater behind it.
  sand: {
    colors: ['#f0dda8', '#e4c987', '#fdf5de'],
    count: 7,
    spread: 0.4,
    rise: 0.6,
    drift: 0.5,
    startScale: 0.09,
    endScale: 0.34,
    lifetime: 0.7,
    opacity: 0.9,
    ring: { color: '#dcc182', radius: 0.8, lifetime: 0.6, opacity: 0.6 },
  },
  // Indoor floors and the wooden platform. A hard surface cannot throw up a cloud without
  // looking wrong, so the read is carried by a bright, crisp scuff ring - deliberately the
  // most opaque ring of the four, since indoors it is doing nearly all the work - with a
  // modest amount of airborne dust on top so it is not a bare graphic.
  wood: {
    colors: ['#f3e7d2', '#dccbaf', '#fbf4e6'],
    count: 4,
    spread: 0.22,
    rise: 0.3,
    drift: 0.26,
    startScale: 0.06,
    endScale: 0.18,
    lifetime: 0.42,
    opacity: 0.7,
    ring: { color: '#fbf1de', radius: 0.55, lifetime: 0.38, opacity: 0.7 },
  },
  // Hard and bright: the ring snaps out wider and faster than wood, with a cooler, grittier
  // dust tint.
  stone: {
    colors: ['#e2ded6', '#c9c4b8', '#f2efe8'],
    count: 4,
    spread: 0.26,
    rise: 0.34,
    drift: 0.3,
    startScale: 0.07,
    endScale: 0.2,
    lifetime: 0.45,
    opacity: 0.75,
    ring: { color: '#eeebe3', radius: 0.65, lifetime: 0.34, opacity: 0.75 },
  },
};

// Sized for the worst case: sand emits 7 puffs per footfall, footfalls land about every 0.52 s
// at walking pace, and a sand puff lives up to ~0.8 s after jitter - so ~11 are alive at once.
// The headroom above that keeps a step from ever recycling a particle that is still visible.
const FOOTSTEP_PUFF_POOL = 24;
const FOOTSTEP_RING_POOL = 6;

/**
 * Ground covered per footstep while the interior edit camera is driving (see the
 * 佈置模式 branch in useFrame). Roughly a human stride, so flying the camera
 * across a room sounds like walking across it rather than like sprinting.
 */
const BUILD_STEP_STRIDE = 0.85;

/**
 * The crawl pose (emote 'CRAWL'), shared by the idle and the moving branches of useFrame.
 *
 * Both branches need it because crawling is a way of MOVING, not a gesture you strike standing
 * still: the moving branch used to force the body upright (`bodyTiltRef.current = 0`), so a
 * crawling player who actually crawled somewhere stood up for the trip and dropped back down on
 * arrival. Keeping the two numbers here means there is one crawl pose rather than one per branch.
 *
 * The rise is measured FROM THE SURFACE rather than being an absolute Y, which the idle branch
 * used to hard-code as 0.4. On grass those are the same number (ISLAND_SURFACE_Y is 0.3), so the
 * pose is unchanged where it was tuned - but the absolute form floated the body on the beach and
 * indoors, where the floor is not at 0.3. It exists at all because the body pitches about its
 * base: tipping ~72deg with no lift buries the character's shoulders in the ground.
 */
const CRAWL_TILT = Math.PI / 2.2;
const CRAWL_RISE = 0.2;

/**
 * How far below horizontal the face is left pointing once the head has been rotated back out of
 * the crawl pitch (see crawlHeadLift in useFrame).
 *
 * The tilt above is applied to the whole avatar group, head included, so at rest the face points
 * ~82deg down - the head isn't leaning forward, it's lying face-first on the floor with it. The
 * head has to give that pitch back in its own local space to look along the direction of travel.
 *
 * Not ALL of it, though: giving back the full CRAWL_TILT aims the eyes at the horizon, which is a
 * neck fully craned back. Holding ~13deg of the original pitch puts the gaze a couple of body
 * lengths ahead on the ground, which is where someone on their front actually looks.
 */
const CRAWL_HEAD_GAZE = 0.22;

/**
 * The somersault ('FLIP').
 *
 * FLIP_PIVOT_LOCAL_Y is the whole reason it reads as a flip rather than a cartwheel over the
 * toes. The avatar group's origin is at the FEET, so rotating it spins the character about its
 * ankles: the head swept a huge arc down through the floor and the move looked like a windmill.
 * A somersault turns about the body's centre of mass, so the pose code offsets the group by
 * however much is needed to hold that point still while the body rotates around it (the offset
 * is exactly zero at both 0 and 2PI, so the character still lands precisely where it took off).
 * The value mirrors the component's BASE_BODY_Y - the torso's centre - and is in LOCAL units,
 * so it has to be scaled by baseScale before use.
 */
/**
 * World units per LOCAL unit, re-exported under the name the rest of the app already imports.
 *
 * The number itself lives in constants/characterRig.ts as CHARACTER_ROOT_SCALE, because the
 * camera and every character model need it too and none of them should have to import the
 * controller to get it. This alias stays because things mounted BESIDE the avatar are measured
 * in its local units and import it from here — the dressing room's companion pet, for one
 * (see constants/pets.ts).
 */
export const AVATAR_BASE_SCALE = CHARACTER_ROOT_SCALE;

/**
 * How much room the camera needs above "the near plane has reached the skull" before the body is
 * drawn solid again, in world units. At the bottom of this band the head already fills the frame
 * whether it is drawn or not, so the fade costs the player nothing they could see.
 */
const PROXIMITY_FADE_SPAN = 0.3;

/**
 * How visible the body may be given how close the camera has ended up to the head.
 *
 * The companion to the zoom fade, and it exists because the zoom is only one of the two ways the
 * camera gets inside this character. The other is the room: press into a wall and the orbit arm
 * has nowhere to go, so it collapses onto the pivot — which is the head — no matter what the
 * player's zoom says. Drawn from that distance the head is inside-out (its own faces cull away)
 * and only the eyes and mouth survive, the same picture zooming in used to produce.
 *
 * Measured against the model's OWN skull, so it means "the camera is inside the head" for any
 * character: at `crownRise` the camera is exactly on the surface of the skull, and the body is
 * gone by then. Nothing here moves the camera — the camera's own rules decide where it sits (see
 * CameraController's surfaceLimit); this only decides whether it is looking at a face from the
 * inside.
 */
function cameraProximityOpacity(
  distance: number | undefined,
  skeleton: CharacterSkeleton,
  nearPlane: number,
): number {
  if (distance === undefined || !Number.isFinite(distance)) return 1;
  // The distance at which the lens' own clip plane arrives at the skull. Past it the head is not
  // merely close, it is CUT OPEN: the front of it falls behind the near plane, the inside of the
  // back of it is back-facing and culled, and what is left on screen is the eyes and the mouth
  // hanging in space. Both reports are this same picture, reached from opposite directions - the
  // player zooming in, or a wall shortening the arm until it amounts to the same thing.
  const headCutOpen = toWorld(skeleton.head.crownRise) + nearPlane;
  return THREE.MathUtils.clamp((distance - headCutOpen) / PROXIMITY_FADE_SPAN, 0, 1);
}


// 0.85s rather than the original 0.6: a full 2π in 0.6s is 600deg/s, fast enough
// that the tumble reads as a blur even now that it actually reaches the screen
// (until the pose-owned-pitch fix further down, it never did). The height goes
// up with it so the arc still looks thrown rather than floated - the character
// stands ~2.1 world units tall, so 1.8 lifts the body most of its own height.
const FLIP_DURATION = 0.85;
const FLIP_HEIGHT = 1.8;

// Per-frame scratch for the movement block, mirroring the pattern CameraController.tsx already
// uses (see the note above its own scratch vectors). Only the one Avatar that owns input runs
// this branch per frame (see isCorrectInstance), and none of these values outlive the useFrame
// call that fills them, so they are reused rather than re-allocated. Four throwaway Vector3s per
// frame - five while walking - is enough garbage to earn a visible GC hitch on a long session,
// and the hitch lands hardest exactly when the player is moving.
//
// Sharing these across instances is safe even though preview Avatars exist (equippedOverride
// below): every instance resets them at the top of its own useFrame body and has finished with
// them before the next instance runs, and only the isCorrectInstance one ever fills them at all.
const moveVector = new THREE.Vector3();
const camDir = new THREE.Vector3();
const camRight = new THREE.Vector3();
const finalMove = new THREE.Vector3();
/** Where the body is easing to while getting on or off a piece of furniture. */
const poseTargetPos = new THREE.Vector3();
/** Constant world up for the camRight cross product - never mutated. */
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * 端著蠟燭的右手：往前抬起、稍微離開身體。
 *
 * -0.85 弧度（約 49 度）不是隨便挑的，它要同時滿足兩件事：手要抬到火焰高過腰、進到鏡頭裡看得
 * 到的位置，但又不能高到擋住角色自己的臉 —— 這個遊戲的第三人稱鏡頭是從斜後上方看下來的，手臂
 * 再抬十度火焰就會壓在下巴前面。0.22 的外張是不讓蠟燭穿過大腿。
 */
const CANDLE_ARM_PITCH = -0.85;
const CANDLE_ARM_ROLL = 0.22;

export function Avatar({ isInterior = false, isBuildMode = false, equippedOverride }: { isInterior?: boolean, isBuildMode?: boolean, /**
 * Wear this list instead of the save. Previews and fit checks only (tmp-fit.tsx) — the game never
 * passes it, so the avatar on the island is always the player. Item IDS, same as equippedItems.
 */ equippedOverride?: string[] }) {
  const {
    profile, nearbyBuilding, setNearbyBuilding, setNearbyInteractable, currentView,
    setCurrentView, joystickData, externalActionTrigger, cameraMode, isGameLoading,
    uiScale, weather, pendingPetFood
  } = useApp();
  
  const isDressingRoom = currentView === View.DRESSING_ROOM;

  // Disable movement if this avatar instance doesn't match the current view mode. The outdoor
  // instance stays the active, movable one both on the normal island (HOME) AND while the outdoor
  // build overlay (BUILD_MODE - 建造模式：領土規劃 / 建築規劃) is open: that overlay is a HUD layered
  // over the very same island Scene, so the player must stay free to walk around and scout where
  // to build/expand without being frozen or having to leave build mode first. The separate indoor
  // free-edit camera ("佈置模式") is driven by the isBuildMode PROP below, not this view check, so
  // it is unaffected.
  const isCorrectInstance = isInterior
    ? currentView === View.BUILDING_INTERIOR
    : (currentView === View.HOME || currentView === View.BUILD_MODE);

  // Instant, deliberate hide triggers (mode switches, not a continuous value) - unlike the
  // zoom fade below, these don't need smoothing since they're rare, intentional state changes.
  const isHiddenByMode = !isDressingRoom && (isBuildMode || (isInterior && cameraMode === CameraMode.SECOND_PERSON));

  /**
   * THE CAMERA IS INSIDE THIS BODY - so none of it may be drawn.
   *
   * Both ways into first person, as one flag: the 射擊遊戲風格 camera mode, and simply zooming
   * past FIRST_PERSON_ZOOM. Neither is a matter of degree, which is why this is a hard hide and
   * not a low opacity: with the camera at the eye, the skull's own faces point AWAY from it and
   * are culled, while the eyes, the mouth and the blush - which are separate meshes standing
   * proud of the face - are not. Anything short of invisible therefore leaves exactly those
   * three floating in the middle of the screen, which is the reported 「放大成第一人稱只剩五官浮
   * 在空中」. The interior canvas is where it showed: its near plane is 0.3 against the outdoor
   * 0.5, so indoors the eyeballs sit in front of the clip plane and outdoors they mostly don't.
   *
   * The dressing room is excluded because its camera is a portrait framing at 2.5 units that
   * ignores the zoom entirely - and `uiScale` is persisted, so a player who left the game in
   * first person would otherwise open the wardrobe to an empty room.
   */
  const isFirstPersonView = !isDressingRoom
    && (cameraMode === CameraMode.SECOND_PERSON || uiScale >= FIRST_PERSON_ZOOM);

  // Smoothed second-to-second render output of the zoom-based fade, updated in useFrame below.
  // Raw `uiScale` can jump in a single React update (e.g. a burst of queued wheel events flushed
  // in one go after a slow frame on weaker hardware) - if character opacity/visibility followed
  // that raw value directly, the avatar could pop out of existence with no visible transition,
  // which is exactly the "disappears with no warning" report. Smoothing over real elapsed time
  // guarantees the fade always plays out, however abruptly the underlying zoom value changes.
  const smoothedZoomOpacityRef = useRef(1);

  /**
   * The character root. Its origin is the GROUND CONTACT POINT, which is why the movement
   * code can write terrain height straight into `position.y` — see constants/characterRig.ts.
   */
  const groupRef = useRef<THREE.Group>(null);

  /**
   * THE RIG. These nine refs are the entire contract between this controller and whichever
   * character model is drawn: the animation below drives them by name and never touches
   * geometry, so a model swap cannot change a single frame of how the character behaves.
   *
   * They are `Group` rather than `Mesh` on purpose. A joint is a TRANSFORM this file owns;
   * what hangs under it is the model's business and may be one mesh, several, or a loaded
   * GLB node. See Three/character/types.ts.
   */
  const headRef = useRef<THREE.Group>(null);
  const eyeLRef = useRef<THREE.Group>(null);
  const eyeRRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);

  // Movement state.
  //
  // WASD lives ONLY in this ref, never in React state. It used to be mirrored into a
  // `keys` useState that nothing ever read - so every key press and every key release
  // re-rendered this whole component for nothing, synchronously, on the main thread at
  // the exact moment the next frame had to be drawn and the footstep/jump sound had to
  // be scheduled. That one dead setState was the shared cause of the input lag, the
  // frame stutter, and the "sound arrives half a beat late" (Web Audio schedules at
  // ctx.currentTime when the call finally runs, so a blocked main thread delays the
  // note itself). The movement math reads keysRef.current in useFrame - see below.
  const keysRef = useRef({ w: false, a: false, s: false, d: false });
  const [emote, setEmote] = useState<string>('NONE');
  const [isFlipping, setIsFlipping] = useState(false);
  const flipStartTime = useRef(0);
  /**
   * THE JUMP, all of it — the phase, the vertical velocity and the arc (Three/jumpPose.ts).
   *
   * A ref and not React state, and not a `jumpStartTime` either. Both of those were what the
   * jump used to be: a `useState` flag that re-rendered this entire component twice per hop,
   * and a timestamp that the two copies of the arc maths each measured their own progress
   * against. Neither could answer the question the animation actually needs answered —
   * 「這一幀是在上升還是下降」 — because a start time only says how long ago the key went down.
   *
   * The machine is stepped once per frame, unconditionally (see useFrame), which is also what
   * fixes the old failure mode where pressing space while sitting on a sofa set `isJumping`
   * true in a branch that could never clear it again.
   */
  const jumpStateRef = useRef(createJumpState());
  /**
   * A jump asked for since the last frame. The key handler writes this and nothing else: what
   * a keypress MEANS — whether it may start a jump at all, whether it is buffered for the
   * landing — is the state machine's decision, made against the physics, one place.
   */
  const jumpRequestRef = useRef(false);
  /** Last frame's support height, so this frame can tell how fast the ground is dropping away. */
  const prevSupportYRef = useRef(0);
  // 0..1 through the somersault, published by the pose block so the limb animation further down
  // can tuck in time with it, and the group offset that keeps the flip turning about the body's
  // centre instead of its feet (see FLIP_PIVOT_LOCAL_Y).
  const flipProgress = useRef(0);
  const flipPivotOffset = useRef(new THREE.Vector3());
  /**
   * THE FURNITURE INTERACTION STATE — two slots, and that is the whole of it.
   *
   * `nearbyInteraction` is whichever single piece the player is standing close enough to act on,
   * already resolved into a verb, a body anchor and a prompt anchor by
   * lib/furnitureInteraction.ts. `occupied` is the piece they are currently sitting or lying on.
   *
   * This replaced FOUR pieces of state that between them said the same thing: a `nearbyHammock`
   * (with its own position/rotation record), a `nearbyDecor`, an `isLying` boolean, and an
   * `INTERACTIVE_DECOR_NAMES` array of five Chinese item names matched against `item.name`. That
   * shape could only ever grow one way — a fifth kind of interactable meant a fifth slot here and
   * a sixth branch in handleAction — and it is why nothing indoors could be interacted with at
   * all. What a piece offers is now the piece's own declaration (constants/items.ts's
   * `interactions`), so this file no longer knows what a hammock is.
   *
   * Refs alongside the state because the per-frame proximity scan and the action handler both
   * read them at times React state has not committed yet — the same arrangement the hammock
   * pair used.
   */
  const [nearbyInteraction, setNearbyInteraction] = useState<InteractionTarget | null>(null);
  const nearbyInteractionRef = useRef<InteractionTarget | null>(null);
  const [occupied, setOccupied] = useState<InteractionTarget | null>(null);
  const occupiedRef = useRef<InteractionTarget | null>(null);
  /**
   * The walkable rectangles, readable from `leaveFurniture` — which has no dependencies on
   * purpose (four different things end an occupancy and every one of them has to record the same
   * landing spot), so the room shape reaches it through a ref rather than through its closure.
   * Refreshed once a frame from the memo further down.
   */
  const walkableRectsRef = useRef<readonly WalkRect[] | null>(null);
  /**
   * The walk-up to a seat: where the body is heading, and when it gives up trying to get there.
   * Both cleared the moment the occupancy ends, so nothing can leave the character auto-walking
   * toward a piece it is no longer on its way to. See SEAT_ENTRY_ARRIVED.
   */
  const seatApproachTargetRef = useRef(new THREE.Vector3());
  const seatApproachActiveRef = useRef(false);
  const seatApproachDeadlineRef = useRef(0);
  /**
   * This frame's auto-walk heading, in WORLD space — the one input the movement path takes that
   * did not come from the player. Non-null only during a seat approach.
   *
   * World rather than camera-relative because `moveVector` is a joystick reading and this is not:
   * where the seat is does not depend on which way the camera happens to be pointing, and routing
   * it through the camera basis would make the walk-up curve as the player spun the view.
   */
  const autoWalkDirRef = useRef(new THREE.Vector3());
  const autoWalkActiveRef = useRef(false);
  /**
   * An occupancy whose `furniture-occupy` has not been announced yet, because the body is still
   * walking over to it.
   *
   * The event is what starts a swinging piece moving (lib/outdoorMotion.ts's handshake), and it
   * carries the moment the weight landed. Sending it on the KEYPRESS — which is when it used to
   * go, because that was also when the body arrived — would set 木製鞦韆 swinging with nobody on
   * it for as long as the walk-up takes. So it waits, and a player who walks away mid-approach
   * never announces an occupancy at all, which is why `leaveFurniture` has to be able to cancel
   * a pending one rather than pair every release with an occupy.
   */
  const seatOccupyPendingRef = useRef<InteractionTarget | null>(null);
  /** True while the body is being driven by a piece of furniture rather than by the player. */
  const isOccupying = occupied !== null;

  /**
   * Leaves whatever the player is sitting or lying on.
   *
   * Its own function because FOUR separate things end an occupancy — pressing the action key
   * again, pressing a movement key, playing an emote, and leaving the view — and every one of
   * them has to record the dismount's landing spot before clearing the state, or the transition
   * below eases toward a stale point. The old code had that arithmetic inline in the one place
   * that could trigger it, which is why walking off a hammock and emoting off one behaved
   * differently.
   */
  /**
   * Tells the piece it now has someone on it, and starts the shared timeline both ends read.
   *
   * Its own function because there are now two moments this can happen at: immediately, when the
   * player pressed E already standing at the piece, and a fraction of a second later, when the
   * walk-up gets there. Both have to write the same two fields and send the same event — see
   * seatOccupyPendingRef.
   */
  const announceOccupy = useCallback((target: InteractionTarget) => {
    const at = performance.now();
    suspendedTimelineRef.current.mountedAt = at;
    suspendedTimelineRef.current.releasedAt = null;
    seatOccupyPendingRef.current = null;
    window.dispatchEvent(new CustomEvent('furniture-occupy', {
      detail: { instanceId: target.instanceId, itemId: target.itemId, at },
    }));
  }, []);

  const leaveFurniture = useCallback(() => {
    const target = occupiedRef.current;
    if (!target) return;
    if (target.spot) {
      // Where the dismount step should land. Not a teleport: the per-frame pose transition below
      // eases position.current toward this point as part of the climb-off animation. Resolved
      // against a placement AT THE ORIGIN because the spot it is measured from is already in
      // world space — only the piece's own extent along the exit heading is wanted here.
      //
      // Then kept inside the house. The piece knows which way you get out of it and nothing
      // else; the ROOM is what says that direction runs out after two and a half metres, and
      // this step is the only one the wall resolve never sees. See clampIntoWalkable.
      const exit = resolveExitTarget(target.itemId, target.spot);
      const landing = clampIntoWalkable(exit.x, exit.z, walkableRectsRef.current);
      poseExitTargetRef.current.set(landing.x, 0, landing.z);
    }
    // Nothing may leave the character auto-walking toward a seat they are no longer taking.
    seatApproachActiveRef.current = false;
    /*
     * Walked away before ever arriving: the piece was never told anyone was on it, so it must
     * not now be told they got off. Releasing an occupancy that never happened is what would
     * push a swing on the way past it.
     */
    if (seatOccupyPendingRef.current) {
      seatOccupyPendingRef.current = null;
      posePieceRef.current = null;
      occupiedRef.current = null;
      setOccupied(null);
      return;
    }
    // The piece is on its own now. `rode` is what its decay is scaled by — a swing someone
    // worked up for a minute keeps going longer than one they sat on for two seconds — and the
    // event carries the SAME timestamp this ref records, so the model's copy of the timeline and
    // this one cannot come apart. See lib/outdoorMotion.ts.
    const at = performance.now();
    const timeline = suspendedTimelineRef.current;
    if (timeline.mountedAt != null) timeline.rode = (at - timeline.mountedAt) / 1000;
    timeline.mountedAt = null;
    timeline.releasedAt = at;
    window.dispatchEvent(new CustomEvent('furniture-release', {
      detail: { instanceId: target.instanceId, itemId: target.itemId, at },
    }));

    posePieceRef.current = target;
    occupiedRef.current = null;
    setOccupied(null);
  }, []);

  /**
   * Stops an ACTING posture that is still playing — the other half of the interaction lifecycle.
   *
   * `leaveFurniture` ends an occupancy; this ends a one-shot action (烹飪, 開冰箱, 觀星) that the
   * player walked away from, emoted out of, or left the view in the middle of. It used to be a bare
   * `actionPostureRef.current = null` written at ONE of those places (the WASD handler), which left
   * two holes: the joystick path never cleared it, so on mobile the spot-easing kept pulling the
   * body back toward the telescope the player was trying to walk away from; and nothing told the
   * PIECE, so a fridge whose cue had not landed yet still opened for nobody a moment later.
   *
   * One function, called from every exit, and it tells the piece in the same breath. The runtime
   * only drops what has not happened yet (lib/objectRuntimeState.ts's cancelPendingObject), so
   * calling this after the cue has landed is harmless — which is why no caller has to check.
   */
  const abandonAction = useCallback(() => {
    const action = actionPostureRef.current;
    if (!action) return;
    actionPostureRef.current = null;
    if (action.instanceId) {
      window.dispatchEvent(new CustomEvent('furniture-cancel', {
        detail: { instanceId: action.instanceId },
      }));
    }
  }, []);

  // Speech bubble state - Hidden by default as requested
  const [showBubble, setShowBubble] = useState(false);

  // Handle mobile action trigger.
  //
  // `externalActionTrigger` is a monotonically increasing counter, so the ONLY thing that means "the
  // player just pressed the on-screen action button" is the counter having gone up since the last
  // time this ran. Testing `externalActionTrigger > 0` instead meant the effect fired an action
  // every time one of its other dependencies changed - `isCorrectInstance` flips on every view
  // change, and `nearbyBuilding` flips every time the player walks into or out of the door radius.
  // So once the button had been used even once in the session, merely stepping back into range of
  // the front door could re-run handleAction() with no input at all and pull the player into the
  // house - including immediately after they had just walked out of it. Latching the consumed value
  // makes a press the only thing that can trigger an action.
  const lastConsumedActionTriggerRef = useRef(externalActionTrigger);
  useEffect(() => {
    if (externalActionTrigger === lastConsumedActionTriggerRef.current) return;
    lastConsumedActionTriggerRef.current = externalActionTrigger;

    if (!isCorrectInstance) return;
    // Already on a piece counts: the button is what gets you back off it.
    if (nearbyInteractionRef.current === null && occupiedRef.current === null && nearbyBuilding === null) return;
    handleAction();
  }, [externalActionTrigger, isCorrectInstance, nearbyBuilding]);

  useEffect(() => {
    if (isCorrectInstance) {
      // Speech bubble persists until movement, no auto-timer
    }
  }, [isCorrectInstance]);

  useEffect(() => {
    if (!isCorrectInstance) return;

    const handleEmoteTrigger = (e: Event) => {
      const customEvent = e as CustomEvent;
      const emoteName = customEvent.detail?.emote;
      if (!emoteName) return;

      if (emoteName === 'FLIP') {
        if (!isFlipping) {
          setIsFlipping(true);
          flipStartTime.current = performance.now();
          leaveFurniture();
          abandonAction();
          setEmote('NONE');
        }
      } else {
        setEmote(emoteName);
        leaveFurniture();
        abandonAction();
      }
    };

    window.addEventListener('trigger-avatar-emote', handleEmoteTrigger);
    return () => {
      window.removeEventListener('trigger-avatar-emote', handleEmoteTrigger);
    };
  }, [isCorrectInstance, isFlipping, leaveFurniture, abandonAction]);

  // Which interaction fires when the player activates one (desktop E key, or the on-screen
  // prompt / mobile action button, which route here via externalActionTrigger) is decided by a
  // SINGLE source of truth: whichever nearest target InteractionPromptTracker is currently showing
  // a prompt for. This used to check `nearbyBuilding` first and unconditionally enter the house.
  // But the home's door has a far larger trigger radius (HOME_ENTRY_RADIUS, ~3.3u) than a piece of
  // furniture, so a decoration placed near the house leaves `nearbyBuilding` AND the furniture
  // target set at the same time - and the building always won the priority check, so interacting
  // with e.g. 手作鳥屋 / 溫馨營火 parked by the house wrongly entered the house even while the
  // prompt read 「使用 <decoration>」. The tracker already resolves that overlap by projecting only
  // the single nearest candidate (see its candidates.sort); reading its result here keeps the
  // action and the visible prompt in lockstep, so each object only ever triggers its own
  // interaction. No per-object exceptions needed - one rule covers every piece of furniture.
  /**
   * 撥一下牆上的電燈開關。
   *
   * 跟家具的一次性互動走的是同一套動作：轉身面向它、做一次伸手的動作、發出一個聲音、然後那個
   * 東西自己有反應（撥片翻過去、房間暗下來）。不同的只有「那個東西」不是一件家具，所以它不走
   * furniture-interact 那條事件路。
   *
   * 綁在 Q 上（見下面的 handleKeyDown）。不跟 E 共用，因為開關不跟家具競爭：坐在沙發旁邊的
   * 牆邊，E 是起身、Q 是關燈，兩件事同時有意義。
   *
   * `leaveFurniture()`：坐著或躺著的時候按 Q，是站起來走過去撥它 —— 一個躺在床上隔空把燈關掉
   * 的角色，那個伸手的動作會演在半空中。所以先離座，再轉身面向它。
   *
   * 附近沒有開關就什麼都不做，這是這個函式唯一的守門 —— 按鍵、行動版的徽章、之後任何新的觸發
   * 點都經過這裡，所以「不在開關旁邊按 Q 會發生什麼」只有一個答案。
   *
   * 動作用 `operate`（constants/interactionPostures.ts）：站著、抬起右手、按三下。那一列本來就
   * 是為了「操作一個控制器」寫的，而牆上的開關正是那個東西 —— 它不需要自己一個姿勢。
   *
   * `spot: null` 是「就地演」。家具會先被量出一個該站的位置（resolveStandSpot），開關沒有，也
   * 不需要：玩家已經走到它面前了，這裡只要把身體轉過去面對它。
   */
  const flipLightSwitch = useCallback(() => {
    if (!isCorrectInstance) return;
    const sw = nearestLightSwitch(position.current.x, position.current.z);
    if (!sw) return;
    leaveFurniture();
    // A fridge the player pressed E at a moment ago and then turned to the wall from is an action
    // abandoned, the same as walking off — see abandonAction.
    abandonAction();
    rotation.current = Math.atan2(sw.x - position.current.x, sw.z - position.current.z);
    actionPostureRef.current = {
      posture: 'operate', startedAt: performance.now(), spot: null, instanceId: null,
    };
    playLightSwitch(toggleInteriorLights());
  }, [isCorrectInstance, leaveFurniture, abandonAction]);

  // 點徽章（行動裝置）跟按 Q 走同一條路。用 window 事件而不是 triggerExternalAction，理由跟
  // 'dog' / 'tidy' 兩個分支一樣：那條路上有一個「附近沒有家具就什麼都不做」的守門，而開關不是
  // 家具。見 UI/LightSwitchPrompt.tsx。
  useEffect(() => {
    if (!isCorrectInstance) return;
    const onToggle = () => flipLightSwitch();
    window.addEventListener('lightswitch-toggle', onToggle);
    return () => window.removeEventListener('lightswitch-toggle', onToggle);
  }, [isCorrectInstance, flipLightSwitch]);

  /**
   * 跟居民說話 —— 玩家這一側的回應。
   *
   * 對話本身（說哪一句、她做什麼手勢）是 NpcWalker 的事；這裡只做玩家的身體：轉過去面向她，第一次
   * 按是揮手打招呼（`greet`），之後每按一次是一個接話的小動作（`chat`）。兩個都是 acting posture，
   * 所以取消規則跟開冰箱完全一樣 —— 走開、表情動作、換場景都會停下來，不需要另一套。
   *
   * 聽的是事件而不是 handleAction 的那個分支，因為手機上點浮動徽章不經過 handleAction：兩個入口
   * 送同一個事件，玩家的反應就只有一份。
   */
  useEffect(() => {
    if (!isCorrectInstance) return;
    const onNpc = (e: Event) => {
      const npc = playerBus.npcTarget;
      const npcId = (e as CustomEvent<{ npcId?: string }>).detail?.npcId;
      if (!npc || npc.npcId !== npcId) return;
      leaveFurniture();
      abandonAction();
      rotation.current = Math.atan2(npc.anchor.x - position.current.x, npc.anchor.z - position.current.z);
      actionPostureRef.current = {
        posture: npc.talking ? 'chat' : 'greet',
        startedAt: performance.now(),
        spot: null,
        instanceId: null,
      };
    };
    window.addEventListener('npc-interact', onNpc);
    return () => window.removeEventListener('npc-interact', onNpc);
  }, [isCorrectInstance, leaveFurniture, abandonAction]);

  /**
   * 照顧寵物 —— 玩家這一側的身體。
   *
   * 摸摸、放碗、丟玩具，寵物那一側全部在 Three/IslandPet.tsx；這裡只讓玩家轉過去、做出對應的動作，
   * 用的是本來就有的兩個姿勢：`tend`（蹲低、單手往下 —— 摸一隻膝蓋高的動物、把碗放到地上，正好
   * 就是這個身體語言）與 `toss`（丟飛盤的那一下）。沒有第二套寵物動畫。
   *
   * 摸摸的每一下（`pat`）只在上一次蹲下已經做完時才重新蹲 —— 連點十下不是十次重新起蹲，而是一個
   * 跟著點擊節奏、一次一次摸下去的樣子。
   */
  useEffect(() => {
    if (!isCorrectInstance) return;
    const act = (x: number, z: number, posture: PostureId) => {
      leaveFurniture();
      abandonAction();
      rotation.current = Math.atan2(x - position.current.x, z - position.current.z);
      actionPostureRef.current = { posture, startedAt: performance.now(), spot: null, instanceId: null };
    };
    const onCare = (e: Event) => {
      const kind = (e as CustomEvent<{ kind?: string }>).detail?.kind;
      const pet = playerBus.dogPos;
      if (!pet) return;
      if (kind === 'pat' && actionPostureRef.current?.posture === 'tend') return;
      act(pet.x, pet.z, 'tend');
    };
    const onToss = (e: Event) => {
      const at = (e as CustomEvent<{ x?: number; z?: number }>).detail;
      if (at?.x === undefined || at?.z === undefined) return;
      act(at.x, at.z, 'toss');
    };
    window.addEventListener('pet-care-gesture', onCare);
    window.addEventListener('pet-toss', onToss);
    return () => {
      window.removeEventListener('pet-care-gesture', onCare);
      window.removeEventListener('pet-toss', onToss);
    };
  }, [isCorrectInstance, leaveFurniture, abandonAction]);

  const handleAction = useCallback(() => {
    const promptKey = playerBus.interactionPrompt?.key;

    if (promptKey === 'building') {
      if (nearbyBuilding) setCurrentView(View.BUILDING_INTERIOR);
      return;
    }
    if (promptKey === 'dog') {
      // The pet's interaction panel is otherwise opened by tapping the prompt (see
      // InteractionPrompt.tsx); routing E through the same event keeps the key consistent with what
      // the prompt offers, and - like every branch here - stops it from falling through to the
      // house.
      //
      // 餵食模式 splits the same slot in two, and the condition is deliberately IDENTICAL to the
      // badge's (InteractionPrompt.tsx): the key and the on-screen label must never offer different
      // things, which is the rule every branch in this function exists to keep.
      window.dispatchEvent(new CustomEvent(pendingPetFood ? 'pet-feed' : 'pet-interact'));
      return;
    }
    if (promptKey === 'merchant') {
      // 與旅行商人交易. Same shape as the two branches around it, and deliberately so: this
      // dispatches an event naming WHICH merchant, and something else decides what that opens.
      //
      // There is no `setCurrentView(View.LIMITED_SHOP)` here on purpose (§17). The avatar knows
      // it walked up to a merchant; it does not know — and must not learn — that this particular
      // merchant happens to run the 限時小攤. That link is data
      // (constants/merchants.ts's `shop`), it is read by the one component that owns the shop
      // session (UI/MerchantSession.tsx), and it re-checks the visit before opening anything —
      // so a press that lands in the same tick the merchant casts off opens nothing rather than
      // opening a shop that is no longer there.
      const merchantId = playerBus.merchantTarget?.merchantId;
      if (merchantId) {
        window.dispatchEvent(new CustomEvent('merchant-interact', { detail: { merchantId } }));
      }
      return;
    }
    if (promptKey === 'npc') {
      // 與居民聊天. An event naming WHICH resident, exactly like the merchant branch above: the
      // walker that draws her (Three/NpcWalker.tsx) decides what the press means — first line,
      // next line — and the listener below turns this body toward her and plays the gesture.
      // The floating badge sends the identical event, so a tap and the E key cannot diverge.
      const npcId = playerBus.npcTarget?.npcId;
      if (npcId) window.dispatchEvent(new CustomEvent('npc-interact', { detail: { npcId } }));
      return;
    }
    if (promptKey === 'tidy') {
      // 整理 the offline overgrowth the tracker is pointing at. Same shape as the branch above:
      // one event, handled by the feature that owns the write (UI/IslandTidy.tsx), so the key and
      // the on-screen badge can never do two different things.
      window.dispatchEvent(new CustomEvent('island-tidy'));
      return;
    }
    // 牆上的電燈開關以前也是這裡的一個分支，現在不是了：它按的是 Q，有自己的徽章，也就不再
    // 跟家具搶這一格。見下面的 handleKeyDown 和 UI/LightSwitchPrompt.tsx。

    // promptKey === 'interactable' — a piece of furniture. Also the safe fallback when no prompt
    // has been computed yet: acting on something genuinely in reach is always correct, and never
    // enters the house.
    //
    // Getting OFF comes first and does not consult the proximity scan at all. A player lying on a
    // bed has walked their own collider onto the mattress; whether the scan still likes the angle
    // they are at must not decide whether they can get up again.
    if (occupiedRef.current) {
      playSound(SoundEffect.TICK, 0.22);
      leaveFurniture();
      return;
    }

    const target = nearbyInteractionRef.current;
    if (!target) return;

    // The one sound every furniture interaction makes, played HERE rather than in the badge so
    // the E key and the on-screen button sound the same. A piece with a voice of its own (the
    // campfire's crackle, the well's splash) plays it on top, from its own model.
    playSound(SoundEffect.TICK, 0.22);

    // Starting something new ends whatever was still playing. Pressing E at the hob and then
    // again at the fridge beside it must not leave the hob's ignition scheduled behind the
    // fridge's door — one hand, one action.
    abandonAction();

    if (target.occupies && target.spot) {
      occupiedRef.current = target;
      setOccupied(target);
      /*
       * WALK ROUND TO THE OPEN SIDE FIRST, if the body is not already standing there.
       *
       * The entry point is the piece's own dismount step — the one spot it guarantees is clear
       * of itself on the side it opens onto — so the walk-up and the walk-away are the same
       * place, and a piece cannot be got onto from somewhere it cannot be got off at. Indoors it
       * is clamped into the room for the same reason the dismount is: the piece has no opinion
       * about the wall behind it. See SEAT_ENTRY_ARRIVED.
       *
       * Already there is the common case — you walked up to the front of the sofa and pressed E
       * — and it skips straight to the settle, so nothing about the ordinary interaction changes
       * its timing.
       */
      const entry = resolveEntryPoint(target.placement, target.spot, {
        x: position.current.x,
        z: position.current.z,
      });
      const landing = clampIntoWalkable(entry.x, entry.z, walkableRectsRef.current);
      seatApproachTargetRef.current.set(landing.x, 0, landing.z);
      const gap = Math.hypot(landing.x - position.current.x, landing.z - position.current.z);
      seatApproachActiveRef.current = gap > SEAT_ENTRY_ARRIVED;
      seatApproachDeadlineRef.current = performance.now() + SEAT_APPROACH_TIMEOUT_MS;
      // WHEN the weight landed — which is when the body ARRIVES, not when the key went down. The
      // piece's own model needs this to start its impulse, and it has to be the identical number
      // rather than a `performance.now()` sampled at the far end: that is the difference between
      // a seat and a rider that stay together for a minute and two animations that agree to
      // within a few milliseconds and then drift. See seatOccupyPendingRef for why a walk-up
      // defers it rather than sending it early.
      if (seatApproachActiveRef.current) {
        seatOccupyPendingRef.current = target;
      } else {
        announceOccupy(target);
      }
      return;
    }

    // An ACTING interaction: the body walks up to the piece, does the thing the piece is for,
    // and is handed back. The PIECE reacts too — see useObjectAnimation in Three/objectAnimation.tsx
    // and its table, constants/objectAnimations.ts.
    //
    // What used to be here turned the body roughly toward the prompt badge and started the one
    // shared arm-wave. Both halves are now the piece's own answer: `spot` squares the body up
    // against the face it is used from (so 泡澡 is no longer performed from wherever the player
    // was standing when they pressed E), and `posture` is a whole body rather than two arms.
    rotation.current = target.spot
      ? target.spot.yaw
      : Math.atan2(
        target.promptAnchor.x - position.current.x,
        target.promptAnchor.z - position.current.z,
      );
    // The face a piece is used from is the piece's own answer and takes no account of what is
    // behind it, so a wardrobe turned to face the wall it stands against resolves a spot 0.8
    // units inside that wall. The walk resolve would stop the body there anyway — this keeps the
    // TARGET legal too, so the ease settles at the wall instead of spending the whole posture
    // pulling against it. Outdoors there are no rectangles and this is the identity.
    const actionSpot = target.spot
      ? clampIntoWalkable(target.spot.x, target.spot.z, walkableRectsRef.current)
      : null;
    actionPostureRef.current = {
      posture: target.posture,
      startedAt: performance.now(),
      spot: actionSpot && target.spot ? { x: actionSpot.x, z: actionSpot.z, yaw: target.spot.yaw } : null,
      instanceId: target.instanceId,
    };
    /*
     * WHO IS DOING IT, AND FROM WHERE — the half of the interaction event that was missing, and
     * the reason a frisbee flew the same way whichever side of it you stood on.
     *
     * The piece's own reaction (constants/objectAnimations.ts) could only ever be expressed
     * against the MODEL's axes, so anything that left the ground was welded to the placement's
     * rotation. A ball has no opinion about which way it should go; the person kicking it does.
     * So the press carries the thrower.
     *
     * It is the RESOLVED spot rather than wherever the player happened to be standing when the
     * key went down: the controller has just squared the body up against the piece (`rotation`
     * above, and the body eases to `spot` over the posture), so this is where the body actually
     * IS at the moment the disc leaves the hand. Sending the pre-press pose would aim the throw
     * somewhere the animation never looked.
     *
     * Only pieces that declare a `launch` read it, and one that gets no context resolves no
     * heading rather than falling back to a constant — see resolveAim in Three/objectAnimation.
     */
    window.dispatchEvent(new CustomEvent('furniture-interact', {
      detail: {
        instanceId: target.instanceId,
        itemId: target.itemId,
        kind: target.interaction.kind,
        player: {
          x: target.spot ? target.spot.x : position.current.x,
          z: target.spot ? target.spot.z : position.current.z,
          yaw: rotation.current,
        },
      },
    }));
  }, [nearbyBuilding, leaveFurniture, setCurrentView, pendingPetFood]);

  // The display name AppContext carries for the prompt. The VERB that goes with it travels on
  // playerBus (see the proximity scan below) rather than through React state, because it changes
  // at walking speed and nothing but the badge reads it.
  useEffect(() => {
    if (isCorrectInstance) {
      setNearbyInteractable(nearbyInteraction?.itemName ?? null);
    }
  }, [nearbyInteraction, setNearbyInteractable, isCorrectInstance]);
  const position = useRef(new THREE.Vector3(0, 0, 0));
  const rotation = useRef(0);
  const isMoving = useRef(false);
  const isSwimmingRef = useRef(false);
  /**
   * Footstep material of the placed deck the player is standing on this frame, or null when they
   * are on the island itself. Written by whichever collision resolve ran (moving or idle), read by
   * the footstep block far below - which is the only reason it is a ref rather than a local: the
   * two are in the same useFrame but separated by ~350 lines of pose work.
   */
  const supportFootstepRef = useRef<'wood' | 'stone' | null>(null);
  const currentTerrain = useRef<string | null>(null);

  // Custom states and refs for swimming state machine & visual water ripples
  const movementStateRef = useRef<'walking' | 'enteringWater' | 'swimming' | 'exitingWater'>('walking');
  const transitionTimerRef = useRef(0);
  // Last swim state seen by the audio block - edge-detected to fire the one-shot
  // entry/exit plunge splashes exactly once per shoreline crossing.
  const prevSwimStateRef = useRef<'walking' | 'enteringWater' | 'swimming' | 'exitingWater'>('walking');
  // sin(stroke phase) from the previous frame - a zero crossing means a hand just
  // pierced the surface, which is when the stroke-synced splash one-shot fires.
  const lastStrokeSinRef = useRef(0);
  // The body pitch as actually rendered while in the water, kept so the land pose can be
  // handed a real angle when the character steps ashore (see applyGroundOrientation).
  // It used to also absorb a ~164deg target flip between a prone "moving" pose and a
  // supine "idle" one; there is only one water pose now, so nothing flips - see swimPose.ts.
  const swimPitchRef = useRef(0);

  /**
   * The water animation's entire state, and the reason there is no longer a pose to
   * "transition" between. See swimPose.ts for what each one means and why it is a weight
   * rather than a branch.
   *
   * `pose` and `stroke` are smoothed here rather than at their use sites so that every
   * limb chain, the body pitch and the float height are all reading the SAME number on the
   * same frame - the previous code eased the pitch at 5.5/s while the limbs switched
   * instantly, so even where the two agreed on a destination they never arrived together.
   */
  const swimPoseRef = useRef(0);
  const swimStrokeRef = useRef(0);
  const swimPhaseRef = useRef(0);
  /** Actual horizontal speed last frame, world units/s - drives the stroke rate. */
  const swimSpeedRef = useRef(0);
  /** Travel direction in the body's own frame, smoothed. See SwimDrive. */
  const swimDriveRef = useRef({ forward: 1, strafe: 0 });
  /**
   * Which way the stroke cycle runs, eased between +1 and -1 rather than switched: turning
   * round to swim back the way you came slows the arms, stills them, and starts them the
   * other way, which is what changing direction in water looks like. A hard sign flip would
   * be a one-frame reversal of every limb.
   */
  const swimCycleDirRef = useRef(1);
  /**
   * The support height the body is being drawn at this frame - terrain, floor, or the blended
   * swim depth - published for the camera as `playerBus.bodyRootY`.
   *
   * Assigned wherever `targetY` is resolved below, i.e. BEFORE the jump arc, the somersault's
   * pivot offset and the crawl lift are added on top of it: those are gestures the shot is meant
   * to SHOW happening, and a camera that followed them would cancel them out of the picture. What
   * is left is exactly the part of the body's height the framing has to track - see
   * constants/cameraFocus.ts.
   */
  const bodyRootYRef = useRef(0);
  // The body's yaw and forward tilt as actually rendered. Held here rather than read back off
  // groupRef.current.rotation, which is not a safe place to keep them - see applyGroundOrientation.
  const bodyYawRef = useRef(0);
  const bodyTiltRef = useRef(0);
  const ripple1Ref = useRef<THREE.Mesh>(null);
  const ripple2Ref = useRef<THREE.Mesh>(null);
  const splashParticlesRef = useRef<THREE.Group>(null);

  // Stylized footstep VFX (Animal-Crossing-style poof), one burst per footfall.
  // Profiles and pool sizes live at module scope - see FOOTSTEP_VFX above.
  const puffMeshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const puffState = useRef(
    Array.from({ length: FOOTSTEP_PUFF_POOL }, () => ({
      life: 0, lifetime: 1, x: 0, y: 0, z: 0, vx: 0, vz: 0,
      rise: 0, startScale: 0, endScale: 0, opacity: 0,
    }))
  );
  const nextPuffIndex = useRef(0);

  const ringMeshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const ringState = useRef(
    Array.from({ length: FOOTSTEP_RING_POOL }, () => ({
      life: 0, lifetime: 1, x: 0, y: 0, z: 0, radius: 0, opacity: 0,
    }))
  );
  const nextRingIndex = useRef(0);

  /**
   * Fires one footfall's worth of VFX.
   *
   * `groundY` must be the height the character's feet are actually standing at, NOT a constant:
   * the previous version hard-coded y = 0.06 while feet sit at the terrain height (0.3 on grass,
   * 0 indoors), so every puff spawned a quarter of a unit below the ground and was silently
   * occluded by the island mesh - the effect was in the code but never visible.
   *
   * `facing` is the body's yaw, used to place the burst under the correct foot and to trail it
   * backwards; `footSign` alternates +1/-1 with the walk cycle so left and right steps land on
   * opposite sides of the body's centre line.
   */
  const spawnFootstepVfx = (
    x: number,
    z: number,
    groundY: number,
    facing: number,
    terrain: FootstepTerrain,
    footSign: number
  ) => {
    const profile = FOOTSTEP_VFX[terrain] ?? FOOTSTEP_VFX.grass;

    // forward = (sin yaw, cos yaw), so this is its perpendicular (which side is "left" is
    // cosmetic - footSign alternates regardless) and its negation is "behind the walker".
    const sideX = Math.cos(facing);
    const sideZ = -Math.sin(facing);
    const backX = -Math.sin(facing);
    const backZ = -Math.cos(facing);

    const footX = x + sideX * 0.11 * footSign;
    const footZ = z + sideZ * 0.11 * footSign;

    for (let i = 0; i < profile.count; i++) {
      const idx = nextPuffIndex.current;
      nextPuffIndex.current = (idx + 1) % FOOTSTEP_PUFF_POOL;

      const s = puffState.current[idx];
      s.life = 1.0;
      // Jitter every per-particle quantity: identical particles read as a single graphic
      // rather than as loose material being kicked up.
      s.lifetime = profile.lifetime * (0.85 + Math.random() * 0.3);
      s.x = footX + (Math.random() - 0.5) * profile.spread;
      s.z = footZ + (Math.random() - 0.5) * profile.spread;
      s.y = groundY;
      const drift = profile.drift * (0.5 + Math.random());
      s.vx = backX * drift + (Math.random() - 0.5) * profile.spread * 0.8;
      s.vz = backZ * drift + (Math.random() - 0.5) * profile.spread * 0.8;
      s.rise = profile.rise * (0.7 + Math.random() * 0.6);
      s.startScale = profile.startScale;
      s.endScale = profile.endScale * (0.75 + Math.random() * 0.5);
      s.opacity = profile.opacity;

      const mesh = puffMeshRefs.current[idx];
      if (mesh) {
        const palette = profile.colors;
        (mesh.material as THREE.MeshBasicMaterial).color.set(
          palette[(Math.random() * palette.length) | 0]
        );
      }
    }

    if (profile.ring) {
      const idx = nextRingIndex.current;
      nextRingIndex.current = (idx + 1) % FOOTSTEP_RING_POOL;

      const r = ringState.current[idx];
      r.life = 1.0;
      r.lifetime = profile.ring.lifetime;
      r.x = footX;
      r.z = footZ;
      r.y = groundY;
      r.radius = profile.ring.radius;
      r.opacity = profile.ring.opacity;

      const mesh = ringMeshRefs.current[idx];
      if (mesh) {
        (mesh.material as THREE.MeshBasicMaterial).color.set(profile.ring.color);
      }
    }
  };

  // Footsteps (grass/sand/wood/stone) and the swim ambience are both synthesized
  // locally via Web Audio (see soundUtils.ts) - no remote audio files to preload.
  const audioUnlocked = useRef(false);

  // 佈置模式 footstep tracking - see the build-mode branch in useFrame. Held
  // separately from the avatar's own walkPhase because the edit camera has no
  // walk cycle to hang a cadence off; these count ground covered instead.
  const buildStepPrevPos = useRef<THREE.Vector3 | null>(null);
  const buildStepDistance = useRef(0);
  const buildStepSide = useRef(1);

  // The footstep puff/ring pools mount VISIBLE (at opacity 0) and are only hidden after this many
  // frames. three compiles a program the first time a mesh is drawn and skips invisible ones, so
  // pools that mounted hidden compiled on the first footfall instead - a ~60-130 ms freeze on the
  // first step of every session. Drawn transparent at opacity 0 with depthWrite off, the warm-up
  // frames change no pixel.
  const vfxWarmFrames = useRef(2);

  useEffect(() => {
    const unlockAudio = () => {
      if (audioUnlocked.current) return;
      primeSynthAudio(); // create/resume the shared AudioContext within this user gesture
      audioUnlocked.current = true;
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };

    window.addEventListener('click', unlockAudio);
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    return () => {
      stopSwimAmbience();
      stopBeachSurfAmbience();
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, []);
  
  // Animation state
  const walkPhase = useRef(0);
  const idlePhase = useRef(0);
  const moveWeight = useRef(0);
  const lastFootstepPhase = useRef(0);

  // Blinking - randomized interval with a fast smooth close/open (was a single sin() gate
  // that only produced a ~4s eyes-shut every ~60s, which read as broken rather than alive)
  const BLINK_DURATION = 0.15;
  const blinkTimerRef = useRef(1.5 + Math.random() * 3);
  const blinkProgressRef = useRef(0);
  const isBlinkingRef = useRef(false);

  // Idle head look-around - glances toward a new random point every few seconds, fades out
  // as soon as the player starts moving (blended via moveWeight alongside the other idle head motion)
  const lookTargetYRef = useRef(0);
  const lookTargetXRef = useRef(0);
  const smoothedLookYRef = useRef(0);
  const smoothedLookXRef = useRef(0);
  const lookChangeTimerRef = useRef(2 + Math.random() * 3);

  // Long hair follow-through sway
  const longHairRef = useRef<THREE.Group>(null);

  // Facial expression - happy squint/smile driven by emotes and a short reaction pulse
  // (e.g. noticing a building), independent of the blink timer above
  const mouthRef = useRef<THREE.Group>(null);
  const happyPulseRef = useRef(0);
  const lastHappyReactionCountRef = useRef(0);

  // Somersault squash & stretch - the flip's in-flight curve already ends "squashed" at
  // touchdown; this ref just carries that squashed pose back to neutral over
  // LANDING_RECOVERY_DURATION once the flip ends, instead of the scale snapping back to
  // (1,1,1) on the same frame the animation flag clears.
  //
  // The JUMP no longer uses it. Its landing recovery is the 'land' phase of the jump state
  // machine (Three/jumpPose.ts), which unwinds the pose and the squash together rather than
  // leaving the limbs to the walk cycle and springing the scale back on its own.
  const LANDING_RECOVERY_DURATION = 0.2;
  const landingSquashRef = useRef(0);
  const SQUASH_STRETCH_Y = 0.06; // was 0.15 - toned down after feedback that it read as too exaggerated
  const SQUASH_STRETCH_XZ = 0.035; // was 0.1

  // Weather reactions while idle - a sustained cold huddle for rain/storm/snow, and an
  // occasional stretch burst for sunny weather (a held stretch pose would look odd, so this
  // fires periodically like the idle look-around timer rather than staying on constantly).
  const weatherStretchTimerRef = useRef(4 + Math.random() * 4);
  const weatherStretchPulseRef = useRef(0);
  const WEATHER_STRETCH_DURATION = 2.2;

  /**
   * THE FURNITURE POSE TRANSITION — 0 = standing, 1 = fully settled onto the piece.
   *
   * One timeline for sitting and for lying alike (it was the hammock's, and is now every piece's):
   * it rises while getting on — staged, so the recline lags behind the climb — and falls while
   * getting off, so the dismount eases toward `poseExitTargetRef` instead of teleporting.
   *
   * Sitting is quicker than lying because it is a smaller move: you drop onto a seat, you climb
   * into a hammock; lowering yourself into a bath is somewhere between the two.
   *
   * Keyed by POSTURE, so a fourth occupying posture brings its own timing with it rather than
   * being forced to borrow one of two. `?? ` picks the lying pace for anything unlisted, which
   * is the slower and therefore safer default for a move nobody has timed yet.
   */
  const POSE_MOUNT_DURATION: Partial<Record<PostureId, number>> = { sit: 0.45, lie: 0.9, bathe: 0.8, swing: 0.6 };
  // 盪鞦韆 gets the slowest dismount of the four, and for a reason the others do not have: the
  // seat is still swinging when the rider lets go, so the body has to unhook from an arc rather
  // than stand up off a still surface. 0.7 s is about a quarter of the swing's own period, which
  // is enough for the body's share of the motion to fade out before it is back on its feet — the
  // brief's 「不要直接停止動畫，玩家瞬間站回地面」.
  const POSE_DISMOUNT_DURATION: Partial<Record<PostureId, number>> = { sit: 0.35, lie: 0.5, bathe: 0.55, swing: 0.7 };
  const poseProgressRef = useRef(0);
  const poseExitTargetRef = useRef(new THREE.Vector3());
  /**
   * WHEN THE PLAYER GOT ONTO THE PIECE THEY ARE ON — the controller's half of the swinging-
   * furniture handshake (lib/outdoorMotion.ts).
   *
   * Written in `handleAction` and `leaveFurniture` with the same timestamps those two put on the
   * `furniture-occupy` / `furniture-release` events, so the piece's own model and this file are
   * evaluating one function with one set of arguments. Nothing here decides how far anything
   * swings; that is the spec's job.
   */
  const suspendedTimelineRef = useRef<SuspendedTimeline>({ mountedAt: null, releasedAt: null, rode: 0 });
  /**
   * The body's displacement along the arc this frame, world units, and the rise it is carrying.
   *
   * Held as refs rather than locals because the two are applied at opposite ends of the frame:
   * the occupancy block computes them, and the single `groupRef.position.set` that every branch
   * funnels through (far below) adds them. Keeping the offset OUT of `position.current` is
   * deliberate — that vector is the player's logical spot on the island, which the swing does not
   * move; only the drawn body goes over the top of the arc.
   */
  const occupantOffsetRef = useRef(new THREE.Vector3());
  const occupantRiseRef = useRef(0);
  /**
   * The piece being got off, held separately from `occupied` (which is already null by then) so
   * the dismount can finish against the anchor it started from. Walking away during the ease can
   * carry the player out of the piece's own reach before the animation is done, and reading the
   * live proximity scan there would drop the pose mid-transition.
   */
  const posePieceRef = useRef<InteractionTarget | null>(null);

  /**
   * THE ACTING POSTURE — the interaction the player triggered that does not put them on the
   * piece, while it is still playing.
   *
   * This used to be one number (`useGestureRef`, a timestamp) because there was only ever one
   * thing it could be doing: a 0.7 s two-armed reach, the same for a bathtub, a hob, a telescope
   * and a wishing well. It now carries WHICH posture and WHERE, because those are the two things
   * that make 烹飪 look like cooking and 觀星 look like looking up:
   *
   *   `posture`  a row in constants/interactionPostures.ts — the full-body target.
   *   `startedAt`the clock the envelope and every repeating motion are read against.
   *   `spot`     where to stand and which way to face, measured off the piece
   *              (lib/furnitureInteraction.ts's resolveStandSpot). Null only for a piece that
   *              has never been measured, in which case the body simply acts where it is.
   */
  const actionPostureRef = useRef<{
    posture: PostureId;
    startedAt: number;
    spot: { x: number; z: number; yaw: number } | null;
    /**
     * WHICH placed piece this action is aimed at, or null for one that is not a piece (a light
     * switch, crouching to a pet). Carried so that abandoning the action can cancel THAT piece's
     * scheduled reaction and nothing else — see `abandonAction`.
     */
    instanceId: string | null;
  } | null>(null);

  /**
   * The world point the floating badge hangs over, rewritten in place every frame.
   *
   * One vector rather than a fresh one per change: this is published on playerBus and read by the
   * tracker inside the Canvas, which copies it, so there is no reason to allocate — and it has to
   * be updated every frame anyway (see the scan below).
   */
  const promptAnchorRef = useRef(new THREE.Vector3());
  /**
   * The footprint version the current interaction record was described against. A piece measures
   * itself one frame after its model mounts (lib/furniturePlacement.ts), so a record built before
   * that carries the fallback anchor — this is what makes it get rebuilt once, on the frame the
   * real measurement lands, instead of every frame or never.
   */
  const describedVersionRef = useRef(-1);
  /** Where the player was standing when that record was built — see the proximity scan. */
  const describedFromRef = useRef(new THREE.Vector3());

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isCorrectInstance) return;
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(key)) {
        keysRef.current[key as 'w' | 'a' | 's' | 'd'] = true;
        leaveFurniture(); // Walking off a seat is a way of getting up
        // Moving cancels a GESTURE (wave, celebrate, dance) - you stop posing to walk off. It
        // must not cancel the crawl, because crawling IS a way of moving: this reset used to be
        // unconditional, so the first movement key ended the crawl before it could travel even
        // one frame. That left the crawl speed below and the slowed crawl walk-cycle as code
        // that could never run - `emote` was never 'CRAWL' on a frame the player was moving.
        setEmote(prev => (prev === 'CRAWL' ? prev : 'NONE'));
        // Same rule for an acting posture, and it matters more now than it did when this was a
        // 0.7s arm-wave: 觀星 holds for 2.6 seconds, and a player who has decided to walk away
        // should not be dragged back to the telescope by the spot-easing below. abandonAction
        // also tells the piece, so a reaction still waiting on its cue does not play to nobody.
        abandonAction();
        window.dispatchEvent(new CustomEvent('player-moved'));
      }
      if (key === 'e' || key === ' ') {
        if (key === ' ') {
          // Just a request. Whether it becomes a jump — and whether a jump pressed in mid-air
          // is dropped or held for the landing — is decided by the state machine against the
          // physics (see jumpPose.ts's stepJump), not here against a boolean. The old guard
          // (`!isJumping && !isFlipping`) is what made this handler depend on `isJumping`, and
          // therefore what tore both window listeners down and rebuilt them twice per hop.
          jumpRequestRef.current = true;
        } else {
          handleAction();
        }
      }

      // Q — 牆上的電燈開關，自己一個鍵。
      //
      // 不跟 E 共用，因為它不跟家具競爭：一個站在沙發旁邊牆邊的玩家，E 是坐下、Q 是關燈，兩件
      // 事同時有意義。以前它是 E 的其中一個候選人，結果房裡只要有任何一件家具離你更近，開關就
      // 永遠按不到，玩家會以為那面牆上根本沒有開關。
      //
      // 附近沒有開關的時候 flipLightSwitch 自己會什麼都不做（nearestLightSwitch 回 null），
      // 所以這裡不需要再問一次「現在在不在室內」。
      if (key === 'q') {
        flipLightSwitch();
      }

      // Emotes
      if (key === '1') {
        if (!isFlipping) {
          setIsFlipping(true);
          flipStartTime.current = performance.now();
          leaveFurniture();
          abandonAction();
        }
      }
      if (key === '2') {
        setEmote(prev => prev === 'CRAWL' ? 'NONE' : 'CRAWL');
        leaveFurniture();
        abandonAction();
      }
      if (key === '3') {
        setEmote(prev => prev === 'DANCE' ? 'NONE' : 'DANCE');
        leaveFurniture();
        abandonAction();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(key)) {
        keysRef.current[key as 'w' | 'a' | 's' | 'd'] = false;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
    // `emote` and the furniture occupancy are deliberately NOT dependencies: this handler only
    // ever WRITES them, and does so without reading the current value (setEmote takes a functional
    // updater, leaveFurniture reads its own ref). Listing them tore down and re-added both window
    // listeners on every crawl/dance toggle for no behavioural gain. `isFlipping` is a real
    // dependency - the double-flip guard below reads it. The jump no longer needs one: it
    // writes a request ref and the per-frame state machine owns the guard.
  }, [handleAction, leaveFurniture, abandonAction, flipLightSwitch, isCorrectInstance, isFlipping]);

  // A held movement key is only released by a `keyup` that the page actually receives - and it does
  // not receive one when focus leaves mid-press (a native context menu opening over the game, an
  // alt-tab, a tab switch). The key then stays latched true for the rest of the session, so the
  // character keeps walking on its own with no input: outdoors that reads as drifting, and indoors
  // it pins the avatar against a wall or doorway with movement that never stops - the "character
  // won't respond / is stuck inside the house" symptom.
  //
  // CameraController already did this for its own build-mode keys and the virtual joysticks, but
  // these - the keys that actually move the player - were never covered. Both now hang off the one
  // shared focus signal (see lib/inputManager.ts) rather than each registering its own listeners.
  useEffect(() => {
    return subscribeFocusSuspension(() => {
      keysRef.current.w = false;
      keysRef.current.a = false;
      keysRef.current.s = false;
      keysRef.current.d = false;
    });
  }, []);

  const equipped = (equippedOverride ?? profile?.equippedItems ?? []).map(id => getItemById(id)).filter(Boolean);

  /**
   * Every placed piece that offers an interaction, resolved ONCE per change to the save instead
   * of once per frame — and drawn from whichever world this avatar is standing in, which is the
   * whole reason the house now has interactive furniture at all.
   *
   * The proximity scan in useFrame used to run `islandPlacements.map(...).filter(...)` twice on
   * every single frame - two intermediate arrays plus one wrapper object per placement per pass,
   * plus a getItemById lookup each, 60 times a second, to answer a question whose inputs only
   * change when the player places or removes furniture. On a decorated island that is the biggest
   * source of steady garbage in the loop, and the resulting GC pauses are the frame stutter.
   *
   * What genuinely does change per frame is only the DISTANCE from the player to each of these,
   * so that is all the loop still computes; the list itself is stable here. A fully furnished
   * house is ~30 placements of which a handful are interactive, so the per-frame work is a
   * handful of squared-distance compares (see findNearbyInteraction's early reject).
   */
  const placements = isInterior ? profile?.interiorData?.placements : profile?.islandPlacements;
  const interactableCandidates = useMemo(
    () => (placements || []).filter((p) => hasFurnitureInteraction(p.itemId)),
    [placements],
  );

  /**
   * Nothing may keep the body parked on furniture that is no longer there.
   *
   * Two ways that happens and both end the same: the player leaves this view (the interior
   * avatar's scene unmounts under it), or they pick the piece up in build mode. Without this the
   * occupancy survives as a pose anchored to a spot with nothing under it — a character sitting
   * in mid-air where a sofa used to be.
   */
  useEffect(() => {
    if (!isCorrectInstance) {
      leaveFurniture();
      // Walking out through the front door mid-烹飪 is abandoning the action too: the pose must
      // not resume on return, and a cue that had not landed must not land in an empty kitchen.
      abandonAction();
      return;
    }
    const seat = occupiedRef.current;
    if (seat && !interactableCandidates.some((p) => p.instanceId === seat.instanceId)) {
      leaveFurniture();
    }
    // The same for a piece picked up in build mode while the player was using it.
    const acting = actionPostureRef.current;
    if (acting?.instanceId && !interactableCandidates.some((p) => p.instanceId === acting.instanceId)) {
      abandonAction();
    }
  }, [isCorrectInstance, interactableCandidates, leaveFurniture, abandonAction]);

  // The player's single Home - the only structure that can be entered.
  const home = usePlayerHome(profile);

  /**
   * WHAT is worn, resolved from the equipped items. WHERE any of it goes is the model's
   * answer, not this file's - see Three/character/outfit.ts.
   */
  // Keyed on the equipped ID LIST rather than on `equipped`, which is rebuilt every render
  // by the map/filter above and would defeat the memo entirely.
  const equippedKey = (profile?.equippedItems || []).join('|');
  const outfit = useMemo(
    () => resolveCharacterOutfit(equipped.filter((item): item is NonNullable<typeof item> => Boolean(item))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [equippedKey],
  );

  /**
   * Which character model to draw, and the joint heights that come with it.
   *
   * The animation below does not branch on this even once. Both procedural models and the
   * authored one expose the same rig at the same joints, so everything from the swim state
   * machine to the footstep VFX runs identically whichever is selected - which is what makes
   * this a swap rather than a fork. See constants/characterModel.ts for the selector and
   * Three/character/index.tsx for the registry.
   */
  const characterModelId = useCharacterModel();
  const skeleton = getCharacterModelDefinition(characterModelId).skeleton;
  /**
   * The house's walkable rectangles, for the ONE movement that is not collision-resolved: the
   * step off a piece of furniture. See clampIntoWalkable.
   *
   * Built with the same clearance the walk resolve uses (characterMovement.ts's `wallClearance`),
   * so a dismount cannot land the body anywhere ordinary walking would be stopped — the two
   * would otherwise disagree by the width of a head and the body would pop on the frame the
   * dismount handed control back. Null outdoors, where there is nothing to be inside of.
   */
  const walkableRects = useMemo(
    () => (currentView === View.BUILDING_INTERIOR
      ? buildWalkableRects(
        toShellRooms(parseUnlockedRooms(profile?.interiorData?.unlockedRooms)),
        bodyClearanceRadius(skeleton),
      )
      : null),
    [currentView, profile?.interiorData?.unlockedRooms, skeleton],
  );
  /**
   * The camera this avatar is being looked at through — read for its NEAR PLANE and nothing else.
   * The two canvases differ (0.5 on the island, 0.3 indoors), and the near plane is what decides
   * how close the camera can come before it starts cutting this body open, so the proximity fade
   * has to ask rather than assume. See cameraProximityOpacity.
   */
  const { camera } = useThree();

  /**
   * The two joint heights the animation RE-ASSERTS every frame, so they cannot be model-
   * owned: the idle bob, the celebrate pump and the swim float all animate around them.
   * Everything else about the skeleton - shoulders, hips, limb lengths - is the model's,
   * because this loop writes rotation only there.
   */
  const BASE_HEAD_Y = skeleton.head.y;
  const BASE_BODY_Y = skeleton.torso.y;
  const baseScale = CHARACTER_ROOT_SCALE;

  /**
   * The somersault turns about the body's centre of mass rather than the root's origin at
   * the feet, which is what stops it reading as a cartwheel over the toes. Derived from the
   * active skeleton so a model with a different torso height still spins about ITS centre.
   */
  const FLIP_PIVOT_LOCAL_Y = flipPivotLocalY(skeleton);

  /** Passed to the model; nothing here reads it back. */
  const rig: CharacterRig = useMemo(() => ({
    head: headRef, torso: bodyRef,
    leftArm: leftArmRef, rightArm: rightArmRef,
    leftLeg: leftLegRef, rightLeg: rightLegRef,
    eyeL: eyeLRef, eyeR: eyeRRef, mouth: mouthRef,
    hairSway: longHairRef,
  }), []);

  /**
   * The joints a furniture posture is allowed to drive, by the names the posture table speaks
   * (constants/interactionPostures.ts's RigJointName).
   *
   * It is deliberately the SAME object the character model is handed: a posture that says
   * "rightArm" and a model that binds "rightArm" are talking about one joint by one name, with
   * no lookup table in between that could fall out of step. Widening a posture to a two-segment
   * arm is then adding `leftLowerArm` to CharacterRig and to RigJointName — this line does not
   * change.
   */
  const postureJoints: PostureJointRefs = rig;

  /**
   * 右手臂那個 group 本身，也就是蠟燭 portal 的目標。
   *
   * 用 state 而不是直接在 render 裡讀 `rightArmRef.current`：第一次 render 的時候 ref 還是
   * null，而 ref 被填上這件事不會觸發重繪 —— 蠟燭於是永遠不會被掛上去。所以要有一個地方看著
   * 那個 ref，等它被填上（或被換掉）的時候把它推進 state，那一次重繪才是蠟燭真正進到手裡的
   * 時候。
   *
   * 為什麼是每幀看一次而不是一個 effect：換模型不是這個 group 唯一會被換掉的時機。自製 3D 模型
   * 的每個部位都包在 `<Suspense>` 裡（見 character/AuthoredCharacterModel.tsx），GLB 還在載
   * 的時候綁 ref 的是 fallback 的 legacy 手臂，載完之後換成 Joint 綁 —— 同一個 modelId，卻是
   * 兩個不同的 group，而且中間沒有任何 render 或 effect 會通知這裡。只看 modelId 的 effect 會
   * 把蠟燭掛在那個已經被卸下來的 fallback 手臂上，於是蠟燭什麼都不照、也看不見。
   *
   * 指標比對，同一個 group 的時候不做任何事，所以這一段實際上一整場只會跑到兩次。
   */
  const [handHost, setHandHost] = useState<THREE.Group | null>(null);
  const handHostRef = useRef<THREE.Group | null>(null);


  useFrame((state, rawDelta) => {
    // See CameraController.tsx / playerBus.ts for why: a tab/window regaining focus after being
    // backgrounded can hand this useFrame a `delta` of several real seconds on its first frame
    // back, which would otherwise fling the player across the map (speed*delta movement step) or
    // snap-turn them instantly (this avatar's yaw follows the camera's facing in first person -
    // see targetRot below - so a camera that spun during that same window would drag the avatar's
    // head/body along with it).
    const delta = clampFrameDelta(rawDelta);
    const time = state.clock.getElapsedTime();

    // 蠟燭要掛的那個關節。理由見 handHost 上面那一段 —— ref 被填上或被換掉都不會通知 React，
    // 所以由這裡看著，而且只在真的換了的那一幀才 setState。
    if (handHostRef.current !== rightArmRef.current) {
      handHostRef.current = rightArmRef.current;
      setHandHost(rightArmRef.current);
    }

    // Failsafe end-of-flip. The somersault's own `setIsFlipping(false)` lives in
    // the idle "Standing up" branch far below, which a hammock dismount still
    // unwinding (poseProgressRef > 0) keeps from running at all. isFlipping
    // is a hard gate on both movement (isControlActive) and on re-triggering the
    // emote, so a flip that never gets to finish leaves the character frozen and
    // the 空翻 button dead for the rest of the session. The clock is the real
    // authority on when the move is over, so end it here whatever else the frame
    // is doing; the grace margin keeps this off the normal path.
    if (isFlipping && (performance.now() - flipStartTime.current) / 1000 > FLIP_DURATION + 0.25) {
      setIsFlipping(false);
    }

    // Consume a one-shot position/facing handoff from the build-mode free camera (see
    // CameraController.tsx's mode-transition effect). Applied before any collision/rendering
    // logic below so the player appears at the free camera's last spot on the very same frame
    // build mode ends, instead of snapping back to wherever they were frozen since entering it.
    if (isCorrectInstance) {
      const pendingTeleport = playerBus.pendingPlayerTeleport;
      if (pendingTeleport) {
        position.current.x = pendingTeleport.x;
        position.current.z = pendingTeleport.z;
        if (typeof pendingTeleport.rotation === 'number') {
          rotation.current = pendingTeleport.rotation;
        }
        playerBus.pendingPlayerTeleport = undefined;
      }
    }

    // React to UI-layer events (successful shop purchase, territory expansion, ...) with the
    // same happy-squint pulse used for spotting a nearby building - compares against the last
    // seen count rather than consuming/resetting it, so a trigger between frames or several in
    // quick succession are never missed or double-counted.
    if (isCorrectInstance) {
      const currentHappyReactionCount = playerBus.happyReactionCount || 0;
      if (currentHappyReactionCount !== lastHappyReactionCountRef.current) {
        lastHappyReactionCountRef.current = currentHappyReactionCount;
        happyPulseRef.current = 1;
      }
    }

    // Smooth the fade toward its raw target over real elapsed time (see smoothedZoomOpacityRef
    // above for why this can't just read the target directly).
    //
    // TWO INPUTS, whichever is more hidden. The ZOOM one is the player deliberately climbing into
    // their own head, and it now finishes exactly where first person begins rather than at
    // ZOOM_MAX (see avatarZoomOpacity). The PROXIMITY one is the camera being pushed into the
    // head by geometry - walk into a wall indoors and the arm has nowhere left to go - which the
    // zoom knows nothing about, so the camera publishes its own distance for it.
    const targetZoomOpacity = isDressingRoom
      ? 1.0
      : Math.min(avatarZoomOpacity(uiScale), cameraProximityOpacity(playerBus.cameraPivotDistance, skeleton, camera.near));
    smoothedZoomOpacityRef.current = THREE.MathUtils.lerp(
      smoothedZoomOpacityRef.current,
      targetZoomOpacity,
      Math.min(1, 8 * delta)
    );

    // Hand the current room shape to `leaveFurniture`, which cannot close over it. One
    // assignment of an already-memoised array; see walkableRectsRef.
    walkableRectsRef.current = walkableRects;

    // Movement logic - only move if in active view, not on a piece of furniture, not loading,
    // and not in build/edit mode
    const isControlActive = isCorrectInstance && !isGameLoading && !isOccupying && !isFlipping && emote !== 'DANCE' && !isBuildMode;
    moveVector.set(0, 0, 0);

    /*
     * THE WALK-UP TO A SEAT, stepped before anything else reads the occupancy.
     *
     * It has to be here — above `inFurniturePose`, above the pose progress, above the branch
     * that chooses the moving path over the idle one — because during this phase the character
     * is WALKING, and every one of those three has to be told so. Once it ends, every one of
     * them goes back to the answer it gave before this existed.
     *
     * `occupiedRef` rather than `isOccupying`: the occupancy is committed to the ref
     * synchronously in handleAction and to React state a render later, and the walk should start
     * on the very next frame rather than on the one after that.
     *
     * Setting `moveVector` is what puts this frame on the movement path further down; WHAT it
     * contains is ignored there while `autoWalkActiveRef` is set (see the finalMove branch), so
     * this is a flag rather than a direction.
     */
    autoWalkActiveRef.current = false;
    if (seatApproachActiveRef.current) {
      const seat = occupiedRef.current;
      const dx = seatApproachTargetRef.current.x - position.current.x;
      const dz = seatApproachTargetRef.current.z - position.current.z;
      const gap = Math.hypot(dx, dz);
      if (!seat || gap <= SEAT_ENTRY_ARRIVED || performance.now() >= seatApproachDeadlineRef.current) {
        seatApproachActiveRef.current = false;
        // Arrived (or given up trying): NOW the weight is on the piece. See announceOccupy.
        if (seat && seatOccupyPendingRef.current) announceOccupy(seat);
      } else {
        autoWalkDirRef.current.set(dx / gap, 0, dz / gap);
        autoWalkActiveRef.current = true;
        moveVector.set(0, 0, -1);
      }
    }
    /** True while the body is walking itself to a seat rather than being placed on one. */
    const isSeatApproach = autoWalkActiveRef.current;

    const isInterior = currentView === View.BUILDING_INTERIOR;
    const territoryLevel = profile?.territoryLevel || 1;
    const islandScale = 1 + (territoryLevel - 1) * 0.4;

    const isSwimming = !isInterior && (movementStateRef.current === 'swimming' || movementStateRef.current === 'enteringWater' || movementStateRef.current === 'exitingWater');
    isSwimmingRef.current = isSwimming;

    /**
     * THE JUMP, stepped once, here, for every branch below.
     *
     * Once and unconditionally is the point. The arc used to be written out twice — once in the
     * moving branch and once in the standing one — with its own copy of the duration, the height
     * and the squash curve in each, and a third path (occupying a piece of furniture) where
     * neither ran and the flag it set could never be cleared. One machine, stepped before the
     * branch, is what makes 「跳躍動畫與 Physics 同步」 a property of the code rather than of two
     * copies happening to agree.
     *
     * WHO MAY JUMP is decided here, not in the machine: it is this controller's rule set, the
     * same one `isControlActive` is built from. Sitting, lying, mid-interaction, mid-somersault,
     * in build mode or out in the water all say no — and every one of them is a rule about the
     * GAME, which jumpPose.ts deliberately knows nothing about.
     */
    // Walking to the seat is walking: the ground gap, the fall detector and the jump gate all
    // have to see an ordinary body on its feet until the piece actually takes it over.
    const inFurniturePose = (isOccupying && !isSeatApproach) || poseProgressRef.current > 0;
    const canJump = isCorrectInstance
      && !isGameLoading
      && !inFurniturePose
      && !isFlipping
      && !isBuildMode
      && !isDressingRoom
      // Deep enough to be swimming rather than wading. The water pose owns the whole body out
      // there (see swimPose.ts), and a hop that has to fight it is a hop that loses.
      && swimPoseRef.current < 0.5;
    /**
     * GROUND DETECTION, and the whole of it: how far the drawn body is above the surface it is
     * standing on.
     *
     * `bodyRootYRef` is last frame's support height — terrain, floor, or the blended swim depth
     * — published deliberately BEFORE the jump arc is added (see its own docs), so this really
     * is a gap and not the arc measured against itself. Zeroed while a piece of furniture owns
     * the body, because then the root is at seat height against a support height nobody updated,
     * and the difference would read as a two-foot fall.
     */
    const supportGap = groupRef.current && !inFurniturePose && !isDressingRoom
      ? groupRef.current.position.y - bodyRootYRef.current
      : 0;
    /**
     * HOW FAST THE GROUND IS GOING AWAY, world units per second, positive downward — the signal
     * that actually starts a free fall (see jumpPose.ts's FREE_FALL_DROP_RATE for what happened
     * when the gap above was asked to do it: every walk down to the beach played as a fall).
     *
     * Measured between the last two published support heights rather than between this frame's
     * and the last, because `targetY` for THIS frame has not been resolved yet — it is worked
     * out inside the branches below, after the jump has to have been stepped. One frame of lag
     * on a signal that only has to catch a discontinuity costs nothing.
     */
    const supportDrop = groupRef.current && !inFurniturePose && !isDressingRoom && delta > 0
      ? (prevSupportYRef.current - bodyRootYRef.current) / delta
      : 0;
    prevSupportYRef.current = bodyRootYRef.current;
    const jump = stepJump(jumpStateRef.current, delta, {
      requested: jumpRequestRef.current,
      canJump,
      supportGap,
      supportDrop,
    });
    jumpRequestRef.current = false;
    // The one measurement the jump needs from the character: hip to sole, in world units. Every
    // angle it uses is body language and lives in the pose table; how far a bent knee lowers
    // THIS character's hips is a property of its legs, and is read from the active skeleton so
    // a taller model crouches by its own amount rather than by the chibi's.
    const jumpAnim = jumpFrame(jump, toWorld(skeleton.hip.y - skeleton.soleY));
    const isJumping = isJumpActive(jump);
    /**
     * The squash/stretch, in the character's own amplitudes.
     *
     * The jump owns the root scale whenever it is running, which is what retired the separate
     * `landingSquashRef` spring-back on this path: the landing recovery is now a phase of the
     * jump rather than a decay bolted onto the end of it. The flip still uses that ref — its
     * curve ends at full compression and has nothing else to unwind it.
     */
    const applyRootScale = (stretch: number) => {
      if (!groupRef.current) return;
      groupRef.current.scale.set(
        baseScale * (1 - stretch * SQUASH_STRETCH_XZ),
        baseScale * (1 + stretch * SQUASH_STRETCH_Y),
        baseScale * (1 - stretch * SQUASH_STRETCH_XZ)
      );
    };

    // How much room the body needs in FRONT of `position.current` this frame. Zero while upright;
    // the crawl tips the group about its own feet, so from then on the character is lying across
    // ground the collider knows nothing about (see CRAWL_BODY_REACH / resolveProneBody).
    //
    // Driven off the LIVE pitch rather than off `emote === 'CRAWL'` for two reasons: tipping down
    // beside a wall then eases the body clear over the same frames the pose takes to fold, instead
    // of teleporting it the instant the key is pressed; and the reservation stays in place while
    // the pose UNWINDS back to standing, which is exactly when the body is still prone but the
    // emote already isn't.
    //
    // Swimming is excluded even though it is also a prone pose: it happens out past the shoreline,
    // and reserving a body-length of forward clearance there would fence the player off their own
    // beach. A somersault is excluded because its pitch is a full rotation, not a lie-down.
    const proneReach = isSwimming || isFlipping
      ? 0
      : CRAWL_BODY_REACH * Math.sin(THREE.MathUtils.clamp(bodyTiltRef.current, 0, Math.PI / 2));

    // Thin per-frame wrapper around the shared implementation (characterMovement.ts) - keeps
    // every existing call site below (`resolveCollisions(proposedPos)` etc.) unchanged.
    const resolveCollisions = (testPos: THREE.Vector3) => resolveCollisionsShared({
      testPos,
      currentPos: position.current,
      isInterior,
      islandScale,
      profile,
      home,
      isSwimmingBoundary: movementStateRef.current === 'swimming' || movementStateRef.current === 'enteringWater',
      // Whatever is solid in the world without being in the save — today the visiting merchant's
      // boat (lib/worldSolids.ts). Read fresh every frame rather than captured, because the boat
      // moves; the registry hands back a stable array so this costs nothing while nobody is
      // visiting. Passed on BOTH branches deliberately — it is empty indoors, and gating it on
      // `!isInterior` here would be a second place that has to know where the boat is.
      solids: getWorldSolids(),
      // The swimming body's own forward reservation. Driven off the LIVE water-pose weight for
      // the same reason `proneReach` is driven off the live tilt: entering the sea eases the
      // reservation in over the frames the body actually takes to lie down, and leaving it eases
      // back out, instead of a body-length of clearance appearing the instant a flag flips.
      //
      // This is the ONLY thing that stops a swimmer's head ending up inside the merchant's hull
      // while their feet are correctly outside it — the pushes resolve the origin, and the origin
      // is at the character's feet. See SWIM_BODY_REACH.
      swimReach: SWIM_BODY_REACH * swimPoseRef.current,
      proneReach,
      facingYaw: bodyYawRef.current,
      // How far the BODY must stay off a wall, as opposed to off a chair. This character is
      // widest at the skull, and a wall is the only thing tall enough for the difference to
      // show - see characterRig.ts's bodyClearanceRadius for the quarter-metre of head that
      // used to end up inside the panel.
      wallClearance: bodyClearanceRadius(skeleton),
    });

    if (isControlActive) {
      if (keysRef.current.w) moveVector.z -= 1;
      if (keysRef.current.s) moveVector.z += 1;
      if (keysRef.current.a) moveVector.x -= 1;
      if (keysRef.current.d) moveVector.x += 1;

      // Mobile joystick input
      if (joystickData && (Math.abs(joystickData.x) > 0.01 || Math.abs(joystickData.y) > 0.01)) {
        moveVector.x = joystickData.x;
        moveVector.z = -joystickData.y;
        
        if (moveVector.length() > 0.1) {
          leaveFurniture();
          // The joystick is walking away just as WASD is. It never cleared the acting posture, so
          // on a phone the spot-easing kept dragging the body back to the piece it was leaving.
          abandonAction();
          // Same carve-out as the WASD handler above - the joystick is the mobile way of
          // crawling somewhere, so it must not cancel the crawl either.
          setEmote(prev => (prev === 'CRAWL' ? prev : 'NONE'));
        }
      }
    }

    // Speed modifiers
    let speed = 3.8 * 1.2 * 1.2; // Increased player speed 1.2x * 1.2x (was 3.8)
    if (emote === 'CRAWL') speed = 1.2 * 1.2 * 1.2; // Increased crawl speed 1.2x * 1.2x (was 1.2)

    // Furniture pose progress - updated unconditionally, regardless of whether the character is
    // idle or actively steering this frame. This previously only advanced inside the idle
    // branch below, so resuming WASD movement immediately after standing up left it frozen
    // mid-value, which kept the arm/leg animation permanently gated to the mount pose (see
    // inPoseTransition further down) even though the character was visibly walking away.
    //
    // If movement interrupts the dismount, snap straight to 0 instead of easing it out: a
    // graceful transition isn't the point once the player's already steering away, and a
    // multi-frame slerp between "reclined, yawed to the piece" and "upright, yawed to the
    // movement direction" can itself pass through visually odd in-between orientations (the
    // two target quaternions differ enough in both axes that the shortest spherical path
    // between them doesn't read as "still tilting, now also turning" - it can look like a
    // diagonal lean). A single-frame cut avoids that window entirely.
    //
    // `posePiece` is whichever piece owns the body this frame: the one being occupied while
    // settling in, and the one just left while getting up. Reading it (rather than the live
    // proximity scan) is what lets a player walk clear of a bed mid-dismount without the
    // animation losing its anchor half way through.
    const posePiece = occupiedRef.current ?? posePieceRef.current;
    const posePostureId: PostureId = posePiece?.posture ?? 'lie';
    const poseMountTime = POSE_MOUNT_DURATION[posePostureId] ?? 0.9;
    const poseDismountTime = POSE_DISMOUNT_DURATION[posePostureId] ?? 0.5;
    if (isOccupying) {
      // Held at 0 while the body is still walking over: the mount is what happens once you are
      // standing at the piece, and starting it early is what made the character recline its way
      // across the floor. See SEAT_ENTRY_ARRIVED.
      if (!isSeatApproach) {
        poseProgressRef.current = Math.min(1, poseProgressRef.current + delta / poseMountTime);
      }
    } else if (poseProgressRef.current > 0) {
      const isMovementInterrupt = moveVector.length() > 0;
      poseProgressRef.current = isMovementInterrupt
        ? 0
        : Math.max(0, poseProgressRef.current - delta / poseDismountTime);

      if (poseProgressRef.current <= 0 && groupRef.current) {
        // The dismount just finished this frame (eased to 0 naturally, or snapped to 0 by a
        // movement interrupt) - this is the ONE place that can reliably catch that exact
        // transition. Putting the gimbal-lock-safe snap inside the dismount/movement branches
        // further below doesn't work: by the time either branch's own
        // `poseProgressRef.current > 0` check runs later this same frame, the value has
        // already been zeroed right here, so that branch is skipped entirely and the snap
        // inside it never executes on the one frame it's needed - see applyLyingOrientation's
        // comment for why leaving a stray rotation.z from a gimbal-locked decomposition matters.
        const finalYaw = isMovementInterrupt
          ? rotation.current
          : (posePiece?.spot?.yaw ?? rotation.current);
        bodyYawRef.current = finalYaw;
        rotation.current = finalYaw;
        bodyTiltRef.current = 0;
        applyGroundOrientation(groupRef.current, bodyYawRef.current, bodyTiltRef.current);
        posePieceRef.current = null;
      }
    }

    /**
     * THE ACTING POSTURE, resolved once and used twice.
     *
     * It has to be known HERE, hundreds of lines before the limbs are posed, because two of the
     * things a posture can say belong to the character ROOT rather than to a joint: how far the
     * body leans (`lean` — applied to the root because the torso joint is a sibling of the arms
     * and legs, not their parent, so leaning it would leave the limbs upright) and how far it
     * drops (`crouch`). Both are owned by the height/orientation block below, which runs first.
     *
     * Null whenever nothing is playing, when it has run its course, or when the player has got
     * onto a piece of furniture — an occupancy outranks an action, and clearing it here means
     * pressing E on a chair mid-烹飪 cannot leave a stirring arm on a seated body.
     */
    const activeAction = actionPostureRef.current;
    const actionElapsed = activeAction ? (performance.now() - activeAction.startedAt) / 1000 : 0;
    const actionIsLive = Boolean(
      activeAction
      && !isOccupying
      && poseProgressRef.current <= 0
      && !actionFinished(activeAction.posture, actionElapsed),
    );
    const actionFrame = actionIsLive && activeAction
      ? resolveActionFrame(activeAction.posture, actionElapsed, {
        // From the ACTIVE skeleton, so a remodel with longer legs crouches by its own amount
        // rather than by a number written for the chibi.
        hipY: toWorld(skeleton.hip.y),
        legLength: toWorld(skeleton.hip.y - skeleton.soleY),
      })
      : null;
    if (activeAction && !actionIsLive) actionPostureRef.current = null;

    // ------------------------------------------------------------------
    // WHAT IS IN REACH — the proximity scan behind every 「E 坐下」/「E 躺下」 badge.
    // ------------------------------------------------------------------
    //
    // Runs on EVERY frame, not only the idle ones. It used to live at the bottom of the "nothing
    // is being steered" branch, so the prompt for a piece of furniture could not appear until the
    // player let go of the keys - you walked up to a hammock and nothing happened until you
    // stopped. Walking toward something is exactly when you want to be told you can use it.
    //
    // The cost of moving it is one distance test per interactive piece per frame, over a list
    // that was already narrowed to interactive pieces at save time (interactableCandidates) and
    // that rejects anything out of range on a squared-distance compare before it touches an
    // oriented box. A fully decorated house has a handful of entries.
    //
    // Suspended while occupying a piece: the answer cannot change (the player is not moving) and
    // leaving is handled by the occupancy itself, so re-ranking the room from inside a bed would
    // only be a chance to point the badge at the nightstand.
    //
    // `isCorrectInstance` gates the whole thing, and has to: BOTH avatars are mounted for the
    // ~0.18s the front door crossfades, and the one whose view is not on screen is standing at a
    // stale position. Without the gate the inactive instance would write its own answer onto the
    // shared bus and the badge would point at furniture in the other world.
    if (isCorrectInstance) {
      // While occupying, the badge keeps pointing at what the player is ON so it can offer 起身;
      // the scan itself is suspended (see above).
      const inReach = occupiedRef.current || isDressingRoom || isBuildMode
        ? null
        : findNearbyInteractable(position.current.x, position.current.z, interactableCandidates);

      // The SEARCH runs every frame and allocates nothing; the DESCRIPTION (verb, anchors, spot)
      // is rebuilt only when the answer actually changes — a different piece, or the same piece
      // now that its footprint has finished measuring. Rebuilding it per frame would put three
      // small objects a frame straight at the GC, which is the exact thing the candidate-list
      // memo above exists to avoid.
      const prev = nearbyInteractionRef.current;
      const footprintVersion = getFootprintVersion();
      const targetId = occupiedRef.current?.instanceId ?? inReach?.instanceId ?? null;
      /*
       * A THIRD REASON TO RE-DESCRIBE: the player has walked somewhere else while the same piece
       * stayed in reach.
       *
       * The record is built once, when a piece comes into range, and `from` — which is what an
       * `approach: 'nearest'` piece uses to decide which side you use it from — is sampled then
       * and kept. That is right for a campfire (the side you walked up on should not shuffle
       * around you while you stand there) and wrong for anything you can walk ONTO: you approach
       * 小型觀景平台 across the grass, the record resolves a stand spot down on the grass, and
       * then you climb the steps — but the record still says "grass", so 眺望風景 hauled you back
       * off the platform you had just climbed to look out from.
       *
       * Re-describing on movement fixes that case without giving the campfire the jitter, because
       * the threshold is a quarter of a unit rather than a frame: standing at a piece never
       * crosses it, and walking from one end of it to the other always does. Occupying pieces are
       * excluded — their anchor is the piece's own, so where the player stood never mattered.
       */
      const movedSinceDescribe = describedFromRef.current.distanceToSquared(position.current)
        > DESCRIBE_REFRESH_DISTANCE * DESCRIBE_REFRESH_DISTANCE;
      const wantsFreshApproach = !occupiedRef.current && prev != null && !prev.occupies && movedSinceDescribe;
      if ((prev?.instanceId ?? null) !== targetId
        || describedVersionRef.current !== footprintVersion
        || wantsFreshApproach) {
        describedVersionRef.current = footprintVersion;
        describedFromRef.current.copy(position.current);
        const found = occupiedRef.current
          // The player's own position matters to a piece with no front (`approach: 'nearest'` —
          // a campfire, a wishing well): it is what decides which side of it they use it from.
          // Sampled HERE rather than per frame, which is the right moment as well as the cheap
          // one — the record is rebuilt when the piece comes into reach, so the side is the side
          // they walked up on, and it does not shuffle around them while they stand there.
          ?? (inReach
            ? describeInteraction(inReach, skeleton, 0, { x: position.current.x, z: position.current.z })
            : null);
        nearbyInteractionRef.current = found;
        if ((prev?.instanceId ?? null) !== (found?.instanceId ?? null)) setNearbyInteraction(found);
      }
      const found = nearbyInteractionRef.current;

      // See playerBus.ts - AppContext's nearbyInteractable only carries a display string, so the
      // tracker needs this separate world point to anchor the floating badge over the object. It
      // is the piece's measured TOP now, not its origin, so the badge clears a wardrobe and does
      // not float a metre above a footstool.
      //
      // Rewritten every frame into ONE vector rather than published when the target changes: the
      // anchor of a piece the player is already standing next to moves the moment its footprint
      // finishes measuring (that lands a frame after the model first mounts), and a
      // publish-on-change would have pinned it to the unmeasured fallback height for as long as
      // they stood there.
      if (found) {
        promptAnchorRef.current.set(found.promptAnchor.x, found.promptAnchor.y, found.promptAnchor.z);
        playerBus.nearbyInteractablePos = promptAnchorRef.current;
      } else {
        playerBus.nearbyInteractablePos = undefined;
      }
    }

    // What the badge should SAY. On the bus rather than in React state because it changes at
    // walking speed and exactly one component reads it (UI/InteractionPrompt.tsx, which is
    // already polling this object every animation frame).
    if (isCorrectInstance) {
      const promptTarget = nearbyInteractionRef.current;
      playerBus.nearbyInteraction = promptTarget
        ? {
          instanceId: promptTarget.instanceId,
          itemName: promptTarget.itemName,
          verb: occupiedRef.current ? promptTarget.exitVerb : promptTarget.verb,
          icon: promptTarget.icon,
          occupied: occupiedRef.current !== null,
        }
        : null;
    }

    // The swim state machine is driven purely by distance from the world ORIGIN, which only
    // means anything outdoors. House interiors live on a 12-unit room grid centred on the living
    // room (ROOM_GRID_SIZE / ROOM_DEFS in constants/rooms.ts), so every room except the living
    // room sits 12 or more units out - far beyond the water threshold. Ungated, simply walking
    // through a doorway pushed the character into 'enteringWater' and then 'swimming' while
    // indoors.
    //
    // Nothing LOOKED wrong, because the swim pose is separately gated on !isInterior (see
    // isSwimming above) - but `isWet` in the audio block is not, and it gates the footstep
    // trigger. That is the "footsteps vanish once I leave the living room, and come back when I
    // return to it" bug: the living room is the one room centred on the origin, so it is the one
    // room whose coordinates read as dry land.
    //
    // There is no water indoors at all, so the state is simply pinned to 'walking'. This also
    // covers walking into a house mid-swim, which would otherwise strand the state (the two
    // nextSwimState call sites below are now skipped indoors and so can never clear it).
    if (isInterior) {
      movementStateRef.current = 'walking';
      transitionTimerRef.current = 0;
    }

    // Let an in-progress water enter/exit transition keep advancing - and finish - in real
    // time even if the player releases the movement keys partway through. This used to only
    // tick inside the `moveVector.length() > 0` branch below, so stopping mid-transition froze
    // transitionTimerRef wherever it was; the idle height blend further down then stayed stuck
    // at that frozen point between the swim depth and the sand height, which reads as the
    // character being sunk into the beach instead of standing on it.
    if (movementStateRef.current === 'enteringWater') {
      transitionTimerRef.current -= delta;
      if (transitionTimerRef.current <= 0) {
        movementStateRef.current = 'swimming';
      }
    } else if (movementStateRef.current === 'exitingWater') {
      transitionTimerRef.current -= delta;
      if (transitionTimerRef.current <= 0) {
        movementStateRef.current = 'walking';
      }
    }

    if (moveVector.length() > 0) {
      // ... movement calculation ...
      state.camera.getWorldDirection(camDir);
      
      camDir.y = 0;
      if (camDir.lengthSq() < 0.00001) {
        camDir.set(0, 0, -1);
      } else {
        camDir.normalize();
      }
      
      camRight.crossVectors(camDir, WORLD_UP).normalize();

      // An auto-walk is already a world heading and must not be turned by the camera — see
      // autoWalkDirRef. Everything after this point is identical either way, which is the whole
      // point of routing the walk-up through here rather than giving it a mover of its own.
      if (autoWalkActiveRef.current) {
        finalMove.copy(autoWalkDirRef.current);
      } else {
        finalMove
          .set(0, 0, 0)
          .addScaledVector(camDir, -moveVector.z)
          .addScaledVector(camRight, moveVector.x);
      }

      const moveLength = finalMove.length();
      if (moveLength > 1) {
        finalMove.normalize();
      }
      
      isMoving.current = true;

      const fullStep = finalMove.clone().multiplyScalar(speed * delta);
      const proposedPos = position.current.clone().add(fullStep);

      // Swimming is driven by nextSwimState (characterMovement.ts), which checks the
      // character's next position against the water boundary with hysteresis: entering and
      // exiting use two different thresholds straddling the sand line, not one shared line, so
      // walking tangentially along the shoreline can no longer flip the state every frame.
      // Skipped indoors - interior room coordinates are not island coordinates, see the
      // isInterior guard near the transition tick above.
      let currentState = movementStateRef.current;
      if (!isInterior) {
        // Standing on a deck over the sea is standing on ground - see isInWaterZone.
        const grounded = isGroundedAt(proposedPos.x, proposedPos.z, profile?.islandPlacements || [], islandScale);
        const proposedState = nextSwimState(currentState, proposedPos.x, proposedPos.z, islandScale, grounded);
        if (proposedState !== currentState) {
          transitionTimerRef.current = swimTransitionTimer(currentState, proposedState, transitionTimerRef.current);
          currentState = proposedState;
        }
      }

      movementStateRef.current = currentState;

      // RESOLVE COLLISIONS & ASSIGN POSITION (Sliding wall collision solved)
      const collisionResult = resolveCollisions(proposedPos);
      const stepBeforeX = position.current.x;
      const stepBeforeZ = position.current.z;
      position.current.copy(collisionResult.position);
      supportFootstepRef.current = collisionResult.supportFootstep;

      // How fast the character ACTUALLY travelled this frame, measured after collisions
      // rather than taken from the `speed` constant, so the stroke rate follows what the
      // player can see: sliding along the island's swim leash or squeezing past a rock
      // slows the arms to match instead of leaving them stroking at full pace on the spot.
      // See swimCycleRate.
      swimSpeedRef.current = Math.hypot(
        position.current.x - stepBeforeX,
        position.current.z - stepBeforeZ,
      ) / Math.max(delta, 1e-4);

      // Swim speed modifier.
      //
      // The body's pitch is NOT set here and never was - it comes from the water pose weight
      // in the rotation block further down, which is the single source for it. See swimPose.ts.
      //
      // NOTE: `animSpeedModifier` itself is currently inert - `speed` is only ever read by
      // `fullStep` above, which is computed before this block runs, so the multiply below lands
      // on a value nothing reads again. Left wired as-is rather than "fixed": making it take
      // effect would slow swimming to 65%, which is a gameplay tuning call, not part of this fix.
      let animSpeedModifier = 1.0;

      if (!isInterior) {
        if (currentState === 'swimming') {
          animSpeedModifier = 0.65;
        } else if (currentState === 'enteringWater') {
          const p = 1.0 - Math.max(0, transitionTimerRef.current / SWIM_TRANSITION_DURATION);
          animSpeedModifier = THREE.MathUtils.lerp(0.95, 0.65, p);
        } else if (currentState === 'exitingWater') {
          const p = 1.0 - Math.max(0, transitionTimerRef.current / SWIM_TRANSITION_DURATION);
          animSpeedModifier = THREE.MathUtils.lerp(0.65, 0.95, p);
        }
      }

      speed *= animSpeedModifier;

      // Assign target height
      // Every branch below assigns this - see the interior/island split immediately after. It
      // used to be initialised to a ternary whose two arms were both 0.35, i.e. to the outdoor
      // grass height regardless of which world the character was actually in.
      let targetY = 0;
      if (!isInterior) {
        const tInfo = getTerrainInfo(position.current.x, position.current.z, islandScale);
        const safeSwimY = Math.max(tInfo.targetY, SWIM_BODY_Y);

        if (currentState === 'swimming') {
          // ONE float height, and one bob, whether stroking or resting. This branch used to
          // ride 0.1 lower than the idle one and bob three times as fast (sin(t*2.5)*0.08
          // against sin(t*0.8)*0.05), so simply letting go of WASD lifted the whole body and
          // changed the rhythm it was riding on - the height half of the same "moving and
          // floating are different characters" problem the pose had. See SWIM_BOB_* .
          targetY = safeSwimY + swimRootMotion(time, swimPhaseRef.current, swimStrokeRef.current, swimDriveRef.current).bob;
        } else if (currentState === 'enteringWater') {
          const p = swimEase(1.0 - Math.max(0, transitionTimerRef.current / SWIM_TRANSITION_DURATION));
          const startY = tInfo.targetY + FOOT_LIFT;
          targetY = THREE.MathUtils.lerp(startY, safeSwimY, p);
        } else if (currentState === 'exitingWater') {
          // Blend UP from `safeSwimY`, not from the raw SWIM_BODY_Y constant. This is the
          // walking-out-of-the-sea "face-planted in the sand" bug: SWIM_BODY_Y is a flat -0.6,
          // but the swimming branch directly above never actually sits there near the shore -
          // its safeSwimY floors the body at the terrain under it, so approaching the beach the
          // swimmer is already riding at sand height (~0.11 at the water line). Starting this
          // blend at -0.6 therefore made the very frame the state flipped swimming ->
          // exitingWater snap the body ~0.7 units straight DOWN into the beach, and because a
          // swim transition writes its height with no easing at all (see isSwimTransition
          // below), that snap was instant and lasted the whole transition as it climbed back
          // out. Combined with the still-prone pitch at p=0, that is precisely the head-down,
          // buried-in-the-sand pose. Both ends of the blend now start from a height that is
          // already floored to the ground, so the exit is continuous with the swim that
          // preceded it. (The idle branch further down always used safeSwimY here, which is why
          // this only ever reproduced while actually walking ashore.)
          const p = swimEase(1.0 - Math.max(0, transitionTimerRef.current / SWIM_TRANSITION_DURATION));
          const endY = collisionResult.terrainY;
          targetY = THREE.MathUtils.lerp(safeSwimY, endY, p);
        } else {
          targetY = collisionResult.terrainY;
        }

        // Hard floor: whatever the swim/transition maths above produced, the body is never
        // allowed below the ground beneath it. The blends are continuous again on their own,
        // but they are spread over four states, two call sites and a wave-bob term, and every
        // sinking-into-the-beach bug this file has had came from one of them being derived
        // from a constant depth instead of the local terrain. Stating the invariant once, here,
        // means a future regression in any of them surfaces as a stiff transition rather than
        // as the character disappearing into the sand.
        targetY = Math.max(targetY, tInfo.targetY);
      } else {
        targetY = collisionResult.terrainY;
      }

      // Rotate towards movement (or align with camera direction in first-person mode)
      let targetRot = Math.atan2(finalMove.x, finalMove.z);
      const isFirstPerson = cameraMode === CameraMode.SECOND_PERSON || uiScale >= FIRST_PERSON_ZOOM;
      if (isFirstPerson) {
        targetRot = Math.atan2(camDir.x, camDir.z);
      }
      
      let angleDiff = targetRot - rotation.current;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      // Frame-rate independent exponential smoothing (was a naive `* 15 * delta` multiply,
      // which could overshoot/wrap on frame hitches). TURN_RATE controls how fast the
      // character snaps to face the new WASD direction - higher = closer to instant turning.
      const TURN_RATE = 22; // full 180 degree turn converges in ~0.2s, well under the 1s target
      rotation.current += angleDiff * (1 - Math.exp(-TURN_RATE * delta));

      if (rotation.current > Math.PI) rotation.current -= Math.PI * 2;
      if (rotation.current < -Math.PI) rotation.current += Math.PI * 2;

      // Where the character is travelling relative to where it is FACING - the swim pose's
      // only input about direction, and the reason it cannot assume "forward" (see SwimDrive).
      //
      // The two agree in third person: `targetRot` above is the movement direction itself, so
      // W/A/S/D all come out as forward:1, strafe:0 and every direction term below is
      // multiplied by zero. In first person and at first-person zoom the yaw is pinned to the
      // camera instead, so S really is swimming backwards and A/D really are swimming
      // sideways, and the stroke has to say so. Read off the movement vector the controller
      // already produced - nothing here steers.
      const forwardDot = finalMove.x * Math.sin(rotation.current) + finalMove.z * Math.cos(rotation.current);
      const strafeDot = finalMove.x * Math.cos(rotation.current) - finalMove.z * Math.sin(rotation.current);
      // Slow on purpose (~0.5s). This vector steps instantly when a key changes - A to D is a
      // jump of 2 in one frame - and it drives a head turn and a body lean. Eased any faster,
      // reversing a strafe flicks the head round; at this rate it reads as the character
      // looking where it has decided to go.
      const driveEase = Math.min(1, 3 * delta);
      swimDriveRef.current.forward = THREE.MathUtils.lerp(swimDriveRef.current.forward, forwardDot, driveEase);
      swimDriveRef.current.strafe = THREE.MathUtils.lerp(swimDriveRef.current.strafe, strafeDot, driveEase);

      if (groupRef.current) {
        const currentY = groupRef.current.position.y;
        // While actively entering/exiting water, targetY is already a smooth p-based
        // interpolation between swim depth and terrain height (see above) - an extra 10*delta
        // ease on top of that lagged behind the tilt (which applies its own p-based value
        // immediately, uncushioned), so the body would visibly still be pitched forward like
        // it's diving while its height hadn't caught up yet, reading as face-planted in the
        // sand with the legs still up. Applying targetY directly here keeps height and tilt
        // in lockstep through the transition; plain walking/idle height changes still ease
        // in via the lerp as before.
        const isSwimTransition = currentState === 'enteringWater' || currentState === 'exitingWater';

        // Jump is allowed to run alongside WASD movement (isControlActive doesn't gate on the
        // jump, only on isFlipping) - so its height arc and squash-stretch apply here too, not
        // just in the idle "Standing up" branch below, or jumping while walking would show no
        // height change at all until you stopped moving.
        //
        // Both branches now read the SAME numbers off the one machine stepped above, rather than
        // each re-deriving an arc from `jumpStartTime`. Walking off the end of a jump used to
        // cross between two copies of that maths mid-flight.
        const jumpYOffset = jumpAnim.rootOffset;
        if (isJumping) {
          applyRootScale(jumpAnim.stretch);
        } else {
          // Nothing airborne: unwind whatever compression the SOMERSAULT left behind (its curve
          // always ends at its most-compressed point). The jump no longer parks anything here -
          // its recovery is the 'land' phase, which is part of the animation rather than a decay
          // bolted onto its end.
          landingSquashRef.current = Math.max(0, landingSquashRef.current - delta / LANDING_RECOVERY_DURATION);
          applyRootScale(-landingSquashRef.current);
        }

        // The camera's copy of the height, taken here because this is the last point at which it
        // is still only the SURFACE the body is on: the jump arc and the crawl lift go on in the
        // next line and the framing must not follow those (see bodyRootYRef). Read off `targetY`
        // rather than the smoothed group Y below for the same reason the swim transition skips
        // that smoothing - through an enter/exit `targetY` IS what gets rendered, so the framing
        // and the body cross the drop on one curve.
        bodyRootYRef.current = targetY;

        // Lerp toward the COMPLETE target height (terrain/swim + jump arc) in one step, the same
        // way the idle "Standing up" branch does with its yOffset. Lerping toward the base
        // terrain target and adding jumpYOffset as a separate step afterward was the bug: this
        // group's Y read back next frame (via currentY above) already had last frame's jump
        // offset baked in, so it only partially decayed through the lerp before a *fresh* full
        // jumpYOffset got added on top again - compounding across the jump's ~24 frames into a
        // height far beyond JUMP_HEIGHT, which is what sent the character flying off-screen.
        // Crawling has to keep its pose while actually crawling somewhere, so the crawl lift is
        // folded into the same single target height as the jump arc (see CRAWL_RISE). The pitch
        // half of the pose is applied with the orientation further below.
        const fullTargetY = targetY + jumpYOffset + (emote === 'CRAWL' ? CRAWL_RISE : 0);
        const smoothY = isSwimTransition ? fullTargetY : THREE.MathUtils.lerp(currentY, fullTargetY, 10 * delta);
        groupRef.current.position.set(position.current.x, smoothY, position.current.z);

        if (poseProgressRef.current > 0) {
          // Still unwinding out of the hammock recline - moving interrupted the dismount before
          // rotation.x eased back to 0 (that easing is gated off while poseProgressRef > 0,
          // see the "Bounce and Sway" guard below). Force-setting rotation.y directly here, on
          // top of that lingering nonzero rotation.x, hits the exact same intrinsic-Euler-order
          // problem as applyLyingOrientation was written to avoid - it spins the body around
          // its own still-tilted spine instead of turning it to face the movement direction,
          // which is what produced the collapsed/twisted pose on rotated hammocks. Route through
          // the same quaternion composition instead, easing pitch back to 0 at the same time.
          applyLyingOrientation(groupRef.current, rotation.current, 0, delta, 10);
          // Same handover as the swim pose: this slerp is heading for exactly (rotation.current, 0),
          // so park the land refs there rather than letting them re-derive from its quaternion.
          bodyYawRef.current = rotation.current;
          bodyTiltRef.current = 0;
        } else {
          // Same gimbal-lock guard as the dismount block above: poseProgressRef can reach 0
          // here on the very frame movement interrupts a hammock dismount (it's snapped straight
          // to 0 rather than eased, see the top-level decay logic), meaning the quaternion at
          // this instant may still be a gimbal-locked representation with a stray rotation.z.
          // Writing rotation.y alone (the old behavior) left that stray z in place forever.
          bodyYawRef.current = rotation.current;
          // Eased toward the pose's pitch rather than snapped to 0, so starting or stopping a
          // crawl mid-walk tips the body over smoothly instead of folding it flat in one frame.
          // This does not weaken the gimbal-lock guard described above: that guard is about the
          // stray `rotation.z` a quaternion write can leave behind, and applyGroundOrientation
          // still writes an explicit zero roll every frame whatever pitch it is handed.
          bodyTiltRef.current = THREE.MathUtils.lerp(
            bodyTiltRef.current,
            emote === 'CRAWL' ? CRAWL_TILT : 0,
            12 * delta
          );
          applyGroundOrientation(groupRef.current, bodyYawRef.current, bodyTiltRef.current);
        }
      }
    } else {
      isMoving.current = false;
      // Nothing is being steered, so the stroke rate falls back to the idle scull and the
      // direction terms unwind to "facing where I'm going" rather than holding the last
      // strafe - otherwise stopping mid-sidestroke would leave the float permanently leaning.
      swimSpeedRef.current = 0;
      swimDriveRef.current.forward = THREE.MathUtils.lerp(swimDriveRef.current.forward, 1, Math.min(1, 4 * delta));
      swimDriveRef.current.strafe = THREE.MathUtils.lerp(swimDriveRef.current.strafe, 0, Math.min(1, 4 * delta));

      let targetY = 0;
      if (!isDressingRoom) {
        if (isOccupying || poseProgressRef.current > 0) {
          // Position is fully owned by the furniture mount/dismount blocks below while getting
          // on or off. Running the normal collision resolve here would treat the piece itself as
          // a solid obstacle (see resolvePlayerAgainstFurniture) and shove position.current away
          // from it every frame - fighting the lerp toward that same point and producing a
          // visible jitter while sitting or lying. It is also what makes it possible to be ON a
          // sofa at all: every seat is inside its own collider.
          //
          // The HEIGHT still has to be asked for, though, because the sit pose reaches its legs
          // down to it (see the floorAngle below) - so this asks the height question on its own,
          // with none of the pushing. It used to be the literal 0.35, which was the outdoor grass
          // height standing in for every floor in the game: a chair indoors had its occupant
          // reaching for a floor a third of a unit below the real one, and a deck chair on a
          // wooden platform reaching for the sand under it.
          targetY = footLevelAt(
            position.current.x,
            position.current.z,
            isInterior,
            islandScale,
            profile?.islandPlacements,
          );
        } else {
          // Re-validate the swim state against the actual (idle) position every frame, not
          // just while the player is pressing a movement key - a furniture dismount push,
          // build-mode teleport handoff, or an ordinary collision-resolve nudge near the shore
          // can move position.current across the water boundary with no WASD input at all, and
          // without this the state used to stay frozen at whatever it was until the next
          // keypress "caught up", which read as swimming on dry sand (or vice versa).
          // Skipped indoors for the same reason as the moving branch above.
          if (!isInterior) {
            const grounded = isGroundedAt(position.current.x, position.current.z, profile?.islandPlacements || [], islandScale);
            const idleState = nextSwimState(movementStateRef.current, position.current.x, position.current.z, islandScale, grounded);
            if (idleState !== movementStateRef.current) {
              transitionTimerRef.current = swimTransitionTimer(movementStateRef.current, idleState, transitionTimerRef.current);
              movementStateRef.current = idleState;
            }
          }

          const idleCollisionResult = resolveCollisions(position.current.clone());
          position.current.copy(idleCollisionResult.position);
          targetY = idleCollisionResult.terrainY;
          supportFootstepRef.current = idleCollisionResult.supportFootstep;
        }
      } else {
        position.current.set(0, 0, 0);
      }

      if (isSwimming) {
        // Mirror the moving branch's height blend below (rather than snapping straight to
        // swim depth) so that releasing the movement keys mid-transition doesn't leave the
        // character's height frozen partway between the water surface and the sand - which
        // read as being sunk into the beach once `targetY` here was the land height but the
        // pose/tilt had already blended toward standing.
        const state = movementStateRef.current;
        const tInfo = getTerrainInfo(position.current.x, position.current.z, islandScale);
        const safeSwimY = Math.max(tInfo.targetY, SWIM_BODY_Y);

        if (state === 'swimming') {
          // Identical to the moving branch's float height, deliberately: the idle used to
          // ride at WATER_SURFACE_Y (0.1 higher) on its own slower bob, so the body rose and
          // changed rhythm the moment WASD was released. One depth, one bob, both states.
          targetY = safeSwimY + swimRootMotion(time, swimPhaseRef.current, swimStrokeRef.current, swimDriveRef.current).bob;
        } else if (state === 'enteringWater') {
          const p = swimEase(1.0 - Math.max(0, transitionTimerRef.current / SWIM_TRANSITION_DURATION));
          const startY = tInfo.targetY + FOOT_LIFT;
          targetY = THREE.MathUtils.lerp(startY, safeSwimY, p);
        } else if (state === 'exitingWater') {
          const p = swimEase(1.0 - Math.max(0, transitionTimerRef.current / SWIM_TRANSITION_DURATION));
          targetY = THREE.MathUtils.lerp(safeSwimY, targetY, p);
        }

        // Same ground floor the moving branch asserts - see the comment there. The wave-bob
        // terms above are added AFTER their own terrain guards, so they can still dip the body
        // a few centimetres under the sand while floating in the shallows.
        targetY = Math.max(targetY, tInfo.targetY);
      }
      if (groupRef.current) {
        // Cleared FIRST, every frame, and only re-armed by the occupancy branch below.
        //
        // Not defensive tidiness: `poseProgressRef` is SNAPPED to 0 (rather than eased) when a
        // movement key interrupts a dismount, which skips the whole branch below from that frame
        // on. Left latched, the last value would follow the player around the island as a
        // permanent half-metre sideways displacement of their own body.
        //
        // The rise is kept in a local first, because the height ease below has to subtract what
        // was added LAST frame before it can lerp — see there.
        const prevOccupantRise = occupantRiseRef.current;
        occupantOffsetRef.current.set(0, 0, 0);
        occupantRiseRef.current = 0;

        if (posePiece?.spot && !isSeatApproach && (isOccupying || poseProgressRef.current > 0)) {
          // ONE mount/dismount block for every piece of furniture in the game.
          //
          // What used to be here was two near-identical copies of this maths with the hammock's
          // own numbers baked into them - its -1.1 offset along its length, its -PI/2 facing, its
          // 1.05 recline height - so a sofa could not have used a line of it. The piece now hands
          // over a resolved anchor (lib/furnitureInteraction.ts) and this drives the body to it,
          // which is why sitting cost no second animation system.
          const spot = posePiece.spot;
          const posture = getPosture(posePostureId);
          const p = poseProgressRef.current;

          // XZ: toward the anchor while getting on, toward the exit step while getting off.
          if (isOccupying) {
            poseTargetPos.set(spot.x, 0, spot.z);
            position.current.lerp(poseTargetPos, 5 * delta);
          } else {
            const stepAwayP = 1 - THREE.MathUtils.clamp(p / 0.4, 0, 1);
            poseTargetPos.set(spot.x, 0, spot.z).lerp(poseExitTargetRef.current, stepAwayP);
            position.current.lerp(poseTargetPos, 6 * delta);
          }

          // The pose itself only develops over the back 60% of the transition, so the character
          // arrives at the seat before it starts settling into it rather than reclining its way
          // across the floor.
          const settleP = settleFrom(p);

          // WHERE THE LEGS GO is measured HERE and solved THERE (lib/interactionPosture.ts) —
          // because the right answer differs per piece and this character makes it awkward: its
          // legs are 0.53 long against a sofa 1.15 deep, so "drop the feet to the floor" buries
          // both shins in the cushion. The two inputs are the only things this file is in a
          // position to know: how far the hip ended up above the floor the player was standing
          // on, and how far the piece reaches ahead of the anchor (measured off the model).
          const legLength = toWorld(skeleton.hip.y - skeleton.soleY);
          const hipDrop = groupRef.current.position.y + toWorld(skeleton.hip.y) - targetY;
          const legSwing = solveLegSwing(posture.legs, {
            legLength,
            hipDrop,
            reachAhead: spot.reachAhead,
            // The posture pitches the ROOT the legs hang off, so its lean is part of the leg's
            // angle in the world — see LegGeometry.lean.
            lean: posture.lean ?? 0,
          });

          /*
            THE PIECE'S OWN MOTION, and the body's share of it.

            `spot.motion` is set only for a piece that hangs and swings (a hammock, a swing —
            constants/outdoorAnimation.ts). The angle comes from the SAME function the piece's own
            model calls, with the same timeline, so the seat and the rider are not synchronised so
            much as identical. Everything after this is just resolving that one number into the
            three places a body feels it:

              along the arc   an offset in the piece's own local +Z, turned into world by the
                              piece's yaw. Applied to the DRAWN body only — see occupantOffsetRef.
              up             the arc's rise, plus a hammock's one-off sag as the cloth takes the
                              weight.
              tilt           the root pitch, scaled by how rigidly this piece carries its rider
                              (`bodyFollow`: near 1 on a swing, 0 in a hammock, which rocks about
                              the axis the body is lying along).

            Scaled by `settleP`, so a body still climbing on is not yet being thrown around, and
            a body climbing off lets go of the arc over the back of the dismount rather than
            being cut loose from it on one frame.
          */
          let rideTilt = 0;
          if (spot.motion) {
            const spec = SUSPENDED_MOTIONS[spot.motion.id];
            sampleWind(position.current.x, position.current.z, 0, occupantWind);
            const phase = suspendedPhase(
              suspendedTimelineRef.current, performance.now(), occupantWind.sway,
            );
            const angle = suspendedAngle(spec, phase);
            const radius = spot.motion.radius;
            const alongZ = -radius * Math.sin(angle) * settleP;
            occupantRiseRef.current =
              (radius * (1 - Math.cos(angle)) + suspendedSag(spec, phase)) * settleP;
            occupantOffsetRef.current.set(
              alongZ * Math.sin(spot.motion.pieceYaw),
              0,
              alongZ * Math.cos(spot.motion.pieceYaw),
            );
            rideTilt = angle * spec.bodyFollow * settleP;
          } else {
            occupantOffsetRef.current.set(0, 0, 0);
            occupantRiseRef.current = 0;
          }

          // THE WHOLE BODY, from one table row. This replaced `if (isSit) { … } else { … }` —
          // a pose vocabulary of exactly two, hard-coded in the middle of the controller, which
          // is why 泡澡 could not be anything but a hand-wave beside the bath.
          const frame = resolveOccupancyFrame(posePostureId, {
            progress: p, settle: settleP, time, legSwing, tilt: rideTilt,
          });

          // The recline. A posture states its own lean, EXCEPT for the one that is a fact about
          // the rig rather than a choice: how far a lying body is tipped off flat is exactly the
          // angle that keeps an oversized chibi skull out of the mattress (liePitch), so `lie`
          // declares no lean and gets it derived. `frame.rootPitch` carries the posture's own
          // lean plus whatever its idle is rocking by.
          const reclinePitch = posture.anchoring === 'side' ? liePitch(skeleton) * settleP : 0;
          const targetPitch = reclinePitch + frame.rootPitch + rideTilt;
          const targetPoseY = THREE.MathUtils.lerp(targetY, spot.y, settleP) + frame.rootRise;

          // Higher slerp rate on the way off (20 vs 8): settleP only reaches 0 once p <= 0.4,
          // giving roughly the last 40% of the dismount for pitch to fully unwind back to
          // upright. At rate 8 that left a meaningful residual tilt (still tens of degrees) by
          // the time p hit exactly 0 and control passed to the plain "Standing up" branch below -
          // which lerps rotation.x and increments rotation.y as two independent Euler writes, the
          // same unsafe combination applyLyingOrientation exists to avoid.
          applyLyingOrientation(groupRef.current, spot.yaw, targetPitch, delta, isOccupying ? 8 : 20);
          // The arc's rise is added AFTER the ease, and subtracted back out before it — a
          // first-order lag at rate 8 would put the body ~17 degrees of phase behind a swing at
          // its natural frequency, which over a full arc is the body visibly lagging the seat it
          // is sitting on. What the lag is for is the SETTLE (arriving at the seat height), and
          // that still gets it.
          const easedBase = THREE.MathUtils.lerp(
            groupRef.current.position.y - prevOccupantRise, targetPoseY, 8 * delta,
          );
          groupRef.current.position.y = easedBase + occupantRiseRef.current;

          // The limbs, by JOINT NAME. Everything above this line is geometry; the pose itself
          // came out of a table, and this is a loop over whichever joints that table named —
          // which is what makes 泡澡 (legs out, arms wide on the rim, head back) and 坐下 (legs
          // down, hands on thighs) the same amount of code.
          //
          // A first-order ease rather than a straight write, at the rate the two hand-written
          // branches used, because nothing else is animating these joints while a posture owns
          // the body (see `inPoseTransition`) — so their previous frame's value IS the pose's
          // own history and easing against it is what makes settling in look like settling in.
          applyBodyPose(postureJoints, frame.joints, Math.min(1, 10 * delta));
        } else {
          // Standing up
          let targetRotX = 0;
          let yOffset = targetY;
          // Same publication as the moving branch, at the same point in the height maths: before
          // the jump/flip arcs and the crawl lift are folded into `yOffset` below. See
          // bodyRootYRef.
          bodyRootYRef.current = targetY;
          // Whether this frame's pitch is OWNED by an animation curve (the flip) rather than
          // being a resting pose the body eases toward. See the assignment below.
          let tiltIsDriven = false;

          if (isFlipping) {
            const elapsed = (performance.now() - flipStartTime.current) / 1000;
            const progress = Math.min(elapsed / FLIP_DURATION, 1);
            flipProgress.current = progress;
            // Negative = the chest opens BACKWARD over the head, which with the body-local pitch
            // axis (see applyGroundOrientation) is a back somersault in whatever direction the
            // character happens to be facing. The avatar's forward is its local +Z.
            targetRotX = -progress * Math.PI * 2;
            tiltIsDriven = true;
            yOffset += Math.sin(progress * Math.PI) * FLIP_HEIGHT;

            // Turn about the body's centre, not the feet. Rotating the group alone pivots at the
            // origin (ground level), so the torso swung around the ankles; offsetting by the
            // amount that motion displaces the centre pins the centre in place and leaves a
            // clean spin around it. Derived rather than hand-tuned: a point at local height h
            // rotated by θ about the body's lateral axis lands at (0, h·cosθ, h·sinθ), so
            // cancelling that takes (0, h−h·cosθ, −h·sinθ), turned into world space by the yaw.
            // Both terms vanish at θ = 0 and θ = −2π, so takeoff and landing are exact.
            const pivotH = FLIP_PIVOT_LOCAL_Y * baseScale;
            const localZ = -pivotH * Math.sin(targetRotX);
            flipPivotOffset.current.set(
              localZ * Math.sin(bodyYawRef.current),
              pivotH * (1 - Math.cos(targetRotX)),
              localZ * Math.cos(bodyYawRef.current)
            );
            // Squash at takeoff/landing (progress 0 and 1, where vertical speed is highest and
            // the body is at ground level), stretch at the apex (progress 0.5) - a single cosine
            // cycle over the flip's own progress gives that squash->stretch->squash shape for
            // free, without needing a separate hand-tuned multi-segment curve.
            const stretchFactor = -Math.cos(progress * Math.PI * 2);
            const scaleY = 1 + stretchFactor * SQUASH_STRETCH_Y;
            const scaleXZ = 1 - stretchFactor * SQUASH_STRETCH_XZ;
            groupRef.current.scale.set(baseScale * scaleXZ, baseScale * scaleY, baseScale * scaleXZ);
            if (progress >= 1) {
              setIsFlipping(false);
              landingSquashRef.current = 1;
              // Land upright. At progress 1 the curve above is at exactly -2π, which IS the
              // upright orientation, so overwriting the target with 0 changes nothing visually
              // this frame - but it is what stops the next frame (isFlipping now false, tilt
              // easing toward 0) from treating -2π as "350-odd degrees of tilt to undo" and
              // slowly unwinding the whole revolution backwards.
              targetRotX = 0;
            }
          } else if (isJumping) {
            // The same arc and the same squash the moving branch uses, off the same machine —
            // see the jump step above. Standing still and walking are two views of one jump,
            // which is what stops a hop started at a standstill from changing shape the instant
            // the player presses W in mid-air.
            yOffset += jumpAnim.rootOffset;
            applyRootScale(jumpAnim.stretch);
          } else {
            if (emote === 'CRAWL') {
              // Shared with the moving branch so the pose does not pop when the player starts
              // or stops crawling forward. `yOffset` is still `targetY` at this point, so this
              // is the surface height plus the lift, not an absolute Y.
              targetRotX = CRAWL_TILT;
              yOffset += CRAWL_RISE;
            } else if (actionFrame) {
              // THE WHOLE BODY leaning into what it is doing — the half of an acting posture
              // that no arm angle can express. Someone bent over a hob, tipped back off a
              // telescope, or crouched at a fire is recognisable from across the room by this
              // line alone; the hands only say which of the three it is.
              //
              // Assigned rather than added because nothing else writes `targetRotX` in this
              // branch, and eased rather than driven (`tiltIsDriven` stays false), so the lean
              // arrives and leaves on the same first-order lag every other resting pose uses —
              // which is also what unwinds it if the posture is cancelled halfway through.
              targetRotX = actionFrame.rootPitch;
              yOffset += actionFrame.rootRise;
            }
            // Spring the landing squash left behind by the SOMERSAULT (its curve always ends at
            // its most-compressed point) back to neutral over LANDING_RECOVERY_DURATION, instead
            // of the scale snapping back to (1,1,1) the instant isFlipping clears. The jump's own
            // recovery is a phase of the jump now - see jumpPose.ts.
            landingSquashRef.current = Math.max(0, landingSquashRef.current - delta / LANDING_RECOVERY_DURATION);
            applyRootScale(-landingSquashRef.current);
          }

          // Eased from the refs, not from groupRef.current.rotation. Reading the tilt back off the
          // group is what stood the character on its head after a swim: `.rotation` there is a
          // decomposition of the quaternion applySwimOrientation wrote, so `.x` is not the body's
          // tilt and easing it to 0 does not stand the body up. See applyGroundOrientation.
          // The flip WRITES pitch; every other pose EASES toward it.
          //
          // The ease is a first-order lag with a ~1/12 s time constant, which is right for
          // settling into a resting tilt but cannot track a ramp: the flip sweeps 2π in 0.6 s
          // (~10.5 rad/s), and a lag of that time constant trails a ramp by rate x tau - about
          // 50deg. So the body reached only ~310deg by the time the flip ended and then eased
          // back the way it came, which is why the somersault visibly fell short and rewound
          // instead of coming all the way round. An animation that specifies an exact angle at
          // an exact time has to be assigned, not chased.
          bodyTiltRef.current = tiltIsDriven
            ? targetRotX
            : THREE.MathUtils.lerp(bodyTiltRef.current, targetRotX, 12 * delta);

          let rotYDiff = rotation.current - bodyYawRef.current;
          while (rotYDiff < -Math.PI) rotYDiff += Math.PI * 2;
          while (rotYDiff > Math.PI) rotYDiff -= Math.PI * 2;
          bodyYawRef.current += rotYDiff * 8 * delta;

          applyGroundOrientation(groupRef.current, bodyYawRef.current, bodyTiltRef.current);

          // Same lockstep fix as the moving branch above: while idly entering/exiting water,
          // yOffset is already the smooth p-based blend between swim depth and terrain height,
          // so skip the extra ease here too rather than let height lag behind the (unsmoothed)
          // swim tilt applied later in Bounce and Sway.
          // The flip is exempt from the ease for the same reason its pitch is (see above): its
          // height is a 0.6 s arc, and a 1/12 s lag flattens it into a low hop that is still
          // rising when the body has already finished coming round. Applied directly, the
          // takeoff and the landing hit at the same instants the rotation does.
          const isSwimTransition = movementStateRef.current === 'enteringWater' || movementStateRef.current === 'exitingWater';
          groupRef.current.position.y = (isSwimTransition || isFlipping)
            ? yOffset
            : THREE.MathUtils.lerp(groupRef.current.position.y, yOffset, 12 * delta);
        }
        // `position.current` is the character's logical spot on the island and the flip never
        // touches it - the somersault stays exactly where it started. The pivot offset is a
        // purely visual displacement that holds the body's centre still while it spins, and it
        // returns to zero on the landing frame, so nothing downstream sees the character move.
        //
        // `occupantOffset` is the same kind of thing for a swinging piece of furniture: the drawn
        // body goes over the arc while the logical position stays on the seat, so the collider,
        // the proximity scan and the camera pivot all keep pointing at where the player actually
        // IS rather than tracking a body that is currently a metre out over the grass.
        groupRef.current.position.set(
          position.current.x + occupantOffsetRef.current.x + (isFlipping ? flipPivotOffset.current.x : 0),
          groupRef.current.position.y + (isFlipping ? flipPivotOffset.current.y : 0),
          position.current.z + occupantOffsetRef.current.z + (isFlipping ? flipPivotOffset.current.z : 0)
        );
      }
    }

    // Animation state updates
    const targetWeight = isMoving.current ? 1 : 0;
    moveWeight.current = THREE.MathUtils.lerp(moveWeight.current, targetWeight, 10 * delta);

    // ------------------------------------------------------------------
    // The water animation's three numbers. See swimPose.ts for the model.
    // ------------------------------------------------------------------
    {
      // How much water pose this frame wants. The transition progress says how far through
      // an enter/exit we are; swimPitchAllowance says how much water there is under the
      // character to lie in. Multiplying them is what replaces the old `isDeepEnough`
      // boolean - wading through the shallows is now a fractional pose that grows as the
      // sea bed drops away, instead of a hard switch between "wading upright" and "prone".
      let poseTarget = 0;
      if (isSwimming) {
        const st = movementStateRef.current;
        const p = swimEase(1.0 - Math.max(0, transitionTimerRef.current / SWIM_TRANSITION_DURATION));
        const depth = swimPitchAllowance(
          getTerrainInfo(position.current.x, position.current.z, islandScale).targetY,
        );
        poseTarget = depth * (st === 'swimming' ? 1 : st === 'enteringWater' ? p : 1 - p);
      }
      // One smoothing for the whole pose, at a rate fast enough to keep up with the 0.45s
      // transition but slow enough to give the body a little follow-through as it settles
      // onto (or climbs off) the surface. Everything downstream reads this same number, so
      // the pitch, the limbs, the head and the float height can no longer arrive at
      // different times - which is what made even the "correct" transitions read as snaps.
      const easedPose = THREE.MathUtils.lerp(swimPoseRef.current, poseTarget, Math.min(1, 9 * delta));
      // ...and then rate-limited, which the ease alone does not do. The target can move in one
      // frame however smooth the ease is: the state machine drops it straight to 0 the moment
      // the character is classified ashore, and swimPitchAllowance is a function of POSITION,
      // so crossing the depth band quickly (or dithering across the waterline) hands this a
      // step rather than a ramp. Since a full land<->water blend is nearly 2 radians of arm
      // travel, an unclamped step there is a visible flick. 2.5/s puts a floor of ~0.4s on
      // the whole pose change - about the length of SWIM_TRANSITION_DURATION, so a deliberate
      // wade in or out is unaffected - whatever the player does with the keys.
      const poseRateCap = 2.5 * delta;
      swimPoseRef.current += THREE.MathUtils.clamp(easedPose - swimPoseRef.current, -poseRateCap, poseRateCap);
      if (swimPoseRef.current < 0.0015 && poseTarget === 0) swimPoseRef.current = 0;

      // Stroke amplitude: floating and swimming differ by THIS and nothing else. Gated by
      // the pose weight as well as by movement, so a character who is only half in the water
      // only half strokes - which is the "arms start moving once the body has settled"
      // ordering the enter/exit needs, for free and with no sequencing code.
      //
      // Eased AGAIN on top of moveWeight's own ease, and slower (4/s against 10/s), because
      // this number scales an arm sweep nearly a radian wide: taken raw it moves the hands
      // ~0.22 rad on the first frame of a keypress, which is a flick rather than a stroke
      // starting. Two nested first-order lags give a ~0.7s build-up and, run backwards, the
      // "strokes get smaller and smaller until it is just floating" wind-down that stopping
      // is supposed to look like.
      swimStrokeRef.current = THREE.MathUtils.lerp(
        swimStrokeRef.current,
        swimPoseRef.current * moveWeight.current,
        Math.min(1, 4 * delta),
      );

      // Cycle direction, eased. See swimCycleDirRef.
      const driveForward = swimDriveRef.current.forward;
      swimCycleDirRef.current = THREE.MathUtils.lerp(
        swimCycleDirRef.current,
        driveForward < -0.3 ? -1 : 1,
        Math.min(1, 3 * delta),
      );

      // The phase NEVER stops while there is any water pose, and never resets. A frozen
      // phase is a pose snap waiting to happen: the old stroke rode walkPhase, which only
      // advances while a movement key is held, so every swim resumed from whatever angle the
      // arms happened to stop at however long ago.
      if (swimPoseRef.current > 0) {
        swimPhaseRef.current +=
          delta * swimCycleRate(swimStrokeRef.current, swimSpeedRef.current) * swimCycleDirRef.current;
        // Wrapped so the number stays small over a long session - 2PI is one full stroke
        // cycle, so this is invisible to every curve that reads it.
        if (swimPhaseRef.current > Math.PI * 2) swimPhaseRef.current -= Math.PI * 2;
        if (swimPhaseRef.current < 0) swimPhaseRef.current += Math.PI * 2;
      }
    }

    /**
     * This frame's water pose, read once and shared by every limb chain below.
     *
     * `inWaterPose` is deliberately NOT `isSwimming`: the state machine drops back to
     * 'walking' the instant the character is ashore, and keying the limbs off that is what
     * made stepping out of the sea a one-frame cut from a horizontal float to a standing
     * idle. The pose weight decays smoothly through zero instead, so the last of the water
     * pose unwinds on the beach - "the body rises, the feet find the ground, then it's a
     * walk", rather than a switch.
     */
    const swimPose = swimPoseRef.current;
    const swimStroke = swimStrokeRef.current;
    const swimPhase = swimPhaseRef.current;
    const swimDrive = swimDriveRef.current;
    const swimPitch = swimBodyPitch(swimStroke);
    const inWaterPose = swimPose > 0;
    
    // What matters for whether a gait reads is the ground covered per STROKE, not the stroke rate
    // on its own - limbs that cycle slower than the body travels are the definition of a skate.
    //
    // Walking: 3.8*1.44 = 5.47 units/s against a half-cycle of 0.52 s is 2.87 units per stride.
    // The crawl already moves at 1.73 units/s, a third of that, so a limb cycle anywhere near
    // walking's would put a hand down every ~0.9 units - a short, busy, deliberate stroke, which
    // is exactly what crawling looks like. At 0.3 the half-cycle was 1.75 s and each stroke
    // carried the body 3.02 units: FURTHER than a walking stride, on limbs moving a third as
    // fast. That is why 匍匐 read as sliding along the ground with the arms held still rather
    // than as pulling itself forward. 0.8 puts it at 1.13 units per stroke.
    const walkSpeedMultiplier = emote === 'CRAWL' ? 0.8 : 1;
    const walkSpeed = 12 * walkSpeedMultiplier;
    const idleSpeed = 1.5;
    
    if (isMoving.current) {
      walkPhase.current += delta * walkSpeed;
    }
    idlePhase.current += delta * idleSpeed;

    // --- Dynamic Movement & Ambience Sound Logic ---
    if (isCorrectInstance) {
      // `!isInterior` is redundant given the guard that pins the state to 'walking' indoors, and
      // deliberately kept: this flag suppresses the footstep trigger below, so if the swim state
      // ever leaks indoors again the symptom is silence - which is easy to miss in review and
      // annoying to trace back from. Stating "indoors is never wet" at the consumer too means
      // that class of regression cannot reach the audio at all.
      const isWet = !isInterior && movementStateRef.current !== 'walking';

      // Shoreline-crossing one-shots: edge-detect the swim state so wading in fires a
      // deep plunge splash and stepping back out a light slosh - exactly once each.
      if (prevSwimStateRef.current !== movementStateRef.current) {
        if (audioUnlocked.current && !isInterior && !isDressingRoom) {
          if (movementStateRef.current === 'enteringWater') {
            playWaterEntrySplash(0.55);
          } else if (prevSwimStateRef.current === 'exitingWater' && movementStateRef.current === 'walking') {
            playWaterEntrySplash(0.2);
          }
        }
        prevSwimStateRef.current = movementStateRef.current;
      }

      // Continuous ambiences are driven by WHERE the avatar is, not whether it is
      // moving: the sea keeps roaring while you stand still on the sand, and the
      // water keeps lapping while you float in place.
      if (isInterior || isDressingRoom) {
        stopSwimAmbience();
        stopBeachSurfAmbience();
      } else if (audioUnlocked.current) {
        if (isWet) {
          // In the water: swim ambience owns the soundscape. Activity follows the
          // movement blend, so stroking is energetic and floating is calm lapping.
          stopBeachSurfAmbience();
          startSwimAmbience(0.3);
          // The STROKE weight, not the raw movement blend: the ambience should follow the
          // arms the player can see, and those now ramp in over ~0.7s rather than tracking
          // the keypress directly. Wading through the shallows is quiet for the same reason -
          // the stroke weight carries the pose weight with it.
          setSwimActivity(swimStrokeRef.current);

          // Stroke-synced splash: each zero crossing of the stroke sine is one hand
          // piercing the surface (arms alternate half a cycle apart). Reads the swim
          // cycle rather than walkPhase, so the splashes stay on the hands now that the
          // stroke has a rate of its own - and so they thin out with the stroke as the
          // character slows, instead of continuing at walking cadence.
          if (isMoving.current && movementStateRef.current === 'swimming') {
            const strokeSin = Math.sin(swimPhaseRef.current);
            if ((lastStrokeSinRef.current < 0 && strokeSin >= 0) ||
                (lastStrokeSinRef.current > 0 && strokeSin <= 0)) {
              playStrokeSplash(0.34 + Math.random() * 0.14);
            }
            lastStrokeSinRef.current = strokeSin;
          } else {
            lastStrokeSinRef.current = 0;
          }
        } else {
          // On dry land the sea is audible EVERYWHERE outdoors, scaled by distance:
          // a faint far-off wash from the middle of the grass that grows toward the
          // beach, then swells hard across the sand strip to full surf at the
          // waterline. Piecewise but continuous at the grass/sand edge (0.25).
          stopSwimAmbience();
          const distNow = position.current.length();
          const grassR = 5.7 * islandScale;
          const sandR = 6.8 * islandScale;
          startBeachSurfAmbience();
          let surfIntensity: number;
          if (distNow <= grassR) {
            surfIntensity = 0.08 + 0.22 * (distNow / grassR);
          } else {
            // The whole sand strip is LOUD sea territory - starting at 30% and
            // ramping hard so the surf stays clearly audible over the player's
            // own footsteps anywhere on the beach.
            const closeness = THREE.MathUtils.clamp((distNow - grassR) / (sandR - grassR), 0, 1);
            surfIntensity = 0.3 + 0.7 * closeness;
          }
          setBeachSurfIntensity(surfIntensity);
        }
      }

      // 佈置模式 footsteps - VFX ONLY, deliberately silent.
      //
      // While the interior edit camera is open the avatar is frozen and hidden
      // (see isControlActive / isHiddenByMode), so the block below - which is
      // driven entirely by the avatar's own walk cycle - never fires. The user
      // is still walking around the room as far as they are concerned, so the
      // puffs come off the edit camera's own travel instead.
      //
      // No footstep audio here, by request: decorating is a calm, deliberate
      // activity and the edit camera covers ground fast enough that the taps
      // read as noise rather than as the user's own steps. The visual puffs stay
      // - they are what keeps the movement legible - so do NOT "restore" a
      // playFootstepThud() call here. The avatar's normal walking footsteps
      // (further below) are unaffected and still audible outside build mode.
      //
      // Paced by DISTANCE, not by a walk phase: the edit camera has no legs to
      // sync to, and it moves several times faster than the avatar, so a
      // time-based cadence would machine-gun. One step per stride of ground
      // covered is both correct and self-limiting at any speed.
      if (isBuildMode && isInterior) {
        const camPos = playerBus.buildModeCamPos;
        if (camPos) {
          const prev = buildStepPrevPos.current;
          if (prev) {
            const moved = Math.hypot(camPos.x - prev.x, camPos.z - prev.z);
            // Ignore the one huge jump when build mode is entered or the camera
            // is handed a new position, which would otherwise fire a burst.
            if (moved < 1.5) buildStepDistance.current += moved;
            prev.set(camPos.x, camPos.y, camPos.z);
          } else {
            buildStepPrevPos.current = camPos.clone();
          }

          if (buildStepDistance.current >= BUILD_STEP_STRIDE) {
            buildStepDistance.current -= BUILD_STEP_STRIDE;
            buildStepSide.current = -buildStepSide.current;
            // Puffs land on the floor under the camera, not at its eye height -
            // these are marks left on the ground, and the VFX group is world
            // space (deliberately not parented to the hidden avatar), so it
            // still renders with the avatar switched off.
            spawnFootstepVfx(
              camPos.x,
              camPos.z,
              0.02,
              playerBus.buildModeCamDir
                ? Math.atan2(playerBus.buildModeCamDir.x, playerBus.buildModeCamDir.z)
                : 0,
              'wood',
              buildStepSide.current
            );
          }
        }
      } else if (buildStepPrevPos.current) {
        // Leaving build mode: drop the tracker so re-entering somewhere else
        // doesn't count the gap between the two as distance walked.
        buildStepPrevPos.current = null;
        buildStepDistance.current = 0;
      }

      // Discrete footsteps (solid ground only - the water is handled above)
      if (isMoving.current && !isWet) {
        let terrain = 'grass';
        // The swim-state hysteresis means the avatar can be past the visual
        // waterline while still classified 'walking' (ankle-deep shallows, both
        // wading in and wading out). Footfalls there must sound like water, not
        // like dry sand - and kicking up a dust puff in water looks absurd.
        let isWading = false;
        const dist = position.current.length();

        if (isInterior) {
          terrain = 'wood';
        } else {
          const info = getTerrainInfo(position.current.x, position.current.z, islandScale);
          if (info.terrain === 'water' || info.terrain === 'deepWater') {
            isWading = true;
          } else if (info.terrain === 'sand') {
            terrain = 'sand';
          } else {
            terrain = dist < 2.0 ? 'stone' : 'grass';
          }

          // A deck the player is standing on overrides whatever is beneath it - including the sea,
          // which is the point of a pier - and names its own surface
          // (constants/items.ts's StandableSurface) rather than being recognised here by a third
          // hard-coded copy of the platform's dimensions.
          if (supportFootstepRef.current) {
            terrain = supportFootstepRef.current;
            isWading = false;
          }
        }

        // Fire a discrete dust puff + footstep click on every footfall, in sync
        // with the actual leg swing.
        currentTerrain.current = terrain;

        const phaseSin = Math.sin(walkPhase.current * 0.5);
        const crossedZero =
          (lastFootstepPhase.current < 0 && phaseSin >= 0) ||
          (lastFootstepPhase.current > 0 && phaseSin <= 0);

        if (crossedZero) {
          if (isWading) {
            // Ankle-deep shallows: each footfall is a light watery slosh - no dry
            // thud, no dust puff.
            if (audioUnlocked.current) {
              playStrokeSplash(0.15 + Math.random() * 0.06);
            }
          } else {
            // Per-surface burst (see FOOTSTEP_VFX): grass/sand throw material, wood/stone
            // scuff. Anchored to the avatar group's own Y, which is the height its feet are
            // actually standing at - that already includes the rock step-up and the wooden
            // platform, and it is correct indoors and outdoors without special-casing either.
            // `phaseSin` alternates sign with the walk cycle, so it doubles as left/right foot.
            const feetY = groupRef.current ? groupRef.current.position.y : position.current.y;
            spawnFootstepVfx(
              position.current.x,
              position.current.z,
              feetY,
              rotation.current,
              terrain as FootstepTerrain,
              phaseSin >= 0 ? 1 : -1
            );

            // Synthesized tap (Web Audio) instead of the CDN-hosted footstep clips -
            // those return 403 on many networks, which silently killed footstep audio.
            // Sand steps are played softer: dry sand absorbs footfalls in reality, and
            // quieter steps keep the beach surf clearly audible while walking on it.
            if (audioUnlocked.current) {
              playFootstepThud(terrain as FootstepTerrain, terrain === 'sand' ? 0.24 : 0.35);
            }
          }
        }
        lastFootstepPhase.current = phaseSin;
      } else if (!isMoving.current) {
        currentTerrain.current = null;
        lastFootstepPhase.current = 0;
      }
    } else {
      // View switched away from this avatar instance while an ambience was running
      // (e.g. opening the dressing room mid-swim) - don't leave it looping forever.
      stopSwimAmbience();
      stopBeachSurfAmbience();
    }

    if (vfxWarmFrames.current > 0) vfxWarmFrames.current--;

    // Footstep VFX update (states are written by spawnFootstepVfx() above).
    //
    // Both pools ease OUT: material leaves the foot fast and then slows as it loses energy,
    // which is what sells a kick rather than a balloon inflating. Position, scale and alpha all
    // run off the same eased value so a particle never appears to drift after it has faded.
    for (let i = 0; i < FOOTSTEP_PUFF_POOL; i++) {
      const s = puffState.current[i];
      const mesh = puffMeshRefs.current[i];
      if (!mesh) continue;
      if (s.life > 0) {
        s.life = Math.max(0, s.life - delta / s.lifetime);
        const t = 1 - s.life;
        const ease = 1 - (1 - t) * (1 - t);
        mesh.visible = true;
        mesh.position.set(s.x + s.vx * ease, s.y + s.rise * ease, s.z + s.vz * ease);
        mesh.scale.setScalar(THREE.MathUtils.lerp(s.startScale, s.endScale, ease));
        (mesh.material as THREE.MeshBasicMaterial).opacity = s.life * s.opacity;
      } else if (mesh.visible && vfxWarmFrames.current <= 0) {
        mesh.visible = false;
      }
    }

    for (let i = 0; i < FOOTSTEP_RING_POOL; i++) {
      const s = ringState.current[i];
      const mesh = ringMeshRefs.current[i];
      if (!mesh) continue;
      if (s.life > 0) {
        s.life = Math.max(0, s.life - delta / s.lifetime);
        const t = 1 - s.life;
        // Cubic ease-out, one order snappier than the puffs': the ring is the IMPACT, so it
        // wants to be at nearly full width within the first few frames and then merely linger.
        // With the puffs' quadratic curve it grew visibly, which read as a slow ripple
        // spreading out rather than as a foot hitting the floor.
        const ease = 1 - (1 - t) * (1 - t) * (1 - t);
        mesh.visible = true;
        // Lifted off the surface by the shared decal amount: the ring is coplanar with the
        // floor/terrain it is drawn on, and without the lift it z-fights across the whole
        // disc. The material carries DECAL_DEPTH_BIAS for the depth half of the same
        // problem - see constants/terrain.ts.
        mesh.position.set(s.x, s.y + SURFACE_DECAL_LIFT, s.z);
        mesh.scale.setScalar(THREE.MathUtils.lerp(s.radius * 0.3, s.radius, ease));
        // Hold the brightness up through most of the life and drop it late, instead of fading
        // linearly from the first frame - a linear fade on a fast-expanding ring is already
        // half transparent by the time it reaches a readable size.
        (mesh.material as THREE.MeshBasicMaterial).opacity = Math.pow(s.life, 0.65) * s.opacity;
      } else if (mesh.visible && vfxWarmFrames.current <= 0) {
        mesh.visible = false;
      }
    }

    if (groupRef.current) {
      // Bounce and Sway effects - skipped entirely while getting on or off a piece of furniture
      // (that pose is fully owned by the furniture block above), not just while fully settled,
      // since this block's unconditional `rotation.x = targetRotX` would otherwise stomp the
      // dismount recline the instant the occupancy clears.
      if ((!isOccupying || isSeatApproach) && poseProgressRef.current <= 0) {
        // Weather: occasional stretch burst while sunny. Only accumulates while genuinely idle
        // (like the idle look-around timer) so the character doesn't launch into a stretch
        // mid-step; decays regardless of weather so an in-progress stretch still finishes
        // gracefully if the weather changes underneath it.
        weatherStretchPulseRef.current = Math.max(0, weatherStretchPulseRef.current - delta / WEATHER_STRETCH_DURATION);
        if (weather === WeatherType.SUNNY && moveWeight.current < 0.1) {
          weatherStretchTimerRef.current -= delta;
          if (weatherStretchTimerRef.current <= 0) {
            weatherStretchPulseRef.current = 1;
            weatherStretchTimerRef.current = 10 + Math.random() * 8;
          }
        }

        // Idle breathing/sway
        const idleSway = (Math.sin(idlePhase.current) + 1) * 0.005;
        // Walk bounce
        const walkBounce = Math.abs(Math.sin(walkPhase.current * 0.5)) * 0.12;

        // Faded out by the water pose: this is the up-and-down of FOOTFALLS, and it was being
        // added on top of the float height the whole time the character was swimming - a 0.12
        // stride bounce at walking cadence, riding on a 0.05 swell, which is most of why the
        // old swim looked like it was being jostled rather than floating. The surface bob that
        // replaces it is part of the float height itself (see SWIM_BOB_AMP).
        groupRef.current.position.y +=
          THREE.MathUtils.lerp(idleSway, walkBounce, moveWeight.current) * (1 - swimPose);
        
        // Slight tilt when moving
        const tiltIntensity = 0.05;
        const walkTilt = THREE.MathUtils.lerp(0, Math.sin(walkPhase.current * 0.5) * tiltIntensity, moveWeight.current);
        let targetRotX = walkTilt;
        // Whether an animation curve already owns this frame's pitch - see the
        // orientation write at the bottom of this block.
        const pitchIsPoseOwned = isFlipping || emote === 'CRAWL';

        if (inWaterPose) {
          // ONE water attitude, blended against the walking lean by the pose weight. There is
          // no branch on movement here any more, and that is the whole point: the target this
          // used to compute flipped between +81.8deg (prone, face down) and -87.8deg (supine,
          // back-float) the frame WASD was pressed or released, i.e. 170deg of body rotation
          // as the reward for touching a key. Pressing W now adds SWIM_STROKE_LEAN - about
          // 6deg - and nothing else moves.
          //
          // The shallows are handled by the pose weight itself (it carries
          // swimPitchAllowance, see where it is built), so the old `isDeepEnough` hard gate
          // is gone: a character wading in tips gradually as the sea bed drops instead of
          // snapping flat at one particular depth.
          const rootMotion = swimRootMotion(time, swimPhase, swimStroke, swimDrive);
          const waterPitch = swimPitch + rootMotion.pitchWobble;
          const appliedPitch = THREE.MathUtils.lerp(walkTilt, waterPitch, swimPose);
          swimPitchRef.current = appliedPitch;
          targetRotX = appliedPitch;
          // Compose yaw+pitch(+roll) via quaternion instead of a plain `rotation.x`
          // write - at this tilt angle a raw Euler write no longer turns the character
          // to face movement, see applySwimOrientation above.
          applySwimOrientation(groupRef.current, rotation.current, appliedPitch, rootMotion.roll * swimPose);
          // Hand the land path the angles that were actually used, so that when the character
          // steps ashore it carries on from a real yaw and tilt rather than re-deriving them from
          // this quaternion - which is the decomposition that cannot be trusted.
          bodyYawRef.current = rotation.current;
          bodyTiltRef.current = appliedPitch;
        } else if (pitchIsPoseOwned) {
          // The somersault and the crawl are the two poses that ASSIGN an exact
          // pitch earlier in this same frame - the flip from its own 0..-2π
          // curve, the crawl by easing toward CRAWL_TILT (see the "Standing up"
          // branch and the moving branch's applyGroundOrientation above).
          //
          // This branch used to run unconditionally, several hundred lines later
          // in the same useFrame, and it overwrote bodyTiltRef with `walkTilt` -
          // which is ~0 whenever the character isn't mid-stride. So both poses
          // were silently thrown away every frame before anything reached the
          // screen: the somersault never left upright (only its height arc, limb
          // tuck and squash survived, which is why it read as a spin rather than
          // a flip) and the crawl never tipped prone, leaving it as nothing but
          // a slower walk. Re-apply what the pose set instead of replacing it.
          applyGroundOrientation(groupRef.current, bodyYawRef.current, bodyTiltRef.current);
          // Park the swim pitch at the pose's RESTING angle rather than at the
          // live value: a mid-somersault -2π stored here would be unwound
          // through a whole backwards revolution on the next water entry.
          swimPitchRef.current = emote === 'CRAWL' ? CRAWL_TILT : 0;
        } else {
          bodyTiltRef.current = targetRotX;
          applyGroundOrientation(groupRef.current, bodyYawRef.current, bodyTiltRef.current);
          // Keep the eased pitch parked at the dry-land tilt so the next water entry
          // starts its swing from the correct angle instead of a stale one.
          swimPitchRef.current = targetRotX;
        }

        // Detailed Idle animations (Head/Body)
        if (headRef.current) {
          const headIdleY = Math.sin(idlePhase.current * 0.8) * 0.01;
          const headIdleRot = Math.sin(idlePhase.current * 0.5) * 0.02;

          // How much of the body's forward pitch the head cancels out this frame, so that
          // crawling looks along the ground ahead instead of straight down into it. Zero for
          // every pose that isn't tipped over - see CRAWL_HEAD_GAZE for the angle itself.
          //
          // Read off the body's LIVE pitch rather than off `emote === 'CRAWL'`, so the head
          // tracks the pose however that pitch is currently being driven or unwound, with no
          // second easing rate of its own to keep in sync. The gaze allowance doubles as the
          // deadband that keeps ordinary walking out of this: walkTilt peaks at 0.05, far below
          // it, so a stride's lean is never "corrected" for.
          //
          // Swimming is excluded because the prone swim pitch is stored in this same ref and the
          // swim branches below already state head angles measured against it; the somersault
          // because its pitch runs NEGATIVE through a full revolution, which the clamp would drop
          // on its own - naming it here saves the next reader deriving that sign twice.
          const crawlHeadLift = (inWaterPose || isFlipping)
            ? 0
            : Math.max(0, bodyTiltRef.current - CRAWL_HEAD_GAZE);

          if (emote === 'CRAWL') {
            // Ahead of the swim branch for the same reason the arms and legs order it that way:
            // one limb chain deciding the crawl outranks swimming while another decides the
            // opposite is how you get half a pose.
            //
            // The nod and the glance ride the same walk phase as the arms' crawl stroke (see
            // crawlSwing below), so the head dips toward whichever hand is planting rather than
            // to a rhythm of its own, and moveWeight fades both out - holding 匍匐 on the spot
            // is still, not permanently bobbing.
            const crawlStroke = Math.sin(walkPhase.current * 0.5) * moveWeight.current;
            headRef.current.rotation.x = -crawlHeadLift + crawlStroke * 0.07;
            headRef.current.rotation.y = crawlStroke * 0.1;
            headRef.current.rotation.z = 0;
            headRef.current.position.y = BASE_HEAD_Y;
          } else if (emote === 'DANCE') {
            // DANCE and WAVE never wrote rotation.x at all, which held together only because
            // nothing that ran before them left anything much in it. The crawl does: without an
            // explicit angle here, tapping 跳舞 or 揮手 straight out of 匍匐 would keep the
            // lifted head for the entire emote. Both now state their own pitch, and both keep
            // the lift for however long the body is still unwinding out of the crawl.
            headRef.current.rotation.x = -crawlHeadLift;
            headRef.current.rotation.y = Math.sin(idlePhase.current * 2) * 0.5;
            headRef.current.position.y = BASE_HEAD_Y + Math.abs(Math.sin(idlePhase.current)) * 0.2;
          } else if (emote === 'WAVE') {
            headRef.current.rotation.x = -crawlHeadLift;
            headRef.current.rotation.y = Math.sin(idlePhase.current * 2) * 0.08;
            headRef.current.rotation.z = 0.05;
            headRef.current.position.y = BASE_HEAD_Y;
          } else if (emote === 'CELEBRATE') {
            headRef.current.rotation.x = -0.1 + Math.sin(idlePhase.current * 4) * 0.1 - crawlHeadLift;
            headRef.current.rotation.y = Math.sin(idlePhase.current * 6) * 0.1;
            headRef.current.position.y = BASE_HEAD_Y + Math.abs(Math.sin(idlePhase.current * 5)) * 0.08;
          } else {
            headRef.current.position.y = THREE.MathUtils.lerp(BASE_HEAD_Y + headIdleY, BASE_HEAD_Y, moveWeight.current);
            headRef.current.rotation.z = THREE.MathUtils.lerp(headIdleRot, 0, moveWeight.current);

            // Idle look-around - only accumulate a new glance target while actually settled.
            // (Previously this timer ran unconditionally, including mid-walk, so the target kept
            // drifting to a fresh random angle the whole time you were moving; the instant you
            // stopped, the head would blend back to that stale angle over the same short
            // moveWeight ramp used elsewhere, reading as a snap. Freezing the target at 0 while
            // moving - and requiring a brief settle delay before the next glance - fixes that.)
            if (moveWeight.current < 0.1) {
              lookChangeTimerRef.current -= delta;
              if (lookChangeTimerRef.current <= 0) {
                // Curious: glance toward a nearby building or piece of furniture instead of a
                // fully random direction - but only sometimes. Near spawn there's often one or
                // the other in range continuously, and since position/rotation don't change while
                // idle, "always glance at it" produced the exact same angle every single cycle
                // (read as "the head only ever turns left/right"). Rolling for it each cycle keeps
                // the curious glance as occasional flavor instead of a permanent, repetitive bias.
                const interactionAnchor = nearbyInteractionRef.current?.promptAnchor;
                const curiosityTarget: readonly [number, number, number] | null =
                  (nearbyBuilding || interactionAnchor) && Math.random() < 0.4
                    ? (nearbyBuilding
                      ? home?.position ?? null
                      : [interactionAnchor!.x, interactionAnchor!.y, interactionAnchor!.z])
                    : null;

                if (curiosityTarget) {
                  const dx = curiosityTarget[0] - position.current.x;
                  const dz = curiosityTarget[2] - position.current.z;
                  const angleToTarget = Math.atan2(dx, dz);
                  let yawOffset = angleToTarget - rotation.current;
                  while (yawOffset < -Math.PI) yawOffset += Math.PI * 2;
                  while (yawOffset > Math.PI) yawOffset -= Math.PI * 2;
                  lookTargetYRef.current = THREE.MathUtils.clamp(yawOffset, -0.6, 0.6);
                  lookTargetXRef.current = 0.08;
                } else {
                  lookTargetYRef.current = (Math.random() - 0.5) * 0.7;
                  lookTargetXRef.current = (Math.random() - 0.5) * 0.25;
                }
                lookChangeTimerRef.current = 2.5 + Math.random() * 3.5;
              }
            } else {
              lookTargetYRef.current = 0;
              lookTargetXRef.current = 0;
              lookChangeTimerRef.current = Math.max(lookChangeTimerRef.current, 1.5 + Math.random());
            }
            smoothedLookYRef.current = THREE.MathUtils.lerp(smoothedLookYRef.current, lookTargetYRef.current, 2.5 * delta);
            smoothedLookXRef.current = THREE.MathUtils.lerp(smoothedLookXRef.current, lookTargetXRef.current, 2.5 * delta);

            headRef.current.rotation.y = THREE.MathUtils.lerp(smoothedLookYRef.current, 0, moveWeight.current);
            // The lift is subtracted from the glance rather than replacing it, so the idle
            // look-around still reads while the body is unwinding back up out of a crawl.
            headRef.current.rotation.x = THREE.MathUtils.lerp(smoothedLookXRef.current, 0, moveWeight.current) - crawlHeadLift;

            // ...and then blended toward the water pose, rather than replaced by it in a
            // branch of its own. The head is the reason this is a blend: the old code cut
            // between a +0.12 chin TUCK while stroking (face into the sea, on top of an 82deg
            // body pitch - i.e. looking straight down at the sea bed) and a -0.32 chin-up
            // back-float, so both the swim and the idle put the face under water and the
            // change between them was a 25deg snap. The base here gives the body's pitch back
            // to the neck, which is what actually keeps the face out - see SWIM_HEAD_GAZE.
            if (inWaterPose) {
              const headPose = swimHeadPose(swimPhase, swimStroke, swimPitch, swimDrive);
              headRef.current.rotation.x = blendSwimAngle(headRef.current.rotation.x, headPose.x, swimPose);
              headRef.current.rotation.y = blendSwimAngle(headRef.current.rotation.y, headPose.y, swimPose);
              headRef.current.rotation.z = blendSwimAngle(headRef.current.rotation.z, headPose.z, swimPose);
              headRef.current.position.y = THREE.MathUtils.lerp(headRef.current.position.y, BASE_HEAD_Y, swimPose);
            }
          }

          // The chin used to lift here by a fraction of the camera's sky gaze, so the character
          // was looking at the same stars the player was. The camera no longer aims off the
          // character at all (see CameraController's OUTDOOR_GROUND_CLEARANCE) - there is no gaze
          // to give back - so the head is left to whatever the pose branches above decided.
        }

        if (bodyRef.current) {
          // CELEBRATE and CRAWL are the only states that lean the torso off vertical.
          // Every other one has to actively unwind those two axes, because
          // nothing else ever writes them - a torso left mid-lean when the emote
          // ends would simply stay leaning for the rest of the session.
          if (emote !== 'CELEBRATE' && emote !== 'CRAWL') {
            bodyRef.current.rotation.x = THREE.MathUtils.lerp(bodyRef.current.rotation.x, 0, 8 * delta);
            bodyRef.current.rotation.z = THREE.MathUtils.lerp(bodyRef.current.rotation.z, 0, 8 * delta);
          }

          if (emote === 'CRAWL') {
            // The torso has to work too, or the pose is a rigid plank with busy limbs bolted
            // on. rotation.z is the axis that shows here: the capsule is radially symmetric so
            // a twist about y is nearly invisible on it (the same observation CELEBRATE below
            // is built on), but z swings the torso's long axis - which is pointing FORWARD
            // along the ground in this pose - from side to side. That is the serpentine roll a
            // body makes dragging itself along, and it lines up with the reaching arm.
            //
            // Scaled by moveWeight so holding 匍匐 on the spot is still, and paired with a
            // small y twist that costs nothing and reads faintly on the clothing seams.
            //
            // Spelled out rather than reusing crawlSwing: that one is declared with the limb
            // poses further down this same frame, so naming it here would be a use before
            // declaration. Same phase either way.
            const crawlRoll = Math.sin(walkPhase.current * 0.5) * moveWeight.current;
            bodyRef.current.rotation.z = crawlRoll * 0.12;
            bodyRef.current.rotation.y = crawlRoll * 0.14;
            bodyRef.current.rotation.x = 0;
            // Left alone: the torso is a SIBLING of the hips, so lifting it here pulls the
            // belly off the thighs (see CELEBRATE below for the arithmetic on that seam).
            bodyRef.current.position.y = BASE_BODY_Y;
          } else if (emote === 'DANCE') {
            bodyRef.current.rotation.y = Math.sin(idlePhase.current * 2) * 0.3;
            bodyRef.current.position.y = BASE_BODY_Y + Math.abs(Math.sin(idlePhase.current)) * 0.1;
          } else if (emote === 'WAVE') {
            bodyRef.current.rotation.y = 0.05;
            bodyRef.current.position.y = BASE_BODY_Y + Math.sin(idlePhase.current * 2) * 0.01;
          } else if (emote === 'CELEBRATE') {
            // Sway, don't lift. The torso is a SIBLING of the hip pivots and of
            // the arms, not their parent (see the legs and arm groups in the JSX
            // below), so translating it upward walks the belly straight off the
            // top of the thighs while the legs stay planted. The old +0.15 lift
            // cleared them by 0.09 and the character came apart at the waist.
            //
            // The headroom a bob actually has is the overlap the two capsules
            // are built with: the torso's underside sits at
            // BASE_BODY_Y - (0.08/2 + 0.135) = 0.185 + LEG_LENGTHEN and the
            // thighs' tops at 0.22 - 0.10 + (0.14/2 + 0.055) = 0.245 + LEG_LENGTHEN
            // - 0.06 of interpenetration, so 0.03 spends half of it and always
            // leaves the seam covered. LEG_LENGTHEN cancels out of that subtraction
            // by construction, so this 0.03 stays correct however long the legs get.
            //
            // The energy that lift used to carry is put back as rotation, which
            // cannot separate anything here: the torso capsule is radially
            // symmetric, so the twist doesn't move its silhouette at all, and
            // the arms overlap it far too deeply (inner edge at 0.098 against a
            // 0.135 radius) for a lean this size to open a seam at the shoulder.
            const pump = Math.abs(Math.sin(idlePhase.current * 6));
            bodyRef.current.rotation.y = Math.sin(idlePhase.current * 5) * 0.26;
            bodyRef.current.rotation.z = Math.sin(idlePhase.current * 2.5) * 0.09;
            bodyRef.current.rotation.x = -pump * 0.05; // chest out on each pump
            bodyRef.current.position.y = BASE_BODY_Y + pump * 0.03;
          } else {
            const bodyBreath = 1 + Math.sin(idlePhase.current * 0.8) * 0.012;
            bodyRef.current.scale.set(
              THREE.MathUtils.lerp(bodyBreath, 1, moveWeight.current),
              THREE.MathUtils.lerp(bodyBreath, 1, moveWeight.current),
              THREE.MathUtils.lerp(bodyBreath, 1, moveWeight.current)
            );
            bodyRef.current.rotation.y = 0;
            bodyRef.current.position.y = BASE_BODY_Y;

            // The shoulders turn with the stroke - blended in, so floating still gets the
            // breathing scale above and the twist simply grows out of it. The old swim branch
            // replaced the whole torso pose (including killing the idle breath) and rolled
            // twice as far, with an extra "breath window" boost bolted on for a breathing
            // action the new pose does not need: the face never goes under, so it never has to
            // be lifted out. See swimTorsoPose.
            if (inWaterPose) {
              const torso = swimTorsoPose(swimPhase, swimStroke);
              bodyRef.current.rotation.y = blendSwimAngle(bodyRef.current.rotation.y, torso.y, swimPose);
            }
          }
        }

        // Blinking
        if (eyeLRef.current && eyeRRef.current) {
          if (isBlinkingRef.current) {
            blinkProgressRef.current += delta / BLINK_DURATION;
            if (blinkProgressRef.current >= 1) {
              isBlinkingRef.current = false;
              blinkTimerRef.current = 2 + Math.random() * 4;
            }
          } else {
            blinkTimerRef.current -= delta;
            if (blinkTimerRef.current <= 0) {
              isBlinkingRef.current = true;
              blinkProgressRef.current = 0;
            }
          }
          const blinkScale = isBlinkingRef.current
            ? THREE.MathUtils.lerp(1, 0.05, Math.sin(Math.min(blinkProgressRef.current, 1) * Math.PI))
            : 1;

          // Happy squint - driven by the celebratory emotes, plus a short reaction pulse
          // (e.g. spotting a building) that decays on its own
          happyPulseRef.current = Math.max(0, happyPulseRef.current - delta / 0.6);
          const isHappyEmote = emote === 'DANCE' || emote === 'WAVE' || emote === 'CELEBRATE';
          const squintAmount = Math.max(isHappyEmote ? 1 : 0, happyPulseRef.current);
          const squintScale = THREE.MathUtils.lerp(1, 0.4, squintAmount);

          eyeLRef.current.scale.y = blinkScale * squintScale;
          eyeRRef.current.scale.y = blinkScale * squintScale;
          eyeLRef.current.position.y = THREE.MathUtils.lerp(0, 0.012, squintAmount);
          eyeRRef.current.position.y = THREE.MathUtils.lerp(0, 0.012, squintAmount);

          if (mouthRef.current) {
            const smileScale = THREE.MathUtils.lerp(1, 1.4, squintAmount);
            mouthRef.current.scale.set(smileScale, smileScale, 1);
          }
        }

        // Long hair follow-through sway (idle drift, wider swing while walking)
        if (longHairRef.current) {
          const swaySpeed = moveWeight.current > 0.5 ? 3.2 : 1.3;
          const swayAmount = THREE.MathUtils.lerp(0.035, 0.06, moveWeight.current);
          longHairRef.current.rotation.z = Math.sin(time * swaySpeed) * swayAmount;
          longHairRef.current.rotation.x = Math.cos(time * swaySpeed * 0.7) * swayAmount * 0.6;
        }
      }
      // What used to be here: `if (isOccupying && interaction.sway) { position.y += sin(t*1.5)*0.02;
      // position.z += cos(t*1.5)*0.02 }` — the whole of the hammock's rock, applied to the BODY,
      // in WORLD space, while the hammock's own model stayed perfectly still. Two consequences,
      // both of them in the report: the cloth never moved under its occupant, and a hammock turned
      // in build mode rocked that occupant SIDEWAYS across it, because `+= z` means "toward world
      // north" and not "toward the foot of this hammock".
      //
      // It is now resolved in the occupancy block above, from the piece's own spec, in the piece's
      // own frame, off the same function the piece's model evaluates. See occupantOffsetRef.
    }

    // Arm animation (Walking vs Breathing)
    const breatheRange = 0.08;
    const walkSwingRange = 0.6;
    const idleSwingRange = 0.15;
    const baseTilt = 0.22;

    // While sitting or lying on a piece of furniture (or getting on/off one), the limb pose is
    // fully owned by the furniture block above - skip the walk/idle/emote arm+leg logic below so
    // it doesn't immediately overwrite the pose set moments ago in this same frame.
    // The walk-up is a walk, so the limbs belong to the walk cycle for its duration — without
    // this the character glided to the seat with its arms already folded into the sit.
    const inPoseTransition = (isOccupying && !isSeatApproach) || poseProgressRef.current > 0;

    // Weather reaction, folded into the plain idle/walk arm pose below (so it only shows up
    // when there's no emote/swim overriding the arms, and fades out with moveWeight same as the
    // idle sway does) - an ease-in/hold/ease-out stretch arc while a sunny stretch pulse is active.
    const stretchArcT = 1 - weatherStretchPulseRef.current;
    const stretchAmount = weatherStretchPulseRef.current > 0 ? Math.sin(stretchArcT * Math.PI) : 0;

    // Somersault tuck and crawl stroke, shared by both arms and both legs below.
    //
    // The tuck is what actually sells the flip. A body turning end over end with its limbs still
    // running the walk cycle reads as a falling plank, not as a somersault - real ones ball up to
    // spin and open out to land. Peaking at the apex and back to zero by touchdown (a sine over
    // the flip's own progress) puts the limbs back underneath the character exactly when they
    // need to catch the ground.
    const flipTuck = isFlipping ? Math.sin(flipProgress.current * Math.PI) : 0;
    // Alternating hand plant for the prone crawl, off the same walk phase the legs use - which
    // emote === 'CRAWL' retimes to a crawl's cadence (see walkSpeedMultiplier), so the stroke
    // lands at the right rate without a second phase to keep in sync.
    const crawlSwing = Math.sin(walkPhase.current * 0.5);

    // Where a limb actually ENDS UP is the shoulder pitch measured against the body's own pitch,
    // not against the world: with the torso tipped CRAWL_TILT forward, a limb at pitch -x points
    // (0, -cos(x - CRAWL_TILT), sin(x - CRAWL_TILT)) in world terms. So x = CRAWL_TILT + PI/2
    // (~3.0) lays an arm flat along the ground pointing ahead, and x = CRAWL_TILT (~1.43) drives
    // it straight down through the floor. The whole usable stroke lives between those two.
    //
    // The old -2.3 +- 0.45 sat at 24deg..76deg above straight-down - i.e. the hands never once
    // came up level with the shoulders, let alone reached out in front. Both arms just paddled
    // underneath the chest, which is the other half of why the pose didn't read (see
    // walkSpeedMultiplier for the first half). Centring on -2.48 and widening to +-0.55 sweeps
    // 29deg..92deg instead: the hand presses down and back at one end, and is level and reaching
    // forward at the other. It deliberately stops AT horizontal - past that the arm starts
    // lifting away from the ground, and a crawl's hand skims it.
    const CRAWL_ARM_PITCH = -2.48;
    const CRAWL_ARM_SWING = 0.55;
    // Which hand is mid-reach, 0..1 each, so the reaching arm can widen away from the ribs while
    // the other stays tucked in - a single signed term would swing BOTH arms the same way across
    // the body instead of mirroring them.
    const crawlLeftReach = Math.max(0, crawlSwing);
    const crawlRightReach = Math.max(0, -crawlSwing);

    if (!inPoseTransition && leftArmRef.current) {
      if (isFlipping) {
        leftArmRef.current.rotation.x = -2.5 * flipTuck;
        leftArmRef.current.rotation.z = -baseTilt - 0.55 * flipTuck;
        leftArmRef.current.rotation.y = 0;
      } else if (emote === 'CRAWL') {
        // Prone, so an arm at rest hangs back along the body: reaching FORWARD onto the ground
        // ahead is a large negative pitch, the same place CELEBRATE puts an arm while upright.
        // The swing is what alternates the two hands planting in front - see CRAWL_ARM_PITCH
        // above for how the range was picked.
        leftArmRef.current.rotation.x = CRAWL_ARM_PITCH + crawlSwing * CRAWL_ARM_SWING;
        // Elbow out on the reach and back in on the pull, so the arm scoops around the body's
        // width instead of stroking in a flat plane - that lateral sweep is most of what tells
        // the eye these are hands pulling on the ground and not legs.
        leftArmRef.current.rotation.z = -0.28 - crawlLeftReach * 0.24;
        leftArmRef.current.rotation.y = 0;
      } else if (emote === 'DANCE') {
        leftArmRef.current.rotation.x = -Math.PI / 2 + Math.sin(idlePhase.current * 4) * 0.5;
        leftArmRef.current.rotation.z = -0.5;
      } else if (emote === 'WAVE') {
        leftArmRef.current.rotation.x = Math.sin(idlePhase.current) * idleSwingRange;
        leftArmRef.current.rotation.z = -baseTilt - Math.sin(idlePhase.current) * breatheRange;
      } else if (emote === 'CELEBRATE') {
        leftArmRef.current.rotation.x = -Math.PI / 1.2 + Math.sin(idlePhase.current * 10) * 0.4;
        leftArmRef.current.rotation.z = -Math.PI / 6;
      } else {
        const walkRotX = Math.sin(walkPhase.current * 0.5) * walkSwingRange;
        const walkRotZ = -baseTilt;
        let idleRotX = Math.sin(idlePhase.current) * idleSwingRange;
        let idleRotZ = -baseTilt - Math.sin(idlePhase.current) * breatheRange;

        if (stretchAmount > 0) {
          idleRotX = THREE.MathUtils.lerp(idleRotX, -2.7, stretchAmount);
          idleRotZ = THREE.MathUtils.lerp(idleRotZ, -0.4, stretchAmount);
        }

        leftArmRef.current.rotation.x = THREE.MathUtils.lerp(idleRotX, walkRotX, moveWeight.current);
        leftArmRef.current.rotation.z = THREE.MathUtils.lerp(idleRotZ, walkRotZ, moveWeight.current);

        // The stroke, blended onto the land arm rather than replacing it.
        //
        // What used to be here was two separate arms. The moving one ran
        // `rotation.x = phase + 0.42*sin(phase)` - an UNBOUNDED, ever-increasing angle, a
        // full windmill revolution per cycle - and the idle one eased to a starfish
        // back-float at z = -1.35. Neither can be faded into the other, or into the land
        // pose, because one of them is not an angle so much as an odometer: at the instant
        // the player let go of WASD it could be anywhere in 0..2PI, and the arm cut from
        // there to the starfish in a single frame. swimArmPose returns a bounded sweep about
        // a resting angle precisely so that all three poses live on the same dial.
        if (inWaterPose) {
          const arm = swimArmPose(-1, swimPhase, swimStroke, swimDrive);
          leftArmRef.current.rotation.x = blendSwimAngle(leftArmRef.current.rotation.x, arm.x, swimPose);
          leftArmRef.current.rotation.z = blendSwimAngle(leftArmRef.current.rotation.z, arm.z, swimPose);
          leftArmRef.current.rotation.y = blendSwimAngle(leftArmRef.current.rotation.y, arm.y, swimPose);
        }
      }
    }
    if (!inPoseTransition && rightArmRef.current) {
      if (isFlipping) {
        rightArmRef.current.rotation.x = -2.5 * flipTuck;
        rightArmRef.current.rotation.z = baseTilt + 0.55 * flipTuck;
        rightArmRef.current.rotation.y = 0;
      } else if (emote === 'CRAWL') {
        // Mirrored, half a cycle behind the left hand - see left arm above.
        rightArmRef.current.rotation.x = CRAWL_ARM_PITCH - crawlSwing * CRAWL_ARM_SWING;
        rightArmRef.current.rotation.z = 0.28 + crawlRightReach * 0.24;
        rightArmRef.current.rotation.y = 0;
      } else if (emote === 'DANCE') {
        rightArmRef.current.rotation.x = -Math.PI / 2 - Math.sin(idlePhase.current * 4) * 0.5;
        rightArmRef.current.rotation.z = 0.5;
      } else if (emote === 'WAVE') {
        rightArmRef.current.rotation.x = -Math.PI + 0.2;
        rightArmRef.current.rotation.z = Math.PI / 5 + Math.sin(idlePhase.current * 8) * 0.35;
      } else if (emote === 'CELEBRATE') {
        rightArmRef.current.rotation.x = -Math.PI / 1.2 + Math.sin(idlePhase.current * 10) * 0.4;
        rightArmRef.current.rotation.z = Math.PI / 6;
      } else {
        const walkRotX = -Math.sin(walkPhase.current * 0.5) * walkSwingRange;
        const walkRotZ = baseTilt;
        let idleRotX = -Math.sin(idlePhase.current) * idleSwingRange;
        let idleRotZ = baseTilt + Math.sin(idlePhase.current) * breatheRange;

        if (stretchAmount > 0) {
          idleRotX = THREE.MathUtils.lerp(idleRotX, -2.7, stretchAmount);
          idleRotZ = THREE.MathUtils.lerp(idleRotZ, 0.4, stretchAmount);
        }

        rightArmRef.current.rotation.x = THREE.MathUtils.lerp(idleRotX, walkRotX, moveWeight.current);
        rightArmRef.current.rotation.z = THREE.MathUtils.lerp(idleRotZ, walkRotZ, moveWeight.current);

        // Mirrored, half a cycle behind the left - see the left arm above. The half-cycle
        // offset lives inside swimArmPose rather than at the call site, so the two arms
        // cannot drift out of opposition the way they could when each restated its own phase.
        if (inWaterPose) {
          const arm = swimArmPose(1, swimPhase, swimStroke, swimDrive);
          rightArmRef.current.rotation.x = blendSwimAngle(rightArmRef.current.rotation.x, arm.x, swimPose);
          rightArmRef.current.rotation.z = blendSwimAngle(rightArmRef.current.rotation.z, arm.z, swimPose);
          rightArmRef.current.rotation.y = blendSwimAngle(rightArmRef.current.rotation.y, arm.y, swimPose);
        }

        // 拿蠟燭的那隻手。權重就是房間有多暗（見 lib/interiorLights.ts 的 level），所以手抬
        // 起來和房間暗下去是同一段緩動的兩半 —— 不需要在這裡再做一次自己的過場。
        //
        // 疊在算完的擺手上而不是取代它：完全鎖死的手臂會讓走路變成一個滑行的雕像。權重滿的時候
        // 剩下的擺幅只剩幾度，那是一個人端著蠟燭走路時手真正在做的事。
        //
        // 只在這個 else 分支裡 —— 空翻、爬行、跳舞的時候手在做別的事，而蠟燭本來就會自己站直
        // （見 Three/CandleInHand.tsx 反轉父層旋轉那一段），所以不用擔心它跟著翻過去。
        const candleHold = isInterior ? 1 - interiorLights.level : 0;
        if (candleHold > 0.001) {
          const sway = Math.sin(idlePhase.current) * 0.045;
          rightArmRef.current.rotation.x = THREE.MathUtils.lerp(
            rightArmRef.current.rotation.x, CANDLE_ARM_PITCH + sway, candleHold);
          rightArmRef.current.rotation.z = THREE.MathUtils.lerp(
            rightArmRef.current.rotation.z, CANDLE_ARM_ROLL, candleHold);
          rightArmRef.current.rotation.y = THREE.MathUtils.lerp(
            rightArmRef.current.rotation.y, 0, candleHold);
        }
      }
    }

    // Leg animation
    if (!inPoseTransition && leftLegRef.current && rightLegRef.current) {
      if (isFlipping) {
        // Knees to the chest. Negative pitch swings a leg forward and up - the same sign the
        // hammock climb uses to lift a knee - which is the direction that closes the tuck.
        leftLegRef.current.rotation.x = -1.7 * flipTuck;
        rightLegRef.current.rotation.x = -1.7 * flipTuck;
        // Zeroed for the same reason as the dance steps below - a somersault can be started
        // straight out of a crawl, and the tuck has to close on square knees, not splayed ones.
        leftLegRef.current.rotation.z = 0;
        rightLegRef.current.rotation.z = 0;
      } else if (emote === 'CRAWL') {
        // A prone body already leaves its legs trailing behind it, so these only need the
        // alternating push of a commando crawl rather than a full stride.
        //
        // CONTRALATERAL, and it wasn't: the walk pairs each arm with the OPPOSITE leg (see
        // walkLegL/walkLegR against the arms' walkRotX below), but the crawl was driving the
        // left leg on the same sign as the left arm, so the limbs on one side reached and
        // pushed together. That is a camel's pace, and even at a glance it reads as wrong
        // without being obvious why. Flipping the sign pairs each hand's plant with the
        // opposite knee's drive, which is what a crawl is.
        //
        // The +0.20 bias is a floor clearance, not a stylistic lean. The hips sit only about
        // 0.27 world units up in this pose while the legs are 0.54 long (0.51 before
        // LEG_LENGTHEN), so a swing centred on
        // zero puts the trailing foot through the ground on every stroke - see CRAWL_ARM_PITCH
        // for the same geometry on the arms. Biased up, the leg travels between skimming the
        // ground and a drawn-up knee, and never below it.
        leftLegRef.current.rotation.x = 0.20 - crawlSwing * 0.30;
        rightLegRef.current.rotation.x = 0.20 + crawlSwing * 0.30;
        // Knee out to the side as it comes up, tucked back in as it pushes off - the frog-leg
        // half of a commando crawl, and the part that stops the legs reading as a lazy flutter
        // kick. Sign convention is the swim pose's: negative is outboard on the left.
        leftLegRef.current.rotation.z = -0.10 - crawlRightReach * 0.30;
        rightLegRef.current.rotation.z = 0.10 + crawlLeftReach * 0.30;
      } else if (emote === 'DANCE') {
        leftLegRef.current.rotation.x = Math.sin(idlePhase.current * 4) * 0.5;
        rightLegRef.current.rotation.x = -Math.sin(idlePhase.current * 4) * 0.5;
        // Same reason the head branches now state their own pitch: the crawl is the first
        // upright-adjacent pose to leave a splay in rotation.z, and neither of these dance
        // steps ever wrote that axis - so going straight from 匍匐 into one of them used to
        // inherit the frog-legs and keep them for the whole emote.
        leftLegRef.current.rotation.z = 0;
        rightLegRef.current.rotation.z = 0;
      } else if (emote === 'CELEBRATE') {
        leftLegRef.current.rotation.x = Math.sin(idlePhase.current * 8) * 0.2;
        rightLegRef.current.rotation.x = -Math.sin(idlePhase.current * 8) * 0.2;
        leftLegRef.current.rotation.z = 0;
        rightLegRef.current.rotation.z = 0;
      } else {
        const walkLegL = -Math.sin(walkPhase.current * 0.5) * walkSwingRange;
        const walkLegR = Math.sin(walkPhase.current * 0.5) * walkSwingRange;

        leftLegRef.current.rotation.x = THREE.MathUtils.lerp(0, walkLegL, moveWeight.current);
        rightLegRef.current.rotation.x = THREE.MathUtils.lerp(0, walkLegR, moveWeight.current);
        leftLegRef.current.rotation.z = 0;
        rightLegRef.current.rotation.z = 0;

        // Flutter kick, blended on. Both the trail angle and the beat are much smaller than
        // the old six-beat 0.3 rad kick: the legs are supposed to say "swimming" out of the
        // corner of the eye, not be the thing you watch. The rest angle is derived from the
        // body pitch (see SWIM_LEG_LINE), which is what stops the legs sinking a little
        // deeper every time the character leans into a stroke.
        if (inWaterPose) {
          const legL = swimLegPose(-1, swimPhase, swimStroke, swimPitch);
          const legR = swimLegPose(1, swimPhase, swimStroke, swimPitch);
          leftLegRef.current.rotation.x = blendSwimAngle(leftLegRef.current.rotation.x, legL.x, swimPose);
          rightLegRef.current.rotation.x = blendSwimAngle(rightLegRef.current.rotation.x, legR.x, swimPose);
          leftLegRef.current.rotation.z = blendSwimAngle(leftLegRef.current.rotation.z, legL.z, swimPose);
          rightLegRef.current.rotation.z = blendSwimAngle(rightLegRef.current.rotation.z, legR.z, swimPose);
        }
      }
    }

    /**
     * THE JUMP POSE — 準備 / 起跳 / 上升 / 下降 / 落地, laid over whatever the body was doing.
     *
     * This block is the thing that did not exist. The height arc and the squash have been here
     * for a long time; the LIMBS have not, which is why the character left the ground with its
     * arms still swinging at walking pace — 「整個模型被直接往上移動」.
     *
     * WHERE IT SITS IN THE PRIORITY ORDER, and why each neighbour is where it is:
     *
     *   above it   the walk/idle/emote chains and the swim blend, which have already written
     *              this frame's angles. The jump is a cross-fade against THOSE values (that is
     *              what applyBodyPose's weight does), so Idle→Jump, Walk→Jump and Run→Jump all
     *              transition out of the pose the body was actually in — section 八 — with no
     *              second lerp rate anywhere to fight the first one.
     *   NOT over   a furniture pose. `inPoseTransition` owns the body outright while sitting or
     *              lying, and `canJump` above already refuses to start a jump there, so a jump
     *              cannot begin. This guard covers the other direction: sitting down on a piece
     *              during a hop's landing recovery.
     *   NOT over   the somersault. Two full-body animations cannot share a body; `canJump`
     *              refuses to start a jump mid-flip, and the flip refuses to start mid-air.
     *   faded by   the water pose. Jumping into the sea finishes its arc, but the pose gives way
     *              to the water as the water arrives, rather than the two fighting over the arms.
     *   below it   the acting posture (next block). A player who pressed E to look through a
     *              telescope should get the telescope, not a hop.
     *
     * Which joints move is entirely the pose table's business — `applyBodyPose` walks whatever
     * the frame names. A richer skeleton is new rows in jumpPose.ts and nothing here.
     */
    if (!inPoseTransition && !isFlipping && jumpAnim.weight > 0) {
      const jumpWeight = jumpAnim.weight * (1 - swimPose);
      if (jumpWeight > 0.001) applyBodyPose(postureJoints, jumpAnim.pose, jumpWeight);
    }

    /**
     * THE ACTING POSTURE — the body language of every interaction that does not put the player
     * ONTO the piece, and the block this whole rework is really about.
     *
     * What stood here was four lines: two arms swung to -1.35 on a half sine for 0.7 seconds.
     * That was the ENTIRE animation for 泡澡, 烹飪, 觀星, 洗手, 許願, 閱讀, 添柴火, 沖水,
     * 開冰箱, 加熱, 烘烤, 整理儀容, 整理衣物, 看看小鳥, 轉開收音機 and 盪鞦韆 — eighteen
     * pieces of furniture, one gesture, distinguishable only by the caption on the badge. The
     * comment that used to be here defended it on the grounds that "a fridge, a bookshelf and a
     * wishing well all want the character to reach toward the thing", which is true of a fridge
     * and false of the other two.
     *
     * Now the posture is a row in a table (constants/interactionPostures.ts) and this block
     * plays whichever row the piece asked for: the head goes up for a telescope and down for a
     * book, one hand stirs a circle over a hob, the body drops into a crouch at a campfire.
     * Adding a sixteenth verb adds a row, not a branch.
     *
     * It is still LAID OVER the ordinary idle animation rather than replacing it — the envelope
     * is 0 at both ends and every joint is blended by it, so the character keeps breathing
     * underneath and cannot be left stranded mid-reach if the posture is cancelled.
     */
    if (actionFrame && activeAction) {
      applyBodyPose(postureJoints, actionFrame.joints, actionFrame.weight);
      // The walk-up. Easing rather than teleporting, and toward a spot that is already outside
      // the piece's collider (lib/furnitureInteraction.ts), so the collision resolve has nothing
      // to undo. Pressing E across the room does not drag the player in: the spot is only ever
      // resolved for a piece already within DEFAULT_INTERACTION_REACH of them.
      if (activeAction.spot) {
        poseTargetPos.set(activeAction.spot.x, 0, activeAction.spot.z);
        position.current.lerp(poseTargetPos, Math.min(1, 6 * delta));
      }
    }

    // Procedural Water Ripples & Splash FX calculations
    if (isSwimming) {
      if (ripple1Ref.current) {
        // Just *above* WATER_SURFACE_Y, not below it. These were pinned at
        // -0.58 against a surface that sits at -0.5, so the one cue that reads
        // as "someone is swimming here" was submerged under the water plane it
        // is meant to be disturbing.
        ripple1Ref.current.position.set(position.current.x, WATER_SURFACE_Y + 0.015, position.current.z);
        const r1Progress = (time * 0.8) % 1.0;
        const scale = 0.5 + r1Progress * 1.5;
        ripple1Ref.current.scale.set(scale, scale, 1);
        if (ripple1Ref.current.material) {
          (ripple1Ref.current.material as THREE.Material).opacity = (1.0 - r1Progress) * 0.45;
        }
        ripple1Ref.current.visible = true;
      }
      if (ripple2Ref.current) {
        ripple2Ref.current.position.set(position.current.x, WATER_SURFACE_Y + 0.015, position.current.z);
        const r2Progress = ((time * 0.8) + 0.5) % 1.0;
        const scale = 0.5 + r2Progress * 1.5;
        ripple2Ref.current.scale.set(scale, scale, 1);
        if (ripple2Ref.current.material) {
          (ripple2Ref.current.material as THREE.Material).opacity = (1.0 - r2Progress) * 0.45;
        }
        ripple2Ref.current.visible = true;
      }
      if (splashParticlesRef.current) {
        // Same correction as the ripples: the particles arc from -0.1 to +0.12
        // around this origin, so anchoring it at the surface is what lets them
        // actually break it instead of bubbling along underneath.
        splashParticlesRef.current.position.set(position.current.x, WATER_SURFACE_Y + 0.02, position.current.z);
        const children = splashParticlesRef.current.children;
        children.forEach((child, idx) => {
          const speedFactor = 1.0 + (idx % 3) * 0.5;
          const pAngle = (time * 5 * speedFactor) + (idx * 1.5);
          const distFactor = isMoving.current ? 0.35 : 0.18;
          child.position.x = Math.cos(pAngle) * distFactor;
          child.position.z = Math.sin(pAngle) * distFactor;
          child.position.y = Math.max(-0.1, Math.sin(time * 12 + idx) * 0.12);
          const scale = isMoving.current ? (0.05 + Math.sin(time * 15 + idx) * 0.03) : 0.02;
          child.scale.set(scale, scale, scale);
        });
        splashParticlesRef.current.visible = true;
      }
    } else {
      if (ripple1Ref.current) ripple1Ref.current.visible = false;
      if (ripple2Ref.current) ripple2Ref.current.visible = false;
      if (splashParticlesRef.current) splashParticlesRef.current.visible = false;
    }
    
    // Proximity check for the Home's door - geometry shared via characterMovement's
    // findNearbyHome(). Returns null when the Home isn't placed yet, which also clears any
    // stale prompt.
    if (currentView === View.HOME) {
      const nearHome = findNearbyHome(position.current, home);

      if (isCorrectInstance && (nearbyBuilding?.id !== nearHome?.id)) {
        if (nearHome && !nearbyBuilding) happyPulseRef.current = 1;
        setNearbyBuilding(nearHome);
      }
    }

    // Speech bubble dismissal on movement
    if (showBubble && isCorrectInstance && isMoving.current) {
      setShowBubble(false);
    }

    // Export position to global for decoration awareness if needed
    if (isCorrectInstance) {
      playerBus.playerPos = position.current;
      playerBus.playerRotation = rotation.current;
      playerBus.playerIsMoving = isMoving.current;
      // Both airborne states, as one flag: the effect runtime wants "feet left the ground",
      // and a somersault is that just as much as a jump is.
      //
      // `isJumpAirborne`, not `isJumping`: the machine's crouch and landing phases are on the
      // ground with the player's own weight on them. The cosmetic bursts watch this flag's
      // RISING edge (constants/cosmeticEffects.ts), so it now fires at the moment of take-off
      // rather than at the moment the key was pressed - which is where a puff of dust belongs.
      playerBus.playerIsAirborne = isJumpAirborne(jumpStateRef.current) || isFlipping;
      playerBus.isSwimming = isSwimming;
      // Where the body actually is, and how much of it is water pose. The camera frames the
      // character from these rather than from `playerPos` (which never leaves the walking plane),
      // which is what keeps a swimmer in the same place on screen as a walker with nothing to
      // ease and therefore nothing to lag - see constants/cameraFocus.ts and playerBus.ts.
      playerBus.bodyRootY = bodyRootYRef.current;
      playerBus.swimPose = swimPoseRef.current;
      // Published for the camera: 匍匐 puts the body flat on the floor, and the
      // orbit has to come down with it (see CameraController's crawl focus).
      playerBus.isCrawling = emote === 'CRAWL';
    }

    // Dynamic recursive opacity control for seamless First/Third-Person transition.
    // Visibility is toggled here (imperatively, per-frame) instead of via a conditional
    // `if (isHidden) return ...` unmount in the JSX below - that used to tear down and
    // rebuild this entire skeletal mesh tree every time the zoom threshold was crossed,
    // which is itself a stutter risk on weaker hardware, on top of giving zero fade.
    if (groupRef.current) {
      // First person is a HIDE, not a fade: there is no opacity at which looking out through
      // your own face is right, and the eased value is still on its way down on the frame the
      // camera arrives. See isFirstPersonView.
      const fadeOpacity = isFirstPersonView ? 0 : smoothedZoomOpacityRef.current;
      groupRef.current.visible = !isHiddenByMode && !isFirstPersonView && fadeOpacity > 0.001;

      groupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((mat) => {
              if (mat) {
                if (mat.userData.originalOpacity === undefined) {
                  mat.userData.originalOpacity = mat.opacity !== undefined ? mat.opacity : 1.0;
                }

                const wantsTransparent = fadeOpacity < 1.0 || mat.userData.originalOpacity < 1.0;
                // `transparent` is a SHADER SWITCH, not a uniform: three compiles a different
                // program for a transparent material, so flipping it without asking for a
                // recompile leaves the mesh drawing through the opaque program, which ignores
                // `opacity` entirely. That is why this fade never actually faded - the body
                // stayed fully solid all the way down and then vanished the instant `visible`
                // went false, which is what put a solid pair of eyeballs in front of the camera
                // for the last twentieth of the zoom range. Guarded on a real change so the
                // recompile happens twice per fade rather than every frame.
                if (mat.transparent !== wantsTransparent) {
                  mat.transparent = wantsTransparent;
                  mat.needsUpdate = true;
                }
                mat.opacity = mat.userData.originalOpacity * fadeOpacity;
              }
            });
          }
        }
      });
    }
  });

  return (
    <>
      {/* userData flag lets InteractionPromptTracker's occlusion raycast skip the player's own
          body - without it, a target standing roughly behind the player from the camera's
          current angle (very common in third person) would self-occlude against the avatar's
          own mesh and hide the prompt for a reason that has nothing to do with a real wall. */}
      <group ref={groupRef} scale={[baseScale, baseScale, baseScale]} userData={{ isPlayerAvatar: true }}>
        {/* THE CHARACTER MODEL - the only thing under the root, and the only thing a remodel
            replaces. Everything below this group (ripples, splash, footstep VFX) is driven by
            the controller rather than by the mesh, which is why it sits OUTSIDE and keeps
            working whichever character is drawn.

            Note there is no branch on the model here. The registry picks a component, the
            component binds the rig, and this file never learns which one it got. */}
        <CharacterModel modelId={characterModelId} rig={rig} outfit={outfit} />

        {/* 關了燈之後手上那根蠟燭。用 createPortal 掛進右手臂的關節，而不是由角色模型自己畫
            —— 模型只擁有幾何、不知道任何狀態（見 character/types.ts 那條規則），而「家裡的燈
            關了沒有」是純粹的執行期狀態。這樣三個模型一個都不用改，卻每一個都拿得到蠟燭：它們
            共通的東西正好就是這個被綁定的關節。

            插槽的座標由模型自己給（characterRig.ts 的 `hand`），所以 v2 那雙比較長的手臂拿到
            的位置是它自己的答案，不是 legacy 的。 */}
        {isInterior && handHost && createPortal(
          <CandleInHand hand={getCharacterModelDefinition(characterModelId).attachments.hand} />,
          handHost,
        )}
      </group>

      {/* Procedural Water Ripple Rings. renderOrder 3 puts them after every
          transparent water layer (Ocean's two surface planes are 0/1, ShoreWaves'
          crest and foam are 1/2) - without it these sort by object distance
          against planes centered on the world origin, which is arbitrary for a
          ring parked out at the swimmer, so they could be drawn under the very
          surface they represent. */}
      <mesh ref={ripple1Ref} renderOrder={3} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0, 0.45, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
      </mesh>
      <mesh ref={ripple2Ref} renderOrder={3} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0, 0.45, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
      </mesh>
      
      {/* Splashing particle spheres group */}
      <group ref={splashParticlesRef}>
        {[...Array(6)].map((_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[1, 8, 8]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.7} />
          </mesh>
        ))}
      </group>

      {/* Footstep VFX - spawned per footfall by spawnFootstepVfx(), animated above in useFrame.
          Deliberately NOT nested under the avatar's own group: these are world-space marks left
          behind on the ground, so they must not inherit the body's position, yaw or walk bounce. */}
      <group>
        {Array.from({ length: FOOTSTEP_PUFF_POOL }).map((_, i) => (
          <mesh
            key={`puff-${i}`}
            ref={(el) => { puffMeshRefs.current[i] = el; }}
            visible
          >
            <sphereGeometry args={[1, 8, 6]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} />
          </mesh>
        ))}
        {Array.from({ length: FOOTSTEP_RING_POOL }).map((_, i) => (
          <mesh
            key={`ring-${i}`}
            ref={(el) => { ringMeshRefs.current[i] = el; }}
            visible
            rotation={[-Math.PI / 2, 0, 0]}
          >
            {/* Unit ring (outer radius 1) so the animation can drive its size purely by scale.
                The band is a chunky 45% of the radius - a thin hoop reads as an artifact at
                gameplay camera distance, while a band this wide still reads as a scuff mark. */}
            <ringGeometry args={[0.55, 1, 28]} />
            <meshBasicMaterial
              color="#ffffff"
              transparent
              opacity={0}
              depthWrite={false}
              side={THREE.DoubleSide}
              // A flat ring has nothing to order back-to-front, and without this three draws a
              // transparent DoubleSide material in two passes by flipping `side` + `needsUpdate`,
              // i.e. a full program lookup twice per live ring per frame while walking.
              forceSinglePass
              {...DECAL_DEPTH_BIAS}
            />
          </mesh>
        ))}
      </group>
    </>
  );
}
