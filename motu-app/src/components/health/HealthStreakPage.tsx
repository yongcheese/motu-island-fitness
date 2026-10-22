/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Check, CalendarCheck, CalendarDays, Flame, Target } from 'lucide-react';
import { addCivilDays, civilDaysBetween, type CivilDate } from '../../constants/civilTime';
import { DAYS_PER_WEEK, weekStartFor } from '../../constants/weeklyTasks';
import { ACTIVITY_FETCH_LIMIT } from '../../lib/healthData';
import { Button } from '../UI/DesignKit';
import type { HealthGoals } from './healthGoals';
import type { HealthSnapshot } from './useHealthSnapshot';
import { BigNumber, HEALTH_CARD } from './HealthChrome';
import { MonthDots } from './HealthCharts';
import { STREAK_WEEKS, type DayTotals, type MonthCell } from './healthStats';
import { cycleRangeLabel, shortDate } from './healthFormat';

/**
 * 「連續達標」—— 首頁「連續達標」卡點進來的畫面。
 *
 * 玩家點這張卡想知道三件事，依序就是這一頁由上往下的順序：
 *
 *  1. **現在連續幾週、這週能不能延續** —— 左邊（手機是最上面）的大數字，加上一句「再 N 天就延
 *     續」，以及本週七天哪幾天動過了。緊接著是兩個摘要數字：最長連續、單週最多天數 —— 拿來跟
 *     「現在」比。
 *  2. **哪幾週達標、從哪一週斷掉** —— 逐週列表（桌機的右欄）。首頁那排沒有日期的膠囊，在這裡每
 *     一顆都有日期、天數與當週哪幾天有動。
 *  3. **規則是什麼、怎麼改** —— 最下面（桌機是左欄最下面），附一顆「調整每週目標」打開同一個目
 *     標抽屜。
 *
 * 全部的數字都來自 useHealthSnapshot（跟首頁同一份），這一頁不自己算連續週數。
 */
export function HealthStreakPage({
  snapshot,
  goals,
  onEditGoals,
}: {
  snapshot: HealthSnapshot;
  goals: HealthGoals;
  onEditGoals: () => void;
}) {
  const { today, byDay, thisWeek, streak, longestStreak, bestWeek, streakWeeks, mayBeTruncated } = snapshot;
  const goal = goals.daysPerWeek;

  const weekStart = weekStartFor(today);
  const daysLeft = DAYS_PER_WEEK - civilDaysBetween(weekStart, today); // 含今天
  const todayActive = (byDay.get(today)?.sessions ?? 0) > 0;
  const need = Math.max(0, goal - thisWeek.days);
  const possible = daysLeft - (todayActive ? 1 : 0);
  const status = weekStatus({ need, possible, days: thisWeek.days, streak, daysLeft, todayActive });

  const weekCells: MonthCell[] = Array.from({ length: DAYS_PER_WEEK }, (_, i) => {
    const date = addCivilDays(weekStart, i);
    return {
      date,
      day: Number(date.slice(8, 10)),
      active: (byDay.get(date)?.sessions ?? 0) > 0,
      today: date === today,
      future: civilDaysBetween(today, date) > 0,
    };
  });

  const rows = [...streakWeeks].reverse(); // 新的在上面
  // 桌機上「怎麼計算」放哪一欄，看逐週列表有多長：列表短（剛開始運動的前幾週）就接在它下面，列表
  // 長就放到左欄。哪一種放法都會讓另一種情況的其中一欄空掉一大段 —— 8 週大約是兩欄等高的那一點。
  const rulesBelowList = rows.length < 8;

  const rules = (
    <section
      aria-label="怎麼計算"
      className={`${HEALTH_CARD} ${rulesBelowList ? '' : 'lg:col-span-5 lg:row-start-3'} p-4 sm:p-5 flex flex-col gap-3`}
    >
      <h3 className="text-[15px] font-black text-island-navy">怎麼計算</h3>
      <ul className="flex flex-col gap-1.5 text-xs sm:text-sm font-bold text-island-navy-soft leading-relaxed list-disc pl-5">
        <li>以週計算，週一開始、週日結束。一週有 {goal} 天以上運動就算達標。</li>
        <li>同一天運動好幾次，只算一天。</li>
        <li>本週還沒結束時只會加、不會扣：還沒達標的話，連續紀錄先算到上週為止。</li>
      </ul>
      <Button variant="secondary" className="h-11 px-4 text-sm self-start" onClick={onEditGoals}>
        <Target size={16} strokeWidth={2.6} />
        調整每週目標
      </Button>
    </section>
  );

  return (
    // 桌機：左欄是「現在」與摘要（目前連續 → 兩個紀錄），右欄是逐週列表；規則放哪一欄見上面的
    // `rulesBelowList`。DOM 順序就是手機由上往下的順序（現在 → 紀錄 → 逐週 → 規則），桌機用
    // row／col-start 擺位置而不改 DOM，Tab 順序才不會跟畫面對不起來。最後一列是 `1fr`：右欄比左欄
    // 高出來的那一段由它吃掉，而不是平均撐開左欄卡片之間的縫。
    //
    // 兩個紀錄曾經放在右欄逐週列表的下面：左欄一張卡、右欄三張，桌機左下空了大半頁。
    <div className="grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-[auto_auto_1fr] gap-3 sm:gap-4 items-start">
      <section
        aria-label="目前連續達標"
        className={`${HEALTH_CARD} lg:col-span-5 lg:row-start-1 p-5 sm:p-6 flex flex-col gap-5`}
      >
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-1.5 min-w-0">
            <span className="text-sm font-bold text-island-navy-soft/70">目前連續達標</span>
            <BigNumber value={streak} unit=" 週" size="xl" />
          </div>
          <span className="w-12 h-12 rounded-2xl bg-island-navy/8 border border-island-navy/15 text-island-navy flex items-center justify-center flex-shrink-0">
            <Flame size={22} strokeWidth={2.4} />
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-base sm:text-lg font-black text-island-navy leading-snug">{status.headline}</p>
          <p className="text-xs sm:text-sm font-bold text-island-navy-soft/70 leading-relaxed">{status.detail}</p>
        </div>

        <div className="flex flex-col gap-2.5 border-t border-island-line pt-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-black text-island-navy">本週</span>
            <span className="text-xs font-bold text-island-navy-soft/70">
              <span className="font-black font-mono text-island-navy">{thisWeek.days}</span> / {goal} 天
            </span>
          </div>
          <MonthDots cells={weekCells} showHeads />
        </div>
      </section>

      <section aria-label="連續達標的紀錄" className={`${HEALTH_CARD} lg:col-span-5 lg:row-start-2 px-4 sm:px-5 py-1`}>
        <RecordRow
          icon={<CalendarCheck size={20} strokeWidth={2.4} />}
          title="最長連續達標"
          note={
            longestStreak === 0
              ? '還沒有達標過的週'
              : streak > 0 && streak >= longestStreak
                ? '就是現在這一段'
                : mayBeTruncated
                  ? `最近 ${ACTIVITY_FETCH_LIMIT} 次運動裡最長的一段`
                  : '紀錄裡最長的一段'
          }
          value={longestStreak}
          unit=" 週"
        />
        <RecordRow
          icon={<CalendarDays size={20} strokeWidth={2.4} />}
          title="單週最多運動天數"
          note={bestWeek ? `${cycleRangeLabel(bestWeek.weekStart, addCivilDays(bestWeek.weekStart, DAYS_PER_WEEK - 1))} 那一週` : '還沒有紀錄'}
          value={bestWeek?.days ?? 0}
          unit=" 天"
          divider
        />
      </section>

      {/* 右欄。規則接在逐週列表下面的時候也在這一欄裡，才會緊貼著列表，而不是落到左欄最低的那一列之後。 */}
      <div className="lg:col-span-7 lg:col-start-6 lg:row-start-1 lg:row-span-3 flex flex-col gap-3 sm:gap-4">
        <section aria-label="逐週紀錄" className={`${HEALTH_CARD} px-4 sm:px-5 pt-4 pb-2 flex flex-col`}>
          <div className="flex items-baseline justify-between gap-2 pb-2">
            <h3 className="text-[15px] font-black text-island-navy">逐週紀錄</h3>
            <span className="text-xs font-bold text-island-navy-soft/70">每週運動 {goal} 天算達標</span>
          </div>
          <ul>
            {rows.map((week) => (
              <WeekRow key={week.weekStart} weekStart={week.weekStart} days={week.days} current={week.current} goal={goal} byDay={byDay} today={today} />
            ))}
          </ul>
          {(rows.length < STREAK_WEEKS || mayBeTruncated) && (
            <p className="text-[11px] font-bold text-island-navy-soft/60 border-t border-island-line py-3">
              {mayBeTruncated
                ? `只計算最近 ${ACTIVITY_FETCH_LIMIT} 次運動，更早的週不列出。`
                : byDay.size === 0
                  ? '完成第一次運動之後，這裡會一週一週列出來。'
                  : '從你第一次運動的那一週開始列。'}
            </p>
          )}
        </section>

        {rulesBelowList && rules}
      </div>
      {!rulesBelowList && rules}
    </div>
  );
}

/** 本週那一句話。只講真的：天數不夠了就直說，不說「加油還有機會」。 */
function weekStatus({
  need,
  possible,
  days,
  streak,
  daysLeft,
  todayActive,
}: {
  need: number;
  possible: number;
  days: number;
  streak: number;
  daysLeft: number;
  todayActive: boolean;
}): { headline: string; detail: string } {
  if (need === 0) {
    return {
      headline: '本週已達標',
      detail: streak > 1 ? `連續紀錄延續到第 ${streak} 週。` : '本週算進連續紀錄了，下週繼續就會累積。',
    };
  }
  if (need > possible) {
    return {
      headline: '本週剩下的天數不夠達標了',
      detail: streak > 0 ? `連續紀錄會停在 ${streak} 週，下週一重新開始累積。` : '下週一重新開始累積。',
    };
  }
  return {
    headline: `本週已運動 ${days} 天，再 ${need} 天就${streak > 0 ? '延續' : '達標'}`,
    detail: todayActive
      ? `今天已經算進去了，本週還剩 ${daysLeft - 1} 天。`
      : `本週還剩 ${daysLeft} 天（含今天）。`,
  };
}

/** 逐週列表的一列：日期、當週七天哪幾天有動、天數與達標狀態。 */
function WeekRow({
  weekStart,
  days,
  current,
  goal,
  byDay,
  today,
}: {
  weekStart: CivilDate;
  days: number;
  current: boolean;
  goal: number;
  byDay: Map<CivilDate, DayTotals>;
  today: CivilDate;
}) {
  const met = days >= goal;
  const label = current ? '本週' : `${shortDate(weekStart)} 那週`;
  const state = met ? '達標' : current ? '進行中' : '未達標';
  return (
    <li
      aria-label={`${label}，運動 ${days} 天，${state}`}
      className="min-h-14 py-2 flex items-center gap-3 border-t border-island-line"
    >
      <span className={`w-16 sm:w-20 text-sm flex-shrink-0 ${current ? 'font-black text-island-navy' : 'font-bold text-island-navy-soft'}`}>
        {current ? '本週' : shortDate(weekStart)}
      </span>
      <span className="flex-1 min-w-0 flex items-center gap-1 sm:gap-1.5" aria-hidden="true">
        {Array.from({ length: DAYS_PER_WEEK }, (_, i) => {
          const date = addCivilDays(weekStart, i);
          const active = (byDay.get(date)?.sessions ?? 0) > 0;
          const future = civilDaysBetween(today, date) > 0;
          return (
            <span
              key={i}
              className={`w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full flex-shrink-0 ${
                active ? 'bg-island-teal' : future ? 'border border-dashed border-island-navy/25' : 'bg-island-sand'
              }`}
            />
          );
        })}
      </span>
      <span className="w-10 text-right text-sm font-black font-mono text-island-navy flex-shrink-0">
        {days}
        <span className="text-[11px] font-bold font-sans text-island-navy-soft/70"> 天</span>
      </span>
      <span
        className={`w-[4.5rem] h-7 rounded-lg text-[11px] font-black inline-flex items-center justify-center gap-0.5 flex-shrink-0 ${
          met
            ? 'bg-island-navy text-white'
            : current
              ? 'border-2 border-dashed border-island-navy/40 text-island-navy-soft'
              : 'bg-island-sand text-island-navy-soft/70'
        }`}
      >
        {met && <Check size={12} strokeWidth={3} />}
        {state}
      </span>
    </li>
  );
}

function RecordRow({
  icon,
  title,
  note,
  value,
  unit,
  divider = false,
}: {
  icon: React.ReactNode;
  title: string;
  note: string;
  value: React.ReactNode;
  unit: string;
  divider?: boolean;
}) {
  return (
    <div className={`h-[72px] flex items-center gap-3 ${divider ? 'border-t border-island-line' : ''}`}>
      <span className="w-10 h-10 rounded-xl bg-island-cream-2 border border-island-line text-island-teal-dark flex items-center justify-center flex-shrink-0">
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-black text-island-navy truncate">{title}</p>
        <p className="text-xs font-bold text-island-navy-soft/70 truncate">{note}</p>
      </div>
      <span className="text-xl sm:text-2xl font-black font-mono text-island-navy flex-shrink-0">
        {value}
        <span className="text-sm font-bold font-sans text-island-navy-soft/70">{unit}</span>
      </span>
    </div>
  );
}
