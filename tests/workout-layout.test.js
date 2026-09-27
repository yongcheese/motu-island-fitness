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

/* ---------- Slice 13：結算頁 ---------- */
import { gradeInfo } from '../app/features/workout/workout.js';
import { grade as coreGrade } from '../app/core/rewards.js';

test('Slice 13：gradeInfo 說清楚「評等怎麼來、到多少升級」', () => {
  const c = gradeInfo('C', 0, 3);
  assert(c.name === '再加油' && c.rate === 0 && c.hint.includes('60%') && c.hint.includes('B'), JSON.stringify(c));
  const a = gradeInfo('A', 8, 2);
  assert(a.rate === 80 && a.hint.includes('90%') && a.hint.includes('S'), JSON.stringify(a));
  const s = gradeInfo('S', 10, 0);
  assert(s.hint.includes('最高'), JSON.stringify(s));
});

test('Slice 13：沒有任何動作時達標率是 null（畫面顯示 —），不是 0%', () => {
  const g = gradeInfo('C', 0, 0);
  assert(g.rate === null && g.hint.includes('沒有偵測到'), JSON.stringify(g));
});

test('Slice 13：顯示的達標率與評等永遠一致（對照 core/rewards.js 的 grade，0–40 下全組合）', () => {
  const min = { C: 0, B: 60, A: 75, S: 90 }, order = ['C', 'B', 'A', 'S'];
  for (let t = 1; t <= 40; t++) for (let v = 0; v <= t; v++) {
    const r = v / t, g = coreGrade({ targetRate: r, validRate: r });
    const gi = gradeInfo(g, v, t - v);
    const next = order[order.indexOf(g) + 1];
    assert(gi.rate >= min[g] && (!next || gi.rate < min[next]), `${v}/${t}：顯示 ${gi.rate}% 卻是 ${g}`);
  }
});

const sum = js.slice(js.indexOf('function renderResult('), js.indexOf('/* 彩帶（Slice 13）'));

test('Slice 13：評等字母一定配「評等」字樣與白話名稱；沒有動作時不打評等', () => {
  assert(/<span class="wk-sum-grade-k">評等<\/span>\s*<b>\$\{gi\.grade\}<\/b>\s*<span class="wk-sum-grade-n">\$\{gi\.name\}<\/span>/.test(sum), '評等章結構不對');
  assert(sum.includes('${total ? `<div class="wk-sum-grade"'), '0 下時仍會顯示評等');
  assert(!js.includes('wk-grade-ring'), '舊的單獨字母圓環還在');
});

test('Slice 13：結算與獎勵合成一頁，不再有「領取獎勵」這一步（金幣在結束時已入帳）', () => {
  assert(!/領取獎勵[^」]*<\/button>/.test(js) && !js.includes('id="wk-done"') && !js.includes('function renderReward'), '還有領取獎勵頁');
  for (const k of ['wk-sum-hero', 'wk-sum-reward', 'wk-sum-notes', 'id="wk-rw-num"', 'id="wk-rw-island"', 'gameResourceCard(session)']) assert(sum.includes(k), `結算頁缺 ${k}`);
});

test('Slice 13：彩帶只在有有效次數時放，且尊重減少動態、不擋操作', () => {
  assert(/if \(summary\.validReps > 0\) launchConfetti\(\)/.test(sum), '彩帶觸發條件不對');
  const fn = js.slice(js.indexOf('function launchConfetti()'), js.indexOf('function launchConfetti()') + 400);
  assert(fn.includes('if (reducedMotion()'), '彩帶沒檢查減少動態');
  assert(/\.wk-confetti \{[^}]*pointer-events: none/.test(css), '彩帶會擋點擊');
  assert(/prefers-reduced-motion[\s\S]*\.wk-confetti \{ display: none; \}/.test(css), 'CSS 減少動態沒關彩帶');
});

test('Slice 13 審查修正：rwClear 會移除掛在 body 的彩帶與飛行金幣（切頁、鍵盤操作都會走到）', () => {
  const fn = js.slice(js.indexOf('function rwClear()'), js.indexOf('function rwClear()') + 500);
  assert(fn.includes(`querySelectorAll('.wk-coin-fly, .wk-confetti')`) && fn.includes('.remove()'), fn);
  assert(/unmount\(\) \{[^}]*rwClear\(\)/.test(js), 'unmount 沒呼叫 rwClear');
  assert(!/#[0-9A-Fa-f]{6}/.test(js.slice(js.indexOf('function launchConfetti()'), js.indexOf('function launchConfetti()') + 2500)), '彩帶有寫死色碼');
});

/* ---------- 合體第二階段整合 Slice 8：訓練畫面數據列／控制鈕／提示定案版位 ---------- */
const shell = js.slice(js.indexOf('function liveShell('), js.indexOf('function gaugeTargetOf('));
const fxRule = (sel) => rule('.lv-fx ' + sel);
// 手機媒體查詢（≤620px）裡的整合版規則：取最後一個含 .lv-fx .lv-prompts 的 max-width: 620px 區塊
const phone = (() => { const i = css.lastIndexOf('.lv-fx .lv-prompts { left:'); return i < 0 ? '' : css.slice(css.lastIndexOf('@media (max-width: 620px)', i), css.indexOf('\n}', i)); })();

test('Slice 8：動作指引與教練提示收在同一個 .lv-prompts 欄，指引在上、提示在下，且在狀態層之前（倒數／說明卡蓋在提示上）', () => {
  const p = shell.slice(shell.indexOf('<div class="lv-prompts">'));
  assert(shell.includes('<div class="lv-prompts">'), '缺 .lv-prompts');
  const n = p.indexOf('id="lv-next"'), c = p.indexOf('id="lv-coach"'), end = p.indexOf('</div>\n      </div>');
  assert(n > 0 && c > n && c < end, `順序或包含關係不對 next=${n} coach=${c} end=${end}`);
  assert(shell.indexOf('<div class="lv-prompts">') < shell.indexOf('id="lv-status"'), '提示欄要在狀態層之前');
  assert((js.match(/id="lv-coach"/g) || []).length === 1 && (js.match(/id="lv-next"/g) || []).length === 1, 'id 重複');
});

test('Slice 8：舊版不受影響 —— .lv-prompts 在沒有 .lv-fx 時是 display: contents，指引／提示仍用原本的絕對定位', () => {
  assert(/^\.lv-prompts \{ display: contents; \}/m.test(css), '舊版 .lv-prompts 不是 display: contents');
  assert(/bottom: 168px/.test(rule('.lv-wrap .lv-coach') || '') && /bottom: 272px/.test(rule('.lv-next') || ''), '舊版位置被改了');
});

test('Slice 8：由下往上依序是數據列（貼底）→ 控制鈕 → 提示欄，位置都由 --lv-hud-h 推算', () => {
  assert(/bottom: calc\(env\(safe-area-inset-bottom\) \+ 12px\)/.test(fxRule('.lv-hud') || ''), '數據列沒貼底');
  assert(/--lv-ctrls-bottom: calc\(env\(safe-area-inset-bottom\) \+ 12px \+ var\(--lv-hud-h\) \+ 12px\)/.test(rule('.lv-fx') || ''), '控制鈕沒排在數據列上方');
  assert(/bottom: var\(--lv-ctrls-bottom\)/.test(fxRule('.lv-ctrls') || ''), '控制鈕沒用 --lv-ctrls-bottom');
  const p = fxRule('.lv-prompts') || '';
  assert(/position: absolute/.test(p) && /bottom: calc\(var\(--lv-ctrls-bottom\) \+ 48px \+ 16px\)/.test(p), '提示欄沒排在控制鈕（48px）上方');
  assert(/flex-direction: column/.test(p) && /pointer-events: none/.test(p), '提示欄要直排堆疊且不擋點擊');
  assert(!/\.lv-fx \.lv-coach \{ bottom:/.test(css), '還留著提示單獨定位的舊規則，會跟堆疊打架');
});

test('Slice 8：堆疊裡指引／提示改為一般流排版，折行變高時互相推開（不再各自 absolute）', () => {
  for (const s of ['.lv-prompts .lv-coach', '.lv-prompts .lv-next']) {
    const r = fxRule(s) || '';
    assert(/position: static/.test(r) && /transform: none/.test(r), `${s}：${r}`);
  }
  assert(/transform: scale\(1\.06\)/.test(fxRule('.lv-prompts .lv-next[data-p="hit"]') || ''), '到位放大效果沒保留（且不能再帶 translateX(-50%)）');
});

test('Slice 8：手機直式讓出左側阿肌欄（≤30vw＋左距 16px）與右側深度量表欄', () => {
  assert(phone.length > 0, '找不到手機版整合規則');
  assert(phone.includes('.lv-fx .lv-prompts { left: calc(16px + 30vw + 8px); right: 64px; }'), phone);
  // 阿肌手機版寬度上限必須仍是 30vw，否則上一條讓位就不夠
  const bd = readFileSync(join(root, 'motu-app/src/components/fitness/CoachBackdrop.tsx'), 'utf8');
  assert(/W \* 0\.3\)/.test(bd), 'CoachBackdrop 阿肌寬度上限不是 30%，提示欄讓位要跟著改');
  // 量表右距 18px＋寬 40px（含標籤）= 58px < 64px
  assert(/right: 18px/.test(rule('.lv-gauge') || ''), '量表右距變了');
});

test('Slice 8：手機直式深度量表從陪伴主角下方開始、軌道縮短，不壓到主角也不碰控制鈕', () => {
  const top = phone.match(/\.lv-fx \.lv-gauge \{ top: calc\(env\(safe-area-inset-top\) \+ (\d+)px\); transform: none; \}/);
  const comp = phone.match(/\.lv-fx \.fx-slot-companion \{ top: calc\(env\(safe-area-inset-top\) \+ (\d+)px\)/);
  assert(top && comp, '缺量表或陪伴主角的手機規則');
  // 陪伴主角 150px 起、縮 0.85 後連兩行台詞約 190px 高
  assert(+top[1] >= +comp[1] + 190, `量表 ${top[1]}px 會壓到陪伴主角（${comp[1]}px 起）`);
  assert(phone.includes('.lv-fx .lv-gauge-track { height: min(160px, 22vh); }'), '軌道沒縮短');
  // 最矮情況：量表頂 340 + 軌道 160 + 標籤約 30 = 530，必須在 740 高手機的控制鈕（584）之上
  assert(+top[1] + 160 + 30 < 584, '量表會碰到控制鈕');
});

test('Slice 8：控制鈕觸控區 ≥44px', () => {
  assert(/width: 48px; height: 48px/.test(rule('.lv-wrap .lv-btn') || ''), '控制鈕小於 44px');
});
