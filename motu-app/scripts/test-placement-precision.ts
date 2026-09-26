/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 佈置／建造 —— 移動精度、選取鎖與堆疊 的規則測試。
 *
 * Run with `npm run test:placement`. Same tsx-script style as `test:pet-care` and the `audit:*`
 * checks, because that is the test runner this repo has.
 *
 * ## What it is guarding, and why each property is here
 *
 * Two player-visible faults produced this system, and both of them would still typecheck, still
 * run, and still be wrong:
 *
 *  §1/§2  **移動跨度過大.** A piece could only stand on a 0.5 grid, so a small pointer movement
 *         moved nothing at all and then moved half a metre. The property that replaces it is not
 *         "the constant is smaller" — it is that the mapping from pointer to world is CONTINUOUS
 *         and MONOTONIC at the scale a player nudges at, which is what the ray tests below state.
 *  §4/§5  **移動 A 卻選到 B.** Selection was re-derived from whatever the raycast hit on every
 *         pointer event, so a drag that passed over another model handed the gesture to it. The
 *         property is that the Active Object survives every pointer event that is not the player
 *         explicitly choosing something else — including the release that ends the drag, which is
 *         delivered as a click and is the one the old code could never have distinguished.
 *  §7/§8  **堆疊.** Contact must not read as collision, and a support must not read as an obstacle
 *         to the thing standing on it — indoors AND outdoors, through the same rule.
 *  §3     **Floating point.** Quantising is what makes a saved position survive a round trip; a
 *         quantiser that returns 0.30000000000000004 has done nothing useful.
 *
 * Everything here runs against the real modules the game ships. Footprints are registered through
 * the real `registerFootprint`, so a collider change shows up here rather than being re-implemented
 * in this file.
 */

import {
  ALIGN_STEP,
  DRAG_THRESHOLD_PX,
  PRECISION_STEP,
  TOUCH_DRAG_THRESHOLD_PX,
  canSelect,
  clearClickGuard,
  consumeCancelKeyGuard,
  dragThresholdFor,
  endSession,
  exceedsDragThreshold,
  getPlacementStep,
  guardCancelKey,
  guardNextClick,
  isClickGuarded,
  isManipulating,
  beginMove,
  endGesture,
  getPlacementSession,
  quantize,
  rayHitHorizontal,
  selectSubject,
  setAlignModifier,
  translateRayXZ,
  type PointerRayLike,
} from '../src/lib/placementSession';
import {
  boxFootprint,
  clampOntoSupport,
  getFootprint,
  makeObb,
  placementsCollide,
  registerFootprint,
} from '../src/lib/furniturePlacement';
import { resolveInteriorPlacement, type WallFace } from '../src/lib/interiorPlacement';
import type { ShellRoom } from '../src/constants/interiorShell';
import { PlacedItem } from '../src/types';

let failures = 0;
let checks = 0;

function eq(name: string, got: unknown, want: unknown): void {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures++;
    console.log(`FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  } else {
    console.log(`PASS  ${name}`);
  }
}

function ok(name: string, condition: boolean, detail = ''): void {
  eq(detail ? `${name} — ${detail}` : name, condition, true);
}

// --- Fixtures -----------------------------------------------------------------------------------

/**
 * Two pieces of furniture, registered exactly as the game registers a measured model.
 *
 * A wide low table that declares a top, and a small vase. Deliberately a plain box each: the point
 * of these tests is the placement rule, and the collider's own fidelity is `audit:colliders`'s job.
 */
const TABLE = 'item-22';        // 熱帶木桌 — declares `tabletop` in constants/items.ts
const VASE = 'deco-bonsai';     // 海島盆栽 — an ordinary ornament, so it takes DEFAULT_PLACEMENT

registerFootprint(TABLE, boxFootprint({
  cx: 0, cz: 0, halfW: 0.9, halfD: 0.5, minY: 0, maxY: 0.7, walk: null,
}));
registerFootprint(VASE, boxFootprint({
  cx: 0, cz: 0, halfW: 0.15, halfD: 0.15, minY: 0, maxY: 0.4, walk: null,
}));

/** A ray from above, aimed straight down at (x, z) — the simplest well-defined pointer. */
const downAt = (x: number, z: number, fromY = 6): PointerRayLike => ({
  origin: { x, y: fromY, z },
  direction: { x: 0, y: -1, z: 0 },
});

/** A ray from a slanted camera, which is what the game actually produces. */
function slantedAt(x: number, z: number): PointerRayLike {
  const len = Math.hypot(0.4, -1, 0.6);
  return {
    origin: { x: x - (0.4 / len) * 8, y: 8, z: z - (0.6 / len) * 8 },
    direction: { x: 0.4 / len, y: -1 / len, z: 0.6 / len },
  };
}

const NO_WALLS: WallFace[] = [];
/** One room at the origin. These cases are all about the floor and tabletops, but the resolver
 *  needs the house's shape to answer a ceiling mount, so it is stated rather than empty. */
const ONE_ROOM: ShellRoom[] = [{ cx: 0, cz: 0 }];

console.log('\n-- 一、量化是精確的，不是「大概」 (§3) --------------------------------');

{
  // The whole reason to quantise is that the SAME logical spot must be the same number every time
  // it is reached — otherwise nothing downstream can compare two positions, and a save/load round
  // trip slowly grows digits. `Math.round(v / step) * step` alone does not give you that.
  eq('a grid point is spelled exactly', quantize(0.06, 0.02), 0.06);
  eq('and so is a negative one', quantize(-0.06, 0.02), -0.06);
  eq('half a step rounds up, once', quantize(0.01, 0.02), 0.02);
  eq('zero stays zero, not -0', Object.is(quantize(-0.004, 0.02), 0), true);

  // Reached from below and from above, the same cell must produce one number — this is the
  // property that a naive multiply loses, and the one every `a === b` short-circuit depends on.
  for (let i = -50; i <= 50; i++) {
    const target = quantize(i * PRECISION_STEP, PRECISION_STEP);
    const fromBelow = quantize(i * PRECISION_STEP - PRECISION_STEP * 0.3, PRECISION_STEP);
    const fromAbove = quantize(i * PRECISION_STEP + PRECISION_STEP * 0.3, PRECISION_STEP);
    if (fromBelow !== target || fromAbove !== target) {
      ok('every cell has exactly one spelling', false, `cell ${i}`);
      break;
    }
    if (i === 50) ok('every cell has exactly one spelling', true, '101 cells, approached both ways');
  }

  // Re-quantising must be a no-op, or a position that goes through save → load → drag → save
  // drifts by half a step per round trip.
  let v = 1.234567;
  const once = quantize(v, PRECISION_STEP);
  for (let i = 0; i < 200; i++) v = quantize(quantize(v, PRECISION_STEP), PRECISION_STEP);
  eq('quantising is idempotent over 200 round trips', v, once);
}

console.log('\n-- 二、步進夠細，而且格線只是輔助 (§1, §2) ----------------------------');

{
  // The number the complaint was about. 0.5 was a quarter of a table's width; the replacement has
  // to be small enough that one step is invisible, and the align grid has to be smaller than what
  // it replaced or it is the same complaint with a modifier key in front of it.
  ok('the default step is fine enough to read as continuous', PRECISION_STEP <= 0.05,
    `PRECISION_STEP = ${PRECISION_STEP}`);
  ok('the align grid is coarser than the default', ALIGN_STEP > PRECISION_STEP);
  ok('but still finer than the 0.5 grid it replaced', ALIGN_STEP < 0.5,
    `ALIGN_STEP = ${ALIGN_STEP}`);

  endSession();
  eq('free movement is the default, not the exception', getPlacementStep(), PRECISION_STEP);
  setAlignModifier(true);
  eq('holding the modifier is what engages the grid', getPlacementStep(), ALIGN_STEP);
  eq('and the dock can see it', getPlacementSession().align, true);
  setAlignModifier(false);
  eq('releasing it goes straight back to free movement', getPlacementStep(), PRECISION_STEP);
}

console.log('\n-- 三、滑鼠小幅移動 → 物品小幅移動 (§1, §2, §15.1–15.3) ----------------');

{
  endSession();

  // THE REGRESSION TEST FOR THE ORIGINAL BUG. Walk the pointer across a room in 1 cm steps and
  // watch what the placement rule does with it. Under the old 0.5 grid this produced 49 samples
  // of no movement at all followed by one jump of 0.5; the requirement is that it produces small
  // movements throughout, and never a jump larger than one step.
  const positions: number[] = [];
  for (let i = 0; i <= 120; i++) {
    const resolved = resolveInteriorPlacement({
      itemId: VASE,
      instanceId: 'drag',
      rotation: 0,
      ray: downAt(-1 + i * 0.01, 0),
      faces: NO_WALLS,
      rooms: ONE_ROOM,
      placements: [],
    });
    positions.push(resolved.placement.position[0]);
  }

  const jumps = positions.slice(1).map((v, i) => Math.abs(v - positions[i]));
  const biggest = Math.max(...jumps);
  ok('no single 1 cm pointer step moves the piece more than one grid step',
    biggest <= PRECISION_STEP + 1e-9, `largest jump ${biggest.toFixed(4)}`);

  // "It responds at all" is a separate claim from "it does not lurch", and the old code failed
  // this one: over any short window of pointer travel the piece has to actually move.
  const stalls = jumps.filter((j) => j === 0).length;
  ok('the piece is not frozen for long stretches', stalls <= jumps.length / 2,
    `${stalls} of ${jumps.length} samples were stationary`);

  // Monotonic: dragging right never moves the piece left.
  ok('dragging one way never moves the piece the other way',
    positions.every((v, i) => i === 0 || v >= positions[i - 1] - 1e-9));

  // End to end, the piece travels the distance the pointer did.
  ok('120 cm of pointer travel is 120 cm of piece travel',
    Math.abs((positions[positions.length - 1] - positions[0]) - 1.2) <= PRECISION_STEP);

  // And the same walk under the align modifier is the coarse grid — deliberately steppy, because
  // that is what the player asked for by holding it.
  setAlignModifier(true);
  const aligned = resolveInteriorPlacement({
    itemId: VASE, instanceId: 'drag', rotation: 0,
    ray: downAt(0.37, 0.61), faces: NO_WALLS, rooms: ONE_ROOM, placements: [],
  });
  eq('the align modifier snaps to its own grid',
    [aligned.placement.position[0], aligned.placement.position[2]],
    [quantize(0.37, ALIGN_STEP), quantize(0.61, ALIGN_STEP)]);
  setAlignModifier(false);
}

console.log('\n-- 四、抓取點：拿住哪裡就是哪裡 (§2) ----------------------------------');

{
  // The other half of "it jumps": with no grab offset the object's ORIGIN went to the cursor, so
  // taking hold of a table by its corner threw the table a metre before the mouse had moved.
  //
  // The offset is applied by translating the ray, and the claim that makes that correct is exactly
  // this: for any horizontal plane, moving the ray's origin in XZ moves the hit by the same
  // vector. It has to hold for a slanted camera ray, not just a straight-down one.
  for (const [name, ray] of [['straight down', downAt(2, -1)], ['slanted camera', slantedAt(2, -1)]] as const) {
    const before = rayHitHorizontal(ray, 0.35)!;
    const after = rayHitHorizontal(translateRayXZ(ray, 0.7, -0.4), 0.35)!;
    ok(`the grab offset moves the hit by exactly itself (${name})`,
      Math.abs(after.x - before.x - 0.7) < 1e-9 && Math.abs(after.z - before.z + 0.4) < 1e-9);
  }

  // Which means: grab a piece anywhere on itself, and the first sample of the drag leaves it
  // exactly where it already was. A drag that starts by moving the object is the bug.
  const origin: [number, number, number] = [3, 0, -2];
  const grabRay = slantedAt(3.6, -1.5);          // taken hold of 60cm along, 50cm across
  const hit = rayHitHorizontal(grabRay, origin[1])!;
  const grab: [number, number] = [origin[0] - hit.x, origin[2] - hit.z];
  const settled = rayHitHorizontal(translateRayXZ(grabRay, grab[0], grab[1]), origin[1])!;
  ok('grabbing a piece by its edge does not move it',
    Math.abs(settled.x - origin[0]) < 1e-9 && Math.abs(settled.z - origin[2]) < 1e-9);
}

console.log('\n-- 五、Active Object：移動 A 時不會變成 B (§4, §5, §6, §15.6–15.9) -----');

{
  endSession();
  ok('nothing held means anything can be selected', canSelect('B'));
  eq('and nothing is being manipulated', isManipulating(), false);

  selectSubject('A');
  eq('choosing A makes A the Active Object', getPlacementSession().activeId, 'A');
  ok('merely holding A still allows an explicit switch to B', canSelect('B'),
    'SELECTED is not a lock — §13');

  beginMove('A');
  eq('a drag is the locked phase', isManipulating(), true);
  ok('the cursor passing over B does not let B be selected', !canSelect('B'));
  ok('nor C, nor D', !canSelect('C') && !canSelect('D'));
  ok('A itself is still selectable, so the held piece is not the one thing you cannot click',
    canSelect('A'));
  eq('and the Active Object has not moved', getPlacementSession().activeId, 'A');

  endGesture();
  eq('releasing returns to SELECTED, still holding A', getPlacementSession().phase, 'selected');
  eq('A is still the subject', getPlacementSession().activeId, 'A');

  // THE EVENT-ORDERING CASE. The release that ends a drag is also delivered as a click, AFTER the
  // gesture has ended — so the phase lock alone can never catch it. This is the exact sequence
  // that used to hand the table to the player who was dragging a book across it.
  clearClickGuard();
  beginMove('A');
  guardNextClick();   // what usePlacementDrag does when a drag that MOVED is released
  endGesture();
  ok('the release that ended a drag is not a selection', !canSelect('B'));
  ok('and the ground click it also produces is refused', isClickGuarded());
  clearClickGuard();  // what the next pointerdown does
  ok('but the very next press restores ordinary selection', canSelect('B'));

  // A press and release that never moved is an ordinary click and must still select.
  beginMove('A');
  endGesture();       // no guardNextClick: the drag never moved
  ok('a tap that did not drag still selects', canSelect('B'));

  endSession();
  eq('ending the session releases the Active Object', getPlacementSession().activeId, null);
  eq('and clears any outstanding claim', isClickGuarded(), false);
}

console.log('\n-- 五之二、點擊 vs 拖曳：門檻在哪裡 (§8, §11) --------------------------');

{
  /*
    The click/drag boundary, as arithmetic.

    The property under test is not "there is a constant" — it is that the SAME press produces
    different verbs depending only on how far the hand travelled, and that a finger is given more
    room than a mouse. Both placement modes read this one function (usePlacementDrag), so a change
    here is a change to 室內 and 室外 together, which is the whole point of pulling it out of the
    hook and into the session module.
  */
  ok('a mouse press that does not move is a CLICK', !exceedsDragThreshold(0, 0, 'mouse'));
  ok('and so is the pixel or two a real mouse reports between down and up',
    !exceedsDragThreshold(2, 2, 'mouse'), `${Math.hypot(2, 2).toFixed(2)}px < ${DRAG_THRESHOLD_PX}`);
  ok('a deliberate pull is a DRAG', exceedsDragThreshold(0, 12, 'mouse'));
  eq('the boundary itself counts as a drag, so there is no dead value',
    exceedsDragThreshold(DRAG_THRESHOLD_PX, 0, 'mouse'), true);

  // Diagonal travel is measured as distance, not per-axis: 3px right and 3px down is 4.24px of
  // hand movement and must read the same as 4.24px in a straight line.
  ok('travel is measured as a distance, not per axis', exceedsDragThreshold(3, 3, 'mouse'));

  // A fingertip never lands still. At the mouse threshold every tap on a piece of furniture would
  // be a small drag — and on touch there is no hover, so a tap is the only way to LOOK at
  // something.
  ok('the same wobble from a finger is still a tap', !exceedsDragThreshold(6, 4, 'touch'),
    `${Math.hypot(6, 4).toFixed(2)}px < ${TOUCH_DRAG_THRESHOLD_PX}`);
  ok('but a real swipe on glass drags', exceedsDragThreshold(0, 24, 'touch'));
  ok('touch is given more room than a mouse',
    dragThresholdFor('touch') > dragThresholdFor('mouse'));
  eq('a pen is held to the mouse\'s precision', dragThresholdFor('pen'), dragThresholdFor('mouse'));
  eq('and an unknown device too, rather than falling through to nothing',
    dragThresholdFor(undefined), DRAG_THRESHOLD_PX);

  /*
    The gesture the threshold buys, end to end.

    An armed press that never crosses the threshold must leave the session exactly as an ordinary
    click would: no lock while the button is down, and no claim on the release. That is what makes
    「點一下＝選取」 survive a hand that is not perfectly still.
  */
  endSession();
  selectSubject('A');
  ok('an armed press does not lock the session before the threshold', canSelect('B'));
  eq('and nothing is being manipulated yet', isManipulating(), false);
  beginMove('A');       // what crossing the threshold does
  eq('crossing it is what enters the locked phase', isManipulating(), true);
  endGesture();
  endSession();
}

console.log('\n-- 五之三、ESC 的兩個意思 (§10, §11) -----------------------------------');

{
  /*
    Escape means two different things and both placement modes bind it on the window:

      mid-drag → 取消這次搬動 (usePlacementDrag puts the object back; the piece stays held)
      at rest  → 放下這個東西 (the mode drops the whole session)

    The drag takes the key in the capture phase and stops it, which settles a real keypress. This
    flag is what settles the case `stopPropagation` cannot: an event dispatched AT the window has a
    one-node path, so every listener on that node runs regardless. Without the flag the drag
    cancelled correctly and the mode then closed the editor anyway — one Escape doing both jobs,
    which is the one outcome neither meaning wants.
  */
  ok('an Escape nobody claimed reaches the mode handler', !consumeCancelKeyGuard());

  guardCancelKey();
  ok('an Escape the drag spent is refused to the mode handler', consumeCancelKeyGuard());
  ok('and it is spent exactly once, so the NEXT Escape still puts the piece down',
    !consumeCancelKeyGuard());
}

console.log('\n-- 六、堆疊：接觸不是碰撞 (§7, §8, §15.10–15.14) -----------------------');

{
  const table: PlacedItem = { instanceId: 't1', itemId: TABLE, position: [0, 0, 0], rotation: 0 };
  const tableTop = getFootprint(TABLE)!.maxY;

  // Resting ON the table: the two occupy the same ground but not the same height, and the vertical
  // band test is what has to say so. Getting this wrong is "花瓶碰到桌面就說不能放".
  const onTable: PlacedItem = { instanceId: 'v1', itemId: VASE, position: [0, tableTop, 0], rotation: 0 };
  ok('a vase resting on a table is not colliding with it', !placementsCollide(onTable, table));

  // Sunk INTO the table is a real overlap and must stay one, or the distinction is meaningless.
  const insideTable: PlacedItem = { instanceId: 'v2', itemId: VASE, position: [0, tableTop - 0.3, 0], rotation: 0 };
  ok('a vase sunk into the table still is', placementsCollide(insideTable, table));

  // Side by side on the floor, touching but not interpenetrating.
  const beside: PlacedItem = { instanceId: 'v3', itemId: VASE, position: [1.15, 0, 0], rotation: 0 };
  ok('a vase standing beside the table is not colliding', !placementsCollide(beside, table));

  // Indoors, the resolver has to actually PUT it on the table when the player points at the table,
  // and put it on the floor when they point past the edge. Nearest surface wins, no mode switch.
  const ontoTable = resolveInteriorPlacement({
    itemId: VASE, instanceId: 'v', rotation: 0,
    ray: downAt(0.2, 0.1), faces: NO_WALLS, rooms: ONE_ROOM, placements: [table],
  });
  eq('pointing at a table stands the piece on the table', ontoTable.mount, 'surface');
  eq('and names what it is standing on', ontoTable.supportId, 't1');
  eq('at the height of the top, not sunk into it', ontoTable.placement.position[1], tableTop);
  eq('and the spot is legal — the support is not an obstacle to what stands on it', ontoTable.ok, true);

  const pastTheEdge = resolveInteriorPlacement({
    itemId: VASE, instanceId: 'v', rotation: 0,
    ray: downAt(4, 0), faces: NO_WALLS, rooms: ONE_ROOM, placements: [table],
  });
  eq('pointing past it puts the piece on the floor behind', pastTheEdge.mount, 'floor');
  eq('with nothing under it', pastTheEdge.supportId, null);

  // The clamp: aimed at the very corner of the top, the piece slides back on rather than being
  // left hanging over the edge.
  const atTheEdge = resolveInteriorPlacement({
    itemId: VASE, instanceId: 'v', rotation: 0,
    ray: downAt(0.88, 0.48), faces: NO_WALLS, rooms: ONE_ROOM, placements: [table],
  });
  eq('a piece aimed at the corner of a table still lands on the table', atTheEdge.mount, 'surface');
  const [cx, , cz] = atTheEdge.placement.position;
  const vase = getFootprint(VASE)!;
  ok('and wholly on it, not hanging over the edge',
    Math.abs(cx) + vase.halfW <= 0.9 + 1e-9 && Math.abs(cz) + vase.halfD <= 0.5 + 1e-9,
    `landed at (${cx.toFixed(3)}, ${cz.toFixed(3)})`);
}

console.log('\n-- 七、堆疊的夾取規則是共用的 (§14) ------------------------------------');

{
  // The clamp indoors and the clamp outdoors are the same function — this is the shared half of
  // "室內外統一" for surface placement. Checked directly so that a change to one is a change to
  // both by construction rather than by review.
  const support = makeObb(getFootprint(TABLE)!, 0, 0, 0);
  const candidate = makeObb(getFootprint(VASE)!, 5, 5, 0);
  const slide = clampOntoSupport(candidate, support)!;
  ok('anything aimed off the support is pulled back onto it', !!slide);
  ok('and lands inside its top face',
    Math.abs(candidate.cx + slide.dx) <= 0.9 - 0.15 + 1e-9 &&
    Math.abs(candidate.cz + slide.dz) <= 0.5 - 0.15 + 1e-9);

  const alreadyInside = makeObb(getFootprint(VASE)!, 0.1, 0.1, 0);
  const noSlide = clampOntoSupport(alreadyInside, support)!;
  eq('a piece already wholly on the support is not moved', [noSlide.dx, noSlide.dz], [0, 0]);

  // A support smaller than the thing being put on it is a refusal, not a clamp — otherwise a deck
  // would be dragged to wherever a table happened to be.
  eq('a support too small to hold the piece refuses instead of dragging it',
    clampOntoSupport(support, makeObb(getFootprint(VASE)!, 0, 0, 0)), null);

  // Rotation is not a special case: the clamp works in the support's own frame.
  const turned = makeObb(getFootprint(TABLE)!, 0, 0, Math.PI / 4);
  const diagonal = clampOntoSupport(makeObb(getFootprint(VASE)!, 3, 3, 0.6), turned)!;
  ok('a rotated support clamps in its own frame', !!diagonal);
  const px = 3 + diagonal.dx;
  const pz = 3 + diagonal.dz;
  const u = (px - turned.cx) * turned.ux + (pz - turned.cz) * turned.uz;
  const v = (px - turned.cx) * turned.vx + (pz - turned.cz) * turned.vz;
  ok('and the result really is on the turned top face',
    Math.abs(u) <= turned.halfW + 1e-9 && Math.abs(v) <= turned.halfD + 1e-9);
}

console.log(
  failures === 0
    ? `\nALL PASS (${checks} checks)\n`
    : `\n${failures} of ${checks} checks FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
