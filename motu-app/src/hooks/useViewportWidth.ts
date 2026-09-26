/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

/**
 * Raw viewport width in px, updated on resize. Only meant to be consulted
 * for "how much further to scale up an already-confirmed-desktop layout"
 * (e.g. picking a bigger dial size on a 1920px monitor vs. a 1280px laptop
 * window) — never to decide mobile-vs-desktop on its own. That decision
 * must stay on `useIsTouchDevice()` (pointer type), since width alone
 * false-positives on touch tablets. Callers should gate use of this value
 * behind `!useIsTouchDevice()`.
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return width;
}
