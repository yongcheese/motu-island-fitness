/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WHAT THE OBJECT DOES WHEN YOU USE IT — the third table in the interaction vocabulary, and the
 * one that was missing.
 *
 * ## The gap this file closes
 *
 * The interaction system already answered two of the three questions an interaction asks:
 *
 *   constants/furnitureInteractions.ts   THE VERB   — what the prompt offers, where the body goes
 *   constants/interactionPostures.ts     THE BODY   — what the player's skeleton does
 *   THIS FILE                            THE OBJECT — what the piece itself does about it
 *
 * Without the third, 「按 E」 meant 「玩家演一段動畫，東西完全不動」 for 38 of the game's 43
 * interactive pieces. You could open a wardrobe and its doors stayed shut; you could cook on a
 * hob whose burners were painted permanently cyan; you could wash your hands under a tap that
 * never ran. Five pieces DID react — 營火, 望遠鏡, 鳥屋, 許願井, 野餐籃 — and every one of them
 * did it the same way: a `useFrame` inside its own model with its own copy of
 * 「read the clock, subtract the trigger time, lerp a boost」 and its own magic numbers.
 *
 * That is the shape this file refuses. The rule is the same one constants/outdoorAnimation.ts
 * already enforces for the wind: 「不要為單一物件大量加入特殊例外判斷」. A piece that opens, tips,
 * slides, spins or lights up says so HERE, in data, and the runtime (Three/objectAnimation.tsx)
 * drives it. Adding a reaction to the next piece of furniture is a row in
 * {@link OBJECT_ANIMATIONS} plus a `ref` in its JSX — never a new animation loop, and never an
 * `if (item.name === '衣櫃')`.
 *
 * ## What is here and what is NOT
 *
 * HERE: the object's own behaviour over time — which named parts move, how far, on what signal,
 * how the state comes and goes, and WHEN in the player's animation it starts.
 *
 * NOT HERE: where the parts ARE. A hinge's pivot is a fact about the model's geometry, so it
 * lives in the model's JSX as a `<group position={…}>`, exactly where a reader can see it against
 * the mesh it turns. This table says 「the left door turns 76 degrees about its own Y」 and is
 * silent about where that Y is — which is why moving a door in the model cannot put this file out
 * of date. It is the same split that keeps `surfaceY` (a measurable fact about the furniture) in
 * the catalog and the seat POSE in the posture table.
 *
 * Also not here: sway. A piece that hangs and swings under its rider is already
 * constants/outdoorAnimation.ts's `SUSPENDED_MOTIONS`, referenced from the item's own
 * `interactions[].sway`, and a second way to say the same thing would be a second thing to keep
 * in step.
 */

import type { FurnitureModelId } from './furnitureModels';

/* ------------------------------------------------------------------ the signals */

/**
 * WHAT DRIVES A PART, as one scalar.
 *
 * Every animation in this system is a pure function of `(time, state)` — no integration, no
 * springs, no per-object timers — for the same reason the outdoor wind system is: an object that
 * is culled (Three/outdoorAnimation.tsx skips it beyond 70 units, or off-screen) is not PAUSED,
 * it is simply not asked, and it must be at exactly the right pose on the frame it comes back.
 * A part driven by an integrator would drift; a part driven by these cannot.
 *
 *   `open`    The eased 0..1 state signal — closed→open, off→on, empty→occupied. The workhorse:
 *             a door, a drawer, a lid, a compressing cushion, a rising water level.
 *   `spin`    Continuous rotation from the shared clock, its RATE scaled by `open`. A microwave
 *             turntable, a flushing bowl. Reads the clock rather than accumulating, so it is
 *             cullable.
 *   `wobble`  A sine of ±1 over `period`, scaled by `open`. A tent breathing, a chair swivelling
 *             back and forth, a tuning needle drifting.
 *   `pulse`   A one-shot 0→1→0 half-sine over the part's own `over` seconds, measured from the
 *             trigger and dead afterwards. A button being pressed, a door that opens and shuts
 *             again inside a longer cycle, a thrown frisbee's flight.
 */
export type ObjectSignal = 'open' | 'spin' | 'wobble' | 'pulse';

/** How a part answers its signal. */
export type ObjectMotion =
  /** Rotate about `axis`, radians. Doors, lids, levers, knobs. */
  | 'hinge'
  /** Translate along `axis`, model units. Drawers, buttons, water level, a thrown ball. */
  | 'slide'
  /**
   * Scale along `axis`, as a delta from 1. Cushions compressing (negative), a jet surging.
   *
   * MODELLING CONVENTION, and the one thing this motion asks of the JSX: scale is about the
   * part's own ORIGIN, so a cushion whose group origin sits at its BOTTOM face compresses
   * downward (right), and one whose origin is at its centre compresses from both ends at once
   * and floats (wrong). Put the group at the bottom of whatever squashes.
   */
  | 'scale';

export interface ObjectPartSpec {
  motion: ObjectMotion;
  axis: 'x' | 'y' | 'z';
  /** Value at signal = 1: radians for `hinge`, model units for `slide`, scale delta for `scale`. */
  travel: number;
  /** Default `open`. */
  signal?: ObjectSignal;
  /**
   * The slice of the `open` signal this part is driven across, so parts can be staggered without
   * any of them owning a timer. `[0, 0.55]` finishes in the first half of the opening and then
   * holds; `[0.4, 1]` does not begin until the signal is 40% of the way there.
   *
   * This is how a fridge's freezer door leads its main door, and a drawer follows the one beside
   * it, using ONE state signal shared by the whole piece.
   */
  range?: readonly [number, number];
  /** `spin`: seconds per full turn. `wobble`: seconds per full cycle. */
  period?: number;
  /** `pulse`: seconds from the trigger over which the one-shot plays. Default 0.8. */
  over?: number;
}

/* ------------------------------------------------------------------ the behaviours */

/**
 * HOW THE OBJECT'S STATE ANSWERS AN INTERACTION — the 「Object State Persistence」 half of the
 * brief, and deliberately five different answers rather than one rule for everything.
 *
 * The question each row answers is 「what is this thing still doing after the player walks
 * away?」, and the honest answer depends on what the thing is FOR:
 *
 *   `momentary`  Opens, holds for `hold` seconds, closes itself. For a piece you open to look
 *                inside and would not leave open: a fridge, an oven, a picnic basket, a drawer.
 *                Nobody has to remember to shut it, and nothing can be left half-open.
 *   `latch`      Opens and STAYS open until the next interaction closes it. For a piece whose
 *                open state is a thing you want to look at, and whose being open is not a
 *                problem: a wardrobe. The prompt is unchanged either way, so the second press
 *                reads as 「shut it again」.
 *   `toggle`     Flips a persistent on/off that outlives the interaction. Exactly two pieces earn
 *                it — a hob and a radio — because they are the two whose whole point is to be
 *                left running. See lib/objectRuntimeState.ts for how far that persists and why
 *                it deliberately stops short of the save file.
 *   `run`        Switches on and switches ITSELF off after `hold` seconds. A microwave cycle, a
 *                flush, a tap you wash your hands under. The difference from `momentary` is only
 *                intent — `run` is a machine finishing a job, `momentary` is a door — but keeping
 *                them separate is what stops a tap being described as a door that leaks.
 *   `occupied`   Driven by the player being ON the piece rather than by a press: 1 while they sit
 *                or lie there, 0 when they get up. Cushions, mattresses, canvas, bath water.
 *                Cannot be left stuck on, because the thing that clears it is the same event that
 *                stands the player up.
 */
export type ObjectBehaviour = 'momentary' | 'latch' | 'toggle' | 'run' | 'occupied';

/* ------------------------------------------------------------------ which way it goes */

/**
 * WHERE A THROWN OR PUSHED PIECE ACTUALLY GOES — the answer that used to be a constant, and the
 * reason a frisbee flew the same way whichever side of it you stood on.
 *
 * ## What was wrong
 *
 * A `slide` moves a part along one of ITS OWN axes. For the two throwables that meant `axis: 'z'`
 * — the model's local +Z — so the flight was welded to the placement's rotation: a disc dropped
 * facing north flew north whether the player walked up from the south, the east or the north,
 * and the only way to change that was to go into 建造模式 and turn the disc round. Nothing about
 * the throw consulted the person throwing it. The same would have been true of the next ball,
 * the next disc and anything else that leaves the ground, because a fixed axis was the only
 * vocabulary the table had.
 *
 * ## What replaces it
 *
 * A piece names ONE group that carries the whole flight and says, in data, how that group's
 * heading is worked out from the player at the moment of the throw. Nothing about the flight
 * itself changes — the parts still slide along their own local axes, still on a pulse, still a
 * pure function of the clock — they are simply turned first. So `flyForward` goes on meaning
 * 「forward」 and the model goes on being readable; what「forward」 IS becomes a runtime answer.
 *
 * The heading is a weighted blend of the only two directions that are meaningful without
 * inventing state, both of them stated by the brief:
 *
 *   FACING   the way the player's body is pointing. 「玩家踢球時，球的初始方向可以優先參考玩家
 *            Facing Direction」 — what a kick and a throw follow.
 *   AWAY     the line from the player to the piece. 「玩家從左側靠近 → 球往右；從前方靠近 →
 *            球往後」 — what a shove follows, and what makes the approach side matter.
 *
 * For a piece the player walks up to and squares up against — every one in the catalog today,
 * because an acting interaction resolves a stand spot facing the piece — the two very nearly
 * COINCIDE, and that is the correct behaviour rather than a redundancy: the ball goes away from
 * the player, which is the same direction the player is looking. They separate for a piece that
 * does not square the player up, and the weight is what decides the answer then. Stating both is
 * what keeps the rule 「direction comes from the player」 rather than 「direction comes from the
 * one thing that happened to work for a frisbee」.
 */
export interface ObjectLaunchSpec {
  /**
   * The `ref` name of the group that is TURNED — it must wrap every part of the flight, and must
   * not itself be a row in {@link ObjectAnimationSpec.parts}.
   *
   * Two groups rather than one because a node's `position` is expressed in its PARENT's frame:
   * yawing the same group that slides would turn the part on the spot and leave it travelling
   * along the old heading. `npm run audit:object-animations` checks both halves — that the model
   * refs this name, and that nothing else claims it.
   */
  part: string;
  /**
   * How much of the heading comes from the player's FACING rather than from the line
   * player → piece, 0..1. 1 is a kick that follows the boot; 0 is a shove that follows the
   * approach; in between is a throw.
   */
  fromFacing: number;
  /**
   * Random fan either side of the resolved heading, radians. 0 for a piece that must go exactly
   * where it is aimed.
   *
   * Rolled ONCE, when the throw is armed, and stored with the timeline — so the flight is still
   * a pure function of the clock and a culled disc still comes back at exactly the right place.
   * It is here because two throws from the same spot landing on the same pixel is its own kind of
   * hard-coded direction.
   */
  spread?: number;
}

/**
 * Which cue the piece plays when its state changes. Mapped to synths in lib/soundUtils.ts.
 *
 * `cushion` is the soft half of 「坐下去有感覺」: a padded seat or a mattress has no wood to creak,
 * so before it existed every sofa and bed in the game took a body in total silence while the
 * cushion visibly gave. It is the one cue here that plays on BOTH edges at different weights —
 * settling in is heard, getting up is barely heard — which the runtime reads off `on`.
 *
 * The last four belong to the outdoor pieces that used to keep their own animation loop
 * (營火, 望遠鏡, 鳥屋, 許願井). They were already audible; moving them onto this table is what makes
 * the sound land on the state edge rather than on the key press, like every other piece.
 */
export type ObjectSoundId =
  | 'door' | 'drawer' | 'ignite' | 'extinguish' | 'water' | 'appliance' | 'chime' | 'creak'
  | 'cushion' | 'crackle' | 'twinkle' | 'chirp' | 'splash';

export interface ObjectAnimationSpec {
  behaviour: ObjectBehaviour;
  /**
   * WHEN, INSIDE THE PLAYER'S OWN ANIMATION, the object starts to answer — as a fraction of the
   * posture's duration, not as seconds.
   *
   * This is the whole of 「Player Animation 與 Object Animation 同步」, and it is a fraction on
   * purpose. The player's posture already states its own length (constants/interactionPostures.ts
   * — `open` runs 1.2 s, `cook` 2.4 s, `operate` 1.1 s), so a cue of 0.28 means 「when the hand
   * gets to the handle」 in every posture at once, and it goes on meaning that if a posture is
   * later retimed. Written as seconds it would mean 「0.34 s in」, which is the same thing today
   * and quietly the wrong thing after the next edit.
   *
   * Default {@link DEFAULT_OBJECT_CUE} — an acting posture reaches its target early and holds, so
   * a quarter of the way in is the contact. Ignored by `occupied`, which has no press to be late
   * for: it starts as the weight begins to land and eases over the mount, which the controller is
   * already doing.
   */
  cue?: number;
  /** Seconds for the state signal to travel 0 → 1. Default {@link DEFAULT_OPEN_TIME}. */
  openTime?: number;
  /** Seconds for 1 → 0. Default {@link DEFAULT_CLOSE_TIME} — things shut more gently than they open. */
  closeTime?: number;
  /** `momentary` / `run`: seconds held at 1 before it returns on its own. */
  hold?: number;
  /** The named parts this piece moves. The keys are the `ref` names its model uses. */
  parts?: Readonly<Record<string, ObjectPartSpec>>;
  /**
   * The piece MOVES OFF, and the direction is the player's rather than the model's. See
   * {@link ObjectLaunchSpec} — this is what makes a frisbee fly the way it was thrown instead of
   * the way it was put down.
   */
  launch?: ObjectLaunchSpec;
  /**
   * Cues at the two state edges. Played by the runtime rather than by the model, so a piece that
   * only lights up (a hob) is as audible as one that swings (a door) without either learning how
   * the audio layer works.
   */
  sound?: { readonly on?: ObjectSoundId; readonly off?: ObjectSoundId };
}

/* ------------------------------------------------------------------ the table */

const DOOR = { on: 'door', off: 'door' } as const;
/** A padded seat or a mattress — heard settling in, barely heard getting up. See ObjectSoundId. */
const CUSHION = { on: 'cushion', off: 'cushion' } as const;

/**
 * EVERY PIECE THAT REACTS, keyed by model id.
 *
 * Model id rather than item id, because the reaction is a property of the DRAWN OBJECT: two
 * products sharing a model (see `SHARED_FURNITURE_MODELS` in constants/furnitureModels.ts) have
 * the same doors and must open them the same way, and an item re-skinned onto a different model
 * should get that model's behaviour rather than carrying the old one along.
 *
 * A piece absent from this table is not broken — it simply has no object-side reaction, which is
 * the right answer for a picnic table. `npm run audit:object-animations` lists every interactive
 * item that is missing one, so the set stays a decision rather than an oversight.
 */
export const OBJECT_ANIMATIONS: Partial<Record<FurnitureModelId, ObjectAnimationSpec>> = {

  /* ======================================================= 開闔類：門、抽屜、蓋子 */

  /**
   * 實木大衣櫃 —— the piece the brief leads with, and the four things it asks for.
   *
   *   correct pivot   Each leaf turns about its OWN hinge stile, which is a `<group>` at the
   *                   door's outer edge in the model. The carcass is not inside that group, so
   *                   「不應整個衣櫃一起旋轉」 is structural rather than a promise.
   *   sane angle      76 degrees. A wardrobe door opened flat to 90 is at the exact angle where
   *                   its edge-on leaf disappears; short of that it still reads as a leaf.
   *   stays open      `latch` — you are rummaging. Pressing E again shuts it.
   *   not instant     0.85 s out, 1.0 s back, eased both ways.
   *
   * The two leaves are given different ranges so they do not move as one slab: the right one is a
   * beat behind, which is what two hands opening a wardrobe actually looks like.
   */
  wardrobe: {
    behaviour: 'latch',
    cue: 0.30,
    openTime: 0.85,
    closeTime: 1.0,
    sound: DOOR,
    parts: {
      // Negative Y swings a leaf hinged on the piece's -X side out toward its front (+Z): under
      // three.js's rotation about +Y, a point at +x of the pivot moves to -z as the angle rises.
      doorLeft: { motion: 'hinge', axis: 'y', travel: -1.33 },
      doorRight: { motion: 'hinge', axis: 'y', travel: 1.33, range: [0.12, 1] },
    },
  },

  /** 雙開門冰箱 —— both leaves hinged on the same side, freezer first, and it shuts itself. */
  fridge: {
    behaviour: 'momentary',
    cue: 0.30,
    openTime: 0.6,
    closeTime: 0.8,
    hold: 2.4,
    sound: DOOR,
    parts: {
      doorFreezer: { motion: 'hinge', axis: 'y', travel: -1.15, range: [0, 0.62] },
      doorFridge: { motion: 'hinge', axis: 'y', travel: -1.30, range: [0.1, 1] },
    },
  },

  /**
   * 烤箱 —— a drop-front door, so the hinge is at the BOTTOM of the leaf and the axis is X.
   * Positive X tips its top edge forward and down, which is the one direction an oven door goes.
   */
  oven: {
    behaviour: 'momentary',
    cue: 0.32,
    openTime: 0.55,
    closeTime: 0.7,
    hold: 2.6,
    sound: DOOR,
    parts: {
      doorUpper: { motion: 'hinge', axis: 'x', travel: 1.34 },
    },
  },

  /**
   * 微波爐 —— the piece that shows why `pulse` exists.
   *
   * A heating cycle is not 「open the door」: the door opens, something goes in, the door SHUTS,
   * and then the machine runs for four seconds with the plate turning behind the glass. The door
   * therefore rides a one-shot over its own 1.3 s while the cycle's `open` signal stays up for
   * the whole run — two different clocks on one piece, which a single 「how open is it」 scalar
   * could not express.
   */
  microwave: {
    behaviour: 'run',
    cue: 0.28,
    openTime: 0.25,
    closeTime: 0.4,
    hold: 4.2,
    sound: { on: 'door', off: 'chime' },
    parts: {
      door: { motion: 'hinge', axis: 'y', travel: -1.15, signal: 'pulse', over: 1.3 },
      // The turntable. 8 s a turn is a real microwave's rate, and slow enough that a strided
      // update at distance is invisible.
      plate: { motion: 'hinge', axis: 'y', travel: 1, signal: 'spin', period: 8 },
    },
  },

  /** 野餐籃 —— was hand-animated in its own useFrame; the same lid, now on the shared runtime. */
  'picnic-basket': {
    behaviour: 'momentary',
    cue: 0.30,
    openTime: 0.35,
    closeTime: 0.6,
    hold: 1.6,
    parts: {
      // Measured from the half-lifted pose the model rests in, not from shut: opening lays the
      // lid right back rather than starting it from a position the basket has never been in.
      lid: { motion: 'hinge', axis: 'x', travel: -0.55 },
    },
  },

  /** 梳妝台 —— 抽屜拉出／推回, the two of them a beat apart. */
  'vanity-table': {
    behaviour: 'momentary',
    cue: 0.26,
    openTime: 0.45,
    closeTime: 0.6,
    hold: 2.0,
    sound: { on: 'drawer', off: 'drawer' },
    parts: {
      drawerLeft: { motion: 'slide', axis: 'z', travel: 0.19 },
      drawerRight: { motion: 'slide', axis: 'z', travel: 0.13, range: [0.25, 1] },
    },
  },

  /** 海風書架 —— a book eased off the shelf, tipped open, and put back. */
  'bookshelf-seabreeze': {
    behaviour: 'momentary',
    cue: 0.22,
    openTime: 0.5,
    closeTime: 0.7,
    hold: 1.8,
    parts: {
      // Halfway out and tipped, not lifted clear: a book that travels its own depth reads as
      // floating in front of the shelf rather than as being taken off it.
      book: { motion: 'slide', axis: 'z', travel: 0.22 },
      bookTilt: { motion: 'hinge', axis: 'x', travel: -0.20, range: [0.45, 1] },
    },
  },

  /** 橡木書桌 —— the cover of the top book on the pile lifts, and the pages riffle under it. */
  'desk-oak': {
    behaviour: 'momentary',
    cue: 0.20,
    openTime: 0.5,
    closeTime: 0.6,
    hold: 2.0,
    parts: {
      // Positive about Z lifts the +X side of a cover hinged on its -X spine, i.e. it opens
      // upward and over. 2.1 rad lays it flat open just past vertical.
      bookCover: { motion: 'hinge', axis: 'z', travel: 2.1 },
      page: { motion: 'hinge', axis: 'z', travel: 0.55, signal: 'wobble', period: 1.1 },
    },
  },

  /** 松木工作桌 —— the notebook opens and the bench vise's jaw eases out. */
  'desk-work-pine': {
    behaviour: 'momentary',
    cue: 0.20,
    openTime: 0.5,
    closeTime: 0.65,
    hold: 2.0,
    parts: {
      bookCover: { motion: 'hinge', axis: 'z', travel: 2.0 },
      // The vise's screw runs along the bench's Z, which is the axis its jaw opens on.
      viseJaw: { motion: 'slide', axis: 'z', travel: 0.06, range: [0.3, 1] },
    },
  },

  /* ======================================================= 狀態類：開火、通電、出水 */

  /**
   * 嵌入式瓦斯爐 —— the second piece the brief leads with.
   *
   * `toggle`, because a hob is the archetype of a thing you leave on: pressing E lights it,
   * pressing E again puts it out, and walking away does neither. It is one of exactly two pieces
   * in this table with persistent state.
   *
   * The flames themselves are NOT parts — no transform describes a flame. They are the model's
   * own `<BurnerFlames>` (Three/objectAnimation.tsx), mounted only while the hob is on, at the
   * burner positions the model already draws, so 「火焰應從瓦斯爐的 Burner 正確產生」 is a
   * consequence of where the meshes are rather than of a hand-placed offset. §11's 「沒有開啟時
   * 不需要持續更新火焰」 falls out of the same thing: an unlit hob renders no flame meshes at all
   * and registers no animation entry.
   *
   * `cue: 0.18` is the ignition. The `cook` posture runs 2.4 s and its shape is 「reach in, then
   * stir for two seconds」; lighting at 18% puts the flame up as the hand finishes reaching and
   * before the stirring starts, which is the brief's 「玩家做出啟動動作 → 瓦斯爐產生火焰」
   * without leaving the player stirring a cold pan for the other two seconds.
   */
  stove: {
    behaviour: 'toggle',
    cue: 0.18,
    openTime: 0.4,
    closeTime: 0.5,
    sound: { on: 'ignite', off: 'extinguish' },
    parts: {
      // The control knobs turn a quarter with the flame.
      knobLeft: { motion: 'hinge', axis: 'z', travel: -1.4 },
      knobRight: { motion: 'hinge', axis: 'z', travel: -1.2, range: [0.2, 1] },
    },
  },

  /**
   * 復古收音機 —— the other persistent one. A radio you switch on stays on; that is what a radio
   * is. The tuning needle drifts across the dial while it plays, and the cabinet's sound waves
   * (drawn by the model) come and go with `open`.
   */
  'radio-retro': {
    behaviour: 'toggle',
    cue: 0.30,
    openTime: 0.35,
    closeTime: 0.45,
    sound: { on: 'appliance', off: 'appliance' },
    parts: {
      knob: { motion: 'hinge', axis: 'z', travel: -2.4 },
      // Never quite still: a tuned-in valve radio wanders.
      needle: { motion: 'slide', axis: 'x', travel: 0.035, signal: 'wobble', period: 7 },
    },
  },

  /**
   * 大理石洗手台 —— 水龍頭開啟 → 水流出現 → 關閉後水流停止.
   *
   * `run` rather than `toggle`, and that is a decision the brief asks for by name
   * (「水龍頭是否保持開啟?」). A tap left running for the rest of the session is both a worse
   * picture and a worse citizen — an animation and a particle system that never stop, which §11
   * rules out. The cycle is 2.8 s: long enough to cover the whole 1.9 s `wash` posture and a
   * moment either side, so the water is already running when the hands go under it and is still
   * running when they come out.
   */
  washbasin: {
    behaviour: 'run',
    cue: 0.15,
    openTime: 0.3,
    closeTime: 0.45,
    hold: 2.8,
    sound: { on: 'water' },
    parts: {
      tapLever: { motion: 'hinge', axis: 'x', travel: -0.7 },
    },
  },

  /** 科技馬桶 —— the flush: the button goes down, the bowl swirls, and it stops. */
  toilet: {
    behaviour: 'run',
    cue: 0.30,
    openTime: 0.2,
    closeTime: 0.5,
    hold: 2.4,
    sound: { on: 'water' },
    parts: {
      flushButton: { motion: 'slide', axis: 'y', travel: -0.028, signal: 'pulse', over: 0.5 },
      // The swirl itself is NOT a part. It is `<WaterSwirl>`, which turns its own two arcs and is
      // mounted only while the flush is running — a declared `spin` part here would have been a
      // second, dead statement of the same thing, and is exactly what
      // `npm run audit:object-animations` caught when it was.
    },
  },

  /**
   * 噴泉 —— the one piece whose interaction is NEW rather than newly animated.
   *
   * It already ran water all day (the jets and ripples in Three/outdoorAnimation.tsx) and had
   * nothing to press. Giving it a 「玩水」 verb costs one row in constants/items.ts and turns an
   * always-on background into something that answers: the jet column surges for three seconds and
   * eases back down.
   */
  fountain: {
    behaviour: 'run',
    cue: 0.20,
    openTime: 0.5,
    closeTime: 1.6,
    hold: 3.0,
    sound: { on: 'water' },
    parts: {
      // The jet column stretches with the surge. Its group sits at the nozzle mouth, so it grows
      // upward and stays anchored — see the `scale` note in ObjectMotion.
      // A third taller, not half again: the jet is scaled only in Y, so a big number stretches
      // the cone into a needle rather than reading as more water.
      jet: { motion: 'scale', axis: 'y', travel: 0.34 },
    },
  },

  /* ======================================================= 拋擲類 */

  /**
   * 飛盤 —— the disc leaves, flies, and comes back, on ONE pulse.
   *
   * Three parts on the same clock with different shapes is the whole flight: it rises early,
   * travels through the middle, and spins for all of it. Nothing integrates, so a frisbee thrown
   * behind the camera is at rest again by the time you turn round — which is the correct answer
   * rather than a bug, and is the property that makes the whole system cullable.
   *
   * `cue: 0.55` because `toss` is a `pulse` posture 0.9 s long: the arm is at full extension
   * halfway through, so the disc leaves the hand just after that rather than before it.
   *
   * `launch` is the direction. `fromFacing: 1` because a disc goes where the arm sends it and
   * the arm goes where the body is pointing — 「飛盤：主要參考 Player Facing Direction + Target
   * Direction」, and for a piece the player has squared up against those are the same line. The
   * spread is small: a frisbee is thrown AT something.
   */
  frisbee: {
    behaviour: 'run',
    cue: 0.55,
    openTime: 0.12,
    closeTime: 0.2,
    hold: 1.5,
    launch: { part: 'flyAim', fromFacing: 1, spread: 0.10 },
    parts: {
      // `axis: 'z'` is still the model's own forward — what changed is that the group ABOVE it
      // (`flyAim`) is turned to the throw's heading first, so this is 「forward」 rather than
      // 「north」. See ObjectLaunchSpec.
      flyForward: { motion: 'slide', axis: 'z', travel: 2.6, signal: 'pulse', over: 1.7 },
      flyRise: { motion: 'slide', axis: 'y', travel: 0.75, signal: 'pulse', over: 1.7 },
      flySpin: { motion: 'hinge', axis: 'y', travel: 1, signal: 'spin', period: 0.32 },
    },
  },

  /**
   * 沙灘球 —— thrown low and bouncing, so the hop is a fast wobble under a slow travel.
   *
   * `fromFacing: 0.6` rather than the disc's 1: a ball that is booted rather than aimed takes
   * some of its heading from where the player is standing relative to it — which is the 「從左側
   * 靠近就往右滾」 half of the brief — and the rest from the way they are facing. Its spread is
   * wider than the frisbee's for the same reason: nobody places a beach ball.
   */
  'beach-ball': {
    behaviour: 'run',
    cue: 0.55,
    openTime: 0.12,
    closeTime: 0.2,
    hold: 1.6,
    launch: { part: 'flyAim', fromFacing: 0.6, spread: 0.22 },
    parts: {
      flyForward: { motion: 'slide', axis: 'z', travel: 2.0, signal: 'pulse', over: 1.8 },
      // A SHORTER arc than the travel: the ball is thrown, lands about halfway out, and rolls the
      // rest. A `wobble` would have been the obvious way to write a bounce and is the wrong one —
      // a sine spends half of every cycle below its rest height, which for a ball resting on the
      // ground means half of every bounce underneath it.
      flyRise: { motion: 'slide', axis: 'y', travel: 0.5, signal: 'pulse', over: 0.85 },
      roll: { motion: 'hinge', axis: 'x', travel: 1, signal: 'spin', period: 0.7 },
    },
  },

  /* ======================================================= 戶外四件：原本各自一套動畫迴圈 */
  /*
   * 營火、望遠鏡、鳥屋、許願井 —— the four this file's own header named as the shape it refuses,
   * and the four that were still living in it. Each had a `useFrame` in its model that ran every
   * frame of the session whether or not anyone was near it (nothing culled them), its own trigger
   * timestamp, its own boost lerp and its own magic numbers. They are rows now, like everything
   * else, and the only code left in their models is geometry, ambient life (a flame flickering, a
   * bird peeking) on the shared culled loop, and effects mounted by state.
   */

  /**
   * 溫馨營火 —— 添柴火: a stick goes on, the log stack settles under it, the fire flares and throws
   * a handful of embers, then settles back.
   *
   * `cue: 0.45` is the bottom of the `tend` crouch, which is where the hand is when the stick
   * leaves it. The stick itself is `<ObjectToss>` inside `tossAim`, and `tossAim` is turned by
   * `launch` so the stick comes from the side the player is actually crouching on — a campfire
   * has no front (`approach: 'nearest'`), so a stick thrown from a fixed model-space side would
   * come out of thin air three times in four.
   */
  campfire: {
    behaviour: 'run',
    cue: 0.45,
    openTime: 0.35,
    closeTime: 1.1,
    hold: 0.9,
    sound: { on: 'crackle' },
    launch: { part: 'tossAim', fromFacing: 0 },
    parts: {
      // A short dip as the new weight lands, and back. A pulse rather than `open`, because a log
      // stack does not stay compressed for as long as the fire stays bright.
      tepee: { motion: 'slide', axis: 'y', travel: -0.035, signal: 'pulse', over: 0.7 },
    },
  },

  /**
   * 黃銅望遠鏡 —— 觀星: the tube swings round to point where the player is looking, lifts toward
   * the sky, scans a little while they look, and the focus knob turns.
   *
   * The heading is `launch` again, and not by coincidence: 「which way does it go」 and 「which way
   * does it point」 are the same question — a direction that must come from the player rather
   * than from the model's own axes. `fromFacing: 1`, so the objective goes where the body is
   * looking, and the eyepiece is on the player's side. The old rig swept the tube side to side on
   * a sine whether or not anyone was there; a telescope does not move by itself, so at rest it now
   * holds still and it is only ever turned by being used.
   */
  telescope: {
    behaviour: 'run',
    cue: 0.2,
    openTime: 0.8,
    closeTime: 1.0,
    hold: 1.5,
    sound: { on: 'twinkle' },
    launch: { part: 'headAim', fromFacing: 1 },
    parts: {
      // Toward vertical: rest leans 0.55 rad off upright, observing leans 0.25.
      tubeTilt: { motion: 'hinge', axis: 'x', travel: -0.30 },
      // A slow scan while it is up, scaled by the same signal, so it only wanders once raised.
      tubePan: { motion: 'hinge', axis: 'y', travel: 0.12, signal: 'wobble', period: 3.4 },
      focusKnob: { motion: 'hinge', axis: 'x', travel: 2.4, range: [0.3, 1] },
    },
  },

  /**
   * 手作鳥屋 —— 看看小鳥: the bird comes out of the hole to see who is there, bobs its head,
   * and goes back in. It still peeks on its own every few seconds; that is ambient life on the
   * `birdIdle` group ABOVE this part, so the two never write the same transform.
   */
  birdhouse: {
    behaviour: 'run',
    cue: 0.3,
    openTime: 0.22,
    closeTime: 0.4,
    hold: 1.5,
    sound: { on: 'chirp' },
    parts: {
      // From just inside the front wall (rest z 0.15) to perched in the hole (0.28).
      birdOut: { motion: 'slide', axis: 'z', travel: 0.13 },
      birdUp: { motion: 'slide', axis: 'y', travel: 0.04 },
      // A curious head-bob, a little behind the pop.
      birdBob: { motion: 'hinge', axis: 'x', travel: 0.22, signal: 'wobble', period: 0.55 },
    },
  },

  /**
   * 許願井 —— 許願: the crank turns, the bucket dips on its rope, a coin arcs in from the
   * player's side and the water answers with rings and a few sparkles.
   *
   * `cue: 0.5` is the bottom of the `wish` bow, where the joined hands let go. The coin is
   * `<ObjectToss>` inside `tossAim`, aimed the same way as the campfire's stick and for the same
   * reason: a well has no front.
   */
  'wishing-well': {
    behaviour: 'run',
    cue: 0.5,
    openTime: 0.45,
    closeTime: 0.8,
    hold: 1.1,
    sound: { on: 'splash' },
    launch: { part: 'tossAim', fromFacing: 0 },
    parts: {
      // A bit over half a turn of the windlass, and back as it closes.
      crank: { motion: 'hinge', axis: 'x', travel: -3.4 },
      bucket: { motion: 'slide', axis: 'y', travel: -0.16, signal: 'pulse', over: 1.9 },
      // The rope pays out WITH the bucket: 0.16 on a 0.5 rope is +32%, on the same pulse, so the
      // rope's top stays on the windlass instead of the whole rope sliding down off it. The rope's
      // group sits at its top end (see the `scale` convention above), so it only grows downward.
      rope: { motion: 'scale', axis: 'y', travel: 0.32, signal: 'pulse', over: 1.9 },
    },
  },

  /* ======================================================= 觀看類 */

  /**
   * 小型觀景平台 —— nothing on a viewing deck opens, so its answer is the thing it is FOR: the
   * pennant on its rail snaps in the wind while somebody is up there looking at the view. A piece
   * with no honest transform gets a small one rather than a fake big one.
   */
  'viewing-deck': {
    behaviour: 'run',
    cue: 0.15,
    openTime: 0.8,
    closeTime: 1.4,
    hold: 2.4,
    parts: {
      pennant: { motion: 'hinge', axis: 'x', travel: 0.55, signal: 'wobble', period: 0.9 },
    },
  },

  /* ======================================================= 承重類：坐上去、躺上去 */
  /*
   * `occupied` pieces, and the reason they are one line of data each.
   *
   * What a sofa does when you sit on it is not a performance — it is a small, correct amount of
   * give, and the interesting part is that it happens over exactly the time the body takes to
   * arrive (Avatar.tsx's POSE_MOUNT_DURATION: 0.45 s onto a seat, 0.9 s onto a bed). Matching
   * `openTime` to that IS the sync for this family: no cue, no event, no timeline — the cushion
   * goes down as the hips come down because both are eased over the same interval.
   *
   * Amplitudes are deliberately small. A cushion that visibly deflates is a beanbag; a cushion
   * that gives three centimetres is a cushion.
   */

  /*
   * A NOTE ON THE THIN CUSHIONS, which is where `scale` stops being the right motion.
   *
   * These four all draw their seat as a slab about 6-10 model units thick, and a `scale` of 14%
   * on 6 is 8 mm — correct arithmetic, invisible picture. They therefore SINK instead: a real
   * distance, so the give does not depend on how thick the artist happened to draw the cushion.
   *
   * 1.5 cm and no more, because the catalog's `surfaceY` is the UNCOMPRESSED top face and that is
   * where the body's hip is put (constants/furnitureInteractions.ts). Every millimetre the cushion
   * sinks is a millimetre of daylight under the sitter, so the give has to stay under what reads
   * as contact. A deep, soft seat that can afford more says so by being thick enough for `scale`
   * — see the rattan tub and the beds below.
   */
  'sofa-luxury': {
    behaviour: 'occupied', openTime: 0.45, closeTime: 0.7,
    sound: CUSHION,
    parts: { cushion: { motion: 'slide', axis: 'y', travel: -0.018 } },
  },
  /** Deep enough (0.18 thick) for a real squash rather than a sink. */
  'sofa-rattan-single': {
    behaviour: 'occupied', openTime: 0.45, closeTime: 0.7,
    sound: CUSHION,
    parts: { cushion: { motion: 'scale', axis: 'y', travel: -0.16 } },
  },
  'sofa-linen-loveseat': {
    behaviour: 'occupied', openTime: 0.45, closeTime: 0.7,
    sound: CUSHION,
    parts: { cushion: { motion: 'slide', axis: 'y', travel: -0.018 } },
  },
  'sofa-l-shaped': {
    behaviour: 'occupied', openTime: 0.45, closeTime: 0.7,
    sound: CUSHION,
    parts: { cushion: { motion: 'slide', axis: 'y', travel: -0.017 } },
  },
  'armchair-wing': {
    behaviour: 'occupied', openTime: 0.45, closeTime: 0.7,
    sound: CUSHION,
    parts: { cushion: { motion: 'slide', axis: 'y', travel: -0.018 } },
  },
  /** 棉麻懶骨頭 —— the one seat that SHOULD visibly deflate, and spread as it does. */
  beanbag: {
    behaviour: 'occupied', openTime: 0.55, closeTime: 0.9,
    sound: { on: 'creak' },
    parts: {
      cushion: { motion: 'scale', axis: 'y', travel: -0.30 },
      belly: { motion: 'scale', axis: 'x', travel: 0.07 },
    },
  },
  /** 人體工學網椅 —— the gas lift sinks two centimetres, then the seat drifts on its castors. */
  'chair-ergonomic': {
    behaviour: 'occupied', openTime: 0.45, closeTime: 0.7,
    parts: {
      seat: { motion: 'slide', axis: 'y', travel: -0.022 },
      swivel: { motion: 'hinge', axis: 'y', travel: 0.10, signal: 'wobble', period: 9 },
    },
  },
  /** 木製餐椅 —— a hard chair gives nothing; what it does is creak and rock a hair. */
  'dining-chair': {
    behaviour: 'occupied', openTime: 0.4, closeTime: 0.6,
    sound: { on: 'creak' },
    parts: { frame: { motion: 'hinge', axis: 'x', travel: 0.018, signal: 'wobble', period: 4.5 } },
  },

  'bed-double': {
    behaviour: 'occupied', openTime: 0.9, closeTime: 1.1,
    sound: CUSHION,
    parts: { mattress: { motion: 'scale', axis: 'y', travel: -0.11 } },
  },
  'bed-single-wood': {
    behaviour: 'occupied', openTime: 0.9, closeTime: 1.1,
    sound: CUSHION,
    parts: { mattress: { motion: 'scale', axis: 'y', travel: -0.12 } },
  },
  'bed-canopy-tent': {
    behaviour: 'occupied', openTime: 0.9, closeTime: 1.1,
    sound: CUSHION,
    parts: {
      mattress: { motion: 'scale', axis: 'y', travel: -0.12 },
      // The canvas over the bed breathes once somebody is in it.
      canopy: { motion: 'hinge', axis: 'x', travel: 0.020, signal: 'wobble', period: 5 },
    },
  },

  /**
   * 雙人獨立浴缸 —— 「水面輕微波動、水花效果」.
   *
   * The water RISES when a body gets in, which is the one piece of physics everybody knows and
   * nobody animates: 4 cm on a 46 cm tub, eased over the same 0.8 s the body takes to sink into
   * it. The ripple rings and the steam are the model's own effects, mounted only while occupied.
   */
  bathtub: {
    behaviour: 'occupied', openTime: 0.8, closeTime: 1.3,
    sound: { on: 'water' },
    parts: {
      water: { motion: 'slide', axis: 'y', travel: 0.042 },
      surface: { motion: 'hinge', axis: 'x', travel: 0.012, signal: 'wobble', period: 2.6 },
    },
  },

  'bench-garden': {
    behaviour: 'occupied', openTime: 0.45, closeTime: 0.7,
    sound: { on: 'creak' },
    parts: { seat: { motion: 'slide', axis: 'y', travel: -0.012 } },
  },
  'tree-stump-seat': {
    behaviour: 'occupied', openTime: 0.4, closeTime: 0.6,
    // A stump does not give. What it does is settle a degree into the turf.
    parts: { stump: { motion: 'hinge', axis: 'z', travel: 0.016 } },
  },
  /** 小型露營椅 —— canvas, so the seat sags and the back tips under the weight. */
  'camp-chair': {
    behaviour: 'occupied', openTime: 0.5, closeTime: 0.8,
    sound: { on: 'creak' },
    parts: {
      canvasSeat: { motion: 'slide', axis: 'y', travel: -0.035 },
      canvasBack: { motion: 'hinge', axis: 'x', travel: -0.09 },
    },
  },
  'lounger-wood': {
    behaviour: 'occupied', openTime: 0.6, closeTime: 0.9,
    sound: { on: 'creak' },
    parts: { frame: { motion: 'slide', axis: 'y', travel: -0.014 } },
  },
  'lounger-beach': {
    behaviour: 'occupied', openTime: 0.6, closeTime: 0.9,
    sound: CUSHION,
    parts: {
      canvas: { motion: 'slide', axis: 'y', travel: -0.030 },
      canvasBack: { motion: 'hinge', axis: 'z', travel: -0.05 },
    },
  },
  /** 野餐墊 —— the cloth presses flat under whoever is on it and its loose corner keeps flapping. */
  'picnic-blanket': {
    behaviour: 'occupied', openTime: 0.6, closeTime: 1.0,
    sound: CUSHION,
    parts: {
      corner: { motion: 'hinge', axis: 'x', travel: 0.35, signal: 'wobble', period: 2.2 },
      cloth: { motion: 'scale', axis: 'y', travel: -0.35 },
    },
  },
  /** 帳篷 —— the canvas breathes and the door flap swings in as somebody settles inside. */
  tent: {
    behaviour: 'occupied', openTime: 0.9, closeTime: 1.2,
    sound: CUSHION,
    parts: {
      body: { motion: 'scale', axis: 'y', travel: -0.018 },
      flapPull: { motion: 'hinge', axis: 'z', travel: -0.30 },
    },
  },
};

/** The reaction this model declares, or null for a piece that stays scenery once you have used it. */
export function getObjectAnimation(modelId: string | undefined): ObjectAnimationSpec | null {
  if (!modelId) return null;
  return OBJECT_ANIMATIONS[modelId as FurnitureModelId] ?? null;
}

/** See {@link ObjectAnimationSpec.cue} — a fraction of the player's posture duration. */
export const DEFAULT_OBJECT_CUE = 0.25;
export const DEFAULT_OPEN_TIME = 0.55;
export const DEFAULT_CLOSE_TIME = 0.75;
export const DEFAULT_PULSE_OVER = 0.8;

/**
 * How long a `momentary` / `run` piece stays at full when it does not say. Long enough to read as
 * 「open」 rather than as a twitch, short enough that walking away never leaves anything hanging.
 */
export const DEFAULT_HOLD = 2.0;
