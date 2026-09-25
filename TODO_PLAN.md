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
1. 判定引擎（`app/core/`）、資料流（`app/state/store.js`）、訓練流程與第一階段的訓練頁樣式不動。**例外（2026-09-25 使用者核准，見 Slice 9）**：推薦卡縮圖改 3D 人物、深度量表填色加描邊；判定邏輯、顏色語意（綠／黃／紅／取景藍）不變。
2. 島嶼插槽機制不動：`main.js` 的 `ISLAND_MODULES`／`resolveIsland`、島嶼只拿受限 store（`island-facade`）。相關測試保留。
3. 主頁沿用 `island` 這個分頁 id；`ctx.navigate('island')`、`ctx.navigate('workout')` 的既有呼叫端不必改。
4. `motu.css` 逐字區段不得修改；色值、字型、圓角、陰影、動效一律用 `--motu-*`，不自創色值。
5. 今日（`app/features/today/`）與健康（`app/features/tracking/`）、設定（`app/features/settings/`）模組檔案**保留不刪**，只是不再從分頁列進入。
6. 測試數只增不減（362 起算）；不新增 skip/only；既有斷言只有在「需求變更」時才可改寫，且必須在看板申報（目前：`tests/island-registry.test.js` 的五分頁斷言〔Slice 1〕；`tests/shell.test.js` 缺圖示測試的範例從 `heart` 換成 `no-such-icon`，斷言不變〔Slice 2，因 heart 已收錄使原前提失效〕；`tests/shell.test.js` 直欄報讀名稱斷言改為 `shop:商店（即將推出）…`、轉盤斷言改為 `aria-label="幸運轉盤（即將推出）"`〔Slice 8，需求要求只擺樣子的按鈕報讀名稱註明「即將推出」〕）。
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
- 總 Slice 數：13（2026-09-25 追加 Slice 9；同日晚間使用者試用換皮版後再提四點，追加 Slice 10–13，計次 Bug 最優先）
- 已完成：12 / 13
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
  - [x] 使用者看過骨架畫面並確認版面方向正確（2026-09-25 使用者下達 `/run-slice 2` 繼續；「健身頁只留分頁列」未另行回覆，維持現況）
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

### [x] Slice 2 — 補齊外殼需要的 Lucide 圖示
- **目標**：外殼每個按鈕都有和遊戲端相同語意的線條圖示，不再用文字或 emoji 暫代。
- **範圍內**：`app/ui/icons.js` 追加外殼用圖示（預估：`heart`（追蹤）、`settings`（設定）、`hammer`（建造）、`shopping-bag`（商店）、`backpack`（背包）、`smile`（動作）、`gift`（禮物）、`waves`（頭像）；實際清單以 Slice 1 的暫代處為準）。SVG 路徑必須與 Lucide 官方 icon-nodes 逐字相同（ISC 授權）。
- **範圍外**：把圖示放進外殼（Slice 3）；轉盤的彩色圓盤（Slice 6 用 CSS 畫）。
- **改動檔案**：`app/ui/icons.js`（修改）、`tests/icons.test.js`（修改：追加）
- **設計要點**：stroke 2、`currentColor`、尺寸用既有 `ICON_SIZES`。
- **UI Slice?**：YES
- **驗收標準**：
  - [x] 新增的每個圖示都能由 `icon(name)` 輸出合法 SVG
  - [x] 路徑與官方來源逐字相符（沿用第一階段 Slice 2 的比對方式）
- **測試策略**：`tests/icons.test.js` 追加 — 新名稱都存在於 `ICONS`、輸出含 `<svg` 且 `aria-hidden`；邊界：不存在的名稱仍依既有行為處理（不得靜默輸出空字串以外的東西）。
- **完成定義**：`npm test` 全綠＋slice-reviewer
- **對外介面**：
  - `app/ui/icons.js` 的 `ICONS` 新增 8 個（lucide-static v1.47.0 官方名稱）：`backpack`、`face-slightly-smiling`、`gift`、`hammer`、`heart`、`settings`、`shopping-bag`、`waves-horizontal`。`icon()` 介面不變。
  - ⚠️ **給 Slice 3**：v1.47.0 沒有 `smile`、`waves`，`app/ui/shell.js` 仍寫這兩個舊名稱（`RAIL_ITEMS` 的 emote、`accountCardHtml` 的頭像），所以「動作」鈕與頭像還是暫代字；Slice 3 改 shell.js 時要換成 `face-slightly-smiling`、`waves-horizontal`。其餘外殼圖示已因 `glyph()` 自動換成線條圖示（實機確認）。
- **施工備註**：比對來源 `https://cdn.jsdelivr.net/npm/lucide-static@1.47.0/icon-nodes.json`；ICONS 全部 56 個與官方逐字相符（主線與 slice-reviewer 各自獨立比對）。Circuit Breaker 1 次：Slice 1 的 `tests/shell.test.js` 以 heart 當缺圖示例子，補上 heart 後紅燈，換成 `no-such-icon`（已在不變量 6 申報）。
- **審查紀錄**：slice-reviewer 第 1 輪 PASS（2026-09-25）
- **依賴**：Slice 1
- **平行組**：獨立

### [x] Slice 3 — 外殼接上真實狀態與按鈕行為
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
  - [x] 完成一次訓練領取獎勵後回到主頁，帳號卡的金幣與等級已更新（實機以 `commitSession` 模擬領獎：LV 5／1438 → LV 6／1487；未走真實相機流程）
  - [x] 七個不做的按鈕按下只跳提示、不報錯；追蹤與設定不會切換頁面
  - [x] 外殼沒有任何 emoji
- **測試策略**：`tests/shell.test.js` — `accountCardHtml` 顯示 state 的暱稱／等級／金幣、暱稱含 `<script>` 時被跳脫（邊界）、金幣為 0 時仍顯示 0；不可用分頁的清單固定為 `tracking`、`settings`；外殼模板輸出不含 emoji。
- **完成定義**：`npm test` 全綠＋實機 console 0 error＋slice-reviewer
- **對外介面**：
  - `app/ui/shell.js` 新增 `accountFromState(state)` → `{ name, level, coins }`（讀 `profile.nickname`、`wallet.level`、`wallet.coins`；缺漏或非法值退回 `島主`／1／0；刻意不帶出 emoji 的 `profile.avatar`）、`SOON_MESSAGE = '即將推出'`。`RAIL_ITEMS` 的 emote 圖示改為 `face-slightly-smiling`，頭像改為 `waves-horizontal`（外殼已無暫代字）。
  - `main.js`：`MOCK_ACCOUNT` 移除；`renderAccount(s)` 掛在 `store.subscribe`（內容沒變不重畫）；`#sh-rail`、`#sh-corner` 以 `onShellAction` 委派點擊 —— `data-act="build"` 目前只 `show('island')`（**Slice 4 在這裡改成開啟島嶼建造**），其餘 `ctx.toast(SOON_MESSAGE)`；soon 分頁改跳同一提示、不切頁。
- **施工備註**：測試 373 → 379（Slice 2 收尾基線 373）。實機（Playwright 1200 寬）七顆按鈕都跳「即將推出」且不切頁、建造鈕從健身頁回主頁、console 0 error／0 warning。主頁上方與右上仍看得到島嶼自帶浮層的 emoji，屬 Slice 4 範圍。
- **審查紀錄**：slice-reviewer 第 1 輪 PASS（2026-09-25）
- **依賴**：Slice 1、Slice 2
- **平行組**：獨立

### [x] Slice 4 — 主頁隱藏島嶼自帶浮層，左側建造鈕接到島嶼
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
  - [x] 主頁截圖中沒有 🛒✏️🧭、縮放鈕、目標條、成就徽章
  - [x] 按「建造」能開啟島嶼商店並完成一次擺放（或在金幣不足時出現原本的提示）（實機 1440：石階 1487→1477；390：花圃 1477→1462，帳號卡同步）
  - [x] 島嶼模組沒有 `openBuild` 時，按「建造」只跳提示、不報錯
- **測試策略**：靜態／單元測試 — 島嶼模組 export 含選用的 `openBuild`；`main.js` 呼叫時有 `?.` 保護（邊界：模組缺這個方法）；受限 store 的既有斷言保持通過。
- **完成定義**：`npm test` 全綠＋實機完成一次建造＋slice-reviewer
- **對外介面**：
  - 島嶼 feature 契約新增**選用** `openBuild?()`（`app/features/island/island.js`：未掛載時不做事；掛載後開啟既有造型商店抽屜，之後沿用原放置流程）。已寫進 `main.js` 的 feature 契約註解。
  - 島嶼 mount 的 ctx 多一個旗標 `hideOverlay: true`（只給島嶼的 `featCtx`，共用 `ctx` 不帶）；`island.js` 收到後在 `#isl-stage` 掛 `.isl-shelled`。
  - `main.js` 新增內部 `openBuild()`：先 `show('island')`，模組沒有 `openBuild` 時 toast「這個島嶼版本沒有提供建造功能」，呼叫出錯 toast「建造功能暫時無法開啟」；`data-act="build"` 改走它。
  - CSS（`island.css` 的 `.isl-shelled` 區段）：隱藏 `.isl-left/.isl-right/.isl-goal/.isl-hint/.isl-ach`；商店抽屜與擺放／選取列抬到 `--sh-tab-h` 上方、收合時 `visibility:hidden`；**抽屜開啟時用 `#view:has(...) ~ #shell` 讓 `.sh-rail`、`.sh-corner` 暫時隱藏**（依賴 `#view` 與 `#shell` 為相鄰兄弟，Slice 5–8 改 `index.html` 結構時要保留）。
- **施工備註**：測試 379 → 388（新增 `tests/island-build-entry.test.js` 9 個；既有斷言未改）。Circuit Breaker 2 次：①`hideOverlay` 原本寫進受限 store 那行，撞到 `island-facade.test.js` 鎖定的寫法 → 改成另一行設定，既有斷言不動；②新測試自己的反向 regex 誤判 → 改成逐一檢查選擇器。實機發現手機版左側直欄與右下鈕蓋住商店品項，本 Slice 內以 `:has` 讓位修正。console 0 error／0 warning。
- **交接／已知缺口**：外殼模式下島嶼的**編輯模式（旋轉、移除建築）與重置視角、縮放鈕無入口**（原本在隱藏的 ✏️🧭＋－；滑鼠滾輪與拖曳仍可縮放旋轉）；商店抽屜與擺放列仍是舊樣式、含 emoji（範圍外，列入交接）。
- **審查紀錄**：slice-reviewer 第 1 輪 PASS（2026-09-25）；其建議的收合時間 0.3s→0.35s 已對齊。
- **依賴**：Slice 3
- **平行組**：獨立

### [x] Slice 5 — 健身頁適配懸浮分頁列
- **目標**：在「健身」分頁裡，訓練頁的內容和按鈕都不會被底部懸浮分頁列蓋住，第一階段的畫面維持原樣。
- **範圍內**：`shell.css` 為非主頁的 `#view` 留出底部空間（分頁列高度＋安全區）；「快速開始 AI 訓練」浮動鈕改以新分頁列定位；電腦版的內容置中限寬沿用第一階段。
- **範圍外**：訓練頁本身的任何樣式與功能（第一階段已完成）；主頁。
- **改動檔案**：`app/styles/shell.css`（修改）、`app/features/workout/workout.css`（修改：僅浮動鈕定位，若需要）
- **設計要點**：不改訓練頁的色彩、字級、間距；只處理與外殼的交界。
- **UI Slice?**：YES
- **驗收標準**：
  - [x] 動作清單、結算、領取獎勵捲到最底時，最後一顆按鈕完整露出、可點（實機：390×844 清單最後卡 736 < 分頁列 760；390×560 說明／結算／領獎最後鈕離分頁列 32px 且可點；1440 清單離 24px）
  - [x] 以第一階段 9 張截圖的畫面重拍比對，除外殼外無差異（改以「開／關本規則比對 #view 內全部元素位置」代替逐張重拍：清單、結算、領獎 0 差異；說明頁因變成可捲動，無頭 Chromium 的傳統捲軸造成水平 4px 位移，垂直與尺寸不變；倒數、即時、休息為全螢幕 #view.full，規則不作用）
- **測試策略**：靜態測試鎖定「非主頁 `#view` 底部留白 ≥ 分頁列高度」的規則存在；實機用 Playwright 量測最後一顆按鈕的 bottom 小於分頁列 top（邊界：手機 390 寬、內容最長的結算頁）。
- **完成定義**：`npm test` 全綠＋實機量測＋slice-reviewer
- **對外介面**：
  - CSS 變數 `--sh-view-pad-b`（`app/styles/shell.css`）：非主頁捲動頁面的底部留白；手機＝`--sh-tab-h`＋安全區＋`--motu-space-6`，電腦版另加懸浮離底 `--motu-space-4`。Slice 6–8 若改分頁列高度或離底距離，只要維持 `--sh-tab-h` 即自動跟上；改離底距離時要同步改電腦版這個變數。
  - 規則 `#app:has(> #shell[data-page="page"]) > #view:not(.full)`：依賴 `#shell` 是 `#app` 的直接子元素、`data-page` 由 `main.js` 的 `show()` 設定（Slice 6–8 改 `index.html` 結構時要保留）。無新 export。
- **施工備註**：測試 388 → 390（`tests/shell.test.js` 新增 2 個 CSS 靜態測試）。`workout.css` 未改：960 寬時浮動鈕 [751–936] 與分頁列 [240–720] 不重疊，1440 亦不重疊。實機示範模式走完一輪到結算、領獎；console 0 error（warning 僅為刻意模擬無相機）。
- **已知限制**：手機版「快速開始 AI 訓練」浮動鈕（fixed）蓋住捲到底時最後一張「即將推出」鎖定卡的右下角 —— 第一階段既有行為、屬 `workout.css`，本 Slice 未造成也未加劇；該卡本身不可點。
- **審查紀錄**：slice-reviewer 第 1 輪 PASS（2026-09-25；獨立以 headless Chrome 重量，結論一致）
- **依賴**：Slice 3
- **平行組**：獨立

### [x] Slice 6 — 照遊戲端截圖細修外殼造型
- **目標**：主頁外殼和 `image.png` 並排時看起來是同一個產品。
- **範圍內**：`shell.css` —— 分頁列頁籤造型（選中頁籤海洋青底、上緣斜角、上方小圓點、面板頂緣虛線）；帳號卡（右上斜角、LV 膠囊、虛線分隔、金幣列）；左側直欄（深藍豎線、按鈕右側尖角、小標籤膠囊）；右下禮物大圓鈕（金色小點）與轉盤（CSS conic-gradient 用 Motu 色票畫彩色圓盤）；載入畫面的 🏝️ 改 Lucide。
- **範圍外**：動效（Slice 7）；對比與無障礙收尾（Slice 8）。
- **改動檔案**：`app/styles/shell.css`（修改）、`app/ui/shell.js`（修改：若需額外結構）、`index.html`（修改：載入畫面圖示）、`tests/shell.test.js`（修改）
- **設計要點**：只用 `--motu-*`；斜角用 `clip-path` 或偽元素，不用圖片；不自創色值。
- **UI Slice?**：YES
- **驗收標準**：
  - [x] 電腦版 1920 寬截圖與 `image.png` 並排，外殼的位置、造型、選中態一致（神似即可）（`.playwright-mcp/s6_after_1920.png`、`s6_after_390.png`；改前 `s6_before_1920.png`）
  - [x] `shell.css` 不出現 `--motu-*` 以外的色值
  - [x] `index.html` 載入畫面沒有 emoji
- **測試策略**：`tests/shell.test.js` 追加 — `shell.css` 自創色值掃描（沿用 `motu-skin.test.js` 的偵測器，含防空轉 probe）；載入畫面無 emoji（邊界：去掉註解後仍掃得到 `<div class="loader-logo">` 內容）。
- **完成定義**：`npm test` 全綠＋電腦／手機截圖＋slice-reviewer
- **對外介面**：
  - **`--sh-tab-h` 由 84px 改為 96px**（容納頁籤小圓點與頂緣虛線）。Slice 4 的島嶼抽屜抬高、Slice 5 的 `--sh-view-pad-b` 都是變數引用，已自動跟上（實機：1440 抽屜底緣＝分頁列頂緣 788；健身頁留白 136px）。
  - `app/ui/shell.js` 的 `cornerHtml()`：轉盤內容改為空的裝飾 `<span class="sh-wheel-disc" aria-hidden="true"></span>`（不再有「轉盤」文字），報讀名稱仍由按鈕 `aria-label="幸運轉盤"` 提供。其餘 export 不變。
  - CSS 內部尺寸變數（僅 shell.css 內用）：`--sh-cut`（帳號卡斜角）、`--sh-tip`（直欄尖角）、`--sh-tab-cut`（選中頁籤斜角）。
  - 造型手法（給 Slice 7 動效）：帳號卡底色在 `.sh-account::before`、直欄按鈕與選中頁籤用 `clip-path`，陰影改在外層 `filter: drop-shadow(--motu-shadow-*)`（`.sh-account`、`.sh-rail-item`）。Slice 7 若要做 hover 陰影，要改外層的 filter，不是按鈕的 box-shadow。
- **施工備註**：測試 390 → 396（`tests/shell.test.js` 新增 6 個：自創色值掃描＋防空轉 probe、造型關鍵規則、轉盤為純裝飾、載入畫面無 emoji〔去註解邊界〕、棕櫚樹路徑與 `ICONS['tree-palm']` 逐字相同）。實機 1920／1440／390 截圖，console 0 error／0 warning。
- **與計畫文字的落差**：計畫寫禮物「右上角金色小點」，但 `image.png` 的金點在**左上**；驗收以截圖並排為準，照截圖放左上（CSS 註解已註明）。
- **交接／已知缺口**：`index.html` 的 favicon 仍是 🏝️ emoji（不在本 Slice「載入畫面」範圍，未改）；截圖中帳號卡右側的下拉箭頭、轉盤左上的金幣小膠囊未做（需求未列）。
- **審查紀錄**：slice-reviewer 第 1 輪 PASS（2026-09-25）
- **依賴**：Slice 3、Slice 4
- **平行組**：獨立

### [x] Slice 7 — 外殼微互動與動效
- **目標**：外殼按鈕的 hover、按壓、分頁切換節奏和第一階段訓練頁一致。
- **範圍內**：`shell.css` 的 transition 走 `--motu-duration-*`／`--motu-ease-*`；按壓 `scale(.98)`；分頁切換時選中頁籤的過場；禮物鈕的小點可用遊戲端的可領取脈動（若語意合適）；`prefers-reduced-motion` 下全部停止。
- **範圍外**：3D 島嶼的動畫；新增動畫種類以外的功能。
- **改動檔案**：`app/styles/shell.css`（修改）、`tests/motu-skin.test.js`（修改：把 `shell.css` 納入寫死時長與按壓比例掃描）
- **設計要點**：只動 transform／opacity。
- **UI Slice?**：YES
- **驗收標準**：
  - [x] `shell.css` 的 transition／animation 沒有寫死時長
  - [x] reduced-motion 下外殼動畫全部停止（實機模擬：Playwright `reducedMotion: reduce`，transform／animation／transition 全為 none）
  - [x] 所有外殼按鈕按壓縮放為 `.98`（直欄、禮物、轉盤、頁籤實測 matrix(0.98…)）
- **測試策略**：`tests/motu-skin.test.js` 的 `MOTION_FILES` 加入 `app/styles/shell.css`，沿用既有掃描器與 reduced-motion 涵蓋檢查（邊界：`0s` 與 reduced-motion 區塊例外）。
- **完成定義**：`npm test` 全綠＋實機錄一段切換與按壓＋slice-reviewer
- **對外介面**：
  - 無新增 export／props／storage key。僅 shell.css 內部新增 `@keyframes sh-tab-in`（選中頁籤子元素浮上，只動 transform／opacity，不設 fill-mode）。
  - 給 Slice 8：外殼 hover 上浮包在 `@media (hover: hover)`；檔尾的 `prefers-reduced-motion` 區塊選擇器與上方逐字對應，Slice 8 若新增外殼按鈕 class，要同步加進 `:active` 縮放規則與 reduced-motion 區塊（`tests/motu-skin.test.js` 會抓）。
- **施工備註**：測試 396 → 400（`MOTION_FILES` 納入 `shell.css`；新增 4 個：transition／keyframes 只動 transform／opacity、四類按鈕都有 .98 按壓、reduced-motion 覆蓋完整〔選擇器逐字比對〕、hover 只在 `@media (hover: hover)` 內〔括號配對取區塊〕）。突變檢查 5 項全被抓到（拿掉 reduce 的 animation:none、.98→.95、寫死 .25s、keyframes 加 color、hover 移出區塊）。實機 1440 錄切換與按壓：`.playwright-mcp/s7_switch_30ms/90ms/300ms.png`、`s7_rail_hover.png`；console 0 error／0 warning。
- **與計畫文字的落差**：禮物金點**未做**可領取脈動 —— 禮物目前是「即將推出」，脈動會暗示有東西可領；且遊戲端 `fragment-ready-pulse` 改的是 box-shadow，違反「只動 transform／opacity」。計畫原文為「若語意合適」，判定不合適（CSS 註解已註明）。
- **Circuit Breaker**：Attempt 1 一次（測試解析器把 `@media` 標頭當成選擇器，修正測試本身，CSS 未改）。
- **審查紀錄**：slice-reviewer 第 1 輪 PASS（2026-09-25）
- **依賴**：Slice 6
- **平行組**：獨立

### [x] Slice 8 — 外殼無障礙、RWD 收尾，產出主頁截圖
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
  - [x] 外殼每一組文字／底色都達 WCAG AA（一般 4.5、大字 3），測試涵蓋
  - [x] 電腦與手機版外殼按鈕都 ≥44px、Tab 可走遍且有焦點外框（實測最小：電腦 84×72、手機 60×52）
  - [x] 截圖存到指定資料夾，檔名標明畫面與尺寸（`01_主頁_電腦版_1920.png`…`05_健身分頁_手機版_390.png`，2 倍解析度，未注入樣式、未隱藏捲軸）
  - [x] 使用者看過截圖並確認可放進企劃書（2026-09-25 交付；使用者看過後要求先修推薦卡與深度量表 → Slice 9 完成後重截 04、05 → 使用者確認 OK）
- **測試策略**：`tests/contrast.test.js` 追加外殼組合；`tests/shell.test.js` — 分頁列模板含 `aria-current="page"` 且只出現一次（邊界：沒有選中分頁時不得出現）、不做的按鈕都有含「即將推出」的 `aria-label`。
- **完成定義**：`npm test` 全綠＋截圖交付＋使用者確認＋收尾批次審查（Final Validation）
- **對外介面**：
  - `app/ui/shell.js`：`RAIL_ITEMS` 的商店／背包／動作多了 `soon: true`（新增欄位，既有欄位不變）；`tabbarHtml()` 選中頁籤多 `aria-current="page"`、soon 頁籤多 `aria-label="<名稱>（即將推出）"`；`railHtml()` soon 按鈕報讀名稱加註「（即將推出）」，下方標籤 `aria-hidden="true"`；`cornerHtml()` 禮物／轉盤報讀名稱加註「（即將推出）」。函式簽名不變。
  - `shell.css`：選中頁籤底色改 `--motu-color-primary-hover`（深青，白字 5.15:1）；新增焦點外框規則（`.sh-rail-item:has(> .sh-rail-btn:focus-visible)`、`.sh-tab.is-active:focus-visible`、禮物／轉盤白色內圈）。
- **施工備註**：測試 400 → 409（contrast 3 個：外殼 5 組對比〔色值從 shell.css 解析〕、選中頁籤不得是白字／海洋青、解析器防空轉；shell 6 個：aria-current 只出現一次、無選中時不出現〔邊界〕、即將推出標籤與按鈕是否可用一一對應、報讀名稱以可見文字開頭、直欄標籤 aria-hidden、clip-path 按鈕的替代焦點外框）。突變檢查 4 項全被抓到。實機 1920／1440／390，console 0 error／0 warning。
  - **實機發現並修正**：直欄按鈕與選中頁籤用 clip-path 裁形，聚焦時自己的 outline 被一起裁掉、完全看不到（`.playwright-mcp/s8_focus_*.png`）；另外手機版海洋青外框疊在青綠色海面上幾乎看不見 → 浮在島嶼上的按鈕改白色內圈＋海洋青外框。
- **與計畫文字的落差**：Tab 順序計畫寫「帳號卡 → 直欄 → 內容 → 右下 → 分頁列」，但 DOM 裡 `#view` 在整個 `#shell` 之前，要完全照做得動 `index.html`（不在本 Slice 改動檔案）。實測主頁 `#view` 內沒有 Tab 可達元素、帳號卡也沒有可聚焦元素，實際順序「直欄 → 右下 → 分頁列」與要求等價，故未改。**已知缺口**：島嶼建造抽屜打開時，抽屜內按鈕會排在直欄之前。
- **交接／已知缺口**：手機健身頁的「快速開始」浮動鈕會蓋到動作卡一角（第一階段既有行為，非本 Slice 範圍）；favicon 仍是 emoji（Slice 6 已記）。
- **Circuit Breaker**：1 次（slice-reviewer 第 1 輪 BLOCK：測試註解寫「已在看板申報」但看板漏記，補申報後通過）。
- **審查紀錄**：slice-reviewer 第 1 輪 BLOCK（不變量 6 申報漏記）→ 第 2 輪 PASS（2026-09-25）
- **依賴**：Slice 1–7；Slice 9（健身分頁截圖需在 Slice 9 後重截，2026-09-25 追加）
- **平行組**：獨立

### [x] Slice 9 — 訓練頁兩處視覺修正：推薦卡改 3D 人物、深度量表填色看得清楚
- **來源**：2026-09-25 使用者看 Slice 8 截圖與實際試用後提出，選擇「先修再重截」。屬需求追加，不變量 1 已申報例外。
- **目標**：①「今日推薦」卡左側縮圖和下方動作卡一樣是 3D 人物循環示範（現在是 Lucide 往下箭頭，看起來像下載鍵）；②深度量表的填色在白底軌道上清楚可見。
- **範圍內**：
  - 推薦卡 hero 改放 canvas，**沿用動作卡共用的離屏 3D renderer**；推薦卡比例不同，一律從 renderer 目前的畫面置中裁切（cover）貼上，**不為它重設 renderer 尺寸**（原設計不掛 3D 就是為了避免每幀重設尺寸）。
  - 深度量表填色：保留原本四色（判定回饋語意，與骨架一致），光暈改為深藍描邊。
- **範圍外**：判定邏輯、`display-colors.js` 的顏色語意與調色盤；深度量表跟隨設定頁顏色顯示模式（既有缺口，另記）；金幣圖示方向與數字顏色（待遊戲組原始碼）；動作卡本身。
- **改動檔案**：`app/features/workout/workout.js`（修改）、`app/features/workout/workout.css`（修改）、`tests/workout-visual.test.js`（新增）
- **設計要點**：
  - 為什麼不把黃、藍加深：黃要加深到 `#B88A00` 才有 3:1，此時與紅 `#ff5a5a` 亮度幾乎相同（1.03:1），色弱使用者黃紅分不出來。改用描邊界定填到哪裡（深藍對白 10:1），填色維持鮮明。
  - 只用 `--motu-*`；描邊不改尺寸，不影響量表位置與達標線。
- **UI Slice?**：YES
- **驗收標準**：
  - [x] 推薦卡縮圖是對應動作的 3D 人物循環動畫，電腦與手機都不變形（置中裁切）（`.playwright-mcp/s9_rec_1920.png`、`s9_rec_390.png`）
  - [x] 共用 renderer 不因推薦卡而每幀重設尺寸（實機：離屏 canvas 寬度設定 1.5 秒與 3.5 秒皆 3 次，不隨時間增加；1920／390）
  - [x] 深度量表四種填色都有深藍描邊、無光暈；判定顏色語意與 `gaugeColor()` 不變（`.playwright-mcp/s9_gauge_all.png`；0% 時無描邊）
  - [x] 進入／離開訓練清單時推薦卡動畫會停止（沿用卡片動畫世代計數）
- **測試策略**：`tests/workout-visual.test.js` — 置中裁切數學（寬圖貼窄框、窄圖貼寬框、同比例、尺寸為 0 的邊界）；推薦卡模板含 canvas 且不再含 `wk-ic-disc`；量表 CSS 四色都有深藍描邊、無 `0 0 12px` 光暈（邊界：`data-c` 選擇器與預設綠都要涵蓋）。
- **完成定義**：`npm test` 全綠＋實機截圖（推薦卡電腦／手機、量表四色）＋slice-reviewer（L 檔）
- **對外介面**：
  - `app/features/workout/workout.js` 新增 export：`recHeroHtml(id)`（推薦卡縮圖模板，回 `<div class="wk-rec-hero"><canvas class="wk-rec-canvas" data-ex data-crop="1">`）、`coverCrop(srcW, srcH, dstW, dstH)`（置中裁切的 drawImage 來源矩形，任一邊 ≤0 回 null）。
  - `startCardAnims()` 同時驅動 `canvas.wk-rec-canvas[data-ex]`（排在動作卡之後，不改 renderer 尺寸）。
  - 深度量表：`#lv-gfill` 在 0% 時帶 class `empty`；CSS 變數 `--lv-gauge-edge`（定義在 `.lv-gauge-track`）。
- **施工備註**：測試 409 → 421（新增 `tests/workout-visual.test.js` 12 個）。突變檢查 4 項全被抓到（黃色加回光暈、紅色蓋掉描邊、拿掉 empty 標記、推薦卡也去重設 renderer 尺寸）。深度量表因沒有攝影機，進入即時畫面後以程式設定 `#lv-gfill` 的高度與 `data-c`（與判定程式寫入的值相同，未注入樣式）截圖驗證。
- **Circuit Breaker**：1 次（`recCardHtml` 會讀執行期 store，node 測試裡為 null → 拆出純函式 `recHeroHtml` 再測）。
- **已知缺口**：深度量表不跟隨設定頁「顏色顯示模式」（高對比、單色模式下仍是三色），既有行為，本 Slice 未處理；手機推薦卡比例很窄，人物左緣會被裁到一點。
- **審查紀錄**：slice-reviewer 第 1 輪 PASS（2026-09-25）
- **依賴**：無（與 Slice 1–7 不相交）；Slice 8 的健身分頁截圖要在本 Slice 完成後重截
- **平行組**：獨立

### [x] Slice 10 — 🔴 訓練計次 Bug：次數會自己減少、「+1」有時不出現
- **來源**：2026-09-25 使用者試用回報（第 4 點，標為嚴重 Bug、立即修）。
- **根因（已查證）**：
  1. 「+1 有時不出現」：`handleResult` 直接覆寫 `className = 'lv-repflash pop ok'`。連續兩下都有效時 class 字串完全相同，瀏覽器不會重播動畫；動畫是 `forwards` 停在 opacity 0，所以第二下起看不到。只有 ✓／✗ 交替時才會出現 →「有時有、有時沒有」。
  2. 「次數有時會減少」：引擎（高抬腿）的防作弊規則——同一隻腳連抬兩下，會把「上一下」也作廢（有效次數 −1）。畫面只閃「✗ 未左右交替」，數字卻悄悄少 1。深蹲／開合跳／伏地挺身的有效次數在引擎層不會減少（合成序列 × 3 種雜訊實測）。
  3. 示範模式：一次追補多幀時只把最後一幀交給 `handleResult`，中間幀的 ✓／✗ 會漏掉；沒有新幀的 rAF 又會把上一個結算結果再交一次（重閃、重嗶）。
- **範圍內**：閃字改「移除 pop → reflow → 加回」；撤銷時明講「−1 左右腳要輪流」並由教練字幕說明原因；示範模式逐幀交出結算、沒有新幀時去掉結算旗標。
- **範圍外**：引擎的撤銷規則本身（不變量 1，防作弊設計，不改）。
- **改動檔案**：`app/features/workout/workout.js`（修改）、`tests/rep-count.test.js`（新增）
- **UI Slice?**：YES（閃字行為）
- **驗收標準**：
  - [x] 連續有效的每一下都閃「✓ +1」，數字同步 +1（實機示範模式 25 秒：12 下有效、12 次 ✓ +1、2 次 ✗，console 0 error）
  - [x] 有效次數變少的那一幀一定閃「−1」，不會只閃 ✗（`tests/rep-count.test.js` 端到端：高抬腿單腳序列）
  - [x] 次數沒變的幀不會閃 ✓
- **測試策略**：`repFlash` 純函式四種情況＋第一幀邊界；`popRepFlash` 用假元素驗「reflow 時 pop 已拿掉」；引擎＋畫面判斷端到端 6 組（四動作乾淨序列、半蹲、單腳高抬腿）。
- **完成定義**：`npm test` 全綠＋實機示範模式
- **對外介面**：`workout.js` 新增 export `repFlash(res, prevValid)` → `{kind:'ok'|'bad', text}|null`；`popRepFlash(el, {kind,text})`；`live.shownValid`（上一幀畫面上的有效次數）。
- **施工備註**：測試 421 → 434（+13）。突變檢查 2 項都被抓到（不先拿掉 pop、撤銷判斷拿掉）。
- **已知缺口**：真人鏡頭下「右腳抬太低、引擎完全沒偵測到」時仍會觸發撤銷——那是引擎門檻問題，需真人測試再決定，現在至少畫面會講清楚原因。
- **平行組**：獨立

### [x] Slice 11 — 訓練畫面左上角重新排版
- **來源**：使用者第 1 點（`photo/截圖 下午6.47.06`）：結束鈕、動作名、追蹤狀態、四個階段燈各自是一顆膠囊，擠在一起、看起來全都像按鈕。
- **目標**：左上角收成一張資訊卡：返回鈕＋動作名＋模式一列；虛線分隔；追蹤狀態一行；四階段改成一條相連的步驟條（明顯是指示器，不像按鈕）。
- **改動檔案**：`app/features/workout/workout.js`、`app/features/workout/workout.css`、`tests/workout-layout.test.js`（新增）
- **設計要點**：卡裡只有「結束」是按鈕（白底、外框、≥44px）；追蹤狀態改成「狀態色小圓點＋圖示＋深藍字」；階段改成圓點＋細線串起、無外框無陰影，目前階段圓點放大填海洋青。動作名旁的深蹲圖示（往下箭頭，像下載鍵）一併拿掉。模式（示範／即時偵測）從右上角移進卡內當副標。
- **驗收標準**：
  - [x] 電腦 1440 與手機 390 截圖不擠、不重疊（`.playwright-mcp/s11_head_1440.png`、`s11_head_390.png`）
  - [x] 階段指示器不是按鈕外觀（無外框／背景／陰影）
  - [x] 既有 id（`lv-exit`、`lv-track`、`lv-stages`、`lv-modebadge`）保留，`hud.stages` 接線不變
- **完成定義**：`npm test` 全綠（434 → 440）＋實機截圖，console 0 error
- **對外介面**：移除 `.lv-hudtop`；新增 `.lv-head`／`.lv-head-row`／`.lv-head-name`／`.lv-head-body`；`#lv-stages` 內多了 `<i>` 連接線（`#lv-stages span` 選擇器不受影響）。
- **平行組**：獨立

### [x] Slice 12 — 取景關卡的「跳過檢查」改成看得懂的次要選項
- **來源**：使用者第 2 點（`photo/截圖 下午6.47.20`）：「跳過檢查，直接開始 ›」是一顆大白鈕，跟上面的提示字、檢查項長得一樣，分不出是提醒還是要按。
- **目標**：一張狀態卡：上半是狀態（檢查清單＋「站穩 2 秒」進度條＋「就會自動開始」），虛線下才是唯一的操作——「偵測一直過不了？ 跳過檢查，直接開始」次要文字鈕＋「跳過後計次可能不準」後果說明（10 秒後才出現，沿用原邏輯）。
- **改動檔案**：`app/features/workout/workout.js`、`app/features/workout/workout.css`、`tests/workout-layout.test.js`
- **設計要點**：檢查項改圓圈打勾清單（膠囊在這個 App 裡代表按鈕）；跳過鈕改底線深青字（對白 5.2:1），觸控區仍 ≥44px；關卡上下留白讓出左上卡與數據列，人形框自動伸縮；取景期間隱藏深度量表（小螢幕會蓋到卡片）。
- **驗收標準**：
  - [x] 1440／390／375×667 都不重疊（`.playwright-mcp/s12_gate_1440.png`、`s12_gate_390.png`、`s12_gate_375.png`；無攝影機，以程式叫出關卡並模擬 3/5 打勾、進度 40%、跳過區已現身）
  - [x] 跳過鈕視覺上明顯是次要選項，且說明後果
  - [x] 10 秒現身、2 秒自動開始的邏輯不變
- **完成定義**：`npm test` 全綠（440 → 445）＋實機截圖，console 0 error
- **對外介面**：`.lv-gate-panel`／`.lv-gate-alt`／`.lv-gate-bar`；檢查項改 `<li class="lv-gate-chk">`（勾選符號由 CSS 畫，文字只放部位名）；`#lv-wrap.is-gating`。
- **已知缺口**：真人鏡頭下的關卡未實測（本機無攝影機），需使用者實機看一次。
- **平行組**：獨立

### [ ] Slice 13 — 結算畫面重新排版＋彩帶特效，拿掉意義不明的「C」
- **來源**：使用者第 3 點（`photo/截圖 下午6.47.42`、`6.47.49`）：六格數字平鋪、看不出重點；中間的「C」沒有說明（實為等第）；缺慶祝感。遊戲組結算畫面原始碼未提供，依遊戲端 Motu 風格重排。
- **目標**：一眼看懂「這次做了幾下有效、拿到多少、下一步」：主數字（有效次數）＋達標率環＋金幣；次要資訊收成一列；等第若保留須有文字說明；有效次數 > 0 時放彩帶（尊重減少動態）。
- **改動檔案**：`app/features/workout/workout.js`、`app/features/workout/workout.css`、測試
- **平行組**：獨立
