/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Shared presentational building blocks for the whole app's UI chrome —
// not just home/build-mode/shop anymore. Purely visual — no app state, no
// data fetching. Goal: every modal/card/button/tooltip/toast comes from the
// same handful of pieces instead of each screen re-inventing its own
// Tailwind string. Colors come from the --color-island-* tokens in
// src/index.css. Full rules (radius/shadow/font/state/z-index scales) live
// in DESIGN_SYSTEM.md next to this file — read that before adding a new
// one-off style here or in a consuming component.

import React from 'react';
import { motion, type HTMLMotionProps, type TargetAndTransition, AnimatePresence } from 'motion/react';
import { X, Coins, Gem } from 'lucide-react';
import { ANGEL_AVOID } from '../../constants/angelAvoid';

// --- Modal shell -----------------------------------------------------------

/**
 * The shared scrim. `island-navy` is the app's ink, so dimming with it is the same move as
 * writing with it — every modal in the game sits on this and should keep sitting on it.
 *
 * It is worth knowing what it looks like, though, because it is not neutral: #264653 is a
 * dark BLUE, and at 45% over the cream shop it composites to roughly #9AA5A4 — a blue-grey.
 * That is right for a dialog (it pushes the page back and leaves the panel warm by contrast)
 * and wrong for anything that has to read as darkness rather than as a tint, which is why
 * {@link ModalOverlay} lets a caller replace it. See PurchaseDialog and RarityReveal.
 */
export const SCRIM_INK = 'bg-island-navy/45';

/**
 * A deeper version of {@link SCRIM_INK}, for the one or two surfaces that are meant to be the only
 * lit thing on screen.
 *
 * 45% is the house default because most dialogs sit ON the island and the island is still part of
 * what the player is doing — dimming it further would read as the game being switched off. A
 * once-a-day reward panel is the exception: nothing behind it is actionable while it is up, and the
 * contrast between a darkened world and a bright cream panel is what makes it feel like a moment
 * rather than another form. Kept as a named constant rather than a literal at the call site so
 * "which surfaces go deep" stays a question with a listed answer.
 */
export const SCRIM_INK_DEEP = 'bg-island-navy/72';

/**
 * Neutral dark, for the surfaces that must not be tinted.
 *
 * The same colour the 稀有度揭曉's own dim is built from (index.css), so a purchase that ends
 * in a reveal darkens further into the ground it was already on instead of crossing from a
 * blue one to a black one halfway through.
 */
export const SCRIM_NEUTRAL = 'bg-[#0C090F]/45';

/**
 * Bottom clearance for a dialog that opens over the island, where the NavBar's dock plank owns the
 * bottom ~190px of the viewport (UI/NavBar.tsx, positioned by HudFrame's `bottom-center` region).
 *
 * {@link ModalOverlay} centres its child inside its own content box, so reserving the dock's band as
 * padding-bottom centres the panel in the part of the screen the player can actually see rather than
 * over the four nav tags. Measured, not guessed: a 382px-tall panel and the dock overlap by 19px at
 * 1280x720 and clear each other by only 5px at 1366x768 — the two laptop sizes this is most often
 * played at — while at 1920x1080 there was never a problem, which is why this is a fixed reserve and
 * not a shift: it is the dock's height, so it costs the tall viewports nothing they were using.
 *
 * Padding rather than a transform on the shell, so a panel taller than the remaining space still
 * sits inside the overlay instead of being pushed off the top edge where it cannot be read.
 */
export const MODAL_ABOVE_DOCK = 'pb-44 md:pb-48';

export function ModalOverlay({
  children,
  onClick,
  className = '',
  zIndexClassName = 'z-modal', // see index.css's Layer system - this IS the shared Modal tier
  scrimClassName = SCRIM_INK,
  style,
}: {
  /** Optional — omit to use this as a standalone dismiss-on-click scrim
      (e.g. AccountPanel, which renders its own anchored panel as a sibling
      instead of a centered child). */
  children?: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  zIndexClassName?: string;
  /**
   * The scrim, for the few surfaces that cannot use the ink one. Defaults to {@link SCRIM_INK},
   * so every modal that does not ask is unchanged.
   *
   * It is a prop rather than something a caller overrides through `className` because it cannot
   * be overridden that way: a Tailwind background utility passed in `className` lands in the same
   * cascade layer as this one and the winner is decided by source order in the generated
   * stylesheet, not by which was written last here. Whatever is going to paint has to be the only
   * background class on the element.
   */
  scrimClassName?: string;
  /**
   * Inline style for the overlay element itself. There is deliberately no visual reason to
   * reach for this — the scrim, the z-tier and the centring are all props or tokens above.
   * It exists for CUSTOM PROPERTIES a caller needs its own children to inherit: RarityReveal
   * measures where its item lands and publishes `--reveal-focus` here, because the layers that
   * read it are siblings of the thing being measured and this is their nearest shared element.
   */
  style?: React.CSSProperties;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClick}
      style={style}
      className={`absolute inset-0 ${zIndexClassName} ${scrimClassName} flex items-center justify-center p-4 md:p-8 ${className}`}
    >
      {children}
    </motion.div>
  );
}

export function ModalShell({
  children,
  className = '',
  maxWidthClassName = 'max-w-2xl',
  ...motionProps
}: {
  children: React.ReactNode;
  className?: string;
  maxWidthClassName?: string;
} & HTMLMotionProps<'div'>) {
  return (
    <motion.div
      initial={{ scale: 0.95, y: 16, opacity: 0 }}
      animate={{ scale: 1, y: 0, opacity: 1 }}
      exit={{ scale: 0.95, y: 16, opacity: 0 }}
      onClick={(e) => e.stopPropagation()}
      className={`bg-island-cream rounded-[2rem] w-full ${maxWidthClassName} overflow-hidden flex flex-col shadow-[0_24px_60px_rgba(38,70,83,0.25)] border border-island-line pointer-events-auto ${className}`}
      {...motionProps}
    >
      {children}
    </motion.div>
  );
}

export function PanelHeader({
  icon,
  title,
  subtitle,
  onClose,
  className = '',
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <div className={`px-6 py-5 md:px-8 md:py-6 border-b border-island-line bg-island-cream-2 flex items-center justify-between gap-4 flex-shrink-0 ${className}`}>
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <div className="w-11 h-11 md:w-12 md:h-12 rounded-2xl bg-island-teal text-white flex items-center justify-center flex-shrink-0 shadow-[0_4px_10px_rgba(42,157,143,0.3)]">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-lg md:text-xl font-black text-island-navy tracking-tight truncate">{title}</h3>
          {subtitle && <p className="text-island-navy-soft/70 text-xs font-bold truncate mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-xl bg-white border border-island-line hover:border-island-coral hover:text-island-coral text-island-navy-soft flex items-center justify-center transition-all active:scale-90 flex-shrink-0"
        >
          <X size={18} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

// --- Buttons -----------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const buttonVariantClass: Record<ButtonVariant, string> = {
  primary: 'bg-island-teal hover:bg-island-teal-dark text-white shadow-[0_8px_20px_rgba(42,157,143,0.3)] border border-transparent',
  secondary: 'bg-white hover:bg-island-cream-2 text-island-navy border border-island-line',
  danger: 'bg-island-coral/12 hover:bg-island-coral/20 text-island-coral border border-island-coral/25',
  ghost: 'bg-island-cream-2 hover:bg-island-line/60 text-island-navy-soft border border-transparent',
};

export function Button({
  variant = 'primary',
  disabled,
  className = '',
  children,
  ...props
}: {
  variant?: ButtonVariant;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      disabled={disabled}
      className={`rounded-2xl font-black transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none disabled:hover:-translate-y-0 hover:-translate-y-0.5 ${buttonVariantClass[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

// --- Icon tile -----------------------------------------------------------

// Border/bg tint when `active` — a lighter-touch version of `accentClass`
// below (solid border instead of a soft one, no forced text color, since an
// IconTile's icon usually sets its own color via children/className).
// Reused across every "icon in a rounded box" use in the app instead of
// each caller hand-rolling its own border/bg pairing per accent color
// (AccountPanel's quick actions, DressingRoomView's equip row,
// BuildModeOverlay's coral "shrink" tile).
const iconTileAccentActiveClass: Record<AccentColor, string> = {
  teal: 'bg-island-teal/8 border-island-teal',
  gold: 'bg-island-gold/8 border-island-gold',
  coral: 'bg-island-coral/8 border-island-coral',
  navy: 'bg-island-navy/8 border-island-navy',
};

// `solid` — the accent at full strength with white ink, for a tile that has to
// carry a card on its own rather than sit quietly beside a label. The two
// tinted states above are only a few percent off a cream surface, which is
// fine on a white panel but disappears on a card that is itself cream (see
// BuildingInteriorView's build dock, where the tiles were invisible).
// This sets `text-white`, so a caller must not also pass an ink colour in
// `className` — the two would silently fight (no tailwind-merge here).
const iconTileAccentSolidClass: Record<AccentColor, string> = {
  teal: 'bg-island-teal border-island-teal-dark/45 text-white',
  gold: 'bg-island-gold border-island-gold/60 text-white',
  coral: 'bg-island-coral border-island-coral/60 text-white',
  navy: 'bg-island-navy border-island-navy-dark/60 text-white',
};

export function IconTile({
  children,
  size = 64,
  active = false,
  solid = false,
  accent = 'teal',
  className = '',
}: {
  children: React.ReactNode;
  size?: number;
  active?: boolean;
  /** Fill with the accent colour at full strength (white ink). Wins over `active`. */
  solid?: boolean;
  accent?: AccentColor;
  className?: string;
}) {
  return (
    <div
      style={{ width: size, height: size }}
      className={`rounded-2xl flex items-center justify-center flex-shrink-0 relative overflow-hidden border transition-colors ${
        solid
          ? iconTileAccentSolidClass[accent]
          : active
            ? iconTileAccentActiveClass[accent]
            : 'bg-island-cream-2 border-island-line'
      } ${className}`}
    >
      <div className="absolute top-1 left-1.5 w-3 h-1.5 bg-white/60 rounded-full rotate-[-15deg] pointer-events-none" />
      {children}
    </div>
  );
}

// --- Currency chip -----------------------------------------------------------

/**
 * How each currency is drawn, so 金幣 and 碎片 are told apart by SHAPE and MARK, not only by hue.
 *
 * §22 of the 碎片 brief is 「不要讓玩家誤以為兩者是同一種資源」, and a second gold-coloured pill
 * with a different number in it is exactly that mistake. Three things differ at once:
 *
 *  - **The mark.** A struck coin (`Coins`) versus a cut shard (`Gem`). Readable at 13px, which is
 *    the size this actually renders at.
 *  - **The colour.** `island-gold` is documented as CURRENCY-ONLY and belongs to 金幣 (see
 *    DESIGN_SYSTEM.md); 碎片 take `island-teal`, which is the app's other structural accent.
 *  - **The label, for assistive tech.** The chip is a number and a glyph, which a screen reader
 *    renders as a bare number; `aria-label` is where 「金幣」/「碎片」 is actually said.
 *
 * Note what does NOT differ: the pill's size, radius, weight and padding. They are the same object
 * in two materials, which is what makes them read as two members of one set rather than as two
 * unrelated widgets — the 「change the construction, not the colour」 rule applied in reverse,
 * because here the construction genuinely is the same and only the substance differs.
 *
 * Teal doubles as 「已選取」 elsewhere in the app. That is tolerable here and nowhere else: a chip
 * showing a balance is never a selectable control, so there is no state for it to be confused with.
 */
const CURRENCY_CHIP_STYLE = {
  coins: {
    label: '金幣',
    Icon: Coins,
    className: 'bg-island-gold/12 border-island-gold/35',
    iconClass: 'text-island-gold',
  },
  fragments: {
    label: '碎片',
    Icon: Gem,
    className: 'bg-island-teal/12 border-island-teal/35',
    iconClass: 'text-island-teal-dark',
  },
} as const;

export type CurrencyChipKind = keyof typeof CURRENCY_CHIP_STYLE;

export function CurrencyChip({
  amount,
  currency = 'coins',
  className = '',
}: {
  amount: number | string;
  /** Defaults to 金幣, which is what every existing call site meant. */
  currency?: CurrencyChipKind;
  className?: string;
}) {
  const style = CURRENCY_CHIP_STYLE[currency];
  const { Icon } = style;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-island-navy font-black text-xs ${style.className} ${className}`}
      aria-label={`${style.label} ${amount}`}
    >
      <Icon size={13} className={style.iconClass} strokeWidth={2.5} aria-hidden="true" />
      <span>{typeof amount === 'number' ? amount.toLocaleString() : amount}</span>
    </span>
  );
}

/**
 * Both balances side by side — the HUD's 錢包, and the one place a player sees them together.
 *
 * Shown as a pair rather than as one chip that switches, because 「兩者是不同資源」 is only
 * learnable if they are visible at the same time. A player who sees only 金幣 on the island and
 * only 碎片 in the login panel has no reason to believe they are not the same number in two places.
 */
export function WalletChips({
  coins,
  fragments,
  className = '',
}: {
  coins: number;
  fragments: number;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <CurrencyChip amount={coins} currency="coins" />
      <CurrencyChip amount={fragments} currency="fragments" />
    </span>
  );
}

// --- Signpost tag ("Dock & Signpost" HUD motif) ----------------------------

// A hanging plank/arrow sign instead of a plain pill or rounded-square
// button. `hang` chamfers the top corners (NavBar tabs, mounted on the
// bottom dock plank); `arrow` points right (SideButtons, mounted on the
// signpost pole via .signpost-post). Border-radius intentionally omitted —
// clip-path defines the whole silhouette.
type SignpostShape = 'hang' | 'arrow';

const signpostClipPath: Record<SignpostShape, string> = {
  hang: 'polygon(6% 0, 94% 0, 100% 30%, 100% 100%, 0 100%, 0 30%)',
  arrow: 'polygon(0 12%, 68% 12%, 68% 0, 100% 50%, 68% 100%, 68% 88%, 0 88%)',
};

export function SignpostTag({
  active = false,
  shape = 'hang',
  dropped = false,
  onClick,
  children,
  className = '',
  title,
  id,
}: {
  active?: boolean;
  shape?: SignpostShape;
  /** NavBar-only: the active tab hangs lower, like it's the sign currently flipped out. */
  dropped?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  title?: string;
  id?: string;
}) {
  // `relative` is only needed to anchor the "hang" shape's dot indicator
  // (an `absolute` span, below) — `arrow`-shaped tags (SideButtons) render
  // no such decoration, so forcing `relative` on them too would fight a
  // caller that needs to set its own `position` via `className`, the same
  // silent-conflict hazard `HintBubble` had. See DESIGN_SYSTEM.md.
  //
  // The active tag's shadow is a `.notch-shadow-teal` filter on the wrapper,
  // NOT a `shadow-[...]` on the button: this button clips itself to the
  // signpost silhouette, and a clip-path clips the element's own box-shadow
  // out of existence (see the .dock-notch note in index.css). The wrapper is
  // what makes the shadow trace the arrow point / chamfered plank instead of
  // being deleted.
  const tag = (
    <button
      id={id}
      onClick={onClick}
      title={title}
      style={{ clipPath: signpostClipPath[shape] }}
      className={`${shape === 'hang' ? 'relative ' : ''}flex transition-all duration-300 active:scale-95 ${
        dropped ? 'translate-y-1.5' : ''
      } ${
        active
          ? 'bg-island-teal text-white'
          : 'bg-island-cream text-island-navy-soft border border-island-line hover:text-island-navy hover:bg-island-cream-2'
      } ${className}`}
    >
      {shape === 'hang' && (
        <span
          className={`absolute top-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full pointer-events-none ${
            active ? 'bg-white/70' : 'bg-island-line'
          }`}
        />
      )}
      {children}
    </button>
  );

  // `inline-flex` shrink-wraps the button, so the wrapper takes exactly the
  // tag's own size and a SignpostTag stays a drop-in flex/grid child (NavBar's
  // row, SideButtons' column) — all sizing still comes from `className` on the
  // button itself. It has to be a real box: `display: contents` generates no
  // box, and a filter with no box to render into simply does nothing.
  return (
    <span className={`inline-flex${active ? ' notch-shadow-teal' : ''}`}>{tag}</span>
  );
}

// --- Porthole frame ("Dock & Signpost" HUD motif) ---------------------------

// Circular window-bezel wrapper (see .porthole-ring in index.css) with four
// bolt dots, used for instrument-style HUD pieces: MiniMap, ZoomControl,
// avatar portraits.
export function PortholeFrame({
  size = 64,
  bolts = true,
  children,
  className = '',
}: {
  /**
   * A number of px, or any CSS length — including a token, e.g.
   * `size="var(--hud-avatar)"`. The token form is what lets a caller be sized
   * by the responsive HUD scale (index.css) instead of hardcoding one number
   * per breakpoint in JS; the bolt ring below follows it through `calc()`.
   */
  size?: number | string;
  bolts?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const radius = typeof size === 'number' ? `${size / 2 - 4}px` : `calc(${size} / 2 - 4px)`;
  // `relative` is only needed to anchor the bolt dots (`absolute` spans,
  // below), which are themselves conditional on `bolts`. Forcing it when
  // `bolts={false}` would fight a caller's own `position` — same hazard as
  // HintBubble/SignpostTag. See DESIGN_SYSTEM.md.
  return (
    <div
      style={{ width: size, height: size }}
      className={`${bolts ? 'relative ' : ''}rounded-full porthole-ring bg-island-cream flex items-center justify-center overflow-hidden flex-shrink-0 ${className}`}
    >
      {children}
      {bolts &&
        [0, 90, 180, 270].map((deg) => (
          <span
            key={deg}
            className="absolute w-1.5 h-1.5 rounded-full bg-island-line/80 pointer-events-none"
            style={{
              top: '50%',
              left: '50%',
              transform: `translate(-50%, -50%) rotate(${deg}deg) translate(0, calc(${radius} * -1))`,
            }}
          />
        ))}
    </div>
  );
}

// --- Toolbar ("Build Mode"-style HUD action row) ---------------------------

// A single row that can hold both a grouped tab switcher (pill of
// `SignpostTag`s sharing one selection surface) and standalone action
// buttons (a plain `Button` per item — exit/confirm/delete/etc.), driven
// entirely by an `items` array instead of each caller hand-placing its own
// JSX per button. Adding, removing or reordering a tool is then just an
// edit to that array — never a new `absolute`/hardcoded-offset element next
// to it. First consumer: BuildModeOverlay's 領土/建築 tab switcher + "退出
// 編輯" exit action, which used to be two independently-positioned pieces
// (the exit button was `absolute top-4 right-4`, in the opposite screen
// corner from the tab switcher it operates alongside).
export type ToolbarItem = {
  id: string;
  icon?: React.ReactNode;
  label: React.ReactNode;
  onClick?: () => void;
  /** 'tab' (default) renders into the shared pill as a `SignpostTag`,
      sharing one selection surface with the other tabs. 'action' renders as
      its own standalone `Button`, visually separated from the tab pill —
      for a mode-level action like exit/confirm that isn't a selectable tab. */
  kind?: 'tab' | 'action';
  active?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
  title?: string;
};

// Mode chrome — a carved track with raised keys.
//
// Two earlier passes were rejected and both are worth recording, because the
// second failure is the less obvious one:
//   1. A navy shell. Premium was mistaken for heavy; it read gloomy over the
//      bright island scene.
//   2. A flat ivory bar with a flat teal pill. Bright, but it had drifted back
//      to looking like the plain white bar it replaced — different values, same
//      construction, so at a glance nothing had changed.
//
// So this pass changes the CONSTRUCTION rather than the colours. The track is
// pressed INTO the surface (inset shadow, sand-toned, with a light hairline on
// its lower lip where a real groove would catch light) and the selected tab
// sits PROUD of it (outset shadow + a lit top edge). Everything reads as one
// machined switch: a groove with a key riding in it. The exit button is another
// key on the same surface, so the row is a matched set.
//
// Physical presses, not scaling: keys move DOWN by a pixel and lose their
// shadow (`active:translate-y-px`), which is what a key does. `active:scale-95`
// is the system default for flat buttons and would fight the metaphor here.
//
// Palette unchanged — sand / cream / navy / teal, no new hues, and no gold
// (that token stays currency-only however "premium" a brief sounds).

/** The groove: pressed in, with a lit lower lip. Plus a soft float off the panel. */
const TOOLBAR_TRACK_SHADOW =
  'shadow-[inset_0_2px_5px_rgba(38,70,83,0.17),inset_0_-1px_0_rgba(255,255,255,0.8),0_14px_32px_-16px_rgba(38,70,83,0.4)]';

/** A key sitting proud of the groove: tight contact shadow, soft drop, lit top edge. */
const TOOLBAR_KEY_SHADOW =
  'shadow-[0_1px_2px_rgba(38,70,83,0.16),0_4px_10px_-2px_rgba(38,70,83,0.28),inset_0_1px_0_rgba(255,255,255,0.9)]';

// Exactly one `shadow-*` per variant: this project has no tailwind-merge, so a
// shared base shadow plus a per-variant one would be two rules on the same
// property and whichever the compiled stylesheet emitted last would win.
const toolbarActionClass: Record<ButtonVariant, string> = {
  primary: 'bg-island-teal text-white border-island-teal-dark/40 hover:bg-island-teal-dark shadow-[0_1px_2px_rgba(31,122,112,0.4),0_4px_10px_-2px_rgba(42,157,143,0.55),inset_0_1px_0_rgba(255,255,255,0.32)]',
  // The default for a mode-level action (BuildModeOverlay's 退出編輯): another
  // key on the same surface as the tab track's — same radius, same height, same
  // raised profile — so the row reads as one instrument, not a bar plus a
  // stray button.
  secondary: `bg-island-cream text-island-navy border-island-line hover:bg-white hover:border-island-teal-light ${TOOLBAR_KEY_SHADOW}`,
  danger: 'bg-island-coral/12 text-island-coral border-island-coral/30 hover:bg-island-coral/20 shadow-[0_1px_2px_rgba(232,131,106,0.22),0_4px_10px_-2px_rgba(232,131,106,0.32),inset_0_1px_0_rgba(255,255,255,0.85)]',
  ghost: 'bg-island-sand text-island-navy-soft border-island-line hover:bg-island-cream hover:text-island-navy shadow-[0_1px_2px_rgba(38,70,83,0.12),0_4px_10px_-2px_rgba(38,70,83,0.2),inset_0_1px_0_rgba(255,255,255,0.8)]',
};

export function Toolbar({
  items,
  className = '',
}: {
  items: ToolbarItem[];
  className?: string;
}) {
  const tabs = items.filter((item) => (item.kind ?? 'tab') === 'tab');
  const actions = items.filter((item) => item.kind === 'action');
  // Scoped so two Toolbars on screen at once could never share — and therefore
  // fight over — the same sliding indicator.
  const indicatorId = `toolbar-active-${React.useId()}`;

  return (
    <div className={`flex flex-wrap items-center justify-center gap-2 sm:gap-3 ${className}`}>
      {tabs.length > 0 && (
        // The groove. Sand-toned and pressed in, so the keys below have
        // something to sit in; also darker than the white panel underneath, so
        // the bar keeps an edge of its own instead of merging with it.
        <div className={`relative flex gap-1 rounded-full border border-island-line bg-island-sand p-1.5 pointer-events-auto ${TOOLBAR_TRACK_SHADOW}`}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={tab.onClick}
              title={tab.title}
              className={`relative flex items-center gap-2 rounded-full px-4 py-2.5 sm:px-6 sm:py-3 text-xs sm:text-sm font-black tracking-[0.06em] whitespace-nowrap transition-colors duration-300 active:translate-y-px ${
                tab.active ? 'text-white' : 'text-island-navy-soft/70 hover:text-island-navy'
              }`}
            >
              {/* One key shared by every tab via `layoutId`, so selecting a tab
                  SLIDES it along the groove rather than snapping one button on
                  and another off. That continuity is most of what separates a
                  considered control from a set of toggles. */}
              {tab.active && (
                <motion.span
                  layoutId={indicatorId}
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  className={`absolute inset-0 rounded-full bg-island-teal ${TOOLBAR_KEY_SHADOW}`}
                />
              )}
              {/* Above the indicator, which is absolutely positioned behind. */}
              <span className="relative flex items-center gap-2">
                {tab.icon}
                {tab.label}
              </span>
            </button>
          ))}
        </div>
      )}
      {actions.map((action) => (
        <button
          key={action.id}
          disabled={action.disabled}
          onClick={action.onClick}
          title={action.title}
          // Height matches the tab shell exactly (p-1.5 + the tab's own box) so
          // the row sits on one line rather than two elements of similar size.
          // Lifts on hover and presses DOWN on click, like the tab keys —
          // deliberately not the system's default `active:scale-95`, which
          // would read as a flat button shrinking rather than a key travelling.
          className={`pointer-events-auto flex h-12 sm:h-14 items-center justify-center gap-2 rounded-full border px-5 sm:px-7 font-black tracking-[0.06em] transition-all duration-300 hover:-translate-y-0.5 active:translate-y-px disabled:opacity-40 disabled:pointer-events-none ${toolbarActionClass[action.variant ?? 'secondary']}`}
        >
          <span className="text-xs sm:text-sm whitespace-nowrap">{action.label}</span>
          {action.icon}
        </button>
      ))}
    </div>
  );
}

// --- Bottom dock ("Dock & Signpost" HUD motif) -----------------------------

// The shared shell for the bottom-of-screen control bar a mode puts up while
// it owns the screen: BuildingInteriorView's build toolbar (家具 / 房間擴建),
// its furniture-placement controls, and its room-expansion
// controls. Those were three independently hand-rolled bars — a flat cream
// pill at `rounded-[3rem]`, a `bg-white/85 backdrop-blur-xl` glass card with a
// white inset ring (against the color rules in DESIGN_SYSTEM.md), and a third
// with its own bottom offset — so moving between sub-flows visibly changed
// the furniture of the screen. One shell: one radius, one shadow, one
// bottom offset, all on island-* tokens.
//
// Positioning is part of the component rather than something each caller
// passes, for two reasons: all three docks are the same bottom-centre
// floating panel, and this project has no tailwind-merge, so a hardcoded
// `relative` here plus a caller's `absolute` would be a silent conflict (see
// DESIGN_SYSTEM.md). Owning `absolute` outright also gives the lit rail below
// the positioned ancestor it needs.
//
// That rail along the top edge is what makes the bar read as a physical dock
// plank instead of a floating rounded rectangle. It's a child, not a border,
// so it can fade out at both ends.
//
// Every dock is also an obstacle for the 小天使 (ANGEL_AVOID, AngelGuide.tsx):
// she narrates these bars from the sky above them, and a dock that grew tall
// enough to reach her used to end up underneath her. Marked here once rather
// than at each call site, so a fourth dock inherits it.
export function DockPanel({
  children,
  className = '',
  ...motionProps
}: {
  children: React.ReactNode;
  className?: string;
} & HTMLMotionProps<'div'>) {
  return (
    <motion.div
      {...ANGEL_AVOID}
      className={`absolute bottom-4 sm:bottom-10 left-1/2 -translate-x-1/2 z-floating-panel bg-island-cream rounded-[2rem] border border-island-line shadow-[0_22px_50px_-14px_rgba(38,70,83,0.5),0_1px_0_rgba(255,255,255,0.9)_inset] ${className}`}
      {...motionProps}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-island-teal/60 to-transparent sm:inset-x-16"
      />
      {children}
    </motion.div>
  );
}

// A dock's leading "what am I doing right now" label — an eyebrow pill naming
// the live sub-flow plus the subject it applies to. Shared by the placement
// dock (the furniture being positioned) and the expansion dock (the room
// being built), which previously wrote the same two-line block two different
// ways.
export function DockStatus({
  badge,
  badgeIcon,
  title,
  meta,
  className = '',
}: {
  badge: React.ReactNode;
  badgeIcon?: React.ReactNode;
  title: React.ReactNode;
  /** Optional trailing chip, e.g. the live grid coordinates. */
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-island-teal/25 bg-island-teal/10 px-2.5 py-1 text-[10px] font-black tracking-[0.14em] text-island-teal-dark">
          {badgeIcon}
          {badge}
        </span>
        {meta}
      </div>
      <div className="mt-1.5 truncate text-sm font-black tracking-tight text-island-navy sm:text-base">
        {title}
      </div>
    </div>
  );
}

// --- Toggle -----------------------------------------------------------

// iOS-style switch. Was previously hand-rolled once in SettingsView.tsx
// (mute) and duplicated for the AI-voice-guide toggle; centralizing it here
// so any future on/off setting doesn't re-hand-roll the thumb/track math.
export function Toggle({
  checked,
  onChange,
  disabled = false,
  className = '',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-colors duration-300 flex-shrink-0 disabled:opacity-40 disabled:pointer-events-none cursor-pointer ${
        checked ? 'bg-island-teal' : 'bg-island-line'
      } ${className}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300 ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

// --- Slider -----------------------------------------------------------

// Volume-style range slider. Was previously hand-rolled twice in
// SettingsView.tsx (BGM volume, ambience volume) with near-identical
// icon-tile + label + percent-readout + <input type="range"> markup;
// centralizing it here the same way Toggle was, so a future settings
// category (e.g. Controls sensitivity) doesn't re-hand-roll the same
// row shape a third time.
//
// DRAGGING — 「音量條可以點選,但無法拖曳」.
//
// Read this before "simplifying" any of it: a synthetic mouse drag in headless Chromium moved
// this control fine BEFORE any of the changes below, so the report is not reproducible with a
// plain mouse on that engine and none of this is a fix for a bug anybody has seen fail in a
// script. What it does is remove the two properties the control actually had that make a drag
// fail for a real pointer on a real machine, either of which produces exactly "a click works and
// a drag does nothing":
//
//  1. THE CONTROL WAS 4 PIXELS TALL. It was styled `h-1`, so its border box was the track. The
//     thumb the player aims at is four times that and was only reachable because Chromium happens
//     to hit-test the overflow — a browser that clips it instead leaves nothing to grab. The
//     `range-slider` class (index.css) gives the element a touch-sized body and draws the thin
//     track inside it, so the visible thumb and the grabbable thumb are the same object.
//  2. `touch-action` WAS LEFT AT ITS DEFAULT. On a touchscreen or a precision trackpad, the first
//     vertical component of a drag over a 4px control inside a scrollable settings panel is
//     claimed by the panel as a scroll, and the pointer is cancelled out from under the slider.
//     The player presses, moves, and the value never changes. `touch-action: none` on the control
//     is what makes the gesture the slider's.
//
// The value echo below is a third thing, and it is hardening rather than a fix: a
// `<input type="range" value={…}>` is a CONTROLLED input, so if its owner's state does not move
// before React's next render the DOM value is restored from the prop and the thumb jumps back.
// Today's owner (AppContext.updateSettings) applies locally first and cannot do that — but a
// slider that only works when its owner happens to be synchronous is a trap for the next screen
// that reuses it. While a gesture is in progress the input renders the value the POINTER last put
// there and reports it upward; the prop takes over the moment the gesture ends, so an owner that
// clamps or rejects a value still gets the last word.
export function Slider({
  value,
  onChange,
  icon,
  label,
  min = 0,
  max = 1,
  step = 0.01,
  formatValue = (v) => `${Math.round(v * 100)}%`,
  className = '',
}: {
  value: number;
  onChange: (next: number) => void;
  icon?: React.ReactNode;
  label?: React.ReactNode;
  min?: number;
  max?: number;
  step?: number;
  /** How to render the value readout next to the label. Defaults to a 0-1 percent. */
  formatValue?: (value: number) => string;
  className?: string;
}) {
  // The live gesture value, or null when no gesture is in progress and the prop is the truth.
  const [dragValue, setDragValue] = React.useState<number | null>(null);
  const shown = dragValue ?? value;
  const endDrag = () => setDragValue(null);

  return (
    <div className={`flex items-center gap-4 ${className}`}>
      {icon && (
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center bg-white border border-island-line text-island-navy-soft flex-shrink-0">
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        {label && (
          <div className="flex items-center justify-between text-[10px] font-black text-island-navy-soft uppercase tracking-widest mb-1.5">
            <span>{label}</span>
            {/* The gesture's own value, so the readout moves with the thumb rather than with
                whatever the owner has managed to store so far. */}
            <span className="font-mono text-island-teal">{formatValue(shown)}</span>
          </div>
        )}
        {/* `range-slider` (index.css) is what gives this a body-sized pointer target. The visible
            track stays 4px, but the ELEMENT used to be 4px too — and a range input hit-tests
            against its own box, so grabbing the thumb meant hitting a 4-pixel strip. */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={shown}
          onChange={(e) => {
            const next = parseFloat(e.target.value);
            setDragValue(next);
            onChange(next);
          }}
          // Every way a gesture can end, including the ones the browser ends for us. Missing one
          // would leave the echo latched and the slider ignoring its own prop from then on.
          onPointerDown={(e) => setDragValue(parseFloat((e.currentTarget as HTMLInputElement).value))}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onBlur={endDrag}
          onKeyUp={endDrag}
          className="range-slider w-full bg-island-line rounded-lg appearance-none cursor-pointer accent-island-teal"
        />
      </div>
    </div>
  );
}

// --- Stat tile -----------------------------------------------------------

// icon + label + big value card, replacing the near-identical
// `bg-gray-50 rounded-[2rem] border-black/5` tiles hand-rolled separately in
// FitnessView (result stats) and TrackerView (3 stat cards).
export type AccentColor = 'teal' | 'gold' | 'coral' | 'navy';

// Shared teal/gold/coral/navy tint map — reuse this instead of maintaining a
// second copy per component (e.g. an accent badge/tile elsewhere in the UI).
export const accentClass: Record<AccentColor, string> = {
  teal: 'bg-island-teal/10 text-island-teal-dark border-island-teal/25',
  gold: 'bg-island-gold/12 text-island-gold border-island-gold/30',
  coral: 'bg-island-coral/12 text-island-coral border-island-coral/25',
  navy: 'bg-island-navy/8 text-island-navy border-island-navy/20',
};

type StatTileAccent = AccentColor;
const statTileAccentClass = accentClass;

export function StatTile({
  icon,
  label,
  value,
  accent = 'teal',
  className = '',
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  accent?: StatTileAccent;
  className?: string;
}) {
  return (
    <div className={`bg-white rounded-[1.75rem] border border-island-line p-4 flex flex-col gap-2 ${className}`}>
      <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 ${statTileAccentClass[accent]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-black text-island-navy-soft/70 uppercase tracking-widest truncate">{label}</div>
        <div className="text-xl font-black text-island-navy font-mono truncate">{value}</div>
      </div>
    </div>
  );
}

// --- Empty state -----------------------------------------------------------

// One shared "nothing here yet" treatment (icon-in-circle + title +
// optional description/action) for empty inventories, empty lists, etc.
// Previously each screen (Shop, Dressing Room, Tracker...) hand-rolled its
// own version with slightly different icon sizing/border/copy styling.
export function EmptyState({
  icon,
  title,
  description,
  action,
  bordered = false,
  className = '',
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  bordered?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-16 px-6 ${
        bordered ? 'bg-white rounded-[2rem] border-2 border-dashed border-island-line' : ''
      } ${className}`}
    >
      <div className="w-16 h-16 rounded-full bg-island-cream-2 border border-island-line flex items-center justify-center text-island-navy-soft/40 mb-4">
        {icon}
      </div>
      <p className="font-black text-island-navy text-sm">{title}</p>
      {description && <p className="text-island-navy-soft/70 text-xs mt-1.5 max-w-xs leading-relaxed">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// --- Key cap -----------------------------------------------------------

// The physical-key glyph for a keyboard shortcut, e.g. the R next to a 旋轉
// button. A shortcut the UI doesn't show is a shortcut nobody finds, so any
// control that also has a key gets one of these beside it rather than hiding
// the key in a `title` tooltip. `size="sm"` is the inline-in-a-caption form
// (small buttons), the default is the standalone chip.
export function KeyCap({
  children,
  size = 'md',
  className = '',
}: {
  children: React.ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <kbd
      className={`inline-flex items-center justify-center rounded-md border border-island-line bg-island-cream-2 align-middle font-mono text-island-navy ${
        size === 'sm'
          ? 'h-4 min-w-[16px] px-1 text-[9px]'
          : 'h-5 min-w-[20px] px-1.5 text-[10px] shadow-[0_2px_6px_rgba(38,70,83,0.12)]'
      } ${className}`}
    >
      {children}
    </kbd>
  );
}

// --- Hint bubble -----------------------------------------------------------

// Replaces 5 independently hand-rolled "explain this UI element" bubbles
// that used to each pick their own shape/nub/background (ControlsHint,
// InteractionPrompt, the island placement banner, SideButtons' hover tooltip
// + mobile caption). This is presentational only — no motion/positioning baked in,
// since each caller anchors itself differently (fixed corner, RAF-tracked
// world position, absolute-from-parent hover). Wrap it in your own
// motion.div/button for animation/interactivity, same as before.
type HintNub = 'dot' | 'arrow' | 'none';
type HintVariant = 'floating' | 'solid';

// Surface (fill/border/ink) and shadow are kept apart because `notch` below
// has to put them on two different elements: the clipped surface can't carry
// its own shadow (a clip-path clips the box-shadow away — see index.css), so
// the shadow moves to the wrapper as a drop-shadow filter.
const hintVariantSurface: Record<HintVariant, string> = {
  // The default: a small cream card sitting near its subject (WASD hint,
  // interaction badge, placement banner).
  floating: 'bg-island-cream border border-island-line text-island-navy-soft',
  // A solid navy pill for hover-only labels (SideButtons desktop tooltip).
  solid: 'bg-island-navy text-white',
};

const hintVariantShadow: Record<HintVariant, string> = {
  floating: 'shadow-[0_6px_20px_rgba(38,70,83,0.18)]',
  solid: 'shadow-[0_6px_20px_rgba(38,70,83,0.3)]',
};

// Filter equivalents of the two shadows above, for the `notch` case.
const hintVariantNotchShadow: Record<HintVariant, string> = {
  floating: 'notch-shadow',
  solid: 'notch-shadow-lg',
};

export function HintBubble({
  children,
  nub = 'none',
  variant = 'floating',
  notch = false,
  className = '',
}: {
  children: React.ReactNode;
  /** 'dot': small round nub centered on top, the bubble sits above its
      subject. 'arrow': rotated-square nub centered below, the bubble points
      down at its anchor. 'none': plain banner/pill, no nub. */
  nub?: HintNub;
  variant?: HintVariant;
  /** Ticket-stub chamfered corner (`.dock-notch`). Use this instead of passing
      `dock-notch` in `className`: the clip has to land on an inner surface, or
      it eats the nub and the shadow (see below). */
  notch?: boolean;
  className?: string;
}) {
  // `relative` is only applied when a nub is actually rendered — it exists
  // solely to give the nub's `absolute` decoration a positioning anchor.
  // Forcing it unconditionally used to fight callers that need to set their
  // own `position` via `className` (e.g. SideButtons' hover tooltip, which
  // needs `absolute` to escape its button's flex layout and has no nub) —
  // this project has no tailwind-merge/clsx, so two conflicting `position`
  // utilities landing on the same element is a real, silent bug, not just
  // redundant classes. See DESIGN_SYSTEM.md.
  const nubs = (
    <>
      {nub === 'dot' && (
        <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-island-line pointer-events-none" />
      )}
      {nub === 'arrow' && (
        <span className="absolute left-1/2 -bottom-[6px] -translate-x-1/2 w-3 h-3 bg-white border-b border-r border-island-line rotate-45 pointer-events-none" />
      )}
    </>
  );

  // NOTCHED: the clip goes on an inner surface, never on the box that owns the
  // nubs and the shadow. `clip-path` clips an element's ENTIRE painted subtree,
  // so a notch applied to the outer box would delete both the box-shadow and
  // the nub — the nubs sit outside the border box by design (`-top-1.5`,
  // `-bottom-[6px]`), so they are the first thing a clip removes. ControlsHint
  // hit exactly this: it passed `dock-notch` through `className` and its dot
  // nub silently never rendered. The shadow becomes a drop-shadow filter here,
  // which is the only kind that survives (and traces) a clip.
  if (notch) {
    // The wrapper carries ONLY position + shadow; every class the caller passed
    // stays on the surface, which is the element that actually is the card
    // (padding, radius, flex layout, type). `inline-block` keeps the wrapper
    // shrink-to-fit, so a notched bubble still sizes to its content exactly
    // like a plain one rather than stretching to its parent's width.
    return (
      <div className={`relative inline-block ${hintVariantNotchShadow[variant]}`}>
        <div className={`dock-notch font-black ${hintVariantSurface[variant]} ${className}`}>
          {children}
        </div>
        {nubs}
      </div>
    );
  }

  return (
    <div
      className={`${nub !== 'none' ? 'relative ' : ''}font-black ${hintVariantSurface[variant]} ${hintVariantShadow[variant]} ${className}`}
    >
      {nubs}
      {children}
    </div>
  );
}

// --- Toast -----------------------------------------------------------------

// Generalizes WeatherToast's corner card — the one component that was
// already correctly on the documented z-toast tier — into a reusable shell
// so other short-lived notifications (e.g. PettingMiniGame's reward pill)
// share the same mechanism instead of each hand-rolling their own
// AnimatePresence/motion.div. `position="corner"` is the passive
// fixed-corner card; `position="inline"` is a solid pill meant to be placed
// by its own parent (no fixed positioning of its own), for reward-style
// pop-ups that float up from a specific spot on screen.
type ToastAccent = AccentColor;
type ToastPosition = 'corner' | 'inline';

const toastMotionByPosition: Record<ToastPosition, { initial: TargetAndTransition; animate: TargetAndTransition; exit: TargetAndTransition }> = {
  corner: {
    initial: { opacity: 0, y: -8, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -6, scale: 0.98 },
  },
  inline: {
    initial: { opacity: 0, scale: 0, y: -50 },
    animate: { opacity: 1, scale: 1, y: -100 },
    exit: { opacity: 0 },
  },
};

const toastSolidAccentClass: Record<ToastAccent, string> = {
  teal: 'bg-island-teal border-island-teal-dark/60',
  gold: 'bg-island-gold border-island-gold/60',
  coral: 'bg-island-coral border-island-coral/60',
  navy: 'bg-island-navy border-island-navy-soft/60',
};

export function Toast({
  visible,
  icon,
  children,
  accent = 'teal',
  position = 'corner',
  className = '',
}: {
  visible: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
  accent?: ToastAccent;
  position?: ToastPosition;
  className?: string;
}) {
  const anim = toastMotionByPosition[position];
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={anim.initial}
          animate={anim.animate}
          exit={anim.exit}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className={
            position === 'corner'
              ? `fixed top-2 right-2 md:top-4 md:right-4 z-toast flex items-center gap-2 px-3.5 py-2 bg-island-cream/95 backdrop-blur-md border border-island-line rounded-2xl shadow-[0_8px_20px_rgba(38,70,83,0.12)] pointer-events-none select-none ${className}`
              : `pointer-events-none text-white px-6 py-2 rounded-full font-black shadow-[0_10px_24px_rgba(38,70,83,0.25)] border flex items-center gap-2 ${toastSolidAccentClass[accent]} ${className}`
          }
        >
          {icon}
          {position === 'corner' ? (
            <span className="text-xs font-black text-island-navy tracking-wide whitespace-nowrap">{children}</span>
          ) : (
            children
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
