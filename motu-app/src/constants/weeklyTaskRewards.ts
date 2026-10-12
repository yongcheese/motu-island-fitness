/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 每週任務的完成獎勵 — 一個任務值多少、這一週領過沒有、還能不能領。這裡沒有 React，也沒有
 * Firestore。
 *
 * 規則的那一半；寫入在 context/useWeeklyTasks.ts 的 `claimTaskReward`，畫面在
 * components/health/TaskRewardStrip.tsx。這個檔案的 API 由 scripts/test-weekly-task-rewards.ts
 * （`npm run test:weekly-task-rewards`）釘住。
 *
 * ## 「畫面上寫的」跟「實際拿到的」為什麼不可能不一樣
 *
 * 只有一個函式在回答「這個任務值什麼」：{@link rewardForTask}。任務卡上那排獎勵是它的回傳值，
 * 按下「領取獎勵」時寫進存檔的也是它的回傳值 —— 同一個函式、同一份任務定義、同一個時刻，所以
 * 卡片不可能承諾一個數字而寫入發另一個。
 *
 * 領取之後，卡片改讀**領取紀錄**（{@link WeeklyTaskRewardClaim.rewards}），裡面存的是結算後真的
 * 入帳的數量。所以就算玩家領完之後把目標改小（獎勵等級跟著變），或是有一張加成卡在跑，卡上寫的
 * 仍然是那一次真正發出去的東西，而不是現在重新算一次的報價。
 *
 * ## 為什麼獎勵跟著「目標有多難」走，而不是每個任務一樣
 *
 * 每週任務是玩家**自己設的**。如果每個任務都發一樣多，最划算的做法是建八個「每週運動 1 次」然後
 * 健身一次 —— 那是在獎勵「會開表單」，不是在獎勵運動。所以獎勵等級由目標值對照該目標類型的
 * 「一週合理份量」（{@link WeeklyTaskMetricSpec.defaultTarget}，建立表單的預填值）決定：
 *
 *   目標 < 1 倍預設  → 輕量
 *   目標 ≥ 1 倍預設  → 標準
 *   目標 ≥ 2 倍預設  → 挑戰
 *
 * 一個「每週運動 1 次」仍然有獎勵 —— 對剛開始運動的人，那就是一個真的目標 —— 只是比較少。
 *
 * ## 每週最多領幾次，以及為什麼要這條
 *
 * {@link WEEKLY_TASK_REWARD_CLAIMS_PER_WEEK}。光靠難度分級擋不住另一種刷法：領完、刪掉、用同樣的
 * 目標重建一個（新的 `taskId`，所以它「沒領過」），再領一次。領取紀錄因此**不跟著任務走**：它是
 * 一本每週一本的帳（{@link WeeklyTaskRewardLedger}），刪掉任務不會刪掉帳上那一筆，而帳上的筆數有
 * 上限。玩家看得到這個上限（任務頁標題下的「本週獎勵 1 / 3」），所以它是一條規則，不是一個會讓
 * 人以為按鈕壞了的暗門。
 *
 * ## 碎片、經驗值、功能卡 —— 沒有金幣
 *
 * 任務獎勵的來源是 `quest`，而 constants/rewards.ts 的 `SOURCE_CURRENCY_POLICY` 只讓 `quest` 發
 * 碎片。這不是這裡的選擇，是整個經濟系統的規則（金幣只能靠健身賺）。所以表裡寫了金幣的話，
 * {@link isPayableTaskReward} 會回 false、測試會紅，而不是某個玩家領到一筆被拒絕的獎勵。
 */

import { checkGrant, type Reward, type RewardSource } from './rewards';
import { getItemById } from './items';
import { isStackableItem } from '../utils/inventory';
import { getUtilityCard } from './utilityCards';
import {
  getMetricSpec,
  type CivilDate,
  type WeeklyCycle,
  type WeeklyTaskDefinition,
  type WeeklyTaskProgress,
} from './weeklyTasks';

/** 任務獎勵記在誰的帳上。寫入時每一筆都帶著它，經濟規則也照它判斷能發什麼。 */
export const WEEKLY_TASK_REWARD_SOURCE: RewardSource = 'quest';

/** 一週最多領幾個任務的獎勵。見檔頭「每週最多領幾次」。 */
export const WEEKLY_TASK_REWARD_CLAIMS_PER_WEEK = 3;

// --- 獎勵表 ------------------------------------------------------------------

export type WeeklyTaskRewardTierId = 'light' | 'standard' | 'challenge';

/** 一個獎勵等級：多難才算這一級、這一級發什麼。 */
export interface WeeklyTaskRewardTier {
  id: WeeklyTaskRewardTierId;
  /** 卡片上那個小標籤。 */
  label: string;
  /** 目標值至少要是預設目標的幾倍，才算這一級。表由低到高排，取最後一個符合的。 */
  minRatio: number;
  /** 這一級發的東西。可以是任何 {@link Reward}，只要 {@link isPayableTaskReward} 認得。 */
  rewards: readonly Reward[];
}

/**
 * 獎勵表。要調整數字、加一種獎勵（例如某一級多送一件造型），改這裡就好 —— 卡片、領取寫入與
 * 測試都讀這張表，沒有任何元件自己知道「標準任務是 15 碎片」。
 *
 * 數字是對著其他碎片來源訂的（context/useEconomyActions.ts）：摸摸寵物一次 5 碎片、一天最多三
 * 次；島嶼秘寶一次性 60。一個標準任務 15 碎片，大約是一天份的摸摸寵物 —— 一週的目標值一天的小
 * 互動，而不是一筆會讓「建任務」比「運動」好賺的收入。經驗值同理：一次 30 下的健身就有 150 XP
 * （constants/workoutRewards.ts），任務的 XP 是錦上添花，不是主要來源。
 *
 * 挑戰級多一張雙倍金幣券：它加倍的是**健身**賺到的金幣，所以它獎勵的仍然是下一次運動。
 */
export const WEEKLY_TASK_REWARD_TIERS: readonly WeeklyTaskRewardTier[] = [
  {
    id: 'light',
    label: '輕量',
    minRatio: 0,
    rewards: [
      { kind: 'currency', currency: 'fragments', amount: 5 },
      { kind: 'xp', amount: 20 },
    ],
  },
  {
    id: 'standard',
    label: '標準',
    minRatio: 1,
    rewards: [
      { kind: 'currency', currency: 'fragments', amount: 15 },
      { kind: 'xp', amount: 50 },
    ],
  },
  {
    id: 'challenge',
    label: '挑戰',
    minRatio: 2,
    rewards: [
      { kind: 'currency', currency: 'fragments', amount: 30 },
      { kind: 'xp', amount: 100 },
      { kind: 'utility-card', cardId: 'double-coin', quantity: 1 },
    ],
  },
];

export function getRewardTier(id: string): WeeklyTaskRewardTier | null {
  return WEEKLY_TASK_REWARD_TIERS.find((tier) => tier.id === id) ?? null;
}

/** 一個任務的報價：哪一級、發什麼。 */
export interface WeeklyTaskRewardQuote {
  tier: WeeklyTaskRewardTier;
  rewards: readonly Reward[];
}

/**
 * 這個任務完成後值什麼。**全遊戲唯一回答這個問題的地方** —— 卡片顯示的與領取時寫入的都是它。
 *
 * 目標類型不認得（舊存檔裡被移除的類型）或還沒有資料來源的，回 null：一個永遠完成不了的任務
 * 掛著一排獎勵，是在承諾一件做不到的事。
 */
export function rewardForTask(task: Pick<WeeklyTaskDefinition, 'metric' | 'target'>): WeeklyTaskRewardQuote | null {
  const spec = getMetricSpec(task.metric);
  if (!spec || !spec.available) return null;
  if (!Number.isFinite(task.target) || task.target <= 0) return null;
  const ratio = task.target / Math.max(1, spec.defaultTarget);
  let tier: WeeklyTaskRewardTier | null = null;
  for (const candidate of WEEKLY_TASK_REWARD_TIERS) {
    if (ratio >= candidate.minRatio) tier = candidate;
  }
  return tier ? { tier, rewards: tier.rewards } : null;
}

/**
 * 這一筆獎勵領取流程付不付得出來。
 *
 * 領取寫入（context/useWeeklyTasks.ts）只會付三種東西：經濟規則允許的貨幣／經驗值、背包裡的功能
 * 卡，以及只能擁有一件的商品。表裡出現任何其他東西 —— 金幣（`quest` 不准發）、不存在的卡、目錄
 * 裡沒有的商品、可堆疊的家具 —— 都在這裡被認出來，測試會對整張表跑一次，所以「畫面上顯示一個
 * 領不到的獎勵」在上線前就會紅。
 */
export function isPayableTaskReward(reward: Reward): boolean {
  if (!checkGrant({ reward, source: WEEKLY_TASK_REWARD_SOURCE }).ok) return false;
  switch (reward.kind) {
    case 'currency':
    case 'xp':
      return true;
    case 'utility-card':
      return getUtilityCard(reward.cardId) !== null;
    case 'item': {
      // 一件商品一次只能擁有一件（帽子、衣服、裝飾）。可堆疊的家具要動庫存數量，那是另一條寫入
      // 路徑，這裡不假裝會處理。
      return reward.quantity === 1 && getItemById(reward.itemId) !== undefined && !isStackableItem(reward.itemId);
    }
    default:
      return false;
  }
}

// --- 領取紀錄 ----------------------------------------------------------------

/** 一次領取寫下的東西。 */
export interface WeeklyTaskRewardClaim {
  /** ISO 字串。 */
  claimedAt: string;
  tier: WeeklyTaskRewardTierId;
  /**
   * 真正入帳的東西，結算過的數字（加成卡在跑時可能比報價多）。領取之後的卡片讀這一份，不再讀
   * 報價，所以它說的是那一次真的發了什麼。
   */
  rewards: Reward[];
  /** 領取當下的任務名稱。任務被刪掉之後，帳上這一筆仍然說得出是哪一個。 */
  taskName: string;
}

/**
 * 一週一本的領取帳，存在 `profile.weeklyTasks.rewardClaims`。
 *
 * 只留當週：跨週之後上一週的帳就沒有用了（上一週的獎勵已經過了領取期限），下一筆領取會整本換
 * 掉。所以它的大小有上限 —— 最多 {@link WEEKLY_TASK_REWARD_CLAIMS_PER_WEEK} 筆 —— 不會在存檔
 * 裡長成一份日誌。
 */
export interface WeeklyTaskRewardLedger {
  /** 這本帳是哪一週的（該週的星期一）。 */
  week: CivilDate;
  /** taskId → 領取紀錄。 */
  claims: Record<string, WeeklyTaskRewardClaim>;
}

/** 這一週帳上的紀錄。帳是別週的就當作空的 —— 跨週不需要任何寫入，跟進度一樣。 */
export function claimsForWeek(
  ledger: WeeklyTaskRewardLedger | null | undefined,
  weekStart: CivilDate,
): Record<string, WeeklyTaskRewardClaim> {
  return ledger && ledger.week === weekStart ? ledger.claims : {};
}

/** 把一筆領取記進帳裡。帳是別週的，就開一本新的。 */
export function recordRewardClaim(
  ledger: WeeklyTaskRewardLedger | null | undefined,
  weekStart: CivilDate,
  taskId: string,
  claim: WeeklyTaskRewardClaim,
): WeeklyTaskRewardLedger {
  return { week: weekStart, claims: { ...claimsForWeek(ledger, weekStart), [taskId]: claim } };
}

// --- 狀態 --------------------------------------------------------------------

/**
 * 一張任務卡的獎勵現在是什麼狀態。每一種都是卡片要畫成不同樣子的狀態：
 *
 *  - `none`       — 這個任務沒有獎勵（目標類型不認得）。不畫獎勵區。
 *  - `locked`     — 還沒完成。顯示「完成後可領取」＋報價。
 *  - `claimable`  — 完成了、還沒領、本週還有額度。顯示「領取獎勵」。
 *  - `capped`     — 完成了、還沒領，但本週的額度用完了。
 *  - `claimed`    — 領過了。顯示實際入帳的東西。
 */
export type WeeklyTaskRewardStatus =
  | { kind: 'none' }
  | { kind: 'locked'; quote: WeeklyTaskRewardQuote }
  | { kind: 'claimable'; quote: WeeklyTaskRewardQuote }
  | { kind: 'capped'; quote: WeeklyTaskRewardQuote }
  | { kind: 'claimed'; claim: WeeklyTaskRewardClaim };

/**
 * 算出一個任務在這一週的獎勵狀態。跟進度一樣是**算出來的**：輸入是算好的進度與存檔裡的帳，
 * 沒有任何「可以領」的旗標存在任何地方 —— 所以不可能出現「進度說完成了、獎勵說還不能領」。
 */
export function rewardStatusFor(
  entry: WeeklyTaskProgress,
  ledger: WeeklyTaskRewardLedger | null | undefined,
): WeeklyTaskRewardStatus {
  const claims = claimsForWeek(ledger, entry.cycle.weekStart);
  const claim = claims[entry.task.taskId];
  // 先看帳：領過的就是領過了，即使之後任務被改到報價變了、甚至變成沒有報價。
  if (claim) return { kind: 'claimed', claim };

  const quote = rewardForTask(entry.task);
  if (!quote) return { kind: 'none' };
  if (!entry.completed || entry.status === 'upcoming') return { kind: 'locked', quote };
  if (Object.keys(claims).length >= WEEKLY_TASK_REWARD_CLAIMS_PER_WEEK) return { kind: 'capped', quote };
  return { kind: 'claimable', quote };
}

/** 這一週已經領了幾次。任務頁標題下的「本週獎勵 N / 3」。 */
export function claimCountForWeek(ledger: WeeklyTaskRewardLedger | null | undefined, cycle: WeeklyCycle): number {
  return Object.keys(claimsForWeek(ledger, cycle.weekStart)).length;
}

// --- 發放計畫 ----------------------------------------------------------------

/**
 * 一次領取要動到的東西，依寫入方式分好。
 *
 * 分開是因為三種東西住在存檔的三個地方、各有各的規則：貨幣／經驗值走經濟服務的
 * `buildCurrencyUpdate`（政策檢查 ＋ 加成卡結算），功能卡走 `grantCards`（背包上限），商品走
 * `inventory` 的 arrayUnion。寫入端照這份計畫組出**一次** `updateDoc`，所以領取紀錄與入帳一起
 * 成功或一起失敗。
 */
export interface TaskRewardPayoutPlan {
  currency: Reward[];
  cards: Extract<Reward, { kind: 'utility-card' }>[];
  items: Extract<Reward, { kind: 'item' }>[];
  /** 付不出來的。非空代表表寫錯了 —— 寫入端會整筆拒絕，而不是只發一部分。 */
  unpayable: Reward[];
}

export function planTaskRewardPayout(rewards: readonly Reward[]): TaskRewardPayoutPlan {
  const plan: TaskRewardPayoutPlan = { currency: [], cards: [], items: [], unpayable: [] };
  for (const reward of rewards) {
    if (!isPayableTaskReward(reward)) {
      plan.unpayable.push(reward);
    } else if (reward.kind === 'utility-card') {
      plan.cards.push(reward);
    } else if (reward.kind === 'item') {
      if (!plan.items.some((item) => item.itemId === reward.itemId)) plan.items.push(reward);
    } else {
      // 同一種貨幣／經驗值出現兩次就合併成一筆：它們最後是同一個欄位上的一個 increment，兩筆分開
      // 組的話，後一筆會蓋掉前一筆，玩家只拿到一半。
      const same = plan.currency.findIndex(
        (entry) => entry.kind === reward.kind && (entry.kind !== 'currency' || reward.kind !== 'currency' || entry.currency === reward.currency),
      );
      if (same === -1) {
        plan.currency.push(reward);
      } else {
        const entry = plan.currency[same] as Extract<Reward, { kind: 'currency' | 'xp' }>;
        plan.currency[same] = { ...entry, amount: entry.amount + (reward as typeof entry).amount };
      }
    }
  }
  return plan;
}

// --- 存檔 --------------------------------------------------------------------

function normalizeReward(raw: unknown): Reward | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const positiveInt = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0;
  switch (r.kind) {
    case 'currency':
      return (r.currency === 'coins' || r.currency === 'fragments') && positiveInt(r.amount)
        ? { kind: 'currency', currency: r.currency, amount: r.amount as number }
        : null;
    case 'xp':
      return positiveInt(r.amount) ? { kind: 'xp', amount: r.amount as number } : null;
    case 'utility-card':
      return getUtilityCard(r.cardId as string) && positiveInt(r.quantity)
        ? { kind: 'utility-card', cardId: r.cardId as Extract<Reward, { kind: 'utility-card' }>['cardId'], quantity: r.quantity as number }
        : null;
    case 'item':
      return typeof r.itemId === 'string' && positiveInt(r.quantity)
        ? { kind: 'item', itemId: r.itemId, quantity: r.quantity as number }
        : null;
    default:
      return null;
  }
}

/**
 * 讀存檔時的防線，理由同 `normalizeWeeklyTaskState`：形狀不對的帳不該一路長到卡片上。
 *
 * 一筆壞掉的領取紀錄**仍然算領過**（`rewards` 變成空陣列，而不是整筆丟掉）：丟掉它會讓那個任務
 * 在這一週變回「可以領」，那是一次重複發放。畫面上少顯示一排圖示，比多發一次獎勵便宜得多。
 */
export function normalizeRewardLedger(raw: unknown): WeeklyTaskRewardLedger | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { week, claims } = raw as { week?: unknown; claims?: unknown };
  if (typeof week !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(week)) return null;
  const cleaned: Record<string, WeeklyTaskRewardClaim> = {};
  if (typeof claims === 'object' && claims !== null) {
    for (const [taskId, entry] of Object.entries(claims as Record<string, unknown>)) {
      if (!taskId) continue;
      const claim = (typeof entry === 'object' && entry !== null ? entry : {}) as Partial<Record<keyof WeeklyTaskRewardClaim, unknown>>;
      const tier = typeof claim.tier === 'string' && getRewardTier(claim.tier) ? (claim.tier as WeeklyTaskRewardTierId) : 'light';
      cleaned[taskId] = {
        claimedAt: typeof claim.claimedAt === 'string' ? claim.claimedAt : new Date(0).toISOString(),
        tier,
        rewards: Array.isArray(claim.rewards)
          ? claim.rewards.map(normalizeReward).filter((reward): reward is Reward => reward !== null)
          : [],
        taskName: typeof claim.taskName === 'string' ? claim.taskName : '',
      };
    }
  }
  return { week, claims: cleaned };
}
