/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 每日登入 — rules tests.
 *
 * Run with `npm run test:daily-login`. Written in the same tsx-script style as the `audit:*`
 * checks because that is the test runner this repo has; there is no vitest/jest here, and adding
 * one is a bigger decision than this feature should make on its own.
 *
 * These cover the DECIDABLE half of the spec: cycle tiling, day boundaries in Asia/Taipei, the
 * state machine, make-up pricing and the affordability edges. The concurrency cases from the
 * brief (double-claim, simultaneous free+make-up, retry after a lost response) are properties of
 * the WRITE path, not of these functions — see docs/daily-login.md for which of those the current
 * architecture can actually guarantee and how they are enforced.
 */

import {
  CivilDate,
  DAILY_LOGIN_CURRENCY,
  DAILY_PRIZE_COINS,
  DAILY_PRIZE_FRAGMENTS,
  DAILY_PRIZE_ITEM_RARITIES,
  DAILY_PRIZE_PLAN,
  DAILY_PRIZE_SPINS,
  MAKEUP_SURCHARGE,
  addCivilDays,
  buildSquares,
  canClaim,
  civilDateAt,
  civilDaysBetween,
  dailyPrizeFor,
  makeupCostForDay,
  resolveCycle,
} from '../src/constants/dailyLogin';

let failures = 0;
let checks = 0;

function eq(name: string, got: unknown, want: unknown): void {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures++;
    console.log(`FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  } else {
    console.log(`PASS  ${name}`);
  }
}

/** A boolean check, for the properties that are not an equality. Same shape as test-economy's. */
function ok(name: string, condition: boolean, detail = ''): void {
  checks++;
  if (!condition) {
    failures++;
    console.log(`FAIL  ${name}${detail ? `  ${detail}` : ''}`);
  } else {
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

/** An instant, written as Taipei wall-clock time so the boundary cases read as what they test. */
function taipei(iso: string): Date {
  return new Date(`${iso}+08:00`);
}

console.log('\n-- the prize table ---------------------------------------------------');

/**
 * The round stopped being a ladder on 2026-09-17.
 *
 * It used to be seven amounts of one currency (4 / 6 / 10 / 16 / 24 / 36 / 60 碎片) and the tests
 * here pinned that it only ever climbed. There is nothing to climb now: a day is a KIND of thing,
 * four of the seven days are a coin flip between two kinds, and two of them pay no number at all.
 *
 * So what is pinned instead is the SHAPE of the week, the odds, and the one property the old ladder
 * tests were really protecting — that a prize is decided before the day arrives and never re-rolls.
 * That last one is not a nicety: the board previews all seven days, and the server names its claim
 * document after the prize's kind, so a roll that moved would be a second claim document for the
 * same day and therefore a second payout.
 */
eq('seven days', DAILY_PRIZE_PLAN.length, 7);
eq('the round mints 金幣 and nothing else', DAILY_LOGIN_CURRENCY, 'coins');

eq(
  'days 1, 3, 4 and 6 are a coin flip between 商品碎片 and 金幣',
  [1, 3, 4, 6].map((day) => [...DAILY_PRIZE_PLAN[day - 1]]),
  [1, 3, 4, 6].map(() => ['item-fragments', 'coins']),
);
eq(
  'day 2 is three ways',
  [...DAILY_PRIZE_PLAN[1]],
  ['utility-card', 'raffle-ticket', 'coins-and-fragments'],
);
eq('day 5 is a whole product', [...DAILY_PRIZE_PLAN[4]], ['item']);
eq('day 7 is a free spin', [...DAILY_PRIZE_PLAN[6]], ['free-spin']);

/**
 * The odds, measured rather than declared.
 *
 * A thousand rounds is enough to catch a draw that is uniform-in-name-only — an off-by-one in the
 * index, a seed that correlates the day with the option, a `Math.floor` that can reach `length`.
 * The tolerance is deliberately loose (±6 points): this is a check that the branch is roughly even,
 * not a test of the hash's distribution, and a tight bound here would fail on a harmless change to
 * the seed string.
 */
{
  const rounds = 1000;
  const tally = (day: number) => {
    const counts = new Map<string, number>();
    for (let i = 0; i < rounds; i++) {
      const kind = dailyPrizeFor(`cycle-2026-03-${String((i % 28) + 1).padStart(2, '0')}-${i}`, day).kind;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    return counts;
  };

  const even = (day: number, expected: number) => {
    const counts = tally(day);
    const options = DAILY_PRIZE_PLAN[day - 1];
    const share = 100 / options.length;
    const off = options.map((kind) => Math.abs(((counts.get(kind) ?? 0) / rounds) * 100 - share));
    ok(
      `day ${day} draws its ${expected} options evenly`,
      counts.size === expected && Math.max(...off) < 6,
      [...counts].map(([k, n]) => `${k} ${((n / rounds) * 100).toFixed(1)}%`).join('、'),
    );
  };

  even(1, 2);
  even(2, 3);
  even(5, 1);
  even(7, 1);
}

/**
 * The four coin-flip days must be independent OF EACH OTHER, not merely 50/50 when averaged over
 * rounds — and this is a regression test for a bug that shipped and was caught by looking at the
 * board rather than at the numbers.
 *
 * The four days seed on strings that differ only in their LAST character (`...:1` … `...:6`).
 * FNV-1a mixes from the low end and the fraction is read off the top bits, so those four seeds came
 * out within a couple of 256ths of each other: in four rounds out of five all four days landed on
 * the same side of the flip, and a week of 「碎片 or 金幣」 was in practice all one or all the other.
 * Every per-day check above still passed, because each of them varies the ROUND.
 *
 * See constants/seed.ts's `avalanche` for the fix. What this pins is the property, not the fix: a
 * round whose four flips always agree is a broken draw however it got that way.
 */
{
  const rounds = 400;
  let unanimous = 0;
  for (let i = 0; i < rounds; i++) {
    const id = `cycle-2026-0${(i % 9) + 1}-${String((i % 28) + 1).padStart(2, '0')}`;
    const kinds = [1, 3, 4, 6].map((day) => dailyPrizeFor(id, day).kind);
    if (kinds.every((k) => k === kinds[0])) unanimous++;
  }
  // Four independent coin flips agree 1 time in 8. Anything past a quarter of all rounds is the
  // seeds moving together rather than luck.
  ok(
    'the four coin-flip days do not move together within a round',
    unanimous / rounds < 0.25,
    `${((unanimous / rounds) * 100).toFixed(1)}% of rounds were unanimous (獨立時約 12.5%)`,
  );
}

/**
 * Deterministic, which is the property everything else in the feature is built on: the board can
 * preview it, the server can name a document after it, and a retried claim is the same claim.
 */
{
  const first = dailyPrizeFor('cycle-2026-03-10', 4);
  const again = dailyPrizeFor('cycle-2026-03-10', 4);
  eq('the same round and day always roll the same prize', first, again);
  ok(
    'a different round rolls independently',
    [1, 2, 3, 4, 5, 6, 7].some(
      (day) => dailyPrizeFor('cycle-2026-03-10', day).kind !== dailyPrizeFor('cycle-2026-03-17', day).kind,
    ),
    'a seed that ignored the cycle id would make every week identical',
  );
}

/** What each kind actually hands over. The amounts are the brief, restated where they can be read. */
{
  const kindsOf = (day: number) => DAILY_PRIZE_PLAN[day - 1];
  ok(
    'a 碎片 day pays 10 商品碎片 and no money',
    kindsOf(1).includes('item-fragments') &&
      DAILY_PRIZE_FRAGMENTS === 10,
  );
  ok('a 金幣 day pays 15', DAILY_PRIZE_COINS === 15);
  eq('day 7 pays exactly one free spin', dailyPrizeFor('cycle-2026-03-10', 7).spins, DAILY_PRIZE_SPINS);
  eq(
    'day 5 always names a tier',
    DAILY_PRIZE_ITEM_RARITIES.includes(dailyPrizeFor('cycle-2026-03-10', 5).itemRarity!),
    true,
  );
  ok(
    'and never a tier above 史詩',
    !DAILY_PRIZE_ITEM_RARITIES.includes('mythic'),
    '神話 is not something a login may hand out',
  );
}

/**
 * The make-up is a flat PRICE in 金幣.
 *
 * It used to be `reward + 500`, back when the day and the fee were the same currency and a make-up
 * had to be a wash plus a fee to be neither a trap nor a reason to skip days. A day does not have
 * one value any more — four of the seven pay no money at all — so there is nothing to add a fee to.
 * Hence flat, and hence identical on every day of the round.
 */
eq('make-up price is flat', makeupCostForDay(3), MAKEUP_SURCHARGE);
eq('the same on every day', makeupCostForDay(7), makeupCostForDay(1));
console.log('\n-- civil dates and the 00:00 boundary --------------------------------');

eq('23:59:59 belongs to that day', civilDateAt(taipei('2026-03-10T23:59:59')), '2026-03-10');
eq('00:00:00 belongs to the next', civilDateAt(taipei('2026-03-11T00:00:00')), '2026-03-11');
eq('one millisecond before midnight', civilDateAt(taipei('2026-03-10T23:59:59.999')), '2026-03-10');
// The device's own zone must not enter into it: both instants below are the same moment, and one
// of them is "yesterday" in UTC.
eq('UTC evening is already tomorrow in Taipei', civilDateAt(new Date('2026-03-10T16:00:00Z')), '2026-03-11');
eq('UTC just before that is still today', civilDateAt(new Date('2026-03-10T15:59:59Z')), '2026-03-10');
eq('month rollover', civilDateAt(taipei('2026-03-31T23:59:59')), '2026-03-31');
eq('year rollover', civilDateAt(taipei('2027-01-01T00:00:01')), '2027-01-01');
eq('leap day', civilDateAt(taipei('2028-02-29T12:00:00')), '2028-02-29');
eq('civil arithmetic crosses months', addCivilDays('2026-03-31', 1), '2026-04-01');
eq('civil arithmetic crosses years', addCivilDays('2026-12-28', 7), '2027-01-04');
eq('civil difference', civilDaysBetween('2026-03-10', '2026-03-17'), 7);

console.log('\n-- cycle tiling -----------------------------------------------------');

const ANCHOR: CivilDate = '2026-03-10';

eq('first login is day 1', resolveCycle(ANCHOR, taipei('2026-03-10T09:00:00')).currentDayIndex, 1);
eq('cycle id is derived from the start date', resolveCycle(ANCHOR, taipei('2026-03-10T09:00:00')).cycleId, 'cycle-2026-03-10');
eq('day 7 is the last of the cycle', resolveCycle(ANCHOR, taipei('2026-03-16T23:59:59')).currentDayIndex, 7);
eq('cycle end date', resolveCycle(ANCHOR, taipei('2026-03-10T09:00:00')).endDate, '2026-03-16');

{
  // Day 7 ends -> the next server day opens a new cycle at Day 1, with a new id.
  const next = resolveCycle(ANCHOR, taipei('2026-03-17T00:00:00'));
  eq('new cycle starts the next day', next.currentDayIndex, 1);
  eq('new cycle has a new id', next.cycleId, 'cycle-2026-03-17');
  eq('new cycle is numbered', next.cycleNumber, 1);
}

{
  // Cycles are calendar-driven, not claim-driven: a player who vanishes for five weeks comes back
  // to a fresh cycle rather than to where they left off.
  const later = resolveCycle(ANCHOR, taipei('2026-04-15T08:00:00'));
  eq('long absence lands in a later cycle', later.cycleNumber, 5);
  eq('long absence still starts at some day of it', later.currentDayIndex >= 1 && later.currentDayIndex <= 7, true);
}

{
  // Device clock rolled BACK before the anchor. Must not produce a negative cycle or open a day.
  const back = resolveCycle(ANCHOR, taipei('2026-03-01T09:00:00'));
  eq('clock rolled back stays in cycle 0', back.cycleNumber, 0);
  eq('clock rolled back opens no later day', back.currentDayIndex, 1);
}

console.log('\n-- the state machine ------------------------------------------------');

{
  // Day 3 of the cycle, nothing claimed yet.
  const cycle = resolveCycle(ANCHOR, taipei('2026-03-12T10:00:00'));
  const squares = buildSquares(cycle, new Set(), true);
  eq('today is available', squares[2].state, 'available');
  eq('yesterday is buyable', squares[1].state, 'makeup_available');
  eq('day 1 is buyable', squares[0].state, 'makeup_available');
  eq('tomorrow is future', squares[3].state, 'future');
  eq('day 7 is future', squares[6].state, 'future');
  eq('future squares still show their prize', squares[6].prize.kind, 'free-spin');
  eq('future squares carry no price', squares[6].makeupCost, null);
  eq('buyable squares carry a price', squares[1].makeupCost, MAKEUP_SURCHARGE);
}

{
  // THE SPEC'S "skipped day 2" CASE. Claimed day 1, skipped day 2, now on day 3.
  const cycle = resolveCycle(ANCHOR, taipei('2026-03-12T10:00:00'));
  const squares = buildSquares(cycle, new Set([1]), true);
  eq('claimed day is terminal', squares[0].state, 'claimed');
  eq('skipping day 2 does not hold day 3 back', squares[2].state, 'available');
  eq('the skipped day is only buyable', squares[1].state, 'makeup_available');
  eq('a claimed day can never be re-claimed free', canClaim(squares[0], 'free'), false);
  eq('a claimed day can never be bought back', canClaim(squares[0], 'makeup'), false);
  eq('free claim is only for today', canClaim(squares[1], 'free'), false);
  eq('make-up is only for a missed day', canClaim(squares[2], 'makeup'), false);
}

{
  // Day 7 is the round's PRIZE, not merely its last day: it opens only once the six under it have
  // been collected. Without this a 補簽 buys nothing — see isGrandPrizeUnlocked.
  const cycle = resolveCycle(ANCHOR, taipei('2026-03-16T12:00:00'));
  const squares = buildSquares(cycle, new Set(), true);
  eq('day 7 stays shut while the round is incomplete', squares[6].state, 'future');
  eq('the other six are all buyable', squares.slice(0, 6).every((s) => s.state === 'makeup_available'), true);

  const earned = buildSquares(cycle, new Set([1, 2, 3, 4, 5, 6]), true);
  eq('day 7 opens once the six are in', earned[6].state, 'available');
  eq('and it is claimable free', canClaim(earned[6], 'free'), true);

  // A make-up on the last outstanding day is what unlocks it, which is the whole point of the fee.
  const oneShort = buildSquares(cycle, new Set([1, 2, 3, 4, 5]), true);
  eq('one day short leaves the prize shut', oneShort[6].state, 'future');
  eq('and the missing day is buyable', oneShort[5].state, 'makeup_available');
}

{
  // A finished cycle: unclaimed squares are missed, and nothing in it is actionable.
  const old = resolveCycle(ANCHOR, taipei('2026-03-12T10:00:00'));
  const squares = buildSquares(old, new Set([1, 2]), false);
  eq('past cycle keeps its claims', squares[0].state, 'claimed');
  eq('past cycle unclaimed is missed', squares[2].state, 'missed');
  eq('missed cannot be bought back', canClaim(squares[2], 'makeup'), false);
  eq('missed carries no price', squares[2].makeupCost, null);
  eq('nothing in a past cycle is claimable', squares.some((s) => canClaim(s, 'free') || canClaim(s, 'makeup')), false);
}

console.log('\n-- affordability edges ----------------------------------------------');

{
  const cost = makeupCostForDay(3); // 750
  const afford = (balance: number) => balance >= cost;
  eq('exactly enough is enough', afford(cost), true);
  eq('one coin short is not', afford(cost - 1), false);
  eq('one coin over is fine', afford(cost + 1), true);
  // No longer 「price minus the day's value」: the two are different currencies, so the cost IS the
  // price. What still has to hold is that it does not vary with the day.
  eq('the price is the whole cost', cost, MAKEUP_SURCHARGE);
}

console.log(
  failures === 0
    ? `\nALL PASS (${checks} checks)\n`
    : `\n${failures} of ${checks} checks FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
