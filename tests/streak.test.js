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

// ── 連續天數的「過期」判定（2026-09-15 新增）──
//
// 抓到的問題：`state.streak.current` 只在 commitSession() 走 bumpStreak() 時更新，
// 而今日／健康兩個分頁直接讀它。使用者一旦停止訓練，畫面會永遠停在最後一次的數值。
// 實測（demo 資料）：最後活動日 2026-08-30、當日 2026-09-15 相隔 16 天，
// 今日分頁仍顯示「🔥 連續 1 天」。
//
// 修正：改由 store.derived.currentStreak() 取值，最後活動日非今天亦非昨天即回 0。
const iso = (offsetDays) => new Date(Date.now() - offsetDays * 864e5).toISOString().slice(0, 10);

/** 直接設定 streak 欄位以模擬「過去某天練過、之後沒再練」。 */
const setStreak = (lastActiveDate, current) => {
  store.reset();
  const st = store.getState();
  st.streak.lastActiveDate = lastActiveDate;
  st.streak.current = current;
  st.streak.longest = Math.max(st.streak.longest, current);
};

test('streak: 今天練過 → 連續天數照原值顯示', () => {
  setStreak(iso(0), 3);
  eq(store.derived.currentStreak(), 3, '最後活動日為今天，連續天數應維持');
});

test('streak: 昨天練過、今天還沒練 → 連續天數仍成立（今天可接續）', () => {
  setStreak(iso(1), 3);
  eq(store.derived.currentStreak(), 3,
    '昨天練過、今天尚未練，這條連續仍可由今天的訓練接續，此時顯示 0 會誤導使用者');
});

test('streak: 前天以前練過 → 連續已中斷，須歸零', () => {
  setStreak(iso(2), 3);
  eq(store.derived.currentStreak(), 0, '相隔 2 天，連續已中斷');
});

test('streak: 久未訓練 → 不得停在最後一次的數值（本次修正的實際情境）', () => {
  setStreak(iso(16), 1);
  eq(store.derived.currentStreak(), 0,
    '16 天未訓練仍顯示「連續 1 天」是修正前的行為，不得回歸');
});

test('streak: 從未訓練 → 0', () => {
  setStreak(null, 0);
  eq(store.derived.currentStreak(), 0, '無最後活動日時應為 0');
});

test('streak: longest 不受過期影響（歷史最佳紀錄應保留）', () => {
  setStreak(iso(16), 1);
  assert(store.getState().streak.longest >= 1, '歷史最長連續天數不應因當前中斷而歸零');
});
