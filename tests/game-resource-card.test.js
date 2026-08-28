// Slice 3：結算第二幕的遊戲資源卡（碎片／抽獎券）。
//
// 這張卡的存在條件是有意義的，不是排版偏好：
// 碎片與抽獎券由遊戲端記帳、健身端只顯示不儲存，所以「這次拿到 0 個」與「這個系統沒有這項資源」
// 對使用者是兩件事。畫一張全 0 的卡只會讓人以為壞了，故兩者皆 0 時整張卡不渲染。
import { test, eq, assert } from './harness.js';
import { gameResourceCard } from '../app/features/workout/workout.js';

const sess = (shards, tickets) => ({ shards, tickets, validReps: 20, coinsEarned: 100 });

test('資源卡: 兩者皆為 0 時整張卡不渲染', () => {
  eq(gameResourceCard(sess(0, 0)), '', '全 0 應回傳空字串，DOM 中不存在該節點');
});

test('資源卡: 任一 > 0 即渲染', () => {
  assert(gameResourceCard(sess(3, 0)).includes('wk-rw-res'), '只有碎片時應渲染');
  assert(gameResourceCard(sess(0, 1)).includes('wk-rw-res'), '只有抽獎券時應渲染');
  assert(gameResourceCard(sess(3, 1)).includes('wk-rw-res'), '兩者皆有時應渲染');
});

test('資源卡: 只顯示實際獲得的項目，0 的那項不列出', () => {
  const onlyShards = gameResourceCard(sess(3, 0));
  assert(onlyShards.includes('碎片'), '應列出碎片');
  assert(!onlyShards.includes('抽獎券'), '抽獎券為 0 時不應列出，否則會出現「抽獎券 +0」這種誤導文字');

  const onlyTickets = gameResourceCard(sess(0, 2));
  assert(onlyTickets.includes('抽獎券'), '應列出抽獎券');
  assert(!onlyTickets.includes('碎片'), '碎片為 0 時不應列出');
});

test('資源卡: 顯示的數字與 session 的值一致', () => {
  const html = gameResourceCard(sess(4, 2));
  assert(html.includes('+4'), `碎片數應為 +4，實得：${html}`);
  assert(html.includes('+2'), `抽獎券數應為 +2，實得：${html}`);
});

test('資源卡: 說明文字須讓使用者知道這兩項要在遊戲中使用', () => {
  const html = gameResourceCard(sess(3, 1));
  assert(html.includes('島嶼遊戲'), '須點出用途在遊戲端');
  assert(html.includes('不會出現在錢包'), '須說明不進錢包，避免使用者以為系統漏記');
});

test('資源卡: 缺欄位或髒輸入不得拋例外或印出 undefined（邊界）', () => {
  for (const bad of [undefined, null, {}, { shards: undefined, tickets: null }, { shards: NaN, tickets: NaN }]) {
    const html = gameResourceCard(bad);
    eq(html, '', `輸入 ${JSON.stringify(bad)} 應安全回傳空字串`);
  }
  // 舊存檔的 history 沒有這兩個欄位，走的正是這條路徑
  eq(gameResourceCard({ validReps: 20, coinsEarned: 100 }), '', '舊存檔紀錄不應渲染資源卡');
});

test('資源卡: 不得使用金幣或經驗值的視覺樣式（屬於遊戲端資產）', () => {
  const html = gameResourceCard(sess(3, 1));
  assert(!html.includes('wk-rw-coins'), '不得沿用金幣的大數字樣式');
  assert(!html.includes('wk-rw-xpgain'), '不得沿用經驗值樣式');
  assert(html.includes('pill'), '應以 pill 並列呈現，視覺權重低於金幣與經驗值卡');
});
