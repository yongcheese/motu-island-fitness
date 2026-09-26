/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SettingsCategoryId } from './settingsCategories';

/**
 * 「打開設定，而且直接停在這一頁。」
 *
 * ## 為什麼需要它
 *
 * 帳號中心（UI/AccountPanel.tsx）底下有兩張看起來完全不同的卡：
 *
 *   編輯個人資料 · 更變暱稱 & 挑選您的專屬頭像
 *   偏好系統設定 · 調整背景音樂與 AI 語音輔助
 *
 * 兩個 `onClick` 以前是**同一個** `handleNavigateToSettings`，而設定永遠從「一般」開場。於是
 * 承諾了暱稱與頭像的那一張，把玩家丟在一個沒有暱稱也沒有頭像的分頁上，剩下的路要自己找 ——
 * 兩個不同的入口通往同一個地方，而且是錯的那一個地方。
 *
 * ## 為什麼是一個模組變數而不是 context
 *
 * 這是一個**一次性的意圖**，不是狀態：它在切換 view 的前一刻寫下、在 SettingsView 掛載的那一刻
 * 讀走，之後就不存在了。放進 AppContext 會讓每一位訂閱者為了一個活不過一次 mount 的值重繪，而
 * 且還得再想「用完要不要清掉、誰負責清」—— 那正是 `consume` 這個名字在這裡代替的東西。
 *
 * SettingsView 每次進入都是全新掛載（App.tsx 的 AnimatePresence 以 currentView 為 key），所以
 * 「寫下 → 切 view → 掛載時讀走」這個順序是成立的，不需要訂閱。
 *
 * 讀走就清掉，這一點是刻意的：沒有清的話，玩家下一次自己從 NavBar 點開設定，會被送到上一次別人
 * 幫他選的那一頁。
 */
let requestedCategory: SettingsCategoryId | null = null;

/** 在 `setCurrentView(View.SETTINGS)` **之前**呼叫。 */
export function requestSettingsCategory(id: SettingsCategoryId): void {
  requestedCategory = id;
}

/** SettingsView 掛載時呼叫一次。沒有人指定過就回 `null`，設定照常從預設分頁開場。 */
export function consumeRequestedSettingsCategory(): SettingsCategoryId | null {
  const requested = requestedCategory;
  requestedCategory = null;
  return requested;
}
