# 玩家人物模型架構 (Character Model Layer)

匯入自製 3D 模型時，看這一份就夠。
真正動手匯入前，逐項確認 **[character-import-checklist.md](./character-import-checklist.md)**。

> **已經有一個自製模型導入並在跑了**（`?character=authored`，六個部位全部）。
> 這一份講的是**架構**；那一個模型實際上怎麼切、改了 Blender 檔之後要跑什麼，
> 看 **[character-authored-model.md](./character-authored-model.md)**。
> 下面第五節的手動流程仍然有效，但那個模型是用 `npm run split:character` 一個指令切出來的，
> 單位與 pivot 都由腳本量出來，不必手動對。

---

## 一、架構總覽

```
Player Character
│
├── Character Controller ......... src/components/Three/Avatar.tsx
│     ├── Movement / Animation ... 同檔案的 useFrame（唯一的動畫迴圈）
│     ├── Collision .............. characterMovement.ts + placementRules.ts
│     ├── Camera Target .......... CameraController.tsx（只讀數字，不讀 mesh）
│     └── Interaction / VFX ...... 腳步、水花、漣漪（都在模型之外）
│
├── Rig (九個 joint refs) ........ src/components/Three/character/types.ts
│
├── Configuration ................ src/constants/characterRig.ts   ← 座標/尺寸唯一來源
│                                    （骨架、掛載點、以及 CHARACTER_COLLIDER 碰撞體）
│
├── Assets ....................... src/constants/characterAssets.ts ← 模型路徑唯一來源
│
└── Character Model .............. src/components/Three/character/
      ├── legacy/ ................ 現行程式生成模型（保留，未刪除）
      ├── CharacterModelV2.tsx ... 程式生成改版（可切換）
      ├── AuthoredCharacterModel . 自製 3D 模型（逐部位匯入）
      ├── slots.tsx .............. 部位註冊表（匯入時只改這裡）
      └── partLoader.tsx ......... 載入 / 驗證 / 失敗退回
```

**核心規則：模型只擁有幾何，其他什麼都不擁有。**
模型沒有 state、沒有 useFrame、不讀輸入、不碰 playerBus。所有會動的東西都由
Controller 透過 rig 驅動，所以兩個模型不可能動得不一樣 —— 因為只有一個動畫迴圈。

---

## 二、切換模型

| 方式 | 用法 |
|---|---|
| 網址 | `?character=legacy` / `?character=v2` / `?character=authored` |
| 程式 | `setCharacterModel('authored')`（會存 localStorage，即時切換不需重載） |

預設是 `authored`（自製模型，六個部位全部導入之後升上來的）。舊模型用 `?character=legacy`。
三個模型並存，舊模型不會被移除——它同時還是任何部位載入失敗時的退路。

| id | 內容 | 穿服裝 |
|---|---|---|
| `legacy` | 現行球頭 chibi，全套服裝都是照它做的 | ✅ |
| `v2` | 程式生成改版（圓角方頭、耳朵、細四肢） | ❌ 目前刻意裸體 |
| `authored` | **自製 3D 模型用這個。** 未註冊的部位自動用 legacy 補上 | ✅（legacy 部位） |

---

## 三、座標規範

三種空間，搞混就是匯入出錯的頭號原因：

| 空間 | 定義 |
|---|---|
| **WORLD** | 島嶼、房屋、攝影機用的公尺 |
| **LOCAL** | Character Root 的空間。`WORLD = LOCAL × 2.25`，**原點在腳底接地點** |
| **PART** | 各部位自己的空間，**原點在該部位的 JOINT（旋轉點）**，+Z 朝角色正面 |

軸向：+X 是角色的左邊、+Y 上、+Z 臉的正前方。

### PART 空間 —— 模型 pivot 要對到哪裡

| 部位 | Pivot 位置 |
|---|---|
| head | 脖子旋轉點（不是頭骨中心） |
| torso | 軀幹**中心**（不是底部） |
| arm | **肩膀** → 手臂往 -y 垂下 |
| leg | **髖關節** → 腳底落在 `attachments.foot` |

> 最常見的匯入 bug：手臂用自己的中心當 pivot。站著看起來對，一走路就脫節，
> 因為動畫是繞 joint 旋轉的。

---

## 四、兩條不可打破的鐵則

寫在 `characterRig.ts`，每個 skeleton 在載入時都會被 `assertRigInvariants()` 檢查，
數字錯了會直接丟 Error，不會默默出貨。

1. **腳底在 `soleY`（-0.005 LOCAL）**
   Root 原點就是接地點。地形取樣、腳步 VFX、影子接觸都靠它，沒有任何一個會去
   raycast mesh 來確認。做錯 → 人物浮空或陷進沙灘。

2. **頭頂在 `crownY`（總高 2.1638 WORLD）**
   門的淨空、家具比例、攝影機距離、第三人稱構圖全都是照這個調的。
   改總高 = 要重調整個世界，那不是換模型，是另一件工程。

**中間隨便你。** 頭多大、四肢多粗、腰在哪，都是模型自己決定的 —— 比例自由，
外框不自由。

### 想改比例又要守住鐵則

v2 是現成範例：頭要縮小（半高 0.26 → 0.21），就把頭的 joint 抬高同樣的量
（0.68 → 0.73），頭頂位置完全不變。

---

## 五、匯入流程（Head → Torso → Arms → Legs）

每個部位都是**獨立可選**的。沒註冊的自動用 legacy 補上，所以角色永遠是完整的、
永遠能走 —— 頭做好的當天就能測試，不必等整個身體。

### 建模時就要決定對的三件事（出錯的成本最高）

| 項目 | 規則 |
|---|---|
| **單位** | 用 **LOCAL**，不是公尺。全身總高 `0.9617`。頭大約 `0.42 ~ 0.52` 高。<br>如果在 Blender 用真人尺寸（1.7 m）做，匯入後會是巨人 —— 要嘛建模時就縮，要嘛匯出時設 scale。 |
| **Pivot** | 原點放在 **joint**（見上面第三節的表）。這是最常見的匯入 bug。 |
| **朝向** | 角色正面朝 **+Z**。Blender 是 Z-up，glTF 匯出器會自動轉成 Y-up，通常不用手動處理。 |

### 步驟

1. 把檔案放到 `public/models/character/head.glb`。
   （`public/` 已經存在，目前放著 HDRI。）
   → dev 直接以 `/models/character/head.glb` 供應，`npm run build` 會複製進 `dist/`。

2. 打開 `src/components/Three/character/slots.tsx`，把對應那行取消註解：

   ```tsx
   export const AUTHORED_PARTS = {
     head: { Component: (p) => <GlbPart url={CHARACTER_MODEL_FILES.head} {...p} /> },
   };
   ```

   **路徑不要在這裡打字。** 檔名統一寫在 `src/constants/characterAssets.ts`，
   一個地方改，全部跟著改。

3. 開 `?character=authored`，**然後看 console**。載入器會回報這個部位的
   bounding box、原點偏移、骨架內容、三角形／mesh／材質用量，
   單位錯了或 pivot 沒對到關節都會直接講（見下面「已經幫你處理掉的坑」）。
4. 對照 `AUTHORED_SKELETON` 檢查 joint 是否吻合，需要時調整那張表
5. 確認動畫（走路、游泳、情緒動作都會自動套用，不需要另外接）
6. 下一個部位重複

### 已經幫你處理掉的坑

- **載入失敗不會弄壞遊戲**：檔名打錯、檔案壞掉、格式不支援，`useGLTF` 都會 throw。
  每個部位各自包了一層 error boundary（`CharacterPartBoundary`），
  **失敗的那一個部位退回程式生成版本，其他部位照常**，console 有明確訊息。
  沒有這層的話，一個打錯的檔名會一路炸到 main.tsx 的 app-level boundary，
  **整個遊戲變成錯誤畫面** —— 對一個「模型要一個一個丟進來試」的專案來說，
  這是不能接受的爆炸半徑。
- **匯入時會自己檢查**（只在 dev）：`validateCharacterPart` 會檢查有沒有幾何、
  有沒有材質、bounding box 是不是有效數值、**尺寸的數量級對不對**（單位錯誤是
  最容易發生又最看不出來的坑，在建模軟體裡看起來完全正確），以及原點有沒有離幾何太遠
  （pivot 沒放在關節）。骨架和動畫只會「回報」，**不會要求任何特定的 bone 名稱或 rig**。
- **陰影**：glTF 沒有 castShadow 這個概念，匯入的 mesh 預設**不投影**。整個角色只有你
  新匯入的那塊不投影，看起來像浮在身上，而且很容易被誤判成模型做壞了。
  `GlbPart` 會 traverse 整棵樹補上 `castShadow`。
- **Suspense**：資產還在下載時不會讓整個角色消失 —— 每個部位有自己的 Suspense 邊界，
  fallback 是 legacy 的同一個部位。（角色若在載入時 unmount，rig 的 refs 會整組掉光。）
- **重複掛載**：`useGLTF` 每個 URL 只快取一份 scene，所以 `GlbPart` 會 `clone`。
  沒有 clone 的話，同一個檔案掛兩次（例如左右手共用一個檔、或更衣室預覽與世界中的角色
  同時存在）會讓兩個實例搶同一個 Object3D 的 parent。

### 顏色偏淡？

glTF 的 `baseColorFactor` 是 **linear**，不是 sRGB。在 Blender 裡選色再匯出是正確的；
只有手改 JSON 數值時才會踩到（linear 0.16/0.62/0.56 看起來會是淡薄荷綠，不是 #2A9D8F）。

### 檔案大小與 dist

`dist/` 目前有進版控。放進 `public/` 的模型會在 build 時被複製一份到 `dist/`，
等於同一個二進位檔在 repo 裡存兩份。模型檔開始變大時值得先處理這件事。

`AUTHORED_SKELETON`（在 `characterRig.ts`）現在是 legacy 的複製品。**要改比例就改它** ——
legacy 的後備部位會跟著動，等於可以先在遊戲裡走一走看比例對不對，再決定要不要真的去建模。

> 匯入時 skeleton 也要**一次改一個部位**，跟資產同步。腿還是 legacy 就先把髖關節
> 移到新模型的位置，接縫會露出來 —— 那個縫是資訊，不是要繞過的 bug。

### 如果匯出的 pivot 改不了

`AuthoredPart.transform` 是逃生門，可以在 joint 和 mesh 之間補一層修正。
但**優先在建模軟體裡修**：修正寫在這裡，下一個打開 .glb 的人只會看到對不齊。

---

## 六、Attachment / 掛載點

服裝不再知道自己掛在什麼形狀的身體上，只知道自己掛在哪個 socket 上。

| Socket | 空間 | 掛什麼 |
|---|---|---|
| `hair` | head-local | 髮型（頭骨中心） |
| `hat` | head-local | 帽子（5 種） |
| `glasses` | head-local | 墨鏡（在臉的平面上，不是頭骨中心） |
| `mask` | head-local | 部落面具 |
| `ear` | head-local，左右鏡射 | 耳環 |
| `hairPin` | head-local，**在頭骨表面** | 髮夾、單朵花（特殊飾品） |
| `crown` | head-local | 花冠、頭環 —— **環繞**頭部而非覆蓋，所以不共用 `hat` |
| `halo` | head-local，**浮在頭頂上方** | 光環。唯一刻意不接觸身體的 socket |
| `torso` | torso-local | 上衣、泳裝、草裙 |
| `neck` | torso-local | 項鍊 |
| `charm` | torso-local | 墜飾（與 `neck` 分開，兩者可同時擁有） |
| `back` | torso-local，**在肩胛骨後方** | 披風、翅膀、背包。不鏡射（整件是一個物件） |
| `leg` | leg-local | 褲子 |
| `foot` | leg-local，**在腳底** | 鞋子 |
| `ankle` | leg-local，腳底上方 | 腳環（兩隻腳各自渲染，所以擺動不同步） |
| `aura` | **root-local，在地面上** | 地面光環。唯一不跟著身體轉向的 socket |
| `hand` | hand-local | 尚未使用；預留給手持物（工具、釣竿、提燈） |

> 新增一種飾品 = 在 `CharacterAttachments` 加一個 socket。
> 模型host不了的 socket 就不宣告，該飾品**不會渲染**，而不是渲染在錯的地方。

`AttachmentPoint.scale` 是讓舊服裝適配新身體的機制：頭變小的模型把 head sockets
設成 < 1，legacy 做的帽子就會縮到新頭的尺寸，而不是罩在外面。v2 用的是 0.81
（= 0.21 / 0.26）。

---

## 七、目前仍與 legacy 綁定的部分（誠實清單）

這些不是壞掉，是**還沒重新適配**，換頭時要處理：

| 位置 | 綁在什麼上 |
|---|---|
| `constants/hair.ts` | 整套髮型排版引擎是照**球形頭**推導的。半徑已改讀 `LEGACY_SKELETON.head.halfWidth`，但髮際線、耳線、臉部開口角度仍是球面量出來的 |
| `character/legacy/wardrobe.tsx` | 全部服裝幾何都是照 0.26 球頭 / 0.135 膠囊軀幹做的 |
| `Pants.tsx` / `Shoes.tsx` | 共用 `LEG_RADIUS = 0.055` 和推導的地面高度，直接車在 legacy 腿的膠囊上 |
| `HairSpinPreview.tsx` | 自己畫一顆預覽頭（半徑已改讀 rig，五官仍是 legacy 的） |
| `QVersionIcon.tsx` | 2D 商店圖示照 legacy 外觀畫的 |

**已經解耦的：** 攝影機、碰撞、移動、動畫、小地圖、互動、存檔、腳步 VFX、水花 ——
這些全部只讀 `playerBus.playerPos` 和 rig 的數字，沒有一個會去讀 mesh。

---

## 八、Rig —— Controller 到底寫了什麼

（實測 Avatar.tsx 的 useFrame，不是猜的）

| Joint | Controller 寫入 | 誰擁有位置 |
|---|---|---|
| `head` | rotation + `position.y`（每幀重設） | **Config** |
| `torso` | rotation + `position.y` + scale | **Config** |
| `leftArm` `rightArm` `leftLeg` `rightLeg` | **只有 rotation**（94 次寫入，0 次 position/scale） | **模型自己** |
| `eyeL` `eyeR` | `scale.y`（眨眼、瞇眼）+ `position.y` | 模型 |
| `mouth` | `scale`（笑容） | 模型 |
| `hairSway` | rotation | 由髮型綁定，不是身體 |

四肢只被寫 rotation —— **這就是為什麼肩膀和髖關節的位置可以完全由模型決定**，
移動它們不會改變任何一幀的擺動弧線。

> 跳躍是唯一一段用 **joint 名字**（`BodyPose`）而不是直接寫 ref 的全身動畫，
> 所以它是換模型時最不需要重寫的一段 —— 見 **[jump-animation.md](./jump-animation.md)** 第四節。

每個 joint 都是 `Group` 不是 `Mesh`：joint 是 Controller 擁有的**變換**，
底下掛什麼是模型的事 —— 可以是一個 mesh、五個 mesh，或一整個 GLB 節點。

---

## 九、Collider 與 Camera

兩者都屬於 **Character Controller**，不是模型：

- **Collider**：`CHARACTER_COLLIDER`（characterRig.ts）—— 走路半徑 0.35、
  攝影機迴避半徑 0.5、高度 1.9，全部集中在這一個地方。
  `PLAYER_PHYSICAL_RADIUS`（placementRules.ts）和 CameraController 的兩個常數
  現在都是從它讀的，不再各自抄一份。
  **視覺模型 ≠ 碰撞模型**：這是一個貼著 root 的直立圓柱，照 rig 外框開的，
  不是照任何一個模型的輪廓，也沒有任何系統會去量角色的 mesh —— 換模型不會偷偷改變碰撞。
- **Camera Target**：第一人稱視線高度由 `firstPersonFocusWorldY(skeleton)` 推導。
  以前這行寫死 `0.68 * 2.25`（legacy 頭高 × root scale，兩個數字都手抄進攝影機檔案）。
  現在頭動，鏡頭跟著動。

---

## 十、驗證

```bash
npm run lint          # tsc --noEmit
npm run build
npm run audit:hair    # 髮型仍在頭部包絡內
```

`characterRig.ts` 的 `assertRigInvariants()` 在模組載入時就跑，所以 joint 打錯字
會在開發時當場炸掉，而不是等到有人走過門口才發現角色陷在地裡 3 公分。
