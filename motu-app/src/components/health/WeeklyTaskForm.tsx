/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Gift, Loader2, Target } from 'lucide-react';
import { rewardForTask } from '../../constants/weeklyTaskRewards';
import { RewardChip } from './TaskRewardStrip';
import {
  METRIC_SPECS,
  getMetricSpec,
  hasErrors,
  TASK_NAME_MAX,
  validateWeeklyTaskDraft,
  type WeeklyTaskDefinition,
  type WeeklyTaskDraft,
  type WeeklyTaskErrors,
} from '../../constants/weeklyTasks';
import { selectableActivityTypes, type HealthActivity } from '../../lib/healthData';
import { Button, ModalOverlay, ModalShell, PanelHeader } from '../UI/DesignKit';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { FloatingPanelPortal } from '../UI/FloatingPanelPortal';

/**
 * 建立／編輯一個每週任務。
 *
 * 一個 modal，而且只放這一件短暫的操作 —— 規格明確寫了「Modal 僅適合短暫操作，不要把完整功能
 * 全部塞進 Modal」。任務的檢視、進度與管理都在健康頁本身，這裡只有一張四個欄位的表單。
 *
 * ## 驗證
 *
 * 規則全部在 constants/weeklyTasks.ts 的 `validateWeeklyTaskDraft`，這裡一條都沒有。理由是它同時
 * 是**寫入前**的最後一道關（context/useWeeklyTasks.ts 也呼叫同一個函式）：如果表單有自己的一
 * 套，兩套遲早會分岔，而分岔的那一刻表單會放行一個服務會拒絕的任務，玩家看到的是一顆沒反應的按
 * 鈕。
 *
 * 錯誤訊息是逐欄位的，而且只在**送出過一次之後**才顯示 —— 一個還沒打完字就開始罵人的表單，玩家
 * 的第一個反應是它壞了。
 */
export function WeeklyTaskForm({
  open,
  editing,
  existingTasks,
  activities,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** 編輯模式時的既有任務；建立模式是 null。 */
  editing: WeeklyTaskDefinition | null;
  existingTasks: readonly WeeklyTaskDefinition[];
  activities: readonly HealthActivity[];
  onClose: () => void;
  /** 回傳欄位錯誤代表服務端也拒絕了；回傳 null 代表成功。 */
  onSubmit: (draft: WeeklyTaskDraft) => Promise<WeeklyTaskErrors | null>;
}) {
  const [name, setName] = useState('');
  const [metric, setMetric] = useState<string>('workout_count');
  const [target, setTarget] = useState('');
  const [activityType, setActivityType] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<WeeklyTaskErrors>({});

  const typeOptions = useMemo(() => selectableActivityTypes(activities), [activities]);

  // 每次打開都從頭來：一個還記得上次輸入的表單，在「刪掉又想重建」的流程裡會拿錯的預設值歡迎
  // 玩家。編輯模式則把既有的值填進去。
  useEffect(() => {
    if (!open) return;
    setSubmitted(false);
    setSaving(false);
    setServerErrors({});
    if (editing) {
      setName(editing.name);
      setMetric(editing.metric);
      setTarget(String(editing.target));
      setActivityType(editing.activityType ?? typeOptions[0] ?? '');
    } else {
      const spec = getMetricSpec('workout_count');
      setName('');
      setMetric('workout_count');
      setTarget(String(spec?.defaultTarget ?? 3));
      setActivityType(typeOptions[0] ?? '');
    }
    // `typeOptions` 刻意不在依賴裡：訂閱送來一批新紀錄時重設整張表單，會把玩家打到一半的字清
    // 掉。開啟的那一刻取一次就夠了。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  useEscapeToClose(onClose, open && !saving);

  const draft: WeeklyTaskDraft = { name, metric, target, activityType };
  const spec = getMetricSpec(metric);
  const localErrors = validateWeeklyTaskDraft(draft, existingTasks, editing?.taskId);
  const errors: WeeklyTaskErrors = submitted ? { ...localErrors, ...serverErrors } : serverErrors;
  // 目標還不合法時不預覽：一個 0 或 99999 的報價會讓人以為那是能存的值。
  const rewardQuote =
    spec && !localErrors.target && !localErrors.metric
      ? rewardForTask({ metric: spec.id, target: Number(String(target).trim()) })
      : null;

  const changeMetric = (next: string) => {
    setMetric(next);
    setServerErrors({});
    // 換目標類型就換一個合理的預設值。留著上一個類型的數字，會做出「每週運動 300 次」這種任務，
    // 而玩家多半不會注意到單位已經變了。
    const nextSpec = getMetricSpec(next);
    if (nextSpec) setTarget(String(nextSpec.defaultTarget));
  };

  const submit = async () => {
    setSubmitted(true);
    setServerErrors({});
    if (hasErrors(localErrors)) return;
    setSaving(true);
    const result = await onSubmit(draft);
    setSaving(false);
    if (result) {
      setServerErrors(result);
      return;
    }
    onClose();
  };

  if (!open) return null;

  return (
    // Portal 出去，而不是留在 HealthView 的卡片裡。
    //
    // HealthView 的卡片是一個有 transform 的 `motion.div`，而一個有 transform 的元素會成為它底下
    // 每一個 `absolute`／`fixed` 子元素的定位基準 —— 加上那張卡片本身 `overflow-hidden`，留在原
    // 地的 modal 會被定位到卡片的框、然後被裁掉一半。寫多高的 z-index 都救不了：它被困在那個
    // stacking context 裡。這跟 BuildingInteriorView 的浮動面板、AccountPanel 是同一個問題與同一
    // 個解法，見 FloatingPanelPortal.tsx。
    <FloatingPanelPortal>
      {/* z-modal — 共用的 modal 層級，見 DESIGN_SYSTEM.md 的 Z-index。 */}
      <ModalOverlay onClick={saving ? undefined : onClose}>
      <ModalShell maxWidthClassName="max-w-lg" className="max-h-full">
        <PanelHeader
          icon={<Target size={20} strokeWidth={2.5} />}
          title={editing ? '編輯每週任務' : '建立每週任務'}
          subtitle={editing ? '目標可以隨時調整，已累積的進度會重新計算' : '設定一個這一週想達成的目標'}
          onClose={saving ? undefined : onClose}
        />

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar-teal p-5 sm:p-6 flex flex-col gap-5">
          <Field label="任務名稱" error={errors.name} hint={`最多 ${TASK_NAME_MAX} 個字`}>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setServerErrors({});
              }}
              maxLength={40}
              placeholder="例如：每週運動 3 次"
              className={inputClass(!!errors.name)}
            />
          </Field>

          <Field label="目標類型" error={errors.metric}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {METRIC_SPECS.map((option, index) => {
                const isActive = option.id === metric;
                const disabled = !option.available;
                // 類型數是奇數時，最後一格橫跨兩欄，兩欄排版的最後一列才不會缺一格。
                const spanLast = index === METRIC_SPECS.length - 1 && METRIC_SPECS.length % 2 === 1;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => changeMetric(option.id)}
                    // 尚未支援的類型仍然「在」清單上，只是不能選，而且下面就寫著為什麼。把它藏
                    // 起來只會讓玩家一直問遊戲能不能算步數。
                    className={`text-left rounded-2xl border p-3 transition-all ${spanLast ? 'sm:col-span-2' : ''} ${
                      disabled
                        ? 'bg-island-cream-2 border-island-line opacity-55 cursor-not-allowed'
                        : isActive
                          ? 'bg-island-teal/8 border-island-teal'
                          : 'bg-white border-island-line hover:border-island-teal-light'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-black text-island-navy truncate">{option.label}</span>
                      {disabled && (
                        <span className="text-[9px] font-black tracking-widest text-island-navy-soft/60 border border-island-line rounded px-1.5 py-0.5 flex-shrink-0">
                          尚未支援
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-bold text-island-navy-soft/70 mt-1 leading-relaxed">
                      {disabled ? option.unavailableReason : option.hint}
                    </p>
                  </button>
                );
              })}
            </div>
          </Field>

          {spec?.needsActivityType && (
            <Field label="計算哪一種運動" error={errors.activityType}>
              <div className="flex flex-wrap gap-2">
                {typeOptions.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setActivityType(type);
                      setServerErrors({});
                    }}
                    className={`h-11 px-4 rounded-xl border text-sm font-black transition-all active:scale-95 ${
                      activityType === type
                        ? 'bg-island-teal text-white border-island-teal-dark/40'
                        : 'bg-white text-island-navy-soft border-island-line hover:border-island-teal-light'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </Field>
          )}

          <Field
            label="目標數值"
            error={errors.target}
            hint={spec ? `${spec.minTarget} – ${spec.maxTarget} ${spec.unit}` : undefined}
          >
            <div className="flex items-center gap-2">
              <input
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setServerErrors({});
                }}
                // `inputMode="numeric"` 而不是 `type="number"`：數字型 input 在手機上會吃掉自
                // 己的值（空字串／`e`／小數點的行為各家瀏覽器不同），而驗證本來就在
                // constants/weeklyTasks.ts 做，這裡只需要叫出數字鍵盤。
                inputMode="numeric"
                placeholder={String(spec?.defaultTarget ?? '')}
                className={`${inputClass(!!errors.target)} font-mono`}
              />
              {spec && (
                <span className="text-sm font-black text-island-navy-soft/70 flex-shrink-0">{spec.unit}</span>
              )}
            </div>
            {/* 快速填入。手機上打數字是這張表單最煩的一步。 */}
            {spec && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {quickTargets(spec.defaultTarget, spec.minTarget, spec.maxTarget).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTarget(String(value))}
                    className="h-9 px-3 rounded-lg border border-island-line bg-island-cream-2 text-xs font-black font-mono text-island-navy-soft hover:border-island-teal hover:text-island-teal transition-all active:scale-95"
                  >
                    {value}
                  </button>
                ))}
              </div>
            )}
            {/* 完成獎勵的預覽。跟任務卡讀同一個 rewardForTask()，所以這裡看到的就是做完能領的。 */}
            {rewardQuote && (
              <div className="mt-3 flex items-center gap-2 flex-wrap text-[11px] font-black text-island-navy-soft">
                <span className="flex items-center gap-1">
                  <Gift size={13} strokeWidth={2.6} className="text-island-teal-dark" />
                  完成獎勵
                  <span className="h-5 px-1.5 rounded-md bg-white border border-island-line text-[10px] flex items-center">
                    {rewardQuote.tier.label}
                  </span>
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {rewardQuote.rewards.map((reward, i) => (
                    <RewardChip key={i} reward={reward} compact />
                  ))}
                </span>
              </div>
            )}
          </Field>

          {errors.form && (
            <p className="flex items-start gap-2 text-xs font-bold text-island-coral bg-island-coral/10 border border-island-coral/25 rounded-xl p-3">
              <AlertCircle size={15} strokeWidth={2.5} className="flex-shrink-0 mt-px" />
              <span>{errors.form}</span>
            </p>
          )}
        </div>

        <div className="p-5 sm:p-6 border-t border-island-line bg-island-cream-2 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end flex-shrink-0">
          <Button variant="secondary" className="h-12 px-6" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button variant="primary" className="h-12 px-6" onClick={submit} disabled={saving}>
            {saving && <Loader2 size={16} className="animate-spin" />}
            {saving ? '儲存中…' : editing ? '儲存變更' : '建立任務'}
          </Button>
        </div>
        </ModalShell>
      </ModalOverlay>
    </FloatingPanelPortal>
  );
}

/** 三個好按的整數建議值，圍著這個類型的預設值。上下限外的不出現。 */
function quickTargets(base: number, min: number, max: number): number[] {
  const candidates = [Math.round(base / 2), base, base * 2, base * 3];
  const unique: number[] = [];
  for (const value of candidates) {
    if (value < min || value > max) continue;
    if (!unique.includes(value)) unique.push(value);
  }
  return unique.slice(0, 4);
}

function inputClass(invalid: boolean): string {
  return `w-full h-12 px-4 rounded-xl bg-white border text-sm font-bold text-island-navy placeholder:text-island-navy-soft/40 outline-none transition-colors ${
    invalid
      ? 'border-island-coral focus:border-island-coral'
      : 'border-island-line focus:border-island-teal'
  }`;
}

/** 一個欄位：標籤、內容、提示或錯誤。錯誤取代提示，不是疊在它下面 —— 兩行小字讀起來像一段話。 */
function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[11px] font-black tracking-widest text-island-navy-soft/70 uppercase">{label}</label>
      {children}
      {error ? (
        <p className="flex items-start gap-1.5 text-[11px] font-bold text-island-coral">
          <AlertCircle size={13} strokeWidth={2.5} className="flex-shrink-0 mt-px" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p className="text-[11px] font-bold text-island-navy-soft/60">{hint}</p>
      ) : null}
    </div>
  );
}
