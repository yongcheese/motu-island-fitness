/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { UserProfile } from '../types';
import { ownsItem } from '../utils/inventory';
import { drawWheelSlot, resolveWheelPrize, type ResolvedWheelPrize, type WheelSlot } from '../constants/wheelRewards';
import type { FragmentGrant } from '../constants/fragments';
import type { RewardGrant } from '../constants/rewards';
import type { UtilityCardId } from '../constants/utilityCards';
import type { CardGrantOutcome } from './useUtilityCards';
import type { FragmentGrantReport } from './useFragmentActions';
import type { RewardGrantOutcome } from './useEconomyActions';

/**
 * 輪盤 — the grant half of a spin.
 *
 * The table and the odds are constants/wheelRewards.ts; this file turns a drawn wedge into an
 * actual grant, and it does so by calling the services that ALREADY own each kind of prize:
 *
 *   碎片      → the economy service (`grantReward`, source `wheel`)
 *   商品碎片  → the fragment service (`grantFragments`)
 *   功能卡    → the card service (`grantUtilityCards`)
 *
 * So the wheel has no write of its own, no cap of its own and no policy of its own — a 輪盤 prize
 * is paid by exactly the same code that pays the same prize anywhere else. That is also what makes
 * 「輪盤不得發金幣」 true without a line here saying so: SOURCE_CURRENCY_POLICY refuses it
 * (constants/rewards.ts).
 *
 * ## This is NOT the 幸運轉盤 on screen
 *
 * There are two wheels in the tree and they are not the same thing:
 *
 *   context/useWheelActions.ts — the 幸運轉盤 the player spins (UI/LuckyWheel.tsx). Charges a 抽獎券
 *                                and pays its prize in ONE write; table in constants/luckyWheel.ts.
 *   this file                  — the probability layer that can pay 功能卡; table in
 *                                constants/wheelRewards.ts, no screen of its own.
 *
 * They arrived from two branches at once and were kept apart rather than force-fitted together,
 * because folding this table into the on-screen wheel is a decision about the wheel's face and its
 * economy — not a merge conflict to resolve. Until somebody makes that call, this half is exercised
 * by the 管理員測試 button (UI/UtilityCard.tsx), which runs the REAL draw and the REAL grants rather
 * than a simulation — the same reasoning as `simulateWorkoutCompletion` (context/useWorkoutRewards.ts):
 * a shortcut that granted a card directly would keep passing while the real path was broken.
 *
 * ## What a spin COSTS is not decided here
 *
 * Charging a 抽獎券 would be this file quietly designing an economy the 幸運轉盤 next door already
 * owns, so the cost stays the caller's decision — a wheel charges in the same write it calls this
 * from, and the table above stays about prizes.
 */

/** What one spin produced. `slot` is what the wedge says; `prize` is what was actually handed over. */
export type WheelRewardOutcome =
  | { ok: true; spinId: string; slot: WheelSlot; prize: ResolvedWheelPrize }
  | { ok: false; reason: 'no-profile' | 'empty-table' | 'unavailable-prize' | 'grant-failed'; slot?: WheelSlot };

export interface WheelDeps {
  grantReward: (grant: RewardGrant) => Promise<RewardGrantOutcome>;
  grantFragments: (grants: FragmentGrant[]) => Promise<FragmentGrantReport>;
  grantUtilityCards: (cardId: UtilityCardId, quantity?: number) => Promise<CardGrantOutcome>;
}

export function useWheelRewards(profile: UserProfile | null, deps: WheelDeps) {
  /**
   * Spins once and pays out.
   *
   * `spinId` is the EVENT and is what the draw is seeded on — pass the id the wheel screen (or the
   * server) uses for this spin, and the same id always lands on the same wedge. A caller that has
   * no id gets a fresh one, which is right for a one-off admin press and wrong for anything that
   * might retry: a re-rolled id is a re-rolled prize.
   */
  const spinWheel = async (spinId: string = newSpinId()): Promise<WheelRewardOutcome> => {
    if (!profile) return { ok: false, reason: 'no-profile' };

    const slot = drawWheelSlot(spinId);
    if (!slot) return { ok: false, reason: 'empty-table' };

    const prize = resolveWheelPrize(slot, profile, (itemId) => ownsItem(profile, itemId), spinId);
    if (!prize) return { ok: false, reason: 'unavailable-prize', slot };

    if (prize.kind === 'currency') {
      const paid = await deps.grantReward({
        reward: { kind: 'currency', currency: prize.currency, amount: prize.amount },
        source: 'wheel',
        reason: `輪盤 ${slot.id}`,
        idempotencyKey: spinId,
      });
      if (!paid.ok) return { ok: false, reason: 'grant-failed', slot };
      return { ok: true, spinId, slot, prize };
    }

    if (prize.kind === 'item-fragments') {
      const report = await deps.grantFragments([{ itemId: prize.item.id, amount: prize.amount }]);
      if (!report.ok) return { ok: false, reason: 'grant-failed', slot };
      return { ok: true, spinId, slot, prize };
    }

    const granted = await deps.grantUtilityCards(prize.cardId, prize.quantity);
    if (!granted.ok) return { ok: false, reason: 'grant-failed', slot };
    return { ok: true, spinId, slot, prize };
  };

  return { spinWheel };
}

/** A fresh spin id, for a caller that has none. Same shape as the workout/activation ids. */
function newSpinId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `spin-${crypto.randomUUID()}`;
  return `spin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
