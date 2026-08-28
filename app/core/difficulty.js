// 難度：只調整「訓練量」，絕不調整「判定標準」。pure。
//
// ⚠️ 這是本模組唯一的鐵律，理由寫在這裡以免日後被「順手」放寬：
//   企劃書第三章承諾判定門檻可追溯至領域標準（CrossFit air squat、美軍 AFT、FitnessGram 等），
//   並建立了三級知識來源分級。若「簡單」模式把深度門檻放寬，等於同一個系統對同一個動作
//   有兩套「算不算做對」的標準——那套溯源制度當場失效，且使用者在簡單模式練出來的
//   動作品質無法與其他人比較。
//   因此：難度改的是「做幾組、每組幾下、休息多久」，不是「蹲多低才算一下」。
//
// 對應設定頁的 prefs.difficulty（settings.js 的 easy／normal／hard 三選一）。

/** 各難度相對於動作 meta 基準值的倍率。normal 為 1.0，即 meta 本身。 */
const FACTORS = {
  easy:   { sets: 0.67, reps: 0.67, rest: 1.5 },   // 量少、休息長
  normal: { sets: 1.0,  reps: 1.0,  rest: 1.0 },
  hard:   { sets: 1.33, reps: 1.33, rest: 0.75 },  // 量多、休息短
};

/** meta 缺漏時的保底值，避免回傳 NaN／0 讓訓練流程算不出組數而卡住。 */
const FALLBACK = { sets: 3, repsPerSet: 10, restSec: 30 };

export const DIFFICULTY_LEVELS = Object.keys(FACTORS);

/** 未知或缺失一律回退 normal —— 舊存檔、手改 localStorage、未來新增的值都走這條。 */
export function normalizeDifficulty(level) {
  return Object.prototype.hasOwnProperty.call(FACTORS, level) ? level : 'normal';
}

/**
 * 依難度換算單次訓練的量。
 * @param {object} meta 動作的 meta（取 sets / repsPerSet / restSec 作基準）
 * @param {string} level easy / normal / hard，其餘值回退 normal
 * @returns {{sets:number, repsPerSet:number, restSec:number, level:string}} 三者皆為正整數
 */
export function planFor(meta, level) {
  const lv = normalizeDifficulty(level);
  const f = FACTORS[lv];
  const base = (v, fb) => (Number.isFinite(v) && v > 0 ? v : fb);
  // 至少 1：倍率乘下去若不足 1，訓練流程會拿到 0 組而直接結束。
  const pos = (v) => Math.max(1, Math.round(v));
  return {
    sets: pos(base(meta?.sets, FALLBACK.sets) * f.sets),
    repsPerSet: pos(base(meta?.repsPerSet, FALLBACK.repsPerSet) * f.reps),
    restSec: pos(base(meta?.restSec, FALLBACK.restSec) * f.rest),
    level: lv,
  };
}

/** 簡介頁與訓練流程共用的一行摘要，確保兩處數字必然一致（不得各自組字串）。 */
export function planLabel(plan) {
  return `${plan.sets} 組 × ${plan.repsPerSet} 下 · 組間休息 ${plan.restSec} 秒`;
}
