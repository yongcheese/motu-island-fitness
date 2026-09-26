/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { memo, useMemo } from 'react';
import * as THREE from 'three';
import {
  PantsCut,
  PANTS_PALETTES,
  SILHOUETTES,
  DENIM_RIVET,
  DENIM_TURNUP,
  PantsSilhouette,
} from '../../constants/pants';
import { LEGACY_WEARABLE_FIT } from '../../constants/characterRig';

/**
 * Q-version trousers for the avatar.
 *
 * This is the same story `Shoes.tsx` opens with, and the trousers were further behind than the
 * shoes ever were: there was no trouser model at all. "Wearing" a pair tinted the bare leg
 * capsule one flat colour and stopped there - so six garments that the shop draws with pleats,
 * cargo pockets, turn-ups, rivets, drawstrings and ankle zips all arrived on the body as the
 * same smooth monotone tube, in the wrong colour (see constants/pants.ts for that half of it).
 * Six products, one appearance.
 *
 * What a trouser needs to stop reading as a painted leg, in the order it matters:
 *
 *   SILHOUETTE. A wide leg and a skinny leg are not the same shape in different colours. Each
 *   cut is lathed from its own profile, so 寬褲 opens out below the knee, 錐形 closes to the
 *   ankle, 窄管 follows the leg down. This is the read at any distance, before any detail.
 *
 *   CREASES THAT ARE ACTUALLY THERE. The folds are displaced into the geometry rather than
 *   painted on, so they catch the scene's own light and move with the leg. Painted-only creases
 *   go flat the moment the avatar turns, which is exactly the "單一顏色" complaint in a
 *   different form. Amplitude is driven by each cut's `drape`: loose cloth folds, cloth
 *   stretched over a leg does not, so 窄管 stays nearly smooth and 寬褲 ripples.
 *
 *   A GRADIENT. `fabricTexture` supplies a greyscale shading map - lighter at the hip where
 *   light lands, deeper at the hem, with soft bunching at the ankle and knee and a seam down
 *   each side. It is greyscale and multiplied by the material's own colour, so one generator
 *   serves all seven palettes and no colour is written down twice.
 *
 *   HARDWARE. The one part per cut that names it: cargo's thigh pockets, denim's turn-up and
 *   copper rivets, 寬褲's drawstring, 窄管's ankle zip, 錐形's turn-up, 直筒's belt loops.
 *
 * LOCAL SPACE - authored in the LEG group's own space, the same space `soleAnchorY` is written
 * in, because that is where the component mounts:
 *
 *   y = 0    the hip pivot. The bare leg capsule's top cap is at y = +0.025.
 *   y = ground = -0.225 - legLengthen, the sole. Derived, never typed - see `groundY`.
 *   x = side * r   the OUTER face of the leg (side is -1 for the left leg, +1 for the right),
 *                  which is where a side pocket or an ankle zip belongs.
 *   z > 0    forward. The fly and drawstring live here, the seat and back pockets at z < 0.
 *
 * The bare capsule is NOT removed when trousers are on - it stays as the lining, so a crease
 * that displaces inward can never open a hole onto the skin. That is also why every radius here
 * is clamped to stay outside MIN_CLEARANCE.
 */

/**
 * Nothing may sit closer to the leg than this, or the capsule pokes through the cloth.
 *
 * 2.5 mm outside the legacy leg capsule's own 0.055, and READ from the rig rather than typed
 * here: a model whose leg is thicker than legacy's brings these trousers in at its own size
 * through `attachments.leg`, and the audit checks that it did using this same number. Two
 * copies of it would let the check pass while the leg came through.
 */
const MIN_CLEARANCE = LEGACY_WEARABLE_FIT.trouserFloor;

/** The sole, in leg-local space. Same derivation as `soleAnchorY` in Shoes.tsx. */
const groundY = (legLengthen: number) => -0.225 - legLengthen;

/**
 * The waistband's top. Above the legacy capsule's own top cap (+0.025) so the seam is covered.
 *
 * Read from the rig rather than typed here: everything ABOVE this line is the TOP garment's to
 * cover, so the two wearables meet at it and both sides have to agree on where it is. See
 * LEGACY_WEARABLE_FIT.
 */
const WAIST_Y = LEGACY_WEARABLE_FIT.trouserWaistY;

/**
 * Where the hem lands.
 *
 * Boots are the reason this is a function. Their shaft and folded cuff reach 0.164 above the
 * sole and flare to radius 0.07 (see BootShoe in Shoes.tsx), so a full-length hem does not just
 * touch them - a wide leg at 0.108 would pass straight through the boot and hang inside it.
 * With boots on, the hem stops above the cuff instead, which reads as tucked in.
 */
const hemY = (legLengthen: number, overBoots: boolean) =>
  groundY(legLengthen) + (overBoots ? 0.175 : 0.03);

/** The knee, as a constant fraction of whatever leg length the hem left available. */
const kneeY = (hem: number) => WAIST_Y - (WAIST_Y - hem) * 0.52;

/** Straight-line radius of the cut at a height, for placing hardware ON the surface. */
function radiusAt(s: PantsSilhouette, hem: number, knee: number, y: number): number {
  const r =
    y >= knee
      ? THREE.MathUtils.lerp(s.knee, s.hip, THREE.MathUtils.clamp((y - knee) / (WAIST_Y - knee), 0, 1))
      : THREE.MathUtils.lerp(s.hem, s.knee, THREE.MathUtils.clamp((y - hem) / (knee - hem), 0, 1));
  return Math.max(r, MIN_CLEARANCE);
}

/* --------------------------------------------------------------------------------------------
   FABRIC
   -------------------------------------------------------------------------------------------- */

const textureCache = new Map<PantsCut, THREE.CanvasTexture>();

/** Fixed pseudo-random. The creases must look hand-fallen but be the SAME ones every session. */
function noise(i: number, salt: number): number {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * The shading map: a vertical gradient, soft crease bands, and the two side seams.
 *
 * Greyscale on purpose. `meshStandardMaterial` multiplies map by colour, so white leaves the
 * palette untouched and everything drawn here darkens it - which means this one canvas shades
 * all seven cuts and the colours stay in constants/pants.ts where they belong.
 *
 * Canvas row 0 is v = 1 (three flips textures by default), i.e. the WAIST is the top of the
 * image and the hem is the bottom, which is the way round it is drawn below.
 */
function fabricTexture(cut: PantsCut): THREE.CanvasTexture {
  const cached = textureCache.get(cut);
  if (cached) return cached;

  const drape = SILHOUETTES[cut].drape;
  const W = 64;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Hip lit, hem deep. Without this every cut is one value from waist to ankle, which is what
  // made them read as painted tubes however good the silhouette was.
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.18, 'rgba(0,0,0,0.03)');
  grad.addColorStop(0.62, 'rgba(0,0,0,0.13)');
  grad.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Creases. Bunched where cloth actually gathers - just above the hem and across the knee -
  // and drawn as soft bands rather than lines, because a hard line reads as a printed stripe.
  const count = Math.round(7 + drape * 9);
  for (let i = 0; i < count; i++) {
    const pick = noise(i, 3);
    // 0.62..0.95 is the lower leg, 0.34..0.5 the knee; the rest scatter over the thigh.
    const v = pick < 0.5 ? 0.62 + noise(i, 4) * 0.33 : pick < 0.8 ? 0.34 + noise(i, 5) * 0.16 : noise(i, 6) * 0.3;
    const y = v * H;
    const h = 3 + noise(i, 7) * 9;
    const strength = (0.05 + noise(i, 8) * 0.09) * (0.45 + drape * 0.55);
    const band = ctx.createLinearGradient(0, y - h, 0, y + h);
    band.addColorStop(0, 'rgba(0,0,0,0)');
    band.addColorStop(0.5, `rgba(0,0,0,${strength.toFixed(3)})`);
    band.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = band;
    // Skewed so a crease is not a perfect ring around the leg - cloth gathers unevenly.
    const skew = (noise(i, 9) - 0.5) * 10;
    ctx.beginPath();
    ctx.moveTo(0, y - h + skew);
    ctx.lineTo(W, y - h - skew);
    ctx.lineTo(W, y + h - skew);
    ctx.lineTo(0, y + h + skew);
    ctx.closePath();
    ctx.fill();
  }

  // The two side seams, at u = 0.25 and 0.75, which is where the lathe puts the outer and
  // inner faces of the leg.
  for (const u of [0.25, 0.75]) {
    const seam = ctx.createLinearGradient(u * W - 3, 0, u * W + 3, 0);
    seam.addColorStop(0, 'rgba(0,0,0,0)');
    seam.addColorStop(0.5, 'rgba(0,0,0,0.14)');
    seam.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = seam;
    ctx.fillRect(u * W - 3, 0, 6, H);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(cut, tex);
  return tex;
}

/**
 * One trouser leg, lathed from the cut's profile and then creased.
 *
 * The creasing is the part worth reading. A lathe is a surface of revolution, so on its own it
 * is perfectly round at every height - which is a tube, not cloth. Displacing each vertex
 * radially by a sum of sines of its ANGLE breaks that roundness into folds that are genuinely
 * in the mesh, so they self-shade under the scene's lighting instead of relying on a painted
 * highlight that dies the moment the avatar turns.
 *
 * Every frequency is an integer multiple of the angle. That is not decorative: the lathe's first
 * and last vertex columns are the same seam at angle 0 and 2*PI, so a non-integer frequency
 * would displace them differently and split the garment open down its side.
 */
function buildLeg(s: PantsSilhouette, hem: number, knee: number, rise: number): THREE.LatheGeometry {
  const lerp = THREE.MathUtils.lerp;
  const span = WAIST_Y - hem;
  /** Height as a fraction of the leg's own span. `kneeY` puts the knee at 0.48. */
  const at = (f: number) => hem + f * span;

  // EVERY height here is a fraction, never a fixed offset. With boots on, the hem rides up to
  // clear the shaft and the whole leg is only ~0.10 long instead of ~0.25 - and fixed offsets
  // overran it, putting the calf point BELOW the hem point it was supposed to sit above. A
  // lathe profile that goes backwards in y folds the garment inside out, so this is not a
  // tuning detail: the same numbers have to hold for a full-length leg and a cropped one.
  //
  // Bottom to top, so v = 0 is the hem and v = 1 the waist, matching fabricTexture's canvas.
  const profile: THREE.Vector2[] = [
    // A short inward lip, so looking up at the hem shows a cuff rather than a raw open tube.
    new THREE.Vector2(Math.max(s.hem * 0.72, MIN_CLEARANCE), at(0.016)),
    new THREE.Vector2(s.hem, at(0.026)),
    new THREE.Vector2(s.hem * 0.995, at(0.12)),
    // Calf: a slight swell, so the lower leg is not a straight taper.
    new THREE.Vector2(lerp(s.hem, s.knee, 0.5) * 1.035, at(0.3)),
    new THREE.Vector2(s.knee, knee),
    new THREE.Vector2(lerp(s.knee, s.hip, 0.62), at(0.766)),
    new THREE.Vector2(s.hip, at(0.91)),
    new THREE.Vector2(s.hip * 0.97, WAIST_Y),
    // THE RISE: the trousers carried on up the part of the leg that is buried in the body.
    //
    // None of it is ever seen — it lives above the waistband, under the top garment. It is drawn
    // so that the leg is never bare ANYWHERE: without it the trousers stop at the waistband and
    // the top has to cover the thigh from there up, which it cannot do on a body whose thighs
    // are nearly as wide as its chest. A band of bare leg then shows right round the hips,
    // between hem and waistband.
    //
    // It narrows to hug the leg rather than carrying on at hip width, so it tucks INSIDE the top
    // instead of standing proud of it — a wide tube up here would move the seam rather than
    // close it. A rise of 0 (legacy, v2) appends nothing and the profile is unchanged.
    ...(rise > WAIST_Y ? [new THREE.Vector2(MIN_CLEARANCE, rise)] : []),
  ];

  const geo = new THREE.LatheGeometry(profile, 32);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-6) continue;

    const ang = Math.atan2(z, x);
    const t = THREE.MathUtils.clamp((y - hem) / span, 0, 1);
    // Cloth gathers at the ankle and breaks over the knee; the flat 0.3 keeps a little life
    // everywhere else so the thigh is not glassy next to them.
    const bunch =
      Math.exp(-(((t - 0.08) / 0.17) ** 2)) + 0.7 * Math.exp(-(((t - 0.42) / 0.15) ** 2)) + 0.3;
    const fold =
      0.55 * Math.sin(ang * 7) + 0.45 * Math.sin(ang * 4 + 1.7) + 0.22 * Math.sin(ang * 11 + y * 40);
    // Faded out at the very top and bottom, so the waistband and hem rings still meet a round
    // edge and do not show a wavy gap between themselves and the cloth.
    const ends = Math.min(1, t / 0.12) * Math.min(1, (1 - t) / 0.1);
    const amp = 0.0105 * s.drape * bunch * ends;

    const nr = Math.max(r + amp * fold, MIN_CLEARANCE);
    pos.setX(i, (x / r) * nr);
    pos.setZ(i, (z / r) * nr);
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/* --------------------------------------------------------------------------------------------
   PARTS
   -------------------------------------------------------------------------------------------- */

/** A band around the leg - waistband, turn-up, cinched hem. `y` is its CENTRE. */
function Band({
  y, rTop, rBot, h, color, roughness = 0.75,
}: {
  y: number; rTop: number; rBot: number; h: number; color: string; roughness?: number;
}) {
  return (
    <mesh position={[0, y, 0]} castShadow>
      <cylinderGeometry args={[rTop, rBot, h, 28]} />
      <meshStandardMaterial color={color} roughness={roughness} />
    </mesh>
  );
}

/** A line of topstitching running round the leg. */
function StitchRing({ y, r, color, tube = 0.0016 }: { y: number; r: number; color: string; tube?: number }) {
  return (
    <mesh position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[r, tube, 6, 28]} />
      <meshStandardMaterial color={color} roughness={0.6} />
    </mesh>
  );
}

/** A vertical seam on the outer face. The cuts taper by ~1 degree, so a straight bar suffices. */
function OuterSeam({
  side, x, yTop, yBot, color,
}: {
  side: number; x: number; yTop: number; yBot: number; color: string;
}) {
  return (
    <mesh position={[side * x, (yTop + yBot) / 2, 0]}>
      <boxGeometry args={[0.004, yTop - yBot, 0.011]} />
      <meshStandardMaterial color={color} roughness={0.65} />
    </mesh>
  );
}

/* --------------------------------------------------------------------------------------------
   THE SIX CUTS
   -------------------------------------------------------------------------------------------- */

interface DetailProps {
  s: PantsSilhouette;
  cut: PantsCut;
  side: number;
  hem: number;
  knee: number;
  /** Fraction of a full-length leg this one actually is - < 1 only when cropped over boots. */
  hw: number;
}

/**
 * The hardware. Placed in FRACTIONS of the leg's span for the same reason the profile is: over
 * boots the hem rides up and the leg is well under half its usual length, and fixed offsets put
 * the cargo pocket above the waistband. Sizes scale by `hw` too, so a cropped leg gets a pocket
 * in proportion to it rather than one sized for a leg twice as long.
 */
function Details({ s, cut, side, hem, knee, hw }: DetailProps) {
  const pal = PANTS_PALETTES[cut];
  const span = WAIST_Y - hem;
  const at = (f: number) => hem + f * span;
  const rAt = (y: number) => radiusAt(s, hem, knee, y);
  const hipR = rAt(at(0.92));
  const hemR = rAt(at(0.08));

  switch (cut) {
    // 錐形/蘿蔔褲: roomy pleated front closing to a turned-up ankle. The turn-up is the
    // giveaway detail the icon leads on, so it gets real depth here rather than a painted line.
    case 'tapered':
      return (
        <>
          <Band y={at(0.105)} rTop={hemR * 1.09} rBot={hemR * 1.07} h={0.03 * hw} color={pal.band} />
          <StitchRing y={at(0.17)} r={hemR * 1.085} color={pal.stitch} />
          {[-1, 1].map((sx) => (
            <mesh key={sx} position={[sx * hipR * 0.42, at(0.777), hipR * 0.8]}>
              <boxGeometry args={[0.005, 0.07 * hw, 0.012]} />
              <meshStandardMaterial color={pal.shade} roughness={0.8} />
            </mesh>
          ))}
        </>
      );

    // 日系寬褲: a soft pull-on trouser, so a DRAWSTRING rather than a belt - the same call the
    // icon makes, and the reason this cut has no pockets or hardware competing with its drape.
    case 'wide':
      return (
        <>
          {[-1, 1].map((sx) => (
            <mesh key={sx} position={[sx * 0.016, at(0.83), hipR * 0.94]} rotation={[0.12, 0, sx * 0.16]}>
              <capsuleGeometry args={[0.0035, 0.038 * hw, 3, 8]} />
              <meshStandardMaterial color={pal.stitch} roughness={0.85} />
            </mesh>
          ))}
          <mesh position={[0, at(0.935), hipR * 0.96]}>
            <sphereGeometry args={[0.009, 12, 10]} />
            <meshStandardMaterial color={pal.stitch} roughness={0.8} />
          </mesh>
          <StitchRing y={at(0.105)} r={hemR * 1.01} color={pal.band} tube={0.002} />
        </>
      );

    // 窄管/緊身: nothing loose to hang off it, so the detail is what proves the hem is too
    // narrow to get a foot through - an ankle zip - plus the seat pockets.
    case 'skinny':
      return (
        <>
          <mesh position={[side * hemR, at(0.182), 0.004]}>
            <boxGeometry args={[0.004, 0.05 * hw, 0.008]} />
            <meshStandardMaterial color={pal.stitch} roughness={0.5} metalness={0.35} />
          </mesh>
          <mesh position={[side * hemR, at(0.089), 0.004]}>
            <boxGeometry args={[0.006, 0.011, 0.011]} />
            <meshStandardMaterial color={pal.stitch} roughness={0.35} metalness={0.55} />
          </mesh>
          <mesh position={[0, at(0.797), -hipR]}>
            <boxGeometry args={[0.042, 0.036 * hw, 0.004]} />
            <meshStandardMaterial color={pal.shade} roughness={0.8} />
          </mesh>
          <StitchRing y={at(0.065)} r={hemR * 1.005} color={pal.stitch} />
        </>
      );

    // 機能工裝: the thigh pockets ARE the garment (多口袋設計). They sit proud of the leg with
    // their own flap and button, on the OUTER face of each leg, which is why this component
    // needs to know which leg it is on.
    case 'cargo': {
      const pocketY = at(0.703);
      const pr = rAt(pocketY);
      const ph = 0.062 * hw;
      return (
        <>
          <mesh position={[side * (pr + 0.008), pocketY, 0.004]} castShadow>
            <boxGeometry args={[0.019, ph, 0.058]} />
            <meshStandardMaterial color={pal.shade} roughness={0.85} />
          </mesh>
          <mesh position={[side * (pr + 0.009), pocketY + ph * 0.53, 0.004]} castShadow>
            <boxGeometry args={[0.022, 0.013, 0.062]} />
            <meshStandardMaterial color={pal.band} roughness={0.8} />
          </mesh>
          <mesh position={[side * (pr + 0.02), pocketY + ph * 0.42, 0.004]}>
            <sphereGeometry args={[0.005, 10, 8]} />
            <meshStandardMaterial color={pal.stitch} roughness={0.45} metalness={0.3} />
          </mesh>
          {/* Reinforced knee and the cinched hem the icon draws. */}
          <StitchRing y={knee} r={rAt(knee) * 1.006} color={pal.stitch} />
          <Band y={at(0.089)} rTop={hemR * 0.99} rBot={hemR * 1.03} h={0.026 * hw} color={pal.band} />
        </>
      );
    }

    // 牛仔: the five-pocket hardware the garment was patented around - copper rivets, orange
    // topstitching - over a turn-up showing the pale inside of the cloth.
    case 'denim':
      return (
        <>
          <Band y={at(0.113)} rTop={hemR * 1.07} rBot={hemR * 1.05} h={0.034 * hw} color={DENIM_TURNUP} />
          <StitchRing y={at(0.186)} r={hemR * 1.065} color={pal.stitch} />
          <OuterSeam side={side} x={rAt(knee) + 0.0015} yTop={at(0.561)} yBot={at(0.182)} color={pal.stitch} />
          {[-1, 1].map((sx) => (
            <mesh key={sx} position={[sx * hipR * 0.72, at(0.854), hipR * 0.66]}>
              <sphereGeometry args={[0.0055, 10, 8]} />
              <meshStandardMaterial color={DENIM_RIVET} roughness={0.4} metalness={0.55} />
            </mesh>
          ))}
          {/* The red tab on the seat: a colour note, nothing more, exactly as in the icon. */}
          <mesh position={[side * hipR * 0.5, at(0.797), -hipR * 0.86]}>
            <boxGeometry args={[0.012, 0.009, 0.004]} />
            <meshStandardMaterial color="#C0392B" roughness={0.7} />
          </mesh>
        </>
      );

    // 直筒褲 and the plain fallback: the five-pocket basic the others are variations on.
    default:
      return (
        <>
          {cut === 'straight' &&
            [-1, 1].map((sx) => (
              <mesh key={sx} position={[sx * hipR * 0.66, at(0.935), hipR * 0.62]}>
                <boxGeometry args={[0.009, 0.022, 0.005]} />
                <meshStandardMaterial color={pal.band} roughness={0.8} />
              </mesh>
            ))}
          <OuterSeam side={side} x={rAt(knee) + 0.0015} yTop={at(0.602)} yBot={at(0.081)} color={pal.stitch} />
          <StitchRing y={at(0.073)} r={hemR * 1.005} color={pal.stitch} />
        </>
      );
  }
}

/**
 * The trousers for ONE leg. Mounts inside that leg's hip-pivot group, so it swings with the leg
 * for free and needs no animation of its own.
 */
export const PantsModel = memo(function PantsModel({
  cut,
  side,
  legLengthen,
  overBoots,
  rise = 0,
}: {
  cut: PantsCut;
  /** -1 for the left leg, +1 for the right. Puts side pockets and zips on the OUTER face. */
  side: number;
  legLengthen: number;
  /** Boots reach far up the calf; the hem stops above them instead of passing through. */
  overBoots: boolean;
  /**
   * How far up the leg to carry the trousers past the waistband, LEG-LOCAL — the model's answer
   * to how much of its leg is buried inside its body. See the RISE note in buildLeg.
   *
   * 0 (the default) is legacy's behaviour: the trousers stop at the waistband, which is right
   * for a body whose top garment can cover the hip on its own.
   */
  rise?: number;
}) {
  const s = SILHOUETTES[cut];
  const pal = PANTS_PALETTES[cut];
  const hem = hemY(legLengthen, overBoots);
  const knee = kneeY(hem);
  // How much leg this cut actually got. 1 normally; ~0.4 when the hem is lifted over boots.
  // Derived from the same functions rather than typed, so it stays right if either moves.
  const hw = THREE.MathUtils.clamp((WAIST_Y - hem) / (WAIST_Y - hemY(legLengthen, false)), 0.55, 1);

  const geometry = useMemo(() => buildLeg(s, hem, knee, rise), [s, hem, knee, rise]);
  const texture = useMemo(() => fabricTexture(cut), [cut]);

  return (
    <group>
      <mesh castShadow receiveShadow>
        <primitive object={geometry} attach="geometry" />
        {/* DoubleSide because a lathe is an open tube: without it the inside of a wide leg
            disappears when the camera can see up under the hem. */}
        <meshStandardMaterial color={pal.body} map={texture} roughness={0.88} side={THREE.DoubleSide} />
      </mesh>
      {/* Waistband, on every cut - it is what closes the top of the tube off against the torso. */}
      <Band y={WAIST_Y - 0.014} rTop={s.hip * 1.02} rBot={s.hip * 1.04} h={0.03} color={pal.band} />
      <Details s={s} cut={cut} side={side} hem={hem} knee={knee} hw={hw} />
    </group>
  );
});
