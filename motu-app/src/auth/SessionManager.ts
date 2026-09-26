/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  getRedirectResult,
  setPersistence,
  type UserCredential,
} from 'firebase/auth';
import { firebaseAuth } from '../lib/firebaseCore';
import type { AuthProviderId } from './types';

/**
 * Everything about a session that outlives a page load: where Firebase keeps
 * it, which provider established it, and the device-scoped identity used when
 * Firebase cannot issue a session at all.
 *
 * The original code answered "Session Token 是否未正確保存" with a
 * `localStorage['is_local_guest']` string that four different modules read and
 * wrote, including a branch in `onAuthStateChanged` that *dropped real Firebase
 * auth events on the floor* whenever the flag was stale. All of that state now
 * lives here, behind named methods, and none of it can suppress a real session.
 */

const STORAGE_KEYS = {
  /** Which provider the player last signed in with — used for "上次使用" hints. */
  lastProvider: 'island.auth.lastProvider',
  /** Stable per-device id backing a local-only guest. */
  localGuestId: 'island.auth.localGuestId',
  /** '1' while the player is actually *in* a local-only guest session. */
  localSessionActive: 'island.auth.localSessionActive',
  /** Set while a redirect sign-in is in flight, so we know to expect a result. */
  pendingRedirect: 'island.auth.pendingRedirectProvider',
} as const;

/** localStorage that never throws — private mode and disabled storage are real. */
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Session simply won't survive the reload. Not fatal. */
  }
}

function clearStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export class SessionManager {
  private persistenceReady: Promise<void> | null = null;

  /**
   * Picks the strongest persistence the browser will accept, so a returning
   * player is auto-logged-in (Session Restore) rather than shown the sign-in
   * screen again.
   *
   * The fallback chain matters on iOS: Safari in Private Browsing rejects
   * IndexedDB-backed persistence outright, and without a fallback
   * `setPersistence` rejects and takes the whole sign-in call down with it.
   */
  ensurePersistence(): Promise<void> {
    if (this.persistenceReady) return this.persistenceReady;

    this.persistenceReady = (async () => {
      const candidates = [browserLocalPersistence, browserSessionPersistence, inMemoryPersistence];
      for (const persistence of candidates) {
        try {
          await setPersistence(firebaseAuth, persistence);
          return;
        } catch {
          /* try the next one down */
        }
      }
      console.warn('[auth] No usable auth persistence; the session will not survive a reload.');
    })();

    return this.persistenceReady;
  }

  /**
   * Consumes a pending `signInWithRedirect` result. Must run once at startup,
   * before the app decides the player is signed out — a redirect sign-in
   * completes by returning to a *fresh page load*, so skipping this is the
   * classic "login worked, then the app showed the login screen again" bug.
   *
   * Returns null when there was no redirect in flight, which is the normal case.
   */
  async consumeRedirectResult(): Promise<UserCredential | null> {
    const pending = readStorage(STORAGE_KEYS.pendingRedirect);
    try {
      const result = await getRedirectResult(firebaseAuth);
      if (result) clearStorage(STORAGE_KEYS.pendingRedirect);
      return result;
    } catch (error) {
      // Re-thrown to the manager so the player sees why the redirect failed
      // instead of silently landing back on the sign-in screen.
      clearStorage(STORAGE_KEYS.pendingRedirect);
      if (pending) throw error;
      return null;
    }
  }

  /** True when a redirect sign-in was started and has not been consumed yet. */
  hasPendingRedirect(): boolean {
    return readStorage(STORAGE_KEYS.pendingRedirect) !== null;
  }

  markRedirectPending(providerId: AuthProviderId): void {
    writeStorage(STORAGE_KEYS.pendingRedirect, providerId);
  }

  getLastProvider(): AuthProviderId | null {
    return (readStorage(STORAGE_KEYS.lastProvider) as AuthProviderId | null) ?? null;
  }

  setLastProvider(providerId: AuthProviderId): void {
    writeStorage(STORAGE_KEYS.lastProvider, providerId);
  }

  /**
   * The uid for a local-only guest — a player whose device could not get a real
   * Firebase session (anonymous sign-in disabled, or offline).
   *
   * Randomised per device rather than the old hardcoded `'local-guest-uid'`.
   * That constant meant every local guest everywhere shared one save namespace,
   * so on a shared browser two people's islands overwrote each other, and
   * signing out then back in as a *different* account still read the previous
   * player's data. See `src/save/LocalSaveStore.ts` for the namespacing.
   */
  ensureLocalGuestId(): string {
    const existing = readStorage(STORAGE_KEYS.localGuestId);
    if (existing) return existing;

    const id = `guest-${crypto.randomUUID()}`;
    writeStorage(STORAGE_KEYS.localGuestId, id);
    return id;
  }

  /** The device's local-guest id if one was ever created, else null. */
  peekLocalGuestId(): string | null {
    return readStorage(STORAGE_KEYS.localGuestId);
  }

  /**
   * Whether the player is currently *in* a local-only session.
   *
   * Split from {@link ensureLocalGuestId} deliberately: the id must survive
   * signing in with a real account, because that is precisely when we still
   * need it — to find the local save and claim it into the new account. Only
   * this flag says "serve the local session right now", and it is checked
   * exactly once, in `AuthenticationManager.resolveUser()`, and only when
   * Firebase reports nobody signed in. A real Firebase session therefore always
   * wins; the old `is_local_guest` flag could and did suppress one.
   */
  isLocalSessionActive(): boolean {
    return readStorage(STORAGE_KEYS.localSessionActive) === '1';
  }

  startLocalSession(): string {
    const id = this.ensureLocalGuestId();
    writeStorage(STORAGE_KEYS.localSessionActive, '1');
    return id;
  }

  endLocalSession(): void {
    clearStorage(STORAGE_KEYS.localSessionActive);
  }

  /**
   * Forgets the local-only guest identity. Called after its save has been
   * successfully claimed into a real account, so the orphaned local data cannot
   * be picked up again by the next guest on this device.
   */
  clearLocalGuestId(): void {
    clearStorage(STORAGE_KEYS.localGuestId);
    clearStorage(STORAGE_KEYS.localSessionActive);
  }

  /** Clears per-session bookkeeping on sign-out. Keeps the local guest id. */
  clearSessionMarkers(): void {
    clearStorage(STORAGE_KEYS.pendingRedirect);
    this.endLocalSession();
  }
}

export const sessionManager = new SessionManager();
