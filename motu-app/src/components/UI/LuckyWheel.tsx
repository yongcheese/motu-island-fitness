/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { animate, motion, AnimatePresence, useMotionValue } from 'motion/react';
import { ChevronDown, Gift, RotateCw } from 'lucide-react';
import { View } from '../../types';
import { useApp } from '../../context/AppContext';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { playSound, playWheelSpin, SoundEffect, triggerHaptic } from '../../lib/soundUtils';
import { getItemById } from '../../constants/items';
import { fragmentName, getRaffleTickets } from '../../constants/fragments';
import { TOUR_TARGET, tourTag } from '../../constants/tourTargets';
import { RARITY_SPECS, type Rarity } from '../../constants/rarity';
import { getUtilityCard } from '../../constants/utilityCards';
import {
  FUNCTION_CARD_FULL_NOTE,
  WHEEL_SLOTS,
  WHEEL_SLOT_ANGLE,
  WHEEL_SPIN,
  WHEEL_SPIN_COST,
  getFreeSpins,
  wheelPegTimes,
  wheelPrizeTable,
  wheelSlotChance,
  wheelSlotIndex,
  type WheelPrizeRow,
  type WheelSlot,
} from '../../constants/luckyWheel';
import { buildRewardPool } from '../../constants/rewardPools';
import { ownsItem } from '../../utils/inventory';
import type { WheelPrize } from '../../context/useWheelActions';
import { FragmentShard, RaffleTicket } from './FragmentProgress';
import { FloatingPanelPortal } from './FloatingPanelPortal';
import { ModalOverlay, ModalShell, PanelHeader, SCRIM_INK_DEEP } from './DesignKit';
import { QVersionIcon } from '../QVersionIcon';

/**
 * 幸運轉盤 — a corner icon on the island, and the wheel itself in a panel behind it.
 *
 * ## Why the wheel is not painted on the island any more
 *
 * It used to live in the right-hand HUD rail, permanently on screen. That bought the one thing a
 * wheel is for — you can see the ladder before you spend — and paid for it with the one thing the
 * island is for: a 176–224px disc parked over the world every second of play, whether or not
 * anyone was going to spin it. A prize table is worth looking at when a player chooses to look at
 * it; the rest of the time it is scenery in front of the scenery.
 *
 * So the HUD now carries a {@link WheelLauncher} — one round icon in the bottom-right corner with
 * the ticket balance on it — and the face moved into {@link WheelPanel}, an ordinary modal. Nothing
 * about the draw changed. What changed is that the wheel is now as big as a wheel should be
 * (`min(78vw, 54vh, 430px)`, roughly double the old disc) because it no longer has to share the
 * screen with the game.
 *
 * ## Why every wedge still draws its own prize
 *
 * The wheel earns its space over a plain 「抽獎」 button in exactly one way: a player can see what
 * is on it before spending anything. So every wedge draws its own prize — mark, name and quantity —
 * rather than a number that has to be looked up in a rules screen. That is also why the 史詩 wedge
 * is the same 36° as the 碎片 ones: sizing wedges by odds would shave it to a sliver, and a prize
 * nobody can see is not on the wheel. The real odds live in `weight` (constants/luckyWheel.ts) and
 * are printed in each wedge's own tooltip, so the face is honest without being unreadable.
 *
 * ## Why the prize block is upright and not radial
 *
 * The conventional carnival wheel runs its labels along the radius, which means half of them are
 * upside down at rest. Here each wedge's content is an UPRIGHT stack — mark, then two lines of at
 * most two characters each — anchored on the wedge's bisector. Ten wedges at 36° leave a ~19-unit
 * half-width at that radius, which is what fixes the block at two characters per line: the face
 * data (`WEDGE_FACE`, below) does the splitting once rather than the renderer guessing per label.
 *
 * The stack rides the rotation, so it tumbles while the wheel spins and comes to rest upright. That
 * is the correct reading — it is printed on the wheel, not on the glass.
 *
 * ## The spin cannot disagree with the payout
 *
 * `spinWheel` (context/useWheelActions.ts) draws the wedge AND writes the save in one go, then this
 * animates to whatever it returned. The other order — spin first, ask afterwards — has two sources
 * of truth for one event, and the one the player believes is the one on screen.
 */

/** The two lines printed on a wedge, at most two characters each. Keyed by slot id. */
const WEDGE_FACE: Record<string, [string, string]> = {
  'frag-10': ['碎片', '×10'],
  'frag-15': ['碎片', '×15'],
  'frag-20': ['碎片', '×20'],
  'frag-30': ['碎片', '×30'],
  'frag-50': ['碎片', '×50'],
  'outfit-rare-a': ['稀有', '造型'],
  'outfit-rare-b': ['稀有', '造型'],
  'outfit-epic': ['史詩', '造型'],
  ticket: ['抽獎', '券'],
  // 這一格現在發真的 雙倍金幣券（見 constants/luckyWheel.ts），所以不再寫『退券』。
  'function-card': ['功能', '卡'],
};

/**
 * A wedge's fill.
 *
 * 碎片 climb a teal ramp with the amount, so the five ordinary wedges are one family that still
 * ranks itself — the ×50 is visibly the deep one. They stay PALE on purpose: half the face is
 * 碎片, and a face that is half saturated colour has nowhere left to make the one-off prizes stand
 * out.
 *
 * The 造型 wedges take their tier's `fieldCore` straight from constants/rarity.ts — the jewel tone,
 * not the pale `fieldTop` a card uses at its corners. On a card the pale end is right because the
 * item art sits on it; here the wedge IS the prize, and at `fieldTop` the 稀有 green landed within
 * a few percent of the neighbouring 碎片 teal. Reading the tier from that file rather than picking
 * a pastel is what kept this correct when the ladder was re-cut from six rungs to four mid-build:
 * 稀有 went from sea blue to leaf green and the wheel followed with no edit here.
 *
 * 抽獎券 is the gold family it already uses in the header — the PALE end of it. The wedge used to
 * be #F7E3AE, which is within a few percent of the ticket mark's own #F3C566 body: the one wedge
 * whose prize is drawn life-size was the one wedge you could not see the prize on. Backing the
 * field off to #FBEBBE puts the gold ticket on gold paper instead of on gold.
 *
 * 功能卡 is `island-sand` — the one wedge that is deliberately quiet, because it is the one that
 * pays nothing yet.
 */
const WEDGE_FILL: Record<string, string> = {
  'frag-10': '#F0F9F7',
  'frag-15': '#E4F3EF',
  'frag-20': '#D8EEE8',
  'frag-30': '#C9E8E0',
  'frag-50': '#B9E1D7',
  'outfit-rare-a': RARITY_SPECS.rare.fieldCore,
  'outfit-rare-b': RARITY_SPECS.rare.fieldCore,
  'outfit-epic': RARITY_SPECS.epic.fieldCore,
  ticket: '#FBEBBE',
  'function-card': '#EFE9DC',
};

const CENTER = 100;
/** Outer edge of the painted face, in viewBox units. The bezel is drawn outside it. */
const FACE_R = 88;
/** Where a wedge's upright prize block is anchored on its bisector. */
const BLOCK_R = 57;
/** The prize mark's box, in viewBox units. The block's two text lines hang under it. */
const MARK_SIZE = 16;
/** Where the ticker is hinged — the pointer swings about this, it does not slide. */
const PIVOT_Y = 5.8;
/** Ten bulbs and ten pegs ride this radius: just inside the bezel's outer lip. */
const RIM_R = FACE_R + 5.5;

function polar(angleDeg: number, radius: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [CENTER + radius * Math.cos(rad), CENTER + radius * Math.sin(rad)];
}

/** One wedge as a pie slice, centred on `index * 36°` clockwise from twelve o'clock. */
function wedgePath(index: number): string {
  const half = WHEEL_SLOT_ANGLE / 2;
  const [x0, y0] = polar(index * WHEEL_SLOT_ANGLE - half, FACE_R);
  const [x1, y1] = polar(index * WHEEL_SLOT_ANGLE + half, FACE_R);
  return `M ${CENTER} ${CENTER} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${FACE_R} ${FACE_R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
}

/**
 * 造型 — a folded tee in the tier's own colours. The mark the wheel prints three times.
 *
 * It replaced lucide's `Shirt`/`Sparkles` pair, which had two faults that only a wheel exposes.
 *
 * **Weight.** A 2px outline glyph laid on a saturated `fieldCore` wedge is a wire drawing on a
 * colour field: at arm's length it reads as a scratch in the paint rather than as a garment. A
 * FILLED tee — the tier's pale `fieldTop` inside, its `edge` around — keeps the same silhouette
 * and survives being small, being on colour, and being seen while the face is turning.
 *
 * **Family.** 稀有 and 史詩 pay the same KIND of prize at two grades, so they have to be the same
 * object twice. A shirt on one wedge and a sparkle on the other made them look like two unrelated
 * prizes, and quietly cost the 史詩 wedge the thing it is for — you cannot tell it is the BETTER
 * version of the wedge two seats over if it is not visibly the same thing. The grade rides where
 * the wheel already carries it (the wedge's colour, the tee's own ink) plus the two sparks 史詩
 * wears; the shape never changes.
 *
 * Both colours come from RARITY_SPECS rather than being picked here, for the same reason the wedge
 * fills do: the ladder has been re-cut once already and every hand-picked pastel is a thing that
 * silently stops matching when it is re-cut again.
 */
function OutfitMark({ rarity, size = MARK_SIZE }: { rarity: Rarity; size?: number }) {
  const spec = RARITY_SPECS[rarity];

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* Shoulders out to the sleeve, down the body, and back up to a collar that dips (the Q, not
          an arc — a quadratic's sag is half its control offset, which is the one number that had to
          be small enough to leave the neckline reading as a neckline at 16 units). */}
      <path
        d="M8.6 3.2 4.6 4.9 2.4 8.2 5 10.6 6.9 8.9V20.2Q6.9 21.4 8.1 21.4H15.9Q17.1 21.4 17.1 20.2V8.9L19 10.6 21.6 8.2 19.4 4.9 15.4 3.2Q12 6.6 8.6 3.2Z"
        fill={spec.fieldTop}
        stroke={spec.edge}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* Collar band, one fold down the body, one shoulder seam. Three faint strokes are the whole
          difference between a tee and a pentagon with sleeves. */}
      <path d="M9.5 4.2Q12 7.6 14.5 4.2" stroke={spec.edge} strokeWidth="1.1" strokeLinecap="round" opacity="0.5" />
      <path d="M9.7 11.8V19.4" stroke={spec.edge} strokeWidth="1" strokeLinecap="round" opacity="0.26" />
      <path d="M6.9 9.7 5.5 8.5" stroke={spec.edge} strokeWidth="1" strokeLinecap="round" opacity="0.32" />
      {/* 史詩 only: two four-point sparks, set on a diagonal so they read as light coming off the
          thing rather than as a second symbol parked beside it. White-filled — on a violet wedge a
          white spark is the brightest ink available, and brightness is the whole message. */}
      {rarity === 'epic' && (
        <g fill="#FFFFFF" stroke={spec.edge} strokeWidth="0.9" strokeLinejoin="round">
          <path d="M20.2 0.4 21 2.1 22.7 2.9 21 3.7 20.2 5.4 19.4 3.7 17.7 2.9 19.4 2.1Z" />
          <path d="M3.9 15.9 4.4 17.1 5.6 17.6 4.4 18.1 3.9 19.3 3.4 18.1 2.2 17.6 3.4 17.1Z" />
        </g>
      )}
    </svg>
  );
}

/**
 * 功能卡 — a card in a small stack, wearing the round well the real cards wear.
 *
 * lucide's `CreditCard` was a bank card: a rectangle with a magnetic stripe across it, which is
 * precisely the object a 功能卡 is not. This game already draws a card, and it draws it as a
 * TICKET — 「a round icon well instead of the catalog's 4:3 rectangle」 (UI/UtilityCard.tsx) — so
 * the mark borrows that well, puts it on a card face with two rules of copy beside it, and stacks a
 * second card behind so the wedge says 「一疊卡」 rather than 「一個長方形」.
 *
 * The well is a SOLID ring here, not the dashed one UtilityCardArt draws. At this size the dashes
 * would be about a third of a pixel each and the ring would come out as a grey smudge; a dashed
 * border is a 72px feature.
 *
 * Deliberately a quiet mark — sand, white and navy-soft, no accent colour — so it never out-shouts
 * the 造型 wedges, whose tier colours are the face's real hierarchy.
 */
function FunctionCardMark({ size = MARK_SIZE }: { size?: number }) {
  const card =
    'M6.6 6.8H17.4A2 2 0 0 1 19.4 8.8V15.2A2 2 0 0 1 17.4 17.2H6.6A2 2 0 0 1 4.6 15.2V8.8A2 2 0 0 1 6.6 6.8Z';

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* The one underneath. Turned further and drawn a shade down, with nothing printed on it —
          it exists to be a second card, not to be read. Same device as the 64px 抽獎券 icon. */}
      <g transform="rotate(-15 12 12)">
        <path d={card} fill="#E3DCCB" stroke="#9AA6AB" strokeWidth="1.4" strokeLinejoin="round" />
      </g>
      <g transform="rotate(-3 12 12)">
        <path d={card} fill="#FFFFFF" stroke="#4A6169" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="9.5" cy="12" r="3.1" fill="#EFE9DC" stroke="#4A6169" strokeWidth="1.1" />
        <path d="M9.5 9.8 10.1 11.4 11.7 12 10.1 12.6 9.5 14.2 8.9 12.6 7.3 12 8.9 11.4Z" fill="#4A6169" />
        {/* Two rules where a card's effect line would be. They are what makes the rectangle read as
            a printed card rather than as a blank tile. */}
        <path d="M14 10.4H17.3M14 13.6H16.2" stroke="#4A6169" strokeWidth="1.3" strokeLinecap="round" opacity="0.55" />
      </g>
    </svg>
  );
}

/** The prize mark for a wedge, sized in viewBox units. Nested `<svg>`, so each mark keeps its own grid. */
function WedgeMark({ slot }: { slot: WheelSlot }) {
  if (slot.kind === 'fragments') return <FragmentShard size={MARK_SIZE} />;
  if (slot.kind === 'raffle-ticket') return <RaffleTicket size={MARK_SIZE} />;
  if (slot.kind === 'function-card') return <FunctionCardMark />;
  // 造型 — the item itself is drawn at spin time, so the wedge promises the TIER, not the garment.
  return <OutfitMark rarity={slot.rarity ?? 'rare'} />;
}

/**
 * How far the ticker is pushed aside, given where the face is and how fast it is going.
 *
 * A wheel that is alive is a wheel whose pointer is being HIT. Every 36° a peg arrives, shoves the
 * blade over, and lets go; the blade snaps back and rings down before the next one. That is one
 * function of one angle, so it is written as one — no keyframe table, no timer racing the face.
 *
 * `p` is the progress from one peg to the next, offset by half a wedge because the pegs sit on the
 * SEAMS while the wedges are indexed by their centres. The rise is fast and linear (the peg is
 * pushing); the release is a damped cosine (the blade is free). k=15 is chosen so the ring is under
 * a tenth of a degree by the time the next peg lands, which is what makes 「停下來時指針是正的」
 * true by construction rather than by a special case: at rest the face is on a wedge centre, p is
 * exactly 0.5, and the ring there is 0.07°.
 *
 * At speed none of that can happen — 5 turns in 3.6s is about 14 pegs a second, and a blade with
 * 71ms between hits never gets home. So the settle is crossfaded into a held deflection as the peg
 * rate climbs, and the crossfade runs backwards on its own as the wheel slows: pinned while it is
 * fast, then clacking wedge by wedge, then still. The deceleration does the acting.
 */
function tickerAngle(rotationDeg: number, velocityDegPerSec: number): number {
  const step = WHEEL_SLOT_ANGLE;
  const p = ((((rotationDeg + step / 2) % step) + step) % step) / step;
  const rise = 0.16;
  const swing = 15;
  const settle =
    p < rise
      ? swing * (p / rise)
      : swing * Math.exp(-15 * (p - rise)) * Math.cos(26 * (p - rise));

  const pegsPerSecond = Math.abs(velocityDegPerSec) / step;
  const pinned = Math.min(1, Math.max(0, (pegsPerSecond - 3) / 7));
  return settle * (1 - pinned) + swing * 0.82 * pinned;
}

/**
 * The wheel with nothing written on it — the launcher's icon, and the panel header's.
 *
 * The same ten wedges in the same ten colours as the real face, so the icon is a picture of THIS
 * wheel rather than a generic roulette glyph: the pale teal ramp with a green, a violet and a gold
 * cut into it is recognisable at 20px even though not one label survives that size. Drawing the
 * labels anyway is what turns small wheel icons to mud, so they are simply not here.
 *
 * Face and cabinet are separate groups: `faceClassName` lets the caller turn the wedges (the
 * launcher does it on hover) while the bezel, the hub and the pointer stay put, exactly as they do
 * on the real thing. Gradient ids are per-instance (`useId`) because the launcher and the panel
 * header render this at the same time, and two elements sharing one id is a document that resolves
 * both `url(#…)` references to whichever mounted first.
 */
function WheelGlyph({ className = '', faceClassName = '' }: { className?: string; faceClassName?: string }) {
  const uid = useId().replace(/:/g, '');
  const hub = `wheel-hub-${uid}`;
  const sheen = `wheel-sheen-${uid}`;
  const dish = `wheel-dish-${uid}`;
  const bezel = `wheel-bezel-${uid}`;

  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true">
      <defs>
        <radialGradient id={hub} cx="35%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#57C7B6" />
          <stop offset="100%" stopColor="#2A9D8F" />
        </radialGradient>
        <radialGradient id={sheen} cx="32%" cy="24%" r="72%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        {/* The dish. Nothing but a darkening toward the rim, and it is the whole reason the icon
            stops reading as a flat pie chart and starts reading as a bowl with a lid on it. */}
        <radialGradient id={dish} cx="50%" cy="50%" r="50%">
          <stop offset="62%" stopColor="#264653" stopOpacity="0" />
          <stop offset="100%" stopColor="#264653" stopOpacity="0.17" />
        </radialGradient>
        {/* Cream, lit from the top left — a moulded ring rather than a white outline. */}
        <linearGradient id={bezel} x1="36" y1="18" x2="164" y2="182" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.45" stopColor="#F7F4EC" />
          <stop offset="1" stopColor="#E2DDCF" />
        </linearGradient>
      </defs>

      <g className={faceClassName} style={{ transformOrigin: '50% 50%' }}>
        <circle cx={CENTER} cy={CENTER} r={FACE_R} fill="#FFFFFF" />
        {WHEEL_SLOTS.map((slot, i) => (
          <path key={slot.id} d={wedgePath(i)} fill={WEDGE_FILL[slot.id] ?? '#FFFFFF'} />
        ))}
        {WHEEL_SLOTS.map((slot, i) => {
          const [ex, ey] = polar(i * WHEEL_SLOT_ANGLE - WHEEL_SLOT_ANGLE / 2, FACE_R);
          return (
            <line
              key={`spoke-${slot.id}`}
              x1={CENTER}
              y1={CENTER}
              x2={ex.toFixed(2)}
              y2={ey.toFixed(2)}
              stroke="#FFFFFF"
              strokeWidth="3"
            />
          );
        })}
      </g>

      {/* Cabinet: the dish, the dome highlight, the bezel, the hub and the ticker. None of it
          turns. The bulbs and the pegs the panel draws are NOT here — at the 36–68px this renders
          at they are a third of a pixel each, and a ring of sub-pixel dots is a grey smear. */}
      <circle cx={CENTER} cy={CENTER} r={FACE_R} fill={`url(#${dish})`} />
      <circle cx={CENTER} cy={CENTER} r={FACE_R} fill={`url(#${sheen})`} />
      <circle cx={CENTER} cy={CENTER} r={FACE_R + 4.5} fill="none" stroke={`url(#${bezel})`} strokeWidth="10" />
      <circle cx={CENTER} cy={CENTER} r={FACE_R + 9.5} fill="none" stroke="#D9D4C6" strokeWidth="2.6" />
      <circle cx={CENTER} cy={CENTER} r={27} fill="#FFFFFF" />
      <circle cx={CENTER} cy={CENTER} r={20.5} fill={`url(#${hub})`} />
      <circle cx={93} cy={93} r={6} fill="#FFFFFF" opacity="0.4" />
      {/* The ticker: the panel's blade and hinge, drawn with a heavy white keyline so the shape
          holds against whatever colour of wedge happens to be under it at this size. */}
      <path
        d="M100 30 92.6 12.4Q91.6 4.2 100 1.8Q108.4 4.2 107.4 12.4Z"
        fill="#264653"
        stroke="#FFFFFF"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <circle cx={100} cy={8} r={7} fill="#FFFFFF" stroke="#264653" strokeWidth="3.4" />
    </svg>
  );
}

/** What the reveal card says about one outcome. Kept beside the wheel so both read from one place. */
function PrizeCard({ prize, onDismiss }: { prize: WheelPrize; onDismiss: () => void }) {
  const itemId = prize.kind === 'outfit' ? prize.itemId : null;
  const item = itemId ? getItemById(itemId) : null;

  return (
    <motion.button
      type="button"
      onClick={onDismiss}
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96 }}
      className="w-full max-w-sm text-left bg-white border border-island-line rounded-2xl px-4 py-3 shadow-[0_10px_28px_rgba(38,70,83,0.16)] cursor-pointer"
      title="點一下關閉"
    >
      {prize.kind === 'fragments' && (
        <div className="flex items-center gap-3">
          <FragmentShard size={30} lit={prize.completed} className="flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-black text-island-navy truncate">{fragmentName(prize.itemId)}</p>
            <p className="fragment-ramp-text text-base font-black leading-tight">+{prize.amount}</p>
            {prize.completed && <p className="text-[11px] font-bold text-island-teal">碎片已集滿，可直接解鎖</p>}
            {prize.overflow > 0 && (
              <p className="text-[11px] font-bold text-island-navy-soft/70">
                多出的 {prize.overflow} 個{prize.tickets > 0 ? ` 已換成 ${prize.tickets} 張抽獎券` : '無處可去'}
              </p>
            )}
          </div>
        </div>
      )}

      {prize.kind === 'raffle-ticket' && (
        <div className="flex items-center gap-3">
          <RaffleTicket size={30} className="flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-black text-island-navy">抽獎券</p>
            <p className="text-base font-black text-island-navy leading-tight">+{prize.amount}</p>
            {prize.fromDuplicate && (
              <p className="text-[11px] font-bold text-island-navy-soft/70">
                這一階的造型都收齊了，改折抽獎券
              </p>
            )}
          </div>
        </div>
      )}

      {prize.kind === 'outfit' && item && (
        <div className="flex items-center gap-3">
          <span
            className="w-14 h-14 rounded-xl border flex items-center justify-center flex-shrink-0 overflow-hidden"
            style={{ background: RARITY_SPECS[item.rarity].fieldTop, borderColor: RARITY_SPECS[item.rarity].edge }}
          >
            <QVersionIcon itemId={item.id} size={46} />
          </span>
          <div className="min-w-0">
            {/* The one place a tier is spelled out — the wheel promised a grade, so the reveal has
                to confirm the promise was kept. Everywhere else rarity is colour only. */}
            <p className="text-[11px] font-black" style={{ color: RARITY_SPECS[item.rarity].edge }}>
              {RARITY_SPECS[item.rarity].label}造型
            </p>
            <p className="text-base font-black text-island-navy truncate">{item.name}</p>
            <p className="text-[11px] font-bold text-island-navy-soft/70">已放進你的衣櫃</p>
          </div>
        </div>
      )}

      {prize.kind === 'function-card' && (
        <div className="flex items-center gap-3">
          <FunctionCardMark size={30} />
          <div className="min-w-0">
            {prize.granted > 0 ? (
              <>
                <p className="text-xs font-black text-island-navy">功能卡</p>
                <p className="text-base font-black text-island-navy leading-tight truncate">
                  {getUtilityCard(prize.cardId)?.name ?? '功能卡'} ×{prize.granted}
                </p>
                <p className="text-[11px] font-bold text-island-navy-soft/70 leading-snug">
                  {getUtilityCard(prize.cardId)?.effectSummary}・已放進功能卡背包
                </p>
              </>
            ) : (
              <>
                {/* The refund is stated as a NUMBER beside the note: the line a player checks is 「那我的券呢」. */}
                <p className="text-xs font-black text-island-navy">
                  功能卡
                  <span className="ml-2 text-island-teal-dark">抽獎券 +{prize.refund}</span>
                </p>
                <p className="text-[11px] font-bold text-island-navy-soft/70 leading-snug">{FUNCTION_CARD_FULL_NOTE}</p>
              </>
            )}
          </div>
        </div>
      )}
    </motion.button>
  );
}

/**
 * 那條橫槓的顏色。**不是** {@link WEDGE_FILL}，雖然第一版是。
 *
 * 面上的填色是刻意調淡的（半個面都是碎片，淡才留得住一格一格的對比），而淡色放到一條 6px 的槓
 * 上就等於沒有畫：#F0F9F7 的 26.5% 那一列在淺色軌道上完全看不出長度，最常發生的那個結果反而
 * 是表上唯一讀不到的一列。所以槓走的是同一個**家族**的深端 —— 碎片是青、造型是該階級自己的
 * `edge`、抽獎券是票面上那個金、功能卡是深一階的沙色。家族對得上，深淺各做各的事。
 *
 * 抽獎券刻意不用 `island-gold`：那個 token 在這個遊戲裡只屬於金幣（見 index.css 的註解），這裡
 * 用的是票券圖示自己的琥珀色。
 */
function prizeBarColor(slot: WheelSlot): string {
  if (slot.kind === 'outfit') return RARITY_SPECS[slot.rarity ?? 'rare'].edge;
  if (slot.kind === 'raffle-ticket') return '#E7BE63';
  if (slot.kind === 'function-card') return '#C3BBA8';
  return '#2A9D8F';
}

/**
 * 一種獎品在表上的一列。
 *
 * 沒有名字的那一半才是重點：**造型那兩列要說出「裡面有什麼」**。面上寫的是「稀有造型　隨機」，
 * 而「隨機」在玩家那一端是一個空白 —— 隨機從幾件裡抽？我已經有幾件了？再轉下去是不是只會轉出
 * 重複的？這三個問題都能從獎池自己算出來（{@link buildRewardPool} 就是抽獎當下真正會用的那份
 * 名單），不算出來就等於要玩家拿券去問。
 *
 * 已收藏數用 {@link ownsItem} 而不是任何自己維護的計數：擁有這件事全遊戲只有一個定義，表上這個
 * 數字跟更衣室看到的必須是同一個數字。
 */
function PrizeRow({ row, peak }: { row: WheelPrizeRow; peak: number }) {
  const { profile } = useApp();
  const { slot } = row;

  const pool = useMemo(
    () => (slot.kind === 'outfit' && slot.pool ? buildRewardPool(slot.pool) : null),
    [slot],
  );
  const owned = useMemo(
    () => (pool ? pool.filter(item => ownsItem(profile, item.id)).length : 0),
    [pool, profile],
  );

  const sub =
    slot.kind === 'outfit'
      ? pool && pool.length > 0
        ? `${pool.length} 件可抽・已收藏 ${owned}`
        : '目前沒有可抽的品項'
      : slot.kind === 'fragments'
        ? '隨機一件商品的碎片'
        : slot.kind === 'raffle-ticket'
          ? '轉回本，可以再轉一次'
          : `${getUtilityCard(slot.cardId)?.name ?? '功能卡'}・${getUtilityCard(slot.cardId)?.effectSummary ?? ''}`;

  return (
    <div className="flex items-center gap-2.5 px-3 py-2 border-b last:border-b-0 border-island-line/55">
      {/* 圖示連同它的底色一起從面上搬過來：表和面用同一個 WedgeMark、同一個 WEDGE_FILL，所以
          「表上這一列」和「面上那一格」是同一個東西，不是兩份要各自維護的說明。 */}
      <span
        className="w-8 h-8 rounded-lg border border-island-line flex items-center justify-center flex-shrink-0"
        style={{ background: WEDGE_FILL[slot.id] ?? '#FFFFFF' }}
      >
        <WedgeMark slot={slot} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-black text-island-navy leading-tight truncate">
          {slot.label}
          <span className="ml-1.5 text-island-navy-soft/80">{slot.detail}</span>
          {/* 只有佔不只一格的獎品會掛這個章。一格的獎品掛「1 格」是在回答沒有人問的問題。 */}
          {row.wedges > 1 && (
            <span className="ml-1.5 px-1.5 py-px rounded-full bg-island-cream-2 border border-island-line text-[9px] tabular-nums align-middle">
              {row.wedges} 格
            </span>
          )}
        </p>
        <p className="text-[10px] font-bold text-island-navy-soft/70 leading-tight truncate">{sub}</p>
      </div>

      {/* 一條跟最高那一列等比的橫槓。百分比自己已經是精確值了，這條槓負責的是另一件事：讓
          「26.5% 和 1.0% 差多遠」用看的就知道，不必兩個數字擺在眼前心算。長度歸一化到最大值而
          不是 100%，否則八列裡有七列都會短到看不出彼此的差別。 */}
      <span className="hidden sm:block w-16 h-1.5 rounded-full bg-island-line/50 overflow-hidden flex-shrink-0">
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.max(6, (row.chance / peak) * 100)}%`, background: prizeBarColor(slot) }}
        />
      </span>

      <span className="w-12 text-right text-xs font-black text-island-navy tabular-nums flex-shrink-0">
        {(row.chance * 100).toFixed(1)}%
      </span>
    </div>
  );
}

/**
 * 獎品與機率表 —— 轉盤的說明書，收在一顆可以展開的鍵底下。
 *
 * ## 為什麼非有不可
 *
 * 真實機率原本只活在每一格的 SVG `<title>` 裡，也就是**只有滑鼠停在格子上才看得到**。這個遊戲在
 * 手機上沒有 hover，所以在手機上這件事等於沒有做：面上寫著「史詩造型」，而它是 1% 還是 20% 完全
 * 無從得知。constants/luckyWheel.ts 把 `wheelSlotChance` export 出來就是為了「讓 UI 把真實數字印
 * 出來，而不是讓幾何去暗示一個錯的」—— tooltip 只做到了一半。
 *
 * ## 為什麼預設收起來
 *
 * 因為轉盤的主角是轉盤。一進面板就攤開九列數字，會把那顆「轉」鍵推到摺線以下，而玩家打開這個面
 * 板十次有九次是要轉，不是要查賠率。收起來的狀態只留一行鍵，展開之後 `<AnimatePresence>` 把高度
 * 讓出來 —— 查完再收回去，輪盤回到原位。
 */
function PrizeTable() {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => wheelPrizeTable(), []);
  const peak = rows[0]?.chance ?? 1;
  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <div className="w-full" ref={rootRef}>
      <button
        type="button"
        onClick={() => {
          playSound(SoundEffect.CLICK);
          setOpen(v => !v);
        }}
        aria-expanded={open}
        className="w-full h-10 px-3.5 rounded-xl bg-white border border-island-line hover:border-island-teal text-island-navy-soft hover:text-island-teal flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
      >
        <span className="text-[11px] font-black tracking-wide">獎品與機率</span>
        <ChevronDown
          size={15}
          strokeWidth={3}
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="prize-table"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
            // 這張表在面板的捲動區裡，而輪盤本身幾乎把可視高度佔滿 —— 展開之後表整個落在摺線
            // 以下，玩家按了一顆鍵然後畫面什麼都沒發生。等高度動完再把自己捲進來，按鍵和結果
            // 因此是同一件事。`block: 'end'` 而不是 'center'：要露出來的是表的**尾巴**（史詩
            // 那一列），不是中間。
            onAnimationComplete={() => rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })}
          >
            <div className="mt-2.5 rounded-2xl border border-island-line bg-white overflow-hidden">
              {rows.map(row => (
                <PrizeRow key={row.slot.id} row={row} peak={peak} />
              ))}
            </div>
            {/* 十格同寬是刻意的，而一張把史詩排在最後一列、寫著 1.0% 的表，正好是那個設計最需要
                的註腳：面是給人看的，機率是給人算的，兩件事在這裡都沒有騙人。 */}
            <p className="mt-2 text-[10px] font-bold text-island-navy-soft/60 leading-relaxed px-1">
              十格同寬只是為了讓每個獎品都看得見，實際機率以這張表為準。
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The panel: the face, the hub button, and one row underneath that says what just happened.
 *
 * ## Sizing
 *
 * `min(78vw, 54vh, 430px)` on the wrapper, and the SVG fills it — no viewport hook, no breakpoint
 * table. Every number inside the face is a viewBox unit, so labels, marks and spokes scale as one
 * piece and the two-character lines stay legible at every clamp. The `vh` term is not decoration:
 * this is a near-square panel with a header, and a wheel sized off width alone runs off the bottom
 * of a short laptop window.
 *
 * ## Why the result gets a reserved row
 *
 * The prize card lands in a fixed-height slot below the wheel rather than flying out over the face.
 * The slot cannot move the wheel when it fills (a face that jumps 60px the instant it stops is a
 * face you cannot read your own result off), and the card never covers the wedges the player is
 * checking it against.
 *
 * Portaled to `#floating-panel-root`: this is rendered from inside HudFrame, which is one stacking
 * context on the z-hud-frame tier (20). A `z-modal` written in there only ranks against the frame's
 * own children — see AccountPanel.tsx, which hit exactly this and fixed it the same way.
 */
function WheelPanel({ onClose }: { onClose: () => void }) {
  const { profile, spinLuckyWheel } = useApp();

  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  /**
   * Silences the ratchet. Held in a ref rather than in state because nothing renders off it and
   * because the cleanup below has to see the CURRENT handle, not the one from the render that
   * registered the effect.
   */
  const stopSpinSound = useRef<(() => void) | null>(null);
  const [prize, setPrize] = useState<WheelPrize | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * A second copy of the face's angle, as a motion value, so the ticker can be driven off it.
   *
   * The wedges are turned by the `animate` PROP on the <motion.svg>, and that has to stay: it is
   * where `onAnimationComplete` hangs, which is where the whole reveal hangs. A prop-driven
   * animation offers nothing else a per-frame handle, so the same target is run through this value
   * too — same duration, same curve, started in the same frame.
   *
   * Two animators for one number is normally a bug, and it is not one here for a specific reason:
   * this copy drives DECORATION ONLY. If the two ever disagreed by a frame the ticker would flick a
   * degree early and no one could see it, and neither of them is what decides the prize — the
   * payout was written before either started turning.
   */
  const faceAngle = useMotionValue(0);
  const tickerRef = useRef<SVGGElement>(null);
  const spinAnim = useRef<{ stop: () => void } | null>(null);
  /** Bumped once per spin, purely so the winning wedge's flash is re-keyed and plays again. */
  const [spinNo, setSpinNo] = useState(0);

  const tickets = getRaffleTickets(profile);
  // 免費轉盤次數 — 第 7 天的登入獎勵 (constants/dailyLogin.ts). Spent BEFORE a ticket is, by
  // context/useWheelActions.ts, so the panel has to say so before the spin rather than surprise the
  // player with a balance that did not move: a hub that charges a ticket in its label and then does
  // not take one is the same lie as one that takes a ticket it never mentioned.
  const freeSpins = getFreeSpins(profile);
  const canSpin = (freeSpins > 0 || tickets >= WHEEL_SPIN_COST) && !spinning;

  // Closing mid-spin unmounts the animating face, so `onAnimationComplete` never fires and the
  // panel comes back stuck on 轉動中. The prize is already written by then either way — this
  // protects the UI's own state only, and 3.6s is short enough to sit through.
  const requestClose = useCallback(() => {
    if (spinning) return;
    playSound(SoundEffect.CLICK);
    onClose();
  }, [spinning, onClose]);

  useEscapeToClose(requestClose);

  const handleSpin = async () => {
    if (!canSpin) return;
    playSound(SoundEffect.CLICK);
    triggerHaptic('light');
    setPrize(null);
    setNotice(null);
    setSpinning(true);

    const outcome = await spinLuckyWheel();
    if (!outcome.ok) {
      setSpinning(false);
      setNotice(
        outcome.reason === 'insufficient-tickets'
          ? '抽獎券不足'
          : outcome.reason === 'empty-pool'
            ? '目前沒有可以發放的獎品'
            : '轉盤暫時無法使用',
      );
      return;
    }

    // Land the drawn wedge under the pointer: wedge i sits at `i * 36°` clockwise from twelve, so
    // the wheel has to end at `-i * 36°` (mod 360). Five whole turns first, then the shortest
    // forward arc onto that angle — so the wheel always spins the same direction and always looks
    // like it slowed into its result rather than snapped to it.
    const index = wheelSlotIndex(outcome.slot.id);
    const target = -index * WHEEL_SLOT_ANGLE;
    const base = rotation + 360 * WHEEL_SPIN.turns;
    const next = base + (((target - base) % 360) + 360) % 360;
    setRotation(next);
    setPrize(outcome.prize);
    setSpinNo(n => n + 1);
    spinAnim.current?.stop();
    spinAnim.current = animate(faceAngle, next, {
      duration: WHEEL_SPIN.durationMs / 1000,
      ease: [...WHEEL_SPIN.ease] as [number, number, number, number],
    });

    // 咔咔聲, scheduled off the SAME angle the face is about to travel — `next - rotation` is this
    // turn's real distance, so the last peg sounds as the wheel settles rather than at a length
    // guessed here. See wheelPegTimes / playWheelSpin.
    stopSpinSound.current?.();
    stopSpinSound.current = playWheelSpin(wheelPegTimes(next - rotation), 0.55);
  };

  /**
   * A spin that never finished has to take its sound with it.
   *
   * The panel cannot be CLOSED mid-spin (requestClose refuses), but it can still be unmounted under
   * one: LuckyWheel renders nothing outside View.HOME, so walking into a building during those 3.6
   * seconds drops this component. The ticks are already scheduled on the audio clock at that point
   * and would happily clack away over the interior with nothing on screen turning.
   */
  useEffect(() => () => {
    stopSpinSound.current?.();
    spinAnim.current?.stop();
  }, []);

  /**
   * The ticker follows the face directly: one subscription writing one attribute, rather than sixty
   * React renders a second to move a decoration.
   *
   * It writes the SVG `transform` ATTRIBUTE rather than a CSS transform because an SVG element's
   * `transform-origin` resolves against the viewBox rather than against the element, and the pivot
   * here has to be the hinge at the top of the blade — `rotate(a cx cy)` says exactly that and
   * needs no `transform-box` incantation to mean it.
   */
  useEffect(() => {
    tickerRef.current?.setAttribute('transform', `rotate(0 ${CENTER} ${PIVOT_Y})`);
    return faceAngle.on('change', deg => {
      tickerRef.current?.setAttribute(
        'transform',
        `rotate(${tickerAngle(deg, faceAngle.getVelocity()).toFixed(2)} ${CENTER} ${PIVOT_Y})`,
      );
    });
  }, [faceAngle]);

  /**
   * Which wedge the pointer is parked on, read back off the angle the face was sent to rather than
   * kept as a second piece of state. The rotation IS the answer; two variables that have to agree
   * about one fact is one variable too many.
   */
  const restIndex =
    ((Math.round(-rotation / WHEEL_SLOT_ANGLE) % WHEEL_SLOTS.length) + WHEEL_SLOTS.length) % WHEEL_SLOTS.length;
  const settled = Boolean(prize) && !spinning;

  /** Fires when the wheel has actually stopped — the prize card and its sound wait for it. */
  const handleRest = () => {
    if (!spinning || !prize) return;
    setSpinning(false);
    // Belt and braces: the last peg lands ON the settle, so there is normally nothing left to
    // silence. What this covers is the frame the reveal sound is about to play into — a stray tick
    // surviving a rounding difference would land underneath it.
    stopSpinSound.current?.();
    stopSpinSound.current = null;
    const item = prize.kind === 'outfit' ? getItemById(prize.itemId) : null;
    playSound(
      item?.rarity === 'epic'
        ? SoundEffect.EPIC_REVEAL
        : prize.kind === 'outfit'
          ? SoundEffect.RARE_REVEAL
          : prize.kind === 'function-card' && prize.granted === 0
            ? SoundEffect.TICK
            : SoundEffect.REWARD,
    );
    triggerHaptic('medium');
  };

  return (
    <FloatingPanelPortal>
      <ModalOverlay scrimClassName={SCRIM_INK_DEEP} onClick={requestClose}>
        <ModalShell maxWidthClassName="max-w-xl" className="max-h-[94vh]">
          <PanelHeader
            icon={<WheelGlyph className="w-9 h-9" />}
            title="幸運轉盤"
            subtitle={
              freeSpins > 0
                ? `還有 ${freeSpins} 次免費轉，之後每轉一次 ${WHEEL_SPIN_COST} 張抽獎券`
                : `每轉一次 ${WHEEL_SPIN_COST} 張抽獎券`
            }
            onClose={spinning ? undefined : requestClose}
          />

          <div className="px-5 py-5 md:px-8 md:py-6 flex flex-col items-center gap-4 overflow-y-auto">
            {/* What the player has to pay the hub with — and, when they are holding one, the free
                turn that will be spent INSTEAD. Two chips rather than one combined number, because
                they are not interchangeable: a free turn is worth exactly one spin whatever a spin
                costs, and adding it into the ticket count would claim otherwise. */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {freeSpins > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#E6F6F2] border border-[#8FCFC3] text-island-teal-dark font-black text-xs tabular-nums">
                  <Gift size={14} strokeWidth={2.6} />
                  免費轉 {freeSpins.toLocaleString()}
                </span>
              )}
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#FDF3D8] border border-[#E8CE8C] text-island-navy font-black text-xs tabular-nums">
                <RaffleTicket size={15} />
                抽獎券 {tickets.toLocaleString()}
              </span>
            </div>

            <div
              className="wheel-stage relative flex-shrink-0"
              style={{ width: 'min(78vw, 54vh, 430px)', aspectRatio: '1 / 1' }}
            >
              {/* The light the cabinet stands in. Masked to a ring OUTSIDE the bezel, so it is glow
                  coming off the wheel rather than a pattern showing through the face, and it runs
                  nearly nine times faster during a spin — the one cue in the panel that something
                  is happening which does not require reading the wedges. */}
              <div className={`wheel-rays ${spinning ? 'wheel-rays-fast' : ''}`} aria-hidden="true" />

              {/* The face. Rotates as one piece, prize blocks and all. */}
              <motion.svg
                viewBox="0 0 200 200"
                className="absolute inset-0 w-full h-full drop-shadow-[0_14px_30px_rgba(38,70,83,0.20)]"
                animate={{ rotate: rotation }}
                // Duration and easing come from constants/luckyWheel.ts because the ratchet is
                // timed off the same two numbers — see WHEEL_SPIN.
                transition={{ duration: WHEEL_SPIN.durationMs / 1000, ease: [...WHEEL_SPIN.ease] }}
                onAnimationComplete={handleRest}
                role="img"
                aria-label={`幸運轉盤，共 ${WHEEL_SLOTS.length} 格獎品`}
              >
                <circle cx={CENTER} cy={CENTER} r={FACE_R} fill="#FFFFFF" />
                {WHEEL_SLOTS.map((slot, i) => {
                  const [bx, by] = polar(i * WHEEL_SLOT_ANGLE, BLOCK_R);
                  const [line1, line2] = WEDGE_FACE[slot.id] ?? [slot.label, slot.detail];
                  return (
                    <g key={slot.id}>
                      <title>{`${slot.label} ${slot.detail}　機率 ${(wheelSlotChance(slot) * 100).toFixed(1)}%`}</title>
                      <path d={wedgePath(i)} fill={WEDGE_FILL[slot.id] ?? '#FFFFFF'} stroke="#FFFFFF" strokeWidth="1.4" />
                      {/* Upright prize block: mark, then the two short lines. Never counter-rotated —
                          it is printed on the wheel, so it turns with it. */}
                      {/* Mark at by-21 and text from by+3: at by-20 / by+1 the first line's
                          ascenders ran ~4 units into the bottom of the mark on every wedge. */}
                      <g transform={`translate(${(bx - MARK_SIZE / 2).toFixed(2)} ${(by - 21).toFixed(2)})`}>
                        <WedgeMark slot={slot} />
                      </g>
                      <text
                        x={bx.toFixed(2)}
                        y={(by + 3).toFixed(2)}
                        textAnchor="middle"
                        fontSize="9.5"
                        fontWeight="900"
                        fill="#264653"
                      >
                        {line1}
                      </text>
                      <text
                        x={bx.toFixed(2)}
                        y={(by + 13.5).toFixed(2)}
                        textAnchor="middle"
                        fontSize="9"
                        fontWeight="900"
                        fill="#4A6169"
                      >
                        {line2}
                      </text>
                    </g>
                  );
                })}
                {/* Beading: one painted dot per wedge, out where the block cannot reach (every
                    block's farthest corner lands inside r≈77; these sit at 81.5). The band between
                    the labels and the rim was the one empty part of the face, and empty is what a
                    printed wheel never is. They ride the rotation, so they are also the only thing
                    on the outer face a player can actually watch go past. */}
                {WHEEL_SLOTS.map((slot, i) => {
                  const [dx, dy] = polar(i * WHEEL_SLOT_ANGLE, 81.5);
                  return (
                    <circle key={`bead-${slot.id}`} cx={dx.toFixed(2)} cy={dy.toFixed(2)} r="1.9" fill="#FFFFFF" opacity="0.72" />
                  );
                })}
                {/* Spokes, drawn over the wedges so every seam is one crisp line rather than two fills
                    meeting at a hairline that anti-aliases differently on each side. */}
                {WHEEL_SLOTS.map((slot, i) => {
                  const [ex, ey] = polar(i * WHEEL_SLOT_ANGLE - WHEEL_SLOT_ANGLE / 2, FACE_R);
                  return (
                    <line
                      key={`spoke-${slot.id}`}
                      x1={CENTER}
                      y1={CENTER}
                      x2={ex.toFixed(2)}
                      y2={ey.toFixed(2)}
                      stroke="#E1DED4"
                      strokeWidth="1.2"
                    />
                  );
                })}
                {/* The wedge that just won, outlined in a light that flares and then stays half up.
                    An OUTLINE and not a wash: the player's next move is to look at what they got,
                    and a white veil over the winning wedge covers the one prize they want to read.
                    Re-keyed per spin so landing on the same wedge twice still flashes. */}
                {settled && (
                  <path
                    key={`win-${spinNo}`}
                    className="wheel-wedge-win"
                    d={wedgePath(restIndex)}
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth="3.2"
                    strokeLinejoin="round"
                  />
                )}
              </motion.svg>

              {/* Bezel, bulbs, hub plate and the ticker — the cabinet, not the wheel, so none of it
                  turns. `wheel-lit` is what a spin does to the marquee: same chase, four times the
                  speed. */}
              <svg
                viewBox="0 0 200 200"
                className={`absolute inset-0 w-full h-full pointer-events-none ${spinning ? 'wheel-lit' : ''}`}
              >
                <defs>
                  {/* Kept faint: at 0.46 the dome washed the top-left 稀有造型 labels out to grey. */}
                  <radialGradient id="wheel-face-sheen" cx="30%" cy="22%" r="75%">
                    <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.24" />
                    <stop offset="62%" stopColor="#FFFFFF" stopOpacity="0.03" />
                    <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
                  </radialGradient>
                  {/* The dish. The face is ten flat fills; this is the only thing that says they are
                      lying in a bowl under a lid rather than printed on a card. */}
                  <radialGradient id="wheel-face-dish" cx="50%" cy="50%" r="50%">
                    <stop offset="58%" stopColor="#264653" stopOpacity="0" />
                    <stop offset="100%" stopColor="#264653" stopOpacity="0.15" />
                  </radialGradient>
                  <linearGradient id="wheel-bezel-ring" x1="36" y1="18" x2="164" y2="182" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#FFFFFF" />
                    <stop offset="0.45" stopColor="#F7F4EC" />
                    <stop offset="1" stopColor="#E2DDCF" />
                  </linearGradient>
                  {/* A bulb's halo. Warm, and deliberately NOT island-gold: gold is 金幣 in this game
                      and a ring of ten gold discs around a prize wheel would read as a payout. This
                      is lamplight on a frame — it lives in a socket, it has a filament colour, and
                      it goes out. */}
                  <radialGradient id="wheel-bulb-glow">
                    <stop offset="0%" stopColor="#FFF0C8" stopOpacity="0.95" />
                    <stop offset="45%" stopColor="#FFE3A2" stopOpacity="0.42" />
                    <stop offset="100%" stopColor="#FFE3A2" stopOpacity="0" />
                  </radialGradient>
                  <linearGradient id="wheel-ticker" x1="100" y1="4" x2="100" y2="22" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#3A6373" />
                    <stop offset="1" stopColor="#1A2E35" />
                  </linearGradient>
                </defs>

                {/* Dish and dome, painted OVER the face rather than under it, because they are the
                    glass and not one of the prizes. */}
                <circle cx={CENTER} cy={CENTER} r={FACE_R} fill="url(#wheel-face-dish)" />
                <circle cx={CENTER} cy={CENTER} r={FACE_R} fill="url(#wheel-face-sheen)" />

                {/* The bezel: one moulded cream ring lit from the top left, with a hairline on each
                    lip. It used to be a flat white band between two grey circles — correct tokens,
                    no object. */}
                <circle cx={CENTER} cy={CENTER} r={RIM_R} fill="none" stroke="url(#wheel-bezel-ring)" strokeWidth="11" />
                <circle cx={CENTER} cy={CENTER} r={FACE_R + 11} fill="none" stroke="#D9D4C6" strokeWidth="1.4" />
                <circle cx={CENTER} cy={CENTER} r={FACE_R + 0.6} fill="none" stroke="#D9D4C6" strokeWidth="1.2" />

                {/* Ten bulbs in ten sockets, one per seam — the same ten studs the ticker has to get
                    past, so the decoration and the mechanism are the same object rather than two
                    rings of dots. The chase is one animation with a negative delay per index, which
                    is what turns ten independent blinks into a light running round the rim. */}
                {WHEEL_SLOTS.map((slot, i) => {
                  const [px, py] = polar(i * WHEEL_SLOT_ANGLE - WHEEL_SLOT_ANGLE / 2, RIM_R);
                  const delay = `${(-(i / WHEEL_SLOTS.length) * 2.6).toFixed(2)}s`;
                  return (
                    <g key={`bulb-${slot.id}`}>
                      <circle cx={px.toFixed(2)} cy={py.toFixed(2)} r="3.6" fill="#FFFFFF" stroke="#D2CCBB" strokeWidth="0.9" />
                      <circle cx={px.toFixed(2)} cy={py.toFixed(2)} r="2.1" fill="#FFF8E9" />
                      <g className="wheel-bulb" style={{ animationDelay: delay }}>
                        <circle cx={px.toFixed(2)} cy={py.toFixed(2)} r="7" fill="url(#wheel-bulb-glow)" />
                        <circle cx={px.toFixed(2)} cy={py.toFixed(2)} r="2.1" fill="#FFDF9C" />
                      </g>
                    </g>
                  );
                })}

                {/* The plate the knob is bolted to, with its six rivets sitting just outside the
                    knob's own edge. It is what stops the ten wedges from running into the button. */}
                <circle cx={CENTER} cy={CENTER} r="33" fill="#FFFFFF" />
                <circle cx={CENTER} cy={CENTER} r="33" fill="none" stroke="#E1DED4" strokeWidth="1.3" />
                {[0, 1, 2, 3, 4, 5].map(k => {
                  const [rx, ry] = polar(k * 60 + 30, 30.5);
                  return <circle key={`rivet-${k}`} cx={rx.toFixed(2)} cy={ry.toFixed(2)} r="1.4" fill="#DFDACC" />;
                })}

                {/* The ticker. Hinged at the top and free to swing: tickerAngle drives it off the
                    face's own angle, so it is pinned over while the wheel is fast, clacks wedge by
                    wedge as it slows, and is standing straight up the moment it stops. Navy rather
                    than gold: island-gold is 金幣 only. */}
                <g ref={tickerRef}>
                  <path
                    d="M100 21.5 95 10.6Q94.4 6.6 100 5.2Q105.6 6.6 105 10.6Z"
                    fill="url(#wheel-ticker)"
                    stroke="#FFFFFF"
                    strokeWidth="2.4"
                    strokeLinejoin="round"
                  />
                  <path d="M98.6 9.6 99.7 17.4" stroke="#FFFFFF" strokeWidth="1.1" strokeLinecap="round" opacity="0.38" />
                  <circle cx={CENTER} cy={PIVOT_Y} r="4.4" fill="#FFFFFF" stroke="#264653" strokeWidth="1.8" />
                  <circle cx={CENTER} cy={PIVOT_Y} r="1.5" fill="#264653" />
                </g>
              </svg>

              {/* The hub is the button. Sits above the face so it never rotates — a spin control that
                  spins with the thing it controls is unclickable exactly when it matters.

                  Turned metal rather than a flat teal disc: the conic gradient is the knurl catching
                  light on four sides, the inset shadows are the crown and the undercut, and the two
                  flat rings of box-shadow are the collar it is seated in. Same lesson as Toolbar in
                  DESIGN_SYSTEM.md — 「change the construction, not the colour」; it is the same teal
                  it always was. `.wheel-hub-ready` breathes a ring while a spin is affordable, which
                  is the panel saying 「這個是可以按的」 without a word of copy. */}
              <button
                type="button"
                onClick={handleSpin}
                disabled={!canSpin}
                className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[29%] h-[29%] rounded-full flex flex-col items-center justify-center transition-transform ${
                  canSpin
                    ? 'wheel-hub wheel-hub-ready text-white active:scale-95 cursor-pointer'
                    : 'wheel-hub-off text-island-navy-soft/60 cursor-not-allowed'
                }`}
                title={
                  freeSpins > 0
                    ? '免費轉一次，不扣抽獎券'
                    : tickets >= WHEEL_SPIN_COST
                      ? `轉一次 ${WHEEL_SPIN_COST} 張抽獎券`
                      : '抽獎券不足'
                }
              >
                {spinning ? (
                  <RotateCw className="animate-spin w-[38%] h-[38%]" />
                ) : (
                  <>
                    <span className="font-black leading-none text-2xl md:text-[1.75rem] drop-shadow-[0_1px_1px_rgba(26,46,53,0.35)]">
                      轉
                    </span>
                    {/* The hub says what THIS press will cost, not what a spin is priced at — a
                        free turn is about to be spent and the label has to be the one that is true
                        for the next tap. */}
                    {freeSpins > 0 ? (
                      <span className="font-black leading-none mt-1 text-[10px] tracking-wide">免費</span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 font-black leading-none mt-1 text-[11px]">
                        <RaffleTicket size={11} />
                        {WHEEL_SPIN_COST}
                      </span>
                    )}
                  </>
                )}
              </button>
            </div>

            {/* The result row. Same height whether or not there is a result, so nothing above it
                moves when one arrives. */}
            <div className="w-full min-h-[5.25rem] flex items-center justify-center">
              <AnimatePresence mode="wait">
                {prize && !spinning ? (
                  <PrizeCard key="prize" prize={prize} onDismiss={() => setPrize(null)} />
                ) : notice ? (
                  <motion.span
                    key="notice"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    className="bg-white border border-island-line rounded-full px-4 py-2 text-xs font-black text-island-navy shadow-md"
                  >
                    {notice}
                  </motion.span>
                ) : (
                  <motion.p
                    key="hint"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-[11px] font-bold text-island-navy-soft/70 text-center leading-relaxed px-4"
                  >
                    {spinning ? '轉動中…' : '每一格都是實際獎品，展開下面的獎品表可以看到每一種的真實機率。'}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            {/* 賠率表。排在結果列**下面**：轉完之後眼睛該落在剛剛轉到什麼上，不是落在一顆鍵上。 */}
            <PrizeTable />
          </div>
        </ModalShell>
      </ModalOverlay>
    </FloatingPanelPortal>
  );
}

/**
 * The corner icon.
 *
 * It carries the ticket balance, because that is the one number that decides whether opening the
 * panel is worth doing — an icon that says only 「轉盤」 makes every check a round trip. With at
 * least one ticket the ring behind it breathes; at zero it goes quiet and the chip greys out, so
 * the affordance is legible without disabling the button (the panel is still worth opening at zero
 * — that is where a player finds out what they are saving for).
 */
function WheelLauncher({
  tickets,
  freeSpins,
  onOpen,
}: {
  tickets: number;
  /** 免費轉盤次數. A player holding one can spin with an empty ticket balance. */
  freeSpins: number;
  onOpen: () => void;
}) {
  const affordable = freeSpins > 0 || tickets >= WHEEL_SPIN_COST;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.85, y: 12 }}
      // The 新手引導 lights THIS wrapper and not the <button> inside it, because the ticket badge
      // hangs outside the button's own box (`-top-1 -left-2`) — spotlighting the button would cut
      // the balance in half, and the balance is the entire point of the station.
      {...tourTag(TOUR_TARGET.wheel)}
      // Placed (bottom-right corner) by the `bottom-right` HUD region — see HudFrame.tsx.
      // `relative` keeps the z-hud-toolbar tier working inside the frame.
      className="relative z-hud-toolbar pointer-events-none"
    >
      <button
        type="button"
        onClick={onOpen}
        className="group pointer-events-auto relative w-14 h-14 md:w-[4.25rem] md:h-[4.25rem] rounded-full transition-transform active:scale-95"
        title={
          freeSpins > 0
            ? `幸運轉盤 — 免費轉 ${freeSpins} 次、抽獎券 ${tickets}`
            : `幸運轉盤 — 抽獎券 ${tickets}`
        }
        aria-label={
          freeSpins > 0
            ? `打開幸運轉盤，有 ${freeSpins} 次免費轉、${tickets} 張抽獎券`
            : `打開幸運轉盤，目前有 ${tickets} 張抽獎券`
        }
      >
        {/* The halo, only while a spin is affordable. Behind the button's own disc, so it reads as
            light coming off the icon rather than as a second ring drawn round it. */}
        {affordable && (
          <span className="absolute inset-0 rounded-full bg-island-teal/25 animate-ping [animation-duration:2.4s]" />
        )}
        <span className="absolute inset-0 rounded-full bg-island-cream border border-island-line shadow-[0_8px_22px_rgba(38,70,83,0.24)] transition-shadow group-hover:shadow-[0_10px_28px_rgba(38,70,83,0.32)]" />
        <WheelGlyph
          className="relative w-full h-full p-[3px]"
          faceClassName="transition-transform duration-700 ease-out group-hover:rotate-[72deg]"
        />
        {/* Ticket count, tucked into the INBOARD corner — the button sits in the screen's bottom
            right, so a badge on the outboard side would hang off the viewport edge. */}
        <span
          className={`absolute -top-1 -left-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border font-black text-[10px] tabular-nums shadow-sm ${
            affordable
              ? 'bg-[#FDF3D8] border-[#E8CE8C] text-island-navy'
              : 'bg-island-cream-2 border-island-line text-island-navy-soft/60'
          }`}
        >
          {freeSpins > 0 ? <Gift size={10} strokeWidth={2.8} /> : <RaffleTicket size={10} />}
          {(freeSpins > 0 ? freeSpins : tickets).toLocaleString()}
        </span>
      </button>
    </motion.div>
  );
}

export function LuckyWheel() {
  const { currentView, profile } = useApp();
  const [open, setOpen] = useState(false);

  const tickets = getRaffleTickets(profile);
  const freeSpins = getFreeSpins(profile);

  // Island-only — nothing of this shows inside a building. The early return comes AFTER every hook
  // above, so the hook order is the same on both branches.
  if (currentView !== View.HOME) return null;

  return (
    <>
      <WheelLauncher
        tickets={tickets}
        freeSpins={freeSpins}
        onOpen={() => {
          playSound(SoundEffect.CLICK);
          setOpen(true);
        }}
      />
      <AnimatePresence>{open && <WheelPanel key="wheel-panel" onClose={() => setOpen(false)} />}</AnimatePresence>
    </>
  );
}
