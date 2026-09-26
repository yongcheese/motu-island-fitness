/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { UserProfile } from '../types';

/**
 * Catalog ids that have been withdrawn from the game.
 *
 * Every screen already reads the catalog rather than the save file — the shop and the dressing
 * room list `ALL_ITEMS` filtered by ownership, and the avatar resolves each equipped id through
 * `getItemById` and drops what it cannot find. So deleting an item from constants/items.ts is
 * enough to make it disappear from the UI, and a retired id left in a save is inert rather than
 * broken.
 *
 * This list exists for the save file itself: without it a player who bought one keeps carrying a
 * dead id in `inventory`/`equippedItems` forever. Sweeping it once on load keeps the persisted
 * profile honest about what the game contains.
 */
export const RETIRED_ITEM_IDS: readonly string[] = [
  // Tattoos, removed from the catalog entirely (shop + dressing room + avatar).
  'tattoo-trad',
  'tattoo-jp',
  'tattoo-real',
  'tattoo-mini',
  'tattoo-ink',
];

const RETIRED = new Set(RETIRED_ITEM_IDS);

/**
 * Strips retired ids from a profile's owned and worn lists.
 *
 * Returns `null` when there is nothing to remove, so a healthy profile — which is every profile
 * after the first sweep — costs one `some()` and no Firestore write.
 */
export function stripRetiredItems(
  profile: UserProfile
): { inventory: string[]; equippedItems: string[] } | null {
  const inventory = profile.inventory || [];
  const equippedItems = profile.equippedItems || [];

  const affected =
    inventory.some(id => RETIRED.has(id)) || equippedItems.some(id => RETIRED.has(id));
  if (!affected) return null;

  return {
    inventory: inventory.filter(id => !RETIRED.has(id)),
    equippedItems: equippedItems.filter(id => !RETIRED.has(id)),
  };
}
