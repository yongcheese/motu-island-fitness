/* ============================================================
   外殼模板（合體第二階段 Slice 1）
   照遊戲端主頁截圖（文件/遊戲組系統UI畫面/image.png）重做的外殼：
   左上帳號卡、左側四鈕直欄、右下禮物與轉盤、底部四個分頁。
   全部是純函式：吃資料、回 HTML 字串，不碰 DOM —— 方便在 node 測試，
   也方便遊戲組原始碼到了之後整支換掉。
   Slice 3：帳號卡改吃真實 state（accountFromState）、圖示改用 Slice 2 的正式名稱。
   ============================================================ */
import { ICONS, icon } from './icons.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * 圖示或暫代字：ICONS 裡有就畫 Lucide，沒有就放一個字暫代。
 * Slice 1 先用目標名稱（hammer、gift…）寫資料，Slice 2 補上圖示後這裡自動換成線條圖示，
 * 不必回頭改模板；也避免 icon() 對缺圖示的名稱印 console.warn。
 */
function glyph(name, fallback, size) {
  if (name && Object.prototype.hasOwnProperty.call(ICONS, name)) return icon(name, { size });
  return `<span class="sh-ph" aria-hidden="true">${esc(fallback)}</span>`;
}

/** 左側直欄的四個按鈕（由上而下，照截圖順序） */
export const RAIL_ITEMS = [
  { id: 'build', label: '建造', icon: 'hammer' },
  { id: 'shop', label: '商店', icon: 'shopping-bag' },
  { id: 'bag', label: '背包', icon: 'backpack' },
  { id: 'emote', label: '動作', icon: 'face-slightly-smiling' },
];

/** 不做的按鈕（分頁、直欄、右下）按下時的統一提示文字 */
export const SOON_MESSAGE = '即將推出';

/**
 * 把 store 的完整 state 收斂成帳號卡要的三個欄位（Slice 3）。
 * 只取金幣這一種資源 —— 需求明定帳號卡不顯示第二種資源。
 * 欄位缺漏（舊存檔、測試用的殘缺 state）時退回安全預設，不讓外殼整片壞掉。
 * @param {object} s  store.getState() 的回傳值
 * @returns {{ name: string, level: number, coins: number }}
 */
export function accountFromState(s) {
  const name = s?.profile?.nickname;
  const level = Number(s?.wallet?.level);
  const coins = Number(s?.wallet?.coins);
  return {
    name: typeof name === 'string' && name.trim() ? name : '島主',
    level: Number.isFinite(level) && level >= 1 ? level : 1,
    coins: Number.isFinite(coins) && coins >= 0 ? coins : 0,
  };
}

/**
 * 底部分頁列。
 * @param {{ id: string, label: string, icon?: string, soon?: boolean }[]} tabs
 * @param {string|null} current  目前分頁 id；不在 tabs 裡時沒有任何頁籤被選中
 */
export function tabbarHtml(tabs, current) {
  return tabs.map((t) => {
    const active = t.id === current;
    return `<button type="button" class="sh-tab${active ? ' is-active' : ''}" data-tab="${esc(t.id)}"${t.soon ? ' data-soon="1"' : ''}>`
      + `<span class="sh-tab-ico">${glyph(t.icon, t.label.slice(0, 1), 24)}</span>`
      + `<span class="sh-tab-label">${esc(t.label)}</span></button>`;
  }).join('');
}

/**
 * 左上帳號卡。
 * @param {{ name: string, level: number, coins: number }} state
 */
export function accountCardHtml(state) {
  return `<div class="sh-avatar">${glyph('waves-horizontal', '島', 24)}</div>`
    + `<div class="sh-id"><div class="sh-name">${esc(state.name)}</div>`
    + `<span class="sh-lv">LV ${esc(state.level)}</span></div>`
    + `<div class="sh-res"><span class="sh-coin-ico">${glyph('coins', '幣', 18)}</span>`
    + `<span class="sh-coin-num">${esc(state.coins)}</span></div>`;
}

/** 左側直欄：四個按鈕＋下方小標籤 */
export function railHtml() {
  return RAIL_ITEMS.map((r) => `<div class="sh-rail-item">`
    + `<button type="button" class="sh-rail-btn" data-act="${r.id}" aria-label="${esc(r.label)}">${glyph(r.icon, r.label.slice(0, 1), 24)}</button>`
    + `<span class="sh-rail-label">${esc(r.label)}</span></div>`).join('');
}

/** 右下：禮物大圓鈕、幸運轉盤圓鈕 */
export function cornerHtml() {
  return `<button type="button" class="sh-gift" data-act="gift" aria-label="禮物">${glyph('gift', '禮', 24)}</button>`
    + `<button type="button" class="sh-wheel" data-act="wheel" aria-label="幸運轉盤"><span class="sh-wheel-disc">轉盤</span></button>`;
}
