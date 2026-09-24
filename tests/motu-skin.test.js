// 合體第一階段 Slice 1：遊戲組 Motu 樣式基礎的鎖。
//   ① motu.css 必須和遊戲組原檔的 motu-contract 區段逐字相同（改一個字就失敗）
//   ② motu.css 不得夾帶 Tailwind 的全域 reset 或外部資源
//   ③ motu-skin.css 必須把 lumina.css 的每一個變數重新對應，漏一個就會殘留舊的深色主題
//   ④ motu-skin.css 不得自創顏色，只能引用 --motu-*（色票由遊戲組定案）
import { test, eq, assert } from './harness.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gameResourceCard } from '../app/features/workout/workout.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const MARKER = '/* ---- MOTU-CONTRACT VERBATIM BELOW ---- */\n';
const CONTRACT_SHA256 = '443e237c9d79bfd24ea50b3889496cac609bdf9a39ebb6de7632a4c7b62bba81';

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// 取出第一個 `:root { ... }` 區塊裡宣告的自訂屬性名稱
function rootVars(css) {
  const m = stripComments(css).match(/:root\s*\{([^}]*)\}/);
  assert(m, '找不到 :root 區塊');
  return [...m[1].matchAll(/(--[\w-]+)\s*:/g)].map(x => x[1]);
}

/* ---------- ① 逐字相同 ---------- */
test('motu.css 分隔線之後的內容與遊戲組原檔 motu-contract 區段雜湊一致', () => {
  const css = read('app/styles/motu.css');
  const at = css.indexOf(MARKER);
  assert(at >= 0, '找不到逐字區段的分隔線');
  const body = css.slice(at + MARKER.length);
  eq(createHash('sha256').update(body, 'utf8').digest('hex'), CONTRACT_SHA256, '逐字區段被改過');
  assert(body.startsWith('/* ====') && body.includes('@layer motu-contract {'), '區段起點不對');
});

/* ---------- ② 不含 preflight 與外部資源 ---------- */
test('motu.css 不含 Tailwind preflight、不含 url(', () => {
  const css = read('app/styles/motu.css');
  assert(!/@layer\s+base/.test(css), '不得含 @layer base');
  assert(!/\*\s*,\s*::before/.test(css), '不得含 *, ::before 全域重設');
  assert(!css.includes('url('), '不得含 url(');
  assert(!/@import/.test(css), '不得含 @import');
  // 只允許一個頂層 layer：motu-contract
  const layers = [...stripComments(css).matchAll(/@layer\s+([\w-]+)/g)].map(m => m[1]);
  eq(JSON.stringify([...new Set(layers)]), JSON.stringify(['motu-contract']));
});

/* ---------- ③ lumina 變數全數重新對應 ---------- */
test('motu-skin.css 重新定義 lumina.css :root 的每一個變數（含 --grad-*）', () => {
  const lumina = rootVars(read('app/styles/lumina.css'));
  const skin = new Set(rootVars(read('app/styles/motu-skin.css')));
  // 邊界：漸層變數最容易漏，而且漏了會留下舊主題的霓虹漸層
  const grads = lumina.filter(v => v.startsWith('--grad-'));
  assert(grads.length >= 3, 'lumina 應有 --grad-accent/--grad-teal/--grad-card');
  assert(lumina.length >= 25, `lumina 變數數量異常（${lumina.length}），解析可能失敗`);
  const missing = lumina.filter(v => !skin.has(v));
  eq(missing.join(','), '', '以下變數沒有被 motu-skin.css 重新對應');
});

test('motu-skin.css 的重新對應都指向 --motu-*（顏色類變數不得留舊值）', () => {
  const block = stripComments(read('app/styles/motu-skin.css')).match(/:root\s*\{([^}]*)\}/)[1];
  const decls = [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)];
  const colorish = /^--(bg-|surface|stroke|text|muted|faint|green|teal|mint|coral|gold|yellow|red|frame-|grad-|shadow|glow|radius)/;
  const bad = decls.filter(([, name, val]) => colorish.test(name) && !/var\(--motu-/.test(val)).map(d => d[1]);
  eq(bad.join(','), '', '這些變數沒有引用 --motu-* token');
});

/* ---------- ④ 不得自創顏色 ---------- */
test('motu-skin.css 不出現 --motu-* 以外的色值', () => {
  const css = stripComments(read('app/styles/motu-skin.css'))
    .replace(/url\([^)]*\)/g, '')          // 字型路徑不是顏色
    .replace(/var\(--[\w-]+\)/g, 'VAR');   // --motu-white 這類名稱不算
  const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  const fn = css.match(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g) || [];
  const named = css.match(/:[^;{}]*\b(white|black|red|blue|green|gray|grey|orange|yellow)\b/g) || [];
  eq([...hex, ...fn, ...named].join(' | '), '', '發現自創色值');
});

test('色值偵測本身有效：塞一個寫死色會被抓到（防止測試空轉）', () => {
  const probe = ':root { --x: #FFF; } .a { color: rgba(0,0,0,.5); background: white; }';
  const s = stripComments(probe).replace(/var\(--[\w-]+\)/g, 'VAR');
  assert(/#[0-9a-fA-F]{3,8}\b/.test(s) && /\brgba?\(/.test(s) && /:[^;{}]*\bwhite\b/.test(s));
});

/* ---------- 載入順序與字型 ---------- */
test('index.html 在 lumina.css 之後依序載入 motu.css、motu-skin.css，theme-color 為奶油色', () => {
  const html = read('index.html');
  const iL = html.indexOf('styles/lumina.css'), iM = html.indexOf('styles/motu.css'), iS = html.indexOf('styles/motu-skin.css');
  assert(iL > 0 && iM > iL && iS > iM, 'motu.css、motu-skin.css 必須排在 lumina.css 之後');
  const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
  eq(links[links.length - 1], './app/styles/motu-skin.css', 'motu-skin.css 必須最後載入才能蓋過前面');
  assert(/name="theme-color" content="#F8F6F1"/i.test(html), 'theme-color 應為 --motu-cream');
});

test('Inter 800/900 字型已放在本機並有 @font-face', () => {
  const skin = read('app/styles/motu-skin.css');
  for (const w of [800, 900]) {
    const buf = readFileSync(join(root, `vendor/fonts/inter-${w}.woff2`));
    eq(buf.subarray(0, 4).toString('latin1'), 'wOF2', `inter-${w}.woff2 不是 woff2`);
    assert(new RegExp(`font-weight:\\s*${w};[^}]*inter-${w}\\.woff2`).test(skin), `缺 Inter ${w} 的 @font-face`);
  }
});

/* ---------- Slice 5：微互動與動效對齊 Motu ---------- */
// 範圍內 CSS：訓練頁 + 換皮層。transition／animation 的時長一律走 --motu-duration-*，不得寫死秒數。
const MOTION_FILES = ['app/features/workout/workout.css', 'app/styles/motu-skin.css'];

// 去掉 `@media (prefers-reduced-motion: reduce) { ... }` 區塊（括號需配對：區塊裡還有巢狀規則）
function dropReducedMotion(css) {
  let out = '', i = 0;
  const re = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g;
  for (let m; (m = re.exec(css)); ) {
    out += css.slice(i, m.index);
    let depth = 1, j = re.lastIndex;
    while (j < css.length && depth > 0) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    i = re.lastIndex = j;
  }
  return out + css.slice(i);
}

// 回傳寫死時長的 transition／animation 宣告（`0s` 例外：它的意思是「沒有時長」）
function hardcodedMotion(css) {
  const body = dropReducedMotion(stripComments(css));
  const bad = [];
  for (const [, prop, val] of body.matchAll(/(?:^|[;{\s])((?:transition|animation)(?:-[\w-]+)?)\s*:\s*([^;{}]+)/g)) {
    const times = [...val.matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)].filter(t => Number(t[1]) !== 0);
    if (times.length) bad.push(`${prop}: ${val.trim()}`);
  }
  return bad;
}

test('範圍內 CSS 的 transition／animation 沒有寫死的時長（全部走 --motu-duration-*）', () => {
  for (const f of MOTION_FILES) {
    const bad = hardcodedMotion(read(f));
    eq(bad.join(' | '), '', `${f} 仍有寫死時長`);
  }
});

test('寫死時長偵測本身有效：抓得到 .2s／120ms，放過 0s、token 與 reduced-motion 區塊（邊界）', () => {
  const probe = `.a { transition: opacity .2s, transform var(--motu-duration-fast); }
    .b { animation: x 120ms var(--motu-ease-out) both; }
    .c { transition: none 0s; animation-delay: calc(var(--i) * var(--motu-duration-fast) / 4); transform: scale(.98); }
    @media (prefers-reduced-motion: reduce) { .d { transition-duration: 0.001ms !important; } .e { animation: none; } }`;
  const bad = hardcodedMotion(probe);
  eq(bad.length, 2, `應只抓到 .a 與 .b：${bad.join(' | ')}`);
  assert(bad[0].includes('.2s') && bad[1].includes('120ms'));
});

test('範圍內可按壓元素的 :active 縮放一律是 Motu 的 scale(.98)', () => {
  for (const f of MOTION_FILES) {
    const css = stripComments(read(f));
    const scales = [...css.matchAll(/:active[^{]*\{[^}]*scale\(([\d.]+)\)/g)].map(m => Number(m[1]));
    assert(scales.length > 0, `${f} 沒有任何 :active 縮放（掃描可能失效）`);
    eq(scales.filter(s => s !== 0.98).join(','), '', `${f} 有非 .98 的按壓縮放`);
  }
  assert(/\.btn:active\s*\{[^}]*scale\(\.98\)/.test(stripComments(read('app/styles/motu-skin.css'))), '.btn 缺按壓回饋');
});

test('motu-skin.css 為所有可聚焦元素提供 focus-visible 外框（--motu-color-focus）', () => {
  const css = stripComments(read('app/styles/motu-skin.css'));
  const m = css.match(/(?:^|\})\s*:focus-visible\s*\{([^}]*)\}/);
  assert(m, '缺全域 :focus-visible 規則');
  assert(/outline:\s*2px solid var\(--motu-color-focus\)/.test(m[1]), 'focus 外框要用 --motu-color-focus');
});

test('reduced-motion：全域停掉無限循環動畫（iteration-count 1），不只縮短時長', () => {
  const css = stripComments(read('app/styles/motu-skin.css'));
  const block = css.length - dropReducedMotion(css).length;
  assert(block > 0, 'motu-skin.css 缺 prefers-reduced-motion 區塊');
  assert(/prefers-reduced-motion[\s\S]*animation-iteration-count:\s*1\s*!important/.test(css), '缺 animation-iteration-count: 1');
});

test('可領取脈動 .motu-is-claimable 引用的 keyframes 已在本機定義（motu.css 只有引用）', () => {
  const motu = read('app/styles/motu.css');
  assert(/\.motu-is-claimable[^{]*\{[^}]*fragment-ready-pulse/.test(motu), 'motu.css 應有 claimable 規則');
  const wk = stripComments(read('app/features/workout/workout.css'));
  assert(/@keyframes fragment-ready-pulse\s*\{/.test(wk), 'workout.css 缺 @keyframes fragment-ready-pulse');
});

test('碎片／抽獎券膠囊套用 .motu-is-claimable；只有一項時也只有一顆在脈動（邊界）', () => {
  const both = gameResourceCard({ shards: 2, tickets: 1 });
  eq((both.match(/motu-is-claimable/g) || []).length, 2, '兩顆膠囊都要脈動');
  eq((gameResourceCard({ shards: 0, tickets: 1 }).match(/motu-is-claimable/g) || []).length, 1);
  eq(gameResourceCard({ shards: 0, tickets: 0 }), '', '全 0 仍不渲染');
});

// 只切頂層逗號（:is(a, b) 裡的逗號不切）
function splitSelectors(sel) {
  const out = []; let depth = 0, cur = '';
  for (const ch of sel) {
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  return [...out, cur.trim()].filter(Boolean);
}

test('workout.css 每一個播放 keyframes 的選擇器，在 reduced-motion 區塊都有被另行處理', () => {
  const css = stripComments(read('app/features/workout/workout.css'));
  const outside = dropReducedMotion(css).replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  const reduced = css.slice(css.search(/@media\s*\(\s*prefers-reduced-motion/));
  const users = [...outside.matchAll(/([^{}]+)\{[^}]*\banimation\s*:\s*(?!none)[^;}]+/g)]
    .flatMap(m => splitSelectors(m[1].trim()));
  assert(users.length >= 8, `掃到的動畫選擇器太少（${users.length}），解析可能失效`);
  const missing = users.filter(sel => !reduced.includes(sel));
  eq(missing.join(' | '), '', '這些動畫在減少動態模式下沒有被關掉');
});

test('減少動態下計次閃現仍看得到：不縮放、不位移，只有顯示與消失（邊界：判定回饋不能被關掉）', () => {
  const css = stripComments(read('app/features/workout/workout.css'));
  const reduced = css.slice(css.search(/@media\s*\(\s*prefers-reduced-motion/));
  const rule = reduced.match(/\.lv-repflash\.pop\s*\{([^}]*)\}/);
  assert(rule && /lvRepHold/.test(rule[1]) && /steps\(1/.test(rule[1]), '閃現應改用 lvRepHold + steps(1)');
  const kf = css.match(/@keyframes lvRepHold\s*\{([^]*?\})\s*\}/);
  assert(kf && !/transform/.test(kf[1]), 'lvRepHold 不得有 transform');
});
