// Single source of truth for every hairstyle: the 3D avatar mesh and the 2D shop
// thumbnail are both generated from these specs, so a preview can never drift from
// the model the player actually gets.
//
// This project builds all avatar geometry from three.js primitives in code - there
// are no GLTF/GLB hair assets (see docs/z-fighting.md), so a "hair asset" here is a
// declarative parameter set rather than a mesh file. Adding a hairstyle means adding
// one entry to HAIR_SPECS; the renderer and the icon pick it up with no other edits.
//
// ============================================================================
// WHY THE PLACEMENT IS DERIVED AND NOT AUTHORED
// ============================================================================
//
// Every hairstyle used to swallow the face and hang down over the chest, belly and
// legs. It was not five separate modelling mistakes - it was one missing concept.
// A style declared raw head-local offsets (`fall.y = -0.28`, `cap.radius = 0.28`,
// `curls.ring = 0.286`) that referred to nothing. Nothing in the code knew where the
// skull ended, where the eyes were, or how far down a lock was allowed to fall, so
// there was no rule for a number to be wrong against. Three consequences followed
// for every style at once:
//
//   1. FACE. The scalp dome was a FULL sphere of radius 0.28 swept 112.5 degrees
//      down from the crown. The avatar's eyes are mounted only 0.248 from that
//      dome's centre, so the dome enclosed them with 0.004 protruding - the face
//      was inside the hair.
//   2. FACE AGAIN. The "curtain" used `openEnded: true`, which removes a cylinder's
//      END CAPS - it does not open it up at the front. thetaLength defaulted to a
//      full turn, so the curtain was a closed tube passing straight across the nose.
//   3. BODY. `fall` bottomed out at avatar y=0.045 and the back locks at y=0.020,
//      on a character whose feet are at y=0 and whose torso spans 0.185..0.535.
//      The hair reached the ankles because no rule said it could not.
//
// So the fix is not new offsets. It is HEAD_ANCHOR + HAIR_ENVELOPE below: one
// skull-relative attachment frame that every piece is fitted to, and one hard
// envelope every emitted piece is clamped into. A HairSpec now declares only
// LENGTHS - how long the curtain is, how far the bangs hang - never positions.
// Positions are computed by `buildHairLayout`. A new hairstyle physically cannot
// land on the face or the chest, because it never gets to say where it goes.
//
// `npm run audit:hair` re-derives every style and fails on any envelope breach.

import { LEGACY_SKELETON } from './characterRig';
import { RIBBON_AROUND, RIBBON_STATIONS, buildRibbon } from './hairRibbon';

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ============================================================================
// HEAD ANCHOR - the attachment frame. All values are head-local: the origin is
// the centre of the avatar's head sphere in Avatar.tsx, +Z points out of the
// face, +Y is up. HairPiece mounts at exactly this origin with no transform of
// its own, so these numbers mean the same thing at author time and render time.
// ============================================================================
export const HEAD_ANCHOR = {
  /**
   * The skull's half-width, READ from the rig rather than restated here.
   *
   * It used to be the literal 0.26 with a comment pointing at the sphere Avatar.tsx drew,
   * which made this file one of the places that had to be found and edited by hand when the
   * head changed. A model now declares its own `head.halfWidth` and this follows it — see
   * constants/characterRig.ts.
   *
   * NOTE this is deliberately LEGACY's, not the active model's: the whole layout engine
   * below is fitted to a SPHERE, and every landmark under it (hairline, ear line, face arc)
   * was measured on that sphere. Pointing it at a different model's number would scale the
   * radius without re-deriving the landmarks, which is worse than being honestly legacy-only.
   * Refitting hair to a new head means revisiting the landmarks too — until then a model
   * that is not sphere-headed mounts hair through its `hair` socket's `scale`.
   */
  radius: LEGACY_SKELETON.head.halfWidth,
  /** How far the hair shell floats off the skull. Must be > 0 or the two z-fight. */
  shell: 0.02,
  /** The scalp dome's own centre, lifted so the shell clears the crown evenly. */
  originY: 0.026,

  // --- Landmarks measured off the face Avatar.tsx actually draws ---
  /** Eye spheres sit at y=0.035, r=0.036, so the eyes top out here. */
  eyeTopY: 0.071,
  /** Hairline: where the scalp dome hands over to the bangs across the forehead. */
  hairlineY: 0.21,
  /** Bangs may graze the eyelids and stop. Nothing frontal goes below this. */
  faceClearY: 0.075,
  /** How far the side/back dome comes down - past the temples and the ears. */
  earY: -0.081,

  /**
   * Half-width of the face window the HANGING pieces open, measured from +Z.
   *
   * Sized off the widest thing that must stay visible: the blush spheres reach
   * x=0.178, and at 56deg the curtain passes at x=0.236 - outside the cheeks rather
   * than across them. The bangs, the curtain and the face-framing locks all gate on
   * this.
   *
   * The SCALP no longer does. A window is a straight cut at a fixed azimuth, which is
   * exactly the wall that used to stand across every temple; the shell solves its own
   * hairline against HAIR_ENVELOPE instead - see {@link HairScalpPart}. This stayed at
   * 56 because the pieces that still use it are hanging hair, and where a curtain opens
   * really is one angle.
   */
  faceHalfArc: 56 * DEG,
} as const;

/** Radius of the hair shell - the surface every piece is fitted to. */
export const HAIR_SHELL_RADIUS = HEAD_ANCHOR.radius + HEAD_ANCHOR.shell;

// ============================================================================
// HAIR ENVELOPE - the hard limits. Nothing a HairSpec says can push a piece
// outside this box; `buildHairLayout` clamps rather than trusts.
// ============================================================================
export const HAIR_ENVELOPE = {
  /**
   * Lowest point any hair may reach, head-local. The avatar's head sits at
   * y=0.68, so this is avatar y=0.30: mid-back. The torso spans 0.185..0.535 and
   * the legs start at 0.22, so hair stops clear of the waist and the lower body,
   * and the face window keeps the chest front open.
   *
   * -0.38, from -0.30. 黑長直 was hemmed by this rather than by its own spec —
   * a "long straight" style that stopped at the top of the shoulder blades reads
   * as mid-length, which is what 「黑長直請幫我做長一點」 was about. Mid-back is
   * where the cut actually falls on a person, and it is still 0.08 above the
   * waist, so the styles that hang (and SWAY, which needs somewhere to swing
   * without clipping the arms) have not been let out to the legs.
   */
  minY: -0.38,
  /** Headroom for an upright crest. */
  maxY: 0.52,
  /** Widest silhouette, measured from the head's vertical axis. */
  maxRadius: 0.4,
  /**
   * The corridor in front of the face that must stay empty below `faceClearY`.
   *
   * Stated as a box in real units rather than as an angle, because the angle is
   * the fix and the box is the requirement: what matters is that nothing passes
   * in front of the eyes (|x| <= 0.140) or the cheeks (|x| <= 0.178), whatever
   * primitive it is made of.
   */
  faceClearY: HEAD_ANCHOR.faceClearY,
  faceClearHalfWidth: 0.2,
  faceClearMinZ: 0.1,
} as const;

/** How far a hat pushes the bangs down. One rule, not a per-style field. */
const HAT_FRINGE_DROP = 0.025;
/**
 * THE FRINGE UNDER A HAT is a sheet, not a row of rods.
 *
 * Bare, a bang is a tapered rod 2-3cm in radius hanging 13cm from the hairline, and a row of
 * them reads as a fringe. Under a hat the only forehead left is the strip between the hat
 * line (~0.10) and the top of the eyes (0.075 floor) - 2.5cm, i.e. about ONE rod radius.
 * A rod drawn in that strip is its own end cap and nothing else: whatever was tried, what
 * showed was a row of beads along the brim, or nothing at all, and the fringe read as
 * 「戴著帽子，部分頭髮會消失」. Rooted higher so they had some length, the rods came through
 * the cuff instead, because the 毛帽's cuff is a straight cylinder only 12mm off the skull.
 *
 * What anime draws is the fringe the hat has pushed flat: clumps of hair that come out from
 * under the brim, lie ON the brow and end in points. So under a hat each bang is one thin
 * swept sheet (constants/hairRibbon.ts, the same primitive as the back), rooted inside the
 * hat, pressed onto the skull above the hat line, released within {@link FRINGE_HAT_RELEASE}
 * below it and laid a few millimetres off the forehead down to its tip.
 */
/** How far above its hat line a sheet roots - inside the hat, where it is pressed flat. */
const FRINGE_SHEET_TUCK = 0.02;
/** Standoff of the sheet's bed off HEAD_ANCHOR.radius. The cuff leaves ~1cm at the line. */
const FRINGE_SHEET_STANDOFF = 0.002;
/** Half-depth of the sheet. Thin on purpose: a thick one is a rod again. */
const FRINGE_SHEET_THICKNESS = 0.005;
/** How far the tips lift off the brow - hair a hat has pushed down splays at the ends. */
const FRINGE_SHEET_LIFT = 0.006;
/** Tip width as a fraction of the widest: the pointed clump an anime fringe is drawn in. */
const FRINGE_SHEET_TIP = 0.3;
/** Point-cut variation of the tips, so the hem under the brim is not one ruled line. */
const FRINGE_SHEET_TIP_JITTER = 0.01;
/** The least of a sheet that must show below its hat line for it to be worth drawing. */
const FRINGE_SHEET_MIN_SHOW = 0.015;
/** How far under its hat line a bang takes to come back off the skull. */
const FRINGE_HAT_RELEASE = 0.012;

/** Where the curtain and the hanging locks start, just under the dome's rim. */
const HANG_TOP_Y = -0.02;

// ============================================================================
// HAIR UNDER A HAT - one rule, applied to the scalp shell.
//
// A hat used to DELETE the shell (`cap && !underHat`), and that one line is both
// of the defects players reported:
//
//   1. 「短髮戴上帽子就完全看不到頭髮」. On the styles that are nothing BUT a shell -
//      吋頭 is exactly that, 渣男燙 is a shell plus bundles - deleting it left an
//      empty group. The avatar was wearing a hat on a bald head, and no camera
//      angle could tell you the player owned a hairstyle at all.
//   2. 「長髮和帽子的連接處像被切斷」. The hanging pieces start at HANG_TOP_Y (-0.02)
//      and the lowest ring of a hat sits at about +0.10, so with the shell gone
//      there was a 12cm band of BARE SKULL between the two. The curtain's top rim
//      hung in that gap with nothing above it - hair sliced off at the hatline,
//      which is precisely what "被切斷" describes.
//
// Both are the same missing idea: a hat does not remove hair, it FLATTENS it. So
// the shell is no longer deleted. It is squeezed onto the skull where the hat
// covers it, and let back out to the style's own volume over the few centimetres
// below the hat's own rim - which is where hair really does spring back out.
//
// WHY THE SQUEEZE IS SAFE, rather than tuned per hat. Every hat in wardrobe.tsx is
// fitted OUTSIDE the skull sphere (`bandRadiusAt` = the skull's own cross-section
// plus 12mm, and every crown sits above a band that does). The nearest any hat's
// inner surface comes to the head's centre is about 0.271. Pressed hair is held at
// {@link HAT_PRESSED_RADIUS} = 0.257, INSIDE the skull, so it cannot poke through a
// hat that has not been built inside the player's head - and the skull itself hides
// the pressed band's top edge. That is a property of the fitting rule, not five
// numbers that have to be re-measured whenever a hat is re-modelled.
// ============================================================================

/**
 * The lowest ring of a hat's own coverage, head-local: below this line the hat has
 * stopped hiding the skull and hair has to be there instead.
 *
 * A plane rather than a height, because 貝雷帽 is worn TILTED - its band bottom
 * swings between y 0.038 and 0.187 round the head - and a flat hairline under a
 * tilted beret is a bald crescent on the high side. `leanX`/`leanZ` are that tilt,
 * expressed the same way everything else in this file expresses a yaw-dependent
 * height: a constant plus one sine and one cosine.
 */
export interface HatBrim {
  /** Height of the line at the sides and the front-back midline. */
  y: number;
  /** How much the line rises toward +x. Zero on a hat worn level. */
  leanX?: number;
  /** How much it rises toward +z (out of the face). */
  leanZ?: number;
}

/**
 * Where hair comes out from under `brim` at azimuth `yaw` - the hat's own line, but
 * never below the corridor the face keeps clear.
 *
 * The floor is not a safety net, it is the same rule the SOLVED hairline obeys: no
 * piece of hair in this file may appear in front of the face below
 * {@link HAIR_ENVELOPE.faceClearY}, and an emergence line is a hairline like any
 * other. It binds on exactly one hat - 貝雷帽's low side dips to y 0.038, three
 * centimetres under the floor - and what it costs there is nothing anyone can see:
 * the hair below the floor is still inside the beret's own band, which sits outside
 * the skull all the way round, so the line moves and the picture does not.
 */
export function hatHairlineY(brim: HatBrim, yaw: number): number {
  const own = brim.y + (brim.leanX ?? 0) * Math.sin(yaw) + (brim.leanZ ?? 0) * Math.cos(yaw);
  return Math.max(own, HAIR_ENVELOPE.faceClearY);
}

/**
 * The lowest that line gets anywhere round the head - exactly, since the minimum of
 * `a + b sin + c cos` is `a - hypot(b, c)`.
 *
 * What the pieces that are placed on a RING rather than per column have to clear: a
 * ring is one height all the way round, so it answers to the worst azimuth on it.
 */
export function hatHairlineMinY(brim: HatBrim): number {
  return Math.max(
    brim.y - Math.hypot(brim.leanX ?? 0, brim.leanZ ?? 0),
    HAIR_ENVELOPE.faceClearY,
  );
}

/**
 * How far INSIDE the skull the pressed shell is held.
 *
 * Not zero, for the reason {@link RIM_SINK} is not zero: two surfaces at the same
 * radius z-fight. Not large either - everything spent sinking is spent again coming
 * back out, and the further out the release has to travel the further BELOW the hat
 * the hair first becomes visible, which is a bald gap under the brim.
 */
const HAT_PRESS_SINK = 0.003;
/** |p| of the shell where a hat is pressing on it. See the note above. */
export const HAT_PRESSED_RADIUS = HEAD_ANCHOR.radius - HAT_PRESS_SINK;
/**
 * How far ABOVE the brim the pressed band still exists.
 *
 * The band has to start under the hat and not at its edge: an edge that ends exactly
 * on the brim line shows itself the moment the head turns and the brim's silhouette
 * moves a millimetre. Everything above this is drawn inside the skull and costs only
 * the couple of rows it is given.
 */
const HAT_PRESS_RISE = 0.014;
/**
 * How far BELOW the brim the hair takes to recover its own volume.
 *
 * This is the whole of the 「不要有斷層」 requirement, as one number. The shell leaves
 * the skull on a smooth ramp instead of a step, so what the player sees under the
 * brim is hair swelling out of the hat - and by the time it reaches the ear it is at
 * the style's full bulk, so the curtain and the hanging locks meet the same surface
 * they always did and there is no second join further down either.
 */
const HAT_PRESS_FLARE = 0.042;
/**
 * Share of a hatted column's rows spent between the top of the band and the end of
 * the flare.
 *
 * The flare is about 8deg of a band that is 60deg tall, and it is the only part of
 * the shell anyone looks at when a hat is on - it is where the hair comes out. At an
 * even spread it gets three rows and reads as a chamfer; at 40% it gets nine and
 * reads as a curve. The rest of the column keeps the rim crowding it already had.
 */
const HAT_ROW_SHARE = 0.4;
/** Gap a permed bundle keeps between its own top and the brim it is sitting under. */
const PERM_BRIM_CLEARANCE = 0.004;

/**
 * The radius a piece has to sit at to be LYING ON the shell at height `y`, once a
 * hat whose brim is at `brimY` has pressed it. Same ramp {@link scalpPoint} draws.
 *
 * Stated in the shell's own convention - a sphere about {@link HEAD_ANCHOR.originY} -
 * because that is what every piece that is placed on the shell (bundles, spikes,
 * bangs, ornament sockets) is already using, whereas the press itself is a distance
 * from the head's CENTRE. The two differ by about 7mm at the latitudes a hat brim
 * crosses, which is well inside the sink of the pieces that ask.
 */
export function pressedShellR(shellR: number, y: number, brimY: number): number {
  const t = clamp((brimY + HAT_PRESS_RISE - y) / (HAT_PRESS_RISE + HAT_PRESS_FLARE), 0, 1);
  return HAT_PRESSED_RADIUS + (shellR - HAT_PRESSED_RADIUS) * t * t * (3 - 2 * t);
}

/**
 * A free vertex - one that is not ON the shell but somewhere off it - pressed under a hat.
 *
 * The shell is pressed by construction (its rows are solved with the hat on); a swept
 * bundle is not, and that is 「戴著帽子，部分頭髮會消失」 arriving from the other side. The
 * bundles root on the unpressed shell at ~42deg from the crown and stand up to 8cm off the
 * skull, so above the brim every one of their vertices was OUTSIDE every hat: the tops of
 * the bundles came through the crown of the 草帽, through the cuff of the 毛帽, and where a
 * hat was thick enough to hide them the bundle was simply cut off at its surface.
 *
 * So a vertex is pulled in along its own ray from the shell's centre onto the pressed
 * radius, and released below the hat line on the same smoothstep the shell uses - but
 * starting AT the line rather than {@link HAT_PRESS_RISE} above it. That lag is the point:
 * through the release the bundle is still under the shell rather than over it, so what
 * the player sees at the brim is the scalp coming out of the hat and the bundles coming
 * out from under the scalp, which is the order hair actually stacks in. A vertex already
 * inside the pressed radius is left exactly where it is.
 */
export function pressHairPoint(p: Vec3, brim: HatBrim, flare = HAT_PRESS_FLARE): Vec3 {
  const [x, y, z] = p;
  const dy = y - HEAD_ANCHOR.originY;
  const d = Math.hypot(x, dy, z);
  if (d <= HAT_PRESSED_RADIUS) return p;
  const t = clamp((hatHairlineY(brim, Math.atan2(x, z)) - y) / flare, 0, 1);
  if (t >= 1) return p;
  const k = (HAT_PRESSED_RADIUS + (d - HAT_PRESSED_RADIUS) * t * t * (3 - 2 * t)) / d;
  return [x * k, HEAD_ANCHOR.originY + dy * k, z * k];
}

// ============================================================================
// Spec - what a hairstyle is allowed to say about itself.
//
// Note what is absent: no positions, no rotations, no per-style offsets, no
// radii, no hat rules beyond a single flag. Only lengths and counts.
// ============================================================================

/** Forward-facing bangs across the forehead. */
interface HairFringe {
  count: number;
  /** How far the tips hang below the hairline. Clamped at the eyelids. */
  drop: number;
  thickness?: number;
  /**
   * How much neighbouring bangs disagree about length, as a fraction of `drop`.
   *
   * A fringe cut to one exact length across its whole width is a wig's fringe. A
   * real one is point-cut: the stylist takes the scissors into the ends vertically
   * so the hem breaks up, and that broken edge is most of what makes a fringe look
   * like hair rather than like a moulded piece. Deterministic per bang index, for
   * the same reason the perm's disorder is — see {@link hashNoise}.
   */
  jitter?: number;
}

/** The curtain that falls around the sides and back. */
interface HairFall {
  /**
   * Drop below the dome's rim. Clamped at the envelope floor.
   *
   * This is the SOLID mass, and on any style with `strands` it should stop short
   * of where the hair actually ends — the locks hang past it and their uneven tips
   * become the outline. A curtain taken all the way down is a cylinder, and a
   * cylinder ends in a perfectly flat rim: the 「粗粗的一根」 complaint has a
   * silhouette-scale twin, which is a hem you could have cut with a ruler.
   */
  length: number;
  /**
   * How much wider the hem is than the crown. NEGATIVE tucks the hem under, which
   * is the whole of 內彎: the cut is only a bob until the ends turn in. Clamped so
   * it can narrow the curtain but never invert it.
   */
  flare?: number;
}

/** Face-framing locks, hung just outside the face window on both sides. */
interface HairCurls {
  count: number;
  length: number;
  thickness?: number;
  /**
   * Tips turn toward the face instead of flaring away - the C-curl of 內彎.
   * Only the LEAN flips; the locks stay on the same ring outside the face window,
   * so an inward curl still cannot reach an eye.
   */
  inward?: boolean;
  /**
   * Fraction of the lock, measured up from the tip, that bends into the C-curl.
   *
   * `inward` on its own only tilts the whole rod, and a rod tilted at one angle
   * from root to tip is a straight line however you angle it - which is exactly the
   * 「內彎弧度偏僵硬」 complaint. A real 內彎 hangs straight past the ear and then
   * turns, so the bend has to be somewhere ALONG the lock rather than at its root.
   * See {@link segmentedLock}.
   */
  hook?: number;
  /** How far the hooked tip swings in toward the neck. */
  hookDepth?: number;
  /** How thin the tips are cut. See {@link HairStrands.tip}. */
  tip?: number;
}

/**
 * Free-hanging locks across the back of the head.
 *
 * This is where "the back of the head looks stiff" was actually coming from. The
 * back used to be one smooth cylinder with a handful of identical capsules on it:
 * every lock the same length, the same thickness, on one ring, so the mass had no
 * cut in it. A real cut is LAYERED - locks of different lengths hanging in front
 * of one another - and layering is a length relationship, which is the one thing
 * a spec here is allowed to state. So it is declared, not authored: the tiers, the
 * step between them and the taper across the hem are ratios, and `buildHairLayout`
 * still decides where every resulting lock physically goes.
 */
interface HairStrands {
  count: number;
  length: number;
  thickness?: number;
  /**
   * Tiers of locks hung one in front of the next, each shorter than the one
   * behind it. This is 層次: at 1 the back is a single flat curtain of locks.
   */
  layers?: number;
  /** How much shorter each tier out is, as a fraction of `length`. */
  layerStep?: number;
  /** Arc across the back the locks wrap, radians. Wider reaches the sides. */
  span?: number;
  /** Locks at the edges of the arc cut shorter than the centre - a V hem. */
  taper?: number;
  /**
   * How much neighbouring locks inside one tier disagree about length, as a
   * fraction of their solved length.
   *
   * `layers` gives the cut its tiers and `taper` gives it its V, and with only
   * those two every lock in a tier still ended at exactly the same height — which
   * is a fringe of identical rods, i.e. the 「像熱狗」 complaint seen from behind.
   * Hair does not do that even when it is cut bluntly: strands separate, and the
   * ones in front of a shoulder end higher than the ones beside it. This is that
   * separation, and it is deliberately small on the blunt styles (黑長直 is 一刀齊)
   * and large on the layered ones.
   */
  jitter?: number;
  /** Tips turn under rather than flaring away, like `HairCurls.inward`. */
  inward?: boolean;
  /** Fraction of the lock, up from the tip, that bends. See {@link HairCurls.hook}. */
  hook?: number;
  /** How far the hooked tip swings in. */
  hookDepth?: number;
  /**
   * How thin the tips are cut, as a fraction of the root. Defaults to {@link LOCK_TIP}.
   *
   * The default is a point-cut lock and it is right for a layered style, but it is
   * wrong for a BLUNT one, and wrong in a way that is easy to miss: a strong taper
   * over a short exposed length draws a cone, and a hem made of cones is a row of
   * nails. 一刀齊 and a bob's hem are cut straight across with scissors - every
   * strand the same width where it ends, so the ends merge into one line instead of
   * separating into teeth. That is a property of the CUT, which is why this is the
   * one taper a style gets to state.
   */
  tip?: number;
  /**
   * Segments each lock is broken into, alternately swinging out and back - the
   * S-curve of 大波浪. 0 or 1 leaves the lock straight.
   */
  waves?: number;
  /** How far a wave swings out. Grows toward the tip, where the curl is biggest. */
  waveDepth?: number;
  /**
   * How much neighbouring locks disagree about their wave, 0..1.
   *
   * Curl is the one thing `jitter` could not break up. Length varies per lock
   * already, but every wavy lock was emitted from the same `waves`/`waveDepth`
   * with the same phase, so the S landed at the same height on all of them and
   * bent the same way - 「波浪弧度重複性太高，每一撮幾乎一樣」, and its twin
   * 「髮尾的捲曲方向都一致」. This varies the depth AND flips the phase from the
   * lock's own hash, so neighbours curl by different amounts in opposite
   * directions, which is what a head of waves actually does.
   */
  waveJitter?: number;
  /**
   * How many tiers, counting from the LONGEST, get `waves`/`hook`. Default 1.
   *
   * Curving a lock costs one mesh per segment, and only the tiers long enough to
   * reach the hem contribute a curl anyone can see - a wave hidden behind a tier
   * hanging past it is pure cost. Stated rather than assumed so a style whose whole
   * mass is curled (大波浪) can say so.
   */
  curlLayers?: number;
}

/**
 * The back of the head built as BUNDLES rather than as a cone with rods on it.
 *
 * A style that declares this gets no `fall` cone and no `strands`: the two are
 * mutually exclusive by construction, because they are two answers to the same
 * question and mixing them is what produced 「球形頭盔與下方髮條生硬拼接」 - a
 * surface of revolution with separate pieces bolted to it.
 *
 * Each bundle is one continuous swept surface that roots ON the scalp shell,
 * follows the skull while it is still on the head, then leaves tangentially and
 * falls to the nape. See constants/hairRibbon.ts for the sweep itself; everything
 * here is the ARRANGEMENT - how many, how wide, how long, and how they differ.
 */
interface HairRibbons {
  /** How many bundles. Few and wide is the whole point - 5..12. */
  count: number;
  /** How far the longest tip falls below {@link HANG_TOP_Y}. */
  length: number;
  /**
   * Half-width of a bundle at its widest, in metres of arc.
   *
   * This is the number that decides whether the back reads as one mass or as
   * separate pieces, and it is not free: neighbours only overlap when it exceeds
   * `ringRadius * span / (2 * (count - 1))`. `buildHairLayout` floors it at exactly
   * that, so a spec cannot accidentally ask for gaps.
   */
  halfWidth: number;
  /** How deep a bundle is through the head. Much smaller than its width. */
  thickness?: number;
  /** Tiers, each rooted higher and falling shorter, for 層次. */
  layers?: number;
  /** How much shorter each tier out is, as a fraction of `length`. */
  layerStep?: number;
  /** Per-bundle length variation - the 錯落 that stops the hem being one ruled line. */
  jitter?: number;
  /** How far the tips draw in toward the body, as a fraction of the shell radius. */
  tuck?: number;
  /** S-curve down the fall, and how deep. */
  waves?: number;
  waveDepth?: number;
  /**
   * Where the bundles root, as a polar angle from the crown.
   *
   * This is the PARTING: a style whose bundles all root at the same angle has none.
   * A small value roots them up near the crown so the bundle covers the whole side
   * of the head; a larger one roots them below the ear line so the scalp shell
   * shows above them, which is what a low-tied or heavily-parted style looks like.
   */
  rootTheta?: number;
  /** Where they stop hugging the skull. Past the ear line, or they peel off early. */
  leaveTheta?: number;
}

/**
 * Strand relief combed down the hanging mass - the 髮絲線條.
 *
 * The other half of "stiff". A curtain rendered in one flat colour has no strands
 * in it at any distance, because nothing on it catches light differently from
 * anything else. These are thin capsules lying ON that surface in a shade derived
 * from the style's own colour, so the mass reads as hair falling in strands rather
 * than as a moulded shell. Derived and not authored, exactly like the shading in
 * the shop thumbnail: a new style gets strand lines by asking for a count.
 */
interface HairFlow {
  /** Lines around the hanging mass. */
  count: number;
  /** Fraction of the curtain's drop each line runs. */
  coverage?: number;
  thickness?: number;
  /** How far the line is lifted off the base colour, 0..1. */
  contrast?: number;
}

/**
 * Forward-raked spikes standing along the front of the crown (美式前刺).
 *
 * Distinct from `crest`, which is one blade running front-to-back along the midline.
 * These are rows of separate spikes running LEFT-TO-RIGHT across the front, each
 * raked forward - the styling wax look, not a mohawk.
 */
interface HairSpikes {
  /** Spikes across one row. */
  count: number;
  /** Rows stepping back from the hairline. Front row rakes hardest. */
  rows?: number;
  /** Tip length measured from the root, along the rake. Clamped by the envelope. */
  height: number;
  thickness?: number;
  /**
   * How much neighbouring spikes differ in height, as a fraction of `height`.
   *
   * A row of identical cones is a comb, not a hairstyle - 前刺 is pinched out in
   * uneven bundles with wax, and the unevenness is most of what sells it. Applied
   * from a fixed hash of the spike's own index, so the "random" look is stable
   * across renders rather than shimmering every frame.
   */
  jitter?: number;
}

/**
 * Twisted strand bundles studded over the scalp (渣男燙 / 錫紙燙).
 *
 * A perm's identity is texture and bulk rather than outline, so it is neither a
 * lock nor a curtain: it is the shell itself made rough. Bundles below the
 * hairline skip the face window exactly as the scalp dome does, which is what
 * keeps a style made of a hundred little pieces from creeping onto the cheeks.
 *
 * WHY BUNDLES AND NOT BALLS. This was a sphere per clump, and a scalp studded with
 * spheres reads as bubble wrap - the one thing a 錫紙燙 is not. The technique is
 * literally 把髮絲擰轉成束 then setting it, so what you see is dense TWISTED ROPES
 * lying over each other at slightly wrong angles. So a clump is a capsule with a
 * length and a rake, and neighbouring clumps disagree about both.
 */
interface HairPerm {
  /** Bundles around one latitude ring. */
  count: number;
  /** Rings from the crown down toward the nape. */
  rings: number;
  /** Bundle thickness. Doubles as the style's texture scale. */
  size: number;
  /** Bundle length, as a multiple of `size`. This is the 束 in 束狀紋理. */
  twist?: number;
  /** How far neighbouring bundles disagree about angle and length, 0..1. */
  jitter?: number;
}

/** Upright mohawk crest straddling the crown. */
interface HairCrest {
  /** Blade thickness top-to-bottom. */
  height: number;
  spikes: number;
  spikeHeight: number;
  spikeRadius: number;
  emissive: string;
}

export interface HairSpec {
  id: string;
  label: string;
  /** Drives the mesh material AND the thumbnail fill - the anti-drift guarantee. */
  color: string;
  /**
   * Silhouette tier the thumbnail draws. 'long' and 'wave' share a length but not
   * an outline - 黑長直 is a blunt straight fall, 大波浪 a scalloped one - which is
   * the whole reason they are separate tiers: at 40px the two styles were telling
   * apart on hue alone, and one of those hues is near-black.
   */
  silhouette: 'short' | 'mid' | 'long' | 'wave' | 'crest' | 'bob-in' | 'spike' | 'perm' | 'buzz';
  /**
   * There is no `hiddenByHat`, and there used to be.
   *
   * It said "this whole style disappears when a hat is on", and it was the wrong
   * unit: a hat cannot fit round a 15cm crest, but it has no quarrel with the hair
   * on the sides of the same head. So the pieces that genuinely do not fit under a
   * hat - `crest` and `spikes` - say so where they are built, and everything else a
   * style has keeps showing. See the HAIR UNDER A HAT note at the top of this file.
   */
  /** Follow-through sway on the hanging pieces while idling and walking. */
  sway?: boolean;
  /** Style covers the scalp. Suppressed under hats so it can't poke through. */
  cap?: boolean;
  /**
   * How far the hair stands off the skull - i.e. how much hair there is.
   *
   * Still a LENGTH, so it stays inside the rule the rest of this file follows, and
   * it is clamped into BULK_RANGE rather than trusted. It exists because 吋頭 and
   * 渣男燙 are the same shape and differ only in volume: a clipper cut that hugs
   * the scalp and a perm that triples it cannot both be the one global shell.
   * Omitted means HEAD_ANCHOR.shell, which is what every earlier style used.
   */
  bulk?: number;
  /**
   * How much the two sides of the head are allowed to disagree, 0..1.
   *
   * Every piece in this file is placed on a yaw ring, and a yaw ring is mirror
   * symmetric by construction: `spreadArc` hands out the same slots left and right
   * and each style's jitter is hashed from the slot INDEX, so slot i and its mirror
   * drew the same "random" number. The result was a head of hair that matched
   * itself perfectly across the midline - 「兩側髮片幾乎完全對稱且平行」 and
   * 「兩邊髮量對稱到不自然」 are the same defect reported on two styles.
   *
   * A real head has a parting, a heavier side and a side tucked behind an ear, so
   * this leans length, thickness and standoff smoothly across the head with
   * `sin(yaw)` (peaking at the two sides, zero front and back) and rotates the
   * whole lock set a few degrees off the midline. It is a proportion of the
   * existing lengths and never an addition to them, so the envelope clamps and
   * `npm run audit:hair` still bound everything they bounded before.
   */
  asymmetry?: number;
  /**
   * How far the back of the skull bulges past the hair shell, as a fraction of it.
   *
   * The shell is a SPHERE, and a sphere seen from behind is a circle - which is
   * where 「後腦勺輪廓太平」 comes from. A skull is not a sphere: it runs back and
   * down into the occipital bone, and on a short cut, where there is no hanging
   * mass to give the head a shape of its own, that bulge IS the silhouette.
   *
   * Baked into the shell rather than laid on it as a second patch: z is stretched by
   * this much where the surface faces straight back and by nothing at all at the ears,
   * easing between. That is the anatomy, and it is also why there is no seam - a patch
   * has a border, and the border was visible as a crease down each side of the head.
   */
  occiput?: number;
  fringe?: HairFringe;
  fall?: HairFall;
  curls?: HairCurls;
  strands?: HairStrands;
  /** The back built as continuous swept bundles. Excludes `fall` and `strands`. */
  ribbons?: HairRibbons;
  flow?: HairFlow;
  crest?: HairCrest;
  spikes?: HairSpikes;
  perm?: HairPerm;
}

// Keyed by item id. Matching on id rather than display name is deliberate: the old
// name-substring test made '中長髮系列' satisfy both the mid and long checks (it
// contains '長髮'), rendering two full hairstyles on one head.
export const HAIR_SPECS: Record<string, HairSpec> = {
  'hair-short-set': {
    id: 'hair-short-set',
    label: '短髮系列',
    color: '#2d1d11',
    silhouette: 'short',
    cap: true,
    // 「整體輪廓太接近頭盔，與頭部球體之間缺乏蓬鬆的間隙」. A helmet is hair with no
    // thickness of its own, and that is what the default shell (0.02) was giving
    // this style: the same standoff as the styles that have a whole curtain hanging
    // off them to make the silhouette. Short hair has to earn its outline from bulk
    // alone, and 0.033 is still well under 渣男燙's 0.042 - a dense cut, not volume.
    bulk: 0.033,
    // 「後腦勺輪廓太平，短髮更需要表現頭骨的立體感」, and it is the same root cause:
    // with no hanging mass the SKULL is the silhouette, and the shell it is fitted
    // to is a sphere. Biggest occiput of the set, for exactly that reason.
    occiput: 0.11,
    asymmetry: 0.4,
    // 「頂部紋理和其他三款一模一樣，短髮應該有不同的紋理節奏（更密更細）」 - and it
    // was literally the same: all four styles carried the identical four numbers, so
    // every head in the shop had the same corrugation at the same pitch. A clipper-
    // length cut's is finer and tighter than a bob's: more pieces, each thinner,
    // dropping less far.
    fringe: { count: 23, drop: 0.125, thickness: 0.023, jitter: 0.3 },
    // ========================================================================
    // THE MASS, REBUILT AS BUNDLES
    // ========================================================================
    //
    // This style was the purest case of the defect: a perfectly smooth sphere with
    // a ring of little rectangles bolted round its rim. Nothing about it read as
    // hair, because nothing on it had a direction - the dome carried the whole
    // silhouette and the nape locks were separate objects sitting on the edge of it.
    //
    // Bundles fix both at once. They root high on the crown and run the whole way
    // down the skull, so the SURFACE has hair flow in it rather than being a ball,
    // and they end where the cut ends instead of a second set of pieces starting
    // there. `fall`, `strands` and `curls` are all gone with the seam they made.
    ribbons: {
      // More than a long style's, and shorter: a clipper-length cut's texture is
      // finer and tighter, which is the same reasoning the old `fringe` count had.
      // 7, down from 11. Eleven bundles over a short cut's small arc put a visible
      // ridge every couple of centimetres, and the back of the head came out as a
      // set of separate strands - 「一根根的鬚鬚」. Fewer bundles means each is
      // wider (minHalfWidth scales with 1/count), so they overlap further past each
      // other and the crossings stop being legible as individual pieces.
      count: 7,
      // The style's own length - drawn hem was y=-0.116, i.e. 0.096 below HANG_TOP_Y.
      length: 0.096,
      halfWidth: 0.075,
      // 0.017, from 0.024. This is the OTHER half of the whiskers: thickness is how
      // far a bundle bulges off the surface, so it is also how deep the valley
      // between two of them is. Flatter bundles blend into one another's shoulders
      // instead of each standing proud as its own tube.
      thickness: 0.017,
      layers: 2,
      layerStep: 0.22,
      // Eased from 0.26. With only seven bundles a big length disagreement is seven
      // obvious steps rather than a texture.
      jitter: 0.17,
      // Short hair hugs the skull and turns UNDER at the nape rather than hanging
      // off it - the biggest tuck in the shop, and what keeps this a short cut
      // instead of a very small bob.
      tuck: 0.3,
      // Rooted high: a short cut covers the whole skull, so there is no parting to
      // leave the shell showing above the bundles.
      rootTheta: 28 * DEG,
      leaveTheta: 98 * DEG,
    },
    flow: { count: 11, thickness: 0.008, contrast: 0.14 },
  },
  'hair-mid-set': {
    id: 'hair-mid-set',
    label: '中長髮系列',
    color: '#451a03',
    silhouette: 'mid',
    cap: true,
    // 「頭頂到髮根的膨度不夠，顯得頭髮貼頭皮」. Same knob as 短髮's, for the same
    // reason: this is how much hair there is between the scalp and the outside.
    bulk: 0.034,
    occiput: 0.07,
    // 「兩邊髮量對稱到不自然，可以讓一側稍厚或稍長」. The highest in the set - a
    // mid-length cut is the one that is actually worn parted and tucked.
    asymmetry: 0.55,
    fringe: { count: 18, drop: 0.155, thickness: 0.029, jitter: 0.26 },
    // ========================================================================
    // THE MASS, REBUILT AS BUNDLES
    // ========================================================================
    //
    // Same rebuild as 短髮's and the same defect, worse: a smooth sphere with a
    // heap of loose rods scattered round the bottom of it. The old `strands` here
    // carried waves, which on a thin capsule chain only ever showed as the pitch of
    // the rods themselves.
    //
    // A mid-length cut is the one actually worn parted and tucked, so this keeps the
    // set's biggest `asymmetry` and roots its bundles a little lower than 短髮 -
    // low enough that the scalp reads as parted above them.
    ribbons: {
      count: 10,
      // The style's own length - drawn hem was y=-0.220, i.e. 0.20 below HANG_TOP_Y.
      length: 0.2,
      halfWidth: 0.082,
      thickness: 0.027,
      // Three tiers: 帶有層次的自然中長髮 is what the shop promises, and with wide
      // bundles a tier is a visible step in the hem rather than a rake.
      layers: 3,
      layerStep: 0.17,
      jitter: 0.2,
      tuck: 0.16,
      rootTheta: 36 * DEG,
      leaveTheta: 102 * DEG,
      // The wave this style always claimed and never had: one shallow S, as a fold
      // in the sheet rather than a bend between rods.
      waves: 2,
      waveDepth: 0.014,
    },
    flow: { count: 11, thickness: 0.009, contrast: 0.13 },
  },
  'hair-long-set': {
    id: 'hair-long-set',
    label: '黑長直',
    // Blue-black rather than #1a1a1a: at thumbnail size a true black fills as one
    // unlit slab, and the shop had two long styles telling apart on hue alone.
    color: '#232935',
    silhouette: 'long',
    sway: true,
    cap: true,
    // 「瀏海遮住額頭的方式偏生硬，與臉部球體的貼合度不夠」. Most of that is now
    // structural - every bang follows the skull rather than cutting a chord across
    // it, and roots up under the dome instead of butting against its rim - but the
    // fringe was also the thickest in the set at 0.032, which is what made it read
    // as a moulded piece laid on the brow. Finer and one piece denser; still the
    // bluntest hem of any style here, because 一刀齊 runs across the front too.
    fringe: { count: 19, drop: 0.16, thickness: 0.027, jitter: 0.14 },
    // 「長髮整體像硬質片狀物，缺乏垂墜的重量感和柔軟度」. The hem NARROWS very
    // slightly now instead of hanging perfectly parallel: hair with weight in it
    // falls in toward the back rather than standing off it, and a curtain whose
    // sides are exactly parallel is the one thing that reads as sheet material.
    // A twentieth of what 內彎 tucks by - enough to see, not enough to be a bob.
    //
    // 0.36, from 0.28 — 「黑長直請幫我做長一點」. That is the envelope floor exactly
    // (HANG_TOP_Y - 0.36 = -0.38), which is the point: this style is what the floor
    // was raised FOR, and a long cut that stops at the shoulder blades is not the
    // one people mean by 黑長直. Nothing else moved with it; the other styles keep
    // the lengths they had.
    // 「兩側髮片幾乎完全對稱且平行，少了自然的前後錯落」.
    asymmetry: 0.45,
    occiput: 0.06,
    // The layering here is deliberately almost nothing - 一刀齊 IS the style, and a
    // stepped hem would be a different haircut. Three fat locks were doing the work
    // instead, which is why the back read as a slab; fifteen fine tapered ones and a
    // dense set of strand lines give it 髮絲滑順 without touching the outline.
    //
    // Two things changed against 「髮尾切面太平整，像被裁斷的，應有微微的參差不
    // 齊」 and 「缺乏垂墜的重量感」. `jitter` is up from 0.09, which was low enough
    // that the tips landed on one ruled line - 微微的參差 is still the brief, so it
    // is 0.16 and not the 0.28 the choppy styles get. And the tips now HOOK: a
    // thirtieth of the length, turning in by 26mm over the last stretch, which is
    // what long hair resting against a back does and is the difference between hair
    // hanging and a sheet standing.
    // ========================================================================
    // THE BACK, REBUILT AS BUNDLES
    // ========================================================================
    //
    // This style used to be a cone with fourteen rods on it. `ribbons` replaces
    // both (see HairRibbons): nine continuous surfaces, each rooted high on the
    // shell near the crown, hugging the skull past the ear line and only then
    // falling to the nape - so the hair leaves the head the way hair does rather
    // than being a tube hung from a rim.
    //
    // Rooted at 38 degrees, which is high: 黑長直 is worn with the whole side of
    // the head covered, so the bundles have to start above the ear and come down
    // OVER it. A style with a low parting would root lower and let the shell show.
    ribbons: {
      count: 9,
      // The style's own length, unchanged - this is where the outline comes from.
      length: 0.331,
      halfWidth: 0.095,
      thickness: 0.03,
      // Two tiers: the outer one shorter and rooted a little lower, which is the
      // 層次 without going back to a stack of separate pieces.
      layers: 2,
      layerStep: 0.13,
      // 一刀齊 is still a blunt cut, so the 錯落 stays small - just enough that the
      // hem is a soft broken line rather than one ruled edge.
      jitter: 0.17,
      // Long straight hair rests ON the back rather than standing off it.
      tuck: 0.16,
      rootTheta: 38 * DEG,
      leaveTheta: 106 * DEG,
    },
    flow: { count: 13, thickness: 0.009, contrast: 0.14 },
  },
  'hair-long': {
    id: 'hair-long',
    label: '大波浪',
    // Warm near-black rather than the old silver: black is what the style is being sold as now.
    // It stays a hair off pure #000 so the thumbnail's gradient and the 3D mesh's shading both
    // still have somewhere to go, and warm separates it from 黑長直's cool blue-black without
    // either one having to stop reading as black - the outlines already tell the two apart.
    color: '#1c1a19',
    silhouette: 'wave',
    sway: true,
    cap: true,
    fringe: { count: 17, drop: 0.15, thickness: 0.032, jitter: 0.22 },
    // Deliberately different mass from 黑長直 — and no longer the same length as
    // it, since 黑長直 was let down to the envelope floor and a wave that hangs to
    // the same point as a straight cut is a longer cut, not a curlier one. The old five fat straight
    // locks were the problem: 大波浪 is not a long style with volume, it is a long
    // style with an S in it - the curl starts around the ear and opens up toward
    // the tip. So the locks are thinner and far more numerous, and each one is
    // emitted as four segments that swing alternately out and back.
    // `curlLayers` says out loud what this style always did - every tier waves, not
    // just the ones that reach the hem - and `waveJitter` breaks the one thing the
    // waves still had in common, which is that they all bent the same way at the
    // same height. Same fix as 中長髮's; the defect was never specific to one style.
    // ========================================================================
    // THE BACK, REBUILT AS BUNDLES
    // ========================================================================
    //
    // The wave-chain is gone with the cone it hung on. It was the worst case of
    // the old build: a wave was emitted as four capsules per lock, so this style
    // alone was sixty separate little rods each ending in its own cap - the reason
    // it read as a bristle brush from behind rather than as 大波浪.
    //
    // The S now lives INSIDE one continuous surface (see RibbonInput.waves): the
    // bundle's own radius swings out and back as it falls, so a wave is a fold in a
    // sheet of hair instead of a kink between two rods. Shallower per swing than the
    // chain was and it reads deeper, because there is no longer a seam at the turn.
    ribbons: {
      count: 9,
      // The style's own length, unchanged.
      length: 0.264,
      halfWidth: 0.1,
      thickness: 0.032,
      layers: 2,
      layerStep: 0.15,
      // A curled style's hem is genuinely uneven, unlike 一刀齊's - nearly twice
      // 黑長直's 錯落.
      jitter: 0.2,
      // Barely tucked: waves carry the mass outward, which is where this style's
      // volume comes from now that it is not being flared by a cone.
      tuck: 0.06,
      rootTheta: 40 * DEG,
      leaveTheta: 104 * DEG,
      waves: 3,
      waveDepth: 0.02,
    },
    // No `curls`. Those were capsule rods framing the face, and on a ribbon-built
    // style the bundles themselves already sweep round past the ear - so the rods
    // stopped being the side of the hair and became loose fragments lying on it,
    // which is exactly the 碎片堆疊 this rebuild is removing.
    flow: { count: 9, thickness: 0.009, contrast: 0.12 },
  },
  'hair-bob-inward': {
    id: 'hair-bob-inward',
    label: '短髮內彎',
    // Warm chestnut. The three existing short/mid styles are all near-black browns,
    // and a fourth would have been telling apart on outline alone at 40px.
    color: '#6d4326',
    silhouette: 'bob-in',
    sway: true,
    cap: true,
    // 整體飽滿 is half of what a bob is - the mass has to look full and rounded
    // rather than painted on, and this style had the default shell of a style with
    // hair hanging off it, which a chin-length bob does not have to hide behind.
    bulk: 0.03,
    occiput: 0.08,
    // 「兩側髮片厚度一致，缺乏層次感，看起來像兩塊板子」. Half of that is the width
    // jitter widening with `strands.jitter` below; the other half is this, which
    // leans length and thickness across the head so the two sides are not each
    // other's mirror to begin with.
    asymmetry: 0.5,
    // 空氣瀏海: soft and slightly shorter, which is what the cut is nearly always
    // worn with and what keeps it from colliding with 短髮系列's blunt sweep. Finer
    // and denser than it was, because 「髮絲紋理（頂部瓦楞紋）和髮尾的光滑面質感不
    // 統一」 is a pitch mismatch: a fringe of 0.03 rods over a curtain with nine
    // strand lines on it is coarse on top and smooth below. The fringe comes down
    // and the strand lines go up until the two read as the same hair.
    fringe: { count: 20, drop: 0.145, thickness: 0.025, jitter: 0.24 },
    // Shorter than 中長髮 (0.2) so it reads as a bob, and the hem NARROWS. That
    // negative flare is the style: 鮑伯內彎 is layered only at the ends, which turn
    // under. A positive flare here would just be 中長髮 in a different brown.
    // Eight rather than twelve, and shorter. Face-framing locks are supposed to
    // hang beside the CHEEK; a dozen of them long enough to reach the nape all
    // arrived in the same band as the back mass, and a hundred pieces crowded into
    // one 12mm band is not volume, it is litter.
    // ENDS-ONLY layering, which is the specific thing that separates a bob from
    // every other cut here: 通常只有在髮尾會有層次. So two tiers a hair apart rather
    // than the stepped stack 中長髮 gets - and both turn under with the hem, so the
    // whole back edge hooks in toward the neck instead of hanging off it.
    //
    // 「內灣弧度偏僵硬，髮尾收攏缺乏自然的 S 曲線過渡」. `inward` alone only tilted
    // the whole lock, and a rod tilted at one angle is a straight line at an angle -
    // there was no curve in the cut anywhere. The lock now hangs at its own lean for
    // the first 58% and then TURNS, accelerating into the tip, which together with
    // the lean above it is the S. Both tiers get it (`curlLayers: 2`), because on a
    // two-tier bob both of them reach the hem. Fewer locks to pay for the segments.
    // A bob hem is EVEN - that is most of what makes it a bob - so the jitter and
    // the V are the smallest of any layered style here. They were set choppy on the
    // first pass, which turned the one cut in the shop whose whole identity is a
    // clean line into the raggedest.
    // ========================================================================
    // THE MASS, REBUILT AS BUNDLES
    // ========================================================================
    //
    // 「後面的錐形棒狀物感太重」, and that was literal: this style's back was 21
    // tapered cylinders, and a tapered cylinder IS a cone - so the back of the head
    // was a ring of cones, and no thickness or count setting was going to make a
    // cone read as hair.
    //
    // The 內彎 survives the change and is in fact easier to state: a bob that turns
    // under is a big `tuck`, one number, applied to the whole continuous surface -
    // where before it needed `inward`, `hook` and `hookDepth` on both the strands
    // and the curls, all fighting the cone they were bending.
    ribbons: {
      count: 8,
      // The style's own length - drawn hem was y=-0.205.
      length: 0.185,
      halfWidth: 0.09,
      thickness: 0.024,
      layers: 2,
      layerStep: 0.12,
      // Blunt-ish: a bob is cut to a line, and the turn under is what breaks it up.
      jitter: 0.12,
      // The biggest tuck in the shop, and the style's whole identity: the hem
      // gathers UNDER itself rather than hanging or flaring.
      tuck: 0.3,
      rootTheta: 34 * DEG,
      leaveTheta: 100 * DEG,
    },
    flow: { count: 13, coverage: 0.92, thickness: 0.008, contrast: 0.15 },
  },
  'hair-spike-front': {
    id: 'hair-spike-front',
    label: '美式前刺',
    color: '#2b2723',
    silhouette: 'spike',
    cap: true,
    // Re-cut against photographs of the real thing rather than from the name.
    // What the reference shows, and what this spec is now saying:
    //
    //   * the sides are FADED, not bald - short, but with a mass of hair on top of
    //     them that the top length grows out of. 0.021 rather than 0.014: the old
    //     value put separate cones on what was effectively a shaved head, which is
    //     what made it read as a comb rather than as a cut.
    //   * the top is SHORT. 3-5cm on a real head, which on this one is about 0.1,
    //     not the 0.15 that was here - that was a hedgehog, and no amount of jitter
    //     fixes a length that is wrong by half.
    //   * there IS hair over the forehead. 「瀏海長度以眉毛上一指」 - the front is
    //     pushed forward and slightly up, not shaved off, so the style has a short
    //     fringe under the spikes instead of the bare brow it used to have.
    //   * the tips are pinched into uneven BUNDLES that lean into each other, so
    //     the fan is denser, finer, and jittered in yaw as well as in height.
    bulk: 0.021,
    fringe: { count: 17, drop: 0.08, thickness: 0.024, jitter: 0.26 },
    // ========================================================================
    // THE MASS UNDER THE SPIKES
    // ========================================================================
    //
    // This style had none. It was a scalp shell, a fringe and a patch of spikes -
    // so the whole head below the spikes was one smooth sphere ending in a hard
    // horizontal line, which is a swim cap, not a haircut. The spikes then sat ON
    // that cap with nothing joining them to it.
    //
    // Bundles give the sides and back the same treatment 短髮 gets: flow down the
    // skull, and a soft varied edge at the nape instead of a cut rim. Short and
    // tightly tucked, because this cut is clipped close everywhere the spikes are
    // not - the mass is what the spikes come OUT of, not a second silhouette.
    ribbons: {
      count: 11,
      // The style's own reach - drawn hem was y=-0.115.
      length: 0.095,
      halfWidth: 0.07,
      thickness: 0.02,
      layers: 2,
      layerStep: 0.24,
      jitter: 0.3,
      // The tightest tuck in the shop: clipped sides sit ON the skull.
      tuck: 0.34,
      rootTheta: 30 * DEG,
      leaveTheta: 96 * DEG,
    },
    // Was 9 x 4 = 36 spikes at 0.031 thick, which at this height is a needle - and
    // thirty-six needles is a hedgehog, not 前刺. Fewer and much thicker: 7 x 3 = 21
    // clumps at 0.048, which is the same wax-set hair read as bundles rather than
    // as bristles, and the jitter still keeps them from being a regular comb.
    // 5 rows, not 3: with the back row now past the crown the rows have twice the
    // arc to cover, and three of them across it leaves bare shell between.
    spikes: { count: 7, rows: 5, height: 0.115, thickness: 0.048, jitter: 0.42 },
  },
  'hair-perm-messy': {
    id: 'hair-perm-messy',
    label: '渣男燙',
    // Dyed ash-brown, which is how the style is nearly always worn.
    color: '#8b5e34',
    silhouette: 'perm',
    cap: true,
    // 蓬度 is the entire selling point of a 錫紙燙, so this is the bulkiest style
    // in the set by some way.
    bulk: 0.042,
    // The fringe is twisted into pieces too, not blow-dried flat, so it is finer
    // and there is more of it than a smooth style's.
    fringe: { count: 17, drop: 0.12, thickness: 0.028, jitter: 0.24 },
    // 錫紙燙 is 把髮絲擰轉成束 - dense twisted ropes, not bubbles. So: many more,
    // much smaller, each one nearly three times as long as it is thick, and heavily
    // jittered. The old 12x4 spheres of r=0.05 were both too big and too regular to
    // be a texture at all; 紋路很密 is the entire selling point of the cut.
    perm: { count: 14, rings: 5, size: 0.032, twist: 2.8, jitter: 0.65 },
  },
  'hair-buzz': {
    id: 'hair-buzz',
    label: '吋頭',
    // Grey-charcoal rather than another dark brown. Clippered hair genuinely reads
    // greyer than long hair - you are half looking at scalp - and it also keeps the
    // thumbnail off 短髮系列's #2d1d11, which is the nearest silhouette in the shop.
    color: '#39352f',
    silhouette: 'buzz',
    cap: true,
    // Barely off the skull - the point of the cut is that you can see the head
    // through it. Nothing else: no fringe, no fall, no locks.
    bulk: 0.009,
  },
  'hair-mohawk': {
    id: 'hair-mohawk',
    label: '龐克髮型',
    color: '#ef4444',
    silhouette: 'crest',
    crest: {
      height: 0.17,
      spikes: 5,
      spikeHeight: 0.156,
      spikeRadius: 0.035,
      emissive: '#7f1d1d',
    },
  },
};

/**
 * The one hairstyle to render. Resolving a single spec - rather than evaluating an
 * independent boolean per style - is what makes overlapping hair structurally
 * impossible, no matter what the player has equipped.
 */
export function resolveHairSpec(
  equipped: ReadonlyArray<{ id: string } | null | undefined>,
): HairSpec | null {
  for (const item of equipped) {
    if (item && HAIR_SPECS[item.id]) return HAIR_SPECS[item.id];
  }
  return null;
}

export function getHairSpec(id: string): HairSpec | undefined {
  return HAIR_SPECS[id];
}

/** Head tone the hair sits on, shared so thumbnails match the avatar's skin. */
export const AVATAR_SKIN_COLOR = '#fcd34d';

/**
 * Shifts a style's own colour by `amount` (-1..1) to shade a piece against it.
 *
 * Positive lifts a piece off the mass, negative sinks it. Which direction "lifts"
 * is not fixed: on the near-black styles the only visible relief is toward white,
 * on a bleached one it is toward black, so the target is chosen by luminance. That
 * is the same rule `shadeFrom` uses for the shop thumbnail's strand lines - shared
 * deliberately, so the highlight a player sees in the shop is the highlight the
 * avatar actually renders.
 */
export function shadeHairColor(color: string, amount: number): string {
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  const lift = luminance > 0.6 ? 0 : 255;
  const target = amount >= 0 ? lift : 255 - lift;
  const k = Math.min(1, Math.abs(amount));
  return `#${rgb
    .map(c => Math.round(c + (target - c) * k).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * Deterministic 0..1 noise from an integer.
 *
 * The messy styles (渣男燙's bundles, 前刺's uneven tips) need neighbouring pieces
 * to disagree, but `Math.random` would re-roll the character's hair on every React
 * render and make it shimmer. Hashing the piece's own index gives the same
 * disorder every time, and keeps `buildHairLayout` a pure function - which is the
 * property `npm run audit:hair` relies on to check it without a renderer.
 */
function hashNoise(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ============================================================================
// LAYOUT - specs in, concrete clamped transforms out.
//
// Everything below is pure arithmetic on HEAD_ANCHOR, which is why the audit
// script can check it without a renderer.
// ============================================================================

/** three.js CylinderGeometry args. theta = azimuth, theta=0 faces +Z. */
export type CylinderArgs = [number, number, number, number, number, boolean, number, number];
/** three.js CapsuleGeometry args [radius, length, capSegments, radialSegments]. */
export type CapsuleArgs = [number, number, number, number];
/** three.js ConeGeometry args [radius, height, radialSegments]. */
export type ConeArgs = [number, number, number];
type Vec3 = [number, number, number];

/**
 * The scalp: ONE shell fitted to the skull, with a hairline it solves for.
 *
 * ============================================================================
 * WHY THIS IS NOT TWO SPHERE PATCHES ANY MORE
 * ============================================================================
 *
 * It used to be: a front patch cropped at the hairline, a back patch cropped at
 * the ear line, changing over at the edge of a +-56deg "face window". That is
 * where 「頭髮貼著太陽穴的地方…有一種頭髮是強行附加上去的感覺」 came from, and it
 * was two defects sharing one cause - a CROP IS NOT A HAIRLINE.
 *
 *   1. THE TEMPLE WAS A GUILLOTINE CUT. The two patches disagree about how far
 *      down they come by 22cm and they hand over at a single azimuth, so every
 *      head carried a dead-straight vertical wall of hair from the brow to below
 *      the ear with bare skin in front of it. No head has that edge. It is nearly
 *      invisible dead-on and unmistakable the moment the camera swings round,
 *      which is exactly what was reported: you see it when you turn the view.
 *   2. THE EDGE FLOATED. A cropped sphere is a shell of NO thickness standing
 *      `bulk` (2-4mm) off the skull, so wherever that crop was visible you were
 *      looking at a lip of hair hanging in the air over skin, lit on one side
 *      only. That lip is the whole of "stuck on rather than growing out of".
 *
 * So the shell now carries its own rim. `rim[i]` is how far down it comes at
 * azimuth `i` - level across the forehead, then turning down in front of the ear,
 * which is where a real hairline turns - and `tuck[i]` rolls the last few degrees
 * of that rim INWARD, under the skull's own surface, so the shell ends INSIDE the
 * head rather than stopping in mid-air. There is no cut edge left to catch at any
 * camera angle, because the edge is now behind the skin it used to hover over.
 *
 * The occipital bulge is baked in here too instead of being a third patch laid on
 * top - see {@link HairSpec.occiput}. Same reasoning: a patch has a border.
 */
export interface HairScalpPart {
  key: string;
  /** Centre of the sphere the shell is fitted to, head-local. */
  y: number;
  /** The shell's radius at the crown. */
  radius: number;
  /** Radius the tucked rim dives to. Inside the skull, which is the point. */
  rimRadius: number;
  /** Occipital stretch along -z, blended in by how far back the surface faces. */
  occiput: number;
  /**
   * Azimuth of each column. NOT evenly spaced - see `resampleColumns` for why the
   * mesh spends most of its columns on about 15deg of temple.
   */
  yaw: number[];
  /** Polar angle the shell reaches, per column. See {@link scalpVertex}. */
  rim: number[];
  /** How much of the rim's dive each column takes, 0..1. */
  tuck: number[];
  /**
   * Present only when a hat is on: the shell is a BAND under the brim rather than a
   * whole dome. See the HAIR UNDER A HAT note at the top of this file.
   *
   * All three are polar angles per column, and all three are clamped into
   * `[0, rim[i]]`, so a column whose own hairline is already above the brim - the
   * forehead, under any hat - collapses to nothing and the band pinches shut there
   * instead of crossing the rim.
   */
  press?: {
    /** |p| the shell is squeezed to where the hat is on it. Inside the skull. */
    radius: number;
    /** Where the band starts, a little way up under the hat. Fully pressed here. */
    top: number[];
    /** Where the style has recovered its full volume, a little way below the brim. */
    flare: number[];
  };
}

/**
 * Columns around the shell, and rows from the crown down to the rim.
 *
 * The count matters because the rim is a polyline through one point per column, and
 * a coarse polyline down the temple is a staircase. The columns are not evenly
 * spaced - `resampleColumns` puts most of them on the plunge - so 128 buys a step of
 * well under a centimetre there while leaving the back of the head rounder than the
 * 32-segment sphere it used to be.
 */
export const SCALP_COLUMNS = 128;
export const SCALP_ROWS = 24;

export interface HairCurtainPart {
  y: number;
  args: CylinderArgs;
}

/**
 * A hanging lock or a bang. Placed on a yaw ring: the renderer wraps it in a
 * group rotated `yaw` about Y, inside which +Z always points away from the face.
 * That is why no lock ever needs a hand-picked x/z pair.
 */
export interface HairLockPart {
  key: string;
  yaw: number;
  position: Vec3;
  rotation: Vec3;
  args: CapsuleArgs;
  /**
   * Tip radius as a fraction of the root's. Present = the piece is a TAPER; absent
   * = an ordinary capsule.
   *
   * This is the fix for 「粗粗的一根像熱狗」, and it had to be a change of primitive
   * rather than of numbers. A capsule has one radius from end to end and a domed
   * cap, so a lock made of one is a sausage at every size — thinning it just makes
   * a thinner sausage, and no count or length could have helped. Hair is thick
   * where it leaves the scalp and comes to a point where it was cut, so a lock is
   * a cone frustum: full thickness at the root, {@link LOCK_TIP} of it at the tip.
   *
   * It is a RENDER hint and nothing else. `args` keeps its capsule meaning — the
   * same radius, the same length, the same overall span — so every clamp in this
   * file and every check in `npm run audit:hair` still measures the true extent.
   * A taper only ever removes material from inside that envelope.
   */
  tip?: number;
  /**
   * Shade offset from the style's base colour, -1..1, for the pieces that have to
   * be SEEN against the mass they lie on rather than merge into it. Left undefined
   * on ordinary locks, which are the same hair as everything around them.
   */
  tint?: number;
  /**
   * Which slice of the WHOLE strand this piece is, 0 at the root end and 1 at the
   * tip. Absent means the piece is a strand in its own right, i.e. [0, 1].
   *
   * Only {@link segmentedLock} sets it, and it must: a wave or a hook is drawn as a
   * CHAIN of capsules, and each of those is its own primitive running its own uv.y
   * from end to end. The shading in legacy/hairShading.ts ramps root-to-tip and
   * lays its highlight bands on that ramp, so without this every segment would
   * restart the ramp and a curved lock would come out banded like a bamboo cane -
   * the same stack-of-beads reading that the chain's own radius fix exists to
   * avoid, arriving through the shader instead of through the geometry.
   *
   * It is RENDER metadata and nothing else: no clamp, no envelope and no check in
   * `npm run audit:hair` reads it, because it moves no vertex.
   */
  span?: readonly [number, number];
}

export interface HairCrestPart {
  emissive: string;
  blade: { position: Vec3; args: Vec3 };
  spikes: Array<{ key: string; position: Vec3; args: ConeArgs }>;
}

/** One forward-raked spike, placed on a yaw ring like a lock. */
export interface HairSpikePart {
  key: string;
  yaw: number;
  position: Vec3;
  rotation: Vec3;
  args: ConeArgs;
}

/**
 * One twisted bundle, half-sunk into the shell.
 *
 * Placed on a yaw ring like a lock rather than at an absolute x/z, which is what
 * lets a bundle be a capsule pointing somewhere instead of a sphere: "rake it
 * outward and down" is then one rotation about X, the same as every other angled
 * piece in this file.
 */
export type HairPermPart = HairLockPart;

/**
 * One swept bundle, as a grid of vertices the renderer uploads verbatim.
 *
 * The positions come from constants/hairRibbon.ts and nothing downstream reshapes
 * them - same contract as {@link HairScalpPart}, and for the same reason: it is
 * what lets `npm run audit:hair` measure the drawn surface without a renderer.
 */
export interface HairRibbonPart {
  key: string;
  positions: Vec3[];
  uvs: [number, number][];
}

export interface HairLayout {
  color: string;
  /** Welded to the skull. Animation must never move this. */
  scalp: HairScalpPart | null;
  /** Bangs. Same primitive and same solver as `locks`, just anchored up front. */
  fringe: HairLockPart[];
  /**
   * The bangs when a hat is on: swept sheets instead of rods, and then `fringe` is empty.
   * See FRINGE_SHEET_TUCK for why a hat needs a different primitive and not other numbers.
   */
  fringeSheets: HairRibbonPart[];
  crest: HairCrestPart | null;
  /** Welded to the skull like the domes - styling wax does not sway. */
  spikes: HairSpikePart[];
  /** Welded to the skull: these ARE the scalp, just a lumpy one. */
  perm: HairPermPart[];
  /** The only pieces follow-through sway is allowed to touch. */
  curtain: HairCurtainPart | null;
  /** Continuous swept bundles. Non-empty only for styles that declare `ribbons`. */
  ribbons: HairRibbonPart[];
  locks: HairLockPart[];
  sway: boolean;
  /**
   * The surfaces every other piece is supposed to be growing OUT of.
   *
   * Published so `measureRootGaps` can check that they are - see there for why a
   * hairstyle needs that checked rather than assumed.
   */
  mass: {
    /** Radius of the scalp shell this style was fitted to, centred at HEAD_ANCHOR.originY. */
    shellRadius: number;
    /** The curtain's crown and hem radii, and where the hem is. Null with no curtain. */
    curtain: { topRadius: number; hemRadius: number; hemY: number } | null;
  };
}

const A = HEAD_ANCHOR;

/** Polar angle (from +Y) at which the hair shell crosses height `y`. */
function polarAt(y: number, radius = HAIR_SHELL_RADIUS): number {
  return Math.acos(clamp((y - A.originY) / radius, -1, 1));
}

/**
 * The scalp dome's front rim reaches slightly BELOW the hairline the bangs are
 * rooted at, so it backs the gaps between adjacent bangs. Without the overlap a
 * row of scalp specks shows through where the rounded bang tops meet the rim.
 */
const FRINGE_SEAL = 0.055;

/**
 * How far ABOVE the hairline a bang is rooted, so its top is under the scalp dome.
 *
 * One constant rather than a per-style field, for the same reason {@link LOCK_TIP}
 * is: where hair comes out of a head is not a styling choice. See the note in the
 * bangs section for what it fixes.
 */
const FRINGE_ROOT_LIFT = 0.038;

/** Outward lean of a free-hanging lock, radians. Bottoms flare away from the body. */
const LOCK_LEAN = -0.15;

/**
 * How thin a hanging lock's tip is, as a fraction of its root.
 *
 * 0.46, having been tried at 0.22. A fifth is what a single HAIR does and it is
 * not what a LOCK does: rendered, 0.22 gave a row of needles hanging off the mass
 * — the sausages became spines, which is a different wrong shape at the same size.
 * Just under a half still reads unmistakably as tapered where the old capsule read
 * as a rod, and the tips still overlap their neighbours instead of separating into
 * teeth. One constant rather than a per-style field on purpose: this is what hair
 * IS, not a choice a hairstyle gets to make.
 */
const LOCK_TIP = 0.46;

/**
 * The same, for bangs, and much blunter still.
 *
 * A fringe is cut ACROSS. Point-cutting softens its edge; it does not turn the
 * bangs into a row of triangles, which is exactly what the first attempt (0.34)
 * drew across every forehead in the shop — vampire teeth on a yellow face, the
 * single worst thing this pass produced. At 0.72 the taper is a softened end on a
 * piece that is still a piece, and the neighbouring bangs still meet.
 */
const FRINGE_TIP = 0.72;

/**
 * How far a style's shell may stand off the skull. The floor is what keeps a
 * clipper cut from z-fighting the head sphere it is drawn on; the ceiling keeps a
 * perm inside HAIR_ENVELOPE.maxRadius with room for its clumps on top.
 */
const BULK_RANGE = { min: 0.008, max: 0.05 } as const;

/** Horizontal radius of a shell of radius `shellR` at height `y`. */
function shellRadiusAt(y: number, shellR: number): number {
  const dy = y - A.originY;
  return Math.sqrt(Math.max(0, shellR * shellR - dy * dy));
}

// ============================================================================
// THE SCALP SHELL - one surface, one solved hairline. See {@link HairScalpPart}.
// ============================================================================

/**
 * How far inside the skull the rim is buried.
 *
 * Not zero and not large. Zero would leave the rim coplanar with the head sphere,
 * which z-fights; large would eat the hairline, because everything the shell spends
 * on diving inward it stops spending on coming down. 6mm on a 260mm skull is enough
 * that the two surfaces cross cleanly instead of fighting, and the crossing - not
 * the rim - becomes the visible edge of the hair.
 */
const RIM_SINK = 0.006;

/**
 * How much denser the rows are inside the rim's dive than over the rest of the column.
 *
 * The dive is only about 3deg wide and it is the part anyone actually looks at - it is
 * where the hair meets the skin - so it needs rows of its own. What it must NOT have is a
 * fixed NUMBER of rows: that was the first version, and it made the row layout jump the
 * moment a column's dive became non-zero. Two neighbouring columns either side of that
 * jump put their row 12 nearly 20deg apart, which stretches the quads between them into
 * long skewed slivers lying almost edge-on to the surface. Slivers like that shade wrong,
 * and a single-sided one drops out of the picture the moment the camera crosses its plane
 * - hair that vanishes when you turn the character. As a DENSITY it goes to zero with the
 * dive itself, so the layout is continuous all the way round the head.
 */
const ROW_CROWD = 8;

/**
 * The temple, in three parts: level, receding, then dropping.
 *
 * A hairline does not turn down in one move and neither does this one. Out to
 * TEMPLE_START it is level - the eyes sit 25deg off the midline and the outer brow at
 * about 32, so it runs flat across everything the fringe hangs over. From there to the
 * KNEE it RECEDES: a shallow slope back over the corner of the forehead. At the knee it
 * turns and drops, and that drop is the line in front of the ear, which on a real head
 * is close to vertical.
 *
 * The knee is solved rather than declared, and that is the point of having one. It sits
 * where the shell first comes far enough outboard to pass the cheek at all (see
 * `fitColumn`), because that is where the drop can start; ask for it any sooner and the
 * corridor pins the hairline at the brow for ten degrees and leaves a horizontal LEDGE
 * cut into the temple - which is a step, and a step is the defect this file is about.
 * Where the knee falls therefore depends on the style: a bulky shell is wider and clears
 * the cheek earlier, so its temple starts dropping sooner.
 */
const TEMPLE_START = 34 * DEG;
const TEMPLE_END = 58 * DEG;
/** How far above the corridor floor the knee sits, so the recession never touches it. */
const TEMPLE_KNEE_CLEARANCE = 0.014;

/** How far past the ear line the sideburn point hangs before the rim turns back up. */
const SIDEBURN_TIP = 0.008;
/** How far the rim swells up over and behind the ear, and drops again at the nape. */
const EAR_LIFT = 0.016;
const NAPE_DROP = 0.009;

/**
 * Extra clearance the solved hairline keeps outside HAIR_ENVELOPE's corridor.
 *
 * The solver can only see the vertices it places, so this covers the sag between two
 * of them. Small, because the corridor is the binding constraint on how far the
 * temple may come down and every millimetre of margin is a millimetre of hairline
 * given away - see `fitColumn`.
 */
const CORRIDOR_MARGIN = 0.003;

/**
 * Azimuths the hairline is SOLVED at, before it is resampled down to SCALP_COLUMNS.
 *
 * Finer than the mesh on purpose: the solve has to find the shape before the mesh
 * can be spent on it. See `resampleColumns`.
 */
const SCALP_SOLVE_STEPS = 288;

/**
 * Is this point inside the skull - drawn, but behind the head's own surface?
 *
 * Asked because the rim is buried ON PURPOSE, and the envelope's face corridor would
 * otherwise read that burial as hair over a cheek. The corridor exists to keep hair
 * off the FACE, and geometry the head sphere stands in front of covers nothing: it
 * cannot be seen from anywhere. 2mm of slack, so a point that merely grazes the
 * skull still counts as visible and still has to answer for itself.
 */
export function buriedInSkull(p: Vec3): boolean {
  return Math.hypot(p[0], p[1], p[2]) < A.radius - 0.002;
}

/** Is this point inside the corridor the envelope keeps clear in front of the face? */
function inFaceCorridor(p: Vec3, margin = 0): boolean {
  return (
    p[1] < HAIR_ENVELOPE.faceClearY
    && Math.abs(p[0]) < HAIR_ENVELOPE.faceClearHalfWidth + margin
    && p[2] > HAIR_ENVELOPE.faceClearMinZ - margin
  );
}

/**
 * The features the corridor is a stand-in for, read off the face legacy/index.tsx draws.
 * Mirrored in x, so one entry is both of a pair.
 */
const FACE_FEATURES: ReadonlyArray<{ at: Vec3; radius: number }> = [
  { at: [0.104, 0.035, 0.225], radius: 0.036 }, // eye
  { at: [0.122, -0.029, 0.180], radius: 0.056 }, // blush
];
/** How far clear of every feature hair has to stay. Two centimetres on a 26cm skull. */
const FACE_FEATURE_CLEARANCE = 0.02;

/**
 * Is this point actually in front of the face - i.e. could it hide an eye or a cheek?
 *
 * WHY THIS EXISTS ON TOP OF THE CORRIDOR. The corridor is a BOX, and a box is a proxy:
 * HAIR_ENVELOPE's own comment says what it is proxying for - 「nothing passes in front of
 * the eyes (|x| <= 0.140) or the cheeks (|x| <= 0.178)」 - and the box is drawn at 0.2,
 * a good 22mm outside the widest of them. That margin was free as long as hair was
 * either at a style's full bulk (well outside 0.2 at the temple) or absent.
 *
 * Pressing a shell onto the skull under a hat put geometry INTO the margin for the first
 * time: 貝雷帽 rides low on one side, so its hair comes out over the temple at |x| around
 * 0.19 - inside the box, 4cm from the nearest blush, and lying on the skull where the
 * head itself is the only thing anyone can see. Read as a corridor breach that is "hair
 * over the eyes", which it is not.
 *
 * So a point in the box now has to answer the question the box was asking: measured as an
 * ANGLE from the head's centre, is it within a feature's own reach, and further out than
 * the feature is? Anything that passes this really would cover something; anything that
 * fails it is beside the face, not on it. Nothing that used to be caught escapes - this
 * only ever narrows what the box flags, and never widens it.
 */
export function coversFace(p: Vec3): boolean {
  if (!inFaceCorridor(p)) return false;
  const len = Math.hypot(p[0], p[1], p[2]);
  if (len < 1e-6) return false;
  for (const feature of FACE_FEATURES) {
    for (const side of [1, -1]) {
      const c: Vec3 = [feature.at[0] * side, feature.at[1], feature.at[2]];
      const cLen = Math.hypot(c[0], c[1], c[2]);
      // Behind the feature: it is in front of this point, not the other way round.
      if (len <= cLen) continue;
      const cos = (p[0] * c[0] + p[1] * c[1] + p[2] * c[2]) / (len * cLen);
      const reach = Math.asin(clamp((feature.radius + FACE_FEATURE_CLEARANCE) / cLen, 0, 1));
      if (Math.acos(clamp(cos, -1, 1)) < reach) return true;
    }
  }
  return false;
}

/** Polar angle the rim's dive is spread over. Zero where a column does not dive. */
function scalpRollSpan(radius: number, rimRadius: number, tuck: number, rimTheta: number): number {
  // As far inward as it travels downward, so the dive is roughly as wide as it is deep.
  return Math.min(((radius - rimRadius) * clamp(tuck, 0, 1)) / radius, rimTheta);
}

/**
 * Polar angle of row `j`.
 *
 * Not evenly spaced: rows bunch up inside the dive by {@link ROW_CROWD}, so the few
 * degrees where the shell turns into the skull get enough of them to read as a turn
 * rather than as a chamfer. The split point is solved from the dive's own width, which
 * is what keeps it continuous - a column with no dive gets evenly spaced rows and its
 * neighbour with a hair's-breadth of dive gets very nearly the same ones.
 */
function rowThetaFrom(v: number, from: number, rimTheta: number, span: number): number {
  const body = rimTheta - span - from;
  if (body <= 1e-9) return from + (rimTheta - from) * v;
  const split = body / (body + ROW_CROWD * span);
  return v <= split
    ? from + (body * v) / split
    : from + body + (span * (v - split)) / (1 - split);
}

/**
 * With no hat, `top` and `flare` are both zero and this is exactly the split above.
 *
 * Under a hat the shell starts at `top` rather than at the crown - see
 * {@link HairScalpPart.press} - and the rows are split once more, so the flare where
 * the hair comes out from under the brim gets {@link HAT_ROW_SHARE} of them instead
 * of the two or three an even spread over the whole band would leave it.
 */
function scalpRowTheta(j: number, rimTheta: number, span: number, top = 0, flare = 0): number {
  const v = clamp(j, 0, SCALP_ROWS) / SCALP_ROWS;
  if (flare <= top) return rowThetaFrom(v, top, rimTheta, span);
  if (v <= HAT_ROW_SHARE) return top + ((flare - top) * v) / HAT_ROW_SHARE;
  return rowThetaFrom((v - HAT_ROW_SHARE) / (1 - HAT_ROW_SHARE), flare, rimTheta, span);
}

/**
 * How far off the SKULL the shell is held where the two would otherwise meet.
 *
 * The shell is a sphere about {@link HEAD_ANCHOR.originY}, which is 26mm above the head's
 * own centre - that lift is what gives a style its volume on top. The cost is at the
 * bottom: below about y=-0.06 the lifted sphere sinks back inside the skull, so on a
 * close-cut style the visible edge of the hair was not the rim at all, it was the line
 * where two nearly parallel spheres cut through each other. Two near-tangent tessellated
 * spheres intersect in a row of saw teeth, and that is exactly what the nape looked like.
 *
 * So the shell is floored: never nearer the skull than this. It only ever engages low
 * down on the thinnest styles, and where it does the hair simply follows the skull, which
 * is what hair does.
 */
const SHELL_FLOOR = 0.006;
/** Width of the soft maximum that applies it, so the floor blends in instead of creasing. */
const SHELL_FLOOR_BLEND = 0.012;

/**
 * A point on the shell, head-local.
 *
 * One function, shared by the geometry builder, `measureHairBounds` and the corridor
 * solver below, so all three are looking at the same surface. That sharing is what
 * lets `npm run audit:hair` compare "what the layout says" with "what is drawn" and
 * have the comparison mean anything.
 */
function scalpPoint(
  yaw: number,
  theta: number,
  rimTheta: number,
  radius: number,
  rimRadius: number,
  tuck: number,
  occiput: number,
  centreY: number,
  /** This column's press profile, when a hat is on. See {@link HairScalpPart.press}. */
  press?: { radius: number; top: number; flare: number },
): Vec3 {
  const sin = Math.sin(theta);
  // The occipital bulge, weighted by how far BACK the surface faces: full at the nape,
  // nothing at the ears, so it grows out of the skull instead of being a patch with a
  // border. Smoothstepped rather than used raw, because the raw weight has a corner at
  // the ears and a corner in a surface is a lit crease down the side of the head - the
  // exact class of defect this file exists to stop drawing.
  const back = Math.max(0, -Math.cos(yaw));
  const x = radius * sin * Math.sin(yaw);
  const y = centreY + radius * Math.cos(theta);
  const z = radius * sin * Math.cos(yaw) * (1 + occiput * back * back * (3 - 2 * back));

  const len = Math.max(1e-6, Math.hypot(x, y, z));
  const floor = A.radius + SHELL_FLOOR;
  const free =
    0.5 * (len + floor + Math.sqrt((len - floor) ** 2 + SHELL_FLOOR_BLEND * SHELL_FLOOR_BLEND));
  // The hat, if there is one: flat on the skull above the brim, and back out to the
  // style's own volume by the end of the flare. Smoothstepped, because the whole
  // point of the ramp is that it has no step in it at either end - a linear release
  // leaves a crease where it meets the free shell, and a crease running round the
  // head under a hat brim is the same 「斷層」 read one centimetre lower down.
  let held = free;
  if (press) {
    // Measured from the TOP of the band and not from the brim, which is the whole
    // difference between "hair appears under the hat" and "hair appears a centimetre
    // under the hat, with a bright ring of scalp in between". Starting the ramp at the
    // brim leaves the shell still 95% pressed - i.e. still inside the skull - for the
    // first few millimetres below it, and that band of skin showing under the brim is
    // the first thing the eye finds. Started HAT_PRESS_RISE higher up, where the hat
    // is still covering it, the shell crosses the skull's own surface at the brim
    // line, so the hair starts exactly where the hat stops.
    const span = press.flare - press.top;
    const t = span > 1e-6 ? clamp((theta - press.top) / span, 0, 1) : 1;
    const release = t * t * (3 - 2 * t);
    held = press.radius + (free - press.radius) * release;
  }
  // ...and then, at the very rim, straight down through the skull. Cubed rather than
  // smoothstepped: the dive has to CROSS the head sphere, and it is the crossing you see
  // as the end of the hair, so it wants to happen over as little surface as possible.
  // Held out at nearly full radius and then turned in hard, that line is as clean as the
  // hairline behind it; eased gently, it is another shallow intersection and another row
  // of saw teeth.
  const dive = held + (rimRadius - held) * clamp(tuck, 0, 1);
  const span = scalpRollSpan(radius, rimRadius, tuck, rimTheta);
  const t = span > 1e-6 ? clamp((theta - (rimTheta - span)) / span, 0, 1) : 0;
  const scale = (held + (dive - held) * t * t * t) / len;
  return [x * scale, y * scale, z * scale];
}

/** Vertex (column `i`, row `j`) of the shell, head-local. Rows run crown to rim. */
export function scalpVertex(part: HairScalpPart, i: number, j: number): Vec3 {
  const col = ((i % SCALP_COLUMNS) + SCALP_COLUMNS) % SCALP_COLUMNS;
  const rimTheta = part.rim[col];
  const tuck = part.tuck[col];
  const press = part.press;
  return scalpPoint(
    part.yaw[col],
    scalpRowTheta(
      j,
      rimTheta,
      scalpRollSpan(part.radius, part.rimRadius, tuck, rimTheta),
      press ? press.top[col] : 0,
      press ? press.flare[col] : 0,
    ),
    rimTheta,
    part.radius,
    part.rimRadius,
    tuck,
    part.occiput,
    part.y,
    press ? { radius: press.radius, top: press.top[col], flare: press.flare[col] } : undefined,
  );
}

/**
 * How far down one column is ALLOWED to come.
 *
 * The anatomy wants the hairline to plunge at the temple; the envelope will not have
 * hair in front of a cheek. The two disagree over about 15deg of azimuth, and this is
 * where that is settled - by measurement rather than by a hand-picked angle.
 *
 * It matters that it is solved and not declared. The blush the corridor protects
 * reaches x=0.178 at roughly 45deg off the midline, so a temple can come down early
 * and shallow or late and deep but not both, and where the trade lands depends on the
 * style's own bulk (a bulkier shell is wider, so it clears the cheek sooner) and on
 * how far its rim has already tucked (tucking pulls the rim inward, which costs width
 * exactly where width is scarce). Every style therefore gets the lowest hairline its
 * own proportions can carry, and no style can be handed one that lands on a face.
 *
 * A SCAN, not a bisection, and that is not a detail: the test is not monotone in
 * depth. A rim deep enough to be buried in the skull passes where a shallower one -
 * still outside the head, and by then level with a cheek - fails. Bisection stops at
 * the first crossing, which is the brow, and gives away the whole plunge; that is the
 * difference between a hairline that turns down in front of the ear and one that
 * stops dead above it.
 */
function fitColumn(
  yaw: number,
  wanted: number,
  radius: number,
  rimRadius: number,
  tuck: number,
  occiput: number,
): number {
  // Behind the ears the corridor is simply not there: z is negative all the way down
  // this column, so none of it can be in front of anything.
  if (Math.cos(yaw) <= 0) return wanted;
  const breaches = (rimTheta: number) => {
    const span = scalpRollSpan(radius, rimRadius, tuck, rimTheta);
    for (let j = 0; j <= SCALP_ROWS; j++) {
      const p = scalpPoint(
        yaw, scalpRowTheta(j, rimTheta, span), rimTheta,
        radius, rimRadius, tuck, occiput, A.originY,
      );
      if (buriedInSkull(p)) continue;
      if (inFaceCorridor(p, CORRIDOR_MARGIN)) return true;
    }
    return false;
  };
  if (!breaches(wanted)) return wanted;
  const STEPS = 96;
  for (let k = 1; k <= STEPS; k++) {
    const deep = (wanted * (STEPS - k)) / STEPS;
    if (breaches(deep)) continue;
    // Recover most of the step: everything between here and the depth that failed is
    // still worth having, and at the temple one step is most of a centimetre.
    let safe = deep;
    let over = (wanted * (STEPS - k + 1)) / STEPS;
    for (let r = 0; r < 6; r++) {
      const mid = (safe + over) / 2;
      if (breaches(mid)) over = mid;
      else safe = mid;
    }
    return safe;
  }
  return 0;
}

/**
 * Where the rim goes once it is past the temple.
 *
 * A latitude circle is the one thing it must not be, and that is exactly what it was:
 * the old side patch was cropped at a constant polar angle, so every head in the shop
 * carried a dead-level line right round it. Level is the silhouette of a CAP. Hair
 * has a sideburn point in front of the ear, swells over and behind it, and drops
 * again into the nape, and it is that undulation - not the length - that separates a
 * haircut from a thing put on a head.
 *
 * `p` runs 0 at the temple to 1 at the back of the skull. Both ends are flat (zero
 * slope at p=1) so the two sides meet across the midline without a crease.
 */
function napeOffset(a: number): number {
  const p = clamp((a - TEMPLE_END) / (Math.PI - TEMPLE_END), 0, 1);
  return EAR_LIFT * (1 - Math.cos(2 * Math.PI * p)) * 0.5 - NAPE_DROP * p * p * (3 - 2 * p);
}

/**
 * Redistributes the mesh's columns along the solved hairline.
 *
 * Evenly spaced azimuths are the wrong sampling for this shape and by a long way. The
 * temple plunge drops 16cm inside about 7deg - that is what the face corridor forces,
 * and it is anatomically right, a real hairline in front of an ear is close to
 * vertical - so at even spacing the whole plunge lands in two columns and renders as
 * one enormous stair. The rest of the rim, meanwhile, is nearly level and could be
 * described by a fraction of the columns it is being given.
 *
 * So columns are placed at equal steps of arc length ALONG the rim, with the
 * horizontal term weighted down: what has to be sampled finely is where the rim
 * MOVES, and the mesh only needs enough columns elsewhere to stay round.
 */
function resampleColumns(step: number, rimY: number[], radius: number): number[] {
  /** How much a millimetre sideways counts against a millimetre down. */
  const HORIZONTAL = 0.3;
  const n = rimY.length;
  const cost: number[] = [0];
  for (let i = 1; i <= n; i++) {
    cost.push(cost[i - 1] + Math.hypot(step * radius * HORIZONTAL, rimY[i % n] - rimY[i - 1]));
  }
  const total = cost[n];
  const out: number[] = [];
  let at = 0;
  for (let c = 0; c < SCALP_COLUMNS; c++) {
    const want = (total * c) / SCALP_COLUMNS;
    while (at < n - 1 && cost[at + 1] < want) at++;
    const span = cost[at + 1] - cost[at];
    const f = span > 1e-9 ? (want - cost[at]) / span : 0;
    out.push(-Math.PI + (at + f) * step);
  }
  return out;
}

/**
 * The steepest the hairline is allowed to fall, in head-local y per radian of azimuth.
 *
 * This exists because the face corridor is a flat WALL at |x| = 0.2, and a wall makes a
 * cliff rather than a curve. A meridian either clears that wall at its widest point or
 * it does not, and the moment it does it clears a whole band of latitudes at once - so
 * the solved hairline drops about 10cm between two neighbouring azimuths and the temple
 * is back to being a vertical chop, only a shorter one. Nothing about that is anatomy;
 * it is the shape of the guardrail showing through the hair.
 *
 * So the rim is eroded to this slope afterwards. Erosion only ever RAISES it, and at 2.2
 * it costs remarkably little: the cliff becomes a 3deg ramp and the sides still reach the
 * ear line by about 55deg, which is sooner than the old wall stood at.
 */
const MAX_RIM_SLOPE = 2.2;

/**
 * Solved shells, by the five numbers that define one.
 *
 * Everything else in this file is closed-form arithmetic that costs nothing to redo on
 * every render. The shell is not: the hairline is fitted against the face corridor at 288
 * azimuths and then relaxed against its own slope, which is a few milliseconds - fine once,
 * far too much per avatar per re-render in a scene with a crowd in it.
 *
 * Safe to cache because `buildScalp` is a pure function of these five arguments and the
 * part it returns is read-only to everything downstream: HairPiece maps it to geometry,
 * `measureHairBounds` samples it, and neither writes. Keyed by value rather than by style
 * id on purpose, so two styles that happen to share a skull share a solve.
 */
const SOLVED_SCALPS = new Map<string, HairScalpPart>();

/**
 * Solves the whole shell: the hairline curve, clamped, eroded, and the rim's roll-under.
 *
 * `frontRimY` is where the shell hands over to the bangs at the very front, and is
 * the one height this has to agree with something else about - see `fringeBackY`.
 */
function buildScalp(
  radius: number,
  frontRimY: number,
  asym: number,
  occiput: number,
  hasFringe: boolean,
  hat: HatBrim | null,
): HairScalpPart {
  const hatKey = hat ? `${hat.y}|${hat.leanX ?? 0}|${hat.leanZ ?? 0}` : 'bare';
  const cacheKey = `${radius}|${frontRimY}|${asym}|${occiput}|${hasFringe}|${hatKey}`;
  const cached = SOLVED_SCALPS.get(cacheKey);
  if (cached) return cached;
  const rimRadius = A.radius - RIM_SINK;

  // Where this shell first reaches far enough outboard to pass the cheek. 0.97 of the
  // radius because the binding row is not the widest one - it is the row level with the
  // brow, already a little narrower - and the couple of degrees on top absorb the rim.
  const knee = clamp(
    Math.asin(clamp((HAIR_ENVELOPE.faceClearHalfWidth + CORRIDOR_MARGIN) / (radius * 0.97), 0, 1))
      + 2 * DEG,
    TEMPLE_START + 6 * DEG,
    TEMPLE_END - 4 * DEG,
  );
  const kneeY = Math.min(frontRimY, HAIR_ENVELOPE.faceClearY + TEMPLE_KNEE_CLEARANCE);

  /** The hairline the anatomy asks for at this azimuth, before the envelope answers. */
  const wantedRimY = (yaw: number) => {
    const a = Math.abs(yaw);
    const tip = A.earY - SIDEBURN_TIP;
    const recede = clamp((a - TEMPLE_START) / (knee - TEMPLE_START), 0, 1);
    const drop = clamp((a - knee) / (TEMPLE_END - knee), 0, 1);
    const ease = drop * drop * (3 - 2 * drop);
    const brow = frontRimY + (kneeY - frontRimY) * recede * recede * (3 - 2 * recede);
    // The parting, seen from the other end of the head: one temple cut a little
    // higher than the other. Same `sideLean` shape everything asymmetric in this file
    // uses, so a style still leans as one thing - and it acts only THROUGH the turn,
    // which leaves the forehead's own hairline level and symmetric where it shows.
    return brow + (tip - brow) * ease + napeOffset(a) + asym * 0.014 * Math.sin(yaw) * ease;
  };
  /**
   * How much a column rolls under.
   *
   * None at the very front, because up there the rim is already hidden: the bangs
   * root above it and hang past it, which is what FRINGE_SEAL is for, and rolling a
   * rim the fringe is sealing against would open the seam it exists to close. The
   * roll comes on with the temple turn and is full by the ear line - which is where
   * the rim starts being something anyone can see. With no fringe nothing covers the
   * front rim either, so it rolls too, halfway, and a buzz cut's hairline still reads
   * as a hairline rather than as the edge of a cap.
   */
  const tuckAt = (rimY: number) => {
    const descent = clamp((frontRimY - rimY) / Math.max(1e-6, frontRimY - A.earY), 0, 1);
    return hasFringe ? descent : Math.max(descent, 0.5);
  };

  /**
   * Fits one column to the hairline height asked of it, and reports where it landed.
   *
   * The polar angle runs DEEPER than `targetY` by exactly the roll, so the surface still
   * passes through the target at full radius before it turns in; without that the roll
   * would quietly shorten every side in the shop by its own depth.
   */
  const solve = (yaw: number, targetY: number) => {
    const tuck = tuckAt(targetY);
    const roll = ((radius - rimRadius) / radius) * tuck;
    const theta = fitColumn(
      yaw, Math.min(polarAt(targetY, radius) + roll, 130 * DEG), radius, rimRadius, tuck, occiput,
    );
    return { theta, tuck, y: A.originY + radius * Math.cos(Math.max(0, theta - roll)) };
  };

  /**
   * Erodes the hairline to MAX_RIM_SLOPE, then re-fits, until the two agree.
   *
   * Both halves only ever raise the rim, so this converges upward and cannot walk the
   * hair back onto a face. It has to alternate rather than run once because they undo
   * each other locally: erosion asks a column to come down where the corridor will not
   * have it, the fit puts that column back up, and the raise then has to be carried out
   * to its neighbours in turn.
   */
  const relax = (yaws: number[], y: number[]) => {
    const gap = (i: number) => {
      const d = yaws[i] - yaws[(i - 1 + yaws.length) % yaws.length];
      return d > 0 ? d : d + 2 * Math.PI;
    };
    for (let pass = 0; pass < 4; pass++) {
      for (let lap = 0; lap < 2; lap++) {
        for (let i = 0; i < yaws.length; i++) {
          const p = (i - 1 + yaws.length) % yaws.length;
          y[i] = Math.max(y[i], y[p] - MAX_RIM_SLOPE * gap(i));
        }
        for (let i = yaws.length - 1; i >= 0; i--) {
          const n = (i + 1) % yaws.length;
          y[i] = Math.max(y[i], y[n] - MAX_RIM_SLOPE * gap(n));
        }
      }
      for (let i = 0; i < yaws.length; i++) y[i] = solve(yaws[i], y[i]).y;
    }
  };

  // ---- solve on a fine even grid, to find the shape ----------------------
  const step = (2 * Math.PI) / SCALP_SOLVE_STEPS;
  const fineYaws: number[] = [];
  const fineY: number[] = [];
  for (let i = 0; i < SCALP_SOLVE_STEPS; i++) {
    const a = i * step - Math.PI;
    fineYaws.push(a);
    fineY.push(solve(a, wantedRimY(a)).y);
  }
  relax(fineYaws, fineY);

  // ---- spend the mesh's columns where that shape actually moves ----------
  const yaw = resampleColumns(step, fineY, radius);
  const columnY = yaw.map(a => {
    const f = (a + Math.PI) / step;
    const lo = Math.floor(f);
    const at = (k: number) => fineY[((k % SCALP_SOLVE_STEPS) + SCALP_SOLVE_STEPS) % SCALP_SOLVE_STEPS];
    return solve(a, at(lo) * (1 - (f - lo)) + at(lo + 1) * (f - lo)).y;
  });
  // Again on the real columns: the fine grid's answer is not the same answer at an
  // azimuth halfway between two of its samples, and it is the columns that get drawn.
  relax(yaw, columnY);

  const rim: number[] = [];
  const tuck: number[] = [];
  for (let i = 0; i < yaw.length; i++) {
    const fit = solve(yaw[i], columnY[i]);
    rim.push(fit.theta);
    tuck.push(fit.tuck);
  }
  // The key carries the hat, because the hat changes the SURFACE and not just the
  // layout: wardrobe.tsx caches one BufferGeometry per distinct shell and looks it up
  // by the numbers on this part. Without the hat in there a hatted head silently
  // redraws whichever shell was built first - `npm run audit:hair` catches it as the
  // drawn mesh reaching 10cm above the layout that was asked for.
  const part: HairScalpPart = {
    key: `scalp-${hatKey}`, y: A.originY, radius, rimRadius, occiput, yaw, rim, tuck,
  };

  // ---- and, under a hat, where the band that is left starts and lets go -----
  //
  // Deliberately AFTER the solve and not inside it: the press only ever pulls the
  // surface inward, and inward is away from the cheek, so a pressed column cannot
  // breach a corridor the free one cleared. Solving twice would spend milliseconds
  // to arrive at the same hairline - and would let the hairline move when a player
  // puts a hat on, which is a second thing to explain and no better to look at.
  if (hat) {
    const top: number[] = [];
    const flare: number[] = [];
    for (let i = 0; i < yaw.length; i++) {
      const brimY = hatHairlineY(hat, yaw[i]);
      // Clamped into the column's own rim, so where the hairline is already ABOVE
      // the hat - the whole forehead, on every hat - the two collapse onto it and
      // the band closes to nothing rather than reaching past the rim it belongs to.
      const t0 = Math.min(polarAt(brimY + HAT_PRESS_RISE, radius), rim[i]);
      const t1 = Math.min(Math.max(polarAt(brimY - HAT_PRESS_FLARE, radius), t0), rim[i]);
      top.push(t0);
      flare.push(t1);
    }
    part.press = { radius: HAT_PRESSED_RADIUS, top, flare };
  }

  SOLVED_SCALPS.set(cacheKey, part);
  return part;
}

/**
 * Axis length of a capsule whose SURFACE spans topY..bottomY at `lean`.
 *
 * Separate from `hangCapsule` because the placement solver needs the length
 * before it can decide where the capsule is allowed to hang - see `clearingYaw`.
 */
function capsuleLength(topY: number, bottomY: number, thickness: number, lean: number): number {
  const span = Math.max(2 * thickness + 1e-4, topY - bottomY);
  return Math.max(1e-4, (span - 2 * thickness) / Math.cos(lean));
}

/**
 * Smallest yaw at which a piece of body-radius `thickness`, sitting on a ring of
 * radius `ring`, clears the corridor in front of the face.
 *
 * WHY THIS IS NOT JUST `faceHalfArc`. The face window is an ANGLE; the corridor
 * that has to stay empty is a BOX. The two only agree while the ring is wide.
 * Narrow it - a tucked 內彎 hem, a curl clump low on the skull - and a piece
 * parked exactly on the window's edge crosses the cheek line without its angle
 * having changed at all. `npm run audit:hair` caught precisely that: 短髮內彎's
 * side locks reached y=-0.180 in front of the face while sitting at the same 56deg
 * every other style uses safely. So the angle is solved from the ring the piece is
 * actually on, rather than assumed.
 */
function clearingYaw(ring: number, thickness: number): number {
  const clearX = HAIR_ENVELOPE.faceClearHalfWidth + thickness;
  // Too close in to clear by width at any angle: go side-on, where the piece
  // leaves the corridor by depth (z) instead.
  if (ring <= clearX) return Math.PI / 2;
  // The epsilon lands the tangent case strictly outside the line, not exactly on it.
  return Math.asin(clamp(clearX / ring, 0, 1)) + 0.02;
}

/**
 * Hangs a capsule so its top sits at `topY` and its tip at `bottomY`, leaning by
 * `lean`. Solving for the length instead of positioning by eye is what makes the
 * envelope clamp meaningful: clamp the endpoints, and the geometry follows.
 */
function hangCapsule(
  key: string,
  yaw: number,
  ring: number,
  topY: number,
  bottomY: number,
  thickness: number,
  lean = LOCK_LEAN,
  tip?: number,
): HairLockPart {
  // topY/bottomY are the capsule's SURFACE extremes, not its axis endpoints, so
  // the envelope clamp applied to them is exactly what ends up on screen.
  const length = capsuleLength(topY, bottomY, thickness, lean);
  return {
    key,
    yaw,
    position: [0, (topY + bottomY) / 2, ring],
    rotation: [lean, 0, 0],
    args: [thickness, length, 8, 16],
    ...(tip === undefined ? {} : { tip }),
  };
}

/**
 * A lock broken into segments whose JOINS are displaced sideways - the one solver
 * behind both the S of 大波浪 and the C of 內彎.
 *
 * Each segment is an ordinary `hangCapsule`; only its lean is different, and that
 * is SOLVED from where the segment has to start and end rather than picked, so the
 * chain joins up and the whole lock still spans exactly topY..bottomY. Keeping the
 * endpoints exact is what lets a curved lock stay inside HAIR_ENVELOPE on the same
 * clamp as a straight one.
 *
 * Only the join offsets tell a wave from a hook, which is why they are a parameter
 * rather than two copies of this function: a wave alternates out and back, a hook
 * stays put and then pulls in over the last stretch. Both are "where is the join",
 * and neither may move an endpoint.
 *
 * The segment count is cut down to what the drop can actually hold: a capsule
 * cannot be shorter than its own diameter, so asking for more curve than there is
 * length for would silently push the last segment through the envelope floor.
 * Below two segments it degrades to a plain straight lock.
 */
function segmentedLock(
  key: string,
  yaw: number,
  ring: number,
  topY: number,
  bottomY: number,
  thickness: number,
  lean: number,
  requested: number,
  /** Ring offset at join `i` of `segments`, i running 0 (root) to segments (tip). */
  offsetAt: (i: number, segments: number) => number,
  tipRatio = LOCK_TIP,
): HairLockPart[] {
  // A segment has to be at least three and a bit times its own radius long.
  //
  // The obvious floor is a capsule's own diameter, and it is too low by half: a
  // tapered piece is drawn as a cylinder shorter than its span by a radius at each
  // end, so at the diameter the DRAWN segment comes out roughly as wide as it is
  // long. Chained at angles to each other, those are not a curve - they are a
  // handful of little blocks, and a bob's short locks broken into three of them
  // read from behind as a crown of thorns rather than as 內彎. Curving a lock too
  // short to hold the curve is worse than leaving it straight, so this silently
  // gives the short ones fewer segments instead.
  const segments = Math.max(
    1,
    Math.min(requested, Math.floor((topY - bottomY) / (3.2 * thickness))),
  );
  const step = (topY - bottomY) / segments;

  // The chain's own taper, segment to segment, so the thinning is continuous
  // across the seams rather than restarting at each one.
  // The chain narrows toward the tip by however much the cut asks for, spread over
  // the whole chain so the thinning is continuous across the seams. A blunt cut
  // barely narrows at all.
  const chainTaper = 0.22 * clamp((1 - tipRatio) / (1 - LOCK_TIP), 0, 1.2);
  const segThickness = (s: number) => thickness * (1 - chainTaper * (s / segments));

  return Array.from({ length: segments }, (_, s) => {
    const last = s === segments - 1;
    const t = segThickness(s);
    const segBottom = topY - (s + 1) * step;
    // Every segment but the first has its top pushed up by one radius, because a
    // tapered piece is drawn as a bare CYLINDER of the capsule's axis length - a
    // radius short at each end (see LockGeometry). Chained, that shortfall opens a
    // gap at every join and the lock reads as a string of beads instead of as one
    // curved strand. Only the top is extended, and only on interior segments, so
    // the two ends of the chain still land exactly on topY and bottomY and the
    // envelope this lock reports is the one it had when it was straight.
    const segTop = topY - s * step + (s === 0 ? 0 : t);
    const oTop = offsetAt(s, segments);
    const oBottom = offsetAt(s + 1, segments);
    return {
      ...hangCapsule(
        `${key}-w${s}`,
        yaw,
        // Floored so a deep hook cannot pull a lock through the head's own axis.
        Math.max(t, ring + (oTop + oBottom) / 2),
        segTop,
        segBottom,
        // Tapered toward the tip; a curve of constant thickness reads as a hose.
        t,
        // The style's own hang, plus whatever the seam demands on top of it.
        lean - Math.atan2(oBottom - oTop, segTop - segBottom),
        // Each segment ends at the next one's width, and the last comes to a point.
        last ? tipRatio : segThickness(s + 1) / segThickness(s),
      ),
      // Where this segment falls along the strand as a whole, so the shading ramp
      // and its highlight bands cross the seams instead of restarting at each one.
      span: [s / segments, (s + 1) / segments] as const,
    };
  });
}

/**
 * Join offsets for a wave: alternately out and back, growing toward the tip.
 *
 * Only ever outward - a wave swinging inward would bury itself in the curtain it
 * hangs on. `phase` flips which joins bulge, which is the cheapest possible way to
 * make one lock curl the opposite way from its neighbour.
 */
const waveOffsets =
  (depth: number, phase: number) =>
  (i: number, segments: number) =>
    ((i + phase) % 2 === 0 ? 0 : depth) * (i / segments);

/**
 * Join offsets for a C-curl: nothing for most of the lock, then a smooth pull
 * inward over the last `hook` of its length.
 *
 * Squared rather than linear so the turn accelerates into the tip. A linear pull is
 * a straight diagonal joined to a straight vertical, i.e. a corner - which reads
 * exactly as stiff as the single tilted rod it was meant to replace.
 */
const hookOffsets =
  (depth: number, hook: number) =>
  (i: number, segments: number) => {
    const fromTip = (segments - i) / segments;
    if (fromTip >= hook) return 0;
    const t = 1 - fromTip / hook;
    return -depth * t * t;
  };

/**
 * One bang under a hat, as a swept sheet. See FRINGE_SHEET_TUCK.
 *
 * Every clump reaches for the eyelids - the floor bare bangs stop at too - and alternate ones
 * stop short of it, so the hem under the brim is the uneven row of points a drawn fringe has
 * rather than one ruled line. Returns null where the hat itself comes down to the eyes (the
 * low side of the 貝雷帽) and there is no brow left to lie on.
 */
function fringeSheet(
  key: string,
  yaw: number,
  i: number,
  count: number,
  arc: number,
  brim: HatBrim,
): HairRibbonPart | null {
  const line = hatHairlineY(brim, yaw);
  const lowest = line - FRINGE_SHEET_MIN_SHOW;
  if (lowest < A.faceClearY + 0.002) return null;
  const tipY = clamp(
    A.faceClearY + (i % 2) * FRINGE_SHEET_TIP_JITTER * 0.6
      + FRINGE_SHEET_TIP_JITTER * 0.4 * hashNoise(i * 4.1 + 0.7),
    A.faceClearY,
    lowest,
  );
  // Odd sheets lie a little over the even ones, for the same reason the back's bundles
  // are shingled: two overlapping sheets at one depth meet in a dark V that reads as a gap.
  const bed = A.radius + FRINGE_SHEET_STANDOFF + (i % 2) * FRINGE_SHEET_THICKNESS * 0.8;
  const polar = (y: number) => Math.acos(clamp((y - A.originY) / bed, -1, 1));
  const hemR = shellRadiusAt(tipY, bed);
  // Wide enough that neighbours overlap at their widest and still touch at the tip, where
  // the point narrows them - the 1.9 the back uses, for the same derivation.
  const halfWidth = (((2 * arc) / Math.max(1, count)) * hemR * 0.5) * 1.9;
  const built = buildRibbon({
    yaw,
    rootTheta: polar(line + FRINGE_SHEET_TUCK),
    leaveTheta: polar(tipY + 0.008),
    shellRadius: bed,
    shellOriginY: A.originY,
    bottomY: tipY,
    hemRadius: hemR + FRINGE_SHEET_LIFT,
    halfWidth,
    thickness: FRINGE_SHEET_THICKNESS,
    tipWidth: FRINGE_SHEET_TIP,
  });
  return {
    key,
    ...built,
    positions: built.positions.map(p => pressHairPoint(p, brim, FRINGE_HAT_RELEASE)),
  };
}

/** Azimuths evenly spaced across [start, start + span], centred in their slots. */
function spreadArc(count: number, start: number, span: number): number[] {
  if (count < 1) return [];
  if (count === 1) return [start + span / 2];
  const step = span / (count - 1);
  return Array.from({ length: count }, (_, i) => start + i * step);
}

/**
 * Turns a spec into placed, clamped geometry.
 *
 * Every hairstyle goes through this one function, so "all hairstyles follow the
 * same attachment rule" is not a convention anyone has to remember - it is the
 * only code path that exists.
 */
export function buildHairLayout(
  spec: HairSpec,
  { hat = null }: { hat?: HatBrim | null } = {},
): HairLayout | null {
  const underHat = hat !== null;
  const { color, cap, fringe, curls, flow, crest, spikes, perm, ribbons } = spec;
  /**
   * `ribbons` REPLACES the cone-and-rods back rather than adding to it.
   *
   * Stated here, once, instead of at each of the two build sites, because it is one
   * fact about the style and not two: a bundle-built back that also emitted a cone
   * would have the cone's tube silhouette inside it and the bundles hanging off the
   * outside - the exact 「球形頭盔與下方髮條生硬拼接」 the bundles exist to remove.
   * `curls` still runs: those frame the FACE and are a different piece of hair.
   */
  const fall = ribbons ? undefined : spec.fall;
  const strands = ribbons ? undefined : spec.strands;
  const layout: HairLayout = {
    color,
    scalp: null,
    fringe: [],
    fringeSheets: [],
    crest: null,
    spikes: [],
    perm: [],
    curtain: null,
    ribbons: [],
    locks: [],
    sway: !!spec.sway,
    // Filled in below, once the shell and the curtain have been solved.
    mass: { shellRadius: 0, curtain: null },
  };

  // How much hair this style has. Derived once here and threaded through every
  // piece below, so a bulky style's bangs, curtain and locks all sit on the same
  // enlarged shell instead of the fringe floating clear of a scalp it has left.
  const shellR = A.radius + clamp(spec.bulk ?? A.shell, BULK_RANGE.min, BULK_RANGE.max);
  /**
   * How far down the forehead the scalp dome carries on BEHIND the bangs.
   *
   * The dome used to stop just under the hairline, so from there to the eyebrows the
   * only hair was the bangs themselves - a row of separate rods with nothing behind
   * them. That is where 「瀏海與頭頂的銜接處有明顯的接縫感」 comes from, and it is
   * also why the fringe read as a corrugated visor clipped onto a smooth helmet:
   * the rods WERE the surface, so every one of them showed its whole round side and
   * the pitch of the row was the loudest thing on the model.
   *
   * With the dome carried down behind them the bangs become relief on a solid
   * fringe - which is what hair combed forward is - and there is no join to see,
   * because the two pieces are no longer edge to edge. It stops three quarters of
   * the way down the SHORTEST bang, so the tips still hang past it and break the
   * dome's own rim rather than lining up with it, and it never passes the eyelids.
   */
  const fringeBackY = spec.fringe
    ? clamp(
        A.hairlineY - spec.fringe.drop * (1 - clamp(spec.fringe.jitter ?? 0.28, 0, 0.6)) * 0.75,
        A.faceClearY + 0.006,
        A.hairlineY - FRINGE_SEAL,
      )
    : A.hairlineY - FRINGE_SEAL;
  /** How far the two sides are allowed to disagree. See {@link HairSpec.asymmetry}. */
  const asym = clamp(spec.asymmetry ?? 0, 0, 1);
  /**
   * The side-lean shape: +1 on one side of the head, -1 on the other, 0 at the
   * front and at the back. Everything asymmetric in this file is this one curve
   * times a small coefficient, so a style leans as a WHOLE rather than picking up
   * an unrelated bias per feature - and the parting stays where the fringe put it.
   */
  const sideLean = (yaw: number) => asym * Math.sin(yaw);

  // --- Scalp -------------------------------------------------------------
  // One shell with a solved hairline, not two cropped patches meeting at a wall.
  // The whole of why is in {@link HairScalpPart}; `buildScalp` does the solving.
  //
  // Built with the hat ON rather than skipped when one is worn: the hat presses the
  // shell onto the skull instead of deleting it, which is what leaves hair showing
  // under the brim and what carries the join down to the hanging pieces. See the
  // HAIR UNDER A HAT note at the top of this file for the two defects that fixes.
  if (cap) {
    layout.scalp = buildScalp(
      shellR, fringeBackY, asym, clamp(spec.occiput ?? 0, 0, 0.16), !!fringe, hat,
    );
  }

  // --- Bangs -------------------------------------------------------------
  if (fringe && fringe.count > 0) {
    const thickness = fringe.thickness ?? 0.04;
    const jitter = clamp(fringe.jitter ?? 0.28, 0, 0.6);
    // Bangs may reach the eyelids and no further, hat or no hat. The clamp is
    // what turns the hat drop from a per-style tuning risk into a safe rule:
    // push the bangs down and they bunch up, they do not slide over the eyes.
    const baseY = A.hairlineY - (underHat ? HAT_FRINGE_DROP : 0);
    // Slightly wider than the face window so the bangs meet the side hair.
    const arc = A.faceHalfArc + 8 * DEG;
    // The whole fringe swings a few degrees off the midline. This is the parting,
    // and it is the most visible half of `asymmetry`: a fringe centred exactly on
    // the nose is the one thing that makes a head read as a moulded toy.
    const parting = asym * 7 * DEG;
    // Under a hat: a few wide clumps pushed flat, instead of the rods. See FRINGE_SHEET_TUCK.
    // FEWER than the rods, on purpose. At the style's own count (16-32) the strip under the
    // brim came out as a row of small scallops - lace trim, not a fringe. An anime fringe
    // under a hat is five to nine broad clumps, and it is their points that read as hair.
    if (hat) {
      const clumps = Math.round(clamp(fringe.count * 0.5, 5, 9));
      spreadArc(clumps, -arc + parting, arc * 2).forEach((yaw, i) => {
        const sheet = fringeSheet(`fringe-sheet-${i}`, yaw, i, clumps, arc, hat);
        if (sheet) layout.fringeSheets.push(sheet);
      });
    }
    if (!hat) spreadArc(fringe.count, -arc + parting, arc * 2).forEach((yaw, i) => {
      // Every bang solves its OWN length, ring and lean, which is the whole of the
      // change: they used to share one `tipY` computed above the loop, so the hem
      // was a single horizontal line drawn in rods. Point-cut lengths break that
      // line up, and because a bang's ring and lean are read off the shell at the
      // height it actually reaches, a shorter bang still lies flat on the brow
      // instead of standing off it.
      const drop =
        fringe.drop
        * (1 - jitter * hashNoise(i * 3.7 + 1.3))
        // The heavy side of the parting is the long side.
        * (1 + 0.16 * sideLean(yaw));
      // Rooted ABOVE the hairline, up under the scalp dome, rather than on it.
      //
      // This is the 「瀏海與頭頂的銜接處有明顯的接縫感」 fix, and it is a change of
      // where the bang STARTS rather than of anything you can see. A bang rooted at
      // the hairline has its rounded top sitting on the dome's rim, so the two
      // pieces meet edge to edge and the join is a line of little bumps all the way
      // across the forehead. Rooted a centimetre higher and sunk into the shell
      // (see `standoffAt`), the top of every bang is INSIDE the dome and the only
      // thing visible is the bang emerging from under the scalp - which is what a
      // hairline is.
      const tipY = clamp(baseY - drop, A.faceClearY, baseY + FRINGE_ROOT_LIFT - 2 * thickness);
      const rootY = baseY + FRINGE_ROOT_LIFT;
      const span = rootY - tipY;
      /**
       * How far off the shell the bang sits at height `y`: buried at the root,
       * lying on the surface by the time it reaches the brow, a touch proud at the
       * tip so the tips read as separate pieces rather than as one shell.
       */
      // How deep THIS bang sits. Varying it per bang is what breaks the corrugation:
      // a row of identical rods at identical depth has one pitch and one highlight
      // line, and the eye reads the pitch before it reads the hair.
      const sink = 0.18 * (hashNoise(i * 6.3 + 2.9) - 0.5);
      const standoffAt = (y: number) => {
        const t01 = clamp((rootY - y) / Math.max(1e-6, span), 0, 1);
        // Fully buried at the root, still a THIRD buried at the tip. A bang standing
        // clear of the dome shows its whole round side, and a row of those is
        // corrugated iron - which is exactly what 「頂部瓦楞紋」 was describing.
        // Mostly sunk, it is a raised strand on a solid fringe, which is what hair
        // combed forward looks like. Only past the dome's own rim does a bang come
        // fully into view, and that is where it should: that is the cut edge.
        return shellRadiusAt(y, shellR) + thickness * (-1 + sink + 0.65 * t01);
      };
      const base = standoffAt((rootY + tipY) / 2) + (hashNoise(i * 8.7 + 5.1) - 0.5) * 0.006;
      // Bangs lie ALONG the forehead, so they FOLLOW the shell rather than cutting
      // a chord across it - the other half of 「與臉部球體的貼合度不夠」. A single
      // rod from the hairline to the eyebrow is a straight line drawn between two
      // points on a sphere: it stands off the brow at both ends and cuts into the
      // face in the middle. Broken into two, with each join placed on the shell
      // itself, the bang curves over the brow the way hair combed forward does.
      layout.fringe.push(
        ...segmentedLock(
          `fringe-${i}`, yaw, base, rootY, tipY, thickness, 0, 2,
          (j, n) => standoffAt(rootY - (span * j) / n) - base,
        ).map(part => ({ ...part, tip: part.tip === LOCK_TIP ? FRINGE_TIP : part.tip })),
      );
    });
  }

  // --- Curtain -----------------------------------------------------------
  // Opened at the front by the same face window the dome uses, so it frames the
  // face instead of enclosing it, and leaves the chest front clear.
  const hemY = fall ? clamp(HANG_TOP_Y - fall.length, HAIR_ENVELOPE.minY, HANG_TOP_Y - 0.02) : 0;
  /**
   * The curtain's crown radius: the scalp shell's OWN radius where the two meet.
   *
   * It was `shellR + 0.005` - the shell's widest radius, at the crown, applied at a
   * height where the shell has already curved in. The curtain therefore started
   * about a centimetre wider than the head it was hanging from, which is a collar:
   * a hard cylindrical rim standing proud all the way round, with the top end of
   * every hanging lock sitting on it in plain view. Read off the shell at the
   * height they actually meet, the curtain leaves the skull tangentially and there
   * is no rim to see.
   */
  const rTop = shellRadiusAt(HANG_TOP_Y, shellR) + 0.002;
  // A negative flare tucks the hem under (內彎). Floored at 55% of the crown so a
  // tuck stays a tuck: any deeper and the cylinder pinches shut into a cone.
  const rHem = fall
    ? clamp(rTop + (fall.flare ?? 0), rTop * 0.55, HAIR_ENVELOPE.maxRadius)
    : rTop;
  if (fall) {
    const height = HANG_TOP_Y - hemY;
    // Solved from the curtain's NARROWEST radius rather than fixed at the face
    // window, for the same reason the locks are: a tucked hem swings the
    // cylinder's own front edge inside the cheek line while its angle stays put.
    const gate = Math.max(A.faceHalfArc, clearingYaw(Math.min(rTop, rHem), 0));
    layout.curtain = {
      y: (HANG_TOP_Y + hemY) / 2,
      args: [
        rTop, rHem, height, 32, 1, true,
        gate,                                 // thetaStart: skip the face window
        Math.PI * 2 - 2 * gate,
      ],
    };
  }

  layout.mass = {
    shellRadius: shellR,
    curtain: fall ? { topRadius: rTop, hemRadius: rHem, hemY } : null,
  };

  // ==========================================================================
  // THE BUNDLE-BUILT BACK
  // ==========================================================================
  //
  // Bundles are laid on the BACK arc only - the face window is the same one every
  // other hanging piece opens - and they are spread so that the two at the ends of
  // the arc sit just inside it rather than on it, which is what keeps the outermost
  // bundle's own width from reaching round onto the cheek.
  if (ribbons) {
    const count = Math.max(2, Math.round(ribbons.count));
    const layers = Math.round(clamp(ribbons.layers ?? 1, 1, 3));
    const layerStep = clamp(ribbons.layerStep ?? 0.16, 0, 0.5);
    const jitter = clamp(ribbons.jitter ?? 0, 0, 0.5);
    const thickness = clamp(ribbons.thickness ?? 0.028, 0.012, 0.05);
    const rootTheta = clamp(ribbons.rootTheta ?? 42 * DEG, 15 * DEG, 80 * DEG);
    const leaveTheta = clamp(ribbons.leaveTheta ?? 104 * DEG, 90 * DEG, 130 * DEG);
    const waves = Math.round(clamp(ribbons.waves ?? 0, 0, 5));
    const waveDepth = clamp(ribbons.waveDepth ?? 0, 0, 0.05);
    // How far in the tips draw. A fraction of the shell rather than an absolute, so
    // a bulky style's hair still lands on its own body and not inside it.
    const tuck = clamp(ribbons.tuck ?? 0.12, -0.25, 0.4);

    // The arc the bundles cover: everything outside the face window.
    const span = Math.PI * 2 - 2 * A.faceHalfArc;
    const leaveR = shellR * Math.sin(leaveTheta);

    /**
     * The floor that makes gaps impossible.
     *
     * Neighbours are `span / (count - 1)` apart in azimuth, which at the radius the
     * bundles actually hang at is an arc of `leaveR * span / (count - 1)`. A bundle
     * only reaches its neighbour if its full width covers that, so half-width has to
     * clear half of it - with a little over, because `widthAt` narrows both ends of
     * every bundle and two narrowing edges meeting exactly would still part.
     *
     * Floored rather than validated: a spec that asks for too little gets enough,
     * instead of shipping a head with daylight through the back of it.
     */
    // 1.9, and the number is derived rather than tuned. The binding point is not
    // where the bundles are widest, it is the TIP: `widthAt` ends at 0.62 of full
    // width while the ring the tips hang on is only tucked in by ~16%, so a factor
    // that closes the gap at the waist still leaves 0.62/0.84 = 0.74 of what the hem
    // needs - which is exactly the row of blades with daylight between them that the
    // first pass produced. 1.9 covers the tip, and over-covering the middle is free:
    // bundles that overlap more simply read as one mass sooner.
    const minHalfWidth = (leaveR * span) / (2 * (count - 1)) * 1.9;
    const halfWidth = Math.max(ribbons.halfWidth, minHalfWidth);

    /**
     * The arc the bundle CENTRES are spread over, which is not the arc the bundles
     * occupy - and conflating the two put hair across the face.
     *
     * `span` is the opening between the two edges of the face window. Spreading the
     * centres over all of it puts the outermost bundle's centre ON the window edge
     * and therefore its whole outer half INSIDE the window, which is `npm run
     * audit:hair` reporting geometry down at y=-0.318 in front of the eyes. The
     * centres are inset by a bundle's own angular half-width so it is the bundle's
     * EDGE that lands on the window, and by the largest stagger any tier applies,
     * since that slides a whole tier around the head.
     */
    const edgeInset = halfWidth / Math.max(0.05, leaveR);
    const maxStagger = (span / (count - 1)) * 0.5;
    const centreSpan = Math.max(0.6, span - 2 * edgeInset - 2 * maxStagger);

    for (let l = 0; l < layers; l++) {
      // Outer tiers are shorter and root a little lower, so each reads as cut over
      // the one behind it rather than as a copy sunk into it.
      const tierLen = ribbons.length * (1 - layerStep * l);
      const tierRoot = rootTheta + l * 6 * DEG;
      const tierStandoff = l * thickness * 0.8;
      // A different fraction of a slot per tier, so no two tiers line up and the
      // seams between bundles never stack into one visible line down the back.
      const stagger = (l / layers) * maxStagger;

      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0.5 : i / (count - 1);
        const yaw = Math.PI - centreSpan / 2 + stagger + centreSpan * t;
        // 錯落: neighbouring bundles disagree about length by a hashed amount, so
        // the hem is a soft broken line instead of one ruled edge. Hashed on the
        // bundle's own index, so it is the same disorder every render.
        const n = hashNoise(i * 7.3 + l * 31.7);
        // Leaned across the head as well, so one side is heavier - the parting.
        const lean = 1 - asym * 0.22 * Math.cos(yaw);
        const len = tierLen * (1 - jitter * n) * lean;
        const bottomY = clamp(
          HANG_TOP_Y - len,
          HAIR_ENVELOPE.minY + thickness,
          HANG_TOP_Y - 0.03,
        );
        /**
         * Shingling: neighbours sit at slightly different depths.
         *
         * Bundles this wide overlap heavily, and two overlapping tubes AT THE SAME
         * RADIUS meet in a V - so nine of them side by side came out corrugated,
         * with a dark groove at every crossing that reads exactly like the gap it
         * is not. (The gaps really were gaps once; `minHalfWidth` closed those. What
         * was left looked identical and had the opposite cause, which is why raising
         * the overlap again did nothing.) Alternating the depth by a little over half
         * a thickness makes the odd bundles lie ON the even ones rather than beside
         * them - which is how hair stacks - and turns the corrugation into a smooth
         * shingled surface.
         */
        const standoff = tierStandoff + (i % 2) * thickness * 0.62;
        const built = buildRibbon({
          yaw,
          rootTheta: tierRoot,
          leaveTheta,
          shellRadius: shellR,
          shellOriginY: A.originY,
          bottomY,
          /**
           * Tucked in, but never through the skull.
           *
           * `tuck` pulls the tips toward the body, and on 內彎 - where turning under
           * IS the haircut - it pulls hard enough to put the hem inside the head:
           * at the bob's hem height the skull is still 16cm across, and a 42% tuck
           * lands the tips at exactly that, so they clipped straight through it.
           *
           * The floor is the skull's own radius AT THE TIP'S HEIGHT plus a
           * clearance, which is zero constraint for a style long enough to hang
           * below the head (`sqrt` of a negative goes to 0 there) and a hard stop
           * for every style that ends beside it. A spec can now ask for as much
           * tuck as it likes and get as much as will fit.
           */
          hemRadius: Math.max(
            0.04,
            Math.sqrt(Math.max(0, A.radius * A.radius - bottomY * bottomY)) + 0.014,
            leaveR * (1 - tuck) + standoff,
          ),
          halfWidth,
          thickness,
          standoff,
          waves,
          waveDepth,
          // Neighbours share the wave and only shade it, rather than each drawing
          // its own phase. A full 0..2pi spread meant the bundle beside you was as
          // likely to be swinging IN as out, and two neighbours moving oppositely
          // pull apart - which is a gap that no amount of extra width closes,
          // because it is the centre lines separating, not the edges falling short.
          // Hair waves as a sheet; the small spread keeps it from being one ruled
          // corrugation without letting the sheet come apart.
          phase: (n - 0.5) * 0.7,
        });
        // Pressed under a hat like the shell they root on - see pressHairPoint. Done to
        // the finished vertices rather than inside the sweep so hairRibbon.ts stays the
        // pure, hat-agnostic primitive it is, and the audit measures the pressed surface.
        if (hat) built.positions = built.positions.map(p => pressHairPoint(p, hat));
        layout.ribbons.push({ key: `ribbon-${l}-${i}`, ...built });
      }
    }
  }

  /**
   * The lean at which a lock lies ALONG the curtain rather than across it.
   *
   * A lock is a straight rod and the curtain is a cone, and until now the rod hung
   * at a constant `LOCK_LEAN` whatever the cone was doing. On the flared styles the
   * two roughly agreed; on 內彎, where the hem tucks IN, they disagreed by the whole
   * taper - so every lock was buried in the mass at its root and standing 5cm clear
   * of it at its tip. That is the row of separate rods around the hem, and no
   * amount of thinning or adding locks could have fixed it, because the locks were
   * not on the surface they were meant to be lying on.
   *
   * Same solve the bangs use against the skull: read the surface at both ends and
   * take the angle between them. The style's own hang is then a small correction on
   * top rather than the whole story.
   */
  const curtainLean = fall ? -(rHem - rTop) / Math.max(1e-6, HANG_TOP_Y - hemY) : 0;

  /**
   * Where a lock rests: against the curtain if there is one, else on the shell.
   * Half-embedded rather than stood off it, so locks read as thick strands in the
   * hair instead of separate blocks floating behind it.
   */
  const ringAt = (y: number, thickness: number): number => {
    // 0.15 of a radius proud of the surface, not 0.35. At a third the lock's centre
    // is far enough out that most of its body is in front of the mass rather than
    // in it, so the hanging hair reads as rods laid ON a shell - and the tier stack
    // then adds to that. Nearly flush, a lock is a raised strand in the hair, which
    // is the whole reason these exist.
    if (!fall) return shellR + thickness * 0.15;
    const t = clamp((HANG_TOP_Y - y) / Math.max(1e-6, HANG_TOP_Y - hemY), 0, 1);
    return rTop + (rHem - rTop) * t + thickness * 0.15;
  };

  // --- Face-framing locks ------------------------------------------------
  // Placed outward from the edge of the face window, mirrored left and right,
  // so they frame the face and can never drift across an eye.
  if (curls && curls.count > 0) {
    const thickness = curls.thickness ?? 0.026;
    // The gate below is solved against the WORST case a lock can grow into, not
    // against the nominal spec, so asymmetry cannot lengthen or fatten a lock past
    // the clearance that was solved for it.
    const worstThickness = thickness * (1 + 0.12 * asym);
    const bottomY = clamp(
      HANG_TOP_Y - curls.length * (1 + 0.14 * asym),
      HAIR_ENVELOPE.minY,
      HANG_TOP_Y - 0.02,
    );
    const perSide = Math.max(1, Math.round(curls.count / 2));
    // Flipping the sign turns the tips under instead of out. Nothing else changes:
    // the ring is still outside the face window, so the C-curl of 內彎 costs no
    // safety - it curls toward the jaw, not across it.
    const lean = curtainLean + (curls.inward ? -LOCK_LEAN : LOCK_LEAN) * 0.6;
    const hook = clamp(curls.hook ?? 0, 0, 0.8);
    const hookDepth = clamp(curls.hookDepth ?? 0, 0, 0.08);
    // An inward tuck swings the TIPS toward the head's axis, so the narrowest point
    // of the lock - not its root - is what has to clear the cheek. The hook pulls
    // the tip in FURTHER than the lean does, so it is charged to the gate too:
    // otherwise a C-curl would be solved as safe and then curl past the solution.
    const length = capsuleLength(HANG_TOP_Y, bottomY, worstThickness, lean);
    // Anchored by the ROOT, like the back locks - see the note there. Without it a
    // tucking curl levers its own top out through the side of the head.
    const ring = ringAt(HANG_TOP_Y, thickness) - (Math.sin(lean) * length) / 2;
    const innerRing = Math.min(ring, ring - Math.sin(lean) * length) - hookDepth;
    const gate = Math.max(A.faceHalfArc, clearingYaw(innerRing, worstThickness));
    for (let i = 0; i < perSide; i++) {
      const offset = gate + i * 13 * DEG;
      for (const side of [1, -1] as const) {
        // Left and right draw from DIFFERENT hashes rather than sharing one. They
        // used to share, which is why a head could be turned around and look
        // identical: the "random" break was mirrored along with the placement.
        const seed = i * 9.1 + 4.4 + (side > 0 ? 0 : 51.3);
        const curlDrop =
          curls.length
          * (1 - 0.18 * hashNoise(seed))
          * (1 + 0.14 * sideLean(side * offset));
        const curlBottom = clamp(HANG_TOP_Y - curlDrop, HAIR_ENVELOPE.minY, HANG_TOP_Y - 0.02);
        const curlThickness = thickness * (1 + 0.12 * sideLean(side * offset));
        // Face-framing locks taper like every other hanging piece: these are the
        // ones seen against the cheek from the front, so a blunt-ended rod here is
        // the most visible sausage on the whole model. And on 內彎 they do not just
        // lean in, they TURN in over the last stretch - see `hookOffsets`.
        layout.locks.push(
          ...segmentedLock(
            `curl-${side > 0 ? 'r' : 'l'}-${i}`,
            side * offset, ring, HANG_TOP_Y, curlBottom, curlThickness, lean,
            hook > 0 && hookDepth > 0 ? 3 : 1,
            hookOffsets(hookDepth, hook),
            clamp(curls.tip ?? LOCK_TIP, 0.2, 0.95),
          ),
        );
      }
    }
  }

  // --- Back locks --------------------------------------------------------
  // The layered mass at the back of the head - the part that used to read as one
  // moulded shell. Every lock is still solved by `hangCapsule` on the same rings
  // and clamped by the same envelope as before; what the tiers add is only that
  // the locks DISAGREE ABOUT LENGTH, which is what a layered cut physically is.
  if (strands && strands.count > 0) {
    const baseThickness = strands.thickness ?? 0.05;
    const layers = Math.round(clamp(strands.layers ?? 1, 1, 4));
    const layerStep = clamp(strands.layerStep ?? 0.18, 0, 0.45);
    const span = clamp(strands.span ?? 80 * DEG, 20 * DEG, 200 * DEG);
    const taper = clamp(strands.taper ?? 0, 0, 0.6);
    const jitter = clamp(strands.jitter ?? 0, 0, 0.5);
    const waves = Math.round(clamp(strands.waves ?? 0, 0, 6));
    const waveDepth = clamp(strands.waveDepth ?? 0, 0, 0.05);
    const waveJitter = clamp(strands.waveJitter ?? 0, 0, 1);
    const hook = clamp(strands.hook ?? 0, 0, 0.8);
    const hookDepth = clamp(strands.hookDepth ?? 0, 0, 0.08);
    const curlLayers = Math.round(clamp(strands.curlLayers ?? 1, 1, 4));
    const tipRatio = clamp(strands.tip ?? LOCK_TIP, 0.2, 0.95);
    // Follows the curtain, plus a fraction of the style's own hang - see
    // `curtainLean`. The style's part is scaled back because most of what `inward`
    // used to be responsible for is now carried by the taper the lock is lying on.
    const lean = curtainLean + (strands.inward ? -LOCK_LEAN : LOCK_LEAN) * 0.6;
    const slot = span / Math.max(1, strands.count - 1);
    // The whole set turns a few degrees off the midline, so the back of the head
    // has a heavy side too and not just the fringe. Small: this rotates a V hem
    // that is centred on the spine, and a V visibly off-centre reads as a mistake
    // rather than as a cut.
    const swing = asym * slot * 0.55;

    for (let l = 0; l < layers; l++) {
      // Tier 0 is the innermost and longest. Each tier out is shorter and sits a
      // little proud of the one behind it, so the short lengths read as cut OVER
      // the long ones rather than sinking into them.
      // Outer tiers are finer, but only slightly. At the 0.12 this was, the tier
      // doing most of the covering was also the thinnest one, so its locks stopped
      // overlapping each other and the mass came apart into a row of separate rods -
      // the grass-skirt look on every long style seen from behind.
      const thickness = baseThickness * (1 - 0.06 * l);
      /**
       * How far this tier stands out from the one behind it.
       *
       * The whole stack has to stay INSIDE the curtain's own surface, and that is
       * the constraint this exists to state. It was `thickness * 0.55` per tier,
       * which on a three-tier style put the outermost tier's inner edge clear of
       * the curtain altogether: a ring of separate rods standing in front of the
       * hair with daylight between them, which is the grass-skirt / 「兩塊板子」
       * silhouette every long style had from behind. Tiers are supposed to be
       * layers cut INTO one mass, so the whole build-up is capped at 60% of a
       * lock's radius - enough for the tiers to catch light separately, not enough
       * for any of them to leave the mass.
       */
      const tierStep = Math.min(
        baseThickness * 0.28,
        (baseThickness * 0.6) / Math.max(1, layers - 1),
      );
      // Outer tiers root a little higher, so a short tier reads as cut OVER the one
      // behind rather than sunk into it. Only a little: at the 0.018 this used to
      // be, the outermost tier of a steeply layered short cut rooted so far above
      // the tiers behind it that - being the shortest as well - it never reached
      // down to any of them, and the audit found it hanging in its own band of
      // empty air. Tiers hold each other up; they have to overlap to do it.
      // Rooted level with where the curtain leaves the skull, not 4cm below it.
      // Down there the shell has curved in but the curtain has not, so a lock
      // rooted at the old height stood clear of both and showed the flat cap on
      // the end of its own cylinder - the row of pale discs around the nape.
      const topY = HANG_TOP_Y - 0.005 + l * 0.007;
      // A DIFFERENT fraction of a slot per tier, so no two tiers line up.
      //
      // This was `(l % 2) * slot * 0.5`, which staggers tier 1 and then puts tier 2
      // back exactly over tier 0. On a three-tier style that means the gaps between
      // the outer tier's locks sit directly over the gaps in the innermost one, with
      // only the middle tier - further in, and so in shadow - behind them. That is
      // the striping: 髮絲感 is supposed to come from strands catching light, not
      // from being able to see between them to the back of the head.
      const stagger = (l / layers) * slot;
      // Curl costs one mesh per segment, so only the tiers whose tips actually form
      // the hem get one. Those are the LONGEST tiers, which is tier 0 and up: tier
      // 0 sits closest to the head but hangs furthest down, so its tips are the ones
      // below the outline of every tier stacked outside it.
      const curled = l < curlLayers;
      spreadArc(strands.count, Math.PI - span / 2 + stagger + swing, span).forEach((yaw, i) => {
        // Where this lock is rooted, and how far it stands off the mass. Small —
        // 15mm and 6mm at the extremes — and both are what stop the tier reading
        // as one machined edge. A lock rooted a little higher than its neighbour
        // is what hair growing out of a scalp looks like from behind.
        const rootJit = (hashNoise(l * 13.9 + i * 2.7) - 0.5) * 0.03;
        // Scaled to the tier's own width rather than a flat 12mm: on the fine tiers
        // of a short cut a flat wobble is most of a lock's radius, which is enough
        // to lift one clear of the mass it is supposed to be lying against.
        const ringJit = (hashNoise(i * 4.1 + l * 7.3) - 0.5) * thickness * 0.3;
        // How much neighbouring locks disagree about WIDTH, not just about length.
        //
        // This was a flat +/-18%, which on the styles whose mass is two flat sheets
        // either side of the face - 「兩側髮片厚度一致，缺乏層次感，看起來像兩塊
        // 板子」 - was not enough to break the sheet up: at a fifth of a lock's
        // width the pieces still all read as the same piece. It now widens with the
        // style's own `jitter`, so the styles that are meant to be choppy get
        // choppy locks and 一刀齊 keeps its even ones. Still only ever a
        // PROPORTION of the tier's thickness, and the envelope reach below is
        // solved from the widest a lock can come out.
        const widthSpread = 0.18 + 0.7 * jitter;
        // Weighted toward THICKER rather than centred on the tier's own width. A
        // lock is what holds the tier outside it onto the tier inside it - see the
        // step-out below - and a symmetric spread this wide let the occasional very
        // thin lock come out narrower than the gap it had to bridge, leaving it
        // hanging in space next to its neighbours. `npm run audit:hair` catches
        // exactly that now, and caught it here.
        const lockThickness =
          thickness
          * (1 - 0.5 * widthSpread + 1.5 * widthSpread * hashNoise(i * 11.3 + l * 3.5))
          * (1 + 0.1 * sideLean(yaw));
        // How far round from the centre of the back, 0..1 - the axis a V hem is
        // cut along, and the reason the hem stops being one flat line.
        const edge = Math.min(1, Math.abs(yaw - Math.PI) / Math.max(1e-6, span / 2));
        // Three things decide a lock's length and they are different in kind: the
        // TIER it is in (the cut), how far round the head it sits (the V), and the
        // lock's own break (`jitter`). Only the last one can differ between
        // neighbours, and it is the one that stops a tier reading as a row.
        const length = strands.length
          * (1 - l * layerStep)
          * (1 - taper * edge)
          * (1 - jitter * hashNoise(l * 31.7 + i * 5.9))
          // The heavy side hangs longer. Same curve as the fringe's, so the parting
          // and the fall agree about which side of the head is the long one.
          * (1 + 0.2 * sideLean(yaw));
        const rootY = topY + rootJit;
        // A lock is never shorter than three times its own width. Below that a
        // tapered piece has almost no cylinder left between its two ends: it draws
        // as a bead rather than as hair, and a bead sitting a tier out from the
        // curtain is too short to reach anything to hold onto. On a short cut with
        // a steep `layerStep` the outermost tier was landing there.
        const bottomY = clamp(
          rootY - Math.max(length, 3 * lockThickness),
          HAIR_ENVELOPE.minY,
          rootY - 0.02,
        );
        // Tiers step outward to stack, but never past the envelope - a curve needs
        // its swing to fit inside the same limit. Solved against the widest a lock
        // in this tier can come out of the jitter above, not against the tier's
        // nominal thickness.
        const worstThickness = thickness * (1 + widthSpread) * (1 + 0.1 * asym);
        // Placed so the lock's ROOT lands on the mass, not its middle.
        //
        // `hangCapsule` positions a lock by its centre and then rotates it about
        // that centre, so half its lean is spent moving the root and half the tip.
        // On a tucking style the lean is positive, which swings the root OUTWARD -
        // out through the scalp it is supposed to be growing from, cap and all.
        // That is the ring of pale discs around the nape of 內彎: not stray pieces,
        // but the flat top of every lock in the style, lifted clear of the head by
        // the very rotation meant to curl its other end under.
        const lockLength = capsuleLength(rootY, bottomY, lockThickness, lean);
        const ring = Math.min(
          ringAt(rootY, thickness)
            - (Math.sin(lean) * lockLength) / 2
            + l * tierStep
            + ringJit,
          // The reach of a wavy lock is ring + swing + its own body, so all three
          // are subtracted here rather than the envelope being checked afterwards.
          HAIR_ENVELOPE.maxRadius - worstThickness - waveDepth - 0.004,
        );
        const key = `strand-${l}-${i}`;
        // How much of a curve THIS lock gets. Depth and phase are drawn from the
        // lock's own hash, so neighbours curl by different amounts and in opposite
        // directions - the fix for 「每一撮幾乎一樣」 and 「髮尾的捲曲方向都一致」,
        // which no amount of length jitter could have reached.
        const n = hashNoise(l * 19.7 + i * 3.3 + 2.1);
        const lockWaveDepth = curled ? waveDepth * (1 - waveJitter * 0.6 * n) : 0;
        const lockWaves = curled
          ? Math.max(0, waves - (waveJitter > 0 && hashNoise(i * 5.3 + l) > 0.68 ? 1 : 0))
          : 0;
        const lockHook = curled ? hook : 0;
        const wavy = lockWaves >= 2 && lockWaveDepth > 0;
        const hooked = lockHook > 0 && hookDepth > 0;
        if (!wavy && !hooked) {
          layout.locks.push(
            hangCapsule(key, yaw, ring, rootY, bottomY, lockThickness, lean, tipRatio),
          );
          return;
        }
        const wave = waveOffsets(lockWaveDepth, n > 0.5 ? 1 : 0);
        // The tuck is a fixed distance, but a lock cut short by taper and jitter has
        // less length to turn through, so on the short ones the same distance came
        // off at nearly twice the angle. Scaled by how long this lock actually came
        // out, every tip in the tier turns through the same arc - which is what
        // makes a hem read as one curl rather than as a row of separate flicks.
        const tuck = hookOffsets(
          hookDepth * clamp((rootY - bottomY) / Math.max(1e-6, strands.length), 0.4, 1),
          lockHook,
        );
        layout.locks.push(
          ...segmentedLock(
            key, yaw, ring, rootY, bottomY, lockThickness, lean,
            wavy ? lockWaves : 3,
            (j, segs) => (wavy ? wave(j, segs) : 0) + (hooked ? tuck(j, segs) : 0),
            tipRatio,
          ),
        );
      });
    }
  }

  // --- Strand relief -----------------------------------------------------
  // Thin lines lying ON the hanging mass in a shade derived from the style's own
  // colour. They are what turn a curtain into hair: the mass was a single flat
  // fill, so nothing on it caught light differently from anything else and it read
  // as moulded plastic at every distance.
  //
  // They lie ALONG the curtain - ring and lean both solved from its taper, the same
  // solve the bangs use against the dome. Hung at a constant ring instead, they
  // peeled away from a flared hem and floated in front of it.
  if (flow && flow.count > 0 && fall) {
    const thickness = clamp(flow.thickness ?? 0.012, 0.005, 0.03);
    const coverage = clamp(flow.coverage ?? 0.86, 0.2, 1);
    const tint = clamp(flow.contrast ?? 0.3, 0.05, 0.8);
    const topY = HANG_TOP_Y - 0.01;
    const fullBottom = clamp(topY - (topY - hemY) * coverage, HAIR_ENVELOPE.minY, topY - 0.04);
    /** The curtain's own surface radius, before a piece is stood off it. */
    const surfaceAt = (y: number) => {
      const t = clamp((HANG_TOP_Y - y) / Math.max(1e-6, HANG_TOP_Y - hemY), 0, 1);
      return rTop + (rHem - rTop) * t;
    };
    // Proud of the surface by most of their own thickness: sunk flush they are
    // invisible, stood fully off they read as wires laid over the hair.
    const rA = surfaceAt(topY) + thickness * 0.7;
    const rB = surfaceAt(fullBottom) + thickness * 0.7;
    const ring = (rA + rB) / 2;
    const lean = -Math.atan2(rB - rA, topY - fullBottom);
    const gate = Math.max(A.faceHalfArc, clearingYaw(Math.min(rA, rB), thickness));
    spreadArc(flow.count, gate, Math.PI * 2 - 2 * gate).forEach((yaw, i) => {
      // Uneven lengths, fixed per line. Run to the same depth they read as printed
      // pinstripe; real strand relief ends at different heights.
      const bottomY = clamp(
        topY - (topY - fullBottom) * (1 - 0.3 * hashNoise(i * 7 + 3)),
        HAIR_ENVELOPE.minY,
        topY - 0.02,
      );
      layout.locks.push({
        ...hangCapsule(`flow-${i}`, yaw, ring, topY, bottomY, thickness, lean),
        tint,
      });
    });
  }

  // --- Crest -------------------------------------------------------------
  // Straddles the crown and is bounded to the skull's own front-to-back extent,
  // so it can never sail out over the forehead.
  //
  // The one piece a hat really does have to remove, along with the front spikes
  // below: both stand 15cm off the crown, which is the inside of the hat. 龐克髮型
  // is nothing but a crest - the sides of the cut are shaved - so it is the only
  // style in the shop that still shows no hair under a hat, and that is the haircut
  // rather than the bug the rest of this section is about.
  if (crest && !underHat) {
    const halfDepth = A.radius * 0.85;
    const bladeCentreY = A.radius;
    const bladeTopY = bladeCentreY + crest.height / 2;
    const spikeH = Math.min(crest.spikeHeight, HAIR_ENVELOPE.maxY - bladeTopY + 0.06);
    layout.crest = {
      emissive: crest.emissive,
      blade: {
        position: [0, bladeCentreY, 0],
        args: [0.052, crest.height, halfDepth * 2],
      },
      spikes: spreadArc(crest.spikes, -halfDepth * 0.8, halfDepth * 1.6).map((z, i) => ({
        key: `spike-${i}`,
        // Sunk 0.06 into the blade so the cones read as part of it, not stacked on top.
        position: [0, bladeTopY - 0.06 + spikeH / 2, z] as Vec3,
        args: [crest.spikeRadius, spikeH, 4] as ConeArgs,
      })),
    };
  }

  // --- Front spikes ------------------------------------------------------
  // Rows of cones rooted on the shell between the hairline and the crown, each
  // raked forward. Rooting them on the shell (rather than at some authored height)
  // is what keeps them attached when `bulk` changes, and the reach is SOLVED
  // against the envelope rather than trusted, exactly as the hanging pieces are.
  // Dropped under a hat, and only these: waxed spikes stand 10cm off the crown,
  // which is the inside of the brim. 美式前刺 keeps its shell and its fringe, so it
  // still reads as a head of hair with a cap on rather than as a shaved one.
  if (spikes && spikes.count > 0 && !underHat) {
    const thickness = spikes.thickness ?? 0.028;
    const rows = Math.max(1, spikes.rows ?? 1);
    /**
     * Front row roots just above the hairline; the back row runs PAST the crown.
     *
     * -16 and not +18. Theta is measured from the crown, so a back row at +18 stops
     * short of the top of the head - every row was on the forehead side, and the
     * crown and everything behind it was left as bare shell with the side bundles
     * ringing it. That is 地中海: a smooth dome with hair only around the edge. The
     * style is 前刺, so the spikes are still concentrated at the front - but hair
     * has to carry on over the top of the head, not stop at it.
     */
    const THETA_FRONT = 52 * DEG;
    const THETA_BACK = -16 * DEG;
    for (let r = 0; r < rows; r++) {
      const t = rows === 1 ? 0 : r / (rows - 1);
      const theta = THETA_FRONT + (THETA_BACK - THETA_FRONT) * t;
      // The front row leans hardest. Equal rake on every row reads as a hedgehog;
      // the forward gradient is what makes it 前刺. Both numbers went up when the
      // style was re-cut from photographs: in them the front tips point FORWARD
      // over the forehead (0.95rad ≈ 54deg off vertical) and only the back of the
      // fan stands up, where the old 0.72/0.42 had the whole thing closer to
      // upright than to raked.
      const rake = 0.95 - 0.4 * t;
      const up = Math.cos(rake);
      const rootY = A.originY + shellR * Math.cos(theta);
      const rootRing = shellR * Math.sin(theta);
      /**
       * Which way a row leans, now that rows can sit behind the crown.
       *
       * `out` used to be a bare `sin(rake)`, i.e. always toward the face. Applied to
       * a row rooted past the crown that rakes it FORWARD over the top of the head -
       * the spikes would grow out of the back of the skull and lie across the crown.
       * A row leans away from the crown on whichever side of it the row sits, and
       * exactly at the crown (theta 0) it stands straight up, which is what the
       * sign of theta gives for free.
       */
      const lean = Math.sign(theta) || 1;
      const out = Math.sin(rake) * lean;
      const height = Math.min(
        spikes.height,
        (HAIR_ENVELOPE.maxY - rootY) / Math.max(1e-6, up),
        // Measured on the magnitudes: a back row's radius grows in -z, and a signed
        // divide there would hand it an unbounded height instead of clamping it.
        (HAIR_ENVELOPE.maxRadius - thickness - Math.abs(rootRing)) /
          Math.max(1e-6, Math.abs(out)),
      );
      if (height <= 0) continue;
      // Narrower fan further back, so the rows nest instead of crossing.
      const spread = (52 - 12 * t) * DEG;
      const jitter = clamp(spikes.jitter ?? 0, 0, 0.6);
      // Wax pinches hair into bundles that lean INTO each other, so the spacing is
      // uneven too. Without this the tips differ in height and still stand in a
      // perfectly ruled row, which at a glance is a comb with broken teeth.
      const slot = (spread * 2) / Math.max(1, spikes.count - 1);
      spreadArc(spikes.count, -spread, spread * 2).forEach((yaw, i) => {
        // Two things stop this row being a comb. The fan is tallest at the centre
        // and drops toward the temples, which is the shape wax actually pinches
        // hair into; and each tip then disagrees with its neighbours by `jitter`.
        // Both only ever SHORTEN the solved height, so the envelope reach computed
        // above stays the true worst case and no spike can grow past it.
        const centre = Math.min(1, Math.abs(yaw) / Math.max(1e-6, spread));
        const h = height * (1 - 0.3 * centre * centre) * (1 - jitter * hashNoise(r * 17.3 + i));
        if (h <= 0) return;
        layout.spikes.push({
          key: `spike-${r}-${i}`,
          // Yaw wobble is free of the envelope: rotating about Y moves a spike
          // along its own ring without changing its radius or its height.
          yaw: yaw + (hashNoise(r * 3.1 + i * 7.7) - 0.5) * slot * 0.7,
          // A cone is centred on its own axis, so the root sits half a length back
          // along the rake.
          position: [0, rootY + (h / 2) * up, rootRing + (h / 2) * out],
          rotation: [rake, 0, 0],
          // Thinner tips on the taller spikes, so the fan reads as separate waxed
          // bundles rather than as one serrated wall.
          args: [thickness * (1 - 0.25 * (1 - centre)), h, 6],
        });
      });
    }
  }

  // --- Perm texture ------------------------------------------------------
  // Latitude rings of twisted bundles half-sunk into the shell.
  //
  // Under a hat they used to be dropped entirely, for the same reason the dome was,
  // and it cost more here than anywhere: 渣男燙's 蓬度 IS the style, so a hatted
  // 渣男燙 was a smooth cap of colour. They are not dropped now - the rings are
  // re-spread into the band that still shows, between the hat's own brim and the
  // nape, so the texture is where a hat leaves it and not where a bare head puts it.
  //
  // Each bundle is raked along the shell's own TANGENT at its latitude, which is
  // the whole reason this now reads as 束狀紋理 rather than as bubble wrap: at the
  // crown the tangent points outward, so the bundles lie flat and fan off the top,
  // and by the nape it has turned downward, so they hang. Neighbouring bundles then
  // disagree about angle and length by `jitter`, because a perm that agrees with
  // itself is a helmet.
  if (perm && perm.count > 0 && perm.rings > 0) {
    const size = clamp(perm.size, 0.02, 0.06);
    const twist = clamp(perm.twist ?? 2.4, 1, 4);
    const jitter = clamp(perm.jitter ?? 0.5, 0, 1);
    const thickness = size * 0.62;
    const sink = size * 0.5;
    const THETA_BOTTOM = 94 * DEG;
    /**
     * The topmost latitude a bundle may be rooted at.
     *
     * Bare, the crown - the top of the head is where a perm is bulkiest. Under a hat,
     * the lowest a bundle can be rooted and still have its whole body clear of the
     * brim. A bundle is a capsule hanging from its root, so its highest point is the
     * root plus its own radius; that, plus the tilt of the brim at its worst azimuth,
     * is what the ring has to clear. Solved from the same numbers the hat itself is
     * fitted to rather than picked, so a re-modelled hat brings its own answer.
     */
    const brimFloor = hat ? hatHairlineMinY(hat) : Infinity;
    const THETA_TOP = hat
      ? Math.min(polarAt(brimFloor - thickness - PERM_BRIM_CLEARANCE, shellR - sink), THETA_BOTTOM)
      : 20 * DEG;
    // Fewer rings when there is less band to spread them over, so the bundles keep
    // the spacing the style was tuned at instead of packing into a wreath.
    const rings = hat
      ? Math.max(1, Math.round((perm.rings * (THETA_BOTTOM - THETA_TOP)) / (74 * DEG)))
      : perm.rings;
    for (let r = 0; r < rings; r++) {
      const t = rings === 1 ? 0 : r / (rings - 1);
      const theta = THETA_TOP + (THETA_BOTTOM - THETA_TOP) * t;
      // Rooted on the shell as it actually IS: pressed flat where the hat is on it,
      // so the bundles stay half-sunk in the surface under a hat instead of hovering
      // off a shell that has moved 2cm in without them.
      const bedR = hat
        ? pressedShellR(shellR, A.originY + shellR * Math.cos(theta), brimFloor) - sink
        : shellR - sink;
      const rootY = A.originY + bedR * Math.cos(theta);
      const ring = Math.max(0, bedR * Math.sin(theta));
      const maxLength = size * twist;
      // Half a slot on alternate rings, so bundles interlock instead of lining up
      // into vertical columns - 錫紙燙's texture is dense and irregular.
      const stagger = r % 2 === 0 ? 0 : Math.PI / perm.count;
      let yaws: number[];
      if (rootY >= A.hairlineY - FRINGE_SEAL) {
        // Above the forehead, so the whole circle is fair game. The last slot is
        // left open so the ring closes without doubling a bundle onto itself.
        yaws = spreadArc(perm.count, stagger, Math.PI * 2 - (Math.PI * 2) / perm.count);
      } else {
        // Below the forehead a bundle has to clear the cheek, and the rings narrow
        // as they descend, so the gate is solved per ring rather than padded once.
        // Its whole LENGTH is charged to the gate, not just its thickness: a bundle
        // reaches well past its own root, and it is the tip that meets the cheek.
        const gate = Math.max(A.faceHalfArc, clearingYaw(ring, thickness + maxLength / 2));
        const span = Math.max(0, Math.PI * 2 - 2 * gate - 2 * stagger);
        yaws = spreadArc(perm.count, gate + stagger, span);
      }
      yaws.forEach((yaw, i) => {
        const n1 = hashNoise(r * 31.7 + i);
        const n2 = hashNoise(r * 71.3 + i * 13.1 + 5);
        const length = maxLength * (1 - 0.35 * jitter * n1);
        // The shell's tangent at this latitude: horizontal at the crown, vertical
        // at the nape. Plus the bundle's own disagreement with its neighbours.
        const lean = -(Math.PI / 2 - theta) + (n2 - 0.5) * jitter * 0.8;
        const half = length / 2;
        layout.perm.push({
          key: `perm-${r}-${i}`,
          yaw,
          // A capsule is centred on its own axis, so the root sits half a bundle
          // back along the rake - the same correction the front spikes make.
          position: [0, rootY - half * Math.cos(lean), ring - half * Math.sin(lean)],
          rotation: [lean, 0, 0],
          args: [thickness, length, 6, 10],
        });
      });
    }
  }

  return layout;
}

// ============================================================================
// Bounds - used by `npm run audit:hair` to prove a style stays in the envelope.
// ============================================================================

export interface HairBounds {
  minY: number;
  maxY: number;
  maxRadius: number;
  /** Lowest point of anything standing in the corridor in front of the face. */
  lowestInFaceCorridor: number;
}

const rotX = (p: Vec3, a: number): Vec3 => [
  p[0],
  p[1] * Math.cos(a) - p[2] * Math.sin(a),
  p[1] * Math.sin(a) + p[2] * Math.cos(a),
];

const rotY = (p: Vec3, a: number): Vec3 => [
  p[0] * Math.cos(a) + p[2] * Math.sin(a),
  p[1],
  -p[0] * Math.sin(a) + p[2] * Math.cos(a),
];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export function measureHairBounds(layout: HairLayout): HairBounds {
  let minY = Infinity;
  let maxY = -Infinity;
  let maxRadius = 0;
  let lowestInFaceCorridor = Infinity;

  /**
   * `r` is how far the surface reaches around this point, so a sample expands
   * into the corridor as well as down - a lock whose centre passes just outside
   * the cheek still counts if its body does not.
   */
  const note = (p: Vec3, r: number) => {
    minY = Math.min(minY, p[1] - r);
    maxY = Math.max(maxY, p[1] + r);
    maxRadius = Math.max(maxRadius, Math.hypot(p[0], p[2]) + r);
    const inCorridor =
      Math.abs(p[0]) - r < HAIR_ENVELOPE.faceClearHalfWidth &&
      p[2] + r > HAIR_ENVELOPE.faceClearMinZ;
    if (inCorridor) lowestInFaceCorridor = Math.min(lowestInFaceCorridor, p[1] - r);
  };

  if (layout.scalp) {
    for (let i = 0; i <= SCALP_COLUMNS; i++) {
      for (let j = 0; j <= SCALP_ROWS; j++) {
        const p = scalpVertex(layout.scalp, i, j);
        minY = Math.min(minY, p[1]);
        maxY = Math.max(maxY, p[1]);
        maxRadius = Math.max(maxRadius, Math.hypot(p[0], p[2]));
        // The rim is buried in the skull deliberately, and geometry the head is in
        // front of is not in front of a face - see `buriedInSkull`. `coversFace` then
        // asks whether what is left could hide an eye or a cheek at all.
        if (!buriedInSkull(p) && coversFace(p)) {
          lowestInFaceCorridor = Math.min(lowestInFaceCorridor, p[1]);
        }
      }
    }
  }

  // Every vertex of every bundle. They are the outline on a ribbon-built style, so
  // measuring anything less would leave the envelope unchecked exactly where the
  // style actually reaches.
  for (const ribbon of [...layout.ribbons, ...layout.fringeSheets]) {
    for (const p of ribbon.positions) note(p, 0);
  }

  if (layout.curtain) {
    const [rTop, rBot, height, , , , thetaStart, thetaLength] = layout.curtain.args;
    for (let i = 0; i <= 48; i++) {
      const theta = thetaStart + (thetaLength * i) / 48;
      for (const [r, dy] of [[rTop, height / 2], [rBot, -height / 2]] as const) {
        note([r * Math.sin(theta), layout.curtain.y + dy, r * Math.cos(theta)], 0);
      }
    }
  }

  // Bangs, hanging locks and permed bundles are all the same primitive on the same
  // yaw-slot convention, so they measure the same way.
  for (const lock of [...layout.locks, ...layout.fringe, ...layout.perm]) {
    const [thickness, length] = lock.args;
    for (const end of [length / 2, -length / 2]) {
      const local = rotX([0, end, 0], lock.rotation[0]);
      note(rotY(add(local, lock.position), lock.yaw), thickness);
    }
  }

  // Front spikes are rotated AND yawed, so they measure like locks (tip and base
  // pushed through the same two rotations) rather than like the crest's upright cones.
  for (const spike of layout.spikes) {
    const [radius, height] = spike.args;
    for (const [dy, r] of [[height / 2, 0], [-height / 2, radius]] as const) {
      const local = rotX([0, dy, 0], spike.rotation[0]);
      note(rotY(add(local, spike.position), spike.yaw), r);
    }
  }

  if (layout.crest) {
    const { blade, spikes } = layout.crest;
    const [w, h, d] = blade.args;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          note(
            [
              blade.position[0] + (sx * w) / 2,
              blade.position[1] + (sy * h) / 2,
              blade.position[2] + (sz * d) / 2,
            ],
            0,
          );
        }
      }
    }
    for (const spike of spikes) {
      const [r, sh] = spike.args;
      const p = spike.position;
      note([p[0], p[1] + sh / 2, p[2]], 0);
      note([p[0], p[1] - sh / 2, p[2]], r);
    }
  }

  return { minY, maxY, maxRadius, lowestInFaceCorridor };
}

/** Squared distance between two segments, clamped to their endpoints. */
function segmentDistance(p0: Vec3, p1: Vec3, q0: Vec3, q1: Vec3): number {
  const u: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const v: Vec3 = [q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]];
  const w: Vec3 = [p0[0] - q0[0], p0[1] - q0[1], p0[2] - q0[2]];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const a = dot(u, u);
  const b = dot(u, v);
  const c = dot(v, v);
  const d = dot(u, w);
  const e = dot(v, w);
  const det = a * c - b * b;
  let s: number;
  let t: number;
  if (det < 1e-12) {
    s = 0;
    t = c > 1e-12 ? e / c : 0;
  } else {
    s = (b * e - c * d) / det;
    t = (a * e - b * d) / det;
  }
  s = clamp(s, 0, 1);
  t = clamp(t, 0, 1);
  // One clamped pass is enough here: everything measured is short and roughly
  // parallel, so the exact-vs-clamped difference is far below the tolerance.
  const dx = w[0] + s * u[0] - t * v[0];
  const dy = w[1] + s * u[1] - t * v[1];
  const dz = w[2] + s * u[2] - t * v[2];
  return Math.hypot(dx, dy, dz);
}

/** One piece reduced to the capsule it occupies in head-local space. */
interface HairSegment {
  key: string;
  a: Vec3;
  b: Vec3;
  radius: number;
}

/** The axis endpoints of a yaw-slot piece, in head-local space. */
function segmentOf(key: string, part: HairLockPart | HairSpikePart, radius: number): HairSegment {
  const half = part.args[1] / 2;
  const ends = [half, -half].map(dy =>
    rotY(add(rotX([0, dy, 0], part.rotation[0]), part.position), part.yaw),
  );
  return { key, a: ends[0], b: ends[1], radius };
}

/**
 * Every piece that is not physically connected to the head.
 *
 * 「頭髮不要有那種莫名其妙懸浮出來的頭髮，都要有關聯」. The reason that can happen
 * at all is that every piece in this file is placed by its own solver against its
 * own reference: a bang is fitted to the shell, a lock to the curtain, a tier to
 * the tier behind it, a bundle to a latitude ring. Change one style's `bulk` or
 * `flare` and a solver still reading the old surface leaves its pieces hanging in
 * the air beside the new one - and nothing downstream notices, because a floating
 * capsule is well inside the envelope and passes every check `measureHairBounds`
 * makes. Reach and attachment are independent properties.
 *
 * So this is CONNECTIVITY, not proximity, and that distinction is the whole design:
 * an outer tier of locks is supposed to rest on the tier inside it rather than on
 * the curtain, and a first attempt that measured every piece against the scalp and
 * the curtain alone called sixteen perfectly well-seated locks floating. What has
 * to be true is that a piece touches the scalp shell, or the curtain, or something
 * that itself connects back to one of those. So the pieces are flooded from the two
 * solid surfaces outward, and whatever the flood does not reach is genuinely loose
 * hair hanging in space.
 */
export function findFloatingPieces(
  layout: HairLayout,
  tolerance = 0.004,
): Array<{ key: string; gap: number }> {
  const { shellRadius, curtain } = layout.mass;
  const segments: HairSegment[] = [
    ...[...layout.locks, ...layout.fringe, ...layout.perm].map(p =>
      segmentOf(p.key, p, p.args[0]),
    ),
    // A cone's radius is its base's; half of it is the honest average body width.
    ...layout.spikes.map(p => segmentOf(p.key, p, p.args[0] / 2)),
  ];

  /** Is this piece embedded in, or touching, one of the two solid surfaces? */
  const onMass = (seg: HairSegment): boolean => {
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const p: Vec3 = [
        seg.a[0] + (seg.b[0] - seg.a[0]) * t,
        seg.a[1] + (seg.b[1] - seg.a[1]) * t,
        seg.a[2] + (seg.b[2] - seg.a[2]) * t,
      ];
      const ring = Math.hypot(p[0], p[2]);
      // The scalp shell. Inside it counts: a bang rooted under the dome is as
      // attached as a piece can be.
      if (Math.hypot(ring, p[1] - A.originY) - seg.radius <= shellRadius + tolerance) return true;
      if (curtain && p[1] <= HANG_TOP_Y + tolerance && p[1] >= curtain.hemY - tolerance) {
        const k = clamp(
          (HANG_TOP_Y - p[1]) / Math.max(1e-6, HANG_TOP_Y - curtain.hemY),
          0,
          1,
        );
        const surface = curtain.topRadius + (curtain.hemRadius - curtain.topRadius) * k;
        if (ring - seg.radius <= surface + tolerance) return true;
      }
    }
    return false;
  };

  const connected = segments.map(onMass);
  /** How close this piece came to anything already connected - for the report. */
  const nearest = segments.map(() => Infinity);

  // Flood outward. Each pass attaches whatever now touches the growing mass; when a
  // pass attaches nothing new, everything still loose is loose for good.
  for (;;) {
    let grew = false;
    for (let i = 0; i < segments.length; i++) {
      if (connected[i]) continue;
      for (let j = 0; j < segments.length; j++) {
        if (!connected[j]) continue;
        const gap =
          segmentDistance(segments[i].a, segments[i].b, segments[j].a, segments[j].b)
          - segments[i].radius
          - segments[j].radius;
        nearest[i] = Math.min(nearest[i], gap);
        if (gap <= tolerance) {
          connected[i] = true;
          grew = true;
          break;
        }
      }
    }
    if (!grew) break;
  }

  return segments
    .map((seg, i) => ({ key: seg.key, gap: nearest[i] }))
    .filter((_, i) => !connected[i]);
}
