// Slice 2：commitSession() 輸出本次碎片與抽獎券。
//
// 兩條不變量在此鎖死：
//  (1) 健身端**不持有**碎片與抽獎券的餘額 —— 08/21 雙方議定由遊戲端記帳。
//      若哪天有人「順手」把它們存進 wallet，就等於開了一條可回流成金幣的路，
//      「金幣唯一來源為訓練結算」這句承諾當場破功。故以負向斷言鎖住。
//  (2) 新增欄位必須是純追加 —— commitSession() 的回傳值是將來遊戲端依賴的對外契約。
import { test, eq, assert } from './harness.js';
import { store } from '../app/state/store.js';
import { shardsFor, ticketsFor, SHARD_PER_VALID_REPS, TICKET_MIN_VALID_REPS } from '../app/core/rewards.js';

const mk = (validReps, invalidReps = 0) => ({
  exercise: 'squat', exerciseName: '深蹲', durationSec: 60,
  validReps, invalidReps, faultCounts: {}, met: 5.4, baseCoinPerRep: 1,
});
const fresh = () => { store.reset(); };

test('commitSession: 回傳物件含 shards / tickets / xpGain 三個新欄位', () => {
  fresh();
  const s = store.commitSession(mk(20));
  for (const k of ['shards', 'tickets', 'xpGain']) {
    assert(k in s, `回傳物件應含 ${k}，實得鍵：${Object.keys(s)}`);
    assert(Number.isFinite(s[k]), `${k} 應為有限數值，實得 ${s[k]}`);
  }
});

test('commitSession: 新增欄位為純追加，既有欄位一個都不能少', () => {
  fresh();
  const s = store.commitSession(mk(12, 3));
  // 這 12 個欄位是遊戲端將依賴的對外契約，名稱與型別都不得更動
  const contract = {
    id: 'string', dateISO: 'string', date: 'string', exercise: 'string', exerciseName: 'string',
    durationSec: 'number', validReps: 'number', invalidReps: 'number', targetRate: 'number',
    coinsEarned: 'number', grade: 'string', faults: 'object',
  };
  for (const [k, t] of Object.entries(contract)) {
    assert(k in s, `既有欄位 ${k} 不得消失`);
    eq(typeof s[k], t, `既有欄位 ${k} 的型別不得改變`);
  }
  eq(s.validReps, 12, '既有欄位的語意不得改變');
  eq(s.invalidReps, 3);
});

test('commitSession: wallet 不得出現碎片／抽獎券餘額（不變量，負向斷言）', () => {
  fresh();
  store.commitSession(mk(30));
  store.commitSession(mk(30));
  const wallet = store.getState().wallet;
  const keys = Object.keys(wallet);
  eq(keys.sort().join(','), 'coins,level,xp', `wallet 只應有 coins/xp/level，實得 ${keys}`);
  for (const bad of ['shards', 'tickets', 'shard', 'ticket']) {
    assert(!(bad in wallet), `wallet 不得持有 ${bad} —— 該資源由遊戲端記帳`);
  }
});

test('commitSession: 序列化結果不含碎片／抽獎券餘額', () => {
  fresh();
  store.commitSession(mk(30));
  const json = store.exportJSON();
  const parsed = JSON.parse(json);
  eq(Object.keys(parsed.wallet).sort().join(','), 'coins,level,xp');
  // session 內含本次獲得量是正確的（那是紀錄，不是餘額）；wallet 內則絕不可有
  assert(parsed.history.length > 0, '前提：history 應有紀錄');
  assert('shards' in parsed.history[0], 'history 的單次紀錄可以有 shards（那是本次獲得量）');
});

test('commitSession: xpGain 與 wallet.xp 的實際增量一致', () => {
  fresh();
  const before = store.getState().wallet.xp;
  const s = store.commitSession(mk(17));
  const after = store.getState().wallet.xp;
  eq(s.xpGain, after - before, 'xpGain 必須等於實際增量，否則 UI 顯示的數字會與帳不符');
});

test('commitSession: shards / tickets 與純函式的計算結果一致', () => {
  fresh();
  const validReps = 25, invalidReps = 5;
  const s = store.commitSession(mk(validReps, invalidReps));
  const targetRate = validReps / (validReps + invalidReps);
  eq(s.shards, shardsFor({ validReps }), 'store 不得自行另算一套碎片規則');
  eq(s.tickets, ticketsFor({ validReps, targetRate }), 'store 不得自行另算一套抽獎券規則');
});

test('commitSession: 零有效次數時碎片與抽獎券皆為 0（邊界）', () => {
  fresh();
  const s = store.commitSession(mk(0, 10));
  eq(s.shards, 0, '沒有有效次數就不該產出碎片');
  eq(s.tickets, 0, '沒有有效次數就不該產出抽獎券');
  eq(s.coinsEarned, 0, '同理，金幣亦為 0');
});

test('commitSession: 有效次數未達門檻時不發抽獎券（邊界）', () => {
  fresh();
  const s = store.commitSession(mk(TICKET_MIN_VALID_REPS - 1));
  eq(s.tickets, 0, `有效次數 ${TICKET_MIN_VALID_REPS - 1} 未達門檻，不應發抽獎券`);
  const s2 = store.commitSession(mk(SHARD_PER_VALID_REPS - 1));
  eq(s2.shards, 0, '未滿一份碎片不予發放');
});

test('commitSession: 髒輸入不會讓新欄位變成 NaN（邊界）', () => {
  fresh();
  const s = store.commitSession({ ...mk(0), validReps: NaN, invalidReps: Infinity });
  for (const k of ['shards', 'tickets', 'xpGain', 'coinsEarned']) {
    assert(Number.isFinite(s[k]), `${k} 不得為 NaN/Infinity，實得 ${s[k]}`);
  }
});

// —— 不變量 2：經驗值只增不減 ——
// 原測試只寫 eq(s.xpGain, after - before)，跨模型互審指出：兩者同為負數或 NaN 也會通過，
// 等於沒有驗證「只增不減」。以下補上真正的守門。

test('commitSession: xpGain 必為非負有限整數', () => {
  fresh();
  for (const [v, iv] of [[0, 0], [1, 0], [20, 5], [999, 0]]) {
    const s = store.commitSession(mk(v, iv));
    assert(Number.isInteger(s.xpGain) && s.xpGain >= 0,
      `validReps=${v} 的 xpGain 應為非負整數，實得 ${s.xpGain}`);
  }
});

test('commitSession: 髒輸入不得讓 xp 倒退或污染（不變量 2）', () => {
  fresh();
  const dirty = [
    { validReps: -50, invalidReps: 0 },
    { validReps: NaN, invalidReps: 0 },
    { validReps: Infinity, invalidReps: 0 },
    { validReps: -Infinity, invalidReps: 0 },
    { validReps: '20', invalidReps: 0 },
    {},                                    // 完全缺欄位
  ];
  for (const bad of dirty) {
    const before = store.getState().wallet.xp;
    const s = store.commitSession({ ...mk(0), ...bad });
    const after = store.getState().wallet.xp;
    assert(Number.isInteger(after) && after >= 0, `輸入 ${JSON.stringify(bad)} 後 xp 應仍為非負整數，實得 ${after}`);
    assert(after >= before, `xp 不得倒退：${before} → ${after}（輸入 ${JSON.stringify(bad)}）`);
    assert(Number.isFinite(s.xpGain) && s.xpGain >= 0, `xpGain 不得為負或 NaN，實得 ${s.xpGain}`);
  }
});

test('commitSession: 連續多次結算後 xp 單調不減（不變量 2）', () => {
  fresh();
  let prev = store.getState().wallet.xp;
  for (const v of [10, 0, 25, 0, 3, 100, 0]) {
    store.commitSession(mk(v, 5));
    const now = store.getState().wallet.xp;
    assert(now >= prev, `第 ${v} 次後 xp 由 ${prev} 變成 ${now} —— 經驗值只增不減`);
    prev = now;
  }
  assert(prev > 0, '前提：應確實累積過經驗值');
});

test('commitSession: 全 invalid 時四種資源皆為 0（沒做對就沒有獎勵）', () => {
  fresh();
  const s = store.commitSession(mk(0, 30));
  for (const k of ['coinsEarned', 'xpGain', 'shards', 'tickets']) {
    eq(s[k], 0, `全部無效時 ${k} 應為 0 —— 這是「只有正確動作可換取獎勵」的底線`);
  }
});
