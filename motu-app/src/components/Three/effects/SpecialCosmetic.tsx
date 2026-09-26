/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import type { AttachmentPoint } from '../../../constants/characterRig';
import type { CosmeticSocket, SpecialCosmeticDef } from '../../../constants/cosmeticEffects';
import { Attachment } from '../character/Attachment';
import { COSMETIC_MODELS } from './CosmeticModels';
import { useCosmeticRuntime } from './EffectField';

/**
 * MOUNTING A SPECIAL COSMETIC — the three lines that join the four systems.
 *
 * A special cosmetic is a socket transform, a mesh, and a registration:
 *
 *   Attachment   puts it where the BODY says (character rig / pet rig)
 *   COSMETIC_MODELS  draws what the CATALOG says (constants/cosmeticEffects.ts)
 *   register()   hands its group to the ONE runtime that animates and emits
 *
 * The order matters. `Attachment` is on the outside and the registered group is inside it,
 * so the runtime's mesh animation writes to a group whose transform starts at identity —
 * a sway of 0.05 rad means 0.05 rad, not "0.05 on top of whatever the socket happened to
 * need". Neither side can clobber the other.
 */
function SpecialCosmetic({
  def,
  point,
  rootScale,
}: {
  def: SpecialCosmeticDef;
  point: AttachmentPoint;
  /** The wearer's canonical root scale — see CosmeticEntry.rootScale. */
  rootScale: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const runtime = useCosmeticRuntime();

  useEffect(() => {
    if (!runtime || !groupRef.current) return;
    return runtime.register(def, groupRef.current, rootScale);
  }, [runtime, def, rootScale]);

  const Model = COSMETIC_MODELS[def.model];
  // An unknown model key is a catalog typo, and rendering nothing is the honest response:
  // the alternative (a placeholder cube on someone's head) is worse than a missing ornament
  // and much harder to notice in review.
  if (!Model) return null;

  return (
    <Attachment point={point} mirror={def.mirror}>
      {/* Named only for ground cosmetics, and only so a harness can find the one group in the
          scene whose world transform is the thing under test — every other cosmetic's orientation
          is just its wearer's, which needs no checking. */}
      <group ref={groupRef} name={def.effect.ground ? 'cosmetic-ground' : undefined}>
        <Model />
      </group>
    </Attachment>
  );
}

/**
 * Every worn cosmetic that belongs at ONE socket.
 *
 * This is what a body part renders — `<CosmeticSlot socket="hairPin" …/>` — and it is the
 * whole of what the character and pet models need to know about this feature. They declare
 * WHICH sockets they can host; they never learn what is hanging on them, so adding a
 * cosmetic never touches a model file.
 */
export function CosmeticSlot({
  socket,
  cosmetics,
  point,
  rootScale,
}: {
  socket: CosmeticSocket;
  /** The wearer's full resolved list — this filters it. */
  cosmetics: readonly SpecialCosmeticDef[];
  point: AttachmentPoint;
  rootScale: number;
}) {
  const worn = cosmetics.filter(def => def.socket === socket);
  if (worn.length === 0) return null;
  return (
    <>
      {worn.map(def => (
        <SpecialCosmetic key={def.itemId} def={def} point={point} rootScale={rootScale} />
      ))}
    </>
  );
}
