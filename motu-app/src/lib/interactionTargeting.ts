/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { InteractionTarget } from './furnitureInteraction';
import type { Obb2 } from './furniturePlacement';

/**
 * THE ONE ANSWER TO 「玩家現在按 E 會對什麼做事」 — candidate → score → selected target.
 *
 * ## What this replaced
 *
 * Three separate stages each picked "the" target, and none of them looked at the player:
 *
 *   1. Three/Avatar.tsx          kept ONE piece of furniture — the nearest box, first in the save
 *                                on a tie (`distance >= bestDistance` → the earlier one stays).
 *   2. InteractionPromptTracker  sorted the survivors of every category by raw distance — to
 *                                anchors at different heights, so a wardrobe's badge (hung over
 *                                its 2 m top) measured further away than a stool's.
 *   3. handleAction              acted on whichever CATEGORY the prompt showed, then re-read that
 *                                category's own single slot.
 *
 * So a player standing between two pieces — 「A ← 玩家 → B」, both boxes within arm's reach — was
 * offered whichever came first in the save, whichever way they faced, and turning round to B did
 * nothing. NPCs and merchants had the same flaw one level down: one bus slot each, last writer in
 * frame order wins.
 *
 * ## The pipeline now
 *
 *   sources publish candidates  (furniture: Avatar's reach scan; NPC/merchant/pet: their movers;
 *                                the Home and 整理: the tracker itself)
 *        │  every candidate states WHERE the interaction happens (`point`) and WHAT pressing does
 *        ▼
 *   selectInteractionTarget     eligibility (in range, not behind a wall) → score (proximity,
 *        │                      facing, camera) → priority tier → hysteresis against last frame
 *        ▼
 *   playerBus.interactionTarget ONE object. The badge's text, its position, its key, and what
 *                                the E key / tap executes are all read off it — nothing downstream
 *                                searches again.
 *
 * Pure: no three.js scene, no React, no bus. `npm run test:interaction-targeting` drives it with
 * real measured furniture.
 */

export type InteractionTargetKind = 'furniture' | 'building' | 'npc' | 'pet' | 'merchant' | 'tidy';
export type InteractionScope = 'island' | 'interior';

/**
 * What pressing the action key on this target DOES — carried by the target itself, so the badge
 * and the key cannot be pointed at one thing and fire another.
 *
 *   `furniture`   the body is driven onto / up to the piece (Three/Avatar.tsx owns that).
 *   `enter-home`  the view change through the front door.
 *   `event`       a window event for the feature that owns the rest (pet panel, merchant shop,
 *                 NPC conversation, 整理). `detail` names WHICH one — the listener must act on
 *                 that, not on whatever its own slot says a frame later.
 */
export type InteractionAction =
  | { type: 'furniture'; target: InteractionTarget }
  | { type: 'enter-home' }
  | { type: 'event'; name: string; detail?: Record<string, unknown> };

/**
 * One thing the player could interact with right now — the InteractionDefinition resolved into
 * world space for this frame.
 */
export interface InteractionCandidate {
  /** Stable across frames (`furniture:<instanceId>`, `npc:<id>`, `building:player-home` …). */
  id: string;
  kind: InteractionTargetKind;
  scope: InteractionScope;
  /**
   * THE INTERACTION POINT — where the interaction physically happens: a seat's cushion, a bed's
   * mattress, a wardrobe's doors, the Home's front door, above a resident's head. The badge's
   * arrow points here. Never a mesh bounding box's top or a root transform: each source resolves
   * it from its own geometry (lib/furnitureInteraction.ts's resolveInteractionPoint,
   * hooks/usePlayerHome.ts's getHomeInteractionPoint, …).
   */
  point: { x: number; y: number; z: number };
  /**
   * Where "in front of me" and "is anything in the way" are measured TO, on the ground plane:
   * the nearest point of the target's own region. For a sofa that is the edge of its box nearest
   * the player (so a player squared up to its long side is facing it, whatever end the seat
   * anchor is at); for a point-like target it is simply where it stands.
   */
  aimX: number;
  aimZ: number;
  /** Distance from the player to the target's region, in the source's own metric. */
  distance: number;
  /** Beyond this the target is not offered at all. */
  reach: number;
  /**
   * The distance at which the player is as close as they can get — touching. Proximity is
   * measured over (contact, reach], so a piece the player is pressed against scores the same as
   * a door they are standing on the mat of, whatever the two sources' distance metrics are.
   */
  contact: number;
  /**
   * Tier. Compared before the score: a lower tier is only offered when nothing in a higher one
   * is eligible. Everything is 0 except the always-at-heel companion (−1), which would otherwise
   * be the nearest thing to the player everywhere they go.
   */
  priority: number;
  /**
   * Selected regardless of competition — the piece the player is currently sitting or lying on,
   * whose action is 起身. Nothing else may take the key while the body is on a piece.
   */
  locked: boolean;
  /** The placement whose box this is, so line of sight does not count the target as its own obstacle. */
  ownerId: string | null;
  /** The badge text: the verb — 「坐下」, 「進入 我的家」, 「與餅乾兔園丁聊天」. */
  label: string;
  /** Touch-button icon id (UI/InteractionPrompt.tsx maps it to a component). */
  icon: string;
  action: InteractionAction;
}

/** The player, as far as targeting cares: where they stand and which way they face. */
export interface TargetingViewer {
  x: number;
  z: number;
  /** Body yaw, Avatar's convention: forward = (sin yaw, cos yaw). */
  yaw: number;
  /** Camera yaw, CameraController's convention: forward = (−sin yaw, −cos yaw). Optional. */
  cameraYaw?: number | null;
}

/** A 2D wall face, as constants/interiorShell.ts's buildWallSegments emits them. */
export interface WallLike {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  isDoorway?: boolean;
}

export interface TargetingObstacles {
  /** Interior wall faces. Crossing one EXCLUDES a target — you cannot reach through a wall. */
  walls?: readonly WallLike[];
  /** Enclosed structures (the Home's shell). Crossing one EXCLUDES a target. */
  structures?: readonly Obb2[];
  /**
   * Placed pieces' walk boxes. Crossing one only LOWERS a target's score: a lamp between you and
   * a bench is something you reach past, and the bench stays usable when it is the only choice —
   * but a clear target of similar standing wins over it.
   */
  props?: readonly { id: string; box: Obb2 }[];
}

/**
 * THE WEIGHTS, and why they are these.
 *
 * Facing is 0..1 LINEAR IN ANGLE: 1 dead ahead, 0.5 square to the side, 0 directly behind.
 *
 * Proximity is 1 − t², where t is how much of the target's reach the player is using (0 touching,
 * 1 at the edge). Quadratic on purpose: within easy reach, a few centimetres say nothing about
 * what the player means — both things are right there — while a target near the EDGE of its
 * reach is one they are passing or leaving, and should fade. A linear falloff got this wrong in
 * the live game: in the study (a desk, its chair tucked in) a player beside the chair who turned
 * squarely to it was still offered the desk's corner 67° away, because the desk was 16 cm nearer
 * and a furniture reach is only ~0.55 m from touching to out of range, so those 16 cm outweighed
 * the turn. No facing weight fixes that under a linear falloff without breaking the case below.
 *
 * The facing weight then has a range, set by the two halves of the brief:
 *
 *   「B 在正前方、A 在側後方，A 稍微近一點 → 選 B」   needs w × Δfacing > Δproximity.
 *       A side-rear target (~135°) scores 0.25 on facing against B's 1.0. Holds for w above ~0.7
 *       even when A is touching and B is two-thirds of the way out.
 *   「但不能完全忽略距離」  a piece the player is TOUCHING at 90° (1 + 0.5·w) must beat one at the
 *       edge of reach dead ahead (~0.1 + 1·w). Holds for w below ~1.8.
 *   The study: touching the desk corner at 60–67° must lose to the chair squarely ahead at 2/3 of
 *       its reach. Holds for w above ~1.25.
 *
 * 1.5 is in the middle of what is left.
 *
 * Camera facing is a tie-breaker, never the decision: at 0.25 it can only settle targets the body
 * is roughly equidistant and equi-angled to — which is the case a player resolves by looking. In
 * first person the camera IS the body's heading, so it simply adds to facing.
 *
 * `obstructed` is half a term: a prop in the line of reach costs about as much as a quarter-turn
 * away, so an unobstructed alternative the player is facing wins, while a lone target behind a
 * pot plant is still offered.
 */
export const TARGETING_WEIGHTS = {
  proximity: 1,
  facing: 1.5,
  camera: 0.25,
  obstructed: 0.5,
} as const;

/** 1 dead ahead, 0.5 at 90°, 0 directly behind — from a cosine. */
function facingTerm(dot: number): number {
  return 1 - Math.acos(Math.max(-1, Math.min(1, dot))) / Math.PI;
}

/**
 * HYSTERESIS. A challenger must beat the current target by this much to take the prompt.
 *
 * Above any score noise a standing player produces (walk-resolve jitter is millimetres, ~0.01 of
 * proximity; a few degrees of body sway, ~0.03 of facing), below anything deliberate: turning 20°
 * toward the other piece moves its weighted facing by ~0.17 (and the old target's the other
 * way), a quarter-turn by 0.75, and a step of 0.1 toward it moves proximity by ~0.18 over a
 * furniture reach. So the badge holds still while the player fidgets between A and B, and
 * follows them the moment they turn or step.
 */
export const TARGET_SWITCH_MARGIN = 0.15;

/** Closer than this to the aim point there is no meaningful direction — the player is at/on it. */
const FACING_DEAD_ZONE = 0.05;
/** Boxes are shrunk by this before a line-of-sight test, so grazing a corner is not "blocked". */
const OBSTACLE_GRAZE = 0.04;

/** Why a candidate scored what it did — filled in by {@link evaluateCandidate}. */
export interface CandidateEvaluation {
  eligible: boolean;
  /** Only meaningful when eligible. */
  score: number;
  proximity: number;
  /** Body facing dot product toward the aim point, −1 (directly behind) … 1 (dead ahead). */
  facing: number;
  /** Camera facing dot product, or null when no camera yaw was given. */
  cameraFacing: number | null;
  blocked: 'structure' | 'prop' | null;
}

export function createEvaluation(): CandidateEvaluation {
  return { eligible: false, score: 0, proximity: 0, facing: 0, cameraFacing: null, blocked: null };
}

/**
 * Scores one candidate for this viewer, into `out` (so the per-frame caller allocates nothing).
 *
 * Eligibility: in reach, and no wall or enclosed structure between the player and the target's
 * region. Facing is NOT an eligibility gate — a lone target behind the player is still offered
 * (walking backwards into a chair, the pet at your heel), it simply loses to anything in front.
 */
export function evaluateCandidate(
  c: InteractionCandidate,
  viewer: TargetingViewer,
  obstacles: TargetingObstacles | null,
  out: CandidateEvaluation = createEvaluation(),
): CandidateEvaluation {
  out.eligible = false;
  out.score = 0;
  out.blocked = null;
  out.cameraFacing = null;

  if (!(c.distance <= c.reach)) {
    out.proximity = 0;
    out.facing = 0;
    return out;
  }

  const span = Math.max(1e-6, c.reach - c.contact);
  const used = Math.min(1, Math.max(0, (c.distance - c.contact) / span));
  out.proximity = 1 - used * used;

  const dx = c.aimX - viewer.x;
  const dz = c.aimZ - viewer.z;
  const len = Math.hypot(dx, dz);
  if (len < FACING_DEAD_ZONE) {
    out.facing = 1;
    if (viewer.cameraYaw != null) out.cameraFacing = 1;
  } else {
    const nx = dx / len;
    const nz = dz / len;
    out.facing = Math.sin(viewer.yaw) * nx + Math.cos(viewer.yaw) * nz;
    if (viewer.cameraYaw != null) {
      out.cameraFacing = -Math.sin(viewer.cameraYaw) * nx - Math.cos(viewer.cameraYaw) * nz;
    }
  }

  // Line of reach: from the player to the target's own nearest point. A wall or the Home's shell
  // in between means the target is on the far side of it — a sofa in the next room, the front
  // door seen from round the side of the house. Those are not "less likely", they are unreachable.
  if (!c.locked && obstacles && len >= FACING_DEAD_ZONE) {
    if (obstacles.walls && segmentCrossesWalls(viewer.x, viewer.z, c.aimX, c.aimZ, obstacles.walls)) {
      out.blocked = 'structure';
      return out;
    }
    if (obstacles.structures) {
      for (const box of obstacles.structures) {
        if (segmentHitsObb(viewer.x, viewer.z, c.aimX, c.aimZ, box, OBSTACLE_GRAZE)) {
          out.blocked = 'structure';
          return out;
        }
      }
    }
    if (obstacles.props) {
      for (const prop of obstacles.props) {
        if (prop.id === c.ownerId) continue;
        // A piece the player is standing ON (a deck) or inside the edge of is not between them
        // and anything — and nor is one the TARGET stands on (a lamp on its table).
        if (obbContains(prop.box, viewer.x, viewer.z) || obbContains(prop.box, c.aimX, c.aimZ)) continue;
        if (segmentHitsObb(viewer.x, viewer.z, c.aimX, c.aimZ, prop.box, OBSTACLE_GRAZE)) {
          out.blocked = 'prop';
          break;
        }
      }
    }
  }

  out.eligible = true;
  out.score = TARGETING_WEIGHTS.proximity * out.proximity
    + TARGETING_WEIGHTS.facing * facingTerm(out.facing)
    + (out.cameraFacing == null ? 0 : TARGETING_WEIGHTS.camera * facingTerm(out.cameraFacing))
    - (out.blocked === 'prop' ? TARGETING_WEIGHTS.obstructed : 0);
  return out;
}

const SCRATCH = createEvaluation();

/**
 * THE SELECTION — which single candidate owns the action key this frame.
 *
 *   1. A `locked` candidate wins outright (the seat the player is on).
 *   2. Ineligible candidates are dropped (out of reach, behind a wall).
 *   3. Highest priority tier, then highest score. An exact tie goes to the nearer one and then to
 *      the lower id — never to iteration order, which is what "first in the save wins" was.
 *   4. HYSTERESIS: if last frame's target is still eligible and in the winning tier, it keeps
 *      the key unless the winner beats it by {@link TARGET_SWITCH_MARGIN}.
 *
 * `previousId` is the caller's memory; the function holds no state, so the island's and the
 * interior's selectors cannot leak into each other.
 */
export function selectInteractionTarget<C extends InteractionCandidate>(
  candidates: readonly C[],
  viewer: TargetingViewer,
  obstacles: TargetingObstacles | null,
  previousId: string | null,
): C | null {
  let best: C | null = null;
  let bestScore = -Infinity;
  let previous: C | null = null;
  let previousScore = -Infinity;

  for (const c of candidates) {
    if (c.locked) return c;
    const ev = evaluateCandidate(c, viewer, obstacles, SCRATCH);
    if (!ev.eligible) continue;
    if (c.id === previousId) {
      previous = c;
      previousScore = ev.score;
    }
    if (!best || outranks(c, ev.score, best, bestScore)) {
      best = c;
      bestScore = ev.score;
    }
  }

  if (
    previous && best && previous !== best
    && previous.priority === best.priority
    && bestScore < previousScore + TARGET_SWITCH_MARGIN
  ) {
    return previous;
  }
  return best;
}

function outranks(a: InteractionCandidate, aScore: number, b: InteractionCandidate, bScore: number): boolean {
  if (a.priority !== b.priority) return a.priority > b.priority;
  if (aScore !== bScore) return aScore > bScore;
  if (a.distance !== b.distance) return a.distance < b.distance;
  return a.id < b.id;
}

// ---------------------------------------------------------------------------------------------
// 2D line-of-reach geometry
// ---------------------------------------------------------------------------------------------

function obbContains(b: Obb2, x: number, z: number): boolean {
  const rx = x - b.cx;
  const rz = z - b.cz;
  return Math.abs(rx * b.ux + rz * b.uz) <= b.halfW && Math.abs(rx * b.vx + rz * b.vz) <= b.halfD;
}

/**
 * Does the segment (x1,z1)→(x2,z2) pass through `b` shrunk by `shrink`? Liang–Barsky in the box's
 * own frame. Touching the surface (an aim point ON the box) does not count.
 */
export function segmentHitsObb(
  x1: number, z1: number, x2: number, z2: number, b: Obb2, shrink = 0,
): boolean {
  const hw = b.halfW - shrink;
  const hd = b.halfD - shrink;
  if (hw <= 0 || hd <= 0) return false;
  const rx1 = x1 - b.cx;
  const rz1 = z1 - b.cz;
  const rx2 = x2 - b.cx;
  const rz2 = z2 - b.cz;
  const u1 = rx1 * b.ux + rz1 * b.uz;
  const v1 = rx1 * b.vx + rz1 * b.vz;
  const u2 = rx2 * b.ux + rz2 * b.uz;
  const v2 = rx2 * b.vx + rz2 * b.vz;
  let t0 = 0;
  let t1 = 1;
  const du = u2 - u1;
  const dv = v2 - v1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-du, u1 + hw)) return false;
  if (!clip(du, hw - u1)) return false;
  if (!clip(-dv, v1 + hd)) return false;
  if (!clip(dv, hd - v1)) return false;
  return t1 - t0 > 1e-6;
}

/** Does the segment cross any non-doorway wall face (proper crossing, not an endpoint touch)? */
export function segmentCrossesWalls(
  x1: number, z1: number, x2: number, z2: number, walls: readonly WallLike[],
): boolean {
  for (const w of walls) {
    if (w.isDoorway) continue;
    if (segmentsCross(x1, z1, x2, z2, w.x1, w.z1, w.x2, w.z2)) return true;
  }
  return false;
}

function segmentsCross(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): boolean {
  const d1 = orient(cx, cz, dx, dz, ax, az);
  const d2 = orient(cx, cz, dx, dz, bx, bz);
  const d3 = orient(ax, az, bx, bz, cx, cz);
  const d4 = orient(ax, az, bx, bz, dx, dz);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function orient(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  return (bx - ax) * (pz - az) - (bz - az) * (px - ax);
}
