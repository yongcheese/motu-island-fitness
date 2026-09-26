/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 健身獎勵 — rules tests.
 *
 * Run with `npm run test:workout-rewards`. Same tsx-script style as `test:daily-login`,
 * `test:offline-return` and the `audit:*` checks, because that is the test runner this repo has.
 *
 * The properties pinned here are the ones the brief states as requirements and that are cheap to
 * get wrong months later — most of them are properties of the CATALOG as much as of the code, so
 * this is also the check that catches somebody pricing a 神話 item at 200 gold:
 *
 *  §3/§4  nothing expensive, graded, premium, limited or earned can ever be in the newbie pool
 *  §4     the pool is derived from the catalog, never enumerated — it must be non-empty and every
 *         member must be a wearable from a declared category
 *  §5     Filter → Random, never Random → Check: a draw can only ever return a pool member
 *  §6/§13 one account claims 首次健身獎勵 exactly once, and a replayed completion changes nothing
 *  §11    an invalid completion is not a completion
 *  §19    the rules table drives everything; nothing branches on a specific trigger id
 *
 * What it deliberately does NOT test: the write path and the React layer. Those need a Firestore
 * and a DOM; what is testable without either is every rule that decides WHAT is granted, which is
 * the half that silently rots as the catalog grows.
 */

import { ALL_ITEMS, getItemById } from '../src/constants/items';
import {
  getLastWorkoutCompletion,
  makeWorkoutCompletion,
  reportWorkoutCompletion,
  resetWorkoutCompletionBus,
  subscribeWorkoutCompletion,
} from '../src/lib/workoutCompletion';
import { getDisplayCategory } from '../src/utils/categoryUtils';
import { rarityRank } from '../src/constants/rarity';
import {
  NEWBIE_PRICE_CEILING,
  NEWBIE_REWARD_POOL,
  PROCESSED_ID_LIMIT,
  WORKOUT_REWARD_RULES,
  WORKOUT_VALIDITY,
  appendProcessedId,
  buildRewardPool,
  drawReward,
  hasClaimed,
  hasProcessed,
  isEligibleForPool,
  isValidWorkout,
  pickRewardFrom,
  resolvePendingRewards,
  seedFrom,
  type WorkoutCompletion,
  type WorkoutRewardState,
} from '../src/constants/workoutRewards';

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
  eq(name + (detail ? ` (${detail})` : ''), condition, true);
}

const completion = (over: Partial<WorkoutCompletion> = {}): WorkoutCompletion => ({
  workoutId: 'wk-1',
  userId: 'u-1',
  completedAt: '2026-08-24T10:00:00.000Z',
  workoutType: '開合跳',
  durationSeconds: 90,
  repCount: 12,
  source: 'prototype',
  ...over,
});

console.log('\n-- what counts as a workout (§11) -------------------------------------');

ok('a normal workout is valid', isValidWorkout(completion()));
ok('nothing is not a workout', !isValidWorkout(null));
ok('an id-less completion is refused', !isValidWorkout(completion({ workoutId: '' })));
ok('a user-less completion is refused', !isValidWorkout(completion({ userId: '' })));
ok('an unparseable timestamp is refused', !isValidWorkout(completion({ completedAt: 'soon' })));
ok(
  'opening and closing the screen is not a workout',
  !isValidWorkout(completion({ durationSeconds: 2, repCount: 0 })),
);
ok(
  'long enough counts even with no reps reported (a run)',
  isValidWorkout(completion({ durationSeconds: WORKOUT_VALIDITY.minDurationSeconds, repCount: undefined })),
);
ok(
  'enough reps counts even when it was quick (a set)',
  isValidWorkout(completion({ durationSeconds: 1, repCount: WORKOUT_VALIDITY.minReps })),
);
ok(
  'a NaN duration cannot pass as effort',
  !isValidWorkout(completion({ durationSeconds: Number.NaN, repCount: 0 })),
);

console.log('\n-- the pool is derived, and it is not empty (§4) -----------------------');

const pool = buildRewardPool(NEWBIE_REWARD_POOL);
ok('the newbie pool has items in it', pool.length > 0, `${pool.length} 件`);
ok(
  'the pool is a strict subset of the catalog',
  pool.every((item) => ALL_ITEMS.includes(item)),
);
ok(
  'every pool member is in a declared category',
  pool.every((item) => !!getDisplayCategory(item.shopCategory)),
);
ok(
  'every pool member is worn, not placed or applied',
  pool.every((item) => getDisplayCategory(item.shopCategory)?.kind === 'wearable'),
  'kind === wearable',
);
ok(
  'every pool member belongs to 人物外觀',
  pool.every((item) => getDisplayCategory(item.shopCategory)?.mainSection === 'PERSON'),
);

console.log('\n-- nothing valuable can get in (§3) ------------------------------------');

ok(
  'nothing above the ceiling',
  pool.every((item) => item.price <= NEWBIE_PRICE_CEILING),
  `<= ${NEWBIE_PRICE_CEILING}`,
);
ok('nothing free', pool.every((item) => item.price >= NEWBIE_REWARD_POOL.minPrice));
// Was 「no rarity tier at all」 (`item.rarity === undefined`) until 2026-08-25, when rarity became
// REQUIRED on every catalog item. That assertion was testing the OLD way of spelling 「這是一件普通
// 商品」 — an absent field — and there is no such state any more, so it is restated in the tier's
// own name rather than deleted. The INTENT is identical and is the thing worth keeping: the newbie
// pool hands out ordinary goods and nothing else. See constants/rarity.ts.
ok('nothing above 普通', pool.every((item) => item.rarity === 'common'), 'rarity === common');
ok('nothing earned by 經驗值', pool.every((item) => (item.xpUnlock ?? 0) === 0));
ok('nothing retired', pool.every((item) => !!getItemById(item.id)));
ok(
  'no 特殊飾品 / 寵物 / 寵物飾品',
  pool.every((item) => !['SpecialFx', 'Dogs', 'Cats', 'Birds', 'PetGear', 'Pets'].includes(item.shopCategory)),
);
ok(
  'no furniture, art, house styles, floors or walls',
  pool.every((item) => {
    const section = getDisplayCategory(item.shopCategory)?.mainSection;
    return section !== 'INDOOR' && section !== 'OUTDOOR';
  }),
);

// The other direction: every item the rules SHOULD admit is in fact admitted, so the filter cannot
// quietly narrow to nothing while still passing every exclusion test above.
const expected = ALL_ITEMS.filter(
  (item) =>
    NEWBIE_REWARD_POOL.categories.includes(item.shopCategory) &&
    item.price >= NEWBIE_REWARD_POOL.minPrice &&
    item.price <= NEWBIE_REWARD_POOL.maxPrice &&
    (item.xpUnlock ?? 0) === 0 &&
    // `maxRarity` is nullable and `null` now means 「不設上限」 rather than 「只收未標記的」, so the
    // comparison has to be guarded the same way isEligibleForPool guards it. Reading it as a plain
    // `<=` against `rarityRank(null)` (-1) would make an unbounded pool admit nothing.
    (NEWBIE_REWARD_POOL.maxRarity == null ||
      rarityRank(item.rarity) <= rarityRank(NEWBIE_REWARD_POOL.maxRarity)),
);
eq('the pool is exactly what the rules describe', pool.map((i) => i.id), expected.map((i) => i.id));

// A synthetic item per exclusion, so the gate is tested rather than merely observed to hold on
// today's catalog — the catalog could stop containing a counter-example at any time.
const base = pool[0];
ok(
  'an expensive item in an allowed category is refused',
  !isEligibleForPool({ ...base, id: 'x-expensive', price: NEWBIE_PRICE_CEILING + 1 }, NEWBIE_REWARD_POOL),
);
// Same restatement, in the other direction: 普通 is what the pool ADMITS now, so the synthetic
// item that must be refused is the rung above it. This is the check that catches the pool's
// ceiling being widened by accident.
ok(
  'an item one rung above the ceiling is refused',
  !isEligibleForPool({ ...base, id: 'x-rare', rarity: 'rare' }, NEWBIE_REWARD_POOL),
);
ok(
  'an ordinary item at a newbie price is admitted',
  isEligibleForPool({ ...base, id: 'x-common', price: 100, rarity: 'common' }, NEWBIE_REWARD_POOL),
);
ok(
  'a 神話 item at a newbie price is still refused',
  !isEligibleForPool({ ...base, id: 'x-mythic', price: 100, rarity: 'mythic' }, NEWBIE_REWARD_POOL),
);
ok(
  'an XP-unlock item is refused',
  !isEligibleForPool({ ...base, id: 'x-xp', price: 100, xpUnlock: 100 }, NEWBIE_REWARD_POOL),
);
ok(
  'a cheap sofa is refused',
  !isEligibleForPool({ ...base, id: 'x-sofa', price: 100, shopCategory: 'Living' }, NEWBIE_REWARD_POOL),
);
ok(
  'an item in a category that no longer exists is refused',
  !isEligibleForPool({ ...base, id: 'x-ghost', shopCategory: 'NoSuchCategory' }, NEWBIE_REWARD_POOL),
);

console.log('\n-- filter, then draw (§5) ----------------------------------------------');

ok('an empty list draws nothing', pickRewardFrom([], 12345) === null);
ok(
  'every seed lands inside the pool',
  Array.from({ length: 500 }, (_, i) => pickRewardFrom(pool, i)).every((item) => !!item && pool.includes(item)),
);
ok(
  'the same seed always draws the same item',
  pickRewardFrom(pool, 9_999)?.id === pickRewardFrom(pool, 9_999)?.id,
);
ok(
  'the same completion id always draws the same item (a retry cannot re-roll)',
  drawReward(NEWBIE_REWARD_POOL, [], seedFrom('wk-abc')).ok &&
    JSON.stringify(drawReward(NEWBIE_REWARD_POOL, [], seedFrom('wk-abc'))) ===
      JSON.stringify(drawReward(NEWBIE_REWARD_POOL, [], seedFrom('wk-abc'))),
);
ok(
  'different completions do not all draw the same item',
  new Set(
    Array.from({ length: 60 }, (_, i) => {
      const draw = drawReward(NEWBIE_REWARD_POOL, [], seedFrom(`wk-${i}`));
      return draw.ok ? draw.item.id : 'none';
    }),
  ).size > 1,
);

const ownedAllButOne = pool.slice(0, -1).map((item) => item.id);
const lastLeft = drawReward(NEWBIE_REWARD_POOL, ownedAllButOne, seedFrom('wk-owned'));
ok(
  'an owned item is skipped while anything else is left',
  lastLeft.ok && lastLeft.item.id === pool[pool.length - 1].id,
);
const allOwned = drawReward(NEWBIE_REWARD_POOL, pool.map((item) => item.id), seedFrom('wk-all'));
ok(
  'owning the whole pool still yields a reward rather than nothing',
  allOwned.ok && allOwned.fromOwnedFallback,
);

console.log('\n-- once per account (§6) ----------------------------------------------');

const fresh: WorkoutRewardState = {};
eq('a fresh account is owed the first-workout reward', resolvePendingRewards(fresh).map((r) => r.id), ['first_workout']);
ok('a fresh account has not claimed it', !hasClaimed(fresh, 'first_workout'));

const claimed: WorkoutRewardState = {
  claims: {
    first_workout: { itemId: pool[0].id, grantedAt: '2026-08-24T10:00:00.000Z', workoutId: 'wk-1', source: 'prototype' },
  },
  completedCount: 1,
};
ok('a claimed account has claimed it', hasClaimed(claimed, 'first_workout'));
eq('a claimed account is owed nothing', resolvePendingRewards(claimed), []);
eq(
  'still owed nothing after a hundred more workouts',
  resolvePendingRewards({ ...claimed, completedCount: 101 }),
  [],
);

console.log('\n-- replay protection (§13) --------------------------------------------');

ok('an unseen completion has not been processed', !hasProcessed(fresh, 'wk-1'));
const afterOne: WorkoutRewardState = { processedIds: appendProcessedId(fresh, 'wk-1') };
ok('a seen completion has been processed', hasProcessed(afterOne, 'wk-1'));
eq('recording the same id twice does not duplicate it', appendProcessedId(afterOne, 'wk-1'), ['wk-1']);

let ring: WorkoutRewardState = {};
for (let i = 0; i < PROCESSED_ID_LIMIT + 5; i++) ring = { processedIds: appendProcessedId(ring, `wk-${i}`) };
eq('the id list is capped', ring.processedIds?.length, PROCESSED_ID_LIMIT);
ok('the newest id is kept', hasProcessed(ring, `wk-${PROCESSED_ID_LIMIT + 4}`));
ok('the oldest id has aged out', !hasProcessed(ring, 'wk-0'));

console.log('\n-- the completion interface (§8) ---------------------------------------');

// The bus is what keeps the prototype and a future API interchangeable, so its contract is pinned
// here rather than left to the one component that happens to call it today.

resetWorkoutCompletionBus();
const built = makeWorkoutCompletion({
  userId: 'u-1',
  workoutType: '開合跳',
  durationSeconds: 90.4,
  repCount: 12.6,
  source: 'prototype',
});
ok('a built completion gets an id', !!built.workoutId);
ok('a built completion gets a timestamp', !Number.isNaN(Date.parse(built.completedAt)));
eq('duration and reps are whole numbers', [built.durationSeconds, built.repCount], [90, 13]);
ok(
  'two builds do not share an id',
  makeWorkoutCompletion({ userId: 'u', workoutType: 'x', durationSeconds: 60, source: 'prototype' }).workoutId !==
    built.workoutId,
);
eq(
  "a service's own id is passed through, never replaced",
  makeWorkoutCompletion({ workoutId: 'api-42', userId: 'u', workoutType: 'run', durationSeconds: 60, source: 'external-api' })
    .workoutId,
  'api-42',
);
ok(
  'reps stay absent when the source does not report them',
  !('repCount' in makeWorkoutCompletion({ userId: 'u', workoutType: 'run', durationSeconds: 60, source: 'external-api' })),
  'a run has no reps',
);

resetWorkoutCompletionBus();
const heard: string[] = [];
const stop = subscribeWorkoutCompletion((c) => heard.push(`a:${c.workoutId}`));
reportWorkoutCompletion(completion({ workoutId: 'wk-bus-1' }));
eq('a subscriber hears a completion', heard, ['a:wk-bus-1']);

// The case the replay exists for: a listener that mounts AFTER the announcement still gets it.
subscribeWorkoutCompletion((c) => heard.push(`b:${c.workoutId}`));
eq('a late subscriber is replayed the last completion', heard, ['a:wk-bus-1', 'b:wk-bus-1']);
eq('the bus remembers the last completion', getLastWorkoutCompletion()?.workoutId, 'wk-bus-1');

stop();
reportWorkoutCompletion(completion({ workoutId: 'wk-bus-2' }));
eq('an unsubscribed listener hears nothing more', heard, ['a:wk-bus-1', 'b:wk-bus-1', 'b:wk-bus-2']);

// A broken UI subscriber must never be able to stop the reward service from being told.
resetWorkoutCompletionBus();
const survived: string[] = [];
subscribeWorkoutCompletion(() => {
  throw new Error('a broken subscriber');
});
subscribeWorkoutCompletion((c) => survived.push(c.workoutId));
reportWorkoutCompletion(completion({ workoutId: 'wk-bus-3' }));
eq('one throwing subscriber does not stop the next', survived, ['wk-bus-3']);
resetWorkoutCompletionBus();

console.log('\n-- the rules table (§19) ----------------------------------------------');

const rules = Object.values(WORKOUT_REWARD_RULES);
ok('every rule names a pool that exists', rules.every((rule) => !!buildRewardPool(NEWBIE_REWARD_POOL) && rule.poolId === NEWBIE_REWARD_POOL.id));
ok('every rule keys itself by its own id', rules.every((rule) => WORKOUT_REWARD_RULES[rule.id] === rule));
ok('every rule has copy to show', rules.every((rule) => !!rule.title && !!rule.message));

console.log(
  `\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`} — ${checks - failures}/${checks} checks\n`,
);
process.exit(failures === 0 ? 0 : 1);
