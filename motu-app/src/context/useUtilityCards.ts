/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db, doc, updateDoc, handleFirestoreError, OperationType } from '../lib/firebase';
import type { AuthUser } from '../auth/types';
import type { UserProfile } from '../types';
import {
  activeEffects,
  getOwnedCardCount,
  getUtilityCard,
  grantCards,
  useCard,
  type ActiveUtilityEffect,
  type CardUseError,
  type UtilityCardId,
  type UtilityCardState,
} from '../constants/utilityCards';
import { playSound, SoundEffect, triggerHaptic } from '../lib/soundUtils';

/**
 * 功能卡 Service — the one place a card enters the bag, leaves it, or starts running.
 *
 * Same shape as the Shop System (context/useShopActions.ts) and the 商品碎片 service
 * (context/useFragmentActions.ts), and here for the same reason: three different things hand out
 * cards (a 限時商店 purchase, a 輪盤 drop, 管理員測試) and every one of them has to apply the same
 * cap, write the same map and reflect the same local state. A second call site that writes
 * `utilityCards` itself is a second set of those rules, and the first one to drift wins silently.
 *
 * The RULES are pure functions in constants/utilityCards.ts; this file is only the write.
 *
 * ## Why the whole map is written
 *
 * `utilityCards` is a nested map whose keys are card ids (`double-coin`), and ids contain hyphens.
 * Firestore's dotted field paths cannot address those without backtick quoting, and the offline save
 * (save/LocalSaveStore.ts) splits dotted keys on `.` with no quoting at all — so
 * `utilityCards.owned.double-coin` would mean two different things in the two back-ends this app
 * runs on. Writing the map whole means one behaviour in both. It is a handful of numbers.
 *
 * ## Use is not optimistic
 *
 * A card leaves the bag only after the save accepts it, like every other grant in this codebase
 * (see the 「grant first, celebrate second」 note in context/useWorkoutRewards.ts). Showing a
 * consumed card and then rolling back is the one lie this UI must never tell — the player would
 * have no way to know whether their card is gone.
 */

/** What a grant did. `dropped` is what the per-card cap refused, not an error. */
export type CardGrantOutcome =
  | { ok: true; granted: number; dropped: number }
  | { ok: false; reason: 'no-profile' | 'unknown-card' | 'save-failed' };

/** What a use did. Every `reason` except the last two is an ordinary state the UI explains. */
export type CardUseOutcome =
  | { ok: true; effect: ActiveUtilityEffect }
  | { ok: false; reason: CardUseError | 'no-profile' | 'save-failed' };

/** Why a use was refused, in the player's words. The one place this copy is written. */
export const CARD_USE_MESSAGES: Record<CardUseError | 'no-profile' | 'save-failed', string> = {
  'unknown-card': '這張卡片已經不存在了',
  'none-owned': '你目前沒有這張卡片',
  'already-active': '效果正在進行中，等結束後再使用一張',
  'no-profile': '尚未登入，無法使用卡片',
  'save-failed': '存檔失敗，卡片沒有被使用',
};

export function useUtilityCards(
  user: AuthUser | null,
  profile: UserProfile | null,
  /** Writes an accepted value straight into local state — see AppContext's applyProfilePatch. */
  applyProfilePatch: (updates: Partial<UserProfile>) => void,
) {
  /**
   * Hands the player cards. The single grant path for every source.
   *
   * Takes a quantity because a drop table is allowed to pay more than one, and reports what the cap
   * refused rather than throwing it away silently — a 輪盤 that keeps paying a card the player
   * cannot hold is a balance problem somebody has to be able to see.
   */
  const grantUtilityCards = async (
    cardId: UtilityCardId,
    quantity = 1,
  ): Promise<CardGrantOutcome> => {
    if (!user || !profile) return { ok: false, reason: 'no-profile' };
    if (!getUtilityCard(cardId)) return { ok: false, reason: 'unknown-card' };

    const result = grantCards(profile.utilityCards, cardId, quantity);
    // Nothing to add — the bag is full — is a success with nothing written, so the caller can say
    // 「已達上限」 rather than reporting a failed save.
    if (result.granted === 0) return { ok: true, granted: 0, dropped: result.dropped };

    try {
      await updateDoc(doc(db, 'users', user.uid), { utilityCards: result.state });
    } catch (error) {
      console.error('[cards] 功能卡發放沒有存檔成功：', error);
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return { ok: false, reason: 'save-failed' };
    }

    applyProfilePatch({ utilityCards: result.state });
    return { ok: true, granted: result.granted, dropped: result.dropped };
  };

  /**
   * Uses one card: spends a copy and starts its effect.
   *
   * Everything about WHAT happens next is the card's own definition — this function does not know
   * that 雙倍金幣券 doubles anything. It writes the state that `useCard` computed, and the next
   * reward that is paid finds the effect through the 獎勵計算層 (constants/rewardEffects.ts).
   *
   * The activation id is minted here, once per attempt, so a retry of the same tap cannot become a
   * second activation.
   */
  const useUtilityCard = async (cardId: UtilityCardId): Promise<CardUseOutcome> => {
    if (!user || !profile) return { ok: false, reason: 'no-profile' };

    const result = useCard(profile.utilityCards, cardId, {
      nowMs: Date.now(),
      activationId: newActivationId(),
    });
    if (!result.ok) return { ok: false, reason: result.error };

    try {
      await updateDoc(doc(db, 'users', user.uid), { utilityCards: result.state });
    } catch (error) {
      console.error('[cards] 使用功能卡沒有存檔成功：', error);
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return { ok: false, reason: 'save-failed' };
    }

    applyProfilePatch({ utilityCards: result.state });
    playSound(SoundEffect.REWARD, 0.35);
    triggerHaptic('medium');
    return { ok: true, effect: result.effect };
  };

  /**
   * 管理員測試 — empties the bag and stops every effect.
   *
   * Written as an empty map rather than deleted, for the same reason `resetWorkoutRewards` is:
   * `deleteField()` is not part of the storage facade's exports (lib/firebase.ts), and an absent map
   * and an empty one read identically everywhere in this feature.
   */
  const resetUtilityCards = async (): Promise<boolean> => {
    if (!user || !profile) return false;
    const cleared: UtilityCardState = {};
    try {
      await updateDoc(doc(db, 'users', user.uid), { utilityCards: cleared });
    } catch (error) {
      console.error('[cards] 重置功能卡狀態失敗：', error);
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return false;
    }
    applyProfilePatch({ utilityCards: cleared });
    return true;
  };

  return { grantUtilityCards, useUtilityCard, resetUtilityCards };
}

/**
 * A fresh activation id.
 *
 * `crypto.randomUUID` where it exists, with the same fallback shape as `newWorkoutId`
 * (lib/workoutCompletion.ts) — this runs in the same browsers.
 */
function newActivationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `act-${crypto.randomUUID()}`;
  return `act-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * What the player has running, as a screen wants to read it: the effect, its card, and whether it
 * is a countdown or a use counter.
 *
 * A read helper rather than another piece of state — the profile is the only copy, and a component
 * that cached this would be a second one that goes stale the moment an effect expires.
 */
export interface LiveEffectView {
  effect: ActiveUtilityEffect;
  name: string;
  summary: string;
  expiresAt?: string;
  usesLeft?: number;
}

export function readLiveEffects(
  profile: UserProfile | null | undefined,
  nowMs: number,
): LiveEffectView[] {
  return activeEffects(profile?.utilityCards, nowMs).flatMap((effect) => {
    const card = getUtilityCard(effect.cardId);
    if (!card) return [];
    return [
      {
        effect,
        name: card.name,
        summary: card.effectSummary,
        ...(effect.expiresAt ? { expiresAt: effect.expiresAt } : {}),
        ...(typeof effect.usesLeft === 'number' ? { usesLeft: effect.usesLeft } : {}),
      },
    ];
  });
}

/** How many of one card the profile holds. The read every 使用 button asks. */
export function readOwnedCardCount(
  profile: UserProfile | null | undefined,
  cardId: UtilityCardId,
): number {
  return getOwnedCardCount(profile?.utilityCards, cardId);
}
