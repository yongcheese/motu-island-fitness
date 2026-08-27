// 結算獎勵：評級與金幣。pure。
//
// 原 calories.js。熱量估算（METs 模型）已於 2026-08-25 移除——該數字由公式推算，
// 未納入個體代謝差異，亦無心率或攝氧量佐證，屬本系統無法驗證的量；
// 對外量化資料一律改用系統可精確判定的項目（有效次數、達標率、錯誤分佈）。
export function grade({ targetRate = 0, validRate = 0 }) {
  const score = (targetRate + validRate) / 2;
  if (score >= 0.9) return 'S';
  if (score >= 0.75) return 'A';
  if (score >= 0.6) return 'B';
  return 'C';
}

// 金幣只由結算（已通過 AI 有效判定）產生。
export function coinsFor({ validReps = 0, baseCoinPerRep = 5, targetRate = 1, streakDays = 0 }) {
  const base = validReps * baseCoinPerRep;
  const quality = 0.8 + 0.4 * clamp01(targetRate); // 0.8~1.2 倍
  const streakBonus = Math.min(streakDays, 7) * 0.02; // 連續最多 +14%
  return Math.round(base * quality * (1 + streakBonus));
}

// —— 碎片與抽獎券：遊戲端資源，健身端只算「本次獲得多少」並輸出 ——
//
// ⚠️ 以下發放規則為**暫定值，尚未與遊戲組議定**。
// 《現狀盤點與改善規劃》E-7 明載「發放規則須與遊戲組共同定義（每次訓練？達標才給？）」，
// 已列入《0828 會議待確認清單》第三節。議定後只需改動本區塊的三個常數與這兩個函式，
// store 與 UI 皆不受影響。
//
// 兩條有依據的設計前提（08/21 兩組會議議定，非暫定）：
//   1. 健身端**不持有餘額** —— 碎片與抽獎券由遊戲端儲存記帳，本檔只回傳單次數量。
//   2. 抽獎券綁「達標」而非「有參與就給」 —— 議定之抽獎券來源為「簽到、每日／每週任務、
//      **健身目標達成**」，且遊戲組 F20 自述其用意為「引導玩家實際運動而非僅上線簽到」。
//      因此以達標為前提，比每次訓練都發放更貼近雙方已議定的意圖。
//   （下列三個數字本身則無依據，純為暫定占位值。）

export const SHARD_PER_VALID_REPS = 10;    // 暫定：每 N 次有效動作換 1 個碎片
export const TICKET_MIN_VALID_REPS = 10;   // 暫定：發放抽獎券的最低有效次數
export const TICKET_MIN_TARGET_RATE = 0.7; // 暫定：發放抽獎券的最低達標率

/** 本次訓練獲得的碎片數。純函式，不讀寫任何狀態。 */
export function shardsFor({ validReps = 0 } = {}) {
  return Math.floor(safeCount(validReps) / SHARD_PER_VALID_REPS);
}

/** 本次訓練獲得的抽獎券數。純函式，不讀寫任何狀態。 */
export function ticketsFor({ validReps = 0, targetRate = 0 } = {}) {
  if (safeCount(validReps) < TICKET_MIN_VALID_REPS) return 0;
  if (safeRate(targetRate) < TICKET_MIN_TARGET_RATE) return 0;
  return 1;
}

// 輸入消毒：NaN／Infinity／負數一律歸零，避免污染回傳值後被遊戲端記帳。
function safeCount(v) { return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0; }
function safeRate(v) { return Number.isFinite(v) && v > 0 ? clamp01(v) : 0; }

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
