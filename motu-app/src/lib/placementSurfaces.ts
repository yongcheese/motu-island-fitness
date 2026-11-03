/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PlacedItem } from '../types';
import {
  getStandableSurface,
  isDisplaySurfaceItem,
  isStandableItem,
  StandableSurface,
} from '../constants/items';
import { WATER_SURFACE_Y } from '../constants/world';
import { getTerrainInfo, isLandTerrain } from '../constants/terrain';
import { HOUSE_FOOTPRINT, STARTER_HOUSE_ITEM_ID } from '../constants/houseStyles';
import { ResolvedHome } from '../hooks/usePlayerHome';
import {
  boxFootprint,
  clampOntoSupport,
  findPlacementConflict,
  footprintContainsPoint,
  footprintOutline,
  getFootprint,
  makeObb,
  registerFootprint,
  standTreadTop,
  STAND_RULES,
} from './furniturePlacement';
import { getPlacementStep, quantize } from './placementSession';

/**
 * The island's Placement System: one answer to "how high is the surface here, may this object
 * stand on it, and what does it rest on".
 *
 * ## What this replaced
 *
 * Outdoor placement was four disagreeing rules that each described the same objects differently:
 *
 *   1. `PlacementGhost` tested a candidate against a hand-typed `footprintRadius` circle for the
 *      Home and a measured box for everything else, and wrote every placement at a hard-coded
 *      `y = 0.35` regardless of what was underneath it.
 *   2. `characterMovement.getPlacedItemCollisionRadius` pushed the player out with a *third* set
 *      of numbers, looked up by substring-matching the item's Chinese name.
 *   3. `placementRules.getCollisionBounds` kept a fourth name-keyed table (now deleted — nothing
 *      called it).
 *   4. The 木製平台 got past all of them with three copies of `if (dx < 2.15 && dz < 2.15)
 *      terrainY = 0.6` pasted into Avatar and characterMovement — a square that was neither the
 *      platform's real size (2.64 half-extent) nor its real deck height (0.445 above ground), did
 *      not turn when the platform was rotated, and existed nowhere the placement check could see
 *      it, which is why nothing could be put *on* a platform and why standing on one sank the
 *      player 15cm into the boards.
 *
 * ## The rule that replaced them
 *
 * A placed object's local y = 0 is the surface it stands on. Every model in the catalog is
 * authored that way already — a torch's base, a palm's trunk, a campfire's stones and a deck's
 * boards all start at their own origin — so "where does this go" reduces to "how high is the
 * surface at this XZ", and the answer is the same one for the player's feet, for a prop, and for
 * the ghost's outline. {@link getSurfaceAt} is that answer. A deck is ground because it *declares*
 * it is ({@link StandableSurface}); how big it is and how high its top sits are measured off the
 * model, never typed in.
 *
 * Adding a decoration therefore needs no entry anywhere in this file. Adding a second kind of deck
 * needs one field in the catalog.
 */

/**
 * The Home, expressed as an ordinary placeable box so it goes through the same OBB test as
 * everything else.
 *
 * It is the one obstacle with no measurable model here — it renders through HouseModel and is
 * sized by its House Style — so its box is registered from the footprint that already drives the
 * mesh, the walk collider and the entry trigger. Before this, the ghost carried a separate
 * circle-vs-circle rule for the house: a circle *circumscribing* the 1.9 x 1.7 box, i.e. 2.55
 * where the wall is at 1.9, plus a second circle around the candidate. Those two conservative
 * approximations stacked into roughly a metre of phantom no-build space around the house, which is
 * a large part of "there is obviously room and it still refuses".
 *
 * THE RAW FOOTPRINT, NOT THE SOLID ONE. This used to register `getHomeSolidHalfExtents` — the
 * walls plus the player's own 0.35 radius — which is the right box for stopping a BODY and the
 * wrong one for refusing an OBJECT. Nothing is placed at body height by walking there, so the
 * inflation was 35cm of no-build ring the player could see straight through: a lantern could not
 * be stood against the wall of their own house. The margin belongs to `resolveHomeCollision`,
 * where it started, and this states the building. A prop tucked under the eaves is a feature.
 *
 * `walk` is null because the player's collision against the Home is resolved separately and
 * exactly (`resolveHomeCollision`), against the inflated half-extents.
 */
const HOME_FOOTPRINT = boxFootprint({
  cx: 0,
  cz: 0,
  halfW: HOUSE_FOOTPRINT.halfWidth,
  halfD: HOUSE_FOOTPRINT.halfDepth,
  minY: 0,
  maxY: HOUSE_FOOTPRINT.height,
  walk: null,
});
registerFootprint(STARTER_HOUSE_ITEM_ID, HOME_FOOTPRINT);

/** The Home as a placement, so the shared conflict test can take it as an obstacle. */
function homeAsPlacement(home: ResolvedHome): PlacedItem {
  return {
    instanceId: HOME_INSTANCE_ID,
    itemId: STARTER_HOUSE_ITEM_ID,
    position: [home.position[0], home.position[1], home.position[2]],
    rotation: home.rotation,
  };
}

/** Reserved instance id for the Home, which is not a real placement in `islandPlacements`. */
export const HOME_INSTANCE_ID = '__home__';

/** What is under a given point, and how high its top is. */
export interface SurfaceHit {
  /** World Y of the top of that surface — where an object's origin, or the player's feet, go. */
  y: number;
  /** The placement providing it, or `null` when it is the island itself. */
  supportId: string | null;
  /** The support's material, for footsteps. `null` on natural ground. */
  surface: StandableSurface | null;
  /** True when this is somewhere an ordinary object can stand: dry land, or a deck. */
  isSolid: boolean;
}

/**
 * The topmost surface at `(x, z)` — a placed deck if one covers the point, otherwise the island.
 *
 * Decks stack: the answer is simply the highest one whose box contains the point, so a deck laid
 * on a deck works with no extra rule. `ignoreInstanceId` drops the object currently being dragged,
 * which must not be allowed to stand on itself.
 */
export function getSurfaceAt(
  x: number,
  z: number,
  placements: PlacedItem[],
  islandScale: number,
  ignoreInstanceId?: string | null,
  /**
   * The height the asking body is standing at now, when it has one. A deck tread is then only an
   * answer if it is within a step of it (STAND_RULES in lib/furniturePlacement.ts) — the other
   * half of the rule that makes the deck's side a wall. Omitted, the answer is simply the highest
   * tread under the point, which is what everything without a body of its own wants.
   */
  fromY?: number | null,
): SurfaceHit {
  return topSurfaceAt(x, z, placements, islandScale, ignoreInstanceId, false, fromY);
}

/**
 * The topmost surface an OBJECT may be set down on — the walkable answer above, plus tabletops.
 *
 * Split from {@link getSurfaceAt} rather than folded into it, because the two questions genuinely
 * differ and conflating them would be a bug in both directions:
 *
 *  - **Walking** asks what the player's feet may rest on. A table must not be an answer; making it
 *    one would let the character walk up onto the furniture (and would put the pet, the NPCs and
 *    the footstep sounds up there too, since they all read `getSurfaceAt`).
 *  - **Placement** asks what an object may stand on, and a table is the obvious answer — it is
 *    what `tabletop` means, and the interior has resolved it that way since wall art was added
 *    (`isDisplaySurfaceItem`, lib/interiorPlacement.ts).
 *
 * Before this split the island had no notion of standing anything on anything: only `standable`
 * decks were support, so a lantern dragged over an outdoor table was not "on the table", it was an
 * overlap — the placement was refused and the object could only ever go on the ground beside it.
 * Indoors the same lantern went straight onto the same table. That was the largest remaining
 * inconsistency between the two modes, and it was in the surface lookup rather than in either
 * mode's UI.
 */
export function getSupportAt(
  x: number,
  z: number,
  placements: PlacedItem[],
  islandScale: number,
  ignoreInstanceId?: string | null,
): SurfaceHit {
  return topSurfaceAt(x, z, placements, islandScale, ignoreInstanceId, true);
}

function topSurfaceAt(
  x: number,
  z: number,
  placements: PlacedItem[],
  islandScale: number,
  ignoreInstanceId: string | null | undefined,
  includeDisplaySurfaces: boolean,
  fromY?: number | null,
): SurfaceHit {
  const info = getTerrainInfo(x, z, islandScale);
  let best: SurfaceHit = {
    y: info.targetY,
    supportId: null,
    surface: null,
    isSolid: isLandTerrain(info.terrain),
  };
  const reachTop = fromY == null ? Infinity : fromY + STAND_RULES.maxStepUp;

  for (const p of placements) {
    if (ignoreInstanceId && p.instanceId === ignoreInstanceId) continue;
    const surface = getStandableSurface(p.itemId);
    // `surface` stays null for a tabletop: it is the footstep material, and nothing walks on a
    // table. A top that only objects may use therefore reports no material, correctly.
    if (!surface && !(includeDisplaySurfaces && isDisplaySurfaceItem(p.itemId))) continue;

    const fp = getFootprint(p.itemId);
    if (!fp) continue;

    let top: number | null;
    if (surface && fp.standParts) {
      // THE TREAD UNDER THE FOOT, NOT THE OUTLINE OF THE MODEL. A deck is its boards and its
      // stair treads, each at its own height; its railings, posts and fascia are not floor, and
      // the air between its stairs and its corners is not either. See standTreadTop.
      top = standTreadTop(p, x, z, reachTop);
    } else {
      if (!footprintContainsPoint(fp, p.position[0], p.position[2], p.rotation || 0, x, z)) continue;
      // A tabletop keeps `maxY`: what an OBJECT rests on is the top of the model, and no display
      // surface in the catalog has anything standing up out of it. A standable piece only gets
      // here when it was declared as a plain box, whose top is its surface by construction.
      top = p.position[1] + (surface ? (fp.standY ?? fp.maxY) : fp.maxY);
      if (top > reachTop) top = null;
    }
    if (top === null || top <= best.y) continue;
    best = { y: top, supportId: p.instanceId, surface, isSolid: true };
  }

  return best;
}

/**
 * Is there solid footing above the waterline at `(x, z)`?
 *
 * The swim-state machine's override: a player standing on a pier is not swimming, whatever the
 * distance from the island says. Stated as a property of the ground rather than as a check for
 * any particular object, so a second kind of deck needs no change here.
 */
export function isGroundedAt(
  x: number,
  z: number,
  placements: PlacedItem[],
  islandScale: number,
  /**
   * Where the body is standing (or floating) now — see {@link getSurfaceAt}. A swimmer alongside
   * a deck they cannot climb is still swimming; declaring them "on the deck" here while the walk
   * resolve pushes them off its side would flip the swim state every frame.
   */
  fromY?: number | null,
): boolean {
  const hit = getSurfaceAt(x, z, placements, islandScale, null, fromY);
  return hit.isSolid && hit.y > WATER_SURFACE_Y;
}

/**
 * The Y an object of `itemId` should be placed at, at `(x, z)`.
 *
 * A deck sited over open water rests on the sea surface rather than sinking to the seabed — which
 * is what makes it a pier and is the whole reason a deck may be placed there at all. Everything
 * else can only be placed where {@link getSupportAt} already reports solid footing, so this branch
 * never applies to it.
 */
export function resolvePlacementY(
  itemId: string,
  x: number,
  z: number,
  placements: PlacedItem[],
  islandScale: number,
  ignoreInstanceId?: string | null,
  rotation = 0,
): number {
  const hit = getSupportAt(x, z, placements, islandScale, ignoreInstanceId);
  const centred = hit.isSolid ? hit.y : isStandableItem(itemId) ? Math.max(hit.y, WATER_SURFACE_Y) : hit.y;

  // A DECK'S BOARDS ARE NEVER BELOW THE GROUND UNDER THEM. A deck is five metres across and is
  // exactly the piece players run out over the shoreline — the one place the ground is not flat —
  // and it used to be seated from its centre alone. A pier whose middle was over the sea sat at
  // the waterline with its landward boards inside the beach: the sand came up through them, and
  // the player walked on the sand ABOVE the deck, i.e. straight through it.
  //
  // So a deck on the ground is seated from its centre as before, and then lifted by exactly as much
  // as it takes for every point of its walking surface to clear the ground directly under that
  // point — no more. "No more" matters: seating it on the highest ground under it instead lifted a
  // platform that merely overlapped the mound by that mound's 10 cm, which pushed its boards past a
  // step above the grass on every other side and walled the player out of it.
  //
  // Only for the ground. A deck set down on another deck or a table rests on that support's top,
  // which the corner test in evaluateIslandPlacement already requires to be under all of it.
  if (isStandableItem(itemId) && !hit.supportId) {
    const fp = getFootprint(itemId);
    if (fp?.standSurface) {
      return Math.max(centred, lowestBaseClearOfGround(fp.standSurface, x, z, rotation, islandScale));
    }
  }
  return centred;
}

/** How far above the ground under it a deck's walking surface is kept — clear of the terrain's own faces. */
const DECK_GROUND_CLEARANCE = 0.01;

/**
 * The lowest base height at which every sampled point of a deck's walking surface
 * (Footprint.standSurface) stands clear of the terrain directly under it.
 */
function lowestBaseClearOfGround(
  surface: Float32Array,
  x: number,
  z: number,
  rotation: number,
  islandScale: number,
): number {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  let base = -Infinity;
  for (let i = 0; i < surface.length; i += 3) {
    const lx = surface[i], lz = surface[i + 1], top = surface[i + 2];
    const ground = getTerrainInfo(x + lx * cos + lz * sin, z - lx * sin + lz * cos, islandScale).targetY;
    const needed = ground + DECK_GROUND_CLEARANCE - top;
    if (needed > base) base = needed;
  }
  return base;
}

/**
 * Every placement re-seated on the island as it is NOW — or `null` when every one already is.
 *
 * ## Why this exists
 *
 * A placement's height is saved as a number, while the ground it stands on is a function of the
 * TERRITORY LEVEL (constants/terrain.ts scales every radius by `islandScale`). Expanding the
 * territory grows the plateau and the beach outwards under whatever is already standing there, and
 * nothing used to move with it:
 *
 *  - a pier seated on the sea surface (y −0.5, boards at −0.1) ended up INSIDE the new grass
 *    (0.3). Its boards were below the ground the player walks on, so the player walked across the
 *    top of the island through it — the deck was still drawn where it poked out past the new
 *    shoreline, and could not be stood on anywhere;
 *  - a torch on the old beach sank into the new grass by the height the beach rose.
 *
 * ## The rule
 *
 * Each placement is put back through the SAME height rule a new one is placed with
 * ({@link resolvePlacementY}), lowest first so a prop is re-seated on its deck after the deck has
 * moved, and is only ever LIFTED: a piece whose ground has dropped away (the territory shrank)
 * keeps its height, which for a deck is simply a pier on its posts and for everything else is what
 * shrinking has always done. Lifting only is also what makes this safe to run at any time — it can
 * correct a piece that is buried and cannot disturb one that is not.
 *
 * ## Only what was UNDER it
 *
 * A piece is re-seated against the pieces that were saved BELOW it, never against the ones above.
 * It used to be resolved against the whole list, and a stack of two supports — a picnic table on a
 * 木製平台, two overlapping decks — then never settled: the deck, asking what was under its centre,
 * found the table standing on it and was lifted onto the table's top; the table, now the lower of
 * the two, was lifted onto the deck; and so on, one tabletop higher on every call. Nothing ever
 * returned `null`, and IslandPlacements (Three/PlacementGhost.tsx) re-ran this on every new list,
 * so each lift was a save, each save a snapshot, and each snapshot another lift — a write loop that
 * also re-rendered the whole island on every turn. What rests on a piece is never its support, so
 * leaving it out is simply the correct question, and it makes a second call on the result `null`.
 */
export function reseatIslandPlacements(
  placements: PlacedItem[],
  islandScale: number,
): PlacedItem[] | null {
  const order = placements
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.position[1] - b.p.position[1]);
  const out = placements.slice();
  /** Every piece seen so far, as re-seated, with the height it was SAVED at. */
  const seen: { saved: number; placed: PlacedItem }[] = [];
  let changed = false;
  for (const { p, i } of order) {
    // Resolved against what was below it, as re-seated SO FAR, so a prop finds its deck at the
    // deck's new height. Pieces saved at the same height stand side by side, not on each other.
    const beneath = seen
      .filter((s) => s.saved < p.position[1] - RESEAT_TOLERANCE)
      .map((s) => s.placed);
    const ground = resolvePlacementY(
      p.itemId, p.position[0], p.position[2], beneath, islandScale, p.instanceId, p.rotation || 0,
    );
    if (ground > p.position[1] + RESEAT_TOLERANCE) {
      out[i] = { ...p, position: [p.position[0], quantize(ground, 1e-6), p.position[2]] as [number, number, number] };
      changed = true;
    }
    seen.push({ saved: p.position[1], placed: out[i] });
  }
  return changed ? out : null;
}

/** How far below its ground a piece may sit before re-seating lifts it — float noise, not a gap. */
const RESEAT_TOLERANCE = 0.01;

/** Why a spot was refused, in the order the checks run. */
export type PlacementBlockReason = 'noGround' | 'offEdge' | 'overlap';

export interface PlacementVerdict {
  ok: boolean;
  reason: PlacementBlockReason | null;
  /**
   * Where the object actually ends up.
   *
   * Not simply the `(x, z)` that was asked about: the rule quantises it, and slides it back on
   * when it is hanging off the support it landed on — so the caller must draw the ghost at THIS
   * position rather than at the pointer's. Returning the corrected spot rather than only a verdict
   * is what stops the ghost and the rule from having two different ideas of where the object is,
   * which was the shape of every "it says blocked but it looks fine" report.
   */
  x: number;
  z: number;
  /** Where the object would sit — valid whether or not the spot is legal, so the ghost can draw it. */
  y: number;
  /** The deck or tabletop it would rest on, if any. */
  supportId: string | null;
}

export interface EvaluatePlacementArgs {
  itemId: string;
  x: number;
  z: number;
  rotation: number;
  placements: PlacedItem[];
  home: ResolvedHome | null;
  islandScale: number;
  /** The placement being moved, or the Home when the Home is what's being moved. */
  excludeInstanceId?: string | null;
}

/**
 * The single validity rule for putting something on the island. Used by the drag ghost, by the
 * solver that picks a new object's opening position, and by nothing else — there is no second
 * opinion to drift out of sync with.
 */
export function evaluateIslandPlacement({
  itemId, x: rawX, z: rawZ, rotation, placements, home, islandScale, excludeInstanceId,
}: EvaluatePlacementArgs): PlacementVerdict {
  // PRECISION. The island never had a grid of its own — its problem was the opposite, a raw float
  // straight off a plane intersection, saved and reloaded and re-dragged until the same spot had a
  // dozen spellings. Quantising here gives the island the identical step the interior now uses
  // (2 cm, or the coarse align grid while Shift is held), so "one nudge" means the same distance
  // in both modes and a position survives a save/load round trip unchanged.
  const step = getPlacementStep();
  let x = quantize(rawX, step);
  let z = quantize(rawZ, step);

  let hit = getSupportAt(x, z, placements, islandScale, excludeInstanceId);

  // STACKING. When the spot has landed on another placed object — a deck, an outdoor table — slide
  // the whole footprint back onto that top face rather than letting it hang over the edge. This is
  // the same `clampOntoSupport` the interior uses for tabletops, which is what makes putting a
  // lantern on an outdoor table behave exactly like putting a vase on an indoor one.
  //
  // Only for an object SMALLER than its support: clamping a deck onto a table would drag the deck
  // somewhere the player never pointed. `clampOntoSupport` returns null in that case and the spot
  // is left where it is, to be judged on the corner test below like any other.
  const clampFp = hit.supportId ? getFootprint(itemId) : undefined;
  const support = clampFp
    ? placements.find((p) => p.instanceId === hit.supportId)
    : undefined;
  const supportFp = support ? getFootprint(support.itemId) : undefined;

  if (clampFp && support && supportFp) {
    const slide = clampOntoSupport(
      makeObb(clampFp, x, z, rotation),
      makeObb(supportFp, support.position[0], support.position[2], support.rotation || 0),
    );
    if (slide && (slide.dx !== 0 || slide.dz !== 0)) {
      x += slide.dx;
      z += slide.dz;
      hit = getSupportAt(x, z, placements, islandScale, excludeInstanceId);
    }
  }

  const y = resolvePlacementY(itemId, x, z, placements, islandScale, excludeInstanceId, rotation);
  const base: Omit<PlacementVerdict, 'ok' | 'reason'> = { x, z, y, supportId: hit.supportId };

  // 1. There has to be something to stand on. A deck is its own exception, and the only one:
  //    extending buildable ground out over the water is what a deck is for.
  if (!hit.isSolid && !isStandableItem(itemId)) {
    return { ...base, ok: false, reason: 'noGround' };
  }

  const fp = getFootprint(itemId);

  // An unmeasured item is one whose model has never mounted. Refusing on the strength of a box we
  // do not have would block the player for a reason we cannot show them; the first mount measures
  // it and the caller re-runs this (see subscribeFootprints).
  if (!fp) return { ...base, ok: true, reason: null };

  // 2. Whatever holds the centre must hold the whole object. Without this an object dropped near a
  //    deck's edge is half on the boards and half in mid-air — the placement height is resolved
  //    from one point, so it can only ever be right for one point. Checking the corners against
  //    the same surface lookup states the requirement directly, and costs nothing on open ground
  //    where every corner reports the island. It is the same rule at the shoreline, where the
  //    thing hanging off the edge is the beach.
  for (const [cornerX, cornerZ] of footprintOutline(fp, x, z, rotation)) {
    const corner = getSupportAt(cornerX, cornerZ, placements, islandScale, excludeInstanceId);
    // Only when the object is STANDING ON something. "Half on the platform" is a real thing to
    // say to a player who put a fountain on the edge of a deck; it is nonsense said to one who set
    // a chair beside a table and caught its corner — nothing is hanging off anything there, there
    // is simply a table in the way, and rule 3 below says so in words that help.
    if (hit.supportId && corner.supportId !== hit.supportId) {
      return { ...base, ok: false, reason: 'offEdge' };
    }
    if (!corner.isSolid && !isStandableItem(itemId)) {
      return { ...base, ok: false, reason: 'noGround' };
    }
  }

  // 3. Nothing may be put inside anything else. The deck underneath is the exception, because
  //    resting on a surface is the whole point of having placed it there.
  const ignore = new Set<string>();
  if (excludeInstanceId) ignore.add(excludeInstanceId);
  if (hit.supportId) ignore.add(hit.supportId);

  const obstacles = home && excludeInstanceId !== HOME_INSTANCE_ID
    ? [...placements, homeAsPlacement(home)]
    : placements;

  const candidate: PlacedItem = { instanceId: '__draft__', itemId, position: [x, y, z], rotation };
  if (findPlacementConflict(candidate, obstacles, ignore)) {
    return { ...base, ok: false, reason: 'overlap' };
  }

  return { ...base, ok: true, reason: null };
}

/** Player-facing explanation for each refusal, shown by the editor panel and the error toast. */
export const PLACEMENT_BLOCK_MESSAGE: Record<PlacementBlockReason, string> = {
  noGround: '這裡是海面，請放在陸地或木製平台上',
  offEdge: '有一半懸在平台外，請整個放上平台',
  overlap: '此處已有其他擺設',
};
