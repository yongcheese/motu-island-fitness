/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db, doc, updateDoc, handleFirestoreError, OperationType } from '../lib/firebase';
import type { AuthUser } from '../auth/types';
import { PlayerHome, UserProfile } from '../types';
import {
  getHouseStyleByItemId,
  STARTER_HOUSE_ITEM_ID,
  STARTER_HOUSE_STYLE_ID,
} from '../constants/houseStyles';

/**
 * Mutations for the player's single Home.
 *
 * The invariant these two functions exist to enforce: placing establishes the Home exactly once
 * (and consumes the Starter House so it can never be placed again), and changing appearance
 * only ever writes `home.currentStyle`. Nothing here can produce a second dwelling, because
 * `home` is a single object rather than a list.
 */
export function useHomeActions(user: AuthUser | null, profile: UserProfile | null) {
  /**
   * Establishes the player's Home at the chosen spot. Consumes the Starter House from the
   * inventory in the same write, so the "place my home" flow cannot run twice even if the UI
   * were somehow re-entered.
   */
  const placeHome = async (position: [number, number, number], rotation: number): Promise<boolean> => {
    if (!user || !profile) return false;
    // Already established - re-placing would be exactly the "second house" bug this redesign
    // removes. Moving an existing Home is a separate, deliberate action (see relocateHome).
    if (profile.home) return false;

    const home: PlayerHome = {
      position,
      rotation,
      currentStyle: STARTER_HOUSE_STYLE_ID,
      placedAt: new Date().toISOString(),
    };

    try {
      const profileRef = doc(db, 'users', user.uid);
      await updateDoc(profileRef, {
        home,
        // The starter house is a one-shot token: holding it means "home not placed yet", so it
        // is spent here rather than lingering as a placeable object.
        inventory: (profile.inventory || []).filter(id => id !== STARTER_HOUSE_ITEM_ID),
      });
      return true;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return false;
    }
  };

  /**
   * Re-skins the existing Home. Writes a single nested field, so position, rotation, interior,
   * furniture and storage are all structurally untouchable from here.
   */
  const applyHouseStyle = async (styleItemId: string): Promise<boolean> => {
    if (!user || !profile || !profile.home) return false;

    const style = getHouseStyleByItemId(styleItemId);
    if (!style) return false;
    // Ownership is plain inventory membership - the starter style is granted implicitly by
    // having a Home at all, everything else must have been bought.
    if (style.purchasable && !(profile.inventory || []).includes(styleItemId)) return false;
    if (profile.home.currentStyle === style.id) return false;

    try {
      const profileRef = doc(db, 'users', user.uid);
      await updateDoc(profileRef, { 'home.currentStyle': style.id });
      return true;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return false;
    }
  };

  /**
   * Moves the existing Home to a new spot, keeping its style and everything inside it. Separate
   * from placeHome so "establish" and "relocate" stay distinguishable at the call site.
   */
  const relocateHome = async (position: [number, number, number], rotation: number): Promise<boolean> => {
    if (!user || !profile || !profile.home) return false;

    try {
      const profileRef = doc(db, 'users', user.uid);
      await updateDoc(profileRef, {
        'home.position': position,
        'home.rotation': rotation,
      });
      return true;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return false;
    }
  };

  return { placeHome, applyHouseStyle, relocateHome };
}
