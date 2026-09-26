/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RefObject } from 'react';
import type * as THREE from 'three';
import { COSMETIC_PALETTE } from '../../../constants/cosmeticEffects';

/**
 * THE TWO LIVING THINGS — a bee and a butterfly, as actual low-poly meshes.
 *
 * The brief is explicit about these ("可以使用小型低模 Bee Mesh + 簡單 Animation，而不是
 * Particle"), and the reason holds up: a bee is a thing with a body and wings that beat, and
 * no sprite at this size reads as one. Twelve triangles of body plus two wing quads does.
 *
 * Neither component holds state or runs a frame loop. Each takes REFS for its wings, which
 * the shared runtime writes the wingbeat into (see CosmeticRuntime.stepCreatures) — the same
 * arrangement the character model uses for its rig joints, and for the same reason: one loop
 * drives everything, so a bee and a butterfly cannot beat out of sync with the frame clock.
 *
 * Both are authored around the ORIGIN, facing +Z, at roughly 1 world unit for the whole
 * insect; the runtime scales them down to their real size (a bee ends up ~8 cm long against
 * a 2.16-unit character). Authoring at unit size keeps the numbers here readable.
 */

interface CreatureProps {
  /** Wing groups, in [left, right] order. The runtime rotates these about Z. */
  wingRefs: [RefObject<THREE.Group | null>, RefObject<THREE.Group | null>];
}

/**
 * A bumblebee: a fat striped abdomen, a small head, and two blurred wings.
 *
 * Wings sit above and slightly forward of the body's centre and are rotated so their pivot
 * is the wing ROOT — a wing that flaps about its own centre looks like a rotating plank.
 */
export function BeeMesh({ wingRefs }: CreatureProps) {
  const body = COSMETIC_PALETTE.honey.body;
  const stripe = '#4a3b2a';

  return (
    <group>
      {/* Abdomen — three segments rather than a smooth taper, so the stripes read as bands
          on a low-poly body instead of as a texture. */}
      <mesh position={[0, 0, -0.12]}>
        <sphereGeometry args={[0.15, 8, 6]} />
        <meshStandardMaterial color={stripe} roughness={0.8} transparent />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.17, 8, 6]} />
        <meshStandardMaterial color={body} roughness={0.8} transparent />
      </mesh>
      <mesh position={[0, 0, 0.13]}>
        <sphereGeometry args={[0.14, 8, 6]} />
        <meshStandardMaterial color={stripe} roughness={0.8} transparent />
      </mesh>
      {/* Head */}
      <mesh position={[0, 0.02, 0.25]}>
        <sphereGeometry args={[0.1, 8, 6]} />
        <meshStandardMaterial color="#3a2f22" roughness={0.7} transparent />
      </mesh>

      {/* Wings. Flattened spheres rather than planes so they catch light from both sides and
          do not disappear edge-on at the top of the beat. */}
      <group ref={wingRefs[0]} position={[-0.06, 0.14, 0.02]}>
        <mesh position={[-0.16, 0, 0]} scale={[1, 0.28, 0.55]}>
          <sphereGeometry args={[0.18, 6, 4]} />
          <meshStandardMaterial color="#eaf4fa" roughness={0.3} transparent opacity={0.75} />
        </mesh>
      </group>
      <group ref={wingRefs[1]} position={[0.06, 0.14, 0.02]}>
        <mesh position={[0.16, 0, 0]} scale={[1, 0.28, 0.55]}>
          <sphereGeometry args={[0.18, 6, 4]} />
          <meshStandardMaterial color="#eaf4fa" roughness={0.3} transparent opacity={0.75} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * A butterfly: a thin body and four wing panels, two per side.
 *
 * The forewing and hindwing are children of ONE group per side, so a single rotation drives
 * both and the pair cannot come apart mid-beat. The wings are tilted forward a little at
 * rest, which is what stops the closed position reading as a flat sheet of paper.
 */
export function ButterflyMesh({ wingRefs }: CreatureProps) {
  const wing = COSMETIC_PALETTE.butterfly.body;
  const wingEdge = COSMETIC_PALETTE.butterfly.glow;

  return (
    <group>
      {/* Body */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <capsuleGeometry args={[0.035, 0.22, 3, 6]} />
        <meshStandardMaterial color="#4a3f52" roughness={0.8} transparent />
      </mesh>
      {/* Antennae, as one thin cross-piece — two separate hairs at this size are invisible
          and cost two more draws. */}
      <mesh position={[0, 0.08, 0.16]} rotation={[0.5, 0, 0]}>
        <boxGeometry args={[0.13, 0.008, 0.008]} />
        <meshStandardMaterial color="#4a3f52" roughness={0.8} transparent />
      </mesh>

      {([-1, 1] as const).map((side, i) => (
        <group key={side} ref={wingRefs[i]} position={[0, 0.02, 0]} rotation={[0, 0, side * 0.25]}>
          {/* Forewing: the big one, angled forward. */}
          <mesh position={[side * 0.22, 0, 0.07]} rotation={[0, 0, side * 0.2]} scale={[1, 0.12, 0.8]}>
            <sphereGeometry args={[0.24, 6, 4]} />
            <meshStandardMaterial color={wing} roughness={0.6} transparent flatShading />
          </mesh>
          {/* Hindwing: smaller, paler, tucked behind. */}
          <mesh position={[side * 0.16, 0, -0.11]} rotation={[0, 0, side * -0.15]} scale={[1, 0.12, 0.8]}>
            <sphereGeometry args={[0.16, 6, 4]} />
            <meshStandardMaterial color={wingEdge} roughness={0.6} transparent flatShading />
          </mesh>
        </group>
      ))}
    </group>
  );
}
