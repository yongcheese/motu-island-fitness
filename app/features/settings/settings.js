// Tab4 設定（個人化）：帳號 / 個人資料 / 提醒與目標 / 互動偏好 / 隱私與資料 / 關於。
// 身高體重會回饋到 AI 動作標準化與熱量估算，因此個人資料區特別標示真實數值的重要性。
import { store } from '../../state/store.js';

let CTX = null;
let root = null;
let unsub = null;

const AVATARS = ['🧑‍🚀', '🏝️', '💪', '🦊', '🐬', '🌟', '🧗', '🚀'];
const RANGES = {
  height_cm: { min: 100, max: 230, label: '身高' },
  weight_kg: { min: 25, max: 200, label: '體重' },
  age: { min: 5, max: 100, label: '年齡' },
};

export default {
  id: 'settings', label: '設定', icon: '⚙️',
  mount(el, ctx) {
    CTX = ctx; root = el;
    CTX.setChrome(true);
    render();
    // 外部變更（例如其他分頁匯入/重置）也讓設定頁同步顯示。
    if (unsub) { unsub(); unsub = null; }
    unsub = store.subscribe(() => { /* topbar 由 main 處理；此處不重繪以免打斷輸入 */ });
  },
  unmount() { if (unsub) { unsub(); unsub = null; } },
  onShow() {},
};

/* ---------------- 工具 ---------------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
function saved() { CTX.toast('已儲存'); }
function $(sel) { return root.querySelector(sel); }
function $all(sel) { return Array.from(root.querySelectorAll(sel)); }

/* ---------------- 主畫面 ---------------- */
function render() {
  const s = store.getState();
  const p = s.profile;
  const pr = s.prefs;

  root.innerHTML = `
    <div class="fade-in set-wrap">
      <h1 class="h1">設定</h1>
      <p class="sub">個人化你的島嶼健身體驗 — 資料只存在這台裝置上</p>

      <!-- 帳號 -->
      <div class="section-title">帳號</div>
      <div class="card set-card stagger">
        <div class="set-row set-row-col">
          <label class="set-label" for="set-nick">暱稱</label>
          <input id="set-nick" class="set-input" type="text" maxlength="16"
                 value="${esc(p.nickname)}" placeholder="輸入暱稱" />
        </div>
        <div class="set-row set-row-col">
          <span class="set-label">頭像</span>
          <div class="set-avatars" id="set-avatars">
            ${AVATARS.map(a => `
              <button class="set-avatar ${a === p.avatar ? 'on' : ''}" type="button"
                      data-av="${esc(a)}" aria-label="頭像 ${esc(a)}">${esc(a)}</button>`).join('')}
          </div>
        </div>
        <div class="set-row set-oauth">
          <button class="btn secondary set-oauth-btn" type="button" data-oauth="google">使用 Google 登入</button>
          <button class="btn secondary set-oauth-btn" type="button" data-oauth="apple">使用 Apple 登入</button>
        </div>
      </div>

      <!-- 個人資料 -->
      <div class="section-title">個人資料</div>
      <div class="card set-card stagger">
        <p class="set-note">身高體重會用於 AI 動作標準化與熱量估算，請填寫真實數值</p>
        <div class="set-grid2">
          <div class="set-row set-row-col">
            <label class="set-label" for="set-h">身高 (cm)</label>
            <input id="set-h" class="set-input" type="number" inputmode="numeric"
                   min="${RANGES.height_cm.min}" max="${RANGES.height_cm.max}" value="${esc(p.height_cm)}" />
          </div>
          <div class="set-row set-row-col">
            <label class="set-label" for="set-w">體重 (kg)</label>
            <input id="set-w" class="set-input" type="number" inputmode="numeric"
                   min="${RANGES.weight_kg.min}" max="${RANGES.weight_kg.max}" value="${esc(p.weight_kg)}" />
          </div>
          <div class="set-row set-row-col">
            <label class="set-label" for="set-age">年齡</label>
            <input id="set-age" class="set-input" type="number" inputmode="numeric"
                   min="${RANGES.age.min}" max="${RANGES.age.max}" value="${esc(p.age)}" />
          </div>
          <div class="set-row set-row-col">
            <label class="set-label" for="set-sex">生理性別</label>
            <select id="set-sex" class="set-input set-select">
              <option value="male" ${p.sex === 'male' ? 'selected' : ''}>男</option>
              <option value="female" ${p.sex === 'female' ? 'selected' : ''}>女</option>
              <option value="unspecified" ${p.sex !== 'male' && p.sex !== 'female' ? 'selected' : ''}>不透露</option>
            </select>
          </div>
        </div>
        <p class="set-hint" id="set-bmi"></p>
      </div>

      <!-- 提醒與目標 -->
      <div class="section-title">提醒與目標</div>
      <div class="card set-card stagger">
        <div class="set-row set-row-col">
          <div class="set-slider-head">
            <label class="set-label" for="set-daily">每日運動目標</label>
            <span class="set-slider-val" id="set-daily-v">${pr.dailyGoalMin} 分鐘</span>
          </div>
          <input id="set-daily" class="set-range" type="range" min="5" max="120" step="5" value="${esc(pr.dailyGoalMin)}" />
        </div>
        <div class="set-row set-row-col">
          <div class="set-slider-head">
            <label class="set-label" for="set-weekly">每週運動天數</label>
            <span class="set-slider-val" id="set-weekly-v">${pr.weeklyGoalDays} 天</span>
          </div>
          <input id="set-weekly" class="set-range" type="range" min="1" max="7" step="1" value="${esc(pr.weeklyGoalDays)}" />
        </div>
      </div>

      <!-- 互動偏好 -->
      <div class="section-title">互動偏好</div>
      <div class="card set-card stagger">
        ${toggleRow('voice', '語音教練', '依動作品質給予分級語音回饋', pr.voice)}
        ${toggleRow('bgm', '背景音樂', '訓練時播放輕快配樂', pr.bgm)}
        ${toggleRow('warmup', '訓練前暖身', '正式計時前加入暖身引導', pr.warmup)}
        ${toggleRow('mirror', '鏡像畫面', '攝影機畫面左右翻轉，更直覺', pr.mirror)}
        <div class="set-row set-row-col">
          <span class="set-label">難度</span>
          <div class="set-seg" id="set-difficulty" role="tablist">
            ${segBtn('difficulty', 'easy', '簡單', pr.difficulty)}
            ${segBtn('difficulty', 'normal', '普通', pr.difficulty)}
            ${segBtn('difficulty', 'hard', '困難', pr.difficulty)}
          </div>
        </div>
        <div class="set-row set-row-col">
          <span class="set-label">視覺配色</span>
          <div class="set-seg" id="set-color" role="tablist">
            ${segBtn('colorMode', 'tricolor', '三色', pr.colorMode)}
            ${segBtn('colorMode', 'mono', '單色', pr.colorMode)}
            ${segBtn('colorMode', 'high', '高對比', pr.colorMode)}
          </div>
          <span class="set-hint">三色（紅／黃／綠）對應動作品質，視覺最直覺</span>
        </div>
      </div>

      <!-- 隱私與資料 -->
      <div class="section-title">隱私與資料</div>
      <div class="card set-card stagger">
        <p class="set-note set-note-ok">資料全部留在本機，去識別化處理，不上傳雲端、不外流。</p>
        <div class="set-row set-data-btns">
          <button class="btn secondary" type="button" id="set-export">匯出我的資料</button>
          <button class="btn secondary" type="button" id="set-import">匯入資料</button>
          <input type="file" id="set-file" accept=".json,application/json" hidden />
        </div>
        <div class="set-row">
          <button class="btn set-danger" type="button" id="set-reset">清除所有資料</button>
        </div>
      </div>

      <!-- 關於 -->
      <div class="section-title">關於</div>
      <div class="card set-card set-about stagger">
        <div class="set-about-title">AI 健身辨識與島嶼建設連動系統</div>
        <div class="set-about-sub">育秀盃創意獎 · AI 應用類</div>
        <p class="set-about-blurb">
          用即時姿態辨識把每一次正確的動作，化為建設專屬島嶼的養分 — 把運動變好玩、變可累積。
        </p>
        <div class="set-pills">
          <span class="pill">MediaPipe Pose 33 點</span>
          <span class="pill">五層判定防線</span>
          <span class="pill">動作狀態機</span>
          <span class="pill">六層防作弊</span>
          <span class="pill">人體幾何標準化</span>
          <span class="pill">三色視覺＋分級語音回饋</span>
        </div>
        <div class="set-ver">示範版 · v1</div>
      </div>

      <div class="set-foot">Island Fitness AI</div>
    </div>`;

  wire();
  updateBmi();
}

function toggleRow(key, title, desc, on) {
  return `
    <div class="set-row set-toggle-row">
      <div class="set-toggle-txt">
        <span class="set-label">${esc(title)}</span>
        <span class="set-hint">${esc(desc)}</span>
      </div>
      <button class="set-switch ${on ? 'on' : ''}" type="button"
              role="switch" aria-checked="${on ? 'true' : 'false'}"
              data-toggle="${esc(key)}" aria-label="${esc(title)}">
        <span class="set-switch-knob"></span>
      </button>
    </div>`;
}

function segBtn(group, value, label, current) {
  return `<button class="set-seg-btn ${value === current ? 'on' : ''}" type="button"
            role="tab" aria-selected="${value === current ? 'true' : 'false'}"
            data-seg="${esc(group)}" data-val="${esc(value)}">${esc(label)}</button>`;
}

/* ---------------- 事件綁定 ---------------- */
function wire() {
  // 暱稱：失焦或 Enter 才儲存，避免每個字觸發 toast。
  const nick = $('#set-nick');
  const commitNick = () => {
    const v = nick.value.trim() || '島主';
    if (v === store.getState().profile.nickname) return;
    store.updateProfile({ nickname: v }); saved();
  };
  nick.addEventListener('blur', commitNick);
  nick.addEventListener('keydown', (e) => { if (e.key === 'Enter') { nick.blur(); } });

  // 頭像
  $('#set-avatars').addEventListener('click', (e) => {
    const b = e.target.closest('[data-av]'); if (!b) return;
    const av = b.dataset.av;
    $all('#set-avatars .set-avatar').forEach(x => x.classList.toggle('on', x === b));
    store.updateProfile({ avatar: av }); saved();
  });

  // 第三方登入（示範用）
  $all('[data-oauth]').forEach(b => b.addEventListener('click', () => {
    CTX.toast('示範版尚未串接第三方登入');
  }));

  // 個人資料：數字欄位（clamp 到合理範圍，超出範圍提示）
  bindNumber('#set-h', 'height_cm');
  bindNumber('#set-w', 'weight_kg');
  bindNumber('#set-age', 'age');

  $('#set-sex').addEventListener('change', (e) => {
    store.updateProfile({ sex: e.target.value }); saved();
  });

  // 提醒與目標
  bindRange('#set-daily', '#set-daily-v', (n) => `${n} 分鐘`, (n) => store.updatePrefs({ dailyGoalMin: n }));
  bindRange('#set-weekly', '#set-weekly-v', (n) => `${n} 天`, (n) => store.updatePrefs({ weeklyGoalDays: n }));

  // 互動偏好：開關
  $all('[data-toggle]').forEach(sw => sw.addEventListener('click', () => {
    const key = sw.dataset.toggle;
    const next = !sw.classList.contains('on');
    sw.classList.toggle('on', next);
    sw.setAttribute('aria-checked', next ? 'true' : 'false');
    store.updatePrefs({ [key]: next });
    if (key === 'voice') CTX.coach.setEnabled(next);
    saved();
  }));

  // 互動偏好：分段控制（難度 / 配色）
  $all('.set-seg').forEach(seg => seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-seg]'); if (!b) return;
    const group = b.dataset.seg, val = b.dataset.val;
    seg.querySelectorAll('[data-seg]').forEach(x => {
      const on = x === b;
      x.classList.toggle('on', on);
      x.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    store.updatePrefs({ [group]: val }); saved();
  }));

  // 隱私與資料
  $('#set-export').addEventListener('click', exportData);
  $('#set-import').addEventListener('click', () => $('#set-file').click());
  $('#set-file').addEventListener('change', importData);
  $('#set-reset').addEventListener('click', resetData);
}

function bindNumber(sel, key) {
  const el = $(sel);
  const r = RANGES[key];
  const commit = () => {
    const cur = store.getState().profile[key];
    const clamped = clampNum(el.value, r.min, r.max, cur);
    const outOfRange = el.value !== '' && Number(el.value) !== clamped;
    el.value = clamped;
    if (clamped !== cur) {
      store.updateProfile({ [key]: clamped });
      updateBmi();
      if (outOfRange) CTX.toast(`${r.label}已調整到 ${r.min}-${r.max} 範圍內`);
      else saved();
    } else if (outOfRange) {
      CTX.toast(`${r.label}已調整到 ${r.min}-${r.max} 範圍內`);
    }
  };
  el.addEventListener('blur', commit);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
}

function bindRange(inputSel, valSel, fmt, save) {
  const el = $(inputSel);
  const valEl = $(valSel);
  el.addEventListener('input', () => { valEl.textContent = fmt(Number(el.value)); });
  el.addEventListener('change', () => { save(Number(el.value)); saved(); });
}

function updateBmi() {
  const out = $('#set-bmi'); if (!out) return;
  const { height_cm, weight_kg } = store.getState().profile;
  const h = Number(height_cm) / 100;
  if (!h || !weight_kg) { out.textContent = ''; return; }
  const bmi = weight_kg / (h * h);
  out.textContent = `目前 BMI 約 ${bmi.toFixed(1)} — 這些數值會即時影響熱量估算與動作標準化。`;
}

/* ---------------- 隱私與資料 ---------------- */
function exportData() {
  try {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'island-fitness-data.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    CTX.toast('已匯出 island-fitness-data.json');
  } catch {
    CTX.toast('匯出失敗，請再試一次');
  }
}

function importData(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // 允許重複匯入同檔
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const ok = store.importJSON(String(reader.result || ''));
    CTX.toast(ok ? '匯入成功' : '匯入失敗：檔案格式不正確');
    if (ok) render();
  };
  reader.onerror = () => CTX.toast('讀取檔案失敗');
  reader.readAsText(file);
}

function resetData() {
  const ok = window.confirm('確定要清除所有資料嗎？此動作無法復原，島嶼與紀錄都會回到初始狀態。');
  if (!ok) return;
  store.reset();
  CTX.toast('已清除所有資料');
  render();
}
