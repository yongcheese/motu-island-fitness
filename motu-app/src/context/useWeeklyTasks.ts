/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db, doc, handleFirestoreError, OperationType, updateDoc } from '../lib/firebase';
import type { AuthUser } from '../auth/types';
import type { UserProfile } from '../types';
import { healthDataSource, type HealthActivity, type HealthDataAdapter } from '../lib/healthData';
import {
  applyWeeklyTaskEdit,
  computeWeeklyTaskProgress,
  hasErrors,
  makeWeeklyTask,
  markWeekCompleted,
  MAX_WEEKLY_TASKS,
  normalizeWeeklyTaskState,
  sortProgress,
  summariseWeek,
  validateWeeklyTaskDraft,
  weeklyCycleAt,
  type WeeklyCycle,
  type WeeklyHealthSummary,
  type WeeklyTaskDefinition,
  type WeeklyTaskDraft,
  type WeeklyTaskErrors,
  type WeeklyTaskProgress,
} from '../constants/weeklyTasks';

/**
 * 每週任務 Service — 任務的建立／編輯／刪除，以及把定義跟實際運動紀錄湊成進度。
 *
 * 形狀跟這個專案裡其他的寫入服務一樣（context/usePetCare.ts、context/useWorkoutRewards.ts），理
 * 由也一樣：規則是 constants/weeklyTasks.ts 裡的純函式，資料來源是 lib/healthData.ts 的轉接器，
 * 這裡只負責**寫**跟**把兩邊接起來**。元件拿到的是算好的 {@link WeeklyTaskProgress}，它自己不做
 * 任何一次除法。
 *
 * ## 進度不寫入存檔
 *
 * 每一次 render 的進度都是從 `workout_logs` 重算的。整個服務只有三種寫入會碰到玩家文件：建立、
 * 編輯、刪除 —— 全部都只動任務的**定義**。第四種寫入是達標紀錄
 * （{@link WeeklyTaskDefinition.completedWeeks}），它是一個冪等的標記，不是進度。
 *
 * 這是規格裡「進度來自實際的健康／運動紀錄，而不是單純由前端手動增加數字」唯一能真正保證的做
 * 法：沒有任何一個地方可以把進度 +1，因為根本沒有一個進度欄位可以被加。玩家做完一次健身，
 * `workout_logs` 多一筆（context/useWorkoutRewards.ts 寫的），訂閱立刻收到，畫面上的進度條就動
 * 了 —— 中間沒有任何一行程式碼需要記得去通知每週任務。
 *
 * ## 達標紀錄為什麼還是要寫
 *
 * 進度是算出來的，「這一週達標過」卻不完全是：本週的答案可以重算，上一週的也可以，但**再上上週
 * 的紀錄已經超出 `ACTIVITY_FETCH_LIMIT` 的視窗**，算不出來了。所以達標的那一刻寫一次標記，之後
 * 那一週的成就就不再依賴還讀不讀得到當時的紀錄。它同時讓慶祝回饋一週只出現一次。
 *
 * 寫入是冪等的（`markWeekCompleted` 已經記過就原樣回傳），而且失敗了也不影響進度 —— 進度本來就
 * 不是從它來的。
 */

/** 一次寫入做了什麼。`ok: false` 的每一種都是 UI 要講給玩家聽的狀態，不是例外。 */
export type WeeklyTaskOutcome =
  | { ok: true; task: WeeklyTaskDefinition }
  | { ok: false; reason: 'no-profile' | 'invalid' | 'not-found' | 'limit-reached' | 'save-failed'; errors?: WeeklyTaskErrors };

/** 刪除的結果。沒有 `task`，因為它已經不在了。 */
export type WeeklyTaskDeleteOutcome =
  | { ok: true; taskId: string }
  | { ok: false; reason: 'no-profile' | 'not-found' | 'save-failed' };

export interface WeeklyTaskView {
  /** 這一週的起訖。每分鐘重新確認一次 —— 見下面的跨週偵測。 */
  cycle: WeeklyCycle;
  /** 任務定義（正規化過的）。 */
  tasks: WeeklyTaskDefinition[];
  /** 算好的進度，已排序：進行中的在前。 */
  progress: WeeklyTaskProgress[];
  /** 這一週的總覽數字。 */
  summary: WeeklyHealthSummary;
  /** 活動紀錄，由新到舊。歷史那一區直接用。 */
  activities: HealthActivity[];
  /** 第一次載入還沒回來。UI 要顯示載入狀態而不是空狀態。 */
  loading: boolean;
  /** 訂閱失敗。UI 要顯示錯誤狀態而不是「你還沒運動過」。 */
  error: boolean;
  /** 還能不能再建一個。 */
  canCreate: boolean;
}

/**
 * 每隔多久重新確認一次「今天是哪一天」。
 *
 * 遊戲會被開著過夜，甚至跨過星期日午夜。沒有這個計時器的話，畫面上的「剩 1 天」會在星期一早上仍
 * 然寫著昨天的答案，而本週的進度會繼續算在已經結束的那一週裡 —— 一個純粹因為沒人重新 render 而
 * 產生的錯誤。60 秒是「最多慢一分鐘」與「不要每秒叫醒整棵樹」之間的取捨；只有在**日期真的變了**
 * 的時候才會觸發 re-render。
 */
const CLOCK_TICK_MS = 60_000;

export function useWeeklyTasks(
  user: AuthUser | null,
  profile: UserProfile | null,
  /** 把資料庫已經接受的值寫進本地 state — 見 AppContext。 */
  applyProfilePatch: (updates: Partial<UserProfile>) => void,
  adapter: HealthDataAdapter = healthDataSource,
) {
  const uid = user?.uid ?? null;

  const [activities, setActivities] = useState<HealthActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  /**
   * 目前這一刻，只在**日期／週期可能變了**的時候才更新。
   *
   * 存的是 `weekStart` 而不是一個 `Date`：每分鐘寫一個新的 `Date` 進 state 會讓底下每一張卡片每
   * 分鐘重畫一次，而其中 99% 的 tick 什麼都沒變。改存週期 id，只有真的跨週（或跨日，因為剩餘天
   * 數會變）時參考值才會變。
   */
  const [clockKey, setClockKey] = useState(() => clockKeyNow());

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = clockKeyNow();
      setClockKey((current) => (current === next ? current : next));
    }, CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  // 訂閱健康資料。換帳號時整份重來，不是沿用上一個玩家的紀錄。
  useEffect(() => {
    if (!uid) {
      setActivities([]);
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    const unsubscribe = adapter.subscribeActivities(
      uid,
      (next) => {
        setActivities(next);
        setLoading(false);
        setError(false);
      },
      () => {
        // 已經由 handleFirestoreError 回報過了（lib/healthData.ts）。這裡只負責讓畫面說實話：
        // 讀不到紀錄跟「沒有紀錄」不是同一件事，畫成空狀態會讓玩家以為自己的資料不見了。
        setLoading(false);
        setError(true);
      },
    );
    return unsubscribe;
  }, [uid, adapter]);

  /** 正規化過的任務定義。壞掉的資料在這裡被擋掉，而不是在某張卡片上變成 NaN。 */
  const tasks = useMemo(
    () => normalizeWeeklyTaskState(profile?.weeklyTasks).tasks ?? [],
    [profile?.weeklyTasks],
  );

  const view: WeeklyTaskView = useMemo(() => {
    // `clockKey` 只是依賴項：它一變就代表日期變了，這一整包要重算。
    void clockKey;
    const now = new Date();
    const cycle = weeklyCycleAt(now);
    const progress = sortProgress(
      tasks.map((task) => computeWeeklyTaskProgress(task, activities, now, cycle)),
    );
    return {
      cycle,
      tasks,
      progress,
      summary: summariseWeek(activities, progress, now, cycle),
      activities,
      loading,
      error,
      canCreate: tasks.length < MAX_WEEKLY_TASKS,
    };
  }, [tasks, activities, loading, error, clockKey]);

  /**
   * 寫入任務清單。
   *
   * 整份 `weeklyTasks` 一起寫，而不是 dotted path：一份最多八個元素的陣列沒有部分更新的必要，而
   * 「部分更新一個陣列」在 Firestore 裡本來就做不到（索引路徑寫法會在並行時互相蓋掉）。這裡也沒
   * 有心跳或背景寫入在競爭同一個欄位 —— 只有玩家自己按下的那三個按鈕會動它。
   */
  const writeTasks = useCallback(
    async (next: WeeklyTaskDefinition[]): Promise<boolean> => {
      if (!uid) return false;
      try {
        await updateDoc(doc(db, 'users', uid), { weeklyTasks: { tasks: next } });
      } catch (writeError) {
        console.error('[weekly] 每週任務沒有存檔成功：', writeError);
        handleFirestoreError(writeError, OperationType.UPDATE, `users/${uid}`);
        return false;
      }
      // 存進去了才改畫面。一個先動、失敗後又跳回去的任務列表，玩家沒有辦法分辨自己到底建立成功
      // 了沒有 —— 這是整個專案一致的規則（見 context/useUtilityCards.ts）。
      applyProfilePatch({ weeklyTasks: { tasks: next } });
      return true;
    },
    [uid, applyProfilePatch],
  );

  const createTask = useCallback(
    async (draft: WeeklyTaskDraft): Promise<WeeklyTaskOutcome> => {
      if (!uid || !profile) return { ok: false, reason: 'no-profile' };
      if (tasks.length >= MAX_WEEKLY_TASKS) return { ok: false, reason: 'limit-reached' };
      const errors = validateWeeklyTaskDraft(draft, tasks);
      if (hasErrors(errors)) return { ok: false, reason: 'invalid', errors };

      const task = makeWeeklyTask(draft);
      const saved = await writeTasks([...tasks, task]);
      return saved ? { ok: true, task } : { ok: false, reason: 'save-failed' };
    },
    [uid, profile, tasks, writeTasks],
  );

  const updateTask = useCallback(
    async (taskId: string, draft: WeeklyTaskDraft): Promise<WeeklyTaskOutcome> => {
      if (!uid || !profile) return { ok: false, reason: 'no-profile' };
      const current = tasks.find((task) => task.taskId === taskId);
      if (!current) return { ok: false, reason: 'not-found' };
      const errors = validateWeeklyTaskDraft(draft, tasks, taskId);
      if (hasErrors(errors)) return { ok: false, reason: 'invalid', errors };

      const edited = applyWeeklyTaskEdit(current, draft);
      const saved = await writeTasks(tasks.map((task) => (task.taskId === taskId ? edited : task)));
      return saved ? { ok: true, task: edited } : { ok: false, reason: 'save-failed' };
    },
    [uid, profile, tasks, writeTasks],
  );

  const deleteTask = useCallback(
    async (taskId: string): Promise<WeeklyTaskDeleteOutcome> => {
      if (!uid || !profile) return { ok: false, reason: 'no-profile' };
      if (!tasks.some((task) => task.taskId === taskId)) return { ok: false, reason: 'not-found' };
      const saved = await writeTasks(tasks.filter((task) => task.taskId !== taskId));
      return saved ? { ok: true, taskId } : { ok: false, reason: 'save-failed' };
    },
    [uid, profile, tasks, writeTasks],
  );

  /**
   * 剛剛達標、而且還沒慶祝過的那些任務。UI 拿它決定要不要放回饋。
   *
   * 是從 `view.progress` 讀出來的（算的），不是從存檔讀的 —— 存檔只負責記得「慶祝過了」。
   */
  const newlyCompleted = useMemo(
    () => view.progress.filter((entry) => entry.completed && !entry.celebrated),
    [view.progress],
  );

  /**
   * 把達標寫進存檔。
   *
   * 在一個 effect 裡做，而不是在渲染中做：這是一個寫入。`writingRef` 擋掉同一批在寫入完成前被重
   * 複觸發 —— 訂閱每收到一筆新紀錄就會重算一次進度，而那正好是達標發生的那一刻。
   */
  const writingRef = useRef(false);
  useEffect(() => {
    if (!uid || newlyCompleted.length === 0 || writingRef.current) return;
    writingRef.current = true;
    const weekStart = view.cycle.weekStart;
    const ids = new Set(newlyCompleted.map((entry) => entry.task.taskId));
    const next = tasks.map((task) => (ids.has(task.taskId) ? markWeekCompleted(task, weekStart) : task));
    void writeTasks(next).finally(() => {
      writingRef.current = false;
    });
  }, [uid, newlyCompleted, tasks, view.cycle.weekStart, writeTasks]);

  return { weeklyTaskView: view, createTask, updateTask, deleteTask, newlyCompleted };
}

/**
 * 「日期有沒有變」的比較值：本週的星期一 ＋ 今天。
 *
 * 兩個都要：跨週會換分母，跨日只會換剩餘天數，而兩者都必須讓畫面重算。
 */
function clockKeyNow(): string {
  const now = new Date();
  const cycle = weeklyCycleAt(now);
  return `${cycle.weekStart}|${Math.floor((now.getTime() - cycle.startMs) / 86_400_000)}`;
}
