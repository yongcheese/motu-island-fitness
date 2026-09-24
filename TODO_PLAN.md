# TODO_PLAN — Island Fitness AI｜合體第一階段：健身畫面換成遊戲組樣式
<!-- cross-model-review: skip（2026-09-24 使用者裁示：本專案不送 Codex 審） -->

> 產生時間：2026-09-23
> 需求來源：對話需求（2026-09-23 定案，合體第一階段）。前一份看板已原封封存為 `TODO_PLAN_合體前.md`（其 Slice 9、10 待第二階段討論整合時再評估）。
> 技術棧：純前端 ES Modules（無框架、無打包、無 TypeScript）；MediaPipe Pose；Chart.js 4.4.1；three.js r161
> 測試指令：`npm test`（`node tests/run.js`，基線 **313/313 綠**，不得下降）
> 執行方式：`python3 serve.py 8080` → `http://localhost:8080`
> 目的：10/01 企劃書需要健身畫面的正式截圖。
> 分工（2026-09-24 會議定案）：**我們做健身（訓練頁）換皮；健康頁由遊戲組照「健康頁設計 V2」的功能、用他們的樣式製作**，本看板不含健康頁。

## 需求檔位
- **檔位**：L
- **判定理由**：加分清單命中 3 條 →
  ①改動的介面有多個消費端：色彩 token 定義在全域的 `lumina.css`／`app.css`，五個分頁都讀同一組變數；
  ②引入新的外部資產：Lucide 圖示（ISC 授權，SVG 路徑放進本機），以及 Inter 800/900 字重（OFL）；
  ③橫跨 3 個以上關注點：token、圖示、訓練頁、相機 HUD、動效、無障礙。
  未命中：不碰持久化或登入；耦合關係已用 grep 查過（CSS 未分層、寫死色的分布已知）。
- **本檔位規格**：Slice 數 6 ｜ slice-reviewer 逐 Slice ｜ 完整 build **N/A（本專案沒有 build）**，改用 `npm test` 全綠＋瀏覽器實機沒有 console error ｜ context 隔離：半自動模式每 2–3 個 Slice 換一次對話
- **UI 骨架 Slice：N/A**：這次只換樣式，版面、流程、功能全部凍結，沒有新的產品形狀需要先確認。
  三件套裡的「視覺美學」由 Slice 3–4 分畫面承擔，「微互動」獨立為 Slice 5。

## 本次的不變量（任何 Slice 都不得破壞）
1. **只換樣式**。功能、版面結構、流程、文案語意、判定引擎（`app/core/`）、資料流（`store.js`）一律不動。
2. **判定回饋的顏色語意不動**。相機畫面上的骨架三色（藍＝準備／綠／黃／紅）和三套配色（三色、色盲友善高對比、單色）屬於判定回饋，不算樣式；`ui/display-colors.js` 的 `PALETTES` 數值保持原樣。
   （2026-09-24 使用者確認：骨架顏色保持我們的。）
3. **不整包載入遊戲組的 CSS**。只取檔尾的 `@layer motu-contract`，前段 Tailwind 編譯輸出含全域 reset，會打壞版面。
4. **不改遊戲組定案的色票與字型數值**。可以決定「哪個顏色用在哪裡」，不可以改色值。
5. 測試數不得低於 313；不得新增 skip/only；不得弱化既有斷言。
6. 範圍外頁面（今日、島嶼、健康、設定）與外殼（頂部列、分頁列）**不做美化**，只保證換成淺色 token 後還能正常使用、文字不會消失。合體後這些都歸遊戲組。

## 設計鐵律速查（本專案版，覆蓋 make-plan 預設）
- 視覺系統＝遊戲組 **Motu**（奶油紙質底 `#F8F6F1`、白卡、暖灰線 `#E1DED4`、深藍文字 `#264653`、海洋青主行動 `#2A9D8F`、金／珊瑚只用於獎勵與危險）。
  make-plan 預設的 neutral/zinc 灰階與單一強調色**不適用**：UI Authority 第 1 順位是需求，需求明定「凡屬樣式一律照遊戲組」。
- 圓角照 `--motu-radius-*`（卡片 `--motu-radius-xl` 1.5rem／面板 `--motu-radius-panel` 2rem／按鈕 pill）；陰影照 `--motu-shadow-*`，帶深藍色調，不用黑色重陰影。
- 圖示一律 **Lucide 線條**（stroke 2、`currentColor`），尺寸用 token；不混用 emoji。本專案沒有 React，所以不用 `lucide-react`，改用本機 SVG 字串（見 Slice 2）。
- 動效用 `--motu-duration-*`／`--motu-ease-*`；尊重 `prefers-reduced-motion`。
- 免費優先：Lucide（ISC）與 Inter（OFL）都免費開源，都放在本機 `vendor/`，不走 CDN。
- 深色模式：Motu 只有淺色（`color-scheme: light`），本次不做深色版。

## 設計顧問輸入（ui-ux-pro-max，全專案只查這一次，2026-09-23）
- **採納**
  - `no-emoji-icons`／`icon-style-consistent`：emoji 全部換成同一套 SVG 線條圖示，stroke 粗細一致。
  - `color-contrast`（實測 WCAG 對比，白底／奶油底）：
    深藍 `#264653` 10.1／9.3 ✅；深藍淡 `#4A6169` 6.6／6.1 ✅；**深青 `#1F7A70` 5.2／4.8 ✅**；
    **海洋青 `#2A9D8F` 3.3／3.1 ❌（小字不合格）**；金 `#E8AA3E` 2.0 ❌；金字 `#C98A24` 2.9 ❌；珊瑚 `#E8836A` 2.7 ❌；資訊藍 `#4FB9E8` 2.2 ❌。
    → **規則：所有文字只用深藍、深藍淡、深青。海洋青、金、珊瑚只用在填色、圖示、進度條、≥24px 粗體大數字（3:1 的大字標準）。**
    白字放在海洋青按鈕上只有 3.3:1，只能用於 ≥18.66px 粗體（大字標準）；小字按鈕改用深青底。
  - `color-not-only`：金幣／碎片等獎勵不能只靠金色表達，一律同時放圖示與文字。
  - 相機畫面上的 HUD（`ux: contrast-readability`）：淺色 HUD 疊在不可控的影像上，底色用白 92% 不透明＋`--motu-shadow-md`，文字一律深藍；不用半透明玻璃（遊戲組規範也寫了「避免厚重玻璃與黑色遮罩」）。
  - `touch-target-size`：可點元素 ≥44px；`focus-states`：`focus-visible` 外框用 `--motu-color-focus`。
  - `duration-timing`：微互動用 150–300ms，直接對應 `--motu-duration-fast/base/slow`。
- **駁回**
  - `--design-system` 自動配色與字型推薦：**不執行**（理由：色票與字型已由遊戲組定案，需求明定不可改）。
  - ui-ux-pro-max 預設圖示庫 Phosphor：駁回（理由：遊戲端用 Lucide，同一產品必須同一套圖示）。
  - 深色模式成對撰寫：駁回（理由：Motu 只有淺色，遊戲端也沒有深色版）。
> 下游的 run-slice 與 slice-builder 一律沿用本區塊，不得重新調用 ui-ux-pro-max。

## 進度總覽
- 總 Slice 數：6
- 已完成：2 / 6
- 平行組：無（Slice 1 碰共用的 `index.html` 與全域 token；Slice 3–6 都會碰 `workout.css` 或 `motu-skin.css`，全部序列執行）

---

### [x] Slice 1 — 導入遊戲組樣式基礎並把全域色彩對應到 Motu
- **目標**：整個 App 換成 Motu 的淺色底、字型與元件基礎，後續每個畫面只需要處理寫死的顏色。
- **範圍內**：
  - 新增 `app/styles/motu.css`：從遊戲組檔案**原封不動**取出 `@layer motu-contract` 區段（約 562 行），檔頭註明來源檔名、擷取日期、原檔 sha256（`0f43c7b3…` 是編譯後 CSS 的雜湊，另計本段雜湊），以及「不得修改色值」。
  - 新增 `app/styles/motu-skin.css`：把 `lumina.css` 的語意變數（`--bg-0/1/2`、`--surface`、`--stroke`、`--text`、`--muted`、`--faint`、`--green`、`--teal`、`--coral`、`--gold`、`--red`、`--grad-*`、`--radius*`、`--shadow`、`--glow-primary`、`--font-*`）重新對應到 `--motu-*`；body 背景改成奶油底；`.card`／`.btn`／`.pill`／`.section-title` 的外觀改走 Motu。
  - `index.html`：在 `lumina.css` 之後載入 `motu.css`、`motu-skin.css`（最後載入才能蓋過前面）；`theme-color` 改成奶油色。
  - 下載 Inter 800、900 woff2 放進 `vendor/fonts/`（OFL），並補上 `@font-face`。
- **範圍外**：各畫面寫死的顏色（Slice 3–4）、圖示（Slice 2）、動效（Slice 5）、今日／島嶼／健康／設定頁的美化。
- **改動檔案**：`app/styles/motu.css`（新增）、`app/styles/motu-skin.css`（新增）、`index.html`（修改）、`vendor/fonts/inter-800.woff2`、`vendor/fonts/inter-900.woff2`（新增）、`tests/motu-skin.test.js`（新增）
- **設計要點**：Motu 的 layer 規則會被我方未分層的 CSS 蓋過，所以外觀要在 `motu-skin.css`（未分層、最後載入）裡改，不能只靠 `.motu-*` class。
- **UI Slice?**：YES
- **驗收標準**：
  - [x] `motu.css` 與遊戲組原檔的 `motu-contract` 區段逐字相同（測試比對雜湊）
  - [x] `motu.css` 不含 Tailwind preflight（沒有 `@layer base`、沒有 `*, ::before` 全域重設）、不含 `url(`
  - [x] `motu-skin.css` 重新定義了 `lumina.css` 裡**每一個**顏色／圓角／陰影變數（測試逐一比對，漏一個就失敗）
  - [x] 五個分頁都能打開、沒有 console error；範圍外頁面的文字都看得見（實機截圖確認）
- **測試策略**：`tests/motu-skin.test.js` — 讀檔解析 CSS：①雜湊與原檔一致；②沒有 preflight 與 url；③lumina 變數全數被覆寫（邊界：`--grad-*` 這類漸層變數也要涵蓋）；④`motu-skin.css` 不得出現 `--motu-*` 以外的新色值（防止順手自創顏色）。
- **完成定義**：`npm test` 全綠（≥314）＋瀏覽器實機五頁無 console error＋截圖＋slice-reviewer
- **對外介面**：
  - 檔案：`app/styles/motu.css`（遊戲組 `@layer motu-contract` 逐字擷取，提供全部 `--motu-*` token 與 `.motu-*` class；本段 sha256 `443e237c…`）、`app/styles/motu-skin.css`（未分層、`index.html` 最後載入）
  - lumina 語意變數全數改指向 Motu：`--text`→`--motu-color-text`、`--muted`/`--faint`→`--motu-color-text-muted`、`--surface`→白、`--surface-2`/`--bg-2`→沙色、`--stroke`→暖灰線、`--green`→success(海洋青)、`--teal`→primary、`--yellow`→warning(金)、`--red`→danger(珊瑚)、`--frame-ok`→`--motu-color-info`(藍)、`--frame-adjust`→`--motu-fx-campfire-accent`(橘)、`--grad-*`→同色平塗 `linear-gradient`、`--radius`→xl、`--radius-sm`→lg、`--shadow`→`--motu-shadow-sm`、`--glow-primary`→`--motu-shadow-primary`、`--font-body`/`--font-display`→Inter＋中文系統字、`--glass-blur`→0px
  - 元件外觀：`.card` 白卡；`.btn` pill＋深青底白字（小字對比）；`.btn.secondary` 白底深藍字；`.pill` 奶油 chip；`.section-title` Motu label
  - 外殼／範圍外可讀性修補（只修文字消失，不美化）：`.topbar` `.tabbar` `.tab` `.tb-coins` `.toast` `.isl-hint` `.isl-goal` `.isl-sheet` `.isl-place-bar` `.isl-right` `.isl-sheet-x` `.isl-zi` `.trk-rec-grade`
  - 字型：Inter 800/900 `@font-face`（`vendor/fonts/inter-800.woff2`、`inter-900.woff2`）
  - 給下游：後續 Slice 改樣式請寫在 `motu-skin.css` 或各畫面 CSS，**不得改 `motu.css`**（雜湊測試會擋）；`motu-skin.css` 不得出現 `--motu-*` 以外的色值（測試會擋）
  - 已知留給後續：訓練頁金色「最多 N」(`.wk2-coin`/`.wk-rec-coin`) 對比 1.9–2.05 → Slice 3；範圍外頁面金／珊瑚文字 2.05–2.7 → Slice 6
- **審查紀錄**：slice-reviewer 第 1 輪 BLOCK（`.isl-right` 深底上的縮放百分比看不見）→ 修正後複審 PASS（2026-09-24）
- **依賴**：無
- **平行組**：獨立

### [x] Slice 2 — 建立 Lucide 圖示模組
- **目標**：程式碼可以用一行 `icon('coins')` 產生遊戲端同款線條圖示，取代 emoji。
- **範圍內**：
  - 新增 `app/ui/icons.js`：放入 Slice 3–4 需要的 Lucide 圖示 SVG 路徑（先盤點 `workout.js` 裡當圖示用的 emoji，約 40 種，一種對一個 Lucide 名稱），檔頭寫 ISC 授權與 Lucide 版本。
  - `icon(name, { size, label })` 回傳 SVG 字串：`stroke="currentColor"`、`stroke-width="2"`、`fill="none"`；沒有 label 時加 `aria-hidden="true"`，有 label 時加 `role="img"` 與 `aria-label`；名稱不存在時回傳同尺寸的空白佔位並 `console.warn`，不拋錯。
  - emoji → Lucide 對照表寫在檔內註解，給 Slice 3–4 查。
- **範圍外**：把畫面上的 emoji 換掉（Slice 3–4）。
- **改動檔案**：`app/ui/icons.js`（新增）、`tests/icons.test.js`（新增）
- **設計要點**：尺寸只允許 token（16／18／20／24），不接受任意值。
- **UI Slice?**：NO（純函式）
- **驗收標準**：
  - [x] 對照表涵蓋 `workout.js` 裡所有當圖示用的 emoji（測試掃描原始碼比對）
  - [x] 未知名稱不拋錯、回傳佔位
  - [x] 無 label 必有 `aria-hidden`，有 label 必有 `aria-label`
  - [x] 每個圖示都是 24×24 viewBox、stroke 2
- **測試策略**：`tests/icons.test.js` — 正常輸出、size 非 token 值時退回 18（邊界）、未知名稱、aria 屬性、對照表涵蓋率。
- **完成定義**：`npm test` 全綠＋slice-reviewer
- **對外介面**：
  - 模組 `app/ui/icons.js`（Lucide v1.47.0，ISC，48 個圖示）：
    - `icon(name, { size?, label? }) → string`：SVG 字串，`class="icon"`、24×24 viewBox、stroke 2、`currentColor`；`size` 只收 `16/18/20/24`，其他退回 18；無 label → `aria-hidden="true"`，有 label → `role="img"`＋`aria-label`（已跳脫）；未知名稱 → 同尺寸空白 SVG＋`console.warn`，不拋錯
    - `iconForEmoji(emoji) → string | null`：忽略 U+FE0F
    - `EMOJI_ICON`：emoji（不含 FE0F）→ Lucide 名稱，涵蓋 workout.js 註解以外全部 48 種 emoji，每項附用途註解
    - `ICONS`：名稱 → SVG 形狀字串；`ICON_SIZES = [16, 18, 20, 24]`
  - 給下游：新增圖示請從同版本 lucide-static `icon-nodes.json` 取形狀，不要手畫；`tests/icons.test.js` 會掃描 workout.js，Slice 3–4 若新增 emoji 會失敗（本來就不該新增）
  - 需使用者留意：幾個動作的圖示是語意近似選擇（深蹲→`arrow-down-to-line`、仰臥起坐→`chevrons-up`、捲腹→`shrink`、動作品質很棒 👏→`award`），Lucide 沒有對應的人體動作圖示
- **審查紀錄**：slice-reviewer 第 1 輪 PASS（2026-09-24；獨立比對 48 個形狀與官方 icon-nodes.json 逐字相符）
- **依賴**：無
- **平行組**：獨立

### [ ] Slice 3 — 訓練頁非相機畫面換成 Motu 樣式
- **目標**：動作清單、動作說明、暖身、倒數、結算、領取獎勵六個畫面，截圖出來和遊戲端是同一個產品。
- **範圍內**：`workout.css` 中這六個畫面相關選擇器的寫死色換成 token；`workout.js` 對應 render 函式（`renderMenu`、`renderIntro`、`runWarmup`、`runCountdown`、`renderResult`、`renderReward`、`gameResourceCard`）的 emoji 換成 `icon()`；獎勵卡改用 `.motu-reward` 的視覺語言（金色只當底色／圖示，數字用深藍）。
- **範圍外**：相機即時判定畫面與組間休息（Slice 4）；任何文案語意、流程、按鈕行為。
- **改動檔案**：`app/features/workout/workout.css`（修改）、`app/features/workout/workout.js`（修改）、`tests/game-resource-card.test.js`（修改：追加斷言）
- **設計要點**：遵守對比規則（文字只用深藍／深藍淡／深青）；評級環 S/A/B/C 的色彩改由 Motu 色票對應，仍保留字母。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 六個畫面沒有任何 emoji 圖示（語音稿與說明文字內容不動）
  - [ ] 六個畫面沒有深色玻璃殘留（實機截圖）
  - [ ] 文字對比全部 ≥4.5:1（大數字 ≥3:1）
  - [ ] 流程從清單走到領取獎勵，功能與原本相同
- **測試策略**：`tests/game-resource-card.test.js` 追加：輸出含 `<svg`、不含 emoji（先失敗→再通過）；邊界：碎片與抽獎券皆為 0 時仍不渲染。
- **完成定義**：`npm test` 全綠＋實機截圖六張＋slice-reviewer
- **對外介面**：
- **依賴**：Slice 1、Slice 2
- **平行組**：獨立

### [ ] Slice 4 — 相機即時判定畫面與組間休息換成 Motu 樣式
- **目標**：訓練中全螢幕畫面（HUD 數字、深度量表、提示條、取景與光線提示、暫停／結束按鈕、組間休息）換成遊戲端視覺，而且疊在任何相機影像上都讀得清楚。
- **範圍內**：`lv-*` 系列選擇器與休息畫面的寫死色換成 token；HUD 磚改為白 92% 底＋`--motu-shadow-md`＋深藍字；按鈕改 Motu；該區 emoji 換成 `icon()`；`workout.js` 內 HUD 相關的寫死色。
- **範圍外**：骨架疊圖的判定色（不變量 2）；深度量表的語意顏色（`gaugeColor` 不動）；任何判定邏輯。
- **改動檔案**：`app/features/workout/workout.css`（修改）、`app/features/workout/workout.js`（修改）、`app/ui/feedback.js`（僅限非判定用的裝飾色，若有）、`tests/display-colors.test.js`（修改：追加鎖定斷言）、`tests/ui-no-emoji.test.js`（新增）
- **設計要點**：HUD 不用半透明玻璃；最小觸控目標 44px；計時與次數用等寬數字。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] `PALETTES` 三套配色數值與換皮前完全相同（測試鎖定）
  - [ ] `workout.js` 在註解以外沒有任何 emoji
  - [ ] 分別在亮背景與暗背景的相機畫面（或示範模式）截圖，HUD 文字都清楚
  - [ ] 示範模式能完整跑完一組並進到結算
- **測試策略**：`tests/display-colors.test.js` 追加 `PALETTES` 快照斷言（先寫好，換皮過程中若誤改就會失敗）；`tests/ui-no-emoji.test.js` 掃描 `workout.js`（去掉註解）不得含 emoji（先失敗→本 Slice 完成後通過）；邊界：語音用的純文字常數若含 emoji 也算違規。
- **完成定義**：`npm test` 全綠＋亮／暗背景各一張實機截圖＋slice-reviewer
- **對外介面**：
- **依賴**：Slice 1、Slice 2、Slice 3
- **平行組**：獨立

### [ ] Slice 5 — 微互動與動效對齊 Motu
- **目標**：按鈕按壓、卡片 hover、進場、數字跳動的節奏和遊戲端一致。
- **範圍內**：訓練頁的 transition／animation 改用 `--motu-duration-*`、`--motu-ease-*`；按壓 `scale(.98)`；`focus-visible` 外框用 `--motu-color-focus`；進場 stagger 30–50ms；可領取狀態用 `.motu-is-claimable` 的脈動；全部在 `prefers-reduced-motion` 下關閉。
- **範圍外**：新增任何動畫種類以外的功能；範圍外頁面。
- **改動檔案**：`app/features/workout/workout.css`（修改）、`app/styles/motu-skin.css`（修改）、`tests/motu-skin.test.js`（修改）
- **設計要點**：只動 transform／opacity，不動 width／height。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 範圍內 CSS 沒有 `transition`／`animation` 寫死 ms 數（全部走 token）
  - [ ] reduced-motion 下所有動畫停止（實機用 DevTools 模擬）
  - [ ] 所有可點元素都有 `focus-visible` 外框
- **測試策略**：`tests/motu-skin.test.js` 追加：掃描範圍內 CSS 的 `transition`／`animation` 宣告，不得出現寫死的 ms／s 數值（邊界：`0s` 與 reduced-motion 區塊內的 `0.001ms` 例外）。
- **完成定義**：`npm test` 全綠＋實機錄一段按壓與進場＋slice-reviewer
- **對外介面**：
- **依賴**：Slice 3、Slice 4
- **平行組**：獨立

### [ ] Slice 6 — 無障礙與對比收尾，產出企劃書截圖
- **目標**：交出一組可以直接放進企劃書的健身畫面截圖，而且全部通過對比與無障礙檢查。
- **範圍內**：
  - 新增純函式 `contrastRatio(a, b)`，列出範圍內所有「文字色 × 底色」組合並檢查 ≥4.5（大字 ≥3）；修掉不合格的組合。
  - 只有圖示的按鈕補 `aria-label`；觸控目標 ≥44px。
  - 範圍外頁面（今日、島嶼、健康、設定）與外殼只做可讀性檢查，發現文字看不見才修，不美化。
  - 截圖：動作清單、動作說明、倒數、即時判定（示範模式，亮／暗背景）、組間休息、結算、領取獎勵。截圖時隱藏外殼（用 `setChrome(false)` 或裁切），存到 `文件/初審圖/健身端_Motu/`。
- **範圍外**：新功能、文案改寫。
- **改動檔案**：`app/ui/contrast.js`（新增）、`tests/contrast.test.js`（新增）、`app/styles/motu-skin.css`（修改）、`app/features/workout/workout.css`（修改，視檢查結果）、`app/features/workout/workout.js`（修改：aria-label）
- **設計要點**：對比組合清單寫成資料放在測試裡，之後換色時會自動再驗。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 對比測試涵蓋範圍內每一組文字／底色，全部通過
  - [ ] 截圖存到指定資料夾，每張檔名標明畫面名稱
  - [ ] 使用者看過截圖並確認可放進企劃書
- **測試策略**：`tests/contrast.test.js` — `contrastRatio` 的已知值（黑白 21:1、同色 1:1，邊界）；對比組合清單全數達標。
- **完成定義**：`npm test` 全綠＋截圖交付＋使用者確認＋收尾批次審查（Final Validation）
- **對外介面**：
- **依賴**：Slice 1–5
- **平行組**：獨立

