/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sprout } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { playerBus } from '../../lib/playerBus';
import { playSound, SoundEffect, triggerHaptic } from '../../lib/soundUtils';
import { Toast } from './DesignKit';

/**
 * 整理 — the one thing the player does about 離線環境變化.
 *
 * Mounted beside PettingMiniGame in the bottom-centre HUD region and built the same way: the
 * floating badge (UI/InteractionPrompt.tsx) and the E key (Three/Avatar.tsx) both just dispatch
 * `island-tidy`, and the feature that owns the write owns the whole of what happens next. The two
 * triggers therefore cannot drift apart, and neither of them has to know that tidying is a save.
 *
 * ## Why there is no reward
 *
 * Deliberate, and the single most important line in this file. Paying for tidying would turn a
 * pleasant thing to do into a thing the player is behind on — and would make being away from the
 * island a way to farm it, which is the exact inversion of a system whose whole premise is that
 * nothing is lost by leaving. The payoff for coming back is that the island is yours to put right.
 *
 * ## Why the failure case says something
 *
 * `tidyIslandAt` returns how many pieces went, and a refused write returns zero after rolling the
 * optimistic removal back — so a player on a broken connection watches the weeds reappear. Saying
 * so, quietly, is the difference between a save problem and a button that does not work: the same
 * reasoning as the 管理員數值調整 buttons (components/UI/AdminValueControls.tsx).
 */
export function IslandTidy() {
  const { currentView, tidyIslandAt } = useApp();
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  /** Guards a double-fire — a tap on the badge and the E key can land in the same tick. */
  const busyRef = useRef(false);
  const hideTimer = useRef<number | null>(null);

  const announce = useCallback((text: string, ok: boolean) => {
    setToast({ text, ok });
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    const onTidy = async (event: Event) => {
      if (busyRef.current) return;
      // The patch the prompt was pointing at, carried by the press itself (the selected target's
      // action — see lib/interactionTargeting.ts). Copied now: the tracker rewrites its record
      // every frame, and this handler awaits a save.
      const detail = (event as CustomEvent<{ x?: number; z?: number }>).detail;
      const target = detail?.x !== undefined && detail?.z !== undefined
        ? { x: detail.x, z: detail.z }
        : playerBus.tidyTarget;
      if (!target) return;
      busyRef.current = true;
      try {
        const removed = await tidyIslandAt(target.x, target.z);
        if (removed > 0) {
          playSound(SoundEffect.SUCCESS, 0.3);
          triggerHaptic('light');
          announce(`整理好了 ×${removed}`, true);
        } else {
          announce('這次沒有存檔成功，等一下再試試', false);
        }
      } finally {
        busyRef.current = false;
      }
    };

    window.addEventListener('island-tidy', onTidy);
    return () => window.removeEventListener('island-tidy', onTidy);
  }, [tidyIslandAt, announce]);

  useEffect(
    () => () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    },
    [],
  );

  if (currentView !== View.HOME) return null;

  return (
    <div className="relative z-hud-topbar pointer-events-none flex flex-col items-center">
      <Toast visible={!!toast} accent={toast?.ok ? 'teal' : 'coral'} position="inline">
        <Sprout size={16} />
        <span>{toast?.text}</span>
      </Toast>
    </div>
  );
}
