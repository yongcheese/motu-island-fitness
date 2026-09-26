# 功能卡 — Utility Cards、效果系統與獎勵計算層

玩家可以持有、在自己選的時機使用、使用後在一段時間內改變獎勵的道具。第一張是**雙倍金幣券**。

這份文件的重點不是那張券，而是它底下的兩層：**功能卡系統**（卡片是什麼、放在哪、怎麼用）與
**獎勵計算層**（效果在哪裡被套用）。目標是「之後再加十張卡，不需要動任何一個獎勵來源」。

---

## 一句話架構

```
限時小攤購買（組合包）/ 輪盤抽到
        │  grantCards()（上限在這裡，只有這裡）
        ▼
功能卡庫存  profile.utilityCards.owned      ─────  constants/utilityCards.ts
        │  useCard()：扣一張、產生一筆 ActiveUtilityEffect
        ▼
進行中的效果 profile.utilityCards.active
        │
        │  ← 任何一筆獎勵發放時被讀到
        ▼
獎勵計算層  settleReward(base, { cards, nowMs })  ─────  constants/rewardEffects.ts
        │  Base Reward → 政策檢查 → 套用效果 → Final Reward
        ▼
buildCurrencyUpdate()  ─────  context/useEconomyActions.ts（全遊戲唯一的接點）
        ▼
increment() 寫進錢包
```

獎勵來源長什麼樣完全不影響上面這條路：

```
健身結算（現在的 Prototype，未來的 API）  ┐
每日登入 / 摸摸寵物 / 島嶼秘寶            ├→ buildCurrencyUpdate → settleReward → 錢包
管理員測試加值                            ┘
```

---

## 檔案

| 檔案 | 角色 |
|---|---|
| `src/constants/utilityCards.ts` | **資料與純規則**。卡片目錄、效果型別、持續時間、堆疊規則、持有上限、存檔結構，以及 grant / use / 過期 的純函式。沒有 React、沒有 Firestore。 |
| `src/constants/rewardEffects.ts` | **獎勵計算層**。`settleReward()` — 唯一會把倍率乘上去的地方。 |
| `src/context/useUtilityCards.ts` | **功能卡服務**。唯一會寫入 `utilityCards` 的地方（發卡、使用、管理員重置）。 |
| `src/context/useEconomyActions.ts` | `buildCurrencyUpdate()` — 獎勵計算層唯一的資料庫接點。政策檢查也在這裡。 |
| `src/components/UI/UtilityCard.tsx` | **共用卡片元件**：卡面、效果 chip、「我的功能卡」背包、進行中效果的倒數。 |
| `src/constants/wheelRewards.ts` | 輪盤獎勵表（功能卡是其中一格，權重最低）。 |
| `src/constants/limitedShop.ts` | 限時小攤的商品池（功能卡以**組合包**形式在這裡販售）。見 `docs/limited-shop.md`。 |
| `scripts/test-utility-cards.ts` | 規格測試。`npm run test:utility-cards`。 |

---

## 一、卡片是資料

```ts
export const UTILITY_CARDS: Record<UtilityCardId, UtilityCardDefinition> = {
  'double-coin': {
    id: 'double-coin',
    name: '雙倍金幣券',
    effect: { kind: 'currency-multiplier', currency: 'coins', multiplier: 2 },
    duration: { kind: 'timed', seconds: 30 * 60 },
    rarity: 'rare',
    stacking: 'reject',
    maxOwned: 99,
    channels: ['limited-shop', 'wheel'],
    …
  },
};
```

要點：

- **價格不在這裡，數量也不在。** 賣多少錢、一包幾張，是「賣它的貨架」的事（`constants/limitedShop.ts`），不是卡片的屬性。
  同一張卡在限時小攤同時有碎片與金幣兩種買法、而且整包的張數與價格每一檔都重新配置，就是因為這些都不屬於卡片。
- **效果是宣告，不是程式。** `UtilityEffect` 目前有兩種形狀：`currency-multiplier`（任何貨幣）與
  `xp-multiplier`。兩種都已經在 `settleReward` 裡實作，所以「碎片 ×1.5」「經驗值 ×2」現在就寫得出來，
  一行程式都不用改。真正的新形狀（額外抽獎、固定加值）才需要在 union 加一個成員、在 resolver 加一個
  分支。
- **沒有任何地方 `if (cardId === 'double-coin')`。** 庫存、使用流程、獎勵計算、商店、UI 都不知道有這張
  卡。要加第二張卡，做三件事：`UtilityCardId` 加一個成員、`UTILITY_CARDS` 加一列、在 `SPECIAL_CARD_POOL` 或
  輪盤獎勵表放上去。

## 二、金幣 ×2 在哪一層計算

**在 `constants/rewardEffects.ts` 的 `settleReward()`，而且只有那裡。**

進入資料庫的唯一接點是 `context/useEconomyActions.ts` 的 `buildCurrencyUpdate()`：

```ts
Base Reward → checkGrant（來源→貨幣政策） → settleReward（進行中的效果） → increment()
```

所有會發貨幣的路徑都走它：`grantReward()`、摸摸寵物、離線版每日登入結算、以及健身結算
（`context/useWorkoutRewards.ts`）。它的 `effects` 參數**是必填的**，這是刻意的：新的發放路徑
無法「忘記」套用玩家的卡片，因為不寫就編譯不過。

同樣重要的是**沒有被改的東西**：

- `payoutForWorkout()`（constants/workoutRewards.ts）仍然是 **Base Reward**，沒有被乘過。
- 健身畫面、健身完成事件、健身獎勵服務裡都沒有出現「卡」這個字。
- `workout_logs` 的 `goldEarned` 記的是**實際入帳**的金額，所以「規則說多少」與「玩家拿到多少」
  永遠分得開。

這正是需求 §16 要的性質：等目前的假健身流程換成外部 API，雙倍金幣券不需要任何改動就會繼續生效，
因為倍率從來就不在健身那條路上。

## 三、不會重複計算

- **只有一個乘法點。** 上面那條。要重複計算，得有第二個呼叫 `settleReward` 的寫入路徑，而寫入路徑
  就只有 `buildCurrencyUpdate` 一個。
- **同一張卡不會同時有兩筆效果。** `stacking: 'reject'` 的卡在自己的效果進行中時會拒絕再次使用（卡片
  留在背包裡）；`'extend'` 的卡則是延長既有那一筆，而不是追加第二筆記錄。
- **不同效果相乘，但有上限。** `MAX_REWARD_MULTIPLIER = 4`。這是護欄不是平衡數值 —— 和
  `maxCoinsPerWorkout` 一樣的角色：存檔壞掉或未來三張卡疊在一起時，結果是「上限」而不是「經濟崩掉」。
- **次數型效果只有真的被套用時才會扣。** 一筆不適用的獎勵（例如碎片獎勵遇到金幣卡）不會消耗次數。

## 四、Inventory → Use → Active Effect → Effect End

存在 `profile.utilityCards`，一個巢狀 map（理由和 `workoutRewards`／`islandState` 一樣：
firestore.rules 裡是一個 clause、每個白名單裡是一個 entry，所以第二張卡不需要改規則）：

```ts
utilityCards?: {
  owned?:     { 'double-coin': 3 },              // 持有數量
  active?:    [{ activationId, cardId, activatedAt, expiresAt? , usesLeft? }],
  usedTotal?: { 'double-coin': 7 },              // 累計使用次數（讀出來給人看的）
}
```

- **效果記錄只存 cardId**，不存效果內容。所以調整卡片數值時，進行中的效果會跟著改；卡片被下架時，
  遺留的效果會直接失效，而不是繼續用一份找不到來源的設定發錢。
- **過期不需要排程**：任何讀取都會經過 `activeEffects(state, nowMs)` 過濾，`pruneUtilityState()`
  只是在下一次寫入時順手清掉，乾淨的存檔不會產生任何寫入。
- **時間用的是玩家裝置的時鐘。** 這是 Prototype 的取捨，也寫在程式註解裡：目前沒有伺服器可以仲裁。
  每個函式都把 `nowMs` 當參數傳進來，所以之後改成伺服器時間只會動到一個參數。

## 五、既有的庫存系統怎麼處理

**沒有第二套 Inventory。** 需求要求先檢查 —— 檢查結果是：`profile.inventory` 是「商品目錄的 id 清單」，
規則是 own-once 或依擺放數量計算庫存（`utils/inventory.ts`），而功能卡的規則是「數量 + 上限 + 會被消耗」。
把卡塞進 `inventory` 會讓每一個讀 inventory 的畫面（更衣室、建造欄、家具抽屜、收納庫）都得學會忽略它。

所以功能卡是**同一份存檔裡的另一個欄位**，不是另一套系統：同一個 profile、同一條 `updateDoc` 路徑、
同一個 `applyProfilePatch`、同一種「寫入成功才反映到畫面」的規則。UI 上也刻意分開：卡片在
「我的功能卡」背包（商店與限時小攤的標題列都有入口），動詞是**使用**；收納庫裡的東西動詞是穿戴或擺放。

## 六、UI 上怎麼一眼認出這不是普通商品

`components/UI/UtilityCard.tsx`，四件事一起做，而且沒有一件是靠顏色：

1. **形狀不同** — 圓形的圖示框（商品卡是 4:3 方框）、卡面下方一條虛線的票根線。
2. **效果是標題** — 「金幣獲得 ×2」放在商品卡放價格的位置。商品卡回答「這是什麼」，功能卡要回答
   「用了會怎樣」。
3. **「功能卡」標籤** — 形狀要學過才認得，字不用。
4. **持續時間** — 「持續 30 分鐘」，因為「用了會怎樣」少了「多久」就沒講完。

稀有度用的是全遊戲共用的那一套（`.rarity-card` / `RarityAura`），刻意的：卡片和商品排在同一個
稀有度階梯上，另做一套等於要維護兩套分級。

進行中的效果由 `<ActiveEffectChip />` 顯示（商店標題列），沒有效果時完全不 render。

## 七、之後要加一張新卡

1. `UtilityCardId` 加一個成員。
2. `UTILITY_CARDS` 加一列（名稱、說明、effect、duration、rarity、icon、stacking、maxOwned、channels）。
3. 決定取得管道：`constants/limitedShop.ts` 加一個商品，或 `constants/wheelRewards.ts` 加一格（或兩者）。
4. 跑 `npm run test:utility-cards` —— 它會檢查卡片宣告的 `channels` 和實際的商品/獎勵表是否一致。

**不需要**改的地方：獎勵計算層、任何獎勵來源、限時小攤的購買流程與輪替、輪盤的抽選、卡片 UI、firestore.rules。

如果新卡是全新的效果**形狀**（不是新的數值），那就多一步：`UtilityEffect` 加一個成員，
`settleReward()` 加一個分支。這是唯一會動到計算層的情況。

## 八、目前還沒決定的數值

| 項目 | 目前值 | 在哪裡改 |
|---|---|---|
| 雙倍金幣券的持續時間 | 30 分鐘 | `UTILITY_CARDS['double-coin'].duration`（改成「下一次健身 ×2」就是 `{ kind: 'uses', count: 1 }`） |
| 碎片價 | 每張 160 上下浮動 | `SPECIAL_CARD_POOL` 裡 `ls-card-double-coin` 的 `pricing` |
| 金幣價 | 每張 1,200 上下浮動 | 同上。刻意昂貴 —— 見 `docs/limited-shop.md` |
| 一包幾張 | 2–4，每檔重抽 | 同上的 `quantity` |
| 每檔期限購 | 1 | 同上的 `purchaseLimit` |
| 輪盤機率 | 1.0% | `WHEEL_SLOTS` 裡 `card-double-coin` 的 `weight` |

## 九、管理員測試

限時小攤 →「我的功能卡」底部（`<AdminOnly>`）：

- **模擬輪盤抽獎** — 跑真正的加權抽選與真正的發放路徑。目前沒有輪盤畫面，這是唯一能走完那條路的入口。
- **重置功能卡** — 清空持有、進行中的效果與使用統計。不退錢、不補卡。

刻意沒有「直接發一張卡」的按鈕：要測就抽或買，那才是玩家會走的路。

## 十、已知的取捨

- **時間是裝置時鐘。** 沒有伺服器可以仲裁，改時鐘可以延長效果。寫在程式裡，不假裝解決。
- **整個 map 一次寫入。** 卡片 id 有連字號，Firestore 的 dotted path 與本機存檔的 shim 對它的解讀不一樣
  （和 `itemFragments` 同樣的理由）。代價是理論上會覆寫同時發生的另一次卡片寫入；那是幾個數字的 map，
  而且卡片的寫入本來就不密集。
- **firestore.rules 需要部署。** `utilityCards` 有新的 clause 與六個白名單條目。**這個檔案改了但沒有
  部署的話，不是「某個欄位被拒絕」，而是整個 profile 讀取會塌成新手存檔** —— 見 `docs/FIRESTORE_RULES.md`。
