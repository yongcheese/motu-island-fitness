// 動作卡上的「預估金幣」必須接近使用者做完一輪實際拿到的數字。
//
// 2026-09-19 修正前：卡片寫死 `baseCoinPerRep * 10`，等於假設一輪只做 10 下。
// 實際一輪是 3 組（深蹲 3×12=36 下、高抬腿 3×30=90 下），於是：
//   深蹲 卡片 ≈100 ／ 實際 432（差 4.3 倍）
//   高抬腿 卡片 ≈50 ／ 實際 540（差 10.8 倍）
// 而且舊寫法完全不吃難度設定，切到困難模式差得更多。
import { test, eq, assert } from './harness.js';
import { EXERCISES } from '../app/core/exercises/index.js';
import { planFor } from '../app/core/difficulty.js';
import { coinsFor } from '../app/core/rewards.js';

/** 與 workout.js 的 estimateRoundCoins 同式：整輪全有效的上限。 */
const estimate = (e, level) => {
  const plan = planFor(e.meta, level);
  return coinsFor({
    validReps: plan.sets * plan.repsPerSet,
    baseCoinPerRep: e.baseCoinPerRep, targetRate: 1, streakDays: 0,
  });
};

test('普通難度：估算值與實際結算一致（不再是 baseCoinPerRep×10）', () => {
  eq(estimate(EXERCISES.squat, 'normal'), 432);
  eq(estimate(EXERCISES.highknees, 'normal'), 540);
  // 對照舊寫法，證明這確實是個大幅修正而非微調
  assert(estimate(EXERCISES.squat, 'normal') > EXERCISES.squat.baseCoinPerRep * 10 * 3,
    '深蹲估算應遠高於舊的 ≈100');
  assert(estimate(EXERCISES.highknees, 'normal') > EXERCISES.highknees.baseCoinPerRep * 10 * 8,
    '高抬腿估算應遠高於舊的 ≈50');
});

test('估算值跟著難度變動（舊寫法完全不吃難度）', () => {
  for (const id of ['squat', 'jumpingjack', 'highknees', 'pushup']) {
    const e = EXERCISES[id];
    const easy = estimate(e, 'easy');
    const normal = estimate(e, 'normal');
    const hard = estimate(e, 'hard');
    assert(easy < normal && normal < hard,
      `${e.name}：簡單 ${easy} < 普通 ${normal} < 困難 ${hard} 應成立`);
  }
});

test('四個動作在三種難度下皆為正整數，不得出現 NaN', () => {
  for (const id of ['squat', 'jumpingjack', 'highknees', 'pushup']) {
    for (const lv of ['easy', 'normal', 'hard']) {
      const v = estimate(EXERCISES[id], lv);
      assert(Number.isInteger(v) && v > 0, `${id}/${lv} 得到 ${v}`);
    }
  }
});

test('meta 缺欄位時走 planFor 的保底值，不回 NaN', () => {
  const broken = { baseCoinPerRep: 5, meta: {} };
  const v = estimate(broken, 'normal');
  assert(Number.isInteger(v) && v > 0, `保底值應算得出數字，實得 ${v}`);
  // planFor 的 FALLBACK 是 3 組 × 10 下 = 30 次
  eq(v, coinsFor({ validReps: 30, baseCoinPerRep: 5, targetRate: 1, streakDays: 0 }));
});

test('未知難度回退 normal，不當掉', () => {
  eq(estimate(EXERCISES.squat, 'nonsense'), estimate(EXERCISES.squat, 'normal'));
  eq(estimate(EXERCISES.squat, undefined), estimate(EXERCISES.squat, 'normal'));
});

test('估算為上限：真實結算不會超過它（達標率 100%、無連續加成時相等）', () => {
  const e = EXERCISES.squat;
  const plan = planFor(e.meta, 'normal');
  const reps = plan.sets * plan.repsPerSet;
  const perfect = coinsFor({ validReps: reps, baseCoinPerRep: e.baseCoinPerRep, targetRate: 1, streakDays: 0 });
  const sloppy = coinsFor({ validReps: reps, baseCoinPerRep: e.baseCoinPerRep, targetRate: 0.6, streakDays: 0 });
  eq(perfect, estimate(e, 'normal'));
  assert(sloppy < perfect, '達標率較低時實際金幣應低於上限估算');
});
