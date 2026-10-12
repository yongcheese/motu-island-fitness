/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 每週任務的完成獎勵 — rules tests.
 *
 * Run with `npm run test:weekly-task-rewards`. Same tsx-script style as test-weekly-tasks.ts.
 *
 * The one property this file exists to pin: what the task card SHOWS is what the claim WRITES.
 * Both come from `rewardForTask()`, and the write is assembled by `buildTaskRewardClaim()` — which
 * these tests call directly, with a fake profile, and compare field by field against the quote.
 */

import {
  WEEKLY_TASK_REWARD_CLAIMS_PER_WEEK,
  WEEKLY_TASK_REWARD_SOURCE,
  WEEKLY_TASK_REWARD_TIERS,
  claimCountForWeek,
  isPayableTaskReward,
  normalizeRewardLedger,
  planTaskRewardPayout,
  recordRewardClaim,
  rewardForTask,
  rewardStatusFor,
  type WeeklyTaskRewardLedger,
} from '../src/constants/weeklyTaskRewards';
import {
  METRIC_SPECS,
  computeWeeklyTaskProgress,
  cycleFromWeekStart,
  type HealthActivity,
  type WeeklyTaskDefinition,
} from '../src/constants/weeklyTasks';
import { checkGrant, type Reward } from '../src/constants/rewards';
import { ALL_ITEMS } from '../src/constants/items';
import { isStackableItem } from '../src/utils/inventory';
import { buildTaskRewardClaim } from '../src/context/useWeeklyTasks';
import type { UserProfile } from '../src/types';

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

function ok(name: string, cond: boolean): void {
  eq(name, cond, true);
}

// --- fixtures ----------------------------------------------------------------

const WEEK = '2026-09-28'; // a Monday
const NEXT_WEEK = '2026-10-05';
const cycle = cycleFromWeekStart(WEEK);
const now = new Date('2026-09-30T04:00:00Z'); // Wednesday, Taipei noon

function task(id: string, metric: WeeklyTaskDefinition['metric'], target: number, extra: Partial<WeeklyTaskDefinition> = {}): WeeklyTaskDefinition {
  return { taskId: id, name: `任務 ${id}`, metric, target, createdAt: '2026-09-28T00:00:00Z', startWeek: WEEK, ...extra };
}

function workout(i: number, minutes = 10, reps = 30, type = '深蹲'): HealthActivity {
  return {
    activityId: `a${i}`,
    completedAt: new Date(Date.parse('2026-09-29T02:00:00Z') + i * 3_600_000).toISOString(),
    type,
    durationSeconds: minutes * 60,
    reps,
  };
}

const oneWorkout = [workout(0)];
const progressOf = (t: WeeklyTaskDefinition, activities: HealthActivity[] = oneWorkout) =>
  computeWeeklyTaskProgress(t, activities, now, cycle);

const profile = (extra: Partial<UserProfile> = {}): UserProfile =>
  ({
    userId: 'u1',
    displayName: 'tester',
    level: 1,
    currentXp: 40,
    balanceGold: 500,
    wallet: { fragments: 7 },
    inventory: [],
    ...extra,
  }) as unknown as UserProfile;

const sumOf = (rewards: readonly Reward[], match: (r: Reward) => boolean) =>
  rewards.filter(match).reduce((total, r) => total + ('amount' in r ? r.amount : r.quantity), 0);
const fragmentsIn = (rewards: readonly Reward[]) =>
  sumOf(rewards, (r) => r.kind === 'currency' && r.currency === 'fragments');
const xpIn = (rewards: readonly Reward[]) => sumOf(rewards, (r) => r.kind === 'xp');

// --- 1. the table itself -----------------------------------------------------

for (const tier of WEEKLY_TASK_REWARD_TIERS) {
  ok(`tier ${tier.id} has at least one reward`, tier.rewards.length > 0);
  for (const reward of tier.rewards) {
    ok(`tier ${tier.id}: ${JSON.stringify(reward)} is payable`, isPayableTaskReward(reward));
    ok(`tier ${tier.id}: ${JSON.stringify(reward)} passes the quest currency policy`, checkGrant({ reward, source: WEEKLY_TASK_REWARD_SOURCE }).ok);
    ok(`tier ${tier.id}: no 金幣 (quest may not mint coins)`, !(reward.kind === 'currency' && reward.currency === 'coins'));
  }
}
ok('tiers are ordered by minRatio', WEEKLY_TASK_REWARD_TIERS.every((tier, i, all) => i === 0 || all[i - 1].minRatio < tier.minRatio));
ok('first tier starts at 0 so every valid task has a reward', WEEKLY_TASK_REWARD_TIERS[0].minRatio === 0);
ok(
  'higher tiers never pay fewer 碎片 or less XP',
  WEEKLY_TASK_REWARD_TIERS.every(
    (tier, i, all) => i === 0 || (fragmentsIn(tier.rewards) >= fragmentsIn(all[i - 1].rewards) && xpIn(tier.rewards) >= xpIn(all[i - 1].rewards)),
  ),
);

// --- 2. quote: tier boundaries ------------------------------------------------

eq('每週運動 1 次 → 輕量', rewardForTask(task('t', 'workout_count', 1))?.tier.id, 'light');
eq('每週運動 3 次（預設）→ 標準', rewardForTask(task('t', 'workout_count', 3))?.tier.id, 'standard');
eq('每週運動 5 次 → 標準', rewardForTask(task('t', 'workout_count', 5))?.tier.id, 'standard');
eq('每週運動 6 次（2 倍）→ 挑戰', rewardForTask(task('t', 'workout_count', 6))?.tier.id, 'challenge');
eq('每週 59 分鐘 → 輕量', rewardForTask(task('t', 'workout_minutes', 55))?.tier.id, 'light');
eq('每週 60 分鐘 → 標準', rewardForTask(task('t', 'workout_minutes', 60))?.tier.id, 'standard');
eq('每週 120 分鐘 → 挑戰', rewardForTask(task('t', 'workout_minutes', 120))?.tier.id, 'challenge');
eq('指定運動 3 次 → 標準', rewardForTask(task('t', 'activity_type_count', 3, { activityType: '深蹲' }))?.tier.id, 'standard');
eq('步數（沒有資料來源）→ 沒有獎勵', rewardForTask(task('t', 'steps', 30000)), null);
eq('未知的目標類型 → 沒有獎勵', rewardForTask({ metric: 'bogus' as never, target: 3 }), null);
eq('target 0 → 沒有獎勵', rewardForTask(task('t', 'workout_count', 0)), null);
eq('target NaN → 沒有獎勵', rewardForTask(task('t', 'workout_count', Number.NaN)), null);
for (const spec of METRIC_SPECS.filter((s) => s.available)) {
  ok(`${spec.label}: min target has a reward`, rewardForTask({ metric: spec.id, target: spec.minTarget }) !== null);
  ok(`${spec.label}: max target has a reward`, rewardForTask({ metric: spec.id, target: spec.maxTarget }) !== null);
}
eq(
  'quote rewards are the tier table (UI reads data, nothing hard-coded)',
  rewardForTask(task('t', 'workout_count', 3))?.rewards,
  WEEKLY_TASK_REWARD_TIERS.find((t) => t.id === 'standard')!.rewards,
);

// --- 3. status: not started / in progress / completed -----------------------

const t3 = task('t3', 'workout_count', 3);
eq('未開始（0 次）→ locked, shows the quote', rewardStatusFor(progressOf(t3, []), null).kind, 'locked');
const lockedStatus = rewardStatusFor(progressOf(t3, []), null);
eq('locked status carries the same quote as rewardForTask', lockedStatus.kind === 'locked' ? lockedStatus.quote.rewards : null, rewardForTask(t3)!.rewards);
eq('進行中（1/3）→ locked', rewardStatusFor(progressOf(t3, [workout(0)]), null).kind, 'locked');
eq('完成（3/3）→ claimable', rewardStatusFor(progressOf(t3, [workout(0), workout(1), workout(2)]), null).kind, 'claimable');
eq('超額完成（4/3）→ claimable', rewardStatusFor(progressOf(t3, [0, 1, 2, 3].map((i) => workout(i))), null).kind, 'claimable');
eq('未知類型的任務 → none', rewardStatusFor(progressOf(task('tx', 'steps', 30000)), null).kind, 'none');

// --- 4. the claim write matches the quote -----------------------------------

const t1 = task('t1', 'workout_count', 1);
const e1 = progressOf(t1);
const p0 = profile();
const built = buildTaskRewardClaim(e1, null, p0, now.getTime());
ok('claim builds', built.ok);
if (built.ok) {
  const quote = rewardForTask(t1)!;
  eq('claim.rewards === the quote the card showed (no effects running)', built.claim.rewards, quote.rewards);
  eq('claim tier === quote tier', built.claim.tier, quote.tier.id);
  ok('write touches wallet.fragments', 'wallet.fragments' in built.fields);
  ok('write touches currentXp', 'currentXp' in built.fields);
  ok('write records the claim in the SAME update', 'weeklyTasks.rewardClaims' in built.fields);
  ok('write never touches balanceGold', !('balanceGold' in built.fields));
  ok('write never touches weeklyTasks.tasks (definitions are not rewritten)', !('weeklyTasks.tasks' in built.fields) && !('weeklyTasks' in built.fields));
  eq('patched 碎片 = before + quoted', built.patch.wallet?.fragments, 7 + fragmentsIn(quote.rewards));
  eq('patched XP = before + quoted', built.patch.currentXp, 40 + xpIn(quote.rewards));
  eq('ledger week is this week', built.ledger.week, WEEK);
  eq('ledger has exactly this task', Object.keys(built.ledger.claims), ['t1']);
  eq('claim keeps the task name', built.claim.taskName, t1.name);

  // After the write lands, the card reads the claim record.
  const after = rewardStatusFor(e1, built.ledger);
  eq('after claim → claimed', after.kind, 'claimed');
  eq('claimed status shows what was paid', after.kind === 'claimed' ? after.claim.rewards : null, built.claim.rewards);

  // No double claim: rebuilding against the new ledger refuses.
  const again = buildTaskRewardClaim(e1, built.ledger, { ...p0, ...built.patch } as UserProfile, now.getTime());
  eq('second claim → already-claimed', again.ok ? 'ok' : again.reason, 'already-claimed');

  // Refresh: the ledger survives a JSON round trip (that is what the save is).
  const reloaded = normalizeRewardLedger(JSON.parse(JSON.stringify(built.ledger)));
  eq('reload: still claimed', rewardStatusFor(e1, reloaded).kind, 'claimed');
  eq('reload: same rewards', rewardStatusFor(e1, reloaded).kind === 'claimed' ? (rewardStatusFor(e1, reloaded) as { claim: { rewards: Reward[] } }).claim.rewards : null, built.claim.rewards);
  eq('reload: claim count 1', claimCountForWeek(reloaded, cycle), 1);

  // Editing the task after the claim does not reopen or re-price it.
  const edited = { ...t1, target: 6 };
  const editedStatus = rewardStatusFor(progressOf(edited), built.ledger);
  eq('edit after claim: still claimed (even though no longer complete)', editedStatus.kind, 'claimed');
  eq('edit after claim: shows what was actually paid, not the new tier', editedStatus.kind === 'claimed' ? editedStatus.claim.tier : null, 'light');
}

// A challenge task pays a card too, and the card is written.
const tc = task('tc', 'workout_count', 6);
const ec = progressOf(tc, [0, 1, 2, 3, 4, 5].map((i) => workout(i)));
const builtC = buildTaskRewardClaim(ec, null, profile(), now.getTime());
ok('challenge claim builds', builtC.ok);
if (builtC.ok) {
  eq('challenge: claim.rewards === quote (3 kinds)', builtC.claim.rewards, rewardForTask(tc)!.rewards);
  eq('challenge: card lands in the bag', builtC.patch.utilityCards?.owned?.['double-coin'], 1);
  ok('challenge: utilityCards written in the same update', 'utilityCards' in builtC.fields);
}

// A full card bag: the card is NOT paid, and the claim record says so.
const fullBag = profile({ utilityCards: { owned: { 'double-coin': 99 } } } as Partial<UserProfile>);
const builtFull = buildTaskRewardClaim(ec, null, fullBag, now.getTime());
if (builtFull.ok) {
  ok('full bag: claim record has no card (records what was banked)', !builtFull.claim.rewards.some((r) => r.kind === 'utility-card'));
  ok('full bag: fragments still paid', fragmentsIn(builtFull.claim.rewards) === fragmentsIn(rewardForTask(tc)!.rewards));
} else ok('full bag claim builds', false);

// Not completed → refused, nothing to write.
const refusedLocked = buildTaskRewardClaim(progressOf(t3, []), null, profile(), now.getTime());
eq('locked task cannot be claimed', refusedLocked.ok ? 'ok' : refusedLocked.reason, 'not-completed');

// --- 5. weekly cap and delete/recreate --------------------------------------

let ledger: WeeklyTaskRewardLedger | null = null;
for (let i = 0; i < WEEKLY_TASK_REWARD_CLAIMS_PER_WEEK; i++) {
  const b = buildTaskRewardClaim(progressOf(task(`c${i}`, 'workout_count', 1)), ledger, profile(), now.getTime());
  if (b.ok) ledger = b.ledger;
}
eq('cap: used = cap', claimCountForWeek(ledger, cycle), WEEKLY_TASK_REWARD_CLAIMS_PER_WEEK);
const overCap = progressOf(task('c-extra', 'workout_count', 1));
eq('cap: 4th completed task → capped', rewardStatusFor(overCap, ledger).kind, 'capped');
const overBuilt = buildTaskRewardClaim(overCap, ledger, profile(), now.getTime());
eq('cap: 4th claim refused', overBuilt.ok ? 'ok' : overBuilt.reason, 'cap-reached');
// Delete c0 and recreate the same goal under a new id: the ledger still holds c0's claim.
eq('delete + recreate: new id is still capped', rewardStatusFor(progressOf(task('c0-again', 'workout_count', 1)), ledger).kind, 'capped');
// Next week: the ledger is stale, everything is claimable again, no write needed.
const nextCycle = cycleFromWeekStart(NEXT_WEEK);
const nextWeekEntry = computeWeeklyTaskProgress(task('c0', 'workout_count', 1), [{ ...workout(0), completedAt: '2026-10-06T02:00:00Z' }], new Date('2026-10-06T04:00:00Z'), nextCycle);
eq('next week: last week’s ledger is ignored', rewardStatusFor(nextWeekEntry, ledger).kind, 'claimable');
eq('next week: count resets', claimCountForWeek(ledger, nextCycle), 0);
const nextLedger = recordRewardClaim(ledger, NEXT_WEEK, 'c0', { claimedAt: '', tier: 'light', rewards: [], taskName: '' });
eq('next week: first claim replaces the old ledger', Object.keys(nextLedger.claims), ['c0']);
eq('recording the same task twice does not double-count', claimCountForWeek(recordRewardClaim(nextLedger, NEXT_WEEK, 'c0', nextLedger.claims.c0), nextCycle), 1);

// --- 6. payout plan: every reward type ---------------------------------------

const ownOnce = ALL_ITEMS.find((item) => !isStackableItem(item.id));
const stackable = ALL_ITEMS.find((item) => isStackableItem(item.id));
ok('fixture: catalog has an own-once item', !!ownOnce);
ok('fixture: catalog has a stackable item', !!stackable);

const mixed: Reward[] = [
  { kind: 'currency', currency: 'fragments', amount: 5 },
  { kind: 'currency', currency: 'fragments', amount: 10 },
  { kind: 'xp', amount: 20 },
  { kind: 'utility-card', cardId: 'double-coin', quantity: 1 },
  ...(ownOnce ? [{ kind: 'item' as const, itemId: ownOnce.id, quantity: 1 }] : []),
];
const plan = planTaskRewardPayout(mixed);
eq('plan: duplicate 碎片 merged into one increment', plan.currency.filter((r) => r.kind === 'currency'), [{ kind: 'currency', currency: 'fragments', amount: 15 }]);
eq('plan: xp kept', plan.currency.filter((r) => r.kind === 'xp'), [{ kind: 'xp', amount: 20 }]);
eq('plan: card routed to cards', plan.cards.length, 1);
eq('plan: item routed to items', plan.items.length, ownOnce ? 1 : 0);
eq('plan: nothing unpayable', plan.unpayable.length, 0);

ok('金幣 is NOT payable by a task', !isPayableTaskReward({ kind: 'currency', currency: 'coins', amount: 10 }));
ok('unknown card is NOT payable', !isPayableTaskReward({ kind: 'utility-card', cardId: 'nope' as never, quantity: 1 }));
ok('unknown item is NOT payable', !isPayableTaskReward({ kind: 'item', itemId: 'no-such-item', quantity: 1 }));
if (stackable) ok('stackable item is NOT payable', !isPayableTaskReward({ kind: 'item', itemId: stackable.id, quantity: 1 }));
if (ownOnce) ok('own-once item IS payable', isPayableTaskReward({ kind: 'item', itemId: ownOnce.id, quantity: 1 }));
ok('zero amount is NOT payable', !isPayableTaskReward({ kind: 'xp', amount: 0 }));
eq('a plan containing 金幣 flags it as unpayable', planTaskRewardPayout([{ kind: 'currency', currency: 'coins', amount: 1 }]).unpayable.length, 1);

// --- 7. corrupt saves --------------------------------------------------------

eq('ledger: null → null', normalizeRewardLedger(null), null);
eq('ledger: string → null', normalizeRewardLedger('x'), null);
eq('ledger: bad week → null', normalizeRewardLedger({ week: 'monday', claims: {} }), null);
eq('ledger: missing claims → empty', normalizeRewardLedger({ week: WEEK })?.claims, {});
const damaged = normalizeRewardLedger({ week: WEEK, claims: { t1: { rewards: 'garbage' }, t2: 5 } });
eq('ledger: a damaged claim STILL counts as claimed (never re-opens a payout)', Object.keys(damaged?.claims ?? {}).sort(), ['t1', 't2']);
eq('ledger: damaged claim rewards → []', damaged?.claims.t1.rewards, []);
eq(
  'ledger: bad reward entries are dropped, good ones kept',
  normalizeRewardLedger({ week: WEEK, claims: { t1: { rewards: [{ kind: 'xp', amount: 5 }, { kind: 'xp', amount: -1 }, null] } } })?.claims.t1.rewards,
  [{ kind: 'xp', amount: 5 }],
);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
