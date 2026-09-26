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
import { getItemById } from '../../constants/items';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { useIsTouchDevice } from '../../hooks/useIsTouchDevice';
import { playerBus } from '../../lib/playerBus';
import { getPetSpec, petCompanionNoun } from '../../constants/pets';
import { playSound, SoundEffect, triggerHaptic } from '../../lib/soundUtils';
import { HintBubble } from './DesignKit';
import { PROMPT_SAFE_MARGIN } from '../../constants/hudLayout';

interface InteractionPromptProps {
  onEnterBuilding: () => void;
}

/**
 * The touch button's icon for a furniture interaction, keyed by the small closed set the catalog
 * speaks (constants/furnitureInteractions.ts's InteractionIcon).
 *
 * The catalog names an idea — 'sit', 'lie', 'book' — and this file turns it into a component, so
 * the item data never has to know which icon library the HUD is drawn with. Same separation the
 * shop's category icons already use (CategoryIcon.tsx).
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
};

// Keeps the floating badge clear of the persistent HUD chrome around the
// edges (left rail, ZoomControl, top banners, bottom NavBar). The keep-out
// margins live in constants/hudLayout.ts so they stay tied to the HUD layout
// instead of being magic numbers here — a plain screen-space clamp is enough
// since the interactable is always within a few metres of the player (see
// InteractionPromptTracker's trigger radii), so the projected point is
// normally well inside this safe zone; this only guards rare edge cases.

/**
 * Floating "above the object" interaction badge - anchored to whichever single nearest
 * interactable (building door / hammock / dog / a patch of 離線環境變化 to tidy)
 * InteractionPromptTracker.tsx (living inside the
 * Canvas, see Scene.tsx) projects into screen space each frame. This component itself never
 * touches THREE.Camera/scene: it only polls playerBus.interactionPrompt via requestAnimationFrame
 * and applies the result as a direct transform, then renders the small card/icon on top.
 *
 * Desktop shows a "[E]" key badge; touch devices show a tappable icon instead (no keyboard hint
 * makes sense on a screen with no keyboard) - the same card doubles as the actual button either
 * way, so tapping it on mobile activates the interaction directly.
 */
export function InteractionPrompt({ onEnterBuilding }: InteractionPromptProps) {
  const isTouch = useIsTouchDevice();
  const {
    currentView, nearbyBuilding, nearbyInteractable, triggerExternalAction, isWorkoutActive, profile,
    pendingPetFood,
  } = useApp();
  const wrapperRef = useRef<HTMLDivElement>(null);
  // `label` and `icon` ride along with the polled prompt rather than being derived here: what a
  // piece of furniture offers is decided once, by the scan that found it (Three/Avatar.tsx via
  // playerBus.nearbyInteraction), so the badge and the key can never end up offering different
  // things. See constants/furnitureInteractions.ts.
  const [prompt, setPrompt] = useState<{ key: string; visible: boolean; label: string; icon: string } | null>(null);

  // Polls playerBus.interactionPrompt (written every Canvas frame by InteractionPromptTracker)
  // and applies its x/y as a direct style.transform - bypassing React state for the
  // high-frequency position updates so this doesn't re-render 60x/sec. React state is only used
  // for the low-frequency fields (which target, whether it's currently visible), which is what
  // actually needs to trigger a re-render (swapping label/icon, playing the enter/exit fade).
  useEffect(() => {
    let raf: number;
    const tick = () => {
      const p = playerBus.interactionPrompt;
      if (wrapperRef.current && p) {
        const clampedX = Math.min(Math.max(p.x, PROMPT_SAFE_MARGIN.left), window.innerWidth - PROMPT_SAFE_MARGIN.right);
        const clampedY = Math.min(Math.max(p.y, PROMPT_SAFE_MARGIN.top), window.innerHeight - PROMPT_SAFE_MARGIN.bottom);
        wrapperRef.current.style.transform = `translate3d(${clampedX}px, ${clampedY}px, 0)`;
      }
      setPrompt((prev) => {
        if (!p) return prev === null ? prev : null;
        const furniture = playerBus.nearbyInteraction;
        // A resident's label changes mid-conversation (聊天 → 繼續聊天), so it rides the same
        // low-frequency comparison as a piece of furniture's verb rather than being read at render.
        const label = p.key === 'npc' ? playerBus.npcTarget?.label ?? '' : furniture?.verb ?? '';
        const icon = furniture?.icon ?? 'hand';
        if (prev && prev.key === p.key && prev.visible === p.visible
          && prev.label === label && prev.icon === icon) return prev;
        return { key: p.key, visible: p.visible, label, icon };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Both worlds. Furniture is the only thing that prompts indoors, and the badge is identical
  // there — same anchoring, same card, same key — because it is the same component driven by a
  // second tracker inside the house's Canvas (see Three/InteractionPromptTracker.tsx).
  const inPromptableView = currentView === View.HOME || currentView === View.BUILDING_INTERIOR;
  if (!inPromptableView || isWorkoutActive || !prompt) return null;

  let label = '';
  let onActivate = () => {};
  // The touch button carries the verb the badge is offering. 摸摸 and 進入 are both a hand;
  // 整理 is not, and a hand icon over 「整理這裡」 reads as petting the weeds.
  let ActionIcon = Hand;

  if (prompt.key === 'interactable') {
    // The VERB, not 「使用 <名稱>」. A badge reading 「使用 五星級雙人床」 says nothing about what
    // pressing the key will do; 「躺下」 does. The piece decides its own verb in the catalog, so
    // 沙發 offers 坐下, 許願井 offers 許願, and nothing here branches per item.
    label = prompt.label || `使用 ${nearbyInteractable ?? ''}`.trim();
    ActionIcon = INTERACTION_ICONS[prompt.icon] ?? Hand;
    // No sound here, unlike the branches below: the furniture path plays its own, in the one
    // place that knows what was activated (Three/Avatar.tsx's handleAction), so tapping the badge
    // and pressing E sound identical instead of the tap getting an extra UI click.
    onActivate = () => {
      triggerHaptic('light');
      triggerExternalAction();
    };
  } else if (prompt.key === 'dog') {
    // The 'dog' slot is whichever animal is actually standing there — read off the bus, so with
    // more than one companion out the badge names the one the player walked up to rather than
    // 「the pet」 resolved from the profile. Naming it 小狗 unconditionally called a 橘貓 a dog, so
    // the label follows that animal's own species.
    const petId = playerBus.petTargetId ?? profile?.equippedItems?.find(id => getPetSpec(id));
    // 小狗 / 小貓 / 小鳥, from the species table (constants/pets.ts) rather than from a
    // `Record<PetSpecies, string>` kept in this file — which is what it used to be. A fourth
    // species would have been called 「寵物」 on this badge until somebody remembered to add a
    // fourth row here, and this badge is the one place the animal is spoken to by name.
    const noun = petCompanionNoun(petId);
    if (pendingPetFood) {
      // 餵食模式 — the 「先選好飼料再走過去」 fast path (see UI/PetCarePanel.tsx). The SAME badge and
      // the SAME key: a companion the player is standing next to offers exactly one thing, and
      // which one is decided by whether they have already chosen a food. A second prompt competing
      // for the same corner of the screen is how 互動 and 餵食 would start covering each other and
      // the front door.
      label = `餵${noun}吃${getItemById(pendingPetFood)?.name ?? '飼料'}`;
      ActionIcon = Utensils;
      onActivate = () => {
        playSound(SoundEffect.CLICK);
        triggerHaptic('light');
        // Dispatched rather than written here, for the reason 整理 is: the write, the sound and the
        // toast belong with the component that owns the feature (UI/PetFeeding.tsx), not the badge.
        window.dispatchEvent(new CustomEvent('pet-feed'));
      };
    } else {
      // 與寵物互動 — the ordinary case, and the brief's §16. The badge offers ONE thing and it is
      // small; the choice between 餵食 and 摸摸 is inside the panel that opens
      // (UI/PetInteractionPanel.tsx), where there is room to also show the animal's name and how it
      // is doing. It used to offer 摸摸 directly, which made petting one press and feeding five —
      // and left a player who wanted to feed their pet with no way to find that out from the world.
      label = `與${noun}互動`;
      onActivate = () => {
        playSound(SoundEffect.CLICK);
        triggerHaptic('light');
        window.dispatchEvent(new CustomEvent('pet-interact'));
      };
    }
  } else if (prompt.key === 'npc') {
    // 居民（constants/npcSocial.ts）. The label comes off the bus with the target — 「與餅乾兔園丁
    // 聊天」 before the conversation, 「繼續聊天」 during it — so this file does not learn who lives
    // where. The press is an event naming WHICH resident, the same shape as the merchant's, and
    // the E key (Three/Avatar.tsx) sends the identical one: the walker that draws her decides what
    // it means, and the avatar turns to her and gestures.
    label = prompt.label || '聊天';
    ActionIcon = MessageCircle;
    onActivate = () => {
      playSound(SoundEffect.CLICK);
      triggerHaptic('light');
      const npcId = playerBus.npcTarget?.npcId;
      if (npcId) window.dispatchEvent(new CustomEvent('npc-interact', { detail: { npcId } }));
    };
  } else if (prompt.key === 'merchant') {
    // 旅行商人. The label is the MERCHANT's own (constants/merchants.ts's `prompt`), read off the
    // bus rather than written here — so a second visitor says 「與家具商人交談」 without this file
    // learning that a second visitor exists.
    //
    // MOBILE IS THIS SAME BUTTON. There is no separate touch entry point for the merchant and
    // there must not be: on a touch device the badge already IS the button (see `isTouch` below),
    // so tapping the 🛍 icon floating over his head does exactly what E does on a keyboard. That
    // is the whole of §16's mobile requirement, and it costs nothing because the merchant joined
    // the existing prompt instead of bringing its own UI.
    label = playerBus.merchantTarget?.label ?? '與旅行商人交易';
    ActionIcon = ShoppingBag;
    onActivate = () => {
      playSound(SoundEffect.CLICK);
      triggerHaptic('light');
      const merchantId = playerBus.merchantTarget?.merchantId;
      if (merchantId) {
        window.dispatchEvent(new CustomEvent('merchant-interact', { detail: { merchantId } }));
      }
    };
  } else if (prompt.key === 'tidy') {
    // 離線環境變化. The count comes off the bus rather than out of a second scan here, so the
    // number on the badge is exactly what the press will clear (see findTidyTarget). Dispatched
    // as an event for the same reason 摸摸 is: the work — the write, the sound, the toast — belongs
    // with the component that owns that feature (UI/IslandTidy.tsx), not in the badge.
    label = `整理這裡 ×${playerBus.tidyTarget?.count ?? 1}`;
    onActivate = () => {
      playSound(SoundEffect.CLICK);
      triggerHaptic('light');
      window.dispatchEvent(new CustomEvent('island-tidy'));
    };
    ActionIcon = Sprout;
  } else if (prompt.key === 'building' && nearbyBuilding) {
    label = `進入 ${nearbyBuilding.name}`;
    onActivate = onEnterBuilding;
  } else {
    return null;
  }

  return (
    <div
      ref={wrapperRef}
      className="fixed top-0 left-0 z-hud-toolbar pointer-events-none will-change-transform"
    >
      <div className="-translate-x-1/2 -translate-y-full flex flex-col items-center">
        <AnimatePresence mode="wait">
          {prompt.visible && (
            <motion.button
              key={prompt.key}
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
                <span className="text-island-navy text-sm whitespace-nowrap">{label}</span>
              </HintBubble>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
