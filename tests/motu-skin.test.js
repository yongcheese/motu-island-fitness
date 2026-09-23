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
