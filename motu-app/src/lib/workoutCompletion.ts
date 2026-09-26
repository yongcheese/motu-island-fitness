/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 健身完成事件 — the seam between "somebody exercised" and "the game reacts to it".
 *
 * This module is the whole of §7/§8/§10. It knows nothing about rewards, inventories, items,
 * currencies, saves or screens, and it must stay that way: its only exports are a shape
 * ({@link WorkoutCompletion}, declared in constants/workoutRewards.ts), a way to announce one, and
 * a way to listen for one.
 *
 * ## The two sides, and why neither knows the other exists
 *
 *   目前 Prototype:      components/FitnessView.tsx → reportWorkoutCompletion() ─┐
 *                                                                                ├→ Reward Service
 *   未來 Fitness API:    (an adapter, see below)    → reportWorkoutCompletion() ─┘   (context/
 *                                                                                    useWorkoutRewards.ts)
 *
 * The prototype's contribution is ONE call at the moment its 結束 handler finishes — no reward
 * logic, no item ids, no inventory write, no popup. Replacing it with a real fitness service means
 * deleting that call and adding an adapter that makes the same one; the reward system is not
 * touched, and neither is this file.
 *
 * That is also why this is a bus rather than a direct function call into the reward hook. A direct
 * call would make FitnessView import the reward service, which is exactly the coupling the brief
 * forbids — and it would tie the grant to a component that unmounts the moment the player walks
 * back out to the island.
 *
 * ## Adapters (§9)
 *
 * When the external service arrives, its integration layer lives beside this file and does three
 * things: authenticate, translate the vendor's payload into a {@link WorkoutCompletion}, and call
 * {@link reportWorkoutCompletion}. Nothing else in the game learns the vendor's field names, so a
 * change to their response is a change to one adapter. {@link makeWorkoutCompletion} is the
 * translation helper: it fills in the id, the timestamp and the source so an adapter cannot forget
 * them, and it is the only place a workout id is minted.
 *
 * ## Delivery guarantees
 *
 * Fan-out to every subscriber, synchronously, and a listener that throws cannot stop the others —
 * a broken UI subscriber must never be able to prevent a grant. The last event is REPLAYED to a
 * subscriber that arrives late, for the same reason `subscribeLoginBonus` replays: the completion
 * can be published in the same tick the profile loads, and a listener mounted one tick later would
 * otherwise miss the only announcement it will ever get. Replay is safe precisely because the
 * consumer is idempotent on `workoutId` (see constants/workoutRewards.ts) — the bus is allowed to
 * deliver twice because being delivered twice is already survivable.
 */

import type { WorkoutCompletion, WorkoutSource } from '../constants/workoutRewards';

export type { WorkoutCompletion, WorkoutSource };

/** What an adapter provides. Everything the caller cannot be expected to invent is filled in below. */
export interface WorkoutCompletionInput {
  userId: string;
  workoutType: string;
  durationSeconds: number;
  repCount?: number;
  source: WorkoutSource;
  /** The service's own id, when there is one. Generated only when there is not — see below. */
  workoutId?: string;
  /** The service's own timestamp, when there is one. Defaults to now. */
  completedAt?: string;
}

/**
 * A fresh id for a completion that does not already have one.
 *
 * The prototype has no server and therefore no authoritative id, so one is minted here. An adapter
 * for a real service must pass that service's id through instead: the id is what makes a redelivery
 * recognisable as a redelivery, and an id invented on the client is fresh on every retry, which
 * would defeat the guard it exists to feed.
 */
function newWorkoutId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `wk-${crypto.randomUUID()}`;
  return `wk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Builds a completion, filling in what the caller did not supply. */
export function makeWorkoutCompletion(input: WorkoutCompletionInput): WorkoutCompletion {
  return {
    workoutId: input.workoutId || newWorkoutId(),
    userId: input.userId,
    completedAt: input.completedAt ?? new Date().toISOString(),
    workoutType: input.workoutType,
    durationSeconds: Math.max(0, Math.round(input.durationSeconds)),
    ...(input.repCount === undefined ? {} : { repCount: Math.max(0, Math.round(input.repCount)) }),
    source: input.source,
  };
}

type Listener = (completion: WorkoutCompletion) => void;

const listeners = new Set<Listener>();

/**
 * The most recent announcement, kept for late subscribers.
 *
 * Never cleared on consumption. Clearing it would make "has this been handled" a property of the
 * bus, and it is not — it is a property of the SAVE (`processedIds`), which is the only copy that
 * survives a reload. A bus that tried to remember would be a second, weaker answer to the same
 * question, and the two would eventually disagree.
 */
let lastCompletion: WorkoutCompletion | null = null;

/**
 * Announces that a workout finished. The one entry point, for every source.
 *
 * Deliberately returns nothing. A publisher does not get to know whether a reward was granted,
 * because the moment it does, somebody writes `if (!granted) …` in a fitness screen and the reward
 * rules are back inside the UI.
 */
export function reportWorkoutCompletion(completion: WorkoutCompletion): void {
  lastCompletion = completion;
  for (const listener of [...listeners]) {
    try {
      listener(completion);
    } catch (error) {
      // One broken listener must not stop the next one — the reward service is a listener.
      console.error('[workout] 完成事件的訂閱者發生錯誤：', error);
    }
  }
}

/**
 * Subscribes to completions. Fires immediately with the last one, if there was one this session.
 *
 * See the module doc for why a replay is safe: the consumer de-duplicates on `workoutId`.
 */
export function subscribeWorkoutCompletion(listener: Listener): () => void {
  listeners.add(listener);
  if (lastCompletion) {
    try {
      listener(lastCompletion);
    } catch (error) {
      console.error('[workout] 完成事件的訂閱者發生錯誤：', error);
    }
  }
  return () => {
    listeners.delete(listener);
  };
}

/** The last completion announced this session, or null. For 管理員測試 readouts. */
export function getLastWorkoutCompletion(): WorkoutCompletion | null {
  return lastCompletion;
}

/** Test-only: forgets the replay buffer so one script's events cannot leak into the next. */
export function resetWorkoutCompletionBus(): void {
  lastCompletion = null;
  listeners.clear();
}
