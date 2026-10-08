# AI_START_HERE — Motu

Read this file first. It is written for an AI or developer who has never seen
this project, and it covers everything needed to run the game and change it
without breaking it.

A gamified 3D fitness tracking app. Exercise on a tropical island, earn gold, and customize your avatar with AI-powered movement tracking.

## 1. Run it

Requires Node.js 20+ (developed on 24.x). Nothing else — no database, no API
key, no account.

```bash
npm install
npm run dev          # http://localhost:3000
```

`npm run dev` starts `server.ts`, an Express host that mounts Vite as
middleware, so the API route and the client are served from the same origin and
port. Running bare `vite` also works for pure front-end changes, but then
`POST /api/shop/chat` 404s.

To view the shipped build with no build step:

```bash
npx serve prebuilt-dist
```

Do **not** open `index.html` or `prebuilt-dist/index.html` from the
filesystem. It is an ES-module app; `file://` origins block module loading and
you get a blank page. Always go through a server.

## 2. It boots with no credentials — that is intentional, not a bug

`firebase-applet-config.json` in this bundle holds placeholder values. On
detecting them, `src/lib/firebase.ts` skips its connection probe and the app
runs in **Local Guest Mode**: a hand-written localStorage shim implements the
Firestore surface the app uses (`doc`, `getDoc`, `setDoc`, `updateDoc`,
`onSnapshot`, `increment`, `arrayUnion`, `arrayRemove`). Progress persists in
the browser instead of the cloud.

So expect these on a clean run, and do not "fix" them:

- Console: `Firebase is not configured. The app will run in Local Guest Mode using localStorage.`
- Google sign-in fails — use the guest option on the auth screen.
- `POST /api/shop/chat` returns 500 unless `GEMINI_API_KEY` is set (copy
  `.env.example` to `.env`). Only the shop chat assistant depends on it.
- One `https://cdn.pixabay.com/...mp3` request at first click. It is a
  throwaway used to unlock the browser audio context; offline it fails
  silently and is caught.

To point at a real backend, fill in `firebase-applet-config.json` with your own
Firebase web config and deploy `firestore.rules`.

## 3. Tech stack

- React 19.0.1
- TypeScript 5.8.2
- Vite 6.2.3
- Three.js 0.184.0
- react-three-fiber 9.6.1
- drei 10.7.7
- Tailwind CSS 4.1.14
- Firebase 12.12.1
- Express 4.21.2
- @google/genai 1.29.0
- MediaPipe Tasks Vision 0.10.35
- Motion 12.23.24
- Recharts 3.8.1

## 4. Where things live

| File | What it does |
| --- | --- |
| `index.html` | Vite HTML entry. Mounts #root and loads src/main.tsx. |
| `server.ts` | Express host. In dev it wraps Vite as middleware on port 3000; in prod it serves dist/. Also owns POST /api/shop/chat, the Gemini-backed shop assistant. |
| `vite.config.ts` | Vite config. Note the usePolling watcher (the repo lives on OneDrive, where native FS events are unreliable) and the manual vendor chunk split. |
| `src/main.tsx` | React root. Wraps <App/> in an ErrorBoundary that renders the error + component stack on screen instead of a blank page. |
| `src/App.tsx` | Top-level view router and persistent HUD chrome. Chooses between Scene and the full-screen views (Shop, Fitness, Tracker, Dressing Room, Building Interior). |
| `src/types.ts` | Shared domain types: UserProfile, ShopItem, PlacedItem, WorkoutLog, View enum, ItemCategory. |
| `src/index.css` | Tailwind entry AND the authoritative GLOBAL Z-INDEX LAYER SYSTEM. Read the comment block at the top before positioning anything. |
| `src/context/AppContext.tsx` | Global state: profile, inventory, equipped items, current view, UI flags. Backed by Firestore or localStorage depending on auth mode. |
| `src/lib/firebase.ts` | Firebase wrapper AND a full localStorage-backed Firestore shim. When the config is a placeholder or anonymous auth fails, the app transparently runs in Local Guest Mode - this is why it boots with no credentials. |
| `src/lib/playerBus.ts` | Non-React per-frame state bus between the 3D layer and HUD overlays, plus clampFrameDelta() - the tab-resume delta guard that stops the camera spinning after a tab switch. |
| `src/lib/soundUtils.ts` | All audio. Every effect is synthesized live with the Web Audio API (no sound files at all), including the layered swim ambience. |
| `src/constants/world.ts` | Single source of truth for ocean surface / swim body world-Y. Ocean, Avatar, Weather and Fish must all read these, never re-literal them. |
| `src/components/Three/Scene.tsx` | The R3F Canvas and scene graph root: lighting, island, ocean, sky, weather, and every 3D actor. |
| `src/components/Three/Avatar.tsx` | Player character: procedural mesh plus the movement/animation state machine (walk, run, several swim poses, hammock, emotes). |
| `src/components/Three/CameraController.tsx` | Camera. First/third-person blending, collision, and the free-fly build-mode rig. |
| `src/components/Three/characterMovement.ts` | Input-to-motion math shared by the avatar: acceleration, terrain and water height sampling, collision. |
| `src/components/Three/Fish.tsx` | Instanced fish schools circling the island shallows. |
| `src/components/Three/Ocean.tsx` | Ocean surface: custom GLSL wave displacement, shoreline foam, depth tinting. |
| `src/components/UI/MiniMap.tsx` | Canvas-drawn minimap. Reads live position from playerBus (or the build-mode camera when that is active). |
| `src/components/UI/HudFrame.tsx` | Layout primitive that assigns HUD elements to the shared safe-area regions. |
| `firestore.rules` | Deployed Firestore security rules. DRAFT_firestore.rules is a work-in-progress variant, not what is live. |
| `metadata.json` | AI Studio applet manifest: display name, requested camera permission, server-side Gemini capability flag. |
| `firebase-applet-config.json` | Firebase client config. Sanitized to placeholders in this bundle so the app boots straight into Local Guest Mode. |

## 5. Invariants worth knowing before editing

These are the project's real footguns — each one has already caused a bug.

1. **Z-index is a global system, not per-component.** `src/index.css` opens with
   a `GLOBAL Z-INDEX LAYER SYSTEM` block defining Background / Game View / HUD /
   Floating Panel / Toast / Modal / Loading. Use those classes. Raising a whole
   Game View above HUD is exactly what once made the minimap invisible indoors;
   components needing to beat HUD portal to `document.body` instead.
2. **World heights come from `src/constants/world.ts`.** `WATER_SURFACE_Y` and
   `SWIM_BODY_Y` were once duplicated literals across Ocean / Avatar / Weather /
   Fish, drifted apart, and left the swim splash FX rendering below the water.
   Never re-hardcode `-0.5`.
3. **Per-frame cross-component state goes through `playerBus`, not React state
   and not `window`.** Player position, rotation, camera yaw, dog state and the
   interaction prompt update every frame; routing them through React would
   re-render the tree 60×/s.
4. **Always clamp `useFrame` deltas with `clampFrameDelta()`.** A hidden tab
   throttles rAF, so the first frame back can report a multi-second delta. Feeding
   that raw into a rotation rate spun the camera several full turns — that is the
   bug the helper exists to prevent.
5. **Audio is fully synthesized.** There are no audio files. `soundUtils.ts`
   builds every effect from Web Audio primitives (noise buffers, oscillators,
   filters). Add sounds the same way, and keep failures silent — audio is
   blocked until the first user gesture.
6. **The file watcher polls on purpose.** This project lives in a OneDrive
   folder where native FS events are unreliable, so `vite.config.ts` sets
   `server.watch.usePolling`. Removing it causes stale modules that survive a
   hard refresh.

## 6. Verifying a change

```bash
npm run lint     # tsc --noEmit — must be clean
npm run build    # vite build — must succeed
```

There is no test suite; these two commands are the gate. `npm run lint` also
catches stray git merge-conflict markers (TS1185), which is how a previously
shipped bundle turned out to be unbuildable.

## 7. Also in this bundle

- `PROJECT_MANIFEST.json` — machine-readable inventory: every packed file with
  size, line count and, for key files, its role.
- `FULL_SOURCE.md` — every text source file concatenated into one document, for
  pasting into a model with a large context window.
- `prebuilt-dist/` — the compiled app, ready for any static server.
- `README.md` — the original human-facing setup guide.
- `security_spec.md`, `firestore.rules` — data model and access rules.

## 8. Full tree

```text
island-fitness-ai/
  ├── .agents/
  │   ├── AGENTS.md
  │   └── mcp_config.json
  ├── .claude/
  │   ├── launch.json
  │   └── settings.local.json
  ├── .github/
  │   ├── workflows/
  │   │   └── ci.yml
  │   └── PULL_REQUEST_TEMPLATE.md
  ├── blender-reference/
  │   ├── authored-character-source.glb
  │   └── player-model-reference.glb
  ├── docs/
  │   ├── artwork.md
  │   ├── AUTH_SETUP.md
  │   ├── build-mode-and-colliders.md
  │   ├── character-authored-model.md
  │   ├── character-import-checklist.md
  │   ├── character-model.md
  │   ├── daily-login.md
  │   ├── economy.md
  │   ├── FIRESTORE_RULES.md
  │   ├── fragments.md
  │   ├── furniture-interactions.md
  │   ├── ground-and-character-quality.md
  │   ├── hair-assets.md
  │   ├── interaction-feedback.md
  │   ├── jump-animation.md
  │   ├── lighting-and-ceiling-placement.md
  │   ├── limited-shop.md
  │   ├── ocean-decorations-prompt.md
  │   ├── offline-return.md
  │   ├── outdoor-assets.md
  │   ├── pet-care.md
  │   ├── rarity-system-prompt.md
  │   ├── special-cosmetics.md
  │   ├── traveling-merchant.md
  │   ├── utility-cards.md
  │   ├── weekly-tasks.md
  │   ├── workout-rewards.md
  │   └── z-fighting.md
  ├── images/
  │   └── 螢幕擷取畫面 2026-08-04 184923.png
  ├── public/
  │   ├── hdri/
  │   │   ├── lebombo_1k.hdr
  │   │   ├── potsdamer_platz_1k.hdr
  │   │   └── venice_sunset_1k.hdr
  │   └── models/
  │       └── character/
  │           ├── arm-left.glb
  │           ├── arm-right.glb
  │           ├── head.glb
  │           ├── leg-left.glb
  │           ├── leg-right.glb
  │           └── torso.glb
  ├── scripts/
  │   ├── hooks/
  │   │   └── pre-commit
  │   ├── lib/
  │   │   └── measureFurnitureModel.ts
  │   ├── audit-catalog.ts
  │   ├── audit-character-parts.ts
  │   ├── audit-colliders.ts
  │   ├── audit-cosmetics.ts
  │   ├── audit-furniture-interactions.ts
  │   ├── audit-furniture-models.mjs
  │   ├── audit-ground-contact.ts
  │   ├── audit-ground-cover.ts
  │   ├── audit-hair.ts
  │   ├── audit-hud-scale.ts
  │   ├── audit-interior-shell.ts
  │   ├── audit-jump-animation.ts
  │   ├── audit-object-animations.ts
  │   ├── audit-outdoor-quality.ts
  │   ├── audit-placements.ts
  │   ├── audit-shop-consistency.ts
  │   ├── audit-swim-pose.ts
  │   ├── audit-zfighting.mjs
  │   ├── check-conflict-markers.mjs
  │   ├── clean.mjs
  │   ├── export-player-reference.mjs
  │   ├── fix-character-blend.py
  │   ├── pack-game.mjs
  │   ├── setup-hooks.mjs
  │   ├── split-character-glb.mjs
  │   ├── test-daily-login.ts
  │   ├── test-economy.ts
  │   ├── test-fragment-progress.ts
  │   ├── test-limited-shop.ts
  │   ├── test-merchant-visit.ts
  │   ├── test-npc-social.ts
  │   ├── test-object-lifecycle.ts
  │   ├── test-offline-return.ts
  │   ├── test-pet-care.ts
  │   ├── test-pet-interactions.ts
  │   ├── test-placement-precision.ts
  │   ├── test-utility-cards.ts
  │   ├── test-weekly-tasks.ts
  │   └── test-workout-rewards.ts
  ├── src/
  │   ├── auth/
  │   │   ├── providers/
  │   │   │   ├── marks.ts
  │   │   │   ├── registry.ts
  │   │   │   └── types.ts
  │   │   ├── AuthenticationManager.ts
  │   │   ├── errors.ts
  │   │   ├── SessionManager.ts
  │   │   ├── TokenManager.ts
  │   │   ├── types.ts
  │   │   └── useAuth.ts
  │   ├── components/
  │   │   ├── health/
  │   │   │   ├── ActivityHistoryPanel.tsx
  │   │   │   ├── HealthChrome.tsx
  │   │   │   ├── healthFormat.ts
  │   │   │   ├── HealthOverviewPanel.tsx
  │   │   │   ├── healthSections.ts
  │   │   │   ├── HealthView.tsx
  │   │   │   ├── WeeklyTaskCard.tsx
  │   │   │   ├── WeeklyTaskForm.tsx
  │   │   │   └── WeeklyTaskPanel.tsx
  │   │   ├── Three/
  │   │   │   ├── character/
  │   │   │   │   ├── legacy/
  │   │   │   │   │   ├── hairShading.ts
  │   │   │   │   │   ├── index.tsx
  │   │   │   │   │   └── wardrobe.tsx
  │   │   │   │   ├── Attachment.tsx
  │   │   │   │   ├── AuthoredCharacterModel.tsx
  │   │   │   │   ├── bodyFit.tsx
  │   │   │   │   ├── bodyForm.tsx
  │   │   │   │   ├── bodySurface.ts
  │   │   │   │   ├── CharacterModelV2.tsx
  │   │   │   │   ├── index.tsx
  │   │   │   │   ├── outfit.ts
  │   │   │   │   ├── partLoader.tsx
  │   │   │   │   ├── slots.tsx
  │   │   │   │   └── types.ts
  │   │   │   ├── effects/
  │   │   │   │   ├── CosmeticModels.tsx
  │   │   │   │   ├── cosmeticRuntime.ts
  │   │   │   │   ├── CreatureMeshes.tsx
  │   │   │   │   ├── EffectField.tsx
  │   │   │   │   ├── index.ts
  │   │   │   │   ├── particleShapes.ts
  │   │   │   │   └── SpecialCosmetic.tsx
  │   │   │   ├── AdaptiveResolution.tsx
  │   │   │   ├── ArtworkModels.tsx
  │   │   │   ├── Avatar.tsx
  │   │   │   ├── CameraController.tsx
  │   │   │   ├── CameraRig.tsx
  │   │   │   ├── CandleInHand.tsx
  │   │   │   ├── characterMovement.ts
  │   │   │   ├── Clouds.tsx
  │   │   │   ├── Fireflies.tsx
  │   │   │   ├── Fish.tsx
  │   │   │   ├── FixtureLight.tsx
  │   │   │   ├── floorMaterial.ts
  │   │   │   ├── FurnitureItem.tsx
  │   │   │   ├── glowTexture.ts
  │   │   │   ├── GroundCover.tsx
  │   │   │   ├── groundMaterial.ts
  │   │   │   ├── HippoButler.tsx
  │   │   │   ├── HouseModel.tsx
  │   │   │   ├── instanceColor.ts
  │   │   │   ├── InteractionPromptTracker.tsx
  │   │   │   ├── InteriorLighting.tsx
  │   │   │   ├── InteriorNpcs.tsx
  │   │   │   ├── Island.tsx
  │   │   │   ├── IslandDecorations.tsx
  │   │   │   ├── IslandNpcs.tsx
  │   │   │   ├── IslandOvergrowth.tsx
  │   │   │   ├── IslandPet.tsx
  │   │   │   ├── jumpPose.ts
  │   │   │   ├── LightSwitch.tsx
  │   │   │   ├── MerchantBoat.tsx
  │   │   │   ├── MerchantVisitor.tsx
  │   │   │   ├── NightSky.tsx
  │   │   │   ├── Npcs.tsx
  │   │   │   ├── NpcWalker.tsx
  │   │   │   ├── objectAnimation.tsx
  │   │   │   ├── Ocean.tsx
  │   │   │   ├── OceanDecorations.tsx
  │   │   │   ├── outdoorAnimation.tsx
  │   │   │   ├── Outfits.tsx
  │   │   │   ├── Pants.tsx
  │   │   │   ├── Pets.tsx
  │   │   │   ├── PlacementGhost.tsx
  │   │   │   ├── PlayerHomeView.tsx
  │   │   │   ├── proceduralNoise.ts
  │   │   │   ├── RabbitGardener.tsx
  │   │   │   ├── Scene.tsx
  │   │   │   ├── Shoes.tsx
  │   │   │   ├── SkyDome.tsx
  │   │   │   ├── StickFigure.tsx
  │   │   │   ├── StudioFloor.tsx
  │   │   │   ├── swimPose.ts
  │   │   │   ├── tmp-pets-old.tsx
  │   │   │   ├── Torch.tsx
  │   │   │   ├── usePlacementDrag.ts
  │   │   │   ├── wallMaterial.ts
  │   │   │   ├── Weather.tsx
  │   │   │   └── ZFightAuditBridge.tsx
  │   │   ├── UI/
  │   │   │   ├── admin/
  │   │   │   │   ├── AdminMerchantDock.tsx
  │   │   │   │   ├── AdminTestConsole.tsx
  │   │   │   │   ├── AdminTestContext.tsx
  │   │   │   │   ├── AdminTestKit.tsx
  │   │   │   │   ├── AdminTestLauncher.tsx
  │   │   │   │   ├── adminTestSections.tsx
  │   │   │   │   └── AdminZoomDial.tsx
  │   │   │   ├── minimap/
  │   │   │   │   ├── InteriorMiniMapScene.tsx
  │   │   │   │   ├── miniMapCore.ts
  │   │   │   │   ├── MiniMapFrame.tsx
  │   │   │   │   ├── MiniMapMarker.tsx
  │   │   │   │   └── MiniMapViewport.tsx
  │   │   │   ├── settings/
  │   │   │   │   ├── AboutCategory.tsx
  │   │   │   │   ├── AccountCategory.tsx
  │   │   │   │   ├── AdminOwnAllItemsRow.tsx
  │   │   │   │   ├── AudioCategory.tsx
  │   │   │   │   ├── ControlsCategory.tsx
  │   │   │   │   ├── GeneralCategory.tsx
  │   │   │   │   ├── GraphicsCategory.tsx
  │   │   │   │   ├── SettingRow.tsx
  │   │   │   │   ├── settingsCategories.ts
  │   │   │   │   ├── SettingsNav.tsx
  │   │   │   │   ├── settingsNavigation.ts
  │   │   │   │   └── SettingsSection.tsx
  │   │   │   ├── AccountPanel.tsx
  │   │   │   ├── AdminIslandControls.tsx
  │   │   │   ├── AdminOnly.tsx
  │   │   │   ├── AdminValueControls.tsx
  │   │   │   ├── AdminWorkoutRewardControls.tsx
  │   │   │   ├── AnchoredPopover.tsx
  │   │   │   ├── AngelGuide.tsx
  │   │   │   ├── AuthScreen.tsx
  │   │   │   ├── AvatarIcon.tsx
  │   │   │   ├── BackpackTabs.tsx
  │   │   │   ├── BuildModeOverlay.tsx
  │   │   │   ├── CategoryIcon.tsx
  │   │   │   ├── CategoryTabs.tsx
  │   │   │   ├── CoachSprite.tsx
  │   │   │   ├── ControlsHint.tsx
  │   │   │   ├── DailyClaimReveal.tsx
  │   │   │   ├── DailyLoginPanel.tsx
  │   │   │   ├── DESIGN_SYSTEM.md
  │   │   │   ├── DesignKit.tsx
  │   │   │   ├── EmoteGrid.tsx
  │   │   │   ├── FloatingPanelPortal.tsx
  │   │   │   ├── FragmentProgress.tsx
  │   │   │   ├── HairSpinPreview.tsx
  │   │   │   ├── HomePanel.tsx
  │   │   │   ├── HomeSetupGuide.tsx
  │   │   │   ├── HudFrame.tsx
  │   │   │   ├── InteractionPrompt.tsx
  │   │   │   ├── IslandColourVeil.tsx
  │   │   │   ├── IslandEditorOverlay.tsx
  │   │   │   ├── IslandReturnPanel.tsx
  │   │   │   ├── IslandTidy.tsx
  │   │   │   ├── ItemStock.tsx
  │   │   │   ├── LightSwitchPrompt.tsx
  │   │   │   ├── LoadingScreen.tsx
  │   │   │   ├── LoginBonusPopup.tsx
  │   │   │   ├── LuckyWheel.tsx
  │   │   │   ├── MerchantSession.tsx
  │   │   │   ├── MiniMap.tsx
  │   │   │   ├── MobileControls.tsx
  │   │   │   ├── MusicPlayer.tsx
  │   │   │   ├── NavBar.tsx
  │   │   │   ├── NewbieTour.tsx
  │   │   │   ├── NpcSpeechBubble.tsx
  │   │   │   ├── PetCarePanel.tsx
  │   │   │   ├── PetFeeding.tsx
  │   │   │   ├── PetInteractionPanel.tsx
  │   │   │   ├── PetSpeciesFilter.tsx
  │   │   │   ├── PettingMiniGame.tsx
  │   │   │   ├── PlacementCatalog.tsx
  │   │   │   ├── PlacementDock.tsx
  │   │   │   ├── ProviderButton.tsx
  │   │   │   ├── PurchaseDialog.tsx
  │   │   │   ├── RarityAura.tsx
  │   │   │   ├── RarityReveal.tsx
  │   │   │   ├── SideButtons.tsx
  │   │   │   ├── TopBar.tsx
  │   │   │   ├── UtilityCard.tsx
  │   │   │   ├── WeatherToast.tsx
  │   │   │   ├── WeatherWidget.tsx
  │   │   │   ├── WorkoutRewardPopup.tsx
  │   │   │   ├── YouTubeMusicHost.tsx
  │   │   │   └── ZoomControl.tsx
  │   │   ├── ArtworkIcon.tsx
  │   │   ├── BuildingInteriorView.tsx
  │   │   ├── DressingRoomView.tsx
  │   │   ├── FitnessView.tsx
  │   │   ├── InteractionPrompt.tsx
  │   │   ├── LimitedShopView.tsx
  │   │   ├── MovementTracker.tsx
  │   │   ├── QVersionIcon.tsx
  │   │   ├── SettingsView.tsx
  │   │   ├── ShopView.tsx
  │   │   └── SpecialCosmeticIcon.tsx
  │   ├── constants/
  │   │   ├── adminFeatures.ts
  │   │   ├── angelAvoid.ts
  │   │   ├── artwork.ts
  │   │   ├── bgmTracks.ts
  │   │   ├── buildingPositions.ts
  │   │   ├── cameraFocus.ts
  │   │   ├── cameraZoom.ts
  │   │   ├── characterAssets.ts
  │   │   ├── characterForm.ts
  │   │   ├── characterModel.ts
  │   │   ├── characterRig.ts
  │   │   ├── civilTime.ts
  │   │   ├── consumables.ts
  │   │   ├── cosmeticEffects.ts
  │   │   ├── currency.ts
  │   │   ├── dailyLogin.ts
  │   │   ├── dailyLoginPrizes.ts
  │   │   ├── distribution.ts
  │   │   ├── environmentMaps.ts
  │   │   ├── fragments.ts
  │   │   ├── furnitureInteractions.ts
  │   │   ├── furnitureModels.ts
  │   │   ├── groundCover.ts
  │   │   ├── hair.ts
  │   │   ├── hairRibbon.ts
  │   │   ├── hats.ts
  │   │   ├── houseStyles.ts
  │   │   ├── hudLayout.ts
  │   │   ├── interactionPostures.ts
  │   │   ├── interiorShell.ts
  │   │   ├── islandReturn.ts
  │   │   ├── items.ts
  │   │   ├── layers.ts
  │   │   ├── lighting.ts
  │   │   ├── limitedShop.ts
  │   │   ├── limitedShopRotation.ts
  │   │   ├── luckyWheel.ts
  │   │   ├── materialSwatches.ts
  │   │   ├── merchantAnimation.ts
  │   │   ├── merchantDocks.ts
  │   │   ├── merchants.ts
  │   │   ├── merchantVisit.ts
  │   │   ├── npcs.ts
  │   │   ├── npcSocial.ts
  │   │   ├── objectAnimations.ts
  │   │   ├── outdoorAnimation.ts
  │   │   ├── outdoorPalette.ts
  │   │   ├── outdoorScale.ts
  │   │   ├── pants.ts
  │   │   ├── petCare.ts
  │   │   ├── petHabitats.ts
  │   │   ├── petInteractions.ts
  │   │   ├── petRig.ts
  │   │   ├── pets.ts
  │   │   ├── placement.ts
  │   │   ├── rarity.ts
  │   │   ├── rarityFx.ts
  │   │   ├── retiredItems.ts
  │   │   ├── revealCopy.ts
  │   │   ├── rewardEffects.ts
  │   │   ├── rewardPools.ts
  │   │   ├── rewards.ts
  │   │   ├── rooms.ts
  │   │   ├── seed.ts
  │   │   ├── terrain.ts
  │   │   ├── tourTargets.ts
  │   │   ├── utilityCards.ts
  │   │   ├── weeklyTasks.ts
  │   │   ├── wheelRewards.ts
  │   │   ├── workoutRewards.ts
  │   │   └── world.ts
  │   ├── context/
  │   │   ├── AppContext.tsx
  │   │   ├── homeMigration.ts
  │   │   ├── useDailyLoginPrize.ts
  │   │   ├── useEconomyActions.ts
  │   │   ├── useFragmentActions.ts
  │   │   ├── useHomeActions.ts
  │   │   ├── useIslandEditor.ts
  │   │   ├── useIslandLife.ts
  │   │   ├── useLimitedShop.ts
  │   │   ├── usePetCare.ts
  │   │   ├── usePlacementActions.ts
  │   │   ├── useShopActions.ts
  │   │   ├── useUtilityCards.ts
  │   │   ├── useWeeklyTasks.ts
  │   │   ├── useWheelActions.ts
  │   │   ├── useWheelRewards.ts
  │   │   └── useWorkoutRewards.ts
  │   ├── hooks/
  │   │   ├── useAdminMode.ts
  │   │   ├── useEquippedBuildings.ts
  │   │   ├── useEscapeToClose.ts
  │   │   ├── useHudTier.ts
  │   │   ├── useIsTouchDevice.ts
  │   │   ├── useLightningFlicker.ts
  │   │   ├── useMerchantVisit.ts
  │   │   ├── usePlayerHome.ts
  │   │   ├── useScrollIsolation.ts
  │   │   └── useViewportWidth.ts
  │   ├── lib/
  │   │   ├── adminSaveReset.ts
  │   │   ├── ambientMusic.ts
  │   │   ├── backgroundMusic.ts
  │   │   ├── cameraCollision.ts
  │   │   ├── collisionShape.ts
  │   │   ├── dailyLoginClient.ts
  │   │   ├── firebase.ts
  │   │   ├── firebaseCore.ts
  │   │   ├── furnitureInteraction.ts
  │   │   ├── furniturePlacement.ts
  │   │   ├── groundCoverBuild.ts
  │   │   ├── groundField.ts
  │   │   ├── healthData.ts
  │   │   ├── inputManager.ts
  │   │   ├── interactionPosture.ts
  │   │   ├── interiorDoors.ts
  │   │   ├── interiorLights.ts
  │   │   ├── interiorPlacement.ts
  │   │   ├── islandOvergrowth.ts
  │   │   ├── merchantAnimation.ts
  │   │   ├── npcFacilityLocks.ts
  │   │   ├── npcHum.ts
  │   │   ├── npcPose.ts
  │   │   ├── npcRig.ts
  │   │   ├── npcSocial.ts
  │   │   ├── objectAnimation.ts
  │   │   ├── objectRuntimeState.ts
  │   │   ├── onboardingQueue.ts
  │   │   ├── outdoorMotion.ts
  │   │   ├── petActivity.ts
  │   │   ├── petCompatibility.ts
  │   │   ├── petReaction.ts
  │   │   ├── petRestingSpots.ts
  │   │   ├── placementSession.ts
  │   │   ├── placementSurfaces.ts
  │   │   ├── playerBus.ts
  │   │   ├── rendererTuning.ts
  │   │   ├── saveStatus.ts
  │   │   ├── soundUtils.ts
  │   │   ├── tutorialReplay.ts
  │   │   ├── vibration.ts
  │   │   ├── wheelScroll.ts
  │   │   ├── workoutCompletion.ts
  │   │   ├── worldSolids.ts
  │   │   └── youtubeMusic.ts
  │   ├── save/
  │   │   ├── guestClaim.ts
  │   │   └── LocalSaveStore.ts
  │   ├── server/
  │   │   └── dailyLoginApi.ts
  │   ├── utils/
  │   │   ├── categoryUtils.ts
  │   │   ├── debugOverrides.ts
  │   │   ├── inventory.ts
  │   │   ├── level.ts
  │   │   ├── placementRules.ts
  │   │   ├── unlock.ts
  │   │   ├── weatherSway.ts
  │   │   └── zFightAudit.ts
  │   ├── App.tsx
  │   ├── devAngelFit.tsx
  │   ├── index.css
  │   ├── main.tsx
  │   ├── types.ts
  │   └── vite-env.d.ts
  ├── .env.example
  ├── .firebaserc
  ├── .gitattributes
  ├── .gitignore
  ├── angel-fit.html
  ├── CONTRIBUTING.md
  ├── DRAFT_firestore.rules
  ├── firebase-applet-config.json
  ├── firebase-blueprint.json
  ├── firebase.json
  ├── firestore.rules
  ├── index.html
  ├── metadata.json
  ├── package-lock.json
  ├── package.json
  ├── README.md
  ├── security_spec.md
  ├── server.ts
  ├── tmp-allpets.tsx
  ├── tmp-anomaly-scan.ts
  ├── tmp-artwork-preview.html
  ├── tmp-artwork-preview.tsx
  ├── tmp-audio-audit.html
  ├── tmp-audio-audit.tsx
  ├── tmp-audio-ui.html
  ├── tmp-audio-ui.tsx
  ├── tmp-beach-exit-check.ts
  ├── tmp-bird3d.html
  ├── tmp-bird3d.tsx
  ├── tmp-birds-anat.tsx
  ├── tmp-birds-audit.tsx
  ├── tmp-birds-face.tsx
  ├── tmp-birds-preview.html
  ├── tmp-birds-zoom.html
  ├── tmp-birds-zoom.tsx
  ├── tmp-birds.tsx
  ├── tmp-budgie-big.tsx
  ├── tmp-butler.html
  ├── tmp-butler.tsx
  ├── tmp-cats-preview.html
  ├── tmp-cats-zoom.tsx
  ├── tmp-cats.tsx
  ├── tmp-cats3.tsx
  ├── tmp-ceiling-light.html
  ├── tmp-ceiling-light.tsx
  ├── tmp-character-parts.html
  ├── tmp-character-parts.tsx
  ├── tmp-cosmetic-preview.html
  ├── tmp-cosmetic-preview.tsx
  ├── tmp-daily-login.html
  ├── tmp-daily-login.tsx
  ├── tmp-daily-prizes.html
  ├── tmp-daily-prizes.tsx
  ├── tmp-deckstand.html
  ├── tmp-deckstand.tsx
  ├── tmp-dogs-chip.tsx
  ├── tmp-dogs-preview.tsx
  ├── tmp-doorfollow-check.ts
  ├── tmp-doortrigger-check.ts
  ├── tmp-dump.ts
  ├── tmp-firefly-preview.html
  ├── tmp-firefly-preview.tsx
  ├── tmp-fit.html
  ├── tmp-fit.tsx
  ├── tmp-footstep-audit.html
  ├── tmp-footstep-audit.tsx
  ├── tmp-fpcheck.ts
  ├── tmp-furniture-preview.html
  ├── tmp-furniture-preview.tsx
  ├── tmp-hair.html
  ├── tmp-hair.tsx
  ├── tmp-hathair.html
  ├── tmp-hathair.tsx
  ├── tmp-homecam-check.ts
  ├── tmp-house-camera.html
  ├── tmp-house-camera.tsx
  ├── tmp-iconsheet.html
  ├── tmp-iconsheet.tsx
  ├── tmp-interior-footstep-check.ts
  ├── tmp-lawn.html
  ├── tmp-lawn.tsx
  ├── tmp-lock-preview.html
  ├── tmp-lock-preview.tsx
  ├── tmp-moon.html
  ├── tmp-moon.tsx
  ├── tmp-npc-window.html
  ├── tmp-npc.html
  ├── tmp-npc.tsx
  ├── tmp-npcedge-check.ts
  ├── tmp-npcedge.html
  ├── tmp-npcedge.tsx
  ├── tmp-npcicon.html
  ├── tmp-npcicon.tsx
  ├── tmp-npcsocial.html
  ├── tmp-npcsocial.tsx
  ├── tmp-npcwin.html
  ├── tmp-npcwin.tsx
  ├── tmp-objectanim.html
  ├── tmp-objectanim.tsx
  ├── tmp-oceanring.html
  ├── tmp-oceanring.tsx
  ├── tmp-outdoor-preview.html
  ├── tmp-outdoor-preview.tsx
  ├── tmp-outfit-audit.html
  ├── tmp-outfit-audit.tsx
  ├── tmp-overgrowth-preview.html
  ├── tmp-overgrowth-preview.tsx
  ├── tmp-petfollow.html
  ├── tmp-petfollow.tsx
  ├── tmp-petfp.html
  ├── tmp-petfp.tsx
  ├── tmp-petinteract.html
  ├── tmp-petinteract.tsx
  ├── tmp-phoenix-big.tsx
  ├── tmp-phoenix3d.html
  ├── tmp-phoenix3d.tsx
  ├── tmp-posture-preview.html
  ├── tmp-posture-preview.tsx
  ├── tmp-rabbit-fit.html
  ├── tmp-rabbit-fit.tsx
  ├── tmp-rarity-verify.tsx
  ├── tmp-render-hair-icons.tsx
  ├── tmp-render-icons.tsx
  ├── tmp-reveal-frozen.html
  ├── tmp-reveal.html
  ├── tmp-reveal.tsx
  ├── tmp-roomstyle-check.ts
  ├── tmp-scrim.html
  ├── tmp-scrim.tsx
  ├── tmp-seedcheck.ts
  ├── tmp-shoes-preview.html
  ├── tmp-shoes-preview.tsx
  ├── tmp-shopmatch-spans.json
  ├── tmp-shopmatch-spans.ts
  ├── tmp-shopmatch.html
  ├── tmp-shopmatch.tsx
  ├── tmp-shrubfield.html
  ├── tmp-shrubfield.tsx
  ├── tmp-skyfacet.html
  ├── tmp-skyfacet.tsx
  ├── tmp-skystars.html
  ├── tmp-skystars.tsx
  ├── tmp-spinsound.html
  ├── tmp-spinsound.tsx
  ├── tmp-spinstrip.tsx
  ├── tmp-swimflip-check.ts
  ├── tmp-swimstate-check.ts
  ├── tmp-temple.html
  ├── tmp-temple.tsx
  ├── tmp-wall-icons.html
  ├── tmp-wall-icons.tsx
  ├── tmp-wall-preview.html
  ├── tmp-wall-preview.tsx
  ├── tmp-wallcam-check.ts
  ├── tsconfig.json
  └── vite.config.ts
```
