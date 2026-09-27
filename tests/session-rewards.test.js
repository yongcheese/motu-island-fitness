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

/* ---------- 合體第二階段 Slice 9：整合版金幣經驗改由遊戲端發放 ---------- */
import { claimRewards } from '../app/features/workout/workout.js';

test('Slice 9：commitSession({ grantCoins:false }) 不動錢包、XP、等級，但照常記錄訓練統計', () => {
  fresh();
  const before = JSON.parse(JSON.stringify(store.getState().wallet));
  const s = store.commitSession(mk(20, 2), { grantCoins: false });
  const st = store.getState();
  eq(st.wallet.coins, before.coins, '金幣不得增加');
  eq(st.wallet.xp, before.xp, '經驗不得增加');
  eq(st.wallet.level, before.level, '等級不得變動');
  eq(st.history.length, 1, '訓練紀錄照記');
  eq(st.history[0].validReps, 20, '有效次數照記');
  assert(st.achievements.includes('first_workout'), '成就照算');
  eq(s.coinsEarned, 0, '本端沒發金幣，coinsEarned 應為 0');
  eq(s.xpGain, 0, '本端沒發經驗，xpGain 應為 0');
  eq(s.walletGranted, false);
  eq(s.grade, 'S', '評等照算（20/22 → 91%）');
});

test('Slice 9：預設（不傳選項）行為不變 —— 照發金幣與經驗，walletGranted 為 true', () => {
  fresh();
  const before = store.getState().wallet.coins;
  const s = store.commitSession(mk(20));
  assert(s.coinsEarned > 0 && store.getState().wallet.coins === before + s.coinsEarned, '預設要照發金幣');
  eq(s.xpGain, 100); eq(store.getState().wallet.xp, 100); eq(s.walletGranted, true);
});

test('Slice 9 邊界：只有明確傳 false 才停發；null／空物件／亂傳都維持照發', () => {
  for (const opts of [null, {}, { grantCoins: 0 }, { grantCoins: 'no' }, undefined]) {
    fresh();
    const s = store.commitSession(mk(10), opts);
    assert(s.coinsEarned > 0 && store.getState().wallet.coins > 0, `opts=${JSON.stringify(opts)} 應照發`);
  }
});

test('Slice 9：不發金幣時雙倍金幣卡旗標不被消耗（卡片留給會發本端金幣的那一次）', () => {
  fresh();
  assert(store.consumeBoost(), '設起旗標');
  const s = store.commitSession(mk(20), { grantCoins: false });
  eq(s.coinBoostApplied, false);
  eq(store.isBoostArmed(), true, '旗標不該被吃掉');
});

// 假的遊戲端：記下 settle／claim 的呼叫
const fakeGame = (awards) => {
  const calls = { settle: [], claim: [] };
  return {
    calls,
    settle: async (s) => { calls.settle.push(s); return awards; },
    claim: async (a) => { calls.claim.push(a); },
  };
};
const sess = { id: 's1', exercise: 'squat', exerciseName: '深蹲', durationSec: 60, validReps: 10, coinsEarned: 0 };

test('Slice 9：claimRewards 把 session 補上計次方式交給 settle，再把回傳的清單交給 claim 播放', async () => {
  const awards = [{ kind: 'coins', amount: 16 }, { kind: 'xp', amount: 80 }, { kind: 'fragments', amount: 6 }];
  const g = fakeGame(awards);
  const got = await claimRewards(g, sess, 'camera');
  eq(g.calls.settle.length, 1);
  eq(g.calls.settle[0].mode, 'camera'); eq(g.calls.settle[0].id, 's1'); eq(g.calls.settle[0].validReps, 10);
  eq(g.calls.claim.length, 1); eq(g.calls.claim[0], awards, '領獎清單要原樣交給 claim（金額以遊戲端為準）');
  eq(got, awards);
});

test('Slice 9：遊戲端回空清單（示範模式、0 下有效）→ 跳過領獎、不呼叫 claim', async () => {
  const g = fakeGame([]);
  const got = await claimRewards(g, { ...sess, validReps: 0 }, 'demo');
  eq(g.calls.settle.length, 1); eq(g.calls.settle[0].mode, 'demo');
  eq(g.calls.claim.length, 0); eq(got.length, 0);
});

test('Slice 9 邊界：沒有 ctx.game（舊版）→ 什麼都不做；只有 claim 沒有 settle → 退回骨架相容路徑', async () => {
  eq((await claimRewards(undefined, sess, 'camera')).length, 0);
  const claimed = [];
  await claimRewards({ claim: async (a) => { claimed.push(a); } }, { ...sess, coinsEarned: 12, xpGain: 50 }, 'camera');
  eq(claimed.length, 1); eq(claimed[0][0].amount, 12);
});

test('Slice 9：settle 失敗會丟出（由 finishLive 接住後照樣進結算頁），且不會播領獎', async () => {
  let claimed = 0;
  const g = { settle: async () => { throw new Error('存檔失敗'); }, claim: async () => { claimed++; } };
  let threw = false;
  try { await claimRewards(g, sess, 'camera'); } catch { threw = true; }
  assert(threw, '要丟出讓呼叫端處理'); eq(claimed, 0);
});

test('Slice 9：finishLive 接線 —— 有 settle 時不發本端金幣、結束時記下 mode、失敗照樣進結算頁', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../app/features/workout/workout.js', import.meta.url), 'utf8');
  const fin = src.slice(src.indexOf('function finishLive()'), src.indexOf('/* ---------------- 結算（Slice 13'));
  assert(/\}, \{ grantCoins: !CTX\.game\?\.settle \}\);/.test(fin), 'commitSession 沒傳 grantCoins');
  const m = fin.indexOf('const mode = live.mode'), stop = fin.indexOf('stopLive();', fin.indexOf("emitPhase('end'"));
  assert(m > 0 && stop > 0 && m < stop, `mode 要在結算的 stopLive 清掉 live 之前記下（mode@${m} stop@${stop}）`);
  assert(/claimRewards\(CTX\.game, session, mode\)\.then\(toResult, \(e\) => \{ console\.error\(e\); toResult\(\); \}\)/.test(fin), '失敗時沒進結算頁');
  assert(/if \(!live \|\| live\.finished\) return;/.test(fin), '前端鎖（live.finished）不見了');
});
