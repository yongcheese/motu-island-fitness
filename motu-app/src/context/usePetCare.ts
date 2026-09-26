/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import { db, doc, updateDoc, handleFirestoreError, OperationType } from '../lib/firebase';
import type { AuthUser } from '../auth/types';
import type { UserProfile } from '../types';
import { consumableAcceptsSpecies, getConsumableSpec, petEffectsFrom } from '../constants/consumables';
import {
  applyPetCareEffects,
  newPetCareState,
  petCondition,
  readPetCareState,
  readPetCareStates,
  settlePetCare,
  withPetCare,
  type PetCareDelta,
  type PetCareState,
  type PetCondition,
} from '../constants/petCare';
import { PET_HOME_STATE, makePetState } from '../constants/islandReturn';
import { getPetSpec, getPetSpecies } from '../constants/pets';
import { getAvailableStock } from '../utils/inventory';
import { playSound, SoundEffect, triggerHaptic } from '../lib/soundUtils';

/**
 * 寵物照護 Service — the one place food leaves the backpack and a pet's state changes.
 *
 * The same shape as every other write service in this codebase (context/useUtilityCards.ts,
 * context/useFragmentActions.ts, context/useWorkoutRewards.ts) and here for the same reason: more
 * than one surface will eventually want to feed an animal (the panel, the in-world prompt, a future
 * NPC who hands you a treat), and every one of them has to spend the same copy, apply the same
 * clamps and write the same map. A second call site that touches `inventory` and `islandState.pet`
 * itself is a second set of those rules, and the first to drift wins silently.
 *
 * The RULES are pure functions in constants/petCare.ts; this file is only the write.
 *
 * ## One write, and why it has to be one
 *
 * A feed spends a bag AND restores the animal. Those cannot be two updates: a failure between them
 * either takes the food without feeding the pet or feeds it for free, and there is no way for the
 * player to tell which happened. So `inventory` and `islandState.pet` go in a single `updateDoc` —
 * the same reasoning that puts a 功能卡's spend in the same write as the reward it boosted.
 *
 * `islandState.pet` is written as a DOTTED path rather than as the whole `islandState` map, and that
 * is not tidiness either: the 「我還在」 heartbeat is re-stamping `islandState.lastSeenAt` every few
 * minutes while the player is out feeding, and a feed that wrote the whole map would carry a stale
 * timestamp back over a fresher one. Same rule context/useIslandLife.ts's partial writers follow.
 *
 * ## Nothing here is optimistic
 *
 * The bag empties only after the save is accepted — the rule stated in context/useUtilityCards.ts,
 * and it matters more here: a player who watches a bag disappear and then reappear has no way to
 * know whether their pet was actually fed.
 *
 * ## What this service deliberately does NOT do
 *
 * It never writes on a timer. Nutrition and energy decay are a function of `updatedAt` and the
 * clock (constants/petCare.ts), so the only things that ever write a care state are a feed and an
 * arrival. There is no heartbeat for the pet and there must not be one — see the brief's §16.
 */

/** What a feed did. Every `reason` except the last two is an ordinary state the UI explains. */
export type FeedPetOutcome =
  | {
      ok: true;
      itemId: string;
      /** WHICH animal was fed — so a toast can name it rather than saying 「牠」 in a three-pet house. */
      petItemId: string;
      delta: PetCareDelta;
      condition: PetCondition;
    }
  | {
      ok: false;
      reason:
        | 'no-profile'
        | 'not-consumable'
        | 'wrong-target'
        | 'wrong-species'
        | 'none-owned'
        | 'no-companion'
        | 'already-full'
        | 'save-failed';
    };

export type FeedPetError = Extract<FeedPetOutcome, { ok: false }>['reason'];

/** Why a feed was refused, in the player's words. The one place this copy is written. */
export const FEED_PET_MESSAGES: Record<FeedPetError, string> = {
  'no-profile': '尚未登入，沒辦法餵食',
  'not-consumable': '這個東西不能拿來餵寵物',
  'wrong-target': '這個東西不是給寵物用的',
  // A message the player should never actually read: every feeding surface lists only what the
  // animal in front of them can eat (§17), so reaching this means something offered a food it
  // should not have. It exists because the WRITE has to be safe on its own — a UI filter is a
  // convenience, not a rule.
  'wrong-species': '這種食物不適合這隻寵物',
  'none-owned': '你手上沒有這個了，先到商店補貨吧',
  'no-companion': '先在更衣室帶一隻寵物出場，才能餵牠',
  'already-full': '牠現在很飽，等牠餓一點再餵吧',
  'save-failed': '存檔失敗，飼料沒有被用掉',
};

/**
 * Every companion the player currently has out, in equipped order.
 *
 * The one definition of 「島上有哪些寵物」, and a LIST rather than a single id because §6 says the
 * species a player owns is not one global value. Today the dressing room equips one animal at a
 * time so this returns zero or one entry — but every caller downstream is already written against
 * a list, so the day a second slot opens, nothing here or above it has to be rewritten.
 */
export function equippedPetIds(profile: UserProfile | null | undefined): string[] {
  return (profile?.equippedItems ?? []).filter((id) => !!getPetSpec(id));
}

/**
 * The primary companion — the first one equipped, and the one a surface means when it does not say
 * which animal it is talking about.
 *
 * Kept as its own function rather than being spelled `equippedPetIds(profile)[0]` at eight call
 * sites, because 「沒有指定的時候是哪一隻」 is a rule and rules belong in one place.
 */
export function equippedPetId(profile: UserProfile | null | undefined): string | undefined {
  return equippedPetIds(profile)[0];
}

/**
 * The pet's care state as of `nowMs`, settled — what every reader should ask for.
 *
 * A read helper rather than a piece of state, for the reason `readLiveEffects` is one
 * (context/useUtilityCards.ts): the profile is the only copy, and a component that cached this would
 * be a second one that goes stale by the minute. Settling is a couple of arithmetic operations, so
 * this is cheap enough to call from a render or from a behaviour decision.
 */
export function readPetCare(
  profile: UserProfile | null | undefined,
  /** Which animal. Omitted means the primary companion — see {@link equippedPetId}. */
  petItemId: string | null | undefined,
  nowMs: number,
): PetCareState {
  return settlePetCare(rawPetCare(profile, petItemId, nowMs), nowMs);
}

/**
 * The stored state for one animal, unsettled, with the pre-multi-pet save folded in.
 *
 * The migration is this one branch and nothing else: a profile written before `cares` existed has a
 * single `care`, and it belonged to whichever animal was out at the time — which is the primary
 * companion. So the primary inherits it once, the first write puts the result in `cares`, and the
 * old field is never consulted for that animal again. Any OTHER animal starts fresh, which is what
 * a pet that has never been out is: 「還沒餓過」, exactly like one just bought.
 */
function rawPetCare(
  profile: UserProfile | null | undefined,
  petItemId: string | null | undefined,
  nowMs: number,
): PetCareState {
  const pet = profile?.islandState?.pet;
  const id = petItemId ?? equippedPetId(profile);
  const stored = id ? readPetCareStates(pet?.cares, nowMs)[id] : undefined;
  if (stored) return stored;
  if (id && id === equippedPetId(profile)) return readPetCareState(pet?.care, nowMs);
  return newPetCareState(nowMs);
}

/** The same thing, read as bands and multipliers. What every screen actually shows. */
export function readPetCondition(
  profile: UserProfile | null | undefined,
  petItemId: string | null | undefined,
  nowMs: number,
): PetCondition {
  return petCondition(readPetCare(profile, petItemId, nowMs));
}

/**
 * How full is 「too full to bother」.
 *
 * A feed that moves nothing has still spent a bag, and a player who watches that happen has been
 * charged for nothing. Refusing just under the ceiling is kinder than clamping silently, and it is
 * the one and only thing standing between a player and wasting food.
 */
const FULL_ENOUGH = 0.97;

export function usePetCare(
  user: AuthUser | null,
  profile: UserProfile | null,
  /** Writes an accepted value straight into local state — see AppContext's applyProfilePatch. */
  applyProfilePatch: (updates: Partial<UserProfile>) => void,
) {
  /**
   * 餵食模式 — the food the player has chosen but not yet given to the animal.
   *
   * Held in React state rather than on playerBus, unlike almost everything else the pet touches:
   * this changes when a button is pressed, not every frame, and the two things that read it (the
   * floating prompt and the HUD chip) are both ordinary components that re-render anyway. The bus is
   * for per-frame data that a `useFrame` loop is already sampling; putting a once-a-minute value
   * there would mean polling for it.
   *
   * It is also deliberately NOT persisted. Arming a feed is a thing you are in the middle of doing,
   * not a fact about your save — and a mode that survived a reload would leave a player wondering
   * why their pet prompt says something strange three days later.
   */
  const [pendingPetFood, setPendingPetFood] = useState<string | null>(null);

  const armPetFeeding = useCallback((itemId: string | null) => {
    setPendingPetFood(itemId);
  }, []);

  const cancelPetFeeding = useCallback(() => setPendingPetFood(null), []);

  /**
   * Feeds one serving to the companion. The single write path for every surface.
   *
   * Everything about WHAT the food does is the item's own definition — this function does not know
   * that 基礎飼料 restores 營養. It resolves the item's declared effects, hands them to the one
   * function that may change a care state, and writes the result.
   */
  const feedPet = useCallback(
    async (
      itemId: string,
      /**
       * WHICH animal is being fed. Omitted means the primary companion, which is what the pre-
       * multi-pet callers meant when they did not say.
       *
       * The whole of §21 is that this argument exists and is threaded from the thing the player is
       * standing next to (UI/PetInteractionPanel.tsx reads it off the prompt target), rather than
       * the feed resolving 「the pet」 for itself down here. A write that picked the animal on its
       * own could only ever pick one, and it would be the same one every time.
       */
      petItemId?: string,
    ): Promise<FeedPetOutcome> => {
      if (!user || !profile) return { ok: false, reason: 'no-profile' };

      const spec = getConsumableSpec(itemId);
      if (!spec) return { ok: false, reason: 'not-consumable' };
      if (spec.target !== 'pet') return { ok: false, reason: 'wrong-target' };
      const petId = petItemId ?? equippedPetId(profile);
      // Not merely 「有沒有寵物」: the named animal has to be one the player actually has out, or a
      // stale panel left open across an unequip would feed a companion that is not there.
      if (!petId || !equippedPetIds(profile).includes(petId)) {
        return { ok: false, reason: 'no-companion' };
      }
      const species = getPetSpecies(petId);
      // Compatibility enforced at the WRITE, not only in the list that offered it. The filter above
      // this is what the player experiences (§5, §17); this is what makes it true.
      if (species && !consumableAcceptsSpecies(spec, species)) {
        return { ok: false, reason: 'wrong-species' };
      }
      // The same derived stock every other screen reads (utils/inventory.ts), not a count of its
      // own: 「我還有幾包」 must have one answer, and the shop's badge is already showing it.
      if (getAvailableStock(profile, itemId) <= 0) return { ok: false, reason: 'none-owned' };

      const nowMs = Date.now();
      const current = readPetCare(profile, petId, nowMs);
      if (current.nutrition >= FULL_ENOUGH && current.energy >= FULL_ENOUGH) {
        return { ok: false, reason: 'already-full' };
      }

      const { state: care, delta } = applyPetCareEffects(current, petEffectsFrom(spec.effects), nowMs);

      // One copy leaves the flat inventory list. `indexOf`/`splice` rather than a filter, because a
      // filter would remove EVERY bag the player owns — the list holds one entry per copy (see
      // utils/inventory.ts), so removing a stack means removing exactly one element of it.
      const inventory = [...(profile.inventory ?? [])];
      const at = inventory.indexOf(itemId);
      if (at < 0) return { ok: false, reason: 'none-owned' };
      inventory.splice(at, 1);

      const previous = profile.islandState?.pet;
      const pet = makePetState(
        previous?.mood ?? PET_HOME_STATE.mood,
        previous?.vitality ?? PET_HOME_STATE.vitality,
        previous?.lastGreetedAt,
        // The legacy field rides through unchanged — see PetLifeState.care. It is not updated,
        // because the animal this feed belongs to is named and its state goes in the map below.
        previous?.care,
        // Only THIS animal's entry changes — §21 in one call. See withPetCare on why that is a
        // named function rather than a spread written out here.
        withPetCare(previous?.cares, petId, care, nowMs),
      );

      try {
        await updateDoc(doc(db, 'users', user.uid), {
          inventory,
          // Dotted, so the heartbeat's `islandState.lastSeenAt` and the sprouts beside it are not
          // carried back to whatever they were when this profile was loaded. See the file doc.
          'islandState.pet': pet,
          lastUpdated: new Date(nowMs).toISOString(),
        });
      } catch (error) {
        console.error('[pet] 餵食沒有存檔成功：', error);
        handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
        return { ok: false, reason: 'save-failed' };
      }

      applyProfilePatch({
        inventory,
        islandState: { ...profile.islandState, pet },
      });
      setPendingPetFood(null);
      playSound(SoundEffect.SUCCESS, 0.32);
      triggerHaptic('light');
      return { ok: true, itemId, petItemId: petId, delta, condition: petCondition(care) };
    },
    [user, profile, applyProfilePatch],
  );

  /**
   * 管理員測試 — puts the animal at a given 營養/活動力 without waiting for real time to pass.
   *
   * Writes a real care state down the real path, so what the tester sees is what a player in that
   * condition would see. It is the counterpart to `simulateOfflineDays` (context/useIslandLife.ts)
   * and exists for the same reason: a shortcut that painted the outcome would be a second
   * implementation, and would pass while the real one was broken.
   */
  const setPetCare = useCallback(
    async (nutrition: number, energy: number, petItemId?: string): Promise<boolean> => {
      if (!user || !profile) return false;
      const petId = petItemId ?? equippedPetId(profile);
      if (!petId) return false;
      const nowMs = Date.now();
      const previous = profile.islandState?.pet;
      const base = newPetCareState(nowMs);
      const care: PetCareState = {
        ...base,
        nutrition: Math.min(1, Math.max(0, nutrition)),
        energy: Math.min(1, Math.max(0, energy)),
      };
      const pet = makePetState(
        previous?.mood ?? PET_HOME_STATE.mood,
        previous?.vitality ?? PET_HOME_STATE.vitality,
        previous?.lastGreetedAt,
        previous?.care,
        // One animal, the same as a feed: a tester who sets 「懶洋洋」 on the dog must not find the
        // cat listless too, or what they are testing is not what a player would experience.
        withPetCare(previous?.cares, petId, care, nowMs),
      );
      try {
        await updateDoc(doc(db, 'users', user.uid), { 'islandState.pet': pet });
      } catch (error) {
        console.error('[pet] 寵物狀態調整沒有存檔成功：', error);
        handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
        return false;
      }
      applyProfilePatch({ islandState: { ...profile.islandState, pet } });
      return true;
    },
    [user, profile, applyProfilePatch],
  );

  return { feedPet, pendingPetFood, armPetFeeding, cancelPetFeeding, setPetCare };
}
