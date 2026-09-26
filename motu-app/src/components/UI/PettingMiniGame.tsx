
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Heart, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { playSound, SoundEffect } from '../../lib/soundUtils';
import { playerBus } from '../../lib/playerBus';
import {
  finishPetActivity,
  patPet,
  playPetReaction,
  startPetting,
} from '../../lib/petActivity';
import { Toast } from './DesignKit';

/**
 * 摸摸 — the mini-game, and now also the start, middle and end of the animal actually being petted.
 *
 * It used to drive the pet through one boolean on the bus: `dogIsHappy = true` when the bar filled,
 * and a `setTimeout` three seconds later to set it back. That boolean had no word for 「being petted
 * right now」, so the animal kept wandering off while the player was clicking; it did not say WHICH
 * animal, so three companions would all have spun at once; and the timer ran on regardless of whether
 * the player was still on the island to see it.
 *
 * The pet's side is lib/petActivity.ts now. Starting the game starts a `petting` activity for the
 * animal the prompt was pointing at — it stays put, turns to its owner and leans in — every click is
 * a `pat` it visibly reacts to, and filling the bar ends the activity with a `happy` reaction. Closing
 * the game, leaving the island or unmounting ends it too. Nothing here waits on a timer to put the
 * animal back: an activity nobody finishes expires on its own clock (`petActivityExpired`).
 *
 * The avatar hears the same beats as a `pet-care-gesture` event and crouches to the animal — see
 * Three/Avatar.tsx.
 */
export function PettingMiniGame() {
  const { petDog, currentView } = useApp();
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showReward, setShowReward] = useState(false);
  const [rewardResult, setRewardResult] = useState<{ rewarded: boolean; remaining: number } | null>(null);
  /** The animal this round is about, captured when it starts — see PetInteractionPanel for why. */
  const petRef = useRef<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const stopPetting = useCallback(() => {
    if (petRef.current) finishPetActivity(petRef.current);
    petRef.current = null;
  }, []);

  const handlePet = useCallback(() => {
    if (!isPlaying) {
      setIsPlaying(true);
      setProgress(0);
      const pet = playerBus.petTargetId ?? null;
      if (pet && startPetting(pet)) {
        petRef.current = pet;
        window.dispatchEvent(new CustomEvent('pet-care-gesture', { detail: { kind: 'petting', petItemId: pet } }));
      }
      return;
    }

    if (petRef.current) {
      patPet(petRef.current);
      window.dispatchEvent(new CustomEvent('pet-care-gesture', { detail: { kind: 'pat', petItemId: petRef.current } }));
    }

    setProgress(prev => {
      const next = prev + 10;
      if (next >= 100) {
        // Win!
        setIsPlaying(false);

        // The animal's delight is its own reaction now (a couple of hops, tail going, a happy
        // noise in its own species' voice — Three/IslandPet.tsx), whether or not gold is left today.
        const pet = petRef.current;
        stopPetting();
        if (pet) playPetReaction(pet, 'happy');

        petDog().then(result => {
          setRewardResult(result);
          setShowReward(true);
          if (result.rewarded) {
            playSound(SoundEffect.SUCCESS);
          }

          if (toastTimer.current) window.clearTimeout(toastTimer.current);
          // Only the toast is on a timer. The pet's side ended the moment the bar filled.
          toastTimer.current = window.setTimeout(() => setShowReward(false), 3000);
        });

        return 0;
      }
      return next;
    });
  }, [isPlaying, petDog, stopPetting]);

  // Decay progress over time
  useEffect(() => {
    if (isPlaying) {
      const decay = setInterval(() => {
        setProgress(p => Math.max(0, p - 2));
      }, 100);
      return () => clearInterval(decay);
    }
  }, [isPlaying]);

  // InteractionPrompt.tsx (desktop AND mobile/tablet, both now unified there) dispatches this
  // instead of this component rendering its own idle "摸摸小狗" button — same start-the-game
  // entry point, just triggered from the floating prompt anchored above the dog instead of a
  // dedicated fixed-position button.
  useEffect(() => {
    const onStartPetDog = () => handlePet();
    window.addEventListener('start-pet-dog', onStartPetDog);
    return () => window.removeEventListener('start-pet-dog', onStartPetDog);
  }, [handlePet]);

  // Leaving the island mid-round is the round ending: the animal must not be left 「being petted」
  // by nobody. The same on unmount.
  useEffect(() => {
    if (currentView !== 'home' && isPlaying) {
      setIsPlaying(false);
      stopPetting();
    }
  }, [currentView, isPlaying, stopPetting]);
  useEffect(() => () => {
    stopPetting();
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, [stopPetting]);

  if (currentView !== 'home') return null;

  return (
    // Placed (bottom, centred, above the NavBar) by the `bottom-center` HUD
    // region (HudFrame.tsx) — no longer `fixed bottom-32 left-[88px]` (that
    // left offset was hand-tuned to clear the SideButtons column). The grid
    // keeps it centred on the viewport and clear of the left rail at any
    // width; `relative` keeps the z-hud-topbar tier for local stacking.
    <div className="relative z-hud-topbar pointer-events-none flex flex-col items-center">
      <AnimatePresence>
        {isPlaying && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-4 bg-island-cream p-6 rounded-[2rem] shadow-[0_20px_50px_rgba(38,70,83,0.22)] border border-island-line relative pointer-events-auto"
          >
            {/* Exit/Close Button */}
            <button
              onClick={() => {
                playSound(SoundEffect.CLICK);
                setIsPlaying(false);
                stopPetting();
              }}
              className="absolute top-2 right-2 w-10 h-10 bg-island-coral/12 hover:bg-island-coral/20 text-island-coral flex items-center justify-center rounded-full transition-all cursor-pointer pointer-events-auto active:scale-95 z-50"
              title="結束互動"
            >
              <X size={18} strokeWidth={3} />
            </button>

            <div className="text-island-coral flex gap-1 pt-2">
              {[1, 2, 3].map(i => (
                <motion.div
                  key={i}
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.2 }}
                >
                  <Heart fill="currentColor" />
                </motion.div>
              ))}
            </div>

            <div className="w-52 sm:w-64 h-6 bg-island-cream-2 rounded-full overflow-hidden border border-island-line">
              <motion.div
                className="h-full bg-gradient-to-r from-island-coral to-island-coral/80"
                animate={{ width: `${progress}%` }}
              />
            </div>

            <button
              onClick={handlePet}
              className="pointer-events-auto bg-island-coral hover:bg-island-coral/90 text-white px-8 sm:px-12 py-4 sm:py-5 rounded-[2rem] font-black shadow-[0_15px_40px_rgba(232,131,106,0.35)] active:scale-95 hover:-translate-y-0.5 transition-all uppercase tracking-widest text-2xl sm:text-3xl whitespace-nowrap"
            >
              PET IT!
            </button>
            <p className="text-island-coral font-bold animate-pulse">連點摸摸它！</p>
          </motion.div>
        )}
      </AnimatePresence>

      <Toast
        visible={showReward && !!rewardResult}
        accent={rewardResult?.rewarded ? 'gold' : 'coral'}
        position="inline"
      >
        {rewardResult?.rewarded ? (
          <>
            <span className="text-2xl">💰</span>
            <span>+20 Gold / +10 XP!</span>
          </>
        ) : (
          // 牠 rather than 狗狗: the animal being petted is whichever pet is equipped (see
          // Three/IslandPet.tsx), which is a cat or a bird as often as a dog.
          <span>今日獎勵已領完，牠還是好開心！</span>
        )}
        <Heart fill="white" size={16} />
      </Toast>
    </div>
  );
}
