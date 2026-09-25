// 合體第二階段 Slice 1：外殼模板（app/ui/shell.js）是純函式，吃資料回字串。
import { test, eq, assert } from './harness.js';
import { tabbarHtml, accountCardHtml, railHtml, cornerHtml, RAIL_ITEMS } from '../app/ui/shell.js';

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
  // heart 尚未收錄（Slice 2 補）→ 暫代字，而不是 icon() 的空白佔位
  const tracking = html.split('</button>')[2];
  assert(!tracking.includes('<svg'), '缺圖示時不應輸出空白 SVG');
  assert(tracking.includes('class="sh-ph"'), '缺圖示時應放暫代字');
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
