/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { useApp, AppProvider } from './context/AppContext';
import { View } from './types';
import { Scene } from './components/Three/Scene';
import { TopBar } from './components/UI/TopBar';
import { WeatherToast } from './components/UI/WeatherToast';
import { SideButtons } from './components/UI/SideButtons';
import { LuckyWheel } from './components/UI/LuckyWheel';
import { NavBar } from './components/UI/NavBar';
import { MusicPlayer } from './components/UI/MusicPlayer';
import { MobileControls } from './components/UI/MobileControls';
import { AuthScreen } from './components/UI/AuthScreen';
import { ControlsHint } from './components/UI/ControlsHint';
import { MiniMap } from './components/UI/MiniMap';
import { PettingMiniGame } from './components/UI/PettingMiniGame';
import { IslandTidy } from './components/UI/IslandTidy';
import { PetFeeding } from './components/UI/PetFeeding';
import { PetInteractionPanel } from './components/UI/PetInteractionPanel';
import { IslandReturnPanel } from './components/UI/IslandReturnPanel';
import { DailyLoginPanel, DailyLoginButton } from './components/UI/DailyLoginPanel';
import { WorkoutRewardPopup } from './components/UI/WorkoutRewardPopup';
import { HomeSetupGuide } from './components/UI/HomeSetupGuide';
import { NewbieTour } from './components/UI/NewbieTour';
import { IslandEditorOverlay } from './components/UI/IslandEditorOverlay';
import { BuildModeOverlay } from './components/UI/BuildModeOverlay';
import { InteractionPrompt } from './components/UI/InteractionPrompt';
import { NpcSpeechBubble } from './components/UI/NpcSpeechBubble';
import { MerchantSession } from './components/UI/MerchantSession';
import { LightSwitchPrompt } from './components/UI/LightSwitchPrompt';
import { HudFrame, HudRegion } from './components/UI/HudFrame';
import { AdminOnly } from './components/UI/AdminOnly';
import { AdminTestProvider } from './components/UI/admin/AdminTestContext';
import { AdminTestConsole } from './components/UI/admin/AdminTestConsole';
import { AdminTestLauncher } from './components/UI/admin/AdminTestLauncher';
import { AdminZoomDial } from './components/UI/admin/AdminZoomDial';
import { AdminMerchantDock } from './components/UI/admin/AdminMerchantDock';
import { SettingsView } from './components/SettingsView';
import { FitnessHost } from './components/fitness/FitnessHost';
import { ShopView } from './components/ShopView';
import { LimitedShopView } from './components/LimitedShopView';
import { DressingRoomView } from './components/DressingRoomView';
import { HealthView } from './components/health/HealthView';
import { BuildingInteriorView } from './components/BuildingInteriorView';
import { motion, AnimatePresence } from 'motion/react';
import { LoadingScreen } from './components/UI/LoadingScreen';
import { db, doc, updateDoc } from './lib/firebase';
import { installDirectWheelScroll } from './lib/wheelScroll';
import { playDoorOpen, playDoorClose, setAmbienceVolume } from './lib/soundUtils';
/**
 * See the "GLOBAL Z-INDEX LAYER SYSTEM" comment block at the top of
 * src/index.css for the authoritative Background / Game View / HUD /
 * Floating Panel / Toast / Modal / Loading layer reference — every
 * `position: fixed/absolute` element in this file (and anywhere else in the
 * app) should use one of those classes, not a raw z-[N] value or a
 * component-local guess. This file is the layer's main consumer: `<Scene />`
 * is z-background, the "View Overlays" block below is always z-game-view
 * (never conditionally elevated — see the class comment for why raising a
 * whole Game View to beat HUD was the exact bug that made MiniMap invisible
 * inside the house), the persistent chrome block is z-hud-*, and
 * BuildingInteriorView's own floating dialogs are portaled to
 * `document.body` (see BuildingInteriorView.tsx's `PORTAL_ROOT` usage) so
 * they can use z-floating-panel and actually beat HUD without needing their
 * parent Game View raised.
 */
function AppContent() {
  const { 
    user, loading, currentView, isWorkoutActive, isGameLoading, setIsGameLoading,
    islandAlert, nearbyBuilding, settings, islandDraft
  } = useApp();

  /**
   * Whether the house's 3D layer exists yet — the 「開門中」 wait, decided one step earlier.
   *
   * The house is a SECOND WebGL context: its own renderer, its own environment map, and its own
   * copy of every shader program the room needs, none of which can be shared with the island's
   * canvas that is already running behind it. That work is what the doorway veil was covering,
   * and it was being paid IN FULL ON EVERY ENTRY — mounting the view on `currentView` meant
   * walking out of the house threw the whole context away, so the second visit cost exactly as
   * much as the first (measured: ~6.8s, ~6.3s, ~6.9s on a software renderer).
   *
   * Two changes, one flag. It is mounted as soon as the player is AT THEIR DOOR rather than when
   * they open it, so the compile happens while they are standing on the doorstep instead of after
   * the press; and once mounted it stays, so every later entry is free. While it is not the
   * current view it is hidden and its render loop is idled (see BuildingInteriorView's `active`),
   * which is why keeping it costs a WebGL context and no frames.
   *
   * `nearbyBuilding` is the same signal the 「進入我的家」 prompt is drawn from, so the warm-up
   * starts exactly when entering becomes possible and never for a player who is nowhere near.
   */
  const [interiorMounted, setInteriorMounted] = useState(false);
  const isInsideHouse = currentView === View.BUILDING_INTERIOR;
  /**
   * Whether the persistent HUD grid is on screen. Named rather than repeated because two things
   * now depend on it: the frame itself, and the 【管理員測試】 handle, which rides inside the
   * frame's right-edge column when there IS one and falls back to a fixed edge position when
   * there is not (see UI/admin/AdminTestLauncher.tsx). Written once so the two can never disagree
   * and show the handle twice, or neither time.
   */
  const hudFrameMounted =
    !isWorkoutActive && (currentView === View.HOME || currentView === View.BUILDING_INTERIOR);
  useEffect(() => {
    if (nearbyBuilding || isInsideHouse) setInteriorMounted(true);
  }, [nearbyBuilding, isInsideHouse]);

  // Front-door sound for crossing the house threshold.
  //
  // Driven off the view transition rather than from the places that trigger it, because there
  // is more than one: the action key / entry badge (Avatar.tsx's handleAction), and
  // the interior's own exit control all move between HOME and BUILDING_INTERIOR. Watching the
  // resulting state change catches every path, including any added later, and cannot double-fire
  // when two of them run in the same tick.
  //
  // The two directions get DIFFERENT cues. Both used to play the opening sound, which is what
  // made walking out of the house sound wrong: you hear a door swing open at the exact moment
  // you have finished going through one. Going out now plays only the door shutting behind you.
  const prevViewRef = useRef(currentView);
  useEffect(() => {
    const prev = prevViewRef.current;
    prevViewRef.current = currentView;
    if (prev === currentView) return;

    const wasInside = prev === View.BUILDING_INTERIOR;
    const isInside = currentView === View.BUILDING_INTERIOR;
    // Only the two transitions that actually cross the threshold - switching between, say, the
    // shop and the interior is not a door.
    if (wasInside === isInside) return;

    if (isInside) {
      playDoorOpen(0.4);   // going in: the front door opens for you
    } else {
      playDoorClose(0.34); // coming out: no open cue, just the door closing behind you
    }
  }, [currentView]);

  // The mouse wheel over any scrollable panel in the app, handled in one place rather than
  // left to the browser's ~100ms scroll animation - see lib/wheelScroll.ts for why that
  // animation is what reads as the panels lagging behind the wheel, and for how this stays
  // out of the way of the horizontal carousels and the camera zoom.
  useEffect(() => installDirectWheelScroll(), []);

  // Mirror the saved ambience volume into the audio layer. The surf is started from inside
  // Avatar's per-frame loop, which has no access to this context, so the setting is pushed to
  // the module rather than read by it.
  useEffect(() => {
    setAmbienceVolume(settings?.ambienceVolume ?? 1);
  }, [settings?.ambienceVolume]);

  // THE AUDIO UNLOCK USED TO LIVE HERE, and it was a hole straight through the mute.
  //
  // What it did on every click was `new Audio(<a pixabay .mp3>)` + `play()`, on the theory that
  // playing a remote clip at volume 0.001 is what tells the browser a gesture has happened. Three
  // things were wrong with that. It is a MUSIC file, fetched from a CDN and played, and it never
  // asked whether the player had muted the game - so 設定 said 全部靜音 while the app was starting
  // a track. `HTMLMediaElement.volume` is also not settable on iOS, which is where "0.001" stops
  // being quiet and becomes full volume. And `audioUnlocked` was only set inside `.then()`, so on
  // any network where that CDN is blocked - which is most of them here; see the note at the top of
  // lib/soundUtils.ts - the listener stayed armed and every single click started another download.
  // Measured: six of them in one short muted session. That is the 「關了靜音還是會時不時出現音樂聲」
  // nobody could find in the sound code, because it was never in the sound code.
  //
  // Nothing read `audioUnlocked` anyway, and the unlock this game actually needs is
  // `primeSynthAudio()` - resuming the shared AudioContext inside a real gesture - which
  // UI/MusicPlayer.tsx already registers on click/touchstart. So this effect is gone rather than
  // rewritten: the job was already being done, correctly, one component over.

  if (loading) {
    return (
      <LoadingScreen 
        onComplete={() => setIsGameLoading(false)} 
        isFirebaseReady={!loading} 
      />
    );
  }

  if (!user) {
    return (
      <div className="relative w-full h-full">
        <AuthScreen />
        <AnimatePresence>
          {isGameLoading && (
            <motion.div 
              className="absolute inset-0 z-loading"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
            >
              <LoadingScreen 
                onComplete={() => setIsGameLoading(false)} 
                isFirebaseReady={!loading} 
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-sky-500 overflow-hidden select-none touch-none">
      {/* 3D Scene Background */}
      <Scene />

      {/* Portal target for view-local Floating Panels that must escape their
          Game View's own stacking context to beat HUD (see the
          z-floating-panel tier docs in index.css). Deliberately a plain,
          unstyled div at this top level — NOT nested inside the "View
          Overlays" wrapper below — so anything portaled here (e.g.
          BuildingInteriorView's build toolbar/furniture drawer, see its
          `PORTAL_ROOT` usage) shares this same root stacking context, and
          its own z-index compares correctly against the HUD/toast/modal/
          loading tiers instead of being trapped under its Game View. */}
      <div id="floating-panel-root" />

      {/* Persistent HUD chrome. Every piece is placed by the shared CSS-grid
          HudFrame (src/components/UI/HudFrame.tsx) into an edge region,
          instead of each one self-positioning with hand-tuned `fixed
          top-[Npx]`/`left-N` offsets that encoded other elements' sizes and
          drifted into overlap across resolutions. MobileControls is mounted
          BEFORE the frame so the frame's interactive chrome wins the z=20
          tie against MobileControls' full-bleed touch-capture layer (see the
          z-index doc in index.css). */}
      <MobileControls />

      <AnimatePresence>
        {hudFrameMounted && (
          <HudFrame>
            {/* Left rail: profile card (home) or minimap (interior), then the
                category signpost column — flex-stacked, so SideButtons sits
                below without needing to know TopBar/MiniMap's height (this is
                what removed the old `top-[360px]` coupling). */}
            <HudRegion area="left-rail">
              {currentView === View.HOME && <TopBar />}
              {currentView === View.BUILDING_INTERIOR && <MiniMap />}
              <SideButtons />
            </HudRegion>

            {/* Right-edge camera zoom dial — Admin Only
                (constants/adminFeatures.ts), and now switchable from the
                管理員測試 console's 場景與環境 category as well (see
                UI/admin/AdminZoomDial.tsx). Zoom itself is untouched either
                way: the mouse wheel, pinch, and the first-person crossover all
                still work for every player (see constants/cameraZoom.ts, which
                is the single controller all three funnel through). Only the
                on-screen dial is hidden. Gated at this mount point rather than
                inside ZoomControl so the component stays a pure view. Station 4
                of the 新手引導 follows the same two flags — see NewbieTour's
                STEPS, which spotlights this exact dial. */}
            <HudRegion area="mid-right">
              {/* 【管理員測試】 handle, stacked ABOVE the dial in the same flex column. Both are
                  Admin Only, so for a normal player this region stays empty exactly as before —
                  and letting the grid separate them is what stops the handle landing on the
                  dial's ＋ button, which is what a hand-placed `top-1/2` did at 1440x900.
                  See UI/admin/AdminTestLauncher.tsx. */}
              <AdminOnly>
                <AdminTestLauncher />
              </AdminOnly>
              <AdminZoomDial />
            </HudRegion>

            {/* NavBar centred on the viewport; the pet mini-game panel floats
                just above it. */}
            <HudRegion area="bottom-center">
              <PettingMiniGame />
              {/* 整理 feedback for the offline overgrowth. Shares the pet mini-game's slot
                  because the two are the same kind of thing: a short confirmation of a
                  world interaction, above the NavBar, gone in a couple of seconds. */}
              <IslandTidy />
              {/* 餵食 — the same slot again, and the same reason: while a food is armed it is one
                  line saying so, and once the feed lands it is a two-second confirmation. Nothing
                  from 寵物照護 is on screen outside those two moments; the animal's state is read
                  from how it behaves (see UI/PetCarePanel.tsx on why there is no HUD meter). */}
              <PetFeeding />
              {/* Retired while something is being sited. The placement dock
                  (IslandEditorOverlay) is bottom-centred in both build modes now, and this is
                  the same slot — but the real reason is the session: while the player is holding
                  an object, the bottom of the screen is for putting it down, not for leaving.
                  A draft can run in the island view too (HomeSetupGuide arms the Starter House
                  without entering build mode), which is why the guard is the draft and not the
                  view. */}
              {currentView === View.HOME && !islandDraft && <NavBar />}
            </HudRegion>

            <HudRegion area="bottom-right">
              <ControlsHint />
              {/* 每日簽到 — the board's only player-facing way back in.
                  ─────────────────────────────────────────────────────
                  It used to have none: AppContext announces the round once, on the first
                  visit of a 台北 calendar day, and DailyLoginPanel consumes that
                  announcement — so closing the board also closed 補簽 for the rest of the
                  day, with nothing on screen saying the dismissal was final.

                  It shares this corner with 幸運轉盤 because the two are the same KIND of
                  thing — rewards that run on a clock — as opposed to the world verbs on the
                  left-hand signpost and the app sections in the NavBar. Above the wheel
                  rather than below it, so the wheel keeps the corner (see below). */}
              <DailyLoginButton />
              {/* 幸運轉盤 — one round icon in the very corner; the wheel itself is a
                  modal it opens (see LuckyWheel). Mounted LAST in this column so the
                  icon keeps the corner and the WASD hint above it retires off the top
                  of the stack on the player's first step. Island-only: it renders
                  nothing inside a building. */}
              <LuckyWheel />
            </HudRegion>
          </HudFrame>
        )}
      </AnimatePresence>

      {/* Corner weather notice — kept outside the frame on its own z-toast
          tier (self-positioning fixed corner card). */}
      <WeatherToast />

      <MusicPlayer />
      {/* 寵物互動面板 — opened only by the pet's own prompt (「[E] 與寵物互動」), never by walking
          past. An App-level sibling rather than a HudRegion because it is a centred dialog on the
          shared Modal tier, exactly like 我的寵物 and the shop's other pop-outs; a HUD region would
          have it competing for a corner with the NavBar. */}
      <PetInteractionPanel />
      <DailyLoginPanel />
      {/* 離線回歸的問候. A queue member (lib/onboardingQueue.ts) rather than a free-floating
          modal, so it and the daily-login board cannot both take the screen at once on the
          one login where a returning player is owed both. */}
      <IslandReturnPanel />
      {/* 健身獎勵. Another queue member, and the only one that can arrive mid-session: it waits
          for the player to be back on the island (§15) and shows what the workout earned. The
          ITEM is already saved by the time this can render — see WorkoutRewardPopup. */}
      <WorkoutRewardPopup />

      {/* The first-run sequence: 每日登入獎勵 → 新手引導 (教練阿肌) → 你的第一棟
          房屋. All three are App-level siblings rather than HudFrame regions —
          the tour darkens the whole screen and cuts a window over one HUD card
          at a time, so it must sit ABOVE the frame (z-toast); the other two are
          modals. The tour stays pointer-events-none so the island underneath is
          fully playable while it runs — station 3 asks the player to walk.

          Their ORDER is not this DOM order and is not a z-index tie: it is
          declared in lib/onboardingQueue.ts, which grants the screen to exactly
          one of them at a time. Rendering all three unconditionally is what put
          HomeSetupGuide's transparent scrim over the login bonus's button. */}
      <NewbieTour />
      <HomeSetupGuide />
      <BuildModeOverlay />

      {/* Island editing session panel (place / move / rotate / retrieve / re-skin the Home).
          Deliberately an App-level sibling rather than a HudFrame region: the same session runs
          in the island view AND in build mode, and HudFrame is only mounted for the former. It
          portals itself onto the floating-panel tier — see IslandEditorOverlay.tsx. */}
      <IslandEditorOverlay />

      {/* The one interaction prompt — whatever playerBus.interactionTarget is (the door, a seat,
          the pet, a resident…), pointing at that target's own Interaction Point. See
          InteractionPrompt.tsx. World-tracked, so it stays a full-bleed fixed overlay rather than
          a grid region; it swaps to a tap icon on touch devices internally. */}
      <InteractionPrompt />
      {/* 居民說的話，浮在互動提示上方。同一套「Canvas 投影、HTML 畫」的做法 —— 見 NpcSpeechBubble.tsx。 */}
      <NpcSpeechBubble />

      {/* 旅行商人 ↔ 限時小攤 的那一扇門（UI/MerchantSession.tsx）。
          An App-level sibling and NOT a HudFrame region, because it is not chrome: it renders
          nothing at all except a corner arrival toast and, at the moment the merchant casts off
          while the player is still browsing, one Modal-tier notice over the shop. It has to sit
          out here to beat the Game View wrapper below — the shop it covers is inside it.

          It is also the ONLY thing that opens View.LIMITED_SHOP. The signpost rail no longer has
          a 限時小攤 tag (see SideButtons.tsx); the way in is walking up to the merchant on the
          beach, and this component is what checks he is still there before opening anything. */}
      <MerchantSession />

      {/* 【管理員測試】 — 管理員測試模式 開啟後畫面上唯一多出來的東西：右緣一個收合標籤，
          點開才是完整的測試面板（components/UI/admin/AdminTestConsole.tsx 有完整說明）。

          An App-level sibling and NOT a HudFrame region, for the same reason MerchantSession is
          one: HudFrame is only mounted for View.HOME / View.BUILDING_INTERIOR and is dropped
          entirely during a workout, while half of what this console tests (商店與經濟, 玩家數值)
          is best watched from inside the shop. Out here it stays reachable from every view.

          <AdminOnly> returns null — not a hidden element — for every normal player, so nothing
          below this line is mounted, no listener is attached and no effect runs unless
          管理員測試模式 is on. */}
      <AdminOnly>
        {/* The handle again, for the views HudFrame is not mounted for (商店, 設定, 更衣室, 健康,
            限時小攤, and while a workout is running). Those are full-page cards with a 24px page
            gutter and nothing interactive at the right edge's mid height, and they have no zoom
            dial to collide with — so the centred edge position is free there. Exactly one of the
            two mounts is ever on screen. */}
        {!hudFrameMounted && <AdminTestLauncher floating />}
        <AdminTestConsole />
        {/* 商船不走 —— renders nothing, it only pushes 管理員測試模式 into the one module-level
            switch that Three/MerchantVisitor.tsx can read from inside useFrame. It lives INSIDE
            this gate on purpose: unmounting is what turns the override back off. See
            components/UI/admin/AdminMerchantDock.tsx. */}
        <AdminMerchantDock />
      </AdminOnly>

      {/* 牆上電燈開關的「Q 關燈」方框。自己一個徽章，而不是上面那個的又一個分支：那一格是 E
          的，一次只放最近的一個候選人，而開關按的是 Q —— 排進去的話，房裡只要有任何一件家具
          離你更近，開關的提示就永遠不會出現。見 UI/LightSwitchPrompt.tsx。 */}
      <LightSwitchPrompt />

      {/* Island placement notice — "this spot is taken", "that save didn't land".
          z-toast, not z-modal: it is a short-lived, pointer-events-none banner,
          which is the Toast tier's definition (index.css). It carried z-modal by
          mistake, and once NewbieTour started reading that tier as "a blocking
          dialog is up" a four-second placement warning was also pausing the
          tutorial. It still out-ranks the editor panel it appears over
          (z-floating-panel, 30). */}
      <AnimatePresence>
        {islandAlert && (
          <motion.div
            initial={{ y: -60, x: '-50%', opacity: 0 }}
            animate={{ y: 0, x: '-50%', opacity: 1 }}
            exit={{ y: -60, x: '-50%', opacity: 0 }}
            className="fixed top-8 left-1/2 z-toast px-6 py-4 bg-red-650/95 backdrop-blur-2xl border border-red-500/20 text-white rounded-[2rem] shadow-[0_20px_50px_rgba(220,38,38,0.4)] flex items-center gap-3 font-semibold pointer-events-none"
            style={{ backgroundColor: '#dc2626' }}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping flex-shrink-0" />
            <span className="text-sm font-black tracking-wide">{islandAlert}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* THE HOUSE'S 3D LAYER — mounted early and kept, rather than built on every entry.
          See `interiorMounted` above for what that is buying and why it is safe to leave running.

          It sits HERE, outside the view-overlay AnimatePresence below, precisely because that
          block is keyed on `currentView`: anything inside it is torn down and rebuilt on every
          view change, which is exactly the cost being removed. It keeps the same z-game-view
          wrapper the overlay gave it, so nothing about how it stacks against the HUD changes.

          `visibility` rather than unmounting: the canvas keeps its layout size (a hidden-by-
          display canvas resizes to 0 and back, which is work for nothing) while the browser skips
          painting it entirely, and BuildingInteriorView idles its own render loop when inactive. */}
      {interiorMounted && (
        <div
          className={`absolute inset-0 z-game-view transition-opacity duration-200 ${isInsideHouse ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          style={{ visibility: isInsideHouse ? 'visible' : 'hidden' }}
          aria-hidden={!isInsideHouse}
        >
          <BuildingInteriorView active={isInsideHouse} />
        </div>
      )}

      {/* View Overlays */}
      <AnimatePresence mode="wait">
        {currentView !== View.HOME && currentView !== View.BUILD_MODE && !isInsideHouse && (
          <motion.div
            key={currentView}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            // Crossing the front door is a movement, not a scene change, and 0.3s of fade on
            // each side of it is long enough to be felt as the game waiting on you. Shortened
            // to 0.18 - still a fade rather than a cut, and it also halves the window in which
            // BUILDING_INTERIOR's canvas and the island's are both on screen at once.
            transition={{ duration: 0.18 }}
            // Always z-game-view, regardless of which view this is — never
            // conditionally raised. BUILDING_INTERIOR keeps SideButtons/
            // ZoomControl/ControlsHint/MiniMap (z-hud-toolbar) mounted as
            // true siblings outside this wrapper; if BuildingInteriorView
            // ever needs a floating dialog to beat that HUD tier, that
            // dialog is portaled to document.body (see
            // BuildingInteriorView.tsx's `PORTAL_ROOT` usage) and uses
            // z-floating-panel there — it does NOT get fixed by raising
            // this wrapper, which would also lift this view's own plain
            // background/canvas above HUD as an unwanted side effect (the
            // exact bug that made MiniMap invisible inside the house).
            className="absolute inset-0 bg-white/70 backdrop-blur-3xl z-game-view"
          >
            {currentView === View.SETTINGS && <SettingsView />}
            {/* 健身組整合：健身分頁改由健身組的訓練頁提供（原型 FitnessView 保留不刪） */}
            {currentView === View.FITNESS && <FitnessHost />}
            {currentView === View.SHOP && <ShopView />}
            {/* 限時商店 — its own route, its own rail entrance. Not a modal inside ShopView:
                the two shops sell from different pools and a shop nested in a shop is one the
                player has to remember the way back into. */}
            {currentView === View.LIMITED_SHOP && <LimitedShopView />}
            {currentView === View.HEALTH && <HealthView />}
            {currentView === View.DRESSING_ROOM && <DressingRoomView />}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dynamic Animated Loading Overlay with absolute z-9999 */}
      <AnimatePresence>
        {isGameLoading && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            className="absolute inset-0 z-loading"
          >
            <LoadingScreen 
              onComplete={() => setIsGameLoading(false)} 
              isFirebaseReady={!loading} 
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      {/* Session-only state for the 管理員測試 console (which category is open, whether the zoom
          dial is drawn). Deliberately NOT part of AppSettings — see AdminTestContext.tsx on why a
          new persisted field is a risk this does not need to take. The provider itself renders no
          DOM and registers no listeners; it collapses to a closed console the moment
          管理員測試模式 is switched off. */}
      <AdminTestProvider>
        <AppContent />
      </AdminTestProvider>
    </AppProvider>
  );
}
