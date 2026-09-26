/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 離線回歸 — rules tests.
 *
 * Run with `npm run test:offline-return`. Same tsx-script style as `test:daily-login` and the
 * `audit:*` checks, because that is the test runner this repo has.
 *
 * The properties pinned here are the ones the brief states as requirements and that are cheap to
 * get wrong months later:
 *
 *  §2/§15  a first sighting is never a long absence, and a short one grows nothing
 *  §2      growth is gradual and monotonic in time away, never a cliff
 *  §4      藤蔓 and 蜘蛛網 are capped, so a long absence is never a jungle
 *  §11/§12 logging in twice from ONE absence adds nothing the second time, and a patch the
 *          player tidied does not grow back until MORE time has passed
 *  §6/§7   nothing anywhere in the resolved state can reduce gold, XP, inventory or a pet
 *  §1/§2   the environment state is gradual and monotonic, and its worst case is still a lit,
 *          coloured island rather than a dark one
 *  §7      clearing the island restores it — the grading is derived from what is standing on it,
 *          so tidying and recovery are the same act
 *  §14     growth prefers the sheltered corners, but the preference can never stop it growing
 *  §1/§2   the colour drain is continuous in hours away, reaches true greyscale, and no single
 *          hour of absence is ever a visible step
 *  §6/§8   the recovery starts drained, ends exactly neutral, and the bloom leads the lift
 *  §12     nothing about a recovery is stored, so being interrupted is an ordinary state
 *
 * The siting rules (lib/islandOvergrowth.ts) are exercised through the real solver, so a change
 * to the island's keep-outs shows up here as sprouts that fail to find a home rather than as
 * weeds in a doorway nobody notices until they are on screen.
 */

import {
  CLEAR_COLOUR_STATE,
  COLOUR_FULL_DAYS,
  COLOUR_MIN_DRAIN,
  COLOUR_STAGES,
  ISLAND_GRADES,
  NEUTRAL_AMBIENCE,
  OVERGROWTH_KINDS,
  OVERGROWTH_MAX,
  PET_HOME_STATE,
  PET_MOODS,
  QUIET_HOURS,
  RECOVERY_HOLD_SECONDS,
  RECOVERY_SECONDS,
  colourDrainForHours,
  colourStageForDrain,
  getOvergrowthKind,
  hoursForColourDrain,
  makePetState,
  overgrowthBudget,
  overgrowthMix,
  resolveIslandAmbience,
  resolveIslandColour,
  resolveOfflineReturn,
  resolvePetMood,
  stageForHours,
  vitalityForHours,
} from '../src/constants/islandReturn';
import { findTidyTarget, growOvergrowth, tidyOvergrowthAt } from '../src/lib/islandOvergrowth';
import { HOUSE_FOOTPRINT } from '../src/constants/houseStyles';
import type { HomeObstacle } from '../src/utils/placementRules';

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

const HOURS = 3_600_000;
const NOW = new Date('2026-08-22T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOURS).toISOString();

/** A Home placed off-centre and rotated, so nothing below can pass by axis-aligned accident. */
const HOME: HomeObstacle = {
  position: [1.4, 0, -1.1],
  rotation: 0.7,
  footprint: HOUSE_FOOTPRINT,
};

const world = { home: HOME, islandScale: 1, placements: [] };

console.log('\n-- reading an absence ------------------------------------------------');

eq('no timestamp is a first sighting', resolveOfflineReturn(undefined, NOW).isFirstSighting, true);
eq('a first sighting is never a return', resolveOfflineReturn(undefined, NOW).shouldGreet, false);
eq('a first sighting reports no time away', resolveOfflineReturn(undefined, NOW).hours, 0);
eq('garbage is a first sighting, not a long one', resolveOfflineReturn('not-a-date', NOW).isFirstSighting, true);
eq('a clock set forward cannot go negative', resolveOfflineReturn(hoursAgo(-50), NOW).hours, 0);
eq('two days away reads as two days', resolveOfflineReturn(hoursAgo(48), NOW).days, 2);

console.log('\n-- the stage ladder --------------------------------------------------');

eq('an hour away is home', stageForHours(1).id, 'home');
eq('overnight is still not a return', stageForHours(11).greets, false);
eq('half a day is a breeze, and still silent', stageForHours(12).greets, false);
eq('three days is the first greeting', stageForHours(72).greets, true);
eq('a week climbs', stageForHours(168).id, 'climbing');
eq('a fortnight slumbers', stageForHours(336).id, 'slumber');
eq('a year is still only slumber', stageForHours(24 * 365).id, 'slumber');
// 「不要每次都顯示相同文字」 — a stage that greets and has one line would say the same thing every
// time, which is the one thing the brief asks this copy not to do.
eq(
  'every greeting stage has more than one line',
  [72, 168, 336].every((h) => stageForHours(h).lines.length > 1),
  true,
);

console.log('\n-- the growth curve --------------------------------------------------');

eq('nothing grows inside the quiet window', overgrowthBudget(QUIET_HOURS - 1), 0);
eq('nothing grows at the boundary itself', overgrowthBudget(QUIET_HOURS), 0);
eq('a day away is a handful', overgrowthBudget(24) <= 5, true);
eq('a week away is legible but not a jungle', overgrowthBudget(168) < OVERGROWTH_MAX, true);
eq('the ceiling holds at a year', overgrowthBudget(24 * 365), OVERGROWTH_MAX);

{
  // Monotonic and gradual: more time away is never LESS growth, and no single day is a cliff.
  let previous = 0;
  let biggestJump = 0;
  let monotonic = true;
  for (let day = 1; day <= 90; day += 1) {
    const budget = overgrowthBudget(day * 24);
    if (budget < previous) monotonic = false;
    biggestJump = Math.max(biggestJump, budget - previous);
    previous = budget;
  }
  eq('growth never goes backwards', monotonic, true);
  eq('no single day more than doubles a small island', biggestJump <= 4, true);
}

console.log('\n-- what grows, and when ----------------------------------------------');

{
  const day1 = overgrowthMix(24);
  eq('a day away is leaves only', [...day1.keys()], ['leaf']);

  const day3 = overgrowthMix(72);
  eq('three days has grass', day3.has('weed'), true);
  eq('three days has no vines yet', day3.has('vine'), false);

  const week = overgrowthMix(168);
  eq('a week is climbing', week.has('vine'), true);
  eq('a week has no cobwebs yet', week.has('web'), false);

  const long = overgrowthMix(24 * 40);
  eq('a long absence cobwebs', long.has('web'), true);
  eq('vines stay a detail', (long.get('vine') ?? 0) <= getOvergrowthKind('vine').cap, true);
  eq('cobwebs stay a detail', (long.get('web') ?? 0) <= getOvergrowthKind('web').cap, true);

  for (const kind of OVERGROWTH_KINDS) {
    eq(`${kind.id} never exceeds its cap`, (long.get(kind.id) ?? 0) <= kind.cap, true);
  }
  eq(
    'the mix never exceeds the ceiling',
    [...long.values()].reduce((a, b) => a + b, 0) <= OVERGROWTH_MAX,
    true,
  );
}

console.log('\n-- topping up, never re-rolling (§11/§12) -----------------------------');

{
  const first = growOvergrowth({ existing: [], hours: 168, ...world });
  eq('a week away actually grows something', first.length > 0, true);

  // The same absence, resolved a second time — this is the "logged in twice" case.
  const again = growOvergrowth({ existing: first, hours: 168, ...world });
  eq('a repeat login adds nothing', again.length, first.length);
  eq('a repeat login returns the same list', again === first, true);

  // A LONGER absence tops up rather than starting over, and keeps what was already there.
  const later = growOvergrowth({ existing: first, hours: 24 * 30, ...world });
  eq('more time away grows more', later.length > first.length, true);
  eq('nothing already standing is replaced', first.every((s) => later.includes(s)), true);

  // What the player cleared stays cleared.
  //
  // The guarantee is stated against the CLOCK, not against a "已整理" flag, and this is the pair
  // of checks that says which: arriving stamps `lastSeenAt`, so the very next login measures its
  // absence from that moment and is worth nothing. A player who tidies and comes back tomorrow
  // finds their work still done. A player who tidies and then leaves for another two months finds
  // the weeds back — which is the system working, not the tidy being undone.
  const cleared = tidyOvergrowthAt(later, later[0].x, later[0].z, HOME);
  eq('tidying removes something', cleared.removed.length > 0, true);

  const nextLogin = growOvergrowth({ existing: cleared.sprouts, hours: 2, ...world });
  eq('the next login grows nothing at all', nextLogin === cleared.sprouts, true);
  eq('so the island stays as the player left it', nextLogin.length < later.length, true);

  const muchLater = growOvergrowth({ existing: cleared.sprouts, hours: 24 * 60, ...world });
  eq('another two months away does grow again', muchLater.length > cleared.sprouts.length, true);
  eq('and still never past the ceiling', muchLater.length <= OVERGROWTH_MAX, true);
}

console.log('\n-- where it is allowed to grow ---------------------------------------');

{
  const grown = growOvergrowth({ existing: [], hours: 24 * 45, ...world });
  const ground = grown.filter((s) => getOvergrowthKind(s.kind).surface === 'ground');
  eq('a very long absence still spawns a full island', grown.length >= 20, true);

  eq(
    'nothing grows on the player spawn point',
    ground.every((s) => Math.hypot(s.x, s.z) > 2),
    true,
  );
  eq(
    'nothing grows off the grass',
    ground.every((s) => Math.hypot(s.x, s.z) < 5.7),
    true,
  );
  eq(
    'nothing grows inside the house',
    ground.every((s) => {
      const rx = s.x - HOME.position[0];
      const rz = s.z - HOME.position[2];
      const cos = Math.cos(-HOME.rotation);
      const sin = Math.sin(-HOME.rotation);
      return (
        Math.abs(rx * cos - rz * sin) > HOUSE_FOOTPRINT.halfWidth ||
        Math.abs(rx * sin + rz * cos) > HOUSE_FOOTPRINT.halfDepth
      );
    }),
    true,
  );
  eq(
    'no two sprouts share a spot',
    ground.every((a, i) => ground.every((b, j) => i === j || Math.hypot(a.x - b.x, a.z - b.z) > 0.3)),
    true,
  );
  eq(
    'every wall sprout has its own anchor',
    new Set(grown.filter((s) => s.slot >= 0).map((s) => s.slot)).size ===
      grown.filter((s) => s.slot >= 0).length,
    true,
  );
}

console.log('\n-- with no Home placed yet -------------------------------------------');

{
  const homeless = growOvergrowth({ existing: [], hours: 24 * 40, home: null, islandScale: 1, placements: [] });
  eq('the ground still grows', homeless.length > 0, true);
  eq('nothing clings to a house that is not there', homeless.every((s) => s.slot < 0), true);
}

console.log('\n-- tidying ------------------------------------------------------------');

{
  const grown = growOvergrowth({ existing: [], hours: 24 * 40, ...world });
  const target = grown.find((s) => getOvergrowthKind(s.kind).surface === 'ground')!;

  eq('standing in a patch offers a tidy', !!findTidyTarget(grown, target.x, target.z, HOME), true);
  eq(
    'what the prompt offers is what the action takes',
    findTidyTarget(grown, target.x, target.z, HOME)!.count,
    tidyOvergrowthAt(grown, target.x, target.z, HOME).removed.length,
  );

  // Far out to sea: nothing in reach, and therefore no prompt and no write.
  eq('an empty corner offers nothing', findTidyTarget(grown, 200, 200, HOME), null);
  const nothing = tidyOvergrowthAt(grown, 200, 200, HOME);
  eq('and tidying it removes nothing', nothing.removed.length, 0);
  eq('and returns the very same list, so no save is triggered', nothing.sprouts === grown, true);

  // At the house, one press takes the vines and cobwebs with the weeds.
  const atHome = tidyOvergrowthAt(grown, HOME.position[0], HOME.position[2] + 3, HOME);
  eq('tidying at the house clears its walls too', atHome.sprouts.every((s) => s.slot < 0), true);

  // Tidy everywhere, and the island comes back clean — nothing can be un-clearable.
  let left = grown;
  for (const sprout of grown) left = tidyOvergrowthAt(left, sprout.x, sprout.z, HOME).sprouts;
  left = tidyOvergrowthAt(left, HOME.position[0], HOME.position[2], HOME).sprouts;
  eq('everything that grows can be cleared', left.length, 0);
}

console.log('\n-- the pet ------------------------------------------------------------');

eq('an hour away leaves a lively pet', resolvePetMood(1), 'lively');
eq('overnight leaves a lively pet', resolvePetMood(11), 'lively');
eq('a few days quietens it', resolvePetMood(72), 'calm');
eq('a fortnight has it waiting', resolvePetMood(336), 'waiting');
eq('coming back is a reunion', resolvePetMood(336, { justReturned: true }), 'reunion');
eq('coming back from an hour out is not', resolvePetMood(1, { justReturned: true }), 'lively');
eq('vitality never bottoms out', vitalityForHours(24 * 3650) > 0, true);
eq('vitality is full at home', vitalityForHours(0), 1);
eq(
  'every mood still walks — none of them is a stopped pet',
  Object.values(PET_MOODS).every((m) => m.pace > 0 && m.liveliness > 0),
  true,
);
eq(
  'only the quiet moods put the bed out',
  Object.values(PET_MOODS).filter((m) => m.showsNest).map((m) => m.id),
  ['calm', 'waiting', 'reunion'],
);

console.log('\n-- nothing written may be `undefined` --------------------------------');

{
  // Firestore rejects an `undefined` field SYNCHRONOUSLY, before the request is sent — so one
  // optional field written as `{ x: undefined }` fails every write in the feature, and does it
  // with `invalid-argument`, whose generic "try again later" message points nowhere near the
  // cause. This is the check that stops the next optional field on PetLifeState repeating it.
  const hasUndefined = (value: unknown): boolean =>
    typeof value === 'object' && value !== null
      ? Object.values(value).some((v) => v === undefined || hasUndefined(v))
      : false;

  eq('a never-greeted pet omits lastGreetedAt entirely', 'lastGreetedAt' in makePetState('calm', 0.7), false);
  eq('a never-greeted pet carries no undefined', hasUndefined(makePetState('calm', 0.7)), false);
  eq('a greeted pet keeps the timestamp', makePetState('lively', 1, '2026-08-22T00:00:00.000Z').lastGreetedAt, '2026-08-22T00:00:00.000Z');
  eq('a greeted pet carries no undefined', hasUndefined(makePetState('lively', 1, '2026-08-22T00:00:00.000Z')), false);
  eq('the resting state carries no undefined', hasUndefined(PET_HOME_STATE), false);
  eq(
    'nothing the grower produces is undefined',
    hasUndefined(growOvergrowth({ existing: [], hours: 24 * 40, ...world })),
    false,
  );
}

console.log('\n-- 環境狀態 (the one calculation everything reads) ---------------------');

{
  const at = (count: number) =>
    resolveIslandAmbience(Array.from({ length: count }, (_, i) => ({
      id: `t${i}`,
      kind: 'weed' as const,
      x: 0,
      z: 0,
      slot: -1,
      seed: 0.5,
    })));

  // §7 — a clean island is not "nearly normal", it is EXACTLY normal, and it is the shared
  // constant, so the common case allocates nothing.
  eq('a clean island is the neutral constant itself', resolveIslandAmbience([]) === NEUTRAL_AMBIENCE, true);
  eq('so is a save with no sprout list at all', resolveIslandAmbience(undefined) === NEUTRAL_AMBIENCE, true);
  eq('and nothing about it is graded', NEUTRAL_AMBIENCE.wildness, 0);

  // §1/§2 — more time away means a more overgrown island means a duller one. Monotonic across the
  // whole range, so there is no count at which tidying one weed makes the island look WORSE.
  let monotonic = true;
  let biggestStep = 0;
  for (let count = 1; count <= OVERGROWTH_MAX; count += 1) {
    const prev = at(count - 1);
    const here = at(count);
    if (here.wildness < prev.wildness) monotonic = false;
    if (here.saturation > prev.saturation) monotonic = false;
    if (here.brightness > prev.brightness) monotonic = false;
    biggestStep = Math.max(biggestStep, here.wildness - prev.wildness);
  }
  eq('wildness only ever rises with the sprout count', monotonic, true);

  // §2/§23 — 「不要使用硬切換」. One more weed is never allowed to be a visible event; the whole
  // range is 26 objects, so any single step worth more than a few percent is a cliff.
  eq('no single sprout moves the island more than 5%', biggestStep < 0.05, true);

  // §2 — 「不要做成黑暗恐怖風格」, pinned as a number rather than as a comment. Whatever anyone
  // retunes later, the most overgrown island the game can produce stays a lit, coloured island.
  const worst = at(OVERGROWTH_MAX);
  eq('the worst case is still bright', worst.brightness >= 0.8, true);
  eq('the worst case is still exposed', worst.exposure >= 0.85, true);
  eq('the worst case still has its colour', worst.saturation >= 0.7, true);
  eq('the worst case is fully wild', worst.wildness, 1);
  eq('and it reads as needing a tidy, not as a ruin', worst.grade.id, 'wild');

  // A ceiling that cannot be exceeded, however the list got that long.
  eq('an over-full island cannot go past the ceiling', at(OVERGROWTH_MAX + 40).wildness, 1);

  // §5 — the named grades cover the range in order, and the first one starts at zero.
  eq('the grade ladder starts at zero', ISLAND_GRADES[0].fromWildness, 0);
  eq(
    'the grade ladder only ever climbs',
    ISLAND_GRADES.every((g, i) => i === 0 || g.fromWildness > ISLAND_GRADES[i - 1].fromWildness),
    true,
  );
  eq('a clean island is 整潔', at(0).grade.id, 'fresh');

  // §4 — vines are the last thing to appear and they LENGTHEN; they must be worth nothing on an
  // island that is barely grown, or a five-day absence hangs full-length ivy on the house.
  eq('a barely-grown island has no vine growth', at(3).vineGrowth, 0);
  eq('a fully overgrown one has all of it', worst.vineGrowth, 1);
  eq(
    'vine growth is always a fraction',
    Array.from({ length: OVERGROWTH_MAX + 1 }, (_, i) => at(i).vineGrowth).every((v) => v >= 0 && v <= 1),
    true,
  );
}

console.log('\n-- 環境會恢復 (§7 — tidying is the recovery) ---------------------------');

{
  // The property the whole design turns on: the grading is derived from what is STANDING on the
  // island, not from the clock, so clearing the island IS restoring it. If this ever fails, a
  // player who tidies every weed is left in a garden that is still dim for reasons they cannot see
  // and cannot act on — which is the failure mode the clock-driven version has by construction.
  const grown = growOvergrowth({ existing: [], hours: 24 * 30, ...world });
  const before = resolveIslandAmbience(grown);
  eq('a month away leaves a visibly overgrown island', before.wildness > 0.6, true);
  eq('and a visibly duller one', before.saturation < 1 && before.brightness < 1, true);

  // Clear half of it and the island must already be measurably brighter — recovery is continuous,
  // not something that only lands once the last weed is gone.
  const half = grown.slice(0, Math.floor(grown.length / 2));
  const midway = resolveIslandAmbience(half);
  eq('clearing half brings the light part-way back', midway.brightness > before.brightness, true);
  eq('but not all the way', midway.brightness < 1, true);

  // Clear all of it, through the real tidy path, and the island is exactly as it was.
  let left = grown;
  for (const sprout of grown) left = tidyOvergrowthAt(left, sprout.x, sprout.z, HOME).sprouts;
  left = tidyOvergrowthAt(left, HOME.position[0], HOME.position[2], HOME).sprouts;
  eq('tidying everything empties the island', left.length, 0);
  eq('and the environment is neutral again', resolveIslandAmbience(left) === NEUTRAL_AMBIENCE, true);
}

console.log('\n-- 短暫離線不改變任何東西 (§1 Stage 0) --------------------------------');

{
  // An overnight break has to be invisible — not "subtle", invisible. This runs the real grower at
  // the quiet threshold and asserts the island is untouched all the way through to the grading.
  const overnight = growOvergrowth({ existing: [], hours: QUIET_HOURS, ...world });
  eq('twelve hours grows nothing', overnight.length, 0);
  eq('and changes nothing on screen', resolveIslandAmbience(overnight) === NEUTRAL_AMBIENCE, true);

  // And the first day is present but nearly nothing, which is what the eased curve is for.
  const day = growOvergrowth({ existing: [], hours: 24, ...world });
  const dayAmbience = resolveIslandAmbience(day);
  eq('a day away grows a little', day.length > 0, true);
  eq('but barely dims the island', dayAmbience.brightness > 0.98, true);
  eq('and still reads as a tidy island', dayAmbience.grade.id, 'fresh');
}

console.log('\n-- 生成位置 (§14 — a preference, never a constraint) -------------------');

{
  // The shelter bias spends siting attempts being fussy about where growth lands. If it is ever
  // allowed to become a hard rule, the island quietly grows FEWER things than the curve authorised
  // — and because the grading reads the sprout list, a month away also stops looking like a month
  // away. This is the check that keeps the two halves honest; it caught exactly that regression
  // when the bias was first added on top of an eight-attempt siting loop.
  let worst = Infinity;
  for (let i = 0; i < 60; i += 1) {
    worst = Math.min(worst, growOvergrowth({ existing: [], hours: 24 * 30, ...world }).length);
  }
  eq('a long absence actually fills the island', worst >= OVERGROWTH_MAX - 4, true);

  // And the bias does what it is for: growth favours the corners beside the house over the open
  // middle of the lawn. Aggregated over many runs, because one run is a handful of dice rolls.
  let sheltered = 0;
  let total = 0;
  for (let i = 0; i < 40; i += 1) {
    for (const sprout of growOvergrowth({ existing: [], hours: 24 * 30, ...world })) {
      if (getOvergrowthKind(sprout.kind).surface !== 'ground') continue;
      total += 1;
      const d = Math.hypot(sprout.x - HOME.position[0], sprout.z - HOME.position[2]);
      if (d < 4.5) sheltered += 1;
    }
  }
  eq('most growth comes up in the sheltered corners', sheltered / total > 0.62, true);
  // Not ALL of it, though — a perfectly clean lawn reads as level design rather than as neglect.
  eq('but the open lawn still gets a scattering', sheltered / total < 0.95, true);
}

console.log('\n-- 離線褪色 (§1/§2 — a slide, never a switch) --------------------------');

{
  const left = (days: number) => 1 - colourDrainForHours(days * 24);

  // §2 — 「不要使用突然切換」, and the strongest possible form of it: sample the ENTIRE range at
  // hourly resolution and assert that no single hour of absence is ever a visible event. A
  // stepped implementation (「離線超過 X 天 → 直接變黑白」) fails this on the hour it steps.
  //
  // The step is measured only across the range that is actually DRAWN. The curve is steepest at
  // its own origin — the first hour past COLOUR_QUIET_HOURS is worth about 2%, because a power
  // curve below 1 leaves zero with an infinite slope — but every value there is under
  // COLOUR_MIN_DRAIN, where the veil is not mounted and the screen is untouched. Measuring
  // through the dead band would pin a number no player can see, and would push the tuning toward
  // a flatter curve to satisfy it; the assertion below is the requirement, and the one after it
  // is what makes the unmeasured part safe.
  let monotonic = true;
  let biggestStep = 0;
  let biggestHiddenDrain = 0;
  for (let hour = 1; hour <= COLOUR_FULL_DAYS * 24 + 48; hour += 1) {
    const prev = colourDrainForHours(hour - 1);
    const here = colourDrainForHours(hour);
    if (here < prev) monotonic = false;
    if (here < COLOUR_MIN_DRAIN) {
      biggestHiddenDrain = Math.max(biggestHiddenDrain, here);
      continue;
    }
    biggestStep = Math.max(biggestStep, here - prev);
  }
  eq('colour only ever drains, never comes back with time', monotonic, true);
  eq('no visible hour of absence is a jump', biggestStep < 0.01, true);
  eq('and everything below the threshold really is off screen', biggestHiddenDrain < COLOUR_MIN_DRAIN, true);

  // §1 — the ladder the brief spells out, as numbers. Not thresholds in the code (nothing branches
  // on these); this is the curve being held to the shape it was asked for, so a later retune that
  // makes a week away look like a month shows up here rather than on a player's screen.
  eq('an overnight break changes nothing at all', left(0.5), 1);
  eq('nor does a full day', left(1), 1);
  eq('three days is slightly faded', Math.abs(left(3) - 0.8) < 0.03, true);
  eq('ten days is halfway', Math.abs(left(10) - 0.5) < 0.03, true);
  eq('three weeks is nearly grey', Math.abs(left(21) - 0.2) < 0.04, true);
  eq('a month is black and white', left(COLOUR_FULL_DAYS + 1), 0);

  // §1 — 「完全黑白」 has to be reachable and then STAY reachable. A curve that merely approaches
  // zero never delivers the thing the brief asks for, and one that is not clamped would invert.
  eq('a very long absence stays black and white', left(365), 0);
  eq('and cannot go past it', colourDrainForHours(365 * 24 * 10) <= 1, true);

  // §15 — the short absences that make up almost every session produce no effect at all, which is
  // what keeps the veil unmounted and the common login free.
  eq('a same-day return is below the mount threshold', colourDrainForHours(20) < COLOUR_MIN_DRAIN, true);
  eq('so is a full day', colourDrainForHours(24) < COLOUR_MIN_DRAIN, true);
  eq('two days is not', colourDrainForHours(48) >= COLOUR_MIN_DRAIN, true);

  // Nonsense in, neutral out. `hours` comes from a parsed timestamp, so a clock set backwards or
  // a corrupt save must produce a normal-looking world rather than a NaN in a CSS filter.
  eq('a negative absence drains nothing', colourDrainForHours(-500), 0);
  eq('an unreadable absence drains nothing', colourDrainForHours(NaN), 0);

  // §14 — the admin presets are generated by inverting this same curve, so every level the panel
  // can show is a real point on it. If the inverse ever drifts, the panel starts demonstrating a
  // world no absence can produce.
  for (const stage of COLOUR_STAGES) {
    const hours = hoursForColourDrain(stage.previewDrain);
    eq(
      `preview 「${stage.label}」 round-trips through the real curve`,
      colourStageForDrain(colourDrainForHours(hours)).id,
      stage.id,
    );
  }
  eq(
    'and every preview except 正常彩色 is actually visible',
    COLOUR_STAGES.slice(1).every((s) => s.previewDrain >= COLOUR_MIN_DRAIN),
    true,
  );
  eq('the colour ladder starts at zero', COLOUR_STAGES[0].fromDrain, 0);
  eq(
    'and only ever climbs',
    COLOUR_STAGES.every((s, i) => i === 0 || s.fromDrain > COLOUR_STAGES[i - 1].fromDrain),
    true,
  );
}

console.log('\n-- 恢復演示 (§6/§7/§8 — the world comes back) --------------------------');

{
  const MONO = (COLOUR_FULL_DAYS + 1) * 24;
  const at = (t: number) => resolveIslandColour(MONO, t);

  // §6 — 「不要只是直接瞬間恢復正常彩色」. The world the player walks back into is the drained one,
  // and it is still drained a moment later; the recovery is something they watch happen.
  eq('the player arrives to a black and white island', at(0).saturation, 0);
  eq('and it is still black and white a beat later', at(RECOVERY_HOLD_SECONDS * 0.9).saturation, 0);
  eq('nothing is finished at arrival', at(0).done, false);

  // §7 — smooth all the way home, checked the same way the drain is: no frame of the animation
  // may be a jump. At 60fps a step of 4% would be a visible band.
  let smooth = true;
  let rising = true;
  let biggest = 0;
  let previous = at(0);
  for (let frame = 1; frame <= 600; frame += 1) {
    const here = at(frame / 60);
    if (here.saturation < previous.saturation - 1e-9) rising = false;
    if (here.bloom < previous.bloom - 1e-9) rising = false;
    biggest = Math.max(biggest, here.saturation - previous.saturation);
    previous = here;
  }
  smooth = biggest < 0.04;
  eq('the recovery only ever moves toward colour', rising, true);
  eq('and never in a visible step', smooth, true);

  // §8 — the colour arrives somewhere before it arrives everywhere. The bloom has to LEAD the
  // uniform lift through the middle of the animation, or the effect reads as a brightness slider
  // rather than as colour spreading out of the island.
  const mid = at(RECOVERY_HOLD_SECONDS + RECOVERY_SECONDS * 0.3);
  eq('colour is back in the middle of the frame first', mid.bloom > mid.saturation, true);
  eq('while most of the frame is still drained', mid.saturation < 0.5, true);

  // §13 — the effect must be a no-op BEFORE the element is removed, or the last frame flashes.
  // Both terms are checked because either one left short would do it on its own.
  const end = at(RECOVERY_HOLD_SECONDS + RECOVERY_SECONDS);
  eq('the recovery ends on exactly full colour', end.saturation, 1);
  eq('with the bloom past the whole frame', end.bloom, 1);
  eq('and reports itself finished', end.done, true);
  eq('and stays finished', at(9999).done, true);

  // §11 — 「數秒內」. Pinned so a later retune cannot quietly turn this into a cutscene.
  eq('the whole demo is a few seconds', RECOVERY_HOLD_SECONDS + RECOVERY_SECONDS <= 10, true);

  // §12 — a player who leaves mid-recovery. There is no stored progress to reconcile: the next
  // login measures a SHORTER absence and therefore arrives at a shallower drain, all the way down
  // to no effect at all. This is the property that makes the missing 「正在恢復」 flag safe.
  const interrupted = resolveIslandColour(MONO, RECOVERY_HOLD_SECONDS + RECOVERY_SECONDS * 0.5);
  eq('leaving halfway is a legal state, not an error', interrupted.done, false);
  eq('and coming back an hour later drains almost nothing', colourDrainForHours(1) < COLOUR_MIN_DRAIN, true);
  eq(
    'the second visit is always gentler than the first',
    colourDrainForHours(48) < colourDrainForHours(MONO),
    true,
  );

  // An absence too short to show is not a zero-length animation, it is no animation: the veil
  // reads `done` and never mounts. Identity, so the common case allocates nothing.
  eq('a short absence resolves to the shared neutral state', resolveIslandColour(20, 0) === CLEAR_COLOUR_STATE, true);
  eq('held previews of a short absence are neutral too', resolveIslandColour(20, null) === CLEAR_COLOUR_STATE, true);

  // §14 — the admin hold. Frozen at the arrival state and never `done`, so it stays on screen to
  // be looked at instead of curing itself while the tester reads the readout.
  const held = resolveIslandColour(MONO, null);
  eq('a held preview sits at the arrival state', held.saturation, 0);
  eq('and never completes on its own', held.done, false);
  eq('and shows no bloom, because nothing is recovering', held.bloom, 0);
}

console.log('\n-- 兩半互不干涉 (the clock half and the sprout half) --------------------');

{
  // The one structural claim the whole design rests on: the permanent grading knows nothing about
  // time, and the transient one knows nothing about the island. If either ever starts reading the
  // other's input, 「整理完島還是灰的」 (or 「恢復完之後又變灰」) is back.
  const grown = growOvergrowth({ existing: [], hours: 24 * 30, ...world });
  const ambience = resolveIslandAmbience(grown);

  // The permanent half stays inside its gentle band no matter how long the absence was — it is
  // the SPROUTS that dim it, and there are only ever OVERGROWTH_MAX of those.
  eq('a month away still leaves the light coloured', ambience.saturation >= 0.7, true);
  eq('the drain is the only thing that can reach greyscale', colourDrainForHours(24 * 31), 1);

  // And tidying, which is the permanent half's recovery, is untouched by any of this.
  let left = grown;
  for (const sprout of grown) left = tidyOvergrowthAt(left, sprout.x, sprout.z, HOME).sprouts;
  left = tidyOvergrowthAt(left, HOME.position[0], HOME.position[2], HOME).sprouts;
  eq('tidying still returns the island to neutral', resolveIslandAmbience(left) === NEUTRAL_AMBIENCE, true);
  // …and the colour drain does not care either way, because it never looked at the list.
  eq('and the drain is unchanged by tidying', colourDrainForHours(24 * 31), 1);
}

console.log(
  failures === 0
    ? `\nALL PASS (${checks} checks)\n`
    : `\n${failures} of ${checks} checks FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
