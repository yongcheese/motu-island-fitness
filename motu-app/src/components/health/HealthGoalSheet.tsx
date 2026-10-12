/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { motion } from 'motion/react';
import { Minus, Plus } from 'lucide-react';
import { SCRIM_INK } from '../UI/DesignKit';
import { ActivityRings, METRIC_STYLE } from './HealthCharts';
import { GOAL_MINUTES_MAX, GOAL_MINUTES_MIN, GOAL_MINUTES_STEP, type HealthGoals } from './healthGoals';

/**
 * 「設定目標」—— 每週幾天、每天幾分鐘。
 *
 * 手機上是從底部滑上來的抽屜（拇指搆得到「完成」），桌機上是畫面中央的對話框。改的是草稿，按
 * 「完成」才寫回去；「取消」與點背景都不會改到任何東西。
 */
export function HealthGoalSheet({
  goals,
  onSave,
  onClose,
}: {
  goals: HealthGoals;
  onSave: (next: HealthGoals) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(goals);

  return (
    // z-50：跟 HealthView 的關閉鍵同一層，DOM 在它後面所以蓋得過它。見 HealthView 的 z-index 註解。
    <div className={`fixed inset-0 z-50 ${SCRIM_INK} flex items-end sm:items-center justify-center sm:p-6`} onClick={onClose}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="health-goal-title"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.2 }}
        onClick={(event) => event.stopPropagation()}
        className="w-full sm:max-w-md bg-white rounded-t-[2rem] sm:rounded-[2rem] border border-island-line shadow-[0_24px_60px_rgba(38,70,83,0.2)] px-5 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6 flex flex-col gap-5 text-island-navy"
      >
        <div className="sm:hidden mx-auto w-10 h-1.5 rounded-full bg-island-line" />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center">
          <button type="button" onClick={onClose} className="justify-self-start min-h-11 px-1 text-[15px] font-bold text-island-navy-soft hover:text-island-navy">
            取消
          </button>
          <h2 id="health-goal-title" className="text-lg font-black">
            設定目標
          </h2>
          <button
            type="button"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            className="justify-self-end min-h-11 px-1 text-[15px] font-black text-island-teal-dark hover:text-island-teal"
          >
            完成
          </button>
        </div>

        <div className="flex flex-col items-center gap-2">
          <ActivityRings
            label={`每週 ${draft.daysPerWeek} 天`}
            size={120}
            stroke={16}
            className="w-28"
            rings={[{ ratio: draft.daysPerWeek / 7, color: METRIC_STYLE.days.color, track: METRIC_STYLE.days.track }]}
          >
            <span className="text-3xl font-black font-mono">{draft.daysPerWeek}</span>
          </ActivityRings>
          <p className="text-base font-black">每週運動 {draft.daysPerWeek} 天</p>
        </div>

        <div className="flex flex-col gap-2.5">
          <p className="text-sm font-bold text-island-navy-soft/70">每週運動天數</p>
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => {
              const on = n === draft.daysPerWeek;
              return (
                <button
                  key={n}
                  type="button"
                  aria-label={`每週 ${n} 天`}
                  aria-pressed={on}
                  onClick={() => setDraft((d) => ({ ...d, daysPerWeek: n }))}
                  className={`h-11 rounded-full text-base font-black font-mono transition-all active:scale-95 ${
                    on ? 'bg-island-navy text-white' : 'bg-island-cream-2 border border-island-line text-island-navy hover:border-island-teal-light'
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <p className="text-sm font-bold text-island-navy-soft/70">每天運動時間</p>
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-island-cream-2 border border-island-line p-2">
            <button
              type="button"
              aria-label={`減少 ${GOAL_MINUTES_STEP} 分鐘`}
              disabled={draft.minutesPerDay <= GOAL_MINUTES_MIN}
              onClick={() => setDraft((d) => ({ ...d, minutesPerDay: Math.max(GOAL_MINUTES_MIN, d.minutesPerDay - GOAL_MINUTES_STEP) }))}
              className="w-11 h-11 rounded-xl bg-white border border-island-line flex items-center justify-center text-island-navy disabled:opacity-40 active:scale-95"
            >
              <Minus size={18} strokeWidth={3} />
            </button>
            <span className="text-2xl font-black font-mono">
              {draft.minutesPerDay}
              <span className="text-sm font-bold font-sans text-island-navy-soft/70"> 分鐘</span>
            </span>
            <button
              type="button"
              aria-label={`增加 ${GOAL_MINUTES_STEP} 分鐘`}
              disabled={draft.minutesPerDay >= GOAL_MINUTES_MAX}
              onClick={() => setDraft((d) => ({ ...d, minutesPerDay: Math.min(GOAL_MINUTES_MAX, d.minutesPerDay + GOAL_MINUTES_STEP) }))}
              className="w-11 h-11 rounded-xl bg-white border border-island-line flex items-center justify-center text-island-navy disabled:opacity-40 active:scale-95"
            >
              <Plus size={18} strokeWidth={3} />
            </button>
          </div>
        </div>

        <p className="text-xs font-bold text-island-navy-soft/70 leading-relaxed">
          WHO 建議成人每週至少 150 分鐘中等強度活動，並有 2 天以上做肌力訓練。這裡的目標只影響健康頁的圓環與連續達標；想追蹤其他數字，請到「每週任務」設定。
        </p>
      </motion.div>
    </div>
  );
}
