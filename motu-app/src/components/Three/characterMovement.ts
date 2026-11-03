/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { PlacedItem, UserProfile } from '../../types';
import {
  DODECAHEDRON_INSPHERE,
  getHomeSolidHalfExtents,
  getResolvedRockPositions,
  getRockScale,
  PLAYER_PHYSICAL_RADIUS,
} from '../../utils/placementRules';
import { parseUnlockedRooms } from '../../constants/rooms';
import { INTERIOR_FLOOR_Y, buildWalkableRects, WalkRect } from '../../constants/interiorShell';
import { resolvePlayerAgainstFurniture, resolvePlayerAgainstSolids, type SolidBox } from '../../lib/furniturePlacement';
import { getSurfaceAt } from '../../lib/placementSurfaces';
import { WATER_SURFACE_Y } from '../../constants/world';
import { ResolvedHome, homeEntryDistance, HOME_ENTRY_RADIUS } from '../../hooks/usePlayerHome';
import {
  GRASS_RADIUS,
  SHORELINE_RADIUS,
  SWIMMABLE_RADIUS,
  TerrainInfo,
  getTerrainInfo,
} from '../../constants/terrain';

/**
 * Terrain/collision helpers, extracted out of Avatar.tsx's useFrame closures into
 * standalone, parameterized functions.
 *
 * The island's zone radii and `getTerrainInfo` used to be declared here and are now re-exported
 * from constants/terrain.ts — how high the ground is and how far it extends are one contract, and
 * the placement system needs it without importing the character controller. Nothing about the
 * numbers changed in the move; existing importers are unaffected.
 */

export type { TerrainInfo };
export { GRASS_RADIUS, SHORELINE_RADIUS, SWIMMABLE_RADIUS, getTerrainInfo };

/**
 * Terrain heights - as getTerrainInfo reports them - between which the in-water body pitch is
 * allowed to develop. At or above SHALLOW (the height the beach slope reaches at the visible
 * waterline) no pitch is permitted at all; at or below DEEP the full swim pose is.
 */
export const SWIM_PITCH_SHALLOW_Y = 0.02;
export const SWIM_PITCH_DEEP_Y = -0.2;

/**
 * How much of the in-water body pitch the ground under the character can physically hide, 0..1.
 *
 * The avatar's group origin is its FEET (see SWIM_BODY_Y in constants/world.ts), so pitching the
 * body toward horizontal swings the torso and head DOWN through that origin - a fully prone body
 * ends up lying at roughly foot height. Out at sea that is exactly right and the water covers it.
 * On the beach there is nothing to cover it with, and because the body's height is separately
 * floored to the terrain beneath it (Avatar.tsx), the two rules combine into a character lying
 * THROUGH the sand: head buried, legs in the air.
 *
 * That pose has been chased several times through the swim state machine, the transition timers
 * and the height blend - i.e. through the inputs that are *supposed* to bring the pitch back
 * upright before the character reaches dry ground. The pitch is eased toward its target over
 * ~0.2s though, and nothing bounded the eased value itself, so any path that carried a large
 * pitch inland faster than the ease could unwind it still buried the avatar. Walking straight out
 * of deep water does exactly that: the pose target flips to upright at SWIM_PITCH_DEEP_Y, but the
 * body keeps most of its lean for the rest of the walk up the beach.
 *
 * This is the invariant all of those fixes were reaching for, stated once and applied to the
 * pitch that actually gets rendered: the body may only lie down as far as there is water to lie
 * down in. It holds regardless of which state the machine is in, whether a transition timer got
 * interrupted, or how far the eased pitch still has to travel.
 *
 * It has since been promoted from a clamp on the pitch to a factor of the WATER POSE WEIGHT
 * (see swimPose.ts and where Avatar.tsx builds it), so it now scales the limbs, the head and
 * the float height by the same fraction rather than only the lean. That is what let the old
 * `isDeepEnough` hard gate go: wading in is a partial pose that grows with the depth, instead
 * of a switch that fires at SWIM_PITCH_DEEP_Y and flips the whole character flat.
 */
export function swimPitchAllowance(terrainY: number): number {
  const span = SWIM_PITCH_SHALLOW_Y - SWIM_PITCH_DEEP_Y;
  return THREE.MathUtils.clamp((SWIM_PITCH_SHALLOW_Y - terrainY) / span, 0, 1);
}

export type SwimState = 'walking' | 'enteringWater' | 'swimming' | 'exitingWater';

// World-unit buffer (scaled by islandScale like every other terrain radius here) straddling
// getTerrainInfo's sandRadius line. Without it, entering and exiting water shared a single
// threshold, so walking tangentially along the shoreline - or being nudged across it by
// something other than WASD input (collision push, hammock dismount, build-mode teleport) -
// made the sampled position flip sand/water every frame, and the swim state machine restarted
// its transition from scratch on every flip, never letting entering/exiting actually complete.
export const SWIM_HYSTERESIS = 0.35;

// Schmitt-trigger style check: which side of the line counts as "in water" depends on which
// side you're currently classified as being on. Already wet (swimming/entering/exiting) keeps
// counting as water until you've walked clearly back inland past sandRadius; still dry (walking)
// only starts counting as water once you've gone clearly past sandRadius into open water. The
// band in between is a stable dead zone that never flips state under positional jitter alone.
export function isInWaterZone(
  x: number,
  z: number,
  islandScale: number,
  isWet: boolean,
  isGrounded = false,
): boolean {
  // Standing on solid footing above the waterline is not being in the water, wherever that
  // footing happens to be. A 木製平台 out at sea is a pier: the player walks onto it dry-shod and
  // stays dry, and nothing here needs to know what a platform is to get that right - only that
  // there is ground under the feet (see lib/placementSurfaces.ts).
  if (isGrounded) return false;

  const dist = Math.sqrt(x * x + z * z);
  const sandRadius = SHORELINE_RADIUS * islandScale;
  const margin = SWIM_HYSTERESIS * islandScale;

  // Both thresholds sit ON or OUTSIDE the shoreline, so the entire hysteresis dead zone -
  // [sandRadius, sandRadius + margin] - lies in the shallows rather than straddling the beach.
  //
  // It used to be centred on the shoreline (sandRadius +/- margin), which put its inner half on
  // dry sand: a character coming ashore stayed classified "in water" for another 0.35 units
  // INLAND of the visible waterline, so the swim pose, swim height and swim ambience all kept
  // running while it was plainly standing on the beach. Anchoring the wet->dry test exactly at
  // the waterline means leaving the water begins the moment the character reaches the sand, and
  // no water state can be active inland of it. The dry->wet test keeps its full margin, so
  // entering still needs a deliberate wade past the shoreline and cannot be triggered by jitter.
  const threshold = isWet ? sandRadius : sandRadius + margin;
  return dist > threshold;
}

// Pure state-transition step: given where the character actually is right now, what should its
// swim state become? Deliberately doesn't touch transitionTimerRef - the caller (Avatar.tsx)
// resets that only when this returns a different state, and it's the same call site regardless
// of whether the position came from active WASD movement or from an idle-frame nudge, so the
// two can no longer drift out of sync with each other.
export function nextSwimState(
  current: SwimState,
  x: number,
  z: number,
  islandScale: number,
  isGrounded = false,
): SwimState {
  // Which threshold this state is measured against. Note that 'exitingWater' counts as DRY here
  // even though the character is still visually wet, grouping it with 'walking' rather than with
  // the other two water states.
  //
  // Treating it as wet (`current !== 'walking'`) gave enteringWater and exitingWater one shared
  // threshold - sandRadius - margin - with no dead zone at all between them, so the hysteresis
  // above only ever separated walking from the water states, never those two from each other.
  // A character loitering on that single line (walking the shore tangentially, or nudged across
  // it by collision resolve) therefore flipped entering/exiting every few frames, and since both
  // call sites in Avatar.tsx restart the transition timer whenever the state changes, neither
  // transition could ever run to completion. The character stayed pinned at transition progress
  // ~0, which holds it at swim depth (SWIM_BODY_Y, well below the sand) with the full in-water
  // pitch still applied - i.e. sunk into the beach, face-down, exactly at that one radius.
  //
  // Measured against the dry threshold instead, leaving 'exitingWater' now requires walking
  // clearly back out past the sand line - a deliberate move back into the sea, not jitter - so
  // the pair gets the same 2 * margin dead zone every other pairing here already had.
  const isWet = current === 'swimming' || current === 'enteringWater';
  const inWater = isInWaterZone(x, z, islandScale, isWet, isGrounded);

  if (current === 'walking') return inWater ? 'enteringWater' : 'walking';
  if (current === 'swimming') return inWater ? 'swimming' : 'exitingWater';
  if (current === 'enteringWater') return inWater ? 'enteringWater' : 'exitingWater';
  // exitingWater
  return inWater ? 'enteringWater' : 'exitingWater';
}

/**
 * How long the enter/exit water transitions take, in seconds. Avatar.tsx blends both the body
 * pitch and the body height across this window.
 */
export const SWIM_TRANSITION_DURATION = 0.45;

/**
 * Timer value the transition into `next` should start from, given `prev` was `currentTimer`
 * seconds from finishing.
 *
 * Reversing directly between enteringWater and exitingWater mirrors the remaining time rather
 * than restarting the full duration: the two run the very same blend (swim depth/pitch <-> land
 * depth/pitch) in opposite directions, so a character 80% of the way out of the water that turns
 * back around is 20% into entering it, not 0%. Restarting at the full duration snapped the body
 * back to the fully-submerged pose and height and replayed the whole transition from there,
 * which reads as a lurch back down into the water line. Every other transition legitimately
 * starts from scratch.
 */
export function swimTransitionTimer(prev: SwimState, next: SwimState, currentTimer: number): number {
  const isReversal =
    (prev === 'enteringWater' && next === 'exitingWater') ||
    (prev === 'exitingWater' && next === 'enteringWater');

  return isReversal
    ? THREE.MathUtils.clamp(SWIM_TRANSITION_DURATION - currentTimer, 0, SWIM_TRANSITION_DURATION)
    : SWIM_TRANSITION_DURATION;
}

/**
 * Whether the player is standing close enough to their Home's door to enter it.
 *
 * This replaces computeEnterableBuildings + findNearbyBuilding, which scanned a *list* of
 * candidate dwellings assembled from equipped building slots and island placements. There is
 * exactly one Home now, so there is nothing to scan and nothing to disambiguate - which also
 * removes the old bug where two placed 草本屋 shared one item id and collided as entry targets.
 */
export function findNearbyHome(
  position: THREE.Vector3,
  home: ResolvedHome | null
): { id: string; name: string } | null {
  if (!home) return null;

  if (homeEntryDistance(position.x, position.z, home) >= HOME_ENTRY_RADIUS) return null;

  return HOME_ENTRY_TARGET;
}

/**
 * The one enterable structure, as the entry prompt names it. One shared object rather than a
 * fresh literal per call: findNearbyHome runs every frame and its result is compared by `id`.
 */
export const HOME_ENTRY_TARGET: { readonly id: string; readonly name: string } = {
  id: 'player-home',
  name: '我的家',
};

/**
 * Pushes the player out of the Home, which is solid on all four sides.
 *
 * Works in the Home's local (unrotated) space, so an arbitrarily-rotated Home keeps a correctly
 * oriented box - the old fixed-slot houses were always axis-aligned. Half-extents come from the
 * House Style footprint via getHomeSolidHalfExtents, so switching appearance updates the collider
 * in the same step as the model and all seven styles obey one identical rule.
 *
 * **There is deliberately no doorway gap.** This used to carve a notch out of the +Z face
 * (|localX| < doorLaneWidth && localZ > doorFrontEdge) so the player could walk through the
 * entrance, which caused all three reported bugs at once: walking straight into the model's
 * hollow interior, standing inside the shell, and getting wedged in the door frame - because the
 * notch made the collider concave, so a player inside the lane was pushed out along whichever
 * face was nearest, sometimes deeper into the house. The interior is entered through the
 * "進入我的家" interaction (see Avatar's handleAction), never by walking, so the exterior shell has
 * no reason to be passable. A convex box also has no re-entrant corner to catch on.
 */
export function resolveHomeCollision(testPos: THREE.Vector3, home: ResolvedHome, margin = 0): void {
  const solid = getHomeSolidHalfExtents(home.footprint);
  // `margin` inflates the box by the caller's own radius. The player's calls pass none because
  // their obstacles are inflated on the way in; the island companion (Three/IslandPet.tsx) has no
  // such pipeline and asks for its clearance here. Defaulting to 0 leaves every existing caller
  // measuring exactly the box it always did.
  const halfWidth = solid.halfWidth + margin;
  const halfDepth = solid.halfDepth + margin;
  const rot = home.rotation;

  const rx = testPos.x - home.position[0];
  const rz = testPos.z - home.position[2];
  const cosRot = Math.cos(-rot);
  const sinRot = Math.sin(-rot);
  const localX = rx * cosRot - rz * sinRot;
  const localZ = rx * sinRot + rz * cosRot;

  const isOverlap = Math.abs(localX) < halfWidth && Math.abs(localZ) < halfDepth;

  if (!isOverlap) return;

  // Push out along whichever face is nearest.
  const left_or_right = localX > 0 ? halfWidth - localX : -(halfWidth + localX);
  const back_or_front = localZ > 0 ? halfDepth - localZ : -(halfDepth + localZ);

  let pushLX = 0;
  let pushLZ = 0;
  if (Math.abs(left_or_right) < Math.abs(back_or_front)) {
    pushLX = left_or_right;
  } else {
    pushLZ = back_or_front;
  }

  // Rotate the push vector back into world space.
  const cosRotW = Math.cos(rot);
  const sinRotW = Math.sin(rot);
  testPos.x += pushLX * cosRotW - pushLZ * sinRotW;
  testPos.z += pushLX * sinRotW + pushLZ * cosRotW;
}

/**
 * How far in FRONT of the avatar's origin the body reaches once it is fully prone (the 匍匐
 * / CRAWL emote).
 *
 * The avatar group's origin is at its FEET and the crawl pitches the whole group about that
 * origin, so a tipped-over character is not "a cylinder in a different pose" — it is a ~1.5-unit
 * object lying on the ground ahead of the point every collider in this file is testing. The head
 * centre alone ends up ~1.5 units forward (the body is ~2.1 world units tall, head centred at
 * ~1.5, tipped ~82°).
 *
 * 1.25 rather than 1.5 because every obstacle here is already inflated by PLAYER_PHYSICAL_RADIUS:
 * a probe at 1.25 is held 1.6 off the wall surface, which clears the head and stops short of
 * reserving the outstretched hands — a crawler's fingertips brushing the wall is right, their
 * shoulders inside it is the bug.
 */
export const CRAWL_BODY_REACH = 1.25;

/**
 * The same measurement for the SWIMMING body.
 *
 * A swimmer is a prone body for exactly the same reason a crawler is: Three/swimPose.ts pitches
 * the whole group forward about its own root by {@link SWIM_BODY_PITCH} (1.24 rad, +0.10 at full
 * stroke), and the root is the character's FEET. So the head is out in front of the origin, and
 * the origin is the only point the pushes above test. Standing beside a hull, that is the
 * difference between "the player is stopped by the boat" and "the player's shoulders are inside
 * the boat while their feet are politely outside it" — which is what it looked like.
 *
 * Derived from the crawl's number rather than measured again, because it is the same body:
 * `1.25 × sin(1.24) / sin(1.43) ≈ 1.19`. The swimmer lies slightly less flat than the crawler
 * (71° against ~82°), so it reaches marginally less far.
 *
 * WHY THIS IS NOT SIMPLY `proneReach`. The crawl reservation is applied against the house and
 * the furniture; this one deliberately is not, and the reason is the one already written into
 * Avatar.tsx where swimming was excluded from `proneReach` in the first place — a body-length of
 * forward clearance at the shoreline would fence the player off their own beach. That reasoning
 * still holds and is untouched. What it never covered is the case this constant exists for:
 * something SOLID FLOATING IN THE WATER, which before the merchant's boat did not exist. So the
 * swimmer reserves its length against the transient world solids (lib/worldSolids.ts) and
 * against nothing else — which is not a special case, it is the complete set of things a
 * swimming body can be lying across.
 */
export const SWIM_BODY_REACH = 1.2;

/**
 * Where along the prone body to sample, as a fraction of {@link CRAWL_BODY_REACH}. Two probes
 * (mid-torso and head) plus the origin itself put a 0.35-radius disc every ~0.63 units along the
 * body, so the covered strip has no gap for a corner to poke through.
 */
const PRONE_PROBES = [0.5, 1] as const;

/** Scratch probe position — this runs per frame and allocating here would churn. */
const proneProbe = new THREE.Vector3();

/**
 * Reserves the ground the PRONE body is lying on.
 *
 * Everything else in this file models the player as an upright cylinder around the group origin,
 * which is true right up until the crawl lays them out flat. From then on the 0.35 reserved at the
 * origin describes none of the character: they could stand (well, lie) with their whole torso and
 * head buried inside the Home while the collider that decides where they may go still sat politely
 * outside the wall. That is the reported "爬行時身體整個穿到房子裡面", and no amount of tuning the
 * radius fixes it — a circle around the feet cannot describe a body that isn't above the feet.
 *
 * So the prone body is collided as a short capsule: sample points along it are resolved against
 * the same obstacles as the origin, and whatever push frees a sample is applied to the WHOLE body.
 * Translating is the correct response for a rigid object — moving the feet back by exactly the
 * head's penetration frees the head — and the caller's relaxation loop settles the two ends
 * against each other in a corner, where both are constrained at once.
 */
function resolveProneBody(
  testPos: THREE.Vector3,
  reach: number,
  facingYaw: number,
  playerRadius: number,
  // What this body is being reserved AGAINST. Each may be null, and the two callers differ on
  // purpose: the crawl reserves against everything, the swimmer only against what floats. See
  // {@link SWIM_BODY_REACH}. Positional rather than an options object because this runs four
  // times a frame and an object literal per call is pure garbage.
  home: ResolvedHome | null,
  placements: NonNullable<UserProfile['islandPlacements']> | null,
  solids: readonly SolidBox[] | null | undefined,
  // The step reference the upright resolve uses (see stepReferenceY), so a railing stops the
  // crawling body's head exactly as it stops its feet.
  fromY: number | null = null,
): void {
  if (reach <= 0) return;

  // Yaw convention: the avatar faces its local +Z and `targetRot = atan2(move.x, move.z)`
  // (Avatar.tsx), so the direction it faces — and therefore the direction the crawl lays the body
  // out in — is (sin yaw, cos yaw).
  const forwardX = Math.sin(facingYaw);
  const forwardZ = Math.cos(facingYaw);

  for (const t of PRONE_PROBES) {
    const probeX = testPos.x + forwardX * reach * t;
    const probeZ = testPos.z + forwardZ * reach * t;
    proneProbe.set(probeX, testPos.y, probeZ);

    if (home) resolveHomeCollision(proneProbe, home);
    let px = proneProbe.x;
    let pz = proneProbe.z;
    if (placements) {
      const pushed = resolvePlayerAgainstFurniture(px, pz, playerRadius, placements, fromY);
      px = pushed.x;
      pz = pushed.z;
    }
    // The transient solids get the prone body too — and for the swimmer they are the ONLY thing
    // it is reserved against. A lying-down player is the one pose whose extremities are metres
    // from the point every other check uses, so leaving them out here is exactly how a body ends
    // up half inside a hull that the standing check had already stopped.
    const clear = resolvePlayerAgainstSolids(px, pz, playerRadius, solids);

    testPos.x += clear.x - probeX;
    testPos.z += clear.z - probeZ;
  }
}

export interface ResolveCollisionsParams {
  testPos: THREE.Vector3;
  currentPos?: THREE.Vector3;
  isInterior: boolean;
  islandScale: number;
  profile: UserProfile | null | undefined;
  /** The player's Home, or null before it has been placed. */
  home: ResolvedHome | null;
  /**
   * True only while actively swimming/entering water.
   */
  isSwimmingBoundary?: boolean;
  /**
   * How far the body currently reaches in front of the origin because it is tipped prone — 0
   * whenever the player is upright, which is every case but the crawl. See
   * {@link CRAWL_BODY_REACH}. Callers scale it by the LIVE pitch so the reservation grows and
   * shrinks with the pose instead of appearing the instant the emote is pressed.
   */
  /**
   * Solid boxes that exist in the world right now but are in nobody's save file — today, the
   * visiting merchant's boat and what is on its deck (Three/MerchantVisitor.tsx publishes them
   * on `playerBus.worldSolids`, in world space, from the same transform that draws the hull).
   *
   * They are pushed against in the SAME relaxation loop as furniture and with the same function
   * (lib/furniturePlacement.ts), so they are not a second collision system — they are the same
   * one, fed from a second source. What they deliberately are NOT is ground: they never reach
   * `getSurfaceAt`, so a hull cannot become a floor and cannot end a swim.
   */
  solids?: readonly SolidBox[] | null;
  /**
   * How far the SWIMMING body reaches in front of the origin right now — {@link SWIM_BODY_REACH}
   * scaled by the live water-pose weight, so the reservation eases in and out with the pose
   * instead of appearing the instant the player's toes touch the sea.
   *
   * Separate from {@link proneReach} rather than folded into it because the two are reserved
   * against different things — see {@link SWIM_BODY_REACH}. They are mutually exclusive in
   * practice (Avatar zeroes `proneReach` while swimming), so at most one is ever non-zero.
   */
  swimReach?: number;
  proneReach?: number;
  /** Body yaw in radians. Only read when `proneReach` is greater than 0. */
  facingYaw?: number;
  /**
   * How far the CENTRE must stay off a full-height surface — a room's walls, the Home's shell.
   *
   * Separate from the general {@link PLAYER_PHYSICAL_RADIUS} because the player character is
   * wider at the head than anywhere else, and a wall is the only obstacle tall enough for that
   * to show: everything else the body is pushed against (furniture, island props) is resolved in
   * a band the skull is above. Supplied by the caller because only Avatar.tsx knows which
   * character model is drawn — see characterRig.ts's bodyClearanceRadius.
   *
   * Defaults to the plain body radius, so a caller that has no model in hand (a test, a
   * non-player agent) keeps exactly the behaviour this function has always had.
   */
  wallClearance?: number;
  /**
   * The height the feet were resolved to last frame — the previous result's `terrainY`.
   *
   * It is what gives a standable piece a SIDE. With it, a deck is floor only where it is within a
   * step of where the player is standing and a wall everywhere else (STAND_RULES in
   * lib/furniturePlacement.ts): the viewing deck is reached by its stairs, its railings stop a
   * body, and walking into it from the grass is walking into a wall rather than being lifted 0.9 in
   * one frame. Omit it (null) after a teleport, a view change or anything else that puts the body
   * somewhere it did not walk to; the lookup then takes whatever is on top, as it always has.
   */
  footY?: number | null;
}

/**
 * The height a body is stepping FROM, for the step rule — the feet, or the sea surface when the
 * body is floating in it.
 *
 * A swimmer's `terrainY` is the seabed, a metre or more below them, and measured from there a pier
 * standing 0.4 out of the water would be a cliff. The body is at the surface, so that is where a
 * step up out of the sea starts from.
 */
export function stepReferenceY(footY: number | null | undefined, inWater: boolean): number | null {
  if (footY == null) return null;
  return inWater ? Math.max(footY, WATER_SURFACE_Y) : footY;
}

/**
 * How far above the surface the avatar's group origin (its feet) is held.
 *
 * ZERO — because the character rig already answers this, and answers it differently. Its first
 * invariant is that the root origin IS the ground contact point (constants/characterRig.ts), and
 * every registered skeleton then authors its soles at `soleY = -0.005` LOCAL — 11 mm world —
 * BELOW that origin, precisely so that a body standing exactly on the surface buries the sole a
 * hair instead of showing a seam under it. The origin on the surface IS the contact pose.
 *
 * It used to be 0.05, which is that 11 mm the wrong way round plus another 39 mm on top: a
 * visible sliver of daylight under both feet on grass, on sand, on a deck and at the top of every
 * rock step-up. Two things in the game were already drawn the correct way and disagreed with it —
 * the island pet stands at exactly `getSurfaceAt().y` (Three/IslandPet.tsx), and the dressing
 * room puts the avatar's root at exactly its stage floor's plane (DressingRoomView.tsx), which is
 * the one place the character is looked at close up. The player walking around the island was the
 * single actor in the game standing off its own ground.
 *
 * Kept as a named constant rather than folded away because several expressions have to say the
 * same thing — the island surface, the rock step-up, the interior floor, and the swim exit's
 * blend back onto land — and if the feet ever do need a lift (shadow acne on a new surface, say)
 * this is the one place to say so rather than four.
 */
export const FOOT_LIFT = 0;

/**
 * How far below the surface the feet are standing on the drawn body may ever be — about the
 * thickness of a sole.
 */
const FEET_SINK_TOLERANCE = 0.02;

/**
 * The lowest the drawn body may be, on dry land, given the surface it stands on and whatever the
 * pose adds on top of it (a jump arc, the crawl lift, an action's dip).
 *
 * The body's height is eased toward its target, which is right for every change that comes from
 * the body (a jump, a crouch, walking down off a deck) and wrong for exactly one that does not: a
 * step UP. The target jumps up by the rise, the ease takes a fifth of a second to follow, and for
 * that fifth of a second the legs are drawn inside the tread they are standing on — the "walks
 * through the boards" look on every deck edge and every stair.
 *
 * Only the SUPPORT is floored. A pose that deliberately lowers the body (the jump's crouch, a
 * kneel) is subtracted first, so it still dips; a pose that raises it (the jump's arc) is ignored,
 * so the ease still owns how an airborne body moves. The only frames this changes are the ones
 * where the soles would otherwise be below the surface.
 */
export function feetFloorY(supportY: number, poseOffset: number): number {
  return supportY + Math.min(0, poseOffset) - FEET_SINK_TOLERANCE;
}

/**
 * One frame of the body's eased BASE height — the surface it stands on, glided toward.
 *
 * `drawnY` is where the root was actually drawn last frame and `prevLift` is how much of that was
 * lift the body added on top of its base (the jump arc, the footfall bounce). The lift is taken
 * back off before easing, because anything left in is fed into the ease as if it were ground:
 *
 *   - the jump arc, eased, trailed the physics by ~0.1 s and landed 0.78 above the ground;
 *   - the stride bounce, fed back every frame, settled at bounce·(1−k)/k ABOVE the ground —
 *     +0.4..0.8 while walking, growing with the frame rate.
 *
 * The caller adds this frame's lift to the returned base and remembers it for the next call.
 * `npm run audit:jump` drives this exact function, so what it measures is what the island draws.
 */
export function easeBodyBase(
  drawnY: number,
  prevLift: number,
  baseTargetY: number,
  rate: number,
  delta: number,
): number {
  return THREE.MathUtils.lerp(drawnY - prevLift, baseTargetY, rate * delta);
}

export interface CollisionResult {
  position: THREE.Vector3;
  /** World Y for the avatar's feet. */
  terrainY: number;
  /** The placed deck the player is standing on, or null when they're on the island itself. */
  supportId: string | null;
  /** Footstep material of that deck, for Avatar's footfall VFX/audio. */
  supportFootstep: 'wood' | 'stone' | null;
  /** True when the player is standing on solid footing above the waterline. */
  isGrounded: boolean;
}

/**
 * The interior's walkable rectangles, rebuilt only when the set of unlocked rooms changes.
 *
 * resolveCollisions runs on every frame the player is indoors, and this used to be rebuilt
 * from scratch inside it: parseUnlockedRooms re-splits and re-parses every saved room string
 * into fresh objects, and buildWalkableRects then allocates a rectangle per room plus one per
 * doorway on top. None of that output can change while the player walks around - it is a
 * function of the saved room list alone - so it was pure per-frame garbage, on the one code
 * path where a GC pause reads as the character catching in a doorway.
 *
 * Keyed on the saved array's identity, which is the React contract for this data: the profile
 * is replaced, never mutated in place, when a room is unlocked. The length is compared too, as
 * a cheap tripwire in case that ever stops being true.
 */
let cachedRoomsRaw: string[] | undefined;
let cachedRoomsLength = -1;
let cachedAgentRadius = -1;
let cachedRects: WalkRect[] = [];

function getWalkableRects(raw: string[] | undefined, agentRadius: number): WalkRect[] {
  const length = raw?.length ?? -1;
  if (raw !== cachedRoomsRaw || length !== cachedRoomsLength || agentRadius !== cachedAgentRadius) {
    cachedRoomsRaw = raw;
    cachedRoomsLength = length;
    cachedAgentRadius = agentRadius;
    cachedRects = buildWalkableRects(parseUnlockedRooms(raw), agentRadius);
  }
  return cachedRects;
}

/** Reused by the wall-containment clamp below, which used to clone a Vector3 per iteration. */
const CLOSEST_SCRATCH = new THREE.Vector3();

export function resolveCollisions({
  testPos,
  currentPos,
  isInterior,
  islandScale,
  profile,
  home,
  isSwimmingBoundary = false,
  solids = null,
  swimReach = 0,
  proneReach = 0,
  facingYaw = 0,
  wallClearance = PLAYER_PHYSICAL_RADIUS,
  footY = null,
}: ResolveCollisionsParams): CollisionResult {
  // Both branches below assign this; the initialiser is only the compiler's.
  let terrainY = INTERIOR_FLOOR_Y + FOOT_LIFT;
  let supportId: string | null = null;
  let supportFootstep: 'wood' | 'stone' | null = null;
  let isGrounded = isInterior;

  if (isInterior) {
    const playerRadius = PLAYER_PHYSICAL_RADIUS;

    // The floor of the room, stated — which this branch used never to do at all. It simply left
    // `terrainY` on its initialiser, and that initialiser was 0.35: the OUTDOOR grass height
    // (ISLAND_SURFACE_Y 0.3) plus the outdoor foot lift, inherited by the interior because the
    // two branches happened to share a variable. So the player stood a third of a unit above a
    // floor that is at 0 — about a sixth of the character's own height, clear of every rug and
    // every furniture base in the house, and the footstep VFX spawned up there with them.
    //
    // There is nothing to look up: unlike the island, the interior has exactly one walkable
    // height, and it is the same constant the floor mesh, the camera's floor limit and the
    // placement raycast are all built from (constants/interiorShell.ts).
    terrainY = INTERIOR_FLOOR_Y + FOOT_LIFT;

    // Union of walkable rectangles, from the one description of the room shell that the meshes
    // and the camera also read (constants/interiorShell.ts).
    //
    // This used to be built here from ROOM_HALF_SIZE - i.e. from the wall's CENTRE LINE - so the
    // player's centre stopped at ROOM_HALF_SIZE - radius and their body surface reached the
    // centre line exactly: 0.175 inside the 0.35-thick panel and 0.22 inside its baseboard.
    // That is the reported "part of the body sinks into the wall", and it was not a missing
    // collider - it was the collider sitting in the middle of the wall rather than on its face.
    // buildWalkableRects insets from the wall SURFACE instead, so the body stops against what
    // the player can actually see.
    // The WALL clearance, not the body radius: the rects are the room's own faces, and the
    // widest part of the character has to stop against them. Furniture below keeps
    // `playerRadius` — see wallClearance.
    const rects = getWalkableRects(profile?.interiorData?.unlockedRooms, wallClearance);

    // Loop multi-iterations for perfect collision relaxation!
    for (let iter = 0; iter < 3; iter++) {
      // 1. Furniture collision, against each piece's measured oriented box.
      //
      // This used to be a circle whose radius came from substring-matching the
      // item's Chinese name (`getPlacedItemCollisionRadius`, still used for the
      // island's outdoor props below). Indoors that let the player walk through
      // the bed, the bathtub, the wardrobe and the kitchen counter — every one
      // of them missing from the list and so given the flat 0.65 default, while
      // being over 2.5 units long — and at the same time put invisible circular
      // obstacles at floor level under wall-mounted paintings and the hanging
      // cupboard. See resolvePlayerAgainstFurniture for the full account.
      const interiorPlacements = profile?.interiorData?.placements || [];
      const pushed = resolvePlayerAgainstFurniture(
        testPos.x,
        testPos.z,
        playerRadius,
        interiorPlacements,
      );
      testPos.x = pushed.x;
      testPos.z = pushed.z;

      // 2. Wall containment (clamp to union of valid rectangles)
      if (rects.length > 0) {
        let isInsideAny = false;
        const closestPos = CLOSEST_SCRATCH.copy(testPos);
        let minDistSq = Infinity;

        for (const rect of rects) {
          if (testPos.x >= rect.minX && testPos.x <= rect.maxX && testPos.z >= rect.minZ && testPos.z <= rect.maxZ) {
            isInsideAny = true;
            break; 
          }
        }

        if (!isInsideAny) {
          // Anti-tunneling: If the player walks out of bounds, only clamp them to rectangles 
          // they were already standing in on the previous frame. This prevents snapping through 
          // thin walls into adjacent disconnected rooms (which might be physically closer to testPos).
          let validRects = rects;
          if (currentPos) {
            const containingRects = rects.filter(r => 
              currentPos.x >= r.minX && currentPos.x <= r.maxX && 
              currentPos.z >= r.minZ && currentPos.z <= r.maxZ
            );
            if (containingRects.length > 0) {
              validRects = containingRects;
            }
          }

          for (const rect of validRects) {
            const clampedX = Math.max(rect.minX, Math.min(rect.maxX, testPos.x));
            const clampedZ = Math.max(rect.minZ, Math.min(rect.maxZ, testPos.z));
            const distSq = (testPos.x - clampedX) ** 2 + (testPos.z - clampedZ) ** 2;
            
            if (distSq < minDistSq) {
              minDistSq = distSq;
              closestPos.set(clampedX, testPos.y, clampedZ);
            }
          }

          testPos.copy(closestPos);
        }
      }
    }
  } else {
    // Island boundary check for swimming. Uses SWIMMABLE_RADIUS rather than its own copy of the
    // number: this leash and getTerrainInfo's water/deepWater line are the same boundary, and as
    // separate literals the two silently drifted - the constant could be moved out to sea while
    // the clamp that actually stops the player stayed put, so nothing changed in game.
    const testDist = testPos.length();
    const deepWaterThreshold = SWIMMABLE_RADIUS * islandScale;

    if (isSwimmingBoundary) {
      if (testDist > deepWaterThreshold) {
        testPos.normalize().multiplyScalar(deepWaterThreshold);
      }
    }

    const placements = profile?.islandPlacements || [];

    // The height this step is taken FROM. Decks are floor within a step of it and wall above it
    // (STAND_RULES in lib/furniturePlacement.ts), and both halves of that — the push below and the
    // surface lookup after it — must measure from the same number, or a deck could be a wall to
    // the push and floor to the lookup in the same frame.
    const fromY = stepReferenceY(footY, isSwimmingBoundary);

    // Placed decorations, against the same measured boxes the interior uses (see
    // resolvePlayerAgainstFurniture). This replaced a name-substring radius ladder that gave a
    // 椰子樹 - a 0.24-wide trunk under fronds four units up - a 0.9-unit circle at ground level,
    // stopped the player short of a 吊床 by more than a metre at its ends, and fell back to 0.65
    // for anything it had never heard of.
    //
    // Decks are pushed against too now, part by part and only where they stand more than a step
    // above the feet: a railing, a post, the side of a deck too high to step onto. They used to be
    // left out entirely ("a surface, resolved by height"), which made every part of every deck
    // something the body passed through — see STAND_RULES.
    //
    // The one structure that is not a placement (the Home) is resolved separately at the top of
    // each relaxation pass, since its solid box comes from its House Style footprint.
    const playerRadius = PLAYER_PHYSICAL_RADIUS;

    // Loop multi-iterations for perfect island collision relaxation!
    for (let iter = 0; iter < 3; iter++) {
      if (home) {
        // The house's outside is a wall like any other, so it gets the same head clearance the
        // rooms inside it do. `resolveHomeCollision` already inflates by PLAYER_PHYSICAL_RADIUS,
        // so what it is handed here is only the DIFFERENCE - see wallClearance.
        resolveHomeCollision(testPos, home, wallClearance - PLAYER_PHYSICAL_RADIUS);
      }

      const pushed = resolvePlayerAgainstFurniture(testPos.x, testPos.z, playerRadius, placements, fromY);
      testPos.x = pushed.x;
      testPos.z = pushed.z;

      // Whatever is solid in the world without being in the save — the merchant's boat and its
      // deck. Inside the same relaxation loop rather than after it, so a player wedged between a
      // hull and something on the beach is resolved by the same three passes that already settle
      // furniture against the house, instead of being pushed by one and then by the other.
      const clear = resolvePlayerAgainstSolids(testPos.x, testPos.z, playerRadius, solids);
      testPos.x = clear.x;
      testPos.z = clear.z;

      // The body itself, for the two poses where it is not above the point resolved above.
      // The crawl reserves against everything; the swimmer only against what floats — see
      // SWIM_BODY_REACH. Both early-return on a zero reach, and they are mutually exclusive, so
      // this is one pass in practice.
      resolveProneBody(testPos, proneReach, facingYaw, playerRadius, home, placements, solids, fromY);
      resolveProneBody(testPos, swimReach, facingYaw, playerRadius, null, null, solids, fromY);
    }

    // The Home gets the last word. Every iteration above ends with the decoration pass, which
    // pushes radially and can shove the player back through a wall when a prop is parked against
    // the house; without this the frame would commit that position and the player would end up
    // standing inside the building. Resolving the one non-negotiable obstacle after the relaxation
    // converges guarantees the exterior is never penetrable, whatever else is on the island.
    //
    // The prone pass runs BEFORE that final word rather than after it: it moves the feet
    // backwards to free the head, and a backwards step is never into the house it is stepping
    // away from — whereas letting it run last would leave a body that had just been freed at the
    // head able to end the frame with its feet unchecked.
    resolveProneBody(testPos, proneReach, facingYaw, playerRadius, home, placements, solids, fromY);
    resolveProneBody(testPos, swimReach, facingYaw, playerRadius, null, null, solids, fromY);

    if (home) {
      resolveHomeCollision(testPos, home, wallClearance - PLAYER_PHYSICAL_RADIUS);
    }

    // Base surface — AFTER the pushes, at the spot the body actually ends the frame on. It used to
    // be read at the requested spot before anything had moved it, so the feet could be given the
    // height of a place the push had just refused.
    //
    // One lookup for "how high is the ground here", and it is the same one the placement ghost
    // resolves an object's height with, so a deck the player can see props standing on is a deck
    // they stand on at exactly the same height. The three pasted copies of
    // `if (dx < 2.15 && dz < 2.15) terrainY = 0.6` this replaced were a square that was neither
    // the platform's real size nor its real deck height, and did not turn with it.
    const surface = getSurfaceAt(testPos.x, testPos.z, placements, islandScale, null, fromY);
    terrainY = surface.y + FOOT_LIFT;
    supportId = surface.supportId;
    supportFootstep = surface.surface?.footstep ?? null;
    isGrounded = surface.isSolid && surface.y > WATER_SURFACE_Y;

    // Rock step-up — the rock's own surface, as the sphere its drawn solid is built around.
    //
    // What this replaced was a cone: a linear ramp from the plateau up to `rockTop - 0.1` over a
    // detection radius 0.4 wider than the rock itself. It had the right idea and none of the
    // right numbers. `0.3 + (rockTop - 0.1)` at the centre is rockTop + 0.2, so standing on the
    // biggest outcrop put the player a fifth of a unit ABOVE its highest point — the largest
    // float anywhere in the game, and one that got worse the bigger the rock. The ramp also
    // reached 0.4 out past the silhouette, so the ground rose while the rock was still visibly
    // ahead of the player.
    //
    // A sphere profile needs neither a fudge nor a detection radius: it meets the plateau exactly
    // where the rock stops sticking out of it, so the Math.max below IS the join.
    const resolvedRocks = getResolvedRockPositions(islandScale, home);
    resolvedRocks.forEach((rPos, i) => {
      const dx = testPos.x - rPos[0];
      const dz = testPos.z - rPos[2];
      const distSq = dx * dx + dz * dz;
      const radius = getRockScale(i) * DODECAHEDRON_INSPHERE;

      if (distSq < radius * radius) {
        terrainY = Math.max(terrainY, rPos[1] + Math.sqrt(radius * radius - distSq) + FOOT_LIFT);
      }
    });
  }

  return { position: testPos, terrainY, supportId, supportFootstep, isGrounded };
}

/**
 * The longest single move {@link resolveMovement} hands to {@link resolveCollisions} in one go.
 *
 * The resolve is a POSITION test: it looks at where the body would end up, not at the path there.
 * That is exact while a frame's move is short, and the walk speed (≈5.5 units/s) keeps it short at
 * 60 fps — 0.09. It stops being exact on a slow frame. The controller caps a frame at
 * MAX_FRAME_DELTA (0.1 s, lib/playerBus.ts), which is a 0.55 move, and that is long enough to:
 *
 *  - skip a whole stair tread. 小型觀景平台's treads are 0.37 deep and 0.225 apart in height; a move
 *    that lands two treads up asks for a 0.45 rise, which is over STAND_RULES.maxStepUp, so the step
 *    rule calls the stairs a wall and the deck cannot be climbed at all on a slow device or through
 *    a hitch (measured: `npm run test:collision-registry` §4);
 *  - carry the body's centre past the middle of a thin wall — a railing inflated by the body radius
 *    is 0.75 across — where the push resolves it out of the FAR side.
 *
 * 0.15 is under half the thinnest inflated wall and well under a tread, so neither can happen, and
 * over the 60 fps move, so a normal frame is still exactly one resolve.
 */
export const MAX_COLLISION_SUBSTEP = 0.15;

/**
 * {@link resolveCollisions} for a MOVE from `currentPos` to `testPos`, taken in steps no longer than
 * {@link MAX_COLLISION_SUBSTEP}, each resolved from where the last one ended and at the height the
 * last one stood at — exactly as consecutive frames are. Resolving a frame's move in pieces is what
 * makes where the body can go independent of the frame rate.
 *
 * Mutates and returns `testPos` as `resolveCollisions` does, so it drops in at the same call sites.
 * Without a `currentPos` there is no move to split, and this is one plain resolve.
 */
export function resolveMovement(params: ResolveCollisionsParams): CollisionResult {
  const { testPos, currentPos } = params;
  if (!currentPos) return resolveCollisions(params);

  const dx = testPos.x - currentPos.x;
  const dz = testPos.z - currentPos.z;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / MAX_COLLISION_SUBSTEP));
  if (steps === 1) return resolveCollisions(params);

  // Every piece is the SAME share of the move, applied from wherever the last piece was pushed to —
  // so a body sliding along a wall keeps sliding. Never "the rest of the way divided by the pieces
  // left": a wall that holds the body back leaves the rest undiminished, and the last piece would
  // then carry all of it at once — exactly the long step this exists to prevent, and measured doing
  // what a long step does, putting the body out through the far side of a railing.
  const stepX = dx / steps;
  const stepZ = dz / steps;
  const y = testPos.y;
  const from = SUBSTEP_FROM.copy(currentPos);
  let footY = params.footY ?? null;
  let result: CollisionResult | null = null;
  for (let i = 0; i < steps; i++) {
    testPos.set(from.x + stepX, y, from.z + stepZ);
    result = resolveCollisions({ ...params, testPos, currentPos: from, footY });
    from.copy(result.position);
    footY = result.terrainY;
  }
  return result!;
}

/** Scratch for resolveMovement — it runs every moving frame. */
const SUBSTEP_FROM = new THREE.Vector3();

/**
 * The height the character's feet stand at, at one spot — the height half of
 * {@link resolveCollisions}, with none of the pushing.
 *
 * For the callers that need to know where the ground is while something else owns the body's
 * position: sitting and lying (Three/Avatar.tsx's pose block, which asks so it can work out how
 * far the legs have to reach DOWN from a seat), and any future pose that hangs the body off a
 * fixed point. Running the full resolve for that answer is not an option there — it treats the
 * piece being sat on as a solid obstacle and shoves the occupant off it.
 *
 * Exists so those callers cannot drift: the branch below is the same pair of answers
 * resolveCollisions gives, and both come from here rather than from a number typed in twice.
 * The one that was typed in twice was the interior's, and both copies were wrong.
 */
export function footLevelAt(
  x: number,
  z: number,
  isInterior: boolean,
  islandScale: number,
  placements: PlacedItem[] | undefined,
  /** Where the feet are now, for the step rule — see ResolveCollisionsParams.footY. */
  footY?: number | null,
): number {
  if (isInterior) return INTERIOR_FLOOR_Y + FOOT_LIFT;
  return getSurfaceAt(x, z, placements ?? [], islandScale, null, footY).y + FOOT_LIFT;
}
