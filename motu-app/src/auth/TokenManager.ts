/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { User } from 'firebase/auth';
import { firebaseAuth } from '../lib/firebaseCore';

/**
 * Session/ID token access for anything that needs to prove who the player is to
 * a server — today that is `server.ts`, tomorrow it is the custom-token
 * exchange that Discord/Steam sign-in will need (see `providers/registry.ts`).
 *
 * Firebase already refreshes ID tokens on its own roughly every hour and
 * persists the refresh token in IndexedDB, so this is deliberately thin: its
 * job is to be the single, documented place that knows that, so nobody
 * hand-rolls a token cache next to it. The original code had no token handling
 * at all, which is why "Refresh Token 是否失效" had no answer to look up.
 */
export class TokenManager {
  /** Cheap in-flight de-duplication: parallel callers share one refresh. */
  private inFlight: Promise<string | null> | null = null;

  private get user(): User | null {
    return firebaseAuth.currentUser;
  }

  /**
   * A valid Firebase ID token, or null for local-only guests (who have no
   * server-verifiable identity at all — callers must treat null as
   * "unauthenticated", never as "retry later").
   *
   * Firebase returns a cached token until ~5 minutes before expiry and
   * transparently uses the refresh token after that, so calling this on every
   * request is correct and cheap.
   */
  async getIdToken(forceRefresh = false): Promise<string | null> {
    const user = this.user;
    if (!user) return null;

    if (!forceRefresh && this.inFlight) return this.inFlight;

    const request = user
      .getIdToken(forceRefresh)
      .catch((error) => {
        // A refresh token is only rejected when the account was disabled or
        // deleted, or the password changed elsewhere. Firebase signs the user
        // out for us; surfacing null lets callers fall back to the sign-in
        // screen instead of retrying a token that will never mint again.
        console.warn('[auth] ID token refresh failed; session is no longer valid.', error);
        return null;
      })
      .finally(() => {
        this.inFlight = null;
      });

    this.inFlight = request;
    return request;
  }

  /** Forces a refresh — use after changing custom claims server-side. */
  refresh(): Promise<string | null> {
    return this.getIdToken(true);
  }

  /** Custom claims on the current token (roles, entitlements). `{}` if none. */
  async getClaims(): Promise<Record<string, unknown>> {
    const user = this.user;
    if (!user) return {};
    try {
      const result = await user.getIdTokenResult();
      return result.claims as Record<string, unknown>;
    } catch (error) {
      console.warn('[auth] Could not read token claims.', error);
      return {};
    }
  }

  /** `Authorization` header for calls to our own backend, or `{}` when guest. */
  async authHeader(): Promise<Record<string, string>> {
    const token = await this.getIdToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
}

export const tokenManager = new TokenManager();
