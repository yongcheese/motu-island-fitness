/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { UserProfile } from '../types';
import { getItemKind } from './categoryUtils';
import { UNOWNED_OVERRIDE } from './debugOverrides';

/**
 * The Inventory System — one definition of "how many of this do I own, and how many are still
 * free to place".
 *
 * `profile.inventory` is a flat list of item ids where a **placeable** item appears once per
 * copy bought, and everything else (wearables, floors/walls, house styles) appears at most once.
 * Which of those two an item is comes from its category kind (utils/categoryUtils.ts), never
 * from an id prefix.
 *
 * Stock is derived rather than mutated: `available = owned − placed`, counting placements on the
 * island *and* inside the house, because one bought copy is one object in the world wherever it
 * ends up. Deriving it means putting an object down, moving it, retrieving it and buying another
 * can never disagree with each other — there is no second counter to keep in sync.
 */

/**
 * Items that stack — one inventory entry per copy bought. Two kinds do:
 *  - `placeable`, where each copy is one object you can put down;
 *  - `consumable` (特殊卡牌), where each copy is one use you can spend.
 * Everything else (wearables, floors/walls, house styles, pets, NPCs) is own-once.
 */
export function isStackableItem(itemId: string): boolean {
  const kind = getItemKind(itemId);
  return kind === 'placeable' || kind === 'consumable';
}

/** Total copies bought (1 = owned, for non-stacking items). */
export function getOwnedCount(profile: UserProfile | null | undefined, itemId: string): number {
  // ?unown=<id> — a test-only override that hides a purchase for the session so the shop's
  // not-yet-bought states can be inspected on an account that already owns the item. It hooks in
  // HERE, at the single definition of ownership, so every screen agrees the item is unowned
  // rather than the shop card saying one thing and the dressing room another. See
  // utils/debugOverrides.ts, including why it can only ever take ownership away.
  if (UNOWNED_OVERRIDE.has(itemId)) return 0;

  const inventory = profile?.inventory || [];
  if (!isStackableItem(itemId)) return inventory.includes(itemId) ? 1 : 0;
  return inventory.filter(id => id === itemId).length;
}

export function ownsItem(profile: UserProfile | null | undefined, itemId: string): boolean {
  return getOwnedCount(profile, itemId) > 0;
}

/** Copies currently standing somewhere — island placements plus interior placements. */
export function getPlacedCount(profile: UserProfile | null | undefined, itemId: string): number {
  const island = profile?.islandPlacements || [];
  const interior = profile?.interiorData?.placements || [];
  return (
    island.filter(p => p.itemId === itemId).length +
    interior.filter(p => p.itemId === itemId).length
  );
}

/**
 * Copies left in the backpack. Clamped at zero so a legacy profile whose seeded placements
 * predate the stock model can still never read as "negative stock" in the UI — the
 * reconciliation below is what actually repairs those.
 */
export function getAvailableStock(profile: UserProfile | null | undefined, itemId: string): number {
  if (!isStackableItem(itemId)) return ownsItem(profile, itemId) ? 1 : 0;
  return Math.max(0, getOwnedCount(profile, itemId) - getPlacedCount(profile, itemId));
}

/**
 * Whether a *new* copy can be put down right now. Moving an existing one never consumes stock.
 *
 * Asks for `placeable` by name rather than reusing {@link isStackableItem}: stacking and being
 * placeable stopped being the same fact when 特殊卡牌 arrived. A card stacks — you can hold five
 * 抽獎券 — but there is no flow that stands one on the island, so the stacking test alone would
 * have quietly answered yes for it.
 */
export function canPlaceItem(profile: UserProfile | null | undefined, itemId: string): boolean {
  return getItemKind(itemId) === 'placeable' && getAvailableStock(profile, itemId) > 0;
}

/**
 * Tops the inventory up so it accounts for everything already standing in the world.
 *
 * Placements used to be created without a matching inventory entry (a new player's preset living
 * room, an expansion room's auto-decorated furniture), which under the derived-stock rule above
 * would read as "you own fewer than you have placed" and silently deny a purchase's worth of
 * placements. This grants the missing copies once, so `owned ≥ placed` holds for every profile
 * from then on.
 *
 * Pure and idempotent: returns null when nothing is missing, so a healthy profile causes no
 * write. The caller decides whether to persist it.
 */
export function reconcileInventoryStock(profile: UserProfile): string[] | null {
  const inventory = profile.inventory || [];
  const placed = new Map<string, number>();

  for (const p of [...(profile.islandPlacements || []), ...(profile.interiorData?.placements || [])]) {
    if (!isStackableItem(p.itemId)) continue;
    placed.set(p.itemId, (placed.get(p.itemId) || 0) + 1);
  }

  const missing: string[] = [];
  for (const [itemId, placedCount] of placed) {
    const owned = inventory.filter(id => id === itemId).length;
    for (let i = owned; i < placedCount; i++) missing.push(itemId);
  }

  return missing.length > 0 ? [...inventory, ...missing] : null;
}
