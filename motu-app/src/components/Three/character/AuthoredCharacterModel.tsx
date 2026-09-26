/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Suspense } from 'react';
import type { ReactNode } from 'react';
import type { RefObject } from 'react';
import type * as THREE from 'three';
import { localHeight } from '../../../constants/characterRig';
import { Attachment } from './Attachment';
import {
  LegacyArm,
  LegacyArmWearables,
  LegacyGroundWearables,
  LegacyHead,
  LegacyHeadWearables,
  LegacyLeg,
  LegacyLegWearables,
  LegacyTorso,
  LegacyTorsoWearables,
} from './legacy';
import { CharacterPartBoundary } from './partLoader';
import { AUTHORED_PARTS } from './slots';
import type { AuthoredPart, CharacterPartId } from './slots';
import type { CharacterModelProps } from './types';

/**
 * THE AUTHORED CHARACTER MODEL — hand-made 3D assets, one part at a time.
 *
 * Select it with `?character=authored`. With no parts registered it renders exactly the
 * legacy character, which is the point: the import path is walkable and testable BEFORE the
 * first asset exists, so a finished head can be checked the day it is made rather than the
 * day the whole body is.
 *
 * The composition rule, per part:
 *
 *   registered   →  the authored mesh, inside a joint group this file owns
 *   not yet      →  the legacy procedural part
 *
 * The joint group, its position and its rig ref are ALWAYS owned here, never by the part.
 * That is what makes a half-imported character animate correctly: an authored head and a
 * legacy leg are bound to the same rig by the same code, so the controller cannot tell them
 * apart and the walk cycle does not care which is which.
 *
 * Each authored part gets its OWN Suspense boundary with the legacy part as the fallback,
 * so an asset still streaming in shows the old limb for a frame instead of unmounting the
 * rig — a suspended avatar would drop every ref mid-frame and stall the animation.
 *
 * And its own ERROR boundary, with the same fallback, for the case Suspense does not cover: a
 * part that arrives BROKEN rather than late. A missing file or a bad export throws, and
 * without a boundary per part that throw unwinds to the app root and replaces the whole game
 * with an error screen. With one, a bad asset costs exactly one limb and says so in the
 * console. See CharacterPartBoundary.
 */

/**
 * A joint the controller drives, with whatever geometry belongs inside it.
 *
 * Every authored part goes through here, so there is exactly one place that decides what a
 * joint is, and a part physically cannot set its own joint height.
 */
function Joint({
  bind,
  position,
  part,
  children,
}: {
  bind: RefObject<THREE.Group | null>;
  position: readonly [number, number, number];
  /** The pivot correction, if the asset needed one. See AuthoredPart.transform. */
  part: AuthoredPart;
  children: ReactNode;
}) {
  return (
    <group ref={bind} position={[position[0], position[1], position[2]]}>
      {part.transform ? <Attachment point={part.transform}>{children}</Attachment> : children}
    </group>
  );
}

/**
 * Everything worn on a part, as a thunk, so `part()` below can decide whether to draw it
 * without every caller having to know which wearables belong to which slot.
 *
 * A thunk and not an element for the same reason `legacy` is one: it may go unrendered, and
 * building it eagerly would run the hairstyle's and the wreath's memos for a part that has
 * declared it cannot host them.
 */
type Wearables = () => ReactNode;

export function AuthoredCharacterModel(props: CharacterModelProps) {
  const { rig, skeleton, attachments, outfit } = props;

  /**
   * Renders one part: the authored asset if it exists, the legacy part if it does not.
   *
   * `legacy` is passed as a thunk rather than an element because it is used twice — once as
   * the no-asset fallback and once as the Suspense fallback while an asset loads — and the
   * legacy part binds a rig ref, so handing the same element to both would bind that ref
   * from two places at once.
   */
  const bodyLocalHeight = localHeight(skeleton);

  /**
   * `wearables` is rendered INSIDE the joint AND inside the part's `transform`, next to the
   * imported mesh — not beside the joint. Both halves of that matter:
   *
   *   inside the joint      a hat has to nod with the head; trousers have to swing with the leg.
   *   inside the transform  a sleeve has to hang the way the arm hangs. The arm's rest splay
   *                         lives in `transform`, so anything outside it wears the pose the
   *                         model does not have.
   *
   * It is drawn only when the part says it can host the wardrobe. The default is that it
   * cannot — an unfitted hat floating beside a new skull is worse than an honest bare head —
   * so `wearsWardrobe` is a claim each asset makes for itself once it has been checked.
   */
  const part = (
    id: CharacterPartId,
    joint: readonly [number, number, number],
    bind: RefObject<THREE.Group | null>,
    legacy: () => ReactNode,
    wearables: Wearables,
  ) => {
    const authored = AUTHORED_PARTS[id];
    if (!authored) return legacy();
    const { Component } = authored;
    return (
      <CharacterPartBoundary label={id} fallback={legacy}>
        <Suspense fallback={legacy()}>
          <Joint bind={bind} position={joint} part={authored}>
            <Component outfit={outfit} partId={id} bodyLocalHeight={bodyLocalHeight} rig={rig} />
            {authored.wearsWardrobe ? wearables() : null}
          </Joint>
        </Suspense>
      </CharacterPartBoundary>
    );
  };

  return (
    <>
      {part(
        'head',
        [0, skeleton.head.y, 0],
        rig.head,
        () => <LegacyHead rig={rig} skeleton={skeleton} attachments={attachments} outfit={outfit} />,
        () => <LegacyHeadWearables rig={rig} attachments={attachments} outfit={outfit} />,
      )}
      {part(
        'torso',
        [0, skeleton.torso.y, 0],
        rig.torso,
        () => <LegacyTorso rig={rig} skeleton={skeleton} attachments={attachments} outfit={outfit} />,
        () => <LegacyTorsoWearables attachments={attachments} outfit={outfit} />,
      )}
      {part(
        'leftArm',
        [-skeleton.shoulder.x, skeleton.shoulder.y, 0],
        rig.leftArm,
        () => <LegacyArm side="left" rig={rig} skeleton={skeleton} attachments={attachments} outfit={outfit} />,
        () => <LegacyArmWearables attachments={attachments} outfit={outfit} />,
      )}
      {part(
        'rightArm',
        [skeleton.shoulder.x, skeleton.shoulder.y, 0],
        rig.rightArm,
        () => <LegacyArm side="right" rig={rig} skeleton={skeleton} attachments={attachments} outfit={outfit} />,
        () => <LegacyArmWearables attachments={attachments} outfit={outfit} />,
      )}
      {part(
        'leftLeg',
        [-skeleton.hip.x, skeleton.hip.y, 0],
        rig.leftLeg,
        () => <LegacyLeg side="left" rig={rig} skeleton={skeleton} attachments={attachments} outfit={outfit} />,
        () => <LegacyLegWearables side="left" attachments={attachments} outfit={outfit} />,
      )}
      {part(
        'rightLeg',
        [skeleton.hip.x, skeleton.hip.y, 0],
        rig.rightLeg,
        () => <LegacyLeg side="right" rig={rig} skeleton={skeleton} attachments={attachments} outfit={outfit} />,
        () => <LegacyLegWearables side="right" attachments={attachments} outfit={outfit} />,
      )}

      {/* The ground cosmetics, which hang off the ROOT rather than off any part — so unlike
          every slot above they are not any part's to render, and this model has to mount them
          itself exactly as LegacyCharacterModel does. Left out, an aura would disappear the
          moment the authored model was selected, with nothing to point at as the cause. */}
      <LegacyGroundWearables attachments={attachments} outfit={outfit} />
    </>
  );
}
