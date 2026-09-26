/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Distribution Channel — 「這件東西是什麼」 and 「這件東西從哪裡拿到」 are two different questions.
 *
 * The catalog (constants/items.ts) answers the first one: a name, a category, a price, a tier, a
 * placement rule. It used to answer the second one too, by accident — an item existed, therefore
 * the 商店 sold it, because the shop was `ALL_ITEMS.filter(byCategory)`. That is the coupling this
 * file removes.
 *
 * An item now declares the channels it is DISTRIBUTED through ({@link ItemDefinition.availableIn}),
 * and each storefront builds its shelf from the channel it owns rather than from the whole catalog:
 *
 *   ALL_ITEMS            every item that exists — the definitions. Ownership, the wardrobe, the
 *                        avatar and every save-repair path read this, because 「我擁有的東西」 has
 *                        nothing to do with where it was bought.
 *   MAIN_SHOP_CATALOG    what the ordinary 商店 sells.
 *   LIMITED_SHOP_ITEMS   what the 限時商店 may put on its shelf.
 *
 * ## Why this is a channel list and not a boolean
 *
 * Because an item can legitimately have more than one source, and already does: a 特殊飾品 is sold
 * in the 限時商店 for 碎片, can drop from the 輪盤, and can be unlocked by collecting its own
 * 商品碎片. Those are three channels for one definition, and 「限時商店限定」 is a statement about
 * one of them rather than about the item. A boolean (`limitedOnly`) would have to be re-interpreted
 * by every system that hands anything out; a list can simply be asked.
 *
 * ## Adding a channel
 *
 * A member of {@link DistributionChannel}, a label, and ONE reader — the surface that owns it. What
 * must not happen is a channel nothing reads: an item tagged `event-shop` with no 活動商店 to sell
 * it is an item that has quietly left the game. That is why the union below is exactly the channels
 * that exist today, and why 活動商店 / 任務獎勵 are named here in prose rather than pre-declared.
 */

import type { ItemDefinition } from './items';
import { ALL_ITEMS } from './items';

/**
 * Where an item can be obtained.
 *
 *   `main-shop`     the permanent 商店 (components/ShopView.tsx). Bought with 金幣, always there.
 *   `limited-shop`  the rotating 限時商店 (components/LimitedShopView.tsx). Only on the shelf while
 *                   a rotation lists it, and never sold by the ordinary shop.
 *   `reward`        handed out rather than sold — 輪盤 prizes, 商品碎片 unlocks, 每日登入, 新手禮.
 *                   Those systems each own an eligibility spec (constants/rewardPools.ts) and this
 *                   is the item's half of that contract: 「我可以被當成獎勵發出去」.
 */
export type DistributionChannel = 'main-shop' | 'limited-shop' | 'reward';

export const DISTRIBUTION_CHANNELS: readonly DistributionChannel[] = [
  'main-shop',
  'limited-shop',
  'reward',
];

/** What a channel is called, for admin readouts and for the 「哪裡買得到」 line on a card. */
export const CHANNEL_LABELS: Record<DistributionChannel, string> = {
  'main-shop': '商店',
  'limited-shop': '限時商店',
  reward: '獎勵',
};

/**
 * What an item declaring nothing is distributed through.
 *
 * `main-shop` plus `reward`, which is what the catalog meant for its entire life before this file
 * existed: an ordinary item is on the ordinary shelf and may also be given away. Making the default
 * explicit is what keeps ~180 catalog rows from having to grow a field to stay where they are —
 * only an item that is NOT ordinary says so.
 */
export const DEFAULT_CHANNELS: readonly DistributionChannel[] = ['main-shop', 'reward'];

/** The channels this item is distributed through. Never reads a category, a price or an id. */
export function itemChannels(
  item: ItemDefinition | null | undefined,
): readonly DistributionChannel[] {
  if (!item) return [];
  return item.availableIn ?? DEFAULT_CHANNELS;
}

/** Whether this item may be obtained through `channel`. The one question every storefront asks. */
export function isInChannel(
  item: ItemDefinition | null | undefined,
  channel: DistributionChannel,
): boolean {
  return itemChannels(item).includes(channel);
}

/** Every item in a channel, in catalog order. */
export function itemsInChannel(channel: DistributionChannel): ItemDefinition[] {
  return ALL_ITEMS.filter((item) => isInChannel(item, channel));
}

/**
 * What the ordinary 商店 sells.
 *
 * Computed once, at module load, for the same reason `FRAGMENT_ITEMS` is: `ALL_ITEMS` is a
 * module-level constant, and re-filtering ~180 rows on every shelf change is re-deriving a list
 * that cannot have changed. Every main-shop surface — the catalog grid, the collection drawer's
 * category counts, the build rail, the furniture drawer — reads THIS, so 「普通商店賣什麼」 has
 * exactly one answer and a limited-shop exclusive cannot leak into one of them by being forgotten.
 */
export const MAIN_SHOP_CATALOG: readonly ItemDefinition[] = ALL_ITEMS.filter((item) =>
  isInChannel(item, 'main-shop'),
);

/**
 * The items the 限時商店 is allowed to put on its shelf.
 *
 * Being in this list does NOT mean an item is on sale — that is a rotation (constants/
 * limitedShopRotation.ts), and it is also not enough on its own: an item still needs a row in the
 * shop's own pool (constants/limitedShop.ts) to say what it costs there. This is the eligibility
 * half, and it is what `npm run test:limited-shop` checks the pool against, so a pool row for an
 * item the catalog does not consider limited is a failing test rather than a silent inconsistency.
 */
export const LIMITED_SHOP_ITEMS: readonly ItemDefinition[] = ALL_ITEMS.filter((item) =>
  isInChannel(item, 'limited-shop'),
);

/** Ids of everything the ordinary shop sells. For O(1) guards on a purchase write. */
const MAIN_SHOP_IDS = new Set(MAIN_SHOP_CATALOG.map((item) => item.id));

/**
 * Whether the ordinary shop may sell this id. Asked at the WRITE (context/useShopActions.ts) as
 * well as in the UI, so no surface can buy a limited exclusive by holding a stale card.
 */
export function isMainShopItem(itemId: string | null | undefined): boolean {
  return !!itemId && MAIN_SHOP_IDS.has(itemId);
}
