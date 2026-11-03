/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { PlayerHome, UserProfile } from '../types';
import { getHouseStyle, HouseStyleDefinition, HouseStyleFootprint, HOUSE_FOOTPRINT } from '../constants/houseStyles';
import { getHouseDoorFrame } from '../components/Three/HouseModel';

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

/**
 * Ground-plane distance from `(x, z)` to the Home's entry point — the one measure both the
 * `nearbyBuilding` flag (characterMovement's findNearbyHome) and the interaction targeting use, so
 * the two cannot disagree at the edge of the radius.
 *
 * Horizontal on purpose: the door's own height and the player's logical ground height differ on a
 * sloped island, and "how far am I from the door" is a question about walking, not about height.
 */
export function homeEntryDistance(x: number, z: number, home: ResolvedHome): number {
  const cos = Math.cos(home.rotation);
  const sin = Math.sin(home.rotation);
  const doorX = home.position[0] + home.footprint.doorOffsetZ * sin;
  const doorZ = home.position[2] + home.footprint.doorOffsetZ * cos;
  return Math.hypot(x - doorX, z - doorZ);
}

/** Whether the player is close enough to the Home's door to enter it. */
export function isNearHomeDoor(position: THREE.Vector3, home: ResolvedHome | null): boolean {
  if (!home) return false;
  return homeEntryDistance(position.x, position.z, home) < HOME_ENTRY_RADIUS;
}

/**
 * How far in front of the door leaf the Home's interaction point stands.
 *
 * The leaf is recessed INSIDE the house's solid box (the body is drawn 0.05 inside the collider,
 * and a plain wall stands no frame proud of it), so a point exactly on the leaf would be inside
 * the thing the line-of-reach test treats as a wall — and the door could never be reached. A
 * hand's breadth past the box's own face clears it on every wall treatment.
 */
const DOOR_POINT_STANDOFF = 0.1;

/**
 * THE HOME'S INTERACTION POINT — on its front door, at the middle of the leaf.
 *
 * This is where 「E 進入我的家」 points. It used to hang over the roof ridge (door XZ, roofline
 * + 0.6 — 4 to 5 units up), which a first-time player reads as "something about this house"
 * rather than "walk to that door": from the usual camera the badge sat above the silhouette, far
 * from anywhere they could stand. The height now comes from the door leaf's own geometry
 * (Three/HouseModel.tsx's getHouseDoorFrame), rotated with the house like every other fitting.
 *
 * The prompt could not sit on the door before because it was hidden whenever a camera ray to it
 * grazed any mesh — and a point on a wall is grazed by that wall. Targeting now decides
 * reachability from the PLAYER's line of reach (lib/interactionTargeting.ts), which is what that
 * camera test was standing in for, so the badge can go where the door actually is.
 */
export function getHomeInteractionPoint(home: ResolvedHome): { x: number; y: number; z: number } {
  const door = getHouseDoorFrame(home.style);
  const localZ = Math.max(door.faceZ, home.footprint.halfDepth) + DOOR_POINT_STANDOFF;
  const sin = Math.sin(home.rotation);
  const cos = Math.cos(home.rotation);
  return {
    x: home.position[0] + localZ * sin,
    y: home.position[1] + door.bottomY + door.height / 2,
    z: home.position[2] + localZ * cos,
  };
}

/**
 * Memoized wrapper around getPlayerHome for use in component render.
 *
 * Keyed on the Home's VALUES, not on the `position` array. The ground cover, the wildflowers, the
 * rocks and the overgrowth all rebuild their layout when this object changes, so its identity has
 * to mean "the Home moved or was re-skinned" and nothing else. Keyed on the array, it changed on
 * every save snapshot (each one is a fresh object tree), which re-laid the island on every write.
 */
export function usePlayerHome(profile: UserProfile | null | undefined): ResolvedHome | null {
  const home = profile?.home;
  const x = home?.position?.[0];
  const y = home?.position?.[1];
  const z = home?.position?.[2];
  return useMemo(
    () => getPlayerHome(profile),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `profile` is read only through these
    [x, y, z, home?.rotation, home?.currentStyle]
  );
}
