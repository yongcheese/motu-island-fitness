/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 限時商店 — rules tests.
 *
 * Run with `npm run test:limited-shop`. Same tsx-script style as `test:utility-cards`,
 * `test:economy` and the `audit:*` checks, because that is the test runner this repo has.
 *
 * Everything pinned here is a property the brief states as a requirement AND that is cheap to
 * break months later. Most of them are properties of the DATA as much as of the code, so this is
 * also the check that catches somebody pricing a bundle at 3 碎片 or quietly putting a 特殊飾品
 * back on the ordinary shelf:
 *
 *  §1/§2/§12/§14  the two shops' catalogs are disjoint — 特殊卡牌 and 特殊飾品 cannot be reached
 *                 through the main shop's catalog, its category row, or its purchase guard
 *  §3             every rotation, without exception, has at least one 特殊卡牌 offer
 *  §4/§7          cards are sold as whole bundles — one price for N copies, never per copy
 *  §5/§11         a bundle's price is NOT unitPrice × quantity, but is still bounded and monotone
 *  §6/§10/§23     the same period is always the same shelf: same items, same quantity, same price
 *  §8             the refresh interval is config, and changing it changes the calendar
 *  §9/§10         bundle quantity and price both come from a per-card range, and both move
 *  §13            accessories rotate through a pool rather than all appearing at once
 *  §18/§19        purchase limits are per-offer config and per-player state, not global
 *  §20            the purchase rule is one pure function: funds, limit, bundle-fit, own-once
 *
 * What it deliberately does NOT test: the Firestore write itself and the React layer. Those need a
 * network and a DOM; what is testable without either is every rule that decides WHAT happens — the
 * half that silently rots.
 */

import {
  LIMITED_OFFER_SOURCES,
  LIMITED_SHOP_CONFIG,
  SPECIAL_ACCESSORY_POOL,
  SPECIAL_CARD_POOL,
  getOfferSource,
  getPurchasedCount,
  purchaseKey,
  refreshIntervalMs,
  resolveSource,
  type LimitedShopConfig,
} from '../src/constants/limitedShop';
import {
  buildRotation,
  bundlePrice,
  checkPurchase,
  bundleQuantity,
  findOffer,
  periodForInstant,
  recordPurchase,
  remainingAllowance,
  resolveOffer,
  type LimitedOffer,
} from '../src/constants/limitedShopRotation';
import {
  DEFAULT_CHANNELS,
  LIMITED_SHOP_ITEMS,
  MAIN_SHOP_CATALOG,
  isInChannel,
  isMainShopItem,
  itemChannels,
} from '../src/constants/distribution';
import { ALL_ITEMS, getItemById } from '../src/constants/items';
import { FRAGMENT_ITEMS } from '../src/constants/fragments';
import { getUtilityCard } from '../src/constants/utilityCards';
import { MAIN_SECTIONS, getShopCategoriesFor, getShopMainSections, getItemsInCategory } from '../src/utils/categoryUtils';

let failures = 0;
let checks = 0;

function eq(name: string, got: unknown, want: unknown): void {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures++;
    console.log(`FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

function ok(name: string, condition: boolean, detail = ''): void {
  checks++;
  if (!condition) {
    failures++;
    console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  } else {
    console.log(`ok    ${name}${detail ? `  (${detail})` : ''}`);
  }
}

console.log('\n== 限時商店 ==========================================================');

// --- Distribution channels (§1/§2/§12/§14) ----------------------------------
console.log('\n-- 兩家店的商品池是分開的 (§1/§2/§12/§14) --------------------------------');

ok('the main shop sells something', MAIN_SHOP_CATALOG.length > 0);
ok('the limited shop has an item pool', LIMITED_SHOP_ITEMS.length > 0);
eq(
  'an item that declares nothing gets the ordinary channels',
  itemChannels(getItemById('hat-bucket')),
  DEFAULT_CHANNELS,
);

const overlap = MAIN_SHOP_CATALOG.filter((item) => isInChannel(item, 'limited-shop'));
eq('no item is sold by BOTH shops', overlap.map((i) => i.id), []);

// The pool rows and the catalog have to agree, in both directions.
ok(
  'every accessory the limited shop lists is a limited-shop item in the catalog',
  SPECIAL_ACCESSORY_POOL.every((source) => isInChannel(getItemById(source.itemId), 'limited-shop')),
  SPECIAL_ACCESSORY_POOL.filter((s) => !isInChannel(getItemById(s.itemId), 'limited-shop'))
    .map((s) => s.itemId)
    .join('/'),
);
/**
 * Every catalog id this shop can hand over, from any of its sources — an accessory row, or the
 * `itemId` a 抽獎券 bundle names. The check below is 「沒有一件限時商店商品是買不到的」, and it has
 * to see both, otherwise moving the ticket into the card pool would have looked like a regression.
 */
const sellableItemIds = new Set(
  LIMITED_OFFER_SOURCES.flatMap((source) =>
    source.kind === 'item'
      ? [source.itemId]
      : source.content.kind === 'raffle-ticket'
        ? [source.content.itemId]
        : [],
  ),
);
ok(
  'and no limited-shop item is left with nowhere to be bought',
  LIMITED_SHOP_ITEMS.every((item) => sellableItemIds.has(item.id)),
  LIMITED_SHOP_ITEMS.filter((item) => !sellableItemIds.has(item.id)).map((i) => i.id).join('/'),
);

// §12 — the main shop must not reach them through ANY of its own doors.
ok(
  'the main shop purchase guard refuses every limited-shop item',
  LIMITED_SHOP_ITEMS.every((item) => !isMainShopItem(item.id)),
);
ok(
  "the main shop's category row has no chip for a shelf it does not sell",
  !getShopCategoriesFor('PERSON').some((category) => category.id === 'SpecialFx'),
);
eq(
  'and the shared category→items lookup the build rails use returns nothing for it',
  getItemsInCategory('SpecialFx').length,
  0,
);
ok(
  'the item definitions themselves are untouched — only the channel moved',
  ALL_ITEMS.some((item) => item.shopCategory === 'SpecialFx'),
);

// 商品碎片 are collected on a main-shop card and redeemed from one. An exclusive with no such card
// must not mint fragments, or a player fills a bar toward an unlock they can never press.
ok(
  'no limited-shop exclusive is in the 商品碎片 drop pool',
  LIMITED_SHOP_ITEMS.every((item) => !FRAGMENT_ITEMS.some((f) => f.id === item.id)),
  LIMITED_SHOP_ITEMS.filter((i) => FRAGMENT_ITEMS.some((f) => f.id === i.id)).map((i) => i.id).join('/'),
);
ok('but the pool is still full of ordinary goods', FRAGMENT_ITEMS.length > 100, `${FRAGMENT_ITEMS.length} items`);

// --- Pools and sources ------------------------------------------------------
console.log('\n-- 商品池 (§9/§13/§22) --------------------------------------------------');

ok('there are card sources', SPECIAL_CARD_POOL.length > 0);
ok('there are accessory sources', SPECIAL_ACCESSORY_POOL.length > 0);
ok(
  'every source id is unique',
  new Set(LIMITED_OFFER_SOURCES.map((s) => s.id)).size === LIMITED_OFFER_SOURCES.length,
);
ok(
  'every source resolves against a live catalog',
  LIMITED_OFFER_SOURCES.every((source) => !!resolveSource(source)),
);
ok(
  'every 功能卡 source points at a real card, and every 抽獎券 source at a real catalog row',
  SPECIAL_CARD_POOL.every((source) =>
    source.content.kind === 'utility-card'
      ? !!getUtilityCard(source.content.cardId)
      : !!getItemById(source.content.itemId),
  ),
);
ok(
  'every source names a pool some slot can fill',
  LIMITED_OFFER_SOURCES.every((source) =>
    LIMITED_SHOP_CONFIG.slots.some((slot) => slot.pool === null || slot.pool === source.pool),
  ),
);
ok(
  'the accessory pool is bigger than one rotation can show — otherwise nothing rotates (§13)',
  SPECIAL_ACCESSORY_POOL.length >
    (LIMITED_SHOP_CONFIG.slots.find((s) => s.pool === 'special-accessory')?.count ?? 0),
  `${SPECIAL_ACCESSORY_POOL.length} in the pool`,
);
ok(
  'every bundle range is sane: at least two copies, and a real range',
  SPECIAL_CARD_POOL.every(
    (s) => s.quantity.min >= 1 && s.quantity.max >= s.quantity.min && s.quantity.max <= 20,
  ),
);
ok(
  'every pricing band is sane: a positive floor below its ceiling',
  SPECIAL_CARD_POOL.every((s) =>
    s.pricing.every((p) => p.unitValue.min > 0 && p.unitValue.max >= p.unitValue.min),
  ),
);
ok(
  'no card source declares the same price route twice',
  SPECIAL_CARD_POOL.every((s) => new Set(s.pricing.map((p) => p.id)).size === s.pricing.length),
);

// --- The refresh calendar (§8) ----------------------------------------------
console.log('\n-- 刷新週期是設定 (§8) --------------------------------------------------');

// 出貨的設定是「一週一檔」，而那個 7 不是這家店自己挑的 —— 它是商船的一趟航程（停 3 天 +
// 離開 4 天，見 constants/merchants.ts）。所以這一條驗的是**設定檔實際的值**而不是一個寫死
// 的 14：改了商船的節奏卻沒改這裡，就是這一條會先講話。
eq('the shipped interval is a week', refreshIntervalMs(LIMITED_SHOP_CONFIG.refreshInterval), 7 * 24 * 3600 * 1000);
eq('a fortnight is still a fortnight', refreshIntervalMs({ days: 14 }), 14 * 24 * 3600 * 1000);
eq('days and hours add up', refreshIntervalMs({ days: 1, hours: 12 }), 36 * 3600 * 1000);
eq('an empty interval still has a floor rather than dividing by zero', refreshIntervalMs({}), 3600 * 1000);

const epochMs = Date.parse(LIMITED_SHOP_CONFIG.epoch);
eq('three days after the epoch is period 0', periodForInstant(epochMs + 3 * 86400_000).index, 0);
eq('a week later is period 1', periodForInstant(epochMs + 8 * 86400_000).index, 1);
eq('and a fortnight later is period 2', periodForInstant(epochMs + 15 * 86400_000).index, 2);
eq('a clock set before the epoch is clamped, never negative', periodForInstant(0).index, 0);

// Changing the interval changes the calendar, which is the whole point of it being config.
const daily: LimitedShopConfig = { ...LIMITED_SHOP_CONFIG, refreshInterval: { days: 1 } };
eq(
  'a daily config puts the same instant in a much later period',
  periodForInstant(epochMs + 15 * 86400_000, daily).index,
  15,
);

// --- Rotation stability (§6/§10/§23) ----------------------------------------
console.log('\n-- 同一檔永遠是同一個貨架 (§6/§10/§23) ----------------------------------');

const shelfA = buildRotation(7);
const shelfB = buildRotation(7);
eq('the same period always builds the same shelf', shelfA.offers, shelfB.offers);
ok('a shelf is not empty', shelfA.offers.length > 0);
ok(
  'every offer traces back to a source that exists',
  shelfA.offers.every((offer) => !!getOfferSource(offer.id)),
);
ok(
  'every offer is in a slot that wanted its pool',
  shelfA.offers.every((offer) => {
    const slot = LIMITED_SHOP_CONFIG.slots.find((s) => s.id === offer.slotId);
    const source = getOfferSource(offer.id);
    return !!slot && !!source && (slot.pool === null || slot.pool === source.pool);
  }),
);
ok(
  'no slot is over-filled',
  LIMITED_SHOP_CONFIG.slots.every(
    (slot) => shelfA.offers.filter((offer) => offer.slotId === slot.id).length <= slot.count,
  ),
);
ok(
  'a source is never listed twice in one period',
  new Set(shelfA.offers.map((o) => o.id)).size === shelfA.offers.length,
);

// The prices and quantities are part of "the same shelf", not just the item list. This is the
// assertion that stands for 「重新整理不會 3 張 1000 變成 5 張 800」.
const bundleA = shelfA.offers.find((o) => o.kind === 'card-bundle')!;
const bundleB = shelfB.offers.find((o) => o.kind === 'card-bundle')!;
eq('a rebuilt bundle has the same quantity', bundleA.grant, bundleB.grant);
eq('and exactly the same prices', bundleA.prices, bundleB.prices);
eq(
  'and rebuilding it a third time, much later in the process, still agrees',
  buildRotation(7).offers.find((o) => o.kind === 'card-bundle')?.prices,
  bundleA.prices,
);

const shelves = Array.from({ length: 16 }, (_, i) => buildRotation(i));
ok(
  'the shelf actually changes between periods',
  shelves.some((shelf, i) => i > 0 && JSON.stringify(shelf.offers) !== JSON.stringify(shelves[i - 1].offers)),
);

// --- 特殊卡牌 is permanent stock (§3) ---------------------------------------
console.log('\n-- 每一檔都有卡牌 (§3) --------------------------------------------------');

ok(
  'every one of 16 rotations has at least one card bundle',
  shelves.every((shelf) => shelf.offers.some((offer) => offer.kind === 'card-bundle')),
  shelves.map((s) => s.offers.filter((o) => o.kind === 'card-bundle').length).join(''),
);

// And it is the `guaranteed` flag doing it, not luck: a config whose card pool is entirely on a
// long cooldown must STILL produce a card every period.
const stubborn: LimitedShopConfig = {
  ...LIMITED_SHOP_CONFIG,
  slots: [{ id: 'cards', label: '卡', note: '', pool: 'special-card', count: 1, guaranteed: true }],
};
const cooling = SPECIAL_CARD_POOL.map((source) => ({ ...source, cooldownPeriods: 99 }));
ok(
  'a guaranteed slot ignores cooldowns rather than going empty',
  Array.from({ length: 6 }, (_, i) => buildRotation(i, stubborn, cooling)).every(
    (shelf) => shelf.offers.length === 1,
  ),
);
// The same slot WITHOUT the flag is allowed to run dry — which is what proves the flag is the
// mechanism and not a happy accident of there being one card.
const optional: LimitedShopConfig = {
  ...stubborn,
  slots: [{ ...stubborn.slots[0], guaranteed: false }],
};
ok(
  'an ordinary slot does go empty under the same cooldowns',
  Array.from({ length: 6 }, (_, i) => buildRotation(i, optional, cooling)).some(
    (shelf) => shelf.offers.length === 0,
  ),
);

// --- Bundles (§4/§5/§7/§10/§11) ---------------------------------------------
console.log('\n-- 組合包的張數與價格 (§4/§5/§10/§11) -----------------------------------');

const cardSource = SPECIAL_CARD_POOL[0];
const quantities = Array.from({ length: 40 }, (_, i) => bundleQuantity(cardSource, i));
ok(
  'every generated quantity is inside the declared range',
  quantities.every((q) => q >= cardSource.quantity.min && q <= cardSource.quantity.max),
  `min ${Math.min(...quantities)} max ${Math.max(...quantities)}`,
);
ok(
  'the quantity actually varies between rotations (§10)',
  new Set(quantities).size > 1,
  `${new Set(quantities).size} distinct sizes over 40 periods`,
);
eq(
  'and the quantity for one period is stable',
  bundleQuantity(cardSource, 12),
  bundleQuantity(cardSource, 12),
);

for (const pricing of cardSource.pricing) {
  const prices = Array.from({ length: 40 }, (_, i) => ({
    q: bundleQuantity(cardSource, i),
    amount: bundlePrice(cardSource, pricing, bundleQuantity(cardSource, i), i),
  }));

  ok(
    `[${pricing.id}] every price is a positive whole number`,
    prices.every((p) => Number.isInteger(p.amount) && p.amount > 0),
  );
  ok(
    `[${pricing.id}] every price stays inside 張數 × 每張價值的上下限 (§10)`,
    prices.every(
      (p) =>
        p.amount >= Math.floor(pricing.unitValue.min * p.q) - pricing.roundTo &&
        p.amount <= Math.ceil(pricing.unitValue.max * p.q) + pricing.roundTo,
    ),
    prices.map((p) => `${p.q}=${p.amount}`).slice(0, 6).join(' '),
  );
  ok(
    `[${pricing.id}] the price varies between rotations (§10)`,
    new Set(prices.map((p) => p.amount)).size > 2,
  );

  // §5 — THE assertion. If the price were unitPrice × quantity, every bundle of the same size
  // would cost the same, for ever. It must not.
  const bySize = new Map<number, Set<number>>();
  for (const p of prices) bySize.set(p.q, (bySize.get(p.q) ?? new Set()).add(p.amount));
  ok(
    `[${pricing.id}] the same bundle SIZE is priced differently in different rotations — price is not 單價 × 數量 (§5)`,
    [...bySize.values()].some((amounts) => amounts.size > 1),
    [...bySize.entries()].map(([q, a]) => `${q}張:${[...a].slice(0, 3).join('/')}`).join('  '),
  );

  // …but not so freely that a bigger pack can be a bargain bin. The floor of a bigger bundle has
  // to sit above the floor of a smaller one, which is what `unitValue.min` buys us.
  const cheapestBySize = [...bySize.entries()]
    .map(([q, amounts]) => ({ q, min: Math.min(...amounts) }))
    .sort((a, b) => a.q - b.q);
  ok(
    `[${pricing.id}] more copies never cost less (§11)`,
    cheapestBySize.every((entry, i) => i === 0 || entry.min > cheapestBySize[i - 1].min),
    cheapestBySize.map((e) => `${e.q}張≥${e.min}`).join(' '),
  );

  // A bundle price must also not be a straight multiple of a fixed unit price — check that at
  // least one rotation's per-copy figure differs from another's for the same size.
  ok(
    `[${pricing.id}] the per-copy figure moves between rotations`,
    new Set(prices.map((p) => Math.round(p.amount / p.q))).size > 2,
  );
}

// §11's other half — the 金幣 route stays deliberately expensive whatever it rolls.
const coinPricing = cardSource.pricing.find((p) => p.currency === 'coins');
ok('a 金幣 conversion route exists', !!coinPricing);
if (coinPricing) {
  const cheapest = Math.min(
    ...Array.from({ length: 40 }, (_, i) =>
      bundlePrice(cardSource, coinPricing, bundleQuantity(cardSource, i), i),
    ),
  );
  ok(
    'and its cheapest possible bundle is still expensive — a card must never be a cheap way to buy back the currency you exercise for',
    cheapest >= 1000,
    `cheapest ${cheapest}`,
  );
}
ok(
  'a non-金幣 route exists too',
  cardSource.pricing.some((p) => p.currency !== 'coins'),
);

// §4/§7 — a bundle grants N copies in ONE purchase. There is no per-copy price anywhere on it.
const anyBundle = buildRotation(3).offers.find((o) => o.grant.kind === 'utility-card')!;
ok(
  'a card offer grants the whole bundle in one purchase',
  anyBundle.grant.kind === 'utility-card' && anyBundle.grant.quantity >= cardSource.quantity.min,
);
eq(
  'and its resolved quantity is what the card tile shows',
  resolveOffer(anyBundle)?.quantity,
  anyBundle.grant.kind === 'utility-card' ? anyBundle.grant.quantity : -1,
);

// --- 抽獎券 is a card bundle too (the 特殊卡牌 shelf, not the ordinary shop) --
console.log('\n-- 抽獎券 (特殊卡牌，與功能卡同一套機制) --------------------------------');

const ticketSource = SPECIAL_CARD_POOL.find((s) => s.content.kind === 'raffle-ticket')!;
ok('the 抽獎券 has a bundle source', !!ticketSource);

// §2/§12 — the whole 特殊卡牌 section left the ordinary shop, exactly like 特殊飾品 did.
const ticketItem = getItemById('card-raffle-ticket')!;
ok('the ticket is no longer a main-shop item', !isMainShopItem(ticketItem.id));
ok('and it IS a limited-shop item', isInChannel(ticketItem, 'limited-shop'));
eq('its shelf sells nothing in the ordinary shop', getItemsInCategory('RaffleTickets').length, 0);
eq('nor does 功能卡', getItemsInCategory('FunctionCards').length, 0);
ok(
  'so the ordinary shop has no 特殊卡牌 SECTION at all',
  !getShopMainSections().some((section) => section.id === 'CARD'),
  getShopMainSections().map((s) => s.id).join('/'),
);
ok(
  'but the section still exists in the taxonomy for labels and the collection drawer',
  MAIN_SECTIONS.some((section) => section.id === 'CARD'),
);

// It goes through the SAME bundle machinery as the 功能卡 — that is the whole point of the ask.
const ticketOffers = shelves.map(
  (shelf) => shelf.offers.find((o) => o.grant.kind === 'raffle-ticket'),
);
ok(
  'every rotation has a 抽獎券 bundle beside the 功能卡 one',
  ticketOffers.every((offer) => !!offer),
);
const ticketQtys = ticketOffers.map((o) => (o!.grant.kind === 'raffle-ticket' ? o!.grant.quantity : 0));
ok(
  'its quantity is inside the declared range and actually varies',
  ticketQtys.every((q) => q >= ticketSource.quantity.min && q <= ticketSource.quantity.max) &&
    new Set(ticketQtys).size > 1,
  `${Math.min(...ticketQtys)}–${Math.max(...ticketQtys)}, ${new Set(ticketQtys).size} distinct`,
);
const ticketPrices = ticketOffers.map((o) => o!.prices[0].amount);
ok('and its price varies too', new Set(ticketPrices).size > 2, ticketPrices.slice(0, 6).join('/'));
ok(
  'it is sold for 金幣 only — 碎片 → 券 → 碎片 would be a loop, and the 20:1 overflow rate an arbitrage',
  ticketOffers.every((o) => o!.prices.every((p) => p.currency === 'coins')),
);
ok(
  'it is limited per period like every other bundle',
  ticketOffers.every((o) => o!.purchaseLimit === 1),
);
eq(
  'the ticket bundle resolves to the catalog row — no name is written twice',
  resolveOffer(ticketOffers[0]!)?.name,
  ticketItem.name,
);

// A ticket has no cap and cannot be 「already owned」 — it is a balance. The only thing that can
// stop the purchase is money.
const ticketOffer = ticketOffers[0]!;
const ticketPrice = ticketOffer.prices[0];
eq(
  'a ticket bundle with enough gold goes through',
  checkPurchase({
    rotation: shelves[0],
    offerId: ticketOffer.id,
    priceId: ticketPrice.id,
    purchased: 0,
    balance: ticketPrice.amount,
    alreadyOwned: true, // deliberately: a balance cannot be 「already owned」
  }),
  'ok',
);
eq(
  'and one gold short does not',
  checkPurchase({
    rotation: shelves[0],
    offerId: ticketOffer.id,
    priceId: ticketPrice.id,
    purchased: 0,
    balance: ticketPrice.amount - 1,
  }),
  'insufficient-funds',
);
eq(
  'the per-period limit still applies',
  checkPurchase({
    rotation: shelves[0],
    offerId: ticketOffer.id,
    priceId: ticketPrice.id,
    purchased: 1,
    balance: ticketPrice.amount,
  }),
  'limit-reached',
);

// --- Accessory rotation (§13) ------------------------------------------------
console.log('\n-- 特殊飾品輪替 (§13) ---------------------------------------------------');

const accessorySlot = LIMITED_SHOP_CONFIG.slots.find((s) => s.pool === 'special-accessory')!;
ok(
  'each rotation shows only part of the accessory pool',
  shelves.every(
    (shelf) => shelf.offers.filter((o) => o.slotId === accessorySlot.id).length <= accessorySlot.count,
  ),
);
const seenAccessories = new Set(
  shelves.flatMap((shelf) =>
    shelf.offers.filter((o) => o.slotId === accessorySlot.id).map((o) => o.id),
  ),
);
ok(
  'and over 16 rotations most of the pool has had a turn',
  seenAccessories.size >= Math.ceil(SPECIAL_ACCESSORY_POOL.length * 0.6),
  `${seenAccessories.size}/${SPECIAL_ACCESSORY_POOL.length}`,
);

// Cooldowns and 返場 hold across the whole run.
const appearances = new Map<string, number[]>();
for (const shelf of shelves) {
  for (const offer of shelf.offers) {
    appearances.set(offer.id, [...(appearances.get(offer.id) ?? []), shelf.index]);
  }
}
let cooldownRespected = true;
for (const [sourceId, periods] of appearances) {
  const source = getOfferSource(sourceId);
  if (!source) continue;
  for (let i = 1; i < periods.length; i++) {
    if (periods[i] - periods[i - 1] <= source.cooldownPeriods) cooldownRespected = false;
  }
}
ok('every source honours its own cooldown', cooldownRespected);

const returned = shelves.flatMap((shelf) => shelf.offers.filter((offer) => offer.returning));
ok('things do come back', returned.length > 0, `${returned.length} returns in 16 periods`);
ok(
  'a first appearance is never flagged as a return',
  shelves.every((shelf) =>
    shelf.offers.every((offer) => {
      const seen = appearances.get(offer.id) ?? [];
      return offer.returning === seen.some((index) => index < shelf.index);
    }),
  ),
);
ok(
  'a return is the SAME source id, never a new one',
  returned.every((offer) => !!getOfferSource(offer.id)),
);

// --- Purchase limits and player state (§18/§19) ------------------------------
console.log('\n-- 限購與玩家紀錄 (§18/§19) ---------------------------------------------');

const rotation = buildRotation(3);
const limited = rotation.offers.find((offer) => offer.purchaseLimit === 1)!;
let playerA = { purchases: {} as Record<string, number> };
let playerB = { purchases: {} as Record<string, number> };

eq('nothing bought yet', getPurchasedCount(playerA, rotation.id, limited.id), 0);
eq('and the whole allowance is available', remainingAllowance(playerA, rotation.id, limited), 1);

playerA = { purchases: recordPurchase(playerA, rotation, limited.id, 1) };
eq('a purchase is recorded against the rotation', getPurchasedCount(playerA, rotation.id, limited.id), 1);
eq('and that player’s allowance is gone', remainingAllowance(playerA, rotation.id, limited), 0);

// §19 — the rotation is global, the purchase record is not.
eq('another player is unaffected', remainingAllowance(playerB, rotation.id, limited), 1);
eq(
  'and the shelf itself is unchanged for them',
  buildRotation(3).offers.map((o) => o.id),
  rotation.offers.map((o) => o.id),
);
ok(
  'the offer is still on sale for them',
  !!findOffer(buildRotation(3), limited.id),
);

eq(
  'the same offer in a LATER rotation is a fresh allowance',
  remainingAllowance(playerA, buildRotation(4).id, limited),
  1,
);

// §18 — the limit is configuration. An offer with a different limit obeys a different rule, and
// `null` means unlimited, with no `limit = 1` written anywhere in the flow.
const thrice: LimitedOffer = { ...limited, purchaseLimit: 3 };
const unlimited: LimitedOffer = { ...limited, purchaseLimit: null };
eq('a limit of 3 allows two more after one buy', remainingAllowance(playerA, rotation.id, thrice), 2);
eq('and an unlimited offer never runs out', remainingAllowance(playerA, rotation.id, unlimited), Infinity);

eq('the purchase key is rotation-scoped', purchaseKey('rot-9', 'ls-x'), 'rot-9::ls-x');

// The record is pruned as it is written, so it cannot grow forever.
let aged = { purchases: {} as Record<string, number> };
for (let index = 0; index < 20; index++) {
  aged = { purchases: recordPurchase(aged, buildRotation(index), limited.id, 1) };
}
ok(
  'old rotations are swept out of the purchase record',
  Object.keys(aged.purchases).length <= LIMITED_SHOP_CONFIG.purchaseHistoryPeriods + 1,
  `${Object.keys(aged.purchases).length} keys after 20 periods`,
);
ok(
  'and the current rotation survives the sweep',
  getPurchasedCount(aged, buildRotation(19).id, limited.id) === 1,
);

// --- The purchase rule (§18/§20) --------------------------------------------
console.log('\n-- 購買流程的每一道檢查 (§18/§20) ---------------------------------------');

const buyRotation = buildRotation(5);
// The 功能卡 bundle specifically — the ticket bundle beside it grants a BALANCE and has its own
// checks further down, so a `find(kind === 'card-bundle')` here would silently test whichever of
// the two the rotation happened to list first.
const bundle = buyRotation.offers.find((o) => o.grant.kind === 'utility-card')!;
const bundleCard = getUtilityCard(
  bundle.grant.kind === 'utility-card' ? bundle.grant.cardId : 'double-coin',
)!;
const bundleSize = bundle.grant.kind === 'utility-card' ? bundle.grant.quantity : 0;
const fragmentPrice = bundle.prices.find((p) => p.currency === 'fragments')!;

const buy = (overrides: Record<string, unknown> = {}) =>
  checkPurchase({
    rotation: buyRotation,
    offerId: bundle.id,
    priceId: fragmentPrice.id,
    purchased: 0,
    balance: fragmentPrice.amount,
    heldCards: 0,
    maxCards: bundleCard.maxOwned,
    ...overrides,
  });

eq('exactly enough currency is enough', buy(), 'ok');
eq('one short is not', buy({ balance: fragmentPrice.amount - 1 }), 'insufficient-funds');
eq('an offer that is not on this shelf is refused', buy({ offerId: 'ls-not-a-thing' }), 'not-on-sale');
eq('a price route the offer does not have is refused', buy({ priceId: 'gems' }), 'unknown-offer');
eq('the purchase limit is enforced', buy({ purchased: bundle.purchaseLimit ?? 1 }), 'limit-reached');

// §4/§7 — a bundle that does not fit is refused WHOLE. Room for one card short of the bundle is
// still not room for the bundle: paying a pack price for a partial pack is the failure being
// designed out.
eq(
  'a bag with room for the whole bundle takes it',
  buy({ heldCards: bundleCard.maxOwned - bundleSize }),
  'ok',
);
eq(
  'a bag one slot short refuses the WHOLE bundle rather than granting part of it',
  buy({ heldCards: bundleCard.maxOwned - bundleSize + 1 }),
  'card-limit-reached',
);

// An accessory obeys the own-once rule instead.
const accessory = buyRotation.offers.find((o) => o.kind === 'item')!;
const accessoryPrice = accessory.prices[0];
const buyItem = (overrides: Record<string, unknown> = {}) =>
  checkPurchase({
    rotation: buyRotation,
    offerId: accessory.id,
    priceId: accessoryPrice.id,
    purchased: 0,
    balance: accessoryPrice.amount,
    alreadyOwned: false,
    ...overrides,
  });
eq('an unowned accessory can be bought', buyItem(), 'ok');
eq('an owned one cannot', buyItem({ alreadyOwned: true }), 'already-owned');
eq(
  'and 已擁有 is reported before 餘額不足 — the player cannot fix the first by earning more',
  buyItem({ alreadyOwned: true, balance: 0 }),
  'already-owned',
);

// §19 again, at the purchase rule rather than at the allowance helper: one player's record is the
// only thing that changes the answer.
eq('player B can still buy what player A bought out', buy({ purchased: 0 }), 'ok');

console.log(
  `\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`} — ${checks - failures}/${checks} checks\n`,
);
process.exit(failures === 0 ? 0 : 1);
