/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 測試用覆寫 — force a shop/inventory state for a session without touching the save.
 *
 * Why this exists: the storefront has states that only appear when you do NOT own something —
 * the 購買 button, the 經驗值 lock, the rarity treatment on a card you can't have yet. Once an
 * account has bought the item those states are unreachable, and the only ways back were editing
 * the player's Firestore document by hand or the 清空裝備 admin button, which wipes every
 * purchase, every worn item and every placed piece of furniture to inspect one card.
 *
 * Read once from the URL at load:
 *
 *   ?unown=pet-dog-shiba            treat that item as never bought
 *   ?unown=pet-dog-shiba,hat-beret  several, comma separated
 *   ?rarity=item-42:epic            render that item's card on a tier it does not have
 *   ?rarity=a:epic,b:mythic         several, comma separated
 *
 * `?rarity=` exists because the top of the ladder is deliberately scarce — 神話 is one item in the
 * whole game and 史詩 is capped at 12% of the catalog — so most cards can never be seen on those
 * tiers without buying the handful that carry them. It is also the quickest way to see the purchase reveal 史詩
 * and above trigger, on an item whose price you are not about to pay.
 *
 * Deliberately NOT behind 管理員測試模式 (unlike the features in constants/adminFeatures.ts):
 * admin mode is a setting stored on the account, and reading it needs React context, while this
 * has to answer inside `getOwnedCount` — a pure function the whole app calls. It is safe to leave
 * ungated because the override can only ever take ownership AWAY. It grants nothing, it is not
 * persisted, and a player who finds it can do no more than hide their own purchases until they
 * reload. Anything that could grant an item must not be added here.
 *
 * `?rarity=` passes the same test for the same reason, and it is worth spelling out because a
 * frame that says "mythic" sounds like it ought to be worth something: it changes the card's
 * PAINT and nothing else. Price, stock, ownership, unlock conditions and what the purchase
 * actually writes are all read from constants/items.ts, which this never touches — a player who
 * puts 神話 on a 600g budgie has an expensive-looking budgie and 600g less.
 *
 * That safety argument survived rarity becoming REQUIRED on every item, and it is worth checking
 * rather than assuming, because the tier now feeds a REWARD POOL (constants/rewardPools.ts) as
 * well as a card. Pools are resolved from `ALL_ITEMS` — the catalog — and never from this
 * override, so a faked 神話 cannot move an item in or out of a pool, and cannot change what a
 * reward hands over. If that ever stops being true, this file has to be re-examined before the
 * feature that changed it ships.
 */

import { DEFAULT_RARITY, Rarity, RARITY_SPECS } from '../constants/rarity';

function readList(param: string): ReadonlySet<string> {
  // Guarded for non-browser callers — the audit scripts in scripts/ import the catalog helpers
  // under tsx, where there is no `location`.
  if (typeof window === 'undefined' || !window.location) return new Set();
  const raw = new URLSearchParams(window.location.search).get(param);
  if (!raw) return new Set();
  return new Set(raw.split(',').map(id => id.trim()).filter(Boolean));
}

/** Item ids to report as unowned this session. Empty in every normal load. */
export const UNOWNED_OVERRIDE: ReadonlySet<string> = readList('unown');

/**
 * `id:tier` pairs from `?rarity=`. Unknown tier names are dropped rather than passed through —
 * an unrecognised value would reach `RARITY_SPECS[...]` as undefined and crash the aura, and a
 * debug switch that white-screens the shop on a typo is worse than no debug switch.
 */
function readRarityPairs(): ReadonlyMap<string, Rarity> {
  const pairs = new Map<string, Rarity>();
  for (const entry of readList('rarity')) {
    const [id, tier] = entry.split(':').map(part => part.trim());
    if (id && tier && tier in RARITY_SPECS) pairs.set(id, tier as Rarity);
  }
  return pairs;
}

export const RARITY_OVERRIDE: ReadonlyMap<string, Rarity> = readRarityPairs();

/**
 * The tier a card should be painted in — the item's own, unless this session is overriding it.
 *
 * Every surface that draws a rarity goes through this rather than reading `item.rarity` directly,
 * so the override reaches the shop card, the collection list, the build rail, the dressing room
 * AND the purchase celebration from one place. Reading the field straight is the bug this exists
 * to prevent: it works, and then the one screen that did it is the one screen the override
 * silently doesn't cover.
 *
 * Returns a `Rarity`, never `undefined`. Every item in the catalog is graded now
 * (constants/rarity.ts), so 「這件商品沒有稀有度」 is no longer a state any caller has to handle —
 * which is what let every `rarity ? … : …` branch come out of the shop, the wardrobe and the build
 * rail. The parameter still accepts an OPTIONAL `rarity` so a caller holding a partially-built item
 * (a test fixture, a preview) still type-checks; it falls back to {@link DEFAULT_RARITY}.
 */
export const getItemRarity = (item: { id: string; rarity?: Rarity }): Rarity =>
  RARITY_OVERRIDE.get(item.id) ?? item.rarity ?? DEFAULT_RARITY;

/** Whether any override is active, for the on-screen notice that says so. */
export const HAS_DEBUG_OVERRIDE = UNOWNED_OVERRIDE.size > 0 || RARITY_OVERRIDE.size > 0;
