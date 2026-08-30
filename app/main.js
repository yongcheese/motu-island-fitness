// App shell：頂部狀態列、底部 Tab 導覽、掛載各 feature 模組。
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
const TABS = [
  { id: 'today', label: '今日', icon: '☀️' },
  { id: 'island', label: '島嶼', icon: '🏝️' },
  { id: 'workout', label: '訓練', icon: '🏋️' },
  { id: 'tracking', label: '健康', icon: '📊' },
  { id: 'settings', label: '設定', icon: '⚙️' },
];

const els = {
  topbar: document.getElementById('topbar'),
  view: document.getElementById('view'),
  tabbar: document.getElementById('tabbar'),
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
  // 由 workout 呼叫，要求全螢幕沉浸（隱藏 topbar / tabbar）
  setChrome: (visible) => {
    els.topbar.classList.toggle('hidden', !visible);
    els.tabbar.classList.toggle('hidden', !visible);
    els.view.classList.toggle('full', !visible);
  },
};

function renderTopbar() {
  const s = store.getState();
  const xp = store.derived.xpProgress();
  els.topbar.innerHTML = `
    <div class="tb-avatar">${s.profile.avatar}</div>
    <div class="tb-id">
      <div class="tb-name">${escapeHtml(s.profile.nickname)}</div>
      <div class="tb-lvl">Lv.${s.wallet.level}
        <span class="tb-xpbar"><i style="width:${Math.round(xp.ratio * 100)}%"></i></span>
      </div>
    </div>
    <div class="tb-coins"><span class="ico">🪙</span>${s.wallet.coins}</div>`;
}

function renderTabbar() {
  els.tabbar.innerHTML = '';
  // 桌機側邊欄品牌（手機由 CSS 隱藏）
  const brand = document.createElement('div');
  brand.className = 'tb-brand';
  brand.innerHTML = `<span class="logo">🏝️</span><span>Island Fitness<small>AI 健身 × 島嶼建設</small></span>`;
  els.tabbar.appendChild(brand);
  for (const t of TABS) {
    const b = document.createElement('button');
    b.className = 'tab' + (current === t.id ? ' active' : '');
    b.innerHTML = `<span class="ti">${t.icon}</span><span>${t.label}</span>`;
    b.onclick = () => show(t.id);
    els.tabbar.appendChild(b);
  }
}

function show(id) {
  if (current === id) return;
  const prev = current ? FEATURES[current] : null;
  if (prev?.unmount) try { prev.unmount(); } catch (e) { console.error(e); }
  current = id;
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

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// 顏色顯示模式（設定頁）：語意鍵不變，只換畫出來的顏色，判定邏輯完全不受影響。
// 放在 main 而非 workout：設定頁一切換就要生效，不必等下次進訓練頁重新掛載。
let appliedColorMode = null;
function syncPalette(s) {
  if (s.prefs.colorMode === appliedColorMode) return;
  appliedColorMode = s.prefs.colorMode;
  setPalette(appliedColorMode);
}

// 狀態變更 → 更新頂部 + 同步調色盤
store.subscribe((s) => { syncPalette(s); renderTopbar(); });

// 啟動
function boot() {
  syncPalette(store.getState());   // 開機即套用，不必等第一次狀態變更
  renderTopbar();
  renderTabbar();
  show('today');   // Slice 1：首屏＝今日層（僅首次載入預設；之後由使用者切換）
  setTimeout(() => els.loader.classList.add('done'), 500);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

// 給 console 偵錯用
window.__app = { store, ctx, show };
