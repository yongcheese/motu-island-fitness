/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 消耗品 — what it means for a catalog ITEM to be used up, and what using one does.
 *
 * The brief's §12 asks for exactly one thing here: pet food must not arrive with an inventory of its
 * own. It does not have one. A consumable is an ordinary item in constants/items.ts, held in the
 * ordinary `profile.inventory` list, counted by the ordinary utils/inventory.ts stock model (a
 * `consumable` category stacks — one entry per copy bought), and bought through the ordinary Shop
 * System. The only thing this file adds is a declared answer to 「用掉它會發生什麼事」.
 *
 * ## Why this is not 功能卡
 *
 * constants/utilityCards.ts already models 「a thing you spend」, and it deliberately is NOT an item:
 * a card has no `shopCategory`, no placement scope and no stock rule, and what it changes is how the
 * REWARD LAYER pays out for a while. A consumable is the opposite shape — it is a physical thing on
 * a shelf with a price and a stack, and what it changes is something in the world right now. Folding
 * one into the other would mean either giving cards a placement scope they have no use for, or
 * teaching the reward layer about a bowl of dog food.
 *
 * So the two systems sit side by side and share the concept, not the code:
 *
 *   功能卡  → 買/抽 → utilityCards.owned → 使用 → 獎勵計算層
 *   消耗品  → 買    → inventory          → 使用 → the target's own state
 *
 * ## The shape a second consumable lands in
 *
 * An `ItemDefinition` with `consumable: { target, verb, effects, … }`, a `shopCategory` whose kind is
 * `consumable`, and nothing else. Specifically NOT:
 *
 *  - a branch anywhere on the item's id — every consumer asks {@link getConsumableSpec};
 *  - a second inventory — see above;
 *  - an effect implemented at the call site — {@link ConsumableEffect} is a small union of effect
 *    SHAPES, and applying one is the target system's single entry point (for a pet, that is
 *    `applyPetCareEffects` in constants/petCare.ts).
 *
 * A genuinely new KIND of effect (a temporary player buff, something that changes the island) is one
 * member of that union plus one branch in the resolver for its target — the same arrangement
 * constants/utilityCards.ts uses for its own effects, and for the same reason.
 */

import { ALL_ITEMS, getItemById, type ItemDefinition } from './items';
import { PET_FOOD_EFFECT_RANGE } from './petCare';
import type { PetSpecies } from './pets';

/**
 * What a consumable acts on.
 *
 * The target decides WHO applies the effect, which is why it is a field rather than something
 * inferred from the effect kinds: a future item that restores a pet's energy AND gives the player a
 * warm glow is still aimed at one of them, and 「對誰使用」 is the question the use flow asks first.
 * Only `pet` is honoured today; the other two are declared so the type does not have to change when
 * they are, and so nothing is tempted to squeeze a player buff into the pet path.
 */
export type ConsumableTarget = 'pet' | 'player' | 'island';

/** What using one does. One member per effect SHAPE, never per item. */
export type ConsumableEffect =
  /** Restores 營養 on the pet it is fed to, as a 0..1 fraction of a full bowl. */
  | { kind: 'pet-nutrition'; amount: number }
  /** Restores 活動力 directly — a treat that perks an animal up rather than filling it. */
  | { kind: 'pet-energy'; amount: number };

export type ConsumableEffectKind = ConsumableEffect['kind'];

/** What each effect is called on screen. Never derived from the kind id. */
export const CONSUMABLE_EFFECT_LABELS: Record<ConsumableEffectKind, string> = {
  'pet-nutrition': '營養',
  'pet-energy': '活動力',
};

/**
 * The consumable half of an item definition.
 *
 * Declared on the item (constants/items.ts) exactly as `standable`, `tabletop`, `placement`,
 * `interactions` and `petRest` are, and for the same stated reason: it is a CAPABILITY that nothing
 * about the item's name, price or category implies, and every screen that needs it should be able to
 * read it rather than re-guess it.
 */
export interface ConsumableSpec {
  target: ConsumableTarget;
  /**
   * 適用寵物種類 — which animals may be given this. Absent means every species: the universal treat.
   *
   * The brief's §11 and §17 are the same requirement seen from the data side and from the screen
   * side. This field is the whole of it: the feeding list is `getPetFoodsFor(species)`, and a dog
   * therefore never SEES a bag of birdseed rather than being told off for offering one. There is no
   * `if (species === 'dog')` in any screen, no rejection message for the wrong food, and no
   * per-species food list anywhere — because a filter over a declaration cannot drift from the
   * catalog the way a hand-kept list can.
   *
   * Meaningful only for `target: 'pet'`; anything aimed at the player or the island leaves it off.
   */
  species?: readonly PetSpecies[];
  /**
   * The verb on the button — 餵食 / 使用 / 灑下.
   *
   * Written per item rather than derived from the target, for the same reason
   * constants/furnitureInteractions.ts writes 坐下/躺下/許願 per piece: 「使用 基礎飼料」 says nothing
   * about what pressing it will do, and 「餵食」 does.
   */
  verb: string;
  effects: readonly ConsumableEffect[];
  /**
   * The effect in one short phrase — 「營養 +40%」.
   *
   * Written rather than generated. A sentence assembled from `${kind} ${amount}` reads like a
   * spreadsheet row, and this is the line the player actually sees on a small tile. Kept honest
   * against `effects` by `npm run test:pet-care`.
   */
  effectSummary: string;
  /**
   * One line telling the player how to use it, shown under the button in 我的寵物用品.
   *
   * On the item because HOW differs per target: food is carried to the animal, whereas something
   * aimed at the island would be used where the player is standing.
   */
  useHint: string;
}

/** The consumable spec for an item id, or undefined for anything that is not one. */
export function getConsumableSpec(itemId: string | null | undefined): ConsumableSpec | undefined {
  return itemId ? getItemById(itemId)?.consumable : undefined;
}

export function isConsumableItem(itemId: string | null | undefined): boolean {
  return !!getConsumableSpec(itemId);
}

/**
 * Every consumable aimed at a given target, in catalog order.
 *
 * The read 我的寵物用品 is built from, so a second food is a catalog row and nothing else — the panel
 * has no list of its own to keep in step.
 */
export function getConsumablesFor(target: ConsumableTarget): ItemDefinition[] {
  return ALL_ITEMS.filter((item) => item.consumable?.target === target);
}

/**
 * Whether a consumable may be given to a given species. Absent `species` on the spec means all.
 *
 * The one place 「這個能不能餵這隻」 is decided. Everything that shows, sorts, filters or validates a
 * feed asks this — including {@link petEffectsFrom}'s caller in context/usePetCare.ts, so a feed
 * that somehow reached the wrong animal is refused at the write rather than only hidden in the UI.
 */
export function consumableAcceptsSpecies(spec: ConsumableSpec, species: PetSpecies): boolean {
  return !spec.species || spec.species.includes(species);
}

/**
 * Every pet food in the catalog, optionally narrowed to what one species may eat.
 *
 * The read behind both feeding surfaces (UI/PetInteractionPanel.tsx and UI/PetCarePanel.tsx), so a
 * new food is a catalog row and appears in both with no edit — and a new SPECIES needs no edit here
 * at all, because the narrowing is the items' own declaration rather than a table of species.
 */
export function getPetFoodsFor(species?: PetSpecies): ItemDefinition[] {
  return getConsumablesFor('pet').filter(
    (item) => !species || consumableAcceptsSpecies(item.consumable!, species),
  );
}

/**
 * Folds a consumable's effects into the amounts `applyPetCareEffects` takes.
 *
 * Here rather than in constants/petCare.ts because it is the CATALOG's half of the conversation:
 * petCare knows what nutrition and energy are and refuses to import an item list, and this knows
 * which effect kinds mean which of them. Anything not aimed at a pet contributes nothing rather than
 * throwing — a player-targeted consumable being handed to the feed path is a bug in the caller, and
 * the pet should not be the thing that breaks.
 *
 * Each amount is clamped to {@link PET_FOOD_EFFECT_RANGE} on the way through, so one mistyped
 * catalog row can only ever be a food that fills the bowl, never one that does something impossible.
 */
export function petEffectsFrom(effects: readonly ConsumableEffect[]): {
  nutrition: number;
  energy: number;
} {
  let nutrition = 0;
  let energy = 0;
  for (const effect of effects) {
    const amount = Math.min(
      PET_FOOD_EFFECT_RANGE.max,
      Math.max(PET_FOOD_EFFECT_RANGE.min, effect.amount),
    );
    if (effect.kind === 'pet-nutrition') nutrition += amount;
    if (effect.kind === 'pet-energy') energy += amount;
  }
  return { nutrition, energy };
}
