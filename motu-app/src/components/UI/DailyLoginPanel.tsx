/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getBalance } from '../../constants/currency';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Clock, Coins, Disc3, Gift, Info, Lock, Package, Sparkles, Ticket, Zap } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { View, type UserProfile } from '../../types';
import { playSound, SoundEffect } from '../../lib/soundUtils';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { useAdminMode } from '../../hooks/useAdminMode';
import {
  subscribeLoginBonus, publishLoginBonus, openDailyLoginBoard, subscribeDailyLoginBoard,
} from '../../lib/playerBus';
import { ONBOARDING_MODAL_CLASS, useOnboardingSlot } from '../../lib/onboardingQueue';
import { Button, CurrencyChip, ModalOverlay, ModalShell, PanelHeader, SCRIM_INK_DEEP } from './DesignKit';
import { DailyClaimReveal } from './DailyClaimReveal';
import { FragmentShard } from './FragmentProgress';
import { getItemById } from '../../constants/items';
import { RARITY_SPECS } from '../../constants/rarity';
import { getUtilityCard } from '../../constants/utilityCards';
import {
  dailyFragmentItem,
  dailyPrizeCard,
  type DailyPrizeAward,
} from '../../constants/dailyLoginPrizes';
import {
  CYCLE_LENGTH,
  DailyPrize,
  DaySquare,
  buildSquares,
  canClaim,
  civilDateAt,
  formatCountdown,
  msUntilNextCivilDay,
  resolveCycle,
} from '../../constants/dailyLogin';

/**
 * 這份存檔在 `now` 這一刻的板子：這一輪、七張卡、以及今天那一張。
 *
 * 抽成一個函數，是因為現在有**兩個**地方要問同一件事 —— 板子本身，以及角落那顆按鈕上的徽章
 * （見 {@link DailyLoginButton}）。徽章講的是「今天有東西可以領」，而那句話唯一能算對的方式
 * 就是用板子拿來畫卡片的同一組數字。各算各的話，兩邊會在 anchor 缺席、輪次翻頁、或跨午夜的
 * 邊界上分岔 —— 而分岔的樣子會是一顆亮著的紅點，點進去卻沒有東西可以領。
 */
function boardFor(profile: UserProfile, now: Date): {
  cycle: ReturnType<typeof resolveCycle>;
  squares: DaySquare[];
  today: DaySquare | undefined;
} {
  const cycle = resolveCycle(profile.loginAnchorDate ?? civilDateAt(now), now);
  const isCurrent = profile.loginCycleId === cycle.cycleId;
  const squares = buildSquares(cycle, new Set(isCurrent ? profile.loginClaimedDays ?? [] : []), true);
  return { cycle, squares, today: squares[cycle.currentDayIndex - 1] };
}

/**
 * 每日登入獎勵 — the seven-day board.
 *
 * The panel is a pure READER: every rule it obeys (which day it is, what a square is worth, whether
 * a square can be taken and what a 補簽 costs) comes from constants/dailyLogin.ts, and the one thing
 * it can do to the save goes through `claimDailyReward`, which re-derives all of it from the profile
 * before writing. Nothing about the round is decided in this file, which is why a designer can
 * re-price the week without opening it.
 *
 * ## Why every day is on screen at once
 *
 * The old popup showed one number — what you had just been given — and the player never saw a
 * reason to come back tomorrow beyond a habit they had to supply themselves. The board shows all
 * seven, including the ones already spent and the ones not yet earned, because the point of a
 * ladder is being able to see the top of it from the bottom. Nothing is hidden behind a lock icon;
 * a locked square still says its day and its amount, and the lock only says "not yet".
 *
 * ## What it deliberately does not do
 *
 * **No pressure.** No streak-loss warning, no timer counting down on the claim itself, no red. The
 * missed state is grey-pink and says 已錯過 and nothing else — the point is the round, not a shame
 * mechanic. The countdown in the header is the neutral fact of when the next day opens, and it is
 * the only clock on screen.
 *
 * **No spend prompt beyond the one 補簽 button.** A make-up is a secondary button on the square it
 * belongs to, priced in plain gold, and it never becomes the loudest thing in the panel — 今日可領
 * is always the primary action. See DESIGN_SYSTEM.md on why nothing here reads as a purchase flow.
 */

/**
 * How long the PAYOUT half of the claim runs, in ms — the card's own pop, the fan of coins, the
 * floating +N and the flight into the wallet. The brief's window is 0.8–1.2s; the CSS matches.
 *
 * It is the second half. The first is the full-screen 領取揭曉 (components/UI/DailyClaimReveal.tsx),
 * which plays first and hands over when it is done — see `handleClaim` below on why the two are in
 * that order and never at the same time.
 */
const CLAIM_FX_MS = 1100;
/** The balance counts up over slightly less, so the number has settled before the fx clears. */
const COUNT_UP_MS = 700;
/** How long the panel stays open after the payout has finished, before it shows itself out. */
const PAYOUT_TAIL_MS = 420;

/**
 * A number that animates to its target instead of jumping.
 *
 * Reads as the coins arriving rather than as the label being replaced, which is the whole reason
 * the balance is in the header at all: the player should see where what they just claimed went.
 * Falls straight to the target when the difference is 0 (a re-render for any other reason must not
 * re-run the count) or when the user has asked for reduced motion.
 */
function useCountUp(target: number, durationMs = COUNT_UP_MS): number {
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      fromRef.current = target;
      setShown(target);
      return;
    }

    const started = performance.now();
    const step = (nowMs: number) => {
      const t = Math.min(1, (nowMs - started) / durationMs);
      // Ease-out: the count should land softly rather than stop dead on the last frame.
      const eased = 1 - (1 - t) ** 3;
      setShown(Math.round(from + (target - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = target;
    };
  }, [target, durationMs]);

  return shown;
}

/** Per-state paint. One table, so a state can never be half-restyled at one of its call sites. */
const SQUARE_SKIN: Record<DaySquare['state'], { card: string; day: string; amount: string }> = {
  // 已領取 — desaturated sage. Present, finished, and quiet enough that today reads first.
  claimed: {
    card: 'bg-[#EDF1EC] border-[#CBD8CC] opacity-80',
    day: 'text-[#6E8272]',
    amount: 'text-[#6E8272]',
  },
  // 今日可領 — lifted, glowing, and the only card carrying either.
  //
  // Still warm gold, deliberately, even though the reward is 碎片: this gradient is saying
  // 「今天就是這一張」, not 「這裡有金幣」. Re-tinting it teal would collide with the shard mark
  // sitting on top of it and leave the panel's one emphasised card indistinguishable from its
  // ordinary ones. Currency is said by the MARK; state is said by the card.
  available: {
    card: 'bg-gradient-to-b from-[#FFF9EA] to-[#FDEFC9] border-island-gold/55 shadow-[0_14px_34px_rgba(232,170,62,0.28)] lg:scale-[1.045]',
    day: 'text-[#8A6524]',
    amount: 'text-[#8A6524]',
  },
  // 漏登 — soft grey-pink. Never red: a missed day is a shrug, not an alarm.
  makeup_available: {
    card: 'bg-[#F7EFF0] border-[#E3CFD2]',
    day: 'text-[#8B7276]',
    amount: 'text-[#8B7276]',
  },
  missed: {
    card: 'bg-[#F7EFF0] border-[#E3CFD2] opacity-75',
    day: 'text-[#8B7276]',
    amount: 'text-[#8B7276]',
  },
  // 未開放 — pale blue-grey. Legible, never veiled: the amount is the reason to come back.
  future: {
    card: 'bg-[#EFF3F6] border-[#D5DFE6]',
    day: 'text-[#6B8290]',
    amount: 'text-[#5C7684]',
  },
};

/**
 * What one prize looks like on a card — the icon, the number and the one line under it.
 *
 * ## Why this is a component and not a `quantity` with a unit next to it
 *
 * Because four of the seven days no longer have a number worth leading with. 「第 5 天：1」 is not
 * a reward, it is a count of a thing whose whole identity is in the word next to it, and a board
 * that renders every day as 「[mark] N」 makes 一張功能卡, 一件史詩商品 and 一次免費轉盤 look like
 * three sizes of the same prize. So each kind says itself: a shard and a product name for 碎片, a
 * coin and a figure for 金幣, a wheel and 「免費轉一次」 for 第 7 天.
 *
 * ## It draws the FUTURE as well as today
 *
 * Every card gets a face, including 未開放 and 已錯過 ones, for the same reason the old board put
 * an amount on every card: the point of showing seven days at once is that the player can see what
 * is coming. The state skin desaturates them; nothing is hidden.
 *
 * The one thing it deliberately does NOT name is 第 5 天's actual product. That day's item depends
 * on what the player already owns (constants/dailyLoginPrizes.ts's `preferUnowned`), so a card
 * naming it would be making a promise that changes the moment they go shopping. It shows the TIER,
 * which is the part that is fixed.
 */
function PrizeFace({
  prize,
  cycleId,
  day,
  big,
  tone,
}: {
  prize: DailyPrize;
  cycleId: string;
  day: number;
  /** 第 7 天 draws its mark larger — it is the only card with room for it. */
  big: boolean;
  /** The state skin's text colour, so a claimed card's face fades with the rest of it. */
  tone: string;
}) {
  const markSize = big ? 30 : 22;
  const numberClass = `font-black tabular-nums ${big ? 'text-2xl' : 'text-lg'} ${tone}`;
  const captionClass = `text-[10px] font-black leading-tight text-center ${tone} opacity-80`;

  switch (prize.kind) {
    case 'coins':
      return (
        <div className="relative flex flex-col items-center gap-1" aria-label={`${prize.coins} 金幣`}>
          <div className="flex items-center gap-1.5">
            <Coins size={markSize} className="text-island-gold" strokeWidth={2.5} />
            <span className={numberClass}>{prize.coins.toLocaleString()}</span>
          </div>
          <span className={captionClass}>金幣</span>
        </div>
      );

    case 'item-fragments':
    case 'coins-and-fragments': {
      // Named per day, not per round: a fragment day picks its own product now, and the name is
      // what makes 10 碎片 mean something rather than read as a currency the player has never seen
      // a price list for.
      const item = dailyFragmentItem(cycleId, day);
      return (
        <div
          className="relative flex flex-col items-center gap-1"
          aria-label={`${item ? `${item.name}碎片` : '商品碎片'} ${prize.itemFragments}${prize.coins > 0 ? `，金幣 ${prize.coins}` : ''}`}
        >
          <div className="flex items-center gap-1.5">
            <FragmentShard size={markSize} />
            <span className={numberClass}>{prize.itemFragments}</span>
          </div>
          {prize.coins > 0 && (
            <span className={`flex items-center gap-1 text-[10px] font-black ${tone}`}>
              <Coins size={11} className="text-island-gold" strokeWidth={2.8} />
              <span className="tabular-nums">+{prize.coins} 金幣</span>
            </span>
          )}
          <span className={captionClass}>{item ? `${item.name}碎片` : '商品碎片'}</span>
        </div>
      );
    }

    case 'raffle-ticket':
      return (
        <div className="relative flex flex-col items-center gap-1" aria-label={`${prize.tickets} 張抽獎券`}>
          <div className="flex items-center gap-1.5">
            <Ticket size={markSize} className="text-island-teal" strokeWidth={2.5} />
            <span className={numberClass}>{prize.tickets}</span>
          </div>
          <span className={captionClass}>抽獎券</span>
        </div>
      );

    case 'utility-card': {
      const card = getUtilityCard(dailyPrizeCard(cycleId, day));
      return (
        <div className="relative flex flex-col items-center gap-1" aria-label={card?.name ?? '功能卡'}>
          <Zap size={markSize} className="text-island-gold" strokeWidth={2.5} />
          <span className={captionClass}>{card?.name ?? '功能卡'}</span>
        </div>
      );
    }

    case 'item': {
      const spec = prize.itemRarity ? RARITY_SPECS[prize.itemRarity] : null;
      return (
        <div className="relative flex flex-col items-center gap-1" aria-label={`${spec?.label ?? ''}商品`}>
          <Package size={markSize} className="text-island-teal-dark" strokeWidth={2.5} />
          <span className={captionClass}>{spec ? `${spec.label}商品` : '隨機商品'}</span>
        </div>
      );
    }

    case 'free-spin':
    default:
      return (
        <div className="relative flex flex-col items-center gap-1" aria-label="免費轉盤一次">
          <Disc3 size={markSize} className="text-island-gold" strokeWidth={2.5} />
          <span className={captionClass}>免費轉盤 ×{prize.spins}</span>
        </div>
      );
  }
}

const STATE_LABEL: Record<DaySquare['state'], string> = {
  claimed: '已領取',
  available: '今日可領',
  makeup_available: '已錯過',
  missed: '已錯過',
  future: '未開放',
};

function DayCard({
  square,
  cycleId,
  isGrand,
  balance,
  busy,
  celebrating,
  onClaim,
}: {
  square: DaySquare;
  /** The round this card belongs to — what {@link PrizeFace} resolves its item and card from. */
  cycleId: string;
  isGrand: boolean;
  balance: number;
  busy: boolean;
  celebrating: boolean;
  onClaim: (mode: 'free' | 'makeup') => void;
}) {
  const skin = SQUARE_SKIN[square.state];
  const affordable = square.makeupCost !== null && balance >= square.makeupCost;

  return (
    <div
      // The board finds this card by day to measure where the coins should fly FROM — see
      // `useCoinFlight`. A data attribute rather than a ref threaded through this component,
      // because the flight is the board's business and a card should not have to know it exists.
      data-day={square.day}
      className={[
        'relative rounded-[1.4rem] border p-3 flex flex-col items-center gap-2 transition-all',
        skin.card,
        // 本輪大獎 keeps a second ring inside its own border — the doubled edge is what says
        // "prize" without another colour, and it is the only card that gets it.
        isGrand ? 'ring-2 ring-inset ring-island-gold/30 lg:col-span-2 col-span-2' : '',
        celebrating ? 'daily-claim-pop' : '',
      ].join(' ')}
    >
      {/* The grand square's glow, behind everything and never over the numbers. */}
      {isGrand && <div className="daily-grand-glow" aria-hidden />}

      <div className="relative flex items-center gap-1">
        <span className={`text-[11px] font-black tracking-wide ${skin.day}`}>第 {square.day} 天</span>
        {isGrand && <Sparkles size={12} className="text-island-gold" strokeWidth={2.5} />}
      </div>

      <PrizeFace
        prize={square.prize}
        cycleId={cycleId}
        day={square.day}
        big={isGrand}
        tone={skin.amount}
      />

      {/* The state line. A card always says what it is, even when it has no button. */}
      <div className="relative flex items-center gap-1 text-[10px] font-black">
        {square.state === 'claimed' && (
          <span className="flex items-center gap-1 text-[#6E8272]">
            <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#8FAE95] text-white ${celebrating ? 'daily-claim-check' : ''}`}>
              <Check size={10} strokeWidth={3.5} />
            </span>
            {STATE_LABEL.claimed}
          </span>
        )}
        {square.state === 'future' && (
          <span className="flex items-center gap-1 text-[#6B8290]">
            <Lock size={11} strokeWidth={2.5} />
            {isGrand ? '本輪大獎' : STATE_LABEL.future}
          </span>
        )}
        {(square.state === 'missed' || square.state === 'makeup_available') && (
          <span className="text-[#8B7276]">{STATE_LABEL.missed}</span>
        )}
        {square.state === 'available' && (
          <span className="px-2 py-0.5 rounded-full bg-island-gold/18 border border-island-gold/40 text-[#8A6524]">
            {isGrand ? '本輪大獎 · 今日可領' : STATE_LABEL.available}
          </span>
        )}
      </div>

      {/* The action, and only where there is one. */}
      {square.state === 'available' && (
        <Button
          onClick={() => onClaim('free')}
          disabled={busy}
          className="relative w-full px-2 py-2 text-xs"
        >
          {/* One word, no amount and no unit. The mark, the number and the name of the thing are
              all directly above it, so anything longer repeats the card back to itself — and at
              seven cards across a desktop grid it wraps onto a second line. The 補簽 button below
              is the opposite case and DOES name its currency: its number is 金幣, which is often
              not what the card above it is offering at all. */}
          領取
        </Button>
      )}
      {square.state === 'makeup_available' && (
        <Button
          variant="secondary"
          onClick={() => onClaim('makeup')}
          disabled={busy || !affordable}
          title={affordable ? undefined : '金幣不足'}
          className="relative w-full px-2 py-2 text-[11px]"
        >
          {/* The one label in the panel that names its currency, and the one that has to: this
              button's number is 金幣 while the number above it on the same card is 碎片. Without
              the unit the two read as one figure being compared with another. */}
          補簽 {square.makeupCost?.toLocaleString()} 金幣
        </Button>
      )}

      {/* The claim celebration: a few coins drifting out, and the amount floating up. Small,
          short, and entirely inside the card — a purchase reveal is the loud moment in this game
          and a daily reward must not compete with it. */}
      {celebrating && (
        <>
          {/* The headline count — 15 for a 金幣 day, 10 for a 碎片 one, 1 for a card or a spin.
              What it counts is said by the face above; this is the little 「+N」 that drifts up. */}
          <span className="daily-claim-float">+{square.quantity.toLocaleString()}</span>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <span key={i} className="daily-claim-coin" style={{ ['--i' as string]: i }} aria-hidden>
              <Coins size={13} className="text-island-gold" strokeWidth={2.5} />
            </span>
          ))}
        </>
      )}
    </div>
  );
}

/** How many coins make the trip from the card to the wallet, and how long one takes. */
const FLIGHT_COINS = 7;
const FLIGHT_MS = 640;
const FLIGHT_STAGGER_MS = 55;
/** The last coin lands this long after the claim; the wallet takes its hit then. */
const FLIGHT_LAST_LANDING_MS = FLIGHT_MS + (FLIGHT_COINS - 1) * FLIGHT_STAGGER_MS;

/** One coin in transit, in coordinates local to the board. */
interface FlyingCoin {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/**
 * 金幣入袋 — the coins actually travelling from the claimed card into the wallet chip.
 *
 * The names in this block say `coin`/`coins` and now mean it again: the chip they land in holds
 * 金幣, which is the one part of a prize that has a balance to fly into. They are choreography
 * first — an object arcing from a card to a chip — and a card that paid 碎片 or a 功能卡 still
 * plays them, because what the flight says is 「那個東西進去了」 and the panel has exactly one
 * place for a thing to go into.
 *
 * The card's own celebration (`.daily-claim-pop`, the fan of coins, the floating +N) says
 * "this square paid out". It deliberately stays inside the card's footprint, and that is the right
 * scale for it — but it leaves the reward and the BALANCE as two unconnected events: coins puff out
 * of a card and fade, and separately a number at the top of the panel is larger than it was. What
 * the player asked to see is the money arriving, and money arriving is a journey with two ends.
 *
 * So this measures both ends at the moment of the claim and animates between them. Measured rather
 * than authored, because the wallet is at the top-right on a desktop and stacked above a two-column
 * grid on a phone — there is no single offset that is right for both, and there never will be while
 * the layout is responsive.
 *
 * Both rects are taken relative to the board, so the coins live in the board's own coordinate space
 * and need no portal, no fixed positioning and no correction when the panel scrolls.
 */
function useCoinFlight(
  boardRef: React.RefObject<HTMLDivElement | null>,
  walletRef: React.RefObject<HTMLDivElement | null>,
  celebratingDay: number | null,
) {
  const [coins, setCoins] = useState<FlyingCoin[]>([]);
  const [walletHit, setWalletHit] = useState(false);
  const nextId = useRef(0);

  useEffect(() => {
    const board = boardRef.current;
    const wallet = walletRef.current;
    if (celebratingDay === null || !board || !wallet) return;

    const card = board.querySelector<HTMLElement>(`[data-day="${celebratingDay}"]`);
    if (!card) return;

    // The one place the two ends meet. `getBoundingClientRect` is viewport-relative, so both are
    // rebased onto the board's own origin by subtracting it from each.
    const origin = board.getBoundingClientRect();
    const from = card.getBoundingClientRect();
    const to = wallet.getBoundingClientRect();
    const startX = from.left - origin.left + from.width / 2;
    const startY = from.top - origin.top + from.height / 2;
    const endX = to.left - origin.left + to.width / 2;
    const endY = to.top - origin.top + to.height / 2;

    setCoins(Array.from({ length: FLIGHT_COINS }, (_, i) => ({
      id: nextId.current++,
      // Fanned a little at the start so seven coins do not leave as one coin — they converge on the
      // wallet anyway, which is what makes the group read as a single payment.
      x: startX + (i - (FLIGHT_COINS - 1) / 2) * 9,
      y: startY + (i % 2) * 6,
      dx: endX - startX - (i - (FLIGHT_COINS - 1) / 2) * 9,
      dy: endY - startY - (i % 2) * 6,
    })));
    setWalletHit(false);

    const land = window.setTimeout(() => setWalletHit(true), FLIGHT_LAST_LANDING_MS - 90);
    const clear = window.setTimeout(() => {
      setCoins([]);
      setWalletHit(false);
    }, FLIGHT_LAST_LANDING_MS + 420);

    return () => {
      window.clearTimeout(land);
      window.clearTimeout(clear);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebratingDay]);

  return { coins, walletHit };
}

/**
 * The board itself — everything under the panel's header, and the whole of what this feature looks
 * like.
 *
 * Split from {@link DailyLoginPanel} on purpose: this half takes squares and numbers and takes no
 * context, no clock and no Firestore, so it can be rendered at any size against any made-up state
 * (see tmp-daily-login.tsx) to check a layout or a card state without a login. The panel below is
 * the half that knows where the numbers come from.
 */
export function DailyLoginBoard({
  squares,
  dayIndex,
  balance,
  shownBalance,
  countdownMs,
  busy = false,
  celebratingDay = null,
  cycleId,
  onClaim,
}: {
  squares: DaySquare[];
  /**
   * Which day of the round today is. The progress line reports THIS and not the number of squares
   * taken: 「本輪登入進度 3／7」 answers "where am I in the week", which is the question a player
   * opening the panel is asking, and it does not quietly turn into a scolding on the day someone
   * misses one. What has and has not been collected is already on the cards themselves.
   */
  dayIndex: number;
  /** 金幣 the player actually holds — what a 補簽 is affordable against, and what a day can pay. */
  balance: number;
  /** What the header shows, which lags `balance` while the count-up runs. */
  shownBalance: number;
  countdownMs: number;
  busy?: boolean;
  celebratingDay?: number | null;
  /**
   * Which round these squares belong to (`cycle-YYYY-MM-DD`).
   *
   * A string rather than a resolved list of prizes, so the board stays a pure reader that can be
   * rendered against made-up state (see tmp-daily-login.tsx) — and so the cards resolve their item
   * and their card from the SAME seed the claim will (constants/dailyLoginPrizes.ts). A board handed
   * pre-resolved names would be a second place the round's contents are decided.
   */
  cycleId: string;
  onClaim?: (day: number, mode: 'free' | 'makeup') => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const walletRef = useRef<HTMLDivElement>(null);
  const { coins, walletHit } = useCoinFlight(boardRef, walletRef, celebratingDay ?? null);

  return (
    <div
      ref={boardRef}
      className="relative p-5 md:p-7 overflow-y-auto custom-scrollbar flex flex-col gap-5 bg-gradient-to-b from-island-cream-2/70 to-island-cream"
    >
      {/* The three facts, on one line on desktop and stacked on a phone: where the player is in the
          round, what they hold, and when the next day opens. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          {/* No bar under this. 3／7 is already the whole fact, and the seven cards below are the
              same fact at full size — a filling track was a third telling of it, and the one that
              looked most like a score to beat. */}
          <p className="text-xs font-black text-island-navy-soft/80">
            本輪登入進度 <span className="text-island-teal">{dayIndex}</span>／{CYCLE_LENGTH}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Wrapped so the flight has something to measure and something to shake. The chip itself
              is shared with the rest of the game and must not grow a daily-login-only class. */}
          {/* 金幣 only, and it is the chip the flight lands in. The round pays it, the 補簽 costs
              it, and it is the one number on this screen a player has to be able to compare against
              a price. The wallet's 碎片 used to sit beside it — back when the round paid them — and
              it is gone with them: nothing on this board adds to it or spends it, and a second
              static balance is a number the eye has to rule out before it can read the first.

              (The 商品碎片 a day pays are NOT this. They belong to one product and are metered on
              that product's own shop card, which is where a stack can actually be spent.) */}
          <div ref={walletRef} className={walletHit ? 'daily-wallet-hit' : undefined}>
            <CurrencyChip amount={shownBalance} currency="coins" className="py-2" />
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-white border border-island-line text-island-navy-soft font-black text-xs tabular-nums">
            <Clock size={13} className="text-island-teal" strokeWidth={2.5} />
            明日開放 {formatCountdown(countdownMs)}
          </span>
        </div>
      </div>

      {/* The board. Two columns on a phone, four on a tablet (so days 1–4 sit on one row and 5–6
          lead into the prize), and all seven across on a desktop — where the eight-column track is
          what lets the grand square be twice as wide without a second grid. */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2.5 md:gap-3">
        {squares.map((square, i) => (
          <DayCard
            key={square.day}
            square={square}
            cycleId={cycleId}
            isGrand={i === CYCLE_LENGTH - 1}
            balance={balance}
            busy={busy}
            celebrating={celebratingDay === square.day}
            onClaim={(mode) => onClaim?.(square.day, mode)}
          />
        ))}
      </div>

      <p className="text-center text-island-navy-soft/70 font-bold text-[11px] leading-relaxed">
        每輪 {CYCLE_LENGTH} 天，每一天給的東西都不一樣，第 {CYCLE_LENGTH} 天可以免費轉一次幸運轉盤。
        錯過的日子可以補簽，補簽要付一筆金幣。
      </p>

      {/* The coins in transit. Last in the board so they pass OVER the cards they leave, and
          `aria-hidden` throughout: the payment is already announced by the balance itself and by
          the card turning to 已領取, and a screen reader has no use for seven decorative coins. */}
      {coins.map(coin => (
        <span
          key={coin.id}
          aria-hidden
          className="daily-coin-fly"
          style={{
            ['--x' as string]: `${coin.x}px`,
            ['--y' as string]: `${coin.y}px`,
            ['--dx' as string]: `${coin.dx}px`,
            ['--dy' as string]: `${coin.dy}px`,
            ['--i' as string]: coin.id % FLIGHT_COINS,
          }}
        >
          <Coins size={16} className="text-island-gold" strokeWidth={2.5} />
        </span>
      ))}
    </div>
  );
}

export function DailyLoginPanel() {
  const { profile, claimDailyReward } = useApp();
  const [isVisible, setIsVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [celebrating, setCelebrating] = useState<number | null>(null);
  /**
   * The claim currently being shown full-screen, or null.
   *
   * Set only after a write that actually happened, and cleared by the reveal itself when it has
   * finished playing — which is also what starts the payout on the board. The panel stays open
   * underneath the whole time, because the coins have to land somewhere.
   */
  const [reveal, setReveal] = useState<{
    day: number;
    isGrand: boolean;
    /** What the claim BANKED — see {@link DailyPrizeAward}. Null only when the write reported none. */
    award: DailyPrizeAward | null;
  } | null>(null);
  /**
   * What the header shows while the reveal is on screen: the 金幣 balance from BEFORE the claim.
   *
   * `profile.balanceGold` is already the new number by the time the reveal starts, so without this
   * the count-up runs behind the overlay and the player comes back to a wallet that has quietly
   * finished paying itself — and then watches seven coins fly into a total that already includes
   * them. Holding the old number until the reveal hands over is what keeps the two in step.
   */
  const [heldBalance, setHeldBalance] = useState<number | null>(null);
  /**
   * What the server said when it refused, in the player's words, or null.
   *
   * Rendered instead of an animation, never alongside one: the celebration and this string are
   * mutually exclusive by construction, which is the rule that stops a failed claim looking like a
   * successful one. Cleared on the next successful claim and when the panel is closed.
   */
  const [claimError, setClaimError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Same subscription the old popup used: the bonus is announced synchronously when a new civil day
  // is noticed (AppContext) or when the admin button asks for it, and consumed so it cannot re-open
  // itself later in the session.
  useEffect(() => {
    return subscribeLoginBonus((data) => {
      if (!data) return;
      setIsVisible(true);
      if (!data.isManual) playSound(SoundEffect.REWARD);
      publishLoginBonus(null);
    });
  }, []);

  /**
   * 玩家自己按開的那一條（{@link DailyLoginButton} → `openDailyLoginBoard`）。
   *
   * 這面板以前只有上面那一條路徑可以打開，而那一條**一天只推一次、推完就消費掉**。玩家隨手把
   * 板子關掉，當天就再也叫不回來 —— 連帶把裡面的**補簽**一起關掉，而畫面上沒有任何東西說過關
   * 閉是不可逆的。一個關閉動作不該換掉玩家當天的領取權。
   *
   * 分成兩個 effect 而不是併進上面那一個：它們是兩件不同的事，而且差別看得見 —— 通知會播獎勵
   * 音效，按鈕不會（音效已經在按下去的當下播過了，見按鈕本身）。
   */
  useEffect(() => subscribeDailyLoginBoard(() => setIsVisible(true)), []);

  /**
   * 管理員測試模式：every refresh, not once a day.
   *
   * The normal rule is the one above — AppContext announces the round the first time the player
   * opens the game on a new 台北 calendar day, and never again that day, so a player who closes the
   * panel is not nagged by it. That rule is exactly what makes the panel awkward to WORK on: testing
   * a card state means waiting for tomorrow or editing a save.
   *
   * With admin mode on, mounting is enough. `hasAutoOpened` keeps it to once per mount rather than
   * once per render, so closing the panel still closes it — refreshing is what brings it back, which
   * is what was asked for.
   *
   * Deliberately NOT a second way for the panel to appear for ordinary players: the flag is the same
   * one every other admin-only feature reads (hooks/useAdminMode.ts), and it is off for everyone
   * else, so this branch does not exist for them.
   */
  const isAdmin = useAdminMode();
  const hasAutoOpened = useRef(false);
  useEffect(() => {
    if (!isAdmin || !profile || hasAutoOpened.current) return;
    hasAutoOpened.current = true;
    setIsVisible(true);
  }, [isAdmin, profile]);

  // One clock for the whole panel, ticking a second at a time. It drives the countdown AND the
  // board itself, so a panel left open across midnight rolls over on its own rather than showing a
  // 領取 button that the write path will refuse.
  useEffect(() => {
    if (!isVisible) return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [isVisible]);

  /**
   * A refusal clears itself.
   *
   * It describes ONE tap, so it has no business outliving the moment by much — and left on screen
   * it becomes a permanent notice about a transient thing, which is most of why the old bordered
   * version read as broken furniture. Long enough to read a short line twice.
   */
  useEffect(() => {
    if (!claimError) return;
    const id = window.setTimeout(() => setClaimError(null), 4500);
    return () => window.clearTimeout(id);
  }, [claimError]);

  const handleClose = useCallback(() => {
    playSound(SoundEffect.CLICK);
    setIsVisible(false);
  }, []);

  const onScreen = useOnboardingSlot('loginBonus', isVisible && !!profile);
  useEscapeToClose(handleClose, onScreen);

  // One balance now: 金幣 is both what a day can pay and what a 補簽 costs, so the same number
  // answers 「補得起嗎」 and 「剛剛進帳多少」. It used to be two, back when the round paid the
  // wallet's 碎片 and charged 金幣 for a make-up — see DailyLoginBoard's header.
  const balance = getBalance(profile, 'coins');
  const shownBalance = useCountUp(heldBalance ?? balance);

  if (!profile) return null;

  // 板子與角落按鈕上的徽章共用同一組數字 — 見 boardFor。
  const { cycle, squares } = boardFor(profile, now);
  const handleClaim = async (day: number, mode: 'free' | 'makeup') => {
    if (busy) return;
    setBusy(true);
    const result = await claimDailyReward(day, mode);
    setBusy(false);
    if (!result.ok) {
      // The server refused. Show what it said and change nothing on the board — a failed claim must
      // never leave a card looking collected, and must never show a balance that was not banked.
      setClaimError(result.message);
      return;
    }
    setClaimError(null);

    // The celebration is only ever started by a write that actually happened — a refused claim
    // leaves the card exactly as it was, with no animation to explain away.
    //
    // Two beats, in this order and never overlapping:
    //   1. 領取揭曉 takes the whole screen — one big coin spinning in, and the amount.
    //   2. the payout: the card pops, the coins fly out of it and into the wallet, which counts up.
    //
    // The reveal says WHAT was collected and the payout says WHERE it went, and reversing them (or
    // running them together) loses the second half entirely — coins flying into a wallet nobody is
    // looking at, behind a full-screen animation. The sound belongs to the reveal now: it fires on
    // the coin's landing rather than on the button, so it lands with the moment it is scoring.
    setHeldBalance(balance);
    setReveal({
      day,
      isGrand: day === CYCLE_LENGTH,
      // Read off the RESULT and never recomputed from the prize table: what the write actually
      // banked is the only honest thing to celebrate. A fragment stack that was already full keeps
      // 0 of its 10 and quietly pays 抽獎券 instead; a card bag at its cap takes none at all. The
      // board says what the day IS; this says what the player just got.
      award: result.award ?? null,
    });
  };

  /**
   * Beat two, and the end of the flow. Called when the player presses 結束 on the reveal.
   *
   * The payout runs first and the panel closes on top of it, in that order and not the other way
   * round: 結束 is the player saying they are done with the 每日登入獎勵 window, but the coins still
   * have to be seen landing somewhere — the whole point of holding the header's balance back during
   * the reveal. So the card pops, the coins fly into the wallet, the total counts up, and the panel
   * shows itself out about a second later.
   *
   * If a 補簽 was what the player came for, the panel is one tap away again from the same place.
   */
  const handleRevealDone = () => {
    const day = reveal?.day ?? null;
    setReveal(null);
    // The header is released here and not a frame earlier: the count-up now runs under the coins.
    setHeldBalance(null);
    if (day === null) return;
    setCelebrating(day);
    window.setTimeout(() => setCelebrating(null), CLAIM_FX_MS);
    window.setTimeout(() => setIsVisible(false), CLAIM_FX_MS + PAYOUT_TAIL_MS);
  };

  return (
    <>
    {/* 領取揭曉 — beat one, over the panel rather than inside it.
        A sibling of the panel's own overlay and not a child of it: it is a full-screen layer on the
        z-reveal tier (index.css), and nested inside the panel's ModalShell it would be clipped by
        the shell's rounded box and stacked under the very card it is celebrating.

        This is the mount that was missing. The state, the sequencing and the whole component were
        already here — nothing rendered them, so 領取 wrote the gold and then simply went quiet: no
        window, no coin, no sound, no card pop (`celebrating` is set by handleRevealDone, which
        nothing could call), and the header's balance stayed frozen at `heldBalance` for the rest
        of the session, which is why every claim appeared to pay the same unchanging total. */}
    {reveal && (
      <DailyClaimReveal
        day={reveal.day}
        isGrand={reveal.isGrand}
        award={reveal.award}
        onDone={handleRevealDone}
      />
    )}
    <AnimatePresence>
      {onScreen && (
        // Darker ground than the house default, and a panel lit against it — see SCRIM_INK_DEEP.
        // The glow below is warm rather than white so the cream panel reads as lamplit rather than
        // as a surface with a hard edge cut round it; the second shadow is the shell's own, kept so
        // the panel still sits on the world instead of floating free of it.
        <ModalOverlay
          className={ONBOARDING_MODAL_CLASS}
          scrimClassName={SCRIM_INK_DEEP}
          onClick={handleClose}
        >
          <ModalShell
            maxWidthClassName="max-w-4xl"
            className="max-h-[92vh] md:max-h-[88vh] shadow-[0_0_90px_rgba(255,238,199,0.30),0_24px_60px_rgba(12,9,15,0.45)]"
          >
            <PanelHeader
              icon={<Gift size={20} strokeWidth={2.5} />}
              title="每日登入獎勵"
              subtitle="每天回來看看，每一天的獎勵都不一樣！"
              onClose={handleClose}
            />

            <DailyLoginBoard
              squares={squares}
              dayIndex={cycle.currentDayIndex}
              balance={balance}
              shownBalance={shownBalance}
              countdownMs={msUntilNextCivilDay(now)}
              busy={busy}
              celebratingDay={celebrating}
              cycleId={cycle.cycleId}
              onClaim={handleClaim}
            />

            {/* Refusals. `role="status"` so a screen reader hears 金幣不足 without the focus
                moving, and nothing in this panel is allowed to go red.

                Deliberately NOT a filled, bordered slab any more. As one it was a second panel
                bolted under the board — the largest and heaviest thing on screen, sitting there
                until the player closed the dialog, for what is usually a one-line "not yet". One
                muted line with a small mark says the same thing and stops being furniture. It also
                clears itself (see the effect above): a refusal is about the tap that just happened,
                and one still on screen a minute later is describing nothing. */}
            {claimError && (
              <p
                role="status"
                aria-live="polite"
                className="mx-6 mb-5 -mt-2 flex items-center justify-center gap-1.5 text-xs font-bold text-island-navy-soft/70"
              >
                <Info size={13} strokeWidth={2.5} className="flex-shrink-0" />
                {claimError}
              </p>
            )}
          </ModalShell>
        </ModalOverlay>
      )}
    </AnimatePresence>
    </>
  );
}

/**
 * 每日簽到 — 右下角的入口。
 *
 * ## 為什麼需要它
 *
 * 這面板以前**只有一條路徑可以打開**：AppContext 在玩家當天第一次進遊戲時宣告一次
 * （`publishLoginBonus`），面板收到就把它消費掉，整個 App 沒有第二個地方能再推一次。也就是說
 * 玩家隨手把板子關掉，當天就再也叫不回來 —— 而板子裡不只有今天那一格，還有**補簽**。
 *
 * 那等於用一個「關閉」動作換掉玩家當天的領取權，而畫面上沒有任何東西說過關閉是不可逆的。這顆
 * 按鈕就是那條缺掉的回頭路，而且是**常駐**的：即使今天已經領過，補簽仍然要進得去。
 *
 * ## 為什麼在這個角落
 *
 * 它跟 幸運轉盤（UI/LuckyWheel.tsx）並排在 `bottom-right`，因為兩者是同一種東西：**跟著時鐘走
 * 的獎勵**，不是世界動詞（那些在左邊路牌）也不是應用分頁（那些在 NavBar）。轉盤留在最下面守住
 * 角落（見 App.tsx 那一段的說明），簽到疊在它上面。
 *
 * ## 徽章只講一件事
 *
 * 亮起來＝**今天這一格可以領**。補簽不亮：補簽是一筆要花 金幣 的交易，不是遊戲欠玩家的東西，
 * 給它一個永久紅點就變成天天在催一件玩家已經決定不做的事。
 *
 * 「今天可不可以領」是跟板子問的同一個 {@link boardFor}，所以不可能出現亮著紅點、點進去卻沒有
 * 東西可領的狀況。
 */
export function DailyLoginButton() {
  const { profile, currentView } = useApp();

  /**
   * 午夜自己翻頁，而且**不用輪詢**。
   *
   * 徽章的內容一天只會因為時間變一次（跨過台北的午夜），所以這裡排的是一顆 timeout 而不是一個
   * interval：算出離下一個民用日還有多久，睡到那時候再重算一次，然後重新排下一顆。板子開著的時
   * 候是每秒 tick 的（它要畫倒數），但這顆按鈕沒有倒數可畫 —— 為了一個一天變一次的布林值每秒
   * 重繪整個 HUD 是白付的成本。
   *
   * 玩家自己領走今天那一格時，徽章是靠 `profile.loginClaimedDays` 變動重繪而熄掉的，跟這顆計時
   * 器無關。
   */
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const id = window.setTimeout(() => setToday(new Date()), msUntilNextCivilDay(today) + 1000);
    return () => window.clearTimeout(id);
  }, [today]);

  const claimable = !!profile && boardFor(profile, today).today?.state === 'available';

  // 島上限定，跟轉盤同一條規則：屋子裡什麼都不畫。early return 排在所有 hook 之後，兩條分支的
  // hook 順序才會一樣。
  if (!profile || currentView !== View.HOME) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.85, y: 12 }}
      // 位置（右下角那一列）由 `bottom-right` HUD region 決定 — 見 HudFrame.tsx。
      // `relative` 讓 z-hud-toolbar 這一階在框架內部仍然有效。
      className="relative z-hud-toolbar pointer-events-none"
    >
      <button
        type="button"
        onClick={() => {
          playSound(SoundEffect.CLICK);
          openDailyLoginBoard();
        }}
        className="group pointer-events-auto relative w-14 h-14 md:w-[4.25rem] md:h-[4.25rem] rounded-full transition-transform active:scale-95"
        title={claimable ? '每日登入獎勵 — 今天還沒領' : '每日登入獎勵'}
        aria-label={claimable ? '打開每日登入獎勵，今天還有可以領取的獎勵' : '打開每日登入獎勵'}
      >
        {/* 光暈只在今天還沒領的時候亮，跟轉盤「抽得起」時的那一圈是同一個手法：可不可以做這件
            事用光說，而不是把按鈕 disable 掉 —— 板子在已經領過的日子仍然值得打開（補簽在裡面）。*/}
        {claimable && (
          <span className="absolute inset-0 rounded-full bg-island-gold/25 animate-ping [animation-duration:2.4s]" />
        )}
        <span className="absolute inset-0 rounded-full bg-island-cream border border-island-line shadow-[0_8px_22px_rgba(38,70,83,0.24)] transition-shadow group-hover:shadow-[0_10px_28px_rgba(38,70,83,0.32)]" />
        <span className="relative w-full h-full flex items-center justify-center text-island-navy">
          {/* 跟面板 header 同一個字符（PanelHeader 的 Gift），所以按鈕與它打開的東西是同一個物件。*/}
          <Gift
            size={26}
            strokeWidth={2.25}
            className="w-[45%] h-[45%] transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110"
          />
        </span>
        {/* 未領取的點，塞在**內側**角落 —— 這顆按鈕貼著畫面右緣，掛在外側的徽章會掉出視窗外。
            跟轉盤的抽獎券數字同一側，兩顆疊起來才會對齊。*/}
        {claimable && (
          <span className="absolute -top-0.5 -left-1 w-3.5 h-3.5 rounded-full bg-island-gold border-2 border-island-cream shadow-sm" />
        )}
      </button>
    </motion.div>
  );
}
