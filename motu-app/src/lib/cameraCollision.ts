/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { CAMERA_BLOCKER_LAYER } from '../constants/layers';

/**
 * THE camera-collision system. One implementation, shared by every third-person view - the
 * island, the house interior, and anything added later - so "camera feel" cannot drift between
 * scenes and no scene needs its own copy of the rules.
 *
 * It is built around three distances that are deliberately kept as three separate values. Nearly
 * every "the camera zoomed in and never came back" bug is the same mistake: collapsing them into
 * one number, so that avoiding an obstacle *overwrites* the distance the player asked for and
 * there is nothing left to restore.
 *
 *   Desired distance   What the player's zoom setting asks for (uiScale -> distance). Owned by the
 *                      zoom pipeline. NOTHING in this file ever writes to it, so no amount of
 *                      collision can permanently change how far the camera follows.
 *
 *   Collision distance The furthest the camera may sit *this frame* without ending up inside
 *                      something. Recomputed from scratch every frame, always starting from the
 *                      desired distance - it is a per-frame cap, never an accumulator. The moment
 *                      an obstacle stops being in the way it is simply back to the desired
 *                      distance, with nothing to "release" or "reset".
 *
 *   Current distance   Where the camera is actually rendered. Follows min(desired, collision):
 *                      snaps inward instantly (a wall must never be clipped through, not even for
 *                      one frame) and eases back outward smoothly (see CameraDistanceSolver).
 *
 * The Roblox third-person camera behaves exactly this way, and the properties that fall out of it
 * are the ones being asked for here: no fixed delays, no "am I still colliding?" state to get
 * stuck in, no per-object exceptions, and recovery that needs no input from the player.
 *
 * SHORTENING THE ARM IS THE LAST RESORT, NOT THE FIRST. Distance is the one thing the player
 * explicitly chose, so avoidance spends pitch before it spends distance: when the view direction
 * they picked cannot hold a third-person distance, the camera swings UP over the obstruction
 * (see solveAvoidanceLift) and only gives up distance for whatever that cannot solve. Without
 * this, a room barely wider than the follow distance has exactly one answer to "the wall is
 * behind you" - collapse onto the player's head - and the player has to zoom out by hand
 * afterwards. Both the lift and the arm are temporary, both ease back on their own, and neither
 * writes to the player's setting.
 */

/**
 * Radius of the sphere the camera is treated as, in world units. Subtracted from every hit so the
 * camera stops short of a surface rather than with its near plane already inside it - the
 * exterior canvas uses `near` 0.5 and the interior one 0.3 (see Scene.tsx /
 * BuildingInteriorView.tsx), so anything smaller than 0.5 would still let a wall clip.
 */
export const CAMERA_COLLIDER_RADIUS = 0.5;

/**
 * How far off-axis the four extra probe rays start. Approximates a sphere-cast (three has no
 * such primitive) so a pillar or a wall corner that the single centre ray happens to slip past
 * still pushes the camera in. Deliberately smaller than the collider radius: at the full radius
 * the offset origins can start *inside* a wall whenever the player hugs it, which reads as a
 * flicker between "clear" and "fully collapsed".
 */
const PROBE_LATERAL_OFFSET = CAMERA_COLLIDER_RADIUS * 0.7;

/**
 * Hard floor on the collision distance. A camera pinned at exactly 0 sits inside the player's
 * head and its direction becomes undefined; this keeps a sliver of distance so the orbit
 * direction stays well-defined even when the player is jammed into a corner.
 */
export const MIN_CAMERA_DISTANCE = 0.35;

/**
 * The distance below which the shot stops being third person and starts being "the back of the
 * character's head fills the screen". Avoidance treats this as the distance it is trying to
 * PRESERVE, not as a floor it is allowed to clamp to.
 *
 * This is what stops the camera diving onto the player's head. Simply shortening the arm until
 * the sightline is clear is a valid way to avoid geometry, but it is a terrible-looking one in a
 * room barely wider than the follow distance: back into any wall and the answer is always
 * "distance ~0.4", i.e. first person, and the player has to zoom manually to get their view back.
 * When the arm alone cannot keep this much distance, {@link solveAvoidanceLift} looks for room
 * ABOVE instead - see there.
 */
export const MIN_THIRD_PERSON_DISTANCE = 2.2;

/**
 * The camera never renders closer than this while the player's own zoom asks for more, even when
 * the geometry says it should - it is the "reasonable minimum viewing distance" below which the
 * character stops being something you are watching and becomes something you are inside.
 *
 * It is allowed to overrun the geometric limit by at most CAMERA_COLLIDER_RADIUS to hold it (see
 * `applyObservationFloor`), which is exactly the margin that radius exists to provide, so holding
 * it can never expose more than the near plane already clips away. That bound is why this is a
 * floor and not a clamp: it can only ever spend margin that was there for this purpose, never
 * push the camera through a surface.
 */
export const MIN_OBSERVATION_DISTANCE = 1.2;

/**
 * This file imposes no elevation cap of its own: how high avoidance may swing is entirely the
 * `headroom` the caller passes in, and OUTDOORS that is simply the orbit's own polar limit.
 *
 * Outdoors a moderate cap was tried and measured worse where it matters. Lifting makes the arm more
 * oblique to whatever is blocking it, and the standoff a surface demands grows as 1/cos of that
 * obliquity - so the distance a given lift buys back has sharply diminishing returns, and a cap
 * that sounds generous (40 degrees) still left the arm at ~0.9 units against a wall a metre away,
 * versus ~1.6 uncapped. Since the complaint being solved is the camera ending up on the player's
 * head, and the search already takes the SMALLEST lift that works, capping only ever bites in the
 * exact case the lift exists for. The geometry caps itself: past the point where the ground is
 * nearer than the obstruction, more elevation stops buying distance and the search keeps the
 * smaller lift.
 *
 * INDOORS that last sentence is false, which is why CameraController passes a tighter headroom
 * there (MAX_INTERIOR_LIFT_POLAR). A room is closed: full-height walls under a low ceiling mean no
 * elevation ever opens up, so the search climbs to the top of whatever range it is given and the
 * shot ends up looking straight down at the player's scalp. The trade that is right on open ground
 * is the wrong one in a box - see that constant.
 */

/**
 * How many elevations to try between "none" and the limit. The search stops at the first one that
 * recovers the wanted distance, so this is the granularity of "minimum necessary avoidance": too
 * few and the lift arrives in coarse steps that read as the camera jumping as the player walks
 * along a wall. At 8 the steps are ~5 degrees, below what the eye picks out once eased.
 */
const LIFT_SAMPLES = 8;

/**
 * Lift eases in BOTH directions, unlike distance. Distance has to snap inward because a frame at
 * the wrong distance is a frame clipped through a wall; the lift has no such deadline - whatever
 * elevation it is currently at, the distance for THAT direction is solved exactly - so it is free
 * to be smooth, and a camera that swings is far more noticeable than one that dollies.
 */
const LIFT_RISE_RATE = 8;
const LIFT_RETURN_RATE = 4;

const UP = new THREE.Vector3(0, 1, 0);
const liftAxis = new THREE.Vector3();

/**
 * Rotates `dir` in place about the horizontal axis perpendicular to it: positive `radians` raises
 * the camera's elevation, negative lowers it, and the compass bearing is untouched either way.
 *
 * Being an exact, invertible rotation matters: CameraController reads the orbit direction back off
 * the camera each frame, so it undoes the previous frame's lift with `applyCameraLift(dir, -lift)`
 * to recover the player's own direction. Anything approximate here would leak avoidance into the
 * player's aim and accumulate.
 */
export function applyCameraLift(dir: THREE.Vector3, radians: number): THREE.Vector3 {
  if (radians === 0) return dir;
  liftAxis.crossVectors(dir, UP);
  if (liftAxis.lengthSq() < 1e-8) return dir; // already vertical - no bearing to rotate around
  return dir.applyAxisAngle(liftAxis.normalize(), radians).normalize();
}

/**
 * The avoidance half of the system: when the player's own view direction cannot hold a
 * third-person distance, how far up should the camera swing to find one?
 *
 * Sliding up is what a real spring arm does and it is what makes small interiors work. The arm and
 * the lift are solving the same constraint with different resources - the arm trades distance,
 * the lift trades pitch - and the lift is tried FIRST because distance is the thing the player
 * actually set and pitch recovers invisibly.
 *
 * Geometry, not guesswork: `measure` is the same per-direction collision query used for the real
 * direction, so this knows nothing about walls, ceilings, furniture or trees. It just asks "how
 * much room is there if I look from a bit higher?" a few times and keeps the best answer, which is
 * why it needs no per-object or per-scene rules and works unchanged outdoors.
 *
 * @param dir      the player's own orbit direction (unit).
 * @param wanted   the distance worth swinging for - normally MIN_THIRD_PERSON_DISTANCE, capped by
 *                 whatever the player actually asked for.
 * @param headroom how much lift is left before the orbit's own polar limit, i.e. the whole range
 *                 the search may use.
 * @param measure  collision distance along a candidate direction.
 * @param scratch  caller-owned vector, written to. Avoids allocating per frame.
 * @returns the smallest lift that got closest to `wanted`; 0 when lifting does not help.
 */
export function solveAvoidanceLift(
  dir: THREE.Vector3,
  wanted: number,
  headroom: number,
  measure: (candidate: THREE.Vector3) => number,
  scratch: THREE.Vector3
): number {
  if (headroom <= 0) return 0;

  let bestLift = 0;
  let bestDist = measure(dir);

  for (let i = 1; i <= LIFT_SAMPLES && bestDist < wanted; i++) {
    const lift = (i / LIFT_SAMPLES) * headroom;
    applyCameraLift(scratch.copy(dir), lift);
    const dist = measure(scratch);
    if (dist > bestDist) {
      bestDist = dist;
      bestLift = lift;
    }
  }

  return bestLift;
}

/**
 * Extra clearance kept between the camera and a surface ON TOP of the near plane, so a wall the
 * camera is pressed against lands just in FRONT of the near plane rather than exactly on it.
 * A surface sitting exactly on the clip plane is a coin-flip between "wall" and "hole".
 */
const NEAR_PLANE_MARGIN = 0.08;

/**
 * How much of the collider radius may be spent pushing the camera back toward a surface, given
 * the near plane it is rendering through.
 *
 * THIS IS THE 「破圖」 NUMBER. {@link applyObservationFloor} used to spend the WHOLE
 * CAMERA_COLLIDER_RADIUS, on the reasoning that the collision distance has exactly that much
 * clearance reserved - which is true, and which puts the camera exactly ON the surface. A camera
 * on a surface is already through it: the interior canvas clips everything within 0.3 of the
 * lens, so the wall it is resting against is entirely behind the near plane and the player is
 * looking at the outside of their own house. That is the reported 「角色一直往牆壁走時室內視角破
 * 圖」 - it needs the player to be JAMMED into a wall, because only then is the geometric limit
 * small enough for the floor to be spending margin that isn't there.
 *
 * Spending `radius - near - margin` instead keeps the surface a hair in front of the near plane
 * in the worst case, and the whole radius' worth of standoff in every other. Outdoors the near
 * plane IS the collider radius (0.5), so nothing may be spent at all and the floor simply stops
 * where the geometry does.
 */
export function surfaceOverrunAllowance(nearPlane: number): number {
  return Math.max(0, CAMERA_COLLIDER_RADIUS - nearPlane - NEAR_PLANE_MARGIN);
}

/**
 * Raises `distance` to the minimum viewing distance where doing so only spends margin that is
 * actually there - see MIN_OBSERVATION_DISTANCE and {@link surfaceOverrunAllowance}.
 *
 * This is the last thing standing between the player and a camera inside their own head, and it
 * is deliberately not a fixed clamp: it never exceeds what the player asked for, and it never
 * overruns the geometric limit by more than the caller says is safe to spend.
 */
export function applyObservationFloor(
  distance: number,
  collision: number,
  desired: number,
  overrun: number
): number {
  const floor = Math.min(desired, MIN_OBSERVATION_DISTANCE, collision + overrun);
  return Math.max(distance, floor);
}

/**
 * Eases the applied lift, in both directions - see LIFT_RISE_RATE. Rising a little faster than it
 * falls keeps avoidance responsive without the camera hanging high after the obstacle has gone.
 */
export class CameraLiftSolver {
  private current = 0;

  get value(): number {
    return this.current;
  }

  reset() {
    this.current = 0;
  }

  solve(goal: number, delta: number): number {
    const rate = goal > this.current ? LIFT_RISE_RATE : LIFT_RETURN_RATE;
    const t = 1 - Math.exp(-rate * Math.max(0, delta));
    this.current = THREE.MathUtils.lerp(this.current, goal, t);
    if (Math.abs(goal - this.current) < 1e-4) this.current = goal;
    if (this.current < 1e-4) this.current = 0;
    return this.current;
  }
}

/**
 * Rate, in 1/seconds, at which the current distance eases back out once the obstruction clears.
 * Used as `1 - exp(-rate * dt)` so the ease is frame-rate independent - a fixed per-frame
 * fraction (the shape this code used to use) recovers at whatever speed the machine happens to
 * render at, and never actually arrives.
 *
 * ~9 puts a full 7-unit recovery at roughly a third of a second: fast enough that it reads as
 * "the camera came back", slow enough that it is a glide rather than a jump.
 */
const RETURN_RATE = 9;

/** Below this the ease is finished; snapping the last sliver avoids an endless asymptote. */
const SETTLE_EPSILON = 0.001;

/**
 * Resolves Current from Desired + Collision.
 *
 * Inward is instant and outward is smoothed, which is the whole asymmetry: an obstacle appearing
 * must be respected on the very frame it appears (anything else clips), while an obstacle leaving
 * is not urgent and a jump would be jarring. Because the only state kept here is the current
 * distance itself - no "colliding" flag, no timer, no saved pre-collision distance - there is no
 * state that can be left stale, and recovery cannot get stuck: it is always heading for
 * min(desired, collision) as recomputed this frame.
 */
export class CameraDistanceSolver {
  private current = Number.NaN;

  /** The distance the camera was last placed at, or NaN before the first solve. */
  get value(): number {
    return this.current;
  }

  /**
   * Drops the eased state so the next solve() adopts its goal immediately. Call on discontinuities
   * where easing would be wrong (entering/leaving first person or build mode, changing scene) -
   * NOT for leaving an obstacle, which is exactly the case the ease exists for.
   */
  reset(distance?: number) {
    this.current = distance ?? Number.NaN;
  }

  solve(desired: number, collision: number, delta: number): number {
    const goal = Math.max(0, Math.min(desired, collision));

    // First frame (or just reset): adopt the goal rather than easing from nowhere.
    if (!Number.isFinite(this.current)) {
      this.current = goal;
      return goal;
    }

    if (goal <= this.current) {
      // Something is in the way (or the player zoomed in): snap. No interpolation inward.
      this.current = goal;
      return goal;
    }

    // Clear again - glide back out toward the player's own setting.
    const t = 1 - Math.exp(-RETURN_RATE * Math.max(0, delta));
    this.current = THREE.MathUtils.lerp(this.current, goal, t);
    if (goal - this.current < SETTLE_EPSILON) this.current = goal;
    return this.current;
  }
}

/**
 * An upright, Y-axis-rotated box the camera may not sit INSIDE — as opposed to one it may not see
 * past. Outdoors the player's Home is the only one.
 */
export interface CameraContainmentBox {
  /** Centre of the footprint, in world XZ. */
  x: number;
  z: number;
  /** Yaw, radians, matching the placement's own rotation. */
  rotation: number;
  halfWidth: number;
  halfDepth: number;
  /** The solid's vertical extent in world Y. */
  baseY: number;
  topY: number;
}

/**
 * How far the camera may travel along `dir` before it would be standing INSIDE `box`.
 *
 * This is deliberately NOT an occlusion test, and the difference is the whole reason it exists.
 *
 * The raycast probe answers "what is the first thing between the player and the camera", which is
 * the right question for terrain — you cannot be on the far side of a hill. It is the wrong
 * question for a small building on open ground, because it fires on a GRAZE: walking past the
 * corner of the Home swept the roof edge across a 14-unit arm and cut it to a few units, so the
 * character doubled in size and sprang back as the corner cleared, over and over. Placing the Home
 * did the same thing once, hard, the instant the building appeared under an arm that was already
 * there. Neither is the camera avoiding anything — in both the camera is well outside the house
 * and perfectly able to see its owner.
 *
 * What actually had to be prevented (see constants/layers.ts) is the camera ending up in the
 * SHELL: the house is under 4 units across and the arm is much longer, so an arm that runs through
 * the building puts the near plane inside a wall and the player sees straight through their own
 * home. That is a containment condition, and this states it exactly: shorten the arm only when the
 * camera's own position would be inside the box, and by exactly enough to stand it outside.
 *
 * @returns the largest distance ≤ `maxDistance` that keeps the camera clear, or `maxDistance` when
 *          the box does not contain the camera at all.
 */
export function solveBoxContainmentLimit(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDistance: number,
  box: CameraContainmentBox,
  radius = CAMERA_COLLIDER_RADIUS
): number {
  // Into the box's own frame, where it is axis-aligned and the test is three slabs.
  const cos = Math.cos(-box.rotation);
  const sin = Math.sin(-box.rotation);
  const rx = origin.x - box.x;
  const rz = origin.z - box.z;
  const ox = rx * cos - rz * sin;
  const oz = rx * sin + rz * cos;
  const dx = dir.x * cos - dir.z * sin;
  const dz = dir.x * sin + dir.z * cos;

  // The collider radius is spent by inflating the box rather than by trimming the answer, so the
  // clearance is kept on every face including the roof — trimming only ever reserves it along the
  // ray, which on a shallow approach to a wall is a fraction of the real standoff.
  const hw = box.halfWidth + radius;
  const hd = box.halfDepth + radius;
  const yLo = box.baseY - radius;
  const yHi = box.topY + radius;

  let tEnter = -Infinity;
  let tExit = Infinity;

  // One slab per axis. A ray parallel to a slab either lies within it for all t or misses outright.
  const axes: ReadonlyArray<readonly [number, number, number, number]> = [
    [ox, dx, -hw, hw],
    [oz, dz, -hd, hd],
    [origin.y, dir.y, yLo, yHi],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-8) {
      if (o < lo || o > hi) return maxDistance;
      continue;
    }
    const inv = 1 / d;
    let t1 = (lo - o) * inv;
    let t2 = (hi - o) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tEnter) tEnter = t1;
    if (t2 < tExit) tExit = t2;
    if (tEnter > tExit) return maxDistance;
  }

  if (tExit <= 0) return maxDistance;
  // Pivot already inside the box. The player is kept out of the Home's solid by their own collision
  // (characterMovement's resolveHomeCollision), so this is only reachable mid-teleport or while a
  // house is being re-sited around a standing player — and the one thing that must not happen then
  // is the arm collapsing onto their head. Leave it alone; the next frame is outside again.
  if (tEnter <= 0) return maxDistance;
  // The box is further away than the camera, or the arm passes clean through and comes out the far
  // side before the camera sits down. Either way the camera is not in the shell — which is the only
  // thing being asked about here.
  if (tEnter >= maxDistance || tExit < maxDistance) return maxDistance;

  return tEnter;
}

const probeOrigin = new THREE.Vector3();
const probeAxisA = new THREE.Vector3();
const probeAxisB = new THREE.Vector3();
const UP_HINT = new THREE.Vector3(0, 1, 0);
const SIDE_HINT = new THREE.Vector3(1, 0, 0);
// (u, v) multipliers of the two perpendicular axes: the centre ray plus the four "corners".
const PROBE_PATTERN: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Scene-driven half of the collision distance: casts from the player outward along the camera's
 * own orbit direction and reports how far it can go before it would be inside something.
 *
 * Completely generic. It knows nothing about houses, trees, walls or furniture - it tests whatever
 * is in the CAMERA_BLOCKER class (see constants/layers.ts), which is declared on container
 * subtrees, so new content inherits its class the moment it is added with no change here. What
 * counts as big enough to go around is a scene-content decision expressed as a class, never an
 * object-by-object test in this file.
 */
export class CameraOcclusionProbe {
  private raycaster = new THREE.Raycaster();
  private hits: THREE.Intersection[] = [];

  constructor() {
    // Layer mask, not a filtered full-scene cast: three skips raycast() entirely for non-matching
    // objects, so the ocean/cloud/grass triangle soup is never touched. See constants/layers.ts.
    this.raycaster.layers.set(CAMERA_BLOCKER_LAYER);
    this.raycaster.near = 0;
  }

  /**
   * @param pivot  where the camera is looking from-behind, i.e. the player's head. Always inside
   *               the playable space, which is what makes casting outward (rather than inward from
   *               the camera's last position) reliable: the ray can never start inside geometry
   *               because the camera drifted there last frame.
   * @returns the largest safe distance along `dir`, never more than `maxDistance` and never less
   *          than MIN_CAMERA_DISTANCE.
   */
  probe(
    scene: THREE.Object3D,
    pivot: THREE.Vector3,
    dir: THREE.Vector3,
    maxDistance: number,
    radius = CAMERA_COLLIDER_RADIUS
  ): number {
    if (!(maxDistance > MIN_CAMERA_DISTANCE)) return maxDistance;

    // Two axes perpendicular to dir. The hint only has to be non-parallel to dir; swapping it near
    // the poles keeps the cross product well-conditioned when looking straight up or down.
    probeAxisA.crossVectors(Math.abs(dir.y) > 0.9 ? SIDE_HINT : UP_HINT, dir).normalize();
    probeAxisB.crossVectors(dir, probeAxisA).normalize();

    let safe = maxDistance;
    let isCentreRay = true;

    for (const [u, v] of PROBE_PATTERN) {
      probeOrigin
        .copy(pivot)
        .addScaledVector(probeAxisA, u * PROBE_LATERAL_OFFSET)
        .addScaledVector(probeAxisB, v * PROBE_LATERAL_OFFSET);

      this.raycaster.set(probeOrigin, dir);
      // Only anything nearer than the best result so far can improve on it, so shrinking `far`
      // each iteration lets three's bounding-sphere test reject most objects outright.
      this.raycaster.far = safe + radius;

      this.hits.length = 0;
      this.raycaster.intersectObject(scene, true, this.hits);
      if (this.hits.length > 0) {
        const hitDistance = this.hits[0].distance;
        // The centre ray starts exactly at the pivot, which is inside the player and therefore
        // always in free space - it is the authority and its hit is always trusted. The four
        // offset rays start PROBE_LATERAL_OFFSET to the side, so when the player is standing that
        // close to a surface those origins can begin *inside* it and report a hit at ~0. Believing
        // that collapses the whole query to the minimum no matter which direction is being asked
        // about, which in turn makes the avoidance-lift search see no way out and give up - i.e.
        // exactly the "camera dives onto the head when you hug a wall" case. Below the offset
        // distance the corner rays know nothing the centre ray does not, so they abstain.
        if (isCentreRay || hitDistance >= PROBE_LATERAL_OFFSET) {
          safe = Math.min(safe, hitDistance - radius);
          if (safe <= MIN_CAMERA_DISTANCE) break;
        }
      }
      isCentreRay = false;
    }

    this.hits.length = 0;
    return Math.max(MIN_CAMERA_DISTANCE, Math.min(maxDistance, safe));
  }
}

/**
 * Clearance reserved around a piece of FURNITURE, as opposed to around a wall.
 *
 * Deliberately smaller than {@link CAMERA_COLLIDER_RADIUS}. That radius is what the room shell
 * reserves, and it is right there: the wall is a plane the camera must never be seen through, and
 * over-reserving costs nothing because the player cannot stand within it either. A wardrobe is a
 * solid standing in the middle of a room the camera has to keep orbiting, and inflating it by half
 * a metre on every face makes it a metre-wider obstacle than it looks — which is how a camera
 * starts moving on its own for pieces it is clearly missing.
 *
 * The floor under it is the near plane (Scene.tsx / the interior canvas both use 0.3): anything
 * less and the camera can rest close enough that the near plane cuts into the piece, which is the
 * "I can see inside the wardrobe" half of the same report.
 */
export const FURNITURE_CAMERA_CLEARANCE = 0.32;

/**
 * Height a piece has to reach before the camera is contained by it at all.
 *
 * The camera cannot descend below `INTERIOR_FLOOR_Y + CAMERA_COLLIDER_RADIUS` indoors, so nothing
 * shorter than that can ever have the camera inside it — and inflating a rug or a doormat by the
 * clearance above would produce a box that technically reaches the camera's floor and shortens the
 * arm for a mat the camera is a metre above. Measured from the piece's own base, so it means "tall
 * enough to be furniture", not "placed high up".
 */
const FURNITURE_CONTAINMENT_MIN_HEIGHT = 0.55;

/**
 * Turns placed furniture into the boxes the camera may not come to rest inside.
 *
 * WHY FURNITURE IS CONTAINED BUT NOT OCCLUDING. Furniture is deliberately absent from
 * CAMERA_BLOCKER (constants/layers.ts) and must stay absent: a raycast blocker fires on a GRAZE,
 * and a room is 12 units across with an arm several units long, so every piece in it would be
 * shortening the arm somewhere almost all of the time — which is what drove the camera onto the
 * player's head the last time this was tried. That reasoning is about OCCLUSION, and it is still
 * correct.
 *
 * It never covered the other half. An arm that passes OVER a sofa is invisible and fine; an arm
 * that ends INSIDE a wardrobe is the camera standing in a solid, and at a 0.3 near plane the piece
 * is cut open and the player is looking at its back faces and through the room behind it. That is
 * 「室內破圖」 and 「Camera 穿過家具」 reported as two things and caused by one. Containment answers
 * exactly it — `solveBoxContainmentLimit` returns the full distance unless the camera's RESTING
 * position is inside the box, so a graze still costs nothing — and it is the same treatment the
 * Home already gets outdoors, for the same reason.
 *
 * Nothing here knows what any piece is. The boxes are the measured footprints
 * (lib/furniturePlacement.ts), so a new item is contained the day it is drawn and a re-modelled one
 * updates itself; there is no table of "tall furniture" to keep in step with the catalog.
 */
export function buildFurnitureContainmentBoxes(
  placements: ReadonlyArray<{ itemId: string; position: readonly number[] | number[]; rotation?: number }>,
  getFootprint: (itemId: string) => {
    cx: number; cz: number; halfW: number; halfD: number; minY: number; maxY: number;
  } | undefined,
  /** The scale the pieces are actually drawn at, since footprints are measured in local units. */
  scale = 1,
): CameraContainmentBox[] {
  const boxes: CameraContainmentBox[] = [];
  for (const placement of placements) {
    const fp = getFootprint(placement.itemId);
    // Not measured yet — exactly one frame after an item type first mounts. Skipping is the
    // honest answer; a guessed box would be worse than none for that frame.
    if (!fp) continue;
    const [px = 0, py = 0, pz = 0] = placement.position;
    const baseY = py + fp.minY * scale;
    const topY = py + fp.maxY * scale;
    if (topY - baseY < FURNITURE_CONTAINMENT_MIN_HEIGHT) continue;

    // The footprint's centre is in the piece's own un-rotated frame, so it turns with the
    // placement — a wall shelf's box hangs off to one side, and that side follows the wall.
    const rotation = placement.rotation || 0;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const ox = fp.cx * scale;
    const oz = fp.cz * scale;
    boxes.push({
      x: px + ox * cos + oz * sin,
      z: pz - ox * sin + oz * cos,
      rotation,
      halfWidth: fp.halfW * scale,
      halfDepth: fp.halfD * scale,
      baseY,
      topY,
    });
  }
  return boxes;
}
