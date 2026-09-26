/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { memo, useMemo } from 'react';
import * as THREE from 'three';

/**
 * Q-version footwear for the avatar.
 *
 * The 3D shoe used to be one `boxGeometry` per foot with a single flat colour, while the shop
 * icon for the same item was a fully articulated drawing - so a shoe that looked detailed in the
 * grid turned into a monotone brick once equipped. This module fixes that side of the gap: every
 * shoe is built from a stack of parts (outsole / midsole / upper / heel / trim) and takes its
 * palette straight from the matching branch of QVersionIcon, so the worn shoe and its icon read
 * as the same object.
 *
 * LOCAL SPACE - the whole component is authored in one convention, and every number below is in
 * it. Get this wrong and the shoe either floats or sinks into the terrain:
 *
 *   y = 0   the ground / underside of the outsole. Everything is built UPWARD from here.
 *   z = 0   the ankle's centre line. +z is forward (toes), -z is back (heel).
 *   x = 0   the centre line of the foot. The models are symmetric, so one component serves
 *           both feet and there is no left/right variant to keep in sync.
 *
 * The caller is responsible for putting that origin on the ground - see `soleAnchorY()`.
 *
 * ENCLOSING THE LEG - the leg is a capsule of radius LEG_RADIUS whose bottom cap rests at y = 0,
 * and it is NOT trimmed when a shoe is on. So any closed part of a shoe that sits at a height
 * where the leg is already at full width has to be wider than LEG_RADIUS, or the leg pokes out
 * through the side of it. That is why the collars and shafts here are cylinders of radius ~0.058
 * and up rather than something snugger: at chibi scale the leg is nearly as wide as the foot.
 * Open shoes (sandals, flip-flops) dodge this entirely - they have no closed upper, and the
 * skin-coloured foot slab they do draw simply merges with the leg it overlaps.
 */

export type ShoeType = 'sport' | 'leather' | 'heels' | 'boots' | 'sandals' | 'flipflops';

/** Radius of the avatar's leg capsule. Mirrors the value in Avatar.tsx. */
const LEG_RADIUS = 0.055;

/**
 * Where the shoe group has to sit in LEG-LOCAL space for its y=0 to land on the ground.
 *
 * The leg capsule hangs off the hip pivot at -0.10 - legLengthen/2 with a straight section of
 * 0.14 + legLengthen, so its bottom cap is at -(0.10 + legLengthen/2) - (0.14 + legLengthen)/2
 * - LEG_RADIUS, which reduces to -0.225 - legLengthen. Deriving it rather than hard-coding it
 * keeps the shoes glued to the sole if the legs are ever lengthened again.
 */
export const soleAnchorY = (legLengthen: number) => -0.225 - legLengthen;

/** Half-width of a normal shoe body. Comfortably clear of LEG_RADIUS - see the header note. */
const W = 0.060;

/**
 * A rounded slab - the workhorse shape for soles and uppers.
 *
 * It is a capsule laid on its side and squashed: `rotation.x = 90deg` maps the capsule's own +Y
 * axis onto world +Z (so the straight section runs heel-to-toe) and its local +Z onto world -Y,
 * which is why the vertical squash is `scale.z` and not `scale.y`. The result is a shape with
 * rounded ends and a flat-ish top, which is what a chibi sole wants - a plain box reads as a
 * brick, and that brick is exactly what this file exists to replace.
 *
 * `y` is the slab's BOTTOM, not its centre, because every shoe here is stacked bottom-up.
 */
function Slab({
  r,
  len,
  h,
  y,
  z = 0,
  color,
  roughness = 0.6,
  metalness = 0,
  castShadow = false,
}: {
  /** Half-width, and also the radius of the rounded heel/toe ends. */
  r: number;
  /** Length of the STRAIGHT section. Total depth is len + 2r. */
  len: number;
  /** Finished height of the slab. */
  h: number;
  y: number;
  z?: number;
  color: string;
  roughness?: number;
  metalness?: number;
  castShadow?: boolean;
}) {
  return (
    <mesh
      position={[0, y + h / 2, z]}
      rotation={[Math.PI / 2, 0, 0]}
      scale={[1, 1, h / (2 * r)]}
      castShadow={castShadow}
    >
      <capsuleGeometry args={[r, len, 4, 20]} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
    </mesh>
  );
}

/** An upright tube - ankle collars and boot shafts. `y` is its bottom. */
function Tube({
  rTop,
  rBot,
  h,
  y,
  z = 0,
  color,
  roughness = 0.6,
  castShadow = false,
}: {
  rTop: number;
  rBot: number;
  h: number;
  y: number;
  z?: number;
  color: string;
  roughness?: number;
  castShadow?: boolean;
}) {
  return (
    <mesh position={[0, y + h / 2, z]} castShadow={castShadow}>
      <cylinderGeometry args={[rTop, rBot, h, 20, 1, true]} />
      <meshStandardMaterial color={color} roughness={roughness} side={THREE.DoubleSide} />
    </mesh>
  );
}

/**
 * A capsule stretched between two points - straps, laces and the flip-flop's Y.
 *
 * Straps run diagonally in all three axes, and hand-authoring Euler angles for those is how you
 * end up with a strap that floats off the foot. Deriving the rotation from the endpoints instead
 * means the ends always land exactly where the design says they do.
 */
function Strut({
  from,
  to,
  r,
  color,
  roughness = 0.5,
}: {
  from: [number, number, number];
  to: [number, number, number];
  r: number;
  color: string;
  roughness?: number;
}) {
  const [ax, ay, az] = from;
  const [bx, by, bz] = to;
  const { position, quaternion, straight } = useMemo(() => {
    const a = new THREE.Vector3(ax, ay, az);
    const b = new THREE.Vector3(bx, by, bz);
    const dir = new THREE.Vector3().subVectors(b, a);
    const length = dir.length();
    return {
      position: new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5),
      // Capsules are born pointing up +Y; rotate that onto the strut's direction.
      quaternion: new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        dir.normalize(),
      ),
      // capsuleGeometry's first length arg is the straight part only, so the caps have to be
      // subtracted or the strap overshoots its anchors by one radius at each end.
      straight: Math.max(length - 2 * r, 0.001),
    };
  }, [ax, ay, az, bx, by, bz, r]);

  return (
    <mesh position={position} quaternion={quaternion}>
      <capsuleGeometry args={[r, straight, 4, 10]} />
      <meshStandardMaterial color={color} roughness={roughness} />
    </mesh>
  );
}

/**
 * A strap arching over the foot. A torus in the XY plane, squashed to an oval so it hugs a foot
 * that is much wider than it is tall. Its lower half is buried inside the footbed on purpose -
 * that is what tucks the strap ends out of sight without modelling them.
 */
function ArchStrap({
  y,
  z,
  r,
  tube,
  color,
  scaleX = 1.35,
  scaleY = 0.85,
}: {
  y: number;
  z: number;
  r: number;
  tube: number;
  color: string;
  scaleX?: number;
  scaleY?: number;
}) {
  return (
    <mesh position={[0, y, z]} scale={[scaleX, scaleY, 1]}>
      <torusGeometry args={[r, tube, 8, 24]} />
      <meshStandardMaterial color={color} roughness={0.55} />
    </mesh>
  );
}

/** Three toe bumps peeking out of an open shoe. The single clearest "this shoe is open" cue. */
function Toes({ y, z, color }: { y: number; z: number; color: string }) {
  return (
    <>
      {[-0.026, 0, 0.026].map((x, i) => (
        <mesh key={i} position={[x, y, z - Math.abs(x) * 0.28]} scale={[1, 0.8, 1.1]}>
          <sphereGeometry args={[0.011, 10, 8]} />
          <meshStandardMaterial color={color} roughness={0.75} />
        </mesh>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The six shoes. Palettes are lifted from QVersionIcon's shoes-* art. *
 * ------------------------------------------------------------------ */

/** Runner: chunky two-tone foam stack, blue heel counter, swoosh and laces. */
function SportShoe() {
  return (
    <>
      <Slab r={W} len={0.04} h={0.014} y={0} z={0.028} color="#1F4E7A" roughness={0.85} castShadow />
      <Slab r={W + 0.001} len={0.038} h={0.024} y={0.013} z={0.028} color="#F4F7FB" roughness={0.75} />
      <Slab r={0.058} len={0.03} h={0.036} y={0.034} z={0.032} color="#FFFFFF" roughness={0.55} castShadow />
      {/* Reinforced panels: heel counter at the back, lighter cap over the toe. */}
      <Slab r={0.059} len={0.004} h={0.034} y={0.035} z={-0.03} color="#2E7FD4" roughness={0.55} />
      <Slab r={0.052} len={0.004} h={0.026} y={0.034} z={0.09} color="#DCE9F5" roughness={0.5} />
      <Tube rTop={0.06} rBot={0.06} h={0.03} y={0.048} z={-0.012} color="#FFFFFF" roughness={0.55} />
      {/* Padded collar rim closing the top of the cylinder. */}
      <mesh position={[0, 0.077, -0.012]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.058, 0.009, 8, 24]} />
        <meshStandardMaterial color="#7CB8EB" roughness={0.6} />
      </mesh>
      {/* Swoosh sweeping up out of the midsole on both flanks. */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.058, 0.046, 0.03]} rotation={[0.28, 0, 0]}>
          <boxGeometry args={[0.005, 0.014, 0.075]} />
          <meshStandardMaterial color="#2E7FD4" roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 0.068, 0.026]} rotation={[0.25, 0, 0]}>
        <boxGeometry args={[0.05, 0.012, 0.032]} />
        <meshStandardMaterial color="#FFFFFF" roughness={0.6} />
      </mesh>
      {[0.014, 0.03].map((z) => (
        <mesh key={z} position={[0, 0.079, z]}>
          <boxGeometry args={[0.052, 0.005, 0.006]} />
          <meshStandardMaterial color="#2E7FD4" roughness={0.45} />
        </mesh>
      ))}
    </>
  );
}

/** Oxford: tan welt, stacked heel, long polished toe cap, pale laces. */
function LeatherShoe() {
  return (
    <>
      <Slab r={0.058} len={0.04} h={0.012} y={0} z={0.03} color="#C89A64" roughness={0.7} castShadow />
      {/* Stacked heel sits ON the welt rather than under it - dropping it below would push the
          shoe through the ground, since y=0 is already the terrain. */}
      <Slab r={0.042} len={0.006} h={0.009} y={0.011} z={-0.03} color="#8A5A38" roughness={0.7} />
      {/* Low roughness plus a touch of metalness is the polish - cheaper and better looking
          than painting a specular streak on as extra geometry. */}
      <Slab r={0.056} len={0.03} h={0.034} y={0.018} z={0.034} color="#4A2C1A" roughness={0.28} metalness={0.15} castShadow />
      <Tube rTop={0.058} rBot={0.058} h={0.024} y={0.04} z={-0.012} color="#4A2C1A" roughness={0.28} />
      <mesh position={[0, 0.062, -0.012]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.057, 0.006, 8, 24]} />
        <meshStandardMaterial color="#3A2113" roughness={0.35} />
      </mesh>
      {/* Toe-cap seam. */}
      <Slab r={0.05} len={0.002} h={0.028} y={0.02} z={0.082} color="#3A2113" roughness={0.3} />
      {/* Lace facing across the throat. */}
      {[0.012, 0.028].map((z) => (
        <mesh key={z} position={[0, 0.052, z]} rotation={[0.2, 0, 0]}>
          <boxGeometry args={[0.032, 0.004, 0.005]} />
          <meshStandardMaterial color="#D9B98C" roughness={0.6} />
        </mesh>
      ))}
    </>
  );
}

/**
 * Pump: pointed toe, satin vamp, chunky block heel with a dark tap.
 *
 * A true stiletto would need the foot pitched forward, and the leg it attaches to cannot be
 * tilted from here - the result is a floating shoe with the ankle poking out under the arch. The
 * item description covers block heels too ("細跟或粗跟"), so this takes the block: it keeps
 * ground contact honest at both ends and still reads unmistakably as a heel.
 */
function HeelShoe() {
  return (
    <>
      <Slab r={0.052} len={0.024} h={0.012} y={0} z={0.034} color="#C4134F" roughness={0.4} castShadow />
      {/* Pointed toe: a cone squashed to the sole's height, apex forward. */}
      <mesh position={[0, 0.006, 0.111]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.24]}>
        <coneGeometry args={[0.05, 0.028, 16]} />
        <meshStandardMaterial color="#C4134F" roughness={0.4} />
      </mesh>
      <Slab r={0.03} len={0.006} h={0.046} y={0} z={-0.036} color="#C4134F" roughness={0.4} castShadow />
      <Slab r={0.03} len={0.006} h={0.005} y={0} z={-0.036} color="#7A0C36" roughness={0.7} />
      <Slab r={0.056} len={0.018} h={0.034} y={0.01} z={0.02} color="#E11D64" roughness={0.3} castShadow />
      <Tube rTop={0.057} rBot={0.057} h={0.036} y={0.032} z={-0.024} color="#E11D64" roughness={0.3} />
      <mesh position={[0, 0.068, -0.024]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.056, 0.005, 8, 24]} />
        <meshStandardMaterial color="#C4134F" roughness={0.35} />
      </mesh>
      {/* Gem at the throat. */}
      <mesh position={[0, 0.046, 0.05]}>
        <sphereGeometry args={[0.011, 12, 10]} />
        <meshStandardMaterial color="#FFD84D" roughness={0.15} metalness={0.4} />
      </mesh>
    </>
  );
}

/** Tall boot: lug sole, tan welt, high shaft, folded cuff and a buckled ankle strap. */
function BootShoe() {
  return (
    <>
      <Slab r={W + 0.001} len={0.038} h={0.016} y={0} z={0.026} color="#2A2E36" roughness={0.95} castShadow />
      <Slab r={W + 0.002} len={0.038} h={0.008} y={0.015} z={0.026} color="#D9A566" roughness={0.7} />
      <Slab r={W} len={0.03} h={0.032} y={0.022} z={0.03} color="#3F4550" roughness={0.6} castShadow />
      <Slab r={0.054} len={0.004} h={0.026} y={0.024} z={0.086} color="#4C525E" roughness={0.55} />
      <Tube rTop={0.063} rBot={0.063} h={0.1} y={0.045} z={-0.006} color="#3F4550" roughness={0.6} castShadow />
      {/* Folded-over cuff, deliberately wider than the shaft. */}
      <Tube rTop={0.07} rBot={0.068} h={0.026} y={0.132} z={-0.006} color="#A97C50" roughness={0.65} />
      <mesh position={[0, 0.158, -0.006]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.069, 0.006, 8, 24]} />
        <meshStandardMaterial color="#8A5A32" roughness={0.7} />
      </mesh>
      {/* Ankle strap and its buckle. */}
      <mesh position={[0, 0.072, -0.006]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.064, 0.007, 8, 24]} />
        <meshStandardMaterial color="#2A2E36" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.072, 0.058]}>
        <boxGeometry args={[0.017, 0.017, 0.009]} />
        <meshStandardMaterial color="#FFC94D" roughness={0.25} metalness={0.5} />
      </mesh>
    </>
  );
}

/** Slide sandal: cork footbed on a rubber outsole, coral straps, gold medallion, bare toes. */
function SandalShoe({ skinColor }: { skinColor: string }) {
  return (
    <>
      <Slab r={W} len={0.04} h={0.01} y={0} z={0.028} color="#A9743E" roughness={0.85} castShadow />
      <Slab r={W + 0.001} len={0.04} h={0.014} y={0.009} z={0.028} color="#EFD3A4" roughness={0.8} />
      {/* The foot itself, not a shoe part - an open sandal has to show one. */}
      <Slab r={0.052} len={0.026} h={0.03} y={0.021} z={0.03} color={skinColor} roughness={0.75} />
      <Toes y={0.03} z={0.088} color={skinColor} />
      <ArchStrap y={0.024} z={0.03} r={0.04} tube={0.008} color="#FF7A59" />
      <ArchStrap y={0.024} z={-0.018} r={0.038} tube={0.006} color="#FF9E7A" scaleX={1.3} scaleY={0.9} />
      <mesh position={[0, 0.056, 0.03]}>
        <sphereGeometry args={[0.011, 12, 10]} />
        <meshStandardMaterial color="#FFC94D" roughness={0.2} metalness={0.4} />
      </mesh>
    </>
  );
}

/**
 * Flip-flop: thin two-tone foam and a Y strap.
 *
 * The sandal above is also "strap over a sole", so the two have to be told apart by build, not
 * colour: this one gets a thin sole instead of the sandal's chunky cork stack, and a Y off a
 * single toe post instead of two bands across the foot.
 */
function FlipFlopShoe({ skinColor }: { skinColor: string }) {
  return (
    <>
      <Slab r={W} len={0.04} h={0.008} y={0} z={0.028} color="#17B8B0" roughness={0.8} castShadow />
      <Slab r={W + 0.001} len={0.04} h={0.012} y={0.007} z={0.028} color="#FFFDF5" roughness={0.8} />
      <Slab r={0.052} len={0.026} h={0.03} y={0.018} z={0.03} color={skinColor} roughness={0.75} />
      <Toes y={0.027} z={0.088} color={skinColor} />
      {[-1, 1].map((s) => (
        <Strut
          key={s}
          from={[0, 0.034, 0.072]}
          to={[s * 0.05, 0.018, 0.016]}
          r={0.005}
          color="#17B8B0"
        />
      ))}
      <mesh position={[0, 0.036, 0.072]}>
        <sphereGeometry args={[0.009, 12, 10]} />
        <meshStandardMaterial color="#8AE6DF" roughness={0.4} />
      </mesh>
    </>
  );
}

/**
 * Draws one shoe. Both feet render the same model - see the LOCAL SPACE note about symmetry.
 *
 * Memoised because none of this geometry animates: the feet are swung by their parent hip
 * pivots, so re-running the whole stack on every avatar state change would be pure waste.
 */
export const ShoeModel = memo(function ShoeModel({
  type,
  skinColor,
}: {
  type: ShoeType;
  skinColor: string;
}) {
  switch (type) {
    case 'sport':
      return <SportShoe />;
    case 'leather':
      return <LeatherShoe />;
    case 'heels':
      return <HeelShoe />;
    case 'boots':
      return <BootShoe />;
    case 'sandals':
      return <SandalShoe skinColor={skinColor} />;
    case 'flipflops':
      return <FlipFlopShoe skinColor={skinColor} />;
    default:
      return null;
  }
});
