/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 每日登入 — the browser's side of the API, and the only way the client is allowed to change
 * anything about the round.
 *
 * There is deliberately no Firestore write anywhere in this file. Everything else in the game saves
 * itself by writing `users/{uid}` directly; this one asks the server, because the two facts a daily
 * reward turns on — what day it is, and whether this day was already paid — are the two the browser
 * must not be the authority for. See src/server/dailyLoginApi.ts.
 *
 * What this file is responsible for is everything the network can do to a correct server:
 *
 *   - attaching a real identity (a Firebase ID token, refreshed by the SDK, never a uid we chose);
 *   - a stable idempotency key per attempt, so a retry after a lost response is recognised as the
 *     same attempt rather than as a second claim;
 *   - a timeout, because a request that never returns is indistinguishable from one that failed and
 *     the player is left looking at a spinner;
 *   - refusing to let an older response overwrite a newer one.
 */

import { getIdToken } from 'firebase/auth';
import { firebaseAuth } from './firebaseCore';

/** One square, exactly as the server describes it. Snake case: this is the wire shape, not ours. */
export interface DailyLoginRewardDto {
  day_index: number;
  reward_type: string;
  reward_id: string | null;
  quantity: number;
  state: 'future' | 'available' | 'claimed' | 'makeup_available' | 'missed';
  makeup_cost: number | null;
}

export interface DailyLoginStatusDto {
  server_now: string;
  timezone: string;
  anchor_date: string;
  cycle_id: string;
  cycle_number: number;
  cycle_start_at: string;
  cycle_end_at: string;
  current_day_index: number;
  /** 金幣 — what a 補簽 is paid out of. */
  coin_balance: number;
  /**
   * 碎片 — what the round pays.
   *
   * Optional so a client built after the currency split still parses a response from a server that
   * predates it. The panel reads the profile for the balance it displays anyway; this is here so a
   * caller can reconcile against the server's own view.
   */
  fragment_balance?: number;
  /** Which currency every `quantity` below is denominated in. Absent on a pre-split server. */
  reward_currency?: string;
  rewards: DailyLoginRewardDto[];
  /** Server-stamped, monotonic. See {@link isNewerThan}. */
  updated_at: number;
}

export interface ClaimResultDto {
  ok: true;
  replayed: boolean;
  /** How much was granted, in {@link DailyLoginStatusDto.reward_currency} (碎片 today). */
  granted_quantity: number;
  /** What the 補簽 cost, in 金幣. Named for its currency because the payout is no longer in it. */
  spent_gold: number;
  status: DailyLoginStatusDto;
}

export type DailyLoginErrorCode =
  | 'unauthenticated'
  | 'not_configured'
  | 'invalid_request'
  | 'no_profile'
  | 'not_available_yet'
  | 'already_claimed'
  | 'makeup_window_closed'
  | 'insufficient_gold'
  | 'server_error'
  /**
   * The local claim could not be saved.
   *
   * Distinct from `server_error` because no server is involved in it: this is the offline/
   * unconfigured path (context/useEconomyActions.ts, `claimOnProfile`) failing to write the save.
   * It used to report itself as `server_error`, which put 「伺服器忙碌中，請稍後再試」 on screen for
   * a failure that had nothing to do with a server and sent anyone debugging it looking at the API.
   */
  | 'save_failed'
  | 'offline'
  | 'timeout';

export class DailyLoginError extends Error {
  constructor(readonly code: DailyLoginErrorCode, message: string) {
    super(message);
  }
}

/**
 * What each failure says to the player.
 *
 * Held here rather than in the panel so the same wording is used wherever a claim can be started
 * from, and so a new server code cannot reach the screen as a raw identifier.
 */
export const DAILY_LOGIN_MESSAGES: Record<DailyLoginErrorCode, string> = {
  unauthenticated: '請先登入再領取獎勵',
  not_configured: '獎勵服務尚未設定完成，請稍後再試',
  invalid_request: '這個獎勵無法領取',
  no_profile: '找不到玩家資料',
  not_available_yet: '這一天還沒開放',
  already_claimed: '這一天已經領過了',
  makeup_window_closed: '這一輪已經結束，無法補簽',
  // Still 金幣: the only thing this feature charges for is a 補簽, and that is priced in 金幣 even
  // though the reward is 碎片. See constants/dailyLogin.ts's MAKEUP_SURCHARGE.
  insufficient_gold: '金幣不足',
  server_error: '伺服器忙碌中，請稍後再試',
  save_failed: '獎勵沒有存檔成功，請再試一次',
  offline: '目前離線，連上網路後再試一次',
  timeout: '連線逾時，請再試一次',
};

/** Long enough for a cold serverless start, short enough that a dead request is not a hang. */
const REQUEST_TIMEOUT_MS = 12_000;

async function authHeader(): Promise<Record<string, string>> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new DailyLoginError('unauthenticated', DAILY_LOGIN_MESSAGES.unauthenticated);
  // `false` — do not force a refresh. The SDK refreshes on its own schedule and a forced refresh on
  // every claim turns one tap into two round trips.
  const token = await getIdToken(user, false);
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new DailyLoginError('offline', DAILY_LOGIN_MESSAGES.offline);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(await authHeader()), ...(init?.headers ?? {}) },
    });
  } catch (error) {
    if (error instanceof DailyLoginError) throw error;
    // An aborted fetch and a dropped connection arrive the same way; the difference to the player is
    // whether trying again is likely to help, and for both it is.
    const code: DailyLoginErrorCode = controller.signal.aborted ? 'timeout' : 'offline';
    throw new DailyLoginError(code, DAILY_LOGIN_MESSAGES[code]);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let code: DailyLoginErrorCode = 'server_error';
    let message = DAILY_LOGIN_MESSAGES.server_error;
    try {
      const body = await response.json();
      if (body?.error?.code && body.error.code in DAILY_LOGIN_MESSAGES) {
        code = body.error.code as DailyLoginErrorCode;
        message = DAILY_LOGIN_MESSAGES[code];
      }
    } catch {
      // A non-JSON error body means nothing that speaks this API answered: the SPA fallback served
      // its index.html because the route is not mounted, or a proxy returned an HTML 502 because
      // the service is unreachable. That is `not_configured`, not `server_error`, and the
      // difference is load-bearing — the caller (context/useEconomyActions.ts) is allowed to fall
      // back to a local claim when the service is ABSENT, and must not when the service answered
      // and failed. A real 500 from this API carries a JSON body and keeps `server_error`.
      code = 'not_configured';
      message = DAILY_LOGIN_MESSAGES.not_configured;
    }
    throw new DailyLoginError(code, message);
  }

  return (await response.json()) as T;
}

export function fetchDailyLoginStatus(): Promise<DailyLoginStatusDto> {
  return request<DailyLoginStatusDto>('/api/daily-login/status');
}

/**
 * Takes one square.
 *
 * `idempotencyKey` must be STABLE for a given attempt and is the caller's to keep: generating it
 * here would make every retry a fresh attempt, which is the exact case it exists to defend. The
 * panel makes one per button press and reuses it if the request has to be retried.
 */
export function claimDailyLogin(
  dayIndex: number,
  mode: 'free' | 'makeup',
  idempotencyKey: string
): Promise<ClaimResultDto> {
  return request<ClaimResultDto>('/api/daily-login/claim', {
    method: 'POST',
    body: JSON.stringify({ day_index: dayIndex, mode, idempotency_key: idempotencyKey }),
  });
}

/** A fresh key for one user-initiated attempt. Reused verbatim by that attempt's retries. */
export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Whether `incoming` is safe to apply over `current`.
 *
 * Two requests in flight can land out of order — a status poll started before a claim can answer
 * after it, and applying it would put a claimed square back to `available` and show a stale
 * balance. Comparing the SERVER's stamp rather than arrival order is what makes that impossible.
 */
export function isNewerThan(incoming: DailyLoginStatusDto, current: DailyLoginStatusDto | null): boolean {
  return !current || incoming.updated_at >= current.updated_at;
}
