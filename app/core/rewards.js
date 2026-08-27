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

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
