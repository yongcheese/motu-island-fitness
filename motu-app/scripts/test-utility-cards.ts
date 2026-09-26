/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 功能卡 / 輪盤機率 — rules tests.
 *
 * Run with `npm run test:utility-cards`. Same tsx-script style as `test:economy`,
 * `test:workout-rewards` and the `audit:*` checks, because that is the test runner this repo has.
 *
 * The properties pinned here are the ones the brief states as requirements and that are cheap to
 * break months later — most of them are properties of the DATA as much as of the code, so this is
 * also the check that catches somebody pricing the 雙倍金幣券 at 30 金幣 or giving the 輪盤's card
 * slot a fatter weight than its 碎片 slot:
 *
 *  §1/§4   a card is granted, accumulates, is capped, and is spent by being used
 *  §2/§3   the ×2 happens in ONE layer, applies to the right currency only, and never twice
 *  §15     Inventory → Use → Active Effect → Effect End, including expiry
 *  §5      the 輪盤 draws from a weighted table, cards are the rarest outcome, and a draw is a pure
 *          function of the spin id (so a re-render cannot re-roll it)
 *  §1/§5   a card declares its own channels honestly — every table that sells or drops it agrees
 *
 * The 限時商店 used to be tested here too. It is its own shop now, with its own pools, its own
 * rotation and its own bundle pricing, so it has its own suite: `npm run test:limited-shop`
 * (scripts/test-limited-shop.ts). What stayed behind is the one assertion that spans both — a
 * card's `channels` list against the shop pool that actually sells it.
 *
 * What it deliberately does NOT test: the write paths and the React layer. Those need a Firestore
 * and a DOM; what is testable without either is every rule that decides WHAT happens, which is the
 * half that silently rots.
 */

import {
  ALL_UTILITY_CARDS,
  UTILITY_CARDS,
  activeEffects,
  describeDuration,
  getOwnedCardCount,
  getUtilityCard,
  grantCards,
  isEffectLive,
  pruneUtilityState,
  useCard,
  type UtilityCardState,
} from '../src/constants/utilityCards';
import { MAX_REWARD_MULTIPLIER, settleReward } from '../src/constants/rewardEffects';
import { checkGrant, type Reward } from '../src/constants/rewards';
import {
  WHEEL_ENTRIES,
  WHEEL_SLOTS,
  drawWheelSlot,
  utilityCardChance,
  wheelOdds,
} from '../src/constants/wheelRewards';
import { pickWeighted, totalWeight, weightedChance } from '../src/constants/rewardPools';
import { SPECIAL_CARD_POOL } from '../src/constants/limitedShop';

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

function ok(name: string, condition: boolean, detail = ''): void {
  eq(name + (detail ? ` (${detail})` : ''), condition, true);
}

const T0 = Date.parse('2026-08-29T10:00:00.000Z');
const coins = (amount: number): Reward => ({ kind: 'currency', currency: 'coins', amount });
const fragments = (amount: number): Reward => ({ kind: 'currency', currency: 'fragments', amount });

console.log('\n-- the card catalog (§1) ------------------------------------------------');

ok('there is at least one card', ALL_UTILITY_CARDS.length > 0);
ok(
  'every card keys itself by its own id',
  ALL_UTILITY_CARDS.every((card) => UTILITY_CARDS[card.id] === card),
);
ok(
  'every card has copy, a tier, an icon and a cap',
  ALL_UTILITY_CARDS.every(
    (card) => !!card.name && !!card.description && !!card.effectSummary && !!card.rarity && card.maxOwned > 0,
  ),
);
ok(
  'every card declares a duration that can end',
  ALL_UTILITY_CARDS.every((card) =>
    card.duration.kind === 'timed' ? card.duration.seconds > 0 : card.duration.count > 0,
  ),
);
ok(
  'every multiplier is greater than 1 — a card that changes nothing is not a card',
  ALL_UTILITY_CARDS.every((card) => card.effect.multiplier > 1),
);
eq('an unknown card id resolves to null', getUtilityCard('no-such-card'), null);
eq('雙倍金幣券 doubles 金幣', UTILITY_CARDS['double-coin'].effect, {
  kind: 'currency-multiplier',
  currency: 'coins',
  multiplier: 2,
});
ok('its duration reads as a sentence', describeDuration(UTILITY_CARDS['double-coin'].duration).length > 0);

console.log('\n-- inventory: grant, accumulate, cap (§4) -------------------------------');

let state: UtilityCardState = {};
eq('a fresh bag holds none', getOwnedCardCount(state, 'double-coin'), 0);

state = grantCards(state, 'double-coin', 1).state;
eq('one grant is one card', getOwnedCardCount(state, 'double-coin'), 1);

const two = grantCards(state, 'double-coin', 2);
eq('grants accumulate', getOwnedCardCount(two.state, 'double-coin'), 3);
eq('and report what landed', [two.granted, two.dropped], [2, 0]);

const capped = grantCards({ owned: { 'double-coin': 98 } }, 'double-coin', 5);
eq('the cap holds', getOwnedCardCount(capped.state, 'double-coin'), UTILITY_CARDS['double-coin'].maxOwned);
eq('and the overflow is reported rather than silently kept', [capped.granted, capped.dropped], [1, 4]);

eq(
  'a grant of an unknown card changes nothing',
  grantCards(state, 'nope' as never, 1).state,
  state,
);
eq('a grant of zero changes nothing', grantCards(state, 'double-coin', 0).granted, 0);

console.log('\n-- use → active effect → end (§15) --------------------------------------');

const bag: UtilityCardState = { owned: { 'double-coin': 2 } };
const used = useCard(bag, 'double-coin', { nowMs: T0, activationId: 'act-1' });
ok('using a card succeeds', used.ok);
if (used.ok) {
  eq('it spends exactly one copy', getOwnedCardCount(used.state, 'double-coin'), 1);
  eq('it records the use', used.state.usedTotal?.['double-coin'], 1);
  eq('one effect is running', activeEffects(used.state, T0).length, 1);
  eq('the effect names the card and nothing else about it', used.effect.cardId, 'double-coin');
  ok('a timed card gets an expiry', !!used.effect.expiresAt);
  ok('and no use counter', used.effect.usesLeft === undefined);

  const halfway = T0 + 15 * 60 * 1000;
  ok('it is still live halfway through', isEffectLive(used.effect, halfway));
  const after = T0 + 31 * 60 * 1000;
  ok('and dead once the window passes', !isEffectLive(used.effect, after));
  eq('an expired effect is not returned as active', activeEffects(used.state, after).length, 0);
  ok('and the sweep removes it', pruneUtilityState(used.state, after)?.active?.length === 0);
  eq('a clean state needs no sweep', pruneUtilityState(used.state, halfway), null);

  // §15's 「已使用 / 效果進行中」: a second copy exists, but the card refuses to stack with itself.
  const again = useCard(used.state, 'double-coin', { nowMs: T0 + 60_000, activationId: 'act-2' });
  eq('a card with stacking: reject refuses while its own effect runs', again, {
    ok: false,
    error: 'already-active',
  });
  eq(
    'and once it has ended, the second copy can be used',
    useCard(used.state, 'double-coin', { nowMs: after, activationId: 'act-3' }).ok,
    true,
  );
}

eq('using a card you do not hold is refused', useCard({}, 'double-coin', { nowMs: T0, activationId: 'a' }), {
  ok: false,
  error: 'none-owned',
});

console.log('\n-- the reward calculation layer (§2/§3) ---------------------------------');

const live: UtilityCardState = used.ok ? used.state : {};
const ctx = { cards: live, nowMs: T0 + 60_000 };
const settled = settleReward(coins(40), ctx);

eq('金幣 is doubled', settled.reward, coins(80));
eq('the BASE is preserved, not overwritten', settled.base, coins(40));
eq('the multiplier is reported', settled.multiplier, 2);
eq('and so is which card did it', settled.applied.map((note) => note.cardId), ['double-coin']);
eq('a timed card is not consumed by being applied', settled.cardsAfter, null);

eq('碎片 are untouched by a 金幣 card', settleReward(fragments(40), ctx).reward, fragments(40));
eq('經驗值 is untouched by a 金幣 card', settleReward({ kind: 'xp', amount: 40 }, ctx).reward, {
  kind: 'xp',
  amount: 40,
});
eq(
  'an item grant is never multiplied',
  settleReward({ kind: 'item', itemId: 'item-5', quantity: 1 }, ctx).reward,
  { kind: 'item', itemId: 'item-5', quantity: 1 },
);
eq(
  'a 功能卡 grant is never multiplied',
  settleReward({ kind: 'utility-card', cardId: 'double-coin', quantity: 1 }, ctx).reward,
  { kind: 'utility-card', cardId: 'double-coin', quantity: 1 },
);

eq('with nothing running, the reward is returned unchanged', settleReward(coins(40), { cards: {}, nowMs: T0 }).reward, coins(40));
eq(
  'an expired card pays nothing extra',
  settleReward(coins(40), { cards: live, nowMs: T0 + 31 * 60 * 1000 }).reward,
  coins(40),
);
eq(
  'the multiplier does not depend on the size of the reward',
  settleReward(coins(1), ctx).multiplier,
  settleReward(coins(999), ctx).multiplier,
);

// 「不會在多個地方重複 ×2」 — settling an ALREADY settled reward is what a second multiplication
// site would look like, and the guard is that there is only one call site. What can be pinned here
// is that one settlement never applies the same activation twice.
eq('one activation multiplies once', settleReward(coins(40), ctx).multiplier, 2);
eq(
  'and re-settling the OUTPUT is what a duplicated layer would look like',
  settleReward(settled.reward, ctx).reward,
  coins(160),
);

// A duplicated activation record in the save (a corrupt write) must not compound without limit.
const doubled: UtilityCardState = used.ok
  ? { ...used.state, active: [...(used.state.active ?? []), { ...used.state.active![0], activationId: 'dup' }] }
  : {};
ok(
  'stacked effects are capped',
  settleReward(coins(40), { cards: doubled, nowMs: T0 + 60_000 }).multiplier <= MAX_REWARD_MULTIPLIER,
);

// A `uses`-based card is the other duration shape, and the one whose consumption has to ride in the
// same write as the reward.
const usesCard: UtilityCardState = {
  active: [{ activationId: 'u-1', cardId: 'double-coin', activatedAt: new Date(T0).toISOString(), usesLeft: 2 }],
};
const spent = settleReward(coins(10), { cards: usesCard, nowMs: T0 });
eq('a uses-based effect still multiplies', spent.reward, coins(20));
eq('and reports the state to persist', spent.cardsAfter?.active?.[0]?.usesLeft, 1);
eq(
  'a reward it does not apply to never spends a use',
  settleReward(fragments(10), { cards: usesCard, nowMs: T0 }).cardsAfter,
  null,
);
const lastUse = settleReward(coins(10), { cards: spent.cardsAfter ?? {}, nowMs: T0 });
eq('the final use ends the effect', lastUse.cardsAfter?.active?.length, 0);

console.log('\n-- the policy still governs (constants/rewards.ts) ----------------------');

ok(
  '輪盤 may not pay 金幣, cards or not',
  !checkGrant({ reward: coins(10), source: 'wheel' }).ok,
);
ok(
  'a 功能卡 grant of a whole quantity is allowed',
  checkGrant({ reward: { kind: 'utility-card', cardId: 'double-coin', quantity: 1 }, source: 'wheel' }).ok,
);
ok(
  'a 功能卡 grant of zero is not',
  !checkGrant({ reward: { kind: 'utility-card', cardId: 'double-coin', quantity: 0 }, source: 'wheel' }).ok,
);

console.log('\n-- the wheel (§5) ------------------------------------------------------');

ok('the table has weight', totalWeight(WHEEL_ENTRIES) > 0);
ok('every slot has copy and a positive weight', WHEEL_SLOTS.every((slot) => !!slot.label && slot.weight > 0));
ok('a 功能卡 is reachable', WHEEL_SLOTS.some((slot) => slot.prize.kind === 'utility-card'));
ok(
  'every card slot names a card that exists',
  WHEEL_SLOTS.every((slot) => slot.prize.kind !== 'utility-card' || !!getUtilityCard(slot.prize.cardId)),
);
ok(
  'no wheel slot pays 金幣 — the policy would refuse it anyway',
  WHEEL_SLOTS.every((slot) => slot.prize.kind !== 'currency' || slot.prize.currency === 'fragments'),
);

const cardChance = utilityCardChance();
const otherChances = WHEEL_SLOTS
  .filter((slot) => slot.prize.kind !== 'utility-card')
  .map((slot) => weightedChance(WHEEL_ENTRIES, slot));
ok('a card is rarer than every ordinary prize', otherChances.every((chance) => chance > cardChance), `card ${(cardChance * 100).toFixed(1)}%`);
ok('and rare in absolute terms', cardChance > 0 && cardChance <= 0.05);

// §19's 「不會因 UI 重渲染重新抽獎」: the draw is a pure function of the spin id.
const spin = 'spin-abc';
eq('the same spin id always draws the same wedge', drawWheelSlot(spin)?.id, drawWheelSlot(spin)?.id);
ok(
  'different spins do not all land on the same wedge',
  new Set(Array.from({ length: 400 }, (_, i) => drawWheelSlot(`spin-${i}`)?.id)).size > 1,
);

// The distribution has to actually follow the weights, or 「權重」 is decoration.
const draws = new Map<string, number>();
const SAMPLES = 20000;
for (let i = 0; i < SAMPLES; i++) {
  const slot = drawWheelSlot(`sample-${i}`);
  if (slot) draws.set(slot.id, (draws.get(slot.id) ?? 0) + 1);
}
for (const { slot, chance } of wheelOdds()) {
  const observed = (draws.get(slot.id) ?? 0) / SAMPLES;
  ok(
    `${slot.id} lands near its weight`,
    Math.abs(observed - chance) < Math.max(0.01, chance * 0.25),
    `${(observed * 100).toFixed(2)}% vs ${(chance * 100).toFixed(2)}%`,
  );
}
ok('the card slot is actually drawn at all', (draws.get('card-double-coin') ?? 0) > 0);
eq('an empty table draws nothing', pickWeighted([], 1), null);
eq('a table of zero weights draws nothing', pickWeighted([{ value: 'a', weight: 0 }], 1), null);

console.log('\n-- where a card can come from (§1/§5) -----------------------------------');

// A card's declared channels have to match the tables that actually sell or drop it. The 限時商店
// half now means 「有一列組合包在賣它」 — see scripts/test-limited-shop.ts for everything about
// how that shelf behaves.
for (const card of ALL_UTILITY_CARDS) {
  const inShop = SPECIAL_CARD_POOL.some(
    (source) => source.content.kind === 'utility-card' && source.content.cardId === card.id,
  );
  const inWheel = WHEEL_SLOTS.some(
    (slot) => slot.prize.kind === 'utility-card' && slot.prize.cardId === card.id,
  );
  eq(`${card.id} declares its 限時商店 channel honestly`, card.channels.includes('limited-shop'), inShop);
  eq(`${card.id} declares its 輪盤 channel honestly`, card.channels.includes('wheel'), inWheel);
}

console.log(
  `\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`} — ${checks - failures}/${checks} checks\n`,
);
process.exit(failures === 0 ? 0 : 1);
