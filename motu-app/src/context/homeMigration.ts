/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { UserProfile } from '../types';
import { STARTER_HOUSE_ITEM_ID } from '../constants/houseStyles';

/**
 * One-time migration from the old "a house is just a placeable Building" model to the single
 * Player Home model.
 *
 * Under the old model a player could buy 草本屋 and 石磚小屋 and place both, ending up with two
 * dwellings sharing one interior. There is no correct way to pick which of those was "the real
 * home", so every placed house is withdrawn and the player re-establishes their Home through
 * the first-time guide - the same flow new players get.
 *
 * Nothing paid-for is lost: an owned legacy house becomes the equivalent House Style, so it can
 * be applied to the Home the moment it exists.
 */

/** Old catalog ids for the two houses that were placeable BUILDING items, and their styles. */
const LEGACY_HOUSE_ITEM_TO_STYLE_ITEM: Record<string, string> = {
  'item-14': 'house-grass', // 草本屋
  'item-15': 'house-stone', // 石磚小屋
};

const LEGACY_HOUSE_ITEM_IDS = Object.keys(LEGACY_HOUSE_ITEM_TO_STYLE_ITEM);

/**
 * Bumping this string re-runs the migration below for every existing player exactly once. It
 * replaces the previous 'v1.1_reset' stamp, whose territoryLevel reset has already been applied
 * to everyone and must not fire again.
 */
export const HOME_MIGRATION_VERSION = 'v2.0_player_home';

export interface HomeMigrationResult {
  /** Firestore patch to apply, or null when the profile is already up to date. */
  updates: Record<string, unknown> | null;
  /** The same changes applied to a copy of the profile, for immediate local state. */
  profile: UserProfile;
}

/**
 * Computes the migration patch for a profile. Pure - the caller decides whether to write it,
 * so this stays trivially reasoned about despite touching inventory and placements.
 */
export function migrateProfileToPlayerHome(profile: UserProfile): HomeMigrationResult {
  // migrationVersion isn't declared on UserProfile - it's infrastructure bookkeeping rather
  // than gameplay state, and has always been read/written untyped.
  const alreadyMigrated =
    (profile as unknown as Record<string, unknown>).migrationVersion === HOME_MIGRATION_VERSION;
  if (alreadyMigrated) {
    return { updates: null, profile };
  }

  const inventory = profile.inventory || [];
  const equippedItems = profile.equippedItems || [];
  const islandPlacements = profile.islandPlacements || [];

  // 1. Withdraw every placed house from the island. Ordinary decorations stay exactly as they
  //    are - this only removes what used to be a walk-in dwelling.
  const nextPlacements = islandPlacements.filter(p => !LEGACY_HOUSE_ITEM_IDS.includes(p.itemId));

  // 2. Convert owned legacy houses into the matching House Styles, de-duplicated: styles are a
  //    binary "owned or not", unlike furniture which stacks.
  const nextInventory: string[] = [];
  const seenStyleItems = new Set<string>();
  for (const itemId of inventory) {
    const styleItemId = LEGACY_HOUSE_ITEM_TO_STYLE_ITEM[itemId];
    if (styleItemId) {
      if (!seenStyleItems.has(styleItemId)) {
        seenStyleItems.add(styleItemId);
        nextInventory.push(styleItemId);
      }
      continue;
    }
    nextInventory.push(itemId);
  }

  // 3. Grant the Starter House so the guide has something to place. Skipped for a player who
  //    somehow already has a Home (defensive - shouldn't happen on a first migration).
  if (!profile.home && !nextInventory.includes(STARTER_HOUSE_ITEM_ID)) {
    nextInventory.push(STARTER_HOUSE_ITEM_ID);
  }

  // 4. equippedItems is wearables-only now that the legacy building-slot system is gone; strip
  //    any house that was sitting in it.
  const nextEquipped = equippedItems.filter(id => !LEGACY_HOUSE_ITEM_IDS.includes(id));

  const updates: Record<string, unknown> = {
    inventory: nextInventory,
    equippedItems: nextEquipped,
    islandPlacements: nextPlacements,
    home: profile.home ?? null,
    migrationVersion: HOME_MIGRATION_VERSION,
  };

  return {
    updates,
    profile: {
      ...profile,
      inventory: nextInventory,
      equippedItems: nextEquipped,
      islandPlacements: nextPlacements,
      home: profile.home ?? null,
    },
  };
}
