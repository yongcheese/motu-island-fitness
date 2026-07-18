# Slice 3 第一輪實作計畫 — AI Coach HUD／訓練進行中（純靜態畫面輪）（2026-07-05）

> 依據：`Slice_Workflows_重整版.md`（Slice 3 §7 第一輪：「取景關卡覆蓋層＋組間休息卡＋HUD 雙態的**純靜態畫面**（用旗標假資料切換）。不要改：任何時序/迴圈。完成：三個新畫面可肉眼驗收、現行流程完全未變」）、`Vertical_Slices_重整版.md`（Slice 3＝全案唯一高風險 Slice）、`本專案專用規劃_重整版.md`（六-補終止邏輯決策：次數為主/90 秒安全網/倒數環雙語意）、`Design_System_收斂版.md`（§七-Slice 3、元件 #6 Coach HUD/#12/#16/#17）、`docs/CONTRACTS.md`（§5 engine/§9 feedback）、`docs/SPEC.md`（§3.1-5 偵測主體/§4.5 語音）、Slice 1/2/4/4R3 驗收報告（保護清單）。
> **風險定位**：Slice 3 整體高風險，但本輪（R1）刻意設計為**零時序接線的靜態版型輪**——所有新畫面預設隱藏、不接任何邏輯；真正的高風險輪是 R3（組數狀態機），屆時**另寫迷你計畫再互審**。
> 本文件為**實作計畫**，動工前須經 cross-model 互審蓋章（cmr marker）。
> 備註：本計畫模板中段（一節開頭、三節後半、四節、七節中段、八節前半）於使用者訊息中亂碼，依既有計畫結構重建為九節。

---

## 一、Slice 3 目標（第一輪範圍）

Slice 3 要解決的問題：**訓練中畫面是「偵測儀表板」，不是「AI 教練」**——直接倒數就開跑（沒有取景保證）、單組 60 秒時間制（與簡介承諾的組×次矛盾）、資訊完整但語氣工程化。

1. **訓練中不能只是黑箱偵測或計次**——使用者要在開場就被「接住」（取景關卡）、在組間被「照顧」（休息卡）、全程知道進度語意（次數環）。
2. **感覺 AI 正在看他**——既有追蹤膠囊（●追蹤中·33 點）保留為錨點；取景關卡把「AI 看到你了沒」變成開場儀式。
3. **知道姿勢是否有效**——既有三色骨架/深度量表/✓✗ 閃現保留原樣（v3 已達標，本輪零改動）。
4. **知道第幾次、第幾組、剩多少**——HUD 倒數欄升級為**雙語意版型**（本組次數進度 vs 休息倒數，六-補決策的視覺載體）。
5. **即時回饋與教練提示**——既有 setCoach 字幕系統保留；鼓勵式文案歸 R4。
6. **對齊 Slice 1/2/4 產品感**——同一套 tokens/玻璃語彙；訓練中是產品的心臟，不能還是儀表板臉。
7. **不破壞黃金路徑**——本輪新畫面全部預設隱藏，現行流程行為必須與改動前**完全一致**。

**本輪＝R1 靜態版型**：只做三個新畫面的 DOM＋CSS（預設隱藏、旗標展示），不接 gate 判定、不接組數、不動任何迴圈——把「畫面長怎樣」先定案給後續輪次接線。

## 二、目前 Slice 3 現況

1. **相關檔案**：`workout.js` 時序區（startLive L360+／preStart／runCountdown／runWarmup／runCameraLoop／runDemoLoop／handleResult／drawRingAndHud／checkEndingCues／finishLive）＋`liveShell(ex)`（L475：live 畫面模板）＋`workout.css`（lv- 前綴）；`coach.js`（語音，只增不改）；`core/engine.js` gateLandmarks（取景判定資料來源，R3 才接）。
2. **Coach HUD 已做到（v3 成果，全保留）**：追蹤狀態膠囊（seek/warn/ok 三態）、動作週期四燈（起始→進行→達標→回復）、右側深度量表（signal+達標線）、✓+1/✗原因 中央閃現、取景引導文案（靠近/後退/缺部位）、教練字幕、四格 HUD（有效次數/時間/kcal/倒數）、倒數邊框環。
3. **訓練中資訊**：上列全部＋暫停/語音/BGM/縮放控制、示範模式徽章。
4. **可保留（全部）**：現有 HUD 元素一個不動；相機錯誤→offerDemo 路徑；暫停/恢復；`!live.started` 守門。
5. **只是技術顯示、沒教練感的地方**：開場「啟動相機中→直接倒數」沒有取景儀式；「倒數 60」是時間制不是課表語意；組間概念完全不存在；文案工程腔（R4）。
6. **最容易影響時序的地方**：runCameraLoop/runDemoLoop 的每幀迴圈、SET_SECONDS 結束判定、run-token（`live !== run`）檢查點、preStart→runCountdown 銜接——**本輪全部不碰**。
7. **高風險、不應第一輪處理**：組數狀態機（組→休息→組）、取景 gate 判定接線（gateLandmarks 全綠 2 秒）、SET_SECONDS 語義改變、倒數環函式改造、90 秒安全網——全部歸 R2/R3（R3 前另立迷你計畫互審）。

## 三、第一輪只做什麼

**三個新靜態畫面（全部預設 `hidden`、不接任何邏輯）＋既有狀態檢查：**

1. **取景檢查關卡覆蓋層 `#lv-gate`**（插在 liveShell 內、canvas 之上 HUD 之下）：標題「站進畫面中，讓 AI 看見你 👀」＋人形取景框（CSS 邊框輪廓）＋核心部位檢查清單三列（肩／髖／膝，靜態兩態樣式：`.ok` 綠燈與 pending 灰燈，版型各展示一種）＋caption「全部亮綠並保持 2 秒，訓練自動開始」。純 DOM+CSS，**不接 gateLandmarks**（R3）。
2. **組間休息卡 `#lv-rest`**（中央覆蓋卡）：「第 1 組完成 💪」＋靜態休息倒數環（大數字 45＋環形版型）＋「下一組：第 2 組 · 12 下」預告＋「跳過休息」按鈕（**R1 不綁事件**——純版型；接線歸 R3）＋鼓勵 caption。
3. **HUD 倒數欄雙態版型（互審裁決——`#m-cd` 必須維持 leaf text node）**：`drawRingAndHud` 每幀 `setText('m-cd', 秒)` 直接覆寫 textContent，塞子元素會在第一幀被清掉。因此雙態版型改為**同一個 `.lv-metric` 內的 sibling 成對版型**（值＋標籤都要換，否則大字 5/12 配小字「倒數」是語意衝突）：`#m-cd`（現行倒數秒、零改動）與其 `.m-k`「倒數」標籤旁，新增 hidden 的 `<div class="m-v lv-set-progress" hidden>5/12</div>`＋`<div class="m-k lv-set-label" hidden>本組次數</div>`——未來 R3 以 class **成對切換**（時間態顯示 #m-cd＋倒數標籤／次數態顯示 lv-set-progress＋lv-set-label，兩態互斥）；`#m-cd` 本身與 `checkEndingCues` 的 `classList.toggle('low')` 完全不受影響；`drawCountdownRing` 簽名與呼叫零改動（環的雙語意繪製歸 R2 新函式）。debug hook 驗收時需展示「次數態成對顯示、倒數值與標籤同時隱藏」的版型。倒數那格 `.lv-metric` 加專用 class `.lv-cdmetric`（互審建議：R3/hook 切換用 selector 不靠結構相鄰）。
4. **教練提示文案區塊**：沿用既有 `#lv-coach`／`#lv-status`，零改動（文案人格化歸 R4）。
5. **次數/時間/卡路里/狀態 HUD**：既有四格與追蹤膠囊零改動。
6. **AI 偵測狀態視覺**：既有 data-s 三態零改動。
7. **Loading／Camera／No Camera／Lost Tracking 狀態檢查**：全部沿用既有（啟動相機中文案／offerDemo 錯誤頁／🔍尋找人體），本輪只驗未破壞、不重做。
8. **驗收顯示方式（比照 Slice 4 R1 的 debug hook 慣例）**：臨時加一行 `window.__debugSlice3 = (k) => ...`（切換三個新畫面的 hidden class）供截圖驗收；**驗畢即刪，收尾 diff 自查必須確認 `__debugSlice3` 不存在**。

**不要做**：不接 gate 判定/組數狀態機/90 秒安全網（R3）；不改 SET_SECONDS 語義；不動 startLive/preStart/runCountdown/runWarmup/runCameraLoop/runDemoLoop/handleResult/drawRingAndHud/checkEndingCues/finishLive 的**任何邏輯行**；不碰 run-token；不改 drawCountdownRing 簽名；不改 coach.js；不動 engine/gateLandmarks；不做文案人格化與語音（R4）；不加動畫特效（休息環動畫歸 R4）；不重做既有 HUD；不碰 Slice 1/2/4 任何檔案區段（renderMenu/renderIntro/renderResult/renderReward/rewardIslandLine/卡片元件/goals.js）。

## 四、workout.js 修改範圍界定（重建章節）

1. **是否需要修改 workout.js**：是——三個靜態畫面必須長在 liveShell 模板裡。
2. **只能改哪兩小段**：
   - `liveShell(ex)` 模板字串內**新增**三段 hidden DOM（`#lv-gate`／`#lv-rest`／`#m-cd` 格內的隱藏雙態 span）——純模板、不含任何 JS 邏輯；
   - （驗收期間）臨時 debug hook 一行，驗畢刪除。
3. **高風險邏輯不能碰**：startLive 之後所有時序函式的邏輯行一行不動（liveShell 是被 startLive 呼叫的純模板函式，改模板不改呼叫）；`bindLiveControls` 不動（新畫面 R1 無事件）。
4. **與後續輪次的邊界**：R2＝版型函式化＋次數進度環新繪製函式（不改 drawCountdownRing 舊簽名）；**R3＝接線輪（高風險）——動工前必須另寫迷你實作計畫送 cross-model 互審**；R4＝文案/語音/慶祝動畫。
5. 若實作中發現需要動任何時序邏輯行 → **停工回報，不得自行擴權**。

## 五、保留規則（必須原樣保留）

1. Slice 1 首頁/今日層/島嶼主畫面成果：零觸碰。
2. Slice 2 推薦卡/訓練前流程成果：零觸碰（renderMenu/renderIntro/四個卡片純函式）。
3. Slice 4 兩幕結算流程：零觸碰（renderResult/renderReward/CTA 契約）。
4. Slice 4 R3 島嶼目標條與 nextGoal/canBuy：零觸碰（goals.js 簽名與錨定期望值不動）。
5. `app/core`：零修改（gateLandmarks 只讀概念，本輪連讀都不接）。
6. `tests` 舊斷言：零修改（41/41 為本輪基線——34 原始＋7 goals）。
7. `vendor`：零修改。
8. `docs/CONTRACTS.md`：零修改（drawCountdownRing 簽名屬契約 §9）。
9. run-token 判斷點：一個不能少、一行不碰。
10. 組數狀態機：不存在、不提前實作。
11. summary/session 欄位語意：零改動（欄位語意變更是 R3 的申報事項）。
12. `planText(meta)` 單一來源：本輪不動；R3 接組數時休息卡文案應引用它（先寫入計畫備忘）。
13. 「先 commit 後演出」原則：本輪不涉結算，天然滿足。

## 六、UI 重整方向（DS §七-Slice 3、元件 #6 Coach HUD／#12 Progress／#16 Loading／#17 Error）

1. **Coach HUD 主區塊**：全部沿用現行（半透深底＋token 色、不新增佔屏元素——元件 #6 鐵則）。
2. **AI 狀態提示**：沿用追蹤膠囊 data-s 三態（ok=green/warn=gold/seek=muted）。
3. **有效/無效提示**：沿用 ✓+1 綠大字／✗ 原因 coral 中字（repflash 規則）。
4. **次數/時間/卡路里**：沿用四格＋`tabular-nums`；雙態版型新增的「本組 5/12」用 HUD Number 同字階、本組次數為主視覺（DS §七-Slice 3：本組次數最大）。
5. **教練提示文案**：沿用 `#lv-coach` 樣式；內容歸 R4。
6. **姿勢品質提示**：沿用三色骨架＋深度量表（契約不變）。
7. **Camera／No Camera／Lost Tracking**：沿用既有三態（元件 #16/#17：文字提示鏈＋offerDemo 出路）——本輪僅驗收未破壞。
8. **取景關卡**：全屏半透遮罩（`rgba(8,22,28,.72)` 統一半透底）＋中央人形框（`--stroke-strong` 虛線）＋三列檢查燈（`--green`/`--faint` 兩態）＋Body/Caption 字階。
9. **休息卡**：中央玻璃大卡（元件 #2）＋休息環（元件 #12：白 8% 底/`--grad-teal`）＋大數字 HUD Number；「跳過休息」為 Secondary 樣式（一屏一 Primary 紀律：live 畫面無 Primary）。
9-1. **層級與點擊契約（互審裁決——退出鈕永遠可按）**：既有層級 `.lv-top` z=3、`.lv-hudtop`/`.lv-gauge` z=5。明定：`.lv-gate`/`.lv-rest` **z-index: 4**（蓋 canvas/骨架、低於追蹤膠囊與量表）；**`.lv-top` z-index 3→7（申報式 1 行既有規則調整**——純堆疊層級、視覺零變化，確保頂欄含退出鈕永遠最上層）；`.lv-gate` 遮罩本體 **`pointer-events: none`**（純視覺、點擊全穿透）；`.lv-rest` 卡片本體 `pointer-events: auto`（含跳過鈕）且置中不覆蓋頂欄區（top ≥ 頂欄高）。驗收必實測：gate/rest 顯示時 `#lv-exit` 可點。
9-2. **hidden 保護（互審裁決）**：新 CSS 若寫 `display: grid/flex` 會覆蓋瀏覽器 `[hidden]` 預設——比照既有 `.lv-zoom[hidden]` 慣例，**明寫 `.lv-gate[hidden], .lv-rest[hidden], .lv-set-progress[hidden] { display: none; }`**，並列入驗收檢查（預設流程零可見差異的保證線）。
10. **手機優先**：390px 取景框佔畫面 60% 高置中、檢查燈單欄；休息卡滿版減邊距。
11. **桌機**：沿用 live 全屏沉浸（#view.full 蓋側欄）；新畫面同層置中限寬 480px。
12. 零新 token、零硬編碼色票、無動畫（全歸 R4）。

## 七、完成標準

1. 訓練中畫面「更像 AI 教練」的三塊版型定案：取景關卡／休息卡／倒數欄雙態——**可肉眼驗收**（debug hook 切換截圖）。
2. 使用者（未來）能知道 AI 是否在偵測：取景關卡版型含檢查燈兩態樣式展示。
3. 使用者（未來）能知道第幾組/第幾次/剩多少：休息卡與雙態倒數欄版型含全部資訊位。
4. **現行流程行為與改動前完全一致**：預設狀態下三個新畫面全 hidden，示範模式全程（倒數→計次→HUD→結算）與改動前無任何可見差異。
5. 訓練後仍能進入 Slice 4 結算兩幕（E2E 重跑）。
6. 結算後仍能回島嶼、島嶼目標條照常。
7. `node tests/run.js` **41/41 綠**（零修改、零新增——本輪純模板無新邏輯）。
8. 0 console error。
9. debug hook 驗畢已刪（diff 自查 `__debugSlice3` = 0 處）。
10. **最終 diff** 僅落在 liveShell 模板段＋workout.css（含申報的 `.lv-top` z-index 1 行）；debug hook 只允許驗收期間暫存、最終必須 0 殘留。
11. 390/1200 三個新畫面截圖存檔＋現行流程截圖比對。
12. run-token/組數/時序/既有 HUD：零觸碰（diff 關鍵字掃描佐證）。

## 八、測試方式

1. `node tests/run.js` → 41/41 綠（施工後與收尾各一次）。
2. ESM 語法檢查（vm.SourceTextModule）。
3. 預設行為零變化驗證：示範模式完整跑一輪（拒相機→offerDemo→60 秒→結算），全程**不出現**任何新畫面。
4. debug hook 逐一開啟三個新畫面 → 390/1200 截圖存檔（取景關卡/休息卡/雙態倒數欄）。
5. 取景關卡與休息卡顯示時：`#lv-exit` 實測可點（gate 為 pointer-events:none 穿透＋lv-top z=7）；`[hidden]` 保護規則存在且預設全隱藏。
6. 檢查燈兩態樣式（ok 綠/pending 灰）肉眼驗收。
7. 休息卡資訊位齊全（組完成/環/下一組預告/跳過鈕樣式）。
8. 雙態倒數欄：預設=現行倒數秒；hook 切換見「本組 5/12」版型。
9. 訓練跑完 → Slice 4 第一幕→第二幕照常（E2E）。
10. 第二幕 → 去蓋房子 → 島嶼照常。
11. 島嶼目標條照常（文案與 store 一致）。
12. 手機 390px 截圖。
13. 桌機 1200px 截圖。
14. `ls -la app/core` 時間戳未變。
15. `tests` 未修改（diff=0）。
16. 收尾：hook 已刪、console 0 error、Slice 1/2 快檢（今日層/推薦卡）。

## 九、下一步實作提示詞（可直接貼給 Codex / Cursor / Claude Code）

```
請只處理 Slice 3：AI Coach HUD／訓練進行中——第一輪：純靜態畫面版型（零時序接線）。

請閱讀：
1. docs/planning/Slice3_第一輪實作計畫.md（本輪唯一依據，含 workout.js 修改範圍界定與保留規則 13 條）
2. docs/planning/Slice4_R3_第一輪驗收報告.md（十四-6 保護清單）
3. docs/ai-rules/Design_System_收斂版.md（§七-Slice 3、元件 #6/#12/#16/#17）
4. docs/CONTRACTS.md（§9 drawCountdownRing 簽名不可改）

這次只做：三個新靜態畫面的 DOM＋CSS，全部預設 hidden、不接任何邏輯。

請完成：
1. workout.js 僅改 liveShell(ex) 模板：新增 ①#lv-gate 取景關卡覆蓋層（標題＋人形框＋肩/髖/膝檢查燈兩態樣式＋
   「全綠保持 2 秒自動開始」caption）②#lv-rest 組間休息卡（第 N 組完成＋靜態休息環大數字＋下一組預告＋
   跳過休息鈕〔不綁事件〕）③倒數 .lv-metric 內新增成對 sibling：
   <div class="m-v lv-set-progress" hidden>5/12</div>＋<div class="m-k lv-set-label" hidden>本組次數</div>
   （#m-cd 與其「倒數」標籤本身零改動、#m-cd 必須維持 leaf text node——drawRingAndHud 每幀 setText 會清掉子元素；
   次數態版型=值+標籤成對、與時間態互斥，hook 驗收時展示成對切換）——三者皆 hidden
2. workout.css 新增 .lv-gate / .lv-rest / .lv-set-progress 規則（全 Lumina tokens、rgba(8,22,28,.72) 半透底、
   390/1200 RWD；無動畫），並必須包含：
   - .lv-gate[hidden], .lv-rest[hidden], .lv-set-progress[hidden], .lv-set-label[hidden] { display: none; }（hidden 保護）
   - .lv-gate/.lv-rest z-index:4；.lv-gate pointer-events:none；.lv-rest 卡片 pointer-events:auto 且不覆蓋頂欄
   - .lv-top z-index 3→7（申報式 1 行：確保退出鈕永遠最上層，視覺零變化）
3. 驗收用臨時 hook（window.__debugSlice3）切換截圖後即刪，收尾 diff 自查不得殘留

請不要：
1. 不要修改 app/core、tests 舊斷言（41/41 基線）、vendor、CONTRACTS 既有簽名
2. 不要碰 run-token 判斷點、組數狀態機、SET_SECONDS 語義、startLive/preStart/runCountdown/runWarmup/
   runCameraLoop/runDemoLoop/handleResult/drawRingAndHud/checkEndingCues/finishLive 的任何邏輯行
3. 不要改 drawCountdownRing 簽名、不要動 coach.js、不要動 bindLiveControls
4. 不要破壞 Slice 1/2/4/4R3：不碰 renderMenu/renderIntro/renderResult/renderReward/rewardIslandLine/
   卡片元件四純函式/goals.js/島嶼目標條
5. 不要接 gateLandmarks、不要做文案人格化/語音/動畫（歸 R3/R4）
6. 預設狀態下現行流程行為必須與改動前完全一致（示範模式全程無任何可見差異）

完成後請回報：
1. 修改了哪些檔案與 diff 範圍自查（應只有 liveShell 模板段＋workout.css 新區塊）
2. 三個新畫面 390/1200 截圖
3. 「改動前後示範模式行為一致」驗證說明（E2E 含 Slice 4 結算/島嶼鏈照常）
4. node tests/run.js 結果（41/41）＋console 0 error＋hook 已刪佐證
5. 遺留給 R2/R3/R4 的接線清單
```

<!-- cross-model-review: APPROVED reviewer=codex hash=936a4372553701fa at=2026-07-05T11:34:14+08:00 -->
