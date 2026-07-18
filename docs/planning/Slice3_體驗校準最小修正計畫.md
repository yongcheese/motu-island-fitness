# Slice 3 體驗校準最小修正計畫（三輪）（2026-07-05）

> 依據：`Slice3_辨識與語音診斷報告.md`（三問題根因）、`Slice3_R3_驗收報告.md`、`Slice3_R2_R3_迷你實作計畫.md`、`Design_System_收斂版.md`（§三色彩鐵律）、`docs/CONTRACTS.md`（§4 ExerciseSpec／§5 Detector res.signal/res.color）、`docs/SPEC.md`（§4.4 三色回饋）。
> 本文件為**實作計畫**，動工前須經 cross-model 互審蓋章。本輪只建立計畫、不改任何程式。
> 三問題（真機回報）：①取景階段用紅綠色→誤解為姿勢判定 ②深蹲門檻感覺過嚴 ③語音不完整。
> **風險排序（由低到高）＝執行順序**：輪 1 取景顏色（最低風險，優先）→ 輪 2 辨識量測（先量測不放水）→ 輪 3 語音補強。**每輪獨立蓋章、獨立施工**，本計畫是總綱。

---

## 第一輪：取景顏色語意修正（Priority 1，最低風險，先做）

**目標**：取景/站位階段不再使用訓練判定的紅/黃/綠，改用青/灰/橘——讓使用者一眼分辨「這是站位確認、不是姿勢判定」。

### 1. 取景階段目前哪些地方用了紅/綠（讀碼確認）
- **骨架**：`waitForFraming` 內 `drawSkeleton(live.ctx, lm, {}, ...)`——傳空 segments，`drawSkeleton` 預設 `COLOR[segments[seg]||'green']` → **整具骨架綠色**（feedback.js:33）。
- **檢查燈**：`.lv-gate-chk.ok` → `color: var(--green)`＋綠底綠邊（workout.css:333）；未偵測態 `--faint`（灰）。
- **追蹤膠囊**：gate 期間 `hud.track.dataset.s = 'ok'|'seek'`——**`ok`/`seek` 同時被正式訓練用**（workout.js:945 訓練「追蹤中·33 點」也設 `ok`）→ 直接改色會傷訓練綠（互審 BLOCKING #1，修正見下表）。

### 2. 要改哪些 class / token / drawSkeleton 呼叫
| 項目 | 現況 | 改為 |
|---|---|---|
| gate 骨架色 | 空 segments→綠 | 傳「全段青色」segments（見下）→青色骨架 |
| `.lv-gate-chk.ok` | `--green` | 新 token `--frame-ok`（青） |
| gate 追蹤膠囊 | **`data-s="ok"/"seek"` 與訓練共用**（互審 BLOCKING #1：直接改 ok 會傷訓練「追蹤中」綠） | gate 期間改用**專屬 state** `data-s="frame-ok"/"frame-adjust"`，正式訓練的 `ok/seek/warn` 一律不動 |
| 缺件/需調整 | 目前僅灰（未偵測） | gate 專屬 `frame-adjust` 態（橘）——「看不到：X」 |

### 3. 取景階段顏色語意（新增取景專用 token，與訓練三色分離）
- **青/藍 `--frame-ok`**（**明確 `#3aa8ff` 藍，不得沿用 `--teal`**——互審 BLOCKING #2：`--teal` 在 lumina.css = 訓練綠 `#22e0a1`，用它視覺仍撞綠）：位置合適、已偵測。
- **灰 `--frame-wait`**（= 既有 `--faint`）：尚未偵測。
- **橘 `--frame-adjust`**（`#ff9f43`，**不用 `--coral`**——coral 是訓練「無效但友善」語意）：需調整位置。
- **實作手法（最小、不改 drawSkeleton 對訓練的預設）**：feedback.js 的 `COLOR` **新增 key `frame`**（值必須是完整 `#rrggbb` 6 碼 hex——互審 n2h：drawSkeleton 內 `.slice(0,7)` 依賴此格式）；gate 呼叫改 `drawSkeleton(ctx, lm, ALL_FRAME, opts)`，其中 `ALL_FRAME = { torso:'frame', leftArm:'frame', rightArm:'frame', leftLeg:'frame', rightLeg:'frame' }`（workout 層常數；key 對齊 drawSkeleton 的 SEGMENTS 五段）。→ **drawSkeleton 簽名與訓練預設行為零改動**，只是餵它一組全 frame 的 segments。

### 4. 正式訓練紅/黃/綠如何保留
- `handleResult` 用 `res.segments`（引擎產出）→紅黃綠**一律不動**。
- 深度量表三色（`gfill.dataset.c = res.color`）、`✓/✗` 閃現色、週期燈——全部保留。
- DS §三語意鐵律：`--green/--yellow/--red` 一個值不改；新 `--frame-*` 是**新增**、不覆蓋既有。

### 5. 要改的文案（讓使用者知道只是站位確認）
- 檢查燈：維持「✓ 肩膀 / ○ 膝蓋」（部位偵測語意，本就不含「正確」字眼）✅。
- 追蹤膠囊 gate 態：「● 準備開始」→ 建議「📍 已就位，準備開始」；「🔍 看不到：X」保留（站位語意）。
- gate 標題/副標：現有「站進畫面中，讓 AI 看見你」「全部亮綠並保持 2 秒」——「亮綠」改「亮起」（避免暗示綠=正確）。
- **禁用字眼**：取景階段不得出現「正確/標準/達標」（那是訓練階段用詞）。

### 6. 測試方式
1. `node tests/run.js` 46/46（本輪不動 core/tests 邏輯，純呈現）。
2. gate 骨架青色、檢查燈青色（非綠）——headless 以 fake stream 進 camera gate＋截圖比色（或 computed style 驗 `.lv-gate-chk.ok` 色）。
3. 訓練階段骨架仍紅黃綠——demo 一輪截圖確認未受影響。
4. DS token 新增後全站抽查無誤用（grep `--frame-` 只在 gate 相關）。
5. 交付使用者真機複測：站位時看到**青色**骨架（不再綠）、訓練時才紅黃綠。

### 7. 風險
**低**。純呈現層（workout.js gate 繪製傳色＋workout.css gate class＋feedback.js COLOR 增 key＋DS 新 token）；不碰判定、不碰 drawSkeleton 訓練預設、不碰組數狀態機/結算/run-token。唯一注意：新 token 須寫回 DS 文件（§三提案）。

### 檔案三分（輪 1）
| 類別 | 檔案 | 範圍 |
|---|---|---|
| 可修改 | `workout.js` | 僅 gate 繪製呼叫傳 `ALL_FRAME` segments＋追蹤膠囊 gate 態文案/色 |
| 可修改 | `workout.css` | `.lv-gate-chk.ok` 改 `--frame-ok`（青）＋**新增** `.lv-track[data-s="frame-ok"]`（青）/`[data-s="frame-adjust"]`（橘）——訓練 `ok/seek/warn` 規則不動 |
| 可修改 | `app/ui/feedback.js` | `COLOR` **新增** `frame` key（青）——既有 key 零改動 |
| 可修改 | `app.css`/`lumina.css` | **新增** `--frame-ok/--frame-adjust`（`--frame-wait`=`--faint` 不新增） |
| 可修改 | `docs/ai-rules/Design_System_收斂版.md` | §三新增取景 token 列＋**把「Coach HUD ok=green」限定為正式訓練**、gate 另列 `frame-ok/frame-adjust`（互審 n2h） |
| 禁區 | `app/core/**`、drawSkeleton 簽名與訓練預設、run-token、組數狀態機、finishLive/結算、tests 舊斷言、vendor、訓練三色 | 不動 |

---

## 第二輪：辨識門檻量測與校準（Priority 2→3，先量測、後校準）

**目標**：先搞清楚「為什麼要蹲很低才判定有效」是門檻過嚴、還是量測失真、還是回饋不直觀——**在拿到真實 signal 數據前不調任何門檻**。

### 2-A（Priority 2）：量測階段（零 app/core、零門檻改動）
1. **加即時 debug 顯示**：訓練畫面（或設定 debug 開關）顯示 `res.signal / targetEnter`（如深蹲 `深度 0.68 / 目標 0.75`），**並同時顯示 `phase / color / faults / cue / repCounted`**（互審 n2h：幫助區分「門檻過嚴」vs「姿勢 fault/gate 沒過」——這正是 2-B BLOCKING #4 要排除的鍋）——純呈現層，讀 CONTRACTS 已有的 FrameResult 欄位，**零 app/core**。
2. **真機量測**：使用者以「自覺標準」的深蹲做數次，記錄 signal 落點分布。
3. **判讀**（診斷報告的三假設）：
   - signal 停在 0.5–0.7 → 門檻可能真的偏嚴（進 2-B）。
   - signal 與體感不成比例 → 量測/角度問題（另查，非調門檻）。
   - signal 有到 0.75 但沒注意 → 回饋問題（強化達標視覺/語音，歸輪 3）。

### 2-B（Priority 3）：校準階段（**可能動 app/core→強制先申報＋互審＋量化准入**）
1. **要檢查的門檻**：**先只限深蹲**（互審 n2h：其他動作除非各自有真機資料＋矩陣，否則不碰）`attemptEnter/targetEnter/readyReturn`。
2. **是否調整**：**只有 2-A 數據＋根因證明才調**，幅度最小。
3. **是否加緩衝區**：可考慮遲滯微調，同屬門檻範疇、待數據。
4. **量化准入門檻（互審 BLOCKING #3——「感覺過嚴」不足以改 core，須數據）**：2-B 計畫必須附——樣本數（≥N 次自覺標準深蹲）、裝置/鏡頭角度、每次 **peak signal**、每幀 `visible/phase/faults/cue/repCounted`、baseline 0.75 下的失敗率、影片或截圖佐證。
5. **必須先證明失敗主因是 targetEnter（互審 BLOCKING #4）**：有效計次還受 `gateAtPeak`、blocking faults（深蹲 `torso_lean` block＋`gatePass`）、尺度估算、取景影響——2-B 須先排除「不是 gate/fault/腿長/取景 的鍋」，證明卡在 `targetEnter`，才可動它。
6. **false-positive / false-negative 驗收標準（互審 BLOCKING #5，寫死）**：調門檻後——clean **必過**、half/代償 **必 0 valid**、noise seeds 維持、整體 accuracy **≥ 90%**、**四 MVP 攻擊矩陣全跑綠**（即使只改深蹲也全跑，證明無連帶回歸）。
7. **鐵律流程**：①2-B 另立計畫**明確申報動 app/core/exercises** ②附 4/5/6 的量化證據 ③送 cross-model 互審蓋章 ④才動第一行。**本總綱不授權任何門檻改動**——2-B 是條件觸發的後續輪。

### 風險
2-A 低（純顯示）；2-B **高**（引擎邊界＋防作弊），故拆兩段、2-B 需獨立申報互審＋量化准入。

---

## 第三輪：語音提示補強（Priority 4）

**目標**：補正面回饋、修正建議、流程語音——但不洗版、不做辦不到的事。

### 可做（workout 層，不動 core）
1. **里程碑式正面確認**（非逐次報數）：組達半程/最後一下時「很好，快完成了！」——讀 `set` 狀態，走既有 COOLDOWN（low）。
2. **組內進度語音**：「還剩 3 下」（讀 `set.target − setValid` 跨門檻觸發：剩 3、剩 1）。
3. **流程文案修正**：finishLive「時間到，這組完成」→「這組完成」（舊時間制殘留，1 字級、零風險）。

### 需申報（動 app/core/exercises）
4. **擴充各動作 cue**（深度不足/速度過快/重心不穩，目前每動作僅 2 句）——動 `exercises/*` 的 cues，**需申報＋互審**（不破壞既有 cue 語意/攻擊矩陣）。

### 不能做/原因
5. **逐次精確報數**：Web Speech 延遲＋節流下「第 5 下」念出時使用者已做更多→體驗更差，改里程碑式。
6. **真人音色/情緒**：Web Speech API 限制，非本專案範圍。

### 觸發/節流
- 一律走 coach `say` COOLDOWN（high2.5s/mid4.2s/low6.5s）＋同句去重；正面確認用 low（不搶 cue 高優先通道）；里程碑另設計數閘防重複。

### 風險
中（3-1~3-3 workout 層低；3-4 動 exercises 需申報互審）。

---

## 四、優先順序確認

| Priority | 內容 | 風險 | app/core | 何時做 |
|---|---|---|---|---|
| **1** | 取景顏色語意修正 | 低 | ❌ | **先做**（立即解除誤導，最低風險） |
| **2** | 辨識門檻量測（signal debug 顯示） | 低 | ❌ | 輪 1 後（拿數據） |
| **3** | 依量測結果做最小門檻校準 | **高** | ⚠️ 需申報 | **僅在 P2 證明過嚴後**、獨立申報互審 |
| **4** | 語音提示補強 | 中 | 部分需申報 | P1–P3 後 |

**順序合理性確認**：合理。理由——(a) P1 純呈現、零風險、直接解除「綠色誤導」這個最傷第一印象的問題，投報比最高；(b) P2 是 P3 的前提（不量測就調門檻＝盲目放水，會傷防作弊）；(c) P3 是全案最敏感（引擎邊界），排最後且加最嚴閘門（申報＋攻擊矩陣＋互審）；(d) P4 語音多在 workout 層可做、不阻塞前三項，但因需搭配 P1/P3 的視覺語意一致，排最後。**唯一微調建議**：P4 的「流程文案修正（時間到→這組完成）」是 1 字級零風險，可併入 P1 或 P2 順手做，不必等到最後——但為守「一輪一事」紀律，仍歸 P4，除非使用者要求提前。

---

## 五、下一步實作提示詞（**只做 Priority 1：取景顏色語意修正**）

```
請只處理 Slice3 體驗校準 Priority 1：取景顏色語意修正（不碰辨識門檻、不碰語音、不做其他兩輪）。

請閱讀：
1. docs/planning/Slice3_體驗校準最小修正計畫.md（第一輪＝本次唯一範圍）
2. docs/planning/Slice3_辨識與語音診斷報告.md（問題 1 根因）
3. docs/ai-rules/Design_System_收斂版.md（§三色彩鐵律；新增取景 token 需提案）
4. docs/CONTRACTS.md（§9 drawSkeleton——不得改簽名與訓練預設）

這次只做：取景/站位階段改用青/灰/橘，與訓練紅黃綠明確分離。

請完成：
1. feedback.js：COLOR 新增 key `frame`（青，完整 6 碼 hex #3aa8ff——drawSkeleton 內 .slice(0,7) 依賴）——既有 green/yellow/red/dim 一行不改
2. workout.js：waitForFraming 的 drawSkeleton 呼叫改傳全段 frame segments 常數
   （ALL_FRAME = {torso:'frame',leftArm:'frame',rightArm:'frame',leftLeg:'frame',rightLeg:'frame'}）；
   gate 追蹤膠囊改用【專屬 state】hud.track.dataset.s = 'frame-ok'/'frame-adjust'（【不得】沿用 ok/seek——那是訓練共用）；
   文案「● 準備開始」→「📍 已就位，準備開始」；gate 標題「亮綠」→「亮起」
3. workout.css：.lv-gate-chk.ok 由 --green → --frame-ok（青）；【新增】.lv-track[data-s="frame-ok"]（青）/[data-s="frame-adjust"]（橘）——訓練 ok/seek/warn 規則一行不動
4. app.css/lumina.css：新增 --frame-ok: #3aa8ff（【不得】用 --teal，它=訓練綠）、--frame-adjust: #ff9f43；--frame-wait 用既有 --faint
5. Design_System_收斂版.md：§三新增取景 token 列＋把「ok=green」限定正式訓練、gate 另列 frame-ok/frame-adjust

請不要：
1. 不要改 app/core、tests 舊斷言、vendor、CONTRACTS 既有簽名
2. 不要改 drawSkeleton 簽名或它對訓練（res.segments）的預設行為
3. 不要動訓練三色（--green/--yellow/--red）、深度量表色、✓/✗ 閃現、週期燈
4. 不要碰 run-token、組數狀態機、finishLive/結算、gate 的 skip/token 契約
5. 不要調任何辨識門檻、不要新增/改語音（那是 Priority 2/3/4）
6. 不要破壞 Slice 1/2/4/4R3 與 Slice 3 R1/R2/R3

完成後請回報：
1. 修改檔案與 diff 範圍自查（feedback.js 僅 +1 key、drawSkeleton 簽名未動佐證）
2. gate 骨架/檢查燈青色、訓練骨架仍紅黃綠（截圖或 computed style）
3. node tests/run.js（46/46）＋0 error
4. DS token 新增與文件同步
5. 交付使用者真機複測清單（站位青色 vs 訓練紅黃綠）
```

<!-- cross-model-review: APPROVED reviewer=codex hash=3d2d90f2c67665c5 at=2026-07-05T19:49:40+08:00 -->
