/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { PlayerHome, UserProfile } from '../types';
import { getHouseStyle, HouseStyleDefinition, HouseStyleFootprint, HOUSE_FOOTPRINT } from '../constants/houseStyles';

/**
 * Everything the world needs to know about the player's Home in one resolved object: where it
 * is, which style it wears, and how big that style makes it. Physics, rendering, placement
 * rules and the entry prompt all read this rather than each re-deriving the footprint.
 */
export interface ResolvedHome {
  position: [number, number, number];
  rotation: number;
  style: HouseStyleDefinition;
  footprint: HouseStyleFootprint;
}

/**
 * Resolves a profile's Home, or null when it hasn't been placed yet. A plain function (not a
 * hook) so the imperative placement solvers and per-frame useFrame closures - which run outside
 * component render and can't call hooks - share exactly this derivation.
 */
export function getPlayerHome(profile: UserProfile | null | undefined): ResolvedHome | null {
  const home: PlayerHome | null | undefined = profile?.home;
  if (!home || !home.position) return null;

  return {
    position: home.position,
    rotation: home.rotation || 0,
    style: getHouseStyle(home.currentStyle),
    // Every style is the same physical size, so switching appearance can never move a wall,
    // shrink the collider or relocate the door. See HOUSE_FOOTPRINT.
    footprint: HOUSE_FOOTPRINT,
  };
}

/** Whether the player has established their Home yet. */
export function hasPlacedHome(profile: UserProfile | null | undefined): boolean {
  return getPlayerHome(profile) !== null;
}

/**
 * World-space position of the Home's front door, respecting its rotation. The interaction
 * prompt anchors here and findNearbyHome measures against it.
 */
export function getHomeDoorPosition(home: ResolvedHome): THREE.Vector3 {
  const localDoorOffset = new THREE.Vector3(0, 0, home.footprint.doorOffsetZ);
  localDoorOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), home.rotation);

  return new THREE.Vector3(
    home.position[0] + localDoorOffset.x,
    home.position[1],
    home.position[2] + localDoorOffset.z
  );
}

/**
 * How close to the door the player must be before the "進入我的家" prompt appears.
 *
 * Derived from the house's own depth rather than a fixed number, so it stays proportionate if
 * the footprint is ever retuned. A hardcoded radius is how this broke before: the value was
 * inherited from the old, larger houses and no longer matched the building it was gating.
 */
export const HOME_ENTRY_RADIUS = HOUSE_FOOTPRINT.halfDepth + 1.6;

/** Whether the player is close enough to the Home's door to enter it. */
export function isNearHomeDoor(position: THREE.Vector3, home: ResolvedHome | null): boolean {
  if (!home) return false;
  return position.distanceTo(getHomeDoorPosition(home)) < HOME_ENTRY_RADIUS;
}

/** Memoized wrapper around getPlayerHome for use in component render. */
export function usePlayerHome(profile: UserProfile | null | undefined): ResolvedHome | null {
  return useMemo(
    () => getPlayerHome(profile),
    [profile?.home?.position, profile?.home?.rotation, profile?.home?.currentStyle]
  );
}
