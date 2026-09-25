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
