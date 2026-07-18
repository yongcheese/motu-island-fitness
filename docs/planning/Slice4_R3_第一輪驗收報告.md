# Slice 4 R3 第一輪驗收報告（2026-07-05）

<!-- cross-model-review: skip（本文件為驗收報告，非實作計畫） -->

> 驗收對象：Slice 4 R3「島嶼下一個目標＋雙向引流」，依 `Slice4_R3_第一輪實作計畫.md`（已蓋 codex APPROVED marker，三輪互審、7 個 BLOCKING 收斂）執行。
> 驗收方式：實作當輪以「Node 錨定測試＋示範模式 E2E＋快速切頁競態重測＋兩檔截圖」完整驗證；本報告為結果整理，本輪未修改任何程式。
> 備註：驗收模板多處於使用者訊息中亂碼（一節後半、二節、五節後半、六七節開頭、十節中段、十一節、十四節結尾），依可見節號與前四份驗收報告結構重建為十四節。

---

## 一、實際修改摘要

| 檔案 | 動作 | 內容 |
|---|---|---|
| `app/features/island/goals.js` | **新增** | CATALOG/CAT/UNLOCK_HINT 原樣搬入並 export（資料值零改動）＋`canBuy(type,state)`＋`nextGoal(state)` 三態純函式（零依賴、Node 可測） |
| `tests/goals.test.js` | **新增** | 7 條錨定斷言（run.js 自動載入 `*.test.js`，執行器零修改） |
| `app/features/island/island.js` | 修改（56 行 diff，計畫宣告的五處） | ①import goals.js（刪原地 CATALOG 定義）②模板加 `#isl-goal` 目標條（`<button>`）＋`refreshGoal()` 掛既有 subscribe ③openSheet/onBuy 鎖定判定改 `canBuy` ④refreshTopHint 刪低金分支 ⑤一行 null-guard |
| `app/features/island/island.css` | 修改 | `.isl-goal` 規則（半透玻璃膠囊＋`--grad-teal` 迷你進度條）＋三層垂直避讓（`.isl-hint` top 64px；≤620px：`.isl-ach` top 62px、`.isl-hint` top 108px） |
| `app/features/workout/workout.js` | 修改（17 行 diff，僅結算區） | import nextGoal＋新增 `rewardIslandLine(s)` 純模板函式＋第二幕島嶼行接真目標（Empty 變體條件維持 R1 靜態文案） |

刪除檔案：**無**。diff 範圍與計畫四節檔案三分**完全一致**；workout.js diff 關鍵字掃描（startLive/run/preStart）= 0 處。

## 二、是否符合 R3 目標（重建章節）

| # | 目標 | 判定 |
|---|---|---|
| 1 | 補齊「島嶼成長→下一目標→再訓練」循環 | **已完成**（E2E 實測循環活了，見十二-5） |
| 2 | 純函式 nextGoal(state) | **已完成**（零依賴、只讀 coins/unlocked） |
| 3 | 島嶼常駐目標條 | **已完成** |
| 4 | 第二幕同一 nextGoal 數字 | **已完成**（同 import、實測逐字一致） |
| 5 | 知道差多少金幣/解鎖條件 | **已完成**（save 差距＋進度條；unlock 成就提示） |
| 6 | 三態判定＋canBuy 共用 | **已完成** |
| 7 | garden/dock/windmill 死庫存修復 | **已完成（申報式行為變更，見七節）** |
| 8 | null-guard 最小修正 | **已完成（一行，見八節）** |
| 9 | 測試錨定 | **已完成（7 條全綠，見四節）** |

## 三、nextGoal 三態檢查

1. **save 狀態：已完成**——可買但買不起的最便宜項（`buyable.filter(cost>coins).sort(cost)[0]`）、顯示差距（`gap=cost−coins`）＋迷你進度條、點擊 `navigate('workout')`。gap≤100 附衝刺文案（保守措辭，無硬承諾）。
2. **unlock 狀態：已完成**——可買的全買得起且尚有成就鎖 → 取成就鎖最便宜項＋`UNLOCK_HINT` 文案、點擊導訓練。實測：1066🪙 時顯示「健身廣場：累積 100 次有效動作解鎖 · 去訓練 ›」（當時 86 有效次，引導準確）。
3. **done 狀態：已完成**——全解鎖且全買得起 →「全部解鎖 🎉 金幣足夠，去蓋新建築 ›」→ `openSheet()`（以 Node 測試覆蓋：全解鎖＋999🪙 → done）。
4. **三態皆非死路：已完成**——save/unlock 導訓練、done 開商店，三態皆可點。
5. **save 以最小差距項為準：已完成**（排序取最便宜，錨定測試防漂移）。
6. **符合測試錨定期望值：已完成**（見四節逐條）。

## 四、測試錨定檢查

- **測試檔案**：`tests/goals.test.js`（新增；`tests/run.js` 執行器與四個舊測試檔零修改）。
- **結果：41/41 passed**（34 舊＋7 新），逐條錨定：

| # | 錨定 | 結果 |
|---|---|---|
| 1 | fresh 80🪙 → save 碼頭 gap 10 | ✅（另含 0🪙 → save 石階 gap 10、90🪙 等額=可買→下一項風車 gap 30 兩條邊界） |
| 2 | 200🪙 → unlock 噴泉（成就鎖最便宜） | ✅ |
| 3 | 全解鎖＋高額 → done（全解鎖但錢不夠仍為 save） | ✅ |
| 4 | 目標條與第二幕同一函式 | ✅（island.js 與 workout.js 皆 `import { nextGoal } from goals.js`，全 App 唯一實作） |
| 5 | 同一數字 | ✅（E2E 實測：第二幕「🗼 能量塔：完成 10 次訓練解鎖」與島嶼目標條逐字一致） |
| 6 | 0 金幣 Empty 變體未破壞 | ✅（島嶼行為兩變體共用元素——實作時發現並加條件：Empty 維持 R1 靜態文案「已建 N 棟建築」，嚴守凍結契約） |

無應補未補之測試（canBuy 未知 type=false、成就鎖未解鎖=false/解鎖後=true 亦已覆蓋）。

## 五、島嶼常駐目標條檢查

1. 已新增：`#isl-goal`，原生 `<button>`（鍵盤可操作）。
2. 位置正確：頂部（桌機置中 max 420px；手機滿版 left/right 14px 單行截斷）。
3. 佈局零重疊：三層垂直避讓實施（hint 下移 64px；≤620px 成就列 62px、hint 108px）——390px 截圖驗證（`screenshots/slice4-r3-island-390.png`：目標條第一層、兩枚點亮成就第二層）。
4. 即時更新：掛進既有 `store.subscribe`（與 refreshTopHint 同一訂閱）——訓練回島數字即時正確（實測成就解鎖後目標自動推進）。
5. 樣式：元件 #4 半透底 `rgba(8,22,28,.72)`＋tokens（`--stroke`/`--gold`/`--grad-teal`/`--surface-2`），零硬編碼色票、無進場動畫（儀式歸 R4）。
6. 低金 hint 分支已刪（語義由目標條取代；放置/編輯提示保留原樣）。

## 六、第二幕島嶼行檢查（重建章節）

1. 正常變體接真目標：save/unlock/done 三態文案（差距數字 `--gold` 強調），沿用 `.wk-rw-island` 既有樣式。
2. 與目標條同源：`rewardIslandLine` 呼叫同一 `nextGoal`。
3. Empty 變體：維持 R1 靜態文案（條件分流）；CTA 契約（Primary 再一次、無島嶼鈕）原樣。
4. R1 凍結成果零觸碰：金幣大數字/XP 條/CTA 契約/「先 commit 後演出」全部未動。

## 七、garden／dock／windmill 行為變更檢查（重建章節）

1. **申報式行為變更，特此再申明**：三項建築從「永久鎖定死庫存」變為可購買。
2. 性質：修復既有資料斷點（三項不在預設 unlocked、也不在 ACH_UNLOCK 任何成就的解鎖清單）——非範圍偏差，經計畫互審裁決（Codex round 1 BLOCKING #1）。
3. 實作方式：`canBuy` 單一來源（成就鎖四項=UNLOCK_HINT keys 須解鎖；其餘 CATALOG 內可買；未知 type false）；openSheet/onBuy 鎖定判定各 1 行改用。
4. 金流未動：金額檢查、`spendCoins`、放置流程一行未碰。
5. CATALOG 資料值：一個值未改（原樣搬移 goals.js）。
6. 不動 store：規則放純函式層，舊 localStorage 免遷移自然生效。
7. **測試覆蓋：有**——`canBuy(garden/dock/windmill)=true`、成就鎖未解鎖=false、解鎖後=true、未知 type=false 共 4 組斷言。

## 八、island.js null-guard 檢查

1. 已修復：30ms 切頁 resize 競態（Slice 4 R1 驗收九-4 記錄的既有 bug）。
2. **只做一行**：`setTimeout(() => S.resize(), 30)` → `setTimeout(() => S?.resize?.(), 30)`＋註解。
3. 未重構 island.js（其餘 diff 全是計畫宣告的目標條/canBuy/低金分支四處）。
4. 島嶼渲染主流程（initThree/buildWorld/loop/teardown）：零改動。
5. 未順便處理其他 island bug（無額外變更）。
6. 島嶼頁顯示正常（3D 場景/放置/商店/成就實測照常，截圖佐證）。
7. 目標條更新正常（subscribe 實測）。
8. **修復驗證**：快速切 tab（島嶼→訓練）×3——修復前此操作必噴 `Cannot read properties of null (reading 'resize')`，現在 **0 console error**。

## 九、禁止修改區域檢查

| 區域 | 結果 |
|---|---|
| 1. `app/core` | **未修改**（時間戳 7/2） |
| 2. `tests` 舊斷言 | **未修改**（run.js diff=0、四個舊測試檔未動；僅新增 goals.test.js） |
| 3. `vendor` | **未修改**（6/19） |
| 4. `docs/CONTRACTS.md` 既有簽名 | **未修改**（goals.js 為 feature 內部模組） |
| 5. AI 偵測核心 | **未修改** |
| 6. run-token 判斷點 | **未修改**（workout.js diff 關鍵字掃描=0） |
| 7. 組數狀態機 | **未修改**（不存在，未提前實作） |
| 8. Coach HUD | **未修改** |
| 9. 健康頁／10. 設定頁 | **未修改** |
| 11. Slice 3 預定範圍（時序區/取景關卡/倒數環） | **未修改** |

無風險項。`store.js`（6/30）與 `finishLive/commitSession/spendCoins` 亦零觸碰（本輪連新呼叫都沒有——純唯讀計算）。

## 十、Slice 1／Slice 2／Slice 4 R1 保護檢查

**Slice 1**：首頁/今日層 ✅（實測 `.today`）、島嶼主畫面 ✅（3D 照常＋目標條為增益非取代）、今日任務 ✅、金幣/XP/等級 ✅（topbar Lv.4/1559🪙 即時正確）、訓練 CTA ✅。
**Slice 2**：今日推薦卡 ✅（目標條點擊落地後推薦卡在頂）、型錄/搜尋/chips ✅、簡介流程 ✅、獎勵徽章 ✅。
**Slice 4 R1**：兩幕流程 ✅、CTA 契約兩變體 ✅、防刷（+493=session=錢包增量 1066→1559）✅、第一幕資訊 ✅。

**結論：Slice 1、Slice 2、Slice 4 第一輪均未被破壞。**

## 十一、Design System 對齊檢查（重建章節）

1. 元件 #4 Island Panel：✅ 目標條半透玻璃膠囊、不遮島中心。
2. 元件 #12 Progress：✅ 迷你進度條 `--surface-2` 底＋`--grad-teal` 填充＋clamp。
3. §七-Slice 4「下一個解鎖」常駐：✅（示例「風車差 40」依互審裁決降級為示意，實值以規則實算）。
4. 元件 #15 Empty：✅ done 態有慶祝文案＋開商店出路。
5. 色彩：✅ 新增 CSS 全 tokens（差距數字 `--gold`、皆無新硬編碼色票）。
6. 可及性：✅ 原生 `<button>`（比照推薦卡紀律）。
7. 動畫紀律：✅ 無進場特效（儀式預算留 R4）。

## 十二、功能與測試檢查

1. 現有測試：已執行。2. **41/41 passed**（收尾與施工後各一次）。3. nextGoal 測試：**已新增 7 條**。4. E2E：已執行（示範模式 60 秒全流程）。5. **E2E 通過**——且當場驗證循環成立：本輪訓練把累積有效次推到 129 → `reps100` 成就觸發 → 健身廣場自動解鎖 → **目標條與第二幕同步推進到能量塔**（引導文案隨進度自動演進，這正是 R3 要的「島嶼承接訓練成果」）。
6. 手動重現：開島嶼頁→見目標條→點擊→訓練頁；跑一輪示範模式→第二幕島嶼行→去蓋房子→目標條已更新。
7. 首頁→訓練 ✅；8. Slice 2 推薦卡開始訓練 ✅；9. 結算第二幕 ✅；10. 回島後目標條 ✅（即時反映新錢包/新解鎖）；11. 目標條→訓練 ✅。
12. 手機 390px：三層零重疊、截圖 `screenshots/slice4-r3-island-390.png`。13. 桌機 1200px：截圖 `slice4-r3-island-1200.png`。console 全程 **0 error**。

## 十三、目前還剩下的問題

| 分類 | 項目 |
|---|---|
| 1. 必須在 Slice 4 R3 第二輪處理 | **無**（R3 目標一輪完成；無遺留缺口） |
| 2. 可以留到 Slice 4 R2 處理 | 金幣大數字／XP 條／進度條抽成共用元件函式（與 Slice 5 目標環共用語彙） |
| 3. 可以留到 Slice 3 處理 | 結算欄位「組×次」語意對齊（六-補終止邏輯落地時）；目標條的「差 N🪙 ≈ 幾組深蹲」換算文案（依賴組制結構，暫不做） |
| 4. 可以留到其他 Slice／輪次 | R4：金幣飛行/計數滾動/落袋音/目標達成 glow；橫切掃收：workout.css 硬編碼色＋雙 :root 裁決 |
| 5. 暫時不用處理 | 無新增項 |

**仍待使用者裁決的既有問題**：
1. **型錄卡難度恆顯 1 點**（Slice 2 R2 記錄：`e.difficulty||1` 讀不到 `meta.difficulty`，伏地挺身實為 3）——一行可修，屬宣告式視覺變更。
2. **XP 顯示公式重複**（第二幕 `validReps*5` 複製 commitSession 內部規則，已加註解）——正解是讓 commitSession 回傳 xpGain（動 store，需宣告輪次）。
3. 本輪驗收**無新發現**的既有問題（island resize 競態與死庫存已於本輪修復）。

## 十四、是否可以進入下一階段

1. **Slice 4 R3 第二輪**：不需要——R3 目標一輪完成，無第二輪必要。
2. **Slice 4 R2（元件抽出）**：可以，低風險內部品質輪。
3. **Slice 3**：可以——Slice 4 主線（R1 結算儀式骨架＋R3 循環閉環）已收口，「先 4 後 3」的執行序條件已滿足；Slice 4 R2/R4 為品質與儀式補強，不阻擋 Slice 3。
4. **建議下一步優先序：Slice 3（R1 靜態畫面輪起步）> Slice 4 R4（儀式動畫）> Slice 4 R2（元件）**。
5. **理由**：產品循環六步已全部有實體畫面（任務→推薦→訓練→結算獎勵→島嶼目標→再訓練），目前最大的體驗缺口回到訓練中段本身——「直接倒數就開跑、單組 60 秒時間制、儀表板語氣」（Slice 3 的三大目標）；且 Slice 3 是全案唯一高風險 Slice，越早單獨進場、留給時序測試的天數越多；R4 儀式動畫是錦上添花，可在 Slice 3 之後、Demo 前補。
6. **進 Slice 3 的紀律（既定，重申）**：R1/R2 純靜態畫面輪先行；**R3 組數狀態機動工前必須另寫迷你實作計畫送 cross-model 互審**；run-token 判斷點一個不能少；每輪跑時序清單（載入中退出/暫停恢復/再一次/組間退出/完整 3 組）；不可與 Slice 6-R3 同週；並新增本輪保護對象——**goals.js 的 nextGoal/canBuy 簽名與錨定期望值、島嶼目標條的 subscribe 更新路徑、summary/session 欄位語意若因組制改變必須申報並同步驗證第二幕與目標條**。

**驗收結論：Slice 4 R3 通過。**（循環閉環 E2E 實測成立且當場自動演進；41/41 測試綠；兩項申報式變更〔死庫存修復、null-guard〕均如實申明並有測試/重測佐證；核心與時序零觸碰。）
