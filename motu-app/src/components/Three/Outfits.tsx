/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { memo, useMemo } from 'react';
import * as THREE from 'three';

/**
 * Q-version torso garments for the avatar.
 *
 * Same problem the shoes had, and the same fix: the shop icon for each outfit is a fully
 * articulated drawing, while the worn version was a tinted capsule with two or three boxes
 * glued to the front - and in several cases it was not even the icon's colour. The explorer
 * suit is the clearest example: pale cream canvas in the grid, dark chocolate on the avatar.
 *
 * Every palette below is lifted from the matching branch of QVersionIcon so the two agree. Where
 * the old 3D carried detail the icon does not have (the dive suit's cyan gauge and yellow side
 * piping, for instance) that detail is gone - matching the icon is the point.
 *
 * LOCAL SPACE - these render as children of the torso mesh, so the origin is the torso capsule's
 * centre and +z is the avatar's front. The torso is a capsule of radius TORSO_R whose straight
 * section runs y in [-TORSO_H, +TORSO_H]; outside that band it curves in towards the caps, which
 * is why anything wrapping the body has to be built off `capsuleR()` rather than a fixed radius.
 * A plain torus at hem height floats off the body by nearly a centimetre of model space.
 */

export type OutfitType =
  | 'surf'
  | 'diving'
  | 'explorer'
  | 'captain'
  | 'vest'
  | 'shawl'
  | 'jacket';

/** Mirrors the torso capsule in Avatar.tsx. */
const TORSO_R = 0.135;
const TORSO_H = 0.04;

/** Radius of the torso's silhouette at height `y`. Flat through the straight section, then it
 *  follows the spherical cap. Clamped, so a caller asking past the pole gets 0 rather than NaN. */
function capsuleR(y: number, R = TORSO_R, h = TORSO_H) {
  const over = Math.abs(y) - h;
  if (over <= 0) return R;
  return Math.sqrt(Math.max(R * R - over * over, 0));
}

/**
 * A garment panel that hugs the torso.
 *
 * Built as a lathe of the capsule's own silhouette swept through a slice of revolution, so it
 * follows the body's curve at every height instead of standing off it the way a cylinder or a
 * torus does. This is what makes side stripes, plackets, collars and hem bands sit flat.
 *
 * Angles: theta = 0 faces front (+z) and grows towards the avatar's left (+x), matching the
 * convention three.js uses for both LatheGeometry and CylinderGeometry.
 */
function Panel({
  yFrom,
  yTo,
  thetaStart = 0,
  thetaLength = Math.PI * 2,
  lift = 0.006,
  color,
  roughness = 0.6,
  metalness = 0,
  emissive,
  emissiveIntensity,
  segments = 24,
}: {
  yFrom: number;
  yTo: number;
  thetaStart?: number;
  thetaLength?: number;
  /** How far to float the panel off the body. Too small and it z-fights the torso. */
  lift?: number;
  color: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  segments?: number;
}) {
  const points = useMemo(() => {
    const n = 14;
    const out: THREE.Vector2[] = [];
    for (let i = 0; i <= n; i++) {
      const y = yFrom + ((yTo - yFrom) * i) / n;
      out.push(new THREE.Vector2(capsuleR(y) + lift, y));
    }
    return out;
  }, [yFrom, yTo, lift]);

  return (
    <mesh>
      <latheGeometry args={[points, segments, thetaStart, thetaLength]} />
      <meshStandardMaterial
        color={color}
        roughness={roughness}
        metalness={metalness}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/**
 * A flat detail sitting ON the body surface - pockets, buckles, badges.
 * `theta` places it around the body (0 = dead centre front) and the patch is turned to face
 * outward, so its own +z is "away from the chest" and it lies tangent rather than clipping in.
 */
function Patch({
  theta = 0,
  y,
  w,
  h,
  d = 0.012,
  color,
  roughness = 0.7,
  metalness = 0,
  lift = 0.004,
  tilt = 0,
}: {
  theta?: number;
  y: number;
  w: number;
  h: number;
  d?: number;
  color: string;
  roughness?: number;
  metalness?: number;
  lift?: number;
  /** Roll about the outward axis - used for the jacket's angled slash pockets. */
  tilt?: number;
}) {
  const r = capsuleR(y) + lift;
  return (
    <mesh position={[r * Math.sin(theta), y, r * Math.cos(theta)]} rotation={[0, theta, tilt]}>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
    </mesh>
  );
}

/** A round stud on the body surface - buttons and rivets. */
function Stud({
  theta = 0,
  y,
  r = 0.011,
  color,
  metalness = 0.85,
  roughness = 0.15,
}: {
  theta?: number;
  y: number;
  r?: number;
  color: string;
  metalness?: number;
  roughness?: number;
}) {
  const d = capsuleR(y) + 0.006;
  return (
    <mesh position={[d * Math.sin(theta), y, d * Math.cos(theta)]}>
      <sphereGeometry args={[r, 10, 8]} />
      <meshStandardMaterial color={color} metalness={metalness} roughness={roughness} />
    </mesh>
  );
}

/** Five petals and a middle. The shawl's print, kept to six cheap spheres per bloom. */
function Flower({ theta, y, color = '#FFFFFF', scale = 1 }: { theta: number; y: number; color?: string; scale?: number }) {
  const d = capsuleR(y) + 0.005;
  return (
    <group position={[d * Math.sin(theta), y, d * Math.cos(theta)]} rotation={[0, theta, 0]} scale={scale}>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.012, Math.sin(a) * 0.012, 0]} scale={[1, 1, 0.45]}>
            <sphereGeometry args={[0.007, 8, 6]} />
            <meshStandardMaterial color={color} roughness={0.6} />
          </mesh>
        );
      })}
      <mesh scale={[1, 1, 0.45]}>
        <sphereGeometry args={[0.006, 8, 6]} />
        <meshStandardMaterial color="#FFE9A8" roughness={0.5} />
      </mesh>
    </group>
  );
}

/* ---------------------------------------------------------------- *
 * Wetsuits. Surf and dive are the same cut in the icon and are told  *
 * apart by their side panels, so they share one body here too.       *
 * ---------------------------------------------------------------- */

function Wetsuit({ shell, accent, seam }: { shell: string; accent: string; seam: string }) {
  return (
    <>
      <mesh>
        <capsuleGeometry args={[0.14, 0.08, 4, 16]} />
        <meshStandardMaterial color={shell} metalness={0.35} roughness={0.18} />
      </mesh>
      {/* The coloured panel running down each flank - the icon's one loud feature. */}
      {[Math.PI / 2, -Math.PI / 2].map((mid) => (
        <group key={mid}>
          <Panel
            yFrom={-0.115}
            yTo={0.085}
            thetaStart={mid - 0.34}
            thetaLength={0.68}
            lift={0.007}
            color={accent}
            roughness={0.25}
            metalness={0.2}
          />
          {/* Hairline seams down both edges of the panel, the 3D reading of the icon's
              white/20 border. Detail you only notice up close, which is where it matters. */}
          {[mid - 0.34, mid + 0.34].map((edge) => (
            <Panel
              key={edge}
              yFrom={-0.115}
              yTo={0.085}
              thetaStart={edge - 0.018}
              thetaLength={0.036}
              lift={0.009}
              color={seam}
              roughness={0.35}
            />
          ))}
        </group>
      ))}
      {/* Collar */}
      <Panel yFrom={0.075} yTo={0.115} lift={0.008} color="#09090B" roughness={0.3} />
      {/* Front zip: dark tape, bright pull. */}
      <Panel yFrom={-0.09} yTo={0.09} thetaStart={-0.055} thetaLength={0.11} lift={0.008} color="#3F3F46" roughness={0.4} />
      <Patch y={0.052} w={0.014} h={0.02} d={0.008} color="#A1AAB5" roughness={0.2} metalness={0.7} lift={0.012} />
    </>
  );
}

/** Surf: charcoal neoprene, orange flank panels, white wave mark on the chest. */
function SurfSuit() {
  return (
    <>
      <Wetsuit shell="#27272A" accent="#F97316" seam="#FFD8B0" />
      {/* Wave mark - three offset bars reading as swell, the icon's Waves glyph. */}
      {[0.03, 0.014, -0.002].map((y, i) => (
        <Patch
          key={y}
          theta={0.30}
          y={y}
          w={0.05 - i * 0.008}
          h={0.006}
          d={0.006}
          color="#FFFFFF"
          roughness={0.45}
          lift={0.006}
          tilt={0.18 - i * 0.06}
        />
      ))}
    </>
  );
}

/** Dive: blacker shell, emerald flank panels, knee-to-shoulder seam piping. */
function DiveSuit() {
  return (
    <>
      <Wetsuit shell="#18181B" accent="#10B981" seam="#BBF7DE" />
      {/* Shoulder yoke seam - the pro-neoprene cue, and what keeps this from reading as the
          surf suit in a different colour. */}
      <Panel yFrom={0.062} yTo={0.076} thetaStart={-1.5} thetaLength={3.0} lift={0.009} color="#10B981" roughness={0.3} />
    </>
  );
}

/** Explorer suit: pale canvas, amber webbing, two flap pockets and a buckled belt. */
function ExplorerSuit() {
  return (
    <>
      <mesh>
        <capsuleGeometry args={[0.144, 0.08, 4, 16]} />
        <meshStandardMaterial color="#FEF3C7" roughness={0.88} />
      </mesh>
      {/* Rounded collar bib across the front of the neck. */}
      <Panel yFrom={0.07} yTo={0.115} thetaStart={-1.15} thetaLength={2.3} lift={0.008} color="#FFFBEB" roughness={0.85} />
      <Panel yFrom={0.066} yTo={0.076} thetaStart={-1.15} thetaLength={2.3} lift={0.009} color="#92400E" roughness={0.8} />
      {/* Button placket down the centre. */}
      <Panel yFrom={-0.03} yTo={0.07} thetaStart={-0.05} thetaLength={0.1} lift={0.008} color="#92400E" roughness={0.8} />
      {/* Chest pockets: cream box, dark flap, brass button. */}
      {[-0.42, 0.42].map((theta) => (
        <group key={theta}>
          <Patch theta={theta} y={0.012} w={0.05} h={0.052} d={0.014} color="#FFFBEB" roughness={0.85} />
          <Patch theta={theta} y={0.04} w={0.053} h={0.014} d={0.017} color="#92400E" roughness={0.8} />
          <Stud theta={theta} y={0.028} r={0.007} color="#FACC15" />
        </group>
      ))}
      {/* Belt, all the way round, with the icon's yellow buckle at the front. */}
      <Panel yFrom={-0.062} yTo={-0.03} lift={0.008} color="#92400E" roughness={0.85} />
      <Patch y={-0.046} w={0.038} h={0.026} d={0.012} color="#FACC15" roughness={0.2} metalness={0.6} lift={0.008} />
    </>
  );
}

/** Captain: navy serge, double-breasted brass, epaulettes, hem lace and a collar anchor. */
function CaptainUniform() {
  return (
    <>
      <mesh>
        <capsuleGeometry args={[0.144, 0.08, 4, 16]} />
        <meshStandardMaterial color="#0F172A" roughness={0.5} />
      </mesh>
      {/* Collar stands in the same navy as the coat - the old model put a white shirt collar
          here, which the icon does not have. */}
      <Panel yFrom={0.072} yTo={0.115} lift={0.008} color="#0F172A" roughness={0.45} />
      {/* Centre placket. */}
      <Panel yFrom={-0.08} yTo={0.072} thetaStart={-0.05} thetaLength={0.1} lift={0.007} color="#080D18" roughness={0.5} />
      {/* Two columns of three, the double-breasted front. */}
      {[-0.27, 0.27].map((theta) =>
        [0.028, -0.006, -0.04].map((y) => (
          <group key={`${theta}-${y}`}>
            <Stud theta={theta} y={y} r={0.013} color="#D97706" metalness={0.7} roughness={0.3} />
            <Stud theta={theta} y={y} r={0.0105} color="#FBBF24" />
          </group>
        )),
      )}
      {/* Rank lace above the hem. */}
      {[-0.088, -0.104].map((y) => (
        <Panel key={y} yFrom={y} yTo={y + 0.009} lift={0.008} color="#F59E0B" roughness={0.25} metalness={0.5} />
      ))}
      {/* Epaulettes, sitting flat on the shoulder slope rather than jutting out sideways. */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.108, 0.062, 0]} rotation={[0, 0, s * -0.42]}>
          <boxGeometry args={[0.085, 0.016, 0.062]} />
          <meshStandardMaterial color="#F59E0B" metalness={0.75} roughness={0.25} />
        </mesh>
      ))}
      {/* Anchor badge at the throat. */}
      <group position={[0, 0.086, capsuleR(0.086) + 0.007]}>
        <mesh>
          <boxGeometry args={[0.005, 0.028, 0.004]} />
          <meshStandardMaterial color="#F59E0B" metalness={0.8} roughness={0.2} />
        </mesh>
        <mesh position={[0, 0.009, 0]}>
          <boxGeometry args={[0.019, 0.005, 0.004]} />
          <meshStandardMaterial color="#F59E0B" metalness={0.8} roughness={0.2} />
        </mesh>
        <mesh position={[0, -0.011, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.011, 0.0028, 6, 14, Math.PI]} />
          <meshStandardMaterial color="#F59E0B" metalness={0.8} roughness={0.2} />
        </mesh>
      </group>
    </>
  );
}

/**
 * Adventure vest: stone canvas, cream collar, two chest pockets and one big divided cargo
 * pocket across the belly. Sleeveless - Avatar.tsx keeps the sleeve capsules off for this one.
 */
function AdventureVest() {
  return (
    <>
      <mesh>
        <capsuleGeometry args={[0.144, 0.08, 4, 16]} />
        <meshStandardMaterial color="#78716C" roughness={0.85} />
      </mesh>
      <Panel yFrom={0.07} yTo={0.115} thetaStart={-1.1} thetaLength={2.2} lift={0.008} color="#F8F9F2" roughness={0.8} />
      <Panel yFrom={0.064} yTo={0.074} thetaStart={-1.1} thetaLength={2.2} lift={0.009} color="#292524" roughness={0.8} />
      {/* Open front: two dark edges instead of a placket, so it reads as unzipped. */}
      {[-0.11, 0.11].map((theta) => (
        <Panel key={theta} yFrom={-0.09} yTo={0.07} thetaStart={theta - 0.022} thetaLength={0.044} lift={0.008} color="#292524" roughness={0.8} />
      ))}
      {[-0.4, 0.4].map((theta) => (
        <group key={theta}>
          <Patch theta={theta} y={0.016} w={0.048} h={0.048} d={0.015} color="#57534E" roughness={0.85} />
          <Patch theta={theta} y={0.041} w={0.051} h={0.012} d={0.018} color="#292524" roughness={0.8} />
        </group>
      ))}
      {/* The big divided cargo pocket. Two boxes with a gap, which is cheaper and reads better
          than one box plus a painted-on divider line. */}
      {[-0.235, 0.235].map((theta) => (
        <Patch key={theta} theta={theta} y={-0.05} w={0.052} h={0.05} d={0.016} color="#57534E" roughness={0.85} />
      ))}
    </>
  );
}

/** Island shawl: rose silk, white diagonal weave, two blooms and a fringed hem. */
function IslandShawl() {
  return (
    <>
      <mesh position={[0, 0.02, 0]} rotation={[0.1, 0, 0]}>
        <capsuleGeometry args={[0.145, 0.08, 4, 16]} />
        <meshStandardMaterial color="#FB7185" roughness={0.45} />
      </mesh>
      {/* The icon's warm radial bloom, as a band of orange low on the drape. */}
      <Panel yFrom={-0.05} yTo={0.01} lift={0.007} color="#FDA05C" roughness={0.5} />
      {/* Diagonal weave: narrow slices tilted off vertical. Sweeping theta while stepping y
          is what gives them their lean without needing a texture. */}
      {[-1.25, -0.75, -0.25, 0.25, 0.75, 1.25].map((theta, i) => (
        <Panel
          key={theta}
          yFrom={-0.075 + i * 0.004}
          yTo={0.075 + i * 0.004}
          thetaStart={theta - 0.035}
          thetaLength={0.07}
          lift={0.009}
          color="#FFE7EA"
          roughness={0.4}
        />
      ))}
      <Flower theta={-0.34} y={0.028} />
      <Flower theta={0.34} y={0.028} scale={0.85} />
      {/* Deep rose border and the hanging fringe along it. */}
      <Panel yFrom={-0.105} yTo={-0.078} lift={0.008} color="#881337" roughness={0.5} />
      {[-1.5, -1.1, -0.7, -0.35, 0, 0.35, 0.7, 1.1, 1.5].map((theta) => {
        const r = capsuleR(-0.108) + 0.006;
        return (
          <mesh key={theta} position={[r * Math.sin(theta), -0.125, r * Math.cos(theta)]}>
            <capsuleGeometry args={[0.004, 0.024, 3, 6]} />
            <meshStandardMaterial color="#881337" roughness={0.55} />
          </mesh>
        );
      })}
      {/* Collar trim */}
      <Panel yFrom={0.085} yTo={0.12} lift={0.008} color="#FDA4AF" roughness={0.4} />
    </>
  );
}

/** Flight jacket: olive body, knitted collar and hem rib, orange lining at the open neck. */
function FlightJacket() {
  return (
    <>
      <mesh>
        <capsuleGeometry args={[0.142, 0.08, 4, 16]} />
        <meshStandardMaterial color="#6E7C4F" roughness={0.7} />
      </mesh>
      {/* Shaded side, the same light/dark split the icon paints on. */}
      <Panel yFrom={-0.1} yTo={0.08} thetaStart={0.5} thetaLength={2.15} lift={0.006} color="#56623C" roughness={0.72} />
      {/* Orange lining, visible only in the notch where the collar stands open - so it is drawn
          under the collar rib and slightly narrower than it. */}
      <Panel yFrom={0.052} yTo={0.086} thetaStart={-0.5} thetaLength={1.0} lift={0.008} color="#E08A3C" roughness={0.6} />
      {/* Knitted collar and hem: same yarn, same colour, ribbed with fine grooves. */}
      <Panel yFrom={0.078} yTo={0.118} lift={0.009} color="#4B5535" roughness={0.85} />
      <Panel yFrom={-0.115} yTo={-0.072} lift={0.009} color="#4B5535" roughness={0.85} />
      {Array.from({ length: 18 }).map((_, i) => {
        const theta = (i / 18) * Math.PI * 2;
        return (
          <Panel
            key={i}
            yFrom={-0.112}
            yTo={-0.075}
            thetaStart={theta - 0.012}
            thetaLength={0.024}
            lift={0.0105}
            color="#3E472B"
            roughness={0.9}
          />
        );
      })}
      {/* Full-length zip with a pale metal pull. */}
      <Panel yFrom={-0.075} yTo={0.078} thetaStart={-0.048} thetaLength={0.096} lift={0.008} color="#3E472B" roughness={0.7} />
      <Patch y={0.0} w={0.014} h={0.022} d={0.008} color="#EADFC4" roughness={0.3} metalness={0.6} lift={0.012} />
      {/* Slash pockets, angled the way hands go in. */}
      {[-0.42, 0.42].map((theta) => (
        <Patch
          key={theta}
          theta={theta}
          y={-0.042}
          w={0.044}
          h={0.011}
          d={0.01}
          color="#3E472B"
          roughness={0.75}
          tilt={theta > 0 ? -0.6 : 0.6}
        />
      ))}
    </>
  );
}

/**
 * Draws one torso garment.
 *
 * Memoised: none of this animates, so it should not be rebuilt every time some unrelated bit of
 * avatar state changes.
 */
export const OutfitModel = memo(function OutfitModel({ type }: { type: OutfitType }) {
  switch (type) {
    case 'surf':
      return <SurfSuit />;
    case 'diving':
      return <DiveSuit />;
    case 'explorer':
      return <ExplorerSuit />;
    case 'captain':
      return <CaptainUniform />;
    case 'vest':
      return <AdventureVest />;
    case 'shawl':
      return <IslandShawl />;
    case 'jacket':
      return <FlightJacket />;
    default:
      return null;
  }
});

/**
 * Each garment's main shell colour. The torso capsule underneath and the sleeve capsules on the
 * arms both take it, so a sleeve can never drift from the body it hangs off.
 */
export const OUTFIT_SHELL_COLOR: Record<OutfitType, string> = {
  surf: '#27272A',
  diving: '#18181B',
  explorer: '#FEF3C7',
  captain: '#0F172A',
  vest: '#78716C',
  shawl: '#FB7185',
  jacket: '#6E7C4F',
};

/**
 * Whether the garment puts anything on the upper arm. Tracked separately from the colour rather
 * than as a null shell, because the torso still needs a colour for a garment that has no
 * sleeves - the vest is stone-coloured, it just does not have arms.
 */
export const OUTFIT_HAS_SLEEVES: Record<OutfitType, boolean> = {
  surf: true,
  diving: true,
  explorer: true,
  captain: true,
  vest: false,
  shawl: true,
  jacket: true,
};

/** Knitted cuff at the end of a flight-jacket sleeve. Rendered inside the arm groups. */
export const JacketCuff = memo(function JacketCuff() {
  return (
    <mesh position={[0, -0.058, 0]}>
      <cylinderGeometry args={[0.052, 0.05, 0.026, 14]} />
      <meshStandardMaterial color="#4B5535" roughness={0.85} />
    </mesh>
  );
});
