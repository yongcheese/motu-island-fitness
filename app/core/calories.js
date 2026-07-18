// 熱量（METs 模型）與評級、金幣。pure。
// kcal = MET × 體重(kg) × 時間(hr)，並依達標率加權避免高估半程動作。
export function estimateCalories({ met, weightKg = 65, durationSec = 0, targetRate = 1 }) {
  const hours = durationSec / 3600;
  // 達標率加權：達標率低 → 動作強度折扣（下限 0.6 避免歸零）
  const weight = 0.6 + 0.4 * clamp01(targetRate);
  return met * weightKg * hours * weight;
}

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
