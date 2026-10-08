/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef } from 'react';
import { db, doc, setDoc, updateDoc, arrayUnion, handleFirestoreError, OperationType } from '../lib/firebase';
import type { AuthUser } from '../auth/types';
import type { UserProfile } from '../types';
import {
  appendProcessedId,
  drawReward,
  getRewardPool,
  hasProcessed,
  isValidWorkout,
  payoutForWorkout,
  resolvePendingRewards,
  seedFrom,
  type WorkoutCompletion,
  type WorkoutRewardClaim,
  type WorkoutRewardRule,
  type WorkoutRewardState,
  workoutLogDetectorFields,
} from '../constants/workoutRewards';
import { currencyPatch, getBalance } from '../constants/currency';
import { buildCurrencyUpdate } from './useEconomyActions';
import {
  makeWorkoutCompletion,
  reportWorkoutCompletion,
  subscribeWorkoutCompletion,
} from '../lib/workoutCompletion';

/**
 * 健身獎勵 Reward Service — the ONLY thing in the game that turns a finished workout into an item.
 *
 * It listens on the completion bus (lib/workoutCompletion.ts) and never on a button, a view or a
 * fitness screen's state, which is the whole point: the prototype and a future fitness API are two
 * sources of the same event, and this file cannot tell them apart. Every rule it applies comes from
 * constants/workoutRewards.ts; every write goes through the same `updateDoc` path as the rest of
 * the game's saves.
 *
 * ## Grant first, celebrate second (§12/§16)
 *
 * The notification is published only AFTER the write resolves. There is deliberately no optimistic
 * path here — the rest of this codebase updates optimistically and rolls back (see AppContext's
 * `updateProfile`), and that is right for something the player can already see, like moving a sofa.
 * It is wrong for a grant: an item shown and then rolled back is the strongest lie the UI can tell,
 * and 「顯示拿到了但背包沒有」 is the exact failure §16 names. So a refused write leaves the claim
 * unmarked, leaves the inventory alone and shows nothing, and the next workout tries again.
 *
 * The inventory entry and the claim record go in ONE `updateDoc`, so they land together or not at
 * all. Splitting them would create the state the brief forbids in the other direction — 「已標記領
 * 取，但玩家沒拿到」 — with no way to repair it.
 *
 * ## Idempotency (§13)
 *
 * Four layers, because the failure modes are genuinely different:
 *
 *  1. `inFlight` (a ref) — the same id arriving twice in one tick, or a double-tapped button.
 *     Covers the window between deciding to grant and the write returning, which no saved state can.
 *  2. A serialised queue — DIFFERENT ids arriving together. A fitness API delivering a backlog of
 *     three sessions at once would otherwise have all three read the same 「還沒領過」 state and all
 *     three grant the once-per-account reward. Completions are therefore processed one at a time.
 *  3. `processedIds` (saved) — the same completion redelivered after a reload, a scene change, an
 *     API retry, or the bus replaying its last event to a subscriber that mounted late.
 *  4. The claim key itself (saved) — the terminal guard. A once-per-account reward whose claim
 *     exists is never granted again, whatever the id says.
 *
 * On top of those, the item is drawn from a seed derived from the completion id, so even a replay
 * that somehow got past all four would pick the same item rather than a second different one.
 *
 * ## It pays 金幣 too, and that is new (2026-08-25)
 *
 * The coin/XP payout used to live in `FitnessView.finishWorkout` as a bare
 * `updateDoc({ balanceGold: increment(reps * 0.8), currentXp: increment(reps * 5) })`, next to the
 * `reportWorkoutCompletion()` call that this service listens for. Two things were wrong with that,
 * and they are §13 and §16 of the brief:
 *
 *  - **The prototype screen decided what a workout is worth.** Replacing it with a real fitness API
 *    would have meant re-deriving the economy inside an adapter, or keeping a dead UI file around
 *    to hold the numbers. The formula is data now ({@link WORKOUT_PAYOUT}) and the payout is
 *    computed here, from the completion — so an API-sourced workout is paid by the same table as a
 *    prototype one, and the screen's whole contribution is one bus call.
 *  - **The wallet was written from a component, with no source recorded.** Every grant now states
 *    that it came from 健身, and the source→currency policy (constants/rewards.ts) is what makes
 *    「金幣只能來自健身」 enforceable rather than merely documented.
 *
 * The payout rides in the SAME `updateDoc` as `processedIds`, which is what makes it idempotent:
 * the replay guard and the money move together, so a redelivered completion cannot pay twice. That
 * is the one property the old placement could never have — a component that pays before publishing
 * has no idea whether the event it published was a duplicate.
 *
 * ## 雙倍金幣券 is applied somewhere else, and this file cannot name it (2026-08-29)
 *
 * The payout is built by `buildCurrencyUpdate` (context/useEconomyActions.ts), which runs it
 * through the 獎勵計算層 (constants/rewardEffects.ts) before it becomes an `increment()`. So a
 * 功能卡 that doubles 金幣 doubles THIS payout without a single line here knowing that cards exist
 * — which is the property §16 of the 功能卡 brief actually asks for: when the prototype fitness
 * screen is replaced by a real API, the card keeps working, because the multiplier never lived in
 * the fitness path to begin with.
 *
 * `payoutForWorkout` remains the BASE. Nothing multiplies it here, and the workout log records what
 * was banked rather than what the table said, so the two numbers stay tellable apart.
 */

/**
 * The workout_logs entry. Written here rather than in the fitness screen for the same reason the
 * payout is: `goldEarned` has to agree with what was actually paid, and the only way to guarantee
 * that is for one place to decide both. Shape pinned by `isValidWorkoutLog` in firestore.rules.
 */
interface WorkoutLogEntry {
  logId: string;
  userId: string;
  type: string;
  duration: number;
  counts: number;
  calories: number;
  goldEarned: number;
  timestamp: string;
  /** 誰判定的這次運動（例如 'ai-camera'）。沒帶來源的紀錄不寫這個欄位，和改前相同。 */
  detector?: string;
}

/**
 * 卡路里, derived rather than reported.
 *
 * The prototype counted 0.8 kcal per rep as the player exercised and passed the running total into
 * the log. A real fitness API will report its own figure and a run reports no reps at all, so the
 * log cannot depend on a number only the prototype knows how to produce. Same coefficient, computed
 * from the completion — the log says the same thing it always did for a prototype session, and it
 * says something reasonable for one that arrives over an API.
 */
const KCAL_PER_REP = 0.8;
const KCAL_PER_MINUTE = 8;

/** What the UI is handed once a grant has actually landed. Resolved, not a pointer at the profile. */
export interface WorkoutRewardNotice {
  /** Which rule paid out — the header copy comes from its row in WORKOUT_REWARD_RULES. */
  rule: WorkoutRewardRule;
  /** The catalog id granted. The popup resolves the name/icon from it. */
  itemId: string;
  /** The completion that earned it. Carried for the admin readout and for debugging. */
  workoutId: string;
}

/** What one attempt did. `already-processed`/`nothing-owed` are ordinary outcomes, not failures. */
export type WorkoutGrantOutcome =
  | { ok: true; granted: WorkoutRewardNotice[] }
  | {
      ok: false;
      reason: 'no-profile' | 'invalid-workout' | 'already-processed' | 'nothing-owed' | 'empty-pool' | 'save-failed';
    };

export function useWorkoutRewards(
  user: AuthUser | null,
  profile: UserProfile | null,
  /** Writes a value the database has ALREADY accepted into local state — see AppContext. */
  applyProfilePatch: (updates: Partial<UserProfile>) => void,
  /** Hands a granted reward to whoever is showing it (AppContext holds it as state). */
  publishReward: (notice: WorkoutRewardNotice) => void,
) {
  /**
   * The live profile, for the subscriber.
   *
   * The bus callback is registered once and must not be torn down and rebuilt on every profile
   * change — a completion arriving during that gap would be delivered to nobody. So the handler
   * reads through refs instead of closing over state, the same way useIslandEditor reads its
   * writers through a ref.
   */
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const uidRef = useRef(user?.uid ?? null);
  uidRef.current = user?.uid ?? null;
  const publishRef = useRef(publishReward);
  publishRef.current = publishReward;
  const patchRef = useRef(applyProfilePatch);
  patchRef.current = applyProfilePatch;

  /** Completion ids being processed right now — layer 1 of the idempotency guard. */
  const inFlight = useRef(new Set<string>());

  /**
   * The reward state as most recently WRITTEN, which can be newer than the profile.
   *
   * `applyProfilePatch` schedules React state; it does not update `profileRef` synchronously. Two
   * completions processed back to back within one tick would therefore both read the pre-write
   * state, and the claim guard would pass twice. Tagged with the uid it belongs to so an account
   * switch cannot inherit the previous player's claims. Nothing else in the app writes
   * `workoutRewards`, so this ref can only ever be ahead of the snapshot, never behind it.
   */
  const writtenState = useRef<{ uid: string; state: WorkoutRewardState } | null>(null);

  const readState = (uid: string): WorkoutRewardState => {
    const cached = writtenState.current;
    if (cached && cached.uid === uid) return cached.state;
    return profileRef.current?.workoutRewards ?? {};
  };

  /**
   * Processes one completion: validate → de-duplicate → resolve what is owed → draw → write →
   * announce. The order is §11's, and it is the only order that cannot pay for a workout twice or
   * announce a reward that was not saved.
   */
  const processCompletion = useCallback(async (completion: WorkoutCompletion): Promise<WorkoutGrantOutcome> => {
    const uid = uidRef.current;
    const current = profileRef.current;
    if (!uid || !current) return { ok: false, reason: 'no-profile' };

    // §11「確認是否為有效完成」. Applied to every source, including a trusted one — see isValidWorkout.
    if (!isValidWorkout(completion)) return { ok: false, reason: 'invalid-workout' };
    // A completion belonging to another account is not this player's to be paid for. Reachable if
    // an API response outlives an account switch.
    if (completion.userId !== uid) return { ok: false, reason: 'invalid-workout' };

    const state = readState(uid);
    if (inFlight.current.has(completion.workoutId)) return { ok: false, reason: 'already-processed' };
    if (hasProcessed(state, completion.workoutId)) return { ok: false, reason: 'already-processed' };

    inFlight.current.add(completion.workoutId);
    try {
      // The bookkeeping every valid completion produces, whether or not it pays out. Written even
      // when nothing is owed, because `completedCount` is what a future 連續/里程碑 rule reads, and
      // a counter that only advances on the workouts that happened to pay is not a counter.
      const next: WorkoutRewardState = {
        ...state,
        completedCount: (state.completedCount ?? 0) + 1,
        lastCompletedAt: completion.completedAt,
        processedIds: appendProcessedId(state, completion.workoutId),
      };

      // 健身 → 金幣 / 經驗值. The formula is constants/workoutRewards.ts; this only asks it.
      //
      // Built through the economy service's `buildCurrencyUpdate` rather than as a bare
      // `increment()`, which is what puts this payout through the same two gates as every other
      // grant in the game: the source→currency policy (constants/rewards.ts) and the 獎勵計算層
      // (constants/rewardEffects.ts). 雙倍金幣券 is applied THERE, once, for every source — so this
      // file has no idea the card exists, which is the whole point of §16: when the prototype
      // fitness screen is replaced by a real API, the card keeps working because nothing about it
      // was ever written here.
      //
      // `payoutForWorkout` stays the BASE reward and is never rewritten. What a workout is worth
      // and what a player is paid for it are two different numbers, and the first one has to remain
      // readable — see the log entry below, which records what was actually banked.
      const payout = payoutForWorkout(completion);
      const nowMs = Date.now();
      // Chained deliberately: the coin settlement may consume a `uses`-based card, and the XP
      // settlement has to see that. Settling both against the same snapshot would spend one use
      // twice and write only one of the two results.
      let cards = current.utilityCards ?? null;

      const coinBuild = buildCurrencyUpdate(
        {
          reward: { kind: 'currency', currency: 'coins', amount: Math.max(1, payout.coins) },
          source: 'workout',
          reason: `${completion.workoutType} (${completion.workoutId})`,
        },
        { cards, nowMs },
      );
      // Null only if the policy table itself changed. The workout is still recorded — refusing the
      // bookkeeping too would lose the completion entirely — and buildCurrencyUpdate has already
      // said why on the console.
      if (coinBuild?.settled.cardsAfter) cards = coinBuild.settled.cardsAfter;
      const coins = coinBuild?.amount ?? 0;

      const xpBuild =
        payout.xp > 0
          ? buildCurrencyUpdate(
              {
                reward: { kind: 'xp', amount: payout.xp },
                source: 'workout',
                reason: `${completion.workoutType} (${completion.workoutId})`,
              },
              { cards, nowMs },
            )
          : null;
      if (xpBuild?.settled.cardsAfter) cards = xpBuild.settled.cardsAfter;
      const xp = xpBuild?.amount ?? 0;

      const owed = resolvePendingRewards(state);
      const claims: Record<string, WorkoutRewardClaim> = { ...(state.claims ?? {}) };
      const granted: WorkoutRewardNotice[] = [];
      const grantedItemIds: string[] = [];
      const grantedAt = new Date().toISOString();

      for (const rule of owed) {
        const pool = getRewardPool(rule.poolId);
        if (!pool) {
          // A rule naming a pool that does not exist is a configuration mistake, not a player
          // problem: skip it, leave it unclaimed, and say so where a developer will see it.
          console.error(`[workout] 獎勵規則 ${rule.id} 指向不存在的獎勵池 ${rule.poolId}`);
          continue;
        }
        // Seeded per rule as well as per completion, so two rules firing on one workout cannot draw
        // the same index out of two different pools by construction.
        const draw = drawReward(pool, current.inventory ?? [], seedFrom(`${completion.workoutId}:${rule.id}`));
        if (!draw.ok) {
          console.error(`[workout] 獎勵池 ${pool.id} 沒有任何符合條件的物品，${rule.id} 不發放`);
          continue;
        }
        claims[rule.id] = {
          itemId: draw.item.id,
          grantedAt,
          workoutId: completion.workoutId,
          source: completion.source,
        };
        grantedItemIds.push(draw.item.id);
        granted.push({ rule, itemId: draw.item.id, workoutId: completion.workoutId });
      }

      if (granted.length > 0) next.claims = claims as WorkoutRewardState['claims'];

      /**
       * The inventory grant, as `arrayUnion` rather than a rewritten array.
       *
       * Everything this pool can contain is own-once (utils/inventory.ts), so the union is exactly
       * the right semantics — and it is also the only version that cannot lose a purchase made in
       * the seconds between this profile snapshot and this write. Writing `[...inventory, item]`
       * from a possibly-stale array would silently drop whatever landed in between.
       *
       * Still ONE `updateDoc` with the claim beside it, which is what makes the item and the record
       * that it was given atomic. See the file doc.
       */
      const fields: Record<string, unknown> = {
        workoutRewards: next,
        ...(grantedItemIds.length > 0 ? { inventory: arrayUnion(...grantedItemIds) } : {}),
        // In the same write as `processedIds`, so the replay guard and the money commit together.
        // A payout in its own `updateDoc` could land while the guard's did not, and the next
        // delivery of the same completion would pay again.
        //
        // Both field maps come from the economy service, so they already carry the settled amounts
        // and — for a `uses`-based card — the card state that spending a use produced. The XP map is
        // spread last because it was settled against the coin settlement's output, so its copy of
        // `utilityCards` is the final one.
        ...(coins > 0 ? coinBuild?.fields ?? {} : {}),
        ...(xp > 0 ? xpBuild?.fields ?? {} : {}),
      };

      try {
        await updateDoc(doc(db, 'users', uid), fields);
      } catch (error) {
        // Nothing marked, nothing announced, nothing in the bag: the next workout starts from
        // exactly the state this one did. See the file doc.
        console.error('[workout] 健身獎勵沒有存檔成功：', error);
        handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
        return { ok: false, reason: 'save-failed' };
      }

      // The training record. AFTER the payout write and in its own `setDoc`, deliberately: it is a
      // receipt, not a grant, and a refused log (its shape is validated by firestore.rules'
      // `isValidWorkoutLog`) must never be able to roll back money the player has earned. It is
      // also why `goldEarned` can be trusted — it is the figure that was actually banked, written
      // by the thing that banked it.
      const minutes = Math.max(0, completion.durationSeconds) / 60;
      const reps = Number.isFinite(completion.repCount ?? NaN) ? Math.max(0, completion.repCount as number) : 0;
      const logId = `log-${Date.parse(completion.completedAt) || Date.now()}-${completion.workoutId.slice(-6)}`;
      const log: WorkoutLogEntry = {
        logId,
        userId: uid,
        type: completion.workoutType,
        duration: Math.round(completion.durationSeconds),
        counts: reps,
        calories: Math.round(reps * KCAL_PER_REP + minutes * KCAL_PER_MINUTE),
        goldEarned: coins,
        timestamp: completion.completedAt,
        ...workoutLogDetectorFields(completion),
      };
      try {
        await setDoc(doc(db, 'users', uid, 'workout_logs', logId), log);
      } catch (error) {
        console.error('[workout] 健身紀錄沒有寫入成功（獎勵不受影響）：', error);
      }

      // Saved. Only now does any of it become visible — and only now does the local copy of the
      // state move forward, so a completion processed before React re-renders sees this one.
      writtenState.current = { uid, state: next };
      const live = profileRef.current ?? current;
      const inventory = live.inventory ?? current.inventory ?? [];
      const additions = grantedItemIds.filter((id) => !inventory.includes(id));
      patchRef.current({
        workoutRewards: next,
        ...(additions.length > 0 ? { inventory: [...inventory, ...additions] } : {}),
        ...(coins > 0 ? currencyPatch(live, 'coins', getBalance(live, 'coins') + coins) : {}),
        ...(xp > 0 ? { currentXp: (live.currentXp ?? 0) + xp } : {}),
        // Only when a card was actually spent — `cards` is the chained result and is the same
        // object the write above sent.
        ...(cards && cards !== (current.utilityCards ?? null) ? { utilityCards: cards } : {}),
      });
      for (const notice of granted) publishRef.current(notice);

      if (granted.length === 0) {
        // The coins were still paid — 「沒有欠任何獎勵」 is about the ITEM rules, not about whether
        // the workout counted. Every valid workout earns.
        return owed.length === 0 ? { ok: false, reason: 'nothing-owed' } : { ok: false, reason: 'empty-pool' };
      }
      return { ok: true, granted };
    } finally {
      inFlight.current.delete(completion.workoutId);
    }
  }, []);

  /**
   * One completion at a time — layer 2 of the idempotency guard.
   *
   * A promise chain rather than parallel handling, because 「欠不欠這個獎勵」 is read from state the
   * previous completion may be about to change. Sequential processing is free here (a workout is
   * not a hot path) and it is what makes a backlog of events from an API adapter behave like the
   * same events arriving one by one.
   */
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  /**
   * The one subscription, for the whole session.
   *
   * Registered from the provider rather than from a screen, which is what makes §12 hold: the
   * fitness view can unmount, the player can walk back to the island, the scene can change — the
   * grant is already under way here and finishes regardless. The empty dependency list is
   * deliberate; everything mutable is read through a ref above.
   */
  useEffect(() => {
    return subscribeWorkoutCompletion((completion) => {
      queue.current = queue.current
        .then(() => processCompletion(completion))
        // A rejection would poison the chain and silently drop every later completion. Failures are
        // already reported inside processCompletion; this only keeps the queue alive.
        .catch((error) => {
          console.error('[workout] 處理健身完成事件時發生未預期的錯誤：', error);
        });
    });
  }, [processCompletion]);

  /**
   * 管理員測試 — publishes a real completion through the real bus.
   *
   * It fabricates the EVENT, never the outcome: what happens next is the same subscription, the
   * same validity check, the same pool, the same draw and the same write a player's workout gets.
   * A shortcut that granted an item directly would be a second implementation, and it would keep
   * passing while the real path was broken — the same reasoning as the offline-return simulator
   * (see AdminIslandControls).
   */
  const simulateWorkoutCompletion = useCallback((): boolean => {
    const uid = uidRef.current;
    if (!uid) return false;
    reportWorkoutCompletion(
      makeWorkoutCompletion({
        userId: uid,
        workoutType: '管理員測試',
        durationSeconds: 120,
        repCount: 20,
        source: 'admin-test',
      }),
    );
    return true;
  }, []);

  /**
   * 管理員測試 — puts the account back to 「還沒領過首次健身獎勵」.
   *
   * Clears the claims, the counter and the replay list. It deliberately does NOT take the granted
   * item back: removing something from a player's inventory is destructive, and reversing a gift is
   * not what 「重置獎勵狀態」 means. Testing again therefore draws from the pool minus what is
   * already owned (`preferUnowned`), which is the more useful behaviour anyway — each reset shows a
   * different item until the pool runs out.
   */
  const resetWorkoutRewards = useCallback(async (): Promise<boolean> => {
    const uid = uidRef.current;
    const current = profileRef.current;
    if (!uid || !current) return false;

    // Written as an empty map rather than deleted: `deleteField()` is not part of the storage
    // facade's exports (lib/firebase.ts), and an absent map and an empty one read identically
    // everywhere in this feature.
    const cleared: WorkoutRewardState = {};
    try {
      await updateDoc(doc(db, 'users', uid), { workoutRewards: cleared });
    } catch (error) {
      console.error('[workout] 重置健身獎勵狀態失敗：', error);
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
      return false;
    }
    inFlight.current.clear();
    writtenState.current = { uid, state: cleared };
    patchRef.current({ workoutRewards: cleared });
    return true;
  }, []);

  return { simulateWorkoutCompletion, resetWorkoutRewards };
}
