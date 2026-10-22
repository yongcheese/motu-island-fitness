/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from 'react';
import { CalendarCheck, Dumbbell, TrendingUp } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '../../../context/AppContext';
import { View } from '../../../types';
import { Button, EmptyState } from '../../UI/DesignKit';
import { SectionHeading, StateNotice } from '../HealthChrome';
import {
  activityCivilDate,
  activityTimeLabel,
  dayHeading,
  durationLabel,
  formatNumber,
} from '../healthFormat';
import { addCivilDays, civilDateAt, type CivilDate } from '../../../constants/civilTime';
import { distinctTypes } from './healthSections';
import type { HealthActivity } from '../../../lib/healthData';

/**
 * 「活動紀錄」分頁 —— 過去的運動，依日期整理。
 *
 * 規格要求「依日期或類型整理」並且「避免與目前任務資訊全部混在一起」。改版前那個畫面把三個統計
 * 數字、一張圖表跟全部紀錄疊在同一張卡上，而那張圖畫的是「最近 10 次」—— 一個沒有日期概念的
 * 數列。這裡分成三塊：一張趨勢圖、一排類型篩選、一份依日分組的清單。
 *
 * 分組是在**遊戲時區**做的（healthFormat 的 `activityCivilDate`），不是 `toLocaleDateString()`：
 * 一筆晚上 11 點的紀錄會不會被分到隔天，不該取決於玩家的筆電設在哪一個時區。
 */
export function ActivityHistoryPanel() {
  const { weeklyTaskView, setCurrentView } = useApp();
  const { activities, loading, error } = weeklyTaskView;

  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const types = useMemo(() => distinctTypes(activities), [activities]);

  const filtered = useMemo(
    () => (typeFilter ? activities.filter((activity) => activity.type === typeFilter) : activities),
    [activities, typeFilter],
  );

  const today = civilDateAt(new Date());
  const yesterday = addCivilDays(today, -1);

  /** 依日分組，由新到舊。`activities` 已經排序過，所以這裡只需要一次走訪。 */
  const groups = useMemo(() => {
    const byDay = new Map<CivilDate, HealthActivity[]>();
    for (const activity of filtered) {
      const day = activityCivilDate(activity);
      const bucket = byDay.get(day);
      if (bucket) bucket.push(activity);
      else byDay.set(day, [activity]);
    }
    return [...byDay.entries()];
  }, [filtered]);

  /** 每日總動作次數，最近 14 天。圖表的 x 軸是日期而不是「第幾次」。 */
  const chartData = useMemo(() => {
    const totals = new Map<CivilDate, number>();
    for (const activity of filtered) {
      const day = activityCivilDate(activity);
      totals.set(day, (totals.get(day) ?? 0) + activity.reps);
    }
    const days: Array<{ day: string; label: string; reps: number }> = [];
    for (let offset = 13; offset >= 0; offset -= 1) {
      const day = addCivilDays(today, -offset);
      days.push({ day, label: day.slice(5).replace('-', '/'), reps: totals.get(day) ?? 0 });
    }
    return days;
  }, [filtered, today]);

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, activity) => ({
          workouts: acc.workouts + 1,
          reps: acc.reps + activity.reps,
        }),
        { workouts: 0, reps: 0 },
      ),
    [filtered],
  );

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
          <Button variant="primary" className="h-12 px-6" onClick={() => setCurrentView(View.FITNESS)}>
            <Dumbbell size={16} strokeWidth={3} />
            前往健身
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        icon={<TrendingUp size={18} strokeWidth={2.5} />}
        title="最近 14 天"
        subtitle={`${totals.workouts} 次運動．${formatNumber(totals.reps)} 下`}
      />

      {/* 圖表。高度用 `aspect` 而不是固定的 px：一支手機橫著拿的時候，一個寫死 300px 的圖會吃
          掉整個可視高度。`min-h` 保底，避免在極矮的視窗裡塌成一條線。 */}
      <div className="bg-island-cream-2 rounded-[1.75rem] border border-island-line p-4 sm:p-5">
        <h4 className="text-[11px] font-black tracking-widest text-island-navy-soft/70 uppercase mb-4">
          每日動作次數
        </h4>
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
      </div>

      {/* 類型篩選。只有真的有兩種以上才出現 —— 一顆永遠只有一個選項的篩選器是雜訊。 */}
      {types.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <FilterChip active={typeFilter === null} onClick={() => setTypeFilter(null)}>
            全部
          </FilterChip>
          {types.map((type) => (
            <FilterChip key={type} active={typeFilter === type} onClick={() => setTypeFilter(type)}>
              {type}
            </FilterChip>
          ))}
        </div>
      )}

      <section className="flex flex-col gap-4">
        <SectionHeading icon={<CalendarCheck size={18} strokeWidth={2.5} />} title="依日期" />
        {groups.length === 0 ? (
          <EmptyState
            bordered
            icon={<Dumbbell size={28} strokeWidth={1.5} />}
            title={`沒有「${typeFilter}」的紀錄`}
            description="換一個項目，或先去完成一次這種運動。"
          />
        ) : (
          groups.map(([day, entries]) => (
            <div key={day} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <h5 className="text-sm font-black text-island-navy">{dayHeading(day, today, yesterday)}</h5>
                <span className="text-[11px] font-bold text-island-navy-soft/60 font-mono">
                  {entries.length} 次
                </span>
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
      </section>
    </div>
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
      onClick={onClick}
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
