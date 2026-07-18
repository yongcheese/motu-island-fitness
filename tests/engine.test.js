import { test, eq, between, assert } from './harness.js';
import { createDetector } from '../app/core/engine.js';
import { EXERCISES } from '../app/core/exercises/index.js';
import { makeSequence } from '../app/core/synth.js';
import { LM } from '../app/core/landmarks.js';

const run = (id, seqOpts) => {
  const det = createDetector(EXERCISES[id]);
  const seq = makeSequence(id, seqOpts);
  let t = 0; let last;
  for (const f of seq.frames) { last = det.update(f, t); t += seq.dtMs; }
  return { s: det.summary(), last };
};

// ---------- SQUAT ----------
test('squat: 5 clean reps → 5 valid, 0 invalid', () => {
  const { s } = run('squat', { reps: 5, variant: 'clean' });
  eq(s.validReps, 5, 'valid'); eq(s.invalidReps, 0, 'invalid');
});
test('squat: half reps → 0 valid (counted as invalid attempts)', () => {
  const { s } = run('squat', { reps: 5, variant: 'half' });
  eq(s.validReps, 0, 'no valid on half-squat');
  assert(s.invalidReps >= 4, 'half squats logged as invalid attempts');
});
test('squat: 彎腰代償 → 0 valid + 記錄代償 fault', () => {
  const { s } = run('squat', { reps: 5, variant: 'compensation' });
  eq(s.validReps, 0, 'no valid on bend-over cheat');
  const faults = Object.keys(s.faultCounts);
  assert(faults.length > 0, 'compensation faults recorded');
});

// ---------- NORMALIZATION INVARIANCE (系統關鍵層) ----------
test('squat: scale 1.5× (鏡頭近) 仍計 5 reps', () => {
  const { s } = run('squat', { reps: 5, variant: 'clean', scale: 1.5 });
  eq(s.validReps, 5, 'scale-up invariant');
});
test('squat: scale 0.7× (鏡頭遠) 仍計 5 reps', () => {
  const { s } = run('squat', { reps: 5, variant: 'clean', scale: 0.7 });
  eq(s.validReps, 5, 'scale-down invariant');
});
test('squat: 平移 (站偏一邊) 仍計 5 reps', () => {
  const { s } = run('squat', { reps: 5, variant: 'clean', dx: 0.12, dy: -0.05 });
  eq(s.validReps, 5, 'translation invariant');
});

// ---------- ANTI-CHEAT: 防抖 / 遮擋 / 冷卻 ----------
test('防抖: 中度雜訊下不暴衝計次', () => {
  const { s } = run('squat', { reps: 5, variant: 'clean', noise: 0.012, seed: 7 });
  between(s.validReps, 4, 5, 'jitter tolerated, no over-count');
});
test('信心值檢查: 腳踝/膝蓋遮擋 → 暫停判定，0 valid', () => {
  const { s } = run('squat', {
    reps: 5, variant: 'clean',
    occludeIdx: [LM.LEFT_ANKLE, LM.RIGHT_ANKLE, LM.LEFT_KNEE, LM.RIGHT_KNEE],
  });
  eq(s.validReps, 0, 'occluded key joints → no judgement');
});
test('動態冷卻: 250ms 內兩次達標只計一次', () => {
  const det = createDetector(EXERCISES.squat);
  // 手動構造：到達深蹲底→回站→立刻又到底，全部在冷卻窗內
  const seq = makeSequence('squat', { reps: 2, variant: 'clean', fps: 240, framesPerRep: 16, restFrames: 2 });
  let t = 0; for (const f of seq.frames) { det.update(f, t); t += seq.dtMs; }
  const s = det.summary();
  between(s.validReps, 1, 1, 'cooldown suppresses superhuman double-count');
});

// ---------- JUMPING JACK ----------
test('jumpingjack: 5 clean → 5 valid', () => {
  const { s } = run('jumpingjack', { reps: 5, variant: 'clean' });
  eq(s.validReps, 5);
});
test('jumpingjack: 只揮手不張腳 → 0 valid', () => {
  const { s } = run('jumpingjack', { reps: 5, variant: 'armsonly' });
  eq(s.validReps, 0, 'arms-only cheat rejected');
});
test('jumpingjack: 只張腳不舉手 → 0 valid', () => {
  const { s } = run('jumpingjack', { reps: 5, variant: 'legsonly' });
  eq(s.validReps, 0, 'legs-only cheat rejected');
});

// ---------- HIGH KNEES (alternating) ----------
test('highknees: 6 交替 → 6 valid', () => {
  const { s } = run('highknees', { reps: 6, variant: 'clean' });
  eq(s.validReps, 6);
});
test('highknees: 半抬 (膝未達髖高) → 0 valid', () => {
  const { s } = run('highknees', { reps: 6, variant: 'half' });
  eq(s.validReps, 0, 'knee below hip rejected');
});
test('highknees: 一直抬同一隻腳 → 至多 1 valid (需交替)', () => {
  const { s } = run('highknees', { reps: 6, variant: 'singleleg' });
  between(s.validReps, 0, 1, 'no alternation → not counted');
});

// ---------- PUSH-UP ----------
test('pushup: 5 clean → 5 valid', () => {
  const { s } = run('pushup', { reps: 5, variant: 'clean' });
  eq(s.validReps, 5);
});
test('pushup: 半程 (手肘未下壓) → 0 valid', () => {
  const { s } = run('pushup', { reps: 5, variant: 'half' });
  eq(s.validReps, 0, 'half pushup rejected');
});
test('pushup: 塌腰 → 0 valid + 記錄 sag fault', () => {
  const { s } = run('pushup', { reps: 5, variant: 'sag' });
  eq(s.validReps, 0, 'sagging body rejected');
  assert(Object.keys(s.faultCounts).length > 0, 'sag fault recorded');
});

// ---------- NOISE ROBUSTNESS (尺度 EMA 後的抗抖動：高良率 + 不誤判) ----------
test('squat: 高雜訊(0.025) 多種子仍穩定計 5 (不漏判)', () => {
  for (const seed of [1, 7, 13, 21, 42]) {
    const { s } = run('squat', { reps: 5, variant: 'clean', noise: 0.025, seed });
    eq(s.validReps, 5, 'seed ' + seed);
  }
});
test('squat: 高雜訊下半蹲/代償仍 0 valid (不誤判為達標)', () => {
  for (const seed of [1, 13, 42]) {
    eq(run('squat', { reps: 5, variant: 'half', noise: 0.02, seed }).s.validReps, 0, 'half seed ' + seed);
    eq(run('squat', { reps: 5, variant: 'compensation', noise: 0.02, seed }).s.validReps, 0, 'comp seed ' + seed);
  }
});
test('jumpingjack/highknees: 高雜訊下正樣本不漏、負樣本不誤判', () => {
  eq(run('jumpingjack', { reps: 5, variant: 'clean', noise: 0.02, seed: 7 }).s.validReps, 5, 'jj clean');
  eq(run('jumpingjack', { reps: 5, variant: 'armsonly', noise: 0.02, seed: 7 }).s.validReps, 0, 'jj armsonly');
  eq(run('highknees', { reps: 6, variant: 'clean', noise: 0.02, seed: 7 }).s.validReps, 6, 'hk clean');
});

// ---------- ACCURACY AGGREGATE (≥90% 目標) ----------
test('整體判定準確率 ≥ 90% (正/負樣本混合)', () => {
  const cases = [
    ['squat', 'clean', true], ['squat', 'half', false], ['squat', 'compensation', false],
    ['jumpingjack', 'clean', true], ['jumpingjack', 'armsonly', false], ['jumpingjack', 'legsonly', false],
    ['highknees', 'clean', true], ['highknees', 'half', false], ['highknees', 'sitting', false],
    ['pushup', 'clean', true], ['pushup', 'half', false], ['pushup', 'sag', false],
    // invariance positives
    ['squat', 'clean', true], ['jumpingjack', 'clean', true],
  ];
  let correct = 0;
  for (const [id, variant, shouldCount] of cases) {
    const scale = (id === 'squat' && variant === 'clean') ? 1.3 : 1;
    const { s } = run(id, { reps: 4, variant, scale });
    const counted = s.validReps >= 3; // 正樣本應幾乎全計，負樣本應幾乎不計
    if (counted === shouldCount) correct++;
  }
  const acc = correct / cases.length;
  assert(acc >= 0.9, `accuracy ${(acc * 100).toFixed(1)}% < 90%`);
});
