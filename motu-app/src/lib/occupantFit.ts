/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import type { CharacterSkeleton } from '../constants/characterRig';
import { CHARACTER_ROOT_SCALE, toWorld } from '../constants/characterRig';
import type { BodyPose, PostureId, PostureSpec } from '../constants/interactionPostures';
import { getPosture } from '../constants/interactionPostures';
import type { SuspendedSpec } from './outdoorMotion';
import { resolveOccupancyFrame, rideLegTrail, settleFrom } from './interactionPosture';

/**
 * WHERE THE BODY GOES ON A PIECE OF FURNITURE — solved from the body's own VOLUMES, and then held
 * there frame by frame while the piece moves under it.
 *
 * ## What this replaced, and why it had to
 *
 * The anchor used to be a JOINT placed on a SURFACE: the hip joint on the cushion, the feet on the
 * mattress, with the body's thickness either ignored or stood in for by one number. Every clipping
 * report about sitting and lying came out of that one shortcut, because this character is not
 * thin anywhere it touches furniture:
 *
 *   木製鞦韆   the hip joint sat on the middle of a 10 cm plank and the legs hung straight down
 *              from it — through the plank, out of its underside.
 *   沙發       the hip joint sat on the cushion one leg-radius behind its front edge. The leg is a
 *              0.14-thick capsule, so half the thigh was inside the cushion and the whole leg ran
 *              down through the seat's front face: 12.5 cm deep on 奢華沙發.
 *   床         the body was laid out with its feet on the mattress and its head held up by an angle
 *              worked out for a skull centred on its neck joint. The default model's skull hangs
 *              5 cm below that joint, so its head went 20 cm into the mattress.
 *
 * Nothing in the old maths could see any of it: the checks tested the leg's AXIS against the seat
 * (a line has no thickness) and the torso's bottom against the cushion (the leg is not the torso).
 *
 * ## What it does now
 *
 * The rig declares what the body OCCUPIES (constants/characterRig.ts's `BodyVolumes`: a sphere
 * for the skull, capsules for the torso and limbs). Seen from the side — the plane the body bends
 * in — every one of those is a disc or a stadium, and "does the body clear the seat" is plane
 * geometry that can be solved exactly, once, when the interaction is described:
 *
 *   OVER AN EDGE   a seat whose legs hang over its front lip: the hip goes where the leg's own
 *                  surface rests on the lip — {@link fitOverEdge}. A knee-less leg cannot sit
 *                  further back than that without passing through the seat, at any angle.
 *   ON A SURFACE   a bath floor, a lounger, a mattress: the body is lowered until its lowest
 *                  volume rests on the surface — {@link fitOnSurface}.
 *
 * and then, every frame, the posture's lean, the idle and a swinging piece's arc are all applied
 * about the body's PIVOT — the hip of a seated body, the soles of a lying one
 * ({@link resolveOccupantPose}). The pivot used to be the character ROOT, which for a seated body
 * is a point in mid-air half a metre below the cushion, so every degree of lean slid the hips along
 * the seat: 6.7 cm on every chair, and up to 9 cm back and forth along the plank of a moving swing.
 *
 * Pure (three.js maths only — no scene graph, no React), so the controller, the browser harness and
 * `npm run audit:interactions` all run exactly this.
 */

/**
 * How far every volume is held off the furniture, world units. About a centimetre: enough that a
 * limb resting on a surface never z-fights through it, too little to read as a gap.
 */
export const CONTACT_CLEARANCE = 0.012;

const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// ---------------------------------------------------------------------------------------------
// THE BODY SEEN FROM THE SIDE
// ---------------------------------------------------------------------------------------------

/**
 * A disc or a (tapered) stadium in the sagittal plane: `u` forward, `v` up, world units. `ra`
 * and `rb` are the radii at the two ends — the leg is thicker at the thigh than at the ankle.
 */
interface Capsule2 {
  au: number; av: number;
  bu: number; bv: number;
  ra: number; rb: number;
  part: 'leg' | 'torso' | 'head';
}

/** The lowest point of a capsule's outline. */
function lowestOf(c: Capsule2): number {
  return Math.min(c.av - c.ra, c.bv - c.rb);
}

/**
 * The posed body's volumes in the plane it bends in, relative to its PIVOT.
 *
 * `pitch` tips the whole body about the pivot (positive leans forward). `legAngle` is the legs'
 * angle off straight down in the PIECE'S frame — the frame the pitch is measured in too, so it
 * already includes the pitch. `pivotY` is where the pivot is on the body, LOCAL: the hip joint for
 * a seated body, 0 (the soles) for a lying one.
 */
function sideProfile(s: CharacterSkeleton, pivotY: number, pitch: number, legAngle: number): Capsule2[] {
  const v = s.volumes;
  const upU = Math.sin(pitch);
  const upV = Math.cos(pitch);
  const atU = (localY: number) => upU * toWorld(localY - pivotY);
  const atV = (localY: number) => upV * toWorld(localY - pivotY);

  // A leg hangs from the hip joint along its own -Y; `du, dv` is that direction in the piece's
  // frame, and a leg-local y of Y is -Y along it.
  const hu = atU(s.hip.y);
  const hv = atV(s.hip.y);
  const du = Math.sin(legAngle);
  const dv = -Math.cos(legAngle);
  const headY = s.head.y + v.head.y;
  return [
    {
      au: hu - du * toWorld(v.leg.top), av: hv - dv * toWorld(v.leg.top),
      bu: hu - du * toWorld(v.leg.bottom), bv: hv - dv * toWorld(v.leg.bottom),
      ra: toWorld(v.leg.radius), rb: toWorld(v.leg.footRadius), part: 'leg',
    },
    {
      au: atU(s.torso.y - v.torso.halfLength), av: atV(s.torso.y - v.torso.halfLength),
      bu: atU(s.torso.y + v.torso.halfLength), bv: atV(s.torso.y + v.torso.halfLength),
      ra: toWorld(v.torso.depth), rb: toWorld(v.torso.depth), part: 'torso',
    },
    {
      au: atU(headY), av: atV(headY), bu: atU(headY), bv: atV(headY),
      ra: toWorld(v.head.radius), rb: toWorld(v.head.radius), part: 'head',
    },
  ];
}

/**
 * Signed distance from a point to the SEAT QUADRANT — everything behind the lip (u ≤ 0) and below
 * the seat's top face (v ≤ 0), with the lip's top edge at the origin. Negative inside.
 *
 * A quadrant rather than the seat's real cross-section on purpose: under the lip is a sofa's front
 * panel, or a swing's bare board, or a chair's legs. A leg that clears the quadrant clears all
 * three, and nothing about the piece has to be known beyond where its seat stops.
 */
function quadrantDistance(u: number, v: number): number {
  if (u <= 0 && v <= 0) return -Math.min(-u, -v);
  return Math.hypot(Math.max(u, 0), Math.max(v, 0));
}

/** The smallest clearance of a stadium from the quadrant, less its radius there. Negative = inside. */
function clearanceFromSeat(c: Capsule2, ou: number, ov: number): number {
  // Not convex across the quadrant's corner, so sampled rather than solved: 48 steps along a
  // half-metre limb is a step a centimetre, and the distance cannot change faster than the step.
  let best = Infinity;
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const d = quadrantDistance(ou + c.au + (c.bu - c.au) * t, ov + c.av + (c.bv - c.av) * t)
      - (c.ra + (c.rb - c.ra) * t);
    if (d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// THE TWO FITS
// ---------------------------------------------------------------------------------------------

/**
 * WHERE A SEATED HIP GOES, relative to the seat's front lip, with the legs hanging at `legAngle`
 * (off straight down, in the piece's frame) and the body leaning by `pitch`.
 *
 * ## Why the answer is at the lip rather than behind it
 *
 * This character has no knee: its leg is one straight capsule from the hip to the sole. A person
 * sits with the thigh along the cushion and bends at the knee over the edge; this leg cannot, so a
 * hip placed anywhere BEHIND the lip sends the leg through the seat on its way down. The only leg
 * that avoids that from behind the lip is one lying flat along the top — the mannequin pose.
 *
 * The one placement that seats the body without the leg entering the piece is where the lip
 * touches the leg's own SURFACE: the hip one leg-radius out from the lip, square to the leg. The leg
 * then rests on the edge the way a thigh does, and the torso — wider than that gap — sits over the
 * seat behind it. And because the lip is then exactly one radius from the hip joint, turning the
 * leg only moves its surface round the joint's own circle: it can swing a long way either side
 * before it reaches the seat, which is what lets a swing's rider pump their legs without them
 * passing through the plank ({@link legSlack}).
 *
 * If the torso or the skull would then be below the seat's top face (legacy's torso reaches below
 * its hip joint), the body is slid up along the leg — which keeps the lip on the leg's surface —
 * just far enough to clear it.
 *
 * Returns the hip's offset from the lip: `u` forward of it, `v` above the seat's top face.
 */
export function fitOverEdge(s: CharacterSkeleton, pitch: number, legAngle: number): { u: number; v: number } {
  const r = toWorld(s.volumes.leg.radius) + CONTACT_CLEARANCE;
  const sin = Math.sin(legAngle);
  const cos = Math.cos(legAngle);
  const profile = sideProfile(s, s.hip.y, pitch, legAngle);
  // Slide `t` up the leg's axis from the tangent placement.
  const place = (t: number) => ({ u: r * cos - t * sin, v: r * sin + t * cos });
  const clear = (t: number) => {
    const { u, v } = place(t);
    return profile.every((c) => clearanceFromSeat(c, u, v) >= (c.part === 'leg' ? -1e-4 : CONTACT_CLEARANCE));
  };
  if (clear(0)) return place(0);
  let lo = 0;
  let hi = 0.05;
  while (!clear(hi) && hi < 1.6) hi *= 2;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (clear(mid)) hi = mid; else lo = mid;
  }
  return place(hi);
}

/**
 * How far a hanging leg may swing either way from the angle it was fitted at before its surface
 * reaches the lip, radians.
 *
 * The lip sits `r + clearance` from the hip joint, on the leg's back; turning the leg by `a` brings
 * its surface `r·(1 − cos a)` nearer, and nothing more. So the slack is the angle that uses up the
 * clearance — about 20° on the shipped rigs, more than a swing's rider swings their legs through.
 * The pose clamps to it (see {@link resolveOccupantPose}), so the guarantee is structural rather
 * than a hope about amplitudes.
 */
export function legSlack(s: CharacterSkeleton): number {
  const r = toWorld(s.volumes.leg.radius);
  return Math.acos(r / (r + CONTACT_CLEARANCE));
}

/**
 * HOW HIGH A BODY RESTING ON A SURFACE HAS TO BE: its pivot's height above the surface so that
 * its LOWEST volume rests on it, less however far the surface gives.
 *
 * `give` is the catalog's 0..1 softness: the body settles that fraction of its own back's depth
 * into the surface (a mattress, a hammock's cloth). 0 is a bench.
 */
export function fitOnSurface(
  s: CharacterSkeleton,
  pivotY: number,
  pitch: number,
  legAngle: number,
  give = 0,
): number {
  let lowest = Infinity;
  for (const c of sideProfile(s, pivotY, pitch, legAngle)) lowest = Math.min(lowest, lowestOf(c));
  const sink = toWorld(s.volumes.torso.depth) * Math.min(1, Math.max(0, give));
  return -lowest + CONTACT_CLEARANCE - sink;
}

/** A lying body's profile: pivoted about its soles, legs along the body. */
function lyingProfile(s: CharacterSkeleton, rise: number): Capsule2[] {
  const pitch = -(Math.PI / 2 - rise);
  return sideProfile(s, 0, pitch, -pitch);
}

/**
 * HOW FAR A LYING BODY'S HEAD IS HELD UP, radians above flat — derived from the volumes, not typed.
 *
 * The body pivots about its soles. Laid flat on its back it would rest on whatever reaches lowest,
 * and on this character that is the SKULL, by a lot: the head is 0.24 deep behind its centre and
 * the back only 0.10. So the rise is the smallest angle at which the head's lowest point is no lower
 * than the rest of the body's — a rigid doll laid on a bed, resting on its heels and the back of its
 * head — or, when the piece says there is something under the head (a pillow: `headRest`), no lower
 * than that.
 *
 * The version this replaced divided the difference of two radii by the head joint's height, which
 * is the same idea for a skull centred ON its joint with a back as deep as the body is wide — i.e.
 * legacy — and put the default model's head 20 cm into the mattress.
 */
export function lieHeadRise(s: CharacterSkeleton, headLift = 0): number {
  const ok = (a: number) => {
    let body = Infinity;
    let head = Infinity;
    for (const c of lyingProfile(s, a)) {
      const low = lowestOf(c);
      if (c.part === 'head') head = low; else body = Math.min(body, low);
    }
    return head >= body + headLift - 1e-4;
  };
  if (ok(0)) return 0;
  let lo = 0;
  let hi = 1.2;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

/** The body's pitch while lying — negative tips the chest backwards. See {@link lieHeadRise}. */
export function liePitch(s: CharacterSkeleton, headLift = 0): number {
  return -(Math.PI / 2 - lieHeadRise(s, headLift));
}

/**
 * How far a lying body reaches from its soles, world units — what has to fit on the mattress.
 * The crown's distance along the surface once the head is held up by {@link lieHeadRise}.
 */
export function lieBodyReach(s: CharacterSkeleton, headLift = 0): number {
  const height = toWorld(s.head.y + s.head.crownRise - s.soleY);
  return height * Math.cos(lieHeadRise(s, headLift));
}

// ---------------------------------------------------------------------------------------------
// THE FIT A SPOT CARRIES
// ---------------------------------------------------------------------------------------------

/**
 * Everything about where the body goes that does not change from frame to frame — solved once,
 * when the interaction is described (lib/furnitureInteraction.ts), and carried on the spot.
 */
export interface OccupantFit {
  /** The pivot at rest, WORLD: the hip joint of a seated body, the soles of a lying one. */
  pivot: { x: number; y: number; z: number };
  /** The same point in the PIECE'S own frame (unrotated, at the scale it is drawn). */
  pivotLocal: { x: number; y: number; z: number };
  /** Where the pivot is on the body, LOCAL: the hip joint's height, or 0 for the soles. */
  pivotY: number;
  /**
   * The body's pitch relative to the piece that is NOT the posture's own lean — the recline of a
   * lying body ({@link liePitch}); 0 for everything that sits upright.
   */
  recline: number;
  /**
   * The legs' angle off straight down, in the PIECE'S frame, for a posture that hangs them over an
   * edge or lays them along a surface. Null when the posture animates them itself (the climb onto a
   * bed).
   */
  legAngle: number | null;
  /** How far either side of {@link legAngle} the legs may swing without touching the piece. */
  legSlack: number;
  /** The piece's own yaw, and the occupant's facing relative to it. */
  pieceYaw: number;
  facing: number;
  /** The placement's origin, WORLD — what a moving piece swings relative to. */
  origin: { x: number; y: number; z: number };
  /**
   * Hand grips — a swing's ropes — as two vertical lines at ±`lateral` across the occupant and
   * `forward` along their facing, in the PIECE'S frame. The arms are aimed at them every frame, so
   * the hands stay on the ropes however the body leans and the seat swings.
   */
  grip: { lateral: number; forward: number } | null;
}

/**
 * The legs' resting angle for a posture that hangs them: the posture's own `legHang` (body
 * language — how far forward someone lets their legs hang) unless the floor is near enough to put
 * the feet on, in which case `reachFloor` lowers them to it.
 */
function hangAngle(posture: PostureSpec, s: CharacterSkeleton, hipAboveFloor: number): number {
  const hang = posture.legHang ?? 0.35;
  if (posture.legs !== 'reachFloor') return hang;
  const legLength = toWorld(s.hip.y - s.soleY);
  if (hipAboveFloor >= legLength) return hang;
  return Math.max(hang, Math.acos(hipAboveFloor / legLength));
}

export interface FitRequest {
  posture: PostureId;
  skeleton: CharacterSkeleton;
  /** The placement: where the piece stands, and its yaw. */
  origin: { x: number; y: number; z: number };
  pieceYaw: number;
  /** The anchor on the surface, piece-local: the front lip's midpoint for a seat, the spot otherwise. */
  anchor: { x: number; z: number };
  surfaceY: number;
  facing: number;
  /** Seats: the anchor IS the front lip, and the legs hang over it. */
  overEdge: boolean;
  give?: number;
  /** Beds: how far above the surface the thing under the head is (a pillow's top). */
  headLift?: number;
  grip?: { lateral: number; forward?: number } | null;
}

/** Solves where the body goes. See the module note for the two cases. */
export function fitOccupant(req: FitRequest): OccupantFit {
  const s = req.skeleton;
  const posture = getPosture(req.posture);
  const lean = posture.lean ?? 0;
  let pivotY: number;
  let recline = 0;
  let legAngle: number | null = null;
  let du = 0;
  let dv: number;

  if (posture.anchoring === 'side') {
    // Lying: about the soles, head held up just enough — or onto the pillow.
    pivotY = 0;
    recline = liePitch(s, req.headLift ?? 0);
    dv = fitOnSurface(s, 0, recline + lean, -(recline + lean), req.give);
  } else if (req.overEdge) {
    // Legs over the lip. The floor they may reach for is the one the piece stands on.
    pivotY = s.hip.y;
    let angle = hangAngle(posture, s, req.surfaceY + toWorld(s.volumes.leg.radius));
    let fit = fitOverEdge(s, lean, angle);
    for (let i = 0; i < 4; i++) {
      const next = hangAngle(posture, s, req.surfaceY + fit.v);
      if (Math.abs(next - angle) < 1e-4) break;
      angle = next;
      fit = fitOverEdge(s, lean, angle);
    }
    legAngle = angle;
    du = fit.u;
    dv = fit.v;
  } else {
    // Sitting ON the surface with the legs along it (a bath, a lounger): lowered onto it.
    pivotY = s.hip.y;
    legAngle = posture.legs === 'extendForward' ? Math.PI / 2 : posture.legHang ?? 0;
    dv = fitOnSurface(s, s.hip.y, lean, legAngle, req.give);
  }

  // The pivot in the piece's frame: the anchor, stepped forward along the occupant's facing, lifted.
  const pivotLocal = {
    x: req.anchor.x + Math.sin(req.facing) * du,
    y: req.surfaceY + dv,
    z: req.anchor.z + Math.cos(req.facing) * du,
  };
  const cos = Math.cos(req.pieceYaw);
  const sin = Math.sin(req.pieceYaw);
  return {
    pivot: {
      x: req.origin.x + pivotLocal.x * cos + pivotLocal.z * sin,
      y: req.origin.y + pivotLocal.y,
      z: req.origin.z - pivotLocal.x * sin + pivotLocal.z * cos,
    },
    pivotLocal,
    pivotY,
    recline,
    legAngle,
    legSlack: legSlack(s),
    pieceYaw: req.pieceYaw,
    facing: req.facing,
    origin: { ...req.origin },
    grip: req.grip ? { lateral: req.grip.lateral, forward: req.grip.forward ?? 0 } : null,
  };
}

/** The root's height with the body upright on this fit — what the spot reports as its `y`. */
export function fitRootY(fit: OccupantFit): number {
  return fit.pivot.y - toWorld(fit.pivotY);
}

/**
 * The lowest point of the body at rest on this fit, WORLD — whichever volume reaches lowest: the
 * soles of legs hanging over an edge, the back of a body lying on a mattress. What "the body is
 * above the floor it came from" has to be checked against (`npm run audit:ground`); the root is not
 * a part of the body and, for a seated one, is a point in mid-air under the seat.
 */
export function occupantLowestY(fit: OccupantFit, s: CharacterSkeleton, posture: PostureId): number {
  const pitch = fit.recline + (getPosture(posture).lean ?? 0);
  let lowest = Infinity;
  for (const c of sideProfile(s, fit.pivotY, pitch, fit.legAngle ?? -pitch)) lowest = Math.min(lowest, lowestOf(c));
  return fit.pivot.y + lowest;
}

// ---------------------------------------------------------------------------------------------
// FRAME BY FRAME
// ---------------------------------------------------------------------------------------------

/** A piece that is moving under its occupant, this frame. */
export interface PieceMotion {
  spec: SuspendedSpec;
  /** `suspendedAngle` — the SAME number the piece's own model is drawn at this frame. */
  angle: number;
  /** `suspendedSag`, world units. */
  sag: number;
}

export interface OccupantPoseInput {
  posture: PostureId;
  skeleton: CharacterSkeleton;
  fit: OccupantFit;
  /** The spot's x/z — where the controller eases the logical position to. */
  spotX: number;
  spotZ: number;
  /** 0..1 through the mount/dismount timeline. */
  progress: number;
  /** Seconds on any monotonic clock — the idle. */
  time: number;
  /** The floor the body stood on before it got on. */
  groundY: number;
  motion: PieceMotion | null;
}

export interface OccupantPose {
  /** The drawn root's offset from the spot, world XZ — added to the logical position. */
  offsetX: number;
  offsetZ: number;
  /** The root height the settle eases toward, world. */
  baseY: number;
  /** Added AFTER that ease: the arc's own rise, which an ease would drag a phase behind the seat. */
  rise: number;
  /** The body's orientation, world. */
  quaternion: THREE.Quaternion;
  joints: BodyPose;
  settle: number;
}

// Scratch — this runs every frame for the one body that is occupying something, and the frame
// loop it runs in is the one the rest of Avatar.tsx keeps allocation-free.
const _q = new THREE.Quaternion();
const _qRest = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _root = new THREE.Vector3();
const _rootRest = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _shoulder = new THREE.Vector3();
const _pose: OccupantPose = {
  offsetX: 0, offsetZ: 0, baseY: 0, rise: 0, quaternion: new THREE.Quaternion(), joints: {}, settle: 0,
};

/**
 * Carries a piece-local point through the piece's swing — rotated by the arc's angle about the
 * piece's own suspension line — and then places it in the world by the piece's yaw and origin. The
 * transform the model applies to its hanging group, so a seat and the hip on it stay together.
 */
function swingPoint(fit: OccupantFit, motion: PieceMotion | null, p: THREE.Vector3, out: THREE.Vector3) {
  out.copy(p);
  if (motion) {
    out.y -= motion.spec.pivotY;
    out.applyAxisAngle(motion.spec.axis === 'x' ? X_AXIS : Z_AXIS, motion.angle);
    out.y += motion.spec.pivotY + motion.sag;
  }
  out.applyAxisAngle(UP, fit.pieceYaw);
  return out.add(_p.set(fit.origin.x, fit.origin.y, fit.origin.z));
}

/** Orientation: piece yaw → as much of the piece's swing as the body follows → facing → pitch. */
function bodyQuaternion(fit: OccupantFit, motion: PieceMotion | null, swing: number, pitch: number, out: THREE.Quaternion) {
  out.setFromAxisAngle(UP, fit.pieceYaw);
  if (motion && swing !== 0) out.multiply(_qa.setFromAxisAngle(motion.spec.axis === 'x' ? X_AXIS : Z_AXIS, swing));
  out.multiply(_qa.setFromAxisAngle(UP, fit.facing));
  return out.multiply(_qa.setFromAxisAngle(X_AXIS, pitch));
}

/**
 * How much of a swing about the piece's `axis` is a PITCH of an occupant facing `facing` on it —
 * ±1 when the axis runs across them (a swing's rider), 0 when it runs along them (a hammock's, which
 * is a roll their legs never see).
 */
function pitchShare(axis: 'x' | 'z', facing: number): number {
  // The occupant's own left-right axis, in the piece's frame, dotted with the swing axis.
  return axis === 'x' ? Math.cos(facing) : -Math.sin(facing);
}

/**
 * THE OCCUPIED BODY, ONE FRAME.
 *
 * The body is attached to the piece at its PIVOT, and everything that moves it is a rotation about
 * that point:
 *
 *   the posture's lean and idle rock   about the pivot, in the piece's frame
 *   the recline of a lying body        about the pivot (the soles)
 *   a swinging piece's arc             the pivot rides the arc as a point OF the piece; the body turns
 *                                      with it by the spec's `bodyFollow`, about the piece's own
 *                                      axis — a pitch for a swing's rider, a roll for a hammock's
 *
 * So the hips stay on the seat whatever the body does above them and whatever the seat does below.
 * The legs and the hands are then placed in the PIECE'S frame and turned back into joint angles: a
 * leg hung clear of the lip stays clear however far the body leans, a hand on a rope stays on it.
 *
 * Returns a shared object: read it before the next call.
 */
export function resolveOccupantPose(i: OccupantPoseInput): OccupantPose {
  const { fit, skeleton: s, motion } = i;
  const posture = getPosture(i.posture);
  const settle = settleFrom(i.progress);
  const follow = motion ? motion.spec.bodyFollow : 1;
  const angle = motion ? motion.angle : 0;
  const swing = angle * follow * settle;

  const frame = resolveOccupancyFrame(i.posture, {
    progress: i.progress, settle, time: i.time, legSwing: 0, tilt: swing,
  });
  const ownPitch = fit.recline * settle + frame.rootPitch;
  // The body's pitch as the PIECE sees it: its own, plus the part of the arc it does not follow.
  const share = motion ? pitchShare(motion.spec.axis, fit.facing) : 0;
  const pitchOnPiece = ownPitch + (swing - angle) * share;

  // ---- where the root is: hung from the pivot, which rides the piece.
  bodyQuaternion(fit, motion, swing, ownPitch, _q);
  _pose.quaternion.copy(_q);
  swingPoint(fit, motion, _a.set(fit.pivotLocal.x, fit.pivotLocal.y, fit.pivotLocal.z), _pivot);
  _root.copy(_pivot).sub(_b.set(0, toWorld(fit.pivotY), 0).applyQuaternion(_q));

  // The same body with the piece at rest: what the settle eases toward. The arc's share comes back
  // separately — as `rise` and in the XZ offset — so the controller can apply it after the ease.
  bodyQuaternion(fit, null, 0, ownPitch, _qRest);
  swingPoint(fit, null, _a.set(fit.pivotLocal.x, fit.pivotLocal.y, fit.pivotLocal.z), _pivot);
  _rootRest.copy(_pivot).sub(_b.set(0, toWorld(fit.pivotY), 0).applyQuaternion(_qRest));

  _pose.settle = settle;
  _pose.offsetX = (_root.x - i.spotX) * settle;
  _pose.offsetZ = (_root.z - i.spotZ) * settle;
  _pose.baseY = THREE.MathUtils.lerp(i.groundY, _rootRest.y, settle) + frame.rootRise;
  _pose.rise = (_root.y - _rootRest.y) * settle;

  // ---- the legs, placed in the piece's frame. A leg's angle off straight down there is minus
  // (its joint angle + the body's pitch there), so the joint is the inverse — with the target
  // clamped to the swing the fit guarantees stays clear of the piece.
  const joints = frame.joints;
  if (fit.legAngle !== null) {
    const trail = rideLegTrail(posture, swing);
    const lo = fit.legAngle - fit.legSlack;
    const hi = fit.legAngle + fit.legSlack;
    (joints.leftLeg ??= {}).x = (-clamp(fit.legAngle - trail.left, lo, hi) - pitchOnPiece) * settle;
    (joints.rightLeg ??= {}).x = (-clamp(fit.legAngle - trail.right, lo, hi) - pitchOnPiece) * settle;
  }

  // ---- the arms, in the direction the posture means rather than the angle it wrote.
  compensateArmSplay(joints, s, settle);

  // ---- the hands on the ropes (aimed with the splay already taken into account).
  if (fit.grip && settle > 0) {
    _qInv.copy(_q).invert();
    for (const side of [-1, 1] as const) {
      const aim = gripAim(s, fit, motion, side, _root, _qInv);
      if (!aim) continue;
      const name = side < 0 ? 'leftArm' : 'rightArm';
      const held = joints[name] ?? {};
      joints[name] = {
        x: THREE.MathUtils.lerp(held.x ?? 0, aim.x, settle),
        y: 0,
        z: THREE.MathUtils.lerp(held.z ?? 0, aim.z, settle),
      };
    }
  }
  _pose.joints = joints;
  return _pose;
}

/**
 * TAKES A MODEL'S OWN ARM SPLAY BACK OUT of a posture's arm angles — so that a posture means the
 * same DIRECTION on every model, which is what it was written as.
 *
 * The posture table is body language written against the legacy rig, whose arms hang straight down
 * at a joint angle of zero: 「雙手放在大腿上」 is `z: ±0.16`, 「雙手合十」 is `z: ±0.09`. The authored
 * model's arms do not hang straight down — they are modelled splayed 30° out and the pose is
 * re-applied under the joint (constants/characterRig.ts's `volumes.arm.restZ`). So the same joint
 * angle on that model put every hand 30° further out than the posture said: hands off the thighs
 * and into the seat, hands that were meant to be clasped a shoulder-width apart, a bather's arms out
 * through the side walls of the tub (6.3 cm, `npm run audit:interactions`).
 *
 * Applied only to the arms a posture actually names, and scaled by `weight` — the posture's own
 * strength — so the arms ease from the model's natural hang into the posture's direction and back,
 * and a model whose arms hang straight (restZ 0) is untouched.
 */
export function compensateArmSplay(joints: BodyPose, s: CharacterSkeleton, weight = 1): BodyPose {
  const splay = s.volumes.arm.restZ;
  if (splay === 0 || weight <= 0) return joints;
  if (joints.leftArm) joints.leftArm.z = (joints.leftArm.z ?? 0) - splay * weight;
  if (joints.rightArm) joints.rightArm.z = (joints.rightArm.z ?? 0) + splay * weight;
  return joints;
}

const _aim = { x: 0, z: 0 };

/**
 * The joint angles that put one hand on its rope.
 *
 * The arm is one rigid segment, so this is an AIM rather than a chain solve: find the point on the
 * rope at arm's length from the shoulder — the upper one, where a hand on a swing's rope is — and
 * turn the arm to point at it. The arm hangs at its own rest splay (`restZ`) under the joint, so that
 * is taken back out: the joint's XYZ Euler has to turn (0,-1,0)-splayed-by-restZ onto the target.
 *
 * Worked in the ROOT's frame, LOCAL units: the arm joints are the root's children.
 */
function gripAim(
  s: CharacterSkeleton,
  fit: OccupantFit,
  motion: PieceMotion | null,
  side: -1 | 1,
  root: THREE.Vector3,
  toBody: THREE.Quaternion,
): { x: number; z: number } | null {
  const g = fit.grip!;
  // Two points on the rope, in the piece's frame, carried through the swing into the world, then
  // into the body's.
  const lateral = side * g.lateral;
  const px = Math.sin(fit.facing) * g.forward + Math.cos(fit.facing) * lateral;
  const pz = Math.cos(fit.facing) * g.forward - Math.sin(fit.facing) * lateral;
  swingPoint(fit, motion, _b.set(px, fit.pivotLocal.y, pz), _a);
  _a.sub(root).applyQuaternion(toBody).divideScalar(CHARACTER_ROOT_SCALE);
  swingPoint(fit, motion, _shoulder.set(px, fit.pivotLocal.y + 1, pz), _b);
  _b.sub(root).applyQuaternion(toBody).divideScalar(CHARACTER_ROOT_SCALE);

  _shoulder.set(side * s.shoulder.x, s.shoulder.y, 0);
  // Each hand takes the rope on its own side; a rope on the far side of the body is not reachable.
  if ((_a.x - _shoulder.x) * side < 0) return null;
  const reach = Math.abs(s.volumes.arm.hand.y);
  _b.sub(_a).normalize();
  _a.sub(_shoulder);
  // |a + t·dir| = reach  →  t² + 2(a·dir)t + |a|² − reach² = 0; the larger root is the higher point.
  const bq = _a.dot(_b);
  const disc = bq * bq - (_a.lengthSq() - reach * reach);
  const t = disc >= 0 ? -bq + Math.sqrt(disc) : -bq;
  const dir = _a.addScaledVector(_b, t).normalize();

  //   Rz(c + restZ)·(0,-1,0) = (sin(c+rz), -cos(c+rz), 0), and then Rx(a) makes it
  //   (sin(c+rz), -cos(c+rz)·cos a, -cos(c+rz)·sin a).
  const restZ = side < 0 ? s.volumes.arm.restZ : -s.volumes.arm.restZ;
  _aim.z = Math.asin(clamp(dir.x, -1, 1)) - restZ;
  _aim.x = Math.atan2(-dir.z, -dir.y);
  return _aim;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
