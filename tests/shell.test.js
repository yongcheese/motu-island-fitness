// 合體第二階段 Slice 1：外殼模板（app/ui/shell.js）是純函式，吃資料回字串。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, eq, assert } from './harness.js';
import { tabbarHtml, accountCardHtml, accountFromState, railHtml, cornerHtml, RAIL_ITEMS, SOON_MESSAGE } from '../app/ui/shell.js';

const TABS = [
  { id: 'island', label: '主頁', icon: 'house' },
  { id: 'workout', label: '健身', icon: 'dumbbell' },
  { id: 'tracking', label: '追蹤', icon: 'heart', soon: true },
  { id: 'settings', label: '設定', icon: 'settings', soon: true },
];
const tabIds = (html) => [...html.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]);
const activeIds = (html) => [...html.matchAll(/class="sh-tab is-active" data-tab="([^"]+)"/g)].map((m) => m[1]);

test('shell: 分頁列輸出四個頁籤，順序為主頁、健身、追蹤、設定', () => {
  const html = tabbarHtml(TABS, 'island');
  eq(tabIds(html).join(','), 'island,workout,tracking,settings');
  const labels = [...html.matchAll(/<span class="sh-tab-label">([^<]+)<\/span>/g)].map((m) => m[1]);
  eq(labels.join(','), '主頁,健身,追蹤,設定');
  eq((html.match(/<button /g) || []).length, 4, '每個頁籤都是 button');
});

test('shell: current 對應的頁籤帶選中標記，且只有一個', () => {
  eq(activeIds(tabbarHtml(TABS, 'island')).join(','), 'island');
  eq(activeIds(tabbarHtml(TABS, 'workout')).join(','), 'workout');
});

test('shell: current 不在清單內時沒有任何頁籤被選中（邊界）', () => {
  for (const cur of ['today', null, undefined, '']) {
    const html = tabbarHtml(TABS, cur);
    eq(activeIds(html).length, 0, `current=${JSON.stringify(cur)} 不應有選中頁籤`);
    assert(!html.includes('is-active'), '不應殘留選中 class');
  }
});

test('shell: 不可用分頁帶 data-soon，可用分頁不帶', () => {
  const html = tabbarHtml(TABS, 'island');
  const soon = [...html.matchAll(/data-tab="([^"]+)" data-soon="1"/g)].map((m) => m[1]);
  eq(soon.join(','), 'tracking,settings');
});

test('shell: 已有的 Lucide 圖示輸出 SVG，缺的圖示用暫代字且不輸出空白 SVG', () => {
  const html = tabbarHtml(TABS, 'island');
  const [home] = html.split('</button>');
  assert(home.includes('<svg'), '主頁（house）應輸出 Lucide SVG');
  // 缺圖示 → 暫代字，而不是 icon() 的空白佔位。
  // （Slice 2 補齊 heart 後，這裡改用一個確定不存在的名稱當例子；判斷條件不變）
  const missing = tabbarHtml([{ id: 'x', label: '追蹤', icon: 'no-such-icon' }], null);
  assert(!missing.includes('<svg'), '缺圖示時不應輸出空白 SVG');
  assert(missing.includes('class="sh-ph"'), '缺圖示時應放暫代字');
});

test('shell: 帳號卡顯示名稱、等級、金幣，並跳脫 HTML', () => {
  const html = accountCardHtml({ name: '<b>島主</b>', level: 3, coins: 0 });
  assert(html.includes('&lt;b&gt;島主&lt;/b&gt;'), '名稱應跳脫');
  assert(!html.includes('<b>'), '不得原樣輸出使用者字串中的標籤');
  assert(html.includes('LV 3'), '應顯示等級');
  assert(/<span class="sh-coin-num">0<\/span>/.test(html), '金幣為 0 仍應顯示 0');
});

test('shell: 左側直欄四個按鈕依序為建造、商店、背包、動作，且都有報讀名稱', () => {
  const html = railHtml();
  eq(RAIL_ITEMS.map((r) => r.label).join(','), '建造,商店,背包,動作');
  const acts = [...html.matchAll(/data-act="([^"]+)" aria-label="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
  eq(acts.join(','), 'build:建造,shop:商店,bag:背包,emote:動作');
});

test('shell: 右下有禮物與轉盤兩個按鈕', () => {
  const html = cornerHtml();
  const acts = [...html.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1]);
  eq(acts.join(','), 'gift,wheel');
});

// —— Slice 3：接上真實狀態與按鈕行為 ——
const emojiIn = (html) => html.match(/\p{Extended_Pictographic}/gu);

test('shell: 帳號卡顯示 state 的暱稱、等級、金幣（store 形狀）', () => {
  const s = { profile: { nickname: '小海', avatar: '🧑‍🚀' }, wallet: { coins: 135, xp: 260, level: 3 } };
  const acc = accountFromState(s);
  eq(JSON.stringify(acc), JSON.stringify({ name: '小海', level: 3, coins: 135 }));
  const html = accountCardHtml(acc);
  assert(html.includes('<div class="sh-name">小海</div>'), '應顯示暱稱');
  assert(html.includes('LV 3'), '應顯示等級');
  assert(/<span class="sh-coin-num">135<\/span>/.test(html), '應顯示金幣');
  assert(!emojiIn(html), 'profile.avatar 是 emoji，帳號卡不得把它帶出來');
});

test('shell: 暱稱含 <script> 時被跳脫（邊界）', () => {
  const html = accountCardHtml(accountFromState({ profile: { nickname: '<script>alert(1)</script>' }, wallet: { coins: 1, level: 1 } }));
  assert(!html.includes('<script>'), '不得原樣輸出 script 標籤');
  assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), '應跳脫成文字');
});

test('shell: 金幣為 0 時仍顯示 0；欄位缺漏或非法時退回安全預設（邊界）', () => {
  const zero = accountCardHtml(accountFromState({ profile: { nickname: 'A' }, wallet: { coins: 0, level: 1 } }));
  assert(/<span class="sh-coin-num">0<\/span>/.test(zero), '金幣 0 應顯示 0');
  for (const bad of [undefined, null, {}, { profile: { nickname: '  ' }, wallet: { coins: NaN, level: -2 } }]) {
    eq(JSON.stringify(accountFromState(bad)), JSON.stringify({ name: '島主', level: 1, coins: 0 }), `state=${JSON.stringify(bad)}`);
  }
});

test('shell: 帳號卡只有金幣一種資源', () => {
  const html = accountCardHtml(accountFromState({ profile: { nickname: 'A' }, wallet: { coins: 5, xp: 999, level: 2 } }));
  eq((html.match(/class="sh-coin-num"/g) || []).length, 1, '只有一個資源數字');
  assert(!html.includes('999'), '不得顯示 xp 等其他數值');
});

test('shell: main.js 的不可用分頁固定為追蹤、設定', () => {
  const src = readFileSync(fileURLToPath(new URL('../app/main.js', import.meta.url)), 'utf8');
  const block = src.match(/const TABS = \[([\s\S]*?)\];/);
  assert(block, 'main.js 應有 TABS 常數');
  const soon = [...block[1].matchAll(/id: '([^']+)'[^}]*soon: true/g)].map((m) => m[1]);
  eq(soon.join(','), 'tracking,settings');
  eq(SOON_MESSAGE, '即將推出');
  assert(!/MOCK_ACCOUNT/.test(src), '帳號卡不得再用寫死的假資料');
  assert(/store\.subscribe\([^)]*\)\s*=>\s*\{[^}]*renderAccount\(/.test(src), 'store 變動時應重畫帳號卡');
});

test('shell: 外殼模板輸出不含任何 emoji，且直欄與頭像都已是 Lucide 圖示', () => {
  const all = tabbarHtml(TABS, 'island') + railHtml() + cornerHtml()
    + accountCardHtml(accountFromState({ profile: { nickname: '島主' }, wallet: { coins: 80, level: 1 } }));
  const found = emojiIn(all);
  assert(!found, `外殼不得含 emoji，實得：${found?.join(' ')}`);
  assert(!railHtml().includes('class="sh-ph"'), '直欄四鈕都應是線條圖示（不再有暫代字）');
  assert(!accountCardHtml({ name: 'A', level: 1, coins: 0 }).includes('class="sh-ph"'), '頭像應是線條圖示');
});

// Slice 5：非主頁的捲動頁面要留出懸浮分頁列的高度
const SHELL_CSS = readFileSync(fileURLToPath(new URL('../app/styles/shell.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const padVars = () => [...SHELL_CSS.matchAll(/--sh-view-pad-b:\s*([^;]+);/g)].map((m) => m[1]);

test('shell: 非主頁 #view 底部留白規則存在，只針對 page 模式且排除全螢幕訓練', () => {
  const rule = SHELL_CSS.match(/([^{}]*)\{\s*padding-bottom:\s*var\(--sh-view-pad-b\);?\s*\}/);
  assert(rule, 'shell.css 應有以 --sh-view-pad-b 設定 padding-bottom 的規則');
  const sel = rule[1].trim();
  assert(/#shell\[data-page="page"\]/.test(sel), `應只在非主頁（data-page="page"）生效，實得：${sel}`);
  assert(/#view:not\(\.full\)/.test(sel), `全螢幕訓練（#view.full）不應留白，實得：${sel}`);
  assert(!/data-page="home"/.test(sel), '主頁不應被留白');
});

test('shell: 底部留白 ≥ 分頁列高度＋安全區；電腦版另計懸浮離底距離（邊界）', () => {
  const vals = padVars();
  eq(vals.length, 2, '手機、電腦各一個 --sh-view-pad-b');
  for (const v of vals) {
    assert(v.includes('var(--sh-tab-h)'), `留白必須包含分頁列高度：${v}`);
    assert(v.includes('env(safe-area-inset-bottom)'), `留白必須包含安全區：${v}`);
    assert(/\+\s*var\(--motu-space-\d+\)/.test(v), `留白要比分頁列多一段間距，按鈕才不會貼齊：${v}`);
  }
  const desktop = SHELL_CSS.slice(SHELL_CSS.indexOf('@media (min-width: 960px)'));
  const dv = desktop.match(/--sh-view-pad-b:\s*([^;]+);/);
  assert(dv, '電腦版區塊應重新定義留白');
  assert(dv[1].includes('var(--motu-space-4)'), `電腦版分頁列離底 space-4，留白要算進去：${dv[1]}`);
});

// —— Slice 6：照截圖細修造型 ——
// 自創色值偵測器：與 tests/motu-skin.test.js ④ 同一套規則（hex、色彩函式、具名色）
function hardcodedColors(css) {
  const s = css.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\([^)]*\)/g, '')          // 路徑不是顏色
    .replace(/var\(--[\w-]+\)/g, 'VAR');   // --motu-white 這類名稱不算
  const hex = s.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  const fn = s.match(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g) || [];
  const named = s.match(/:[^;{}]*\b(white|black|red|blue|green|gray|grey|orange|yellow|purple|pink)\b/g) || [];
  return [...hex, ...fn, ...named];
}

test('shell: shell.css 不出現 --motu-* 以外的色值', () => {
  const css = readFileSync(fileURLToPath(new URL('../app/styles/shell.css', import.meta.url)), 'utf8');
  eq(hardcodedColors(css).join(' | '), '', '發現自創色值');
  const vars = [...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
  const foreign = [...new Set(vars.filter((v) => !/^--(motu|sh)-/.test(v)))];
  eq(foreign.join(','), '', '只能引用 --motu-* 或外殼自己的 --sh-* 變數');
});

test('色值偵測本身有效：塞寫死色會被抓到，註解與 var() 名稱不會（防止測試空轉）', () => {
  const probe = '/* #123456 註解不算 */ .a { color: #FFF; background: conic-gradient(rgba(0,0,0,.5) 0 90deg, var(--motu-white) 0); border-color: white; }';
  const found = hardcodedColors(probe);
  eq(found.length, 3, `應抓到 #FFF、rgba(、white 三處，實得：${found.join(' | ')}`);
  eq(hardcodedColors('.a { color: var(--motu-white); }').length, 0, 'var(--motu-white) 不應被誤判');
});

test('shell: 截圖造型的關鍵規則都在（斜角用 clip-path、虛線、豎線、轉盤圓盤）', () => {
  const css = readFileSync(fileURLToPath(new URL('../app/styles/shell.css', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const block = (sel) => [...css.matchAll(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join(';');
  assert(/clip-path:\s*polygon/.test(block('.sh-account::before')), '帳號卡右上斜角應用 clip-path');
  assert(/dashed/.test(block('.sh-res')), '帳號卡金幣列上方應為虛線分隔');
  assert(/clip-path:\s*polygon/.test(block('#shell .sh-rail-btn')), '直欄按鈕右側尖角應用 clip-path');
  assert(/background:\s*var\(--motu-navy\)/.test(block('.sh-rail::before')), '直欄應有深藍豎線');
  assert(/dashed/.test(block('.sh-tabs::before')), '分頁列頂緣應為虛線');
  assert(/clip-path:\s*polygon/.test(block('#shell .sh-tab.is-active')), '選中頁籤上緣應收斜角');
  assert(/conic-gradient/.test(block('.sh-wheel-disc')), '轉盤應為 CSS conic-gradient 圓盤');
  assert(/var\(--motu-gold\)/.test(block('#shell .sh-gift::after')), '禮物鈕應有金色小點');
  assert(!/url\(/.test(css), '造型不得用圖片');
});

test('shell: 轉盤圓盤是純裝飾（不含文字），名稱由按鈕 aria-label 提供', () => {
  const html = cornerHtml();
  assert(/<span class="sh-wheel-disc" aria-hidden="true"><\/span>/.test(html), `轉盤圓盤應為空的裝飾元素：${html}`);
  assert(/data-act="wheel" aria-label="幸運轉盤"/.test(html), '轉盤按鈕應有報讀名稱');
});

test('shell: 載入畫面沒有 emoji，改用 Lucide 圖示（邊界：去掉註解後仍掃得到 loader-logo 內容）', () => {
  const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');
  const logo = html.match(/<div class="loader-logo">([\s\S]*?)<\/div>/);
  assert(logo, '去掉註解後仍應找得到 loader-logo');
  assert(logo[1].trim().length > 0, 'loader-logo 不應是空的');
  const found = emojiIn(logo[1]);
  assert(!found, `載入畫面不得含 emoji，實得：${found?.join(' ')}`);
  assert(/<svg[^>]*aria-hidden="true"/.test(logo[1]), '載入畫面應為裝飾性 SVG 圖示');
  const loader = html.match(/<div id="loader">([\s\S]*?)<\/div>\s*<div id="app">/);
  assert(loader && !emojiIn(loader[1]), '整個載入畫面都不得含 emoji');
});

test('shell: 載入畫面的棕櫚樹路徑與 icons.js 的 Lucide tree-palm 逐字相同', async () => {
  const { ICONS } = await import('../app/ui/icons.js');
  const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  const logo = html.match(/<div class="loader-logo">([\s\S]*?)<\/div>/)[1];
  assert(logo.includes(ICONS['tree-palm']), '載入畫面的 SVG 路徑應直接取自 ICONS["tree-palm"]');
});
