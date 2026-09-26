/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WHAT THE BODY DOES — the posture vocabulary, and the missing layer that made every
 * non-seat interaction in the game look identical.
 *
 * ## The bug this file exists to fix
 *
 * `constants/furnitureInteractions.ts` had ONE table, and it conflated two independent
 * things into a single `InteractionKind`:
 *
 *   what the PROMPT says   「泡澡」「烹飪」「觀星」
 *   what the BODY does     the pose
 *
 * Its `pose` column had exactly two values, `'sit'` and `'lie'`, and every other kind left
 * it undefined. Undefined meant "no pose", and "no pose" was routed in Three/Avatar.tsx to
 * a single hard-coded 0.7 s two-arm reach — so 泡澡, 烹飪, 觀星, 洗手, 許願, 閱讀, 添柴火
 * and eleven others were, frame for frame, the same animation with a different caption. A
 * bathtub could not be anything but "stand beside it and wave", because the vocabulary had
 * no word for what a body does in a bathtub.
 *
 * The kind, then, is the VERB. This file is the BODY, and the two are joined by name:
 * a kind names a posture, an item may override it, and adding 泡澡 to the game is adding a
 * row HERE rather than a branch in the animation file.
 *
 *   Furniture  →  Interaction Kind  →  Posture  →  joint targets  →  Player Animation
 *   (items.ts)   (furnitureInteractions)  (here)   (lib/interactionPosture)  (Avatar.tsx)
 *
 * ## Everything is stated as JOINT NAMES, never as refs
 *
 * A posture is a `BodyPose`: a partial map from {@link RigJointName} to an euler triple. It
 * says "the right arm is at -1.05 pitch", not "write -1.05 into rightArmRef". That is the
 * whole of the model-independence promise (constants/characterRig.ts): the controller drives
 * joints BY NAME, so a model with a different skeleton — one that splits the arm into an
 * upper and a lower segment, say — extends {@link RigJointName} and adds rows here, and not
 * one existing posture, and not one line of the pose maths, has to change. Nothing in this
 * file knows the character is currently a chibi made of capsules.
 *
 * Angles that depend on the character's PROPORTIONS are deliberately NOT here: a seat's leg
 * swing is derived at runtime from the rig and the measured furniture
 * (lib/interactionPosture.ts), for the same reason a seat height is not typed into a pose.
 * What is here is body LANGUAGE — the part that is a choice rather than a measurement.
 */

/**
 * The joints a posture may address.
 *
 * Exactly the rig Three/Avatar.tsx owns today (constants/characterRig.ts). This union is the
 * extension point for a richer model: adding `'leftLowerArm'` here and a row to Avatar's
 * joint map is all a two-segment arm costs, and every posture that does not mention it
 * simply leaves it alone.
 */
export type RigJointName = 'head' | 'torso' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';

/**
 * One joint's target, radians, in the joint's own space. Any axis may be omitted — an
 * omitted axis is one the posture has no opinion about and leaves to whatever else is
 * animating it.
 *
 * SIGN CONVENTION, the same one the walk cycle and the swim pose already use:
 *   x  negative swings a hanging limb FORWARD and tips the head UP; positive is back / down.
 *   y  turn about the body's up axis.
 *   z  roll. On the arms it is the elbow going OUT from the ribs: negative on the left,
 *      positive on the right (they mirror, so a single signed number would swing both the
 *      same way across the body instead of opening them out).
 */
export interface JointPose {
  x?: number;
  y?: number;
  z?: number;
}

/** A whole-body posture: every joint it has an opinion about. */
export type BodyPose = Partial<Record<RigJointName, JointPose>>;

/**
 * A repeating motion laid over a posture's held pose — the stir, the scrub, the page turn.
 *
 * This is what stops a posture being a statue. It is a sine rather than a keyframe list on
 * purpose: two of these on the same joint, a quarter cycle apart on different axes, is a
 * circle (see `cook`), which covers nearly every repetitive hand action furniture asks for
 * and costs one multiply per joint per frame.
 */
export interface PostureMotion {
  joint: RigJointName;
  axis: 'x' | 'y' | 'z';
  /** Radians, peak deviation from the held pose. Signed, so two joints can counter-phase. */
  amplitude: number;
  /** Full oscillations across the posture's own duration. */
  cycles: number;
  /** Phase offset in cycles, 0..1. Pair 0 and 0.25 on two axes to trace a circle. */
  phase?: number;
}

/**
 * How the body settles into and out of a posture over its lifetime.
 *
 *   `pulse`  out and back on a half sine — a single gesture, at full extension halfway
 *            through. The reach a fridge used to get, and still gets.
 *   `hold`   in, hold, out — the body arrives at the pose, DOES the thing for most of the
 *            duration, then relaxes. What separates 烹飪 from a wave at a hob.
 */
export type PostureEnvelope = 'pulse' | 'hold';

/**
 * How a posture's root height comes off the anchor it is given. Pairing a rule here with the
 * rig is what lets one catalog number (where the cushion is) serve every character model —
 * see `poseRootHeight` in constants/furnitureInteractions.ts.
 *
 *   `hips`   the body's HIP JOINT rests on the anchor surface. Sitting, and bathing.
 *   `side`   the body is turned onto its side about its feet, so it rests on its own
 *            half-thickness above the surface. Lying.
 *   `stand`  no anchor surface at all: the body stays on the floor it is standing on, and
 *            the posture is played at the piece rather than on it.
 */
export type PostureAnchoring = 'hips' | 'side' | 'stand';

/**
 * What the legs do once the body is on the piece. The three cases are genuinely different
 * GEOMETRY problems, not three sets of numbers:
 *
 *   `reachFloor`     swing down until they reach the floor, or until they clear the piece's
 *                    own front edge — whichever is the wider swing. A dining chair plants
 *                    its feet; a deep sofa lets them hang. Both derived at runtime.
 *   `extendForward`  straight out along the piece, level with the hips. What legs do in a
 *                    bathtub, where there is no floor to reach and the far end is metres away.
 *   `climbOver`      swung up and over an edge while getting on, relaxed once settled. The
 *                    hammock's, and every bed's.
 *   `dangle`         hanging free, straight down from the hip, and left there for the piece's
 *                    own motion to swing. The one case where the legs must NOT be solved: a
 *                    swing seat is 0.70 above the ground against a 0.54 leg, so `reachFloor`
 *                    would peg at "straight down" anyway — but the swing's measured box reaches
 *                    0.90 ahead of the seat (its A-frame straddles the rider), and the "clear
 *                    the piece's front edge" constraint would read that as a metre-deep cushion
 *                    and kick both legs out horizontal. Saying "they hang" is not a shortcut
 *                    past the solver; it is the correct answer that the solver's two
 *                    constraints cannot express.
 */
export type PostureLegs = 'reachFloor' | 'extendForward' | 'climbOver' | 'dangle';

/**
 * How a body answers a piece that is MOVING under it — the second half of the swing rework.
 *
 * A rider is not bolted to the seat. The root goes over with the arc (`follow`), but the legs
 * hang back a beat behind it and the torso leans against it, and those two lags are most of what
 * separates "a person on a swing" from "a mannequin glued to a plank". Both are driven by the
 * piece's own angle, which the controller already has — see lib/outdoorMotion.ts's
 * `suspendedAngle`, the single number this whole mechanism is built on.
 */
export interface PostureRideResponse {
  /** How far the legs trail the arc, radians per radian of tilt. Negative swings them forward. */
  legTrail?: number;
  /** Torso counter-lean per radian of tilt. */
  leanBack?: number;
  /** Arms bracing on the ropes: how far they follow, per radian of tilt. */
  armBrace?: number;
}

export interface PostureSpec {
  /**
   * Whether the player STAYS in it. An occupying posture holds the body until they get up
   * (the prompt turns into 「起身」); a non-occupying one plays for {@link duration} and
   * hands the body back. This is the only structural difference between the two families —
   * everything below is shared, which is what keeps 泡澡 and 洗手 the same kind of thing.
   */
  occupies: boolean;
  anchoring: PostureAnchoring;
  /** Occupying postures only. */
  legs?: PostureLegs;
  /** Occupying postures on a piece that moves. See {@link PostureRideResponse}. */
  ride?: PostureRideResponse;
  /** The characteristic pose, at full extension. */
  hold: BodyPose;
  /** Laid over {@link hold} while the posture is at strength. */
  motion?: readonly PostureMotion[];
  /**
   * The whole body's pitch, radians — positive leans FORWARD. Applied to the character ROOT,
   * so unlike a `torso` entry it carries the arms and legs with it (the torso joint is a
   * sibling of the limbs, not their parent — see Avatar.tsx's CELEBRATE note). This is the
   * axis that makes someone read as leaning over a hob rather than standing at one.
   */
  lean?: number;
  /** Non-occupying postures: seconds. Occupying ones run until the player gets up. */
  duration?: number;
  envelope?: PostureEnvelope;
  /**
   * The sustained idle once an occupying posture has settled — the 「Bathing Idle」 half of
   * the request. Amplitudes are small on purpose: this plays for as long as the player sits
   * there, and anything with a silhouette to it becomes a tic within thirty seconds.
   */
  idle?: {
    /** Root rise and fall, world units. A body in water bobs; a body on a chair does not. */
    bob?: number;
    /** Root pitch rock, radians. */
    rock?: number;
    /** Cycles per second for the bob, the rock and every {@link PostureMotion} in `drift`. */
    rate?: number;
    /** Joints that drift with the bob — hands riding the surface of the water. */
    drift?: readonly PostureMotion[];
  };
  /**
   * Which way the body steps off, as a yaw offset from the direction it is facing. 0 (the
   * default) stands straight up out of a chair and walks forward off a bed. A bath is the
   * case that needs it: you get out of a bathtub over its SIDE, not by wading the two and a
   * half metres out over the taps.
   *
   * WHICH side matters, and the sign is not free. Every piece in this catalog has its front at
   * local +Z (see FurnitureInteraction.facing) and is placed with its back to a wall, so the
   * offset has to come out at +Z once the occupant's own `facing` is added to it. A tub's
   * occupant lies along the piece's local +X (`facing: PI/2`), so stepping out at +Z is
   * `-PI/2` — the OTHER sign lands the body behind the tub, i.e. in the wall it is pushed
   * against, which is exactly where 泡澡 used to put you on standing up.
   */
  exitFacing?: number;
}

/**
 * THE POSTURES. Fourteen rows, and adding a fifteenth is adding a row — nothing downstream
 * branches on the id.
 *
 * The three occupying ones are the body ON the furniture. The eleven acting ones are the body
 * AT it, and the reason there are eleven rather than the one there used to be is that
 * 「按 E → 角色動一下雙手」 is not an interaction: a player should be able to tell what
 * someone is doing from the silhouette alone, with the caption covered.
 */
export const POSTURES = {
  // -------------------------------------------------------------------------
  // OCCUPYING — the body goes onto or into the piece and stays there.
  // -------------------------------------------------------------------------

  /**
   * 坐下. Upright on a cushion, hands resting on the thighs. The leg swing is NOT here — it
   * is the one angle that has to be solved per piece, and it is solved from measurements
   * (see `reachFloor`).
   *
   * `lean` is the chibi tax: the skull is 1.17 world units across and a chair seat is 0.6
   * deep, so a body sat bolt upright puts the back of its head through the backrest. A
   * slight forward lean carries it clear — and is also what someone sitting on a chair
   * actually does. (This was `SIT_LEAN`; the value is unchanged.)
   */
  sit: {
    occupies: true,
    anchoring: 'hips',
    legs: 'reachFloor',
    lean: 0.12,
    hold: {
      leftArm: { x: -0.30, z: -0.16 },
      rightArm: { x: -0.30, z: 0.16 },
      leftLeg: { z: -0.06 },
      rightLeg: { z: 0.06 },
    },
    idle: {
      bob: 0.006,
      rate: 0.28,
      drift: [
        { joint: 'leftArm', axis: 'x', amplitude: 0.03, cycles: 1 },
        { joint: 'rightArm', axis: 'x', amplitude: 0.03, cycles: 1, phase: 0.5 },
      ],
    },
  },

  /**
   * 盪鞦韆. THE ONE THE SWING REWORK IS ABOUT.
   *
   * Read against `sit`, which is the posture it is nearest to, because the differences are the
   * whole point — a person on a swing is not a person on a chair that happens to be moving:
   *
   *   the HANDS      grip the ropes, so the arms go UP and slightly out rather than resting on
   *                  the thighs. This is the single most legible thing in the silhouette; with
   *                  the arms down, the pose reads as sitting on a plank.
   *   the LEGS       hang (`dangle`) instead of being solved to the floor. The seat is above
   *                  standing leg length, and the piece's own box is not a cushion — see
   *                  `dangle` for why the solver gets the wrong answer here.
   *   the LEAN       is backward, not forward. You lean back on a swing; you lean forward in a
   *                  chair to keep an oversized head off the backrest, and a swing has none.
   *   `ride`         exists at all. It is what makes the body answer the arc rather than being
   *                  carried by it.
   *
   * The idle is deliberately almost nothing: the piece itself supplies all the movement anybody
   * will look at, and a bob laid on top of a two-and-a-half-second arc just reads as a wobble.
   */
  swing: {
    occupies: true,
    anchoring: 'hips',
    legs: 'dangle',
    lean: -0.06,
    hold: {
      // Hands up on the ropes. `z` opens the elbows out to where the ropes actually are
      // (±0.45 local, about a shoulder and a half apart), mirrored left/right per the sign
      // convention at the top of this file.
      leftArm: { x: -1.02, z: -0.30 },
      rightArm: { x: -1.02, z: 0.30 },
      leftLeg: { z: -0.05 },
      rightLeg: { z: 0.05 },
    },
    ride: {
      // The legs trail the seat: at the back of the arc they are still swinging forward. A real
      // rider's legs lead the arc at the front and trail it at the back, which one signed
      // multiple of the tilt captures well enough at this scale.
      legTrail: -0.55,
      leanBack: 0.22,
      armBrace: 0.14,
    },
    idle: { bob: 0.003, rate: 0.2 },
  },

  /**
   * 躺下 / 休息. Turned onto the side about the feet; the recline angle itself is derived
   * from the rig (`liePitch`), because how far a body has to be tipped off flat to keep an
   * oversized head out of the mattress is a fact about the head, not a taste call.
   *
   * `hold` is empty on purpose. A settled lying body's arms rest against its sides, which is
   * what the rig's neutral already is — the visible work here is all in `climbOver`.
   */
  lie: {
    occupies: true,
    anchoring: 'side',
    legs: 'climbOver',
    hold: {},
    idle: { bob: 0.008, rate: 0.22 },
  },

  /**
   * 泡澡. THE ONE THE REQUEST WAS ABOUT.
   *
   * Down inside the tub with the hips on its floor, reclined back against the end, legs
   * straight out along the length of it (a bath is long in X and shallow in Z — the body
   * lies ALONG it, which is why a bathtub's anchor carries a quarter-turn `facing`), and the
   * arms out wide over the rim.
   *
   * Read against `sit`, which is the posture this is nearest to: the recline is BACKWARD
   * instead of forward, the legs go OUT instead of down, the arms go WIDE instead of onto
   * the thighs, and the whole body bobs. Nothing about it is a sitting body with different
   * hands — which is the point.
   */
  bathe: {
    occupies: true,
    anchoring: 'hips',
    legs: 'extendForward',
    /**
     * Backward — you lean INTO the end of a bath — but only just, and the number is a geometry
     * budget rather than a taste call.
     *
     * The recline pivots about the ROOT, which for a body sitting on a tub floor is 0.33 below
     * that floor, so every radian of it swings the head backward by the head joint's whole
     * height (1.57 world units). At the -0.22 this started at, the back of a chibi skull — 1.17
     * across — came out 0.28 THROUGH the end wall of a 2.53-unit tub. Reclining is the most
     * expensive thing this body can do in a confined space; -0.10 is what the tub affords, and
     * `npm run audit:interactions` fails if a later edit spends more than that.
     */
    lean: -0.10,
    hold: {
      // Floating forward in the water, not resting on the rim: a body sitting on the floor of
      // this tub has its shoulders 0.36 BELOW the rim, so "elbows on the edge" is a pose the
      // proportions cannot reach. Out far enough to read as arms in water, inside the walls.
      leftArm: { x: -0.48, z: -0.34 },
      rightArm: { x: -0.48, z: 0.34 },
      // Chin up, clear of the water.
      head: { x: -0.20 },
      // Apart along the tub floor; the pitch itself comes from `extendForward`.
      leftLeg: { z: -0.10 },
      rightLeg: { z: 0.10 },
    },
    idle: {
      bob: 0.028,
      rock: 0.018,
      rate: 0.36,
      drift: [
        // Hands riding the water, a half cycle apart so they are never symmetrical.
        { joint: 'leftArm', axis: 'z', amplitude: -0.05, cycles: 1 },
        { joint: 'rightArm', axis: 'z', amplitude: 0.05, cycles: 1, phase: 0.5 },
        { joint: 'head', axis: 'y', amplitude: 0.07, cycles: 0.5 },
      ],
    },
    // Over the side, and out the FRONT of the tub. See exitFacing for why the sign is this one.
    exitFacing: -Math.PI / 2,
  },

  // -------------------------------------------------------------------------
  // ACTING — the body walks to the piece, does something, and is handed back.
  // -------------------------------------------------------------------------

  /**
   * 使用. The generic one, and the ONLY posture that survives from the old system — where it
   * was not a row in a table but the single hard-coded branch every non-seat interaction in
   * the game was routed through.
   *
   * It stays because a genuinely unclassified "reach for the thing" is a reasonable default
   * for a piece nobody has thought about yet. It is now what an item gets when it asks for
   * nothing in particular, rather than what every item got no matter what it asked for.
   */
  reach: {
    occupies: false,
    anchoring: 'stand',
    duration: 0.7,
    envelope: 'pulse',
    lean: 0.05,
    hold: {
      leftArm: { x: -1.35, z: -0.12 },
      rightArm: { x: -1.35, z: 0.12 },
    },
  },

  /** 開門. One hand to the handle, pull, and the shoulders turn away with it. */
  open: {
    occupies: false,
    anchoring: 'stand',
    duration: 1.2,
    envelope: 'hold',
    lean: 0.10,
    hold: {
      rightArm: { x: -1.50, z: 0.20 },
      leftArm: { x: -0.28, z: -0.10 },
      torso: { y: -0.22 },
      head: { x: 0.08 },
    },
    motion: [
      // Grip, then draw back — one slow pull across the whole action.
      { joint: 'rightArm', axis: 'x', amplitude: 0.38, cycles: 1 },
      { joint: 'torso', axis: 'y', amplitude: -0.10, cycles: 1 },
    ],
  },

  /** 操作. A panel, a dial, a flush lever: one hand, small and precise, eyes down on it. */
  operate: {
    occupies: false,
    anchoring: 'stand',
    duration: 1.1,
    envelope: 'hold',
    lean: 0.14,
    hold: {
      rightArm: { x: -1.15, z: 0.06 },
      leftArm: { x: -0.12, z: -0.08 },
      head: { x: 0.24 },
    },
    // Three distinct presses rather than one sweep — the read is "operating a control".
    motion: [{ joint: 'rightArm', axis: 'x', amplitude: 0.13, cycles: 3 }],
  },

  /**
   * 烹飪. Leaning over the hob, one hand steadying the pan while the other stirs.
   *
   * The stir is the two-axis trick this file's motion spec exists for: the same joint driven
   * on x and on z a quarter cycle apart traces a circle, which is the difference between
   * stirring a pot and waving at one.
   */
  cook: {
    occupies: false,
    anchoring: 'stand',
    duration: 2.4,
    envelope: 'hold',
    lean: 0.20,
    hold: {
      rightArm: { x: -1.05, z: 0.24 },
      leftArm: { x: -0.85, z: -0.32 },
      head: { x: 0.30 },
    },
    motion: [
      { joint: 'rightArm', axis: 'x', amplitude: 0.17, cycles: 3 },
      { joint: 'rightArm', axis: 'z', amplitude: 0.24, cycles: 3, phase: 0.25 },
    ],
  },

  /** 清洗. Both hands low and together under a tap, rubbing against each other. */
  wash: {
    occupies: false,
    anchoring: 'stand',
    duration: 1.9,
    envelope: 'hold',
    lean: 0.22,
    hold: {
      leftArm: { x: -1.00, z: -0.06 },
      rightArm: { x: -1.00, z: 0.06 },
      head: { x: 0.34 },
    },
    motion: [
      // Counter-phased, so the hands pass each other instead of moving as one block.
      { joint: 'leftArm', axis: 'z', amplitude: -0.15, cycles: 4 },
      { joint: 'rightArm', axis: 'z', amplitude: 0.15, cycles: 4, phase: 0.5 },
    ],
  },

  /**
   * 觀看. Both hands up to an eyepiece and the chin UP — the only posture in the table that
   * looks above the horizon, which is most of why a telescope stopped reading like a fridge.
   */
  observe: {
    occupies: false,
    anchoring: 'stand',
    duration: 2.6,
    envelope: 'hold',
    // Slightly BACK: you tip away from a thing you are looking up through.
    lean: -0.07,
    hold: {
      leftArm: { x: -1.78, z: -0.36 },
      rightArm: { x: -1.78, z: 0.36 },
      head: { x: -0.46 },
      torso: { x: -0.05 },
    },
    // Scanning across the sky.
    motion: [{ joint: 'head', axis: 'y', amplitude: 0.14, cycles: 1 }],
  },

  /** 閱讀. Held open at chest height, head down over it, a page turned partway through. */
  read: {
    occupies: false,
    anchoring: 'stand',
    duration: 2.5,
    envelope: 'hold',
    lean: 0.09,
    hold: {
      leftArm: { x: -1.26, z: -0.24 },
      rightArm: { x: -1.26, z: 0.24 },
      head: { x: 0.32 },
    },
    motion: [{ joint: 'rightArm', axis: 'x', amplitude: 0.19, cycles: 2 }],
  },

  /** 許願. Hands clasped at the chest, head bowed, and the whole body bows with it. */
  wish: {
    occupies: false,
    anchoring: 'stand',
    duration: 2.1,
    envelope: 'hold',
    lean: 0.17,
    hold: {
      leftArm: { x: -1.52, z: -0.09 },
      rightArm: { x: -1.52, z: 0.09 },
      head: { x: 0.40 },
    },
    // Almost still. A wish that fidgets is not a wish.
    motion: [{ joint: 'head', axis: 'x', amplitude: 0.05, cycles: 1 }],
  },

  /**
   * 照料. Down at a fire — the only posture that changes the body's HEIGHT, and the one that
   * showed why a crouch cannot be a number in this table.
   *
   * This rig has no knee, so the only way it gets lower is to open its legs, and how much lower
   * that is is trigonometry (`crouchDrop` in lib/interactionPosture.ts). These angles are the
   * crouch: a long front leg and a trailing back one drop the root about 0.20, which with the
   * lean reads as someone down on one side feeding a fire. Written the other way round — a typed
   * 0.24 drop against gentler legs — the character stood 0.21 INSIDE the ground.
   */
  tend: {
    occupies: false,
    anchoring: 'stand',
    duration: 2.2,
    envelope: 'hold',
    lean: 0.26,
    hold: {
      rightArm: { x: -1.32, z: 0.18 },
      leftArm: { x: -0.58, z: -0.20 },
      head: { x: 0.36 },
      // One leg well forward, one trailing — a lunge, which is as near a kneel as a body with
      // no knee gets. Both feet stay on the floor; see the note above.
      leftLeg: { x: -1.20, z: -0.14 },
      rightLeg: { x: 1.05, z: 0.14 },
    },
    motion: [{ joint: 'rightArm', axis: 'x', amplitude: 0.24, cycles: 2 }],
  },

  /** 整理儀容. One hand up to the hair, head tilted into the mirror, shoulders turned. */
  groom: {
    occupies: false,
    anchoring: 'stand',
    duration: 2.1,
    envelope: 'hold',
    lean: 0.06,
    hold: {
      rightArm: { x: -2.05, z: 0.48 },
      leftArm: { x: -0.36, z: -0.14 },
      head: { x: -0.08, y: 0.20 },
      torso: { y: 0.13 },
    },
    motion: [{ joint: 'rightArm', axis: 'z', amplitude: 0.13, cycles: 3 }],
  },

  /**
   * 推動. Both hands out, leaning in, pushing away and drawing back.
   *
   * This is a swing, and it is deliberately NOT a sit: the seat of a swing is a MOVING anchor
   * and this system's interaction points are static in the piece's own frame, so "sit on it"
   * is a promise the runtime cannot keep yet. Pushing one is a real thing a person does with
   * a swing, and it is honest about what the model does — the seat is already animated to
   * swing harder when triggered.
   */
  push: {
    occupies: false,
    anchoring: 'stand',
    duration: 2.0,
    envelope: 'hold',
    lean: 0.22,
    hold: {
      leftArm: { x: -1.45, z: -0.15 },
      rightArm: { x: -1.45, z: 0.15 },
      head: { x: 0.10 },
    },
    motion: [
      { joint: 'leftArm', axis: 'x', amplitude: 0.44, cycles: 2 },
      { joint: 'rightArm', axis: 'x', amplitude: 0.44, cycles: 2 },
    ],
  },

  // -------------------------------------------------------------------------
  // OCCUPYING, added for the outdoor furniture wave — same two families above,
  // no new anchoring or leg mode: both reuse vocabulary `bathe`/`swing` already needed.
  // -------------------------------------------------------------------------

  /**
   * 半躺（躺椅）. `bathe`'s legs and anchoring, `sit`'s reach — this is what tells it apart from
   * both: unlike `lie` (turned onto the side, face down into the furniture) a lounger keeps the
   * body facing forward and the eyes on the horizon, which is the whole point of a deck chair
   * over a bed. Arms rest slightly out on the chair's own arms rather than folded on the chest.
   */
  recline: {
    occupies: true,
    anchoring: 'hips',
    legs: 'extendForward',
    lean: -0.16,
    hold: {
      leftArm: { x: -0.10, z: -0.24 },
      rightArm: { x: -0.10, z: 0.24 },
      head: { x: -0.10 },
      leftLeg: { z: -0.08 },
      rightLeg: { z: 0.08 },
    },
    idle: {
      bob: 0.006,
      rate: 0.20,
      drift: [{ joint: 'head', axis: 'y', amplitude: 0.05, cycles: 0.4 }],
    },
  },

  /**
   * 坐進吊椅. Nearest to `swing`, and the differences say "a chair that happens to hang" rather
   * than "a swing": hands rest low on the seat's own rim instead of gripping a rope overhead, and
   * `ride` is a fraction of the swing's — a hanging chair answers the wind, not a rider pumping it.
   */
  hangSeat: {
    occupies: true,
    anchoring: 'hips',
    legs: 'dangle',
    lean: 0.02,
    hold: {
      leftArm: { x: -0.22, z: -0.18 },
      rightArm: { x: -0.22, z: 0.18 },
      leftLeg: { z: -0.06 },
      rightLeg: { z: 0.06 },
    },
    ride: {
      legTrail: -0.18,
      leanBack: 0.08,
      armBrace: 0.04,
    },
    idle: { bob: 0.004, rate: 0.22 },
  },

  /**
   * 拋擲（飛盤／沙灘球）. A one-arm throw, not the generic two-hand `reach`: the working arm
   * sweeps out to full extension while the torso twists into it, so the silhouette reads as
   * "just let go of something" rather than "reaching for something".
   */
  toss: {
    occupies: false,
    anchoring: 'stand',
    duration: 0.9,
    envelope: 'pulse',
    lean: 0.08,
    hold: {
      rightArm: { x: -1.62, z: 0.42 },
      leftArm: { x: -0.30, z: -0.16 },
      torso: { y: -0.20 },
      head: { x: 0.05 },
    },
    motion: [{ joint: 'torso', axis: 'y', amplitude: 0.10, cycles: 1 }],
  },

  // -------------------------------------------------------------------------
  // SOCIAL — not played at a piece of furniture but at another character. Same family as the
  // acting postures (stand, play once, hand the body back), which is why they are rows here and
  // not a second animation path: a player talking to the gardener is the same controller, the
  // same envelope and the same cancel rules as a player opening a fridge.
  // -------------------------------------------------------------------------

  /**
   * 打招呼. The first thing the player does when they start talking to a resident: one hand up and
   * out to the side, waving. Out WIDE rather than straight up — this character's skull is wider than
   * its shoulders, and an arm raised forward past the chin puts the hand through the face.
   */
  greet: {
    occupies: false,
    anchoring: 'stand',
    duration: 1.3,
    envelope: 'hold',
    hold: {
      rightArm: { x: -1.85, z: 0.78 },
      leftArm: { x: -0.12, z: -0.08 },
      head: { x: -0.04 },
    },
    motion: [{ joint: 'rightArm', axis: 'z', amplitude: 0.22, cycles: 3 }],
  },

  /**
   * 聊天. What the player does on every line after the first: a small open-handed gesture and a nod,
   * so pressing the key to hear the next line still reads as the player taking part in the
   * conversation rather than as the resident talking at a statue.
   */
  chat: {
    occupies: false,
    anchoring: 'stand',
    duration: 1.1,
    envelope: 'hold',
    lean: 0.03,
    hold: {
      rightArm: { x: -0.95, z: 0.32 },
      leftArm: { x: -0.3, z: -0.12 },
      head: { x: 0.05 },
    },
    motion: [{ joint: 'head', axis: 'x', amplitude: 0.07, cycles: 2 }],
  },
} as const satisfies Record<string, PostureSpec>;

export type PostureId = keyof typeof POSTURES;

/**
 * The table seen as plain specs.
 *
 * `as const satisfies` above buys two things worth this line: every row is checked against
 * {@link PostureSpec} as it is written, and {@link PostureId} is the exact set of names rather
 * than `string` — so a typo in a catalog row is a compile error rather than a character standing
 * still. The cost is that each row's type is its own literal shape, and a row with no `duration`
 * has no `duration` property to read. This view puts them all back on the same type.
 */
const SPECS = POSTURES as Record<PostureId, PostureSpec>;

export function getPosture(id: PostureId): PostureSpec {
  return SPECS[id];
}

/** Every posture in the table, for audits and for anything that enumerates the vocabulary. */
export const ALL_POSTURE_IDS = Object.keys(POSTURES) as PostureId[];

/**
 * The LONGEST any acting posture runs, seconds. Not read by the runtime — the controller asks
 * each posture for its own duration — but it is what `npm run audit:interactions` bounds the
 * table against, so a posture accidentally given a duration in milliseconds shows up as a
 * failure rather than as a character stuck stirring a pot for half an hour.
 */
export const MAX_ACTION_DURATION = Math.max(
  ...Object.values(SPECS).map((p) => (p.occupies ? 0 : p.duration ?? 0)),
);
