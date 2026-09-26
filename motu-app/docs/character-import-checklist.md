# 玩家模型導入 Checklist

真正導入自製 3D 模型前，逐項確認這一份。
架構說明看 [character-model.md](./character-model.md)；這裡只講「要檢查什麼、怎麼算過」。

> **已經有一個模型導入了**（六個部位全部）。它是怎麼切的、改了 Blender 檔之後要做什麼，
> 看 [character-authored-model.md](./character-authored-model.md)。
> 那一份裡的 `npm run split:character` 會自動處理下面第〇節的**單位**與 **pivot**
> ——所以那兩項現在是「量出來」而不是「建模時要記得」。

**標記說明**

| 標記 | 意思 |
|---|---|
| 🤖 | **自動檢查**。載入時 console 會直接講，或 `npm run` 會擋下來 |
| 👁 | **要用眼睛看**。沒有程式能判斷，必須在遊戲裡確認 |

---

## 〇、開始建模之前（成本最高的三件事）

這三項做錯，是整包重做；其他項目都只是調整。

- [ ] 🤖 **單位**：全身總高 **0.9617 LOCAL**（不是公尺）。
      在 Blender 用 1.7 m 真人尺寸做，匯入後會是 **巨人**。
      要嘛建模時就照這個尺寸，要嘛匯出時設 scale。
      → 載入時若差距超過 1.5 倍，console 會直接告訴你要乘以多少。
- [ ] 🤖 **Pivot（原點）**：每個部位的原點要放在 **關節**，不是部位中心。
      head = 脖子旋轉點｜torso = 軀幹中心｜arm = **肩膀**｜leg = **髖關節**
      → 手臂用自己的中心當 pivot 是最常見的匯入 bug：**站著看起來完全正確，一走路就脫節**。
- [ ] 👁 **朝向**：角色正面朝 **+Z**，+Y 上，+X 是角色的左邊。
      Blender 是 Z-up，glTF 匯出器會自動轉成 Y-up，通常不用手動處理。

---

## 一、格式與匯出

- [ ] **Model Format**：匯出 **`.glb`**（glTF-Binary）。
      不要用 `.gltf`（貼圖是分開的檔案，移動資料夾就壞）、不要用 `.fbx`（專案沒有接
      FBXLoader，且單位／軸向依匯出器而異）、不要用 `.obj`（沒有骨架也沒有動畫）。
      → 理由寫在 `src/constants/characterAssets.ts`。
- [ ] **檔案位置**：放到 `public/models/character/`。
      檔名照 `CHARACTER_MODEL_FILES`（`head.glb` / `torso.glb` / `arm-left.glb` …）。
      **路徑只寫在 `characterAssets.ts` 一個地方**，不要在別的檔案裡再打一次。
- [ ] 🤖 **Scale**：見上面第〇節。載入時自動比對。
- [ ] 🤖 **Origin**：見上面第〇節。原點離幾何太遠時 console 會警告。
- [ ] 👁 **Rotation**：匯出後角色是站直的、面朝 +Z，沒有躺著或轉 90 度。

---

## 二、骨架與動畫

> ⚠️ **目前沒有規定任何 bone 名稱，也沒有規定一定要有骨架。**
> 驗證程式只會「回報」找到什麼，不會要求任何特定的 rig。
> 等真正的模型做出來、確定 rig 長什麼樣，再回來把這一節寫死。

- [ ] 🤖 **Skeleton**：有沒有骨架都可以。
      **沒有骨架完全沒問題** —— 目前的動畫是由 Controller 旋轉「關節 group」達成的，
      掛在關節下的可以是一整塊硬邦邦的 mesh。
      → console 會回報有幾根骨頭、叫什麼名字。
- [ ] **Bone Names**：**目前不需要對齊任何名稱。** 若未來要改成骨骼動畫，
      再依實際模型決定命名，不要為了配合現有程式硬取名。
- [ ] **Animation**：**模型不需要自帶動畫 clip。**
      走路、游泳、坐下、躺下、情緒動作目前全部由 `Avatar.tsx` 的 useFrame 驅動，
      模型只要把關節接對就會自動套用。自帶的 clip 目前不會被播放（console 會列出來）。

---

## 三、接地與外框（兩條鐵則）

- [ ] 🤖 **腳底在 `soleY`（-0.005 LOCAL）**：Root 原點就是接地點。
      → `npm run audit:ground` 會把角色放到草地、沙灘、木平台、每顆岩石、土丘與室內地板上檢查。
- [ ] 🤖 **頭頂在 `crownY`（總高 2.1638 WORLD）**：門的淨空、家具比例、攝影機距離全照這個調的。
      → `assertRigInvariants()` 在模組載入時就跑，數字錯了直接丟 Error。
- [ ] **要改比例**：改 `AUTHORED_SKELETON`（`src/constants/characterRig.ts`），
      **一次改一個部位，跟資產同步**。中間怎麼分配都自由，只有頭頂和腳底不能動。

---

## 四、碰撞與攝影機（換模型時「不應該」需要動的東西）

這一節的正確結果是 **全部都不用改**。要是有哪一項需要調整，先確認不是第三節沒守住。

- [ ] **Collider**：不需要動。
      碰撞是 `CHARACTER_COLLIDER`（`characterRig.ts`）的一個圓柱體，
      **不是模型的 mesh**。沒有任何系統會去量角色的幾何來決定能不能走。
      → 模型再胖再瘦、加了披風，牆壁／家具／木平台／門的行為完全不變。
- [ ] **Camera Anchor**：不需要動。第一人稱視線高度由 `firstPersonFocusWorldY(skeleton)` 推導，
      頭的關節動，鏡頭自動跟著動。
- [ ] **Head Anchor**：不需要動，同上。
- [ ] 👁 **Indoor Camera**：進室內走一圈 —— 鏡頭沒有穿模、沒有跑到頭裡面、沒有突然縮近。
- [ ] 👁 **Outdoor Camera**：島上走一圈 + 貼牆 + 從正上方俯視 —— 鏡頭能越過頭頂。
- [ ] 👁 **第一人稱**：切到第一人稱，視線高度合理，看不到自己的臉。

---

## 五、掛載點（髮型／飾品／服裝）

換頭之後最需要重新對位的就是這一節。

- [ ] 👁 **Hair Attachment**：`hair` socket。
      ⚠️ **整套髮型排版引擎是照「球形頭」推導的**（`constants/hair.ts`）：
      半徑會自動讀 `head.halfWidth`，但髮際線、耳線、臉部開口角度仍是球面量出來的。
      **換成非球形的頭，要重新檢查這些 landmark，不是只改半徑。**
      → `npm run audit:hair` 檢查髮型有沒有超出頭部包絡。
- [ ] 👁 **Accessory Attachment**：帽子 / 墨鏡 / 面具 / 耳環 / 髮飾 / 花冠 / 光環 / 披風 / 項鍊 /
      腳環 / 地面光環 —— 每個都是 `AUTHORED_ATTACHMENTS` 裡的一個具名 socket，
      **沒有任何一個是寫死座標**。頭變小就把 head sockets 的 `scale` 設 < 1
      （v2 用 0.81 = 0.21/0.26），舊飾品會自動縮到新頭的尺寸。
- [ ] 👁 **Clothing Compatibility**：上衣 / 褲子 / 鞋子。
      ⚠️ **全部服裝幾何都是照 legacy 的 0.26 球頭 / 0.135 膠囊軀幹做的**，
      `Pants.tsx` / `Shoes.tsx` 直接車在 `LEG_RADIUS = 0.055` 的腿上。
      新身體不見得穿得下 —— 這是**已知且刻意的**，見 character-model.md 第七節。
      → 還沒適配時，把該部位的 `wearsWardrobe` 留成 false，寧可裸體也不要穿歪。
      → `wearsWardrobe` **現在真的有作用**：設 true 時 `AuthoredCharacterModel` 會把該部位的
      飾品畫在關節與 `transform` 裡面（袖子因此跟得上有角度的手臂）。
      目前導入的模型六個部位都是 true，見 character-authored-model.md 第四節。

---

## 六、外觀與材質

- [ ] **Shadow**：不用處理，載入器會自動 traverse 補上 `castShadow`。
      （glTF 沒有 castShadow 這個概念，不補的話「整個角色只有新匯入那塊不投影」，
      很容易被誤判成模型做壞了。）
- [ ] 🤖 **Material**：每個 mesh 都要有材質。沒有的話 console 會報錯（會變成預設白色）。
- [ ] **顏色偏淡？** glTF 的 `baseColorFactor` 是 **linear** 不是 sRGB。
      在 Blender 裡選色再匯出是正確的；只有手改 JSON 數值才會踩到。
- [ ] 🤖 **Texture**：最長邊 ≤ **1024 px**。角色在畫面上的大小再高也看不出差別。

---

## 七、效能

> 這個專案過去出現過卡頓，而且是 **draw call / 主執行緒** 的問題，不是填充率的問題。
> 所以 **mesh 數量比三角形數量重要**：拆成 50 個小物件，比合併成 1 個但三角形多五倍還糟。

- [ ] 🤖 **Performance**：整隻角色的預算（`CHARACTER_MODEL_BUDGET`）
      —— 三角形 30,000｜mesh **40**｜材質 8｜貼圖 1024px。
      → 載入時 console 會印出目前累計用量，超了會警告（但不會擋，還是會畫出來）。
- [ ] 👁 **Desktop Performance**：跑一圈，對照導入前的幀數。
- [ ] 👁 **Mobile Performance**：手機／平板實機各跑一次。
      （這個遊戲的比例本來就要在實機上判斷，見 character-model.md。）
- [ ] **檔案大小**：`dist/` 目前有進版控，`public/` 的模型 build 時會被複製一份，
      **等於同一個二進位檔在 repo 裡存兩份**。模型開始變大時要先處理這件事。
- [ ] Draco / meshopt 壓縮 **目前沒有接**。等有真實資產、量得出大小再決定，不要提前做。

---

## 八、實際玩一遍（👁 全部都要人來看）

換模型之後，這些系統在程式上都不需要改 —— 但還是要確認眼睛看到的是對的。

- [ ] **Idle**：站著不動，呼吸／待機動作正常，沒有抽動。
- [ ] **Walking / Running**：走跑一圈。**特別看四肢有沒有從關節脫開**（pivot 錯的典型症狀）。
- [ ] **Swimming**：下水 → 游 → 放開 WASD → 上岸。
      臉要露出水面，身體不能翻轉或抽搐。
      → `npm run audit:swim` 會檢查有沒有翻身、抽動、卡住。
- [ ] **Interaction**：坐下、躺下、開門、進出家裡。
      → `npm run audit:interactions` 檢查每個坐點／躺點有沒有落在家具上。
- [ ] **Building Mode**：進建造模式，放置家具，確認角色沒有擋住視線或穿模。
- [ ] **Interior / Exterior**：室內室外各走一遍，確認比例一致、沒有陷進地板或浮空。
- [ ] **更衣室**：換裝預覽正常。
      （更衣室跟遊戲內用的是**同一個 `<Avatar>`**，所以這裡不會有「兩套模型」的問題。）
- [ ] **跳躍 / 落地**：跳一下，落地的 squash 正常。
- [ ] **情緒動作**：眨眼、笑、揮手、翻滾。沒有臉的模型可以不綁 `eyeL/eyeR/mouth`，
      Controller 會 null-check，不會壞。

---

## 九、出事的時候

- **某個部位載入失敗** → 會自動退回該部位的程式生成版本，**遊戲不會壞**，
  console 有明確訊息（`[character] the "head" part failed to load…`）。
- **想馬上退回舊模型** → 網址加 `?character=legacy`，或 `setCharacterModel('legacy')`。
  三個模型並存，**舊模型在新模型完成前不會被移除**。
- **接縫露出來** → 那是資訊不是 bug。skeleton 和資產要**一次改一個部位**，
  腿還是 legacy 就先把髖關節移到新位置，縫是在告訴你差多少。
