/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 獎勵計算層 — the one place a reward is changed by anything the player has activated.
 *
 *   Base Reward  →  Active Effects  →  Final Reward
 *
 * Every reward in the game passes through {@link settleReward} on its way to the wallet, and it is
 * the ONLY place a multiplier is ever applied. That is the whole point of the file, and it is what
 * §3 and §16 of the brief are asking for: a new card that doubles 碎片, or triples 經驗值 on a
 * weekend, is a row in constants/utilityCards.ts — not an edit to 健身, not an edit to 每日登入,
 * not an edit to whatever pays out next year.
 *
 * ## Where it is actually wired in, and why there is exactly one seam
 *
 * `buildCurrencyUpdate` in context/useEconomyActions.ts is the single function in the game that
 * turns a currency grant into a database write, and it calls this file. Everything that pays a
 * currency goes through it — the standalone grant path, 摸摸寵物, the offline 每日登入 claim and
 * the 健身 payout — so 「×2 在哪一層計算」 has one answer and cannot grow a second.
 *
 * The alternative was to multiply at each source, which is the arrangement the brief specifically
 * forbids: `coinReward * 2` inside a fitness screen is invisible to the next reward source that is
 * written, and two sources that each remember to multiply are one refactor away from a reward that
 * is multiplied twice.
 *
 * ## Base is preserved, never overwritten
 *
 * A settlement returns BOTH numbers ({@link SettledReward.base} and {@link SettledReward.reward}).
 * The base is what the rule tables decided (constants/workoutRewards.ts et al.) and it stays
 * readable, so a receipt can say 「基礎 40 ＋ 雙倍 40」 and a log can show what a workout was worth
 * before the card. Nothing here ever rewrites the payout tables.
 *
 * ## Consuming a use is part of the SAME write
 *
 * A `uses`-based effect must be decremented exactly when the reward it boosted is banked. So this
 * function does not write anything: it returns {@link SettledReward.cardsAfter}, the card state as
 * it should be saved, and the caller folds that into the one `updateDoc` that also moves the
 * balance. A failed save then costs the player nothing — no coins, and no spent use.
 */

import type { Reward } from './rewards';
import {
  activeEffects,
  getUtilityCard,
  type ActiveUtilityEffect,
  type UtilityCardId,
  type UtilityCardState,
  type UtilityEffect,
  type UtilityEffectKind,
} from './utilityCards';

/**
 * What the player has running, and when 「now」 is.
 *
 * `nowMs` is passed in rather than read here for the same reason it is passed into every function
 * in constants/utilityCards.ts: a pure calculation layer that reads the clock cannot be tested, and
 * the day a server owns the clock this is the only argument that changes.
 */
export interface RewardEffectContext {
  cards?: UtilityCardState | null;
  nowMs: number;
}

/** No effects at all — for a caller that has no profile yet, and for tests of the base case. */
export const NO_EFFECTS: RewardEffectContext = { cards: null, nowMs: 0 };

/** One effect's contribution to a settlement. Carried for the receipt and for the log line. */
export interface AppliedEffectNote {
  activationId: string;
  cardId: UtilityCardId;
  kind: UtilityEffectKind;
  /** What this one effect multiplied by. */
  factor: number;
}

export interface SettledReward {
  /** What the reward tables decided, untouched. */
  base: Reward;
  /** What is actually paid. Identical to `base` when nothing is running. */
  reward: Reward;
  /** The combined factor, after the cap. 1 when nothing applied. */
  multiplier: number;
  applied: AppliedEffectNote[];
  /**
   * The card state to persist alongside the reward, or null when no effect was consumed.
   *
   * Null in the overwhelmingly common case (nothing running, or a timed effect that is not spent by
   * being used), which is what keeps the ordinary write byte-for-byte what it always was.
   */
  cardsAfter: UtilityCardState | null;
}

/**
 * The ceiling on the combined multiplier.
 *
 * A guard, not a balance dial — the same role `maxCoinsPerWorkout` plays in constants/
 * workoutRewards.ts. Effects multiply together, so three ×2 cards would be ×8 and a fourth would be
 * ×16; with 金幣 the only currency that buys anything, a stack like that is not a good day, it is a
 * broken economy. Today only one card exists and the cap is unreachable, which is exactly when it
 * should be written down.
 */
export const MAX_REWARD_MULTIPLIER = 4;

/** Whether one effect applies to this reward. The only place that question is answered. */
function matches(effect: UtilityEffect, reward: Reward): boolean {
  if (effect.kind === 'currency-multiplier') {
    return reward.kind === 'currency' && reward.currency === effect.currency;
  }
  return reward.kind === 'xp';
}

/** A sane, positive factor. A card configured with 0, NaN or a negative reads as 「no effect」. */
function factorOf(effect: UtilityEffect): number {
  const raw = effect.multiplier;
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/**
 * Applies everything the player has running to one reward.
 *
 * Order is: find live effects → keep the ones that match THIS reward → multiply (capped) → floor →
 * consume any uses that were actually spent. An effect that does not match is never consumed, which
 * is what stops a 「接下來一次獎勵」 card from being eaten by a 經驗值 grant it did nothing to.
 *
 * Item and 功能卡 rewards pass through untouched. There is no such thing as ×2 of one hat, and a
 * card that doubled card drops would need a rule about caps and duplicates that nothing has asked
 * for — so the shape simply does not offer it.
 */
export function settleReward(base: Reward, ctx: RewardEffectContext): SettledReward {
  const unchanged: SettledReward = {
    base,
    reward: base,
    multiplier: 1,
    applied: [],
    cardsAfter: null,
  };

  if (base.kind !== 'currency' && base.kind !== 'xp') return unchanged;

  const live = activeEffects(ctx.cards, ctx.nowMs);
  if (live.length === 0) return unchanged;

  const applied: AppliedEffectNote[] = [];
  let multiplier = 1;

  for (const active of live) {
    const card = getUtilityCard(active.cardId);
    if (!card || !matches(card.effect, base)) continue;
    const factor = factorOf(card.effect);
    if (factor === 1) continue;
    multiplier *= factor;
    applied.push({
      activationId: active.activationId,
      cardId: active.cardId,
      kind: card.effect.kind,
      factor,
    });
  }

  if (applied.length === 0) return unchanged;

  multiplier = Math.min(MAX_REWARD_MULTIPLIER, multiplier);

  // Floored, because both currencies and 經驗值 are integers everywhere else (the wallet, the HUD,
  // firestore.rules), and never below the base — a multiplier is a bonus, so a rounding path that
  // could pay less than the base reward would be a card that punishes the player for using it.
  const amount = Math.max(base.amount, Math.floor(base.amount * multiplier));
  const reward: Reward =
    base.kind === 'currency' ? { ...base, amount } : { kind: 'xp', amount };

  return { base, reward, multiplier, applied, cardsAfter: consume(ctx.cards, applied) };
}

/**
 * The card state after the applied `uses`-based effects have spent one use each.
 *
 * Returns null when nothing changed — a timed effect is not consumed by being applied, and that is
 * the only kind of card the game ships with today, so the common path writes nothing extra.
 */
function consume(
  cards: UtilityCardState | null | undefined,
  applied: readonly AppliedEffectNote[],
): UtilityCardState | null {
  if (!cards?.active || applied.length === 0) return null;

  const spent = new Set(applied.map((note) => note.activationId));
  let changed = false;

  const next: ActiveUtilityEffect[] = [];
  for (const effect of cards.active) {
    if (!spent.has(effect.activationId) || typeof effect.usesLeft !== 'number') {
      next.push(effect);
      continue;
    }
    changed = true;
    const usesLeft = effect.usesLeft - 1;
    // Dropped rather than kept at zero: `activeEffects` would filter it out anyway, and a record
    // that is never live again is noise in a save that has to stay small.
    if (usesLeft > 0) next.push({ ...effect, usesLeft });
  }

  return changed ? { ...cards, active: next } : null;
}

/** One line for the console, when a grant was boosted. Never player-facing copy. */
export function describeSettlement(settled: SettledReward): string {
  if (settled.applied.length === 0) return '';
  const names = settled.applied.map((note) => getUtilityCard(note.cardId)?.name ?? note.cardId);
  const before = settled.base.kind === 'item' ? settled.base.quantity : 'amount' in settled.base ? settled.base.amount : 0;
  const after = settled.reward.kind === 'item' ? settled.reward.quantity : 'amount' in settled.reward ? settled.reward.amount : 0;
  return `[effects] ${names.join('、')} → ×${settled.multiplier}（${before} → ${after}）`;
}
