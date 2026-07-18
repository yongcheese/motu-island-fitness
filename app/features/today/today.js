// Tab0 今日（Slice 1 第一輪）：首屏靜態版——今日任務(假資料) + 島嶼入口 + streak + 唯一主 CTA。
// 契約：只實作 { id, label, icon, mount, unmount } 五欄位（不含 onShow）。
// store 一律唯讀（getState / subscribe）；unmount 必清 unsubscribe（生命週期鐵則）。
import { store } from '../../state/store.js';

const TASK = { title: '完成 20 個有效深蹲', target: 20, hint: '蹲到髖低於膝才算有效' };

// 今日任務進度（Demo 最終打磨 P0）：純呈現層由 history 唯讀推導，零 store schema 變更。
// 「今日」判定與 store todayISO 同式（UTC 日期字串比對）；已知限制：台北 00:00–07:59 歸前一 UTC 日。
export function todayValidSquats(history, todayStr = new Date().toISOString().slice(0, 10)) {
  let n = 0;
  for (const h of history || []) {
    if (h.date === todayStr && h.exercise === 'squat' && Number.isFinite(h.validReps) && h.validReps > 0) n += h.validReps;
  }
  return Math.min(TASK.target, n);
}

let root = null, CTX = null, unsub = null;

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function greeting() {
  const h = new Date().getHours();
  return h < 5 ? '夜深了' : h < 11 ? '早安' : h < 14 ? '午安' : h < 18 ? '下午好' : '晚安';
}
function dateStr() {
  const d = new Date();
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 週${'日一二三四五六'[d.getDay()]}`;
}

// 任務進度環（P0 起接真資料，由 subscribe 整卡重繪更新）
function ringSvg(done, target) {
  const pct = target ? Math.min(1, done / target) : 0;
  const R = 34, C = 2 * Math.PI * R;
  return `
    <svg class="td-ring" viewBox="0 0 84 84" role="img" aria-label="任務進度 ${Math.round(pct * 100)}%">
      <circle cx="42" cy="42" r="${R}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="8"/>
      ${pct > 0 ? `<circle cx="42" cy="42" r="${R}" fill="none" stroke="var(--green)" stroke-width="8" stroke-linecap="round"
        stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 42 42)"/>` : ''}
      <text x="42" y="40" text-anchor="middle" class="td-ring-n">${done}/${target}</text>
      <text x="42" y="56" text-anchor="middle" class="td-ring-k">有效次</text>
    </svg>`;
}

function render() {
  const s = store.getState();
  const first = s.history.length === 0;   // Empty 狀態：從未訓練 → 首訓引導（空＝下一步，不是死路）
  const done = todayValidSquats(s.history);
  root.innerHTML = `
  <div class="fade-in today stagger">
    <header class="td-greet">
      <h1 class="h1">${greeting()}，${esc(s.profile.nickname)}</h1>
      <p class="sub">${dateStr()} · 正確訓練 → 金幣 → 島嶼成長</p>
    </header>

    <section class="card td-mission${done >= TASK.target ? ' done' : ''}">
      <div class="section-title td-sec">📌 今日任務</div>
      <div class="td-mission-row">
        <div class="td-mission-info">
          <div class="td-mission-t">${done >= TASK.target ? '✅ ' : ''}${first ? '完成你的第一次訓練' : esc(TASK.title)}</div>
          <div class="td-mission-s">${done >= TASK.target ? '今日任務完成！' : first ? '島上第一棟建築正等著你解鎖 🏝️' : `還差 ${TASK.target - done} 個 · ${esc(TASK.hint)}`}</div>
          <span class="pill td-streak" id="td-streak">🔥 連續 ${s.streak.current} 天</span>
        </div>
        ${ringSvg(done, TASK.target)}
      </div>
    </section>

    <section class="card td-island">
      <div class="td-island-info">
        <div class="section-title td-sec">🏝️ 我的島嶼</div>
        <div class="td-island-t">已建 <b id="td-placed">${s.island.placed.length}</b> 棟建築</div>
        <div class="td-island-s">訓練賺金幣，讓島嶼繼續長大</div>
      </div>
      <button class="btn secondary" id="td-go-island" type="button">去看看 ›</button>
    </section>

    <section class="card td-week">
      <div class="td-week-head">
        <span class="section-title td-sec">📅 本週目標</span>
        <span class="pill td-soon">進度追蹤即將開通</span>
      </div>
      <div class="td-week-bar"><i style="width:0%"></i></div>
      <div class="td-week-s">目標：每週運動 ${s.prefs.weeklyGoalDays} 天</div>
    </section>

    <button class="btn td-cta" id="td-start" type="button">🏋️ 開始訓練</button>
  </div>`;

  root.querySelector('#td-start').onclick = () => CTX.navigate('workout');
  root.querySelector('#td-go-island').onclick = () => CTX.navigate('island');
}

export default {
  id: 'today', label: '今日', icon: '☀️',
  mount(el, ctx) {
    root = el; CTX = ctx;
    render();
    // 唯讀訂閱：任務環/建築數/連續天數任一變動 → 整頁重繪（P0 互審裁定：今日層無輸入框，重繪安全）
    unsub = store.subscribe(() => { if (root) render(); });
  },
  unmount() {
    unsub?.(); unsub = null;      // 生命週期鐵則：清訂閱，防重複 render 疊加
    root = null; CTX = null;      // DOM listener 隨 #view.innerHTML 清空一併移除
  },
};
