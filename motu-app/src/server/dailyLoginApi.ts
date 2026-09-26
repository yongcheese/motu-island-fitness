/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 每日登入 — the server half, and the ONLY thing in this game that is allowed to decide whether a
 * reward is owed.
 *
 * ## Why this file exists at all
 *
 * Everything else in this app writes its own save: the browser holds a Firestore handle and updates
 * `users/{uid}` directly, with `firestore.rules` as the only gate. That is fine for where a sofa is
 * standing. It is not fine for currency that is minted by the passage of time, because the two
 * things the client would have to be trusted with — WHAT DAY IT IS and WHETHER THIS DAY WAS ALREADY
 * PAID — are exactly the two a player can change (system clock) or race (two tabs, two devices, a
 * retried request). So this endpoint owns both:
 *
 *   - The clock is the SERVER's, read once per request and converted to a 台北 calendar day. The
 *     request body cannot carry a date, and nothing in it is consulted for one.
 *   - Eligibility is recomputed from (anchor, server now, claim records) on every call. There is no
 *     cached cycle state to go stale, so a scheduled job that never runs cannot corrupt anything —
 *     there is no scheduled job.
 *
 * ## What guarantees a reward is paid exactly once
 *
 * Firestore has no UNIQUE constraint, but it has something stronger for this shape: a document
 * either exists or it does not, and `create` fails if it does. So the spec's
 * `UNIQUE(user_id, cycle_id, day_index, reward_type)` is expressed as the claim document's own PATH:
 *
 *     users/{uid}/daily_login_claims/{cycleId}__{dayIndex}__{rewardType}
 *
 * The id is DERIVED, never random, so two requests for the same day are two attempts to create the
 * same document — from one tab, from ten tabs, from a phone and a laptop at once, or from a client
 * retrying because it never saw the first response. The write happens inside a Firestore
 * transaction that also reads the wallet, so the balance change and the claim record commit or
 * roll back together; a transaction whose read set changed underneath it is retried by the SDK and
 * then fails the existence check, which is how the concurrent case collapses to exactly one winner.
 *
 * `idempotencyKey` from the client is recorded but is NOT the uniqueness mechanism — it is how a
 * retry is told apart from a genuine double-claim. Same key on an existing claim means "you already
 * did this, here is the result you missed"; a different key means "that day is taken".
 *
 * ## What is deliberately NOT here
 *
 * No currency is invented and no wallet layout is decided. The fields this transaction touches come
 * from `constants/currency.ts` (`currencyFieldPath`), the same module the browser reads, so 「碎片
 * 存在哪裡」 has one answer on both sides of the wire.
 *
 * ## It pays 金幣, and it is no longer the whole prize (2026-09-17)
 *
 * The round pays seven different KINDS of thing now (constants/dailyLogin.ts): 商品碎片, 金幣,
 * 抽獎券, a 功能卡, a whole product, and on 第 7 天 a free turn of the 幸運轉盤. Exactly one of
 * those moves a wallet, and it is the only one this endpoint touches — 15 金幣 on four of the seven
 * days, netted against the 補簽 fee inside the same transaction that creates the claim record.
 *
 * Everything else is granted by the CLIENT, after this endpoint has accepted the claim as new
 * (context/useDailyLoginPrize.ts). That is not a weakening of the guarantee this file exists for:
 * what a browser must not be trusted with is WHAT DAY IT IS and WHETHER THIS DAY WAS ALREADY PAID,
 * and both of those are still decided here. A fragment stack and a card bag have no wallet to
 * protect, and teaching this endpoint to read a catalog of a few hundred items — plus a rarity
 * table, plus the reward pools — to hand one out would buy nothing but a schema migration.
 *
 * Between 2026-08-25 and 2026-09-17 the payout was the wallet's 碎片 and the fee was 金幣, so the
 * transaction moved two fields. It moves one now, which is why the increment below is netted where
 * it used to be deliberately split.
 */

import type { Express, NextFunction, Request, Response } from 'express';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type Firestore, type Transaction } from 'firebase-admin/firestore';

import {
  CYCLE_LENGTH,
  DAILY_LOGIN_CURRENCY,
  DAILY_LOGIN_TZ,
  buildSquares,
  canClaim,
  civilDateAt,
  dailyPrizeFor,
  dailyPrizeHeadline,
  makeupCostForDay,
  resolveCycle,
  type CivilDate,
} from '../constants/dailyLogin';
import { currencyFieldPath } from '../constants/currency';

/**
 * Where the balance this endpoint moves lives, resolved once from the shared currency table.
 *
 * Read through `currencyFieldPath` rather than written as a string literal, so the server cannot
 * drift from the client about which document field a balance is in — a mismatch there would pay a
 * reward into a field nothing reads, with no error anywhere.
 */
const COIN_FIELD = currencyFieldPath(DAILY_LOGIN_CURRENCY);

/**
 * The rules module above is shared VERBATIM with the browser, and that is on purpose: the panel has
 * to be able to grey out a button for the same reason the server refuses the write, and two copies
 * of "which day is this" would drift the first time the ladder is retuned. The client's copy is an
 * optimistic preview; this one is the verdict. They agree because they are the same file.
 */

// --- Firestore admin ---------------------------------------------------------

/**
 * The named database this project actually uses.
 *
 * NOT `(default)`. firebase.json points the rules at a named database, and an Admin SDK handle
 * opened without this id talks to an empty default database instead — silently, with reads simply
 * returning nothing, which reads as "the player has no profile" rather than as a misconfiguration.
 * Overridable so a staging project can point elsewhere.
 */
const DATABASE_ID = process.env.FIREBASE_DATABASE_ID ?? 'ai-studio-07ffb391-da53-4ca6-99c4-9c12d59da230';

let cachedDb: Firestore | null = null;
let initError: string | null = null;

/**
 * Credentials come from the environment, never from the repo.
 *
 * Two accepted shapes, because the two deployment styles in use want different things:
 * `FIREBASE_SERVICE_ACCOUNT` as inline JSON (one env var, which is what a container platform wants)
 * or `GOOGLE_APPLICATION_CREDENTIALS` pointing at a file (which is what the gcloud tooling sets up,
 * and what Application Default Credentials picks up on its own).
 */
function initAdmin(): App | null {
  const existing = getApps();
  if (existing.length > 0) return existing[0];

  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  try {
    if (inline) {
      const parsed = JSON.parse(inline);
      return initializeApp({ credential: cert(parsed), projectId: parsed.project_id });
    }
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      // Application Default Credentials: initializeApp() with no argument finds them.
      return initializeApp();
    }
  } catch (error) {
    initError = `daily-login: service account could not be loaded — ${(error as Error).message}`;
    return null;
  }
  initError =
    'daily-login: no server credentials. Set FIREBASE_SERVICE_ACCOUNT (inline JSON) or ' +
    'GOOGLE_APPLICATION_CREDENTIALS (path to the key file). See docs/daily-login.md.';
  return null;
}

function getDb(): Firestore | null {
  if (cachedDb) return cachedDb;
  const app = initAdmin();
  if (!app) return null;
  cachedDb = getFirestore(app, DATABASE_ID);
  return cachedDb;
}

// --- Errors ------------------------------------------------------------------

/**
 * The error codes the client is allowed to branch on.
 *
 * A closed set with stable names, because the panel has a specific message and a specific recovery
 * for each one (see components/UI/DailyLoginPanel.tsx). Anything unexpected becomes `server_error`
 * rather than leaking a Firestore message to a player.
 */
export type DailyLoginErrorCode =
  | 'unauthenticated'
  | 'not_configured'
  | 'invalid_request'
  | 'no_profile'
  | 'not_available_yet'
  | 'already_claimed'
  | 'makeup_window_closed'
  | 'insufficient_gold'
  | 'server_error';

class ClaimError extends Error {
  constructor(readonly code: DailyLoginErrorCode, readonly status: number, message: string) {
    super(message);
  }
}

// --- Auth --------------------------------------------------------------------

interface AuthedRequest extends Request {
  uid?: string;
}

/**
 * Identity comes from a verified Firebase ID token and nothing else.
 *
 * Explicitly NOT from a `user_id` in the body or a query string, which is the single most important
 * line in this file: with the uid taken from the request, any signed-in player could mint gold into
 * any other account by editing one field.
 */
async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const app = initAdmin();
  if (!app) {
    res.status(503).json({ error: { code: 'not_configured', message: initError } });
    return;
  }
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: { code: 'unauthenticated', message: '請先登入' } });
    return;
  }
  try {
    const decoded = await getAuth(app).verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch {
    res.status(401).json({ error: { code: 'unauthenticated', message: '登入憑證已失效，請重新登入' } });
  }
}

// --- Paths -------------------------------------------------------------------

const userDoc = (db: Firestore, uid: string) => db.collection('users').doc(uid);

/**
 * The claim record's id — and therefore the uniqueness constraint. See the file header.
 *
 * `rewardType` is in the key because the day a cycle hands out a pet AND currency on the same
 * square, those are two grants that must be independently recorded and independently idempotent.
 * Leaving it out would make that a schema migration.
 *
 * It is now the PRIZE's kind (`coins`, `item-fragments`, `free-spin`…), which is a pure function of
 * the round and the day, so two attempts at one square always name the same document. Note what
 * that means across a change to the prize table: a claim paid under the old ladder is filed under
 * `…__fragments` and one paid under the new table may be filed under `…__coins`, so the same day of
 * the same cycle could in principle be claimed once under each. That window is a single cycle wide
 * and closes on its own (a cycle is seven days, and `readState` only ever reads the CURRENT cycle's
 * claims); the alternative — reusing an old key for a different reward — would file two different
 * payouts under one id and make the audit trail lie about what was paid.
 */
function claimId(cycleId: string, day: number, rewardType: string): string {
  return `${cycleId}__d${day}__${rewardType}`;
}

const claimDoc = (db: Firestore, uid: string, id: string) =>
  userDoc(db, uid).collection('daily_login_claims').doc(id);

const auditCol = (db: Firestore, uid: string) => userDoc(db, uid).collection('daily_login_audit');

// --- Shared read -------------------------------------------------------------

interface ProfileShape {
  balanceGold?: number;
  /** The non-coin half of the wallet — see constants/currency.ts. */
  wallet?: { fragments?: number };
  dailyLoginAnchor?: CivilDate;
}

/** A balance as a whole non-negative number, whatever the document actually holds. */
const sane = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/**
 * Both balances off a profile document.
 *
 * Every absence reads as 0, which is correct for all three ways it happens: a brand-new player, a
 * save written before 碎片 existed, and a document whose field somehow holds a non-number.
 */
const walletOf = (profile: ProfileShape): { coins: number; fragments: number } => ({
  coins: sane(profile.balanceGold),
  fragments: sane(profile.wallet?.fragments),
});

interface ClaimRecord {
  cycleId: string;
  dayIndex: number;
  rewardType: string;
  rewardId: string | null;
  quantity: number;
  mode: 'free' | 'makeup';
  /** What the player PAID, in 金幣. Named for the currency it is in, because the payout no longer is. */
  costGold: number;
  idempotencyKey: string | null;
}

/**
 * Reads everything a status response needs, inside whatever transaction the caller is running (or
 * outside one, for a plain read).
 *
 * The anchor is READ here and written by the caller if missing — a first-ever visit establishes
 * Day 1 as the server's today, which is what makes "第一次進入以當天為 Day 1" true without the
 * client ever proposing a date.
 */
async function readState(
  db: Firestore,
  uid: string,
  now: Date,
  tx?: Transaction
): Promise<{
  profile: ProfileShape;
  anchor: CivilDate;
  anchorWasMissing: boolean;
  cycle: ReturnType<typeof resolveCycle>;
  claimedDays: Set<number>;
  claims: Record<string, ClaimRecord>;
}> {
  const ref = userDoc(db, uid);
  const snap = tx ? await tx.get(ref) : await ref.get();
  if (!snap.exists) {
    throw new ClaimError('no_profile', 404, '找不到玩家資料');
  }
  const profile = (snap.data() ?? {}) as ProfileShape;

  const today = civilDateAt(now);
  const anchorWasMissing = !profile.dailyLoginAnchor;
  const anchor = profile.dailyLoginAnchor ?? today;
  const cycle = resolveCycle(anchor, now);

  // Only THIS cycle's claims are needed to decide anything; older ones are history and are left
  // where they are. A range query on the id prefix keeps the read one collection scan of at most
  // seven documents rather than the player's whole claim history.
  const col = userDoc(db, uid).collection('daily_login_claims');
  const q = col.where('cycleId', '==', cycle.cycleId);
  const claimSnap = tx ? await tx.get(q) : await q.get();

  const claimedDays = new Set<number>();
  const claims: Record<string, ClaimRecord> = {};
  claimSnap.forEach((d) => {
    const rec = d.data() as ClaimRecord;
    claimedDays.add(rec.dayIndex);
    claims[d.id] = rec;
  });

  return { profile, anchor, anchorWasMissing, cycle, claimedDays, claims };
}

/** The response shape both endpoints return, so the client has one thing to parse. */
function buildStatusPayload(
  now: Date,
  anchor: CivilDate,
  cycle: ReturnType<typeof resolveCycle>,
  claimedDays: Set<number>,
  balances: { coins: number; fragments: number }
) {
  const squares = buildSquares(cycle, claimedDays, true);
  return {
    server_now: now.toISOString(),
    timezone: DAILY_LOGIN_TZ,
    anchor_date: anchor,
    cycle_id: cycle.cycleId,
    cycle_number: cycle.cycleNumber,
    cycle_start_at: cycle.startDate,
    cycle_end_at: cycle.endDate,
    current_day_index: cycle.currentDayIndex,
    /** 金幣 — what a 補簽 is paid out of. Kept under its original name so no client breaks. */
    coin_balance: balances.coins,
    /** 碎片 — the wallet currency. No day of the round pays it any more; reported for reconciliation. */
    fragment_balance: balances.fragments,
    /**
     * Which currency a MONEY square's `quantity` is denominated in. Squares that pay no money
     * (`reward_type` of `item-fragments`, `utility-card`, `raffle-ticket`, `item`, `free-spin`)
     * carry a count of that thing instead — see constants/dailyLogin.ts's `dailyPrizeHeadline`.
     */
    reward_currency: DAILY_LOGIN_CURRENCY,
    rewards: squares.map((s) => ({
      day_index: s.day,
      reward_type: s.rewardType,
      reward_id: s.rewardId,
      quantity: s.quantity,
      state: s.state,
      makeup_cost: s.makeupCost,
    })),
    /**
     * Monotonic version for the client's "never let an older response overwrite a newer one" rule.
     * The server's own clock in milliseconds: every response is stamped when it is built, so two
     * responses that crossed on the wire are ordered by when the SERVER answered, not by when the
     * browser happened to receive them.
     */
    updated_at: now.getTime(),
  };
}

export type DailyLoginStatus = ReturnType<typeof buildStatusPayload>;

// --- Routes ------------------------------------------------------------------

export function registerDailyLoginApi(app: Express): void {
  /**
   * The whole board, recomputed from the server's clock.
   *
   * Also the only place the anchor is created. Doing it on a READ is deliberate: 「玩家第一次進入
   * 每日登入功能時，以當天的伺服器日期作為 Day 1」 — opening the panel is the first entry, and
   * waiting for the first claim would mean a player who looked on Monday and claimed on Tuesday
   * would have their Day 1 be Tuesday.
   */
  app.get('/api/daily-login/status', requireAuth, async (req: AuthedRequest, res: Response) => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: { code: 'not_configured', message: initError } });
      return;
    }
    try {
      const now = new Date();
      const state = await readState(db, req.uid!, now);
      if (state.anchorWasMissing) {
        // Not a transaction: the anchor is write-once and the value is the server's today, so two
        // concurrent first visits write the identical date. Nothing is lost by the second write.
        await userDoc(db, req.uid!).update({ dailyLoginAnchor: state.anchor });
      }
      res.json(
        buildStatusPayload(now, state.anchor, state.cycle, state.claimedDays, walletOf(state.profile))
      );
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * Take one square, free or bought back.
   *
   * The body carries only WHICH square and HOW, plus a retry key. It carries no amounts, no prices,
   * no dates and no user id — every one of those is derived here, because every one of those is
   * something a client would otherwise be able to choose for itself.
   */
  app.post('/api/daily-login/claim', requireAuth, async (req: AuthedRequest, res: Response) => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: { code: 'not_configured', message: initError } });
      return;
    }

    const uid = req.uid!;
    const dayIndex = Number((req.body ?? {}).day_index);
    const mode = (req.body ?? {}).mode === 'makeup' ? 'makeup' : 'free';
    const idempotencyKey =
      typeof (req.body ?? {}).idempotency_key === 'string' ? (req.body.idempotency_key as string).slice(0, 128) : null;

    if (!Number.isInteger(dayIndex) || dayIndex < 1 || dayIndex > CYCLE_LENGTH) {
      res.status(400).json({ error: { code: 'invalid_request', message: '無效的日期' } });
      return;
    }

    try {
      const now = new Date();
      const result = await db.runTransaction(async (tx) => {
        const state = await readState(db, uid, now, tx);
        const { cycle, claimedDays, claims } = state;
        // The prize is a pure function of (round, day) — see constants/dailyLogin.ts on why the
        // roll is seeded rather than live. That is what lets this line name the claim document
        // after the prize's KIND: two attempts at the same day are two attempts to create the same
        // path, which is the uniqueness constraint Firestore does not otherwise have. A prize that
        // re-rolled would be a second path, and a second path is a second payout.
        const prize = dailyPrizeFor(cycle.cycleId, dayIndex);
        const id = claimId(cycle.cycleId, dayIndex, prize.kind);

        // --- Idempotent replay ------------------------------------------------
        // A claim that already exists is not automatically an error: if it carries the same
        // idempotency key, this is the same request arriving twice (the first response was lost,
        // the tab was reloaded mid-flight, the network retried) and the honest answer is the
        // result it already produced. Only a DIFFERENT key means a genuine second attempt.
        const existing = claims[id];
        if (existing) {
          if (idempotencyKey && existing.idempotencyKey === idempotencyKey) {
            return { replayed: true, granted: existing.quantity, spent: existing.costGold, state };
          }
          throw new ClaimError('already_claimed', 409, '這一天已經領過了');
        }

        // --- Eligibility, from the server's own clock -------------------------
        const square = buildSquares(cycle, claimedDays, true)[dayIndex - 1];
        if (!canClaim(square, mode)) {
          if (square.state === 'claimed') throw new ClaimError('already_claimed', 409, '這一天已經領過了');
          if (square.state === 'future') throw new ClaimError('not_available_yet', 409, '這一天還沒開放');
          if (square.state === 'missed') throw new ClaimError('makeup_window_closed', 409, '這一輪已結束，無法補簽');
          if (mode === 'free' && square.state === 'makeup_available') {
            throw new ClaimError('not_available_yet', 409, '這一天需要補簽才能領取');
          }
          throw new ClaimError('not_available_yet', 409, '目前無法領取這一天');
        }

        // --- Price and payout, both in 金幣 now -------------------------------
        //
        // The day pays 金幣 on four of its seven days and pays nothing this endpoint can move on the
        // other three: 商品碎片, 抽獎券, 功能卡, a product and a free 輪盤 turn all live in the
        // player's own document and are granted by the client after this claim is accepted (see
        // context/useDailyLoginPrize.ts). That is deliberate — those have no wallet to protect, and
        // teaching this API about the catalog would buy nothing.
        //
        // Only the PRICE is checked for affordability; a payout cannot fail for lack of funds.
        const costGold = mode === 'makeup' ? makeupCostForDay(dayIndex) : 0;
        const grantCoins = prize.coins;
        const wallet = walletOf(state.profile);
        if (costGold > wallet.coins) {
          throw new ClaimError('insufficient_gold', 402, '金幣不足');
        }

        // --- One transaction: record, pay, audit ------------------------------
        // `create` (not set) is what makes the claim record the uniqueness constraint: it fails if
        // the document exists, and the whole transaction rolls back with it.
        const record: ClaimRecord & { claimedAt: FirebaseFirestore.FieldValue } = {
          cycleId: cycle.cycleId,
          dayIndex,
          rewardType: prize.kind,
          rewardId: prize.itemRarity ?? prize.kind,
          quantity: dailyPrizeHeadline(prize),
          mode,
          costGold,
          idempotencyKey,
          claimedAt: FieldValue.serverTimestamp(),
        };
        tx.create(claimDoc(db, uid, id), record);

        // ONE increment, netted — which is the opposite of what this did while the payout and the
        // price were different currencies. It has to be: they are the same field now, and two
        // `increment`s written under the same key in one update object is not two increments, it is
        // the second one silently replacing the first. Netting is correct here for exactly the
        // reason it was wrong there — there IS a net between 15 金幣 in and 500 金幣 out.
        const netCoins = grantCoins - costGold;
        if (netCoins !== 0) {
          tx.update(userDoc(db, uid), { [COIN_FIELD]: FieldValue.increment(netCoins) });
        }

        const after = { coins: wallet.coins + netCoins, fragments: wallet.fragments };

        // The audit row records BOTH balances before and after. It used to record one number under
        // `balanceBefore`/`balanceAfter`, which cannot describe a transaction that moves two
        // currencies — and an audit trail that silently drops half of what happened is worse than
        // none, because it looks complete.
        tx.create(auditCol(db, uid).doc(), {
          ...record,
          claimRef: id,
          rewardCurrency: DAILY_LOGIN_CURRENCY,
          grantedCoins: grantCoins,
          balanceBefore: wallet.coins,
          balanceAfter: after.coins,
          fragmentsBefore: wallet.fragments,
          fragmentsAfter: after.fragments,
          serverDate: civilDateAt(now),
        });

        return {
          replayed: false,
          granted: grantCoins,
          spent: costGold,
          state: {
            ...state,
            claimedDays: new Set([...claimedDays, dayIndex]),
            profile: {
              ...state.profile,
              balanceGold: after.coins,
              wallet: { ...state.profile.wallet, fragments: after.fragments },
            },
          },
        };
      });

      const after = await readState(db, uid, now);
      res.json({
        ok: true,
        replayed: result.replayed,
        granted_quantity: result.granted,
        spent_gold: result.spent,
        status: buildStatusPayload(now, after.anchor, after.cycle, after.claimedDays, walletOf(after.profile)),
      });
    } catch (error) {
      sendError(res, error);
    }
  });
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof ClaimError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  // Firestore's own "document already exists" from tx.create losing the race. Two clients that
  // passed eligibility in parallel both reach the write; exactly one commits and the other lands
  // here, which is the concurrency guarantee actually being observed.
  const message = (error as Error)?.message ?? '';
  if (/ALREADY_EXISTS|already exists/i.test(message)) {
    res.status(409).json({ error: { code: 'already_claimed', message: '這一天已經領過了' } });
    return;
  }
  console.error('daily-login:', error);
  res.status(500).json({ error: { code: 'server_error', message: '伺服器忙碌中，請稍後再試' } });
}
