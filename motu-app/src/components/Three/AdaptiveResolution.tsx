/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';

/**
 * 自動調整算圖解析度 — the island renders at fewer pixels on a machine that cannot keep up, and
 * at full sharpness on one that can.
 *
 * ## Why resolution is the lever, and not detail
 *
 * This scene is FILL-RATE bound, and that was measured rather than assumed. On an Intel UHD
 * laptop at 1440x900 the frame ran 19.7 ms; the same frame at 2160x1350 - 2.25x the pixels,
 * nothing else changed - ran 32.9 ms. Switching off the entire shadow map pass, by contrast, was
 * worth 0.32 ms, and rewriting the sea's fragment shader to skip work it was throwing away
 * bought about 0.3 ms. The cost is not in what the scene computes per object; it is in how many
 * pixels the big blended layers - sky, far sea, near sea, the shore rings, the seabed - each
 * have to touch, and every one of those scales exactly with the drawing buffer's area.
 *
 * So the honest knob is the buffer's area. Halving detail would change what the island looks
 * like on every machine; halving pixels changes only how sharp it is, only on the machines that
 * were dropping frames anyway, and gives back time proportional to the thing actually being
 * spent.
 *
 * ## Why it is driven from a PROP and not from `setDpr`
 *
 * `gl.setPixelRatio` / R3F's `setDpr` are overwritten within a tick here. <Canvas> re-renders on
 * every AppContext change (it consumes the context to bridge it across the renderer boundary)
 * and re-applies its own `dpr` prop each time, so an imperative call from inside is undone
 * almost immediately - the same trap `frameloop` has, for the same reason. This component
 * therefore only MEASURES and reports; Scene owns the value as React state and passes it down,
 * which makes React's value the only one there is.
 *
 * ## The rules
 *
 * `delta` is wall time between frames, so on a machine that is comfortably ahead it reads the
 * display's refresh interval (~16.7 ms) no matter how much headroom is left. That means it can
 * never say "this machine is fast"; it can only say "this machine is LATE". The ladder is built
 * around that asymmetry:
 *
 *   * Stepping DOWN is triggered by sustained lateness - a median frame over {@link SLOW_MS}
 *     across a whole window of frames, which is roughly "under 48 fps for a second".
 *   * Stepping UP requires a much longer stretch of frames at essentially the refresh rate, and
 *     is tried at most a couple of times: if a step up is punished by a step down soon after,
 *     the level below is locked in for the session rather than oscillating between two
 *     resolutions, which reads far worse than simply being slightly soft.
 *
 * Both changes reallocate the drawing buffer, so they are rate-limited by {@link SETTLE_MS} and
 * the frames right after one are discarded - the first frames at a new size include the
 * reallocation itself and would otherwise immediately re-trigger the rule that caused them.
 */

/**
 * Resolutions to walk, sharpest first. Anything below 1 is genuinely soft, hence the floor.
 *
 * 0.65 is the last resort, and it is there because 0.8 was measured NOT to be enough: on the
 * Intel UHD laptop, with the island GPU-bound after everything else was trimmed, 0.8 held 47 fps
 * and 0.65 held 58. A soft picture at the refresh rate reads better than a sharp one that judders,
 * and only a machine that already failed at 0.8 ever gets here.
 */
const DPR_LADDER = [1.5, 1.25, 1, 0.8, 0.65] as const;

/** Frames per decision window. At 60 fps this is about one second. */
const WINDOW = 60;

/** Median frame time that counts as "late" - about 48 fps. */
const SLOW_MS = 21;

/**
 * Median frame time that counts as "there is room to spare" - about 58 fps.
 *
 * Deliberately just under a 60 Hz refresh interval rather than well under it: a vsynced frame
 * cannot report better than ~16.7 ms, so anything stricter would never fire at all.
 */
const FAST_MS = 17.2;

/** Consecutive good windows before a step up is attempted. */
const GOOD_WINDOWS_TO_RECOVER = 6;

/** Minimum time between two resolution changes, and how long a change is given to settle. */
const SETTLE_MS = 1500;

/** How many times a step up may be tried before the current level is accepted as final. */
const MAX_RECOVERY_ATTEMPTS = 2;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/**
 * The starting rung: today's behaviour exactly.
 *
 * `dpr={[1, 1.5]}` clamped the display's own ratio into that range, so a 1x panel rendered at 1
 * and anything denser at 1.5. Snapping the same number onto the ladder reproduces that and gives
 * the steps below something to walk down from - including for the 1x panel, which the old range
 * had no way to help because 1 was already its floor.
 */
export function initialDpr(): number {
  const device = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const capped = Math.min(device, DPR_LADDER[0]);
  // The nearest rung at or below the device's own ratio, so we never render MORE pixels than
  // the display asked for.
  for (const rung of DPR_LADDER) if (rung <= capped + 1e-6) return rung;
  return DPR_LADDER[DPR_LADDER.length - 1];
}

export function AdaptiveResolution({
  dpr,
  onChange,
}: {
  dpr: number;
  onChange: (next: number) => void;
}) {
  const samples = useRef<number[]>([]);
  const goodWindows = useRef(0);
  const attempts = useRef(0);
  const changedAt = useRef(0);
  /** The rung a step up was made FROM, so a punished recovery knows what to lock in. */
  const recoveredFrom = useRef<number | null>(null);

  // A resolution change lands here as a prop; restart the measurement around it rather than
  // judging the new size on frames that were drawn at the old one.
  useEffect(() => {
    samples.current.length = 0;
    goodWindows.current = 0;
    changedAt.current = performance.now();
  }, [dpr]);

  useFrame((_, delta) => {
    const now = performance.now();
    if (now - changedAt.current < SETTLE_MS) return;

    const ms = delta * 1000;
    // A tab that was hidden, a long GC, a view transition mounting its own Canvas: these are
    // real hitches but they are not "this resolution is too high", and one of them would
    // otherwise drag a window's median across the threshold on its own.
    if (ms > 250) return;
    samples.current.push(ms);
    if (samples.current.length < WINDOW) return;

    const mid = median(samples.current);
    samples.current.length = 0;

    const index = DPR_LADDER.indexOf(dpr as (typeof DPR_LADDER)[number]);
    const rung = index === -1 ? 0 : index;

    if (mid > SLOW_MS) {
      goodWindows.current = 0;
      // A step down right after a step up means the step up was wrong. Stop trying.
      if (recoveredFrom.current !== null) {
        attempts.current = MAX_RECOVERY_ATTEMPTS;
        recoveredFrom.current = null;
      }
      if (rung < DPR_LADDER.length - 1) {
        changedAt.current = now;
        onChange(DPR_LADDER[rung + 1]);
      }
      return;
    }

    if (mid < FAST_MS) {
      // Enough clear windows since the last change to call the step up safe rather than lucky.
      if (++goodWindows.current >= GOOD_WINDOWS_TO_RECOVER) {
        goodWindows.current = 0;
        recoveredFrom.current = null;
        if (rung > 0 && attempts.current < MAX_RECOVERY_ATTEMPTS) {
          attempts.current++;
          recoveredFrom.current = dpr;
          changedAt.current = now;
          onChange(DPR_LADDER[rung - 1]);
        }
      }
      return;
    }

    // In between: fast enough to leave alone, not fast enough to count toward a step up.
    goodWindows.current = 0;
  });

  return null;
}
