/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { motion } from 'motion/react';
import { Activity, ArrowRight, CalendarCheck, CalendarDays, Dumbbell, ListChecks, Target, TrendingUp, Trophy, Zap } from 'lucide-react';
import { Button } from '../UI/DesignKit';
import type { HealthActivity } from '../../lib/healthData';
import type { WeeklyHealthSummary, WeeklyTaskProgress } from '../../constants/weeklyTasks';
import type { WeeklyTaskRewardStatus } from '../../constants/weeklyTaskRewards';
import { TaskRewardSummary } from './TaskRewardStrip';
import type { HealthNavOptions, HealthPage } from './healthSections';
import type { HealthGoals } from './healthGoals';
import type { HealthSnapshot } from './useHealthSnapshot';
import { BigNumber, CardTitle, HealthCard, HEALTH_CARD } from './HealthChrome';
import { ActivityRings, BarChart, HBar, METRIC_STYLE, MonthDots, WeekPills } from './HealthCharts';
import { average, typeGlyph } from './healthStats';
import {
  activityCivilDate,
  activityTimeLabel,
  dayHeading,
  durationLabel,
  formatNumber,
  remainingLabel,
} from './healthFormat';

/**
 * 健康首頁 —— 「健康頁 V2」設計稿的卡片儀表板，換成島嶼的白底卡片與 teal／navy 色票。
 *
 * ## 同一份內容，三種排法
 *
 * 卡片的 DOM 順序就是手機上由上往下的閱讀順序（設計稿的順序）：今天 → 連續達標 → 我的趨勢 →
 * 這個月｜個人紀錄 → 每週任務 → 最近紀錄。
 *
 *  - **手機**（< 640px）：兩欄格線，但幾乎每張卡都跨兩欄，只有「這個月」與「個人紀錄」並排 ——
 *    兩張都是一個小圖加一個數字，各佔一半剛好。
 *  - **平板**（640–1023px）：同一個兩欄格線，卡片更寬，圓環與長條跟著放大。
 *  - **桌機**（≥ 1024px）：十二欄。「今天」佔左邊 7 欄、跨兩列，右邊疊著「連續達標」與「個人紀
 *    錄」；下面兩列是 7｜5 與 5｜7 交錯。桌機的位置用 `lg:row-start` 明確指定，而不是改 DOM 順序
 *    —— 改 DOM 順序會讓手機的閱讀順序跟著亂掉，也會讓鍵盤的 Tab 順序跟畫面對不起來。
 */
export function HealthHome({
  snapshot,
  goals,
  onNavigate,
  activities,
  progress,
  summary,
  rewardStatus = {},
  onStartWorkout,
}: {
  snapshot: HealthSnapshot;
  goals: HealthGoals;
  onNavigate: (page: HealthPage, options?: HealthNavOptions) => void;
  activities: readonly HealthActivity[];
  progress: readonly WeeklyTaskProgress[];
  summary: WeeklyHealthSummary;
  /** 每個任務的完成獎勵狀態（context/useWeeklyTasks.ts）。範例頁沒有就是空的，不畫獎勵。 */
  rewardStatus?: Record<string, WeeklyTaskRewardStatus>;
  onStartWorkout: () => void;
}) {
  const { today, yesterday, todayMinutes, todayReps, thisWeek, weeks, streak, month, bests } = snapshot;

  // 「重要提醒」= 還沒完成、而且本週快結束了的任務。只在真的有事時出現。
  const urgent = progress.filter((entry) => !entry.completed && entry.status === 'active' && entry.daysRemaining <= 2);

  const daysLeft = Math.max(0, goals.daysPerWeek - thisWeek.days);
  const minutesLeft = Math.max(0, goals.minutesPerDay - todayMinutes);

  // 趨勢卡：近 8 週的動作次數，強調上週（最後一個完整的週）。
  const reps = weeks.map((week) => week.reps);
  const lastWeek = reps[reps.length - 2] ?? 0;
  const pastAvg = Math.round(average(reps.slice(0, -1)));
  const trendSentence = trendHeadline(reps, lastWeek, pastAvg, thisWeek.reps);

  const topBest = bests.filter((entry) => entry.best).sort((a, b) => (b.best?.reps ?? 0) - (a.best?.reps ?? 0))[0];
  const recent = activities.slice(0, 5);
  const claimableCount = progress.filter((entry) => rewardStatus[entry.task.taskId]?.kind === 'claimable').length;

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      {urgent.length > 0 && (
        <motion.button
          type="button"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          // 帶著是哪幾個任務過去：任務頁會把它們捲到眼前並框起來。
          onClick={() => onNavigate('tasks', { focusTaskIds: urgent.map((entry) => entry.task.taskId) })}
          className="text-left rounded-[1.75rem] border border-island-teal/30 bg-island-teal/8 p-4 flex items-center gap-3 transition-all hover:-translate-y-0.5 active:scale-[0.98]"
        >
          <div className="w-10 h-10 rounded-xl bg-island-teal/15 border border-island-teal/30 text-island-teal-dark flex items-center justify-center flex-shrink-0">
            <Zap size={18} strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-island-navy truncate">
              {urgent.length === 1 ? `「${urgent[0].task.name}」還沒完成` : `有 ${urgent.length} 個任務還沒完成`}
            </p>
            <p className="text-[11px] font-bold text-island-navy-soft/70 truncate mt-0.5">{remainingLabel(urgent[0].remaining)}</p>
          </div>
          <ArrowRight size={18} strokeWidth={2.5} className="text-island-navy-soft/50 flex-shrink-0" />
        </motion.button>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-12 gap-3 sm:gap-4">
        {/* 今天 */}
        <HealthCard
          onClick={() => onNavigate('today')}
          label="今天，查看詳情"
          className="col-span-2 lg:col-span-7 lg:row-span-2 p-4 sm:p-5 lg:p-6 flex flex-col gap-3 lg:gap-5"
        >
          <CardTitle icon={<Activity size={15} strokeWidth={2.6} />} title="今天" trailing="詳情" />
          <div className="flex-1 flex items-center gap-4 sm:gap-8 lg:gap-10 lg:justify-center">
            <ActivityRings
              label={`今日運動 ${todayMinutes}/${goals.minutesPerDay} 分鐘，本週 ${thisWeek.days}/${goals.daysPerWeek} 天`}
              className="w-[42%] max-w-[150px] sm:w-40 sm:max-w-none lg:w-56"
              rings={[
                { ratio: todayMinutes / goals.minutesPerDay, color: METRIC_STYLE.minutes.color, track: METRIC_STYLE.minutes.track },
                { ratio: thisWeek.days / goals.daysPerWeek, color: METRIC_STYLE.days.color, track: METRIC_STYLE.days.track },
              ]}
            />
            <dl className="flex-1 min-w-0 flex flex-col gap-3 sm:gap-4 lg:gap-5">
              <RingStat label="運動時間" colorClass={METRIC_STYLE.minutes.text} value={todayMinutes} unit={`/${goals.minutesPerDay} 分`} />
              <RingStat
                label={daysLeft > 0 ? `本週 · 還差 ${daysLeft} 天` : '本週 · 已達標'}
                colorClass={METRIC_STYLE.days.text}
                value={thisWeek.days}
                unit={`/${goals.daysPerWeek} 天`}
              />
              <RingStat label="動作次數" colorClass={METRIC_STYLE.reps.text} value={formatNumber(todayReps)} unit=" 下" />
            </dl>
          </div>
          <p className="text-xs sm:text-sm font-bold text-island-navy-soft/70 border-t border-island-line pt-3">
            {minutesLeft > 0 ? `再動 ${minutesLeft} 分鐘，就完成今天的目標` : '今天的運動目標已經完成了'}
          </p>
        </HealthCard>

        {/* 連續達標 */}
        <HealthCard
          onClick={() => onNavigate('streak')}
          label={`連續達標 ${streak} 週，查看逐週紀錄`}
          className="col-span-2 lg:col-span-5 p-4 sm:p-5 flex flex-col justify-between gap-4 min-h-[124px]"
        >
          <CardTitle icon={<CalendarCheck size={15} strokeWidth={2.6} />} title="連續達標" accent="navy" trailing="逐週紀錄" />
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col gap-1.5 min-w-0">
              <BigNumber value={streak} unit=" 週" size="xl" />
              <span className="text-[11px] sm:text-xs font-bold text-island-navy-soft/70 truncate">每週運動 {goals.daysPerWeek} 天就延續</span>
            </div>
            <WeekPills weeks={weeks.map((week) => ({ met: week.days >= goals.daysPerWeek, current: week.current }))} />
          </div>
        </HealthCard>

        {/* 我的趨勢 */}
        <HealthCard
          onClick={() => onNavigate('trends')}
          label="我的趨勢，近 8 週"
          className="col-span-2 lg:col-span-7 lg:row-start-3 p-4 sm:p-5 flex flex-col gap-3"
        >
          <CardTitle icon={<TrendingUp size={15} strokeWidth={2.6} />} title="我的趨勢" trailing="近 8 週" />
          <p className="text-base sm:text-lg font-black text-island-navy leading-snug">{trendSentence}</p>
          <div className="mt-auto">
            <BarChart
              values={reps}
              height={96}
              color={METRIC_STYLE.reps.color}
              dim={METRIC_STYLE.reps.dim}
              selected={reps.length - 2}
              currentIndex={reps.length - 1}
              refValue={pastAvg}
              refLabel={pastAvg > 0 ? `平均 ${formatNumber(pastAvg)}` : undefined}
            />
          </div>
        </HealthCard>

        {/* 這個月 */}
        <HealthCard
          onClick={() => onNavigate('history')}
          label={`${month.month} 月已運動 ${month.activeDays} 天，查看運動月曆與紀錄`}
          className="col-span-1 lg:col-span-5 lg:row-start-3 p-3.5 sm:p-5 flex flex-col gap-3"
        >
          <CardTitle icon={<CalendarDays size={15} strokeWidth={2.6} />} title={`${month.month} 月`} accent="navy" />
          <div className="w-full sm:max-w-[260px] sm:mx-auto">
            <MonthDots cells={month.cells} />
          </div>
          <p className="mt-auto text-xs sm:text-sm font-bold text-island-navy-soft/70">
            已運動 <span className="font-black font-mono text-island-navy">{month.activeDays}</span> 天
          </p>
        </HealthCard>

        {/* 個人紀錄 */}
        <HealthCard
          onClick={() => onNavigate('records')}
          label="個人紀錄，查看各項目單次最佳"
          className="col-span-1 lg:col-span-5 lg:col-start-8 lg:row-start-2 p-3.5 sm:p-5 flex flex-col justify-between gap-3 lg:flex-row lg:items-center"
        >
          <div className="lg:hidden">
            <CardTitle icon={<Trophy size={15} strokeWidth={2.6} />} title="個人紀錄" />
          </div>
          <div className="flex items-center gap-3 lg:gap-4 min-w-0">
            <span className="w-14 h-14 lg:w-16 lg:h-16 rounded-full border-4 border-island-teal bg-island-teal/10 text-island-teal-dark flex items-center justify-center flex-shrink-0">
              <Trophy size={24} strokeWidth={2.2} />
            </span>
            <div className="hidden lg:flex flex-col gap-1 min-w-0">
              <span className="text-[15px] font-black text-island-navy">個人紀錄</span>
              <span className="text-xs font-bold text-island-navy-soft/70">單次最多動作</span>
            </div>
          </div>
          <div className="flex flex-col gap-1 min-w-0 lg:items-end">
            <span className="text-xs sm:text-[13px] font-bold text-island-navy-soft/70 truncate">
              {topBest?.best ? `${topBest.type} · ${topBest.fresh ? '新紀錄' : '單次最多'}` : '還沒有紀錄'}
            </span>
            <BigNumber value={topBest?.best ? topBest.best.reps : '—'} unit={topBest?.best ? ' 下' : undefined} size="md" />
          </div>
        </HealthCard>

        {/* 每週任務 */}
        <HealthCard
          onClick={() => onNavigate('tasks')}
          label="每週任務"
          className="col-span-2 lg:col-span-5 lg:row-start-4 p-4 sm:p-5 flex flex-col gap-3"
        >
          <CardTitle
            icon={<Target size={15} strokeWidth={2.6} />}
            title="每週任務"
            trailing={
              claimableCount > 0
                ? `${claimableCount} 個獎勵可領`
                : summary.tasksActive > 0
                  ? `${summary.tasksCompleted}/${summary.tasksActive} 完成`
                  : '建立'
            }
          />
          {progress.length === 0 ? (
            <p className="text-sm font-bold text-island-navy-soft/70 leading-relaxed">
              設一個每週目標（例如「每週深蹲 3 次」），這裡就會出現本週的進度。
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {progress.slice(0, 3).map((entry) => {
                const reward = rewardStatus[entry.task.taskId];
                // 能領／領過了是一顆徽章，跟名字同一行；還沒完成的是一小排獎勵圖示，放在進度條下面
                // —— 「做到哪了」緊接著「做完拿什麼」，跟任務頁的卡片同一個順序。
                const badge = reward && (reward.kind === 'claimable' || reward.kind === 'claimed');
                return (
                  <li key={entry.task.taskId} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <span className="text-sm font-black text-island-navy truncate">{entry.task.name}</span>
                      <span className="flex items-center gap-2 flex-shrink-0">
                        {badge && <TaskRewardSummary status={reward} />}
                        <span className="text-xs font-black font-mono text-island-navy-soft/70">
                          {entry.current} / {entry.target}
                          {entry.spec ? ` ${entry.spec.unit}` : ''}
                        </span>
                      </span>
                    </div>
                    <HBar
                      ratio={entry.ratio}
                      color={entry.completed ? 'var(--color-island-teal)' : 'var(--color-island-teal-light)'}
                      track="var(--color-island-sand)"
                    />
                    {reward && !badge && <TaskRewardSummary status={reward} />}
                  </li>
                );
              })}
            </ul>
          )}
        </HealthCard>

        {/* 最近紀錄。裡面有按鈕，所以它本身不是按鈕。 */}
        <section
          aria-label="最近紀錄"
          className={`${HEALTH_CARD} col-span-2 lg:col-span-7 lg:col-start-6 lg:row-start-4 px-4 sm:px-5 py-2 flex flex-col`}
        >
          <div className="h-12 flex items-center justify-between gap-2">
            <CardTitle icon={<ListChecks size={15} strokeWidth={2.6} />} title="最近紀錄" accent="navy" chevron={false} />
            {activities.length > 0 && (
              <button
                type="button"
                onClick={() => onNavigate('history')}
                className="min-h-11 px-2 -mr-2 flex items-center gap-0.5 text-sm font-bold text-island-teal-dark hover:text-island-teal"
              >
                全部
                <ArrowRight size={14} strokeWidth={2.8} />
              </button>
            )}
          </div>
          {recent.length === 0 ? (
            <div className="py-6 flex flex-col items-center text-center gap-3 border-t border-island-line">
              <p className="text-sm font-bold text-island-navy-soft/70">還沒有運動紀錄，去健身完成第一次運動吧。</p>
              <Button variant="primary" className="h-11 px-5" onClick={onStartWorkout}>
                <Dumbbell size={15} strokeWidth={3} />
                前往健身
              </Button>
            </div>
          ) : (
            <ul>
              {recent.map((activity, i) => (
                <li
                  key={activity.activityId}
                  className={`h-16 flex items-center gap-3 border-t border-island-line ${i >= 4 ? 'hidden lg:flex' : ''}`}
                >
                  <span className="w-10 h-10 rounded-xl bg-island-cream-2 border border-island-line text-island-teal-dark text-base font-black flex items-center justify-center flex-shrink-0">
                    {typeGlyph(activity.type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-black text-island-navy truncate">{activity.type}</p>
                    <p className="text-xs font-bold text-island-navy-soft/70 truncate">
                      {dayHeading(activityCivilDate(activity), today, yesterday)} {activityTimeLabel(activity)} · {durationLabel(activity.durationSeconds)}
                    </p>
                  </div>
                  <BigNumber value={formatNumber(activity.reps)} unit=" 下" size="sm" />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** 圓環旁邊的一個數字：彩色小標題＋大數字。 */
function RingStat({ label, colorClass, value, unit }: { label: string; colorClass: string; value: React.ReactNode; unit: string }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <dt className={`text-xs sm:text-[13px] font-black truncate ${colorClass}`}>{label}</dt>
      <dd>
        <BigNumber value={value} unit={unit} size="md" />
      </dd>
    </div>
  );
}

/** 趨勢卡那一句話。只講一件事，而且講的是真的：沒資料就不說「進步了」。 */
function trendHeadline(reps: number[], lastWeek: number, pastAvg: number, thisWeekReps: number): string {
  if (reps.every((value) => value === 0)) return '開始運動之後，這裡會畫出你每週的變化';
  if (lastWeek === 0) {
    return thisWeekReps > 0 ? `本週已經做了 ${formatNumber(thisWeekReps)} 下動作` : '上週休息了，這週動起來吧';
  }
  if (lastWeek >= Math.max(...reps)) return `上週做了 ${formatNumber(lastWeek)} 下動作，是近 8 週最多的一週`;
  if (lastWeek > pastAvg) return `上週做了 ${formatNumber(lastWeek)} 下動作，比平均多 ${formatNumber(lastWeek - pastAvg)} 下`;
  return `上週做了 ${formatNumber(lastWeek)} 下動作，平均每週 ${formatNumber(pastAvg)} 下`;
}
