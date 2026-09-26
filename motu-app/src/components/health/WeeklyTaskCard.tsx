/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Check, Pencil, Trash2, CalendarRange } from 'lucide-react';
import { motion } from 'motion/react';
import type { WeeklyTaskProgress } from '../../constants/weeklyTasks';
import { accentClass } from '../UI/DesignKit';
import { cycleRangeLabel, remainingLabel, statusAccent, statusLabel } from './healthFormat';

/**
 * 一張每週任務卡。
 *
 * ## 資訊層級
 *
 * 規格要求「使用者不需要閱讀所有文字才能理解畫面」，所以這張卡有三層，而且只有三層：
 *
 *   1. **名字 ＋ 狀態徽章** —— 掃一眼就知道這是哪一個任務、做完了沒有。
 *   2. **大數字 ＋ 進度條** —— 「1 / 3 次」跟那條條。這是玩家真正回來看的東西，所以它是卡上最
 *      大的字，而不是被夾在說明文字中間。
 *   3. **週期與剩餘天數** —— 次要，所以小、灰、在最底下。
 *
 * 編輯／刪除是圖示按鈕，放在右上角，而不是卡片底部的兩顆文字按鈕：它們是偶爾才用一次的動作，不
 * 該跟進度爭同一層視覺重量。
 *
 * ## RWD
 *
 * 沒有任何固定寬度或固定高度。卡片是 grid 的一格，內容自己疊。名字用 `truncate` 搭配
 * `min-w-0`，因為在 flex 裡少了 `min-w-0` 的 `truncate` 不會生效 —— 一個長名字會把右邊的按鈕擠
 * 出容器，這正是規格裡「小螢幕避免水平溢出」講的那種溢出。
 *
 * 進度條上方那一行是 `flex-wrap`：在 320px 寬的手機上，「1 / 3 次」跟「33%」會換行而不是重疊，
 * 這也是規格點名的「進度條與文字不要因容器縮小而重疊」。
 */
export function WeeklyTaskCard({
  entry,
  onEdit,
  onDelete,
}: {
  entry: WeeklyTaskProgress;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { task, spec, current, target, ratio, percent, rawPercent, completed, status, cycle } = entry;
  const unit = spec?.unit ?? '';
  const accent = statusAccent(status);

  return (
    <div
      className={`bg-white rounded-[1.75rem] border p-4 sm:p-5 flex flex-col gap-4 transition-colors ${
        completed ? 'border-island-teal/45' : 'border-island-line'
      }`}
    >
      {/* 第一層：名字與狀態。`min-w-0` 讓 truncate 真的會截斷，而不是把按鈕推出去。 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-base sm:text-lg font-black text-island-navy tracking-tight truncate">{task.name}</h4>
          {/* 狀態徽章跟目標類型同一行，而不是擠進右邊的按鈕列：在 320px 寬的螢幕上，兩顆 44px
              的按鈕加一顆徽章會把標題壓成兩三個字。這裡它有一整行可以待。 */}
          <div className="flex items-center gap-2 mt-1 min-w-0">
            <span
              className={`inline-flex items-center gap-1 h-6 px-2 rounded-lg border text-[10px] font-black tracking-widest flex-shrink-0 ${accentClass[accent]}`}
            >
              {completed && <Check size={11} strokeWidth={3} />}
              {statusLabel(status)}
            </span>
            <span className="text-[11px] font-bold text-island-navy-soft/70 truncate">
              {spec?.label ?? '未知的目標類型'}
              {task.activityType ? ` · ${task.activityType}` : ''}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* 44px 的觸控目標，符合規格「按鈕與互動區域需要有足夠大小」。圖示本身是 16px，其餘
              是留白 —— 縮小的是圖示，不是可以點的範圍。 */}
          <button
            onClick={onEdit}
            title="編輯任務"
            aria-label={`編輯 ${task.name}`}
            className="w-11 h-11 rounded-xl bg-island-cream-2 border border-island-line text-island-navy-soft hover:text-island-teal hover:border-island-teal flex items-center justify-center transition-all active:scale-90"
          >
            <Pencil size={16} strokeWidth={2.5} />
          </button>
          <button
            onClick={onDelete}
            title="刪除任務"
            aria-label={`刪除 ${task.name}`}
            className="w-11 h-11 rounded-xl bg-island-cream-2 border border-island-line text-island-navy-soft hover:text-island-coral hover:border-island-coral flex items-center justify-center transition-all active:scale-90"
          >
            <Trash2 size={16} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* 第二層：進度。卡上最大的字。 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-end justify-between gap-2 flex-wrap">
          <div className="flex items-baseline gap-1 min-w-0">
            <span className="text-2xl sm:text-3xl font-black font-mono text-island-navy leading-none">
              {current}
            </span>
            <span className="text-sm font-black text-island-navy-soft/60 font-mono leading-none">
              / {target}
            </span>
            {unit && <span className="text-xs font-bold text-island-navy-soft/60 leading-none">{unit}</span>}
          </div>
          {/* 超額時顯示真實百分比（例如 140%），因為超額是真的，只有條被夾住。 */}
          <span
            className={`text-sm font-black font-mono leading-none ${
              completed ? 'text-island-teal-dark' : 'text-island-navy-soft/70'
            }`}
          >
            {rawPercent > 100 ? rawPercent : percent}%
          </span>
        </div>

        <div className="h-3 rounded-full bg-island-sand border border-island-line overflow-hidden">
          <motion.div
            initial={false}
            // `ratio` 已經夾在 0..1（constants/weeklyTasks.ts），所以視覺上不可能超過 100% ——
            // 這一行不需要自己再 clamp 一次，也就不會有兩個地方各夾各的。
            animate={{ width: `${ratio * 100}%` }}
            transition={{ type: 'spring', stiffness: 220, damping: 30 }}
            className={`h-full rounded-full ${completed ? 'bg-island-teal' : 'bg-island-teal-light'}`}
          />
        </div>
      </div>

      {/* 第三層：週期。小、灰、在最下面。 */}
      <div className="flex items-center justify-between gap-2 flex-wrap text-[11px] font-bold text-island-navy-soft/70">
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <CalendarRange size={13} strokeWidth={2.5} className="flex-shrink-0" />
          <span className="truncate">{cycleRangeLabel(cycle.weekStart, cycle.weekEnd)}</span>
        </span>
        <span className={completed ? 'text-island-teal-dark' : ''}>
          {completed ? '本週目標已達成' : remainingLabel(entry.remaining)}
        </span>
      </div>
    </div>
  );
}
