/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 寵物照護 — 「這是一隻正在島上生活的動物」的資料與規則。
 *
 * The data-and-rules half of the Pet Care System, in the same split every other feature in this
 * codebase uses (constants/islandReturn.ts ↔ context/useIslandLife.ts, constants/utilityCards.ts ↔
 * context/useUtilityCards.ts): pure data and pure functions here, no React, no Firestore, no clock
 * of its own. `lib/petRestingSpots.ts` answers where the animal may lie down,
 * `context/usePetCare.ts` owns the one write, Three/IslandPet.tsx turns the decision into movement,
 * and UI/PetCarePanel.tsx is the only place the numbers are ever shown.
 *
 * ## What this is NOT, and must never become
 *
 * It is not a survival simulator. There is no health, no death, no illness, no starvation and no
 * irreversible loss anywhere in this file — the same rule constants/islandReturn.ts is written
 * under, and for the same reason: the game is 島嶼生活, not a creature that punishes you for having
 * a life. Every value here has a FLOOR above zero, every value recovers completely from one feed,
 * and nothing here can gate an interaction, take an item, or cost the player a coin.
 *
 * What poor care produces is exactly one thing: **fewer signs of activity**. The animal moves less,
 * settles more often, and eventually goes and lies down in its own bed — which the player can see,
 * walk over to, and fix. That is the whole consequence, and it is meant to read as 「牠在等你」
 * rather than as 「你輸了」.
 *
 * ## Two numbers, and why they are not seven
 *
 * The brief lists energy / nutrition / mood / lastFedAt / lastActiveAt / resting / currentBehavior
 * as things a pet state COULD hold, and says explicitly not to copy the list. Four of them already
 * exist or must not be stored: `mood` is 離線回歸's (constants/islandReturn.ts), `lastActiveAt` is
 * its `lastSeenAt`, and `resting`/`currentBehavior` are DERIVED — a stored behaviour is one that
 * can disagree with what the animal is visibly doing, and it would have to be written every few
 * seconds to stay true. So the persisted state is two numbers and a timestamp:
 *
 *   nutrition → energy → activity → behaviour → what you see on screen
 *
 * Nutrition is what feeding restores; energy is what nutrition slowly pulls up or down; activity is
 * energy read as a multiplier; behaviour is chosen from activity. Each arrow is one function below,
 * and adding 心情 or 親密度 later is another stored number and another term in {@link petCondition}
 * — not another branch anywhere else.
 *
 * ## Time is measured, never counted
 *
 * Nothing here ticks. {@link settlePetCare} takes a state and 「now」 and returns what that state has
 * become — as a closed form, so settling once after three days and settling a hundred times along
 * the way produce the same answer to within floating point. That is what makes the offline case
 * (brief §16) free: there is no 「離線期間」 code path, because being away is just a larger gap
 * between two timestamps. It is also what keeps this cheap with many pets (§22): a pet's numbers are
 * recomputed when something asks for them, not on a timer per animal.
 */


/* --- Tuning ------------------------------------------------------------------------------- */

/**
 * Every number in the care simulation, in one table.
 *
 * These are PROVISIONAL and are meant to be argued with — the brief is explicit that the balance is
 * not decided yet, so they live here, together, rather than being scattered through the functions
 * that use them. Nothing outside this file may hard-code a hunger time, a decay rate or a floor.
 *
 * The shape they are chosen to produce, for whoever re-tunes them:
 *
 *  - A player who logs in most days never sees any of this. One feed covers about two days, and
 *    energy sits at its ceiling the whole time.
 *  - A few days away and the animal is visibly quieter — it settles more, follows less eagerly, and
 *    starts spending time at its own bed. Nothing is lost.
 *  - Two weeks away and it is mostly resting in the bed. That is the FLOOR: it never gets worse than
 *    「牠在窩裡等你」, and one bowl of food brings it all the way back.
 */
export const PET_CARE_TUNING = {
  /**
   * How much 營養 drains in a day, as a fraction of a full bowl.
   *
   * 0.3 means a full bowl runs down over a bit more than three days, and one serving of the game's
   * actual food (0.55, see 基礎飼料 in constants/items.ts) covers about two. Deliberately slow: a
   * cosy game whose companion needs feeding twice a day is a game with a chore in it, and the
   * brief's §20 rules that out. It is also why there is no 「飢餓時間」 constant anywhere — hunger
   * here is a slope, not a deadline.
   *
   * The shape it produces, which is what to check when re-tuning it: a player who feeds and comes
   * back the next day finds a 悠閒 animal, a week away finds a 懶洋洋 one, and everything past that
   * is the same 懶洋洋 animal — the floor is reached at about three days and nothing gets worse
   * after it.
   */
  nutritionDrainPerDay: 0.3,
  /**
   * How low 營養 is allowed to fall. NOT zero, and this is the single most important number here.
   *
   * A value that can reach zero invites a rule about what happens at zero, and every such rule is
   * some flavour of the death mechanic §6 forbids. Fifteen percent is 「餓了，但沒事」.
   */
  nutritionFloor: 0.15,
  /**
   * The 活動力 a given 營養 level eventually settles at: `energyBase + energySpan × nutrition`.
   *
   * The base is what an unfed animal keeps — a quarter of its liveliness, which is enough to potter
   * about its bed and get up when its owner walks over. Nothing here can drive energy to zero, so
   * 「完全不動」 is not a state this system is able to produce.
   */
  energyBase: 0.25,
  energySpan: 0.75,
  /**
   * How fast energy chases that target, as a half-life in hours.
   *
   * Six hours is the lag that makes the change read as gradual rather than as a switch (§3, §15):
   * feeding a listless animal perks it up over the afternoon rather than in the same frame, and an
   * absence dims it over a day rather than at a threshold it crosses in its sleep.
   */
  energyHalfLifeHours: 6,
  /** The floor under 活動力, for the same reason `nutritionFloor` exists. */
  energyFloor: 0.2,
} as const;

/* --- The persisted state ------------------------------------------------------------------ */

/**
 * 寵物照護狀態 — what is actually written to the save.
 *
 * Stored at `islandState.pet.care` (see `PetLifeState` in constants/islandReturn.ts) rather than as
 * a new top-level profile field, and that is a deployment decision as much as a modelling one:
 * `islandState` is already ONE key in the deployed Firestore ruleset and its `pet` member is already
 * validated as 「a map」, so this whole feature is writable with no rules change. A new top-level
 * field would need a clause in `isValidUser()` and an entry in every write whitelist before a single
 * save could land — see docs/FIRESTORE_RULES.md.
 *
 * Three fields, all required, none optional: an optional field would have to be OMITTED rather than
 * set to `undefined` (Firestore's `updateDoc` throws synchronously on an explicit undefined — see
 * `makePetState`), and there is nothing here a pet can legitimately not have.
 */
export interface PetCareState {
  /** 營養, 0..1. Restored by food, drained by time. Never reaches 0. */
  nutrition: number;
  /** 活動力, 0..1. Chases the ceiling nutrition sets for it. Never reaches 0. */
  energy: number;
  /**
   * ISO of the instant `nutrition`/`energy` were last true.
   *
   * The anchor the whole simulation measures from, and the reason nothing here needs a timer: a
   * value plus the moment it was true IS the curve, so 「離線三天」 and 「分頁在背景放了三天」 are the
   * same arithmetic. Written only when something real happens (an arrival, a feed), never on a
   * schedule.
   */
  updatedAt: string;
}

/**
 * A brand-new companion: fed, rested, and stamped as of now.
 *
 * Full rather than half, because the first thing a player does with a new pet is take it outside —
 * and an animal that arrives already listless is not the thing the shop sold them.
 */
export function newPetCareState(nowMs: number): PetCareState {
  return { nutrition: 1, energy: 1, updatedAt: new Date(nowMs).toISOString() };
}

/**
 * Reads a stored care state defensively.
 *
 * Every field is range-checked rather than trusted, because this value has round-tripped through a
 * document store: an old save, a half-written map or a hand-edited profile must produce a healthy
 * animal rather than `NaN` propagating into the movement code, where it shows up as a pet that has
 * silently stopped existing. Absent — which is every save written before this feature — reads as a
 * brand-new, fully cared-for pet, exactly like one just bought.
 */
export function readPetCareState(raw: unknown, nowMs: number): PetCareState {
  if (!raw || typeof raw !== 'object') return newPetCareState(nowMs);
  const value = raw as Partial<PetCareState>;
  const stamp =
    typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt))
      ? value.updatedAt
      : new Date(nowMs).toISOString();
  return {
    nutrition: clamp01(numberOr(value.nutrition, 1)),
    energy: clamp01(numberOr(value.energy, 1)),
    updatedAt: stamp,
  };
}

/**
 * Reads the stored per-pet care map, defensively — see {@link readPetCareState} for why every field
 * that has round-tripped through a document store is range-checked rather than trusted.
 *
 * A map rather than one state because a household can hold more than one animal and each has its
 * own appetite (§6, §21). Keys are companion item ids; anything that is not a plain object, and any
 * entry that is not one, is dropped rather than repaired — a garbled key is a pet nobody owns, and
 * inventing a healthy state for it would put a phantom animal in the save.
 */
export function readPetCareStates(raw: unknown, nowMs: number): Record<string, PetCareState> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, PetCareState> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || !value || typeof value !== 'object') continue;
    out[id] = readPetCareState(value, nowMs);
  }
  return out;
}

/**
 * The care map with ONE animal's entry replaced — the brief's §21 as a function.
 *
 * Feeding the dog must leave the cat and the bird exactly where they were, and that is a rule worth
 * having a name (and a test) rather than an inline spread at each of the two writers: an inline
 * spread is one forgotten `...` away from a feed that resets the household, and nothing about the
 * resulting save would look wrong.
 *
 * The existing entries are re-read defensively on the way through, so a map that has round-tripped
 * through the document store cannot carry a garbled sibling back into a write.
 */
export function withPetCare(
  cares: unknown,
  petItemId: string,
  state: PetCareState,
  nowMs: number,
): Record<string, PetCareState> {
  return { ...readPetCareStates(cares, nowMs), [petItemId]: state };
}

/* --- Time passing ------------------------------------------------------------------------- */

/**
 * What a care state has become by `nowMs` — the one place time is applied.
 *
 * Closed form on purpose. Nutrition drains linearly and energy eases toward the ceiling nutrition
 * sets for it, both evaluated over the whole gap at once, so this is idempotent in the way that
 * matters: settling after a three-day absence gives the same answer as settling every minute
 * through it, and calling it twice in the same millisecond changes nothing. That property is what
 * lets every reader settle freely — the panel, the behaviour layer, the feed — without any of them
 * coordinating or persisting the result.
 *
 * A clock that has gone BACKWARDS (a wrong device time, a save written on another machine) produces
 * a zero-length gap rather than a negative one, so nothing is ever restored by rewinding.
 */
export function settlePetCare(state: PetCareState, nowMs: number): PetCareState {
  const from = Date.parse(state.updatedAt);
  const hours = Number.isFinite(from) ? Math.max(0, (nowMs - from) / 3_600_000) : 0;
  if (hours <= 0) return state;

  const { nutritionDrainPerDay, nutritionFloor, energyBase, energySpan, energyHalfLifeHours, energyFloor } =
    PET_CARE_TUNING;

  const drainPerHour = nutritionDrainPerDay / 24;
  /** How long until nutrition reaches its floor and stops falling, in hours. */
  const toFloor = Math.max(0, (state.nutrition - nutritionFloor) / drainPerHour);
  /** The part of the gap nutrition was still falling through. */
  const falling = Math.min(hours, toFloor);
  /** The part after it had bottomed out. */
  const flat = hours - falling;

  const nutrition = clamp(state.nutrition - hours * drainPerHour, nutritionFloor, 1);

  // Energy chases the ceiling nutrition sets for it: `e' = k·(target(t) − e)`, with a half-life of
  // `energyHalfLifeHours` and `target = base + span · nutrition`.
  //
  // Solved EXACTLY rather than approximated, and that is the property the whole feature rests on
  // (§16). An approximation — easing toward the end nutrition, or toward the average of the two —
  // gives a different answer depending on how often it is applied, which would mean a player who
  // left the tab open got a different animal from one who closed it. Every reader of this state
  // settles it independently and none of them coordinate, so the answer has to be the same however
  // many times it is asked for. `npm run test:pet-care` pins that against an hour-by-hour walk.
  //
  // The gap is two segments, because the target moves in two ways: it slides while nutrition is
  // still draining, and it is constant once nutrition has hit its floor.
  const k = Math.LN2 / energyHalfLifeHours;
  let energy = state.energy;

  if (falling > 0) {
    // Target sliding as `a − b·t`. The exact solution is `a + b/k − b·t + (e₀ − a − b/k)·e^(−k·t)`.
    const a = energyBase + energySpan * state.nutrition;
    const b = energySpan * drainPerHour;
    energy = a + b / k - b * falling + (energy - a - b / k) * Math.exp(-k * falling);
  }
  if (flat > 0) {
    // Target constant at the floor's ceiling — the ordinary exponential approach.
    const target = energyBase + energySpan * nutritionFloor;
    energy = target + (energy - target) * Math.exp(-k * flat);
  }

  return { nutrition, energy: clamp(energy, energyFloor, 1), updatedAt: new Date(nowMs).toISOString() };
}

/* --- Reading the state -------------------------------------------------------------------- */

/**
 * The named rungs, for COPY AND ICONS ONLY.
 *
 * Behaviour is never switched on one of these — see {@link petActivityResponse}, which is a
 * continuous function of activity precisely so the animal changes gradually (§3, §15) instead of
 * becoming a different pet at a threshold. A band exists because a player reading a panel needs a
 * word, not a number to three decimal places, and because 「牠有點懶洋洋的」 is the honest
 * translation of 0.42.
 */
export type PetConditionBand = 'thriving' | 'content' | 'sleepy' | 'drowsy';

export interface PetConditionBandDef {
  id: PetConditionBand;
  /** Activity at or above which this band applies. The lowest entry must be 0. */
  fromActivity: number;
  label: string;
  /** One line about what the animal is doing, for the panel. Never a warning, never a threat. */
  note: string;
}

/**
 * The four rungs, lowest first.
 *
 * There is no rung below 「懶洋洋」 and there will not be one. The bottom of this ladder is an animal
 * curled up in its own bed — a picture of somewhere it wants to be, not of something going wrong.
 */
export const PET_CONDITION_BANDS: readonly PetConditionBandDef[] = [
  {
    id: 'drowsy',
    fromActivity: 0,
    label: '懶洋洋',
    note: '牠多半待在自己的窩裡，走幾步就想躺下。餵一點東西會好很多。',
  },
  {
    id: 'sleepy',
    fromActivity: 0.45,
    label: '想休息',
    note: '牠比平常安靜，常常停下來坐著，偶爾自己回窩邊待著。',
  },
  {
    id: 'content',
    fromActivity: 0.7,
    label: '悠閒',
    note: '牠在附近晃來晃去，走走停停，看起來很自在。',
  },
  {
    id: 'thriving',
    fromActivity: 0.88,
    label: '活力充沛',
    note: '牠精神很好，跟前跟後，還會自己跑開去探險一下。',
  },
];

export interface PetCondition {
  nutrition: number;
  energy: number;
  /**
   * 活動力 as everything downstream reads it, 0..1.
   *
   * Energy, not a fresh blend of the two: nutrition already reaches the animal THROUGH energy (see
   * {@link settlePetCare}), and mixing it in again here would count it twice and make a freshly fed
   * pet perk up instantly — the abrupt switch §3 asks us to avoid.
   */
  activity: number;
  /** How well looked-after it is overall, 0..1. The panel's summary; nothing behavioural. */
  condition: number;
  band: PetConditionBandDef;
}

/** Everything a screen or the behaviour layer wants to know, from a settled state. */
export function petCondition(state: PetCareState): PetCondition {
  const activity = clamp01(state.energy);
  let band = PET_CONDITION_BANDS[0];
  for (const rung of PET_CONDITION_BANDS) {
    if (activity >= rung.fromActivity) band = rung;
  }
  return {
    nutrition: clamp01(state.nutrition),
    energy: activity,
    activity,
    condition: clamp01((state.nutrition + state.energy) / 2),
    band,
  };
}

/**
 * How activity is allowed to change the animal's MOVEMENT, as multipliers.
 *
 * Continuous, and that is the whole point (§3, §15). There is no activity value at which the pet
 * becomes a different thing; there is a smooth ramp from 「跟前跟後」 to 「走幾步就想坐下」, and every
 * number below is an interpolation along it.
 *
 * These multiply the mood multipliers from constants/islandReturn.ts rather than replacing them —
 * see {@link combinePetMotion}. Two systems describe the same animal (how long you were away, and
 * how well you have been feeding it) and neither may overwrite the other's answer.
 */
export interface PetMotionScale {
  /** Walking pace. Floored well above zero — an animal that stops dead reads as broken (§3). */
  pace: number;
  /** Idle bob, tail, body roll. This is what 「有沒有精神」 actually looks like on screen. */
  liveliness: number;
  /** How strongly it prefers its own resting spot over its owner's heel, 0..1. */
  nestPull: number;
}

export function petActivityResponse(activity: number): PetMotionScale {
  const a = clamp01(activity);
  return {
    // 0.62 at the very bottom: slower than a walk, still plainly walking.
    pace: lerp(0.62, 1.05, a),
    // The widest spread of the three, because liveliness is the channel a player actually READS. A
    // pet at half pace looks like it is lagging; one that also bobs and wags less looks tired.
    liveliness: lerp(0.35, 1.1, a),
    // Only the bottom half of the range pulls toward the bed at all, so an ordinary, slightly
    // peckish animal still follows its owner everywhere.
    nestPull: clamp01((0.55 - a) / 0.55),
  };
}

/** Multiplies two motion scales — 離線心情 × 照護狀態. Neither system overrides the other. */
export function combinePetMotion(mood: PetMotionScale, care: PetMotionScale): PetMotionScale {
  return {
    pace: mood.pace * care.pace,
    liveliness: mood.liveliness * care.liveliness,
    // The STRONGER pull wins rather than the product: both mean 「牠想待在窩裡」, and multiplying two
    // fractions would make an animal that is both long-abandoned and hungry stay home LESS than one
    // that is only hungry.
    nestPull: Math.max(mood.nestPull, care.nestPull),
  };
}

/* --- The behaviour layer ------------------------------------------------------------------ */

/**
 * What the animal is doing with itself right now.
 *
 * A closed union rather than a string, so a behaviour that does not exist is a compile error at the
 * table below rather than a pet that silently stands still. Every one of them is a choice about
 * WHERE the animal wants to be; how it gets there is the mover's business (Three/IslandPet.tsx) and
 * is the same walk in every case.
 */
export type PetBehaviorId = 'follow' | 'wander' | 'idle' | 'goToBed' | 'rest';

/** Where a behaviour puts the animal's target. The mover turns this into a point. */
export type PetBehaviorAnchor =
  /** The follow slot beside its owner — the ordinary companion behaviour. */
  | 'owner'
  /** Its own resting spot, wherever that currently is (lib/petRestingSpots.ts). */
  | 'rest'
  /** Wherever it already is. A stop, not a destination. */
  | 'self';

/** Everything the decision is allowed to look at. Pure inputs — no clock, no scene, no profile. */
export interface PetBehaviorContext {
  /** 0..1, from {@link petCondition}. */
  activity: number;
  /**
   * How strongly the animal is drawn to its own bed, 0..1 — the COMBINED pull of both systems
   * (see {@link combinePetMotion}), so a long absence and a hungry animal both reach the decision
   * through the same number rather than through two competing branches.
   */
  nestPull: number;
  /** How far the owner is from the animal, in world units. */
  ownerDistance: number;
  /** Whether the owner is walking right now. A moving owner is one to keep up with. */
  ownerMoving: boolean;
  /** How far the animal is from its own resting spot. */
  restDistance: number;
  /** Whether the owner is standing near that resting spot. */
  ownerNearRest: boolean;
  /** What it was doing a moment ago. Behaviours are sticky — see {@link PET_BEHAVIOR_STICKINESS}. */
  previous: PetBehaviorId;
}

export interface PetBehaviorDef {
  id: PetBehaviorId;
  label: string;
  anchor: PetBehaviorAnchor;
  /** Extra pace on top of the motion scales — a wander is a potter, a follow is a trot. */
  pace: number;
  /** How far from the anchor the animal is content to drift, in world units. */
  drift: number;
  /** True when the animal is off its feet: legs still, body low. Drawn, never stored. */
  settled: boolean;
  /**
   * How likely this behaviour is in a given context, as an unnormalised weight.
   *
   * Weights rather than thresholds, and this is the mechanism behind 「行為逐漸改變」: at 0.8
   * activity a pet mostly follows and occasionally wanders; at 0.5 it mostly follows but sits down
   * more; at 0.2 it mostly heads for its bed but still gets up sometimes. Nothing flips.
   */
  weight: (ctx: PetBehaviorContext) => number;
}

/**
 * How far the owner may get before following stops being optional.
 *
 * Above this the decision is overridden outright: a companion that stays home while its owner walks
 * to the other side of the island is not resting, it is lost — and the player, who cannot see the
 * numbers, would read it as the pet being broken. Set generously wide so it only fires when the
 * owner has genuinely gone somewhere.
 */
export const PET_LEASH_DISTANCE = 14;

/**
 * How close the owner has to be for the animal to give up on resting and come to them.
 *
 * Deliberately the same idea as constants/islandReturn.ts's PET_NOTICE_RADIUS, and deliberately NOT
 * an import of it: that one is about a pet noticing a returning owner across the island, this one is
 * about a resting pet noticing one standing over it, and tying the two together would mean a change
 * to either silently retunes the other. Both are 「牠看到你了」, at different ranges.
 */
export const PET_NOTICE_DISTANCE = 4;

/** How much a behaviour's weight is multiplied by for already being the current one. */
export const PET_BEHAVIOR_STICKINESS = 2.2;

/**
 * How often the behaviour is re-decided, in seconds.
 *
 * The whole of §22 in one constant: MOVEMENT and ANIMATION run every frame, this does not. A few
 * seconds is slow enough that ten pets cost nothing measurable, and fast enough that a pet notices
 * its owner walking off within a stride. There is deliberately no per-frame path into
 * {@link decidePetBehavior} — the leash override is the one thing the mover checks itself.
 */
export const PET_DECISION_INTERVAL_SECONDS = 3.5;

/**
 * The five behaviours.
 *
 * `goToBed` and `rest` are separate on purpose, and the difference is between a pet that WALKS to
 * its bed and one that appears in it. The brief's §21 rules out the second explicitly; keeping the
 * journey as its own behaviour is what makes the arrival something the player can watch happen.
 */
export const PET_BEHAVIORS: Record<PetBehaviorId, PetBehaviorDef> = {
  follow: {
    id: 'follow',
    label: '跟著你',
    anchor: 'owner',
    pace: 1,
    drift: 0,
    settled: false,
    // Rises with activity, and rises hard the moment the owner is actually walking away: keeping up
    // with a moving owner is the one thing a companion always wants to do. `nestPull` takes at most
    // half of it away — never all, because an animal that stops following altogether is one the
    // player has to go and find, which is the failure mode PET_LEASH_DISTANCE also guards.
    weight: (c) => (0.35 + 1.35 * c.activity) * (c.ownerMoving ? 2.4 : 1) * (1 - 0.5 * c.nestPull),
  },
  wander: {
    id: 'wander',
    label: '四處探索',
    anchor: 'owner',
    // Slower than a follow. Exploring is a potter, and a pet that sprints in circles around a
    // standing owner reads as agitated rather than as curious.
    pace: 0.8,
    /**
     * How far it strays while exploring — about three of its own body lengths. Anchored to the
     * OWNER rather than to the world, so this can never walk the animal off somewhere the player
     * has to go and find it.
     */
    drift: 2.6,
    settled: false,
    // The most 活潑 behaviour, and the only one that needs the owner to be standing still: a pet
    // that wanders off while its owner is walking is a pet being left behind.
    weight: (c) => (c.ownerMoving ? 0 : Math.max(0, c.activity - 0.5) * 2.2),
  },
  idle: {
    id: 'idle',
    label: '待在附近',
    anchor: 'self',
    pace: 0.6,
    drift: 0,
    settled: true,
    // The middle of the ladder — available at every activity, likeliest around the middle, and what
    // a moderately tired pet does instead of trailing its owner across the island.
    weight: (c) => (c.ownerMoving ? 0.15 : 0.5 + (1 - c.activity) * 1.1),
  },
  goToBed: {
    id: 'goToBed',
    label: '回窩裡',
    anchor: 'rest',
    // Unhurried. This is a tired animal walking home, not one fleeing.
    pace: 0.85,
    drift: 0.45,
    settled: false,
    weight: (c) => {
      // Never while the owner is right there — the bed is where it waits for them, so the whole
      // behaviour is pointless (and reads as sulking) with the owner standing beside it.
      if (c.ownerNearRest || c.ownerDistance < PET_NOTICE_DISTANCE) return 0;
      // Already there: `rest` takes over rather than this re-winning every decision.
      if (c.restDistance < 0.8) return 0;
      // Two inputs, one term. `activity` is 「牠沒力氣了」 and `nestPull` is 「牠想回窩」 — a long
      // absence produces the second without the first, which is what makes a well-fed pet whose
      // owner has been gone a fortnight still take itself home.
      return (Math.max(0, 0.55 - c.activity) * 4 + 0.3) * (0.35 + 2 * c.nestPull);
    },
  },
  rest: {
    id: 'rest',
    label: '在窩裡休息',
    anchor: 'rest',
    pace: 0.5,
    drift: 0.25,
    settled: true,
    weight: (c) => {
      if (c.ownerNearRest || c.ownerDistance < PET_NOTICE_DISTANCE) return 0;
      // Only once it has actually arrived. Resting is a thing that happens IN the bed.
      if (c.restDistance > 1.2) return 0;
      return (0.5 + Math.max(0, 0.6 - c.activity) * 5) * (0.35 + 2 * c.nestPull);
    },
  },
};

export const ALL_PET_BEHAVIORS: readonly PetBehaviorDef[] = Object.values(PET_BEHAVIORS);

/**
 * Picks what the animal does next.
 *
 * Weighted choice rather than a priority chain, because a chain gives the same answer every time and
 * a pet that always does the same thing at the same energy is furniture. `roll` is supplied by the
 * caller (0..1) rather than taken from `Math.random()` here, which is what makes this testable —
 * `npm run test:pet-care` walks a fixed roll across the whole activity range and asserts the SHAPE
 * of the distribution rather than one lucky draw.
 *
 * The one hard override is the leash: an owner who has walked off is followed, whatever the animal
 * would rather be doing. See {@link PET_LEASH_DISTANCE}.
 */
export function decidePetBehavior(ctx: PetBehaviorContext, roll: number): PetBehaviorId {
  if (ctx.ownerDistance > PET_LEASH_DISTANCE) return 'follow';

  const weights = ALL_PET_BEHAVIORS.map((def) => {
    const base = Math.max(0, def.weight(ctx));
    return base * (def.id === ctx.previous ? PET_BEHAVIOR_STICKINESS : 1);
  });
  const total = weights.reduce((sum, w) => sum + w, 0);
  // Every weight at zero is possible in principle (a future behaviour table could do it) and must
  // not produce `undefined`. Following is the safe default: it is what a companion is for.
  if (total <= 0) return 'follow';

  let cursor = clamp01(roll) * total;
  for (let i = 0; i < weights.length; i++) {
    cursor -= weights[i];
    if (cursor <= 0) return ALL_PET_BEHAVIORS[i].id;
  }
  return ALL_PET_BEHAVIORS[ALL_PET_BEHAVIORS.length - 1].id;
}

/* --- Resting spots ------------------------------------------------------------------------ */

/**
 * 寵物窩 lives in constants/petHabitats.ts, not here.
 *
 * It used to be declared in this file, back when a resting place was one radius and a label. It is
 * now a KIND (a bed, a house, a cage, a perch) plus the species it accepts plus the posture that
 * follows from the kind — which is a statement about furniture and about which animal is which, and
 * this file is deliberately neither of those things: it is two numbers and how time moves them, and
 * it imports no catalog. See petHabitats.ts's file doc.
 */

/* --- Feeding ------------------------------------------------------------------------------ */

/**
 * What one serving of food may move, and by how much.
 *
 * A RANGE rather than a value, because the amounts belong to the item (constants/consumables.ts):
 * this is the sanity bound every food is checked against by `npm run test:pet-care`, so a mistyped 4
 * in a catalog row cannot quietly become a bowl that fills the animal four times over.
 */
export const PET_FOOD_EFFECT_RANGE = { min: 0, max: 1 } as const;

/**
 * How long the animal visibly eats for after a feed lands, in seconds.
 *
 * The brief's §19 asks the player to FEEL that their pet was looked after, and this is the whole
 * budget for it: the animal puts its head down, bobs while it eats, and a few hearts drift up
 * (Three/IslandPet.tsx). Long enough to read as a small event, short enough that a player feeding
 * three animals in a row is not waiting on an animation.
 *
 * Here rather than in the mover because it is the length of a MOMENT in the feature, not a
 * rendering detail — the toast and the animation are meant to be over at about the same time.
 */
export const PET_FEED_CELEBRATION_SECONDS = 2.6;

/** What a feed actually moved, so the toast can say 「營養 +40%」 rather than guessing. */
export interface PetCareDelta {
  nutrition: number;
  energy: number;
}

/**
 * Applies a set of effects to a care state. The one place food changes an animal.
 *
 * Takes already-resolved AMOUNTS rather than an item, so nothing here imports the catalog and any
 * future source of the same effect (a wheel prize, an NPC's gift, a 功能卡) lands through the same
 * function with the same clamping. The state is settled to `nowMs` first, so feeding always applies
 * on top of what time has already done rather than on top of a stale snapshot.
 *
 * Reports what it actually moved, which is not the same as what was asked for: a nearly full bowl
 * takes only the room it has, and the caller needs to know that to say something true.
 */
export function applyPetCareEffects(
  state: PetCareState,
  effects: { nutrition?: number; energy?: number },
  nowMs: number,
): { state: PetCareState; delta: PetCareDelta } {
  const settled = settlePetCare(state, nowMs);
  const nutrition = clamp(
    settled.nutrition + (effects.nutrition ?? 0),
    PET_CARE_TUNING.nutritionFloor,
    1,
  );
  const energy = clamp(settled.energy + (effects.energy ?? 0), PET_CARE_TUNING.energyFloor, 1);
  return {
    state: { nutrition, energy, updatedAt: new Date(nowMs).toISOString() },
    delta: { nutrition: nutrition - settled.nutrition, energy: energy - settled.energy },
  };
}

/* --- Small helpers ------------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
