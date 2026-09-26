/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RefObject } from 'react';
import type * as THREE from 'three';
import type { CharacterAttachments, CharacterSkeleton } from '../../../constants/characterRig';
import type { OutfitType } from '../Outfits';
import type { PantsCut } from '../../../constants/pants';
import type { ShoeType } from '../Shoes';
import type { HairSpec } from '../../../constants/hair';
import type { SpecialCosmeticDef } from '../../../constants/cosmeticEffects';

/**
 * THE MODEL INTERFACE — what the controller hands a character model, and what it expects back.
 *
 *   Character Logic (Avatar.tsx)
 *         ↓  CharacterRig + CharacterModelProps    ← this file
 *   Character Model
 *         ├── LegacyCharacterModel     the procedural chibi that ships today
 *         ├── CharacterModelV2         the procedural remodel
 *         └── AuthoredCharacterModel   imported GLB/GLTF parts, one slot at a time
 *
 * The rule that makes a model swappable: A MODEL OWNS GEOMETRY AND NOTHING ELSE. It holds
 * no state, runs no useFrame, reads no input and never touches playerBus. Everything that
 * moves is driven through the rig below by the controller's single animation loop, so two
 * models cannot drift out of sync — there is only one loop.
 */

/**
 * The joints, as refs the controller writes to every frame.
 *
 * Every one is a `Group` rather than a `Mesh`, and that is the load-bearing decision in
 * this file: it means a joint is a TRANSFORM the controller owns, not a piece of geometry
 * the model owns. A model can hang a single mesh under a joint (as legacy does), or a
 * loaded GLB node, or five meshes, or nothing at all — the animation cannot tell the
 * difference, because all it ever touches is the group's transform.
 *
 * A model MUST bind every joint. An unbound joint is not a crash — the controller null-checks
 * each one — but the part it drives will not animate, which reads as a limb frozen mid-walk.
 *
 * WHAT THE CONTROLLER WRITES, measured from Avatar.tsx's useFrame rather than assumed:
 *
 *   head          rotation (look/idle/crawl) and position.y (bob), re-asserted from the
 *                 skeleton every frame — see CharacterSkeleton on why the model cannot own it
 *   torso         rotation, position.y, and scale (the landing squash)
 *   limbs         ROTATION ONLY — 94 writes, zero position, zero scale. This is why a model
 *                 is free to put its shoulders and hips wherever its proportions want them.
 *   eyeL/eyeR     scale.y (blink, squint) and position.y (squint lift)
 *   mouth         scale (the smile widening on a happy reaction)
 *   hairSway      rotation, for hair long enough to swing. Bound by the HAIR, not the model.
 */
export interface CharacterRig {
  head: RefObject<THREE.Group | null>;
  torso: RefObject<THREE.Group | null>;
  leftArm: RefObject<THREE.Group | null>;
  rightArm: RefObject<THREE.Group | null>;
  leftLeg: RefObject<THREE.Group | null>;
  rightLeg: RefObject<THREE.Group | null>;
  /** Face expression targets. A model with no face may leave these unbound. */
  eyeL: RefObject<THREE.Group | null>;
  eyeR: RefObject<THREE.Group | null>;
  mouth: RefObject<THREE.Group | null>;
  /** Swing target for long hair. Bound by HairPiece, not by the body model. */
  hairSway: RefObject<THREE.Group | null>;
}

/**
 * WHAT the character is wearing — never WHERE it goes.
 *
 * Resolved once by the controller from the player's equipped items (item names in, types
 * out), so no model repeats that parsing and two models cannot disagree about whether a
 * given item counts as a hat. Where each of these lands is the MODEL's answer, given
 * through its `CharacterAttachments` — which is the split section 十一 of the brief asks
 * for: the wardrobe systems stop knowing about the old meshes and start knowing about
 * named sockets.
 */
export interface CharacterOutfit {
  hair: HairSpec | null;
  hat: HatKind | null;
  outfit: OutfitType | null;
  pants: PantsCut | null;
  shoes: ShoeType | null;
  necklaceId: string | null;
  earring: EarringKind | null;
  hasGlasses: boolean;
  hasMask: boolean;
  hasShellNecklace: boolean;
  hasSkirt: boolean;
  hasSwimsuit: boolean;
  /** The plain sky-blue 襯衫, which predates the OutfitModel system and keeps its own model. */
  hasShirt: boolean;
  /** The grey stand-in worn when no top at all is equipped. */
  hasFallbackShirt: boolean;
  /** Whichever sleeve state the equipped top implies, resolved once for both arms. */
  hasSleeves: boolean;
  /**
   * Special cosmetics — the ornaments that MOVE. See constants/cosmeticEffects.ts.
   *
   * Rows of catalog data, not flags, and that is the difference that matters: every other
   * field here is a hand-added boolean or enum, so a new hat is a new line in three files.
   * A new special cosmetic is a row in the catalog and nothing else, because this field
   * carries the whole definition through rather than a name the model has to interpret.
   *
   * A model that cannot host them simply does not render a `CosmeticSlot`, exactly like any
   * other wearable it has not been fitted for.
   */
  specials: SpecialCosmeticDef[];
  /** Skin, and the torso colour the equipped top implies. */
  skinColor: string;
  bodyColor: string;
}

export type HatKind = 'straw' | 'bucket' | 'beret' | 'beanie' | 'snapback';

export type EarringKind = 'jewel' | 'flower' | 'pearl' | 'gold' | 'coral' | 'star';

/**
 * What every character model receives. Deliberately small: a rig to bind, a skeleton to
 * place itself by, sockets to hang wearables on, and what to wear.
 *
 * Note what is ABSENT — movement state, velocity, the swim state machine, the terrain, the
 * camera, playerBus. A model that needed any of those would be a model that had started
 * doing the controller's job.
 */
export interface CharacterModelProps {
  rig: CharacterRig;
  skeleton: CharacterSkeleton;
  attachments: CharacterAttachments;
  outfit: CharacterOutfit;
}

/**
 * A registered model. `id` is what `?character=` and the persisted setting store.
 *
 * `wearsWardrobe` is the honest flag that keeps the dressing room from lying: a model that
 * has not yet had the wardrobe fitted to it renders bare, and the UI needs to be able to
 * say so rather than leaving the player to wonder why their hat vanished.
 */
export interface CharacterModelDefinition {
  id: CharacterModelId;
  /** Shown in the model picker. */
  label: string;
  skeleton: CharacterSkeleton;
  attachments: CharacterAttachments;
  /** Whether hair/hats/outfits/shoes render on this model. */
  wearsWardrobe: boolean;
  Component: (props: CharacterModelProps) => React.ReactElement;
}

/**
 * `legacy`  the shipped procedural chibi. The default, and the only model the whole
 *           wardrobe is authored against.
 * `v2`      the procedural remodel. Opt-in, renders bare.
 * `authored` the slot-based model for hand-made 3D assets: each body part is either an
 *           imported mesh or, until one is registered, the legacy part. This is the one to
 *           select while importing Head → Torso → Arms → Legs one at a time.
 */
export type CharacterModelId = 'legacy' | 'v2' | 'authored';
