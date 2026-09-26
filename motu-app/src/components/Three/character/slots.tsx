/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactElement } from 'react';
import { CHARACTER_MODEL_FILES } from '../../../constants/characterAssets';
import { AUTHORED_ARM_REST_Z } from '../../../constants/characterRig';
import type { AttachmentPoint } from '../../../constants/characterRig';
import { PANTS_PALETTES } from '../../../constants/pants';
import { GlbHeadPart, GlbPart, GlbTintedPart } from './partLoader';
import type { CharacterOutfit, CharacterRig } from './types';

/**
 * THE PART SLOTS — where hand-made 3D assets get plugged in.
 *
 * This is the file to edit when a real model part is finished. Nothing else has to change:
 * not Avatar.tsx, not the camera, not collision, not the wardrobe. Register a part here,
 * select the `authored` model, and it appears on the character.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THAT MAKES PARTIAL IMPORT WORK
 * ---------------------------------------------------------------------------
 *
 * Every slot is INDEPENDENTLY optional. A slot with no entry falls back to the legacy
 * procedural part, so the character is always complete and always walkable — an authored head
 * can be tested on legacy legs the day it is finished, months before the legs exist.
 *
 * The same mechanism covers the OTHER shape the finished model might take. If it turns out to
 * be one whole body rather than six parts, register that single mesh in the `head` slot's
 * place with a `transform` that re-bases it on the root, or add a `whole` slot here — the
 * controller cannot tell the difference, because it only ever drives joint GROUPS and never
 * asks how many meshes are underneath them. Nothing in this design requires the six-part
 * split; the six slots are the finest granularity that is supported, not a required shape.
 *
 * ---------------------------------------------------------------------------
 * WHAT A PART MUST DO
 * ---------------------------------------------------------------------------
 *
 * A part renders PART-LOCAL geometry and nothing else. It does NOT create the joint group,
 * set the joint position, or bind the rig ref — `AuthoredCharacterModel` does all three, so a
 * part cannot accidentally move a joint the animation depends on.
 *
 * PART-LOCAL means the origin is the JOINT, +Y up, +Z out of the character's face:
 *
 *   head       origin at the neck pivot. The crown must land at `crownRise` above it.
 *   torso      origin at the torso's centre, not its base.
 *   arm        origin at the SHOULDER, so the mesh hangs at negative y.
 *   leg        origin at the HIP, so the sole lands at `attachments.foot`.
 *
 * Authoring an arm about its own centre instead of its shoulder is the single most common
 * import bug: it looks right standing still and detaches the moment the character walks,
 * because the animation rotates about the joint and the mesh is not centred on it. The loader
 * warns about this specifically — see validateCharacterPart. If an export cannot be
 * re-pivoted in the modelling tool, `transform` below is the escape hatch.
 */

/** The six body parts, each replaceable on its own. */
export type CharacterPartId =
  | 'head'
  | 'torso'
  | 'leftArm'
  | 'rightArm'
  | 'leftLeg'
  | 'rightLeg';

/** What a part receives. Small on purpose — a part draws itself and knows nothing else. */
export interface AuthoredPartProps {
  /** Skin/body colours and what is being worn, in case the part tints or hides for it. */
  outfit: CharacterOutfit;
  /** Which slot this part is filling. Used only to name it in loader messages. */
  partId: CharacterPartId;
  /**
   * The character's total height in LOCAL units, passed down so the loader can sanity-check
   * an imported part's scale against the character it is joining rather than against a
   * number copied into the loader. See constants/characterRig.ts.
   */
  bodyLocalHeight: number;
  /**
   * The joints, for the one thing a part legitimately needs them for: binding a node the
   * controller animates but does not own the geometry of — today, the eyes (see GlbHeadPart).
   *
   * A part still MUST NOT bind its own body joint. `AuthoredCharacterModel` owns every one of
   * those, which is what stops an imported limb from moving a pivot the walk cycle depends on;
   * the face targets are different in kind, because they are transforms INSIDE a part rather
   * than the part's own place on the skeleton.
   */
  rig: CharacterRig;
}

export interface AuthoredPart {
  /** Renders PART-LOCAL geometry. See the note above on what that means. */
  Component: (props: AuthoredPartProps) => ReactElement | null;
  /**
   * Correction applied between the joint and the mesh, for an asset whose export pivot or
   * unit scale cannot be fixed at source. Prefer fixing it in the modelling tool: a correction
   * here is invisible to whoever opens the .glb next and wonders why it does not line up.
   * Omit when the asset is authored correctly.
   */
  transform?: AttachmentPoint;
  /**
   * Whether this part hosts the existing wardrobe. Defaults to false: a new head does not
   * automatically fit the legacy hats, and drawing them on it before they are refitted
   * produces a hat floating beside a skull rather than an honest bare head.
   */
  wearsWardrobe?: boolean;
}

/**
 * The arm's rest splay, as a part transform.
 *
 * The angle itself is measured off the source model and stated once in characterRig.ts; what
 * is decided HERE is that it is a transform on the part rather than geometry inside it. See
 * AUTHORED_ARM_REST_Z for why it cannot be either the joint's rotation (the controller
 * overwrites that every frame) or the mesh's (the sleeve would not follow).
 *
 * The two sides are one number and its negative, so the arms cannot end up splayed by
 * different amounts.
 */
const armRest = (side: 'left' | 'right'): AttachmentPoint => ({
  position: [0, 0, 0],
  rotation: [0, 0, side === 'left' ? AUTHORED_ARM_REST_Z : -AUTHORED_ARM_REST_Z],
});

/**
 * THE REGISTRY — the six parts of the hand-made model, all present.
 *
 * The files are cut from ONE Blender source by `npm run split:character`; do not hand-edit
 * them, and do not hand-edit the numbers they produced in characterRig.ts. See
 * docs/character-authored-model.md for the whole pipeline.
 *
 * `wearsWardrobe` is true on every part, which is the claim that the EXISTING wardrobe still
 * fits this body — and it does, because nothing about the wardrobe was changed: the sockets
 * were re-fitted instead (AUTHORED_ATTACHMENTS), so a hat modelled for the old 0.26 skull
 * arrives at this one's 0.2294 by the socket's own scale. The one place that is fit by luck
 * rather than by a socket is trousers and shoes, which lathe against a hard-coded leg radius —
 * see LegacyLegWearables.
 *
 * Any single part can still be commented out to fall back to its procedural counterpart, which
 * is the fastest way to answer "is this the model or the rig?". A part that fails to LOAD does
 * that on its own and logs why; it cannot take the game down — see CharacterPartBoundary.
 */
/**
 * The colours the procedural torso and leg are drawn in — see GlbTintedPart for why an imported
 * part has to take them too. Same expressions as LegacyTorso / LegacyLeg, so the two models
 * cannot disagree about what colour a swimsuit or a trouser lining is.
 */
const torsoTint = (outfit: CharacterOutfit) => outfit.bodyColor;
const legTint = (outfit: CharacterOutfit) =>
  outfit.pants ? PANTS_PALETTES[outfit.pants].body : outfit.skinColor;

export const AUTHORED_PARTS: Partial<Record<CharacterPartId, AuthoredPart>> = {
  // The head is the one part with its own loader: it binds the eye nodes so the controller can
  // still blink and squint a face it did not draw. See GlbHeadPart.
  head: { Component: (p) => <GlbHeadPart url={CHARACTER_MODEL_FILES.head} {...p} />, wearsWardrobe: true },
  torso: {
    Component: (p) => <GlbTintedPart url={CHARACTER_MODEL_FILES.torso} tint={torsoTint} {...p} />,
    wearsWardrobe: true,
  },
  leftArm: {
    Component: (p) => <GlbPart url={CHARACTER_MODEL_FILES.leftArm} {...p} />,
    transform: armRest('left'),
    wearsWardrobe: true,
  },
  rightArm: {
    Component: (p) => <GlbPart url={CHARACTER_MODEL_FILES.rightArm} {...p} />,
    transform: armRest('right'),
    wearsWardrobe: true,
  },
  leftLeg: {
    Component: (p) => <GlbTintedPart url={CHARACTER_MODEL_FILES.leftLeg} tint={legTint} {...p} />,
    wearsWardrobe: true,
  },
  rightLeg: {
    Component: (p) => <GlbTintedPart url={CHARACTER_MODEL_FILES.rightLeg} tint={legTint} {...p} />,
    wearsWardrobe: true,
  },
};

/** True once at least one real part exists, which is what the model picker keys its label off. */
export const hasAuthoredParts = () => Object.keys(AUTHORED_PARTS).length > 0;

/**
 * All three are IMPORTED above rather than re-exported straight through, which matters more
 * than it looks: `export { GlbPart } from './partLoader'` would forward the name without
 * binding it in this module's scope, so a registration written against it would not compile —
 * and the one promise this file makes is that registering a part is a one-line edit needing no
 * other change. Re-exported as well so anything else that wants the loader can take it from
 * here, next to the registry it belongs to.
 */
export { CHARACTER_MODEL_FILES, GlbHeadPart, GlbPart, GlbTintedPart };
