import { test, eq, between, assert } from './harness.js';
import { createDetector } from '../app/core/engine.js';
import { EXERCISES } from '../app/core/exercises/index.js';
import { makeSequence } from '../app/core/synth.js';
import { LM } from '../app/core/landmarks.js';
import { bodyScale } from '../app/core/normalize.js';
import { TORSO_FOLD_RATIO } from '../app/core/exercises/squat.js';

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

// C-2：把註解裡宣稱的實測值變成會失敗的斷言，日後改動會在此處紅燈，註解不會默默失真。
// 2026-08-28 改寫：量測方式由「肩髖連線傾角」換為「軀幹投影長度比」。
// 舊版鎖的是 46.42° 側傾角 —— 那個量在正面機位對真實前傾恆為 0，鎖住它等於鎖住一個失效的數字。
test('squat: 軀幹前傾改用投影長度比後的判別餘裕（鎖住實測值）', () => {
  const minRatio = (variant) => {
    const seq = makeSequence('squat', { reps: 5, variant });
    let stand = null, min = 9;
    for (const f of seq.frames) {
      const t = bodyScale(f).torsoLength;
      if (stand === null) { stand = t; continue; }
      const r = t / stand;
      if (r < min) min = r;
    }
    return min;
  };
  const comp = minRatio('compensation');
  between(comp, 0.30, 0.40, `代償樣本投影比最低應在 0.30–0.40（實測 0.336），實得 ${comp.toFixed(3)}`);
  assert(TORSO_FOLD_RATIO - comp > 0.4,
    `門檻 ${TORSO_FOLD_RATIO} 與代償樣本 ${comp.toFixed(3)} 的餘裕應大於 0.4 —— `
    + '相較舊量測方式的 1.4°，此餘裕大得多，但仍須真人資料確認');

  const clean = minRatio('clean');
  assert(clean > 0.99,
    `合成器的正常深蹲軀幹恆為打直（實得投影比 ${clean.toFixed(3)}）——`
    + '這代表「不會誤殺正常動作」在合成資料上是必然成立的，不能當作證據。'
    + '真人正常深蹲的自然前傾使該比值落在約 0.96–1.06，與門檻 0.86 的實際餘裕未知。');
});

// —— 膝內夾（knee valgus）——
// 規則依據 NASM OHSA「膝蓋應與腳對齊」；門檻為待標定之工程值，故僅提示、不阻擋計次。

test('squat: 膝內夾樣本被辨識出 knee_valgus', () => {
  const { s } = run('squat', { reps: 5, variant: 'valgus' });
  const adv = Object.keys(s.advisoryCounts || {});
  assert(adv.includes('knee_valgus'), `應辨識出膝內夾，實得 [${adv}]`);
});

test('squat: 正常深蹲不觸發膝內夾（不得誤殺）', () => {
  for (const variant of ['clean', 'half', 'compensation']) {
    const { s } = run('squat', { reps: 5, variant });
    const n = (s.advisoryCounts || {}).knee_valgus || 0;
    eq(n, 0, `${variant} 不應出現膝內夾，實得 ${n} 次`);
  }
});

test('squat: 膝內夾不污染 faultCounts（無效原因統計須維持精確）', () => {
  const { s } = run('squat', { reps: 5, variant: 'valgus' });
  eq((s.faultCounts || {}).knee_valgus, undefined, 'advisory 不得混入無效原因統計');
});

test('squat: 膝內夾不阻擋計次（門檻未標定前不取消有效次數）', () => {
  const { s } = run('squat', { reps: 5, variant: 'valgus' });
  assert(s.validReps > 0, `膝內夾樣本的深度與軀幹皆正常，應仍計為有效，實得 ${s.validReps}`);
});

test('squat: 膝內夾判定在不同體型與鏡頭距離下一致（比值不受尺度影響）', () => {
  const base = run('squat', { reps: 5, variant: 'valgus' }).s.advisoryCounts.knee_valgus;
  for (const scale of [0.7, 1.15]) {
    const n = run('squat', { reps: 5, variant: 'valgus', scale }).s.advisoryCounts.knee_valgus || 0;
    assert(n > 0, `scale=${scale} 時應仍辨識出膝內夾，實得 ${n}`);
  }
  assert(base > 0, '基準組應有膝內夾');
});

test('squat: 腳踝不可信時不判膝內夾（踝距失真則比值無意義）', () => {
  const seq = makeSequence('squat', { reps: 3, variant: 'valgus' });
  for (const f of seq.frames) {
    f[LM.LEFT_ANKLE].visibility = 0.2;
    f[LM.RIGHT_ANKLE].visibility = 0.2;
  }
  const det = createDetector(EXERCISES.squat);
  let t = 0;
  for (const f of seq.frames) { det.update(f, t); t += seq.dtMs; }
  const n = (det.summary().advisoryCounts || {}).knee_valgus || 0;
  eq(n, 0, `腳踝不可信時不應判膝內夾，實得 ${n} 次`);
});
