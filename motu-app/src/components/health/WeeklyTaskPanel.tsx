/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { AlertTriangle, CalendarRange, Loader2, Plus, Target } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  MAX_WEEKLY_TASKS,
  type WeeklyTaskDefinition,
  type WeeklyTaskDraft,
  type WeeklyTaskErrors,
} from '../../constants/weeklyTasks';
import { Button, EmptyState, ModalOverlay, ModalShell, PanelHeader } from '../UI/DesignKit';
import { WeeklyTaskCard } from './WeeklyTaskCard';
import { WeeklyTaskForm } from './WeeklyTaskForm';
import { cycleRangeLabel } from './healthFormat';
import { SectionHeading, StateNotice } from './HealthChrome';
import { FloatingPanelPortal } from '../UI/FloatingPanelPortal';

/**
 * 「每週任務」分頁 —— 任務清單、建立／編輯／刪除的入口。
 *
 * 這裡沒有任何進度計算：每一張卡片拿到的都是 `weeklyTaskView.progress` 裡算好的一筆
 * （context/useWeeklyTasks.ts → constants/weeklyTasks.ts）。這個元件唯一的工作是排版跟決定哪一
 * 個 modal 開著。
 */
export function WeeklyTaskPanel() {
  const { weeklyTaskView, createWeeklyTask, updateWeeklyTask, deleteWeeklyTask } = useApp();
  const { cycle, progress, tasks, loading, error, canCreate } = weeklyTaskView;

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WeeklyTaskDefinition | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WeeklyTaskDefinition | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (task: WeeklyTaskDefinition) => {
    setEditing(task);
    setFormOpen(true);
  };

  /** 表單只認得「有沒有錯誤」。把服務的 outcome 翻成那個形狀的地方只有這裡一處。 */
  const submit = async (draft: WeeklyTaskDraft): Promise<WeeklyTaskErrors | null> => {
    const outcome = editing
      ? await updateWeeklyTask(editing.taskId, draft)
      : await createWeeklyTask(draft);
    if (outcome.ok) return null;
    if (outcome.reason === 'invalid' && outcome.errors) return outcome.errors;
    return { form: refusalMessage(outcome.reason) };
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteFailed(false);
    const outcome = await deleteWeeklyTask(pendingDelete.taskId);
    setDeleting(false);
    if (!outcome.ok) {
      setDeleteFailed(true);
      return;
    }
    setPendingDelete(null);
  };

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading
        icon={<Target size={18} strokeWidth={2.5} />}
        title="每週任務"
        subtitle={`本週 ${cycleRangeLabel(cycle.weekStart, cycle.weekEnd)}．週一開始、週日結束`}
        action={
          <Button
            variant="primary"
            className="h-11 px-4 text-sm flex-shrink-0"
            onClick={openCreate}
            disabled={!canCreate}
            title={canCreate ? '建立每週任務' : `最多 ${MAX_WEEKLY_TASKS} 個任務`}
          >
            <Plus size={16} strokeWidth={3} />
            建立任務
          </Button>
        }
      />

      {loading ? (
        <StateNotice kind="loading" title="正在讀取運動紀錄…" />
      ) : error ? (
        <StateNotice
          kind="error"
          title="讀不到運動紀錄"
          description="任務進度需要你的運動紀錄才能計算。請檢查網路連線後再試一次。"
        />
      ) : progress.length === 0 ? (
        // 規格：「如果目前尚未有任何任務，應顯示友善的空狀態與『建立每週任務』入口，而不是顯示
        // 空白頁面。」
        <EmptyState
          bordered
          icon={<Target size={30} strokeWidth={1.5} />}
          title="還沒有每週任務"
          description="設一個這一週想達成的目標吧 —— 例如「每週運動 3 次」。進度會在你每次健身完自動更新。"
          action={
            <Button variant="primary" className="h-12 px-6" onClick={openCreate}>
              <Plus size={16} strokeWidth={3} />
              建立每週任務
            </Button>
          }
        />
      ) : (
        <>
          {/* 兩欄以上才進 grid。單欄時卡片自然是全寬，不需要任何固定寬度 —— 這是規格裡「不要為
              了 RWD 使用大量固定寬度與固定高度」的做法。 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
            {progress.map((entry) => (
              <WeeklyTaskCard
                key={entry.task.taskId}
                entry={entry}
                onEdit={() => openEdit(entry.task)}
                onDelete={() => {
                  setDeleteFailed(false);
                  setPendingDelete(entry.task);
                }}
              />
            ))}
          </div>
          <p className="text-[11px] font-bold text-island-navy-soft/60 flex items-center gap-1.5">
            <CalendarRange size={13} strokeWidth={2.5} className="flex-shrink-0" />
            任務每週一重新開始，進度來自你實際完成的健身紀錄（{tasks.length} / {MAX_WEEKLY_TASKS} 個任務）
          </p>
        </>
      )}

      <WeeklyTaskForm
        open={formOpen}
        editing={editing}
        existingTasks={tasks}
        activities={weeklyTaskView.activities}
        onClose={() => setFormOpen(false)}
        onSubmit={submit}
      />

      {/* 刪除確認。規格要求「必要的確認提示」—— 刪一個任務會連同它的達標紀錄一起消失，而那是
          一個沒有復原鍵的動作。 */}
      {/* Portal 出去，理由同 WeeklyTaskForm：HealthView 的卡片有 transform 又 overflow-hidden，
          留在原地的 modal 會被裁掉。見 FloatingPanelPortal.tsx。 */}
      {pendingDelete && (
        <FloatingPanelPortal>
        <ModalOverlay onClick={deleting ? undefined : () => setPendingDelete(null)}>
          <ModalShell maxWidthClassName="max-w-md" className="max-h-full">
            <PanelHeader
              icon={<AlertTriangle size={20} strokeWidth={2.5} />}
              title="刪除這個任務？"
              onClose={deleting ? undefined : () => setPendingDelete(null)}
            />
            <div className="p-5 sm:p-6 flex flex-col gap-3">
              <p className="text-sm font-bold text-island-navy leading-relaxed">
                「{pendingDelete.name}」會被移除，連同它過去幾週的達標紀錄。
              </p>
              <p className="text-xs font-bold text-island-navy-soft/70 leading-relaxed">
                你的運動紀錄不會受影響 —— 被刪掉的只有這個目標本身。
              </p>
              {deleteFailed && (
                <p className="text-xs font-bold text-island-coral bg-island-coral/10 border border-island-coral/25 rounded-xl p-3">
                  刪除沒有存檔成功，任務還在。請稍後再試一次。
                </p>
              )}
            </div>
            <div className="p-5 sm:p-6 border-t border-island-line bg-island-cream-2 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <Button
                variant="secondary"
                className="h-12 px-6"
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
              >
                取消
              </Button>
              <Button variant="danger" className="h-12 px-6" onClick={confirmDelete} disabled={deleting}>
                {deleting && <Loader2 size={16} className="animate-spin" />}
                {deleting ? '刪除中…' : '刪除任務'}
              </Button>
            </div>
          </ModalShell>
        </ModalOverlay>
        </FloatingPanelPortal>
      )}
    </div>
  );
}

/** 服務拒絕的理由，翻成玩家看得懂的一句話。這是這些字串唯一的出處。 */
function refusalMessage(reason: 'no-profile' | 'not-found' | 'limit-reached' | 'save-failed' | 'invalid'): string {
  switch (reason) {
    case 'no-profile':
      return '還沒讀到你的存檔，請稍後再試。';
    case 'not-found':
      return '這個任務已經不在了，可能在別的裝置上被刪掉。';
    case 'limit-reached':
      return `每週任務最多 ${MAX_WEEKLY_TASKS} 個，請先刪除一個。`;
    case 'save-failed':
      return '沒有存檔成功，請檢查網路連線後再試一次。';
    case 'invalid':
      return '有欄位還沒填對。';
  }
}
