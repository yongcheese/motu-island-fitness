/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';

import { PANTS_PALETTES } from '../../../constants/pants';
import { getCharacterForm, type BodyFill } from '../../../constants/characterForm';
import type { CharacterModelId, CharacterOutfit } from './types';

/**
 * Draws the joins a model declares in `constants/characterForm.ts`.
 *
 * A model renders `<BodyForm joint="torso" .../>` inside each joint group it has, and gets
 * whatever that model's spec puts there — nothing at all, for a model with no spec. The component
 * is therefore safe to mount unconditionally: it is the DATA that decides whether anything is
 * drawn, which is what keeps a future imported model from inheriting legacy's anatomy.
 *
 * It holds no state and runs no frame callback, exactly like every other part of a model (see
 * character/types.ts). A fill is geometry, and geometry is all a model owns.
 */
export function BodyForm({
  modelId,
  joint,
  outfit,
  side = 'right',
}: {
  modelId: CharacterModelId;
  joint: BodyFill['joint'];
  outfit: CharacterOutfit;
  /** Which limb this instance is inside. Ignored for `head` / `torso`. */
  side?: 'left' | 'right';
}) {
  const fills = useMemo(
    () => getCharacterForm(modelId).filter((fill) => fill.joint === joint),
    [modelId, joint],
  );

  if (fills.length === 0) return null;

  return (
    <>
      {fills.map((fill) => {
        const x = fill.mirrorX && side === 'left' ? -fill.position[0] : fill.position[0];
        return (
          <mesh
            key={fill.name}
            position={[x, fill.position[1], fill.position[2]]}
            scale={fill.scale ? [fill.scale[0], fill.scale[1], fill.scale[2]] : undefined}
            castShadow
          >
            <sphereGeometry args={[fill.radius, fill.segments ?? 16, (fill.segments ?? 16) / 2]} />
            <meshStandardMaterial color={fillColor(fill, outfit)} roughness={0.7} />
          </mesh>
        );
      })}
    </>
  );
}

/**
 * What colour a fill takes.
 *
 * The `leg` rule is lifted verbatim from the legacy thigh capsule's own lining, and sharing it is
 * the point: the pelvis and the thigh under it have to be the same colour or the hips read as a
 * separate garment. Trousers over bare legs is the common case (the shipped trousers are lathed
 * OVER the capsule rather than replacing it), so the lining colour is what shows through any gap
 * — including the one between the two trouser legs that the pelvis now fills.
 */
function fillColor(fill: BodyFill, outfit: CharacterOutfit): string {
  switch (fill.tint) {
    case 'body':
      return outfit.bodyColor;
    case 'leg':
      return outfit.pants ? PANTS_PALETTES[outfit.pants].body : outfit.skinColor;
    case 'skin':
    default:
      return outfit.skinColor;
  }
}

/** Re-exported so a preview harness can enumerate what a model declares. */
export { getCharacterForm };
export type { BodyFill };
