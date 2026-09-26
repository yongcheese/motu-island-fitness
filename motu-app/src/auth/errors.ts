/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AuthError, AuthErrorCode, AuthProviderId } from './types';

/**
 * Turns anything thrown by Firebase Auth into an {@link AuthError} the UI can
 * render and the manager can branch on.
 *
 * This module exists because of the specific way the original login broke: the
 * only sign-in call in the app was `onClick={() => signInWithGoogle()}` with no
 * `.catch()`, so `auth/unauthorized-domain` — a one-line Firebase Console fix —
 * surfaced to the player as a button that simply did nothing, and the only
 * remaining path was Guest. Every failure now ends up here, gets a message, and
 * is reported.
 */

const PROVIDER_LABELS: Record<AuthProviderId, string> = {
  google: 'Google',
  apple: 'Apple',
  guest: '訪客',
  discord: 'Discord',
  steam: 'Steam',
  facebook: 'Facebook',
  microsoft: 'Microsoft',
  github: 'GitHub',
  password: '電子郵件',
};

export function providerLabel(id: AuthProviderId): string {
  return PROVIDER_LABELS[id] ?? id;
}

/** Firebase error code → our code. Anything unlisted becomes `unknown`. */
const CODE_MAP: Record<string, AuthErrorCode> = {
  'auth/popup-closed-by-user': 'cancelled',
  'auth/cancelled-popup-request': 'cancelled',
  'auth/user-cancelled': 'cancelled',
  'auth/popup-blocked': 'popup-blocked',
  'auth/unauthorized-domain': 'unauthorized-domain',
  'auth/operation-not-allowed': 'provider-disabled',
  'auth/admin-restricted-operation': 'provider-disabled',
  'auth/account-exists-with-different-credential': 'account-exists-with-different-credential',
  'auth/credential-already-in-use': 'credential-already-in-use',
  'auth/email-already-in-use': 'credential-already-in-use',
  'auth/provider-already-linked': 'credential-already-in-use',
  'auth/network-request-failed': 'network',
  'auth/timeout': 'network',
  'auth/no-current-user': 'no-current-user',
};

/** Codes that mean "a human has to change a setting", not "the player erred". */
const CONFIGURATION_ERRORS: ReadonlySet<AuthErrorCode> = new Set<AuthErrorCode>([
  'unauthorized-domain',
  'provider-disabled',
]);

function messageFor(code: AuthErrorCode, provider: AuthProviderId): string {
  const name = providerLabel(provider);
  switch (code) {
    case 'cancelled':
      return '已取消登入。';
    case 'popup-blocked':
      return '瀏覽器封鎖了登入視窗，正在改用轉址方式登入…';
    case 'unauthorized-domain':
      return `目前網域尚未加入 Firebase 授權清單，${name} 登入無法啟動。請參考 docs/AUTH_SETUP.md。`;
    case 'provider-disabled':
      return `${name} 登入尚未在 Firebase 主控台啟用。請參考 docs/AUTH_SETUP.md。`;
    case 'account-exists-with-different-credential':
      return `這個電子郵件已用其他登入方式註冊過。請先用原本的方式登入，再於「帳號資訊」綁定 ${name}。`;
    case 'credential-already-in-use':
      return `這個 ${name} 帳號已經綁定到另一個島嶼存檔了。`;
    case 'network':
      return '網路連線失敗，請確認連線後再試一次。';
    case 'provider-not-implemented':
      return `${name} 登入尚未開放，敬請期待。`;
    case 'provider-unavailable':
      return `目前的裝置或瀏覽器不支援 ${name} 登入。`;
    case 'no-current-user':
      return '目前沒有登入中的帳號。';
    default:
      return `${name} 登入失敗，請稍後再試一次。`;
  }
}

/** Reads a Firebase-style `code` off an unknown throwable. */
function rawCodeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

export function normalizeAuthError(error: unknown, provider: AuthProviderId): AuthError {
  const code = CODE_MAP[rawCodeOf(error)] ?? 'unknown';
  return buildAuthError(code, provider, error);
}

export function buildAuthError(
  code: AuthErrorCode,
  provider: AuthProviderId,
  cause?: unknown,
): AuthError {
  const isConfigurationError = CONFIGURATION_ERRORS.has(code);
  const authError: AuthError = {
    code,
    message: messageFor(code, provider),
    isConfigurationError,
    cause,
  };
  if (isConfigurationError) logConfigurationHint(code, provider);
  return authError;
}

/**
 * Prints the exact console fix for the two misconfigurations that silently
 * disabled every non-guest login in this project. Kept next to the error rather
 * than in a doc-only file because the person who sees the failure is the person
 * who needs the instruction.
 */
function logConfigurationHint(code: AuthErrorCode, provider: AuthProviderId): void {
  const header = `[auth] ${providerLabel(provider)} 登入被 Firebase 設定擋下 (${code})`;
  if (code === 'unauthorized-domain') {
    console.error(
      `${header}\n` +
        `目前來源: ${window.location.origin}\n` +
        `修正方式: Firebase Console → Authentication → Settings → Authorized domains，` +
        `加入 "${window.location.hostname}"。\n` +
        `詳見 docs/AUTH_SETUP.md`,
    );
    return;
  }
  console.error(
    `${header}\n` +
      `修正方式: Firebase Console → Authentication → Sign-in method，` +
      `啟用「${providerLabel(provider)}」。\n` +
      `詳見 docs/AUTH_SETUP.md`,
  );
}
