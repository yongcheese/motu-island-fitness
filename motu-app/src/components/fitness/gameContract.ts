/**
 * 健身頁 ↔ 遊戲端的資料契約（純函式，不碰存檔、不碰畫面）。
 *
 * 健身頁（`app/`，純 JS）和遊戲端各有一套資料形狀：健身頁的一次訓練是 `store.commitSession()`
 * 回傳的 session，遊戲端只聽得懂 `WorkoutCompletion`、只從 `UserProfile` 讀餘額。這個檔案是兩者
 * 之間唯一的翻譯層，三件事：
 *
 *   1. 遊戲存檔 → 健身頁要顯示的數字（{@link balancesFromProfile}）
 *   2. 一次訓練 → 遊戲端的完成事件（{@link completionFromSession}）
 *   3. 遊戲端算出的金額 → 領獎演出的順序（{@link awardQueue}）
 *
 * 金額怎麼算一律交給遊戲端（`payoutForWorkout`、`fragmentsForWorkout`），這裡不寫任何經濟規則 ——
 * 看板架構決策 5「資源怎麼發是遊戲端的事」。
 *
 * 規格由 `scripts/test-fitness-contract.ts` 鎖住（`npm run test:fitness`）。
 */
import { getBalance } from '../../constants/currency';
import type { WorkoutCompletion, WorkoutPayout } from '../../constants/workoutRewards';
import { makeWorkoutCompletion } from '../../lib/workoutCompletion';
import type { UserProfile } from '../../types';
import { profileLevel } from '../../utils/level';

// --- 1. 餘額 -----------------------------------------------------------------

/** 健身頁資源列看得懂的數字。 */
export interface FitnessBalances {
  coins: number;
  fragments: number;
  xp: number;
  level: number;
}

/**
 * 從遊戲存檔讀出健身頁要顯示的餘額。
 *
 * 金幣、碎片走遊戲端唯一的讀取器 `getBalance`（它已處理舊存檔、缺欄位、NaN）；等級走 `profileLevel`。
 * profile 還沒載入（null）時全部回 0 —— 連等級也是 0，因為「還沒有玩家」不是「LV.1 的玩家」。
 */
export function balancesFromProfile(profile: UserProfile | null | undefined): FitnessBalances {
  if (!profile) return { coins: 0, fragments: 0, xp: 0, level: 0 };
  const xp = profile.currentXp;
  return {
    coins: getBalance(profile, 'coins'),
    fragments: getBalance(profile, 'fragments'),
    xp: typeof xp === 'number' && Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0,
    level: profileLevel(profile),
  };
}

// --- 2. 完成事件 -------------------------------------------------------------

/** 訓練是怎麼計次的：相機真人判定、示範動畫、或手動計數。 */
export type FitnessMode = 'camera' | 'demo' | 'manual';

/**
 * 健身頁一次訓練的結果 —— `store.commitSession()` 回傳值中本契約會讀的欄位，外加計次方式 `mode`。
 *
 * `mode` 不在 commitSession 的回傳值裡（我方 store 不知道是用什麼計次的），由呼叫端（訓練頁結束時）
 * 從 `live.mode` 補上。
 */
export interface FitnessSession {
  /** commitSession 發的 id；有的話用來組 workoutId，讓同一次訓練重送也會被遊戲端去重。 */
  id?: string;
  /** ISO 8601 完成時間。 */
  dateISO?: string;
  /** 動作 id，例如 `squat`。 */
  exercise: string;
  /** 動作中文名，例如「深蹲」—— 遊戲端健康頁拿它做字串比對，所以優先用它。 */
  exerciseName?: string;
  /** 實際訓練秒數（不含休息）。 */
  durationSec: number;
  /** AI 判定的有效次數。 */
  validReps: number;
  mode?: FitnessMode;
}

/**
 * 一次訓練 → 遊戲端的 `WorkoutCompletion`。不是相機真人計次的訓練回傳 `null`，不發獎。
 *
 * - `repCount` 只算**有效次數**（無效次數不給錢）；
 * - 只有 `mode === 'camera'` 才發獎。沒標 `mode` 也視為不發 —— 寧可漏發也不讓示範動畫刷錢，
 *   這是藍圖「只統計相機真人」；
 * - `source` 標 `'prototype'`：遊戲端的 `WorkoutSource` 只有 prototype／external-api／admin-test，
 *   沒有「AI 相機」這一項，而遊戲組原始碼不歸我們改（看板不變量 5）。它和遊戲組原本的健身原型
 *   `FitnessView` 用的是同一個值，遊戲端本來就不依 source 分流。
 * - 0 下有效也回傳 `null`：REQUIREMENT 第 6 節第 7 條「0 下有效則跳過領獎直接進結算」。
 *   遊戲端 `payoutForWorkout` 會依秒數照給金幣經驗，若仍送出完成事件，就會變成錢入帳卻沒有領獎演出，
 *   所以在契約這層擋下，而不是只跳過動畫。
 */
export function completionFromSession(
  session: FitnessSession | null | undefined,
  userId: string,
): WorkoutCompletion | null {
  if (!session || session.mode !== 'camera' || !userId) return null;
  const reps = Number.isFinite(session.validReps) ? Math.max(0, Math.floor(session.validReps)) : 0;
  if (reps === 0) return null;
  const seconds = Number.isFinite(session.durationSec) ? Math.max(0, session.durationSec) : 0;
  const completedAt = session.dateISO && !Number.isNaN(Date.parse(session.dateISO))
    ? session.dateISO
    : undefined;
  return makeWorkoutCompletion({
    userId,
    workoutType: session.exerciseName || session.exercise,
    durationSeconds: seconds,
    repCount: reps,
    source: 'prototype',
    ...(session.id ? { workoutId: `fx-${session.id}` } : {}),
    ...(completedAt ? { completedAt } : {}),
  });
}

// --- 3. 領獎順序 -------------------------------------------------------------

export type AwardKind = 'coins' | 'xp' | 'fragments';

/** 領獎演出的一項。 */
export interface Award {
  kind: AwardKind;
  amount: number;
}

const AWARD_ORDER: readonly AwardKind[] = ['coins', 'xp', 'fragments'];

/**
 * 遊戲端算出的金額 → 逐項領獎的順序：金幣 → 經驗 → 碎片。
 *
 * 數量是 0（或不是正數）的項目剔除；全部剔除就回 `[]`，呼叫端據此跳過領獎直接進結算。
 * 數量取整數（遊戲端的貨幣全是整數）。
 */
export function awardQueue({
  payout,
  fragments,
}: {
  payout: WorkoutPayout | null | undefined;
  fragments: number | null | undefined;
}): Award[] {
  const amounts: Record<AwardKind, number | null | undefined> = {
    coins: payout?.coins,
    xp: payout?.xp,
    fragments,
  };
  const queue: Award[] = [];
  for (const kind of AWARD_ORDER) {
    const value = amounts[kind];
    const amount = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
    if (amount > 0) queue.push({ kind, amount });
  }
  return queue;
}
