/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { memo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PetSpec, getPetBreed, getPetSpec, getPetSpecies } from '../../constants/pets';

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
  return (
    <>
      {([[-1, backZ], [1, backZ], [-1, frontZ], [1, frontZ]] as const).map(([s, z], i) => (
        <mesh key={i} position={[s * x, y, z]} castShadow>
          <capsuleGeometry args={[radius, length, ...CAP]} />
          <Fur color={s < 0 ? spec.shade : spec.coat} />
        </mesh>
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

      {/* Tail, thin and carried up off the long back */}
      <mesh position={[0, 0.58, -0.52]} rotation={[-0.75, 0, 0]} castShadow>
        <capsuleGeometry args={[0.034, 0.22, ...CAP]} />
        <Fur color={spec.coat} />
      </mesh>

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
      <mesh position={[0, 0.56, -0.34]} castShadow>
        <sphereGeometry args={[0.11, ...SPHERE]} />
        <Fur color={spec.coat} />
      </mesh>

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
      <mesh position={[0, 0.72, -0.24]} rotation={[0.3, Math.PI / 2, 0]} castShadow>
        <torusGeometry args={[0.115, 0.062, 8, 20, Math.PI * 1.6]} />
        <Fur color={spec.coat} />
      </mesh>

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
 * 鳥 — one build for all three, in the same sense the cats share one: a budgerigar, a Java sparrow
 * and a canary are all small perching birds of near enough the same size, and drawing three
 * separate skeletons for them would be inventing differences that are not there.
 *
 * What IS there, and what this switches on, are the two parts that actually differ between them —
 * the bill (a parrot's hook, a finch's heavy cone, a canary's fine pin) and the tail (the budgie's
 * is nearly as long as its body; the other two are short) — plus which colour goes where. That is
 * the whole table below.
 *
 * The birds fly rather than stand (see {@link HoveringBird}), so this model has no legs under it:
 * the feet are tucked up against the belly the way a bird in the air holds them, and the wings are
 * on their own pivots so they can beat. A perched pose would need legs and would be the wrong pose
 * — the player asked for a companion in the air beside them.
 */
type BirdBill = 'hook' | 'cone' | 'pin';
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
}

const BIRD_FORMS: Record<string, BirdForm> = {
  budgie:      { bill: 'hook', tailLength: 0.62, head: 'accent', belly: 'coat',   wing: 'accent', tail: 'mark',  eyeRing: false, barred: true },
  javasparrow: { bill: 'cone', tailLength: 0.30, head: 'dark',   belly: 'mark',   wing: 'shade',  tail: 'dark',  eyeRing: true,  barred: false },
  canary:      { bill: 'pin',  tailLength: 0.34, head: 'coat',   belly: 'accent', wing: 'shade',  tail: 'shade', eyeRing: false, barred: false },
};

/** Bill by shape: how fat, how long, where it sits on the face and how far it tips down. */
const BIRD_BILLS: Record<BirdBill, { r: number; len: number; y: number; z: number; pitch: number }> = {
  // A parrot's beak is short, deep and curls back under itself — the one profile no finch has.
  hook: { r: 0.085, len: 0.18, y: 0.775, z: 0.38, pitch: 0.55 },
  // A Java sparrow's is enormous for its head; scaled down to polite it stops being the bird.
  cone: { r: 0.115, len: 0.26, y: 0.735, z: 0.42, pitch: 0.06 },
  pin:  { r: 0.065, len: 0.20, y: 0.745, z: 0.40, pitch: 0.08 },
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

  // The wingbeat. Fast and shallow rather than slow and wide: a hovering bird's wings blur, and at
  // the size this renders next to the character a lazy albatross flap reads as the bird falling.
  // Both wings are driven off one value, mirrored — see the sign note below.
  useFrame(({ clock }) => {
    const beat = 0.22 + Math.sin(clock.getElapsedTime() * 7.2) * 0.55;
    // A wing pointing -x lifts on a NEGATIVE rotation about z and one pointing +x on a positive
    // one, so the mirrored pair takes the mirrored sign and the two beat together.
    if (wings.current[0]) wings.current[0].rotation.z = -beat;
    if (wings.current[1]) wings.current[1].rotation.z = beat;
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

      {[-1, 1].map((s, i) => (
        <group key={s} ref={(el: THREE.Group | null) => { if (el) wings.current[i] = el; }} position={[s * 0.17, 0.55, 0]}>
          <mesh position={[s * 0.13, -0.03, -0.04]} scale={[0.28, 0.85, 1.25]} castShadow>
            <sphereGeometry args={[0.2, ...SPHERE]} />
            <Fur color={tone(spec, form.wing)} />
          </mesh>
          {form.barred && [-0.13, 0, 0.13].map(z => (
            <mesh key={z} position={[s * 0.192, -0.03, z - 0.04]} castShadow>
              <boxGeometry args={[0.012, 0.26, 0.05]} />
              <Fur color={spec.dark} />
            </mesh>
          ))}
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
export const PetModelOld = memo(function PetModelOld({ itemId }: { itemId: string }) {
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
    bodyRef.current.position.y = Math.sin(t * 1.6) * 0.012;
    bodyRef.current.rotation.z = Math.sin(t * 0.8) * 0.02;
  });

  if (!spec || !breed) return null;

  return (
    <group ref={bodyRef}>
      {/* Species first, because the cats and the birds each share one build while every dog has its
          own — see the comment on CatModel for why the halves of this are shaped differently. */}
      {species === 'cat' && <CatModel spec={spec} breed={breed} />}
      {species === 'bird' && <BirdModel spec={spec} breed={breed} />}
      {species === 'dog' && (
        <>
          {breed === 'dachshund' && <DachshundModel spec={spec} />}
          {breed === 'poodle' && <PoodleModel spec={spec} />}
          {breed === 'shiba' && <ShibaModel spec={spec} />}
        </>
      )}
    </group>
  );
});

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

const HoveringBird = memo(function HoveringBird({ itemId, height }: { itemId: string; height: number }) {
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
      <PetModelOld itemId={itemId} />
    </group>
  );
});

export const CompanionPet = memo(function CompanionPet({ itemId }: { itemId: string }) {
  const spec = getPetSpec(itemId);
  if (!spec) return null;

  // 鳥 fly beside the owner instead of standing next to them — see BIRD_HOVER.
  if (getPetSpecies(itemId) === 'bird') {
    return <HoveringBird itemId={itemId} height={spec.height} />;
  }

  return (
    // A gentle turn toward the owner, not a full one: much past this and the dog is in profile,
    // and the face the player just bought stops facing the player.
    <group position={[AVATAR_PET_OFFSET.x, 0, AVATAR_PET_OFFSET.z]} rotation={[0, 0.3, 0]} scale={spec.height}>
      <PetModelOld itemId={itemId} />
    </group>
  );
});
