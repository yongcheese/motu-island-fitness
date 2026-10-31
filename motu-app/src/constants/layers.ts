/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { useLayoutEffect, useRef } from 'react';

/**
 * Raycast layers describing WHAT KIND of solid a piece of world geometry is.
 *
 * There are two classes, and they exist because the two systems that cast rays into the world
 * want different answers to "is something in the way?":
 *
 *   SIGHTLINE_OCCLUDER  Anything solid enough to hide a floating world-space badge.
 *                       InteractionPromptTracker.tsx tests this for the badges that are DISPLAY
 *                       (the Q light-switch badge, a resident's speech bubble): a torch, a wishing
 *                       well or the house itself genuinely can stand in front of one, so
 *                       everything the player places belongs here. (The E prompt is not hidden
 *                       this way: whether its target can be reached is decided from the player's
 *                       own line of reach — lib/interactionTargeting.ts — and a reachable target
 *                       always shows its prompt.)
 *
 *   CAMERA_BLOCKER      Only things the third-person camera must not pass through: outdoors, the
 *                       island's own raised terrain. lib/cameraCollision.ts tests this.
 *
 *                       THE HOME IS NOT IN THIS CLASS, and was briefly. A raycast blocker fires on
 *                       a graze — the instant anything crosses the sightline — which is right for
 *                       terrain (you cannot stand on the far side of a hill) and wrong for a
 *                       4-unit building under a much longer arm: walking round the corner of the
 *                       house swept the roof through the arm and dollied the camera in and out,
 *                       swelling and shrinking the character, and placing the house did it once,
 *                       hard. What the Home actually needs is CONTAINMENT — the camera must not
 *                       stand inside its shell — which is stated analytically against the house's
 *                       own solid box in CameraController (lib/cameraCollision.ts's
 *                       solveBoxContainmentLimit) instead. Same guarantee, no graze.
 *
 *                       The dividing line is ENCLOSURE, not size: terrain has an inside — a far
 *                       side you are not meant to see — so an arm that passes through it doesn't
 *                       read as "the camera clipped a prop", it reads as the world going
 *                       transparent. That is the bug this class exists to prevent. The Home has an
 *                       inside too, which is why it needs the same guarantee; what it does not
 *                       need is the sightline half that comes bundled with it, hence the analytic
 *                       treatment above.
 *
 *                       EVERYTHING THE PLAYER PLACES IS STILL DELIBERATELY ABSENT. A fountain, a
 *                       torch, a hammock, a palm - the arm slipping through one of those is
 *                       invisible, while an arm that backs off for each is one that moves on its
 *                       own constantly on a well-decorated island. They are props: solid to a
 *                       prompt, transparent to the camera.
 *
 * A camera blocker is also a sightline occluder (see {@link useCameraBlocker}), so the classes
 * nest rather than compete - there is one place that says what something IS, and each system
 * picks the class it cares about. Adding a third class later (something that blocks the camera
 * but not prompts, say) means adding a layer here and nothing anywhere else.
 *
 * WHY LAYERS AND NOT A FILTERED FULL-SCENE CAST. Both systems used to run against
 * `scene.children` recursively, i.e. against every object in the world. That is ~1000 objects
 * including the two ocean planes (45,000 and 8,192 triangles), the two shoreline wave rings, the
 * cloud layer and every blade of grass - and three has no spatial index, so each call brute-forced
 * ray/triangle tests across all of them. Profiling measured 15.4 ms for a single one of those
 * casts. It was also wrong: a blade of grass or a wave crest clipping the sightline counted as
 * "blocked", so the prompt could blink out - and the camera jump in - with nothing actually in
 * front of it. Objects opt in here instead. Membership is additive (an object stays on layer 0 and
 * keeps rendering exactly as before) and three skips `object.raycast()` entirely for anything whose
 * layers don't match the raycaster's mask, so the ocean/grass/cloud triangles are never touched.
 *
 * Never opted into either class: water, sky, clouds, weather particles, fireflies, grass,
 * scattered flora, path decals, the player's own avatar and the pet.
 *
 * The opt-in happens on *container* subtrees (`<IslandPlacements>`, `<PlayerHomeView>`), so new
 * content added inside them inherits its class automatically: neither the camera nor the prompt
 * tracker ever has to learn about a new building or prop.
 */
export const SIGHTLINE_OCCLUDER_LAYER = 1;
export const CAMERA_BLOCKER_LAYER = 2;

function tagLayers(root: THREE.Object3D | null | undefined, layers: number[]) {
  root?.traverse((child) => layers.forEach((layer) => child.layers.enable(layer)));
}

function useLayerTag<T extends THREE.Object3D>(layers: number[]) {
  const ref = useRef<T>(null);

  // No dependency array: re-tags on every render so children that mount later (a house style
  // swap, a newly placed object) are covered without the caller tracking them.
  useLayoutEffect(() => {
    tagLayers(ref.current, layers);
  });

  return ref;
}

/**
 * Marks a subtree as a prop: solid enough to hide an interaction prompt, but NOT something the
 * camera arm should shorten for. Everything the player places belongs here.
 */
export function useSightlineOccluder<T extends THREE.Object3D>() {
  return useLayerTag<T>([SIGHTLINE_OCCLUDER_LAYER]);
}

/**
 * Marks a subtree as a structure the camera arm may not cross AT ALL - which also makes it big
 * enough to hide a prompt, so this is a superset of {@link useSightlineOccluder}.
 *
 * Only the island's own terrain qualifies. Anything smaller than the arm is better served by an
 * analytic containment rule (see the Home, in CameraController), because this tag also shortens
 * the arm for a graze that never puts the camera inside anything.
 */
export function useCameraBlocker<T extends THREE.Object3D>() {
  return useLayerTag<T>([SIGHTLINE_OCCLUDER_LAYER, CAMERA_BLOCKER_LAYER]);
}
