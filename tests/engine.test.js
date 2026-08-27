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
// 註：原本用 1.5×，但那個尺度下合成人體的 y 範圍是 [-0.10, 1.12] —— 頭和腳都在畫面外，
// 那不是「鏡頭近」而是「太近到不該辨識」。取景把關上線後它會（正確地）被擋下，
// 對應的驗收改由 tests/framing.test.js 的「頭全程在畫面外 → 0 valid」負責。
// 這裡改用 1.15×：仍是明顯的近距離，但全身完整在框內，才測得到正規化的尺度不變性。
test('squat: scale 1.15× (鏡頭近、仍全身入鏡) 仍計 5 reps', () => {
  const { s } = run('squat', { reps: 5, variant: 'clean', scale: 1.15 });
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
// C-1：交替動作的第一下沒有前例可比，只能先放行，因此舊版「一直抬同一隻腳」必定漏掉第一下
// （舊斷言寫 between(0,1) 就是在容忍這個洩漏）。現改為回溯撤銷——下一下又同側時連第一下一起作廢，
// 所以任何次數都必須是 0 valid，「六層防作弊阻擋所有作弊動作」才成立。
test('highknees: 一直抬同一隻腳 → 0 valid (第一下須被回溯撤銷)', () => {
  for (const reps of [2, 4, 6, 12]) {
    const { s } = run('highknees', { reps, variant: 'singleleg' });
    eq(s.validReps, 0, `singleleg ${reps} reps → 0 valid`);
    assert(s.validReps >= 0, 'validReps 不得為負（撤銷只能發生一次）');
  }
});
test('highknees: 撤銷不影響正常交替 (clean 任何次數皆全數計入)', () => {
  for (const reps of [2, 6, 10]) {
    const { s } = run('highknees', { reps, variant: 'clean' });
    eq(s.validReps, reps, `clean ${reps} reps 全部有效——第一下不得被誤撤`);
  }
});
test('highknees: reset 後交替狀態歸零，兩輪結果一致', () => {
  const det = createDetector(EXERCISES.highknees);
  const feed = (variant, reps) => {
    const seq = makeSequence('highknees', { reps, variant });
    let t = 0; for (const f of seq.frames) { det.update(f, t); t += seq.dtMs; }
    const s = det.summary(); det.reset(); return s.validReps;
  };
  eq(feed('clean', 6), 6, '第一輪 clean');
  eq(feed('singleleg', 6), 0, 'reset 後 singleleg 仍須為 0');
  eq(feed('clean', 6), 6, 'reset 後 clean 仍須為 6');
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
    // 1.3 → 1.15：1.3× 時腳踝會落到 y=1.03（畫面外），取景把關上線後那是「太近」而非「鏡頭近」。
    const scale = (id === 'squat' && variant === 'clean') ? 1.15 : 1;
    const { s } = run(id, { reps: 4, variant, scale });
    const counted = s.validReps >= 3; // 正樣本應幾乎全計，負樣本應幾乎不計
    if (counted === shouldCount) correct++;
  }
  const acc = correct / cases.length;
  assert(acc >= 0.9, `accuracy ${(acc * 100).toFixed(1)}% < 90%`);
});

// C-2：把註解裡宣稱的實測值變成會失敗的斷言。舊註解寫「代償樣本 ≈48°」與「42° 誤殺率高」，
// 兩者都無實測支持（實測 46.42°，且合成器的正常深蹲軀幹恆為 0°、不模擬自然前傾）。
// 這條測試把數字鎖住：日後若合成器或門檻被改動，這裡會紅，註解就不會再默默失真。
test('squat: 軀幹傾角規則的判別餘裕僅約 1.4°（鎖住實測值）', () => {
  const peakLean = (variant) => {
    const seq = makeSequence('squat', { reps: 5, variant });
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    let peak = -1;
    for (const f of seq.frames) {
      const sh = mid(f[LM.LEFT_SHOULDER], f[LM.RIGHT_SHOULDER]);
      const hip = mid(f[LM.LEFT_HIP], f[LM.RIGHT_HIP]);
      const dx = sh.x - hip.x, dy = sh.y - hip.y;
      const a = Math.abs(Math.atan2(dx, -dy) * 180 / Math.PI);
      if (a > peak) peak = a;
    }
    return peak;
  };
  const comp = peakLean('compensation');
  between(comp, 46.0, 47.0, `代償樣本峰值應在 46–47°（實測 46.42），實得 ${comp.toFixed(2)}`);
  assert(comp - 45 < 2.0, '餘裕不到 2°——此規則對真人資料很脆弱，不得在無真人資料下調鬆門檻');
  const clean = peakLean('clean');
  assert(clean < 1.0, `合成器的正常深蹲軀幹恆為打直（實得 ${clean.toFixed(2)}°）——`
    + '這代表「不會誤殺正常動作」在合成資料上是必然成立的，不能當作證據');
});
