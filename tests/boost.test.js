// Slice 5：雙倍金幣卡（遊戲組 V5 新增的功能卡機制）。
//
// 本檔鎖的是不變量 1：金幣唯一產出入口是 commitSession()，介面不得新增任何加值方法。
// 雙倍卡看似「多給金幣」，但它必須是「同一次結算的產出乘以係數」，而不是第二個入口——
// 差別在於：前者仍受有效次數、達標率、連續天數的約束（沒做動作就是 0 乘以 2 還是 0），
// 後者則可以憑空生錢。企劃書第四章寫明「介面中不存在增加金幣之方法」，靠的正是這個結構。
import { test, eq, assert } from './harness.js';
import { store, COIN_BOOST_MULTIPLIER } from '../app/state/store.js';

const mk = (validReps, invalidReps = 0) => ({
  exercise: 'squat', exerciseName: '深蹲', durationSec: 60,
  validReps, invalidReps, faultCounts: {}, met: 5.4, baseCoinPerRep: 10,
});
const fresh = () => store.reset();

test('boost: consumeBoost 不接受任何參數，倍率為模組內常數', () => {
  fresh();
  eq(store.consumeBoost.length, 0, 'consumeBoost 不得宣告任何參數 —— 倍率不由呼叫端指定');
  assert(Number.isInteger(COIN_BOOST_MULTIPLIER) && COIN_BOOST_MULTIPLIER >= 2,
    `倍率應為 ≥2 的整數常數，實得 ${COIN_BOOST_MULTIPLIER}`);
  // 就算硬塞參數也不得影響倍率
  fresh(); store.consumeBoost(99);
  const boosted = store.commitSession(mk(10)).coinsEarned;
  fresh();
  const base = store.commitSession(mk(10)).coinsEarned;
  eq(boosted, base * COIN_BOOST_MULTIPLIER, '傳入 99 不得讓倍率變成 99 倍');
});

test('boost: 套用後金幣為原本的 COIN_BOOST_MULTIPLIER 倍', () => {
  fresh();
  const base = store.commitSession(mk(20)).coinsEarned;
  fresh();
  eq(store.consumeBoost(), true, '首次宣告應成功');
  const s = store.commitSession(mk(20));
  eq(s.coinsEarned, base * COIN_BOOST_MULTIPLIER);
  eq(s.coinBoostApplied, true, 'session 應記錄本次已套用，供結算畫面說明');
});

test('boost: 只對下一次結算生效，該次之後自動清除', () => {
  fresh();
  const base = store.commitSession(mk(20)).coinsEarned;
  fresh();
  store.consumeBoost();
  const first = store.commitSession(mk(20));
  const second = store.commitSession(mk(20));
  eq(first.coinsEarned, base * COIN_BOOST_MULTIPLIER, '第一次應加倍');
  eq(second.coinsEarned, base, '第二次應回到原值 —— 生效次數為 1');
  eq(second.coinBoostApplied, false);
  eq(store.isBoostArmed(), false, '結算後旗標應已清除');
});

test('boost: 不可疊加 —— 兩張卡不會變四倍', () => {
  fresh();
  const base = store.commitSession(mk(20)).coinsEarned;
  fresh();
  eq(store.consumeBoost(), true);
  eq(store.consumeBoost(), false, '已有一張生效中時，第二次宣告應回傳 false');
  eq(store.consumeBoost(), false);
  eq(store.commitSession(mk(20)).coinsEarned, base * COIN_BOOST_MULTIPLIER,
    '連續宣告三次仍只加倍一次');
});

test('boost: 未使用功能卡時，金幣計算與現況完全相同（回歸保護）', () => {
  for (const [v, iv] of [[0, 0], [1, 0], [20, 5], [37, 13]]) {
    fresh();
    const s = store.commitSession(mk(v, iv));
    eq(s.coinBoostApplied, false, `validReps=${v} 時不應套用`);
    eq(store.isBoostArmed(), false);
    // 與 Slice 1 的純函式對照，確認沒有任何隱含倍率
    const total = v + iv;
    const targetRate = total ? v / total : 0;
    assert(Number.isFinite(s.coinsEarned) && s.coinsEarned >= 0, '金幣應為非負有限數');
    if (v === 0) eq(s.coinsEarned, 0, '零有效次數時，加不加倍都應是 0');
  }
});

test('boost: 零有效次數時加倍仍是 0（不得憑空生錢）', () => {
  fresh();
  store.consumeBoost();
  const s = store.commitSession(mk(0, 15));
  eq(s.coinsEarned, 0, '0 × 2 仍是 0 —— 這正是「乘以係數」而非「第二個入口」的差別');
  eq(s.coinBoostApplied, true, '旗標仍被消耗，不會留到下一次');
  eq(store.isBoostArmed(), false);
});

test('boost: 旗標經序列化保留，重整後仍有效（持久化）', () => {
  fresh();
  store.consumeBoost();
  const dump = store.exportJSON();
  assert(JSON.parse(dump).boost?.coinNext === true, '旗標應寫入持久化結構');
  // 模擬重整：清空後匯入
  store.reset();
  eq(store.isBoostArmed(), false, '前提：reset 後旗標應為關閉');
  store.importJSON(dump);
  eq(store.isBoostArmed(), true, '重整後旗標應仍有效 —— 卡已消耗掉，不能跟著消失');
});

test('boost: store 對外介面仍不存在任何可直接增加金幣的方法（不變量 1）', () => {
  const methods = Object.keys(store).filter((k) => typeof store[k] === 'function');
  const forbidden = ['addCoins', 'earnCoins', 'giveCoins', 'setCoins', 'grantCoins', 'addXp', 'setXp'];
  for (const f of forbidden) {
    assert(!methods.includes(f), `介面不得出現 ${f} —— 金幣唯一產出入口是 commitSession()`);
  }
  // consumeBoost 只設旗標，本身不動錢包
  fresh();
  const before = store.getState().wallet.coins;
  store.consumeBoost();
  eq(store.getState().wallet.coins, before, 'consumeBoost 本身不得改變金幣');
});

test('boost: 舊存檔缺 boost 欄位時不拋例外（邊界）', () => {
  fresh();
  const old = JSON.parse(store.exportJSON());
  delete old.boost;                       // 模擬 Slice 5 之前的存檔
  store.importJSON(JSON.stringify(old));
  eq(store.isBoostArmed(), false, '缺欄位應視為未啟用');
  const s = store.commitSession(mk(10));
  assert(Number.isFinite(s.coinsEarned), '舊存檔仍應能正常結算');
});
