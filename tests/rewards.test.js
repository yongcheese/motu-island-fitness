// 結算獎勵：評級與金幣。
// 原 calories.test.js。熱量估算的兩條測試已隨該功能一併移除（2026-08-25）——
// 熱量由 METs 公式推算且無從驗證，已改以系統可精確判定的量取代。
import { test, eq, assert } from './harness.js';
import { grade, coinsFor } from '../app/core/rewards.js';

test('grade thresholds S/A/B/C', () => {
  eq(grade({ targetRate: 0.95, validRate: 0.95 }), 'S');
  eq(grade({ targetRate: 0.80, validRate: 0.80 }), 'A');
  eq(grade({ targetRate: 0.65, validRate: 0.65 }), 'B');
  eq(grade({ targetRate: 0.40, validRate: 0.40 }), 'C');
});

test('coinsFor: 零有效次數不產出金幣', () => {
  eq(coinsFor({ validReps: 0, baseCoinPerRep: 5, targetRate: 1, streakDays: 7 }), 0);
});

test('coinsFor: 達標率加成落在 0.8–1.2 倍之間', () => {
  const lo = coinsFor({ validReps: 10, baseCoinPerRep: 5, targetRate: 0, streakDays: 0 });
  const hi = coinsFor({ validReps: 10, baseCoinPerRep: 5, targetRate: 1, streakDays: 0 });
  eq(lo, 40, '達標率 0 → 0.8 倍');
  eq(hi, 60, '達標率 1 → 1.2 倍');
});

test('coinsFor: 連續天數加成上限 +14%（第 7 天封頂）', () => {
  const d7 = coinsFor({ validReps: 10, baseCoinPerRep: 5, targetRate: 1, streakDays: 7 });
  const d30 = coinsFor({ validReps: 10, baseCoinPerRep: 5, targetRate: 1, streakDays: 30 });
  eq(d7, d30, '超過 7 天不再增加');
  assert(d7 === Math.round(60 * 1.14), `應為 60×1.14，實得 ${d7}`);
});
