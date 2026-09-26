/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { Coins, Gem, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '../../context/AppContext';
import { getBalance } from '../../constants/currency';
import { playSound, SoundEffect } from '../../lib/soundUtils';
import { AccountPanel } from './AccountPanel';
import { AvatarIcon } from './AvatarIcon';
import { PortholeFrame } from './DesignKit';
import { View } from '../../types';
import { useHudTier, useIsShortViewport } from '../../hooks/useHudTier';
// 管理員數值調整 — the quick +10K 金幣 / +1K XP row, and the exact-figure editor it belongs with.
// Shared with AccountPanel so the two can never drift apart; they used to each hand-roll a copy.
import { profileLevel, xpIntoLevel } from '../../utils/level';
// Station 1 of the 新手引導 (NewbieTour.tsx) — the marker goes on the outermost card.
import { TOUR_TARGET, tourTag } from '../../constants/tourTargets';

/**
 * 個人資訊卡 — the top-left profile card, and the reference implementation of
 * the responsive HUD size system (index.css, hooks/useHudTier.ts).
 *
 * WHAT CHANGED AND WHY. This used to be two entirely separate JSX trees picked
 * by POINTER TYPE: a compact strip for `pointer: coarse`, a ~255x269px ticket
 * for everything else. Two things were wrong with that.
 *
 *   1. Pointer type is not screen size. A touchscreen laptop got the phone
 *      card; a narrow non-touch window got the full-size one, at which point
 *      the card covered ~18% of the viewport. Layout now follows the WIDTH
 *      TIER (useHudTier) and touch only decides hit-target size (`.hud-hit`),
 *      which is the split those two signals actually describe.
 *   2. Every size was written twice, so "make it smaller" meant editing two
 *      trees and six copies of the same progress bar. There is now ONE tree;
 *      what varies with the tier is the ARRANGEMENT (below), and every
 *      dimension in it comes from the --hud-* token scale rather than from a
 *      literal in this file. Resizing the whole HUD is an edit to index.css.
 *
 * INFORMATION HIERARCHY — three rungs, and no tier drops a rung entirely:
 *
 *   Primary   頭像, 名稱, 等級, 金幣, 碎片 — visible at every tier, in every
 *             state. 金幣 AND 碎片 both: a HUD that shows one resource and
 *             hides the other is how a player concludes there is only one
 *             (DESIGN_SYSTEM.md, 貨幣).
 *   Secondary the three progress bars — how far into the level, how each
 *             balance sits against its own scale, and which activity pays it.
 *             Present at every tier, but foldable, and folded by default where
 *             the screen cannot spare the height.
 *   Tertiary  管理員數值調整 — inside the fold, admins only.
 *
 * ARRANGEMENT PER TIER:
 *
 *   mobile / tablet ("compact")  one line: avatar · name/LV · 金幣 · 碎片 · ⌄.
 *                                The fold opens underneath.
 *   laptop / desktop ("full")    avatar · name/LV · ⌄ over a fixed-width
 *                                column; the fold swaps the currency chip row
 *                                for the three bars.
 *
 * The fold's DEFAULT is open on the two big tiers and closed on the two small
 * ones — except on a short viewport (<=800px tall, `useIsShortViewport`), where
 * a 1366x768 laptop is wide enough for the full layout and has no vertical room
 * to spare: the rail below this card (SideButtons) shares one scroll region
 * with it. Whatever the player then chooses wins for the rest of the session at
 * every size — hence `detailOverride`'s three states rather than a boolean.
 */

/**
 * Primary numbers never wrap and never truncate — a balance read as "12,3…" is
 * worse than no balance at all. Five characters at most, so the compact row's
 * width is bounded however rich the player gets.
 */
function shortNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/** 金幣 + 碎片, side by side. The primary rung, so it is never behind the fold. */
function CurrencyChips({ coins, fragments }: { coins: number; fragments: number }) {
  return (
    <span className="flex items-center" style={{ gap: 'var(--hud-chip-gap)' }}>
      <span className="flex items-center gap-1" aria-label={`金幣 ${coins}`}>
        <Coins size={13} className="hud-icon text-island-gold" aria-hidden="true" />
        <span className="hud-text-title font-mono font-black text-island-gold whitespace-nowrap">
          {shortNumber(coins)}
        </span>
      </span>
      <span className="flex items-center gap-1" aria-label={`碎片 ${fragments}`}>
        <Gem size={13} className="hud-icon text-island-teal-dark" aria-hidden="true" />
        <span className="hud-text-title font-mono font-black text-island-teal-dark whitespace-nowrap">
          {shortNumber(fragments)}
        </span>
      </span>
    </span>
  );
}

/**
 * One labelled progress bar. Six hand-written copies of this markup (three per
 * layout) is what made the card expensive to resize. The label row truncates
 * and the value never does, so the same component serves a 148px laptop column
 * and a phone card's full width.
 */
function StatBar({
  icon,
  label,
  value,
  valueClass,
  percent,
  barClass,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  valueClass: string;
  percent: number;
  barClass: string;
}) {
  return (
    <div className="flex flex-col text-left" style={{ gap: 'var(--hud-row-gap)' }}>
      <div className="flex justify-between items-center gap-1.5 hud-text-meta font-black text-island-navy-soft tracking-wide">
        <span className="flex items-center gap-1 min-w-0 truncate">
          {icon}
          {label}
        </span>
        <span className={`font-mono font-black shrink-0 ${valueClass}`}>{value}</span>
      </div>
      <div
        className="w-full bg-white rounded-full overflow-hidden border border-island-line relative"
        style={{ height: 'var(--hud-bar-h)' }}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 relative ${barClass}`}
          style={{ width: `${percent}%` }}
        >
          <span className="absolute inset-x-0 top-0 h-[40%] bg-white/25 rounded-t-full pointer-events-none" />
        </div>
      </div>
    </div>
  );
}

export function TopBar() {
  const { profile, activePlacementItem, currentView } = useApp();
  const [showAccountPanel, setShowAccountPanel] = useState(false);
  const tier = useHudTier();
  const isShortViewport = useIsShortViewport();
  // Three states, not two: `null` means "whatever this tier defaults to", so a
  // player who resizes their window (or rotates a tablet) gets the arrangement
  // that fits — while an explicit tap is remembered across every later resize.
  const [detailOverride, setDetailOverride] = useState<boolean | null>(null);

  if (!profile || currentView !== View.HOME || activePlacementItem !== null) return null;

  const isCompact = tier === 'mobile' || tier === 'tablet';
  const showDetail = detailOverride ?? (!isCompact && !isShortViewport);

  // Calculate XP progress ratio.
  //
  // Both numbers come from utils/level.ts, which derives 等級 from cumulative XP — `profile.level`
  // is seeded as 1 and never written again, so the badge could not move however much XP was
  // earned. See that file for why the 測試補給 button in particular looked completely dead: +1000 XP
  // is a whole number of levels, so the bar below comes back to the very same width.
  const xpProgress = xpIntoLevel(profile.currentXp);
  const level = profileLevel(profile);
  // Both balances come from the currency table rather than off the profile, so where each one is
  // stored stays a detail of constants/currency.ts. See §22 on why they are shown together.
  const coins = getBalance(profile, 'coins');
  const fragments = getBalance(profile, 'fragments');
  // Calculate Gold tracking budget (target goal of 50,000 for visuals)
  const goldLimit = 50000;
  const goldProgress = Math.min(100, (coins / goldLimit) * 105);
  /**
   * 碎片's own bar, on its own scale.
   *
   * 1,000 rather than 50,000, and that ratio IS the point: a shared axis would draw the fragment
   * bar as a permanently empty sliver next to a full gold one, which reads as 「你幾乎沒有碎片」
   * rather than as 「這是另一種資源」. Roughly six full daily-login rounds (156 碎片 each), so the
   * bar moves visibly for a player who actually collects them.
   */
  const fragmentLimit = 1000;
  const fragmentProgress = Math.min(100, (fragments / fragmentLimit) * 105);

  const toggleDetail = () => {
    playSound(SoundEffect.CLICK);
    setDetailOverride(!showDetail);
  };

  const avatarButton = (
    <button
      type="button"
      onClick={() => {
        playSound(SoundEffect.CLICK);
        setShowAccountPanel(true);
      }}
      // `.hud-hit` grows the finger target to 44px on touch without changing
      // the drawn size — a 32px avatar is a legible picture and an unreliable
      // button, and shrinking the card must not shrink the target with it.
      className="hud-hit shrink-0 cursor-pointer hover:scale-105 active:scale-95 transition-transform"
      title="查看帳號中心"
      aria-label="查看帳號中心"
    >
      {/* Bolts only on the big tiers: four dots around a 32px porthole is
          noise, not detail. Both sizes are the one --hud-avatar token. */}
      <PortholeFrame
        size="var(--hud-avatar)"
        bolts={!isCompact}
        className="shadow-[0_3px_10px_rgba(42,157,143,0.15)]"
      >
        <AvatarIcon id={profile.avatar} size="calc(var(--hud-avatar) * 0.82)" />
      </PortholeFrame>
    </button>
  );

  const nameBlock = (
    <div className="flex flex-col gap-0.5 min-w-0 text-left">
      <span
        className="hud-text-title font-black text-island-navy select-none truncate"
        style={{ maxWidth: 'var(--hud-name-max-w)' }}
        title={profile.displayName}
      >
        {profile.displayName}
      </span>
      {/* 「LV n」 at every tier rather than 「等級 n」 on the big ones: two glyphs
          instead of four buys the name that much more room, and the badge is
          then the same object on every screen. */}
      <span className="hud-text-meta self-start font-black font-mono tracking-wider text-island-teal bg-island-teal/10 px-1.5 py-px rounded-full border border-island-teal/30">
        LV {level}
      </span>
    </div>
  );

  const chevron = (
    <ChevronDown
      size={14}
      className={`hud-icon text-island-navy-soft transition-transform duration-200 ${showDetail ? 'rotate-180' : ''}`}
      aria-hidden="true"
    />
  );

  const detailPanel = (
    <div
      className="flex flex-col bg-island-cream-2 rounded-2xl border border-island-line"
      style={{ gap: 'var(--hud-card-gap)', padding: 'var(--hud-stat-pad)' }}
    >
      <StatBar
        label="經驗 XP"
        value={`${xpProgress} / 100`}
        valueClass="text-island-navy-soft"
        percent={xpProgress}
        barClass="bg-island-teal"
      />
      <StatBar
        icon={<Coins size={11} strokeWidth={2.5} className="hud-icon text-island-gold" aria-hidden="true" />}
        label="金幣・健身取得"
        value={coins.toLocaleString()}
        valueClass="text-island-gold"
        percent={goldProgress}
        barClass="bg-island-gold"
      />
      {/* 碎片 gets a bar of its own rather than a number tucked elsewhere: the
          subtitle on each bar is where the two resources are actually told
          apart — a colour says 「不同」, a source says 「為什麼不同」. */}
      <StatBar
        icon={<Gem size={11} strokeWidth={2.5} className="hud-icon text-island-teal-dark" aria-hidden="true" />}
        label="碎片・非健身取得"
        value={fragments.toLocaleString()}
        valueClass="text-island-teal-dark"
        percent={fragmentProgress}
        barClass="bg-island-teal"
      />
      {/* 管理員數值調整 used to hang here, inside the player's own profile card. It moved to the
          管理員測試 console (UI/admin/, 玩家數值), which is also where it stopped having to fold
          into a ~170px column — see AdminSupplyButtons' own note about wrapping to 2x2. */}
    </div>
  );

  return (
    <>
      {/* Placed by the `left-rail` HUD region (HudFrame.tsx); `relative` keeps
          the z-hud-topbar tier for local stacking within the frame.

          The card's shadow is `.notch-shadow-hoverable` on this WRAPPER, not a
          `shadow-[...]` on the `dock-notch` element — a clip-path clips the
          element's own box-shadow away (see index.css). */}
      <div
        {...tourTag(TOUR_TARGET.account)}
        className={`relative z-hud-topbar notch-shadow-hoverable pointer-events-auto transition-all duration-300 ease-out ${
          showAccountPanel ? 'opacity-0 scale-95 pointer-events-none' : ''
        }`}
      >
        {/* Width comes from --hud-card-w: `max-content` on the compact tiers
            (the card is exactly as wide as its one row) and a fixed column on
            the big ones. --hud-card-max-w is the guarantee that it can never
            run off a narrow viewport or swallow the view, however long a
            player's display name is. */}
        <div
          className="flex flex-col bg-white dock-notch rounded-2xl border border-island-line"
          style={{
            width: 'var(--hud-card-w)',
            maxWidth: 'var(--hud-card-max-w)',
            padding: 'var(--hud-card-pad)',
            gap: 'var(--hud-card-gap)',
          }}
        >
          <div className="flex items-center" style={{ gap: 'var(--hud-chip-gap)' }}>
            {avatarButton}
            {nameBlock}

            {isCompact ? (
              /* Compact: the currencies and the fold control are ONE button,
                 which is also what keeps ONE target instead of two adjacent
                 small ones. `self-stretch` gives it the row's full height and
                 `.hud-hit` takes it the rest of the way to 44px on touch — the
                 row is only ~32px tall once the card is this small. */
              <button
                type="button"
                onClick={toggleDetail}
                aria-expanded={showDetail}
                className="hud-hit flex items-center gap-1.5 ml-auto self-stretch shrink-0 pl-2 border-l border-island-line cursor-pointer"
                title={showDetail ? '收合詳細數值' : '展開詳細數值'}
              >
                <CurrencyChips coins={coins} fragments={fragments} />
                {chevron}
              </button>
            ) : (
              <button
                type="button"
                onClick={toggleDetail}
                aria-expanded={showDetail}
                className="hud-hit ml-auto shrink-0 p-1 -mr-0.5 rounded-lg hover:bg-island-sand cursor-pointer"
                title={showDetail ? '收合詳細數值' : '展開詳細數值'}
                aria-label={showDetail ? '收合詳細數值' : '展開詳細數值'}
              >
                {chevron}
              </button>
            )}
          </div>

          {(showDetail || !isCompact) && <div className="rope-stitch" />}

          {/* Full layout, folded: the primary numbers move out of the fold and
              onto their own line, so collapsing the card hides the SECONDARY
              rung only. Nothing a player needs at a glance is ever behind a
              tap. */}
          {!isCompact && !showDetail && (
            <div className="flex justify-center py-0.5">
              <CurrencyChips coins={coins} fragments={fragments} />
            </div>
          )}

          <AnimatePresence initial={false}>
            {showDetail && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                {detailPanel}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {showAccountPanel && <AccountPanel onClose={() => setShowAccountPanel(false)} />}
      </AnimatePresence>
    </>
  );
}
