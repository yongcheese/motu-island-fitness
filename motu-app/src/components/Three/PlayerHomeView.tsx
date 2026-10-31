/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { useAppPick } from '../../context/AppContext';
import { usePlayerHome } from '../../hooks/usePlayerHome';
import { HouseModel } from './HouseModel';
import { View } from '../../types';
import { useSightlineOccluder } from '../../constants/layers';

/**
 * Renders the player's single Home on the island, if it has been placed.
 *
 * Deliberately separate from IslandPlacements (which draws ordinary Buildings from
 * `islandPlacements`): the Home is not an entry in that list, so there is no code path that
 * could ever draw two of them. Swapping the style re-renders this same node in place - the
 * position and rotation come from `profile.home`, untouched by a style change.
 *
 * In build mode it is selectable by clicking, like any other object — but selecting it opens 我的家
 * (UI/HomePanel.tsx) rather than picking it up. That is the difference between this and a fountain
 * and it is deliberate: a house has three verbs (外觀 / 移動 / 轉向) where a fountain has one, so a
 * click here is a question, not a command. Clicking used to start a move outright, which meant
 * "let me look at my house" made the house vanish behind its own ghost.
 *
 * It still hides itself while actually being MOVED, because the ghost is drawing it then.
 */
export function PlayerHomeView() {
  const { profile, currentView, islandDraft, selectHome } = useAppPick('profile', 'currentView', 'islandDraft', 'selectHome');
  const home = usePlayerHome(profile);
  // A sightline occluder only — the Home genuinely hides an interaction badge, and it is NOT a
  // raycast camera blocker.
  //
  // It was one, and that is the whole reason it is worth a paragraph here. Making it a blocker did
  // fix a real bug (the arm is much longer than the ~4-unit house, so walking up to a wall put the
  // camera inside the shell, where the exterior canvas' 0.5 near plane clips the wall away and you
  // see straight through the building) — but it fixed it with the wrong question. A raycast blocker
  // shortens the arm the moment anything crosses the SIGHTLINE, and a small building on open ground
  // crosses it constantly without ever containing the camera: rounding the corner of the house
  // swept the roof edge through the arm and dollied the camera in and out, so the character swelled
  // and shrank as you walked past, and the frame a house was first placed on did it once, hard.
  //
  // The containment condition — "the camera may not stand inside the shell" — is now stated
  // directly and analytically, against the same solid box the player is stopped by, in
  // CameraController (solveBoxContainmentLimit). It keeps the anti-x-ray guarantee this tag was
  // added for and drops the graze that came with it.
  const occluderRef = useSightlineOccluder<THREE.Group>();

  if (!home) return null;
  if (islandDraft?.kind === 'home') return null;

  const isEditable = currentView === View.BUILD_MODE && !islandDraft;

  return (
    <group
      ref={occluderRef}
      position={home.position}
      rotation={[0, home.rotation, 0]}
      onClick={isEditable ? (e) => {
        e.stopPropagation();
        selectHome();
      } : undefined}
      onPointerOver={isEditable ? (e) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
      } : undefined}
      onPointerOut={isEditable ? () => {
        document.body.style.cursor = 'auto';
      } : undefined}
    >
      <HouseModel style={home.style} />
    </group>
  );
}
