/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import confetti from 'canvas-confetti';
import { playSound, SoundEffect } from '../../lib/soundUtils';
import { vibrateGoalCompleted, vibrateGoldEarned } from '../../lib/vibration';
import { Coins, Disc3, Package, Ticket, Zap } from 'lucide-react';
import { ModalOverlay } from './DesignKit';
import { FragmentShard } from './FragmentProgress';
import { QVersionIcon } from '../QVersionIcon';
import { fragmentName } from '../../constants/fragments';
import { getUtilityCard } from '../../constants/utilityCards';
import { getItemById } from '../../constants/items';
import { RARITY_SPECS } from '../../constants/rarity';
import type { DailyPrizeAward } from '../../constants/dailyLoginPrizes';

/**
 * 領取揭曉 — the full-screen moment a 每日登入 reward is collected.
 *
 * The board's own celebration (`.daily-claim-*` in index.css) was written to stay inside the card:
 * it lifts, a few coins drift out of it, the amount floats up. That reads correctly as a receipt
 * and it was deliberately quiet, on the grounds that a 神話 purchase is the game's loud moment and
 * a daily reward must not compete with it. What it is NOT is a moment — the player taps 領取 and
 * the thing they came back for happens at the size of a postage stamp, in one corner of a grid of
 * seven near-identical cards.
 *
 * So the claim now gets a stage, and it is the purchase reveal's vocabulary played on gold: the
 * screen drops to dark, one big coin comes spinning in from far away, and everything blooms on the
 * stop — a flash, three rings pushed outward, light rays, confetti, and the amount slamming in
 * underneath. Louder than the purchase reveal per second, and about a third of its length.
 *
 * ## Why louder is allowed here, and short is what pays for it
 *
 * RarityReveal spends 9.4 seconds because it is reachable twice in a catalog and never twice in a
 * day. This one is reachable EVERY day, so the same budget spent the same way would be a toll. It
 * is spent on intensity instead of duration: the arrival is 0.9s rather than 5.5s, and the whole
 * thing can be tapped away from the moment the coin lands. A player who wants the animation gets a
 * real one; a player in a hurry loses a second.
 *
 * ## It ends when the player says so
 *
 * It used to dismiss ITSELF after {@link DAILY_REVEAL_MS}, which made the收下 a thing that happened
 * to the player rather than something they did. Now the stage holds — the coin keeps breathing, the
 * amount stays up — until 結束 is pressed (or the backdrop tapped), and that press is what closes
 * the 每日登入獎勵 panel behind it too. The timeline above is the ARRIVAL's timeline; nothing in it
 * takes the moment away any more.
 *
 * ## The one thing it must not do
 *
 * It must never play for a claim that did not happen. The panel starts it only after
 * `claimDailyReward` has returned ok — the same rule the card celebration has always obeyed —
 * because an animation this size in front of a refused write is the strongest lie the UI can tell.
 */

/**
 * When the coin stops turning and faces front, in ms after the reveal starts.
 *
 * Everything blooms on this instant — the flash, the rings, the confetti, the haptic, the sound and
 * the amount all hang off it. It is duplicated in index.css as the delay on the `.daily-reveal-*`
 * rules; change it here and change it there, or the celebration comes apart from what it celebrates.
 */
export const REVEAL_SETTLE_MS = 900;

/** How long the whole thing is on screen. See the note above on why this is deliberately short. */
export const DAILY_REVEAL_MS = 2900;

/** How long the layer takes to fade once the player has ended it. Matches `.is-exiting` in index.css. */
const EXIT_MS = 280;

/**
 * What the board has to wait out before the payout (`.daily-claim-*` and the coin flight) begins.
 * Exported so the board can sequence the two halves without knowing this file's timeline.
 */
export const DAILY_REVEAL_TOTAL_MS = DAILY_REVEAL_MS + EXIT_MS;

/** When the overlay starts accepting a tap. Matches `.daily-reveal-hint`'s delay in index.css. */
const SKIPPABLE_AT_MS = REVEAL_SETTLE_MS + 400;

/** Copy timing, in ms after the settle. The label leads, the number lands, the note follows. */
const COPY_GAP_MS = 110;

/**
 * The palette follows the PRIZE, because the round no longer pays one thing.
 *
 * A gold explosion over a 碎片 payout is the loudest possible version of the mistake §22 names, and
 * so is a teal one over 15 金幣. White is in both lists because a burst of nothing but one hue on a
 * near-black screen reads as sparks rather than as confetti.
 */
const SHARD = ['#2A9D8F', '#7FCFC3', '#1F7A6E', '#FFFFFF'];
const GOLD = ['#E8AA3E', '#FFDF9E', '#B87C1C', '#FFFFFF'];

interface Burst {
  delay: number;
  particleCount: number;
  spread: number;
  startVelocity?: number;
  angle?: number;
  origin?: { x: number; y: number };
  ribbon?: boolean;
}

/**
 * The confetti, per day.
 *
 * Two shapes of celebration and not seven: an ordinary day gets the pair of bursts off the coin,
 * and 第 7 天 — the round's 大獎 — adds the two side cannons and the streamers. Grading every day
 * separately was the obvious first idea and it turns days two through six into five flavours of the
 * same shrug; the week has one peak in it and this is where it goes.
 */
function burstsFor(isGrand: boolean): Burst[] {
  const base: Burst[] = [
    { delay: REVEAL_SETTLE_MS, particleCount: 90, spread: 78, startVelocity: 44 },
    { delay: REVEAL_SETTLE_MS + 150, particleCount: 55, spread: 120, startVelocity: 30 },
  ];
  if (!isGrand) return base;
  return [
    ...base,
    // The cannons fire from the bottom corners, inward and up — the shape a stage uses, and the one
    // thing in the week that only 大獎 gets.
    { delay: REVEAL_SETTLE_MS + 240, particleCount: 70, spread: 55, startVelocity: 58, angle: 62, origin: { x: 0, y: 0.85 } },
    { delay: REVEAL_SETTLE_MS + 240, particleCount: 70, spread: 55, startVelocity: 58, angle: 118, origin: { x: 1, y: 0.85 } },
    { delay: REVEAL_SETTLE_MS + 520, particleCount: 40, spread: 100, startVelocity: 40, ribbon: true },
  ];
}

/**
 * The shard, at presentation size.
 *
 * A drawn-up cousin of the board's `FragmentShard` rather than the same SVG scaled — the same
 * argument the gold coin this replaced was built on: at 22px a flat facet with one highlight IS a
 * shard, and at 180px it is a teal triangle. This one carries the bevel, the two side facets, the
 * inner table and the struck star that only exist to be seen big, off the same three teals, so the
 * thing that lands on the stage is recognisably the thing on the cards.
 *
 * The star emboss is kept from the coin deliberately. It is the game's own sparkle mark and it is
 * what makes this read as MINTED — as a thing the game issues — rather than as a found crystal.
 */
function BigShard({ size = 180 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden>
      <defs>
        <linearGradient id="dcr-face" x1="30%" y1="10%" x2="70%" y2="95%">
          <stop offset="0%" stopColor="#DFF7F1" />
          <stop offset="48%" stopColor="#7FCFC3" />
          <stop offset="100%" stopColor="#2A9D8F" />
        </linearGradient>
        <linearGradient id="dcr-rim" x1="15%" y1="0%" x2="85%" y2="100%">
          <stop offset="0%" stopColor="#A9E2D9" />
          <stop offset="45%" stopColor="#2A9D8F" />
          <stop offset="100%" stopColor="#155F56" />
        </linearGradient>
      </defs>

      {/* The bevel — the shard's outline drawn a little larger and darker, so the face sits inside
          a turned edge instead of floating. Same construction as the rarity bezel. */}
      <path d="M60 3 L114 42 L60 117 L6 42 Z" fill="url(#dcr-rim)" />

      {/* The girdle facets — 9 strokes across the shoulder, which is what makes this read as cut
          stone rather than as a drawn diamond. The coin's milling, in the shard's vocabulary. */}
      <g stroke="#155F56" strokeWidth="1.3" opacity="0.45">
        {Array.from({ length: 9 }, (_, i) => {
          const t = (i + 1) / 10;
          return <line key={i} x1={6 + 108 * t} y1={42} x2={26 + 68 * t} y2={20 + 8 * Math.abs(0.5 - t) * 2} />;
        })}
      </g>

      <path d="M60 9 L108 44 L60 110 L12 44 Z" fill="url(#dcr-face)" stroke="#1F7A6E" strokeWidth="2" />
      {/* The table: the flat top face, lit brighter than the body it sits on. */}
      <path d="M60 9 L79 44 L60 110 L41 44 Z" fill="#C6EDE5" opacity="0.55" />
      <path d="M12 44h96" stroke="#1F7A6E" strokeWidth="2" opacity="0.5" />

      {/* The emboss: the four-point star this game already uses for sparkle, struck rather than
          printed — a light face over a dark offset copy of itself. */}
      <path
        d="M60 34 L65 55 L86 60 L65 65 L60 86 L55 65 L34 60 L55 55 Z"
        fill="#1F7A6E"
        opacity="0.4"
        transform="translate(1.5 2)"
      />
      <path
        d="M60 34 L65 55 L86 60 L65 65 L60 86 L55 65 L34 60 L55 55 Z"
        fill="#EAFBF7"
        opacity="0.92"
      />

      {/* The old highlight, kept — it is the one mark the small shard has, and the reason these two
          read as the same object. */}
      <path d="M30 34a34 34 0 0 1 26-22" stroke="#F2FEFB" strokeWidth="5" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

/**
 * A struck gold coin, at presentation size — the 金幣 half of the stage.
 *
 * Built the same way {@link BigShard} is (a rim, a face, the four-point star struck into it) rather
 * than as a flat disc with a number on it, so the two marks are recognisably the same game's
 * currency seen from different angles. The star emboss is the shared mark: it is what makes both
 * read as MINTED — things this world issues — rather than as a crystal and a token.
 */
function BigCoin({ size = 180 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden>
      <defs>
        <linearGradient id="dcr-coin-face" x1="30%" y1="8%" x2="70%" y2="96%">
          <stop offset="0%" stopColor="#FFF3D2" />
          <stop offset="48%" stopColor="#F2C260" />
          <stop offset="100%" stopColor="#C98A1E" />
        </linearGradient>
        <linearGradient id="dcr-coin-rim" x1="15%" y1="0%" x2="85%" y2="100%">
          <stop offset="0%" stopColor="#FFE6AC" />
          <stop offset="45%" stopColor="#E8AA3E" />
          <stop offset="100%" stopColor="#8A5C12" />
        </linearGradient>
      </defs>

      <circle cx="60" cy="60" r="57" fill="url(#dcr-coin-rim)" />

      {/* The milling — 28 strokes round the edge, which is what makes this read as struck metal
          rather than as a drawn circle. The shard's girdle facets, in the coin's vocabulary. */}
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

      <circle cx="60" cy="60" r="49" fill="url(#dcr-coin-face)" stroke="#B87C1C" strokeWidth="2" />
      <circle cx="60" cy="60" r="41" fill="none" stroke="#B87C1C" strokeWidth="1.6" opacity="0.5" />

      {/* The same four-point star the shard carries, struck rather than printed: a light face over
          a dark offset copy of itself. */}
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

/**
 * A struck medallion with a glyph on it — the mark for every prize that is neither money nor a
 * fragment: a 抽獎券, a 功能卡, a product, a free turn of the wheel.
 *
 * One component rather than four hand-cut SVGs, because those four are the same object with a
 * different thing stamped on it, and drawing each separately would be four chances for the stage to
 * look like a different game. The glyph is the SAME lucide icon the board's card uses for that day,
 * so what lands here is visibly what the card promised.
 */
function BigMedallion({
  size = 180,
  tone,
  children,
}: {
  size?: number;
  tone: 'gold' | 'teal';
  children: React.ReactNode;
}) {
  const [rim, face, edge] = tone === 'gold'
    ? ['#FFE6AC', '#F2C260', '#8A5C12']
    : ['#A9E2D9', '#7FCFC3', '#155F56'];
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden className="absolute inset-0">
        <circle cx="60" cy="60" r="57" fill={rim} />
        <circle cx="60" cy="60" r="49" fill={face} stroke={edge} strokeWidth="2" />
        <circle cx="60" cy="60" r="41" fill="none" stroke={edge} strokeWidth="1.6" opacity="0.45" />
        <path d="M28 40a36 36 0 0 1 26-22" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" opacity="0.6" />
      </svg>
      <span className="relative" style={{ color: edge }}>{children}</span>
    </div>
  );
}

/**
 * What the stage says, for one award.
 *
 * Derived in one place rather than switched on inside the JSX, because the four things that have to
 * agree — the mark, the confetti's colours, the headline and the line under it — live in four
 * different parts of the tree, and a `switch` in each of them is four chances for a 金幣 day to
 * explode in teal.
 *
 * It reads the AWARD and never the prize table: what the write actually banked is the only honest
 * thing to celebrate, and the two differ whenever a fragment stack was already full or a card bag
 * was at its cap.
 */
function stageFor(award: DailyPrizeAward | null): {
  mark: React.ReactNode;
  colors: string[];
  /** Which cut of the big number to use. Must match the mark, or the type lies about the currency. */
  tone: 'gold' | 'teal';
  /** The big number, or null for a prize whose whole identity is its name. */
  amount: number | null;
  /** The line under the number. */
  note: string;
  /** An optional second line, for the half of a prize that is not the headline. */
  detail: React.ReactNode | null;
} {
  const kind = award?.kind ?? 'coins';

  // A refused write. The claim itself stands (it is a separate write), so the player is looking at
  // a card that says 已領取 — which makes saying nothing the worst of the options. The stage keeps
  // the mark so it is still recognisably this day's prize, and replaces the 「已入袋」 line with the
  // truth plus the one thing that actually helps.
  const unsaved = award !== null && !award.saved;

  const fragmentLine = award && award.fragmentItemId && award.fragmentsKept > 0
    ? (
      <>
        <span className="w-8 h-8 rounded-lg bg-white/85 flex items-center justify-center overflow-hidden">
          <QVersionIcon itemId={award.fragmentItemId} size={28} />
        </span>
        <span className="flex items-center gap-1.5 text-white/90 text-xs font-black tracking-wide">
          <FragmentShard size={13} />
          {fragmentName(award.fragmentItemId)} +{award.fragmentsKept}
        </span>
      </>
    )
    : null;

  // The consolation, and it has to be said out loud: a stack already at 200 keeps none of its 10
  // and pays 抽獎券 instead. Showing +0 without explaining it is how a reward reads as a bug.
  const overflowNote = award && award.fragmentsKept === 0 && award.ticketsFromOverflow > 0
    ? `碎片已集滿，換成 ${award.ticketsFromOverflow} 張抽獎券`
    : null;

  if (unsaved) {
    return {
      mark: <BigMedallion tone="teal"><Package size={76} strokeWidth={2.2} /></BigMedallion>,
      colors: SHARD,
      tone: 'teal',
      amount: null,
      note: '獎勵沒有存檔成功',
      detail: (
        <span className="text-white/90 text-xs font-black tracking-wide">
          重新整理頁面後再試一次，這一天的獎勵不會消失
        </span>
      ),
    };
  }

  switch (kind) {
    case 'coins':
      return {
        mark: <BigCoin size={180} />,
        colors: GOLD,
        tone: 'gold',
        amount: award?.coins ?? 0,
        note: '金幣已入袋',
        detail: null,
      };

    case 'coins-and-fragments':
      return {
        mark: <BigCoin size={180} />,
        colors: GOLD,
        tone: 'gold',
        amount: award?.coins ?? 0,
        note: overflowNote ?? '金幣已入袋',
        detail: fragmentLine,
      };

    case 'item-fragments':
      return {
        mark: <BigShard size={180} />,
        colors: SHARD,
        tone: 'teal',
        amount: award?.fragmentsKept ?? 0,
        note: overflowNote ?? '商品碎片已入袋',
        detail: fragmentLine,
      };

    case 'raffle-ticket':
      return {
        mark: <BigMedallion tone="teal"><Ticket size={76} strokeWidth={2.2} /></BigMedallion>,
        colors: SHARD,
        tone: 'teal',
        amount: award?.tickets ?? 0,
        note: '抽獎券已入袋',
        detail: null,
      };

    case 'utility-card': {
      const card = getUtilityCard(award?.cardId ?? null);
      const full = (award?.cardsGranted ?? 0) === 0;
      return {
        mark: <BigMedallion tone="gold"><Zap size={76} strokeWidth={2.2} /></BigMedallion>,
        colors: GOLD,
        tone: 'gold',
        amount: null,
        note: full ? '功能卡已經帶滿了' : '功能卡已放入背包',
        detail: <span className="text-white/90 text-sm font-black tracking-wide">{card?.name ?? '功能卡'}</span>,
      };
    }

    case 'item': {
      const item = getItemById(award?.itemId ?? '');
      const spec = item ? RARITY_SPECS[item.rarity] : null;
      return {
        mark: <BigMedallion tone="teal"><Package size={76} strokeWidth={2.2} /></BigMedallion>,
        colors: SHARD,
        tone: 'teal',
        amount: null,
        note: item ? '商品已放入背包' : '這一次沒有可以給的商品',
        detail: item
          ? (
            <>
              <span className="w-8 h-8 rounded-lg bg-white/85 flex items-center justify-center overflow-hidden">
                <QVersionIcon itemId={item.id} size={28} />
              </span>
              <span className="text-white/90 text-xs font-black tracking-wide">
                {spec ? `${spec.label}・` : ''}{item.name}
              </span>
            </>
          )
          : null,
      };
    }

    case 'free-spin':
    default:
      return {
        mark: <BigMedallion tone="gold"><Disc3 size={76} strokeWidth={2.2} /></BigMedallion>,
        colors: GOLD,
        tone: 'gold',
        amount: award?.spins ?? 1,
        note: '免費轉盤次數已入袋',
        detail: (
          <span className="text-white/90 text-xs font-black tracking-wide">
            到幸運轉盤免費轉一次，不用抽獎券
          </span>
        ),
      };
  }
}

export function DailyClaimReveal({
  day,
  isGrand,
  award = null,
  onDone,
}: {
  /** Which square paid out. Named in the copy — 「第 3 天登入獎勵」. */
  day: number;
  /** 第 7 天 — the round's prize. Buys the extra confetti, the extra turn and the screen shake. */
  isGrand: boolean;
  /**
   * What the claim actually BANKED — see {@link DailyPrizeAward}.
   *
   * Null only when the prize write reported nothing at all, which the stage renders as an ordinary
   * coin day rather than as an error: the claim itself succeeded, and a blank stage in front of a
   * successful claim is the one thing worse than celebrating the wrong amount.
   */
  award?: DailyPrizeAward | null;
  /** Fired once the reveal has finished playing. This is what starts the payout on the board. */
  onDone: () => void;
}) {
  const stage = stageFor(award);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const [skippable, setSkippable] = useState(false);
  /** True from the moment the player ends it until the layer has faded and `onDone` has fired. */
  const [exiting, setExiting] = useState(false);
  // Held in a ref so the choreography below can call the latest one without listing it as a
  // dependency and re-running the whole thing every render — same reason RarityReveal does it.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  /** Guards the exit: a tap and the timer both end the reveal, and they must not both report it. */
  const doneRef = useRef(false);

  const later = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  }, []);

  /**
   * Ends the reveal: fade the layer, then hand over.
   *
   * The fade is here rather than in the caller because the caller unmounts this on `onDone` — a
   * layer that reports itself finished before it has faded is simply cut off screen, taking the
   * confetti and the coin with it in one frame.
   */
  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setExiting(true);
    timersRef.current.push(window.setTimeout(() => onDoneRef.current(), EXIT_MS));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const timers = timersRef.current;
    // The library's global canvas lives at z-index 100, far below `.z-reveal` (1500), so a global
    // burst would fire BEHIND this overlay's dim and be invisible. Its own canvas, as RarityReveal
    // and AngelGuide both do it.
    const fire = canvas ? confetti.create(canvas, { resize: true }) : null;
    // Tall thin rectangle = a paper streamer; canvas-confetti tumbles it in flight.
    const ribbon = confetti.shapeFromPath({ path: 'M0 0 H5 V17 H0 Z' });

    for (const burst of burstsFor(isGrand)) {
      later(() => {
        fire?.({
          particleCount: burst.particleCount,
          spread: burst.spread,
          startVelocity: burst.startVelocity,
          angle: burst.angle,
          colors: stage.colors,
          ticks: 120,
          // The coin sits above centre, so the default origin is the COIN and not the middle of the
          // screen — confetti that comes off the copy reads as the text exploding.
          origin: burst.origin ?? { x: 0.5, y: 0.42 },
          shapes: burst.ribbon ? [ribbon] : ['circle', 'square'],
          scalar: burst.ribbon ? 1.05 : 1,
          // The reveal still plays for a player who asked for less motion — silently skipping it
          // would read as the claim having failed — but nothing is thrown across their screen.
          disableForReducedMotion: true,
        });
      }, burst.delay);
    }

    // Sound and haptics land on the STOP, not on the button. The same landing either way; 大獎 gets the
    // chime on top of it, which is the same "more music, not louder music" rule the purchase ladder
    // is graded by (constants/rarityFx.ts).
    later(() => {
      playSound(SoundEffect.COIN);
      if (isGrand) playSound(SoundEffect.RARE_REVEAL);
      (isGrand ? vibrateGoalCompleted : vibrateGoldEarned)();
    }, REVEAL_SETTLE_MS);

    // 大獎 only: the room takes the knock. Applied to #root rather than to this overlay, because a
    // shake that moves only the celebration is the celebration wobbling. `.rarity-shake` is a
    // general screen shake — it carries a rarity name because that is where it was first needed,
    // and it is the same 4px knock this wants rather than a second copy of it.
    const root = isGrand ? document.getElementById('root') : null;
    if (root) {
      later(() => root.classList.add('rarity-shake'), REVEAL_SETTLE_MS);
      later(() => root.classList.remove('rarity-shake'), REVEAL_SETTLE_MS + 700);
    }

    // No self-dismiss timer: the stage waits. `skippable` is what puts 結束 on screen and starts
    // accepting a tap — before the coin has landed there is nothing to end yet.
    later(() => setSkippable(true), SKIPPABLE_AT_MS);

    return () => {
      timers.forEach(window.clearTimeout);
      timers.length = 0;
      root?.classList.remove('rarity-shake');
      fire?.reset();
    };
  }, [isGrand, later, finish, stage.colors]);

  return (
    // ModalOverlay with its scrim turned off: `.daily-reveal-dim` is the only thing allowed to
    // darken this screen, for the reason written over `.rarity-reveal-dim` — two translucent coats
    // of the navy scrim over a cream panel is a blue wash, not a dark one.
    <ModalOverlay
      zIndexClassName="z-reveal"
      scrimClassName="bg-transparent"
      className={`daily-reveal-layer ${exiting ? 'is-exiting' : ''} overflow-hidden ${skippable ? 'cursor-pointer' : 'pointer-events-none'}`}
      onClick={skippable ? finish : undefined}
    >
      <div className="daily-reveal-dim" />
      <div className="daily-reveal-rays" />
      <div className="daily-reveal-flash" />
      <div className="daily-reveal-burst" />
      <div className="daily-reveal-ring" />
      <div className="daily-reveal-ring daily-reveal-ring-2" />
      <div className="daily-reveal-ring daily-reveal-ring-3" />

      <div className="daily-reveal-stage">
        <div className="relative flex items-center justify-center">
          <div className="daily-reveal-glow" />

          {/* The turn count reaches the keyframes as a custom property, so 大獎 spinning harder is a
              number here and not a second copy of the animation. */}
          <div className="daily-reveal-spin" style={{ '--reveal-turns': isGrand ? 4 : 3 } as CSSProperties}>
            <div className="daily-reveal-coin">
              {stage.mark}
              <span className="daily-reveal-shine" aria-hidden />
            </div>
          </div>

          {/* Sparks thrown off the coin as it lands — eight, fanned by index the same way the card's
              little coins are, so eight paths cost one set of keyframes. */}
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="daily-reveal-spark" style={{ ['--i' as string]: i }} aria-hidden />
          ))}
        </div>

        <div className="flex flex-col items-center text-center gap-1.5">
          <span
            className="daily-reveal-line text-white/90 text-sm font-black tracking-[0.3em]"
            style={{ animationDelay: `${REVEAL_SETTLE_MS}ms` }}
          >
            {isGrand ? '本輪大獎' : `第 ${day} 天登入獎勵`}
          </span>

          {/* The number, and it is the headline — the reason the screen went dark.
              Omitted entirely for a prize whose identity is its NAME rather than its count:
              「+1」 over a 史詩 sofa is the smallest true thing that could be said about it, and
              rendering it anyway would make the sofa and a single 抽獎券 look like the same win. */}
          {stage.amount !== null && (
            <div
              className={`daily-reveal-amount ${stage.tone === 'gold' ? 'daily-reveal-amount-gold' : ''}`}
              style={{ animationDelay: `${REVEAL_SETTLE_MS + COPY_GAP_MS}ms` }}
            >
              +{stage.amount.toLocaleString()}
            </div>
          )}

          <span
            className="daily-reveal-line text-white/85 text-xs font-black tracking-[0.2em]"
            style={{ animationDelay: `${REVEAL_SETTLE_MS + COPY_GAP_MS * 2}ms` }}
          >
            {stage.note}
          </span>

          {/* Timed one beat after the headline so the two arrive in the order they matter, rather
              than the player being handed both at once and reading neither. */}
          {stage.detail && (
            <span
              className="daily-reveal-line mt-3 inline-flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-white/10 border border-white/15 backdrop-blur-sm"
              style={{ animationDelay: `${REVEAL_SETTLE_MS + COPY_GAP_MS * 3}ms` }}
            >
              {stage.detail}
            </span>
          )}

          {/* 結束 — the one control this screen has, and the thing that closes the whole 每日登入
              獎勵 flow: it hands back to the panel, the coins fly into the wallet there, and the
              panel closes itself behind them (see DailyLoginPanel's handleRevealDone). Rendered
              only once the coin has landed, so the first frame is never an invitation to skip the
              thing the player came back for. Gold on the dark stage rather than a DesignKit
              variant — those are cut for a cream panel and vanish here. */}
          {skippable && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); finish(); }}
              className="daily-reveal-line mt-4 px-8 py-2.5 rounded-2xl font-black text-sm tracking-[0.2em] text-[#4A3410] bg-gradient-to-b from-[#FFDF9E] to-[#E8AA3E] border border-[#FFF0C8]/60 shadow-[0_8px_24px_rgba(232,170,62,0.35)] transition-all hover:-translate-y-0.5 active:scale-95"
            >
              結束
            </button>
          )}
        </div>
      </div>

      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
    </ModalOverlay>
  );
}
