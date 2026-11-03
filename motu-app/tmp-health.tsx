/**
 * Throwaway: 健康頁 V2 with sample workouts, no login / Firestore. Delete after review.
 *
 * 網址參數：
 *   ?page=home|today|streak|trends|records|tasks|history   一打開停在哪一頁
 *   ?empty          沒有任何運動紀錄、沒有任務
 *   ?tasks=N        任務數（0–8，預設 2）
 *   ?long           長的任務名稱與項目名稱
 *   ?sparse         只有今天一筆紀錄（新玩家的第一天）
 *   ?focus=t3,t2    任務頁標出哪幾個任務（等同從首頁「重要提醒」點進來）
 *   ?legacy         資訊架構重整之前的舊版（legacy/），新舊對照用
 */
import { createRoot } from 'react-dom/client';
import './src/index.css';
import { HealthScreen } from './src/components/health/HealthView';
import { LegacyHealthScreen } from './src/components/health/legacy/HealthView';
import { ActivityHistory } from './src/components/health/ActivityHistoryPanel';
import { WeeklyTasks } from './src/components/health/WeeklyTaskPanel';
import {
  MAX_WEEKLY_TASKS,
  computeWeeklyTaskProgress,
  sortProgress,
  summariseWeek,
  weeklyCycleAt,
  type HealthActivity,
  type WeeklyTaskDefinition,
} from './src/constants/weeklyTasks';
import { rewardStatusFor, WEEKLY_TASK_REWARD_CLAIMS_PER_WEEK, type WeeklyTaskRewardStatus } from './src/constants/weeklyTaskRewards';

const params = new URLSearchParams(location.search);
const initialPage = (params.get('page') ?? 'home') as never;
const empty = params.has('empty');
const sparse = params.has('sparse');
const long = params.has('long');
const typeA = long ? '高抬腿原地跑步加強版' : '深蹲';
const typeB = '開合跳';
const now = Date.now();
const activities: HealthActivity[] = [];
if (sparse) {
  activities.push({ activityId: 'only', completedAt: new Date(now - 3600000).toISOString(), type: typeA, durationSeconds: 7 * 60, reps: 18 });
} else if (!empty) {
  let seed = 7;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let d = 0; d < 56; d++) {
    if (d > 0 && rand() < 0.45) continue;
    const sessions = rand() < 0.3 ? 2 : 1;
    for (let s = 0; s < sessions; s++) {
      const type = rand() < 0.55 ? typeA : typeB;
      const mins = 5 + Math.round(rand() * 10);
      const at = now - d * 86400000 - Math.round(rand() * 8 + s * 5) * 3600000;
      activities.push({ activityId: `a${d}-${s}`, completedAt: new Date(at).toISOString(), type, durationSeconds: mins * 60, reps: Math.round(mins * (1.5 + rand() * 1.5)) });
    }
  }
  activities.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
}

const cycle = weeklyCycleAt();
const TASK_POOL: WeeklyTaskDefinition[] = [
  { taskId: 't1', name: long ? '每週深蹲三次以上而且每次都要做滿' : `每週${typeA} 3 次`, metric: 'activity_type_count', activityType: typeA, target: 3, createdAt: '', startWeek: cycle.weekStart },
  { taskId: 't2', name: '每週運動 60 分鐘', metric: 'workout_minutes', target: 60, createdAt: '', startWeek: cycle.weekStart },
  { taskId: 't3', name: '每週動作 300 下', metric: 'workout_reps', target: 300, createdAt: '', startWeek: cycle.weekStart },
  { taskId: 't4', name: '每週運動 2 次', metric: 'workout_count', target: 2, createdAt: '', startWeek: cycle.weekStart },
  { taskId: 't5', name: '每週動作 600 下', metric: 'workout_reps', target: 600, createdAt: '', startWeek: cycle.weekStart },
  { taskId: 't6', name: '開合跳 5 次', metric: 'activity_type_count', activityType: typeB, target: 5, createdAt: '', startWeek: cycle.weekStart },
  { taskId: 't7', name: '每週運動 120 分鐘', metric: 'workout_minutes', target: 120, createdAt: '', startWeek: cycle.weekStart },
  { taskId: 't8', name: '每週運動 5 次', metric: 'workout_count', target: 5, createdAt: '', startWeek: cycle.weekStart },
];
const taskCount = empty ? 0 : Math.max(0, Math.min(MAX_WEEKLY_TASKS, Number(params.get('tasks') ?? 2)));
const tasks = TASK_POOL.slice(0, taskCount);
const rawProgress = sortProgress(tasks.map((t) => computeWeeklyTaskProgress(t, activities)));
const rewardStatus: Record<string, WeeklyTaskRewardStatus> = {};
for (const entry of rawProgress) rewardStatus[entry.task.taskId] = rewardStatusFor(entry, null);
const progress = [...rawProgress].sort(
  (a, b) => Number(rewardStatus[b.task.taskId].kind === 'claimable') - Number(rewardStatus[a.task.taskId].kind === 'claimable'),
);
const summary = summariseWeek(activities, progress);
const weeklyTaskView = {
  cycle,
  tasks,
  progress,
  summary,
  activities,
  loading: false,
  error: false,
  canCreate: tasks.length < MAX_WEEKLY_TASKS,
  rewardStatus,
  rewardClaims: { used: 0, cap: WEEKLY_TASK_REWARD_CLAIMS_PER_WEEK },
};
const refuse = async () => ({ ok: false as const, reason: 'no-profile' as const });

const legacy = params.has('legacy');
const Screen = legacy ? LegacyHealthScreen : HealthScreen;

createRoot(document.getElementById('root')!).render(
  <Screen
    view={{ loading: false, error: false, activities, progress, summary, rewardStatus }}
    onClose={() => alert('close')}
    onStartWorkout={() => alert('fitness')}
    initialPage={initialPage}
    renderPanel={(page: 'tasks' | 'history', options?: { focusTaskIds?: readonly string[] }) =>
      legacy ? (
        <p className="p-6 font-bold text-island-navy">[{page} panel — legacy]</p>
      ) : page === 'history' ? (
        <ActivityHistory activities={activities} loading={false} error={false} onStartWorkout={() => alert('fitness')} />
      ) : (
        <WeeklyTasks
          view={weeklyTaskView}
          focusTaskIds={options?.focusTaskIds?.length ? options.focusTaskIds : (params.get('focus')?.split(',') ?? [])}
          actions={{ create: refuse, update: refuse, remove: refuse, claim: refuse }}
        />
      )
    }
  />,
);

// 版面檢查：水平溢出、超出卡片的子元素、被 truncate 截斷的文字、兩欄底部的落差。在 console 裡跑 `__chk()`。
(window as unknown as { __chk: () => string }).__chk = () => {
  const s = document.querySelector('.fixed.inset-0.overflow-y-auto') as HTMLElement | null;
  if (!s) return 'no-scroller';
  const vw = innerWidth;
  const label = (e: Element) => `${e.tagName}.${String(e.className).slice(0, 36)} "${(e.textContent || '').trim().slice(0, 16)}"`;
  const over = [...document.querySelectorAll('body *')].filter((e) => {
    const b = e.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && (b.right > vw + 0.5 || b.left < -0.5);
  }).map(label);
  const clipped: string[] = [];
  for (const c of document.querySelectorAll('[class*="rounded-[1.75rem]"]')) {
    const cb = c.getBoundingClientRect();
    for (const k of c.querySelectorAll('*')) {
      const kb = k.getBoundingClientRect();
      if (kb.width > 0 && kb.height > 0 && (kb.right > cb.right + 1 || kb.left < cb.left - 1)) clipped.push(label(k));
    }
  }
  const truncated = [...document.querySelectorAll('.truncate')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => (e.textContent || '').trim().slice(0, 24));
  // 第一層的子頁容器：各個直接子元素（或兩欄的欄）底部在哪裡。
  const root = s.querySelector('.max-w-3xl')?.children[1]?.firstElementChild;
  const cols = new Map<number, number>();
  if (root) {
    for (const el of root.children) {
      const b = el.getBoundingClientRect();
      if (b.height === 0) continue;
      const x = Math.round(b.left);
      cols.set(x, Math.max(cols.get(x) ?? 0, Math.round(b.bottom + s.scrollTop)));
    }
  }
  return JSON.stringify({
    q: location.search,
    vw,
    vh: innerHeight,
    scrollH: s.scrollHeight,
    hScroll: s.scrollWidth > s.clientWidth,
    colBottoms: Object.fromEntries(cols),
    over: over.slice(0, 4),
    clipped: clipped.slice(0, 4),
    truncated: [...new Set(truncated)].slice(0, 6),
  });
};
