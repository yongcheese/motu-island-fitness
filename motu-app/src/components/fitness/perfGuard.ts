/**
 * 訓練中的效能底線與「減少動畫」偏好（合體第二階段整合 Slice 13）。
 *
 * 訓練畫面同時跑三件吃資源的事：我方骨架辨識（MediaPipe）、右上角的 3D 主角、左下角阿肌的 SVG 循環。
 * 前者是產品本體，後兩者是裝飾，所以畫面掉幀時由裝飾讓路，順序固定：
 *
 *   等級 0：全開；
 *   等級 1：先暫停阿肌動畫（阿肌定格站著，不再輪播）；
 *   等級 2：再把主角畫布的解析度降到 {@link LOW_DPR}。
 *
 * 量的是頁面的繪製幀率（requestAnimationFrame 的間隔）：辨識與繪製在同一條主執行緒上，
 * 繪製掉到 24 以下代表辨識同樣被拖慢。只在訓練中量（陪伴主角掛上時 {@link perfGuard}.start）。
 *
 * 遲滯：往下降要連續 {@link DEGRADE_HOLD_MS} 低於 {@link FPS_FLOOR}，往回升要連續 {@link RECOVER_HOLD_MS}
 * 高於 {@link FPS_RECOVER}；兩個門檻之間是不動區。所以降級後幀率回到 25 也不會馬上恢復、再掉下來、
 * 來回切換（降級本身就會讓幀率回升，門檻若只有一條一定會來回彈）。每次換等級後重新計時，一次只走一級。
 *
 * 決策邏輯都是純函式（{@link stepPerf}、{@link fpsOver}、{@link motionPlan}），測試見 scripts/test-fitness-perf.ts。
 */
import { useSyncExternalStore } from 'react';

/** 訓練中最低可接受的幀率（驗收標準）。 */
export const FPS_FLOOR = 24;
/** 回升門檻：高於它夠久才恢復上一級。 */
export const FPS_RECOVER = 30;
/** 低於底線多久才降一級。 */
export const DEGRADE_HOLD_MS = 2000;
/** 高於回升門檻多久才升一級（比降級久：寧可多讓一會兒，也不要來回閃）。 */
export const RECOVER_HOLD_MS = 8000;
/** 幀率的量測窗：最近這麼久裡畫了幾幀。 */
export const FPS_WINDOW_MS = 1000;
/** 多久取一次樣、推進一次決策。 */
export const SAMPLE_MS = 500;
/** 等級 2 的主角畫布像素比（原本 1–2，依裝置）。 */
export const LOW_DPR = 0.75;
export const MAX_LEVEL = 2;

export type PerfLevel = 0 | 1 | 2;

export interface PerfState {
  level: PerfLevel;
  /** 連續低於底線從何時開始；null＝目前不低。 */
  lowSince: number | null;
  /** 連續高於回升門檻從何時開始；null＝目前不高。 */
  highSince: number | null;
}

export function initialPerf(): PerfState {
  return { level: 0, lowSince: null, highSince: null };
}

/**
 * 依最新一次取樣推進降級狀態。`fps` 為 null（量測窗還不滿、分頁剛回到前景）時不做決定、計時歸零。
 * 狀態沒變時回傳同一個參考。
 */
export function stepPerf(state: PerfState, fps: number | null, now: number): PerfState {
  if (fps === null) {
    return state.lowSince === null && state.highSince === null ? state : { ...state, lowSince: null, highSince: null };
  }
  if (fps < FPS_FLOOR) {
    const lowSince = state.lowSince ?? now;
    if (state.level < MAX_LEVEL && now - lowSince >= DEGRADE_HOLD_MS) {
      // 降一級，並從現在重新計時：下一級要再撐滿一整段才降，給這一級生效的時間
      return { level: (state.level + 1) as PerfLevel, lowSince: now, highSince: null };
    }
    return lowSince === state.lowSince && state.highSince === null ? state : { ...state, lowSince, highSince: null };
  }
  if (fps >= FPS_RECOVER) {
    const highSince = state.highSince ?? now;
    if (state.level > 0 && now - highSince >= RECOVER_HOLD_MS) {
      return { level: (state.level - 1) as PerfLevel, lowSince: null, highSince: now };
    }
    return highSince === state.highSince && state.lowSince === null ? state : { ...state, lowSince: null, highSince };
  }
  // 不動區：兩邊的計時都中斷
  return state.lowSince === null && state.highSince === null ? state : { ...state, lowSince: null, highSince: null };
}

/**
 * 最近 `windowMs` 內的幀率。`frames` 是各幀的時間戳（遞增）。
 * 量測窗裡的資料還不夠涵蓋整個窗（剛開始量）時回傳 null。
 */
export function fpsOver(frames: readonly number[], now: number, windowMs = FPS_WINDOW_MS): number | null {
  const start = now - windowMs;
  if (!frames.length || frames[0] > start) return null;
  let count = 0;
  for (let i = frames.length - 1; i >= 0 && frames[i] > start; i -= 1) count += 1;
  return (count * 1000) / windowMs;
}

export interface MotionPlan {
  /** 阿肌要不要動（輪播＋循環）。 */
  coachAnimated: boolean;
  /** 主角與其他裝飾的循環（推薦卡主角示範、加油揮手、提示字呼吸）要不要播。 */
  loops: boolean;
  /** 主角畫布的像素比；null＝照預設（1–2）。 */
  heroDpr: number | null;
}

/** 「減少動畫」偏好＋降級等級 → 各元件該怎麼動。 */
export function motionPlan(reduced: boolean, level: PerfLevel): MotionPlan {
  return {
    coachAnimated: !reduced && level < 1,
    loops: !reduced,
    heroDpr: level >= 2 ? LOW_DPR : null,
  };
}

// ---------------------------------------------------------------------------
// 執行期：全頁一個量測器（訓練中才跑），元件以 hook 訂閱

type Listener = () => void;

function createPerfGuard() {
  let state = initialPerf();
  let users = 0;
  let raf = 0;
  let timer = 0;
  let frames: number[] = [];
  let last: number | null = null;
  const listeners = new Set<Listener>();
  const notify = () => [...listeners].forEach((fn) => fn());

  const tick = (t: number) => {
    frames.push(t);
    // 只留量測窗內的（多留一格，fpsOver 靠第一格判斷窗滿了沒）
    const cut = t - FPS_WINDOW_MS - SAMPLE_MS;
    while (frames.length > 1 && frames[1] < cut) frames.shift();
    raf = requestAnimationFrame(tick);
  };
  const sample = () => {
    const now = performance.now();
    // 背景分頁不繪製，不能當成掉幀
    const fps = document.hidden ? null : fpsOver(frames, now);
    if (document.hidden) frames = [];
    last = fps;
    const next = stepPerf(state, fps, now);
    if (next.level !== state.level && import.meta.env?.DEV) {
      console.info(`[perfGuard] 幀率 ${fps} → 降級等級 ${state.level} → ${next.level}`);
    }
    const changed = next.level !== state.level;
    state = next;
    if (changed) notify();
  };

  return {
    /** 開始量（可重入；每個 start 對應一個 stop）。 */
    start() {
      users += 1;
      if (users > 1 || typeof requestAnimationFrame === 'undefined') return;
      frames = [];
      raf = requestAnimationFrame(tick);
      timer = window.setInterval(sample, SAMPLE_MS);
    },
    /** 停止量；最後一個使用者離開時回到等級 0（下一場重新判斷）。 */
    stop() {
      users = Math.max(0, users - 1);
      if (users > 0) return;
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
      frames = [];
      last = null;
      const was = state.level;
      state = initialPerf();
      if (was !== 0) notify();
    },
    level: (): PerfLevel => state.level,
    /** 最近一次取樣的幀率（除錯與實測用）。 */
    lastFps: () => last,
    subscribe(fn: Listener) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export const perfGuard = createPerfGuard();

const serverLevel = (): PerfLevel => 0;
/** 目前的降級等級（訓練外恆為 0）。 */
export function usePerfLevel(): PerfLevel {
  return useSyncExternalStore(perfGuard.subscribe, perfGuard.level, serverLevel);
}

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';
function subscribeReduced(fn: Listener) {
  const mq = typeof window !== 'undefined' ? window.matchMedia?.(REDUCE_QUERY) : undefined;
  mq?.addEventListener('change', fn);
  return () => mq?.removeEventListener('change', fn);
}
const readReduced = () => (typeof window !== 'undefined' && window.matchMedia?.(REDUCE_QUERY).matches) || false;
const serverReduced = () => false;
/** 使用者是否開啟「減少動畫」；系統設定一改就跟著變（不用重新整理）。 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, readReduced, serverReduced);
}

/** 以上兩者合起來：各元件直接拿結果用。 */
export function useMotionPlan(): MotionPlan {
  return motionPlan(usePrefersReducedMotion(), usePerfLevel());
}
