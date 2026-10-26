/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CalendarRange, Check, Gift, Loader2, Plus, Target } from 'lucide-react';
import { playSound, SoundEffect } from '../../lib/soundUtils';
import { vibrateGoalCompleted } from '../../lib/vibration';
import { TaskRewardStrip } from './TaskRewardStrip';
import { useApp } from '../../context/AppContext';
import type {
  WeeklyTaskClaimOutcome,
  WeeklyTaskDeleteOutcome,
  WeeklyTaskOutcome,
  WeeklyTaskView,
} from '../../context/useWeeklyTasks';
import {
  MAX_WEEKLY_TASKS,
  type WeeklyTaskDefinition,
  type WeeklyTaskDraft,
  type WeeklyTaskErrors,
} from '../../constants/weeklyTasks';
import { Button, EmptyState, ModalOverlay, ModalShell, PanelHeader } from '../UI/DesignKit';
import { WeeklyTaskCard } from './WeeklyTaskCard';
import { WeeklyTaskForm } from './WeeklyTaskForm';
import { cycleRangeLabel, remainingLabel } from './healthFormat';
import { BigNumber, HEALTH_CARD, StateNotice } from './HealthChrome';
import { FloatingPanelPortal } from '../UI/FloatingPanelPortal';

/** 健康頁裡的「每週任務」：讀 context，畫 {@link WeeklyTasks}。 */
export function WeeklyTaskPanel({ focusTaskIds = [] }: { focusTaskIds?: readonly string[] }) {
  const { weeklyTaskView, createWeeklyTask, updateWeeklyTask, deleteWeeklyTask, claimWeeklyTaskReward } = useApp();
  return (
    <WeeklyTasks
      view={weeklyTaskView}
      focusTaskIds={focusTaskIds}
      actions={{
        create: createWeeklyTask,
        update: updateWeeklyTask,
        remove: deleteWeeklyTask,
        claim: claimWeeklyTaskReward,
      }}
    />
  );
}

/** 任務頁的四個寫入動作。真的那一份是 AppContext 的，範例頁傳假的。 */
export interface WeeklyTaskActions {
  create: (draft: WeeklyTaskDraft) => Promise<WeeklyTaskOutcome>;
  update: (taskId: string, draft: WeeklyTaskDraft) => Promise<WeeklyTaskOutcome>;
  remove: (taskId: string) => Promise<WeeklyTaskDeleteOutcome>;
  claim: (taskId: string) => Promise<WeeklyTaskClaimOutcome>;
}

/**
 * 「每週任務」—— 任務清單、建立／編輯／刪除的入口。
 *
 * 這裡沒有任何進度計算：每一張卡片拿到的都是 `view.progress` 裡算好的一筆
 * （context/useWeeklyTasks.ts → constants/weeklyTasks.ts）。這個元件唯一的工作是排版跟決定哪一
 * 個 modal 開著。
 *
 * 不碰 context（理由同 ActivityHistory）：範例頁（tmp-health.tsx）要能用假資料畫它，檢查一個、
 * 兩個、八個任務時的版面。
 */
export function WeeklyTasks({
  view,
  actions,
  focusTaskIds = [],
}: {
  view: WeeklyTaskView;
  actions: WeeklyTaskActions;
  focusTaskIds?: readonly string[];
}) {
  const { create: createWeeklyTask, update: updateWeeklyTask, remove: deleteWeeklyTask, claim: claimWeeklyTaskReward } = actions;
  const { cycle, progress, tasks, summary, loading, error, canCreate, rewardStatus, rewardClaims } = view;

  // 從首頁「重要提醒」進來的：把那幾個任務捲到眼前並框起來 —— 玩家是為了它們來的，不該要自己在
  // 八張卡裡找。只在第一次畫出來時捲一次；之後玩家自己捲就不再搶。
  const focusRef = useRef<HTMLDivElement>(null);
  const focusKey = focusTaskIds.join(',');
  const firstFocusedId = progress.find((entry) => focusTaskIds.includes(entry.task.taskId))?.task.taskId;
  useEffect(() => {
    if (!focusKey || loading) return;
    const frame = window.requestAnimationFrame(() => focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    return () => window.cancelAnimationFrame(frame);
  }, [focusKey, loading]);

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

  // 本週總覽的數字。全部是 view 裡算好的東西（跟首頁「每週任務」卡同一份 summary），這裡只數一數。
  const hasTasks = !loading && !error && progress.length > 0;
  const isEmpty = !loading && !error && progress.length === 0;
  const live = progress.filter((entry) => entry.status !== 'upcoming');
  const unfinished = summary.tasksActive - summary.tasksCompleted;
  const claimableCount = progress.filter((entry) => rewardStatus[entry.task.taskId]?.kind === 'claimable').length;
  // 每個任務都是同一週，剩幾天問哪一個都一樣。
  const weekRemaining = progress[0] ? remainingLabel(progress[0].remaining) : null;

  const createButton = (
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
  );

  return (
    <>
      {isEmpty ? (
        // 還沒有任務：空狀態加規則就好。總覽在這時候只剩「本週 9/28 – 10/4」一行，跟空狀態的「還沒有每週
        // 任務」講的是同一件事。
        <div className="flex flex-col gap-3 sm:gap-4">
          {/* 規格：「如果目前尚未有任何任務，應顯示友善的空狀態與『建立每週任務』入口，而不是顯示空白
              頁面。」 */}
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
          <TaskRules className="flex" taskCount={tasks.length} claimCap={rewardClaims.cap} />
        </div>
      ) : (
        // 桌機：左欄是「本週總覽」（sticky），右欄是任務清單。手機一欄，總覽在最上面。
        //
        // 任務曾經是整頁寬的兩欄格線，上面一行週期、下面兩行灰字：只有一個任務時右半邊整個是空的，而
        // 「完成了幾個、獎勵還能領幾次、本週剩幾天」—— 玩家點進來最想知道的 —— 只出現在最底下的灰字
        // 裡。現在它們是左欄的大數字，任務卡則改成一欄（每張卡有完整的寬度放獎勵那一條）。
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4 items-start">
          {/* 第一層：本週總覽 */}
          <section
            aria-label="本週總覽"
            className={`${HEALTH_CARD} lg:col-span-5 lg:sticky lg:top-4 p-5 sm:p-6 flex flex-col gap-4`}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex flex-col gap-1.5 min-w-0">
                {hasTasks ? (
                  <>
                    <span className="text-sm font-bold text-island-navy-soft/70">本週 {cycleRangeLabel(cycle.weekStart, cycle.weekEnd)}</span>
                    <BigNumber value={summary.tasksCompleted} unit={` / ${summary.tasksActive} 個完成`} size="xl" />
                  </>
                ) : (
                  // 讀取中／讀取失敗：還不知道有沒有任務，所以只講是哪一週，不說「還沒有任務」。
                  <h3 className="text-xl sm:text-2xl font-black text-island-navy tracking-tight">本週 {cycleRangeLabel(cycle.weekStart, cycle.weekEnd)}</h3>
                )}
              </div>
              {createButton}
            </div>

            {hasTasks && (
              <>
                {/* 每個任務一格，做完的是實心 —— 「1 / 3」畫出來的樣子。 */}
                <div className="flex gap-1.5" aria-hidden="true">
                  {live.map((entry) => (
                    <span key={entry.task.taskId} className={`h-2.5 flex-1 rounded-full ${entry.completed ? 'bg-island-teal' : 'bg-island-sand'}`} />
                  ))}
                </div>
                <p className="text-base sm:text-lg font-black text-island-navy leading-snug">
                  {summary.tasksActive > 0 && unfinished === 0
                    ? '本週的任務都完成了'
                    : `${weekRemaining}，還有 ${unfinished} 個任務沒完成`}
                </p>
                <dl className="grid grid-cols-2 gap-3">
                  <SummaryStat
                    icon={<Gift size={15} strokeWidth={2.6} />}
                    label="可領獎勵"
                    value={claimableCount}
                    unit=" 個"
                    highlight={claimableCount > 0}
                  />
                  <SummaryStat
                    icon={<Check size={15} strokeWidth={2.8} />}
                    label="本週已領"
                    value={rewardClaims.used}
                    unit={` / ${rewardClaims.cap} 次`}
                  />
                </dl>
              </>
            )}

            {/* 規則。桌機在總覽裡（左欄還有空間，而且 sticky 的總覽一直看得到）；手機移到清單後面，不讓
                兩行灰字把第一張任務卡推出第一個畫面。 */}
            <TaskRules className="hidden lg:flex border-t border-island-line pt-4" taskCount={tasks.length} claimCap={rewardClaims.cap} />
          </section>

          {/* 第二層：任務清單 */}
          <div className="lg:col-span-7 flex flex-col gap-3 sm:gap-4">
            {loading ? (
              <StateNotice kind="loading" title="正在讀取運動紀錄…" />
            ) : error ? (
              <StateNotice
                kind="error"
                title="讀不到運動紀錄"
                description="任務進度需要你的運動紀錄才能計算。請檢查網路連線後再試一次。"
              />
            ) : (
              progress.map((entry) => (
                <div key={entry.task.taskId} ref={entry.task.taskId === firstFocusedId ? focusRef : undefined}>
                  <WeeklyTaskCard
                    entry={entry}
                    highlighted={focusTaskIds.includes(entry.task.taskId)}
                    // 週期與剩幾天已經在總覽裡講過一次了，每張卡不再各講一次。
                    showCycle={false}
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
                </div>
              ))
            )}
            <TaskRules className="flex lg:hidden" taskCount={tasks.length} claimCap={rewardClaims.cap} />
          </div>
        </div>
      )}

      <WeeklyTaskForm
        open={formOpen}
        editing={editing}
        existingTasks={tasks}
        activities={view.activities}
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
    </>
  );
}

/** 總覽裡的一個小數字：圖示＋標題＋數字。`highlight` 是「有事等你做」（有獎勵可以領）。 */
function SummaryStat({
  icon,
  label,
  value,
  unit,
  highlight = false,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  unit: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-3 flex flex-col gap-2 min-w-0 ${
        highlight ? 'border-island-teal/40 bg-island-teal/8' : 'border-island-line bg-island-cream-2'
      }`}
    >
      <dt
        className={`flex items-center gap-1.5 text-xs font-black truncate ${highlight ? 'text-island-teal-dark' : 'text-island-navy-soft/80'}`}
      >
        <span className="flex-shrink-0">{icon}</span>
        {label}
      </dt>
      <dd>
        <BigNumber value={value} unit={unit} size="md" />
      </dd>
    </div>
  );
}

/**
 * 任務頁的規則：什麼時候重新開始、進度從哪來、一週能領幾次。
 *
 * 每週上限寫在這裡，讓第四個達標的任務沒有按鈕時，玩家知道那是一條規則。
 */
/** `className` 決定它在哪個寬度出現（含 display），見呼叫端。 */
function TaskRules({ className, taskCount, claimCap }: { className: string; taskCount: number; claimCap: number }) {
  return (
    <div className={`flex-col gap-1.5 text-[11px] font-bold text-island-navy-soft/60 ${className}`}>
      <p className="flex items-start gap-1.5">
        <CalendarRange size={13} strokeWidth={2.5} className="flex-shrink-0 mt-px" />
        <span>
          任務每週一重新開始，進度來自你實際完成的健身紀錄（{taskCount} / {MAX_WEEKLY_TASKS} 個任務）
        </span>
      </p>
      <p className="flex items-start gap-1.5">
        <Gift size={13} strokeWidth={2.5} className="flex-shrink-0 mt-px" />
        <span>每週最多領 {claimCap} 次任務獎勵。目標設得越高，獎勵越多；獎勵要在本週結束前領取。</span>
      </p>
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
