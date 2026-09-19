// Demo 最終打磨 T1：今日任務接真資料——todayValidSquats 純函式（today.js 呈現層唯讀推導）。
// 「今日」判定契約：與 store 同式 —— 2026-09-19 起兩邊都走 core/dates.js 的**本地時區**日期鍵。
// ⚠️ 此行原本寫的是「new Date().toISOString().slice(0,10)（UTC），直接與 session.date 字串比對」。
//    那份契約已被推翻：UTC 判定會讓台北 00:00–07:59 的訓練被歸到前一天。
//    現在歸日一律經 sessionDayKey()（優先由 dateISO 還原本地日，舊的 UTC date 欄位僅作 fallback）。
import { test, eq } from './harness.js';
import { todayValidSquats, todayActiveMinutes, weekActiveDays } from '../app/features/today/today.js';

const TODAY = '2026-07-18';
const mk = (date, exercise, validReps) => ({ date, exercise, validReps });
/** 以本地時刻造一筆紀錄：dateISO 為完整時間戳、date 刻意留成舊版的 UTC 鍵，
 *  用來驗證「舊存檔不必改寫也能被正確歸日」這條設計。 */
const mkAt = (y, m, d, hh, mm, exercise, validReps, durationSec = 300) => {
  const local = new Date(y, m - 1, d, hh, mm, 0);
  return {
    dateISO: local.toISOString(),
    date: local.toISOString().slice(0, 10),   // 舊版的 UTC 蓋章（在 UTC+8 可能是前一天）
    exercise, validReps, durationSec,
  };
};

test('today: 今日兩筆 squat 12+8 → cap 於 target 20', () => {
  const h = [mk(TODAY, 'squat', 12), mk(TODAY, 'squat', 8), mk(TODAY, 'squat', 5)];
  eq(todayValidSquats(h, TODAY), 20);   // 12+8+5=25 → cap 20
});

test('today: 昨日紀錄不算', () => {
  const h = [mk('2026-07-17', 'squat', 15), mk(TODAY, 'squat', 6)];
  eq(todayValidSquats(h, TODAY), 6);
});

test('today: 其他動作不算', () => {
  const h = [mk(TODAY, 'jumpingjack', 30), mk(TODAY, 'pushup', 10), mk(TODAY, 'squat', 4)];
  eq(todayValidSquats(h, TODAY), 4);
});

test('today: 空 history → 0（含非法 validReps 防護）', () => {
  eq(todayValidSquats([], TODAY), 0);
  eq(todayValidSquats([mk(TODAY, 'squat', NaN), mk(TODAY, 'squat', -3)], TODAY), 0);
});

// ── D-3：dailyGoalMin / weeklyGoalDays 接線後的純函式（原本兩個設定存了沒人讀）──

const mkD = (date, durationSec) => ({ date, durationSec });

test('todayActiveMinutes: 同日多筆加總後換算分鐘（四捨五入）', () => {
  const h = [mkD(TODAY, 600), mkD(TODAY, 300), mkD('2026-07-17', 9999)];
  eq(todayActiveMinutes(h, TODAY), 15);        // 900s = 15min，前一天那筆不算
});
test('todayActiveMinutes: 髒資料不汙染（NaN／負值／缺欄位一律略過）', () => {
  const h = [mkD(TODAY, NaN), mkD(TODAY, -100), { date: TODAY }, mkD(TODAY, 120)];
  eq(todayActiveMinutes(h, TODAY), 2);
});
test('todayActiveMinutes: 空歷史 / undefined → 0', () => {
  eq(todayActiveMinutes([], TODAY), 0);
  eq(todayActiveMinutes(undefined, TODAY), 0);
});

// 2026-07-18 是週六；該週為 07-13(一) ~ 07-19(日)
test('weekActiveDays: 算「天數」不是次數——同日多筆只計一天', () => {
  const h = [mkD('2026-07-13', 600), mkD('2026-07-13', 600), mkD('2026-07-16', 600)];
  eq(weekActiveDays(h, TODAY).days, 2);
});
test('weekActiveDays: 上週的紀錄不得算進本週', () => {
  const h = [mkD('2026-07-12', 600), mkD('2026-07-13', 600)];   // 07-12 是上週日
  eq(weekActiveDays(h, TODAY).days, 1, '只有 07-13 屬本週');
});
test('weekActiveDays: 週一為起點，週日為終點（七格且順序正確）', () => {
  const w = weekActiveDays([], TODAY);
  eq(w.dates.length, 7);
  eq(w.dates[0].date, '2026-07-13', '第一格＝週一');
  eq(w.dates[6].date, '2026-07-19', '最後一格＝週日');
  eq(w.dates.filter(d => d.isToday).length, 1, '今天只能有一格');
  eq(w.dates[5].isToday, true, '2026-07-18 是週六＝第六格');
});
test('weekActiveDays: 週一當天查詢，本週只有自己一格起算（不回捲到上週）', () => {
  const h = [mkD('2026-07-13', 600), mkD('2026-07-12', 600)];
  const w = weekActiveDays(h, '2026-07-13');
  eq(w.days, 1);
  eq(w.dates[0].date, '2026-07-13');
});
test('weekActiveDays: 壞日期字串不丟例外，回傳空結果', () => {
  const w = weekActiveDays([mkD(TODAY, 600)], 'not-a-date');
  eq(w.days, 0); eq(w.dates.length, 0);
});


// ── 2026-09-19 時區修正的迴歸測試 ────────────────────────────────
// 修正前：今日判定用 UTC 日期。台北 UTC+8 之下，早上 07:30 練的訓練
// 會被歸到前一天 —— 早晨打開時今日任務顯示的是昨天的進度，八點一到又整個歸零。
test('today: 早上 07:30 練的深蹲算進今天（時區 bug 迴歸）', () => {
  const morning = mkAt(2026, 9, 19, 7, 30, 'squat', 12);
  eq(todayValidSquats([morning], '2026-09-19'), 12);
});

test('today: 同一個本地日的早晚兩次訓練會相加，不會被拆到兩天', () => {
  const morning = mkAt(2026, 9, 19, 7, 30, 'squat', 8);
  const evening = mkAt(2026, 9, 19, 21, 0, 'squat', 7);
  eq(todayValidSquats([morning, evening], '2026-09-19'), 15);
});

test('today: 今日分鐘數同樣以本地日歸戶', () => {
  const morning = mkAt(2026, 9, 19, 7, 30, 'squat', 8, 600);
  const evening = mkAt(2026, 9, 19, 21, 0, 'squat', 7, 300);
  eq(todayActiveMinutes([morning, evening], '2026-09-19'), 15);   // 900 秒 = 15 分
});

test('today: 前一個本地日的早晨訓練不得算進今天', () => {
  const yesterdayMorning = mkAt(2026, 9, 18, 7, 30, 'squat', 20);
  eq(todayValidSquats([yesterdayMorning], '2026-09-19'), 0);
});

test('today: 本週天數以本地週一起算，早晨的訓練不會掉到上一週', () => {
  // 2026-09-14 是週一。把一筆放在週一早上 07:30（舊版會被歸到 09-13 週日＝上一週）
  const mondayMorning = mkAt(2026, 9, 14, 7, 30, 'squat', 10);
  const w = weekActiveDays([mondayMorning], '2026-09-19');
  eq(w.days, 1, '週一早晨那一筆應落在本週');
  eq(w.dates[0].date, '2026-09-14', '本週第一天應為週一');
  eq(w.dates[0].active, true);
});
