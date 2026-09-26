/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import {
  AUTHORED_ATTACHMENTS, AUTHORED_SKELETON,
  LEGACY_ATTACHMENTS, LEGACY_SKELETON,
  V2_ATTACHMENTS, V2_SKELETON,
} from '../../../constants/characterRig';
import { applyCharacterSurface } from './bodySurface';
import { AuthoredCharacterModel } from './AuthoredCharacterModel';
import { CharacterModelV2 } from './CharacterModelV2';
import { LegacyCharacterModel } from './legacy';
import { hasAuthoredParts } from './slots';
import type { CharacterModelDefinition, CharacterModelId, CharacterOutfit, CharacterRig } from './types';

/**
 * THE MODEL REGISTRY — every character model the game can draw, and the single point at
 * which one is chosen.
 *
 * Adding a model is adding an entry here. Nothing in the controller, the camera, the
 * collision system or the wardrobe changes, because none of them can see this file: they
 * see the rig and the skeleton, and both are the same shape for every entry.
 */
export const CHARACTER_MODELS: Record<CharacterModelId, CharacterModelDefinition> = {
  legacy: {
    id: 'legacy',
    label: '原始模型',
    skeleton: LEGACY_SKELETON,
    attachments: LEGACY_ATTACHMENTS,
    wearsWardrobe: true,
    Component: LegacyCharacterModel,
  },
  v2: {
    id: 'v2',
    label: '新模型 v2（無服裝）',
    skeleton: V2_SKELETON,
    attachments: V2_ATTACHMENTS,
    // Bare by design until the wardrobe is refitted to this skull — see CharacterModelV2.
    wearsWardrobe: false,
    Component: CharacterModelV2,
  },
  authored: {
    id: 'authored',
    label: '自製 3D 模型',
    skeleton: AUTHORED_SKELETON,
    attachments: AUTHORED_ATTACHMENTS,
    // Every unregistered part falls back to its legacy counterpart, and those DO wear the
    // wardrobe. A part that cannot host it declares so itself — see AuthoredPart.
    wearsWardrobe: true,
    Component: AuthoredCharacterModel,
  },
};

export function getCharacterModelDefinition(id: CharacterModelId): CharacterModelDefinition {
  return CHARACTER_MODELS[id] ?? CHARACTER_MODELS.legacy;
}

/**
 * Draws the active character model. The ONE thing Avatar.tsx renders for the body.
 *
 * Note what does not happen here: no branch on the model id, no per-model special case, no
 * transform. The definition supplies a skeleton, sockets and a component, and this mounts
 * them. That is the whole model layer at runtime — everything else about swapping models is
 * a matter of which entry got picked, which is why a new model cannot break the old one.
 */
export function CharacterModel({
  modelId,
  rig,
  outfit,
}: {
  modelId: CharacterModelId;
  rig: CharacterRig;
  outfit: CharacterOutfit;
}) {
  const model = getCharacterModelDefinition(modelId);
  const { Component } = model;
  const root = useRef<THREE.Group>(null);

  /**
   * 角色表面 — the shading treatment, applied to whatever the model turned out to be.
   *
   * Deliberately no dependency array. It has to re-run whenever this subtree may have CHANGED,
   * and what changes it is React adding or removing a wearable — which is precisely a render of
   * this component. The traversal is idempotent and each material is patched once (see
   * bodySurface.ts), so the repeat cost is a walk of ~100 objects and one property read each; a
   * dependency list would instead be a list of everything a wearable might key off, kept correct
   * by hand, failing silently as a hat that is lit differently from the head under it.
   *
   * It lives HERE, at the registry, rather than in Avatar: this is the one point every character
   * in the game passes through, so the island, the house and the dressing room are all covered by
   * one call, and a model that has not been written yet is covered too.
   */
  useEffect(() => {
    applyCharacterSurface(root.current);
  });

  return (
    <group ref={root}>
      <Component
        rig={rig}
        skeleton={model.skeleton}
        attachments={model.attachments}
        // A model that has not been fitted with the wardrobe is given a BARE outfit rather
        // than being trusted to ignore the one it was handed. Two reasons it is enforced here
        // instead of in each model: a new model gets the safe behaviour for free, and the
        // colours still come through, so a bare character is still the right skin tone.
        outfit={model.wearsWardrobe ? outfit : bareOutfit(outfit)}
      />
    </group>
  );
}

/** Strips every worn item, keeping only the colours. */
function bareOutfit(outfit: CharacterOutfit): CharacterOutfit {
  return {
    ...outfit,
    hair: null,
    hat: null,
    outfit: null,
    pants: null,
    shoes: null,
    necklaceId: null,
    earring: null,
    hasGlasses: false,
    hasMask: false,
    hasShellNecklace: false,
    hasSkirt: false,
    hasSwimsuit: false,
    hasShirt: false,
    hasFallbackShirt: false,
    hasSleeves: false,
    specials: [],
  };
}

export { hasAuthoredParts };
export type { CharacterModelDefinition, CharacterModelId, CharacterOutfit, CharacterRig };
