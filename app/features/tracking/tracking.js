// Tab3 健康（數據儀表板）：把訓練歷史視覺化，強調「過去 vs 現在」對比。
// 使用已 vendored 的 Chart.js v4（window.Chart）。所有 Chart 實例都會被追蹤，
// 在 unmount() / 重繪前一律 .destroy()，避免重用 <canvas> 拋錯。

import { store } from '../../state/store.js';

/* ---------------- 常數 / 主題 ---------------- */
const PALETTE = {
  green: '#22e0a1',
  gold: '#ffd23f',
  coral: '#ff7a59',
  teal: '#2fd6c6',
  red: '#ff5d6c',
};
const TICK_COLOR = '#9fb6bd';
const GRID_COLOR = 'rgba(255,255,255,.08)';
const FONT_FAMILY = '-apple-system, "PingFang TC", "Noto Sans TC", system-ui, sans-serif';

const FAULT_LABELS = {
  torso_lean: '彎腰',
  half_rep: '半程未達標',
  limb_desync: '手腳不同步',
  no_support: '支撐不穩',
  no_alternation: '未交替',
  sag: '塌腰',
  form: '深度不足',
};
function faultLabel(f) { return FAULT_LABELS[f] || f; }

const GRADE_COLOR = { S: PALETTE.gold, A: PALETTE.green, B: PALETTE.teal, C: PALETTE.coral };

/* ---------------- 模組狀態（mount 期間） ---------------- */
let CTX = null;
let ROOT = null;
let charts = [];          // 所有 Chart 實例，unmount 時全部 destroy
let unsubscribe = null;   // store 訂閱解除函式

const reduceMotion = typeof matchMedia !== 'undefined'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ============================================================
 * 日期 / 彙整輔助（純函式，方便離線單元測試）
 * ========================================================== */

// 將 Date 轉成本地 YYYY-MM-DD（與 store 寫入的 todayISO 相容）。
function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 取得「往前回推 n 天」的日期鍵陣列，含 today，最舊在前、最新在後。
// today 預設為 new Date()，測試可注入固定日期。
export function lastNDays(n, today = new Date()) {
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    out.push(ymd(d));
  }
  return out;
}

// 將 history 依日期（YYYY-MM-DD）分組。回傳 Map<dateKey, session[]>。
export function groupByDate(history) {
  const map = new Map();
  for (const h of history || []) {
    const key = h.date || (h.dateISO ? h.dateISO.slice(0, 10) : null);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(h);
  }
  return map;
}

// 將一組 session 聚合為週/區間統計。
function aggregate(sessions) {
  let minutes = 0, valid = 0, invalid = 0, sessionsCount = 0;
  for (const s of sessions) {
    minutes += (s.durationSec || 0) / 60;
    valid += s.validReps || 0;
    invalid += s.invalidReps || 0;
    sessionsCount += 1;
  }
  const total = valid + invalid;
  return {
    minutes,
    valid,
    invalid,
    sessions: sessionsCount,
    targetRate: total ? valid / total : 0,
  };
}

// 切出「本週」(含今天往前 7 天) 與「上週」(再往前 7 天) 的 session 陣列。
export function splitWeeks(history, today = new Date()) {
  const thisKeys = new Set(lastNDays(7, today));
  const prevBase = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  prevBase.setDate(prevBase.getDate() - 7);
  const lastKeys = new Set(lastNDays(7, prevBase));
  const grouped = groupByDate(history);
  const thisWeek = [], lastWeek = [];
  for (const [key, list] of grouped) {
    if (thisKeys.has(key)) thisWeek.push(...list);
    else if (lastKeys.has(key)) lastWeek.push(...list);
  }
  return { thisWeek: aggregate(thisWeek), lastWeek: aggregate(lastWeek) };
}

// 計算總覽卡片所需數字。
export function computeSummary(state, today = new Date()) {
  const history = state.history || [];
  const { thisWeek } = splitWeeks(history, today);
  let totalValid = 0, totalAttempts = 0;
  for (const h of history) {
    totalValid += h.validReps || 0;
    totalAttempts += (h.validReps || 0) + (h.invalidReps || 0);
  }
  return {
    weekMinutes: Math.round(thisWeek.minutes),
    totalValid,
    // 平均達標率取代原本的累積熱量：熱量由 MET 公式估算，未納入個體代謝差異，
    // 亦無心率或攝氧量佐證；達標率則由本系統逐次判定累計而得，是可精確計算的量。
    avgTargetRate: totalAttempts ? Math.round(totalValid / totalAttempts * 100) : 0,
    streakCurrent: store.derived.currentStreak(),
    streakLongest: state.streak?.longest || 0,
  };
}

// 各日運動分鐘（對齊 keys 順序）。
function minutesPerDay(history, keys) {
  const grouped = groupByDate(history);
  return keys.map(k => {
    const list = grouped.get(k) || [];
    const sec = list.reduce((a, s) => a + (s.durationSec || 0), 0);
    return Math.round(sec / 60);
  });
}

// 各日達標率（對齊 keys 順序）。沒有訓練的日子回 null，讓折線斷開而非畫成 0%——
// 0% 代表「做了但全錯」，與「當天沒練」是完全不同的兩件事，不可混為一談。
function targetRatePerDay(history, keys) {
  const grouped = groupByDate(history);
  return keys.map(k => {
    const list = grouped.get(k) || [];
    if (!list.length) return null;
    let v = 0, t = 0;
    for (const s of list) { v += s.validReps || 0; t += (s.validReps || 0) + (s.invalidReps || 0); }
    return t ? Math.round(v / t * 100) : null;
  });
}

// 整體有效 / 無效次數。
function overallReps(history) {
  let valid = 0, invalid = 0;
  for (const h of history) { valid += h.validReps || 0; invalid += h.invalidReps || 0; }
  return { valid, invalid };
}

// 彙整所有 faults（已映射為友善標籤），依次數遞減排序。
export function aggregateFaults(history) {
  const tally = {};
  for (const h of history || []) {
    const faults = h.faults || {};
    for (const [type, n] of Object.entries(faults)) {
      tally[type] = (tally[type] || 0) + (n || 0);
    }
  }
  return Object.entries(tally)
    .map(([type, count]) => ({ type, label: faultLabel(type), count }))
    .sort((a, b) => b.count - a.count);
}

// MM-DD 標籤（圖表 x 軸用）。
function shortDate(key) { return key.slice(5); }

/* ============================================================
 * Chart.js 設定輔助
 * ========================================================== */

function hasChart() { return typeof window !== 'undefined' && !!window.Chart; }

function applyDefaults() {
  const C = window.Chart;
  C.defaults.color = TICK_COLOR;
  C.defaults.font.family = FONT_FAMILY;
  C.defaults.borderColor = GRID_COLOR;
}

const ANIM = reduceMotion ? 0 : 600;

// 建立 Chart 並登記到 charts[]，回傳實例。
function makeChart(canvas, config) {
  if (!canvas) return null;
  const chart = new window.Chart(canvas, config);
  charts.push(chart);
  return chart;
}

function baseScales(extra = {}) {
  return {
    x: {
      ticks: { color: TICK_COLOR },
      grid: { color: GRID_COLOR },
      ...(extra.x || {}),
    },
    y: {
      beginAtZero: true,
      ticks: { color: TICK_COLOR },
      grid: { color: GRID_COLOR },
      ...(extra.y || {}),
    },
  };
}

function legend(show, position = 'top') {
  return { display: show, position, labels: { color: TICK_COLOR, font: { size: 12 } } };
}

function withAlpha(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ============================================================
 * 模組契約
 * ========================================================== */

export default {
  id: 'tracking', label: '健康', icon: '📊',

  mount(root, ctx) {
    CTX = ctx;
    ROOT = root;
    render();
    // 訂閱 store：commitSession 後（從訓練回來時）資料會更新 → 重繪。
    unsubscribe = store.subscribe(() => { if (ROOT) render(); });
  },

  unmount() {
    destroyCharts();
    if (unsubscribe) { try { unsubscribe(); } catch { /* noop */ } unsubscribe = null; }
    ROOT = null;
    CTX = null;
  },

  onShow() {},
};

function destroyCharts() {
  for (const c of charts) { try { c.destroy(); } catch { /* noop */ } }
  charts = [];
}

/* ============================================================
 * 主渲染
 * ========================================================== */

function render() {
  // 每次重繪前先銷毀舊圖，避免 canvas 重用拋錯。
  destroyCharts();
  const state = store.getState();
  const history = state.history || [];

  if (!history.length) {
    renderEmpty();
    return;
  }
  renderDashboard(state, history);
}

function renderEmpty() {
  ROOT.innerHTML = `
    <div class="fade-in trk-empty">
      <div class="trk-empty-art">📊</div>
      <h1 class="h1" style="text-align:center">還沒有訓練紀錄</h1>
      <p class="sub" style="text-align:center; max-width:320px; margin:0 auto 4px">
        完成第一次訓練後，這裡會出現你的運動分鐘、有效次數、達標率與進步曲線。
      </p>
      <p class="sub" style="text-align:center; color:var(--faint)">過去 vs 現在，一目了然 ✨</p>
      <button class="btn trk-empty-cta" id="trk-go">開始第一次訓練</button>
    </div>`;
  const go = ROOT.querySelector('#trk-go');
  if (go) go.onclick = () => CTX?.navigate('workout');
}

function renderDashboard(state, history) {
  const today = new Date();
  const sum = computeSummary(state, today);
  const { thisWeek, lastWeek } = splitWeeks(history, today);

  ROOT.innerHTML = `
    <div class="fade-in">
      <h1 class="h1">健康儀表板</h1>
      <p class="sub">追蹤你的訓練數據 — 看見過去與現在的差距 📈</p>

      <div class="trk-cards stagger">
        ${summaryCard('⏱️', sum.weekMinutes, '本週運動分鐘', 'teal')}
        ${summaryCard('✅', sum.totalValid, '累積有效次數', 'green')}
        ${summaryCard('🎯', sum.avgTargetRate + '%', '平均達標率', 'coral')}
        ${summaryCard('🔥', sum.streakCurrent, `連續天數 · 最長 ${sum.streakLongest}`, 'gold')}
      </div>

      <div class="section-title">本週 vs 上週</div>
      ${weekDeltaRow(thisWeek, lastWeek)}
      <div class="card trk-chart-card">
        <div class="trk-chart-wrap trk-h-220"><canvas id="trk-compare"></canvas></div>
      </div>

      <div class="section-title">每日運動時長（近 7 天）</div>
      <div class="card trk-chart-card">
        <div class="trk-chart-wrap trk-h-200"><canvas id="trk-daily"></canvas></div>
      </div>

      <div class="section-title">動作品質趨勢（近 14 天）</div>
      <div class="card trk-chart-card">
        <div class="trk-chart-wrap trk-h-200"><canvas id="trk-quality"></canvas></div>
      </div>

      <div class="trk-two">
        <div>
          <div class="section-title">整體達標率</div>
          <div class="card trk-chart-card">
            <div class="trk-chart-wrap trk-h-200"><canvas id="trk-rate"></canvas></div>
          </div>
        </div>
        <div>
          <div class="section-title">常見錯誤分布</div>
          <div class="card trk-chart-card">
            <div class="trk-chart-wrap trk-h-200"><canvas id="trk-faults"></canvas></div>
          </div>
        </div>
      </div>

      <div class="section-title">最近訓練紀錄</div>
      <div class="card trk-recent" id="trk-recent"></div>
    </div>`;

  renderRecent(history);

  if (!hasChart()) {
    renderChartFallback();
    return;
  }
  applyDefaults();
  buildCharts(history, thisWeek, lastWeek, today);
}

/* ---------------- 卡片 / 區塊 HTML ---------------- */

function summaryCard(icon, value, label, color) {
  return `
    <div class="card trk-card">
      <div class="trk-card-ic trk-${color}">${icon}</div>
      <div class="trk-card-v">${value}</div>
      <div class="trk-card-k">${label}</div>
    </div>`;
}

function weekDeltaRow(thisWeek, lastWeek) {
  const items = [
    { k: '運動時長', unit: '分', cur: Math.round(thisWeek.minutes), prev: Math.round(lastWeek.minutes) },
    { k: '有效次數', unit: '次', cur: thisWeek.valid, prev: lastWeek.valid },
    { k: '達標率', unit: '%', cur: Math.round(thisWeek.targetRate * 100), prev: Math.round(lastWeek.targetRate * 100) },
  ];
  return `<div class="trk-deltas">${items.map(deltaPill).join('')}</div>`;
}

function deltaPill({ k, unit, cur, prev }) {
  const diff = cur - prev;
  let arrow = '→', cls = 'flat';
  if (diff > 0) { arrow = '▲'; cls = 'up'; }
  else if (diff < 0) { arrow = '▼'; cls = 'down'; }
  const sign = diff > 0 ? '+' : '';
  return `
    <div class="trk-delta">
      <div class="trk-delta-k">${k}</div>
      <div class="trk-delta-v">${cur}<span class="trk-delta-u">${unit}</span></div>
      <div class="trk-delta-d ${cls}">${arrow} ${sign}${diff}</div>
    </div>`;
}

function renderRecent(history) {
  const el = ROOT.querySelector('#trk-recent');
  if (!el) return;
  const recent = [...history]
    .sort((a, b) => new Date(b.dateISO || b.date) - new Date(a.dateISO || a.date))
    .slice(0, 8);
  el.innerHTML = recent.map(s => {
    const color = GRADE_COLOR[s.grade] || PALETTE.teal;
    const dateStr = (s.date || (s.dateISO || '').slice(0, 10)).slice(5) || '—';
    return `
      <div class="trk-rec-row">
        <span class="trk-rec-grade" style="--gc:${color}">${s.grade || '-'}</span>
        <div class="trk-rec-body">
          <div class="trk-rec-name">${escapeHtml(s.exerciseName || s.exercise || '訓練')}</div>
          <div class="trk-rec-meta">${dateStr} · ✅ ${s.validReps || 0} 次</div>
        </div>
        <span class="trk-rec-valid">${s.validReps || 0} 次有效</span>
      </div>`;
  }).join('');
}

function renderChartFallback() {
  ROOT.querySelectorAll('.trk-chart-wrap').forEach(w => {
    w.innerHTML = `<div class="trk-nochart">圖表元件未載入<br/><span>請確認 Chart.js 已就緒</span></div>`;
  });
}

/* ============================================================
 * 圖表建構
 * ========================================================== */

function buildCharts(history, thisWeek, lastWeek, today) {
  buildCompare(thisWeek, lastWeek);
  buildDaily(history, today);
  buildQualityTrend(history, today);
  buildRate(history);
  buildFaults(history);
}

// 2. 本週 vs 上週 分組長條圖（時長 / 有效次數 / 達標率）。
function buildCompare(thisWeek, lastWeek) {
  const canvas = ROOT.querySelector('#trk-compare');
  const labels = ['運動時長(分)', '有效次數', '達標率(%)'];
  const lastData = [
    Math.round(lastWeek.minutes),
    lastWeek.valid,
    Math.round(lastWeek.targetRate * 100),
  ];
  const thisData = [
    Math.round(thisWeek.minutes),
    thisWeek.valid,
    Math.round(thisWeek.targetRate * 100),
  ];
  makeChart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '上週',
          data: lastData,
          backgroundColor: withAlpha(PALETTE.teal, 0.45),
          borderColor: PALETTE.teal,
          borderWidth: 1,
          borderRadius: 6,
        },
        {
          label: '本週',
          data: thisData,
          backgroundColor: withAlpha(PALETTE.gold, 0.85),
          borderColor: PALETTE.gold,
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: ANIM },
      plugins: { legend: legend(true) },
      scales: baseScales(),
    },
  });
}

// 3. 每日運動時長（近 7 天）長條圖。
function buildDaily(history, today) {
  const canvas = ROOT.querySelector('#trk-daily');
  const keys = lastNDays(7, today);
  const data = minutesPerDay(history, keys);
  makeChart(canvas, {
    type: 'bar',
    data: {
      labels: keys.map(shortDate),
      datasets: [{
        label: '運動分鐘',
        data,
        backgroundColor: withAlpha(PALETTE.green, 0.8),
        borderColor: PALETTE.green,
        borderWidth: 1,
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: ANIM },
      plugins: { legend: legend(false) },
      scales: baseScales({ y: { ticks: { color: TICK_COLOR, precision: 0 } } }),
    },
  });
}

// 4. 動作品質趨勢（近 14 天）折線圖。取代原本的卡路里趨勢——
// 熱量是估算值且無從驗證，達標率則是本系統逐次判定累計而得，且直接呈現「動作有沒有變好」。
function buildQualityTrend(history, today) {
  const canvas = ROOT.querySelector('#trk-quality');
  const keys = lastNDays(14, today);
  const data = targetRatePerDay(history, keys);
  makeChart(canvas, {
    type: 'line',
    data: {
      labels: keys.map(shortDate),
      datasets: [{
        label: '達標率 (%)',
        data,
        spanGaps: true,          // 沒訓練的日子為 null，折線跨過去而非墜到 0
        borderColor: PALETTE.coral,
        backgroundColor: withAlpha(PALETTE.coral, 0.18),
        fill: true,
        tension: 0.35,
        pointRadius: 2.5,
        pointBackgroundColor: PALETTE.coral,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: ANIM },
      plugins: { legend: legend(false) },
      scales: baseScales({ x: { ticks: { color: TICK_COLOR, maxTicksLimit: 8 } }, y: { min: 0, max: 100 } }),
    },
  });
}

// 5. 整體達標率 doughnut（有效 vs 無效），中央顯示百分比。
function buildRate(history) {
  const canvas = ROOT.querySelector('#trk-rate');
  const { valid, invalid } = overallReps(history);
  const total = valid + invalid;
  const pct = total ? Math.round(valid / total * 100) : 0;

  const centerText = {
    id: 'trkCenterText',
    afterDraw(chart) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const cx = (chartArea.left + chartArea.right) / 2;
      const cy = (chartArea.top + chartArea.bottom) / 2;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = PALETTE.green;
      ctx.font = `800 26px ${FONT_FAMILY}`;
      ctx.fillText(`${pct}%`, cx, cy - 6);
      ctx.fillStyle = TICK_COLOR;
      ctx.font = `600 12px ${FONT_FAMILY}`;
      ctx.fillText('達標率', cx, cy + 16);
      ctx.restore();
    },
  };

  makeChart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['有效次數', '無效次數'],
      datasets: [{
        data: [valid, invalid],
        backgroundColor: [PALETTE.green, withAlpha(PALETTE.red, 0.85)],
        borderColor: 'rgba(8,22,28,.6)',
        borderWidth: 2,
        hoverOffset: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '66%',
      animation: { duration: ANIM },
      plugins: { legend: legend(true, 'bottom') },
    },
    plugins: [centerText],
  });
}

// 6. 常見錯誤分布（橫向長條，已映射友善標籤）。
function buildFaults(history) {
  const canvas = ROOT.querySelector('#trk-faults');
  const faults = aggregateFaults(history).slice(0, 7);
  if (!faults.length) {
    const wrap = canvas?.closest('.trk-chart-wrap');
    if (wrap) wrap.innerHTML = `<div class="trk-nochart">👏 目前沒有明顯錯誤<br/><span>動作品質很棒！</span></div>`;
    return;
  }
  const colors = [PALETTE.coral, PALETTE.gold, PALETTE.teal, PALETTE.green, PALETTE.red, '#b08bff', '#7fd1ff'];
  makeChart(canvas, {
    type: 'bar',
    data: {
      labels: faults.map(f => f.label),
      datasets: [{
        label: '次數',
        data: faults.map(f => f.count),
        backgroundColor: faults.map((_, i) => withAlpha(colors[i % colors.length], 0.8)),
        borderColor: faults.map((_, i) => colors[i % colors.length]),
        borderWidth: 1,
        borderRadius: 6,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: ANIM },
      plugins: { legend: legend(false) },
      scales: baseScales({ x: { ticks: { color: TICK_COLOR, precision: 0 } } }),
    },
  });
}

/* ---------------- 共用 ---------------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
