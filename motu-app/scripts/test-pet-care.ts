/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 寵物照護 — rules tests.
 *
 * Run with `npm run test:pet-care`. Same tsx-script style as `test:offline-return` and the
 * `audit:*` checks, because that is the test runner this repo has.
 *
 * The properties pinned here are the ones the brief states as REQUIREMENTS — the things that would
 * still typecheck, still run, and still be wrong:
 *
 *  §6/§20  nothing can reach zero, nothing is irreversible, and one bowl always brings an animal
 *          all the way back. There is no death mechanic and no state a player cannot recover from.
 *  §3/§15  the response to activity is CONTINUOUS and monotonic — no single point on the range is a
 *          visible step, so the animal changes gradually instead of switching.
 *  §16     time is measured, not counted: settling once over a long gap equals settling many times
 *          along it, and settling twice at the same instant changes nothing. This is the property
 *          that makes the offline case free and the one a refactor is most likely to break.
 *  §4      not being fed lowers activity, and lowered activity is what sends the animal to its bed.
 *  §7/§22  the behaviour decision is a pure function of a context — every behaviour is reachable,
 *          and an owner who walks away is always followed.
 *  §9      a resting spot is found from a DECLARED capability, never from an id or a name, and a
 *          bed the player placed always beats the improvised one.
 *  §11/§12 pet food is an ordinary stacking catalog item, and its declared summary matches what it
 *          actually does.
 */

import {
  ALL_PET_BEHAVIORS,
  PET_BEHAVIORS,
  PET_CARE_TUNING,
  PET_CONDITION_BANDS,
  PET_FOOD_EFFECT_RANGE,
  PET_LEASH_DISTANCE,
  applyPetCareEffects,
  combinePetMotion,
  decidePetBehavior,
  newPetCareState,
  petActivityResponse,
  petCondition,
  readPetCareState,
  readPetCareStates,
  settlePetCare,
  withPetCare,
  type PetBehaviorContext,
  type PetBehaviorId,
  type PetCareState,
} from '../src/constants/petCare';
import {
  consumableAcceptsSpecies,
  getConsumablesFor,
  getPetFoodsFor,
  petEffectsFrom,
} from '../src/constants/consumables';
import {
  ALL_PET_HABITAT_KINDS,
  PET_HABITAT_KINDS,
  getHabitatItems,
} from '../src/constants/petHabitats';
import { ALL_PET_SPECIES, PET_SPECIES, PET_SPECIES_TABLE } from '../src/constants/pets';
import { isPetSupplyItem, speciesServedBy } from '../src/lib/petCompatibility';
import { PET_MOODS } from '../src/constants/islandReturn';
import { ALL_ITEMS, getItemById } from '../src/constants/items';
import {
  getCategoryPlacementScope,
  getDisplayCategory,
  getPlacementCategoriesIn,
} from '../src/utils/categoryUtils';
import { collectRestingSpots, resolveRestingSpot } from '../src/lib/petRestingSpots';
import type { PlacedItem } from '../src/types';

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
const NOW = Date.parse('2026-08-31T12:00:00Z');
/** A care state stamped `h` hours before NOW, so settling it to NOW measures exactly that gap. */
const stateAgo = (h: number, nutrition = 1, energy = 1): PetCareState => ({
  nutrition,
  energy,
  updatedAt: new Date(NOW - h * HOURS).toISOString(),
});

const round = (n: number) => Math.round(n * 1e6) / 1e6;

console.log('\n-- nothing can be lost (§6, §20) --------------------------------------');

{
  // A YEAR away. If any state in this system can be reached that a player cannot walk back from,
  // this is where it is.
  const abandoned = settlePetCare(stateAgo(24 * 365), NOW);
  eq('a year away never empties the bowl', abandoned.nutrition >= PET_CARE_TUNING.nutritionFloor, true);
  eq('a year away never stops the animal', abandoned.energy >= PET_CARE_TUNING.energyFloor, true);
  eq('and both are still real numbers', Number.isFinite(abandoned.nutrition + abandoned.energy), true);

  // One bowl of the game's actual food, on the game's actual worst case.
  const food = getItemById('petfood-basic')!;
  const fed = applyPetCareEffects(abandoned, petEffectsFrom(food.consumable!.effects), NOW);
  eq('one bowl visibly moves the worst case', fed.delta.nutrition > 0.4, true);
  // Two bowls, because one is deliberately not a full bowl (§15: no instant switch).
  const twice = applyPetCareEffects(fed.state, petEffectsFrom(food.consumable!.effects), NOW);
  eq('two bowls fill it completely', round(twice.state.nutrition), 1);

  // …and the activity climbs back on its own once nutrition is up, which is what makes the
  // consequence of neglect fully reversible rather than merely survivable. Half a day, because
  // energy is deliberately lagged behind food (§15 — no instant switch).
  const rested = settlePetCare(twice.state, NOW + 12 * HOURS);
  eq('a fed animal is lively again by the next day', rested.energy > 0.8, true);
  eq('and it is far above where it was', rested.energy - abandoned.energy > 0.4, true);
  eq('right back to the top of the ladder', petCondition(rested).band.id, 'thriving');

  // The lowest band is a real, reachable state — and it is the LOWEST one. A ladder whose bottom
  // rung is unreachable is one whose copy nobody ever reads.
  eq('the worst case lands on the lowest band', petCondition(abandoned).band.id, 'drowsy');
  eq('the lowest band is where the ladder starts', PET_CONDITION_BANDS[0].fromActivity, 0);
}

console.log('\n-- time is measured, never counted (§16) ------------------------------');

{
  // The property the whole offline story rests on: one settle over a gap equals many settles along
  // it. If this fails, a player who left the tab open gets a different pet from one who closed it.
  const start = stateAgo(0, 0.9, 0.8);
  const once = settlePetCare({ ...start }, NOW + 72 * HOURS);

  let stepped = { ...start };
  for (let h = 1; h <= 72; h++) stepped = settlePetCare(stepped, NOW + h * HOURS);

  eq(
    'one long settle ≈ many short ones (nutrition)',
    Math.abs(once.nutrition - stepped.nutrition) < 1e-9,
    true,
  );
  // Energy is solved exactly rather than approximated, so this is not merely 「close enough」: the
  // two agree to floating-point noise. An approximation would drift with how often it was applied,
  // which is the same as saying a background tab would produce a different animal.
  eq('one long settle == many short ones (energy)', Math.abs(once.energy - stepped.energy) < 1e-9, true);

  // Idempotent at the same instant: every reader settles freely, and none of them has to coordinate.
  const settled = settlePetCare(stateAgo(30), NOW);
  eq('settling twice at the same instant is a no-op', settlePetCare(settled, NOW), settled);

  // A clock that went backwards must never be a way to restore an animal.
  const rewound = settlePetCare(stateAgo(-100, 0.3, 0.3), NOW);
  eq('a backwards clock restores nothing', rewound.nutrition, 0.3);

  // Junk out of the document store is a healthy animal, not NaN walking into the movement code.
  const junk = readPetCareState({ nutrition: 'lots', energy: null, updatedAt: 42 }, NOW);
  eq('unreadable stored state reads as healthy', [junk.nutrition, junk.energy], [1, 1]);
  eq('an absent state is a brand-new pet', readPetCareState(undefined, NOW), newPetCareState(NOW));
}

console.log('\n-- neglect lowers activity, gradually (§3, §4, §15) -------------------');

{
  // Monotonic in time away: more neglect is never MORE activity.
  let previous = 2;
  let monotonic = true;
  for (let days = 0; days <= 30; days++) {
    const activity = petCondition(settlePetCare(stateAgo(0), NOW + days * 24 * HOURS)).activity;
    if (activity > previous + 1e-9) monotonic = false;
    previous = activity;
  }
  eq('activity never rises with more neglect', monotonic, true);

  // And it visibly falls: a system where nothing changes is also monotonic.
  const day1 = petCondition(settlePetCare(stateAgo(0), NOW + 24 * HOURS)).activity;
  const day7 = petCondition(settlePetCare(stateAgo(0), NOW + 7 * 24 * HOURS)).activity;
  eq('a week of neglect is plainly quieter than a day', day1 - day7 > 0.2, true);

  // §15: no single step across the whole range is a visible jump. This is the check that would
  // catch someone replacing the interpolation with a threshold ladder.
  let biggestStep = 0;
  for (let i = 1; i <= 200; i++) {
    const a = petActivityResponse(i / 200);
    const b = petActivityResponse((i - 1) / 200);
    biggestStep = Math.max(
      biggestStep,
      Math.abs(a.pace - b.pace),
      Math.abs(a.liveliness - b.liveliness),
      Math.abs(a.nestPull - b.nestPull),
    );
  }
  eq('the motion response has no visible step anywhere', biggestStep < 0.02, true);

  // Pace never reaches zero. A pet that stops dead reads as broken, not as tired.
  eq('even a listless animal still walks', petActivityResponse(0).pace > 0.5, true);
  eq('a well-fed animal is not slowed at all', petActivityResponse(1).pace >= 1, true);

  // Nutrition reaches behaviour THROUGH energy — the causal chain the whole system is built on.
  const starved = settlePetCare(stateAgo(0, 0.2, 1), NOW + 48 * HOURS);
  const full = settlePetCare(stateAgo(0, 1, 1), NOW + 48 * HOURS);
  eq('low nutrition drags activity down with it', starved.energy < full.energy, true);

  // Neither system may overwrite the other: a quiet mood and a hungry animal compose.
  const quiet = combinePetMotion(PET_MOODS.waiting, petActivityResponse(0.2));
  eq('mood and care multiply rather than replace', quiet.pace < PET_MOODS.waiting.pace, true);
  eq('and the stronger pull toward the bed wins', quiet.nestPull >= PET_MOODS.waiting.nestPull, true);
}

console.log('\n-- the behaviour layer (§7, §21, §22) --------------------------------');

{
  const base: PetBehaviorContext = {
    activity: 0.9,
    nestPull: 0,
    ownerDistance: 2,
    ownerMoving: false,
    restDistance: 8,
    ownerNearRest: false,
    previous: 'follow',
  };

  // Sampling with a fixed sweep of rolls rather than Math.random, so this is a statement about the
  // distribution rather than about one lucky draw.
  const sample = (ctx: PetBehaviorContext) => {
    const counts = new Map<PetBehaviorId, number>();
    for (let i = 0; i < 400; i++) {
      const id = decidePetBehavior(ctx, i / 400);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  };

  // An owner who walks off is followed, whatever the animal would rather do. Otherwise a player
  // reads a resting pet as one that is broken.
  eq(
    'an owner past the leash is always followed',
    decidePetBehavior({ ...base, activity: 0, nestPull: 1, ownerDistance: PET_LEASH_DISTANCE + 1 }, 0.99),
    'follow',
  );

  // A lively animal mostly follows, and explores sometimes — 「有正常 Idle 行為、可以探索」.
  const lively = sample(base);
  eq('a lively pet mostly follows', (lively.get('follow') ?? 0) > 150, true);
  eq('a lively pet also explores', (lively.get('wander') ?? 0) > 0, true);
  eq('a lively pet never takes itself to bed', (lively.get('goToBed') ?? 0) + (lively.get('rest') ?? 0), 0);

  // A neglected animal, owner elsewhere: it heads for its bed. This is 「躲在窩裡」, and it is the
  // consequence the whole feature is built to produce.
  const tired = sample({ ...base, activity: 0.15, nestPull: 0.9, ownerDistance: 10, previous: 'idle' });
  eq('a listless pet heads for its bed', (tired.get('goToBed') ?? 0) > 100, true);
  eq('a listless pet rarely explores', (tired.get('wander') ?? 0), 0);

  // …and gets up the moment its owner comes over. This needs no code of its own — it is what
  // happens when the resting weights go to zero.
  const noticed = sample({ ...base, activity: 0.15, nestPull: 0.9, ownerDistance: 1.5, restDistance: 0.2 });
  eq('a resting pet gets up when you come to it', (noticed.get('rest') ?? 0) + (noticed.get('goToBed') ?? 0), 0);

  // Resting happens IN the bed, never on the way to it — §21's 「不要 teleport 到寵物窩」 expressed
  // as the property that actually prevents it.
  const enRoute = sample({ ...base, activity: 0.1, nestPull: 1, ownerDistance: 10, restDistance: 6 });
  eq('a pet only rests once it has arrived', enRoute.get('rest') ?? 0, 0);

  // Every declared behaviour is reachable. A table entry nothing can select is dead data that
  // still reads like a feature.
  const reachable = new Set<PetBehaviorId>();
  for (const activity of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    for (const ownerDistance of [1, 5, 10]) {
      for (const restDistance of [0.3, 1, 6]) {
        for (const ownerMoving of [false, true]) {
          for (const nestPull of [0, 0.5, 1]) {
            for (let i = 0; i < 20; i++) {
              reachable.add(
                decidePetBehavior(
                  { ...base, activity, nestPull, ownerDistance, restDistance, ownerMoving },
                  i / 20,
                ),
              );
            }
          }
        }
      }
    }
  }
  eq('every behaviour in the table is reachable', reachable.size, ALL_PET_BEHAVIORS.length);

  // The anchors have to be honoured by the mover, so at least assert the table is coherent: the
  // two resting behaviours aim at the bed, and following aims at the owner.
  eq('goToBed and rest both aim at the bed', [PET_BEHAVIORS.goToBed.anchor, PET_BEHAVIORS.rest.anchor], ['rest', 'rest']);
  eq('following aims at the owner', PET_BEHAVIORS.follow.anchor, 'owner');
  eq('only the two settled behaviours are settled', ALL_PET_BEHAVIORS.filter((b) => b.settled).map((b) => b.id), ['idle', 'rest']);
}

console.log('\n-- resting spots are declared, never named (§9) -----------------------');

{
  const HOME = { position: [2, 0, -1] as [number, number, number], rotation: 0.6 };
  const bed: PlacedItem = {
    instanceId: 'bed-a',
    itemId: 'petbed-outdoor-basic',
    position: [7, 0, 3],
    rotation: 0,
  };
  const notABed: PlacedItem = {
    instanceId: 'tree-a',
    itemId: 'deco-campfire',
    position: [7.1, 0, 3.1],
    rotation: 0,
  };

  const none = resolveRestingSpot({ placements: [notABed], home: HOME, islandScale: 1 });
  eq('with no bed placed, the improvised spot is used', none.source, 'default');

  const withBed = resolveRestingSpot({ placements: [notABed, bed], home: HOME, islandScale: 1 });
  eq('a placed bed wins over the improvised spot', withBed.source, 'item');
  eq('and it is where the player actually put it', [withBed.x, withBed.z], [7, 3]);
  eq('the reach comes from the item, not from a constant', withBed.radius, getItemById('petbed-outdoor-basic')!.petRest!.radius);

  // Nothing is found by id or by name: the ONLY thing that makes a placement a resting spot is the
  // declared capability. A campfire sitting 10cm from the bed is not one.
  eq('a piece with no petRest is never a resting spot', collectRestingSpots({ placements: [notABed], home: HOME }).length, 0);

  // Two beds resolve to a stable winner, on every device and every reload — an order that depended
  // on where the pet happened to be standing would have it change its mind mid-garden.
  const farther: PlacedItem = { instanceId: 'bed-b', itemId: 'petbed-outdoor-basic', position: [20, 0, 20], rotation: 0 };
  const forwards = resolveRestingSpot({ placements: [bed, farther], home: HOME, islandScale: 1 });
  const backwards = resolveRestingSpot({ placements: [farther, bed], home: HOME, islandScale: 1 });
  eq('the same bed wins whatever order the placements are in', forwards.instanceId, backwards.instanceId);
  eq('and it is the one nearest the Home', forwards.instanceId, 'bed-a');

  // Every declared resting spot must actually be REACHABLE FROM A BUILD RAIL, or it is a bed the
  // player can own and never put down — which is the exact bug `placementScope` exists to prevent
  // (utils/categoryUtils.ts). Asserted against the rail's own resolver rather than against the shop
  // section, because the two are deliberately allowed to differ: 寵物窩 is browsed under 寵物 and
  // placed outdoors. Anything that stops it appearing in a rail fails here.
  for (const item of ALL_ITEMS.filter((i) => i.petRest)) {
    const category = getDisplayCategory(item.shopCategory)!;
    eq(`${item.name} is a placeable object`, category.kind, 'placeable');
    const scope = getCategoryPlacementScope(category);
    eq(
      `${item.name} is on the build rail it is scoped to`,
      getPlacementCategoriesIn(scope, ['placeable']).some((c) => c.id === item.shopCategory),
      true,
    );
  }
}

console.log('\n-- pet food is an ordinary item (§11, §12) ----------------------------');

{
  const foods = getConsumablesFor('pet');
  eq('there is at least one pet food in the catalog', foods.length >= 1, true);

  for (const food of foods) {
    const spec = food.consumable!;
    const category = getDisplayCategory(food.shopCategory);

    // It stacks and is spent — not worn, not placed, not applied. That is what `consumable` means
    // in the taxonomy, and it is what puts the bag in the ordinary inventory rather than in one of
    // its own (§12).
    eq(`${food.name} lives on a consumable shelf`, category?.kind, 'consumable');
    eq(`${food.name} is bought with gold like anything else`, food.price > 0, true);

    // Amounts stay inside the sanity range: a mistyped 4 in a catalog row can only ever be a bowl
    // that fills the animal, never one that does something impossible.
    for (const effect of spec.effects) {
      eq(
        `${food.name}'s ${effect.kind} is a sane amount`,
        effect.amount >= PET_FOOD_EFFECT_RANGE.min && effect.amount <= PET_FOOD_EFFECT_RANGE.max,
        true,
      );
    }

    // The written summary has to be true. It is hand-written on purpose (a generated one reads like
    // a spreadsheet), which is exactly why it needs a guard against drifting away from the numbers.
    const applied = petEffectsFrom(spec.effects);
    if (applied.nutrition > 0) {
      eq(
        `${food.name}'s summary mentions the nutrition it gives`,
        spec.effectSummary.includes(`${Math.round(applied.nutrition * 100)}%`),
        true,
      );
    }
    if (applied.energy > 0) {
      eq(
        `${food.name}'s summary mentions the activity it gives`,
        spec.effectSummary.includes(`${Math.round(applied.energy * 100)}%`),
        true,
      );
    }

    // Feeding a full animal must never be able to take a bag for nothing — the caller refuses it,
    // but the maths must agree that there was nothing to give.
    const full = applyPetCareEffects({ nutrition: 1, energy: 1, updatedAt: new Date(NOW).toISOString() }, applied, NOW);
    eq(`${food.name} gives a full animal nothing`, [round(full.delta.nutrition), round(full.delta.energy)], [0, 0]);
  }
}

console.log('\n-- 休息處按物種適配，不是按名字 (§1, §3, §4, §5) ----------------------');

{
  // The compatibility system in one assertion per row: a home says which shapes it is and which
  // animals it takes, and the SHAPE bounds the animals. A 「鳥也能睡的狗屋」 typo — the exact thing
  // §1 exists to prevent — fails right here rather than shipping as a bird standing in a kennel.
  const habitats = ALL_ITEMS.filter((i) => i.petRest);
  eq('the catalog sells more than one kind of home', habitats.length >= 6, true);

  for (const item of habitats) {
    const spec = item.petRest!;
    const kind = PET_HABITAT_KINDS[spec.kind];
    eq(`${item.name} declares a real habitat kind`, !!kind, true);
    eq(`${item.name} is for at least one species`, spec.species.length > 0, true);
    eq(
      `${item.name}'s species all fit a ${kind.label}`,
      spec.species.every((s) => kind.suitableFor.includes(s)),
      true,
    );
    // §9's constraint, as data. A raised resting place is only reachable by something that flies:
    // this game has no climbing, so a dog bed at height 1 would be a bed the dog stands under
    // forever. Only the perch postures may declare a height, and they must.
    if (kind.posture === 'perch') {
      eq(`${item.name} is somewhere a bird can land on`, (spec.height ?? 0) > 0, true);
    } else {
      eq(`${item.name} is on the ground, where a walker can reach it`, spec.height ?? 0, 0);
    }
  }

  // Every species the game sells has somewhere to sleep. A species with animals and no homes is
  // the state this whole change was made to get out of.
  for (const species of PET_SPECIES) {
    eq(
      `${PET_SPECIES_TABLE[species].label} has homes it can use`,
      getHabitatItems(species).length >= 2,
      true,
    );
  }

  // And the filtering is real, not decorative: put one of everything on the island and each animal
  // resolves only its own.
  const HOME = { position: [0, 0, 0] as [number, number, number], rotation: 0 };
  const placements: PlacedItem[] = habitats.map((item, i) => ({
    instanceId: `h-${i}`,
    itemId: item.id,
    position: [i * 3, 0, 0] as [number, number, number],
    rotation: 0,
  }));

  for (const species of PET_SPECIES) {
    const seen = collectRestingSpots({ placements, home: HOME, species });
    eq(
      `a ${PET_SPECIES_TABLE[species].label} sees only homes that accept it`,
      seen.every((spot) => getItemById(spot.itemId!)!.petRest!.species.includes(species)),
      true,
    );
    eq(`a ${PET_SPECIES_TABLE[species].label} sees some`, seen.length > 0, true);
  }

  // The specific failure §1 names: a bird with only a dog bed placed has NO owned spot and falls
  // back to the improvised nest — it does not claim the kennel.
  const kennelOnly: PlacedItem[] = [
    { instanceId: 'k', itemId: 'pethome-dog-cabin', position: [4, 0, 0], rotation: 0 },
  ];
  eq(
    'a bird never settles in a dog house',
    resolveRestingSpot({ placements: kennelOnly, home: HOME, islandScale: 1, petItemId: 'pet-bird-budgie' }).source,
    'default',
  );
  eq(
    'but a dog does',
    resolveRestingSpot({ placements: kennelOnly, home: HOME, islandScale: 1, petItemId: 'pet-dog-shiba' }).source,
    'item',
  );

  // A bird's own home carries the height it lands at, all the way through to the resolved spot —
  // the number Three/IslandPet.tsx flies to.
  const perch: PlacedItem[] = [
    { instanceId: 'p', itemId: 'pethome-bird-perch', position: [2, 0, 0], rotation: 0 },
  ];
  const landed = resolveRestingSpot({ placements: perch, home: HOME, islandScale: 1, petItemId: 'pet-bird-canary' });
  eq('a perch is somewhere off the ground', landed.height > 0.5, true);
  eq('and the bird grips it rather than lying on it', landed.posture, 'perch');
  // The label is the item's own name, never a second copy of it written on the spec.
  eq('a spot is called what the item is called', landed.label, getItemById('pethome-bird-perch')!.name);
}

console.log('\n-- 飼料按物種適配 (§10, §11, §17) --------------------------------------');

{
  const foods = getConsumablesFor('pet');
  eq('there is a real shelf of food, not one bag', foods.length >= 6, true);

  for (const species of PET_SPECIES) {
    const label = PET_SPECIES_TABLE[species].label;
    const forSpecies = getPetFoodsFor(species);
    // Two each at minimum — one meal and one treat — so 「餵食」 is a choice rather than a button.
    eq(`${label} has at least two things it can eat`, forSpecies.length >= 2, true);
    // §17, stated as the property that matters: nothing a player could be shown for this animal is
    // a food this animal cannot have.
    eq(
      `nothing offered to ${label} is incompatible with it`,
      forSpecies.every((f) => consumableAcceptsSpecies(f.consumable!, species)),
      true,
    );
    // …and the filter actually removes things. A filter that returns everything is not a filter.
    eq(`${label}'s list is narrower than the whole shelf`, forSpecies.length < foods.length, true);
  }

  // The universal foods really are universal, and the species-specific ones really are not.
  const universal = foods.filter((f) => !f.consumable!.species);
  eq('there is at least one food every animal can eat', universal.length >= 1, true);
  for (const food of universal) {
    eq(
      `${food.name} is offered to every species`,
      PET_SPECIES.every((s) => getPetFoodsFor(s).some((f) => f.id === food.id)),
      true,
    );
  }
  const dogOnly = getItemById('petfood-dog-stew')!;
  eq('a dog food is invisible to a cat', getPetFoodsFor('cat').some((f) => f.id === dogOnly.id), false);
  eq('a dog food is invisible to a bird', getPetFoodsFor('bird').some((f) => f.id === dogOnly.id), false);

  // Meals and treats are told apart by their NUMBERS, not by a 「食物類型」 field — there is none.
  // What has to hold is that the shelf actually contains both shapes for every species, or
  // 「不同食物應在恢復效果上有差異」 (§12) is a claim the data does not back.
  for (const species of PET_SPECIES) {
    const applied = getPetFoodsFor(species).map((f) => petEffectsFrom(f.consumable!.effects));
    eq(
      `${PET_SPECIES_TABLE[species].label} has a proper meal to eat`,
      applied.some((a) => a.nutrition >= 0.5),
      true,
    );
    eq(
      `${PET_SPECIES_TABLE[species].label} has a treat, not just meals`,
      applied.some((a) => a.energy > a.nutrition),
      true,
    );
  }
}

console.log('\n-- 一隻寵物一份狀態 (§6, §21) -----------------------------------------');

{
  const dog = 'pet-dog-shiba';
  const cat = 'pet-cat-orange';
  const hungry: PetCareState = { nutrition: 0.2, energy: 0.25, updatedAt: new Date(NOW).toISOString() };
  const full: PetCareState = { nutrition: 1, energy: 1, updatedAt: new Date(NOW).toISOString() };

  const before = { [dog]: hungry, [cat]: full };
  const fed = applyPetCareEffects(before[dog], petEffectsFrom(getItemById('petfood-dog-stew')!.consumable!.effects), NOW);
  const after = withPetCare(before, dog, fed.state, NOW);

  eq('feeding one pet feeds that pet', after[dog].nutrition > before[dog].nutrition, true);
  // The assertion the whole per-pet map exists for. A missing spread here would read as a feature
  // working perfectly — every pet would just quietly share one appetite.
  eq('feeding one pet leaves the others exactly as they were', after[cat], before[cat]);
  eq('and does not invent animals nobody owns', Object.keys(after).sort(), [cat, dog].sort());

  // Junk out of the document store must not become a phantom pet in the household.
  const cleaned = withPetCare({ [dog]: hungry, '': full, bad: 42 }, cat, full, NOW);
  eq('an unreadable entry is dropped rather than repaired', Object.keys(cleaned).sort(), [cat, dog].sort());
  eq('a map that is not a map reads as an empty household', readPetCareStates('nope', NOW), {});
}

console.log('\n-- 新增一種寵物不需要改程式 (§6, §24) ---------------------------------');

{
  // The claim this whole design makes, checked as far as data can check it: every species in the
  // table is fully described BY the table, so nothing downstream needs a branch to handle one.
  for (const species of PET_SPECIES) {
    const def = PET_SPECIES_TABLE[species];
    eq(`${species} is in the species table`, def?.id, species);
    eq(`${species} has a word for a shelf`, def.label.length > 0, true);
    eq(`${species} has a word for a sentence`, def.companionNoun.length > 0, true);
    eq(`${species} says how it gets around`, ['ground', 'air'].includes(def.locomotion), true);
    // The shelf its animals are sold on has to be real, or 「去買一隻」 links nowhere.
    eq(`${species}'s animals have a shelf`, !!getDisplayCategory(def.shopCategory), true);
    eq(
      `${species}'s shelf actually has animals on it`,
      ALL_ITEMS.some((i) => i.shopCategory === def.shopCategory),
      true,
    );
  }
  eq('every species in the table is one the id parser knows', ALL_PET_SPECIES.length, PET_SPECIES.length);

  // Every habitat kind is reachable from the catalog. A kind nothing is sold as is dead vocabulary
  // that still reads like a feature — the same rule the behaviour table is held to above.
  const kindsSold = new Set(ALL_ITEMS.filter((i) => i.petRest).map((i) => i.petRest!.kind));
  eq('every declared habitat kind is actually sold', kindsSold.size, ALL_PET_HABITAT_KINDS.length);
}

console.log('\n-- 寵物用品都在寵物分頁 (§23) -----------------------------------------');

{
  // §23: 狗窩 / 貓飼料 / 鳥籠 must not be scattered through 家具 / 飾品 / 特殊商品. Every pet supply
  // in the catalog is asserted to be on a 寵物 shelf, so a new one filed under 花園 fails here
  // rather than being found by a player who went looking in the wrong section.
  for (const item of ALL_ITEMS.filter(isPetSupplyItem)) {
    const category = getDisplayCategory(item.shopCategory);
    eq(`${item.name} is browsed under 寵物`, category?.mainSection, 'PET');
  }

  // And the shop's species chips are derived from the shelf rather than hard-coded: both pet
  // shelves serve all three species, so both get the full row.
  for (const shelf of ['PetSupplies', 'PetHomes']) {
    const items = ALL_ITEMS.filter((i) => i.shopCategory === shelf);
    eq(`${shelf} offers a chip for every species`, speciesServedBy(items), [...PET_SPECIES]);
  }
}

console.log(
  failures === 0
    ? `\nALL PASS (${checks} checks)\n`
    : `\n${failures} of ${checks} checks FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
