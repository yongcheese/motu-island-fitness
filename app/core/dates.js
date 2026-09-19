// 日期鍵（YYYY-MM-DD）的單一真實來源。pure。
//
// ⚠️ 為什麼需要這個檔案 —— 這是 2026-09-19 修掉的一個實際 bug：
//   原本 `store.js` 用 `new Date().toISOString().slice(0,10)` 蓋章（**UTC 日期**），
//   而 `tracking.js` 用 `getFullYear/getMonth/getDate` 分組（**本地日期**）。
//   同一個 App 裡有兩個「今天」。台北是 UTC+8，於是：
//     · 台北 9/19 07:30 練的 → 存成 2026-09-18（被記成昨天）
//     · 台北同一天 07:30 與 21:00 各練一次 → 追蹤頁把它拆成兩天
//     · 台北 9/18 21:00 練、9/19 07:00 再練 → UTC 日期同為 09-18
//       → bumpStreak 判定「今日已計入」而直接 return → **連續兩天運動，連續天數不會 +1**
//   全專案的日期判定一律改走本檔，不得再各自呼叫 toISOString().slice(0,10)。

/** 由 Date 取本地時區的 YYYY-MM-DD。不經過 UTC，故不會有跨日偏移。 */
function keyOfDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 今天的日期鍵（使用者所在時區）。
 *
 * ⚠️ 預設值刻意寫成 `new Date(Date.now())` 而不是 `new Date()`：
 *    V8 裡改寫 `Date.now` **不會**影響 `new Date()` 的取值，
 *    寫成後者會讓「注入假時鐘」的測試靜靜失效（測試看起來過了，其實量的是真實時間）。
 *    這個差異是實際踩到的 —— 連續天數的跨日測試第一次寫出來時就是這樣失敗的。
 */
export function todayKey(now = new Date(Date.now())) {
  return keyOfDate(now instanceof Date ? now : new Date(now));
}

/**
 * 把「完整 ISO 時間戳或 Date」轉成**本地時區**的日期鍵。
 *
 * 這是既有存檔能被正確歸日的關鍵：舊資料的 `session.date` 是 UTC 鍵（歸日錯誤），
 * 但 `session.dateISO` 是帶時區的完整時間戳，從它可以還原出正確的本地日期 ——
 * 因此**不需要回溯改寫任何一筆歷史紀錄**。
 *
 * ⚠️ 只接受完整時間戳。若傳入純日期字串（`'2026-09-19'`）會回 null，
 *    因為純日期沒有時刻資訊，無從判斷它屬於哪個本地日 —— 猜測等於竄改資料。
 *    呼叫端遇到 null 時應退回使用既有的 `date` 欄位（見 sessionDayKey）。
 */
export function dayKeyOf(isoOrDate) {
  if (isoOrDate instanceof Date) {
    return Number.isNaN(isoOrDate.getTime()) ? null : keyOfDate(isoOrDate);
  }
  if (typeof isoOrDate !== 'string' || !isoOrDate) return null;
  // 必須含時刻才有時區意義；純日期字串（長度 10）一律不接受
  if (!/\d{4}-\d{2}-\d{2}T/.test(isoOrDate)) return null;
  const d = new Date(isoOrDate);
  return Number.isNaN(d.getTime()) ? null : keyOfDate(d);
}

/** 日期鍵 ± n 天。以本地正午為基準運算，避開日光節約時間造成的 23/25 小時日。 */
export function shiftDays(key, n) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [y, m, d] = key.split('-').map(Number);
  const base = new Date(y, m - 1, d, 12, 0, 0);
  if (Number.isNaN(base.getTime())) return null;
  base.setDate(base.getDate() + n);
  return keyOfDate(base);
}

/** 昨天的日期鍵。預設值同 todayKey，理由見該函式註解。 */
export function yesterdayKey(now = new Date(Date.now())) {
  return shiftDays(todayKey(now), -1);
}

/**
 * 一筆訓練紀錄應該歸到哪一天。
 *
 * 取值序刻意如此：`dateISO`（完整時間戳，可還原正確本地日）優先於
 * `date`（可能是舊版寫下的 UTC 鍵）。這讓既有存檔不必改寫就能被正確歸日；
 * 只有連 `dateISO` 都沒有的極舊資料才退回 `date`。
 */
export function sessionDayKey(session) {
  if (!session) return null;
  return dayKeyOf(session.dateISO) || (typeof session.date === 'string' ? session.date : null);
}
