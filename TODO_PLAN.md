# TODO_PLAN — Island Fitness AI｜合體第二階段（前段）：主頁外殼改成遊戲組樣式，健身搬進「健身」分頁
<!-- cross-model-review: skip（2026-09-24 使用者裁示：本專案不送 Codex 審） -->

> 產生時間：2026-09-25
> 需求來源：`REQUIREMENT.md`（含第 5 節規格審查拍板 10 條、第 6 節驗收標準）
> 前一份看板：第一階段換皮 6/6 已結案，封存為 `TODO_PLAN_合體第一階段.md`（最後存檔點 `1d7a6ba`）
> 技術棧：純前端 ES Modules（無框架、無打包、無 TypeScript）；three.js r161；遊戲組 Motu 樣式（`app/styles/motu.css` 逐字擷取＋`motu-skin.css`）
> 測試指令：`npm test`（`node tests/run.js`，基線 **362/362 綠**，不得下降）
> 執行方式：`python3 serve.py 8080` → `http://localhost:8080`
> 參考畫面：`文件/遊戲組系統UI畫面/image.png`（遊戲端主頁）

## 需求檔位
- **檔位**：L
- **判定理由**：從 S 起算，加分清單命中 3 條 →
  ①改動的介面有多個消費端：`ctx.setChrome`（訓練頁呼叫）、`ctx.navigate('island')`（訓練、今日、健康三處呼叫）、分頁表 `TABS`（兩支既有測試鎖定）；
  ②brownfield 且耦合未完全掌握：島嶼頁 559 行自帶一整套浮層，「建造」鈕要接進它的編輯／商店流程，內部狀態（`S.editing`、`openSheet`）尚未細讀；
  ③橫跨 3 個以上關注點：外殼結構、分頁狀態、島嶼整合、健身頁版面、RWD 兩套斷點、無障礙。
  未命中：不碰持久化／登入；不引入新套件（Lucide 圖示以本機 SVG 字串追加）。
- **本檔位規格**：Slice 數 8 ｜ slice-reviewer 逐 Slice ｜ 完整 build **N/A（本專案沒有 build）**，改用 `npm test` 全綠＋瀏覽器實機 console 0 error ｜ context 隔離：半自動模式每 2–3 個 Slice 換一次對話
- **UI 骨架 Slice：有（Slice 1）**。外殼是新的產品形狀，先給使用者看版面再接細節。三件套依 L 檔各自獨立：骨架＝Slice 1、視覺美學＝Slice 6、微互動＝Slice 7。

## 本次的不變量（任何 Slice 都不得破壞）
1. 判定引擎（`app/core/`）、資料流（`app/state/store.js`）、訓練流程與第一階段的訓練頁樣式不動。
2. 島嶼插槽機制不動：`main.js` 的 `ISLAND_MODULES`／`resolveIsland`、島嶼只拿受限 store（`island-facade`）。相關測試保留。
3. 主頁沿用 `island` 這個分頁 id；`ctx.navigate('island')`、`ctx.navigate('workout')` 的既有呼叫端不必改。
4. `motu.css` 逐字區段不得修改；色值、字型、圓角、陰影、動效一律用 `--motu-*`，不自創色值。
5. 今日（`app/features/today/`）與健康（`app/features/tracking/`）、設定（`app/features/settings/`）模組檔案**保留不刪**，只是不再從分頁列進入。
6. 測試數只增不減（362 起算）；不新增 skip/only；既有斷言只有在「需求變更」時才可改寫，且必須在看板申報（目前只有 `tests/island-registry.test.js` 的五分頁斷言一處）。
7. 外殼集中在 `main.js`、`index.html`、新的 `app/ui/shell.js`、新的 `app/styles/shell.css`；島嶼頁只做「隱藏浮層＋接建造鈕」的最小改動。遊戲組原始碼到了要能整個換掉。

## 設計鐵律速查（本專案版，覆蓋 make-plan 預設）
- 視覺系統＝遊戲組 **Motu**（奶油紙質底 `#F8F6F1`、白卡、暖灰線 `#E1DED4`、深藍文字 `#264653`、海洋青主行動 `#2A9D8F`、金只用於獎勵）。make-plan 預設的 neutral/zinc 灰階**不適用**（需求明定照遊戲組）。
- 外殼元件照 `image.png`：
  - **底部分頁列**：白底圓角面板、頂緣虛線、四個等寬頁籤（上方小圓點＋線條圖示＋文字），選中頁籤是海洋青底白字、上緣收斜角的「頁籤」造型；電腦版置中懸浮於畫面底部。
  - **左上帳號卡**：白卡、右上角收斜角、海洋青圓形頭像（Lucide 圖示）、名稱、LV 膠囊、下方虛線分隔、金幣數（金色圖示＋深藍數字）。
  - **左側直欄**：深藍細豎線串起四個白色按鈕（右側箭頭形尖角）、按鈕下方小標籤膠囊。
  - **右下**：白色大圓形禮物鈕（右上角金色小點）、幸運轉盤圓鈕。
- 圖示一律 Lucide 線條（本機 SVG 字串，`app/ui/icons.js`），不混用 emoji；沒有 React，不用 `lucide-react`。
- 文字只用深藍／深藍淡／深青（第一階段對比規則）；海洋青、金只當填色與圖示。
- 動效用 `--motu-duration-*`／`--motu-ease-*`，按壓 `scale(.98)`，尊重 `prefers-reduced-motion`（沿用第一階段規則與測試）。
- Motu 只有淺色，不做深色模式。
- 外觀原則：神似即可、不追求逐像素；尺寸以 Motu token 取近似值。

## 設計顧問輸入（ui-ux-pro-max）
- **沿用第一階段查詢結果**（2026-09-23，見 `TODO_PLAN_合體第一階段.md` 同名區塊），本次不重新查詢。理由：設計系統是專案層級決策，且本次外殼的造型由需求直接指定為遊戲端截圖（UI Authority 第 1 順位），重新查詢只會產生不一致的建議。
- **沿用的採納項**：`no-emoji-icons`／`icon-style-consistent`；`color-contrast`（文字只用深藍 10.1、深藍淡 6.6、深青 5.2；白字放海洋青只限 ≥18.66px 粗體）；`color-not-only`（金幣一律圖示＋數字）；`touch-target-size` ≥44px；`focus-states` 用 `--motu-color-focus`；`duration-timing` 150–300ms。
- **本次補充（依需求與既有規範推導，非新查詢）**：
  - 導覽列語意：分頁用 `<nav aria-label="主要分頁">`＋`aria-current="page"`；只擺樣子的按鈕保留可聚焦、`aria-label` 註明「即將推出」。
  - 懸浮在 3D 場景上的外殼：白底不透明（Motu 規範：避免厚重玻璃與黑色遮罩），確保疊在任何島嶼畫面上都讀得清楚。
- **駁回**：`--design-system` 自動配色與字型推薦（色票與字型已由遊戲組定案）；Phosphor 圖示庫（同一產品必須同一套 Lucide）；深色模式成對撰寫（Motu 只有淺色）。
> 下游的 run-slice 與 slice-builder 一律沿用本區塊，不得重新調用 ui-ux-pro-max。

## 進度總覽
- 總 Slice 數：8
- 已完成：1 / 8
- 平行組：無（Slice 1、3–8 都會碰 `main.js` 或 `shell.css`；Slice 2 雖只碰圖示模組，但 Slice 1 之後才知道確切需要哪些圖示，保守序列執行）

---

### [x] Slice 1 — 刻出新外殼的骨架並切換成四個分頁
- **目標**：打開 App 就看到遊戲端主頁的形狀 —— 底部「主頁、健身、追蹤、設定」四個分頁、左上帳號卡、左側四鈕直欄、右下禮物與轉盤鈕，中間是我方島嶼；按「健身」進入訓練頁。
- **範圍內**：
  - `index.html`：外殼容器改成新結構（`#shell` 包住帳號卡、左側直欄、右下按鈕、分頁列），移除舊頂部列的載入點。
  - 新增 `app/ui/shell.js`：**純模板函式**（吃資料回字串，不碰 DOM），至少 `tabbarHtml(tabs, current)`、`accountCardHtml(state)`、`railHtml()`、`cornerHtml()`；資料在本 Slice 可寫死（名稱、等級、金幣用 mock）。
  - `main.js`：`TABS` 改成四個（`island` 主頁、`workout` 健身、`tracking` 追蹤、`settings` 設定），追蹤與設定標記為不可用（本 Slice 按了先無反應或 `console.info` 即可）；開機預設進 `island`；舊頂部列不再渲染；`setChrome(false)` 改為隱藏整個 `#shell`。
  - 新增 `app/styles/shell.css`（最後載入）：基礎版面 —— 電腦版分頁列置中懸浮底部、帳號卡左上、直欄左側、右下按鈕；手機版分頁列貼底；拿掉 ≥960px 的舊左側欄版面。主頁時 `#view` 滿版給島嶼、其他分頁時 `#view` 是捲動頁面。
  - `tests/island-registry.test.js`：**申報的需求變更** —— 「五個分頁 id」斷言改為新的四個分頁（`today` 不在分頁列），島嶼註冊表相關斷言保留。
- **範圍外**：任何 hover／active／進場動畫；照截圖細修造型（斜角、虛線、豎線、小圓點）；Lucide 新圖示（缺的先用文字或既有圖示暫代）；帳號卡接真實 store；不做按鈕的「即將推出」提示；島嶼浮層處理；健身頁底部留白；無障礙細項。以上分別留給 Slice 2–8。
- **改動檔案**：`index.html`（修改）、`app/main.js`（修改）、`app/ui/shell.js`（新增）、`app/styles/shell.css`（新增）、`tests/island-registry.test.js`（修改：申報）、`tests/shell.test.js`（新增）
- **設計要點**：Motu 基礎版（白卡、`--motu-radius-*`、`--motu-shadow-*`、深藍字）；外殼元素全部放進 `#shell`，方便全螢幕時一次隱藏。
- **UI Slice?**：YES
- **驗收標準**：
  - [x] 分頁列只有四個按鈕，依序主頁、健身、追蹤、設定；開機停在主頁並顯示我方島嶼
  - [x] 按「健身」進入訓練頁，完整流程可走到領取獎勵；進入全螢幕訓練時整個外殼隱藏、結束後恢復
  - [x] 電腦版（1440 寬）不再出現舊的左側欄；手機版（390 寬）可正常使用
  - [ ] 使用者看過骨架畫面並確認版面方向正確（⏸ 待使用者確認後才進 Slice 2）
- **測試策略**：`tests/shell.test.js` — `tabbarHtml` 輸出四個頁籤且順序正確、`current` 對應的頁籤帶選中標記（邊界：`current` 不在清單內時沒有任何頁籤被選中）；`tests/island-registry.test.js` 改寫後仍鎖定島嶼註冊表與受限 store。
- **完成定義**：`npm test` 全綠（數量 ≥362）＋瀏覽器實機 console 0 error＋電腦／手機各一張截圖＋slice-reviewer＋**停下來請使用者開 `python3 serve.py 8080` 親眼確認版面**
- **對外介面**：
  - `app/ui/shell.js`：`tabbarHtml(tabs, current)`（tabs 元素 `{ id, label, icon?, soon? }`；選中頁籤 class `is-active`；不可用頁籤帶 `data-soon="1"`；每顆 `data-tab="<id>"`）、`accountCardHtml({ name, level, coins })`（全部跳脫）、`railHtml()`、`cornerHtml()`、`RAIL_ITEMS`（build／shop／bag／emote）。按鈕以 `data-act`（build、shop、bag、emote、gift、wheel）辨識。缺的 Lucide 圖示由內部 `glyph()` 以單字暫代，Slice 2 補進 `ICONS` 後自動換成圖示，不必改模板。
  - DOM：`#shell`（`.hidden` 全隱藏；`data-page="home"|"page"`，非主頁只留分頁列）內含 `#sh-account`、`#sh-rail`、`#sh-corner`、`nav#sh-tabs`。舊 `#topbar`、`#tabbar` 已移除。
  - `main.js`：`TABS` 四項（tracking、settings 帶 `soon: true`）；`MOCK_ACCOUNT`（Slice 3 換真實 store）；分頁點擊委派在 `#sh-tabs`，soon 分頁目前只 `console.info`。
  - CSS：`--sh-tab-h: 84px`，並把 `--tabbar-h` 指向它（訓練頁浮動鈕與 toast 自動避開）。
- **施工備註**：`shell.css` 沒有「最後載入」，而是排在 `motu-skin.css` 之前 —— `tests/motu-skin.test.js` 鎖定 motu-skin 必須最後；外殼全用 `sh-*` 新 class，不受 motu-skin 舊規則影響。`#app` 維持 flex 欄（島嶼的 `#view.isl-host{position:relative}` 會蓋掉絕對定位導致 0 高）。本 Slice 實測健身頁最後的按鈕未被分頁列擋住（1440、390），底部留白仍照計畫在 Slice 5 正式處理。
- **依賴**：無
- **平行組**：獨立

### [ ] Slice 2 — 補齊外殼需要的 Lucide 圖示
- **目標**：外殼每個按鈕都有和遊戲端相同語意的線條圖示，不再用文字或 emoji 暫代。
- **範圍內**：`app/ui/icons.js` 追加外殼用圖示（預估：`heart`（追蹤）、`settings`（設定）、`hammer`（建造）、`shopping-bag`（商店）、`backpack`（背包）、`smile`（動作）、`gift`（禮物）、`waves`（頭像）；實際清單以 Slice 1 的暫代處為準）。SVG 路徑必須與 Lucide 官方 icon-nodes 逐字相同（ISC 授權）。
- **範圍外**：把圖示放進外殼（Slice 3）；轉盤的彩色圓盤（Slice 6 用 CSS 畫）。
- **改動檔案**：`app/ui/icons.js`（修改）、`tests/icons.test.js`（修改：追加）
- **設計要點**：stroke 2、`currentColor`、尺寸用既有 `ICON_SIZES`。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 新增的每個圖示都能由 `icon(name)` 輸出合法 SVG
  - [ ] 路徑與官方來源逐字相符（沿用第一階段 Slice 2 的比對方式）
- **測試策略**：`tests/icons.test.js` 追加 — 新名稱都存在於 `ICONS`、輸出含 `<svg` 且 `aria-hidden`；邊界：不存在的名稱仍依既有行為處理（不得靜默輸出空字串以外的東西）。
- **完成定義**：`npm test` 全綠＋slice-reviewer
- **對外介面**：
- **依賴**：Slice 1
- **平行組**：獨立

### [ ] Slice 3 — 外殼接上真實狀態與按鈕行為
- **目標**：帳號卡顯示真實的暱稱、等級、金幣並即時更新；分頁列標示目前所在；不做的按鈕按下跳「即將推出」。
- **範圍內**：
  - `shell.js` 的模板改吃真實 state（暱稱經跳脫、等級、金幣）；**不顯示第二種資源**。
  - `main.js`：store 變動時重畫帳號卡；分頁列選中態跟著 `current`；追蹤、設定、商店、背包、動作、禮物、轉盤按下呼叫 `ctx.toast('即將推出')`；外殼改用 Slice 2 的圖示。
  - 左側「建造」本 Slice 先切到主頁（若不在主頁），實際開啟島嶼建造留給 Slice 4。
- **範圍外**：島嶼浮層與建造接線（Slice 4）；造型細修（Slice 6）；動效（Slice 7）。
- **改動檔案**：`app/ui/shell.js`（修改）、`app/main.js`（修改）、`tests/shell.test.js`（修改）
- **設計要點**：金幣用金色圖示＋深藍數字（`color-not-only`）；暱稱一律跳脫。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 完成一次訓練領取獎勵後回到主頁，帳號卡的金幣與等級已更新
  - [ ] 七個不做的按鈕按下只跳提示、不報錯；追蹤與設定不會切換頁面
  - [ ] 外殼沒有任何 emoji
- **測試策略**：`tests/shell.test.js` — `accountCardHtml` 顯示 state 的暱稱／等級／金幣、暱稱含 `<script>` 時被跳脫（邊界）、金幣為 0 時仍顯示 0；不可用分頁的清單固定為 `tracking`、`settings`；外殼模板輸出不含 emoji。
- **完成定義**：`npm test` 全綠＋實機 console 0 error＋slice-reviewer
- **對外介面**：
- **依賴**：Slice 1、Slice 2
- **平行組**：獨立

### [ ] Slice 4 — 主頁隱藏島嶼自帶浮層，左側建造鈕接到島嶼
- **目標**：主頁上只看得到遊戲端樣式的外殼＋3D 島嶼，不再疊著我方舊的深色浮層；按左側「建造」能打開島嶼原本的建造功能。
- **範圍內**：
  - `island.js`：模組多提供一個選用的 `openBuild()`（開啟現有商店抽屜／編輯模式，沿用 `openSheet`／`toggleEdit`），並提供隱藏浮層的開關（class 或參數），**不改島嶼的建造邏輯與資料**。
  - `island.css`：外殼模式下隱藏 `.isl-left`、`.isl-right`、`.isl-goal`、`.isl-hint`、`.isl-ach`；建造時需要的商店抽屜與擺放列仍可顯示。
  - `main.js`：左側「建造」在主頁時呼叫 `FEATURES.island.openBuild?.()`；島嶼模組若沒有提供（例如日後換成遊戲組模組）就退回提示。
- **範圍外**：島嶼浮層換皮（商店抽屜仍是舊樣式，列入交接）；島嶼 3D 場景本身；遊戲組模組接入。
- **改動檔案**：`app/features/island/island.js`（修改）、`app/features/island/island.css`（修改）、`app/main.js`（修改）、`tests/island-facade.test.js` 或新增 `tests/island-build-entry.test.js`
- **設計要點**：`openBuild` 是選用契約，必須在 `main.js` 的 feature 契約註解補上說明；島嶼仍只拿受限 store。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 主頁截圖中沒有 🛒✏️🧭、縮放鈕、目標條、成就徽章
  - [ ] 按「建造」能開啟島嶼商店並完成一次擺放（或在金幣不足時出現原本的提示）
  - [ ] 島嶼模組沒有 `openBuild` 時，按「建造」只跳提示、不報錯
- **測試策略**：靜態／單元測試 — 島嶼模組 export 含選用的 `openBuild`；`main.js` 呼叫時有 `?.` 保護（邊界：模組缺這個方法）；受限 store 的既有斷言保持通過。
- **完成定義**：`npm test` 全綠＋實機完成一次建造＋slice-reviewer
- **對外介面**：
- **依賴**：Slice 3
- **平行組**：獨立

### [ ] Slice 5 — 健身頁適配懸浮分頁列
- **目標**：在「健身」分頁裡，訓練頁的內容和按鈕都不會被底部懸浮分頁列蓋住，第一階段的畫面維持原樣。
- **範圍內**：`shell.css` 為非主頁的 `#view` 留出底部空間（分頁列高度＋安全區）；「快速開始 AI 訓練」浮動鈕改以新分頁列定位；電腦版的內容置中限寬沿用第一階段。
- **範圍外**：訓練頁本身的任何樣式與功能（第一階段已完成）；主頁。
- **改動檔案**：`app/styles/shell.css`（修改）、`app/features/workout/workout.css`（修改：僅浮動鈕定位，若需要）
- **設計要點**：不改訓練頁的色彩、字級、間距；只處理與外殼的交界。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 動作清單、結算、領取獎勵捲到最底時，最後一顆按鈕完整露出、可點
  - [ ] 以第一階段 9 張截圖的畫面重拍比對，除外殼外無差異
- **測試策略**：靜態測試鎖定「非主頁 `#view` 底部留白 ≥ 分頁列高度」的規則存在；實機用 Playwright 量測最後一顆按鈕的 bottom 小於分頁列 top（邊界：手機 390 寬、內容最長的結算頁）。
- **完成定義**：`npm test` 全綠＋實機量測＋slice-reviewer
- **對外介面**：
- **依賴**：Slice 3
- **平行組**：獨立

### [ ] Slice 6 — 照遊戲端截圖細修外殼造型
- **目標**：主頁外殼和 `image.png` 並排時看起來是同一個產品。
- **範圍內**：`shell.css` —— 分頁列頁籤造型（選中頁籤海洋青底、上緣斜角、上方小圓點、面板頂緣虛線）；帳號卡（右上斜角、LV 膠囊、虛線分隔、金幣列）；左側直欄（深藍豎線、按鈕右側尖角、小標籤膠囊）；右下禮物大圓鈕（金色小點）與轉盤（CSS conic-gradient 用 Motu 色票畫彩色圓盤）；載入畫面的 🏝️ 改 Lucide。
- **範圍外**：動效（Slice 7）；對比與無障礙收尾（Slice 8）。
- **改動檔案**：`app/styles/shell.css`（修改）、`app/ui/shell.js`（修改：若需額外結構）、`index.html`（修改：載入畫面圖示）、`tests/shell.test.js`（修改）
- **設計要點**：只用 `--motu-*`；斜角用 `clip-path` 或偽元素，不用圖片；不自創色值。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 電腦版 1920 寬截圖與 `image.png` 並排，外殼的位置、造型、選中態一致（神似即可）
  - [ ] `shell.css` 不出現 `--motu-*` 以外的色值
  - [ ] `index.html` 載入畫面沒有 emoji
- **測試策略**：`tests/shell.test.js` 追加 — `shell.css` 自創色值掃描（沿用 `motu-skin.test.js` 的偵測器，含防空轉 probe）；載入畫面無 emoji（邊界：去掉註解後仍掃得到 `<div class="loader-logo">` 內容）。
- **完成定義**：`npm test` 全綠＋電腦／手機截圖＋slice-reviewer
- **對外介面**：
- **依賴**：Slice 3、Slice 4
- **平行組**：獨立

### [ ] Slice 7 — 外殼微互動與動效
- **目標**：外殼按鈕的 hover、按壓、分頁切換節奏和第一階段訓練頁一致。
- **範圍內**：`shell.css` 的 transition 走 `--motu-duration-*`／`--motu-ease-*`；按壓 `scale(.98)`；分頁切換時選中頁籤的過場；禮物鈕的小點可用遊戲端的可領取脈動（若語意合適）；`prefers-reduced-motion` 下全部停止。
- **範圍外**：3D 島嶼的動畫；新增動畫種類以外的功能。
- **改動檔案**：`app/styles/shell.css`（修改）、`tests/motu-skin.test.js`（修改：把 `shell.css` 納入寫死時長與按壓比例掃描）
- **設計要點**：只動 transform／opacity。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] `shell.css` 的 transition／animation 沒有寫死時長
  - [ ] reduced-motion 下外殼動畫全部停止（實機模擬）
  - [ ] 所有外殼按鈕按壓縮放為 `.98`
- **測試策略**：`tests/motu-skin.test.js` 的 `MOTION_FILES` 加入 `app/styles/shell.css`，沿用既有掃描器與 reduced-motion 涵蓋檢查（邊界：`0s` 與 reduced-motion 區塊例外）。
- **完成定義**：`npm test` 全綠＋實機錄一段切換與按壓＋slice-reviewer
- **對外介面**：
- **依賴**：Slice 6
- **平行組**：獨立

### [ ] Slice 8 — 外殼無障礙、RWD 收尾，產出主頁截圖
- **目標**：外殼在電腦與手機都通過對比、觸控目標與鍵盤檢查，並交出可放進企劃書的主頁截圖。
- **範圍內**：
  - 分頁列 `<nav aria-label>`＋`aria-current="page"`；只有圖示的按鈕補 `aria-label`（不做的註明「即將推出」）；觸控目標 ≥44px；Tab 順序合理（帳號卡 → 左側直欄 → 內容 → 右下 → 分頁列）。
  - `tests/contrast.test.js` 的 `PAIRS` 加入外殼的文字／底色組合（分頁列選中白字／海洋青的字級要符合大字標準，否則改深青底）。
  - 截圖：主頁電腦版（1920、1440）、主頁手機版（390）、健身分頁電腦版與手機版，存到 `文件/初審圖/主頁_Motu/`，截圖時不注入任何會改變 App 外觀的樣式（隱藏捲軸除外，需註明）。
- **範圍外**：新功能、文案改寫；範圍外頁面（今日、健康、設定模組）。
- **改動檔案**：`app/ui/shell.js`（修改）、`app/styles/shell.css`（修改，視檢查結果）、`tests/contrast.test.js`（修改）、`tests/shell.test.js`（修改）
- **設計要點**：對比組合清單寫成資料，之後換色會自動再驗。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 外殼每一組文字／底色都達 WCAG AA（一般 4.5、大字 3），測試涵蓋
  - [ ] 電腦與手機版外殼按鈕都 ≥44px、Tab 可走遍且有焦點外框
  - [ ] 截圖存到指定資料夾，檔名標明畫面與尺寸
  - [ ] 使用者看過截圖並確認可放進企劃書
- **測試策略**：`tests/contrast.test.js` 追加外殼組合；`tests/shell.test.js` — 分頁列模板含 `aria-current="page"` 且只出現一次（邊界：沒有選中分頁時不得出現）、不做的按鈕都有含「即將推出」的 `aria-label`。
- **完成定義**：`npm test` 全綠＋截圖交付＋使用者確認＋收尾批次審查（Final Validation）
- **對外介面**：
- **依賴**：Slice 1–7
- **平行組**：獨立
