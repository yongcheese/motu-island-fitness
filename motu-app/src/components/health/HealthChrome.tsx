/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { IconTile } from '../UI/DesignKit';

/**
 * 健康頁四個分頁共用的兩塊小零件。
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
