/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE MOTION MATHS BEHIND EVERY MOVING OUTDOOR OBJECT — one wind field, one pendulum, and
 * nothing else. No React, no three.js, no scene graph: only pure functions of time.
 *
 * ## Why this is a separate file from the runtime that calls it
 *
 * Two things have to agree on where a swinging piece of furniture IS at a given moment, and they
 * live at opposite ends of the codebase:
 *
 *   Three/FurnitureItem.tsx   draws the seat, the ropes, the hammock's cloth.
 *   Three/Avatar.tsx          drives the body that is sitting on it.
 *
 * Before this file, they did not agree. The hammock's model was static and the AVATAR alone was
 * nudged 2 cm on a `sin(t * 1.5)` — in WORLD space, so a hammock rotated in build mode rocked its
 * occupant sideways across the cloth. The swing was the mirror image: the SEAT swung on its own
 * timer and the player stood beside it playing a push animation. In both cases the piece and the
 * person were two animations that happened to be near each other.
 *
 * They are now one number. Both callers evaluate {@link suspendedAngle} with the same spec and
 * the same two timestamps, so they cannot drift — not because they are carefully kept in step,
 * but because there is only one thing to be in step with.
 *
 * ## Everything here is a pure function of time, and that is a performance decision
 *
 * Nothing integrates. An object's pose at time *t* depends only on *t* (and, for a piece someone
 * is sitting on, on when they sat down) — never on its pose last frame. That is what makes
 * distance and frustum culling FREE: a palm tree that is skipped for two hundred frames because
 * it is behind the camera does not drift out of phase, and does not have to be caught up when it
 * comes back. It simply evaluates the current time and is instantly correct.
 *
 * An integrator would have made culling a trade — smoothness for frames — and every "why did that
 * object pop" bug after it. See Three/outdoorAnimation.tsx for the culling that this buys.
 */

import { WeatherType } from '../types';
import { getWeatherSwayFactors } from '../utils/weatherSway';

/* ------------------------------------------------------------------ the wind field */

/**
 * The prevailing wind, radians about +Y. Gusts travel ALONG this direction across the island,
 * which is the cheapest possible way to stop a grove of palms moving as one object: two trees
 * ten metres apart are sampling the same wave at different points on it, so they are out of
 * phase by construction rather than by a per-tree random number.
 */
const WIND_HEADING = 0.72;
const WIND_DX = Math.sin(WIND_HEADING);
const WIND_DZ = Math.cos(WIND_HEADING);

/**
 * How much of a gust cycle one world unit downwind is worth.
 *
 * Small on purpose. At 0.055 a gust front takes about 18 world units to shift a full radian of
 * phase, so neighbouring plants lean together (they are in the same gust) while opposite ends of
 * the island do not (they are not). Crank it up and the island reads as rippling; zero it and
 * every plant is a metronome copy of every other.
 */
const WIND_SPATIAL = 0.055;

/**
 * The three sway harmonics, in cycles per second of wind clock.
 *
 * Deliberately NOT harmonically related: 0.19, 0.47 and 1.13 have no common period inside any
 * time a player will stand and watch, so the sway never visibly repeats. One sine alone is a
 * windscreen wiper; three at these ratios read as air.
 */
const SWAY_HZ = [0.19, 0.47, 1.13] as const;
const SWAY_GAIN = [0.60, 0.28, 0.12] as const;
const SWAY_PHASE = [0, 1.7, 4.1] as const;

/** The gust envelope: slower still, and always positive — the wind drops but never reverses. */
const GUST_HZ = [0.083, 0.21] as const;
const GUST_GAIN = [0.34, 0.16] as const;
const GUST_PHASE = [2.3, 5.0] as const;
const GUST_BASE = 0.5;

const TAU = Math.PI * 2;

/**
 * How hard the wind is blowing, as a function of the weather.
 *
 * A module-level value rather than a React context because the things that read it are the
 * FURNITURE MODELS, which are also rendered by the build-time audits (scripts/lib/
 * measureFurnitureModel.ts) with a stub hook dispatcher that has no provider above it. A model
 * that called `useApp()` to find out how windy it is would throw there, and the audit would file
 * it under "unmeasurable" — which is exactly the hole that harness was written to close.
 *
 * Published by Three/Scene.tsx, which already has the weather.
 */
let windSpeedMult = 1;
let windAmountMult = 1;

export function setWindWeather(weather: WeatherType): void {
  const { speedMult, swayAmt } = getWeatherSwayFactors(weather);
  windSpeedMult = speedMult;
  windAmountMult = swayAmt;
}

/** How far the wind's own amplitude is scaled by the current weather, 0.2 (snow) .. 2.5 (storm). */
export function windAmount(): number {
  return windAmountMult;
}

/**
 * THE WIND CLOCK — accumulated rather than read off `state.clock`, and the reason is a one-line
 * bug that would otherwise ship every time the weather changed.
 *
 * The obvious implementation is `sin(elapsed * speedMult)`: multiply the clock by how windy it
 * is. But `speedMult` jumps from 1.0 to 2.8 the moment a storm rolls in, and multiplying an
 * already-large elapsed time by a different constant TELEPORTS the phase — every plant on the
 * island snaps to a new angle on that one frame. Integrating the multiplier instead means a
 * storm makes the wind speed UP from wherever it currently is, which is what weather does.
 *
 * One accumulator for the whole island, advanced once per frame by the animation driver.
 */
let windClockSeconds = 0;

export function advanceWindClock(delta: number): number {
  // Clamped: a tab that has been in the background hands back a delta of several seconds, and
  // letting that through would fast-forward every plant by half a minute on the frame the player
  // comes back to it.
  windClockSeconds += Math.min(delta, 0.1) * windSpeedMult;
  return windClockSeconds;
}

export function windClock(): number {
  return windClockSeconds;
}

/** What the wind is doing at one point on the island. Reused in place — never held across calls. */
export interface WindSample {
  /** Signed sway along the prevailing wind, roughly -1..1 before weather scaling. */
  sway: number;
  /**
   * A second, decorrelated sway for the perpendicular axis. Applying only `sway` makes every
   * leaf trace a straight line back and forth; a small amount of this turns it into a figure,
   * which is the difference between a hinge and a leaf.
   */
  cross: number;
  /** 0..1, how hard it is blowing right now. Never negative — the wind drops, it does not flip. */
  gust: number;
}

/**
 * Samples the wind at a world position.
 *
 * `lag` shifts the sample BACK in time, which is how follow-through is done here: a frond that
 * reads the field 0.2 s in the past is a frond that trails what the trunk is doing, with no
 * spring, no state and no extra cost. Every node of a wind rig is the same field at a different
 * moment.
 *
 * Writes into `out` and returns it. Called once per animated object per frame, so it allocates
 * nothing.
 */
export function sampleWind(x: number, z: number, lag: number, out: WindSample): WindSample {
  // The gust front travels downwind: a point further along the wind direction sees the same wave
  // later, so `u` runs backwards with distance.
  const u = windClockSeconds - lag - (x * WIND_DX + z * WIND_DZ) * WIND_SPATIAL;

  let sway = 0;
  let cross = 0;
  for (let i = 0; i < 3; i++) {
    const w = TAU * SWAY_HZ[i] * u + SWAY_PHASE[i];
    sway += SWAY_GAIN[i] * Math.sin(w);
    // The perpendicular component is the SAME harmonics read a quarter turn round, which is what
    // makes it decorrelated from `sway` without a second set of constants to keep in step.
    cross += SWAY_GAIN[i] * Math.sin(w * 0.83 + 2.1);
  }

  let gust = GUST_BASE;
  for (let i = 0; i < 2; i++) gust += GUST_GAIN[i] * Math.sin(TAU * GUST_HZ[i] * u + GUST_PHASE[i]);

  // The gust modulates the sway rather than sitting beside it: a lull genuinely stills the
  // leaves instead of just making a constant wiggle quieter.
  const drive = 0.45 + gust * 0.55;
  out.sway = sway * drive * windAmountMult;
  out.cross = cross * drive * windAmountMult * 0.6;
  out.gust = gust * windAmountMult;
  return out;
}

/**
 * The ANGLE a wind-driven rotor has turned to — the antiderivative of the gust, in closed form.
 *
 * A spinning ornament cannot use {@link sampleWind} directly: an angle is the integral of a
 * speed, and integrating per frame would be the one piece of state that breaks the "pure function
 * of time" rule the whole system rests on (a mobile culled behind the camera for ten seconds
 * would come back ten seconds behind everything else). Because the gust is a sum of sines, its
 * integral is a sum of cosines, so the angle can be evaluated directly at any *t*.
 *
 * The result is a rotor that never turns at a constant rate and never stops — it winds up in a
 * gust and coasts nearly to a stall in a lull, which is what the brief asks for and what a fixed
 * `rotation.y += speed` cannot do.
 */
export function windRotorAngle(x: number, z: number, turnsPerSecond: number): number {
  const s = (x * WIND_DX + z * WIND_DZ) * WIND_SPATIAL;
  const u = windClockSeconds - s;
  // d/dt of `u` is 1 (the spatial term is constant per object), so each sine integrates to
  // -cos/(2*pi*f) with no chain-rule factor to carry.
  let integral = GUST_BASE * u;
  for (let i = 0; i < 2; i++) {
    const w = TAU * GUST_HZ[i];
    integral -= (GUST_GAIN[i] / w) * Math.cos(w * u + GUST_PHASE[i]);
  }
  return integral * turnsPerSecond * TAU * windAmountMult;
}

/* ------------------------------------------------------- pieces that hang and swing */

/**
 * A piece of furniture that hangs from something and swings under its occupant.
 *
 * Stated as data (constants/outdoorAnimation.ts) rather than as code inside the two models that
 * currently need it, because the interesting property of the swing rework is that the hammock
 * got it for free: the same spec, the same solver, two different pivot heights.
 */
export interface SuspendedSpec {
  /**
   * Pivot to seat, world units. Sets the NATURAL PERIOD via the pendulum law, which is why a
   * long-roped swing and a short-slung hammock have different rhythms without either being
   * hand-timed. Nothing else in this file has a number that came from taste.
   */
  length: number;
  /** Where the pivot is, measured up from the piece's own base in the world units it is drawn at. */
  pivotY: number;
  /** Which of the piece's own local axes it rocks about. */
  axis: 'x' | 'z';
  /** The kick the moment weight lands on it, radians. */
  impulse: number;
  /** Seconds for that kick to die away. */
  impulseDecay: number;
  /** The amplitude a settled rider sustains, radians. */
  ride: number;
  /** Seconds from sitting down to reaching `ride` — the "slowly increase" half of the brief. */
  buildUp: number;
  /** Seconds for an empty piece to come back to rest after a rider leaves. */
  release: number;
  /** Amplitude with nobody on it: wind only, radians. Never zero — a hung thing is never still. */
  idle: number;
  /** A one-off vertical dip as weight lands, world units. A hammock's cloth sags; a swing does not. */
  sag: number;
  /**
   * How much of the piece's tilt the RIDER'S BODY carries, 0..1.
   *
   * 1 is rigid with the piece. A swing is near-rigid (you and the seat go over together); a
   * hammock is 0, because its rock is about the rope line, which for a body lying ALONG that
   * line is a roll rather than a pitch — and the controller only offers a pitch. The body still
   * translates with the cloth either way, which is the part that reads as "in the hammock".
   */
  bodyFollow: number;
}

/** Where a suspended piece is in its life, as two timestamps and the wind. */
export interface SuspendedPhase {
  /** Seconds since the current occupant got on, or null when nobody is on it. */
  since: number | null;
  /** How long the last occupant rode it, seconds. 0 if it has never been used. */
  rode: number;
  /** Seconds since the last occupant got off. `Infinity` if it has never been used. */
  free: number;
  /** The wind's sway at the piece, from {@link sampleWind}. */
  wind: number;
}

const GRAVITY = 9.81;

/**
 * How far the wind's own rhythm bends the pendulum's, in radians of phase.
 *
 * The whole point of the note "不要像鐘擺一樣完全固定速度". A real swing in a garden is not a
 * laboratory pendulum: the air pushes it about, so successive arcs are not quite the same length
 * and the beat wanders. This is that, as one term.
 */
const RHYTHM_WOBBLE = 0.14;
const RHYTHM_WOBBLE_HZ = 0.11;

/** The swing's own natural frequency, plus the wobble that stops it being a metronome. */
function pendulumPhase(spec: SuspendedSpec, elapsed: number): number {
  const omega = Math.sqrt(GRAVITY / Math.max(0.05, spec.length));
  return omega * elapsed + RHYTHM_WOBBLE * Math.sin(TAU * RHYTHM_WOBBLE_HZ * elapsed);
}

/** The amplitude a rider has worked up to, `elapsed` seconds after getting on. */
function ridingAmplitude(spec: SuspendedSpec, elapsed: number): number {
  return spec.impulse * Math.exp(-elapsed / spec.impulseDecay)
    + spec.ride * (1 - Math.exp(-elapsed / Math.max(0.05, spec.buildUp)));
}

/**
 * THE ANGLE, radians about {@link SuspendedSpec.axis}. Called by the model AND by the character
 * controller, with the same arguments, which is the entire synchronisation mechanism.
 *
 * Three regimes, and the seams between them are continuous by construction rather than by
 * blending — the released case simply keeps evaluating the same oscillator the ridden case
 * left off, with a decaying envelope over the top.
 */
export function suspendedAngle(spec: SuspendedSpec, p: SuspendedPhase): number {
  const windRest = spec.idle * p.wind;

  if (p.since != null) {
    // OCCUPIED. Starts at zero and grows: the impulse is the body landing, the build-up is the
    // rider working it up. Nothing is instant, which is the "從靜止開始，緩慢增加擺動幅度" note.
    const amp = ridingAmplitude(spec, p.since);
    return amp * Math.sin(pendulumPhase(spec, p.since)) + windRest * 0.35;
  }

  if (!Number.isFinite(p.free)) return windRest;

  // JUST RELEASED. The phase carries straight on through the moment they got off (hence
  // `rode + free`), so the piece does not jump; the envelope decays toward the wind idle it
  // would have had all along.
  const decay = Math.exp(-p.free / Math.max(0.05, spec.release));
  const amp = ridingAmplitude(spec, p.rode) * decay;
  return amp * Math.sin(pendulumPhase(spec, p.rode + p.free)) + windRest * (1 - decay * 0.65);
}

/**
 * The extra dip under a body's weight, world units (negative is down).
 *
 * Separate from the angle because it is a different physical thing: the cloth stretching, not the
 * whole piece swinging. It is over in about a second and a half and never comes back, which is
 * why it reads as "someone just got in" rather than as part of the idle.
 */
export function suspendedSag(spec: SuspendedSpec, p: SuspendedPhase): number {
  if (spec.sag === 0 || p.since == null) return 0;
  return -spec.sag * Math.exp(-p.since * 2.4) * Math.cos(p.since * 7.5);
}

/**
 * THE TWO TIMESTAMPS both halves of a swinging piece keep, and the only state in this file.
 *
 * Held by the MODEL (Three/outdoorAnimation.tsx's `useFurnitureOccupancy`, fed by events) and by
 * the CHARACTER CONTROLLER (Three/Avatar.tsx, which is where the events come from), so that both
 * can build the same {@link SuspendedPhase} for the same frame. The timestamps travel on the
 * event itself rather than being sampled independently at each end — two `performance.now()`
 * calls a few microseconds apart would be close enough to look right and wrong enough to drift
 * over a minute of sitting there.
 */
export interface SuspendedTimeline {
  /** `performance.now()` when the current occupant got on, or null when nobody is on it. */
  mountedAt: number | null;
  /** `performance.now()` when the last occupant got off, or null if it has never been used. */
  releasedAt: number | null;
  /** How long that last occupant rode it, seconds. */
  rode: number;
}

/** Turns the timeline plus the wind into the argument {@link suspendedAngle} wants. */
export function suspendedPhase(tl: SuspendedTimeline, now: number, wind: number): SuspendedPhase {
  return {
    since: tl.mountedAt == null ? null : Math.max(0, (now - tl.mountedAt) / 1000),
    rode: tl.rode,
    free: tl.releasedAt == null ? Infinity : Math.max(0, (now - tl.releasedAt) / 1000),
    wind,
  };
}

/* ------------------------------------------------------------------ per-instance variation */

/**
 * A stable 0..1 from a placement's instance id.
 *
 * Every planted thing needs its own small offsets — a different phase, a slightly different
 * rate, a slightly different reach — or a row of three palms reads as one palm drawn three times.
 * Seeding off the INSTANCE ID rather than `Math.random()` means the same tree wobbles the same
 * way across a reload, and means the drag-preview ghost of a tree matches the tree it becomes.
 */
export function seedFraction(seed: string | number | undefined, salt = 0): number {
  if (seed == null) return 0.5;
  let h = 0x811c9dc5 ^ (salt * 0x9e3779b9);
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** `seedFraction` mapped onto a range — the one-liner every caller was about to write. */
export function seedRange(seed: string | number | undefined, salt: number, lo: number, hi: number): number {
  return lo + seedFraction(seed, salt) * (hi - lo);
}
