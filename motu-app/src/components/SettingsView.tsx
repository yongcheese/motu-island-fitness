/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { View } from '../types';
import { SettingsNav } from './UI/settings/SettingsNav';
import type { SettingsCategoryId } from './UI/settings/settingsCategories';
import { consumeRequestedSettingsCategory } from './UI/settings/settingsNavigation';
import { GeneralCategory } from './UI/settings/GeneralCategory';
import { FitnessCategory } from './UI/settings/FitnessCategory';
import { AudioCategory } from './UI/settings/AudioCategory';
import { GraphicsCategory } from './UI/settings/GraphicsCategory';
import { ControlsCategory } from './UI/settings/ControlsCategory';
import { AccountCategory } from './UI/settings/AccountCategory';
import { AboutCategory } from './UI/settings/AboutCategory';

// Shell only: full-screen chrome, category nav, and the seven category panels.
// Every setting's actual read/write logic lives in its own Category
// component under UI/settings/ — this file owns none of it.
export function SettingsView() {
  const { setCurrentView } = useApp();
  // 開場停在哪一頁：呼叫端指定的那一頁（見 settingsNavigation.ts —— 帳號中心的「編輯個人資料」
  // 用它直接落在 帳號，而不是丟在 一般 讓玩家自己再找一次），沒有人指定就是 一般。
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>(
    () => consumeRequestedSettingsCategory() ?? 'general',
  );

  return (
    // z-40: local sub-scale — this view is always mounted inside App.tsx's
    // z-game-view wrapper, so it only needs to out-rank its own siblings
    // (e.g. the z-50 close button below). See DESIGN_SYSTEM.md's z-index
    // "local sub-scale exception".
    <div className="fixed inset-0 overflow-y-auto z-40 bg-white/70 backdrop-blur-3xl page-shell-y page-shell-x flex flex-col items-center">
      <button
        onClick={() => setCurrentView(View.HOME)}
        className="fixed corner-safe-tr w-14 h-14 bg-white hover:bg-island-cream-2 border border-island-line rounded-2xl flex items-center justify-center text-island-navy-soft hover:text-island-navy transition-all z-50 active:scale-95 hover:-translate-y-0.5"
      >
        <X size={28} strokeWidth={3} />
      </button>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-2xl lg:max-w-5xl w-full bg-white border border-island-line p-6 md:p-10 rounded-[2rem] shadow-[0_24px_60px_rgba(38,70,83,0.15)] flex flex-col gap-6 lg:gap-8 text-island-navy"
      >
        <h2 className="text-2xl md:text-3xl font-black tracking-tight text-island-navy text-center lg:text-left">個人與環境設定</h2>

        <div className="w-full flex flex-col lg:flex-row gap-6 lg:gap-10">
          <SettingsNav activeId={activeCategory} onSelect={setActiveCategory} />

          {/* All seven categories stay mounted; only the active one is shown.
              This keeps in-progress local state (a half-typed name, an
              unsent YouTube search) alive across category switches instead
              of resetting it on unmount, and needs no reload. */}
          <div className="flex-1 min-w-0 flex flex-col gap-6">
            <div className={activeCategory === 'general' ? 'contents' : 'hidden'}><GeneralCategory /></div>
            <div className={activeCategory === 'fitness' ? 'contents' : 'hidden'}><FitnessCategory /></div>
            <div className={activeCategory === 'audio' ? 'contents' : 'hidden'}><AudioCategory /></div>
            <div className={activeCategory === 'graphics' ? 'contents' : 'hidden'}><GraphicsCategory /></div>
            <div className={activeCategory === 'controls' ? 'contents' : 'hidden'}><ControlsCategory /></div>
            <div className={activeCategory === 'account' ? 'contents' : 'hidden'}><AccountCategory /></div>
            <div className={activeCategory === 'about' ? 'contents' : 'hidden'}><AboutCategory /></div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
