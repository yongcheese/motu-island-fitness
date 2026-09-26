/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 商品碎片 × 可重複購買 — rules tests.
 *
 * Run with `npm run test:fragment-progress`. Same tsx-script style as `test:economy` and the
 * `audit:*` checks, because that is the test runner this repo has.
 *
 * ## The bug this file exists to stop coming back
 *
 * 「已擁有」 and 「碎片這條路結束了」 used to be the same boolean, asked separately in five places:
 *
 *   1. `FragmentMeter`             hid itself on `owned && held === 0`
 *   2. `PurchaseDialog`            hid the meter on `ownedCount > 0`
 *   3. `canUnlockWithFragments`    refused on `owned`
 *   4. `fragmentPatchForPurchase`  DELETED the stack on any gold purchase
 *   5. `rollWorkoutFragmentItem`   dropped owned items out of the drop pool
 *
 * For a hat that is right — there is one of it. For a sofa every one of them is wrong, because a
 * sofa can be bought again and the fragments a player holds are still valid for the next one.
 *
 * The reported symptom was only (1) and (2). Fixing those two alone would have produced a bar that
 * never moves (5), under a button that refuses (3), over a stack that had already been destroyed by
 * the purchase (4) — which is why the fix is one predicate, {@link collectsFragments}, and why the
 * checks below assert all five against it rather than testing the two surfaces the bug was noticed
 * on.
 *
 * What this deliberately does NOT test: Firestore and the React layer. `fragmentPatchForPurchase` is
 * a pure function of (profile, settings, itemId) and is checked directly; the components are checked
 * by asserting the predicate they now call, with their own gate mirrored here so that a change to
 * the rule fails in this file rather than only in a browser.
 */

import {
  FRAGMENTS_PER_TICKET,
  FRAGMENTS_TO_UNLOCK,
  canUnlockWithFragments,
  collectsFragments,
  getFragmentCount,
  isFragmentItem,
  isRepeatableFragmentItem,
  rollWorkoutFragmentItem,
  settleFragmentGain,
} from '../src/constants/fragments';
import { fragmentPatchForPurchase } from '../src/context/useFragmentActions';
import { ALL_ITEMS, getItemById } from '../src/constants/items';
import { isStackableItem } from '../src/utils/inventory';
import type { UserProfile } from '../src/types';

let failures = 0;
let checks = 0;

function eq(name: string, got: unknown, want: unknown): void {
  checks++;
  if (JSON.stringify(got) === JSON.stringify(want)) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  }
}

function ok(name: string, condition: boolean, detail = ''): void {
  eq(name + (detail ? ` (${detail})` : ''), condition, true);
}

const profile = (over: Partial<UserProfile> = {}): UserProfile =>
  ({
    userId: 'u-1',
    displayName: 'tester',
    level: 1,
    currentXp: 0,
    territoryLevel: 1,
    balanceGold: 0,
    inventory: [],
    islandPlacements: [],
    itemFragments: {},
    raffleTickets: 0,
    raffleTicketProgress: 0,
    ...over,
  }) as unknown as UserProfile;

/* --------------------------------------------------------------- the two kinds of item */

// Picked by KIND rather than by id, so the test still means something after a catalog edit: the
// first fragment item that stacks, and the first that does not.
const REPEATABLE = ALL_ITEMS.find((i) => isFragmentItem(i) && isStackableItem(i.id));
const ONCE_ONLY = ALL_ITEMS.find((i) => isFragmentItem(i) && !isStackableItem(i.id));

if (!REPEATABLE || !ONCE_ONLY) {
  console.log('FAIL  the catalog no longer holds one item of each kind');
  process.exit(1);
}

console.log('\n-- fixtures ------------------------------------------------------------');
console.log(`  可重複購買：${REPEATABLE.name} (${REPEATABLE.id})`);
console.log(`  一次性　　：${ONCE_ONLY.name} (${ONCE_ONLY.id})`);

console.log('\n-- 1. the predicate itself ---------------------------------------------');

ok('a stackable fragment item is repeatable', isRepeatableFragmentItem(REPEATABLE));
ok('an own-once fragment item is not', !isRepeatableFragmentItem(ONCE_ONLY));
ok(
  'something with no fragment of its own is never repeatable',
  !isRepeatableFragmentItem('nope-not-an-id'),
  'the fragment test comes first, so a 限時商店 exclusive still settles on purchase',
);

eq('unowned repeatable is still collecting', collectsFragments(REPEATABLE.id, false), true);
eq('OWNED repeatable is still collecting', collectsFragments(REPEATABLE.id, true), true);
eq('unowned own-once is still collecting', collectsFragments(ONCE_ONLY.id, false), true);
eq('OWNED own-once has finished', collectsFragments(ONCE_ONLY.id, true), false);

console.log('\n-- 2. 首次購買前：碎片累積線條顯示 --------------------------------------');

// FragmentMeter's own gate, mirrored: it draws while the item is still collecting, and also for a
// finished item that somehow still holds a stack.
const meterVisible = (itemId: string, owned: boolean, held: number) =>
  isFragmentItem(itemId) && (collectsFragments(itemId, owned) || held > 0);

ok('unowned repeatable at 0/200 shows the bar', meterVisible(REPEATABLE.id, false, 0));
ok('unowned own-once at 0/200 shows the bar', meterVisible(ONCE_ONLY.id, false, 0));

console.log('\n-- 3. 購買完成一次之後 --------------------------------------------------');

ok('OWNED repeatable STILL shows the bar', meterVisible(REPEATABLE.id, true, 0), 'the reported bug');
ok('OWNED own-once hides the bar', !meterVisible(ONCE_ONLY.id, true, 0), 'unchanged, and correct');
ok(
  'OWNED own-once holding a leftover stack still reports it',
  meterVisible(ONCE_ONLY.id, true, 40),
  'a stack that should not exist is surfaced, not swallowed',
);

console.log('\n-- 4. 用金幣購買不會吃掉可重複購買商品的碎片 ----------------------------');

const halfWay = profile({ itemFragments: { [REPEATABLE.id]: 180, [ONCE_ONLY.id]: 180 } });

eq(
  'buying a repeatable item with gold leaves its stack alone',
  fragmentPatchForPurchase(halfWay, null, REPEATABLE.id),
  {},
);
ok(
  'buying an own-once item with gold still converts its stack to 抽獎券',
  (() => {
    const patch = fragmentPatchForPurchase(halfWay, null, ONCE_ONLY.id) as Partial<UserProfile>;
    return (
      patch.itemFragments?.[ONCE_ONLY.id] === undefined &&
      patch.raffleTickets === Math.floor(180 / FRAGMENTS_PER_TICKET)
    );
  })(),
  '180 / 20 = 9 張',
);

console.log('\n-- 5. 再次獲得碎片：進度真的會動 ----------------------------------------');

// grantFragments' own branch, mirrored: a live stack accumulates, a finished one overflows.
const grantOnto = (itemId: string, owned: boolean, current: number, amount: number) => {
  const live = collectsFragments(itemId, owned);
  const before = live ? current : FRAGMENTS_TO_UNLOCK;
  const settled = settleFragmentGain({ current: before, amount, carry: 0, convert: true });
  return { stored: live ? settled.stored : current, kept: settled.kept, tickets: settled.tickets };
};

eq('an OWNED repeatable item accumulates a new stack', grantOnto(REPEATABLE.id, true, 40, 25).stored, 65);
eq(
  'an OWNED own-once item pays 抽獎券 instead, and its stack does not move',
  grantOnto(ONCE_ONLY.id, true, 0, 40),
  { stored: 0, kept: 0, tickets: 2 },
);

ok(
  'an owned repeatable item is still in the workout drop pool',
  (() => {
    // Everything owned, so the only tier left is the repeatable one. Under the old rule the pool
    // fell all the way through to FRAGMENT_ITEMS and could hand back an own-once item, whose bar
    // could then never move.
    const everythingOwned = () => true;
    const rolled = rollWorkoutFragmentItem(profile(), everythingOwned, () => 0.99);
    return !!rolled && isRepeatableFragmentItem(rolled);
  })(),
  'otherwise the bar shows but can never fill',
);

console.log('\n-- 6. 再次達成需求：可以再次解鎖 ----------------------------------------');

const full = profile({
  itemFragments: { [REPEATABLE.id]: FRAGMENTS_TO_UNLOCK, [ONCE_ONLY.id]: FRAGMENTS_TO_UNLOCK },
});

ok('a full stack on an UNOWNED repeatable unlocks', canUnlockWithFragments(full, REPEATABLE.id, false));
ok('a full stack on an OWNED repeatable unlocks AGAIN', canUnlockWithFragments(full, REPEATABLE.id, true));
ok('a full stack on an UNOWNED own-once unlocks', canUnlockWithFragments(full, ONCE_ONLY.id, false));
ok('a full stack on an OWNED own-once does NOT', !canUnlockWithFragments(full, ONCE_ONLY.id, true));

console.log('\n-- 7. the split holds for the whole catalog -----------------------------');

const fragmentItems = ALL_ITEMS.filter(isFragmentItem);
const repeatable = fragmentItems.filter(isRepeatableFragmentItem);

ok(
  'every fragment item answers the repeatable question exactly as isStackableItem does',
  fragmentItems.every((i) => isRepeatableFragmentItem(i) === isStackableItem(i.id)),
  '「可不可以再買一件」 has one answer in this codebase, not two',
);
ok(
  'both kinds exist in real numbers, so neither branch is dead',
  repeatable.length > 20 && fragmentItems.length - repeatable.length > 20,
  `${repeatable.length} 可重複 / ${fragmentItems.length - repeatable.length} 一次性`,
);
ok(
  'the 戶外家具 in the report are all on the repeatable side',
  ['deco-shrub-round', 'deco-lounger-wood', 'deco-hanging-chair', 'item-19']
    .map((id) => getItemById(id))
    .every((i) => !!i && isRepeatableFragmentItem(i)),
);
ok(
  'a stack is never above the cap, whichever branch it took',
  [0, 50, 199, 200].every(
    (current) => settleFragmentGain({ current, amount: 500, carry: 0, convert: true }).stored <= FRAGMENTS_TO_UNLOCK,
  ),
);
eq(
  'getFragmentCount still floors a junk value',
  getFragmentCount(profile({ itemFragments: { x: -5 } } as Partial<UserProfile>), 'x'),
  0,
);

console.log(failures === 0 ? `\nALL PASS (${checks} checks)\n` : `\n${failures} of ${checks} checks FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
