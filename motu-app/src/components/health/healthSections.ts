/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HealthActivity } from '../../lib/healthData';

/**
 * 健康頁分成哪幾個區。
 *
 * ## 為什麼是三個分頁，而不是一頁到底
 *
 * 改版前的「追蹤」是一張卡片：三個統計數字、一張「最近 10 次」的折線圖，結束。它沒有分頁的問題
 * ——它是連東西都還沒有多到需要分的程度。每週任務進來之後就不是了：任務清單、建立表單與活動紀
 * 錄放在同一個捲動頁裡，玩家要找「我這週還差幾次」得先捲過一張圖表。
 *
 * 三個分頁：總覽、每週任務、活動紀錄。原本還有第四個「資料與說明」（資料來源、目標類型支援狀
 * 況、週期定義），已經拿掉 —— 它是一頁只有靜態說明、沒有任何操作的分頁，卻在導覽列上佔掉四分之
 * 一的寬度，讓三個真的有東西可看的分頁都變窄。它唯一真正必要的內容 ——「哪些目標類型還沒有資料
 * 來源」—— 本來就在建立任務的表單裡講了一次（灰掉的選項下面就寫著原因），而那是玩家真的會問這
 * 個問題的時刻。
 *
 * 分頁（而不是側邊導航或可收合區塊）的理由是這個遊戲的 UI 已經有分頁這個東西了 —— 商店的主分區列就是一排
 * `SignpostTag`（components/UI/CategoryTabs.tsx）。多發明一種導航元件，只會讓健康頁看起來不像
 * 這個遊戲的一部分。
 */
export type HealthSection = 'overview' | 'tasks' | 'history';

export interface HealthSectionMeta {
  id: HealthSection;
  label: string;
  /** 分頁標題列的副標。 */
  blurb: string;
}

export const HEALTH_SECTIONS: readonly HealthSectionMeta[] = [
  { id: 'overview', label: '總覽', blurb: '本週狀態一覽' },
  { id: 'tasks', label: '每週任務', blurb: '自訂目標與進度' },
  { id: 'history', label: '活動紀錄', blurb: '過去的運動' },
] as const;

/** 活動紀錄裡出現過的運動項目，依出現順序（也就是由新到舊第一次出現的順序）。 */
export function distinctTypes(activities: readonly HealthActivity[]): string[] {
  const seen: string[] = [];
  for (const activity of activities) {
    if (!seen.includes(activity.type)) seen.push(activity.type);
  }
  return seen;
}
