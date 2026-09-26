/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 每日登入獎勵 — the half that knows the catalog.
 *
 * constants/dailyLogin.ts decides what each day is WORTH ({@link DailyPrize}: 10 商品碎片, 15 金幣,
 * one 功能卡, a 史詩 product…) and deliberately cannot say WHICH product or WHICH card, because it
 * is imported by the Express server and must not drag a few hundred item definitions across with
 * it. This file answers the second question, from the SAME seed, so the two halves agree without
 * either one importing the other's dependencies.
 *
 * Everything here is a pure function of `(cycleId, day)` and the player's own inventory. Nothing
 * writes; the write is context/useDailyLoginPrize.ts.
 *
 * ## Why the pools are rules and not lists
 *
 * Same reason as everywhere else in this game (constants/rewardPools.ts): adding a 稀有 lamp to the
 * shop should put it on 第 5 天 with no edit here, and grading something 神話 should take it off.
 * There is not one item id in this file.
 */

import { getItemById, type ItemDefinition } from './items';
import { FRAGMENT_ITEMS } from './fragments';
import { RARITY_SPECS, type Rarity } from './rarity';
import { drawReward, type RewardPool } from './rewardPools';
import { seedFrom, seedPick } from './seed';
import { ALL_UTILITY_CARDS, type UtilityCardId } from './utilityCards';
import { dailyPrizeFor, type DailyPrize, type DailyPrizeKind } from './dailyLogin';

/**
 * The tiers a 碎片 day may collect toward.
 *
 * 普通 and 稀有 only, as briefed, and the restriction is doing real work rather than decorating the
 * table: 10 碎片 is a twentieth of an unlock, so a 史詩 or 神話 piece would take twenty fragment
 * days — most of three rounds — to reach through this route alone. A bar that cannot move is worse
 * than no bar, and 第 5 天 is where the round hands the expensive tiers over outright instead.
 */
export const DAILY_FRAGMENT_RARITIES: readonly Rarity[] = ['common', 'rare'];

/**
 * Every product a 碎片 day can land on: has a fragment of its own, and is 普通 or 稀有.
 *
 * Derived from {@link FRAGMENT_ITEMS}, which is already 「everything the ordinary shop sells that
 * has a fragment」 — so the 經驗值 unlocks, the 0-price 毛胚屋, the 抽獎券 bundles and the 限時商店
 * exclusives are all excluded before this filter ever runs. Computed once: the catalog is a
 * module-level constant and re-filtering it per render would be re-deriving the same list all day.
 */
export const DAILY_FRAGMENT_POOL: readonly ItemDefinition[] = FRAGMENT_ITEMS.filter((item) =>
  DAILY_FRAGMENT_RARITIES.includes(item.rarity),
);

/**
 * Which product THIS day's 商品碎片 are for.
 *
 * One item per DAY now, not one per round. The old round picked a single 主打商品 and paid a ladder
 * of fragments toward it, on the argument that seven scattered stacks are each a tenth of the way
 * to nothing. That argument was right about the old round and does not survive this one: at most
 * four days of a round pay fragments at all, and they pay 10 each — so 「本輪主打」 would have meant
 * 40 fragments toward one item, a fifth of an unlock, which is not a week's worth of anything
 * either. What a per-day roll buys instead is variety, and the stack a player actually wants to
 * finish is the one 運動 tops up (constants/fragments.ts's `rollWorkoutFragmentItem`, which is
 * deliberately weighted toward a stack already started).
 *
 * Seeded on the round AND the day, so a card can show the item before the day arrives and the
 * payout lands on the one that was shown.
 */
export function dailyFragmentItem(cycleId: string, day: number): ItemDefinition | null {
  return seedPick(DAILY_FRAGMENT_POOL, seedFrom(`daily-fragment-item:${cycleId}:${day}`));
}

/**
 * 第 5 天的商品池, pinned to exactly one tier.
 *
 * Floor and ceiling on the same rung for the reason the wheel's outfit pools are
 * (constants/luckyWheel.ts): the card says 史詩商品, so it must not be able to pay 普通 — a promise
 * broken downward — or 神話, which would quietly make 神話 something a login can hand out.
 *
 * No category restriction and no price bounds. 「商品」 in the brief means a product, not a
 * wearable: a sofa, a pet accessory and a hat are all things the shop sells and all things this day
 * may give. Price is deliberately not bounded either — this game grades by rarity and the catalog is
 * laid out to disprove 「貴的就是稀有的」, so a price ceiling here would quietly re-introduce it.
 */
export function dailyItemPool(rarity: Rarity): RewardPool {
  return {
    id: `daily-login-item-${rarity}`,
    label: `每日登入：${RARITY_SPECS[rarity].label}商品`,
    categories: [],
    maxPrice: Number.MAX_SAFE_INTEGER,
    minPrice: 1,
    maxRarity: rarity,
    minRarity: rarity,
    allowXpUnlock: false,
    // A duplicate own-once wearable is a no-op in the inventory (utils/inventory.ts), so a repeat
    // pick would read to the player as having been handed nothing at all on the one day of the
    // round that gives a whole product.
    preferUnowned: true,
  };
}

/**
 * The product 第 5 天 actually hands over.
 *
 * Takes the owned ids rather than a profile so it stays pure, and because `preferUnowned` is the
 * one part of this that is not a function of the seed alone — the same round shows a different item
 * to a player who has bought half the shop, which is correct and is why the CARD shows the tier
 * rather than the item (see DailyLoginPanel). A board that named the item would be promising
 * something that changes when the player goes shopping.
 */
export function dailyPrizeItem(
  cycleId: string,
  day: number,
  rarity: Rarity,
  ownedItemIds: readonly string[],
): ItemDefinition | null {
  const draw = drawReward(dailyItemPool(rarity), ownedItemIds, seedFrom(`daily-item:${cycleId}:${day}`));
  return draw.ok ? draw.item : null;
}

/**
 * Which 功能卡 第 2 天 hands over.
 *
 * Drawn from the cards that declare 每日登入 as a channel, so a second card ships by adding
 * `'daily-login'` to its own `channels` rather than by editing this file. There is one card today
 * (雙倍金幣券) and the draw is therefore a formality — which is exactly the state in which it is
 * cheap to write it correctly.
 */
export function dailyPrizeCard(cycleId: string, day: number): UtilityCardId | null {
  const pool = ALL_UTILITY_CARDS.filter((card) => card.channels.includes('daily-login'));
  return seedPick(pool, seedFrom(`daily-card:${cycleId}:${day}`))?.id ?? null;
}

/**
 * One day's prize with every blank filled in — the shape the card draws and the write path pays.
 *
 * `prize` is the amounts (from constants/dailyLogin.ts) and the three ids are this file's answer to
 * 「哪一個」. An id is null when that kind of thing is not part of this day, and ALSO when the pool
 * that should have supplied it came back empty — a catalog with no 史詩 product, say. The write
 * path treats those the same way and simply pays what it can: a prize that cannot be granted must
 * never fail a claim, because the claim is the thing that marks the day off.
 */
export interface ResolvedDailyPrize {
  prize: DailyPrize;
  /** The product this day's 商品碎片 belong to. */
  fragmentItemId: string | null;
  /** The product this day hands over outright. */
  itemId: string | null;
  /** The 功能卡 this day hands over. */
  cardId: UtilityCardId | null;
}

export function resolveDailyPrize(
  cycleId: string,
  day: number,
  ownedItemIds: readonly string[],
): ResolvedDailyPrize {
  const prize = dailyPrizeFor(cycleId, day);
  return {
    prize,
    fragmentItemId: prize.itemFragments > 0 ? dailyFragmentItem(cycleId, day)?.id ?? null : null,
    itemId:
      prize.itemRarity !== null
        ? dailyPrizeItem(cycleId, day, prize.itemRarity, ownedItemIds)?.id ?? null
        : null,
    cardId: prize.cards > 0 ? dailyPrizeCard(cycleId, day) : null,
  };
}

/**
 * What a claim ACTUALLY banked, as opposed to what the day promised.
 *
 * The two differ often enough that reporting the promise would be a lie in the ordinary case, not
 * just the edge one: a 碎片 stack already at 200 keeps none of its 10 and pays 抽獎券 instead, and
 * a 功能卡 the player is already carrying the maximum of cannot be added at all. The reveal
 * announces THIS, never the prize, for the same reason the old one read its number off the write
 * rather than off the ladder.
 */
export interface DailyPrizeAward {
  kind: DailyPrizeKind;
  /**
   * Whether the write that hands all of this over actually landed.
   *
   * False is a REAL state and not a defensive nicety: the prize write touches keys that
   * firestore.rules has to name (`freeWheelSpins` is the newest of them), and a rules file that has
   * not been deployed yet refuses the whole update — see docs/FIRESTORE_RULES.md. The claim itself
   * still stands in that case, because it is a different write, so the day is marked off and the
   * player is owed something they did not get.
   *
   * Everything below describes what the day WAS worth either way. The reveal reads this flag to
   * decide whether it may say 「已入袋」, because announcing a grant that was refused is the one
   * thing a celebration must never do.
   */
  saved: boolean;
  /** 金幣 banked. Paid by the server, or by the offline claim path — never by the prize write. */
  coins: number;
  /** The product the 商品碎片 went to, if any. */
  fragmentItemId: string | null;
  /** How many of them stayed on the item. */
  fragmentsKept: number;
  /** How many had nowhere to go, because the stack was full. */
  fragmentsOverflow: number;
  /** 抽獎券 minted by that overflow, on top of {@link tickets}. */
  ticketsFromOverflow: number;
  /** 抽獎券 the day itself paid. */
  tickets: number;
  cardId: UtilityCardId | null;
  /** Copies that fit under the card's own cap. 0 means the bag was already full. */
  cardsGranted: number;
  /** The product handed over, or null when the pool had nothing to give. */
  itemId: string | null;
  /** Free 輪盤 turns banked. */
  spins: number;
}

/** An award that granted nothing — what a claim reports before the prize write has run. */
export function emptyAward(kind: DailyPrizeKind): DailyPrizeAward {
  return {
    kind,
    saved: true,
    coins: 0,
    fragmentItemId: null,
    fragmentsKept: 0,
    fragmentsOverflow: 0,
    ticketsFromOverflow: 0,
    tickets: 0,
    cardId: null,
    cardsGranted: 0,
    itemId: null,
    spins: 0,
  };
}

/** The product behind an award, for whatever wants to draw its artwork. Null once retired. */
export function awardItem(itemId: string | null): ItemDefinition | null {
  return itemId ? getItemById(itemId) ?? null : null;
}
