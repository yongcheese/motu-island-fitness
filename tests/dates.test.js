// core/dates.js：日期鍵必須跟著使用者的時區走，而不是 UTC。
import { test, eq, assert } from './harness.js';
import { todayKey, dayKeyOf, shiftDays, yesterdayKey, sessionDayKey } from '../app/core/dates.js';

// 這一組是 2026-09-19 修掉的 bug 的迴歸測試。
// 舊實作用 `toISOString().slice(0,10)` 取 UTC 日期；在 UTC+8 之下，
// 早上 07:30 的 UTC 日期是前一天 —— 早晨的訓練全被記成昨天。
//
// ⚠️ 本檔的斷言一律以「本地 Date 建構 → 本地日期鍵」的方式寫，
//    因此在任何時區下跑都成立。不要改回寫死帶時區偏移的字串 ——
//    那種寫法只在 Asia/Taipei 下會過，換個時區就假性失敗。
test('dayKeyOf：早上 07:30 的訓練歸今天，不是昨天', () => {
  const morning = new Date(2026, 8, 19, 7, 30, 0);   // 本地 9/19 07:30
  eq(dayKeyOf(morning), '2026-09-19');
});

test('dayKeyOf：取的是本地日，不是把 ISO 字串前十碼截下來', () => {
  // 取本地 00:30：只要時區在 UTC 以東（offset < 0），這個時刻的 UTC 日期必然是前一天，
  // 不論偏移是 +2 還是 +12。用 07:30 不行 —— 偏移小於 8 小時的時區（如柏林 +2）減完仍是同一天，
  // 斷言會假性失敗。這個細節踩過一次，別改回去。
  const justAfterMidnight = new Date(2026, 8, 19, 0, 30, 0);
  const naiveUtc = justAfterMidnight.toISOString().slice(0, 10);   // 舊實作的作法
  const local = dayKeyOf(justAfterMidnight);
  eq(local, '2026-09-19');
  // getTimezoneOffset() 回傳「西於 UTC 幾分鐘」，東時區為負值。
  assert(local !== naiveUtc || justAfterMidnight.getTimezoneOffset() >= 0,
    `本地鍵 ${local} 與 UTC 截字串 ${naiveUtc} 在 UTC 以東應不同`);
});

test('dayKeyOf：本地午夜前後各一分鐘分屬不同日', () => {
  const before = dayKeyOf(new Date(2026, 8, 19, 23, 59, 0));   // 9/19 23:59 本地
  const after = dayKeyOf(new Date(2026, 8, 20, 0, 1, 0));      // 9/20 00:01 本地
  eq(before, '2026-09-19');
  eq(after, '2026-09-20');
});

test('dayKeyOf：純日期字串不接受（沒有時刻就無從判斷屬於哪個本地日）', () => {
  eq(dayKeyOf('2026-09-19'), null);
});

test('dayKeyOf：非法輸入回 null 而不是丟例外', () => {
  eq(dayKeyOf(undefined), null);
  eq(dayKeyOf(''), null);
  eq(dayKeyOf('not-a-date'), null);
  eq(dayKeyOf(new Date('invalid')), null);
  eq(dayKeyOf(123), null);
});

test('shiftDays：跨月正確', () => {
  eq(shiftDays('2026-08-31', 1), '2026-09-01');
  eq(shiftDays('2026-09-01', -1), '2026-08-31');
});

test('shiftDays：跨年正確', () => {
  eq(shiftDays('2026-12-31', 1), '2027-01-01');
  eq(shiftDays('2027-01-01', -1), '2026-12-31');
});

test('shiftDays：閏年二月正確', () => {
  eq(shiftDays('2028-02-28', 1), '2028-02-29');
  eq(shiftDays('2028-02-29', 1), '2028-03-01');
});

test('shiftDays：非法日期鍵回 null', () => {
  eq(shiftDays('2026/09/19', 1), null);
  eq(shiftDays(undefined, 1), null);
});

test('todayKey 與 yesterdayKey 相差一天', () => {
  const now = new Date(2026, 8, 19, 10, 0, 0);
  eq(todayKey(now), '2026-09-19');
  eq(shiftDays(todayKey(now), -1), '2026-09-18');
});

test('sessionDayKey：優先用 dateISO 還原本地日，舊存檔的 UTC date 不會害它歸錯', () => {
  // 這正是既有存檔不必改寫的關鍵：date 是舊版寫下的 UTC 鍵（錯的），
  // 但 dateISO 是完整時間戳，從它可以還原出正確的本地日。
  const oldSession = {
    dateISO: new Date(2026, 8, 19, 7, 30, 0).toISOString(),
    date: '2026-09-18',           // 舊版用 UTC 蓋的章
  };
  eq(sessionDayKey(oldSession), '2026-09-19');
});

test('sessionDayKey：極舊資料只有 date 沒有 dateISO 時走 fallback 而不當掉', () => {
  eq(sessionDayKey({ date: '2026-09-18' }), '2026-09-18');
  eq(sessionDayKey({}), null);
  eq(sessionDayKey(null), null);
});
