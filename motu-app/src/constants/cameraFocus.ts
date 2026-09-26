/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WHERE THE ORBIT LOOKS — one rule, so the character holds the same place in the frame whatever
 * the body is doing.
 *
 * 「玩家模型永遠在畫面中間，因此下海/回島鏡頭不會有延遲」. The camera does not aim at the
 * character's logical position (`playerBus.playerPos`, which never leaves the walking plane) but
 * at the middle of the body as it is actually RENDERED, plus a fixed lift. Both terms move, and
 * the whole point of stating them here rather than inside CameraController is that they move for
 * reasons only Avatar.tsx can see:
 *
 *   the root sinks   entering the sea drops the body to {@link SWIM_BODY_Y}, ~0.6 below the
 *                    plane the walker stands on. The bus position does not follow it down.
 *   the body lies    and then it lies down (Three/swimPose.ts pitches it ~71deg about its own
 *                    root), which brings its middle from {@link STANDING_BODY_MIDDLE_Y} to
 *                    {@link FLOATING_BODY_MIDDLE_Y}.
 *
 * 1.25 world units in total, at a default zoom whose half-frame is 2.21 — i.e. a swimmer framed
 * as if they were walking sits 57% of the way from the middle of the screen to its bottom edge
 * lower than a walker, which is well past the top of the bottom navigation bar. That was the
 * reported 「角色在島上走動時會固定在中間，進入海裡就不會，會被下方功能鍵擋住」.
 *
 * WHY THERE IS NO EASING HERE, WHICH IS THE WHOLE POINT. The camera used to answer that with a
 * blend of its own — 1.8 eased toward the swim focus at a fixed rate whenever `isSwimming` went
 * true. Two independently-timed curves for one movement: the body crossed the 1.25 on
 * SWIM_TRANSITION_DURATION's eased ramp (Avatar.tsx applies its swim heights with no smoothing
 * at all, precisely so height and tilt stay in lockstep), while the camera crossed it on an
 * exponential lag that was still a third of the way behind when the body arrived. The character
 * therefore SANK in the frame on the way in and rose on the way out — 「下海/回島鏡頭會有延遲」.
 * Nothing here has a rate, a timer or a blend state: it is a function of the body's rendered
 * height and pose weight this frame, so the framing cannot lag the body by construction, and a
 * future change to how fast the water pose develops needs no matching change here.
 */
import { SWIM_BODY_Y } from './world';

/**
 * How high the body's middle sits above its own root (the character's feet), standing.
 *
 * With the root on the walking plane this plus {@link FOCUS_ABOVE_BODY_MIDDLE} is the 1.8 the
 * outdoor orbit has always aimed at, which is where it comes from.
 */
export const STANDING_BODY_MIDDLE_Y = 0.9;

/**
 * The same measurement for the floating body: lying flat, its middle is barely a quarter of a
 * unit above the root, against the standing 0.9. See Three/swimPose.ts for the pitch.
 */
export const FLOATING_BODY_MIDDLE_Y = 0.25;

/**
 * How far above the body's middle the orbit actually aims — i.e. how high the character sits in
 * the frame. The one piece of taste in this file; everything else is a measurement of the body.
 */
export const FOCUS_ABOVE_BODY_MIDDLE = 0.9;

/** The land framing, as an offset above the walking plane. Unchanged at 1.8 - see the module doc. */
export const STANDING_FOCUS_Y = STANDING_BODY_MIDDLE_Y + FOCUS_ABOVE_BODY_MIDDLE;

/** The same, for a body floating in deep water. Reached continuously, never blended toward. */
export const SWIM_FOCUS_Y = SWIM_BODY_Y + FLOATING_BODY_MIDDLE_Y + FOCUS_ABOVE_BODY_MIDDLE;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Where the orbit looks, as a height above the character's walking plane (`playerPos.y`).
 *
 * @param planeY     the walking plane — the height `playerBus.playerPos` reports.
 * @param bodyRootY  world Y of the body's root as it is being RENDERED this frame
 *                   (`playerBus.bodyRootY`); `undefined` before the avatar has published one,
 *                   which falls back to the swim depth the pose weight implies.
 * @param swimPose   the water-pose weight the avatar is rendering, 0..1
 *                   (`playerBus.swimPose`).
 *
 * ONLY THE PART OF THE ROOT BELOW THE PLANE COUNTS. The body's height on land is the terrain's,
 * which runs from 0.4 on the mound to 0.02 at the water line - and the island framing measured
 * from the plane is the one that is already right (and the one the bottom navigation bar was
 * fitted around). Following the terrain up would move that framing for no reported reason;
 * following the body DOWN is the defect this file exists for, and the sea is the only place the
 * body ever goes below the plane. So the drop is clamped at zero: on land this returns exactly
 * the 1.8 it always did, and it starts tracking the moment the body starts sinking - including
 * the shallows, where a wader whose feet are on a seabed 0.2 under the plane is 0.2 lower in the
 * world and should be no lower in the frame.
 */
export function orbitFocusOffsetY(
  planeY: number,
  bodyRootY: number | undefined,
  swimPose: number,
): number {
  const pose = clamp01(swimPose);
  const rootY = bodyRootY ?? planeY + SWIM_BODY_Y * pose;
  const drop = Math.min(0, rootY - planeY);
  return drop + lerp(STANDING_BODY_MIDDLE_Y, FLOATING_BODY_MIDDLE_Y, pose) + FOCUS_ABOVE_BODY_MIDDLE;
}

/**
 * The world height of the body's middle - i.e. the point {@link orbitFocusOffsetY} is derived
 * from, and therefore the point that has to hold still in the frame. Exported for
 * scripts/audit-swim-pose.ts's FRAME check, which measures exactly that.
 */
export function bodyMiddleY(bodyRootY: number, swimPose: number): number {
  return bodyRootY + lerp(STANDING_BODY_MIDDLE_Y, FLOATING_BODY_MIDDLE_Y, clamp01(swimPose));
}
