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
- 已完成：1 / 7
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

### [ ] Slice 2 — commitSession 輸出本次碎片與抽獎券
- **目標**：結算結果帶出本次獲得的碎片與抽獎券數量，供遊戲端記帳，健身端不持有餘額。
- **範圍內**：`commitSession()` 回傳的 `session` 物件新增 `shards`、`tickets` 欄位（呼叫 Slice 1 的函式）；一併補上 `xpGain` 欄位以消除 `workout.js:1274` 重複推導 XP 公式的既有脆弱點。
- **範圍外**：**不得**在 `state.wallet` 或任何持久化結構新增碎片／抽獎券欄位（違反不變量 3）；不改 UI。
- **改動檔案**：`app/state/store.js`（修改）、`tests/session-rewards.test.js`（新增）
- **設計要點**：N/A ｜ 純狀態層
- **UI Slice?**：NO
- **驗收標準**：
  - [ ] `commitSession()` 回傳物件含 `shards`、`tickets`、`xpGain` 三個欄位
  - [ ] 連續呼叫兩次後，`getState().wallet` **不存在** shards／tickets 相關鍵（以 `Object.keys` 斷言）
  - [ ] localStorage 序列化結果不含碎片／抽獎券餘額
  - [ ] `xpGain` 與 `wallet.xp` 的實際增量一致
  - [ ] **新增欄位為純追加（additive）**：既有欄位 `id`/`dateISO`/`date`/`exercise`/`exerciseName`/`durationSec`/`validReps`/`invalidReps`/`targetRate`/`coinsEarned`/`grade`/`faults` 的名稱、型別與語意完全不變，以測試逐一斷言（`commitSession()` 回傳值是將來遊戲端依賴的對外契約，改動既有欄位會直接打斷對接）
  - [ ] 既有 123 項測試全數維持通過
- **測試策略**：`tests/session-rewards.test.js` — 回傳欄位完整性、wallet 不受污染（負向斷言）、xpGain 與實際增量一致、零有效次數情境
- **完成定義**：`npm test` 全綠 + 瀏覽器實機結算一次無 console error
- **對外介面**：（施工後回填）
- **依賴**：Slice 1
- **平行組**：獨立（碰 `store.js`，必經 slice-reviewer）

### [ ] Slice 3 — 結算第二幕顯示碎片與抽獎券
- **目標**：使用者在「領取獎勵」畫面能看到本次獲得的四項資源，並理解碎片與抽獎券要去遊戲裡用。
- **範圍內**：於 `renderReward()` 的經驗值卡與島嶼卡之間插入一張資源卡，以 `.pill` 並列顯示碎片與抽獎券；附一行說明文字點出「於島嶼遊戲中使用」；**數量皆為 0 時整張卡不顯示**（與追蹤頁「0 與未發生是兩件事」的既有原則一致）。
- **範圍外**：不改金幣卡與經驗值卡的既有版面；不加新動畫（沿用既有 `.stagger`）；不改主畫面（碎片與抽獎券不得常駐顯示）。
- **改動檔案**：`app/features/workout/workout.js`（修改）、`app/features/workout/workout.css`（修改）
- **設計要點**：沿用 `.card` + `.pill`；視覺權重低於金幣卡與經驗值卡（不用大數字、不用 countUp）；數字使用等寬字形；emoji 作圖示以符合全站慣例；深色底對比需達 4.5:1
- **UI Slice?**：YES（設計決策已定於上方「設計顧問輸入」，不再重新調用 ui-ux-pro-max）
- **驗收標準**：
  - [ ] 碎片或抽獎券任一 > 0 時，資源卡出現在經驗值卡與島嶼卡之間
  - [ ] 兩者皆為 0 時整張卡不渲染（DOM 中不存在該節點）
  - [ ] 說明文字讓使用者知道這兩項要在遊戲中使用
  - [ ] 開啟「減少動態效果」時版面正常、無殘留動畫
  - [ ] 主畫面（今日／島嶼／追蹤）**沒有**出現碎片或抽獎券
- **測試策略**：以既有 DOM 測試風格驗證模板函式：>0 時含對應節點、皆為 0 時不含；主畫面模板不含碎片字樣（負向斷言）
- **完成定義**：`npm test` 全綠 + 瀏覽器實機走完一次訓練結算，肉眼確認版面
- **對外介面**：（施工後回填）
- **依賴**：Slice 2
- **平行組**：獨立

### [ ] Slice 4 — 難度設定接線至訓練量
- **目標**：設定頁的「簡單／普通／困難」真的會改變訓練內容，消滅「按了沒反應」。
- **範圍內**：新增 `app/core/difficulty.js` 純函式，依 `prefs.difficulty` 調整動作的組數／每組次數／休息秒數（以各動作 `meta.sets`/`repsPerSet`/`restSec` 為基準值）；`workout.js` 讀取設定套用；簡介頁顯示的數字須與實際流程一致。
- **範圍外**：**絕對不得**改動任何判定門檻、角度閾值、深度閾值（違反不變量 4）；不改設定頁 UI（UI 已存在）。
- **改動檔案**：`app/core/difficulty.js`（新增）、`app/features/workout/workout.js`（修改）、`tests/difficulty.test.js`（新增）
- **設計要點**：N/A ｜ 純邏輯 + 既有 UI 接線
- **UI Slice?**：NO
- **驗收標準**：
  - [ ] 三個難度各自產生不同的組數／次數／休息秒數，且 easy < normal < hard 的訓練量單調遞增
  - [ ] 產生值皆為正整數，不因基準值缺漏而回傳 NaN／0／undefined
  - [ ] 未知或缺失的 difficulty 值回退為 normal
  - [ ] 簡介頁顯示的組數與次數與實際執行流程一致
  - [ ] **判定門檻未被更動**：以測試斷言引擎在三種難度下對同一組骨架序列的判定結果完全相同
- **測試策略**：`tests/difficulty.test.js` — 三難度單調性、未知值回退、邊界（基準值缺漏）、**門檻不變性**（同一輸入在三難度下 validReps 相同）
- **完成定義**：`npm test` 全綠 + 實機切換三種難度確認簡介頁數字與流程一致
- **對外介面**：（施工後回填）
- **依賴**：無
- **平行組**：獨立

### [ ] Slice 5 — 雙倍金幣卡介面（遊戲端只能宣告使用，倍率由健身端定義）
- **目標**：遊戲端能宣告使用一張已持有的功能卡，使下一次結算金幣加倍，而金幣仍全數由結算函式產出。
- **範圍內**：`store` 新增 `consumeBoost()`，寫入一個一次性旗標（需持久化，跨重整有效）；`commitSession()` 於計算金幣時套用倍率後清除旗標；倍率上限與生效次數**寫死於健身端**，呼叫端不得傳入數值。
- **範圍外**：不新增任何直接加幣方法（違反不變量 1）；不做遊戲端的卡片持有數管理（那在遊戲端）；不做 UI。
- **改動檔案**：`app/state/store.js`（修改）、`tests/boost.test.js`（新增）
- **設計要點**：N/A ｜ 純狀態層
- **UI Slice?**：NO
- **驗收標準**：
  - [ ] `consumeBoost()` 不接受任何倍率參數；倍率為模組內常數
  - [ ] 套用後**只對下一次**結算生效，該次結算後旗標自動清除
  - [ ] 重複呼叫 `consumeBoost()` 不會疊加（第二次回傳 false 或維持單倍）
  - [ ] 未使用功能卡時，金幣計算結果與現況完全相同（回歸保護）
  - [ ] 旗標經 localStorage 持久化，重整後仍有效
  - [ ] store 對外介面仍**不存在**任何可直接增加金幣的方法（以 `Object.keys(store)` 斷言）
- **測試策略**：`tests/boost.test.js` — 加倍生效、只生效一次、不可疊加、未使用時的回歸、持久化後仍有效、介面無加值方法（負向斷言）
- **完成定義**：`npm test` 全綠
- **對外介面**：（施工後回填）
- **依賴**：無（但與 Slice 2 同碰 `store.js`，須序列執行）
- **平行組**：獨立（碰 `store.js`，必經 slice-reviewer）

### [ ] Slice 6 — 補齊 docs/CONTRACTS.md 的模組與 store API 契約
- **目標**：遊戲組拿到這份文件就能把島嶼模組接上，不必問我方任何一句話。
- **範圍內**：於 `docs/CONTRACTS.md` 寫入 feature 模組契約 `{ id, label, icon, mount(root, ctx), unmount(), onShow? }`、`ctx` 提供的內容、store 對外可用 API 全表（含 Slice 2 的結算輸出與 Slice 5 的 `consumeBoost()`）、以及**明文禁止事項**（不得自行保存金幣副本、不得繞過 `commitSession()`、碎片與抽獎券不得回流）。
- **範圍外**：不改任何程式碼。
- **改動檔案**：`docs/CONTRACTS.md`（修改）
- **設計要點**：N/A ｜ 純文件
- **UI Slice?**：NO
- **驗收標準**：
  - [ ] 五個分頁模組的契約簽名與 `app/main.js` 實際實作逐字一致
  - [ ] store API 表中每一個方法都能在 `store.js` 中找到對應實作（無虛構方法）
  - [ ] 明列遊戲端**不可**做的事，並各附一句理由
  - [ ] 標明 three.js 版本需求（我方 r161）
- **測試策略**：文件型 Slice，以人工逐項比對程式碼為驗收；不新增自動化測試
- **完成定義**：文件與程式碼逐項核對無出入
- **對外介面**：（施工後回填）
- **依賴**：Slice 2、Slice 5（需寫入其產出的介面）
- **平行組**：獨立

### [ ] Slice 7 — 島嶼分頁可替換開關
- **目標**：遊戲組的模組一交付，改一處設定即可切換，且我方版本保留為備援。
- **範圍內**：`app/main.js` 的 `FEATURES` 註冊改為可切換來源；保留現行島嶼模組為備援；切換點集中於單一常數並加註解說明如何替換。
- **範圍外**：不實作遊戲端模組本身；不改島嶼模組的內部邏輯；不改其餘四個分頁。
- **改動檔案**：`app/main.js`（修改）
- **設計要點**：N/A ｜ 純結構
- **UI Slice?**：NO
- **驗收標準**：
  - [ ] 切換常數後，島嶼分頁載入另一個模組，其餘四個分頁完全不受影響
  - [ ] 備援模組仍可用，切回無殘留狀態
  - [ ] 指定的模組不存在時有明確的失敗訊息，不是整個 App 白畫面
  - [ ] 既有測試全綠
- **測試策略**：驗證註冊表解析邏輯（指定存在／不存在的模組），以及五個分頁 id 完整性
- **完成定義**：`npm test` 全綠 + 實機切換五個分頁皆正常
- **對外介面**：（施工後回填）
- **依賴**：Slice 6（契約先定稿，實作才有依據）
- **平行組**：獨立（碰共用檔 `main.js`，必經 slice-reviewer）

<!-- cross-model-review: APPROVED reviewer=ollama-qwen2.5-coder-14b hash=628bd17fdcaf795e at=2026-08-27T17:58:21+08:00 -->
