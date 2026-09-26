/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The one list SettingsNav and SettingsView both read to know which
// categories exist, in what order, and how to label/icon them. Adding a
// future category (e.g. once Graphics/Controls have real settings) is one
// entry here plus one Category component — SettingsNav and SettingsView
// need no changes.

import type { LucideIcon } from 'lucide-react';
import { SlidersHorizontal, Volume2, Monitor, Gamepad2, User, Info } from 'lucide-react';

export type SettingsCategoryId = 'general' | 'audio' | 'graphics' | 'controls' | 'account' | 'about';

export interface SettingsCategoryDef {
  id: SettingsCategoryId;
  label: string;
  icon: LucideIcon;
  /**
   * 這個分類今天有沒有東西。`false` 的分類**還在**（型別、元件、SettingsView 的掛載全部保留），
   * 只是不畫進導覽列。
   *
   * 為什麼需要這個欄位：畫面／操作／關於三個分類各自只有一張「敬請期待」的 EmptyState，於是設定
   * 的導覽列有一半指向沒有內容的地方 —— 那是把「還沒做」做成了常駐導覽的一部分。這跟
   * `MAIN_SECTIONS` 裡 NPC 不給 iconName 是同一條規則（見 utils/categoryUtils.ts）：占位符不該
   * 長得像一個已經決定好的東西。
   *
   * 補上第一個設定的那一天，改的是這裡的一個 `true`，不是重新排一次六個分類。
   */
  available?: boolean;
}

export const SETTINGS_CATEGORIES: SettingsCategoryDef[] = [
  { id: 'general', label: '一般', icon: SlidersHorizontal, available: true },
  { id: 'audio', label: '音效', icon: Volume2, available: true },
  // 三個空分類 —— 元件仍在（GraphicsCategory / ControlsCategory / AboutCategory），只是不進導覽列。
  { id: 'graphics', label: '畫面', icon: Monitor, available: false },
  { id: 'controls', label: '操作', icon: Gamepad2, available: false },
  { id: 'account', label: '帳號', icon: User, available: true },
  { id: 'about', label: '關於', icon: Info, available: false },
];

/** 導覽列該畫哪幾格。SettingsNav 與 SettingsView 都問這個，不會有一邊多一格的情況。 */
export const VISIBLE_SETTINGS_CATEGORIES: SettingsCategoryDef[] =
  SETTINGS_CATEGORIES.filter((c) => c.available !== false);
