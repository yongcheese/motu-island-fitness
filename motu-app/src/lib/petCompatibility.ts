/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 「這件商品是給哪一種寵物的」 — one question, asked of any catalog row.
 *
 * Two unrelated capabilities answer it. A resting place declares `petRest.species`
 * (constants/petHabitats.ts) and a food declares `consumable.species`
 * (constants/consumables.ts), and each of those is read directly by the system that owns it: the
 * resting-spot resolver never asks about food, and the feeding list never asks about beds.
 *
 * This file exists for the one caller that has to span both — the SHOP. A player standing in front
 * of 寵物用品 and 寵物窩 is looking at two shelves that are filtered by the same question, and the
 * chip row doing the filtering should not have to know that one shelf's answer lives on a
 * `petRest` and the other's on a `consumable`. So the union is written down once, here, in the
 * `lib/` layer where the other cross-catalog queries live (lib/petRestingSpots.ts), rather than as
 * an `item.petRest?.species ?? item.consumable?.species` expression repeated at each use.
 *
 * A row that declares NEITHER capability is not a pet item and is suitable for nobody — which is
 * what keeps this safe to call over the whole catalog. A pet-targeted consumable with no `species`
 * is the universal treat and suits everybody; see `consumableAcceptsSpecies`.
 */

import type { ItemDefinition } from '../constants/items';
import { consumableAcceptsSpecies } from '../constants/consumables';
import { habitatAcceptsSpecies } from '../constants/petHabitats';
import { PET_SPECIES, type PetSpecies } from '../constants/pets';

/** Whether this row is for pets at all — a bed, a food, or anything later that declares either. */
export function isPetSupplyItem(item: ItemDefinition): boolean {
  return !!item.petRest || item.consumable?.target === 'pet';
}

/**
 * Whether a catalog row suits a given species.
 *
 * True when EITHER capability accepts it, rather than when both do: no item today declares both,
 * and one that did (a perch with a seed tray built in?) would be for whoever either half is for.
 */
export function itemSuitsSpecies(item: ItemDefinition, species: PetSpecies): boolean {
  if (item.petRest && habitatAcceptsSpecies(item.petRest, species)) return true;
  if (item.consumable?.target === 'pet' && consumableAcceptsSpecies(item.consumable, species)) {
    return true;
  }
  return false;
}

/**
 * Which species a set of rows serves, in the canonical species order.
 *
 * What the shop's chip row is built from, so a chip only ever appears for a species the shelf in
 * front of the player actually has something for — a filter that can only empty the screen is a
 * filter that should not be offered. It also means the row appears on any FUTURE pet shelf (玩具,
 * 清潔用品) the moment its items declare a species, with no edit to the shop.
 */
export function speciesServedBy(items: readonly ItemDefinition[]): PetSpecies[] {
  const served = new Set<PetSpecies>();
  for (const item of items) {
    for (const species of PET_SPECIES) {
      if (itemSuitsSpecies(item, species)) served.add(species);
    }
  }
  return PET_SPECIES.filter((id) => served.has(id));
}
