/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef } from 'react';
import { db, doc, updateDoc, handleFirestoreError, OperationType } from '../lib/firebase';
import type { AuthUser } from '../auth/types';
import type { UserProfile } from '../types';
import { getPlayerHome } from '../hooks/usePlayerHome';
import { getPetSpec } from '../constants/pets';
import {
  IslandEnvironmentState,
  OfflineStageId,
  PET_HOME_STATE,
  PET_MOODS,
  SEEN_HEARTBEAT_MS,
  makePetState,
  pickReturnLine,
  resolveOfflineReturn,
  resolvePetMood,
  stageForHours,
  vitalityForHours,
} from '../constants/islandReturn';
import {
  newPetCareState,
  petCondition,
  readPetCareState,
  readPetCareStates,
  settlePetCare,
  type PetCareState,
} from '../constants/petCare';
import { equippedPetId, equippedPetIds } from './usePetCare';
import {
  growOvergrowth,
  summariseOvergrowth,
  tidyOvergrowthAt,
} from '../lib/islandOvergrowth';

/**
 * 離線回歸 — the writes, and the one calculation that runs when a player arrives.
 *
 * Split out of AppContext for the same reason useEconomyActions and useHomeActions were: the
 * provider should not be one block in which the wallet, the house and the weather all live
 * together. Everything here goes through the same `updateDoc` path as every other save, touches
 * exactly one profile field (`islandState`), and can be refused without costing the player
 * anything — which is the point of a feature whose entire output is decoration.
 *
 * ## What is deliberately NOT here
 *
 * No currency, no XP, no inventory, no placement writes. Tidying pays nothing and losing an
 * absence costs nothing; the reward for coming back is that the island is yours to put right. If
 * a future pass wants to pay for tidying, it belongs in useEconomyActions with every other grant,
 * not smuggled into the environment layer.
 */

/**
 * The greeting a returning player is shown, assembled once at arrival.
 *
 * A resolved value rather than a pointer at the state, because the panel must keep saying the
 * same thing while the player is reading it: the moment they walk out and tidy the first patch,
 * the island's state no longer describes the absence they just came back from.
 */
export interface IslandReturnEvent {
  hours: number;
  days: number;
  stageId: OfflineStageId;
  /** One of the stage's lines, picked by seed — see constants/islandReturn.ts. */
  line: string;
  /** 「落葉 x5・雜草 x3」, or empty when the island grew nothing new this time. */
  summary: string;
  /** What to say about the companion, or null when there is none or nothing to say. */
  petLine: string | null;
}

/**
 * 離線褪色的恢復 — the transient half of the environment state, held in memory for one session.
 *
 * Deliberately NOT part of {@link IslandEnvironmentState} and deliberately never written to the
 * save. The brief's §12 is explicit that there must be no persisted 「正在播放恢復動畫」 flag, and
 * this shape is what that rule looks like: two numbers, created at arrival, thrown away when the
 * tab closes. A player who leaves halfway through simply measures a shorter absence next time and
 * gets a shallower drain — the correct answer, arrived at by having nothing to reconcile.
 */
export interface IslandRecovery {
  /** Whole hours this arrival measured. The only input to the colour curve. */
  hours: number;
  /** Whether to play the recovery, or hold the arrival state for an admin to look at. */
  play: boolean;
  /** Distinguishes one arrival (or one admin press) from the next, so the veil restarts cleanly. */
  token: number;
}

/** What an arrival produced: the state to persist, and the greeting to show (if any). */
export interface IslandArrival {
  state: IslandEnvironmentState;
  event: IslandReturnEvent | null;
  /**
   * How long the absence was, in whole hours — the input the colour drain reads.
   *
   * Returned rather than re-derived by the caller so that 「島上長出了多少」 and 「畫面褪了多少色」
   * are answers to the same measurement of the same absence, taken once. Zero for a first sighting.
   */
  offlineHours: number;
}

/** The island's XZ scale at a given territory level — the same derivation the scene uses. */
function islandScaleFor(profile: UserProfile): number {
  return 1 + ((profile.territoryLevel ?? 1) - 1) * 0.4;
}

/**
 * Whether this player has a companion out on the island.
 *
 * Asks the shared definition (context/usePetCare.ts) rather than re-testing `equippedItems` here,
 * which is what it used to do. Two copies of 「什麼算是一隻寵物」 is how a screen that stops offering
 * to feed an animal and a panel that still greets one end up disagreeing about the same save.
 */
function hasCompanion(profile: UserProfile): boolean {
  return equippedPetIds(profile).length > 0;
}

/**
 * Every companion's 照護狀態, brought up to `nowMs`.
 *
 * Two things get folded together here, and only one of them is arithmetic:
 *
 *  - the stored map is settled entry by entry, which is what makes the save reflect what the player
 *    is about to see rather than what they left behind;
 *  - the PRIMARY companion, if it has no entry yet, inherits the pre-multi-pet single `care`. That
 *    is the migration, and running it at arrival means it happens once, at login, on the path that
 *    was going to write `islandState.pet` anyway — rather than lazily inside a render.
 *
 * An animal the player owns but has never had out gets nothing here: it acquires an entry the first
 * time it is fed. An absent entry already reads as 「還沒餓過」 everywhere (context/usePetCare.ts's
 * `rawPetCare`), so writing full states for pets sitting in a wardrobe would only make the save
 * bigger.
 */
function settleAllPetCare(profile: UserProfile, nowMs: number): Record<string, PetCareState> {
  const pet = profile.islandState?.pet;
  const cares = readPetCareStates(pet?.cares, nowMs);
  const primary = equippedPetId(profile);
  if (primary && !cares[primary] && pet?.care) cares[primary] = readPetCareState(pet.care, nowMs);
  const settled: Record<string, PetCareState> = {};
  for (const [id, state] of Object.entries(cares)) settled[id] = settlePetCare(state, nowMs);
  return settled;
}

/**
 * Works out what the island did while this player was away, from their saved profile.
 *
 * A pure function taking the profile, NOT a hook, because the two places that need it cannot both
 * be a hook: it runs inside AppContext's profile load (before the profile is state at all) and
 * again from the admin's offline simulator. Given the same profile and the same instant it always
 * produces the same answer, which is what makes the simulator a real test of the live path rather
 * than a second implementation of it.
 *
 * A first sighting — no `lastSeenAt`, which is every brand-new player and every save written
 * before this feature existed — stamps the clock and does nothing else. That is the brief's §15,
 * and it is why the check is for a missing timestamp rather than for a missing profile: a save
 * from last year has never been *away*, it has only never been *seen*.
 */
export function resolveIslandArrival(profile: UserProfile, now: Date = new Date()): IslandArrival {
  const previous = profile.islandState ?? {};
  const stamp = now.toISOString();
  const ret = resolveOfflineReturn(previous.lastSeenAt, now);

  if (ret.isFirstSighting) {
    // A first sighting stamps the clock and does nothing else — including to the pet. Its care
    // state is created full (a brand-new companion is not hungry) and, crucially, is stamped as of
    // NOW: a save that predates the care system has no `updatedAt` to measure from, and giving one
    // an anchor in the past would charge a player for every day the feature did not exist.
    //
    // The per-pet map is RE-STAMPED rather than carried through, for that same reason: a save from
    // before the care system has no `lastSeenAt`, so every state in it — however it got there — is
    // anchored to a moment this feature was not measuring, and the honest answer to 「牠餓了多久」
    // is 「還沒開始算」. Re-stamping keeps the entries (so a household of three stays a household of
    // three) and moves each of their clocks to now.
    const stamped = Object.fromEntries(
      Object.keys(readPetCareStates(previous.pet?.cares, now.getTime())).map((id) => [
        id,
        newPetCareState(now.getTime()),
      ]),
    );
    const pet = previous.pet
      ? makePetState(
          previous.pet.mood,
          previous.pet.vitality,
          previous.pet.lastGreetedAt,
          previous.pet.care ?? newPetCareState(now.getTime()),
          stamped,
        )
      : makePetState(
          PET_HOME_STATE.mood,
          PET_HOME_STATE.vitality,
          undefined,
          newPetCareState(now.getTime()),
          {},
        );
    return {
      state: { ...previous, lastSeenAt: stamp, pet },
      event: null,
      offlineHours: 0,
    };
  }

  const before = previous.sprouts ?? [];
  const sprouts = growOvergrowth({
    existing: before,
    hours: ret.hours,
    // ResolvedHome is structurally a HomeObstacle — see utils/placementRules.ts, which declares
    // the shape locally so the solver stays free of React.
    home: getPlayerHome(profile),
    islandScale: islandScaleFor(profile),
    placements: profile.islandPlacements ?? [],
  });

  const mood = resolvePetMood(ret.hours, { justReturned: ret.shouldGreet });
  /**
   * 寵物照護, brought up to date — the whole of 「離線期間寵物狀態怎麼變」 (brief §16).
   *
   * There is no offline code path, and that is the design: the care state carries the moment it was
   * last true, so settling it against `now` gives what an absence did to it in exactly the same
   * arithmetic that covers a tab left open over lunch. Nothing counted down while the player was
   * gone, and nothing had to.
   *
   * It is settled HERE, on arrival, rather than only being read lazily, so the save reflects what
   * the player is about to see. Every other reader settles again for itself and lands on the same
   * answer — see `settlePetCare` on why calling it twice is free.
   *
   * Every animal in the household, not just the one out front (§6): the state is a map keyed by
   * companion id, and each entry is settled against the same instant. Settling them all costs a
   * couple of arithmetic operations per pet and keeps 「牠餓了嗎」 an answer about THAT animal.
   */
  const cares = settleAllPetCare(profile, now.getTime());
  /** The animal the arrival panel is talking about — the one that will be standing there. */
  const care = cares[equippedPetId(profile) ?? ''] ?? newPetCareState(now.getTime());
  const state: IslandEnvironmentState = {
    ...previous,
    lastSeenAt: stamp,
    sprouts,
    // Through the builder, never as an object literal: `lastGreetedAt` is absent for a pet that
    // has never been greeted, and an explicit `undefined` is what Firestore refuses. See
    // makePetState — that one field is enough to make this entire feature silently not exist.
    pet: makePetState(
      mood,
      vitalityForHours(ret.hours),
      previous.pet?.lastGreetedAt,
      previous.pet?.care,
      cares,
    ),
  };

  if (!ret.shouldGreet) return { state, event: null, offlineHours: ret.hours };

  state.lastReturnAt = stamp;
  state.lastReturnStage = ret.stage.id;
  state.lastReturnHours = ret.hours;

  // What grew THIS time. growOvergrowth appends, so the tail is the new growth — and when an
  // absence adds nothing (the ceiling was already reached, or the island had nowhere left to put
  // anything) the panel falls back to describing what is standing there, so a returning player is
  // never told about an island that grew nothing while looking at one covered in weeds.
  const fresh = sprouts.slice(before.length);
  const summary = summariseOvergrowth(fresh.length > 0 ? fresh : sprouts);

  return {
    state,
    offlineHours: ret.hours,
    event: {
      hours: ret.hours,
      days: ret.days,
      stageId: ret.stage.id,
      line: pickReturnLine(ret.stage, now.getTime() / 60000),
      summary,
      // The mood's line first, and the care band's only when the animal is at the bottom of the
      // ladder. Two sentences about the same pet on every return would read as a status report;
      // 「餓了」 is worth saying exactly when it is the thing the player can do something about.
      petLine: hasCompanion(profile)
        ? [PET_MOODS[mood].greeting, petCondition(care).band.id === 'drowsy' ? '牠的碗空了，餵一點東西吧。' : null]
            .filter(Boolean)
            .join('') || null
        : null,
    },
  };
}

export function useIslandLife(
  user: AuthUser | null,
  profile: UserProfile | null,
  /** Writes a value the database has already accepted into local state — see AppContext. */
  applyProfilePatch: (updates: Partial<UserProfile>) => void,
  /** Hands the arrival greeting to whoever is showing it (AppContext holds it as state). */
  publishReturn: (event: IslandReturnEvent | null) => void,
  /**
   * Hands the colour recovery to whoever is drawing it. In-memory only — see {@link IslandRecovery}
   * for why this one deliberately does not travel with the rest of the island state.
   */
  publishRecovery: (recovery: IslandRecovery | null) => void,
) {
  /**
   * When `lastSeenAt` was last pushed to the save, so the heartbeat can stay off the wire.
   *
   * Seeded to NOW rather than to zero, because the arrival write that runs moments after this hook
   * mounts has already stamped it. Starting at zero makes the very first beat — which a single tab
   * switch is enough to trigger — a duplicate of a write that just happened.
   */
  const lastStampRef = useRef(Date.now());
  const uid = user?.uid ?? null;

  /**
   * Persists a change to `islandState`, keeping local state and the save in step.
   *
   * Optimistic, and rolled back on refusal, exactly like AppContext's updateProfile: everything
   * this feature writes is something the player can already SEE on the island, so waiting for a
   * round trip before the weeds disappear would make tidying feel broken on a slow connection.
   *
   * `fields` is what actually goes to Firestore and `next` is what the screen should show. They
   * are separate arguments because the two callers want different granularity, and the difference
   * matters: the heartbeat is re-stamping `lastSeenAt` every few minutes WHILE the player is out
   * tidying, so a tidy that wrote the whole map would carry a stale timestamp back over a fresher
   * one. The per-field callers below therefore write `islandState.sprouts` / `islandState.pet`
   * alone, and only the arrival — which genuinely replaces all of it in one go — writes the map.
   */
  const writeIslandState = useCallback(
    async (fields: Record<string, unknown>, next: IslandEnvironmentState, label: string): Promise<boolean> => {
      if (!uid || !profile) return false;
      const rollback = profile.islandState;
      applyProfilePatch({ islandState: next });
      try {
        await updateDoc(doc(db, 'users', uid), fields);
        return true;
      } catch (error) {
        applyProfilePatch({ islandState: rollback });
        console.warn(`[island] ${label} 沒有存檔成功：`, error);
        handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
        return false;
      }
    },
    [uid, profile, applyProfilePatch],
  );

  /**
   * Re-stamps "I am here", at most once per {@link SEEN_HEARTBEAT_MS}.
   *
   * A dotted-path write, so it cannot disturb the sprouts or the pet sitting beside it in the same
   * map. It also deliberately does NOT touch local state: the value is only ever read at the next
   * login, so pushing it into the profile would re-render the world every few minutes to carry a
   * string nothing on screen is looking at.
   *
   * The throttle is a ref rather than a timer, so every caller — the interval, the tab coming
   * back — funnels through one rate limit instead of each having its own.
   */
  const markSeen = useCallback(async (): Promise<void> => {
    if (!uid) return;
    const nowMs = Date.now();
    if (nowMs - lastStampRef.current < SEEN_HEARTBEAT_MS) return;
    lastStampRef.current = nowMs;
    try {
      await updateDoc(doc(db, 'users', uid), {
        'islandState.lastSeenAt': new Date(nowMs).toISOString(),
      });
    } catch (error) {
      // Deliberately quiet. A missed beat costs at most a slightly longer measured absence next
      // time, which is invisible against a ladder whose first threshold is twelve hours — not
      // worth a red banner over the player's island.
      console.warn('[island] 上線時間戳記沒有寫入：', error);
    }
  }, [uid]);

  /**
   * Clears the overgrowth the player is standing in. Returns how many pieces went.
   *
   * The reach test is `lib/islandOvergrowth.ts`'s, the same one the floating prompt asks before it
   * offers the action, so a badge can never promise a tidy that finds nothing to do.
   */
  const tidyIslandAt = useCallback(
    async (x: number, z: number): Promise<number> => {
      if (!profile) return 0;
      const sprouts = profile.islandState?.sprouts ?? [];
      if (sprouts.length === 0) return 0;

      const { sprouts: kept, removed } = tidyOvergrowthAt(sprouts, x, z, getPlayerHome(profile));
      if (removed.length === 0) return 0;

      const ok = await writeIslandState(
        { 'islandState.sprouts': kept },
        { ...profile.islandState, sprouts: kept },
        '整理環境',
      );
      // Zero on a refused write, not the count that was rolled back: the caller uses this to
      // decide whether to congratulate the player, and the weeds are back on their screen.
      return ok ? removed.length : 0;
    },
    [profile, writeIslandState],
  );

  /**
   * The companion has seen its owner again — back to normal.
   *
   * Called by Three/IslandPet.tsx once the animal has actually reached the player, not when the
   * greeting panel is dismissed: the reunion is a thing that happens in the world, and clearing it
   * from a button press would end the moment before it had been seen.
   */
  const greetPet = useCallback(async (): Promise<void> => {
    if (!profile) return;
    if (profile.islandState?.pet?.mood === 'lively') return;
    // The care state rides through untouched. A reunion says 「你回來了」, not 「你餵過牠了」 — an
    // animal that arrives at its owner's feet with a full bowl is the free meal this whole feature
    // is careful not to hand out, and dropping the field here would have done exactly that by
    // making the next read treat it as a never-fed pet.
    const pet = makePetState(
      PET_HOME_STATE.mood,
      PET_HOME_STATE.vitality,
      new Date().toISOString(),
      profile.islandState?.pet?.care,
      profile.islandState?.pet?.cares,
    );
    await writeIslandState({ 'islandState.pet': pet }, { ...profile.islandState, pet }, '寵物狀態');
  }, [profile, writeIslandState]);

  /**
   * 管理員測試 — rewinds the last sighting by `days` and replays the arrival for real.
   *
   * It does not fabricate a result: it moves the one timestamp the feature measures from and then
   * runs {@link resolveIslandArrival}, the same function the login path runs, so what the tester
   * sees is what a player who was genuinely away that long would see. That is why the simulator is
   * worth having at all — a shortcut that painted the outcome directly would be a second
   * implementation, and would pass while the real one was broken.
   */
  const simulateOfflineDays = useCallback(
    async (days: number): Promise<boolean> => {
      if (!profile) return false;
      const rewound = new Date(Date.now() - days * 86_400_000).toISOString();
      const arrival = resolveIslandArrival(
        { ...profile, islandState: { ...profile.islandState, lastSeenAt: rewound } },
        new Date(),
      );
      const ok = await writeIslandState({ islandState: arrival.state }, arrival.state, '離線模擬');
      if (ok) {
        publishReturn(arrival.event);
        // The same hour count the growth was sited from, so the tester sees one absence expressed
        // two ways rather than two features that happen to have been pressed at the same time.
        publishRecovery({ hours: arrival.offlineHours, play: true, token: performance.now() });
      }
      return ok;
    },
    [profile, writeIslandState, publishReturn, publishRecovery],
  );

  /** 管理員測試 — back to a clean island and a lively pet, without touching anything else. */
  const resetIslandEnvironment = useCallback(async (): Promise<boolean> => {
    if (!profile) return false;
    publishReturn(null);
    publishRecovery(null);
    const next: IslandEnvironmentState = {
      ...profile.islandState,
      lastSeenAt: new Date().toISOString(),
      sprouts: [],
      // A fed, rested animal — not a pet with the care field stripped off. An absent state reads
      // as 「從沒餓過」 which is the same outcome, but the tester pressing 重置 needs to be able to
      // see the numbers they just reset rather than an empty map.
      //
      // EVERY companion, not just the one out front: 重置環境 means 「回到乾淨的島和一隻精神很好的
      // 寵物」, and a reset that left the cat listless because it happened not to be equipped would
      // be a reset the tester has to do twice and cannot tell has only half happened.
      pet: makePetState(
        PET_HOME_STATE.mood,
        PET_HOME_STATE.vitality,
        undefined,
        newPetCareState(Date.now()),
        Object.fromEntries(
          Object.keys(readPetCareStates(profile.islandState?.pet?.cares, Date.now())).map((id) => [
            id,
            newPetCareState(Date.now()),
          ]),
        ),
      ),
    };
    return writeIslandState({ islandState: next }, next, '重置環境');
  }, [profile, writeIslandState, publishReturn, publishRecovery]);

  /**
   * 管理員測試 — puts the screen at the colour a given absence drains to, without touching the save.
   *
   * The only thing in this file that writes nothing at all, and the only admin control that is
   * allowed to skip {@link resolveIslandArrival}: the colour drain is a pure function of hours and
   * is not persisted, so there is no state here for a shortcut to get out of step with. Everything
   * it can express, a real absence of `hours` would express identically — the panel obtains its
   * hour counts from the production curve's own inverse rather than inventing levels.
   *
   * `hours: null` ends the preview (「恢復完成」); `play: false` holds the arrival state on screen
   * so a level can actually be looked at instead of flashing past.
   */
  const previewIslandColour = useCallback(
    (hours: number | null, play = false) => {
      publishRecovery(hours === null ? null : { hours, play, token: performance.now() });
    },
    [publishRecovery],
  );

  return {
    markSeen,
    tidyIslandAt,
    greetPet,
    simulateOfflineDays,
    resetIslandEnvironment,
    previewIslandColour,
  };
}

/** Admin readout: what the current absence would be called. Never shown to an ordinary player. */
export function describeOfflineStage(hours: number): string {
  return stageForHours(hours).label;
}
