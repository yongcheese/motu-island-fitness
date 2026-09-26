/**
 * Throwaway: every kind of 每日登入 prize on screen at once, plus the 領取揭曉 stage for each.
 *
 * The real panel can only ever show ONE round, and a round shows at most four or five of the seven
 * prize kinds — so watching the feature in the app proves the day it happens to be and nothing
 * else. This renders several rounds' boards side by side (chosen so that between them they cover
 * 商品碎片, 金幣, 金幣＋碎片, 功能卡, 抽獎券, 商品 and 免費轉盤) against the app's OWN components:
 * `DailyLoginBoard`, `DailyClaimReveal`, the real `buildSquares` and the real prize roll.
 *
 * Delete once the round has been watched in the app across a full week.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './src/index.css';
import { DailyLoginBoard } from './src/components/UI/DailyLoginPanel';
import { DailyClaimReveal } from './src/components/UI/DailyClaimReveal';
import { addCivilDays, buildSquares, resolveCycle, CYCLE_LENGTH } from './src/constants/dailyLogin';
import { resolveDailyPrize, emptyAward, type DailyPrizeAward } from './src/constants/dailyLoginPrizes';

/** Rounds picked by `tmp-probe-daily.ts` so that between them every prize kind appears. */
const ANCHORS = ['2026-03-10', '2026-03-17', '2026-03-24', '2026-04-07'];

/** The award a claim of that day would produce, with nothing capped and nothing already owned. */
function awardFor(cycleId: string, day: number): DailyPrizeAward {
  const resolved = resolveDailyPrize(cycleId, day, []);
  const { prize } = resolved;
  return {
    ...emptyAward(prize.kind),
    coins: prize.coins,
    fragmentItemId: resolved.fragmentItemId,
    fragmentsKept: prize.itemFragments,
    tickets: prize.tickets,
    cardId: resolved.cardId,
    cardsGranted: prize.cards,
    itemId: resolved.itemId,
    spins: prize.spins,
  };
}

/**
 * `?round=2026-03-17&day=2` opens that day's 領取揭曉 on load.
 *
 * The reveal is a full-screen overlay, so unlike the boards it cannot be tiled — one screenshot
 * shows exactly one of them. A query parameter is how a headless pass gets through all seven
 * without a click script.
 */
function revealFromQuery(): { day: number; award: DailyPrizeAward } | null {
  const params = new URLSearchParams(window.location.search);
  const round = params.get('round');
  const day = Number(params.get('day'));
  if (!round || !Number.isInteger(day) || day < 1 || day > CYCLE_LENGTH) return null;
  return { day, award: awardFor(`cycle-${round}`, day) };
}

/**
 * `?still=1` forces every reveal animation to its END state.
 *
 * Headless Edge advances TIMERS under `--virtual-time-budget` but runs CSS animations on the real
 * clock, so a screenshot taken 200ms after load catches the 結束 button (its line animation has no
 * delay) and misses the amount and the note (theirs are delayed ~1s) — both sitting at the
 * `opacity: 0` their keyframes start from. That reads as missing copy when the copy is fine.
 *
 * Overriding to the end state is the honest fix for a LAYOUT check: it is the frame the player ends
 * up looking at. It says nothing about the timeline, which is watched in the app instead.
 */
function StillFrame() {
  return (
    <style>{`
      .daily-reveal-dim { background-color: rgba(14, 10, 8, 0.9) !important; animation: none !important; }
      .daily-reveal-amount,
      .daily-reveal-line { opacity: 1 !important; transform: none !important; filter: none !important; animation: none !important; }
      .daily-reveal-spin { animation: none !important; }
      .daily-reveal-flash, .daily-reveal-burst, .daily-reveal-ring { opacity: 0 !important; }
    `}</style>
  );
}

function Demo() {
  const [reveal, setReveal] = useState<{ day: number; award: DailyPrizeAward } | null>(revealFromQuery);

  return (
    <div className="min-h-screen bg-island-cream-2 p-4 flex flex-col items-center gap-6">
      {new URLSearchParams(window.location.search).has('still') && <StillFrame />}
      {reveal && (
        <DailyClaimReveal
          day={reveal.day}
          isGrand={reveal.day === CYCLE_LENGTH}
          award={reveal.award}
          onDone={() => setReveal(null)}
        />
      )}

      {ANCHORS.map((anchor) => {
        // Day 3 of the round, days 1–2 already taken, so the board shows 已領取 / 已錯過 /
        // 今日可領 / 未開放 all at once as well as four different prizes.
        const cycle = resolveCycle(anchor, new Date(addCivilDays(anchor, 2) + 'T10:00:00+08:00'));
        const squares = buildSquares(cycle, new Set([1]), true);
        return (
          <div key={anchor} className="w-full max-w-[1000px]">
            <p className="text-xs font-black text-island-navy-soft/80 mb-1.5">{cycle.cycleId}</p>
            <div className="bg-white rounded-3xl border border-island-line overflow-hidden shadow-lg">
              <DailyLoginBoard
                squares={squares}
                dayIndex={3}
                balance={4820}
                shownBalance={4820}
                countdownMs={13 * 3600_000 + 41 * 60_000 + 7000}
                cycleId={cycle.cycleId}
                onClaim={(day) => setReveal({ day, award: awardFor(cycle.cycleId, day) })}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Demo />);
