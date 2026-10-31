/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarRange, Gift, Loader2, Plus, Target } from 'lucide-react';
import { playSound, SoundEffect } from '../../../lib/soundUtils';
import { vibrateGoalCompleted } from '../../../lib/vibration';
import { TaskRewardStrip } from '../TaskRewardStrip';
import { useApp } from '../../../context/AppContext';
import {
  MAX_WEEKLY_TASKS,
  type WeeklyTaskDefinition,
  type WeeklyTaskDraft,
  type WeeklyTaskErrors,
} from '../../../constants/weeklyTasks';
import { Button, EmptyState, ModalOverlay, ModalShell, PanelHeader } from '../../UI/DesignKit';
import { WeeklyTaskCard } from '../WeeklyTaskCard';
import { WeeklyTaskForm } from '../WeeklyTaskForm';
import { cycleRangeLabel } from '../healthFormat';
import { SectionHeading, StateNotice } from '../HealthChrome';
import { FloatingPanelPortal } from '../../UI/FloatingPanelPortal';

/**
 * 「每週任務」分頁 —— 任務清單、建立／編輯／刪除的入口。
 *
 * 這裡沒有任何進度計算：每一張卡片拿到的都是 `weeklyTaskView.progress` 裡算好的一筆
 * （context/useWeeklyTasks.ts → constants/weeklyTasks.ts）。這個元件唯一的工作是排版跟決定哪一
 * 個 modal 開著。
 */
export function WeeklyTaskPanel() {
  const { weeklyTaskView, createWeeklyTask, updateWeeklyTask, deleteWeeklyTask, claimWeeklyTaskReward } = useApp();
  const { cycle, progress, tasks, loading, error, canCreate, rewardStatus, rewardClaims } = weeklyTaskView;

  // 領取的三種暫態：哪一張正在寫、哪一張剛失敗、哪一張剛領到（放一次入帳動畫）。都是畫面狀態，
  // 「領過沒有」本身永遠讀 rewardStatus（存檔裡的帳），不是這裡。
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [justClaimedId, setJustClaimedId] = useState<string | null>(null);
  const justClaimedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(justClaimedTimer.current), []);

  const claim = async (taskId: string) => {
    if (claimingId) return;
    playSound(SoundEffect.CLICK);
    setClaimingId(taskId);
    setFailedId(null);
    const outcome = await claimWeeklyTaskReward(taskId);
    setClaimingId(null);
    if (outcome.ok) {
      playSound(SoundEffect.REWARD);
      vibrateGoalCompleted();
      setJustClaimedId(taskId);
      window.clearTimeout(justClaimedTimer.current);
      justClaimedTimer.current = window.setTimeout(() => setJustClaimedId(null), 1800);
      return;
    }
    // `already-claimed`／`cap-reached` 不是失敗：帳上已經有答案了，卡片會自己畫成對的狀態。
    // `in-flight` 是連點的第二下。只有真的沒寫進去的才告訴玩家。
    if (outcome.reason === 'save-failed' || outcome.reason === 'refused' || outcome.reason === 'no-profile') {
      setFailedId(taskId);
    }
  };

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
          description="設一個這一週想達成的目標吧 —— 例如「每週運動 3 天」。進度會在你每次健身完自動更新。"
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
                reward={
                  rewardStatus[entry.task.taskId] && (
                    <TaskRewardStrip
                      status={rewardStatus[entry.task.taskId]}
                      onClaim={() => void claim(entry.task.taskId)}
                      claiming={claimingId === entry.task.taskId}
                      failed={failedId === entry.task.taskId}
                      justClaimed={justClaimedId === entry.task.taskId}
                      claimCap={rewardClaims.cap}
                    />
                  )
                }
              />
            ))}
          </div>
          <div className="flex flex-col gap-1.5 text-[11px] font-bold text-island-navy-soft/60">
            <p className="flex items-center gap-1.5">
              <CalendarRange size={13} strokeWidth={2.5} className="flex-shrink-0" />
              任務每週一重新開始，進度來自你實際完成的健身紀錄（{tasks.length} / {MAX_WEEKLY_TASKS} 個任務）
            </p>
            {/* 每週上限寫在這裡，讓第四個達標的任務沒有按鈕時，玩家知道那是一條規則。 */}
            <p className="flex items-start gap-1.5">
              <Gift size={13} strokeWidth={2.5} className="flex-shrink-0 mt-px" />
              <span>
                本週已領取 {rewardClaims.used} / {rewardClaims.cap} 次任務獎勵。目標設得越高，獎勵越多；獎勵要在本週結束前領取。
              </span>
            </p>
          </div>
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
              {rewardStatus[pendingDelete.taskId]?.kind === 'claimed' && (
                <p className="text-xs font-bold text-island-navy-soft/70 leading-relaxed">
                  這個任務本週的獎勵已經領過了，領到的東西會留著；本週的領取次數不會因為刪除而恢復。
                </p>
              )}
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
