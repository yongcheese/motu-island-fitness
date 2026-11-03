# 家具互動 — Furniture Interactions

「家具自己說明它能做什麼」，而不是「角色控制器裡列一張家具名字的清單」。

這份文件說明系統怎麼組成、加一件會互動的家具要動哪一個檔案，以及為什麼座位高度是手寫的、
其他所有尺寸卻都是量出來的。程式碼裡的註解寫的是「為什麼」，這裡寫的是「在哪裡」。

---

## 一、它取代了什麼

在這之前，「這個東西能不能互動」的答案有兩份，兩份都寫在 `Three/Avatar.tsx` 裡面，
兩份都用**中文品名**比對：

```ts
if (item.name === '吊床') { ... }                                    // 唯一能躺的東西
const INTERACTIVE_DECOR_NAMES = ['木製鞦韆', '溫馨營火', '黃銅望遠鏡', ...];   // 會播動畫的五個
```

所以「這是一個可以坐的東西」這件事，在整個專案裡不存在成為資料的形式：它是動畫檔案裡的
兩個 if。屋內完全沒有第三份清單 — 房子裡每一件家具都是純佈景，不管它長得多像一張椅子。

現在這個能力是家具自己宣告的欄位，和 `standable`、`tabletop`、`placement` 完全同一個位階。

---

## 一之二、它第二次取代了什麼（2026-09-02）

上面那一版把「能不能互動」變成了資料，但把**動詞**和**身體**塞在同一張表裡。
`INTERACTION_KINDS` 的 `pose` 欄只有兩個值 —— `'sit'` 和 `'lie'` —— 其他每一種都留空，
而「留空」在 `Avatar.tsx` 裡被導向**同一段 0.7 秒的雙手前伸**：

```ts
// 這四行就是 18 件家具的全部動畫
const reach = Math.sin((gestureAge / USE_GESTURE_DURATION) * Math.PI);
leftArm.rotation.x  = lerp(leftArm.rotation.x,  -1.35, reach);
rightArm.rotation.x = lerp(rightArm.rotation.x, -1.35, reach);
```

所以 泡澡、烹飪、觀星、洗手、許願、閱讀、添柴火、沖水、開冰箱… 逐格完全相同，
差別只有提示卡上的字。浴缸之所以只能「站在旁邊揮手」，不是因為有人替浴缸寫錯了動畫，
而是因為**這套詞彙裡沒有「在浴缸裡」這個詞**。

現在動詞和身體是兩個檔案，用名字接起來：

```
家具 (items.ts)
  ↓ interactions: [{ kind: 'bathe' }]
互動動詞 (furnitureInteractions.ts)   ← 提示上寫什麼、身體錨點在哪
  ↓ kind.posture = 'bathe'
姿勢 (interactionPostures.ts)          ← 全身關節目標、重複動作、閒置擺動、傾角、蹲低
  ↓ resolveOccupancyFrame / resolveActionFrame (lib/interactionPosture.ts)
關節角度 → Avatar.tsx 寫到 rig 上
```

新增一種互動 = 表格加一列。`Avatar.tsx` 裡沒有任何一個 `if` 認得任何一件家具或任何一種姿勢。

---

## 二、系統長什麼樣

```
constants/furnitureInteractions.ts   動詞（DATA）：提示寫什麼、選哪個姿勢、身體錨點在家具的哪裡
constants/interactionPostures.ts     身體（DATA）：14 種姿勢的全身關節目標 ← 新增姿勢改這裡
constants/items.ts                   目錄：每件家具的 `interactions` 欄位 ← 唯一要編輯的地方
constants/characterRig.ts            身體尺寸的契約；`volumes` = 身體（穿衣後）佔多大空間 ← 換模型改這裡

lib/interactionPosture.ts            純函式：姿勢 + 時間 → 關節角度（身體語言）
lib/occupantFit.ts                   純函式：身體在家具上的位置（由身體體積解出）+ 每幀的佔用姿勢
lib/furnitureInteraction.ts          執行期：local anchor → 世界座標、站位、找最近的、離開時往哪站
lib/furniturePlacement.ts            量出來的碰撞盒（本來就有的），這裡拿來當「接近判定」

components/Three/Avatar.tsx          把關節角度寫到 rig 上（applyBodyPose），一套流程處理所有家具
components/Three/InteractionPromptTracker.tsx   把提示投影到螢幕（島上一個、屋內一個）
components/UI/InteractionPrompt.tsx  「E 泡澡」那張卡（沿用原本的 HintBubble，沒有新樣式）
components/Three/FurnitureItem.tsx   家具自己的反應（useFurnitureTrigger）

tmp-interaction-fit.html?item=<id>   看任何一件家具被坐上去的樣子，並即時量出身體每個部位穿進家具多深
                                     （?model=authored|legacy|v2  ?clock=秒  ?xray=1  ?cam=side|front）
tmp-posture-preview.html?item=<id>   舊的姿勢預覽（legacy 模型、無擺動）
```

對外只有兩個接觸點：**`interactions` 欄位**，和 **`furniture-interact` 事件**。

### 姿勢用「關節名稱」寫，不是 ref

一個姿勢是 `Partial<Record<RigJointName, {x,y,z}>>`，寫的是「右手臂 -1.05」，
不是「往 rightArmRef 寫 -1.05」。這是 `characterRig.ts` 那份「控制器只依名字驅動關節」
契約的延伸：**未來把手臂拆成 upper / lower**，只要在 `RigJointName` 加一個名字、
在 `CharacterRig` 加一個 ref，現有 14 種姿勢和 `Avatar.tsx` 一行都不用改
（沒提到那個關節的姿勢就不碰它）。

會隨角色比例變的東西**故意不放在表裡**：髖部坐在座位的哪裡、躺著時頭抬多高、手要伸到哪裡才握得到繩，
都是從 rig 的身體體積和家具的錨點當場解出來的（`lib/occupantFit.ts`），跟椅墊高度不寫死是同一個理由。
表裡只有「身體語言」：前傾多少、腿自然往前垂多少（`legHang`）、手放哪。

---

## 三、加一件會互動的家具

### 站著做一件事（書桌、冰箱、望遠鏡…）

`constants/items.ts` 那一列加一個欄位就結束了 —— 挑一個**用途對得上的 `kind`**：

```ts
{ id: 'item-fridge', name: '雙開門冰箱', …, interactions: [{ kind: 'open', verb: '開冰箱' }] }
{ id: 'item-stove',  name: '嵌入式瓦斯爐', …, interactions: [{ kind: 'cook' }] }
```

提示會自動變成「E 開冰箱」，按下去角色會**走到家具正面站定、轉正**，做出那個 `kind` 對應的
全身動作，並且送出一個 `furniture-interact` 事件（帶 `instanceId`）。

站的位置**不用寫**：家具的盒子是量出來的，站位就是「盒子邊緣 + 玩家半徑 + 一點手的空間」。
要寫的只有一件事 —— 這件家具是**有正面的**（冰箱、爐子、洗手台）還是**沒有正面的**
（營火、許願井、望遠鏡）：

```ts
interactions: [{ kind: 'tend', verb: '添柴火', approach: 'nearest' }]
```

`approach: 'front'`（預設）= 走到家具的 +Z 面；`'nearest'` = 就從玩家現在那一側用它。

沒有現成的 `kind` 對得上時：先看 `interactionPostures.ts` 裡有沒有身體語言能借
（`posture: 'tend'` 可以覆寫任何 `kind` 選的姿勢），真的都不像才加一列新姿勢。

**要讓家具自己動起來**（門打開、燈亮、書翻頁），在 `constants/objectAnimations.ts` 加一列，
並在它的 model 裡掛 `useObjectAnimation` —— 見 `docs/interaction-feedback.md`。舊的
`useFurnitureTrigger`（每件自己一個 `useFrame` 與觸發時間戳）已經移除，營火、望遠鏡、鳥屋、許願井
也都搬到了共用的那一套。

### 可以坐 / 可以躺 / 可以泡

多四個數字，全部寫在**家具自己的座標系**裡（不是世界座標）：

```ts
interactions: [{ kind: 'bathe', surfaceY: 0.202, lateral: -0.30, facing: Math.PI / 2 }]
interactions: [{ kind: 'sit', surfaceY: 0.805, seatFront: 0.575 }]
interactions: [{ kind: 'lie', surfaceY: 0.719, headRest: 0.83, forward: 1.12, give: 0.25 }]
interactions: [{ kind: 'swing', surfaceY: 0.70, seatFront: 0.161, grip: { lateral: 0.593 }, sway: 'swing' }]
```

| 欄位 | 意思 |
| --- | --- |
| `surfaceY` | 身體靠著的那個面有多高（**未壓縮的**椅墊上緣、床墊上緣、吊床布面），從家具自己的底部量起。`audit:interactions` 會從上往下探測模型確認 |
| `seatFront` | 座位專用（腿從邊緣垂下的姿勢）：座位**前緣**在哪 —— 包含滾邊、橫桿等任何凸出來的東西。這就是座位的錨點 |
| `lateral` / `forward` | 身體落在家具的哪個位置（+Z 是家具正面）；有 `seatFront` 時不寫 `forward` |
| `facing` | 相對家具的朝向；0 = 面向家具的 +Z。**躺姿的身體是往後延伸的**（原點在腳），所以床頭在 -Z 的床要用 `facing: 0` 加上靠床尾的 `forward` |
| `give` | 0..1：這個面有多軟（身體陷進去自身背部厚度的幾成）。吊床 0.8、床墊 0.25、懶骨頭 0.35、木板 0 |
| `headRest` | 躺姿專用：頭底下那個東西（枕頭）的頂面高度。頭會枕在上面，而不是壓進去 |
| `grip` | 手要握住的東西 —— 兩條垂直的線（鞦韆的繩）在 ±`lateral`。手臂每幀會瞄準它 |
| `sway` | 家具會帶著身體動：`constants/outdoorAnimation.ts` 的一列（吊床、鞦韆、吊椅、搖椅） |

**身體放在哪裡不用寫。** 它是從 rig 的身體體積推出來的（`lib/occupantFit.ts`，見第九節）。
換一個腿比較長、頭比較大的角色模型，同一張沙發不用改任何一列。

---

## 四、為什麼只有座位高度是手寫的

這個專案的規矩是「尺寸用量的，不用寫的」（見 `lib/furniturePlacement.ts` 的檔頭）。
互動錨點是少數的例外，而且是必要的例外：**bounding box 裡沒有任何資訊能說出「這一面是椅墊」**。
一張沙發最高的面是椅背，一張書桌最高的面是桌板 —— 用「最高點」猜座位會坐到椅背上。

所以它換一種方式保證不會走鐘：**用檢查的**。

```
npm run audit:interactions
```

它會走 `FurnitureModel` 實際畫出來的 React element tree，量出每件家具的真實盒子，
然後把角色放上每一個錨點，檢查：

- `surfaceY` 真的落在這件家具的幾何範圍內，而且**就是模型在錨點處的實際表面高度**
  （從上往下探測；兩張沙發、一張餐椅、兩張床就是這樣被抓到的）
- 錨點的 XZ 真的在家具的 footprint 上（不是坐在旁邊）
- **躺下時整個身體放得下**（每個角色模型）— 腳到頭頂兩端都要在家具上
- **最重要的一項（part 3）：身體有沒有穿進家具。** 對每個角色模型（authored / legacy / v2）、
  每一個占用型互動，用遊戲本身的 `resolveOccupantPose` 擺好姿勢，在閒置動作的四個時刻、
  以及會擺動的家具整個擺幅的各個角度，把身體體積每 2.5 公分取一個點，逐一測試是否落在家具
  **任何一個網格的實體內**。超過 2 公分（軟的表面再加 `give` 允許的下陷量）就失敗。
  會擺動的家具，模型裡實際擺動的那個群組會被轉到同一個角度，並檢查它的支點高度是否等於
  `outdoorAnimation.ts` 那一列的 `pivotY`（搖椅就是這樣被抓到的）
- **姿勢表本身也被檢查**：占用型一定要說腿要幹嘛、垂腿的要有 `legHang`、動作型一定要有 duration、
  重複動作不能驅動一個 `hold` 沒擺過的關節（那幾乎一定是關節名字打錯）

舊版本只檢查「腿的中心線」與「包圍盒」，所以它讓鞦韆的腿從座板中間直直穿過、沙發的大腿陷進
坐墊 12.5 公分、床上的頭陷進床墊 20 公分都通過了，而且只檢查 legacy 模型。

第四部分（part 4）測的是執行期的三角函數：把沙發轉 90 度，座位有沒有跟著轉到正確的軸上；
起身的落點有沒有真的在碰撞盒外面（拿 `resolvePlayerAgainstFurniture` 驗）；接近判定用的是
**到盒子的距離**而不是到中心的距離。

---

## 五、一個家具可以有很多種互動

`interactions` 是陣列，順序有意義：**第一個就是 E 會做的事**。

玩家只有一顆互動鍵，所以現在只有第一個會被觸發；其餘的是給未來那個「按住 E 出現選單」的
介面用的。`Sit + Storage`、`Sleep + Rest` 這種組合在資料層是已經成立的，不需要改任何核心程式。

---

## 六、和其他互動系統的關係

提示的排序只有一條規則，而且是原本就有的：**同一時間只顯示最近的那一個**
（`InteractionPromptTracker` 的 `candidates.sort`）。家具只是加入這個排序，沒有自己的提示層。

按下 E 之後做什麼，是照**畫面上正在顯示的那個提示**決定的（`playerBus.interactionPrompt.key`），
不是照優先順序表 —— 這正是以前「和家具互動卻誤觸進入房屋」的修法，這次沿用沒有改。

屋內是**第二個 Canvas**，所以屋內另外掛一個 `InteractionPromptTracker scope="interior"`。
兩個 tracker 寫同一個 `playerBus.interactionPrompt`，所以**沒在畫面上的那一個不會去清空它**
（不然就變成看誰的 render loop 跑得晚）。

---

## 七、姿勢表（14 種）

分兩族。差別只有一個：**玩家會不會留在上面**。其他欄位兩族共用，這正是讓「泡澡」和「洗手」
是同一種東西的原因。

### 占用型 — 身體上到家具上，要按 E 才起身

| 姿勢 | 身體 | 用它的家具 |
| --- | --- | --- |
| `sit` | 直立坐著、手放大腿、腿往下擺到地板或家具前緣（取較大者） | 9 張沙發／椅子 |
| `lie` | 側躺、後仰角由 rig 推出（`liePitch`）、上床時腿跨過邊緣 | 3 張床 + 吊床 |
| `bathe` | 坐在浴缸內底、微微後仰、腿往前伸直、手浮在水裡、整個身體上下浮動 | 雙人獨立浴缸 |

### 動作型 — 走到家具前做一件事，然後把身體還回來

| 姿勢 | 身體 | 用它的家具 |
| --- | --- | --- |
| `reach` | 雙手前伸（**舊系統唯一的那個動作**，現在只是預設值） | — |
| `open` | 單手抓把手往回拉、肩膀跟著轉開 | 冰箱、衣櫃、烤箱 |
| `operate` | 單手在面板高度，連按三下，低頭看 | 馬桶、微波爐、收音機 |
| `cook` | 俯身、一手扶鍋一手畫圈攪拌 | 瓦斯爐 |
| `wash` | 雙手在下方互相搓洗，反相 | 洗手台 |
| `observe` | 雙手舉到臉前、**下巴抬起**、身體微微後仰、左右掃視 | 望遠鏡、鳥屋 |
| `read` | 雙手捧在胸前、低頭、中途翻一次頁 | 書桌 ×2、書架 |
| `wish` | 雙手合十在胸前、深深低頭、身體前傾 | 許願井 |
| `tend` | **蹲低 0.24**、前後腿分開、單手往下撥 | 營火 |
| `groom` | 單手舉到頭髮、頭偏一邊、肩膀轉開 | 梳妝台 |
| `push` | 雙手前推、大幅來回兩次、身體壓上去 | —（木製鞦韆已改為坐上去的 `swing`） |

`bathe` 的 `lean` 是 **-0.10**，而且那是**幾何預算，不是品味**：後仰是繞著「根原點」轉的，
而坐在缸底的身體根原點在缸底下 0.33，所以每一 radian 的後仰會把頭往後甩掉一整個頭關節高度
（1.57）。第一版寫 -0.22，chibi 的大頭就穿出缸壁 0.28 —— 修法不是把浴缸做大，是少仰一點。
`npm run audit:interactions` 現在會擋住這件事。

### 鞦韆：從「推」變成「盪」

鞦韆最早是 `push`（站在旁邊推），因為當時互動點只能是家具座標系裡的靜態一點，而鞦韆的座板會動。
現在身體是「掛在」家具的支點上（見第九節），會擺動的家具由 `sway` 指到 `outdoorAnimation.ts` 的一列，
模型與角色控制器用**同一個函式、同一條時間軸**算出同一個角度 —— 所以鞦韆是 `swing`（坐上去盪），
`push` 留給其他需要推的東西。

## 八、目前有互動的家具（31 件，全部重新分類過）

| 家具 | 動詞 | 姿勢 |
| --- | --- | --- |
| 奢華沙發、藤編單人沙發、亞麻雙人沙發、L 型布沙發、棉麻懶骨頭、復古扶手椅、原木搖椅、人體工學網椅、木製餐椅 | 坐下 | `sit` |
| 五星級雙人床、原木單人床、帳篷風格床 | 躺下 | `lie` |
| 吊床（戶外） | 休息 | `lie` |
| **雙人獨立浴缸** | **泡澡** | **`bathe`** |
| 橡木書桌、松木工作桌、海風書架 | 閱讀 | `read` |
| 嵌入式瓦斯爐 | 烹飪 | `cook` |
| 大理石洗手台 | 洗手 | `wash` |
| 雙開門冰箱 / 實木大衣櫃 / 烤箱 | 開冰箱 / 整理衣物 / 烘烤 | `open` |
| 科技馬桶 / 微波爐 / 復古收音機 | 沖水 / 加熱 / 轉開收音機 | `operate` |
| 梳妝台 | 整理儀容 | `groom` |
| 黃銅望遠鏡 / 手作鳥屋（戶外） | 觀星 / 看看小鳥 | `observe` |
| 許願井（戶外） | 許願 | `wish` |
| 溫馨營火（戶外） | 添柴火 | `tend` |
| 木製鞦韆（戶外） | 盪鞦韆 | `swing`（坐在座板前緣、手握繩、隨座板擺動） |
| 吊椅（戶外） | 坐進吊椅 | `hangSeat`（隨吊籃擺動） |
| 帳篷（戶外） | 在帳篷前休息 | `recline`（帳篷高 1.1、角色高 2.2，身體放不進帳篷裡，改為坐在門口的睡墊上） |

目錄裡**沒有**凳子、長凳、鋼琴。要加的話：做出 model，在 `items.ts` 那一列加 `interactions`，
挑一個現成的 `kind`（或加一列動詞 + 一列姿勢），跑一次 `npm run audit:interactions`
確認錨點落在家具上 —— `Avatar.tsx` 不用動。

---

## 九、身體放在哪裡：用身體體積解出來（lib/occupantFit.ts）

### 為什麼不能「把髖關節放在椅墊上」

這個角色**沒有膝蓋**：腿是一整段從髖到腳底的膠囊，半徑約 0.14～0.19（世界單位，含褲子）。
舊的做法把髖關節**放在座面上**、在前緣後面一個腿粗的地方，於是：

- 大腿的下半截本來就在座面底下；腿往下垂時整條腿穿過座位前緣 —— 奢華沙發 12.5 公分；
- 鞦韆的錨點在座板**正中央**、腿直直往下垂，整條腿從 10 公分厚的座板中間穿出去；
- 身體的前傾是繞「根點」（腳底所在、坐著時懸在座面下半公尺的一個點）轉的，
  所以每一度前傾都讓臀部在座面上滑動；鞦韆擺動時臀部在座板上前後滑 9 公分。

### 現在的做法

1. **rig 宣告身體佔多大**（`CharacterSkeleton.volumes`）：頭是球、軀幹與四肢是膠囊（腿上粗下細），
   量的是**穿著衣服**的外緣。每個模型各自宣告；`assertRigInvariants` 檢查體積剛好碰到腳底與頭頂，
   `audit:interactions` 用它檢查每一件家具。
2. **座位（腿從前緣垂下）**：從側面看，身體是幾個圓與圓角長條，座位是「前緣後方、座面下方」的一個象限。
   髖部放在「**腿的表面剛好靠在前緣**」的位置 —— 這是沒有膝蓋的腿唯一不會穿過座位的坐法；
   如果軀幹會碰到座面，就沿著腿的方向往上滑到剛好不碰（`fitOverEdge`）。
   因為前緣剛好在髖關節一個腿粗外，腿繞髖轉動時表面只在那個圓上移動，可以往前後擺約 20° 都不碰到
   —— 鞦韆上的踢腿動作就被夾在這個範圍內（`legSlack`）。
3. **坐在表面上 / 躺下**：身體放低到最低的體積剛好碰到表面（減去 `give`，`fitOnSurface`）。
   躺姿的抬頭角從體積算出：頭的最低點不低於身體其他部位（或 `headRest` 枕頭）的最低點（`lieHeadRise`）。
4. **每一幀**（`resolveOccupantPose`）：身體「掛」在支點上（坐姿是髖關節、躺姿是腳底）。
   姿勢的前傾、閒置晃動、會擺動的家具的弧線，**全部繞支點旋轉**；會擺動的家具把支點當成家具上的一個點
   跟著擺，身體再依 `bodyFollow` 跟著轉（鞦韆是身體前後的俯仰、吊床是沿著身體的翻滾）。
   腿與手則是在**家具的座標系**裡擺好再換算成關節角度：腿永遠停在不碰座位的範圍，手永遠握在繩上。
5. **手臂的模型靜止外展角**（authored 模型的手臂本身外張 30°）會在套用姿勢前扣除
   （`compensateArmSplay`），所以姿勢表寫的手臂方向在每個模型上都是同一個方向。

### 換角色模型時要做的事

只要在 `characterRig.ts` 為新模型填好 `volumes`（量穿衣後的外緣），然後跑
`npm run audit:interactions`：每一件家具都會用新模型的身體重新檢查一次。家具目錄不用改。
