/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from 'react';
import type { AttachmentPoint } from '../../../constants/characterRig';

/**
 * Mounts a wearable at a socket.
 *
 * The entire reason this exists rather than each wearable carrying its own offsets: a
 * wearable that positions itself is a wearable that knows the shape of the body under it,
 * and that is the coupling section 十一 of the brief is about. Here the wearable draws at
 * its own origin, and WHERE that origin lands is the model's answer.
 *
 * `mirror` flips the socket across the character's centreline, which is how a single
 * authored ear/hand/foot socket serves both sides — a model cannot accidentally put its two
 * earrings at different heights, because there is only one number.
 */
export function Attachment({
  point,
  mirror = false,
  children,
}: {
  point: AttachmentPoint;
  mirror?: boolean;
  children: ReactNode;
}) {
  const [x, y, z] = point.position;
  const scale = point.scale ?? 1;
  return (
    <group
      position={[mirror ? -x : x, y, z]}
      rotation={point.rotation ? [...point.rotation] : [0, 0, 0]}
      scale={[scale, scale, scale]}
    >
      {children}
    </group>
  );
}
