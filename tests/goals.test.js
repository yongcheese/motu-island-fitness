// Slice4 R3：nextGoal / canBuy 純函式測試（只新增，不動舊斷言）。
// 錨定期望值防規則漂移——可買=非成就鎖 8 項＋已解鎖成就項。
import { test, assert, eq } from './harness.js';
import { CATALOG, canBuy, nextGoal } from '../app/features/island/goals.js';

const DEFAULT_UNLOCKED = ['cabin', 'tree', 'path', 'lamp', 'flower'];
const mkState = (coins, unlocked = DEFAULT_UNLOCKED) => ({ wallet: { coins }, island: { unlocked } });

test('canBuy: 非成就鎖項目一律可買（garden/dock/windmill 死庫存已修）', () => {
  const st = mkState(0);
  eq(canBuy('garden', st), true);
  eq(canBuy('dock', st), true);
  eq(canBuy('windmill', st), true);
  eq(canBuy('path', st), true);
});

test('canBuy: 成就鎖四項須 unlocked；未知 type 一律 false', () => {
  const st = mkState(999);
  eq(canBuy('fountain', st), false, '成就鎖未解鎖不可買');
  eq(canBuy('tower', st), false);
  eq(canBuy('fountain', mkState(999, [...DEFAULT_UNLOCKED, 'fountain'])), true, '解鎖後可買');
  eq(canBuy('spaceship', st), false, '未知 type 防壞資料');
});

test('nextGoal: 全新 store（80🪙）→ save 碼頭 差 10', () => {
  const g = nextGoal(mkState(80));
  eq(g.kind, 'save');
  eq(g.item.type, 'dock');
  eq(g.gap, 10);
});

test('nextGoal: 0 金幣 → save 石階 差 10', () => {
  const g = nextGoal(mkState(0));
  eq(g.kind, 'save');
  eq(g.item.type, 'path');
  eq(g.gap, 10);
});

test('nextGoal: coins=cost 剛好等額=可買，不觸發該項 save', () => {
  const g = nextGoal(mkState(90));   // dock 90 剛好買得起 → 下一個是 windmill 120
  eq(g.kind, 'save');
  eq(g.item.type, 'windmill');
  eq(g.gap, 30);
});

test('nextGoal: 200🪙 可買的全買得起 → unlock 噴泉（成就鎖最便宜）', () => {
  const g = nextGoal(mkState(200));
  eq(g.kind, 'unlock');
  eq(g.item.type, 'fountain');
  assert(typeof g.hint === 'string' && g.hint.length > 0, '附解鎖提示');
});

test('nextGoal: 全解鎖＋高額 → done', () => {
  const all = CATALOG.map(c => c.type);
  eq(nextGoal(mkState(999, all)).kind, 'done');
  // 全解鎖但錢不夠 → 仍是 save（monument 250）
  const g = nextGoal(mkState(100, all));
  eq(g.kind, 'save');
  eq(g.item.type, 'windmill');
});
