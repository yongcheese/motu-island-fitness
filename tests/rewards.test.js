// 結算獎勵：評級與金幣。
// 原 calories.test.js。熱量估算的兩條測試已隨該功能一併移除（2026-08-25）——
// 熱量由 METs 公式推算且無從驗證，已改以系統可精確判定的量取代。
import { test, eq, assert } from './harness.js';
import {
  grade, coinsFor, shardsFor, ticketsFor,
  SHARD_PER_VALID_REPS, TICKET_MIN_VALID_REPS, TICKET_MIN_TARGET_RATE,
} from '../app/core/rewards.js';

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

// —— 碎片與抽獎券（Slice 1）——
// 規則本身是暫定值，但「零有效次數不得發放」與「輸入消毒」兩條是不變量，不隨議定改變。

test('shardsFor: 零有效次數不產出碎片', () => {
  eq(shardsFor({ validReps: 0 }), 0);
});

test('shardsFor: 每 SHARD_PER_VALID_REPS 次換一個，不足者無條件捨去', () => {
  eq(shardsFor({ validReps: SHARD_PER_VALID_REPS - 1 }), 0, '未滿一份不給');
  eq(shardsFor({ validReps: SHARD_PER_VALID_REPS }), 1);
  eq(shardsFor({ validReps: SHARD_PER_VALID_REPS * 3 + 5 }), 3, '餘數不進位');
});

test('shardsFor: NaN／Infinity／負數一律回傳 0 且不拋例外', () => {
  for (const bad of [NaN, Infinity, -Infinity, -5, undefined, null, '10']) {
    eq(shardsFor({ validReps: bad }), 0, `輸入 ${String(bad)} 應得 0`);
  }
  eq(shardsFor(), 0, '完全不傳參數也不應拋例外');
});

test('ticketsFor: 未達有效次數門檻不發放', () => {
  eq(ticketsFor({ validReps: TICKET_MIN_VALID_REPS - 1, targetRate: 1 }), 0);
});

test('ticketsFor: 未達達標率門檻不發放（有做但做不對，不給獎勵）', () => {
  eq(ticketsFor({ validReps: TICKET_MIN_VALID_REPS * 5, targetRate: TICKET_MIN_TARGET_RATE - 0.01 }), 0);
});

test('ticketsFor: 兩項門檻皆達成才發放', () => {
  eq(ticketsFor({ validReps: TICKET_MIN_VALID_REPS, targetRate: TICKET_MIN_TARGET_RATE }), 1);
});

test('ticketsFor: NaN／Infinity／負數一律回傳 0 且不拋例外', () => {
  for (const bad of [NaN, Infinity, -1, undefined, null]) {
    eq(ticketsFor({ validReps: bad, targetRate: 1 }), 0, `validReps=${String(bad)} 應得 0`);
    eq(ticketsFor({ validReps: 100, targetRate: bad }), 0, `targetRate=${String(bad)} 應得 0`);
  }
  eq(ticketsFor(), 0, '完全不傳參數也不應拋例外');
});

test('shardsFor／ticketsFor 為純函式：同輸入必同輸出，且不改動傳入物件', () => {
  const input = { validReps: 37, targetRate: 0.85 };
  const snapshot = JSON.stringify(input);
  const s1 = shardsFor(input), s2 = shardsFor(input);
  const t1 = ticketsFor(input), t2 = ticketsFor(input);
  eq(s1, s2, '碎片：兩次呼叫結果應相同');
  eq(t1, t2, '抽獎券：兩次呼叫結果應相同');
  eq(JSON.stringify(input), snapshot, '不得改動傳入的物件');
});
