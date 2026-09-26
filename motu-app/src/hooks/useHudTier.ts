/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

/**
 * The four device tiers the HUD is sized on — the JS half of the
 * "RESPONSIVE HUD SIZE SYSTEM" block in src/index.css.
 *
 * WHAT THIS IS FOR: the token scale in index.css already resizes HUD chrome on
 * its own, and that is where a padding / font / icon size belongs. This hook is
 * for the two things CSS cannot express: choosing a different LAYOUT (a compact
 * one-line card vs. a stacked one) and choosing a different DEFAULT (detail
 * open on a desktop, folded away on a phone). Reach for the tokens first; reach
 * for this only when the markup itself has to change.
 *
 * WHAT THIS IS NOT FOR: deciding whether the player is on touch. Width says how
 * much room there is, not what is pointing at it — a 1180px tablet in landscape
 * is a `laptop` here and still needs 44px targets. That question belongs to
 * `useIsTouchDevice()` (pointer type), and the two are meant to be used
 * together, never as substitutes. Picking LAYOUT by pointer type — which TopBar
 * used to do — handed a touchscreen laptop the phone card and a narrow desktop
 * window the full-size one, i.e. exactly backwards on both.
 *
 * KEEP IN SYNC with the media queries in src/index.css: `npm run audit:hud-scale`
 * parses both and fails if they disagree.
 */
export type HudTier = 'mobile' | 'tablet' | 'laptop' | 'desktop';

/** Lower bound (inclusive, px) of each tier. Mirrors index.css. */
export const HUD_TIER_MIN_WIDTH: Record<HudTier, number> = {
  mobile: 0,
  tablet: 640,
  laptop: 1024,
  desktop: 1536,
};

/**
 * Viewport HEIGHT below which top/bottom-anchored stacks have to give ground.
 * Mirrors the `short:` custom variant in index.css — a 1366x768 laptop, or a
 * 1080p one at 125% Windows scaling, is wide enough for the `laptop` tier and
 * still too short to carry a fully expanded rail.
 */
export const HUD_SHORT_MAX_HEIGHT = 800;

const TIERS_DESCENDING: HudTier[] = ['desktop', 'laptop', 'tablet', 'mobile'];

export function tierForWidth(width: number): HudTier {
  return TIERS_DESCENDING.find((t) => width >= HUD_TIER_MIN_WIDTH[t]) ?? 'mobile';
}

/**
 * Both hooks below listen on `resize` AND on the relevant `matchMedia` query.
 *
 * Not belt-and-braces for its own sake: a `change` event is not guaranteed for
 * every way a viewport can change size — it did not fire at all under the
 * DevTools viewport emulation these layouts were verified in, which is exactly
 * the kind of silence that ships a hook everyone believes is live. `resize` is
 * the signal that always arrives, and calling the setter with an unchanged
 * value is a no-op React bails out of, so the extra listener costs one
 * comparison per event and nothing per pixel. (This is also what
 * `useIsTouchDevice` does, so the two read alike.)
 */
function useViewportDerived<T>(read: () => T, initial: T, query: () => MediaQueryList[]): T {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    const update = () => setValue(read());
    update();
    const queries = query();
    window.addEventListener('resize', update);
    queries.forEach((q) => q.addEventListener('change', update));
    return () => {
      window.removeEventListener('resize', update);
      queries.forEach((q) => q.removeEventListener('change', update));
    };
    // `read`/`query` are stable module-level closures at every call site below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return value;
}

/**
 * First paint falls back to `laptop`, the middle of the scale, so the worst
 * case before the effect runs is one step of correction rather than the full
 * width of the range.
 */
export function useHudTier(): HudTier {
  return useViewportDerived(
    () => tierForWidth(window.innerWidth),
    typeof window === 'undefined' ? 'laptop' : tierForWidth(window.innerWidth),
    () =>
      TIERS_DESCENDING.filter((t) => t !== 'mobile').map((t) =>
        window.matchMedia(`(min-width: ${HUD_TIER_MIN_WIDTH[t]}px)`),
      ),
  );
}

/** True on a viewport short enough that the `short:` variant applies. */
export function useIsShortViewport(): boolean {
  return useViewportDerived(
    () => window.innerHeight <= HUD_SHORT_MAX_HEIGHT,
    false,
    () => [window.matchMedia(`(max-height: ${HUD_SHORT_MAX_HEIGHT}px)`)],
  );
}
