/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PlacedItem } from '../types';
import type { CharacterSkeleton } from '../constants/characterRig';
import { toWorld } from '../constants/characterRig';
import type { PostureId } from '../constants/interactionPostures';
import { getItemById, isStandableItem } from '../constants/items';
import { getPosture } from '../constants/interactionPostures';
import type { SuspendedMotionId } from '../constants/outdoorAnimation';
import { type OccupantFit, fitOccupant, fitRootY } from './occupantFit';
import {
  ACTION_STAND_CLEARANCE,
  DEFAULT_INTERACTION_REACH,
  FurnitureInteraction,
  getPrimaryInteraction,
  interactionAnchoring,
  interactionApproach,
  interactionExitVerb,
  interactionIcon,
  interactionAnchorLocal,
  interactionOccupies,
  interactionPosture,
  interactionVerb,
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
 * And a fourth, which the prompt needs:
 *
 *   4. Where does the interaction HAPPEN?                {@link resolveInteractionPoint}
 *
 * This module is deliberately the only place that knows how a local anchor becomes a world
 * position. Three/Avatar.tsx drives the body from what it returns and never does the maths
 * itself; Three/InteractionPromptTracker.tsx points the badge at what it returns and never
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
   * WHERE THE BODY GOES ON THE PIECE, solved from the rig's body volumes (lib/occupantFit.ts) —
   * the pivot it is fastened at, how its legs hang, what its hands hold. Null for a posture played
   * standing at the piece.
   *
   * Solved HERE, once per description, because it is the one place that has the placement, the
   * catalog row and the skeleton together; the controller then only has to turn it into a pose
   * each frame (`resolveOccupantPose`). When this is set, {@link x}/{@link z} are the pivot's and
   * {@link y} is the root's height with the body upright on it.
   */
  fit: OccupantFit | null;
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
   * Set when the piece MOVES under its occupant — a hammock, a swing — naming the row of
   * constants/outdoorAnimation.ts it moves by. Null for everything else.
   *
   * The controller evaluates that row with the ONE function the piece's own model evaluates too
   * (lib/outdoorMotion.ts's `suspendedAngle`) and hands the angle to `resolveOccupantPose`, which
   * carries the body's pivot through the piece's own swing — so the two cannot disagree.
   */
  motion: { id: SuspendedMotionId } | null;
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
  /**
   * THE INTERACTION POINT — where on the piece the interaction happens, in world space: the
   * cushion a seat is taken on, the middle of the mattress, the face of the wardrobe its doors
   * are on. The prompt's arrow points here. See {@link resolveInteractionPoint}.
   */
  interactionPoint: { x: number; y: number; z: number };
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
const UNMEASURED_POINT_HEIGHT = 1.0;

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
 *                   set it down on a deck, and the seat goes with it. Where the body goes ON
 *                   that anchor is not the catalog's to choose: the catalog says where the
 *                   cushion is; the rig's body volumes say how a body rests on a cushion
 *                   (lib/occupantFit.ts).
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
  const elevation = placement.position[1] || 0;
  // WHERE THE BODY GOES: the catalog says where the cushion, the lip, the ropes are; the rig's
  // body volumes say where a body rests on them. See lib/occupantFit.ts.
  const posture = getPosture(interactionPosture(interaction));
  const fit = fitOccupant({
    posture: interactionPosture(interaction),
    skeleton,
    origin: { x: placement.position[0], y: elevation, z: placement.position[2] },
    pieceYaw: rotation,
    anchor: interactionAnchorLocal(interaction),
    surfaceY: interaction.surfaceY ?? 0,
    facing: interaction.facing ?? 0,
    overEdge: interaction.seatFront !== undefined
      && (posture.legs === 'reachFloor' || posture.legs === 'dangle'),
    give: interaction.give,
    headLift: interaction.headRest !== undefined && interaction.surfaceY !== undefined
      ? Math.max(0, interaction.headRest - interaction.surfaceY)
      : 0,
    grip: interaction.grip ?? null,
  });

  const spot: InteractionSpot = {
    x: fit.pivot.x,
    y: fitRootY(fit),
    z: fit.pivot.z,
    yaw: rotation + (interaction.facing ?? 0),
    anchored: true,
    fit,
    exitYaw: 0,
    exitReach: 0,
    motion: interaction.sway ? { id: interaction.sway } : null,
  };
  spot.exitYaw = spot.yaw + (posture.exitFacing ?? 0);
  spot.exitReach = measureReachAhead(placement, spot.x, spot.z, spot.exitYaw);
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
      fit: null,
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
    // Nothing to fit and nowhere to dismount to: the body never left the floor.
    fit: null,
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

  const spot = resolveInteractionSpot(placement, interaction, skeleton, from);

  return {
    instanceId: placement.instanceId,
    itemId: placement.itemId,
    itemName: item.name,
    placement,
    interaction,
    posture: interactionPosture(interaction),
    occupies: interactionOccupies(interaction),
    spot,
    interactionPoint: resolveInteractionPoint(placement, interaction, spot, skeleton),
    verb: interactionVerb(interaction),
    exitVerb: interactionExitVerb(interaction),
    icon: interactionIcon(interaction),
    distance,
  };
}

/**
 * WHERE THE INTERACTION HAPPENS — the point the prompt's arrow lands on.
 *
 * ## What it replaced
 *
 * The piece's measured TOP, over the centre of its box, plus 0.45. That is a fine place for a
 * name tag and the wrong place for an instruction: 「E 打開」 floated half a metre over a 2 m
 * wardrobe rather than on its doors, 「E 躺下」 hung over the middle of a bed's headboard end
 * rather than over the mattress, and a sofa's badge was over the backrest. The badge now says
 * where to act as well as what to do.
 *
 * ## Three answers, chosen by the posture's own anchoring rule
 *
 *   `hips`   (sit, bathe, swing)  the pivot the body is fastened at — on the cushion, in the
 *            tub, on the plank — at the height of the surface it rests on.
 *   `side`   (lie, rest)          the MIDDLE of where the body will lie. The anchor is at the
 *            soles (a lying body extends back from its feet), so the point walks back along the
 *            body's own axis to level with the piece's centre, never further than the body
 *            reaches. A bed's point lands on the mattress, not at its foot.
 *   `stand`  (everything acted AT) the face of the piece the body stands at, at the height the
 *            hands work at — the player's own shoulder, clamped into the piece's measured height
 *            band. A wardrobe gets its doors, a hob its front edge, a campfire the rim on the
 *            player's side, and a deck the player is standing ON gets the edge they will look
 *            out over.
 *
 * Everything here is measured (the footprint, the rig) — nothing is typed per item, so a redrawn
 * model or a remodelled character moves the point with it.
 */
export function resolveInteractionPoint(
  placement: PlacedItem,
  interaction: FurnitureInteraction,
  spot: InteractionSpot | null,
  skeleton: CharacterSkeleton,
): { x: number; y: number; z: number } {
  const fp = getFootprint(placement.itemId);
  const elevation = placement.position[1] || 0;
  if (!fp || !spot) {
    return { x: placement.position[0], y: elevation + UNMEASURED_POINT_HEIGHT, z: placement.position[2] };
  }
  const rotation = placement.rotation || 0;
  const box = makeObb(fp, placement.position[0], placement.position[2], rotation);
  const forwardX = Math.sin(spot.yaw);
  const forwardZ = Math.cos(spot.yaw);

  if (spot.anchored) {
    // The catalog's own anchor — the seat's front lip, the spot in the tub, the plank — turned and
    // placed by the piece's transform (the same convention as every box here). NOT `spot`, which is
    // where the body's root goes: for a seat that is out in front of the lip, off the cushion.
    const local = interactionAnchorLocal(interaction);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const ax = placement.position[0] + local.x * cos + local.z * sin;
    const az = placement.position[2] - local.x * sin + local.z * cos;
    const surfaceY = elevation + (interaction.surfaceY ?? fp.maxY);
    if (interactionAnchoring(interaction) !== 'side') {
      return { x: ax, y: surfaceY, z: az };
    }
    // Lying: the anchor is at the feet and the head lies BEHIND it, along the occupant's facing.
    // Walk back along the body toward the piece's centre, never further than the body reaches.
    const bodyLength = toWorld(skeleton.head.y - skeleton.soleY);
    const along = Math.min(
      bodyLength,
      Math.max(0, -((box.cx - ax) * forwardX + (box.cz - az) * forwardZ)),
    );
    return { x: ax - forwardX * along, y: surfaceY, z: az - forwardZ * along };
  }

  // Standing at the piece: the body faces INTO it, so the face it uses is back along its heading
  // — unless it is standing on the piece, in which case it faces OUT over the edge it will use.
  const onPiece = isStandableItem(placement.itemId)
    && footprintContainsPoint(
      fp, placement.position[0], placement.position[2], placement.rotation || 0, spot.x, spot.z,
    );
  const dirX = onPiece ? forwardX : -forwardX;
  const dirZ = onPiece ? forwardZ : -forwardZ;
  // Where a ray from the box's centre along that direction leaves the box — a point ON the face,
  // whatever angle a `nearest` piece is approached from.
  const du = Math.abs(dirX * box.ux + dirZ * box.uz);
  const dv = Math.abs(dirX * box.vx + dirZ * box.vz);
  const out = Math.min(du > 1e-9 ? box.halfW / du : Infinity, dv > 1e-9 ? box.halfD / dv : Infinity);
  const handY = toWorld(skeleton.shoulder.y);
  return {
    x: box.cx + dirX * out,
    y: elevation + Math.min(fp.maxY, Math.max(fp.minY, handY)),
    z: box.cz + dirZ * out,
  };
}

/**
 * One piece in reach, as {@link collectInteractablesInReach} reports it. Reused between frames by
 * the caller, so the per-frame scan allocates nothing once the pool has grown.
 */
export interface ReachHit {
  placement: PlacedItem;
  /** Distance from the player to the piece's walk box (0 inside it). */
  distance: number;
  /** The piece's own reach. */
  reach: number;
  /** The point of the piece's box nearest the player — what targeting measures facing to. */
  aimX: number;
  aimZ: number;
}

/**
 * EVERY piece the player at `(x, z)` may act on, into `out`; returns how many.
 *
 * ## Why every piece, and not the nearest
 *
 * This used to return one: the nearest box, and on a tie the first in the save. Between two
 * pieces — a player at the gap between a bed and its nightstand, or at the corner where the hob
 * meets the fridge — both boxes are at arm's length and the player's intent is decided by which
 * way they face, which this function cannot see. Choosing here made that impossible to fix
 * downstream: the prompt never learned the second piece existed. Choosing is now
 * lib/interactionTargeting.ts's job, with facing in hand; this reports the field.
 *
 * Reach is still measured to the piece's BOX rather than its centre, so a bed you are standing
 * against is in reach and a lamp across the room is not — and the piece's own
 * {@link isBehindPiece} rule still drops a seat approached from behind its backrest.
 *
 * `placements` should already be narrowed to the pieces that declare an interaction (the caller
 * memoises that list against the save); the per-frame part is distances only.
 */
export function collectInteractablesInReach(
  x: number,
  z: number,
  placements: readonly PlacedItem[],
  out: ReachHit[],
): number {
  let count = 0;

  for (const placement of placements) {
    const interaction = getPrimaryInteraction(placement.itemId);
    if (!interaction) continue;

    const reach = interaction.reach ?? DEFAULT_INTERACTION_REACH;
    const fp = getFootprint(placement.itemId);

    let distance: number;
    let aimX = placement.position[0];
    let aimZ = placement.position[2];
    if (fp) {
      // Cheap circular reject before the oriented-box test — a furnished house is mostly pieces
      // in another room, and those cost two subtractions and a compare each.
      const box = reachBox(fp);
      const dx = x - placement.position[0];
      const dz = z - placement.position[2];
      const outer = Math.hypot(box.halfW, box.halfD) + Math.hypot(box.cx, box.cz) + reach;
      if (dx * dx + dz * dz > outer * outer) continue;
      const obb = obbFor(placement, fp);
      distance = obbDistanceToPoint(obb, x, z);
      if (distance > reach) continue;
      // Nearest point of the box: clamp the player into it in the box's own frame.
      const rx = x - obb.cx;
      const rz = z - obb.cz;
      const u = Math.max(-obb.halfW, Math.min(obb.halfW, rx * obb.ux + rz * obb.uz));
      const v = Math.max(-obb.halfD, Math.min(obb.halfD, rx * obb.vx + rz * obb.vz));
      aimX = obb.cx + u * obb.ux + v * obb.vx;
      aimZ = obb.cz + u * obb.uz + v * obb.vz;
    } else {
      distance = Math.hypot(x - placement.position[0], z - placement.position[2]) - UNMEASURED_REACH;
      if (distance > reach) continue;
    }

    if (interactionOccupies(interaction) && isBehindPiece(placement, interaction, x, z)) continue;

    const hit = out[count] ?? (out[count] = { placement, distance: 0, reach: 0, aimX: 0, aimZ: 0 });
    hit.placement = placement;
    hit.distance = Math.max(0, distance);
    hit.reach = reach;
    hit.aimX = aimX;
    hit.aimZ = aimZ;
    count++;
  }

  return count;
}

const NEAREST_SCRATCH: ReachHit[] = [];

/**
 * The single nearest piece in reach, by box distance, or null. Kept for callers that only need
 * "is anything usable here" — audits and tests. The game's own targeting does NOT use this: the
 * nearest box is not necessarily the piece the player means (see
 * {@link collectInteractablesInReach}).
 */
export function findNearbyInteractable(
  x: number,
  z: number,
  placements: readonly PlacedItem[],
): PlacedItem | null {
  const count = collectInteractablesInReach(x, z, placements, NEAREST_SCRATCH);
  let best: ReachHit | null = null;
  for (let i = 0; i < count; i++) {
    const hit = NEAREST_SCRATCH[i];
    if (!best || hit.distance < best.distance) best = hit;
  }
  return best?.placement ?? null;
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
 * The nearest piece, with the answer already described. For callers that ask once — tests and
 * audits. The game describes each piece in reach once, when it comes into reach (Three/Avatar.tsx),
 * and lets lib/interactionTargeting.ts choose among them.
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
