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
import { liftGauge, GAUGE_TARGET, THIGH_LIFT_ENTER, THIGH_LIFT_TARGET } from '../app/core/exercises/highknees.js';
import { createDetector } from '../app/core/engine.js';
import { demoPose } from '../app/core/synth.js';

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
  // 高抬腿 2026-10-29 改用依大腿角度的深度條刻度，達標線跟著換算，由下方專屬測試把關
  for (const id of ['jumpingjack', 'pushup']) {
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

// ── 高抬腿深度條（2026-10-29 實機回報「抬一點點就整個拉滿」）─────────────
// 原本深度條直接顯示計次用的 progress，它只在 30°→60° 之間從 0 走到 1，玩偶抬 65° 就滿格。
// 改成依大腿夾角線性顯示（highknees.js liftGauge）；計次門檻不變。
const hkGaugeAt = (deg) => {
  const det = createDetector(EXERCISES.highknees);
  for (let i = 0; i < 60; i++) det.update(demoPose('highknees', 0, 'L'), i * 33);
  let r; for (let i = 0; i < 6; i++) r = det.update(demoPose('highknees', deg / 85, 'L'), (60 + i) * 33);
  return r;
};

test('高抬腿：達標線＝計次門檻換算到深度條上的位置', () => {
  const countFore = THIGH_LIFT_ENTER + EXERCISES.highknees.thresholds.targetEnter * (THIGH_LIFT_TARGET - THIGH_LIFT_ENTER);
  eq(gaugeTargetOf(EXERCISES.highknees), GAUGE_TARGET);
  approx(GAUGE_TARGET, liftGauge(countFore), 1e-12);
});

test('高抬腿：深度條過線的那一刻＝訊號達到計次門檻（不能出現過線卻不算的死區）', () => {
  const te = EXERCISES.highknees.thresholds.targetEnter;
  for (let deg = 0; deg <= 85; deg += 1) {
    const r = hkGaugeAt(deg);
    eq(r.gauge >= GAUGE_TARGET - 1e-9, r.signal >= te - 1e-9, `${deg}° 時深度條與計次判斷不一致（gauge ${r.gauge.toFixed(3)} / signal ${r.signal.toFixed(3)}）`);
  }
});

test('高抬腿：抬一點點不會拉滿，抬越高越滿，大腿水平才滿格（玩偶實測）', () => {
  // 2026-10-30 使用者實測線性版「還是太快到頂」→ 改成 15°→90° 的前慢後快曲線，以下期望值隨之收緊
  assert(hkGaugeAt(0).gauge === 0, '站著應為 0');
  assert(hkGaugeAt(20).gauge < 0.05, `抬 20° 幾乎不動，實得 ${hkGaugeAt(20).gauge.toFixed(2)}`);
  assert(hkGaugeAt(30).gauge < 0.15, `抬 30° 應很低，實得 ${hkGaugeAt(30).gauge.toFixed(2)}`);
  assert(hkGaugeAt(45).gauge < 0.35, `抬一半（45°）不該超過三分之一，實得 ${hkGaugeAt(45).gauge.toFixed(2)}`);
  assert(hkGaugeAt(60).gauge < 0.55, `抬 60° 約一半，實得 ${hkGaugeAt(60).gauge.toFixed(2)}`);
  assert(hkGaugeAt(85).gauge > hkGaugeAt(60).gauge + 0.15, '抬到接近水平要明顯比 60° 高');
  approx(liftGauge(1), 1, 1e-12, '大腿真的水平（投影縮到 0）才滿格');
  let prev = -1;
  for (let deg = 0; deg <= 85; deg += 5) { const g = hkGaugeAt(deg).gauge; assert(g >= prev - 1e-9, `${deg}° 深度條不該比低角度還少`); prev = g; }
});

test('其他動作的深度條仍顯示原本的訊號（gauge 未自訂時＝signal）', () => {
  for (const id of ['squat', 'jumpingjack', 'pushup']) assert(EXERCISES[id].gaugeTarget === undefined, id);
});
