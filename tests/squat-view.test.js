// 2026-09-25 實機回報：正對鏡頭深蹲蹲到底不計次，轉 45° 才計。
// 根因：深度只看「畫面上髖與膝的高低」。正面蹲下時膝蓋往前靠近鏡頭、鏡頭又高於膝，
// 透視讓膝在畫面上顯得比髖低 —— 3D 上髖已低於膝，畫面上仍是髖在上。
// 修法：加第二個深度訊號「髖相對站立時的下降量 − 膝相對站立時的下降量」÷ 站立大腿長，兩者取大。
// 真人資料（UI-PRMD）的完整驗證見 docs/verification/深蹲朝向驗證.md；這裡以其中一小段當夾具鎖住結果。
import { test, eq, assert } from './harness.js';
import { makeSequence } from '../app/core/synth.js';
import { createDetector } from '../app/core/engine.js';
import { EXERCISES } from '../app/core/exercises/index.js';
import { DROP_GATE, dropProgress, GATE_PROGRESS } from '../app/core/exercises/squat.js';
import { LM } from '../app/core/landmarks.js';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GATE_DEPTH } from '../app/core/exercises/squat.js';

function count(frames, spy) {
  const spec = spy ? { ...EXERCISES.squat, evaluate: (f, s) => { spy(s, f); return EXERCISES.squat.evaluate(f, s); } } : EXERCISES.squat;
  const d = createDetector(spec); let t = 0;
  for (const f of frames) { d.update(f, t); t += 33; }
  return d.summary();
}

/* ---------- 真人夾具：UI-PRMD 投影到筆電機位（1150mm）、正對鏡頭 ---------- */
const FX = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/squat_front_1150.json'), 'utf8'));
const unpack = (row) => {
  const f = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  FX.landmarks.forEach((k, i) => { f[k] = { x: row[i * 2] / FX.scale, y: row[i * 2 + 1] / FX.scale, z: 0, visibility: 1 }; });
  return f;
};
/** 同一位受試者的多次動作接續餵入同一個判定器（模擬一段連續訓練），回傳每一次是否計為有效 */
function perRep(clips) {
  const d = createDetector(EXERCISES.squat); let t = 0, prev = 0;
  return clips.map(c => { for (const r of c.frames) { d.update(unpack(r), t); t += 33; } const v = d.summary().validReps; const hit = v > prev; prev = v; return hit; });
}

test('夾具前提：這些 3D 上髖已低於膝的動作，在畫面上舊訊號（髖 vs 膝）看不出蹲到底', () => {
  let best = -Infinity;
  for (const c of FX.deep.slice(1)) {
    assert(c.gtHipMinusKneeMm <= 0, `${c.id} 不是蹲到底`);
    for (const r of c.frames) {
      const f = unpack(r);
      const hy = (f[LM.LEFT_HIP].y + f[LM.RIGHT_HIP].y) / 2, ky = (f[LM.LEFT_KNEE].y + f[LM.RIGHT_KNEE].y) / 2;
      const leg = Math.hypot(f[LM.LEFT_HIP].x - f[LM.LEFT_KNEE].x, f[LM.LEFT_HIP].y - f[LM.LEFT_KNEE].y) + Math.hypot(f[LM.LEFT_KNEE].x - f[LM.LEFT_ANKLE].x, f[LM.LEFT_KNEE].y - f[LM.LEFT_ANKLE].y);
      best = Math.max(best, (hy - ky) / leg);
    }
  }
  assert(best < GATE_DEPTH, `舊訊號最深 ${best.toFixed(3)} 已過門檻 ${GATE_DEPTH}，夾具無法代表這個 bug`);
});

test('真人正面（筆電機位）：3D 髖低於膝的 5 次深蹲至少計到 4 次（修改前 0 次）', () => {
  // 第 1 次（髖高於膝 5mm）是站立基準建立期，不列入。
  // 如實斷言 ≥4：第 3 次（髖只低於膝 8mm，壓線）在門檻 0.72 下計不到 ——
  // 它正是驗證文件中「1150mm 正面 28/29」唯一漏掉的那一次，不換夾具挑樣本。
  const hits = perRep(FX.deep).slice(1);
  assert(hits.filter(Boolean).length >= 4, `逐次結果 ${hits}`);
});

test('真人正面（筆電機位）：髖比膝高 24–45cm 的半蹲一次都不計', () => {
  assert(FX.shallow.every(c => c.gtHipMinusKneeMm >= 200), '夾具前提');
  const hits = perRep(FX.shallow);
  eq(hits.filter(Boolean).length, 0, `逐次結果 ${hits}`);
});

/* ---------- 防作弊／誤觸發 ---------- */
const STAND = makeSequence('squat', { reps: 1, variant: 'clean', framesPerRep: 30 }).frames[0];
const shifted = (dy, k = 1) => STAND.map(p => ({ ...p, x: 0.5 + (p.x - 0.5) * k, y: 0.5 + (p.y - 0.5) * k + dy }));

test('整個人（或鏡頭被碰到）在畫面上快速上下移動，不會被當成蹲下', () => {
  // slice-reviewer 2026-09-25：只看髖的下降量時，全身平移 0.20（約一個大腿長）在 0.4 秒內就能騙到一次
  for (const dy of [0.1, 0.2, 0.3]) {
    const frames = [];
    for (let i = 0; i < 60; i++) frames.push(shifted(0));                      // 站好建立基準
    for (let rep = 0; rep < 4; rep++) {
      for (let i = 0; i <= 6; i++) frames.push(shifted(dy * i / 6));
      for (let i = 6; i >= 0; i--) frames.push(shifted(dy * i / 6));
      for (let i = 0; i < 10; i++) frames.push(shifted(0));
    }
    eq(count(frames).validReps, 0, `全身平移 ${dy} 被計次`);
  }
});

test('站著不動、往鏡頭走近 20%（畫面放大）不會被當成蹲下', () => {
  const frames = [];
  for (let i = 0; i < 150; i++) frames.push(shifted(0, 1 + 0.2 * Math.min(1, i / 60)));
  const s = count(frames);
  eq(s.validReps + s.invalidReps, 0, '走近被當成一次動作');
});

for (const fpr of [26, 30]) {   // 26＝示範模式實際幀數（開發守則：測試參數要涵蓋實機參數）
  test(`合成序列行為不變：clean 計滿、half／compensation 為 0（framesPerRep ${fpr}）`, () => {
    eq(count(makeSequence('squat', { reps: 6, variant: 'clean', framesPerRep: fpr }).frames).validReps, 6);
    eq(count(makeSequence('squat', { reps: 6, variant: 'half', framesPerRep: fpr }).frames).validReps, 0);
    eq(count(makeSequence('squat', { reps: 6, variant: 'compensation', framesPerRep: fpr }).frames).validReps, 0);
  });
}

test('合成樣本的髖下降量落在真人數量級（蹲到底 ≥ 門檻、半蹲明顯低於門檻）', () => {
  // 真人（UI-PRMD，800–1150mm）：蹲到底 p05 0.78–0.92、半蹲 p95 0.60–0.73。合成 clean 1.12、half 0.49。
  let clean = -1, half = -1;
  count(makeSequence('squat', { reps: 3, variant: 'clean' }).frames, s => { if (s.hipDrop != null) clean = Math.max(clean, s.hipDrop); });
  count(makeSequence('squat', { reps: 3, variant: 'half' }).frames, s => { if (s.hipDrop != null) half = Math.max(half, s.hipDrop); });
  assert(clean >= DROP_GATE + 0.1, `clean 峰值 ${clean} 離門檻太近（雷 1：要明確達標，不要剛好壓線）`);
  assert(half <= DROP_GATE - 0.2, `half 峰值 ${half}`);
});

test('站立基準建立前 hipDrop 為 null，判定退回髖膝高低差（不會拿 null 算）', () => {
  let first;
  count(makeSequence('squat', { reps: 1, variant: 'clean' }).frames.slice(0, 6), s => { if (first === undefined) first = s.hipDrop; });
  assert(first !== undefined, '判定從未被呼叫（測試前提失效）');
  eq(first, null);
});

test('dropProgress：門檻對齊量表達標線（GATE_PROGRESS），且夾在 0..1', () => {
  assert(Math.abs(dropProgress(DROP_GATE) - GATE_PROGRESS) < 1e-12, '門檻與達標線不一致 → 量表會說謊');
  eq(dropProgress(-0.5), 0); eq(dropProgress(5), 1);
});
