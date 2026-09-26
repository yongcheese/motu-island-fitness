/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 遊戲的行事曆 — 「今天是哪一天」的唯一答案。
 *
 * ## 為什麼這是獨立的一個檔案
 *
 * 這些函式原本住在 constants/dailyLogin.ts 裡，因為當時只有每日登入需要它們。每週任務
 * （constants/weeklyTasks.ts）需要完全相同的一套日期運算 —— 同一個時區、同一個午夜、同一種
 * 「兩個日期差幾天」 —— 而讓每週任務去 import 每日登入，等於宣告 A 功能依賴 B 功能，實際上兩
 * 者只是共用一本行事曆。真正共用的東西被搬到這裡，dailyLogin.ts 原樣 re-export，所以既有的
 * import 一行都不用改。
 *
 * 更重要的是：整個遊戲只能有 **一個** 「今天」。如果每週任務自己算一次日期（哪怕只是
 * `toISOString().slice(0, 10)`），玩家就會遇到「每日登入說今天是 9/21，每週任務說是 9/20」這
 * 種沒有人有辦法回報的錯誤。所以日期運算永遠從這裡來，任何檔案都不該自己用 `getDate()` 或
 * `toISOString()` 推算日曆日。
 */

/**
 * The game's civil timezone, fixed rather than read from the device.
 *
 * A daily reward has to turn over at the same instant for everyone, or a player who flies to London
 * gets a second day 3 and a player who flies back loses one. +08:00 with no DST is the whole of
 * Taiwan's offset, so this is a constant rather than an Intl lookup.
 */
export const CIVIL_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * The zone name that offset IS, reported in every API response so a client never has to guess which
 * midnight the server means. Exported rather than inlined at the response site because the name and
 * the offset above have to change together or the API starts describing a zone it is not using.
 */
export const CIVIL_TZ = 'Asia/Taipei';

/** A calendar day in the game's civil timezone, `YYYY-MM-DD`. Never a `Date`; see {@link civilDateAt}. */
export type CivilDate = string;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Which civil day an instant belongs to.
 *
 * `toISOString().slice(0, 10)` is the usual one-liner and it is wrong twice over: it reads UTC (so
 * a Taipei morning is still yesterday) and it silently uses the device's clock zone if you reach for
 * the local getters instead. Shifting the instant by the fixed offset and then reading the UTC parts
 * is the only version that gives every player the same answer at the same moment.
 */
export function civilDateAt(instant: Date): CivilDate {
  const shifted = new Date(instant.getTime() + CIVIL_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Midnight of a civil day, as a UTC instant — the anchor all the arithmetic below is done on. */
export function civilStart(date: CivilDate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - CIVIL_OFFSET_MS;
}

/** The instant a civil day ENDS (exclusive) — i.e. the next day's midnight. */
export function civilEnd(date: CivilDate): number {
  return civilStart(date) + 86_400_000;
}

/** `date` moved by whole civil days. Crosses months, years and leap days by construction. */
export function addCivilDays(date: CivilDate, days: number): CivilDate {
  return civilDateAt(new Date(civilStart(date) + days * 86_400_000 + CIVIL_OFFSET_MS - CIVIL_OFFSET_MS));
}

/** Whole civil days from `from` to `to`. Negative when `to` is earlier. */
export function civilDaysBetween(from: CivilDate, to: CivilDate): number {
  return Math.round((civilStart(to) - civilStart(from)) / 86_400_000);
}

/** Milliseconds until the next civil midnight — the countdown in the panel's header. */
export function msUntilNextCivilDay(now: Date = new Date()): number {
  const next = civilStart(addCivilDays(civilDateAt(now), 1));
  return Math.max(0, next - now.getTime());
}

/** `03:41:07`, from a duration in ms. Zero-padded so the countdown does not jitter in width. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}

/**
 * 星期幾，0 = 星期日 … 6 = 星期六 —— 在遊戲時區裡，不是在裝置時區裡。
 *
 * `new Date(dateString).getDay()` 讀的是裝置的時區：同一個 `'2026-09-21'` 在台北是星期一，在
 * 洛杉磯的瀏覽器上會變成星期日，於是「這一週從哪天開始」在兩台機器上得到不同答案。這裡用固定
 * 位移還原成 UTC 再讀，跟 {@link civilDateAt} 同一個做法。
 */
export function civilWeekday(date: CivilDate): number {
  return new Date(civilStart(date) + CIVIL_OFFSET_MS).getUTCDay();
}

/** `2026-09-21` → `9/21`。純顯示用；日期的真值永遠是 {@link CivilDate} 字串本身。 */
export function formatCivilDateShort(date: CivilDate): string {
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}
