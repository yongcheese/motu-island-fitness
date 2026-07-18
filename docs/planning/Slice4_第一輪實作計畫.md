# Slice 4 第一輪實作計畫 — 訓練結算／金幣獎勵／島嶼回饋（UI 結構）（2026-07-05）

> 依據：`Slice1_階段總結與交接.md`、`Slice2_第一/二輪驗收報告.md`（通過）、`本專案專用規劃_重整版.md`、`Vertical_Slices_重整版.md`（Slice 4）、`Slice_Workflows_重整版.md`（Slice 4 §7 第一輪）、`Design_System_收斂版.md`（元件 #7/#8、§七-Slice 4）、`docs/CONTRACTS.md`、`docs/SPEC.md`（§3.1-6 結算）、`docs/UI_REDESIGN_BRIEF.md`。
> 執行序遵照總表 **1→4→2→3**：Slice 2 R1/R2 已收口，本輪回到 Slice 4（與 Slice 3 同動 workout.js、嚴禁並行，先做淺的結算段、高風險時序留給 Slice 3 單獨處理）。
> 本文件為**實作計畫**，動工前須經 cross-model 互審蓋章（cmr marker）。
> 備註：本計畫模板中段（一節後半、二三節、四節開頭、七節細項、八節前半、十節結尾）於使用者訊息中亂碼，依既有計畫結構重建為十節。

---

## 一、Slice 4 目標

Slice 4 要解決的問題：**訓練的高潮時刻（結算）目前只是「數字＋一條 toast」，循環的第 4、5、6 步（獎勵轉換→島嶼成長→拉回訓練）在體驗上是斷的**。

1. **訓練完成後不能只是結束**——現況按「完成」= toast「+N 已存入錢包」+ 跳回清單；金幣入袋這個產品最核心的獎勵時刻完全沒有畫面。
2. **使用者要看到自己做對了什麼**——第一幕成績單已有（評級/有效次數/達標率/常見問題），保留並維持視覺錨點。
3. **使用者要感受到獎勵**——新增第二幕「金幣獎勵卡」：金幣大數字、XP/等級成長、島嶼回饋提示（企劃 B.1「把數字變成具情感連結的視覺成就」）。
4. **使用者要被引去島嶼**——第二幕結束停在 Primary「去蓋房子」直達島嶼（循環第 5 步接第 6 步的入口）。
5. **黃金路徑打通**：今日層（Slice 1）→ 推薦卡（Slice 2）→ 訓練 → 結算第一幕 → 獎勵第二幕 → 島嶼——評審不用解說就理解「為什麼運動會讓島長大」。
6. 本輪只做 **UI 結構靜態版**：不做飛行動畫/計數滾動（R4）、不做島嶼端「下一個解鎖目標」（R3，且不動 island.js）、不碰 Slice 3 的任何時序。

## 二、目前結算段現況（重建章節）

1. **相關程式**：`workout.js` 結算段——`finishLive()`（L815：守門 `!live.started` 不結算→回選單；`commitSession` 唯一加幣入口；呼叫 `renderResult`）＋`renderResult(ex, summary, session)`（L835：第一幕成績單）＋`resCell/faultName` 模板。樣式在 `workout.css`（`.wk-result/.wk-grade/.wk-res-grid/.wk-faults`）。
2. **第一幕已完整**：評級大圓（S=gold/A=green/B=teal/C=muted）、六格數據（金幣/有效/無效/達標率/熱量/時長）、常見問題 Top3（無錯誤時有正向文案）、「再一次／完成」雙鈕。
3. **斷點**：「完成」→ `toast('+N 已存入錢包，去島嶼建設吧！')` → `renderMenu()`——獎勵只有 toast（DS 明定 toast 不得承載關鍵流程）、去島嶼只有一句話沒有入口。
4. **可用的真資料（都已在作用域或唯讀可得）**：`session.coinsEarned/grade/calories/durationSec`；XP 有 store 唯讀 helper `helpers.xpProgress()`（cur/need/ratio）與 `wallet.level`；建築數 `island.placed.length`。
5. **與 Slice 3 的邊界**：`renderResult` 在 `stopLive()` **之後**同步執行、無任何 async/計時器——完全不涉 run-token 與組數狀態機。

## 三、第一輪只做什麼（重建章節）

1. **新增第二幕 `renderReward(ex, session)`**（呈現層新函式，放結算區）：
   - 島嶼回饋視覺：🏝️ 大圖示＋光暈（靜態佔位；真島嶼縮圖/下一目標歸 R3）＋「已建 N 棟」讀真值（`island.placed.length`，唯讀）。
   - 金幣大數字：`+${session.coinsEarned}`（HUD Number 字級＋`--gold`＋`tabular-nums`）。
   - XP／等級：`Lv.{level}` ＋ XP 條靜態填充至 `xpProgress().ratio`（唯讀；填充動畫歸 R4；**寬度須 clamp**：`Math.max(0, Math.min(1, ratio || 0))` 再轉百分比，防異常值破版）＋「+{validReps*5} XP」（**須加註解**：依 commitSession 現行契約推導的顯示值——session 未回傳 xpGain；日後若 store 公式改動需同步，或於後續輪讓 commitSession 回傳 xpGain，本輪不擴 store）。
   - 島嶼回饋提示 caption：「金幣已存入錢包 · 去島上蓋新建築吧」。
   - **CTA 契約（兩種變體，互審裁決後凍結）**：
     - `coinsEarned > 0`（正常變體）：Primary「🏝️ 去蓋房子」→ `CTX.navigate('island')`；Secondary「完成」→ `renderMenu()`。
     - `coinsEarned === 0`（Empty 變體）：文案改「這次沒有獲得金幣——只有有效動作才換得到金幣，再試一次！」（空＝引導，不羞辱）；**Primary「再一次」→ `renderIntro(ex)`**；Secondary「完成」→ `renderMenu()`；不放島嶼鈕（沒錢可蓋，導去島嶼是死路）。
     - 兩變體皆維持「一屏一 Primary」；原「完成」toast 取消（資訊已由畫面承載）。
2. **第一幕最小改動（僅 2 處）**：Primary「完成」改為「領取獎勵 ›」→ `renderReward(ex, session)`；「再一次」原樣。第一幕其餘資訊零變更（舊結算資訊無損）。
3. **workout.css 新增 `.wk-rw` 前綴區塊**：全 tokens（金=`--gold`、XP 條=`--grad-teal` 填充/白 8% 底、玻璃卡）；390 直排／桌機限寬置中。
4. **資料誠實申明（對 workflow「假數字」的小幅上修，特此申報供互審把關）**：workflow R1 原寫「第二幕靜態版（假數字）」，但 `session.coinsEarned` 已在函式參數、XP 有現成唯讀 helper——寫假數字反而要多寫代碼且 Demo 時會顯示錯誤資訊。本輪改用**作用域內現成真值＋唯讀 helper**，仍不新增任何資料流、不碰 commitSession；「島嶼下一個解鎖目標」等需要新計算的才留 R3。

## 四、workout.js 修改範圍界定

1. **是否需要修改 workout.js**：是——第二幕必須長在結算流程裡。
2. **只能改哪一小段**：
   - `renderResult` 內：Primary 鈕文案與 `onclick` 目標（`renderMenu`→`renderReward`）、移除該鈕的 toast——**僅此 2 行級改動**；
   - 檔尾結算區**新增** `renderReward(ex, session)` 函式（純呈現＋兩個導航綁定）；
   - 其餘任何一行不得變更。
3. **高風險邏輯不能碰**：`finishLive` 整段（含 `!live.started` 守門、`commitSession` 呼叫與參數、`stopLive` 時機）、計次迴圈、`checkEndingCues`、示範模式迴圈。
4. **與 Slice 3 相關的不能碰**：run-token／`live!==run` 判斷點、`startLive/preStart/runCountdown/runCameraLoop/runDemoLoop/runWarmup`、SET_SECONDS 語義、Coach HUD（liveShell/handleResult/drawRingAndHud）。第二幕在 `stopLive()` 之後的同步世界，設計上與時序區零交集；若實作中發現需要碰以上任何一行→**停工回報，不得自行擴權**。

## 五、保留規則（必須原樣保留）

1. `app/core`：零修改。
2. `tests` 舊斷言：零修改（34/34 必須綠）。
3. `vendor`：零修改。
4. `docs/CONTRACTS.md`：零修改。
5. Slice 1 首頁／今日層／島嶼分頁：零觸碰（**本輪不動 island.js**——「下一個解鎖目標」歸 Slice 4 R3）。
6. Slice 2 推薦卡與訓練前流程：零觸碰（renderMenu/renderIntro/卡片元件四純函式不動）。
7. 既有訓練資料（EXERCISES/PLANNED/GROUPS）：唯讀。
8. 既有狀態管理：store 唯讀（`getState`/`helpers.xpProgress`）；**不新增欄位**。
9. 金幣／XP／島嶼邏輯：`commitSession`/`spendCoins`/`placeBuilding` 一行不碰；**先 commit 後演出**——第二幕只是表現層，數字以 store 為準。
10. AI 偵測核心：零修改。
11. Coach HUD 既有穩定邏輯：零修改。
12. run-token 判斷點：一個都不能少、一行不碰。

## 六、UI 重整方向（DS 元件 #7 Result Card／#8 Coin Reward Card／§七-Slice 4）

1. **結算標題（第一幕）**：現行「訓練完成！」＋評級大圓維持視覺錨點，零改動。
2. **有效次數／時間／卡路里**：第一幕六格原樣；有效次數綠、無效 coral 較小字級的現行規則不動。
3. **動作品質回饋**：第一幕「常見問題」卡原樣（人話 faultName）。
4. **金幣獎勵卡（第二幕主體）**：滿版大卡；金幣大數字置中（HUD Number 44–56px、`--gold`、`tabular-nums`）；標題「獎勵入袋！」；飛行粒子**不做**（R4）。
5. **XP／等級成長**：`Lv.X` 徽章＋橫條（白 8% 底＋`--grad-teal` 填充至真 ratio）＋「+N XP」caption；升級判斷不做特效（R4 可加）。
6. **島嶼回饋提示**：🏝️ 圖示＋「已建 N 棟 · 金幣已存入錢包，去蓋新建築吧」caption；下一解鎖目標佔位**不放**（R3 接真計算時一併上，避免假資訊）。
7. **回到島嶼 CTA**：正常變體第二幕唯一 Primary「🏝️ 去蓋房子」（`--grad-accent`＋glow、≥44px）→ `navigate('island')`；**Empty 變體（0 金幣）的 Primary 是「再一次」→ `renderIntro(ex)`、不放島嶼鈕**（CTA 契約見三-1）。
8. **再訓練 CTA**：第一幕「再一次」Secondary 原樣；第二幕 Secondary「完成」回清單（清單頂即 Slice 2 推薦卡=再訓練入口）。
9. **手機優先**：390px 單欄直排（獎勵卡→XP→島嶼提示→雙鈕），CTA 拇指區，無橫向捲動。
10. **桌機**：沿用 `#view > .fade-in` 限寬置中；第二幕元素不超過一屏（Demo 投影可整幕入鏡）。
11. **一屏一 Primary 紀律**：第一幕 Primary=「領取獎勵 ›」；第二幕正常變體 Primary=「去蓋房子」；Empty 變體 Primary=「再一次」——每個畫面／變體皆唯一 Primary。
12. 進場沿用 fadeUp/stagger；**儀式動畫（金幣飛行/計數滾動/落袋音）全部歸 R4**；動畫失敗不得影響資料正確（DS 十一-8——本輪無動畫，天然滿足）。

## 七、元件整理建議（重建章節）

本輪**不抽新共用元件**（第一輪是結構輪，Slice 4 R2 才是元件輪——屆時把金幣大數字/XP 條/滾動計數抽成函式供 Slice 5 目標環共用語彙）。僅：
- `renderReward` 為獨立呈現函式（與 renderResult 平行、放結算區）；
- 內部小模板若有重複再就地函式化，不強拆；
- 沿用既有 `.card/.btn/.pill` 與 Slice 2 established 的純模板函式紀律（吃資料回字串、綁定留外層）。

## 八、完成標準

1. 訓練（或示範模式）跑完 → 第一幕成績單（資訊無損）→「領取獎勵 ›」→ 第二幕 → 「去蓋房子」落在島嶼分頁。
2. 第二幕金幣數字 = `session.coinsEarned` = store 實際入帳（先 commit 後演出）；XP 條 ratio = `xpProgress()` 真值。
3. `coinsEarned=0` 的 Empty 變體正確顯示（引導再試、Primary=「再一次」、無島嶼鈕，不顯示「+0」慶祝）。
4. 兩幕切換順、每幕（含兩種變體）唯一 Primary。
5. 第一幕既有資訊/「再一次」行為零變更。
6. 不碰 finishLive/commitSession/island.js/時序區（diff 自查佐證）。
7. Slice 1／Slice 2 成果零破壞（今日層、推薦卡、簡介流程實測照常）。
8. `node tests/run.js` 34/34 綠。
9. 0 console error。
10. 防刷不變：Console 驗證錢包數=結算數、無 UI 直接加幣路徑。
11. 不碰 vendor。
12. 不碰 Slice 3 的 run-token／組數狀態機。
13. UI 全 tokens、DS 元件 #8 對齊（新增 CSS 零硬編碼色票）。
14. 390px 與 1200px 兩檔可讀可操作（截圖存檔 `screenshots/`）。

## 九、測試方式

1. `python3 serve.py 8080` → 今日層 CTA 進入 Slice 2 訓練頁。
2. 推薦卡 → 簡介 → 立即開始。
3. 相機拒絕 → offerDemo → **示範模式**跑完一輪（最快的全流程模擬；或等 60 秒自然結束）。
4. 確認進入結算第一幕：評級圓/六格/常見問題照常。
5. 檢查有效次數/時間/卡路里數字與 HUD 末值一致。
6. 「領取獎勵 ›」→ 第二幕：金幣 +N＝第一幕金幣格＝錢包增量（開 Console 比對 `store.getState().wallet.coins`）；XP 條有真填充；Lv 正確。
7. 「🏝️ 去蓋房子」→ 落在島嶼分頁、topbar 金幣已更新。
8. 回訓練 →「再一次」→ 簡介頁正常（第一幕既有行為）。
9. Slice 1 檢查：今日層照常、streak/建築數照常。
10. Slice 2 檢查：推薦卡/型錄/搜尋/chips 照常。
11. 手機 390px：第二幕直排、截圖存檔。
12. 桌機 1200px：限寬置中、截圖存檔。
13. `ls -la app/core` 時間戳未變。
14. `tests` 未修改（時間戳）。
15. `node tests/run.js` 34/34 綠；console 0 error。
16. **`coinsEarned=0` 變體驗證（互審二修——①「啟動後立刻結束」會踩 `!live.started` 守門進不了結算；②module scope 的 `renderReward` 在 Console 叫不到）**：驗證期間**臨時**在 workout.js 加一行 `window.__debugRenderReward = renderReward;`，由自動化/Console 以構造的 0 金幣假 session（`{ coinsEarned: 0, validReps: 0, invalidReps: 0, calories: 0, durationSec: 5, grade: 'C', faults: {} }`）呼叫驗 UI 兩變體（只驗呈現、不寫 store）；**驗畢即刪該行，收尾 diff 自查必須確認 `__debugRenderReward` 不存在於最終程式碼**。如環境允許，另以真相機開啟後靜止不動作跑完整段做端到端佐證（`live.started` 成立、0 有效次結算）。

## 十、下一步實作提示詞（可直接貼給 Codex / Cursor / Claude Code）

```
請只處理 Slice 4：訓練結算／金幣獎勵／島嶼回饋——第一輪 UI 結構整理。

請閱讀：
1. docs/planning/Slice4_第一輪實作計畫.md（本輪唯一依據，含 workout.js 修改範圍界定）
2. docs/planning/Slice_Workflows_重整版.md（Slice 4 章節）
3. docs/ai-rules/Design_System_收斂版.md（元件 #7/#8、§七-Slice 4）
4. docs/CONTRACTS.md

這次只做：結算第二幕（獎勵畫面）靜態版＋直達島嶼鈕。

請完成：
1. workout.js 結算區新增 renderReward(ex, session)：金幣大數字（session.coinsEarned、--gold、tabular-nums）、
   Lv/XP 條（store 唯讀 helpers.xpProgress() 真 ratio、靜態填充、寬度 clamp 0~1）、
   「+N XP」（validReps*5，加註解「依 commitSession 現行契約推導」）、島嶼提示（🏝️＋已建 N 棟真值＋caption）。
   CTA 契約（凍結）：coinsEarned>0 → Primary「🏝️ 去蓋房子」navigate('island')＋Secondary「完成」renderMenu()；
   coinsEarned===0 → Empty 引導文案＋Primary「再一次」renderIntro(ex)＋Secondary「完成」renderMenu()、不放島嶼鈕
2. renderResult 僅改 2 處：Primary「完成」改「領取獎勵 ›」→ renderReward(ex, session)；移除該鈕 toast。
   第一幕其餘資訊與「再一次」零變更
3. workout.css 只新增 .wk-rw 前綴規則（全 Lumina tokens、390/1200 RWD）

請不要：
1. 不要修改 app/core、tests 舊斷言、vendor、CONTRACTS 既有簽名
2. 不要碰 finishLive/commitSession（含呼叫參數）、不要新增任何加幣/加 XP 路徑（先 commit 後演出，第二幕只是表現層）
3. 不要碰 run-token、startLive/preStart/runCountdown/runCameraLoop/runDemoLoop、Coach HUD、組數狀態機（Slice 3 地盤）
4. 不要動 island.js（下一解鎖目標歸 R3）、不要動 store（唯讀）、不要動 renderMenu/renderIntro（Slice 2 成果）
5. 不要回頭重做 Slice 1、不要重做 Slice 2、不要處理 Slice 3/5/6
6. 不要做金幣飛行/計數滾動/落袋音等動畫（歸 R4）；不要放「下一個解鎖目標」假資料

完成後請回報：
1. 修改了哪些檔案與 diff 範圍自查（應只有 workout.js 結算區＋workout.css 新區塊）
2. 兩幕流程與雙 CTA 行為驗證結果
3. 防刷驗證：第二幕數字=store 錢包增量、無新增加幣路徑
4. node tests/run.js 結果（34/34）＋console 0 error
5. 瀏覽器全流程步驟（示範模式跑通黃金路徑）＋390/1200 截圖
```

<!-- cross-model-review: APPROVED reviewer=codex hash=325aa3ec04c6dcc3 at=2026-07-05T10:07:13+08:00 -->
