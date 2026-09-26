/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared vocabulary for the whole Authentication System.
 *
 * Everything that talks about "who is signed in" — the manager, the providers,
 * the save layer, the UI — speaks in these types and nothing else. In
 * particular no consumer outside `src/auth/` imports from `firebase/auth`:
 * that is what let the previous implementation grow a hand-rolled fake `User`
 * in one file and a `user?.isAnonymous || !user?.email` guess in another.
 */

/**
 * Every sign-in method the game knows about, including ones that are declared
 * but not yet wired (see `providers/registry.ts` — those carry
 * `status: 'planned'`). Adding a provider starts by adding its id here, which
 * makes TypeScript point at every switch that has to learn about it.
 */
export type AuthProviderId =
  | 'google'
  | 'apple'
  | 'guest'
  | 'discord'
  | 'steam'
  | 'facebook'
  | 'microsoft'
  | 'github'
  | 'password';

/**
 * How a provider actually obtains a Firebase session. The registry maps each
 * provider to one of these, and AuthenticationManager has exactly one code
 * path per strategy — NOT one per provider. This is the property that makes
 * "add Discord later" a data change rather than a new flow.
 *
 * - `firebase-oauth`   Firebase speaks this IdP natively (Google, Apple,
 *                      Facebook, Microsoft, GitHub) — popup/redirect.
 * - `firebase-anonymous` Firebase's own anonymous accounts (Guest).
 * - `firebase-password`  Email + password.
 * - `custom-token`     Firebase does not speak this IdP (Discord, Steam).
 *                      Our backend verifies the third-party login and mints a
 *                      Firebase custom token; the client signs in with it.
 */
export type AuthStrategy =
  | 'firebase-oauth'
  | 'firebase-anonymous'
  | 'firebase-password'
  | 'custom-token';

/** How an OAuth provider hands control to the IdP. */
export type OAuthFlow = 'popup' | 'redirect';

/**
 * The signed-in player, normalised across every provider.
 *
 * Deliberately NOT firebase's `User`: the save layer needs to know whether a
 * session is durable (`isLocalOnly`), which is our concept, not Firebase's,
 * and UI needs `isGuest` rather than re-deriving it from `isAnonymous` plus a
 * missing e-mail.
 */
export interface AuthUser {
  /** Firebase uid, or a device-scoped id for a local-only guest. The save
   *  namespace key — see `src/save/LocalSaveStore.ts`. */
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  /** True for anonymous/guest sessions of any kind. */
  isGuest: boolean;
  /**
   * True when this session exists only in this browser's localStorage because
   * Firebase Auth could not issue a real session (anonymous sign-in disabled,
   * or offline). Progress is kept, but it does NOT sync across devices and it
   * cannot be trusted by Firestore rules. The UI must say so plainly, and
   * `AuthenticationManager.linkProvider()` is how the player escapes it.
   */
  isLocalOnly: boolean;
  /** Which provider established the current session. */
  providerId: AuthProviderId;
  /** Every provider bound to this account — the basis for account linking. */
  linkedProviders: AuthProviderId[];
}

/** Lifecycle of the auth subsystem. `restoring` is the auto-login window. */
export type AuthStatus =
  | 'initialising'
  | 'restoring'
  | 'signing-in'
  | 'authenticated'
  | 'unauthenticated';

/** Normalised, already-localised failure. Never a raw FirebaseError. */
export interface AuthError {
  /** Stable machine code — switch on this, never on `message`. */
  code: AuthErrorCode;
  /** Traditional Chinese, safe to render directly to the player. */
  message: string;
  /**
   * True when the cause is a Firebase Console / deployment misconfiguration
   * rather than anything the player did. These get an extra developer hint in
   * the console and must never be silently swallowed — swallowing exactly
   * this class of error is what made the original bug invisible.
   */
  isConfigurationError: boolean;
  /** The original error, for logging. */
  cause?: unknown;
}

export type AuthErrorCode =
  /** The player closed the popup / hit cancel. Not worth showing. */
  | 'cancelled'
  /** Browser blocked the popup; the manager retries via redirect. */
  | 'popup-blocked'
  /** This origin is not in Firebase Auth's authorised-domain list. */
  | 'unauthorized-domain'
  /** The provider is switched off in the Firebase Console. */
  | 'provider-disabled'
  /** Another account already owns this e-mail under a different provider. */
  | 'account-exists-with-different-credential'
  /** Tried to link a provider that is already attached to another account. */
  | 'credential-already-in-use'
  /** Network / offline. */
  | 'network'
  /** Provider is declared in the registry but not implemented yet. */
  | 'provider-not-implemented'
  /** Provider is not usable on this platform (e.g. Apple outside Apple/web). */
  | 'provider-unavailable'
  /** No signed-in user for an operation that requires one. */
  | 'no-current-user'
  | 'unknown';

/** What `AuthenticationManager.subscribe()` hands to listeners. */
export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** Last failure, cleared on the next successful attempt. */
  error: AuthError | null;
  /** Provider currently mid-sign-in, for per-button spinners. */
  pendingProviderId: AuthProviderId | null;
}
