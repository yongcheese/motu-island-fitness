# 商品碎片 — the second way to own something

## The rule the whole feature is built on

**A fragment belongs to exactly one product.** There is no 通用碎片, no per-rarity pool, no
per-category pool. `珊瑚吊燈碎片` can only ever become 珊瑚吊燈.

That is a property of the STORAGE, not a rule the code remembers:

```
users/{uid}.itemFragments = { "hat-bucket": 200, "item-1": 123, "shoes-sandals": 24 }
```

Keyed by catalog id. There is no key a fragment could be confused with and no shared pool to leak
into, so no write path can accidentally make two items' fragments fungible — the mistake is not
forbidden, it is unrepresentable.

200 of an item's own fragments (`FRAGMENTS_TO_UNLOCK`) unlock it, free.

## Where the rules live

| File | What it holds |
| --- | --- |
| `src/constants/fragments.ts` | Every rule, as pure functions. The cap, the conversion rate, the drop tables, the featured-item seed, the settlement maths. |
| `src/context/useFragmentActions.ts` | The only writes: `grantFragments`, `unlockWithFragments`, and `fragmentPatchForPurchase` (the fragment half of a gold purchase). |
| `src/components/UI/FragmentProgress.tsx` | The shared vocabulary: the shard mark, the meter, the ticket chip, the gain card. |

Same split as `constants/dailyLogin.ts` ↔ `DailyLoginPanel`: a designer re-pricing the feature never
opens a component, and a component is never where a game rule is discovered.

## Sources

| Source | Amount | Which item |
| --- | --- | --- |
| 運動結算 (`FitnessView`) | `fragmentsForWorkout(reps)` — `reps × 0.6`, floored at 3, capped at 40 | `rollWorkoutFragmentItem` — 65% onto a stack already started and still unowned, otherwise any unowned item, otherwise anything |
| 每日簽到 (`DailyLoginPanel`) | `DAILY_FRAGMENT_LADDER[day-1]` — 10/12/15/18/20/25/40, **140 for a perfect week** | 本輪主打商品: one item for the whole round, `featuredFragmentItem(cycleId)` |
| 幸運轉盤 | 10 / 15 / 20 / 30 / 50（十格中的五格） | 走同一組結算純函式；因為要在同一次寫入裡扣抽獎券，所以自己組 `updateDoc`，見 `context/useWheelActions.ts` |

A perfect week of logins is 140 of the 200, so signing in every day gets a player most of the way to
the featured item and 運動 closes the gap. A week paying the full 200 would make the workout drop
pointless; a week paying 40 would make the board's fragment line decoration.

### Why the featured item is per-ROUND, not per-day

Seven different items at ~20 fragments each is seven stacks that are each a tenth of the way to
nothing. One item at 140 is most of an unlock — a week worth turning up for.

It is seeded (FNV-1a) on the cycle id, **not** rolled at claim time, because the board shows all
seven days at once including the ones that have not happened. A random-at-claim reward cannot be
drawn on a card, and the whole point of a seven-card board is seeing the top of the ladder from the
bottom. The panel and the claim path derive it the same way from the same id, so the board can never
promise one item and the payout grant another.

## 多出來的碎片 → 抽獎券

A stack stops at 200. There are exactly two ways to end up holding fragments past that line, and
both settle the same way — 20 overflow fragments make one 抽獎券:

1. **Granted onto a full stack** (or onto an item already owned). `settleFragmentGain`.
2. **The item was bought with gold instead.** `settleFragmentsOnPurchase`. This is the half that is
   easy to miss: a player 180/200 of the way to a lamp who simply buys the lamp is holding 180
   fragments that can never unlock anything again, because the only thing they were valid for is now
   owned. Left alone they would sit in the save forever as a number nobody can act on.

The rate does not divide evenly, so the remainder is **carried** on `raffleTicketProgress` rather
than dropped. Without the carry, 5 overflow fragments would pay nothing, and a player who overflows
5 at a time would be paid nothing ever while watching the number go up.

### The setting

`AppSettings.fragmentOverflowToTickets`, in 設定 › 一般. Default ON, and `undefined` (every save
predating the feature) reads as ON.

Turning it OFF does **not** bank the overflow somewhere else — it drops it. That is the honest
reading of turning a conversion off, and it is why the row's copy says 「關閉後這些碎片不會保留」
outright rather than describing itself as a preference.

## The purchase write

`purchaseItem` folds the fragment settlement into its own `updateDoc` rather than following it with
a second write, so the gold leaving, the item arriving and the fragments settling all land together
or none of them do:

```ts
await updateDoc(doc(db, 'users', user.uid), {
  balanceGold: increment(-item.price),
  inventory: stackable ? [...inventory, itemId] : arrayUnion(itemId),
  ...fragmentPatchForPurchase(profile, settings, itemId),   // {} in the common case
});
```

`fragmentPatchForPurchase` returns `{}` when there is nothing to settle, which is overwhelmingly
common — the purchase write is then byte-for-byte what it always was.

## Why the whole map is written instead of one dotted field

Item ids contain hyphens (`item-5`, `hair-long-set`). Firestore's dotted field paths cannot address
those without backtick quoting, and the offline save (`save/LocalSaveStore.ts`) splits dotted keys on
`.` with no quoting at all — so `itemFragments.item-5` would mean two different things in the two
back-ends this app runs on. Writing the map whole means one behaviour in both. The map holds one
entry per item the player has actually collected toward, which is small.

The cost is that fragments are read-modify-write rather than `increment()`, so two tabs granting at
the same instant can lose one grant. That is accepted: this is a single-player cosmetic currency, the
same trade the daily-login claim array already makes, and no wallet is exposed by it.

## What is deliberately NOT server-authoritative

Daily login's **gold** is decided by `src/server/dailyLoginApi.ts` and guarded by a claim record that
can only be created once (see `docs/daily-login.md`). Its **fragments** are not: they are granted
client-side by a wrapper in `AppContext` (`claimDailyRewardWithFragments`) after the server has
already accepted the claim as new.

That is a decision, not an oversight. Wiring fragments into that API would mean a schema change, a
new claim-record `rewardType`, and a rewrite of its test spec — for a currency that cannot be spent
on anything but cosmetics and cannot be converted into gold. The exactly-once property still holds
where it matters: a replayed claim returns `already_claimed` and never reaches the fragment grant, so
a double tap cannot pay a second stack.

## firestore.rules

Three new fields on `users/{uid}`, validated for shape and size only (`isValidUser`):

```
itemFragments        map, ≤ 500 entries
raffleTickets        number ≥ 0
raffleTicketProgress number ≥ 0
```

Two update clauses carry them:

- the existing **purchase** clause (`equippedItems, inventory, balanceGold, …`) gained all three,
  because a gold purchase settles fragments in the same write. `hasOnly` is a subset test, so an
  ordinary purchase touching none of them still matches unchanged;
- a new **fragment** clause: `itemFragments, raffleTickets, raffleTicketProgress, inventory,
  lastUpdated`. `balanceGold` is deliberately absent — the fragment route costs no currency, and
  leaving gold out of the clause is what enforces that rather than a comment saying so.

As always in this ruleset, the bounds are loose on purpose: `isValidUser` runs against the WHOLE
merged document, so an over-tight bound here would not reject one field, it would fail every other
write in the same load. See `docs/FIRESTORE_RULES.md`.

## Which items have a fragment

`isFragmentItem`: everything bought with gold. Two exclusions, and neither is a category — they are
the two things that are not *purchases*:

- an 經驗值 item (`xpUnlock`) is already earned rather than bought, and a second earning track would
  mean two progress bars racing for one card;
- a `price: 0` entry is not on sale at all (毛胚屋), so there is nothing for 200 fragments to stand
  in for.

## Colour

Fragments are **teal**. Gold is reserved for currency (`index.css` says so at the token), and a
fragment is not money: it cannot be spent on anything but the one item it belongs to. Teal is the
family this game already uses for the other earned track (經驗值's bolt).

抽獎券 **are** money and take the gold family — but drawn as a torn stub rather than a disc, so the
two never read as the same thing sitting in the same header.
