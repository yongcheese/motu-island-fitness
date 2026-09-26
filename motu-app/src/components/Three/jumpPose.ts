/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE JUMP.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 *
 * There was no jump animation. There was a jump ARC — `sin(progress * PI) * JUMP_HEIGHT`
 * over a fixed 0.4 s, written out twice (once in the moving branch of Avatar's frame, once
 * in the standing one) — plus a squash/stretch on the ROOT's scale. Every joint in the body
 * went on running the walk or idle cycle underneath it, because the arm and leg chains
 * branch on `isFlipping`, `emote` and the swim pose and have never had a case for the jump
 * at all. The character therefore left the ground with its arms still swinging at walking
 * pace and its legs still striding, which is precisely the reported symptom: 「整個模型被直接
 * 往上移動」.
 *
 * Three things follow from that, and this file is all three:
 *
 *   1. A JUMP IS A STATE MACHINE, not a timer. 準備 → 起跳 → 上升 → 下降 → 落地 are five
 *      different things the body does, and which one it is doing has to be answerable from
 *      the physics (see below), not from "how long ago was the key pressed".
 *   2. THE PHYSICS IS THE AUTHORITY. The arc is integrated from a real vertical velocity
 *      against a real gravity, so `vy > 0` IS 上升 and `vy < 0` IS 下降 — there is no second
 *      copy of the timeline for the animation to disagree with. Landing is the arc reaching
 *      the support surface, not the clock running out.
 *   3. THE POSE IS SPOKEN IN JOINT NAMES. Every pose below is a `BodyPose` from
 *      constants/interactionPostures.ts — the same vocabulary the furniture postures already
 *      use — so it is written against the RIG and not against this character. A model that
 *      splits the arm into an upper and a lower segment adds `leftLowerArm` to `RigJointName`
 *      and a line to the poses here; nothing about the state machine, the physics or the
 *      blending changes. That is section 六 of the brief.
 *
 * Nothing in this file touches three.js, React or the scene graph. It is pure functions and
 * one mutable state record, which is what lets `npm run audit:jump` run the REAL jump —
 * the real machine, the real curves — over scripted input without a renderer.
 *
 * ---------------------------------------------------------------------------
 * Sign conventions (verified against the rig, do not guess these)
 * ---------------------------------------------------------------------------
 *
 *   ARM / LEG  the limb hangs along -Y from its joint, so NEGATIVE rotation.x swings it
 *              FORWARD and up, positive swings it back. (Same convention the walk cycle,
 *              the crawl's floor clearance and the hammock's knee lift all use.)
 *   ARM z      the elbow going OUT from the ribs: negative on the left, positive on the
 *              right. They mirror — a single signed number would swing both the same way.
 *   HEAD x     negative looks UP.
 *   TORSO x    positive leans the chest FORWARD (CELEBRATE's chest-out pump is negative).
 *   ROOT       `rootOffset` is world units ABOVE the support surface the body is standing
 *              on. Negative is a dip into a crouch, positive is the arc.
 */

import type { BodyPose, RigJointName } from '../../constants/interactionPostures';

// ---------------------------------------------------------------------------
// The arc
// ---------------------------------------------------------------------------

/**
 * How high the jump goes, world units. Unchanged from the arc this replaces — the height
 * was tuned by feedback ("was 1.2 — jump raised per feedback") and this rework is about what
 * the BODY does on the way up, not about how far up it goes.
 */
export const JUMP_APEX = 1.9;

/**
 * Ground to ground, seconds. Slightly longer than the 0.4 s the old sine ran for, and the
 * extra 60 ms is not padding: a ballistic arc spends most of its time near the apex, so at
 * 0.4 s the descent is over in ~90 ms and there is physically nowhere to put a 下降 pose.
 * 0.46 s reads as the same snappy hop and leaves the fall long enough to see.
 */
export const JUMP_AIRTIME = 0.46;

/**
 * Both derived from the two numbers above rather than tuned separately, because a hand-tuned
 * gravity and a hand-tuned take-off speed can disagree about how high the jump goes, and then
 * the character lands somewhere other than where the arc says it should.
 *
 *   h = v²/2g and T = 2v/g  ⟹  v = 4h/T, g = 8h/T².
 */
export const JUMP_TAKEOFF_SPEED = (4 * JUMP_APEX) / JUMP_AIRTIME;
export const JUMP_GRAVITY = (8 * JUMP_APEX) / (JUMP_AIRTIME * JUMP_AIRTIME);

// ---------------------------------------------------------------------------
// Phase timings
// ---------------------------------------------------------------------------

/**
 * 準備. Deliberately at the short end of what reads as anticipation.
 *
 * The brief asks for a crouch AND for it not to cost input latency, and those pull opposite
 * ways: every millisecond here is a millisecond between the key going down and the character
 * leaving the ground. 90 ms is about five frames — enough for the eye to register a dip and
 * for the take-off to have something to come out of, and short enough that it reads as part
 * of the jump rather than as the game hesitating. (Anything past ~0.15 s starts to feel like
 * lag; anything under ~0.06 s cannot be seen at all and is pure cost.)
 */
export const JUMP_CROUCH_DURATION = 0.09;

/** 起跳 — the extension. The window over which the crouch opens out into the airborne pose. */
export const JUMP_TAKEOFF_DURATION = 0.14;

/** 落地 — impact, absorb, and back to whatever the body was doing before. */
export const JUMP_LAND_DURATION = 0.24;

/** How fast the impact itself lands, inside {@link JUMP_LAND_DURATION}. The rest is recovery. */
const LAND_IMPACT_DURATION = 0.06;

/** How long the airborne poses take to arrive once their phase begins. */
const RISE_BLEND = 0.12;
const FALL_BLEND = 0.15;
/** A free fall (walked off a ledge) has no take-off to come out of, so it fades in instead. */
const FREE_FALL_BLEND = 0.18;

/**
 * WHAT MAKES A FALL A FALL — 「從高處落下」, which had no state at all before this.
 *
 * The obvious signal is the wrong one, and it took the real game to say so. The first version
 * of this asked whether the drawn body was more than 0.45 units above its own support height:
 * the rendered root chases that height through a first-order lag, so a ledge opens a gap
 * immediately. Measured on the actual island, WALKING DOWN THE ISLAND'S OWN SLOPE opens a gap
 * of 0.79 — nearly twice the threshold — because the same lag that catches a ledge also trails
 * a descent. The character spent every walk down to the beach in a falling pose.
 *
 * A gap cannot tell those apart at any threshold, because they are the same quantity. What
 * separates them is HOW the ground went away: a slope lowers it continuously, at a rate the
 * player's own walking speed bounds (~1 unit/s down the steepest part of this island), while
 * a ledge removes it discontinuously — several units between one frame and the next. So the
 * entry test is the support's DROP RATE, and the gap is only used to decide when the feet are
 * back down.
 *
 * 8 units/s is an order of magnitude above anything walking can produce and an order of
 * magnitude below the one-frame rate of a real ledge.
 */
const FREE_FALL_DROP_RATE = 8;
/** How close to the support the body has to come back before the fall is over. */
const FREE_FALL_EXIT = 0.12;
/**
 * A free fall this file does not own the height of cannot end itself, so it gets a deadline:
 * whatever the terrain is doing, the body stops playing 下降 after this long and lands. Without
 * it, a support height that never converges leaves the pose held forever — which is exactly the
 * failure the gap-based version produced.
 */
const FREE_FALL_MAX = 2.0;

/**
 * HOW FAR THE BODY SINKS — and why there is no number for it here.
 *
 * The obvious way to write a crouch is "drop the root by 0.10 world units". It is also wrong,
 * and wrong in a way that is invisible until you look at the feet: the root origin IS the
 * ground contact point (constants/characterRig.ts), so dropping it drives the soles straight
 * through the terrain. A different model with different legs sinks by a different amount, and
 * a hand-tuned dip has no way to know.
 *
 * So the dip is not authored at all — it is DERIVED from the leg angle the pose already asks
 * for. A leg of length L swung θ off vertical puts its foot L·cos θ below the hip, so the hip
 * may fall by exactly L(1 − cos θ) with the foot staying precisely where it was. Bending the
 * legs and lowering the body become one thing, which is what they are.
 *
 * This is the same rule the furniture postures follow (constants/interactionPostures.ts's note
 * on proportions): body LANGUAGE lives in this file, MEASUREMENTS come from the rig at runtime.
 */
function crouchDip(legLength: number, legAngle: number): number {
  return legLength * (1 - Math.cos(legAngle));
}

/**
 * The dip for the pose currently in `scratch`, at the weight it is about to be applied at.
 *
 * Reading the BLENDED angle rather than the key pose's is what makes the guarantee hold on
 * every frame instead of only at full extension: through a landing's first 60 ms the knees are
 * still on their way from the falling pose to the absorb, and taking the absorb's own angle
 * there would sink the hips further than the legs have yet bent — feet through the floor for
 * exactly as long as the impact lasts, which is precisely when someone is looking at them.
 */
function poseDip(legLength: number, weight: number): number {
  return crouchDip(legLength, (scratch.leftLeg?.x ?? 0) * weight);
}

/**
 * How long a jump pressed in mid-air is remembered for. Note that the absorb spends the first
 * LAND_IMPACT_DURATION of it before the hop can be taken, so the window the PLAYER experiences
 * (how early they may press) is that much shorter than this number. Pressing space a beat early while
 * still coming down is what 連續跳躍 feels like from the player's side, and without a buffer
 * the input is simply dropped and the second hop never happens.
 */
const JUMP_BUFFER = 0.24;

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

/**
 * Where the body is in the jump. The animation reads THIS — never the key, and never a
 * stopwatch started when the key was pressed.
 *
 *   grounded  no jump, feet on the ground. The walk/idle animation owns the body.
 *   crouch    準備. Still grounded, still on the player's own feet, gathering.
 *   takeoff   起跳. Airborne, legs extending, arms swinging up. vy is at its largest.
 *   rise      上升. vy > 0.
 *   fall      下降. vy < 0 — or, with `ballistic` false, a fall off a ledge that this
 *             machine did not launch and does not own the height of.
 *   land      落地. Grounded again, absorbing, on the way back to grounded.
 */
export type JumpPhase = 'grounded' | 'crouch' | 'takeoff' | 'rise' | 'fall' | 'land';

export interface JumpState {
  phase: JumpPhase;
  /** Seconds spent in the current phase. */
  t: number;
  /** Vertical speed of the arc, world units per second. Meaningless unless `ballistic`. */
  vy: number;
  /** How far the arc is currently holding the body above its support surface. */
  offsetY: number;
  /**
   * Whether this machine OWNS the height right now. A jump does; a fall off a ledge does not
   * — there the terrain has already dropped away underneath and the controller's own easing
   * carries the body down, so adding an arc on top would fight it.
   */
  ballistic: boolean;
  /** Seconds left on a jump request that arrived mid-air. See {@link JUMP_BUFFER}. */
  buffer: number;
  /**
   * WHERE THE BODY WAS when the current 準備 began, and how strongly the jump owned it.
   *
   * A jump normally starts from a body this file has no opinion about — mid-walk, mid-idle —
   * and the fade-in handles that: the pose is the crouch from the first frame and the WEIGHT
   * climbs from zero. A CHAINED jump (連續跳躍, one hop straight into the next) does not work
   * that way. There the jump already owns the body at full strength, in the landing pose, and
   * fading a fresh crouch in from zero would mean dropping the landing pose in a single frame —
   * which is a 0.62 rad snap on the arms, and was one until this existed.
   *
   * So the crouch remembers what it interrupted and blends out of it. Same mechanism serves
   * both cases: a fresh jump simply records the crouch itself at weight 0.
   */
  entryPose: BodyPose;
  entryWeight: number;
  /**
   * The pose and weight this state last emitted, so {@link JumpState.entryPose} has something
   * to record. Kept per state rather than in a module-level scratch because more than one
   * avatar can be mounted at a time (the island and the dressing room), and one of them
   * jumping must not be able to give the other its pose.
   */
  lastPose: BodyPose;
  lastWeight: number;
}

export function createJumpState(): JumpState {
  return {
    phase: 'grounded',
    t: 0,
    vy: 0,
    offsetY: 0,
    ballistic: false,
    buffer: 0,
    entryPose: emptyPose(),
    entryWeight: 0,
    lastPose: emptyPose(),
    lastWeight: 0,
  };
}

/** A pose with every joint this file drives, all at rest. */
function emptyPose(): BodyPose {
  const pose: BodyPose = {};
  for (const joint of JUMP_JOINTS) pose[joint] = { x: 0, z: 0 };
  return pose;
}

function copyPoseInto(dest: BodyPose, src: BodyPose) {
  for (const joint of JUMP_JOINTS) {
    const to = dest[joint]!;
    const from = src[joint];
    to.x = from?.x ?? 0;
    to.z = from?.z ?? 0;
  }
}

export interface JumpInput {
  /** The player asked to jump on this frame. */
  requested: boolean;
  /**
   * Whether a jump may START now. The controller's rules, not this file's: not while sitting
   * or lying on furniture, not mid-somersault, not while swimming.
   *
   * It gates STARTING only. A jump already in the air is never cancelled by this going false
   * — a body cannot un-leave the ground, and the one thing worse than a jump that should not
   * have started is a body that stops mid-air.
   */
  canJump: boolean;
  /**
   * How far the rendered body currently is above the surface it is standing on, world units.
   * Used to decide when a fall is OVER — the feet are back down.
   */
  supportGap: number;
  /**
   * How fast that surface is falling away underneath the character, world units per second,
   * positive downward. This is what STARTS a free fall — see FREE_FALL_DROP_RATE for why the
   * gap above cannot, and what happened when it tried.
   */
  supportDrop: number;
}

/**
 * One frame of the jump. Mutates `state` in place (it is a ref's contents, and this runs 60
 * times a second) and returns it for convenience.
 *
 * The order inside matters and is not arbitrary: a request is consumed BEFORE the phase is
 * advanced, so a jump pressed on the frame a landing completes starts on that same frame
 * rather than a frame late.
 */
export function stepJump(state: JumpState, dt: number, input: JumpInput): JumpState {
  state.t += dt;
  state.buffer = Math.max(0, state.buffer - dt);

  const airborne = isJumpAirborne(state);

  // A request either starts a jump now, or is remembered for the landing.
  if (input.requested) {
    if (input.canJump && (state.phase === 'grounded' || state.phase === 'land')) {
      beginCrouch(state);
      state.offsetY = 0;
      state.vy = 0;
    } else if (airborne) {
      state.buffer = JUMP_BUFFER;
    }
  }

  switch (state.phase) {
    case 'grounded':
      // 從高處落下 — the ground went away from under the character rather than sloping down.
      // Nothing launched this, so the machine takes the POSE and leaves the height alone (see
      // JumpState.ballistic).
      if (input.supportDrop > FREE_FALL_DROP_RATE) {
        enter(state, 'fall');
        state.ballistic = false;
        state.vy = 0;
        state.offsetY = 0;
      }
      break;

    case 'crouch':
      if (state.t >= JUMP_CROUCH_DURATION) {
        enter(state, 'takeoff');
        state.ballistic = true;
        state.vy = JUMP_TAKEOFF_SPEED;
        state.offsetY = 0;
      }
      break;

    case 'takeoff':
      integrate(state, dt);
      if (state.offsetY <= 0) { land(state); break; }
      // The extension is over when the legs are straight or when the body stops climbing,
      // whichever comes first — a jump interrupted by a low ceiling should not stay in a
      // take-off pose on the way down.
      if (state.t >= JUMP_TAKEOFF_DURATION || state.vy <= 0) enter(state, state.vy > 0 ? 'rise' : 'fall');
      break;

    case 'rise':
      integrate(state, dt);
      if (state.offsetY <= 0) { land(state); break; }
      if (state.vy <= 0) enter(state, 'fall');
      break;

    case 'fall':
      if (state.ballistic) {
        integrate(state, dt);
        if (state.offsetY <= 0) land(state);
      } else if (input.supportGap < FREE_FALL_EXIT || state.t > FREE_FALL_MAX) {
        land(state);
      }
      break;

    case 'land':
      if (state.t >= JUMP_LAND_DURATION) enter(state, 'grounded');
      break;
  }

  // The buffered hop, taken as soon as the impact has been ABSORBED rather than after the full
  // recovery. Waiting for JUMP_LAND_DURATION would put a quarter-second stutter between every
  // pair of hops; not waiting at all would skip the absorb, and a bounce with no absorb in it is
  // the character passing through the ground rather than pushing off it. The absorb doubles as
  // the next hop's 準備, which is what a repeated hop actually is.
  if (state.phase === 'land' && state.t >= LAND_IMPACT_DURATION && state.buffer > 0 && input.canJump) {
    state.buffer = 0;
    beginCrouch(state);
  }

  return state;
}

function enter(state: JumpState, phase: JumpPhase) {
  state.phase = phase;
  state.t = 0;
}

/**
 * Starts a 準備, remembering the pose it interrupted so the crouch can blend out of it rather
 * than replacing it. See {@link JumpState.entryPose} for the snap this exists to prevent.
 */
function beginCrouch(state: JumpState) {
  copyPoseInto(state.entryPose, state.lastPose);
  state.entryWeight = state.lastWeight;
  enter(state, 'crouch');
  state.ballistic = false;
}

function integrate(state: JumpState, dt: number) {
  // Semi-implicit Euler: velocity first, then position. Symmetric enough over a half-second
  // arc that take-off and landing speeds match to within a frame, which is what keeps the
  // squash at both ends the same size.
  // The EXACT position update for constant acceleration (x += (v - g·dt/2)·dt), not the
  // cheaper v-then-x form: plain semi-implicit Euler undershoots the apex by ~7% at 60 Hz and
  // by more on a slow frame, so the height the jump actually reached would depend on the frame
  // rate. Velocity is still stepped afterwards, so vy - the thing the animation reads to tell
  // 上升 from 下降 - stays the true end-of-frame velocity.
  state.offsetY += (state.vy - 0.5 * JUMP_GRAVITY * dt) * dt;
  state.vy -= JUMP_GRAVITY * dt;
}

function land(state: JumpState) {
  enter(state, 'land');
  state.ballistic = false;
  state.offsetY = 0;
  state.vy = 0;
}

/** Whether the feet are off the ground — what playerBus.playerIsAirborne means. */
export function isJumpAirborne(state: JumpState): boolean {
  return state.phase === 'takeoff' || state.phase === 'rise' || state.phase === 'fall';
}

/** Whether the machine is doing anything at all this frame. */
export function isJumpActive(state: JumpState): boolean {
  return state.phase !== 'grounded';
}

// ---------------------------------------------------------------------------
// The poses
// ---------------------------------------------------------------------------

/**
 * The five key poses. Amplitudes are deliberately modest — 島嶼生活, not a fighting game
 * (section 七): the largest angle anywhere below is 0.90 rad on the take-off arm swing, which
 * is under twice the walk cycle's own 0.6 rad shoulder swing.
 *
 * `y` is left unstated everywhere on purpose. An omitted axis is one the pose has no opinion
 * about (see applyBodyPose), and the only things that write limb `y` are the swim stroke and
 * the crawl — neither of which the jump has any business straightening out.
 */

/** 準備 — gathering. Arms back, weight down, chest a little forward. */
const CROUCH_POSE: BodyPose = {
  head: { x: 0.06 },
  torso: { x: 0.20 },
  leftArm: { x: 0.40, z: -0.10 },
  rightArm: { x: 0.40, z: 0.10 },
  leftLeg: { x: -0.42 },
  rightLeg: { x: -0.42 },
};

/** 起跳 — everything opens at once: legs straighten and trail, arms swing up, eyes up. */
const TAKEOFF_POSE: BodyPose = {
  head: { x: -0.12 },
  torso: { x: -0.10 },
  leftArm: { x: -0.90, z: -0.15 },
  rightArm: { x: -0.90, z: 0.15 },
  leftLeg: { x: 0.18 },
  rightLeg: { x: 0.18 },
};

/**
 * 上升 — the airborne pose on the way up. Arms out for balance, one knee up and one leg
 * trailing.
 *
 * The asymmetry is the whole point of this pose. Both legs at the same angle reads as a
 * mannequin being lifted; a lead knee and a trailing foot reads as a person who pushed off.
 */
const RISE_POSE: BodyPose = {
  head: { x: -0.06 },
  torso: { x: -0.04 },
  leftArm: { x: -0.70, z: -0.45 },
  rightArm: { x: -0.55, z: 0.40 },
  leftLeg: { x: -0.30 },
  rightLeg: { x: 0.15 },
};

/** 下降 — arms widen to catch the balance, both feet come forward under the body to land on. */
const FALL_POSE: BodyPose = {
  head: { x: 0.05 },
  torso: { x: 0.08 },
  leftArm: { x: -0.30, z: -0.62 },
  rightArm: { x: -0.28, z: 0.58 },
  leftLeg: { x: -0.20 },
  rightLeg: { x: -0.08 },
};

/** 落地 — knees forward under a dropped root, chest over them, hands coming down in front. */
const LAND_POSE: BodyPose = {
  head: { x: 0.10 },
  torso: { x: 0.26 },
  leftArm: { x: -0.35, z: -0.30 },
  rightArm: { x: -0.35, z: 0.30 },
  leftLeg: { x: -0.50 },
  rightLeg: { x: -0.50 },
};

/** Every joint any of the poses above mentions, so a blend can never leave one behind. */
const JUMP_JOINTS: readonly RigJointName[] = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];

/**
 * One scratch pose, rewritten in place and handed straight to the caller, which consumes it
 * within the same frame. The alternative is one object plus six more per frame for the whole
 * length of every jump, which is a lot of garbage for a number that lives four microseconds.
 */
const scratch: BodyPose = {};
for (const joint of JUMP_JOINTS) scratch[joint] = { x: 0, z: 0 };

export interface JumpFrame {
  /** The joints, by name. Blended between the key poses — never one of them verbatim. */
  pose: BodyPose;
  /**
   * How much of it to apply, 0..1, against whatever the walk/idle/emote animation already put
   * on those joints this frame. 0 at both ends of the jump, so the pose can never strand a
   * limb: this is the whole of the Idle→Jump→Fall→Land→Idle transition (section 八), and it
   * is an ENVELOPE over the phase rather than a per-frame lag, so it neither overshoots on a
   * slow frame nor drags on a fast one.
   */
  weight: number;
  /** Where the root goes, world units above the support surface: the arc, plus the dips. */
  rootOffset: number;
  /**
   * Signed squash/stretch, -1..1. Negative is squashed (gathering, landing), positive is
   * stretched (take-off, the climb). The caller scales it by its own amplitudes, so the
   * character's existing 6%/3.5% squash is untouched.
   */
  stretch: number;
}

const frame: JumpFrame = { pose: scratch, weight: 0, rootOffset: 0, stretch: 0 };

/**
 * THE POSE THIS FRAME — the one function the animation loop calls.
 *
 * Continuity is a property of this function, not of the caller: every phase starts at exactly
 * the pose the previous one ended on, so no transition anywhere in a jump can snap a limb.
 * That is why the phases blend BETWEEN key poses here instead of each being applied at full
 * strength with the blending left to a lerp rate outside — a rate cannot guarantee the
 * endpoints match, and 「手腳突然跳到另一個姿勢」 is exactly what happens when they do not.
 */
export function jumpFrame(state: JumpState, legLength: number): JumpFrame {
  const result = computeJumpFrame(state, legLength);
  // Remembered for the next 準備, which has to know what it interrupted - see entryPose.
  copyPoseInto(state.lastPose, result.pose);
  state.lastWeight = result.weight;
  return result;
}

function computeJumpFrame(state: JumpState, legLength: number): JumpFrame {
  switch (state.phase) {
    case 'grounded':
      frame.weight = 0;
      frame.rootOffset = 0;
      frame.stretch = 0;
      return frame;

    case 'crouch': {
      const eased = smoothstep(clamp01(state.t / JUMP_CROUCH_DURATION));
      // Out of whatever the crouch interrupted, into the crouch. For a jump started from a body
      // this file did not own, `entryPose` IS the crouch and `entryWeight` is 0, so this reduces
      // to "hold the crouch and fade it in" — the transition that lets a jump be started
      // mid-stride without the legs cutting to a stance. For a chained hop it is the landing
      // pose easing into the next gather. See JumpState.entryPose.
      blendPose(state.entryPose, CROUCH_POSE, eased);
      frame.weight = lerp(state.entryWeight, 1, eased);
      // The knees are only part of the way into the crouch (the weight is what carries them the
      // rest of the way downstream), so the hips may only come down by as much as THAT much bend
      // allows — see poseDip.
      frame.rootOffset = -poseDip(legLength, frame.weight);
      frame.stretch = lerp(-state.entryWeight, -1, eased);
      return frame;
    }

    case 'takeoff': {
      const p = clamp01(state.t / JUMP_TAKEOFF_DURATION);
      const opening = smoothstep(p);
      blendPose(CROUCH_POSE, TAKEOFF_POSE, opening);
      frame.weight = 1;
      // The arc, plus the last of the crouch coming out from under it. Snapping the dip to zero
      // on the frame the crouch ends would be a few centimetres of instant lift at exactly the
      // moment the body is moving fastest — small, but it is a discontinuity, and the extension
      // is what pushes the body up in the first place, so unwinding it across the push is what
      // is actually happening.
      frame.rootOffset = state.offsetY - crouchDip(legLength, (CROUCH_POSE.leftLeg?.x ?? 0) * (1 - opening));
      frame.stretch = lerp(-1, 1, p);
      return frame;
    }

    case 'rise': {
      const p = clamp01(state.t / RISE_BLEND);
      blendPose(TAKEOFF_POSE, RISE_POSE, smoothstep(p));
      frame.weight = 1;
      frame.rootOffset = state.offsetY;
      // The stretch relaxes as the climb slows — it is the body still carrying the push-off,
      // and by the apex there is nothing left to carry.
      frame.stretch = lerp(1, 0.25, p);
      return frame;
    }

    case 'fall': {
      const p = clamp01(state.t / FALL_BLEND);
      blendPose(state.ballistic ? RISE_POSE : FALL_POSE, FALL_POSE, smoothstep(p));
      // A ballistic fall arrives already in the airborne pose; a free fall off a ledge has to
      // fade in from whatever the character was doing when the ground ran out.
      frame.weight = state.ballistic ? 1 : smoothstep(clamp01(state.t / FREE_FALL_BLEND));
      frame.rootOffset = state.offsetY;
      frame.stretch = lerp(0.25, 0, p) * frame.weight;
      return frame;
    }

    case 'land': {
      const impact = clamp01(state.t / LAND_IMPACT_DURATION);
      blendPose(FALL_POSE, LAND_POSE, smoothstep(impact));
      // Full strength through the impact, then handing the body back over the rest of the
      // phase — 「快速恢復正常姿勢」, and the reason a landing never cuts to idle.
      const recovery = clamp01((state.t - LAND_IMPACT_DURATION) / (JUMP_LAND_DURATION - LAND_IMPACT_DURATION));
      const w = 1 - smoothstep(recovery);
      frame.weight = w;
      // Same geometry as the crouch, driven by the same weight that is bending the knees, so
      // the absorb sinks the hips and straightens back up without the soles ever leaving the
      // ground they just hit.
      frame.rootOffset = -poseDip(legLength, w);
      frame.stretch = -w;
      return frame;
    }
  }
}

function blendPose(a: BodyPose, b: BodyPose, t: number) {
  for (const joint of JUMP_JOINTS) {
    const target = scratch[joint]!;
    const from = a[joint];
    const to = b[joint];
    target.x = lerp(from?.x ?? 0, to?.x ?? 0, t);
    target.z = lerp(from?.z ?? 0, to?.z ?? 0, t);
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Ease in and out. Zero derivative at both ends, which is what keeps phase joins invisible. */
const smoothstep = (t: number) => t * t * (3 - 2 * t);
