/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getActiveViewerPos, playerBus } from '../../../lib/playerBus';

/**
 * Shared MiniMap system — the scene-independent half.
 *
 * WHY THIS EXISTS: the minimap used to be one component that did everything
 * (read the player, lay out the house, draw the plan, style the card) and
 * therefore only ever worked for one scene, at one zoom, in one orientation.
 * The pieces are now split so a second scene (the island, another floor, a
 * dungeon) is a *drawing*, not a second minimap:
 *
 *   miniMapCore.ts        — the pose (position, character facing, camera
 *                           heading) and the world→px scale.
 *   MiniMapViewport.tsx   — the round window: follows the player and turns the
 *                           map to the camera.
 *   MiniMapMarker.tsx     — the indicator system: the player's own arrow, plus
 *                           the world-anchored marker any NPC/quest target
 *                           reuses.
 *   MiniMapFrame.tsx      — the ship's-wheel bezel and its nameplate.
 *   <scene>.tsx           — world-space SVG for one place
 *                           (InteriorMiniMapScene is the first).
 *
 * A new scene supplies world-unit bounds and SVG children drawn through
 * {@link mmPx}. It inherits tracking, rotation, smoothing, the frame and the
 * responsive sizing for free, and it cannot drift from the interior map
 * because there is only one implementation of each of those.
 *
 * ── THE TWO ROTATIONS ─────────────────────────────────────────────────────
 * They are separate inputs with separate sources, and neither is derived from
 * the other:
 *
 *   MAP     turns with the CAMERA ({@link MiniMapPose.viewDeg}), so the map is
 *           heading-up: what is in front of you is at the top of the window.
 *   ARROW   turns with the CHARACTER MODEL ({@link MiniMapPose.facingDeg}), so
 *           orbiting the camera around a standing character swings the map
 *           while the arrow keeps pointing at whatever the character is
 *           actually facing.
 *
 * Every angle in this system is authored in ONE frame: screen-clockwise
 * degrees from up on a north-up map — the bearing of the thing in the world.
 * The viewport is the only place that frame is converted to screen, and it
 * does it once (see MiniMapViewport). That is what keeps the two rotations
 * from contaminating each other and what lets a future NPC/quest indicator
 * state a plain world bearing and land correctly on a turning map.
 */

/**
 * Rendered pixels per world unit — the map's zoom, and the reason the map is
 * legible now.
 *
 * The old map *fitted the whole house* into a ~136px box, so its zoom fell as
 * the player expanded: a room was ~68px across with the three starter rooms
 * and ~34px in a 4x4 house, i.e. the more there was to read, the smaller it
 * was drawn. A fixed scale plus a player-following viewport (below) instead
 * gives every room the same 72px on screen forever, and expansion scrolls
 * rather than shrinks.
 */
export const MINIMAP_PX_PER_WORLD = 6;

/** World units → the px space every minimap scene draws in. */
export const mmPx = (world: number) => world * MINIMAP_PX_PER_WORLD;

/**
 * How far past a scene's own bounds its paper is drawn, in world units.
 *
 * The viewport is a follow-camera, so when the player stands at the very edge
 * of the scene half the window looks at nothing. This has to exceed the
 * largest possible viewport *radius* (--minimap-w caps the window at ~200px,
 * so ~17 world units) with room to spare for the corners a rotated square
 * would otherwise expose.
 */
export const MINIMAP_WORLD_PAD = 32;

export interface MiniMapPose {
  /** World XZ of whatever the player is currently looking through. */
  x: number;
  z: number;
  /**
   * Bearing of the CHARACTER MODEL — screen-clockwise degrees from up on a
   * north-up map. See {@link worldYawToFacingDeg}.
   */
  facingDeg: number;
  /**
   * Bearing the CAMERA is looking along, in the same frame. The map is turned
   * by exactly `-viewDeg`, which is what puts this direction at the top of the
   * window. See {@link cameraYawToViewDeg}.
   */
  viewDeg: number;
}

const RAD2DEG = 180 / Math.PI;

/**
 * A three.js Y-rotation (the yaw an avatar/NPC/prop is turned by) → that
 * subject's bearing on the map.
 *
 * The one conversion, so every indicator agrees. In the map's north-up frame
 * world +X is screen right and world +Z is screen down. A yaw of `r` points
 * the model along (sin r, cos r) — Avatar.tsx steers with
 * `atan2(move.x, move.z)`, which is that same convention — and the
 * clockwise-from-up angle of that direction is `180° - r`.
 */
export function worldYawToFacingDeg(yaw: number): number {
  return 180 - yaw * RAD2DEG;
}

/**
 * A camera's Y-rotation → the bearing it is looking along, in the same frame
 * as {@link worldYawToFacingDeg}.
 *
 * A camera looks down its own -Z where a model faces +Z, so its forward is the
 * model direction turned half a circle: `(180° - r) - 180° = -r`. Stated as
 * its own function because the half-turn is exactly the kind of thing that
 * gets "fixed" with a hardcoded 180 at a call site once the two conventions
 * are ever confused.
 */
export function cameraYawToViewDeg(yaw: number): number {
  return -yaw * RAD2DEG;
}

/**
 * Where the player is, which way their model faces, and which way the camera
 * looks — read straight off `playerBus`, so no React state, no subscription,
 * safe to call every frame.
 *
 * FACING AND VIEW ARE DIFFERENT QUESTIONS, which is why both are here.
 * `playerBus.playerRotation` is the avatar's own steering yaw and Avatar.tsx
 * applies exactly that value to the model (`bodyYawRef` is snapped to it every
 * moving frame), so the arrow and the character on screen cannot point
 * different ways. `playerBus.cameraYaw` is written from the live camera
 * quaternion by CameraController — every frame, in every one of its branches
 * (orbit, first person, dressing room, the interior's free-edit camera), so
 * this needs no per-mode or per-scene special case. They coincide in first
 * person, where Avatar.tsx already steers the character by the camera; nothing
 * here has to know that.
 *
 * The exception is the interior's free-edit ("佈置模式") camera: the avatar is
 * frozen there and the map follows the free camera instead (see
 * getActiveViewerPos), so the subject of the centre marker really *is* the
 * camera — its facing has to come from the same subject as its position, or
 * the arrow in the middle of the window would describe a character standing
 * somewhere else entirely.
 */
export function readMiniMapPose(): MiniMapPose | null {
  // getActiveViewerPos() already answers "where is the user, really" for both
  // the walking avatar and the frozen-avatar build camera — see playerBus.
  const pos = getActiveViewerPos();
  if (!pos) return null;

  const viewDeg = cameraYawToViewDeg(playerBus.cameraYaw ?? 0);
  const facingDeg = playerBus.isBuildMode
    ? viewDeg
    : worldYawToFacingDeg(playerBus.playerRotation ?? 0);

  return { x: pos.x, z: pos.z, facingDeg, viewDeg };
}

/**
 * Largest frame delta the smoothing below will honour, in seconds.
 *
 * Browsers throttle rAF in a hidden tab, so the first frame back can report a
 * multi-second delta. Feeding that to an exponential ease is harmless (it just
 * saturates), but clamping keeps the map's catch-up identical to any other
 * resumed frame instead of "instant" — same reasoning as clampFrameDelta() in
 * playerBus.ts, which the 3D layer routes its own deltas through.
 */
export const MINIMAP_MAX_DT = 0.1;

/**
 * How fast the arrow turns to meet the character's facing, per second.
 *
 * Deliberately fast (~55ms time constant). The source is *already* eased —
 * Avatar.tsx turns the character toward its movement direction at rate 22 — so
 * this pass is not there to make the turn look smooth; the character's own turn
 * is the thing the arrow must match. What it is there for is the discontinuous
 * cases the source can't smooth: a teleport writing `rotation.current` outright
 * (leaving build mode hands the avatar the camera's facing), and the ±180°
 * wrap. A slower ease here would just show up as the arrow lagging behind the
 * model, which is the one error this whole indicator exists to avoid.
 */
const FACING_RATE = 18;

/**
 * How fast the map turns to meet the camera, per second.
 *
 * A touch softer than the arrow (~70ms) and for the same kind of reason: the
 * camera yaw arriving here is already damped by OrbitControls, so this only has
 * to absorb the steps the source can't — a mode switch that re-seats the camera
 * behind the character, and the wrap. Any slower and the whole plan visibly
 * trails a flick of the look stick, which on a heading-up map reads as input
 * lag rather than weight.
 */
const VIEW_RATE = 14;

/**
 * Ease `current` toward `target` the short way round the circle.
 *
 * An exponential ease, NOT a fixed step per frame: `1 - e^(-rate·dt)` is
 * frame-rate independent, so a turn feels the same at 30, 60 and 144Hz, and it
 * never overshoots or ratchets.
 *
 * The wrap is the other half of the point: 359° → 1° is a 2° turn, and any
 * smoothing that misses that spins the map (or the marker) 358° backwards every
 * time it crosses north — the classic 0/360 jump. Differences are unwrapped
 * into (-180, 180] before easing for exactly that reason.
 */
export function smoothAngleDeg(current: number, target: number, dt: number, rate: number): number {
  const diff = wrapDeg(target - current);
  return current + diff * (1 - Math.exp(-rate * Math.min(dt, MINIMAP_MAX_DT)));
}

/** {@link smoothAngleDeg} at the arrow's rate. */
export const smoothFacingDeg = (current: number, target: number, dt: number) =>
  smoothAngleDeg(current, target, dt, FACING_RATE);

/** {@link smoothAngleDeg} at the map's rate. */
export const smoothViewDeg = (current: number, target: number, dt: number) =>
  smoothAngleDeg(current, target, dt, VIEW_RATE);

/** Fold an angle into (-180, 180]. */
export function wrapDeg(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}
