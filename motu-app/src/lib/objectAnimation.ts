/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE OBJECT-REACTION SOLVER — the maths half of constants/objectAnimations.ts, with no React and
 * no three.js in it.
 *
 * Everything here is a PURE FUNCTION of `(spec, state, now)`. That is not a stylistic preference:
 * the runtime that calls it (Three/objectAnimation.tsx) rides the shared culled pass in
 * Three/outdoorAnimation.tsx, which skips objects that are far away or off screen and gives the
 * survivors an update every second or fourth frame. A culled object is not paused — it is simply
 * not asked — so its pose has to be re-derivable from the clock alone. Anything that integrated,
 * lerped toward a target or kept a velocity would drift while it was not being asked, and would
 * arrive at the wrong pose the frame it came back on screen.
 *
 * The same property is what makes the cleanup story in §10 of the brief nearly empty: there is no
 * timer to cancel, no tween to stop and no loop to unsubscribe. When a piece's state goes back to
 * `off`, {@link objectOpen} returns 0 for the rest of time, and 0 is the rest pose.
 */

import {
  DEFAULT_CLOSE_TIME,
  DEFAULT_HOLD,
  DEFAULT_OPEN_TIME,
  DEFAULT_PULSE_OVER,
  ObjectAnimationSpec,
  ObjectLaunchSpec,
  ObjectPartSpec,
} from '../constants/objectAnimations';

/**
 * WHO THREW IT, AND FROM WHERE — everything {@link resolveLaunchHeading} is allowed to know.
 *
 * Deliberately four numbers and no objects: no placement, no item, no three.js. That is what
 * lets the direction rule be tested over a grid of approach angles without a renderer (see
 * `npm run audit:object-animations`), and it is what stops the next throwable piece from
 * needing its own copy of this arithmetic.
 *
 * Both yaws use the convention the whole project uses for a heading on the ground plane:
 * `yaw = atan2(dx, dz)`, so yaw 0 points along world +Z and the unit vector is
 * `(sin yaw, cos yaw)`. Avatar's `rotation.current`, a placement's `rotation` and an
 * `InteractionSpot.yaw` are all already in it.
 */
export interface LaunchContext {
  /** Where the player's body is at the moment of the throw, world XZ. */
  playerX: number;
  playerZ: number;
  /** Which way that body is pointing, radians. */
  playerYaw: number;
  /** Where the piece is, world XZ. */
  objectX: number;
  objectZ: number;
}

/**
 * WHICH WAY A THROWN PIECE GOES — the whole of the dynamic-direction rule, as one pure function.
 *
 * A weighted blend of the two headings the player supplies, normalised and turned back into a
 * yaw. See {@link ObjectLaunchSpec} for what the two are and why a piece states a weight rather
 * than picking one.
 *
 * Two degenerate inputs, and both fall back to the FACING rather than to a constant — because a
 * constant is the bug this function exists to remove:
 *
 *   the player is standing exactly ON the piece   there is no 「away」 to normalise.
 *   the blend cancels out                          only reachable at `fromFacing` near 0.5 with
 *                                                  the player looking directly away from the
 *                                                  piece, which is a body facing one way and a
 *                                                  shove going the other.
 *
 * `jitter` is the spread sample, passed in rather than rolled here so this stays pure and the
 * caller owns the one random draw per throw.
 */
export function resolveLaunchHeading(
  launch: ObjectLaunchSpec,
  ctx: LaunchContext,
  jitter = 0,
): number {
  const facing = clamp01(launch.fromFacing);
  const fx = Math.sin(ctx.playerYaw);
  const fz = Math.cos(ctx.playerYaw);

  let ax = ctx.objectX - ctx.playerX;
  let az = ctx.objectZ - ctx.playerZ;
  const span = Math.hypot(ax, az);
  if (span < 1e-4) {
    ax = fx;
    az = fz;
  } else {
    ax /= span;
    az /= span;
  }

  const bx = fx * facing + ax * (1 - facing);
  const bz = fz * facing + az * (1 - facing);
  const length = Math.hypot(bx, bz);
  const heading = length < 1e-4 ? ctx.playerYaw : Math.atan2(bx, bz);
  return heading + jitter;
}

/** One spread sample for a throw, in [-spread, +spread]. The only random draw in this system. */
export function sampleLaunchSpread(launch: ObjectLaunchSpec): number {
  const spread = launch.spread ?? 0;
  return spread <= 0 ? 0 : (Math.random() * 2 - 1) * spread;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * THE TWO TIMESTAMPS a reacting object keeps, and the only state in this whole subsystem.
 *
 * Same shape and same reasoning as `SuspendedTimeline` in lib/outdoorMotion.ts: the moment the
 * thing turned on and the moment it turned off, both in `performance.now()` milliseconds, so the
 * object's pose on any frame is a function of the clock rather than of how many frames it has
 * been shown for.
 *
 * `armedAt` is the third and is what makes the player and the object agree. The player presses E
 * and the object's state does not change THEN — it changes `cue` × the posture's duration later,
 * when the hand actually reaches the handle. `armedAt` is that scheduled moment; the state edge
 * is derived from it rather than being posted by a `setTimeout`, so a piece scheduled to open
 * while the player walks out of range still opens exactly when it should, and a piece that is
 * culled during its own cue does not miss it.
 */
export interface ObjectTimeline {
  /** When the state last became active, ms. Null while it is off. */
  onAt: number | null;
  /** When it last became inactive, ms. Null if it has never been on. */
  offAt: number | null;
  /** When the last trigger's cue lands, ms. Drives `pulse` and the scheduled state edge. */
  armedAt: number | null;
  /**
   * WHICH WAY THIS THROW WENT — the launch group's yaw in its own parent's frame, radians, or
   * null for a piece that does not launch.
   *
   * The fourth number, and the only one that is not a clock reading. It is resolved ONCE, when
   * the throw is armed ({@link resolveLaunchHeading} against the player who threw it), and held
   * for the flight — which is what keeps the rest of this system's promise intact: the pose is
   * still a pure function of `(spec, state, now)`, so a disc culled halfway through its flight
   * still comes back exactly where it should be, along the heading it was actually thrown on.
   *
   * Resolving it per frame instead would mean the flight bent to follow a player who walked
   * away, and a culled disc would have no player to read at all.
   */
  aim: number | null;
}

export const IDLE_TIMELINE: Readonly<ObjectTimeline> = {
  onAt: null, offAt: null, armedAt: null, aim: null,
};

/** Smoothstep. Zero slope at both ends, which is why nothing in this system starts with a jerk. */
export function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * HOW OPEN THE PIECE IS RIGHT NOW, 0..1 — the one scalar every `open`-driven part reads.
 *
 * Three cases, and the middle one is the interesting one:
 *
 *   turning on   eased over `openTime` from `onAt`. For a `momentary` or `run` piece it then
 *                holds for `hold` seconds and eases back down on its own, WITHOUT anything having
 *                to post a second event — the whole open-hold-close arc is one expression of
 *                `now - onAt`. That is what makes 「物件卡在半開狀態」 unrepresentable: there is
 *                no half-open state to be stuck in, only a clock reading.
 *   turning off  eased over `closeTime` from `offAt`, then 0 forever.
 *   never on     0.
 *
 * `hold` is only consulted for the self-closing behaviours. A `latch`, a `toggle` and an
 * `occupied` piece stay at 1 until something turns them off, which is the whole difference
 * between them and the other two.
 */
export function objectOpen(spec: ObjectAnimationSpec, tl: ObjectTimeline, now: number): number {
  const openTime = Math.max(0.01, spec.openTime ?? DEFAULT_OPEN_TIME);
  const closeTime = Math.max(0.01, spec.closeTime ?? DEFAULT_CLOSE_TIME);

  if (tl.onAt != null) {
    const since = (now - tl.onAt) / 1000;
    if (since < 0) return 0;
    if (selfClosing(spec)) {
      const hold = spec.hold ?? DEFAULT_HOLD;
      const fallStart = openTime + hold;
      if (since >= fallStart) return 1 - smooth((since - fallStart) / closeTime);
    }
    return smooth(since / openTime);
  }

  if (tl.offAt == null) return 0;
  const since = (now - tl.offAt) / 1000;
  return since <= 0 ? 1 : 1 - smooth(since / closeTime);
}

/** Whether this behaviour returns to rest without being told to. */
export function selfClosing(spec: ObjectAnimationSpec): boolean {
  return spec.behaviour === 'momentary' || spec.behaviour === 'run';
}

/**
 * Whether a self-closing piece's cycle has finished — i.e. whether it may forget it was ever on.
 *
 * The runtime uses this to retire an entry rather than leaving it registered forever: once a
 * fridge has swung shut there is nothing left for it to animate, and asking it sixty times a
 * second whether it is still zero is the leak §11 warns about, in slow motion.
 */
export function objectCycleDone(spec: ObjectAnimationSpec, tl: ObjectTimeline, now: number): boolean {
  if (!selfClosing(spec) || tl.onAt == null) return false;
  const total = (spec.openTime ?? DEFAULT_OPEN_TIME)
    + (spec.hold ?? DEFAULT_HOLD)
    + (spec.closeTime ?? DEFAULT_CLOSE_TIME);
  return (now - tl.onAt) / 1000 >= total;
}

/**
 * The value a single part is at, given the piece's `open` signal, the shared clock and the
 * timeline.
 *
 * Returned as a plain number in the part's own unit — radians, model units or a scale delta — so
 * the caller writes it into whichever three.js property the motion names and this file never
 * touches a scene graph.
 */
export function partValue(
  part: ObjectPartSpec,
  open: number,
  time: number,
  tl: ObjectTimeline,
  now: number,
): number {
  switch (part.signal) {
    case 'spin':
      // Continuous from the shared clock so it is cullable, but only turning while the piece is
      // on: a microwave plate does not spin in a dark microwave.
      return part.travel * open * ((time / Math.max(0.05, part.period ?? 4)) * Math.PI * 2);

    case 'wobble':
      return part.travel * open
        * Math.sin((time / Math.max(0.05, part.period ?? 2)) * Math.PI * 2);

    case 'pulse': {
      // Measured from the CUE, not from the press: a button that goes down before the hand has
      // reached it is the exact desync this system exists to remove.
      if (tl.armedAt == null) return 0;
      const over = Math.max(0.05, part.over ?? DEFAULT_PULSE_OVER);
      const p = (now - tl.armedAt) / 1000 / over;
      if (p <= 0 || p >= 1) return 0;
      return part.travel * Math.sin(p * Math.PI);
    }

    default:
      return part.travel * remapRange(open, part.range);
  }
}

/**
 * Re-eases `open` across a sub-range, so parts on one signal can be staggered.
 *
 * Smoothstepped again on the way out rather than being a straight clamp: a part that starts at
 * 0.4 of the signal would otherwise begin with the parent's own velocity already built up, and
 * would visibly snap into motion.
 */
function remapRange(open: number, range: readonly [number, number] | undefined): number {
  if (!range) return open;
  const [from, to] = range;
  if (to <= from) return open >= to ? 1 : 0;
  return smooth((open - from) / (to - from));
}

/**
 * Does this piece still need updating this frame?
 *
 * §11's 「靜止狀態的物件不應持續進行不必要的 Animation Update」, answered as one predicate rather
 * than as a rule everyone has to remember. A piece that is fully closed, has no live pulse and is
 * not occupied has nothing to compute — the runtime writes its rest pose once and stops asking.
 */
export function objectIsSettled(
  spec: ObjectAnimationSpec,
  tl: ObjectTimeline,
  now: number,
  open: number,
): boolean {
  if (open > 0.001) return false;
  if (tl.onAt != null) return false;
  if (tl.armedAt != null && now - tl.armedAt < maxPulseWindow(spec) * 1000) return false;
  return true;
}

function maxPulseWindow(spec: ObjectAnimationSpec): number {
  let longest = 0;
  const parts = spec.parts;
  if (!parts) return 0;
  for (const key in parts) {
    const p = parts[key];
    if (p.signal === 'pulse') longest = Math.max(longest, p.over ?? DEFAULT_PULSE_OVER);
  }
  return longest;
}
