/**
 * Placement rules and collision resolution utilities for buildings and island decorations.
 * Designed and structured for clear expandability and future integration with a real-time
 * dynamic grid/placement system.
 */

import { HouseStyleFootprint } from '../constants/houseStyles';
import { PLAYER_COLLIDER_RADIUS } from '../constants/characterRig';

/**
 * The player's Home as an obstacle these rules must route around.
 *
 * Structurally compatible with ResolvedHome (hooks/usePlayerHome.ts) but declared locally so
 * this module stays free of React/three imports and can keep being called from imperative
 * solvers. `null` means the Home hasn't been placed yet, in which case the whole island is free.
 */
export interface HomeObstacle {
  position: [number, number, number];
  rotation: number;
  footprint: HouseStyleFootprint;
}

/**
 * The player's collision radius — how far their centre is held off anything solid.
 *
 * One number for the whole game: the interior walls and furniture, the island's props, and the
 * Home's solid box all inflate by exactly this, so "how close can I get" is the same answer
 * everywhere. `characterMovement.ts` reads it rather than keeping its own 0.35.
 *
 * Re-exported from the rig rather than declared here, because it is a measurement of the
 * CHARACTER and this file is about placement. Keeping it with the rest of the character's
 * dimensions makes swapping the model one file to review instead of a search for whichever
 * number each system happened to keep — see PLAYER_COLLIDER_RADIUS in constants/characterRig.ts,
 * which also explains why the collider is deliberately NOT derived from the model's mesh.
 * The name stays: it reads correctly at every call site and the value has not changed.
 */
export const PLAYER_PHYSICAL_RADIUS = PLAYER_COLLIDER_RADIUS;

/**
 * The **solid** half-extents of a Home: its footprint inflated by the player's physical radius.
 *
 * A Home is a completely closed box — there is no walk-through doorway, since the interior is
 * entered through the "進入我的家" interaction rather than by stepping into the mesh. This is the
 * single definition of "how big is the thing the player cannot pass through", used by the walk
 * collision (resolveHomeCollision) and by the model when it needs to know where the player will
 * be stopped (HouseModel's perimeter fence).
 *
 * Inflating by the player's radius is what makes the wall feel solid rather than absorbent:
 * collision moves the avatar's *centre*, so a box at the raw footprint stops that centre on the
 * wall plane and leaves half the body buried in the building. The margin also clears the deepest
 * eave any style draws (halfWidth + 0.30, on the hip roof), so the player is never stopped by
 * thin air under an overhang, nor able to walk through one.
 *
 * Every House Style shares one footprint, so this yields one collision rule for all of them.
 */
export function getHomeSolidHalfExtents(footprint: HouseStyleFootprint): {
  halfWidth: number;
  halfDepth: number;
} {
  return {
    halfWidth: footprint.halfWidth + PLAYER_PHYSICAL_RADIUS,
    halfDepth: footprint.halfDepth + PLAYER_PHYSICAL_RADIUS,
  };
}

/**
 * Is this world XZ inside the Home's solid box, plus `margin`?
 *
 * Extracted from `isPlacementAllowed` below when the ground-cover scatter needed the same test:
 * a grass tuft has no business running the furniture solver's spiral search, but it absolutely
 * must not stand inside the house, and re-deriving "inside the house" from the footprint is how
 * two answers to one question get into a codebase.
 *
 * Evaluated in the Home's LOCAL space, so a rotated Home keeps a correctly-oriented footprint —
 * the fixed-slot houses this replaced were always axis-aligned and used raw world deltas.
 *
 * Note what it does NOT include: the door lane. That is a rule about REACHING the house, which
 * matters for anything the player has to walk up to and not at all for grass.
 */
export function isInsideHomeKeepOut(
  x: number,
  z: number,
  home: HomeObstacle | null,
  margin: number,
): boolean {
  if (!home) return false;
  const rx = x - home.position[0];
  const rz = z - home.position[2];
  const cos = Math.cos(-home.rotation);
  const sin = Math.sin(-home.rotation);
  const localX = rx * cos - rz * sin;
  const localZ = rx * sin + rz * cos;
  const solid = getHomeSolidHalfExtents(home.footprint);
  return Math.abs(localX) < solid.halfWidth + margin && Math.abs(localZ) < solid.halfDepth + margin;
}

/*
 * DELETED: getVisualBounds / getCollisionBounds / getObjectBounds.
 *
 * A pair of name-keyed size tables — `if (name === '木製平台') halfWidth = 2.0` and so on for ten
 * decorations — describing the same objects as three other tables elsewhere in the app, in three
 * different sets of numbers, and called by nothing. Every one of them was wrong: the platform's
 * real half-extent is 2.64, not the 2.0 declared here, because BUILDING items are drawn at 1.32x
 * scale and a hand-typed table cannot know that.
 *
 * Placement bounds are measured off the model now (lib/furniturePlacement.ts), and the rules that
 * consume them live in lib/placementSurfaces.ts.
 *
 * DELETED: validateWalkablePassageBetweenBuildings / ensureMinimumBuildingGap — rules about
 * keeping a corridor between two houses, from the two-house era. There is one Home.
 */

/**
 * The radius of the walkable, flat Grass Terrain disc (matches Avatar.tsx's getTerrainInfo
 * and Island.tsx's grass mesh). Natural decorations are placed at a fixed Y, so they must
 * stay within this flat region — the sand ring beyond it is sloped and would leave them
 * floating above or sunk below the actual surface.
 */
export function getGrassTerrainRadius(islandScale: number = 1.0): number {
  return 5.7 * islandScale;
}

/**
 * Check if a point lies on the flat Grass Terrain (not on the sloped sand, water, or open sea).
 */
export function isValidTerrainPosition(x: number, z: number, islandScale: number = 1.0): boolean {
  const dist = Math.sqrt(x * x + z * z);
  const grassRadius = getGrassTerrainRadius(islandScale);
  return dist < grassRadius - 0.4; // leave 0.4 units safety margin from the grass/sand edge
}

/**
 * Draws a uniformly-distributed random point within the circular Grass Terrain area
 * (not a bounding square), so every candidate starts out on valid island ground.
 *
 * `rng` defaults to Math.random. A caller whose layout has to come back the same after a reload
 * (the island's wildflowers and rocks) passes a seeded one instead.
 */
export function getRandomGrassTerrainPoint(
  islandScale: number = 1.0,
  margin: number = 0.4,
  rng: () => number = Math.random,
): [number, number] {
  const radius = Math.max(0, getGrassTerrainRadius(islandScale) - margin);
  const r = Math.sqrt(rng()) * radius;
  const theta = rng() * Math.PI * 2;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

/**
 * Find the nearest valid placement for an object when squeezed out by the player's Home.
 * Performs a spiral radial search for a location that is far enough from the Home and its door.
 * Includes explicit rulechecks:
 * - Must be on walkable, safe land (no deep ocean water)
 * - Must not overlap the Home or block its entrance
 * - Must not overlap other major collidable objects
 *
 * The old "keep the corridor between the two houses clear" rule is gone with the two-house
 * layout it existed to protect - there is exactly one Home now, so there is no corridor.
 */
export function findNearestValidPlacement(
  name: string,
  desiredPosition: [number, number, number],
  home: HomeObstacle | null,
  islandScale: number = 1.0,
  otherObjects: Array<[number, number, number]> = []
): [number, number, number] {
  const [origX, origY, origZ] = desiredPosition;

  // If it's already perfectly valid, keep it!
  if (isPlacementAllowed(name, [origX, origY, origZ], home, islandScale, otherObjects)) {
    return [origX, origY, origZ];
  }

  // Spiral search parameters
  const step = 0.35;
  const maxRadius = 12.0;

  for (let r = step; r < maxRadius; r += step) {
    // Scan angles
    const angleDivider = Math.max(8, Math.floor(r * 4));
    for (let k = 0; k < angleDivider; k++) {
      const angle = (k * Math.PI * 2) / angleDivider;
      const scanX = origX + Math.cos(angle) * r;
      const scanZ = origZ + Math.sin(angle) * r;

      if (isPlacementAllowed(name, [scanX, origY, scanZ], home, islandScale, otherObjects)) {
        return [scanX, origY, scanZ];
      }
    }
  }

  // Fallback return if we somehow can't find anything better
  return [origX, origY, origZ];
}

/**
 * Picks a valid spawn point for a naturally-scattered decoration (flowers, rocks, etc.).
 * Instead of sampling a rectangular box and hoping the point lands on the island, this
 * draws points directly from the circular Grass Terrain area and re-rolls a fresh random
 * point whenever a candidate can't be resolved onto valid land — it never falls back to
 * spawning at an out-of-bounds position.
 */
export function findRandomValidPlacement(
  name: string,
  home: HomeObstacle | null,
  islandScale: number = 1.0,
  otherObjects: Array<[number, number, number]> = [],
  y: number = 0.35,
  maxAttempts: number = 40,
  /** Where the candidates come from — see getRandomGrassTerrainPoint. */
  rng: () => number = Math.random
): [number, number, number] {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const [x, z] = getRandomGrassTerrainPoint(islandScale, 0.4, rng);
    const resolved = findNearestValidPlacement(
      name,
      [x, y, z],
      home,
      islandScale,
      otherObjects
    );

    if (isValidTerrainPosition(resolved[0], resolved[2], islandScale)) {
      return resolved;
    }
    // Otherwise the spiral search couldn't resolve this attempt onto valid land — re-roll.
  }

  // Guaranteed-safe last resort: the island center is always on grass terrain.
  return [0, y, 0];
}

/**
 * Inner rules-check function to validate placement constraints
 */
function isPlacementAllowed(
  name: string,
  pos: [number, number, number],
  home: HomeObstacle | null,
  islandScale: number,
  otherObjects: Array<[number, number, number]>
): boolean {
  const [x, y, z] = pos;

  // 1. Must be on valid terrestrial land
  if (!isValidTerrainPosition(x, z, islandScale)) {
    return false;
  }

  // 2. Must clear the player's Home and the lane in front of its door. Evaluated in the Home's
  //    local space so a rotated Home keeps a correctly-oriented footprint and approach path -
  //    the old fixed-slot houses were always axis-aligned, so this used raw world deltas.
  if (home) {
    const fp = home.footprint;
    const rx = x - home.position[0];
    const rz = z - home.position[2];
    const cos = Math.cos(-home.rotation);
    const sin = Math.sin(-home.rotation);
    const localX = rx * cos - rz * sin;
    const localZ = rx * sin + rz * cos;

    // Measured against the SOLID box, not the raw footprint: a prop dropped in the shell between
    // the wall and the player's stop line is unreachable, since collision holds the player out
    // past it. Small scattered flora may hug that line more closely than furniture-sized props.
    const safetyMargin = name.includes('Flora') || name.includes('Flower') ? 0.3 : 0.6;

    if (isInsideHomeKeepOut(x, z, home, safetyMargin)) {
      return false;
    }

    // Keep the approach to the front door walkable.
    const isAtDoorX = Math.abs(localX) < fp.doorLaneWidth + 0.05;
    const isAtDoorZ = localZ > fp.halfDepth * 0.6 && localZ < fp.doorOffsetZ + 1.2;
    if (isAtDoorX && isAtDoorZ) return false;
  }

  // 3. Must not overlap too closely with other mapped props
  for (const other of otherObjects) {
    const dx = x - other[0];
    const dz = z - other[2];
    const distSq = dx * dx + dz * dz;
    const minObjectDist = 0.5; // Avoid clustered duplicate overlaps
    if (distSq < minObjectDist * minObjectDist) {
      return false;
    }
  }

  return true;
}

/*
 * DELETED: resolveObjectOverlap — a no-op that returned its own argument, and `PlacedObject`,
 * the type it took. Overlap between placed objects is decided by the measured-box rule in
 * lib/placementSurfaces.ts.
 */

/**
 * How big the i-th outcrop is drawn — the `scale` on its dodecahedron mesh.
 *
 * Shared because the rock is drawn in Three/Island.tsx and WALKED ON in Three/characterMovement.ts,
 * and both need the same size. They each had their own copy of this expression, which is the kind
 * of duplication that stays correct right up until someone resizes the rocks in one of them.
 */
export const getRockScale = (i: number): number => (0.5 + (i % 3) * 0.2) * 0.5;

/**
 * Ratio of a regular dodecahedron's INSPHERE to the circumradius three.js builds it at
 * (`dodecahedronGeometry(1)` puts its vertices on the unit sphere).
 *
 * The rock's walkable surface uses the insphere rather than the circumsphere because the two
 * mistakes are not equal: the insphere is entirely inside the solid, so the feet may end up a
 * few centimetres INSIDE a rock — invisible — where the circumsphere would hold them the same
 * few centimetres above one, which is the thing that reads as broken.
 */
export const DODECAHEDRON_INSPHERE = 0.7946544722917661;

/**
 * Resolves rock positions dynamically using the placement rules to avoid overlapping the Home.
 */
export function getResolvedRockPositions(
  islandScale: number = 1.0,
  home: HomeObstacle | null = null
): [number, number, number][] {
  const baseRocks: [number, number, number][] = [
    [3.5, 0.2, 2.5],
    [-4, 0.3, 3],
    [2, 0.25, -4.5],
    [-3.8, 0.2, -3.2],
    [5, 0.1, 0.5],
    [-1.5, 0.2, 5.2],
    [0.5, 0.3, -5.5]
  ];
  
  const resolved: [number, number, number][] = [];
  
  for (const rock of baseRocks) {
    const desired: [number, number, number] = [rock[0] * islandScale, rock[1], rock[2] * islandScale];
    const res = findNearestValidPlacement(
      '大石塊',
      desired,
      home,
      islandScale,
      resolved // prevent rocks from nesting directly on each other
    );
    resolved.push(res);
  }
  
  return resolved;
}
