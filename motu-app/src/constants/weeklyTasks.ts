/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 每週任務 — 週期、目標類型、進度計算與驗證。這裡沒有 React，也沒有 Firestore。
 *
 * 這是功能的「規則」那一半；`lib/healthData.ts` 負責資料從哪裡來，`context/useWeeklyTasks.ts`
 * 負責存檔，`components/health/` 負責畫面。四者分開的理由跟 constants/dailyLogin.ts 當初分開的
 * 理由一樣：一個要調整「一週從星期幾開始」或「幾次算完成」的人，不該需要打開任何一個元件；而
 * 一個元件也不該是遊戲規則被發現的地方。
 *
 * 這個檔案的 API 由 scripts/test-weekly-tasks.ts（`npm run test:weekly-tasks`）釘住。
 *
 * ## 進度是「算出來的」，不是「存起來的」
 *
 * 任務只存**定義**（名字、目標類型、目標數值）。目前進度永遠是從實際的運動紀錄重新算出來的
 * （{@link computeWeeklyTaskProgress}）。這是刻意的，而且是規格裡「不要用假的固定數值冒充實際
 * 運動紀錄」那一條唯一站得住的做法：
 *
 *  - 一個存起來的 `progress` 數字，跟它聲稱代表的運動紀錄之間沒有任何約束。兩者一旦不同步（漏寫
 *    一次、寫了兩次、跨週沒有重設），畫面上那條進度條就開始說謊，而且沒有任何辦法發現。
 *  - 從紀錄算出來的進度，重新整理後必然還在 —— 因為紀錄本來就在存檔裡。規格裡「任務完成狀態不
 *    應因單純重新整理頁面而遺失」因此是個結構性的保證，不是一個要小心維護的行為。
 *  - 跨週不需要任何寫入。週期是從時鐘推導出來的（{@link weeklyCycleAt}），所以星期一凌晨零點一
 *    到，本週的分母自己就換了一批運動紀錄，沒有任何「建立新週期」的排程需要在對的時間跑起來。
 *
 * 唯一存起來的進度相關資料是 {@link WeeklyTaskDefinition.completedWeeks} —— 已經達標過的那幾週。
 * 它不是進度來源（進度還是重算的），它是給「這一週的達標畫面只慶祝一次」與歷史紀錄用的。
 */

import {
  addCivilDays,
  civilDateAt,
  civilDaysBetween,
  civilEnd,
  civilStart,
  civilWeekday,
  type CivilDate,
} from './civilTime';

export type { CivilDate };

// --- 週期 --------------------------------------------------------------------

/**
 * 一週從星期幾開始。1 = 星期一。
 *
 * 明確寫出來而不是靠 `Date` 的預設，因為 JavaScript 的 `getDay()` 以星期日為 0，而中文語境裡
 * 「這禮拜」幾乎都是從星期一算起。規格要求「明確定義每週起始日與結束日」，這一行就是那個定義，
 * 而且它是唯一的一份 —— UI 顯示的起訖日期跟進度用的時間範圍都從 {@link weeklyCycleAt} 出來。
 */
export const WEEK_START_WEEKDAY = 1;

/** 一週七天。具名而不是散落的 `7`，因為剩餘天數、週期長度與進度條都各讀一次。 */
export const DAYS_PER_WEEK = 7;

/** 一段任務週期：起訖的日曆日，以及對應的絕對時間區間（半開區間 `[startMs, endMs)`）。 */
export interface WeeklyCycle {
  /** 這一週的星期一，`YYYY-MM-DD`（遊戲時區）。同時是這個週期的 id。 */
  weekStart: CivilDate;
  /** 這一週的星期日，`YYYY-MM-DD`。 */
  weekEnd: CivilDate;
  /** `weekStart` 的午夜，UTC 毫秒。用來篩選運動紀錄。 */
  startMs: number;
  /** `weekEnd` 結束的那一刻（＝下週一的午夜），**不包含**。 */
  endMs: number;
}

/** 某個日曆日所屬那一週的星期一。 */
export function weekStartFor(date: CivilDate): CivilDate {
  const weekday = civilWeekday(date);
  // `+ 7` 讓結果在 JS 的 `%` 對負數回傳負值時仍然是 0..6。
  const offset = (weekday - WEEK_START_WEEKDAY + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return addCivilDays(date, -offset);
}

/** 某一刻落在哪個週期裡。所有「本週」的判斷都從這裡出發。 */
export function weeklyCycleAt(now: Date = new Date()): WeeklyCycle {
  return cycleFromWeekStart(weekStartFor(civilDateAt(now)));
}

/** 由週一日期組出整個週期。導出的是同一組數字，所以 UI 與計算不可能各算各的。 */
export function cycleFromWeekStart(weekStart: CivilDate): WeeklyCycle {
  const weekEnd = addCivilDays(weekStart, DAYS_PER_WEEK - 1);
  return {
    weekStart,
    weekEnd,
    startMs: civilStart(weekStart),
    endMs: civilEnd(weekEnd),
  };
}

// --- 目標類型 ----------------------------------------------------------------

/**
 * 一個每週任務可以追蹤什麼。
 *
 * 每一個都必須對應到**目前真的拿得到的數字**，否則它會是一條永遠停在 0 的進度條。目前系統實際
 * 產生的運動資料只有四種（見 lib/healthData.ts 與 context/useWorkoutRewards.ts 寫進
 * `workout_logs` 的欄位）：次數、時間、動作次數、卡路里。
 *
 * {@link WeeklyTaskMetric} 裡仍然列出 `steps`，而且它被明確標成「尚未支援」。把它留在型別裡而不
 * 是假裝它不存在，是因為規格直接問到步數：一個列在這裡、在 UI 上被標為灰色並寫明原因的目標類
 * 型，會讓「這個遊戲量不到步數」變成一件玩家看得到的事；把它刪掉只會讓下一個人重新問一次。接上
 * 計步資料的那一天，改動是 {@link METRIC_SPECS} 裡的一個 `available: true` 加上
 * lib/healthData.ts 裡的一個轉接器，不是一次資料結構重做。
 */
export type WeeklyTaskMetric =
  | 'workout_count'
  | 'workout_minutes'
  | 'workout_reps'
  | 'calories'
  | 'activity_type_count'
  | 'steps';

/** 一種目標類型長什麼樣子：怎麼稱呼、用什麼單位、目前有沒有資料。 */
export interface WeeklyTaskMetricSpec {
  id: WeeklyTaskMetric;
  /** 表單與卡片上的名字。 */
  label: string;
  /** 數值後面那個字：次、分鐘、大卡。 */
  unit: string;
  /** 表單上的一行說明，講清楚這個數字實際上從哪裡來。 */
  hint: string;
  /** 建立任務時預填的目標值 —— 一個合理的一週份量，不是 1。 */
  defaultTarget: number;
  /** 目標值的下限與上限，表單驗證用。 */
  minTarget: number;
  maxTarget: number;
  /** 目標值要不要允許小數。時間與卡路里也用整數，因為玩家不會設 2.5 分鐘的週目標。 */
  step: number;
  /** 目前有沒有資料來源。false 代表 UI 要把它標示為尚未支援並擋下建立。 */
  available: boolean;
  /** `available === false` 時，為什麼。直接顯示給玩家看。 */
  unavailableReason?: string;
  /** 需不需要再指定一個運動項目（只有 `activity_type_count`）。 */
  needsActivityType?: boolean;
}

/**
 * 目標類型的表。新增一種目標就是這裡加一列 ＋ {@link measureActivity} 裡加一個 case。
 *
 * 排序就是表單上的顯示順序：先放最好懂的「幾次」，最後放尚未支援的那一個。
 */
export const METRIC_SPECS: readonly WeeklyTaskMetricSpec[] = [
  {
    id: 'workout_count',
    label: '每週運動次數',
    unit: '次',
    hint: '完成一次健身就 +1，不論做了多久。',
    defaultTarget: 3,
    minTarget: 1,
    maxTarget: 50,
    step: 1,
    available: true,
  },
  {
    id: 'workout_minutes',
    label: '每週運動時間',
    unit: '分鐘',
    hint: '把這一週每次健身的時間加起來。',
    defaultTarget: 60,
    minTarget: 5,
    maxTarget: 2000,
    step: 5,
    available: true,
  },
  {
    id: 'workout_reps',
    label: '每週累積動作次數',
    unit: '下',
    hint: '開合跳與深蹲偵測到的動作次數總和。',
    defaultTarget: 200,
    minTarget: 10,
    maxTarget: 20000,
    step: 10,
    available: true,
  },
  {
    id: 'calories',
    label: '每週消耗卡路里',
    unit: '大卡',
    hint: '由運動時間與動作次數推估，不是實測值。',
    defaultTarget: 300,
    minTarget: 10,
    maxTarget: 20000,
    step: 10,
    available: true,
  },
  {
    id: 'activity_type_count',
    label: '每週完成指定運動',
    unit: '次',
    hint: '只計算你指定的那一種運動。',
    defaultTarget: 3,
    minTarget: 1,
    maxTarget: 50,
    step: 1,
    available: true,
    needsActivityType: true,
  },
  {
    id: 'steps',
    label: '每週累積步數',
    unit: '步',
    hint: '需要計步資料來源。',
    defaultTarget: 30000,
    minTarget: 1000,
    maxTarget: 500000,
    step: 1000,
    available: false,
    unavailableReason: '遊戲目前沒有計步資料來源，接上穿戴裝置或健康 API 後才會開放。',
  },
] as const;

/** 目標類型的規格。未知的 id 回 null —— 舊存檔裡被移除的類型走的就是這條路。 */
export function getMetricSpec(metric: string): WeeklyTaskMetricSpec | null {
  return METRIC_SPECS.find((spec) => spec.id === metric) ?? null;
}

/** 現在真的可以建立的目標類型。表單只列這些。 */
export function availableMetrics(): WeeklyTaskMetricSpec[] {
  return METRIC_SPECS.filter((spec) => spec.available);
}

/** 列出來但還沒有資料來源的目標類型。健康頁的「資料來源」區塊照這份清單說明。 */
export function unsupportedMetrics(): WeeklyTaskMetricSpec[] {
  return METRIC_SPECS.filter((spec) => !spec.available);
}

// --- 任務定義 ----------------------------------------------------------------

/** 一個玩家自訂的每週任務。存在 `profile.weeklyTasks.tasks` 裡。 */
export interface WeeklyTaskDefinition {
  taskId: string;
  /** 玩家自己取的名字。 */
  name: string;
  metric: WeeklyTaskMetric;
  /** 目標數值，單位由 {@link WeeklyTaskMetricSpec.unit} 決定。 */
  target: number;
  /** `metric === 'activity_type_count'` 時，要計算哪一種運動（例如「深蹲」）。 */
  activityType?: string;
  /** 建立時間，ISO 字串。列表排序用。 */
  createdAt: string;
  /** 最後一次編輯時間。沒編輯過就沒有這個欄位。 */
  updatedAt?: string;
  /**
   * 這個任務從哪一週開始生效（該週的星期一）。
   *
   * 存起來是為了兩件事：任務卡上的「開始日期」在跨週後仍然說得出實話，以及在任務建立之前的那幾
   * 週不會被算成「當時就已經過期」。它不是進度來源。
   */
  startWeek: CivilDate;
  /**
   * 已經達標過的那幾週（每個元素是該週的星期一）。
   *
   * 進度**不是**從這裡來的（見檔頭）。它的用途是：跨週之後仍然知道上週有沒有完成，以及讓達標的
   * 慶祝回饋一週只出現一次。有上限（{@link COMPLETED_WEEKS_LIMIT}），因為這是一份存在玩家文件裡
   * 的清單，而不是一份無限成長的日誌。
   */
  completedWeeks?: CivilDate[];
}

/** 存在 `profile.weeklyTasks` 的那一整包。一個巢狀 map，理由同 `workoutRewards`：它只佔一個欄位。 */
export interface WeeklyTaskState {
  tasks?: WeeklyTaskDefinition[];
}

/** 一個帳號最多能有幾個每週任務。 */
export const MAX_WEEKLY_TASKS = 8;

/** 任務名稱長度上限。跟 firestore.rules 的檢查同一個數字。 */
export const TASK_NAME_MAX = 24;

/** `completedWeeks` 最多保留幾週，約半年。 */
export const COMPLETED_WEEKS_LIMIT = 26;

// --- 健康資料 ----------------------------------------------------------------

/**
 * 一次活動，正規化之後的樣子 —— 每週任務唯一認得的輸入。
 *
 * 刻意不是 `WorkoutLog`。`WorkoutLog` 是目前這個原型寫進 Firestore 的那張表，欄位名（`counts`、
 * `goldEarned`）帶著它自己的歷史；而每週任務要能在資料來源換掉之後照樣運作。兩者之間的翻譯只在
 * lib/healthData.ts 的轉接器裡做一次，所以換一個資料來源是改一個檔案，不是改每一個計算。
 */
export interface HealthActivity {
  activityId: string;
  /** ISO 字串。 */
  completedAt: string;
  /** 運動項目名稱，例如「開合跳」。 */
  type: string;
  durationSeconds: number;
  /** 偵測到的動作次數。沒有動作概念的活動（例如跑步）是 0。 */
  reps: number;
  /** 大卡。目前是推估值 —— 見 {@link METRIC_SPECS} 裡 `calories` 的 hint。 */
  calories: number;
}

// --- 進度 --------------------------------------------------------------------

/** 一個任務在某一週的狀態。 */
export type WeeklyTaskStatus = 'upcoming' | 'active' | 'completed' | 'expired';

/** 剩餘時間怎麼講。分開成一個 union，讓「還剩 0 天」不會被寫成一句誤導人的話。 */
export type WeeklyRemaining =
  | { kind: 'days'; days: number }
  | { kind: 'due_today' }
  | { kind: 'expired'; daysAgo: number };

/** 一個任務算完之後的全貌 —— 卡片需要的每一個數字都在這裡，元件不再自己算任何一個。 */
export interface WeeklyTaskProgress {
  task: WeeklyTaskDefinition;
  cycle: WeeklyCycle;
  spec: WeeklyTaskMetricSpec | null;
  /** 這一週實際累積到多少。**不設上限** —— 超額完成是真的超額。 */
  current: number;
  target: number;
  /** 進度條用，0..1，已經夾在上限內。 */
  ratio: number;
  /** 顯示用的百分比，0..100 的整數，同樣已經夾住。 */
  percent: number;
  /** 沒有夾住的百分比。超額時 UI 才有辦法說「140%」而不必自己重算。 */
  rawPercent: number;
  completed: boolean;
  status: WeeklyTaskStatus;
  remaining: WeeklyRemaining;
  /**
   * 本週還剩幾天，**含今天**。已過期是 0。
   *
   * 含今天，因為「還剩 1 天」在星期六被讀成「今天加明天」會是錯的 —— 星期六還有兩天可以動。
   * {@link WeeklyTaskProgress.remaining} 是同一個數字的顯示版本：`daysRemaining === 1` 時它會
   * 變成「今天最後一天」而不是「剩 1 天」，因為這兩句話給人的急迫感差很多。
   */
  daysRemaining: number;
  /** 這一週是不是已經被記進 `completedWeeks`。用來決定要不要放慶祝動畫。 */
  celebrated: boolean;
}

/** 一次活動對某個任務貢獻多少。未知的目標類型貢獻 0，而不是拋錯 —— 見 {@link computeWeeklyTaskProgress}。 */
export function measureActivity(activity: HealthActivity, task: WeeklyTaskDefinition): number {
  switch (task.metric) {
    case 'workout_count':
      return 1;
    case 'workout_minutes':
      return Math.max(0, activity.durationSeconds) / 60;
    case 'workout_reps':
      return Math.max(0, activity.reps);
    case 'calories':
      return Math.max(0, activity.calories);
    case 'activity_type_count':
      return task.activityType && activity.type === task.activityType ? 1 : 0;
    case 'steps':
      // 沒有資料來源，所以是 0 —— 不是「先給個數字之後再說」。見 METRIC_SPECS。
      return 0;
    default:
      return 0;
  }
}

/** 這一週的數字要怎麼顯示。時間取整數分鐘，其餘本來就是整數。 */
export function roundMetricValue(metric: WeeklyTaskMetric, value: number): number {
  if (metric === 'workout_minutes') return Math.round(value);
  return Math.round(value);
}

/**
 * 算出一個任務在某一週的完整狀態。
 *
 * `activities` 可以是任何範圍的紀錄 —— 這個函式自己會濾出落在週期內的那些。呼叫端不需要先篩，
 * 也就不可能篩錯。
 */
export function computeWeeklyTaskProgress(
  task: WeeklyTaskDefinition,
  activities: readonly HealthActivity[],
  now: Date = new Date(),
  cycle: WeeklyCycle = weeklyCycleAt(now),
): WeeklyTaskProgress {
  const spec = getMetricSpec(task.metric);
  const today = civilDateAt(now);

  let current = 0;
  for (const activity of activities) {
    const at = Date.parse(activity.completedAt);
    // 無法解析的時間戳不算數。一筆壞掉的紀錄不該讓整條進度條變成 NaN。
    if (!Number.isFinite(at)) continue;
    if (at < cycle.startMs || at >= cycle.endMs) continue;
    current += measureActivity(activity, task);
  }
  current = roundMetricValue(task.metric, current);

  const target = Math.max(1, task.target);
  const rawRatio = current / target;
  const ratio = Math.min(1, Math.max(0, rawRatio));
  const completed = current >= target;

  // 「剩幾天」永遠從今天算到這一週的星期日，而不是任何寫死的數字。
  const daysToEnd = civilDaysBetween(today, cycle.weekEnd);
  const daysRemaining = daysToEnd >= 0 ? daysToEnd + 1 : 0;
  const remaining: WeeklyRemaining =
    daysToEnd > 0
      ? { kind: 'days', days: daysRemaining }
      : daysToEnd === 0
        ? { kind: 'due_today' }
        : { kind: 'expired', daysAgo: -daysToEnd };

  const startsLater = civilDaysBetween(task.startWeek, cycle.weekStart) < 0;
  const status: WeeklyTaskStatus = startsLater
    ? 'upcoming'
    : completed
      ? 'completed'
      : daysToEnd < 0
        ? 'expired'
        : 'active';

  return {
    task,
    cycle,
    spec,
    current,
    target,
    ratio,
    percent: Math.round(ratio * 100),
    rawPercent: Math.round(rawRatio * 100),
    completed,
    status,
    remaining,
    daysRemaining,
    celebrated: (task.completedWeeks ?? []).includes(cycle.weekStart),
  };
}

/** 這一週的總覽數字。健康總覽那一區直接讀這個，不再自己 reduce 一次。 */
export interface WeeklyHealthSummary {
  cycle: WeeklyCycle;
  workouts: number;
  minutes: number;
  reps: number;
  calories: number;
  /** 完成的任務數 / 任務總數（只算這一週生效的任務）。 */
  tasksCompleted: number;
  tasksActive: number;
}

/** 把一週的活動與任務收斂成總覽那幾個數字。 */
export function summariseWeek(
  activities: readonly HealthActivity[],
  progress: readonly WeeklyTaskProgress[],
  now: Date = new Date(),
  cycle: WeeklyCycle = weeklyCycleAt(now),
): WeeklyHealthSummary {
  let workouts = 0;
  let seconds = 0;
  let reps = 0;
  let calories = 0;
  for (const activity of activities) {
    const at = Date.parse(activity.completedAt);
    if (!Number.isFinite(at)) continue;
    if (at < cycle.startMs || at >= cycle.endMs) continue;
    workouts += 1;
    seconds += Math.max(0, activity.durationSeconds);
    reps += Math.max(0, activity.reps);
    calories += Math.max(0, activity.calories);
  }
  const live = progress.filter((entry) => entry.status !== 'upcoming');
  return {
    cycle,
    workouts,
    minutes: Math.round(seconds / 60),
    reps,
    calories: Math.round(calories),
    tasksCompleted: live.filter((entry) => entry.completed).length,
    tasksActive: live.length,
  };
}

// --- 驗證 --------------------------------------------------------------------

/** 表單送出來的東西 —— 還沒有 id，數值還是字串，因為那是 `<input>` 給的。 */
export interface WeeklyTaskDraft {
  name: string;
  metric: string;
  target: string | number;
  activityType?: string;
}

/** 欄位 → 錯誤訊息。空物件代表通過。逐欄回報，因為表單要把訊息放在對應的欄位底下。 */
export type WeeklyTaskErrors = Partial<Record<'name' | 'metric' | 'target' | 'activityType' | 'form', string>>;

/**
 * 驗證一份草稿。建立與編輯共用同一份規則 —— 兩套規則遲早會分岔。
 *
 * `existing` 是目前已有的任務（編輯時要排除自己），用來擋重複名稱與數量上限。
 */
export function validateWeeklyTaskDraft(
  draft: WeeklyTaskDraft,
  existing: readonly WeeklyTaskDefinition[] = [],
  editingTaskId?: string,
): WeeklyTaskErrors {
  const errors: WeeklyTaskErrors = {};
  const others = existing.filter((task) => task.taskId !== editingTaskId);

  if (!editingTaskId && others.length >= MAX_WEEKLY_TASKS) {
    errors.form = `每週任務最多 ${MAX_WEEKLY_TASKS} 個，請先刪除一個再建立。`;
  }

  const name = draft.name.trim();
  if (!name) {
    errors.name = '請輸入任務名稱。';
  } else if (name.length > TASK_NAME_MAX) {
    errors.name = `名稱請控制在 ${TASK_NAME_MAX} 個字以內。`;
  } else if (others.some((task) => task.name.trim() === name)) {
    errors.name = '已經有同名的任務了。';
  }

  const spec = getMetricSpec(draft.metric);
  if (!spec) {
    errors.metric = '請選擇目標類型。';
  } else if (!spec.available) {
    errors.metric = spec.unavailableReason ?? '這個目標類型目前還沒有資料來源。';
  }

  const target = typeof draft.target === 'number' ? draft.target : Number(String(draft.target).trim());
  if (!String(draft.target).trim()) {
    errors.target = '請輸入目標數值。';
  } else if (!Number.isFinite(target)) {
    errors.target = '目標數值必須是數字。';
  } else if (!Number.isInteger(target)) {
    errors.target = '目標數值請填整數。';
  } else if (spec && target < spec.minTarget) {
    errors.target = `至少要 ${spec.minTarget} ${spec.unit}。`;
  } else if (spec && target > spec.maxTarget) {
    errors.target = `最多 ${spec.maxTarget} ${spec.unit}。`;
  }

  if (spec?.needsActivityType && !draft.activityType?.trim()) {
    errors.activityType = '請選擇要計算哪一種運動。';
  }

  return errors;
}

/** 驗證結果有沒有問題。`Object.keys(...).length === 0` 散在四處會被寫錯一次。 */
export function hasErrors(errors: WeeklyTaskErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** 把通過驗證的草稿變成一個任務定義。id 與日期在這裡生成，呼叫端忘不掉。 */
export function makeWeeklyTask(draft: WeeklyTaskDraft, now: Date = new Date()): WeeklyTaskDefinition {
  const spec = getMetricSpec(draft.metric);
  const target = typeof draft.target === 'number' ? draft.target : Number(String(draft.target).trim());
  return {
    taskId: newTaskId(),
    name: draft.name.trim(),
    metric: (spec?.id ?? 'workout_count') as WeeklyTaskMetric,
    target: Math.round(target),
    ...(spec?.needsActivityType && draft.activityType?.trim()
      ? { activityType: draft.activityType.trim() }
      : {}),
    createdAt: now.toISOString(),
    startWeek: weekStartFor(civilDateAt(now)),
    completedWeeks: [],
  };
}

function newTaskId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `wt-${crypto.randomUUID()}`;
  return `wt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 把編輯過的欄位套回一個既有任務。`taskId`、`createdAt`、`startWeek` 與達標紀錄永遠保留。 */
export function applyWeeklyTaskEdit(
  task: WeeklyTaskDefinition,
  draft: WeeklyTaskDraft,
  now: Date = new Date(),
): WeeklyTaskDefinition {
  const spec = getMetricSpec(draft.metric);
  const target = typeof draft.target === 'number' ? draft.target : Number(String(draft.target).trim());
  const next: WeeklyTaskDefinition = {
    ...task,
    name: draft.name.trim(),
    metric: (spec?.id ?? task.metric) as WeeklyTaskMetric,
    target: Math.round(target),
    updatedAt: now.toISOString(),
  };
  if (spec?.needsActivityType && draft.activityType?.trim()) {
    next.activityType = draft.activityType.trim();
  } else {
    delete next.activityType;
  }
  return next;
}

/** 記下「這一週達標了」。已經記過就原樣回傳，所以呼叫端可以無腦呼叫。 */
export function markWeekCompleted(task: WeeklyTaskDefinition, weekStart: CivilDate): WeeklyTaskDefinition {
  const weeks = task.completedWeeks ?? [];
  if (weeks.includes(weekStart)) return task;
  // 由舊到新排序後只留最後 N 筆，所以砍掉的一定是最舊的那幾週。
  const next = [...weeks, weekStart].sort().slice(-COMPLETED_WEEKS_LIMIT);
  return { ...task, completedWeeks: next };
}

/**
 * 讀存檔時的防線：把任何形狀不對的東西丟掉，而不是讓它一路長到畫面上。
 *
 * 存檔是使用者裝置上的 JSON，可能來自舊版本、被手動改過、或是寫到一半斷掉。一個 `target` 是字串
 * 的任務會讓進度條變成 NaN，而 NaN 不會拋錯 —— 它會安靜地畫出一條空白的條。
 */
export function normalizeWeeklyTaskState(raw: unknown): WeeklyTaskState {
  if (typeof raw !== 'object' || raw === null) return { tasks: [] };
  const tasks = (raw as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return { tasks: [] };

  const seen = new Set<string>();
  const cleaned: WeeklyTaskDefinition[] = [];
  for (const entry of tasks) {
    if (typeof entry !== 'object' || entry === null) continue;
    const task = entry as Partial<WeeklyTaskDefinition>;
    if (typeof task.taskId !== 'string' || !task.taskId) continue;
    if (seen.has(task.taskId)) continue;
    if (typeof task.name !== 'string' || !task.name.trim()) continue;
    if (typeof task.target !== 'number' || !Number.isFinite(task.target) || task.target <= 0) continue;
    if (typeof task.metric !== 'string' || !getMetricSpec(task.metric)) continue;

    seen.add(task.taskId);
    cleaned.push({
      taskId: task.taskId,
      name: task.name,
      metric: task.metric as WeeklyTaskMetric,
      target: Math.round(task.target),
      ...(typeof task.activityType === 'string' && task.activityType
        ? { activityType: task.activityType }
        : {}),
      createdAt: typeof task.createdAt === 'string' ? task.createdAt : new Date(0).toISOString(),
      ...(typeof task.updatedAt === 'string' ? { updatedAt: task.updatedAt } : {}),
      startWeek:
        typeof task.startWeek === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(task.startWeek)
          ? task.startWeek
          : weekStartFor(civilDateAt(new Date())),
      completedWeeks: Array.isArray(task.completedWeeks)
        ? task.completedWeeks.filter((week): week is string => typeof week === 'string').slice(-COMPLETED_WEEKS_LIMIT)
        : [],
    });
    if (cleaned.length >= MAX_WEEKLY_TASKS) break;
  }
  return { tasks: cleaned };
}

/** 任務列表的顯示順序：還沒完成的排前面，其次是建立時間。 */
export function sortProgress(entries: readonly WeeklyTaskProgress[]): WeeklyTaskProgress[] {
  const rank: Record<WeeklyTaskStatus, number> = { active: 0, upcoming: 1, completed: 2, expired: 3 };
  return [...entries].sort((a, b) => {
    const byStatus = rank[a.status] - rank[b.status];
    if (byStatus !== 0) return byStatus;
    return a.task.createdAt.localeCompare(b.task.createdAt);
  });
}
