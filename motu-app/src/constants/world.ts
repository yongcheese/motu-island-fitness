/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared world levels for the island scene.
 *
 * These were previously bare literals duplicated across Ocean.tsx, Avatar.tsx,
 * Weather.tsx and Fish.tsx, each with its own comment restating "the sea is at
 * -0.5". That duplication is exactly how the swimming avatar's splash/ripple FX
 * ended up tuned to sit *below* the water they're supposed to sit on: the two
 * files were adjusted independently and nothing tied them back together.
 */

/**
 * World Y of the ocean surface - the plane Ocean.tsx's two surface meshes sit
 * on. Waves displace vertices around it (see Ocean.tsx's WAVE_NOISE_GLSL), so
 * this is the mean level, not a hard ceiling.
 */
export const WATER_SURFACE_Y = -0.5;

/**
 * World Y the avatar's group origin (its feet - see Avatar.tsx's groupRef) sits
 * at while swimming. The body is pitched ~82deg to lie flat, which collapses
 * the whole standing height into ~0.14x of its vertical extent, so this offset
 * is what puts the waterline across the middle of the torso with the head
 * clear of it rather than under it.
 */
export const SWIM_BODY_Y = WATER_SURFACE_Y - 0.1;

/**
 * Lowest the ocean surface ever dips.
 *
 * Ocean.tsx's WAVE_NOISE_GLSL sums four sines to a peak displacement of ~0.17
 * either side of {@link WATER_SURFACE_Y}, so this is the underside of the swell,
 * not the mean waterline.
 */
export const WAVE_TROUGH_Y = WATER_SURFACE_Y - 0.17;

/**
 * The highest a submerged object may reach.
 *
 * Anything above this pokes through a passing wave trough - and because the
 * water planes are depth-tested (`transparent`, `depthWrite: false`), the water
 * behind it then fails the depth test and is discarded, so the object renders
 * *un-watered* for as long as the trough is over it. Every submerged thing in
 * the scene - the fish shoal, the reef, the bubbles - is fitted under this.
 */
export const MAX_SUBMERGED_TOP_Y = WAVE_TROUGH_Y - 0.05;

/**
 * Outer rim of Island.tsx's SandEdge cylinder, where the beach goes under the
 * water and the sea floor takes over. Unscaled - multiply by islandScale.
 */
export const SAND_FOOT_RADIUS = 7.07;

/**
 * World Y the sea floor meets the island at.
 *
 * Island.tsx's underside is an opaque disc of radius `ISLAND_TERRAIN.baseRadius`
 * at y = -0.7, and the seabed is a ring starting at that same radius - so the
 * two never overlap in plan view, but they are still kept MIN_SURFACE_SEPARATION
 * apart vertically so no float wobble at the shared rim can put them in the same
 * place.
 */
export const SEABED_JOIN_Y = -0.75;

/** Depth the sea floor levels off at. Past here the water is too murky to read. */
export const SEABED_MIN_DEPTH = -3.8;

/**
 * How steeply the floor falls away, in metres of depth per metre of radius.
 *
 * A PLAIN CONSTANT SLOPE, on purpose. This started out as an exponential
 * drop-off (a ~1.6m fall inside the first 1.2m past the beach, on the reasoning
 * that a real fringing reef does that and that the extra depth buys the coral
 * headroom) and it was wrong for this scene: a near-vertical wall right at the
 * waterline turns the island into a plinth, and instead of an island sitting in
 * the sea it read as a lump of rock hauled up off the sea floor. 0.23 is a
 * ~13-degree shelf - gentle enough that the eye reads it as the seabed simply
 * getting deeper, and it still clears 2.5m of headroom by the outer reef.
 *
 * The cost is real and is paid deliberately: the innermost planting band only
 * gets ~0.6m of headroom, so coral near the shore is small and grows taller
 * further out. That happens to be what a real reef does anyway.
 */
const SEABED_SLOPE = 0.23;

/**
 * World Y of the sea floor at horizontal distance `r` from the origin.
 *
 * The single authority on "how deep is it here". OceanDecorations seats every
 * plant, coral and pebble with it, and Fish.tsx clamps the shoal above it - so
 * neither can end up buried in the sand when this profile is retuned.
 *
 * Y is never scaled by islandScale (Island.tsx doesn't scale Y either); only the
 * radius at which the slope starts moves with the island.
 *
 * @param r world horizontal distance from the origin (already includes islandScale)
 * @param islandScale the territory-level scale applied to the island's XZ
 */
export function seabedY(r: number, islandScale: number): number {
  const d = Math.max(0, r - SAND_FOOT_RADIUS * islandScale);
  return Math.max(SEABED_MIN_DEPTH, SEABED_JOIN_Y - SEABED_SLOPE * d);
}
