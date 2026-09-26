/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { getItemById } from '../constants/items';
import { BUILDING_POSITIONS } from '../constants/buildingPositions';
import { ItemCategory, UserProfile } from '../types';

export interface EquippedBuilding {
  id: string;
  name: string;
  position: [number, number, number];
}

/**
 * Resolves a profile's equipped BUILDING-category items to their fixed
 * island positions (assigned by equip order, wrapping via modulo once
 * there are more equipped buildings than BUILDING_POSITIONS slots).
 * Previously this exact derivation was independently re-implemented in
 * IslandDecorations, Island, and Weather. A plain (non-hook) function so it
 * can also be called from PlacementGhost's imperative placement-solver
 * helpers, which run outside component render and can't call hooks.
 */
export function getEquippedBuildings(profile: UserProfile | null | undefined): EquippedBuilding[] {
  if (!profile?.equippedItems) return [];
  return profile.equippedItems
    .map(id => getItemById(id))
    .filter((item): item is NonNullable<typeof item> => !!item && item.category === ItemCategory.BUILDING)
    .map((item, idx) => ({
      id: item.id,
      name: item.name,
      position: BUILDING_POSITIONS[idx % BUILDING_POSITIONS.length],
    }));
}

/** Memoized wrapper around getEquippedBuildings for use in component render. */
export function useEquippedBuildings(profile: UserProfile | null | undefined): EquippedBuilding[] {
  return useMemo(() => getEquippedBuildings(profile), [profile?.equippedItems]);
}
