/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 寵物的休息位置 — where the animal goes when it wants to lie down, resolved from what is actually
 * standing on the island.
 *
 * The brief's §9 is a list of things this must NOT be, and every one of them is a shape somebody
 * reaches for first:
 *
 *   ❌ a fixed world coordinate            — a bed the player moves would be a bed the pet ignores
 *   ❌ `find(item.id === 'pet-bed-01')`    — a second bed style would need a second branch
 *   ❌ `find(item.name.includes('窩'))`     — the name-keyword guess this codebase already retired
 *                                             once (see constants/furnitureInteractions.ts)
 *
 * What it is instead: a search over the player's own placements for anything whose CATALOG ENTRY
 * declares `petRest` (constants/petHabitats.ts's `PetRestSpec`). A resting spot is a capability a
 * piece has, in the same way a table declares `tabletop` and a hammock declares `interactions`. So
 * an indoor basket, a shaded platform, a bigger kennel or a bird's perch all become resting spots by
 * being added to the catalog with that field, and nothing in this file changes.
 *
 * ## Species is a FILTER here, not a branch anywhere else
 *
 * A cage is not a resting place for a dog, and the way that is expressed is that a dog's scan never
 * returns one — `habitatAcceptsSpecies`, one `includes` over the item's own declaration. There is no
 * 「這隻是鳥嗎」 in this file and none in its callers: a bird with only a kennel placed simply has no
 * owned spot and falls through to the improvised nest, exactly as a bird with nothing placed does.
 * That is the brief's §5 (「不讓玩家看到不適用的選項」) applied to the world rather than to a menu.
 *
 * ## The improvised nest is the FALLBACK, not the rule
 *
 * A player who has never bought a bed still has a pet that needs somewhere to be, so the last resort
 * is 離線回歸's improvised spot beside the Home (`getPetRestSpot`) — the mat, the bowl and the toys
 * that Three/IslandOvergrowth.tsx draws. That is the one place the two systems meet, and they meet
 * through the same function rather than through two copies of the same offset: a pet waiting three
 * metres from its own visible bed is the exact kind of small wrongness that reads as a bug.
 */

import type { PlacedItem } from '../types';
import { getItemById } from '../constants/items';
import { getPetRestSpot } from '../constants/islandReturn';
import { getPetSpecies, type PetSpecies } from '../constants/pets';
import {
  PET_HABITAT_KINDS,
  habitatAcceptsSpecies,
  type PetHabitatKind,
  type PetRestPosture,
  type PetRestSpec,
} from '../constants/petHabitats';

/**
 * A place the animal can settle, in world units.
 *
 * `source` is what the renderer branches on, and it is the whole reason this is a record rather than
 * a bare point: the improvised nest art (mat, empty bowl, scattered toys) is a picture of 「沒人收拾」
 * and must NOT be drawn on top of a bed the player actually bought and placed. See
 * Three/IslandOvergrowth.tsx.
 */
export interface PetRestingSpot {
  x: number;
  z: number;
  /** How close the animal has to get before it counts as having arrived. */
  radius: number;
  /**
   * How high above the ground the animal comes to rest here, in world units. 0 for anything a
   * mammal lies on; a perch, a cage floor or a nest rim is where a bird actually lands.
   */
  height: number;
  /**
   * How the animal is off its feet here — `lie` for a bed, `perch` for anything a bird grips.
   *
   * Carried on the RESOLVED spot rather than looked up again by each mover, for the same reason
   * an interaction target carries its verb (lib/interactionTargeting.ts): the thing that found it already
   * knows, and two lookups are two chances to disagree.
   */
  posture: PetRestPosture;
  /** `item` — a piece the player owns and placed. `default` — the improvised spot by the Home. */
  source: 'item' | 'default';
  /** What to call it in the care panel. The piece's own name; never a second copy of it. */
  label: string;
  /** Which shape of home it is, for the panel's one-line explanation. */
  kind?: PetHabitatKind;
  /** The catalog id of the piece, when there is one. Diagnostics and copy only. */
  itemId?: string;
  /** Which placement it is, so a second bed of the same kind is still a distinct spot. */
  instanceId?: string;
}

/** The improvised spot's reach — about the size of the mat drawn there. */
const DEFAULT_SPOT_RADIUS = 0.8;

/**
 * Every resting spot currently available to a given species, nearest-to-the-Home first.
 *
 * Exported alongside {@link resolveRestingSpot} because the care panel wants to say 「你有 2 個窩」
 * without re-implementing the scan, and because a future feature that lets the player CHOOSE which
 * bed their pet uses needs the list rather than the winner.
 */
export function collectRestingSpots(opts: {
  placements: readonly PlacedItem[];
  home: { position: [number, number, number]; rotation: number } | null;
  species?: PetSpecies;
}): PetRestingSpot[] {
  const { placements, home, species } = opts;
  const spots: PetRestingSpot[] = [];

  for (const placement of placements) {
    const item = getItemById(placement.itemId);
    const spec = item?.petRest;
    if (!spec) continue;
    // A spot that does not accept this animal is not a spot — the whole of the compatibility
    // system, right here. An absent `species` argument is a caller that has no particular animal in
    // mind (a preview harness, a 「島上有幾個窩」 count) and sees them all.
    if (species && !habitatAcceptsSpecies(spec, species)) continue;
    spots.push(toWorldSpot(placement, spec, item.name));
  }

  // Nearest the Home first, then by instance id. Two beds side by side must resolve to the SAME one
  // on every device and every reload — an order that depends on where the pet happens to be standing
  // would have it change its mind halfway across the garden.
  const anchor = home?.position ?? [0, 0, 0];
  spots.sort((a, b) => {
    const da = Math.hypot(a.x - anchor[0], a.z - anchor[2]);
    const db = Math.hypot(b.x - anchor[0], b.z - anchor[2]);
    if (Math.abs(da - db) > 1e-6) return da - db;
    return (a.instanceId ?? '').localeCompare(b.instanceId ?? '');
  });

  return spots;
}

/**
 * The one spot the animal will actually use. Total — there is always an answer.
 *
 * A placed bed wins over the improvised nest, because buying and putting one down is the player
 * saying where they want the animal to sleep. With none placed, the fallback is 離線回歸's spot beside
 * the Home; with no Home either (a brand-new player, who has never been away and has no pet to worry
 * about) that function still returns a point out on the grass, which is what keeps this total and
 * every caller free of a null branch.
 */
export function resolveRestingSpot(opts: {
  placements: readonly PlacedItem[];
  home: { position: [number, number, number]; rotation: number } | null;
  islandScale: number;
  /** The equipped companion's item id, so a species-specific bed can be honoured. */
  petItemId?: string | null;
}): PetRestingSpot {
  const species = getPetSpecies(opts.petItemId);
  const owned = collectRestingSpots({
    placements: opts.placements,
    home: opts.home,
    ...(species ? { species } : {}),
  });
  if (owned.length > 0) return owned[0];

  const fallback = getPetRestSpot(opts.home, opts.islandScale);
  return {
    x: fallback.x,
    z: fallback.z,
    radius: DEFAULT_SPOT_RADIUS,
    // On the ground and lain in, whatever species is using it: the improvised nest is a mat with a
    // bowl beside it, and a bird with no perch of its own comes down to it rather than hovering over
    // a spot in mid-air. It is the fallback precisely because it suits nobody in particular.
    height: 0,
    posture: 'lie',
    source: 'default',
    label: '屋旁的小窩',
  };
}

/**
 * A placement plus its spec, in world units.
 *
 * The rotation convention is three's own — `x' = x·cos + z·sin`, `z' = -x·sin + z·cos` — stated the
 * same way lib/furniturePlacement.ts and constants/islandReturn.ts state it for their own boxes. A
 * spec with no offset lies at the piece's centre, so the rotation is a no-op for every bed sold
 * today and the maths only starts to matter for the first kennel with a door on one side.
 */
function toWorldSpot(placement: PlacedItem, spec: PetRestSpec, name: string): PetRestingSpot {
  const localX = spec.offset?.x ?? 0;
  const localZ = spec.offset?.z ?? 0;
  const cos = Math.cos(placement.rotation || 0);
  const sin = Math.sin(placement.rotation || 0);
  return {
    x: placement.position[0] + localX * cos + localZ * sin,
    z: placement.position[2] - localX * sin + localZ * cos,
    radius: spec.radius,
    height: spec.height ?? 0,
    posture: PET_HABITAT_KINDS[spec.kind].posture,
    source: 'item',
    // The item's own name, so the panel and the shop card cannot end up calling one basket two
    // different things. This used to be a `label` written on the spec beside it, which was a second
    // copy of a string that was always identical to the first.
    label: name,
    kind: spec.kind,
    itemId: placement.itemId,
    instanceId: placement.instanceId,
  };
}
