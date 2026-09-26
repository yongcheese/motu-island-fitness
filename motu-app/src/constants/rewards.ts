/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 獎勵 — what the game can hand a player, where it may come from, and the one rule that keeps the
 * two currencies from collapsing into one.
 *
 * This file is a vocabulary and a policy. It has no React, no Firestore and no item ids: it says
 * what a reward IS ({@link Reward}), what may have caused one ({@link RewardSource}) and which
 * sources are allowed to pay which currency ({@link SOURCE_CURRENCY_POLICY}). The service that
 * actually writes them is context/useEconomyActions.ts, and it is the only writer in the game.
 *
 * ## The rule this file exists to make unbreakable
 *
 *   金幣 is minted by 健身, and by nothing that was not deliberately let through this table.
 *
 * That is a game-design decision with real teeth — it is the reason the shop means anything — and
 * a rule of that kind cannot survive as a comment. Every reward carries its {@link RewardSource},
 * and {@link checkGrant} refuses a coin grant from any source whose row does not name `coins`. So
 * 「輪盤不小心發了金幣」 is not a bug that ships and is noticed in a month; it is a grant that does
 * not happen and a console error naming the source that tried.
 *
 * The table has exactly one exception to 「只有健身」 and it was added on purpose rather than by
 * accident, which is the whole point of a list that has to be edited: see 每日登入's row.
 *
 *   Workout      → Reward Service → 金幣 ✔
 *   Daily Login  → Reward Service → 金幣 ✔ (capped by design, see the policy table) / 碎片 ✔
 *   Wheel        → Reward Service → 金幣 ✘ (refused here) / 碎片 ✔
 *
 * ## Why a grant carries its source at all
 *
 * §17 of the brief, and it costs one field: a resource that appears in a wallet with no record of
 * why is un-debuggable, un-balanceable and impossible to audit for double payment. The source
 * travels with the reward from the thing that caused it all the way to the write, so a log line
 * can always answer 「玩家為什麼得到這些資源」.
 */

import type { CurrencyId } from './currency';
import type { UtilityCardId } from './utilityCards';

/**
 * What caused a reward. Recorded on every grant, and the input the policy below reads.
 *
 * These are CAUSES, not features — `wheel` and `quest` have no code behind them yet and are
 * declared anyway, because the policy has to be able to say 「輪盤不得發金幣」 before a 輪盤
 * exists. A source with no rule behind it grants nothing; it simply cannot be used to mint coins
 * the day somebody builds it.
 */
export type RewardSource =
  /** 健身完成 — the prototype screen today, a fitness API tomorrow. The ONLY coin source. */
  | 'workout'
  /** 每日登入獎勵 (constants/dailyLogin.ts). */
  | 'daily-login'
  /** 輪盤抽獎. Not built yet — see the file doc on why it is named here anyway. */
  | 'wheel'
  /** 新手獎勵 — anything granted for reaching a first milestone that is not a workout. */
  | 'newbie'
  /** 活動獎勵. */
  | 'event'
  /** 任務獎勵. */
  | 'quest'
  /** 島上互動 — 摸摸寵物, 島嶼秘寶, and anything else the world hands over for touching it. */
  | 'island-interaction'
  /** 管理員測試 (constants/adminFeatures.ts). Never reachable by a player. */
  | 'admin-test';

/** Human-readable cause, for the admin readout and for log lines. Never player-facing copy. */
export const REWARD_SOURCE_LABELS: Record<RewardSource, string> = {
  workout: '健身',
  'daily-login': '每日登入',
  wheel: '輪盤',
  newbie: '新手獎勵',
  event: '活動獎勵',
  quest: '任務獎勵',
  'island-interaction': '島上互動',
  'admin-test': '管理員測試',
};

/**
 * Which currencies each source may pay.
 *
 * The whole of §8/§9/§10/§12 in one table. Read it as: 健身 and 每日登入 are the only rows containing
 * `coins`, and every other row pays 碎片. `admin-test` may pay both because putting the save into an
 * arbitrary state is what 管理員測試模式 is FOR — and it is unreachable for a player (see AdminOnly).
 *
 * Adding a source without adding a row here means it can grant no currency at all, which is the
 * safe direction to fail in: a new reward that pays nothing is noticed immediately, a new reward
 * that quietly mints gold is not.
 *
 * ## 每日登入 was given `coins` on 2026-09-17, and that is a real concession
 *
 * 「金幣只有一個來源」 was the rule this table was written to enforce, and the file doc above still
 * says so in three places because it is still very nearly true. What changed is the seven-day round
 * (constants/dailyLogin.ts): four of its days can now pay 15 金幣, because a round where every
 * outcome is a resource the player cannot spend in the ordinary shop reads as a consolation prize
 * seven days running.
 *
 * What makes it survivable is the SIZE, and the size is the thing to defend rather than the rule:
 * at most 60 金幣 a week, against a short workout's 8–16 for one session
 * (constants/workoutRewards.ts). A player who opens the app every day for a week and never trains
 * has earned roughly four minutes of exercise. That is a greeting, not an income — the failure this
 * rule exists to prevent is 「開 app 比運動好賺」, and 60 a week is two orders of magnitude away
 * from it.
 *
 * The number is therefore load-bearing in a way the permission is not. Raising DAILY_PRIZE_COINS
 * is not a tuning change: it is a re-decision of this paragraph, and the rule it is spending was
 * built to have teeth.
 */
export const SOURCE_CURRENCY_POLICY: Record<RewardSource, readonly CurrencyId[]> = {
  workout: ['coins'],
  'daily-login': ['coins', 'fragments'],
  wheel: ['fragments'],
  newbie: ['fragments'],
  event: ['fragments'],
  quest: ['fragments'],
  'island-interaction': ['fragments'],
  'admin-test': ['coins', 'fragments'],
};

/** One thing granted. A discriminated union so an item grant can never be read as an amount. */
export type Reward =
  | { kind: 'currency'; currency: CurrencyId; amount: number }
  /** A catalog id (constants/items.ts). Quantity is 1 for everything own-once. */
  | { kind: 'item'; itemId: string; quantity: number }
  /**
   * 功能卡 (constants/utilityCards.ts) — a card that goes into the bag, to be used later.
   *
   * Its own member rather than a flavour of `item` because the two are stored in different places
   * and obey different rules: an item lands in `inventory` and is own-once or stock-counted, while
   * a card lands in `utilityCards.owned` as a count with a cap. Collapsing them would mean every
   * reader of a grant having to ask which kind of id it is holding.
   */
  | { kind: 'utility-card'; cardId: UtilityCardId; quantity: number }
  /** 經驗值. Not a currency — it is never spent, so it has no wallet and no policy row. */
  | { kind: 'xp'; amount: number };

/**
 * A reward plus the story of why it is being paid. This is what the economy service takes.
 *
 * `idempotencyKey` is optional because not every grant needs one — an admin button pressed twice
 * meaning twice is correct. Where a grant MUST be paid at most once (a workout, a login day), the
 * caller supplies a key derived from the event, and the guard lives with whoever owns that event's
 * record: this file does not keep a ledger.
 */
export interface RewardGrant {
  reward: Reward;
  source: RewardSource;
  /** Free-form detail for the log line — a workout id, a day index, a pool id. */
  reason?: string;
  idempotencyKey?: string;
}

/** Why a grant was refused, when it was refused before anything was written. */
export type RewardPolicyError =
  /** The source is not allowed to pay this currency. See {@link SOURCE_CURRENCY_POLICY}. */
  | 'currency-not-allowed-for-source'
  /** Zero, negative, fractional or non-finite. A grant of nothing is a bug, not a no-op. */
  | 'invalid-amount';

export type RewardPolicyResult = { ok: true } | { ok: false; error: RewardPolicyError; message: string };

/**
 * Whether this grant is allowed to happen at all — the gate every write goes through.
 *
 * Called by the economy service BEFORE it touches the save, so a refused grant leaves nothing
 * behind: no balance moved, no record written, nothing announced. It is deliberately a pure
 * function so the admin panel and the tests can ask the same question without a profile.
 */
export function checkGrant(grant: RewardGrant): RewardPolicyResult {
  const { reward, source } = grant;

  if (reward.kind === 'currency') {
    const allowed = SOURCE_CURRENCY_POLICY[source] ?? [];
    if (!allowed.includes(reward.currency)) {
      return {
        ok: false,
        error: 'currency-not-allowed-for-source',
        message:
          `${REWARD_SOURCE_LABELS[source] ?? source} 不得發放 ${reward.currency}` +
          `（允許：${allowed.join('、') || '無'}）— 見 constants/rewards.ts 的 SOURCE_CURRENCY_POLICY`,
      };
    }
  }

  const amount =
    reward.kind === 'item' || reward.kind === 'utility-card' ? reward.quantity : reward.amount;
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
    return { ok: false, error: 'invalid-amount', message: `獎勵數量不合法：${amount}` };
  }

  return { ok: true };
}

/** One line describing a grant, for `console` and the admin readout. Never shown to a player. */
export function describeGrant(grant: RewardGrant): string {
  const who = REWARD_SOURCE_LABELS[grant.source] ?? grant.source;
  const what =
    grant.reward.kind === 'currency'
      ? `${grant.reward.amount} ${grant.reward.currency}`
      : grant.reward.kind === 'xp'
        ? `${grant.reward.amount} XP`
        : grant.reward.kind === 'utility-card'
          ? `功能卡 ${grant.reward.cardId} ×${grant.reward.quantity}`
          : `${grant.reward.itemId} ×${grant.reward.quantity}`;
  return `[reward] ${who} → ${what}${grant.reason ? ` (${grant.reason})` : ''}`;
}
