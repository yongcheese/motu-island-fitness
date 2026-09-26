/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 寵物休息處 — what KINDS of resting place exist, and which animals may use one.
 *
 * The brief's §3 and §24 are one requirement stated twice: 「哪一種寵物該用哪一種窩」 must be an
 * answer the DATA gives, never `if (pet.type === 'dog')` sitting in a component. So there are
 * exactly three things here and nothing else:
 *
 *   1. {@link PetHabitatKind} — the vocabulary of resting places (a bed, a house, a cage, a perch…).
 *   2. {@link PET_HABITAT_KINDS} — what each kind physically IS: how an animal settles into it, and
 *      which species could plausibly use one at all.
 *   3. {@link PetRestSpec} — the field a catalog row declares to BE one of them, for which species.
 *
 * Nothing in the game asks 「這是不是鳥籠」. It asks {@link habitatAcceptsSpecies}, which is one
 * `includes` over data the item wrote about itself. That is the whole of the compatibility system,
 * and it is why a fourth species costs one row in constants/pets.ts, one row here if it needs a new
 * shape of home, and its catalog rows — and no edits at all to the resolver
 * (lib/petRestingSpots.ts), the movers (Three/IslandPet.tsx) or any screen.
 *
 * ## Why the KIND is separate from the item's species list
 *
 * They answer different questions and only one of them is a design choice. A perch is a bar you
 * grip: no dog can use one, ever, and no future catalog row may claim otherwise — that is
 * `suitableFor` below, a statement about the physical world. Whether a particular woven basket is
 * sold for dogs, for cats, or for both is a product decision, and lives on the item. The test
 * (`npm run test:pet-care`) asserts the second is always a subset of the first, so a 「鳥也能睡的
 * 狗屋」 typo cannot ship.
 *
 * ## Why this is not in constants/petCare.ts
 *
 * That file is the care SIMULATION — two numbers and how time moves them. It deliberately imports
 * no catalog and knows nothing about objects standing on the island. This one is about furniture,
 * reads the catalog, and is read by the placement/shop side of the game as well as by the pet.
 */

import { ALL_ITEMS, type ItemDefinition } from './items';
import type { PetSpecies } from './pets';

/**
 * How an animal settles into a resting place.
 *
 * Two postures, because there are two ways an animal is off its feet and they look nothing alike:
 * a mammal LIES DOWN (the body drops and pitches forward — Three/IslandPet.tsx's SETTLE_DROP), and
 * a bird LANDS ON something and grips it (it stops flying and comes down to a bar at a known
 * height). The renderer branches on this rather than on the species, so a future ground bird or a
 * cat that sleeps on a shelf both work without it learning a new animal.
 */
export type PetRestPosture = 'lie' | 'perch';

/**
 * The shapes a resting place comes in.
 *
 * A closed union rather than a free string: a kind that does not exist has to be a compile error at
 * the catalog row, not a bed that silently accepts nobody. Adding one is a member here plus a row
 * in {@link PET_HABITAT_KINDS} — which is the whole cost of 「未來想賣一種水盆窩」.
 */
export type PetHabitatKind =
  /** An open mat or woven basket on the ground. The animal lies on top of it. */
  | 'ground_bed'
  /** A deep round cushion with a raised rim. The animal lies down INSIDE it. */
  | 'cushion_bed'
  /** A roofed home with a doorway — a kennel, a tent, a knitted cat house. */
  | 'enclosed_house'
  /** A raised platform with somewhere to lie, at the top or in a cubby underneath. */
  | 'platform'
  /** A bird cage with a door. The bird flies home into it and settles on the floor bar. */
  | 'cage'
  /** A bare bar or branch a bird grips. Nothing to go inside. */
  | 'perch'
  /** A woven nest a bird sits down into. */
  | 'nest';

export interface PetHabitatKindDef {
  id: PetHabitatKind;
  /** What to call this SHAPE of home on a card — 窩 / 屋 / 籠 / 架 / 巢. */
  label: string;
  /** How the animal is off its feet here. Read by the movers, never by copy. */
  posture: PetRestPosture;
  /**
   * The species that could physically use this shape at all.
   *
   * A statement about the world, not about the shop: no dog will ever grip a perch, whatever a
   * catalog row claims. An item's own `species` list must be a subset of this — pinned by
   * `npm run test:pet-care`.
   */
  suitableFor: readonly PetSpecies[];
  /** One line for the care panel, so a player knows what they are buying. Never a slogan. */
  note: string;
}

const GROUND_SPECIES: readonly PetSpecies[] = ['dog', 'cat'];
const AIR_SPECIES: readonly PetSpecies[] = ['bird'];

export const PET_HABITAT_KINDS: Record<PetHabitatKind, PetHabitatKindDef> = {
  ground_bed: {
    id: 'ground_bed',
    label: '地面窩',
    posture: 'lie',
    suitableFor: GROUND_SPECIES,
    note: '鋪在地上的開放式窩，走過去就能趴下。',
  },
  cushion_bed: {
    id: 'cushion_bed',
    label: '軟墊窩',
    posture: 'lie',
    suitableFor: GROUND_SPECIES,
    note: '有一圈厚邊的圓窩，牠會整隻縮進去睡。',
  },
  enclosed_house: {
    id: 'enclosed_house',
    label: '小屋',
    posture: 'lie',
    suitableFor: GROUND_SPECIES,
    note: '有屋頂和門口的小屋，躺在門邊看得到外面。',
  },
  platform: {
    id: 'platform',
    label: '休息平台',
    posture: 'lie',
    suitableFor: GROUND_SPECIES,
    note: '架高的木頭平台，底層有一個可以窩進去的洞。',
  },
  cage: {
    id: 'cage',
    label: '鳥籠',
    posture: 'perch',
    suitableFor: AIR_SPECIES,
    note: '門一直開著的木籠，牠會自己飛回來停在裡面。',
  },
  perch: {
    id: 'perch',
    label: '鳥架',
    posture: 'perch',
    suitableFor: AIR_SPECIES,
    note: '一根停得住的橫桿，牠會飛過來抓著休息。',
  },
  nest: {
    id: 'nest',
    label: '鳥巢',
    posture: 'perch',
    suitableFor: AIR_SPECIES,
    note: '編出來的小巢，牠會降下來坐進去。',
  },
};

export const ALL_PET_HABITAT_KINDS: readonly PetHabitatKindDef[] = Object.values(PET_HABITAT_KINDS);

/**
 * 寵物窩 — declared by the ITEM, so the animal never looks for a bed by name or by id.
 *
 * The brief's §9 is explicit about the failure mode this avoids: `if (lowEnergy) find('PetBed_01')`.
 * A resting spot is a CAPABILITY a placeable piece declares, exactly as `standable`, `tabletop`,
 * `placement` and `interactions` already are (constants/items.ts) — so a kennel, a cage, a perch or
 * a cat tower becomes one by being added to the catalog with this field, and lib/petRestingSpots.ts
 * finds it without learning anything.
 *
 * It has no `label`: the item's own name is the label. Two names for one object is how a card and a
 * panel start calling the same basket different things.
 */
export interface PetRestSpec {
  /** Which shape of home this is. Decides the posture, and bounds the species list below. */
  kind: PetHabitatKind;
  /**
   * Which species may settle here. REQUIRED — 「所有寵物都能用」 has to be written out as every
   * species rather than left off, because a forgotten field would silently sell birds a kennel.
   */
  species: readonly PetSpecies[];
  /** How close counts as 「到了」, in world units. Roughly the piece's own reach. */
  radius: number;
  /**
   * Where in the piece's OWN local frame the animal settles, in world units before the piece's
   * rotation is applied. Absent means its centre, which is right for a mat or a basket; a kennel
   * whose opening faces +z offsets forward so the animal lies in the doorway rather than in the wall.
   */
  offset?: { x: number; z: number };
  /**
   * How high above the piece's base the animal comes to rest, in world units. Absent means the
   * ground.
   *
   * Only ever non-zero on a `perch` posture: a walking animal reaches its bed by walking, and this
   * game has no climbing — so a dog bed at height 1 would be a bed the dog stands under. A bird has
   * no such problem, because it is already flying. `npm run test:pet-care` pins that rule.
   */
  height?: number;
}

/** Whether a declared resting place accepts a given animal. The whole compatibility system. */
export function habitatAcceptsSpecies(spec: PetRestSpec, species: PetSpecies): boolean {
  return spec.species.includes(species);
}

/** The posture an animal takes in a given resting place. Read by the movers. */
export function habitatPosture(spec: PetRestSpec): PetRestPosture {
  return PET_HABITAT_KINDS[spec.kind].posture;
}

/**
 * Every resting place in the catalog, optionally narrowed to one species.
 *
 * The read the shop's species filter and the care panel's 「你可以買這些」 are both built from, so
 * neither keeps a list of its own to fall out of step with the catalog.
 */
export function getHabitatItems(species?: PetSpecies): ItemDefinition[] {
  return ALL_ITEMS.filter(
    (item) => !!item.petRest && (!species || habitatAcceptsSpecies(item.petRest, species)),
  );
}

/*
 * 「這件商品是給哪一種寵物的」 across BOTH capabilities — a bed's species and a food's — lives in
 * lib/petCompatibility.ts, not here. This file is about resting places; the shop's shelves are
 * filtered by a question that spans food as well, and answering it here would mean this module
 * reaching into `consumable` to do it.
 */
