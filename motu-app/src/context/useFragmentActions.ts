/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db, doc, updateDoc, handleFirestoreError, OperationType } from '../lib/firebase';
import type { AuthUser } from '../auth/types';
import { AppSettings, UserProfile } from '../types';
import { getItemById } from '../constants/items';
import { isStackableItem, ownsItem } from '../utils/inventory';
import {
  FRAGMENTS_TO_UNLOCK,
  collectsFragments,
  type FragmentGrant,
  getFragmentCount,
  getRaffleTickets,
  getTicketProgress,
  isFragmentItem,
  isOverflowConversionEnabled,
  isRepeatableFragmentItem,
  settleFragmentGain,
  settleFragmentsOnPurchase,
} from '../constants/fragments';

/**
 * 商品碎片 — the one place a fragment is ever created, spent or converted.
 *
 * Same shape as the Shop System next door (context/useShopActions.ts) and for the same reason: three
 * different screens hand out fragments (運動結算 and 每日簽到 through here; 幸運轉盤 through its own
 * single write, because it charges a 抽獎券 in the same breath — context/useWheelActions.ts) and
 * every one of them has to apply the same cap, the same overflow conversion and the same carry.
 * That is why the RULES are pure functions in constants/fragments.ts and not in either writer: a
 * second call site re-deriving them is a second set of them, and the first one to drift wins
 * silently.
 *
 * The RULES live in constants/fragments.ts as pure functions; this file is only the write.
 *
 * ## Why the whole map is written instead of one field
 *
 * Fragments are stored as `itemFragments: { [itemId]: count }`, and item ids contain hyphens
 * (`item-5`, `hair-long-set`). Firestore's dotted field paths cannot address those without backtick
 * quoting, and the offline save (save/LocalSaveStore.ts) splits dotted keys on `.` with no quoting at
 * all — so `itemFragments.item-5` would mean two different things in the two back-ends this app
 * runs on. Writing the map whole means one behaviour in both. The map holds one entry per item the
 * player has actually collected, which is small.
 */

/** Why an unlock didn't go through, so the caller can say something specific. */
export type FragmentUnlockResult =
  | 'ok'
  | 'unknown-item'
  /** The item has no fragment of its own — an 經驗值 reward, or something not on sale. */
  | 'no-fragments'
  | 'insufficient-fragments'
  | 'already-owned'
  | 'error';

/** What one item's fragments did when a grant landed on them. */
export interface FragmentGrantResult {
  itemId: string;
  /** How many of the granted fragments stayed on the item. */
  kept: number;
  /** The stack afterwards. Never above {@link FRAGMENTS_TO_UNLOCK}. */
  stored: number;
  /** How many had nowhere to go. */
  overflow: number;
  /** True when this grant is what filled the stack — the moment worth celebrating. */
  completed: boolean;
}

/** What a whole grant did, in the terms a settlement screen or a claim reveal wants to announce. */
export interface FragmentGrantReport {
  ok: boolean;
  results: FragmentGrantResult[];
  /** 抽獎券 minted by the overflow across the whole grant. */
  tickets: number;
}

const EMPTY_REPORT: FragmentGrantReport = { ok: false, results: [], tickets: 0 };

export function useFragmentActions(
  user: AuthUser | null,
  profile: UserProfile | null,
  settings: AppSettings | null,
  /** Writes an accepted value straight into local state — see AppContext's applyProfilePatch. */
  applyProfilePatch: (updates: Partial<UserProfile>) => void,
) {
  /**
   * Hands the player fragments — the single entry point for every source.
   *
   * Takes a LIST rather than one item because a source is allowed to pay more than one stack in a
   * breath, and because the ticket carry has to be settled once across the whole
   * grant: settling twice against the same carry would either lose a remainder or pay it twice.
   *
   * A grant naming an item that has no fragment is dropped rather than refused — a drop table with a
   * stale id must not be able to fail a workout's payout.
   */
  const grantFragments = async (grants: FragmentGrant[]): Promise<FragmentGrantReport> => {
    if (!user || !profile) return EMPTY_REPORT;

    const convert = isOverflowConversionEnabled(settings);
    const fragments: Record<string, number> = { ...(profile.itemFragments ?? {}) };
    const results: FragmentGrantResult[] = [];
    let carry = getTicketProgress(profile);
    let tickets = 0;

    for (const grant of grants) {
      if (!isFragmentItem(grant.itemId) || grant.amount <= 0) continue;
      // Is this stack still alive? It used to be a flat `!ownsItem` — the moment ANY copy was in the
      // inventory the whole grant became overflow. That is right for an own-once item and wrong for
      // a stackable one, whose fragments still buy the next copy (constants/fragments.ts's
      // `collectsFragments`). A dead stack is expressed by passing `current: FRAGMENTS_TO_UNLOCK`
      // through the one settlement function, rather than by a second branch that pays tickets its
      // own way.
      const live = collectsFragments(grant.itemId, ownsItem(profile, grant.itemId));
      const before = live ? getFragmentCount(profile, grant.itemId) : FRAGMENTS_TO_UNLOCK;
      const settlement = settleFragmentGain({ current: before, amount: grant.amount, carry, convert });

      carry = settlement.carry;
      tickets += settlement.tickets;
      if (live) fragments[grant.itemId] = settlement.stored;

      results.push({
        itemId: grant.itemId,
        kept: settlement.kept,
        stored: settlement.stored,
        overflow: settlement.overflow,
        completed: live && before < FRAGMENTS_TO_UNLOCK && settlement.stored >= FRAGMENTS_TO_UNLOCK,
      });
    }

    if (results.length === 0) return { ok: true, results: [], tickets: 0 };

    const nextTickets = getRaffleTickets(profile) + tickets;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        itemFragments: fragments,
        raffleTickets: nextTickets,
        raffleTicketProgress: carry,
      });
      applyProfilePatch({
        itemFragments: fragments,
        raffleTickets: nextTickets,
        raffleTicketProgress: carry,
      });
      return { ok: true, results, tickets };
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return { ...EMPTY_REPORT, results, tickets };
    }
  };

  /**
   * 碎片解鎖 — trades a full stack for the item itself.
   *
   * The fragment route is a *parallel* way to own something, not a discount on the gold one: it
   * charges no gold, and it lands the item in the same `inventory` array a purchase does, so
   * everything downstream (the wardrobe, the build rail's stock, 已擁有 on the card) cannot tell the
   * two apart and does not have to.
   *
   * The stack is spent in full and the entry removed rather than left at 0 — an item the player owns
   * has no progress left to show, and a 0 sitting in the map would render as a bar at zero on a card
   * that is already finished.
   */
  const unlockWithFragments = async (itemId: string): Promise<FragmentUnlockResult> => {
    if (!user || !profile) return 'error';

    const item = getItemById(itemId);
    if (!item) return 'unknown-item';
    if (!isFragmentItem(item)) return 'no-fragments';
    // Owning one only closes the fragment route on an item there can be one of. A stackable item can
    // be bought again, and the fragments a player collected AFTER the first copy were collected for
    // the second — refusing here (as this used to, on a flat `ownsItem`) left a full bar with no
    // button under it. See `isRepeatableFragmentItem`.
    if (ownsItem(profile, itemId) && !isRepeatableFragmentItem(itemId)) return 'already-owned';
    if (getFragmentCount(profile, itemId) < FRAGMENTS_TO_UNLOCK) return 'insufficient-fragments';

    const fragments = { ...(profile.itemFragments ?? {}) };
    delete fragments[itemId];
    // Same append/union split as the Shop System, read from the same helper, so a fragment unlock
    // stacks (or doesn't) exactly as a purchase of the same item would. Written as an append guarded
    // by `includes` rather than as a Set over the whole array: `inventory` holds one entry PER COPY
    // of a placeable item, and de-duplicating it wholesale would quietly delete the second sofa
    // somebody bought while unlocking a hat.
    const inventory = [...(profile.inventory ?? [])];
    if (isStackableItem(itemId) || !inventory.includes(itemId)) inventory.push(itemId);

    try {
      await updateDoc(doc(db, 'users', user.uid), { inventory, itemFragments: fragments });
      applyProfilePatch({ inventory, itemFragments: fragments });
      return 'ok';
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return 'error';
    }
  };

  return { grantFragments, unlockWithFragments };
}

/**
 * The fragment half of a GOLD purchase, as a patch the buying write folds into its own update.
 *
 * The other half of 「多出來的碎片」, and the half that is easy to miss. A player who was 180/200 of
 * the way to a lamp and then buys the lamp is holding 180 fragments that can never unlock anything
 * again — the only thing they were ever valid for is now owned. Left alone they would sit in the
 * save forever as a number nobody can act on, and the card would keep drawing a progress bar under
 * an item marked 已擁有.
 *
 * ## The exception, and why it was the actual bug
 *
 * All of that reasoning turns on 「那件東西現在已經擁有了」 closing the road. On a stackable item it
 * does not: buying one sofa does not stop a player buying a second, so the 180 fragments they were
 * holding are still valid — for the next one. This used to convert them anyway, which is why a
 * repeat-buyable商品 lost its 碎片進度 on purchase and could not get it back by reloading: the
 * progress was not hidden, it had been SPENT. Now the settlement is skipped entirely for those and
 * the stack rides through the purchase untouched.
 *
 * A 限時商店 exclusive is unaffected: `isRepeatableFragmentItem` is false for anything the ordinary
 * shop does not stock (`isFragmentItem`), so context/useLimitedShop.ts still settles the stranded
 * stack it was written to rescue.
 *
 * Returned as fields to merge rather than written here, so the purchase stays ONE write: the gold
 * leaving, the item arriving and the fragments settling either all land or none of them do. Returns
 * an empty object when there is nothing to settle, which is the overwhelmingly common case — the
 * purchase write is then byte-for-byte what it always was.
 *
 * Lives beside the hook rather than inside it because `purchaseItem` is not a fragment action; it is
 * the Shop System calling one, and a hook cannot be called from inside another module's write.
 */
export function fragmentPatchForPurchase(
  profile: UserProfile,
  settings: AppSettings | null,
  itemId: string,
): Partial<UserProfile> {
  if (isRepeatableFragmentItem(itemId)) return {};
  const stored = getFragmentCount(profile, itemId);
  if (stored === 0) return {};

  const settlement = settleFragmentsOnPurchase({
    stored,
    carry: getTicketProgress(profile),
    convert: isOverflowConversionEnabled(settings),
  });

  const fragments = { ...(profile.itemFragments ?? {}) };
  delete fragments[itemId];

  return {
    itemFragments: fragments,
    raffleTickets: getRaffleTickets(profile) + settlement.tickets,
    raffleTicketProgress: settlement.carry,
  };
}
