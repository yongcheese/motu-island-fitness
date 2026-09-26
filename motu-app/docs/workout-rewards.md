# 健身獎勵 — Workout Completion → Reward System

新手即時回饋。玩家第一次完成健身後，回到主畫面時會拿到一件低價的人物裝飾。

這份文件的重點不是那個彈窗，而是它底下的**中間層**：目前的健身系統只是暫時的 Prototype，未來真正的
健身系統會在另一端開發並透過 API 串接，所以獎勵系統必須完全不知道「這次健身是從哪裡來的」。

---

## 一句話架構

```
Prototype Workout (components/FitnessView.tsx)
        │
        │  reportWorkoutCompletion(makeWorkoutCompletion({ … }))
        ▼
Workout Completion Interface  ─────────────  lib/workoutCompletion.ts
        │        （一個事件匯流排。沒有獎勵邏輯、沒有物品、沒有存檔、沒有 UI）
        ▼
Reward Service                ─────────────  context/useWorkoutRewards.ts
        │        有效性檢查 → 去重 → 讀規則 → 篩選獎勵池 → 隨機 → 一次寫入 → 才發通知
        ▼
Inventory + Player Data (users/{uid})        →  通知  →  components/UI/WorkoutRewardPopup.tsx
```

未來：

```
External Fitness API
        │
        ▼
API Adapter（新檔案，只做三件事：驗證身分、把回應轉成 WorkoutCompletion、呼叫 reportWorkoutCompletion）
        │
        ▼
Workout Completion Interface   ← 完全相同
        ▼
Reward Service                 ← 完全相同，一行都不用改
```

---

## 檔案

| 檔案 | 角色 |
|---|---|
| `src/constants/workoutRewards.ts` | **資料與規則**。獎勵池條件、價格上限、稀有度上限、觸發規則表、有效性門檻、存檔結構、純函式的抽獎。沒有 React、沒有 Firestore、沒有寫死的物品 id。 |
| `src/lib/workoutCompletion.ts` | **完成事件介面**。`WorkoutCompletion` 的建構、發布與訂閱。這是 Prototype 與未來 API 共用的唯一接點。 |
| `src/context/useWorkoutRewards.ts` | **Reward Service**。唯一會因為健身而寫入 inventory / 存檔的地方。掛在 AppProvider 上，不是掛在健身畫面上。 |
| `src/components/UI/WorkoutRewardPopup.tsx` | **通知 UI**。回到主畫面後才顯示，用現有 DesignKit 元件，什麼也不決定。 |
| `src/components/UI/AdminWorkoutRewardControls.tsx` | 管理員測試面板（`<AdminOnly>`，掛在帳號中心）。 |
| `scripts/test-workout-rewards.ts` | `npm run test:workout-rewards`。規則的規格書。 |

---

## 獎勵池怎麼決定（§3 / §4）

獎勵池是**從商店目錄推導出來的**，不是列舉的。`NEWBIE_REWARD_POOL` 只宣告條件：

```ts
categories:  ['Tops', 'Bottoms', 'Hats', 'Shoes', 'Accessories', 'Hair']
maxPrice:    NEWBIE_PRICE_CEILING (300)
minPrice:    1
maxRarity:   null          // 只收「完全沒有稀有度標記」的普通商品
allowXpUnlock: false       // 經驗值解鎖的東西是練出來的，不是送的
preferUnowned: true        // 已經有的就換一件；全部都有時才會重複
```

於是：

- 新增一件 180 金幣的普通上衣 → **自動**進入獎勵池，這個檔案不用改。
- 把某頂帽子調成 2,000 金幣 → **自動**離開獎勵池。
- 高價服裝、特殊飾品（`SpecialFx`）、寵物、寵物飾品、家具、藝術品、房屋外觀、地板牆面、
  任何有稀有度標記的、任何 `xpUnlock` 的 → **結構上進不來**，不需要逐項排除。

`npm run test:workout-rewards` 會把上面每一條都當成測試項目跑一次，所以有人把一件神話物品標成
200 金幣時，是測試會紅，而不是玩家在第一次健身時抽到它。

價格上限 300 是對著遊戲經濟訂的：每日登入第 1 天發 100、第 7 天發 1,500，所以 300 大約是「乖乖上線
兩天」。要改是一行，但那是一個真的設計決定 —— 拉到 500 之後獎勵池會吞掉大半個衣櫃，「新手小禮物」
就不小了。

---

## 發放流程（§11 / §12 / §16）

`context/useWorkoutRewards.ts` 的 `processCompletion`：

1. **有效嗎** — `isValidWorkout`。沒有 id、沒有 userId、時間戳壞掉、或既沒時間也沒次數 → 丟掉。
   這個檢查對「可信任的 API」也照跑：伺服器保證的是健身真的發生過，不是封包完整無缺。
2. **是不是同一件事** — `processedIds` + 一個 in-flight 的 ref。
3. **欠什麼** — `resolvePendingRewards(state)` 讀規則表，回傳這次該發的規則清單。
4. **抽** — 先 Filter 再 Random，永遠不是先 Random 再檢查。種子來自 completion id，所以
   **重試會抽到同一件**。
5. **一次寫入** — `inventory` 與 `workoutRewards` 在同一個 `updateDoc` 裡，一起成功或一起失敗。
6. **成功之後**才把通知丟給 UI。

失敗時：不標記已領取、不改 inventory、不顯示任何東西，下一次健身會從完全相同的狀態再試一次。
這裡**故意沒有樂觀更新** —— 遊戲其他地方（`updateProfile`）都是先改畫面再回滾，那對「移動一張沙發」
是對的，對「發一件物品」是錯的：顯示了再收回是 UI 能說的最重的謊。

反方向也一樣被擋住：因為是同一次寫入，不可能出現「已標記領取但背包沒東西」。

---

## 一次性與重複觸發（§6 / §13）

三層，因為三種失敗模式不一樣：

| 層 | 擋什麼 | 存在哪 |
|---|---|---|
| `inFlight` ref | 同一個 tick 進來兩次、按鈕連點 | 記憶體（決定要發到寫入回來的那段空窗） |
| `processedIds` | 重新載入、換場景、API 重試、事件匯流排補送 | 存檔 |
| claim key 本身 | 終極保險：`once-per-account` 的獎勵一旦有紀錄就永遠不再發 | 存檔 |

再加上「同一個 completion id 抽到同一件物品」，就算三層都被繞過，重播也只會得到同一個結果而不是
第二件不同的東西。

判斷依據是**帳號層級的領取紀錄**，不是「今天有沒有健身」、也不是「這個 session 是不是第一次」。

---

## 存檔結構

```ts
profile.workoutRewards = {
  claims: {
    first_workout: { itemId, grantedAt, workoutId, source },
  },
  completedCount: 3,
  lastCompletedAt: '2026-08-24T…',
  processedIds: ['wk-…', 'wk-…'],
}
```

一個巢狀 map，理由和 `islandState` 一樣：所有欄位一起寫、一起讀，而且在 `firestore.rules` 裡是
**一個 key、一條 whitelist**。用一個 `firstWorkoutRewardClaimed: boolean` 是最直覺的做法，也是唯一
撐不過 §19 的做法 —— 之後每加一個獎勵就要多一個欄位、多一條規則、多一次 rules 部署。

> ⚠️ **`firestore.rules` 改了就必須部署**：`npx firebase-tools deploy --only firestore:rules`。
> 沒部署的話，`workoutRewards` 這個欄位會讓**整份 profile 的寫入**被拒絕，而不只是這一次獎勵失敗。
> 見 `docs/FIRESTORE_RULES.md`。

---

## 之後要加新獎勵（§19）

以「連續健身七天」為例，要動的地方：

1. `WorkoutRewardTriggerId` 加一個 id。
2. `WORKOUT_REWARD_RULES` 加一列（標題、文案、獎勵池、cadence）。
3. 需要新的獎勵池的話，在同一個檔案加一個 `WorkoutRewardPool`。
4. `resolvePendingRewards` 加一個條件（讀 `completedCount` / `lastCompletedAt`）。

Reward Service、通知 UI、存檔結構、firestore.rules 都不用動 —— 服務本身不知道任何一個觸發的
「意思」，它只讀 cadence、查 claim key、從指定的池子抽、然後寫入。

---

## 接上真正的健身 API（§9）

新增一個 adapter（例如 `src/lib/fitnessApiAdapter.ts`），它只做三件事：

```ts
const verified = await fetchVerifiedWorkout(...);      // 驗證身分、拿到服務端已確認的紀錄
reportWorkoutCompletion(
  makeWorkoutCompletion({
    workoutId: verified.id,        // ★ 一定要用服務端的 id，不要讓這裡自己生
    userId: currentUid,
    completedAt: verified.finished_at,
    workoutType: verified.kind,
    durationSeconds: verified.duration_s,
    repCount: verified.reps,
    source: 'external-api',
  }),
);
```

然後把 `FitnessView` 裡那唯一一行 `reportWorkoutCompletion(...)` 拿掉。就這樣。

`workoutId` 用服務端的 id 是**唯一一件不能省的事**：去重整套機制都建立在它上面，而在 client 生成的
id 每次重試都是新的，等於把它自己存在的理由消掉。

日後如果要把發放本身也搬到伺服器（像每日登入那樣，見 `src/server/dailyLoginApi.ts`），要換掉的是
`useWorkoutRewards` 裡的寫入段落，規則、獎勵池與 UI 都可以原封不動。

---

## 管理員測試（§17）

帳號中心 →「健身獎勵測試」（只在 **管理員測試模式** 開啟時出現）：

- **模擬完成健身** — 發出一個**真的**完成事件（`source: 'admin-test'`），之後走的是玩家健身時
  一模一樣的訂閱、檢查、獎勵池、寫入與彈窗。不是把結果畫出來 —— 那會是第二套實作，正式那條路壞掉時
  它還是會通過。
- **抽獎預覽** — 只抽給人看，不寫入任何東西。
- **獎勵池列表** — 目前符合條件的每一件（名稱 + 價格），一眼就能看出有沒有混進不該有的東西。
- **重置獎勵狀態** — 清掉領取紀錄。**不會**把已經發出去的物品收回；重置後再測會因為 `preferUnowned`
  抽到不同的物品，對測試反而更有用。

見 `src/constants/adminFeatures.ts` 的 `workout-reward-simulator`。

---

## 已知的取捨

- **通知可能會漏，物品不會。** 獎勵是在健身結束的當下就寫進存檔的；通知只是一個放在 provider 裡的
  快照，玩家如果在回主畫面之前重新整理，物品照樣在背包裡，但那個彈窗不會再出現。§12 要求的是
  「獎勵不能因為 UI 關閉而遺失」，物品沒有遺失。
- **發放目前由 client 決定。** 這在只發低價裝飾的前提下是可以接受的（`firestore.rules` 檢查形狀與
  大小，檢查不了「這件該不該給」）。真正需要伺服器仲裁的時候，換掉的是寫入段落，見上一節。

---

## 2026-08-25 — 健身的金幣給付也搬進來了

在這之前，`FitnessView.finishWorkout` 自己算 `Math.floor(reps * 0.8)` 金幣與 `reps * 5` XP、
直接寫進存檔、再寫 workout_logs，**然後才**發出完成事件。

那有三個問題，而且第三個是構造性的：

1. 一個拋棄式原型畫面成了遊戲經濟的權威。換成真 API 時，要嘛在 adapter 裡重新推導經濟，
   要嘛留一個沒人用的 UI 檔案在樹裡只為了保管那些數字。
2. 貨幣從元件裡被寫入，沒有記錄來源。
3. **給付發生在事件發布之前**，所以沒有任何東西能分辨「重送的完成事件」與「新的完成事件」。

現在：

- 公式是資料（`WORKOUT_PAYOUT` / `payoutForWorkout`，constants/workoutRewards.ts）
- 給付與 replay guard（`processedIds`）在**同一次 `updateDoc`**，重送不可能付兩次
- workout_logs 也由獎勵服務寫，所以 `goldEarned` 一定等於真正入帳的數字
- 每筆發放都帶 `source: 'workout'`，並通過 `SOURCE_CURRENCY_POLICY`——
  這條政策是「金幣只能來自健身」的實際執行點，不是註解
- `FitnessView` 的全部貢獻是**一次** `reportWorkoutCompletion()`；結算畫面上的「獲得金幣」
  是跟獎勵服務問同一個純函式，不是自己再算一次

獎勵池的稀有度上限從 `maxRarity: null` 改成 `maxRarity: 'common'`。語意完全沒變——
在稀有度還是選填的年代，`null` 的意思是「只收沒有稀有度標記的普通商品」；
現在每件商品都有稀有度，那個狀態不存在了，所以同一個意圖要用階級自己的名字說。

完整的經濟架構見 `docs/economy.md`。
