/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertCircle, ChevronRight, Loader2 } from 'lucide-react';
import { IconTile, accentClass, type AccentColor } from '../UI/DesignKit';

/**
 * 健康頁各畫面共用的小零件：區塊標題、載入／錯誤狀態、首頁卡片。
 *
 * 分頁各自 hand-roll 一個標題列與一個載入狀態，是四個分頁看起來像四個不同畫面的最快路徑。這兩
 * 個元件小到看起來不值得抽出來，而那正是它們最容易長出四份的原因。
 */

/** 一個區塊的標題列：圖示、標題、副標，右邊可選一顆動作按鈕。 */
export function SectionHeading({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    // `flex-wrap` 加上 `min-w-0`：手機上按鈕換到下一行，而不是把標題擠成一個字。
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <IconTile size={40} active className="text-island-teal">
          {icon}
        </IconTile>
        <div className="min-w-0">
          <h3 className="text-lg sm:text-xl font-black text-island-navy tracking-tight truncate">{title}</h3>
          {subtitle && (
            <p className="text-[11px] font-bold text-island-navy-soft/70 truncate mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

/**
 * 載入中／讀取失敗。
 *
 * 兩者分開而不是共用一個「沒有資料」的畫面，因為它們對玩家的意思完全不同：一個是「等一下」，另
 * 一個是「你的資料還在，只是現在拿不到」。把讀取失敗畫成空狀態，等於告訴玩家他的紀錄不見了。
 */
export function StateNotice({
  kind,
  title,
  description,
}: {
  kind: 'loading' | 'error';
  title: string;
  description?: string;
}) {
  const isError = kind === 'error';
  return (
    <div
      className={`rounded-[1.75rem] border p-6 flex items-center gap-3 ${
        isError ? 'bg-island-coral/8 border-island-coral/25' : 'bg-island-cream-2 border-island-line'
      }`}
    >
      <div className={`flex-shrink-0 ${isError ? 'text-island-coral' : 'text-island-teal'}`}>
        {isError ? <AlertCircle size={22} strokeWidth={2.5} /> : <Loader2 size={22} className="animate-spin" />}
      </div>
      <div className="min-w-0">
        <p className={`text-sm font-black ${isError ? 'text-island-coral' : 'text-island-navy'}`}>{title}</p>
        {description && (
          <p className="text-xs font-bold text-island-navy-soft/70 mt-1 leading-relaxed">{description}</p>
        )}
      </div>
    </div>
  );
}

// --- 首頁卡片 ----------------------------------------------------------------

/** 健康頁所有卡片的外框：白底、細框、大圓角 —— 跟商店與設定的卡片同一個材質。 */
export const HEALTH_CARD =
  'bg-white rounded-[1.75rem] border border-island-line shadow-[0_2px_10px_rgba(38,70,83,0.05)]';

/** 可以點進去的卡片多一層回饋。跟 DesignKit 的 `.card-interactive` 同一組動作，只是不抬那麼高。 */
const HEALTH_CARD_INTERACTIVE =
  'text-left w-full transition-all hover:border-island-teal-light hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(38,70,83,0.1)] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-island-teal';

/**
 * 一張首頁卡片。有 `onClick` 就是一顆按鈕（整張卡都能點），沒有就是一個 section。
 *
 * 整張卡可點而不是只有右上角那個「›」：設計稿的每一張摘要卡都是通往子頁的入口，在手機上一個
 * 16px 的箭頭是點不準的。
 */
export function HealthCard({
  onClick,
  label,
  className = '',
  children,
}: {
  onClick?: () => void;
  /** 給輔助技術的名字，例如「今天，查看詳情」。 */
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={label} className={`${HEALTH_CARD} ${HEALTH_CARD_INTERACTIVE} ${className}`}>
        {children}
      </button>
    );
  }
  return (
    <section aria-label={label} className={`${HEALTH_CARD} ${className}`}>
      {children}
    </section>
  );
}

/** 卡片的標題列：左邊小圖示＋標題，右邊一行灰字（「詳情」「近 8 週」）加一個 ›。 */
export function CardTitle({
  icon,
  title,
  accent = 'teal',
  trailing,
  chevron = true,
}: {
  icon: React.ReactNode;
  title: string;
  accent?: AccentColor;
  trailing?: React.ReactNode;
  chevron?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 ${accentClass[accent]}`}>
          {icon}
        </span>
        <span className="text-[15px] font-black text-island-navy truncate">{title}</span>
      </div>
      {(trailing || chevron) && (
        <span className="flex items-center gap-0.5 text-xs sm:text-sm font-bold text-island-navy-soft/70 flex-shrink-0">
          {trailing}
          {chevron && <ChevronRight size={16} strokeWidth={2.6} />}
        </span>
      )}
    </div>
  );
}

/** 大數字＋小單位：`18/20 分`、`5 週`。數字用等寬字，才不會一跳一跳。 */
export function BigNumber({
  value,
  unit,
  size = 'md',
}: {
  value: React.ReactNode;
  unit?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const sizeClass = {
    sm: 'text-lg sm:text-xl',
    md: 'text-[22px] sm:text-2xl',
    lg: 'text-3xl sm:text-4xl',
    xl: 'text-4xl sm:text-5xl',
  }[size];
  return (
    <span className={`${sizeClass} font-black font-mono text-island-navy leading-none tracking-tight`}>
      {value}
      {unit && <span className="text-sm sm:text-base font-bold font-sans text-island-navy-soft/70 tracking-normal">{unit}</span>}
    </span>
  );
}
