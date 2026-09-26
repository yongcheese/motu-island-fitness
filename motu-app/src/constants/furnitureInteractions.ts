/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CharacterSkeleton } from './characterRig';
import { toWorld } from './characterRig';
import { getItemById } from './items';
import type { SuspendedMotionId } from './outdoorAnimation';
import {
  PostureAnchoring,
  PostureId,
  getPosture,
} from './interactionPostures';

/**
 * WHAT A PIECE OF FURNITURE LETS THE PLAYER DO — the one vocabulary the interaction system
 * speaks, and the sibling of constants/placement.ts.
 *
 * ## Why this file exists
 *
 * Before it, "can the player do something with this?" was answered by two hard-coded lists
 * inside the character controller (Three/Avatar.tsx):
 *
 *   `if (item.name === '吊床')`                    — the one piece you could lie on
 *   `INTERACTIVE_DECOR_NAMES = ['木製鞦韆', …]`     — the five that played an animation
 *
 * Both were keyed on the item's Chinese NAME, both lived in the file that animates the body,
 * and neither could be extended without editing that file. Indoors there was no third list —
 * every piece of furniture in the house was scenery, however obviously it was a seat.
 *
 * So the CAPABILITY ("this is something you sit on") existed nowhere as data. This module makes
 * it a declared property of the item, exactly as `placement`, `standable` and `tabletop` already
 * are: adding 鞦韆, 吊床, 浴缸, 鋼琴, 書桌 or 望遠鏡 behaviour is one field in the catalog, and
 * the controller, the prompt and the UI all follow from it without learning a single item name.
 *
 * ## The split this file used to be missing
 *
 * It originally held BOTH halves of an interaction — the verb and the body — in one table, and
 * that is what made every non-seat interaction in the game look the same. Its `pose` column had
 * exactly two values, `'sit'` and `'lie'`; every other kind left it undefined, and undefined was
 * routed to one shared two-arm reach. 泡澡, 烹飪, 觀星, 洗手, 許願 and 閱讀 were the same
 * animation with different captions, because there was nowhere to say otherwise.
 *
 * The two halves are now separate files:
 *
 *   THIS FILE                        the VERB — what the prompt offers, and where on the piece
 *                                    the body goes.
 *   constants/interactionPostures.ts the BODY — what the whole skeleton does, as joint targets.
 *
 * A kind names a posture; an item may override that posture; and nothing downstream branches on
 * either. See {@link INTERACTION_KINDS}.
 *
 * ## What IS here and what is NOT
 *
 * HERE: the verb, the posture it selects, and — for a posture that puts the body ON the piece —
 * WHERE ON THE PIECE it goes, stated in the piece's own local frame so it rides the placement's
 * position, rotation and scale. Nothing is ever expressed in world coordinates.
 *
 * NOT HERE: how big the piece is, how far away the player may stand, where the prompt floats.
 * All three are measured off the model (lib/furniturePlacement.ts) and resolved in
 * lib/furnitureInteraction.ts, for the same reason placement carries no sizes: a table of
 * dimensions can disagree with the thing on screen, and eventually does.
 */

/**
 * Which icon the touch prompt shows. A short closed set rather than a lucide name, so the
 * catalog never has to know which icon library the HUD is drawn with — UI/InteractionPrompt.tsx
 * maps these to components.
 */
export type InteractionIcon =
  | 'sit' | 'lie' | 'bath'
  | 'hand' | 'door' | 'panel' | 'cook' | 'droplet' | 'eye' | 'book' | 'sparkle' | 'flame'
  | 'brush' | 'push';

export interface InteractionKindSpec {
  /** What the prompt offers: 「E 坐下」. */
  verb: string;
  /** What it offers once the player is already on the piece. Occupying postures only. */
  exitVerb?: string;
  /**
   * THE JOIN between the verb and the body (constants/interactionPostures.ts).
   *
   * This one field is what the whole rework turns on. It used to be `pose?: 'sit' | 'lie'`,
   * where "absent" meant "no pose" and no pose meant one shared hand-wave; it is now a
   * required name from a table of fourteen full-body postures, so 「泡澡」 selects a body in a
   * bathtub rather than selecting nothing.
   */
  posture: PostureId;
  icon: InteractionIcon;
}

/**
 * The verbs. Adding one is a row here plus a member of the union — and, if no existing body
 * language fits it, a row in the posture table. Nothing downstream branches on the kind itself;
 * every consumer reads these fields.
 */
export type InteractionKind =
  | 'sit' | 'lie' | 'rest' | 'bathe' | 'swing'
  | 'use' | 'open' | 'operate' | 'cook' | 'wash' | 'observe' | 'read' | 'wish' | 'tend'
  | 'groom' | 'push' | 'play';

export const INTERACTION_KINDS: Record<InteractionKind, InteractionKindSpec> = {
  // --- the body goes onto or into the piece -----------------------------------
  sit: { verb: '坐下', exitVerb: '起身', posture: 'sit', icon: 'sit' },
  lie: { verb: '躺下', exitVerb: '起身', posture: 'lie', icon: 'lie' },
  // Same body as `lie`, different offer. A bed you sleep in and a hammock you rest in are one
  // posture and two verbs, which is exactly the separation this table now expresses.
  rest: { verb: '休息', exitVerb: '起身', posture: 'lie', icon: 'lie' },
  bathe: { verb: '泡澡', exitVerb: '起身', posture: 'bathe', icon: 'bath' },
  /**
   * 盪鞦韆. An OCCUPYING verb, and that is the whole of the swing rework.
   *
   * It used to be `push` — an ACTING verb, so the player stood beside the swing and played a
   * shove while the seat swung on a timer of its own. Nothing was wrong with that animation; the
   * problem was the category. A swing is a thing you get ON, and once it says so, every piece of
   * behaviour the brief asks for falls out of machinery that already existed: the controller
   * walks the body to the anchor, squares it up, holds it there until 「下來」, and eases it off
   * afterwards — the same code a sofa uses.
   */
  swing: { verb: '盪鞦韆', exitVerb: '下來', posture: 'swing', icon: 'sit' },

  // --- the body acts AT the piece and is handed back --------------------------
  use: { verb: '使用', posture: 'reach', icon: 'hand' },
  open: { verb: '打開', posture: 'open', icon: 'door' },
  operate: { verb: '操作', posture: 'operate', icon: 'panel' },
  cook: { verb: '烹飪', posture: 'cook', icon: 'cook' },
  wash: { verb: '清洗', posture: 'wash', icon: 'droplet' },
  observe: { verb: '觀看', posture: 'observe', icon: 'eye' },
  read: { verb: '閱讀', posture: 'read', icon: 'book' },
  wish: { verb: '許願', posture: 'wish', icon: 'sparkle' },
  tend: { verb: '照料', posture: 'tend', icon: 'flame' },
  groom: { verb: '整理儀容', posture: 'groom', icon: 'brush' },
  push: { verb: '推動', posture: 'push', icon: 'push' },
  play: { verb: '玩耍', posture: 'reach', icon: 'sparkle' },
};

/**
 * Which side of the piece an ACTING posture is played from.
 *
 *   `front`    the piece's own local +Z face — the front of every model in this catalog. What
 *              a fridge, a hob, a sink, a wardrobe and a desk all want: there is one side you
 *              use them from and the rest are their back and their sides.
 *   `nearest`  whichever side the player already happens to be on. What a campfire, a well and
 *              a telescope want: they have no front, and marching the player around to an
 *              arbitrary face of them would look worse than letting them stay put.
 *
 * Note what is NOT here: how far out to stand. That is measured off the piece's own box at
 * runtime, so it is right for a 2.5-unit bed and a 0.6-unit stool without a number being typed.
 */
export type ApproachSide = 'front' | 'nearest';

/**
 * One thing a piece of furniture lets the player do.
 *
 * ### The anchor (occupying postures only)
 *
 * `surfaceY`, `lateral`, `forward` and `facing` describe the Interaction Point — the seat point,
 * the lie point, the spot in the tub — in the PIECE'S OWN LOCAL FRAME, at the scale the piece is
 * drawn. They are never world coordinates: the runtime turns them by the placement's rotation
 * and adds its position, so a sofa rotated to face any wall carries its seat around with it.
 *
 * The body's own height on that anchor is NOT stated here. It is derived from the character rig
 * (constants/characterRig.ts) by {@link poseRootHeight}, so a remodel that changes the
 * character's proportions moves every seated body in the game with it and no catalog row has to
 * be retuned. What the catalog states is a fact about the FURNITURE — where its cushion is —
 * which is measurable, checkable (`npm run audit:interactions`) and cannot go stale in silence.
 */
export interface FurnitureInteraction {
  kind: InteractionKind;
  /**
   * Overrides the kind's posture.
   *
   * The escape hatch that keeps the kind table from having to grow a row for every shade of
   * meaning: a piece whose verb is 「使用」 but whose body language is a crouch says
   * `posture: 'tend'` rather than earning a kind of its own. Use it for a piece that is unusual;
   * a kind of interaction that recurs should become a kind.
   */
  posture?: PostureId;
  /** Overrides {@link INTERACTION_KINDS}'s verb — 「觀星」 on a telescope, 「演奏」 on a piano. */
  verb?: string;
  /** Overrides the exit verb. Occupying postures only. */
  exitVerb?: string;
  /** Overrides the icon, when a shared kind wants a more specific badge. */
  icon?: InteractionIcon;
  /** Acting postures only: which face of the piece it is used from. Defaults to `front`. */
  approach?: ApproachSide;
  /**
   * Occupying postures only, and required for them: the height of the surface the body rests
   * on — a cushion's top face, a mattress's top face, a hammock's fabric, a tub's inner floor —
   * measured from the piece's own base (its local y = 0, which is the floor it stands on).
   */
  surfaceY?: number;
  /**
   * Where the body sits ACROSS the piece — along the axis at right angles to the direction the
   * occupant faces. 0 is the piece's centre; for the usual `facing: 0` this is the piece's own
   * local X, which is what every row in the catalog states it in.
   */
  lateral?: number;
  /**
   * Where along the piece's local Z the body sits. + is toward the piece's local +Z.
   *
   * NOT for a posture whose legs hang over an edge (`reachFloor`) — those state
   * {@link seatFront} instead and have this DERIVED, for the reason set out there. The audit
   * fails an interaction that declares both.
   */
  forward?: number;
  /**
   * THE SEAT'S OWN FRONT LIP — the edge the legs hang over, measured along the direction the
   * occupant faces, from the piece's own origin, at the scale the piece is drawn.
   *
   * ## Why the anchor for a seat is derived from this rather than typed directly
   *
   * This character has no knee. Its leg is ONE straight segment from the hip to the sole, and
   * `poseRootHeight` puts that hip exactly ON the surface the catalog names. So a leg hanging
   * from a hip anywhere behind the seat's front edge is inside the seat — not by a little, and
   * not fixably by choosing a better angle: for any swing at all, the leg is below the top face
   * from the first millimetre, and it stays inside the piece until it has travelled forward as
   * far as the lip. That is a fact about a knee-less leg, not a tuning problem, and the leg
   * solver could not see it because the only thing it was told about the piece was how far the
   * whole BOUNDING BOX reached ahead — which is the armrests, the rocking runners, the L-sofa's
   * chaise and the camp chair's splayed frame, none of which is the cushion.
   *
   * The consequences were both visible in the game. On a deep, high seat (奢華沙發) the box
   * reached 0.26 ahead, the solver put the FOOT just past that, and the whole shin ran 47 cm
   * down through the sofa and came out of its front panel. On a piece whose box reached further
   * ahead than the leg is long (藤編單人沙發, L 型布沙發, 棉麻懶骨頭, 原木搖椅, 小型露營椅)
   * the `asin` saturated and both legs pegged STRAIGHT OUT horizontal, which is the mannequin
   * pose in five of the twelve seats in the catalog.
   *
   * So the one number the catalog states is the one thing a bounding box cannot tell us — where
   * the SEAT stops — and the body's own place on it is derived from the rig by
   * {@link seatHipInset}, exactly as its HEIGHT is already derived from `surfaceY` by
   * {@link poseRootHeight}. A remodelled character with a different build sits correctly on
   * every seat in the game without a catalog row being retyped; a redrawn sofa needs one number
   * re-measured, and `npm run audit:interactions` says so when it does not match the model.
   */
  seatFront?: number;
  /**
   * The body's yaw RELATIVE to the piece's own rotation, radians.
   *
   * 0 means the player faces the piece's local +Z, which is the front of every model in this
   * catalog (a sofa's backrest and a bed's headboard are both at -Z). A lying body extends
   * BACKWARDS from its anchor — the root origin is at the feet — so a bed whose headboard is at
   * -Z wants `facing: 0` and an anchor toward the foot of the mattress. A bathtub is long in X
   * and shallow in Z, so its occupant is turned a quarter turn to lie along it.
   */
  facing?: number;
  /**
   * Lie only: how far the body settles INTO the surface, 0..1. A hammock's fabric sags around
   * whoever is in it (~0.8); a mattress compresses a little (~0.25); a bench does not give at
   * all (0). Scales the body's own half-thickness — see {@link poseRootHeight}.
   */
  give?: number;
  /**
   * The piece MOVES under whoever is on it, and which way it moves.
   *
   * This was `sway?: boolean` — "rock the occupant a bit" — and the boolean is why the hammock
   * was never actually in sync with itself. A flag can say THAT something moves; it cannot say
   * how far, how fast, about what pivot, or for how long after the rider leaves, so the numbers
   * ended up written into the one file that happened to need them (Three/Avatar.tsx nudged the
   * BODY on a `sin(t * 1.5)` in WORLD space, while the hammock's own model did not move at all —
   * so a hammock rotated in build mode rocked its occupant sideways across the cloth).
   *
   * It now names a row in constants/outdoorAnimation.ts, and the model, the character controller
   * and the exit all resolve the same row. A bed still says nothing and still does not move.
   */
  sway?: SuspendedMotionId;
  /**
   * How far outside the piece's measured collision box the player may stand and still be
   * offered this, in world units. Defaults to {@link DEFAULT_INTERACTION_REACH}.
   */
  reach?: number;
}

/**
 * Distance from the piece's own measured box, not from its centre — so one number works for a
 * 2.5-unit bed and a 0.6-unit chair, and goes on working when either is rotated.
 *
 * Roughly an arm's length past where the player is stopped by the piece (they collide at
 * PLAYER_PHYSICAL_RADIUS, 0.35), so walking up to something puts you in range of it and
 * stepping away drops you out of it.
 */
export const DEFAULT_INTERACTION_REACH = 0.9;

/** How high above the piece's own top face the floating prompt badge is anchored. */
export const PROMPT_ANCHOR_CLEARANCE = 0.45;

/**
 * How far clear of a piece's own box an acting posture stands, on top of the player's radius.
 *
 * Small: the point is to be AT the hob, not near it. The player's own radius already keeps the
 * body out of the collider, so this is only the gap between a shoulder and a worktop.
 */
export const ACTION_STAND_CLEARANCE = 0.12;

const NO_INTERACTIONS: readonly FurnitureInteraction[] = [];

/** Every interaction this item declares, in priority order. Empty for ordinary scenery. */
export function getFurnitureInteractions(itemId: string): readonly FurnitureInteraction[] {
  return getItemById(itemId)?.interactions ?? NO_INTERACTIONS;
}

/**
 * The one the prompt offers.
 *
 * A piece may declare several (`[sit, store]`, `[lie, sleep]`) and the data model has always
 * allowed it — what the PLAYER has is one action key, so the first entry is what that key does
 * and the rest are there for the surface that will one day offer a choice. Order in the catalog
 * is therefore meaningful: put the thing someone walking up to the piece expects first.
 */
export function getPrimaryInteraction(itemId: string): FurnitureInteraction | null {
  return getFurnitureInteractions(itemId)[0] ?? null;
}

export function hasFurnitureInteraction(itemId: string): boolean {
  return getFurnitureInteractions(itemId).length > 0;
}

/**
 * WHICH BODY this interaction puts the player in — the item's own override if it has one, else
 * the one its verb selects.
 *
 * This function replaced `interactionPose`, whose answer was `'sit' | 'lie' | null` and whose
 * `null` was the single most consequential value in the old system: it meant "this piece does
 * not move the player", which meant "play the shared arm-wave", which is why a bathtub and a
 * fridge were animated identically.
 */
export function interactionPosture(interaction: FurnitureInteraction): PostureId {
  return interaction.posture ?? INTERACTION_KINDS[interaction.kind].posture;
}

/** Does this interaction hold the player until they get up, or play once and hand them back? */
export function interactionOccupies(interaction: FurnitureInteraction): boolean {
  return getPosture(interactionPosture(interaction)).occupies;
}

/** How the body's root height comes off the anchor — see PostureAnchoring. */
export function interactionAnchoring(interaction: FurnitureInteraction): PostureAnchoring {
  return getPosture(interactionPosture(interaction)).anchoring;
}

/** Which face of the piece an acting posture is played from. */
export function interactionApproach(interaction: FurnitureInteraction): ApproachSide {
  return interaction.approach ?? 'front';
}

export function interactionVerb(interaction: FurnitureInteraction): string {
  return interaction.verb ?? INTERACTION_KINDS[interaction.kind].verb;
}

export function interactionExitVerb(interaction: FurnitureInteraction): string {
  return interaction.exitVerb ?? INTERACTION_KINDS[interaction.kind].exitVerb ?? '離開';
}

export function interactionIcon(interaction: FurnitureInteraction): InteractionIcon {
  return interaction.icon ?? INTERACTION_KINDS[interaction.kind].icon;
}

// ---------------------------------------------------------------------------
// THE BODY ON THE FURNITURE — derived from the rig, never typed into the catalog
// ---------------------------------------------------------------------------

/**
 * How far a lying body's head sits ABOVE horizontal, radians — and why the recline is not a flat
 * quarter turn.
 *
 * This character is a chibi: the skull is 0.26 across against a 0.135 body, so a body laid
 * perfectly flat rests its torso on the mattress and buries a third of its head in it. The
 * amount of lift that fixes that is not a taste call — it is exactly the difference between the
 * two radii, seen from the head joint — so it is computed rather than tuned, and a model with a
 * smaller head automatically lies flatter.
 *
 * The hammock's hand-tuned pitch (-PI/2.1, 85.7 deg) was this same idea applied by eye to one
 * piece of furniture. On the legacy skeleton this returns 79.7 deg, which raises that hammock's
 * head by ~10cm and is the whole visible difference.
 */
export function lieHeadRise(skeleton: CharacterSkeleton): number {
  // Scale-free: every term is LOCAL, so `toWorld` would cancel out of the ratio.
  const excess = skeleton.head.crownRise - skeleton.torso.halfWidth;
  return Math.asin(Math.max(0, Math.min(0.5, excess / skeleton.head.y)));
}

/** The body's pitch while lying — negative tips the chest backwards. See {@link lieHeadRise}. */
export function liePitch(skeleton: CharacterSkeleton): number {
  return -(Math.PI / 2 - lieHeadRise(skeleton));
}

/**
 * Where the character's ROOT ORIGIN — its ground contact point, see constants/characterRig.ts —
 * has to be for the body to rest properly on a surface at `surfaceY`.
 *
 * Two different geometries, one function, because both are statements about the RIG rather than
 * about any particular piece or posture:
 *
 *   `hips`  The body's weight is on its HIP JOINT — sitting on a cushion, and sitting on the
 *           floor of a bathtub. Putting the hip on the surface puts the root exactly one
 *           hip-height below it, which is why a model with longer legs sits correctly on the
 *           same sofa without a single catalog row changing.
 *   `side`  The body is turned on its side about its own feet, so all of it ends up at the
 *           root's height and what rests on the surface is the body's SIDE. The root therefore
 *           rises by half the body's thickness, less however much the surface gives under it.
 *   `stand` No anchor at all: an acting posture is played on the floor the player is standing
 *           on, so the surface height is not consulted.
 */
export function poseRootHeight(
  anchoring: PostureAnchoring,
  surfaceY: number,
  skeleton: CharacterSkeleton,
  give = 0,
): number {
  if (anchoring === 'stand') return 0;
  if (anchoring === 'hips') return surfaceY - toWorld(skeleton.hip.y);
  return surfaceY + toWorld(skeleton.torso.halfWidth) * (1 - clamp01(give));
}

/**
 * How far a lying body reaches from its anchor, world units — the length that has to fit on the
 * mattress, and what `npm run audit:interactions` checks every lie point against. A shade less
 * than the character's height, because {@link lieHeadRise} holds the head a few degrees up.
 */
export function lieBodyReach(skeleton: CharacterSkeleton): number {
  const height = toWorld(skeleton.head.y + skeleton.head.crownRise - skeleton.soleY);
  return height * Math.cos(lieHeadRise(skeleton));
}

/**
 * HOW FAR BEHIND A SEAT'S FRONT LIP THE HIP JOINT GOES, world units — the whole of the
 * alignment rule for a seated body, and a rig measurement rather than a preference.
 *
 * The leg is a capsule about the hip's own axis. `hip.x` is the rig's statement of how far that
 * axis sits from the body's centreline, and on every skeleton in this project it is within a
 * couple of centimetres of the leg's own radius (legacy: hip.x 0.065 against LEG_RADIUS 0.055,
 * both LOCAL). So putting the hip ONE of these back from the lip is putting the leg's near
 * surface ON the lip: the leg grazes the seat's front face instead of crossing it, and every
 * millimetre of it below the lip is in open air.
 *
 * Any larger and the leg starts inside the piece — the bug this exists to end. Any smaller and
 * the body is perched on the very edge with nothing under its weight. The audit checks the
 * consequence rather than the number ({@link seatLegClearance} is what it hands the leg solver),
 * so a future rig where the two measurements diverge fails loudly instead of quietly clipping.
 */
export function seatHipInset(skeleton: CharacterSkeleton): number {
  return toWorld(skeleton.hip.x);
}

/**
 * WHERE ON THE PIECE THE BODY GOES, in the piece's own local frame — one function, so that
 * "the catalog says it" and "the rig says it" cannot be answered differently in two places.
 *
 * A seat whose legs hang over an edge states {@link FurnitureInteraction.seatFront} and has its
 * anchor derived; everything else states `forward` and keeps it. `lateral` is the same in both:
 * the position ACROSS the piece.
 *
 * The projection is written out in full rather than assuming `facing: 0` — the frame the anchor
 * is stated in is the OCCUPANT'S, so a seat turned to face along the piece's local X (nothing in
 * the catalog does today; a corner unit would) resolves without this function changing.
 */
export function interactionAnchorLocal(
  interaction: FurnitureInteraction,
  skeleton: CharacterSkeleton,
): { x: number; z: number } {
  const lateral = interaction.lateral ?? 0;
  if (interaction.seatFront === undefined) {
    return { x: lateral, z: interaction.forward ?? 0 };
  }
  const facing = interaction.facing ?? 0;
  const along = interaction.seatFront - seatHipInset(skeleton);
  // facing 0 gives (x, z) = (lateral, along), which is what every existing row means.
  return {
    x: Math.sin(facing) * along + Math.cos(facing) * lateral,
    z: Math.cos(facing) * along - Math.sin(facing) * lateral,
  };
}

/**
 * What the leg solver has to clear — the distance from the anchor to the lip the legs hang
 * over, or null for an interaction that never declared one.
 *
 * By construction this is exactly {@link seatHipInset}: the anchor was derived by stepping back
 * from the lip by it. It is a function rather than a constant at the call site so that the
 * relationship stays visible — the leg is cleared against the SEAT, and the seat is where the
 * catalog says it is, never where the bounding box happens to end.
 */
export function seatLegClearance(
  interaction: FurnitureInteraction,
  skeleton: CharacterSkeleton,
): number | null {
  return interaction.seatFront === undefined ? null : seatHipInset(skeleton);
}

/**
 * How far a body sitting on an anchor reaches AHEAD of it, world units — hip joint to sole,
 * with the legs straight out.
 *
 * The bathtub check: a body whose legs extend forward has to have somewhere to put them, and
 * `npm run audit:interactions` uses this to confirm the feet land inside the tub rather than
 * through its far end.
 */
export function seatedLegReach(skeleton: CharacterSkeleton): number {
  return toWorld(skeleton.hip.y - skeleton.soleY);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
