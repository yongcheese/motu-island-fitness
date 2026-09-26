# Motu 專案說明文件

## 核心技術棧
React, Vite, Tailwind CSS, Three.js, React Three Fiber (R3F), Firebase, TypeScript, Express

## 專案目錄樹 (已過濾掉影音大檔與編譯結果)
```text
├── .env.example
├── .gitignore
├── blender-reference/
├── DRAFT_firestore.rules
├── firebase-applet-config.json
├── firebase-blueprint.json
├── firestore.rules
├── index.html
├── metadata.json
├── pack-for-ai.cjs
├── package.json
├── README.md
├── scripts/
│   ├── audit-furniture-models.mjs
│   └── export-player-reference.mjs
├── security_spec.md
├── server.ts
├── src/
│   ├── App.tsx
│   ├── components/
│   │   ├── BuildingInteriorView.tsx
│   │   ├── DressingRoomView.tsx
│   │   ├── FitnessView.tsx
│   │   ├── MovementTracker.tsx
│   │   ├── QVersionIcon.tsx
│   │   ├── SettingsView.tsx
│   │   ├── ShopView.tsx
│   │   ├── Three/
│   │   │   ├── Avatar.tsx
│   │   │   ├── CameraController.tsx
│   │   │   ├── characterMovement.ts
│   │   │   ├── Clouds.tsx
│   │   │   ├── Fireflies.tsx
│   │   │   ├── FurnitureItem.tsx
│   │   │   ├── InteractionPromptTracker.tsx
│   │   │   ├── Island.tsx
│   │   │   ├── IslandDecorations.tsx
│   │   │   ├── Ocean.tsx
│   │   │   ├── PetDog.tsx
│   │   │   ├── PlacementGhost.tsx
│   │   │   ├── Scene.tsx
│   │   │   ├── SkyDome.tsx
│   │   │   ├── StickFigure.tsx
│   │   │   ├── Torch.tsx
│   │   │   └── Weather.tsx
│   │   ├── TrackerView.tsx
│   │   └── UI/
│   │       ├── AccountPanel.tsx
│   │       ├── AuthScreen.tsx
│   │       ├── AvatarIcon.tsx
│   │       ├── BuildModeOverlay.tsx
│   │       ├── CategoryIcon.tsx
│   │       ├── CategoryTabs.tsx
│   │       ├── ControlsHint.tsx
│   │       ├── DesignKit.tsx
│   │       ├── EmoteGrid.tsx
│   │       ├── FloatingPanelPortal.tsx
│   │       ├── InteractionPrompt.tsx
│   │       ├── LoadingScreen.tsx
│   │       ├── LoginBonusPopup.tsx
│   │       ├── MiniMap.tsx
│   │       ├── MobileControls.tsx
│   │       ├── MusicPlayer.tsx
│   │       ├── NavBar.tsx
│   │       ├── PettingMiniGame.tsx
│   │       ├── PlacementOverlay.tsx
│   │       ├── SideButtons.tsx
│   │       ├── TopBar.tsx
│   │       ├── WeatherToast.tsx
│   │       └── ZoomControl.tsx
│   ├── constants/
│   │   ├── bgmTracks.ts
│   │   ├── buildingPositions.ts
│   │   ├── cameraZoom.ts
│   │   ├── items.ts
│   │   └── rooms.ts
│   ├── context/
│   │   ├── AppContext.tsx
│   │   ├── useEconomyActions.ts
│   │   └── usePlacementActions.ts
│   ├── hooks/
│   │   ├── useEquippedBuildings.ts
│   │   ├── useEscapeToClose.ts
│   │   ├── useIsTouchDevice.ts
│   │   ├── useLightningFlicker.ts
│   │   ├── useScrollIsolation.ts
│   │   └── useViewportWidth.ts
│   ├── index.css
│   ├── lib/
│   │   ├── firebase.ts
│   │   ├── playerBus.ts
│   │   ├── soundUtils.ts
│   │   └── vibration.ts
│   ├── main.tsx
│   ├── types.ts
│   └── utils/
│       ├── categoryUtils.ts
│       ├── placementRules.ts
│       └── weatherSway.ts
├── tsconfig.json
└── vite.config.ts

```

### 核心架構與組件說明
- **src/App.tsx**：應用程式的進入點，負責 Context Provider 包裝與主路由切換。
- **src/components/Three/Scene.tsx**：3D 場景的核心，包含光照、地形、天空和所有 3D 物件的掛載，是 Three.js 世界的總管。
- **src/components/Three/Avatar.tsx**：玩家角色的 3D 模型與動畫邏輯。包含複雜的狀態機（走路、跑步、多種游泳姿態、躺吊床、表情動作等）。
- **src/components/Three/CameraController.tsx**：控制攝影機，支援第一人稱/第三人稱的平滑切換，以及支援建造模式的自由視角。
- **src/lib/AppContext.tsx**：全域狀態管理中心，存放玩家基本資料、裝備、背包內容、視角狀態與 UI 控制。
- **server.ts**：後端 Express 伺服器，負責與 Gemini AI 串接，提供智能商店助手的對話功能。
- **src/lib/playerBus.ts**：輕量級狀態匯流排，用來在 React UI 組件與 3D 渲染迴圈 (useFrame) 之間高頻率傳遞玩家座標，避免觸發 React 重新渲染。
- **src/lib/soundUtils.ts**：負責環境音效處理，例如動態合成游泳的水聲與氣泡聲，完全利用 Web Audio API 生成。

