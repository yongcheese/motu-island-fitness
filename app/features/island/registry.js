// 島嶼分頁的模組來源切換。pure，無 DOM 依賴（故可測）。
//
// 為什麼需要這層：遊戲組將交付整包原始碼由我方整合（08/25 議定），
// 屆時島嶼分頁要換成他們的模組，但我方版本必須保留為備援——
// 合體是在彩排前才會完成的事，中間任何一天都可能需要切回可用的版本做 demo。
//
// 切換方式見 main.js 的 ISLAND_SOURCE 常數。

export const ISLAND_FALLBACK = 'builtin';

/**
 * 從註冊表取出指定的島嶼模組；找不到時回退備援並回報原因。
 * 刻意「回退」而非「拋錯」：切錯字串不該讓整個 App 變白畫面，
 * 使用者仍該看得到一個能用的島嶼，而開發者從 console 就知道發生什麼事。
 *
 * @param {Record<string, object>} registry 可用模組表
 * @param {string} key 想要的模組鍵
 * @returns {{ module: object|null, key: string, ok: boolean, message: string|null }}
 */
export function resolveIsland(registry, key) {
  const available = Object.keys(registry || {});
  if (registry && Object.prototype.hasOwnProperty.call(registry, key) && registry[key]) {
    return { module: registry[key], key, ok: true, message: null };
  }
  const fallback = registry?.[ISLAND_FALLBACK] || null;
  const message = `島嶼模組「${key}」不存在或未載入`
    + `${fallback ? `，已回退為「${ISLAND_FALLBACK}」` : '，且備援模組亦不可用'}`
    + `。目前可用：${available.length ? available.join(', ') : '（無）'}`;
  return { module: fallback, key: fallback ? ISLAND_FALLBACK : key, ok: false, message };
}
