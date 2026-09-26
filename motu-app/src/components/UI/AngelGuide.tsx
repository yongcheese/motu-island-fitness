/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ChevronRight, Check } from 'lucide-react';
import confetti from 'canvas-confetti';
import { playSound, SoundEffect, triggerHaptic } from '../../lib/soundUtils';
import { markTutorialSeen, shouldShowTutorial } from '../../lib/tutorialReplay';
import { ANGEL_AVOID_SELECTOR } from '../../constants/angelAvoid';

/**
 * 小天使導覽 — a flying NPC that teaches a build-mode flow through 2-3 short
 * speech bubbles instead of a static instruction card parked at the bottom of
 * the screen.
 *
 * The design constraint that shapes everything here: a player who already knows
 * the flow must be able to get rid of it *instantly*. So there is no modal
 * scrim, no forced timer and no "read to the end" gate — the container is
 * pointer-events-none (the game underneath stays fully playable while the angel
 * is on screen), one tap anywhere on the bubble advances, and the 跳過 button
 * kills the whole sequence in a single click.
 */

export type AngelGuideStep = {
  /** Short line shown above the body copy, e.g. 「第一步」-ish framing. */
  title: string;
  /** The actual instruction. Keep it to one or two sentences per step. */
  body: string;
};

const SEEN_PREFIX = 'island.angelGuide.seen.';

/**
 * Whether a given guide should run right now: ship behaviour is once per
 * player, with the ?/說明 button as the way back in. 管理員測試模式
 * (hooks/useAdminMode.ts) overrides that — every 小天使 replays each time its
 * flow is entered while it's on, ignoring (and never writing) the per-player
 * "already seen" flag.
 *
 * Lives here, not in one of the callers, because the indoor guides
 * (BuildingInteriorView: 家具 / 房間擴建) and the outdoor ones
 * (BuildModeOverlay: 建造模式總覽 / 我的家 / 建築與裝飾 / 島上物件 / 領土規劃) are
 * one feature — a per-call-site copy of the admin override is a copy that can
 * be flipped in one place and forgotten in the other. Callers pass their own
 * `isAdminMode` (from `useAdminMode()`) since this module has no React context
 * of its own.
 *
 * WHEN to bank a topic as seen: both call sites do it the moment she is put on
 * screen, NOT when she is dismissed. Dismissal is only one of the ways she
 * leaves — every flow also retires her silently (the player walks out of build
 * mode, opens another tool, starts placing) — so banking on dismissal alone
 * meant a player who ignored her got the identical guide again on every visit.
 * Being shown the lesson is what counts as having had it; the 說明/? key is the
 * way back to one.
 */
export function shouldShowAngelGuide(id: string, isAdminMode: boolean): boolean {
  return shouldShowTutorial(SEEN_PREFIX + id, isAdminMode);
}

export function markAngelGuideSeen(id: string, isAdminMode: boolean): void {
  markTutorialSeen(SEEN_PREFIX + id, isAdminMode);
}

/**
 * Which view's chrome the guide has to stay clear of.
 *
 * The angel is always a top-of-screen presence — it narrates the docks along
 * the bottom, so it must never sit on them — but "the top" is not the same
 * shape in every view, so each host names the keep-out that matches its own
 * HUD instead of the component guessing.
 */
export type AngelGuidePlacement = 'interior' | 'island';

const PLACEMENT_KEEP_OUT: Record<AngelGuidePlacement, string> = {
  // BUILDING_INTERIOR. Keep-out for the two things that already own the
  // top-left there: BuildingInteriorView's header card (--interior-header-*,
  // index.css) and, tucked directly under it, the MiniMap (--minimap-w/-h).
  // The guide then centres inside whatever is left, so it still reads as
  // centred without ever sitting on either.
  //
  //   sm and up — start below the header card, and clear the map to the left.
  //   phones    — the header card is full-bleed there (`flex-1`) and the map
  //               sits under it, leaving nothing usable beside them; the guide
  //               clears both by starting below the map and then gets the full
  //               width (SideButtons renders null in the interior, so the left
  //               rail below the map is empty).
  //
  // Every figure here is derived from the tokens the two cards are themselves
  // sized and positioned by — no hand-tuned `pt-[17rem]`/`pl-[11.25rem]`, which
  // is what used to need re-checking by hand every time the map was resized.
  interior:
    'pt-[calc(var(--interior-header-top)_+_var(--interior-header-h)_+_var(--hud-gap)_+_var(--minimap-h)_+_var(--hud-gap))] px-3 ' +
    'sm:pt-[calc(var(--interior-header-top)_+_var(--interior-header-h)_+_var(--hud-gap))] ' +
    'sm:pl-[calc(var(--hud-inset)_+_var(--minimap-w)_+_var(--hud-gap))] sm:pr-[var(--hud-inset)]',

  // BUILD_MODE (the outdoor 建造模式 overlay). HudFrame is not mounted for that
  // view (see App.tsx) and WeatherToast renders only in HOME, so there is no
  // TopBar, no MiniMap, no SideButtons and no corner pill — the whole top band
  // is free, so this is a deliberate drop rather than a clearance: it parks her
  // in the open space over the island instead of pinned against the very top
  // edge. The band she is fitted into starts here, so this one figure is what
  // to change to raise or lower her; everything below it (the escape search,
  // the shrink) measures from whatever it leaves.
  island: 'pt-[6.75rem] px-3 sm:pt-[calc(var(--hud-inset)_+_5rem)] sm:px-[var(--hud-inset)]',
};

/* =========================================================================
   FITTING — staying off the panels the guide is talking about.
   =========================================================================
   PLACEMENT_KEEP_OUT above handles the chrome that is always in the same
   place: the interior header card and the MiniMap. It cannot handle the rest,
   because the rest MOVES — the build-mode panel is as tall as whatever tab is
   open, the furniture drawer only exists while it is open and pulls to the
   top-right the moment a piece is picked up, and every dock's height depends
   on its own live contents. A static offset tuned to any one of those is wrong
   for the others, and on a short laptop window the guide landed straight on
   top of the panel it was narrating.

   So the transient obstacles are measured instead of guessed. Anything the
   guide must not cover marks itself with `ANGEL_AVOID`; the guide finds the
   roomiest corner of the band those elements leave free this frame and moves
   there. Nothing here names a specific panel, and no panel needs to know the
   guide exists beyond the one attribute — a dock added later is stepped around
   for free, which is the same rule the HUD tokens exist to enforce (index.css).

   Only when nowhere is big enough does it fall back to shrinking: a uniform
   `scale()` on the whole angel-plus-bubble row, so the character and its card
   keep their proportions rather than the card being squeezed into a thin
   column of wrapped text. Moving first, shrinking last. */

/** Breathing room between the guide and whatever it is stepping around. */
const AVOID_GAP = 12;
/** Natural width of the angel + bubble row. */
const CARD_MAX_W = 660;
/**
 * The guide reflows down to this width before it starts scaling instead.
 * Narrower than this and the Chinese body copy breaks into a ragged column,
 * at which point shrinking the whole card reads better than squeezing it.
 */
const CARD_MIN_W = 300;
/** Floor on the shrink — below this the body copy stops being readable. */
const MIN_SCALE = 0.55;
/** Never reserve so much room that the guide has nowhere left to stand. */
const MIN_BAND_H = 96;
const MIN_BAND_W = 220;
/**
 * How many obstacles the search considers, largest first. The views this runs
 * in put up at most two at a time (a dock plus the furniture drawer); the cap
 * is what keeps the combination count fixed if that ever changes.
 */
const MAX_OBSTACLES = 4;

/** Room given up on each edge of the band, in px. */
type Reserve = { top: number; right: number; bottom: number; left: number };

const NO_RESERVE: Reserve = { top: 0, right: 0, bottom: 0, left: 0 };

type AngelFit = Reserve & {
  /** Layout width the row is allowed to take. */
  width: number;
  /** Uniform shrink applied when even the best corner is too small. */
  scale: number;
};

const UNCONSTRAINED: AngelFit = { ...NO_RESERVE, width: CARD_MAX_W, scale: 1 };

const same = (a: number, b: number) => Math.abs(a - b) < 0.5;

/**
 * The ways out of one obstacle: stand above it, below it, or to either side.
 * Only the directions that actually leave something behind are offered — an
 * obstacle flush with the top of the band cannot be escaped upward.
 */
function escapesFrom(b: DOMRect, o: DOMRect): Reserve[] {
  const out: Reserve[] = [];
  if (o.top > b.top) out.push({ ...NO_RESERVE, bottom: b.bottom - o.top + AVOID_GAP });
  if (o.bottom < b.bottom) out.push({ ...NO_RESERVE, top: o.bottom - b.top + AVOID_GAP });
  if (o.left > b.left) out.push({ ...NO_RESERVE, right: b.right - o.left + AVOID_GAP });
  if (o.right < b.right) out.push({ ...NO_RESERVE, left: o.right - b.left + AVOID_GAP });
  // Covers the band outright: nothing to escape to, so don't give up any room
  // for it — shrinking to 55% behind a full-screen panel helps nobody.
  return out.length ? out : [NO_RESERVE];
}

/**
 * Merging two reservations takes the larger of each edge, which is why a
 * combination is safe to evaluate as one rectangle: whichever way each
 * obstacle was escaped, the survivor excludes every one of them.
 */
function mergeReserve(a: Reserve, r: Reserve): Reserve {
  return {
    top: Math.max(a.top, r.top),
    right: Math.max(a.right, r.right),
    bottom: Math.max(a.bottom, r.bottom),
    left: Math.max(a.left, r.left),
  };
}

/** Clamps a reservation so the band it leaves is never smaller than the floor. */
function clampReserve(r: Reserve, b: DOMRect): Reserve {
  const fit = (near: number, far: number, extent: number, floor: number) => {
    const room = Math.max(0, extent - floor);
    if (near + far <= room) return [near, far] as const;
    const k = near + far > 0 ? room / (near + far) : 0;
    return [near * k, far * k] as const;
  };
  const [top, bottom] = fit(r.top, r.bottom, b.height, MIN_BAND_H);
  const [left, right] = fit(r.left, r.right, b.width, MIN_BAND_W);
  return { top, right, bottom, left };
}

/**
 * Measures the free band and the obstacles standing in it, once per frame.
 *
 * A frame loop rather than ResizeObserver/MutationObserver: the obstacles
 * animate in and out on Motion springs and mount/unmount as the player works,
 * so there is no single element or single event to observe — and the guide is
 * a short-lived overlay that is already running spring animations, so one
 * extra pass of `getBoundingClientRect` over a handful of nodes costs nothing.
 * State is only written when a number actually moves, so the React tree goes
 * quiet as soon as the layout settles.
 */
function useAngelFit(
  bandRef: React.RefObject<HTMLDivElement | null>,
  rowRef: React.RefObject<HTMLDivElement | null>,
): AngelFit {
  const [fit, setFit] = useState<AngelFit>(UNCONSTRAINED);

  useLayoutEffect(() => {
    let raf = 0;

    const measure = () => {
      const band = bandRef.current;
      const row = rowRef.current;
      if (!band || !row) return;

      // The band's own border box is the whole free area: its padding is what
      // we are computing here, so it must not be subtracted from the reference
      // or the reservation would feed back into itself every frame.
      const b = band.getBoundingClientRect();
      if (b.width <= 0 || b.height <= 0) return;

      const obstacles = Array.from(
        document.querySelectorAll<HTMLElement>(ANGEL_AVOID_SELECTOR),
        (el) => el.getBoundingClientRect(),
      )
        .filter((o) => o.width > 0 && o.height > 0)
        // Only what is actually standing in the band matters.
        .filter((o) => o.right > b.left && o.left < b.right && o.bottom > b.top && o.top < b.bottom)
        .sort((p, q) => q.width * q.height - p.width * p.height)
        .slice(0, MAX_OBSTACLES);

      // The row's own layout height, unaffected by the `scale` already applied.
      const natural = row.offsetHeight;
      // How well a given corner of the band would hold the guide at full size:
      // 1 = it fits outright, below that is the shrink it would cost.
      // Scored on the reservation as asked for, never on a clamped one: the
      // clamp exists to stop the band collapsing, and trimming an escape to
      // honour it leaves the obstacle back inside the rect being scored — a
      // corner that is "roomy" precisely because it no longer avoids anything.
      const score = (r: Reserve) => {
        const w = b.width - r.left - r.right;
        const h = b.height - r.top - r.bottom;
        if (w < MIN_BAND_W || h < MIN_BAND_H) return 0;
        return Math.min(1, w / CARD_MAX_W, natural > 0 ? h / natural : 1);
      };

      // Search every way of escaping every obstacle and keep the roomiest
      // result. A per-obstacle rule (step up for anything crossing the centre,
      // sideways otherwise) is what a single pass can express, and it picks
      // wrong exactly when it matters: the furniture drawer straddles the
      // centre of the band on a 1024-wide window, where stepping up leaves a
      // sliver and stepping aside leaves half the screen.
      let options: Reserve[] = [NO_RESERVE];
      for (const o of obstacles) {
        const next: Reserve[] = [];
        for (const base of options) {
          for (const way of escapesFrom(b, o)) next.push(mergeReserve(base, way));
        }
        options = next;
      }

      // Seeded from a real option, never from "reserve nothing": standing still
      // already scores a perfect fit whenever the band is big enough, so
      // including it as a candidate would beat every genuine escape and the
      // guide would never move at all. With no obstacles `options` is exactly
      // [NO_RESERVE] and this collapses back to standing still, correctly.
      let best = options[0];
      let bestScore = score(best);
      for (const candidate of options.slice(1)) {
        const s = score(candidate);
        // Ties go to the option that gives up least, and then to the one that
        // keeps her highest — she reads as a sky NPC, so drifting down the
        // screen is a cost even when it is free in area terms.
        const total = (r: Reserve) => r.top + r.right + r.bottom + r.left;
        if (
          s > bestScore + 0.005 ||
          (Math.abs(s - bestScore) <= 0.005 &&
            (total(candidate) < total(best) - 0.5 ||
              (same(total(candidate), total(best)) && candidate.top < best.top - 0.5)))
        ) {
          best = candidate;
          bestScore = s;
        }
      }

      // Every escape was hopeless — no corner of the band can hold her at a
      // readable size. Giving up room anyway is the worst of both worlds: it
      // buys no clearance AND spends the whole shrink budget. That is how
      // 建築規劃 used to crush her: its panel is bottom-anchored, ~660px tall
      // and 960px wide (see index.css's `short:` note), so on a laptop window
      // every option scores 0 — standing above isn't even offered (the panel
      // starts higher than the band), the side columns are under MIN_BAND_W and
      // standing below leaves a sliver under MIN_BAND_H. The score-0 tie-break
      // then picks whichever reserves least, which is "below" (it only has to
      // clear the panel's bottom inset), and she ends up at MIN_SCALE in a 96px
      // strip along the bottom of the screen, beneath the very panel she is
      // narrating. Stand still at full size instead — exactly what `escapesFrom`
      // already does for an obstacle that covers the band outright.
      if (bestScore === 0) best = NO_RESERVE;

      // The clamp lands here, on the winner only — a last stop against a band
      // with nothing left in it when every escape was hopeless anyway.
      best = clampReserve(best, b);
      const availW = Math.max(0, b.width - best.left - best.right);
      const availH = Math.max(0, b.height - best.top - best.bottom);
      // Reflow first (the row is fluid down to CARD_MIN_W), shrink only after.
      const width = Math.max(CARD_MIN_W, Math.min(CARD_MAX_W, availW));
      const scale = Math.max(
        MIN_SCALE,
        Math.min(1, natural > 0 ? availH / natural : 1, availW / width),
      );

      setFit((prev) =>
        same(prev.top, best.top) &&
        same(prev.left, best.left) &&
        same(prev.right, best.right) &&
        same(prev.bottom, best.bottom) &&
        same(prev.width, width) &&
        Math.abs(prev.scale - scale) < 0.005
          ? prev
          : { ...best, width, scale },
      );
    };

    const tick = () => {
      measure();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bandRef, rowRef]);

  return fit;
}

/**
 * Blink timing. Kept as its own hook because the eyes are the one part of the
 * angel that must NOT loop on a fixed beat — a perfectly periodic blink is the
 * thing that makes a character read as a machine. Each blink is re-scheduled
 * with a fresh random gap instead.
 */
function useBlink() {
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer = 0;

    const loop = () => {
      timer = window.setTimeout(() => {
        if (!alive) return;
        setBlinking(true);
        timer = window.setTimeout(() => {
          if (!alive) return;
          setBlinking(false);
          loop();
        }, 130);
      }, 2200 + Math.random() * 2800);
    };

    loop();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  return blinking;
}

/**
 * The NPC itself — pure SVG, no image assets, no external fonts.
 *
 * Everything that moves is a *small* idle motion layered at a different tempo
 * (wings ~1.05s, skirt ~2.6s, halo ~3.4s, 呆毛 ~2.9s, wave every ~5s, blink
 * random). Nothing shares a period, so the character never visibly "resets",
 * which is what separates an animated character from a bouncing icon.
 */
function AngelSprite({ className = '' }: { className?: string }) {
  // Gradient/clip ids must be unique per instance — a duplicate id anywhere in
  // the document silently repoints every `url(#…)` at the first match.
  const uid = useId().replace(/:/g, '');
  const skin = `${uid}-skin`;
  const robe = `${uid}-robe`;
  const wing = `${uid}-wing`;
  const glow = `${uid}-glow`;

  const blinking = useBlink();

  // Every rotation below pivots on a named anatomical point (a shoulder, the
  // waist, the crown), expressed in viewBox units. `transformBox: 'view-box'`
  // is stated rather than assumed: with the older `border-box` default a px
  // transform-origin resolves against the element's own bounding box instead,
  // which silently swings each limb around the wrong point.
  const pivot = (x: number, y: number) =>
    ({ transformBox: 'view-box', transformOrigin: `${x}px ${y}px` }) as const;

  // Both wings run the same flap, mirrored: a rotation around the shoulder plus
  // a horizontal squash, which foreshortens the wing as it swings forward.
  const flap = {
    duration: 1.05,
    repeat: Infinity,
    ease: 'easeInOut' as const,
  };

  return (
    // viewBox is cropped tight to the drawn content (halo at the top, feet and
    // the lowest twinkle at the bottom) — leftover empty box would shrink the
    // character inside whatever width the caller sets.
    <svg viewBox="0 0 140 132" fill="none" aria-hidden="true" className={className}>
      <defs>
        <radialGradient id={glow} cx="50%" cy="42%" r="50%">
          <stop offset="0%" stopColor="#FFF6E0" stopOpacity="0.85" />
          <stop offset="55%" stopColor="#FFF1D6" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#FFF1D6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={skin} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFEBD6" />
          <stop offset="100%" stopColor="#FFD9B8" />
        </linearGradient>
        <linearGradient id={robe} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#EAF6F4" />
        </linearGradient>
        <linearGradient id={wing} x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#E8F5F2" />
        </linearGradient>
      </defs>

      {/* Halation behind the character — sells "this thing is glowing" far more
          cheaply than an SVG blur filter, which would rasterize every frame. */}
      <motion.circle
        cx="70"
        cy="62"
        r="56"
        fill={`url(#${glow})`}
        animate={{ opacity: [0.75, 1, 0.75], scale: [0.97, 1.03, 0.97] }}
        transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
        style={pivot(70, 62)}
      />

      {/* ---- Wings (behind the body) ---- */}
      <motion.g
        style={pivot(58, 84)}
        animate={{ rotate: [0, -15, 0], scaleX: [1, 0.84, 1] }}
        transition={flap}
      >
        <path
          d="M57 83 C 35 61, 12 65, 10 84 C 8 101, 32 105, 54 95 Z"
          fill={`url(#${wing})`}
          stroke="#E1DED4"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M57 85 C 43 75, 27 79, 27 90 C 27 98, 43 99, 55 93 Z"
          fill="#FFFFFF"
          stroke="#E1DED4"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        {/* Feather separations */}
        <path d="M50 92 C 40 88, 30 85, 22 82" stroke="#E1DED4" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M52 88 C 44 82, 36 76, 30 72" stroke="#E1DED4" strokeWidth="1.4" strokeLinecap="round" />
      </motion.g>

      <motion.g
        style={pivot(82, 84)}
        animate={{ rotate: [0, 15, 0], scaleX: [1, 0.84, 1] }}
        transition={flap}
      >
        <path
          d="M83 83 C 105 61, 128 65, 130 84 C 132 101, 108 105, 86 95 Z"
          fill={`url(#${wing})`}
          stroke="#E1DED4"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M83 85 C 97 75, 113 79, 113 90 C 113 98, 97 99, 85 93 Z"
          fill="#FFFFFF"
          stroke="#E1DED4"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M90 92 C 100 88, 110 85, 118 82" stroke="#E1DED4" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M88 88 C 96 82, 104 76, 110 72" stroke="#E1DED4" strokeWidth="1.4" strokeLinecap="round" />
      </motion.g>

      {/* ---- Body: the robe sways from the waist like cloth catching up with
              the hover, on a slower beat than the wings ---- */}
      <motion.g
        style={pivot(70, 76)}
        animate={{ rotate: [-2, 2, -2] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* Feet peeking under the hem */}
        <ellipse cx="62" cy="121" rx="5.4" ry="3.6" fill={`url(#${skin})`} stroke="#E1DED4" strokeWidth="1.4" />
        <ellipse cx="78" cy="121" rx="5.4" ry="3.6" fill={`url(#${skin})`} stroke="#E1DED4" strokeWidth="1.4" />

        <path
          d="M70 73 C 57 73, 51 94, 49 113 Q 70 122, 91 113 C 89 94, 83 73, 70 73 Z"
          fill={`url(#${robe})`}
          stroke="#E1DED4"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        {/* Folds */}
        <path d="M63 84 C 61 95, 60 105, 60 114" stroke="#E1DED4" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M77 84 C 79 95, 80 105, 80 114" stroke="#E1DED4" strokeWidth="1.5" strokeLinecap="round" />
        {/* Sash */}
        <path d="M54 94 Q70 100 86 94" stroke="#5FBDAF" strokeWidth="3.2" strokeLinecap="round" fill="none" />
        {/* Collar */}
        <ellipse cx="70" cy="75" rx="9.5" ry="3.6" fill="#5FBDAF" />
      </motion.g>

      {/* Left arm, resting */}
      <motion.g
        style={pivot(57, 84)}
        animate={{ rotate: [0, 4, 0] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <path d="M57 84 C 50 90, 47 97, 48 103" stroke="#FFFFFF" strokeWidth="7.5" strokeLinecap="round" fill="none" />
        <circle cx="48" cy="104" r="4.2" fill={`url(#${skin})`} stroke="#E1DED4" strokeWidth="1.3" />
      </motion.g>

      {/* Right arm: mostly still, with a little wave every few seconds. The
          `times` array keeps the wave itself short so it reads as a deliberate
          gesture punctuating the idle, not a constantly flailing limb. */}
      <motion.g
        style={pivot(83, 84)}
        animate={{ rotate: [0, 0, -34, -14, -34, -6, 0, 0] }}
        transition={{
          duration: 5.4,
          times: [0, 0.5, 0.6, 0.66, 0.72, 0.8, 0.88, 1],
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      >
        <path d="M83 84 C 90 90, 93 97, 92 103" stroke="#FFFFFF" strokeWidth="7.5" strokeLinecap="round" fill="none" />
        <circle cx="92" cy="104" r="4.2" fill={`url(#${skin})`} stroke="#E1DED4" strokeWidth="1.3" />
      </motion.g>

      {/* ---- Head ---- */}
      <circle cx="70" cy="52" r="23" fill={`url(#${skin})`} stroke="#E1DED4" strokeWidth="2" />

      {/* Side locks */}
      <path d="M48 50 C 44 60, 45 68, 49 72 C 52 66, 52 58, 51 52 Z" fill="#2A9D8F" />
      <path d="M92 50 C 96 60, 95 68, 91 72 C 88 66, 88 58, 89 52 Z" fill="#2A9D8F" />

      {/* Fringe */}
      <path
        d="M47 52 A23 23 0 0 1 93 52 C 89 45, 84 42, 79 46 C 74 50, 71 43, 65 47 C 59 51, 53 47, 47 52 Z"
        fill="#2A9D8F"
      />
      {/* Hair sheen */}
      <path d="M58 36 C 64 32, 72 31, 79 34" stroke="#5FBDAF" strokeWidth="2.6" strokeLinecap="round" fill="none" />

      {/* 呆毛 — the single most characterful pixel-for-pixel element here. */}
      <motion.path
        d="M70 30 C 73 23, 79 22, 77 16"
        stroke="#2A9D8F"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
        style={pivot(70, 30)}
        animate={{ rotate: [-9, 9, -9] }}
        transition={{ duration: 2.9, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* ---- Face ---- */}
      {blinking ? (
        <>
          <path d="M57 55 Q61 51 65 55" stroke="#264653" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <path d="M75 55 Q79 51 83 55" stroke="#264653" strokeWidth="2.4" strokeLinecap="round" fill="none" />
        </>
      ) : (
        <>
          <ellipse cx="61" cy="54" rx="3.3" ry="3.8" fill="#264653" />
          <ellipse cx="79" cy="54" rx="3.3" ry="3.8" fill="#264653" />
          <circle cx="62.3" cy="52.4" r="1.3" fill="#FFFFFF" />
          <circle cx="80.3" cy="52.4" r="1.3" fill="#FFFFFF" />
        </>
      )}
      <ellipse cx="53" cy="61" rx="4.6" ry="2.7" fill="#E8836A" opacity="0.42" />
      <ellipse cx="87" cy="61" rx="4.6" ry="2.7" fill="#E8836A" opacity="0.42" />
      <path d="M66 61 Q70 65.5 74 61" stroke="#264653" strokeWidth="2.3" strokeLinecap="round" fill="none" />

      {/* ---- Halo: bobs and tips independently of the head, so it reads as
              floating above rather than welded on ---- */}
      <motion.g
        style={pivot(70, 22)}
        animate={{ rotate: [-6, 6, -6], y: [0, -2, 0] }}
        transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <ellipse cx="70" cy="22" rx="19" ry="6" fill="none" stroke="#F3C877" strokeWidth="6.5" strokeLinecap="round" />
        <ellipse cx="70" cy="22" rx="19" ry="6" fill="none" stroke="#E8AA3E" strokeWidth="3.4" strokeLinecap="round" />
      </motion.g>

      {/* ---- Twinkles. Staggered so they never pop together. ---- */}
      {[
        { x: 18, y: 44, s: 1, d: 0 },
        { x: 122, y: 56, s: 0.8, d: 1.1 },
        { x: 30, y: 118, s: 0.7, d: 2.2 },
        { x: 112, y: 112, s: 0.9, d: 0.6 },
      ].map((tw) => (
        // The placement `translate` has to live on a plain wrapper <g>: Motion
        // drives SVG transforms through the CSS `transform` property, which
        // wholesale overrides a `transform` *attribute* on the same element —
        // put both on the star itself and every twinkle collapses onto 0,0.
        <g key={`${tw.x}-${tw.y}`} transform={`translate(${tw.x} ${tw.y})`}>
          <motion.path
            d="M0 -6 Q1 -1 6 0 Q1 1 0 6 Q-1 1 -6 0 Q-1 -1 0 -6 Z"
            fill="#F5D08A"
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            animate={{ scale: [0, tw.s, 0], rotate: [0, 90, 180], opacity: [0, 1, 0] }}
            transition={{ duration: 2.6, delay: tw.d, repeat: Infinity, ease: 'easeInOut' }}
          />
        </g>
      ))}
    </svg>
  );
}

export function AngelGuide({
  steps,
  onClose,
  placement = 'interior',
}: {
  steps: AngelGuideStep[];
  /**
   * `'done'` = the player read every step, `'skip'` = they bailed out. Both
   * should normally mark the guide seen; the distinction is here so a caller
   * can log/telemetry them apart.
   */
  onClose: (reason: 'done' | 'skip') => void;
  /** Which view's HUD to stay clear of — see PLACEMENT_KEEP_OUT. */
  placement?: AngelGuidePlacement;
}) {
  const [index, setIndex] = useState(0);
  // The short beat between "read the last line" and the guide leaving, during
  // which the ribbons fly and the angel does a happy hop.
  const [celebrating, setCelebrating] = useState(false);

  const layerRef = useRef<HTMLCanvasElement | null>(null);
  const angelRef = useRef<HTMLButtonElement | null>(null);
  const bandRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const fireRef = useRef<ReturnType<typeof confetti.create> | null>(null);
  const ribbonRef = useRef<ReturnType<typeof confetti.shapeFromPath> | null>(null);
  const timersRef = useRef<number[]>([]);

  const isLast = index >= steps.length - 1;

  // Keeps the guide off whatever else is currently on screen — see the FITTING
  // note above. Called unconditionally (hooks rule) even on the empty-steps
  // early return below, which renders nothing and simply never measures.
  const fit = useAngelFit(bandRef, rowRef);

  // A confetti instance bound to *our* canvas rather than the library's global
  // one. The global canvas is appended to <body> at z-index 100, which would
  // put the ribbons in front of the angel; the whole point is that they come
  // out from behind her, so the canvas has to live inside this overlay, under
  // the character.
  useEffect(() => {
    const canvas = layerRef.current;
    if (!canvas) return;

    // useWorker is left off deliberately: it transfers the canvas to an
    // OffscreenCanvas permanently, and this component remounts on every topic
    // change. One small burst does not need a worker.
    const instance = confetti.create(canvas, { resize: true });
    fireRef.current = instance;
    // Tall thin rectangle = a paper streamer. canvas-confetti tumbles and
    // foreshortens each particle as it flies, so this reads as 彩帶 rather
    // than the default round/square dots.
    ribbonRef.current = confetti.shapeFromPath({ path: 'M0 0 H5 V17 H0 Z' });

    const timers = timersRef.current;
    return () => {
      timers.forEach(window.clearTimeout);
      timers.length = 0;
      instance.reset();
      fireRef.current = null;
    };
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  }, []);

  const burstRibbons = useCallback(() => {
    const canvas = layerRef.current;
    const angel = angelRef.current;
    if (!fireRef.current || !canvas || !angel) return;

    // canvas-confetti wants a 0..1 origin in *canvas* space, so measure the
    // angel against the canvas rather than the viewport — the overlay carries
    // responsive padding, so the two are not the same box.
    const c = canvas.getBoundingClientRect();
    const a = angel.getBoundingClientRect();
    if (!c.width || !c.height) return;
    const origin = {
      x: (a.left + a.width / 2 - c.left) / c.width,
      y: (a.top + a.height * 0.55 - c.top) / c.height,
    };

    // Her own palette (teal / white / sand). Gold is skipped on purpose — the
    // token is documented as currency-only and finishing a tutorial isn't a
    // currency moment. See index.css.
    const colors = ['#2A9D8F', '#5FBDAF', '#FFFFFF', '#EFE9DC'];
    const shapes = [ribbonRef.current, 'square'].filter(Boolean) as confetti.Shape[];
    const common = { origin, colors, shapes, disableForReducedMotion: true };

    fireRef.current({ ...common, particleCount: 34, spread: 78, startVelocity: 34, scalar: 1.05, ticks: 170 });
    // Two late side-fans, so it unfurls instead of popping all at once.
    later(() => fireRef.current?.({ ...common, particleCount: 16, angle: 62, spread: 52, startVelocity: 30, scalar: 0.95, ticks: 150 }), 110);
    later(() => fireRef.current?.({ ...common, particleCount: 16, angle: 118, spread: 52, startVelocity: 30, scalar: 0.95, ticks: 150 }), 190);
  }, [later]);

  const advance = useCallback(() => {
    playSound(SoundEffect.CLICK);
    triggerHaptic('light');

    if (!isLast) {
      setIndex((i) => i + 1);
      return;
    }
    // A second click during the celebration means "yes, I'm done" — leave at
    // once. The guide must never hold the player hostage to an animation.
    if (celebrating) {
      onClose('done');
      return;
    }
    setCelebrating(true);
    burstRibbons();
    later(() => onClose('done'), 900);
  }, [isLast, celebrating, onClose, burstRibbons, later]);

  const skip = useCallback(() => {
    playSound(SoundEffect.CLICK);
    triggerHaptic('light');
    onClose('skip');
  }, [onClose]);

  if (steps.length === 0) return null;
  const step = steps[Math.min(index, steps.length - 1)];

  return (
    // Full-bleed but inert: only the bubble and the angel take pointer events,
    // so the player can keep dragging furniture / orbiting the camera with the
    // guide still up. Sits in the sky band near the top of the viewport, clear
    // of the bottom toolbars the guide is talking about.
    //
    // z-toast (40), not z-modal: above the docks and the furniture drawer it is
    // narrating (z-floating-panel, 30) so it stays readable while the player
    // follows along, but still under real modals (z-modal, 1000) — an angel
    // hovering over the room-picker dialog would be talking about a screen the
    // player can no longer see. See index.css for the tier list.
    //
    // The keep-out is written as padding on this full-bleed layer rather than
    // as offsets on the card, so the two children keep centring against each
    // other whichever view we're in.
    <div
      className={`absolute inset-0 z-toast pointer-events-none overflow-hidden ${PLACEMENT_KEEP_OUT[placement]}`}
    >
      {/* Ribbon canvas. First child and unpositioned in the stack, so it paints
          under the angel and the bubble (both `relative`) — the streamers read
          as coming out from behind her. Spans the whole overlay rather than
          just the character, so they have room to arc away instead of being
          clipped to a 120px box. */}
      <canvas
        ref={layerRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      />

      {/* The free band: the keep-out layer's content box, minus whatever the
          measured obstacles are occupying in it right now (useAngelFit). The
          reservation is padding here rather than offsets on the row, so the
          row keeps centring on whatever is left. */}
      <div
        ref={bandRef}
        className="relative flex h-full w-full justify-center"
        style={{
          paddingTop: fit.top,
          paddingLeft: fit.left,
          paddingRight: fit.right,
          paddingBottom: fit.bottom,
        }}
      >
      {/* Shrink wrapper. Separate from the row below because the row's own
          transform belongs to Motion — writing `scale()` onto the same element
          would be overwritten by the entry spring on every frame. Origin is
          top-centre so shrinking pulls the guide up and away from the panel it
          is avoiding rather than drifting off toward a corner. */}
      <div
        className="h-fit w-full origin-top"
        style={{ maxWidth: fit.width, transform: `scale(${fit.scale})` }}
      >
      <motion.div
        ref={rowRef}
        initial={{ opacity: 0, y: -50, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -40, scale: 0.9 }}
        transition={{ type: 'spring', damping: 22, stiffness: 260 }}
        className="relative flex h-fit w-full items-start gap-2 sm:gap-4"
      >
        {/* The NPC — hovering, and clickable in its own right so tapping the
            character (the obvious target) does the same thing as the bubble.
            Two nested motion layers on purpose: the outer one owns the endless
            hover + drift, the inner one is keyed on `index` so every new line
            of dialogue remounts it and replays a little "perk up" spring
            without disturbing the hover phase. */}
        <motion.button
          ref={angelRef}
          type="button"
          onClick={advance}
          animate={{ y: [0, -9, 0], rotate: [-1.5, 1.5, -1.5] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
          className="relative pointer-events-auto flex-shrink-0 -mt-3 sm:-mt-6 cursor-pointer active:scale-95 transition-transform drop-shadow-[0_12px_26px_rgba(38,70,83,0.26)]"
          title="點一下繼續"
        >
          <motion.span
            key={index}
            initial={{ scale: 0.84 }}
            // On the final click she pops and rocks once, timed to land with
            // the ribbons rather than after them.
            animate={celebrating ? { scale: [1, 1.2, 1.06], rotate: [0, -7, 4, 0] } : { scale: 1 }}
            transition={
              celebrating
                ? { duration: 0.5, ease: 'easeOut' }
                : { type: 'spring', stiffness: 420, damping: 11 }
            }
            className="block"
          >
            {/* One SVG scaled by CSS rather than a phone copy and a desktop
                copy — two mounted sprites would mean duplicate gradient ids. */}
            <AngelSprite className="w-[80px] sm:w-[116px] h-auto" />
          </motion.span>
        </motion.button>

        {/* Speech bubble — built to the project's "Dock & Signpost" motif
            (index.css): a physical little notice card rather than a generic
            rounded rectangle. Cream-2 header band + rope-stitch rule + white
            body is the same three-part anatomy as PanelHeader, so this reads
            as part of the same UI kit; every colour is an existing island-*
            token. The corner nearest the angel is squared off so the tail
            lands on a straight edge instead of fighting a 1.6rem radius. */}
        <motion.div
          initial={{ opacity: 0, x: -18, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26, delay: 0.06 }}
          className="pointer-events-auto relative mt-4 sm:mt-8 flex-1 min-w-0"
        >
          {/* Spill of the angel's own glow onto the card. Sits outside the card
              (no overflow-hidden anywhere on this branch — that would also eat
              the tail), so it reads as light falling on paper. */}
          <span className="pointer-events-none absolute -left-8 -top-8 h-32 w-32 rounded-full bg-island-teal/10 blur-2xl" />

          {/* Tail pointing back at the angel — matched to the header band's
              fill, since that is the band it emerges from. */}
          <span className="absolute left-[-6.5px] top-[26px] z-10 h-3.5 w-3.5 rotate-45 rounded-[3px] border-b border-l border-island-line bg-island-cream-2" />

          <div
            role="button"
            tabIndex={0}
            onClick={advance}
            onKeyDown={(e) => {
              if (e.key === 'Enter') advance();
            }}
            className="relative cursor-pointer select-none overflow-visible rounded-tl-xl rounded-tr-[1.6rem] rounded-b-[1.6rem] border border-island-line bg-island-cream text-left shadow-[0_26px_52px_-16px_rgba(38,70,83,0.45),0_0_0_1px_rgba(255,255,255,0.9)_inset] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_32px_60px_-16px_rgba(38,70,83,0.5),0_0_0_1px_rgba(255,255,255,0.9)_inset] active:translate-y-0 active:scale-[0.99]"
          >
            {/* ---- Header band: stable chrome. The speaker's name and the
                    controls never change between steps, so they don't animate
                    — only the message below does. ---- */}
            {/* Radii are one border-width tighter than the card's (0.75/1.6rem)
                so the band follows the *inner* curve instead of bleeding a
                hairline over the border on the two top corners. */}
            <div className="flex items-center gap-2.5 rounded-tl-[0.69rem] rounded-tr-[1.54rem] bg-island-cream-2/85 px-3.5 pt-2.5 pb-2 sm:px-5 sm:pt-3 sm:pb-2.5">
              <span className="relative flex h-2 w-2 flex-shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-island-teal-light opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-island-teal" />
              </span>
              <span className="text-[10px] font-black tracking-[0.22em] text-island-teal-dark sm:text-[11px]">
                小天使
              </span>

              {/* Progress beads. Past steps stay teal but faded, the current one
                  stretches, upcoming ones are inert line-colour — so the row
                  shows direction of travel, not just position. */}
              <span className="ml-auto flex items-center gap-1.5">
                {steps.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i === index
                        ? 'w-5 bg-island-teal'
                        : i < index
                          ? 'w-1.5 bg-island-teal/40'
                          : 'w-1.5 bg-island-line'
                    }`}
                  />
                ))}
              </span>

              {/* The escape hatch: one click, guide gone. Stops propagation so
                  it never reads as "next step" on the way out. */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  skip();
                }}
                className="flex flex-shrink-0 cursor-pointer items-center gap-1 rounded-full border border-island-line bg-island-cream py-1 pl-1.5 pr-2 text-[10px] font-black text-island-navy-soft shadow-[0_1px_2px_rgba(38,70,83,0.08)] transition-all hover:bg-island-line/40 hover:text-island-navy active:scale-95"
                title="跳過導覽"
              >
                <X size={11} strokeWidth={3} />
                <span>跳過</span>
              </button>
            </div>

            {/* Stitched rule, inset from the edges like the seam on a tag */}
            <div className="rope-stitch mx-3.5 sm:mx-5" />

            {/* ---- Message ---- */}
            <div className="px-3.5 py-3 sm:px-5 sm:py-4">
              <AnimatePresence mode="wait">
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <p className="mb-1.5 text-[10px] font-black tracking-[0.18em] text-island-navy-soft/70">
                    {step.title}
                  </p>
                  {/* Generous leading: this is Chinese body copy at small size,
                      where tight line-height is what makes a bubble feel cheap. */}
                  <p className="text-[13px] font-bold leading-[1.85] tracking-wide text-island-navy sm:text-[15px]">
                    {step.body}
                  </p>
                </motion.div>
              </AnimatePresence>

              <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] font-black text-island-teal-dark sm:text-[11px]">
                <span>{celebrating ? '完成！' : isLast ? '我知道了' : '點一下繼續'}</span>
                {isLast ? (
                  <Check size={14} strokeWidth={3} />
                ) : (
                  // Nudges rightward on a loop — a standing invitation to tap,
                  // without a countdown or any other pressure to hurry.
                  <motion.span
                    className="flex"
                    animate={{ x: [0, 3, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <ChevronRight size={14} strokeWidth={3} />
                  </motion.span>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
      </div>
      </div>
    </div>
  );
}
