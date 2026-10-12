/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, Target, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import type { WeeklyTaskView } from '../../context/useWeeklyTasks';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { playSound, SoundEffect } from '../../lib/soundUtils';
import { HEALTH_PAGE_TITLES, type HealthNavOptions, type HealthPage } from './healthSections';
import { useHealthGoals } from './healthGoals';
import { useHealthSnapshot } from './useHealthSnapshot';
import { longDateLabel } from './healthStats';
import { StateNotice } from './HealthChrome';
import { HealthHome } from './HealthHome';
import { HealthTodayPage } from './HealthTodayPage';
import { HealthStreakPage } from './HealthStreakPage';
import { HealthTrendsPage } from './HealthTrendsPage';
import { HealthRecordsPage } from './HealthRecordsPage';
import { HealthGoalSheet } from './HealthGoalSheet';
import { WeeklyTaskPanel } from './WeeklyTaskPanel';
import { ActivityHistoryPanel } from './ActivityHistoryPanel';
// 舊版（待確認後刪除）—— 見 legacy/HealthView.tsx 的檔頭。
import { LegacyHealthView } from './legacy/HealthView';

/**
 * 舊版：網址帶 `?health=legacy` 時，健康頁顯示資訊架構重整之前的版本，方便新舊對照。
 * 讀一次就固定（跟 utils/debugOverrides.ts 的網址開關同一個做法），所以 HealthView 裡依它提早
 * return 不會讓 hooks 的順序在兩次 render 之間改變。待確認後刪除。
 */
const LEGACY_HEALTH_REQUESTED =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('health') === 'legacy';

/**
 * 健康 —— 運動數據、每週任務與活動紀錄。
 *
 * ## 版面（健康頁 V2）
 *
 * 一個卡片首頁（HealthHome）加六個子頁：今天、連續達標、我的趨勢、個人紀錄、每週任務、活動紀
 * 錄。首頁右上是「設定目標」，子頁左上是「‹ 健康」。哪張卡片進哪一頁、為什麼，見
 * healthSections.ts。
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
 * Esc 由內往外一層一層退：先關目標抽屜，再回首頁，最後才關掉健康頁。從子頁回到首頁時，首頁回
 * 到離開時捲到的位置 —— 從最底下的卡片點進去再出來，不該被丟回最上面。
 */
export function HealthView() {
  if (LEGACY_HEALTH_REQUESTED) return <LegacyHealthPreview />;
  return <CurrentHealthView />;
}

function CurrentHealthView() {
  const { setCurrentView, weeklyTaskView } = useApp();
  return (
    <HealthScreen
      view={weeklyTaskView}
      onClose={() => setCurrentView(View.HOME)}
      onStartWorkout={() => setCurrentView(View.FITNESS)}
      renderPanel={(page, options) =>
        page === 'tasks' ? <WeeklyTaskPanel focusTaskIds={options.focusTaskIds} /> : <ActivityHistoryPanel />
      }
    />
  );
}

/** 舊版健康頁＋左下角一個標籤，讓人知道現在看的是哪一版。待確認後刪除。 */
function LegacyHealthPreview() {
  return (
    <>
      <LegacyHealthView />
      <div className="fixed left-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 pointer-events-none h-8 px-3 rounded-full bg-island-navy text-white text-xs font-black flex items-center shadow-[0_6px_16px_rgba(38,70,83,0.25)]">
        舊版健康頁（?health=legacy）
      </div>
    </>
  );
}

/**
 * 健康頁本體，不碰 AppContext —— 資料與「離開」「去健身」兩個動作都從外面傳進來。
 *
 * 分開的理由是這一頁要能在沒有登入、沒有 Firestore 的情況下用範例資料畫出來檢查版面（手機、平
 * 板、桌機三種寬度）；每週任務與活動紀錄兩個面板仍然直接讀 context，所以用 `renderPanel` 交給
 * 呼叫端。
 */
export function HealthScreen({
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
  /** 每週任務與活動紀錄兩個面板。`options` 是換頁時帶過來的東西（例如要標出哪幾個任務）。 */
  renderPanel: (page: 'tasks' | 'history', options: HealthNavOptions) => React.ReactNode;
  /** 一打開就停在哪一頁。預設首頁。 */
  initialPage?: HealthPage;
}) {
  const { loading, error, activities, progress, summary, rewardStatus } = view;
  const [page, setPage] = useState<HealthPage>(initialPage);
  const [navOptions, setNavOptions] = useState<HealthNavOptions>({});
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [goals, setGoals] = useHealthGoals();
  const snapshot = useHealthSnapshot(activities, goals);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 離開首頁時捲到哪裡；每回一次首頁 `homeVisit` 加一，<RestoreScroll> 看到它變了就捲回去。
  const homeScroll = useRef(0);
  const [homeVisit, setHomeVisit] = useState(0);

  const close = onClose;
  const startWorkout = onStartWorkout;
  const navigate = (next: HealthPage, options: HealthNavOptions = {}) => {
    playSound(SoundEffect.CLICK);
    if (page === 'home' && next !== 'home') homeScroll.current = scrollRef.current?.scrollTop ?? 0;
    if (page !== 'home' && next === 'home') setHomeVisit((visit) => visit + 1);
    setNavOptions(options);
    setPage(next);
  };
  const openGoals = () => {
    playSound(SoundEffect.CLICK);
    setGoalsOpen(true);
  };

  useEscapeToClose(() => {
    if (goalsOpen) setGoalsOpen(false);
    else if (page !== 'home') navigate('home');
    else close();
  });

  // 進子頁就從最上面開始：從首頁最底下的「最近紀錄」點「全部」，不該落在活動紀錄的中段。
  useEffect(() => {
    if (page !== 'home') scrollRef.current?.scrollTo({ top: 0 });
  }, [page]);

  const isHome = page === 'home';
  const needsData = page !== 'tasks' && page !== 'history';

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
                onClick={openGoals}
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
              <>
                <RestoreScroll container={scrollRef} top={homeScroll.current} visit={homeVisit} />
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
              </>
            ) : page === 'today' ? (
              <HealthTodayPage snapshot={snapshot} goals={goals} activities={activities} onStartWorkout={startWorkout} />
            ) : page === 'streak' ? (
              <HealthStreakPage snapshot={snapshot} goals={goals} onEditGoals={openGoals} />
            ) : page === 'trends' ? (
              <HealthTrendsPage snapshot={snapshot} goals={goals} activities={activities} />
            ) : page === 'records' ? (
              <HealthRecordsPage snapshot={snapshot} />
            ) : page === 'tasks' ? (
              // 任務頁自己排成總覽＋卡片，跟其他子頁一樣直接放在背景上。它曾經跟活動紀錄一起包在一張
              // 大白卡裡：白卡裡面又是白卡，而只有一個任務時，那張大白卡的右半邊整個是空的。
              renderPanel('tasks', navOptions)
            ) : (
              // 活動紀錄沿用原本的面板，只是放進一張白卡裡 —— 它的月曆與圖表是米色的小卡，本來就是畫
              // 在白底上的。
              <div className="bg-white border border-island-line rounded-[1.75rem] shadow-[0_2px_10px_rgba(38,70,83,0.05)] p-4 sm:p-6 lg:p-8">
                {renderPanel('history', navOptions)}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {goalsOpen && <HealthGoalSheet goals={goals} onSave={setGoals} onClose={() => setGoalsOpen(false)} />}
    </div>
  );
}

/**
 * 首頁畫出來的那一刻，把捲動位置還原到離開時的地方。
 *
 * 放在首頁內容旁邊、用 layout effect，而不是在換頁的當下捲：那時畫面上可能還是子頁，子頁比首頁
 * 短，位置會被夾掉。首頁內容進了 DOM、高度對了才捲，而且在瀏覽器畫出第一格之前，所以看不到先跳
 * 到頂再跳下去的那一下。
 *
 * 依 `visit`（第幾次回首頁）觸發，而不是「掛上去的那一次」：AnimatePresence 有時會沿用同一個
 * 首頁的元件實例，而不是重新掛一個（實測 motion 12.38），只看掛載的話第二次回來就不會捲。
 */
function RestoreScroll({
  container,
  top,
  visit,
}: {
  container: React.RefObject<HTMLDivElement | null>;
  top: number;
  visit: number;
}) {
  useLayoutEffect(() => {
    container.current?.scrollTo({ top });
    // 只看 `visit`：玩家在首頁上自己捲動時 `top` 不會變，但就算變了也不該被搶回去。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit]);
  return null;
}
