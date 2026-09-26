/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

/**
 * `pointer: coarse` is only true on an actual touch/stylus-primary input.
 * Checking `window.innerWidth` or `'ontouchstart' in window` instead both
 * false-positive on a mouse-driven desktop — a merely narrow/undocked
 * browser window, or a Windows touchscreen laptop/all-in-one that still
 * has touch hardware but is being used with a mouse. This was previously
 * duplicated per-component with inconsistent checks, which could make two
 * "is this mobile" reads disagree at once (e.g. a narrow desktop window
 * reads as mobile by width but not by pointer type), hiding UI that
 * depended on either being true.
 */
export function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    const check = () => setIsTouch(window.matchMedia('(pointer: coarse)').matches);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return isTouch;
}
