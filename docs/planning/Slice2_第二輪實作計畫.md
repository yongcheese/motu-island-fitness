# Slice 2 第二輪實作計畫 — 選擇訓練：元件抽出／元件整理（2026-07-05）

> 依據：`Slice2_第一輪實作計畫.md`（已蓋章）、`Slice2_第一輪驗收報告.md`（通過、零偏差）、`Slice1_階段總結與交接.md`、`Slice_Workflows_重整版.md`（Slice 2 §7 第二輪：「推薦大卡與一般卡共用 cardHtml 變體。完成：**畫面不變、碼更乾淨**」）、`Design_System_收斂版.md`、`docs/CONTRACTS.md`、R1 實際改動檔（workout.js／workout.css）。
> 本文件為**實作計畫**，動工前須經 cross-model 互審蓋章（cmr marker）。
> 備註：本計畫模板中段（一、二節、元件清單第 1 項、六節後段、七節）於使用者訊息中亂碼，依既有計畫結構重建為九節。

---

## 一、第二輪目標（重建章節）

把 Slice 2 第一輪做出來的「今日推薦大卡＋型錄卡」從**兩段各自 inline 的模板字串**整理成**共用的純模板小元件（純函式）**：

1. 消除重複碼：難度 dots、🪙/🔥 獎勵徽章、課表句（組×次×休息）目前在 `recCardHtml` 與 `cardHtml` 各寫一份——抽成共用函式，未來改一處兩卡同步。
2. 命名與分區整理：卡片相關模板函式集中成一個「卡片元件區」，讓 Slice 3（高風險時序輪）進場時，呈現層與時序區的邊界一眼可辨。
3. 為 R3/R4 鋪路：理由文案從常數變佔位純函式（R3 只改函式內部即可接任務欄位）；課表句單一來源（R4 簡介文案一致化時同源引用）。
4. **對外行為與畫面完全不變**（本輪唯一完成語義——workflow 明定「畫面不變、碼更乾淨」）。

**本輪重要改判（相對 R1 計畫七節的預告）**：R1 計畫曾寫「3D 縮圖歸 R2 一併正解」，但與 workflow 的 R2 完成標準「畫面不變」及 Slice 2 §6「不動 cardAv/introAv 的 3D 管線」直接衝突。裁決：**R2 不做 3D 縮圖**（零視覺變更輪）；3D 縮圖改歸 **R4 互動補強**，屆時方案採「推薦卡專屬獨立 avatar 實例」（比照 `animDemo` 的 `introAv` 模式，自帶 RAF 與 dispose，**完全不碰共用 `cardAv`/`startCardAnims`**），並於 R4 計畫中連同生命週期驗收一併互審。

## 二、第一輪成果盤點——抽元件的素材（重建章節）

| 現況 | 位置 | 重複狀況 |
|---|---|---|
| 難度 dots `[1,2,3].map(...)` | `cardHtml` 與 `recCardHtml` 各一份 | **重複 ×2**，但兩處 fallback 語義不同：cardHtml 用 `e.difficulty||1`（實作動作無頂層 difficulty→**恆為 1 點**）、recCardHtml 用 `meta.difficulty→difficulty→1`。**抽出規則（互審裁決）：`diffDots(d)` 只吃已算好的數字，fallback 留在各呼叫端原樣**——cardHtml 傳 `e.difficulty||1`、recCardHtml 傳 `e.meta?.difficulty||e.difficulty||1`，兩卡輸出逐字不變。⚠️ 順帶記錄**既有潛在顯示缺陷**：實作動作型錄卡難度恆顯 1 點（如伏地挺身 meta.difficulty=3 卻顯示 1 點）——本輪依「畫面不變」鐵則**不修**，留待 R5 收斂輪或使用者裁決後以宣告式變更處理 |
| 🪙 `baseCoinPerRep*10`＋🔥 `Math.round(met*3)` | `cardHtml`（`.wk2-coin/.wk2-kcal`）與 `recCardHtml`（`.wk-rec-coin/.wk-rec-kcal`） | **重複 ×2**（公式已於 R1 互審凍結一致） |
| 課表句「N 組 × M 下 · 組間休息 R 秒」 | `recCardHtml` inline | 單份，但 R4 簡介一致化需要同源 |
| 理由文案 | 模組常數 `REC_WHY` | 單份，R3 要變邏輯 |
| 規劃中卡/實作卡模板 | `cardHtml` 內 if 分岔 | 可讀性尚可，**本輪不拆**（避免為拆而拆） |

## 三、元件清單（對照使用者列出的 10 項；本專案為純模板函式架構，逐一映射）

| # | 使用者命名 | 本專案映射 | 用途 | 接收資料 | 新增？ | 沿用？ | 只是整理 class？ | 不可包含的邏輯 |
|---|---|---|---|---|---|---|---|---|
| 1 | TodayRecommendationSection | renderMenu 內推薦區塊（`${recCardHtml(...)}` 插入點） | 推薦區在頁面中的位置 | `EXERCISES[REC_ID]` | 否（R1 已建） | ✅ 沿用 | 否 | 不得含 store 寫入/navigate 之外的副作用 |
| 2 | WorkoutRecommendationCard | `recCardHtml(e)` | 今日推薦大卡整卡模板 | ExerciseSpec | 否（R1 已建，本輪改為由共用小元件組裝） | ✅ | 否 | 純函式：無 DOM 操作、無事件綁定（綁定留在 renderMenu）、無狀態 |
| 3 | ExerciseInfoCard | 既有 `stat(k,v)`（簡介頁資訊格） | 簡介頁六格資訊 | k/v 字串 | 否 | ✅ 沿用**不動**（renderIntro 本輪禁區） | 否 | — |
| 4 | RewardPreviewBadge | **新增 `rewardBadges(e, prefix)`** | 🪙/🔥 雙徽章（兩卡共用） | ExerciseSpec＋class 前綴（`'wk2'`/`'wk-rec'`） | ✅ 新增（從兩處重複碼抽出） | — | **class 完全不變**（以前綴參數輸出既有 class，CSS 零改動） | 純字串輸出；不得計算真實獎勵（公式維持凍結的估算式） |
| 5 | WorkoutStartPanel | 既有簡介頁 `.wk-cta`＋暖身 toggle | 訓練前開始面板 | — | 否 | ✅ 沿用**不動** | 否 | — |
| 6 | DifficultyBadge | **新增 `diffDots(d)`** | 難度三點 dots（兩卡共用） | **已算好的數字 d**（fallback 留在呼叫端：cardHtml 傳 `e.difficulty||1`、recCardHtml 傳 `e.meta?.difficulty||e.difficulty||1`——保留兩處既有語義、輸出零變化） | ✅ 新增 | — | class 不變（`.wk2-diff`/`.wk-rec-diff` 由呼叫端包） | 純字串輸出；**不得自帶 fallback 決策** |
| 7 | DurationBadge | **新增 `planText(meta)`** | 課表/時長句「N 組 × M 下 · 組間休息 R 秒」 | `meta` 物件（呼叫端傳 `e.meta`；簽名明確吃 meta，防未來誤餵無 meta 的 PLANNED 項） | ✅ 新增 | — | class 不變 | 純字串；不得含終止邏輯（六-補歸 Slice 3） |
| 8 | MuscleGroupBadge | 既有分類徽章（`.wk2-badge`＋`GROUPS[e.group]`） | 型錄卡分類標 | — | 否 | ✅ 沿用不動；**不加到推薦卡**（DS 元件 #5 推薦卡規則無此元素，不畫蛇添足） | 否 | — |
| 9 | WorkoutGoalSummary | `REC_WHY` 常數 → **改為 `recWhyText()` 佔位純函式** | 推薦理由 caption | 本輪無參數（**回傳既有 `REC_WHY` 文案原字串、逐字不變**；`TODO(R3)` 僅為 JS 註解、不得進回傳字串） | 半新增（常數改函式殼） | — | 否 | **不得在本輪讀 store**（任務欄位接線是 R3 的事）、不得改文案 |
| 10 | BackToIslandButton | **N/A——判定不做** | — | — | ❌ 不新增 | — | — | 返回動線既有且充分：底部 tab（今日/島嶼）＋簡介「‹ 返回」；DS 十一-7 禁止無資料支撐的假功能，且清單頁多一顆按鈕會稀釋視覺層級。若日後要做「訓練→島嶼」引流，屬 Slice 4 的結算直達鈕，不在 Slice 2 |

**元件通則**：全部是「吃資料、回字串」的純模板函式——不碰 DOM、不綁事件、不讀寫 store、不含判定/計時/導航邏輯；事件綁定一律留在 renderMenu/renderIntro 層。

## 四、預計修改檔案（檔案三分）

| 類別 | 檔案 | 原因 |
|---|---|---|
| **可能修改（僅 1 個）** | `app/features/workout/workout.js` | 呈現層內部重構：新增 `diffDots`/`rewardBadges`/`planText`/`recWhyText` 四個純函式；`cardHtml`/`recCardHtml` 改為組裝呼叫；集中註解分區「卡片元件（純模板）」。**僅限 renderMenu～exIcon 之間的呈現層區段** |
| **只讀不改** | `app/features/workout/workout.css` | 本輪 markup 的 class 完全不變 → CSS 零改動（深度 class 收斂歸 R5/橫切，已裁決） |
| **只讀不改** | `core/exercises/index.js`、`store.js`、`today.js`、`main.js`、`index.html`、`app.css`、`lumina.css`、DS/CONTRACTS 文件 | 讀資料/讀規則 |
| **禁止修改** | `app/core/**`、`tests/**` 舊斷言、`vendor/**`、`CONTRACTS.md` 簽名 | 通用鐵則 |
| **禁止修改** | `workout.js` 的 `startLive` 以下全部、`startCardAnims`/`stopCardAnims`/`animDemo`/`cardAv`/`introAv`、`renderIntro`、`renderResult`、`finishLive` | 時序區＋3D 管線＋其他 Slice 地盤；R2 是純呈現層內部整理 |

**回退方案**：動工前備份 workout.js 至 scratchpad；重構為等價替換，回退＝還原備份。

## 五、保留規則（必須原樣保留）

1. Slice 2 R1 資訊架構：推薦卡位置（副標後、搜尋前）、卡內元素順序、`data-rec-id` hook、鍵盤操作、常駐行為——**畫面與行為像素級不變**。
2. Slice 1 今日層與首頁：零觸碰（時間戳維持）。
3. 既有訓練資料：`EXERCISES/PLANNED/GROUPS` 唯讀。
4. 既有狀態管理：store 零讀寫變更（本輪連新讀取都沒有）。
5. `app/core`：零修改。
6. `tests` 舊斷言：零修改（34/34 必須綠）。
7. `vendor`：零修改。
8. `docs/CONTRACTS.md`：零修改（模板函式是檔案內部私有函式，不進契約）。
9. AI 偵測核心（pose/normalize/engine/exercises 判定）：零修改。
10. 訓練中 Coach HUD 與 run-token 時序區：零修改。

## 六、這一輪只做什麼

1. **元件抽出**：`diffDots(d)`（fallback 一律留在呼叫端，函式只吃已算好的數字）、`rewardBadges(e, prefix)`、`planText(meta)`、`recWhyText()` 四個純模板函式；`cardHtml`/`recCardHtml` 改為組裝。
2. **命名整理**：新函式用動詞/名詞一致的小寫駝峰；卡片模板函式集中一個註解分區，與時序區明確分界。
3. **class／token 收斂（輕量）**：本輪原則=markup class **完全不變**（以 prefix 參數維持 `.wk2-*`/`.wk-rec-*` 各自的既有 class）；不做改名式收斂——改名對畫面零收益、徒增回歸風險，深度收斂維持既有裁決歸 R5/橫切掃收。
4. **重複碼歸零**：dots/徽章/課表句在 workout.js 內只剩單一定義。
5. **為 R3 留口**：`recWhyText()`/`REC_ID` 註記 TODO(R3)——**註記只放 JS 註解，嚴禁進入回傳的 HTML 字串**（否則違反 markup 逐字不變＋比對會假失敗）。

**不做**：不改畫面任何一px、不加 3D 縮圖（歸 R4，見一節改判）、不動 renderIntro/時序區/3D 管線、不改 CSS、不加測試斷言（純模板函式無新邏輯）、不處理其他 Slice。

## 七、完成標準（重建章節）

1. **畫面與第一輪完全一致**：390px 與 1200px 截圖與 R1 存檔比對無差異（推薦卡＋型錄卡逐項）。
2. 推薦卡與型錄卡的 dots/徽章/課表句輸出**逐字相同於重構前**（自動化 innerHTML 比對）。
3. `cardHtml`/`recCardHtml` 內不再有重複的 dots/徽章模板碼。
4. 新函式皆為純函式：無 DOM 存取、無事件綁定、無 store 讀寫。
5. R1 全部互動行為不變：點卡入簡介、鍵盤 Enter/Space、chips 重跑重綁、搜尋常駐、規劃中 toast、FAB。
6. `node tests/run.js` 34/34 綠；0 console error。
7. diff 只落在 workout.js 呈現層區段（CSS 零改動）。
8. 程式分區清楚：卡片元件區／選單區／時序區邊界一眼可辨——**Slice 3 進場時更容易讀**。
9. Slice 1 未被破壞（今日層/CTA 導向照常）。
10. 手機與桌機顯示正常（兩檔實測）。

## 八、測試方式

1. `python3 serve.py 8080` → 今日層 CTA 進入訓練頁。
2. 檢查今日推薦區塊：位置、金描邊、Badge、理由、與 R1 截圖一致。
3. 檢查型錄卡：10 張齊、3D 動畫照常、內容與 R1 一致。
4. 檢查難度 dots／課表句（推薦卡）／分類徽章（型錄卡）——與重構前逐字相同（DOM 字串比對）。
5. 檢查 🪙/🔥 獎勵徽章：推薦卡與同動作型錄卡數字仍逐字一致。
6. 檢查開始流程：推薦卡→簡介→「立即開始」唯一 Primary；返回後推薦卡仍在。
7. 檢查返回動線：底部 tab 今日/島嶼照常（本輪未新增返回元素）。
8. 手機 390px 截圖比對 R1 存檔。
9. 桌機 1200px 截圖比對 R1 存檔。
10. `ls -la app/core` 時間戳確認未修改。
11. `tests` 舊斷言未修改（時間戳＋diff 檢查）。
12. `node tests/run.js` → 34/34 綠；console 0 error；今日↔訓練 tab 來回、搜尋/chips/toast 全部照常。

## 九、下一步實作提示詞（可直接貼給 Codex / Cursor / Claude Code）

```
請只處理 Slice 2：選擇訓練——第二輪：元件抽出／元件整理。

請閱讀：
1. docs/planning/Slice2_第二輪實作計畫.md（本輪唯一依據，含元件映射表與禁區）
2. docs/planning/Slice2_第一輪驗收報告.md（R1 基準：畫面與行為不得改變）
3. docs/ai-rules/Design_System_收斂版.md
4. docs/CONTRACTS.md

這次只做：workout.js 呈現層內部重構——畫面與行為零變更。

請完成：
1. 抽出四個純模板函式：diffDots(d)（難度 dots，只吃數字；fallback 留在呼叫端——cardHtml 傳 e.difficulty||1、
   recCardHtml 傳 e.meta?.difficulty||e.difficulty||1，兩卡輸出逐字不變）、
   rewardBadges(e, prefix)（🪙/🔥 雙徽章，公式維持 baseCoinPerRep*10 與 Math.round(met*3)，
   以 prefix 參數輸出既有 class 名）、planText(meta)（「N 組 × M 下 · 組間休息 R 秒」，呼叫端傳 e.meta）、
   recWhyText()（理由佔位字串；TODO(R3) 只放 JS 註解、不得進入回傳 HTML）
2. cardHtml 與 recCardHtml 改為組裝上述函式；輸出 HTML 與重構前逐字相同
3. 卡片模板函式集中成一個註解分區（卡片元件・純模板）

請不要：
1. 不要修改 app/core、tests 舊斷言、vendor、CONTRACTS 既有簽名
2. 不要改任何畫面（markup class、文案、版面一律不變；workout.css 零改動）
3. 不要動 startLive 及其後任何程式、run-token、startCardAnims/stopCardAnims/animDemo 3D 管線
4. 不要動 renderIntro/renderResult、store、today/island/tracking/settings
5. 不要回頭重做 Slice 1、不要重做 Slice 2 第一輪 UI、不要處理 Slice 3～6
6. 不要加 3D 縮圖（已改判歸 R4）、不要在模板函式內讀 store 或綁事件

完成後請回報：
1. 修改了哪些檔案（應只有 workout.js）與 diff 範圍自查
2. 重構前後推薦卡/型錄卡 HTML 逐字一致的驗證方式與結果
3. 保留了哪些功能（R1 互動清單逐項）
4. node tests/run.js 結果（34/34）
5. 瀏覽器驗證步驟＋390/1200 截圖與 R1 存檔比對結果
```

<!-- cross-model-review: APPROVED reviewer=codex hash=65c6009571255825 at=2026-07-05T00:57:38+08:00 -->
