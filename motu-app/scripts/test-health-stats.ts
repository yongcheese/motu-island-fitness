/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 健康頁的統計 — rules tests.
 *
 * Run with `npm run test:health-stats`. Same tsx-script style as the other `test:*` checks.
 *
 * Covers the numbers the health sub-pages show that are computed here rather than read straight off
 * a record: each type's personal record and how it climbed (個人紀錄), this week's day-by-day totals
 * (今天 → 本週每天), and when each of today's workouts happened (今天 → 時間軸). Every one of them is
 * derived from the same activity list, so the checks build small hand-written lists whose answers
 * can be worked out on paper.
 */

import { personalBests, RECORD_RECENT_SESSIONS, thisWeekDays, totalsByDay, daySpans } from '../src/components/health/healthStats';
import { addCivilDays, type CivilDate } from '../src/constants/civilTime';
import { weekStartFor, type HealthActivity } from '../src/constants/weeklyTasks';

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

/** 遊戲時區（UTC+8）某一天的某個時刻，ISO 字串。 */
function at(day: CivilDate, hour: number, minute = 0): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour - 8, minute)).toISOString();
}

let seq = 0;
function act(type: string, day: CivilDate, hour: number, reps: number, minutes = 10): HealthActivity {
  seq += 1;
  return { activityId: `a${seq}`, completedAt: at(day, hour), type, durationSeconds: minutes * 60, reps };
}

/** 由新到舊，跟 Firestore 讀回來的順序一樣。 */
const newestFirst = (list: HealthActivity[]) => [...list].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));

const today = '2026-10-04' as CivilDate; // 星期日
const d = (offset: number) => addCivilDays(today, offset);

// --- 個人紀錄 -------------------------------------------------------------------

{
  const squats = [
    act('深蹲', d(-20), 9, 20, 8),
    act('深蹲', d(-15), 9, 26, 15),
    act('深蹲', d(-10), 9, 18, 6),
    act('深蹲', d(-8), 9, 26, 9), // 平手，不算刷新
    act('深蹲', d(-3), 9, 31, 10),
    act('深蹲', d(-1), 9, 24, 12),
  ];
  const jacks = [act('開合跳', d(-2), 20, 0, 5)]; // 有做，但沒有偵測到動作
  const bests = personalBests(newestFirst([...squats, ...jacks]), today);
  const squat = bests.find((entry) => entry.type === '深蹲')!;
  const jack = bests.find((entry) => entry.type === '開合跳')!;

  eq('best is the most reps', squat.best?.reps, 31);
  eq('best set 3 days ago is fresh', squat.fresh, true);
  eq('sessions counts every one of them', squat.sessions, 6);
  eq('latest is the newest', squat.latest?.reps, 24);
  eq('longest is by duration, not reps', squat.longest?.durationSeconds, 15 * 60);
  eq('recent is oldest → newest', squat.recent.map((a) => a.reps), [20, 26, 18, 26, 31, 24]);
  eq('progression only steps UP; a tie is not a new record', squat.progression.map((a) => a.reps), [20, 26, 31]);
  eq('progression ends on the same session as best', squat.progression.at(-1)?.activityId, squat.best?.activityId);
  eq('a type done only with 0 reps has no best', jack.best, null);
  eq('…but it still counts as done', jack.sessions, 1);
  eq('…and has no record to climb', jack.progression.length, 0);

  const old = personalBests(newestFirst([act('深蹲', d(-30), 9, 40)]), today).find((entry) => entry.type === '深蹲')!;
  eq('a best older than 7 days is not fresh', old.fresh, false);

  const many = Array.from({ length: RECORD_RECENT_SESSIONS + 5 }, (_, i) => act('深蹲', d(-40 + i), 9, 10 + i));
  const capped = personalBests(newestFirst(many), today).find((entry) => entry.type === '深蹲')!;
  eq(`recent keeps the last ${RECORD_RECENT_SESSIONS}`, capped.recent.length, RECORD_RECENT_SESSIONS);
  eq('…ending on the newest', capped.recent.at(-1)?.reps, 10 + RECORD_RECENT_SESSIONS + 4);

  const empty = personalBests([], today);
  eq('known types are listed even with no records', empty.length > 0, true);
  eq('…with nothing to show', empty.every((entry) => entry.best === null && entry.sessions === 0 && entry.recent.length === 0), true);
}

// --- 本週每天 -------------------------------------------------------------------

{
  const wednesday = '2026-09-30' as CivilDate;
  const list = [act('深蹲', '2026-09-28' as CivilDate, 8, 10, 12), act('深蹲', '2026-09-28' as CivilDate, 20, 5, 9), act('開合跳', wednesday, 7, 20, 25)];
  const days = thisWeekDays(totalsByDay(list), wednesday);
  eq('seven days, Monday first', days.map((day) => day.date), Array.from({ length: 7 }, (_, i) => addCivilDays(weekStartFor(wednesday), i)));
  eq('Monday adds both sessions', [days[0].minutes, days[0].reps], [21, 15]);
  eq('Tuesday is a past day with nothing', [days[1].active, days[1].future], [false, false]);
  eq('today is marked', days.findIndex((day) => day.today), 2);
  eq('days after today are future, not empty', days.map((day) => day.future), [false, false, false, true, true, true, true]);
}

// --- 今天的時間軸 ---------------------------------------------------------------

{
  // 07:30 結束、做了 30 分鐘 → 07:00–07:30。
  const morning = act('深蹲', today, 7, 10, 30);
  morning.completedAt = at(today, 7, 30);
  const [span] = daySpans([morning]);
  eq('a span runs from start to finish', [span.from, span.to], [7, 7.5]);

  // 00:10 結束、做了 20 分鐘 → 前一天 23:50 開始；算在完成的那一天，從 0 點畫起。
  const late = act('深蹲', today, 0, 10, 20);
  late.completedAt = at(today, 0, 10);
  const [cross] = daySpans([late]);
  eq('a workout across midnight starts at 0', cross.from, 0);
  eq('…and ends when it ended', Math.round(cross.to * 60), 10);

  const broken = { ...morning, activityId: 'bad', completedAt: 'not a date' };
  eq('a broken timestamp is skipped, not drawn at NaN', daySpans([broken]).length, 0);
}

console.log(failures === 0 ? `\nALL PASS (${checks} checks)\n` : `\n${failures} of ${checks} checks FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
