/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useSyncExternalStore } from 'react';

/**
 * The first-run queue: which piece of onboarding owns the screen right now.
 *
 * ## The problem
 *
 * Three surfaces greet a brand-new player, and each one used to decide for
 * itself whether it was allowed to be up:
 *
 *  - LoginBonusPopup polled `playerBus` every 500 ms and then just rendered.
 *  - NewbieTour polled the DOM for `.z-modal` every 300 ms and paused if it
 *    found one.
 *  - HomeSetupGuide read a bespoke one-boolean store exported by NewbieTour.
 *
 * Nobody was in charge of the ORDER, so the order was an accident of DOM
 * position and a z-index tie: LoginBonusPopup and HomeSetupGuide both mount as
 * full-bleed `z-modal` scrims, and because the Home guide renders later in
 * App.tsx it painted on top of the login bonus — covering its 太棒了！ button
 * with a transparent scrim whose click handler dismissed *the other dialog*.
 * A player pressing the visible button got the invisible one. That is the whole
 * of "提示視窗無法正常關閉": nothing was stuck, the click was landing on the
 * wrong dialog.
 *
 * It also inverted the intended sequence. The tour is meant to run first ("here
 * is your screen") and the Home guide second ("now put your house down"), which
 * is exactly what both components' own comments say — but the tour's `.z-modal`
 * check saw the Home guide's scrim and stood down, so the tour never played at
 * all for a new player.
 *
 * ## The rule
 *
 * One list, one slot. A surface declares that it *wants* the screen; the
 * earliest waiting entry in {@link ONBOARDING_ORDER} gets it and everyone else
 * waits. Nothing here polls, nothing queries the DOM, and no participant knows
 * another exists — adding a fourth tutorial is one string in the array below and
 * one `useOnboardingSlot` call in the component, which is what stops this from
 * regrowing as a web of pairwise "am I allowed" checks.
 *
 * Deliberately NOT on AppContext: sequencing three first-run popups is not game
 * state, and putting it there would re-render the world every time a tutorial
 * advanced. Same reasoning as `lib/playerBus.ts`.
 *
 * WHAT THIS DOES NOT DO: it does not gate ordinary modals (a purchase confirm,
 * the account panel). Those can legitimately open on top of onboarding at any
 * time, and NewbieTour still steps aside for them on its own.
 */

/**
 * Marker class for an onboarding surface that renders as a `z-modal` scrim.
 *
 * NewbieTour steps aside for ordinary blocking dialogs by looking for `.z-modal`
 * in the DOM (see its `useModalPresent`), and two of this queue's own members
 * ARE `.z-modal` scrims. Left unmarked, the tour reads "a dialog is up" from the
 * very guide that is waiting behind it and neither ever starts — the same
 * deadlock this module exists to remove, just relocated. Queue members are
 * ordered by the list below and must be invisible to that probe.
 *
 * Put it on the `ModalOverlay`'s className; leave every non-onboarding dialog
 * unmarked, since those genuinely should pause the tour.
 */
export const ONBOARDING_MODAL_CLASS = 'onboarding-modal';

/** `.z-modal` scrims that are NOT part of the first-run sequence. */
export const FOREIGN_MODAL_SELECTOR = `.z-modal:not(.${ONBOARDING_MODAL_CLASS})`;

/**
 * Priority order, highest first. This is the sequence a new player experiences.
 *
 * `loginBonus` comes before the tutorials because it is a reward for an action
 * already taken and is one click to clear; `newbieTour` teaches the HUD the other
 * two are talking about; `homeSetup` comes last because it hands control to the
 * placement system and ends onboarding.
 *
 * `islandReturn` (離線回歸, see constants/islandReturn.ts) sits second, and it is the one member
 * that is NOT first-run: it greets a player coming back after days away, so in practice it and
 * the two tutorials below it are mutually exclusive — anyone who can have been away has long
 * since finished both. It is in this queue anyway because the problem the queue solves is
 * 「兩個對話框同時搶畫面」 and not 「這是不是新手」: it is a z-modal scrim, and on the one login
 * where it and the daily-login board both want the screen, something has to say which goes first.
 * It follows the reward and precedes everything that teaches, which is the order the player
 * would expect: collect what you earned, see what changed, then get on with it.
 *
 * `workoutReward` (健身獎勵, see constants/workoutRewards.ts) leads, and it is the only member that
 * can appear at ANY point in a session rather than at a login. It is here for the queue's actual
 * purpose — 「兩個對話框同時搶畫面」 — and it goes first because it is the most immediate thing on
 * the list: the player finished a workout seconds ago and walked back to see what they got. In
 * practice it collides with nothing (the tutorials are long finished by the time anyone reaches
 * 運動, and a login greeting cannot arrive mid-session), which is exactly why its position is a
 * declaration here rather than a z-index accident later.
 */
export const ONBOARDING_ORDER = ['workoutReward', 'loginBonus', 'islandReturn', 'newbieTour', 'homeSetup'] as const;

export type OnboardingStepId = (typeof ONBOARDING_ORDER)[number];

const waiting = new Set<OnboardingStepId>();
const listeners = new Set<() => void>();

/**
 * Cached because `useSyncExternalStore` demands a getSnapshot that is stable
 * between real changes — recomputing on every call would return a new answer to
 * an unchanged store and spin React.
 */
let current: OnboardingStepId | null = null;

function recompute(): void {
  const next = ONBOARDING_ORDER.find((id) => waiting.has(id)) ?? null;
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Which onboarding step owns the screen, or null when none wants it. */
export function useCurrentOnboardingStep(): OnboardingStepId | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/**
 * Claims the onboarding slot for `id`, and reports whether it may show now.
 *
 * Two separate conditions, because "this step still has to happen" and "this
 * step can be on screen this instant" are not the same thing and conflating
 * them loses the queue's whole point:
 *
 *  - `queued` — holds the place in line. True from the moment the step knows it
 *    will run, INCLUDING while it is still warming up.
 *  - `ready`  — may actually draw. Defaults to `queued` for the steps where
 *    wanting and being able are the same condition.
 *
 * The 新手引導 is the case that needs both: it waits ~900 ms after the HUD
 * settles before the coach walks in, and with a single flag it did not exist to
 * the queue during that pause — so HomeSetupGuide, whose condition is true the
 * instant the profile loads, took the empty slot, drew its modal, and was then
 * displaced three seconds later. Nothing was broken by that, but a dialog that
 * appears and is yanked away is exactly the "彈窗一直跳" the queue is here to
 * stop. Reserving the place immediately and drawing later makes the order the
 * player sees the order declared above, with no flash of the wrong step.
 *
 * A step that is queued but outranked gets `false` and holds its own state
 * untouched — it is waiting, not cancelled, and appears the moment the step
 * above it finishes.
 *
 * Membership is registered from an effect rather than during render (a render
 * must not mutate a module store), so the first frame after `queued` flips
 * answers `false`. That is a frame, not a delay: every consumer animates in, so
 * it is invisible, and nothing here is timer-driven.
 */
export function useOnboardingSlot(
  id: OnboardingStepId,
  queued: boolean,
  ready: boolean = queued,
): boolean {
  useEffect(() => {
    if (!queued) return;
    waiting.add(id);
    recompute();
    return () => {
      waiting.delete(id);
      recompute();
    };
  }, [id, queued]);

  return useCurrentOnboardingStep() === id && queued && ready;
}

/**
 * Whether any onboarding surface is currently on screen.
 *
 * For bystanders that must not fight it — not for participants, which use
 * {@link useOnboardingSlot} instead.
 */
export function useOnboardingActive(): boolean {
  return useCurrentOnboardingStep() !== null;
}
