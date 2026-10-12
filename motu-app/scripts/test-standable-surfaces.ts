/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 可行走平台（`standable`）—— 站得上去、走得上去、擋得住、不會被地形吞掉。
 *
 * Run with `npm run test:standables`. Same tsx-script style as the other `test:*` checks.
 *
 * ## What it is guarding
 *
 * The report was 「木板／擴增平台變成虛物，玩家直接穿透」 and 「瞭望台的階梯方向相反」. They turned
 * out to be four defects, and each has a section here that would have failed on the old code:
 *
 *  §2  **Every part of a deck was floor and no part was a wall.** The surface lookup used the
 *      model's whole convex outline at one height and the walk resolve skipped decks entirely, so
 *      小型觀景平台's railings, posts and stairs were walked straight through, its 0.9-high deck was
 *      climbed in one frame from any side, and the air beside its stairs was "deck".
 *  §3  **The stairs were reversed** — the highest step farthest from the deck, so they led nowhere.
 *      Checked as a property any stepped piece must have (every walking surface reachable from the
 *      ground one step at a time), not as this model's numbers.
 *  §5  **Decks were buried by the ground.** Seated from their centre and saved as an absolute height,
 *      a pier over the sea sat inside the beach, and a territory expansion grew the island over it.
 *  §6  **The water.** A deck is a pier; the step rule must measure a swimmer from the surface.
 *
 * Everything runs against the modules the game ships: the real models (built into real three.js
 * scene graphs by scripts/lib/measureFurnitureModel.ts), the real `measureFootprint`, and the real
 * `resolveCollisions` the player's controller calls every frame, fed back its own `terrainY` exactly
 * as Three/Avatar.tsx feeds it.
 */

import * as THREE from 'three';
import { buildModelObject3D, ISLAND_SCALE } from './lib/measureFurnitureModel';
import { ALL_ITEMS, getStandableSurface } from '../src/constants/items';
import {
  STAND_RULES,
  getFootprint,
  measureFootprint,
  resolvePlayerAgainstFurniture,
  standTreadTop,
  type StandPart,
} from '../src/lib/furniturePlacement';
import {
  evaluateIslandPlacement,
  getSurfaceAt,
  isGroundedAt,
  reseatIslandPlacements,
  resolvePlacementY,
} from '../src/lib/placementSurfaces';
import { feetFloorY, resolveCollisions } from '../src/components/Three/characterMovement';
import { getTerrainInfo } from '../src/constants/terrain';
import { PLAYER_PHYSICAL_RADIUS } from '../src/utils/placementRules';
import type { PlacedItem, UserProfile } from '../src/types';

let failures = 0;
let checks = 0;

function ok(name: string, condition: boolean, detail = ''): void {
  checks++;
  if (condition) {
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
}

const EPS = 1e-6;
const PLATFORM = 'item-16';            // 木製平台 — no stairs, walked onto from any side
const VIEWING_DECK = 'deco-viewing-deck'; // 小型觀景平台 — 0.9 up, three railings, stairs at local −Z
const TORCH = 'item-20';               // an ordinary prop, for stacking

const STANDABLES = ALL_ITEMS.filter((i) => getStandableSurface(i.id)).map((i) => i.id);

// =================================================================================================
// §1 — measurement. Measured the way the game measures a placed piece: nested under a translated,
//      rotated placement group, as IslandPlacementInstance mounts it after a reload.
// =================================================================================================
console.log('\n=== §1 measurement: parts, treads, and the frame they are measured in ===');

for (const id of [...STANDABLES, TORCH]) {
  const model = buildModelObject3D(id, ISLAND_SCALE)!;
  const placed = new THREE.Group();
  placed.position.set(7.3, 0.3, -4.1);
  placed.rotation.y = 1.1;
  placed.add(model);
  new THREE.Scene().add(placed);
  measureFootprint(id, model);
}

const treadTops = (parts: StandPart[]) => parts.filter((p) => p.tread).map((p) => p.y1);

for (const id of STANDABLES) {
  const fp = getFootprint(id)!;
  const parts = fp.standParts;
  ok(`${id}: measured into parts`, !!parts && parts.length > 0, `${parts?.length ?? 0} parts`);
  if (!parts) continue;
  const top = Math.max(...treadTops(parts));
  ok(`${id}: its highest tread IS the measured walking surface`,
    Math.abs(top - (fp.standY ?? NaN)) < EPS, `tread ${top.toFixed(4)}, standY ${fp.standY?.toFixed(4)}`);
  const aboveDeck = parts.filter((p) => p.y0 > top - EPS);
  ok(`${id}: nothing standing up out of the deck is floor`,
    aboveDeck.every((p) => !p.tread), `${aboveDeck.length} part(s) above the boards, none a tread`);
}

{
  // The frame check: measured under a placement moved to (7.3, 0.3, −4.1) and turned 1.1 rad, the
  // parts still come out in the piece's OWN frame — the deck centred on its origin, its boards at
  // the heights the model draws them. A footprint that baked in the placement transform would be
  // wrong for every other copy and for this one the moment it moved.
  const fp = getFootprint(VIEWING_DECK)!;
  const deck = fp.standParts!.filter((p) => p.tread && Math.abs(p.y1 - fp.standY!) < EPS);
  const minX = Math.min(...deck.map((p) => p.outline.cx - p.outline.halfW));
  const maxX = Math.max(...deck.map((p) => p.outline.cx + p.outline.halfW));
  ok('measured under a moved, rotated placement, the deck is still centred on its own origin',
    Math.abs(minX + maxX) < 1e-3, `x ${minX.toFixed(3)} … ${maxX.toFixed(3)}`);
  ok('...and its walking surface is its four planks', deck.length === 4, `${deck.length} planks`);
}

// =================================================================================================
// §2/§3 — the step rule, and that every stepped piece is reachable one step at a time.
// =================================================================================================
console.log('\n=== §2/§3 the step rule, and stairs that lead somewhere ===');

ok('木製平台 (no stairs) is one step up from the grass',
  getFootprint(PLATFORM)!.standY! <= STAND_RULES.maxStepUp,
  `deck ${getFootprint(PLATFORM)!.standY!.toFixed(3)} ≤ step ${STAND_RULES.maxStepUp}`);
ok('小型觀景平台 is NOT — its stairs are the way up',
  getFootprint(VIEWING_DECK)!.standY! > STAND_RULES.maxStepUp,
  `deck ${getFootprint(VIEWING_DECK)!.standY!.toFixed(3)} > step ${STAND_RULES.maxStepUp}`);

/**
 * Breadth-first over a piece's treads, from the ground: a tread is reachable from another when it
 * is at most a step above it and their outlines are within a foot of each other; from the ground
 * when it is at most a step up. The old reversed stairs fail this — their top step was at the far
 * end, so the deck was a 0.7 climb from the step beside it.
 */
function unreachableTreads(parts: StandPart[]): StandPart[] {
  const treads = parts.filter((p) => p.tread);
  const reached = new Set<StandPart>(treads.filter((t) => t.y1 <= STAND_RULES.maxStepUp + EPS));
  const gap = (a: StandPart, b: StandPart) => {
    // Axis-aligned distance between the two local outlines' boxes: exact for these box treads.
    const dx = Math.max(0, Math.abs(a.tread!.cx - b.tread!.cx) - a.tread!.halfW - b.tread!.halfW);
    const dz = Math.max(0, Math.abs(a.tread!.cz - b.tread!.cz) - a.tread!.halfD - b.tread!.halfD);
    return Math.hypot(dx, dz);
  };
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of treads) {
      if (reached.has(t)) continue;
      for (const r of reached) {
        if (t.y1 - r.y1 <= STAND_RULES.maxStepUp + EPS && gap(t, r) <= 2 * STAND_RULES.footRadius) {
          reached.add(t);
          grew = true;
          break;
        }
      }
    }
  }
  return treads.filter((t) => !reached.has(t) && t.y1 > 0);
}
for (const id of STANDABLES) {
  const stranded = unreachableTreads(getFootprint(id)!.standParts!);
  ok(`${id}: every walking surface is reachable from the ground, one step at a time`,
    stranded.length === 0,
    stranded.length ? `unreachable treads at ${stranded.map((t) => t.y1.toFixed(3)).join(', ')}` : '');
}
{
  const treads = getFootprint(VIEWING_DECK)!.standParts!.filter((p) => p.tread && p.y1 < 0.8).sort((a, b) => a.y1 - b.y1);
  const rises = treads.map((t, i) => t.y1 - (i === 0 ? 0 : treads[i - 1].y1));
  rises.push(getFootprint(VIEWING_DECK)!.standY! - treads[treads.length - 1].y1);
  ok('小型觀景平台\'s stairs have even risers', Math.max(...rises) - Math.min(...rises) < 1e-3,
    rises.map((r) => r.toFixed(3)).join(' / '));
  ok('...each nearer the deck than the one below it — the stairs climb TOWARD the deck',
    treads.every((t, i) => i === 0 || t.tread!.cz > treads[i - 1].tread!.cz),
    treads.map((t) => `${t.y1.toFixed(2)}@z${t.tread!.cz.toFixed(2)}`).join(' → '));
}

// =================================================================================================
// Walking — the player's own controller, frame after frame.
// =================================================================================================

/**
 * A big flat island (territory level 6), so the approaches are on level grass away from the mound
 * and the beach. The pieces stand at (6, _, 6).
 */
const SCALE = 3;
const AT: [number, number] = [6, 6];
const profileOf = (placements: PlacedItem[]) => ({ islandPlacements: placements } as unknown as UserProfile);
const place = (itemId: string, x: number, z: number, rotation: number, instanceId = itemId, placements: PlacedItem[] = []): PlacedItem => ({
  instanceId, itemId, rotation,
  position: [x, resolvePlacementY(itemId, x, z, placements, SCALE, instanceId, rotation), z],
});

type Frame = { x: number; z: number; y: number; support: string | null };
/**
 * Walks from `from` in direction `dir` for `steps` frames of `stride`, the way Avatar does it: a
 * proposed step, one resolve, and the result's `terrainY` handed back as the next `footY`.
 */
function walk(
  placements: PlacedItem[], from: [number, number], dir: [number, number], steps: number,
  opts: { stride?: number; footY?: number | null; swimming?: boolean; scale?: number } = {},
): Frame[] {
  const stride = opts.stride ?? 0.08;
  const islandScale = opts.scale ?? (opts.swimming ? 1 : SCALE);
  const len = Math.hypot(dir[0], dir[1]);
  const pos = new THREE.Vector3(from[0], 0, from[1]);
  let footY: number | null = opts.footY ?? null;
  const frames: Frame[] = [];
  for (let i = 0; i < steps; i++) {
    const test = pos.clone().add(new THREE.Vector3((dir[0] / len) * stride, 0, (dir[1] / len) * stride));
    const r = resolveCollisions({
      testPos: test, currentPos: pos, isInterior: false, islandScale,
      profile: profileOf(placements), home: null, footY, isSwimmingBoundary: !!opts.swimming,
    });
    pos.copy(r.position);
    footY = r.terrainY;
    frames.push({ x: pos.x, z: pos.z, y: footY, support: r.supportId });
  }
  return frames;
}
/** Piece-local direction → world, by the placement's yaw (three.js: x' = x·cos + z·sin). */
const toWorldDir = (lx: number, lz: number, yaw: number): [number, number] =>
  [lx * Math.cos(yaw) + lz * Math.sin(yaw), -lx * Math.sin(yaw) + lz * Math.cos(yaw)];
const toLocal = (p: PlacedItem, x: number, z: number): [number, number] => {
  const dx = x - p.position[0], dz = z - p.position[2], yaw = p.rotation || 0;
  return [dx * Math.cos(yaw) - dz * Math.sin(yaw), dx * Math.sin(yaw) + dz * Math.cos(yaw)];
};
const maxRise = (frames: Frame[], start: number) =>
  frames.reduce((m, f, i) => Math.max(m, f.y - (i === 0 ? start : frames[i - 1].y)), 0);
const COMPASS = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);

// =================================================================================================
// §2a — 木製平台: walked onto from every direction, at any rotation.
// =================================================================================================
console.log('\n=== §2a 木製平台: onto the boards from every side ===');
for (const yaw of [0, Math.PI / 4, 1.1]) {
  const deck = place(PLATFORM, AT[0], AT[1], yaw);
  const top = deck.position[1] + getFootprint(PLATFORM)!.standY!;
  const results = COMPASS.map((a) => {
    const from: [number, number] = [AT[0] + Math.sin(a) * 6, AT[1] + Math.cos(a) * 6];
    const frames = walk([deck], from, [-Math.sin(a), -Math.cos(a)], 80);
    const last = frames[frames.length - 1];
    return { a, onDeck: Math.abs(last.y - top) < EPS && last.support === deck.instanceId, rise: maxRise(frames, deck.position[1]), end: Math.hypot(last.x - AT[0], last.z - AT[1]) };
  });
  ok(`rotated ${yaw.toFixed(2)}: walked onto from all 8 directions`,
    results.every((r) => r.onDeck), results.filter((r) => !r.onDeck).map((r) => `from ${(r.a * 180 / Math.PI).toFixed(0)}°`).join(', '));
  ok(`rotated ${yaw.toFixed(2)}: ...in one step up, never more`,
    results.every((r) => r.rise <= STAND_RULES.maxStepUp + EPS), `largest rise ${Math.max(...results.map((r) => r.rise)).toFixed(3)}`);
  ok(`rotated ${yaw.toFixed(2)}: ...and walked across, not stopped at the edge`,
    results.every((r) => r.end < 1.0), `worst distance from centre after 6.4 units: ${Math.max(...results.map((r) => r.end)).toFixed(2)}`);
}
{
  // 停留 — standing still on the boards: no drift, no bob in the resolved height.
  const deck = place(PLATFORM, AT[0], AT[1], 0.4);
  const pos = new THREE.Vector3(AT[0] + 1.2, 0, AT[1] - 0.7);
  let footY: number | null = null;
  const ys: number[] = [];
  for (let i = 0; i < 30; i++) {
    const r = resolveCollisions({ testPos: pos.clone(), currentPos: pos, isInterior: false, islandScale: SCALE, profile: profileOf([deck]), home: null, footY });
    footY = r.terrainY;
    ys.push(r.terrainY);
    if (r.position.distanceTo(pos) > EPS) { ys.push(NaN); break; }
  }
  ok('standing still on the platform: 30 frames, no drift and no height change',
    ys.every((y) => Math.abs(y - ys[0]) < EPS), `height ${ys[0].toFixed(3)}`);
}

// =================================================================================================
// §2b — 小型觀景平台: a wall from the grass, a floor from its stairs, railings that stop you.
// =================================================================================================
console.log('\n=== §2b 小型觀景平台: walls, stairs, railings ===');
const deckFp = getFootprint(VIEWING_DECK)!;
const deckHalf = Math.max(...deckFp.standParts!.filter((p) => p.tread && Math.abs(p.y1 - deckFp.standY!) < EPS).map((p) => Math.abs(p.outline.cx) + p.outline.halfW));
for (const yaw of [0, Math.PI / 2, 2.3]) {
  const deck = place(VIEWING_DECK, AT[0], AT[1], yaw);
  const ground = deck.position[1];
  const top = ground + deckFp.standY!;
  // Local approach directions, 45° apart; 0 is from the stairs' side (local −Z, walking +Z).
  for (let k = 0; k < 8; k++) {
    const la = (k * Math.PI) / 4;
    const localDir: [number, number] = [Math.sin(la), Math.cos(la)];
    const dir = toWorldDir(localDir[0], localDir[1], yaw);
    const from: [number, number] = [AT[0] - dir[0] * 6, AT[1] - dir[1] * 6];
    const frames = walk([deck], from, dir, 90);
    const last = frames[frames.length - 1];
    const label = `rotated ${yaw.toFixed(2)}, approach ${(la * 180 / Math.PI).toFixed(0)}°`;
    if (k === 0) {
      ok(`${label} (up the stairs): reaches the deck`, Math.abs(last.y - top) < EPS, `ends at ${last.y.toFixed(3)}, deck ${top.toFixed(3)}`);
      ok(`${label}: climbing one tread at a time`, maxRise(frames, ground) <= STAND_RULES.maxStepUp + EPS,
        `heights ${[...new Set(frames.map((f) => f.y.toFixed(3)))].join(' → ')}`);
      const [, lz] = toLocal(deck, last.x, last.z);
      const railZ = Math.max(...deckFp.standParts!.filter((p) => !p.tread && p.y0 > deckFp.standY! - 0.1 && p.outline.halfW > 0.5).map((p) => p.outline.cz));
      ok(`${label}: ...and the back railing stops them on the deck`,
        lz <= railZ - PLAYER_PHYSICAL_RADIUS + 1e-3, `stopped at local z ${lz.toFixed(3)}, railing at ${railZ.toFixed(3)}`);
    } else {
      const everOnDeck = frames.some((f) => f.support === deck.instanceId && f.y > ground + STAND_RULES.maxStepUp);
      // Closest any frame came to the deck's square, in the deck's own frame.
      const closest = Math.min(...frames.map((f) => {
        const [lx, lz] = toLocal(deck, f.x, f.z);
        return Math.hypot(Math.max(0, Math.abs(lx) - deckHalf), Math.max(0, Math.abs(lz) - deckHalf));
      }));
      ok(`${label}: never lifted onto the deck through its side`, !everOnDeck && Math.abs(last.y - ground) < 0.5, `ends at y ${last.y.toFixed(3)}`);
      ok(`${label}: ...and never inside its boards — held a body's width off its side`,
        closest >= PLAYER_PHYSICAL_RADIUS - 1e-3, `closest ${closest.toFixed(3)} (radius ${PLAYER_PHYSICAL_RADIUS})`);
    }
  }

  // On the deck: walk out in every direction from the middle. The railed sides hold the body in;
  // the open front lets it go down the stairs (straight on) or off the edge (to either side).
  const up = walk([deck], [AT[0] - toWorldDir(0, 1, yaw)[0] * 6, AT[1] - toWorldDir(0, 1, yaw)[1] * 6], toWorldDir(0, 1, yaw), 80);
  const centre = up[up.length - 1];
  for (let k = 0; k < 8; k++) {
    const la = (k * Math.PI) / 4;
    const dir = toWorldDir(Math.sin(la), Math.cos(la), yaw);
    const frames = walk([deck], [centre.x - dir[0] * 0, centre.z - dir[1] * 0], dir, 45, { footY: centre.y });
    const last = frames[frames.length - 1];
    const [lx, lz] = toLocal(deck, last.x, last.z);
    const label = `rotated ${yaw.toFixed(2)}, on the deck heading ${(la * 180 / Math.PI).toFixed(0)}°`;
    const towardFront = Math.cos(la) < -0.5; // local −Z is the open side
    if (towardFront) {
      ok(`${label}: off the open side, down to the grass`, Math.abs(last.y - ground) < EPS, `ends at ${last.y.toFixed(3)}`);
      if (k === 4) {
        const drops = frames.map((f, i) => (i === 0 ? centre.y : frames[i - 1].y) - f.y).filter((d) => d > EPS);
        ok(`${label}: ...straight down the stairs, a tread at a time`, drops.length >= 3 && drops.every((d) => d < 0.3),
          drops.map((d) => d.toFixed(3)).join(' / '));
      }
    } else {
      ok(`${label}: stays on the deck`, Math.abs(last.y - top) < EPS, `ends at ${last.y.toFixed(3)}`);
      ok(`${label}: ...inside the railings`, Math.abs(lx) <= deckHalf && lz <= deckHalf, `local (${lx.toFixed(2)}, ${lz.toFixed(2)})`);
    }
  }
}

{
  // The air beside the stairs: inside the piece's outline, under nothing. It used to be deck.
  const deck = place(VIEWING_DECK, AT[0], AT[1], 0);
  const stairs = deckFp.standParts!.filter((p) => p.tread && p.y1 < deckFp.standY! - 0.1);
  const lowest = stairs.reduce((a, b) => (a.y1 < b.y1 ? a : b));
  const besideX = lowest.tread!.halfW + 0.4;
  const hit = getSurfaceAt(AT[0] + besideX, AT[1] + lowest.tread!.cz, [deck], SCALE);
  ok('beside the stairs is grass, not deck', hit.supportId === null && Math.abs(hit.y - deck.position[1]) < EPS, `y ${hit.y.toFixed(3)}`);
  const onStep = getSurfaceAt(AT[0], AT[1] + lowest.tread!.cz, [deck], SCALE);
  ok('...and ON the stairs is the step, at the step\'s own height',
    Math.abs(onStep.y - (deck.position[1] + lowest.y1)) < EPS, `y ${onStep.y.toFixed(3)}`);
}

{
  // Callers with no height of their own (the pet, the NPCs) keep the old contract: decks are not
  // pushed against, and a lookup without `fromY` takes whatever tread is on top.
  const deck = place(VIEWING_DECK, AT[0], AT[1], 0);
  const r = resolvePlayerAgainstFurniture(AT[0] + deckHalf + 0.1, AT[1], PLAYER_PHYSICAL_RADIUS, [deck]);
  ok('without a foot height, a deck is not pushed against (pets and NPCs unchanged)',
    Math.abs(r.x - (AT[0] + deckHalf + 0.1)) < EPS && Math.abs(r.z - AT[1]) < EPS);
  ok('...and the surface lookup still answers the top of the deck',
    Math.abs(getSurfaceAt(AT[0], AT[1], [deck], SCALE).y - (deck.position[1] + deckFp.standY!)) < EPS);
  ok('...unless the body is too far below it to step up',
    getSurfaceAt(AT[0], AT[1], [deck], SCALE, null, deck.position[1]).supportId === null);
}

// =================================================================================================
// §4 — stacking on a deck, and the stairs as a support.
// =================================================================================================
console.log('\n=== §4 props on decks ===');
{
  const deck = place(VIEWING_DECK, AT[0], AT[1], 0);
  const onTop = evaluateIslandPlacement({ itemId: TORCH, x: AT[0] + 0.3, z: AT[1] + 0.2, rotation: 0, placements: [deck], home: null, islandScale: SCALE });
  ok('a torch set on the viewing deck stands on its boards', onTop.ok && Math.abs(onTop.y - (deck.position[1] + deckFp.standY!)) < EPS && onTop.supportId === deck.instanceId,
    `ok ${onTop.ok}, y ${onTop.y.toFixed(3)}`);
  const lantern: PlacedItem = { instanceId: 'torch', itemId: TORCH, rotation: 0, position: [AT[0] + 0.3, onTop.y, AT[1] + 0.2] };
  const walkedInto = walk([deck, lantern], [AT[0] + 0.3, AT[1] - 6], [0, 1], 90);
  const last = walkedInto[walkedInto.length - 1];
  const nearest = Math.min(...walkedInto.map((f) => Math.hypot(f.x - lantern.position[0], f.z - lantern.position[2])));
  ok('...and a player who climbs the stairs walks around it on the deck, never through it',
    Math.abs(last.y - (deck.position[1] + deckFp.standY!)) < EPS && nearest >= PLAYER_PHYSICAL_RADIUS - 1e-3,
    `closest ${nearest.toFixed(3)} to the torch`);
}

// =================================================================================================
// §5 — the ground under a deck: the shoreline, and the territory changing under it.
// =================================================================================================
console.log('\n=== §5 never buried: shorelines and territory changes ===');
{
  // A pier run out over the shoreline at territory level 1: centre over the sea, landward edge on
  // the grass. Seated from its centre it sat at the waterline with its landward half in the beach.
  const x = 8, z = 0, yaw = 0;
  const y = resolvePlacementY(PLATFORM, x, z, [], 1, null, yaw);
  const pier: PlacedItem = { instanceId: 'pier', itemId: PLATFORM, rotation: yaw, position: [x, y, z] };
  /** Dense check of a placed deck's walking surface against the terrain under it. */
  const clearance = (p: PlacedItem, scale: number) => {
    let buried = 0, samples = 0, tightest = Infinity;
    const [px, , pz] = p.position;
    for (let dx = -2.7; dx <= 2.7 + EPS; dx += 0.0675) {
      for (let dz = -2.7; dz <= 2.7 + EPS; dz += 0.0675) {
        const tread = standTreadTop({ ...p, position: [px, p.position[1], pz] }, px + dx, pz + dz);
        if (tread === null) continue;
        samples++;
        const gap = tread - getTerrainInfo(px + dx, pz + dz, scale).targetY;
        tightest = Math.min(tightest, gap);
        if (gap < -EPS) buried++;
      }
    }
    return { buried, samples, tightest };
  };
  const shore = clearance(pier, 1);
  ok('a pier run across the shoreline: no board of it is below the beach',
    shore.buried === 0, `${shore.buried} of ${shore.samples} deck points below ground (its centre is over the sea)`);
  ok('...lifted just clear of the ground, and no further',
    shore.tightest >= 0 && shore.tightest < 0.03, `tightest board-to-ground gap ${shore.tightest.toFixed(3)}, base y ${y.toFixed(3)}`);

  // The live report that this rule must not break: a platform on the grass that only OVERLAPS the
  // mound (10 cm higher) stays on the grass — its boards clear the mound anyway — and so stays one
  // step up from the grass on every side. Seating it on the highest ground walled it off.
  const onMound: PlacedItem = { instanceId: 'mound', itemId: PLATFORM, rotation: 0, position: [1.5, resolvePlacementY(PLATFORM, 1.5, 0, [], 1, null, 0), 0] };
  ok('a platform overlapping the mound is not lifted by it', Math.abs(onMound.position[1] - 0.3) < EPS, `base y ${onMound.position[1].toFixed(3)}`);
  ok('...and its boards still clear the mound', clearance(onMound, 1).buried === 0);
  for (const [fx, fz] of [[5.0, 0], [1.5, 3.9], [1.5, -3.9]] as const) {
    const frames = walk([onMound], [fx, fz], [1.5 - fx, 0 - fz], 60, { scale: 1 });
    ok(`...and is walked onto from the grass at (${fx}, ${fz})`, frames.some((f) => f.support === 'mound'),
      `last support ${frames[frames.length - 1].support}`);
  }

  // The same pier as the OLD rule saved it (the waterline), plus a torch on its boards.
  const oldPier: PlacedItem = { ...pier, position: [x, -0.5, z] };
  const oldTorch: PlacedItem = { instanceId: 'pier-torch', itemId: TORCH, rotation: 0, position: [x + 1.5, -0.5 + getFootprint(PLATFORM)!.standY!, z] };
  const fixed = reseatIslandPlacements([oldTorch, oldPier], 1);
  ok('a pier saved under the old rule is re-seated out of the beach', !!fixed && Math.abs(fixed[1].position[1] - y) < EPS,
    `${oldPier.position[1]} → ${fixed?.[1].position[1]}`);
  ok('...and the torch standing on it comes up with it',
    !!fixed && Math.abs(fixed[0].position[1] - (y + getFootprint(PLATFORM)!.standY!)) < EPS, `→ ${fixed?.[0].position[1]}`);
  ok('...and re-seating what is already right changes nothing', reseatIslandPlacements(fixed!, 1) === null);

  // Territory: a pier wholly out at sea at level 1, then the island expands under it.
  const farPier: PlacedItem = { instanceId: 'far', itemId: PLATFORM, rotation: 0, position: [12, resolvePlacementY(PLATFORM, 12, 0, [], 1), 0] };
  const farTorch: PlacedItem = { instanceId: 'far-torch', itemId: TORCH, rotation: 0, position: [12, farPier.position[1] + getFootprint(PLATFORM)!.standY!, 0] };
  ok('a pier out at sea rests on the sea surface', Math.abs(farPier.position[1] + 0.5) < EPS);
  const level3 = 1 + (3 - 1) * 0.4;
  ok('...until the territory grows under it: then its boards are inside the new island',
    clearance(farPier, level3).buried > 0, `${clearance(farPier, level3).buried} deck points below the level-3 ground`);
  const grown = reseatIslandPlacements([farPier, farTorch], level3)!;
  ok('re-seated for the new territory, the pier rides up out of the new ground', !!grown && clearance(grown[0], level3).buried === 0,
    `${farPier.position[1]} → ${grown?.[0].position[1].toFixed(3)}`);
  ok('...the torch on it with it', !!grown && Math.abs(grown[1].position[1] - (grown[0].position[1] + getFootprint(PLATFORM)!.standY!)) < EPS);
  ok('...and shrinking back never lowers anything', reseatIslandPlacements(grown, 1) === null);
  const walkOn = walk(grown, [6.5, 0], [1, 0], 60, { scale: level3 });
  ok('...and it is standable again after the expansion',
    walkOn.some((f) => f.support === 'far'), `last support ${walkOn[walkOn.length - 1].support}`);

  // Two SUPPORTS stacked — a picnic table (a tabletop) on a platform. The platform used to ask what
  // was under its centre, find the table standing on it, and be lifted onto the table's top; the
  // table was then the lower of the two and was lifted onto the platform — one tabletop higher per
  // call, forever. IslandPlacements re-ran it on every new list, so that was an endless save loop.
  const TABLE = 'deco-picnic-table';
  {
    const model = buildModelObject3D(TABLE, ISLAND_SCALE)!;
    new THREE.Scene().add(model);
    measureFootprint(TABLE, model);
  }
  const deckY = resolvePlacementY(PLATFORM, -2, 2, [], 1);
  const deck: PlacedItem = { instanceId: 'stack-deck', itemId: PLATFORM, rotation: 0, position: [-2, deckY, 2] };
  const table: PlacedItem = { instanceId: 'stack-table', itemId: TABLE, rotation: 0, position: [-1.9, deckY + getFootprint(PLATFORM)!.standY!, 2.1] };
  ok('a table seated on a platform is left exactly where it is', reseatIslandPlacements([deck, table], 1) === null);
  // The same stack saved buried by an old rule: both come up, the table ON the platform, and a
  // second pass finds nothing — the property that keeps the migration from ever looping.
  const buried = reseatIslandPlacements([{ ...deck, position: [-2, deckY - 0.2, 2] }, { ...table, position: [-1.9, deckY, 2.1] }], 1);
  ok('a buried stack is re-seated with the table on top of the platform, not the other way round',
    !!buried && Math.abs(buried[0].position[1] - deckY) < EPS &&
      Math.abs(buried[1].position[1] - (deckY + getFootprint(PLATFORM)!.standY!)) < EPS,
    `deck ${buried?.[0].position[1].toFixed(3)}, table ${buried?.[1].position[1].toFixed(3)}`);
  ok('...and re-seating the result again changes nothing', !!buried && reseatIslandPlacements(buried, 1) === null);
  // Two platforms saved overlapping at the same height stand side by side; neither climbs the other.
  const twin: PlacedItem = { ...deck, instanceId: 'stack-twin', position: [-1.5, deckY, 2.3] };
  ok('two overlapping platforms at one height are not stacked onto each other', reseatIslandPlacements([deck, twin], 1) === null);
}

// =================================================================================================
// §6 — the water: a deck is a pier, and the step is measured from the surface.
// =================================================================================================
console.log('\n=== §6 from the water ===');
{
  const pier: PlacedItem = { instanceId: 'pier', itemId: PLATFORM, rotation: 0, position: [13, -0.5, 0] };
  const swim = walk([pier], [17, 0], [-1, 0], 60, { swimming: true, footY: -1.0 });
  ok('a swimmer climbs onto a pier from the water', swim.some((f) => f.support === 'pier'),
    `ends at y ${swim[swim.length - 1].y.toFixed(3)}`);
  ok('...isGroundedAt agrees, measured from the surface', isGroundedAt(13, 0, [pier], 1, Math.max(-1.0, -0.5)));

  // The viewing deck at sea, stairs facing out to sea (+X): its sides are a wall to a swimmer, its
  // stairs are the way up.
  const tall: PlacedItem = { instanceId: 'tall', itemId: VIEWING_DECK, rotation: -Math.PI / 2, position: [13, -0.5, 0] };
  const side = walk([tall], [13, 4], [0, -1], 60, { swimming: true, footY: -1.0 });
  ok('a swimmer alongside the tall deck is not lifted onto it', side.every((f) => f.support !== 'tall'));
  ok('...isGroundedAt agrees', !isGroundedAt(13, 0.5, [tall], 1, -0.5));
  const stairs = walk([tall], [17, 0], [-1, 0], 80, { swimming: true, footY: -1.0 });
  ok('...but climbs its stairs out of the sea', Math.abs(stairs[stairs.length - 1].y - (-0.5 + deckFp.standY!)) < EPS,
    `ends at ${stairs[stairs.length - 1].y.toFixed(3)}`);
}

// =================================================================================================
// §7 — the drawn body never walks its shins through a step.
// =================================================================================================
console.log('\n=== §7 the soles on the step ===');
ok('stepping up: the drawn body is held on the new tread', Math.abs(feetFloorY(0.695, 0) - 0.675) < EPS);
ok('a crouch still dips below the surface', Math.abs(feetFloorY(0.3, -0.1) - 0.18) < EPS);
ok('a jump arc is left to the ease (no floor above the surface)', Math.abs(feetFloorY(0.3, 0.5) - 0.28) < EPS);

console.log(
  failures === 0
    ? `\nALL PASS (${checks} checks)\n`
    : `\n${failures} of ${checks} checks FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
