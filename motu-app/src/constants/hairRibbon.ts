/**
 * A hair BUNDLE as a swept ribbon, rather than as a stack of rods.
 *
 * ============================================================================
 * WHY A NEW PRIMITIVE AT ALL
 * ============================================================================
 *
 * Everything hanging off the head in constants/hair.ts is built from three.js
 * primitives - a cone for the curtain, capsules and cylinders for the locks. That
 * choice is what every complaint about the back of the head has actually been
 * about, and no amount of tuning could reach it:
 *
 *   1. A CONE IS A SKIRT. The curtain is one cone around the whole head, so the
 *      silhouette it draws is a tube. Real hair falling to the shoulders is not a
 *      surface of revolution - it parts, it gathers, it has a heavier side.
 *   2. A ROD IS A ROD. A lock is a capsule or a tapered cylinder, so it reads as a
 *      rod at every width. Thin, a set of them is a comb; thick, a set of them is
 *      a collar of fins. Both readings were reached experimentally, from opposite
 *      directions, and neither is hair.
 *   3. NOTHING RUNS ROOT TO TIP. A wave is emitted as a CHAIN of capsules, so the
 *      one thing a bundle of hair must do - leave the scalp and stay one object all
 *      the way to its end - was the one thing the geometry could not express.
 *
 * So this file adds the missing primitive: a flattened tube swept along a curve.
 * A bundle roots ON the skull surface, hugs it while it is still on the head, then
 * leaves it tangentially and falls to the nape - one continuous surface, with a
 * width that swells and then gathers to a soft point.
 *
 * ============================================================================
 * WHY A FLATTENED TUBE AND NOT A FLAT CARD
 * ============================================================================
 *
 * The obvious way to draw a hair bundle is a ribbon of zero thickness - a hair
 * card, as a game would texture it. Untextured, in a chibi renderer, that is a
 * paper edge: it vanishes at grazing angles and shows its own back face from the
 * other side, which is the 「懸浮、斷裂」 this is supposed to remove.
 *
 * The cross-section here is therefore a CLOSED ellipse - wide across the head,
 * shallow through it - so a bundle is a solid with a silhouette from every angle
 * and no interior to see into, while still reading as a broad sheet rather than as
 * a rod. Width and thickness are independent, which is exactly the axis the
 * primitives lacked: a capsule's only knob makes it fatter in both directions at
 * once.
 *
 * ============================================================================
 * PURE ARITHMETIC, ON PURPOSE
 * ============================================================================
 *
 * This file imports nothing. It returns vertex positions and the renderer uploads
 * them, exactly as `scalpVertex` does for the scalp shell - which is what lets
 * `npm run audit:hair` measure what is actually drawn without a renderer, and what
 * keeps the drawn mesh and the audited layout the same object seen twice.
 */

export type Vec3 = [number, number, number];

export interface RibbonInput {
  /** Azimuth of the bundle's centre line. 0 faces +Z (the face). */
  yaw: number;
  /** Polar angle on the shell where the bundle roots, from the crown. */
  rootTheta: number;
  /** Polar angle at which it stops hugging the shell and begins to fall. */
  leaveTheta: number;
  /** The shell it is fitted to. */
  shellRadius: number;
  shellOriginY: number;
  /** Where the tip ends up. */
  bottomY: number;
  /** Radius the tip settles to - smaller than the shell's pulls it toward the body. */
  hemRadius: number;
  /** Half-width, in metres of arc, at the bundle's widest. */
  halfWidth: number;
  /** How far the bundle stands off its own surface - its depth through the head. */
  thickness: number;
  /** Extra standoff, so an outer layer sits clear of the one behind it. */
  standoff?: number;
  /** S-curve down the fall. */
  waves?: number;
  waveDepth?: number;
  /** Phase for this bundle's own wave, so neighbours disagree. */
  phase?: number;
  /**
   * Width at the very tip, as a fraction of the widest. Defaults to {@link HEM_TIP}.
   *
   * A HEM must not come to a point - nine points is the jellyfish this file's own
   * comment on `widthAt` is about. A SPIKE is the one piece that must: it is a
   * bundle gathered to a tip on purpose, and drawing it with a hem's ending gives a
   * flat-ended paddle. Same sweep, opposite ending, so it is a parameter.
   */
  tipWidth?: number;
}

/** Stations down the sweep. Enough that the fall reads as a curve, not a chain. */
export const RIBBON_STATIONS = 26;
/** Points around the cross-section. Closed, so the last wraps onto the first. */
export const RIBBON_AROUND = 10;

/**
 * Where the bundle is wide.
 *
 * Narrow where it leaves the scalp (hair gathers at the root and the bundles have
 * to sit side by side up there without piling into each other), widest through the
 * middle where the mass is, then gathering to a soft point. The taper is the
 * 髮尾自然收束: it never reaches zero, because a bundle that closes to a true point
 * makes a spike, and spikes are what the icicles were.
 */
export const HEM_TIP = 0.62;

function widthAt(u: number, tipWidth: number): number {
  if (u < 0.28) return 0.52 + 0.48 * (u / 0.28);
  const v = (u - 0.28) / 0.72;
  // Taper to 0.62, NOT to a point. At 0.18 - the obvious reading of 收束 - each
  // bundle narrowed faster than its neighbours closed in, so the hem opened into a
  // row of tapered fingers with daylight between them: a jellyfish, which is the
  // same 「破碎、分離」 defect the rods had, reached from the opposite direction.
  // A hem gathers, it does not come to nine points.
  return 1 - (1 - tipWidth) * v * v;
}

/**
 * One bundle's centre line, and the flattened tube swept along it.
 *
 * `u` runs 0 at the root to 1 at the tip. The first stretch is ON the shell - the
 * bundle is part of the head there, which is what stops a gap opening at the
 * hairline - and it leaves tangentially rather than at an angle, so there is no
 * crease where the two meet.
 */
export function buildRibbon(input: RibbonInput): {
  positions: Vec3[];
  uvs: [number, number][];
} {
  const {
    yaw, rootTheta, leaveTheta, shellRadius, shellOriginY, bottomY, hemRadius,
    halfWidth, thickness, standoff = 0, waves = 0, waveDepth = 0, phase = 0,
    tipWidth = HEM_TIP,
  } = input;

  // Where the shell hands over. Everything below this is a free fall.
  const leaveY = shellOriginY + shellRadius * Math.cos(leaveTheta);
  const leaveR = shellRadius * Math.sin(leaveTheta) + standoff;
  /**
   * How much of the sweep is spent on the head.
   *
   * Proportional to how far the bundle actually has to travel on each side, so a
   * short style (whose fall is barely longer than its scalp run) does not spend
   * twenty of its twenty-six stations on the skull and then jump to the tip.
   */
  const onHead = Math.abs(leaveTheta - rootTheta) * shellRadius;
  /**
   * Signed, so a bundle can rise as well as fall.
   *
   * A spiked style is the same sweep read the other way up: the bundle roots LOW at
   * the temple, runs up over the skull, and leaves the surface still climbing.
   * Forcing this positive - which is all that stopped it before - meant the only
   * hair the file could express was hair that hangs, and spikes had to be separate
   * cones stuck on a smooth cap because of it.
   */
  const drop = leaveY - bottomY;
  // Capped at 0.78 rather than 0.55. A SHORT cut is mostly scalp run and barely any
  // fall - 短髮's bundles travel 36cm over the skull and then drop 9 - so a cap tuned
  // for long hair spent nearly half the stations on that 9cm and left the long run
  // over the skull described by a handful of segments. That is a faceted shell, and
  // a faceted shell under a smooth scalp dome is the 「生硬拼接」 seam.
  const attach = Math.max(0.12, Math.min(0.78, onHead / (onHead + Math.abs(drop) + 1e-6)));

  const positions: Vec3[] = [];
  const uvs: [number, number][] = [];

  for (let s = 0; s <= RIBBON_STATIONS; s++) {
    const u = s / RIBBON_STATIONS;

    let cy: number;
    let cr: number;
    if (u <= attach) {
      // On the skull: walk the shell from the root down to where it lets go.
      const theta = rootTheta + (leaveTheta - rootTheta) * (u / attach);
      cy = shellOriginY + shellRadius * Math.cos(theta);
      cr = shellRadius * Math.sin(theta) + standoff;
    } else {
      const v = (u - attach) / (1 - attach);
      cy = leaveY - drop * v;
      // Eased rather than linear so the bundle leaves the skull along the shell's
      // own tangent and only then curves in toward the body - a straight line from
      // the last shell point is a visible kink at the changeover.
      const ease = v * v * (3 - 2 * v);
      cr = leaveR + (hemRadius - leaveR) * ease;
      if (waves > 0 && waveDepth > 0) {
        // The S. Grows toward the tip, where a wave in real hair is deepest, and
        // rides ON the radius so it swings out and back through the fall rather
        // than displacing the whole bundle sideways.
        cr += Math.sin(v * Math.PI * waves + phase) * waveDepth * v;
      }
    }

    const w = halfWidth * widthAt(u, tipWidth);
    const t = thickness * (0.55 + 0.45 * widthAt(u, tipWidth));
    // Arc half-width converted to an azimuth at this station's own radius, so a
    // bundle keeps its WIDTH as it falls instead of fanning out with the radius.
    const dYaw = w / Math.max(0.02, cr);

    for (let k = 0; k < RIBBON_AROUND; k++) {
      const phi = (k / RIBBON_AROUND) * Math.PI * 2;
      const az = yaw + dYaw * Math.cos(phi);
      const r = cr + t * Math.sin(phi);
      positions.push([Math.sin(az) * r, cy, Math.cos(az) * r]);
      // v = 1 at the root so the shading's `1 - uv.y` comes out 0 there, matching
      // every other hanging piece. u is unused (these never ask for `breakup`).
      uvs.push([k / RIBBON_AROUND, 1 - u]);
    }
  }

  return { positions, uvs };
}

/**
 * Triangle indices for the grid `buildRibbon` returns.
 *
 * Shared rather than rebuilt per bundle: every ribbon has the same topology, so
 * this is one buffer the whole shop can point at.
 */
export function ribbonIndices(): number[] {
  const index: number[] = [];
  for (let s = 0; s < RIBBON_STATIONS; s++) {
    for (let k = 0; k < RIBBON_AROUND; k++) {
      // The cross-section is a closed loop, so the last column wraps onto the
      // first rather than onto a copy of it - a copy is two vertices in one place
      // averaging only their own side into a normal, i.e. a lit seam down the
      // length of every bundle.
      const a = s * RIBBON_AROUND + k;
      const b = s * RIBBON_AROUND + ((k + 1) % RIBBON_AROUND);
      const c = a + RIBBON_AROUND;
      const d = b + RIBBON_AROUND;
      index.push(a, c, b, b, c, d);
    }
  }
  return index;
}
