/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleAuthProvider, OAuthProvider, FacebookAuthProvider, GithubAuthProvider } from 'firebase/auth';
import type { AuthProviderId } from '../types';
import type { ProviderDescriptor } from './types';
import {
  APPLE_MARK,
  DISCORD_MARK,
  EMAIL_MARK,
  FACEBOOK_MARK,
  GITHUB_MARK,
  GOOGLE_MARK,
  GUEST_MARK,
  MICROSOFT_MARK,
  STEAM_MARK,
} from './marks';

/**
 * THE list of sign-in methods. This file is the extension point: adding a
 * provider means adding (or promoting) one entry here.
 *
 * Nothing downstream enumerates providers by hand — the sign-in screen renders
 * `listSignInProviders()`, the account panel renders `listLinkableProviders()`,
 * and AuthenticationManager dispatches on `strategy`. That is the whole reason
 * the "future providers" below are declared rather than merely commented about:
 * the UI and the types already handle them, so promoting Discord to `ready` is
 * a one-line status change plus its token endpoint.
 */

/** True on iOS/iPadOS/macOS, where Apple sign-in is the expected default. */
function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Macintosh, hence the touch-point check.
  const isIpadOs = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || isIpadOs || /Mac OS X/.test(ua);
}

const DESCRIPTORS: Record<AuthProviderId, ProviderDescriptor> = {
  google: {
    id: 'google',
    label: '使用 Google 登入',
    shortLabel: 'Google',
    status: 'ready',
    strategy: 'firebase-oauth',
    linkable: true,
    order: 10,
    mark: GOOGLE_MARK,
    emphasis: 'secondary',
    preferredFlow: 'popup',
    createFirebaseProvider: () => {
      const provider = new GoogleAuthProvider();
      // Always show the chooser. Without this, a player who signed out to swap
      // accounts is silently put straight back into the one they just left.
      provider.setCustomParameters({ prompt: 'select_account' });
      return provider;
    },
  },

  apple: {
    id: 'apple',
    label: '使用 Apple 登入',
    shortLabel: 'Apple',
    status: 'ready',
    strategy: 'firebase-oauth',
    linkable: true,
    // Ranked above Google on Apple hardware, below it everywhere else — App
    // Store review expects Sign in with Apple to be at least as prominent as
    // other third-party options on iOS.
    order: isApplePlatform() ? 5 : 20,
    mark: APPLE_MARK,
    emphasis: 'secondary',
    // Apple's web flow is a full-page form; popups get blocked far more often
    // than with Google, and it is what Apple's own guidance assumes.
    preferredFlow: 'redirect',
    createFirebaseProvider: () => {
      const provider = new OAuthProvider('apple.com');
      provider.addScope('email');
      provider.addScope('name');
      // Apple returns the display name only on the very first authorisation,
      // so the profile write on first sign-in is the only chance to capture it.
      provider.setCustomParameters({ locale: 'zh_TW' });
      return provider;
    },
  },

  guest: {
    id: 'guest',
    label: '以訪客身分開始',
    shortLabel: '訪客',
    status: 'ready',
    strategy: 'firebase-anonymous',
    // A Firebase anonymous account upgrades in place: linking Google onto it
    // keeps the SAME uid, so the island carries over with no data migration.
    linkable: true,
    order: 100,
    mark: GUEST_MARK,
    emphasis: 'primary',
  },

  // --- Declared for the future -------------------------------------------
  // Each of these is already rendered (disabled, 「即將推出」) and already has a
  // strategy, so wiring one up is: flip `status`, supply the missing field.

  discord: {
    id: 'discord',
    label: '使用 Discord 登入',
    shortLabel: 'Discord',
    status: 'planned',
    // Firebase has no native Discord IdP. The backend completes Discord's
    // OAuth2 code exchange, verifies the profile, then mints a Firebase custom
    // token with the Admin SDK. See docs/AUTH_SETUP.md.
    strategy: 'custom-token',
    customTokenEndpoint: '/api/auth/discord',
    linkable: true,
    order: 30,
    mark: DISCORD_MARK,
    emphasis: 'secondary',
  },

  steam: {
    id: 'steam',
    label: '使用 Steam 登入',
    shortLabel: 'Steam',
    status: 'planned',
    // Steam speaks OpenID 2.0, which Firebase cannot consume directly either.
    strategy: 'custom-token',
    customTokenEndpoint: '/api/auth/steam',
    linkable: true,
    order: 40,
    mark: STEAM_MARK,
    emphasis: 'secondary',
  },

  facebook: {
    id: 'facebook',
    label: '使用 Facebook 登入',
    shortLabel: 'Facebook',
    status: 'planned',
    strategy: 'firebase-oauth',
    linkable: true,
    order: 50,
    mark: FACEBOOK_MARK,
    emphasis: 'secondary',
    preferredFlow: 'popup',
    createFirebaseProvider: () => new FacebookAuthProvider(),
  },

  microsoft: {
    id: 'microsoft',
    label: '使用 Microsoft 登入',
    shortLabel: 'Microsoft',
    status: 'planned',
    strategy: 'firebase-oauth',
    linkable: true,
    order: 60,
    mark: MICROSOFT_MARK,
    emphasis: 'secondary',
    preferredFlow: 'popup',
    createFirebaseProvider: () => new OAuthProvider('microsoft.com'),
  },

  github: {
    id: 'github',
    label: '使用 GitHub 登入',
    shortLabel: 'GitHub',
    status: 'planned',
    strategy: 'firebase-oauth',
    linkable: true,
    order: 70,
    mark: GITHUB_MARK,
    emphasis: 'secondary',
    preferredFlow: 'popup',
    createFirebaseProvider: () => new GithubAuthProvider(),
  },

  password: {
    id: 'password',
    label: '使用電子郵件登入',
    shortLabel: '電子郵件',
    status: 'planned',
    strategy: 'firebase-password',
    linkable: true,
    order: 80,
    mark: EMAIL_MARK,
    emphasis: 'secondary',
  },
};

/**
 * Maps a Firebase `providerData[].providerId` back onto our ids, so
 * `AuthUser.linkedProviders` is expressed in the same vocabulary as everything
 * else.
 */
const FIREBASE_PROVIDER_IDS: Record<string, AuthProviderId> = {
  'google.com': 'google',
  'apple.com': 'apple',
  'facebook.com': 'facebook',
  'microsoft.com': 'microsoft',
  'github.com': 'github',
  password: 'password',
};

export function fromFirebaseProviderId(firebaseId: string): AuthProviderId | null {
  return FIREBASE_PROVIDER_IDS[firebaseId] ?? null;
}

export function getProvider(id: AuthProviderId): ProviderDescriptor {
  return DESCRIPTORS[id];
}

export function allProviders(): ProviderDescriptor[] {
  return Object.values(DESCRIPTORS).sort((a, b) => a.order - b.order);
}

/** Is this provider offered on this device right now? */
export function isProviderAvailable(descriptor: ProviderDescriptor): boolean {
  return descriptor.isAvailable ? descriptor.isAvailable() : true;
}

/**
 * What the sign-in screen shows: every available provider, `ready` ones first
 * in `order`, with `planned` ones following as disabled entries.
 */
export function listSignInProviders(): ProviderDescriptor[] {
  return allProviders().filter(isProviderAvailable);
}

/**
 * What the account panel offers a signed-in player to bind onto their account.
 * Guest is excluded — you cannot link anonymity onto an account, that flow runs
 * the other way (see `AuthenticationManager.linkProvider`).
 */
export function listLinkableProviders(alreadyLinked: AuthProviderId[]): ProviderDescriptor[] {
  return allProviders().filter(
    (descriptor) =>
      descriptor.linkable &&
      descriptor.id !== 'guest' &&
      isProviderAvailable(descriptor) &&
      !alreadyLinked.includes(descriptor.id),
  );
}
