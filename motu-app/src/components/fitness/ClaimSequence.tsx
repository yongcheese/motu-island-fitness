/**
 * 結束訓練後的逐項領獎（合體第二階段整合 Slice 10）—— `ctx.game.claim(awards)` 的畫面。
 *
 * 流程由 claimMachine.ts 的純狀態機決定，這裡只負責把每個階段畫出來：
 *
 *   1. 揭曉：照遊戲組每日登入的 `DailyClaimReveal`（變暗、光芒、閃光、三道光環、火花、彩帶、數字重擊）。
 *      直接沿用它在 index.css 的 `.daily-reveal-*` 動畫（遊戲樣式已複製進健身頁的 shadow root），
 *      不另寫一份；每一項以 key 重新掛載，動畫從頭再播一次。
 *      圖示：金幣＝鑄幣、經驗＝青色徽章＋遊戲組經驗條（同 TopBar 的「經驗 XP」）、碎片＝遊戲組 `FragmentShard`。
 *   2. 飛入：照每日登入 `DailyLoginPanel` 的飛幣（`.daily-coin-fly`，量兩端位置、中段上拋、縮小入袋），
 *      飛到頂端暫時滑入的資源列；抵達時該欄閃一下（`.daily-wallet-hit`）、數字滾動到新值。
 *   3. 輸入閘：動畫落定前、飛行中的輸入一律忽略；點擊、觸控、鍵盤都算「任意鍵」（按住不放的重複鍵不算）。
 *   4. 結尾：「按下任意鍵以繼續」→ 淡出 → `onDone`（宿主 resolve，健身頁進結算頁）。
 *
 * 金額以遊戲端為準：這裡只演 settle 回傳的清單，一個數字都不自己算。資源列的起點是宿主在呼叫 settle
 * **之前**記下的餘額（原因見 claimMachine.ts 的 `claimBarValues`）。
 *
 * 減少動畫：遊戲組的 CSS 已有降級（不旋轉、不飛、只淡入），彩帶以 `disableForReducedMotion` 關掉；
 * 其餘細節（飛入改淡入、資源列不滑）留給 Slice 13。
 */
import { useEffect, useId, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { motion } from 'motion/react';
import { Coins, Sparkles } from 'lucide-react';
import { ModalOverlay } from '../UI/DesignKit';
import { FragmentShard } from '../UI/FragmentProgress';
import { playSound, SoundEffect } from '../../lib/soundUtils';
import { vibrateGoldEarned } from '../../lib/vibration';
import { levelFromXp, xpIntoLevel, XP_PER_LEVEL } from '../../utils/level';
import type { Award, AwardKind, FitnessBalances } from './gameContract';
import {
  acceptsInput,
  claimBarKinds,
  claimBarValues,
  initialClaim,
  stepClaim,
  type ClaimEvent,
  type ClaimState,
} from './claimMachine';

/** 揭曉的大圖示停下來、一切綻放的時間點。與 index.css `.daily-reveal-*` 的延遲一致（遊戲組 REVEAL_SETTLE_MS）。 */
export const CLAIM_SETTLE_MS = 900;
/** 開始接受「領取」的時間點：同遊戲組 `SKIPPABLE_AT_MS`（落定後再 0.4 秒，數字與說明都已出現）。 */
export const CLAIM_READY_MS = CLAIM_SETTLE_MS + 400;
/** 飛行的顆數與每顆的間隔、單顆飛行時間（`.daily-coin-fly`：0.64s、`--i` × 55ms）。 */
export const FLIGHT_COUNT = 6;
const FLIGHT_STAGGER_MS = 55;
const FLIGHT_MS = 640;
/** 最後一顆抵達的時間 —— 這一刻才算入帳。 */
export const FLIGHT_LANDED_MS = FLIGHT_MS + (FLIGHT_COUNT - 1) * FLIGHT_STAGGER_MS;
/** 「按下任意鍵以繼續」淡入所需時間（`.daily-reveal-line` 0.5s），之後才接受最後一次輸入。 */
export const OUTRO_READY_MS = 500;
/** 結束時整層淡出（同 `.daily-reveal-layer.is-exiting` 0.28s）。 */
const EXIT_MS = 280;
/** 資源列數字滾動時間（同遊戲組每日登入 `COUNT_UP_MS`）。 */
const COUNT_UP_MS = 700;

// 彩帶顏色跟著獎勵走（遊戲組 DailyClaimReveal 的規則：金幣不炸青色、碎片不炸金色）
const GOLD = ['#E8AA3E', '#FFDF9E', '#B87C1C', '#FFFFFF'];
const TEAL = ['#2A9D8F', '#7FCFC3', '#1F7A6E', '#FFFFFF'];
const PRISM = ['#7FCFC3', '#9CC8F0', '#B7A4E8', '#F4A7A0', '#FFFFFF'];

const AWARD_COPY: Record<AwardKind, { name: string; note: string; colors: string[]; gold: boolean }> = {
  coins: { name: '金幣', note: '金幣已入袋', colors: GOLD, gold: true },
  xp: { name: '經驗值', note: '經驗值已入袋', colors: TEAL, gold: false },
  fragments: { name: '商品碎片', note: '商品碎片已放入背包', colors: PRISM, gold: false },
};

/** 數字滾到目標值（同遊戲組每日登入的 useCountUp；該檔未 export）。減少動畫時直接跳到目標。 */
function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      fromRef.current = target;
      setShown(target);
      return;
    }
    let raf = 0;
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / COUNT_UP_MS);
      setShown(Math.round(from + (target - from) * (1 - (1 - t) ** 3)));
      if (t < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      fromRef.current = target;
    };
  }, [target]);
  return shown;
}

/** 揭曉用的鑄幣：外框、滾邊、四角星浮雕 —— 照遊戲組 DailyClaimReveal 的 BigCoin 畫法（該元件未 export）。 */
function BigCoin({ size = 168 }: { size?: number }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden>
      <defs>
        <linearGradient id={`fx-coin-face-${uid}`} x1="30%" y1="8%" x2="70%" y2="96%">
          <stop offset="0%" stopColor="#FFF3D2" />
          <stop offset="48%" stopColor="#F2C260" />
          <stop offset="100%" stopColor="#C98A1E" />
        </linearGradient>
        <linearGradient id={`fx-coin-rim-${uid}`} x1="15%" y1="0%" x2="85%" y2="100%">
          <stop offset="0%" stopColor="#FFE6AC" />
          <stop offset="45%" stopColor="#E8AA3E" />
          <stop offset="100%" stopColor="#8A5C12" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="57" fill={`url(#fx-coin-rim-${uid})`} />
      <g stroke="#8A5C12" strokeWidth="1.4" opacity="0.4">
        {Array.from({ length: 28 }, (_, i) => {
          const a = (i / 28) * Math.PI * 2;
          return (
            <line
              key={i}
              x1={60 + Math.cos(a) * 57}
              y1={60 + Math.sin(a) * 57}
              x2={60 + Math.cos(a) * 50}
              y2={60 + Math.sin(a) * 50}
            />
          );
        })}
      </g>
      <circle cx="60" cy="60" r="49" fill={`url(#fx-coin-face-${uid})`} stroke="#B87C1C" strokeWidth="2" />
      <circle cx="60" cy="60" r="41" fill="none" stroke="#B87C1C" strokeWidth="1.6" opacity="0.5" />
      <path
        d="M60 32 L66 54 L88 60 L66 66 L60 88 L54 66 L32 60 L54 54 Z"
        fill="#8A5C12"
        opacity="0.38"
        transform="translate(1.5 2)"
      />
      <path d="M60 32 L66 54 L88 60 L66 66 L60 88 L54 66 L32 60 L54 54 Z" fill="#FFF7E2" opacity="0.92" />
      <path d="M28 40a36 36 0 0 1 26-22" stroke="#FFFBF0" strokeWidth="5" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

/** 經驗值的徽章：遊戲組 DailyClaimReveal 的 BigMedallion（青色款）＋閃光圖示。 */
function BigXpMedallion({ size = 168 }: { size?: number }) {
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden className="absolute inset-0">
        <circle cx="60" cy="60" r="57" fill="#A9E2D9" />
        <circle cx="60" cy="60" r="49" fill="#7FCFC3" stroke="#155F56" strokeWidth="2" />
        <circle cx="60" cy="60" r="41" fill="none" stroke="#155F56" strokeWidth="1.6" opacity="0.45" />
        <path d="M28 40a36 36 0 0 1 26-22" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" opacity="0.6" />
      </svg>
      <span className="relative text-[#155F56]">
        <Sparkles size={Math.round(size * 0.42)} strokeWidth={2.2} aria-hidden />
      </span>
    </div>
  );
}

function AwardMark({ kind }: { kind: AwardKind }) {
  if (kind === 'coins') return <BigCoin />;
  if (kind === 'xp') return <BigXpMedallion />;
  return <FragmentShard size={168} lit />;
}

/** 飛行中的一顆（資源列圖示的小尺寸）。 */
function FlightMark({ kind }: { kind: AwardKind }) {
  if (kind === 'coins') return <Coins size={18} className="text-island-gold" strokeWidth={2.5} aria-hidden />;
  if (kind === 'xp') return <Sparkles size={18} className="text-island-teal" strokeWidth={2.5} aria-hidden />;
  return <FragmentShard size={18} />;
}

/** 遊戲組 TopBar「經驗 XP」那條：奶油底軌、青色填充。 */
function XpBar({ xp, className = '' }: { xp: number; className?: string }) {
  const into = xpIntoLevel(xp);
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-island-cream-2 border border-island-line ${className}`}>
      <div className="h-full rounded-full bg-island-teal transition-[width] duration-200" style={{ width: `${(into / XP_PER_LEVEL) * 100}%` }} />
    </div>
  );
}

interface Flight {
  id: number;
  kind: AwardKind;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/** 頂端資源列的一欄。`hit` 時閃一下（遊戲組 `.daily-wallet-hit`）。 */
function BarChip({
  kind,
  value,
  hit,
  chipRef,
}: {
  kind: AwardKind;
  value: number;
  hit: boolean;
  chipRef: (el: HTMLDivElement | null) => void;
}) {
  const shown = useCountUp(value);
  if (kind === 'xp') {
    const level = levelFromXp(shown);
    return (
      <div ref={chipRef} className={`flex items-center gap-2 ${hit ? 'daily-wallet-hit' : ''}`} aria-label={`等級 ${level}，經驗 ${xpIntoLevel(value)} / ${XP_PER_LEVEL}`}>
        <Sparkles size={16} className="text-island-teal" strokeWidth={2.5} aria-hidden />
        <span className="font-mono text-xs font-black tracking-wider text-island-teal-dark">LV {level}</span>
        <XpBar xp={shown} className="w-16 sm:w-20" />
        <span className="tabular-nums text-island-navy-soft" aria-hidden>
          {xpIntoLevel(shown)}/{XP_PER_LEVEL}
        </span>
      </div>
    );
  }
  const label = kind === 'coins' ? `金幣 ${value}` : `本次商品碎片 ${value}`;
  return (
    <div ref={chipRef} className={`flex items-center gap-1.5 ${hit ? 'daily-wallet-hit' : ''}`} aria-label={label}>
      {kind === 'coins' ? (
        <Coins size={16} className="text-island-gold" strokeWidth={2.5} aria-hidden />
      ) : (
        <FragmentShard size={16} />
      )}
      <span className="tabular-nums" aria-hidden>
        {kind === 'fragments' ? `+${shown.toLocaleString()}` : shown.toLocaleString()}
      </span>
    </div>
  );
}

export function ClaimSequence({
  awards,
  before,
  onDone,
}: {
  /** 遊戲端 settle 回傳的清單（金幣 → 經驗 → 碎片，數量皆 > 0）。 */
  awards: Award[];
  /** 呼叫 settle 之前的餘額 —— 資源列從這裡開始加。 */
  before: Pick<FitnessBalances, 'coins' | 'xp'>;
  onDone: () => void;
}) {
  const [state, setState] = useState<ClaimState>(() => initialClaim(awards));
  const [flights, setFlights] = useState<Flight[]>([]);
  const [hitKind, setHitKind] = useState<AwardKind | null>(null);
  const [exiting, setExiting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chipRefs = useRef<Partial<Record<AwardKind, HTMLDivElement | null>>>({});
  const flightId = useRef(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const awardsRef = useRef(awards);
  awardsRef.current = awards;

  const send = (event: ClaimEvent) => setState((s) => stepClaim(s, event, awardsRef.current));
  // 彩帶用自己的畫布（遊戲組全域畫布在 z-index 100，會被這層蓋住；同 DailyClaimReveal）。整段序列一個，
  // 換階段不清掉，否則「可領取」那一刻會把還在飄的彩帶切掉。
  const fireRef = useRef<confetti.CreateTypes | null>(null);
  useEffect(() => {
    if (canvasRef.current) fireRef.current = confetti.create(canvasRef.current, { resize: true });
    return () => {
      fireRef.current?.reset();
      fireRef.current = null;
    };
  }, []);

  // 每個階段自己的計時：落定、飛抵、結尾。階段一換，上一段的計時全部取消（不會有遲到的事件）。
  useEffect(() => {
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));
    const award = awardsRef.current[state.index];

    if (state.phase === 'reveal' && award) {
      later(() => {
        fireRef.current?.({ particleCount: 90, spread: 78, startVelocity: 44, colors: AWARD_COPY[award.kind].colors, ticks: 120, origin: { x: 0.5, y: 0.42 }, disableForReducedMotion: true });
        playSound(SoundEffect.COIN);
        vibrateGoldEarned();
      }, CLAIM_SETTLE_MS);
      later(() => {
        fireRef.current?.({ particleCount: 55, spread: 120, startVelocity: 30, colors: AWARD_COPY[award.kind].colors, ticks: 120, origin: { x: 0.5, y: 0.42 }, disableForReducedMotion: true });
      }, CLAIM_SETTLE_MS + 150);
      later(() => send('settled'), CLAIM_READY_MS);
    }

    if (state.phase === 'flying' && award) {
      // 量兩端位置（同 DailyLoginPanel 的 useCoinFlight）：資源列在不同寬度位置不同，不能寫死
      const from = markRef.current?.getBoundingClientRect();
      const to = chipRefs.current[award.kind]?.getBoundingClientRect();
      if (from && to) {
        const sx = from.left + from.width / 2;
        const sy = from.top + from.height / 2;
        const ex = to.left + 12;
        const ey = to.top + to.height / 2;
        setFlights(
          Array.from({ length: FLIGHT_COUNT }, (_, i) => {
            const fan = (i - (FLIGHT_COUNT - 1) / 2) * 14;
            return { id: flightId.current++, kind: award.kind, x: sx + fan, y: sy + (i % 2) * 10, dx: ex - sx - fan, dy: ey - sy - (i % 2) * 10 };
          }),
        );
      }
      // 最後一顆抵達＝入帳；顆粒此時已縮小淡出（`.daily-coin-fly` 100%），一併清掉
      later(() => {
        setFlights([]);
        setHitKind(award.kind);
        send('landed');
      }, FLIGHT_LANDED_MS);
    }

    if (state.phase === 'outro-in') later(() => send('settled'), OUTRO_READY_MS);

    if (state.phase === 'done') {
      setExiting(true);
      later(() => onDoneRef.current(), EXIT_MS);
    }

    return () => timers.forEach(window.clearTimeout);
  }, [state.phase, state.index]);

  // 抵達的閃光只閃一次
  useEffect(() => {
    if (!hitKind) return;
    const t = window.setTimeout(() => setHitKind(null), 420);
    return () => window.clearTimeout(t);
  }, [hitKind, state.landed]);

  // 任意鍵：鍵盤（按住不放的重複鍵不算）＋點擊／觸控（見外層 onClick）。不接受輸入的階段由狀態機忽略。
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      e.preventDefault();
      send('input');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const award = awards[state.index];
  const kinds = claimBarKinds(awards);
  const values = claimBarValues(before, awards, state.landed);
  const ready = acceptsInput(state);
  const outro = state.phase === 'outro-in' || state.phase === 'outro' || state.phase === 'done';
  const announce = state.phase === 'ready' && award
    ? `獲得${AWARD_COPY[award.kind].name} ${award.amount}，按任意鍵領取`
    : state.phase === 'outro'
      ? '獎勵已全部領取，按下任意鍵以繼續'
      : '';

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="領取訓練獎勵"
      onClick={() => send('input')}
      className={`fixed inset-0 z-reveal outline-none select-none ${ready ? 'cursor-pointer' : ''}`}
    >
      <ModalOverlay
        zIndexClassName=""
        scrimClassName="bg-transparent"
        className={`daily-reveal-layer overflow-hidden ${exiting ? 'is-exiting' : ''}`}
      >
        <div className="daily-reveal-dim" />
        {award && state.phase !== 'flying' && (
          // 每一項重新掛載：遊戲組的揭曉動畫全是 CSS，換 key 才會從頭再播
          <div key={`fx-${state.index}`} className="contents">
            <div className="daily-reveal-rays" />
            <div className="daily-reveal-flash" />
            <div className="daily-reveal-burst" />
            <div className="daily-reveal-ring" />
            <div className="daily-reveal-ring daily-reveal-ring-2" />
            <div className="daily-reveal-ring daily-reveal-ring-3" />
          </div>
        )}

        {award && (
          <div
            key={`stage-${state.index}`}
            className={`daily-reveal-stage transition-opacity duration-200 ${state.phase === 'flying' ? 'opacity-0' : 'opacity-100'}`}
          >
            <div className="relative flex items-center justify-center">
              <div className="daily-reveal-glow" />
              <div className="daily-reveal-spin" style={{ ['--reveal-turns' as string]: 3 }}>
                <div ref={markRef} className="daily-reveal-coin">
                  <AwardMark kind={award.kind} />
                  <span className="daily-reveal-shine" aria-hidden />
                </div>
              </div>
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} className="daily-reveal-spark" style={{ ['--i' as string]: i }} aria-hidden />
              ))}
            </div>

            <div className="flex flex-col items-center gap-1.5 text-center">
              <span className="daily-reveal-line text-sm font-black tracking-[0.3em] text-white/90" style={{ animationDelay: `${CLAIM_SETTLE_MS}ms` }}>
                訓練獎勵 {state.index + 1} / {awards.length}
              </span>
              <div
                className={`daily-reveal-amount ${AWARD_COPY[award.kind].gold ? 'daily-reveal-amount-gold' : ''}`}
                style={{ animationDelay: `${CLAIM_SETTLE_MS + 110}ms` }}
              >
                +{award.amount.toLocaleString()}
              </div>
              <span className="daily-reveal-line text-xs font-black tracking-[0.2em] text-white/85" style={{ animationDelay: `${CLAIM_SETTLE_MS + 220}ms` }}>
                {AWARD_COPY[award.kind].note}
              </span>
              {award.kind === 'xp' && (
                // 經驗條：遊戲組 TopBar「經驗 XP」的樣式，顯示這次加完之後的等級進度
                <span
                  className="daily-reveal-line mt-3 flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2 text-xs font-black text-island-navy"
                  style={{ animationDelay: `${CLAIM_SETTLE_MS + 330}ms` }}
                >
                  <span className="font-mono tracking-wider text-island-teal-dark">LV {levelFromXp(before.xp + award.amount)}</span>
                  <XpBar xp={before.xp + award.amount} className="w-28" />
                  <span className="tabular-nums text-island-navy-soft">
                    {xpIntoLevel(before.xp + award.amount)} / {XP_PER_LEVEL}
                  </span>
                </span>
              )}
              <span
                className={`mt-5 rounded-full bg-white/90 px-4 py-1.5 text-xs font-black tracking-[0.2em] text-island-navy-soft transition-opacity duration-200 ${state.phase === 'ready' ? 'daily-reveal-hint opacity-100' : 'opacity-0'}`}
                style={state.phase === 'ready' ? { animationDelay: '0ms, 500ms' } : undefined}
              >
                按任意鍵領取
              </span>
            </div>
          </div>
        )}

        {outro && (
          <div className="daily-reveal-stage">
            <span className="daily-reveal-line text-sm font-black tracking-[0.3em] text-white/90">獎勵已全部入袋</span>
            <span
              className="daily-reveal-hint rounded-full bg-white/90 px-5 py-2 text-sm font-black tracking-[0.2em] text-island-navy-soft"
              style={{ animationDelay: '0ms, 500ms' }}
            >
              按下任意鍵以繼續
            </span>
          </div>
        )}

        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      </ModalOverlay>

      {/* 頂端資源列：領獎時滑入，獎勵飛進這裡（樣式同遊戲組 CurrencyChips／資源列 FitnessWallet） */}
      <motion.div
        initial={{ opacity: 0, y: -24 }}
        animate={{ opacity: exiting ? 0 : 1, y: exiting ? -24 : 0 }}
        transition={{ duration: 0.24, ease: 'easeOut' }}
        className="pointer-events-none absolute left-1/2 top-[max(1rem,env(safe-area-inset-top))] z-10 -translate-x-1/2"
      >
        <div role="group" aria-label="本次領獎" className="flex items-center gap-4 whitespace-nowrap rounded-2xl border border-island-line bg-white px-4 py-2 text-sm font-black text-island-navy shadow-sm">
          {kinds.map((kind, i) => (
            <div key={kind} className="flex items-center gap-4">
              {i > 0 && <span className="h-4 w-px bg-island-line" aria-hidden />}
              <BarChip
                kind={kind}
                value={values[kind]}
                hit={hitKind === kind}
                chipRef={(el) => {
                  chipRefs.current[kind] = el;
                }}
              />
            </div>
          ))}
        </div>
      </motion.div>

      {/* 飛行中的獎勵：裝飾用，入帳由資源列數字與報讀告知 */}
      <div className="pointer-events-none absolute inset-0 z-20" aria-hidden>
        {flights.map((f) => (
          <span
            key={f.id}
            className="daily-coin-fly"
            style={{
              ['--x' as string]: `${f.x}px`,
              ['--y' as string]: `${f.y}px`,
              ['--dx' as string]: `${f.dx}px`,
              ['--dy' as string]: `${f.dy}px`,
              ['--i' as string]: f.id % FLIGHT_COUNT,
            }}
          >
            <FlightMark kind={f.kind} />
          </span>
        ))}
      </div>

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
