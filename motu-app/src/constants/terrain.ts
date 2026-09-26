/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The island's vertical contract, and the shared rules for drawing anything
 * that lies flat ON a surface.
 *
 * ## Why this file exists
 *
 * `characterMovement.ts` already documents the land contract ("grass plateau
 * top is y 0.3 out to r 5.7") and says it is "matched to Island.tsx's meshes"
 * so the two cannot drift. They had drifted anyway: Island.tsx stacked two more
 * terrain cylinders on top of the body, one of them with its top face just
 * 0.02 above the plateau, and every decoration then hard-coded its own guess at
 * where the ground was (`yBase = 0.3` in two places, a bare `0.31` in a third).
 *
 * That produced the two failure modes this module exists to prevent:
 *
 *   1. **Z-fighting.** Two opaque surfaces 0.02 apart across a disc of radius
 *      4.5 is far below the depth resolution available at the distances the
 *      island camera pulls back to, so the whole plateau flickered between two
 *      greens as the camera moved.
 *   2. **Buried decals.** A stepping stone at a hard-coded y=0.31 is *above*
 *      one terrain layer and *below* another, so the same path had stones that
 *      z-fought near the shore and stones that vanished entirely inland.
 *
 * Both are the same root cause: no single answer to "how high is the ground
 * here?". This file is that answer. Terrain meshes are generated from
 * {@link ISLAND_TERRAIN}, and anything drawn on the ground asks
 * {@link getIslandSurfaceY} rather than guessing.
 */

/**
 * World Y of the flat grass plateau - the surface the character actually walks
 * on, and the height `characterMovement.getTerrainInfo` returns for 'grass'.
 *
 * This is the one number the island's art and its collision agree on. Changing
 * it means changing `characterMovement.ts` in the same commit.
 */
export const ISLAND_SURFACE_Y = 0.3;

/**
 * Minimum vertical clearance between two *opaque* surfaces that overlap in
 * plan view and both write depth.
 *
 * Below this, the pair is a z-fighting defect and must be fixed structurally -
 * by merging the surfaces or deleting the hidden one - not by nudging one of
 * them apart. `scripts/audit-zfighting.mjs` flags anything closer.
 *
 * The value is not arbitrary: the island camera sits ~25-40 units out with
 * near=0.3/far=200, where a 24-bit depth buffer resolves roughly 1e-4 units.
 * 0.05 clears that by three orders of magnitude, which also covers the much
 * coarser precision the mobile 16-bit depth path can fall back to.
 */
export const MIN_SURFACE_SEPARATION = 0.05;

/**
 * How far a decal is lifted off the surface it lies on.
 *
 * A decal is a flat thing drawn *on* another flat thing - a stepping stone, a
 * footstep ring, a selection ring, a rug. It is coplanar by design, so unlike
 * the case above it cannot be fixed by restructuring the geometry: the two
 * surfaces are *supposed* to be in the same place. Decals are therefore the one
 * legitimate use of {@link DECAL_DEPTH_BIAS}, and this lift handles the
 * lighting/shadow half of the same problem (a decal at exactly the surface Y
 * picks up z-fighting in the shadow map too, which no polygon offset on the
 * colour pass can help with).
 *
 * Kept well under the ~0.1 at which a decal starts to read as *hovering* at
 * this camera distance, and well over the depth-buffer resolution.
 */
export const SURFACE_DECAL_LIFT = 0.02;

/**
 * Rasterizer depth bias for decals, spread onto a material.
 *
 * `polygonOffset` biases a surface's depth values toward the camera at
 * rasterization time, so a decal wins against whatever it lies on no matter how
 * coarse the depth buffer is out there. This is the correct tool for
 * coplanar-by-design geometry and nothing else - it must never be used to paper
 * over two surfaces that are accidentally in the same place, because it only
 * fixes the pair it is applied to and hides the modelling error from review.
 *
 * Usage: `<meshStandardMaterial color="..." {...DECAL_DEPTH_BIAS} />`
 *
 * For a decal stacked on another decal (a rug's inner panel over its border),
 * override `polygonOffsetUnits` with a *more negative* value so the upper layer
 * still wins - see FurnitureItem's WovenRugModel.
 */
export const DECAL_DEPTH_BIAS = {
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -4,
} as const;

/**
 * A raised terrain feature sitting on the plateau, in the island's *unscaled*
 * local frame (the frame inside Island.tsx's `scale={[islandScale, 1, islandScale]}`
 * group). Y is never scaled, only XZ.
 */
export type TerrainMound = {
  /** Centre in unscaled local XZ. */
  cx: number;
  cz: number;
  /** Radius of the flat top. */
  radiusTop: number;
  /** Radius where the skirt meets the plateau. */
  radiusBottom: number;
  /** World Y of the mound's flat top. */
  topY: number;
};

/**
 * How far a mound's frustum is sunk below the plateau, so it reads as ground rising out of the
 * island rather than as a disc set down on it.
 *
 * Here rather than in Three/Island.tsx (which is where it used to be, as a bare `- 0.2`) because
 * it is half of the mound's SLOPE, and the slope is what the walk height has to agree with: the
 * skirt falls from `topY` to this depth across `radiusBottom - radiusTop`, and a height function
 * that assumes any other drop puts the feet somewhere the mound is not. See getIslandSurfaceY.
 */
export const MOUND_BASE_SINK = 0.2;

/**
 * The island's terrain, as data rather than as meshes buried in JSX.
 *
 * `Island.tsx` builds its geometry from this and `getIslandSurfaceY` reads the
 * same numbers, so a mound cannot be drawn in one place and missed by the
 * things that stand on it.
 *
 * Note what is *not* here: the old "Terrain Layer" cylinder whose top sat at
 * y=0.32. It was a second full disc of radius 4.5 lying 0.02 above the plateau
 * - a duplicate surface that contributed nothing but a colour and a depth
 * conflict. Its colour is now a vertex-coloured band on the single plateau
 * surface (see `PLATEAU_INNER_COLOR`), which is how the sand edge has always
 * handled its own colour transition.
 */
export const ISLAND_TERRAIN = {
  /** Radius of the flat walkable plateau. Mirrors characterMovement's GRASS_RADIUS. */
  plateauRadius: 5.7,
  /** Radius of the body's base, where it meets the sand cone. */
  baseRadius: 6.84,
  /** World Y of the body's underside. */
  baseY: -0.7,
  /**
   * Radius out to which the plateau is tinted with the inner (lighter) green,
   * and the radius the tint has fully faded to the outer green by. These
   * reproduce the deleted layer's r=4.5 top and r=4.8 base exactly.
   */
  innerTintRadius: 4.5,
  innerTintFadeRadius: 4.8,
  /**
   * Raised mounds standing proud of the plateau. The single entry here clears
   * MIN_SURFACE_SEPARATION against the plateau by 0.1, so it is a genuine
   * elevation rather than a coplanar duplicate, and it stays.
   */
  mounds: [
    { cx: -2, cz: -1.5, radiusTop: 2.5, radiusBottom: 2.7, topY: 0.4 },
  ] as TerrainMound[],
} as const;

/** Plateau green outside the tinted centre - the island body's own colour. */
export const PLATEAU_OUTER_COLOR = '#3f6212';
/** Plateau green in the tinted centre - inherited from the deleted terrain layer. */
export const PLATEAU_INNER_COLOR = '#4d7c0f';
/**
 * Mound green.
 *
 * Pulled in from `#65a30d` toward the plateau's own greens during the 地表質感 pass. At the old
 * value the mound was a markedly lighter green than everything around it, and once the plateau
 * gained its procedural variation that became the most conspicuous thing on the island: a clean,
 * uniform, brighter disc sitting on a mottled lawn reads as a decal stuck to the ground rather
 * than as ground that is 10 cm higher.
 *
 * It is still lighter, because a rise genuinely does catch more light and dry out faster — but
 * the difference is now small enough that Three/groundMaterial.ts's grading (which runs a little
 * drier on the mound for the same reason) carries it, instead of a flat colour step doing all
 * the work.
 */
export const MOUND_COLOR = '#5a8f14';

/**
 * World Y of the topmost *rendered* island surface at a world XZ.
 *
 * This is what anything lying on the ground must use to find its own height -
 * stepping stones, garden paths, footstep rings, placement indicators. It is
 * deliberately the height of the surface that is actually *drawn*, which past
 * the plateau edge is not the same as the height the character is placed at
 * ({@link getTerrainInfo}): the sand cone the renderer draws and
 * the walk height are different curves out there by design.
 *
 * @param x world X (already multiplied by islandScale)
 * @param z world Z
 * @param islandScale the territory-level scale applied to the island's XZ
 */
export function getIslandSurfaceY(x: number, z: number, islandScale: number): number {
  // Mounds are authored in the unscaled local frame, so compare in that frame.
  const lx = x / islandScale;
  const lz = z / islandScale;

  let y = ISLAND_SURFACE_Y;
  for (const m of ISLAND_TERRAIN.mounds) {
    const d = Math.hypot(lx - m.cx, lz - m.cz);
    if (d <= m.radiusTop) {
      y = Math.max(y, m.topY);
    }
    // Between radiusTop and radiusBottom the mound is a skirt, not a flat top.
    // Anything landing on the slope is placed at the slope's height so it does
    // not float over the low side or sink through the high one.
    //
    // The skirt is the DRAWN frustum's, which falls to MOUND_BASE_SINK below the
    // plateau rather than to the plateau itself - the lower part of the cone is
    // buried, and what a walker sees out here is the plateau that buries it,
    // which the Math.max already selects. Ramping to ISLAND_SURFACE_Y instead
    // (the previous form) described a slope a third as steep as the one on
    // screen, so the walkable ramp reached ~13cm further out than the visible
    // one and the feet rode up to 7cm above the ground over that ring.
    else if (d < m.radiusBottom) {
      const t = (d - m.radiusTop) / (m.radiusBottom - m.radiusTop);
      y = Math.max(y, m.topY + (ISLAND_SURFACE_Y - MOUND_BASE_SINK - m.topY) * t);
    }
  }
  return y;
}

/**
 * World Y at which to draw a decal lying on the island's surface at a world XZ.
 *
 * Pair with {@link DECAL_DEPTH_BIAS} on the decal's material - this handles the
 * shadow/lighting half, that handles the depth half.
 */
export function getIslandDecalY(x: number, z: number, islandScale: number): number {
  return getIslandSurfaceY(x, z, islandScale) + SURFACE_DECAL_LIFT;
}

// --- Terrain zones ---------------------------------------------------------

/**
 * The island's concentric zones, as radii in world units BEFORE islandScale is applied.
 * Every terrain/water decision in the game derives from these three numbers, so the
 * boundaries the renderer draws and the boundaries the character is judged against cannot
 * drift apart the way three separately hard-coded copies of `6.8` would.
 *
 * They live here, alongside {@link ISLAND_TERRAIN} and {@link getIslandSurfaceY}, rather than
 * in the character controller that used to own them: the height of the ground and the extent
 * of the ground are one contract, and the placement system needs both without having to reach
 * into movement code. `characterMovement.ts` re-exports them, so the character keeps reading
 * exactly the numbers the island is drawn from.
 *
 * Matched to Island.tsx's meshes:
 *   - Grass plateau a single flat disc at y = ISLAND_SURFACE_Y (0.3) out to
 *                   r = ISLAND_TERRAIN.plateauRadius (5.7).
 *   - Sand edge     cylinder(rTop 5.93, rBottom 7.07, h 0.8) at y -0.25.
 *   - Ocean plane   y = WATER_SURFACE_Y (-0.5), which cuts that sand cone at r ~= 6.86.
 *
 * SHORELINE_RADIUS is therefore the real, visible waterline: inland of it the sand is dry
 * and above water, outside it the sand is submerged. It is THE land/water boundary, and
 * nothing may put the character in a water state while it stands inside it.
 */
export const GRASS_RADIUS = ISLAND_TERRAIN.plateauRadius;
export const SHORELINE_RADIUS = 6.8;

/**
 * How far out to sea the player may swim, as a radius from the world origin. It is both the
 * water/deepWater line in getTerrainInfo and the hard leash resolveCollisions clamps swimmers
 * to, so the seabed the character is told it is over always matches the area it can reach.
 *
 * Sized so the island stays comfortably in frame at the far edge rather than by how much sea
 * exists: the third-person camera trails the player by 7 units (CameraController) through a
 * 25deg vertical FOV, so from the leash the island's 6.8 radius still subtends about two thirds
 * of the half-view. Ocean.tsx covers this easily - its fine near-sea mesh runs to COAST_RADIUS
 * + 45 and the far sea plane is 2000 across - so raising this only widens where the *player*
 * may go, with no new geometry needed to swim over.
 */
export const SWIMMABLE_RADIUS = 18.0;

export interface TerrainInfo {
  terrain: 'grass' | 'sand' | 'water' | 'deepWater';
  targetY: number;
}

export function getTerrainInfo(x: number, z: number, islandScale: number): TerrainInfo {
  const dist = Math.sqrt(x * x + z * z);
  const grassRadius = GRASS_RADIUS * islandScale;
  const sandRadius = SHORELINE_RADIUS * islandScale;
  const swimmableWaterRadius = SWIMMABLE_RADIUS * islandScale;

  if (dist <= grassRadius) {
    // The plateau is not flat everywhere: ISLAND_TERRAIN.mounds raises the *drawn* ground
    // around (-2, -1.5), and this used to return a flat 0.3 regardless, so the character
    // waded through the mound while decorations correctly stood on top of it. Reading the
    // same function the renderer builds from is what removes that whole class of mismatch -
    // and it is the reason a wooden deck can be ground too (see lib/placementSurfaces.ts):
    // "how high is the surface here" has one answer for the art, the props and the player.
    return { terrain: 'grass', targetY: getIslandSurfaceY(x, z, islandScale) };
  } else if (dist <= sandRadius) {
    // Graceful slope interpolation from grass (0.3) to beach water line edge (0.02)
    const t = (dist - grassRadius) / (sandRadius - grassRadius);
    const targetY = ISLAND_SURFACE_Y + (0.02 - ISLAND_SURFACE_Y) * t;
    return { terrain: 'sand', targetY };
  } else if (dist <= swimmableWaterRadius) {
    // Seabed continues the beach slope down from the waterline instead of jumping
    // straight to swim depth. This matters for the swim-state hysteresis band just
    // past sandRadius, where the character is standing in the shallows but still
    // classified 'walking': with a flat -0.6 here, resolveCollisions handed that
    // walking character the SWIM depth as its ground height, sinking the avatar
    // bodily into the shore the moment it touched the waterline. A doubled beach
    // gradient (clamped at swim depth) keeps the shallows ankle-to-knee deep
    // through the band; actual swimmers never read this value (their height comes
    // from the swim branch), and the enter/exit transitions now blend from a
    // wading height instead of from an already-sunken one.
    const beachSlope = (ISLAND_SURFACE_Y - 0.02) / (sandRadius - grassRadius);
    const targetY = Math.max(-0.6, 0.02 - (dist - sandRadius) * beachSlope * 2);
    return { terrain: 'water', targetY };
  } else {
    return { terrain: 'deepWater', targetY: -1.0 };
  }
}

/** Is this terrain zone dry land an object can be stood on? */
export function isLandTerrain(terrain: TerrainInfo['terrain']): boolean {
  return terrain === 'grass' || terrain === 'sand';
}

/**
 * The island's stepping-stone path, in unscaled island units.
 *
 * Layout data rather than art: the stones are drawn by Three/IslandDecorations.tsx, but where the
 * path RUNS is also the answer to 「哪裡是走道」, which the offline-overgrowth siting rules need in
 * order to keep weeds off it (lib/islandOvergrowth.ts). It lives here, beside the terrain the path
 * is laid on, so neither side owns the other and neither can drift.
 *
 * Multiply X/Z by islandScale at the point of use, exactly as the renderer does.
 */
export const PATHWAY_BASE_POINTS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [0.5, 0, 1], [1.2, 0, 2], [2, 0, 3], [3, 0, 3.5], [4, 0, 3.8],
  [-0.8, 0, -1], [-1.5, 0, -2], [-2.5, 0, -2.8], [-4, 0, -3.2],
];
