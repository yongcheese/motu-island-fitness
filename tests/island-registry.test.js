// Slice 7：島嶼分頁的模組來源切換。
//
// 這層存在的理由是時程風險：遊戲組交付整包原始碼後由我方整合，
// 而合體要到彩排前才完成。中間任何一天都可能臨時要 demo，
// 所以我方版本必須永遠保留為備援，且切錯字串不該讓整個 App 白畫面。
import { test, eq, assert } from './harness.js';
import { resolveIsland, ISLAND_FALLBACK } from '../app/features/island/registry.js';

const builtin = { id: 'island', label: '島嶼', icon: '🏝️', mount() {}, unmount() {} };
const game = { id: 'island', label: '島嶼', icon: '🏝️', mount() {}, unmount() {} };

test('registry: 指定存在的模組時直接取用', () => {
  const r = resolveIsland({ builtin, game }, 'game');
  eq(r.module, game);
  eq(r.key, 'game');
  eq(r.ok, true);
  eq(r.message, null, '成功時不應有訊息');
});

test('registry: 備援模組可用，切回無殘留', () => {
  const reg = { builtin, game };
  eq(resolveIsland(reg, 'game').module, game);
  eq(resolveIsland(reg, 'builtin').module, builtin, '切回備援應取得原模組');
  // 解析是純函式，不持有狀態，故無殘留可言 —— 以連續切換驗證
  for (const k of ['game', 'builtin', 'game', 'builtin']) {
    eq(resolveIsland(reg, k).module, reg[k], `連續切換到 ${k} 應穩定`);
  }
});

test('registry: 指定的模組不存在時回退備援，且訊息明確（不得白畫面）', () => {
  const r = resolveIsland({ builtin }, 'game');
  eq(r.module, builtin, '應回退為備援而非 null —— 使用者仍該看得到能用的島嶼');
  eq(r.key, ISLAND_FALLBACK);
  eq(r.ok, false);
  assert(r.message.includes('game'), `訊息應指出是哪個鍵找不到，實得：${r.message}`);
  assert(r.message.includes('builtin'), '訊息應說明已回退為何者');
  assert(r.message.includes('目前可用'), '訊息應列出可用的鍵，否則開發者不知道該填什麼');
});

test('registry: 連備援都不可用時據實回報，不假裝成功', () => {
  const r = resolveIsland({ game }, 'nope');
  eq(r.module, null);
  eq(r.ok, false);
  assert(r.message.includes('備援模組亦不可用'), `實得：${r.message}`);
});

test('registry: 髒輸入不拋例外（邊界）', () => {
  for (const reg of [null, undefined, {}, { builtin: null }]) {
    for (const key of [undefined, null, '', 'builtin', 123]) {
      const r = resolveIsland(reg, key);
      eq(r.ok, false, `reg=${JSON.stringify(reg)} key=${JSON.stringify(key)} 不應回報成功`);
      assert(typeof r.message === 'string' && r.message.length > 0, '失敗時必須有訊息');
    }
  }
});

test('registry: 註冊表中值為 falsy 的項目視為未載入', () => {
  // 遊戲組模組尚未交付時，import 那行是註解掉的，若有人誤填 game: undefined
  const r = resolveIsland({ builtin, game: undefined }, 'game');
  eq(r.module, builtin, '值為 undefined 應視為未載入並回退');
  eq(r.ok, false);
});

test('registry: main.js 的五個分頁 id 完整且島嶼可切換', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../app/main.js', import.meta.url)), 'utf8');

  for (const id of ['today', 'island', 'workout', 'tracking', 'settings']) {
    assert(src.includes(`id: '${id}'`), `TABS 應含分頁 ${id}`);
  }
  // 島嶼走註冊表，其餘四個維持直接引用 —— 本 Slice 的範圍外條款
  assert(src.includes('island: islandPick.module'), '島嶼應取自註冊表解析結果');
  for (const other of ['today,', 'workout,', 'tracking,', 'settings ']) {
    assert(src.includes(other), `其餘分頁 ${other.trim()} 應維持直接引用，不受本次改動影響`);
  }
  assert(src.includes("const ISLAND_SOURCE = 'builtin'"), '切換點應為單一常數');
  assert(src.includes('island-game'), '應留有遊戲端模組的接入說明');
});
