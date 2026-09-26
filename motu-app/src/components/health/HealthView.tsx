/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { motion } from 'motion/react';
import { Heart, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { IconTile, SignpostTag } from '../UI/DesignKit';
import { playSound, SoundEffect } from '../../lib/soundUtils';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { HEALTH_SECTIONS, type HealthSection } from './healthSections';
import { HealthOverviewPanel } from './HealthOverviewPanel';
import { WeeklyTaskPanel } from './WeeklyTaskPanel';
import { ActivityHistoryPanel } from './ActivityHistoryPanel';

/**
 * 健康 —— 運動數據、每週任務與活動紀錄。
 *
 * ## 這個畫面以前叫「追蹤」
 *
 * 舊版是 components/TrackerView.tsx：一張 `h-[85vh]` 的卡片，裡面是三個統計數字加一張「最近 10
 * 次」的折線圖。它有三個具體問題，而這一版是針對它們改的：
 *
 *  - **名字**。「追蹤」沒有說出追蹤什麼，而且跟「健身」放在同一排路牌上時，玩家分不出哪一個是
 *    「動起來的地方」、哪一個是「看數字的地方」。現在三個分頁的名字都是「健康」。
 *  - **一頁到底**。加進每週任務之後，所有東西擠在同一個捲動容器裡。現在分成三區
 *    （constants 在 healthSections.ts）。
 *  - **固定高度**。`h-[85vh]` 在矮視窗（1366×768 的筆電、橫著拿的手機）會把圖表壓成一條線，而
 *    在高視窗留下一片空白。現在整頁是自然流動的捲動頁，高度由內容決定。
 *
 * ## 版面
 *
 * 一個全螢幕捲動頁，跟商店（ShopView）與設定同一個形狀 —— `page-shell-x/y` 負責留出瀏海與圓角
 * 的安全區，`max-w-4xl` 負責在寬螢幕上不要把一行字拉成 1800px。分頁列是一排 `SignpostTag`，跟
 * 商店的主分區列同一個元件；固定三欄，所以三個分頁在 320px 的螢幕上仍然是三個讀得完的木牌，而
 * 不是一排被擠爛的字。
 */
export function HealthView() {
  const { setCurrentView } = useApp();
  const [section, setSection] = useState<HealthSection>('overview');

  const close = () => setCurrentView(View.HOME);
  useEscapeToClose(close);

  const meta = HEALTH_SECTIONS.find((entry) => entry.id === section) ?? HEALTH_SECTIONS[0];

  return (
    // z-40: local sub-scale — 這個畫面永遠掛在 App.tsx 的 z-game-view 容器裡，所以它只需要贏過
    // 自己的兄弟（下面那顆 z-50 的關閉鍵）。見 DESIGN_SYSTEM.md 的 z-index「local sub-scale
    // exception」。
    <div className="fixed inset-0 overflow-y-auto z-40 bg-white/70 backdrop-blur-3xl page-shell-y page-shell-x">
      <button
        onClick={close}
        aria-label="關閉健康頁"
        className="fixed corner-safe-tr w-14 h-14 bg-white border border-island-line hover:bg-island-cream-2 rounded-2xl flex items-center justify-center text-island-navy-soft hover:text-island-navy transition-all z-50 shadow-[0_10px_24px_rgba(38,70,83,0.15)] active:scale-95 hover:-translate-y-0.5"
      >
        <X size={28} strokeWidth={3} />
      </button>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        // 沒有 `h-[85vh]`：高度由內容決定，頁面自己捲。這是這一版唯一真正結構性的版面改動。
        className="max-w-4xl w-full mx-auto bg-white border border-island-line rounded-[2rem] shadow-[0_24px_60px_rgba(38,70,83,0.15)] text-island-navy overflow-hidden"
      >
        {/* 標題。`pr-20` 在窄螢幕上讓出右上角那顆固定的關閉鍵，否則標題會被壓在它下面。 */}
        <header className="px-5 sm:px-8 pt-6 sm:pt-8 pr-20 sm:pr-24 flex items-center gap-3 sm:gap-4">
          <IconTile size={48} active className="text-island-teal">
            <Heart size={26} />
          </IconTile>
          <div className="min-w-0">
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight">健康</h2>
            <p className="text-island-navy-soft/70 text-xs sm:text-sm font-bold truncate">{meta.blurb}</p>
          </div>
        </header>

        {/* 分頁列。跟商店主分區同一個做法：`grid` 的欄是 `minmax(0, 1fr)`，所以一個長標籤不可能
            把這一列撐爆 —— 一個 `flex` 加 `min-w-[…]` 的版本才會。 */}
        <nav className="px-5 sm:px-8 pt-5 sm:pt-6">
          {/* 三欄，每個寬度都相同，在每一個螢幕尺寸上都是。不是 `grid-cols-2 sm:grid-cols-3`：
              三個 2-4 字的標籤在 320px 上分成三欄仍然各有 ~100px，讀得完；而兩欄會把第三個分頁
              推到自己一行、獨佔半個版面，看起來像它比另外兩個重要。 */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {HEALTH_SECTIONS.map((entry) => {
              const active = entry.id === section;
              return (
                <SignpostTag
                  key={entry.id}
                  shape="hang"
                  active={active}
                  onClick={() => {
                    playSound(SoundEffect.CLICK);
                    setSection(entry.id);
                  }}
                  className="flex-1 min-w-0 flex-col items-center justify-center gap-0.5 px-2 pt-4 pb-3"
                >
                  <span className="font-black tracking-tight text-xs sm:text-sm truncate max-w-full">
                    {entry.label}
                  </span>
                </SignpostTag>
              );
            })}
          </div>
        </nav>

        <div className="p-5 sm:p-8">
          {section === 'overview' && <HealthOverviewPanel onNavigate={setSection} />}
          {section === 'tasks' && <WeeklyTaskPanel />}
          {section === 'history' && <ActivityHistoryPanel />}
        </div>
      </motion.div>
    </div>
  );
}
