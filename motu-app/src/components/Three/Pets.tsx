/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, memo, useContext, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PetSpec, getPetBreed, getPetSpec, getPetSpecies } from '../../constants/pets';
import { getPetAnchors, petRootScale } from '../../constants/petRig';
import { resolveSpecialCosmetics } from '../../constants/cosmeticEffects';
import type { SpecialCosmeticDef } from '../../constants/cosmeticEffects';
import { CosmeticSlot } from './effects';

/**
 * 寵物 — the companion that stands beside the character once its rack entry is switched on.
 *
 * Built from primitives in the same Q-version language as the rest of the avatar's wardrobe, and
 * coloured from constants/pets.ts — the same table the shop icon draws from, so the dog on the
 * card and the dog on the stage are the same animal.
 *
 * LOCAL SPACE — every number in this file is authored in ONE convention, and the whole model is
 * normalised so that:
 *
 *   y = 0   the ground the paws stand on. Everything is built UPWARD from here.
 *   y = 1   the top of the head. The model is drawn to a unit height and the caller scales it by
 *           the breed's `height`, so re-tuning how big a dog is against the character is one
 *           number in constants/pets.ts rather than a rebuild of the geometry here.
 *   z = 0   the middle of the body. +z is forward (nose), -z is back (tail).
 *   x = 0   the centre line. Both sides are drawn from the same numbers mirrored, so there is no
 *           left/right variant to keep in sync.
 *
 * The three breeds are separate builds rather than one parameterised body because the silhouette
 * IS the breed — 臘腸's body is longer than it is tall on legs that barely clear the ground,
 * 紅貴賓 is a stack of fleece pom-poms, 柴犬 is a compact barrel with prick ears. A single shape
 * with enough knobs to cover all three would be harder to read than the three shapes.
 */

/** Low segment counts on purpose: 圓潤低多邊形, not a smooth render-quality sphere. */
const SPHERE = [16, 12] as const;
const CAP = [8, 12] as const;

/**
 * How hard a companion is walking, and where it is in its step, published by whoever is MOVING the
 * pet — on the island that is Three/IslandPet.tsx.
 *
 * A ref rather than props because it changes every frame: the legs and the tail read it inside
 * their own useFrame, so a pet breaking into a trot costs no React render.
 *
 * `phase` is advanced by DISTANCE TRAVELLED, not by the clock. That is the difference between legs
 * that walk and legs that mime walking over a sliding body: at a fixed step rate a pet sprinting to
 * catch up takes the same number of strides as one ambling, and the feet visibly skate across the
 * ground. Advanced per unit of ground covered, one stride always carries the pet one stride's
 * worth of island.
 */
export interface PetGait {
  /** 0 standing, 1 at full trot. Scales the leg swing and the tail. */
  intensity: number;
  /** The step cycle, in radians. */
  phase: number;
}

const STILL: PetGait = { intensity: 0, phase: 0 };
const GaitContext = createContext<React.RefObject<PetGait> | null>(null);

/** Falls back to a standing pet, which is what the 更衣室 stage wants — nothing walks in there. */
function useGait(): React.RefObject<PetGait> {
  const provided = useContext(GaitContext);
  const fallback = useRef(STILL);
  return provided ?? fallback;
}

/** How far a leg swings fore/aft at full trot, in radians (~29°). */
const LEG_SWING = 0.5;
/** Per-leg offsets into the cycle, in the order Legs draws them: LB, RB, LF, RF. */
const LEG_PHASE = [Math.PI, 0, 0, Math.PI] as const;

/**
 * The tail, hinged at its root so it can be swung without moving the body it grows out of.
 *
 * `root` is the hinge in the model's own coordinates and the children keep the ABSOLUTE positions
 * they were authored at — the inner group subtracts the root straight back off. That is deliberate:
 * a cat's tail is four meshes and two rings threaded onto a curve, and re-basing all six by hand to
 * hang them off a pivot would be six chances to bend the curve while adding a hinge to it.
 *
 * 狗 and 貓 are given deliberately different motion, because on a low-poly quadruped seen from
 * across the island the tail is the ONE part that says which animal this is: the body silhouettes
 * are both "four legs and a round head" at that size, but a fast side-to-side wag is a dog and
 * nothing else, and a slow upright curl is a cat and nothing else. A walking dog's wag is roughly
 * three times the arc of its standing one — the whole point of a wag is that it answers to mood,
 * and a companion trotting along at your heel is a happy dog.
 */
function Tail({
  root, kind, children,
}: {
  root: [number, number, number]; kind: 'dog' | 'cat'; children: React.ReactNode;
}) {
  const hinge = useRef<THREE.Group>(null);
  const gait = useGait();

  useFrame(({ clock }) => {
    const g = hinge.current;
    if (!g) return;
    const t = clock.getElapsedTime();
    const power = Math.min(1, gait.current.intensity);

    if (kind === 'dog') {
      // Side to side, and faster the harder it is walking. Yaw only: a dog's wag is a horizontal
      // sweep, and rolling the tail as well turns it into a propeller.
      const speed = 7 + power * 7;
      g.rotation.y = Math.sin(t * speed) * (0.3 + power * 0.85);
      // A little vertical lift riding on top, so the wag has some body to it rather than reading
      // as a flat windscreen wiper.
      g.rotation.x = Math.sin(t * speed * 2) * 0.06 * (0.4 + power);
    } else {
      // 貓: a slow, high curl that leans with the walk. Deliberately about a sixth of the dog's
      // frequency — the two must not be mistakable for one another at a glance.
      g.rotation.y = Math.sin(t * 1.2) * (0.14 + power * 0.16);
      g.rotation.x = Math.sin(t * 0.9 + 0.7) * 0.1 - power * 0.12;
    }
  });

  return (
    <group ref={hinge} position={root}>
      <group position={[-root[0], -root[1], -root[2]]}>{children}</group>
    </group>
  );
}

/** Every part shares one matte finish — no gloss anywhere on a plush low-poly pet. */
function Fur({ color }: { color: string }) {
  return <meshStandardMaterial color={color} roughness={0.92} metalness={0} />;
}

/** The eyes and nose all three breeds share, sized and placed by the caller's muzzle. */
function Face({
  spec, eyeX, eyeY, eyeZ, noseY, noseZ, noseR,
}: {
  spec: PetSpec; eyeX: number; eyeY: number; eyeZ: number; noseY: number; noseZ: number; noseR: number;
}) {
  return (
    <>
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * eyeX, eyeY, eyeZ]} castShadow>
          <sphereGeometry args={[0.045, ...SPHERE]} />
          <Fur color={spec.dark} />
        </mesh>
      ))}
      <mesh position={[0, noseY, noseZ]} castShadow>
        <sphereGeometry args={[noseR, ...SPHERE]} />
        <Fur color={spec.dark} />
      </mesh>
    </>
  );
}

/**
 * Four legs standing on y=0, the far pair shaded so the near pair reads in front of them.
 *
 * `top` is where the leg ENDS UP, not how long it is — and it has to be set above the belly at
 * the leg's own x/z, not at the body's centre line. That is the whole reason this takes a top
 * rather than a length: a leg sized to clear the lowest point of the body still hung in mid-air,
 * because a capsule's underside curves up towards its sides and the legs are out at the sides.
 * The overshoot is buried inside the body, so overshooting costs nothing and stopping short
 * costs the dog its legs.
 */
function Legs({
  spec, radius, top, x, frontZ, backZ,
}: {
  spec: PetSpec; radius: number; top: number; x: number; frontZ: number; backZ: number;
}) {
  const length = Math.max(0, top - radius * 2);
  const y = radius + length / 2;
  const gait = useGait();
  const hips = useRef<(THREE.Group | null)[]>([]);

  // Each leg swings about its own HIP rather than about the model's origin, which is the whole
  // reason it is wrapped in a group: rotating the capsule itself pivots it about its middle, so
  // the foot and the shoulder swing opposite ways and the dog paddles instead of stepping.
  //
  // Diagonal pairs move together — left-front with right-back, right-front with left-back — which
  // is the trot every four-legged animal on this shelf actually walks at. Same-side pairs (a pace)
  // reads as a camel, and all four together reads as a rocking horse.
  useFrame(() => {
    const g = gait.current;
    const swing = Math.min(1, g.intensity) * LEG_SWING;
    for (let i = 0; i < hips.current.length; i++) {
      const hip = hips.current[i];
      if (hip) hip.rotation.x = Math.sin(g.phase + LEG_PHASE[i]) * swing;
    }
  });

  return (
    <>
      {([[-1, backZ], [1, backZ], [-1, frontZ], [1, frontZ]] as const).map(([s, z], i) => (
        <group key={i} position={[s * x, top, z]} ref={el => { hips.current[i] = el; }}>
          <mesh position={[0, y - top, 0]} castShadow>
            <capsuleGeometry args={[radius, length, ...CAP]} />
            <Fur color={s < 0 ? spec.shade : spec.coat} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function DachshundModel({ spec }: { spec: PetSpec }) {
  return (
    <>
      {/* Short legs, reaching well up into the barrel. Short is relative: the breed's legs are
          still about a third of its height — what makes it read as 臘腸 is that the BODY is
          nearly three times as long as those legs, not that the legs are stumps. */}
      <Legs spec={spec} radius={0.055} top={0.36} x={0.14} frontZ={0.32} backZ={-0.32} />

      {/* Long low body. Slimmer and longer than the other two breeds: this is the one shape that
          has to say "臘腸" before any of the detail does. */}
      <mesh position={[0, 0.46, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <capsuleGeometry args={[0.19, 0.6, ...CAP]} />
        <Fur color={spec.coat} />
      </mesh>
      {/* Paler underside, sat low enough to actually show below the barrel — at the body's own
          centre height it is swallowed whole and paints nothing */}
      <mesh position={[0, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[0.85, 1, 0.4]} castShadow>
        <capsuleGeometry args={[0.17, 0.5, ...CAP]} />
        <Fur color={spec.accent} />
      </mesh>

      {/* Tail, thin and carried up off the long back. Hinged where it leaves the croup. */}
      <Tail root={[0, 0.475, -0.42]} kind="dog">
        <mesh position={[0, 0.58, -0.52]} rotation={[-0.75, 0, 0]} castShadow>
          <capsuleGeometry args={[0.034, 0.22, ...CAP]} />
          <Fur color={spec.coat} />
        </mesh>
      </Tail>

      {/* Neck. Without it the head sphere merges into the barrel and the whole dog reads as one
          blob with a snout stuck on the end. */}
      <mesh position={[0, 0.62, 0.34]} rotation={[0.8, 0, 0]} castShadow>
        <capsuleGeometry args={[0.105, 0.16, ...CAP]} />
        <Fur color={spec.coat} />
      </mesh>

      {/* Head, held up and clear of the back */}
      <mesh position={[0, 0.75, 0.44]} castShadow>
        <sphereGeometry args={[0.245, ...SPHERE]} />
        <Fur color={spec.coat} />
      </mesh>
      {/* Long tapered muzzle */}
      <mesh position={[0, 0.7, 0.66]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <capsuleGeometry args={[0.072, 0.2, ...CAP]} />
        <Fur color={spec.accent} />
      </mesh>
      {/* Long ears, hanging well past the jaw — the breed's other signature, so they are drawn
          big enough to be read from across the stage */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * 0.2, 0.72, 0.4]} scale={[0.36, 1.65, 0.85]} rotation={[0, 0, s * 0.1]} castShadow>
          <sphereGeometry args={[0.165, ...SPHERE]} />
          <Fur color={spec.dark} />
        </mesh>
      ))}
      <Face spec={spec} eyeX={0.115} eyeY={0.82} eyeZ={0.6} noseY={0.7} noseZ={0.87} noseR={0.05} />
    </>
  );
}

function PoodleModel({ spec }: { spec: PetSpec }) {
  return (
    <>
      <Legs spec={spec} radius={0.05} top={0.38} x={0.14} frontZ={0.2} backZ={-0.2} />
      {/* Ankle poms, the give-away of a clipped poodle */}
      {([[-1, 0.2], [1, 0.2], [-1, -0.2], [1, -0.2]] as const).map(([s, z], i) => (
        <mesh key={i} position={[s * 0.14, 0.09, z]} castShadow>
          <sphereGeometry args={[0.085, ...SPHERE]} />
          <Fur color={spec.accent} />
        </mesh>
      ))}

      {/* Compact body */}
      <mesh position={[0, 0.44, 0]} scale={[1, 1, 1.25]} castShadow>
        <sphereGeometry args={[0.24, ...SPHERE]} />
        <Fur color={spec.coat} />
      </mesh>
      {/* Curls breaking the body's outline, so the coat reads as fleece rather than fur */}
      {([[0, 0.6, 0.12], [-0.16, 0.56, -0.1], [0.16, 0.56, -0.1], [0, 0.5, -0.26]] as const).map(([x, y, z], i) => (
        <mesh key={i} position={[x, y, z]} castShadow>
          <sphereGeometry args={[0.13, ...SPHERE]} />
          <Fur color={spec.coat} />
        </mesh>
      ))}
      {/* Pom tail */}
      <Tail root={[0, 0.5, -0.26]} kind="dog">
        <mesh position={[0, 0.56, -0.34]} castShadow>
          <sphereGeometry args={[0.11, ...SPHERE]} />
          <Fur color={spec.coat} />
        </mesh>
      </Tail>

      {/* Round head pom */}
      <mesh position={[0, 0.76, 0.18]} castShadow>
        <sphereGeometry args={[0.27, ...SPHERE]} />
        <Fur color={spec.coat} />
      </mesh>
      {/* Topknot, which is what carries the crown up to y=1 */}
      {([[0, 0.96, 0.16], [-0.14, 0.92, 0.24], [0.14, 0.92, 0.24]] as const).map(([x, y, z], i) => (
        <mesh key={i} position={[x, y, z]} castShadow>
          <sphereGeometry args={[0.13, ...SPHERE]} />
          <Fur color={spec.coat} />
        </mesh>
      ))}
      {/* Soft hanging ear puffs */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * 0.25, 0.68, 0.12]} scale={[0.8, 1.15, 0.8]} castShadow>
          <sphereGeometry args={[0.155, ...SPHERE]} />
          <Fur color={spec.shade} />
        </mesh>
      ))}
      {/* Short muzzle and the black button nose */}
      <mesh position={[0, 0.71, 0.4]} scale={[1, 0.85, 1]} castShadow>
        <sphereGeometry args={[0.125, ...SPHERE]} />
        <Fur color={spec.accent} />
      </mesh>
      <Face spec={spec} eyeX={0.11} eyeY={0.82} eyeZ={0.38} noseY={0.73} noseZ={0.51} noseR={0.05} />
    </>
  );
}

function ShibaModel({ spec }: { spec: PetSpec }) {
  return (
    <>
      <Legs spec={spec} radius={0.062} top={0.39} x={0.15} frontZ={0.22} backZ={-0.2} />
      {/* Cream front socks, the breed's urajiro reaching down the legs */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * 0.15, 0.075, 0.22]} castShadow>
          <capsuleGeometry args={[0.063, 0.02, ...CAP]} />
          <Fur color={spec.accent} />
        </mesh>
      ))}

      {/* Sturdy barrel body */}
      <mesh position={[0, 0.47, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <capsuleGeometry args={[0.23, 0.26, ...CAP]} />
        <Fur color={spec.coat} />
      </mesh>
      {/* Cream chest and belly */}
      <mesh position={[0, 0.34, 0.08]} rotation={[Math.PI / 2, 0, 0]} scale={[0.85, 1, 0.5]} castShadow>
        <capsuleGeometry args={[0.21, 0.24, ...CAP]} />
        <Fur color={spec.accent} />
      </mesh>

      {/* Tail curled over the back — a torus stood on edge, which is the one primitive that
          keeps an even thickness the whole way round the curl */}
      <Tail root={[0, 0.62, -0.2]} kind="dog">
        <mesh position={[0, 0.72, -0.24]} rotation={[0.3, Math.PI / 2, 0]} castShadow>
          <torusGeometry args={[0.115, 0.062, 8, 20, Math.PI * 1.6]} />
          <Fur color={spec.coat} />
        </mesh>
      </Tail>

      {/* Neck, so the head reads as a head rather than a bulge on the barrel */}
      <mesh position={[0, 0.56, 0.17]} rotation={[0.7, 0, 0]} castShadow>
        <capsuleGeometry args={[0.115, 0.1, ...CAP]} />
        <Fur color={spec.coat} />
      </mesh>

      {/* Head */}
      <mesh position={[0, 0.71, 0.26]} castShadow>
        <sphereGeometry args={[0.29, ...SPHERE]} />
        <Fur color={spec.coat} />
      </mesh>
      {/* Cream mask: cheeks either side of a short broad muzzle */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * 0.16, 0.63, 0.42]} castShadow>
          <sphereGeometry args={[0.115, ...SPHERE]} />
          <Fur color={spec.accent} />
        </mesh>
      ))}
      <mesh position={[0, 0.66, 0.47]} scale={[1.15, 0.85, 1]} castShadow>
        <sphereGeometry args={[0.135, ...SPHERE]} />
        <Fur color={spec.accent} />
      </mesh>
      {/* Triangular prick ears. Flattened front-to-back and left broad at the base: a full cone
          reads as a horn, and a tall splayed one turns the head into a fox's — the one animal
          this breed must not be mistaken for. */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * 0.16, 0.93, 0.2]} rotation={[0.12, 0, s * -0.14]} scale={[1, 1, 0.55]} castShadow>
          <coneGeometry args={[0.115, 0.18, 3]} />
          <Fur color={spec.coat} />
        </mesh>
      ))}
      <Face spec={spec} eyeX={0.13} eyeY={0.76} eyeZ={0.48} noseY={0.69} noseZ={0.6} noseR={0.055} />
    </>
  );
}

/**
 * 貓 — one build for all three, where the dogs get one each.
 *
 * That asymmetry is the point rather than a shortcut: 臘腸/紅貴賓/柴犬 are breeds, and their
 * silhouettes are what name them, so three shapes. 橘/虎斑/賓士 are not breeds at all — they are
 * coat patterns on the same cat, and swapping one for another in life changes nothing but the
 * markings. So the body is shared and `breed` only decides what is painted on it.
 *
 * Against the dogs a cat is slimmer through the barrel, stands on thinner legs, and carries a long
 * smooth tail up off the croup where every dog here has a curl, a sweep or a pom.
 */
function CatModel({ spec, breed }: { spec: PetSpec; breed: string }) {
  const isTuxedo = breed === 'tuxedo';

  return (
    <>
      <Legs spec={spec} radius={0.048} top={0.42} x={0.13} frontZ={0.2} backZ={-0.2} />
      {/* The tuxedo's white socks, on all four — the marking it is named for */}
      {isTuxedo && ([[-1, 0.2], [1, 0.2], [-1, -0.2], [1, -0.2]] as const).map(([s, z], i) => (
        <mesh key={i} position={[s * 0.13, 0.075, z]} castShadow>
          <capsuleGeometry args={[0.049, 0.03, ...CAP]} />
          <Fur color={spec.accent} />
        </mesh>
      ))}

      {/* Body, slimmer through the barrel than any of the dogs */}
      <mesh position={[0, 0.5, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <capsuleGeometry args={[0.2, 0.26, ...CAP]} />
        <Fur color={spec.coat} />
      </mesh>
      {/* Pale underside — on the tuxedo this is the white bib and belly, carried in one piece from
          the chest back, which is how the pattern actually sits */}
      <mesh
        position={[0, isTuxedo ? 0.4 : 0.37, isTuxedo ? 0.12 : 0.04]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={isTuxedo ? [0.75, 1, 0.62] : [0.8, 1, 0.45]}
        castShadow
      >
        <capsuleGeometry args={[0.185, 0.22, ...CAP]} />
        <Fur color={spec.accent} />
      </mesh>
      {/* Mackerel bars, as rings round the barrel. A ring is the one primitive that keeps an even
          width all the way over a curved flank — stripes drawn as flat patches pinch at the sides
          and stop reading as stripes at all. The tuxedo has none. */}
      {!isTuxedo && [-0.09, 0, 0.09].map(z => (
        <mesh key={z} position={[0, 0.5, z]} castShadow>
          <torusGeometry args={[0.201, 0.022, 6, 18]} />
          <Fur color={spec.shade} />
        </mesh>
      ))}

      {/* Tail: long, smooth and lifted, in two segments so it curves rather than sticking out
          straight. The second starts exactly where the first ends, so there is no join to see. */}
      <Tail root={[0, 0.47, -0.27]} kind="cat">
        <mesh position={[0, 0.55, -0.32]} rotation={[-0.9, 0, 0]} castShadow>
          <capsuleGeometry args={[0.043, 0.22, ...CAP]} />
          <Fur color={spec.coat} />
        </mesh>
        <mesh position={[0, 0.715, -0.431]} rotation={[-0.25, 0, 0]} castShadow>
          <capsuleGeometry args={[0.04, 0.2, ...CAP]} />
          <Fur color={spec.coat} />
        </mesh>
        {/* Ringed tail on the tabbies, white tip on the tuxedo */}
        {isTuxedo ? (
          <mesh position={[0, 0.815, -0.457]} castShadow>
            <sphereGeometry args={[0.043, ...SPHERE]} />
            <Fur color={spec.accent} />
          </mesh>
        ) : (
          ([[0.52, -0.29], [0.63, -0.36]] as const).map(([y, z], i) => (
            <mesh key={i} position={[0, y, z]} rotation={[-0.9 + Math.PI / 2, 0, 0]} castShadow>
              <torusGeometry args={[0.044, 0.016, 6, 14]} />
              <Fur color={spec.shade} />
            </mesh>
          ))
        )}
      </Tail>

      {/* Neck, so the head reads as a head rather than a bulge on the barrel */}
      <mesh position={[0, 0.58, 0.16]} rotation={[0.7, 0, 0]} castShadow>
        <capsuleGeometry args={[0.1, 0.09, ...CAP]} />
        <Fur color={spec.coat} />
      </mesh>

      {/* Head — rounder and smaller against the body than any of the dogs' */}
      <mesh position={[0, 0.73, 0.24]} castShadow>
        <sphereGeometry args={[0.26, ...SPHERE]} />
        <Fur color={spec.coat} />
      </mesh>
      {/* Ears: taller and set wider than the shiba's prick ears, which is most of what separates a
          cat's head from a dog's at a glance. Flattened front-to-back so they read as triangles. */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * 0.17, 0.95, 0.2]} rotation={[0.1, 0, s * -0.2]} scale={[1, 1, 0.5]} castShadow>
          <coneGeometry args={[0.105, 0.22, 3]} />
          <Fur color={spec.coat} />
        </mesh>
      ))}
      {/* Muzzle: two small cheek pads, short and round where every dog here has a snout that
          projects forward */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * 0.072, 0.655, 0.44]} castShadow>
          <sphereGeometry args={[0.078, ...SPHERE]} />
          <Fur color={spec.accent} />
        </mesh>
      ))}
      {/* The tuxedo's blaze, running up the bridge of the nose between the eyes */}
      {isTuxedo && (
        <mesh position={[0, 0.79, 0.44]} scale={[0.3, 1.2, 0.42]} castShadow>
          <sphereGeometry args={[0.1, ...SPHERE]} />
          <Fur color={spec.accent} />
        </mesh>
      )}
      <Face spec={spec} eyeX={0.12} eyeY={0.78} eyeZ={0.44} noseY={0.7} noseZ={0.52} noseR={0.042} />
    </>
  );
}

/**
 * 鳥 — one build for all four, in the same sense the cats share one: a budgerigar, a Java sparrow
 * and a canary are all small perching birds of near enough the same size, and drawing three
 * separate skeletons for them would be inventing differences that are not there.
 *
 * What IS there, and what this switches on, are the two parts that actually differ between them —
 * the bill (a parrot's hook, a finch's heavy cone, a canary's fine pin) and the tail (the budgie's
 * is nearly as long as its body; the other two are short) — plus which colour goes where. That is
 * the whole table below.
 *
 * 鳳凰 rides the same body deliberately. It is bigger (constants/pets.ts sets its height half again
 * as tall) and it carries three parts none of the others do — a flame crest, a fan of three plumes
 * and a gold collar, all behind `mythical` in the table — but under those it is the same egg with
 * the same wings on the same pivots. Giving the shelf's one mythical bird its own skeleton would
 * mean every future fix to how a bird flies has to be made twice.
 *
 * The birds fly rather than stand (see {@link HoveringBird}), so this model has no legs under it:
 * the feet are tucked up against the belly the way a bird in the air holds them, and the wings are
 * on their own pivots so they can beat. A perched pose would need legs and would be the wrong pose
 * — the player asked for a companion in the air beside them.
 */
type BirdBill = 'hook' | 'cone' | 'pin' | 'raptor';
/** A slot of {@link PetSpec}, including the two 鳥-only ones, named so the table below can point at it. */
type Tone = 'coat' | 'shade' | 'accent' | 'dark' | 'beak' | 'mark';

interface BirdForm {
  bill: BirdBill;
  /** How far the tail reaches back, in this file's local units where the bird is 1 tall. */
  tailLength: number;
  /** The skull and throat: the 虎皮鸚鵡's yellow mask, the 文鳥's black hood, or just the coat. */
  head: Tone;
  belly: Tone;
  wing: Tone;
  tail: Tone;
  /** 文鳥 only: a black eye on a black hood is invisible, and in life the red ring is what you see. */
  eyeRing: boolean;
  /** 虎皮鸚鵡 only: the barring the bird is named for, on the wing and over the nape. */
  barred: boolean;
  /**
   * 鳳凰 only: the flame crest, the fan of three long tail plumes and the gold mask.
   *
   * One flag rather than three, because they are not independent choices — they are the parts that
   * turn a small perching bird into a mythical one, and a bird with the plumes but no crest is
   * neither. Nothing else on the shelf may set it; a second bird wanting a crest wants its own
   * field describing the crest it actually has.
   */
  mythical?: boolean;
}

const BIRD_FORMS: Record<string, BirdForm> = {
  budgie:      { bill: 'hook', tailLength: 0.62, head: 'accent', belly: 'coat',   wing: 'accent', tail: 'mark',  eyeRing: false, barred: true },
  javasparrow: { bill: 'cone', tailLength: 0.30, head: 'dark',   belly: 'mark',   wing: 'shade',  tail: 'dark',  eyeRing: true,  barred: false },
  canary:      { bill: 'pin',  tailLength: 0.34, head: 'coat',   belly: 'accent', wing: 'shade',  tail: 'shade', eyeRing: false, barred: false },
  // 鳳凰. The one long tail on the shelf — 0.95 against the budgie's 0.62, which is already
  // "nearly as long as the bird" — because streaming plumes are what this thing is recognised by
  // from behind, which is the angle a companion flying beside the character is most often seen at.
  // Head in `coat` — red — and NOT in the gold the wings are, which is what a pass at putting the
  // icon's gold mask into three dimensions ended up doing. Gold head plus gold wings meet at the
  // shoulder and merge, and the bird stops being a red one with gold on it and becomes a yellow
  // bird with a red belly, which is a weaver finch. The gold this model spends on its face goes on
  // the crest instead, where it is against red on every side.
  phoenix:     { bill: 'raptor', tailLength: 0.95, head: 'coat', belly: 'mark',   wing: 'accent', tail: 'coat',  eyeRing: false, barred: false, mythical: true },
};

/** Bill by shape: how fat, how long, where it sits on the face and how far it tips down. */
const BIRD_BILLS: Record<BirdBill, { r: number; len: number; y: number; z: number; pitch: number }> = {
  // A parrot's beak is short, deep and curls back under itself — the one profile no finch has.
  hook: { r: 0.085, len: 0.18, y: 0.775, z: 0.38, pitch: 0.55 },
  // A Java sparrow's is enormous for its head; scaled down to polite it stops being the bird.
  cone: { r: 0.115, len: 0.26, y: 0.735, z: 0.42, pitch: 0.06 },
  pin:  { r: 0.065, len: 0.20, y: 0.745, z: 0.40, pitch: 0.08 },
  // 鳳凰's. A parrot's proportions carried further — deeper at the base and tipped down harder, so
  // it reads as a bird of prey's rather than as something that cracks seed. Deliberately NOT
  // `hook`: that one drags the budgie's blue cere along with it (see the mesh below), and a cere is
  // a parrot's feature, not a firebird's.
  raptor: { r: 0.095, len: 0.21, y: 0.78, z: 0.37, pitch: 0.62 },
};

/** The 鳥-only slots fall back, so a bird added to PET_SPECS without them still renders in colour. */
function tone(spec: PetSpec, t: Tone): string {
  if (t === 'beak') return spec.beak ?? spec.shade;
  if (t === 'mark') return spec.mark ?? spec.accent;
  return spec[t];
}

function BirdModel({ spec, breed }: { spec: PetSpec; breed: string }) {
  const form = BIRD_FORMS[breed] ?? BIRD_FORMS.budgie;
  const bill = BIRD_BILLS[form.bill];
  const head = tone(spec, form.head);
  const keratin = tone(spec, 'beak');
  const mark = tone(spec, 'mark');
  const wings = useRef<THREE.Group[]>([]);
  const hands = useRef<THREE.Group[]>([]);

  // The wingbeat, in two parts because the wing is in two parts: the arm swings from the shoulder
  // and the hand runs the same stroke about an eighth of a cycle late. The lag is what puts tension
  // in it — an arm and a tip that turn together are a plank on a hinge, while a tip that arrives
  // after the arm has already turned bends the wing through the stroke, which is what a wing
  // pushing against air looks like. Slower than the flat-out blur it used to be: a longer wing
  // beating at the old rate reads as panic rather than as a bird holding station.
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * 6.4;
    const beat = 0.2 + Math.sin(t) * 0.52;
    const lag = 0.06 + Math.sin(t - 0.8) * 0.34;
    // A wing pointing -x lifts on a NEGATIVE rotation about z and one pointing +x on a positive
    // one, so the mirrored pair takes the mirrored sign and the two beat together.
    if (wings.current[0]) wings.current[0].rotation.z = -beat;
    if (wings.current[1]) wings.current[1].rotation.z = beat;
    if (hands.current[0]) hands.current[0].rotation.z = -lag;
    if (hands.current[1]) hands.current[1].rotation.z = lag;
  });

  return (
    <>
      {/* Tail: a flattened cone so it tapers to a point rather than ending in a square. Its axis is
          rotated onto -z (backwards) and the squash is on the axis that lands vertical, which is
          what makes it a flat fan instead of a spike. */}
      <mesh
        position={[0, 0.4, -(0.26 + form.tailLength / 2)]}
        rotation={[-Math.PI / 2 - 0.12, 0, 0]}
        scale={[1, 1, 0.3]}
        castShadow
      >
        <coneGeometry args={[0.12, form.tailLength, 6]} />
        <Fur color={tone(spec, form.tail)} />
      </mesh>
      {/* 鳳凰's outer pair of plumes, which is what turns one tail into a fan.
          Each sits in its own group so the splay is a rotation about the BIRD's centre rather than
          an offset on the plume: rotated in place, a plume swings its root out of the rump and the
          fan comes apart at the join. Shorter and set higher than the middle one, and swept up
          harder, so the three read as a spread rather than as three sticks at the same angle.
          Painted in `mark` against the middle plume's `coat` — three plumes in one red were three
          red shapes overlapping into one red shape from every angle but dead side-on. */}
      {form.mythical && [-1, 1].map(s => (
        <group key={s} rotation={[0, s * 0.4, 0]}>
          <mesh
            position={[0, 0.5, -(0.24 + form.tailLength * 0.4)]}
            rotation={[-Math.PI / 2 - 0.42, 0, 0]}
            scale={[1, 1, 0.3]}
            castShadow
          >
            <coneGeometry args={[0.1, form.tailLength * 0.8, 6]} />
            <Fur color={mark} />
          </mesh>
        </group>
      ))}
      {/* Gold at the tip of all three plumes. Placed by walking back down each plume's OWN axis
          from its centre — a cone rotated about x by -(π/2 + t) points along (0, -sin t, -cos t),
          so the tip is that far along it — rather than by eyeballing a z. Eyeballed, a tip lands
          beside its plume the moment either the length or the sweep is retuned, and this file
          retunes both from one number each. */}
      {form.mythical && ([
        [0.12, 0.4, 0.26 + form.tailLength / 2, form.tailLength / 2 - 0.1, 0.07, 0],
        [0.42, 0.5, 0.24 + form.tailLength * 0.4, form.tailLength * 0.4 - 0.09, 0.06, 0.4],
        [0.42, 0.5, 0.24 + form.tailLength * 0.4, form.tailLength * 0.4 - 0.09, 0.06, -0.4],
      ] as const).map(([tilt, y, z, along, r, yaw], i) => (
        <group key={i} rotation={[0, yaw, 0]}>
          <mesh
            position={[0, y - Math.sin(tilt) * along, -(z + Math.cos(tilt) * along)]}
            rotation={[-Math.PI / 2 - tilt, 0, 0]}
            scale={[1, 1, 0.3]}
            castShadow
          >
            <coneGeometry args={[r, 0.22, 6]} />
            <Fur color={spec.accent} />
          </mesh>
        </group>
      ))}

      {/* Body, an egg lying front-to-back */}
      <mesh position={[0, 0.44, 0]} scale={[0.86, 0.94, 1.16]} castShadow>
        <sphereGeometry args={[0.27, ...SPHERE]} />
        <Fur color={spec.coat} />
      </mesh>
      {/* Underside — the 文鳥's pink belly, the 金絲雀's cream vent, the budgie's plain green */}
      <mesh position={[0, 0.34, 0.03]} scale={[0.8, 0.6, 1]} castShadow>
        <sphereGeometry args={[0.24, ...SPHERE]} />
        <Fur color={tone(spec, form.belly)} />
      </mesh>
      {/* The 金絲雀's warm breast, which is the only thing separating it from a plain yellow shape */}
      {breed === 'canary' && (
        <mesh position={[0, 0.52, 0.22]} scale={[0.9, 0.8, 0.6]} castShadow>
          <sphereGeometry args={[0.16, ...SPHERE]} />
          <Fur color={mark} />
        </mesh>
      )}

      {/* Feet, tucked up under the belly the way a bird in flight carries them */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * 0.09, 0.23, 0.02]} rotation={[0.9, 0, 0]} castShadow>
          <capsuleGeometry args={[0.028, 0.1, ...CAP]} />
          <Fur color={keratin} />
        </mesh>
      ))}

      {/* Wings, spread rather than folded. These birds are in the air beside the character, and a
          blade tucked down the flank is the pose of a bird sitting on a perch: it gave them a pair
          of small side panels instead of a span. Each wing now reaches out to about 0.64, so the
          pair spans a little over twice the width of the body it carries.

          Three parts on two pivots:
            · the SHOULDER, a blob buried in the flank at one end and inside the arm at the other.
              The arm is a thin sheet and the body is an egg, and without this the join is a slot cut
              in a balloon. It travels with the wing, so the seam cannot open anywhere in the beat.
            · the ARM, from inside the body out to mid-span. Its pivot sits INSIDE the flank (x 0.14
              against a surface at 0.21), which is what keeps the root buried however far the beat
              swings it.
            · the HAND, on its own pivot at the arm's end, swept back and beating late (see above).
          Both outer parts are flattened top-to-bottom rather than side-to-side — an aerofoil's
          proportions, which is what lets a spread wing still read as a wing seen edge-on. */}
      {[-1, 1].map((s, i) => (
        <group key={s} ref={(el: THREE.Group | null) => { if (el) wings.current[i] = el; }} position={[s * 0.14, 0.55, -0.03]}>
          <mesh position={[s * 0.02, -0.015, -0.02]} scale={[0.62, 0.52, 0.8]} castShadow>
            <sphereGeometry args={[0.2, ...SPHERE]} />
            <Fur color={tone(spec, form.wing)} />
          </mesh>
          <mesh position={[s * 0.15, 0, -0.05]} scale={[0.8, 0.2, 1]} castShadow>
            <sphereGeometry args={[0.2, ...SPHERE]} />
            <Fur color={tone(spec, form.wing)} />
          </mesh>
          {/* 虎皮 — the barring, run across the arm and through it, so the stripes show on both faces
              whichever way the stroke has turned the wing. Each bar is the arm's own cross-section
              at its station along the span, inflated a hair top-to-bottom and pulled in a little
              fore-and-aft: an ellipsoid inside an ellipsoid surfaces as an even stripe that follows
              the curve of the wing and dies away before the edge, where a box of one fixed size
              stood proud of a surface that had already fallen away under it. */}
          {form.barred && [0.07, 0.15, 0.23].map(x => {
            const chord = Math.sqrt(Math.max(0, 1 - ((x - 0.15) / 0.16) ** 2));
            return (
              <mesh key={x} position={[s * x, 0, -0.05]} scale={[0.08, 0.2 * chord + 0.04, 0.92 * chord]} castShadow>
                <sphereGeometry args={[0.2, ...SPHERE]} />
                <Fur color={spec.dark} />
              </mesh>
            );
          })}
          {/* The hand. Swept back so the wing has a leading edge instead of standing out square from
              the bird, and thinner and shorter in the chord than the arm so the span tapers to a
              tip rather than ending in a stump. */}
          <group
            ref={(el: THREE.Group | null) => { if (el) hands.current[i] = el; }}
            position={[s * 0.27, 0.005, -0.03]}
            rotation={[0, s * 0.42, 0]}
          >
            <mesh position={[s * 0.13, 0, -0.02]} scale={[0.7, 0.15, 0.62]} castShadow>
              <sphereGeometry args={[0.2, ...SPHERE]} />
              <Fur color={tone(spec, form.wing)} />
            </mesh>
          </group>
        </group>
      ))}

      {/* Throat, bridging the head into the body. Painted the head's colour, not the coat's, because
          on all three of these the mask or hood carries on down under the chin. */}
      <mesh position={[0, 0.63, 0.1]} castShadow>
        <sphereGeometry args={[0.19, ...SPHERE]} />
        <Fur color={head} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 0.76, 0.17]} castShadow>
        <sphereGeometry args={[0.225, ...SPHERE]} />
        <Fur color={head} />
      </mesh>
      {/* 虎皮 again, over the crown and nape where the barring actually starts */}
      {form.barred && [0.86, 0.79, 0.72].map(y => (
        <mesh key={y} position={[0, y, 0.02]} scale={[1, 1, 0.35]} castShadow>
          <torusGeometry args={[0.185, 0.018, 6, 16, Math.PI]} />
          <Fur color={spec.dark} />
        </mesh>
      ))}
      {/* The 文鳥's white cheeks, the mark it is picked out by at any distance */}
      {breed === 'javasparrow' && [-1, 1].map(s => (
        <mesh key={s} position={[s * 0.15, 0.735, 0.235]} scale={[0.7, 1, 0.7]} castShadow>
          <sphereGeometry args={[0.095, ...SPHERE]} />
          <Fur color={spec.accent} />
        </mesh>
      ))}
      {/* The budgie's violet cheek patches and its row of throat spots */}
      {breed === 'budgie' && (
        <>
          {[-1, 1].map(s => (
            <mesh key={s} position={[s * 0.145, 0.7, 0.29]} castShadow>
              <sphereGeometry args={[0.05, ...SPHERE]} />
              <Fur color={mark} />
            </mesh>
          ))}
          {([[0, 0.6, 0.33], [-0.09, 0.615, 0.3], [0.09, 0.615, 0.3]] as const).map(([x, y, z]) => (
            <mesh key={x} position={[x, y, z]} castShadow>
              <sphereGeometry args={[0.03, ...SPHERE]} />
              <Fur color={spec.dark} />
            </mesh>
          ))}
        </>
      )}

      {/* 鳳凰's crest — the one part of this bird that has to be read from across the stage, so it
          is the one part built oversized on purpose. Three cones leaning BACK off the crown (a
          positive x rotation tips a cone's point toward -z), middle one tallest and in gold, outer
          two shorter, splayed sideways and in the hot `mark`. Rooted at y ~0.9 against a
          crown that reaches ~0.985, so they grow out of the skull instead of balancing on it.
          **Half the head's height, and that is after two passes.** At 0.15–0.2 long the crest read
          as three pinfeathers on a red canary; the flame only appears once the crest is a
          substantial fraction of the head it sits on, which is also how it is drawn on the tile.
          There is no gold collar here, though the neck is where the icon's gold mask first went:
          the body is an egg 0.31 deep, so a ring scaled to the neck sits INSIDE it and renders as
          nothing, and one flared wide enough to clear the body collides with the wing roots. The
          gold moved to the head itself instead — see `head: 'accent'` in the table above. */}
      {form.mythical && ([
        [-0.105, 0.9, 0.1, 0.34, 0.54, 0.38],
        [0, 0.925, 0.14, 0.46, 0.46, 0],
        [0.105, 0.9, 0.1, 0.34, 0.54, -0.38],
      ] as const).map(([x, y, z, len, pitch, roll]) => (
        <mesh key={x} position={[x, y, z]} rotation={[pitch, 0, roll]} castShadow>
          <coneGeometry args={[0.075, len, 6]} />
          <Fur color={x === 0 ? spec.accent : mark} />
        </mesh>
      ))}

      {/* Bill. The cone's axis is +y, so a quarter turn about x lays it along +z and the form's own
          `pitch` tips it down from there — a parrot's a long way, a finch's barely at all. */}
      <mesh position={[0, bill.y, bill.z]} rotation={[Math.PI / 2 + bill.pitch, 0, 0]} castShadow>
        <coneGeometry args={[bill.r, bill.len, 10]} />
        <Fur color={keratin} />
      </mesh>
      {/* The budgie's cere, sat on top of the beak where it meets the face */}
      {form.bill === 'hook' && (
        <mesh position={[0, 0.835, 0.33]} castShadow>
          <sphereGeometry args={[0.06, ...SPHERE]} />
          <Fur color={keratin} />
        </mesh>
      )}

      {/* Eyes, set toward the sides of the skull as a bird's are — further out than any of the
          mammals in this file, which is most of what makes a round head read as a bird's. */}
      {[-1, 1].map(s => (
        <group key={s} position={[s * 0.155, 0.81, 0.26]}>
          <mesh castShadow>
            <sphereGeometry args={[0.05, ...SPHERE]} />
            <Fur color={spec.dark} />
          </mesh>
          {form.eyeRing && (
            <mesh position={[0, 0, 0.01]} rotation={[0, s * 0.5, 0]}>
              <torusGeometry args={[0.07, 0.018, 6, 16]} />
              <Fur color={keratin} />
            </mesh>
          )}
        </group>
      ))}
    </>
  );
}

/**
 * The pet itself, drawn to a unit height at the origin and facing +z.
 *
 * `itemId` is the catalog id (`pet-dog-shiba`); an id with no spec renders nothing rather than a
 * placeholder, so a save holding a pet that has since left the catalog just shows no companion.
 */
export const PetModel = memo(function PetModel({
  itemId, gait, cosmetics,
}: {
  itemId: string;
  /** Live walk state from whoever is moving this pet — see {@link PetGait}. Omitted, it stands. */
  gait?: React.RefObject<PetGait>;
  /**
   * 特殊飾品 worn by this pet (constants/cosmeticEffects.ts). Passed in rather than read from
   * the profile here, because this component is the MODEL — it draws an animal, and which
   * animal is wearing what is the caller's business. {@link CompanionPet} resolves it.
   */
  cosmetics?: readonly SpecialCosmeticDef[];
}) {
  const spec = getPetSpec(itemId);
  const breed = getPetBreed(itemId);
  const species = getPetSpecies(itemId);
  const bodyRef = useRef<THREE.Group>(null);

  // Standing idle: a slow breathing rise, and enough sway that the dog reads as alive next to an
  // avatar that has its own idle. Deliberately tiny — a companion that bounces pulls the eye off
  // the character whose outfit this screen exists to show.
  //
  // 鳥 get none of it. They are already beating their wings and riding a hover path, and a third
  // motion on top of those two is the difference between a bird in the air and a jittering one.
  useFrame(({ clock }) => {
    if (!bodyRef.current || species === 'bird') return;
    const t = clock.getElapsedTime();
    // Faded out as the pet gets moving: the breathing sway is an IDLE, and left running underneath
    // a trot it fights the stride's own bob for control of the same axis.
    const rest = 1 - Math.min(1, gait?.current.intensity ?? 0);
    bodyRef.current.position.y = Math.sin(t * 1.6) * 0.012 * rest;
    bodyRef.current.rotation.z = Math.sin(t * 0.8) * 0.02 * rest;
  });

  if (!spec || !breed) return null;

  return (
    <GaitContext.Provider value={gait ?? null}>
      <group ref={bodyRef}>
        {/* Species first, because the cats and the birds each share one build while every dog has
            its own — see the comment on CatModel for why the halves of this are shaped
            differently. */}
        {species === 'cat' && <CatModel spec={spec} breed={breed} />}
        {species === 'bird' && <BirdModel spec={spec} breed={breed} />}
        {species === 'dog' && (
          <>
            {breed === 'dachshund' && <DachshundModel spec={spec} />}
            {breed === 'poodle' && <PoodleModel spec={spec} />}
            {breed === 'shiba' && <ShibaModel spec={spec} />}
          </>
        )}

        {/* 特殊飾品. Inside `bodyRef`, so an ornament rides the breathing sway, the walk bob and a
            bird's bank exactly as the animal's own ears do — section 三's "讓寵物與效果產生一些
            互動" obtained by construction rather than by animating a bow to look worn.

            Three lines whatever the breed: each socket is the CENTRE of a body part scaled by that
            part's radius (constants/petRig.ts), so one bow model fits a 臘腸's narrow skull, a
            紅貴賓's pom and a 金絲雀's little head with no per-species branch here. */}
        {cosmetics && cosmetics.length > 0 && (
          <PetCosmetics spec={spec} breed={breed} cosmetics={cosmetics} />
        )}
      </group>
    </GaitContext.Provider>
  );
});

/**
 * Hangs a pet's ornaments on its three sockets.
 *
 * Split out so PetModel's own early return (`if (!spec || !breed) return null`) stays above it —
 * the anchors need a breed, and a component that reads one is easier to keep honest than three
 * conditionals inline.
 */
function PetCosmetics({
  spec, breed, cosmetics,
}: {
  spec: PetSpec;
  breed: string;
  cosmetics: readonly SpecialCosmeticDef[];
}) {
  const anchors = getPetAnchors(breed);
  // What the effect runtime divides emitter distances by, so "rise 0.3" is 30 cm on a canary and
  // on a shiba alike — see petRootScale.
  const rootScale = petRootScale(spec);
  return (
    <>
      <CosmeticSlot socket="petHead" cosmetics={cosmetics} point={anchors.petHead} rootScale={rootScale} />
      <CosmeticSlot socket="petCollar" cosmetics={cosmetics} point={anchors.petCollar} rootScale={rootScale} />
      <CosmeticSlot socket="petBack" cosmetics={cosmetics} point={anchors.petBack} rootScale={rootScale} />
    </>
  );
}

/**
 * The equipped pet, placed beside the character: a step out to the character's right and half a
 * step FORWARD, turned slightly inward so it reads as accompanying them rather than standing to
 * attention. Scaled to the breed's height in the avatar's own local units, so it is mounted in
 * the same space the avatar is and needs no second scale factor to stay in proportion.
 *
 * Forward, not behind. Standing it behind the character was the natural reading of "右側後方半步"
 * and it put the dog behind the very thing the camera is pointed at — from this screen's fixed
 * front-on view the owner's body cut across the pet's face. In front of the shoulder line nothing
 * occludes it, and it is still far enough out sideways to leave the outfit — the reason this
 * screen exists — completely clear.
 *
 * Offsets are in the avatar's LOCAL units, where the character's own torso is ~0.14 wide.
 */
export const AVATAR_PET_OFFSET = { x: -0.36, z: 0.2 } as const;

/**
 * Where a 鳥 flies, in the same avatar-local units as {@link AVATAR_PET_OFFSET}.
 *
 * `y` puts it between the character's shoulder (0.44) and the crown (0.945): high enough to be
 * plainly airborne rather than hopping about the floor, low enough that it is never mistaken for a
 * hat. It is out at the same `x` as the dogs stand, so the outfit — the reason this screen exists —
 * stays as clear as it is with a dog on the stage.
 *
 * The drifts are the "移動一點點的距離就盤旋" of it: a tenth of a unit sideways is a bit less than
 * the character's own torso width, so the bird visibly wanders forward, back and side to side
 * without ever leaving the owner's side or crossing in front of the clothes.
 *
 * The three speeds are deliberately not multiples of one another. On round ratios the path closes
 * into the same visible loop every few seconds and reads as a mechanism on a track; left
 * incommensurate, the three sines take minutes to line up again and the bird never quite repeats
 * itself — which is the difference between hovering and orbiting.
 */
const BIRD_HOVER = {
  x: AVATAR_PET_OFFSET.x, y: 0.58, z: 0.24,
  driftX: 0.1, driftY: 0.045, driftZ: 0.085,
  speedX: 0.55, speedY: 0.9, speedZ: 0.37,
} as const;

/**
 * How hard the bird turns into its own drift.
 *
 * Facing the direction of travel outright is what a bird does and what looks worst here: half of
 * the path is backwards, so half the time the player would be shown the tail of the bird they just
 * bought. Steering the yaw by the sideways speed against a fixed forward bias keeps the turn honest
 * — it banks and points where it is sliding — while capping it at roughly 42°, so the bird is
 * always still facing out of the screen. Its other virtue is that it cannot wrap: an angle blended
 * from atan2 snaps by a full turn the moment the bird drifts straight backwards.
 */
const BIRD_FORWARD_BIAS = 0.062;

const HoveringBird = memo(function HoveringBird({
  itemId, height, cosmetics,
}: {
  itemId: string; height: number; cosmetics?: readonly SpecialCosmeticDef[];
}) {
  const ref = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.getElapsedTime();
    const h = BIRD_HOVER;

    g.position.set(
      h.x + Math.sin(t * h.speedX) * h.driftX,
      h.y + Math.sin(t * h.speedY) * h.driftY,
      h.z + Math.sin(t * h.speedZ + 1.1) * h.driftZ,
    );

    // The drift's own derivative, so the attitude is the motion's rather than a second animation
    // guessing at it — the bird can never bank one way while sliding the other.
    const vx = Math.cos(t * h.speedX) * h.speedX * h.driftX;
    const vz = Math.cos(t * h.speedZ + 1.1) * h.speedZ * h.driftZ;

    g.rotation.y = 0.3 + Math.atan2(vx, BIRD_FORWARD_BIAS);
    // Bank into the turn: sliding left drops the left wing, as it must to be turning at all.
    g.rotation.z = -vx * 3.5;
    // And nose down a little when pressing forward, up when backing off.
    g.rotation.x = vz * 5;
  });

  return (
    <group ref={ref} scale={height}>
      <PetModel itemId={itemId} cosmetics={cosmetics} />
    </group>
  );
});

export const CompanionPet = memo(function CompanionPet({
  itemId, cosmetics,
}: {
  itemId: string;
  /**
   * 特殊飾品 for this pet. Resolved by the CALLER (with resolveSpecialCosmetics) rather than read
   * from the profile here, so this file stays what it is — geometry — and does not acquire a
   * dependency on the app's state just to draw a bow.
   */
  cosmetics?: readonly SpecialCosmeticDef[];
}) {
  const spec = getPetSpec(itemId);
  if (!spec) return null;

  // 鳥 fly beside the owner instead of standing next to them — see BIRD_HOVER.
  if (getPetSpecies(itemId) === 'bird') {
    return <HoveringBird itemId={itemId} height={spec.height} cosmetics={cosmetics} />;
  }

  return (
    // A gentle turn toward the owner, not a full one: much past this and the dog is in profile,
    // and the face the player just bought stops facing the player.
    <group position={[AVATAR_PET_OFFSET.x, 0, AVATAR_PET_OFFSET.z]} rotation={[0, 0.3, 0]} scale={spec.height}>
      <PetModel itemId={itemId} cosmetics={cosmetics} />
    </group>
  );
});
