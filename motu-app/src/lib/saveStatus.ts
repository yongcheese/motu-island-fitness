/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The last save that did NOT land, in words the player can act on.
 *
 * ## Why this exists
 *
 * Every write in the game is a `try { await updateDoc(...) } catch { ... return
 * false }`, and the whole UI is built on that boolean: the island editor keeps
 * the draft alive when a commit returns false, the shop refuses to close, the
 * first-run Home guide keeps asking until `profile.home` actually exists. That
 * contract is sound — but a boolean cannot say *why*, so every failure looked
 * identical to the player, and the one message we did have ("請稍後再試")
 * described a network blip, which is the one cause it usually was not.
 *
 * The concrete case this was written for: the deployed Firestore ruleset did not
 * permit the `home` field, so establishing a Home was rejected server-side on
 * every single attempt. Nothing on screen said so. The write failed, the guide's
 * condition (`no home yet`) stayed true, and the tutorial asked again — forever.
 *
 * So the error code is captured here at the one place every write already funnels
 * through (`handleFirestoreError`), translated once, and read back by whichever
 * surface is closest to what the player just tried to do.
 *
 * Deliberately NOT React state and NOT part of AppContext: a save failure is not
 * game state, it must be writable from plain async functions with no hooks in
 * scope, and putting it on the context would re-render the entire world every
 * time a write hiccuped.
 */

export interface SaveFailure {
  /** Firestore's error code, e.g. `permission-denied`. `unknown` when it had none. */
  code: string;
  /** What to actually show a player. Complete sentence, zh-TW, no error jargon. */
  message: string;
  /** Document path the write was aimed at, for the console/report only. */
  path: string | null;
  /** `Date.now()` of the failure — lets a reader ignore a stale one. */
  at: number;
}

/**
 * Player-facing text per Firestore error code.
 *
 * Only codes with a *different course of action* get their own line. "Retry in a
 * moment" and "your account is not allowed to do this" are genuinely different
 * situations; `aborted` vs `cancelled` are not, and a wall of near-identical
 * strings is how error copy stops being read.
 */
const MESSAGE_BY_CODE: Record<string, string> = {
  'permission-denied': '伺服器拒絕了這次存檔，資料沒有保存。這通常是帳號權限或伺服器設定的問題，請聯絡管理員。',
  unauthenticated: '登入狀態已失效，請重新登入後再試一次。',
  unavailable: '目前連不上伺服器，資料沒有保存。請檢查網路連線後再試一次。',
  'deadline-exceeded': '連線逾時，資料沒有保存。請檢查網路連線後再試一次。',
  'not-found': '找不到你的存檔資料，請重新整理頁面後再試一次。',
  'resource-exhausted': '伺服器目前忙碌中，請稍後再試一次。',
  /**
   * The client built a value Firestore cannot store — an `undefined` field being by far the most
   * common cause, since the SDK rejects those SYNCHRONOUSLY, before anything is sent.
   *
   * It earns its own line because the course of action is the opposite of the fallback's. Nothing
   * about the server, the network or the security rules is involved, so retrying is the one thing
   * guaranteed not to help — and 「請稍後再試」 is exactly what sends someone off to do it. This was
   * added after an optional field written as `{ x: undefined }` made a whole feature fail on every
   * single write while showing the generic "try again later" line (see constants/islandReturn.ts's
   * makePetState).
   */
  'invalid-argument': '這次存檔的內容有格式問題，資料沒有保存。重試不會有幫助，請回報給開發者。',
  // Offline saves (save/LocalSaveStore.ts). A different course of action from every code above it:
  // no amount of retrying frees space in localStorage, and signing in moves the save to the cloud.
  'local-storage-full': '這個裝置的本機儲存空間已滿，資料沒有保存。請登入帳號改用雲端存檔，或清理瀏覽器資料後再試一次。',
};

const FALLBACK_MESSAGE = '存檔失敗，資料沒有保存，請稍後再試一次。';

/**
 * Pulls the code out of whatever the SDK threw.
 *
 * `FirebaseError` carries a `code`; the local save store and a plain network
 * failure throw ordinary `Error`s. Both arrive here, so this never assumes a
 * shape it hasn't checked.
 */
export function describeSaveError(error: unknown): { code: string; message: string } {
  const raw =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  // Firestore prefixes some codes with the service name ("firestore/unavailable").
  const code = (raw.includes('/') ? raw.slice(raw.indexOf('/') + 1) : raw) || 'unknown';
  return { code, message: MESSAGE_BY_CODE[code] ?? FALLBACK_MESSAGE };
}

let last: SaveFailure | null = null;
const listeners = new Set<() => void>();

export function recordSaveFailure(error: unknown, path: string | null): SaveFailure {
  const { code, message } = describeSaveError(error);
  last = { code, message, path, at: Date.now() };
  listeners.forEach((listener) => listener());
  return last;
}

/** The most recent failure, or null if every write so far has landed. */
export function getLastSaveFailure(): SaveFailure | null {
  return last;
}

/**
 * The message to show for an action that just reported failure.
 *
 * Takes the *specific* reason when one was recorded in the last few seconds, and
 * falls back to the generic line otherwise — a failure recorded ten minutes ago
 * by an unrelated write must not be used to explain this one.
 */
export function describeRecentFailure(withinMs = 5000): string {
  if (!last || Date.now() - last.at > withinMs) return FALLBACK_MESSAGE;
  return last.message;
}

export function subscribeSaveFailures(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
