/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 貨幣 — what the player can hold, where each kind is stored, and how it is named on screen.
 *
 * This is the single declaration of the game's wallet. Nothing else in the app may decide that a
 * number "is gold", read `profile.balanceGold` to answer 「玩家有多少錢」, or invent a second place
 * to keep a balance. A screen asks {@link getBalance}; a grant or a charge goes through the economy
 * service (context/useEconomyActions.ts), which is the only writer.
 *
 * ## Two currencies, and they are NOT two flavours of the same thing
 *
 *   金幣 (coins)      earned by TRAINING, and by nothing else. Spent on the ordinary catalog.
 *   碎片 (fragments)  earned by everything that is NOT training — 每日登入, 輪盤, 活動, 任務,
 *                     摸摸寵物, 島嶼秘寶. A long-horizon collectible resource.
 *
 * The separation is the point, and it is enforced structurally rather than by convention: see
 * {@link constants/rewards.ts}'s source→currency policy, which refuses a coin grant from any source
 * that is not a workout. Making 碎片 「another kind of gold」 — spendable on the same shelf, granted
 * by the same rewards — would collapse the two back into one currency with two names, and the whole
 * reason 金幣 means anything is that the only way to get more is to exercise.
 *
 * ## Where a balance lives, and why the two are not stored the same way
 *
 * `coins` stays on the top-level `balanceGold` field it has always used. That field is load-bearing:
 * `firestore.rules`' `isValidUser` requires it UNCONDITIONALLY on every write, the daily-login server
 * transaction reads and increments it directly, and every existing save in the wild carries it.
 * Moving it into a map would be a migration of the one number a player would notice going missing,
 * bought for no player-visible gain — see docs/FIRESTORE_RULES.md on what a rules/shape mismatch
 * costs.
 *
 * Everything after coins lives in ONE nested map, `profile.wallet`. That is the same shape (and the
 * same reasoning) as `islandState` and `workoutRewards`: one key in `firestore.rules`, one entry in
 * the update whitelist, and a third currency later is a row in {@link CURRENCY_SPECS} rather than a
 * schema change plus a rules deploy. A bare `balanceFragments` field was the obvious shape and is
 * the one that needs a rules deploy per currency.
 *
 * The asymmetry is hidden here and nowhere else: every caller says `getBalance(profile, 'coins')`.
 */

import type { UserProfile } from '../types';

/**
 * The currencies that exist. Adding one is a member here plus a row in {@link CURRENCY_SPECS};
 * `Tickets`/`EventCurrency`/`PremiumCurrency` are named in the brief as possible futures and are
 * deliberately NOT pre-declared — a currency with no source and no sink is a promise the save
 * format has to keep.
 */
export type CurrencyId = 'coins' | 'fragments';

/** The ladder as an ORDER, for anything that iterates the wallet (the HUD, the admin panel). */
export const CURRENCY_IDS: readonly CurrencyId[] = ['coins', 'fragments'];

/** Where one currency's balance is kept in the profile. See the file doc for why there are two. */
export type CurrencyStorage =
  /** A top-level `UserProfile` field, e.g. `balanceGold`. */
  | { kind: 'profile-field'; field: 'balanceGold' }
  /** A key inside the `wallet` map, e.g. `wallet.fragments`. */
  | { kind: 'wallet-key'; key: keyof PlayerWallet };

export interface CurrencySpec {
  id: CurrencyId;
  /** What the player is shown. Never derived from the id. */
  label: string;
  /**
   * How this currency is EARNED, in one line, for the admin panel and for whoever reads this file
   * next. Not player-facing copy — the rule it describes is enforced in constants/rewards.ts.
   */
  sourceRule: string;
  storage: CurrencyStorage;
}

export const CURRENCY_SPECS: Record<CurrencyId, CurrencySpec> = {
  coins: {
    id: 'coins',
    label: '金幣',
    sourceRule: '主要來源是健身（workout）。唯一的例外是每日登入，見 constants/rewards.ts 的政策表。',
    storage: { kind: 'profile-field', field: 'balanceGold' },
  },
  fragments: {
    id: 'fragments',
    label: '碎片',
    sourceRule: '非健身型獎勵：輪盤、活動、任務、島上互動。每日登入已改發金幣與商品碎片。',
    storage: { kind: 'wallet-key', key: 'fragments' },
  },
};

/**
 * The non-coin half of the wallet.
 *
 * Every field optional and every absence meaning zero, which is what makes this safe to add to a
 * save that predates it: a player who has never been paid a 碎片 and a save written before 碎片
 * existed are the same state, and neither needs a migration.
 */
export interface PlayerWallet {
  fragments?: number;
}

/** A whole, non-negative number. A balance that is `NaN`, negative or fractional is read as 0. */
function sane(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * What the player holds of one currency. The ONE reader — a screen never touches `balanceGold`.
 *
 * Tolerant by construction: a missing profile, a missing field and a missing `wallet` map all read
 * as 0, because every one of them is a real state (loading, a pre-wallet save, a brand-new player)
 * and none of them is an error worth showing a player.
 */
export function getBalance(profile: UserProfile | null | undefined, currency: CurrencyId): number {
  if (!profile) return 0;
  const storage = CURRENCY_SPECS[currency].storage;
  if (storage.kind === 'profile-field') return sane(profile[storage.field]);
  return sane(profile.wallet?.[storage.key]);
}

/**
 * The Firestore update key a write to this currency has to use — `balanceGold` or `wallet.fragments`.
 *
 * A dot path, which both the real SDK and the local save shim (save/LocalSaveStore.ts) apply as a
 * nested write. Exported so the economy service can build an `increment()` update without
 * re-deriving the layout, and so nothing else has to know there are two layouts at all.
 */
export function currencyFieldPath(currency: CurrencyId): string {
  const storage = CURRENCY_SPECS[currency].storage;
  return storage.kind === 'profile-field' ? storage.field : `wallet.${storage.key}`;
}

/**
 * The profile patch that reflects an already-accepted currency write in local state.
 *
 * Separate from {@link currencyFieldPath} because the two shapes genuinely differ: Firestore takes
 * a dot path, while React state takes a `Partial<UserProfile>` with the whole `wallet` map rebuilt
 * (a patch of `{'wallet.fragments': n}` would land as a literal key). `next` is the new BALANCE, not
 * a delta — the caller has already decided what the number is.
 */
export function currencyPatch(
  profile: UserProfile | null | undefined,
  currency: CurrencyId,
  next: number,
): Partial<UserProfile> {
  const storage = CURRENCY_SPECS[currency].storage;
  if (storage.kind === 'profile-field') return { [storage.field]: next } as Partial<UserProfile>;
  return { wallet: { ...(profile?.wallet ?? {}), [storage.key]: next } };
}

/** `金幣` / `碎片`. The one place a currency is named for a player. */
export const currencyLabel = (currency: CurrencyId): string => CURRENCY_SPECS[currency].label;
