// App shell：遊戲端樣式外殼（帳號卡、左側直欄、右下按鈕、底部分頁列）、掛載各 feature 模組。
import { store } from './state/store.js';
import { createCoach } from './core/coach.js';
import { setPalette } from './ui/feedback.js';
import today from './features/today/today.js';
import workout from './features/workout/workout.js';
import island from './features/island/island.js';
import { resolveIsland } from './features/island/registry.js';
import tracking from './features/tracking/tracking.js';
import settings from './features/settings/settings.js';
import { createIslandFacade } from './state/island-facade.js';
import { tabbarHtml, accountCardHtml, railHtml, cornerHtml } from './ui/shell.js';

const coach = createCoach({ enabled: store.getState().prefs.voice });

// —— 島嶼分頁的模組來源 ——
// 遊戲組將交付整包原始碼由我方整合（08/25 議定）。屆時的接入步驟：
//   1. 把他們的模組放到 app/features/island-game/island-game.js
//      （須符合 feature 契約，見 docs/CONTRACTS.md 第 10 節）
//   2. 取消下面那行 import 的註解
//   3. 把 ISLAND_SOURCE 從 'builtin' 改成 'game'
// 我方版本永遠保留在註冊表裡當備援——合體要到彩排前才完成，
// 中間任何一天都可能需要切回可用的版本做 demo。
// import islandGame from './features/island-game/island-game.js';
const ISLAND_MODULES = {
  builtin: island,
  // game: islandGame,
};
const ISLAND_SOURCE = 'builtin';

const islandPick = resolveIsland(ISLAND_MODULES, ISLAND_SOURCE);
if (!islandPick.ok) console.error('[island]', islandPick.message);

// feature 契約（以實際消費方式為準，見 show()）：
//   必要：mount(root, ctx)、unmount()
//   選用：onShow?()
// ⚠️ 分頁列的 label 與 icon 來自下方獨立的 TABS 常數，**不是**由模組提供 ——
//    模組即使帶了 label/icon 也不會被讀取。舊註解曾把它們列入契約，那是錯的
//    （2026-08-29 由跨模型互審抓出，且該錯誤已一度被抄進 docs/CONTRACTS.md）。
//    needsTopbar 同樣從未被讀取，已自契約移除。
const FEATURES = { today, island: islandPick.module, workout, tracking, settings };
// 島嶼插槽的受限 store 介面（見 state/island-facade.js 的完整說明與界線）
const islandStore = createIslandFacade(store);
// 合體第二階段：分頁列照遊戲端改成四個。今日、健康（tracking）模組保留但不在分頁列；
// 「追蹤」「設定」只擺樣子（soon），合體後由遊戲組提供。icon 是 Lucide 名稱（app/ui/icons.js）。
const TABS = [
  { id: 'island', label: '主頁', icon: 'house' },
  { id: 'workout', label: '健身', icon: 'dumbbell' },
  { id: 'tracking', label: '追蹤', icon: 'heart', soon: true },
  { id: 'settings', label: '設定', icon: 'settings', soon: true },
];
// Slice 1 骨架先寫死；Slice 3 改接 store 的暱稱、等級、金幣
const MOCK_ACCOUNT = { name: '島主', level: 1, coins: 0 };

const els = {
  view: document.getElementById('view'),
  shell: document.getElementById('shell'),
  account: document.getElementById('sh-account'),
  rail: document.getElementById('sh-rail'),
  corner: document.getElementById('sh-corner'),
  tabs: document.getElementById('sh-tabs'),
  toast: document.getElementById('toast'),
  loader: document.getElementById('loader'),
};

let current = null;
let toastTimer = null;

const ctx = {
  store, coach,
  navigate: (id) => show(id),
  toast: (msg) => {
    els.toast.textContent = msg; els.toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  },
  // 由 workout 呼叫，要求全螢幕沉浸（整個外殼一次隱藏）
  setChrome: (visible) => {
    els.shell.classList.toggle('hidden', !visible);
    els.view.classList.toggle('full', !visible);
  },
};

function renderShell() {
  els.account.innerHTML = accountCardHtml(MOCK_ACCOUNT);
  els.rail.innerHTML = railHtml();
  els.corner.innerHTML = cornerHtml();
}

function renderTabbar() {
  els.tabs.innerHTML = tabbarHtml(TABS, current);
}

els.tabs.addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  // Slice 1：不做的分頁先只記錄；Slice 3 改成跳「即將推出」提示
  if (b.dataset.soon) { console.info('[shell] 即將推出：', b.dataset.tab); return; }
  show(b.dataset.tab);
});

function show(id) {
  if (current === id) return;
  const prev = current ? FEATURES[current] : null;
  if (prev?.unmount) try { prev.unmount(); } catch (e) { console.error(e); }
  current = id;
  // 主頁（島嶼）才顯示帳號卡、直欄、右下按鈕；其他分頁只留底部分頁列
  els.shell.dataset.page = id === 'island' ? 'home' : 'page';
  els.view.innerHTML = '';
  els.view.scrollTop = 0;
  ctx.setChrome(true); // 預設顯示外框，feature 可自行關閉
  renderTabbar();
  const feat = FEATURES[id];
  // 島嶼是唯一會被外部模組替換的插槽，只給受限 store 介面（Slice 8）。
  // 白名單上沒有 commitSession —— 掛進來的模組無法憑空產出金幣或經驗值。
  // 界線：純前端擋不了 DevTools 或直接改 localStorage，這道防線防的是模組越權而非惡意使用者。
  const featCtx = id === 'island' ? { ...ctx, store: islandStore } : ctx;
  try { feat.mount(els.view, featCtx); } catch (e) { console.error(e); els.view.innerHTML = `<p class="sub" style="margin-top:40px">模組載入失敗：${e.message}</p>`; }
  feat.onShow?.();
}

// 顏色顯示模式（設定頁）：語意鍵不變，只換畫出來的顏色，判定邏輯完全不受影響。
// 放在 main 而非 workout：設定頁一切換就要生效，不必等下次進訓練頁重新掛載。
let appliedColorMode = null;
function syncPalette(s) {
  if (s.prefs.colorMode === appliedColorMode) return;
  appliedColorMode = s.prefs.colorMode;
  setPalette(appliedColorMode);
}

// 狀態變更 → 同步調色盤
store.subscribe((s) => { syncPalette(s); });

// 啟動
function boot() {
  syncPalette(store.getState());   // 開機即套用，不必等第一次狀態變更
  renderShell();
  show('island');   // 合體第二階段：開機進主頁（遊戲端樣式外殼＋島嶼）
  setTimeout(() => els.loader.classList.add('done'), 500);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

// 給 console 偵錯用
// ⚠️ 2026-08-30 互審抓出並移除：此處原為 `window.__app = { store, ctx, show }`。
// 那是一條**不需要 DevTools 的繞過路徑** —— 掛載進來的模組只要呼叫
// `window.__app.store.commitSession({ validReps: 9999 })` 就能憑空產出金幣，
// 受限介面等於形同虛設。全站無任何程式依賴此物件（互審後實測確認），故直接移除。
// 若日後需要除錯掛勾，必須只暴露不具權限的東西，絕不可再把完整 store 掛上全域。
