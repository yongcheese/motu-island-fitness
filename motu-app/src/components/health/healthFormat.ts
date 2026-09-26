/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 健康頁的顯示字串 —— 一個數字要怎麼變成一句話。
 *
 * 跟 constants/weeklyTasks.ts 分開，因為那邊是規則、這邊是措辭：改「剩一天要怎麼講」不該碰到進度
 * 怎麼算。跟元件分開，因為同一句話會出現在總覽的摘要、任務卡跟歷史清單上，而同一件事在三個地方
 * 有三種講法，是玩家覺得介面「怪怪的」但說不出哪裡怪的來源。
 */

import { civilDateAt, formatCivilDateShort, type CivilDate } from '../../constants/civilTime';
import type { HealthActivity } from '../../lib/healthData';
import type { WeeklyRemaining, WeeklyTaskStatus } from '../../constants/weeklyTasks';

/**
 * 剩餘時間怎麼講。
 *
 * 規格明確點名這件事：「尚未到期顯示剩餘天數、當天到期顯示適當的當日提示、已過期顯示已過期、已
 * 完成顯示完成狀態」。四種狀態四句話，而且「剩 1 天」這句永遠不會出現 —— 因為當只剩今天的時候，
 * 「剩 1 天」聽起來像還有一整天緩衝，而「今天最後一天」才是實話。
 */
export function remainingLabel(remaining: WeeklyRemaining): string {
  switch (remaining.kind) {
    case 'days':
      return `本週還剩 ${remaining.days} 天`;
    case 'due_today':
      return '今天是本週最後一天';
    case 'expired':
      return remaining.daysAgo === 1 ? '已於昨天結束' : `已結束 ${remaining.daysAgo} 天`;
  }
}

/** 任務狀態的短標籤，給卡片右上角那顆徽章。 */
export function statusLabel(status: WeeklyTaskStatus): string {
  switch (status) {
    case 'completed':
      return '已完成';
    case 'expired':
      return '已過期';
    case 'upcoming':
      return '下週開始';
    case 'active':
      return '進行中';
  }
}

/** 徽章的顏色。完成是 teal，過期是 coral，其餘中性 —— 顏色只標示狀態，不當裝飾。 */
export function statusAccent(status: WeeklyTaskStatus): 'teal' | 'coral' | 'navy' {
  if (status === 'completed') return 'teal';
  if (status === 'expired') return 'coral';
  return 'navy';
}

/** `2026-09-21` → `9/21`。純轉呼叫，讓元件不用認識 constants/civilTime。 */
export function shortDate(date: CivilDate): string {
  return formatCivilDateShort(date);
}

/** `9/15 – 9/21`，任務卡上的週期起訖。 */
export function cycleRangeLabel(weekStart: CivilDate, weekEnd: CivilDate): string {
  return `${shortDate(weekStart)} – ${shortDate(weekEnd)}`;
}

/** 一筆活動發生在哪一天，用遊戲時區算 —— 不是裝置時區。 */
export function activityCivilDate(activity: HealthActivity): CivilDate {
  return civilDateAt(new Date(activity.completedAt));
}

/** `14:32`，遊戲時區。日期已經由分組的標題講過了，這裡只需要時間。 */
export function activityTimeLabel(activity: HealthActivity): string {
  const at = new Date(activity.completedAt);
  if (!Number.isFinite(at.getTime())) return '--:--';
  // 用固定位移而不是 toLocaleTimeString：跟日期分組必須用同一個時區，否則一筆晚上 11 點的紀錄
  // 會被分到今天、卻顯示成明天早上的時間。
  const shifted = new Date(at.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/** `12 分 30 秒` / `45 秒`。秒數在短運動上是唯一有意義的單位，所以不無條件進位成分鐘。 */
export function durationLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${rest} 秒`;
}

/** 日期分組的標題：今天、昨天，再往前就寫日期。 */
export function dayHeading(date: CivilDate, today: CivilDate, yesterday: CivilDate): string {
  if (date === today) return '今天';
  if (date === yesterday) return '昨天';
  return date.replace(/^\d{4}-/, '').replace('-', '/');
}

/** 大數字加千分位，讓 12000 大卡不用一位一位數。 */
export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}
