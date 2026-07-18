# Slice 4 R3 實作計畫 — 島嶼下一個目標＋雙向引流（2026-07-05）

> 依據：`Slice4_第一輪實作計畫.md`＋`Slice4_第一輪驗收報告.md`（通過；十-3 建議優先序 R3 > R2 > Slice 3）、`Slice_Workflows_重整版.md`（Slice 4 §7 第三輪：「第二幕吃真 session 數字；island HUD『下一個目標』讀 CATALOG+unlocked+coins 計算；點擊互導。完成：數字與 store 一致、雙向導流可走」）、`Vertical_Slices_重整版.md`、`Design_System_收斂版.md`（§七-Slice 4「island HUD 常駐『下一個解鎖：風車 差 40🪙』」、元件 #15 Empty）、`docs/CONTRACTS.md`、`docs/SPEC.md`（§3.2 島嶼經濟）、Slice 1/2 驗收報告。
> 本文件為**實作計畫**，動工前須經 cross-model 互審蓋章（cmr marker）。
> 備註：本計畫模板中段（一節開頭、四節後半、五～七節、八節前四項）於使用者訊息中亂碼，依既有計畫結構重建為九節。

---

## 一、Slice 4 R3 目標

R3 要解決的問題：**獎勵演出結束後循環就斷了——使用者拿到金幣、到了島嶼，但不知道「下一步為什麼要繼續訓練」**。

1. **結算後不能只停在獎勵畫面**——第二幕目前的島嶼提示是通用文案（「去島上蓋新建築吧」），沒有具體目標。
2. **金幣要能推動具體島嶼目標**——第二幕與島嶼頁都要指名「下一個目標：風車」這種可想像的東西。
3. **距離感**——「差 40🪙」讓使用者知道還要練多少（一次深蹲訓練約可賺數百金幣，差距是可跨越的）。
4. **自然引導回訓練**——島嶼頁的目標提示可點擊 → 直達訓練頁（循環第 6 步「拉回訓練」的實體入口）。
5. **島嶼主畫面承接訓練成果**——常駐目標條隨 store 訂閱即時更新（練完回來，差距數字已經變小/變成「足夠了！」）。
6. **補齊「島嶼成長 → 拉回訓練」**——企劃循環六步至此全部有實體畫面：任務(S1)→推薦(S2)→訓練→結算獎勵(S4R1)→島嶼目標(本輪)→再訓練(本輪引流)。
7. **評審視角**：看完一輪就明白這是遊戲化產品循環，不是「計次工具＋裝飾島」。

## 二、目前 Slice 4 第一輪成果盤點

1. **已完成結算功能**：兩幕流程（成績單→獎勵）、CTA 契約兩變體（>0 去蓋房子／=0 再一次）、防刷三方吻合（畫面=session=錢包）。
2. **金幣/XP/獎勵回饋**：金幣大數字、Lv/XP 條真 ratio、+N XP——全真值，已到位。
3. **回到島嶼 CTA**：「🏝️ 去蓋房子」→ navigate('island') 已通，但**落地後島上沒有任何承接**（不知道能蓋什麼、差多少）。
4. **島嶼回饋**：第二幕僅通用 caption＋已建 N 棟；island 端只有低金提示（`refreshTopHint`：<20🪙 時「金幣不多了～去訓練」）。
5. **缺「下一個目標」**：R1 依計畫刻意不放（避免假資訊）；資料基礎已備——island.js 有 `CATALOG`（12 項建築 10～250🪙、tier 1–4）＋`UNLOCK_HINT`（4 項成就鎖）＋`island.unlocked`＋`wallet.coins`。
6. **缺「再訓練引流」**：島嶼頁除了低金 toast 文案外，沒有可點擊的訓練入口。
7. **不可破壞的成果**（Slice 4 R1 驗收十-6 凍結）：兩幕流程與 CTA 契約、「先 commit 後演出」、第二幕數字=store 真值、`!live.started` 守門、renderResult 第一幕資訊。

## 三、這一輪只做什麼

**核心：一個純函式 `nextGoal(state)` ＋ 三個呈現點。**

0. **新增 `app/features/island/goals.js`（純資料＋純函式模組，可 Node 測試）**：
   - 把 `CATALOG`／`CAT`／`UNLOCK_HINT` 從 island.js **原樣搬入並 export**（island.js 改為 import——資料值零改動、單一來源）。
   - **可購買規則統一（互審裁決——修復既有資料斷點）**：現況 `garden/dock/windmill` 不在預設 `unlocked`、也不在任何成就的解鎖清單（`ACH_UNLOCK` 只有 fountain/monument/gym/tower）——**永久死庫存**。新增 `canBuy(type, state)` 單一來源：**成就鎖四項**（=UNLOCK_HINT 的 key）須 `unlocked.includes`；**其餘 CATALOG 內項目一律可購買**；**不在 CATALOG 的未知 type 回 `false`**（防未來壞資料被當可買）。`openSheet` 與 `onBuy` 的鎖定判定改用 `canBuy`（各 1 行；不碰金額檢查與 spendCoins）；不動 store（免陣列遷移——規則放純函式層，舊 localStorage 自然生效）。行為變化=garden/dock/windmill 變為可買（產品正確方向），於回報中申明。
   - 新增 `nextGoal(state)` 純函式，回傳三態（優先序由上而下）：
     - `{ kind:'save', item, gap }`——**可購買（canBuy）但買不起**的建築中「最便宜一項」（gap=cost−coins；最小差距=最可達成的下一步）→「下一個目標：碼頭 差 10🪙」→ 導訓練；
     - `{ kind:'unlock', item, hint }`——可購買的全買得起、但**尚有成就鎖項目** → 取成就鎖中最便宜一項＋其 `UNLOCK_HINT` →「完成 10 次訓練解鎖能量塔」→ **導訓練**（成就靠訓練達成，不能只開商店斷了引流）；
     - `{ kind:'done' }`——全部可買且全買得起 →「全部解鎖 🎉 金幣足夠，去蓋新建築」→ 開商店（非死路）。
   - 只讀 `state.wallet.coins`＋`state.island.unlocked`；不碰 placed/成就判定邏輯。
   - **測試錨定期望值**（防規則漂移；可買=非成就鎖的 8 項＋已解鎖成就項）：全新 store（80🪙）→ 可買中最便宜買不起=dock(90) → `save: dock, gap 10`；coins=200 同預設 unlocked → 可買 8 項全買得起（最貴 windmill 120≤200）→ `unlock: fountain`（成就鎖最便宜 80）；全解鎖＋coins=999 → `done`；0 金幣 → `save: path, gap 10`；coins=cost 剛好等額=可買（不觸發 save）。（DS 的「風車 差 40🪙」為示意文案，非規格值——以本規則實算為準。）
1. **島嶼頁常駐目標條（isl-goal）**：3D 疊加層頂部置中新增一顆 **`<button>` 玻璃膠囊**（原生按鈕=鍵盤可操作，比照推薦卡的可及性紀律；元件 #4 半透底規則）：「🎯 下一個目標：碼頭 差 10🪙 · 去訓練 ›」；掛進**既有** `store.subscribe`（`mountIsland` 已訂閱 `refreshTopHint`，同一訂閱內加 `refreshGoal()`）——練完回島數字即時正確。三態行為：save／unlock → `ctx.navigate('workout')`；done → `openSheet()`。
   **佈局避讓（互審二修——縮寬置中避不開右上成就列，改為垂直分層）**：桌面（>620px）：goal top 14 置中（max-width 420px，與 right:14 的成就列水平不相交）、`.isl-hint` top 14→64px；**手機（≤620px）**：goal top 14 滿版減邊距（`left:14px; right:14px` 單行截斷）、**`.isl-ach` 下移 top 14→62px**（讓出整條頂部給 goal）、`.isl-hint` top→108px——三層垂直堆疊、零重疊，不宣稱縮寬可避讓。`refreshTopHint` 的低金提示（coins<20「去訓練賺金幣」）**刪除該分支**——語義已被目標條完整取代（放置/編輯提示保留原樣）。
2. **金幣差距提示**：目標條下緣迷你進度（`coins/cost`，`--grad-teal` 填充、clamp 0~1）；文案數字與 store 一致（與第二幕同一函式）。
3. **結算第二幕文案接真目標**：`renderReward` 正常變體的島嶼行改為 `nextGoal` 結果——save：「🏠 已建 N 棟 · 下一個目標：碼頭 差 10🪙」；unlock：「已建 N 棟 · {UNLOCK_HINT}（能量塔）」；done：「已建 N 棟 · 島嶼全部解鎖 🎉」。Empty（0 金幣）變體**不動**（維持 R1 契約）。
4. **島嶼頁導回訓練 CTA**：即上述目標條 save／unlock 態的點擊行為（不另加獨立按鈕——島嶼疊加 UI 已有 6 顆鈕，再加違反「不遮內容」）。
5. **「還差一點」引導**：save 態且 gap ≤ 100 時文案加強為「快到了！再練一輪衝刺 💪」（**不做「再練一次就能」的硬承諾**——實際收入取決於有效次數/品質/streak，可能為 0；互審裁決採保守文案）。
6. **Empty/Loading/Error 檢查**：goal 三態即狀態設計（done=Empty 變體有慶祝文案非死路）；island 3D 載入不受影響（目標條是 DOM 疊加）；無外部依賴無 Error 態。
7. **申報式既有缺陷修復（借本輪 island.js 開放之便，供互審裁決）**：`island.js` `setTimeout(() => S.resize(), 30)` 在 30ms 內切走頁面會 null error（Slice 4 R1 驗收九-4 記錄的既有 bug）→ 改 `setTimeout(() => S?.resize?.(), 30)`——一行 null-guard，行為零變化。
8. **新增 Node 測試（只准新增，不動舊斷言）**：`nextGoal` 純函式三態＋邊界（0 金幣/剛好等於 cost/全解鎖）——約 4~6 條斷言。

**請不要做**（照使用者清單全收）：不重寫 AI 偵測；不碰 Slice 3 Coach HUD／run-token／組數狀態機；不重構 workout.js 高風險時序；不重做 Slice 4 R1 結算畫面（第二幕只改島嶼行一處文案來源）；不重做 Slice 1/2；不碰健康頁/設定頁；不新增後端/假資料庫；不做大量動畫（目標條無進場特效，沿用既有 hint 樣式語彙）；**不動 spendCoins 呼叫/placeBuilding/金額檢查等島嶼經濟金流——`openSheet`/`onBuy` 僅限「鎖定判定改用 canBuy」各 1 行，其餘邏輯一行不動**；不改 CATALOG 資料值。

## 四、預計修改檔案（檔案三分）

| 類別 | 檔案 | 原因 |
|---|---|---|
| **新增** | `app/features/island/goals.js` | CATALOG/CAT/UNLOCK_HINT 搬入＋`nextGoal(state)` 純函式（單一來源、Node 可測） |
| **可修改** | `app/features/island/island.js` | ①頂部 import goals.js（刪原地 CATALOG 定義，資料零改動）②mountIsland 模板加 `#isl-goal` 目標條（`<button>`）＋`refreshGoal()`（掛既有 subscribe）③`openSheet`/`onBuy` 的鎖定判定各 1 行改用 `canBuy`（修資料斷點；金額檢查與 spendCoins 原樣）④`refreshTopHint` 刪低金分支（語義由目標條取代）⑤三-7 的一行 null-guard。**其餘（3D/放置/編輯/成就/經濟金流）零改動** |
| **可修改** | `app/features/island/island.css` | 新增 `.isl-goal` 規則（玻璃膠囊、tokens）＋`.isl-hint` top 14→64px（1 行避讓） |
| **可修改** | `app/features/workout/workout.js` | **僅 `renderReward` 內島嶼行一處**：import `nextGoal` 並改文案來源。結算段其餘與兩幕流程零改動 |
| **可修改** | `tests/` | **僅新增** goals.test（或併入 run.js 既有風格新增 case）——舊斷言零修改 |
| **只讀** | `store.js`（getState/subscribe）、`app.css`/`lumina.css`（tokens）、Slice 1/2 檔案 | 唯讀 |
| **禁止** | `app/core/**`、`vendor/**`、`CONTRACTS.md` 簽名、workout.js 時序區/run-token/finishLive/commitSession、island.js 的 spendCoins 呼叫/placeBuilding/金額檢查/放置流程（openSheet/onBuy 僅限「鎖定判定改 canBuy」各 1 行，其餘不動）、renderResult 第一幕 | 通用鐵則＋Slice 4 R1 凍結成果 |

**回退方案**：動工前備份 island.js/island.css/workout.js 至 scratchpad；goals.js 為新檔可直接刪；island.js 的 CATALOG 搬移可由備份還原。

## 五、保留規則（重建章節）

1. Slice 4 R1 凍結成果：兩幕流程、CTA 契約兩變體、「先 commit 後演出」、第一幕資訊——第二幕只換島嶼行文案來源。
2. Slice 1／Slice 2 全部成果：零觸碰（今日層/推薦卡/簡介）。
3. 島嶼經濟鐵則：金幣只由 `commitSession` 產生、只由 `spendCoins` 消費——本輪對兩者**連呼叫都不新增**（純唯讀計算）。
4. island 放置/編輯/成就/3D 場景：零改動；商店僅「鎖定判定改 canBuy」各 1 行（目標條 done 態僅呼叫既有 `openSheet()`）。
5. `app/core`／`vendor`／`CONTRACTS.md`：零修改。
6. `tests` 舊斷言：零修改（只新增）。
7. run-token／時序區／Coach HUD：零觸碰。
8. CATALOG 資料值（價格/名稱/tier）：原樣搬移、一個值不改。

## 六、UI 方向（重建章節；DS 元件 #4 Island Panel／#12 Progress／§七-Slice 4）

- **目標條**：頂部玻璃膠囊 `<button>`（`rgba(8,22,28,.72)` 統一半透底＝元件 #4 規則、`--stroke` 邊、99px 圓角），單行：`🎯 下一個目標：碼頭 差 10🪙 · 去訓練 ›`＋下緣 3px 迷你進度條（`--surface-2` 底/`--grad-teal` 填充）；不遮島中心。
- 三態行為統一：**save／unlock → `navigate('workout')`；done → `openSheet()`**——三態皆可點（done 開商店非死路）；按壓 scale(.97)。
- 佈局：桌機 goal 置中 max 420px＋hint top 64px；手機 ≤620px goal 滿版（left/right 14px）＋成就列下移 top 62px＋hint top 108px（垂直三層零重疊，見三-1）。
- 第二幕島嶼行：沿用既有 `.wk-rw-island` 樣式，僅文字變（差距數字用 `--gold` 強調）。
- 零新 token、零硬編碼色票；無進場動畫（儀式預算仍留 R4）。

## 七、完成標準（重建章節）

1. 島嶼頁常駐目標條，三態文案正確且**數字與 store 一致**（差距=cost−coins 實算）。
2. 目標條 save／unlock 態點擊 → 訓練頁；done 態點擊 → 開商店 sheet（三態皆可點、無死路）。
3. 訓練跑完回島嶼 → 目標條數字即時更新（subscribe 生效，不需重整）。
4. 第二幕島嶼行顯示真目標（三態），Empty 變體不變。
5. **雙向導流走得通**：結算→去蓋房子→島嶼（見目標）→點目標條→訓練頁→（推薦卡）→再訓練。
6. `nextGoal` 新測試綠；**34 舊測試全綠、零修改**。
7. 0 console error；island.js 30ms 切頁競態修復後，快速切 tab 不再噴 error。
8. Slice 1／2／4R1 成果零破壞（實測清單）。
9. 390/1200 兩檔可讀、截圖存檔。
10. diff 僅落在四節宣告的檔案與區段。

## 八、測試方式

1. `node tests/run.js`：34 舊斷言綠＋新增 `nextGoal`/`canBuy` 斷言綠——**錨定期望值**：全新 store（80🪙）→ `save: dock, gap 10`；coins=200 → `unlock: fountain`（可買的全買得起、成就鎖最便宜者）；全解鎖＋高額 → `done`；邊界：0 金幣（save: path, gap 10）、coins=cost 剛好等額（可買不觸發 save）、canBuy(garden)=true（死庫存已修）。
2. 開 App → 島嶼頁：目標條出現、文案=用當前 coins 手算的結果。
3. Console 改變前提重測三態（讀 localStorage 驗證，不寫 store：以現有錢包對照 CATALOG 驗 save；unlock/done 態以新 Node 測試覆蓋）。
4. 示範模式跑完一輪 → 第二幕島嶼行顯示真目標。
5. 檢查下一目標提示：第二幕與島嶼目標條**同一數字**（同一函式）。
6. 「去蓋房子」→ 島嶼：目標條已反映新錢包（即時更新）。
7. 島嶼目標條 save/unlock 態點擊 → 訓練頁（推薦卡在頂）；done 態 → 商店 sheet 打開（以新測試＋手動改態驗證）。
8. Slice 1：今日層/streak/CTA 照常。
9. Slice 2：推薦卡/型錄/搜尋照常。
10. Slice 4 R1：兩幕流程/CTA 契約/防刷比對照常（重跑一次 E2E）。
11. 手機 390px 截圖存檔。
12. 桌機 1200px 截圖存檔。
13. `ls -la app/core` 時間戳未變。
14. `tests` 舊斷言未修改（diff 只有新增）。
15. 快速切 tab（島嶼→訓練 30ms 內）不再出現 resize null error（三-7 修復驗證）。

## 九、下一步實作提示詞（可直接貼給 Codex / Cursor / Claude Code）

```
請只處理 Slice 4 R3：島嶼下一個目標＋雙向引流。

請閱讀：
1. docs/planning/Slice4_R3_第一輪實作計畫.md（本輪唯一依據，含檔案三分與 nextGoal 三態規格）
2. docs/planning/Slice4_第一輪驗收報告.md（十-6 凍結成果清單）
3. docs/ai-rules/Design_System_收斂版.md（元件 #4/#12/#15、§七-Slice 4）
4. docs/CONTRACTS.md

這次只做：nextGoal 純函式＋島嶼目標條＋第二幕島嶼行接真目標＋一行既有 null-guard 修復。

請完成：
1. 新增 app/features/island/goals.js：CATALOG/CAT/UNLOCK_HINT 自 island.js 原樣搬入並 export（資料一個值不改）；
   新增 canBuy(type, state)（成就鎖四項=UNLOCK_HINT keys 須 unlocked.includes；其餘 CATALOG 內項目一律可買——修 garden/dock/windmill 死庫存；不在 CATALOG 的未知 type 回 false）；
   新增 nextGoal(state) 純函式回傳三態（優先序）：{kind:'save',item,gap}（可買但買不起的最便宜項）→
   {kind:'unlock',item,hint}（可買的全買得起、尚有成就鎖→取最便宜成就鎖項）→ {kind:'done'}；只讀 wallet.coins 與 island.unlocked
2. island.js：改 import goals.js；mountIsland 模板加 #isl-goal 目標條（<button> 頂部玻璃膠囊+迷你進度條，tokens）；
   新增 refreshGoal() 掛進既有 store.subscribe；save/unlock 態點擊→ctx.navigate('workout')、done 態→openSheet()；
   openSheet/onBuy 鎖定判定各 1 行改用 canBuy（金額檢查與 spendCoins 原樣不動）；refreshTopHint 刪 coins<20 低金分支；
   另修一行既有 bug：setTimeout(() => S.resize(), 30) → setTimeout(() => S?.resize?.(), 30)
3. island.css：新增 .isl-goal 規則（半透底 rgba(8,22,28,.72)、--stroke 邊、進度條 --grad-teal）；
   佈局避讓＝垂直分層：桌機 goal 置中 max 420px＋.isl-hint top 64px；
   手機 ≤620px：goal left/right 14px 滿版單行截斷＋.isl-ach top 62px（下移）＋.isl-hint top 108px——零重疊
4. workout.js：僅 renderReward 內島嶼行改用 nextGoal 三態文案（Empty 變體不動）；頂部 import nextGoal；
   save 態 gap≤100 時文案「快到了！再練一輪衝刺 💪」（不做硬承諾）
5. tests：僅新增 nextGoal/canBuy 斷言（錨定：fresh 80🪙→save dock gap10；coins200→unlock fountain；全解鎖高額→done；
   canBuy(garden)=true），舊斷言零修改

請不要：
1. 不要修改 app/core、vendor、CONTRACTS 既有簽名、tests 舊斷言
2. 除「鎖定判定改用 canBuy」各 1 行外，不要動 openSheet/onBuy 其他邏輯；不要動 spendCoins 呼叫/placeBuilding/金額檢查、CATALOG 資料值、3D 場景/放置/編輯邏輯
3. 不要碰 run-token/時序區/Coach HUD/組數狀態機（Slice 3 地盤）、finishLive/commitSession
4. 不要重做 Slice 4 R1 結算畫面（第二幕只改島嶼行一處）、不要動 renderResult 第一幕與 CTA 契約
5. 不要回頭重做 Slice 1/2、不要處理 Slice 3/5/6、不要新增後端/假資料庫
6. 不要加進場動畫/儀式特效（歸 R4）、不要新增 token 或硬編碼色票

完成後請回報：
1. 修改了哪些檔案與 diff 範圍自查
2. nextGoal 三態的實測值（島嶼目標條與第二幕同數字佐證）
3. 雙向導流實測（結算→島→目標條→訓練）
4. node tests/run.js 結果（34 舊＋N 新全綠）＋console 0 error＋快速切 tab 不再噴 resize error
5. 390/1200 截圖
```

<!-- cross-model-review: APPROVED reviewer=codex hash=92d7e41861d462d9 at=2026-07-05T10:48:21+08:00 -->
