// checklist 擴充：依各動作的判準全集補上六項判定。
//
// 全部設為 advisory（提示、不取消有效次數），理由一致：
// 這六項的**規則**有依據（BSA／AFT／NASM／教學材料），但**門檻數值**全為工程判斷、
// 未經真人樣本標定。門檻沒標定就不該據以取消使用者的有效次數。
//
// 每一項都以「正常樣本不誤報 ＋ 錯誤樣本抓得到」成對驗證 ——
// 只測抓得到而不測不誤報，是無效的測試（誤殺比漏抓更傷使用者）。
import { test, eq, assert } from './harness.js';
import { makeSequence } from '../app/core/synth.js';
import { createDetector, TEMPO_MIN_RATIO } from '../app/core/engine.js';
import { EXERCISES } from '../app/core/exercises/index.js';
import { HEAD_TILT_RATIO, HIP_UNEVEN_RATIO } from '../app/core/exercises/squat.js';
import { LOCKOUT_ANGLE, HEAD_FORWARD_RATIO } from '../app/core/exercises/pushup.js';
import { TORSO_UPRIGHT_RATIO } from '../app/core/exercises/highknees.js';

const run = (id, opts) => {
  const seq = makeSequence(id, { reps: 5, ...opts });
  const d = createDetector(EXERCISES[id]);
  let t = 0;
  for (const f of seq.frames) { d.update(f, t); t += seq.dtMs; }
  return d.summary();
};
const adv = (s, k) => (s.advisoryCounts || {})[k] || 0;

// —— 深蹲：頭部側傾（BSA ①）——
test('checklist: 頭部側傾抓得到，正常樣本不誤報', () => {
  eq(adv(run('squat', { variant: 'clean', tempoRatio: 3 }), 'head_tilt'), 0, '正常深蹲不得誤報頭部側傾');
  assert(adv(run('squat', { variant: 'headtilt', tempoRatio: 3 }), 'head_tilt') > 0, '側傾樣本應被抓到');
});

// —— 深蹲：骨盆水平（BSA ④）——
test('checklist: 骨盆傾斜抓得到，正常樣本不誤報', () => {
  eq(adv(run('squat', { variant: 'clean', tempoRatio: 3 }), 'hip_uneven'), 0, '正常深蹲不得誤報骨盆傾斜');
  assert(adv(run('squat', { variant: 'hipuneven', tempoRatio: 3 }), 'hip_uneven') > 0, '傾斜樣本應被抓到');
});

// —— 深蹲：動作節奏（BSA ⑩）——
test('checklist: 下蹲過快抓得到，節奏正常不誤報', () => {
  eq(adv(run('squat', { variant: 'clean', tempoRatio: TEMPO_MIN_RATIO + 1 }), 'tempo_fast'), 0,
    `下蹲:上升 = ${TEMPO_MIN_RATIO + 1}:1 屬正常，不得誤報`);
  assert(adv(run('squat', { variant: 'clean', tempoRatio: 1 }), 'tempo_fast') > 0,
    '1:1（下放與推起等速）應被提示');
});

test('checklist: 節奏越慢提示越少（單調性，非硬編特定值）', () => {
  // 刻意不測門檻邊界：引擎量到的是週期內的兩段，與合成器的幀數比有系統性偏差
  // （實測真實 2.0 → 引擎 1.875），且 signal 經 5 幀平滑，邊界值不穩定。
  // 改測單調性 —— 這才是「判定確實隨節奏變化」的證據。
  const counts = [1, 2, 3, 4].map((r) => adv(run('squat', { variant: 'clean', tempoRatio: r }), 'tempo_fast'));
  for (let i = 1; i < counts.length; i++) {
    assert(counts[i] <= counts[i - 1],
      `節奏越慢提示應越少或持平，實得 ${counts}（index ${i} 反而變多）`);
  }
  assert(counts[0] > 0, '1:1（下放與推起等速）應有提示');
  assert(counts[counts.length - 1] === 0, '4:1（充分控制離心）不應有提示');
});

// —— 伏地挺身：頂點伸展（AFT）——
test('checklist: 頂點未伸直抓得到，正常樣本不誤報', () => {
  eq(adv(run('pushup', { variant: 'clean' }), 'no_lockout'), 0, '正常伏地挺身不得誤報');
  assert(adv(run('pushup', { variant: 'nolockout' }), 'no_lockout') > 0, '未伸直樣本應被抓到');
});

test('checklist: 頂點伸展的判定在動作之間進行（非週期內）', () => {
  // 這條鎖住一個容易踩的坑：動作週期由 attemptEnter 起、readyReturn 止，
  // 而「手臂完全伸直」是 READY 的起始姿勢，週期內根本觀察不到。
  // 若有人把判定改回週期內逐幀檢查，正常樣本會開始誤報，這裡就會紅。
  const clean = run('pushup', { variant: 'clean' });
  eq(adv(clean, 'no_lockout'), 0);
  assert(clean.validReps === 5, '前提：正常樣本應完成 5 次');
  // 未伸直樣本的動作仍然成立（能計次），只是被提示
  const bad = run('pushup', { variant: 'nolockout' });
  assert(bad.validReps > 0, '未伸直不取消有效次數（advisory）');
});

// —— 伏地挺身：頭頸前伸（NASM）——
test('checklist: 頭頸前伸抓得到，正常樣本不誤報', () => {
  eq(adv(run('pushup', { variant: 'clean' }), 'head_forward'), 0, '正常伏地挺身不得誤報');
  assert(adv(run('pushup', { variant: 'headfwd' }), 'head_forward') > 0, '前伸樣本應被抓到');
});

// —— 高抬腿：軀幹挺直 ——
test('checklist: 高抬腿軀幹前傾抓得到，正常樣本不誤報', () => {
  eq(adv(run('highknees', { variant: 'clean' }), 'torso_lean'), 0, '正常高抬腿不得誤報');
  assert(adv(run('highknees', { variant: 'torsolean' }), 'torso_lean') > 0, '前傾樣本應被抓到');
});

// —— 共同性質：全部為 advisory ——
test('checklist: 六項新判定一律不取消有效次數（門檻未標定前的一致處置）', () => {
  const cases = [
    ['squat', { variant: 'headtilt', tempoRatio: 3 }],
    ['squat', { variant: 'hipuneven', tempoRatio: 3 }],
    ['squat', { variant: 'clean', tempoRatio: 1 }],
    ['pushup', { variant: 'nolockout' }],
    ['pushup', { variant: 'headfwd' }],
    ['highknees', { variant: 'torsolean' }],
  ];
  for (const [id, opts] of cases) {
    const s = run(id, opts);
    assert(s.validReps > 0, `${id}/${opts.variant} 應仍計為有效 —— 這六項是提示不是阻擋`);
  }
});

test('checklist: 新判定不得混入 faultCounts（無效原因統計須維持精確）', () => {
  const keys = ['head_tilt', 'hip_uneven', 'tempo_fast', 'no_lockout', 'head_forward'];
  for (const [id, opts] of [['squat', { variant: 'headtilt', tempoRatio: 3 }],
    ['squat', { variant: 'hipuneven', tempoRatio: 3 }], ['pushup', { variant: 'nolockout' }]]) {
    const fc = run(id, opts).faultCounts || {};
    for (const k of keys) {
      eq(fc[k], undefined, `${k} 屬 advisory，不得出現在 faultCounts`);
    }
  }
});

test('checklist: 門檻常數皆為合理範圍（防手殘改壞）', () => {
  assert(HEAD_TILT_RATIO > 0 && HEAD_TILT_RATIO < 1, `頭部側傾門檻應在 (0,1)，實得 ${HEAD_TILT_RATIO}`);
  assert(HIP_UNEVEN_RATIO > 0 && HIP_UNEVEN_RATIO < 1, `骨盆門檻應在 (0,1)，實得 ${HIP_UNEVEN_RATIO}`);
  assert(LOCKOUT_ANGLE > 90 && LOCKOUT_ANGLE <= 180, `伸展角度應在 (90,180]，實得 ${LOCKOUT_ANGLE}`);
  assert(HEAD_FORWARD_RATIO > 0, `頭頸前伸門檻應為正，實得 ${HEAD_FORWARD_RATIO}`);
  assert(TORSO_UPRIGHT_RATIO > 0 && TORSO_UPRIGHT_RATIO < 1, `軀幹門檻應在 (0,1)，實得 ${TORSO_UPRIGHT_RATIO}`);
  assert(TEMPO_MIN_RATIO >= 1, `節奏比應 >= 1，實得 ${TEMPO_MIN_RATIO}`);
});

test('checklist: 判定在不同體型與鏡頭距離下仍成立（比值不受尺度影響）', () => {
  for (const scale of [0.7, 1.15]) {
    assert(adv(run('squat', { variant: 'headtilt', tempoRatio: 3, scale }), 'head_tilt') > 0,
      `scale=${scale} 時頭部側傾應仍被抓到`);
    assert(adv(run('squat', { variant: 'hipuneven', tempoRatio: 3, scale }), 'hip_uneven') > 0,
      `scale=${scale} 時骨盆傾斜應仍被抓到`);
    eq(adv(run('squat', { variant: 'clean', tempoRatio: 3, scale }), 'head_tilt'), 0,
      `scale=${scale} 時正常樣本仍不得誤報`);
  }
});

// —— 設計限制的防護 ——
test('checklist: 交替動作不得使用 checksLockout（設計限制）', () => {
  // lockoutSeen / lockoutPending 是 detector 層級的單一狀態，不支援 L/R 兩條 track。
  // 交替時一側結束的瞬間另一側往往已開始，active 恆為 true，lockoutSeen 永遠更新不到。
  // 這條測試鎖住「目前沒有交替動作使用它」這個前提；若日後有人加上去，這裡會紅，
  // 提醒必須先把該狀態改為 per-track。
  for (const [id, spec] of Object.entries(EXERCISES)) {
    if (spec.mode === 'alternating' || spec.alt) {
      eq(spec.checksLockout, undefined,
        `${id} 是交替動作，不得使用 checksLockout —— 需先改為 per-track 狀態`);
    }
  }
});

test('checklist: reset() 清乾淨 lockout 的狀態', () => {
  const d = createDetector(EXERCISES.pushup);
  const seq = makeSequence('pushup', { reps: 3, variant: 'nolockout' });
  let t = 0;
  for (const f of seq.frames) { d.update(f, t); t += seq.dtMs; }
  assert((d.summary().advisoryCounts || {}).no_lockout > 0, '前提：應先累積提示');

  d.reset();
  eq((d.summary().advisoryCounts || {}).no_lockout, undefined, 'reset 後統計應清空');

  // reset 後跑正常樣本，不得被前一輪污染
  const clean = makeSequence('pushup', { reps: 3, variant: 'clean' });
  t = 0;
  for (const f of clean.frames) { d.update(f, t); t += clean.dtMs; }
  eq((d.summary().advisoryCounts || {}).no_lockout, undefined,
    'reset 後的正常樣本不得因前一輪殘留而誤報');
});

test('checklist: reset() 後 tempo 狀態不跨輪污染', () => {
  const d = createDetector(EXERCISES.squat);
  // 先跑一輪過快的，累積 tempo 提示
  const fast = makeSequence('squat', { reps: 3, variant: 'clean', tempoRatio: 1 });
  let t = 0;
  for (const f of fast.frames) { d.update(f, t); t += fast.dtMs; }
  assert((d.summary().advisoryCounts || {}).tempo_fast > 0, '前提：應先累積 tempo 提示');

  d.reset();
  eq((d.summary().advisoryCounts || {}).tempo_fast, undefined, 'reset 後統計應清空');

  // reset 後跑節奏正常的，不得被前一輪的 tStart/tPeak 殘留影響
  const slow = makeSequence('squat', { reps: 3, variant: 'clean', tempoRatio: 4 });
  t = 0;
  for (const f of slow.frames) { d.update(f, t); t += slow.dtMs; }
  eq((d.summary().advisoryCounts || {}).tempo_fast, undefined,
    'reset 後的正常節奏樣本不得誤報');
});

test('checklist: 最後一次動作的頂點伸展也會被檢查（summary 補算）', () => {
  const bad = makeSequence('pushup', { reps: 3, variant: 'nolockout' });
  const d = createDetector(EXERCISES.pushup);
  let t = 0;
  for (const f of bad.frames) { d.update(f, t); t += bad.dtMs; }
  eq((d.summary().advisoryCounts || {}).no_lockout, 3,
    '三次動作應全數被檢查 —— 最後一次由 summary() 補算，不因沒有下一次而漏掉');

  // summary() 可能被多次呼叫，不得重複累加
  eq(d.summary().advisoryCounts.no_lockout, 3, '重複呼叫 summary() 結果須一致');
  eq(d.summary().advisoryCounts.no_lockout, 3);

  // 正常樣本不因補算而誤報
  const ok = createDetector(EXERCISES.pushup);
  const clean = makeSequence('pushup', { reps: 3, variant: 'clean' });
  t = 0;
  for (const f of clean.frames) { ok.update(f, t); t += clean.dtMs; }
  eq((ok.summary().advisoryCounts || {}).no_lockout, undefined, '正常樣本補算後仍不得誤報');
});
