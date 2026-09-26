/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 每日登入獎勵 — the seven-day round, its calendar, and the state machine the panel draws.
 *
 * This is the data-and-rules half of the feature; components/UI/DailyLoginPanel.tsx is the other
 * half and holds no rules of its own. Same split as constants/rarityFx.ts ↔ PurchaseDialog: a
 * designer changing what a day is worth, when a round turns over, or what a make-up costs should
 * never have to open a component, and a component should never be where a game rule is discovered.
 *
 * The API here is pinned by scripts/test-daily-login.ts (`npm run test:daily-login`) — that file is
 * the specification, this one is the implementation, and the names/semantics below exist to satisfy
 * it exactly. If you change a signature here, that test is where you find out what depended on it.
 *
 * ## What replaced what
 *
 * The old daily bonus paid `50 + streak * 10` gold and `20 + streak * 5` XP the instant the app
 * noticed a new calendar day, and told the player afterwards. It could not be looked forward to
 * (nothing showed what tomorrow was worth), it could not be missed (there was nothing to miss) and
 * it never ended (an unbounded streak means the number is either meaningless early or absurd
 * later). A seven-day round fixes all three: every reward is visible from day one, the round has a
 * top worth walking to, and the ladder resets so that top stays reachable.
 *
 * The XP that grant used to include is deliberately not carried over: XP stays where it is earned,
 * in 運動. No day of the round pays any.
 *
 * ## The round stopped being a ladder (2026-09-17)
 *
 * It was a straight line of 碎片 — 4, 6, 10, 16, 24, 36, 60 — and every card said the same thing
 * seven times at increasing volume. A ladder is the right shape when the reward is a NUMBER, and
 * the wrong one when what a week should feel like is 「今天會是什麼」. So the seven days are now
 * seven different KINDS of thing, and four of them are a coin flip (see {@link DAILY_PRIZE_PLAN}):
 *
 *   1, 3, 4, 6   商品碎片 ×10, or 金幣 ×15 — 50／50
 *   2            功能卡 ／ 抽獎券 ／ 金幣＋碎片 — 33 each
 *   5            a whole product, 普通／稀有／史詩 — 33 each
 *   7            one free turn of the 幸運轉盤
 *
 * What survived the rewrite, deliberately: every prize is still decided BEFORE the day arrives, so
 * a board can still show seven cards and mean it (see {@link dailyPrizeFor} on why the roll is
 * seeded rather than live), and the round is still a calendar tiling rather than a punch card.
 *
 * ## The round pays 金幣 again, and that IS a rule being spent
 *
 * From 2026-08-25 to 2026-09-17 this round paid the wallet's 碎片, because 金幣 had exactly one
 * source — 健身 — and constants/rewards.ts refused a coin grant from anything else. This round
 * gives that up: four of its seven days can pay 15 金幣, and `SOURCE_CURRENCY_POLICY` was widened
 * to let them. The reasoning that rule was built on has not stopped being true — see the note over
 * the policy table for what 15 a day is measured against, and why it is small enough that showing
 * up is still not a substitute for training.
 *
 * The 碎片 this round talks about are 商品碎片 (constants/fragments.ts): a stack that belongs to one
 * product and unlocks that product at 200. They are not the wallet's 碎片 and are not a currency.
 * No day of the round pays the wallet's 碎片 any more.
 *
 * The 補簽 fee is 金幣, as it always was — which now makes it the same currency the round can pay,
 * so a make-up is an ordinary purchase rather than the exchange rate between two resources that it
 * used to be. At {@link MAKEUP_SURCHARGE} against a 15 金幣 day it is still strictly worse than
 * showing up, which is the property that matters: it exists so that missing one day does not put
 * 第 7 天 out of reach (the grand prize requires the first six), not as a way to buy a week.
 */

import type { CurrencyId } from './currency';
import type { Rarity } from './rarity';
import { seedFrom, seedPick } from './seed';
import {
  CIVIL_TZ,
  addCivilDays,
  civilDateAt,
  civilDaysBetween,
  formatCountdown,
  msUntilNextCivilDay,
  type CivilDate,
} from './civilTime';

/**
 * 行事曆已經搬到 constants/civilTime.ts。
 *
 * 這一段原本是這個檔案自己的實作，現在只是轉出口 —— 每週任務（constants/weeklyTasks.ts）需要
 * 同一套日期運算，而讓它 import「每日登入」等於把兩個互不相干的功能綁在一起。既有的
 * `from './dailyLogin'` 一行都不用改，這正是保留這些 re-export 的理由。
 */
export {
  addCivilDays,
  civilDateAt,
  civilDaysBetween,
  formatCountdown,
  msUntilNextCivilDay,
  type CivilDate,
};

/**
 * 沿用舊名字：這個常數是每日登入 API 回應裡的一個欄位名（src/server/dailyLoginApi.ts），改名
 * 會動到那份合約，而它真正的值現在由 {@link CIVIL_TZ} 持有。
 */
export const DAILY_LOGIN_TZ = CIVIL_TZ;

/**
 * What one day of the round can hand over.
 *
 *   item-fragments       商品碎片 for one 普通／稀有 product. Which product is decided by
 *                        constants/dailyLoginPrizes.ts, which is the half of this feature that is
 *                        allowed to know the catalog exists.
 *   coins                金幣. The one kind that is paid by the SERVER — see the note below.
 *   coins-and-fragments  both of the above at once, which is what makes 第 2 天's third option the
 *                        good one rather than a third flavour of the same shrug.
 *   utility-card         一張功能卡 (constants/utilityCards.ts).
 *   raffle-ticket        抽獎券, for the 幸運轉盤.
 *   item                 a whole product, at a tier the roll picks. 第 5 天 only.
 *   free-spin            one turn of the 幸運轉盤, charged to nobody. 第 7 天 only.
 */
export type DailyPrizeKind =
  | 'item-fragments'
  | 'coins'
  | 'coins-and-fragments'
  | 'utility-card'
  | 'raffle-ticket'
  | 'item'
  | 'free-spin';

/**
 * One day's prize — AMOUNTS only, never a catalog id.
 *
 * That split is the whole reason this file can still be imported by the Express server
 * (src/server/dailyLoginApi.ts): the server has to know that 第 3 天 is worth 15 金幣, and it must
 * not have to load a few hundred item definitions, three rarity tables and a category taxonomy to
 * find that out. Which ITEM a fragment day lands on, and which card 第 2 天 hands over, are decided
 * in constants/dailyLoginPrizes.ts from the same seed — so the two halves agree without either one
 * importing the other's dependencies.
 *
 * Every field is present on every prize and most of them are 0. A discriminated union would be the
 * tidier type and the worse one to read: the card, the reveal and the write path would each have to
 * switch on `kind` before they could ask 「這一天有幾個金幣」, and the answer for six of the seven
 * kinds is simply zero.
 */
export interface DailyPrize {
  kind: DailyPrizeKind;
  /** 金幣. */
  coins: number;
  /** 商品碎片 — of ONE product, named by constants/dailyLoginPrizes.ts. */
  itemFragments: number;
  /** 抽獎券. */
  tickets: number;
  /** 功能卡, in copies. */
  cards: number;
  /** Free turns of the 幸運轉盤. */
  spins: number;
  /** Which tier an `item` day promises. Null on every other kind. */
  itemRarity: Rarity | null;
}

/**
 * The currency the round MINTS.
 *
 * It was 碎片 (the wallet currency) until 2026-09-17 and is 金幣 now, because the new round pays
 * 金幣 on four of its seven days and pays the wallet's 碎片 on none of them. The 碎片 this round
 * talks about are 商品碎片 — a stack that belongs to one product (constants/fragments.ts) — which
 * is a different thing with a different store and is NOT a currency.
 *
 * Named once, here, because three places have to agree on it: the server's transaction, the offline
 * claim path, and the chip the panel counts up. It is also the currency a 補簽 is charged in, which
 * is new — the two used to be deliberately different and the reason for that is gone.
 *
 * See constants/rewards.ts on why 每日登入 is now allowed to pay it at all. That was a real rule
 * with real teeth and this round is the decision to spend it.
 */
export const DAILY_LOGIN_CURRENCY: CurrencyId = 'coins';

/** 商品碎片 a fragment day pays, of one product. 200 unlock it, so this is a twentieth of one. */
export const DAILY_PRIZE_FRAGMENTS = 10;

/** 金幣 a coin day pays. */
export const DAILY_PRIZE_COINS = 15;

/**
 * 抽獎券 第 2 天 hands over when it rolls that way.
 *
 * NOT enough for a spin on its own, which is the point: 第 7 天 is where the round gives a turn of
 * the wheel away, and a 第 2 天 that could be spun immediately would take that away from it.
 *
 * ⚠ That only holds while a spin costs more than this. It costs {@link WHEEL_SPIN_COST} = 1 today
 * (constants/luckyWheel.ts), so as things stand two tickets are two spins and 第 2 天 IS
 * immediately spinnable. Raising the spin price to 5 is the one-line change that makes this
 * constant mean what it says; it is deliberately not made here, because it re-prices every other
 * ticket source in the game (the overflow conversion, the duplicate-outfit consolation, the
 * 限時商店's ticket bundles) and that is a balance decision, not a daily-login one.
 */
export const DAILY_PRIZE_TICKETS = 2;

/** 功能卡 第 2 天 hands over. One — a card is a real thing to be given, not a stack. */
export const DAILY_PRIZE_CARDS = 1;

/** Free turns 第 7 天 hands over. */
export const DAILY_PRIZE_SPINS = 1;

/** The tiers 第 5 天's product can come out at, each equally likely. */
export const DAILY_PRIZE_ITEM_RARITIES: readonly Rarity[] = ['common', 'rare', 'epic'];

/**
 * What each day of the round can roll, day 1 first — and this table IS the seven-day design.
 *
 * ## Why a day is a LIST of kinds rather than one kind
 *
 * Because the brief is 「隨機」, and the honest way to write 「50／50 碎片或金幣」 is two entries
 * with no weights on them. A weight table of `{ weight: 1 }` rows says a designer balanced these
 * against each other and landed on equal; a bare list says they are equal because nobody has
 * decided otherwise yet. The draw ({@link dailyPrizeFor}) picks uniformly, so 第 2 天 and 第 5 天
 * are 33／33／33 by construction rather than by three numbers that have to keep summing to 100.
 *
 * ## The shape of the week
 *
 *   1, 3, 4, 6   the everyday days: 商品碎片 or 金幣, a coin flip.
 *   2            the small surprise: 功能卡, 抽獎券, or both currencies at once.
 *   5            a whole product — the mid-week peak, and the only day that can pay 史詩.
 *   7            a free turn of the 幸運轉盤 — the round's own ending, and the one prize the
 *                player cannot buy their way to with a single day's luck.
 *
 * Day 5 and day 7 are single-entry lists rather than special cases in the draw. A day is always
 * 「pick one of these」, and a day with one option is simply a day that always gives the same thing.
 */
export const DAILY_PRIZE_PLAN: readonly (readonly DailyPrizeKind[])[] = [
  ['item-fragments', 'coins'],
  ['utility-card', 'raffle-ticket', 'coins-and-fragments'],
  ['item-fragments', 'coins'],
  ['item-fragments', 'coins'],
  ['item'],
  ['item-fragments', 'coins'],
  ['free-spin'],
];

/** Days in one round. Derived from the plan's length rather than a literal 7. */
export const CYCLE_LENGTH = DAILY_PRIZE_PLAN.length;

/**
 * What this day of this round pays — the whole draw, as a pure function of (round, day).
 *
 * ## Seeded, and therefore visible in advance
 *
 * `Math.random()` at claim time would be the obvious reading of 「隨機」 and it breaks two things
 * this feature is built on. The board shows seven cards precisely so the player can see what is
 * coming — a card that cannot say what 第 5 天 is worth until 第 5 天 is a locked door with a
 * number missing — and the claim has to survive being retried, which a re-rolled prize does not:
 * a write whose confirmation was lost would be replayed as a DIFFERENT reward.
 *
 * Seeding on the cycle id makes the week a fixed, unknown-until-you-look thing rather than a
 * re-rollable one: it is the same answer on day 1 as on day 7, it changes on its own when the
 * round turns over, and the server and the browser reach it independently without talking.
 *
 * ## And therefore the same for everybody
 *
 * The seed has no player in it, so every account in the same round sees the same week. That is the
 * deliberate trade and it is the one the rest of the game already makes — the 限時商店's rotation
 * (constants/limitedShopRotation.ts) is seeded the same way for the same reason. Adding the uid
 * would personalise it and would stop the board being previewable from anything that does not have
 * a profile in hand, which is how it is drawn in tmp-daily-login.tsx and in every test.
 */
export function dailyPrizeFor(cycleId: string, day: number): DailyPrize {
  const options = DAILY_PRIZE_PLAN[day - 1] ?? [];
  const kind = seedPick(options, seedFrom(`daily-prize:${cycleId}:${day}`)) ?? 'coins';

  const prize: DailyPrize = {
    kind,
    coins: 0,
    itemFragments: 0,
    tickets: 0,
    cards: 0,
    spins: 0,
    itemRarity: null,
  };

  switch (kind) {
    case 'item-fragments':
      prize.itemFragments = DAILY_PRIZE_FRAGMENTS;
      break;
    case 'coins':
      prize.coins = DAILY_PRIZE_COINS;
      break;
    case 'coins-and-fragments':
      prize.coins = DAILY_PRIZE_COINS;
      prize.itemFragments = DAILY_PRIZE_FRAGMENTS;
      break;
    case 'utility-card':
      prize.cards = DAILY_PRIZE_CARDS;
      break;
    case 'raffle-ticket':
      prize.tickets = DAILY_PRIZE_TICKETS;
      break;
    case 'item':
      // A second seed rather than a second use of the first: reusing one seed for two independent
      // draws correlates them, and here it would mean the tier a day pays was a function of the
      // fact that it pays an item at all — which for a single-option day is a constant.
      prize.itemRarity =
        seedPick(DAILY_PRIZE_ITEM_RARITIES, seedFrom(`daily-rarity:${cycleId}:${day}`)) ?? 'common';
      break;
    case 'free-spin':
      prize.spins = DAILY_PRIZE_SPINS;
      break;
  }

  return prize;
}

/**
 * The one number a card, a claim record and the API's `quantity` field put on a prize.
 *
 * Not every prize HAS one number — 第 2 天's 「金幣＋碎片」 has two — so this reports the headline
 * and the card prints the rest itself. The order below is the order the prize is read in: money
 * first, then the thing that is not money.
 */
export function dailyPrizeHeadline(prize: DailyPrize): number {
  if (prize.coins > 0) return prize.coins;
  if (prize.itemFragments > 0) return prize.itemFragments;
  if (prize.tickets > 0) return prize.tickets;
  if (prize.cards > 0) return prize.cards;
  return prize.spins;
}

/**
 * The 補簽 price, in 金幣.
 *
 * ## It is a PRICE now, not a surcharge — the round stopped paying the currency it charges
 *
 * While a day paid 金幣, a make-up cost `reward + 500` and paid `reward` back, so the player was out
 * exactly the fee: charging more than the day was worth would have been a trap, and charging less
 * than it paid would have made skipping days profitable. A flat fee on top of a wash was the only
 * shape that was neither.
 *
 * A day does not pay a fixed amount any more — four of the seven are a coin flip and three of them
 * pay no currency at all (see {@link DAILY_PRIZE_PLAN}) — so there is no 「reward」 for a fee to sit
 * on top of and nothing to add it to. That makes this a flat PRICE, identical on every day of the
 * round, and {@link makeupCostForDay} does not vary with the day.
 *
 * 500 金幣 against a day worth at most 15 金幣 is deliberately steep, and it has to be: a 補簽 must
 * never be a better deal than turning up, and the day it becomes one is the day the round stops
 * being about turning up. What it buys is not the day's prize — it is 第 7 天, which requires the
 * first six ({@link isGrandPrizeUnlocked}). A player who simply shows up pays nothing at all.
 */
export const MAKEUP_SURCHARGE = 500;

/**
 * 金幣 minted by a day of the round. `day` is 1-based, as it is everywhere the player can see it.
 *
 * This is the ONLY part of a day's prize that moves a wallet, and therefore the only part the
 * server pays. Everything else a day can hand over — 商品碎片, 抽獎券, 功能卡, a product, a free
 * spin — lives in the player's own document and is written by the client after the server has
 * accepted the claim as new (context/useDailyLoginPrize.ts). See src/server/dailyLoginApi.ts.
 */
export function coinsForDay(cycleId: string, day: number): number {
  return dailyPrizeFor(cycleId, day).coins;
}

/**
 * What a 補簽 on that day costs, in 金幣.
 *
 * Flat, and no longer a function of the day — see {@link MAKEUP_SURCHARGE} for why the old
 * `reward + fee` shape stopped making sense once the payout changed currency. The parameter is kept
 * so every call site reads as it did, and so a future ladder-priced make-up is a change here rather
 * than at seven call sites.
 */
export function makeupCostForDay(day: number): number {
  void day;
  return MAKEUP_SURCHARGE;
}

/** Where a player is in the seven-day tiling, and which tile that is. */
export interface CycleWindow {
  /** Stable per round, and what a claim record is filed under: `cycle-YYYY-MM-DD`. */
  cycleId: string;
  /** How many complete rounds have elapsed since the player's anchor. The first round is 0. */
  cycleNumber: number;
  startDate: CivilDate;
  endDate: CivilDate;
  /** Which day of THIS round today is, 1…7. */
  currentDayIndex: number;
}

/**
 * Tiles the calendar into seven-day rounds from the player's anchor and reports the tile they are
 * standing in.
 *
 * Rounds are CALENDAR-driven, not claim-driven: a player who vanishes for five weeks comes back to
 * a fresh round rather than to where they left off, and a player who skips Wednesday finds Thursday
 * is still day 4. That is the honest reading of 「每日」 — counting logins instead would make the
 * round a punch card and would make the countdown in the header a lie, because the header would be
 * promising a day that only arrives when the player next opens the game.
 *
 * A clock rolled back before the anchor cannot produce a negative round: it reports the anchor's own
 * round, day 1, so the worst a wound-back device can do is show the player a day they have already
 * claimed rather than open one they have not earned.
 */
export function resolveCycle(anchor: CivilDate, now: Date = new Date()): CycleWindow {
  const offset = civilDaysBetween(anchor, civilDateAt(now));
  const cycleNumber = offset < 0 ? 0 : Math.floor(offset / CYCLE_LENGTH);
  const startDate = addCivilDays(anchor, cycleNumber * CYCLE_LENGTH);
  return {
    cycleId: `cycle-${startDate}`,
    cycleNumber,
    startDate,
    endDate: addCivilDays(startDate, CYCLE_LENGTH - 1),
    currentDayIndex: offset < 0 ? 1 : (offset % CYCLE_LENGTH) + 1,
  };
}

/**
 * What one card can be:
 *
 *   claimed           已領取 — collected. Terminal: never re-claimable, never buyable.
 *   available         今日可領 — the one card with a primary action. There is never more than one.
 *   makeup_available  已錯過 — passed unclaimed, inside the round the player is still in, so it can
 *                     still be bought back for {@link makeupCostForDay}.
 *   missed            已錯過 — the same day once the round it belongs to is over. Nothing can be
 *                     done with it; it is shown so the round reads as a record rather than a blank.
 *   future            未開放 — not here yet. Previewable, never actionable.
 */
export type SquareState = 'claimed' | 'available' | 'makeup_available' | 'missed' | 'future';

export interface DaySquare {
  /** 1-based, as shown. */
  day: number;
  state: SquareState;
  /** Everything this day is worth. The card, the claim and the API all read it from here. */
  prize: DailyPrize;
  /**
   * The prize's kind, repeated flat.
   *
   * It is what the server's claim document is named after
   * (`{cycleId}__{dayIndex}__{rewardType}`, src/server/dailyLoginApi.ts) and what the wire's
   * `reward_type` carries, so it stays a bare string on the square rather than something a reader
   * has to reach into `prize` for. That path is a uniqueness constraint, which is why it matters
   * that {@link dailyPrizeFor} is deterministic: a kind that changed between two attempts would be
   * a second document, and a second document is a second payout.
   */
  rewardType: DailyPrizeKind;
  /** The tier an `item` day promises, or the kind's own name. Never a catalog id — see DailyPrize. */
  rewardId: string;
  /** {@link dailyPrizeHeadline} — the one number the card leads with. */
  quantity: number;
  /** The all-in 補簽 price, and ONLY on a square that can actually be bought. Null everywhere else. */
  makeupCost: number | null;
}

/**
 * The seven cards, from a round, the days already collected in it, and whether it is the round the
 * player is currently living in.
 *
 * `isCurrentCycle` is what separates 「已錯過（可補簽）」 from 「已錯過」: a past round is a record,
 * and selling a day back inside it would let a player buy a week they never played. Everything a
 * card needs to draw itself is on the square — most importantly `quantity`, which is present in
 * every state including `future`, because the whole point of showing seven cards is that the player
 * can see what is coming.
 */
/**
 * Whether 第 7 天 has been earned: every day under it collected, a 補簽 counting the same as a
 * free claim.
 *
 * This is the rule that makes a 補簽 worth buying, and it was missing for one revision — with day 7
 * opening on its own date regardless, paying for a missed day bought the player nothing at all but
 * a card that said 已領取. A make-up is a real decision: 500 金幣 to keep the round's free 輪盤 turn
 * in reach, which is the player's call rather than a toll.
 *
 * It also gives the grand square something honest to say while it is shut: 「集滿前六天」 is a
 * condition the player can act on, where a bare lock icon on the last day of the round is just a
 * closed door.
 */
export function isGrandPrizeUnlocked(claimedDays: ReadonlySet<number>): boolean {
  for (let day = 1; day < CYCLE_LENGTH; day++) {
    if (!claimedDays.has(day)) return false;
  }
  return true;
}

export function buildSquares(
  cycle: CycleWindow,
  claimedDays: ReadonlySet<number>,
  isCurrentCycle: boolean,
): DaySquare[] {
  return DAILY_PRIZE_PLAN.map((_options, i) => {
    const day = i + 1;
    const prize = dailyPrizeFor(cycle.cycleId, day);
    let state: SquareState;
    if (claimedDays.has(day)) state = 'claimed';
    else if (!isCurrentCycle) state = 'missed';
    else if (day === CYCLE_LENGTH && !isGrandPrizeUnlocked(claimedDays)) state = 'future';
    else if (day === cycle.currentDayIndex) state = 'available';
    else if (day < cycle.currentDayIndex) state = 'makeup_available';
    else state = 'future';

    return {
      day,
      state,
      prize,
      rewardType: prize.kind,
      rewardId: prize.itemRarity ?? prize.kind,
      quantity: dailyPrizeHeadline(prize),
      makeupCost: state === 'makeup_available' ? makeupCostForDay(day) : null,
    };
  });
}

/**
 * Whether a square can be taken by that route — the single gate both the button's disabled state and
 * the write path ask, so a card can never offer something the write would refuse.
 */
export function canClaim(square: DaySquare, mode: 'free' | 'makeup'): boolean {
  return mode === 'free' ? square.state === 'available' : square.state === 'makeup_available';
}
