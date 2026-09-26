/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PlacedItem } from '../types';
import type { CharacterSkeleton } from '../constants/characterRig';
import type { PostureId } from '../constants/interactionPostures';
import { getItemById, isStandableItem } from '../constants/items';
import { getPosture } from '../constants/interactionPostures';
import { SUSPENDED_MOTIONS, type SuspendedMotionId } from '../constants/outdoorAnimation';
import {
  ACTION_STAND_CLEARANCE,
  DEFAULT_INTERACTION_REACH,
  FurnitureInteraction,
  PROMPT_ANCHOR_CLEARANCE,
  getPrimaryInteraction,
  interactionAnchoring,
  interactionApproach,
  interactionExitVerb,
  interactionIcon,
  interactionAnchorLocal,
  interactionOccupies,
  interactionPosture,
  interactionVerb,
  poseRootHeight,
  seatLegClearance,
} from '../constants/furnitureInteractions';
import { PLAYER_PHYSICAL_RADIUS } from '../utils/placementRules';
import {
  Footprint,
  Obb2,
  footprintContainsPoint,
  getFootprint,
  makeObb,
  obbDistanceToPoint,
  obbProjectedRadius,
} from './furniturePlacement';

/**
 * THE FURNITURE INTERACTION RUNTIME — turning a piece's declared capability
 * (constants/furnitureInteractions.ts) into three world-space answers:
 *
 *   1. Is the player near enough to be offered it?      {@link findNearbyInteraction}
 *   2. Where exactly does the body go?                  {@link resolveInteractionSpot}
 *   3. Where does the body step off to afterwards?      {@link resolveExitTarget}
 *
 * All three read the piece's MEASURED box (lib/furniturePlacement.ts) rather than any typed-in
 * size, which is what lets one reach distance serve a 2.5-unit bed and a 0.6-unit chair, and
 * what keeps every answer correct when the player rotates a piece in build mode.
 *
 * Question 2 now has an answer for EVERY interaction, which it did not use to. A piece with no
 * body pose returned `spot: null`, the controller read that as "the body does not move", and the
 * player performed 泡澡 from wherever they happened to be standing when they pressed E — beside
 * the bath, facing roughly at it. An acting posture now resolves a STAND spot: just clear of the
 * piece's own box, on the face it is used from, squared up to it. Nothing about that is typed
 * into the catalog beyond which face (see ApproachSide); the distance is measured.
 *
 * This module is deliberately the only place that knows how a local anchor becomes a world
 * position. Three/Avatar.tsx drives the body from what it returns and never does the maths
 * itself; Three/InteractionPromptTracker.tsx floats the badge over what it returns and never
 * learns what a sofa is.
 */

/** Where the body goes, in world space. */
export interface InteractionSpot {
  x: number;
  y: number;
  z: number;
  /** Body yaw, radians — the same convention as Avatar's `rotation.current`. */
  yaw: number;
  /**
   * Whether {@link y} is a real height the body must be driven to.
   *
   * True for a posture that puts the body ON the piece — the root height is the whole point of
   * a seat. False for one played standing, where the body keeps the ground height the
   * controller already has for it and this field is 0. Without the distinction, walking up to a
   * hob would drop the player through the floor.
   */
  anchored: boolean;
  /**
   * How far the piece's own measured box still reaches AHEAD of this spot, along the direction
   * the occupant faces.
   *
   * The one thing a seated pose cannot work out for itself. A chibi's legs are 0.53 long against
   * a sofa 1.15 deep, so "hang the legs down until the feet reach the floor" puts both shins
   * inside the cushion; the legs have to swing out far enough to clear the piece's own front
   * edge, and how far that is depends on the piece. Measured here (where the footprint is), used
   * by lib/interactionPosture.ts's leg solver, so no seat angle is ever typed into the catalog.
   */
  reachAhead: number;
  /**
   * The heading a dismount steps along, and how far the piece reaches along it.
   *
   * Usually the way the body is already facing — you stand up out of a chair forwards. A posture
   * may offer a different one (`exitFacing`), and a bathtub is the case that needs it: its
   * occupant faces down the length of the tub, so "step forward" would wade two and a half
   * metres out over the taps instead of stepping over the side.
   *
   * Measured HERE rather than in {@link resolveExitTarget} because the piece's placement — which
   * is what the box has to be turned by — is only in scope at resolve time.
   */
  exitYaw: number;
  exitReach: number;
  /**
   * Set when the piece MOVES under its occupant — a hammock, a swing. Null for everything else.
   *
   * Resolved here for the same reason `reachAhead` is: this is the one place that has both the
   * piece's placement (where its pivot ended up in the world, and which way it is turned) and
   * the body's own resolved root height. The controller then evaluates ONE function
   * (lib/outdoorMotion.ts's `suspendedAngle`) that the piece's own model evaluates too, and the
   * two cannot disagree.
   */
  motion: OccupantMotion | null;
}

/** Everything the character controller needs to ride a moving piece of furniture. */
export interface OccupantMotion {
  id: SuspendedMotionId;
  /**
   * The pendulum arm the BODY rides: pivot down to the body's own root, world units.
   *
   * Not the same as the spec's `length` (which is pivot-to-seat and sets the period): a body
   * sitting on a swing has its root at its feet, further from the pivot than the seat is, so it
   * travels further along the same arc. Getting this wrong is exactly how a rider slides off the
   * seat at the ends of the swing.
   */
  radius: number;
  /** The piece's own yaw, so a sway stated in its local frame becomes a world offset. */
  pieceYaw: number;
}

/** A piece the player is close enough to act on, and everything the act needs. */
export interface InteractionTarget {
  instanceId: string;
  itemId: string;
  itemName: string;
  /**
   * The placement this was described from — carried so that a caller holding a target can ask a
   * follow-up question about the same piece (where to stand to get on it: see
   * {@link resolveEntryPoint}) without having to find the placement again in the save.
   */
  placement: PlacedItem;
  interaction: FurnitureInteraction;
  /** The whole-body posture it puts the player in. Never null — see interactionPosture. */
  posture: PostureId;
  /** Whether the player stays in it until they get up. */
  occupies: boolean;
  /** Where the body goes. Null only when the piece has never been measured. */
  spot: InteractionSpot | null;
  /** World point the floating prompt hangs above: the top of the piece, plus clearance. */
  promptAnchor: { x: number; y: number; z: number };
  /** 「坐下」/「躺下」/「泡澡」 — already resolved, so no screen re-derives it. */
  verb: string;
  /** 「起身」 — what the prompt offers once the player is on the piece. */
  exitVerb: string;
  icon: ReturnType<typeof interactionIcon>;
  /** Distance from the player to the piece's own box, 0 while standing against it. */
  distance: number;
}

/**
 * How far outside the piece a dismount steps, on top of clearing the piece's own box and the
 * player's radius. Enough to read as "stood up and stepped away" rather than as sliding out
 * through the arm of the sofa.
 */
const EXIT_MARGIN = 0.25;

/**
 * Reach and prompt height for a piece whose model has never mounted, so nothing has measured it.
 * Only reachable for one frame (the first mount measures it and `subscribeFootprints` re-runs
 * whoever asked), and generous rather than mean: failing to offer an interaction is worse than
 * offering it from slightly too far away.
 */
const UNMEASURED_REACH = 1.4;
const UNMEASURED_PROMPT_HEIGHT = 1.3;

/** The box a piece is approached against: what a walking body runs into, or its full extent. */
function reachBox(fp: Footprint): { cx: number; cz: number; halfW: number; halfD: number } {
  return fp.walk ?? fp;
}

/**
 * Where the body goes for this interaction, in world space.
 *
 * Two shapes of answer, chosen by the posture's own anchoring rule rather than by anything the
 * catalog says twice:
 *
 *   ON the piece    the anchor is stated in the piece's own frame, turned by the piece's own
 *                   rotation using the same convention as every other box in the placement
 *                   system (three.js rotates about +Y as x' = x·cos + z·sin, z' = -x·sin +
 *                   z·cos), and lifted by the piece's own elevation. Move the sofa, turn it, or
 *                   set it down on a deck, and the seat goes with it. The HEIGHT is not the
 *                   catalog's to choose — see poseRootHeight. The catalog says where the cushion
 *                   is; the rig says how a body rests on a cushion.
 *   AT the piece    {@link resolveStandSpot} — measured, not declared.
 *
 * `from` is where the player is now, and is only consulted by an `approach: 'nearest'` piece
 * (a campfire has no front to walk round to). Omitting it makes such a piece behave as `front`,
 * which is the right answer for a caller that has no player — an audit, or a test.
 */
export function resolveInteractionSpot(
  placement: PlacedItem,
  interaction: FurnitureInteraction,
  skeleton: CharacterSkeleton,
  from?: { x: number; z: number },
): InteractionSpot | null {
  const anchoring = interactionAnchoring(interaction);
  if (anchoring === 'stand') return resolveStandSpot(placement, interaction, from);

  const rotation = placement.rotation || 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  // Where on the piece the body goes — the catalog's own numbers for a lying or reclining
  // posture, derived from the seat's front lip for one whose legs hang over it. One function,
  // in constants/furnitureInteractions.ts, so the anchor and the leg clearance below cannot
  // come from two different ideas of where the seat is.
  const { x: lateral, z: forward } = interactionAnchorLocal(interaction, skeleton);

  const spot: InteractionSpot = {
    x: placement.position[0] + lateral * cos + forward * sin,
    y: (placement.position[1] || 0)
      + poseRootHeight(anchoring, interaction.surfaceY ?? 0, skeleton, interaction.give),
    z: placement.position[2] - lateral * sin + forward * cos,
    yaw: rotation + (interaction.facing ?? 0),
    anchored: true,
    reachAhead: 0,
    exitYaw: 0,
    exitReach: 0,
    motion: null,
  };
  /*
   * WHAT THE LEGS HAVE TO CLEAR, and why it is no longer the bounding box.
   *
   * A seat that declares its own front lip hands the leg solver the distance to THAT, which is
   * a constant (the hip was placed one leg-thickness behind it). Measuring the box instead —
   * which is all this could do before — measured the armrests, the rocking runners, the
   * L-sofa's chaise and the camp chair's splayed frame, and produced two different wrong
   * answers depending on which was bigger: a shin driven down through the cushion, or both legs
   * pegged out horizontal. See FurnitureInteraction.seatFront.
   *
   * A piece with no lip declared keeps the measured answer. That is only reachable for a
   * posture that does not hang its legs over anything (a bath, a hammock, a bed), where what
   * the box says is either unused or right.
   */
  spot.reachAhead = seatLegClearance(interaction, skeleton)
    ?? measureReachAhead(placement, spot.x, spot.z, spot.yaw);
  spot.exitYaw = spot.yaw + (getPosture(interactionPosture(interaction)).exitFacing ?? 0);
  spot.exitReach = measureReachAhead(placement, spot.x, spot.z, spot.exitYaw);

  // A piece that swings under its rider. `pivotY` is stated in the piece's own frame at the
  // scale it is drawn (the same convention as `surfaceY`), so lifting it by the placement's own
  // elevation is all it takes for a hammock slung on a deck to swing about the right line.
  if (interaction.sway) {
    const spec = SUSPENDED_MOTIONS[interaction.sway];
    spot.motion = {
      id: interaction.sway,
      radius: (placement.position[1] || 0) + spec.pivotY - spot.y,
      pieceYaw: rotation,
    };
  }
  return spot;
}

/**
 * Where the body STANDS to act on a piece — the answer that did not exist before, and the reason
 * 泡澡 used to be performed from beside the bath.
 *
 * Everything but the choice of face is measured: the piece's own box is projected onto the
 * approach heading, and the body is put that far out plus its own radius plus a hand's clearance,
 * squared up to the piece. So a wardrobe and a microwave are both stood at correctly, and either
 * one goes on being stood at correctly after its model is redrawn — which a typed offset would
 * not survive.
 *
 * Returns null for a piece nothing has measured yet. The caller reads that as "do not move the
 * body", which is exactly the old behaviour and a reasonable single frame of it.
 */
function resolveStandSpot(
  placement: PlacedItem,
  interaction: FurnitureInteraction,
  from?: { x: number; z: number },
): InteractionSpot | null {
  const fp = getFootprint(placement.itemId);
  if (!fp) return null;
  const box = obbFor(placement, fp);

  /*
   * ALREADY ON IT — the case a "stand beside the piece" rule cannot express, and the one that
   * made 小型觀景平台 contradict its own description.
   *
   * A standable piece is GROUND: the player walks up onto it, and its interaction is something
   * you do FROM up there. Resolving a stand spot the usual way measures the piece's own box and
   * puts the body just outside it, which for a deck means stepping off the deck — so 眺望風景
   * dragged the player down onto the grass before playing the "look out at the view" pose, on a
   * piece whose whole point is the view from on top of it.
   *
   * So a body already standing on the piece keeps its place, and only turns to face OUT — away
   * from the piece's centre, which on a three-sided deck is the open side. Nothing else needs to
   * change: the posture is played standing, and the height the body is at is the floor the walk
   * resolve already put it on (lib/placementSurfaces.ts), not something this function chooses.
   */
  if (from && isStandableItem(placement.itemId)
    && footprintContainsPoint(
      fp, placement.position[0], placement.position[2], placement.rotation || 0, from.x, from.z,
    )) {
    const awayX = from.x - box.cx;
    const awayZ = from.z - box.cz;
    const away = Math.hypot(awayX, awayZ);
    // Dead centre has no "out" to face; the piece's own front is the one direction always defined.
    const outX = away < 1e-4 ? Math.sin(placement.rotation || 0) : awayX / away;
    const outZ = away < 1e-4 ? Math.cos(placement.rotation || 0) : awayZ / away;
    return {
      x: from.x,
      z: from.z,
      y: 0,
      yaw: Math.atan2(outX, outZ),
      anchored: false,
      reachAhead: 0,
      exitYaw: Math.atan2(outX, outZ),
      exitReach: 0,
      motion: null,
    };
  }

  // The outward direction: the piece's own +Z face, or the side the player is already on.
  let dirX: number;
  let dirZ: number;
  if (interactionApproach(interaction) === 'nearest' && from) {
    dirX = from.x - box.cx;
    dirZ = from.z - box.cz;
    const length = Math.hypot(dirX, dirZ);
    // Standing exactly on the centre of a piece gives no direction to normalise; fall through to
    // its front, which is always defined.
    if (length < 1e-4) {
      dirX = Math.sin(placement.rotation || 0);
      dirZ = Math.cos(placement.rotation || 0);
    } else {
      dirX /= length;
      dirZ /= length;
    }
  } else {
    dirX = Math.sin(placement.rotation || 0);
    dirZ = Math.cos(placement.rotation || 0);
  }

  const standOff = obbProjectedRadius(box, dirX, dirZ)
    + PLAYER_PHYSICAL_RADIUS + ACTION_STAND_CLEARANCE;
  // Facing back INTO the piece: the body is squared up to the thing it is using.
  const yaw = Math.atan2(-dirX, -dirZ);

  return {
    x: box.cx + dirX * standOff,
    y: 0,
    z: box.cz + dirZ * standOff,
    yaw,
    anchored: false,
    // Nothing to clear and nowhere to dismount to: the body never left the floor.
    reachAhead: 0,
    exitYaw: yaw,
    exitReach: 0,
    // An acting posture is played standing on the ground; nothing carries the body.
    motion: null,
  };
}

/** How far `placement`'s box extends past `(x, z)` along the heading `yaw`. */
function measureReachAhead(placement: PlacedItem, x: number, z: number, yaw: number): number {
  const fp = getFootprint(placement.itemId);
  if (!fp) return 0;
  const dirX = Math.sin(yaw);
  const dirZ = Math.cos(yaw);
  const box = obbFor(placement, fp);
  return Math.max(
    0,
    obbProjectedRadius(box, dirX, dirZ) - ((x - box.cx) * dirX + (z - box.cz) * dirZ),
  );
}

/**
 * Where the player ends up when they get off.
 *
 * Along {@link InteractionSpot.exitYaw} — usually the direction the occupant is FACING, not
 * radially away from the piece's centre, which is what the hammock used to do. A sofa's back is
 * against a wall and a bed's head is against a headboard; the one direction guaranteed to be
 * open is the one the body is already looking at, and it is also the direction a person actually
 * stands up in. A posture that gets out sideways (a bath) says so and this follows it.
 *
 * The distance clears the piece's own box along that heading (measured, so it is right for a
 * chair and for a double bed) plus the player's own radius, so the step lands them outside the
 * collider rather than inside it — the normal collision resolve then has nothing to undo.
 */
export function resolveExitTarget(itemId: string, spot: InteractionSpot): { x: number; z: number } {
  const dirX = Math.sin(spot.exitYaw);
  const dirZ = Math.cos(spot.exitYaw);
  const distance = (getFootprint(itemId) ? spot.exitReach : UNMEASURED_REACH)
    + PLAYER_PHYSICAL_RADIUS + EXIT_MARGIN;

  return { x: spot.x + dirX * distance, z: spot.z + dirZ * distance };
}

/**
 * WHERE THE BODY STANDS TO GET ON — the walk-up's destination, and the sibling of
 * {@link resolveExitTarget}.
 *
 * ## Why getting on and getting off are not the same question
 *
 * Getting OFF has one right answer per piece and the piece declares it: you stand up forwards
 * out of a chair, and out over the side of a bath. Getting ON does not. A bed is got into from
 * whichever side you walked up to; a sun lounger is got onto from its side, never by walking in
 * over the foot of it — and the foot is exactly where its dismount steps out to, because its
 * occupant lies along the piece.
 *
 * Using the dismount step as the mount's destination therefore made the two loungers WORSE
 * rather than better: the walk-up went round to the end of the piece and the settle then had to
 * travel its whole length. So this asks the question the mount actually has: of the ways out of
 * the seat, which one is SHORTEST from the seat to open air — and it prefers the side the player
 * is already standing on, because that is both the nearest way in and the one that needs no
 * detour to reach.
 *
 * ## What "shortest" buys
 *
 * The distance from the anchor out to this point is exactly how far the body travels with the
 * piece switched off as a collider, i.e. how much of the piece it passes through. Minimising it
 * is the whole job: a bed entered from its side crosses half a mattress, and entered from its
 * foot crosses 15cm, and the player standing at the foot should get the 15cm.
 *
 * The piece's own declared exit is kept as the other candidate, for the case where the player is
 * standing directly in line with the piece's long axis and "straight at the seat from here" is
 * the worst line there is.
 */
export function resolveEntryPoint(
  placement: PlacedItem,
  spot: InteractionSpot,
  from: { x: number; z: number },
): { x: number; z: number } {
  const toPlayer = Math.atan2(from.x - spot.x, from.z - spot.z);
  let bestYaw = spot.exitYaw;
  let bestOut = UNMEASURED_REACH + PLAYER_PHYSICAL_RADIUS;
  let bestCost = Infinity;
  /*
   * Four ways off the seat: the side the player is on, the piece's own declared exit, and the
   * two sides of it. The perpendiculars are what a sun lounger needs — its exit runs off the
   * FOOT (its occupant lies along the piece, so "forwards" is lengthwise), and a player standing
   * at the foot would otherwise be walked to the one spot from which getting on means traversing
   * the whole lounger. Off its side is 0.38 of piece instead of 0.74.
   */
  for (const yaw of [toPlayer, spot.exitYaw, spot.exitYaw + Math.PI / 2, spot.exitYaw - Math.PI / 2]) {
    const out = measureReachAhead(placement, spot.x, spot.z, yaw)
      + PLAYER_PHYSICAL_RADIUS + ACTION_STAND_CLEARANCE;
    const x = spot.x + Math.sin(yaw) * out;
    const z = spot.z + Math.cos(yaw) * out;
    /*
     * The trade being made. `out` is how much of the piece the body passes through once the
     * collider is switched off, and is what this is minimising; the detour is how far the player
     * has to walk round to get there, and is charged at a fraction of it because that walk is an
     * ordinary collision-resolved walk the player can watch, not a body sliding through a sofa.
     * The weight only has to break ties between sides that cross about the same amount of piece,
     * which is why it is small.
     */
    const cost = out + DETOUR_WEIGHT * Math.hypot(x - from.x, z - from.z);
    if (cost < bestCost) { bestCost = cost; bestOut = out; bestYaw = yaw; }
  }
  return { x: spot.x + Math.sin(bestYaw) * bestOut, z: spot.z + Math.cos(bestYaw) * bestOut };
}

/**
 * How much a step of walking round the piece is worth against a centimetre of being slid through
 * it. Small: passing through the furniture is the thing being paid to avoid.
 */
const DETOUR_WEIGHT = 0.05;

function obbFor(placement: PlacedItem, fp: Footprint): Obb2 {
  return makeObb(
    reachBox(fp),
    placement.position[0],
    placement.position[2],
    placement.rotation || 0,
  );
}

/** The full target record for one placement, or null if it declares no interaction. */
export function describeInteraction(
  placement: PlacedItem,
  skeleton: CharacterSkeleton,
  distance = 0,
  from?: { x: number; z: number },
): InteractionTarget | null {
  const item = getItemById(placement.itemId);
  if (!item) return null;
  const interaction = getPrimaryInteraction(placement.itemId);
  if (!interaction) return null;

  const fp = getFootprint(placement.itemId);
  const elevation = placement.position[1] || 0;
  // Anchored over the piece's own measured top rather than at a fixed height, so the badge
  // clears a wardrobe and does not float a metre over a footstool.
  const promptAnchor = fp
    ? (() => {
      const box = obbFor(placement, fp);
      return { x: box.cx, y: elevation + fp.maxY + PROMPT_ANCHOR_CLEARANCE, z: box.cz };
    })()
    : {
      x: placement.position[0],
      y: elevation + UNMEASURED_PROMPT_HEIGHT,
      z: placement.position[2],
    };

  return {
    instanceId: placement.instanceId,
    itemId: placement.itemId,
    itemName: item.name,
    placement,
    interaction,
    posture: interactionPosture(interaction),
    occupies: interactionOccupies(interaction),
    spot: resolveInteractionSpot(placement, interaction, skeleton, from),
    promptAnchor,
    verb: interactionVerb(interaction),
    exitVerb: interactionExitVerb(interaction),
    icon: interactionIcon(interaction),
    distance,
  };
}

/**
 * The single nearest piece the player at `(x, z)` may act on, or null when nothing is in reach.
 *
 * ONE target at a time, which is the rule the prompt already applies to everything else it can
 * point at (Three/InteractionPromptTracker.tsx): the player has one action key, so two things
 * offering themselves at once is a coin toss they cannot see. Ranking by distance to the piece's
 * BOX rather than to its centre is what makes "the nearest one" mean what it looks like — with
 * centre distances a bed you are standing against loses to a lamp across the room.
 *
 * `placements` should already be narrowed to the pieces that declare an interaction (the caller
 * memoises that list against the save, since it only changes when furniture is placed or taken
 * up) — this runs every frame and the per-frame part of it is deliberately only the distances.
 */
export function findNearbyInteractable(
  x: number,
  z: number,
  placements: readonly PlacedItem[],
): PlacedItem | null {
  let best: PlacedItem | null = null;
  let bestDistance = Infinity;

  for (const placement of placements) {
    const interaction = getPrimaryInteraction(placement.itemId);
    if (!interaction) continue;

    const reach = interaction.reach ?? DEFAULT_INTERACTION_REACH;
    const fp = getFootprint(placement.itemId);

    let distance: number;
    if (fp) {
      // Cheap circular reject before the oriented-box test — a furnished house is mostly pieces
      // in another room, and those cost two subtractions and a compare each.
      const box = reachBox(fp);
      const dx = x - placement.position[0];
      const dz = z - placement.position[2];
      const outer = Math.hypot(box.halfW, box.halfD) + Math.hypot(box.cx, box.cz) + reach;
      if (dx * dx + dz * dz > outer * outer) continue;
      distance = obbDistanceToPoint(obbFor(placement, fp), x, z);
    } else {
      distance = Math.hypot(x - placement.position[0], z - placement.position[2]) - UNMEASURED_REACH;
    }

    if (distance > reach || distance >= bestDistance) continue;
    if (interactionOccupies(interaction) && isBehindPiece(placement, interaction, x, z)) continue;
    bestDistance = distance;
    best = placement;
  }

  return best;
}

/**
 * How far round the BACK of a piece the player may still stand and be offered a seat on it.
 *
 * ## The bug this number ends
 *
 * Reach is measured from the piece's own BOX, so walking up to any face of a bed put you within
 * 「E 躺下」 of it — including the headboard. The anchor, though, is at the FOOT of the mattress,
 * and the mount eases the body straight toward it with collision deliberately switched off (it
 * has to be: every seat is inside its own collider — see Three/Avatar.tsx's occupancy branch).
 * So pressing E from behind the headboard slid the character THROUGH the bed, lengthwise: 3.0
 * units of it for 五星級雙人床, 3.1 for 吊床, 2.8 for 原木單人床, and something visible for
 * every other seat in the catalog.
 *
 * ## Why a half-plane rather than a path test
 *
 * The honest question is "can the body get to the anchor without crossing the piece", and the
 * honest answer is a swept test against the walk outline — per candidate, per frame, in the one
 * loop whose comment says its per-frame part is deliberately only distances.
 *
 * The cheap question that has the same answer is "is the player on the side the piece OPENS
 * onto": every occupying piece in this catalog has exactly one, it is the side the dismount
 * already steps out to (the posture's `exitFacing` plus the occupant's own `facing`), and one
 * dot product answers it with no allocation. Standing at either END of a sofa, at the side of a
 * bed or at the open mouth of a tent all land at or in front of the piece's centre and are kept;
 * standing behind the backrest, the headboard or the closed end is half a piece's depth behind
 * it and is dropped.
 *
 * The tolerance is what keeps "level with the middle of the piece" on the accepted side of the
 * line rather than on the boundary, where a centimetre of walk-resolve jitter would flicker the
 * badge on and off. It is NOT a licence to stand behind the piece: half a body radius is far
 * less than the depth of anything in the catalog.
 */
const OCCUPY_BEHIND_TOLERANCE = 0.2;

/**
 * Is the player round the back of a piece they would have to cross to get onto?
 *
 * Measured from the piece's own origin along the direction the dismount steps out — so it turns
 * with the placement, exactly like every other answer in this module, and a sofa spun to face a
 * different wall carries its approachable side round with it.
 */
function isBehindPiece(
  placement: PlacedItem,
  interaction: FurnitureInteraction,
  x: number,
  z: number,
): boolean {
  const exitYaw = (placement.rotation || 0)
    + (interaction.facing ?? 0)
    + (getPosture(interactionPosture(interaction)).exitFacing ?? 0);
  const ahead = (x - placement.position[0]) * Math.sin(exitYaw)
    + (z - placement.position[2]) * Math.cos(exitYaw);
  return ahead < -OCCUPY_BEHIND_TOLERANCE;
}

/**
 * The same search, with the answer already described.
 *
 * Deliberately NOT what the per-frame caller uses: {@link describeInteraction} builds a handful of
 * small objects, and this runs 60 times a second beside a comment (Three/Avatar.tsx's
 * `nearbyCandidates`) about how per-frame allocation in that loop is the frame stutter. The
 * controller finds the PLACEMENT every frame — which allocates nothing — and re-describes it only
 * when it changes. This wrapper is for callers that ask once: tests, audits, and anything that is
 * not inside a render loop.
 */
export function findNearbyInteraction(
  x: number,
  z: number,
  placements: readonly PlacedItem[],
  skeleton: CharacterSkeleton,
): InteractionTarget | null {
  const best = findNearbyInteractable(x, z, placements);
  return best ? describeInteraction(best, skeleton, 0, { x, z }) : null;
}
