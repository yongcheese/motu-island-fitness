/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AuthProvider } from 'firebase/auth';
import type { AuthProviderId, AuthStrategy, OAuthFlow } from '../types';

/**
 * A brand mark, expressed as raw SVG path data so the registry can carry it.
 *
 * Icons live in the registry rather than in a `switch` inside the sign-in
 * screen on purpose: the requirement is that adding Discord or Steam later
 * touches one descriptor and nothing else. A component-level icon map would
 * quietly reintroduce "login logic scattered across UI components".
 */
export interface BrandMark {
  /** viewBox of the supplied paths, e.g. `'0 0 24 24'`. */
  viewBox: string;
  paths: { d: string; fill?: string }[];
}

/**
 * Everything the system needs to know about one sign-in method.
 *
 * `AuthenticationManager` branches on {@link AuthStrategy}, never on
 * {@link AuthProviderId} — so a new provider that reuses an existing strategy
 * needs no manager changes at all.
 */
export interface ProviderDescriptor {
  id: AuthProviderId;
  /** Button text, e.g. 「使用 Google 登入」. */
  label: string;
  /** Bare brand name for sentences and badges, e.g. 「Google」. */
  shortLabel: string;
  /**
   * `ready`   — implemented and offered to players.
   * `planned` — declared so the architecture, types and UI already account for
   *             it; rendered as a disabled 「即將推出」 entry. Promoting one to
   *             `ready` is the whole job of adding that provider.
   */
  status: 'ready' | 'planned';
  strategy: AuthStrategy;
  /** Whether this provider can be linked onto an existing account later. */
  linkable: boolean;
  /** Sort order on the sign-in screen; lower is higher up. */
  order: number;
  mark: BrandMark;
  /** Visual weight of the button. Exactly one provider should be `primary`. */
  emphasis: 'primary' | 'secondary';
  /**
   * Platform gate. Absent means "always offered". Evaluated at render time, so
   * it may read `navigator`.
   */
  isAvailable?: () => boolean;
  /**
   * Builds the Firebase provider object. Required for `firebase-oauth`,
   * unused by the other strategies.
   */
  createFirebaseProvider?: () => AuthProvider;
  /**
   * Preferred OAuth flow. Popup is nicer on desktop; redirect is the only
   * reliable option inside embedded webviews and with third-party cookies
   * blocked. The manager falls back popup → redirect automatically, so this is
   * only the starting preference.
   */
  preferredFlow?: OAuthFlow;
  /**
   * For `custom-token` providers only: the backend route that exchanges the
   * third-party login for a Firebase custom token. See docs/AUTH_SETUP.md.
   */
  customTokenEndpoint?: string;
}
