// Demo 最終打磨 T1：今日任務接真資料——todayValidSquats 純函式（today.js 呈現層唯讀推導）。
// 「今日」判定契約：與 store todayISO 同式 new Date().toISOString().slice(0,10)（UTC），直接與 session.date 字串比對。
import { test, eq } from './harness.js';
import { todayValidSquats, todayActiveMinutes, weekActiveDays } from '../app/features/today/today.js';

const TODAY = '2026-07-18';
const mk = (date, exercise, validReps) => ({ date, exercise, validReps });

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
