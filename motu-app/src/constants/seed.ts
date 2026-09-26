/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 種子亂數 — the two-and-a-half functions every 「隨機但不能重擲」 decision in this game is built on.
 *
 * They were written three times before this file existed: `seedFrom` in constants/rewardPools.ts,
 * `hashSeed` in constants/fragments.ts, and a third copy was about to go into constants/dailyLogin.ts
 * for the seven-day prize roll. All three are the same FNV-1a, and three copies of a hash is three
 * chances for one of them to be "improved" into a different sequence — at which point a board
 * PREVIEWING a prize and a claim PAYING one disagree, silently, for one item in seven.
 *
 * So the hash lives here, and it is deliberately the only thing here: this module imports nothing,
 * which is what lets it be read by the browser, by `tsx` scripts and by the Express server
 * (src/server/dailyLoginApi.ts) without dragging a catalog behind it.
 *
 * ## Why seeded at all, rather than `Math.random()`
 *
 * Because every draw in this game is a draw the player can SEE BEFORE it is taken, or has to be
 * able to retry. A daily-login board shows what day 5 is worth on day 1; a wheel spin that is
 * re-rendered must not land somewhere else; a grant whose confirmation was lost must be recognised
 * as the same grant when it is retried. `Math.random()` is correct exactly once and wrong on every
 * second look, and all three of those are second looks.
 */

/**
 * FNV-1a over a string, as a non-negative 32-bit integer.
 *
 * Not cryptographic and does not need to be. What it needs to be is STABLE — the same string gives
 * the same number in this process, in the next one, and on the server — which ad-hoc character sums
 * are not once a seed grows past a few characters.
 */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The fraction of the way through a range this seed lands, 0…1 (never 1).
 *
 * The whole 32 bits rather than `seed % n`, so a table whose size shares a factor with the hash's
 * range does not bunch on a few entries.
 */
export function seedUnit(seed: number): number {
  return ((seed >>> 0) % 0x100000000) / 0x100000000;
}

/**
 * A final mixing step — the 「雪崩」 that {@link seedFrom} on its own does not provide.
 *
 * ## The bug this exists to fix, because it is not obvious and it was live
 *
 * FNV-1a mixes from the LOW end: each character is xored into the bottom byte and then multiplied
 * up. {@link seedUnit} reads the TOP bits. So the last thing multiplied — `h * 0x01000193` — puts
 * the pre-multiply low byte almost unchanged into the top byte, and two seeds that differ only in
 * their final character produce two fractions a couple of 256ths apart.
 *
 * For the daily-login round that was not a theoretical wobble. The four coin-flip days seed on
 * `daily-prize:cycle-YYYY-MM-DD:1` … `:6`, which differ ONLY in that last character, so all four
 * landed on the same side of 0.5 in four rounds out of five: a week of 「碎片 or 金幣」 that was in
 * practice 「all 金幣」 or 「all 碎片」. The per-day odds were 50/50 when measured ACROSS rounds,
 * which is why the distribution test passed while the feature was visibly broken.
 *
 * This is the standard 32-bit finalizer (two xor-shift/multiply rounds), which spreads a one-bit
 * input difference across all 32 output bits.
 *
 * ## Why it is applied HERE and not inside seedFrom
 *
 * Because `seedFrom`'s output is already load-bearing elsewhere. The 限時商店's rotation and the
 * wheel's item draws are seeded through it, and those reach the number they want by `seed % n`,
 * which reads the LOW bits and mixes perfectly well. Changing the hash itself would silently
 * reshuffle every shop rotation in the game to fix a bug none of them have.
 */
function avalanche(seed: number): number {
  let h = seed >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * One entry of a list, uniformly — the 「每個選項機率相同」 draw.
 *
 * Its own function because that is what the daily-login round actually asks for: 50／50 on the
 * 碎片／金幣 days and 33／33／33 on 第 2 天 and 第 5 天. Expressing equal odds as a weight table
 * ({@link pickWeighted} in constants/rewardPools.ts) would be three rows all saying `weight: 1`,
 * which reads as a balance decision somebody made rather than as the absence of one.
 *
 * Reads the seed through {@link avalanche} rather than raw, because this is the one selector in the
 * game that picks by FRACTION from seeds which routinely differ by a single trailing character —
 * see the note there for what that cost.
 */
export function seedPick<T>(items: readonly T[], seed: number): T | null {
  if (items.length === 0) return null;
  return items[Math.min(items.length - 1, Math.floor(seedUnit(avalanche(seed)) * items.length))];
}
