/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 輪盤獎勵池 — what a spin can produce, and how likely each outcome is.
 *
 * A weighted TABLE, which is the whole of §5 of the brief: every outcome is a row with a `weight`,
 * and 「功能卡比較難抽到」 is the number 10 sitting next to 380 rather than an `if` somewhere. There
 * is no branch in this file that mentions 雙倍金幣券, and nothing that spins the wheel is allowed to
 * grow one — a second card is another row, and a third kind of prize is another member of
 * {@link WheelPrize}.
 *
 * ## What exists today, and what does not
 *
 * There is no 轉盤 SCREEN in the game. That was true before this feature and is still true: the
 * brief asks for the probability system and for 功能卡 to be reachable through it, not for a wheel
 * to be designed. So this file is the reward half — the table, the draw and the odds — and
 * context/useWheelActions.ts is the grant half. When a wheel is built, it calls `spinWheel()` and
 * draws the result; it does not decide what it won.
 *
 * What a spin COSTS is deliberately not decided here either. 抽獎券 exist and have no sink yet
 * (constants/fragments.ts), and choosing 「一次一張券」 would be this file quietly designing an
 * economy that nobody has asked it to. The draw is free of that question: a caller charges whatever
 * the wheel ends up costing, in the same write, and this table stays about prizes.
 *
 * ## The draw is seeded, and that is the fix for §19's 「不會因 UI 重渲染重新抽獎」
 *
 * {@link drawWheelSlot} takes a spin id and is a pure function of it. A component that re-renders
 * mid-animation re-derives the SAME prize, because the prize is a property of the spin and not of
 * the render. `Math.random()` inside a component is the exact failure that requirement names.
 */

import { getItemById, type ItemDefinition } from './items';
import { FRAGMENT_ITEMS, rollWorkoutFragmentItem } from './fragments';
import { pickWeighted, seedFrom, totalWeight, weightedChance, type Weighted } from './rewardPools';
import { getUtilityCard, type UtilityCardId } from './utilityCards';
import type { UserProfile } from '../types';

/**
 * What one slot pays.
 *
 * Three shapes, and each one is granted through the system that already owns it — 碎片 through the
 * economy service, 商品碎片 through the fragment service, 功能卡 through the card service. The
 * wheel therefore has no write of its own and cannot drift from how the same prize is paid
 * elsewhere. See context/useWheelActions.ts.
 */
export type WheelPrize =
  /** 碎片 — the wallet currency. Never 金幣: SOURCE_CURRENCY_POLICY refuses that (constants/rewards.ts). */
  | { kind: 'currency'; currency: 'fragments'; amount: number }
  /** 商品碎片 toward one item, chosen by the same rule a workout's drop uses. */
  | { kind: 'item-fragments'; amount: number }
  /** 功能卡 (constants/utilityCards.ts). */
  | { kind: 'utility-card'; cardId: UtilityCardId; quantity: number };

export interface WheelSlot {
  id: string;
  /** What the wedge says. Player-facing. */
  label: string;
  /**
   * Relative likelihood against every other row. Not a percentage — a percentage would have to be
   * re-typed on every row each time a slot is added, and the first one anybody forgets makes the
   * table lie about itself. See {@link wheelOdds} for the derived percentages.
   */
  weight: number;
  prize: WheelPrize;
}

/**
 * The table.
 *
 * Weights add up to 1,000, which is a convenience for reading them as tenths of a percent and
 * nothing more — {@link pickWeighted} normalises, so a row can be added without re-balancing the
 * rest to hit a round number.
 *
 * The shape of the ladder: 碎片 is the everyday outcome, 商品碎片 is the one that moves a collection
 * forward, and 功能卡 is the rare one. 1% is deliberately an order of magnitude below the least
 * likely ordinary prize (6%) — a card is a thing that happens to you a few times a month, not a
 * thing you spin for. `npm run test:utility-cards` fails if that stops being true.
 */
export const WHEEL_SLOTS: readonly WheelSlot[] = [
  {
    id: 'fragments-small',
    label: '碎片 ×10',
    weight: 380,
    prize: { kind: 'currency', currency: 'fragments', amount: 10 },
  },
  {
    id: 'item-fragments-small',
    label: '商品碎片 ×15',
    weight: 250,
    prize: { kind: 'item-fragments', amount: 15 },
  },
  {
    id: 'fragments-medium',
    label: '碎片 ×25',
    weight: 200,
    prize: { kind: 'currency', currency: 'fragments', amount: 25 },
  },
  {
    id: 'item-fragments-large',
    label: '商品碎片 ×40',
    weight: 100,
    prize: { kind: 'item-fragments', amount: 40 },
  },
  {
    id: 'fragments-large',
    label: '碎片 ×60',
    weight: 60,
    prize: { kind: 'currency', currency: 'fragments', amount: 60 },
  },
  {
    id: 'card-double-coin',
    label: '雙倍金幣券',
    weight: 10,
    prize: { kind: 'utility-card', cardId: 'double-coin', quantity: 1 },
  },
];

/** The table as the shared weighted-choice system reads it. */
export const WHEEL_ENTRIES: readonly Weighted<WheelSlot>[] = WHEEL_SLOTS.map((slot) => ({
  value: slot,
  weight: slot.weight,
}));

export function getWheelSlot(slotId: string): WheelSlot | null {
  return WHEEL_SLOTS.find((slot) => slot.id === slotId) ?? null;
}

/**
 * The prize for one spin. A pure function of the spin id — see the file doc on why that matters.
 *
 * The id is the EVENT: whatever the wheel screen calls one spin (a uuid, a timestamp, a server's
 * id), the same id always lands on the same wedge, so a re-render, a retry or a reconnect cannot
 * change what was won.
 */
export function drawWheelSlot(spinId: string): WheelSlot | null {
  return pickWeighted(WHEEL_ENTRIES, seedFrom(`wheel:${spinId}`));
}

/** Every slot with its real probability. For an odds sheet, the admin readout and the tests. */
export function wheelOdds(): { slot: WheelSlot; chance: number }[] {
  return WHEEL_SLOTS.map((slot) => ({ slot, chance: weightedChance(WHEEL_ENTRIES, slot) }));
}

/** The combined chance of drawing any 功能卡. What §5's 「機率較低」 is measured against. */
export function utilityCardChance(): number {
  const total = totalWeight(WHEEL_ENTRIES);
  if (total <= 0) return 0;
  const cardWeight = WHEEL_SLOTS
    .filter((slot) => slot.prize.kind === 'utility-card')
    .reduce((sum, slot) => sum + slot.weight, 0);
  return cardWeight / total;
}

/**
 * A deterministic 0…1 generator from one seed. Mulberry32 — small, fast, and good enough for a
 * prize wheel.
 *
 * It exists so the 商品碎片 slot can reuse {@link rollWorkoutFragmentItem}'s selection rule (which
 * takes an injected `random`) instead of this file inventing a second answer to 「碎片要給哪一件
 * 商品」. One rule, two callers.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A slot's prize with everything resolved — the item behind a 商品碎片 win, the card behind a card. */
export type ResolvedWheelPrize =
  | { kind: 'currency'; currency: 'fragments'; amount: number; label: string }
  | { kind: 'item-fragments'; item: ItemDefinition; amount: number; label: string }
  | { kind: 'utility-card'; cardId: UtilityCardId; quantity: number; label: string };

/**
 * Turns a drawn slot into the exact thing to grant.
 *
 * Separate from the draw because only this half needs the player: which item's fragments a spin pays
 * depends on what they already own, while WHICH WEDGE it landed on does not. Keeping the wedge pure
 * is what lets a wheel animation be driven from the spin id alone.
 *
 * Returns null when a slot cannot be honoured — a card that has been retired, or a catalog with no
 * fragment items at all. A prize that cannot be paid is dropped rather than substituted, because
 * quietly paying something else is how a drop table's mistakes become invisible.
 */
export function resolveWheelPrize(
  slot: WheelSlot,
  profile: UserProfile | null | undefined,
  isOwned: (itemId: string) => boolean,
  spinId: string,
): ResolvedWheelPrize | null {
  const prize = slot.prize;

  if (prize.kind === 'currency') {
    return { kind: 'currency', currency: prize.currency, amount: prize.amount, label: slot.label };
  }

  if (prize.kind === 'item-fragments') {
    if (FRAGMENT_ITEMS.length === 0) return null;
    const item = rollWorkoutFragmentItem(profile, isOwned, seededRandom(seedFrom(`wheel-item:${spinId}`)));
    const resolved = item ?? getItemById(FRAGMENT_ITEMS[0].id);
    if (!resolved) return null;
    return { kind: 'item-fragments', item: resolved, amount: prize.amount, label: slot.label };
  }

  const card = getUtilityCard(prize.cardId);
  if (!card) return null;
  return { kind: 'utility-card', cardId: card.id, quantity: prize.quantity, label: card.name };
}
