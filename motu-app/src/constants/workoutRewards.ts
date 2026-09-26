/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 健身獎勵 — the reward CONFIGURATION and its rules. No React, no Firestore, no hard-coded item ids.
 *
 * This is the data-and-rules half of the feature; `context/useWorkoutRewards.ts` is the write half
 * and `components/UI/WorkoutRewardPopup.tsx` is the view half, and neither of those holds a game
 * rule of its own. Same split as constants/dailyLogin.ts ↔ DailyLoginPanel and
 * constants/islandReturn.ts ↔ useIslandLife: a designer changing what a reward is worth, which
 * shelves it may come from, or what counts as 「有效的健身」 should never have to open a component,
 * and a component should never be where a game rule is discovered.
 *
 * ## Everything here is a filter, never a list of items
 *
 * The pool is DERIVED from the catalog (constants/items.ts) by a declared eligibility spec — a
 * price ceiling, a set of shop categories, a rarity range — and never enumerated by id. That is
 * the difference between a reward pool and a hard-coded gift list: adding 「休閒帽 T」 to the shop
 * at 180 金幣 puts it in the newbie pool automatically, and re-pricing an existing hat at 2,000
 * takes it out, with no edit here. Nothing in this feature may ever say `if (itemId === ...)`.
 *
 * The pool SHAPE itself now lives in constants/rewardPools.ts, shared with every other reward
 * system in the game (§6) — see the re-export block below for why it moved.
 *
 * ## What a workout is worth is also here, and it did not used to be
 *
 * {@link WORKOUT_PAYOUT} / {@link payoutForWorkout} are the game's only source of 金幣. They were
 * three lines inside `FitnessView.finishWorkout` until 2026-08-25, which made a throwaway prototype
 * screen the authority on the economy. The screen now reports a completion and nothing else.
 *
 * ## Why the trigger is a table and not a boolean
 *
 * 「第一次健身」 is one row of {@link WORKOUT_REWARD_RULES}. 連續健身, 每週健身, 里程碑 and 活動獎勵
 * are more rows — each naming a pool, a claim key and how often it may pay — and the service that
 * grants them does not branch per trigger. That is the whole of §19: a second reward is a row here
 * plus the condition that fires it, not a second reward system.
 *
 * The API this file exposes is pinned by `scripts/test-workout-rewards.ts`
 * (`npm run test:workout-rewards`) — that file is the specification, this one is the implementation.
 */

import { getItemById, type ItemDefinition } from './items';
import { NEWBIE_REWARD_POOL, type RewardPool } from './rewardPools';

// --- What counts as a workout ------------------------------------------------

/**
 * Where a completion came from. The reward system never branches on it — it exists so a claim can
 * be audited back to its origin, and so 管理員測試 is distinguishable from a real session.
 *
 * `'external-api'` has no code behind it yet, on purpose: the point of the seam is that the day it
 * does, nothing in this file and nothing in the reward service changes.
 */
export type WorkoutSource = 'prototype' | 'external-api' | 'admin-test';

/**
 * One finished workout, in the only vocabulary the reward system understands.
 *
 * Deliberately NOT the shape of any particular fitness API, and deliberately not the shape of the
 * current prototype either. It carries what any workout has — who, when, what kind, how long, how
 * much of it — plus an id that identifies THIS completion. Whatever the real service eventually
 * returns (a Google Fit session, an Apple Health workout, a partner's JSON) is mapped onto this by
 * an adapter at the edge (see lib/workoutCompletion.ts); the fields below are what the game agreed
 * to know about, so adding one is a decision taken here rather than a vendor's shape leaking in.
 *
 * `repCount` is optional because most real workouts have no reps — a 30-minute run reports duration
 * and nothing else — and the validity rule below is written so either half can carry a completion
 * on its own.
 */
export interface WorkoutCompletion {
  /**
   * Stable per completion. The replay guard is built on it: the same id delivered twice is the same
   * workout, whether that is a double-tapped button, a retried request or a reloaded scene.
   */
  workoutId: string;
  userId: string;
  /** ISO 8601. The device's clock on the prototype path, the service's clock on the API path. */
  completedAt: string;
  /** Free-form kind — '開合跳', '深蹲', 'running'. Recorded, never branched on. */
  workoutType: string;
  durationSeconds: number;
  repCount?: number;
  source: WorkoutSource;
}

/**
 * What makes a completion count.
 *
 * A threshold table rather than a check buried in the service, because 「怎樣算完成一次健身」 is a
 * game-design question that the real fitness service will answer differently from a prototype with
 * a 結束 button — and when it does, this is the row that changes.
 *
 * The two thresholds are an OR, not an AND. A workout that reports only duration (a run) and one
 * that reports only repetitions (a quick set of squats) are both real, and requiring both would
 * reject whichever half a future API does not send.
 */
export interface WorkoutValidityRule {
  minDurationSeconds: number;
  minReps: number;
}

export const WORKOUT_VALIDITY: WorkoutValidityRule = {
  // Twenty seconds: short enough that nobody who actually exercised is turned away, long enough
  // that opening the screen and immediately closing it is not a workout.
  minDurationSeconds: 20,
  // Three, against the prototype's own on-screen goal of ten — the first reward is for having
  // started, not for having hit the target.
  minReps: 3,
};

/**
 * Whether this is a workout at all: a whole, identifiable event that shows some effort.
 *
 * Runs on every completion regardless of source, INCLUDING ones a trusted API sends. A server that
 * has verified a workout has verified that it happened, not that it arrived here intact — and a
 * completion with no id cannot be de-duplicated, which is the one failure that turns a
 * once-per-account reward into a repeatable one.
 */
export function isValidWorkout(
  completion: WorkoutCompletion | null | undefined,
  rule: WorkoutValidityRule = WORKOUT_VALIDITY,
): boolean {
  if (!completion) return false;
  if (!completion.workoutId || !completion.userId) return false;
  if (Number.isNaN(Date.parse(completion.completedAt))) return false;

  const duration = Number.isFinite(completion.durationSeconds) ? completion.durationSeconds : 0;
  const reps = Number.isFinite(completion.repCount ?? NaN) ? (completion.repCount as number) : 0;
  return duration >= rule.minDurationSeconds || reps >= rule.minReps;
}

// --- The pool ----------------------------------------------------------------

/**
 * 獎勵池 lives in constants/rewardPools.ts now, and these are re-exports rather than a second copy.
 *
 * It was moved out when 每日簽到, 輪盤 and 活動獎勵 became things that also draw from a pool: the
 * shape is not a fitness concept, and leaving it here would have meant every other reward system
 * importing 「workoutRewards」 to ask what a 稀有 item is. The names below are kept so nothing that
 * already imports them has to change — this file is still the front door for anything workout-shaped.
 *
 * `WorkoutRewardPool` is an alias of {@link RewardPool} for the same reason. New code should say
 * `RewardPool`.
 */
export type { RewardPool, RewardDraw } from './rewardPools';
export type { RewardPool as WorkoutRewardPool } from './rewardPools';
export {
  NEWBIE_PRICE_CEILING,
  NEWBIE_REWARD_POOL,
  buildRewardPool,
  drawReward,
  getRewardPool,
  isEligibleForPool,
  pickRewardFrom,
  poolRarityBreakdown,
  seedFrom,
} from './rewardPools';

/** Every pool a workout rule may name. One today; the wheel's and the event's live beside it. */
export const WORKOUT_REWARD_POOLS: readonly RewardPool[] = [NEWBIE_REWARD_POOL];

// --- What a workout PAYS -----------------------------------------------------

/**
 * 健身 → 金幣 / 經驗值 — the game's ONLY source of 金幣, expressed as a rule instead of as two
 * `increment()` calls inside a fitness screen.
 *
 * This table used to be four lines in `FitnessView.finishWorkout`:
 *
 *     const reward = Math.floor(reps * 0.8);
 *     const xp = Math.floor(reps * 5);
 *     await updateDoc(userRef, { balanceGold: increment(reward), currentXp: increment(xp) });
 *
 * which is §13 and §16 both broken in one place. It meant the prototype screen was the thing that
 * decided what a workout is worth, so replacing that screen with a real fitness API meant either
 * re-deriving the economy in an adapter or leaving a dead UI file in the tree to hold the numbers.
 * It also meant the wallet was written from a component, with no source recorded.
 *
 * The formula is now data, the write is now the reward service (context/useWorkoutRewards.ts), and
 * the prototype's whole contribution is one `reportWorkoutCompletion()` call. When the real service
 * arrives it reports the same completion shape and is paid by the same table.
 *
 * ## Why the payout reads BOTH reps and duration
 *
 * Because a real workout may report only one of them. The prototype counts repetitions; a 30-minute
 * run reports duration and no reps at all. Paying on reps alone would hand a runner nothing, and
 * paying on duration alone would pay for standing still. So each half earns on its own and the two
 * are added — {@link isValidWorkout} already guarantees at least one of them is real.
 */
export interface WorkoutPayoutRule {
  /** 金幣 per repetition. */
  coinsPerRep: number;
  /** 金幣 per minute of duration. */
  coinsPerMinute: number;
  /** 經驗值 per repetition. */
  xpPerRep: number;
  /** 經驗值 per minute of duration. */
  xpPerMinute: number;
  /**
   * The most one completion may pay, in 金幣.
   *
   * Not a balance dial — a guard. 金幣 is the only currency with real purchasing power and this is
   * the only thing that mints it, so a single completion reporting an implausible number (a bug in
   * a rep counter, a future API sending milliseconds where it meant seconds) must not be able to
   * hand over the whole catalog. The cap is well above any honest session.
   */
  maxCoinsPerWorkout: number;
  /** The same guard for 經驗值, which drives 等級. */
  maxXpPerWorkout: number;
}

/**
 * The numbers, kept where the old prototype's were so the change is a move and not a re-balance.
 *
 * `coinsPerRep: 0.8` and `xpPerRep: 5` are exactly what `FitnessView` used. The per-minute halves
 * are NEW and deliberately modest — they exist so a duration-only workout is not worth zero, not to
 * make time a better way to earn than effort. Twelve 金幣 a minute is about what fifteen reps pays,
 * which is roughly what a minute of jumping jacks actually is.
 */
export const WORKOUT_PAYOUT: WorkoutPayoutRule = {
  coinsPerRep: 0.8,
  coinsPerMinute: 12,
  xpPerRep: 5,
  xpPerMinute: 60,
  // ~4,000 金幣 is most of the shop's dearest item (鳳凰, 4,800). A single session reaching it
  // means something upstream is wrong, and the cap turns that from an economy-breaking payout into
  // a suspiciously round number in the logs.
  maxCoinsPerWorkout: 4000,
  maxXpPerWorkout: 5000,
};

/** What one completion is worth. Pure — the service writes it, this only decides it. */
export interface WorkoutPayout {
  coins: number;
  xp: number;
}

/**
 * The payout for one completion, from the rule table.
 *
 * Floored to whole numbers because both currencies are integers everywhere else (the wallet, the
 * HUD, `firestore.rules`), and rounding UP would let a one-rep workout pay for existing.
 */
export function payoutForWorkout(
  completion: WorkoutCompletion,
  rule: WorkoutPayoutRule = WORKOUT_PAYOUT,
): WorkoutPayout {
  const reps = Number.isFinite(completion.repCount ?? NaN) ? Math.max(0, completion.repCount as number) : 0;
  const seconds = Number.isFinite(completion.durationSeconds) ? Math.max(0, completion.durationSeconds) : 0;
  const minutes = seconds / 60;

  const coins = Math.floor(reps * rule.coinsPerRep + minutes * rule.coinsPerMinute);
  const xp = Math.floor(reps * rule.xpPerRep + minutes * rule.xpPerMinute);

  return {
    coins: Math.min(rule.maxCoinsPerWorkout, Math.max(0, coins)),
    xp: Math.min(rule.maxXpPerWorkout, Math.max(0, xp)),
  };
}

// --- Triggers ----------------------------------------------------------------

/**
 * Which reward this is. One id per rule, and the id is also the key the claim is filed under in the
 * save — so 「領過了嗎」 is a lookup rather than a per-feature boolean field.
 *
 * The union has one member today. The future members named in §19 (連續健身, 每週健身, 里程碑, 活動)
 * are deliberately NOT pre-declared: a trigger with no rule behind it is a promise the save format
 * has to keep, and each of them needs its own decision about what condition fires it.
 */
export type WorkoutRewardTriggerId = 'first_workout';

/** How often a rule may pay out. Today only one kind exists; the field is where the rest go. */
export type RewardCadence =
  /** Once per ACCOUNT, for the life of the save. 「首次健身獎勵」 is this. */
  'once-per-account';

export interface WorkoutRewardRule {
  id: WorkoutRewardTriggerId;
  /** The notification's headline. */
  title: string;
  /** The line under it. */
  message: string;
  poolId: string;
  cadence: RewardCadence;
}

/**
 * The rules table. One row per reward.
 *
 * A row is evaluated by context/useWorkoutRewards.ts, which does not know what any of these MEAN —
 * it reads the cadence, checks the claim key, draws from the named pool and writes. Adding 「連續
 * 健身七天」 is a row here, a pool above and a condition in {@link resolvePendingRewards}; it is not
 * a second grant path, a second popup or a second save field.
 */
export const WORKOUT_REWARD_RULES: Record<WorkoutRewardTriggerId, WorkoutRewardRule> = {
  first_workout: {
    id: 'first_workout',
    title: '第一次健身完成！',
    message: '恭喜你完成第一次健身！這是給你的新手小禮物！',
    poolId: NEWBIE_REWARD_POOL.id,
    cadence: 'once-per-account',
  },
};

// --- Saved state -------------------------------------------------------------

/** One granted reward, kept as the record that it happened. */
export interface WorkoutRewardClaim {
  /** Catalog id handed over. */
  itemId: string;
  /** ISO instant the grant was WRITTEN — not when the workout finished. */
  grantedAt: string;
  /** The completion that earned it, so a claim can be traced back to its event. */
  workoutId: string;
  source: WorkoutSource;
}

/**
 * 健身獎勵 state on the player's profile.
 *
 * One nested map rather than a spread of top-level fields, for the reason `islandState` is one (see
 * types.ts): every part of it is written in the same breath, and it is one key in firestore.rules
 * and one entry in every write whitelist. `firstWorkoutRewardClaimed` as a bare boolean was the
 * obvious shape and is the one that does not survive §19 — the second reward would need a second
 * field, a second rules clause and a second whitelist entry, i.e. a rules deploy per reward.
 *
 * Absent on every save written before this feature, which is correctly indistinguishable from a
 * player who has never trained: neither has claimed anything.
 */
export interface WorkoutRewardState {
  /** Granted rewards keyed by {@link WorkoutRewardTriggerId}. Presence IS 「已領取」, and terminal. */
  claims?: Partial<Record<WorkoutRewardTriggerId, WorkoutRewardClaim>>;
  /** Valid completions recorded on this account. The input a future 里程碑 rule would read. */
  completedCount?: number;
  lastCompletedAt?: string;
  /**
   * Completion ids already processed, oldest first, capped at {@link PROCESSED_ID_LIMIT}.
   *
   * The account-level half of the idempotency guard, and the half that survives a reload. The claim
   * key alone already makes a once-per-account reward unrepeatable; this is what stops a redelivered
   * event from inflating {@link completedCount} or, once a repeatable reward exists, paying twice
   * for one workout.
   */
  processedIds?: string[];
}

/** How many completion ids to remember. Small: this defends against retries, not against history. */
export const PROCESSED_ID_LIMIT = 12;

export function hasClaimed(
  state: WorkoutRewardState | null | undefined,
  triggerId: WorkoutRewardTriggerId,
): boolean {
  return !!state?.claims?.[triggerId];
}

export function hasProcessed(
  state: WorkoutRewardState | null | undefined,
  workoutId: string,
): boolean {
  return (state?.processedIds ?? []).includes(workoutId);
}

/** The id list with `workoutId` appended, oldest entries dropped. Pure; the caller persists it. */
export function appendProcessedId(
  state: WorkoutRewardState | null | undefined,
  workoutId: string,
): string[] {
  const ids = (state?.processedIds ?? []).filter((id) => id !== workoutId);
  ids.push(workoutId);
  return ids.slice(-PROCESSED_ID_LIMIT);
}

/**
 * Which rules are owed, in table order.
 *
 * The only place a trigger's CONDITION is evaluated, and the reason the service has no per-trigger
 * branches. `first_workout` is owed to anyone who has never claimed it — the completion being
 * processed IS the first one, so nothing needs to have been counted beforehand, which is also what
 * makes the reward work for a save written before the counter existed.
 *
 * A future 連續健身 row's condition goes here beside it, reading `completedCount`/`lastCompletedAt`
 * from the same state.
 */
export function resolvePendingRewards(
  state: WorkoutRewardState | null | undefined,
): WorkoutRewardRule[] {
  return Object.values(WORKOUT_REWARD_RULES).filter((rule) => {
    if (rule.cadence === 'once-per-account') return !hasClaimed(state, rule.id);
    return false;
  });
}

/** The item behind a claim, for the admin readout. Null once that item has been retired. */
export function getClaimedItem(claim: WorkoutRewardClaim | null | undefined): ItemDefinition | null {
  return claim ? getItemById(claim.itemId) ?? null : null;
}
