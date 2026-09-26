/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 離線回歸 — 「島嶼自己過了一段日子」的資料與規則。
 *
 * This is the data-and-rules half of the feature; `lib/islandOvergrowth.ts` sites the objects it
 * describes, `components/Three/IslandOvergrowth.tsx` draws them, and
 * `components/UI/IslandReturnPanel.tsx` says hello. Same split as constants/dailyLogin.ts ↔
 * DailyLoginPanel: a designer changing how fast the island grows, what grows first, or what the
 * island says when you come back should never have to open a component, and a component should
 * never be where a world rule is discovered.
 *
 * ## What this is NOT
 *
 * It is not a decay system and it must never become one. Nothing here removes gold, furniture,
 * levels, inventory or a pet; every single thing it produces is a decoration the player can clear
 * away in one interaction. The design test for anything added below is: *if the player never
 * tidies it, have they lost anything?* If the answer is yes, it does not belong in this file.
 *
 * ## Why the growth is a curve and not a ladder
 *
 * A stepped table (「7 天 = 5 株雜草」) has two failure modes the brief calls out directly. It makes
 * the world jump — six days and thirteen days look identical, then day fourteen is a different
 * island — and it invites the ladder to be re-applied on every login, which is how a returning
 * player ends up with fifty weeds. {@link overgrowthBudget} is therefore a continuous, sub-linear
 * function of hours away with a hard ceiling, and it describes a TOTAL the island should hold, not
 * an amount to add. The grower (lib/islandOvergrowth.ts) tops the island up to that total and
 * never past it, so logging in twice in a row is a no-op by construction rather than by a flag.
 *
 * The stages below exist for the things a curve cannot answer: what the island should SAY, and how
 * the pet should be feeling. Those are qualitative, and a small named ladder is the honest shape
 * for them.
 */

import type { PetCareState } from './petCare';

/* --- Persisted shapes ------------------------------------------------------------------- */

/**
 * One thing that grew while the player was away.
 *
 * Deliberately tiny and deliberately explicit: this list is stored verbatim in the save (see
 * {@link IslandEnvironmentState}), because a *stored list of objects* is the only shape that can
 * answer 「已經長出來的東西」 and 「玩家已經清掉的東西」 at the same time. A stored seed plus a
 * re-derivation would regrow whatever the player just tidied on the next load — the exact bug the
 * brief's §11/§12 are about.
 *
 * `x`/`z` are world units and already include the island's territory scale, so a sprout does not
 * move when the island grows; `slot` replaces them for the two wall-borne kinds, which hang off
 * the Home and therefore travel with it when it is relocated or re-skinned.
 */
export interface OvergrowthSprout {
  /** Stable identity, so tidying can remove exactly these and nothing else. */
  id: string;
  kind: OvergrowthKind;
  /** World X of a ground sprout. Meaningless (0) for a wall-borne one. */
  x: number;
  /** World Z of a ground sprout. Meaningless (0) for a wall-borne one. */
  z: number;
  /** Which Home anchor a wall-borne kind clings to (see WALL_ANCHOR_COUNT); -1 on the ground. */
  slot: number;
  /** 0..1. The ONLY source of a sprout's own rotation, size and tint — see the renderer. */
  seed: number;
}

/**
 * 寵物的生活狀態 — a mood, not a health bar.
 *
 * There is no field here that can reach zero and no field that costs the player anything. `mood`
 * is what the animal is doing with itself; `vitality` is how brightly it is doing it (0..1),
 * which is what the renderer scales its idle motion by. Both recover the moment the player is
 * back, and neither is allowed to gate an interaction.
 *
 * Extension point (brief §9): 飢餓 / 心情 / 親密度 / 活力 / 玩耍需求 are additional FIELDS on this
 * record and additional inputs to {@link resolvePetMood}. They are not new mood ids and they are
 * not new branches at the call sites — IslandPet reads the resolved {@link PetMoodDef}, so a new
 * need changes which mood is resolved and nothing else.
 */
export interface PetLifeState {
  mood: PetMoodId;
  /** 0..1 — how much spring is in its step. Never a resource, never spent. */
  vitality: number;
  /** ISO of the last time the owner was actually here with it. */
  lastGreetedAt?: string;
  /**
   * 寵物照護 — 營養 and 活動力, and the moment they were last true. See constants/petCare.ts.
   *
   * Nested HERE rather than as a sixth field on this record, and here rather than as a new
   * top-level profile field, for two separate reasons that happen to point the same way.
   *
   * The modelling one: this record answers 「你離開了多久」 and the care state answers 「你有沒有在
   * 餵牠」. They are two different questions about the same animal, they are written at different
   * moments (an arrival vs. a feed), and merging them would make it impossible to say which of the
   * two dimmed the pet. Keeping care as its own object is what lets `mood` and `care` MULTIPLY
   * (see `combinePetMotion`) instead of one silently overwriting the other.
   *
   * The deployment one: `firestore.rules` validates `islandState.pet` as 「a map」 and nothing
   * finer, and `islandState` is already whitelisted on every write that touches it. So the entire
   * care system is writable against the LIVE ruleset with no rules change and no deploy — where a
   * new top-level field would need a clause in `isValidUser()` plus an entry in each write
   * whitelist first, and until it had them every save carrying it would fail in production only.
   * See docs/FIRESTORE_RULES.md.
   *
   * Absent on every save written before the care system, which is deliberately indistinguishable
   * from a pet that has just been bought: neither has ever been hungry.
   */
  care?: PetCareState;
  /**
   * 每一隻寵物自己的照護狀態, keyed by the companion's catalog id — 「牠有沒有被餵」, per animal.
   *
   * The brief's §6 and §21: a household with a dog, a cat and a bird has three animals with three
   * appetites, and feeding one must not top up the other two. So the state is a MAP and the key is
   * the pet's own item id, which is already the game's identifier for a companion (it is what
   * `equippedItems` holds, what the model and the icon are drawn from, and what the shop sold).
   * There is no second id space and no per-pet record to keep in step with the inventory.
   *
   * ## Why `care` above still exists
   *
   * It is the pre-multi-pet save, and it is READ-ONLY from here on. A profile written before this
   * change has one care state and no map; the first pet the player looks at inherits it (see
   * `readPetCare` in context/usePetCare.ts) and everything after that is written into this map. The
   * old field is then dead data rather than a second source of truth — nothing writes it, and
   * nothing reads it once `cares` has an entry for that animal. A mirror kept in step with the map
   * would have been the other option, and it is exactly the kind of denormalisation that stays
   * correct right up until one writer forgets.
   *
   * Nested inside `pet` for the same deployment reason `care` is: `firestore.rules` validates
   * `islandState.pet` as 「a map」 and nothing finer, so this ships against the LIVE ruleset with no
   * rules change. See docs/FIRESTORE_RULES.md.
   */
  cares?: Record<string, PetCareState>;
}

/**
 * Everything the island remembers about being left alone. One map on the profile, so it is one
 * key in the Firestore rules and one key in every write shape.
 */
export interface IslandEnvironmentState {
  /**
   * When this player was last known to be in the world — the anchor the whole feature measures
   * from. Written at login and refreshed on a slow heartbeat while the island is open (see
   * {@link SEEN_HEARTBEAT_MS}), so it means "last seen playing" rather than "last time anything
   * happened to be saved".
   */
  lastSeenAt?: string;
  /** What has grown and not yet been tidied. Absent or empty means a clean island. */
  sprouts?: OvergrowthSprout[];
  /** The companion's life state. Absent means it has never needed one — a lively animal. */
  pet?: PetLifeState;
  /** ISO of the most recent resolved return. Keeps the greeting to once per absence. */
  lastReturnAt?: string;
  /** Which stage that return landed on — what the panel and the pet were told. */
  lastReturnStage?: OfflineStageId;
  /** How long that absence was, in whole hours. Shown to the player as days. */
  lastReturnHours?: number;
}

/* --- The absence ladder ----------------------------------------------------------------- */

export type OfflineStageId = 'home' | 'breeze' | 'sprouting' | 'climbing' | 'slumber';

export interface OfflineStageDef {
  id: OfflineStageId;
  /** Absence, in hours, at which this stage begins. The first entry must be 0. */
  fromHours: number;
  /** What to call it in an admin readout. Never shown to an ordinary player as a status. */
  label: string;
  /**
   * How the companion is spending its time at this stage. Resolved through {@link PET_MOODS}
   * rather than branched on at the call site — see {@link resolvePetMood}.
   */
  petMood: PetMoodId;
  /**
   * Whether coming back from this stage is worth saying anything about. False for the two short
   * stages: a player who was away for an afternoon is not "returning", and telling them they were
   * gone is how a cosy system starts to feel like a register being taken.
   */
  greets: boolean;
  /**
   * What the island says on the way back in. Several, and picked by seed, because the same
   * sentence every time turns a small piece of world-building into a system message.
   */
  lines: readonly string[];
}

/**
 * The stages, shortest absence first.
 *
 * The two thresholds that matter are 12 hours (below which absolutely nothing happens — an
 * overnight break must leave the island exactly as it was) and 72 hours, the first point at which
 * the player is greeted at all. Everything above that is about tone rather than about mechanics:
 * the same curve is growing the same island, and the stage only changes what is said about it.
 */
export const OFFLINE_STAGES: readonly OfflineStageDef[] = [
  {
    id: 'home',
    fromHours: 0,
    label: '一如往常',
    petMood: 'lively',
    greets: false,
    lines: [],
  },
  {
    id: 'breeze',
    fromHours: 12,
    label: '微風拂過',
    petMood: 'lively',
    greets: false,
    lines: [],
  },
  {
    id: 'sprouting',
    fromHours: 72,
    label: '草木初生',
    petMood: 'calm',
    greets: true,
    lines: [
      '你離開了一段時間，島上長出了一些新的綠意。',
      '幾天沒來，草地上多了一些落葉與小草。',
      '風把不少葉子吹到了屋子旁邊。',
      '島嶼看起來過得不錯，只是有點需要整理。',
    ],
  },
  {
    id: 'climbing',
    fromHours: 168,
    label: '藤蔓攀爬',
    petMood: 'waiting',
    greets: true,
    lines: [
      '藤蔓開始沿著牆面往上爬了。',
      '一個星期過去，島上的植物自己長高了一些。',
      '屋子周圍多了雜草，牆邊也垂下了幾條藤蔓。',
      '島嶼很安靜，但一切都還在原本的地方。',
    ],
  },
  {
    id: 'slumber',
    fromHours: 336,
    label: '沉睡的島',
    petMood: 'waiting',
    greets: true,
    lines: [
      '好久不見。島嶼像是自己生活了一段日子。',
      '角落結了蜘蛛網，藤蔓也爬得更高了。',
      '這裡什麼都沒有少，只是安靜了很久。',
      '島嶼一直在等你回來 —— 慢慢整理，不用急。',
    ],
  },
];

/** Where the ladder starts. Hoisted so nothing has to index `[0]` and hope. */
const DEFAULT_STAGE = OFFLINE_STAGES[0];

/** The stage an absence of `hours` lands in. */
export function stageForHours(hours: number): OfflineStageDef {
  let found = DEFAULT_STAGE;
  for (const stage of OFFLINE_STAGES) {
    if (hours >= stage.fromHours) found = stage;
  }
  return found;
}

/* --- What grows ------------------------------------------------------------------------- */

export type OvergrowthKind = 'leaf' | 'weed' | 'bloom' | 'twig' | 'pebble' | 'vine' | 'web';

export interface OvergrowthKindDef {
  id: OvergrowthKind;
  /** The player's word for it, used by the return panel's summary line. */
  label: string;
  /**
   * Where it lives. `ground` sprouts are sited on the grass by the placement rules; `wall` ones
   * take an anchor slot on the Home and are drawn in its local frame, so they follow it around
   * and never need re-siting when it moves.
   */
  surface: 'ground' | 'wall';
  /** Hours of absence before this kind can appear at all. */
  fromHours: number;
  /** Its share of the budget once unlocked, relative to the other unlocked kinds. */
  weight: number;
  /** Hard ceiling, whatever the budget says. This is what keeps 藤蔓 a detail and not a coat. */
  cap: number;
}

/**
 * The catalogue, in the order things start appearing.
 *
 * The order is the whole design: leaves blow in within half a day, grass takes a couple of days,
 * flowers and twigs a few more, and only after five days does anything start CLIMBING. The caps
 * are the other half — 藤蔓 tops out at five strands and 蜘蛛網 at three, so the longest possible
 * absence still returns you to a cottage with vines on it rather than to a ruin. A month away and
 * a fortnight away differ by a few weeds, on purpose.
 */
export const OVERGROWTH_KINDS: readonly OvergrowthKindDef[] = [
  { id: 'leaf', label: '落葉', surface: 'ground', fromHours: 12, weight: 3.0, cap: 10 },
  { id: 'weed', label: '雜草', surface: 'ground', fromHours: 48, weight: 3.0, cap: 9 },
  { id: 'bloom', label: '小花', surface: 'ground', fromHours: 72, weight: 1.0, cap: 4 },
  { id: 'twig', label: '枯枝', surface: 'ground', fromHours: 96, weight: 1.0, cap: 4 },
  { id: 'pebble', label: '小石', surface: 'ground', fromHours: 96, weight: 0.8, cap: 4 },
  { id: 'vine', label: '藤蔓', surface: 'wall', fromHours: 120, weight: 1.2, cap: 5 },
  { id: 'web', label: '蜘蛛網', surface: 'wall', fromHours: 288, weight: 0.6, cap: 3 },
];

const KIND_BY_ID = new Map(OVERGROWTH_KINDS.map((k) => [k.id, k]));

export function getOvergrowthKind(id: OvergrowthKind): OvergrowthKindDef {
  return KIND_BY_ID.get(id) ?? OVERGROWTH_KINDS[0];
}

/**
 * How many anchor slots the Home offers a climbing plant.
 *
 * Slots are positions, not decorations: the renderer turns a slot index into a point on the
 * building's own local frame, so a vine keeps its place when the Home is moved, rotated or
 * re-skinned, and no House Style needs a per-style vine table. The count is deliberately larger
 * than 藤蔓's cap plus 蜘蛛網's, so a fully overgrown cottage still has bare wall between strands.
 */
export const WALL_ANCHOR_COUNT = 12;

/** Absence below which the island is left completely alone. */
export const QUIET_HOURS = 12;

/**
 * The most the island will ever hold at once.
 *
 * A ceiling rather than a rate limit, and low on purpose: twenty-six small objects spread over a
 * disc eleven units across reads as 「有一陣子沒整理了」, which is the feeling being aimed at.
 * Double it and the same island reads as abandoned.
 */
export const OVERGROWTH_MAX = 26;

/** Sprouts per day at the start, before the curve flattens it. */
const GROWTH_PER_DAY = 3.2;

/**
 * How hard the curve flattens. Below 1, so the second week adds far less than the first: an
 * absence should be legible at a glance without a long one being punishing to clear.
 */
const GROWTH_CURVE = 0.72;

/**
 * How many sprouts the island should be holding after `hours` away — a TOTAL, not an increment.
 *
 * See the module header for why this is the shape that makes repeat logins safe. Measured: 1 day →
 * 2, 3 days → 6, a week → 12, a fortnight → 21, and anything past 18.4 days → the ceiling.
 */
export function overgrowthBudget(hours: number): number {
  if (hours < QUIET_HOURS) return 0;
  const days = (hours - QUIET_HOURS) / 24;
  if (days <= 0) return 0;
  return Math.min(OVERGROWTH_MAX, Math.round(GROWTH_PER_DAY * Math.pow(days, GROWTH_CURVE)));
}

/**
 * How the budget is split between the kinds unlocked at `hours`.
 *
 * Returns a target count per kind, already clamped to each kind's cap. Anything a cap refuses is
 * handed back to the kinds that still have room, so a long absence spends its whole budget on
 * leaves and grass instead of quietly growing a smaller island than the curve asked for.
 */
export function overgrowthMix(hours: number): Map<OvergrowthKind, number> {
  const budget = overgrowthBudget(hours);
  const mix = new Map<OvergrowthKind, number>();
  if (budget <= 0) return mix;

  let remaining = budget;
  let pool = OVERGROWTH_KINDS.filter((k) => hours >= k.fromHours);
  if (pool.length === 0) return mix;

  // Runs until nothing more can be placed, so a future table with tighter caps cannot silently
  // under-fill the budget the curve authorised.
  while (remaining > 0 && pool.length > 0) {
    const totalWeight = pool.reduce((sum, k) => sum + k.weight, 0);
    let placed = 0;
    for (const kind of pool) {
      if (placed >= remaining) break;
      const already = mix.get(kind.id) ?? 0;
      const room = kind.cap - already;
      if (room <= 0) continue;
      const want = Math.max(1, Math.round((remaining * kind.weight) / totalWeight));
      const share = Math.min(room, want, remaining - placed);
      mix.set(kind.id, already + share);
      placed += share;
    }
    if (placed === 0) break;
    remaining -= placed;
    pool = pool.filter((k) => (mix.get(k.id) ?? 0) < k.cap);
  }

  for (const [id, count] of [...mix]) if (count <= 0) mix.delete(id);
  return mix;
}

/* --- 環境狀態 (Environment State) --------------------------------------------------------- */

/**
 * The four named degrees of overgrowth — the coarsest possible summary of {@link IslandAmbience}.
 *
 * These exist for the same reason {@link OFFLINE_STAGES} does — something has to be sayable in
 * words, in an admin readout or a line of copy — and for no other reason. **Nothing in the game
 * branches on a grade.** Every visual consequence reads the continuous `wildness` below, because a
 * ladder is exactly the thing the brief rules out: a stepped grade would make the island's colour
 * jump the moment one more weed came up, and a player watching their island brighten as they tidy
 * would see it happen in four hard clicks rather than continuously.
 */
export type IslandGradeId = 'fresh' | 'sprouted' | 'overgrown' | 'wild';

export interface IslandGradeDef {
  id: IslandGradeId;
  /** Wildness at which this grade begins. The first entry must be 0. */
  fromWildness: number;
  /** Admin/readout wording. Never shown to an ordinary player as a status. */
  label: string;
}

export const ISLAND_GRADES: readonly IslandGradeDef[] = [
  { id: 'fresh', fromWildness: 0, label: '整潔' },
  { id: 'sprouted', fromWildness: 0.12, label: '略有綠意' },
  { id: 'overgrown', fromWildness: 0.4, label: '有點需要整理' },
  { id: 'wild', fromWildness: 0.75, label: '久未整理' },
];

/**
 * 島嶼目前的環境狀態 — one resolved value, read by every environment system.
 *
 * This is the brief's §6 in one object. Before it existed, an absence was legible only as a pile
 * of sprouts, and anything else wanting to react to it (the light, the exposure, how far a vine
 * had climbed) would have had to reach for `lastSeenAt` and re-derive the hours for itself — which
 * is precisely the 「不要讓不同 Component 各自計算離線天數」 failure. There is now exactly one
 * calculation, {@link resolveIslandAmbience}, and every consumer reads one field off its result.
 *
 * ## Why it is derived from the SPROUTS and not from the clock
 *
 * This is the most important decision in the file, and it is not the obvious one.
 *
 * The tempting shape is `hours → ambience`: the player was away twelve days, so dim the island by
 * twelve days' worth. It is also wrong, and it fails the brief's §7 outright. Under it, a player
 * who comes home to an overgrown island and spends ten minutes clearing every last weed is left
 * standing in a spotless garden that is still visibly dim — because the *clock* still says they
 * were away twelve days, and nothing they can do in the world will ever change that number. The
 * island would brighten only at the next login, for reasons invisible from inside the game.
 *
 * Deriving from what is actually STANDING on the island instead makes tidying and recovery the
 * same act. Pull the weeds and the light comes back, continuously, in the same motion — no
 * recovery timer, no second state to keep in step, no 「已整理」 flag. It also cannot ever disagree
 * with the screen: the grade is computed from the very list the renderer is drawing, so a dim
 * island always has something standing on it to explain why.
 *
 * The clock has not gone anywhere — it still decides how much GROWS ({@link overgrowthBudget} is
 * still a pure function of hours away). It simply stops being the thing that is looked at twice.
 */
export interface IslandAmbience {
  /** 0..1 — how overgrown the island is right now. The one number everything else derives from. */
  wildness: number;
  /** What that reads as in words. For readouts only — nothing branches on it. */
  grade: IslandGradeDef;
  /**
   * Multiplier on how colourful the light is: 1 (normal) down to
   * {@link AMBIENCE_SATURATION_FLOOR}. Applied by desaturating the weather's own light colours
   * rather than by a post-process pass — see Three/Scene.tsx for why that is the whole trick.
   */
  saturation: number;
  /** Multiplier on every light's intensity, 1 down to {@link AMBIENCE_BRIGHTNESS_FLOOR}. */
  brightness: number;
  /** Target `toneMappingExposure`, 1 down to {@link AMBIENCE_EXPOSURE_FLOOR}. */
  exposure: number;
  /**
   * How far toward {@link AMBIENCE_SHADE_TINT} the light colours are carried, as a fraction of
   * {@link AMBIENCE_SHADE_MAX}. This is the 「色調略偏陰影」 half, kept separate from saturation so
   * the two can be tuned against each other without either hiding the other.
   */
  shade: number;
  /**
   * 0..1 — how far a strand of ivy has come down the wall. Read by Three/IslandOvergrowth.tsx to
   * pick a strand's length, so vines LENGTHEN across a longer absence instead of every strand
   * arriving fully grown (brief §4). Zero until the island is overgrown enough for a climbing
   * plant to be plausible at all.
   */
  vineGrowth: number;
}

/**
 * How dull the light may get.
 *
 * 0.72 keeps every hue clearly itself — the grass is still green and the roof is still red at the
 * bottom of the range, just quieter. Push this toward 0 and the island stops reading as
 * 「有一陣子沒整理」 and starts reading as a black-and-white photograph, which is the wrong genre.
 */
const AMBIENCE_SATURATION_FLOOR = 0.72;

/**
 * How dim the light may get, as a multiplier on the weather's own intensities.
 *
 * Deliberately shallow. The weather system already swings the island between 1.4 (晴天) and 0.25
 * (暴風雨) directional intensity, and an absence must never compete with that: a sunny day on a
 * neglected island has to stay unmistakably a sunny day. 0.86 is about a third of a stop — plainly
 * visible side by side, and nowhere near 「離線超過 X 天 → 整個畫面變黑」.
 */
const AMBIENCE_BRIGHTNESS_FLOOR = 0.86;

/** How far the renderer's exposure is pulled down. Compounds with brightness; keep both gentle. */
const AMBIENCE_EXPOSURE_FLOOR = 0.9;

/**
 * The colour a long absence leans toward: a soft, slightly cool grey-green.
 *
 * Not blue and not grey. A blue cast reads as cold, or as moonlight in the middle of the
 * afternoon; a neutral grey reads as fog. Both are the horror-film direction the brief rules out.
 * A muted sage sits inside the island's own palette and reads as shade under leaves, which is what
 * an overgrown garden actually looks like on a bright day.
 */
export const AMBIENCE_SHADE_TINT = '#b9c4c1';

/** The most of {@link AMBIENCE_SHADE_TINT} that is ever mixed in. A hint, not a filter. */
export const AMBIENCE_SHADE_MAX = 0.22;

/**
 * How the sprout count is eased into wildness.
 *
 * Above 1, so the bottom of the range is softened: the brief's Stage 0 is 「幾乎沒有變化」, and a
 * player back after one night coming home to a visibly greyer island would read it as the game
 * being broken rather than as time having passed.
 *
 * It is a gentle correction rather than a dramatic one, and worth being honest about the size of
 * it. Against a straight ratio it moves one day from 0.077 to 0.052, a week from 0.46 to 0.41, and
 * a fortnight from 0.81 to 0.78 — it takes the most off exactly where the island is supposed to
 * look untouched, and leaves the long absences almost where they were.
 */
const AMBIENCE_CURVE = 1.15;

/** Wildness below which no vine has any length at all — see {@link IslandAmbience.vineGrowth}. */
const VINE_START_WILDNESS = 0.25;

/** How much more wildness it takes from there for a strand to reach its full drop. */
const VINE_FULL_SPAN = 0.6;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** The named degree a given wildness reads as. */
export function gradeForWildness(wildness: number): IslandGradeDef {
  let found = ISLAND_GRADES[0];
  for (const grade of ISLAND_GRADES) {
    if (wildness >= grade.fromWildness) found = grade;
  }
  return found;
}

/**
 * How overgrown `count` objects make an island look, 0..1.
 *
 * Measured against {@link OVERGROWTH_MAX} — the same ceiling the growth curve tops out at — so a
 * maximally overgrown island is exactly 1 by construction, rather than by a coincidence between
 * two numbers that could later drift apart.
 */
export function wildnessForSprouts(count: number): number {
  if (count <= 0) return 0;
  return clamp01(Math.pow(clamp01(count / OVERGROWTH_MAX), AMBIENCE_CURVE));
}

/**
 * What a clean island looks like: no change to anything.
 *
 * A shared constant rather than `resolveIslandAmbience([])` at each call site, so the common case —
 * every player who is simply playing normally — allocates nothing and compares by identity.
 */
export const NEUTRAL_AMBIENCE: IslandAmbience = {
  wildness: 0,
  grade: ISLAND_GRADES[0],
  saturation: 1,
  brightness: 1,
  exposure: 1,
  shade: 0,
  vineGrowth: 0,
};

/**
 * The one calculation: what the island is currently holding → how the island should look.
 *
 * Cheap and pure, so it is safe to call from a render body, and total, so no caller needs a null
 * branch for a player who has never been away. It reads a LENGTH and nothing else — deliberately
 * not the kinds, not the positions, not the clock — which keeps it one number's worth of thinking
 * and makes {@link wildnessForSprouts} testable on its own.
 *
 * Every consumer takes one field off the result and nothing else:
 *
 *   Three/Scene.tsx             saturation, brightness, exposure, shade → the light
 *   Three/IslandOvergrowth.tsx  vineGrowth                             → how far ivy has climbed
 *   UI/AdminIslandControls.tsx  wildness, grade                        → the readout
 */
export function resolveIslandAmbience(
  sprouts: readonly OvergrowthSprout[] | null | undefined,
): IslandAmbience {
  const count = sprouts?.length ?? 0;
  if (count <= 0) return NEUTRAL_AMBIENCE;

  const wildness = wildnessForSprouts(count);
  return {
    wildness,
    grade: gradeForWildness(wildness),
    saturation: 1 - (1 - AMBIENCE_SATURATION_FLOOR) * wildness,
    brightness: 1 - (1 - AMBIENCE_BRIGHTNESS_FLOOR) * wildness,
    exposure: 1 - (1 - AMBIENCE_EXPOSURE_FLOOR) * wildness,
    shade: wildness,
    vineGrowth: clamp01((wildness - VINE_START_WILDNESS) / VINE_FULL_SPAN),
  };
}

/* --- 離線褪色與回歸恢復 (Colour drain & recovery) ----------------------------------------- */

/**
 * 離線越久，畫面越沒有顏色 — and the moment the player is back, the colour returns.
 *
 * This is the second half of the environment state, and it is the CLOCK-driven half.
 * {@link resolveIslandAmbience} above deliberately never looks at the time, for reasons argued at
 * length on {@link IslandAmbience}; the short version is that a permanent grading derived from a
 * number the player cannot act on leaves them standing in a tidied garden that is still grey.
 *
 * The colour drain escapes that trap because it is not permanent. It is what the world looks like
 * at the *instant the player walks back in*, and it spends the next few seconds undoing itself.
 * The clock decides how far the colour drained; coming back is what brings it back. Nothing about
 * it is ever saved (see below), nothing about it can be reached by playing, and the only way to
 * see it at all is to have been away.
 *
 * So the two halves answer two different questions and never fight:
 *
 *   resolveIslandAmbience(sprouts)  →  what the island looks like WHILE you play    (permanent,
 *                                      gentle, cleared by tidying, applied to the LIGHT)
 *   resolveIslandColour(hours, t)   →  what it looks like the moment you ARRIVE     (transient,
 *                                      can reach full greyscale, applied to the FRAME)
 *
 * ## Nothing here is persisted (brief §12)
 *
 * There is no 「正在播放恢復動畫」 field on the save, and there must never be one. The recovery is
 * derived from two numbers held in memory for the length of one session — how long the absence
 * was, and when this session started — so a player who closes the tab halfway through simply gets
 * a *shorter* absence measured on their next login, and therefore a shallower drain. A saved
 * progress marker would have to be reconciled against a clock that had moved on underneath it,
 * and the failure mode is a world stuck grey with no way back.
 */

/**
 * Absence below which the colour does not move at all.
 *
 * A day rather than {@link QUIET_HOURS}, and deliberately longer than the threshold at which
 * things start GROWING. Someone who plays most evenings must never see this system: the recovery
 * is a small piece of theatre about having been away, and a player who was away for an afternoon
 * has not been. Setting it here also means the veil that draws the effect never even mounts for
 * a daily player, so the common session pays nothing for a feature it will not see.
 */
export const COLOUR_QUIET_HOURS = 24;

/** Days away, past {@link COLOUR_QUIET_HOURS}, at which the world is fully black and white. */
export const COLOUR_FULL_DAYS = 30;

/**
 * The shape of the drain between those two points.
 *
 * Below 1, so colour is lost quickly at first and then more and more slowly — the opposite of the
 * growth curve above, and on purpose. Overgrowth has to stay legible as 「一個下午整理得完」 no
 * matter how long the absence, so its curve flattens. Colour has the whole range to itself and
 * nothing to protect, so it can afford to say something early: three days away is already visibly
 * quieter, which is what makes the return worth watching.
 *
 * Measured, in saturation left on the frame: 1 day → 1.00, 2 days → 0.87, 3 days → 0.80,
 * 7 days → 0.62, 10 days → 0.51, 14 days → 0.40, 21 days → 0.22, 30 days → 0.02, 31 days+ → 0.00.
 */
const COLOUR_CURVE = 0.6;

/**
 * The five named degrees of drain — 「Stage 0 … Stage 4」 from the brief, as an admin readout.
 *
 * They exist to be *said*, and for nothing else. **No code branches on a colour stage**, exactly
 * as nothing branches on an {@link IslandGradeDef}: every visual consequence reads the continuous
 * {@link colourDrainForHours} instead, because 「離線超過 X 天 → 直接變黑白」 is the one shape the
 * brief rules out by name. A ladder here would put four visible cliffs into what has to be a slide.
 */
export type ColourStageId = 'full' | 'faded' | 'muted' | 'ashen' | 'mono';

export interface ColourStageDef {
  id: ColourStageId;
  /** Drain at which this stage begins. The first entry must be 0. */
  fromDrain: number;
  /**
   * A drain squarely INSIDE this stage, for the admin panel to sit the screen at.
   *
   * Separate from {@link fromDrain} because a boundary is the worst possible place to demonstrate
   * a band from — it is the one value that could equally be read as the stage below, and 輕微褪色
   * begins below {@link COLOUR_MIN_DRAIN}, so previewing at its own boundary would show nothing at
   * all. The panel turns this back into an absence through {@link hoursForColourDrain}, so what a
   * tester looks at is still a real point on the production curve.
   */
  previewDrain: number;
  /** Admin/readout wording. Never shown to an ordinary player. */
  label: string;
}

export const COLOUR_STAGES: readonly ColourStageDef[] = [
  { id: 'full', fromDrain: 0, previewDrain: 0, label: '正常彩色' },
  { id: 'faded', fromDrain: 0.1, previewDrain: 0.2, label: '輕微褪色' },
  { id: 'muted', fromDrain: 0.35, previewDrain: 0.5, label: '明顯褪色' },
  { id: 'ashen', fromDrain: 0.7, previewDrain: 0.85, label: '接近灰階' },
  { id: 'mono', fromDrain: 0.98, previewDrain: 1, label: '完全黑白' },
];

/**
 * How long the arrival state is held before the colour starts coming back, in seconds.
 *
 * Short, but not zero. Without it the recovery begins on the same frame the world appears and the
 * player never sees the thing that is recovering — they just see a slightly odd fade-in and learn
 * nothing. Just under a second is enough to read 「咦，沒有顏色」 and not long enough to feel like
 * being made to wait.
 */
export const RECOVERY_HOLD_SECONDS = 0.8;

/**
 * How long the colour takes to come back, in seconds.
 *
 * The brief's 「建議控制在數秒內」. It is also a ceiling on the whole effect rather than a pacing
 * knob: the player is walking, opening panels and talking to the shop throughout — nothing about
 * this waits for them, and nothing about it can be waited for. See the veil component for why it
 * cannot block input even in principle.
 */
export const RECOVERY_SECONDS = 5.5;

/**
 * Drain below which no recovery is played at all.
 *
 * A guard on the whole feature rather than a tuning value: under it the veil is never mounted, so
 * there is no element, no compositing pass and no animation frame for the overwhelmingly common
 * case of someone who was away overnight. It sits just above what a two-day absence produces, so
 * the effect starts at the point it is actually legible.
 */
export const COLOUR_MIN_DRAIN = 0.12;

/**
 * 島嶼失去了多少顏色 — 0 (untouched) to 1 (fully black and white), from the hours away.
 *
 * The single place an absence is turned into a colour level. Every consumer reads this or reads
 * something derived from it; nothing anywhere else in the codebase compares an hour count against
 * a threshold to decide how the screen should look (brief §3 / §17).
 */
export function colourDrainForHours(hours: number): number {
  if (!Number.isFinite(hours) || hours <= COLOUR_QUIET_HOURS) return 0;
  const days = (hours - COLOUR_QUIET_HOURS) / 24;
  return clamp01(Math.pow(clamp01(days / COLOUR_FULL_DAYS), COLOUR_CURVE));
}

/**
 * The inverse: the shortest absence that drains this much colour.
 *
 * Exists for the admin panel, which has to be able to ask for 「接近灰階」 and get there the same
 * way a real absence would. Going through the inverse rather than letting the panel set a drain
 * directly is the same rule the day buttons already follow — the tester moves the clock, and the
 * production curve decides what that looks like, so there is no second implementation to drift.
 */
export function hoursForColourDrain(drain: number): number {
  const d = clamp01(drain);
  if (d <= 0) return 0;
  return COLOUR_QUIET_HOURS + Math.pow(d, 1 / COLOUR_CURVE) * COLOUR_FULL_DAYS * 24;
}

/** The named degree a given drain reads as. */
export function colourStageForDrain(drain: number): ColourStageDef {
  let found = COLOUR_STAGES[0];
  for (const stage of COLOUR_STAGES) {
    if (drain >= stage.fromDrain) found = stage;
  }
  return found;
}

/**
 * 0..1 → 0..1, slow at both ends and steady through the middle.
 *
 * The bloom widening out of the island. Chosen over a cubic ease for the *start*: a cubic spends
 * the first fifth of the animation at effectively zero, so the bloom would sit invisible and then
 * lurch. This leaves the middle of the frame almost immediately and then travels at a near-even
 * pace, which is what 「色彩逐漸擴散」 has to look like.
 */
function easeInOutSine(t: number): number {
  return 0.5 * (1 - Math.cos(Math.PI * t));
}

/**
 * 0..1 → 0..1, slow at both ends and quick through the middle.
 *
 * The uniform part of the lift, and deliberately *behind* the bloom for most of the run: while
 * the cleared circle is at 10% of the frame the rest of the world is still only 3% recovered, so
 * the returning colour reads as a place rather than as the brightness being turned up. The two
 * curves meet at both ends, so the effect starts fully drained and finishes exactly neutral.
 */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * 恢復演示 — what the screen should look like `elapsed` seconds after the player walked back in.
 */
export interface IslandColourState {
  /** How much colour the absence took, 0..1. Constant for the whole session. */
  drain: number;
  /** What that reads as in words, at the arrival state. Readout only — nothing branches on it. */
  stage: ColourStageDef;
  /** How far through the recovery, 0..1. Stays 0 through the hold, hits 1 when it is over. */
  progress: number;
  /**
   * The saturation multiplier to apply to the finished frame right now: `drain`-worth of
   * desaturation at the start, exactly 1 when the recovery ends.
   */
  saturation: number;
  /**
   * 0..1 — how far the returned colour has spread out from the middle of the island (brief §8).
   * Zero means 「still uniformly drained」; 1 means the bloom has passed the corners of the screen.
   */
  bloom: number;
  /**
   * True once the effect is a no-op and the veil can be taken down. Both terms land on their
   * neutral value together, so removing the element at this point changes not one pixel.
   */
  done: boolean;
}

/** A fully recovered screen — the value everything falls back to. Shared, so it allocates nothing. */
export const CLEAR_COLOUR_STATE: IslandColourState = {
  drain: 0,
  stage: COLOUR_STAGES[0],
  progress: 1,
  saturation: 1,
  bloom: 1,
  done: true,
};

/**
 * The one recovery calculation: 「離開了多久」 + 「回來多久了」 → 「畫面現在該長什麼樣」.
 *
 * Pure and total, so the veil can call it from an animation frame without owning any state of its
 * own beyond a start time, the admin panel can call it to preview a level without running an
 * animation, and the test script can call it without a browser.
 *
 * `elapsed` is seconds since the player arrived. Passing `null` freezes it at the arrival state,
 * which is what the admin's 「停在這個階段」 buttons do — the same curve, simply not advanced.
 *
 * ## The two terms, and why the effect can end without a snap
 *
 * `saturation` lifts the whole frame back toward colour; `bloom` opens a hole in the middle of the
 * island where the effect is not applied at all, so colour is visibly back *somewhere* long before
 * it is back everywhere. They are timed to arrive together: at `progress === 1` the saturation is
 * exactly 1 AND the bloom is past the corners, so the frame is already untouched by the time the
 * element is removed. An effect that ended while still doing something would flash on the way out,
 * and that flash would be the most visible thing in the whole animation.
 */
export function resolveIslandColour(
  hours: number,
  elapsed: number | null,
): IslandColourState {
  const drain = colourDrainForHours(hours);
  if (drain < COLOUR_MIN_DRAIN) return CLEAR_COLOUR_STATE;

  const stage = colourStageForDrain(drain);
  const arrival = 1 - drain;

  // Frozen at the arrival state — the admin preview. Never `done`, because the whole point is
  // that it stays on screen to be looked at.
  if (elapsed === null) {
    return { drain, stage, progress: 0, saturation: arrival, bloom: 0, done: false };
  }

  const progress = clamp01((elapsed - RECOVERY_HOLD_SECONDS) / RECOVERY_SECONDS);
  return {
    drain,
    stage,
    progress,
    saturation: arrival + (1 - arrival) * easeInOutCubic(progress),
    bloom: easeInOutSine(progress),
    done: progress >= 1,
  };
}

/* --- The pet ---------------------------------------------------------------------------- */

export type PetMoodId = 'lively' | 'calm' | 'waiting' | 'reunion';

export interface PetMoodDef {
  id: PetMoodId;
  label: string;
  /**
   * How strongly the animal prefers its own resting spot over its owner's heel, 0..1. At 0 it
   * follows normally; at 1 it stays home until the owner comes to it.
   */
  nestPull: number;
  /** Multiplies its walking pace. Never zero — a pet that stops moving reads as broken, not calm. */
  pace: number;
  /** Multiplies its idle bob and tail motion. */
  liveliness: number;
  /** Whether the resting spot (mat, bowl, toys) is drawn while this mood holds. */
  showsNest: boolean;
  /**
   * What is said about the pet when the player comes back to this mood, or null for the moods
   * that need no comment. Shown once by the return panel, never as a permanent bubble.
   */
  greeting: string | null;
}

/**
 * The four states, and the whole of the pet's life system.
 *
 * `reunion` is the only transient one: it is set the moment a returning player's island is
 * resolved and cleared again the moment they are back beside their companion, which is what gives
 * the running-over-to-you moment somewhere to live without a timer or a one-off flag. The other
 * three are steady states resolved from how long the owner was away.
 *
 * Nothing in this table can harm the animal, and nothing outside it decides how the animal
 * behaves — IslandPet reads these numbers and multiplies its existing follow behaviour by them.
 */
export const PET_MOODS: Record<PetMoodId, PetMoodDef> = {
  lively: {
    id: 'lively',
    label: '活潑',
    nestPull: 0,
    pace: 1,
    liveliness: 1,
    showsNest: false,
    greeting: null,
  },
  calm: {
    id: 'calm',
    label: '悠閒',
    nestPull: 0.45,
    pace: 0.82,
    liveliness: 0.7,
    showsNest: true,
    greeting: '牠比平常安靜一些，多半待在自己的窩附近。',
  },
  waiting: {
    id: 'waiting',
    label: '等你回來',
    nestPull: 0.8,
    pace: 0.7,
    liveliness: 0.5,
    showsNest: true,
    greeting: '牠好像等了你很久，玩具還散在窩的旁邊。',
  },
  reunion: {
    id: 'reunion',
    label: '好久不見',
    nestPull: 0,
    pace: 1.25,
    liveliness: 1.4,
    showsNest: true,
    greeting: '牠一看到你就跑了過來。',
  },
};

/**
 * Which mood an absence produces.
 *
 * A function rather than a lookup at the call sites, so the extra needs named in the brief
 * (飢餓 / 心情 / 親密度 / 活力 / 玩耍需求) can be weighed here later without any consumer changing.
 * Today it reads the stage and whether the player has just walked back in.
 */
export function resolvePetMood(hours: number, opts: { justReturned?: boolean } = {}): PetMoodId {
  const stage = stageForHours(hours);
  if (opts.justReturned && stage.greets) return 'reunion';
  return stage.petMood;
}

/** How settled the animal looks, 0..1 — full at home, easing down over a long absence. */
export function vitalityForHours(hours: number): number {
  if (hours <= QUIET_HOURS) return 1;
  const days = (hours - QUIET_HOURS) / 24;
  return Math.max(0.45, 1 - days * 0.06);
}

/** The steady state an animal settles into once its owner is back and has said hello. */
export const PET_HOME_STATE: PetLifeState = { mood: 'lively', vitality: 1 };

/**
 * Builds a {@link PetLifeState} with no `undefined` anywhere in it.
 *
 * This is not tidiness, it is the difference between the feature working and silently not
 * existing. `lastGreetedAt` is absent for every pet that has never been greeted — which is every
 * pet, initially — and writing `{ lastGreetedAt: undefined }` makes Firestore's `updateDoc` throw
 * `invalid-argument` SYNCHRONOUSLY, before the request is even sent. The whole `islandState` write
 * then fails, the timestamp never persists, and every login resolves as a first sighting.
 *
 * It also fails in the most misleading way available: `invalid-argument` has no entry in
 * lib/saveStatus.ts's message table, so the player is shown the generic 「存檔失敗…請稍後再試」
 * rather than anything that points at the cause — and because the throw happens client-side, a
 * correctly deployed ruleset makes no difference at all.
 *
 * An optional field is therefore OMITTED rather than set to undefined. Any field added to
 * `PetLifeState` later has to come through here for the same reason.
 */
export function makePetState(
  mood: PetMoodId,
  vitality: number,
  lastGreetedAt?: string,
  /**
   * The legacy single 寵物照護 state. Carried through untouched by writers that are only preserving
   * it; nothing produces a NEW value for it any more — see {@link PetLifeState.care}.
   */
  care?: PetCareState,
  /** 每一隻寵物的照護狀態. Omitted — never `undefined` — when this write is not carrying any. */
  cares?: Record<string, PetCareState>,
): PetLifeState {
  const base: PetLifeState = { mood, vitality };
  if (lastGreetedAt !== undefined) base.lastGreetedAt = lastGreetedAt;
  if (care !== undefined) base.care = care;
  if (cares !== undefined) base.cares = cares;
  return base;
}

/**
 * Where the companion's resting spot is: beside the Home, on the flank away from the door.
 *
 * ONE derivation, because two things need the same answer and they must not drift: the scene draws
 * the mat, the bowl and the toys there (Three/IslandOvergrowth.tsx) and the animal itself walks
 * there while its owner is away (Three/IslandPet.tsx). A pet waiting three metres from its own bed
 * is the exact kind of small wrongness that reads as a bug rather than as a mood.
 *
 * With no Home yet it takes a fixed spot out on the grass. That path is effectively unreachable —
 * a player without a house has never been away — but it keeps the function total, so neither
 * caller needs a null branch of its own.
 */
export function getPetRestSpot(
  home: { position: [number, number, number]; rotation: number } | null,
  islandScale: number,
): { x: number; z: number } {
  if (!home) return { x: 2.2 * islandScale, z: 2.2 * islandScale };
  const localX = PET_REST_OFFSET.x;
  const localZ = PET_REST_OFFSET.z;
  const cos = Math.cos(home.rotation);
  const sin = Math.sin(home.rotation);
  // three rotates about +Y as x' = x·cos + z·sin, z' = -x·sin + z·cos — the same convention
  // lib/furniturePlacement.ts states for its own boxes.
  return {
    x: home.position[0] + localX * cos + localZ * sin,
    z: home.position[2] - localX * sin + localZ * cos,
  };
}

/**
 * The resting spot in the Home's local frame: one metre off its side wall, a little behind centre.
 *
 * Off the SIDE rather than the front, so the mat is never in the doorway approach the placement
 * rules keep clear for the player, and never between them and the 進入我的家 prompt.
 */
const PET_REST_OFFSET = { x: 2.9, z: -0.35 } as const;

/**
 * How close the owner has to come before a quiet animal breaks off and goes to them.
 *
 * Generously large: the whole point of 「等你回來」 is that the pet notices you, and a radius the
 * player has to walk into deliberately would make it look asleep rather than waiting.
 */
export const PET_NOTICE_RADIUS = 6.5;

/** How close the animal must actually get before the reunion counts as having happened. */
export const PET_GREET_RADIUS = 1.6;

/** How long the 撒嬌 celebration runs before the animal settles back into following, in seconds. */
export const PET_GREET_SECONDS = 1.8;

/* --- Reading an absence ----------------------------------------------------------------- */

export interface OfflineReturn {
  /** Whole hours between the last sighting and now. Zero for a player who has never left. */
  hours: number;
  /** The same gap in whole days, for the copy. */
  days: number;
  stage: OfflineStageDef;
  /** Whether this absence is worth a greeting — the stage's own `greets`. */
  shouldGreet: boolean;
  /** True when there is no `lastSeenAt`: a brand-new player, or a save from before this existed. */
  isFirstSighting: boolean;
}

/**
 * Turns "when were they last here" into everything the rest of the feature needs.
 *
 * A missing or unreadable `lastSeenAt` is a FIRST SIGHTING, never a long absence (brief §15). That
 * covers both the genuinely new player and every existing save that predates this feature: neither
 * has ever been away, so neither comes back to an overgrown island. It also refuses to read a
 * negative gap — a device clock set backwards reports zero rather than a nonsense stage.
 */
export function resolveOfflineReturn(
  lastSeenAt: string | undefined | null,
  now: Date = new Date(),
): OfflineReturn {
  const seen = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
  if (!Number.isFinite(seen)) {
    return { hours: 0, days: 0, stage: DEFAULT_STAGE, shouldGreet: false, isFirstSighting: true };
  }
  const hours = Math.max(0, Math.floor((now.getTime() - seen) / 3_600_000));
  const stage = stageForHours(hours);
  return {
    hours,
    days: Math.floor(hours / 24),
    stage,
    shouldGreet: stage.greets,
    isFirstSighting: false,
  };
}

/**
 * One of the stage's lines, chosen by a seed rather than at random.
 *
 * Seeded from the return's own timestamp so the message is stable for that return — a re-render,
 * or the panel being reopened, must not reshuffle the sentence under the player — while still
 * differing from one absence to the next.
 */
export function pickReturnLine(stage: OfflineStageDef, seed: number): string {
  if (stage.lines.length === 0) return '';
  return stage.lines[Math.abs(Math.floor(seed)) % stage.lines.length];
}

/**
 * How often the world re-stamps `lastSeenAt` while it is open.
 *
 * The gap this feature measures is "since you were last playing", so something has to say so while
 * play is happening. Five minutes is the coarsest cadence that is still invisible against a ladder
 * whose first threshold is twelve hours, and it is cheap: one small write per five minutes of
 * actual play, skipped entirely while the tab is hidden.
 */
export const SEEN_HEARTBEAT_MS = 5 * 60 * 1000;

/**
 * How close the player has to be for the 整理 prompt to offer a patch of overgrowth, and how much
 * of it one press clears.
 *
 * One radius for both, so what the prompt is pointing at is exactly what the action takes. Wide
 * enough that a cluster goes in one press rather than one weed at a time, small enough that the
 * player is clearly tidying *this* corner rather than pressing a button that cleans the island.
 */
export const TIDY_RADIUS = 2.6;

/**
 * How near the Home the player must be for one press to also take the vines and cobwebs off it.
 *
 * Larger than {@link TIDY_RADIUS} because a wall-borne sprout is measured from the building's
 * centre rather than from its own position, and the building is nearly four units across — at the
 * ground radius the player would have to stand inside the house to reach its own walls.
 */
export const TIDY_HOME_RADIUS = 4.2;
