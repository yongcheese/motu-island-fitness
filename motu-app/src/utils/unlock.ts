/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { UserProfile } from '../types';
import { getItemById, ItemDefinition } from '../constants/items';

/**
 * 經驗值解鎖 — the one rule for items the player earns instead of buys.
 *
 * Most of the shop is bought with gold. A few items are 獎勵 rather than 商品: they cost nothing,
 * and the only way to get one is to have trained enough. 柴犬 is the first, at 100 XP.
 *
 * Two deliberate choices worth keeping:
 *
 *  1. **The requirement is a threshold, never a cost.** Reaching it unlocks the item and the XP
 *     stays where it is. `profile.currentXp` is cumulative and the player's 等級 is derived from
 *     it (`currentXp / 100`, see TopBar/AccountPanel), so spending XP would silently demote the
 *     player — an unlock that costs you a level is a punishment, not a reward.
 *  2. **An XP item is still bought through the Shop System.** It goes through the same
 *     `purchaseItem` write, the same confirmation dialog and the same inventory, only at a price
 *     of 0 with this check in front of it. That keeps ownership in one place; the unlock rule is
 *     a gate on the storefront, not a second way to own things.
 *
 * Marking an item as XP-unlocked is one `xpUnlock:` field in constants/items.ts (plus `price: 0`).
 * Nothing may re-derive the requirement from a price, a category or an id.
 */

/** The player's cumulative XP — the number every requirement below is measured against. */
export function getPlayerXp(profile: UserProfile | null | undefined): number {
  return profile?.currentXp ?? 0;
}

/**
 * How much XP this item demands, or 0 when it is an ordinary gold purchase.
 * Takes either the definition or its id, so callers holding one don't have to look up the other.
 */
export function getXpRequirement(item: ItemDefinition | string | null | undefined): number {
  const def = typeof item === 'string' ? getItemById(item) : item;
  return def?.xpUnlock ?? 0;
}

/** Whether this item is gated on XP at all. */
export function isXpUnlockItem(item: ItemDefinition | string | null | undefined): boolean {
  return getXpRequirement(item) > 0;
}

/**
 * Locked = gated on XP *and* the player hasn't reached it yet. Ordinary items are never locked,
 * so a caller can ask this about any item and get the answer it expects.
 */
export function isXpLocked(
  profile: UserProfile | null | undefined,
  item: ItemDefinition | string | null | undefined,
): boolean {
  const required = getXpRequirement(item);
  return required > 0 && getPlayerXp(profile) < required;
}

/** How much more XP is needed, for the "還差 N 經驗值" copy. 0 once unlocked. */
export function getXpRemaining(
  profile: UserProfile | null | undefined,
  item: ItemDefinition | string | null | undefined,
): number {
  const required = getXpRequirement(item);
  if (required <= 0) return 0;
  return Math.max(0, required - getPlayerXp(profile));
}

/** Progress toward the requirement as 0–1, for the lock's progress bar. */
export function getXpUnlockProgress(
  profile: UserProfile | null | undefined,
  item: ItemDefinition | string | null | undefined,
): number {
  const required = getXpRequirement(item);
  if (required <= 0) return 1;
  return Math.min(1, getPlayerXp(profile) / required);
}
