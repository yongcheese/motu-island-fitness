/**
 * 訓練畫面的亮色背景＋教練阿肌（合體第二階段整合 Slice 6，取代骨架 BackdropSkeleton）。
 *
 * 畫在健身頁的 `backdrop` 插槽（相機畫面底下那一層）。相機影像用 object-fit: contain 置中、
 * 兩側或上下的空白是透明的，這一層就從那裡透出來。所以：
 *   - 背景只做低對比的淺色漸層＋柔和圖形，不和骨架判定色搶注意力；
 *   - 阿肌要站在「相機畫面外」的空白裡。空白有多大取決於視窗比例與相機實際比例（要的是 4:3，
 *     但有些鏡頭給 16:9），所以每次尺寸或相機一變就重算位置（coachPlacement，純函式可測）；
 *     真的擠不下時縮到下限，被相機蓋住一部分也不會反過來遮到相機。
 *   - 阿肌輪流示範深蹲與開合跳（CoachSprite 的 squat／jack 姿勢）。
 *   - 減少動畫開啟、或訓練中掉幀（perfGuard 等級 ≥ 1）時阿肌定格：停輪播，CoachSprite 的循環以
 *     `MotionConfig skipAnimations` 直接落在第一格站姿（遊戲組元件不改，換 key 重新掛載才會生效）。
 */
import { useEffect, useRef, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { CoachSprite, type CoachExercisePose } from '../UI/CoachSprite';
import { useMotionPlan } from './perfGuard';

/** 阿肌 viewBox 的高寬比（140×144）。 */
const COACH_RATIO = 144 / 140;
/** 阿肌最多佔畫面高度的比例（設計要點：不超過 35%）。 */
export const COACH_MAX_HEIGHT_RATIO = 0.35;
/** 擠不下時的最小寬度：CoachSprite 的設計下限是手機上 84px 寬，再小就認不出動作。 */
export const COACH_MIN_SIZE = 72;
const MARGIN = 16;
/** 阿肌腳底與控制鈕之間的間距。 */
const GAP_ABOVE_CONTROLS = 12;

export interface StageMetrics {
  /** 訓練畫面（插槽）寬高，px。 */
  width: number;
  height: number;
  /** 相機影像實際寬高；還沒有影像（示範模式、相機還沒開）時為 0，以要求的 4:3 估算。 */
  videoWidth: number;
  videoHeight: number;
  /** 控制鈕列上緣離畫面頂端的距離，px；量不到時為 null。 */
  controlsTop: number | null;
}

export interface CoachPlacement {
  /** 阿肌寬度（高度＝寬 × 144/140）。 */
  size: number;
  left: number;
  top: number;
  /** side＝相機左側的空白；below＝相機下方、控制鈕上方的空白（手機直式）。 */
  area: 'side' | 'below';
}

/** 依畫面、相機比例與控制鈕位置算出阿肌的位置與大小。 */
export function coachPlacement(m: StageMetrics): CoachPlacement {
  const W = Math.max(0, m.width);
  const H = Math.max(0, m.height);
  const aspect = m.videoWidth > 0 && m.videoHeight > 0 ? m.videoWidth / m.videoHeight : 4 / 3;
  // object-fit: contain 之後相機影像在畫面中的框
  const camW = Math.min(W, H * aspect);
  const camH = Math.min(H, W / aspect);
  const camLeft = (W - camW) / 2;
  const camBottom = (H + camH) / 2;
  // 腳底站在控制鈕上方；量不到控制鈕時以底部 170px（數據列＋控制鈕）估算
  const floor = (m.controlsTop ?? H - 170) - GAP_ABOVE_CONTROLS;

  const maxSize = (H * COACH_MAX_HEIGHT_RATIO) / COACH_RATIO;
  const sideSize = Math.min(maxSize, camLeft - 2 * MARGIN);
  const belowSize = Math.min(maxSize, (floor - camBottom - 8) / COACH_RATIO, W * 0.3);

  const area = belowSize > sideSize ? 'below' : 'side';
  // 下限不得超過 35% 上限（極矮的視窗以上限為準）
  const size = Math.max(Math.min(COACH_MIN_SIZE, maxSize), Math.min(maxSize, Math.max(sideSize, belowSize)));
  const top = Math.max(0, floor - size * COACH_RATIO);
  // 左側空白置中；空白比阿肌窄時貼齊左邊界
  const left = area === 'side' ? Math.max(MARGIN, (camLeft - size) / 2) : MARGIN;
  return { size: Math.round(size), left: Math.round(left), top: Math.round(top), area };
}

/** 輪播順序與每段長度：各做幾個完整循環（深蹲 2.2 秒 × 3、開合跳 1.3 秒 × 5）。 */
export const COACH_ROTATION: readonly { pose: CoachExercisePose; ms: number }[] = [
  { pose: 'squat', ms: 6600 },
  { pose: 'jack', ms: 6500 },
];

export function nextRotationIndex(index: number): number {
  return (index + 1) % COACH_ROTATION.length;
}

function readMetrics(root: HTMLElement): StageMetrics {
  const stage = root.getBoundingClientRect();
  // 插槽與相機、控制鈕是同一個訓練畫面（.lv-wrap）裡的兄弟節點（都在 shadow root 內）
  const wrap = root.closest('.lv-wrap') ?? root.parentElement;
  const video = wrap?.querySelector('video') ?? null;
  const ctrls = wrap?.querySelector('.lv-ctrls') ?? null;
  const ctrlsRect = ctrls?.getBoundingClientRect();
  return {
    width: stage.width,
    height: stage.height,
    videoWidth: video?.videoWidth ?? 0,
    videoHeight: video?.videoHeight ?? 0,
    controlsTop: ctrlsRect && ctrlsRect.height > 0 ? ctrlsRect.top - stage.top : null,
  };
}

export function CoachBackdrop() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CoachPlacement | null>(null);
  const [turn, setTurn] = useState(0);
  const { coachAnimated } = useMotionPlan();

  // 位置：畫面尺寸或相機比例一變就重算
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () => {
      const next = coachPlacement(readMetrics(root));
      setPlace((prev) =>
        prev && prev.size === next.size && prev.left === next.left && prev.top === next.top ? prev : next,
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(root);
    const video = root.closest('.lv-wrap')?.querySelector('video');
    video?.addEventListener('loadedmetadata', update);
    video?.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      video?.removeEventListener('loadedmetadata', update);
      video?.removeEventListener('resize', update);
    };
  }, []);

  // 輪播：深蹲 → 開合跳 → 深蹲…（定格時停在目前這個動作）
  useEffect(() => {
    if (!coachAnimated) return;
    const timer = window.setTimeout(() => setTurn(nextRotationIndex), COACH_ROTATION[turn].ms);
    return () => window.clearTimeout(timer);
  }, [turn, coachAnimated]);

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 overflow-hidden bg-gradient-to-br from-island-cream via-[#E6F6F1] to-[#FFF1D6]"
    >
      {/* 柔和圖形：大面積、低不透明度的圓與底部海浪，只在相機畫面外看得到 */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-[12vmax] -top-[14vmax] h-[42vmax] w-[42vmax] rounded-full bg-[radial-gradient(circle,rgba(95,189,175,0.22),transparent_68%)]" />
        <div className="absolute -right-[10vmax] top-[18%] h-[36vmax] w-[36vmax] rounded-full bg-[radial-gradient(circle,rgba(232,170,62,0.16),transparent_68%)]" />
        <div className="absolute bottom-[8%] left-[30%] h-[28vmax] w-[28vmax] rounded-full bg-[radial-gradient(circle,rgba(42,157,143,0.12),transparent_70%)]" />
        <svg className="absolute inset-x-0 bottom-0 h-[22%] w-full" viewBox="0 0 1440 200" preserveAspectRatio="none">
          <path d="M0 90 C240 40 480 140 720 90 C960 40 1200 140 1440 90 V200 H0 Z" fill="#5FBDAF" opacity="0.14" />
          <path d="M0 130 C260 90 520 170 780 128 C1040 88 1260 160 1440 124 V200 H0 Z" fill="#2A9D8F" opacity="0.1" />
        </svg>
      </div>

      {place && (
        <div className="absolute" style={{ left: place.left, top: place.top, width: place.size }}>
          {/* 落地陰影（Slice 12）：同陪伴主角的做法，站在淺色背景上才不像飄著；寬度隨阿肌縮放 */}
          <span
            aria-hidden="true"
            className="absolute -bottom-1 left-1/2 h-[10%] w-[78%] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(38,70,83,0.2),transparent)]"
          />
          {/* 已在跑的無限循環不會因設定改變而停，所以動／不動各用一個 key，切換時重新掛載 */}
          <MotionConfig skipAnimations={!coachAnimated}>
            <CoachSprite
              key={coachAnimated ? 'live' : 'still'}
              className="relative block h-auto w-full"
              pose={COACH_ROTATION[turn].pose}
            />
          </MotionConfig>
        </div>
      )}
    </div>
  );
}
