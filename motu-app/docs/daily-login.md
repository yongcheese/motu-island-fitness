# 每日登入獎勵 — architecture, API contract, and what is still risky

## Where authority lives

Everything else in this game saves itself: the browser holds a Firestore handle and writes
`users/{uid}` directly, with `firestore.rules` as the only gate. **Daily login does not.** The two
facts a daily reward turns on — *what day is it* and *was this day already paid* — are exactly the
two a player can change (system clock) or race (two tabs, two devices, a retried request), so they
are decided by the server and only by the server.

```
browser                          server (server.ts)                Firestore (Admin SDK)
──────────────────────────────   ──────────────────────────────    ─────────────────────────
DailyLoginPanel                  GET  /api/daily-login/status      users/{uid}
  └ useEconomyActions            POST /api/daily-login/claim         .dailyLoginAnchor
      └ lib/dailyLoginClient  ─▶   verify Firebase ID token          .balanceGold
        (fetch + ID token)         server clock → 台北 civil day     users/{uid}/daily_login_claims/{id}
                                   recompute eligibility             users/{uid}/daily_login_audit/{auto}
                                   runTransaction
```

`src/constants/dailyLogin.ts` (the ladder, the cycle maths, the state machine) is imported **by both
sides, verbatim**. The client's copy is an optimistic preview so a button can be greyed out; the
server's copy is the verdict. They cannot disagree because they are the same file.

## Data model

| Path | Purpose |
| --- | --- |
| `users/{uid}.dailyLoginAnchor` | `YYYY-MM-DD`. Day 1 of the player's very first round. Written once, by the server, on the first `status` call. |
| `users/{uid}.balanceGold` | The existing wallet. **No second wallet was created**; claims move this field. |
| `users/{uid}/daily_login_claims/{cycleId}__d{day}__{rewardType}` | One claim. The document id **is** the uniqueness constraint. |
| `users/{uid}/daily_login_audit/{autoId}` | Append-only record: what was granted, what was spent, balance before/after, server date. |

### `UNIQUE(user_id, cycle_id, day_index, reward_type)`

Firestore has no unique constraints, so the tuple is encoded in the claim document's **path**:
`users/{uid}/daily_login_claims/{cycleId}__d{day}__{rewardType}`. The id is derived, never random,
and the write uses `transaction.create()`, which fails if the document exists. Two requests for the
same square are therefore two attempts to create the same document — from one tab, ten tabs, a phone
and a laptop at once, or a client retrying a request whose response was lost. Exactly one commits.

### Rewards are not hardcoded to coins

**2026-08-25 — the round pays 碎片, not 金幣.** 金幣 now has exactly one source in this game (健身),
so a daily login that minted it would make opening the app a better living than exercising. The
ladder is 4 / 6 / 10 / 16 / 24 / 36 / 60 碎片 (156 a round) and the 補簽 is a flat 500 金幣 price
rather than a surcharge on the day's own value — the payout and the price are different currencies
now, so there is nothing to add a fee to. Full reasoning: `docs/economy.md` and
`src/constants/dailyLogin.ts`. Everything below about the CALENDAR, the claim records, idempotency
and the API contract is unchanged; only the currency and the figures moved.

`DailyReward` carries `rewardType` (`fragments | gold | item | pet`), `rewardId` and `quantity`, and every layer
below it — claim record, audit row, API response, card — passes those through rather than assuming
碎片. Adding a pet to a future round is a table edit plus a grant branch, not a migration — and the
currency change itself is the proof: it cost one word per row and no schema change at all. `gold`
stays in the union because claim records written before the change say it, and that collection is
permanent history; nothing may WRITE it any more.

## API contract

All endpoints require `Authorization: Bearer <Firebase ID token>`. **The uid is taken from the
verified token and never from the request.** No endpoint accepts a date, an amount or a price.

### `GET /api/daily-login/status`

```jsonc
{
  "server_now": "2026-08-17T12:34:56.789Z",
  "timezone": "Asia/Taipei",
  "anchor_date": "2026-08-11",
  "cycle_id": "cycle-2026-08-11",
  "cycle_number": 0,
  "cycle_start_at": "2026-08-11",
  "cycle_end_at": "2026-08-17",
  "current_day_index": 7,
  "coin_balance": 4200,
  "fragment_balance": 96,
  "reward_currency": "fragments",
  "rewards": [
    { "day_index": 1, "reward_type": "fragments", "reward_id": "fragments",
      "quantity": 100, "state": "claimed", "makeup_cost": null },
    { "day_index": 2, "reward_type": "fragments", "reward_id": "fragments",
      "quantity": 150, "state": "makeup_available", "makeup_cost": 650 }
    // …7 entries
  ],
  "updated_at": 1755432896789
}
```

`state` is one of `future | available | claimed | makeup_available | missed`.
`updated_at` is the server's own millisecond stamp; the client refuses to apply a response older
than the one it is showing (`isNewerThan` in `lib/dailyLoginClient.ts`), so two requests that cross
on the wire cannot put a claimed square back to `available`.

Calling `status` is also what establishes `anchor_date` on a first-ever visit — the spec's
「第一次進入以當天的伺服器日期作為 Day 1」. Anchoring on the first *claim* instead would make Day 1
the day the player first pressed a button rather than the day they first looked.

### `POST /api/daily-login/claim`

```jsonc
// request
{ "day_index": 3, "mode": "makeup", "idempotency_key": "6f1c…" }

// 200
{ "ok": true, "replayed": false, "granted_quantity": 10, "spent_gold": 500,
  "status": { /* the full status payload above, post-claim */ } }
```

`mode` is `free` or `makeup`. Price and payout are computed server-side:
`makeup_cost = reward + 500`, so a make-up nets the player exactly 500 worse off than having logged
in (Day 3: pay 750, receive 250).

`idempotency_key` is **not** the uniqueness mechanism — the document id is. The key is how a *retry*
is told from a *second claim*: same key on an existing claim returns `replayed: true` with the
original result; a different key returns `409 already_claimed`.

### Errors

| HTTP | `error.code` | When |
| --- | --- | --- |
| 401 | `unauthenticated` | missing/invalid ID token |
| 503 | `not_configured` | the server has no service-account credentials |
| 400 | `invalid_request` | `day_index` outside 1–7 |
| 404 | `no_profile` | no `users/{uid}` document |
| 409 | `not_available_yet` | future square, or a free claim on a day that needs a make-up |
| 409 | `already_claimed` | terminal; also the lost race between two concurrent writers |
| 409 | `makeup_window_closed` | the square's cycle has ended |
| 402 | `insufficient_gold` | the 補簽 price (金幣) is more than `balanceGold`. Still 金幣 — the payout is 碎片, but the make-up is the one thing this feature charges for and it is priced in 金幣 |
| 500 | `server_error` | anything else (never leaks the underlying message) |

The client adds two of its own: `offline` and `timeout` (12 s).

## Deployment — required before this works

The server needs credentials for the **named** database (`firebase.json` does not use `(default)`):

```bash
# either
FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}'   # inline JSON
# or
GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
# optional, defaults to the id in firebase.json
FIREBASE_DATABASE_ID=ai-studio-07ffb391-da53-4ca6-99c4-9c12d59da230
```

Without them every endpoint answers `503 not_configured` and the panel says
「獎勵服務尚未設定完成」 rather than paying anything out.

`server.ts` must be **restarted** after this change — `tsx server.ts` does not hot-reload the
Express file, so a long-running dev server keeps serving the SPA fallback for `/api/daily-login/*`.

## Tests

`npm run test:daily-login` — 54 assertions over the rules module:

* the ladder (100/150/250/400/600/900/1500), Day 7 largest, make-up = reward + 500
* Asia/Taipei boundaries: 23:59:59 vs 00:00:00, the same instant read from UTC, month/year/leap
* cycle tiling: Day 7 → next server day starts a new `cycle_id`; a five-week absence lands in a
  later cycle; a clock rolled back before the anchor cannot open a day
* the state machine: skipping Day 2 leaves Day 3 `available` and Day 2 `makeup_available`;
  Day 7 opens on its date with no prerequisites; a past cycle is all `claimed`/`missed` and nothing
  in it is actionable; `claimed` is terminal for both routes
* affordability: exactly enough, one short, one over

## Known risks / not yet done

1. **No automated test exercises the write path.** The concurrency guarantees (double-claim,
   simultaneous free + make-up, retry after a lost response) are argued from `transaction.create()`
   on a derived document id, and are *not* yet proven by a test — that needs the Firestore emulator,
   which this repo does not currently run.
2. **`firestore.rules` has not been updated.** The new subcollections are not yet listed, so they
   are covered by the default-deny catch-all: the client cannot read its own claim history, and —
   more importantly — nothing yet *prevents* a client from writing `balanceGold` directly through
   the existing update whitelist. The server being authoritative for daily login does not close
   that pre-existing hole; it only stops daily login from widening it. Deploying rules is a manual
   step (`npx firebase-tools deploy --only firestore:rules`), see `docs/FIRESTORE_RULES.md`.
3. **Local-only guests are unsupported.** `lib/firebase.ts` routes guest saves to `localStorage`;
   such a player has no Firebase ID token, so every call returns `unauthenticated`. The panel shows
   「請先登入再領取獎勵」. Deciding what a guest should get is a product question, not a bug.
4. **The old `loginCycleId` / `loginClaimedDays` profile fields are still written by nothing and
   read by the panel's fallback path.** The server is the source of truth now; those fields should
   be removed once the panel reads `status` directly rather than deriving squares from the profile.
5. **Responsive layout has not been verified on a real device.** The board is a 7-across grid on
   desktop and 2/4+3 on small screens by class, but no screenshot check has been run.
