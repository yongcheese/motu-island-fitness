/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 島上的花與石頭不會因為存檔而重新生成 —— the island's natural decoration is stable.
 *
 * Run with `npm run test:decor`. Same tsx-script style as the other `test:*` checks.
 *
 * ## What it is guarding
 *
 * The report was 「花、石頭持續隨機生成並閃爍」. It was a chain of three defects, and each one has a
 * section here that fails on the old code:
 *
 *  §1  **Every snapshot was a new object tree.** `setProfile(doc.data())` gave every field a new
 *      identity on every write, so anything memoised on `profile.home.position` or
 *      `profile.islandPlacements` was rebuilt by a coin, a step count or the heartbeat.
 *  §2  **The Home was keyed on that array.** usePlayerHome's memo depended on `position`'s identity.
 *  §3  **The layout was Math.random().** So each of those rebuilds drew a different island.
 */

import { structuralShare } from '../src/lib/structuralShare';
import { layoutFlora, layoutRocks } from '../src/lib/islandDecorLayout';
import { getPlayerHome } from '../src/hooks/usePlayerHome';
import type { UserProfile } from '../src/types';
import { HOUSE_FOOTPRINT } from '../src/constants/houseStyles';

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

/** What a realtime snapshot hands over: the same data, every object freshly built. */
const snapshot = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

// =================================================================================================
// §1 — a snapshot keeps the identity of everything it did not change.
// =================================================================================================
console.log('\n=== §1 structural sharing of save snapshots ===');
{
  const profile = {
    balanceGold: 100,
    territoryLevel: 2,
    home: { position: [3, 0.3, -2], rotation: 0.5, currentStyle: 'cottage' },
    islandPlacements: [
      { instanceId: 'a', itemId: 'deco-wishing-well', position: [1, 0.3, 1], rotation: 0 },
      { instanceId: 'b', itemId: 'item-20', position: [-1, 0.3, 2], rotation: 1 },
    ],
    islandState: { lastSeenAt: '2026-09-01T00:00:00.000Z', sprouts: [] as unknown[] },
  };

  // The heartbeat: one string deep inside islandState changes, nothing else.
  const beat = snapshot(profile);
  beat.islandState.lastSeenAt = '2026-09-01T00:05:00.000Z';
  const afterBeat = structuralShare(profile, beat);
  ok('a heartbeat snapshot keeps the Home object', afterBeat.home === profile.home);
  ok('...and the Home position array', afterBeat.home.position === profile.home.position);
  ok('...and the placements list', afterBeat.islandPlacements === profile.islandPlacements);
  ok('...and the sprouts it did not touch', afterBeat.islandState.sprouts === profile.islandState.sprouts);
  ok('...while the field that changed is the new value', afterBeat.islandState.lastSeenAt === beat.islandState.lastSeenAt);
  ok('...and the containers above it are new, so the change is still seen', afterBeat !== profile && afterBeat.islandState !== profile.islandState);

  // A coin: a top-level number.
  const coin = snapshot(profile);
  coin.balanceGold = 150;
  const afterCoin = structuralShare(profile, coin);
  ok('a coin snapshot keeps the Home and the placements', afterCoin.home === profile.home && afterCoin.islandPlacements === profile.islandPlacements);

  // Moving one piece: only that piece (and the list holding it) is new.
  const moved = snapshot(profile);
  moved.islandPlacements[1].position = [-1.5, 0.3, 2];
  const afterMove = structuralShare(profile, moved);
  ok('moving one placement gives the list a new identity', afterMove.islandPlacements !== profile.islandPlacements);
  ok('...but the untouched placement keeps its own', afterMove.islandPlacements[0] === profile.islandPlacements[0]);
  ok('...and the moved one carries its new position', afterMove.islandPlacements[1].position[0] === -1.5);

  // Nothing changed at all: React must see the very same object, so it renders nothing.
  ok('an identical snapshot returns the previous profile itself', structuralShare(profile, snapshot(profile)) === profile);

  // Removing a key is a change.
  const removed = snapshot(profile) as Partial<typeof profile>;
  delete removed.islandState;
  const afterRemove = structuralShare(profile, removed);
  ok('a removed field is a change', afterRemove !== profile && !('islandState' in afterRemove));

  // Class instances (Firestore Timestamps) are never looked into, only passed through.
  class Stamp { constructor(public seconds: number) {} }
  const a = { at: new Stamp(1) };
  const b = { at: new Stamp(2) };
  ok('a non-plain object is taken from the new snapshot', structuralShare(a, b).at === b.at);
  ok('from a first load (no previous profile) the snapshot is used as-is', structuralShare(null, profile) === profile);
}

// =================================================================================================
// §2 — the Home the island is laid out around.
// =================================================================================================
console.log('\n=== §2 the resolved Home ===');
{
  const profile = { home: { position: [3, 0.3, -2], rotation: 0.5, currentStyle: 'cottage' } } as unknown as UserProfile;
  const again = snapshot(profile);
  const h1 = getPlayerHome(profile)!;
  const h2 = getPlayerHome(again)!;
  ok('two snapshots of one Home resolve to the same values',
    h1.position.every((v, i) => v === h2.position[i]) && h1.rotation === h2.rotation && h1.style.id === h2.style.id);
}

// =================================================================================================
// §3 — the layout is a function of the island, not of when it was drawn.
// =================================================================================================
console.log('\n=== §3 seeded layout ===');
{

  const home = { position: [3, 0.3, -2] as [number, number, number], rotation: 0.5, footprint: HOUSE_FOOTPRINT };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  const flora1 = layoutFlora(48, home, 1);
  const flora2 = layoutFlora(48, { ...home, position: [...home.position] as [number, number, number] }, 1);
  ok('the same island draws the same 48 flowers, every time', same(flora1, flora2));
  const rocks1 = layoutRocks(22, home, 1);
  const rocks2 = layoutRocks(22, home, 1);
  ok('...and the same 22 rocks', same(rocks1, rocks2));

  // Flowers must still look scattered, not all in one spot.
  const xs = new Set(flora1.map((f) => f.position[0].toFixed(2)));
  ok('the field is still scattered', xs.size > 40, `${xs.size} distinct x positions of 48`);
  ok('...and every flower is on the island',
    flora1.every((f) => Math.hypot(f.position[0], f.position[2]) < 5.7 - 0.4 + 1e-9));

  // Moving the Home is a real reason to re-site — but only the flowers it actually affects.
  const movedHome = { ...home, position: [-3, 0.3, 2.5] as [number, number, number] };
  // On a level-4 island, so there is enough ground away from both Homes for this to mean something.
  const big = 1 + (4 - 1) * 0.4;
  const floraBig = layoutFlora(72, home, big);
  const flora3 = layoutFlora(72, movedHome, big);
  // Beyond this, a point cannot be in either Home's keep-out or door lane, nor be a spot a flower
  // was nudged to from inside one (the spiral search steps 0.35 at a time).
  const reach = Math.hypot(HOUSE_FOOTPRINT.halfWidth + 0.6, HOUSE_FOOTPRINT.doorOffsetZ + 1.2) + 0.4;
  const clear = (p: [number, number, number]) =>
    [home, movedHome].every((h) => Math.hypot(p[0] - h.position[0], p[2] - h.position[2]) > reach);
  const far = floraBig.map((f, i) => i).filter((i) => clear(floraBig[i].position) && clear(flora3[i].position));
  const farKept = far.filter((i) => same(floraBig[i], flora3[i])).length;
  ok('moving the Home re-sites only the flowers it affects: every flower clear of both Homes stays put',
    far.length > 0 && farKept === far.length,
    `${farKept} of ${far.length} clear flowers unchanged (${flora3.filter((f, i) => same(f, floraBig[i])).length} of 72 overall)`);
  const looksKept = flora3.filter((f, i) => f.color === floraBig[i].color && f.scale === floraBig[i].scale).length;
  ok('...and no flower changes colour or size because of it', looksKept === 72);

  // No home yet (a brand-new player) is a valid island too.
  ok('an island with no Home lays out deterministically as well', same(layoutFlora(10, null, 1), layoutFlora(10, null, 1)));
}

console.log(
  failures === 0
    ? `\nALL PASS (${checks} checks)\n`
    : `\n${failures} of ${checks} checks FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
