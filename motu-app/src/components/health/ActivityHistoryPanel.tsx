/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from 'react';
import { CalendarCheck, ChevronLeft, ChevronRight, Dumbbell, TrendingUp, X } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { Button, EmptyState } from '../UI/DesignKit';
import { SectionHeading, StateNotice } from './HealthChrome';
import { MonthDots } from './HealthCharts';
import {
  activityCivilDate,
  activityTimeLabel,
  dayHeading,
  durationLabel,
  formatNumber,
} from './healthFormat';
import { monthCells, monthStart, totalsByDay } from './healthStats';
import { addCivilDays, civilDateAt, civilDaysBetween, type CivilDate } from '../../constants/civilTime';
import { distinctTypes } from './healthSections';
import { ACTIVITY_FETCH_LIMIT, type HealthActivity } from '../../lib/healthData';

/** 健康頁裡的「活動紀錄」：讀 context，畫 {@link ActivityHistory}。 */
export function ActivityHistoryPanel() {
  const { weeklyTaskView, setCurrentView } = useApp();
  const { activities, loading, error } = weeklyTaskView;
  return (
    <ActivityHistory
      activities={activities}
      loading={loading}
      error={error}
      onStartWorkout={() => setCurrentView(View.FITNESS)}
    />
  );
}

/**
 * 「活動紀錄」—— 過去的運動，以月曆為入口。
 *
 * 首頁有兩個入口進到這裡：「N 月」那張月曆卡，與「最近紀錄 › 全部」。兩個都是在問「我過去做了什
 * 麼」，所以共用這一頁；而月曆就是回答這個問題最直接的索引 —— 先看哪幾天有動，點一天看那天做了
 * 什麼。由上往下：
 *
 *  1. **月曆**（可以往前翻月份）。有運動的日子是可以點的按鈕。
 *  2. **清單**：預設是整個月、依日分組；點了某一天就只剩那一天。
 *  3. **最近 14 天每日動作次數**：次要，放最後（桌機放在月曆下面）。
 *
 * 項目篩選放在最上面，三塊都吃它 —— 篩「深蹲」之後，月曆上亮的就是有做深蹲的日子。
 *
 * 分組是在**遊戲時區**做的（healthFormat 的 `activityCivilDate`），不是 `toLocaleDateString()`：
 * 一筆晚上 11 點的紀錄會不會被分到隔天，不該取決於玩家的筆電設在哪一個時區。
 *
 * 不碰 context，所以範例頁（tmp-health.tsx）可以用假資料畫它。
 */
export function ActivityHistory({
  activities,
  loading,
  error,
  onStartWorkout,
}: {
  activities: readonly HealthActivity[];
  loading: boolean;
  error: boolean;
  onStartWorkout: () => void;
}) {
  const today = civilDateAt(new Date());
  const yesterday = addCivilDays(today, -1);
  const thisMonth = monthStart(Number(today.slice(0, 4)), Number(today.slice(5, 7)));

  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [shownMonth, setShownMonth] = useState<CivilDate>(thisMonth);
  const [selectedDay, setSelectedDay] = useState<CivilDate | null>(null);

  const types = useMemo(() => distinctTypes(activities), [activities]);
  const filtered = useMemo(
    () => (typeFilter ? activities.filter((activity) => activity.type === typeFilter) : activities),
    [activities, typeFilter],
  );

  // 月曆能往前翻到哪：最早一筆紀錄的那個月（不看篩選 —— 換個篩選不該讓已經翻到的月份消失）。
  const earliestMonth = useMemo(() => {
    const last = activities[activities.length - 1];
    if (!last) return thisMonth;
    const day = activityCivilDate(last);
    return monthStart(Number(day.slice(0, 4)), Number(day.slice(5, 7)));
  }, [activities, thisMonth]);

  const byDay = useMemo(() => totalsByDay(filtered), [filtered]);
  const month = useMemo(() => monthCells(byDay, today, shownMonth), [byDay, today, shownMonth]);
  const monthPrefix = shownMonth.slice(0, 7);
  const monthActivities = useMemo(
    () => filtered.filter((activity) => activityCivilDate(activity).startsWith(monthPrefix)),
    [filtered, monthPrefix],
  );
  const listed = useMemo(
    () => (selectedDay ? monthActivities.filter((activity) => activityCivilDate(activity) === selectedDay) : monthActivities),
    [monthActivities, selectedDay],
  );

  /** 依日分組，由新到舊。`activities` 已經排序過，所以這裡只需要一次走訪。 */
  const groups = useMemo(() => {
    const grouped = new Map<CivilDate, HealthActivity[]>();
    for (const activity of listed) {
      const day = activityCivilDate(activity);
      const bucket = grouped.get(day);
      if (bucket) bucket.push(activity);
      else grouped.set(day, [activity]);
    }
    return [...grouped.entries()];
  }, [listed]);

  const listTotals = useMemo(() => sumUp(listed), [listed]);

  /** 每日總動作次數，最近 14 天。圖表的 x 軸是日期而不是「第幾次」。 */
  const chartFrom = addCivilDays(today, -13);
  const recent = useMemo(
    () =>
      filtered.filter((activity) => {
        const day = activityCivilDate(activity);
        return civilDaysBetween(chartFrom, day) >= 0 && civilDaysBetween(day, today) >= 0;
      }),
    [filtered, chartFrom, today],
  );
  const chartData = useMemo(() => {
    const totals = new Map<CivilDate, number>();
    for (const activity of recent) {
      const day = activityCivilDate(activity);
      totals.set(day, (totals.get(day) ?? 0) + activity.reps);
    }
    const days: Array<{ day: string; label: string; reps: number }> = [];
    for (let offset = 13; offset >= 0; offset -= 1) {
      const day = addCivilDays(today, -offset);
      days.push({ day, label: day.slice(5).replace('-', '/'), reps: totals.get(day) ?? 0 });
    }
    return days;
  }, [recent, today]);
  // 標題寫「最近 14 天」，合計就只算這 14 天。
  const recentTotals = useMemo(() => sumUp(recent), [recent]);

  const showMonth = (next: CivilDate) => {
    setShownMonth(next);
    setSelectedDay(null);
  };
  const shift = (delta: number) => showMonth(monthStart(month.year, month.month + delta));
  const canGoBack = shownMonth > earliestMonth;
  const canGoForward = shownMonth < thisMonth;
  const monthTitle = `${month.year === Number(today.slice(0, 4)) ? '' : `${month.year} 年 `}${month.month} 月`;

  if (error) {
    return (
      <StateNotice
        kind="error"
        title="讀不到運動紀錄"
        description="請檢查網路連線後再試一次。你已經完成的運動不會因此消失。"
      />
    );
  }

  if (loading) return <StateNotice kind="loading" title="正在讀取運動紀錄…" />;

  if (activities.length === 0) {
    return (
      <EmptyState
        bordered
        icon={<Dumbbell size={30} strokeWidth={1.5} />}
        title="還沒有運動紀錄"
        description="完成第一次健身之後，這裡會依日期列出你做過的每一次運動。"
        action={
          <Button variant="primary" className="h-12 px-6" onClick={onStartWorkout}>
            <Dumbbell size={16} strokeWidth={3} />
            前往健身
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* 類型篩選。只有真的有兩種以上才出現 —— 一顆永遠只有一個選項的篩選器是雜訊。 */}
      {types.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="篩選運動項目">
          <FilterChip active={typeFilter === null} onClick={() => setTypeFilter(null)}>
            全部項目
          </FilterChip>
          {types.map((type) => (
            <FilterChip key={type} active={typeFilter === type} onClick={() => setTypeFilter(type)}>
              {type}
            </FilterChip>
          ))}
        </div>
      )}

      {/* 桌機：左欄月曆＋14 天圖，右欄清單。手機：月曆 → 清單 → 圖（DOM 順序就是手機的順序；桌機
          用 row/col-start 擺位置，不改 DOM，Tab 順序才不會跟畫面對不起來）。 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-[auto_1fr] gap-5 lg:gap-6 items-start">
        <section
          aria-label={`${monthTitle}運動月曆`}
          className="lg:col-span-5 lg:row-start-1 bg-island-cream-2 rounded-[1.75rem] border border-island-line p-4 sm:p-5 flex flex-col gap-3"
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => shift(-1)}
              disabled={!canGoBack}
              aria-label="上一個月"
              className="w-11 h-11 rounded-xl bg-white border border-island-line flex items-center justify-center text-island-navy disabled:opacity-30 active:scale-95"
            >
              <ChevronLeft size={18} strokeWidth={2.8} />
            </button>
            <div className="flex flex-col items-center min-w-0">
              <span className="text-base font-black text-island-navy">{monthTitle}</span>
              <span className="text-[11px] font-bold text-island-navy-soft/70">
                運動 <span className="font-black font-mono text-island-navy">{month.activeDays}</span> 天．{monthActivities.length} 次
              </span>
            </div>
            <button
              type="button"
              onClick={() => shift(1)}
              disabled={!canGoForward}
              aria-label="下一個月"
              className="w-11 h-11 rounded-xl bg-white border border-island-line flex items-center justify-center text-island-navy disabled:opacity-30 active:scale-95"
            >
              <ChevronRight size={18} strokeWidth={2.8} />
            </button>
          </div>
          <div className="w-full max-w-sm mx-auto">
            <MonthDots
              cells={month.cells}
              showHeads
              selected={selectedDay}
              onSelect={(day) => setSelectedDay((current) => (current === day ? null : day))}
            />
          </div>
          <p className="text-[11px] font-bold text-island-navy-soft/60 text-center">
            {selectedDay ? '再點一次同一天，回到整個月' : '點有運動的日子，看那天做了什麼'}
          </p>
        </section>

        <section className="lg:col-span-7 lg:col-start-6 lg:row-start-1 lg:row-span-2 flex flex-col gap-4">
          <SectionHeading
            icon={<CalendarCheck size={18} strokeWidth={2.5} />}
            title={selectedDay ? `${dayHeading(selectedDay, today, yesterday)} 的運動` : `${monthTitle}的運動`}
            subtitle={
              listed.length > 0
                ? `${listTotals.workouts} 次．${formatNumber(listTotals.reps)} 下`
                : undefined
            }
            action={
              selectedDay && (
                <button
                  type="button"
                  onClick={() => setSelectedDay(null)}
                  className="h-10 px-3 rounded-xl bg-white border border-island-line text-xs font-black text-island-navy-soft hover:border-island-teal-light flex items-center gap-1 flex-shrink-0"
                >
                  <X size={14} strokeWidth={2.8} />
                  看整個月
                </button>
              )
            }
          />
          {groups.length === 0 ? (
            <EmptyState
              bordered
              icon={<Dumbbell size={28} strokeWidth={1.5} />}
              title={typeFilter ? `${monthTitle}沒有「${typeFilter}」的紀錄` : `${monthTitle}沒有運動紀錄`}
              description={canGoBack ? '按月曆左上的 ‹ 看更早的月份。' : '換一個項目，或先去完成一次運動。'}
            />
          ) : (
            groups.map(([day, entries]) => (
              <div key={day} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h5 className="text-sm font-black text-island-navy">{dayHeading(day, today, yesterday)}</h5>
                  <span className="text-[11px] font-bold text-island-navy-soft/60 font-mono">{entries.length} 次</span>
                </div>
                <ul className="flex flex-col gap-2">
                  {entries.map((activity) => (
                    <li
                      key={activity.activityId}
                      className="bg-white rounded-2xl border border-island-line px-4 py-3 flex items-center gap-3"
                    >
                      <span className="text-[11px] font-black font-mono text-island-navy-soft/60 w-11 flex-shrink-0">
                        {activityTimeLabel(activity)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-island-navy truncate">{activity.type}</p>
                        <p className="text-[11px] font-bold text-island-navy-soft/70 truncate">
                          {durationLabel(activity.durationSeconds)}
                        </p>
                      </div>
                      <span className="text-[11px] font-bold text-island-navy-soft/70 flex-shrink-0">
                        <span className="text-base font-black font-mono text-island-navy">{activity.reps}</span> 下
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
          {activities.length >= ACTIVITY_FETCH_LIMIT && (
            <p className="text-[11px] font-bold text-island-navy-soft/60">
              只保留最近 {ACTIVITY_FETCH_LIMIT} 次運動，更早的紀錄不在這裡。
            </p>
          )}
        </section>

        {/* 圖表。高度用 `aspect` 而不是固定的 px：一支手機橫著拿的時候，一個寫死 300px 的圖會吃
            掉整個可視高度。`min-h` 保底，避免在極矮的視窗裡塌成一條線。 */}
        <section
          aria-label="最近 14 天"
          className="lg:col-span-5 lg:col-start-1 lg:row-start-2 bg-island-cream-2 rounded-[1.75rem] border border-island-line p-4 sm:p-5 flex flex-col gap-4"
        >
          <div className="flex items-center gap-2 min-w-0">
            <TrendingUp size={16} strokeWidth={2.6} className="text-island-teal-dark flex-shrink-0" />
            <h4 className="text-sm font-black text-island-navy">最近 14 天每日動作次數</h4>
          </div>
          <p className="text-[11px] font-bold text-island-navy-soft/70 -mt-2">
            {recentTotals.workouts} 次運動．{formatNumber(recentTotals.reps)} 下
          </p>
          <div className="w-full aspect-[16/7] min-h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                <defs>
                  <linearGradient id="healthHistoryFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2A9D8F" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#2A9D8F" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E1DED4" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: '#4A6169' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={16}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#4A6169' }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#264653',
                    border: 'none',
                    borderRadius: '16px',
                    color: '#fff',
                    padding: '10px 12px',
                    fontSize: '12px',
                  }}
                  itemStyle={{ color: '#fff' }}
                  labelStyle={{ color: '#fff', fontWeight: 900 }}
                  formatter={(value) => [`${Number(value ?? 0)} 下`, '動作次數']}
                />
                <Area
                  type="monotone"
                  dataKey="reps"
                  stroke="#2A9D8F"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#healthHistoryFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
}

function sumUp(activities: readonly HealthActivity[]) {
  return activities.reduce(
    (acc, activity) => ({
      workouts: acc.workouts + 1,
      reps: acc.reps + activity.reps,
    }),
    { workouts: 0, reps: 0 },
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-10 px-4 rounded-xl border text-xs font-black transition-all active:scale-95 ${
        active
          ? 'bg-island-teal text-white border-island-teal-dark/40'
          : 'bg-white text-island-navy-soft border-island-line hover:border-island-teal-light'
      }`}
    >
      {children}
    </button>
  );
}
