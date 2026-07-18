# Slice 3 辨識與語音診斷報告（真機測試回報）（2026-07-05）

<!-- cross-model-review: skip（本文件為診斷報告，非實作計畫；修正方案將另立實作計畫送互審） -->

> 觸發：使用者完成 Slice 3 R3 真機測試，回報三個體驗問題——①取景/站位階段顏色語意誤導 ②動作辨識門檻可能過嚴 ③語音提示不完整。
> 本文件**只做診斷與最小修正方向**，不修改任何程式碼、不調門檻、不加語音。所有「app/core 修改」一律先申報、不直接動。
> 依據：`Slice3_R3_驗收報告.md`、`Slice3_R2_R3_迷你實作計畫.md`、`Design_System_收斂版.md`（§三色彩鐵律）、`docs/CONTRACTS.md`（§4 ExerciseSpec/§5 Detector）、`docs/SPEC.md`（§4 判定規格）。

---

## 一、真機測試發現的三個問題

### 問題 1：取景/站位階段顏色語意誤導（已定位根因）

**現況（讀碼確認）**：
- 取景骨架：`waitForFraming` 內 `drawSkeleton(live.ctx, lm, {}, ...)`——**傳空 segments**，`drawSkeleton` 預設色 `COLOR[segments[seg] || 'green']` → **整具骨架畫成綠色**（feedback.js:33）。
- 檢查燈：`.lv-gate-chk.ok` → `color: var(--green)`（workout.css:333）。
- 正式訓練骨架：`handleResult` 用 `res.segments`（引擎每幀產出的紅/黃/綠分段色）。

**混淆點**：取景階段的綠色語意是「**偵測到你了 / 部位入鏡了**」，但**與正式訓練的綠色（動作有效/姿勢正確）用同一個 `--green`**。使用者看到綠色骨架＋綠燈，直覺以為「我的姿勢是對的」，實際上系統只是確認「看得到你、可以開始了」——**兩個階段共用綠色＝語意撞車**。

**分析**：
1. 目前取景階段用了：綠（骨架＋檢查燈 ok 態）、灰（`--faint`，檢查燈未偵測態）。
2. 會混淆的：**綠色**（取景「已偵測」vs 訓練「姿勢正確」完全同色）。
3. 取景階段應改用：**藍/青系**（偵測到、位置合適）、**灰**（尚未偵測）、**橘**（需調整位置）——與訓練三色（紅黃綠）在色相上明確分離。
4. 正式訓練保留：綠=有效/正確、黃=接近/微調、紅=無效/修正（DS §三語意鐵律，一個色都不動）。

**衝擊面**：純視覺語意問題，**不涉判定邏輯**——引擎照常跑，只是取景階段的「呈現色」誤導。修正屬 UI/呈現層（workout.js gate 繪製 + workout.css + 可能新增取景專用 token），**零 app/core**。

---

### 問題 2：動作辨識門檻可能過嚴（需先量測、不猜）

**現況（讀碼確認，以深蹲為例）**：
- `thresholds: { attemptEnter: 0.25, targetEnter: 0.75, readyReturn: 0.20 }`（squat.js）。
- 深度算法：`depth = (hipC.y − kneeY) / legLen`；`progress = norm(depth, −0.5, 0.1)`。
- targetEnter 0.75 反推 → depth ≈ −0.05 → **髖幾乎要低於膝**（接近全蹲）。這對「感覺自己蹲得夠低」的一般使用者可能真的偏深。
- **達標線已存在**：右側深度量表 `#lv-gtarget` 標在 `targetEnter × 100%`（workout.js:380）、`#lv-gfill` 即時填 `res.signal`——理論上使用者「看得到差多少」，但真機回報顯示這個回饋不夠直觀/或門檻真的過嚴。

**三種可能原因（未量測前不下結論）**：
| 假設 | 若成立的現象 | 驗證方式 |
|---|---|---|
| A. 門檻真的過嚴 | 使用者蹲到「感覺很低」時 signal 停在 0.5–0.7（接近但沒破 0.75） | debug 顯示即時 signal 數值 |
| B. 相機角度/腿長估算失真 | signal 與體感不成比例（蹲很低 signal 卻低） | 對照深度量表與實際姿勢 |
| C. 回饋不直觀（門檻其實合理） | signal 有到 0.75 但使用者沒注意到達標線 | 加強達標瞬間的視覺/語音 |

**關鍵紀律**：**在有真實 signal 數據前，不得調門檻**——調 targetEnter 是動 `app/core/exercises/*`（引擎邊界），且會連動攻擊矩陣（放水可能讓半蹲/作弊過關）。正解是**先加 debug 量測**看清楚是 A/B/C 哪一種，再決定。

---

### 問題 3：語音提示不完整（覆蓋盤點）

**現況（讀碼盤點所有 `coach.say/cue`）**：
| 已有語音 | 觸發點 |
|---|---|
| 動作介紹 voiceIntro | 開始前 |
| 取景引導「請站進畫面」「看不到你的膝蓋」 | gate（Slice3 修復新增） |
| 「開始」倒數 | runCountdown |
| 暖身 | runWarmup |
| 組間「第 N 組完成，休息 X 秒」「第 N 組，開始」 | enterRest/enterWork |
| 修正口令 cue（每動作**僅 2 句**：如深蹲 torso_lean/deeper） | handleResult |
| F3 指導「動作再做大一點」 | coachPolicy guide |
| 「最後十秒」「時間到，這組完成」 | checkEndingCues/finishLive |

**缺口**：
1. **無逐次正面確認**：計次成功時只有畫面 `✓ +1`，**沒有語音**（「很好，第 5 下！」之類）——使用者做對了卻沒聽到肯定，強化「不知道有沒有算到」的焦慮。
2. **修正建議太少**：每動作只有 2 句 cue，涵蓋不到「深度不足/速度太快/重心不穩」等常見狀況。
3. **無組內進度語音**：「還剩 3 下」「這組還有一半」缺席。
4. **既有文案 bug**：finishLive 的「**時間到**，這組完成」是舊時間制殘留——R3 已改次數制，文案語意過時（應為「這組完成」）。

**節流現況**：COOLDOWN high 2500ms / mid 4200ms / low 6500ms；同句去重；高優先可搶佔。逐次語音若要做，必須嚴守節流否則洗版。

---

## 二、根因與影響分析（重建章節）

| 問題 | 根因層級 | 是否涉 app/core | 風險 | 對三色鐵律/判定的影響 |
|---|---|---|---|---|
| 1 取景顏色 | **純呈現層**（gate 繪製傳空 segments→綠） | ❌ 否 | 低 | 修正後反而強化鐵律（取景≠訓練色分離） |
| 2 辨識門檻 | **引擎邊界**（thresholds） | ⚠️ 可能（調門檻＝改 exercises） | **高**（放水傷防作弊） | 直接觸判定——必須先量測、後申報 |
| 3 語音 | 呈現層＋**部分引擎**（新增 cue＝改 exercises） | ⚠️ 部分（逐次確認在 workout；新 cue 在 core） | 中 | 不影響判定，但新 cue 需進 exercises |

**綜合**：問題 1 可獨立、低風險、優先做（立即解除誤導）；問題 3 的「逐次確認/進度/文案修正」多在 workout 層可做，新增各動作 cue 屬 core 需申報；問題 2 **最敏感**，先加 debug 量測、拿到數據再開門檻決策輪。

---

## 三、最小修正方案（只規劃、不實作）

### A. 取景顏色語意修正方案

1. **要改的顏色**：取景階段骨架與檢查燈改用**青/藍系**（偵測到、合適）、**灰**（未偵測）、**橘**（需調整）；訓練三色不動。
2. **要改的 class/token**：
   - 新增取景專用 token（DS 提案）：`--frame-ok`（青，如 `--teal` 或新 cyan）、`--frame-wait`（灰 `--faint`）、`--frame-adjust`（橘 `--coral` 或新 orange）——**與 `--green/--yellow/--red` 明確分離**。
   - `drawSkeleton` 在 gate 呼叫時傳**非綠的中性/青色**（透過 segments 全段指定，或新增 gate 專用繪製參數——呈現層，不改 drawSkeleton 對訓練的預設行為）。
   - `.lv-gate-chk.ok` 由 `--green` → `--frame-ok`（青）。
3. **要改的文案**：檢查燈與追蹤膠囊用「已就位/請調整」語意，避免「正確」字眼（那是訓練階段用詞）。
4. **不動的訓練判定顏色**：`res.segments` 的紅黃綠、深度量表三色、`✓/✗` 閃現色——一律保留（DS 鐵律）。

**範圍**：workout.js（gate 繪製傳色）＋workout.css（gate class 色）＋lumina/app.css（新增取景 token）。**零 app/core、零判定邏輯**。

### B. 動作辨識校準方案（先量測，後決策）

1. **要檢查的門檻**：四個 MVP 動作的 `attemptEnter/targetEnter/readyReturn`（先看深蹲）。
2. **是否調整門檻**：**現階段不調**——先量測。
3. **是否加緩衝區**：可考慮，但同屬門檻變更範疇，待數據。
4. **是否加 debug 顯示**：**是，這是本方案核心**——在訓練畫面（或設定開關）加**即時 signal 數值**顯示（如深度量表旁顯示 `0.68 / 0.75`），讓使用者/開發者看清「差多少」；純呈現層、可讀 `res.signal`（CONTRACTS 已有）、**零 app/core**。
5. **是否需新增測試**：debug 顯示不需；**若之後決定調門檻，必須新增/重跑攻擊矩陣**（clean 過、half/作弊不過）。
6. **是否可能需改 app/core**：**是**——調 thresholds＝改 `app/core/exercises/*`。
7. **app/core 修改申報**：**現在不改**。流程＝先加 debug（B-4）→ 真機量測拿到 signal 分布 → 若確認門檻過嚴，**另立「引擎門檻校準」實作計畫、申報動 exercises、附攻擊矩陣佐證、送互審**才動。放水前必須證明「不會讓半蹲/作弊過關」。

### C. 語音提示補強方案

1. **要新增的正面回饋**：逐次確認（節流版）——如每 3–4 次或每組達半程時「很好，繼續！」（**不逐次念**，否則洗版）；達標瞬間可加短促「到位！」。觸發＝`repValidThisFrame`；節流＝沿用 coach COOLDOWN（low/mid）＋自訂「每 N 次才念一次」。
2. **要新增的修正建議**：擴充各動作 cue（深度不足/速度過快/重心不穩）——**這動 `app/core/exercises/*` 的 cues，需申報**；workout 層可先做「通用」指導（如 F3 已有的 guide）。
3. **要新增的流程語音**：組內進度「還剩 3 下」（讀 `set.target − setValid`，workout 層可做）；修正 finishLive「時間到」→「這組完成」（**文案 1 字級、workout 層、無風險**）。
4. **觸發條件**：逐次＝有效計次；進度＝剩餘次數跨門檻（如剩 3、剩 1）；流程＝相位轉換（已有）。
5. **冷卻/節流**：一律走 coach `say` 的 COOLDOWN（high2.5s/mid4.2s/low6.5s）＋同句去重；逐次確認另設「每 N 次」計數閘，避免與 cue 搶通道（cue 高優先，確認用 low）。
6. **目前不能做/原因**：
   - **逐次「第 N 下」精確報數**：Web Speech 合成延遲＋節流下，念到「第 5 下」時使用者可能已做到第 7 下——體驗反而更差；建議改「里程碑式」（半程/最後一下）而非逐次報數。
   - **新增各動作專屬 cue**：屬 app/core（exercises），需申報後另輪做。
   - **真人音色/情緒語音**：Web Speech API 限制，非本專案範圍。

---

## 四、下一步提示詞（可直接貼給 Codex / Cursor / Claude Code）

```
請根據 docs/planning/Slice3_辨識與語音診斷報告.md，建立「Slice3 體驗校準實作計畫」（只規劃、先不實作）。

這份實作計畫要把診斷報告的三方案拆成可分輪執行、且風險由低到高排序：

輪次 1（低風險、可先做）：取景顏色語意修正（方案 A）
- gate 骨架與檢查燈改青/灰/橘（新增取景專用 token，與訓練紅黃綠分離）
- 只動 workout.js（gate 繪製傳色）＋workout.css＋app.css/lumina.css（新 token）
- 零 app/core、零判定邏輯、不動訓練三色

輪次 2（低風險）：語音 workout 層補強（方案 C 的 3、部分 1）
- 組內進度語音（還剩 N 下，讀 set 狀態）＋finishLive「時間到」文案修正
- 里程碑式正面確認（半程/最後一下，非逐次報數），走既有 COOLDOWN
- 只動 workout.js，不動 coach.js say 本體、不動 exercises

輪次 3（需量測、可能動 app/core→先申報）：辨識門檻校準（方案 B）
- 先加即時 signal debug 顯示（純呈現層、讀 res.signal）
- 真機量測 signal 分布後，才決定是否調 thresholds
- 若要調門檻：另立申報、附攻擊矩陣（clean 過/half 作弊不過）、送互審才動 exercises

每輪必須：
1. 不破壞 Slice 1/2/4/4R3 與 Slice 3 R1/R2/R3 已完成成果
2. 不修改 app/core（輪 3 若需要，先在計畫申報、經互審才動）
3. 不修改 tests 舊斷言、vendor、CONTRACTS 既有簽名
4. 保留訓練三色鐵律（綠有效/黃接近/紅無效）不變
5. 每輪結束跑 node tests/run.js（現 46/46）＋0 error＋（可行時）真機或 demo 複測

請先閱讀：
1. docs/planning/Slice3_辨識與語音診斷報告.md（本報告，三方案細節）
2. docs/planning/Slice3_R3_驗收報告.md
3. docs/ai-rules/Design_System_收斂版.md（§三色彩鐵律、取景 token 需提案）
4. docs/CONTRACTS.md（§4 ExerciseSpec、§5 Detector：res.signal/res.color）
5. docs/SPEC.md（§4.4 三色回饋語意）

完成後輸出：分輪實作計畫（每輪：目標/檔案三分/完成標準/測試/風險），送 cross-model 互審蓋章後才動第一行程式。
```
