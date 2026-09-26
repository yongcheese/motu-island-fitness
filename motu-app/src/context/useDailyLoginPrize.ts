/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db, doc, updateDoc, handleFirestoreError, OperationType } from '../lib/firebase';
import type { AuthUser } from '../auth/types';
import type { AppSettings, UserProfile } from '../types';
import { ownsItem, isStackableItem } from '../utils/inventory';
import {
  FRAGMENTS_TO_UNLOCK,
  collectsFragments,
  getFragmentCount,
  getRaffleTickets,
  getTicketProgress,
  isOverflowConversionEnabled,
  settleFragmentGain,
} from '../constants/fragments';
import { getFreeSpins } from '../constants/luckyWheel';
import { grantCards } from '../constants/utilityCards';
import {
  emptyAward,
  resolveDailyPrize,
  type DailyPrizeAward,
} from '../constants/dailyLoginPrizes';

/**
 * 每日登入獎勵的「非貨幣」那一半 — the 商品碎片, the 抽獎券, the 功能卡, the product and the free
 * 輪盤 turn, written as ONE update.
 *
 * ## Why this is not part of the claim itself
 *
 * A claim is a verdict: 「這一天還沒領過, 現在領掉」. That verdict belongs to the server
 * (src/server/dailyLoginApi.ts), because the two facts it turns on — what day it is, and whether
 * this day was already paid — are the two a browser must not be trusted with. The server owns the
 * claim record and the 金幣 that go with it, and it does so without knowing this game has a catalog.
 *
 * Everything in THIS file is a grant into the player's own document, of things that have no wallet
 * to protect: a fragment stack, a card bag, an inventory array, a counter of free turns. Teaching
 * the daily-login API about them would mean a schema change, a new claim-record type and a rewrite
 * of its test spec — for rewards whose worst failure case is that a player has to open the panel
 * again. So this runs AFTER a claim the server accepted as NEW, which is what keeps the
 * exactly-once property where it actually matters: a replayed claim returns `already_claimed` and
 * never reaches this line, so a double tap cannot pay a second stack. That is the same arrangement
 * the round's 商品碎片 have always had; what changed is how much rides on it.
 *
 * ## One write, not five
 *
 * 第 2 天 can pay a card AND 金幣; a 碎片 day can pay fragments AND the 抽獎券 its overflow mints.
 * Those are not separate events that happen to be near each other, and splitting them would mean a
 * failure between two writes leaves a player holding half a prize with no record of the other half.
 * So every branch below adds to one `fields` object and there is exactly one `updateDoc`.
 *
 * ## The rules are not re-implemented here
 *
 * The 200 cap, the overflow conversion and the ticket carry are the pure functions in
 * constants/fragments.ts; the card cap is `grantCards`; what a day is worth is
 * constants/dailyLogin.ts and which item it lands on is constants/dailyLoginPrizes.ts. This file
 * assembles one update out of them and decides nothing.
 */

export interface DailyPrizeReport {
  /** False when the write was refused. The award still describes what was ATTEMPTED. */
  ok: boolean;
  award: DailyPrizeAward;
}

export function useDailyLoginPrize(
  user: AuthUser | null,
  profile: UserProfile | null,
  settings: AppSettings | null,
  /** Writes an accepted value straight into local state — see AppContext's applyProfilePatch. */
  applyProfilePatch: (updates: Partial<UserProfile>) => void,
) {
  /**
   * Pays one day's non-currency prize.
   *
   * `coinsBanked` is passed in rather than read back off the profile: the 金幣 half has already
   * been paid by the time this runs (by the server, or by the offline claim path) and this function
   * must not pay it a second time — it only needs the number so the award it reports describes the
   * whole claim rather than the part it happened to write itself.
   */
  const grantDailyPrize = async (
    cycleId: string,
    day: number,
    coinsBanked: number,
  ): Promise<DailyPrizeReport> => {
    const inventoryBefore = profile?.inventory ?? [];
    const resolved = resolveDailyPrize(cycleId, day, inventoryBefore);
    const award: DailyPrizeAward = { ...emptyAward(resolved.prize.kind), coins: coinsBanked };

    if (!user || !profile) return { ok: false, award };

    const { prize } = resolved;
    const fields: Record<string, unknown> = {};
    const patch: Partial<UserProfile> = {};
    let tickets = getRaffleTickets(profile);

    // --- 商品碎片 -----------------------------------------------------------------
    if (prize.itemFragments > 0 && resolved.fragmentItemId) {
      const itemId = resolved.fragmentItemId;
      // Is this stack still alive? A dead one (an own-once item already in the wardrobe) is
      // expressed by settling against a FULL stack rather than by a second branch that pays
      // tickets its own way — the same shape useFragmentActions and useWheelActions both use, so
      // the three cannot drift.
      const live = collectsFragments(itemId, ownsItem(profile, itemId));
      const before = live ? getFragmentCount(profile, itemId) : FRAGMENTS_TO_UNLOCK;
      const settlement = settleFragmentGain({
        current: before,
        amount: prize.itemFragments,
        carry: getTicketProgress(profile),
        convert: isOverflowConversionEnabled(settings),
      });

      // The whole map, not a dotted path: item ids contain hyphens, which Firestore field paths
      // cannot address without quoting and the offline save splits on `.` regardless. See
      // useFragmentActions.ts for the full write-up.
      const fragments = { ...(profile.itemFragments ?? {}) };
      if (live) fragments[itemId] = settlement.stored;

      tickets += settlement.tickets;
      fields.itemFragments = fragments;
      fields.raffleTicketProgress = settlement.carry;
      patch.itemFragments = fragments;
      patch.raffleTicketProgress = settlement.carry;

      award.fragmentItemId = itemId;
      award.fragmentsKept = settlement.kept;
      award.fragmentsOverflow = settlement.overflow;
      award.ticketsFromOverflow = settlement.tickets;
    }

    // --- 抽獎券 -------------------------------------------------------------------
    if (prize.tickets > 0) {
      tickets += prize.tickets;
      award.tickets = prize.tickets;
    }

    // Written whenever anything moved it, which includes the overflow above — so a 碎片 day that
    // overflowed into a ticket and a 抽獎券 day land in the same field by the same line.
    if (tickets !== getRaffleTickets(profile)) {
      fields.raffleTickets = tickets;
      patch.raffleTickets = tickets;
    }

    // --- 功能卡 -------------------------------------------------------------------
    if (prize.cards > 0 && resolved.cardId) {
      // The same pure grant the 限時小攤, the 輪盤 and 管理員測試 use, so the maxOwned cap is
      // applied in one place. A bag already at the cap grants 0 — the claim still stands and the
      // reveal says so, rather than the day silently paying nothing and looking like a bug.
      const grant = grantCards(profile.utilityCards, resolved.cardId, prize.cards);
      if (grant.granted > 0) {
        fields.utilityCards = grant.state;
        patch.utilityCards = grant.state;
      }
      award.cardId = resolved.cardId;
      award.cardsGranted = grant.granted;
    }

    // --- 商品本體 -----------------------------------------------------------------
    if (resolved.itemId) {
      // One entry PER COPY for a stackable item, guarded by `includes` for everything own-once —
      // the same append the shop, the wheel and the fragment unlock all use, so a login prize lands
      // in the inventory indistinguishably from a purchase.
      const inventory = [...inventoryBefore];
      if (isStackableItem(resolved.itemId) || !inventory.includes(resolved.itemId)) {
        inventory.push(resolved.itemId);
      }
      fields.inventory = inventory;
      patch.inventory = inventory;
      award.itemId = resolved.itemId;
    }

    // --- 免費轉盤 -----------------------------------------------------------------
    if (prize.spins > 0) {
      const spins = getFreeSpins(profile) + prize.spins;
      fields.freeWheelSpins = spins;
      patch.freeWheelSpins = spins;
      award.spins = prize.spins;
    }

    // A day that pays only 金幣 has nothing for this write to do, and an empty `updateDoc` is a
    // round trip that can still fail — so it is not made.
    if (Object.keys(fields).length === 0) return { ok: true, award };

    try {
      await updateDoc(doc(db, 'users', user.uid), fields);
      applyProfilePatch(patch);
      return { ok: true, award };
    } catch (error) {
      // Reported, never thrown: the claim is already banked and the day is already marked off, so a
      // failed prize write must not turn a successful claim into a reported failure. The shared
      // save-status banner has already told the player something did not save.
      console.error('Daily login prize write failed:', error);
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      // The amounts stay on the award — they are what the day was worth and the panel still has to
      // be able to say so — but `saved` is what the reveal reads before it claims anything landed.
      return { ok: false, award: { ...award, saved: false } };
    }
  };

  return { grantDailyPrize };
}
