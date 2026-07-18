# Slice 3 第一輪驗收報告（2026-07-05）

<!-- cross-model-review: skip（本文件為驗收報告，非實作計畫） -->

> 驗收對象：Slice 3「AI Coach HUD／訓練進行中」第一輪（純靜態畫面版型），依 `Slice3_第一輪實作計畫.md`（已蓋 codex APPROVED marker，三輪互審、4 個 BLOCKING 收斂）執行。
> 驗收方式：實作當輪以「computed style 驗證＋elementFromPoint 點擊命中測試＋示範模式完整 E2E＋debug hook 三畫面截圖」完整驗證；本報告為結果整理，本輪未修改任何程式。
> 備註：驗收模板多處於使用者訊息中亂碼（一節、二節前段、三節後半、四節、五節 Slice 1 段、七節、八節前段、十節結尾），依可見節號與前五份驗收報告結構重建為十節。

---

## 一、實際修改摘要（重建章節）

| 檔案 | 改動 |
|---|---|
| `app/features/workout/workout.js` | **僅 `liveShell(ex)` 模板段**（27 行 diff）：新增三段 hidden DOM——`#lv-gate` 取景關卡覆蓋層、`#lv-rest` 組間休息卡、倒數 `.lv-metric` 加 `.lv-cdmetric` class＋成對 sibling（`.lv-set-progress`「5/12」＋`.lv-set-label`「本組次數」）。`#m-cd` 與其「倒數」標籤零改動（leaf text node 維持——互審 BLOCKING #1 的落實） |
| `app/features/workout/workout.css` | 新增 `.lv-gate/.lv-rest/.lv-set-*` 區塊（全 tokens、`[hidden]{display:none}` 保護規則、層級契約 z=4＋pointer-events）＋**申報式 1 行**：`.lv-top` z-index 3→7（diff 佐證：這是唯一被改動的既有規則） |

新增/刪除檔案：無。debug hook（`__debugSlice3`）依計畫三-8 於驗收後刪除，diff 自查 = 0 處（瀏覽器重載確認 `hookGone: true`）。

## 二、三個新畫面檢查

### 1. 取景關卡（#lv-gate）
1. 標題「站進畫面中，讓 AI 看見你 👀」：**已完成**。
2. 人形取景框（虛線輪廓、`--stroke-strong`）：**已完成**。
3. 檢查清單三列（肩/髖/膝）：**已完成**。
4. 「全綠保持 2 秒自動開始」caption：**已完成**。
5. 檢查燈兩態樣式：**已完成**——實測 `['ok','ok','pending']`（✓肩膀綠底綠字/○膝蓋灰）。
6. 不阻擋頂欄/退出鈕互動：**已完成**——遮罩 `pointer-events: none`（computed 驗證）＋gate 顯示時 `elementFromPoint` 於退出鈕中心命中 `#lv-exit`（`exitHit: true`）。

### 2. 休息卡（#lv-rest）
1. 第幾組完成：**已完成**（「第 1 組完成 💪」）。
2. 45 秒環：**已完成**（120px 環＋大數字 45＋「秒」，`tabular-nums`）。
3. 下一組預告：**已完成**（「下一組：第 2 組 · 12 下」）。
4. 跳過鈕：**已完成**（Secondary 樣式；依計畫 R1 不綁事件）。
5. 卡片可互動：**已完成**（卡片 `pointer-events: auto`，跳過鈕 `elementFromPoint` 命中自身）。
6. 不覆蓋頂欄：**已完成**（卡片 `margin-top: 72px` ≥ 頂欄高）。
7. 結束鈕仍可點：**已完成**（rest 顯示時 `exitHit: true`）。
8. z-index 符合設計：**已完成**——1200px 截圖可見頂欄（結束/標題/示範徽章）清楚壓在遮罩之上（`.lv-top` z=7 > 遮罩 z=4）。

### 3. 倒數欄雙態
1. hook 切換後樣式：**已完成**。
2. 可見文字＝「5/12 本組次數」：**已完成**（過濾 computed display 後逐字驗證）。
3. 倒數值 `display:none`：**已完成**（`cd: "none"`）。
4. 「倒數」標籤 `display:none`：**已完成**（`cdLabel: "none"`）。
5. 成對互斥：**已完成**（次數態＝值+標籤同顯、時間態＝值+標籤同隱，四元素一次切換）。
6. 符合 Codex 第三輪要求：**已完成**（「次數態成對顯示、倒數值與標籤同時隱藏」逐字達成；`.lv-cdmetric` 專用 class 也採納）。

## 三、預設流程零可見差異檢查

1. 三個新元素存在：✅（`allExist: true`）。
2. 預設全 hidden：✅（`allHidden: true`）。
3. `[hidden]{display:none}` 保護生效：✅（gate/rest computed display=none、`#m-cd` 正常顯示）。
4. 示範模式完整跑一輪：✅ 正常（倒數→計次→HUD→60 秒結束）。
5. 無任何新畫面意外出現：✅（全程未見 gate/rest/次數態）。
6. 正常進入結算：✅（第一幕→第二幕→島嶼全鏈照常，見七節）。

**結論：預設流程零可見差異——本輪最重要的完成語義成立。**

## 四、workout.js 修改範圍與時序保護檢查（重建章節）

1. diff 僅落在 liveShell 模板段（27 行）＋CSS——與計畫四節界定一致。
2. **時序區關鍵字掃描 = 0 處**（startLive/preStart/runCountdown/runWarmup/runCameraLoop/runDemoLoop/handleResult/drawRingAndHud/checkEndingCues/finishLive/`live !== run`）。
3. run-token 判斷點：一個未少、一行未動。
4. `drawCountdownRing` 簽名與呼叫：零改動（CONTRACTS §9 維持）。
5. `bindLiveControls`／coach.js：零改動。
6. SET_SECONDS 語義：未變（雙態只是版型，切換邏輯歸 R3）。
7. `#m-cd` 每幀 `setText` 路徑：實測無影響（示範模式倒數正常跳動；成對 sibling 方案的設計目的達成）。
8. 附註一項驗收過程的既有行為確認（非缺陷）：在 `live.started` 成立後按「結束」會正常結算一筆 session——這是既有合法路徑（守門只擋未開始者），驗收時據此多了一筆小 session（demo 資料，無害）。

## 五、Slice 1／Slice 2／Slice 4／Slice 4 R3 保護檢查

**Slice 1**：今日層 ✅（`.today` 照常）、島嶼主畫面 ✅、今日任務 ✅、金幣/XP/等級 ✅（topbar 隨結算即時更新）、訓練 CTA ✅。
**Slice 2**：推薦卡 ✅（本輪 E2E 皆由推薦卡進入）、型錄卡 ✅、開始訓練 CTA ✅、返回首頁 ✅。
**Slice 4**：兩幕結算 ✅（實測 result→reward）、金幣/XP 獎勵 ✅、第二幕 ✅、回島 CTA ✅（去蓋房子實測）、再訓練 CTA ✅。
**Slice 4 R3**：goals.js ✅（時間戳未動）、nextGoal/canBuy ✅（41/41 含 7 條錨定全綠）、島嶼目標條 ✅（「能量塔：完成 10 次訓練解鎖」照常）、第二幕島嶼行同函式同數字 ✅（實測逐字一致）、garden/dock/windmill 可購買 ✅（canBuy 測試維持綠）。

**結論：Slice 1／Slice 2／Slice 4／Slice 4 R3 成果未被破壞。**

## 六、禁止修改區域檢查

| 區域 | 結果 |
|---|---|
| 1. `app/core` | **未修改**（時間戳 7/2） |
| 2. `tests` 舊斷言 | **未修改**（41/41 基線維持；本輪零新增——純模板無新邏輯，符合計畫） |
| 3. `vendor` | **未修改**（6/19） |
| 4. `docs/CONTRACTS.md` 既有簽名 | **未修改**（drawCountdownRing 原樣） |
| 5. AI 偵測核心 | **未修改**（gateLandmarks 連讀都未接——依計畫歸 R3） |
| 6. run-token 判斷點 | **未修改** |
| 7. 組數狀態機 | **未修改**（不存在、未提前實作） |
| 8. Slice 4 summary/session 欄位語意 | **未修改** |
| 9. nextGoal/canBuy 簽名 | **未修改** |
| 10. goals.js 測試錨定 | **未修改**（7 條全綠） |
| 11. 健康頁／12. 設定頁 | **未修改** |

無風險項。

## 七、功能與測試檢查（重建章節）

1. `node tests/run.js`：**41/41 passed**（施工後與收尾各一次）；ESM 語法檢查過。
2. E2E：示範模式完整一輪（拒相機→offerDemo→60 秒→結算第一幕→領取獎勵→第二幕→去蓋房子→島嶼目標條）——**全鏈照常**。
3. 三畫面驗收：debug hook 逐一切換＋computed style／elementFromPoint 雙重驗證（見二節）。
4. console：全程 **0 error**（僅既有無害 warning）。
5. 截圖歸檔（5 張）：`screenshots/slice3-r1-gate-390.png`、`slice3-r1-rest-390.png`、`slice3-r1-cd2-390.png`、`slice3-r1-gate-1200.png`、`slice3-r1-rest-1200.png`。
6. 手動重現：進任一訓練→（R1 無入口，屬預期——三畫面等 R3 接線後才會在真流程出現）；預設流程照常即為本輪驗收重點。

## 八、Design System 對齊檢查（重建章節）

1. 元件 #6 Coach HUD 鐵則：✅ 未新增佔屏元素（三畫面預設隱藏；既有 HUD 一個未動）。
2. 元件 #2/#12：✅ 休息卡玻璃大卡＋環（`--surface-2` 底/teal）。
3. 統一半透底：✅ 兩遮罩皆 `rgba(8,22,28,.72)`（元件 #4 規則）。
4. 色彩對齊：✅ 全 tokens（檢查燈 `--green`/`--faint`＋color-mix、零新硬編碼色票）。
5. AI 狀態提示清楚：✅（沿用追蹤膠囊；取景關卡補上「AI 看見你了沒」的儀式語意版型）。
6. 有效/無效提示清楚：✅（既有 ✓✗ 閃現零改動）。
7. 手機 390px 可讀：✅（取景框 46vw、檢查燈換行、休息卡滿版減邊距——截圖佐證）。
8. 桌機 1200px 可讀：✅（置中限寬 480px、頂欄壓遮罩之上——截圖佐證）。
9. 亂開新風格：✅ 無（沿用玻璃語彙、零新 token）。
10. 過度動畫：✅ 無（本輪零動畫，儀式預算留 R4）。

## 九、遺留給後續輪次的接線清單

### R2：元件／版型整理（低風險）
1. 三版型（gate/rest/雙態格）函式化。
2. 次數進度環新繪製函式（環的雙語意）。
3. **不改 `drawCountdownRing` 舊簽名**（契約 §9）。

### R3：高風險接線輪 ⚠️
1. gate 接 `gateLandmarks` 全綠保持 2 秒 → 自動開始。
2. 組數狀態機（組→休息→組；N 有效次完成）。
3. 雙態成對切換邏輯（時間態⇄次數態，四元素一次切）。
4. 90 秒安全網（六-補決策）。
5. 「跳過休息」綁事件。
6. 休息卡文案引用 `planText(meta)` 單一來源（組數/次數/休息秒不得另寫死）。
7. **R3 動工前必須另寫迷你實作計畫送 cross-model 互審**（Workflows 明定；且需同步申報 summary/session 欄位語意變更並驗證 Slice 4 第二幕與島嶼目標條）。
8. R3 每次施工必跑時序清單：載入中退出／暫停恢復／再一次／組間退出／完整 3 組。

### R4：低風險體驗增強
1. 教練文案人格化（鼓勵式）。
2. 低優先語音總結（結算念一句總評）。
3. 休息環倒數動畫。
4. 組完成慶祝閃現。

## 十、是否可以進入下一階段

1. **可以進入 Slice 3 R2**：低風險版型整理輪，畫面已定案、函式化即可。
2. **可以進入 Slice 3 R3 嗎**：版型前置條件已備，但**不可直接動工**——見下。
3. **必須先寫 R3 迷你實作計畫**：是（Workflows 與本計畫四-4 雙重明定）。R3 是全案真正的高風險時刻：組數狀態機要接進 runCameraLoop/runDemoLoop、SET_SECONDS 語義改變、session 欄位語意可能變——迷你計畫需包含時序測試清單、run-token 檢查點盤點、Slice 4 下游（第二幕/目標條）同步驗證方案，送 codex 互審蓋章後才動第一行。
4. **是否需要先補小修**：不需要——本輪零缺陷、零偏差；既有待裁決項（型錄卡難度恆 1 點、XP 公式重複）不阻擋。
5. **下一步建議**：**R2 與 R3 迷你計畫可同步進行**（R2 動版型函式、R3 寫計畫不動程式，互不衝突）；若想壓縮輪次，也可跳過 R2 直接把版型函式化併入 R3 計畫一起互審（R2 本身改動極小）。建議採後者：**下一步＝撰寫「Slice 3 R2+R3 合併迷你實作計畫」送互審**——版型已凍結、接線規格越早定案，留給時序實測的時間越多。

**驗收結論：Slice 3 第一輪通過。**（三版型定案且雙重驗證；預設流程零可見差異成立；41/41 綠；核心/時序/四個已完成 Slice 全部零觸碰；hook 零殘留。）
