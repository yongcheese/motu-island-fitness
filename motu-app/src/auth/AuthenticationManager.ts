/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  linkWithPopup,
  linkWithRedirect,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  signInWithCustomToken,
  signInWithPopup,
  signInWithRedirect,
  type User,
} from 'firebase/auth';
import { firebaseAuth } from '../lib/firebaseCore';
import { resetObjectRuntimeState } from '../lib/objectRuntimeState';
import { buildAuthError, normalizeAuthError } from './errors';
import { fromFirebaseProviderId, getProvider } from './providers/registry';
import type { ProviderDescriptor } from './providers/types';
import { sessionManager } from './SessionManager';
import { tokenManager } from './TokenManager';
import type { AuthError, AuthProviderId, AuthState, AuthUser } from './types';

/**
 * The single entry point for everything to do with who is signed in.
 *
 * ## Why this exists
 *
 * Sign-in used to be three loose functions in `lib/firebase.ts` plus an object
 * named `auth` that impersonated Firebase's own. Between them they had four
 * separate bugs, and every one of them presented to the player as "只能用訪客":
 *
 *  1. `signInWithGoogle()` was called from `onClick` with no `.catch`. Firebase
 *     rejects with `auth/unauthorized-domain` when the origin is not in the
 *     Authorised domains list — which it is not for `localhost` on this project
 *     — so the button rejected a promise nobody awaited and did nothing visible.
 *  2. `signInGuest()` caught *every* failure of `signInAnonymously` and quietly
 *     fell back to a localStorage pseudo-session. Anonymous sign-in is disabled
 *     in this project's console (`ADMIN_ONLY_OPERATION`), so that fallback was
 *     not an edge case, it was the only path that ever ran.
 *  3. The fake `auth.onAuthStateChanged` began with
 *     `if (isLocalGuest) return;` — a stale `is_local_guest` flag therefore
 *     *discarded real Firebase sign-in events*, so even a successful Google
 *     login could not take effect.
 *  4. Popup-only, with no redirect fallback, so embedded webviews and browsers
 *     blocking third-party cookies could never sign in at all.
 *
 * ## The rules this class enforces
 *
 * - Providers are data (`providers/registry.ts`), dispatched on `strategy`.
 *   There is no per-provider flow.
 * - A real Firebase session ALWAYS wins over the local-only fallback.
 * - Nothing fails silently. Every rejection becomes an {@link AuthError} on the
 *   state, and configuration mistakes additionally log the console fix.
 * - Falling back to a local-only session is explicit, visible in
 *   `AuthUser.isLocalOnly`, and recoverable via {@link linkProvider}.
 */
export class AuthenticationManager {
  private state: AuthState = {
    status: 'initialising',
    user: null,
    error: null,
    pendingProviderId: null,
  };

  private listeners = new Set<(state: AuthState) => void>();
  private initialised: Promise<void> | null = null;

  /**
   * Set when a local-only guest signs into a real account and their local save
   * still needs to be moved over. The save layer picks this up, migrates, then
   * calls {@link completeLocalClaim}.
   *
   * Kept as a plain field rather than done inline so this class stays ignorant
   * of the save schema — auth knows *that* a claim is owed, not *what* a save is.
   */
  private pendingLocalClaim: { fromUid: string; toUid: string } | null = null;

  // --- Lifecycle ---------------------------------------------------------

  /**
   * Wires up session restore. Safe to call repeatedly; only the first call does
   * work. Must be awaited (or at least started) before the app decides the
   * player is signed out.
   */
  initialise(): Promise<void> {
    if (this.initialised) return this.initialised;

    this.initialised = (async () => {
      this.setState({ status: 'restoring' });
      await sessionManager.ensurePersistence();

      // A redirect sign-in finishes on a *new page load*, so this has to run
      // before the first auth-state decision or the player bounces straight
      // back to the sign-in screen having just signed in successfully.
      try {
        await sessionManager.consumeRedirectResult();
      } catch (error) {
        const provider = (sessionManager.getLastProvider() ?? 'google') as AuthProviderId;
        this.setState({ error: normalizeAuthError(error, provider) });
      }

      // From here on, Firebase is the source of truth for real sessions.
      onAuthStateChanged(
        firebaseAuth,
        (firebaseUser) => this.handleFirebaseUser(firebaseUser),
        (error) => {
          console.error('[auth] onAuthStateChanged failed', error);
          this.setState({ status: 'unauthenticated', user: null });
        },
      );
    })();

    return this.initialised;
  }

  /**
   * Reconciles a Firebase auth event with any local-only session.
   *
   * The precedence rule lives here and nowhere else: a real user wins. A
   * local-only session is served ONLY when Firebase says nobody is signed in.
   */
  private handleFirebaseUser(firebaseUser: User | null): void {
    if (firebaseUser) {
      // Signing in for real ends any local-only session. If that session had a
      // save, record the claim so the save layer can move it across.
      if (sessionManager.isLocalSessionActive()) {
        const fromUid = sessionManager.peekLocalGuestId();
        sessionManager.endLocalSession();
        if (fromUid && fromUid !== firebaseUser.uid) {
          this.pendingLocalClaim = { fromUid, toUid: firebaseUser.uid };
        }
      }
      this.setState({
        status: 'authenticated',
        user: mapFirebaseUser(firebaseUser),
        pendingProviderId: null,
      });
      return;
    }

    if (sessionManager.isLocalSessionActive()) {
      this.setState({
        status: 'authenticated',
        user: buildLocalGuest(sessionManager.ensureLocalGuestId()),
        pendingProviderId: null,
      });
      return;
    }

    this.setState({ status: 'unauthenticated', user: null, pendingProviderId: null });
  }

  // --- Public API --------------------------------------------------------

  getState(): AuthState {
    return this.state;
  }

  /** Subscribes to state changes; fires immediately with the current state. */
  subscribe(listener: (state: AuthState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get tokens(): typeof tokenManager {
    return tokenManager;
  }

  get session(): typeof sessionManager {
    return sessionManager;
  }

  /** Dismisses the current error, e.g. when the player closes the banner. */
  clearError(): void {
    if (this.state.error) this.setState({ error: null });
  }

  /**
   * Signs in with any provider in the registry.
   *
   * Resolves to the signed-in user, or null when the attempt failed or was
   * cancelled — in which case `getState().error` explains why. It does not
   * throw, because every caller is a click handler and a throwing click handler
   * is exactly how the original bug hid itself.
   */
  async signIn(providerId: AuthProviderId): Promise<AuthUser | null> {
    const descriptor = getProvider(providerId);
    if (!descriptor) {
      this.setState({ error: buildAuthError('unknown', providerId) });
      return null;
    }
    if (descriptor.status !== 'ready') {
      this.setState({ error: buildAuthError('provider-not-implemented', providerId) });
      return null;
    }

    await this.initialise();
    this.setState({ status: 'signing-in', pendingProviderId: providerId, error: null });

    try {
      const user = await this.runStrategy(descriptor);
      // A redirect flow navigates away, so `user` is null and the result lands
      // in `consumeRedirectResult()` on the next load. Leave the pending state.
      if (user) {
        sessionManager.setLastProvider(providerId);
        this.setState({ status: 'authenticated', user, pendingProviderId: null, error: null });
      }
      return user;
    } catch (error) {
      return this.handleSignInFailure(error, descriptor);
    }
  }

  /** Dispatch on strategy — deliberately not on provider id. */
  private async runStrategy(descriptor: ProviderDescriptor): Promise<AuthUser | null> {
    switch (descriptor.strategy) {
      case 'firebase-oauth':
        return this.runOAuth(descriptor);

      case 'firebase-anonymous': {
        const credential = await signInAnonymously(firebaseAuth);
        return mapFirebaseUser(credential.user);
      }

      case 'custom-token': {
        // Discord/Steam: our backend verifies the third-party login and mints a
        // Firebase custom token. Unreachable while those are `planned`; kept
        // here so promoting them needs no change to this class.
        if (!descriptor.customTokenEndpoint) {
          throw buildAuthError('provider-not-implemented', descriptor.id);
        }
        const response = await fetch(descriptor.customTokenEndpoint, { method: 'POST' });
        if (!response.ok) throw new Error(`Custom token exchange failed: ${response.status}`);
        const { token } = (await response.json()) as { token: string };
        const credential = await signInWithCustomToken(firebaseAuth, token);
        return mapFirebaseUser(credential.user);
      }

      case 'firebase-password':
        // Needs an e-mail/password form; the provider stays `planned` until
        // that UI exists, so `signIn` rejects it before reaching here.
        throw buildAuthError('provider-not-implemented', descriptor.id);
    }
  }

  private async runOAuth(descriptor: ProviderDescriptor): Promise<AuthUser | null> {
    const provider = descriptor.createFirebaseProvider?.();
    if (!provider) throw buildAuthError('provider-not-implemented', descriptor.id);

    if (descriptor.preferredFlow === 'redirect') {
      sessionManager.markRedirectPending(descriptor.id);
      sessionManager.setLastProvider(descriptor.id);
      await signInWithRedirect(firebaseAuth, provider);
      return null; // the page navigates away
    }

    try {
      const credential = await signInWithPopup(firebaseAuth, provider);
      return mapFirebaseUser(credential.user);
    } catch (error) {
      // Popups are blocked by default in embedded webviews (the LINE/Facebook
      // in-app browsers players actually arrive from) and whenever third-party
      // storage is partitioned. Redirect always works there, so treat a blocked
      // popup as "use the other flow", not as a failure.
      if (isPopupUnavailable(error)) {
        sessionManager.markRedirectPending(descriptor.id);
        sessionManager.setLastProvider(descriptor.id);
        await signInWithRedirect(firebaseAuth, provider);
        return null;
      }
      throw error;
    }
  }

  /**
   * Turns a failed sign-in into visible state — and, for Guest only, into the
   * offline fallback session.
   */
  private handleSignInFailure(error: unknown, descriptor: ProviderDescriptor): AuthUser | null {
    const authError: AuthError =
      isAuthError(error) ? error : normalizeAuthError(error, descriptor.id);

    // Guest is the one provider allowed to degrade rather than fail, because
    // "let me just play" must always work. Crucially this is now *visible*:
    // the resulting user carries `isLocalOnly: true`, the UI says the save is
    // device-only, and `linkProvider()` upgrades it. The old code did the same
    // downgrade invisibly and called it success.
    if (descriptor.id === 'guest' && authError.code !== 'cancelled') {
      console.warn(
        '[auth] Firebase 匿名登入無法使用，改用「僅限本機」訪客模式（存檔不會跨裝置同步）。',
        authError.message,
      );
      const uid = sessionManager.startLocalSession();
      const user = buildLocalGuest(uid);
      sessionManager.setLastProvider('guest');
      this.setState({
        status: 'authenticated',
        user,
        pendingProviderId: null,
        // Kept on state so the UI can explain the degraded mode. Configuration
        // errors here are the developer's cue to enable Anonymous sign-in.
        error: authError.isConfigurationError ? authError : null,
      });
      return user;
    }

    this.setState({
      status: this.state.user ? 'authenticated' : 'unauthenticated',
      pendingProviderId: null,
      error: authError.code === 'cancelled' ? null : authError,
    });
    return null;
  }

  /**
   * Binds an additional provider onto the account the player is already using —
   * the 「訪客存檔綁定至正式帳號」 flow.
   *
   * Two genuinely different cases, both handled here so no caller has to know
   * which one it is in:
   *
   *  - **Firebase anonymous guest** → `linkWithPopup`. The account is upgraded
   *    *in place*: same uid, so every document under `users/{uid}` is already
   *    the right document. Nothing is copied and nothing can be lost. This is
   *    why Guest is worth fixing properly rather than papering over.
   *  - **Local-only guest** → there is no Firebase account to upgrade, so we
   *    sign in for real and record a claim; the save layer copies the local
   *    save into the new uid (see `src/save/guestClaim.ts`).
   */
  async linkProvider(providerId: AuthProviderId): Promise<AuthUser | null> {
    const descriptor = getProvider(providerId);
    if (!descriptor || descriptor.status !== 'ready') {
      this.setState({ error: buildAuthError('provider-not-implemented', providerId) });
      return null;
    }

    const current = firebaseAuth.currentUser;

    // Local-only guest: nothing to link to, so this is a plain sign-in plus a
    // save claim. `handleFirebaseUser` records the claim automatically.
    if (!current) {
      if (!sessionManager.isLocalSessionActive()) {
        this.setState({ error: buildAuthError('no-current-user', providerId) });
        return null;
      }
      return this.signIn(providerId);
    }

    const provider = descriptor.createFirebaseProvider?.();
    if (!provider) {
      this.setState({ error: buildAuthError('provider-not-implemented', providerId) });
      return null;
    }

    this.setState({ status: 'signing-in', pendingProviderId: providerId, error: null });
    try {
      if (descriptor.preferredFlow === 'redirect') {
        sessionManager.markRedirectPending(providerId);
        await linkWithRedirect(current, provider);
        return null;
      }
      const credential = await linkWithPopup(current, provider);
      sessionManager.setLastProvider(providerId);
      const user = mapFirebaseUser(credential.user);
      this.setState({ status: 'authenticated', user, pendingProviderId: null, error: null });
      return user;
    } catch (error) {
      const authError = normalizeAuthError(error, providerId);

      // The provider already belongs to another island. Signing in as that
      // account is the only sensible move, but it means abandoning the guest
      // progress, so we surface the error and let the player choose rather
      // than silently switching accounts under them.
      if (isPopupUnavailable(error)) {
        try {
          sessionManager.markRedirectPending(providerId);
          await linkWithRedirect(current, provider);
          return null;
        } catch (redirectError) {
          this.setState({
            status: 'authenticated',
            pendingProviderId: null,
            error: normalizeAuthError(redirectError, providerId),
          });
          return null;
        }
      }

      this.setState({
        status: 'authenticated',
        pendingProviderId: null,
        error: authError.code === 'cancelled' ? null : authError,
      });
      return null;
    }
  }

  /**
   * Re-authenticates an existing credential. Used by the Apple/Google account
   * chooser when a credential turns out to belong to a different account.
   */
  async signInWithExistingCredential(
    credential: Parameters<typeof signInWithCredential>[1],
    providerId: AuthProviderId,
  ): Promise<AuthUser | null> {
    try {
      const result = await signInWithCredential(firebaseAuth, credential);
      const user = mapFirebaseUser(result.user);
      this.setState({ status: 'authenticated', user, pendingProviderId: null, error: null });
      return user;
    } catch (error) {
      this.setState({ error: normalizeAuthError(error, providerId), pendingProviderId: null });
      return null;
    }
  }

  async signOut(): Promise<void> {
    sessionManager.clearSessionMarkers();
    this.pendingLocalClaim = null;
    // Interactive objects hold session-only state keyed by PLACEMENT INSTANCE ID
    // (lib/objectRuntimeState.ts): which hob is lit, which radio is playing. Those ids mean
    // nothing on the next account's island, so without this a hob left burning here would be
    // burning on somebody else's stove after a sign-out and sign-in with no reload in between.
    resetObjectRuntimeState();
    try {
      await firebaseAuth.signOut();
    } catch (error) {
      console.warn('[auth] Sign-out failed', error);
    }
    // `onAuthStateChanged` fires for real sessions, but a local-only session has
    // no Firebase event to ride on, so publish the signed-out state directly.
    this.setState({ status: 'unauthenticated', user: null, pendingProviderId: null, error: null });
  }

  // --- Guest save claim (consumed by the save layer) ----------------------

  /** A local-only save owed to a freshly signed-in account, or null. */
  getPendingLocalClaim(): { fromUid: string; toUid: string } | null {
    return this.pendingLocalClaim;
  }

  /** Called by the save layer once the claim has been applied (or abandoned). */
  completeLocalClaim(): void {
    this.pendingLocalClaim = null;
    sessionManager.clearLocalGuestId();
  }

  // --- Internals ---------------------------------------------------------

  private setState(patch: Partial<AuthState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
}

/** Firebase `User` → our normalised {@link AuthUser}. */
function mapFirebaseUser(user: User): AuthUser {
  const linkedProviders = user.providerData
    .map((entry) => fromFirebaseProviderId(entry.providerId))
    .filter((id): id is AuthProviderId => id !== null);

  return {
    uid: user.uid,
    displayName: user.displayName ?? (user.isAnonymous ? '訪客' : null),
    email: user.email,
    photoURL: user.photoURL,
    isGuest: user.isAnonymous,
    isLocalOnly: false,
    providerId: linkedProviders[0] ?? 'guest',
    linkedProviders,
  };
}

function buildLocalGuest(uid: string): AuthUser {
  return {
    uid,
    displayName: '訪客',
    email: null,
    photoURL: null,
    isGuest: true,
    isLocalOnly: true,
    providerId: 'guest',
    linkedProviders: [],
  };
}

function isAuthError(value: unknown): value is AuthError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'isConfigurationError' in value
  );
}

/** Blocked, unsupported, or cancelled-by-navigation popups — all mean "redirect". */
function isPopupUnavailable(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  return (
    code === 'auth/popup-blocked' ||
    code === 'auth/operation-not-supported-in-this-environment' ||
    code === 'auth/web-storage-unsupported'
  );
}

/** The app-wide instance. There is exactly one. */
export const authManager = new AuthenticationManager();
