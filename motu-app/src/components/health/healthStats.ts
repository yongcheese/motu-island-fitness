/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 健康頁的數字 —— 從活動紀錄算出「今天、這幾週、這個月、個人最佳」。這裡沒有 React。
 *
 * 跟 constants/weeklyTasks.ts 的分工：那邊算的是**玩家自己設的任務**的進度；這邊算的是健康頁
 * 本身要畫的東西（圓環、連續達標、趨勢長條、月曆、個人紀錄）。兩邊都從同一份
 * {@link HealthActivity}[] 出發，也都用同一個遊戲時區與同一個「週一開始」的週期定義
 * （{@link weekStartFor}），所以任務卡上的「本週」跟圓環上的「本週」不可能是兩個不同的七天。
 *
 * 全部都是「算出來的」而不是存起來的，理由同每週任務的檔頭：紀錄本來就在存檔裡，重算不會跟它
 * 不同步。
 */

import { addCivilDays, civilDateAt, civilDaysBetween, civilWeekday, type CivilDate } from '../../constants/civilTime';
import { DAYS_PER_WEEK, weekStartFor } from '../../constants/weeklyTasks';
import { selectableActivityTypes, type HealthActivity } from '../../lib/healthData';
import type { HealthGoals } from './healthGoals';

/** 趨勢看幾週（含本週）。8 週 ≈ 兩個月，長到看得出方向、短到每一根長條都還分得清。 */
export const TREND_WEEKS = 8;

/** 一天的合計。 */
export interface DayTotals {
  seconds: number;
  reps: number;
  sessions: number;
}

/** 一週的合計。`days` 是這一週有運動的天數。 */
export interface WeekTotals {
  weekStart: CivilDate;
  minutes: number;
  reps: number;
  days: number;
  /** 這一週是不是本週（還沒結束）。 */
  current: boolean;
}

/** 活動開始的那一刻。紀錄存的是完成時間，往回推時間長度就是開始時間。 */
function activityStartMs(activity: HealthActivity): number {
  return Date.parse(activity.completedAt) - Math.max(0, activity.durationSeconds) * 1000;
}

/** 依遊戲時區的日曆日分組。壞掉的時間戳直接略過 —— 一筆壞紀錄不該讓整張圖變成 NaN。 */
export function totalsByDay(activities: readonly HealthActivity[]): Map<CivilDate, DayTotals> {
  const byDay = new Map<CivilDate, DayTotals>();
  for (const activity of activities) {
    const at = Date.parse(activity.completedAt);
    if (!Number.isFinite(at)) continue;
    const day = civilDateAt(new Date(at));
    const entry = byDay.get(day) ?? { seconds: 0, reps: 0, sessions: 0 };
    entry.seconds += Math.max(0, activity.durationSeconds);
    entry.reps += Math.max(0, activity.reps);
    entry.sessions += 1;
    byDay.set(day, entry);
  }
  return byDay;
}

/** 一週的合計，`weekStart` 是那一週的星期一。 */
function weekTotals(byDay: Map<CivilDate, DayTotals>, weekStart: CivilDate, current: boolean): WeekTotals {
  let seconds = 0;
  let reps = 0;
  let days = 0;
  for (let i = 0; i < DAYS_PER_WEEK; i++) {
    const entry = byDay.get(addCivilDays(weekStart, i));
    if (!entry) continue;
    seconds += entry.seconds;
    reps += entry.reps;
    if (entry.sessions > 0) days += 1;
  }
  return { weekStart, minutes: Math.round(seconds / 60), reps, days, current };
}

/** 最近 {@link TREND_WEEKS} 週，由舊到新，最後一個是本週。 */
export function recentWeeks(byDay: Map<CivilDate, DayTotals>, today: CivilDate, count = TREND_WEEKS): WeekTotals[] {
  const thisWeek = weekStartFor(today);
  const weeks: WeekTotals[] = [];
  for (let i = count - 1; i >= 0; i--) {
    weeks.push(weekTotals(byDay, addCivilDays(thisWeek, -i * DAYS_PER_WEEK), i === 0));
  }
  return weeks;
}

/** 本週的一天。`future` 是今天之後的日子 —— 還沒到，不是「沒運動」。 */
export interface WeekDay {
  date: CivilDate;
  minutes: number;
  reps: number;
  active: boolean;
  today: boolean;
  future: boolean;
}

/** 本週週一到週日，每天一格。今天頁的「本週每天」用。 */
export function thisWeekDays(byDay: Map<CivilDate, DayTotals>, today: CivilDate): WeekDay[] {
  const start = weekStartFor(today);
  return Array.from({ length: DAYS_PER_WEEK }, (_, i) => {
    const date = addCivilDays(start, i);
    const entry = byDay.get(date);
    return {
      date,
      minutes: Math.round((entry?.seconds ?? 0) / 60),
      reps: entry?.reps ?? 0,
      active: (entry?.sessions ?? 0) > 0,
      today: date === today,
      future: civilDaysBetween(today, date) > 0,
    };
  });
}

/**
 * 連續達標幾週。
 *
 * 以**週**計算而不是以天：休息日是訓練的一部分，一個「每天都要動」的連續紀錄會在玩家照著建議休
 * 息的那天歸零。一週只要運動天數達到目標就延續。
 *
 * 本週還沒結束，所以它只能加分不能扣分：本週已達標就算進去；還沒達標的話連續紀錄仍然「活著」
 * （算到上週為止），直到這一週真的結束。
 */
export function currentStreakWeeks(byDay: Map<CivilDate, DayTotals>, today: CivilDate, goals: HealthGoals): number {
  const thisWeek = weekStartFor(today);
  let streak = weekTotals(byDay, thisWeek, true).days >= goals.daysPerWeek ? 1 : 0;
  // 上限只是保險：紀錄最多 200 筆，不可能真的連續幾百週。
  for (let i = 1; i < 520; i++) {
    const week = weekTotals(byDay, addCivilDays(thisWeek, -i * DAYS_PER_WEEK), false);
    if (week.days < goals.daysPerWeek) break;
    streak += 1;
  }
  return streak;
}

/** 紀錄裡最長的一段連續達標週數。 */
export function longestStreakWeeks(byDay: Map<CivilDate, DayTotals>, today: CivilDate, goals: HealthGoals): number {
  if (byDay.size === 0) return 0;
  const earliest = [...byDay.keys()].sort()[0];
  let week = weekStartFor(earliest);
  const thisWeek = weekStartFor(today);
  let best = 0;
  let run = 0;
  while (civilDaysBetween(week, thisWeek) >= 0) {
    if (weekTotals(byDay, week, false).days >= goals.daysPerWeek) {
      run += 1;
      best = Math.max(best, run);
    } else if (week !== thisWeek) {
      run = 0;
    }
    week = addCivilDays(week, DAYS_PER_WEEK);
  }
  return best;
}

/** 單週最多運動天數，以及是哪一週。 */
export function bestWeekDays(byDay: Map<CivilDate, DayTotals>): { days: number; weekStart: CivilDate } | null {
  const weeks = new Map<CivilDate, Set<CivilDate>>();
  for (const [day, entry] of byDay) {
    if (entry.sessions === 0) continue;
    const start = weekStartFor(day);
    const set = weeks.get(start) ?? new Set<CivilDate>();
    set.add(day);
    weeks.set(start, set);
  }
  let best: { days: number; weekStart: CivilDate } | null = null;
  for (const [weekStart, set] of weeks) {
    if (!best || set.size > best.days) best = { days: set.size, weekStart };
  }
  return best;
}

/**
 * 連續達標頁列出幾週（含本週）。比趨勢的 8 週長一點：連續紀錄常常比兩個月長，而這一頁要讓人看得
 * 到「是從哪一週斷掉的」。
 */
export const STREAK_WEEKS = 12;

/** 紀錄裡最早有運動的那一天。沒有紀錄就是 null。 */
export function earliestDay(byDay: Map<CivilDate, DayTotals>): CivilDate | null {
  let earliest: CivilDate | null = null;
  for (const day of byDay.keys()) {
    if (earliest === null || day < earliest) earliest = day;
  }
  return earliest;
}

/**
 * 連續達標頁的逐週列表：最近 {@link STREAK_WEEKS} 週，由舊到新，最後一個是本週。
 *
 * 第一筆紀錄之前的週不列：那幾週玩家還沒開始用（或紀錄超出讀取上限），把它們畫成一排「未達標」
 * 是在說一件不是真的事。
 */
export function streakWeeks(byDay: Map<CivilDate, DayTotals>, today: CivilDate): WeekTotals[] {
  const weeks = recentWeeks(byDay, today, STREAK_WEEKS);
  const first = earliestDay(byDay);
  if (first === null) return weeks.slice(-1);
  const firstWeek = weekStartFor(first);
  return weeks.filter((week) => week.current || civilDaysBetween(firstWeek, week.weekStart) >= 0);
}

/** 月曆上的一格。`null` 是月初對齊星期一用的空格。 */
export type MonthCell = null | { date: CivilDate; day: number; active: boolean; today: boolean; future: boolean };

/**
 * 某個月的月曆，週一開頭 —— 跟每週任務同一個週期定義。
 *
 * `anchor` 是那個月裡的任何一天，預設是今天（也就是這個月）。活動紀錄頁往前翻月份時傳別的月。
 */
export function monthCells(
  byDay: Map<CivilDate, DayTotals>,
  today: CivilDate,
  anchor: CivilDate = today,
): { year: number; month: number; cells: MonthCell[]; activeDays: number } {
  const [year, month] = anchor.split('-').map(Number);
  const first = `${year}-${String(month).padStart(2, '0')}-01` as CivilDate;
  const lead = (civilWeekday(first) + 6) % 7; // 星期一 = 0
  const cells: MonthCell[] = Array.from({ length: lead }, () => null);
  let activeDays = 0;
  for (let date = first; Number(date.slice(5, 7)) === month; date = addCivilDays(date, 1)) {
    const active = (byDay.get(date)?.sessions ?? 0) > 0;
    if (active) activeDays += 1;
    cells.push({
      date,
      day: Number(date.slice(8, 10)),
      active,
      today: date === today,
      future: civilDaysBetween(today, date) > 0,
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return { year, month, cells, activeDays };
}

/** 某個月的第一天。月份可以超出 1..12（0 是去年 12 月、13 是明年 1 月），翻月份的時候直接加減。 */
export function monthStart(year: number, month: number): CivilDate {
  const shifted = year * 12 + (month - 1);
  const y = Math.floor(shifted / 12);
  const m = shifted - y * 12 + 1;
  return `${y}-${String(m).padStart(2, '0')}-01` as CivilDate;
}

/** 個人紀錄頁每個項目畫出最近幾次。10 次大概是兩三週的量，長條還分得清。 */
export const RECORD_RECENT_SESSIONS = 10;

/**
 * 一個運動項目的紀錄：單次最佳（動作次數最多的那一次），以及看懂這個最佳需要的幾個數字 —— 最近
 * 一次做了幾下（離紀錄多遠）、最近幾次的走勢、最久的一次、總共做過幾次。
 */
export interface PersonalBest {
  type: string;
  /** 還沒做過這個項目就是 null。 */
  best: HealthActivity | null;
  /** 最佳是不是最近 7 天內刷新的。 */
  fresh: boolean;
  /** 這個項目做過幾次（讀得到的紀錄裡）。 */
  sessions: number;
  /** 最近一次。 */
  latest: HealthActivity | null;
  /** 時間最長的一次。 */
  longest: HealthActivity | null;
  /** 最近 {@link RECORD_RECENT_SESSIONS} 次，由舊到新。 */
  recent: HealthActivity[];
  /** 每一次刷新紀錄的那一次，由舊到新；最後一個就是 `best`。 */
  progression: HealthActivity[];
}

/** 每個項目的紀錄。先列健身做得出來的項目，所以沒運動過的玩家也看得到要挑戰什麼。 */
export function personalBests(activities: readonly HealthActivity[], today: CivilDate): PersonalBest[] {
  return selectableActivityTypes(activities).map((type) => {
    // 由新到舊。紀錄本來就是這個順序，但這裡不靠呼叫端保證。
    const own = activities
      .filter((activity) => activity.type === type && Number.isFinite(Date.parse(activity.completedAt)))
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
    let best: HealthActivity | null = null;
    let longest: HealthActivity | null = null;
    for (const activity of own) {
      if (!best || activity.reps > best.reps) best = activity;
      if (!longest || activity.durationSeconds > longest.durationSeconds) longest = activity;
    }
    const fresh = !!best && best.reps > 0 && civilDaysBetween(civilDateAt(new Date(best.completedAt)), today) < 7;
    // 由舊到新走一遍，比之前每一次都多的就是一次刷新。同樣多下不算刷新。
    const progression: HealthActivity[] = [];
    for (let i = own.length - 1; i >= 0; i--) {
      const top = progression[progression.length - 1]?.reps ?? 0;
      if (own[i].reps > top) progression.push(own[i]);
    }
    // 跟 `best` 對齊：同樣多下時 `best` 是比較新的那一次，所以最後一步換成它，兩邊講的是同一天。
    if (best && progression.length > 0 && progression[progression.length - 1].reps === best.reps) {
      progression[progression.length - 1] = best;
    }
    return {
      type,
      best: best && best.reps > 0 ? best : null,
      fresh,
      sessions: own.length,
      latest: own[0] ?? null,
      longest: longest && longest.durationSeconds > 0 ? longest : null,
      recent: own.slice(0, RECORD_RECENT_SESSIONS).reverse(),
      progression,
    };
  });
}

/** 時間最長的一次運動。 */
export function longestSession(activities: readonly HealthActivity[]): HealthActivity | null {
  let best: HealthActivity | null = null;
  for (const activity of activities) {
    if (!best || activity.durationSeconds > best.durationSeconds) best = activity;
  }
  return best && best.durationSeconds > 0 ? best : null;
}

/** 遊戲時區（UTC+8）裡的第幾個小時，帶小數。跟 healthFormat 的 activityTimeLabel 同一個位移。 */
function civilHourAt(ms: number): number {
  const shifted = new Date(ms + 8 * 60 * 60 * 1000);
  return shifted.getUTCHours() + shifted.getUTCMinutes() / 60 + shifted.getUTCSeconds() / 3600;
}

/**
 * 某一天的每一次運動從幾點到幾點（小時，0..24 的小數），今天頁的時間軸用。
 *
 * 一筆紀錄算在它**完成**的那一天（跟 {@link totalsByDay} 同一個規則），所以一次跨過午夜的運動
 * 從 0 點畫起，而不是畫到前一天去。
 */
export function daySpans(dayActivities: readonly HealthActivity[]): Array<{ activity: HealthActivity; from: number; to: number }> {
  return dayActivities.flatMap((activity) => {
    const end = Date.parse(activity.completedAt);
    const start = activityStartMs(activity);
    if (!Number.isFinite(end) || !Number.isFinite(start)) return [];
    const to = civilHourAt(end);
    const from = civilDateAt(new Date(start)) === civilDateAt(new Date(end)) ? civilHourAt(start) : 0;
    return [{ activity, from, to: Math.max(from, to) }];
  });
}

/** 一段期間內各項目的動作次數，多的在前。 */
export function repsByType(activities: readonly HealthActivity[], fromDay: CivilDate, toDay: CivilDate): Array<{ type: string; reps: number }> {
  const totals = new Map<string, number>();
  for (const activity of activities) {
    const at = Date.parse(activity.completedAt);
    if (!Number.isFinite(at)) continue;
    const day = civilDateAt(new Date(at));
    if (civilDaysBetween(fromDay, day) < 0 || civilDaysBetween(day, toDay) < 0) continue;
    totals.set(activity.type, (totals.get(activity.type) ?? 0) + Math.max(0, activity.reps));
  }
  return [...totals.entries()]
    .map(([type, reps]) => ({ type, reps }))
    .filter((entry) => entry.reps > 0)
    .sort((a, b) => b.reps - a.reps);
}

/** 某一天的所有活動，由早到晚。 */
export function activitiesOn(activities: readonly HealthActivity[], day: CivilDate): HealthActivity[] {
  return activities
    .filter((activity) => {
      const at = Date.parse(activity.completedAt);
      return Number.isFinite(at) && civilDateAt(new Date(at)) === day;
    })
    .sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt));
}

/** 「9月18日 星期五」。 */
export function longDateLabel(day: CivilDate): string {
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][civilWeekday(day)];
  return `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日 星期${weekday}`;
}

/** 平均，空陣列回 0。 */
export function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** 運動項目的單字縮寫：「深蹲」→「蹲」、「開合跳」→「跳」。最後一個字通常就是動作本身。 */
export function typeGlyph(type: string): string {
  const chars = [...type.trim()];
  return chars.length > 0 ? chars[chars.length - 1] : '動';
}
