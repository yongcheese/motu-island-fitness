/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BodyPose,
  JointPose,
  PostureId,
  PostureMotion,
  PostureSpec,
  RigJointName,
  getPosture,
} from '../constants/interactionPostures';

/**
 * THE POSTURE RUNTIME — one posture spec plus one moment in time, in; one set of joint angles,
 * out. Nothing else.
 *
 * ## Why this is its own module and not part of Avatar.tsx
 *
 * What used to be in the controller was two hard-coded branches:
 *
 *   `if (isSit) { …seat maths… } else { …hammock climb… }`   the entire pose vocabulary
 *   `leftArm.rotation.x = lerp(…, -1.35, reach)`             the entire gesture vocabulary
 *
 * Both wrote three.js refs directly, which made them impossible to check without a renderer and
 * impossible to extend without editing the file that also owns movement, collision, the camera
 * and the water. A third posture meant a third branch in the middle of that.
 *
 * Everything here is PURE — numbers in, numbers out, no three.js, no refs, no React. That is
 * what lets `npm run audit:interactions` put the character into every posture in the catalog
 * and check where the limbs actually end up, on a machine with no GPU. The controller's job
 * shrinks to "read these angles onto the joints it owns", which is a loop.
 *
 * ## The one thing that is NOT in the posture table
 *
 * Anything that depends on the character's PROPORTIONS or on the piece: where the hips go on a
 * seat, how far a lying head is held up, where the legs actually point once the body leans. Those
 * are solved from the rig's body volumes by lib/occupantFit.ts, which calls this module for the
 * body LANGUAGE and then places it. The table holds language; the fit holds geometry.
 */

/** What a posture resolves to for one frame. */
export interface PostureFrame {
  /** Joint targets, radians, in each joint's own space. Only the joints the posture names. */
  joints: BodyPose;
  /** The character root's pitch, radians. Positive leans forward. */
  rootPitch: number;
  /** The character root's height offset, world units. Negative is a crouch. */
  rootRise: number;
  /**
   * 0..1, how strongly the posture is in force.
   *
   * The controller blends toward {@link joints} by this weight, so a posture at weight 0 is
   * invisible and cannot leave a limb stranded when it ends — which is what makes an acting
   * posture safe to lay over the ordinary idle animation instead of gating it off.
   */
  weight: number;
}

/**
 * How far a swing's rider lets each leg trail the arc, radians — the posture's `ride.legTrail`
 * times the tilt the body is carrying, with the far leg a shade behind the near one so the two do
 * not read as one welded pair.
 *
 * Returned rather than written onto the joints, because the legs of a seated body are placed in
 * the PIECE'S frame and clamped to the swing that stays clear of the seat (lib/occupantFit.ts); a
 * trail added straight onto a joint angle was how a rider's legs used to swing back into the plank
 * at the back of every arc.
 */
export function rideLegTrail(spec: PostureSpec, tilt: number): { left: number; right: number } {
  const trail = spec.ride?.legTrail ?? 0;
  return { left: tilt * trail, right: tilt * trail * 1.15 };
}

/**
 * How strongly an ACTING posture is in force, `phase` seconds into it.
 *
 *   `pulse`  a half sine: out and back, at full extension halfway through. One gesture.
 *   `hold`   ease in over the first fifth, hold, ease out over the last fifth. The body
 *            arrives at the pose and then DOES the thing, which is the whole difference
 *            between stirring a pot for two seconds and waving at one for 0.7.
 *
 * Both reach exactly 0 at t = 0 and t = 1, which is the property the controller relies on:
 * a posture can be laid over the ordinary idle animation with no gate, because at the moment
 * it expires it is contributing nothing.
 */
export function actionEnvelope(spec: PostureSpec, t: number): number {
  const p = clamp(t, 0, 1);
  if (spec.envelope === 'pulse' || !spec.envelope) return Math.sin(p * Math.PI);
  const RAMP = 0.2;
  if (p < RAMP) return smoothstep(p / RAMP);
  if (p > 1 - RAMP) return smoothstep((1 - p) / RAMP);
  return 1;
}

/** What a crouch has to know about the body doing it. Both world units, both from the rig. */
export interface StanceGeometry {
  /** Hip joint height above the root while standing. */
  hipY: number;
  /** Hip joint to sole. */
  legLength: number;
}

/**
 * HOW LOW A POSTURE CAN GET, and why it is derived rather than typed.
 *
 * This rig has no knee. The only way a body made of two straight legs gets lower is to open them
 * — and how much lower that is, is trigonometry, not a preference: a leg swung θ off vertical
 * puts its foot `L·cos θ` below the hip instead of `L`, and the root may drop by exactly the
 * difference before that foot goes through the floor.
 *
 * `tend` was first written with a typed `crouch: 0.24` against legs at -0.60/+0.32, which those
 * legs afford 0.03 of. The other 0.21 was the character standing in the ground — visible from any
 * camera angle, and nothing in the project would have failed. So the number is gone and the LEGS
 * decide: to crouch deeper, open them wider, which is what actually happens to a body.
 *
 * The lean counts too, because the root's pitch carries the legs with it: a body leaning 0.26 into
 * a fire has already swung its front leg 0.26 further from vertical, and this reads the resulting
 * WORLD angle of each leg, not the local one.
 */
export function crouchDrop(id: PostureId, stance: StanceGeometry): number {
  const spec = getPosture(id);
  const lean = spec.lean ?? 0;
  const legs = [spec.hold.leftLeg?.x, spec.hold.rightLeg?.x].filter(
    (v): v is number => v !== undefined,
  );
  if (!legs.length) return 0;
  // The LOWEST foot is the one that reaches the floor first, so it sets the limit.
  const lowest = Math.min(
    ...legs.map((x) => stance.hipY * Math.cos(lean) - stance.legLength * Math.cos(x + lean)),
  );
  const standing = stance.hipY - stance.legLength;
  return Math.max(0, lowest - standing);
}

/**
 * One acting posture, `elapsed` seconds in.
 *
 * The repeating motions are added to the held pose and scaled by the SAME envelope, so a stir
 * that is halfway out of the pose is also halfway out of its stir — otherwise the hand keeps
 * describing circles in the air as the arm drops back to the character's side. The crouch is
 * scaled by it for the same reason: the body has to come back up as the legs close.
 */
export function resolveActionFrame(
  id: PostureId,
  elapsed: number,
  stance: StanceGeometry,
): PostureFrame {
  const spec = getPosture(id);
  const duration = spec.duration ?? 0;
  const t = duration > 0 ? elapsed / duration : 1;
  const weight = actionEnvelope(spec, t);
  const joints = cloneHold(spec.hold);
  applyMotions(joints, spec.motion, t, weight);
  return {
    joints,
    rootPitch: (spec.lean ?? 0) * weight,
    rootRise: -crouchDrop(id, stance) * weight,
    weight,
  };
}

/** Has an acting posture started `elapsed` seconds ago finished? */
export function actionFinished(id: PostureId, elapsed: number): boolean {
  return elapsed >= (getPosture(id).duration ?? 0);
}

/** The moment-to-moment state an occupying posture is resolved against. */
export interface OccupancyPhase {
  /**
   * 0..1 through the whole mount/dismount timeline. 0 is standing beside the piece, 1 is fully
   * settled. The CLIMB is staged against this, so it can peak while the body is still arriving.
   */
  progress: number;
  /**
   * 0..1 through the SETTLE alone — the back 60% of `progress`. The character arrives at the
   * seat before it starts reclining into it, rather than lying its way across the floor.
   */
  settle: number;
  /** Seconds, for the sustained idle. Any monotonic clock. */
  time: number;
  /**
   * The legs' joint angle once settled, for a posture whose legs are placed by the fit rather than
   * animated here. Optional: lib/occupantFit.ts places hanging and outstretched legs in the
   * piece's frame itself (it has to — see there), so it leaves this out and writes them after.
   */
  legSwing?: number;
  /**
   * How far the piece itself is tilted this frame, radians — from lib/outdoorMotion.ts's
   * `suspendedAngle`, and 0 (or absent) for a piece that does not move.
   *
   * The posture's `ride` block turns it into limb angles. Passed IN rather than recomputed here
   * because the controller has already evaluated it to place the body, and the two answers being
   * literally the same number is the whole reason the rider and the seat stay together.
   */
  tilt?: number;
}

/** `settle` from `progress` — the back 60%. One definition, so nothing re-derives it. */
export function settleFrom(progress: number): number {
  return clamp((progress - 0.4) / 0.6, 0, 1);
}

/**
 * One occupying posture at one moment.
 *
 * Three things are layered, in this order:
 *
 *   1. the HELD pose, scaled by `settle` — where the body ends up;
 *   2. the ENTRY, scaled by its own bell curve against `progress` — the climb over the edge of
 *      a bed, the hand steadying on the arm of a chair. Peaks early and is gone by the time the
 *      body is settled, so it never fights (1);
 *   3. the IDLE, scaled by `settle` — the bob and the drift that keep a settled body alive.
 *
 * `weight` is 1 throughout: unlike an acting posture, this one OWNS the body while it lasts
 * (the controller gates its ordinary limb animation off), so there is nothing to blend against.
 */
export function resolveOccupancyFrame(id: PostureId, phase: OccupancyPhase): PostureFrame {
  const spec = getPosture(id);
  const { progress, settle, time, legSwing, tilt = 0 } = phase;
  const joints: BodyPose = {};

  // 1. the held pose
  for (const [name, pose] of Object.entries(spec.hold) as [RigJointName, JointPose][]) {
    joints[name] = { x: (pose.x ?? 0) * settle, y: (pose.y ?? 0) * settle, z: (pose.z ?? 0) * settle };
  }

  // The legs' resting swing, which is geometry rather than language and so is not in `hold`.
  if (legSwing !== undefined && spec.legs !== 'climbOver') {
    axis(joints, 'leftLeg', 'x', legSwing * settle);
    axis(joints, 'rightLeg', 'x', legSwing * settle);
  }

  // 1b. the body's answer to a piece that is MOVING under it.
  //
  // Laid on before the entry and the idle so those still read on top of it, and scaled by
  // `settle` like everything else here — a body still climbing on has not started riding yet.
  // The legs' share (`legTrail`) is NOT added here: a seated body's legs are placed in the
  // piece's frame and clamped clear of the seat by lib/occupantFit.ts, which reads it through
  // `rideLegTrail`. Added straight onto the joint, it swung the legs back into the plank.
  const ride = spec.ride;
  if (ride && tilt !== 0 && settle > 0) {
    const t = tilt * settle;
    if (ride.leanBack) addAxis(joints, 'torso', 'x', t * ride.leanBack);
    if (ride.armBrace) {
      addAxis(joints, 'leftArm', 'x', t * ride.armBrace);
      addAxis(joints, 'rightArm', 'x', t * ride.armBrace);
    }
  }

  // 2. the entry
  if (spec.legs === 'climbOver') {
    // Legs up and over the edge, arms down to grip — peaks as the character steps up
    // (progress ~0.3) and relaxes once reclined. Unchanged from the hammock it was written
    // for; it reads just as well getting into a bed.
    const climb = progress < 0.3 ? progress / 0.3 : Math.max(0, 1 - (progress - 0.3) / 0.4);
    axis(joints, 'leftLeg', 'x', -climb * 1.3);
    axis(joints, 'rightLeg', 'x', -climb * 0.6);
    axis(joints, 'leftLeg', 'z', 0);
    axis(joints, 'rightLeg', 'z', 0);
    axis(joints, 'leftArm', 'x', -climb * 0.9);
    axis(joints, 'rightArm', 'x', -climb * 0.9);
  } else {
    // Hands reach out a little at the halfway point — the moment someone actually steadies
    // themselves as they lower onto a seat, or onto the floor of a tub.
    const steady = Math.sin(clamp(progress / 0.6, 0, 1) * Math.PI) * 0.5;
    if (steady > 0.001) {
      addAxis(joints, 'leftArm', 'x', -steady);
      addAxis(joints, 'rightArm', 'x', -steady);
      addAxis(joints, 'leftArm', 'z', -steady * 0.3);
      addAxis(joints, 'rightArm', 'z', steady * 0.3);
    }
  }

  // 3. the sustained idle
  let rootRise = 0;
  let rootPitch = (spec.lean ?? 0) * settle;
  const idle = spec.idle;
  if (idle && settle > 0) {
    const wave = Math.sin(time * (idle.rate ?? 0.3) * Math.PI * 2);
    rootRise += (idle.bob ?? 0) * wave * settle;
    rootPitch += (idle.rock ?? 0) * wave * settle;
    // The drift's own `cycles` are read against the idle rate rather than a duration — an
    // occupancy has no end to measure a cycle against.
    for (const m of idle.drift ?? []) {
      const t = time * (idle.rate ?? 0.3) * m.cycles + (m.phase ?? 0);
      addAxis(joints, m.joint, m.axis, m.amplitude * Math.sin(t * Math.PI * 2) * settle);
    }
  }

  return { joints, rootPitch, rootRise, weight: 1 };
}

// ---------------------------------------------------------------------------

function cloneHold(hold: BodyPose): BodyPose {
  const out: BodyPose = {};
  for (const [name, pose] of Object.entries(hold) as [RigJointName, JointPose][]) {
    out[name] = { ...pose };
  }
  return out;
}

function applyMotions(
  joints: BodyPose,
  motions: readonly PostureMotion[] | undefined,
  t: number,
  weight: number,
) {
  for (const m of motions ?? []) {
    const wave = Math.sin((t * m.cycles + (m.phase ?? 0)) * Math.PI * 2);
    addAxis(joints, m.joint, m.axis, m.amplitude * wave * weight);
  }
}

/** Set one axis, creating the joint entry if the posture had not named it. */
function axis(joints: BodyPose, joint: RigJointName, key: 'x' | 'y' | 'z', value: number) {
  (joints[joint] ??= {})[key] = value;
}

/** Add to one axis, treating an unnamed joint or axis as 0. */
function addAxis(joints: BodyPose, joint: RigJointName, key: 'x' | 'y' | 'z', value: number) {
  const entry = (joints[joint] ??= {});
  entry[key] = (entry[key] ?? 0) + value;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(t: number): number {
  const p = clamp(t, 0, 1);
  return p * p * (3 - 2 * p);
}
