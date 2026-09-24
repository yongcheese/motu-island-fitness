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

// 合體第一階段 Slice 3：圖示改用 Lucide 線條 SVG，與遊戲端同一套，不再用 emoji。
test('資源卡: 圖示是 Lucide SVG，輸出不含任何 emoji', () => {
  for (const [s, t] of [[3, 0], [0, 2], [4, 1]]) {
    const html = gameResourceCard(sess(s, t));
    assert(html.includes('<svg'), `應輸出 SVG 圖示，實得：${html}`);
    const emoji = html.match(/\p{Extended_Pictographic}/gu);
    assert(!emoji, `不得含 emoji，實得：${emoji?.join(' ')}`);
  }
});

test('資源卡: 每個項目各一個圖示，且圖示為裝飾（文字已說明，不重複唸）', () => {
  const both = gameResourceCard(sess(3, 1));
  eq((both.match(/<svg/g) || []).length, 2, '碎片與抽獎券各一個圖示');
  assert(both.includes('M15.39 4.39'), '碎片應用 puzzle 圖示');
  assert(both.includes('M2 9a3 3 0 0 1 0 6'), '抽獎券應用 ticket 圖示');
  eq((both.match(/aria-hidden="true"/g) || []).length, 2, '旁邊已有文字標籤，圖示應 aria-hidden');
  eq((gameResourceCard(sess(3, 0)).match(/<svg/g) || []).length, 1, '只有碎片時只畫一個圖示');
});

test('資源卡: 換成圖示後，兩者皆 0 仍不渲染（邊界）', () => {
  eq(gameResourceCard(sess(0, 0)), '', '全 0 不得因為圖示而多出任何輸出');
  eq(gameResourceCard(sess(-1, 0)), '', '負數視同沒有');
});

test('資源卡: 不得使用金幣或經驗值的視覺樣式（屬於遊戲端資產）', () => {
  const html = gameResourceCard(sess(3, 1));
  assert(!html.includes('wk-rw-coins'), '不得沿用金幣的大數字樣式');
  assert(!html.includes('wk-rw-xpgain'), '不得沿用經驗值樣式');
  assert(html.includes('pill'), '應以 pill 並列呈現，視覺權重低於金幣與經驗值卡');
});
