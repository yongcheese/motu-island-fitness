// 追蹤頁的日期分組必須與 store 蓋章用的同一套。
//
// 2026-09-19 修正前：store 用 UTC 蓋章、tracking 用本地日期分組，同一個 App 兩個「今天」。
// 台北 UTC+8 之下，同一天早上與晚上各練一次會被拆成兩天（早上那筆歸到前一日）。
// 本檔是那個 bug 的迴歸測試。
import { test, eq, assert } from './harness.js';
import { groupByDate, lastNDays, splitWeeks } from '../app/features/tracking/tracking.js';
import { sessionDayKey } from '../app/core/dates.js';

/** 造一筆 session：以本地時間指定，dateISO 為完整時間戳（與 store 實際寫法一致）。 */
function mk(y, m, d, hh, mm, validReps = 10, durationSec = 300) {
  const local = new Date(y, m - 1, d, hh, mm, 0);
  return {
    id: String(Math.random()),
    dateISO: local.toISOString(),
    date: local.toISOString().slice(0, 10),   // 刻意模擬舊版的 UTC 蓋章
    exercise: 'squat', validReps, invalidReps: 0, durationSec, grade: 'A', faults: {},
  };
}

test('同一個本地日的早晚兩次訓練，歸在同一天（修正前會被拆成兩天）', () => {
  const morning = mk(2026, 9, 19, 7, 30);
  const evening = mk(2026, 9, 19, 21, 0);
  const g = groupByDate([morning, evening]);
  eq(g.size, 1, `應只有一個日期鍵，實得 ${[...g.keys()].join(',')}`);
  eq(g.get('2026-09-19').length, 2);
});

test('早晨那筆的 date 欄位確實是錯的 —— 證明本測試測到的是真問題', () => {
  const morning = mk(2026, 9, 19, 7, 30);
  // 在 UTC+8 環境下，本地 07:30 的 UTC 日期是前一天。若不是 UTC+8 就跳過這條斷言。
  const utcKey = morning.date;
  const localKey = sessionDayKey(morning);
  eq(localKey, '2026-09-19');
  assert(utcKey === '2026-09-18' || utcKey === localKey,
    `舊欄位 ${utcKey}，新歸日 ${localKey}（非 UTC+8 環境下兩者可相同）`);
});

test('分組鍵一律走 sessionDayKey，不再直接讀 date 欄位', () => {
  const s = mk(2026, 9, 19, 7, 30);
  const g = groupByDate([s]);
  assert(g.has(sessionDayKey(s)), '分組鍵應等於 sessionDayKey 的結果');
});

test('lastNDays 走日曆日，跨月不跳號', () => {
  const keys = lastNDays(3, new Date(2026, 8, 1, 12, 0, 0));   // 2026-09-01
  eq(keys.join(','), '2026-08-30,2026-08-31,2026-09-01');
});

test('lastNDays 跨年正確', () => {
  const keys = lastNDays(3, new Date(2027, 0, 1, 12, 0, 0));   // 2027-01-01
  eq(keys.join(','), '2026-12-30,2026-12-31,2027-01-01');
});

test('splitWeeks：本週與上週以本地日期為界，早晨的訓練不會掉到上週', () => {
  const today = new Date(2026, 8, 19, 12, 0, 0);   // 2026-09-19
  // 本週內最早的一天是 09-13；把一筆放在 09-13 早上 07:30（舊版會被歸到 09-12 = 上週）
  const edge = mk(2026, 9, 13, 7, 30, 8);
  const { thisWeek, lastWeek } = splitWeeks([edge], today);
  eq(thisWeek.sessions, 1, '邊界那一筆應落在本週');
  eq(lastWeek.sessions, 0);
});

test('沒有訓練的日子不會被硬塞進分組', () => {
  const g = groupByDate([]);
  eq(g.size, 0);
});

test('只有 date 沒有 dateISO 的極舊資料仍可分組，不丟例外', () => {
  const ancient = { date: '2026-09-10', validReps: 5, invalidReps: 0, durationSec: 100 };
  const g = groupByDate([ancient]);
  eq(g.size, 1);
  eq(g.get('2026-09-10').length, 1);
});
