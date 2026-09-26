/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef } from 'react';

/**
 * Storm lightning flash timer/decay state machine — previously duplicated
 * independently in SkyDome, Scene (lighting), and Clouds, each keeping its
 * own `lightningIntensity`/`nextLightningTime` refs. Note this dedup does
 * NOT make the three flashes fire in sync with each other (each caller
 * still gets its own refs and its own `Math.random()` roll for the next
 * strike time, same as before) — the call sites' comments claim they're
 * synced but never actually shared state, so this only removes the
 * duplicated boilerplate without changing that pre-existing behavior.
 *
 * Call once per frame with the elapsed clock time and whether the current
 * weather is a storm; returns the flash intensity for that frame (0 when
 * not flashing), scaled between `flickerLow`/`flickerHigh` to match each
 * caller's own flicker feel.
 */
export function useLightningFlicker() {
  const lightningIntensity = useRef(0);
  const nextLightningTime = useRef(0);

  return useCallback((elapsed: number, isStorm: boolean, flickerHigh: number, flickerLow: number): number => {
    if (!isStorm) {
      lightningIntensity.current = 0;
      return 0;
    }
    if (elapsed > nextLightningTime.current) {
      lightningIntensity.current = 1.0;
      nextLightningTime.current = elapsed + 4 + Math.random() * 8;
    }
    if (lightningIntensity.current <= 0) return 0;
    const flicker = Math.sin(elapsed * 40) > 0 ? flickerHigh : flickerLow;
    const flashVal = lightningIntensity.current * flicker;
    lightningIntensity.current -= 0.05;
    return flashVal;
  }, []);
}
