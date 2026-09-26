/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useOnboardingActive } from '../../lib/onboardingQueue';
import { View } from '../../types';
import {
  COLOUR_MIN_DRAIN,
  colourDrainForHours,
  resolveIslandColour,
  type IslandColourState,
} from '../../constants/islandReturn';

/**
 * 離線褪色 — the one element that takes colour out of the island, and puts it back.
 *
 * A single transparent sheet laid over the island's <Canvas>, desaturating whatever is behind it.
 * All of the *thinking* lives in constants/islandReturn.ts ({@link resolveIslandColour}); this
 * file is the sheet, the clock that decides when the recovery may begin, and nothing else.
 *
 * ## Why a backdrop filter and not a post-processing pass
 *
 * The island renders straight to the canvas — there is no EffectComposer, and Three/Scene.tsx
 * argues at length why adding one to tint the light was the wrong trade. That argument does not
 * carry over here, because this effect has to reach places light cannot: the sky dome, the
 * fireflies, the ocean's own tint and every emissive surface are unlit, so desaturating the three
 * lights leaves them in full colour. 「完全黑白」 that leaves a blue sky is not black and white.
 *
 * A composited CSS filter buys the whole frame for less than a WebGL pass would. There is no
 * render target, no second draw of the scene, no extra dependency and no shader — the browser
 * desaturates the layer it has already composited, on the GPU, in the step it was going to
 * perform anyway. And it is *removable*: the element is unmounted the instant the recovery ends
 * and never mounted at all for the absences that do not earn it (see the guard below), so the
 * ordinary session pays exactly nothing. A composer, once added, costs its pass on every frame
 * of every session forever.
 *
 * ## Why it cannot affect anything but the picture (brief §5 / §11)
 *
 * It is `pointer-events: none`, it holds no state the game reads, and it lives outside the R3F
 * tree entirely — there is no path from here to a raycast, a collider, the camera or an input
 * handler. It is also mounted INSIDE Three/Scene.tsx's `z-background` wrapper, below every HUD
 * tier, so the UI, the shop and every modal stay in full colour and full contrast on top of a
 * black-and-white world. That is deliberate: a greyed-out button reads as disabled.
 *
 * ## Ordering against everything else that owns the screen (brief §13)
 *
 * The recovery is a few seconds long and worth watching, so it does not start until the island is
 * actually watchable — the player is on the island (not in the shop, the house or the dressing
 * room) and no onboarding surface is up. In practice that means it begins the moment the returning
 * player closes 「歡迎回到島上」, which is the best seat in the house; without the gate it would run
 * its whole course behind that very panel and be missed. Once running it never pauses, because a
 * recovery that stalls when you open a menu is one the player can strand.
 */

/**
 * How far the cleared circle reaches at full bloom, as a percentage of the gradient's radius.
 *
 * Past 100 on purpose: a `circle` gradient's percentages are measured to the farthest corner, so
 * 100 is exactly enough and 108 is exactly enough plus a margin against rounding. The margin is
 * what guarantees the last frame is a true no-op rather than a hairline of desaturation left in
 * the corners at the moment the element is removed.
 */
const VEIL_SPREAD = 108;

/** The soft edge of the bloom at its narrowest — the first speck of colour, in gradient percent. */
const VEIL_FEATHER_MIN = 5;

/** How much wider that soft edge grows as the bloom opens out. */
const VEIL_FEATHER_SPAN = 26;

/**
 * Where the colour comes back from: slightly below the middle of the screen.
 *
 * The camera orbits the island at a fixed pitch, so the island itself always sits a little under
 * centre while the sky takes the top of the frame. Blooming from the geometric middle would start
 * the recovery in the sky, which reads as a light turning on; starting it here reads as the colour
 * coming back out of the island — which is the sentence the whole feature is trying to say.
 */
const VEIL_ORIGIN = '50% 56%';

/**
 * 恢復演示 — one mounted recovery, from the arrival state to full colour.
 *
 * Keyed on the recovery's token by its parent, so an admin pressing a second preset gets a clean
 * instance rather than a half-finished animation being re-aimed.
 */
function ColourVeilLayer({ hours, play }: { hours: number; play: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  /** When the recovery actually began. Latched, so losing `play` mid-flight cannot restart it. */
  const startedRef = useRef<number | null>(null);
  const [done, setDone] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    /**
     * Writes a resolved state to the element.
     *
     * Both values are quantised and compared against the last write, so a frame that has not
     * moved the effect by a visible amount touches no style at all. That matters more than it
     * looks: a `backdrop-filter` change is free (the compositor re-runs it every frame regardless)
     * but a new `mask-image` string makes the browser re-rasterise a full-screen gradient, and
     * doing that sixty times a second for six seconds is the one part of this that could be felt.
     * At these step sizes the mask is redrawn a few dozen times across the whole animation, and
     * the gradient's own soft edge hides every step.
     */
    let lastSaturation = -1;
    let lastClear = -2;
    const paint = (colour: IslandColourState) => {
      const saturation = Math.round(colour.saturation * 200) / 200;
      if (saturation !== lastSaturation) {
        lastSaturation = saturation;
        const filter = `saturate(${saturation})`;
        // Through setProperty for the vendor-prefixed form, which is what Safari still reads and
        // what CSSStyleDeclaration has no typed member for.
        el.style.setProperty('backdrop-filter', filter);
        el.style.setProperty('-webkit-backdrop-filter', filter);
      }

      // -1 is 「no mask at all」, which is a different thing from 「a mask with a zero-width hole」
      // and has to survive the comparison as its own value — otherwise the first frame of the
      // bloom quantises to 0, matches the held state, and the mask is never applied.
      const clear = colour.bloom <= 0 ? -1 : Math.round(colour.bloom * VEIL_SPREAD * 4) / 4;
      if (clear !== lastClear) {
        lastClear = clear;
        const mask =
          clear < 0
            ? 'none'
            : `radial-gradient(circle at ${VEIL_ORIGIN}, transparent ${clear}%, #000 ${
                clear + VEIL_FEATHER_MIN + colour.bloom * VEIL_FEATHER_SPAN
              }%)`;
        el.style.setProperty('mask-image', mask);
        el.style.setProperty('-webkit-mask-image', mask);
      }
    };

    // Where the effect is right now, written in a layout effect so it is on the element before the
    // browser paints the frame this component appeared on. A returning player must never see one
    // frame of full colour before the world drains — that reads as a bug, not as an absence.
    //
    // It has to be the CURRENT state and not the arrival state, because this effect also re-runs
    // mid-recovery whenever `play` changes — which it does every time the player steps into the
    // shop or the house and back out. Painting the arrival state there would slam the frame back
    // to fully drained for exactly one frame, on the frame they return to the island.
    paint(
      resolveIslandColour(
        hours,
        startedRef.current === null ? null : (performance.now() - startedRef.current) / 1000,
      ),
    );

    // Held: either the admin is inspecting a level, or the island is not watchable yet. No
    // animation frame is requested at all, so holding costs one composited layer and no CPU.
    if (!play && startedRef.current === null) return;

    if (startedRef.current === null) startedRef.current = performance.now();
    const startedAt = startedRef.current;

    let raf = 0;
    const tick = () => {
      const colour = resolveIslandColour(hours, (performance.now() - startedAt) / 1000);
      paint(colour);
      // Both terms land on neutral together (see resolveIslandColour), so unmounting here changes
      // nothing on screen — the effect is already a no-op by the time the element goes.
      if (colour.done) {
        setDone(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hours, play]);

  if (done) return null;

  return <div ref={ref} aria-hidden className="absolute inset-0 pointer-events-none" />;
}

/**
 * Decides whether there is a recovery to draw, and when it is allowed to begin.
 *
 * Mounted by Three/Scene.tsx inside the island's own wrapper. Renders nothing — not a hidden
 * element, nothing — for every session that has not just come back from a long absence, which is
 * almost all of them.
 */
export function IslandColourVeil() {
  const { islandRecovery, currentView } = useApp();
  const onboarding = useOnboardingActive();

  // The same 「is the island on screen」 test <Scene> uses to park its frameloop, for the same
  // reason: everything else is a full-screen view with the island behind it.
  const covered = currentView !== View.HOME && currentView !== View.BUILD_MODE;

  if (!islandRecovery) return null;
  // The one guard for the whole feature. An absence too short to be worth showing produces no
  // element, no animation frame and no compositing pass — see COLOUR_MIN_DRAIN.
  if (colourDrainForHours(islandRecovery.hours) < COLOUR_MIN_DRAIN) return null;

  return (
    <ColourVeilLayer
      key={islandRecovery.token}
      hours={islandRecovery.hours}
      play={islandRecovery.play && !covered && !onboarding}
    />
  );
}
