/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Rarity, RARITY_SPECS } from './rarity';
import { SoundEffect } from '../lib/soundUtils';

/**
 * 購買回饋 — what a purchase feels like, per 稀有度.
 *
 * The companion table to constants/rarity.ts: that one grades how a card LOOKS on the shelf, this
 * one grades what happens when it is bought. Same principle behind both — the tier is expressed by
 * how much is spent, not by a different colour of the same amount — and the same shape of file:
 * data here, behaviour in the component (components/UI/PurchaseDialog.tsx reads a row and plays
 * it; nothing in it branches on a tier name). Adding a tier is a row.
 *
 * ## Why the bottom of this table has to stay boring
 *
 * Before this, every purchase in the game fired the same two confetti bursts, so buying the 史詩
 * 柴犬 you trained 100 XP for celebrated exactly as hard as buying a 200g floor tile. Grading it
 * only works if the low rungs are genuinely quiet: 普通 keeps ONE burst and the plainest sound in
 * the set, and it is that restraint the 神話 fanfare is spending. A game that throws fireworks at
 * every transaction has no fireworks left.
 *
 * That is a deliberate reversal of DESIGN_SYSTEM.md's "nothing pops and nothing hurries", which
 * still governs everything on the shelf — the reveal is the one sanctioned exception.
 *
 * The reveal's threshold is 史詩, which on a four-rung ladder means 「the top two tiers」. It used
 * to sit one rung higher, back when nothing in the game was tagged above 史詩 and so the loudest
 * thing a player could actually reach was the middle of the ladder. Moving it down is what put the
 * game's only earned companion (柴犬, 100 XP) on the same footing as its most expensive one.
 *
 * ## What the four-rung ladder did to this table (2026-08-28)
 *
 * Two rows went with the two tiers that went (constants/rarity.ts): 優秀's — which was the exact
 * celebration EVERY purchase in the game used to fire, before any of this was graded — and 傳說's
 * ribbons-and-fanfare. Their items landed on the rows below them, so what changed is the
 * denominator and not the shape: 史詩 and above is 17 items out of 196, so **~8.7% of purchases
 * get a reveal, and ~91% do not.**
 *
 * That is still the right shape, and it is the number to watch. The restraint at the bottom is
 * what the celebration at the top is spending, and 普通 — three quarters of the catalog now — is
 * by a long way the commonest purchase in the game. If its row ever grows a second burst
 * 「because most purchases feel flat」, the fireworks stop meaning anything the same week; the fix
 * for a flat 普通 purchase is never a louder 普通, it is checking that the item was graded
 * honestly.
 *
 * The one row that could have been re-cut and was not is 史詩. It absorbed 傳說's items and 傳說's
 * *visual* layer (the bezel highlight — see rarity.ts), and it deliberately did NOT absorb 傳說's
 * fanfare or its ribbons: with four rungs there are exactly two reveal tiers left, and the whole
 * job of the lower one is to make the upper one feel like more. 史詩 is a reveal; 神話 is a reveal
 * that the room joins in with.
 */

/** One confetti call: a subset of canvas-confetti's options plus when to fire it. */
export interface ConfettiBurst {
  /** Milliseconds after the celebration starts. Staggering is what makes it unfurl, not pop. */
  delay: number;
  particleCount: number;
  spread: number;
  colors: string[];
  /** canvas-confetti measures a particle's life in ticks, NOT in CSS duration. 110 is standard. */
  ticks: number;
  startVelocity?: number;
  origin?: { x: number; y: number };
  angle?: number;
  /**
   * Draw the particles as tall thin streamers (紙彩帶) instead of the default dots and squares.
   * The shape itself is built in the component with `confetti.shapeFromPath`, because a Path2D
   * cannot be a module constant — it needs a canvas context that exists at call time.
   */
  ribbon?: boolean;
}

/** One sound in a tier's cue, scheduled relative to the celebration's start. */
export interface FxSound {
  effect: SoundEffect;
  delayMs: number;
  volume: number;
}

export interface RarityFxSpec {
  /**
   * Haptic pulses, played in order `hapticGapMs` apart. A list rather than a single strength
   * because the top two tiers are recognisable by their RHYTHM through a pocket — one thud is a
   * confirmation, three is an event, and neither needs the phone to buzz harder.
   */
  haptic: Array<'light' | 'medium' | 'heavy' | 'double'>;
  hapticGapMs: number;
  /**
   * When the first pulse fires, in ms after the celebration starts. Defaults to 0.
   *
   * Non-zero only on the reveal tiers, and it is the same argument as their confetti delays: the
   * item does not arrive until ~1.5s in, so a thud on the button press would be acknowledging the
   * tap rather than the thing appearing. PurchaseDialog already fires its own `light` haptic on the
   * press, so the phone is not silent in between.
   */
  hapticDelayMs?: number;
  sounds: FxSound[];
  confetti: ConfettiBurst[];
  /** 史詩 and above: the full-screen reveal (components/UI/RarityReveal.tsx). */
  reveal: boolean;
  /**
   * How many full turns the item makes on its way in. Reveal tiers only.
   *
   * The one part of the choreography that grades. Every reveal tier settles at the same instant
   * ({@link REVEAL_SETTLE_MS}), so a rarer item does not keep the player waiting longer — it spins
   * FASTER through the same window, which is the difference between "this is worth more" and "this
   * takes more of your time". Grading the duration instead was the obvious first idea and it makes
   * the best item in the game the most tedious one to buy.
   */
  revealTurns: number;
  /** 神話 only: ±4px screen shake under the reveal. */
  shake: boolean;
  /**
   * How long the dialog stays open after a successful purchase, in ms.
   *
   * `null` means "do not use a timer at all" — the reveal tiers close when the reveal reports
   * that it has finished. The old code closed on a flat 1200ms, which for a 2.2-second reveal
   * meant the dialog vanished mid-animation; replacing that with a bigger magic number would
   * just be the same bug tuned to one machine.
   */
  closeDelayMs: number | null;
}

/** Currency-adjacent moment, so gold is the documented exception to the palette. See index.css. */
const GOLD = ['#E8AA3E', '#FFFFFF'];

/** A tier's own two tones plus white — the confetti is literally the card coming apart. */
const tierColors = (rarity: Rarity) => [
  RARITY_SPECS[rarity].edge,
  RARITY_SPECS[rarity].fieldCore,
  '#FFFFFF',
];

/** The opening burst every tier shares, so a purchase always starts the same way. */
const OPENING: ConfettiBurst = { delay: 0, particleCount: 80, spread: 60, colors: GOLD, ticks: 110 };

/**
 * When the item stops turning and faces front, in ms after a reveal starts.
 *
 * The reveal's choreography lives in index.css (`.rarity-reveal-spin`); this is the one instant out
 * of it that the rest of the celebration has to agree with. Confetti, haptics and the screen shake
 * all hang off this number, because the whole point of the stop is that everything blooms ON it —
 * a burst 200ms early reads as the item arriving into confetti that was already there.
 *
 * Change it here, in `.rarity-reveal-spin`'s duration, and in RarityReveal's timeline comment, or
 * the celebration comes apart from the animation it is celebrating.
 *
 * 5500, having been 1500, then 3000, then 4500, then 7500. The arrival — a black silhouette
 * spinning in from far away and growing to full size — is the part of this players actually watch,
 * and every extension came from being told it was still too quick to enjoy. 5500 is the first time
 * it has come back DOWN:「音效可以短個兩秒」— the whoosh runs for the whole arrival, so a spin that
 * is two seconds too long is heard before it is seen. 7.5s had gone past the point where more time
 * is more to enjoy and become a wait between paying and being shown what you bought.
 *
 * Nothing has been re-choreographed on any of those passes, this one included: every beat that
 * hangs off this constant kept its gap from the settle, so the copy still lands on the same rhythm
 * and the reading time after the stop is unchanged. The only thing shortening the track took time
 * out of is the APPROACH — the bounce at the end is still ~1.5s, which is why `.rarity-reveal-spin`
 * and `.rarity-reveal-grow` moved their overshoot stop from 80% back to 73%.
 *
 * Note this is the DURATION, not the speed. How fast the item turns is {@link RarityFxSpec.revealTurns}
 * per tier — the same turn count on a shorter track is a FASTER spin, so the two move together:
 * every change to this number has carried the same proportional change to all three turn counts,
 * which is what keeps「轉得更久」from quietly meaning「轉得更慢」and「短個兩秒」from meaning「轉快一點」.
 */
export const REVEAL_SETTLE_MS = 5500;

/**
 * When the item stops being a black shape and its own colour starts rising into it.
 *
 * 62% of the arrival, which is `.rarity-reveal-silhouette`'s middle keyframe in index.css — that
 * stop is the source of truth and this is it in milliseconds. Move one, move the other.
 *
 * It exists because the 轉動音 starts BACKING OFF here: 「當已經可以看到鳳凰 icon 的顏色的時候就
 * 可以不用有旋轉的聲音」. The reasoning holds up beyond the ask — the whoosh belongs to the
 * SILHOUETTE phase, the part where the player is being asked to guess at a turning shape. Once the
 * thing has colour it is not a spinning object any more, it is the pet they just bought.
 *
 * Backing off, though, and not stopping. This used to be a hard cut, and measured that left the
 * last 2.85s of the spin at exactly zero while the item was still visibly turning — 「旋轉音效不
 * 要不見」. It is now where a ramp to silence BEGINS, landing on {@link REVEAL_SETTLE_MS}. See
 * playRevealSpin in lib/soundUtils.ts.
 */
export const REVEAL_COLOUR_RISE_MS = Math.round(REVEAL_SETTLE_MS * 0.62);

export const RARITY_FX: Record<Rarity, RarityFxSpec> = {
  // 普通 — roughly 43% of the shop, and the floor everything above is measured against. One burst,
  // one chime, and it has to STAY that quiet now that it is the commonest purchase in the game. This is
  // the floor the whole table is measured against.
  common: {
    haptic: ['light'],
    hapticGapMs: 0,
    sounds: [{ effect: SoundEffect.SUCCESS, delayMs: 0, volume: 0.6 }],
    confetti: [OPENING],
    reveal: false,
    revealTurns: 0,
    shake: false,
    closeDelayMs: 1200,
  },
  // 稀有 — the first tier whose celebration is in the ITEM's colour rather than the game's. The
  // second burst swaps teal for the tier, which is the moment the confetti starts belonging to
  // the thing bought instead of to the shop.
  rare: {
    haptic: ['medium'],
    hapticGapMs: 0,
    sounds: [
      { effect: SoundEffect.SUCCESS, delayMs: 0, volume: 0.6 },
      { effect: SoundEffect.RARE_REVEAL, delayMs: 150, volume: 0.5 },
    ],
    confetti: [OPENING, { delay: 200, particleCount: 150, spread: 100, colors: tierColors('rare'), ticks: 110 }],
    reveal: false,
    revealTurns: 0,
    shake: false,
    closeDelayMs: 1400,
  },
  // 史詩 — the first tier that gets the full-screen reveal, and the reason the threshold moved down
  // to here.
  //
  // It used to be three confetti bursts over the dialog. That was the right shape when nothing in
  // the shop was tagged above 史詩, but the graded pet shelf put 柴犬 at this tier — the one
  // companion in the game that is EARNED (100 XP, no gold price) rather than bought — and finishing
  // a hundred training sessions was being celebrated with confetti over a dialog box while a 4800g
  // purchase got the screen. The reveal is what a milestone looks like; 史詩 is where milestones
  // start.
  //
  // It is the quieter of the two reveals left, and by the same means the whole table uses: no
  // ribbons thrown in from the edges, no fanfare, no shake, one burst fewer. That gap is the only
  // thing separating the second rung from the top one now, so nothing here may grow into it.
  epic: {
    haptic: ['heavy'],
    hapticGapMs: 0,
    hapticDelayMs: REVEAL_SETTLE_MS,
    sounds: [
      { effect: SoundEffect.SUCCESS, delayMs: 0, volume: 0.45 },
      { effect: SoundEffect.EPIC_REVEAL, delayMs: REVEAL_SETTLE_MS - 60, volume: 0.55 },
    ],
    confetti: [
      { delay: REVEAL_SETTLE_MS, particleCount: 120, spread: 110, startVelocity: 34, colors: tierColors('epic'), ticks: 160 },
      { delay: REVEAL_SETTLE_MS + 140, particleCount: 80, spread: 150, startVelocity: 28, colors: [RARITY_SPECS.epic.edge, '#FFFFFF'], ticks: 170 },
    ],
    reveal: true,
    // 6, from 8 when the track came down to 5.5s — the same ~65rpm, six passes instead of eight.
    // Before that it was 8 from 10, the first time this column ever went DOWN: every raise until
    // then was compensating for a spin that did not look like one, and the cause turned out to be a
    // missing perspective (see `.rarity-reveal-pivot` in index.css), not a rate. With the turn
    // actually rendering in 3D the rate has been right ever since; what moves it now is the length
    // of the track, and only so that the rate does NOT move with it.
    revealTurns: 6,
    shake: false,
    closeDelayMs: null,
  },
  // 神話 — 史詩's reveal plus the four things nothing else in the game does: a brass fanfare,
  // streamers thrown in from both sides of the screen instead of up from the middle, a hue that
  // moves and a screen that moves. The celebration stops coming from the dialog and starts coming
  // from the room. Its confetti is the only place the whole ladder's palette appears at once,
  // which is the point — this tier is the top of a ladder, so it wears all of it.
  //
  // The fanfare is SoundEffect.MYTHIC_FANFARE, which lib/soundUtils.ts builds as 「the 傳說
  // fanfare plus a run」. That composition outlived the tier it names, and the argument for it is
  // unchanged now that the brass underneath is nobody's own sound: the top of a ladder is
  // recognisable because it contains the rung below it.
  mythic: {
    haptic: ['heavy', 'heavy', 'heavy'],
    hapticGapMs: 90,
    hapticDelayMs: REVEAL_SETTLE_MS,
    sounds: [
      { effect: SoundEffect.MYTHIC_FANFARE, delayMs: 0, volume: 0.5 },
      { effect: SoundEffect.REWARD, delayMs: REVEAL_SETTLE_MS + 40, volume: 0.45 },
    ],
    confetti: [
      { delay: REVEAL_SETTLE_MS - 20, particleCount: 80, spread: 60, startVelocity: 46, angle: 66, origin: { x: 0.16, y: 0.62 }, colors: tierColors('mythic'), ticks: 200, ribbon: true },
      { delay: REVEAL_SETTLE_MS + 60, particleCount: 80, spread: 60, startVelocity: 46, angle: 114, origin: { x: 0.84, y: 0.62 }, colors: tierColors('mythic'), ticks: 200, ribbon: true },
      {
        delay: REVEAL_SETTLE_MS + 240,
        particleCount: 170,
        spread: 150,
        startVelocity: 40,
        // The whole ladder, rarest first, then gold and white. `#FFFFFF` is doing double duty as
        // 普通's rung and as the neutral every tier's own confetti carries — which is exactly what
        // that tier's near-white swatch is, so reading `RARITY_SPECS.common.edge` here would add a
        // second almost-white to the same handful and change nothing a player can see.
        colors: [
          RARITY_SPECS.mythic.edge,
          RARITY_SPECS.mythic.fieldCore,
          RARITY_SPECS.epic.edge,
          RARITY_SPECS.rare.edge,
          '#E8AA3E',
          '#FFFFFF',
        ],
        ticks: 200,
      },
    ],
    reveal: true,
    // The most-revised number in this file. The history IS the reasoning, so all of it is kept:
    //
    //   5  the original — top of the ladder, the request the field was added for.
    //   0  after seeing it on the 鳳凰: "神話 does not spin at all". Five turns inside what was
    //      then a 1.5s entrance is 200rpm, and the thing the player is meant to be recognising was
    //      a blur for most of its arrival.
    //   2  the entrance had been slowed to 3s, and zero turns across it was not a calm arrival but
    //      an item that grows and does nothing else — 「沒有旋轉的感覺」.
    //  10  with the track at 4.5s and the ask 「轉速幫我提高，轉的時間幫我再拉長」.
    //  17  with the track at 7.5s and the ask 「轉的時間幫我再增加3秒」, holding the ~136rpm that
    //      10-across-4.5s had so that lengthening the track did not quietly slow the spin.
    //  12  with the track still at 7.5s, and the first DECREASE this field ever took. Every raise
    //      above it was chasing
    //      「看不出來在轉」, and the cause was never the rate: the perspective was not reaching the
    //      rotation at all (see `.rarity-reveal-pivot` in index.css), so what the player was
    //      watching was a card squashing horizontally, which reads as flickering however fast it
    //      goes. With that fixed, each pass has a near edge that swings toward the viewer, and
    //      ~96rpm shows twelve of them. More would go back to being a blur — this time a
    //      three-dimensional one.
    //
    //   9  now, with the track at 5.5s and the ask 「音效可以短個兩秒」. Twelve turns on the shorter
    //      track would be ~131rpm — the blur 12 was chosen to avoid — so the count comes down with
    //      the duration and the item keeps turning at the ~96rpm that was found to read.
    //
    // The ladder stays monotonic (6 / 9 — it was 6 / 7 / 9 while 傳說 sat between them), the
    // curve still front-loads the rotation, and the
    // spin still ends in a long decay into the stop. What changed is that the turns are now
    // visible, so fewer of them say more.
    revealTurns: 9,
    shake: true,
    closeDelayMs: null,
  },
};

/**
 * The celebration for an item.
 *
 * The optional parameter is a leftover from when most of the catalog declared no tier at all, and
 * it is deliberately kept: every catalog item is graded now (constants/rarity.ts), but a caller
 * holding a partially-built item — a test fixture, a preview — should get the quietest row rather
 * than a crash. Nothing in the app passes `undefined` any more.
 */
export const getPurchaseFx = (rarity?: Rarity): RarityFxSpec => RARITY_FX[rarity ?? 'common'];
