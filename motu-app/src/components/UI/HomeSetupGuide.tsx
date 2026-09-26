/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { Home, MapPin, Sparkles } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { CameraMode, View } from '../../types';
import { FIRST_PERSON_ZOOM, THIRD_PERSON_ZOOM } from '../../constants/cameraZoom';
import { hasPlacedHome } from '../../hooks/usePlayerHome';
import { STARTER_HOUSE_ITEM_ID, getHouseStyle } from '../../constants/houseStyles';
import { playSound, SoundEffect, triggerHaptic } from '../../lib/soundUtils';
import { ModalOverlay, ModalShell, PanelHeader, Button, IconTile, MODAL_ABOVE_DOCK } from './DesignKit';
import { ONBOARDING_MODAL_CLASS, useOnboardingSlot } from '../../lib/onboardingQueue';

/**
 * First-time guidance for establishing the player's Home.
 *
 * Shows exactly when the player holds the Starter House but hasn't placed it — i.e. the
 * condition *is* the game state, so there's no "have they seen it?" flag to persist and no way
 * for it to reappear once the Home exists. Dismissing it only hides it for the session; the
 * player is nudged again next login until they actually place their home.
 *
 * That "no flag, ask the world" design is deliberate and stays — but it does mean this guide
 * cannot end until `placeHome` actually lands, so a save the server refuses reads from here as a
 * tutorial that will not stop asking. It looked like a tutorial loop; it was a rejected write
 * with nothing reporting it. The fix belongs at the two ends, not here: the write layer now
 * returns its failure instead of throwing it away (lib/firebase.ts) and the placement session
 * says so out loud (IslandEditorOverlay / PlacementGhost). Do NOT "fix" a recurrence of this by
 * adding a seen-flag here — that would hide a broken save behind a tutorial that quietly gave up.
 */
export function HomeSetupGuide() {
  const {
    profile, currentView, setCurrentView, setActivePlacementItem, activePlacementItem,
    setCameraMode, setUiScale,
  } = useApp();
  const [dismissed, setDismissed] = useState(false);

  const holdsStarterHouse = !!profile?.inventory?.includes(STARTER_HOUSE_ITEM_ID);
  const needsHome = !!profile && !hasPlacedHome(profile) && holdsStarterHouse;

  // Once the Home exists, reset local dismissal so a later Home-less state (only reachable via
  // a data reset) would guide again rather than staying silently suppressed.
  useEffect(() => {
    if (!needsHome) setDismissed(false);
  }, [needsHome]);

  // Last in the first-run queue (lib/onboardingQueue.ts): the login bonus is
  // cleared and the 新手引導 has walked the HUD before this asks for a decision
  // about the island. Nothing is lost by waiting — the condition above IS the
  // game state, so the moment the step ahead finishes this appears on its own.
  //
  // `activePlacementItem` is part of the claim, not just of `isVisible`: once
  // the player has armed the house the guide has handed over to the placement
  // system, and while a session is running it must not still be holding the
  // onboarding slot against whatever comes next.
  const isVisible = useOnboardingSlot(
    'homeSetup',
    needsHome && !dismissed && currentView === View.HOME && activePlacementItem === null,
  );
  const starterStyle = getHouseStyle('starter');

  const handleStart = () => {
    playSound(SoundEffect.CLICK);
    triggerHaptic('medium');
    // Arms the placement ghost and stays on the island view. The editing panel
    // (IslandEditorOverlay) with its "drag / R to rotate / double-click to confirm" copy follows
    // the session rather than the view, so the house is sited with instructions on screen here
    // exactly as it would be in build mode. If they cancel, build mode still offers the Starter
    // House as its only placeable item until the Home exists.
    // Third person for the siting itself. AppContext already puts a Home-less player's camera here
    // when their profile loads, so this is the second half of that guarantee rather than a repeat
    // of it: the player may have gone first-person in between, and this button is the exact moment
    // the game asks them to look at a plot of ground and a house they cannot see from inside their
    // own head. Only a zoom that is genuinely in the first-person band is touched.
    setCameraMode(CameraMode.THIRD_PERSON);
    setUiScale(prev => (prev >= FIRST_PERSON_ZOOM ? THIRD_PERSON_ZOOM : prev));
    setActivePlacementItem(STARTER_HOUSE_ITEM_ID);
    setCurrentView(View.HOME);
    setDismissed(true);
  };

  const handleLater = () => {
    playSound(SoundEffect.CLICK);
    setDismissed(true);
  };

  return (
    <AnimatePresence>
      {/* ONBOARDING_MODAL_CLASS marks this as a first-run scrim, so the 新手引導's
          "is a blocking dialog up?" probe doesn't mistake the guide queued behind
          it for a reason to stand down — the two are sequenced by the queue, not
          by the DOM. */}
      {isVisible && (
        <ModalOverlay className={`${ONBOARDING_MODAL_CLASS} ${MODAL_ABOVE_DOCK}`} onClick={handleLater}>
          <ModalShell maxWidthClassName="max-w-md">
            <PanelHeader
              icon={<Home size={20} strokeWidth={2.5} />}
              title="你的第一棟房屋"
              subtitle="歡迎來到你的島嶼"
              onClose={handleLater}
            />

            <div className="p-6 md:p-8 flex flex-col gap-5 text-left">
              <div className="flex items-start gap-4">
                <IconTile size={56} active className="text-island-teal-dark shrink-0">
                  <MapPin size={24} strokeWidth={2.5} />
                </IconTile>
                <p className="text-sm font-bold text-island-navy leading-relaxed pt-1">
                  這是你的第一棟房屋「{starterStyle.name}」，
                  請找一個喜歡的位置放置它，那裡就會成為你的家。
                </p>
              </div>

              <div className="bg-island-cream-2 border border-island-line rounded-2xl p-4 flex items-start gap-3">
                <Sparkles size={16} className="text-island-gold shrink-0 mt-0.5" strokeWidth={2.5} />
                <p className="text-xs font-bold text-island-navy-soft leading-relaxed">
                  之後在商店購買的房屋外觀，都會直接套用到這個家上，
                  你的家具、室內與收納都會完整保留。
                </p>
              </div>

              <div className="flex gap-3 pt-1">
                <Button variant="secondary" onClick={handleLater} className="flex-1 py-3 text-sm">
                  稍後再說
                </Button>
                <Button variant="primary" onClick={handleStart} className="flex-1 py-3 text-sm">
                  <MapPin size={16} strokeWidth={2.5} />
                  <span>開始放置我的家</span>
                </Button>
              </div>
            </div>
          </ModalShell>
        </ModalOverlay>
      )}
    </AnimatePresence>
  );
}
