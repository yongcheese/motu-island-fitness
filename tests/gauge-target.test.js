// 深度量表的「達標線」必須畫在真的會算數的位置。
//
// 2026-09-19 修正前：線畫在 thresholds.targetEnter（深蹲 0.62），
// 但品質 gate 要求 depth ≥ −0.10，換算成 progress 是 0.667。
// 中間 0.62–0.667 是死區 —— 深度條明明過了白線，這一下卻被判半程。
// 實機回報的「明明做對卻不算」有一部分就是這裡。
import { test, eq, approx, assert } from './harness.js';
import { EXERCISES } from '../app/core/exercises/index.js';
import { GATE_DEPTH, GATE_PROGRESS, DEPTH_NORM } from '../app/core/exercises/squat.js';
import { gaugeTargetOf } from '../app/features/workout/workout.js';

test('深蹲：達標線畫在品質 gate 的位置，不是相位門檻', () => {
  const line = gaugeTargetOf(EXERCISES.squat);
  approx(line, 0.6667, 0.001, '應為 gate 深度換算的 progress');
  assert(line !== EXERCISES.squat.thresholds.targetEnter,
    '若仍等於 targetEnter，代表修正沒生效，死區還在');
});

test('深蹲：GATE_PROGRESS 確實由 GATE_DEPTH 與 DEPTH_NORM 導出，不是第二處寫死', () => {
  const derived = (GATE_DEPTH - DEPTH_NORM.lo) / (DEPTH_NORM.hi - DEPTH_NORM.lo);
  eq(GATE_PROGRESS, derived);
});

test('其餘動作的達標線位置維持不變（本次不得順手改到它們）', () => {
  for (const id of ['jumpingjack', 'highknees', 'pushup']) {
    const ex = EXERCISES[id];
    eq(gaugeTargetOf(ex), ex.thresholds.targetEnter, `${ex.name} 的線不應被更動`);
  }
});

test('未知動作退回相位門檻，不丟例外', () => {
  eq(gaugeTargetOf({ thresholds: { targetEnter: 0.5 } }), 0.5);
  eq(gaugeTargetOf(undefined), 1);
  eq(gaugeTargetOf({}), 1);
});

// ── 門檻守門測試 ───────────────────────────────────────────────
// 這幾個數字是拿真人資料跑過本專案引擎標定出來的（見 squat.js 檔頭的標定歷程）。
// 動它們必須連帶更新標定報告，否則企劃書「每個門檻都可追溯」那句話就不成立。
// 本測試的用途不是驗證功能，是**讓無意間的改動立刻紅燈**。
test('守門：深蹲的深度門檻未經重新標定不得更動', () => {
  eq(GATE_DEPTH, -0.10, 'gate 深度改動須附標定依據');
  eq(EXERCISES.squat.thresholds.targetEnter, 0.62, '相位門檻改動須附標定依據');
  eq(DEPTH_NORM.lo, -0.5);
  eq(DEPTH_NORM.hi, 0.1);
});
