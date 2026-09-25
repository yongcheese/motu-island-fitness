// 合體第二階段 Slice 11–13：訓練頁版面（左上資訊卡、取景關卡、結算畫面）。
// 以原始碼字串檢查結構與樣式約束（liveShell 等模板依賴執行期 DOM，不直接呼叫）。
import { test, assert } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const js = readFileSync(join(root, 'app/features/workout/workout.js'), 'utf8');
const css = readFileSync(join(root, 'app/features/workout/workout.css'), 'utf8');
const rule = (sel) => { const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')); return m ? m[1] : null; };

/* ---------- Slice 11：左上資訊卡 ---------- */
const head = js.slice(js.indexOf('<div class="lv-head">'), js.indexOf('<div class="lv-zoom"'));

test('Slice 11：結束鈕、動作名、模式、追蹤狀態、步驟條都收在同一張 .lv-head 卡裡', () => {
  assert(head.length > 0, '找不到 .lv-head');
  for (const id of ['id="lv-exit"', 'class="lv-title"', 'id="lv-modebadge"', 'id="lv-track"', 'id="lv-stages"']) assert(head.includes(id), `卡片裡缺 ${id}`);
});

test('Slice 11：舊的散落膠囊容器 .lv-hudtop 已移除（JS 與 CSS 都沒有）', () => {
  assert(!js.includes('lv-hudtop') && !css.includes('.lv-hudtop'), '還有 lv-hudtop');
});

test('Slice 11：步驟條四個階段依序排列，且 hud.stages 仍以 span 取得（計次燈接線不變）', () => {
  const stages = head.slice(head.indexOf('id="lv-stages"'));
  const order = ['起始', '進行', '達標', '回復'].map(t => stages.indexOf(`<span>${t}</span>`));
  assert(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), `順序 ${order}`);
  assert(js.includes(`querySelectorAll('#lv-stages span')`), 'hud.stages 選擇器變了');
});

test('Slice 11：階段是指示器不是按鈕 —— span 沒有外框、背景、陰影', () => {
  const r = rule('.lv-stages span');
  assert(r, '找不到 .lv-stages span 規則');
  for (const p of ['border:', 'background:', 'box-shadow:', 'padding:']) assert(!r.includes(p), `階段仍有 ${p}`);
});

test('Slice 11：追蹤狀態不再是獨立膠囊（沒有外框與陰影），狀態色改放小圓點', () => {
  const r = rule('.lv-track');
  assert(r && !r.includes('border:') && !r.includes('box-shadow:'), r);
  assert(css.includes('.lv-track[data-s="ok"]::before'), '缺狀態圓點');
});

test('Slice 11：結束鈕仍是可聚焦、≥44px 的按鈕，有 aria-label', () => {
  assert(/<button class="lv-exit" id="lv-exit" type="button" aria-label="[^"]+"/.test(head), '結束鈕缺 type／aria-label');
  assert(/min-height:\s*44px/.test(rule('.lv-wrap .lv-exit') || ''), '結束鈕小於 44px');
});

/* ---------- Slice 12：取景關卡 ---------- */
const gate = js.slice(js.indexOf('function gateHtml()'), js.indexOf('// 組間休息卡'));

test('Slice 12：跳過鈕只在「偵測一直過不了？」說明區塊裡，且附後果說明', () => {
  const alt = gate.slice(gate.indexOf('class="lv-gate-alt"'));
  assert(gate.includes('class="lv-gate-alt" hidden'), '說明區塊預設要隱藏');
  assert(alt.includes('偵測一直過不了') && alt.includes('lv-gate-skip') && alt.includes('計次可能不準'), '缺說明或後果');
});

test('Slice 12：跳過鈕是次要文字鈕（沒有 .btn 膠囊造型），觸控區 ≥44px', () => {
  assert(!/class="[^"]*\bbtn\b[^"]*lv-gate-skip/.test(gate) && !/lv-gate-skip[^"]*\bbtn\b/.test(gate), '跳過鈕仍套 .btn');
  const r = rule('.lv-gate-skip');
  assert(r && r.includes('background: none') && r.includes('text-decoration: underline') && /min-height:\s*44px/.test(r), r);
});

test('Slice 12：主訊息講清楚「會自動開始」，檢查項是清單不是膠囊', () => {
  assert(gate.includes('自動開始'), '缺自動開始說明');
  assert(gate.includes('<ul class="lv-gate-checks"') && gate.includes('<li class="lv-gate-chk'), '檢查項不是清單');
  const r = rule('.lv-gate-chk');
  assert(r && !r.includes('border:') && !r.includes('box-shadow:') && !r.includes('padding:'), '檢查項仍是膠囊');
});

test('Slice 12：10 秒後現身的是整個說明區塊；保持 2 秒有進度條', () => {
  assert(/alt\.hidden && gateMs >= 10000\) alt\.hidden = false/.test(js), '10 秒現身邏輯沒接到 .lv-gate-alt');
  assert(/bar\.style\.width = Math\.min\(100, readyMs \/ 20\)/.test(js), '進度條沒跟 readyMs 連動');
});

test('Slice 12：取景期間隱藏深度量表，結束關卡時移除', () => {
  assert(js.includes(`wrap?.classList.add('is-gating')`) && js.includes(`wrap?.classList.remove('is-gating')`), 'is-gating 未成對');
  assert(css.includes('.lv-wrap.is-gating .lv-gauge { display: none; }'), '缺 CSS');
});
