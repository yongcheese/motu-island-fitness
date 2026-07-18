# Slice 2 第一輪驗收報告（2026-07-05）

<!-- cross-model-review: skip（本文件為驗收報告，非實作計畫） -->

> 驗收對象：Slice 2「選擇訓練」第一輪（今日推薦大卡・UI 結構整理），依 `Slice2_第一輪實作計畫.md`（已蓋 codex APPROVED marker，二輪互審 5 點全 RESOLVED）執行。
> 驗收方式：實作當輪已以瀏覽器自動化（Playwright）＋單元測試完整驗證；本報告為結果整理，本輪未修改任何程式。
> 備註：驗收模板中段（二節細項、三節、六節後段、七八節）於使用者訊息中亂碼，依 Slice 1 驗收報告同款結構重建。

---

## 一、實際修改摘要

### 1~2. 實際修改了哪些檔案、各改了什麼（共 2 個，與計畫白名單完全一致）

| 檔案 | 動作 | 改了什麼 |
|---|---|---|
| `app/features/workout/workout.js` | 修改 | ① renderMenu 在副標之後、`.wk-filters` 之前插入 `${recCardHtml(EXERCISES[REC_ID])}` ② 模組層新增 `REC_ID='squat'`、`REC_WHY` 常數（含 `TODO(R3): 接 store 任務欄位` 註記）③ 新增 `recCardHtml(e)` 純模板函式（null 回空字串→防禦性不渲染；金幣/kcal 公式凍結與 cardHtml 相同：`baseCoinPerRep*10`、`Math.round(met*3)`；難度 fallback 鏈 `meta.difficulty→difficulty→1` 同時相容實作動作與規劃中動作）④ renderMenu 尾端以 `[data-rec-id]` null-guard 綁定 click＋keydown（Enter/Space 觸發、Space `preventDefault()`）。**其餘函式零變更** |
| `app/features/workout/workout.css` | 修改 | 檔尾新增 `.wk-rec` 前綴規則區塊：金描邊/光暈（`color-mix(in srgb, var(--gold) …)`）、hero 圖示區（`--accent` 分類色光暈）、Badge/名稱/理由/課表/雙徽章/箭頭、`:focus-visible` 鍵盤焦點框、960px RWD（放大 padding 與 hero）。**不含任何硬編碼色票、未改任何既有選擇器** |

### 3~4. 新增／刪除
- 新增檔案：**無**（僅新增截圖存證 `docs/planning/screenshots/slice2-r1-390.png`、`slice2-r1-1200.png`，非程式）。
- 刪除檔案：**無**。

### 5. 是否動到不該動的區域
- **無**。diff 未超出計畫白名單一行（本輪零計畫偏差——對比 Slice 1 曾有 app.css 一項申報偏差）。
- 檔案時間戳佐證：`app/core/engine.js` 7/2、`tests/run.js` 6/15、`main.js`/`index.html`/`today.js`/`app.css` 皆停在 7/4（Slice 1 施工時間），均早於本輪施工（7/5）。

## 二、是否符合 Slice 2 第一輪目標

| # | 檢查項 | 判定 | 說明 |
|---|---|---|---|
| 1 | 訓練入口從清單變「今日推薦訓練流程」 | **已完成** | 頁面層級變為「邀請（推薦大卡）→ 型錄（其下原樣）」；推薦卡在搜尋中/切分類時常駐頂部（實測 `recDuringSearch=true`、`recAfterChip=true`） |
| 2 | 知道今天推薦做什麼 | **已完成** | 「☀️ 今日推薦」金徽章＋大字「深蹲」＋hero 圖示 |
| 3 | 知道為什麼做這個訓練 | **部分完成（符合本輪定義）** | 理由 caption「🎯 今天練下肢 · 完成今日任務：20 個有效深蹲」與 Slice 1 任務卡同口徑；但為**寫死佔位**——計畫明定第一輪範圍（真推薦邏輯屬 R3），判定「本輪目標達成、Slice 目標未完」 |
| 4 | 知道完成後可獲得什麼 | **已完成** | `🪙 ≈100`（gold）＋`🔥 16 kcal/分`（coral）雙徽章左下＋「3 組 × 12 下 · 組間休息 30 秒」；數字與同動作型錄卡**逐字相同**（實測 recCoin=catCoin、recKcal=catKcal） |
| 5 | Slice 1 CTA 自然銜接 | **已完成** | 實測：今日層 `#td-start` → 訓練頁第一眼即推薦卡 → 點卡入簡介 → 「立即開始」；兩頁講同一個任務 |
| 6 | 對齊 Design System | **已完成** | 見「三、Design System 對齊檢查」8 項全過 |
| 7 | 保留既有訓練資料與狀態邏輯 | **已完成** | 資料全讀 `EXERCISES.squat` 既有欄位（零新資料、零新欄位）；型錄/搜尋/分類/FAB/簡介/3D 動畫行為與改動前一致 |

## 三、Design System 對齊檢查（重建章節）

| # | 檢查項 | 結果 |
|---|---|---|
| 1 | 推薦卡規則（元件 #5） | ✅ 金色描邊＋「今日推薦」Badge，完全按規則 |
| 2 | Badge（元件 #11） | ✅ `.pill` 膠囊基底＋gold 15% 底＋gold 字 |
| 3 | 色彩 | ✅ 新增 CSS 零硬編碼色票：gold 全走 `var(--gold)`＋`color-mix`；理由/課表用 `--muted`；kcal 用 `--coral`；分類光暈走 `--accent` 變數（沿用既有 JS ACCENT 常數，未新增色值） |
| 4 | §七-Slice 2 四條 | ✅ 推薦卡=清單頂部滿版大卡＋理由 caption；難度=三點 dots（filled=accent，非星星非數字）；🪙/🔥 雙徽章固定左下；推薦卡→簡介頁、簡介唯一 Primary=「立即開始」（實測 `introPrimaryCount=1`） |
| 5 | Primary 鈕紀律 | ✅ 推薦卡整卡即入口、不放 `.btn`；清單頁維持零 Primary 現狀 |
| 6 | 字級間距 | ✅ 卡名 19/800（Card Title 區間）、caption 12.5 `--muted`、stats 15/800；padding 16/20、gap 4 的倍數 |
| 7 | 動畫 | ✅ 只沿用 fadeUp 進場與既有 hover/active 語彙（translateY/scale/.15s），無新 keyframes |
| 8 | 無新風格/新 token | ✅ 未新增 :root token；`.wk-rec` 疊全站 `.card` 玻璃底，同一產品語言 |

## 四、Slice 1 是否被破壞

1. 首頁／今日層：✅ 正常（tab 來回 5 次後 `.today` 正常渲染）。
2. 島嶼主畫面：✅ 正常（本輪未觸碰 island，時間戳未變）。
3. 今日任務：✅ 正常（任務卡照常；推薦卡理由文案與其同口徑而非改動它）。
4. 金幣／XP／等級：✅ 正常（topbar 照常顯示 🪙80/Lv.1；本輪零 store 寫入路徑）。
5. Slice 1 訓練 CTA 導向：✅ 正常（`#td-start` → 訓練頁 → 推薦卡在頂部，實測通）。
6. Slice 1 UI 被不必要修改：✅ 無（today.js/today.css/main.js/index.html/app.css 時間戳全部停在 Slice 1 施工時間）。

**結論：Slice 1 未被破壞。**

## 五、禁止修改區域檢查

| 區域 | 結果 |
|---|---|
| 1. `app/core` | **未修改** |
| 2. `tests` 舊斷言 | **未修改**（也未新增測試，符合計畫：本輪純呈現層） |
| 3. `vendor` | **未修改** |
| 4. `docs/CONTRACTS.md` 既有簽名 | **未修改** |
| 5. AI 偵測核心（pose/normalize） | **未修改** |
| 6. 動作判定引擎（engine/exercises） | **未修改**（exercises 僅唯讀取值） |
| 7. 訓練中 Coach HUD | **未修改**（startLive 以下一行未動） |
| 8. 訓練結算與金幣發放（finishLive/commitSession） | **未修改** |
| 9. Slice 3～6 主要功能（island/tracking/settings＋workout 時序區） | **未修改** |

無風險項。特別驗證：推薦卡 hook 用 `data-rec-id`、主 class `.wk-rec`，實測 `hasWk2Class=false`、`hasDataId=false`——與型錄卡行為選擇器完全隔離（互審第 4 點的落實）。

## 六、功能與測試檢查

1. **是否執行現有測試**：是——施工後與收尾各跑一次 `node tests/run.js`，另做 ESM 語法檢查（`vm.SourceTextModule` 編譯過）。
2. **是否通過**：**34/34 passed**（兩次皆綠）。
3. 應執行而未執行：無（本輪無邏輯變更，計畫明定不需新增測試）。
4. **手動測試方式**（可重現）：`python3 serve.py 8080` → 今日層點 CTA → 訓練頁見推薦卡 → 點卡入簡介 → 返回 → 搜尋「開合」/切分類 chips → 推薦卡常駐 → 點規劃中卡出 toast。
5. **手機版**：390px 實測——推薦卡滿版、`scrollWidth=390` 無橫向捲動、截圖 `screenshots/slice2-r1-390.png`。
6. **桌機版**：1200px 實測——推薦卡限寬置頂橫排（hero 左/資訊右）、型錄三欄、截圖 `screenshots/slice2-r1-1200.png`。
7. **Slice 1 CTA → Slice 2**：實測正常（見四-5）。

### 自動化驗收實測結果（實作當輪執行，Playwright）
- 推薦卡資訊全對：id=squat、Badge、理由、「3 組 × 12 下 · 組間休息 30 秒」（=`EXERCISES.squat.meta`）、🪙≈100/🔥16 與型錄卡逐字一致、難度 1 點（=meta.difficulty，與型錄卡一致）。
- 互動全過：click 入簡介（h1=深蹲、唯一 Primary）、返回後推薦卡仍在、chips 整頁重跑後重綁正常（`onclick` 仍為 function）、搜尋時常駐、**鍵盤 Enter 開啟簡介**、今日↔訓練 tab ×5 正常。
- 型錄零回歸：10 張卡齊、4 個 3D canvas 照常動畫、推薦卡內**無 canvas**（`recHasCanvas=false`——計畫的關鍵技術決策落實，共用離屏 renderer 未受影響）、規劃中卡 toast 正常。
- 瀏覽器 console：**0 error、0 warning**。

## 七、計畫偏差與遺留事項（重建章節）

1. **計畫偏差：無**（Slice 2 第一輪 diff 完全落在白名單內；Slice 1 的「白名單承載評估」教訓已在計畫階段前置處理——本輪計畫四-7 事先評估過全域佈局無變更需求，實證正確）。
2. **遺留給後續輪次**（皆為計畫內既定，非缺陷）：
   - 推薦寫死深蹲＋理由佔位文案（`TODO(R3)` 已標注）→ **R3**（讀任務欄位、無任務退化預設、FAB 接推薦）
   - 推薦卡 hero 無 3D 縮圖 → **R2**（與 cardHtml 共用變體時以尺寸分桶正解共用 renderer 的 resize 問題）
   - 簡介頁組次文案與六-補終止決策一致化 → **R4**（僅文案；流程歸 Slice 3）
   - 推薦卡進場強調動畫細調 → **R4**；tokens/RWD 掃收與截圖歸檔規範 → **R5**
3. **回退資產**：施工前備份存於 scratchpad（workout.js.bak／workout.css.bak）；改動為純新增，可乾淨回退。

## 八、驗收結論

**Slice 2 第一輪：通過。**
- 計畫目標（UI 結構與資訊架構）全數達成；二-3 的「部分完成」屬計畫明定的 R3 範圍，非本輪缺口。
- 核心資產零觸碰、34 測試綠（×2）、0 console error、DS 八項對齊全過、Slice 1 未被破壞、零計畫偏差。
- 互審五點（kcal 語意/null-safe 綁定/鍵盤/選擇器隔離/金幣公式）全部落實並實測驗證。

**下一步（二選一）**：
- A. 照總執行序（1→4→2→…）補做 **Slice 4 第一輪**（結算第二幕 UI 結構）——黃金路徑「結算→金幣→島嶼」仍是最大缺口；
- B. 續做 **Slice 2 第二輪**（元件抽出：推薦卡與 cardHtml 共用變體＋3D 縮圖尺寸正解）。
建議 A：Slice 2 R1 已讓入口敘事成立，R2 是內部品質輪、不改變評審可見體驗；先把循環的高潮（獎勵儀式）立起來，投報比更高。
