/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared "has this one-shot guide already played" bookkeeping for every
 * first-run tutorial NPC in the app — 新手引導 (NewbieTour.tsx) and 小天使導覽
 * (AngelGuide.tsx) both build on this.
 *
 * Centralised for two reasons:
 *
 *  1. 管理員測試模式 (see hooks/useAdminMode.ts) has to override every one of
 *     them the same way — replay on every login, never write "seen" — and
 *     previously each guide carried its own copy of that rule as a hardcoded
 *     `..._ALWAYS_SHOW = true` constant. Those were dev-only overrides meant
 *     to be flipped back before shipping, which is exactly the kind of thing
 *     that gets left on by accident; a runtime, per-account switch replaces
 *     the need for that pattern entirely.
 *  2. Both guides already agreed the underlying flag belongs in localStorage,
 *     not the Firestore profile — it is a device-level UI nicety, not game
 *     state, and must never cost a network round-trip. This is that one
 *     shared implementation instead of two near-identical copies.
 *
 * The key is the caller's own localStorage key (each guide keeps its own
 * prefix/naming), so this module has no opinion on naming — only on the
 * read/write/admin-override contract.
 */

export function hasSeenTutorial(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    // Private mode / storage disabled — worst case the guide shows again.
    return false;
  }
}

/**
 * Records a guide as seen — UNLESS admin mode is on. Admin Test Mode must
 * never touch a real player's completed-tutorial record: turning it back off
 * has to restore exactly the state a normal player would already be in, so
 * a session spent testing under admin mode writes nothing.
 */
export function markTutorialSeen(key: string, isAdminMode: boolean): void {
  if (isAdminMode) return;
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* ignore */
  }
}

/** Whether a one-shot guide should run right now: admin mode always replays it. */
export function shouldShowTutorial(key: string, isAdminMode: boolean): boolean {
  return isAdminMode || !hasSeenTutorial(key);
}
