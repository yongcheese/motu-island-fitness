/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HealthActivity } from '../../lib/healthData';

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
 *
 * ## 一張卡片 → 一個問題 → 一個子頁
 *
 * 子頁是依「玩家點這張卡想知道什麼」切的，不是一張卡一頁：
 *
 *   卡片／入口                子頁        回答的問題
 *   今天                      today       今天動了多少、還差多少
 *   連續達標                  streak      連續幾週、哪幾週斷掉、這週還要幾天才能延續
 *   我的趨勢                  trends      最近幾週變多還是變少
 *   個人紀錄                  records     每個項目我最多做過幾下
 *   每週任務、重要提醒        tasks       我設的目標做到哪了、可以領獎勵了嗎
 *   N 月、最近紀錄 › 全部     history     哪幾天有動、那天做了什麼
 *
 * 「連續達標」曾經跟「個人紀錄」共用一頁、「N 月」曾經跟「我的趨勢」共用一頁 —— 點了連續達標，
 * 第一眼看到的卻是各項目的單次最多次數；點了月曆，第一眼看到的卻是週長條圖。兩組是不同的問題，
 * 所以拆開。反過來，「重要提醒」只是「每週任務」的捷徑、「N 月」跟「全部」都是在翻過去的紀錄，
 * 這兩組共用同一頁是對的 —— 重要提醒多帶一個 {@link HealthNavOptions.focusTaskIds}，讓任務頁知
 * 道玩家是為了哪幾個任務來的。
 */
export type HealthPage = 'home' | 'today' | 'streak' | 'trends' | 'records' | 'tasks' | 'history';

/** 換頁時順便帶過去的東西。目前只有一個：從「重要提醒」進任務頁時，要標出哪幾個任務。 */
export interface HealthNavOptions {
  focusTaskIds?: readonly string[];
}

/** 子頁的標題。首頁的標題就是「健康」，不在這裡。 */
export const HEALTH_PAGE_TITLES: Record<Exclude<HealthPage, 'home'>, string> = {
  today: '今天',
  streak: '連續達標',
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
