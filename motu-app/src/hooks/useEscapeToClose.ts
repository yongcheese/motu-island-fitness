/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';

/**
 * Closes a modal/panel on the Escape key. `enabled` lets the caller gate
 * this on whether the panel is actually open/mounted, matching the
 * conditional-listener pattern each modal in this codebase already used
 * individually before this was pulled out into one place.
 */
export function useEscapeToClose(onEscape: () => void, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onEscape();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onEscape]);
}
