/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE CHARACTER RIG — the one place the player character's dimensions are stated.
 *
 * Everything here is a CONTRACT between two things that must never learn each other's
 * internals:
 *
 *   the CONTROLLER (Three/Avatar.tsx)  — movement, collision, animation, camera, VFX
 *   the MODEL      (Three/character/*) — the meshes that make the character visible
 *
 * The controller drives joints by name and never touches geometry. A model supplies
 * geometry and never owns a transform the controller needs. This file is what lets the
 * two agree without either importing the other, and it is the file to edit when a new
 * model changes the character's proportions — not Avatar.tsx, not CameraController.tsx.
 *
 * ---------------------------------------------------------------------------
 * COORDINATE RULES (read this before authoring a model)
 * ---------------------------------------------------------------------------
 *
 * There are exactly three spaces, and confusing them is the classic model-import bug:
 *
 *   WORLD    metres as the rest of the island uses them. The terrain, the houses and
 *            the camera live here.
 *   LOCAL    the character root's space. WORLD = LOCAL * CHARACTER_ROOT_SCALE, and the
 *            root's origin sits on the GROUND CONTACT POINT — not the hips, not the
 *            centre of mass. Every number in this file is LOCAL.
 *   PART     a body part's own space, with its origin at that part's JOINT (the point it
 *            rotates about) and +Z out of the character's face. A head mesh is authored
 *            about the neck-to-skull pivot, an arm about the shoulder, a leg about the hip.
 *
 * Axes are three.js standard: +X is the character's LEFT as drawn (the left arm sits at
 * -X, see LEGACY below), +Y up, +Z forward out of the face.
 *
 * ---------------------------------------------------------------------------
 * THE TWO INVARIANTS
 * ---------------------------------------------------------------------------
 *
 * A model may re-proportion anything it likes as long as it keeps these, because the
 * world was built around them and nothing in the world reads the mesh to find out:
 *
 *   1. SOLE ON `soleY`. The root origin is the ground contact point, so a model whose
 *      feet stop short floats and one that overshoots sinks. Terrain height sampling,
 *      the footstep VFX and the standing pose all assume the contact point, and none of
 *      them raycast the mesh to check.
 *   2. CROWN ON `crownY`. Door headroom, furniture scale, camera distance and the
 *      third-person framing were all tuned against this one number. A model that changes
 *      the character's total height is not a remodel, it is a world-retuning job.
 *
 * Everything BETWEEN the sole and the crown — head size, limb thickness, where the waist
 * is — is the model's to choose. That is the whole point: proportion is free, envelope is not.
 *
 * `assertRigInvariants()` at the bottom checks both, and every skeleton here is run
 * through it at module load, so a mistyped joint fails loudly in dev rather than shipping
 * as a character standing 3 cm inside the beach.
 */

/**
 * LOCAL → WORLD. The character root is drawn at this scale, so a model authored at
 * 1 LOCAL unit tall renders 2.25 world units tall.
 *
 * Historically spelled `1.5 * 1.5` inline in Avatar.tsx (two separate 1.5x passes that
 * were never folded together). Stated once here because the camera needs it too — see
 * CameraController's first-person focus, which used to restate `0.68 * 2.25` by hand.
 */
export const CHARACTER_ROOT_SCALE = 2.25;

/** LOCAL units → WORLD units. */
export const toWorld = (local: number) => local * CHARACTER_ROOT_SCALE;

/**
 * A JOINT the controller animates. `y` (and `x`, where a joint is mirrored) is the joint's
 * origin in LOCAL space — the point the part rotates about, which is exactly where a future
 * imported mesh's own pivot must land.
 */
export interface RigJoint {
  /** Height of the joint's origin above the ground contact point. */
  y: number;
  /**
   * Lateral offset for mirrored joints. The LEFT part sits at -x and the RIGHT at +x, so
   * a model states the magnitude once and cannot put the two arms at different widths.
   */
  x?: number;
}

/**
 * The skeleton: where every joint sits, in LOCAL units.
 *
 * WHICH OF THESE THE CONTROLLER ENFORCES, and which are the model's own business, is not
 * uniform — it follows what the animation actually writes, which was measured rather than
 * assumed (94 limb writes in Avatar.tsx's useFrame, all of them `rotation`):
 *
 *   head, torso   The controller RE-ASSERTS `position.y` every frame (idle bob, celebrate
 *                 pump, swim float all animate around it), so these must come from here.
 *                 A model that sets its own head height gets it overwritten on frame 1.
 *   shoulder, hip The controller writes ROTATION ONLY. The model places these joints
 *                 itself; they are declared here so wearables, the camera and any future
 *                 hand-held item can find them without measuring a mesh.
 *
 * `crownRise` and `soleY` are the two envelope numbers from the header note.
 */
export interface CharacterSkeleton {
  /** Neck pivot: where the head rotates, NOT the centre of the skull. */
  head: RigJoint & {
    /**
     * Crown height ABOVE the head joint. A sphere head states its radius here; a cube
     * head its half-height. Only the sum has to match — see `crownY`.
     */
    crownRise: number;
    /**
     * Skull half-width at the widest point, LOCAL. Not used by the controller: this is
     * what the hair and hat systems fit themselves to, so a model with a narrower head
     * declares it here rather than leaving those systems fitted to the old skull.
     */
    halfWidth: number;
  };
  /** Torso centre. Doubles as the somersault's centre-of-mass pivot — see FLIP_PIVOT. */
  torso: RigJoint & {
    /**
     * Body half-thickness at the widest point, LOCAL. The sibling of the head's `halfWidth`,
     * and declared for the same reason: it is a measurement of the MODEL that something
     * outside the model has to know, and measuring the mesh to find it out is exactly what
     * this file exists to avoid.
     *
     * The lying pose used to read this as the body's depth; it now reads the declared body
     * volumes (`volumes.torso.depth`, see {@link BodyVolumes}), which are measured as worn and
     * front-to-back rather than across the shoulders.
     */
    halfWidth: number;
  };
  /** Shoulder pivots. `x` is the magnitude; left is -x, right is +x. */
  shoulder: Required<RigJoint>;
  /** Hip pivots. `x` is the magnitude; left is -x, right is +x. */
  hip: Required<RigJoint>;
  /**
   * The ground contact point, in the ROOT's space. Not zero: the legacy leg capsule's
   * bottom cap lands 5 mm below the root origin, and that 5 mm of overlap is what stops
   * a hairline gap showing between sole and terrain on a slope.
   */
  soleY: number;
  /** The space the body OCCUPIES, part by part. See {@link BodyVolumes}. */
  volumes: BodyVolumes;
}

/**
 * THE BODY'S SOLID — what the character occupies, as the simplest volumes that enclose each part,
 * each in its own JOINT's space (see COORDINATE RULES). Used for FITTING, never drawn.
 *
 * ## Why the skeleton has to say this
 *
 * The joints above say where the body BENDS. Nothing said how THICK it is, and every piece of
 * furniture the player gets onto needs exactly that:
 *
 *   a seat      the leg is a 0.14-world-thick capsule hanging off the hip. Putting the hip JOINT on
 *               the cushion — which is what the seat maths used to do — buries half the thigh in
 *               the cushion and runs the leg down through the seat's front edge. On 木製鞦韆, whose
 *               seat is a 10 cm plank, the leg came straight out of its underside.
 *   a bed       the skull is twice as deep as the back. A body laid "flat" on its back puts the
 *               head 20 cm into the mattress.
 *   an audit    `npm run audit:interactions` poses these volumes on every piece in the catalog and
 *               measures how far any of them ends up inside the piece's meshes.
 *
 * Measured off the model AS WORN, not chosen: the outermost surface of the default outfit on each
 * part — the trousers' waistband on the thigh, the shirt's hem on the torso — because that is what
 * a seat actually touches, and a volume drawn to the bare body let the clothes through (the first
 * version did: a swing's plank came 4 cm into the shirt). The authored model's numbers are checked
 * against its .glb parts by `npm run audit:character`. A new model states its own here and every
 * seat, bed, bath and swing in the game fits it — nothing in the furniture catalog changes.
 *
 * What they do NOT enclose is a garment that flares away from the body — the wide-leg trousers'
 * hem, the grass skirt. Those are drawn loose on purpose and are not what the body rests on.
 *
 * All four hang along their joint's own −Y at rest, which is how every limb in the rig is built.
 */
export interface BodyVolumes {
  /** The skull, as a sphere. `y` is its centre relative to the neck joint (not always zero). */
  head: { y: number; radius: number };
  /**
   * The torso, as a capsule along its own Y through the torso joint. `radius` is its half-WIDTH
   * (across the shoulders); `depth` its half-THICKNESS front to back, which is also the radius
   * its two ends are rounded with — the profile a seat back or a mattress actually meets.
   */
  torso: { halfLength: number; radius: number; depth: number };
  /**
   * One leg, as a TAPERED capsule on the hip joint's axis: from `top` (leg-local y; positive is
   * ABOVE the hip, up inside the torso) down to `bottom` (the end nearest the sole). `radius` is
   * its thickness at the top — the thigh, with the trousers' waistband on it, which is what a seat
   * edge meets — and `footRadius` at the bottom, where it has to end ON the sole.
   */
  leg: { top: number; bottom: number; radius: number; footRadius: number };
  /**
   * One arm: the upper arm as a capsule on the shoulder's axis (sleeve included), plus the hand as
   * a sphere. `restZ` is the outward splay the arm hangs at when its joint is at zero — the LEFT
   * arm's value; the right mirrors it. The authored model's arms are modelled splayed and the pose
   * is re-applied under the joint (see AUTHORED_ARM_REST_Z), so aiming a hand at something has to
   * know it.
   */
  arm: { top: number; bottom: number; radius: number; hand: { y: number; radius: number }; restZ: number };
}

/** Crown height above the ground contact point — invariant 2. */
export const crownY = (s: CharacterSkeleton) => s.head.y + s.head.crownRise;

/** Total character height, LOCAL. */
export const localHeight = (s: CharacterSkeleton) => crownY(s) - s.soleY;

/** Total character height, WORLD. ~2.164 for every model here. */
export const worldHeight = (s: CharacterSkeleton) => toWorld(localHeight(s));

// ---------------------------------------------------------------------------
// LEGACY — the procedural character that ships today.
// ---------------------------------------------------------------------------

/**
 * How much longer the legs are than the original build, LOCAL. ~3 cm of real leg.
 *
 * This lives here rather than in the model file because it moves FIVE joints together and
 * they have to stay in step: the thigh capsule grows DOWNWARD by this much while the hips,
 * torso, shoulders and head all rise by it. The two cancel at the feet, which is what keeps
 * the soles on `soleY` — the character gets 3 cm taller and all of it is leg.
 *
 * Still exported because the legacy trouser and shoe models are authored in the leg's own
 * space and need it to find the hem and the sole. See Pants.tsx / Shoes.tsx.
 */
export const LEG_LENGTHEN = 0.0167;

/**
 * The shipped chibi: 0.26-radius sphere head, capsule torso, capsule limbs with ball hands.
 *
 * Every wearable in the game — hair, five hats, seven outfits, six trousers, six shoes,
 * necklaces, glasses, the mask — is authored against these numbers. That is why it stays
 * the default and why it is the fallback the authored model borrows parts from.
 */
export const LEGACY_SKELETON: CharacterSkeleton = {
  head: { y: 0.68 + LEG_LENGTHEN, crownRise: 0.26, halfWidth: 0.26 },
  // 0.135 is the shipped torso capsule's own radius — see character/legacy/index.tsx.
  torso: { y: 0.36 + LEG_LENGTHEN, halfWidth: 0.135 },
  shoulder: { y: 0.42 + LEG_LENGTHEN, x: 0.138 },
  hip: { y: 0.22 + LEG_LENGTHEN, x: 0.065 },
  soleY: -0.005,
  // The primitives character/legacy/index.tsx draws, as worn:
  //   head   sphereGeometry(0.26) on the neck joint
  //   torso  the 0.138 shirt over the 0.135 capsule, and the pelvis fill (constants/
  //          characterForm.ts) that hangs to -0.211 below the torso joint — lower than the capsule
  //   leg    capsuleGeometry(0.055, 0.14 + LEG_LENGTHEN) centred at -0.10 - LEG_LENGTHEN / 2; 0.071 at
  //          the top is the trousers' waistband and 0.064 at the bottom their turned-up cuff, which
  //          is what a lying body's heels rest on — the cap is set to end on the sole at that radius
  //   arm    capsuleGeometry(0.040, 0.10 + ARM_LENGTHEN) under a 0.048 sleeve, and the 0.08 fist
  volumes: {
    head: { y: 0, radius: 0.26 },
    torso: { halfLength: 0.073, radius: 0.138, depth: 0.138 },
    leg: { top: -0.035, bottom: -0.1777, radius: 0.071, footRadius: 0.064 },
    arm: { top: -0.02, bottom: -0.1311, radius: 0.048, hand: { y: -0.1711, radius: 0.08 }, restZ: 0 },
  },
};

// ---------------------------------------------------------------------------
// V2 — the procedural remodel: rounded-cube head with ears, thin limbs, mitt
// hands, oval feet. Kept as the second registered model because it is the proof
// that the layer works: it re-proportions the character without the controller
// branching on it even once.
// ---------------------------------------------------------------------------

/**
 * The head BUYS its smaller skull by rising 0.05: half-height 0.21 at y 0.73 reaches exactly
 * the crown legacy reaches with radius 0.26 at 0.68. That is invariant 2 doing its job —
 * shrinking the head around a fixed centre would have made v2 a shorter character, and
 * "shorter" is a world-retuning job, not a remodel.
 *
 * The limb joints DO move, and that is allowed precisely because the controller writes only
 * rotation there: the hip rises to 0.2283 and narrows to ±0.055 so the legs read as the
 * sketch's two thin strokes, and the torso shortens to clear the raised hip so the whole
 * leg shows instead of its top third being buried the way the legacy capsule buries it.
 * Not one frame of the walk cycle changes, because the swing arcs are written against the
 * joint, wherever the joint is.
 */
export const V2_SKELETON: CharacterSkeleton = {
  head: { y: 0.73 + LEG_LENGTHEN, crownRise: 0.21, halfWidth: 0.21 },
  // The sketch's torso is an upright rounded rectangle 0.24 across — narrower than legacy's
  // 0.135-radius capsule, which is half of what makes v2 read as two thin strokes.
  torso: { y: 0.36 + LEG_LENGTHEN, halfWidth: 0.12 },
  shoulder: { y: 0.44 + LEG_LENGTHEN, x: 0.135 },
  hip: { y: 0.2283 + LEG_LENGTHEN, x: 0.055 },
  soleY: -0.005,
  // character/CharacterModelV2.tsx's primitives. The head is a rounded CUBE (half 0.21); the
  // sphere that stands in for it is its inscribed one, which is exact on every face — the back of
  // the head on a pillow, the crown under a beam — and only short at the eight rounded corners.
  // The leg ends on the oval FOOT's half-HEIGHT, so the capsule stops on the sole; the foot is
  // wider (0.075) and longer than that, which a capsule cannot enclose without sinking the body.
  // v2 renders bare (no wardrobe), so these are the body itself.
  volumes: {
    head: { y: 0, radius: 0.21 },
    torso: { halfLength: 0.03, radius: 0.12, depth: 0.10 },
    leg: { top: -0.03, bottom: -0.208, radius: 0.045, footRadius: 0.042 },
    arm: { top: -0.02, bottom: -0.16, radius: 0.028, hand: { y: -0.205, radius: 0.075 }, restZ: -0.16 },
  },
};

// ---------------------------------------------------------------------------
// AUTHORED — the hand-made 3D model, imported one part at a time.
// ---------------------------------------------------------------------------

/**
 * The authored arms' REST POSE: the splay the modeller gave them, in radians about z, as
 * measured off the `Arm_L` empty in the source file. The left arm takes this, the right its
 * negative.
 *
 * It lives here rather than in the .glb because it is a POSE, not geometry. The controller
 * writes `rotation` on the arm joint every frame, so an angle baked into the joint would be
 * overwritten on the first frame; and an angle baked into the MESH would move the arm without
 * moving the sleeve drawn beside it. Stated once, it is applied by `slots.tsx` to the mesh and
 * to everything worn on the arm together — see AuthoredPart.transform.
 *
 * ⚠️ GENERATED with the skeleton below. Same script, same rule. Declared ahead of it because the
 * skeleton's arm volume hangs at this splay too.
 */
export const AUTHORED_ARM_REST_Z = -0.5249;

/**
 * THE HAND-MADE MODEL's skeleton — MEASURED off the asset, not chosen here.
 *
 * ⚠️ GENERATED. Every number below is printed by `npm run split:character`, which cuts
 * `blender-reference/authored-character-source.glb` into the six part files and reports where
 * the joints ended up. Re-run it and re-paste this block whenever the Blender source changes;
 * editing these by hand makes the rig and the geometry disagree, and the symptom of that is a
 * limb that detaches when the character walks.
 *
 * It is no longer a copy of LEGACY, because real parts are registered now (see
 * character/slots.tsx). What the numbers say about this model:
 *
 *   - The whole body is 14.4% larger than it was modelled, uniformly. The source stands
 *     0.8409 sole-to-crown and the island was built for 0.9617, so the splitter applies one
 *     scale and one lift. That is a change of UNITS; no proportion was touched.
 *   - The head is smaller than legacy's (0.2365 half-width against 0.26) and its sphere centre
 *     is 0.0537 BELOW the neck joint rather than on it — which is why every head socket below
 *     carries that offset instead of sitting at zero. `crownRise` (0.1828) is correspondingly
 *     short: the skull hangs low off its own joint, so the joint has to ride high to put the
 *     crown back on the envelope.
 *   - The shoulders and hips are narrower than legacy's, because the limbs are re-pivoted
 *     onto their own axes: the source meshes hang inboard of the empties they were parented
 *     to, and a joint off the limb's axis swings wrong and puts trousers beside the leg.
 *   - The shoulder (0.1166) sits just OUTSIDE the torso's half-width (0.1187 — near enough to
 *     be on its edge). That relationship is the one to watch when re-proportioning: an arm
 *     whose axis passes outside the widest part of the body cannot be closed up by moving it
 *     down, because the torso never reaches out to it. What saves it here is that the arm's
 *     own top sits BELOW the torso's, so its tip never gets to the height where the body has
 *     narrowed away from it.
 *
 * The two envelope numbers are unchanged and cannot move: sole on `soleY`, crown on
 * `RIG_ENVELOPE.worldHeight`. `assertRigInvariants` below re-checks both at module load.
 */
export const AUTHORED_SKELETON: CharacterSkeleton = {
  head: { y: 0.7736, crownRise: 0.1831, halfWidth: 0.2369 },
  torso: { y: 0.3992, halfWidth: 0.1189 },
  shoulder: { y: 0.4519, x: 0.1168 },
  hip: { y: 0.2467, x: 0.0581 },
  soleY: -0.005,
  // Measured off the six .glb parts as worn (`npm run audit:character` re-measures the bare parts
  // and fails if one pokes out of what is declared here):
  //   head   the skull hangs 0.0538 BELOW the neck joint — the same offset every head socket in
  //          AUTHORED_ATTACHMENTS carries — and reaches 0.2404 from that centre
  //   torso  the bare torso is 0.2378 across and 0.2046 deep; the fitted shirt stands 1.6 cm proud
  //          of it front and back and flares to 0.164 at the hem
  //   leg    the capsule runs +0.106 .. -0.2517 about the hip with a 0.063 radius; the trousers'
  //          waistband is 0.083 out and their cuff 0.075, and the bottom cap ends on the sole
  //   arm    a 0.05 upper arm under a 1.1753-scaled sleeve, and the mitt hand, widest at -0.185
  volumes: {
    head: { y: -0.0538, radius: 0.2404 },
    torso: { halfLength: 0.02, radius: 0.164, depth: 0.12 },
    leg: { top: 0.03, bottom: -0.1767, radius: 0.083, footRadius: 0.075 },
    arm: { top: 0.0, bottom: -0.10, radius: 0.0564, hand: { y: -0.180, radius: 0.0845 }, restZ: AUTHORED_ARM_REST_Z },
  },
};

// ---------------------------------------------------------------------------
// ATTACHMENT POINTS — where things that are NOT the body mount.
// ---------------------------------------------------------------------------

/**
 * A mount point, in the space of the PART it hangs off (see COORDINATE RULES). A hair
 * anchor is head-local, a held-item anchor is hand-local.
 *
 * Stating these per-model is what stops a wearable being "the thing that knows the head is
 * a 0.26 sphere". A hat asks for `hat`, gets a frame, and fits itself to `headHalfWidth`.
 */
export interface AttachmentPoint {
  /** Offset from the parent part's joint origin, in that part's own space. */
  position: readonly [number, number, number];
  /** Euler XYZ. Omitted means unrotated. */
  rotation?: readonly [number, number, number];
  /**
   * Uniform scale to apply to whatever mounts here. 1 means the wearable is authored at
   * this model's size; a model with a smaller head sets < 1 so legacy-authored wearables
   * shrink to fit instead of swallowing the skull.
   */
  scale?: number;
}

/**
 * WHAT THE `crown` SOCKET PROMISES — the one measurement an ornament that RINGS the head is
 * authored against, stated once so that both ends can read it.
 *
 * A hat, a hairpiece or a pendant is a volume placed at a point; a circlet is not. It is a
 * ring, and a ring only sits right if it agrees with the thing under it about a LATITUDE and
 * a RADIUS. So the socket names them: on a bare legacy skull, a crown ornament's band lies at
 * y = 0.14 with radius 0.219 — which is exactly √(0.26² − 0.14²), i.e. ON the sphere.
 *
 * The reason this is here rather than inside the one ornament that uses it: whatever the
 * player is ALREADY wearing on their head changes what "on the head" means. A hat's own band
 * is 0.25 out and 0.10 up; a bulky hairstyle's shell stands 0.04 off the skull. A model that
 * hosts both re-states this promise against whichever of those is outermost (see
 * character/legacy/wardrobe.tsx), and it can only do that if it knows what the promise was.
 */
export const CROWN_RING = { y: 0.14, radius: 0.219 } as const;

/**
 * THE SHAPE OF A TORSO, as the garments that wrap it need to know it.
 *
 * Every torso garment (the seven outfits, the shirts, the swimsuit, the grass skirt, the
 * necklaces) is drawn hugging legacy's torso: a CIRCULAR capsule, radius 0.135, straight for
 * ±0.04 and capped by hemispheres 0.135 tall. A uniform socket scale can bring those garments to
 * a body of a different SIZE, but not of a different SHAPE — and the authored torso is a
 * different shape: an ellipse in plan (0.119 wide, only 0.102 deep) with a shorter straight
 * section and flatter caps. Scaled uniformly, every garment stood 2 cm proud of the chest and
 * hung its rounded bottom cap 2 cm past the body, which on screen is a pointed bib over the
 * trousers instead of a shirt.
 *
 * A model that states its torso this way gets its garments WARPED onto it instead (see
 * character/bodyFit.ts): each point is carried from the legacy surface to the same latitude and
 * bearing on this one, keeping its absolute clearance off the body. Omitted, the socket scale
 * is used exactly as before.
 */
export interface TorsoShape {
  /** Half-width across the shoulders (x) through the straight section. */
  halfX: number;
  /** Half-depth front to back (z) through the straight section. */
  halfZ: number;
  /** The straight section runs y in [-straightHalf, +straightHalf]. */
  straightHalf: number;
  /** How far each cap rises past the straight section — its y semi-axis. */
  capHeight: number;
  /**
   * The hip joint, torso-local. What hangs from the hips rather than from the chest — the grass
   * skirt — is placed against this, because the legs do not start at the same point on every
   * torso: the authored hip sits below its torso's cap, legacy's well inside it.
   */
  hipY: number;
  /**
   * Where a garment's HEM falls, when it should not follow the body's lower cap in.
   *
   * On legacy the chest is far wider than the thighs, so a top that curves in with the belly
   * still hides the trousers' waistband. On a body whose thighs are nearly as wide as its chest
   * it does not: the waistband stands out either side of the narrowing cap and the top reads as
   * a V-shaped bib. A hem says what a real top does instead — it hangs from the chest, eases out
   * over the trousers and ends at `y` (torso-local, negative) at this half-width and half-depth,
   * closing underneath only below that line.
   */
  hem?: { y: number; halfX: number; halfZ: number };
}

/** The body every torso garment was drawn on. See {@link TorsoShape}. */
export const LEGACY_TORSO_SHAPE: TorsoShape = {
  halfX: 0.135, halfZ: 0.135, straightHalf: 0.04, capHeight: 0.135,
  // LEGACY_SKELETON.hip.y - torso.y, spelled out because that constant is declared below.
  hipY: -0.14,
};

/**
 * THE LIMB EACH WRAP-AROUND WEARABLE WAS DRAWN FOR.
 *
 * Three wearables do not hang off a socket point — they enclose a limb: the sleeve, the
 * trousers and the shoes. Each therefore has an assumption about how thick that limb is baked
 * into its geometry, and on a model with a different limb the assumption fails the same way
 * every time: the limb comes through the cloth.
 *
 * Stated here so that assumption is a NUMBER a model can be fitted against rather than a
 * comment in three files. Its consumers are the wearables themselves (so the value and the
 * geometry cannot drift apart) and `npm run audit:character`, which checks that every model's
 * `sleeve` / `leg` / `foot` sockets actually clear the limbs it ships.
 *
 * These are LEGACY's dimensions and legacy is the reference by definition — it is the body the
 * whole wardrobe was drawn on. A model states its own fit through the sockets, not by editing
 * anything here.
 */
export const LEGACY_WEARABLE_FIT = {
  /** The sleeve capsule in LegacyArmWearables, in ARM space. */
  sleeve: { radius: 0.048, length: 0.04, y: -0.03 },
  /** The torso garment's capsule in LegacyTorsoWear, in TORSO space. */
  top: { radius: 0.138, length: 0.08 },
  /**
   * The legacy TORSO's own capsule — the body, not a garment.
   *
   * Here because it is the shape an imported torso is a scaled copy of, which is what lets
   *  test whether a swinging leg stays inside the body exactly, instead of
   * against a bounding box that would call the corners of the chest solid.
   */
  torso: { radius: 0.135, length: 0.08 },
  /**
   * How far above the hip the trousers reach (Pants.tsx's `WAIST_Y`), in LEG space.
   *
   * Stated here because it is not only the trousers' business: everything ABOVE it is the top
   * garment's to cover, so it is the boundary those two wearables meet at. Get it wrong on a
   * body whose thighs are nearly as wide as its chest and a band of bare leg appears right
   * round the hips, between hem and waistband.
   */
  trouserWaistY: 0.035,
  /**
   * The closest anything trousered may sit to the leg's axis (Pants.tsx's `MIN_CLEARANCE`),
   * which is also the floor the crease displacement is clamped to. 2.5 mm outside the legacy
   * leg capsule's own 0.055.
   *
   * The shoes' snuggest closed part is a hair wider than this (~0.058 collars and shafts), so
   * a leg that clears the trousers clears the shoes too — which is why this one number sizes
   * both, and why `leg` and `foot` take the same socket scale.
   */
  trouserFloor: 0.0575,
} as const;

/**
 * The named sockets. Adding a slot here is how a new kind of wearable gets a home; a model
 * that cannot host one omits it and the wearable simply does not render, rather than
 * rendering somewhere wrong.
 */
export interface CharacterAttachments {
  /** Head-local. Hair mounts at the skull centre with no transform — see constants/hair.ts. */
  hair: AttachmentPoint;
  /** Head-local. A hat's lowest ring sits at the brow. */
  hat: AttachmentPoint;
  /**
   * Head-local, ON the face plane rather than at the skull centre: glasses. Separate from
   * `mask` because the two are authored differently — glasses are a small part placed in
   * front of the eyes, a mask is a full-face carving authored in head space.
   */
  glasses: AttachmentPoint;
  /** Head-local, at the skull centre: the full-face 部落面具 carving. */
  mask: AttachmentPoint;
  /** Head-local, mirrored to ±x: earrings. */
  ear: AttachmentPoint;
  /**
   * Head-local, ON the side of the skull above and in front of the ear: hair ornaments —
   * pins, clips, single flowers. Special cosmetics only (constants/cosmeticEffects.ts).
   *
   * Separate from `hair` because it is a point on the SURFACE rather than the skull centre:
   * a hairpin is a small object resting on the head, so it needs both a position and an
   * outward rotation, where a hairpiece is a whole volume authored around the head.
   */
  hairPin: AttachmentPoint;
  /**
   * Head-local, at the skull centre: wreaths, crowns, circlets — anything that RINGS the
   * head rather than covering it.
   *
   * Deliberately not the `hat` socket, even though the two land in the same place. A hat and
   * a wreath are different wearable slots that a player can own at the same time, so sharing
   * one anchor would put a flower crown inside a bucket hat's crown the moment both were
   * equipped. Sharing the anchor would also mean a model that re-tunes its hat fit silently
   * re-tunes every wreath with it, which is not a relationship either side asked for.
   */
  crown: AttachmentPoint;
  /**
   * Head-local, floating a hand's width ABOVE the crown: halos, rings, anything that hovers
   * over the character rather than resting on it.
   *
   * The clearance is stated as a gap over `crownRise`, not as an absolute height, so a model
   * with a smaller skull keeps the same visual gap instead of wearing its halo like a hat. It
   * is the only head socket that is deliberately NOT in contact with the body — which is also
   * why it is the only one a hat cannot interfere with.
   */
  halo: AttachmentPoint;
  /** Torso-local: shirts, outfits, swimwear, the grass skirt. */
  torso: AttachmentPoint;
  /**
   * The torso's own shape, for a model whose chest is not a scaled copy of legacy's. When set,
   * the torso garments are warped onto it and `torso.scale` is not applied. See TorsoShape.
   */
  torsoShape?: TorsoShape;
  /** Torso-local, at the neckline: necklaces. */
  neck: AttachmentPoint;
  /**
   * Torso-local, on the chest just below the neckline: pendant charms.
   *
   * Its own socket rather than `neck` for the same reason as `crown` vs `hat` — a charm and a
   * necklace are separately ownable, and hanging both from one anchor makes them share a
   * chain they were not drawn to share.
   */
  charm: AttachmentPoint;
  /**
   * Torso-local, BEHIND the shoulder blades: capes, wings, packs — anything worn on the back.
   *
   * The one socket on this character that has to be authored around the HEAD rather than
   * around the part it hangs off. This is a chibi: the skull is a 0.26 sphere whose centre
   * sits only ~0.32 above the torso centre, so it overhangs the whole upper back. A wing
   * rooted here and swept straight up passes through it. The anchor is therefore pushed back
   * to the torso capsule's rear surface, and anything mounted on it has to earn its height by
   * going OUTWARD first — see the wingspan note in Three/effects/CosmeticModels.tsx.
   *
   * Not mirrored. A back wearable is one object that spans the centreline (a cape is one
   * sheet, a pair of wings beats as a pair), so unlike `ear` it is authored whole.
   */
  back: AttachmentPoint;
  /**
   * Arm-local: the sleeve, and the cuff that closes it.
   *
   * The last wearable on this character that is NOT a shape hung off a point — it is a capsule
   * drawn AROUND the upper arm, so it had to assume how thick that arm is and where it ends.
   * Legacy's assumption is baked into the geometry (`capsuleGeometry(0.048, 0.04)`), and on an
   * arm of any other size it fails in the two ways a sleeve can: too narrow and the arm comes
   * through its side; sat too low and the shoulder ball stands bare above it.
   *
   * This socket is how a model states its own answer without the sleeve being re-modelled. The
   * scale takes care of the thickness, the position of where the shoulder end lands; legacy's
   * is the identity, because legacy is what the sleeve was drawn for.
   *
   * Same family as `leg` and `foot` below, and unlike every other socket here: those three
   * carry a SIZE as well as a place, because what hangs on them wraps the body instead of
   * resting against it.
   */
  sleeve: AttachmentPoint;
  /** Leg-local: trousers. Mirrored by the leg it mounts under. */
  leg: AttachmentPoint;
  /**
   * How far up the leg the trousers are carried PAST their waistband, in the trousers' own
   * space — i.e. before `leg`'s scale is applied, because that is the space PantsModel draws in.
   *
   * Not an AttachmentPoint, because it is not a place: it is the one thing the trousers need to
   * know about the body that no socket can express — how much of this model's leg is buried
   * inside its torso. Everything above the waistband is normally the TOP garment's to cover, and
   * a top can only do that while the body is wider than the thigh. On a model where it is not,
   * the two garments each stop where they should and a band of bare leg shows between them.
   *
   * 0 for legacy and v2: their tops cover their own hips, so the trousers have nothing to make
   * up for. See the RISE note in Pants.tsx.
   */
  trouserRise: number;
  /** Leg-local, ON THE SOLE: shoes. The one anchor that must land on the ground plane. */
  foot: AttachmentPoint;
  /**
   * Leg-local, just above the sole: anklets, leg bands.
   *
   * Not mirrored in the `ear` sense. Each LEG renders its own slot, so a cosmetic hung here
   * appears on BOTH legs from one catalog row — which is what an anklet is. That also means it
   * inherits each leg's own swing, so the two are never in step, and nothing had to be written
   * to make that true.
   */
  ankle: AttachmentPoint;
  /**
   * ROOT-local, on the ground the character is standing on: rings of light, circles drawn
   * around the feet, anything that belongs to the FLOOR rather than to the body.
   *
   * The only anchor whose orientation is not the body's. A thing lying on the ground has to
   * follow the GROUND — see {@link GroundSpec} in constants/cosmeticEffects.ts, which is what
   * actually drives it. This anchor only says where the wearer's feet are; the runtime writes
   * the rest, and a model mounted here must therefore be drawn flat in XZ and be readable from
   * any yaw, because it will not turn with the character.
   */
  aura: AttachmentPoint;
  /**
   * Hand-local. Nothing uses this yet — it is here because a held item (a tool, a fishing
   * rod, a lantern) is the most likely next thing to need a socket, and adding it now costs
   * one line per model where adding it later costs a pass over every model.
   */
  hand: AttachmentPoint;
}

/**
 * Legacy sockets, read off the geometry Avatar.tsx has always drawn — these are
 * measurements of the shipped character, not new choices.
 */
export const LEGACY_ATTACHMENTS: CharacterAttachments = {
  hair: { position: [0, 0, 0] },
  hat: { position: [0, 0, 0] },
  glasses: { position: [0, 0.06, 0.245] },
  mask: { position: [0, 0, 0] },
  // Right ear as authored; the left is this mirrored in x.
  ear: { position: [0.27, -0.06, 0] },
  // On the skull's surface at the temple: |(0.215, 0.075, 0.12)| = 0.257 against the 0.26
  // sphere, so an ornament rests on the head with a hair's clearance rather than sinking into
  // it. Yawed 52deg so a pin's face looks out between front and side, which is where the
  // third-person camera actually sees it from.
  //
  // Deliberately BELOW the `crown` ring's height (0.14): the two are separately ownable and a
  // player wearing both should get a pin beside a wreath, not a pin through it.
  hairPin: { position: [0.215, 0.075, 0.12], rotation: [0, 0.9, 0] },
  crown: { position: [0, 0, 0] },
  // 0.07 above the 0.26 skull's crown — about 16 cm of real clearance on a 2.16-unit character.
  // The first pass used 0.14 and it reads as an object hovering NEAR someone rather than as
  // something they are wearing: a halo has to be close enough that the eye groups it with the
  // head, and a gap of a third of a head diameter is past that.
  halo: { position: [0, 0.33, 0] },
  torso: { position: [0, 0, 0] },
  neck: { position: [0, 0.09, 0.03] },
  charm: { position: [0, 0.06, 0.02] },
  // On the back of the torso capsule (radius 0.135) and a little above its centre, so a
  // wearable's root sits at the shoulder blades rather than at the waist.
  back: { position: [0, 0.045, -0.132] },
  // Identity: the sleeve, the trousers and the shoes were all drawn for THIS leg and THIS arm,
  // so legacy is the one model that needs no correction on any of the three.
  sleeve: { position: [0, 0, 0] },
  leg: { position: [0, 0, 0] },
  trouserRise: 0,
  // -0.225 - LEG_LENGTHEN: the leg capsule's bottom cap. Derived in Shoes.tsx as
  // `soleAnchorY`, restated here so a model can be asked where its sole is without
  // importing a shoe.
  foot: { position: [0, -0.225 - LEG_LENGTHEN, 0] },
  // 0.035 above the sole: clear of the shoe's own upper, still on the narrow part of the leg.
  ankle: { position: [0, -0.19 - LEG_LENGTHEN, 0] },
  // The root origin IS the ground contact point (see soleY), so this is simply zero — and it
  // being zero is the whole reason a ground cosmetic can be mounted without measuring anything.
  aura: { position: [0, 0, 0] },
  hand: { position: [0, -0.16 - 0.0111, 0] },
};

/**
 * v2's sockets. The head ones all move, because the skull is 19% narrower and taller-
 * centred; the body ones are close to legacy because the torso barely changed.
 *
 * `scale: 0.81` on the head sockets is the ratio of the two head half-widths (0.21/0.26).
 * A legacy-authored hat mounted here comes in at v2's head size instead of hanging off it —
 * which is the mechanism that will let v2 wear the existing wardrobe when Phase 2 gets to it.
 */
export const V2_ATTACHMENTS: CharacterAttachments = {
  hair: { position: [0, 0, 0], scale: 0.81 },
  hat: { position: [0, 0.02, 0], scale: 0.81 },
  glasses: { position: [0, 0.04, 0.2], scale: 0.81 },
  mask: { position: [0, 0, 0], scale: 0.81 },
  ear: { position: [0.22, -0.04, 0], scale: 0.81 },
  // The legacy point brought in to v2's smaller skull by the same 0.81 the other head
  // sockets use, so an ornament stays on the surface of a head that is 19% narrower.
  hairPin: { position: [0.174, 0.061, 0.097], rotation: [0, 0.9, 0], scale: 0.81 },
  crown: { position: [0, 0, 0], scale: 0.81 },
  // 0.07 above v2's 0.21 crown: the GAP is kept, not the height. Scaling legacy's number by
  // 0.81 like the other head sockets would shrink the clearance on a skull that is already
  // shorter, i.e. move the halo closer to the head for no reason anyone chose.
  halo: { position: [0, 0.28, 0], scale: 0.81 },
  torso: { position: [0, 0, 0] },
  neck: { position: [0, 0.09, 0.03] },
  charm: { position: [0, 0.06, 0.02] },
  // Unscaled like the other torso sockets: v2 re-proportions the HEAD, not the chest, so a
  // back wearable comes in at the size it was authored. It does get more clearance than on
  // legacy for free — v2's skull is 19% narrower and therefore overhangs less.
  back: { position: [0, 0.045, -0.132] },
  // v2 re-proportions the head, not the limbs: its arm and leg are legacy's, so the three
  // wrap-around sockets stay at the identity here too.
  sleeve: { position: [0, 0, 0] },
  leg: { position: [0, 0, 0] },
  trouserRise: 0,
  foot: { position: [0, -0.225 - LEG_LENGTHEN, 0] },
  ankle: { position: [0, -0.19 - LEG_LENGTHEN, 0] },
  aura: { position: [0, 0, 0] },
  hand: { position: [0, -0.155, 0] },
};

/**
 * The authored model's sockets — legacy's, re-fitted to the imported body.
 *
 * ⚠️ GENERATED, like AUTHORED_SKELETON: `npm run split:character` prints this block from the
 * measured parts. Two derivations do all the work, and both exist so that the ENTIRE existing
 * wardrobe keeps fitting without a single wearable being re-modelled:
 *
 *   scale 0.9095 on the head sockets    = 0.2365 / 0.26, the ratio of the two head
 *                                         half-widths. Same mechanism as V2_ATTACHMENTS'
 *                                         0.81: a legacy-authored hat arrives at THIS head's
 *                                         size instead of hanging off it.
 *   scale 0.8794 on the torso sockets   = 0.1187 / 0.135, likewise for the chest. Kept as a
 *                                         scale even when it lands near 1, because it is
 *                                         DERIVED from the part: it goes on being right when
 *                                         the torso moves again, where a hard-coded 1 would
 *                                         quietly stop being.
 *
 * The head sockets also carry `y: -0.0537`, the offset from the NECK JOINT down to the skull's
 * centre. Legacy gets away with zero there only because its head happens to be a sphere
 * centred on its own joint — the coincidence LegacyHead's comment warns not to rely on. This
 * skull hangs a long way below its joint, so that offset is the single largest correction in
 * this table and the one a hat would notice first if it went missing.
 *
 * The THIRD derivation is a different kind of fit, and the one the first import got wrong.
 * `sleeve`, `leg` and `foot` do not hang a wearable off a point — they wrap one around a limb,
 * and legacy's sleeve, trousers and shoes each have the limb they were drawn for baked into
 * their geometry. This body's arm and leg are both thicker than that, so all three came through
 * the cloth. They are scaled to the LIMB rather than to the torso:
 *
 *   sleeve 1.1735 over a 0.0458 upper arm, and lifted so its shoulder cap encloses the arm's.
 *          The lift matters as much as the scale: a correctly-sized sleeve left at legacy's
 *          height still leaves the top of the shoulder bare whenever the arm's capsule stands
 *          above its own joint, as this one does.
 *   leg    1.166, and `foot` takes the SAME number: the trouser hem and the boot shaft meet at
 *   foot   the ankle, so bringing them in at different sizes would open a gap there instead.
 *          Sized off Pants.tsx's own floor (0.0575) against this leg's 0.063 half-width.
 *
 * The FACE sockets — `glasses` and `mask` — follow the EYES, not the skull. This head's eyes sit
 * 0.059 lower on the sphere than legacy's (−0.027 from the skull centre against legacy's
 * +0.032 once scaled), so both carry that drop, and `glasses` moves out to the sphere's surface
 * at its new, lower latitude. Hung off the skull alone, the sunglasses sat on the forehead a
 * full eye-height above the eyes and the mask's eye holes looked out over the brow.
 *
 * `torsoShape` is the fourth derivation, and the reason the torso garments fit at all — see
 * TorsoShape. The chest is an ellipse, not a circle, so no single scale can fit it.
 *
 * Three points are deliberately NOT scaled, and each for its own reason:
 *   halo   states a GAP over the crown (0.07), not a height. Scaling it would pull the halo
 *          closer to a head that is already shorter, which nobody asked for.
 *   ankle  keeps legacy's 0.035 of clearance above the sole, for the same reason as halo.
 *   leg's  `foot` POSITION is the measured sole, so a shoe still lands on the ground; only its
 *          size is scaled.
 */
export const AUTHORED_ATTACHMENTS: CharacterAttachments = {
  hair: { position: [0, -0.0538, 0], scale: 0.911 },
  hat: { position: [0, -0.0538, 0], scale: 0.911 },
  glasses: { position: [0, -0.058, 0.2295], scale: 0.911 },
  mask: { position: [0, -0.1127, 0], scale: 0.911 },
  ear: { position: [0.246, -0.1084, 0], scale: 0.911 },
  hairPin: { position: [0.1959, 0.0145, 0.1093], rotation: [0, 0.9, 0], scale: 0.911 },
  crown: { position: [0, -0.0538, 0], scale: 0.911 },
  halo: { position: [0, 0.2531, 0], scale: 0.911 },
  torso: { position: [0, 0, 0], scale: 0.8809 },
  torsoShape: {
    halfX: 0.1189, halfZ: 0.1023, straightHalf: 0.0312, capHeight: 0.1052, hipY: -0.1525,
    hem: { y: -0.1116, halfX: 0.1599, halfZ: 0.1143 },
  },
  neck: { position: [0, 0.0793, 0.0264], scale: 0.8809 },
  charm: { position: [0, 0.0529, 0.0176], scale: 0.8809 },
  back: { position: [0, 0.0396, -0.1163], scale: 0.8809 },
  sleeve: { position: [0, 0.0174, 0], scale: 1.1753 },
  leg: { position: [0, 0, 0], scale: 1.1678 },
  trouserRise: 0.0942,
  foot: { position: [0, -0.2517, 0], scale: 1.1678 },
  ankle: { position: [0, -0.2167, 0] },
  aura: { position: [0, 0, 0] },
  hand: { position: [0, -0.1795, -0.0052] },
};

// ---------------------------------------------------------------------------
// INVARIANT CHECK
// ---------------------------------------------------------------------------

/**
 * The world-facing numbers every skeleton must agree on. Quoted in WORLD units because
 * that is the space the things that care about them live in.
 *
 * These are LEGACY's values, and legacy is the reference by definition: the island was
 * built around the character that shipped, so "correct" here means "the same as what the
 * doors, the furniture and the camera were tuned against".
 */
export const RIG_ENVELOPE = {
  /** Sole → crown. */
  worldHeight: toWorld(0.9617),
  /** How far a joint may drift before it counts as a different character. ~2 mm world. */
  toleranceWorld: 0.002,
} as const;

/**
 * Fails loudly on a model that would float, sink, or quietly change the character's height.
 *
 * Runs at module load for every registered skeleton (see below), so the failure lands the
 * moment the file is edited rather than the first time someone walks through a doorway.
 */
export function assertRigInvariants(name: string, s: CharacterSkeleton): void {
  const problems: string[] = [];

  const soleDrift = Math.abs(toWorld(s.soleY) - toWorld(LEGACY_SKELETON.soleY));
  if (soleDrift > RIG_ENVELOPE.toleranceWorld) {
    problems.push(
      `sole sits at local ${s.soleY} but the root origin is the ground contact point ` +
      `(expected ${LEGACY_SKELETON.soleY}); the character would ` +
      `${s.soleY > LEGACY_SKELETON.soleY ? 'float above' : 'sink into'} the terrain.`,
    );
  }

  const heightDrift = Math.abs(worldHeight(s) - RIG_ENVELOPE.worldHeight);
  if (heightDrift > RIG_ENVELOPE.toleranceWorld) {
    problems.push(
      `stands ${worldHeight(s).toFixed(4)} world units tall against the ` +
      `${RIG_ENVELOPE.worldHeight.toFixed(4)} every door, camera offset and piece of ` +
      `furniture was tuned against. Move the head JOINT to pay for a changed crownRise ` +
      `rather than letting the total move — see V2_SKELETON for a worked example.`,
    );
  }

  if (s.head.y <= s.torso.y) problems.push(`head joint (${s.head.y}) is not above the torso (${s.torso.y}).`);
  if (s.hip.y >= s.shoulder.y) problems.push(`hip (${s.hip.y}) is not below the shoulder (${s.shoulder.y}).`);

  // The volumes have to END where the envelope does. A leg volume that stops short of the sole
  // lets a seat's front edge through the shin unnoticed; one that overshoots sinks every seated
  // and lying body by the difference. Same for the skull and the crown under a swing's beam.
  const VOLUME_TOLERANCE = 0.006;
  const v = s.volumes;
  const legEnd = s.hip.y + v.leg.bottom - v.leg.footRadius;
  if (Math.abs(legEnd - s.soleY) > VOLUME_TOLERANCE) {
    problems.push(`the leg volume ends at ${legEnd.toFixed(4)}, not on the sole (${s.soleY}).`);
  }
  const skullTop = s.head.y + v.head.y + v.head.radius;
  if (Math.abs(skullTop - crownY(s)) > VOLUME_TOLERANCE) {
    problems.push(`the head volume's top is at ${skullTop.toFixed(4)}, not on the crown (${crownY(s).toFixed(4)}).`);
  }
  if (v.leg.top <= v.leg.bottom || v.arm.top <= v.arm.bottom) {
    problems.push('a limb volume runs upward — `top` must be above `bottom`.');
  }

  if (problems.length > 0) {
    throw new Error(`[characterRig] ${name} breaks the rig contract:\n  - ${problems.join('\n  - ')}`);
  }
}

assertRigInvariants('LEGACY_SKELETON', LEGACY_SKELETON);
assertRigInvariants('V2_SKELETON', V2_SKELETON);
assertRigInvariants('AUTHORED_SKELETON', AUTHORED_SKELETON);

/**
 * The somersault's pivot: the torso centre, i.e. the body's centre of mass. Rotating the
 * root instead would spin the character about its ankles and read as a cartwheel — see the
 * FLIP note in Avatar.tsx. LOCAL, so multiply by CHARACTER_ROOT_SCALE before use.
 */
export const flipPivotLocalY = (s: CharacterSkeleton) => s.torso.y;

/**
 * How far the character's centre has to stay off a full-height surface for none of them to be
 * inside it, WORLD.
 *
 * THE HEAD IS THE WIDEST PART OF THIS CHARACTER, and that is the whole point. The general
 * collision radius (PLAYER_PHYSICAL_RADIUS, 0.35) is a body-sized number: it matches the torso
 * and the shoulders, and it is what the player is stopped at by furniture, which is mostly below
 * the shoulder anyway. A wall is not. The skull is a 0.26-LOCAL sphere — 0.585 world, two thirds
 * again as wide as the collider under it — so a body held 0.35 off a wall face leaves a quarter
 * of a metre of head buried in it. That is the reported 「走向牆壁時身體會陷進牆裡」: not a
 * missing collider, a collider narrower than the thing it is standing in for.
 *
 * Taken from the skeleton rather than written down, so a remodel that changes the character's
 * proportions changes where it stops. `torso.halfWidth` is in the max for the model where the
 * body is the wider of the two; on every skeleton registered today the head wins.
 *
 * Used ONLY against walls and the house shell — surfaces that run from the floor past the
 * character's crown. Applying it to furniture would stop the player a quarter-metre short of
 * every table for the sake of a head that is well above it.
 */
export const bodyClearanceRadius = (s: CharacterSkeleton) =>
  toWorld(Math.max(s.head.halfWidth, s.torso.halfWidth));

/**
 * WALK radius: how far the character's centre is held off anything solid. Interior walls,
 * furniture, island props and the Home's solid box all inflate by exactly this, so "how
 * close can I get" has one answer everywhere in the game (see PLAYER_PHYSICAL_RADIUS in
 * utils/placementRules.ts, which re-exports this).
 *
 * Comfortably wider than the shipped chibi's shoulders on purpose. A collider drawn tight to
 * a silhouette makes a character that scrapes through gaps its body visibly should not fit,
 * and it would have to be re-derived for every model; a generous cylinder reads as solid and
 * survives a remodel untouched. Deliberately NOT derived from the skeleton like
 * `bodyClearanceRadius` above — that one exists specifically to widen for a wide head against
 * walls, and this one must not follow it there or the player would stop a quarter-metre short
 * of every table.
 */
export const PLAYER_COLLIDER_RADIUS = 0.35;

/**
 * Where the camera sits in first person: the character's own EYE, WORLD.
 *
 * THE HEIGHT, DELIBERATELY NOT THE POSITION. A real eye is also a hand's width in FRONT of the
 * skull's centre, and this does not move the camera there. The player's own collision keeps
 * their CENTRE 0.35 off a wall face (PLAYER_PHYSICAL_RADIUS), while the face is 0.55 world units
 * forward of that centre — so a viewpoint pushed out to the true eye position would be inside
 * the wall every time the player walked up to one. Height is free; forward is not.
 *
 * The height itself comes from the model's own `glasses` socket, which every model already
 * declares ON its face in front of the eyes. That is the one measurement in the rig that means
 * "here are the eyes", so a remodel that moves the face moves the viewpoint with it and no model
 * has to state an eye twice.
 *
 * It used to be the head JOINT — the centre of the skull, ~13 cm below anyone's eyes on this
 * character — which is why first person read as looking out of the middle of your own head.
 */
export const firstPersonEyeWorldY = (s: CharacterSkeleton, a: CharacterAttachments) =>
  toWorld(s.head.y + a.glasses.position[1] * (a.glasses.scale ?? 1));
