/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { authManager } from './AuthenticationManager';
import { listLinkableProviders, listSignInProviders } from './providers/registry';
import type { AuthProviderId, AuthState } from './types';

/**
 * React binding for {@link authManager}.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`, because the
 * manager can settle its state *before* React mounts (session restore is
 * synchronous once Firebase's persistence has loaded). The effect-based pattern
 * the app used previously drops that first transition, which is one of the ways
 * a successful login could still leave the sign-in screen up — the brief's
 * 「是否因 React State、Router 或 Lifecycle 導致登入狀態遺失」.
 */
export function useAuthState(): AuthState {
  return useSyncExternalStore(
    (onStoreChange) => authManager.subscribe(onStoreChange),
    () => authManager.getState(),
    () => authManager.getState(),
  );
}

export function useAuth() {
  const state = useAuthState();

  const signIn = useCallback((providerId: AuthProviderId) => authManager.signIn(providerId), []);
  const linkProvider = useCallback(
    (providerId: AuthProviderId) => authManager.linkProvider(providerId),
    [],
  );
  const signOut = useCallback(() => authManager.signOut(), []);
  const clearError = useCallback(() => authManager.clearError(), []);

  /** Providers to offer on the sign-in screen, already ordered and filtered. */
  const signInProviders = useMemo(() => listSignInProviders(), []);

  /** Providers the current player could still bind to their account. */
  const linkableProviders = useMemo(
    () => listLinkableProviders(state.user?.linkedProviders ?? []),
    [state.user?.linkedProviders],
  );

  return {
    ...state,
    signInProviders,
    linkableProviders,
    lastProviderId: authManager.session.getLastProvider(),
    signIn,
    linkProvider,
    signOut,
    clearError,
  };
}
