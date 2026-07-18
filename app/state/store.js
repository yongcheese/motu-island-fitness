// 中央狀態（單一真實來源）+ localStorage 持久化 + 事件匯流排。
// 防刷鐵則：只有 commitSession() 能增加金幣/XP/history；UI 任何按鈕都不能直接加幣。
import { coinsFor, grade, estimateCalories } from '../core/calories.js';

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
    const streakDays = bumpStreak();
    const calories = estimateCalories({ met, weightKg: state.profile.weight_kg, durationSec, targetRate });
    const coins = coinsFor({ validReps, baseCoinPerRep, targetRate, streakDays });
    const g = grade({ targetRate, validRate: targetRate });
    const xpGain = validReps * 5;

    const session = {
      id: uid(), dateISO: new Date().toISOString(), date: todayISO(),
      exercise: result.exercise, exerciseName: result.exerciseName || result.exercise,
      durationSec: Math.round(durationSec),
      validReps, invalidReps,
      targetRate: +targetRate.toFixed(3), calories: +calories.toFixed(1),
      coinsEarned: coins, grade: g, faults: result.faultCounts || {},
    };
    state.history.push(session);
    state.wallet.coins += coins;
    state.wallet.xp += xpGain;
    state.wallet.level = levelFromXp(state.wallet.xp);
    checkAchievements();
    emit();
    return session;
  },

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

function bumpStreak() {
  const today = todayISO();
  const s = state.streak;
  if (s.lastActiveDate === today) return s.current;
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
