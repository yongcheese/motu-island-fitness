/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WHAT EACH KIND OF OUTDOOR MOTION IS, as data — the catalog half of the outdoor animation
 * system, sibling of constants/interactionPostures.ts and constants/furnitureInteractions.ts.
 *
 * ## The rule this file exists to enforce
 *
 * 「不要為單一物件大量加入特殊例外判斷」. Before it, every moving outdoor object owned its own
 * numbers inside its own `useFrame`: the swing had `0.05 + boost * 0.5` and `1.1 + boost * 0.5`
 * written into Three/FurnitureItem.tsx, the telescope had a different pair, the campfire a third,
 * and the palm tree — which is the one the brief is actually about — had none at all because
 * there was nowhere to put them that was not a fourth copy.
 *
 * Three vocabularies, and adding a windmill, a flag, a bush or a garden bench means adding a ROW
 * here, not a `useFrame`:
 *
 *   {@link WIND_NODES}         how hard one part of a plant answers the wind. A trunk, a branch,
 *                              a frond, a leaf, a flag, a blade of grass.
 *   {@link SUSPENDED_MOTIONS}  a piece that hangs and swings under whoever is on it.
 *   {@link WIND_ROTORS}        a piece the wind turns.
 *
 * The maths they are fed to is in lib/outdoorMotion.ts; the loop that runs them is in
 * Three/outdoorAnimation.tsx. This file has no behaviour at all, which is the point — it is the
 * part a future object copies.
 */

import type { SuspendedSpec } from '../lib/outdoorMotion';

/* ------------------------------------------------------------------ wind: bending things */

/**
 * One node of a wind rig — a group somewhere inside a plant that bends when the wind blows.
 *
 * A plant is a CHAIN of these, not one of them. That distinction is the whole reason the palm
 * tree looks like a tree instead of a signpost: rotating a whole palm about its base by the same
 * angle is a rigid body turning, which the brief rules out in as many words
 * (「不要整棵樹像剛體一樣左右旋轉」). Four small bends stacked up the trunk with a bigger one at
 * each frond is a bend — and it costs the same, because they are all evaluated in one pass.
 */
export interface WindNodeSpec {
  /** Peak bend at full wind, radians. */
  bend: number;
  /** Bend on the perpendicular axis, as a fraction of `bend`. Turns a wiper into a leaf. */
  cross?: number;
  /**
   * How far this node reads the wind field IN THE PAST, seconds.
   *
   * The follow-through, and the cheapest possible version of it: a frond that samples the same
   * gust 0.25 s after the trunk did is a frond trailing the trunk, with no spring to tune and no
   * state to keep. Give the nodes further out along a plant progressively larger values.
   */
  lag?: number;
  /** Which axis of the node's own frame the bend turns about. Defaults to `z`. */
  axis?: 'x' | 'z';
}

/**
 * The presets. A new plant picks the row that describes each of its parts and spreads it —
 * `{ ...WIND_NODES.frond, lag: 0.3 }` — rather than inventing a number.
 *
 * The ordering is the point: each row bends more, and later, than the one above it. That gradient
 * IS the animation. A plant whose every part uses one row is a plant that will read as cardboard
 * however carefully the amplitude is chosen.
 */
export const WIND_NODES = {
  /** A trunk section. Barely moves: several of these stacked is what makes the bend. */
  trunk: { bend: 0.016, cross: 0.35, lag: 0 },
  /** A bough or a stem. */
  branch: { bend: 0.045, cross: 0.5, lag: 0.10 },
  /** A palm frond, a big compound leaf. Noticeably more than the trunk, per the brief. */
  frond: { bend: 0.105, cross: 0.55, lag: 0.22 },
  /** A single light leaf, a flower head. */
  leaf: { bend: 0.15, cross: 0.7, lag: 0.28 },
  /** Cloth: a flag, a banner, an awning. Mostly one axis, and well behind the pole. */
  cloth: { bend: 0.22, cross: 0.2, lag: 0.34 },
  /** Ground cover — grass tufts, small shrubs. */
  grass: { bend: 0.13, cross: 0.6, lag: 0.16 },
  /** A hanging ornament: a chime, a lantern, a mobile's arm. */
  hanging: { bend: 0.085, cross: 0.8, lag: 0.20 },
} as const satisfies Record<string, WindNodeSpec>;

/* ------------------------------------------------------------------ wind: turning things */

/** A part the wind spins rather than bends. */
export interface WindRotorSpec {
  /**
   * Turns per second at mean wind. The actual rate is the gust envelope integrated against this
   * (lib/outdoorMotion.ts's `windRotorAngle`), so the thing winds up and coasts instead of
   * spinning at a constant rate — 「避免固定速度＋無限機械式旋轉」.
   */
  turnsPerSecond: number;
  /** Which way round it turns. A pair of counter-rotating tiers reads better than two the same. */
  direction?: 1 | -1;
}

export const WIND_ROTORS = {
  /** The 風動雕塑's arms: a slow drift, roughly one turn every twenty seconds at mean wind. */
  mobile: { turnsPerSecond: 0.05 },
  /** Its upper tier, turning the other way. */
  mobileUpper: { turnsPerSecond: 0.068, direction: -1 },
  /** A weathervane or windmill, should one ever be added: visible but unhurried. */
  vane: { turnsPerSecond: 0.16 },
} as const satisfies Record<string, WindRotorSpec>;

/* ------------------------------------------------------------------ things that hang and swing */

/**
 * Pieces the player gets ON that then move under them.
 *
 * A row here is referenced from constants/items.ts (`interactions[].sway`), which is what makes
 * the model, the character controller and the interaction prompt all agree without any of them
 * knowing what a hammock is. See lib/outdoorMotion.ts's `suspendedAngle` for the solver, and note
 * that both `pivotY` and `length` are in the WORLD units the piece is drawn at — the same
 * convention `surfaceY` in the catalog already uses, so all three can be checked against the same
 * measured box by `npm run audit:interactions`.
 */
export type SuspendedMotionId = 'hammock' | 'swing' | 'hangingChair' | 'rockingChair';

export const SUSPENDED_MOTIONS: Record<SuspendedMotionId, SuspendedSpec> = {
  /**
   * 吊床. Slung between two posts whose tops are 1.686 above its base, cloth 0.69 up — so just
   * under a metre of rope, which the pendulum law turns into a two-second rock. Nothing about
   * that rhythm was chosen; it is what a hammock that size does.
   *
   * `impulse` is three times `ride` on purpose. Getting into a hammock is mostly ONE event — the
   * cloth takes your weight and swings once — and what follows is nearly nothing. A hammock that
   * kept rocking at its entry amplitude would read as a fairground ride.
   */
  hammock: {
    length: 1.00,
    pivotY: 1.686,
    axis: 'x',
    impulse: 0.16,
    impulseDecay: 2.2,
    ride: 0.05,
    buildUp: 1.5,
    release: 6.0,
    idle: 0.022,
    sag: 0.035,
    // Zero, and NOT an oversight: a hammock rocks about the line its ropes run along, and its
    // occupant lies along that same line, so the rock is a ROLL of the body. The controller
    // offers a pitch (Avatar.tsx's applyLyingOrientation), so the body takes the translation and
    // leaves the tilt — which is right anyway, since what a person in a hammock does is stay put
    // and let the cloth carry them.
    bodyFollow: 0,
  },

  /**
   * 木製鞦韆. A long rope and a rider who works it up: the arc grows over about five seconds and
   * settles at 24 degrees, which swings the seat about 0.8 either side of centre.
   *
   * `pivotY` and `length` are the model's beam and seat (Three/FurnitureItem.tsx's SWING_BEAM_Y =
   * 2.0 and SWING_SEAT_Y = 0.4938, drawn at 1.3175): the beam was raised from 2.174 so that the
   * seated rider's head clears it — see SWING_BEAM_Y. The longer rope is also a slightly slower
   * swing (2.8 s rather than 2.5 s a cycle), which is the pendulum law, not a choice.
   *
   * `buildUp` is the number the brief is most specific about — 「從靜止開始，緩慢增加擺動幅度」
   * — and it is why the impulse here is SMALL. Sitting on a swing does not start it moving; the
   * rider does, and that takes a few arcs.
   */
  swing: {
    length: 1.98,
    pivotY: 2.635,
    axis: 'x',
    impulse: 0.06,
    impulseDecay: 2.0,
    ride: 0.42,
    buildUp: 5.5,
    release: 5.0,
    idle: 0.04,
    sag: 0,
    // Near-rigid: a swing and the person on it go over the top together. Not exactly 1, because
    // a rider leans slightly against the arc rather than being bolted to the seat.
    bodyFollow: 0.85,
  },

  /**
   * 吊椅. Nowhere near as hard a push as the swing: nobody pumps a hanging chair the way they pump
   * a swing, so `buildUp`/`ride` are a fraction of `swing`'s and it settles into a gentle
   * wind-driven rock rather than a rider-driven arc.
   *
   * `pivotY` is the model's hook (Three/FurnitureItem.tsx's HANGING_CHAIR_PIVOT_Y = 1.86, drawn at
   * 1.3175) and `length` the drop from it to the cushion (0.62). Both grew when the chair was
   * re-proportioned around the character sitting in it — see HANGING_CHAIR_PIVOT_Y — so it now
   * rocks at the pendulum rate of a 1.8-unit drop rather than 0.85.
   */
  hangingChair: {
    length: 1.83,
    pivotY: 2.4506,
    axis: 'x',
    impulse: 0.10,
    impulseDecay: 2.4,
    ride: 0.10,
    buildUp: 2.2,
    release: 4.0,
    idle: 0.03,
    sag: 0.02,
    bodyFollow: 0.55,
  },

  /**
   * 原木搖椅 —— an INVERTED pendulum's twin, and the row that proves this table was the right
   * shape rather than three special cases.
   *
   * A rocking chair does not hang from anything, so at first glance it does not belong here at
   * all. But a chair on curved runners rotates about the runners' CENTRE OF CURVATURE, and that
   * centre is above the chair — so the geometry is a pendulum's, with a pivot nobody can see.
   * The whole of the swing machinery then applies unchanged: the model turns about that point,
   * the character controller carries the rider along the same arc from the same function, and
   * the exit eases off it.
   *
   * `pivotY` is not a taste call either. The runner rises 0.055 model units over its 0.42 half
   * length, and a circular arc through those two numbers has R = (c² + s²) / 2s = 1.63 — so the
   * centre sits 1.65 above the chair's base (Three/FurnitureItem.tsx's ROCKING_CHAIR_PIVOT_Y), and
   * the chair is indoor furniture, drawn at 1.15: 1.8975 as drawn. It used to say 1.40, which is
   * 1.65 at the ISLAND's 0.85 — so the chair rocked about one point and the controller carried its
   * occupant about another half a metre below it, and at the end of every rock the sitter's legs
   * were 3 cm inside the seat (`npm run audit:interactions` now checks the model's swinging group
   * against this row). The 1.35 from there down to the cushion is a 2.3-second rock, straight out
   * of the pendulum law.
   *
   * `idle` is the smallest in the table because this is the only INDOOR row: there is no wind in
   * a bedroom, and a chair that rocked by itself in a closed room would be a ghost story.
   */
  rockingChair: {
    length: 1.3455,
    pivotY: 1.8975,
    axis: 'x',
    // Sitting down in a rocking chair genuinely does start it — you drop your weight onto a
    // curved runner — so unlike the swing the impulse here is most of the motion, and the
    // build-up merely sustains it.
    impulse: 0.09,
    impulseDecay: 3.2,
    ride: 0.085,
    buildUp: 2.5,
    release: 7.5,
    idle: 0.004,
    sag: 0.004,
    // Near-rigid: the chair and the person in it go back and forth as one thing.
    bodyFollow: 0.92,
  },
};
