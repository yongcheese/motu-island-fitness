/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 互動目標與互動提示 —— 「可互動物件偵測 → candidate → target selection → interaction point →
 * prompt → action」整條流程。
 *
 * Run with `npm run test:interaction-targeting`. Same tsx-script style as the other `test:*` checks.
 *
 * ## What it is guarding
 *
 *  §1  **Where the prompt points.** Each target's Interaction Point is where the interaction
 *      happens — the Home's door, a seat's cushion, the mattress, a wardrobe's doors — not the
 *      top of a bounding box. The Home's badge used to float over its roof ridge (~5 m up).
 *  §2  **Which target is chosen.** 「A ← 玩家 → B」: both pieces in reach, the player facing B,
 *      must get B. The old scan kept the nearest box and, on a tie, the first in the save — so it
 *      offered A whichever way the player turned. Plus: distance still counts, walls and the
 *      house's own shell exclude, props obstruct, the companion is a lower tier, an occupied seat
 *      is locked, and hysteresis stops A/B flicker.
 *  §3  **Prompt ≡ action.** The selected candidate carries its own action, and for furniture that
 *      action's piece is the one whose point the badge is drawn at.
 *  §4  **Every interactive piece in the catalog** gets a point on or within its own measured box.
 *
 * Everything runs against the modules the game ships: real models measured into the real
 * footprint registry (scripts/lib/measureFurnitureModel.ts), the real reach scan and description
 * (lib/furnitureInteraction.ts), the real candidate adapters the tracker uses
 * (lib/interactionSources.ts) and the real selection (lib/interactionTargeting.ts).
 */

import { ALL_ITEMS, getItemById, isStandableItem } from '../src/constants/items';
import { AUTHORED_SKELETON, toWorld } from '../src/constants/characterRig';
import { HOUSE_STYLES, HOUSE_FOOTPRINT } from '../src/constants/houseStyles';
import { buildWallSegments } from '../src/constants/interiorShell';
import { ItemCategory, type PlacedItem } from '../src/types';
import {
  collectInteractablesInReach, describeInteraction, findNearbyInteractable, type ReachHit,
} from '../src/lib/furnitureInteraction';
import { getFootprint, makeObb, measureFootprint, obbContainsPoint } from '../src/lib/furniturePlacement';
import { nearestLightSwitch, registerLightSwitch } from '../src/lib/interiorLights';
import {
  TARGET_SWITCH_MARGIN,
  evaluateCandidate,
  segmentCrossesWalls,
  selectInteractionTarget,
  type InteractionCandidate,
  type TargetingObstacles,
  type TargetingViewer,
} from '../src/lib/interactionTargeting';
import {
  HOME_CANDIDATE_ID, fillFurnitureCandidate, fillHomeCandidate, furnitureCandidateId, homeSolidObstacle,
  makeCandidate,
} from '../src/lib/interactionSources';
import {
  HOME_ENTRY_RADIUS, getHomeDoorPosition, getHomeInteractionPoint, getPlayerHome, homeEntryDistance,
} from '../src/hooks/usePlayerHome';
import { getHouseDoorFrame, getHouseVisualHeight } from '../src/components/Three/HouseModel';
import type { FurnitureInReach } from '../src/lib/playerBus';
import { INTERIOR_SCALE, ISLAND_SCALE, buildModelObject3D } from './lib/measureFurnitureModel';

// React logs "Invalid hook call" through console.error when a model component that uses hooks is
// invoked outside a renderer — expected here (see the other audits).
const realError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('Invalid hook call')) return;
  realError(...args);
};

let failures = 0;
let checks = 0;
function ok(name: string, condition: boolean, detail = ''): void {
  checks++;
  if (condition) console.log(`  ok    ${name}${detail ? `   ${detail}` : ''}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ''}`);
  }
}
const f2 = (v: number) => v.toFixed(2);

const SKEL = AUTHORED_SKELETON;
const drawScale = (id: string) =>
  (getItemById(id)?.category === ItemCategory.BUILDING ? ISLAND_SCALE : INTERIOR_SCALE);

/** Measures a real model into the runtime footprint registry, the way mounting it in a scene does. */
function measure(id: string): void {
  const piece = buildModelObject3D(id, drawScale(id));
  if (!piece) throw new Error(`cannot build ${id}`);
  measureFootprint(id, piece);
}

let seq = 0;
function place(itemId: string, x: number, z: number, rotation = 0, y = 0): PlacedItem {
  return { instanceId: `${itemId}#${seq++}`, itemId, position: [x, y, z], rotation };
}

/** Yaw (Avatar's convention: forward = (sin, cos)) that faces from (x, z) toward (tx, tz). */
const yawToward = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);

/** Every placed piece's walk box, as the tracker builds its line-of-reach props. */
function propsOf(placements: readonly PlacedItem[]): { id: string; box: ReturnType<typeof makeObb> }[] {
  const out: { id: string; box: ReturnType<typeof makeObb> }[] = [];
  for (const p of placements) {
    const fp = getFootprint(p.itemId);
    if (!fp?.walk || isStandableItem(p.itemId)) continue;
    out.push({ id: p.instanceId, box: makeObb(fp.walk, p.position[0], p.position[2], p.rotation || 0) });
  }
  return out;
}

/**
 * One frame of the furniture half of the tracker, exactly as the game runs it: the avatar's reach
 * scan and description, then the tracker's adapter.
 */
function furnitureCandidates(px: number, pz: number, placements: readonly PlacedItem[]): InteractionCandidate[] {
  const hits: ReachHit[] = [];
  const n = collectInteractablesInReach(px, pz, placements, hits);
  const out: InteractionCandidate[] = [];
  for (let i = 0; i < n; i++) {
    const h = hits[i];
    const target = describeInteraction(h.placement, SKEL, 0, { x: px, z: pz });
    if (!target) continue;
    const f: FurnitureInReach = {
      target, distance: h.distance, reach: h.reach, aimX: h.aimX, aimZ: h.aimZ, occupied: false,
    };
    const c = makeCandidate(furnitureCandidateId(target.instanceId), 'furniture', 'interior');
    fillFurnitureCandidate(c, f);
    out.push(c);
  }
  return out;
}

function select(
  candidates: InteractionCandidate[],
  viewer: TargetingViewer,
  obstacles: TargetingObstacles | null = null,
  previousId: string | null = null,
): InteractionCandidate | null {
  return selectInteractionTarget(candidates, viewer, obstacles, previousId);
}

/** A bare point-like candidate (a resident, a merchant, the pet) for the pure selection checks. */
function pointCandidate(id: string, x: number, z: number, px: number, pz: number, reach = 2.5, priority = 0): InteractionCandidate {
  const c = makeCandidate(id, 'npc', 'island');
  c.point = { x, y: 1, z };
  c.aimX = x;
  c.aimZ = z;
  c.distance = Math.hypot(x - px, z - pz);
  c.reach = reach;
  c.priority = priority;
  c.label = id;
  c.action = { type: 'event', name: 'npc-interact', detail: { npcId: id } };
  return c;
}

const BED = 'item-bed';
const WARDROBE = 'item-wardrobe';
const SOFA = 'item-21';
const FRIDGE = 'item-fridge';
const STOVE = 'item-stove';
const DESK = 'item-desk';
const CHAIR = 'item-chair';
const CAMPFIRE = 'deco-campfire';
const DECK = 'deco-viewing-deck';
const BENCH = 'deco-bench-garden';
for (const id of [BED, WARDROBE, SOFA, FRIDGE, STOVE, DESK, CHAIR, CAMPFIRE, DECK, BENCH]) measure(id);

// =============================================================================================
console.log('\n=== §1 interaction points: the prompt points where the interaction happens ===');
// =============================================================================================
{
  // --- the Home: on its front door, not over its roof --------------------------------------
  for (const style of HOUSE_STYLES) {
    for (const rotation of [0, Math.PI / 2, 2.3]) {
      const home = getPlayerHome({ home: { position: [1.5, 0, -2], rotation, currentStyle: style.id } } as never)!;
      const point = getHomeInteractionPoint(home);
      const door = getHouseDoorFrame(home.style);
      const oldAnchorY = home.position[1] + getHouseVisualHeight(home.style) + 0.6;
      // Back into the house's own frame.
      const dx = point.x - home.position[0];
      const dz = point.z - home.position[2];
      const localX = dx * Math.cos(rotation) - dz * Math.sin(rotation);
      const localZ = dx * Math.sin(rotation) + dz * Math.cos(rotation);
      const onLeaf = point.y > door.bottomY && point.y < door.bottomY + door.height;
      const outside = localZ > HOUSE_FOOTPRINT.halfDepth && localZ < HOUSE_FOOTPRINT.halfDepth + 0.3;
      if (rotation === 0 || !onLeaf || !outside || Math.abs(localX) > 1e-6) {
        ok(`Home ${style.name} rot ${f2(rotation)}: point is ON the door leaf, just outside the wall`,
          onLeaf && outside && Math.abs(localX) < 1e-6,
          `y ${f2(point.y)} (leaf ${f2(door.bottomY)}–${f2(door.bottomY + door.height)}; old anchor ${f2(oldAnchorY)}), local (${f2(localX)}, ${f2(localZ)})`);
      }
    }
  }
  const home = getPlayerHome({ home: { position: [0, 0, 0], rotation: 0, currentStyle: 'starter' } } as never)!;
  const p = getHomeInteractionPoint(home);
  const old = getHouseVisualHeight(home.style) + 0.6;
  ok('Home: the prompt came down from the roofline to the door', p.y < old - 2.5, `${f2(old)} m → ${f2(p.y)} m`);

  // --- furniture ------------------------------------------------------------------------------
  const describeAt = (itemId: string, px: number, pz: number) => {
    const placement = place(itemId, 0, 0);
    return { placement, t: describeInteraction(placement, SKEL, 0, { x: px, z: pz })!, fp: getFootprint(itemId)! };
  };
  const oldAnchor = (fp: NonNullable<ReturnType<typeof getFootprint>>) => fp.maxY + 0.45;

  {
    const { t, fp } = describeAt(SOFA, 0, 2);
    ok('Sofa (sit): point on the cushion — at the seat surface, not over the backrest',
      Math.abs(t.interactionPoint.y - (t.interaction.surfaceY ?? -1)) < 1e-6 && t.interactionPoint.y < fp.maxY,
      `y ${f2(t.interactionPoint.y)} (seat ${f2(t.interaction.surfaceY ?? NaN)}, box top ${f2(fp.maxY)}, old ${f2(oldAnchor(fp))})`);
    ok('Sofa: point is inside its own footprint', footprintHolds(fp, t.interactionPoint.x, t.interactionPoint.z));
  }
  {
    const { t, fp } = describeAt(BED, 0, 3);
    const box = makeObb(fp, 0, 0, 0);
    const feet = t.spot!;
    const toCentreFromPoint = Math.hypot(t.interactionPoint.x - box.cx, t.interactionPoint.z - box.cz);
    const toCentreFromFeet = Math.hypot(feet.x - box.cx, feet.z - box.cz);
    ok('Bed (lie): point is on the mattress, walked back from the feet toward the middle',
      footprintHolds(fp, t.interactionPoint.x, t.interactionPoint.z) && toCentreFromPoint < toCentreFromFeet
        && Math.abs(t.interactionPoint.y - (t.interaction.surfaceY ?? -1)) < 1e-6,
      `feet→centre ${f2(toCentreFromFeet)}, point→centre ${f2(toCentreFromPoint)}, y ${f2(t.interactionPoint.y)}`);
  }
  {
    const { t, fp } = describeAt(WARDROBE, 0, 2);
    const front = fp.cz + fp.halfD;
    const shoulder = toWorld(SKEL.shoulder.y);
    ok('Wardrobe (open): point on its FRONT face, at hand height — not on its 2 m top',
      Math.abs(t.interactionPoint.z - front) < 1e-6 && Math.abs(t.interactionPoint.y - Math.min(fp.maxY, shoulder)) < 1e-6
        && t.interactionPoint.y < fp.maxY,
      `z ${f2(t.interactionPoint.z)} (front ${f2(front)}), y ${f2(t.interactionPoint.y)} (top ${f2(fp.maxY)}, old ${f2(oldAnchor(fp))})`);
  }
  {
    // A piece with no front: the point is on whichever side the player is on.
    const east = describeAt(CAMPFIRE, 2, 0).t.interactionPoint;
    const west = describeAt(CAMPFIRE, -2, 0).t.interactionPoint;
    ok('Campfire (nearest): point is on the side the player walked up on', east.x > 0 && west.x < 0,
      `east ${f2(east.x)}, west ${f2(west.x)}`);
  }
  {
    // Standing ON the deck: the point is the edge they will look out over, not their own feet.
    const fp = getFootprint(DECK)!;
    const placement = place(DECK, 0, 0);
    const standX = fp.cx;
    const standZ = fp.cz + 0.1;
    const t = describeInteraction(placement, SKEL, 0, { x: standX, z: standZ })!;
    const p = t.interactionPoint;
    const onEdge = Math.abs(Math.abs(p.x - fp.cx) - fp.halfW) < 1e-6 || Math.abs(Math.abs(p.z - fp.cz) - fp.halfD) < 1e-6;
    ok('Viewing deck (standing on it): point on the edge of the deck they look out over, not at their feet',
      onEdge && Math.hypot(p.x - standX, p.z - standZ) > 0.3,
      `player (${f2(standX)}, ${f2(standZ)}) → point (${f2(p.x)}, ${f2(p.z)}), y ${f2(p.y)}`);
  }
  {
    // Different pieces do not share one formula: none of these is "box centre, top + 0.45".
    const same = [SOFA, BED, WARDROBE].filter((id) => {
      const { t, fp } = describeAt(id, 0, 3);
      return Math.abs(t.interactionPoint.y - oldAnchor(fp)) < 1e-6
        && Math.abs(t.interactionPoint.x - fp.cx) < 1e-6 && Math.abs(t.interactionPoint.z - fp.cz) < 1e-6;
    });
    ok('No piece is still anchored at its bounding-box top', same.length === 0, same.join(', '));
  }
}

function footprintHolds(fp: NonNullable<ReturnType<typeof getFootprint>>, x: number, z: number): boolean {
  return obbContainsPoint(makeObb({ ...fp, halfW: fp.halfW + 0.02, halfD: fp.halfD + 0.02 }, 0, 0, 0), x, z);
}

// =============================================================================================
console.log('\n=== §2 target selection ===');
// =============================================================================================

// A kitchen run: the fridge to the WEST, the stove to the EAST, both facing +Z, with a gap the
// player can stand in. Saved fridge-first — the old scan's tie-breaker.
const fridgeFp = getFootprint(FRIDGE)!;
const stoveFp = getFootprint(STOVE)!;
const GAP = 0.9;
const fridge = place(FRIDGE, -(GAP / 2 + fridgeFp.halfW + fridgeFp.cx), 0);
const stove = place(STOVE, GAP / 2 + stoveFp.halfW - stoveFp.cx, 0);
const kitchen = [fridge, stove];
const kitchenProps = propsOf(kitchen);
const between = { x: 0, z: 0.1 };
const idOf = (p: PlacedItem) => furnitureCandidateId(p.instanceId);

{
  // 1. single object
  const sofa = place(SOFA, 0, 0);
  const sfp = getFootprint(SOFA)!;
  const front = sfp.cz + sfp.halfD + 0.45;
  const pick = select(furnitureCandidates(0, front, [sofa]), { x: 0, z: front, yaw: Math.PI });
  ok('1. single piece in reach → offered', pick?.id === idOf(sofa));
  const far = select(furnitureCandidates(0, front + 3, [sofa]), { x: 0, z: front + 3, yaw: Math.PI });
  ok('1. walked out of reach → nothing (no stale prompt)', far === null);
}
{
  // 2. A and B far apart
  const a = place(SOFA, -4, 0);
  const b = place(WARDROBE, 4, 0);
  const sfp = getFootprint(SOFA)!;
  const wfp = getFootprint(WARDROBE)!;
  const atA = select(furnitureCandidates(-4, sfp.halfD + 0.5, [a, b]), { x: -4, z: sfp.halfD + 0.5, yaw: Math.PI });
  const atB = select(furnitureCandidates(4, wfp.halfD + 0.5, [a, b]), { x: 4, z: wfp.halfD + 0.5, yaw: Math.PI });
  ok('2. far apart: at A → A, at B → B', atA?.id === idOf(a) && atB?.id === idOf(b));
}
{
  // 3–6. A and B right next to each other, player between
  const cands = furnitureCandidates(between.x, between.z, kitchen);
  ok('3. both pieces are candidates when the player stands between them', cands.length === 2,
    cands.map((c) => c.label).join(' / '));
  const facingA = select(cands, { x: between.x, z: between.z, yaw: -Math.PI / 2 }, { props: kitchenProps });
  const facingB = select(cands, { x: between.x, z: between.z, yaw: Math.PI / 2 }, { props: kitchenProps });
  ok('4. facing A (the fridge) → A', facingA?.id === idOf(fridge), facingA?.label);
  ok('5. facing B (the stove) → B', facingB?.id === idOf(stove), facingB?.label);

  // 6. The reported bug: B in front, A a little NEARER and off to the side-rear.
  const px = -0.12;
  const pz = 0.35;
  const yaw = yawToward(px, pz, stove.position[0], stove.position[2]) - 0.2;
  const c6 = furnitureCandidates(px, pz, kitchen);
  const pick = select(c6, { x: px, z: pz, yaw }, { props: kitchenProps });
  const legacy = findNearbyInteractable(px, pz, kitchen);
  const dA = c6.find((c) => c.id === idOf(fridge))?.distance ?? NaN;
  const dB = c6.find((c) => c.id === idOf(stove))?.distance ?? NaN;
  ok('6. A slightly nearer but behind-left, B dead ahead → B', pick?.id === idOf(stove),
    `dist A ${f2(dA)} < B ${f2(dB)}; nearest-box rule (the old one) would pick ${legacy?.itemId === FRIDGE ? 'A' : 'B'}`);
  ok('6. …and the old nearest-box rule really does pick A here (the root cause)', legacy?.instanceId === fridge.instanceId);
}
{
  // Distance is not ignored: touching A at 90°, B at the far edge of reach dead ahead.
  const a = pointCandidate('touching', 0.5, 0, 0, 0, 2.5);
  const b = pointCandidate('far-ahead', 0, 2.4, 0, 0, 2.5);
  const pick = select([b, a], { x: 0, z: 0, yaw: 0 });
  ok('distance still counts: touching-at-90° beats barely-in-reach-dead-ahead', pick?.id === 'touching');
}
{
  // 7/8. Walk from A to B and back. The prompt switches once each way, never flickers back.
  const walk = (fromX: number, toX: number, yaw: number) => {
    const seen: string[] = [];
    let prev: string | null = null;
    for (let i = 0; i <= 60; i++) {
      const x = fromX + (toX - fromX) * (i / 60);
      const pick = select(furnitureCandidates(x, 0.25, kitchen), { x, z: 0.25, yaw }, { props: kitchenProps }, prev);
      prev = pick?.id ?? null;
      if (seen[seen.length - 1] !== prev) seen.push(prev ?? '∅');
    }
    return seen;
  };
  const ab = walk(fridge.position[0] + 0.2, stove.position[0] - 0.2, Math.PI / 2);
  const ba = walk(stove.position[0] - 0.2, fridge.position[0] + 0.2, -Math.PI / 2);
  ok('7. walking A → B (facing B): A, then B — one switch', ab.join(' → ') === `${idOf(fridge)} → ${idOf(stove)}`,
    ab.map((s) => s.split('#')[0]).join(' → '));
  ok('8. walking B → A (facing A): B, then A — one switch', ba.join(' → ') === `${idOf(stove)} → ${idOf(fridge)}`,
    ba.map((s) => s.split('#')[0]).join(' → '));
}
{
  // 9. Diagonal approach to the sofa from its front-right corner.
  const sofa = place(SOFA, 0, 0);
  let first: string | null = null;
  let d = 3;
  for (; d > 0 && !first; d -= 0.05) {
    const x = d * Math.SQRT1_2;
    const z = getFootprint(SOFA)!.halfD + d * Math.SQRT1_2;
    first = select(furnitureCandidates(x, z, [sofa]), { x, z, yaw: yawToward(x, z, 0, 0) })?.id ?? null;
  }
  ok('9. diagonal approach: offered as soon as it is in reach', first === idOf(sofa), `at ${f2(d)} along the diagonal`);
}
{
  // 10. back to the object
  const sofa = place(SOFA, 0, 0);
  const wardrobe = place(WARDROBE, 0, 2.6, Math.PI);
  const z = getFootprint(SOFA)!.halfD + 0.5;
  const alone = select(furnitureCandidates(0, z, [sofa]), { x: 0, z, yaw: 0 });
  ok('10. back to a lone piece: still offered (it is the only thing in reach)', alone?.id === idOf(sofa));
  const both = furnitureCandidates(0, z + 0.3, [sofa, wardrobe]);
  const pick = select(both, { x: 0, z: z + 0.3, yaw: 0 }, { props: propsOf([sofa, wardrobe]) });
  ok('10. back to one piece, facing another → the one in front', both.length === 2 && pick?.id === idOf(wardrobe),
    `${both.length} in reach → ${pick?.label}`);
}
{
  // 11. many at once, in every order.
  const px = 0;
  const pz = 0;
  const cs = [
    pointCandidate('north', 0, 1.2, px, pz),
    pointCandidate('east', 1.0, 0, px, pz),
    pointCandidate('south', 0, -0.8, px, pz),
    pointCandidate('west', -1.1, 0, px, pz),
    pointCandidate('ne', 0.9, 0.9, px, pz),
  ];
  const answers = new Set<string>();
  const permute = (arr: InteractionCandidate[], k = 0): void => {
    if (k === arr.length) {
      answers.add(select(arr.slice(), { x: px, z: pz, yaw: 0 })?.id ?? '∅');
      return;
    }
    for (let i = k; i < arr.length; i++) {
      [arr[k], arr[i]] = [arr[i], arr[k]];
      permute(arr, k + 1);
      [arr[k], arr[i]] = [arr[i], arr[k]];
    }
  };
  permute(cs);
  ok('11. five in reach: the one ahead wins, and the save/iteration order never matters',
    answers.size === 1 && answers.has('north'), [...answers].join(','));
  // Exact tie: identical score both sides → deterministic (nearer, then id), not "first".
  const l = pointCandidate('tie-b', -1, 0, 0, 0);
  const r = pointCandidate('tie-a', 1, 0, 0, 0);
  ok('11. an exact tie resolves the same way in either order',
    select([l, r], { x: 0, z: 0, yaw: 0 })?.id === select([r, l], { x: 0, z: 0, yaw: 0 })?.id);
}
{
  // 12. obstruction
  // (a) walls. Two rooms side by side (the interior's real 12-unit grid), sharing the wall at
  // x = 6 with a doorway at z ∈ (−1.5, 1.5). The butler talks from 2.4 away — further than that
  // wall is thick — so standing against it in the living room, the butler pottering on the other
  // side used to light 「與管家聊天」 straight through it.
  const walls = buildWallSegments([{ cx: 0, cz: 0 }, { cx: 12, cz: 0 }]);
  const wallFaces = walls.filter((w) => !w.isDoorway && Math.abs(w.x1 - w.x2) < 1e-6 && w.x1 > 5 && w.x1 < 7);
  const px = Math.min(...wallFaces.map((w) => w.x1)) - 0.36;
  const butler = pointCandidate('butler', px + 1.9, 3.5, px, 3.5, 2.4);
  ok('12a. the butler in the next room, 1.9 away through the wall → NOT offered',
    butler.distance < butler.reach && select([butler], { x: px, z: 3.5, yaw: Math.PI / 2 }, { walls }) === null,
    `wall faces at x ${wallFaces.map((w) => f2(w.x1)).join(', ')}`);
  const viaDoor = pointCandidate('butler', px + 1.9, 0.3, px, 0.3, 2.4);
  ok('12a. …and the same distance through the doorway → offered',
    select([viaDoor], { x: px, z: 0.3, yaw: Math.PI / 2 }, { walls })?.id === 'butler');
  // The Q slot uses the same rule for its switch. This room's switch is 1.5 away on another wall;
  // the next room's is on the far face of the shared wall, 0.8 away — nearer, and unreachable.
  const farFace = Math.max(...wallFaces.map((w) => w.x1));
  const thisRoom = registerLightSwitch({ x: px - 1.5, y: 1.3, z: 3.5, promptX: px - 1.2, promptZ: 3.5 });
  const nextRoom = registerLightSwitch({ x: farFace, y: 1.3, z: 3.5, promptX: farFace + 0.3, promptZ: 3.5 });
  const reachable = (s: { promptX: number; promptZ: number }) => !segmentCrossesWalls(px, 3.5, s.promptX, s.promptZ, walls);
  const naive = nearestLightSwitch(px, 3.5);
  const sw = nearestLightSwitch(px, 3.5, undefined, reachable);
  ok('12a. Q: the switch in this room, not the nearer one through the wall',
    naive?.promptX === farFace + 0.3 && sw?.promptX === px - 1.2,
    `nearest by distance alone: ${naive?.promptX === farFace + 0.3 ? 'the one through the wall' : 'this room'}`);
  thisRoom();
  nextRoom();

  // (b) a prop in the line of reach lowers a target; a clear one of equal standing wins.
  const blocked = pointCandidate('behind-pot', 0, 1.5, 0, 0);
  const clear = pointCandidate('clear', 1.5, 0.05, 0, 0);
  const pot = { id: 'pot', box: makeObb({ cx: 0, cz: 0, halfW: 0.2, halfD: 0.2 }, 0, 0.75, 0) };
  const yaw = Math.atan2(1.5, 1.55) ; // halfway between the two
  const pick = select([blocked, clear], { x: 0, z: 0, yaw }, { props: [pot] });
  ok('12b. partly blocked by a prop → the clear target of similar standing wins', pick?.id === 'clear');
  ok('12b. a lone target behind a prop is still offered', select([blocked], { x: 0, z: 0, yaw: 0 }, { props: [pot] })?.id === 'behind-pot');
  const ev = evaluateCandidate(blocked, { x: 0, z: 0, yaw: 0 }, { props: [pot] });
  ok('12b. …marked as obstructed, not excluded', ev.eligible && ev.blocked === 'prop');

  // (c) real geometry: a resident standing on the far side of the sofa is behind its measured walk
  // box — obstructed, still offered alone, and loses to a clear resident of the same standing.
  const sfp = getFootprint(SOFA)!;
  const sofa = place(SOFA, 0, 0);
  const sofaProps = propsOf([sofa]);
  const pz = sfp.cz + sfp.halfD + 0.5;
  const behindSofa = pointCandidate('behind-sofa', 0, sfp.cz - sfp.halfD - 0.4, 0, pz, 2.6);
  const beside = pointCandidate('beside-sofa', sfp.cx + sfp.halfW + 0.6, pz - 0.4, 0, pz, 2.6);
  const evBehind = evaluateCandidate(behindSofa, { x: 0, z: pz, yaw: Math.PI }, { props: sofaProps });
  ok('12c. a resident behind the sofa is obstructed by its real walk box', evBehind.eligible && evBehind.blocked === 'prop');
  const towardBoth = Math.atan2((beside.aimX + behindSofa.aimX) / 2, ((beside.aimZ + behindSofa.aimZ) / 2) - pz);
  ok('12c. …and loses to the clear one beside it', select([behindSofa, beside], { x: 0, z: pz, yaw: towardBoth }, { props: sofaProps })?.id === 'beside-sofa');
}
{
  // The study as the starter house furnishes it: the desk, and its chair tucked in facing it. A
  // player beside the chair who has been looking at the desk turns squarely to the chair. The
  // desk's corner is nearer (16 cm) but 67° off — the chair is what they mean. (Found in the live
  // game: at equal proximity/facing weights the desk kept the prompt.)
  const desk = place(DESK, -0.5, 10);
  const chair = place(CHAIR, -0.5, 11, Math.PI);
  const study = [desk, chair];
  const props = propsOf(study);
  for (const px of [-1.5, 0.5]) {
    const pz = 10.87;
    const cs = furnitureCandidates(px, pz, study);
    const chairC = cs.find((c) => c.id === idOf(chair));
    const deskC = cs.find((c) => c.id === idOf(desk));
    const lookDesk = select(cs, { x: px, z: pz, yaw: yawToward(px, pz, deskC!.aimX, deskC!.aimZ) }, { props });
    const lookChair = select(cs, { x: px, z: pz, yaw: yawToward(px, pz, chairC!.aimX, chairC!.aimZ) }, { props }, lookDesk?.id ?? null);
    ok(`study: beside the chair (x ${px}), turning from the desk to the chair moves the prompt to the chair`,
      lookDesk?.id === idOf(desk) && lookChair?.id === idOf(chair),
      `desk ${f2(deskC!.distance)} vs chair ${f2(chairC!.distance)} from their boxes → ${lookDesk?.label} then ${lookChair?.label}`);
  }
}
{
  // 13. the Home outdoors
  const home = getPlayerHome({ home: { position: [0, 0, 0], rotation: 0, currentStyle: 'starter' } } as never)!;
  const point = getHomeInteractionPoint(home);
  const solid = homeSolidObstacle(home);
  const homeAt = (x: number, z: number, yaw: number) => {
    const d = homeEntryDistance(x, z, home);
    const cs: InteractionCandidate[] = [];
    if (d < HOME_ENTRY_RADIUS) {
      const c = makeCandidate(HOME_CANDIDATE_ID, 'building', 'island');
      fillHomeCandidate(c, point, d, '進入 我的家');
      cs.push(c);
    }
    return { cs, pick: select(cs, { x, z, yaw }, { structures: [solid] }) };
  };
  const mat = getHomeDoorPosition(home);
  ok('13. on the doormat facing the door → 進入我的家', homeAt(mat.x, mat.z, Math.PI).pick?.id === HOME_CANDIDATE_ID);
  const side = homeAt(HOUSE_FOOTPRINT.halfWidth + 0.4, 0.6, -Math.PI / 2);
  ok('13. against the SIDE wall (in the old radius) → not offered through the house',
    side.cs.length === 1 && side.pick === null, `in radius: ${side.cs.length === 1}`);
  const back = homeAt(0, -HOUSE_FOOTPRINT.halfDepth - 0.4, 0);
  ok('13. behind the house → not offered', back.pick === null);

  // A bench right by the door, the player turned to it → the bench, not the house.
  const bench = place(BENCH, 1.6, mat.z + 0.9, Math.PI);
  const bx = 1.3;
  const bzz = mat.z + 0.2;
  const withBench = [...homeAt(bx, bzz, 0).cs, ...furnitureCandidates(bx, bzz, [bench])];
  const pickBench = select(withBench, { x: bx, z: bzz, yaw: yawToward(bx, bzz, bench.position[0], bench.position[2]) }, { structures: [solid] });
  ok('13. at the door but facing the bench beside it → the bench', withBench.length === 2 && pickBench?.id === idOf(bench),
    withBench.map((c) => c.label).join(' / '));
  const pickDoor = select(withBench, { x: bx, z: bzz, yaw: yawToward(bx, bzz, point.x, point.z) }, { structures: [solid] });
  ok('13. same spot, turned to the door → the door', pickDoor?.id === HOME_CANDIDATE_ID);
}
{
  // 15. standing ON the viewing deck
  const fp = getFootprint(DECK)!;
  const deck = place(DECK, 0, 0);
  const cs = furnitureCandidates(fp.cx, fp.cz, [deck]);
  const pick = select(cs, { x: fp.cx, z: fp.cz, yaw: 0 }, { props: propsOf([deck]) });
  ok('15. standing on the viewing deck → its interaction is offered (a deck is floor, not an obstacle)',
    pick?.id === idOf(deck), pick?.label);
}
{
  // occupied lock
  const sofa = place(SOFA, 0, 0);
  const cs = furnitureCandidates(0, getFootprint(SOFA)!.halfD + 0.4, [sofa]);
  cs[0].locked = true;
  const other = pointCandidate('npc-in-front', 0, 3, 0, 1.2, 2.5);
  ok('seated: the seat is locked in (起身) whatever else comes near', select([other, ...cs], { x: 0, z: 1.2, yaw: 0 })?.id === cs[0].id);
}
{
  // priority: the companion at your heel never takes the door's key
  const pet = pointCandidate('pet', 0, 0.6, 0, 0, 2.5, -1);
  const door = pointCandidate('door', 0, -2.4, 0, 0, 3.3, 0);
  ok('companion (tier −1) right in front vs the door behind → the door', select([pet, door], { x: 0, z: 0, yaw: 0 })?.id === 'door');
  ok('companion alone → offered', select([pet], { x: 0, z: 0, yaw: 0 })?.id === 'pet');
}
{
  // hysteresis: stand exactly between A and B, facing neither, with tremor.
  let rngState = 7;
  const rnd = () => ((rngState = (rngState * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5;
  const run = (useMemory: boolean) => {
    let prev: string | null = null;
    let switches = 0;
    for (let i = 0; i < 1200; i++) {
      const x = rnd() * 0.02;
      const z = 0.25 + rnd() * 0.02;
      const pick = select(furnitureCandidates(x, z, kitchen), { x, z, yaw: rnd() * 0.08 }, { props: kitchenProps }, useMemory ? prev : null);
      if (prev && pick?.id !== prev) switches++;
      prev = pick?.id ?? null;
    }
    return switches;
  };
  const withMemory = run(true);
  const without = run(false);
  ok('hysteresis: standing between A and B with tremor → the prompt holds still', withMemory === 0,
    `${withMemory} switches in 1200 frames (without hysteresis: ${without}); margin ${TARGET_SWITCH_MARGIN}`);
  // …and a deliberate turn still switches.
  const cands = furnitureCandidates(0, 0.25, kitchen);
  const a = select(cands, { x: 0, z: 0.25, yaw: -Math.PI / 2 }, { props: kitchenProps });
  const turned = select(cands, { x: 0, z: 0.25, yaw: Math.PI / 2 }, { props: kitchenProps }, a?.id ?? null);
  ok('hysteresis: turning round to B still switches at once', a?.id === idOf(fridge) && turned?.id === idOf(stove));
}
{
  // camera as the tie-breaker
  const l = pointCandidate('left', -1, 0.3, 0, 0);
  const r = pointCandidate('right', 1, 0.3, 0, 0);
  // Body faces +Z (between them). The camera looks toward +X: forward = (−sin cy, −cos cy) = (1, 0) → cy = −π/2.
  const pick = select([l, r], { x: 0, z: 0, yaw: 0, cameraYaw: -Math.PI / 2 });
  ok('camera facing breaks a tie the body cannot', pick?.id === 'right');
}

// =============================================================================================
console.log('\n=== §3 the prompt and the action are one object ===');
// =============================================================================================
{
  const cands = furnitureCandidates(between.x, between.z, kitchen);
  const pick = select(cands, { x: between.x, z: between.z, yaw: Math.PI / 2 }, { props: kitchenProps })!;
  const action = pick.action;
  ok('the selected furniture candidate acts on the very piece its badge points at',
    action.type === 'furniture' && action.target.instanceId === stove.instanceId
      && action.target.interactionPoint === pick.point && pick.label === action.target.verb,
    `badge 「E ${pick.label}」 → ${action.type === 'furniture' ? action.target.itemName : action.type}`);
  const npc = pointCandidate('rabbit', 0, 1, 0, 0);
  ok('an event target names WHICH one in its action',
    npc.action.type === 'event' && (npc.action.detail as { npcId?: string }).npcId === 'rabbit');
}

// =============================================================================================
console.log('\n=== §4 every interactive piece: its point is on its own measured box ===');
// =============================================================================================
{
  const bad: string[] = [];
  let measured = 0;
  for (const item of ALL_ITEMS) {
    if (!item.interactions?.length) continue;
    const piece = buildModelObject3D(item.id, drawScale(item.id));
    if (!piece) continue;
    measureFootprint(item.id, piece);
    const fp = getFootprint(item.id);
    if (!fp) continue;
    measured++;
    for (const rotation of [0, 1.1]) {
      const placement = place(item.id, 2, -1, rotation);
      const box = makeObb({ ...fp, halfW: fp.halfW + 0.03, halfD: fp.halfD + 0.03 }, 2, -1, rotation);
      // From in front, and from the side — a `nearest` piece's point moves with the player.
      for (const [dx, dz] of [[0, 3], [3, 0]]) {
        const from = { x: 2 + dx * Math.cos(rotation) + dz * Math.sin(rotation), z: -1 - dx * Math.sin(rotation) + dz * Math.cos(rotation) };
        const t = describeInteraction(placement, SKEL, 0, from);
        if (!t) continue;
        const p = t.interactionPoint;
        const within = obbContainsPoint(box, p.x, p.z);
        const height = p.y >= fp.minY - 1e-6 && p.y <= fp.maxY + 1e-6;
        if (!within || !height) bad.push(`${item.name} rot ${f2(rotation)}: (${f2(p.x)}, ${f2(p.y)}, ${f2(p.z)}) box y ${f2(fp.minY)}–${f2(fp.maxY)}`);
      }
    }
  }
  ok(`all ${measured} measurable interactive pieces: point on/within the piece, never floating over it`,
    bad.length === 0, bad.slice(0, 8).join('\n          '));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
