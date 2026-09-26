/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { UserProfile } from '../types';

/**
 * 等級 — derived from cumulative XP, never stored.
 *
 * `profile.level` is written once, as `1`, when a save is created (AppContext) and is not
 * incremented anywhere in the game: there is no level-up write, and there never was one. Every
 * XP-granting path — a workout (FitnessView), 摸狗, the 島上互動, the 管理員測試補給 — only ever
 * does `currentXp: increment(n)`. So the LV badge sat on 1 forever while the XP bar, which draws
 * `currentXp % 100`, wrapped silently back to the same place.
 *
 * That is the whole of 「按了加經驗值沒有反應」: the 測試補給 button grants exactly 1000 XP, which
 * is ten whole levels' worth, so `currentXp % 100` lands on the identical pixel it started on and
 * the stored level cannot move. The write landed every time; nothing on screen was capable of
 * showing it.
 *
 * Deriving it here rather than adding a level-up write keeps ONE source of truth (the cumulative
 * XP that utils/unlock.ts already measures item unlocks against) and means an old save shows its
 * real level the moment it loads, with nothing to migrate. The doc comment in utils/unlock.ts
 * already described the game this way — 「等級是由 currentXp / 100 推導出來的」 — so this is the
 * code catching up with the rule, not a new rule.
 */
export const XP_PER_LEVEL = 100;

/** LV.1 at 0 XP, LV.2 at 100 XP, and so on. Never below 1, never fractional. */
export function levelFromXp(xp: number | undefined | null): number {
  const safe = typeof xp === 'number' && Number.isFinite(xp) && xp > 0 ? xp : 0;
  return Math.floor(safe / XP_PER_LEVEL) + 1;
}

/** How far into the current level the player is, in XP — the 0–99 the progress bar draws. */
export function xpIntoLevel(xp: number | undefined | null): number {
  const safe = typeof xp === 'number' && Number.isFinite(xp) && xp > 0 ? xp : 0;
  return safe % XP_PER_LEVEL;
}

/** The player's level for display. Reads the profile so call sites don't each repeat the field. */
export function profileLevel(profile: Pick<UserProfile, 'currentXp'> | null | undefined): number {
  return levelFromXp(profile?.currentXp);
}
