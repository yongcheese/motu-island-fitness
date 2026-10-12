/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CalendarCheck, CalendarDays, Flame, Timer } from 'lucide-react';
import type { HealthGoals } from '../healthGoals';
import type { HealthSnapshot } from '../useHealthSnapshot';
import { HEALTH_CARD } from '../HealthChrome';
import { CATEGORY_COLORS } from '../HealthCharts';
import { activityCivilDate, durationLabel, formatNumber, shortDate } from '../healthFormat';

/**
 * 「個人紀錄」—— 每個項目單次最多的動作次數，以及幾個「持續」的紀錄。
 *
 * 獎牌的顏色是類別色（同一個項目在趨勢頁的甜甜圈裡也是這個顏色），不是金銀銅 —— `island-gold`
 * 是金幣專用，而這裡也沒有名次。
 */
export function HealthRecordsPage({ snapshot, goals }: { snapshot: HealthSnapshot; goals: HealthGoals }) {
  const { bests, streak, longestStreak, bestWeek, longest } = snapshot;

  const rows = [
    {
      key: '目前連續達標',
      note: `每週運動 ${goals.daysPerWeek} 天就延續`,
      value: streak,
      unit: ' 週',
      icon: <Flame size={20} strokeWidth={2.4} />,
    },
    {
      key: '最長連續達標',
      note: streak > 0 && streak >= longestStreak ? '進行中，本週達標就刷新' : '紀錄裡最長的一段',
      value: longestStreak,
      unit: ' 週',
      icon: <CalendarCheck size={20} strokeWidth={2.4} />,
    },
    {
      key: '單週最多運動天數',
      note: bestWeek ? `${shortDate(bestWeek.weekStart)} 那一週` : '還沒有紀錄',
      value: bestWeek?.days ?? 0,
      unit: ' 天',
      icon: <CalendarDays size={20} strokeWidth={2.4} />,
    },
    {
      key: '最長單次運動',
      note: longest ? `${shortDate(activityCivilDate(longest))} ${longest.type}` : '還沒有紀錄',
      value: longest ? durationLabel(longest.durationSeconds) : '—',
      unit: '',
      icon: <Timer size={20} strokeWidth={2.4} />,
    },
  ];

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <h3 className="text-sm font-bold text-island-navy-soft/70">單次最多動作次數</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {bests.map((entry, i) => {
          const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
          return (
            <section
              key={entry.type}
              aria-label={`${entry.type} 單次最多 ${entry.best?.reps ?? 0} 下`}
              className={`${HEALTH_CARD} p-4 sm:p-5 flex flex-col items-center gap-2 text-center`}
            >
              <div
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-full border-[6px] flex flex-col items-center justify-center"
                style={{ borderColor: entry.best ? color : 'var(--color-island-line)', background: `color-mix(in srgb, ${color} 9%, white)` }}
              >
                <span className="text-3xl sm:text-4xl font-black font-mono text-island-navy leading-none">{entry.best ? formatNumber(entry.best.reps) : '—'}</span>
                <span className="text-xs font-bold text-island-navy-soft/70 mt-1">下</span>
              </div>
              <span className="text-[15px] font-black text-island-navy truncate max-w-full">{entry.type}</span>
              {entry.fresh ? (
                <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-island-teal text-white">新紀錄</span>
              ) : (
                <span className="text-xs font-bold text-island-navy-soft/70">
                  {entry.best ? shortDate(activityCivilDate(entry.best)) : '還沒做過'}
                </span>
              )}
            </section>
          );
        })}
      </div>

      <h3 className="text-sm font-bold text-island-navy-soft/70 mt-2">持續紀錄</h3>
      <section aria-label="持續紀錄" className={`${HEALTH_CARD} px-4 sm:px-5 py-1 grid grid-cols-1 md:grid-cols-2 md:gap-x-8`}>
        {rows.map((row, i) => (
          <div
            key={row.key}
            className={`h-[72px] flex items-center gap-3 ${i > 0 ? 'border-t border-island-line' : ''} ${i === 1 ? 'md:border-t-0' : ''}`}
          >
            <span className="w-10 h-10 rounded-xl bg-island-cream-2 border border-island-line text-island-teal-dark flex items-center justify-center flex-shrink-0">
              {row.icon}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-black text-island-navy truncate">{row.key}</p>
              <p className="text-xs font-bold text-island-navy-soft/70 truncate">{row.note}</p>
            </div>
            <span className="text-xl sm:text-2xl font-black font-mono text-island-navy flex-shrink-0">
              {row.value}
              <span className="text-sm font-bold font-sans text-island-navy-soft/70">{row.unit}</span>
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
