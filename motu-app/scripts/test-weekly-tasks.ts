/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 每週任務 — rules tests.
 *
 * Run with `npm run test:weekly-tasks`. Same tsx-script style as the other `test:*` checks, for the
 * same reason test-daily-login.ts gives: this repo has no vitest/jest and adding one is a bigger
 * decision than one feature should make.
 *
 * These cover the DECIDABLE half of the spec — the week's tiling and its boundaries in Asia/Taipei,
 * how progress is measured from real activity records, the remaining-days wording at each edge,
 * validation including every invalid input the brief names, and what a corrupt save is normalised
 * into. What they deliberately do NOT cover is the WRITE path (creating a task while another write
 * is in flight, a refused save): those are properties of context/useWeeklyTasks.ts and of Firestore,
 * not of these functions — see docs/weekly-tasks.md.
 */

import {
  COMPLETED_WEEKS_LIMIT,
  DAYS_PER_WEEK,
  MAX_WEEKLY_TASKS,
  METRIC_SPECS,
  TASK_NAME_MAX,
  applyWeeklyTaskEdit,
  availableMetrics,
  computeWeeklyTaskProgress,
  cycleFromWeekStart,
  getMetricSpec,
  hasErrors,
  makeWeeklyTask,
  markWeekCompleted,
  measureActivity,
  normalizeWeeklyTaskState,
  sortProgress,
  summariseWeek,
  unsupportedMetrics,
  validateWeeklyTaskDraft,
  weekStartFor,
  weeklyCycleAt,
  type HealthActivity,
  type WeeklyTaskDefinition,
} from '../src/constants/weeklyTasks';
import { civilDateAt } from '../src/constants/civilTime';
import { rewardForTask } from '../src/constants/weeklyTaskRewards';
import { activityFromWorkoutLog, WORKOUT_LOG_METRICS } from '../src/lib/healthData';
import type { WorkoutLog } from '../src/types';

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
  checks++;
  if (!condition) {
    failures++;
    console.log(`FAIL  ${name}${detail ? `  ${detail}` : ''}`);
  } else {
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

/** An instant, written as Taipei wall-clock time so the boundary cases read as what they test. */
function taipei(iso: string): Date {
  return new Date(`${iso}+08:00`);
}

/** A task, with everything the tests do not care about filled in. */
function task(overrides: Partial<WeeklyTaskDefinition> = {}): WeeklyTaskDefinition {
  return {
    taskId: 'wt-test',
    name: '每週運動',
    metric: 'workout_count',
    target: 3,
    createdAt: '2026-09-01T00:00:00.000Z',
    startWeek: '2026-09-14',
    completedWeeks: [],
    ...overrides,
  };
}

/** One activity, at a Taipei wall-clock instant. */
function activity(at: string, overrides: Partial<HealthActivity> = {}): HealthActivity {
  return {
    activityId: `a-${at}`,
    completedAt: taipei(at).toISOString(),
    type: '開合跳',
    durationSeconds: 600,
    reps: 40,
    ...overrides,
  };
}

console.log('\n-- the week, and where it starts -------------------------------------');

// 2026-09-21 is a Monday. Every case below is anchored on that fact.
eq('a Monday is its own week start', weekStartFor('2026-09-21'), '2026-09-21');
eq('a Sunday belongs to the week that began six days earlier', weekStartFor('2026-09-27'), '2026-09-21');
eq('a Wednesday looks back to Monday', weekStartFor('2026-09-23'), '2026-09-21');
eq('the week is seven days long', DAYS_PER_WEEK, 7);
eq('a cycle runs Monday to Sunday', cycleFromWeekStart('2026-09-21').weekEnd, '2026-09-27');

// Month and year boundaries, because a week that cannot cross one is a week that breaks four times
// a year and once more on new year's eve.
eq('a week may start in one month and end in the next', cycleFromWeekStart('2026-09-28').weekEnd, '2026-10-04');
eq('a week may cross a year boundary', weekStartFor('2027-01-01'), '2026-12-28');
// 2028 is a leap year; 2028-02-29 is a Tuesday.
eq('a leap day resolves to its own Monday', weekStartFor('2028-02-29'), '2028-02-28');

console.log('\n-- timezone: the same instant is the same week for everybody ---------');

{
  // 23:30 Taipei on the final Sunday and 00:30 Taipei on the following Monday are 60 minutes apart
  // and must land in DIFFERENT weeks — the case that a `toISOString().slice(0, 10)` gets wrong for
  // every player east of UTC.
  const lateSunday = taipei('2026-09-27T23:30:00');
  const earlyMonday = taipei('2026-09-28T00:30:00');
  eq('23:30 Sunday is still the old week', weeklyCycleAt(lateSunday).weekStart, '2026-09-21');
  eq('00:30 Monday is the new week', weeklyCycleAt(earlyMonday).weekStart, '2026-09-28');
  ok(
    'the two are one hour apart in real time',
    earlyMonday.getTime() - lateSunday.getTime() === 60 * 60 * 1000,
  );
  // And the civil date agrees with the cycle, which is what stops the history list and the task
  // cards from disagreeing about which day a late-night workout happened on.
  eq('the civil date of 23:30 Sunday', civilDateAt(lateSunday), '2026-09-27');
}

{
  // The window is half-open: the first instant of Monday is IN, the first instant of the next
  // Monday is OUT. An inclusive end would count one workout in two consecutive weeks.
  const cycle = cycleFromWeekStart('2026-09-21');
  eq('the window opens at Monday midnight', cycle.startMs, taipei('2026-09-21T00:00:00').getTime());
  eq('the window closes at the NEXT Monday midnight', cycle.endMs, taipei('2026-09-28T00:00:00').getTime());
}

console.log('\n-- progress comes from the records, and only from them ---------------');

{
  const now = taipei('2026-09-23T12:00:00'); // Wednesday
  const activities = [
    activity('2026-09-21T09:00:00'),
    activity('2026-09-22T09:00:00'),
    // Last week's — must not count.
    activity('2026-09-20T09:00:00'),
    // Next week's — must not count either. A future-dated record is not impossible: an API can
    // report a completion with its own clock.
    activity('2026-09-28T09:00:00'),
  ];
  const progress = computeWeeklyTaskProgress(task(), activities, now);
  eq('only this week counts', progress.current, 2);
  eq('the target is the one the task names', progress.target, 3);
  eq('the percentage is rounded', progress.percent, 67);
  eq('not yet complete', progress.completed, false);
  eq('status is active', progress.status, 'active');
}

{
  const now = taipei('2026-09-23T12:00:00');
  // A record with an unparseable timestamp must be skipped, not turned into NaN. A NaN progress bar
  // does not throw — it silently renders empty, which is the worst kind of wrong.
  const broken: HealthActivity = { ...activity('2026-09-22T09:00:00'), completedAt: 'not a date' };
  const progress = computeWeeklyTaskProgress(task(), [activity('2026-09-22T09:00:00'), broken], now);
  eq('a broken timestamp is skipped', progress.current, 1);
  ok('and the ratio is still a number', Number.isFinite(progress.ratio));
}

{
  const now = taipei('2026-09-23T12:00:00');
  const activities = [
    activity('2026-09-21T09:00:00', { durationSeconds: 600, reps: 40, type: '深蹲' }),
    activity('2026-09-22T09:00:00', { durationSeconds: 900, reps: 60, type: '開合跳' }),
  ];
  eq('workout_minutes sums the durations', computeWeeklyTaskProgress(task({ metric: 'workout_minutes', target: 60 }), activities, now).current, 25);
  eq('workout_reps sums the reps', computeWeeklyTaskProgress(task({ metric: 'workout_reps', target: 200 }), activities, now).current, 100);
  eq(
    'activity_type_count counts only the named type',
    computeWeeklyTaskProgress(task({ metric: 'activity_type_count', activityType: '深蹲', target: 3 }), activities, now).current,
    1,
  );
  eq(
    'a type nobody did counts zero',
    computeWeeklyTaskProgress(task({ metric: 'activity_type_count', activityType: '游泳', target: 3 }), activities, now).current,
    0,
  );
}

{
  // 「完成度不應超過 100% 的視覺上限」 AND 「原始進度資料仍應正確保存」 — both, at once.
  const now = taipei('2026-09-23T12:00:00');
  const activities = Array.from({ length: 7 }, (_, i) => activity(`2026-09-2${1 + (i % 3)}T0${i}:00:00`, { activityId: `a${i}` }));
  const progress = computeWeeklyTaskProgress(task({ target: 5 }), activities, now);
  eq('the raw count is not clamped', progress.current, 7);
  eq('the raw percentage is not clamped', progress.rawPercent, 140);
  eq('the bar ratio IS clamped', progress.ratio, 1);
  eq('the displayed percentage is clamped', progress.percent, 100);
  eq('and it is complete', progress.completed, true);
  eq('status reflects it', progress.status, 'completed');
}

{
  // 步數 has no data source, so a steps task measures zero — not a plausible-looking invented number.
  const stepsTask = task({ metric: 'steps', target: 30000 });
  eq('a steps activity contributes nothing', measureActivity(activity('2026-09-22T09:00:00'), stepsTask), 0);
}

console.log('\n-- remaining days are computed, never hardcoded ----------------------');

{
  const cycle = cycleFromWeekStart('2026-09-21');
  const on = (day: string) => computeWeeklyTaskProgress(task({ target: 99 }), [], taipei(`${day}T12:00:00`), cycle);

  eq('Monday: the whole week is left', on('2026-09-21').daysRemaining, 7);
  eq('Monday says so', on('2026-09-21').remaining, { kind: 'days', days: 7 });
  eq('Friday', on('2026-09-25').daysRemaining, 3);
  eq('Saturday has today and tomorrow', on('2026-09-26').daysRemaining, 2);
  // The one the brief singles out: 「當天到期：顯示適當的當日提示」.
  eq('Sunday is the last day, not "1 day left"', on('2026-09-27').remaining, { kind: 'due_today' });
  eq('and Sunday still counts as one day remaining', on('2026-09-27').daysRemaining, 1);
  // 「已過期：顯示已過期」 — only reachable for a PAST cycle, which is what a history view asks for.
  eq('the Monday after is expired', on('2026-09-28').remaining, { kind: 'expired', daysAgo: 1 });
  eq('expired has no days remaining', on('2026-09-28').daysRemaining, 0);
  eq('an expired, unmet task says so', on('2026-09-28').status, 'expired');
  eq('three days later', on('2026-09-30').remaining, { kind: 'expired', daysAgo: 3 });
}

{
  // A task created THIS week is not retroactively expired for the weeks before it existed.
  const later = task({ startWeek: '2026-09-28' });
  const thisWeek = computeWeeklyTaskProgress(later, [], taipei('2026-09-23T12:00:00'));
  eq('a task starting next week is upcoming', thisWeek.status, 'upcoming');
}

console.log('\n-- crossing a week boundary -----------------------------------------');

{
  const activities = [activity('2026-09-22T09:00:00'), activity('2026-09-23T09:00:00'), activity('2026-09-24T09:00:00')];
  const done = computeWeeklyTaskProgress(task({ target: 3 }), activities, taipei('2026-09-25T12:00:00'));
  eq('the week it was earned in: complete', done.completed, true);

  // The SAME records, one week later. The new cycle starts empty — no write, no reset, no scheduled
  // job: the window simply moved.
  const nextWeek = computeWeeklyTaskProgress(task({ target: 3 }), activities, taipei('2026-09-30T12:00:00'));
  eq('the next week starts at zero', nextWeek.current, 0);
  eq('and is active again', nextWeek.status, 'active');
  eq('with a new period', nextWeek.cycle.weekStart, '2026-09-28');
}

{
  // The completion RECORD survives the crossing, which is what makes last week's achievement
  // still true after the progress that earned it has rolled off the window.
  const marked = markWeekCompleted(task(), '2026-09-21');
  eq('a week is recorded', marked.completedWeeks, ['2026-09-21']);
  eq('recording twice is a no-op', markWeekCompleted(marked, '2026-09-21').completedWeeks, ['2026-09-21']);
  ok('and returns the same object', markWeekCompleted(marked, '2026-09-21') === marked);

  const last = computeWeeklyTaskProgress(marked, [], taipei('2026-09-23T12:00:00'), cycleFromWeekStart('2026-09-21'));
  eq('a recorded week reads as celebrated', last.celebrated, true);
  const other = computeWeeklyTaskProgress(marked, [], taipei('2026-09-30T12:00:00'));
  eq('a different week does not', other.celebrated, false);

  // The list is capped, and it is the OLDEST that goes.
  let many = task();
  for (let i = 0; i < COMPLETED_WEEKS_LIMIT + 4; i += 1) {
    const week = `2026-01-${String(1 + i).padStart(2, '0')}`;
    many = markWeekCompleted(many, week);
  }
  eq('the record is capped', many.completedWeeks?.length, COMPLETED_WEEKS_LIMIT);
  eq('and it keeps the newest', many.completedWeeks?.[COMPLETED_WEEKS_LIMIT - 1], `2026-01-${COMPLETED_WEEKS_LIMIT + 4}`);
}

console.log('\n-- validation: the invalid inputs the brief names --------------------');

{
  const existing = [task({ taskId: 'a', name: '每週運動' })];
  const valid = { name: '每週深蹲', metric: 'workout_count', target: '3' };

  eq('a valid draft passes', validateWeeklyTaskDraft(valid, existing), {});
  ok('an empty name is refused', !!validateWeeklyTaskDraft({ ...valid, name: '' }, existing).name);
  ok('whitespace alone is refused', !!validateWeeklyTaskDraft({ ...valid, name: '   ' }, existing).name);
  ok('an over-long name is refused', !!validateWeeklyTaskDraft({ ...valid, name: 'x'.repeat(TASK_NAME_MAX + 1) }, existing).name);
  ok('a duplicate name is refused', !!validateWeeklyTaskDraft({ ...valid, name: '每週運動' }, existing).name);
  ok('a duplicate ignoring surrounding space is still a duplicate', !!validateWeeklyTaskDraft({ ...valid, name: '  每週運動  ' }, existing).name);
  // 「重複操作」 — editing a task must not collide with its own name.
  eq('editing a task keeps its own name', validateWeeklyTaskDraft({ ...valid, name: '每週運動' }, existing, 'a'), {});

  ok('an empty target is refused', !!validateWeeklyTaskDraft({ ...valid, target: '' }, existing).target);
  ok('a non-numeric target is refused', !!validateWeeklyTaskDraft({ ...valid, target: '三次' }, existing).target);
  ok('zero is refused', !!validateWeeklyTaskDraft({ ...valid, target: '0' }, existing).target);
  ok('a negative target is refused', !!validateWeeklyTaskDraft({ ...valid, target: '-5' }, existing).target);
  ok('a fractional target is refused', !!validateWeeklyTaskDraft({ ...valid, target: '2.5' }, existing).target);
  ok('an absurd target is refused', !!validateWeeklyTaskDraft({ ...valid, target: '99999' }, existing).target);
  ok('NaN is refused', !!validateWeeklyTaskDraft({ ...valid, target: 'NaN' }, existing).target);
  ok('Infinity is refused', !!validateWeeklyTaskDraft({ ...valid, target: 'Infinity' }, existing).target);

  ok('an unknown metric is refused', !!validateWeeklyTaskDraft({ ...valid, metric: 'vibes' }, existing).metric);
  // 「不要使用虛假的固定數值冒充實際運動紀錄」 — a metric with no data source cannot be created at all.
  ok('an unsupported metric is refused', !!validateWeeklyTaskDraft({ ...valid, metric: 'steps', target: '30000' }, existing).metric);
  ok(
    'activity_type_count needs a type',
    !!validateWeeklyTaskDraft({ ...valid, metric: 'activity_type_count' }, existing).activityType,
  );
  eq(
    'and passes once given one',
    validateWeeklyTaskDraft({ ...valid, metric: 'activity_type_count', activityType: '深蹲' }, existing),
    {},
  );

  const full = Array.from({ length: MAX_WEEKLY_TASKS }, (_, i) => task({ taskId: `t${i}`, name: `任務 ${i}` }));
  ok('a full list refuses a new task', !!validateWeeklyTaskDraft(valid, full).form);
  eq('but still allows editing an existing one', validateWeeklyTaskDraft(valid, full, 't0'), {});
  ok('hasErrors agrees', hasErrors(validateWeeklyTaskDraft(valid, full)) && !hasErrors(validateWeeklyTaskDraft(valid, existing)));
}

{
  // Building and editing both trim, round, and keep the things that must not move.
  const built = makeWeeklyTask({ name: '  每週深蹲  ', metric: 'workout_count', target: '4' }, taipei('2026-09-23T12:00:00'));
  eq('the name is trimmed', built.name, '每週深蹲');
  eq('the target is an integer', built.target, 4);
  eq('the start week is this week', built.startWeek, '2026-09-21');
  eq('it starts with no completed weeks', built.completedWeeks, []);
  ok('and gets an id', built.taskId.startsWith('wt-'));

  const edited = applyWeeklyTaskEdit(markWeekCompleted(built, '2026-09-21'), {
    name: '每週深蹲加量',
    metric: 'workout_reps',
    target: '300',
  }, taipei('2026-09-24T12:00:00'));
  eq('editing keeps the id', edited.taskId, built.taskId);
  eq('editing keeps the start week', edited.startWeek, built.startWeek);
  eq('editing keeps the completion record', edited.completedWeeks, ['2026-09-21']);
  eq('editing changes the metric', edited.metric, 'workout_reps');
  ok('and stamps an update time', !!edited.updatedAt);

  // Switching AWAY from activity_type_count must drop the type, or a later switch back would
  // silently resurrect a stale one.
  const typed = makeWeeklyTask({ name: '深蹲週', metric: 'activity_type_count', target: '3', activityType: '深蹲' });
  eq('a typed task keeps its type', typed.activityType, '深蹲');
  const untyped = applyWeeklyTaskEdit(typed, { name: '深蹲週', metric: 'workout_count', target: '3' });
  eq('switching metric drops the type', untyped.activityType, undefined);
}

console.log('\n-- a corrupt save is normalised, not rendered ------------------------');

{
  eq('undefined becomes an empty list', normalizeWeeklyTaskState(undefined), { tasks: [] });
  eq('null becomes an empty list', normalizeWeeklyTaskState(null), { tasks: [] });
  eq('a non-list becomes an empty list', normalizeWeeklyTaskState({ tasks: 'nope' }), { tasks: [] });

  const dirty = normalizeWeeklyTaskState({
    tasks: [
      task({ taskId: 'good' }),
      // Every one of these is a shape the UI would render as NaN or a blank card.
      { taskId: 'no-name', metric: 'workout_count', target: 3 },
      { taskId: 'string-target', name: 'x', metric: 'workout_count', target: '3' },
      { taskId: 'zero-target', name: 'x', metric: 'workout_count', target: 0 },
      { taskId: 'nan-target', name: 'x', metric: 'workout_count', target: Number.NaN },
      { taskId: 'bad-metric', name: 'x', metric: 'vibes', target: 3 },
      { name: 'no id', metric: 'workout_count', target: 3 },
      null,
      'a string',
      // A duplicate id would give two cards one React key and make editing one edit both.
      task({ taskId: 'good', name: 'duplicate id' }),
    ],
  });
  eq('only the sound one survives', dirty.tasks?.map((entry) => entry.taskId), ['good']);

  // The calorie goal was removed in 2026-10. A save that still has one must load: that task is
  // skipped (not converted into some other goal), and the player's other tasks are untouched.
  const removedMetric = { taskId: 'kcal', name: '燃燒 500', metric: 'calories', target: 500, createdAt: '', startWeek: '2026-09-14' };
  ok('the removed calorie goal has no spec any more', getMetricSpec('calories') === null);
  eq(
    'a saved calorie task is dropped, the rest survive',
    normalizeWeeklyTaskState({ tasks: [task({ taskId: 'a' }), removedMetric, task({ taskId: 'b', name: 'b' })] }).tasks?.map((entry) => entry.taskId),
    ['a', 'b'],
  );
  eq('and it is offered no reward', rewardForTask({ metric: 'calories' as never, target: 500 }), null);
  ok('and the form cannot create one', !!validateWeeklyTaskDraft({ name: 'x', metric: 'calories', target: '500' }).metric);

  const overLong = normalizeWeeklyTaskState({
    tasks: Array.from({ length: MAX_WEEKLY_TASKS + 5 }, (_, i) => task({ taskId: `t${i}`, name: `任務 ${i}` })),
  });
  eq('the list is capped at the maximum', overLong.tasks?.length, MAX_WEEKLY_TASKS);
}

console.log('\n-- the week summary and the list order -------------------------------');

{
  const now = taipei('2026-09-24T12:00:00');
  const activities = [
    activity('2026-09-21T09:00:00', { durationSeconds: 600, reps: 40 }),
    activity('2026-09-23T09:00:00', { durationSeconds: 300, reps: 20 }),
    activity('2026-09-19T09:00:00', { durationSeconds: 999, reps: 999 }), // last week
  ];
  const entries = [
    computeWeeklyTaskProgress(task({ taskId: 'a', target: 2 }), activities, now),
    computeWeeklyTaskProgress(task({ taskId: 'b', target: 9 }), activities, now),
  ];
  const summary = summariseWeek(activities, entries, now);
  eq('only this week is summed', summary.workouts, 2);
  eq('minutes', summary.minutes, 15);
  eq('reps', summary.reps, 60);
  eq('completed tasks', summary.tasksCompleted, 1);
  eq('active tasks', summary.tasksActive, 2);

  // An upcoming task is not counted against this week's tally — it has not started.
  const withUpcoming = summariseWeek(
    activities,
    [...entries, computeWeeklyTaskProgress(task({ taskId: 'c', startWeek: '2026-10-05' }), activities, now)],
    now,
  );
  eq('an upcoming task is not part of the tally', withUpcoming.tasksActive, 2);
}

{
  const now = taipei('2026-09-24T12:00:00');
  const done = computeWeeklyTaskProgress(task({ taskId: 'done', target: 0 }), [activity('2026-09-22T09:00:00')], now);
  const active = computeWeeklyTaskProgress(task({ taskId: 'active', target: 9, createdAt: '2026-09-02T00:00:00.000Z' }), [], now);
  const later = computeWeeklyTaskProgress(task({ taskId: 'later', startWeek: '2026-10-05' }), [], now);
  eq('unfinished tasks come first', sortProgress([done, later, active]).map((e) => e.task.taskId), ['active', 'later', 'done']);
}

console.log('\n-- the health data adapter ------------------------------------------');

{
  // The one place that knows `counts` means reps. A log missing half its fields must still produce
  // a usable activity rather than a set of undefineds.
  const full = activityFromWorkoutLog({
    logId: 'log-1',
    userId: 'u',
    type: '深蹲',
    duration: 300,
    counts: 25,
    goldEarned: 10,
    timestamp: '2026-09-22T09:00:00.000Z',
  });
  eq('a full log translates', full, {
    activityId: 'log-1',
    completedAt: '2026-09-22T09:00:00.000Z',
    type: '深蹲',
    durationSeconds: 300,
    reps: 25,
  });

  // Logs written before the calorie estimate was removed still carry a `calories` field. It must
  // be read past, not carried into the activity and not trip anything.
  const legacy = activityFromWorkoutLog({
    logId: 'log-1',
    userId: 'u',
    type: '深蹲',
    duration: 300,
    counts: 25,
    calories: 44,
    goldEarned: 10,
    timestamp: '2026-09-22T09:00:00.000Z',
  } as Partial<WorkoutLog>);
  eq('a legacy log with the removed field translates to the same activity', legacy, full);
  ok('and the removed field is not carried through', legacy !== null && !('calories' in legacy));

  const sparse = activityFromWorkoutLog({ timestamp: '2026-09-22T09:00:00.000Z' });
  eq('missing numbers become zero, not NaN', [sparse?.durationSeconds, sparse?.reps], [0, 0]);
  ok('and it still has a type', !!sparse?.type);

  eq('a log with no timestamp is dropped', activityFromWorkoutLog({ logId: 'x' }), null);
  eq('a log with a junk timestamp is dropped', activityFromWorkoutLog({ timestamp: 'yesterday' }), null);
  eq('a negative duration is floored at zero', activityFromWorkoutLog({ timestamp: '2026-09-22T09:00:00.000Z', duration: -5 })?.durationSeconds, 0);
}

{
  // The adapter's declared support and the metric table must agree, or the form offers a goal
  // nothing can feed.
  const declared = [...WORKOUT_LOG_METRICS].sort();
  const marked = availableMetrics().map((spec) => spec.id).sort();
  eq('the adapter feeds exactly the metrics marked available', declared, marked);
  eq('步數 is the one that is not', unsupportedMetrics().map((spec) => spec.id), ['steps']);
  ok('and it says why', unsupportedMetrics().every((spec) => !!spec.unavailableReason));
  ok('every metric has a spec', METRIC_SPECS.every((spec) => getMetricSpec(spec.id) === spec));
  ok('an unknown metric has none', getMetricSpec('vibes') === null);
  ok(
    'every available metric has a default inside its own bounds',
    availableMetrics().every((spec) => spec.defaultTarget >= spec.minTarget && spec.defaultTarget <= spec.maxTarget),
  );
}

console.log(
  failures === 0
    ? `\nALL PASS (${checks} checks)\n`
    : `\n${failures} of ${checks} checks FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
