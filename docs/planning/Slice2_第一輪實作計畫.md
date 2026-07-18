# Slice 2 第一輪實作計畫 — 選擇訓練：今日推薦（UI 結構）（2026-07-05）

> 依據：`Slice1_階段總結與交接.md`（§六/§七 指定下一步）、`本專案專用規劃_重整版.md`、`Vertical_Slices_重整版.md`（Slice 2）、`Slice_Workflows_重整版.md`（Slice 2 §7 第一輪）、`Design_System_收斂版.md`（§六元件 #1/#2/#5/#11、§七-Slice 2）、`docs/CONTRACTS.md`、`docs/SPEC.md`（§3.1）、`docs/UI_REDESIGN_BRIEF.md`。
> 本文件為**實作計畫**，動工前須經 cross-model 互審蓋章（cmr marker）。
> 備註：本計畫模板中段（三～七節細項）於使用者訊息中亂碼，依 Slice 1 計畫同款結構重建。

---

## 一、Slice 2 目標

Slice 2 要解決的問題：**訓練入口是一份「十張卡的型錄」，不是一個「今天的邀請」**。

1. **訓練不該只是動作清單**——評審打開訓練頁的第一個問題是「我該點哪個？」。清單把選擇成本丟給使用者，違反企劃循環第 1 步「選擇訓練任務」的精神（任務應該主動邀請，不是被動陳列）。
2. **使用者要知道今天推薦做什麼**——頂部一張「今日推薦」大卡直接給答案（本輪寫死推薦深蹲：MVP 最穩、Demo 取景最容易成功、也是 Slice 1 今日任務的動作）。
3. **使用者要知道為什麼**——推薦卡帶理由 caption（本輪佔位文案，與 Slice 1 今日任務假資料口徑一致：「今天練下肢 · 完成今日任務：20 個有效深蹲」；R3 接真任務欄位）。
4. **使用者要知道完成後可獲得什麼**——推薦卡固定顯示 `🪙 ≈金幣`（`--gold`）＋`🔥 kcal/分`（coral）雙徽章與難度 dots（DS §七-Slice 2 的固定位置規則），並帶出組×次×休息承諾（讀 `ex.meta`，僅呈現、不改流程）。
5. **訓練前要有清楚的開始流程**——推薦卡點擊**直入簡介頁**（DS §五：推薦卡直入簡介），簡介頁既有結構（部位/組次/休息/金幣/暖身開關/3D 示範/立即開始）本輪原樣沿用，形成「推薦 → 讀懂 → 開始」三步引導。
6. **承接 Slice 1**——今日層 CTA「開始訓練」`navigate('workout')` 落地後，第一眼就是今日推薦卡，與今日任務卡（20 個有效深蹲）講同一件事；兩頁敘事閉合。
7. **對齊 Design System**——推薦卡完全按 DS 元件 #5 推薦卡規則（**金色描邊＋「今日推薦」Badge**）與 §七-Slice 2 四條規則實作；只用 tokens、不新增風格。

## 二、目前 Slice 2 現況

1. **相關檔案**：`app/features/workout/workout.js`（選單 renderMenu L78–134、卡片 cardHtml L146–181、簡介 renderIntro L188–228、3D 卡片管線 startCardAnims L280–306）＋ `workout.css`；資料源 `core/exercises/index.js`（EXERCISES/PLANNED/GROUPS，唯讀）。
2. **完成度約 60%**：搜尋、分類 chips、10 張動作卡（4 實作＋6 規劃中）、卡片 3D 公仔循環示範、簡介頁資訊結構、快速開始 FAB 皆已存在且穩定。
3. **可保留（全部）**：搜尋/分類/卡片 3D 動畫/「規劃中」誠實占位（🔒＋toast）/`⭐ Demo 推薦`與`⚠️ 需較大空間`小標/renderIntro 全部結構/FAB。
4. **只是清單或按鈕的地方**：型錄十卡平鋪、無層級；「⭐ Demo 推薦」只是 tagline 裡一小串字，無視覺權重；FAB「快速開始」永遠等於陣列第一個動作，與「推薦」無語意連結。
5. **缺少的訓練前引導**：沒有「今天做什麼＋為什麼」的入口敘事；使用者從今日層帶著「20 個有效深蹲」的任務過來，訓練頁卻用十張同權重的卡迎接。
6. **與 Slice 1 銜接不清楚**：今日層任務卡說「深蹲」，訓練頁不呼應——兩頁像兩個產品（本輪要修的核心斷點）。
7. **最不像企劃書的地方**：SPEC §3.1 的流程是「分類選擇→清單→簡介→開始」，企劃循環卻要求第 1 步是「任務邀請」；現況只有型錄沒有邀請。另外簡介頁「3 組×12」承諾與實跑 60 秒流程矛盾——**該矛盾屬文案/流程對齊，明確歸 R4（文案）與 Slice 3（流程），本輪不碰**。

## 三、第一輪只做什麼（重建章節）

1. **今日推薦大卡（唯一新增 UI）**：`renderMenu` 在 `h1/sub` 之後、`.wk-filters` 之前插入一張滿版推薦卡：
   - 金色描邊（`var(--gold)`）＋「☀️ 今日推薦」Badge（元件 #11 膠囊，gold 15% 底＋gold 字）。
   - 理由 caption（寫死佔位）：「🎯 今天練下肢 · 完成今日任務：20 個有效深蹲」＋ `// TODO(R3): 接 store 任務欄位` 註記（與 today.js 的 TODO 同一鉤子）。
   - 內容：動作名（深蹲）＋難度三點 dots（樣式語彙同型錄卡）＋`🪙 ≈${baseCoinPerRep * 10}`＋`🔥 ${Math.round(met * 3)} kcal/分`＋「N 組 × M 下 · 休息 R 秒」（全部讀 `EXERCISES.squat` 既有欄位，零新資料）。**數字公式凍結為與 cardHtml 現行完全相同的兩條算式**（L175–176），推薦卡與型錄卡同一動作顯示的數字必然一致；兩者皆為估算值（🪙 以 ≈ 前綴表達、kcal/分 為 met×3 既有慣例），真實獎勵仍以結算 `commitSession` 為準——不發明新語意，對不上的風險歸零。
   - Hero 視覺：**本輪用大 emoji 圖示（`exIcon`）＋分類色光暈，不掛 3D canvas**（理由見「六、技術決策」）。
   - 點擊整卡 → `renderIntro(EXERCISES.squat)`（防禦：`EXERCISES.squat` 不存在則整段不渲染推薦卡，型錄照常）。
   - **事件綁定規範（防重繪失綁/防 null）**：推薦卡 hook 一律用 `data-rec-id` 屬性（不用 `.wk2`、不用 `data-id`，與型錄卡的 JS/CSS 選擇器完全隔離）；綁定寫在每次 `root.innerHTML` 賦值之後、null-guard 形式：`const recEl = root.querySelector('[data-rec-id]'); if (recEl) recEl.onclick = ...`。chips 整頁重跑 `renderMenu(group)` 時同一段程式重新執行，天然重綁。
   - **鍵盤可操作**：推薦卡加 `role="button"`、`tabindex="0"`，Enter/Space 觸發同 click（DS 完成標準「鍵盤可操作主要導覽」）；Space 需 `preventDefault()` 防頁面滾動。
2. **推薦來源寫死為深蹲**：以模組層常數表達（如 `const REC_ID = 'squat'`），推薦邏輯（讀任務欄位、退化路徑）明確留給 R3。
3. **型錄原樣其下**：搜尋/分類/卡片/FAB 行為與版面完全不變；搜尋與 chips 只重繪 `#wk-list`，推薦卡天然常駐（不隨分類/搜尋消失——它是「今日的邀請」，不是型錄的一部分）。
4. **workout.css 只新增 `.wk-rec*` 前綴規則**：全部 tokens（gold 描邊用 `color-mix` 比照既有 hover 寫法）；不改任何既有選擇器。

## 四、第一輪不要做什麼（重建章節）

1. ❌ 不做推薦邏輯（讀任務欄位/退化路徑）——R3。
2. ❌ 不改 FAB 行為（現狀恰好=深蹲，語意接線歸 R3）。
3. ❌ 不動 `renderIntro` 任何內容（組次文案對齊六-補終止決策歸 R4；流程歸 Slice 3）。
4. ❌ 不碰 `startLive` 及其後任何一行（run-token 時序區，Slice 3 專屬）。
5. ❌ 不動 3D 卡片管線（`startCardAnims`/`stopCardAnims`/`animDemo`/`cardAv`/`introAv`）——推薦卡本輪不加 canvas，正是為了做到「一行都不碰」。
6. ❌ 不抽共用元件——推薦卡與 `cardHtml` 共用變體歸 R2（見七）。
7. ❌ 不動 store／不新增欄位；不動 today/island/tracking/settings；不動 main.js/index.html/app.css/lumina.css（本輪無全域佈局變更需求——推薦卡活在 `#view` 既有捲動流內，已依 Slice 1 教訓評估「全域佈局承載」：不新增 tab、不改 chrome，無承載問題）。
8. ❌ 不處理 workout.css 既有 25 個硬編碼色（橫切掃收）。

## 五、檔案三分（重建章節）

| 類別 | 檔案 | 說明 |
|---|---|---|
| **可修改** | `app/features/workout/workout.js` | 僅：`renderMenu` 內插入推薦卡渲染＋綁 click；新增純模板函式 `recCardHtml(ex)`（與新增常數 `REC_ID`）。diff 之外的任何函式不得有變更 |
| **可修改** | `app/features/workout/workout.css` | 僅新增 `.wk-rec` 前綴規則區塊（含 390/桌機 RWD） |
| **只讀** | `core/exercises/index.js`、`state/store.js`、`today.js`、`main.js`、`index.html`、`app.css`、`lumina.css` | 讀資料/讀 tokens，零修改 |
| **禁區** | `app/core/**`、`tests/**` 舊斷言、`vendor/**`、`CONTRACTS.md` 簽名、`workout.js` 的 startLive 以下全部＋3D 管線函式、`renderIntro` | 通用鐵則＋本輪特別禁區 |

**回退方案**：改動為純新增——回退＝刪除 renderMenu 內的推薦卡插入行、`recCardHtml`/`REC_ID`、workout.css 的 `.wk-rec` 區塊，即完全恢復原狀（非 git 專案，動工前先備份 workout.js/workout.css 至 scratchpad）。

## 六、UI 方向與技術決策（重建章節）

**版面（手機 390px）**：`h1「開始訓練」→ sub → [今日推薦大卡·滿版] → 搜尋/分類 chips → 型錄 grid → FAB`。桌機沿用 `#view > .fade-in` 限寬，推薦卡同寬置頂，hero 圖示置左、資訊置右的橫排。

**推薦卡樣式（DS 對齊）**：主 class 為 `.wk-rec`（可疊通用 `.card` 取得玻璃底/圓角/陰影——全站通用容器類，無 JS hook 依附；**嚴禁使用 `.wk2` 與 `data-id`**，與型錄卡的行為選擇器完全隔離）＋`--gold` 描邊（`color-mix(in srgb, var(--gold) 55%, transparent)`）＋淡金光暈；「今日推薦」Badge=元件 #11；理由=Caption 字級 `--muted`；獎勵雙徽章位置固定卡片左下（DS §七-Slice 2）；整卡可點（元件 #2：cursor:pointer＋按壓回饋）；進場沿用 fadeUp/stagger，推薦卡一次性進場強調只用既有動畫語彙（不加新 keyframes 花式）。**Primary 鈕紀律**：推薦卡不放 `.btn` Primary（整卡即入口），維持清單頁零 Primary 現狀，簡介頁「立即開始」仍是該畫面唯一 Primary。

**技術決策——推薦卡本輪不掛 3D canvas**：`startCardAnims` 的設計前提是「所有 `.wk2-canvas` 同尺寸 → 共用離屏 renderer 首幀 setSize 一次、之後零 resize」（L292–301 的 curW/curH 快取）。推薦滿版大卡的 canvas 尺寸必與型錄卡不同，會讓共用 renderer **每幀做 2 次 GL setSize**（buffer 重配置），有明顯掉幀風險。本輪零管線改動優先，hero 用 emoji＋分類色光暈；**3D 縮圖歸 R2**——屆時推薦卡與 cardHtml 共用變體，可一併用「尺寸分桶」或獨立小 canvas 正解，且 R2 本來就是元件輪。

## 七、與後續輪次的分工（重建章節；不急著抽元件）

| 本輪先寫死/佔位 | 歸屬 |
|---|---|
| 推薦卡模板獨立函式即可，不與 cardHtml 抽共用變體；hero 無 3D | **R2 元件輪**（共用變體＋3D 縮圖尺寸正解） |
| `REC_ID='squat'` 寫死；理由文案佔位 | **R3 資料串接**（讀任務欄位、無任務→預設深蹲退化；FAB 接推薦） |
| 簡介頁組次數字與六-補終止決策的一致化 | **R4 互動補強**（僅文案；流程歸 Slice 3） |
| 推薦卡進場強調動畫細調 | **R4** |
| tokens/RWD 掃收、截圖存檔 | **R5** |

## 八、完成標準

1. 打開訓練頁（或從今日層 CTA 進入），第一眼看到「今日推薦：深蹲」大卡——知道今天做什麼。
2. 推薦卡上有理由 caption——知道為什麼（佔位文案與 Slice 1 任務口徑一致）。
3. 推薦卡上有 🪙/🔥/組×次×休息——知道完成後可獲得什麼、要付出什麼。
4. 訓練入口不再只是平鋪清單——有「邀請 → 型錄」的層級。
5. 今日層 CTA → 訓練頁 → 推薦卡 → 簡介 → 立即開始，一條線走得通（Slice 1 自然銜接）。
6. Slice 1 成果零破壞（今日層/五 tab/預設頁行為不變）。
7. `app/core` 零修改（檔案時間戳佐證）。
8. `tests` 舊斷言零修改，`node tests/run.js` **34/34 綠**。
9. UI 全 tokens、DS 元件規則對齊（新增 CSS 零硬編碼色票）。
10. 390px 與 1200px 兩檔可讀可操作，0 console error。
11. 型錄既有功能全數健在：搜尋、分類切換、卡片 3D 動畫連續播放、規劃中卡 toast、FAB。
12. 推薦卡在搜尋中/切分類時仍常駐頂部。

## 九、測試方式

1. `python3 serve.py 8080` → 今日層點「🏋️ 開始訓練」CTA → 落在訓練頁。
2. 確認頂部出現「今日推薦」大卡（金描邊＋Badge＋理由）。
3. 檢查卡片資訊：深蹲、難度 dots、🪙/🔥 數字**以公式結果為準**（`baseCoinPerRep*10`、`met*3`，與同動作型錄卡逐字相同，不硬斷言特定數值）、「N 組 × M 下 · 休息 R 秒」與 `EXERCISES.squat.meta` 一致。
4. 檢查獎勵/難度/時長提示位置與 DS §七-Slice 2 規則相符（雙徽章左下、gold/coral 色）。
5. 點推薦卡 → 進深蹲簡介頁；「立即開始」為唯一 Primary；「‹ 返回」回清單（推薦卡仍在）。
6. 清單頁 tab 切回「今日」→ 再回「訓練」→ 推薦卡與型錄正常重繪（生命週期）。
7. 手機 390px：推薦卡滿版、無橫向捲動、截圖存檔。
8. 桌機 1200px：推薦卡限寬置頂、橫排版式、截圖存檔。
9. `ls -la app/core tests vendor` 時間戳確認未修改。
10. 檢查 diff 僅落在 workout.js（renderMenu＋新函式）與 workout.css（.wk-rec 區塊）。
11. `node tests/run.js` → 34/34 綠；瀏覽器 console 0 error；搜尋「深蹲」「開合跳」、切五個分類 chips、點規劃中卡出 toast、型錄卡 3D 動畫流暢（推薦卡未拖累 FPS）。

## 十、下一步實作提示詞（可直接貼給 Codex / Cursor / Claude Code）

```
請只處理 Slice 2：選擇訓練——第一輪 UI 結構整理。

請閱讀：
1. docs/planning/Slice2_第一輪實作計畫.md（本輪唯一依據，含檔案三分與禁區）
2. docs/planning/Slice_Workflows_重整版.md（Slice 2 章節）
3. docs/ai-rules/Design_System_收斂版.md（§六元件 #1/#2/#5/#11、§七-Slice 2）
4. docs/CONTRACTS.md

這次只做：renderMenu 頂部加入「今日推薦」大卡（寫死推薦深蹲）。

請完成：
1. workout.js：renderMenu 在標題之後、搜尋列之前插入今日推薦大卡（新增 recCardHtml 純模板函式＋REC_ID 常數）；
   卡片含：金色描邊＋「☀️ 今日推薦」Badge、理由佔位文案「🎯 今天練下肢 · 完成今日任務：20 個有效深蹲」（加 TODO(R3) 註記）、
   難度 dots、🪙 與 🔥 雙徽章（左下；數字公式必須與 cardHtml 現行相同：baseCoinPerRep*10、Math.round(met*3)）、
   組×次×休息（讀 EXERCISES.squat.meta）；hero 用大 emoji＋分類色光暈，不加 canvas；
   推薦卡主 class=.wk-rec、hook 用 data-rec-id（禁用 .wk2 與 data-id）；整卡點擊＋Enter/Space（role="button" tabindex="0"）
   → renderIntro(EXERCISES.squat)；綁定放在 root.innerHTML 之後並 null-guard（EXERCISES.squat 不存在則整段不渲染）
2. workout.css：只新增 .wk-rec 前綴規則（全 Lumina tokens、390/1200 RWD）
3. 型錄清單、搜尋、分類、FAB、卡片 3D 動畫保持原樣，位於推薦區之下

請不要：
1. 不要修改 app/core、tests 舊斷言、vendor、CONTRACTS 既有簽名
2. 不要動 startLive 及其後任何程式、不要碰 run-token 判斷
3. 不要動 startCardAnims/stopCardAnims/animDemo 等 3D 卡片管線（推薦卡本輪不掛 3D）
4. 不要動 renderIntro、store、today/island/tracking/settings、main.js、index.html、app.css、lumina.css
5. 不要處理其他 Slice、不要抽共用元件（R2 的事）、不要寫推薦邏輯（R3 的事）

完成後請回報：
1. 修改了哪些檔案（含 diff 範圍自查）
2. 保留了哪些功能
3. 重做了哪些 UI
4. 補強了哪些互動
5. 如何測試（node tests/run.js 結果＋瀏覽器步驟＋390/1200 截圖）
```

<!-- cross-model-review: APPROVED reviewer=codex hash=41a0e87faebf8894 at=2026-07-05T00:24:13+08:00 -->
