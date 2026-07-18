// App shell：頂部狀態列、底部 Tab 導覽、掛載各 feature 模組。
import { store } from './state/store.js';
import { createCoach } from './core/coach.js';
import today from './features/today/today.js';
import workout from './features/workout/workout.js';
import island from './features/island/island.js';
import tracking from './features/tracking/tracking.js';
import settings from './features/settings/settings.js';

const coach = createCoach({ enabled: store.getState().prefs.voice });

// feature 契約：{ id, label, icon, mount(root, ctx), unmount(), onShow?(), needsTopbar }
const FEATURES = { today, island, workout, tracking, settings };
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
  try { feat.mount(els.view, ctx); } catch (e) { console.error(e); els.view.innerHTML = `<p class="sub" style="margin-top:40px">模組載入失敗：${e.message}</p>`; }
  feat.onShow?.();
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// 狀態變更 → 更新頂部
store.subscribe(() => renderTopbar());

// 啟動
function boot() {
  renderTopbar();
  renderTabbar();
  show('today');   // Slice 1：首屏＝今日層（僅首次載入預設；之後由使用者切換）
  setTimeout(() => els.loader.classList.add('done'), 500);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

// 給 console 偵錯用
window.__app = { store, ctx, show };
