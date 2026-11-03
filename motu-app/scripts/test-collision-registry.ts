/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 玩家碰撞的「登記表」—— 平台量進去的那份，必須就是玩家讀的那份。
 *
 * Run with `npm run test:collision-registry`. Same tsx-script style as the other `test:*` checks.
 *
 * ## What it is guarding
 *
 * The report was 「玩家碰撞框再次失效，走到木板、平台、觀景平台會直接穿過」. The walking rules were
 * fine — `npm run test:standables` passed all of them — and the island still let the player through
 * every deck. Measured on the running game:
 *
 *   - every platform model had measured its footprint on mount (Three/PlacementGhost.tsx), and
 *   - `getSurfaceAt` at the middle of a 木製平台 still answered the GRASS,
 *
 * because the dev server was serving lib/furniturePlacement.ts to its importers under two URLs
 * (`furniturePlacement.ts` and `furniturePlacement.ts?t=…`). Two module instances, two footprint
 * registries: the models measured into one, and the character controller (characterMovement.ts →
 * placementSurfaces.ts) read the other, which held nothing but the house. The same split happened to
 * lib/worldSolids.ts, the merchant boat's colliders.
 *
 * §1 reproduces that exactly — a SECOND instance of each module, forced with a query string, does
 * the writing, and the unmodified reader path does the reading — and fails on the old code.
 * §2–§4 then walk the player over the pieces through that reader path from every side, at every
 * frame rate the controller can produce, because "the registry is shared" is only worth anything if
 * the player actually stands, walks, steps off and is stopped where they should be.
 */

import * as THREE from 'three';
import { buildModelObject3D, ISLAND_SCALE } from './lib/measureFurnitureModel';
// THE READER SIDE — imported exactly as the character controller imports it.
import { MAX_COLLISION_SUBSTEP, resolveCollisions, resolveMovement } from '../src/components/Three/characterMovement';
import { getSurfaceAt, isGroundedAt, resolvePlacementY } from '../src/lib/placementSurfaces';
import { getFootprint, getFootprintVersion, STAND_RULES } from '../src/lib/furniturePlacement';
import { getWorldSolids } from '../src/lib/worldSolids';
import { placeShape, createPlacedShape, signedDistanceToShape } from '../src/lib/collisionShape';
import { getTerrainInfo } from '../src/constants/terrain';
import { MAX_FRAME_DELTA } from '../src/lib/playerBus';
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
const PLATFORM = 'item-16';              // 木製平台 — one step up, walked onto from any side
const VIEWING_DECK = 'deco-viewing-deck'; // 小型觀景平台 — 0.9 up, stairs at local −Z, three railings

/**
 * The WRITER side: a second, separate instance of each registry module, the way the dev server
 * handed one to the renderer. Non-literal specifiers so tsc does not try to resolve the query; the
 * cast restores the real module type.
 */
const WRITER_FOOTPRINTS = '../src/lib/furniturePlacement.ts?instance=writer';
const WRITER_SOLIDS = '../src/lib/worldSolids.ts?instance=writer';

async function main(): Promise<void> {
  const writer = (await import(WRITER_FOOTPRINTS)) as typeof import('../src/lib/furniturePlacement');
  const solidsWriter = (await import(WRITER_SOLIDS)) as typeof import('../src/lib/worldSolids');

  // ===============================================================================================
  // §1 — one registry, however many module instances.
  // ===============================================================================================
  console.log('\n=== §1 the registry the models measure into is the one the player reads ===');

  ok('the writer really is a second module instance (the condition the bug needed)',
    writer.getFootprint !== getFootprint && solidsWriter.getWorldSolids !== getWorldSolids);

  ok('before anything mounts, neither platform is known to the reader', !getFootprint(PLATFORM) && !getFootprint(VIEWING_DECK));

  // Measured the way IslandPlacementInstance measures a placed piece: nested under a moved, turned
  // placement group, through the WRITER instance.
  for (const id of [PLATFORM, VIEWING_DECK]) {
    const model = buildModelObject3D(id, ISLAND_SCALE)!;
    const placed = new THREE.Group();
    placed.position.set(4, 0.3, -2);
    placed.rotation.y = 0.7;
    placed.add(model);
    new THREE.Scene().add(placed);
    writer.measureFootprint(id, model);
  }

  ok('a footprint measured through one instance is visible through the other',
    !!getFootprint(PLATFORM)?.standParts && !!getFootprint(VIEWING_DECK)?.standParts,
    `木製平台 ${getFootprint(PLATFORM)?.standParts?.length ?? 0} parts, 觀景平台 ${getFootprint(VIEWING_DECK)?.standParts?.length ?? 0} parts`);
  ok('...it is the same object, not a copy', getFootprint(PLATFORM) === writer.getFootprint(PLATFORM));
  ok('...and both instances agree on the change counter views subscribe to',
    getFootprintVersion() === writer.getFootprintVersion(), `version ${getFootprintVersion()}`);

  let heard = 0;
  const unsubscribe = writer.subscribeFootprints(() => { heard++; });
  writer.registerFootprint('__probe__', { cx: 0, cz: 0, halfW: 0.5, halfD: 0.5, minY: 0, maxY: 0.5, walk: null });
  unsubscribe();
  ok('a subscriber on one instance hears a registration made on the other', heard === 1);

  // ===============================================================================================
  // §2 — standing on them, through the controller's own lookup.
  // ===============================================================================================
  console.log('\n=== §2 standing on the platforms ===');

  /** A big flat island (territory level 6), pieces at (6, _, 6) — level grass all round. */
  const SCALE = 3;
  const AT: [number, number] = [6, 6];
  const profileOf = (placements: PlacedItem[]) => ({ islandPlacements: placements } as unknown as UserProfile);
  const place = (itemId: string, rotation: number): PlacedItem => ({
    instanceId: itemId, itemId, rotation,
    position: [AT[0], resolvePlacementY(itemId, AT[0], AT[1], [], SCALE, itemId, rotation), AT[1]],
  });
  const groundAt = (x: number, z: number) => getTerrainInfo(x, z, SCALE).targetY;

  for (const id of [PLATFORM, VIEWING_DECK]) {
    const p = place(id, 0.7);
    const top = p.position[1] + getFootprint(id)!.standY!;
    const hit = getSurfaceAt(AT[0], AT[1], [p], SCALE);
    ok(`${id}: the ground at its centre is its boards, not the grass under them`,
      Math.abs(hit.y - top) < EPS && hit.supportId === id, `y ${hit.y.toFixed(3)} (boards ${top.toFixed(3)}, grass ${groundAt(AT[0], AT[1]).toFixed(3)})`);

    // A body put there without walking (a teleport, the build-mode handoff): footY null.
    const r = resolveCollisions({
      testPos: new THREE.Vector3(AT[0], 0, AT[1]), isInterior: false, islandScale: SCALE,
      profile: profileOf([p]), home: null, footY: null,
    });
    ok(`${id}: a player placed on it stands on it`, Math.abs(r.terrainY - top) < EPS && r.isGrounded,
      `feet at ${r.terrainY.toFixed(3)}`);
    ok(`${id}: ...and the swim state machine agrees it is solid ground`,
      isGroundedAt(AT[0], AT[1], [p], SCALE, top));
  }

  // ===============================================================================================
  // §3 — 木製平台, walked straight across from 16 headings at 60 fps, 30 fps and the frame cap.
  // ===============================================================================================
  console.log('\n=== §3 木製平台: across it from every side, at every frame rate ===');

  /** Avatar.tsx's walking speed, world units per second. */
  const SPEED = 3.8 * 1.2 * 1.2;
  const STRIDES: [string, number][] = [
    ['60 fps', SPEED / 60],
    ['30 fps', SPEED / 30],
    [`frame cap ${MAX_FRAME_DELTA}s`, SPEED * MAX_FRAME_DELTA],
  ];
  const HEADINGS = Array.from({ length: 16 }, (_, i) => (i * Math.PI) / 8);

  for (const yaw of [0, 0.7]) {
    const deck = place(PLATFORM, yaw);
    const top = deck.position[1] + getFootprint(PLATFORM)!.standY!;
    for (const [label, stride] of STRIDES) {
      const bad: string[] = [];
      let crossed = 0;
      for (const a of HEADINGS) {
        const dir: [number, number] = [-Math.sin(a), -Math.cos(a)];
        const pos = new THREE.Vector3(AT[0] + Math.sin(a) * 6, 0, AT[1] + Math.cos(a) * 6);
        let footY: number | null = groundAt(pos.x, pos.z);
        let wasOn = false;
        let leftFarSide = false;
        for (let i = 0; i < Math.ceil(12 / stride); i++) {
          const test = pos.clone().add(new THREE.Vector3(dir[0] * stride, 0, dir[1] * stride));
          const r = resolveMovement({
            testPos: test, currentPos: pos, isInterior: false, islandScale: SCALE,
            profile: profileOf([deck]), home: null, footY,
          });
          pos.copy(r.position);
          footY = r.terrainY;
          // What is under the feet, asked of the WRITER's own tread lookup — the ground truth.
          const tread = writer.standTreadTop(deck, pos.x, pos.z);
          const ground = groundAt(pos.x, pos.z);
          const heading = `${Math.round((a * 180) / Math.PI)}°`;
          if (tread !== null && tread >= top - EPS && Math.abs(r.terrainY - top) > EPS) {
            bad.push(`${heading}: over the boards at ${r.terrainY.toFixed(3)} (sank through)`);
            break;
          }
          if (tread === null && (r.supportId !== null || Math.abs(r.terrainY - ground) > EPS)) {
            bad.push(`${heading}: off the deck at ${r.terrainY.toFixed(3)}, ground ${ground.toFixed(3)} (floating)`);
            break;
          }
          if (r.supportId === deck.instanceId) wasOn = true;
          else if (wasOn) leftFarSide = true;
        }
        if (wasOn && leftFarSide) crossed++;
        else if (!bad.some((b) => b.startsWith(`${Math.round((a * 180) / Math.PI)}°`))) {
          bad.push(`${Math.round((a * 180) / Math.PI)}°: ${wasOn ? 'never stepped off the far side' : 'never got on'}`);
        }
      }
      ok(`rotated ${yaw}, ${label} (${stride.toFixed(3)}/frame): on the boards whenever over them, on the grass whenever not`,
        bad.length === 0, bad.join('; '));
      ok(`rotated ${yaw}, ${label}: walked on, across, and off the far edge from all 16 headings`,
        crossed === HEADINGS.length, `${crossed}/16`);
    }
  }

  // ===============================================================================================
  // §4 — 小型觀景平台: a wall from the grass at every frame rate, and its railings from the deck.
  // ===============================================================================================
  console.log('\n=== §4 小型觀景平台: never tunnelled into, at any frame rate ===');

  const deckFp = getFootprint(VIEWING_DECK)!;
  const probe = createPlacedShape();
  for (const yaw of [0, 2.3]) {
    const deck = place(VIEWING_DECK, yaw);
    const ground = deck.position[1];
    const top = ground + deckFp.standY!;
    // Every part a body standing on the GRASS must not be inside: above a step, below the head.
    const wallsFromGrass = deckFp.standParts!.filter((pt) =>
      ground + pt.y1 > ground + STAND_RULES.maxStepUp && pt.y0 < 1.75 && pt.outline.halfW > 0.3 && pt.outline.halfD > 0.3);
    const insideWall = (x: number, z: number) => wallsFromGrass.some((pt) =>
      signedDistanceToShape(placeShape(pt.outline, AT[0], AT[1], yaw, probe), x, z) < -1e-3);

    for (const [label, stride] of STRIDES) {
      const tunnelled: string[] = [];
      let climbed = 0;
      for (const a of HEADINGS) {
        const dir: [number, number] = [-Math.sin(a), -Math.cos(a)];
        const pos = new THREE.Vector3(AT[0] + Math.sin(a) * 7, 0, AT[1] + Math.cos(a) * 7);
        let footY: number | null = groundAt(pos.x, pos.z);
        for (let i = 0; i < Math.ceil(9 / stride); i++) {
          const test = pos.clone().add(new THREE.Vector3(dir[0] * stride, 0, dir[1] * stride));
          const r = resolveMovement({
            testPos: test, currentPos: pos, isInterior: false, islandScale: SCALE,
            profile: profileOf([deck]), home: null, footY,
          });
          pos.copy(r.position);
          footY = r.terrainY;
          // Inside the deck's body with the feet still near the grass = walked into it.
          if (r.terrainY < top - STAND_RULES.maxStepUp && insideWall(pos.x, pos.z)) {
            tunnelled.push(`${Math.round((a * 180) / Math.PI)}° at y ${r.terrainY.toFixed(3)}`);
            break;
          }
        }
        if (Math.abs((footY ?? 0) - top) < EPS) climbed++;
      }
      ok(`rotated ${yaw}, ${label}: never inside the deck at grass height, from 16 headings`,
        tunnelled.length === 0, tunnelled.join('; '));
      // Only the headings that come in through the stairs reach the deck; that is its design.
      ok(`rotated ${yaw}, ${label}: ...and the stairs still take the player up`, climbed >= 1, `${climbed} heading(s) ended on the deck`);
    }

    // From ON the deck, running into every railing — the thinnest wall there is. The deck is railed
    // on local +Z, −X and +X and open at −Z (its stairs), so a run that is not heading toward the
    // open side has nowhere to go but into a railing, and must end still standing on the boards.
    // Ending anywhere else — up on the deck beyond a rail, or down on the grass behind it — is
    // having gone through.
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    for (const [label, stride] of STRIDES) {
      const escaped: string[] = [];
      for (const a of HEADINGS) {
        const dir: [number, number] = [Math.sin(a), Math.cos(a)];
        const localZ = dir[0] * sin + dir[1] * cos;
        if (localZ < -1e-6) continue; // toward the stairs: walking off that side is the point of it
        const pos = new THREE.Vector3(AT[0], 0, AT[1]);
        let footY: number | null = top;
        for (let i = 0; i < Math.ceil(4 / stride); i++) {
          const test = pos.clone().add(new THREE.Vector3(dir[0] * stride, 0, dir[1] * stride));
          const r = resolveMovement({
            testPos: test, currentPos: pos, isInterior: false, islandScale: SCALE,
            profile: profileOf([deck]), home: null, footY,
          });
          pos.copy(r.position);
          footY = r.terrainY;
        }
        if (Math.abs((footY ?? 0) - top) > EPS) {
          escaped.push(`${Math.round((a * 180) / Math.PI)}° → (${pos.x.toFixed(2)}, ${pos.z.toFixed(2)}) at y ${footY?.toFixed(3)}`);
        }
      }
      ok(`rotated ${yaw}, ${label}: running at the railings from the deck never passes through them`,
        escaped.length === 0, escaped.join('; '));
    }
  }

  // ===============================================================================================
  // §5 — the merchant boat's solids: published through one instance, pushed against through the other.
  // ===============================================================================================
  console.log('\n=== §5 world solids ===');
  const boat = [{ id: 'hull', cx: 0, cz: 20, halfW: 1, halfD: 2, rotation: 0.3 }];
  solidsWriter.publishWorldSolids('test-boat', boat);
  ok('solids published through one instance are the ones the controller reads', getWorldSolids().length === 1);
  const r = resolveCollisions({
    testPos: new THREE.Vector3(0, 0, 20), isInterior: false, islandScale: SCALE,
    profile: profileOf([]), home: null, footY: null, solids: getWorldSolids(),
  });
  ok('...and a player walking into the hull is pushed out of it',
    Math.hypot(r.position.x - 0, r.position.z - 20) > 1 - EPS, `pushed to (${r.position.x.toFixed(2)}, ${r.position.z.toFixed(2)})`);
  solidsWriter.publishWorldSolids('test-boat', null);
  ok('...and withdrawn through that instance, it is gone for the controller too', getWorldSolids().length === 0);

  // ===============================================================================================
  // §6 — the sub-step itself.
  // ===============================================================================================
  console.log('\n=== §6 the frame rate does not decide where the body can go ===');
  ok('a 60 fps move is still exactly one resolve', SPEED / 60 <= MAX_COLLISION_SUBSTEP,
    `move ${(SPEED / 60).toFixed(3)}, sub-step ${MAX_COLLISION_SUBSTEP}`);
  const stairTreads = deckFp.standParts!.filter((pt) => pt.tread && pt.y1 < deckFp.standY! - 0.01).map((pt) => pt.tread!);
  const shallowest = Math.min(...stairTreads.map((t) => 2 * Math.min(t.halfW, t.halfD)));
  ok('the sub-step is shorter than the shallowest stair tread, so no tread can be skipped',
    MAX_COLLISION_SUBSTEP < shallowest, `sub-step ${MAX_COLLISION_SUBSTEP}, tread ${shallowest.toFixed(3)} deep`);
  ok('...and under half the thinnest wall a body can meet (a railing plus the body radius each side)',
    MAX_COLLISION_SUBSTEP < PLAYER_PHYSICAL_RADIUS, `sub-step ${MAX_COLLISION_SUBSTEP}, half-wall ≥ ${PLAYER_PHYSICAL_RADIUS}`);

  console.log(failures ? `\n${failures} of ${checks} checks FAILED` : `\nALL PASS (${checks} checks)`);
  process.exit(failures ? 1 : 0);
}

void main();
