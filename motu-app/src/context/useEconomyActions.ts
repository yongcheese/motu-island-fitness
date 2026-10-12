/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Economy / Reward Service — the ONE place in the game that moves a currency.
 *
 * §14 and §16 of the 稀有度／碎片 brief, and the reason this file grew a core it did not have: every
 * source of resources now goes through {@link useEconomyActions.grantReward}, so nothing anywhere
 * writes `balanceGold: increment(n)` on its own any more. What used to be scattered:
 *
 *   FitnessView.tsx        balanceGold: increment(reps * 0.8)       → context/useWorkoutRewards.ts
 *   IslandDecorations.tsx  balanceGold: increment(500)              → grantReward(island-interaction)
 *   useEconomyActions.ts   balanceGold: increment(PET_REWARD_GOLD)  → grantReward(island-interaction)
 *   useEconomyActions.ts   balanceGold: increment(dailyReward)      → the daily-login claim below
 *
 * Every one of those was a component deciding, on its own, that the player had earned money. The
 * cost of that was not just tidiness: there was no way to ask 「玩家為什麼得到這些資源」, and no way
 * to enforce the game's central economic rule, which is that 金幣 is minted by exercise and by
 * nothing else.
 *
 * ## The rule, and where it is actually enforced
 *
 * `constants/rewards.ts` holds {@link SOURCE_CURRENCY_POLICY}: 健身 may pay 金幣, and every other
 * source may pay 碎片. {@link checkGrant} is consulted before ANY write here, including the ones
 * that are part of a bigger compound update. So a future 輪盤 that tries to hand out gold does not
 * ship a broken economy — it grants nothing and logs which source tried.
 *
 * ## Atomic grants, and why `grantReward` is not the only writer
 *
 * Some grants must land together with a record that they happened — the daily-login claim writes
 * the fragment payout in the same `updateDoc` as the day it is marking off, because a payout
 * without a mark pays twice and a mark without a payout pays nothing. Those paths do not call
 * `grantReward`; they call {@link buildCurrencyUpdate}, which applies the same policy check and
 * returns the field map to fold into their own write. The policy is still evaluated in exactly one
 * place — only the `updateDoc` differs.
 *
 * ## 功能卡 effects are applied HERE, in one function, for every payout (2026-08-29)
 *
 * {@link buildCurrencyUpdate} is also the game's 獎勵計算層 seam: it runs every grant through
 * `settleReward` (constants/rewardEffects.ts) before it becomes an `increment()`. So 雙倍金幣券 —
 * and every card after it — multiplies exactly once, on every path, whether the payout is a
 * standalone grant, part of a 摸摸寵物 write or part of a 健身 结算.
 *
 *   Base Reward → checkGrant (policy) → settleReward (active effects) → increment()
 *
 * The alternative was for each source to multiply its own numbers, which is what §3/§16 of the
 * 功能卡 brief forbids and for a concrete reason: two sources that each remember to multiply are
 * one refactor away from a reward that is multiplied twice, and neither of them can be found by
 * searching for the card.
 */

import { db, doc, updateDoc, increment, handleFirestoreError, OperationType } from '../lib/firebase';
import type { AuthUser } from '../auth/types';
import { UserProfile } from '../types';
import { reseatIslandPlacements } from '../lib/placementSurfaces';
import { vibrateGoldEarned, vibrateTerritoryExpanded } from '../lib/vibration';
import { playerBus, publishLoginBonus } from '../lib/playerBus';
import {
  CURRENCY_SPECS,
  currencyFieldPath,
  currencyPatch,
  getBalance,
  type CurrencyId,
} from '../constants/currency';
import { checkGrant, describeGrant, type RewardGrant } from '../constants/rewards';
import {
  describeSettlement,
  settleReward,
  type RewardEffectContext,
  type SettledReward,
} from '../constants/rewardEffects';
import {
  DAILY_LOGIN_MESSAGES,
  DailyLoginError,
  claimDailyLogin,
  newIdempotencyKey,
  type DailyLoginErrorCode,
} from '../lib/dailyLoginClient';
import { getRaffleTickets } from '../constants/fragments';
import type { DailyPrizeAward } from '../constants/dailyLoginPrizes';
import {
  DAILY_LOGIN_CURRENCY,
  MAKEUP_SURCHARGE,
  buildSquares,
  canClaim,
  civilDateAt,
  makeupCostForDay,
  resolveCycle,
} from '../constants/dailyLogin';

/**
 * What a 領取/補簽 attempt produced.
 *
 * A discriminated result rather than "the reward, or null". The old contract collapsed every
 * failure into `null`, which is fine for a panel that only wanted to know whether to play its
 * animation and useless for one that has to say 「金幣不足」 or 「這一天已經領過了」 — and the
 * feature's error list is most of its behaviour, not an afterthought.
 *
 * `quantity`/`currency` rather than `gold`: a day's headline number is not always money — four of
 * the seven days pay none at all — and a field called `gold` holding a count of 功能卡 is exactly
 * the confusion §22 is about. `spent` is the 補簽 fee, always 金幣 — see {@link MAKEUP_SURCHARGE}.
 */
export type DailyClaimOutcome =
  | {
      ok: true;
      day: number;
      quantity: number;
      currency: CurrencyId;
      spent: number;
      /**
       * What the claim actually BANKED, beyond the 金幣 — the fragments, the tickets, the card, the
       * product, the free spin. Absent until the prize write has run.
       *
       * Optional, and filled in by a WRAPPER (context/AppContext.tsx) rather than by this file: the
       * verdict half of a claim is the server's (src/server/dailyLoginApi.ts) and this file is the
       * client half of that conversation, while everything in the award is a purely local grant
       * that rides on the same tap. Keeping it out of the claim call means the daily-login API, its
       * claim records and its test spec (scripts/test-daily-login.ts) are untouched by the whole
       * prize table — and the claim still cannot pay twice, because the award only follows a claim
       * the server said was new. See context/useDailyLoginPrize.ts.
       */
      award?: DailyPrizeAward;
    }
  | { ok: false; code: DailyLoginErrorCode; message: string };

/**
 * Ceiling for a hand-typed 管理員 value. Not a game rule — the game has no cap — just the point
 * past which a number stops fitting the HUD and stops being a plausible test state.
 */
export const ADMIN_VALUE_MAX = 9_999_999;

/** Whole, in range, never NaN — see setCurrency/setXp. */
export const clampAdminValue = (value: number): number =>
  Number.isFinite(value) ? Math.min(ADMIN_VALUE_MAX, Math.max(0, Math.floor(value))) : 0;

const DAILY_PET_LIMIT = 3;

/**
 * 摸摸寵物 — 碎片 and 經驗值, up to {@link DAILY_PET_LIMIT} times a day.
 *
 * It paid 20 金幣 until 2026-08-25, which was a small, friendly violation of the rule that 金幣 comes
 * only from exercise — 60 金幣 a day for petting a dog is not a lot, and it is also not a workout.
 * Converted at roughly the daily-login rate (see constants/dailyLogin.ts): a few 碎片 for a kind
 * gesture, which is what this interaction was always meant to be worth.
 */
const PET_REWARD_FRAGMENTS = 5;
const PET_REWARD_XP = 10;

/**
 * 島嶼秘寶 — the stone on the beach, found once.
 *
 * Also formerly 金幣 (500, a fifth of a whole daily-login round). Now 碎片, at a figure that keeps
 * it what it was: the single most generous thing on the island that is not exercise.
 */
export const TREASURE_REWARD_FRAGMENTS = 60;
export const TREASURE_REWARD_XP = 200;

/** What a grant attempt did. `refused` is a POLICY failure — see constants/rewards.ts. */
export type RewardGrantOutcome =
  | { ok: true }
  | { ok: false; reason: 'no-profile' | 'refused' | 'save-failed'; message?: string };

/**
 * A built grant: the fields to write, and what the reward actually came to after 功能卡 effects.
 *
 * `settled` carries BOTH numbers — see constants/rewardEffects.ts — so a caller can announce
 * 「基礎 40，雙倍後 80」 without recomputing anything, and a log line can say which card did it.
 */
export interface BuiltGrant {
  /** The balance/XP move, plus `utilityCards` when applying an effect consumed a use. */
  fields: Record<string, unknown>;
  settled: SettledReward;
  /** What is actually paid. Shorthand for the amount inside {@link settled}. */
  amount: number;
}

/**
 * The Firestore field map for one currency or XP grant, with the policy and the ACTIVE EFFECTS
 * already applied.
 *
 * This is the 獎勵計算層's one seam into the database (constants/rewardEffects.ts). Everything that
 * pays a currency in this game builds its write here — the standalone `grantReward` below, 摸摸寵物,
 * the offline 每日登入 claim, and the 健身 payout in context/useWorkoutRewards.ts — so 「雙倍金幣在
 * 哪一層乘上去」 has exactly one answer:
 *
 *   Base Reward → checkGrant (policy) → settleReward (active effects) → increment()
 *
 * The `effects` argument is REQUIRED rather than optional, and that is the point: a new pay-out path
 * cannot forget to apply the player's cards, because it cannot compile without saying something
 * about them. A caller that genuinely has none passes {@link NO_EFFECTS}.
 *
 * Returns `null` when the grant is refused, and says why in the console — a refused grant is a
 * programming mistake (a source paying a currency it may not), not a player-visible condition, so
 * it must be loud for a developer and invisible to a player.
 *
 * Note the ORDER: the policy is checked against the BASE grant. A card cannot make a source able to
 * pay a currency it is not allowed to pay, and a ×2 on a refused grant is still refused.
 */
export function buildCurrencyUpdate(grant: RewardGrant, effects: RewardEffectContext): BuiltGrant | null {
  const { reward } = grant;
  if (reward.kind !== 'currency' && reward.kind !== 'xp') return null;

  const verdict = checkGrant(grant);
  if (!verdict.ok) {
    console.error(`[economy] 獎勵被拒絕：${verdict.message}`, grant);
    return null;
  }

  const settled = settleReward(reward, effects);
  // The settlement changes an AMOUNT and never a kind, so the field to write is decided by the base
  // grant (already narrowed to currency-or-XP above) and only the number comes from the settlement.
  const amount =
    settled.reward.kind === 'item' || settled.reward.kind === 'utility-card' ? 0 : settled.reward.amount;
  const fields: Record<string, unknown> =
    reward.kind === 'xp'
      ? { currentXp: increment(amount) }
      : { [currencyFieldPath(reward.currency)]: increment(amount) };

  // A `uses`-based card is spent by the very grant it boosted, so its new state rides in the SAME
  // field map. A timed card (every card the game ships with today) consumes nothing and this is
  // absent, which keeps the ordinary write byte-for-byte what it always was.
  if (settled.cardsAfter) fields.utilityCards = settled.cardsAfter;

  if (settled.applied.length > 0) console.info(describeSettlement(settled));

  return { fields, settled, amount };
}

/**
 * The Firestore field map for one CHARGE — the mirror of {@link buildCurrencyUpdate}.
 *
 * No policy check, because there isn't one to make: {@link SOURCE_CURRENCY_POLICY} governs where
 * currency comes FROM, and any currency the player holds may be spent on anything that is for sale.
 * What this exists for is §16's other half — a charge written by hand is a charge that eventually
 * uses the wrong field path, or the wrong currency, or a stale read.
 *
 * `increment(-amount)` rather than `balance - amount`, and that is the substantive fix here: three
 * call sites used to write an absolute figure computed from a possibly-stale profile snapshot, so a
 * purchase that completed while a room-expansion dialog was open would be silently refunded by the
 * expansion's write. A relative decrement composes; an absolute one clobbers.
 *
 * Affordability is the CALLER's to check, before it commits to the rest of its write — this only
 * builds the field, and returns null for a nonsensical amount rather than writing an increment of 0.
 */
export function buildSpendUpdate(currency: CurrencyId, amount: number): Record<string, unknown> | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { [currencyFieldPath(currency)]: increment(-Math.floor(amount)) };
}

export function useEconomyActions(
  user: AuthUser | null,
  profile: UserProfile | null,
  /** Writes an accepted value straight into local state — see AppContext's applyProfilePatch. */
  applyProfilePatch: (updates: Partial<UserProfile>) => void,
) {
  /**
   * What the player has running right now, for the 獎勵計算層.
   *
   * Built per call rather than memoised, on purpose: an effect that expired thirty seconds ago must
   * not be applied by a grant that happens now, and a remembered `nowMs` is exactly how that would
   * happen. It is one object literal — there is nothing here worth caching.
   */
  const effectContext = (): RewardEffectContext => ({
    cards: profile?.utilityCards ?? null,
    nowMs: Date.now(),
  });

  /**
   * Grants one reward. The single currency/XP write path for the whole game.
   *
   * Order is policy → write → local patch, and nothing is reflected on screen until the save has
   * accepted it: this is a GRANT, and the one lie a reward UI must never tell is showing a number
   * that then rolls back. (That is the opposite of how the rest of this codebase writes — moving a
   * sofa is optimistic and rolls back — and deliberately so; see context/useWorkoutRewards.ts.)
   *
   * Item grants are not handled here. An item lands in the inventory in the same write as the
   * record that it was given (useWorkoutRewards), and splitting that apart to route it through this
   * function would trade atomicity for symmetry.
   *
   * NOTE for whoever is debugging a refusal: an `update` here is validated by firestore.rules'
   * `isValidUser(incoming())`, which runs against the WHOLE merged document and unconditionally
   * requires `userId`, `displayName`, `level` and `balanceGold`. A save missing any of those has
   * every update refused, not just this one — the button is the messenger, not the cause.
   */
  const grantReward = async (grant: RewardGrant): Promise<RewardGrantOutcome> => {
    if (!user || !profile) return { ok: false, reason: 'no-profile' };

    const verdict = checkGrant(grant);
    if (!verdict.ok) {
      console.error(`[economy] 獎勵被拒絕：${verdict.message}`, grant);
      return { ok: false, reason: 'refused', message: verdict.message };
    }

    const { reward } = grant;
    if (reward.kind === 'item' || reward.kind === 'utility-card') {
      // Deliberately unsupported — see the doc above. A 功能卡 is granted by
      // context/useUtilityCards.ts, which owns the cap and the bag, for the same reason an item is
      // granted beside the record that it was given. Reported rather than silently ignored.
      console.error('[economy] grantReward 不處理物品／功能卡發放，請走各自的原子寫入', grant);
      return { ok: false, reason: 'refused', message: 'item and card grants are not routed through grantReward' };
    }

    // The 獎勵計算層 — 功能卡 effects are applied here and nowhere else on this path.
    const built = buildCurrencyUpdate(grant, effectContext());
    // Unreachable in practice — the policy was already checked above and the kind is already
    // narrowed — but a null here must not become a silent no-op write.
    if (!built) return { ok: false, reason: 'refused', message: '獎勵無法建立寫入內容' };

    try {
      await updateDoc(doc(db, 'users', user.uid), built.fields);
    } catch (error) {
      console.error(`[economy] 獎勵沒有存檔成功：${describeGrant(grant)}`, error);
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return { ok: false, reason: 'save-failed' };
    }

    // The write is confirmed by the time we get here; reflecting it locally means the number on
    // screen moves even when the realtime listener is not the one delivering it. The figure patched
    // in is the SETTLED one, so a card's ×2 shows up in the HUD as the same number that was banked.
    const cardsAfter = built.settled.cardsAfter;
    if (reward.kind === 'xp') {
      applyProfilePatch({
        currentXp: (profile.currentXp ?? 0) + built.amount,
        ...(cardsAfter ? { utilityCards: cardsAfter } : {}),
      });
    } else {
      applyProfilePatch({
        ...currencyPatch(profile, reward.currency, getBalance(profile, reward.currency) + built.amount),
        ...(cardsAfter ? { utilityCards: cardsAfter } : {}),
      });
      // Haptics on 金幣 only. 碎片 arrive quietly on purpose — a buzz for every fragment from every
      // daily source is the phone equivalent of a card that glows.
      if (reward.currency === 'coins') vibrateGoldEarned();
    }
    return { ok: true };
  };

  /**
   * 管理員測試 — the +10K 金幣 / +1K XP buttons in TopBar, and their 碎片 sibling.
   *
   * They REPORT now, where they used to swallow the error into `console.error` and return. That
   * silence is the whole bug behind 「點不進去」: the button is an ordinary enabled `<button>` and
   * the click always landed, but when Firestore refused the write there was no vibration, no
   * number moving and no message — which is indistinguishable from a dead button.
   *
   * Both go through {@link grantReward} with `source: 'admin-test'`, which is the one source the
   * policy lets pay every currency. That is not a loophole around the rule — it is the rule being
   * explicit about the one caller that is allowed past it, and that caller is gated behind
   * 管理員測試模式 (constants/adminFeatures.ts) and invisible to players.
   */
  const addCurrency = async (currency: CurrencyId, amount: number): Promise<boolean> => {
    const result = await grantReward({
      reward: { kind: 'currency', currency, amount },
      source: 'admin-test',
      reason: '管理員測試補給',
    });
    return result.ok;
  };

  /** Back-compat name for the 金幣 quick button. */
  const addGold = (amount: number) => addCurrency('coins', amount);
  const addFragments = (amount: number) => addCurrency('fragments', amount);

  const addXp = async (amount: number): Promise<boolean> => {
    const result = await grantReward({
      reward: { kind: 'xp', amount },
      source: 'admin-test',
      reason: '管理員測試補給',
    });
    return result.ok;
  };

  /**
   * 管理員數值調整 — write an EXACT balance, rather than adding to the current one.
   *
   * The point of 管理員測試模式 is that a developer can put the save into whatever state a test
   * needs, and "add 10000" cannot express 「我要正好 0 金幣」 or 「我要剛好差 5 金幣買不起」. So the
   * quick buttons and these share one shape and differ only in what they send: `increment(n)`
   * versus the number itself.
   *
   * It does NOT go through `grantReward`, and that is deliberate: setting a value to zero is not a
   * grant, and forcing it through a path whose policy is about *earning* would mean either a fake
   * "reward" of a negative amount or a special case in the policy. Setting an exact figure is an
   * admin operation on the save, and it is written as one.
   *
   * Clamped rather than trusted, because a typed field can produce anything. A negative is refused
   * by firestore.rules (`balanceGold >= 0`), so an unclamped -50 would come back as 權限被拒 and
   * read as a broken button; the ceiling keeps the HUD's number formatting sane and sits far above
   * anything the game can reach. A non-number becomes 0 rather than writing `NaN`, which Firestore
   * accepts happily and every later `increment` then carries forward.
   */
  const setCurrency = async (currency: CurrencyId, value: number): Promise<boolean> => {
    if (!user || !profile) return false;
    const next = clampAdminValue(value);
    try {
      await updateDoc(doc(db, 'users', user.uid), { [currencyFieldPath(currency)]: next });
      applyProfilePatch(currencyPatch(profile, currency, next));
      if (currency === 'coins') vibrateGoldEarned();
      return true;
    } catch (error) {
      console.error(`[economy] 設定 ${CURRENCY_SPECS[currency].label} 失敗：`, error);
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return false;
    }
  };

  const setGold = (value: number) => setCurrency('coins', value);
  const setFragments = (value: number) => setCurrency('fragments', value);

  /**
   * 抽獎券 — 管理員測試模式 only, and the one balance in this file that is not a CurrencyId.
   *
   * Tickets live in their own top-level field (`raffleTickets`) rather than in the wallet, because
   * they are not a currency the shop prices anything in: they are minted by 多出來的碎片, sold as a
   * card (constants/items.ts), and spent at exactly one place. So these two go straight at the
   * field the way `setXp` goes straight at `currentXp`, instead of through `setCurrency`, which
   * would need a fake entry in constants/currency.ts to reach them.
   *
   * Both write an ABSOLUTE figure, including the "add" one — there is no policy to consult and no
   * concurrent writer to compose with (the wheel's own spend is a single write that reads and
   * writes in one go), and clamping the result is the whole point of the ceiling.
   */
  const setRaffleTickets = async (value: number): Promise<boolean> => {
    if (!user || !profile) return false;
    const next = clampAdminValue(value);
    try {
      await updateDoc(doc(db, 'users', user.uid), { raffleTickets: next });
      applyProfilePatch({ raffleTickets: next });
      return true;
    } catch (error) {
      console.error('[economy] 設定抽獎券失敗：', error);
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return false;
    }
  };

  const addRaffleTickets = (amount: number) =>
    setRaffleTickets(getRaffleTickets(profile) + Math.floor(amount));

  const setXp = async (value: number): Promise<boolean> => {
    if (!user || !profile) return false;
    const next = clampAdminValue(value);
    try {
      // 等級 is derived from this one number (utils/level.ts) and `level` is never written, so
      // setting XP is also how a tester puts the account on a chosen level — LV.n is (n-1)*100 XP.
      await updateDoc(doc(db, 'users', user.uid), { currentXp: next });
      applyProfilePatch({ currentXp: next });
      return true;
    } catch (error) {
      console.error('Set XP failed:', error);
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return false;
    }
  };

  /**
   * 摸摸寵物 — 碎片 and XP up to DAILY_PET_LIMIT times per day (resets at local midnight) so it
   * stays a cute, repeatable interaction without becoming a free infinite-currency loop.
   *
   * The daily counter and the payout are ONE write, so the limit cannot be raced: a second tap that
   * arrives before the first has saved reads the same `petCountToday`, but only one of the two
   * writes can be the one that lands last, and both carry the same incremented count. (The counter
   * is the guard; the payout rides on it.)
   */
  const petDog = async (): Promise<{ rewarded: boolean; remaining: number }> => {
    if (!user || !profile) return { rewarded: false, remaining: 0 };

    const today = new Date().toISOString().split('T')[0];
    const countToday = profile.lastPetDate === today ? (profile.petCountToday || 0) : 0;

    if (countToday >= DAILY_PET_LIMIT) {
      return { rewarded: false, remaining: 0 };
    }

    const payout = buildCurrencyUpdate(
      {
        reward: { kind: 'currency', currency: 'fragments', amount: PET_REWARD_FRAGMENTS },
        source: 'island-interaction',
        reason: '摸摸寵物',
      },
      effectContext(),
    );
    if (!payout) return { rewarded: false, remaining: DAILY_PET_LIMIT - countToday };

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        lastPetDate: today,
        petCountToday: countToday + 1,
        currentXp: increment(PET_REWARD_XP),
        ...payout.fields,
      });
      return { rewarded: true, remaining: DAILY_PET_LIMIT - (countToday + 1) };
    } catch (error) {
      console.error('Pet dog reward failed:', error);
      return { rewarded: false, remaining: DAILY_PET_LIMIT - countToday };
    }
  };

  /**
   * 島嶼秘寶 — the stone on the beach. Called by Three/IslandDecorations.tsx, which used to write
   * the payout itself.
   *
   * Here rather than there for the reason everything else in this file is: a 3D prop is not where a
   * grant belongs, and a grant with no recorded source is one nobody can account for later.
   */
  const claimIslandTreasure = async (): Promise<boolean> => {
    const paid = await grantReward({
      reward: { kind: 'currency', currency: 'fragments', amount: TREASURE_REWARD_FRAGMENTS },
      source: 'island-interaction',
      reason: '島嶼秘寶',
    });
    if (!paid.ok) return false;
    await grantReward({
      reward: { kind: 'xp', amount: TREASURE_REWARD_XP },
      source: 'island-interaction',
      reason: '島嶼秘寶',
    });
    return true;
  };

  /**
   * The placements, re-seated on the terrain of territory level `level` — as a patch to write in the
   * SAME update as the level change, or an empty one when nothing moved.
   *
   * The ground under every placement is a function of the territory level (constants/terrain.ts
   * scales the plateau and the beach by it), while a placement's height is a saved number. Changing
   * the level without this is how a pier built out over the sea ended up inside the new, larger
   * island — boards below the grass, walked across and through — and how a torch on the old beach
   * sank into the new plateau. See reseatIslandPlacements for the rule (it only ever lifts).
   *
   * One write rather than two, so there is never a saved state in which the island has grown and
   * what stands on it has not.
   */
  const reseatForTerritory = (level: number): { islandPlacements?: UserProfile['islandPlacements'] } => {
    // The same derivation every island view uses (Scene, Avatar, PlacementGhost, useIslandLife).
    const islandScale = 1 + (level - 1) * 0.4;
    const reseated = reseatIslandPlacements(profile?.islandPlacements || [], islandScale);
    return reseated ? { islandPlacements: reseated } : {};
  };

  const expandTerritory = async () => {
    if (!user || !profile) return;

    const territoryLevel = profile.territoryLevel || 1;
    const requiredXp = territoryLevel * 100; // Requirement: Level 1->2 needs 100 XP, 2->3 needs 200 XP, etc.

    if (profile.currentXp < requiredXp) {
      alert(`XP 不足！擴張到下一等級需要 ${requiredXp} XP (目前: ${profile.currentXp})`);
      return;
    }

    try {
      const profileRef = doc(db, 'users', user.uid);
      await updateDoc(profileRef, {
        territoryLevel: increment(1),
        ...reseatForTerritory(territoryLevel + 1),
      });
      vibrateTerritoryExpanded();
      playerBus.happyReactionCount = (playerBus.happyReactionCount || 0) + 1;
    } catch (error) {
      console.error('Territory expansion failed:', error);
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const shrinkTerritory = async () => {
    if (!user || !profile) return;

    const territoryLevel = profile.territoryLevel || 1;
    if (territoryLevel <= 1) {
      alert(`領土已縮減至最小規模！`);
      return;
    }

    try {
      const profileRef = doc(db, 'users', user.uid);
      await updateDoc(profileRef, {
        territoryLevel: increment(-1),
        ...reseatForTerritory(territoryLevel - 1),
      });
    } catch (error) {
      console.error('Territory shrink failed:', error);
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  /**
   * The board as the PROFILE has it — the same derivation DailyLoginPanel draws from, so the two
   * can never disagree about which day is claimable.
   *
   * The profile's copy is a mirror of the server's record, not a second source of truth: the server
   * owns `daily_login_claims`, and these three fields exist so the panel can render a board without
   * a round trip (and so an offline save has a board at all).
   */
  const readProfileBoard = (now: Date) => {
    const anchor = profile?.loginAnchorDate ?? civilDateAt(now);
    const cycle = resolveCycle(anchor, now);
    const isCurrent = profile?.loginCycleId === cycle.cycleId;
    const claimedDays = new Set(isCurrent ? profile?.loginClaimedDays ?? [] : []);
    return { anchor, cycle, claimedDays, squares: buildSquares(cycle, claimedDays, true) };
  };

  /** Records a day as collected on the profile without paying for it. For claims the server paid. */
  const mirrorClaimOnProfile = async (day: number) => {
    if (!user || !profile) return;
    const { anchor, cycle, claimedDays } = readProfileBoard(new Date());
    if (claimedDays.has(day)) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        loginAnchorDate: anchor,
        loginCycleId: cycle.cycleId,
        loginClaimedDays: [...claimedDays, day].sort((a, b) => a - b),
      });
    } catch (error) {
      // The reward is banked either way; a failed mirror costs the player nothing but a stale card
      // until the next load, so it must not turn a successful claim into a reported failure.
      console.error('Daily login mirror write failed:', error);
    }
  };

  /**
   * The offline/unconfigured path: decide and pay the claim locally.
   *
   * Every guard the server applies is applied here too, against the profile as saved — the day has
   * to be claimable, a 補簽 has to be affordable — because this is the only thing standing between
   * a double tap and a double payout when there is no server to arbitrate.
   *
   * ## One write, on purpose
   *
   * The payout, the 補簽 fee and the mark that the day was taken all land together or none of them
   * do — a payout without a mark pays twice, and a mark without a payout pays nothing. The payout
   * is built by {@link buildCurrencyUpdate}, so the source→currency policy is applied to it exactly
   * as it would be to a standalone grant: 每日登入 pays 金幣 here only because constants/rewards.ts
   * was deliberately edited to let it, and it still cannot pay anything that table does not name.
   *
   * What it does NOT pay is the rest of the prize. 商品碎片, 抽獎券, 功能卡, a product and a free
   * 輪盤 turn are granted by context/useDailyLoginPrize.ts, on both the server path and this one,
   * so there is exactly one implementation of 「這一天到底給了什麼」 rather than two that must agree.
   */
  const claimOnProfile = async (day: number, mode: 'free' | 'makeup'): Promise<DailyClaimOutcome> => {
    if (!user || !profile) {
      return { ok: false, code: 'unauthenticated', message: DAILY_LOGIN_MESSAGES.unauthenticated };
    }
    const { anchor, cycle, claimedDays, squares } = readProfileBoard(new Date());
    const square = squares[day - 1];
    if (!square) {
      return { ok: false, code: 'invalid_request', message: DAILY_LOGIN_MESSAGES.invalid_request };
    }
    if (!canClaim(square, mode)) {
      const code: DailyLoginErrorCode = square.state === 'claimed' ? 'already_claimed' : 'not_available_yet';
      return { ok: false, code, message: DAILY_LOGIN_MESSAGES[code] };
    }
    const spent = mode === 'makeup' ? makeupCostForDay(day) : 0;
    if (spent > getBalance(profile, 'coins')) {
      return { ok: false, code: 'insufficient_gold', message: DAILY_LOGIN_MESSAGES.insufficient_gold };
    }

    // Only the CURRENCY half, and only when the day has one: four of the seven days pay no money
    // at all (constants/dailyLogin.ts), and `buildCurrencyUpdate` refuses a grant of 0 as an
    // invalid amount — correctly, since a grant of nothing is a bug everywhere it is not this.
    const coins = square.prize.coins;
    const payout = coins > 0
      ? buildCurrencyUpdate(
          {
            reward: { kind: 'currency', currency: DAILY_LOGIN_CURRENCY, amount: coins },
            source: 'daily-login',
            reason: `第 ${day} 天（${mode}）`,
          },
          effectContext(),
        )
      : null;
    if (coins > 0 && !payout) {
      return { ok: false, code: 'save_failed', message: DAILY_LOGIN_MESSAGES.save_failed };
    }

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        loginAnchorDate: anchor,
        loginCycleId: cycle.cycleId,
        loginClaimedDays: [...claimedDays, day].sort((a, b) => a - b),
        ...(payout?.fields ?? {}),
        ...(spent > 0 ? { balanceGold: increment(-spent) } : {}),
      });
      // `payout.amount`, not `square.prize.coins`: the board says what the day is worth and the
      // settlement says what was actually banked, and with a 雙倍金幣券 running those are different
      // numbers. The reveal must announce the one that landed in the wallet.
      return {
        ok: true,
        day,
        quantity: payout?.amount ?? square.quantity,
        currency: DAILY_LOGIN_CURRENCY,
        spent,
      };
    } catch (error) {
      // `save_failed`, not `server_error`: nothing on this path talks to a server, and reporting
      // one sent the last round of debugging at the API instead of at the save. The most likely
      // cause of landing here is the write being REFUSED — see firestore.rules, whose update
      // whitelist has to name every key this write touches (`wallet` included).
      console.error('Daily login local claim failed:', error);
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      return { ok: false, code: 'save_failed', message: DAILY_LOGIN_MESSAGES.save_failed };
    }
  };

  const claimDailyReward = async (
    day: number,
    mode: 'free' | 'makeup' = 'free',
  ): Promise<DailyClaimOutcome> => {
    if (!user || !profile) {
      return { ok: false, code: 'unauthenticated', message: DAILY_LOGIN_MESSAGES.unauthenticated };
    }

    // Every decision below this line belongs to the server (src/server/dailyLoginApi.ts): which day
    // it is, whether this square is owed, what a 補簽 costs, and whether the wallet can pay it.
    //
    // This used to be a `updateDoc` from the browser, and it could not be made correct from here.
    // It read the claimed-days array, added a day and wrote the array back, so two tabs — or a
    // double-tap — both read the same array and both wrote a payout: last write wins, currency
    // minted twice. It also took the day from `new Date()`, which is the player's own clock.
    // Neither is fixable client-side; both are why this is now one authenticated call whose result
    // is the server's verdict.
    //
    // The idempotency key is made HERE, once per attempt, so that a retry of this same tap is
    // recognised as the same attempt rather than as a second claim.
    const idempotencyKey = newIdempotencyKey();

    try {
      const result = await claimDailyLogin(day, mode, idempotencyKey);
      // A replayed claim is still a success — it is the response to a request that did land — but it
      // has already been paid, so it must not be celebrated a second time or counted up again.
      if (result.replayed) {
        await mirrorClaimOnProfile(day);
        return { ok: false, code: 'already_claimed', message: DAILY_LOGIN_MESSAGES.already_claimed };
      }
      // The server banked the reward and recorded the claim in its own collection; the BOARD is
      // drawn from the profile (see DailyLoginPanel), so the same day has to be written there too
      // or the card the player just claimed stays 今日可領 until the next reload. The wallet is
      // deliberately not touched here — the server already paid it, and paying it twice is the one
      // mistake this whole feature was moved server-side to prevent.
      await mirrorClaimOnProfile(day);
      return {
        ok: true,
        day,
        quantity: result.granted_quantity,
        currency: DAILY_LOGIN_CURRENCY,
        spent: result.spent_gold,
      };
    } catch (error) {
      console.error('Daily login claim failed:', error);
      const code: DailyLoginErrorCode =
        error instanceof DailyLoginError ? error.code : 'server_error';

      // A VERDICT is obeyed; a NON-ANSWER is not. `already_claimed`, `insufficient_gold` and the
      // rest are the server deciding, and the player is told. These four are the server failing to
      // decide at all — no credentials configured (503), no route, no network, no reply — and a
      // player must not be locked out of a daily reward because a service they cannot see is down.
      //
      // The same applies to a local-only save (save/LocalSaveStore.ts): there is no Firebase
      // session, so there is no ID token, so the server can only ever answer `unauthenticated` for
      // a player who is legitimately playing offline.
      //
      // The fallback writes through `updateDoc`, which is the same shimmed path every other economy
      // action in this game already uses (lib/firebase.ts routes it to Firestore or to the local
      // save). It is no weaker than 購買 or 摸狗; it is simply not server-authoritative, which is
      // why it is a fallback and not the default.
      // `server_error` is deliberately NOT in this list. That code now only ever comes from this API
      // answering with a JSON error of its own (see lib/dailyLoginClient.ts) — the service is there
      // and it failed, which the player is told about rather than quietly paid around. An absent
      // service arrives as `not_configured`.
      const noVerdict = code === 'not_configured' || code === 'offline' || code === 'timeout';
      const offlineSession = code === 'unauthenticated' && user.isLocalOnly === true;
      if (noVerdict || offlineSession) return claimOnProfile(day, mode);

      return { ok: false, code, message: error instanceof DailyLoginError ? error.message : DAILY_LOGIN_MESSAGES.server_error };
    }
  };

  /**
   * 管理員測試 — re-opens the daily panel on demand.
   *
   * It used to bump `loginStreak` and pay out `50 + streak * 10` gold and XP on every press, which
   * made sense while the reward WAS that formula and the popup was only a receipt for it. Under the
   * seven-day round the panel is where a reward is taken, so a button that granted currency before
   * opening it would be paying twice — once behind the player's back and once in front of them.
   * What it does now is open the thing; whatever is claimable inside is claimable on its own terms.
   */
  const forceShowLoginBonus = async () => {
    if (!user || !profile) return;
    // Opens the panel and nothing else. It no longer previews today's amount either: what is
    // claimable is the SERVER's answer now (src/server/dailyLoginApi.ts), and a number computed
    // here from the saved profile would be this file guessing at it — which is exactly the
    // client-side authority the feature was moved off. The panel fetches the real board when it
    // opens; `gold: 0` is "nothing to announce", not "nothing is owed".
    publishLoginBonus({
      streak: profile.loginStreak || 0,
      gold: 0,
      xp: 0,
      isManual: true,
    });
  };

  return {
    grantReward,
    addGold,
    addFragments,
    addCurrency,
    addXp,
    setGold,
    setFragments,
    setCurrency,
    setXp,
    addRaffleTickets,
    setRaffleTickets,
    petDog,
    claimIslandTreasure,
    expandTerritory,
    shrinkTerritory,
    forceShowLoginBonus,
    claimDailyReward,
  };
}
