/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HealthActivity } from '../../../lib/healthData';

/**
 * 健康頁有哪些畫面。
 *
 * ## 首頁＋子頁，而不是一排分頁
 *
 * 上一版是三個分頁（總覽／每週任務／活動紀錄）。這一版照「健康頁 V2」設計稿改成一個卡片首頁：
 * 每張卡片是一個摘要（今天的圓環、連續達標、近 8 週趨勢、這個月、個人紀錄、每週任務、最近紀
 * 錄），點進去才是完整的畫面，子頁左上角一顆「‹ 健康」回到首頁。
 *
 * 理由是分頁列只放得下三個入口，而健康頁現在有六個值得單獨看的東西；把它們全部擠成分頁，每一
 * 個標籤在 320px 上會剩不到 60px。卡片首頁在手機上是一欄往下捲，在桌機上是一個兩欄的儀表板
 * （見 HealthHome.tsx），同一份內容兩種排法。
 */
export type HealthPage = 'home' | 'today' | 'trends' | 'records' | 'tasks' | 'history';

/** 子頁的標題。首頁的標題就是「健康」，不在這裡。 */
export const HEALTH_PAGE_TITLES: Record<Exclude<HealthPage, 'home'>, string> = {
  today: '今天',
  trends: '我的趨勢',
  records: '個人紀錄',
  tasks: '每週任務',
  history: '活動紀錄',
};

/** 活動紀錄裡出現過的運動項目，依出現順序（也就是由新到舊第一次出現的順序）。 */
export function distinctTypes(activities: readonly HealthActivity[]): string[] {
  const seen: string[] = [];
  for (const activity of activities) {
    if (!seen.includes(activity.type)) seen.push(activity.type);
  }
  return seen;
}
