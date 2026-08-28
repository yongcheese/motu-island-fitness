// 中央狀態（單一真實來源）+ localStorage 持久化 + 事件匯流排。
// 防刷鐵則：只有 commitSession() 能增加金幣/XP/history；UI 任何按鈕都不能直接加幣。
import { coinsFor, grade, shardsFor, ticketsFor } from '../core/rewards.js';

const KEY = 'island-fitness-ai/v1';
const SCHEMA = 1;

function todayISO() { return new Date().toISOString().slice(0, 10); }
function uid() { return Math.random().toString(36).slice(2, 10); }

function defaultState() {
  return {
    schema: SCHEMA,
    profile: { nickname: '島主', avatar: '🧑‍🚀', height_cm: 170, weight_kg: 65, age: 20, sex: 'unspecified' },
    prefs: { voice: true, bgm: false, difficulty: 'normal', mirror: true, colorMode: 'tricolor', dailyGoalMin: 20, weeklyGoalDays: 4, warmup: true },
    wallet: { coins: 80, xp: 0, level: 1 },
    island: {
      placed: [
        { id: uid(), type: 'cabin', x: 4, y: 4, rot: 0 },
        { id: uid(), type: 'tree', x: 2, y: 5, rot: 0 },
        { id: uid(), type: 'tree', x: 6, y: 3, rot: 0 },
      ],
      unlocked: ['cabin', 'tree', 'path', 'lamp', 'flower'],
    },
    streak: { current: 0, lastActiveDate: null, longest: 0 },
    // 一次性旗標：下一次結算是否套用雙倍金幣卡。需持久化（使用者可能用卡後才開始訓練，
    // 中途重整瀏覽器；卡已消耗掉，旗標不能跟著消失）。
    boost: { coinNext: false },
    history: [],
    achievements: [],
  };
}

function levelFromXp(xp) { return Math.floor(Math.sqrt(xp / 50)) + 1; }
function xpForLevel(level) { return 50 * (level - 1) * (level - 1); }

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = (typeof localStorage !== 'undefined') && localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (parsed.schema !== SCHEMA) return migrate(parsed);
    return { ...defaultState(), ...parsed };
  } catch { return defaultState(); }
}
function migrate(old) { const fresh = defaultState(); return { ...fresh, ...old, schema: SCHEMA }; }
function persist() {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota */ }
}
function emit() { persist(); for (const fn of listeners) fn(state); }

export const store = {
  getState: () => state,
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  // —— 唯一加幣入口（防刷）——
  commitSession(result) {
    // result: { exercise, durationSec, validReps, invalidReps, targetRate, faultCounts, met, baseCoinPerRep }
    // 輸入消毒：拒絕非有限/負值,避免 NaN/Infinity 汙染錢包並持久化到 localStorage（壞了整個 App）。
    const safeInt = (v) => Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
    const safeNum = (v) => Number.isFinite(v) && v > 0 ? v : 0;
    const validReps = safeInt(result.validReps);
    const invalidReps = safeInt(result.invalidReps);
    const durationSec = safeNum(result.durationSec);
    const met = safeNum(result.met);
    const baseCoinPerRep = safeNum(result.baseCoinPerRep);

    const total = validReps + invalidReps;
    const targetRate = total ? validReps / total : 0;
    const streakDays = bumpStreak(validReps);   // 只有當日有效次數達門檻才計入連續天數
    const baseCoins = coinsFor({ validReps, baseCoinPerRep, targetRate, streakDays });
    // 雙倍金幣卡：只對「這一次」生效，用完即清。
    // 放在結算內部而非另開介面，是為了維持「金幣的唯一產出點」這個結構性保證。
    const boosted = state.boost?.coinNext === true;
    const coins = boosted ? baseCoins * COIN_BOOST_MULTIPLIER : baseCoins;
    if (boosted) state.boost.coinNext = false;   // 生效次數為 1，不累積、不延續
    const g = grade({ targetRate, validRate: targetRate });
    const xpGain = validReps * 5;
    // 碎片與抽獎券：只算「本次獲得多少」並輸出，健身端不持有餘額 ——
    // 08/21 雙方議定由遊戲端儲存記帳。故此二值只進 session（單次結算結果），
    // 絕不可寫入 state.wallet 或任何持久化結構，否則即違反「不得回流成金幣或經驗值」的底線。
    const shards = shardsFor({ validReps });
    const tickets = ticketsFor({ validReps, targetRate });

    const session = {
      id: uid(), dateISO: new Date().toISOString(), date: todayISO(),
      exercise: result.exercise, exerciseName: result.exerciseName || result.exercise,
      durationSec: Math.round(durationSec),
      validReps, invalidReps,
      targetRate: +targetRate.toFixed(3),
      coinsEarned: coins, grade: g, faults: result.faultCounts || {},
      // —— 以下為純追加欄位，既有欄位的名稱／型別／語意一律不得更動 ——
      // commitSession() 的回傳值是將來遊戲端依賴的對外契約，改既有欄位會直接打斷對接。
      xpGain,            // 補上此欄以消除 UI 端重複推導 XP 公式的脆弱點（原 workout.js 自行乘 5）
      coinBoostApplied: boosted,   // 本次是否套用雙倍卡（供結算畫面說明金幣為何較多）
      shards, tickets,   // 本次獲得量，非餘額
    };
    state.history.push(session);
    state.wallet.coins += coins;
    state.wallet.xp += xpGain;
    state.wallet.level = levelFromXp(state.wallet.xp);
    checkAchievements();
    emit();
    return session;
  },

  /**
   * 遊戲端宣告使用一張已持有的雙倍金幣卡。
   * **不接受任何參數** —— 倍率與生效次數由健身端定義（見 COIN_BOOST_MULTIPLIER）。
   * 卡片的持有數管理在遊戲端，本端只記「下一次結算要不要加倍」。
   * @returns {boolean} true=旗標已設起；false=已經有一張生效中，不得疊加
   */
  consumeBoost() {
    if (state.boost.coinNext) return false;   // 不疊加：兩張卡不會變四倍
    state.boost.coinNext = true; emit(); return true;
  },
  /** 唯讀查詢，供遊戲端顯示「下一次結算將加倍」。 */
  isBoostArmed() { return state.boost.coinNext === true; },

  spendCoins(n) {
    if (!Number.isFinite(n) || n <= 0 || state.wallet.coins < n) return false;
    state.wallet.coins -= n; emit(); return true;
  },
  placeBuilding(b) {
    state.island.placed.push({ id: uid(), ...b }); emit();
  },
  moveBuilding(id, x, y) {
    const it = state.island.placed.find(p => p.id === id); if (it) { it.x = x; it.y = y; emit(); }
  },
  removeBuilding(id) {
    state.island.placed = state.island.placed.filter(p => p.id !== id); emit();
  },
  unlock(type) { if (!state.island.unlocked.includes(type)) { state.island.unlocked.push(type); emit(); } },

  updateProfile(p) { state.profile = { ...state.profile, ...p }; emit(); },
  updatePrefs(p) { state.prefs = { ...state.prefs, ...p }; emit(); },

  exportJSON() { return JSON.stringify(state, null, 2); },
  importJSON(json) { try { state = { ...defaultState(), ...JSON.parse(json), schema: SCHEMA }; emit(); return true; } catch { return false; } },
  reset() { state = defaultState(); emit(); },

  // 衍生資料
  derived: {
    xpForLevel, levelFromXp,
    xpProgress() {
      const lv = state.wallet.level;
      const cur = xpForLevel(lv), next = xpForLevel(lv + 1);
      return { cur: state.wallet.xp - cur, need: next - cur, ratio: (state.wallet.xp - cur) / (next - cur || 1) };
    },
  },
};

// 連續天數的門檻：當日累計「有效次數」需達此數，該日才算一天運動。
// 沒有這道門檻的話，開著訓練站著不動、等時間到自動結算，連續天數照樣 +1 ——
// 而遊戲端的簽到與輪盤獎勵都建立在這個欄位上，等於可以空轉刷獎勵。
// 5 為工程判斷（非文獻值）：足以排除零有效次數的空轉，又遠低於今日任務的 20，
// 不會誤傷「只做一點點但確實有動」的使用者。
export const STREAK_MIN_VALID_REPS = 5;

// —— 功能卡：雙倍金幣卡 ——
// 倍率與生效次數**寫死於健身端**，遊戲端只能宣告「用掉一張已持有的卡」，不得傳入數值。
// 理由：企劃書第四章寫明「介面中不存在增加金幣之方法」。若讓呼叫端指定倍率，
// 等於開了一條「遊戲端說幾倍就幾倍」的加值路徑，該承諾當場失效。
// ⚠️ 這不是「多給金幣」的功能，而是「同一次結算的產出乘以係數」——
// 金幣仍全數由 commitSession() 產出，沒有第二個入口。
// ⚠️ 經濟約束（已寫入企劃書）：功能卡的售價必須高於一次結算的金幣增量，
// 否則會形成「買卡 → 賺更多金幣 → 再買卡」的自我增殖迴圈。該定價由遊戲端負責。
export const COIN_BOOST_MULTIPLIER = 2;

/** 當日累計有效次數（含本次尚未寫入 history 的 session）。 */
function todayValidTotal(extraValidReps = 0) {
  const today = todayISO();
  let n = extraValidReps;
  for (const h of state.history) {
    if (h.date === today && Number.isFinite(h.validReps) && h.validReps > 0) n += h.validReps;
  }
  return n;
}

function bumpStreak(validRepsThisSession = 0) {
  const today = todayISO();
  const s = state.streak;
  if (s.lastActiveDate === today) return s.current;      // 今日已計入，不重複累加
  // 當日有效次數未達門檻 → 這一天還不算「有運動」，維持原連續天數不動
  if (todayValidTotal(validRepsThisSession) < STREAK_MIN_VALID_REPS) return s.current;
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  s.current = (s.lastActiveDate === yesterday) ? s.current + 1 : 1;
  s.lastActiveDate = today;
  s.longest = Math.max(s.longest, s.current);
  return s.current;
}

function checkAchievements() {
  const add = (id) => { if (!state.achievements.includes(id)) { state.achievements.push(id); store.unlock(ACH_UNLOCK[id]); } };
  const totalValid = state.history.reduce((a, h) => a + h.validReps, 0);
  if (state.history.length >= 1) add('first_workout');
  if (state.streak.current >= 7) add('streak7');
  if (totalValid >= 100) add('reps100');
  if (state.history.length >= 10) add('sessions10');
}
const ACH_UNLOCK = { first_workout: 'fountain', streak7: 'monument', reps100: 'gym', sessions10: 'tower' };
export const ACHIEVEMENTS = {
  first_workout: { name: '初次啟程', desc: '完成第一次訓練', icon: '🌱' },
  streak7: { name: '七日之約', desc: '連續運動 7 天', icon: '🔥' },
  reps100: { name: '百次達成', desc: '累積 100 次有效動作', icon: '💯' },
  sessions10: { name: '島嶼常客', desc: '完成 10 次訓練', icon: '🏝️' },
};
