/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import type { CivilDate } from '../../constants/civilTime';
import type { MonthCell } from './healthStats';

/**
 * 健康頁的小圖表：圓環、週達標膠囊、長條、一天的時間軸、月曆點、甜甜圈。
 *
 * 全部是手寫的 SVG／div，而不是 recharts：這些圖都很小（一張卡片裡的一角），而且要在 320px 的手
 * 機跟 1920px 的桌機上都是同一個形狀 —— 一個 `flex-1` 的長條會自己跟著卡片變寬，一個
 * ResponsiveContainer 則要等量完尺寸才畫得出來，在卡片第一次出現的那一格裡是空的。
 *
 * ## 顏色
 *
 * 只用島嶼色票（index.css 的 `--color-island-*`）：運動時間是 teal、天數是 navy、動作次數是
 * teal-dark。`island-gold` 是金幣專用、`island-coral` 是危險／刪除，兩者都不拿來畫健康數據
 * （見 components/UI/DESIGN_SYSTEM.md 的 Color 一節）。淡色的軌道與未選取的長條用 `color-mix`
 * 從同一個 token 調出來，而不是另外發明一個 hex。
 */

export type HealthMetric = 'minutes' | 'days' | 'reps';

const mix = (token: string, percent: number) => `color-mix(in srgb, var(${token}) ${percent}%, white)`;

export const METRIC_STYLE: Record<HealthMetric, { color: string; dim: string; track: string; text: string; label: string }> = {
  minutes: {
    color: 'var(--color-island-teal)',
    dim: mix('--color-island-teal', 32),
    track: mix('--color-island-teal', 14),
    text: 'text-island-teal-dark',
    label: '運動時間',
  },
  days: {
    color: 'var(--color-island-navy)',
    dim: mix('--color-island-navy', 24),
    track: mix('--color-island-navy', 10),
    text: 'text-island-navy',
    label: '運動天數',
  },
  reps: {
    color: 'var(--color-island-teal-dark)',
    dim: mix('--color-island-teal-light', 45),
    track: mix('--color-island-teal-light', 18),
    text: 'text-island-teal-dark',
    label: '動作次數',
  },
};

/** 類別色（甜甜圈、動作分布）。依序取用，同一個項目在同一張圖裡永遠是同一個顏色。 */
export const CATEGORY_COLORS = [
  'var(--color-island-teal)',
  'var(--color-island-navy)',
  'var(--color-island-teal-light)',
  'var(--color-island-navy-soft)',
  mix('--color-island-navy', 35),
];

// --- 圓環 ------------------------------------------------------------------

export interface RingSpec {
  /** 0..1 以上都可以；超過 1 就畫滿。 */
  ratio: number;
  color: string;
  track: string;
}

/**
 * 同心圓環。外圈在前。`size` 是 SVG 的邏輯尺寸，實際大小由 className 決定（例如
 * `w-32 sm:w-40`），所以同一個元件在手機與桌機上可以是兩個大小而不用傳兩次數字。
 */
export function ActivityRings({
  rings,
  size = 150,
  stroke = 18,
  gap = 3,
  label,
  className = '',
  children,
}: {
  rings: RingSpec[];
  size?: number;
  stroke?: number;
  gap?: number;
  label: string;
  className?: string;
  /** 疊在圓環正中央的內容（例如今天的動作次數）。 */
  children?: React.ReactNode;
}) {
  const center = size / 2;
  return (
    <div className={`relative flex-shrink-0 aspect-square ${className}`}>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="w-full h-full">
        {rings.map((ring, i) => {
          const r = center - stroke / 2 - i * (stroke + gap);
          if (r <= 0) return null;
          const circumference = 2 * Math.PI * r;
          const ratio = Math.min(1, Math.max(0, ring.ratio));
          return (
            <g key={i}>
              <circle cx={center} cy={center} r={r} fill="none" stroke={ring.track} strokeWidth={stroke} />
              {ratio > 0 && (
                <circle
                  cx={center}
                  cy={center}
                  r={r}
                  fill="none"
                  stroke={ring.color}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  strokeDasharray={`${Math.max(0.001, ratio * circumference)} ${circumference}`}
                  transform={`rotate(-90 ${center} ${center})`}
                  style={{ transition: 'stroke-dasharray 600ms ease-out' }}
                />
              )}
            </g>
          );
        })}
      </svg>
      {children && <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>}
    </div>
  );
}

// --- 週達標膠囊 -------------------------------------------------------------

/** 連續達標卡右下那一排：每一週一顆，達標實心、沒達標灰、本週還沒達標是虛線框。 */
export function WeekPills({ weeks }: { weeks: Array<{ met: boolean; current: boolean }> }) {
  return (
    <div className="flex items-end gap-1.5" aria-hidden="true">
      {weeks.map((week, i) => (
        <span
          key={i}
          className={`block w-3 sm:w-3.5 h-7 sm:h-8 rounded-full box-border ${
            week.met
              ? 'bg-island-navy'
              : week.current
                ? 'border-2 border-dashed border-island-navy/60'
                : 'bg-island-sand'
          }`}
        />
      ))}
    </div>
  );
}

// --- 長條圖 ----------------------------------------------------------------

/**
 * 一排長條。寬度永遠由容器決定（`flex-1`），高度是 `height` px。
 *
 * `currentIndex` 那一根畫成虛線框，表示「還在進行中」—— 本週只過了幾天，它矮不代表退步。
 * `futureFrom` 之後的每一根是還沒到的日子：只畫一個虛線的底，不畫成一根 0 —— 「星期五還沒到」
 * 跟「星期五沒運動」是兩件事。
 * 給了 `onSelect` 就變成一排按鈕，可以點選某一週。
 */
export function BarChart({
  values,
  height,
  color,
  dim,
  max,
  selected,
  currentIndex,
  futureFrom,
  refValue,
  refLabel,
  labels,
  ariaLabels,
  onSelect,
}: {
  values: number[];
  height: number;
  color: string;
  dim: string;
  max?: number;
  /** 以 `color` 強調的那一根；其餘用 `dim`。 */
  selected?: number;
  currentIndex?: number;
  /** 從這一根開始是還沒到的日子。 */
  futureFrom?: number;
  refValue?: number;
  refLabel?: string;
  labels?: string[];
  ariaLabels?: string[];
  onSelect?: (index: number) => void;
}) {
  const isFuture = (i: number) => futureFrom !== undefined && i >= futureFrom;
  const top = Math.max(1, max ?? Math.max(...values, refValue ?? 0, 1));
  const refBottom = refValue !== undefined && refValue > 0 ? Math.round((refValue / top) * height) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative flex items-end gap-1.5 sm:gap-2" style={{ height }}>
        {refBottom !== null && (
          <>
            <div
              className="absolute inset-x-0 border-t-[1.5px] border-dashed border-island-navy/30 pointer-events-none"
              style={{ bottom: refBottom }}
            />
            {refLabel && (
              <div
                className="absolute left-0 text-[10px] sm:text-[11px] font-bold text-island-navy-soft/80 pointer-events-none bg-white/85 px-1 rounded"
                style={{ bottom: refBottom + 3 }}
              >
                {refLabel}
              </div>
            )}
          </>
        )}
        {values.map((value, i) => {
          const barHeight = Math.max(4, Math.round((value / top) * height));
          const on = selected === i;
          const inProgress = currentIndex === i;
          const style: React.CSSProperties = isFuture(i)
            ? { height: 6, border: `1.5px dashed ${dim}`, background: 'transparent' }
            : inProgress
              ? { height: barHeight, border: `2px dashed ${color}`, background: on ? dim : 'transparent' }
              : { height: barHeight, background: on ? color : dim };
          const bar = (
            <span
              className="block w-full rounded-t-md rounded-b-sm box-border transition-[height] duration-500"
              style={style}
            />
          );
          return onSelect ? (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(i)}
              aria-label={ariaLabels?.[i]}
              aria-pressed={on}
              className="flex-1 min-w-0 h-full flex items-end rounded-md focus-visible:outline-2 focus-visible:outline-island-teal"
            >
              {bar}
            </button>
          ) : (
            <div key={i} className="flex-1 min-w-0 h-full flex items-end">
              {bar}
            </div>
          );
        })}
      </div>
      {labels && (
        <div className="flex gap-1.5 sm:gap-2">
          {labels.map((label, i) => (
            <span
              key={i}
              className={`flex-1 min-w-0 text-center text-[10px] sm:text-[11px] truncate ${
                selected === i
                  ? 'font-black text-island-navy'
                  : isFuture(i)
                    ? 'font-bold text-island-navy-soft/40'
                    : 'font-bold text-island-navy-soft/70'
              }`}
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// --- 一天的時間軸 ----------------------------------------------------------

const TIMELINE_TICKS = [0, 6, 12, 18, 24];

/**
 * 0 點到 24 點的一條軌道，每一次運動是軌道上的一段（從開始畫到結束）。
 *
 * 取代原本「每小時運動分鐘」的 24 根長條：一天通常只有一兩次運動，24 根長條裡 22 根是空的，而
 * 那兩根的高度（分鐘）在下面的清單裡本來就寫著。時間軸只回答「什麼時候」，高度只有一行字。
 */
export function DayTimeline({
  spans,
  label,
}: {
  /** `from`／`to` 是小時（0..24 的小數）。 */
  spans: Array<{ from: number; to: number; color: string; title: string }>;
  label: string;
}) {
  const pct = (hour: number) => `${(Math.min(24, Math.max(0, hour)) / 24) * 100}%`;
  return (
    <div className="flex flex-col gap-1">
      <div role="img" aria-label={label} className="relative h-8 rounded-xl bg-island-cream-2 border border-island-line overflow-hidden">
        {TIMELINE_TICKS.slice(1, -1).map((hour) => (
          <span key={hour} className="absolute inset-y-0 w-px bg-island-line" style={{ left: pct(hour) }} />
        ))}
        {spans.map((span, i) => (
          <span
            key={i}
            title={span.title}
            className="absolute inset-y-1.5 rounded-md"
            // 至少 8px：一次 5 分鐘的運動在 24 小時的尺度上不到 1px，但它確實發生了。
            style={{ left: pct(span.from), width: `max(8px, ${pct(span.to - span.from)})`, background: span.color }}
          />
        ))}
      </div>
      <div className="relative h-4 text-[11px] font-bold text-island-navy-soft/70" aria-hidden="true">
        {TIMELINE_TICKS.map((hour, i) => (
          <span
            key={hour}
            className={`absolute top-0 whitespace-nowrap ${i === 0 ? '' : i === TIMELINE_TICKS.length - 1 ? '-translate-x-full' : '-translate-x-1/2'}`}
            style={{ left: pct(hour) }}
          >
            {hour} 時
          </span>
        ))}
      </div>
    </div>
  );
}

// --- 月曆 ------------------------------------------------------------------

const WEEKDAY_HEADS = ['一', '二', '三', '四', '五', '六', '日'];

/**
 * 這個月的每一天一個點：有運動是實心 teal，今天多一圈外框，未來的日子最淡。
 *
 * 給了 `onSelect` 就變成一個可以點的月曆（活動紀錄頁用）：每一格寫上日期，有運動的那幾天是按
 * 鈕，點了回報那一天；沒運動的日子沒有東西可看，所以不能點。首頁卡片上那個小月曆不傳，整張卡
 * 本身就是入口。
 */
export function MonthDots({
  cells,
  showHeads = false,
  onSelect,
  selected,
}: {
  cells: MonthCell[];
  showHeads?: boolean;
  onSelect?: (date: CivilDate) => void;
  selected?: CivilDate | null;
}) {
  if (onSelect) {
    return (
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {showHeads &&
          WEEKDAY_HEADS.map((head) => (
            <span key={head} className="text-center text-[11px] font-bold text-island-navy-soft/60 pb-0.5">
              {head}
            </span>
          ))}
        {cells.map((cell, i) => {
          if (cell === null) return <span key={i} className="aspect-square" />;
          const on = selected === cell.date;
          const ring = on
            ? 'ring-2 ring-offset-2 ring-offset-white ring-island-navy'
            : cell.today
              ? 'ring-2 ring-offset-1 ring-offset-white ring-island-navy/40'
              : '';
          const base = `aspect-square rounded-full flex items-center justify-center text-[13px] sm:text-sm font-black font-mono ${ring}`;
          if (!cell.active) {
            return (
              <span key={i} className={`${base} ${cell.future ? 'text-island-navy-soft/25' : 'text-island-navy-soft/60'}`}>
                {cell.day}
              </span>
            );
          }
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(cell.date)}
              aria-pressed={on}
              aria-label={`${cell.day} 日有運動，查看當天紀錄`}
              className={`${base} transition-all active:scale-90 focus-visible:outline-2 focus-visible:outline-island-teal ${
                on ? 'bg-island-navy text-white' : 'bg-island-teal text-white hover:bg-island-teal-dark'
              }`}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
      {showHeads &&
        WEEKDAY_HEADS.map((head) => (
          <span key={head} className="text-center text-[10px] font-bold text-island-navy-soft/60">
            {head}
          </span>
        ))}
      {cells.map((cell, i) =>
        cell === null ? (
          <span key={i} className="aspect-square" />
        ) : (
          <span
            key={i}
            title={`${cell.day} 日${cell.active ? '・有運動' : ''}`}
            className={`aspect-square rounded-full ${
              cell.active ? 'bg-island-teal' : cell.future ? 'bg-island-cream-2' : 'bg-island-sand'
            } ${cell.today ? 'ring-2 ring-offset-2 ring-offset-white ring-island-navy' : ''}`}
          />
        ),
      )}
    </div>
  );
}

// --- 甜甜圈 ----------------------------------------------------------------

export function Donut({
  parts,
  size = 130,
  stroke = 20,
  label,
  className = '',
}: {
  parts: Array<{ value: number; color: string }>;
  size?: number;
  stroke?: number;
  label: string;
  className?: string;
}) {
  const r = size / 2 - stroke / 2;
  const circumference = 2 * Math.PI * r;
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  // 每一段之間留 2px 的縫，只有一段的時候不留（否則會是一個有缺口的圓）。
  const gap = parts.length > 1 ? 2 : 0;
  let offset = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className={`flex-shrink-0 ${className}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-island-cream-2)" strokeWidth={stroke} />
      {total > 0 &&
        parts.map((part, i) => {
          const length = (part.value / total) * circumference;
          const segment = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={part.color}
              strokeWidth={stroke}
              strokeDasharray={`${Math.max(0, length - gap)} ${circumference}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
          offset += length;
          return segment;
        })}
    </svg>
  );
}

/** 一條水平進度條（動作分布、亮點比較）。 */
export function HBar({ ratio, color, track = 'var(--color-island-cream-2)', thick = false }: { ratio: number; color: string; track?: string; thick?: boolean }) {
  return (
    <div className={`${thick ? 'h-3' : 'h-2.5'} w-full rounded-full overflow-hidden`} style={{ background: track }}>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%`, background: color }}
      />
    </div>
  );
}
