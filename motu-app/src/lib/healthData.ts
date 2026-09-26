/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 健康資料來源 — 「這個玩家做過哪些運動」的唯一入口。
 *
 * ## 為什麼要有這一層
 *
 * 每週任務要算的是「這一週運動了幾次」，而不是「`users/<uid>/workout_logs` 這個集合裡
 * `timestamp` 落在這一週的文件有幾份」。第二句話把功能綁死在**目前**這個原型上：欄位叫
 * `counts`、卡路里是推估的、紀錄是健身畫面自己寫的。規格直接要求「若運動系統仍屬於暫時性或模擬
 * 實作，請使用抽象介面隔離資料來源」，這個檔案就是那個介面。
 *
 *   健身原型 →  workout_logs  ─┐
 *                               ├→ HealthDataAdapter → HealthActivity[] → 每週任務 / 總覽 / 歷史
 *   未來的健康 API →  (轉接器) ─┘
 *
 * 上游換掉的時候，改動是這裡多一個 adapter；{@link HealthActivity} 的形狀、進度計算
 * （constants/weeklyTasks.ts）與所有畫面都不動。
 *
 * ## 目前真的拿得到什麼
 *
 * {@link WORKOUT_LOG_METRICS} 是這個轉接器能餵飽的目標類型清單，而它是從 `workout_logs` 實際寫
 * 進去的欄位推出來的（見 context/useWorkoutRewards.ts）：次數、時間、動作次數、推估卡路里。
 * 步數不在裡面，而且沒有任何地方會假裝它在 —— 見 constants/weeklyTasks.ts 的 `steps`。
 */

import { collection, db, handleFirestoreError, limit, onSnapshot, OperationType, orderBy, query } from './firebase';
import type { WorkoutLog } from '../types';
import type { HealthActivity, WeeklyTaskMetric } from '../constants/weeklyTasks';

export type { HealthActivity };

/**
 * 一個健康資料來源要會做的事。
 *
 * 只有訂閱，沒有單次查詢：遊戲裡每一個顯示健康數字的地方都要在玩家運動完的當下自己更新，而一個
 * 「查一次」的 API 會讓每個畫面各自決定什麼時候重查 —— 那正是進度條停在舊數字的來源。
 */
export interface HealthDataAdapter {
  /** 這個來源識別用的名字，顯示在健康頁的「資料來源」區塊。 */
  readonly id: string;
  readonly label: string;
  /** 這個來源餵得動哪些目標類型。UI 拿它來說明哪些類型目前有資料。 */
  readonly supportedMetrics: readonly WeeklyTaskMetric[];
  /**
   * 這個來源**知道自己產得出**哪些運動項目。
   *
   * 跟「紀錄裡出現過哪些項目」是兩回事，而這個差別決定了一個還沒運動過的玩家能不能建立「每週深蹲
   * 3 次」這種任務：只看紀錄的話，選單是空的，玩家被自己的零紀錄鎖在門外。
   */
  readonly knownActivityTypes: readonly string[];
  /**
   * 訂閱一個玩家的活動紀錄，由新到舊。立刻回報一次目前的內容，之後每次變動再回報。
   *
   * `onError` 是分開的一個參數而不是丟出例外：訂閱是非同步的，錯誤會在呼叫端的 try/catch 早就結
   * 束之後才發生。
   */
  subscribeActivities(
    userId: string,
    onActivities: (activities: HealthActivity[]) => void,
    onError?: (error: unknown) => void,
  ): () => void;
}

/**
 * 一次抓多少筆紀錄。
 *
 * 每週任務只需要本週的紀錄，但「歷史」那一區要能往回看，而總覽要算本週總量 —— 一個只抓 10 筆的
 * 查詢（舊的追蹤頁就是）在一個勤勞的玩家身上連本週都湊不齊。200 筆對一個一週練幾次的人來說是好
 * 幾個月，而且它是一個 limit 而不是沒有上限：沒有上限的查詢遲早會在某個帳號上變成一次巨大的讀取。
 */
export const ACTIVITY_FETCH_LIMIT = 200;

/** 這個轉接器餵得動的目標類型。跟 constants/weeklyTasks.ts 的 `available` 標記必須一致。 */
export const WORKOUT_LOG_METRICS: readonly WeeklyTaskMetric[] = [
  'workout_count',
  'workout_minutes',
  'workout_reps',
  'calories',
  'activity_type_count',
];

/**
 * 把一筆 `workout_logs` 文件翻成一個 {@link HealthActivity}。
 *
 * 這是整個遊戲裡唯一知道 `counts` 是「動作次數」的地方。壞掉的欄位在這裡被補成 0，而不是往下游
 * 傳一個 `undefined` —— 一個 `undefined` 加進總和裡會變成 NaN，而 NaN 畫出來是一條空白的進度條，
 * 不是一個錯誤。
 */
export function activityFromWorkoutLog(log: Partial<WorkoutLog>): HealthActivity | null {
  const completedAt = typeof log.timestamp === 'string' ? log.timestamp : null;
  if (!completedAt || !Number.isFinite(Date.parse(completedAt))) return null;
  return {
    activityId: typeof log.logId === 'string' && log.logId ? log.logId : `log-${completedAt}`,
    completedAt,
    type: typeof log.type === 'string' && log.type ? log.type : '運動',
    durationSeconds: numberOr(log.duration, 0),
    reps: numberOr(log.counts, 0),
    calories: numberOr(log.calories, 0),
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

/**
 * 目前的實作：讀 `workout_logs`。
 *
 * 走 lib/firebase.ts 的門面，所以訪客（localStorage）與登入帳號（Firestore）是同一段程式碼 ——
 * 每週任務因此不需要知道存檔跑到哪裡去了，也就不會在訪客模式下安靜地讀不到東西。
 */
/**
 * 健身原型目前做得出來的運動項目。
 *
 * 字串必須跟 components/FitnessView.tsx 傳給 `makeWorkoutCompletion` 的 `workoutType` 一模一樣，
 * 因為 `activity_type_count` 是拿它們做字串比對的。之所以是一份清單而不是從紀錄裡掃出來，見
 * {@link HealthDataAdapter.knownActivityTypes}。
 */
export const PROTOTYPE_ACTIVITY_TYPES = ['開合跳', '深蹲'] as const;

export const workoutLogAdapter: HealthDataAdapter = {
  id: 'workout-logs',
  label: '遊戲內健身紀錄',
  supportedMetrics: WORKOUT_LOG_METRICS,
  knownActivityTypes: PROTOTYPE_ACTIVITY_TYPES,
  subscribeActivities(userId, onActivities, onError) {
    const path = `users/${userId}/workout_logs`;
    const logsRef = collection(db, 'users', userId, 'workout_logs');
    const q = query(logsRef, orderBy('timestamp', 'desc'), limit(ACTIVITY_FETCH_LIMIT));

    return onSnapshot(
      q,
      (snapshot: { docs: Array<{ data: () => unknown }> }) => {
        const activities: HealthActivity[] = [];
        for (const docSnapshot of snapshot.docs) {
          const activity = activityFromWorkoutLog(docSnapshot.data() as Partial<WorkoutLog>);
          if (activity) activities.push(activity);
        }
        // 由新到舊。本地存檔的 `list()` 是照 localStorage 的 key 順序回來的，不保證排序，所以排
        // 序在這裡做一次，而不是相信查詢的 orderBy —— 兩條路徑要給出同一個順序。
        activities.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
        onActivities(activities);
      },
      (error: unknown) => {
        handleFirestoreError(error, OperationType.GET, path);
        onError?.(error);
      },
    );
  },
};

/**
 * 遊戲目前用的來源。
 *
 * 具名成一個常數而不是讓每個呼叫端自己 import `workoutLogAdapter`，是為了讓「換來源」是改這一
 * 行。等到真的有第二個來源，這裡會變成一個依設定挑選的函式，而呼叫端仍然一行都不用改。
 */
export const healthDataSource: HealthDataAdapter = workoutLogAdapter;

/** 某個目標類型現在有沒有資料可以餵。UI 用它來灰掉選項並說明原因。 */
export function isMetricSupported(metric: WeeklyTaskMetric, adapter: HealthDataAdapter = healthDataSource): boolean {
  return adapter.supportedMetrics.includes(metric);
}

/**
 * `activity_type_count` 的下拉選單內容：來源宣告的項目 ＋ 紀錄裡真的出現過的項目。
 *
 * 兩邊都要，而且順序上先放宣告的那些：新玩家（沒有任何紀錄）看得到完整的選項，而一個從舊版本或
 * 未來的 API 帶進來、清單上沒有的項目也不會從自己的任務裡消失。
 */
export function selectableActivityTypes(
  activities: readonly HealthActivity[],
  adapter: HealthDataAdapter = healthDataSource,
): string[] {
  const seen: string[] = [];
  const push = (type: string) => {
    if (type && !seen.includes(type)) seen.push(type);
  };
  for (const type of adapter.knownActivityTypes) push(type);
  for (const activity of activities) push(activity.type);
  return seen;
}
