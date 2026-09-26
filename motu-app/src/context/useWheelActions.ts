/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db, doc, updateDoc, handleFirestoreError, OperationType } from '../lib/firebase';
import type { AuthUser } from '../auth/types';
import type { AppSettings, UserProfile } from '../types';
import { ownsItem, isStackableItem } from '../utils/inventory';
import { drawReward, seedFrom } from '../constants/rewardPools';
import {
  FRAGMENTS_TO_UNLOCK,
  getFragmentCount,
  getRaffleTickets,
  getTicketProgress,
  isOverflowConversionEnabled,
  rollWorkoutFragmentItem,
  settleFragmentGain,
} from '../constants/fragments';
import {
  DUPLICATE_OUTFIT_TICKETS,
  FUNCTION_CARD_REFUND,
  WHEEL_SPIN_COST,
  getFreeSpins,
  pickWheelSlot,
  type WheelSlot,
} from '../constants/luckyWheel';
import { grantCards, type UtilityCardId } from '../constants/utilityCards';

/**
 * 幸運輪盤 — the whole spin, as ONE write.
 *
 * The wheel is the first thing in the game that both SPENDS and PAYS in the same action, and that
 * is the only interesting thing about this file. A ticket leaving and a prize arriving are not two
 * events that happen to be near each other: if the charge lands and the payout does not, the player
 * paid for nothing, and if the payout lands and the charge does not, the wheel is free. So both
 * sides are folded into a single `updateDoc` — the same reasoning that puts a workout's payout in
 * the same write as its replay guard (context/useWorkoutRewards.ts).
 *
 * That is also why this is not built out of the two services next door. `grantFragments`
 * (useFragmentActions.ts) and `buildSpendUpdate` (useEconomyActions.ts) are each correct on their
 * own and would be two writes here. The RULES they apply are still not re-implemented: the fragment
 * cap, the overflow conversion and the ticket carry all come from the pure functions in
 * constants/fragments.ts, which is where they have always lived — this file only assembles one
 * update out of them.
 *
 * ## What it can never do
 *
 * Pay 金幣. Not because of a check here but because there is no path: the only balances this file
 * touches are `raffleTickets`, `freeWheelSpins` and `itemFragments`, and 輪盤 is declared
 * `['fragments']` in constants/rewards.ts's source→currency policy for the day somebody wires it
 * to `grantReward`.
 */

/** The prize a spin actually produced, in the terms the reveal card announces. */
export type WheelPrize =
  /** 商品碎片 for one item, already settled against the 200 cap and the ticket carry. */
  | {
      kind: 'fragments';
      itemId: string;
      /** How many landed on the item. */
      amount: number;
      /** How many had nowhere to go and became 抽獎券 instead. */
      overflow: number;
      /** 抽獎券 minted by that overflow. */
      tickets: number;
      /** True when this spin is what filled the stack. */
      completed: boolean;
    }
  /** 抽獎券, including the consolation paid when a 造型 wedge draws something already owned. */
  | { kind: 'raffle-ticket'; amount: number; /** 因重複造型而折算 */ fromDuplicate?: string }
  /** A wearable, now in the inventory. */
  | { kind: 'outfit'; itemId: string }
  /**
   * 功能卡, into the card bag. `granted` is what actually fit under the card's cap; when that is 0
   * the spin was refunded instead and `refund` says how many 抽獎券 came back — see
   * FUNCTION_CARD_FULL_NOTE in constants/luckyWheel.ts.
   */
  | { kind: 'function-card'; cardId: UtilityCardId; granted: number; refund: number };

export type WheelSpinOutcome =
  | { ok: true; slot: WheelSlot; prize: WheelPrize }
  | { ok: false; reason: 'no-profile' | 'insufficient-tickets' | 'empty-pool' | 'save-failed' };

export function useWheelActions(
  user: AuthUser | null,
  profile: UserProfile | null,
  settings: AppSettings | null,
  /** Writes an accepted value straight into local state — see AppContext's applyProfilePatch. */
  applyProfilePatch: (updates: Partial<UserProfile>) => void,
) {
  /**
   * Spends one turn — a free one if the player is holding any, otherwise one 抽獎券 — draws a
   * wedge, and pays what it promised.
   *
   * The wedge is drawn HERE rather than in the component, so the animation can only ever land on
   * the outcome that was actually written. A UI that spins first and asks afterwards has two
   * sources of truth for the same event, and the one the player believes is the one on screen.
   *
   * ## Free turns are spent FIRST, and that is not arbitrary
   *
   * A free turn (`profile.freeWheelSpins`, paid by 每日登入 第 7 天) can only ever be a spin, while
   * a 抽獎券 can also be saved. Spending tickets while a free turn sits unused would be spending
   * the more useful of the two first, and would leave the player holding something they can do
   * nothing else with. The other order needs no explanation to the player at all.
   */
  const spinWheel = async (): Promise<WheelSpinOutcome> => {
    if (!user || !profile) return { ok: false, reason: 'no-profile' };

    const heldFreeSpins = getFreeSpins(profile);
    const heldTickets = getRaffleTickets(profile);
    const useFreeSpin = heldFreeSpins > 0;
    if (!useFreeSpin && heldTickets < WHEEL_SPIN_COST) {
      return { ok: false, reason: 'insufficient-tickets' };
    }

    const slot = pickWheelSlot();
    const fields: Record<string, unknown> = {};
    const patch: Partial<UserProfile> = {};
    // The charge, applied up front. Every branch below adds to this rather than writing its own
    // ticket balance, so no branch can forget to bill the spin.
    let tickets = useFreeSpin ? heldTickets : heldTickets - WHEEL_SPIN_COST;
    if (useFreeSpin) {
      // In `fields` from the start, beside the ticket balance below, so the turn is spent in the
      // same single write that pays the prize. A separate write for the charge is the shape where
      // a failure between the two either gives a prize away or eats a turn for nothing.
      fields.freeWheelSpins = heldFreeSpins - 1;
      patch.freeWheelSpins = heldFreeSpins - 1;
    }
    let prize: WheelPrize;

    switch (slot.kind) {
      case 'fragments': {
        // The same roll a workout uses — weighted toward a stack the player has already started and
        // does not own yet. The function's name is historical (it predates every source but 健身);
        // the rule it applies is about the player's collection, not about exercise.
        const target = rollWorkoutFragmentItem(profile, (id) => ownsItem(profile, id));
        if (!target) return { ok: false, reason: 'empty-pool' };

        // An owned item's stack is dead, so the whole grant is overflow. Said by passing a full
        // stack into the one settlement function rather than by branching — exactly as
        // useFragmentActions does it, so the two cannot drift.
        const owned = ownsItem(profile, target.id);
        const before = owned ? FRAGMENTS_TO_UNLOCK : getFragmentCount(profile, target.id);
        const settlement = settleFragmentGain({
          current: before,
          amount: slot.amount ?? 0,
          carry: getTicketProgress(profile),
          convert: isOverflowConversionEnabled(settings),
        });

        // The whole map, not a dotted path: item ids contain hyphens, which Firestore field paths
        // cannot address without quoting and the offline save splits on `.` regardless. See
        // useFragmentActions.ts for the full write-up.
        const fragments = { ...(profile.itemFragments ?? {}) };
        if (!owned) fragments[target.id] = settlement.stored;

        tickets += settlement.tickets;
        fields.itemFragments = fragments;
        fields.raffleTicketProgress = settlement.carry;
        patch.itemFragments = fragments;
        patch.raffleTicketProgress = settlement.carry;

        prize = {
          kind: 'fragments',
          itemId: target.id,
          amount: settlement.kept,
          overflow: settlement.overflow,
          tickets: settlement.tickets,
          completed: !owned && before < FRAGMENTS_TO_UNLOCK && settlement.stored >= FRAGMENTS_TO_UNLOCK,
        };
        break;
      }

      case 'raffle-ticket': {
        tickets += slot.amount ?? 0;
        prize = { kind: 'raffle-ticket', amount: slot.amount ?? 0 };
        break;
      }

      case 'outfit': {
        if (!slot.pool) return { ok: false, reason: 'empty-pool' };
        // Filter → Select, never Select → Check: the pool is resolved against the catalog and the
        // player's inventory before anything is drawn, so a 稀有造型 wedge cannot produce a 普通
        // item and then have to put it back. See constants/rewardPools.ts.
        const draw = drawReward(
          slot.pool,
          profile.inventory ?? [],
          seedFrom(`wheel:${slot.id}:${Date.now()}:${Math.random()}`),
        );
        if (!draw.ok) return { ok: false, reason: 'empty-pool' };

        if (draw.fromOwnedFallback) {
          // Every item at this tier is already owned, so the pool had nothing new to give and a
          // second copy of a wearable is a no-op in the inventory (utils/inventory.ts) — the player
          // would watch a 史詩 land and receive nothing. Paid in 抽獎券 instead, at the rate
          // declared in constants/luckyWheel.ts.
          const consolation = DUPLICATE_OUTFIT_TICKETS[slot.rarity ?? 'rare'] ?? 1;
          tickets += consolation;
          prize = { kind: 'raffle-ticket', amount: consolation, fromDuplicate: draw.item.id };
          break;
        }

        // One entry PER COPY for a stackable item, guarded by `includes` for everything own-once —
        // the same append the shop and the fragment unlock use, so a wheel prize lands in the
        // inventory indistinguishably from a purchase.
        const inventory = [...(profile.inventory ?? [])];
        if (isStackableItem(draw.item.id) || !inventory.includes(draw.item.id)) {
          inventory.push(draw.item.id);
        }
        fields.inventory = inventory;
        patch.inventory = inventory;
        prize = { kind: 'outfit', itemId: draw.item.id };
        break;
      }

      case 'function-card':
      default: {
        if (!slot.cardId) return { ok: false, reason: 'empty-pool' };
        // The same pure grant the 限時小攤 and 管理員測試 use, so the maxOwned cap is applied once.
        // It lands in THIS write beside the ticket charge — firestore.rules' limited-shop clause
        // already allows `utilityCards` + `raffleTickets` together, so no rules deploy is needed.
        const grant = grantCards(profile.utilityCards, slot.cardId, slot.amount ?? 1);
        if (grant.granted > 0) {
          fields.utilityCards = grant.state;
          patch.utilityCards = grant.state;
          prize = { kind: 'function-card', cardId: slot.cardId, granted: grant.granted, refund: 0 };
        } else if (useFreeSpin) {
          // Bag already at the cap, and this turn was a free one: give the TURN back, not a
          // 抽獎券. Refunding in tickets here would quietly mint one out of a prize the player was
          // handed rather than bought — and on a wheel priced at more than one ticket it would
          // hand back less than the turn was worth.
          fields.freeWheelSpins = heldFreeSpins;
          patch.freeWheelSpins = heldFreeSpins;
          prize = { kind: 'function-card', cardId: slot.cardId, granted: 0, refund: 0 };
        } else {
          // Bag already at the cap: void the spin rather than show a card that went nowhere.
          tickets += FUNCTION_CARD_REFUND;
          prize = { kind: 'function-card', cardId: slot.cardId, granted: 0, refund: FUNCTION_CARD_REFUND };
        }
        break;
      }
    }

    fields.raffleTickets = tickets;
    patch.raffleTickets = tickets;

    try {
      await updateDoc(doc(db, 'users', user.uid), fields);
      applyProfilePatch(patch);
      return { ok: true, slot, prize };
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return { ok: false, reason: 'save-failed' };
    }
  };

  return { spinWheel };
}
