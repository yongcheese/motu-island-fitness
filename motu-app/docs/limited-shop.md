# 限時商店 — 一家獨立的店

**限時小攤**是遊戲裡第二家店，不是普通商店裡的一個分類。

它**沒有** UI 入口：進去的方式是走到島邊，找到那位搭著小船來的旅行商人。那一層寫在
[docs/traveling-merchant.md](traveling-merchant.md)；這份文件講的是他攤子上賣的東西。

它賣兩種普通商店買不到的東西：

- **特殊卡牌組合包** — 功能卡（雙倍金幣券）與抽獎券，整包販售，每檔的張數與價格都重新配置。兩者每一檔都在架上。
- **特殊飾品** — 從十四件的收藏池裡每檔輪三件，用碎片兌換。

這份文件講的是三件事：兩家店的商品池怎麼**從資料上**分開、輪替與價格怎麼在沒有伺服器的情況下做到「所有玩家看到同一批商品、重新整理不會變」、以及組合包的價格為什麼不是單價乘張數。

---

## 一句話架構

```
Item Definition            這東西是什麼          constants/items.ts
                                                constants/utilityCards.ts
        │
        ▼
Distribution Channel       它從哪些管道拿得到     constants/distribution.ts
        │                                       ├─ MAIN_SHOP_CATALOG   → 普通商店
        │                                       └─ LIMITED_SHOP_ITEMS  → 限時小攤
        ▼
Offer Source               它在這家店賣多少、怎麼賣  constants/limitedShop.ts
        │                                       ├─ SPECIAL_CARD_POOL（功能卡 + 抽獎券）
        │                                       └─ SPECIAL_ACCESSORY_POOL
        │
        │  buildRotation(periodIndex)：依檔期編號抽選 + 生成張數與價格（純函式、可重現）
        ▼
Limited Offer（本檔的商品） constants/limitedShopRotation.ts   ← 衍生出來的，不存檔
        │
        ├─── 同一個檔期也決定 ──► 旅行商人在不在島上  constants/merchantVisit.ts
        │                                             （見 docs/traveling-merchant.md）
        ▼
限時小攤畫面                components/LimitedShopView.tsx
        （由商人打開）              components/UI/MerchantSession.tsx
        │
        ▼
購買                        checkPurchase（純規則） → useLimitedShop（一次 updateDoc）
        │
        ▼
Player Purchase State      profile.limitedShop.purchases       ← 每位玩家自己的
```

四層分開，是因為它們變動的理由不一樣：

| | 是什麼 | 生命週期 |
|---|---|---|
| `ItemDefinition` / `UtilityCardDefinition` | 這東西**是什麼** | 寫一次 |
| `availableIn`（Distribution） | 它**從哪裡拿得到** | 換通道時改一格 |
| `LimitedOfferSource` | 它在這家店**怎麼賣** | 改價、改冷卻時改 |
| `LimitedOffer` | 它**這一檔在架上，一包 N 張，賣 M 元** | 每檔算出來，換檔就沒了 |

所以「返場」就是同一個 source id 在後面的檔期又被抽中 —— 不是複製一份商品、不是新的 id、不是重新匯入。下架不刪任何資料，玩家的購買紀錄也因此能活過商品的下架。

---

## 檔案

| 檔案 | 角色 |
|---|---|
| `src/constants/distribution.ts` | **通道層**。`MAIN_SHOP_CATALOG` / `LIMITED_SHOP_ITEMS`，兩家店的貨架都從這裡長出來。 |
| `src/constants/limitedShop.ts` | **這家店可以賣什麼**。設定、兩個商品池、組合包的定價規則。 |
| `src/constants/limitedShopRotation.ts` | **這一檔在賣什麼**。檔期算術、輪替、張數與價格生成、購買規則、購買紀錄。 |
| `src/context/useLimitedShop.ts` | **購買寫入**。唯一的限時商店寫入點。 |
| `src/components/LimitedShopView.tsx` | 攤位 UI、組合包卡片、購買確認、卡牌背包入口。 |
| `src/components/UI/MerchantSession.tsx` | **入口**：唯一會切到 `View.LIMITED_SHOP` 的地方，見下。 |
| `scripts/test-limited-shop.ts` | 全套規格測試（`npm run test:limited-shop`）。 |

### 入口是一位商人，不是一顆按鈕

路牌上原本有「限時小攤」那一格，已經拿掉了（連按鈕、View 切換與 tour id 一起，不是用 CSS 藏
起來）。現在這家店的門是島邊那位**旅行商人**：

```
限時商店檔期開始（constants/limitedShopRotation.ts 的期數算術）
        │
        ▼
商人造訪（constants/merchantVisit.ts）—— 同一個時鐘算出來的另一個投影
        │
        ▼
小船靠岸、商人站在攤子後（Three/MerchantVisitor.tsx）
        │  玩家走近 → 共用的互動提示 → 動作鍵 / 點一下
        ▼
UI/MerchantSession.tsx 再確認一次造訪狀態 → setCurrentView(View.LIMITED_SHOP)
```

所以「商人不在島上時商店開不了」不需要任何一個畫面記得檢查：**只有一條路進得來，而那條路會
先問**。整套商人系統寫在 [docs/traveling-merchant.md](traveling-merchant.md)。

值得強調的是這件事**沒有動到下面任何一層**：商品池、輪替、定價、限購、購買寫入全部原封不
動，`LimitedShopView` 也照樣只畫 `currentRotation(now)`。改的只有「玩家怎麼走到這扇門前面」。

---

## 一、兩家店的商品池怎麼分開

不是靠 UI 藏。任何一行 `if (item.shopCategory === 'SpecialFx') return null` 都是錯的寫法：只要有人新增第二個畫面就會漏掉，而且漏掉的時候沒有東西會壞給你看。

分開的方式是**商品自己宣告它從哪裡來**：

```ts
// constants/items.ts
{ id: 'fx-star-hairpin', name: '星星髮飾', shopCategory: 'SpecialFx',
  availableIn: ['limited-shop', 'reward'], … }
```

沒寫 `availableIn` 的商品（目錄裡的絕大多數）等於 `['main-shop', 'reward']`，也就是這個欄位存在之前的意思，所以 ~200 行不用動。

然後兩家店各自從自己的通道長出貨架：

```ts
// constants/distribution.ts
export const MAIN_SHOP_CATALOG  = ALL_ITEMS.filter(i => isInChannel(i, 'main-shop'));
export const LIMITED_SHOP_ITEMS = ALL_ITEMS.filter(i => isInChannel(i, 'limited-shop'));
```

普通商店的每一道門都讀 `MAIN_SHOP_CATALOG`：

| 門 | 讀什麼 |
|---|---|
| 商品格 | `ShopView` 的 `shelfItems` |
| 主分頁列 | `getShopMainSections()`（`特殊卡牌` 兩格都是 `limited-shop`，整個主分頁不會出現） |
| 分類 chip 列 | `getShopCategoriesFor('PERSON')`（`SpecialFx` 的 `channel` 是 `limited-shop`，chip 不會出現） |
| 建造模式 / 家具抽屜 | `getItemsInCategory()` |
| 購買寫入 | `useShopActions` 的 `isMainShopItem()` 守衛 → `'not-sold-here'` |
| 商品碎片 | `isFragmentItem()` 只認 `main-shop` 的商品 |

**`ALL_ITEMS` 沒有變。** 更衣室的衣架、擁有判定、角色渲染讀的仍然是完整目錄 —— 「我擁有什麼」跟「它是哪裡買的」是兩件事，所以買過的特殊飾品在更衣室裡照常在。

### 特殊卡牌整個主分頁都搬走了

`特殊卡牌` 這個主分頁底下的兩格 —— `抽獎券` 與 `功能卡` —— 都標了 `channel: 'limited-shop'`，所以普通商店連那個**主分頁**都不會畫出來（`getShopMainSections()`）。這跟 `特殊飾品` 只少一個 chip 不同，是因為那一整個分頁在普通商店裡已經一件商品都沒有了：一個點進去空白的分頁，玩家讀起來是「壞了」而不是「那不在這裡賣」。

分類本身沒有刪。它們仍然是這兩種東西的名字，收納庫、任何依 id 查標籤的地方、以及 `CategoryNote` 都還在用。

### 商品碎片為什麼跟著搬走

商品碎片是**在商店卡片上收集、也在商店卡片上兌換**的（進度條與「免費解鎖」按鈕都在 `PurchaseDialog`）。限時商店限定的商品沒有那張卡片，所以為它收集的碎片會永遠花不掉 —— 一條填滿了也按不了的進度條。因此 `isFragmentItem()` 現在要求 `main-shop`。

已經存在的碎片不會不見：在限時小攤買下那件飾品時，`fragmentPatchForPurchase` 會把它們結算成抽獎券，跟普通商店完全一樣的處理。

### 未來要加通道

`DistributionChannel` 多一個成員 + 一個**真的會讀它的畫面**。不要先宣告一個沒人讀的通道 —— 一個標成 `event-shop` 卻沒有活動商店的商品，等於悄悄退出了遊戲。

---

## 二、刷新週期是設定

```ts
// constants/limitedShop.ts
export const LIMITED_SHOP_CONFIG = {
  epoch: '2026-01-05T00:00:00.000Z',
  refreshInterval: { days: 7 },      // ← { days?, hours? }，相加。7 = 商船的一趟（停 3 + 走 4）
  slots: [
    { id: 'cards',       label: '本檔特殊卡牌',   pool: 'special-card',      count: 2, guaranteed: true },
    { id: 'accessories', label: '本檔特殊飾品',   pool: 'special-accessory', count: 3 },
  ],
  purchaseHistoryPeriods: 4,
};
```

- 改成每日刷新 = `refreshInterval: { days: 1 }`。改成活動期間兩小時一換 = `{ hours: 2 }`。
- **這個數字同時是商船的一趟航程。** 商人的行程寫成一檔的比例（`constants/merchants.ts` 的 `schedule`），目前是停 3 天、走 4 天 —— 加起來剛好一檔。所以改這裡不只是改貨多久換一次，也是改船多久來一次：改成 14 天，商船就會變成停 6 天、走 8 天。要只改其中一個是做不到的，那正是「商人與貨架讀同一個時鐘」的意思（見 docs/traveling-merchant.md）。
- 連帶影響：每一列的 `cooldownPeriods`（返場冷卻）與 `purchaseHistoryPeriods`（保留幾檔的購買紀錄）的單位都是「檔」，所以它們也跟著從兩週一格變成一週一格。這些是同一個決定的後果，不是各自要調的旋鈕。
- 加一區「本檔限定家具」= `slots` 多一格 + 一個新的池子。輪替演算法不用認識它。
- **`epoch` 不要隨便改**：所有檔期都是從它數的，改了等於把每一檔重新編號、過去與未來的貨架全部重洗。

`guaranteed: true` 是 §3「特殊卡牌常駐」的實作：正常抽選時冷卻中的來源不列入，但如果那會讓這一區空掉，就無視冷卻再抽一次。所以「每一檔至少有特殊卡牌商品」是設定寫下來的保證，不是「反正列數剛好夠」的巧合。測試裡有一組把整個卡牌池的冷卻設成 99 檔的案例來證明這一點，還有一組把 `guaranteed` 關掉、證明同樣的設定真的會空 —— 那才是「是這個旗標在做事」的證據。

`count: 2` 而卡牌池目前剛好兩列（功能卡、抽獎券），所以兩者每一檔都在架上。這是刻意的：券是轉盤的入場券、功能卡是健身的加成，讓其中一個隔檔消失只會讓人覺得攤位壞了。第三列進來之後它們就會真的開始互相排擠。

---

## 三、輪替是推導出來的，不是擲出來的

`buildRotation(index)` 是**期數的純函數**。同一檔期的人，在任何裝置上、重新整理幾次、重開遊戲幾次，都會算出同一個貨架 —— 同樣的商品、同樣的張數、同樣的價格。

```
一次 Refresh → 生成 Rotation → 保存 Rotation State → 下一次 Refresh 才更換
```

「保存」在這裡是靠**可重算**達成的，而不是靠寫一份下來。寫下來的那一份會有第二個答案：兩台裝置各存一份就會不一樣，存檔壞掉就沒得救，而且需要一個伺服器來仲裁誰的那一份才算數。種子（`epoch` + 期數 + slot id）本身就是那個仲裁者，而它不需要網路。

**所以整個系統裡沒有 `Math.random()`。** 在 render 裡擲的骰子會在每次 re-render 重擲，玩家重新整理就會看到「3 張 1,000」變成「5 張 800」—— 那個失敗在這個架構下不是「有記得避開」，是寫不出來。

`buildRotation` 從第 0 檔一路走到目標檔而不是取一段視窗，所以冷卻與返場標記是精確的；`currentRotation` 會把結果記憶起來，所以一直重繪的商店只會付一次。

---

## 四、組合包：張數與價格

特殊卡牌**不用**「單價 × 購買數量」的普通商店模式。商品本身就是一包：一包固定張數、一個整包價格，玩家只能整包買。

### 張數

```ts
quantity: { min: 2, max: 4 }
```

`bundleQuantity(source, periodIndex)` 從這個範圍抽，種子是 `epoch:期數:來源id:qty`。下限是 2 而不是 1，因為賣一張的「組合包」只是普通商品換了個說法。

### 價格 —— 為什麼不是單價乘張數

如果價格永遠等於單價 × 張數，那「這一檔的組合」就只是一個數字換了另一個數字，玩家沒有任何理由去比較兩檔之間划不划算。所以價格是這樣算的：

```
每張價值 = baseValue × (1 − bulkRelief × (張數 − 1))     ← Quantity Scaling（量販折扣）
每張價值 = 每張價值 × (1 ± variance)                     ← Random Modifier（這一檔的擾動，seeded）
每張價值 = clamp(每張價值, unitValue.min, unitValue.max)  ← 設計師畫的上下限
整包價格 = round(每張價值 × 張數, roundTo)
```

順序是刻意的：折扣先套、擾動後套、最後才 clamp。這樣有兩個保證：

- **不會失控。** 整包價格必定落在 `張數 × [unitValue.min, unitValue.max]` 之間，所以張數越多整包一定越貴，也不可能出現「1 張 999999」或「100 張 1 金幣」。
- **但也不會成比例。** 每張價值每一檔都不一樣，所以 3 張 450（每張 150）的下一檔可以是 4 張 560（每張 140），再下一檔 2 張 340（每張 170）。

### 目前的定價

| 商品 | 路線 | baseValue | bulkRelief | variance | 每張價值上下限 | 取整 | 一包張數 |
|---|---|---|---|---|---|---|---|
| 雙倍金幣券 | 碎片 | 160 | 7% | ±15% | 110–195 | 10 | 2–4 |
| 雙倍金幣券 | 金幣 | 1,200 | 9% | ±12% | 950–1,400 | 50 | 2–4 |
| 抽獎券 | 金幣 | 300 | 4% | ±14% | 230–380 | 10 | 3–6 |

**雙倍金幣券的金幣路線刻意很貴**，理由是經濟上的：金幣只能靠運動產出，所以一張便宜的雙倍金幣券等於讓玩家用金幣買回產金幣的能力。再加上一檔限購一次，它不可能變成補給線。

**抽獎券只有金幣一條路，而那也是設計**：`docs/economy.md` 二 立了一道牆 ——「碎片的來源刻意不包含金幣」—— 而轉盤會發碎片。用碎片賣券會讓 碎片 → 券 → 碎片 變成一個直接的迴圈，而且會讓「多出來的碎片每 20 個換一張券」那個自動匯率變成可以套利的東西。所以券在這裡是金幣專賣，牆靠定價擋著（跟每日簽到補簽同一套邏輯）。量販折扣只有 4%，因為這條路本來就不該因為買多而變划算。

**券的一包比較大（3–6）**，因為券是「轉一次就沒了」的消耗品：一包兩張的組合包跟買兩次沒有差別，一包五張才會讓人覺得這一趟轉盤玩得起來。

---

## 五、限購與購買紀錄

**Rotation 是全域的，Purchase State 是每位玩家自己的。** A 買走了組合包不會讓 B 的貨架少一格。

```ts
// 存檔上唯一跟這家店有關的東西
profile.limitedShop = { purchases: { 'rot-12::ls-card-double-coin': 1 } }
```

輪替本身完全不存 —— 它是算出來的，存一份下來只會多出一個會過期的答案。

限購是**每一列自己的設定**，不是寫死的 `limit = 1`：

```ts
purchaseLimit: 1      // 一檔一次
purchaseLimit: 3      // 一檔三次
purchaseLimit: null   // 不限購
```

它天生是「每位玩家、每一檔」的限制。全服限量需要伺服器仲裁，客戶端擋不住，所以這裡不提供那個欄位 —— 一個守不住的限量比沒有限量更糟。

紀錄在每次寫入時順手掃掉超過 `purchaseHistoryPeriods` 的舊檔期，所以它不會無限長大（20 檔之後只剩 5 個鍵）。

---

## 六、購買流程

```
點擊 → 確認對話框 → checkPurchase（純規則）→ 一次 updateDoc：扣款 + 給整包 + 記限購
```

`checkPurchase`（`constants/limitedShopRotation.ts`）是純函數，順序由「最不像玩家的錯」排到「最像」：

1. 不在這一檔架上 → `not-on-sale`
2. 沒有這條付款路線 → `unknown-offer`
3. 本檔已達限購 → `limit-reached`
4. **整包放不下**（功能卡）／已經擁有（飾品）→ `card-limit-reached` / `already-owned`。抽獎券兩者都不適用 —— 它加的是一個餘額，沒有上限也不會「已經擁有」。
5. 餘額不足 → `insufficient-funds`

第 4 點是組合包的關鍵：背包只剩一格但這包有三張時，**整包不賣**。發一半等於收整包的錢只給一部分。

`useLimitedShop` 只負責蒐集那幾個數字、呼叫檢查、然後把扣款、商品與購買紀錄放進**同一次** `updateDoc`。扣了錢沒拿到東西、拿到東西沒扣錢都是修不回來的。而且貨架是在寫入時從時鐘重新推導的，不是相信畫面傳來的 —— 所以換檔之後才送到的購買會被拒絕，價格也不可能被畫面上那份過期的數字決定。

---

## 七、UI 上刻意不做的事

- **沒有數量選擇器。** 商品本身就是一個固定組合，一個 `[-] 1 [+]` 會讓人以為可以選。按鈕上寫的是「購買此組合」。
- **倒數只講到天/小時**，沒有秒數在跳、沒有紅色、沒有「最後機會」。它要像島上一個期間限定的小攤，不是課金櫃檯。
- **「返場」標籤**是這家店最有用的一句話：錯過不是永久失去。
- 組合包在三個地方講清楚張數：圖上的角標（`× 3 張`）、一段「本檔組合：雙倍金幣券 × 3 張／整包販售，購買後一次獲得 3 張」、以及確認對話框最上面的「購買後獲得」那一列。玩家不能以為 450 碎片只買到一張。

---

## 八、這不是伺服器

沒有全域同步，沒有全服限量，檔期邊界讀的是裝置上的時鐘。那些都是真正的後端才擁有的東西，在本機假裝有會做出一個「看起來完成了但其實沒有」的系統。

這裡有的是後端將來要填的**形狀**：`LimitedRotation` 就是 `GET /limited-shop/rotation` 會回傳的東西，`checkPurchase` 就是伺服器要重跑一次的那組規則。接上服務時換的是資料來源，不是重新設計。

---

## 九、加東西的清單

| 想加什麼 | 要改哪裡 |
|---|---|
| 第三種特殊卡牌的組合包 | `SPECIAL_CARD_POOL` 多一列（含它自己的 `content`、張數範圍與定價規則） |
| 一件新的特殊飾品 | `items.ts` 一行（帶 `availableIn`）+ `SPECIAL_ACCESSORY_POOL` 一行 |
| 一個新的貨架區（限定家具） | `LIMITED_SHOP_CONFIG.slots` 一格 + 一個新池子 |
| 一種新的商品型態（碎片包） | `LimitedGrant` 一個成員 + `buildGoodsUpdate` 一個 arm（抽獎券就是照這條路加進來的） |
| 活動限定（只在某段期間出現） | 那一列加 `availableFrom` / `availableUntil` |
| 改刷新頻率 | `refreshInterval` |
| 把某件飾品搬回普通商店 | `items.ts` 那一行的 `availableIn` |
