# 寵物照護 — Pet State、Behaviour Layer、物種適配、消耗品與寵物窩

讓玩家從寵物的**行為**感覺到「這是一隻正在島上生活的動物」，而不是一個跟在後面的裝飾物。

這份文件的重點不是任何一件商品，而是它們底下的五層：**Pet Species**（狗貓鳥各自是什麼樣的動物）、
**Pet State**（狀態怎麼隨時間變）、**Behaviour Layer**（狀態怎麼變成行為）、
**Consumable Item**（消耗品怎麼被買、被拿、被用掉）與 **Habitat / Resting Spot**
（哪一種寵物該用哪一種窩，以及牠怎麼找到自己的那一個）。目標是「之後再加十種飼料、五款寵物窩、
**第四種寵物**，都不需要動任何一個既有系統」。

> **2026-09-01 的擴充**：物種變成一張資料表，休息處與飼料都宣告 `compatibleSpecies`，
> 每一隻寵物有自己的照護狀態，餵食流程從「開面板選飼料再走過去」改成「走過去按互動」。
> 詳見〈五、休息處怎麼跟物種配對〉、〈六、飼料〉、〈七、餵食流程〉與〈十一、新增一種寵物〉。

---

## 一句話架構

```
時間經過（沒有任何 Timer）
        │  settlePetCare(state, now)：用時間戳算出「現在是多少」
        ▼
營養 nutrition ──→ 活動力 energy      profile.islandState.pet.care
        │                                  ─── constants/petCare.ts
        │  petCondition() / petActivityResponse()
        ▼
活動力 activity ──→ 移動倍率 PetMotionScale（pace / liveliness / nestPull）
        │           × 離線心情 PET_MOODS（constants/islandReturn.ts）
        ▼
行為決策  decidePetBehavior(ctx, roll)     ← 每 3.5 秒一次，不是每一幀
        │
        ▼
目前行為  follow / wander / idle / goToBed / rest
        │  applyBehaviorSlot()：行為 → 一個座標
        ▼
移動與動畫  Three/IslandPet.tsx 每一幀走向那一個座標
```

物種是另一條**只讀不寫**的軸，它決定「哪些東西對這隻動物存在」：

```
pet item id  ──→ getPetSpecies()  ──→ PetSpecies  (dog / cat / bird)
                                          │  constants/pets.ts 的 PET_SPECIES_TABLE
                     ┌────────────────────┼────────────────────┐
                     ▼                    ▼                    ▼
        locomotion: ground/air   habitat.species 篩選   consumable.species 篩選
        （哪一個 mover）          （牠看得到哪些窩）      （牠看得到哪些食物）
```

餵食走的是另一條路，最後匯進同一個狀態：

```
商店買飼料（只顯示這隻吃得到的）→ profile.inventory（一般背包，一包一筆）
        │
走到寵物旁邊 → 「[E] 與小狗互動」 → 'pet-interact'
        │
寵物互動面板 → 餵食 → 只列出「相容 ∧ 有存貨」的食物 → 選一種
        │  'pet-feed' { itemId, petItemId }
        │  feedPet()：扣一包 + 套用效果到那一隻，同一次 updateDoc
        ▼
applyPetCareEffects() ── 唯一會改變寵物狀態的函式
        │
        ▼
playerBus.petEating → 進食動畫 + 愛心（存檔成功之後才開始）
```

---

## 檔案

| 檔案 | 角色 |
|---|---|
| `src/constants/pets.ts` | **物種與品種**。品種的配色與身高，以及 `PET_SPECIES_TABLE` — 一個物種「是什麼樣的動物」（怎麼移動、怎麼稱呼、賣在哪一格）。 |
| `src/constants/petHabitats.ts` | **休息處的種類與相容性**。`PetHabitatKind`（7 種形狀）、`PET_HABITAT_KINDS`（姿勢 + 物理上哪些物種用得了）、`PetRestSpec`（一件商品宣告自己是哪一種、給誰用）。 |
| `src/constants/petCare.ts` | **資料與純規則**。存檔結構、調校數值、時間結算、狀態分級、移動倍率、行為表與決策函式、餵食效果套用、`withPetCare`（只動一隻的那一條規則）。沒有 React、沒有 Firestore、沒有自己的時鐘。 |
| `src/constants/consumables.ts` | **消耗品系統**。`ConsumableSpec` / `ConsumableEffect`：一件商品「被用掉會發生什麼事」與「誰吃得到」的宣告，以及 `getPetFoodsFor(species)`。 |
| `src/lib/petCompatibility.ts` | **跨能力的物種查詢**。「這件商品是給哪一種寵物的」，同時看 `petRest` 與 `consumable` — 只有商店那一列篩選晶片需要跨過兩者。 |
| `src/lib/petRestingSpots.ts` | **休息位置解析**。掃玩家自己的擺放，找出有宣告 `petRest` **且接受這個物種**的物件；找不到就退回離線回歸的「屋旁小窩」。 |
| `src/context/usePetCare.ts` | **寵物照護服務**。唯一會寫入 `islandState.pet.cares` 與扣飼料的地方，加上餵食模式的狀態與 `equippedPetIds`。 |
| `src/components/Three/IslandPet.tsx` | 行為層的宿主（`usePetBehaviour` / `applyBehaviorSlot`）、每一幀的移動、趴下與進食姿勢、`FeedHearts`，以及鳥降落在窩上的高度（`restingHeight`）。 |
| `src/components/UI/PetInteractionPanel.tsx` | **寵物互動面板** — 走到寵物旁邊按互動就開這一個。名字、種類、狀態、餵食（只列相容的）、摸摸。 |
| `src/components/UI/PetCarePanel.tsx` | 「我的寵物」面板 — 商店側的那一個，也是**唯一會顯示數值的地方**之一（另一個是上面那個面板）。 |
| `src/components/UI/PetFeeding.tsx` | 島上的餵食：餵食模式提示、**唯一的寫入觸發**、進食動畫的起點、結果 toast。 |
| `src/components/UI/PetSpeciesFilter.tsx` | 商店兩格寵物貨架上的物種晶片列，以及「預設選哪一個」。 |
| `src/constants/items.ts` | 9 種飼料與 10 種休息處的目錄資料，以及 `consumable` / `petRest` 兩個能力欄位。 |
| `src/utils/categoryUtils.ts` | 兩個貨架（寵物用品 / 寵物窩，都掛在【寵物】），以及 `placementScope` — 「在哪裡逛」與「放在哪裡」分開的那一個欄位。 |
| `scripts/test-pet-care.ts` | `npm run test:pet-care` — 把下面每一條規則釘住（241 條）。 |

---

## 一、寵物有哪些狀態

存檔裡只有**兩個數字加一個時間戳**（`islandState.pet.care`）：

| 欄位 | 意義 | 範圍 |
|---|---|---|
| `nutrition` | 營養。餵食會補，時間會扣。 | `0.15` … `1` |
| `energy` | 活動力。追著營養設下的天花板跑。 | `0.2` … `1` |
| `updatedAt` | 上面兩個數字「是什麼時候的真話」。 | ISO |

**沒有** `mood`（那是離線回歸的，`islandState.pet.mood`）、**沒有** `lastActiveAt`（那是
`islandState.lastSeenAt`）、**沒有** `resting` 或 `currentBehavior`——行為是每幾秒推導出來的，
存起來只會跟畫面上實際在做的事不一致。

給玩家看的是**分級**不是數字（`PET_CONDITION_BANDS`）：

| 分級 | 活動力 | 玩家看到的 |
|---|---|---|
| 活力充沛 | ≥ 0.88 | 跟前跟後，還會自己跑開探險 |
| 悠閒 | ≥ 0.70 | 走走停停，在附近晃 |
| 想休息 | ≥ 0.45 | 常常停下來坐著，偶爾回窩邊 |
| 懶洋洋 | ≥ 0 | 多半待在窩裡，走幾步就想躺下 |

分級**只用在文案與圖示**。行為本身讀的是連續的 `activity`，所以寵物是「逐漸變安靜」而不是
「跨過某個數字變成另一隻動物」。

---

## 二、Activity 怎麼影響行為

`petActivityResponse(activity)` 回傳三個連續的倍率：

| 倍率 | activity = 0 | activity = 1 | 影響 |
|---|---|---|---|
| `pace` | 0.62 | 1.05 | 走路速度（永遠不會是 0） |
| `liveliness` | 0.35 | 1.10 | 身體起伏、尾巴、傾斜 |
| `nestPull` | 1.00 | 0.00 | 有多想回自己的窩 |

這三個倍率**乘上**離線心情的同名倍率（`combinePetMotion`），兩套系統誰也不覆蓋誰：
「離開很久」和「很久沒餵」是關於同一隻動物的兩個不同問題。

`nestPull` 取兩者的**較大值**而不是相乘——兩邊都是「牠想待在窩裡」，相乘會讓
「又餓又被丟很久」的動物比「只是餓」的更少回窩。

---

## 三、Nutrition 怎麼影響 Activity

活動力不是直接被扣的，它**追著營養設下的天花板走**：

```
target = 0.25 + 0.75 × nutrition
e′ = k · (target − e)          k = ln2 / 6 小時
```

半衰期六小時，就是「漸進」在數學上的樣子：餵了一碗，動物在一個下午之間慢慢有精神；
離開一天，牠在一天之內慢慢安靜下來——不會在某一幀切換。

`settlePetCare()` 把這條式子**解析解**算出來（營養下滑段 + 觸底後的定值段兩段），
不是逼近。這不是潔癖，是必要條件：每個讀取者（面板、行為層、餵食）都各自結算、互不協調，
所以「算一次三天」跟「一小時算一次算七十二次」必須給出同一個答案。
`npm run test:pet-care` 用逐小時走一遍把這件事釘住（誤差 < 1e-9）。

---

## 四、活動力低的時候，畫面上看得到什麼

| 活動力 | 行為 | 畫面 |
|---|---|---|
| 高 | 多半 `follow`，偶爾 `wander` | 跟得緊、步伐大、會自己跑開兩公尺再回來 |
| 中 | `follow` 與 `idle` 交替 | 走走停停，主人不動時常常停下 |
| 低 | `goToBed` 開始出現 | 主人不在附近時，自己**走**回窩（不是瞬移） |
| 很低 | `rest` | 在窩裡趴著；身體下沉、微微前傾、腿不動 |

還有兩個不需要額外程式碼的效果：

- **主人走過去，牠就起來。** `ownerNearRest` / `ownerDistance` 讓休息類行為的權重歸零，
  所以「看到玩家會主動靠近」是權重歸零之後自然發生的事。
- **主人走遠，一定跟上。** 超過 `PET_LEASH_DISTANCE`（14 單位）直接強制 `follow`——
  一隻留在原地看著主人走掉的寵物，玩家讀到的是 bug，不是心情。

行為是**加權隨機**不是門檻串接：同一個活動力下，跟隨/發呆/回窩各有機率，
所以寵物不會每次都做一樣的事。`PET_BEHAVIOR_STICKINESS` 讓現在的行為更容易被留下，
避免每 3.5 秒改變主意。

---

## 五、寵物怎麼找到自己的窩

**不是**靠固定座標，**不是**靠 `id === 'petbed-01'`，**不是**靠名字裡有沒有「窩」。

窩是一件商品**宣告的能力**，跟 `standable`（可以站上去）、`tabletop`（可以擺東西）、
`interactions`（可以坐/躺/用）完全同一種東西：

```ts
{
  id: 'petbed-outdoor-basic',
  name: '戶外寵物窩',
  petRest: { radius: 0.62, label: '戶外寵物窩' },
}
```

`lib/petRestingSpots.ts` 掃玩家自己的 `islandPlacements`，把有 `petRest` 的都收集起來，
取**離家最近**的那一個（順序穩定，不會因為寵物站在哪而改變主意）。一個都沒有時，
退回離線回歸原本那個「屋旁的小窩」（`getPetRestSpot`）——同一個函式，所以場景畫的墊子
跟動物走過去的位置永遠是同一點。

### 未來怎麼支援不同款式的窩

一列目錄資料，其他都不用動：

| 想做的東西 | 需要寫的 |
|---|---|
| 第二款戶外窩 | 一列 `items.ts` + 一個 model + 一個 icon |
| 大一點的窩 | 同上，`petRest.radius` 改大 |
| 有門的狗屋 | 同上，`petRest.offset` 推到門檻（動物躺在門口而不是牆裡） |
| 鳥架（只有鳥能用） | 同上，`petRest.species: ['bird']` + `kind: 'perch'` + `height` |
| 一種全新形狀的窩 | 多一個 `PetHabitatKind` 成員 + 一列 `PET_HABITAT_KINDS` |
| 室內窩 | 同上，另外開一個 `placementScope: 'INDOOR'` 的貨架 |

`lib/petRestingSpots.ts` 一行都不用改。

### 物種適配：不是提示，是「看不到」

「哪一種寵物該用哪一種窩」全部由資料回答，任何一個 component 裡都沒有 `if (pet.type === 'dog')`。
三層，各自回答不同的問題：

| 層 | 在哪裡 | 回答什麼 | 誰決定 |
|---|---|---|---|
| `PetHabitatKind` | `petHabitats.ts` | 這是**什麼形狀**的窩（地面窩 / 軟墊窩 / 小屋 / 平台 / 鳥籠 / 鳥架 / 鳥巢） | 美術與物理 |
| `PET_HABITAT_KINDS[kind].suitableFor` | 同上 | 這個形狀**物理上**誰用得了（狗不可能抓住棲木） | 現實 |
| `item.petRest.species` | `items.ts` | 這一件商品**賣給誰** | 商品企劃 |

第三者必須是第二者的子集合，`npm run test:pet-care` 每一件都驗一次 —— 所以
「鳥也能睡的狗屋」這種 typo 進不了版本。

而**適配的方式是「不存在」，不是「跳錯誤」**（§5）。`collectRestingSpots()` 收集時就把不接受這個
物種的濾掉了，所以：

- 鳥 + 只放了狗屋 → 牠**沒有**自己的窩，退回屋旁小窩，跟什麼都沒放的鳥一模一樣
- 玩家不會看到「此物品不適用」，因為那個選項從來沒有出現過

`kind` 還帶來 `posture`（`lie` / `perch`），那是 renderer 分支的依據 —— **不是物種**。所以未來
一隻在地上跑的鳥、或一隻睡在架子上的貓，都不需要教 mover 認識一種新動物。

### 鳥的休息行為（§9）

沒有為了這次需求重做飛行 AI。鳥本來就會飛，所以「回到自己的窩」對牠來說只是**一個座標**：

```
behaviour = rest  →  applyBehaviorSlot() 把 slot 移到窩的位置
                  →  slot.y = 地面高度 + restingHeight(spot)
                  →  FlyingPet 用原本的 lerp 飛過去、降下來
```

`restingHeight()` 讀的是窩自己宣告的 `petRest.height`：鳥架的橫桿、鳥籠裡的棲木、鳥巢裡的棉絮，
三個不同的高度。沒有 `height` 的窩（屋旁那個小墊子）就降到接近地面，也就是這個功能之前的行為。

**那個高度量的是「腳踩的那個面」**，因為 `PetModel` 的原點就是動物的腳
（`Three/Pets.tsx`：`y = 0 the ground the paws stand on`）。填成零件的中心，鳥就會陷進棲木裡半個半徑。

`height` 只有 `perch` 姿勢的窩可以有，這條規則由測試釘住 —— 這個遊戲沒有攀爬，
一個一公尺高的狗窩會是一個狗永遠站在下面仰望的狗窩。`木製貓跳台` 就是為了這條規則而把
「貓睡的地方」放在底層的洞裡，頂上那塊板子是給玩家看的。

### 貨架在哪裡：逛的地方 ≠ 放的地方

寵物窩掛在**【寵物】**分頁（玩家找它的地方），但它的 `placementScope` 是 **OUTDOOR**
（它站的地方）。這兩件事以前共用同一個欄位 `mainSection`，而這一件商品就是它們分岔的地方：

- 只掛【寵物】、不宣告 scope → 買得到，但**永遠放不下去**（島上的建造欄位是從「戶外可擺放的分類」組出來的）
- 只掛【室外】 → 放得下去，但玩家**找不到**

所以現在是：**貨架跟著玩家走，scope 跟著物件走。**

```
逛：getCategoriesFor('PET')                        → 狗 / 貓 / 鳥 / 寵物飾品 / 寵物用品 / 寵物窩
放：getPlacementCategoriesIn('OUTDOOR',['placeable']) → 花園 / 樹木 / 裝飾 / 藝術裝置 / 互動物件 / 寵物窩
```

兩個建造欄位（島上的 `BuildModeOverlay`、屋內的 `BuildingInteriorView`）都改成問
`getPlacementCategoriesIn()` 而不是問分頁。室內的結果跟以前**完全一樣**（每個室內貨架的 scope
本來就是室內），但它現在對「掛在別的分頁、放在屋內」的東西也是對的——也就是未來的室內寵物窩。

`npm run test:pet-care` 會對每一件有 `petRest` 的商品斷言它**真的出現在它 scope 到的那個建造欄位裡**，
所以「買得到卻放不下去」這個 bug 不會再發生一次。

---

## 六、飼料怎麼被儲存、怎麼被使用

飼料**沒有自己的背包**。它是一件普通商品：

```
商店 → purchaseItem() → profile.inventory（一包一筆，跟家具一樣）
```

會堆疊是因為它的分類 `PetSupplies` 的 `kind` 是 `consumable`（`utils/categoryUtils.ts`），
跟 `placeable` 的家具用同一套 `getAvailableStock()`。**買了不會自動餵**——買跟用是分開的兩件事。

### 貨架長什麼樣子

九件，排成「一件大家都吃的主食 + 每個物種一份正餐一份零食 + 一份通用零食」：

| 商品 | 適用 | 營養 | 活動力 | 價格 |
|---|---|---|---|---|
| 基礎飼料 | 全部 | +55% | +20% | 120 |
| 燉肉罐頭 | 狗 | +80% | +15% | 280 |
| 手撕肉乾條 | 狗 | +18% | +34% | 90 |
| 油漬鯖魚罐 | 貓 | +80% | +15% | 280 |
| 貓薄荷脆餅 | 貓 | +18% | +34% | 90 |
| 綜合穀物種子 | 鳥 | +62% | +18% | 200 |
| 果乾小點 | 鳥 | +18% | +34% | 90 |
| 島嶼手作點心 | 全部 | +30% | +45% | 320 |

「正餐」與「零食」**不是一個欄位**，目錄裡沒有「食物類型」這種東西。分開它們的是數字本身：
正餐幾乎都是 `pet-nutrition`，零食主要是 `pet-energy` 而且每一枚金幣換到的營養都比正餐差。
測試斷言的也是這個性質（每個物種都要有一件 nutrition ≥ 0.5 的、和一件 energy > nutrition 的），
而不是斷言某個 id 存在。

**沒有 `species` 就是所有物種都能吃。**「基礎飼料」與「島嶼手作點心」是這樣，其他七件都指定了。
這一點很重要：它保證任何一個玩家、任何一隻寵物，餵食清單都不會是空的。

### 使用流程

```
走到寵物旁邊 → 「[E] 與小狗互動」 → 'pet-interact'
        │
寵物互動面板：名字、種類、狀態、休息處
        │  按「餵食」
        ▼
只列出「這隻吃得到 ∧ 背包裡有」的食物 → 選一種
        │  'pet-feed' { itemId, petItemId }
        ▼
feedPet(itemId, petItemId)：扣一包 + 套用效果到那一隻，同一次 updateDoc
```

一次寫入，不是兩次。中間失敗會變成「拿走了飼料但沒餵到」或「餵了但沒扣」，
而玩家沒有任何辦法分辨是哪一種。

「先在『我的寵物』選好飼料再走過去」那條舊路徑**還在**，作為熟練玩家的快捷鍵：選好之後
寵物的提示會變成「餵小狗吃燉肉罐頭」，按一下就餵完，不用開面板。兩條路徑走同一個
`'pet-feed'` 事件、同一個寫入。

### 效果怎麼被套用

商品自己宣告效果與適用物種，`applyPetCareEffects()` 是**唯一**會改變寵物狀態的函式：

```ts
consumable: {
  target: 'pet',
  species: ['dog'],          // 沒寫 = 所有物種
  verb: '餵食',
  effects: [
    { kind: 'pet-nutrition', amount: 0.8 },
    { kind: 'pet-energy',    amount: 0.15 },
  ],
  effectSummary: '營養 +80%・活動力 +15%',
  useHint: '很飽足的一餐，適合出遠門回來之後餵。',
}
```

沒有任何地方 `if (itemId === 'petfood-basic')`，也沒有任何地方 `if (species === 'dog') showDogFood()`。
面板、商店、背包、餵食流程都只問 `getConsumableSpec(itemId)` 與 `getPetFoodsFor(species)`。

`consumableAcceptsSpecies()` 在**寫入**時也會再檢查一次。UI 的篩選是體驗，不是規則 ——
一個只在畫面上成立的限制，遲早會被第二個呼叫端繞過。

### 未來新增其他 Consumable

| 想做的東西 | 需要寫的 |
|---|---|
| 高級飼料 / 零食 | 一列 `items.ts`（不同的 `amount`） |
| 對玩家用的道具 | `target: 'player'` + 一種新的 `ConsumableEffect` + 那個目標系統的一個分支 |
| 對島嶼用的道具 | `target: 'island'`，同上 |

`ConsumableEffect` 是一個小的 union（效果**形狀**，不是每件商品一種）。
第二種飼料是資料；第二種**效果形狀**才需要程式碼，而且只需要在它的目標系統裡加一個分支。

### 跟 功能卡 的關係

兩套系統並排，共用概念不共用程式碼：

```
功能卡  → 買/抽 → utilityCards.owned → 使用 → 獎勵計算層（改變獎勵怎麼發）
消耗品  → 買    → inventory          → 使用 → 目標自己的狀態（改變世界裡的東西）
```

功能卡刻意不是「商品」（沒有 `shopCategory`、沒有擺放範圍、沒有庫存規則）；
消耗品刻意就是商品（有價格、有堆疊、有使用對象）。合併會變成給卡片一個用不到的擺放範圍，
或者教獎勵計算層認識一碗狗飼料。

---

## 六之二、一隻寵物一份狀態（多寵物）

存檔是 `islandState.pet.cares`，一張 **map，key 是寵物的商品 id**：

```
islandState.pet = {
  mood, vitality, lastGreetedAt,
  care:  { … }          ← 多寵物之前的那一份，唯讀，只作為遷移的種子
  cares: {
    'pet-dog-shiba':  { nutrition, energy, updatedAt },
    'pet-cat-orange': { nutrition, energy, updatedAt },
  },
}
```

用商品 id 當 key，是因為那本來就是遊戲對「一隻寵物」的識別方式 —— `equippedItems` 裡放的是它、
model 跟 icon 也是從它畫出來的、商店賣的也是它。沒有第二套 id、沒有要跟背包同步的寵物清單。

**舊存檔怎麼辦。** 多寵物之前只有一份 `care`，而那一份屬於「當時出場的那一隻」，也就是主要寵物。
所以 `rawPetCare()` 裡有唯一一個遷移分支：主要寵物在 `cares` 裡還沒有自己的格子時，繼承那份舊的；
第一次寫入之後結果就進 `cares`，舊欄位從此不再被讀。**不是鏡像**，是單向遷移 ——
一份要保持同步的副本，遲早會有一個寫入端忘記。

**餵一隻不會餵到全部**（§21）。那條規則有名字也有測試：

```ts
withPetCare(previous?.cares, petId, care, nowMs)   // 只換掉那一格
```

寫成 inline 的展開也可以，但少打一個 `...` 就是「餵狗會重置整個家」，而且存檔看起來不會有任何異樣。

**餵的是哪一隻**，是從玩家站在誰旁邊決定的，不是從 profile 推出來的：mover 每一幀把
`playerBus.petTargetId` 跟 `dogPos` 寫在同一個呼叫裡，所以提示、面板、寫入指的一定是同一隻動物。
Profile 沒辦法回答「the pet」是誰 —— 只有正在畫牠的那個 component 知道玩家走向了哪一隻。

今天更衣室一次只帶一隻，所以 `equippedPetIds()` 回傳 0 或 1 個。但它從一開始就是 list，
下游也全部照 list 寫，所以第二個欄位開放的那一天，這一層不用重寫。

---

## 六之三、寵物互動面板

```
靠近      →  一顆小小的浮動徽章：「[E] 與小狗互動」
按下      →  UI/PetInteractionPanel.tsx
```

**不是靠近就跳出來**（§16）。走過自己的狗就彈一個 Modal，等於在玩家想走過自己的狗的時候擋住他。
靠近只產生一個徽章；面板只在玩家自己按下去的時候開。

面板裡有：名字、種類、狀態分級與兩條 meter、休息處（以及它是哪一種形狀）、餵食、摸摸。
餵食清單是「相容 ∧ 有存貨」，**沒有存貨的不列**——這裡是一個站在餓肚子動物前面的玩家，
一排灰掉的卡片對他沒有用。（`我的寵物` 面板剛好相反，它會列出沒有的，因為那是商店側的螢幕，
它的工作包含「教你這個東西存在」。）

**都沒有適用的食物時**（§18）不會開一個空清單，而是一句話加一個「前往商店」——
它只把商店開到「寵物用品」那一格，不會自動買任何東西。

版面是 `ModalOverlay` + `ModalShell` + `PanelHeader`（共用的 Design Kit），按鈕用
`grid-cols-1 sm:grid-cols-2`。整個檔案沒有一個絕對座標，所以手機到桌機都是同一套規則在排。

### 餵食回饋（§19）

```
feedPet() 回傳 ok
    │
    ├─ playerBus.petEating = { petItemId, startedAt }
    │        │
    │        ├─ 走路的：低頭 + 慢慢點頭 + 尾巴全速
    │        └─ 飛的：  降一點高度 + 快速啄食
    │        └─ 兩者都有：三顆愛心飄上去然後淡出（FeedHearts）
    │
    └─ toast：「柴犬吃得很開心（營養 +45%）」← 實際加到的量，不是商品宣稱的量
```

**存檔成功之後才開始**。點下去就播動畫，會讓一隻寵物開心地吃掉一頓沒有存進去的飯 ——
跟樂觀扣除背包是同一種謊。

動畫結束的判斷在 mover 裡、用時鐘算，不是 `setTimeout`：姿勢跟愛心各自讀同一個時間戳，
誰也不會把對方的動畫提早關掉。

---

## 七、離線時間怎麼影響寵物

**沒有離線程式碼路徑，這就是設計。**

狀態帶著「它是什麼時候的真話」（`updatedAt`），所以：

```
離線三天  =  updatedAt 跟 now 差 72 小時
分頁在背景放三天  =  一模一樣的算式
中間登入了五次  =  一模一樣的答案
```

`resolveIslandArrival()`（`context/useIslandLife.ts`）在登入時把它結算一次寫回存檔，
讓存檔反映玩家即將看到的東西；其他讀取者各自再結算一次，得到同一個答案。

**Timestamp-based，沒有任何 Timer。** 沒有心跳、沒有 `setInterval`、玩家離線時不需要
任何東西在跑。會寫入 `care` 的只有兩件事：一次登入，一次餵食。

第一次見到（沒有 `lastSeenAt`——包含每一個早於這個功能的存檔）會把時間戳**蓋成現在**，
不會拿功能還不存在的那些日子去扣一隻寵物的營養。

---

## 八、效能（brief §22）

| 什麼 | 頻率 |
|---|---|
| 移動、轉向、步態、趴下姿勢的緩動 | 每一幀 |
| 行為決策、營養/活動力結算、倍率計算 | 每 3.5 秒（±25% 抖動） |
| 尋找寵物窩 | 只在擺放清單改變時（`useMemo`） |
| 寫入存檔 | 只有登入與餵食 |

十隻寵物 = 每幾秒十次加權抽樣，不是每一幀十次。抖動讓同一幀掛載的兩隻動物不會從此同步思考
（同步會讓兩隻看起來像同一個腦袋在開）。

---

## 九、目前只是預留、還沒實作的

### 排遺系統（brief §17、§18）

**沒有實作任何東西**，這裡只寫下它應該長在哪。

現有可以直接接的三件事：

1. **事件來源**：行為層已經知道寵物「什麼時候在哪裡做了什麼」。排遺應該是
   `PetBehaviorId` 多一個成員（例如 `relieve`），權重跟活動力、上次排遺時間有關——
   而**不是**每 10 分鐘在隨機座標生一個東西。位置就是寵物當時真正站的位置，
   所以不會穿牆、不會生在海裡、不會生在家具裡。
2. **物件生成**：`OvergrowthSprout`（`constants/islandReturn.ts`）已經是「島上長出來、
   玩家可以清掉、存在存檔裡的一個東西」，而且它的產生器
   （`lib/islandOvergrowth.ts`）已經處理了避開房子、家具與水面。多一個
   `OvergrowthKind` 比新建一套物件系統近得多。
3. **清理互動**：`整理` 已經是一個完整的互動（提示、E 鍵、寫入、toast，
   `UI/IslandTidy.tsx`），而且它清的就是 sprout 清單。不需要第二個互動。

要小心的地方：`整理` 目前**不給任何獎勵**，這是刻意的（獎勵會讓「離開島嶼」變成一種
farming）。排遺如果接進同一個系統，必須繼續不給獎勵。

### 照護不足的其他後果（brief §19）

同樣只預留。目前照護不足的**唯一**後果是活動跡象減少，而且完全可逆。
任何未來的後果都必須通過同一個檢驗：**玩家如果永遠不處理，他有沒有失去任何東西？**
如果有，它就不屬於這個系統——這是 `constants/islandReturn.ts` 的第一條規則，這裡照抄。

### 沒有、而且不打算有的

寵物死亡、生命值、疾病、真實營養學（蛋白質/脂肪/維生素）、強制每日登入、
畫面上常駐的數值條。

---

## 十、存檔與 Firestore

`islandState.pet.care` 與 `islandState.pet.cares`，**都不是**新的頂層欄位。

這是資料建模與部署的同一個決定：`firestore.rules` 把 `islandState.pet` 驗證成「一個 map」
而已，而 `islandState` 本來就在每一個會碰它的白名單裡。所以整套照護系統
**對著這個功能出現之前就部署好的 ruleset 也寫得進去**——新的頂層欄位則要先在
`isValidUser()` 加一條、在每一個寫入白名單加一筆、然後部署，在那之前每一次帶著它的存檔
都會只在正式環境失敗。見 `docs/FIRESTORE_RULES.md`。

多寵物的 `cares` map 是同一個決定的第二次應用：它掛在 `pet` 底下，所以
**這次擴充一樣不需要動 rules、不需要部署**。這也是為什麼多寵物沒有做成
`profile.pets` 之類的頂層清單。

餵食那一次寫入同時碰 `inventory` 與 `islandState`，這個組合原本就在 fallback 白名單裡；
`firestore.rules` 裡那一條專屬 clause 是把它寫清楚，不是在等部署。

---

## 十一、新增一種寵物（例如兔子）

整份文件的主張就是這一節。要加一個物種，需要寫的東西是：

| 步驟 | 檔案 | 內容 |
|---|---|---|
| 1 | `constants/pets.ts` | `PET_SPECIES` 加 `'rabbit'`；`PET_SPECIES_TABLE` 加一列（label / companionNoun / locomotion / shopCategory）；`PET_ID_PATTERN` 加一個分支 |
| 2 | `constants/pets.ts` | 每個品種一列 `PET_SPECS`（配色與身高） |
| 3 | `utils/categoryUtils.ts` | 一格貨架 `Rabbits`（如果要獨立賣） |
| 4 | `constants/items.ts` | 動物本身、`petRest.species` 含 `'rabbit'` 的窩、`consumable.species` 含 `'rabbit'` 的食物 |
| 5 | `constants/petHabitats.ts` | **只有在需要新形狀時**（例如「地洞」）才動：一個 `PetHabitatKind` 成員 + 一列 `PET_HABITAT_KINDS` |
| 6 | 美術 | 每一件新商品一個 3D model + 一個 icon |

**不需要改的**（這是重點）：

- `lib/petRestingSpots.ts` —— 篩選是 `spec.species.includes(species)`
- `constants/petCare.ts` —— 照護模擬完全不知道有物種這回事
- `context/usePetCare.ts` —— 餵食走 `consumableAcceptsSpecies()`
- `UI/PetInteractionPanel.tsx` / `UI/PetCarePanel.tsx` —— 清單是 `getPetFoodsFor(species)`
- `UI/PetSpeciesFilter.tsx` —— 晶片是從貨架上的商品推出來的，會自己長出來
- `UI/InteractionPrompt.tsx` —— 稱呼讀 `companionNoun`
- `Three/IslandPet.tsx` —— 選 mover 讀 `locomotion`；會走的物種一行都不用加

`npm run test:pet-care` 有一整段就在驗這件事：每個物種都被表格完整描述、都有貨架、
貨架上都有東西、都有至少兩種窩與兩種食物。
