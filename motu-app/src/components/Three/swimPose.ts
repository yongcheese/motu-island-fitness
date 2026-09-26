/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE WATER POSE.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 *
 * The water animation used to be two poses, not one. Avatar.tsx held a `proneTilt` of
 * +PI/2.2 (+81.8deg, face down in the water) for "moving" and a `floatTilt` of -PI/2.05
 * (-87.8deg, flat on your back) for "idle", and every limb chain picked between two
 * completely unrelated curves with a bare `if (isMoving.current)`. Letting go of WASD
 * therefore asked the body to travel 169.6deg - through upright - while the arms cut in
 * one frame from a full-circle freestyle windmill to a starfish back-float. That is the
 * flip, the lie-down and the limb snap, and no transition duration can hide it: the two
 * endpoints simply were not the same character.
 *
 * So the fix is not a blend rate. It is that THERE IS ONLY ONE WATER POSE. Floating and
 * swimming share a single body attitude, a single head angle, a single limb rest pose and
 * a single surface bob; the ONLY difference between them is how big the arms and legs
 * move, which is a continuous 0..1 amplitude. Starting to swim adds motion. It never
 * re-orients anything.
 *
 * ---------------------------------------------------------------------------
 * The two weights and the one phase
 * ---------------------------------------------------------------------------
 *
 * Everything here is driven by exactly three numbers, all owned by Avatar.tsx:
 *
 *   pose   0..1  How much water pose there is at all. 0 = the land pose, 1 = fully
 *                floating. Land <-> water enter/exit rides this, and so do the shallows:
 *                it is the transition progress TIMES swimPitchAllowance(), so a character
 *                wading in ankle-deep is a partial pose rather than a special case.
 *   stroke 0..1  How hard the character is swimming: pose * moveWeight. Amplitude only -
 *                it must never appear in a base angle, because a base angle that moves
 *                with it is exactly the flip this file exists to delete.
 *   phase  rad   The stroke cycle. ALWAYS advancing while there is any water pose, at a
 *                rate that eases between a slow idle scull and the actual travel speed.
 *                Never frozen and never reset, so no state change can land the limbs on a
 *                stale angle.
 *
 * ---------------------------------------------------------------------------
 * Sign conventions (all verified against the rig, do not guess these)
 * ---------------------------------------------------------------------------
 *
 * ROOT PITCH  Positive is face-down. The root's origin is the character's FEET, so a
 *             pitch of `t` swings the whole body forward about the ankles and leaves the
 *             head at `headJointY * cos(t)` above the feet. t = PI/2 is exactly
 *             horizontal; LESS than that is head-up, which is the whole point of
 *             SWIM_BODY_PITCH below.
 * ARM / LEG   The limb hangs along -Y from its joint, so `rotation.x = p` puts the hand at
 *             (0, -cos p, -sin p) in body space. In the pitched water frame body +Y points
 *             the way the character swims and body +Z points down into the water. So
 *             p = -PI/2 is the hand straight down into the water, p = -PI is reaching
 *             ahead, p = 0 is back at the hip. For the legs the same axis means POSITIVE
 *             lifts the feet toward the surface.
 * HEAD        Negative rotation.x looks UP, i.e. it gives back the body's forward pitch.
 * TORSO       rotation.y rolls the shoulders about the spine once the body is horizontal.
 *
 * ---------------------------------------------------------------------------
 * Blending against the land pose
 * ---------------------------------------------------------------------------
 *
 * Each channel is returned as a `{ base, osc }` pair rather than one angle, and that split
 * is load-bearing. `base` is where the limb rests in the water and is blended against the
 * land value along the SHORTEST ARC (see blendSwimAngle); `osc` is the stroke motion and
 * is simply scaled by the pose weight. Collapsing the two into a single angle before
 * blending would make the shortest arc depend on where in the stroke cycle the character
 * happened to be when it entered the water - and near the +-PI wrap that flips the
 * direction the arm travels, which is a windmill on the way into the sea.
 */

/**
 * The shared body attitude, radians of forward pitch, applied at pose = 1.
 *
 * 1.24 rad is 71deg: 19deg off horizontal, head end up. With the shipped rig (head joint
 * 0.68 LOCAL x 2.25 = 1.53 world above the feet) that carries the face
 * 1.53 * cos(71deg) = 0.50 world above the root, and the root floats at SWIM_BODY_Y
 * (0.1 below the waterline), so the face rides ~0.4 above the surface and the shoulders
 * ~0.19 above it. Chest higher than the legs, face clear of the water, body still reading
 * as horizontal - which is the brief.
 *
 * The old prone value (81.8deg) put the face 0.12 above the root, i.e. AT the waterline
 * with the skull mostly under it. That is the "face down, sunk" pose, and it came from
 * copying competitive freestyle, where the swimmer breathes to the side. A cozy swim does
 * not do that; it keeps its face out.
 */
export const SWIM_BODY_PITCH = 1.24;

/**
 * Extra forward lean at stroke = 1, added to SWIM_BODY_PITCH.
 *
 * Deliberately tiny. This is the ONLY base angle in this file allowed to move with the
 * stroke weight, and 0.10 rad (5.7deg) is about the limit of what can move without reading
 * as a change of pose - it lands the face 0.25 above the surface instead of 0.4, so the
 * character still never gets its face wet. It exists because "leans in slightly as it sets
 * off" is what the transition into swimming should look like, and because the alternative -
 * the body doing nothing at all when you press W - reads as the arms being detached from
 * the character.
 */
export const SWIM_STROKE_LEAN = 0.10;

/**
 * The absolute angle from vertical that the legs trail at, whatever the body is doing.
 *
 * The legs are stated in WORLD terms and converted to a hip angle by subtracting the body
 * pitch, so that the extra stroke lean tips the legs UP by exactly as much as it tips the
 * chest DOWN and the legs keep skimming the same depth. Stated as a hip angle instead, the
 * lean would drive the feet 0.1 rad deeper every time the player pressed W.
 *
 * 1.44 rad is 82.5deg, i.e. 7.5deg below horizontal: the feet sit ~0.16 world below the
 * hips, just under the surface, which is where a floating pair of legs actually hangs.
 * Exactly horizontal (PI/2) would lift them clear of the water.
 */
export const SWIM_LEG_LINE = 1.44;

/**
 * How far below horizontal the face is left pointing, once the head has given back the
 * body's pitch. The direct analogue of CRAWL_HEAD_GAZE in Avatar.tsx, and for the same
 * reason: the pitch is applied to the whole group, head included, so without this the face
 * points wherever the spine does.
 *
 * 0.30 rad (17deg down) looks a body length or two ahead along the surface. Zero would
 * crane the neck fully back; the old +0.12 (a chin TUCK, on top of an 82deg body pitch)
 * aimed the face straight into the sea floor.
 */
export const SWIM_HEAD_GAZE = 0.30;

/**
 * Stroke cycle rate, radians/second.
 *
 * IDLE is the floating scull - one full cycle every ~5.5s, slow enough to read as resting.
 * The moving rate is the travel speed times PER_SPEED, clamped: the brief's "animation
 * speed follows movement speed, with a sane minimum and maximum". At the shipped swim speed
 * (5.47 world units/s) that lands at 3.39 rad/s, one arm cycle per 1.85s - a relaxed
 * touring stroke. For reference the old code ran the arms off walkPhase at 9.6 rad/s, a
 * stroke every 0.65s, which is a large part of why swimming read as frantic.
 */
export const SWIM_IDLE_CYCLE = 1.15;
export const SWIM_CYCLE_PER_SPEED = 0.62;
export const SWIM_CYCLE_MIN = 2.2;
export const SWIM_CYCLE_MAX = 5.4;

/** Flutter kick rate as a multiple of the arm cycle. Two-and-a-bit beats per stroke. */
export const SWIM_KICK_RATIO = 2.5;

/** Surface bob: amplitude in WORLD units, rate in rad/s. Identical in both states. */
export const SWIM_BOB_AMP = 0.05;
export const SWIM_BOB_RATE = 0.9;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** One channel of the pose: a resting angle plus the stroke motion riding on it. */
export interface SwimChannel {
  /** Where the limb rests in the water. Blended against the land pose by shortest arc. */
  base: number;
  /** Stroke motion about `base`. Scaled by the pose weight, never blended as an angle. */
  osc: number;
}

const ch = (base: number, osc: number): SwimChannel => ({ base, osc });

/**
 * Which way the character is actually travelling, in its OWN frame - the whole of this
 * file's answer to "the animation must not assume the character only ever swims forward".
 *
 * In third person these are always (1, 0): the controller yaws the body to face the
 * movement direction, so W/A/S/D are already correct and these terms vanish. They earn
 * their keep in first person and at high zoom, where the yaw is locked to the camera and
 * S genuinely means "swim backwards" and A/D genuinely mean "swim sideways".
 *
 * Nothing here writes to the controller. This is read off the movement vector the
 * controller already produced.
 */
export interface SwimDrive {
  /** +1 travelling the way the body faces, -1 straight backwards. */
  forward: number;
  /** +1 travelling to the body's right, -1 to its left. */
  strafe: number;
}

export const SWIM_DRIVE_FORWARD: SwimDrive = { forward: 1, strafe: 0 };

/**
 * Radians the stroke cycle advances per second.
 *
 * `speed` is the character's ACTUAL horizontal speed this frame, not a constant, so any
 * future swim-speed feat or slowdown moves the arms with it for free. The clamp is what
 * stops that becoming "the faster you go the more the character vibrates".
 */
export function swimCycleRate(stroke: number, speed: number): number {
  const travelling = Math.min(SWIM_CYCLE_MAX, Math.max(SWIM_CYCLE_MIN, speed * SWIM_CYCLE_PER_SPEED));
  return lerp(SWIM_IDLE_CYCLE, travelling, clamp01(stroke));
}

/** The body's forward pitch for a given stroke weight. The one shared attitude. */
export function swimBodyPitch(stroke: number): number {
  return SWIM_BODY_PITCH + SWIM_STROKE_LEAN * clamp01(stroke);
}

/**
 * Root motion: the surface itself. Present identically whether floating or swimming, so
 * that starting and stopping never changes the rhythm the body rides on.
 *
 * `roll` carries the stroke's shoulder dip (locked to the arm phase, so the body rotates
 * toward whichever hand is pulling) plus a slow swell that is there even at rest, plus a
 * lean into the direction of travel when strafing. All three are small on purpose - the
 * brief's "rotation amplitude should be very small" - and they sum to well under 0.12 rad.
 */
export function swimRootMotion(time: number, phase: number, stroke: number, drive: SwimDrive) {
  const s = clamp01(stroke);
  return {
    /** WORLD units, added to the float height. */
    bob: Math.sin(time * SWIM_BOB_RATE) * SWIM_BOB_AMP,
    /** Radians, added to swimBodyPitch(). */
    pitchWobble: Math.sin(time * 0.73) * 0.018,
    /** Radians about the body's own forward axis. */
    roll:
      Math.sin(phase) * lerp(0.022, 0.055, s) +
      Math.sin(time * 0.55) * 0.02 +
      drive.strafe * 0.16 * s,
  };
}

/**
 * The arms. One formula for floating and for swimming - only the numbers it interpolates
 * between change, which is what makes "start swimming" an amplitude ramp instead of a cut.
 *
 * The hand traces an ELLIPSE, not a line: `x` (fore-aft) and `z` (out-in) run in
 * quadrature, so over one cycle the hand goes forward, down, back along the body, then out
 * and around to the front again. That circulation is what reads as a stroke rather than as
 * sculling, and it is what lets the same curve serve the idle - shrink the ellipse and the
 * hand simply drifts in a small slow oval by the hip.
 *
 * Base angles are stated in the NEGATIVE representation (-1.33 rather than its equivalent
 * 4.95) so that the shortest arc from the land pose is unambiguous - see the module note.
 *
 * @param side -1 for the left arm, +1 for the right.
 */
export function swimArmPose(side: -1 | 1, phase: number, stroke: number, drive: SwimDrive) {
  const s = clamp01(stroke);
  // Arms alternate. Half a cycle apart is the whole of "never let both arms do the same
  // thing at the same time" - one reaches while the other pulls.
  const p = side < 0 ? phase : phase + Math.PI;

  // Resting angle: -1.33 rad hangs the hand below the chest (the treading-water scull),
  // -2.13 carries it forward into the middle of a pull. Under 0.8 rad apart, so even the
  // base shift between floating and swimming is a small, believable reach.
  const centre = lerp(-1.33, -2.13, s);
  // Sweep: 0.16 rad is a lazy drift, 0.72 a compact cozy pull. The old freestyle ran a
  // full unbounded revolution, which cannot be faded out at all.
  const sweep = lerp(0.16, 0.72, s);
  // Out from the body: wide and relaxed while floating, tucked in while stroking.
  const spread = lerp(0.40, 0.22, s);
  const flare = lerp(0.06, 0.26, s);

  // Strafing: the arm on the side being travelled toward reaches wider, the trailing one
  // pulls harder - a lopsided scull, which is what sculling sideways looks like.
  const asym = 1 + drive.strafe * side * 0.3 * s;

  // `side` IS the sign of rotation.z: negative is outboard on the left, positive on the
  // right, which is the convention the land pose states as `rotation.z = -baseTilt` on the
  // left and `+baseTilt` on the right. Both terms therefore carry it - an outboard amount
  // multiplied by the side - rather than being written out per arm.
  return {
    x: ch(centre, sweep * Math.sin(p) * asym),
    // The cos runs NEGATIVE: most outboard where the hand is swinging FORWARD (recovery,
    // elbow leading) and most tucked where it is pulling back along the body.
    z: ch(side * spread, -side * flare * Math.cos(p)),
    y: ch(0, side * 0.14 * Math.cos(p) * s),
  };
}

/**
 * The legs. A small flutter, and deliberately not the main event: the brief asks for the
 * legs to sell "is swimming" from the corner of the eye and nothing more.
 *
 * @param pitch The body pitch actually in use, so the trail line stays put - see
 *              SWIM_LEG_LINE.
 */
export function swimLegPose(side: -1 | 1, phase: number, stroke: number, pitch: number) {
  const s = clamp01(stroke);
  const kick = phase * SWIM_KICK_RATIO + (side < 0 ? 0 : Math.PI);
  return {
    x: ch(SWIM_LEG_LINE - pitch, Math.sin(kick) * lerp(0.045, 0.20, s)),
    z: ch(side * lerp(0.14, 0.05, s), 0),
  };
}

/**
 * The head. The single most visible thing in the old pose and the one the brief is most
 * insistent about: the face comes out of the water and stays out.
 *
 * The base gives back all but SWIM_HEAD_GAZE of the body pitch, so the face points along
 * the surface however the body is leaning. The oscillation is a small yaw with the stroke
 * (the head turning slightly toward the pulling arm) and nothing on the pitch axis at all,
 * because bobbing the head up and down is exactly what makes a swim look like drowning.
 */
export function swimHeadPose(phase: number, stroke: number, pitch: number, drive: SwimDrive) {
  const s = clamp01(stroke);
  return {
    x: ch(-(pitch - SWIM_HEAD_GAZE), 0),
    // Look where you are going: in first person a strafe means the character is genuinely
    // travelling sideways, so the head leads it.
    y: ch(drive.strafe * 0.25 * s, Math.sin(phase) * 0.14 * s),
    z: ch(0, Math.sin(phase) * 0.05 * s),
  };
}

/**
 * The torso. A small counter-roll to the root's, which is what turns "the whole avatar
 * tips" into "the shoulders rotate with the stroke".
 */
export function swimTorsoPose(phase: number, stroke: number) {
  const s = clamp01(stroke);
  return { y: ch(0, Math.sin(phase) * lerp(0.05, 0.16, s)) };
}

/**
 * Blends one channel against the land pose.
 *
 * The base takes the SHORTEST arc, so a limb never travels the long way round on the way
 * into or out of the water; the stroke motion is faded in by weight rather than blended,
 * for the reason given in the module note.
 */
export function blendSwimAngle(landValue: number, channel: SwimChannel, weight: number): number {
  const w = clamp01(weight);
  let diff = channel.base - landValue;
  while (diff < -Math.PI) diff += Math.PI * 2;
  while (diff > Math.PI) diff -= Math.PI * 2;
  return landValue + diff * w + channel.osc * w;
}

/**
 * Smoothstep for the enter/exit water progress.
 *
 * The state machine hands out a LINEAR 0..1, and a linear ramp has corners: velocity
 * appears and disappears in one frame at both ends, which is visible on a whole-body pitch
 * change however short it is. Easing it is not "increasing the transition duration" - the
 * duration is unchanged, this is the shape.
 */
export function swimEase(p: number): number {
  const t = clamp01(p);
  return t * t * (3 - 2 * t);
}
