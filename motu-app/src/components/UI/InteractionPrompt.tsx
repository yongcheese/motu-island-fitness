/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Armchair, Bath, BedDouble, BookOpen, Brush, DoorOpen, Droplets, Eye, Flame, Hand, MessageCircle,
  Power, ShoppingBag, Sparkles, Sprout, Utensils, Wind,
} from 'lucide-react';
import { useAppPick } from '../../context/AppContext';
import { View } from '../../types';
import { useIsTouchDevice } from '../../hooks/useIsTouchDevice';
import { playerBus } from '../../lib/playerBus';
import { triggerHaptic } from '../../lib/soundUtils';
import { HintBubble } from './DesignKit';
import { PROMPT_SAFE_MARGIN } from '../../constants/hudLayout';

/**
 * The touch button's icon, keyed by the small closed set the targets speak: the catalog's
 * InteractionIcon for furniture (constants/furnitureInteractions.ts), plus the handful the other
 * sources name (the door, a resident, the shop, 整理).
 *
 * The data names an idea — 'sit', 'lie', 'book' — and this file turns it into a component, so no
 * target ever has to know which icon library the HUD is drawn with.
 */
const INTERACTION_ICONS: Record<string, typeof Hand> = {
  sit: Armchair,
  lie: BedDouble,
  bath: Bath,
  hand: Hand,
  door: DoorOpen,
  panel: Power,
  cook: Utensils,
  droplet: Droplets,
  eye: Eye,
  book: BookOpen,
  sparkle: Sparkles,
  flame: Flame,
  brush: Brush,
  push: Wind,
  chat: MessageCircle,
  shop: ShoppingBag,
  sprout: Sprout,
};

/**
 * The floating 「E …」 badge — a VIEW of `playerBus.interactionTarget`, and nothing more.
 *
 * Everything it shows comes off that one object, which the targeting pass
 * (Three/InteractionPromptTracker.tsx → lib/interactionTargeting.ts) selects each frame:
 *
 *   the text        target.label   — the verb: 「坐下」, 「進入 我的家」, 「與小狗互動」
 *   the icon        target.icon
 *   where it sits   playerBus.interactionPrompt — the target's Interaction Point, projected
 *   what it does    the SAME handler the E key runs (Three/Avatar.tsx's handleAction, reached
 *                   through triggerExternalAction), which executes target.action
 *
 * It used to branch on the target's category here — building / dog / npc / merchant / tidy /
 * furniture — and dispatch each one itself, with its own copy of every condition (the pet's feed
 * mode, which merchant, which resident) that the E key also had to get identical. Two copies of
 * "what does this press do" is how a badge and a key come to disagree; now there is one.
 *
 * Desktop shows an [E] key cap; touch devices show the action's icon instead, and the card itself
 * is the button.
 */
export function InteractionPrompt() {
  const isTouch = useIsTouchDevice();
  const { currentView, triggerExternalAction, isWorkoutActive } = useAppPick(
    'currentView', 'triggerExternalAction', 'isWorkoutActive',
  );
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [prompt, setPrompt] = useState<{ id: string; kind: string; label: string; icon: string } | null>(null);

  // Polls the bus every animation frame. The position is applied as a direct transform (60 Hz,
  // no React); React state holds only what needs a re-render — which target, and its text — so
  // the badge re-renders when the target or its verb changes and not otherwise.
  useEffect(() => {
    let raf: number;
    const tick = () => {
      const target = playerBus.interactionTarget;
      const p = playerBus.interactionPrompt;
      if (wrapperRef.current && p) {
        const clampedX = Math.min(Math.max(p.x, PROMPT_SAFE_MARGIN.left), window.innerWidth - PROMPT_SAFE_MARGIN.right);
        const clampedY = Math.min(Math.max(p.y, PROMPT_SAFE_MARGIN.top), window.innerHeight - PROMPT_SAFE_MARGIN.bottom);
        wrapperRef.current.style.transform = `translate3d(${clampedX}px, ${clampedY}px, 0)`;
      }
      setPrompt((prev) => {
        if (!target || !p) return prev === null ? prev : null;
        if (prev && prev.id === target.id && prev.label === target.label && prev.icon === target.icon) return prev;
        return { id: target.id, kind: target.kind, label: target.label, icon: target.icon };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Both worlds: the badge is identical indoors, driven by a second tracker in the house's Canvas.
  const inPromptableView = currentView === View.HOME || currentView === View.BUILDING_INTERIOR;
  if (!inPromptableView || isWorkoutActive || !prompt) return null;

  const ActionIcon = INTERACTION_ICONS[prompt.icon] ?? Hand;
  const onActivate = () => {
    triggerHaptic(prompt.kind === 'building' ? 'double' : 'light');
    // Exactly what the E key does — see the doc above. No sound here: the action plays its own,
    // in the one place that knows what was activated, so a tap and a key press sound the same.
    triggerExternalAction();
  };

  return (
    <div
      ref={wrapperRef}
      className="fixed top-0 left-0 z-hud-toolbar pointer-events-none will-change-transform"
    >
      <div className="-translate-x-1/2 -translate-y-full flex flex-col items-center">
        <AnimatePresence mode="wait">
          <motion.button
            key={prompt.id}
            initial={{ opacity: 0, y: 8, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.85 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.94 }}
            onClick={onActivate}
            className="pointer-events-auto flex flex-col items-center gap-1.5 cursor-pointer group"
          >
            <HintBubble
              nub="arrow"
              className="px-4 py-2.5 flex items-center gap-2.5 group-hover:shadow-[0_8px_26px_rgba(38,70,83,0.24)] transition-shadow"
            >
              {isTouch ? (
                <span className="w-8 h-8 rounded-full bg-island-teal flex items-center justify-center shadow-[0_2px_6px_rgba(38,70,83,0.2)] flex-shrink-0">
                  <ActionIcon size={16} strokeWidth={2.5} className="text-white" />
                </span>
              ) : (
                <span className="w-7 h-7 bg-island-cream-2 rounded-lg flex items-center justify-center font-mono border border-island-line shadow-[0_2px_6px_rgba(38,70,83,0.12)] text-sm text-island-navy flex-shrink-0">
                  E
                </span>
              )}
              <span className="text-island-navy text-sm whitespace-nowrap">{prompt.label}</span>
            </HintBubble>
          </motion.button>
        </AnimatePresence>
      </div>
    </div>
  );
}
