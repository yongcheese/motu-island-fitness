/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PlacedItem } from '../types';
import {
  OVERGROWTH_KINDS,
  OvergrowthKind,
  OvergrowthSprout,
  TIDY_HOME_RADIUS,
  TIDY_RADIUS,
  WALL_ANCHOR_COUNT,
  getOvergrowthKind,
  overgrowthMix,
} from '../constants/islandReturn';
import { PATHWAY_BASE_POINTS } from '../constants/terrain';
import {
  HomeObstacle,
  findRandomValidPlacement,
  isValidTerrainPosition,
} from '../utils/placementRules';

/**
 * 離線環境變化的「長在哪裡」與「清掉哪些」。
 *
 * The rules half lives in constants/islandReturn.ts and decides HOW MUCH of WHAT an absence is
 * worth. This module is the other question — where a sprout is allowed to stand — and it answers
 * it by going through the placement solver the island already uses for its flowers and rocks
 * (utils/placementRules.ts) rather than by inventing a second idea of where the ground is.
 *
 * ## Why this is not a decoration and not a placement
 *
 * Everything produced here is **temporary world state**. It is not an item, it has no catalog
 * entry, it is never in the inventory, it is never in `islandPlacements`, and it has no walk box:
 * `resolvePlayerAgainstFurniture` cannot see it, the build system cannot select it, and the shop
 * cannot sell it. That separation is the brief's §13 and it is structural — a sprout is a row in
 * `profile.islandState.sprouts`, a different field with a different shape, so there is no code
 * path along which one could be mistaken for furniture.
 *
 * ## Topping up, never re-rolling
 *
 * {@link growOvergrowth} is given what the island is ALREADY holding and grows only the shortfall
 * against what the absence is worth. Nothing is ever removed by growth — the only thing that
 * removes a sprout is the player tidying it.
 *
 * The brief's §11/§12 guarantee — 「玩家下一次登入不應該再次產生另外 5 個相同類型雜草」 — comes out
 * of that plus ONE other fact, and it is worth being precise about which: arriving stamps
 * `islandState.lastSeenAt` (context/useIslandLife.ts), so the next login measures its absence from
 * that moment and is worth nothing at all. A player who tidies and comes back tomorrow finds their
 * work still done, because tomorrow's budget is zero — not because anything remembers what they
 * cleared. A player who tidies and then leaves for another two months finds weeds again, which is
 * the same rule producing the right answer rather than an exception to it.
 *
 * Stated that way because the alternative — a 「已整理」 flag — is what would actually break: it
 * would have to be cleared on some schedule, and whatever that schedule was would eventually
 * disagree with the clock the rest of the feature runs on. `scripts/test-offline-return.ts` pins
 * both halves.
 */

/* --- Keep-out --------------------------------------------------------------------------- */

/**
 * How far a sprout stays off the island's spawn point.
 *
 * The player materialises at the world origin every time they load in, and the very first frame
 * of a return is the one this whole feature exists to compose. Something growing between their
 * feet is the one thing guaranteed to be read as "this is in my way" rather than as "time passed".
 */
const SPAWN_CLEARANCE = 2.2;

/** How far a sprout stays off a stepping stone, so the path stays a path. */
const PATH_CLEARANCE = 0.85;

/**
 * How far a sprout stays off anything the player has placed.
 *
 * Measured from the object's origin rather than from its walk box on purpose: this runs at LOGIN,
 * before the scene has mounted, and the measured boxes (lib/furniturePlacement.ts) only exist once
 * the models have been rendered at least once. A generous fixed radius is the honest version of
 * that constraint — it errs towards leaving a wider gap around a bench than the bench needs, which
 * is exactly the direction to err when the rule being served is 「不要擋住互動物件」.
 */
const PLACEMENT_CLEARANCE = 1.35;

/** Minimum gap between two sprouts, so a patch reads as scattered rather than as a pile. */
const SPROUT_SPACING = 0.7;

/**
 * How far from the Home, or from something the player put down, still counts as a sheltered spot.
 *
 * The brief's §14 asks for regional difference — 「房屋周圍：較容易出現雜草」 — on an island that has
 * no region system, and explicitly says not to build one for this. It does not need one. The
 * island already has the only zoning that matters here, and it is not a map: it is where the
 * player has BEEN. Grass comes up at the foot of a wall, behind a bench, along the edge of a
 * flower bed — the corners a rake does not reach — and the open middle of a lawn stays open.
 *
 * So "sheltered" is derived from the Home and the player's own placements rather than declared,
 * which means it costs nothing to maintain and it follows the player: move the house, and where
 * the weeds prefer to grow moves with it.
 */
const SHELTER_RADIUS = 4.5;

/** How much closer to a small prop counts as sheltered than to the Home. */
const SHELTER_PROP_FACTOR = 0.5;

/**
 * The odds an exposed spot is accepted anyway, while the bias is still being applied.
 *
 * Not zero, and that is the whole of 「可控的隨機」. At zero the open lawn would be perfectly,
 * unnaturally clean and every weed would be hugging a wall, which reads as decoration placed by a
 * level designer. At roughly a third, the middle of the island gets a scattering and the corners
 * get most of it — which is what an untended garden looks like.
 */
const EXPOSED_ODDS = 0.35;

/**
 * How many of the {@link SITING_ATTEMPTS} apply the shelter bias at all.
 *
 * The remainder take the first legal spot they find, whatever it is. That ordering is what keeps
 * the bias a PREFERENCE rather than a constraint: on a crowded island where the sheltered corners
 * are already full, a sprout still finds somewhere to stand instead of silently failing to grow
 * and quietly under-spending the budget the curve authorised.
 */
const BIASED_ATTEMPTS = 5;

/** Ground height sprouts are seated at, before the renderer conforms them to the terrain. */
const GROUND_Y = 0.35;

function within(ax: number, az: number, bx: number, bz: number, radius: number): boolean {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz < radius * radius;
}

/**
 * Whether a candidate point is somewhere the island may grow something.
 *
 * The Home, its doorway approach and the grass/sand edge are already refused by
 * `findRandomValidPlacement` before a candidate reaches here; this adds the four keep-outs that
 * solver has no reason to know about.
 */
function isGrowableSpot(
  x: number,
  z: number,
  ctx: { islandScale: number; placements: PlacedItem[]; taken: Array<[number, number]> },
): boolean {
  if (!isValidTerrainPosition(x, z, ctx.islandScale)) return false;
  if (within(x, z, 0, 0, SPAWN_CLEARANCE)) return false;

  for (const point of PATHWAY_BASE_POINTS) {
    if (within(x, z, point[0] * ctx.islandScale, point[2] * ctx.islandScale, PATH_CLEARANCE)) return false;
  }
  for (const placed of ctx.placements) {
    if (within(x, z, placed.position[0], placed.position[2], PLACEMENT_CLEARANCE)) return false;
  }
  for (const [tx, tz] of ctx.taken) {
    if (within(x, z, tx, tz, SPROUT_SPACING)) return false;
  }
  return true;
}

/**
 * Whether a spot is tucked in beside something, as opposed to out on the open lawn.
 *
 * Cheap on purpose — a handful of squared distances against a list that is a few dozen long at
 * most, run only while siting at login, never per frame.
 */
function isSheltered(x: number, z: number, opts: GrowOptions): boolean {
  if (opts.home && within(x, z, opts.home.position[0], opts.home.position[2], SHELTER_RADIUS)) {
    return true;
  }
  const propRadius = SHELTER_RADIUS * SHELTER_PROP_FACTOR;
  for (const placed of opts.placements) {
    if (within(x, z, placed.position[0], placed.position[2], propRadius)) return true;
  }
  return false;
}

/* --- Growth ----------------------------------------------------------------------------- */

/**
 * How many times one sprout is allowed to look for a spot before the island gives up on it.
 *
 * Higher than it looks like it needs to be, because a full island is genuinely crowded: 26
 * sprouts each holding {@link SPROUT_SPACING} against every other one, on a plateau that has
 * already had the spawn point, the stepping stones, the Home and every placed object cut out of
 * it. At eight attempts a fully overgrown island fell short of the budget the curve authorised in
 * roughly a quarter of runs, and adding the shelter bias above — which spends attempts being
 * fussy — made that worse.
 *
 * That shortfall is not cosmetic. The sprout list is what {@link resolveIslandAmbience} grades the
 * light from, so an island that quietly grew 18 objects instead of 26 is also an island that is
 * quietly less dim than a month away is supposed to look. Attempts are the cheap side of that
 * trade: this loop runs once, at login, for a couple of dozen objects, and each attempt is a
 * handful of squared distances.
 */
const SITING_ATTEMPTS = 16;

let idCounter = 0;

/** Short, collision-proof enough for a list that never exceeds a couple of dozen rows. */
function sproutId(): string {
  idCounter += 1;
  return `og${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export interface GrowOptions {
  /** What the island is already holding. Never modified; the result is a new array. */
  existing: readonly OvergrowthSprout[];
  /** Hours of absence, as resolved by constants/islandReturn.ts. */
  hours: number;
  /** The player's Home, or null while it has not been placed. Wall-borne kinds need one. */
  home: HomeObstacle | null;
  islandScale: number;
  /** The player's own placed objects, which sprouts route around. Read-only. */
  placements: PlacedItem[];
}

/**
 * Tops the island up to what `hours` of absence is worth, and returns the whole list.
 *
 * Returns the SAME array instance when nothing was added, so a caller can use identity to decide
 * whether a save is needed — a returning player who was only away overnight, or who is loading in
 * for the second time from one absence, writes nothing at all.
 *
 * Wall-borne kinds are skipped entirely when there is no Home to climb; their share of the budget
 * simply goes unspent rather than being reassigned to the ground. A player who has not yet placed
 * their house is by definition a new player, and the ground kinds alone already say everything the
 * scene needs to.
 */
export function growOvergrowth(opts: GrowOptions): OvergrowthSprout[] {
  const target = overgrowthMix(opts.hours);
  if (target.size === 0) return opts.existing as OvergrowthSprout[];

  const held = new Map<OvergrowthKind, number>();
  for (const sprout of opts.existing) held.set(sprout.kind, (held.get(sprout.kind) ?? 0) + 1);

  const taken: Array<[number, number]> = opts.existing
    .filter((s) => getOvergrowthKind(s.kind).surface === 'ground')
    .map((s) => [s.x, s.z] as [number, number]);
  const usedSlots = new Set(opts.existing.filter((s) => s.slot >= 0).map((s) => s.slot));

  const grown: OvergrowthSprout[] = [];

  for (const kindDef of OVERGROWTH_KINDS) {
    const want = target.get(kindDef.id) ?? 0;
    const have = held.get(kindDef.id) ?? 0;
    let shortfall = want - have;
    if (shortfall <= 0) continue;

    if (kindDef.surface === 'wall') {
      if (!opts.home) continue;
      while (shortfall > 0) {
        const slot = pickFreeSlot(usedSlots);
        if (slot < 0) break;
        usedSlots.add(slot);
        grown.push({ id: sproutId(), kind: kindDef.id, x: 0, z: 0, slot, seed: Math.random() });
        shortfall -= 1;
      }
      continue;
    }

    while (shortfall > 0) {
      const spot = siteGroundSprout(opts, taken);
      if (!spot) break;
      taken.push(spot);
      grown.push({
        id: sproutId(),
        kind: kindDef.id,
        x: spot[0],
        z: spot[1],
        slot: -1,
        seed: Math.random(),
      });
      shortfall -= 1;
    }
  }

  if (grown.length === 0) return opts.existing as OvergrowthSprout[];
  return [...opts.existing, ...grown];
}

/** A free anchor on the Home, or -1 when every slot is already carrying something. */
function pickFreeSlot(used: Set<number>): number {
  if (used.size >= WALL_ANCHOR_COUNT) return -1;
  const start = Math.floor(Math.random() * WALL_ANCHOR_COUNT);
  for (let i = 0; i < WALL_ANCHOR_COUNT; i += 1) {
    const slot = (start + i) % WALL_ANCHOR_COUNT;
    if (!used.has(slot)) return slot;
  }
  return -1;
}

/** One spot on the grass, or null when the island genuinely has nowhere left to put anything. */
function siteGroundSprout(
  opts: GrowOptions,
  taken: Array<[number, number]>,
): [number, number] | null {
  for (let attempt = 0; attempt < SITING_ATTEMPTS; attempt += 1) {
    // 'Flora' is not decoration: the name is read by isPlacementAllowed, which lets small scattered
    // flora hug the Home's stop line more closely than furniture-sized props may. A weed at the
    // foot of a wall is exactly the picture, and it is still outside the box the player is held
    // out of, so nothing can grow anywhere they cannot reach.
    const [x, , z] = findRandomValidPlacement('Flora', opts.home, opts.islandScale, [], GROUND_Y, 6);
    if (!isGrowableSpot(x, z, { islandScale: opts.islandScale, placements: opts.placements, taken })) {
      continue;
    }
    // The zone preference (§14). Applied only while attempts remain to spend on being fussy — see
    // BIASED_ATTEMPTS — so this can shape where growth lands but can never prevent it.
    if (attempt < BIASED_ATTEMPTS && !isSheltered(x, z, opts) && Math.random() > EXPOSED_ODDS) {
      continue;
    }
    return [x, z];
  }
  return null;
}

/* --- Tidying ---------------------------------------------------------------------------- */

export interface TidyResult {
  /** What is left afterwards. The same array instance when nothing was in reach. */
  sprouts: OvergrowthSprout[];
  /** What the player just cleared, so the toast can name it. */
  removed: OvergrowthSprout[];
}

/**
 * Clears the overgrowth around a point.
 *
 * Ground sprouts go by their own distance; wall-borne ones go by the player's distance to the
 * Home, since a vine's stored position is a slot on the building rather than a place on the
 * island. One press therefore takes the corner the player is standing in, walls included when
 * they are standing at the house — which is what 「整理」 means to someone holding a rake, and it
 * keeps the whole feature to a single verb.
 */
export function tidyOvergrowthAt(
  sprouts: readonly OvergrowthSprout[],
  x: number,
  z: number,
  home: HomeObstacle | null,
): TidyResult {
  const atHome = !!home && within(x, z, home.position[0], home.position[2], TIDY_HOME_RADIUS);
  const removed: OvergrowthSprout[] = [];
  const kept: OvergrowthSprout[] = [];

  for (const sprout of sprouts) {
    const inReach =
      getOvergrowthKind(sprout.kind).surface === 'wall'
        ? atHome
        : within(x, z, sprout.x, sprout.z, TIDY_RADIUS);
    (inReach ? removed : kept).push(sprout);
  }

  if (removed.length === 0) return { sprouts: sprouts as OvergrowthSprout[], removed };
  return { sprouts: kept, removed };
}

export interface TidyTarget {
  /** Where to float the prompt: the nearest sprout, or the wall the vines are on. */
  x: number;
  z: number;
  /** How many sprouts one press would clear from here. */
  count: number;
  /** True when the only thing in reach is on the Home — the badge floats at eave height. */
  wall: boolean;
}

/**
 * What a tidy from `(x, z)` would take, and where to point at it — or null when there is nothing
 * in reach.
 *
 * Shared by the prompt and the action, so a badge can never offer a tidy the write would find
 * nothing to do, and the two can never disagree about which patch is being pointed at. Same
 * arrangement as constants/dailyLogin.ts's `canClaim`.
 *
 * Written as one allocation-free scan rather than by calling {@link tidyOvergrowthAt} and
 * measuring the result: this runs inside the interaction tracker's per-frame loop
 * (Three/InteractionPromptTracker.tsx), where building two arrays every frame to answer a
 * yes/no question is exactly the kind of steady garbage that shows up as stutter rather than as
 * a frame-rate number.
 */
export function findTidyTarget(
  sprouts: readonly OvergrowthSprout[],
  x: number,
  z: number,
  home: HomeObstacle | null,
): TidyTarget | null {
  const atHome = !!home && within(x, z, home!.position[0], home!.position[2], TIDY_HOME_RADIUS);

  let count = 0;
  let bestX = 0;
  let bestZ = 0;
  let bestDistSq = Infinity;

  for (const sprout of sprouts) {
    if (getOvergrowthKind(sprout.kind).surface === 'wall') {
      if (atHome) count += 1;
      continue;
    }
    const distSq = (sprout.x - x) ** 2 + (sprout.z - z) ** 2;
    if (distSq >= TIDY_RADIUS * TIDY_RADIUS) continue;
    count += 1;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestX = sprout.x;
      bestZ = sprout.z;
    }
  }

  if (count === 0) return null;
  if (bestDistSq < Infinity) return { x: bestX, z: bestZ, count, wall: false };

  // Only wall-borne sprouts in reach. The badge goes on the OUTSIDE of the wall the player is
  // standing at, not at the building's centre: a point inside the shell is on the far side of the
  // house's own solid box from the player, and the targeting pass's line-of-reach test
  // (lib/interactionTargeting.ts) would rightly refuse it — the same reason the front door's
  // interaction point stands just proud of the wall (hooks/usePlayerHome.ts).
  const fp = home!.footprint;
  const standoff = Math.max(fp.halfWidth, fp.halfDepth) + 0.7;
  const dx = x - home!.position[0];
  const dz = z - home!.position[2];
  const len = Math.hypot(dx, dz) || 1;
  return {
    x: home!.position[0] + (dx / len) * standoff,
    z: home!.position[2] + (dz / len) * standoff,
    count,
    wall: true,
  };
}

/**
 * A one-line summary of what grew, in the player's words: 「落葉 x5・雜草 x3」.
 *
 * Built from the catalogue's own labels and in its own order, so adding a kind adds it here too.
 */
export function summariseOvergrowth(sprouts: readonly OvergrowthSprout[]): string {
  const counts = new Map<OvergrowthKind, number>();
  for (const sprout of sprouts) counts.set(sprout.kind, (counts.get(sprout.kind) ?? 0) + 1);
  return OVERGROWTH_KINDS.filter((k) => counts.has(k.id))
    .map((k) => `${k.label} x${counts.get(k.id)}`)
    .join('・');
}
