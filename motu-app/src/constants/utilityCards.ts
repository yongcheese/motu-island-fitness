/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 功能卡 — what a card IS, what it does when it is used, and how many of them a player holds.
 *
 * A 功能卡 is not a 家具, a 衣服, a 配件 or a 特殊飾品. Those are all things the player OWNS and
 * puts on or puts down; a card is something the player SPENDS, and what it buys is a change to how
 * the rest of the game pays out for a while. That difference is why it does not live in
 * constants/items.ts: an item has a `shopCategory`, a placement scope and a stock rule, and a card
 * has none of the three — it has an effect, a duration and a count.
 *
 * This file is data and pure rules only. No React, no Firestore, and no 雙倍金幣 anywhere except as
 * one row of {@link UTILITY_CARDS}. The write half is context/useUtilityCards.ts; the calculation
 * half — 「這張卡怎麼改變獎勵」 — is constants/rewardEffects.ts, deliberately a separate file
 * because it is the layer EVERY reward source passes through, and no reward source should have to
 * import a card catalog in order to be paid.
 *
 * ## Adding the second card is a row here
 *
 *   1. a member of {@link UtilityCardId}
 *   2. a row of {@link UTILITY_CARDS} — name, effect, duration, rarity, icon, stacking, cap
 *   3. wherever it may be obtained: a product in constants/limitedShop.ts, a slot in
 *      constants/wheelRewards.ts, or both
 *
 * That is the whole list. Nothing switches on a card id: not the inventory, not the use flow, not
 * the reward calculation, not the shop, not the UI. If a change ever seems to need
 * `if (cardId === …)`, the thing it wants is a FIELD on the definition instead.
 *
 * ## Effects are declared, never coded per card
 *
 * {@link UtilityEffect} is a small union of effect SHAPES — multiply a currency, multiply 經驗值 —
 * and a card names one of them with its own numbers. So 「碎片 ×1.5」 and 「經驗值 ×2」 are already
 * expressible without touching a line of the resolver, and a genuinely new SHAPE (an extra draw, a
 * flat bonus) is one member here plus one branch in constants/rewardEffects.ts. What must never
 * happen is a card reaching into a system of its own: the double-coin card does not know that 健身
 * exists, and 健身 does not know the card exists.
 *
 * ## The clock is the player's, and that is a prototype decision
 *
 * A timed effect expires against `Date.now()` on the device. There is no server that can arbitrate
 * that today, and pretending otherwise (§18 of the brief) would be worse than saying so: a player
 * who moves their clock can extend an effect. When there is a service to ask, the one thing that
 * changes is where `nowMs` comes from — every function here already takes it as an argument rather
 * than reading the clock itself, which is also what makes them testable.
 */

import type { CurrencyId } from './currency';
import type { Rarity } from './rarity';

// --- What a card can do ------------------------------------------------------

/**
 * The effect SHAPES the game knows how to apply. Both are implemented in
 * constants/rewardEffects.ts — this union deliberately contains no member that nothing can honour.
 *
 * `currency-multiplier` covers 雙倍金幣 and 碎片加成 with the same three lines, because 「哪一種
 * 貨幣」 is a field rather than a second effect kind.
 */
export type UtilityEffect =
  /** Multiplies one currency on every reward paid while it is live. */
  | { kind: 'currency-multiplier'; currency: CurrencyId; multiplier: number }
  /** Multiplies 經驗值. Not a currency (it is never spent), so it is its own shape. */
  | { kind: 'xp-multiplier'; multiplier: number };

export type UtilityEffectKind = UtilityEffect['kind'];

/** What the effect is called on screen. Never derived from the kind id. */
export const UTILITY_EFFECT_LABELS: Record<UtilityEffectKind, string> = {
  'currency-multiplier': '獎勵加成',
  'xp-multiplier': '經驗加成',
};

/**
 * How long one activation lasts.
 *
 * Two shapes rather than one, because the brief explicitly refuses to assume: a card can be 「接下
 * 來 N 分鐘」 or 「接下來 N 次獎勵」, and which one a card is belongs to the card, not to the code
 * that applies it. Both are honoured by the same resolver — a `uses` effect is consumed inside the
 * SAME write as the reward it boosted (see constants/rewardEffects.ts), which is what stops a
 * failed save from spending a use and paying nothing for it.
 */
export type UtilityCardDuration =
  | { kind: 'timed'; seconds: number }
  | { kind: 'uses'; count: number };

/**
 * What happens when a card is used while one of its own activations is already running.
 *
 * `reject` keeps the card in the bag and tells the player, which is the honest default for a timed
 * buff — a second activation whose effect is invisible is a card silently thrown away. `extend`
 * adds the new duration onto the running one. Neither of them is 「stack the multipliers」: how two
 * DIFFERENT effects combine is a property of the calculation layer and is capped there, not a
 * per-card setting that would let one card quietly re-decide the ceiling.
 */
export type UtilityCardStacking = 'reject' | 'extend';

/**
 * Where a card can legitimately come from.
 *
 * Declared on the card so the UI can answer 「這張卡要去哪裡拿」 without crawling every shop table,
 * and cross-checked against those tables by `npm run test:utility-cards` — so it cannot drift into
 * a promise the game does not keep.
 */
export type UtilityCardChannel = 'limited-shop' | 'wheel' | 'daily-login';

export const UTILITY_CARD_CHANNEL_LABELS: Record<UtilityCardChannel, string> = {
  'limited-shop': '限時商店',
  wheel: '輪盤',
  'daily-login': '每日登入',
};

/** The glyph a card is drawn with. A lucide name, resolved by components/UI/UtilityCard.tsx. */
export type UtilityCardIconName = 'Coins' | 'Sparkles' | 'Zap';

/**
 * Every card in the game. One member per card, and the id is also the key it is stored under.
 *
 * Deliberately a hand-written union rather than `string`: a card id that does not exist should be a
 * compile error at the shop table or the wheel table that names it, not a mystery empty tile.
 */
export type UtilityCardId = 'double-coin';

export interface UtilityCardDefinition {
  id: UtilityCardId;
  name: string;
  /** The full line, for the card back and the confirmation dialog. */
  description: string;
  /**
   * The effect in one short phrase — 「金幣獲得 ×2」. Written rather than generated: a sentence
   * built from `${multiplier}×${currency}` reads like a spreadsheet, and this is the line the
   * player actually reads on a small tile.
   */
  effectSummary: string;
  effect: UtilityEffect;
  duration: UtilityCardDuration;
  /**
   * 稀有度 — the same ladder every item is graded on (constants/rarity.ts), and required for the
   * same reason it is required there: a card without a tier is one that ships looking deliberate
   * and meaning nothing. It drives the tile's frame and any reward pool's filters.
   */
  rarity: Rarity;
  iconName: UtilityCardIconName;
  stacking: UtilityCardStacking;
  /**
   * The most copies one account may hold.
   *
   * A cap rather than an infinity, because every grant path (a purchase, a wheel drop) tops out
   * here rather than each one inventing its own limit — and because an unbounded count is how a
   * bug in a future drop table turns into a permanent economy.
   */
  maxOwned: number;
  channels: readonly UtilityCardChannel[];
}

/**
 * 雙倍金幣券 — the first 功能卡.
 *
 * ## The two numbers that are a design decision, not an implementation detail
 *
 * **`duration.seconds` (30 分鐘).** The brief refuses to assume a duration, so this is a stated
 * default and not a discovered constant: 金幣 comes only from 健身, and 30 minutes is about one
 * training session with room around it — long enough that a player who activates the card and then
 * warms up is not robbed, short enough that it cannot be left running across a whole day of
 * workouts. Changing it to 「接下來一次健身」 is `{ kind: 'uses', count: 1 }` on this one line, and
 * nothing else in the game changes.
 *
 * **The price is NOT here.** What a card costs belongs to whatever is selling it — see
 * constants/limitedShop.ts, where this same card is listed at a 碎片 price (the ordinary way to get
 * one) and at a deliberately steep 金幣 price (the conversion §11 asks for). A price on the card
 * definition would be a price every future shelf had to obey.
 *
 * `stacking: 'reject'` because the effect is invisible: with a timed multiplier already running, a
 * second activation would consume a card for nothing the player could see. They keep it instead.
 */
export const UTILITY_CARDS: Record<UtilityCardId, UtilityCardDefinition> = {
  'double-coin': {
    id: 'double-coin',
    name: '雙倍金幣券',
    description:
      '使用後的一段時間內，健身結算獲得的金幣加倍。金幣只能靠運動賺取，所以這張券真正加倍的是你流的汗。',
    effectSummary: '金幣獲得 ×2',
    effect: { kind: 'currency-multiplier', currency: 'coins', multiplier: 2 },
    duration: { kind: 'timed', seconds: 30 * 60 },
    rarity: 'rare',
    iconName: 'Coins',
    stacking: 'reject',
    maxOwned: 99,
    channels: ['limited-shop', 'wheel', 'daily-login'],
  },
};

export const ALL_UTILITY_CARDS: readonly UtilityCardDefinition[] = Object.values(UTILITY_CARDS);

export const UTILITY_CARD_IDS: readonly UtilityCardId[] = ALL_UTILITY_CARDS.map((card) => card.id);

export function isUtilityCardId(id: string | null | undefined): id is UtilityCardId {
  return !!id && Object.prototype.hasOwnProperty.call(UTILITY_CARDS, id);
}

/** The definition, or null for an id that no longer exists. Never throws — see {@link isEffectLive}. */
export function getUtilityCard(id: string | null | undefined): UtilityCardDefinition | null {
  return isUtilityCardId(id) ? UTILITY_CARDS[id] : null;
}

/** 「持續 30 分鐘」/「接下來 3 次獎勵」 — the duration in the player's words. */
export function describeDuration(duration: UtilityCardDuration): string {
  if (duration.kind === 'uses') return `接下來 ${duration.count} 次獎勵`;
  const minutes = Math.round(duration.seconds / 60);
  if (minutes >= 60 && minutes % 60 === 0) return `持續 ${minutes / 60} 小時`;
  return `持續 ${minutes} 分鐘`;
}

// --- What the save holds -----------------------------------------------------

/**
 * One running effect.
 *
 * It stores WHICH CARD produced it and never a copy of the effect itself, so re-balancing a card
 * changes what a live activation does rather than leaving old activations paying the old numbers —
 * and so a card removed from the catalog leaves an activation that resolves to nothing instead of
 * one that keeps paying from a definition nobody can find.
 */
export interface ActiveUtilityEffect {
  /** Unique per activation, so two copies of one card in flight are distinguishable. */
  activationId: string;
  cardId: UtilityCardId;
  /** ISO instant it was used. */
  activatedAt: string;
  /** ISO expiry — present for a `timed` card, absent for a `uses` one. */
  expiresAt?: string;
  /** Remaining applications — present for a `uses` card, absent for a `timed` one. */
  usesLeft?: number;
}

/**
 * 功能卡 state on the player's profile.
 *
 * ONE nested map, for exactly the reason `workoutRewards` and `islandState` are one (see types.ts):
 * it is one clause in firestore.rules and one entry in each update whitelist, so the second card —
 * and the first card whose effect needs a new field — is a change here and not a rules deploy.
 *
 * Absent on every save written before the feature, which is correctly indistinguishable from a
 * player who has never been given a card: neither holds one.
 */
export interface UtilityCardState {
  /** How many of each card is in the bag. A count of 0 is pruned rather than stored. */
  owned?: Partial<Record<UtilityCardId, number>>;
  /** Effects currently running. Expired entries are swept on the next write, not on read. */
  active?: ActiveUtilityEffect[];
  /** Lifetime uses per card. Not a rule — the readout behind 「已使用」 and the admin panel. */
  usedTotal?: Partial<Record<UtilityCardId, number>>;
}

export const EMPTY_UTILITY_STATE: UtilityCardState = {};

/** A whole, non-negative count. Anything else — NaN, negative, fractional — reads as none. */
function sane(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function getOwnedCardCount(
  state: UtilityCardState | null | undefined,
  cardId: UtilityCardId,
): number {
  return sane(state?.owned?.[cardId]);
}

export function getUsedTotal(
  state: UtilityCardState | null | undefined,
  cardId: UtilityCardId,
): number {
  return sane(state?.usedTotal?.[cardId]);
}

/** Every card the player holds at least one of, in catalog order. For the 功能卡 bag. */
export function getOwnedCards(
  state: UtilityCardState | null | undefined,
): { card: UtilityCardDefinition; count: number }[] {
  return ALL_UTILITY_CARDS
    .map((card) => ({ card, count: getOwnedCardCount(state, card.id) }))
    .filter((entry) => entry.count > 0);
}

// --- Live effects ------------------------------------------------------------

/** Whether one activation is still paying out at `nowMs`. */
export function isEffectLive(effect: ActiveUtilityEffect, nowMs: number): boolean {
  if (!getUtilityCard(effect.cardId)) return false;
  if (typeof effect.usesLeft === 'number') return effect.usesLeft > 0;
  if (effect.expiresAt) return Date.parse(effect.expiresAt) > nowMs;
  // Neither bound present: an activation that can never end is refused rather than honoured, which
  // is the safe direction — a corrupt record cannot become a permanent multiplier.
  return false;
}

/** Milliseconds left on a timed effect, or null for a uses-based one (and for a dead one). */
export function remainingMs(effect: ActiveUtilityEffect, nowMs: number): number | null {
  if (!effect.expiresAt) return null;
  const left = Date.parse(effect.expiresAt) - nowMs;
  return left > 0 ? left : null;
}

/** The effects running right now. Dead ones are filtered out but not written back — see below. */
export function activeEffects(
  state: UtilityCardState | null | undefined,
  nowMs: number,
): ActiveUtilityEffect[] {
  return (state?.active ?? []).filter((effect) => isEffectLive(effect, nowMs));
}

/**
 * The state with dead activations swept out, or null when there is nothing to sweep.
 *
 * Null-when-clean on purpose, the same shape as `reconcileInventoryStock` and `stripRetiredItems`:
 * a healthy save costs one filter and NO write. Sweeping is housekeeping — nothing reads
 * `state.active` without going through {@link activeEffects} first, so an unswept save is merely
 * untidy and never wrong.
 */
export function pruneUtilityState(
  state: UtilityCardState | null | undefined,
  nowMs: number,
): UtilityCardState | null {
  const active = state?.active ?? [];
  const live = active.filter((effect) => isEffectLive(effect, nowMs));
  if (live.length === active.length) return null;
  return { ...(state ?? {}), active: live };
}

// --- Grant and use -----------------------------------------------------------

/** What a grant did. `dropped` is what the {@link UtilityCardDefinition.maxOwned} cap refused. */
export interface CardGrantResult {
  state: UtilityCardState;
  granted: number;
  dropped: number;
}

/**
 * Adds copies of a card to the bag, respecting the cap. Pure — the caller persists the result.
 *
 * Every source (a limited-shop purchase, a wheel drop, an admin button) goes through this one
 * function, so the cap is applied once rather than per source, and a drop table that hands out a
 * hundred cards cannot write a hundred into the save.
 */
export function grantCards(
  state: UtilityCardState | null | undefined,
  cardId: UtilityCardId,
  quantity: number,
): CardGrantResult {
  const card = getUtilityCard(cardId);
  const base: UtilityCardState = state ?? {};
  const wanted = Number.isFinite(quantity) ? Math.floor(quantity) : 0;
  if (!card || wanted <= 0) return { state: base, granted: 0, dropped: Math.max(0, wanted) };

  const held = getOwnedCardCount(base, cardId);
  const granted = Math.max(0, Math.min(wanted, card.maxOwned - held));
  if (granted === 0) return { state: base, granted: 0, dropped: wanted };

  return {
    state: { ...base, owned: { ...(base.owned ?? {}), [cardId]: held + granted } },
    granted,
    dropped: wanted - granted,
  };
}

/** Why a card could not be used. Every one of these is a state the UI shows, not an error. */
export type CardUseError =
  | 'unknown-card'
  | 'none-owned'
  /** Its own effect is already running and the card's stacking rule is `reject`. */
  | 'already-active';

export type CardUseResult =
  | { ok: true; state: UtilityCardState; effect: ActiveUtilityEffect }
  | { ok: false; error: CardUseError };

/**
 * Uses one card: spend a copy, start (or extend) its effect. Pure — the caller writes the result.
 *
 * `activationId` and `nowMs` are arguments rather than generated here so the whole flow is
 * reproducible in a test and, more importantly, so a retry of the same write cannot mint a second
 * activation id for what the player experienced as one tap.
 */
export function useCard(
  state: UtilityCardState | null | undefined,
  cardId: UtilityCardId,
  { nowMs, activationId }: { nowMs: number; activationId: string },
): CardUseResult {
  const card = getUtilityCard(cardId);
  if (!card) return { ok: false, error: 'unknown-card' };

  const base: UtilityCardState = state ?? {};
  const held = getOwnedCardCount(base, cardId);
  if (held <= 0) return { ok: false, error: 'none-owned' };

  const live = activeEffects(base, nowMs);
  const running = live.find((effect) => effect.cardId === cardId);
  if (running && card.stacking === 'reject') return { ok: false, error: 'already-active' };

  const owned = { ...(base.owned ?? {}) };
  if (held - 1 > 0) owned[cardId] = held - 1;
  else delete owned[cardId];

  const usedTotal = { ...(base.usedTotal ?? {}), [cardId]: getUsedTotal(base, cardId) + 1 };

  // `extend` lengthens the running activation rather than appending a second record: two records
  // for one card would both be found by the resolver and multiply twice, which is exactly the
  // 「重複計算」 the brief names. Extending keeps 「一次只有一份效果」 structurally true.
  if (running && card.stacking === 'extend') {
    const extended = extendEffect(running, card, nowMs);
    return {
      ok: true,
      state: {
        ...base,
        owned,
        usedTotal,
        active: live.map((effect) =>
          effect.activationId === running.activationId ? extended : effect,
        ),
      },
      effect: extended,
    };
  }

  const effect: ActiveUtilityEffect = {
    activationId,
    cardId,
    activatedAt: new Date(nowMs).toISOString(),
    ...(card.duration.kind === 'timed'
      ? { expiresAt: new Date(nowMs + card.duration.seconds * 1000).toISOString() }
      : { usesLeft: card.duration.count }),
  };

  return { ok: true, state: { ...base, owned, usedTotal, active: [...live, effect] }, effect };
}

/** One activation's length added onto a running one. See {@link UtilityCardStacking}. */
function extendEffect(
  running: ActiveUtilityEffect,
  card: UtilityCardDefinition,
  nowMs: number,
): ActiveUtilityEffect {
  if (card.duration.kind === 'uses') {
    return { ...running, usesLeft: (running.usesLeft ?? 0) + card.duration.count };
  }
  const from = Math.max(nowMs, running.expiresAt ? Date.parse(running.expiresAt) : nowMs);
  return { ...running, expiresAt: new Date(from + card.duration.seconds * 1000).toISOString() };
}
