// 合體 Slice 6：文字對比的鎖。
//   ① contrastRatio 本身算得對（WCAG 已知值）
//   ② 訓練頁實際用到的每一組「文字色 × 底色」都達標 —— 色值直接從 motu.css 解析，
//      之後遊戲組換色，這裡會自動重驗，不必手動更新數字。
import { test, eq, assert } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseColor, over, mix, luminance, contrastRatio, passesAA } from '../app/ui/contrast.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

/* ---------- ① 算法 ---------- */
test('contrastRatio：黑白 21:1、同色 1:1（邊界）、順序無關', () => {
  assert(near(contrastRatio('#000', '#fff'), 21), `黑白應為 21，得到 ${contrastRatio('#000', '#fff')}`);
  eq(contrastRatio('#264653', '#264653'), 1, '同色應為 1');
  eq(contrastRatio('#fff', '#000'), contrastRatio('#000', '#fff'), '前景背景對調結果應相同');
});

test('contrastRatio：與 WCAG 參考值一致（#767676 on 白 = 4.54，恰好過 AA 的最淺灰）', () => {
  const r = contrastRatio('#767676', '#ffffff');
  assert(near(r, 4.54), `得到 ${r}`);
  assert(passesAA(r) && !passesAA(contrastRatio('#777777', '#ffffff')), '4.5 門檻邊界判錯');
  assert(passesAA(3, { large: true }) && !passesAA(2.99, { large: true }), '大字 3:1 門檻邊界判錯');
});

test('parseColor／mix／over：與 CSS color-mix、半透明疊色的結果一致', () => {
  eq(JSON.stringify(parseColor('#1F7A70')), JSON.stringify({ r: 31, g: 122, b: 112, a: 1 }));
  eq(parseColor('rgba(38, 70, 83, 0.5)').a, 0.5);
  eq(parseColor('#0000').a, 0);
  const cm = parseColor('color(srgb 0.184314 0.839216 0.776471 / 0.14)');   // Chrome 對 color-mix 的計算值
  assert(near(cm.r, 47) && near(cm.g, 214) && near(cm.a, 0.14), '應解析瀏覽器回報的 color(srgb …)');
  const ow = parseColor('oklab(1 0 0)'), ob = parseColor('oklab(0 0 0 / 0.5)');
  assert(near(ow.r, 255, 0.5) && near(ow.g, 255, 0.5) && near(ow.b, 255, 0.5), 'oklab 白應為 255');
  assert(ob.r === 0 && ob.a === 0.5, 'oklab 黑應為 0、保留透明度');
  const on = parseColor('oklab(0.4 -0.03 -0.03)');   // 深藍綠一帶：三通道都要落在 0–255
  assert([on.r, on.g, on.b].every(v => v >= 0 && v <= 255) && on.b > on.r, 'oklab 色相方向錯');
  const half = mix('#ffffff', 50, '#000000');
  assert(near(half.r, 127.5) && half.a === 1, 'mix 50% 黑白應為中灰');
  const hud = mix('#ffffff', 92, 'transparent');
  assert(near(hud.a, 0.92) && hud.r === 255, 'mix 對 transparent 應只降透明度');
  const onBlack = over(hud, '#000000');
  assert(near(onBlack.r, 234.6), `白 92% 疊黑應為 234.6，得到 ${onBlack.r}`);
  assert(near(luminance('#ffffff'), 1) && luminance('#000000') === 0);
});

test('contrastRatio：底色半透明時丟錯（邊界：不能假裝知道底下是什麼）', () => {
  let threw = false;
  try { contrastRatio('#000', 'rgba(255,255,255,.5)'); } catch { threw = true; }
  assert(threw, '半透明底色應丟錯');
  assert(!(() => { try { parseColor('teal'); return true; } catch { return false; } })(), '不認得的顏色名稱應丟錯');
});

/* ---------- ② 訓練頁的文字／底色組合 ---------- */
// 從 motu.css 解析 --motu-* 的實際色值（只解析 hex 與 var() 別名鏈）
function motuTokens() {
  const css = readFileSync(join(root, 'app/styles/motu.css'), 'utf8');
  const raw = {};
  for (const [, k, v] of css.matchAll(/(--motu-[\w-]+)\s*:\s*([^;]+);/g)) if (!(k in raw)) raw[k] = v.trim();
  const resolve = (k, depth = 0) => {
    const v = raw[k];
    assert(v !== undefined && depth < 10, `找不到 token ${k}`);
    const alias = v.match(/^var\((--motu-[\w-]+)\)$/);
    return alias ? resolve(alias[1], depth + 1) : v;
  };
  return new Proxy({}, { get: (_, k) => resolve(`--motu-${String(k)}`) });
}
const T = motuTokens();

// HUD 底：白 92% 疊在影像上。影像不可控 → 取最壞情況（相機底色 --motu-navy-dark）與最好情況（純白）都要過
const HUD = mix(T.white, 92, 'transparent');
const HUD_DARK = over(HUD, T['navy-dark']);
const HUD_LIGHT = over(HUD, T.white);
const tint = (c, pct) => mix(c, pct, T.white);   // workout.css 的 color-mix(in srgb, X pct%, white) 淡底

// [用在哪裡, 文字色, 底色, 是否大字（≥24px 或 ≥18.66px 粗體）]
const PAIRS = [
  ['卡片正文（深藍／白卡）', T['color-text'], T['color-surface'], false],
  ['次要文字（深藍淡／白卡）', T['color-text-muted'], T['color-surface'], false],
  ['強調字 xp／提示（深青／白卡）', T['teal-dark'], T['color-surface'], false],
  ['頁面標題（深藍／奶油底）', T['color-text'], T['color-page'], false],
  ['頁面副標（深藍淡／奶油底）', T['color-text-muted'], T['color-page'], false],
  ['次要按鈕 hover（深青／奶油）', T['teal-dark'], T.cream, false],
  ['規劃中卡片標題與「--」（深藍淡／白卡，不再疊 opacity）', T['color-text-muted'], T['color-surface'], false],
  ['規劃中徽章、靜音鈕（深藍淡／沙色）', T['color-text-muted'], T['color-surface-sunken'], false],
  ['凹陷底上的正文（深藍／沙色）', T['color-text'], T['color-surface-sunken'], false],
  ['主按鈕、分類 chip 選中、週期燈、暫停（白字／深青）', T.white, T['teal-dark'], false],
  ['示範模式舞台上的狀態字（深藍／薄荷淡）', T['color-text'], T['mint-pale'], false],
  ['HUD 數字與提示，暗影像（深藍／白 92%）', T['color-text'], HUD_DARK, false],
  ['HUD 標籤，暗影像（深藍淡／白 92%）', T['color-text-muted'], HUD_DARK, false],
  ['HUD 標籤，亮影像（深藍淡／白 92%）', T['color-text-muted'], HUD_LIGHT, false],
  ['計次有效 ✓ +1（深青 60px／白 92% 暗影像）', T['teal-dark'], HUD_DARK, true],
  ['結算金幣格（深藍／金 12% 淡底）', T['color-text'], tint(T.gold, 12), false],
  ['今日推薦 chip（深藍／金 16% 淡底）', T['color-text'], tint(T.gold, 16), false],
  ['最後 10 秒倒數格（深藍／珊瑚 14% 淡底）', T['color-text'], tint(T.coral, 14), false],
  ['碎片／抽獎券膠囊（深藍／珊瑚 10% 淡底）', T['color-text'], tint(T.coral, 10), false],
  ['取景已偵測 chip（深藍／資訊藍 16% 淡底）', T['color-text'], tint(T['color-info'], 16), false],
  ...[['S', 'gold'], ['A', 'teal'], ['B', 'color-info'], ['C', 'navy-soft']].map(([g, c]) =>
    [`評級環 ${g}（深藍 52px／${c} 14% 淡底）`, T['color-text'], tint(T[c], 14), true]),
];

test('訓練頁每一組文字／底色都達 WCAG AA（一般 4.5、大字 3）', () => {
  assert(PAIRS.length >= 20, '組合清單被刪減');
  const bad = PAIRS.map(([where, fg, bg, large]) => [where, contrastRatio(fg, bg), large])
    .filter(([, r, large]) => !passesAA(r, { large }))
    .map(([where, r]) => `${where} = ${r.toFixed(2)}`);
  eq(bad.join(' | '), '', '對比不足');
});

test('對比規則的反例仍成立：海洋青、金、珊瑚、資訊藍當小字在白底不合格（防止規則被悄悄放寬）', () => {
  for (const c of ['teal', 'gold', 'coral', 'color-info', 'gold-text']) {
    assert(!passesAA(contrastRatio(T[c], T.white)), `${c} 在白底竟然過 4.5，色票可能被改過`);
  }
  // 白字放海洋青只有 3.3，所以小字按鈕必須用深青底
  assert(!passesAA(contrastRatio(T.white, T.teal)), '白字／海洋青不應通過小字標準');
});

/* ---------- ③ 訓練頁的鍵盤與報讀（靜態檢查 workout.js 模板） ---------- */
const WK = readFileSync(join(root, 'app/features/workout/workout.js'), 'utf8');

test('沒有文字的輸入元件都有 aria-label（搜尋框只有 placeholder、縮放滑桿沒有標籤）', () => {
  for (const id of ['wk-q', 'lv-zoom-range']) {
    const tag = WK.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
    assert(tag, `找不到 #${id}`);
    assert(/aria-label="[^"]+"/.test(tag[0]), `#${id} 缺 aria-label`);
  }
});

test('只有圖示的按鈕（語音、音樂）一律由 setVoiceBtn／setBgmBtn 設 aria-label＋aria-pressed', () => {
  for (const fn of ['setVoiceBtn', 'setBgmBtn']) {
    const body = WK.match(new RegExp(`function ${fn}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
    assert(body, `找不到 ${fn}`);
    assert(/aria-label/.test(body[0]) && /aria-pressed/.test(body[0]), `${fn} 缺 aria-label 或 aria-pressed`);
  }
  // 模板裡的空按鈕必須就是這兩顆（邊界：新增空按鈕卻忘了補名稱）
  const empty = [...WK.matchAll(/<button[^>]*id="([\w-]+)"[^>]*><\/button>/g)].map(m => m[1]).sort();
  eq(empty.join(','), 'lv-bgm,lv-voice');
});

test('動作卡（div）可用鍵盤操作：role=button、tabindex=0、有名稱，且綁 Enter／空白鍵', () => {
  const cards = [...WK.matchAll(/<div class="wk2(?: locked)?"[^>]*>/g)].map(m => m[0]);
  assert(cards.length >= 2, '應有一般卡與規劃中卡兩種模板');
  for (const c of cards) {
    assert(/role="button"/.test(c) && /tabindex="0"/.test(c) && /aria-label="[^"]+"/.test(c), `卡片缺鍵盤屬性：${c}`);
  }
  assert(/\.wk2\[role="button"\][\s\S]{0,200}onkeydown[\s\S]{0,120}'Enter'[\s\S]{0,40}' '/.test(WK), '卡片沒有綁鍵盤事件');
});

test('暖身開關的 checkbox 不得 display:none（鍵盤碰不到），且聚焦時開關有外框', () => {
  const css = readFileSync(join(root, 'app/features/workout/workout.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = css.match(/\.wk-toggle input\s*\{([^}]*)\}/);
  assert(rule && !/display:\s*none/.test(rule[1]), '.wk-toggle input 仍是 display:none');
  assert(/\.wk-toggle input:focus-visible \+ i\s*\{[^}]*outline/.test(css), '開關缺焦點外框');
});

/* ---------- ④ 不用 opacity 淡化文字 ---------- */
// 清單裡的色值只在「元素本身不透明」時成立：opacity .7 會把深藍字（10:1）拉到 4.4 以下，測試卻還是綠的。
// 所以訓練頁凡是 0 < opacity < 1 的靜態宣告，都必須是不含文字的元素（白名單），新增時要先想清楚。
const OPACITY_ALLOW = new Set([
  '.wk2.locked .wk2-lock',   // 規劃中卡片的鎖頭圖示圓盤，只有 SVG
  '.wk-card.soon',           // 舊版清單元件，workout.js 已不再渲染（保留樣式，未在本次清理）
]);
test('workout.css 沒有用 0–1 之間的 opacity 淡化含文字的元素（白名單以外一律不准）', () => {
  const css = readFileSync(join(root, 'app/features/workout/workout.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  const hits = [];
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const [, v] of body.matchAll(/(?:^|;)\s*opacity\s*:\s*([\d.]+)/g)) {
      if (+v > 0 && +v < 1) hits.push(sel.trim());
    }
  }
  assert(hits.length >= 1, '一個都沒掃到，解析可能失效');
  eq(hits.filter(h => !OPACITY_ALLOW.has(h)).join(' | '), '', '以下選擇器用 opacity 淡化，可能讓文字對比掉到門檻以下');
});

test('規劃中卡片不宣告 aria-disabled（它仍可點，按下會顯示「開發中」說明，宣告停用會誤導報讀軟體）', () => {
  const locked = WK.match(/<div class="wk2 locked"[^>]*>/);
  assert(locked, '找不到規劃中卡片模板');
  assert(!/aria-disabled/.test(locked[0]), '規劃中卡片不應有 aria-disabled');
});

/* ---------- ⑤ 外殼（合體第二階段 Slice 8）的文字／底色組合 ---------- */
// 不寫死色值：從 shell.css 讀出每個元素實際宣告的 color／background（var(--motu-*)），再解析成 motu.css 的色值。
// 之後改 shell.css 或遊戲組換色，這裡都會自動重驗。
const SHELL = readFileSync(join(root, 'app/styles/shell.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// 取某選擇器（不在 @media 裡的那條）某屬性的 var(--motu-*) 值 → 實際色值
function shellColor(sel, prop) {
  const top = SHELL.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [, body] of top.matchAll(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'g'))) {
    const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*var\\(--motu-([\\w-]+)\\)`));
    if (m) return T[m[1]];
  }
  throw new Error(`shell.css 找不到 ${sel} 的 ${prop}`);
}
// [用在哪裡, 文字色（選擇器, 屬性）, 底色（選擇器, 屬性）, 是否大字]
const SHELL_PAIRS = [
  ['帳號卡名稱與金幣數（深藍／白卡）', ['.sh-account', 'color'], ['.sh-account::before', 'background'], false],
  ['帳號卡 LV 膠囊', ['.sh-lv', 'color'], ['.sh-lv', 'background'], false],
  ['直欄按鈕下方標籤', ['.sh-rail-label', 'color'], ['.sh-rail-label', 'background'], false],
  ['分頁列未選中頁籤', ['#shell button', 'color'], ['#shell .sh-tab', 'background'], false],
  ['分頁列選中頁籤（14px 粗體，不算大字）', ['#shell .sh-tab.is-active', 'color'], ['#shell .sh-tab.is-active', 'background'], false],
];

test('外殼每一組文字／底色都達 WCAG AA（色值從 shell.css 解析）', () => {
  eq(SHELL_PAIRS.length, 5, '組合清單被刪減');
  const bad = SHELL_PAIRS.map(([where, [fs, fp], [bs, bp], large]) => [where, contrastRatio(shellColor(fs, fp), shellColor(bs, bp)), large])
    .filter(([, r, large]) => !passesAA(r, { large }))
    .map(([where, r]) => `${where} = ${r.toFixed(2)}`);
  eq(bad.join(' | '), '', '外殼對比不足');
});

test('外殼選中頁籤不是白字／海洋青（邊界：14px 粗體不算大字，3.3:1 過不了 4.5）', () => {
  const bg = shellColor('#shell .sh-tab.is-active', 'background');
  assert(bg !== T.teal, '選中頁籤底色仍是海洋青');
  assert(!passesAA(contrastRatio(T.white, T.teal)) && passesAA(contrastRatio(T.white, bg)), '選中頁籤白字對比不足');
});

test('shellColor 解析本身有效：找不到的選擇器會丟錯，@media 裡的覆寫不會被誤當成主規則', () => {
  let threw = false;
  try { shellColor('.no-such-thing', 'color'); } catch { threw = true; }
  assert(threw, '找不到選擇器時應丟錯，而不是回傳 undefined 讓比對空轉');
  eq(shellColor('#shell .sh-tab.is-active', 'color'), T.white);
});

/* ---------- ⑥ 整合版健身頁的遊戲元件（合體第二階段整合 Slice 12）的文字／底色組合 ---------- */
// 這些元件是 motu-app 的 React 元件，用遊戲組 Tailwind 色（--color-island-*，定義在 motu-app/src/index.css）。
// 色值從 index.css 解析；每一組還要求 class 真的出現在元件原始碼裡 —— 之後改了 class 卻沒更新這裡，測試會紅。
const ISLAND_CSS = readFileSync(join(root, 'motu-app/src/index.css'), 'utf8');
function islandColor(name) {
  if (name === 'white') return '#FFFFFF';
  const m = ISLAND_CSS.match(new RegExp(`--color-island-${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\s*;`));
  if (!m) throw new Error(`index.css 找不到 --color-island-${name}`);
  return m[1];
}
// class（text-island-navy、bg-white、bg-white/90…）→ 色值；有 /NN 透明度時疊在最壞底色上
function classColor(cls, under) {
  const m = cls.match(/^(?:text|bg)-(?:island-)?([\w-]+?)(?:\/(\d+))?$/);
  if (!m) throw new Error(`看不懂的 class ${cls}`);
  const c = islandColor(m[1]);
  if (!m[2]) return c;
  if (!under) throw new Error(`${cls} 半透明，必須指定底下的最壞底色`);
  return over(mix(c, +m[2], 'transparent'), under);
}
const FX = (f) => readFileSync(join(root, 'motu-app/src/components/fitness', f), 'utf8');
// [用在哪裡, 檔案, 文字 class, 底色 class, 半透明底色下方的最壞底色, 是否大字]
const FX_PAIRS = [
  ['健身初始頁資源列數字（深藍／白）', 'FitnessWallet.tsx', 'text-island-navy', 'bg-white', null, false],
  ['陪伴主角對話框的名字 11px（深青／奶油白）', 'CompanionCoach.tsx', 'text-island-teal-dark', 'bg-island-cream', null, false],
  ['陪伴主角台詞（深藍／奶油白）', 'CompanionCoach.tsx', 'text-island-navy', 'bg-island-cream', null, false],
  ['領獎資源列數字（深藍／白）', 'ClaimSequence.tsx', 'text-island-navy', 'bg-white', null, false],
  ['領獎資源列 LV（深青／白）', 'ClaimSequence.tsx', 'text-island-teal-dark', 'bg-white', null, false],
  ['領獎資源列經驗值（深藍淡／白）', 'ClaimSequence.tsx', 'text-island-navy-soft', 'bg-white', null, false],
  // 膠囊是白 90%，底下是揭曉舞台的暗色遮罩；最壞情況取遊戲組最深的 navy-dark
  ['「按任意鍵」提示膠囊（深藍淡／白 90% 疊暗舞台）', 'ClaimSequence.tsx', 'text-island-navy-soft', 'bg-white/90', islandColor('navy-dark'), false],
  ['提示訊息 toast（白字／深藍）', 'FitnessHost.tsx', 'text-white', 'bg-island-navy', null, false],
];
// HintBubble（遊戲組 DesignKit）的奶油白底：確認它真的是這個 class，否則上面兩組的底色就是假設
const HINT_SURFACE = readFileSync(join(root, 'motu-app/src/components/UI/DesignKit.tsx'), 'utf8');

test('整合版健身頁的遊戲元件：每一組文字／底色都達 WCAG AA（色值從遊戲組 index.css 解析）', () => {
  assert(FX_PAIRS.length >= 8, '組合清單被刪減');
  assert(/floating:\s*'bg-island-cream /.test(HINT_SURFACE), 'HintBubble 底色不再是 bg-island-cream，對話框兩組要重新確認');
  const missing = FX_PAIRS.filter(([, f, fg, bg]) => {
    const src = FX(f);
    const has = (c) => new RegExp(`[\\s"'\`]${c.replace(/[/]/g, '\\/')}[\\s"'\`]`).test(src);
    return !has(fg) || (!has(bg) && !(f === 'CompanionCoach.tsx' && bg === 'bg-island-cream'));
  }).map(([where]) => where);
  eq(missing.join(' | '), '', '以下組合的 class 已不在元件原始碼裡，清單過期');
  const bad = FX_PAIRS.map(([where, , fg, bg, under, large]) => [where, contrastRatio(classColor(fg), classColor(bg, under)), large])
    .filter(([, r, large]) => !passesAA(r, { large }))
    .map(([where, r]) => `${where} = ${r.toFixed(2)}`);
  eq(bad.join(' | '), '', '整合版對比不足');
});

test('整合版規則的反例：金、海洋青當小字在白底不合格（資源列數字因此用深藍，不照遊戲組 TopBar 的金字）', () => {
  for (const c of ['gold', 'teal', 'teal-light', 'coral']) {
    assert(!passesAA(contrastRatio(islandColor(c), '#FFFFFF')), `island-${c} 在白底竟然過 4.5，色票可能被改過`);
  }
  let threw = false;
  try { classColor('bg-white/90'); } catch { threw = true; }
  assert(threw, '半透明底色沒指定下方底色時應丟錯（邊界：不能假裝知道底下是什麼）');
  eq(islandColor('cream'), '#FFFFFF');
});
