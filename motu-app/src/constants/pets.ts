/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 寵物 — one spec per breed, read by BOTH the shop icon (QVersionIcon's DogIcon) and the 3D
 * companion (Three/Pets.tsx).
 *
 * Shared on purpose: the two are meant to be the same animal, and a player who buys the brown
 * dachshund on the card and gets a grey one standing next to their character has been lied to.
 * Keeping one palette means a breed can only ever be recoloured in both places at once.
 *
 * Adding a breed is this table plus a `pet-<species>-<breed>` entry in constants/items.ts — the
 * icon and the model both key off the id suffix, so neither needs a new branch.
 */

export interface PetSpec {
  /** Main coat colour. */
  coat: string;
  /** Shaded coat, for the far pair of legs and undersides. */
  shade: string;
  /** The breed's light marking — cream mask/socks, pale muzzle, ankle poms. */
  accent: string;
  /** Near-black: nose, and the hanging ears on a dark-eared breed. */
  dark: string;
  /**
   * 鳥 only — the bill, AND the legs with it.
   *
   * One value for both because on every bird here they are the same material and read as the same
   * colour: the 虎皮鸚鵡's olive-grey bill over blue-grey feet, the 文鳥's red bill over pink feet,
   * the 金絲雀's pale horn over pinkish horn, the 鳳凰's gold over gold. A mammal has neither, so
   * this is absent on all six of them.
   */
  beak?: string;
  /**
   * 鳥 only — the one marking the four coat slots above cannot hold.
   *
   * Each bird spends it on whatever its own second signature is: the 虎皮鸚鵡's violet cheek patch
   * and cobalt tail, the 文鳥's pink belly, the 金絲雀's warm orange face and breast, the 鳳凰's hot
   * orange crest and breast. There is no shared meaning beyond "the colour this bird also needs",
   * which is why it is one slot and not a named field per marking.
   */
  mark?: string;
  /**
   * How tall the dog stands, crown to ground, in the avatar's LOCAL units — the same space
   * Avatar.tsx's BASE_HEAD_Y and LEG_LENGTHEN are written in, so these read directly against the
   * character: soles sit at -0.005, the knee is around 0.118, mid-shin around 0.055 and the crown
   * is 0.945.
   *
   * Every mammal stands the same height on purpose. Sizing them by real-world breed size made
   * the 臘腸 — a low dog by definition — the runt of the shelf and hard to even see beside the
   * character; every companion now reads at the same weight, and what distinguishes a breed is
   * its proportions (the 臘腸 spends its size on length, the 紅貴賓 on coat volume) rather than
   * one being a lesser buy than another.
   *
   * The value puts a dog's crown about at the character's knee. Read by eye, not by anatomy: the
   * avatar is 大頭小身, so measured strictly its knee sits at 0.12 — an eighth of its height where
   * a real person's is over a quarter — and dogs built to that number were too small to see.
   *
   * One number per breed, so how big the companions stand is one edit here and nothing else.
   */
  height: number;
}

/**
 * Shared by every 狗 and 貓 — see `height` above.
 *
 * Raised from 0.30 once the companion left the dressing room and started walking the island
 * (Three/IslandPet.tsx). On the stage the pet is a metre from the camera and 0.30 was plenty; out
 * on the island the camera orbits 10–35 units out with the whole terrain in frame, and at that
 * distance a knee-high dog trailing a character is a small brown smudge. This puts its crown just
 * over the character's knee and costs the outfit nothing on either screen.
 */
const PET_HEIGHT = 0.36;

/**
 * 鳥, which are the one thing on the shelf that does NOT stand at PET_HEIGHT.
 *
 * The reasoning above is about companions standing on the floor, where the eye measures them
 * against the character's knee and anything smaller than a knee-high dog is lost. A bird is never
 * down there: it hovers beside the owner's head (see Three/Pets.tsx), so it is read against the
 * face — and at that distance from the camera, a third of the head's height is plainly visible
 * while still obviously a small bird rather than a goose on the wing.
 */
const BIRD_HEIGHT = 0.24;

/**
 * 鳳凰 — the one companion that is not an animal anybody owns, and the only height on the shelf
 * that is set by status rather than by anatomy.
 *
 * The other three are pet-shop birds and are sized against each other; a phoenix measured the same
 * way would be a budgie in red, which is the whole failure mode of putting a mythical bird on a
 * shelf of real ones. Half again as tall as they are is enough that it is plainly the largest thing
 * hovering beside the character without becoming the thing the screen is about — the avatar's
 * outfit still is. Anything past this and its tail plumes start crossing the character's face.
 */
const PHOENIX_HEIGHT = 0.36;

export const PET_SPECS: Record<string, PetSpec> = {
  // 棕色短毛臘腸犬 — spends its height budget on length: long body, legs barely off the ground.
  dachshund: { coat: '#A9682F', shade: '#875123', accent: '#C98B4E', dark: '#6E4019', height: PET_HEIGHT },
  // 杏紅色玩具貴賓 — compact under a coat of pom-poms.
  poodle: { coat: '#E5A277', shade: '#C9814F', accent: '#F3C7A6', dark: '#1F1A17', height: PET_HEIGHT },
  // 赤色柴犬 — the sturdiest build of the three.
  shiba: { coat: '#D97A3D', shade: '#B45E27', accent: '#F7EADB', dark: '#3D2A1C', height: PET_HEIGHT },

  // --- 貓 ---
  // On all three, `accent` is the white or cream the breed's markings are actually made of, and
  // `shade` is what its stripes are drawn in — a cat's pattern is the thing it is recognised by,
  // so the palette is shaped around carrying it rather than around shading a solid coat.
  // 橘貓 — ginger tabby, striped in a deeper ginger.
  orange: { coat: '#E8934A', shade: '#C46A26', accent: '#FFF2E0', dark: '#8A4A18', height: PET_HEIGHT },
  // 虎斑貓 — brown mackerel tabby. Its bars go much darker than the ginger's: narrow stripes at
  // chip size disappear entirely unless they are near-black against the coat.
  tabby: { coat: '#A08765', shade: '#4E3D29', accent: '#F2E7D5', dark: '#3A2E22', height: PET_HEIGHT },
  // 賓士貓 — tuxedo. Not quite black: against this art's dark brown outline a true black loses its
  // own silhouette, and the white markings are what the pattern is read by anyway.
  tuxedo: { coat: '#3C3833', shade: '#2A2724', accent: '#FFFFFF', dark: '#1A1715', height: PET_HEIGHT },

  // --- 鳥 ---
  // All three are drawn from the wild/classic plumage rather than one of the mutation colours the
  // pet trade also sells, because that is the bird a player pictures when they read the name: a
  // 虎皮鸚鵡 is the green one with the stripes (the stripes are what the Chinese name says), a 文鳥
  // is grey with a black hood and a red bill, a 金絲雀 is 金絲 yellow. Sold in a lutino, a white and
  // a red-factor instead, none of the three would be recognisable as what was bought.
  //
  // 虎皮鸚鵡 — wild-type green budgerigar: yellow face and forehead, pitch-black barring edged in
  // yellow over the nape, back and wings, light green body, cobalt tail, blue-violet cheek patches
  // and a row of black throat spots under the mask.
  budgie: { coat: '#86C34A', shade: '#5E9430', accent: '#F2DE55', dark: '#2A241E', beak: '#9A9483', mark: '#5A6BD0', height: BIRD_HEIGHT },
  // 文鳥 — grey upperparts and breast, white-cheeked black head, pink belly, thick red bill with a
  // red eye-ring to match it, pink feet. `dark` is the hood, and it carries the tail too.
  javasparrow: { coat: '#8E9299', shade: '#6C7077', accent: '#FFFFFF', dark: '#26232B', beak: '#E4536B', mark: '#E9AFA4', height: BIRD_HEIGHT },
  // 金絲雀 — the domestic yellow canary, the one whose colour is named after it. `mark` is the
  // warmer orange it carries over the face and breast: a canary painted one flat yellow from bill
  // to tail reads as a rubber duck, and that warmth is the whole difference.
  // `beak` is pushed deeper than a canary's true pale horn: the real colour is a shade off the
  // bird's own yellow, and a bill that vanishes into the face takes the open beak — the whole
  // reason this one is posed singing — with it.
  canary: { coat: '#F4C92B', shade: '#D9A517', accent: '#FDF0B4', dark: '#3B2E18', beak: '#D6A46B', mark: '#F0952E', height: BIRD_HEIGHT },
  // 鳳凰 — the shelf's one mythical bird, and so the one whose palette is not taken from reference.
  //
  // Painted as FIRE, in one hot ramp from crimson through vermilion to gold, rather than as the
  // 五色 (red/blue/yellow/white/black) the classical description gives it. Both are the real bird;
  // this is the one that survives being 64 pixels wide. A five-colour phoenix at chip size is five
  // patches of unrelated hue with no dominant one, and — worse — a red bird with big blue panels is
  // a 金剛鸚鵡, which is another parrot on a shelf that already has one. Everything here is within
  // 40° of hue of everything else, so the whole silhouette reads as one burning thing.
  //
  // `mark` is the hot orange at the crest and the tips of the tail plumes: the ramp needs a rung
  // between the vermilion body and the gold, or the gold reads as a separate yellow bird stuck on
  // the front of a red one.
  //
  // Checked against its own card, not just against cream: this is the game's only 神話 item, so it
  // is the only pet that is ever seen on the magenta plate (constants/rarity.ts, `fieldCore`
  // #EDA8CD). Warm red and gold hold against that pink; a phoenix built on the tier's own magenta —
  // which was the obvious first idea, matching the bird to its frame — vanished into it entirely.
  phoenix: { coat: '#E24B2E', shade: '#B02A19', accent: '#FFD469', dark: '#3B140E', beak: '#F2A31C', mark: '#FF8F2A', height: PHOENIX_HEIGHT },
};

/**
 * Pet ids are `pet-<species>-<breed>`, and the BREED is the key above — one flat table, because
 * what a pet is coloured and proportioned by is its breed, not its species. The species part only
 * decides which component draws it (QVersionIcon's DogIcon/CatIcon/BirdIcon, and the 3D models)
 * and, for 鳥, that it flies rather than stands.
 */
export const PET_SPECIES = ['dog', 'cat', 'bird'] as const;
export type PetSpecies = (typeof PET_SPECIES)[number];

const PET_ID_PATTERN = /^pet-(dog|cat|bird)-/;

/**
 * The species half of an item id, for the few places that genuinely draw or behave differently per
 * species rather than per breed — which component paints the icon, and whether the 3D companion
 * walks on the floor or flies.
 */
export function getPetSpecies(itemId: string | undefined | null): PetSpecies | undefined {
  const match = itemId?.match(PET_ID_PATTERN);
  return match ? (match[1] as PetSpecies) : undefined;
}

/** The breed key for an item id, for the icon and model switches. */
export function getPetBreed(itemId: string | undefined | null): string | undefined {
  if (!itemId || !PET_ID_PATTERN.test(itemId)) return undefined;
  const breed = itemId.replace(PET_ID_PATTERN, '');
  return breed in PET_SPECS ? breed : undefined;
}

export function getPetSpec(itemId: string | undefined | null): PetSpec | undefined {
  const breed = getPetBreed(itemId);
  return breed ? PET_SPECS[breed] : undefined;
}

/* --- 物種資料表 ---------------------------------------------------------------------------- */

/**
 * How a species gets around, and therefore which mover drives it (Three/IslandPet.tsx).
 *
 * A field rather than `species === 'bird'` scattered through the movers, the habitats and the UI:
 * the day a fourth companion arrives that swims or burrows, it declares its locomotion here and the
 * places that branch on it are already asking the right question.
 */
export type PetLocomotion = 'ground' | 'air';

/**
 * 寵物物種 — everything the game needs to know about a KIND of animal, as opposed to a breed.
 *
 * The split is the one {@link PET_SPECS} already states: a breed decides what an animal is coloured
 * and proportioned like, a species decides how it lives. Colour is the flat breed table above;
 * this is the (much shorter) table of the things that are true of every dog, or every bird.
 *
 * It exists because those facts were previously spelled `=== 'bird'` in five unrelated files — the
 * mover picked its branch that way, the interaction badge named the animal from a private
 * `Record<PetSpecies, string>`, and nothing at all knew which resting places or which foods suited
 * which animal. Adding a species is now this table plus its catalog rows; see
 * `docs/pet-care.md` 「新增一種寵物」.
 */
export interface PetSpeciesDef {
  id: PetSpecies;
  /** 狗 / 貓 / 鳥 — the shelf's word for the animal. */
  label: string;
  /**
   * What the game calls one of these when speaking to the player — 小狗 / 小貓 / 小鳥.
   *
   * Separate from `label` because 「摸摸狗」 is not a sentence anybody writes. The badge, the pet
   * panel and the feeding toasts all read this, so an animal is never called two different things
   * on two different screens.
   */
  companionNoun: string;
  /** Which mover drives it, and — through the habitat table — how it settles. */
  locomotion: PetLocomotion;
  /**
   * The shelf its animals are sold on (utils/categoryUtils.ts), so 「去買一隻」 and the species
   * filter on the pet shelves can deep-link without a second lookup table.
   */
  shopCategory: string;
}

export const PET_SPECIES_TABLE: Record<PetSpecies, PetSpeciesDef> = {
  dog: { id: 'dog', label: '狗', companionNoun: '小狗', locomotion: 'ground', shopCategory: 'Dogs' },
  cat: { id: 'cat', label: '貓', companionNoun: '小貓', locomotion: 'ground', shopCategory: 'Cats' },
  bird: { id: 'bird', label: '鳥', companionNoun: '小鳥', locomotion: 'air', shopCategory: 'Birds' },
};

export const ALL_PET_SPECIES: readonly PetSpeciesDef[] = PET_SPECIES.map((id) => PET_SPECIES_TABLE[id]);

/** The species record for an item id, or undefined for anything that is not an animal. */
export function getPetSpeciesDef(itemId: string | undefined | null): PetSpeciesDef | undefined {
  const species = getPetSpecies(itemId);
  return species ? PET_SPECIES_TABLE[species] : undefined;
}

/** 小狗 / 小貓 / 小鳥 — what to call this companion in a sentence. Total: falls back to 寵物. */
export function petCompanionNoun(itemId: string | undefined | null): string {
  return getPetSpeciesDef(itemId)?.companionNoun ?? '寵物';
}
