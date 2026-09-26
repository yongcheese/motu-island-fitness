/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useId } from 'react';
import { useApp } from '../../context/AppContext';
import { ownsItem } from '../../utils/inventory';
import { getItemById } from '../../constants/items';
import {
  FRAGMENTS_PER_TICKET,
  FRAGMENTS_TO_UNLOCK,
  collectsFragments,
  fragmentName,
  getFragmentCount,
  getFragmentsRemaining,
  getRaffleTickets,
  getTicketProgress,
  isFragmentItem,
} from '../../constants/fragments';
import { QVersionIcon } from '../QVersionIcon';

/**
 * The 商品碎片 vocabulary every surface shares — the mark, the meter and the ticket chip.
 *
 * Same job as UI/ItemStock.tsx does for 庫存/購買: the shop card, the purchase dialog, the daily
 * board and the workout settlement all lay fragments out differently, and a player has to be able to
 * read 「我還差多少」 the same way in all four. The answer lives here so a new surface gets it right by
 * using it, not by re-deriving 200-minus-what-I-have and re-writing the copy.
 *
 * ## Colour — a prism, anchored on teal
 *
 * Fragments are NOT gold. Gold is reserved for currency (index.css says so at the token), and a
 * fragment is not money: it cannot be spent on anything but the one item it belongs to, and it is
 * earned rather than held. So the ramp starts on island-teal, the colour this game already uses for
 * its other earned track (經驗值's bolt), and that is the only colour a nearly-empty stack ever
 * shows.
 *
 * From there it splits, the way a shard of glass splits light: teal → 水藍 → violet → 珊瑚
 * (`--fragment-ramp`, index.css). The ramp is painted across the whole TRACK and clipped to the
 * fill, never stretched to fit it, so **how colourful the bar is IS how full it is** — a stack at
 * 30% is teal and sky, and only 200/200 has the coral in it. That is the entire reason the colour
 * was added: it gives the same number a second reading that works at thumbnail size, across a shelf,
 * without being read. Stretch the ramp to the fill instead and every stack looks identical again.
 *
 * 抽獎券 ARE money and take the gold family — but a torn stub rather than a disc, so the two never
 * read as the same thing sitting in the same header.
 */

/** The ramp's stops, mirrored from index.css so the SVG mark below can use them inline. */
const PRISM = {
  teal: '#2A9D8F',
  aqua: '#35C6B4',
  sky: '#4FB9E8',
  violet: '#8E8CEB',
  orchid: '#CE84D8',
  coral: '#E8836A',
} as const;

/**
 * The fragment mark: a chipped shard with the light broken across it. Never a coin, never a gem.
 *
 * Three faces, three parts of the ramp — the lit top-left in orchid-to-white, the body running aqua
 * to coral, and an edge that is itself graded from teal-dark to plum so the outline stays crisp
 * against both ends of the fill it sits on. Gradient ids are `useId`-scoped because this mark
 * renders a dozen times on one shelf and duplicate SVG ids resolve to whichever landed first.
 */
export function FragmentShard({
  size = 14,
  className = '',
  /** 集滿 — adds the halo. The shard is otherwise identical at every count. */
  lit = false,
}: {
  size?: number;
  className?: string;
  lit?: boolean;
}) {
  const uid = useId().replace(/:/g, '');
  const body = `frag-body-${uid}`;
  const facet = `frag-facet-${uid}`;
  const edge = `frag-edge-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`${lit ? 'fragment-shard-lit' : ''} ${className}`}
      aria-hidden
    >
      <defs>
        <linearGradient id={body} x1="4" y1="3" x2="19" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={PRISM.aqua} />
          <stop offset="0.4" stopColor={PRISM.sky} />
          <stop offset="0.72" stopColor={PRISM.violet} />
          <stop offset="1" stopColor={PRISM.coral} />
        </linearGradient>
        <linearGradient id={facet} x1="2.6" y1="10" x2="12.6" y2="2.3" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={PRISM.orchid} />
          <stop offset="1" stopColor="#F2FCF8" />
        </linearGradient>
        <linearGradient id={edge} x1="3" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1F7A70" />
          <stop offset="1" stopColor="#9B5578" />
        </linearGradient>
      </defs>

      <path d="M12.6 2.3 21 9.1l-4.2 12.2-9.6-1.1L2.6 9.5z" fill={`url(#${body})`} />
      {/* The lit face — the one catching the light, and the reason the mark reads as a broken piece
          of something rather than as a pentagon. */}
      <path d="M12.6 2.3 9.6 12 2.6 9.5z" fill={`url(#${facet})`} opacity="0.92" />
      {/* The second face, a half-tone between the two, so the shard still has depth at 11px. */}
      <path d="M12.6 2.3 21 9.1 9.6 12z" fill="#FFFFFF" opacity="0.22" />
      <path
        d="M12.6 2.3 21 9.1l-4.2 12.2-9.6-1.1L2.6 9.5z"
        stroke={`url(#${edge})`}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M12.6 2.3 9.6 12l7.2 9.3M9.6 12 2.6 9.5"
        stroke={`url(#${edge})`}
        strokeWidth="1.1"
        strokeLinejoin="round"
        opacity="0.5"
      />
    </svg>
  );
}

/**
 * The 抽獎券 mark: a torn stub with a punched bite on each side. Gold, because it is spendable.
 *
 * The same ticket as the 64px one in QVersionIcon.tsx, one detail level down — that file's own
 * comment already promised 「兩者是同一張票的兩個尺寸」, and this is that promise paid. What was
 * missing was everything that makes paper look like paper: the body was one flat fill with square
 * corners, which at 11px in a wallet chip is a gold pill with a dotted line on it.
 *
 * Three things carry the shrink, and each one is chosen because it survives being small:
 *
 *  1. **The silhouette** — rounded corners and the two half-round bites at the waist. Same trick as
 *     the big icon: the corners sweep 1 (convex), the bites sweep 0, and that single digit is the
 *     whole difference between a bump and a notch.
 *  2. **The stub as a BAND, not a hairline.** A dashed line alone is the first thing to disappear;
 *     a deeper gold field behind it still says 「這張票有票根」 down to about 8px.
 *  3. **A raking gradient** across the body, so the card stock has a lit edge and a shaded one.
 *
 * The big icon's little wheel and its star are deliberately NOT here. They are 8px features on a
 * 64px drawing, which is 1.3px on the size this mark actually spends its life at.
 */
export function RaffleTicket({ size = 14, className = '' }: { size?: number; className?: string }) {
  const uid = useId().replace(/:/g, '');
  const paper = `ticket-paper-${uid}`;
  const clip = `ticket-clip-${uid}`;

  /** One ticket's outline. Corners sweep 1; the two waist bites sweep 0, which is what bites them in. */
  const outline =
    'M5 7.4H19A2 2 0 0 1 21 9.4V10.5A1.8 1.8 0 0 0 21 14.1V15.2A2 2 0 0 1 19 17.2H5'
    + 'A2 2 0 0 1 3 15.2V14.1A1.8 1.8 0 0 0 3 10.5V9.4A2 2 0 0 1 5 7.4Z';

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={paper} x1="4" y1="7" x2="11" y2="18" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FCE3A6" />
          <stop offset="0.5" stopColor="#F3C566" />
          <stop offset="1" stopColor="#DFA236" />
        </linearGradient>
        <clipPath id={clip}>
          <path d={outline} />
        </clipPath>
      </defs>

      <path d={outline} fill={`url(#${paper})`} />
      {/* Stub and highlight, both clipped to the ticket so their ends are the ticket's own rounded
          corners rather than two rectangles poking out of it. */}
      <g clipPath={`url(#${clip})`}>
        <rect x="14.2" y="6" width="8.4" height="12.4" fill="#E2A63E" />
        <path d="M5.5 9.1H12.6" stroke="#FFFFFF" strokeWidth="1.3" strokeLinecap="round" opacity="0.6" />
      </g>
      <path d={outline} stroke="#C98A24" strokeWidth="1.5" strokeLinejoin="round" />
      {/* The perforation: a pale groove with the punch holes dashed over it. Two strokes, because a
          row of dark dashes on gold reads as dirt, and the light line under them reads as a fold. */}
      <path d="M14.2 8.3v8" stroke="#FFEFC8" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M14.2 8.3v8" stroke="#C98A24" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="1.5 1.7" />
    </svg>
  );
}

/**
 * The bar itself — the one place the prism is actually assembled.
 *
 * Shared by the meter and the gain card so a stack cannot look 40% full in the shop and 40% full in
 * a different colour on the settlement screen.
 *
 * The nesting is what makes 「顏色＝進度」 work and is not incidental:
 *
 *   track (the full width)
 *     └ fill      width = pct%          ← clips
 *         └ ink   width = 100/pct×100%  ← always exactly the track's width, so the ramp is laid
 *                                         across the WHOLE bar and the fill reveals a prefix of it
 *
 * Sizing the ink to the fill instead would stretch the whole ramp into whatever is filled, and every
 * stack from 5% to 100% would show the identical run of colour.
 */
function FragmentBar({
  pct,
  ready,
  height = 'h-2',
  className = '',
}: {
  pct: number;
  ready: boolean;
  height?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  // 100/pct of the fill's own width == the track's width. Capped so a 1-fragment stack does not ask
  // the browser for a 20000%-wide element.
  const inkWidth = clamped > 0 ? `${Math.min(6000, (100 / clamped) * 100)}%` : '100%';

  return (
    <div className={`fragment-track ${ready ? 'fragment-ready' : ''} w-full ${height} ${className}`}>
      <div className="fragment-fill" style={{ width: `${clamped}%` }}>
        <div className="fragment-ink" style={{ width: inkWidth }} />
        {/* The gloss needs something to travel across; under ~6% there is no bar to catch it and it
            reads as a flicker at the left edge instead. */}
        {clamped > 6 && <div className="fragment-sheen" />}
      </div>
      {/* Quarter marks — 「還差多少」 as a shape, for the glance that never reads the number. */}
      {[25, 50, 75].map(mark => (
        <span key={mark} className="fragment-notch" style={{ left: `${mark}%` }} aria-hidden />
      ))}
    </div>
  );
}

/**
 * 碎片進度 — the bar, the count and the 還差 line for one item.
 *
 * Renders NOTHING for an item that has no fragment of its own (經驗值 rewards, 毛胚屋), and nothing
 * for an item whose race is genuinely over. Both are deliberate: a bar under a finished race is a
 * progress readout for nothing.
 *
 * ## 「已擁有」 is not 「結束了」
 *
 * The gate here used to be `owned && held === 0`, which quietly made those two the same sentence.
 * They are not. An own-once item (a hat) is finished the moment it is owned. A STACKABLE one is not:
 * a second sofa is a real purchase, so its fragments still buy something and the bar has to keep
 * standing. {@link collectsFragments} is that distinction, and it is the same predicate the drop
 * roll, the unlock and the purchase settlement now ask — a bar that shows is a bar that can be
 * filled and spent, in all four places or none.
 *
 * The one case it still draws on a finished item is a leftover stack — which should not exist,
 * because buying an own-once item with gold settles it (context/useShopActions.ts). Drawing it
 * anyway means a save that somehow holds one says so instead of hiding it.
 *
 * It sits in a tinted well (`.fragment-well`) rather than loose on the card, because on a shop card
 * this is not one more line of copy — it is the SECOND offer, standing next to the gold price, and a
 * player has to be able to see that this card has two prices without reading either.
 */
export function FragmentMeter({
  itemId,
  className = '',
  /** Drops the 還差 line and shrinks the type — for a card that has little room to give. */
  compact = false,
}: {
  itemId: string;
  className?: string;
  compact?: boolean;
}) {
  const { profile } = useApp();
  if (!isFragmentItem(itemId)) return null;

  const held = getFragmentCount(profile, itemId);
  const owned = ownsItem(profile, itemId);
  const collecting = collectsFragments(itemId, owned);
  // Nothing left to collect AND nothing left over: the race is finished and there is no bar to draw.
  // A leftover stack on a finished item still draws, so the save can say so.
  if (!collecting && held === 0) return null;

  const remaining = getFragmentsRemaining(profile, itemId);
  const ready = remaining === 0;
  const pct = Math.min(100, (held / FRAGMENTS_TO_UNLOCK) * 100);
  // 「再一件」 rather than 「解鎖」 once one is already owned — the bar is the same bar, but what it
  // buys is a second copy, and the copy says so rather than leaving the player to work out why a
  // progress meter is sitting under a card marked 已擁有.
  const again = owned && collecting;

  return (
    <div
      className={`fragment-well w-full ${ready ? 'fragment-well-ready' : ''} ${
        compact ? 'px-2.5 py-2' : 'px-3 py-2.5'
      } ${className}`}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="inline-flex items-center gap-1 text-island-navy-soft/85 font-bold text-[10px] min-w-0">
          <FragmentShard size={compact ? 12 : 14} lit={ready} className="flex-shrink-0" />
          <span className="truncate">{fragmentName(itemId)}</span>
        </span>
        {/* `tabular-nums` and the fixed bar height below keep a card the same size as the number
            grows — the shelf must not reflow every time a workout pays out. */}
        <span
          className={`font-black tabular-nums flex-shrink-0 ${compact ? 'text-[10px]' : 'text-[11px]'} ${
            ready ? 'fragment-ramp-text' : 'text-island-navy-soft/85'
          }`}
        >
          {held.toLocaleString()}
          <span className={ready ? '' : 'opacity-55'}> / {FRAGMENTS_TO_UNLOCK}</span>
        </span>
      </div>

      <FragmentBar pct={pct} ready={ready} height={compact ? 'h-1.5' : 'h-2'} />

      {!compact && (
        <p className={`mt-1.5 text-[10px] font-bold ${ready ? 'fragment-ramp-text' : 'text-island-navy-soft/60'}`}>
          {ready
            ? (again ? '碎片已集滿，可再免費解鎖一件' : '碎片已集滿，可直接解鎖')
            : `還差 ${remaining.toLocaleString()} 個碎片${again ? '可再換一件' : ''}`}
        </p>
      )}
    </div>
  );
}

/**
 * 抽獎券 balance, with the fraction of the next one showing underneath.
 *
 * The carry is drawn as a hairline rather than a second number: it is not a currency the player
 * spends, it is the promise that 多出來的碎片 are not being thrown away, and it only has to be
 * visible enough to answer 「那剩下的幾個去哪了」.
 */
export function RaffleTicketChip({ className = '' }: { className?: string }) {
  const { profile } = useApp();
  const tickets = getRaffleTickets(profile);
  const carry = getTicketProgress(profile);

  return (
    <span
      className={`inline-flex flex-col gap-1 px-3 py-1.5 rounded-full bg-island-gold/12 border border-island-gold/35 text-island-navy font-black text-xs ${className}`}
      title={
        carry > 0
          ? `抽獎券 ${tickets}　再 ${FRAGMENTS_PER_TICKET - carry} 個多餘碎片可換下一張`
          : `抽獎券 ${tickets}`
      }
    >
      <span className="inline-flex items-center gap-1.5 leading-none">
        <RaffleTicket size={13} />
        <span>{tickets.toLocaleString()}</span>
      </span>
      {carry > 0 && (
        <span className="h-[3px] w-full rounded-full bg-island-gold/25 overflow-hidden" aria-hidden>
          <span
            className="block h-full rounded-full bg-island-gold"
            style={{ width: `${(carry / FRAGMENTS_PER_TICKET) * 100}%` }}
          />
        </span>
      )}
    </span>
  );
}

/**
 * One 「+N 碎片」 announcement, with the item it is for.
 *
 * Used by the surfaces that PAY fragments rather than the ones that spend them — the workout
 * settlement and the daily claim. It shows the item's own artwork because that is the whole point of
 * a per-item fragment: the reward is not "some fragments", it is 「離那盞燈更近了」, and a player who
 * cannot see which lamp has been handed a number rather than a reward.
 */
export function FragmentGainCard({
  itemId,
  amount,
  overflow = 0,
  className = '',
}: {
  itemId: string;
  /** How many landed on the item. */
  amount: number;
  /** How many had nowhere to go and became 抽獎券 instead. */
  overflow?: number;
  className?: string;
}) {
  const { profile } = useApp();
  const item = getItemById(itemId);
  if (!item) return null;

  const held = getFragmentCount(profile, itemId);
  const remaining = getFragmentsRemaining(profile, itemId);
  const ready = remaining === 0;

  return (
    <div className={`fragment-well flex items-center gap-3 p-3 ${ready ? 'fragment-well-ready' : ''} ${className}`}>
      <div className="w-12 h-12 rounded-xl bg-white border border-island-line flex items-center justify-center flex-shrink-0 overflow-hidden">
        <QVersionIcon itemId={item.id} size={40} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-black text-island-navy truncate">{fragmentName(item)}</span>
          {amount > 0 && (
            <span className="inline-flex items-center gap-1 font-black text-sm flex-shrink-0">
              <FragmentShard size={14} lit={ready} />
              <span className="fragment-ramp-text">+{amount}</span>
            </span>
          )}
        </div>
        <FragmentBar pct={Math.min(100, (held / FRAGMENTS_TO_UNLOCK) * 100)} ready={ready} className="mt-1.5" />
        <p className="text-[10px] font-bold text-island-navy-soft/70 mt-1">
          {held.toLocaleString()} / {FRAGMENTS_TO_UNLOCK}
          {ready ? '　·　可解鎖' : `　·　還差 ${remaining.toLocaleString()}`}
          {overflow > 0 && `　·　多出的 ${overflow} 個已轉為抽獎券`}
        </p>
      </div>
    </div>
  );
}
