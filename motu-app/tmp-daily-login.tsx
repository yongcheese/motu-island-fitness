/**
 * Throwaway: the 每日登入 board, LIVE — press 領取 and the real celebration runs.
 *
 * This exists because the claim animation and its sound are unreachable in the app itself right
 * now: the panel only celebrates a claim that was actually written, and the write is being refused
 * (see firestore.rules — the update whitelist never learned the seven-day cycle's fields). The
 * animation was never broken; nothing was reaching it.
 *
 * So this page runs the same board with the same celebration and the same sound, against state held
 * in memory. Nothing here is a mock of the animation — `DailyLoginBoard`, `useCoinFlight`, the
 * `.daily-claim-*` CSS and `SoundEffect.COIN` are the app's own. The only thing replaced is where
 * the numbers live.
 *
 * Delete once the rules are deployed and the real panel can be watched instead.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Gift, RotateCcw } from 'lucide-react';
import './src/index.css';
import { DailyLoginBoard } from './src/components/UI/DailyLoginPanel';
import { buildSquares, resolveCycle } from './src/constants/dailyLogin';
import { PanelHeader, Button } from './src/components/UI/DesignKit';
import { playSound, SoundEffect } from './src/lib/soundUtils';

/** Day 3 of a round with days 1–2 already taken, so today's square is live and claimable. */
const cycle = resolveCycle('2026-03-10', new Date('2026-03-12T10:00:00+08:00'));

/** The panel's own count-up, reproduced here — it lives inside DailyLoginPanel and is not exported. */
function useCountUp(target: number, durationMs = 700): number {
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    const started = performance.now();
    let raf = 0;
    const step = (nowMs: number) => {
      const t = Math.min(1, (nowMs - started) / durationMs);
      setShown(Math.round(from + (target - from) * (1 - (1 - t) ** 3)));
      if (t < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); fromRef.current = target; };
  }, [target, durationMs]);
  return shown;
}

const CLAIM_FX_MS = 1100;

function Demo() {
  const [claimed, setClaimed] = useState<number[]>([1, 2]);
  const [balance, setBalance] = useState(4820);
  const [celebrating, setCelebrating] = useState<number | null>(null);
  const shownBalance = useCountUp(balance);

  const squares = buildSquares(cycle, new Set(claimed), true);

  // Exactly what DailyLoginPanel.handleClaim does after a successful write — the sound, the
  // celebration, and the balance moving. The write is the only thing missing.
  const claim = useCallback((day: number) => {
    const square = squares[day - 1];
    if (!square) return;
    playSound(SoundEffect.COIN);
    setClaimed(prev => [...prev, day].sort((a, b) => a - b));
    setBalance(prev => prev + square.prize.coins);
    setCelebrating(day);
    window.setTimeout(() => setCelebrating(null), CLAIM_FX_MS);
  }, [squares]);

  const reset = () => {
    setClaimed([1, 2]);
    setBalance(4820);
    setCelebrating(null);
  };

  return (
    <div className="min-h-screen bg-island-cream-2 p-4 flex flex-col items-center gap-4">
      <div className="w-full max-w-[980px] flex items-center justify-between gap-3">
        <p className="text-sm font-black text-island-navy">
          按下第 3 天的「領取」—— 金幣會飛進右上角的錢包，並播放 <code>SoundEffect.COIN</code>
        </p>
        <Button variant="secondary" onClick={reset} className="px-3 py-2 text-xs flex items-center gap-1.5">
          <RotateCcw size={13} strokeWidth={2.5} /> 重來
        </Button>
      </div>

      <div className="w-full max-w-[980px] bg-white rounded-3xl border border-island-line overflow-hidden shadow-xl">
        <PanelHeader icon={<Gift size={20} strokeWidth={2.5} />} title="每日登入獎勵" subtitle="每天回來看看，領取逐日增加的金幣！" />
        <DailyLoginBoard
          squares={squares}
          dayIndex={3}
          balance={balance}
          shownBalance={shownBalance}
          countdownMs={13 * 3600_000 + 41 * 60_000 + 7000}
          cycleId={cycle.cycleId}
          celebratingDay={celebrating}
          onClaim={(day) => claim(day)}
        />
      </div>

      {/* No second frame at a phone width here. The board's columns come from Tailwind's `md:`/`lg:`
          breakpoints, which measure the VIEWPORT and not the box the board is put in — a 390px-wide
          container on a desktop window still lays out eight columns and shows a squashed desktop
          board rather than the phone one. Narrow the window instead; the flight re-measures both
          ends on every claim, so its path is correct at whatever width it is watched at. */}
      <p className="text-xs font-bold text-island-navy-soft/70">
        想看手機版就把視窗拉窄再領一次 —— 金幣飛行會重新量測起點和終點。
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Demo />);
