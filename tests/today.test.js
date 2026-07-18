// Demo 最終打磨 T1：今日任務接真資料——todayValidSquats 純函式（today.js 呈現層唯讀推導）。
// 「今日」判定契約：與 store todayISO 同式 new Date().toISOString().slice(0,10)（UTC），直接與 session.date 字串比對。
import { test, eq } from './harness.js';
import { todayValidSquats } from '../app/features/today/today.js';

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
