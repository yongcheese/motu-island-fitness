/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Utensils, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { getItemById } from '../../constants/items';
import { FEED_PET_MESSAGES } from '../../context/usePetCare';
import { playerBus } from '../../lib/playerBus';
import { startEating } from '../../lib/petActivity';
import { playSound, SoundEffect, triggerHaptic } from '../../lib/soundUtils';
import { HintBubble, Toast } from './DesignKit';

/**
 * 餵食 — the island half of the feeding flow, and the one place a feed actually happens.
 *
 * Mounted beside UI/IslandTidy.tsx in the bottom-centre HUD region and built exactly the same way,
 * because it is the same shape of thing: the floating badge (UI/InteractionPrompt.tsx) and the E key
 * (Three/Avatar.tsx) both just dispatch `pet-feed`, and the feature that owns the write owns the
 * whole of what happens next. The two triggers therefore cannot drift apart, and neither of them has
 * to know that feeding is a save.
 *
 * ## What is on screen, and what deliberately is not
 *
 * While a food is armed: one small line saying so, with a way out of it. That is all. There is no
 * hunger meter, no bowl icon over the animal, and no badge on the nav — the pet's condition is
 * legible from how it is behaving, and the numbers live behind a button in 我的寵物
 * (UI/PetCarePanel.tsx). See the brief's §14: the goal is a companion you notice, not a survival HUD.
 *
 * The line disappears the moment the feed lands, so the ordinary state of the screen — the one a
 * player is in almost all of the time — carries nothing from this feature at all.
 *
 * ## Why the failure case says something
 *
 * `feedPet` reports why it refused, and every reason is a sentence in FEED_PET_MESSAGES
 * (context/usePetCare.ts). A player whose save was rejected has to be told the food is still theirs,
 * or a bag that appears not to have been spent reads as a bag that was lost — the same reasoning
 * UI/IslandTidy.tsx gives for saying so when a tidy fails to persist.
 */
export function PetFeeding() {
  const { currentView, pendingPetFood, cancelPetFeeding, feedPet } = useApp();
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  /** Guards a double-fire — a tap on the badge and the E key can land in the same tick. */
  const busyRef = useRef(false);
  const hideTimer = useRef<number | null>(null);

  const announce = useCallback((text: string, ok: boolean) => {
    setToast({ text, ok });
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => {
    const onFeed = async (event: Event) => {
      if (busyRef.current) return;
      /**
       * Two ways in, one handler.
       *
       * The interaction panel (UI/PetInteractionPanel.tsx) names both the food and the animal,
       * because the player picked a food while standing in front of a particular pet. The E key and
       * the floating badge name neither: they are the 「先選好飼料再走過去」 fast path, so the food is
       * whatever was armed and the animal is whichever one the prompt is pointing at
       * (`playerBus.petTargetId`). Both end up in the same call.
       */
      const detail = (event as CustomEvent<{ itemId?: string; petItemId?: string }>).detail;
      const itemId = detail?.itemId ?? pendingPetFood;
      const petItemId = detail?.petItemId ?? playerBus.petTargetId;
      if (!itemId) return;
      busyRef.current = true;
      try {
        const result = await feedPet(itemId, petItemId);
        if (result.ok) {
          // 進食 — started only now, on a save that was actually accepted (§20). An animation kicked
          // off at the click would have a pet happily eating a meal that failed to persist, which is
          // the same lie as spending the bag optimistically.
          //
          // It is an ACTIVITY now rather than a timestamp (lib/petActivity.ts): the owner bends to put
          // a bowl down, the animal walks over to it, eats until it is empty, and the bowl fades —
          // all drawn by Three/IslandPet.tsx. The avatar hears `pet-care-gesture` and crouches.
          startEating(result.petItemId);
          window.dispatchEvent(new CustomEvent('pet-care-gesture', {
            detail: { kind: 'feed', petItemId: result.petItemId },
          }));
          // What it ACTUALLY moved, not what the item promised: a nearly full bowl takes only the
          // room it has (see applyPetCareEffects), and a toast that reported the promise would be
          // telling the player something the animal did not experience.
          const gained = Math.round(result.delta.nutrition * 100);
          // The animal by name, because with more than one companion 「牠」 does not say which one
          // just ate. Falls back to 牠 for anything the catalog cannot name.
          const who = getItemById(result.petItemId)?.name ?? '牠';
          playSound(SoundEffect.SUCCESS, 0.3);
          triggerHaptic('light');
          announce(gained > 0 ? `${who}吃得很開心（營養 +${gained}%）` : `${who}開心地吃完了`, true);
        } else {
          announce(FEED_PET_MESSAGES[result.reason], false);
        }
      } finally {
        busyRef.current = false;
      }
    };

    window.addEventListener('pet-feed', onFeed);
    return () => window.removeEventListener('pet-feed', onFeed);
  }, [pendingPetFood, feedPet, announce]);

  useEffect(
    () => () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    },
    [],
  );

  if (currentView !== View.HOME) return null;

  const food = pendingPetFood ? getItemById(pendingPetFood) : undefined;

  return (
    <div className="relative z-hud-topbar pointer-events-none flex flex-col items-center gap-2">
      <AnimatePresence>
        {food && (
          <motion.div
            key="armed"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <HintBubble variant="solid" className="rounded-2xl px-4 py-2 flex items-center gap-2.5">
              <Utensils size={14} strokeWidth={2.75} className="flex-shrink-0" />
              <span className="text-xs font-black whitespace-nowrap">
                走到寵物旁邊，餵牠吃{food.name}
              </span>
              <button
                onClick={() => {
                  playSound(SoundEffect.CLICK);
                  cancelPetFeeding();
                }}
                className="pointer-events-auto w-6 h-6 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors active:scale-90 flex-shrink-0"
                title="取消餵食"
              >
                <X size={13} strokeWidth={3} />
              </button>
            </HintBubble>
          </motion.div>
        )}
      </AnimatePresence>

      <Toast visible={!!toast} accent={toast?.ok ? 'teal' : 'coral'} position="inline">
        <Utensils size={16} />
        <span>{toast?.text}</span>
      </Toast>
    </div>
  );
}
