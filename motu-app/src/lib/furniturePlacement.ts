/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { PlacedItem } from '../types';
import { isBrushPastItem, isStandableItem } from '../constants/items';
import { getPlacementLayer } from '../constants/placement';
import {
  ConvexShape,
  PlacedShape,
  convexHull2D,
  createPlacedShape,
  makeConvexShape,
  placeShape,
  pushCircleOutOfShape,
  rectangleShape,
  shapeContainsPoint,
  shapesOverlap,
  signedDistanceToShape,
  simplifyConvex,
} from './collisionShape';
import { sharedSingleton } from './sharedRegistry';

/**
 * Furniture footprints and the overlap rule that keeps two pieces from being
 * placed inside each other.
 *
 * WHY THIS EXISTS: interior placement used to snap a piece to a 0.5 grid
 * (BuildingInteriorView's handleFloorClick/handleFloorHover) and write it with
 * no occupancy test whatsoever. Nothing was the size of one grid step — the
 * 奢華沙發 alone is 2.2 x 1.0 local units — so two pieces one step apart
 * physically interpenetrated. Where their faces ended up near-parallel and
 * near-coincident the depth buffer had no meaningful ordering between them and
 * the overlap flickered between the two as the camera moved (z-fighting). The
 * cure is not a depth-buffer tweak: it is refusing to put two solids in the
 * same place, which is what this module decides.
 *
 * FOOTPRINTS ARE MEASURED, NOT TYPED IN. A hand-maintained table of sizes goes
 * stale the moment someone edits a model in FurnitureItem.tsx, and a stale
 * footprint fails in the direction that reintroduces the bug. Instead each
 * item's local XZ box is measured once from the real scene graph the first
 * time that item is mounted (`measureFootprint`), so the collision box is by
 * construction whatever is actually being drawn.
 */

/*
 * MOVED: PlacementLayer, ITEM_LAYERS, getPlacementLayer, LAYER_Y_OFFSET → constants/placement.ts.
 *
 * `ITEM_LAYERS` was a hand-keyed `Record<itemId, PlacementLayer>` sitting in this file, and it was
 * the only place in the game that knew a painting was a wall thing. That was tolerable while a
 * layer decided only what a piece could OVERLAP; it stopped being tolerable once the same fact had
 * to decide where the piece could be PUT, because then a collision table in a physics module was
 * silently the authority on catalog behaviour. An item now declares what it mounts to alongside
 * its price and its name, and the layer is derived from that — so the two can no longer disagree.
 */

/**
 * An item's extent in its own un-rotated local frame: the XZ box centre (which
 * is NOT always the origin — a wall shelf hangs off to one side), its XZ
 * half-extents, and the vertical band it occupies.
 *
 * Y is kept because two pieces that share ground area but not height are not
 * in each other's way: a 復古提燈 standing on a 床頭小櫃 is a legitimate
 * arrangement (the nightstand's own description recommends exactly that), and
 * a rule that only looked at ground area would have to refuse it.
 *
 * `walk` is the same box narrowed to the geometry a walking character can
 * actually run into — see WALK_BAND_MIN_Y. `null` when nothing the item is made
 * of stands in that band, which is the honest answer for a rug or a hanging
 * lamp.
 */
export type Footprint = {
  cx: number;
  cz: number;
  halfW: number;
  halfD: number;
  minY: number;
  maxY: number;
  /**
   * The height a BODY standing on this piece rests at — the walking surface, not the top of
   * the model.
   *
   * These are different numbers the moment a piece has anything sticking up out of its floor,
   * and 小型觀景平台 is exactly that piece: a deck at 0.90 with railings whose posts reach
   * 1.74. `maxY` is 1.74, so a player who walked onto it stood 0.84 above the boards — 39% of
   * their own height, in mid-air, level with the top of the handrail. 木製平台 got away with
   * `maxY` only because it has no railing; its own doc comment pins the deck top at the model
   * maximum, which was a constraint the NEXT deck could not keep.
   *
   * Measured, not declared — see {@link measureStandTop} for what "a surface you can stand on"
   * is reduced to. `null` when nothing in the model can hold a body, which is the honest answer
   * for a flower.
   */
  standY: number | null;
  /**
   * A `standable` piece, part by part: what each mesh a body can meet is, and whether a foot fits
   * on top of it. `null` for everything that is not ground, which is nearly the whole catalog.
   *
   * This is what a standable piece is COLLIDED against. It replaced "the whole model's outline at
   * `standY`", which answered two questions with one polygon and got both wrong the moment a deck
   * had anything but boards: the railings, posts and stairs of 小型觀景平台 were inside that
   * outline, so they were floor (the player walked straight through all three rails and floated at
   * deck height over the stairs), and nothing in it was ever a wall, so a 0.9-high deck was
   * climbed in one frame from any side. See {@link STAND_RULES} for how parts become floor or wall.
   */
  standParts: StandPart[] | null;
  /**
   * The walking surface of a standable piece, sampled on a grid in its own frame: `[x, z, top, …]`
   * where `top` is the height of the UPPERMOST tread at that point (a board, not the joist under
   * it). `null` for anything that is not ground.
   *
   * It is what placement uses to keep a deck's boards out of the ground under them
   * (lib/placementSurfaces.ts' resolvePlacementY) — the one question about a deck that has to be
   * asked everywhere under it at once, rather than at the point the pointer is on.
   */
  standSurface: Float32Array | null;
  walk: WalkBox | null;
  /**
   * The real collider: the model's own silhouette on the XZ plane, as a convex outline rather
   * than the box above. See lib/collisionShape.ts for why a box is wrong for anything round,
   * thin or diagonal — and see {@link slabs} for why one outline is not enough either.
   *
   * The box fields are kept alongside it, derived from this, because a handful of consumers only
   * ever need "how wide, roughly" (a minimap marker, a rain-shelter test). Nothing that decides
   * whether a placement is legal or where a body is stopped uses them any more.
   */
  shape: ConvexShape;
  /** {@link shape}, narrowed to the geometry inside the walk band. `null` when nothing is. */
  walkShape: ConvexShape | null;
  /**
   * How far the item reaches from its own ORIGIN, over every slab — the broad-phase reject.
   *
   * Measured from the origin rather than from any outline's centre, so it does not move when the
   * placement is turned: two placements further apart than the sum of their reaches cannot touch
   * at any pair of rotations, which is what makes it safe to skip the slab loop entirely.
   */
  reach: number;
  /**
   * The model cut into horizontal slabs, each carrying the outline of whatever the model is made
   * of at THAT height.
   *
   * This is what stops a wide top from claiming the ground under it. A 許願井 is a 1.3-wide stone
   * ring under a 2-wide roof; with one outline for the whole model, a flower a metre away is
   * inside the roof's plan and gets refused, although at flower height there is nothing there but
   * air. Two placements collide only where they are both actually present, which is the same rule
   * the vertical band test was already reaching for and could only state one slab deep.
   *
   * Always at least one slab, always in ascending Y, always covering `minY … maxY` exactly.
   */
  slabs: Slab[];
};

/** One horizontal cut of a model: the band it covers, and the outline it has inside that band. */
export type Slab = {
  /** Local Y, relative to the surface the item stands on. */
  y0: number;
  y1: number;
  shape: ConvexShape;
};

/**
 * One mesh of a `standable` piece, as the body meets it.
 *
 * Every dimension is measured off the model the same way the rest of the footprint is, in the
 * piece's own un-rotated frame, relative to the surface it stands on. Nothing here is typed in.
 */
export type StandPart = {
  /** Everything the mesh occupies on the XZ plane — what a body is stopped by. */
  outline: ConvexShape;
  /**
   * The mesh's own top face, when a foot fits on it (see {@link STAND_RULES.minTreadWidth}) —
   * what a body stands on. `null` for a handrail, a post cap, a fascia strip.
   */
  tread: ConvexShape | null;
  /** Local vertical extent. `y1` is the height of the tread when there is one. */
  y0: number;
  y1: number;
};

/**
 * HOW A BODY GETS ONTO, WALKS ON, AND IS STOPPED BY A `standable` PIECE.
 *
 * The rules are the whole configuration — no deck, stair or railing appears in any of them, and
 * a new piece of ground (a jetty, a gazebo, a stepped terrace) needs nothing but its model and
 * `standable` in the catalog. Every number is world units, because that is the frame the footprint
 * is measured in.
 *
 * ## The one rule
 *
 * A body standing at height `h` treats every part of a standable piece one of two ways:
 *
 *   - **floor**, when the part has a tread whose top is at most `h + maxStepUp` — it steps onto it;
 *   - **wall**, when the part's top is above `h + maxStepUp` and its bottom is below head height
 *     (`h + WALK_BAND_MAX_Y`) — it is pushed out of the part's outline like any other solid.
 *
 * The two cases are complementary by construction (one threshold decides both), so no part can be
 * floor and wall at once, and stairs fall out without being recognised as stairs: each tread is
 * one step above the last, so each is floor from the one below, and the deck they lead to is a wall
 * from the ground and floor from the top tread.
 */
export const STAND_RULES = {
  /**
   * The highest ledge a walking body steps up onto without climbing. Above it, the ledge is a wall.
   *
   * Two catalog facts pin it, and the audit checks both (scripts/audit-placements.ts, part 1d):
   *   - 木製平台 has no stairs and is meant to be walked onto from any side, so its deck (0.395
   *     above the grass) must be one step.
   *   - 小型觀景平台's deck is 0.90 up and reached by its stairs, so it must NOT be — otherwise the
   *     stairs are decoration and the railings are the only thing between the grass and the boards.
   * 0.42 is a little under half the character's leg, which is where a real step stops being a step.
   */
  maxStepUp: 0.42,
  /**
   * How far past the edge of a tread the body still stands on it — the reach of the feet, not of
   * the whole body. It is what closes the seams between deck boards (the widest in the catalog is
   * 92 mm, so anything over half of that works) and it is deliberately small: the torso may hang
   * over an edge, the soles may not.
   */
  footRadius: 0.12,
  /**
   * The narrowest top face a foot can be put on. Wider than every railing, post cap and fascia strip
   * in the catalog (≤ 0.10) and narrower than every plank and stair tread (≥ 0.39).
   */
  minTreadWidth: 0.2,
  /** How close to a mesh's highest vertex a vertex must be to count as part of its top face. */
  topFaceTolerance: 0.004,
} as const;

/** The part of a {@link Footprint} that blocks walking: an XZ box, no height. */
export type WalkBox = {
  cx: number;
  cz: number;
  halfW: number;
  halfD: number;
};

/**
 * The measured footprints, and the change signal views subscribe to.
 *
 * ONE registry per page, not one per module instance (see lib/sharedRegistry.ts). It is written by
 * the models as they mount and read by the character controller every frame through
 * lib/placementSurfaces.ts; when the dev server handed those two sides different instances of this
 * file, every platform was measured into a registry the player never read, and walked through.
 *
 * `version` is bumped whenever a new item type is measured, so a view can re-run its validity check
 * the moment a footprint it was missing becomes available (the first ghost of a given item mounts
 * and measures in the same commit that first asks whether it collides).
 */
const registry = sharedSingleton('footprints.v1', () => ({
  footprints: new Map<string, Footprint>(),
  version: 0,
  listeners: new Set<() => void>(),
}));
const footprints = registry.footprints;
const listeners = registry.listeners;

export function subscribeFootprints(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getFootprintVersion(): number {
  return registry.version;
}

/**
 * Pieces smaller than this on a side are widened to it. A 貝殼裝飾台's stem or
 * a 竹製手電筒 measures a few centimetres across; letting two of those sit
 * 1cm apart is legal by the geometry and unreadable on screen.
 */
const MIN_HALF_EXTENT = 0.12;

/**
 * Minimum vertical thickness a piece is credited with.
 *
 * A rug is drawn as a `planeGeometry` — mathematically zero thick. Without a
 * floor on the band height, the "is one resting on the other?" test below
 * treats a rug as having no vertical extent at all, so it can never overlap
 * anything vertically and two coplanar rugs stop being detected — which is the
 * single worst case there is, since coplanar is the one thing no amount of
 * depth precision can order. Must stay comfortably above VERTICAL_EPSILON.
 */
const MIN_HEIGHT = 0.06;

/**
 * Breathing room between two pieces, in world units. Also guarantees that two
 * boxes can never come to rest exactly face-to-face, which would put two
 * coplanar surfaces back in the scene through the front door.
 */
const CLEARANCE = 0.04;

/**
 * How much vertical interpenetration counts as "resting on" rather than
 * "inside". Small enough that a piece genuinely sunk into another is still
 * caught, large enough that a piece placed exactly on another's top surface
 * isn't rejected for touching it.
 */
const VERTICAL_EPSILON = 0.02;

/**
 * Bottom and top of the band a walking character sweeps through, in an item's
 * local frame (local y = 0 is the ground the item stands on — see
 * lib/placementSurfaces.ts, which is what puts it there).
 *
 * WHY A BAND AND NOT THE WHOLE BOX. An item's placement bounds and the thing
 * you bump into walking past it are not the same shape. A 椰子樹 is a 0.24-wide
 * trunk with a 2.5-wide crown of fronds four units up; a 許願井 is a 1.3-wide
 * base under a 2-wide roof. Collide against the full box and both become
 * invisible walls far wider than anything at body height — the player is
 * stopped by a shadow. Collide against only what is in the band and the trunk
 * stops you while the fronds pass overhead, which is what the picture on screen
 * promises.
 *
 * The floor is a step height: a kerb, a rug, the stones ringing a campfire's
 * outer edge — anything that low is stepped over, not walked into.
 */
export const WALK_BAND_MIN_Y = 0.25;
export const WALK_BAND_MAX_Y = 1.75;

/**
 * How thick a {@link Slab} is, and how many a model may be cut into.
 *
 * 0.5 is about a knee: fine enough that a table's legs, its top and the lamp standing on it are
 * three different answers, coarse enough that a 4.5-unit palm is six outlines rather than sixty.
 * The cap is what keeps the cost of a tall object bounded — past it the slabs simply get thicker,
 * so a 20-unit object costs exactly what a 4-unit one does.
 *
 * The two numbers together are the whole of "don't make the collider so precise it costs
 * something": at most {@link MAX_SLABS} outlines of at most `MAX_HULL_POINTS` vertices per item
 * TYPE, measured once and shared by every copy of it standing in the world.
 */
const SLAB_HEIGHT = 0.5;
const MAX_SLABS = 6;

/**
 * Vertices sampled from one mesh before the sampler starts striding.
 *
 * A hull does not get better after a few hundred well-spread points, and the models here are
 * procedural primitives — a 32-segment cylinder is 200 vertices, a smooth sphere a few hundred.
 * The cap only ever bites on something pathological, and striding rather than truncating means
 * what it does sample still spans the whole shape.
 */
const MAX_SAMPLES_PER_MESH = 512;

/**
 * Is this mesh part of the item's *substance*, or is it a visual effect drawn
 * on top of it?
 *
 * WHY THIS FILTER EXISTS. `measureFootprint` used to expand its box over every
 * mesh under the model, which quietly made the FX-carrying decorations the
 * worst offenders in the game for "there is clearly room and it still says no".
 * The flames of a 溫馨營火 are nine `sphereGeometry(1)` particles — authored at
 * unit radius and shrunk to ~0.16 by the `useFrame` that animates them. The
 * measurement runs in a layout effect, i.e. *before* the first frame, so it saw
 * nine unit spheres at the origin and recorded a campfire 2.6 units across with
 * 1.3 units of it underground, against a real stone ring 1.4 across. The
 * 黃銅望遠鏡's sparkles, the 許願井's ripple rings and coin, and the 手作鳥屋's
 * feather puffs are all the same story.
 *
 * Chasing that per model is the trap: the numbers would go stale the moment
 * someone added a particle. The property that actually separates the two kinds
 * of mesh is already on them, because it is what makes them render correctly —
 * an effect is invisible until it fires, or draws without writing depth, or is
 * additively blended. Solid matter does none of those. So collision is defined
 * as *what writes depth and is drawn*, and a new effect is excluded on the day
 * it is written without anyone having to remember this rule.
 *
 * `userData.noCollide` is the explicit escape hatch for anything that is opaque
 * and solid-looking but still shouldn't be walked into.
 */
function isSolidGeometry(mesh: THREE.Mesh): boolean {
  if (mesh.userData?.noCollide) return false;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.some((mat) => {
    if (!mat) return false;
    const m = mat as THREE.Material & { depthWrite?: boolean; blending?: THREE.Blending };
    if (m.depthWrite === false) return false;
    if (m.blending === THREE.AdditiveBlending) return false;
    return true;
  });
}

/**
 * Measure `object`'s collider **in its own local frame** and cache it under `itemId`.
 *
 * `Box3.setFromObject` is not usable here: it bakes in world matrices, so for a piece mounted
 * under a rotated placement group it would return the axis-aligned bounds of the *rotated* shape
 * — which is both too big and changes with the rotation, i.e. not a reusable footprint. Every
 * vertex is transformed into `object`'s local space instead.
 *
 * WHY VERTICES AND NOT BOUNDING BOXES. This used to union each mesh's `geometry.boundingBox`,
 * which is the one measurement that cannot tell a cylinder from a cube: a 噴泉's basin and a
 * crate of the same width produce the identical square, and the fountain then refuses a
 * neighbour 41% further away than its own rim at the corners — and does it differently depending
 * on which way it happens to be turned. Reading the positions themselves costs one pass over
 * geometry that is generated once per item TYPE and cached forever, and it is what makes the
 * outline the model's own.
 *
 * Everything comes out of the one traversal, so the pieces can never describe different models:
 * the full outline (placement), the {@link WALK_BAND_MIN_Y} slice of it (walk collision), the
 * per-height {@link Slab}s, and the plain box the older consumers still read.
 */
/**
 * How wide a patch of level ground has to be before a body can stand on it: the player’s own
 * collision circle. Anything narrower is a handrail, a fence top or a branch — things you walk
 * PAST, not things you walk ON.
 *
 * Deliberately the same radius the walk resolve pushes with (utils/placementRules’ 
 * PLAYER_PHYSICAL_RADIUS, 0.35) rather than a separate tuning number, because the two questions
 * are one question: if the body fits there, it can stand there.
 */
const STAND_RADIUS = 0.35;

/** Resolution of the coverage grid in {@link measureStandTop}: 40x40 over the piece’s own box. */
const STAND_GRID = 40;

/**
 * The widest gap in a walking surface that is still a walking surface, in world units.
 *
 * Decks are built out of BOARDS WITH GAPS BETWEEN THEM, and they have to be — two coplanar
 * faces meeting edge to edge is the z-fighting the whole placement system exists to avoid,
 * so every deck in the catalog is laid as separate planks with a visible seam. 小型觀景平台’s
 * seams are 79 mm; 木製平台’s are 92 mm.
 *
 * Taken literally, a disc of the player’s radius therefore never fits on the boards of any
 * deck — it always straddles a seam — and the scan falls through to whatever solid sheet is
 * underneath. On the viewing deck that is the sub-deck 43 mm below the planks, so the feet
 * would end up buried in the boards instead of floating over the rail: the same defect, one
 * order of magnitude smaller and in the other direction.
 *
 * 120 mm is comfortably wider than any plank seam and comfortably narrower than a foot, so
 * closing gaps up to it before the disc test says "boards with seams are a floor, and a
 * ladder or a handrail still is not".
 */
const STAND_GAP_TOLERANCE = 0.12;

/**
 * WHERE A BODY STANDING ON THIS PIECE ACTUALLY RESTS.
 *
 * ## The question
 *
 * A deck is ground (lib/placementSurfaces.ts), and "how high is that ground" used to be answered
 * with the model’s `maxY`. That is right for a bare platform and wrong for every platform with a
 * railing, a post, a parasol or a step rail — the player ends up standing on top of the tallest
 * thing in the model. It is not a tuning error that can be nudged: the two numbers describe
 * different parts of the object.
 *
 * ## The reduction
 *
 * "Somewhere you can stand" is reduced to a property measurable off the geometry with no
 * per-item data at all:
 *
 *     the highest height h at which the material of the model, cut horizontally, contains a
 *     disc of the player’s own radius.
 *
 * Area alone is not enough, and that is the whole subtlety. The viewing deck’s three handrails
 * have ~0.38 world units² of level top surface between them — as much as the player’s own
 * footprint — so any pure area threshold puts the character up on the rails. What separates a
 * deck from a rail is not how much surface there is but whether it is CONTIGUOUS AND WIDE: a
 * 5 cm strip is never standable however long it runs. A disc is the smallest honest statement
 * of that.
 *
 * ## How it is computed
 *
 * Candidate heights are the tops of the solid meshes themselves — a walking surface is always
 * some mesh’s upper face, so heights no geometry ends at need not be sampled. For each
 * candidate, from the top down, the meshes straddling the height just below it are painted into
 * a coverage grid over the piece’s own XZ box, and the grid is asked whether a
 * {@link STAND_RADIUS} disc fits inside the painted cells — after the seams between deck boards
 * are closed up (see {@link STAND_GAP_TOLERANCE}). The first height that answers yes is
 * the surface.
 *
 * One grid fill per candidate height, once per item TYPE, cached with the footprint forever.
 *
 * Returns `null` when no height in the model can hold a body.
 */
function measureStandTop(
  samples: readonly { hull: number[]; minY: number; maxY: number }[],
  minX: number, maxX: number, minZ: number, maxZ: number,
): number | null {
  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;
  if (spanX <= 0 || spanZ <= 0) return null;

  const cellX = spanX / STAND_GRID;
  const cellZ = spanZ / STAND_GRID;
  // A disc smaller than one cell would pass on a single painted cell, so the grid has to resolve
  // the radius at all. Report nothing rather than a surface that was never verified.
  if (cellX > STAND_RADIUS || cellZ > STAND_RADIUS) return null;

  const covered = new Uint8Array(STAND_GRID * STAND_GRID);
  const candidates = [...new Set(samples.map((s) => s.maxY))].sort((a, b) => b - a);

  for (const h of candidates) {
    covered.fill(0);
    // The material immediately BELOW h. A mesh whose own top is h is included (that is the face
    // being tested); one that only starts above h is not, which is what excludes the railings.
    for (const smp of samples) {
      if (smp.maxY < h - 1e-4 || smp.minY > h - 1e-4) continue;
      paintHull(covered, smp.hull, minX, minZ, cellX, cellZ);
    }
    closeGaps(covered, cellX, cellZ);
    if (discFits(covered, cellX, cellZ)) return h;
  }
  return null;
}

/**
 * Morphological closing — dilate then erode by {@link STAND_GAP_TOLERANCE} — so the seams
 * between deck boards stop reading as holes while genuine open space stays open.
 *
 * Dilating alone would be wrong: it would also grow the surface OUTWARD past the edge of the
 * deck, and the player could then stand half a tolerance off the end of it. Eroding by the same
 * radius afterwards puts the outer boundary back exactly where the geometry is; only the
 * enclosed gaps, which have no outer boundary to restore, stay filled. That asymmetry is the
 * whole reason this is a closing rather than a pad.
 */
function closeGaps(grid: Uint8Array, cellX: number, cellZ: number): void {
  const rx = Math.round(STAND_GAP_TOLERANCE / 2 / cellX);
  const rz = Math.round(STAND_GAP_TOLERANCE / 2 / cellZ);
  if (rx < 1 && rz < 1) return;
  const dilated = morph(grid, rx, rz, true);
  const closed = morph(dilated, rx, rz, false);
  grid.set(closed);
}

/**
 * One morphological pass over the grid with a rectangular structuring element.
 *
 * `grow` true dilates (a cell is set when ANY neighbour is set), false erodes (a cell survives
 * only when EVERY neighbour is set). Cells off the edge of the grid count as empty, which is
 * what makes the erode pull the boundary back in rather than leaving the dilated skirt behind.
 */
function morph(grid: Uint8Array, rx: number, rz: number, grow: boolean): Uint8Array {
  const out = new Uint8Array(grid.length);
  for (let gz = 0; gz < STAND_GRID; gz++) {
    for (let gx = 0; gx < STAND_GRID; gx++) {
      let hit = false, all = true;
      for (let dz = -rz; dz <= rz; dz++) {
        for (let dx = -rx; dx <= rx; dx++) {
          const nz = gz + dz, nx = gx + dx;
          const inBounds = nz >= 0 && nz < STAND_GRID && nx >= 0 && nx < STAND_GRID;
          const set = inBounds && grid[nz * STAND_GRID + nx] === 1;
          if (set) hit = true; else all = false;
        }
      }
      out[gz * STAND_GRID + gx] = (grow ? hit : all) ? 1 : 0;
    }
  }
  return out;
}

/** Marks every grid cell whose centre falls inside `hull`, a flat [x, z, …] convex outline. */
function paintHull(
  grid: Uint8Array, hull: readonly number[],
  minX: number, minZ: number, cellX: number, cellZ: number,
): void {
  const count = hull.length >> 1;
  if (count < 3) return;
  for (let gz = 0; gz < STAND_GRID; gz++) {
    const z = minZ + (gz + 0.5) * cellZ;
    for (let gx = 0; gx < STAND_GRID; gx++) {
      const idx = gz * STAND_GRID + gx;
      if (grid[idx]) continue;
      const x = minX + (gx + 0.5) * cellX;
      let inside = true;
      for (let i = 0; i < count; i++) {
        const ax = hull[i * 2], az = hull[i * 2 + 1];
        const bx = hull[((i + 1) % count) * 2], bz = hull[((i + 1) % count) * 2 + 1];
        // convexHull2D returns counter-clockwise, so "inside" is consistently non-negative.
        if ((bx - ax) * (z - az) - (bz - az) * (x - ax) < 0) { inside = false; break; }
      }
      if (inside) grid[idx] = 1;
    }
  }
}

/** Does a {@link STAND_RADIUS} disc fit entirely inside the painted cells? */
function discFits(grid: Uint8Array, cellX: number, cellZ: number): boolean {
  const rx = Math.ceil(STAND_RADIUS / cellX);
  const rz = Math.ceil(STAND_RADIUS / cellZ);
  for (let gz = rz; gz < STAND_GRID - rz; gz++) {
    for (let gx = rx; gx < STAND_GRID - rx; gx++) {
      if (!grid[gz * STAND_GRID + gx]) continue;
      let ok = true;
      for (let dz = -rz; dz <= rz && ok; dz++) {
        for (let dx = -rx; dx <= rx; dx++) {
          // Only the cells actually under the disc, not the whole square around it.
          const wx = dx * cellX, wz = dz * cellZ;
          if (wx * wx + wz * wz > STAND_RADIUS * STAND_RADIUS) continue;
          if (!grid[(gz + dz) * STAND_GRID + (gx + dx)]) { ok = false; break; }
        }
      }
      if (ok) return true;
    }
  }
  return false;
}

export function measureFootprint(itemId: string, object: THREE.Object3D): void {
  if (footprints.has(itemId)) return;

  object.updateWorldMatrix(true, true);
  const toLocal = new THREE.Matrix4().copy(object.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();

  /** One mesh's contribution, kept whole so a slab can ask it for points at a given height. */
  type Sample = { xz: number[]; ys: number[]; minY: number; maxY: number; hull: number[] };
  const samples: Sample[] = [];
  let minY = Infinity, maxY = -Infinity;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

  // A hand-rolled walk rather than `Object3D.traverse`, so an invisible group
  // prunes its whole subtree instead of only itself — a burst of particles is
  // usually a hidden parent over visible children.
  const visit = (node: THREE.Object3D) => {
    if (!node.visible) return;

    const mesh = node as THREE.Mesh;
    if ((mesh as unknown as { isMesh?: boolean }).isMesh && mesh.geometry && isSolidGeometry(mesh)) {
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (pos && pos.count > 0) {
        m.multiplyMatrices(toLocal, mesh.matrixWorld);
        // Stride rather than truncate, so a capped sample still spans the whole mesh.
        const stride = Math.max(1, Math.ceil(pos.count / MAX_SAMPLES_PER_MESH));
        const xz: number[] = [];
        const ys: number[] = [];
        let mMinY = Infinity, mMaxY = -Infinity;
        const take = (i: number) => {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          xz.push(v.x, v.z);
          ys.push(v.y);
          if (v.y < mMinY) mMinY = v.y;
          if (v.y > mMaxY) mMaxY = v.y;
          if (v.x < minX) minX = v.x;
          if (v.x > maxX) maxX = v.x;
          if (v.z < minZ) minZ = v.z;
          if (v.z > maxZ) maxZ = v.z;
        };
        for (let i = 0; i < pos.count; i += stride) take(i);
        // The last vertex is always taken as well: a strided sample that stopped short of it
        // would clip the far end of a long mesh off its own collider.
        if ((pos.count - 1) % stride !== 0) take(pos.count - 1);
        if (mMinY < minY) minY = mMinY;
        if (mMaxY > maxY) maxY = mMaxY;
        samples.push({ xz, ys, minY: mMinY, maxY: mMaxY, hull: convexHull2D(xz) });
      }
    }

    for (const child of node.children) visit(child);
  };
  visit(object);

  if (!samples.length || minY === Infinity) return;

  /**
   * The outline of everything present between `y0` and `y1`.
   *
   * A mesh contributes the vertices it has inside the band. When it has none but passes straight
   * through — a plain cylinder is two rings of vertices with two metres of nothing between them —
   * it contributes its whole outline instead, which is the honest reading for a shaft and a
   * forgiving one for a taper.
   */
  const sliceHull = (y0: number, y1: number): number[] => {
    const pts: number[] = [];
    for (const s of samples) {
      if (s.maxY < y0 || s.minY > y1) continue;
      const before = pts.length;
      for (let i = 0; i < s.ys.length; i++) {
        const y = s.ys[i];
        if (y >= y0 && y <= y1) pts.push(s.xz[i * 2], s.xz[i * 2 + 1]);
      }
      if (pts.length === before) for (const p of s.hull) pts.push(p);
    }
    return pts.length ? convexHull2D(pts) : [];
  };

  const height = Math.max(maxY - minY, MIN_HEIGHT);
  const slabCount = Math.min(MAX_SLABS, Math.max(1, Math.ceil(height / SLAB_HEIGHT)));
  const slabH = height / slabCount;
  const slabHulls: number[][] = [];
  const slabBands: Array<[number, number]> = [];
  for (let i = 0; i < slabCount; i++) {
    const y0 = minY + i * slabH;
    const y1 = i === slabCount - 1 ? minY + height : y0 + slabH;
    const hull = sliceHull(y0, y1);
    // A slab with nothing in it cannot happen for a contiguous model, but a model that is two
    // pieces with a gap (a hanging lamp over its own base) is real. Falling back to the full
    // outline there would put the lamp's shade back on the floor; the empty slab is the point.
    if (!hull.length) continue;
    slabHulls.push(hull);
    slabBands.push([y0, y1]);
  }

  const walkHull = sliceHull(WALK_BAND_MIN_Y, WALK_BAND_MAX_Y);

  // Only pieces that ARE ground pay for the scan — everything else has nothing to stand on and
  // nothing reads the answer. Two items in the catalog declare it today.
  const standable = isStandableItem(itemId);
  const standY = standable
    ? measureStandTop(samples, minX, maxX, minZ, maxZ)
    : null;
  const standParts = standable ? measureStandParts(samples) : null;
  const standSurface = standParts ? sampleStandSurface(standParts, minX, maxX, minZ, maxZ) : null;

  // The whole-model outline, simplified exactly ONCE from the raw hull. It is what gets drawn as
  // the placement footprint and what the deck lookup asks, so it has to be the model's honest
  // silhouette — building it out of already-simplified slices would compound the (outward)
  // simplification error and hand the player an outline visibly wider than the thing it is round.
  const shape = makeConvexShape(hullOf(sliceHull(minY, maxY)), MIN_HALF_EXTENT);
  if (!shape) return;

  const walkShape = walkHull.length ? makeConvexShape(hullOf(walkHull), MIN_HALF_EXTENT) : null;

  const slabs: Slab[] = [];
  for (let i = 0; i < slabHulls.length; i++) {
    const s = makeConvexShape(hullOf(slabHulls[i]), MIN_HALF_EXTENT);
    if (s) slabs.push({ y0: slabBands[i][0], y1: slabBands[i][1], shape: s });
  }
  if (!slabs.length) slabs.push({ y0: minY, y1: minY + height, shape });

  // The broad-phase radius covers every slab, not the whole outline: a slab is simplified on its
  // own, so it can sit a few millimetres outside a separately-simplified whole, and a reject that
  // did not account for that could throw away a real overlap before the slab loop ever saw it.
  let reach = 0;
  for (const slab of slabs) {
    reach = Math.max(reach, Math.hypot(slab.shape.cx, slab.shape.cz) + slab.shape.radius);
  }
  reach = Math.max(reach, Math.hypot(shape.cx, shape.cz) + shape.radius);

  footprints.set(itemId, {
    cx: shape.cx,
    cz: shape.cz,
    halfW: Math.max(MIN_HALF_EXTENT, shape.halfW),
    halfD: Math.max(MIN_HALF_EXTENT, shape.halfD),
    minY,
    maxY: Math.max(maxY, minY + MIN_HEIGHT),
    standY,
    standParts,
    standSurface,
    walk: walkShape
      ? { cx: walkShape.cx, cz: walkShape.cz, halfW: walkShape.halfW, halfD: walkShape.halfD }
      : null,
    shape,
    walkShape,
    reach,
    slabs,
  });

  registry.version++;
  listeners.forEach((fn) => fn());
}

/**
 * Every mesh of a standable piece as a {@link StandPart}: its outline, and its top face if a foot
 * fits there.
 *
 * Per MESH rather than per slab, and that is the point. A slab is one convex hull of everything at
 * a height, and the convex hull of three railings is the whole deck — so a slab can only say "there
 * is something at rail height over the entire deck", which is how the railings used to end up as
 * floor. A mesh's own hull is exactly the mesh.
 *
 * The top face is the hull of the vertices at the mesh's top, not the hull of the whole mesh: a box
 * and a cylinder give their real lid, a tilted plank gives one edge (no tread), a sphere gives a
 * point (no tread). Whether a foot fits is then the face's minimum width — the rail is 5 cm across
 * however long it runs, a stair tread is 40.
 *
 * Unpadded on purpose: the readability floor ({@link MIN_HALF_EXTENT}) is a placement courtesy, and
 * applied here it would turn a 5 cm handrail into a 24 cm wall.
 */
function measureStandParts(
  samples: readonly { xz: number[]; ys: number[]; minY: number; maxY: number; hull: number[] }[],
): StandPart[] {
  const parts: StandPart[] = [];
  for (const s of samples) {
    const outline = makeConvexShape(hullOf(s.hull), 0);
    if (!outline) continue;

    const top: number[] = [];
    for (let i = 0; i < s.ys.length; i++) {
      if (s.ys[i] >= s.maxY - STAND_RULES.topFaceTolerance) top.push(s.xz[i * 2], s.xz[i * 2 + 1]);
    }
    const topHull = top.length >= 6 ? convexHull2D(top) : [];
    const tread = topHull.length >= 6 && minimumWidth(topHull) >= STAND_RULES.minTreadWidth
      ? makeConvexShape(hullOf(topHull), 0)
      : null;

    parts.push({ outline, tread, y0: s.minY, y1: s.maxY });
  }
  return parts;
}

/** Grid pitch of {@link sampleStandSurface}, and the most samples it takes along one side. */
const STAND_SURFACE_STEP = 0.15;
const STAND_SURFACE_MAX_SIDE = 48;

/**
 * The uppermost tread at each point of a grid over the piece's own box — see
 * {@link Footprint.standSurface}. Points no tread covers are left out: they are not surface.
 */
function sampleStandSurface(
  parts: readonly StandPart[],
  minX: number, maxX: number, minZ: number, maxZ: number,
): Float32Array | null {
  const treads = parts.filter((p) => p.tread);
  if (!treads.length) return null;
  const nx = Math.min(STAND_SURFACE_MAX_SIDE, Math.max(2, Math.ceil((maxX - minX) / STAND_SURFACE_STEP) + 1));
  const nz = Math.min(STAND_SURFACE_MAX_SIDE, Math.max(2, Math.ceil((maxZ - minZ) / STAND_SURFACE_STEP) + 1));
  const out: number[] = [];
  const probe = createPlacedShape();
  for (let i = 0; i < nx; i++) {
    const x = minX + ((maxX - minX) * i) / (nx - 1);
    for (let j = 0; j < nz; j++) {
      const z = minZ + ((maxZ - minZ) * j) / (nz - 1);
      let top = -Infinity;
      for (const t of treads) {
        if (t.y1 <= top) continue;
        if (signedDistanceToShape(placeShape(t.tread!, 0, 0, 0, probe), x, z) <= 0) top = t.y1;
      }
      if (top > -Infinity) out.push(x, z, top);
    }
  }
  return out.length ? Float32Array.from(out) : null;
}

/**
 * The narrowest a convex outline is across, in any direction.
 *
 * For a convex polygon the narrowest caliper always lies flush against one of its edges, so it is
 * the smallest, over the edges, of the farthest any vertex stands off that edge's line.
 */
function minimumWidth(hull: readonly number[]): number {
  const n = hull.length >> 1;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = hull[i * 2], az = hull[i * 2 + 1];
    const ex = hull[j * 2] - ax, ez = hull[j * 2 + 1] - az;
    const len = Math.hypot(ex, ez);
    if (len < 1e-9) continue;
    let far = 0;
    for (let k = 0; k < n; k++) {
      const d = Math.abs((hull[k * 2] - ax) * ez - (hull[k * 2 + 1] - az) * ex) / len;
      if (d > far) far = d;
    }
    if (far < best) best = far;
  }
  return best === Infinity ? 0 : best;
}

/** Hull + vertex-cap in one step — every outline in this module is built through here. */
function hullOf(points: readonly number[]): number[] {
  return points.length ? simplifyConvex(convexHull2D(points)) : [];
}

/**
 * Fills in the collider fields for a footprint declared as a plain box.
 *
 * Callers outside this module (the Home, the audits) state a box because a box is all they have;
 * they must still come out with the same shape-based collider everything else uses, or the Home
 * would be the one obstacle in the game running a different rule.
 */
/**
 * A footprint stated as a plain box by a caller that has no model to measure.
 *
 * `standY` is optional here and nowhere else: a box is solid all the way to its top by
 * construction, so unless the caller knows better, its top IS its walking surface.
 */
export type BoxFootprintSpec =
  Omit<Footprint, 'shape' | 'walkShape' | 'slabs' | 'reach' | 'standY' | 'standParts' | 'standSurface'> & {
    standY?: number | null;
  };

export function boxFootprint(box: BoxFootprintSpec): Footprint {
  const shape = rectangleShape(box.cx, box.cz, box.halfW, box.halfD);
  return {
    // A box is solid all the way up by construction, so its top IS its walking surface —
    // there is no railing-shaped part of a box to be fooled by.
    standY: box.standY ?? box.maxY,
    // A declared box has no parts to tell floor from wall with; the surface lookup falls back to
    // the box itself (its outline at `standY`), which is exact for a box.
    standParts: null,
    standSurface: null,
    ...box,
    reach: Math.hypot(box.cx, box.cz) + shape.radius,
    shape,
    walkShape: box.walk
      ? rectangleShape(box.walk.cx, box.walk.cz, box.walk.halfW, box.walk.halfD)
      : null,
    slabs: [{ y0: box.minY, y1: Math.max(box.maxY, box.minY + MIN_HEIGHT), shape }],
  };
}

/**
 * Declares a footprint for something that has no model under this module's
 * control, so it can still take part in the one collision rule.
 *
 * The player's Home is the only such thing: it renders through HouseModel and
 * is sized by its House Style rather than by measurement, but it is an obstacle
 * to every placement and every placement is an obstacle to it. Registering its
 * box here is what lets `findPlacementConflict` answer both directions, instead
 * of the ghost carrying a second, circle-based rule for the house alone.
 */
export function registerFootprint(
  itemId: string,
  footprint: Footprint | BoxFootprintSpec,
): void {
  footprints.set(itemId, 'shape' in footprint ? footprint : boxFootprint(footprint));
  registry.version++;
  listeners.forEach((fn) => fn());
}

export function getFootprint(itemId: string): Footprint | undefined {
  return footprints.get(itemId);
}

/** An oriented box on the XZ plane: centre, unit axes, half-extents. */
export type Obb2 = {
  cx: number;
  cz: number;
  /** local +X in world space */
  ux: number;
  uz: number;
  /** local +Z in world space */
  vx: number;
  vz: number;
  halfW: number;
  halfD: number;
};

/**
 * Places a local XZ box into the world at `(x, z)` turned by `rotation`.
 *
 * The one conversion from "an item's own box" to "where that box is" — used by
 * the placement test, the walk resolve, the surface lookup and the ghost's
 * on-screen outline, so all four are talking about the same rectangle.
 */
export function makeObb(
  local: { cx: number; cz: number; halfW: number; halfD: number },
  x: number,
  z: number,
  rotation: number,
  pad = 0,
): Obb2 {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  // three.js rotates about +Y as: x' = x·cos + z·sin, z' = -x·sin + z·cos.
  return {
    cx: x + local.cx * cos + local.cz * sin,
    cz: z - local.cx * sin + local.cz * cos,
    ux: cos,
    uz: -sin,
    vx: sin,
    vz: cos,
    halfW: local.halfW + pad,
    halfD: local.halfD + pad,
  };
}

/**
 * Shortest distance from the world point `(x, z)` to this box, 0 anywhere inside it.
 *
 * This is what "standing next to a piece of furniture" means for the interaction system
 * (lib/furnitureInteraction.ts). A distance to the piece's CENTRE cannot express it: one radius
 * that reaches the front of a 2.5-unit bed also reaches a metre past its side, and the same
 * number is uselessly large for a chair. Measuring from the box means one reach distance is
 * correct for every piece, at every size, at every rotation.
 */
export function obbDistanceToPoint(b: Obb2, x: number, z: number): number {
  const rx = x - b.cx;
  const rz = z - b.cz;
  const du = Math.max(0, Math.abs(rx * b.ux + rz * b.uz) - b.halfW);
  const dv = Math.max(0, Math.abs(rx * b.vx + rz * b.vz) - b.halfD);
  return Math.hypot(du, dv);
}

/** Half-width of `b` projected onto the unit axis (ax, az) — how far it reaches that way. */
export function obbProjectedRadius(b: Obb2, ax: number, az: number): number {
  return projectedRadius(b, ax, az);
}

/** Is the world point `(x, z)` inside this box? */
export function obbContainsPoint(b: Obb2, x: number, z: number): boolean {
  const rx = x - b.cx;
  const rz = z - b.cz;
  return (
    Math.abs(rx * b.ux + rz * b.uz) <= b.halfW &&
    Math.abs(rx * b.vx + rz * b.vz) <= b.halfD
  );
}

/** The box's four corners in world space, starting at (+u, +v) and going round. */
export function obbCorners(b: Obb2): Array<[number, number]> {
  const corners: Array<[number, number]> = [];
  for (const [su, sv] of [[1, 1], [1, -1], [-1, -1], [-1, 1]] as const) {
    corners.push([
      b.cx + su * b.halfW * b.ux + sv * b.halfD * b.vx,
      b.cz + su * b.halfW * b.uz + sv * b.halfD * b.vz,
    ]);
  }
  return corners;
}

/** Half-width of `b` projected onto unit axis (ax, az). */
function projectedRadius(b: Obb2, ax: number, az: number): number {
  return b.halfW * Math.abs(b.ux * ax + b.uz * az) + b.halfD * Math.abs(b.vx * ax + b.vz * az);
}

/**
 * Slide `candidate` until it sits WHOLLY on top of `support`, and report the move that does it.
 *
 * The rule that makes a table behave like a table: an object let go near the edge slides back on
 * rather than being left hanging over it. Done in the SUPPORT's own frame using the candidate's
 * projected radii, so it stays correct when the two are at different angles — a vase set down
 * diagonally on a rotated console is not a special case.
 *
 * Lifted out of lib/interiorPlacement.ts, where it was the indoor tabletop branch, so the island
 * can use the identical rule for standing something on a deck or an outdoor table. That is the
 * whole of "室內外統一" for surface placement: one function, two callers, no second opinion.
 *
 * Returns `null` when the candidate does not fit on the support at all — which is a refusal
 * (`noFit`), not something to clamp.
 */
export function clampOntoSupport(
  candidate: Obb2,
  support: Obb2
): { dx: number; dz: number } | null {
  const roomU = support.halfW - projectedRadius(candidate, support.ux, support.uz);
  const roomV = support.halfD - projectedRadius(candidate, support.vx, support.vz);
  if (roomU < 0 || roomV < 0) return null;

  const rx = candidate.cx - support.cx;
  const rz = candidate.cz - support.cz;
  const u = Math.min(roomU, Math.max(-roomU, rx * support.ux + rz * support.uz));
  const v = Math.min(roomV, Math.max(-roomV, rx * support.vx + rz * support.vz));

  return {
    dx: support.cx + u * support.ux + v * support.vx - candidate.cx,
    dz: support.cz + u * support.uz + v * support.vz - candidate.cz,
  };
}

/**
 * Separating-axis test for two oriented boxes on the XZ plane. In 2D there are
 * only four candidate axes (each box's two edge normals); if any one of them
 * separates the boxes they do not overlap.
 */
export function obbOverlap(a: Obb2, b: Obb2): boolean {
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  const axes: [number, number][] = [
    [a.ux, a.uz],
    [a.vx, a.vz],
    [b.ux, b.uz],
    [b.vx, b.vz],
  ];
  for (const [ax, az] of axes) {
    const dist = Math.abs(dx * ax + dz * az);
    if (dist > projectedRadius(a, ax, az) + projectedRadius(b, ax, az)) return false;
  }
  return true;
}

/**
 * Scratch outlines, so the tests below never allocate.
 *
 * `SHAPE_A` serves the single-shape queries (contains / distance / outline) and `SLAB_A`/`SLAB_B`
 * the pairwise slab test. There is no whole-outline pair: `placementsCollide` rejects on the
 * `reach` circle and then goes straight to slabs.
 */
const SHAPE_A = createPlacedShape();
const SLAB_A = createPlacedShape();
const SLAB_B = createPlacedShape();

/**
 * Do these two placements occupy the same space?
 *
 * Four tests, cheapest first, and each one is allowed to say "definitely not":
 *
 *  1. **Layer.** A painting and a rug are never in each other's way.
 *  2. **Vertical band.** What lets one piece stand on another. `position[1]` is the placement's
 *     own elevation (0 for anything dropped on the floor; non-zero only for a preset authored to
 *     sit on something). The epsilon means "resting exactly on top" reads as clear rather than as
 *     a zero-thickness overlap, while real interpenetration is still caught.
 *  3. **Reach.** One circle test, from each item's own origin so it survives any rotation.
 *     Nearly every pair on a decorated island is settled here, for two multiplications.
 *  4. **Slab by slab.** Only for the pairs that got past 3 — and this is the test that lets a
 *     flower sit under a well's roof, because it asks whether the two are present at the same
 *     HEIGHT as well as over the same ground.
 *
 * Returns `false` when either footprint has not been measured yet — an un-measured item is one
 * that has never been mounted, and refusing a placement on the strength of a shape we do not have
 * would block the player for a reason we cannot show them. The first mount measures it and
 * `subscribeFootprints` re-runs the check.
 */
export function placementsCollide(a: PlacedItem, b: PlacedItem): boolean {
  if (getPlacementLayer(a.itemId) !== getPlacementLayer(b.itemId)) return false;

  const fpA = footprints.get(a.itemId);
  const fpB = footprints.get(b.itemId);
  if (!fpA || !fpB) return false;

  const aBase = a.position[1];
  const bBase = b.position[1];
  if (aBase + fpA.maxY - VERTICAL_EPSILON <= bBase + fpB.minY) return false;
  if (bBase + fpB.maxY - VERTICAL_EPSILON <= aBase + fpA.minY) return false;

  const dx = b.position[0] - a.position[0];
  const dz = b.position[2] - a.position[2];
  const reach = fpA.reach + fpB.reach + CLEARANCE;
  if (dx * dx + dz * dz > reach * reach) return false;

  const rotA = a.rotation || 0;
  const rotB = b.rotation || 0;

  for (const sa of fpA.slabs) {
    const aLow = aBase + sa.y0;
    const aHigh = aBase + sa.y1;
    for (const sb of fpB.slabs) {
      if (aHigh - VERTICAL_EPSILON <= bBase + sb.y0) continue;
      if (bBase + sb.y1 - VERTICAL_EPSILON <= aLow) continue;
      placeShape(sa.shape, a.position[0], a.position[2], rotA, SLAB_A, CLEARANCE / 2);
      placeShape(sb.shape, b.position[0], b.position[2], rotB, SLAB_B, CLEARANCE / 2);
      if (shapesOverlap(SLAB_A, SLAB_B)) return true;
    }
  }
  return false;
}

/**
 * The item's outline placed in the world, written into a caller-owned buffer.
 *
 * The one conversion from "an item's own collider" to "where that collider is", and the shape
 * equivalent of {@link makeObb} — used by the surface lookup, the ghost's on-screen outline, the
 * reach test and the minimap, so all four draw and test the same polygon.
 */
export function footprintShape(
  fp: Footprint,
  x: number,
  z: number,
  rotation: number,
  out: PlacedShape,
  pad = 0,
): PlacedShape {
  return placeShape(fp.shape, x, z, rotation, out, pad);
}

/** Is `(px, pz)` inside `fp` standing at `(x, z)` turned by `rotation`? */
export function footprintContainsPoint(
  fp: Footprint,
  x: number,
  z: number,
  rotation: number,
  px: number,
  pz: number,
): boolean {
  return shapeContainsPoint(placeShape(fp.shape, x, z, rotation, SHAPE_A), px, pz);
}

/** Shortest distance from `(px, pz)` to the outline of `fp` standing at `(x, z)`; 0 inside it. */
export function footprintDistanceToPoint(
  fp: Footprint,
  x: number,
  z: number,
  rotation: number,
  px: number,
  pz: number,
): number {
  return Math.max(0, signedDistanceToShape(placeShape(fp.shape, x, z, rotation, SHAPE_A), px, pz));
}

/**
 * The outline's world-space vertices — for drawing it, and for testing what is under each one.
 *
 * The shape's `pad` (see lib/collisionShape.ts) is pushed out radially rather than as a true
 * rounded offset: this is the outline a player LOOKS at, and a 12-vertex ring is already the
 * drawing. The tests use the exact form.
 */
export function footprintOutline(
  fp: Footprint,
  x: number,
  z: number,
  rotation: number,
  extraPad = 0,
): Array<[number, number]> {
  const s = placeShape(fp.shape, x, z, rotation, SHAPE_A, extraPad);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < s.count; i++) {
    const px = s.pts[i * 2];
    const pz = s.pts[i * 2 + 1];
    if (s.pad > 0) {
      const dx = px - s.cx;
      const dz = pz - s.cz;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) {
        out.push([px + (dx / d) * s.pad, pz + (dz / d) * s.pad]);
        continue;
      }
    }
    out.push([px, pz]);
  }
  return out;
}

// --- Walking into furniture ------------------------------------------------

/**
 * How wide a solid piece is assumed to be when it has somehow never been
 * measured. Only reachable if a piece is in the save file but has not mounted
 * this session; erring large keeps it solid rather than letting the player walk
 * through it, which is the failure that matters.
 */
const UNMEASURED_SOLID_HALF_EXTENT = 0.45;

/** The outline a never-measured piece falls back to. Built once; see the constant above. */
const UNMEASURED_SOLID_SHAPE = rectangleShape(
  0, 0, UNMEASURED_SOLID_HALF_EXTENT, UNMEASURED_SOLID_HALF_EXTENT,
);

/**
 * The outline a walking character is stopped by, or `null` if this piece is
 * nothing to walk into.
 *
 * Five answers, one place: a piece on a non-floor layer (a painting, a
 * chandelier) is above or behind the character; a piece that is a standable
 * surface is a floor to step onto, resolved by height rather than pushed
 * against; soft planting is walked through; a piece standing ON something
 * else is up out of the way; anything
 * else offers its {@link WALK_BAND_MIN_Y} slice, and if it has nothing in that
 * band — a rug, a doormat — it is stepped over.
 *
 * `elevation` is the placement's own Y, and it has to be part of this because a
 * footprint is measured in the item's LOCAL frame: a vase's walk shape says "this
 * much of me is between 0.25 and 1.75 above whatever I am standing on", which
 * is a wall at floor level and nothing at all once the vase is on a table. Not
 * accounting for it is how a piece the player deliberately set down on a
 * console ends up as an invisible bollard on the floor underneath it — the same
 * defect the preset layouts' `elevation` spawns would have had.
 */
function getWalkShape(itemId: string, elevation: number): ConvexShape | null {
  if (getPlacementLayer(itemId) !== 'floor') return null;
  // Standable pieces are not one shape: they are floor or wall part by part, depending on the
  // height of the body meeting them. See pushOutOfStandable.
  if (isStandableItem(itemId)) return null;
  // Soft planting: a body walks through leaves and flower stems. See ItemDefinition.brushPast
  // for why sizing the plants correctly is what made this necessary.
  if (isBrushPastItem(itemId)) return null;

  const fp = footprints.get(itemId);
  if (!fp) return UNMEASURED_SOLID_SHAPE;
  // Wholly above head height once lifted onto its support: there is nothing here to walk into.
  if (elevation + fp.minY >= WALK_BAND_MAX_Y) return null;
  return fp.walkShape;
}

/**
 * Pushes a player standing at (x, z) out of any furniture they are inside, and
 * returns where they end up.
 *
 * WHY THIS REPLACED A RADIUS TABLE. Indoor furniture collision used to come
 * from `getPlacedItemCollisionRadius` in characterMovement.ts: a **circle**
 * whose size was looked up by substring-matching the item's Chinese name, with
 * a flat 0.3 (+0.35 player) default for anything unlisted. Two whole classes of
 * bug fell out of that:
 *
 *   - Anything the list forgot got a 0.65 circle. A 五星級雙人床 and a
 *     雙人獨立浴缸 are 2.53 units long, so 0.61 units at each end stuck out of
 *     their own collider and the player walked straight through them. Same for
 *     the 實木大衣櫃, 系統流理台, 大理石洗手台, 瓦斯爐 and 鐵架.
 *   - A circle cannot describe a long piece anyway. Sized to cover a sofa's
 *     length it becomes an invisible wall along its short side; sized to its
 *     width the ends are open.
 *
 * And in the other direction, wall-mounted and ceiling pieces (paintings,
 * windows, the 廚房吊櫃, wall lamps) got that same 0.65 circle at floor level —
 * invisible obstacles in the middle of a room, under things hanging well above
 * head height.
 *
 * The measured OBBs this module already keeps for placement solve all of it at
 * once: real per-item extents, correct under rotation, and layer-aware, so
 * rugs are walked over and wall/ceiling pieces are walked under without a
 * special case. It stays correct when someone edits a model, because the box
 * comes from the geometry rather than from a list somebody has to remember to
 * update.
 *
 * This is now the island's rule too. Outdoors used to run its own copy of the
 * same name-substring radius ladder (`getPlacedItemCollisionRadius` in
 * characterMovement.ts) with all the same failures: a 椰子樹 whose fronds are
 * four units up was a 0.9-radius circle at ground level, a 吊床 three units long
 * was a 0.95 circle, and anything the ladder had never heard of got 0.65. One
 * function, one set of boxes, one set of rules, indoors and out.
 */
export function resolvePlayerAgainstFurniture(
  x: number,
  z: number,
  playerRadius: number,
  placed: PlacedItem[],
  /**
   * The height the body is standing at, when the caller tracks one — the player does.
   *
   * It is what lets a standable piece be a wall: a deck's side, its posts and its railings are
   * solid to a body they are more than a step above (see {@link STAND_RULES}). Without it there is
   * no "above", so standable pieces are left out entirely, which is how they have always behaved
   * for the callers that do not track a height (the pet, the island NPCs, the audits).
   */
  footY?: number | null,
): { x: number; z: number } {
  PUSH.x = x;
  PUSH.z = z;

  for (const p of placed) {
    if (footY != null && isStandableItem(p.itemId)) {
      pushOutOfStandable(p, footY, playerRadius);
      continue;
    }
    const walk = getWalkShape(p.itemId, p.position[1] || 0);
    if (!walk) continue;

    // The walk shape is stated in the ITEM's local frame, so it is carried out to world space by
    // the placement's own transform first. `pushCircleOutOfShape` rejects on the bounding circle
    // before it touches an edge, which is the broad phase this loop never used to have — a
    // heavily decorated island now costs less per frame than it did with boxes.
    placeShape(walk, p.position[0], p.position[2], p.rotation || 0, WALK_SCRATCH);
    pushCircleOutOfShape(WALK_SCRATCH, PUSH.x, PUSH.z, playerRadius, PUSH);
  }

  return { x: PUSH.x, z: PUSH.z };
}

/** Scratch outline for the per-frame walk resolve. One placement at a time, so one buffer. */
const WALK_SCRATCH = createPlacedShape();

/**
 * Pushes {@link PUSH} out of every part of standable placement `p` that is a WALL to a body
 * standing at `footY` — see {@link STAND_RULES}.
 *
 * The complement of {@link standTreadTop}: a part whose top is within a step is floor there and
 * skipped here; a part above that and below head height is solid here. One threshold decides both,
 * so nothing is ever both.
 *
 * An unmeasured piece (its model has never mounted) contributes nothing, exactly as it contributes
 * no floor: guessing a wall would trap the player behind something they cannot see.
 */
function pushOutOfStandable(p: PlacedItem, footY: number, playerRadius: number): void {
  const fp = footprints.get(p.itemId);
  if (!fp?.standParts) return;

  const px = p.position[0];
  const pz = p.position[2];
  const dx = PUSH.x - px;
  const dz = PUSH.z - pz;
  const reach = fp.reach + playerRadius;
  if (dx * dx + dz * dz > reach * reach) return;

  const base = p.position[1] || 0;
  const stepTop = footY + STAND_RULES.maxStepUp;
  const headTop = footY + WALK_BAND_MAX_Y;
  const rotation = p.rotation || 0;
  for (const part of fp.standParts) {
    if (base + part.y1 <= stepTop) continue;
    if (base + part.y0 >= headTop) continue;
    placeShape(part.outline, px, pz, rotation, WALK_SCRATCH);
    pushCircleOutOfShape(WALK_SCRATCH, PUSH.x, PUSH.z, playerRadius, PUSH);
  }
}

/**
 * The highest TREAD of standable placement `p` under a foot at `(x, z)`, as a world height — or
 * `null` when no tread is under it.
 *
 * `reachTop` is the highest a tread may be and still be stepped onto: `footY + maxStepUp` for a
 * body that is walking (see {@link STAND_RULES}), `Infinity` for "whatever is on top here", which is
 * what an object being set down and every caller without a height of its own ask.
 *
 * Treads, not the model's outline, is what makes a staircase a staircase and the air beside it
 * air: the outline of 小型觀景平台 is one convex hull around deck and stairs together, and standing
 * anywhere inside it used to put the feet at deck height.
 */
export function standTreadTop(
  p: PlacedItem,
  x: number,
  z: number,
  reachTop = Infinity,
): number | null {
  const fp = footprints.get(p.itemId);
  if (!fp?.standParts) return null;

  const px = p.position[0];
  const pz = p.position[2];
  const dx = x - px;
  const dz = z - pz;
  const reach = fp.reach + STAND_RULES.footRadius;
  if (dx * dx + dz * dz > reach * reach) return null;

  const base = p.position[1] || 0;
  const rotation = p.rotation || 0;
  let best: number | null = null;
  for (const part of fp.standParts) {
    if (!part.tread) continue;
    const top = base + part.y1;
    if (top > reachTop) continue;
    if (best !== null && top <= best) continue;
    placeShape(part.tread, px, pz, rotation, SHAPE_A);
    if (signedDistanceToShape(SHAPE_A, x, z) <= STAND_RULES.footRadius) best = top;
  }
  return best;
}

/**
 * A solid box that is NOT in anybody's save file — a piece of the world that exists because
 * something is happening, not because a player put it down.
 *
 * Stated in WORLD space and complete in itself, which is the whole difference from a
 * {@link PlacedItem}: a placement names a catalog item and the box is looked up from the model
 * that mounted for it, whereas the things that need this have no catalog entry and no placement
 * — the visiting merchant's boat is the first (see Three/MerchantBoat.tsx's `BOAT_COLLIDERS`).
 *
 * It carries no height. That is deliberate and it is the same rule the furniture path follows
 * (see {@link WALK_BAND_MIN_Y}): a walking body is stopped by a plan, and anything that wants to
 * be a FLOOR is a standable surface resolved by height instead (lib/placementSurfaces.ts), never
 * a box to be pushed out of. Keeping the two apart is what stops a solid from accidentally
 * becoming ground the player can stand on — which, out at sea, would silently end their swim.
 */
export interface SolidBox {
  /** For debugging and tests; never shown to a player. */
  id: string;
  /** Centre, world space. */
  cx: number;
  cz: number;
  halfW: number;
  halfD: number;
  /** Yaw in radians, same convention as `PlacedItem.rotation`. */
  rotation: number;
}

/**
 * The same push, against boxes that are handed over ready-made.
 *
 * Deliberately a sibling of {@link resolvePlayerAgainstFurniture} rather than a second
 * implementation: both call {@link pushOutOfBox}, so a solid placed by a player and a solid that
 * sailed in behave identically — same slide-along-the-face behaviour, same escape-by-least-
 * penetration when something has shoved the player inside, same player radius. The only thing
 * that differs is where the boxes came from, and that genuinely is different.
 */
export function resolvePlayerAgainstSolids(
  x: number,
  z: number,
  playerRadius: number,
  solids: readonly SolidBox[] | null | undefined,
): { x: number; z: number } {
  PUSH.x = x;
  PUSH.z = z;
  if (solids) {
    for (const s of solids) {
      pushOutOfBox(s.cx, s.cz, s.rotation, s.halfW, s.halfD, playerRadius);
    }
  }
  return { x: PUSH.x, z: PUSH.z };
}

/**
 * Running position for the push loops.
 *
 * A module scratch rather than a return value because both loops above run per frame over every
 * solid in reach, and each pass used to be able to allocate. The two callers are the only writers
 * and neither yields between reading and writing it.
 */
const PUSH = { x: 0, z: 0 };

/**
 * Push {@link PUSH} out of one oriented box, if it is inside it or within `playerRadius` of it.
 *
 * Extracted so that "what a solid does to a walking body" is written once. It was inline in the
 * furniture loop, and the moment a second kind of solid existed (the merchant's boat) the choice
 * was between copying these thirty lines or sharing them — and a copy is how two solids in the
 * same world start behaving differently, with the copy always being the one nobody re-reads.
 */
function pushOutOfBox(
  cx: number,
  cz: number,
  rotation: number,
  halfW: number,
  halfD: number,
  playerRadius: number,
): void {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const ux = cos, uz = -sin;
  const vx = sin, vz = cos;

  // The player, expressed along the box's own axes.
  const rx = PUSH.x - cx;
  const rz = PUSH.z - cz;
  let lu = rx * ux + rz * uz;
  let lv = rx * vx + rz * vz;

  // Nearest point on the box to the player, in that same frame.
  const nu = Math.min(halfW, Math.max(-halfW, lu));
  const nv = Math.min(halfD, Math.max(-halfD, lv));
  const du = lu - nu;
  const dv = lv - nv;
  const distSq = du * du + dv * dv;

  if (distSq > playerRadius * playerRadius) return; // clear of this piece

  if (distSq > 1e-8) {
    // Outside the box but within the player's radius — push straight out
    // along the shortest line to the surface. Doing it on the nearest-point
    // normal is what lets the player slide along a sofa instead of sticking.
    const dist = Math.sqrt(distSq);
    lu = nu + (du / dist) * playerRadius;
    lv = nv + (dv / dist) * playerRadius;
  } else {
    // Dead centre of a face, or genuinely inside the box (spawned there, or
    // shoved in by another resolve pass). Leave by the nearest face, which is
    // the axis of least penetration.
    const penU = halfW - Math.abs(lu);
    const penV = halfD - Math.abs(lv);
    if (penU < penV) {
      lu = (lu >= 0 ? 1 : -1) * (halfW + playerRadius);
    } else {
      lv = (lv >= 0 ? 1 : -1) * (halfD + playerRadius);
    }
  }

  // Back to world space.
  PUSH.x = cx + lu * ux + lv * vx;
  PUSH.z = cz + lu * uz + lv * vz;
}

/**
 * The first already-placed piece `candidate` would sit inside, or `null` if it
 * fits.
 *
 * `ignore` covers the two things a candidate is legitimately in contact with:
 * the piece being moved (it must not be tested against its own old position)
 * and, outdoors, whatever it is standing *on* — see
 * lib/placementSurfaces.ts. A deck the player deliberately dropped a lantern
 * onto is not an obstacle to that lantern, and the vertical-band test alone
 * can't say so, because a model whose lowest geometry dips a centimetre below
 * its own origin would read as sunk into the deck rather than resting on it.
 */
export function findPlacementConflict(
  candidate: PlacedItem,
  placed: PlacedItem[],
  ignore?: string | null | ReadonlySet<string>,
): PlacedItem | null {
  const ignored = typeof ignore === 'string' ? new Set([ignore]) : ignore || null;
  for (const other of placed) {
    if (other.instanceId === candidate.instanceId) continue;
    if (ignored && ignored.has(other.instanceId)) continue;
    if (placementsCollide(candidate, other)) return other;
  }
  return null;
}
