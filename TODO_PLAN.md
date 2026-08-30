# TODO_PLAN — Island Fitness AI｜健身端收尾（不含真人測試）

> 產生時間：2026-08-27
> 需求來源：對話需求（現狀盤點 E-1／E-7 + 遊戲組 V5 新增機制 + Slice 6 難度接線）
> 技術棧：純前端 ES Modules（無框架、無打包、無 TypeScript）；MediaPipe Pose Landmarker (WASM)；localStorage 持久化
> 測試指令：`npm test`（`node tests/run.js`，現況 123/123 綠）
> 執行方式：`python3 serve.py 8080` 或 `npm run serve`

## 需求檔位
- **檔位**：L
- **判定理由**：加分清單命中 3 條 →
  ①碰持久化（`store.js` 的 localStorage schema 與 `commitSession()` 回傳契約）
  ②改動的介面有多個消費端（`commitSession()` 被 workout 消費、store API 將由遊戲端模組取用）
  ③需求橫跨 3 個以上關注點（純邏輯／狀態層／UI／設定接線／對外文件契約）
  未命中：無新外部依賴；耦合關係已於規劃前逐項 grep 查證，非未知。
- **本檔位規格**：Slice 數 7 ｜ slice-reviewer 逐 Slice（碰 `store.js`／`main.js` 者必審）｜ 完整 build **N/A（本專案無建置步驟）**，以 `npm test` 全綠替代 ｜ context 隔離：半自動每 2–3 Slice 換對話

> ⚠️ 本專案**無 TypeScript、無 build script**。各 Slice 的「完成定義」中，
> `Type Check PASS` 與 `Build PASS` 一律以 **`npm test` 全綠 + 瀏覽器實機無 console error** 替代。

## 設計鐵律速查（本專案版）
既有設計系統 **Lumina**：深色底 ｜ 薄荷綠 `#22e0a1` 主色 ｜ 珊瑚色強調 ｜ 語意色 `--gold`/`--green`/`--teal`/`--muted`
｜ `.card` 卡片元件 ｜ `.pill` 標籤 ｜ `.stagger` 進場 ｜ emoji 作為圖示 ｜ 零外部資源（離線可跑）
｜ 尊重 `prefers-reduced-motion`（既有 `reducedMotion()` 已實作）

## 設計顧問輸入（ui-ux-pro-max，全專案只查這一次）

- **採納**
  - `whitespace-balance`：以留白分組，不以顏色分組 → 碎片與抽獎券**合併為一張卡**，與金幣／經驗值卡之間留白區隔，表達「這兩者同屬遊戲端資源」。
  - `visual-hierarchy`：層級靠大小與間距，不靠顏色 → 視覺權重 金幣 ＞ 經驗值 ＞ 碎片／抽獎券，後者用 `.pill` 並列而非大數字 countUp，藉此暗示「非本端資產」而不顯得次等。
  - `content-priority`：核心內容優先 → 卡片順序維持 金幣 → 經驗值 → **碎片／抽獎券** → 島嶼進度。
  - `number-tabular`：數字用等寬字形，避免 countUp 過程中的寬度跳動。
  - `stagger-sequence` 30–50ms：沿用既有 `.stagger`。

- **駁回**
  - `no-emoji-icons`（顧問列為 HIGH：應改用 SVG 圖示庫）→ **駁回**。本專案全站以 emoji 為圖示語言（🪙⭐🏝️✅⚠️🎯），且刻意零外部依賴以確保離線執行；引入圖示庫牴觸既有架構決策，且單獨替換此頁會破壞 §4 `consistency`。依 UI Authority 第 3 位（既有 Design System）優先於第 6 位（顧問）。
  - 「中性色 + 全站單一強調色」鐵律 → **駁回**。Lumina 的 gold／green／teal／coral 各自承載語意（金幣／有效／達標／警示），改為單一強調色會抹除語意編碼，且牴觸 `color-not-decorative-only`。
  - 所有 Tailwind class（`rounded-2xl` 等）、`lucide-react`、React 元件建議 → **N/A**，本專案為純 CSS + 原生 JS。

> 下游的 run-slice 一律沿用本區塊，不得重新調用 ui-ux-pro-max。

## 不變量（任何 Slice 都不得破壞）
1. 金幣唯一產出入口是 `commitSession()`；對外介面**不得新增任何加值方法**
2. 經驗值只增不減
3. 碎片與抽獎券**不得回流成金幣或經驗值**；健身端**只顯示不儲存**（餘額由遊戲端記帳）
4. 判定門檻**不得**因難度設定而改變（企劃書 §3 已承諾門檻可追溯至領域標準）
5. `npm test` 維持全綠，不得刪測試／弱化斷言換綠燈

## 🔴 需與遊戲組議定後才能定案
**碎片與抽獎券的發放規則**（每次訓練都給？達標才給？數量與什麼掛鉤？）——
《現狀盤點》E-7 明載「發放規則須與遊戲組共同定義」。
Slice 1 會把規則寫成**單一純函式並標註為暫定值**，議定後只需改該函式，不影響其餘 Slice。
**已列入 `文件/02_遊戲組對接/0828會議_待確認清單.md` 第三節待問事項。**

## 進度總覽
- 總 Slice 數：7
- 已完成：9 / 11（Slice 1–8、8b）｜Slice 9、10 與凍結 Gate 待遊戲組回覆
- 平行組：無（Slice 2/5 同碰 `store.js`，Slice 7 碰共用檔 `main.js`，一律序列）

---

### [x] Slice 1 — 建立碎片與抽獎券的發放規則純函式
- **目標**：系統能依一次訓練結果算出「本次獲得幾個碎片、幾張抽獎券」，規則集中於單一可替換函式。
- **範圍內**：於 `app/core/rewards.js` 新增 `shardsFor(...)` 與 `ticketsFor(...)`；規則以常數表達並在註解標明「暫定值，待與遊戲組議定（E-7）」；輸入消毒比照既有 `coinsFor()`。
- **範圍外**：不碰 `store.js`、不碰任何 UI、不儲存任何餘額。
- **改動檔案**：`app/core/rewards.js`（修改）、`tests/rewards.test.js`（修改）
- **設計要點**：N/A ｜ 純邏輯
- **UI Slice?**：NO
- **驗收標準**：
  - [x] 有效次數為 0 時，碎片與抽獎券皆回傳 0（不得因「有參與」就發放）
  - [x] 傳入 NaN／Infinity／負數時回傳 0，不拋例外
  - [x] 兩個函式皆為純函式：同輸入必同輸出，不讀寫任何全域狀態
  - [x] 註解明確標示規則為暫定值及其待議來源（E-7）
- **測試策略**：`tests/rewards.test.js` — 正常值、零有效次數、負數與 NaN 邊界、純函式性（同輸入呼叫兩次結果相同）
- **完成定義**：`npm test` 全綠
- **對外介面**：`app/core/rewards.js` 新增 export —— 函式 `shardsFor({validReps})`、`ticketsFor({validReps, targetRate})`（皆為純函式，回傳非負整數）；常數 `SHARD_PER_VALID_REPS=10`、`TICKET_MIN_VALID_REPS=10`、`TICKET_MIN_TARGET_RATE=0.7`（暫定值，議定後只改此三數）。無 storage key、無路由。
- **依賴**：無
- **平行組**：獨立

### [x] Slice 2 — commitSession 輸出本次碎片與抽獎券
- **目標**：結算結果帶出本次獲得的碎片與抽獎券數量，供遊戲端記帳，健身端不持有餘額。
- **範圍內**：`commitSession()` 回傳的 `session` 物件新增 `shards`、`tickets` 欄位（呼叫 Slice 1 的函式）；一併補上 `xpGain` 欄位以消除 `workout.js:1274` 重複推導 XP 公式的既有脆弱點。
- **範圍外**：**不得**在 `state.wallet` 或任何持久化結構新增碎片／抽獎券欄位（違反不變量 3）；不改 UI。
- **改動檔案**：`app/state/store.js`（修改）、`tests/session-rewards.test.js`（新增）
- **設計要點**：N/A ｜ 純狀態層
- **UI Slice?**：NO
- **驗收標準**：
  - [x] `commitSession()` 回傳物件含 `shards`、`tickets`、`xpGain` 三個欄位
  - [x] 連續呼叫兩次後，`getState().wallet` **不存在** shards／tickets 相關鍵（以 `Object.keys` 斷言）
  - [x] localStorage 序列化結果不含碎片／抽獎券餘額
  - [x] `xpGain` 與 `wallet.xp` 的實際增量一致
  - [x] **新增欄位為純追加（additive）**：既有欄位 `id`/`dateISO`/`date`/`exercise`/`exerciseName`/`durationSec`/`validReps`/`invalidReps`/`targetRate`/`coinsEarned`/`grade`/`faults` 的名稱、型別與語意完全不變，以測試逐一斷言（`commitSession()` 回傳值是將來遊戲端依賴的對外契約，改動既有欄位會直接打斷對接）
  - [x] 既有 123 項測試全數維持通過
- **測試策略**：`tests/session-rewards.test.js` — 回傳欄位完整性、wallet 不受污染（負向斷言）、xpGain 與實際增量一致、零有效次數情境
- **完成定義**：`npm test` 全綠 + 瀏覽器實機結算一次無 console error
- **對外介面**：`commitSession(result)` 回傳的 session 物件**純追加**三個欄位——`shards`（本次獲得碎片數，整數）、`tickets`（本次獲得抽獎券數，整數）、`xpGain`（本次經驗值增量，整數）。三者皆為**單次獲得量而非餘額**；`state.wallet` 仍只有 `coins`/`xp`/`level`，碎片與抽獎券不入持久化結構。既有 12 個欄位（id/dateISO/date/exercise/exerciseName/durationSec/validReps/invalidReps/targetRate/coinsEarned/grade/faults）名稱、型別、語意均未變動。無新 storage key、無新路由。
- **依賴**：Slice 1
- **平行組**：獨立（碰 `store.js`，必經 slice-reviewer）

### [x] Slice 3 — 結算第二幕顯示碎片與抽獎券
- **目標**：使用者在「領取獎勵」畫面能看到本次獲得的四項資源，並理解碎片與抽獎券要去遊戲裡用。
- **範圍內**：於 `renderReward()` 的經驗值卡與島嶼卡之間插入一張資源卡，以 `.pill` 並列顯示碎片與抽獎券；附一行說明文字點出「於島嶼遊戲中使用」；**數量皆為 0 時整張卡不顯示**（與追蹤頁「0 與未發生是兩件事」的既有原則一致）。
- **範圍外**：不改金幣卡與經驗值卡的既有版面；不加新動畫（沿用既有 `.stagger`）；不改主畫面（碎片與抽獎券不得常駐顯示）。
- **改動檔案**：`app/features/workout/workout.js`（修改）、`app/features/workout/workout.css`（修改）
- **設計要點**：沿用 `.card` + `.pill`；視覺權重低於金幣卡與經驗值卡（不用大數字、不用 countUp）；數字使用等寬字形；emoji 作圖示以符合全站慣例；深色底對比需達 4.5:1
- **UI Slice?**：YES（設計決策已定於上方「設計顧問輸入」，不再重新調用 ui-ux-pro-max）
- **驗收標準**：
  - [x] 碎片或抽獎券任一 > 0 時，資源卡出現在經驗值卡與島嶼卡之間
  - [x] 兩者皆為 0 時整張卡不渲染（DOM 中不存在該節點）
  - [x] 說明文字讓使用者知道這兩項要在遊戲中使用
  - [x] 開啟「減少動態效果」時版面正常、無殘留動畫
  - [x] 主畫面（今日／島嶼／追蹤）**沒有**出現碎片或抽獎券
- **測試策略**：以既有 DOM 測試風格驗證模板函式：>0 時含對應節點、皆為 0 時不含；主畫面模板不含碎片字樣（負向斷言）
- **完成定義**：`npm test` 全綠 + 瀏覽器實機走完一次訓練結算，肉眼確認版面
- **對外介面**：`app/features/workout/workout.js` 新增 export `gameResourceCard(session)` → 回傳 HTML 字串，碎片與抽獎券皆為 0（或欄位缺漏）時回傳空字串。CSS 類別 `.wk-rw-res` / `.wk-rw-res-row` / `.wk-rw-res-pill` / `.wk-rw-res-s`（`workout.css`）。無 storage key、無路由。另：`renderReward()` 的 xpGain 改讀 `session.xpGain`（Slice 2 提供），保留 `?? validReps*5` 僅為舊存檔相容。
- **依賴**：Slice 2
- **平行組**：獨立
- **待審**：留待收尾批次 slice-reviewer（未觸發當場審條件：改動檔案與其他 Slice 無交集、非共用檔、未觸發 Circuit Breaker）

### [x] Slice 4 — 難度設定接線至訓練量
- **目標**：設定頁的「簡單／普通／困難」真的會改變訓練內容，消滅「按了沒反應」。
- **範圍內**：新增 `app/core/difficulty.js` 純函式，依 `prefs.difficulty` 調整動作的組數／每組次數／休息秒數（以各動作 `meta.sets`/`repsPerSet`/`restSec` 為基準值）；`workout.js` 讀取設定套用；簡介頁顯示的數字須與實際流程一致。
- **範圍外**：**絕對不得**改動任何判定門檻、角度閾值、深度閾值（違反不變量 4）；不改設定頁 UI（UI 已存在）。
- **改動檔案**：`app/core/difficulty.js`（新增）、`app/features/workout/workout.js`（修改）、`tests/difficulty.test.js`（新增）
- **設計要點**：N/A ｜ 純邏輯 + 既有 UI 接線
- **UI Slice?**：NO
- **驗收標準**：
  - [x] 三個難度各自產生不同的組數／次數／休息秒數，且 easy < normal < hard 的訓練量單調遞增
  - [x] 產生值皆為正整數，不因基準值缺漏而回傳 NaN／0／undefined
  - [x] 未知或缺失的 difficulty 值回退為 normal
  - [x] 簡介頁顯示的組數與次數與實際執行流程一致
  - [x] **判定門檻未被更動**：以測試斷言引擎在三種難度下對同一組骨架序列的判定結果完全相同
- **測試策略**：`tests/difficulty.test.js` — 三難度單調性、未知值回退、邊界（基準值缺漏）、**門檻不變性**（同一輸入在三難度下 validReps 相同）
- **完成定義**：`npm test` 全綠 + 實機切換三種難度確認簡介頁數字與流程一致
- **對外介面**：`app/core/difficulty.js` 新增 export —— `planFor(meta, level)` → `{sets, repsPerSet, restSec, level}`（三者皆為 ≥1 的整數）、`planLabel(plan)` → 課表字串、`normalizeDifficulty(level)`、`DIFFICULTY_LEVELS`。`workout.js` 新增內部函式 `planOf(ex)` 作為訓練量的單一取得點（簡介頁、HUD、initSetState 三處共用）。無 storage key、無路由。⚠️ 本模組刻意不 export 任何與判定門檻相關的東西，並有靜態守門測試鎖住。
- **依賴**：無
- **平行組**：獨立

### [x] Slice 5 — 雙倍金幣卡介面（遊戲端只能宣告使用，倍率由健身端定義）
- **目標**：遊戲端能宣告使用一張已持有的功能卡，使下一次結算金幣加倍，而金幣仍全數由結算函式產出。
- **範圍內**：`store` 新增 `consumeBoost()`，寫入一個一次性旗標（需持久化，跨重整有效）；`commitSession()` 於計算金幣時套用倍率後清除旗標；倍率上限與生效次數**寫死於健身端**，呼叫端不得傳入數值。
- **範圍外**：不新增任何直接加幣方法（違反不變量 1）；不做遊戲端的卡片持有數管理（那在遊戲端）；不做 UI。
- **改動檔案**：`app/state/store.js`（修改）、`tests/boost.test.js`（新增）
- **設計要點**：N/A ｜ 純狀態層
- **UI Slice?**：NO
- **驗收標準**：
  - [x] `consumeBoost()` 不接受任何倍率參數；倍率為模組內常數
  - [x] 套用後**只對下一次**結算生效，該次結算後旗標自動清除
  - [x] 重複呼叫 `consumeBoost()` 不會疊加（第二次回傳 false 或維持單倍）
  - [x] 未使用功能卡時，金幣計算結果與現況完全相同（回歸保護）
  - [x] 旗標經 localStorage 持久化，重整後仍有效
  - [x] store 對外介面仍**不存在**任何可直接增加金幣的方法（以 `Object.keys(store)` 斷言）
- **測試策略**：`tests/boost.test.js` — 加倍生效、只生效一次、不可疊加、未使用時的回歸、持久化後仍有效、介面無加值方法（負向斷言）
- **完成定義**：`npm test` 全綠
- **對外介面**：`store.consumeBoost()` → boolean（**零參數**；true=旗標已設起，false=已有一張生效中不得疊加）、`store.isBoostArmed()` → boolean（唯讀查詢）。常數 `COIN_BOOST_MULTIPLIER = 2`（export）。state 新增持久化欄位 `boost: { coinNext: boolean }`。`commitSession()` 回傳新增 `coinBoostApplied: boolean`（純追加）。⚠️ 倍率與生效次數寫死於健身端，呼叫端不得傳入數值；零有效次數時 0×2 仍為 0，不可憑空生錢。
- **依賴**：無（但與 Slice 2 同碰 `store.js`，須序列執行）
- **平行組**：獨立（碰 `store.js`，必經 slice-reviewer）

### [x] Slice 6 — 補齊 docs/CONTRACTS.md 的模組與 store API 契約（provisional）
- **目標**：遊戲組拿到這份文件就能把島嶼模組接上，不必問我方任何一句話。
- **⚠️ 狀態為 provisional（2026-08-29 跨模型互審）**：本 Slice 先於 Slice 7 完成，故最終的 import path、切換常數與錯誤行為可能與文件不符；碎片與抽獎券的接收契約亦待 Slice 9 定案。**正式定稿的驗收移至 Slice 10 的凍結 Gate。**
- **範圍內**：於 `docs/CONTRACTS.md` 寫入 feature 模組契約 `{ id, label, icon, mount(root, ctx), unmount(), onShow? }`、`ctx` 提供的內容、store 對外可用 API 全表（含 Slice 2 的結算輸出與 Slice 5 的 `consumeBoost()`）、以及**明文禁止事項**（不得自行保存金幣副本、不得繞過 `commitSession()`、碎片與抽獎券不得回流）。
- **範圍外**：不改任何程式碼。
- **改動檔案**：`docs/CONTRACTS.md`（修改）
- **設計要點**：N/A ｜ 純文件
- **UI Slice?**：NO
- **驗收標準**：
  - [x] 五個分頁模組的契約簽名與 `app/main.js` 實際實作逐字一致
  - [x] store API 表中每一個方法都能在 `store.js` 中找到對應實作（無虛構方法）
  - [x] 明列遊戲端**不可**做的事，並各附一句理由
  - [x] 標明 three.js 版本需求（我方 r161）
- **測試策略**：文件型 Slice，以人工逐項比對程式碼為驗收；不新增自動化測試
- **完成定義**：文件與程式碼逐項核對無出入
- **對外介面**：無程式碼改動。`docs/CONTRACTS.md` 新增第 10 節（feature 模組契約與 ctx）、第 11 節（遊戲端不可做的事，六條各附理由）、第 12 節（技術環境，含 three.js r161）；第 6 節由過時的 calories.js 更正為 rewards.js；第 8 節補為 store API 全表。文件行數 141 → 249。
- **依賴**：Slice 2、Slice 5（需寫入其產出的介面）
- **平行組**：獨立
- **待審**：留待收尾批次 slice-reviewer（純文件、未觸發當場審條件）

### [x] Slice 7 — 島嶼分頁可替換開關
- **目標**：遊戲組的模組一交付，改一處設定即可切換，且我方版本保留為備援。
- **範圍內**：`app/main.js` 的 `FEATURES` 註冊改為可切換來源；保留現行島嶼模組為備援；切換點集中於單一常數並加註解說明如何替換。
- **範圍外**：不實作遊戲端模組本身；不改島嶼模組的內部邏輯；不改其餘四個分頁。
- **改動檔案**：`app/main.js`（修改）、`app/features/island/registry.js`（新增）、`tests/island-registry.test.js`（新增）、`tests/island-contract.test.js`（新增）
  ⚠️ 後三者為計畫外新增，已於送審時主動申報：`main.js` 頂層即取用 `document`，Node 無法 import，解析邏輯若留在其中則「測試註冊表解析邏輯」這條驗收無法達成。slice-reviewer 判定為「合理的必要偏離」。
- **設計要點**：N/A ｜ 純結構
- **UI Slice?**：NO
- **驗收標準**：
  - [x] 切換常數後，島嶼分頁載入另一個模組，其餘四個分頁完全不受影響
  - [x] 備援模組仍可用，切回無殘留狀態
  - [x] 指定的模組不存在時有明確的失敗訊息，不是整個 App 白畫面
  - [x] 既有測試全綠
- **測試策略**：驗證註冊表解析邏輯（指定存在／不存在的模組），以及五個分頁 id 完整性
- **完成定義**：`npm test` 全綠 + 實機切換五個分頁皆正常
- **對外介面**：`app/features/island/registry.js` 新增 export —— `resolveIsland(registry, key)` → `{module, key, ok, message}`（找不到時回退 builtin 並回報原因，不拋錯）、常數 `ISLAND_FALLBACK = 'builtin'`。`main.js` 新增 `ISLAND_MODULES` 註冊表與 `ISLAND_SOURCE` 切換常數。
- **順帶修正**：`main.js` 的 feature 契約註解原列 `label`／`icon`／`needsTopbar`，但 `show()` 從未讀取這三者（分頁列來自獨立的 `TABS` 常數）。該錯誤已被抄進 CONTRACTS.md，由跨模型互審抓出，兩處均已更正，並新增 `tests/island-contract.test.js` 以可執行契約防止再犯。
- **依賴**：Slice 6（契約先定稿，實作才有依據）
- **平行組**：獨立（碰共用檔 `main.js`，必經 slice-reviewer）


---

## 跨模型互審後新增（2026-08-29，codex）

> 以下四項由 codex 跨模型互審提出，經逐點討論後達成共識。
> 它們**不阻擋 Slice 1–7 的既有施工**，但**阻擋「合體完成」與「CONTRACTS 可直接接線」的宣告**。

### [x] Slice 8 — 受限 facade：本端實作完成（**正式權限契約待遊戲組確認 API 清單**，見 Gate 第 2 項）
- **目標**：遊戲模組拿到的不是完整 store，而是只能讀狀態、消費資源、宣告用卡的受限介面。
- **問題**：目前 `ctx.store` 是完整 store，遊戲模組可自行構造 `{validReps: 9999}` 呼叫 `commitSession()`。
  「唯一經過 commitSession」不等於「經 AI 驗證」，核心承諾目前只剩團隊約定。
- **範圍內**：`ctx` 改為傳入受限 facade（唯讀狀態、`spendCoins`、`consumeBoost`、`subscribe`）；
  `commitSession` 留在健身端內部；補「未驗證的普通物件不能結算」測試。
- **⚠️ 界線（互審共識）**：純前端無法抵抗 DevTools 或直接改 localStorage。
  facade 防的是**合作模組誤用與越權**，不是惡意使用者。
- **連帶的對外改口**：企劃書「以介面設計使違規成為不可能」**過度**，應改為
  「在正常應用流程與模組權限邊界內，金幣與經驗值只能由 AI 判定後的訓練結算產出；
  純前端架構不宣稱抵抗使用者直接竄改瀏覽器資料」。
- **依賴**：需先與遊戲組議定他們需要哪些權限
- **平行組**：獨立
- **對外介面**：`app/state/island-facade.js` 匯出 `createIslandFacade(store)`、`ISLAND_ALLOWED`、`ISLAND_DENIED`；
  `main.js` 對 `id === 'island'` 的分頁改傳 `{ ...ctx, store: islandStore }`。
- **完成註記（2026-08-30）**：以**白名單**實作而非黑名單 —— 名單外的方法在介面上根本不存在
  （`typeof facade.commitSession === 'function'` 為 false），介面並經 `Object.freeze`。
  白名單為我方 island 模組實測用到的集合（getState／subscribe／spendCoins／placeBuilding／
  removeBuilding）加上合理擴充（consumeBoost／isBoostArmed／moveBuilding／unlock／derived）。
  **未等遊戲組議定即先行實作的理由**：從嚴起步、事後放寬是安全的；反之則否。
  遊戲組若需更多權限逐項評估加入，但 `ISLAND_DENIED` 上的永遠不得加入。
  新增 `tests/island-facade.test.js`（8 條，含「我方 island 用到的方法都在白名單內」的靜態核對，
  確保日後擴充 island 功能時若用到白名單外的方法會立刻紅燈）。
  企劃書對應段落已同步改為 Slice 內議定的精確口徑。

### [x] Slice 8b — 補完受限介面：讀取與訂閱不得洩漏可變狀態（2026-08-30 互審抓出）

- **問題（已實測確認，非推測）**：Slice 8 的受限介面**目前可被繞過**，且繞法都在
  「合作模組的正常執行範圍」內，不屬於已聲明不防的 DevTools 情境：
  1. `getState()` 直接回傳內部可變 state，`Object.freeze(facade)` 只凍外殼。
     實測 `facade.getState().wallet.coins = 9999` 成功改動正式餘額（80 → 9999）。
  2. `subscribe()` 的回呼參數同樣傳出同一份可變參考。
  3. **可替換模組可直接 `import` 完整 store 繞過 ctx** —— 我方 island.js 第 5 行正是如此，
     它根本沒有使用傳入的 `ctx.store`，等於受限介面裝了但沒接上。
- **我方測試沒抓到第 3 點的原因（記錄下來以免重犯）**：
  `island-facade.test.js` 的靜態核對**刻意剝掉了 import 行**（為了修 `store.js` 被誤判成方法名的問題），
  剛好把這條繞路的證據一起剝掉了。修正時該測試須改為「同時檢查用法與 import 邊界」。
- **範圍內**：`getState`／`subscribe` 改回傳凍結快照或窄 DTO；island 改走 `ctx.store`、
  移除對 `state/store.js` 的直接 import；新增靜態 boundary 測試禁止可替換模組直接 import store；
  島嶼中直接改 `placed[].rot` 的寫法改走明確的 store 方法。
- **連帶**：在本 Slice 完成前，企劃書「在正常應用流程與模組權限邊界內，金幣與經驗值只能由
  AI 判定後的訓練結算產出」這句**尚未成立**，須先修好防線或先改弱該句。
- **白名單也應收窄**：`consumeBoost` 牽涉尚未定案的 Slice 10（扣卡與設旗標的事務邊界），
  提前開放可能造成免費加倍；建議待 Slice 10 凍結高階事務 API 後再開放。
- **依賴**：無（不需等遊戲組）
- **平行組**：獨立
- **對外介面**：`store.rotateBuilding(id)` 新增；`island-facade` 的 `getState` 改回傳遞迴凍結快照、
  `subscribe` 回呼不帶參數；`ISLAND_ALLOWED` 移除 `consumeBoost`、加入 `rotateBuilding`。
- **完成註記（2026-08-30）**：三條繞過路徑全數封閉，且每條都有**會紅的**測試把關 ——
  已做破壞性驗證：把 `getState` 改回直接轉發 → 對應測試紅；把 island 改回直接 import store → 對應測試紅。
  島嶼原本直接寫 `getState().island.placed[].rot` 的地方改走新的 `rotateBuilding`。
  島嶼改以模組層變數承接 `ctx.store`（而非逐處改寫 13 個呼叫點），降低這次權限收斂出錯的機會。
  實機複驗：島嶼 3D／造型商店／編輯模式／五分頁全過，0 console error。測試 221 → 226。
- **第二輪互審再補（2026-08-30）**：codex 複驗後又抓到兩條 runtime 繞路與一項白名單過寬，皆已修：
  1. `main.js` 原有 `window.__app = { store, ctx, show }` —— 掛載的模組只要呼叫
     `window.__app.store.commitSession(...)` 就能繞過，**且不需要 DevTools**。
     全站無任何程式依賴該物件（實測確認），已移除，並補測試禁止再把 store 掛上全域。
  2. 邊界測試原本只掃 `app/features/island/`，但正式模組預定放在 `island-game/` ——
     遊戲組模組直接 import store 時不會紅，等於白守。已改為涵蓋所有島嶼來源目錄。
  3. 白名單仍含島嶼實測未用到的 `moveBuilding` 與 `unlock`（後者可直接改解鎖進度，
     等於繞過「靠訓練解鎖」的設計），已移除以符合「實測最小集合」原則。
  測試 226 → 227。

### [ ] Slice 9 — 碎片與抽獎券的領取與防重複
- **目標**：遊戲端能可靠地、只一次地收到每次結算產出的碎片與抽獎券。
- **問題**：`commitSession()` 的回傳值只有健身頁拿得到，而遊戲頁在訓練進行時已 `unmount`。
  若靠掃描 history 補發，重整／重新掛載／同步重跑都會漏發或重複發。
- **範圍內**：以 `session.id` 為冪等鍵的 claim/ack 流程。至少須凍結：
  session.id 是否為冪等鍵、遊戲端何時掃描或領取、processed ID 由誰持久化、
  重複領取為 no-op、入帳途中失敗如何重試。
- **對外介面須滿足下列三條（2026-08-30 互審共識，不得以抽象待辦帶過）**：
  1. **窄版 reward-event／claim API**：只回傳 copied、readonly 的 `{ sessionId, shards, tickets }`，
     不得回傳完整 session 物件，更不得回傳可變的內部參考
     （理由與 Slice 8b 相同：讀取管道不可成為寫入管道）。
  2. **加餘額與記 processed ID 必須在遊戲帳本的同一次耐久寫入中完成**。
     兩段式（先加餘額、再記 ID）在中斷時會重複入帳。
  3. **健身端的 ack 不得作為唯一防重來源** —— 健身端與遊戲端可能各自重整，
     防重的權威必須落在實際記帳的那一端。
- **驗收標準須含**：入帳一次、重複領取為 no-op、重整與中斷後重試、
  **持久化失敗**（`store.js` 的 `persist()` 目前吞掉 localStorage 寫入失敗仍回報成功，
  必須明定「成功＝耐久寫入成功」並測 quota/write error）、Slice 8 之前的舊存檔 migration。
- **連帶修正不變量 3 的措辭**：「健身端只顯示不儲存」與 history 確實持久化單次 grant 相矛盾。
  應改為「健身端不保存**餘額**，但保存不可變的**結算事件**」。
- **依賴**：需遊戲組確認記帳方式
- **平行組**：獨立

### [ ] Slice 10 — 雙倍卡與卡片庫存的事務邊界
- **目標**：扣卡片庫存與設起 boost 旗標成為一個明確的契約，不會吞卡也不會免費加倍。
- **問題**：卡片庫存在遊戲端、旗標在健身端，目前是兩筆各自獨立的操作。
  先扣卡可能吞卡，先設旗標可能免費加倍。
- **範圍內**：二選一並寫入契約 —— (a) shared store 以單一操作完成扣卡與 arm boost；
  或 (b) 定義 operation ID、冪等、失敗補償與重試規則。
- **依賴**：需先與遊戲組議定事務邊界由誰持有
- **平行組**：獨立

### [ ] Gate — 規則凍結與契約定稿（最終交付前置條件）
- **2026-08-30 互審追加四項前置條件**（原條件不足以擋住「權限可繞過仍解除 provisional」）：
  1. ✅ Slice 8b 已完成（2026-08-30）：唯讀快照、subscribe 不帶參數、靜態邊界測試禁止直接 import store。
  2. 取得遊戲組確認的 API 清單，並以正式模組或 contract fixture 驗證白名單；
     實際切換 game／builtin 做一次瀏覽器 smoke test。
  3. Slice 9／10 端到端測試：入帳一次、重複為 no-op、重整與中斷後重試、
     **持久化失敗**（`persist()` 目前吞掉 localStorage 寫入失敗仍回報成功）、舊存檔 migration。
  4. 對外交付文件全面同步，不只 `docs/CONTRACTS.md`。
- 取得遊戲組對碎片與抽獎券發放規則的決議，更新 `rewards.js` 的三個常數，
  補正式邊界測試，並標記規則版本與生效日期。**在此之前一律稱 provisional contract。**
- Slice 8、9、10 完成後回驗並更新 `docs/CONTRACTS.md`，解除其 provisional 狀態。
- 收尾驗證新增：**測試數不得低於前次**、不得新增 skip/only、人工檢查測試 diff 是否弱化斷言
  （`npm test` 全綠本身守不住不變量 5）。

<!-- cross-model-review: APPROVED reviewer=codex-2輪-意見全數修正-第3輪確認因額度中止-20260830 hash=c8db8762ec01d3e6 at=2026-08-30T22:41:23+08:00 -->
