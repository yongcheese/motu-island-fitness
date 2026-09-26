/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion } from 'motion/react';
import { Activity, ArrowRight, CalendarCheck, Dumbbell, Flame, Plus, Target, Timer, Zap } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { Button, EmptyState, StatTile } from '../UI/DesignKit';
import type { HealthSection } from './healthSections';
import { SectionHeading, StateNotice } from './HealthChrome';
import {
  activityTimeLabel,
  cycleRangeLabel,
  dayHeading,
  durationLabel,
  formatNumber,
  remainingLabel,
} from './healthFormat';
import { addCivilDays, civilDateAt } from '../../constants/civilTime';
import { activityCivilDate } from './healthFormat';

/**
 * 「健康總覽」分頁 —— 一眼看完現在的狀態。
 *
 * ## 這裡放什麼、不放什麼
 *
 * 規格把總覽定義成「今日或目前的主要健康數據、近期活動摘要、每週任務完成進度、重要提醒、簡潔的
 * 整體狀態」。關鍵字是**摘要**：每一區都只放最上面的兩三筆，然後給一條通往完整分頁的路。一個總
 * 覽如果把每週任務的全部八張卡片都畫出來，它就不是總覽，是「每週任務」分頁的第二份拷貝 —— 這正
 * 是改版前那個把所有東西堆在同一頁的畫面的問題。
 *
 * 所以：任務只顯示前兩個，紀錄只顯示前三筆，其餘交給分頁。
 */
export function HealthOverviewPanel({ onNavigate }: { onNavigate: (section: HealthSection) => void }) {
  const { weeklyTaskView, setCurrentView } = useApp();
  const { summary, progress, activities, cycle, loading, error } = weeklyTaskView;

  const today = civilDateAt(new Date());
  const yesterday = addCivilDays(today, -1);
  const recent = activities.slice(0, 3);
  const topTasks = progress.slice(0, 2);
  // 「重要提醒」= 還沒完成、而且本週快結束了的任務。這是總覽唯一主動說話的地方，所以它必須是真
  // 的有事才出現 —— 一個每次進來都在提醒的橫幅，玩家三天後就看不見它了。
  const urgent = progress.filter((entry) => !entry.completed && entry.status === 'active' && entry.daysRemaining <= 2);

  return (
    <div className="flex flex-col gap-6">
      {/* 重要提醒。只在真的緊急時出現。 */}
      {urgent.length > 0 && (
        <motion.button
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => onNavigate('tasks')}
          className="text-left rounded-[1.75rem] border border-island-gold/35 bg-island-gold/10 p-4 flex items-center gap-3 transition-all hover:-translate-y-0.5 active:scale-[0.98]"
        >
          <div className="w-10 h-10 rounded-xl bg-island-gold/20 border border-island-gold/30 text-island-gold flex items-center justify-center flex-shrink-0">
            <Zap size={18} strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-island-navy truncate">
              {urgent.length === 1 ? `「${urgent[0].task.name}」還沒完成` : `有 ${urgent.length} 個任務還沒完成`}
            </p>
            <p className="text-[11px] font-bold text-island-navy-soft/70 truncate mt-0.5">
              {remainingLabel(urgent[0].remaining)}
            </p>
          </div>
          <ArrowRight size={18} strokeWidth={2.5} className="text-island-navy-soft/50 flex-shrink-0" />
        </motion.button>
      )}

      {/* 本週數據。四格，手機兩欄、桌機四欄 —— 沒有固定寬度。 */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          icon={<Activity size={18} strokeWidth={2.5} />}
          title="本週健康數據"
          subtitle={`${cycleRangeLabel(cycle.weekStart, cycle.weekEnd)}．週一到週日`}
        />
        {error ? (
          <StateNotice
            kind="error"
            title="讀不到運動紀錄"
            description="數據需要你的運動紀錄才能計算。請檢查網路連線後再試一次。"
          />
        ) : loading ? (
          <StateNotice kind="loading" title="正在讀取運動紀錄…" />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile accent="teal" icon={<Dumbbell size={18} />} label="運動次數" value={summary.workouts} />
            <StatTile accent="navy" icon={<Timer size={18} />} label="運動時間 (分)" value={summary.minutes} />
            <StatTile accent="teal" icon={<Zap size={18} />} label="動作次數" value={formatNumber(summary.reps)} />
            <StatTile accent="gold" icon={<Flame size={18} />} label="卡路里" value={formatNumber(summary.calories)} />
          </div>
        )}
      </section>

      {/* 每週任務摘要。 */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          icon={<Target size={18} strokeWidth={2.5} />}
          title="每週任務進度"
          subtitle={
            summary.tasksActive > 0
              ? `本週已完成 ${summary.tasksCompleted} / ${summary.tasksActive} 個任務`
              : '還沒有任務'
          }
          action={
            progress.length > 0 ? (
              <Button variant="secondary" className="h-10 px-4 text-xs" onClick={() => onNavigate('tasks')}>
                查看全部
                <ArrowRight size={14} strokeWidth={3} />
              </Button>
            ) : undefined
          }
        />
        {progress.length === 0 ? (
          <EmptyState
            bordered
            icon={<Target size={28} strokeWidth={1.5} />}
            title="還沒有每週任務"
            description="設一個目標，這裡就會出現你這一週的進度。"
            action={
              <Button variant="primary" className="h-11 px-5" onClick={() => onNavigate('tasks')}>
                <Plus size={15} strokeWidth={3} />
                建立每週任務
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {topTasks.map((entry) => (
              <button
                key={entry.task.taskId}
                onClick={() => onNavigate('tasks')}
                className="text-left bg-white rounded-[1.75rem] border border-island-line p-4 flex flex-col gap-3 transition-all hover:border-island-teal-light hover:-translate-y-0.5 active:scale-[0.98]"
              >
                <div className="flex items-baseline justify-between gap-2 min-w-0">
                  <span className="text-sm font-black text-island-navy truncate">{entry.task.name}</span>
                  <span className="text-xs font-black font-mono text-island-navy-soft/70 flex-shrink-0">
                    {entry.current} / {entry.target}
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-island-sand border border-island-line overflow-hidden">
                  <div
                    style={{ width: `${entry.ratio * 100}%` }}
                    className={`h-full rounded-full transition-[width] duration-500 ${
                      entry.completed ? 'bg-island-teal' : 'bg-island-teal-light'
                    }`}
                  />
                </div>
                <span className="text-[11px] font-bold text-island-navy-soft/70 truncate">
                  {entry.completed ? '本週目標已達成' : remainingLabel(entry.remaining)}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 近期活動摘要。 */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          icon={<CalendarCheck size={18} strokeWidth={2.5} />}
          title="最近的活動"
          subtitle={activities.length > 0 ? `共 ${activities.length} 筆紀錄` : undefined}
          action={
            activities.length > 0 ? (
              <Button variant="secondary" className="h-10 px-4 text-xs" onClick={() => onNavigate('history')}>
                查看紀錄
                <ArrowRight size={14} strokeWidth={3} />
              </Button>
            ) : undefined
          }
        />
        {loading ? null : activities.length === 0 ? (
          <EmptyState
            bordered
            icon={<Dumbbell size={28} strokeWidth={1.5} />}
            title="還沒有運動紀錄"
            description="去健身完成第一次運動，這裡就會開始記錄。"
            action={
              <Button variant="primary" className="h-11 px-5" onClick={() => setCurrentView(View.FITNESS)}>
                <Dumbbell size={15} strokeWidth={3} />
                前往健身
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {recent.map((activity) => (
              <li
                key={activity.activityId}
                className="bg-white rounded-2xl border border-island-line px-4 py-3 flex items-center gap-3"
              >
                <div className="w-9 h-9 rounded-xl bg-island-teal/10 border border-island-teal/25 text-island-teal-dark flex items-center justify-center flex-shrink-0">
                  <Dumbbell size={16} strokeWidth={2.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-island-navy truncate">{activity.type}</p>
                  <p className="text-[11px] font-bold text-island-navy-soft/70 truncate">
                    {dayHeading(activityCivilDate(activity), today, yesterday)} {activityTimeLabel(activity)}
                    {' · '}
                    {durationLabel(activity.durationSeconds)}
                  </p>
                </div>
                <span className="text-xs font-black font-mono text-island-navy-soft/70 flex-shrink-0">
                  {activity.reps} 下
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
