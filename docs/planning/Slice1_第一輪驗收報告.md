# Slice 1 第一輪驗收報告（2026-07-05）

<!-- cross-model-review: skip（本文件為驗收報告，非實作計畫） -->

> 驗收對象：Slice 1「今日層／首屏體驗」第一輪（UI 結構整理），依 `Slice1_第一輪實作計畫.md`（已蓋 codex APPROVED marker）執行。
> 驗收方式：實作當輪已以瀏覽器自動化＋單元測試完整驗證（13 條驗收清單），本報告為結果整理；本輪未修改任何程式。

---

## 一、實際修改摘要

### 1. 實際修改了哪些檔案（共 5 個）

| 檔案 | 動作 | 改了什麼 |
|---|---|---|
| `app/features/today/today.js` | **新增** | 今日層 feature 本體：五欄位契約 `{id:'today', label:'今日', icon:'☀️', mount, unmount}`；render 靜態模板（問候/任務卡/島嶼卡/週目標佔位/CTA）；store 唯讀（getState＋subscribe 就地更新 streak/建築數）；unmount 呼叫 unsubscribe；任務假資料常數＋`// TODO(R3): 接 store 任務欄位` 標注 |
| `app/features/today/today.css` | **新增** | 全 Lumina tokens 樣式（零硬編碼色票）；390px 單欄／≥920px 雙欄 grid；Mission Card／島嶼卡／週目標條／CTA 樣式 |
| `app/main.js` | 修改 | ①import today ②FEATURES 加入 today ③TABS 首位加「今日」④預設頁 `show('island')`→`show('today')`（僅首次載入） |
| `index.html` | 修改 | 加一行 `today.css` 的 `<link>`（比照其他 feature） |
| `app/styles/app.css` | 修改（**計畫偏差**，見六-1） | `.tabbar` `repeat(4,1fr)`→`repeat(5,1fr)`＋註解——新增第 5 顆 tab 後 390px 折行的必要修正 |

### 2~4. 新增／刪除
- 新增：`app/features/today/`（today.js＋today.css）共 2 檔。
- 刪除：**無**。

### 5. 是否動到不該動的區域
- **計畫內白名單（4 檔）之外多動了 1 檔**：`app/styles/app.css` 1 個值。原因與風險評估見「六、計畫偏差」——屬 TABS 變更的必要後果，非範圍蔓延。
- 其餘禁區（core/tests/vendor/store/其他 feature）**全數未動**（檔案時間戳佐證：`app/core/engine.js` 7/2、`tests/run.js` 6/15，均早於本輪施工）。

## 二、是否符合 Slice 1 第一輪目標

| # | 檢查項 | 判定 | 說明 |
|---|---|---|---|
| 1 | 首頁第一眼更能看懂產品價值 | **已完成** | 首屏副標即為循環一句話「正確訓練 → 金幣 → 島嶼成長」；任務卡＋島嶼卡並列呈現「練了會怎樣」 |
| 2 | 呈現 AI 健身＋島嶼建設概念 | **已完成** | 任務卡（AI 有效次數語言：「蹲到髖低於膝才算有效」）＋島嶼入口卡（真實建築數）同屏 |
| 3 | 呈現今日任務 | **部分完成（符合本輪定義）** | 任務卡已呈現＋進度環 0/20＋Empty 首訓引導；但**資料為寫死常數**——這是計畫明定的第一輪範圍（真任務邏輯屬 R3），故判定「本輪目標達成、Slice 目標未完」 |
| 4 | 呈現金幣／XP／等級 | **已完成** | 沿用全域 topbar（頭像/Lv/XP 條/金幣，`--gold`），今日層不重複大數字（符合計畫六-4「避免資訊重複」決策）＋streak 火焰徽章讀真值 |
| 5 | 呈現訓練入口 CTA | **已完成** | 整屏唯一 Primary（`--grad-accent`＋glow、高 54px、`primaryCount=1` 實測）→ navigate('workout') 實測通 |
| 6 | 島嶼主畫面更像產品主畫面 | **部分完成** | 本輪決策是「今日層為主畫面、島嶼卡為入口」（不掛雙 3D）；島嶼分頁本身零改動。若「島嶼主畫面」期望的是島嶼分頁本身變豐富，屬 Slice 4/6 範圍（下一目標提示等） |
| 7 | 不再只是幾個功能按鈕 | **已完成** | 首屏是有敘事順序的版面（問候→任務→島嶼→週目標→CTA），非入口堆疊；四分頁降為導覽 |

## 三、Design System 對齊檢查

| # | 檢查項 | 結果 |
|---|---|---|
| 1 | 色彩對齊 | ✅ 全 tokens：`--green`（環/CTA/建築數）、`--gold`（streak，符合「金幣/獎勵一律 gold」語意鐵律）、`--muted/--faint/--stroke/--grad-teal/--grad-card`；today.css **零硬編碼色票**（僅一處 `rgba(255,255,255,.1)` 環軌道＝DS 允許的白透明面） |
| 2 | 字體層級對齊 | ✅ Page Title=`.h1`(26/800)、Section Title=`.section-title`、Card Title=19/800、Body/Caption=13/12 muted、環數字用 `--font-display`——皆在 DS 第四節區間 |
| 3 | Card/Button/HUD/Badge 對齊 | ✅ 全部復用全域類：`.card`（元件#2）、`.btn`/`.btn.secondary`（元件#1，一屏一 Primary 守住）、`.pill`（元件#11：streak=gold 系、Coming Soon=`--faint`+虛線邊，符合 DS Coming Soon 規則）；進度環=元件#12 |
| 4 | 間距一致 | ✅ 卡 padding 16–20/24、區塊 gap 14–16、皆 4 的倍數階梯 |
| 5 | 手機版可讀 | ✅ 390px 實測截圖：單欄、無橫向捲動、CTA 54px≥44 觸控、5 tab 一排（修正後） |
| 6 | 桌機版可讀 | ✅ 1200px 實測截圖：`#view > .fade-in` 既有限寬置中、任務卡與島嶼卡雙欄、側欄「今日」active |
| 7 | 有無亂開新風格 | ✅ 無：未新增任何 :root token、未引入新字體/新元件樣式體系；沿用 fadeUp/stagger 既有動畫 |
| 8 | 有無各區塊自行設計 | ✅ 無：四個區塊全部長在 `.card`＋共用類之上，只加 `td-` 前綴的佈局樣式 |

## 四、禁止修改區域檢查

| 區域 | 結果 |
|---|---|
| 1. `app/core` | **未修改** |
| 2. `tests` 舊斷言 | **未修改**（也未新增測試，符合計畫） |
| 3. `vendor` | **未修改** |
| 4. `docs/CONTRACTS.md` 既有簽名 | **未修改**（today 完全遵循既有 feature 契約，未動任何簽名） |
| 5. AI 偵測核心（pose/normalize） | **未修改** |
| 6. 動作判定引擎（engine/exercises） | **未修改** |
| 7. 其他 Slice 主要功能（workout/island/tracking/settings 的 js/css） | **未修改**（island 僅「不再是開場頁」，其行為實測與改動前一致） |

無風險項。唯一超出白名單的 `app.css` 1 值變更見六-1。

## 五、功能與測試檢查

1. **是否執行現有測試**：是——施工後與收尾各跑一次 `node tests/run.js`。
2. **是否通過**：**34/34 passed**（兩次皆綠）。
3. 應執行而未執行：無（本輪無邏輯變更，計畫明定不需新增測試；以 13 條驗收清單替代）。
4. **手動測試方式**（可重現）：
   - `python3 serve.py 8080` → 開 `http://localhost:8080`
   - 開場落在今日層 → 檢查四要素（任務卡/島嶼卡真建築數/streak/唯一 CTA）
   - CTA→訓練清單；回今日→「去看看」→島嶼 3D
   - 五 tab 來回切 10 次 → console 應 0 error（生命週期）
   - 進訓練→立即開始→（相機拒絕）→結束 → tab bar 恢復、今日 active 正確（預設頁副作用）
   - 390px 與 1200px 各檢查一次排版

### 自動化驗收實測結果（實作當輪執行）
- 13 條驗收清單**全過**：含 Codex 補強的 #11 生命週期（×10 切換後 0 error、資料仍更新）、#12 預設頁副作用（僅首次載入落今日層、不自動導回、進出 live 後 chrome 恢復、active 正確）、#13 契約檢查表（排序第一、五欄位契約、雙導流鈕可用）
- Empty 狀態實測觸發（fresh store → 「完成你的第一次訓練」變體）
- console **0 errors**
- 附註：驗收過程中曾誤報「today active=false」，經查為測試腳本持有舊 DOM 引用（renderTabbar 每次重建按鈕）所致，重新查詢後為 true——**非 App 缺陷**，記錄於此供後續輪次驗收借鑑。

## 六、計畫偏差與遺留事項

1. **計畫偏差（1 項，已收斂）**：`app/styles/app.css` 不在「可能修改」白名單（原列「只讀不改」），但驗收時發現 `.tabbar` 寫死 4 欄，新增第 5 顆 tab 後 390px 折行（設定被擠到第二排）——此為計畫核准的 TABS 變更之**必要後果**，以最小 diff（1 個值＋註解）修正並於回報主動申報。性質：白名單預估遺漏，非範圍蔓延。**建議後續輪次計畫將「全域佈局對新增元素的承載」納入白名單評估**。
2. **遺留給 R2/R3 的事項**（皆為計畫內既定，非缺陷）：
   - 任務資料為寫死常數（`TODO(R3)` 已標注於 today.js 檔首）
   - 週目標條為靜態佔位（「進度追蹤即將開通」徽章）
   - CTA 未帶任務參數（Slice 2 推薦邏輯的事）
   - 打勾/環填充動畫（R4）
3. **小修正紀錄**：進度環 0% 時 `stroke-linecap:round` 殘留一顆綠點 → 已改為 pct>0 才繪製進度圈。

## 七、驗收結論

**Slice 1 第一輪：通過。**
- 計畫目標（UI 結構與第一印象）全數達成；二-3、二-6 的「部分完成」皆屬計畫明定的後續輪次範圍，非本輪缺口。
- 核心資產零觸碰、34 測試綠、0 console error、DS 八項對齊全過。
- 一項白名單偏差（app.css 1 值）已申報並留下流程改善建議。

**下一步（二選一，依 Vertical_Slices 執行序）**：
- A. 照總執行序推進 **Slice 4 第一輪**（結算獎勵儀式 UI 結構）——黃金路徑優先；
- B. 或先做 **Slice 1 第三輪**（任務資料串接），讓今日層提早變真。
建議 A（維持「先通黃金路徑」紀律；今日層假資料在 Demo 語境可接受，且 R3 依賴的欄位設計可與 Slice 4 的結算資料一併思考）。
