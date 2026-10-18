/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, type ReactNode } from 'react';
import { Dumbbell } from 'lucide-react';
import type { HealthActivity } from '../../lib/healthData';
import { Button } from '../UI/DesignKit';
import type { HealthGoals } from './healthGoals';
import type { HealthSnapshot } from './useHealthSnapshot';
import { BigNumber, HEALTH_CARD } from './HealthChrome';
import { ActivityRings, BarChart, CATEGORY_COLORS, DayTimeline, METRIC_STYLE } from './HealthCharts';
import { daySpans, typeGlyph } from './healthStats';
import { activityTimeLabel, durationLabel, formatNumber } from './healthFormat';

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

/**
 * 「今天」—— 首頁第一張卡片點進來的畫面。回答「今天動了多少、還差多少」。
 *
 * ## 三層
 *
 *  1. **今日摘要**（左欄，手機最上面）：兩個圓環，旁邊是它們的圖例 —— 外圈是今天的分鐘、內圈是
 *     本週的天數，各自寫著還差多少。圓心是今天的動作次數（沒有圓環的那個量），所以三個數字各出現
 *     一次。「前往健身」也在這張卡上：看完「還差 14 分」，下一步就在手邊，不用捲到頁尾。
 *  2. **本週每天**：內圈的細節 —— 週一到週日每天動了幾分鐘，對著每日目標那條線。今天放在這一週裡
 *     看，才知道「6 分鐘」是偏少還是平常。
 *  3. **今天的運動**：什麼時候動的（時間軸）、做了哪些項目（小計）、每一次的明細。
 *
 * 第三層曾經是三張卡：每小時分鐘的 24 根長條、項目分布、每一次的清單。一天通常只有一兩次運動，
 * 24 根長條裡 22 根是空的，而只做一個項目時「分布」是一條 100% 的條 —— 三張卡、三倍的外框，講
 * 的是同一兩筆紀錄。合成一張之後，時間軸與項目小計用同一組顏色，清單是它們的明細。
 *
 * 桌機是左 5／右 7 兩欄，左欄 sticky；兩欄的高度差不多，所以不會有一邊空掉半頁。
 */
export function HealthTodayPage({
  snapshot,
  goals,
  onStartWorkout,
}: {
  snapshot: HealthSnapshot;
  goals: HealthGoals;
  /** 舊版（legacy/）的今天頁也是這一頁，所以介面維持不變。今天的紀錄已經在 snapshot 裡。 */
  activities: readonly HealthActivity[];
  onStartWorkout: () => void;
}) {
  const { todayMinutes, todayReps, todayActivities, thisWeek, weekDays } = snapshot;

  const minutesLeft = Math.max(0, goals.minutesPerDay - todayMinutes);
  const daysLeft = Math.max(0, goals.daysPerWeek - thisWeek.days);

  // 今天每個項目的小計，多的在前。時間軸、小計與清單用同一個順序取顏色。
  const typeTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const activity of todayActivities) totals.set(activity.type, (totals.get(activity.type) ?? 0) + Math.max(0, activity.reps));
    return [...totals.entries()].map(([type, reps]) => ({ type, reps })).sort((a, b) => b.reps - a.reps);
  }, [todayActivities]);
  const colorOf = (type: string) => {
    const i = typeTotals.findIndex((entry) => entry.type === type);
    return CATEGORY_COLORS[Math.max(0, i) % CATEGORY_COLORS.length];
  };
  const spans = daySpans(todayActivities).map(({ activity, from, to }) => ({
    from,
    to,
    color: colorOf(activity.type),
    title: `${activityTimeLabel(activity)} ${activity.type} ${durationLabel(activity.durationSeconds)}`,
  }));

  const todayIndex = weekDays.findIndex((day) => day.today);
  const weekMinutes = weekDays.reduce((sum, day) => sum + day.minutes, 0);
  const goalDays = weekDays.filter((day) => day.minutes >= goals.minutesPerDay).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4 items-start">
      {/* 第一層：今日摘要 */}
      <section
        aria-label="今日摘要"
        className={`${HEALTH_CARD} lg:col-span-5 lg:sticky lg:top-4 p-5 sm:p-6 flex flex-col gap-5`}
      >
        <div className="flex flex-col sm:flex-row lg:flex-col items-center gap-5 sm:gap-8 lg:gap-6">
          <ActivityRings
            label={`今日運動 ${todayMinutes}/${goals.minutesPerDay} 分鐘，本週 ${thisWeek.days}/${goals.daysPerWeek} 天`}
            size={210}
            stroke={24}
            className="w-44 sm:w-52 lg:w-60"
            rings={[
              { ratio: todayMinutes / goals.minutesPerDay, color: METRIC_STYLE.minutes.color, track: METRIC_STYLE.minutes.track },
              { ratio: thisWeek.days / goals.daysPerWeek, color: METRIC_STYLE.days.color, track: METRIC_STYLE.days.track },
            ]}
          >
            <span className="text-3xl sm:text-4xl font-black font-mono text-island-navy leading-none">{formatNumber(todayReps)}</span>
            <span className={`text-xs font-black mt-1 ${METRIC_STYLE.reps.text}`}>今日動作次數</span>
          </ActivityRings>
          <div className="w-full sm:flex-1 lg:flex-none flex flex-col">
            <RingLegend
              color={METRIC_STYLE.minutes.color}
              label="外圈 · 今日運動時間"
              value={todayMinutes}
              unit={`/${goals.minutesPerDay} 分`}
              note={minutesLeft > 0 ? `還差 ${minutesLeft} 分` : '已達標'}
              done={minutesLeft === 0}
            />
            <RingLegend
              color={METRIC_STYLE.days.color}
              label="內圈 · 本週運動天數"
              value={thisWeek.days}
              unit={`/${goals.daysPerWeek} 天`}
              note={daysLeft > 0 ? `還差 ${daysLeft} 天` : '已達標'}
              done={daysLeft === 0}
              divider
            />
          </div>
        </div>
        <Button variant="primary" className="h-14 w-full text-base" onClick={onStartWorkout}>
          <Dumbbell size={18} strokeWidth={2.8} />
          {minutesLeft > 0 ? `再練 ${minutesLeft} 分鐘，完成今日目標` : '今日目標已完成，再去動一動'}
        </Button>
      </section>

      <div className="lg:col-span-7 flex flex-col gap-3 sm:gap-4">
        {/* 第二層：本週每天 —— 內圈的細節。 */}
        <section aria-label="本週每天" className={`${HEALTH_CARD} p-4 sm:p-5 flex flex-col gap-3`}>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[15px] font-black text-island-navy">本週每天</h3>
            <span className="text-xs font-bold text-island-navy-soft/70">每天運動分鐘</span>
          </div>
          <BarChart
            values={weekDays.map((day) => day.minutes)}
            height={112}
            color={METRIC_STYLE.minutes.color}
            dim={METRIC_STYLE.minutes.dim}
            selected={todayIndex}
            currentIndex={todayIndex}
            futureFrom={todayIndex + 1}
            refValue={goals.minutesPerDay}
            refLabel={`目標 ${goals.minutesPerDay} 分`}
            labels={weekDays.map((day, i) => (day.today ? '今天' : WEEKDAY_LABELS[i]))}
            ariaLabels={weekDays.map((day, i) => `星期${WEEKDAY_LABELS[i]} ${day.future ? '還沒到' : `${day.minutes} 分`}`)}
          />
          <p className="text-xs sm:text-sm font-bold text-island-navy-soft/70 border-t border-island-line pt-3">
            {weekMinutes === 0 ? (
              '本週還沒有運動紀錄'
            ) : (
              <>
                本週合計 <b className="font-black font-mono text-island-navy">{formatNumber(weekMinutes)}</b> 分 ·{' '}
                <b className="font-black font-mono text-island-navy">{goalDays}</b> 天達到每日 {goals.minutesPerDay} 分
              </>
            )}
          </p>
        </section>

        {/* 第三層：今天的運動 —— 時間軸、項目小計、每一次。 */}
        <section aria-label="今天的運動" className={`${HEALTH_CARD} p-4 sm:p-5 flex flex-col gap-3`}>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[15px] font-black text-island-navy">今天的運動</h3>
            {todayActivities.length > 0 && (
              <span className="text-xs font-bold text-island-navy-soft/70">
                <span className="font-black font-mono text-island-navy">{todayActivities.length}</span> 次
              </span>
            )}
          </div>
          <DayTimeline
            spans={spans}
            label={
              spans.length === 0
                ? '今天還沒有運動'
                : `今天運動的時段：${todayActivities.map((activity) => `${activityTimeLabel(activity)} ${activity.type}`).join('、')}`
            }
          />
          {typeTotals.length > 0 && (
            <ul aria-label="今天各項目的動作次數" className="flex flex-wrap gap-2">
              {typeTotals.map((entry) => (
                <li
                  key={entry.type}
                  className="h-8 max-w-full px-3 rounded-full bg-island-cream-2 border border-island-line flex items-center gap-1.5 text-xs font-bold text-island-navy-soft"
                >
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: colorOf(entry.type) }} />
                  <span className="truncate text-island-navy">{entry.type}</span>
                  <span className="font-black font-mono text-island-navy flex-shrink-0">{formatNumber(entry.reps)}</span>
                  <span className="flex-shrink-0">下</span>
                </li>
              ))}
            </ul>
          )}
          {todayActivities.length === 0 ? (
            <p className="text-sm font-bold text-island-navy-soft/70 leading-relaxed">
              今天還沒有運動紀錄。完成一次健身之後，這裡會標出你什麼時候動的、做了哪些動作。
            </p>
          ) : (
            <ul className="-mb-2">
              {todayActivities.map((activity) => (
                <li key={activity.activityId} className="h-16 flex items-center gap-3 border-t border-island-line">
                  <span className="w-12 text-sm font-black font-mono text-island-navy-soft/70 flex-shrink-0">{activityTimeLabel(activity)}</span>
                  <span
                    className="w-9 h-9 rounded-xl border border-island-line text-island-navy text-sm font-black flex items-center justify-center flex-shrink-0"
                    style={{ background: `color-mix(in srgb, ${colorOf(activity.type)} 16%, white)` }}
                  >
                    {typeGlyph(activity.type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-black text-island-navy truncate">{activity.type}</p>
                    <p className="text-xs font-bold text-island-navy-soft/70 truncate">{durationLabel(activity.durationSeconds)}</p>
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

/** 圓環的圖例：色點＋哪一圈、目前／目標、還差多少。 */
function RingLegend({
  color,
  label,
  value,
  unit,
  note,
  done,
  divider = false,
}: {
  color: string;
  label: string;
  value: ReactNode;
  unit: string;
  note: string;
  done: boolean;
  divider?: boolean;
}) {
  return (
    <div className={`py-3 flex items-center gap-3 min-w-0 ${divider ? 'border-t border-island-line' : ''}`}>
      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <p className="text-xs font-bold text-island-navy-soft/70 truncate">{label}</p>
        <div>
          <BigNumber value={value} unit={unit} size="md" />
        </div>
      </div>
      <span
        className={`h-7 px-2.5 rounded-lg text-xs font-black flex items-center flex-shrink-0 ${
          done ? 'bg-island-teal/12 text-island-teal-dark' : 'bg-island-cream-2 text-island-navy-soft border border-island-line'
        }`}
      >
        {note}
      </span>
    </div>
  );
}
