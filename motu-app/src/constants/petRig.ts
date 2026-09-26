/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CHARACTER_ROOT_SCALE } from './characterRig';
import type { AttachmentPoint } from './characterRig';
import type { PetSpec } from './pets';

/**
 * THE PET RIG — where a special cosmetic hangs on a companion.
 *
 * The same contract as constants/characterRig.ts, and for the same reason: a pet cosmetic must
 * not be the thing that knows a 柴犬's head is a 0.29 sphere at y 0.71. It asks for `petHead`,
 * gets a frame, and draws at its own origin.
 *
 * ---------------------------------------------------------------------------
 * THE CONVENTION THAT MAKES ONE ORNAMENT FIT NINE ANIMALS
 * ---------------------------------------------------------------------------
 *
 * A socket here is **the CENTRE of the body part, and its `scale` is that part's RADIUS**.
 *
 * That one rule is what lets a single bow model sit correctly on a 臘腸's narrow skull, a
 * 紅貴賓's fluffy pom and a 金絲雀's little head without a per-breed model: the cosmetic is
 * authored in UNIT-PART space, where 1.0 is the surface of whatever it is mounted on. A bow that
 * draws its knot at y = 1.0 rests on top of every head on the shelf; a collar drawn as a torus of
 * radius 1.15 clears every neck by 15%.
 *
 * The alternative — a socket at the top of the head — needs the ornament to know how big the head
 * was, which is exactly the coupling the socket exists to prevent.
 *
 * ---------------------------------------------------------------------------
 * COORDINATE RULES
 * ---------------------------------------------------------------------------
 *
 * Positions are in UNIT-PET space: the space Three/Pets.tsx draws every companion in, where the
 * animal stands on y = 0 with its crown at y ≈ 1 and faces +Z, whatever species it is. The
 * per-breed size is applied afterwards, from `PetSpec.height` (constants/pets.ts).
 *
 * Consequences worth knowing:
 *   - a cosmetic is a child of the pet's own group, so it inherits the walk bob, the idle
 *     breathing and a bird's banking for free. That is section 三's "讓寵物與效果產生一些互動"
 *     obtained by construction rather than by animating an ornament to look like it;
 *   - what must NOT ride along — the spores and petals it emits — is spawned in WORLD space by
 *     the effect runtime, which reads the socket's world matrix. That is why a spore stays where
 *     it was dropped instead of travelling along on the dog's back.
 *
 * Every number below is read off the mesh that draws that part in Three/Pets.tsx. When a breed's
 * model moves, these move with it — there is no way to derive them from the model at runtime,
 * because the "head" of a 紅貴賓 is a pom plus a topknot plus two ear puffs.
 */

/** A pet socket: the centre of a body part, scaled by that part's radius. */
export type PetSocketPoint = AttachmentPoint & { scale: number };

export interface PetAnchors {
  /** Centre of the skull. Hats, bows, anything worn on the head. */
  petHead: PetSocketPoint;
  /** Centre of the neck. Collars — the band encircles the local Z axis. */
  petCollar: PetSocketPoint;
  /**
   * The barrel, at the one place on each animal's back that is actually CLEAR.
   *
   * Not the body's centre, and not the shoulders either. Every companion here is 大頭 by design:
   * a 柴犬's skull is a 0.29 sphere sitting at z 0.26, which shadows its whole shoulder, and the
   * middle of the back is where they all keep their tails. So a pack goes in the gap between the
   * two, and where that gap IS differs per breed — the 臘腸 has a whole long back to choose from,
   * the 紅貴賓 has about 10 cm of it.
   */
  petBack: PetSocketPoint;
}

/**
 * How far the collar band leans back at the top.
 *
 * Every quadruped here carries its neck rising forward (their neck capsules are pitched 0.7–0.8
 * rad), so a band drawn square to the body cuts diagonally through it. Tipping the socket puts the
 * ring perpendicular to the neck it is actually on. Birds get none: a bird's "neck" is a sphere
 * sitting straight on the body, and tilting a collar there just makes it crooked.
 */
const NECK_PITCH = -0.45;

/**
 * 臘腸 — long and low, head held up and well forward of the barrel (z 0.44), which is why its head
 * socket is the furthest forward on the shelf.
 */
const DACHSHUND_ANCHORS: PetAnchors = {
  petHead: { position: [0, 0.75, 0.44], scale: 0.245 },
  petCollar: { position: [0, 0.48, 0.2], rotation: [NECK_PITCH, 0, 0], scale: 0.209 },
  petBack: { position: [0, 0.46, 0], scale: 0.19 },
};

/**
 * 紅貴賓 — no neck mesh at all: the head pom (bottom edge 0.49) and the body (top 0.68) simply
 * overlap. The collar goes at y 0.56, where the BODY sphere's own cross-section is 0.208, so the
 * band is sized to clear that rather than a neck that does not exist.
 */
const POODLE_ANCHORS: PetAnchors = {
  petHead: { position: [0, 0.76, 0.18], scale: 0.27 },
  petCollar: { position: [0, 0.5, 0.12], rotation: [NECK_PITCH, 0, 0], scale: 0.278 },
  petBack: { position: [0, 0.44, -0.14], scale: 0.24 },
};

/** 柴犬 — the broadest head on the shelf (0.29), with prick ears at y 0.93 an ornament sits between. */
const SHIBA_ANCHORS: PetAnchors = {
  petHead: { position: [0, 0.71, 0.26], scale: 0.29 },
  petCollar: { position: [0, 0.5, 0.16], rotation: [NECK_PITCH, 0, 0], scale: 0.243 },
  petBack: { position: [0, 0.47, -0.13], scale: 0.23 },
};

/**
 * All three cats, because they share one body (see CatModel — 橘/虎斑/賓士 are coat patterns, not
 * breeds). Written once and registered under each, so they cannot drift apart.
 */
const CAT_ANCHORS: PetAnchors = {
  petHead: { position: [0, 0.73, 0.24], scale: 0.26 },
  petCollar: { position: [0, 0.53, 0.14], rotation: [NECK_PITCH, 0, 0], scale: 0.226 },
  petBack: { position: [0, 0.5, -0.12], scale: 0.2 },
};

/**
 * Likewise all four birds. A bird's collar sits on the hood sphere at y 0.63, which IS its neck —
 * there is no separate one — and takes no pitch, since it rises straight rather than forward.
 */
const BIRD_ANCHORS: PetAnchors = {
  petHead: { position: [0, 0.76, 0.17], scale: 0.225 },
  petCollar: { position: [0, 0.63, 0.1], scale: 0.21 },
  // The egg body is 0.232 x 0.254 x 0.313; a pack rides the widest part of it.
  petBack: { position: [0, 0.44, -0.08], scale: 0.25 },
};

/**
 * Per-breed anchors, keyed the same way PET_SPECS is — by BREED, because what a socket sits on is
 * the shape of the animal, and on this shelf the cats and the birds each share one body while the
 * three dogs have one apiece.
 */
export const PET_ANCHORS: Record<string, PetAnchors> = {
  dachshund: DACHSHUND_ANCHORS,
  poodle: POODLE_ANCHORS,
  shiba: SHIBA_ANCHORS,
  orange: CAT_ANCHORS,
  tabby: CAT_ANCHORS,
  tuxedo: CAT_ANCHORS,
  budgie: BIRD_ANCHORS,
  javasparrow: BIRD_ANCHORS,
  canary: BIRD_ANCHORS,
  phoenix: BIRD_ANCHORS,
};

/** A breed's anchors, falling back to the cat's — the most average body on the shelf. */
export function getPetAnchors(breed: string | undefined): PetAnchors {
  return (breed && PET_ANCHORS[breed]) || CAT_ANCHORS;
}

/**
 * The companion's canonical root scale — what the effect runtime divides emitter distances by so
 * that "rise 0.3" means 30 cm on a pet exactly as it does on the player.
 *
 * `height` is authored in the AVATAR's local units (see constants/pets.ts), so it needs the
 * character root scale applied to arrive in world units. That is the same conversion
 * Three/IslandPet.tsx makes to size the companion on the island and the dressing room makes to
 * size it on the stage — stated here so the effect system does not restate it a third time.
 */
export function petRootScale(spec: PetSpec): number {
  return spec.height * CHARACTER_ROOT_SCALE;
}
