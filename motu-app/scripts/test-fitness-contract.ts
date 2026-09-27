/**
 * 健身頁 ↔ 遊戲端資料契約（src/components/fitness/gameContract.ts）。
 *
 * 這三個函式決定「玩家看到多少錢」「這次訓練算不算、算幾下」「領獎演出播哪幾項」。
 * 寫錯不會報錯，只會悄悄多發或少發，所以用測試鎖住。
 *
 *   npm run test:fitness
 */
import {
  awardQueue,
  balancesFromProfile,
  completionFromSession,
  type FitnessSession,
} from '../src/components/fitness/gameContract';
import { fragmentsForWorkout } from '../src/constants/fragments';
import { isValidWorkout, payoutForWorkout, WORKOUT_PAYOUT } from '../src/constants/workoutRewards';
import type { UserProfile } from '../src/types';
import { createFitnessSettle, type SettleDeps } from '../src/components/fitness/useFitnessSettle';
import type { WorkoutCompletion } from '../src/constants/workoutRewards';
import type { FragmentGrant } from '../src/constants/fragments';

let checks = 0;
let failures = 0;
function ok(name: string, cond: boolean, detail = '') {
  checks += 1;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}
const show = (v: unknown) => JSON.stringify(v);

const profile = (over: Partial<UserProfile> = {}): UserProfile =>
  ({
    userId: 'u-1',
    displayName: 'tester',
    level: 1,
    currentXp: 0,
    territoryLevel: 1,
    balanceGold: 0,
    inventory: [],
    equippedItems: [],
    lastUpdated: '2026-09-26T00:00:00.000Z',
    ...over,
  }) as unknown as UserProfile;

const session = (over: Partial<FitnessSession> = {}): FitnessSession => ({
  id: 'abc123',
  dateISO: '2026-09-26T10:00:00.000Z',
  exercise: 'squat',
  exerciseName: '深蹲',
  durationSec: 90,
  validReps: 20,
  mode: 'camera',
  ...over,
});

console.log('\n-- balancesFromProfile ---------------------------------------------------');
{
  const b = balancesFromProfile(
    profile({ balanceGold: 1234, currentXp: 250, wallet: { fragments: 56 } } as Partial<UserProfile>),
  );
  ok('金幣讀 balanceGold、碎片讀 wallet.fragments', b.coins === 1234 && b.fragments === 56, show(b));
  ok('經驗照存檔、等級照遊戲端公式（250 XP → LV.3）', b.xp === 250 && b.level === 3, show(b));
}
{
  const b = balancesFromProfile(null);
  ok('邊界：profile 為 null → 全部 0（含等級）', show(b) === show({ coins: 0, fragments: 0, xp: 0, level: 0 }), show(b));
  ok('邊界：profile 為 undefined → 全部 0', balancesFromProfile(undefined).level === 0);
}
{
  const b = balancesFromProfile(
    profile({ balanceGold: Number.NaN, currentXp: -40 } as Partial<UserProfile>),
  );
  ok(
    '邊界：舊存檔沒有 wallet、金幣 NaN、經驗負數 → 0，等級 1',
    b.coins === 0 && b.fragments === 0 && b.xp === 0 && b.level === 1,
    show(b),
  );
}

console.log('\n-- completionFromSession -------------------------------------------------');
{
  const c = completionFromSession(session(), 'u-1');
  ok('相機真人訓練 → 產生完成事件', c !== null);
  ok('repCount＝有效次數、durationSeconds＝實際秒數', c?.repCount === 20 && c?.durationSeconds === 90, show(c));
  ok('workoutType 用中文動作名（遊戲端健康頁拿它比對）', c?.workoutType === '深蹲', show(c));
  ok('userId、完成時間照傳', c?.userId === 'u-1' && c?.completedAt === '2026-09-26T10:00:00.000Z', show(c));
  ok('source 為 prototype（遊戲端既有值）', c?.source === 'prototype', show(c));
  ok('workoutId 由 session id 組成（重送可去重）', c?.workoutId === 'fx-abc123', show(c));
  ok('遊戲端驗證為有效健身', isValidWorkout(c));
}
{
  const a = completionFromSession(session({ id: undefined }), 'u-1');
  const b = completionFromSession(session({ id: undefined }), 'u-1');
  ok('沒有 session id → 遊戲端自行發號，兩次不同', !!a?.workoutId && a.workoutId !== b?.workoutId, `${a?.workoutId} / ${b?.workoutId}`);
}
{
  const c = completionFromSession(session({ exerciseName: undefined, exercise: 'pushup' }), 'u-1');
  ok('沒有中文名 → 退回動作 id', c?.workoutType === 'pushup', show(c));
}
ok('示範模式 → null（不發獎）', completionFromSession(session({ mode: 'demo' }), 'u-1') === null);
ok('手動計數 → null（不發獎）', completionFromSession(session({ mode: 'manual' }), 'u-1') === null);
ok('邊界：沒標 mode → null（寧可漏發不讓示範刷錢）', completionFromSession(session({ mode: undefined }), 'u-1') === null);
ok('邊界：session 為 null → null', completionFromSession(null, 'u-1') === null);
ok('邊界：沒有 userId → null', completionFromSession(session(), '') === null);
{
  const c = completionFromSession(session({ validReps: 0, durationSec: 45 }), 'u-1');
  ok('0 下有效（即使 45 秒）→ null，不發獎（需求：0 下跳過領獎）', c === null, show(c));
  const q = awardQueue({ payout: c && payoutForWorkout(c), fragments: fragmentsForWorkout(0) });
  ok('0 下有效 → 領獎佇列為 []', q.length === 0, show(q));
}
ok('邊界：次數 NaN → 視為 0 下 → null', completionFromSession(session({ validReps: Number.NaN }), 'u-1') === null);
ok('邊界：次數 0.6（不足一下）→ null', completionFromSession(session({ validReps: 0.6 }), 'u-1') === null);
{
  const c = completionFromSession(session({ validReps: 1, durationSec: -5, dateISO: 'not-a-date' }), 'u-1');
  ok(
    '邊界：1 下、秒數負數、時間壞掉 → 1 次、0 秒、改用現在時間',
    c?.repCount === 1 && c?.durationSeconds === 0 && !Number.isNaN(Date.parse(c?.completedAt ?? '')),
    show(c),
  );
}
{
  const c = completionFromSession(session({ validReps: 100000, durationSec: 36000 }), 'u-1');
  const p = c && payoutForWorkout(c);
  ok(
    '超過遊戲端單次上限 → 契約不截斷，交給 payoutForWorkout 截到上限',
    c?.repCount === 100000 && p?.coins === WORKOUT_PAYOUT.maxCoinsPerWorkout && p?.xp === WORKOUT_PAYOUT.maxXpPerWorkout,
    show(p),
  );
}

console.log('\n-- awardQueue ------------------------------------------------------------');
{
  const q = awardQueue({ payout: { coins: 34, xp: 190 }, fragments: 12 });
  ok('正常一輪 → 金幣 → 經驗 → 碎片', show(q) === show([
    { kind: 'coins', amount: 34 },
    { kind: 'xp', amount: 190 },
    { kind: 'fragments', amount: 12 },
  ]), show(q));
}
{
  const c = completionFromSession(session(), 'u-1');
  const q = awardQueue({ payout: c && payoutForWorkout(c), fragments: fragmentsForWorkout(c?.repCount ?? 0) });
  ok('串起來：20 下 90 秒 → 金幣 34、經驗 190、碎片 12', show(q.map((a) => a.amount)) === show([34, 190, 12]), show(q));
}
ok('只有金幣 → 只剩金幣', show(awardQueue({ payout: { coins: 5, xp: 0 }, fragments: 0 })) === show([{ kind: 'coins', amount: 5 }]));
ok('碎片 0 → 剔除碎片', awardQueue({ payout: { coins: 5, xp: 9 }, fragments: 0 }).length === 2);
ok('全空 → []（跳過領獎）', awardQueue({ payout: { coins: 0, xp: 0 }, fragments: 0 }).length === 0);
ok('邊界：payout 為 null（示範模式）→ []', awardQueue({ payout: null, fragments: null }).length === 0);
{
  const q = awardQueue({ payout: { coins: 3.9, xp: -4 }, fragments: Number.NaN });
  ok('邊界：小數取整、負數與 NaN 剔除', show(q) === show([{ kind: 'coins', amount: 3 }]), show(q));
}

// --- Slice 9：ctx.game.settle（結束訓練 → 遊戲端發獎） -----------------------
/** 假的遊戲端：記下送了幾次完成事件、發了幾次碎片；碎片全數留在商品上。 */
function fakeGame(over: Partial<SettleDeps> = {}, p: UserProfile | null = profile()) {
  const reported: WorkoutCompletion[] = [];
  const granted: FragmentGrant[][] = [];
  const deps: SettleDeps = {
    getProfile: () => p,
    report: (c) => { reported.push(c); },
    grantFragments: async (grants) => {
      granted.push(grants);
      await new Promise((r) => setTimeout(r, 5));   // 模擬存檔要等一下，連點會落在這段空窗
      return { ok: true, results: grants.map((g) => ({ itemId: g.itemId, kept: g.amount, stored: g.amount, overflow: 0, completed: false })), tickets: 0 };
    },
    random: () => 0,
    ...over,
  };
  return { settle: createFitnessSettle(deps), reported, granted };
}

async function settleSpecs() {
  console.log('\n-- settle（Slice 9）--------------------------------------------------------');
  {
    const g = fakeGame();
    const q = await g.settle(session());
    const c = completionFromSession(session(), 'u-1')!;
    const pay = payoutForWorkout(c);
    ok('正常一輪 → 送出一次完成事件，workoutId 為 fx-<session id>', g.reported.length === 1 && g.reported[0].workoutId === 'fx-abc123', show(g.reported));
    ok('金幣／經驗＝遊戲端 payoutForWorkout；碎片＝fragmentsForWorkout', show(q) === show([
      { kind: 'coins', amount: pay.coins }, { kind: 'xp', amount: pay.xp }, { kind: 'fragments', amount: fragmentsForWorkout(20) },
    ]), show(q));
    ok('碎片發給一個商品、數量＝fragmentsForWorkout', g.granted.length === 1 && g.granted[0].length === 1 && g.granted[0][0].amount === fragmentsForWorkout(20), show(g.granted));
  }
  {
    const g = fakeGame();
    const [a, b, c] = await Promise.all([g.settle(session()), g.settle(session()), g.settle(session())]);
    ok('連點三次（同一次訓練、存檔尚未回來）→ 完成事件與碎片都只發一次', g.reported.length === 1 && g.granted.length === 1, `${g.reported.length} / ${g.granted.length}`);
    ok('連點三次拿到同一份領獎清單', show(a) === show(b) && show(b) === show(c) && a.length === 3, show([a, b, c]));
    await g.settle(session());
    ok('結算完成後再送同一次 → 仍不重發', g.reported.length === 1 && g.granted.length === 1);
    await g.settle(session({ id: 'next-1' }));
    ok('下一次訓練（不同 id）→ 照常發', g.reported.length === 2 && g.granted.length === 2);
  }
  {
    const g = fakeGame();
    const demo = await g.settle(session({ mode: 'demo' }));
    const zero = await g.settle(session({ id: 'z', validReps: 0 }));
    const none = await g.settle(null);
    ok('示範模式／0 下有效／沒有 session → []，不送事件、不發碎片', demo.length === 0 && zero.length === 0 && none.length === 0 && g.reported.length === 0 && g.granted.length === 0);
  }
  {
    const g = fakeGame({}, null);
    const q = await g.settle(session());
    ok('邊界：遊戲存檔還沒載入（profile null）→ []、不送事件', q.length === 0 && g.reported.length === 0);
  }
  {
    const g = fakeGame({ grantFragments: async () => { throw new Error('存檔被拒'); } });
    const q = await g.settle(session());
    ok('碎片存檔失敗 → 金幣經驗照發、碎片不進領獎清單、不丟錯', g.reported.length === 1 && show(q.map((a) => a.kind)) === show(['coins', 'xp']), show(q));
  }
  {
    const g = fakeGame({ grantFragments: async () => ({ ok: false, results: [], tickets: 0 }) });
    const q = await g.settle(session());
    ok('碎片存檔回報 ok:false → 碎片不進領獎清單', !q.some((a) => a.kind === 'fragments'), show(q));
  }
  {
    const g = fakeGame({ grantFragments: async (gr) => ({ ok: true, results: [{ itemId: gr[0].itemId, kept: 2, stored: 10, overflow: 10, completed: true }], tickets: 1 }) });
    const q = await g.settle(session());
    ok('碎片溢出（換成抽獎券）→ 只演出真的留在商品上的數量', q.find((a) => a.kind === 'fragments')?.amount === 2, show(q));
  }
}

settleSpecs().then(() => {
  console.log(
    failures === 0 ? `\nALL PASS (${checks} checks)\n` : `\n${failures} of ${checks} checks FAILED\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
});
