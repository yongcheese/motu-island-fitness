/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 貨幣與獎勵經濟 — rules tests.
 *
 * Run with `npm run test:economy`. Same tsx-script style as `test:daily-login`,
 * `test:workout-rewards` and the `audit:*` checks, because that is the test runner this repo has.
 *
 * ## What this file exists to protect
 *
 * One sentence, and it is the whole economy: **金幣 comes from 健身 and from nothing else.**
 *
 * That is a game-design decision with real consequences — it is the reason the shop means anything
 * — and a rule of that kind cannot survive as a comment in a file somebody will edit in six months.
 * It lives in `SOURCE_CURRENCY_POLICY` (constants/rewards.ts) and it is enforced by `checkGrant`,
 * which every write path consults before touching a balance. The checks below are what make sure
 * that stays true: they assert the POLICY, not one call site, so a new reward system that forgets
 * to ask cannot pass them by being careful.
 *
 * The other half is that 碎片 must not quietly become 「another kind of gold」: it needs its own
 * source list, its own storage, and its own place in the wallet.
 *
 * What it deliberately does NOT test: the write path, Firestore and the React layer. Those need a
 * database and a DOM. What is testable without either is every rule that decides WHETHER and HOW
 * MUCH — which is the half that silently rots.
 */

import {
  CURRENCY_IDS,
  CURRENCY_SPECS,
  currencyFieldPath,
  currencyLabel,
  currencyPatch,
  getBalance,
  type CurrencyId,
} from '../src/constants/currency';
import {
  REWARD_SOURCE_LABELS,
  SOURCE_CURRENCY_POLICY,
  checkGrant,
  describeGrant,
  type RewardGrant,
  type RewardSource,
} from '../src/constants/rewards';
import { WORKOUT_PAYOUT, payoutForWorkout, type WorkoutCompletion } from '../src/constants/workoutRewards';
import {
  DAILY_LOGIN_CURRENCY,
  DAILY_PRIZE_COINS,
  MAKEUP_SURCHARGE,
} from '../src/constants/dailyLogin';
import {
  NEWBIE_REWARD_POOL,
  buildRewardPool,
  isEligibleForPool,
  poolRarityBreakdown,
  type RewardPool,
} from '../src/constants/rewardPools';
import { ALL_ITEMS } from '../src/constants/items';
import { RARITY_LADDER } from '../src/constants/rarity';
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
    equippedItems: [],
    lastUpdated: '2026-08-25T00:00:00.000Z',
    ...over,
  }) as UserProfile;

const completion = (over: Partial<WorkoutCompletion> = {}): WorkoutCompletion => ({
  workoutId: 'wk-1',
  userId: 'u-1',
  completedAt: '2026-08-25T10:00:00.000Z',
  workoutType: '開合跳',
  durationSeconds: 90,
  repCount: 12,
  source: 'prototype',
  ...over,
});

const grant = (over: Partial<RewardGrant> = {}): RewardGrant => ({
  reward: { kind: 'currency', currency: 'fragments', amount: 5 },
  source: 'daily-login',
  ...over,
});

console.log('\n=== 貨幣與獎勵經濟 ===');

console.log('\n-- the wallet: two currencies, stored apart ---------------------------');

eq('exactly two currencies', [...CURRENCY_IDS], ['coins', 'fragments']);
ok('every currency has a spec', CURRENCY_IDS.every((id) => !!CURRENCY_SPECS[id]));
ok('every currency has a label', CURRENCY_IDS.every((id) => currencyLabel(id).length > 0));
eq('金幣 is the top-level field every save already has', currencyFieldPath('coins'), 'balanceGold');
eq('碎片 live in the wallet map', currencyFieldPath('fragments'), 'wallet.fragments');
ok(
  'no two currencies share a field',
  new Set(CURRENCY_IDS.map(currencyFieldPath)).size === CURRENCY_IDS.length,
);

console.log('\n-- reading a balance is total ------------------------------------------');

// Every one of these is a REAL state — a session before the profile loads, a save written before
// 碎片 existed, a brand-new player, a field somebody corrupted — and none of them is an error a
// player should ever be shown. They all have to read as zero.
eq('no profile reads as nothing', getBalance(null, 'coins'), 0);
eq('undefined profile reads as nothing', getBalance(undefined, 'fragments'), 0);
eq('a pre-wallet save has no 碎片', getBalance(profile({ balanceGold: 500 }), 'fragments'), 0);
eq('an empty wallet has no 碎片', getBalance(profile({ wallet: {} }), 'fragments'), 0);
eq('a stocked wallet reports it', getBalance(profile({ wallet: { fragments: 42 } }), 'fragments'), 42);
eq('金幣 read through the same door', getBalance(profile({ balanceGold: 500 }), 'coins'), 500);
eq('a negative balance reads as zero', getBalance(profile({ balanceGold: -5 }), 'coins'), 0);
eq(
  'a fractional balance is floored',
  getBalance(profile({ wallet: { fragments: 7.9 } }), 'fragments'),
  7,
);
eq(
  'a corrupted balance reads as zero',
  getBalance(profile({ balanceGold: Number.NaN }), 'coins'),
  0,
);

console.log('\n-- a local patch rebuilds the map, never a dotted key -------------------');

eq('金幣 patch is the plain field', currencyPatch(profile(), 'coins', 12), { balanceGold: 12 });
eq('碎片 patch rebuilds the wallet', currencyPatch(profile(), 'fragments', 12), {
  wallet: { fragments: 12 },
});
eq(
  'patching 碎片 keeps the rest of the wallet',
  currencyPatch(profile({ wallet: { fragments: 1 } }), 'fragments', 9),
  { wallet: { fragments: 9 } },
);
ok(
  'no patch ever produces a dotted key',
  CURRENCY_IDS.every((id) => Object.keys(currencyPatch(profile(), id, 1)).every((k) => !k.includes('.'))),
  'a dotted key would land as a literal field name',
);

console.log('\n-- THE RULE: 金幣 comes from 健身, and from what this table lets through ----');

const coinSources = (Object.keys(SOURCE_CURRENCY_POLICY) as RewardSource[]).filter((s) =>
  SOURCE_CURRENCY_POLICY[s].includes('coins'),
);
/**
 * The list is pinned EXACTLY, and that is the whole value of this check.
 *
 * 管理員測試 is invisible to players (AdminOnly). 每日登入 was added on 2026-09-17 when the
 * seven-day round started paying 15 金幣 on four of its days — a real concession, made on purpose,
 * and bounded by the size checks in the 每日簽到 section below rather than by this row.
 *
 * A FOURTH entry appearing here is either a mistake or a decision that belongs in docs/economy.md
 * before it belongs in the table. Failing on any change is the point: this assertion exists to
 * make widening the rule something a person has to do deliberately, in two files, with a reason.
 */
eq(
  'only 健身, 每日登入 and 管理員測試 may pay 金幣',
  coinSources.sort(),
  ['admin-test', 'daily-login', 'workout'],
);
ok(
  'every source has a policy row',
  (Object.keys(REWARD_SOURCE_LABELS) as RewardSource[]).every((s) => !!SOURCE_CURRENCY_POLICY[s]),
  'a missing row means a source that can grant nothing — safe, but silent',
);
ok(
  'every source is named for a human',
  (Object.keys(SOURCE_CURRENCY_POLICY) as RewardSource[]).every(
    (s) => (REWARD_SOURCE_LABELS[s] ?? '').length > 0,
  ),
);

ok('健身 may pay 金幣', checkGrant(grant({ source: 'workout', reward: { kind: 'currency', currency: 'coins', amount: 10 } })).ok);
// 每日登入 is the ONE exception, and it is checked as an exception rather than quietly dropped from
// this list: the round pays 15 金幣 on four of its seven days (constants/dailyLogin.ts), and the
// policy table was widened on purpose to let it. What keeps that survivable is the SIZE, which is
// what the 每日簽到 section further down actually measures.
ok(
  '每日簽到 may pay 金幣, by explicit exception',
  checkGrant(grant({ source: 'daily-login', reward: { kind: 'currency', currency: 'coins', amount: 10 } })).ok,
);
ok(
  '輪盤 may NOT pay 金幣',
  !checkGrant(grant({ source: 'wheel', reward: { kind: 'currency', currency: 'coins', amount: 10 } })).ok,
);
ok(
  '任務 may NOT pay 金幣',
  !checkGrant(grant({ source: 'quest', reward: { kind: 'currency', currency: 'coins', amount: 10 } })).ok,
);
ok(
  '島上互動 may NOT pay 金幣',
  !checkGrant(grant({ source: 'island-interaction', reward: { kind: 'currency', currency: 'coins', amount: 10 } })).ok,
);
eq(
  'a refused grant says which rule refused it',
  checkGrant(grant({ source: 'wheel', reward: { kind: 'currency', currency: 'coins', amount: 1 } })).ok === false &&
    (checkGrant(grant({ source: 'wheel', reward: { kind: 'currency', currency: 'coins', amount: 1 } })) as { error: string }).error,
  'currency-not-allowed-for-source',
);

// The other direction: 健身 is not a wildcard. It pays the currency it earns and no other.
ok(
  '健身 may NOT pay 碎片',
  !checkGrant(grant({ source: 'workout', reward: { kind: 'currency', currency: 'fragments', amount: 10 } })).ok,
  'a workout that also minted 碎片 would collapse the two economies back into one',
);

const fragmentSources = (Object.keys(SOURCE_CURRENCY_POLICY) as RewardSource[]).filter((s) =>
  SOURCE_CURRENCY_POLICY[s].includes('fragments'),
);
ok('every non-workout source pays 碎片', fragmentSources.length === CURRENCY_SOURCES_EXPECTED(), `${fragmentSources.length} sources`);
function CURRENCY_SOURCES_EXPECTED(): number {
  return (Object.keys(SOURCE_CURRENCY_POLICY) as RewardSource[]).filter((s) => s !== 'workout').length;
}

console.log('\n-- a grant of nothing is a bug, not a no-op -----------------------------');

ok('zero is refused', !checkGrant(grant({ reward: { kind: 'currency', currency: 'fragments', amount: 0 } })).ok);
ok('negative is refused', !checkGrant(grant({ reward: { kind: 'currency', currency: 'fragments', amount: -5 } })).ok);
ok('fractional is refused', !checkGrant(grant({ reward: { kind: 'currency', currency: 'fragments', amount: 1.5 } })).ok);
ok('NaN is refused', !checkGrant(grant({ reward: { kind: 'currency', currency: 'fragments', amount: Number.NaN } })).ok);
ok('an XP grant is allowed from any source', checkGrant(grant({ reward: { kind: 'xp', amount: 20 } })).ok, 'XP is not a currency and has no policy');
ok('an item grant is allowed from any source', checkGrant(grant({ reward: { kind: 'item', itemId: 'hat-beret', quantity: 1 } })).ok);
ok(
  'a grant describes itself for the log',
  describeGrant(grant({ source: 'workout', reward: { kind: 'currency', currency: 'coins', amount: 8 }, reason: 'x' })).includes('健身'),
  'every grant must be traceable to why it happened (§17)',
);

console.log('\n-- 健身 payout: reps and duration each earn on their own ----------------');

const repsOnly = payoutForWorkout(completion({ durationSeconds: 0, repCount: 20 }));
const timeOnly = payoutForWorkout(completion({ durationSeconds: 600, repCount: undefined }));
ok('a set of reps with no clock still pays', repsOnly.coins > 0 && repsOnly.xp > 0, `${repsOnly.coins}g`);
ok('a run with no reps still pays', timeOnly.coins > 0 && timeOnly.xp > 0, `${timeOnly.coins}g`);
eq('reps pay at the prototype rate', repsOnly.coins, Math.floor(20 * WORKOUT_PAYOUT.coinsPerRep));
eq('reps grant XP at the prototype rate', repsOnly.xp, 20 * WORKOUT_PAYOUT.xpPerRep);
ok(
  'both halves add up',
  payoutForWorkout(completion({ durationSeconds: 600, repCount: 20 })).coins === repsOnly.coins + timeOnly.coins,
);
eq('a payout is always whole', Number.isInteger(payoutForWorkout(completion({ repCount: 7, durationSeconds: 37 })).coins), true);
eq('nothing done pays nothing', payoutForWorkout(completion({ durationSeconds: 0, repCount: 0 })), { coins: 0, xp: 0 });
ok(
  'an implausible workout is capped, not trusted',
  payoutForWorkout(completion({ durationSeconds: 9_999_999, repCount: 9_999_999 })).coins ===
    WORKOUT_PAYOUT.maxCoinsPerWorkout,
  'a rep counter bug must not be able to buy the catalog',
);
ok(
  'the cap sits below the dearest item',
  WORKOUT_PAYOUT.maxCoinsPerWorkout < Math.max(...ALL_ITEMS.map((i) => i.price)),
  'one session must never pay for the most expensive thing in the game',
);
eq(
  'a negative duration cannot pay',
  payoutForWorkout(completion({ durationSeconds: -100, repCount: 0 })),
  { coins: 0, xp: 0 },
);

console.log('\n-- 每日簽到 pays 金幣 now, and the rule that allows it ------------------');

/**
 * ## The one exception to 「金幣只有健身」, and the number that makes it survivable
 *
 * The round paid the wallet's 碎片 from 2026-08-25 to 2026-09-17 precisely so that this table could
 * say 健身 was the only coin source. It pays 金幣 again, deliberately, and the tests below pin what
 * that concession actually costs rather than merely recording that it was made.
 *
 * The property being defended is NOT 「每日登入不得發金幣」 any more — it is 「開 app 不能比運動好
 * 賺」, which is the thing the old rule was a proxy for. So: a whole week of perfect logins has to be
 * worth less than a couple of workouts, and a single day has to be worth less than one.
 */
eq('the round mints 金幣', DAILY_LOGIN_CURRENCY, 'coins');
ok(
  '每日登入 is allowed 金幣 explicitly, in the table rather than by accident',
  SOURCE_CURRENCY_POLICY['daily-login'].includes('coins'),
);
ok(
  'and it is the ONLY source besides 健身 that is',
  (Object.keys(SOURCE_CURRENCY_POLICY) as RewardSource[])
    .filter((source) => source !== 'admin-test' && SOURCE_CURRENCY_POLICY[source].includes('coins'))
    .sort()
    .join(',') === 'daily-login,workout',
  '管理員測試 is excluded: putting the save into an arbitrary state is what it is FOR',
);

/**
 * A perfect week, at the most expensive roll the table can produce.
 *
 * Days 1/3/4/6 are a coin flip, so four of them landing on 金幣 is the worst case; day 2's third
 * option adds one more. Nothing else in the round pays money at all.
 */
const bestCaseCoinDays = 5;
const perfectWeekCoins = bestCaseCoinDays * DAILY_PRIZE_COINS;
const shortWorkout = payoutForWorkout(completion({ durationSeconds: 120, repCount: 12 })).coins;

ok(
  'a perfect week of logins is worth less than one good workout',
  perfectWeekCoins < WORKOUT_PAYOUT.maxCoinsPerWorkout,
  `${perfectWeekCoins} 金幣／週 vs 一次運動上限 ${WORKOUT_PAYOUT.maxCoinsPerWorkout} 金幣`,
);
ok(
  'and a week of them is worth about two short sessions, not twenty',
  perfectWeekCoins < shortWorkout * 4,
  `${perfectWeekCoins} 金幣／週 vs 一次短運動 ${shortWorkout} 金幣`,
);
ok(
  'and one day is worth less than one workout',
  DAILY_PRIZE_COINS < shortWorkout || shortWorkout === 0,
  `${DAILY_PRIZE_COINS} vs ${shortWorkout}`,
);

/**
 * 金幣 from a login must not read as a way to SHOP, which is the other half of §12.
 *
 * The comparison is against the catalog's median price rather than its cheapest item: one 50-gold
 * grass skirt says nothing, and what matters is that a week of showing up does not add up to a
 * typical purchase. The median rather than the mean, because the catalog has a 4,800-gold phoenix
 * in it and a mean would let the payout drift upwards behind one outlier.
 */
const prices = ALL_ITEMS.filter((i) => i.price > 0).map((i) => i.price).sort((a, b) => a - b);
const medianPrice = prices[Math.floor(prices.length / 2)];
ok(
  'a whole round of logins does not buy a typical item',
  perfectWeekCoins < medianPrice,
  `${perfectWeekCoins} 金幣 vs 中位數 ${medianPrice} 金幣`,
);
ok(
  'the 補簽 price is a real cost, not a rounding error',
  MAKEUP_SURCHARGE > DAILY_PRIZE_COINS,
  '補簽 must never be cheaper than the day it buys back is worth',
);
console.log('\n-- reward pools filter on rarity (§6) -----------------------------------');

const pool = buildRewardPool(NEWBIE_REWARD_POOL);
ok('the newbie pool resolves to something', pool.length > 0, `${pool.length} 件`);

const breakdown = poolRarityBreakdown(NEWBIE_REWARD_POOL);
eq(
  'and to nothing above its ceiling',
  RARITY_LADDER.filter((t) => breakdown[t] > 0),
  ['common'],
);

// A pool is a set of RULES, so the rules have to be exercised rather than merely observed to hold
// on today's catalog — the catalog can stop containing a counter-example at any time.
const sample = pool[0];
const withTier = (rarity: (typeof RARITY_LADDER)[number]) => ({ ...sample, id: `x-${rarity}`, rarity });

ok('a ceiling admits its own tier', isEligibleForPool(withTier('common'), NEWBIE_REWARD_POOL));
ok('a ceiling refuses the rung above', !isEligibleForPool(withTier('rare'), NEWBIE_REWARD_POOL));
ok('a ceiling refuses the top of the ladder', !isEligibleForPool(withTier('mythic'), NEWBIE_REWARD_POOL));

const floored: RewardPool = { ...NEWBIE_REWARD_POOL, maxRarity: null, minRarity: 'rare' };
ok('a floor refuses below itself', !isEligibleForPool(withTier('common'), floored));
ok('a floor admits itself', isEligibleForPool(withTier('rare'), floored));
ok('a floor admits above itself', isEligibleForPool(withTier('epic'), floored));

const unbounded: RewardPool = { ...NEWBIE_REWARD_POOL, maxRarity: null };
ok(
  'a null ceiling means NO ceiling, not "nothing"',
  RARITY_LADDER.every((t) => isEligibleForPool(withTier(t), unbounded)),
  'this reversed when rarity became required — see RewardPool.maxRarity',
);

const skipping: RewardPool = { ...NEWBIE_REWARD_POOL, maxRarity: 'mythic', excludeRarities: ['rare'] };
ok('an exclusion refuses its tier', !isEligibleForPool(withTier('rare'), skipping));
ok('and leaves the tiers either side alone', isEligibleForPool(withTier('common'), skipping) && isEligibleForPool(withTier('epic'), skipping));

const anyCategory: RewardPool = { ...NEWBIE_REWARD_POOL, categories: [], maxPrice: 99_999, maxRarity: null };
ok(
  'an empty category list means 不限分類',
  buildRewardPool(anyCategory).length > pool.length,
  `${buildRewardPool(anyCategory).length} 件`,
);

console.log('\n-- every item can be reasoned about by a pool ---------------------------');

ok(
  'every catalog item carries a tier a pool can filter on',
  ALL_ITEMS.every((item) => RARITY_LADDER.includes(item.rarity)),
  'a pool cannot reason about an ungraded item — which is why the field is required',
);

console.log(
  failures === 0 ? `\nALL PASS (${checks} checks)\n` : `\n${failures} of ${checks} checks FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
