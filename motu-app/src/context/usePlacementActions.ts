/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db, doc, updateDoc, handleFirestoreError, OperationType } from '../lib/firebase';
import type { AuthUser } from '../auth/types';
import { PlacedItem, UserProfile } from '../types';
import { canPlaceItem } from '../utils/inventory';

/**
 * Island placement store — every write to `profile.islandPlacements` goes through here.
 *
 * These used to branch on the current view to decide whether they were writing island or
 * interior placements. They never were: the house interior has always written
 * `interiorData.placements` through its own handlers, so the interior branch was dead code that
 * made the island's own rules read as conditional. They are island-only now, and the interior
 * enforces the same stock rule (utils/inventory.ts) at its own write.
 *
 * Adding a placement consumes one copy from the inventory implicitly — stock is
 * `owned − placed`, so appending here is what spends it, and removing below is what refunds it.
 * That is why `placeIslandItem` refuses when nothing is in stock: it is the last line of
 * defence behind a disabled button, so no keyboard path or stale click can put down a copy the
 * player never bought.
 */
export function usePlacementActions(user: AuthUser | null, profile: UserProfile | null) {
  const placeIslandItem = async (
    itemId: string,
    position: [number, number, number],
    rotation: number
  ): Promise<boolean> => {
    if (!user || !profile) return false;
    if (!canPlaceItem(profile, itemId)) return false;

    const newPlacement: PlacedItem = {
      instanceId: `inst-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
      itemId,
      position,
      rotation,
    };

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        islandPlacements: [...(profile.islandPlacements || []), newPlacement],
      });
      return true;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return false;
    }
  };

  /** Moves/rotates an existing placement in place. Never touches stock — it's the same copy. */
  const updateIslandPlacement = async (
    instanceId: string,
    position: [number, number, number],
    rotation: number
  ): Promise<boolean> => {
    if (!user || !profile) return false;
    const placements = profile.islandPlacements || [];
    if (!placements.some(p => p.instanceId === instanceId)) return false;

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        islandPlacements: placements.map(p =>
          p.instanceId === instanceId ? { ...p, position, rotation } : p
        ),
      });
      return true;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return false;
    }
  };

  /** Picks a placed object back up. The copy returns to stock because it is no longer placed. */
  const removeIslandPlacement = async (instanceId: string): Promise<boolean> => {
    if (!user || !profile) return false;

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        islandPlacements: (profile.islandPlacements || []).filter(p => p.instanceId !== instanceId),
      });
      return true;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return false;
    }
  };

  return { placeIslandItem, updateIslandPlacement, removeIslandPlacement };
}
