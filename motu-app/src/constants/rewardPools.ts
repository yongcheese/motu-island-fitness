/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 獎勵池 — 「這個獎勵可以發出哪些東西」, declared as RULES about items and never as a list of ids.
 *
 * This is §6 of the brief and the reason it is its own file: 每日簽到, 輪盤, 新手獎勵, 活動獎勵 and
 * 任務獎勵 all need to answer the same question, and each of them answering it separately is how a
 * game ends up with five slightly different definitions of 「稀有商品」. There is one definition
 * here, and every reward system reads it.
 *
 * It was extracted from constants/workoutRewards.ts, which owned this shape while 健身 was the only
 * system that drew items. Nothing about the semantics changed in the move — isEligibleForPool
 * applies the same checks in the same order — but the file it lives in no longer implies that
 * drawing an item is a fitness feature.
 *
 * ## Filter → Select, never Select → Check
 *
 * A pool is RESOLVED to a list before anything is drawn from it ({@link buildRewardPool}), so there
 * is no path on which a draw can produce an item the rules forbid and then have to reject it. The
 * other order is the shape that eventually hands out the thing it was supposed to exclude, because
 * the "check" is one `if` somebody forgets on the third code path.
 *
 * ## Everything here is derived from the live catalog
 *
 * Adding 「休閒帽 T」 to the shop at 180 金幣 puts it in the newbie pool automatically; re-pricing an
 * existing hat at 2,000 takes it out; grading a piece 史詩 takes it out of every pool whose ceiling
 * is below that. No edit here, and nothing in any reward system may ever say `if (itemId === ...)`.
 */

import { ALL_ITEMS, getItemById, type ItemDefinition } from './items';
import { RETIRED_ITEM_IDS } from './retiredItems';
import { RARITY_LADDER, rarityRank, type Rarity } from './rarity';
import { seedFrom, seedPick, seedUnit } from './seed';
import { getDisplayCategory } from '../utils/categoryUtils';

/**
 * An eligibility spec.
 *
 * Every field is a rule about items rather than a set of them. The four dimensions the brief names
 * — Allowed Rarity, Excluded Rarity, Category, Price Range — are all here, and a reward system
 * combines them rather than inventing a fifth.
 */
export interface RewardPool {
  id: string;
  /** Shown in 管理員測試 only. Never on a player's screen. */
  label: string;
  /**
   * Shop/display category ids (utils/categoryUtils.ts) the reward may come from — the SAME
   * taxonomy the shop, the wardrobe and the build rail read, so 「這是人物裝飾嗎」 has exactly one
   * answer in the whole app. An empty list means 「不限分類」.
   */
  categories: readonly string[];
  /** Inclusive gold ceiling. */
  maxPrice: number;
  /** Inclusive floor. A floor of 1 excludes 0-price items, which are unlocks rather than goods. */
  minPrice: number;
  /**
   * The rarest tier allowed, inclusive. `null` means 「不設上限」.
   *
   * Note what this no longer means. While rarity was opt-in, `null` was the STRICTEST setting —
   * 「只收沒有稀有度標記的普通商品」 — because an untagged card was an ordinary item and
   * `rarity: 'common'` marked the bottom rung of a specially graded shelf. Every item is graded
   * now (constants/rarity.ts), so there is no untagged state to single out, and `null` reads the
   * ordinary way round: no ceiling at all. A pool that wants only ordinary goods now says
   * `maxRarity: 'common'`.
   */
  maxRarity: Rarity | null;
  /** The least rare tier allowed, inclusive. `null` or absent means 「不設下限」. */
  minRarity?: Rarity | null;
  /**
   * Tiers refused outright, whatever the range above says.
   *
   * Not redundant with the range: a pool can legitimately want 「普通到神話，但跳過史詩」 for an
   * event, and expressing that as two pools would duplicate every other field. Absent on every
   * pool that does not need it, which is most of them.
   */
  excludeRarities?: readonly Rarity[];
  /** 經驗值解鎖 items are earned by training, never handed out. See utils/unlock.ts. */
  allowXpUnlock: boolean;
  /**
   * Skip items the player already owns, when doing so still leaves something to give.
   *
   * A duplicate wearable is a no-op in the inventory (own-once, see utils/inventory.ts), so a
   * repeat pick would read to the player as having been given nothing. It falls BACK to the full
   * pool rather than failing when everything is owned — a reward that cannot be granted is worse
   * than one the player already has.
   */
  preferUnowned: boolean;
}

const RETIRED = new Set(RETIRED_ITEM_IDS);

/**
 * Whether one catalog item satisfies a pool's rules. The single eligibility gate — the pool
 * builder, every admin preview and every test ask this one question.
 */
export function isEligibleForPool(item: ItemDefinition, pool: RewardPool): boolean {
  if (RETIRED.has(item.id)) return false;
  if (pool.categories.length > 0 && !pool.categories.includes(item.shopCategory)) return false;
  // A category that no longer exists in the taxonomy cannot be reasoned about, so it is refused
  // rather than assumed harmless — the failure mode of guessing here is handing out a sofa.
  if (!getDisplayCategory(item.shopCategory)) return false;
  if (item.price < pool.minPrice || item.price > pool.maxPrice) return false;
  if (!pool.allowXpUnlock && (item.xpUnlock ?? 0) > 0) return false;
  if (pool.maxRarity != null && rarityRank(item.rarity) > rarityRank(pool.maxRarity)) return false;
  if (pool.minRarity != null && rarityRank(item.rarity) < rarityRank(pool.minRarity)) return false;
  if (pool.excludeRarities?.includes(item.rarity)) return false;
  return true;
}

/**
 * The pool, resolved against the live catalog. Catalog order, which is stable, so a seeded pick is
 * reproducible — see {@link pickRewardFrom}.
 */
export function buildRewardPool(pool: RewardPool): ItemDefinition[] {
  return ALL_ITEMS.filter((item) => isEligibleForPool(item, pool));
}

/** What a pool currently contains, per tier. For the admin readout and for balance checks. */
export function poolRarityBreakdown(pool: RewardPool): Record<Rarity, number> {
  const counts = Object.fromEntries(RARITY_LADDER.map((r) => [r, 0])) as Record<Rarity, number>;
  for (const item of buildRewardPool(pool)) counts[item.rarity] += 1;
  return counts;
}

// --- Choosing one ------------------------------------------------------------

/**
 * A small deterministic hash, so a pick can be reproduced from the event that caused it.
 *
 * `Math.random()` would work exactly once: on a retry it would choose a DIFFERENT item, so a grant
 * that was written but whose confirmation was lost could not be recognised as the same grant.
 * Seeding on the event id makes the choice a function of the event, which is what lets the write
 * path be replayed safely.
 *
 * Moved to constants/seed.ts and re-exported here, unchanged. It had been copied a second time into
 * constants/fragments.ts and was about to be copied a third time into the daily-login prize roll;
 * two hashes that are supposed to agree and do not is a board that previews one prize and a claim
 * that pays another. Re-exported rather than relocated at the call sites because every existing
 * importer says `from './rewardPools'` and none of them is wrong to.
 */
export { seedFrom, seedUnit, seedPick };

/**
 * Picks one item from an already-filtered list.
 *
 * The order is Filter → Select, never Select → Check: by the time anything reaches here the list
 * contains only items the rules allow.
 */
export function pickRewardFrom(items: readonly ItemDefinition[], seed: number): ItemDefinition | null {
  if (items.length === 0) return null;
  return items[seed % items.length];
}

// --- Weighted choice ---------------------------------------------------------

/**
 * 加權隨機 — one implementation, for every table in the game that has to pick 「常見的東西比較常
 * 出現」.
 *
 * The 輪盤 (constants/wheelRewards.ts) draws its prize with this, and the 限時商店
 * (constants/limitedShop.ts) picks which products go on sale with it. Both used to be described in
 * the brief as 「不要散落的 if / else 或 Math.random() > 0.9」, and this is what replaces that: a
 * table of `{ value, weight }` and one function that reads it. A rarer outcome is a smaller number
 * in a data row — never a nested condition, and never a threshold typed into a component.
 *
 * Seeded, exactly like {@link pickRewardFrom} and for the same reason: a draw has to be a function
 * of the EVENT that caused it. `Math.random()` inside a React tree re-rolls on every re-render, so
 * a spinning wheel would land on a different prize each time its parent re-rendered — the failure
 * §19 of the brief asks to be tested for. Seed on the spin id and the answer is fixed the moment
 * the spin exists.
 */
export interface Weighted<T> {
  value: T;
  /** Relative likelihood. Zero or negative means 「never」, and is skipped rather than clamped. */
  weight: number;
}

/** Total of the positive weights. Zero when nothing in the table can be drawn. */
export function totalWeight<T>(entries: readonly Weighted<T>[]): number {
  return entries.reduce((sum, entry) => sum + (entry.weight > 0 ? entry.weight : 0), 0);
}

/** One entry's probability, 0…1. What an odds readout and the tests both ask. */
export function weightedChance<T>(entries: readonly Weighted<T>[], value: T): number {
  const total = totalWeight(entries);
  if (total <= 0) return 0;
  const weight = entries.find((entry) => entry.value === value)?.weight ?? 0;
  return weight > 0 ? weight / total : 0;
}

/**
 * `seedUnit` — a deterministic 0…1 from a seed, for the callers that need a NUMBER rather than a
 * table entry. It lives in constants/seed.ts with the hash and is re-exported above.
 *
 * The 限時商店 rolls a bundle's size and its price this way (constants/limitedShopRotation.ts).
 * Those are the same kind of decision a prize draw is and must obey the same rule: seeded on the
 * event, never on `Math.random()`, so re-opening the shop, reloading the page or re-rendering the
 * component cannot produce a second answer. A shop whose price changed on refresh is the exact
 * failure that function exists to make unrepresentable.
 */

/**
 * A deterministic whole number in `[min, max]`, inclusive at both ends.
 *
 * Inclusive of `max` because every caller so far is a COUNT the designer wrote down — 「2 到 4
 * 張」 means four is possible — and an exclusive ceiling is the off-by-one that quietly makes the
 * top of a stated range unreachable.
 */
export function seedIntInRange(seed: number, min: number, max: number): number {
  const lo = Math.min(Math.round(min), Math.round(max));
  const hi = Math.max(Math.round(min), Math.round(max));
  if (hi <= lo) return lo;
  return lo + Math.min(hi - lo, Math.floor(seedUnit(seed) * (hi - lo + 1)));
}

/** Picks one entry, in table order, by weight. Null only when nothing has a positive weight. */
export function pickWeighted<T>(entries: readonly Weighted<T>[], seed: number): T | null {
  const total = totalWeight(entries);
  if (total <= 0) return null;

  let target = seedUnit(seed) * total;
  for (const entry of entries) {
    if (entry.weight <= 0) continue;
    target -= entry.weight;
    if (target < 0) return entry.value;
  }
  // Floating-point drift only — the last positive entry is the correct answer here.
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].weight > 0) return entries[i].value;
  return null;
}

/**
 * Picks up to `count` DISTINCT entries, by weight, without replacement.
 *
 * What a shop rotation needs and a single pick cannot express: 「這一檔挑三樣，不要重複」. Each
 * round re-seeds off the caller's seed and the round index, so the whole draw stays a pure function
 * of one seed — the same seed always produces the same shelf, which is what makes every player see
 * the same limited shop without a server telling them what it is.
 */
export function pickWeightedMany<T>(
  entries: readonly Weighted<T>[],
  count: number,
  seed: number,
): T[] {
  const pool = entries.filter((entry) => entry.weight > 0);
  const picked: T[] = [];
  for (let round = 0; round < count && pool.length > 0; round++) {
    const choice = pickWeighted(pool, seedFrom(`${seed}:${round}`));
    if (choice === null) break;
    picked.push(choice);
    const index = pool.findIndex((entry) => entry.value === choice);
    if (index >= 0) pool.splice(index, 1);
  }
  return picked;
}

/** What a resolution produced, or why it produced nothing. */
export type RewardDraw =
  | { ok: true; item: ItemDefinition; poolSize: number; fromOwnedFallback: boolean }
  | { ok: false; reason: 'empty-pool' };

/**
 * The whole selection flow for one grant: build the pool, drop what the player already owns, draw.
 *
 * Takes the owned ids rather than a profile so it stays pure and testable — the service passes
 * `profile.inventory`, a test passes whatever case it is pinning.
 */
export function drawReward(
  pool: RewardPool,
  ownedItemIds: readonly string[],
  seed: number,
): RewardDraw {
  const all = buildRewardPool(pool);
  if (all.length === 0) return { ok: false, reason: 'empty-pool' };

  const owned = new Set(ownedItemIds);
  const fresh = pool.preferUnowned ? all.filter((item) => !owned.has(item.id)) : all;
  const candidates = fresh.length > 0 ? fresh : all;

  const item = pickRewardFrom(candidates, seed);
  if (!item) return { ok: false, reason: 'empty-pool' };
  return { ok: true, item, poolSize: candidates.length, fromOwnedFallback: fresh.length === 0 };
}

// --- The pools themselves ----------------------------------------------------

/**
 * The newbie ceiling, in 金幣.
 *
 * Anchored to the economy rather than picked: a short prototype workout pays roughly 8–16 金幣
 * (constants/workoutRewards.ts), so 300 is a couple of dozen sessions' worth of the game's only
 * income. That is the right size for 「第一次健身」 — enough to be a real item the player can put on
 * immediately, small enough that it cannot short-circuit anything they were saving for. It also
 * lands the pool squarely on the cheap end of the wardrobe: 上衣 100–250, 帽子 120–300,
 * 髮型 150–300, 草裙 50, 涼鞋 250, 復古墨鏡 120.
 *
 * Raising it is a one-line change AND a real design decision: at 500 the pool swallows most of the
 * mid-priced wardrobe, and 「新手小禮物」 stops being small.
 */
export const NEWBIE_PRICE_CEILING = 300;

/**
 * 新手小禮物 — low-price, ordinary wearables and nothing else.
 *
 * The categories are the ones the brief names (上衣 / 下裝 / 配件 / 帽子 / 鞋子) plus 髮型, which is
 * the same kind of thing at the same prices. Everything else in the catalog is excluded BY
 * CONSTRUCTION rather than by a list of exceptions:
 *
 *  - 特殊飾品 (`SpecialFx`) — the game's premium cosmetics, none under 600. Not in `categories`.
 *  - 寵物 and 寵物飾品 — companions, not decorations, and 480+.
 *  - Furniture, 藝術品, 房屋外觀, 地板/牆面 — not worn, and several are four figures.
 *  - Anything above 普通 or earned — caught by `maxRarity` and `allowXpUnlock: false` even if it
 *    were somehow cheap enough and in one of these categories.
 *
 * `maxRarity: 'common'` is what the old `maxRarity: null` used to mean, back when 「no rarity
 * field」 was how an ordinary item was spelled. Every item is graded now, so the intent —
 * 「只發普通商品」 — has to be said with the tier's own name. See {@link RewardPool.maxRarity}.
 */
export const NEWBIE_REWARD_POOL: RewardPool = {
  id: 'newbie-basics',
  label: '新手小物（低價人物裝飾）',
  categories: ['Tops', 'Bottoms', 'Hats', 'Shoes', 'Accessories', 'Hair'],
  maxPrice: NEWBIE_PRICE_CEILING,
  minPrice: 1,
  maxRarity: 'common',
  allowXpUnlock: false,
  preferUnowned: true,
};

/**
 * Every pool in the game, so an admin panel can list them and a rule can name one.
 *
 * One entry today. 輪盤 and 活動獎勵 add rows here when they are built — a pool is data, and a new
 * reward system that needs 「稀有以上的家具」 writes a row rather than a filter of its own.
 */
export const REWARD_POOLS: readonly RewardPool[] = [NEWBIE_REWARD_POOL];

export function getRewardPool(poolId: string): RewardPool | undefined {
  return REWARD_POOLS.find((pool) => pool.id === poolId);
}

/** The item behind a recorded grant, for an admin readout. Null once that item has been retired. */
export function getPoolItem(itemId: string | null | undefined): ItemDefinition | null {
  return itemId ? getItemById(itemId) ?? null : null;
}
