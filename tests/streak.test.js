// C-4：連續天數必須代表「連續運動天數」。
// 修正前 bumpStreak() 在 commitSession() 中無條件呼叫——開著訓練站著不動、等時間到自動結算，
// 連續天數照樣 +1。而遊戲端的簽到與輪盤獎勵將建立在這個欄位上，等於可以空轉刷獎勵。
import { test, eq, assert } from './harness.js';
import { store, STREAK_MIN_VALID_REPS } from '../app/state/store.js';

const mk = (validReps, invalidReps = 0) => ({
  exercise: 'squat', exerciseName: '深蹲', durationSec: 60,
  validReps, invalidReps, targetRate: 1, faultCounts: {}, met: 5.4, baseCoinPerRep: 1,
});
const reset = () => store.reset();

test('streak: 零有效次數的空轉不得增加連續天數', () => {
  reset();
  eq(store.getState().streak.current, 0, '初始為 0');
  store.commitSession(mk(0, 12));           // 站著不動，全部無效
  eq(store.getState().streak.current, 0, '空轉後仍為 0');
  eq(store.getState().streak.lastActiveDate, null, '不得標記為已運動日');
});

test('streak: 有效次數未達門檻時不計入', () => {
  reset();
  store.commitSession(mk(STREAK_MIN_VALID_REPS - 1));
  eq(store.getState().streak.current, 0, `${STREAK_MIN_VALID_REPS - 1} 次未達門檻`);
});

test('streak: 有效次數達門檻即計入', () => {
  reset();
  store.commitSession(mk(STREAK_MIN_VALID_REPS));
  eq(store.getState().streak.current, 1);
  eq(store.getState().streak.longest, 1, '最長紀錄同步更新');
});

test('streak: 同日多次少量訓練可累積達標', () => {
  reset();
  store.commitSession(mk(2));
  eq(store.getState().streak.current, 0, '第一次 2 下不足');
  store.commitSession(mk(2));
  eq(store.getState().streak.current, 0, '累計 4 下仍不足');
  store.commitSession(mk(2));
  eq(store.getState().streak.current, 1, '累計 6 下達門檻');
});

test('streak: 同日達標後再訓練不重複累加', () => {
  reset();
  store.commitSession(mk(20));
  store.commitSession(mk(20));
  store.commitSession(mk(20));
  eq(store.getState().streak.current, 1, '同一天只能算一天');
});

test('streak: 空轉不得污染當日累計判定的正確性', () => {
  reset();
  store.commitSession(mk(0, 30));           // 大量無效次數
  store.commitSession(mk(0, 30));
  eq(store.getState().streak.current, 0, '無效次數再多也不算運動');
  store.commitSession(mk(STREAK_MIN_VALID_REPS));
  eq(store.getState().streak.current, 1, '補上有效次數後才計入');
});

test('streak: 金幣的連續天數加成不得因空轉而提高', () => {
  reset();
  const a = store.commitSession(mk(0, 10)).coinsEarned;
  eq(a, 0, '零有效次數不產出金幣');
  eq(store.getState().streak.current, 0, '且不推高連續天數');
});

test('streak: 達標日的紀錄仍完整寫入 history（門檻只影響 streak）', () => {
  reset();
  store.commitSession(mk(2));
  eq(store.getState().history.length, 1, '未達門檻的訓練仍要記錄');
  assert(store.getState().history[0].validReps === 2, '有效次數如實保存');
});
