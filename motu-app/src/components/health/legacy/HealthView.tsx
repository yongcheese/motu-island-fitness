/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, Target, X } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { View } from '../../../types';
import type { WeeklyTaskView } from '../../../context/useWeeklyTasks';
import { useEscapeToClose } from '../../../hooks/useEscapeToClose';
import { playSound, SoundEffect } from '../../../lib/soundUtils';
import { HEALTH_PAGE_TITLES, type HealthPage } from './healthSections';
import { useHealthGoals } from '../healthGoals';
import { useHealthSnapshot } from '../useHealthSnapshot';
import { longDateLabel } from '../healthStats';
import { StateNotice } from '../HealthChrome';
import { HealthHome } from './HealthHome';
import { HealthTodayPage } from '../HealthTodayPage';
import { HealthTrendsPage } from './HealthTrendsPage';
import { HealthRecordsPage } from './HealthRecordsPage';
import { HealthGoalSheet } from '../HealthGoalSheet';
import { WeeklyTaskPanel } from './WeeklyTaskPanel';
import { ActivityHistoryPanel } from './ActivityHistoryPanel';

/**
 * ⚠ 舊版健康頁的凍結副本 —— 待確認後整個 `legacy/` 資料夾刪除。
 *
 * 健康頁資訊架構重整（連續達標獨立成頁、N 月卡改進活動紀錄…）之前的樣子，原封不動留在這裡，
 * 讓新舊兩版可以並排比對。網址加上 `?health=legacy` 再打開健康頁就是這一版（見上一層
 * HealthView.tsx 的 `LEGACY_HEALTH_REQUESTED`）。
 *
 * 這個資料夾只複製了**這次會改到**的檔案；沒改到的（今天頁、圖表、目標抽屜、任務卡…）直接用上一
 * 層的同一份。刪除方式：刪掉 `legacy/` 整個資料夾，以及上一層 HealthView.tsx 裡標著「舊版」的那
 * 幾行。
 *
 * ---
 *
 * 健康 —— 運動數據、每週任務與活動紀錄。
 *
 * ## 版面（健康頁 V2）
 *
 * 一個卡片首頁（HealthHome）加五個子頁：今天、我的趨勢、個人紀錄、每週任務、活動紀錄。首頁右上
 * 是「設定目標」，子頁左上是「‹ 健康」。為什麼不再是三個分頁，見 healthSections.ts。
 *
 * 外框仍然是一個全螢幕捲動頁，跟商店與設定同一個形狀 —— `page-shell-x/y` 留出瀏海與圓角的安全
 * 區，高度由內容決定（沒有 `h-[85vh]`）。寬度分三段：手機是整個螢幕寬、平板 `max-w-3xl`、桌機
 * `max-w-6xl`，卡片在裡面自己換欄（見 HealthHome 的檔頭）。
 *
 * ## 顏色
 *
 * 設計稿是黑底的；這裡換回島嶼的淺色外觀 —— 半透明米白的背景、白色卡片、細框、teal／navy 的強
 * 調色 —— 跟遊戲裡其他畫面放在一起不會像換了一個 App。
 *
 * Esc 由內往外一層一層退：先關目標抽屜，再回首頁，最後才關掉健康頁。
 */
export function LegacyHealthView() {
  const { setCurrentView, weeklyTaskView } = useApp();
  return (
    <LegacyHealthScreen
      view={weeklyTaskView}
      onClose={() => setCurrentView(View.HOME)}
      onStartWorkout={() => setCurrentView(View.FITNESS)}
      renderPanel={(page) => (page === 'tasks' ? <WeeklyTaskPanel /> : <ActivityHistoryPanel />)}
    />
  );
}

/**
 * 健康頁本體，不碰 AppContext —— 資料與「離開」「去健身」兩個動作都從外面傳進來。
 *
 * 分開的理由是這一頁要能在沒有登入、沒有 Firestore 的情況下用範例資料畫出來檢查版面（手機、平
 * 板、桌機三種寬度）；每週任務與活動紀錄兩個面板仍然直接讀 context，所以用 `renderPanel` 交給
 * 呼叫端。
 */
export function LegacyHealthScreen({
  view,
  onClose,
  onStartWorkout,
  renderPanel,
  initialPage = 'home',
}: {
  view: Pick<WeeklyTaskView, 'loading' | 'error' | 'activities' | 'progress' | 'summary'> &
    Partial<Pick<WeeklyTaskView, 'rewardStatus'>>;
  onClose: () => void;
  onStartWorkout: () => void;
  renderPanel: (page: 'tasks' | 'history') => React.ReactNode;
  /** 一打開就停在哪一頁。預設首頁。 */
  initialPage?: HealthPage;
}) {
  const { loading, error, activities, progress, summary, rewardStatus } = view;
  const [page, setPage] = useState<HealthPage>(initialPage);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [goals, setGoals] = useHealthGoals();
  const snapshot = useHealthSnapshot(activities, goals);
  const scrollRef = useRef<HTMLDivElement>(null);

  const close = onClose;
  const startWorkout = onStartWorkout;
  const navigate = (next: HealthPage) => {
    playSound(SoundEffect.CLICK);
    setPage(next);
  };

  useEscapeToClose(() => {
    if (goalsOpen) setGoalsOpen(false);
    else if (page !== 'home') setPage('home');
    else close();
  });

  // 換頁回到最上面：從首頁最底下的「最近紀錄」點「全部」，不該落在活動紀錄的中段。
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [page]);

  const isHome = page === 'home';
  const needsData = page === 'home' || page === 'today' || page === 'trends' || page === 'records';

  return (
    // z-40: local sub-scale —— 這個畫面永遠掛在 App.tsx 的 z-game-view 容器裡，所以它只需要贏過
    // 自己的兄弟（下面那顆 z-50 的關閉鍵與目標抽屜）。見 DESIGN_SYSTEM.md 的 z-index「local
    // sub-scale exception」。
    <div ref={scrollRef} className="fixed inset-0 overflow-y-auto z-40 bg-island-cream-2/85 backdrop-blur-3xl page-shell-y page-shell-x">
      <button
        onClick={close}
        aria-label="關閉健康頁"
        className="fixed corner-safe-tr w-12 h-12 sm:w-14 sm:h-14 bg-white border border-island-line hover:bg-island-cream-2 rounded-2xl flex items-center justify-center text-island-navy-soft hover:text-island-navy transition-all z-50 shadow-[0_10px_24px_rgba(38,70,83,0.15)] active:scale-95 hover:-translate-y-0.5"
      >
        <X size={26} strokeWidth={3} />
      </button>

      <div className="w-full max-w-3xl lg:max-w-6xl mx-auto text-island-navy pb-8">
        {/* 標題列。`pr-16 sm:pr-20` 讓出右上角那顆固定的關閉鍵。 */}
        <header className="pr-16 sm:pr-20 pt-1 sm:pt-2 pb-4 sm:pb-6 min-h-[88px] flex items-end justify-between gap-3">
          {isHome ? (
            <>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[13px] font-bold text-island-navy-soft/70">{longDateLabel(snapshot.today)}</span>
                <h1 className="text-[34px] sm:text-4xl lg:text-5xl font-black tracking-tight leading-tight">健康</h1>
              </div>
              <button
                type="button"
                onClick={() => {
                  playSound(SoundEffect.CLICK);
                  setGoalsOpen(true);
                }}
                className="h-10 sm:h-11 px-3.5 sm:px-4 flex items-center gap-1.5 rounded-full bg-white border border-island-line text-sm font-black text-island-navy shadow-[0_2px_10px_rgba(38,70,83,0.06)] hover:border-island-teal-light hover:-translate-y-0.5 active:scale-95 transition-all flex-shrink-0 mb-1"
              >
                <Target size={16} strokeWidth={2.6} className="text-island-teal" />
                設定目標
              </button>
            </>
          ) : (
            <div className="flex flex-col gap-1 min-w-0">
              <button
                type="button"
                onClick={() => navigate('home')}
                className="-ml-1.5 self-start min-h-10 pr-2 flex items-center gap-0.5 text-[15px] font-black text-island-teal-dark hover:text-island-teal"
              >
                <ChevronLeft size={22} strokeWidth={2.8} />
                健康
              </button>
              <h1 className="text-[30px] sm:text-4xl font-black tracking-tight leading-tight truncate">{HEALTH_PAGE_TITLES[page]}</h1>
            </div>
          )}
        </header>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={page}
            initial={{ opacity: 0, x: isHome ? -12 : 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {needsData && error ? (
              <StateNotice kind="error" title="讀不到運動紀錄" description="健康數據需要你的運動紀錄才能計算。請檢查網路連線後再試一次。" />
            ) : needsData && loading ? (
              <StateNotice kind="loading" title="正在讀取運動紀錄…" />
            ) : page === 'home' ? (
              <HealthHome
                snapshot={snapshot}
                goals={goals}
                onNavigate={navigate}
                activities={activities}
                progress={progress}
                summary={summary}
                rewardStatus={rewardStatus}
                onStartWorkout={startWorkout}
              />
            ) : page === 'today' ? (
              <HealthTodayPage snapshot={snapshot} goals={goals} activities={activities} onStartWorkout={startWorkout} />
            ) : page === 'trends' ? (
              <HealthTrendsPage snapshot={snapshot} goals={goals} activities={activities} />
            ) : page === 'records' ? (
              <HealthRecordsPage snapshot={snapshot} goals={goals} />
            ) : (
              // 每週任務與活動紀錄沿用原本的面板，只是放進一張白卡裡 —— 它們本來就是畫在白底上的。
              <div className="bg-white border border-island-line rounded-[1.75rem] shadow-[0_2px_10px_rgba(38,70,83,0.05)] p-4 sm:p-6 lg:p-8">
                {renderPanel(page === 'tasks' ? 'tasks' : 'history')}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {goalsOpen && <HealthGoalSheet goals={goals} onSave={setGoals} onClose={() => setGoalsOpen(false)} />}
    </div>
  );
}
