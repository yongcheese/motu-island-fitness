# Slice 2 第二輪驗收報告（2026-07-05）

<!-- cross-model-review: skip（本文件為驗收報告，非實作計畫） -->

> 驗收對象：Slice 2「選擇訓練」第二輪（元件抽出／元件整理），依 `Slice2_第二輪實作計畫.md`（已蓋 codex APPROVED marker，三輪互審收斂）執行。
> 驗收方式：實作當輪以「重構前後 HTML 逐字比對＋瀏覽器自動化＋單元測試」完整驗證；本報告為結果整理，本輪未修改任何程式。
> 備註：驗收模板中段（一節第 6 項、二節、五節後段、六～八節）於使用者訊息中亂碼，依前兩份驗收報告結構重建為九節。

---

## 一、實際修改摘要

1. **實際修改檔案：只有 1 個**——`app/features/workout/workout.js`（diff 33 行，全部落在 renderMenu～exIcon 呈現層區段）。`workout.css` **零改動**（時間戳停在 R1）。
2. **改了什麼**：新增「卡片元件・純模板」註解分區＋四個純函式；`cardHtml`/`recCardHtml` 改為組裝呼叫；移除 `REC_WHY` 常數（改為 `recWhyText()` 函式殼）與兩處重複的 dots/徽章模板碼。
3. **新增元件（4 個純模板函式）**：
   - `diffDots(d)`——難度 dots；只吃已算好的數字，**fallback 留在呼叫端**（互審 BLOCKING 裁決：cardHtml 傳 `e.difficulty||1`、recCardHtml 傳 `e.meta?.difficulty||e.difficulty||1`，兩處既有語義原樣保留，並在 cardHtml 加註解防後人誤統一）
   - `rewardBadges(e, prefix)`——🪙/🔥 雙徽章；公式凍結（`baseCoinPerRep*10`、`Math.round(met*3)`）；prefix 輸出各卡既有 class（`.wk2-*`/`.wk-rec-*`），CSS 零改動
   - `planText(meta)`——課表句「N 組 × M 下 · 組間休息 R 秒」單一來源（R4 簡介一致化備用）
   - `recWhyText()`——理由佔位函式殼；TODO(R3) 只在 JS 註解、未進回傳 HTML（互審約束落實）
4. **整理既有元件**：`cardHtml`/`recCardHtml` 去重後改為組裝；沿用不動：`stat()`（簡介資訊格）、分類徽章、開始面板。計畫判定不做：BackToIslandButton（返回動線已充分＋DS 假功能禁令）。
5. **刪除檔案：無**。
6. **是否動到不該動的區域：無**——diff 未超出計畫白名單（連 workout.css 都沒碰，比計畫的「可能修改」範圍更小）。

## 二、是否符合第二輪目標（重建章節）

| # | 目標 | 判定 | 說明 |
|---|---|---|---|
| 1 | 推薦 UI 拆成可維護元件 | **已完成** | 四個純函式＋明確分區；全部「吃資料回字串」，無 DOM/事件/store 副作用 |
| 2 | 保留 R1 資訊架構與畫面 | **已完成** | **HTML 輸出逐字相同**（重構前抓基準：推薦卡＋10 張型錄卡 outerHTML；重構後 byte-level diff → `IDENTICAL`） |
| 3 | 整理卡片/難度/時長/獎勵/CTA | **已完成** | dots/雙徽章/課表句各只剩單一定義；CTA 流程未動（本輪無需動） |
| 4 | 移除重複 UI 結構 | **已完成** | dots 重複 ×2→1、徽章重複 ×2→1 |
| 5 | 對齊 Design System | **已完成** | 見四節（本輪零視覺變更，對齊狀態=R1 驗收結果原樣保持） |
| 6 | 讓 Slice 3 更容易銜接 | **已完成** | 呈現層（卡片元件區＋選單區）與時序區（startLive 以下）邊界一眼可辨；Slice 3 進場只需認識時序區 |
| 7 | 不重做 R1 UI | **已完成** | 畫面零變更（截圖存檔比對一致） |
| 8 | 不碰 AI 偵測核心 | **已完成** | 時間戳佐證（core 7/2、tests 6/23、vendor 6/19） |

## 三、Slice 2 第一輪成果保護檢查

1. 今日推薦訓練區塊：✅ 正常（位置/金描邊/Badge/理由/課表句與 R1 逐字一致）。
2. 訓練卡片：✅ 正常（10 張齊、4 個 3D canvas 照常動畫）。
3. 動作目的／難度／時長／目標部位：✅ 仍清楚（輸出逐字相同）。
4. 獎勵提示：✅ 仍清楚（🪙≈100/🔥16 與同動作型錄卡逐字一致）。
5. 開始訓練 CTA：✅ 正常（推薦卡→簡介→「立即開始」唯一 Primary，實測 primaryCount=1；鍵盤 Enter 也通）。
6. 返回首頁／今日層：✅ 正常（簡介「‹ 返回」＋底部 tab 今日/島嶼照常）。
7. 手機版與桌機版：✅ 可讀（390/1200 截圖存檔 `screenshots/slice2-r2-*.png`，與 R1 存檔一致）。

**結論：Slice 2 第一輪成果未被破壞。**（最強證據＝HTML byte-level 比對 IDENTICAL，優於目視。）

## 四、Design System 對齊檢查

1. 色彩對齊：✅（本輪零 CSS 改動，R1 的「零硬編碼色票」狀態原樣保持）。
2. 字體層級對齊：✅（markup 未變）。
3. Card／Button／Badge／CTA 對齊：✅（元件 #2/#5/#11 規則狀態同 R1 驗收）。
4. class／token 命名更一致：✅（採「prefix 參數維持既有 class」策略——命名一致性提升在 JS 層（單一函式產出），markup 層刻意不改名以守「畫面不變」；深度改名收斂維持歸 R5/橫切裁決）。
5. 元件切分合理：✅（切在「重複 ≥2 次」與「後輪要單一來源」的地方；規劃中卡 if 分岔刻意不拆——避免為拆而拆）。
6. 亂開新風格：✅ 無（零視覺變更）。
7. 過度抽象導致更難維護：✅ 無——四個函式都是 1~4 行的直白模板；**反向證據**：互審曾阻止一個會「越抽越錯」的設計（diffDots 自帶 fallback 會改變型錄卡輸出），最終抽象邊界劃在「純輸出」、決策留在呼叫端。

## 五、Slice 1 保護檢查

1. 首頁／今日層：✅ 正常（tab 實測 `.today` 照常渲染）。
2. 島嶼主畫面：✅ 正常（未觸碰）。
3. 今日任務：✅ 正常。
4. 金幣／XP／等級：✅ 正常（topbar 照常；本輪零 store 觸碰——連讀取都沒有新增）。
5. Slice 1 訓練 CTA → Slice 2：✅ 正常（實測通）。
6. Slice 1 UI 被不必要修改：✅ 無（today/main/index/app.css 時間戳全停在 Slice 1 施工時間）。

**結論：Slice 1 未被破壞。**

## 六、禁止修改區域檢查（重建章節）

| 區域 | 結果 |
|---|---|
| `app/core`（含 AI 偵測核心/判定引擎） | **未修改** |
| `tests` 舊斷言 | **未修改**（34/34 綠） |
| `vendor` | **未修改** |
| `docs/CONTRACTS.md` 既有簽名 | **未修改**（新函式為檔案內部私有，不進契約） |
| startLive 以下時序區／run-token／Coach HUD | **未修改** |
| `startCardAnims`/`stopCardAnims`/`animDemo` 3D 管線 | **未修改** |
| `renderIntro`/`renderResult`/`finishLive`/commitSession | **未修改** |
| store／today／island／tracking／settings | **未修改** |

無風險項。

## 七、功能與測試檢查（重建章節）

1. **現有測試**：`node tests/run.js` 施工後與收尾各一次——**34/34 passed**（兩次皆綠）；ESM 語法檢查過。
2. **等價性驗證（本輪核心）**：重構前先以 Playwright 抓基準（推薦卡＋10 張型錄卡 outerHTML 存檔），重構後重抓並 Python byte-diff → **`IDENTICAL ✅`**（含 canvas 執行期屬性都相同）。
3. **互動重驗全過**：鍵盤 Enter 入簡介、唯一 Primary、返回後推薦卡在、chips 整頁重跑後重綁正常、搜尋正常、規劃中 toast、今日↔訓練 tab、4 個 3D canvas 動畫。
4. **console：0 error、0 warning**。
5. 手動重現：`python3 serve.py 8080` → 今日層 CTA → 推薦卡 → 簡介 → 返回 → 搜尋/分類 → 規劃中卡。
6. 兩檔截圖已歸檔：`docs/planning/screenshots/slice2-r2-390.png`、`slice2-r2-1200.png`。

## 八、遺留問題分類（重建章節）

| 分類 | 項目 |
|---|---|
| **1. 必須在 Slice 2 第三輪處理** | 推薦邏輯接真：讀 store 任務欄位（依賴 Slice 1 R3 的欄位；無任務→預設深蹲退化路徑）、FAB 接推薦、`recWhyText()` 接真資料。⚠️ 注意依賴順序：Slice 1 R3（store 任務欄位＋深合併）宜先行或同計畫互審 |
| **2. 可以留到 Slice 3 處理** | 無（Slice 2 沒有欠 Slice 3 的東西；簡介頁組次「承諾與實跑一致」的**流程面**歸 Slice 3 終止邏輯重構） |
| **3. 可以留到其他 Slice／輪次** | 推薦卡 3D 縮圖（Slice 2 R4，獨立 avatar 實例方案）；簡介文案對齊六-補（Slice 2 R4）；class 深度收斂＋workout.css 25 個硬編碼色＋雙 :root 裁決（橫切掃收） |
| **4. 暫時不用處理（待使用者裁決）** | **既有顯示缺陷**：實作動作型錄卡難度恆顯 1 點（`e.difficulty||1` 讀不到 `meta.difficulty`，如伏地挺身實為 3）——R2 依「畫面不變」鐵則不修；修復屬宣告式視覺變更，一行可解（改讀 fallback 鏈），建議排入 R5 或任一後續視覺輪 |

## 九、是否可以進入 Slice 3

1. **技術上可以，但建議先做 Slice 4**——判斷如下。
2. **可以的原因**：Slice 2 R1/R2 皆通過且零偏差；呈現層與時序區邊界已整理清楚（R2 的目標之一就是為 Slice 3 鋪路）；34 測試綠、0 error、核心零觸碰——沒有任何技術阻擋。
3. **但建議先修/先做的事**：
   - **總執行序是 1→4→2→3（Vertical_Slices §4 與 Workflows §10 明定「先 4 後 3」）**：Slice 3 與 4 都動 workout.js 且嚴禁並行；結算段（Slice 4）淺、先通黃金路徑，時序重構（Slice 3）最後單獨做。跳過 Slice 4 直進 Slice 3 會把「高風險輪」提前，且 Slice 4 完成後的結算資料流可以讓 Slice 3 的組數結算設計一次到位。
   - 若仍決定直進 Slice 3：無技術障礙，但屬**偏離既定執行序的宣告式決策**，請明示。
4. **進入 Slice 3 前要注意什麼**：
   - Slice 3 是**全案唯一高風險 Slice**：R1/R2 仍是純靜態畫面輪（安全），但 **R3（組數狀態機接入時序）動工前必須另寫迷你實作計畫送 cross-model 互審**（Workflows §Slice 3 明定）。
   - run-token／`live!==run` 判斷點一個都不能少；`finishLive` 未開始不結算的守門不能繞過；`SET_SECONDS` 語義改變需同步示範模式與 `checkEndingCues`。
   - 每輪必跑瀏覽器時序清單：載入中退出／暫停恢復／再一次／組間退出／完整 3 組。
   - Slice 3-R3 不得與 Slice 6-R3 同週（引擎邊界衝突規則）。
5. **Slice 3 不可破壞的 Slice 1／2 成果**：
   - Slice 1：今日層預設頁與五 tab 導覽、任務卡資訊架構、`setChrome` 契約（live 模式隱藏 tab 的現行行為）。
   - Slice 2：推薦卡（renderMenu 呈現層——Slice 3 動的是 startLive 以下，理論上不相交；若需改 renderMenu 任何一行須在計畫中申報）、`data-rec-id` hook、四個純模板函式的簽名（`planText(meta)` 是 Slice 3 簡介/休息卡文案的預定單一來源）、金幣估算公式凍結。
   - 通用：commitSession 防刷鐵則、34 測試、示範模式全流程、相機被拒→offerDemo 路徑。

**驗收結論：Slice 2 第二輪通過。**（等價重構以 byte-diff 證明；核心零觸碰；零計畫偏差。）
