// 合體第一階段 Slice 2：Lucide 圖示模組。
//   emoji → Lucide 對照表必須涵蓋 workout.js 裡（註解以外）的每一個 emoji，
//   否則 Slice 3–4 換圖示時會有查不到的。
import { test, eq, assert } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { icon, ICONS, EMOJI_ICON, ICON_SIZES, iconForEmoji } from '../app/ui/icons.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 去掉註解後取出所有 emoji（變體選擇字元 FE0F 不算）
function emojisOutsideComments(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  return [...new Set(code.match(/\p{Extended_Pictographic}/gu) || [])];
}

// 暫時攔截 console.warn，回傳被呼叫的次數
function countWarn(fn) {
  const orig = console.warn; let n = 0;
  console.warn = () => { n++; };
  try { fn(); } finally { console.warn = orig; }
  return n;
}

/* ---------- 對照表涵蓋率 ---------- */
test('對照表涵蓋 workout.js 註解以外的每一個 emoji', () => {
  const src = readFileSync(join(root, 'app/features/workout/workout.js'), 'utf8');
  const found = emojisOutsideComments(src);
  // 合體 Slice 4 起 workout.js 註解外已無 emoji，found 為空是預期結果（由 ui-no-emoji.test.js 鎖定）；
  // 掃描器本身是否有效，由下一個 probe 測試獨立保證。
  const missing = found.filter(e => !EMOJI_ICON[e]);
  eq(missing.join(' '), '', '這些 emoji 沒有對應的 Lucide 圖示');
});

test('掃描器有效：註解內的 emoji 不算、字串內的 emoji 會被抓到', () => {
  const probe = "// 🚫 註解\n/* 🧱 區塊註解 */\nconst a = 'x🪙y'; const u = 'http://a.b/c'; // 🙈";
  eq(emojisOutsideComments(probe).join(' '), '🪙');
});

test('對照表每個值都是模組裡真的有的圖示', () => {
  const bad = Object.entries(EMOJI_ICON).filter(([, n]) => !ICONS[n]).map(([e, n]) => `${e}→${n}`);
  eq(bad.join(' '), '');
});

test('iconForEmoji 忽略變體選擇字元（⚠️ 與 ⚠ 同一個）', () => {
  eq(iconForEmoji('⚠️'), 'triangle-alert');
  eq(iconForEmoji('⚠'), 'triangle-alert');
  eq(iconForEmoji('🦄'), null, '沒有對應時回傳 null');
});

/* ---------- 正常輸出 ---------- */
test('icon() 輸出 24×24 viewBox、stroke 2、currentColor、不填色', () => {
  const s = icon('coins');
  assert(s.startsWith('<svg') && s.endsWith('</svg>'));
  for (const attr of ['viewBox="0 0 24 24"', 'stroke="currentColor"', 'stroke-width="2"', 'fill="none"', 'width="18"', 'height="18"'])
    assert(s.includes(attr), '缺 ' + attr);
  // 合體第二階段 Slice 4 申報：coins 換成遊戲組 lucide-react 0.546 的版本（原斷言為較新版的 cx="16"）
  assert(s.includes('<circle cx="8" cy="8" r="6"'), '內容應是 Lucide coins 的路徑');
});

/* ---------- 金幣圖示與遊戲端一致（合體第二階段 Slice 4） ---------- */
// 遊戲組 lucide-react 0.546.0 的 coins（node_modules/lucide-react/dist/esm/icons/coins.js 原文照抄）。
// 我方原本用的是較新版 Lucide，兩版金幣左右相反：整合版 HUD 與健身頁並排時方向會不一致。
const GAME_COINS = [
  '<circle cx="8" cy="8" r="6"/>',
  '<path d="M18.09 10.37A6 6 0 1 1 10.34 18"/>',
  '<path d="M7 6h1v4"/>',
  '<path d="m16.71 13.88.7.71-2.82 2.82"/>',
];
test('coins 路徑等於遊戲組 lucide-react 0.546 版本（逐段、同順序、沒有多餘形狀）', () => {
  eq(ICONS.coins, GAME_COINS.join(''));
});
test('整合版有裝套件時，直接對照 motu-app 的 lucide-react 原檔（邊界：沒裝則只比對上面的照抄值）', () => {
  const file = join(root, 'motu-app/node_modules/lucide-react/dist/esm/icons/coins.js');
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { return; }
  const nodes = [...src.matchAll(/\["(circle|path)", \{([^}]*)\}\]/g)].map(([, tag, attrs]) => {
    const kv = [...attrs.matchAll(/(\w+): "([^"]*)"/g)].filter(([, k]) => k !== 'key').map(([, k, v]) => `${k}="${v}"`);
    return `<${tag} ${kv.join(' ')}/>`;
  });
  eq(nodes.join(''), ICONS.coins, 'motu-app 的 lucide-react 版本變了，金幣要重新對齊');
});

test('每一個圖示都照 24×24 格線、stroke 2 輸出，且只含 SVG 形狀元素', () => {
  for (const name of Object.keys(ICONS)) {
    const s = icon(name);
    assert(s.includes('viewBox="0 0 24 24"') && s.includes('stroke-width="2"'), name);
    const inner = s.replace(/^<svg[^>]*>|<\/svg>$/g, '');
    assert(inner.length > 0, name + ' 是空的');
    const tags = [...inner.matchAll(/<(\w+)/g)].map(m => m[1]);
    assert(tags.every(t => ['path', 'circle', 'rect', 'line', 'ellipse', 'polyline', 'polygon'].includes(t)), name + ' 含非形狀元素：' + tags);
    assert(!/fill="(?!none)|stroke-width="(?!2")/.test(inner), name + ' 內部覆寫了填色或線寬');
  }
});

/* ---------- 尺寸 ---------- */
test('size 只接受 token（16/18/20/24）', () => {
  eq(JSON.stringify(ICON_SIZES), '[16,18,20,24]');
  for (const n of ICON_SIZES) assert(icon('star', { size: n }).includes(`width="${n}" height="${n}"`), String(n));
});

test('邊界：size 不是 token 時退回 18（17、0、負數、字串、NaN）', () => {
  for (const bad of [17, 0, -24, '24', NaN, 100])
    assert(icon('star', { size: bad }).includes('width="18" height="18"'), '輸入 ' + String(bad));
});

/* ---------- 無障礙 ---------- */
test('沒有 label：aria-hidden，不帶 role 與 aria-label', () => {
  const s = icon('lock');
  assert(s.includes('aria-hidden="true"'));
  assert(!s.includes('aria-label') && !s.includes('role='));
});

test('有 label：role="img" + aria-label，不帶 aria-hidden；label 會被跳脫', () => {
  const s = icon('lock', { label: '已鎖定' });
  assert(s.includes('role="img"') && s.includes('aria-label="已鎖定"'));
  assert(!s.includes('aria-hidden'));
  const x = icon('lock', { label: '"><script>' });
  assert(!x.includes('<script>') && x.includes('aria-label="&quot;&gt;&lt;script&gt;"'), '未跳脫');
});

/* ---------- 未知名稱 ---------- */
test('未知名稱：不拋錯、回傳同尺寸空白佔位、console.warn 一次', () => {
  let s;
  const warns = countWarn(() => { s = icon('no-such-icon', { size: 24 }); });
  eq(warns, 1);
  assert(s.startsWith('<svg') && s.includes('width="24" height="24"'), '佔位要同尺寸');
  eq(s.replace(/^<svg[^>]*>|<\/svg>$/g, ''), '', '佔位不得有內容');
  assert(s.includes('aria-hidden="true"'));
});

test('未知名稱但有 label：仍保留 aria-label，意思不會消失', () => {
  let s;
  countWarn(() => { s = icon('no-such-icon', { label: '金幣' }); });
  assert(s.includes('aria-label="金幣"') && s.includes('role="img"'));
});

/* ---------- 合體第二階段 Slice 2：外殼用圖示 ---------- */
// 分頁列（house、dumbbell、heart、settings）、帳號卡（waves-horizontal、coins）、
// 左側直欄（hammer、shopping-bag、backpack、face-slightly-smiling）、右下（gift）
const SHELL_ICONS = ['house', 'dumbbell', 'heart', 'settings', 'waves-horizontal', 'coins',
  'hammer', 'shopping-bag', 'backpack', 'face-slightly-smiling', 'gift'];

test('外殼用圖示都已收錄，輸出非空的合法 SVG 且預設 aria-hidden、不發警告', () => {
  for (const name of SHELL_ICONS) {
    assert(Object.prototype.hasOwnProperty.call(ICONS, name), `ICONS 缺 ${name}`);
    let s;
    eq(countWarn(() => { s = icon(name, { size: 24 }); }), 0, `${name} 不應觸發缺圖示警告`);
    assert(s.startsWith('<svg') && s.endsWith('</svg>'), name);
    assert(s.includes('aria-hidden="true"'), `${name} 應為裝飾性圖示`);
    assert(s.replace(/^<svg[^>]*>|<\/svg>$/g, '').length > 0, `${name} 內容不得為空`);
  }
});

test('ICONS 依名稱字母序排列（方便人工與官方來源逐條比對）', () => {
  const keys = Object.keys(ICONS);
  const unsorted = keys.filter((k, i) => i > 0 && keys[i - 1] >= k);
  eq(unsorted.join(','), '', '這些名稱沒有排在正確位置');
});

test('邊界：本版本不存在的舊名稱（smile、waves）仍走未知名稱路徑，不得偷偷加別名', () => {
  for (const old of ['smile', 'waves']) {
    assert(!Object.prototype.hasOwnProperty.call(ICONS, old), `${old} 不是 v1.47.0 的官方名稱，不應收錄`);
    let s;
    eq(countWarn(() => { s = icon(old); }), 1, `${old} 應 warn 一次`);
    eq(s.replace(/^<svg[^>]*>|<\/svg>$/g, ''), '', `${old} 只能輸出空白佔位`);
  }
});
