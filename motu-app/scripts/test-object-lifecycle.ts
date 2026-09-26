/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 物件互動的生命週期 — rules tests.
 *
 * Run with `npm run test:object-lifecycle`. `audit:object-animations` checks that every row in
 * constants/objectAnimations.ts is WIRED; this checks that every row can END — the half of
 * 「Idle → Start → Active → End → Idle」 that a picture of a door opening never proves:
 *
 *   取消    a press abandoned before its cue lands never opens the piece, and a cancel after it
 *           has landed undoes nothing (the door already moving finishes its arc)
 *   自己收  every momentary / run piece returns to rest on its own clock, whoever walks away
 *   不疊加  pressing twice inside one cue window is one opening, not two stacked
 *   起身    every occupied piece settles back to rest after its occupant leaves
 *   清空    a save swap forgets every lit hob and every pending cue
 *
 * All against the real store (lib/objectRuntimeState.ts) and the real solver
 * (lib/objectAnimation.ts). The store stamps `performance.now()`, so the test reads the same clock
 * and offsets from it rather than faking time.
 */

import { OBJECT_ANIMATIONS, type ObjectAnimationSpec } from '../src/constants/objectAnimations';
import {
  armObject,
  cancelPendingObject,
  flushObjectEdges,
  objectHasPendingEdge,
  objectIsOn,
  objectStateSize,
  objectTimeline,
  releaseObject,
  resetObjectRuntimeState,
  retireObject,
} from '../src/lib/objectRuntimeState';
import { objectCycleDone, objectIsSettled, objectOpen, selfClosing } from '../src/lib/objectAnimation';

let failures = 0;
let checks = 0;

function ok(name: string, condition: boolean, detail = ''): void {
  checks++;
  if (!condition) {
    failures++;
    console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  } else {
    console.log(`ok    ${name}${detail ? `  (${detail})` : ''}`);
  }
}

const entries = Object.entries(OBJECT_ANIMATIONS) as [string, ObjectAnimationSpec][];
const now = () => performance.now();

console.log('\n== 物件互動生命週期 ====================================================');

// --- 取消 ---------------------------------------------------------------------------------
console.log('\n-- 取消: an abandoned press never lands ---------------------------------------');
{
  resetObjectRuntimeState();
  const id = 'test-fridge';
  armObject(id, 0.5, true);
  ok('a press is pending before its cue', objectHasPendingEdge(id) && !objectIsOn(id));
  ok('cancelling before the cue drops it', cancelPendingObject(id) === true);
  flushObjectEdges(now() + 2000);
  ok('…and the piece never opens', !objectIsOn(id));
  ok('…and no pulse is left armed to fire at the cue time', objectTimeline(id).armedAt === null);
  ok('cancelling again is a no-op', cancelPendingObject(id) === false);

  const lit = 'test-hob';
  armObject(lit, 0, true);
  flushObjectEdges(now() + 1);
  ok('a press whose cue has landed turns the piece on', objectIsOn(lit));
  ok('a cancel after landing does nothing', cancelPendingObject(lit, now() + 2) === false && objectIsOn(lit));

  // Only THIS piece: a cancel on the fridge must not reach the hob's own pending edge.
  armObject(lit, 0.5, false);
  armObject(id, 0.5, true);
  cancelPendingObject(id);
  ok('a cancel only touches its own piece', objectHasPendingEdge(lit) && !objectHasPendingEdge(id));
  resetObjectRuntimeState();
}

// --- 不疊加 -------------------------------------------------------------------------------
console.log('\n-- 不疊加: two presses in one cue window are one opening --------------------');
{
  resetObjectRuntimeState();
  const id = 'test-wardrobe';
  armObject(id, 0.01, true);
  armObject(id, 0.01, true);
  flushObjectEdges(now() + 1000);
  ok('the piece is simply on', objectIsOn(id));
  ok('nothing is still queued behind it', !objectHasPendingEdge(id));
  ok('one slot, not two', objectStateSize() === 1);
  resetObjectRuntimeState();
}

// --- 自己收 -------------------------------------------------------------------------------
console.log('\n-- 自己收: every self-closing piece returns to rest on its own clock ---------');
for (const [modelId, spec] of entries) {
  if (!selfClosing(spec)) continue;
  const onAt = 1000;
  const tl = { onAt, offAt: null, armedAt: onAt, aim: null };
  const total = (spec.openTime ?? 0.55) + (spec.hold ?? 2) + (spec.closeTime ?? 0.75);
  const mid = objectOpen(spec, tl, onAt + ((spec.openTime ?? 0.55) + 0.01) * 1000);
  const after = objectOpen(spec, tl, onAt + (total + 0.01) * 1000);
  ok(`${modelId} · opens, then closes itself`, mid > 0.99 && after < 1e-6, `mid ${mid.toFixed(3)}, after ${after.toFixed(4)}`);
  ok(`${modelId} · its cycle is reported done so it can be retired`, objectCycleDone(spec, tl, onAt + (total + 0.01) * 1000));
}

// --- 起身 ---------------------------------------------------------------------------------
console.log('\n-- 起身 / 關掉: a released or toggled-off piece settles --------------------');
for (const [modelId, spec] of entries) {
  if (selfClosing(spec)) continue;
  const offAt = 5000;
  const tl = { onAt: null, offAt, armedAt: null, aim: null };
  const settleAt = offAt + ((spec.closeTime ?? 0.75) + 0.01) * 1000;
  const open = objectOpen(spec, tl, settleAt);
  ok(
    `${modelId} · back at rest after its close time, and settled`,
    open < 1e-6 && objectIsSettled(spec, tl, settleAt, open),
    `open ${open.toFixed(4)}`,
  );
}

// --- 釋放與清空 ----------------------------------------------------------------------------
console.log('\n-- release, retire, reset -------------------------------------------------');
{
  resetObjectRuntimeState();
  const seat = 'test-sofa';
  armObject(seat, 0, true);
  flushObjectEdges(now() + 1);
  releaseObject(seat);
  ok('releasing an occupied piece turns it off with an off timestamp', !objectIsOn(seat) && objectTimeline(seat).offAt != null);

  const tap = 'test-tap';
  armObject(tap, 0, true);
  flushObjectEdges(now() + 1);
  retireObject(tap);
  ok('a retired piece forgets it was ever on', !objectIsOn(tap) && objectTimeline(tap).onAt === null);

  const hob = 'test-hob-2';
  armObject(hob, 0, true);
  flushObjectEdges(now() + 1);
  armObject(seat, 5, true);
  resetObjectRuntimeState();
  ok('a save swap forgets every lit piece', !objectIsOn(hob) && objectStateSize() === 0);
  ok('…and every pending cue', !objectHasPendingEdge(seat));
}

console.log('');
if (failures > 0) {
  console.log(`FAIL — ${failures} of ${checks} checks failed.`);
  process.exit(1);
}
console.log(`PASS — ${checks} checks.`);
