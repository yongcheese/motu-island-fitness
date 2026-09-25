// 合體第二階段 Slice 4：外殼「建造」鈕接到島嶼、主頁隱藏島嶼自帶浮層。
//   ① 島嶼模組提供選用的 openBuild，未掛載時呼叫不得出錯
//   ② main.js 對「沒有 openBuild 的島嶼模組」有保護，並退回提示
//   ③ 外殼模式只隱藏重複的浮層，建造需要的商店抽屜與擺放列保留
import { test, eq, assert } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import island from '../app/features/island/island.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const MAIN = read('app/main.js');
const ISL_JS = read('app/features/island/island.js');
const ISL_CSS = read('app/features/island/island.css').replace(/\/\*[\s\S]*?\*\//g, '');

/* ---------- ① 島嶼模組的選用契約 ---------- */
test('島嶼模組：提供 openBuild 函式，且既有 mount/unmount/onShow 不變', () => {
  eq(typeof island.openBuild, 'function', 'island 應 export openBuild');
  for (const k of ['mount', 'unmount', 'onShow']) eq(typeof island[k], 'function', `${k} 應保留`);
});

test('島嶼模組：尚未掛載就呼叫 openBuild 不拋錯、不回傳東西（邊界）', () => {
  let r;
  try { r = island.openBuild(); } catch (e) { assert(false, `未掛載時不應拋錯：${e.message}`); }
  eq(r, undefined);
});

test('島嶼模組：收到 ctx.hideOverlay 才掛上外殼模式 class', () => {
  assert(/if \(ctx\.hideOverlay\)[^\n]*classList\.add\('isl-shelled'\)/.test(ISL_JS), 'mount 應依 ctx.hideOverlay 加上 isl-shelled');
});

/* ---------- ② main.js 的接線與保護 ---------- */
test('main.js：建造鈕呼叫 openBuild，而不是只切回主頁', () => {
  assert(/dataset\.act === 'build'\) \{ openBuild\(\); return; \}/.test(MAIN), '建造鈕應走 openBuild()');
});

test('main.js：島嶼模組沒有 openBuild 時只跳提示（邊界：模組缺這個方法）', () => {
  const fn = MAIN.slice(MAIN.indexOf('function openBuild()'));
  assert(fn.length > 0, '找不到 openBuild()');
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert(/show\('island'\)/.test(body), '應先切到主頁');
  assert(/typeof island\?\.openBuild !== 'function'\) \{ ctx\.toast\(/.test(body), '缺方法時應跳提示並返回');
  assert(/try \{ island\.openBuild\(\); \} catch/.test(body), '呼叫應包在 try/catch，模組出錯不影響外殼');
});

test('main.js：島嶼仍只拿受限 store，另帶 hideOverlay 旗標', () => {
  assert(/id === 'island' \? \{ \.\.\.ctx, store: islandStore \} : ctx/.test(MAIN), '島嶼 ctx 應是受限 store');
  assert(/if \(id === 'island'\) featCtx\.hideOverlay = true;/.test(MAIN), '只有島嶼帶 hideOverlay（不得寫進共用 ctx）');
  assert(!/^\s*hideOverlay:/m.test(MAIN.slice(MAIN.indexOf('const ctx = {'), MAIN.indexOf('};', MAIN.indexOf('const ctx = {')))), '共用 ctx 不應帶 hideOverlay');
  assert(/openBuild\?\(\)/.test(MAIN), 'feature 契約註解應記載選用的 openBuild?()');
});

/* ---------- ③ 外殼模式的 CSS ---------- */
test('island.css：外殼模式隱藏左側鈕、縮放、目標條、提示、成就列', () => {
  const rule = ISL_CSS.match(/((?:\.isl-shelled \.isl-[a-z-]+,?\s*)+)\{\s*display:\s*none;?\s*\}/);
  assert(rule, '找不到 .isl-shelled 的 display:none 規則');
  const hidden = [...rule[1].matchAll(/\.isl-shelled (\.isl-[a-z-]+)/g)].map(m => m[1]).sort();
  eq(hidden.join(' '), ['.isl-ach', '.isl-goal', '.isl-hint', '.isl-left', '.isl-right'].join(' '));
});

test('island.css：商店抽屜與擺放列不在隱藏名單，只在收合時才不可見', () => {
  const noneRules = [...ISL_CSS.matchAll(/([^{}]+)\{[^}]*display:\s*none/g)].map(m => m[1]);
  for (const sel of noneRules) {
    assert(!/\.isl-shelled \.isl-(sheet|place-bar)\b/.test(sel), `建造用元件不應被 display:none：${sel.trim()}`);
  }
  assert(/\.isl-shelled \.isl-sheet:not\(\.open\)/.test(ISL_CSS), '抽屜只在未開啟時隱藏');
  assert(/\.isl-shelled \.isl-place-bar:not\(\.show\)/.test(ISL_CSS), '擺放列只在未顯示時隱藏');
});

test('island.css：商店抽屜開啟時，外殼直欄與右下按鈕讓位（不擋品項）', () => {
  for (const cls of ['sh-rail', 'sh-corner']) {
    const re = new RegExp(`#view:has\\(\\.isl-shelled \\.isl-sheet\\.open\\) ~ #shell \\.${cls}`);
    assert(re.test(ISL_CSS), `抽屜開啟時應隱藏 .${cls}`);
  }
  // 邊界：只在抽屜開啟時讓位，不得無條件隱藏外殼按鈕
  const sels = ISL_CSS.split(/[{}]/).filter((_, i) => i % 2 === 0).flatMap(g => g.split(','))
    .map(x => x.trim()).filter(x => /\.sh-(rail|corner)\b/.test(x));
  eq(sels.length, 2, `預期 2 個選擇器，實得 ${sels.length}`);
  for (const sel of sels) assert(sel.startsWith('#view:has(.isl-shelled .isl-sheet.open) ~ #shell'), `不得無條件隱藏外殼按鈕：${sel}`);
});
