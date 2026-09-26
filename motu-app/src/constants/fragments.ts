/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { UserProfile } from '../types';
import { ALL_ITEMS, getItemById, type ItemDefinition } from './items';
import { isInChannel } from './distribution';
import { isStackableItem } from '../utils/inventory';

/**
 * 商品碎片 — the game's second way to own something, and the only one that is EARNED rather than
 * paid for.
 *
 * ## The one rule that shapes everything else
 *
 * A fragment belongs to exactly one product. There is no shared 通用碎片, no per-rarity pool and no
 * per-category pool, because every one of those turns「我還差多少」into a question the player cannot
 * answer by looking at the thing they want. A fragment stack is keyed by the item's own catalog id
 * ({@link UserProfile.itemFragments}), so 「珊瑚吊燈碎片」 is a real, distinct object in the save and
 * can never be spent on anything but 珊瑚吊燈.
 *
 * That also means this file never has to police mixing: the data model makes it impossible rather
 * than the code making it forbidden.
 *
 * ## Where they come from
 *
 *  - 運動結算 (components/FitnessView.tsx) — the everyday source, scaled by how much work was done.
 *  - 每日簽到 (components/UI/DailyLoginPanel.tsx) — the round's 主打商品, one item for the whole
 *    seven days so a week of logins adds up to something instead of scattering.
 *  - 幸運轉盤 (constants/luckyWheel.ts) — five of its ten wedges. It settles through the SAME pure
 *    functions the other two do ({@link settleFragmentGain}), and folds the result into its own
 *    single write because it also has to charge a 抽獎券 in the same breath — see
 *    context/useWheelActions.ts. Adding it moved no rule out of this file.
 *
 * ## Where they go
 *
 * {@link FRAGMENTS_TO_UNLOCK} of one item's fragments unlocks that item, free. A stack never grows
 * past that number: anything over the line is 多出來的碎片 and is settled by
 * {@link settleFragmentGain} into 抽獎券 instead, which is what stops a maxed-out item from
 * silently eating every drop it is handed. See {@link FRAGMENTS_PER_TICKET}.
 */

/** How many of an item's own fragments unlock it. The one number the whole feature is priced on. */
export const FRAGMENTS_TO_UNLOCK = 200;

/**
 * How many 多出來的碎片 make one 抽獎券.
 *
 * The overflow rate is deliberately coarse. Fragments over the line are a *consolation*, not a
 * second currency the player is meant to farm — if the rate were fine enough to make maxing an item
 * out and then feeding it profitable, the unlock itself would stop being the thing worth walking to.
 *
 * It does not divide evenly, so the remainder is CARRIED on the profile
 * ({@link UserProfile.raffleTicketProgress}) rather than dropped. Without the carry, five overflow
 * fragments would pay nothing and a player who overflows five at a time would be paid nothing ever,
 * while watching the number go up — the carry is what makes 「多出來的碎片會變成抽獎券」 true for
 * every amount instead of only for multiples of 20.
 */
export const FRAGMENTS_PER_TICKET = 20;

/**
 * 新玩家（和每一個在抽獎券存在之前就開好的存檔）拿到的第一張券。
 *
 * 一張，不是十張：它要買的是「知道轉盤是什麼」，不是一段免費的遊玩。轉一次會看到整個獎品階梯、
 * 拿到一份碎片，然後下一張券要自己來 —— 這正是要讓玩家知道的那件事（多出來的碎片會變成券，
 * 商店也買得到）。
 *
 * 發放的條件是「存檔裡完全沒有 `raffleTickets` 這個欄位」而不是一個新的旗標欄位（見
 * context/AppContext.tsx 的載入修補）。這樣寫有兩個好處：不必為了一次性的發放在
 * firestore.rules 上開一個新欄位（新欄位在部署到正式規則之前一律寫入失敗，見
 * docs/FIRESTORE_RULES.md），而且它天生只會發生一次 —— 寫完之後欄位就存在了。
 */
export const WELCOME_RAFFLE_TICKETS = 1;

/**
 * Whether this catalog entry has a fragment of its own.
 *
 * Everything the player buys with gold in the ordinary 商店 does. The exclusions are not
 * categories — they are the things that are not *a purchase you can make on that shelf*:
 *
 *  - an 經驗值 item (`xpUnlock`, utils/unlock.ts) is already earned rather than bought, and giving it
 *    a second earning track would mean two progress bars racing for the same card;
 *  - a `price: 0` entry is not on sale at all (毛胚屋 — see constants/houseStyles.ts), so there is
 *    nothing for 200 fragments to stand in for;
 *  - anything the ordinary shop does not stock (constants/distribution.ts). 商品碎片 are collected
 *    ON a shop card and redeemed FROM one: the meter, the 免費解鎖 button and the whole flow live
 *    on `PurchaseDialog`. A 限時商店 exclusive has no such card, so fragments collected toward it
 *    could never be spent — a bar filling toward an unlock the player cannot reach. Better that
 *    they are never minted. (Whatever a save already holds is not lost: buying that accessory in
 *    the 限時商店 settles the stranded stack into 抽獎券 through the same
 *    `fragmentPatchForPurchase` the ordinary shop uses — see context/useLimitedShop.ts.)
 */
export function isFragmentItem(item: ItemDefinition | string | null | undefined): boolean {
  const def = typeof item === 'string' ? getItemById(item) : item;
  if (!def) return false;
  if (!isInChannel(def, 'main-shop')) return false;
  // 抽獎券（`grantsTickets`，見 constants/items.ts）是第三種例外，而且是最不能少的一種：它買到
  // 的不是一個物件而是一個餘額，所以「集滿 200 個碎片免費解鎖它」會在背包裡放進一筆什麼都不做
  // 的資料 —— 而且那是一個迴圈，多出來的碎片本來就會自動變成券。
  if (def.grantsTickets) return false;
  return !def.xpUnlock && def.price > 0;
}

/**
 * Whether owning one of these leaves the fragment stack ALIVE.
 *
 * This is the split the shop card was missing. 「有沒有擁有」 and 「還要不要繼續收集碎片」 used to be
 * the same boolean in four different places — {@link canUnlockWithFragments} refused on `owned`,
 * the meter hid itself on `owned`, the purchase dialog hid the meter on `ownedCount > 0`, and
 * `fragmentPatchForPurchase` DELETED the stack on any purchase at all. For a hat all four are
 * right: there is exactly one of it, so once it is in the wardrobe its fragments can never buy
 * anything again.
 *
 * For a sofa all four are wrong. A placeable STACKS — one inventory entry per copy bought
 * (utils/inventory.ts) — and 特殊卡牌 stack the same way, so 「已擁有」 on those two kinds means
 * 「你有一件」, not 「這條路結束了」. The fragments a player is holding are still valid for the NEXT
 * one. Hiding the bar told them otherwise, and deleting the stack then made it true.
 *
 * Delegates to {@link isStackableItem} rather than re-deriving 「可不可以再買一件」 from the category:
 * that question already has exactly one answer in this codebase, and a second copy of it is free to
 * drift. Note it takes an ITEM and never a profile — this file still does not read ownership (see
 * {@link canUnlockWithFragments}); it only asks what KIND of thing the item is.
 */
export function isRepeatableFragmentItem(item: ItemDefinition | string | null | undefined): boolean {
  const def = typeof item === 'string' ? getItemById(item) : item;
  if (!def) return false;
  return isFragmentItem(def) && isStackableItem(def.id);
}

/**
 * Whether this item is still collecting fragments — the question every progress surface should be
 * asking instead of 「已擁有嗎」.
 *
 * Yes for an item not yet owned, and yes for an owned one that can be bought again. Ownership is
 * passed in for the same reason it is passed to {@link canUnlockWithFragments}: this file has no
 * business knowing how utils/inventory.ts counts copies.
 *
 * It deliberately does NOT cover the leftover-stack case — an own-once item that somehow still holds
 * fragments. That is the meter's own concern, because a stack which should not exist is a save to be
 * reported, not a state to design for.
 */
export function collectsFragments(itemId: string, owned: boolean): boolean {
  if (!isFragmentItem(itemId)) return false;
  return !owned || isRepeatableFragmentItem(itemId);
}

/**
 * Every item that has a fragment, in catalog order.
 *
 * This is the drop pool for every source. Computed once: `ALL_ITEMS` is a module-level constant and
 * re-filtering it per workout would be re-deriving the same list a few hundred times a session.
 */
export const FRAGMENT_ITEMS: readonly ItemDefinition[] = ALL_ITEMS.filter(isFragmentItem);

/** The fragment's own name, in the player's words: 「珊瑚吊燈碎片」. */
export function fragmentName(item: ItemDefinition | string | null | undefined): string {
  const def = typeof item === 'string' ? getItemById(item) : item;
  return def ? `${def.name}碎片` : '商品碎片';
}

/** How many of that item's fragments the save is holding. */
export function getFragmentCount(
  profile: UserProfile | null | undefined,
  itemId: string,
): number {
  const stored = profile?.itemFragments?.[itemId];
  return typeof stored === 'number' && Number.isFinite(stored) ? Math.max(0, Math.floor(stored)) : 0;
}

/** How many more are needed before {@link FRAGMENTS_TO_UNLOCK} is reached. 0 once it is. */
export function getFragmentsRemaining(
  profile: UserProfile | null | undefined,
  itemId: string,
): number {
  return Math.max(0, FRAGMENTS_TO_UNLOCK - getFragmentCount(profile, itemId));
}

/** Progress toward the unlock as 0–1 — the fill of the bar on the shop card. */
export function getFragmentProgress(
  profile: UserProfile | null | undefined,
  itemId: string,
): number {
  return Math.min(1, getFragmentCount(profile, itemId) / FRAGMENTS_TO_UNLOCK);
}

/**
 * Whether the fragment route is open on this item right now: it has a fragment, the stack is full,
 * and it is still collecting ({@link collectsFragments}).
 *
 * That last clause is the behaviour change. This used to be a flat `!owned`, so a player who filled
 * a second 200 toward a sofa they already owned was shown a full bar with no way to spend it. A
 * repeatable item's fragments buy the NEXT copy.
 *
 * Ownership is passed in rather than read here, so this file never has to know about
 * utils/inventory.ts's stacking rules — see the call in context/useFragmentActions.ts.
 */
export function canUnlockWithFragments(
  profile: UserProfile | null | undefined,
  itemId: string,
  owned: boolean,
): boolean {
  return collectsFragments(itemId, owned) && getFragmentCount(profile, itemId) >= FRAGMENTS_TO_UNLOCK;
}

/** 抽獎券 in hand. What the 幸運轉盤 charges one of per spin (constants/luckyWheel.ts). */
export function getRaffleTickets(profile: UserProfile | null | undefined): number {
  const held = profile?.raffleTickets;
  return typeof held === 'number' && Number.isFinite(held) ? Math.max(0, Math.floor(held)) : 0;
}

/** Overflow fragments already banked toward the next ticket, 0…{@link FRAGMENTS_PER_TICKET}-1. */
export function getTicketProgress(profile: UserProfile | null | undefined): number {
  const carry = profile?.raffleTicketProgress;
  const value = typeof carry === 'number' && Number.isFinite(carry) ? Math.max(0, Math.floor(carry)) : 0;
  return value % FRAGMENTS_PER_TICKET;
}

/**
 * Whether 多餘碎片轉換成抽獎券 is on for this save.
 *
 * Defaults to ON for a profile that predates the setting — `undefined` has to mean *something*, and
 * the alternative is a player whose overflow is silently thrown away by a switch they have never
 * seen. See {@link settleFragmentGain} for what OFF actually does.
 */
export function isOverflowConversionEnabled(
  settings: { fragmentOverflowToTickets?: boolean } | null | undefined,
): boolean {
  return settings?.fragmentOverflowToTickets !== false;
}

/**
 * What one grant of fragments actually does to the save — the whole overflow rule, as a pure
 * function.
 *
 * It is pure and it is in this file rather than inside the write path because it is the piece every
 * surface has to agree on: the settlement screen previews it before the write, the daily panel
 * announces its result after the write, and the shop card renders what it left behind. Three
 * screens re-deriving 「200 減掉現有的，剩下的除以 20」 is three chances to be off by one.
 *
 * `convert: false` (the setting turned off) does not bank the overflow somewhere else — it drops it.
 * That is the honest reading of turning the conversion off, and it is why the setting's copy says so
 * outright rather than describing itself as a preference.
 */
export interface FragmentSettlement {
  /** The item's stack after the grant. Never above {@link FRAGMENTS_TO_UNLOCK}. */
  stored: number;
  /** How many of the incoming fragments actually landed on the item. */
  kept: number;
  /** How many had nowhere to go — the 多出來的碎片. */
  overflow: number;
  /** Whole 抽獎券 minted from that overflow. 0 when the conversion is off. */
  tickets: number;
  /** The fraction of a ticket left over, to be carried on the profile. */
  carry: number;
}

export function settleFragmentGain({
  current,
  amount,
  carry = 0,
  convert = true,
}: {
  /** The item's stack before this grant. */
  current: number;
  /** How many fragments are being granted. */
  amount: number;
  /** {@link getTicketProgress} — overflow already banked toward the next ticket. */
  carry?: number;
  /** {@link isOverflowConversionEnabled}. */
  convert?: boolean;
}): FragmentSettlement {
  const held = Math.max(0, Math.floor(current));
  const incoming = Math.max(0, Math.floor(amount));
  const kept = Math.min(incoming, Math.max(0, FRAGMENTS_TO_UNLOCK - held));
  const overflow = incoming - kept;

  if (!convert || overflow === 0) {
    return { stored: held + kept, kept, overflow, tickets: 0, carry: carry % FRAGMENTS_PER_TICKET };
  }

  const pool = (carry % FRAGMENTS_PER_TICKET) + overflow;
  return {
    stored: held + kept,
    kept,
    overflow,
    tickets: Math.floor(pool / FRAGMENTS_PER_TICKET),
    carry: pool % FRAGMENTS_PER_TICKET,
  };
}

/**
 * What a whole stack is worth when the item is bought with gold instead.
 *
 * The second half of 「多出來的碎片」, and the one that is easy to miss: a player who was 180/200 of
 * the way to a lamp and then simply buys the lamp has 180 fragments that can never unlock anything
 * again, because the only thing they were ever valid for is now owned. Left alone they would sit in
 * the save forever as a number the player cannot act on. This converts the lot at the same rate the
 * overflow uses, so the two paths to a dead fragment pay the same.
 */
export function settleFragmentsOnPurchase({
  stored,
  carry = 0,
  convert = true,
}: {
  stored: number;
  carry?: number;
  convert?: boolean;
}): { tickets: number; carry: number; converted: number } {
  const held = Math.max(0, Math.floor(stored));
  if (!convert || held === 0) return { tickets: 0, carry: carry % FRAGMENTS_PER_TICKET, converted: 0 };
  const pool = (carry % FRAGMENTS_PER_TICKET) + held;
  return {
    tickets: Math.floor(pool / FRAGMENTS_PER_TICKET),
    carry: pool % FRAGMENTS_PER_TICKET,
    converted: held,
  };
}

// --- Where a drop lands ------------------------------------------------------

/** One grant, of one item's fragments. The shape every source hands to the write path. */
export interface FragmentGrant {
  itemId: string;
  amount: number;
}

/**
 * ## 每日登入的碎片曾經住在這裡 (2026-09-17)
 *
 * There used to be a `featuredFragmentItem(cycleId)` and a `DAILY_FRAGMENT_LADDER` here: one 主打
 * 商品 per round, and a seven-step ladder of how many of its fragments each day paid. The round no
 * longer works that way — every day is now its own draw and a fragment day picks its own item from
 * the 普通／稀有 shelf — so both moved to constants/dailyLoginPrizes.ts, which is where the round's
 * prizes live. Nothing about the fragment RULES moved with them: the cap, the overflow conversion
 * and the carry are still the pure functions above, and the new roller calls them exactly as the
 * old one did.
 *
 * The seeded pick they were built on is in constants/seed.ts now, shared with the wheel and the
 * 限時商店 rotation rather than hand-rolled here a second time.
 */

/**
 * What a finished workout pays in fragments, from the reps counted.
 *
 * Floored rather than proportional-all-the-way-down so a short session is still worth something, and
 * capped so a very long one cannot outpace the daily ladder — 運動 is the steady source, not the
 * fast one.
 */
export const WORKOUT_FRAGMENT_MIN = 3;
export const WORKOUT_FRAGMENT_MAX = 40;

export function fragmentsForWorkout(reps: number): number {
  const counted = Math.max(0, Math.floor(reps));
  if (counted === 0) return 0;
  return Math.min(WORKOUT_FRAGMENT_MAX, Math.max(WORKOUT_FRAGMENT_MIN, Math.floor(counted * 0.6)));
}

/**
 * Which item a workout's fragments are for.
 *
 * Weighted toward what is still collectible and already started, in that order:
 *
 *  1. a stack that is part-way there and still collecting — finishing something the player can see
 *     themselves finishing is the whole appeal of a fragment;
 *  2. any item not yet owned, so the pool keeps opening new ones;
 *  3. anything still collecting, once everything is owned — which for a stackable item means a
 *     second copy, a real reward rather than a consolation;
 *  4. anything at all, so the fragments are never worth nothing: they settle into 抽獎券 on arrival
 *     (see {@link settleFragmentGain}).
 *
 * ## Why tier 1 is no longer 「未擁有 AND 收集中」
 *
 * It used to filter on `!isOwned` at the top, which had a consequence the shop card then blamed on
 * the UI: an owned-but-repeatable item could not receive a fragment from the everyday source, so a
 * bar drawn for it would have been a bar that could never move. Drawing the bar (the point of
 * {@link collectsFragments}) and being able to fill it are the same feature — fixing one without
 * the other just moves the lie from 「進度不見了」 to 「進度不會動」.
 *
 * `random` is injected rather than called here so a caller (or a test) can make the roll
 * deterministic without stubbing a global.
 */
export function rollWorkoutFragmentItem(
  profile: UserProfile | null | undefined,
  isOwned: (itemId: string) => boolean,
  random: () => number = Math.random,
): ItemDefinition | null {
  if (FRAGMENT_ITEMS.length === 0) return null;

  const collecting = FRAGMENT_ITEMS.filter(item => collectsFragments(item.id, isOwned(item.id)));
  const started = collecting.filter(item => {
    const held = getFragmentCount(profile, item.id);
    return held > 0 && held < FRAGMENTS_TO_UNLOCK;
  });
  // Something brand new still outranks a second copy of something owned, so an unowned item is its
  // own tier rather than being folded into `collecting`.
  const fresh = collecting.filter(item => !isOwned(item.id));

  // 65% onto a stack already going, when there is one. Not 100%: a player who has one part-finished
  // item would otherwise never be shown a second one, and the pool would close behind them.
  const pool = started.length > 0 && random() < 0.65
    ? started
    : fresh.length > 0
      ? fresh
      : collecting.length > 0
        ? collecting
        : FRAGMENT_ITEMS;

  return pool[Math.floor(random() * pool.length) % pool.length];
}
