# Slice 3 實機回饋修復計畫（使用者實測回報）（2026-07-05）

> 觸發：使用者真相機實測回報——①全程無語音提示，不知道做得對不對、該怎麼改 ②畫面無紅/黃/綠三色區分哪段軀幹錯 ③完全不知道做了什麼/錯在哪/為何沒計次，甚至懷疑模型沒在跑。
> 診斷（已讀碼核實）：三色骨架/語音/計次系統都存在且 demo 路徑正常——實機失效的根因鏈如下（三個真問題）。
> 本文件為**實作計畫**，動工前須經 cross-model 互審蓋章。

---

## 一、根因診斷

| # | 根因 | 證據 | 症狀對應 |
|---|---|---|---|
| 1 | **Gate 軟鎖**：`framingReady` 門檻 0.5 **嚴於**引擎 `visMin: 0.4`（engine.js L50）；卡住時無語音引導、無骨架回饋、**無逃生口**（唯一出路=退出） | workout.js waitForFraming／engine.js | 使用者卡在取景關卡→開始做深蹲→整場零回饋、零計次、「懷疑模型沒跑」——三症狀一次全中 |
| 2 | **語音時基混用＋無卡死防護**：handleResult 以 `performance.now()` 呼叫 `coach.cue`，preStart/checkEndingCues 以 `Date.now()`（say 預設）——`lastSpokenAt/lastAnyAt` 節流表被兩種時間軸污染（epoch≈1.7e12 vs page-ms≈1e5，差值恆負→部分守門永真/永假）；且 Chrome speechSynthesis 有 speaking 卡死的已知毛病，say() 無 watchdog——一旦卡住全場靜音 | coach.js say()／workout.js handleResult | 「沒有語音提示」 |
| 3 | **零進度時的誤導回饋**：動作未達 `targetEnter` 時引擎不產 cue（FSM 未進 attempt），`handleResult` 落入 else 分支輪播 GOOD_TIPS「動作很標準，繼續！」——**沒計次卻被稱讚** | workout.js handleResult/positiveTip | 「我感覺已經做到標準了（但沒計次）」 |

## 二、修復規格

### F1：Gate 四修（對齊門檻＋看得見＋缺件同源＋永不軟鎖）
1. `framingReady` 可見度門檻 **0.5 → 0.4**（對齊引擎 visMin——gate 不得嚴於實際判定）。
2. **gate 期間畫骨架**：等待迴圈每幀已有 lm——以中性色（全段 dim）呼叫既有 `drawSkeleton` 疊在相機畫面上（containRect 對齊、沿用 WORK 同款繪製參數）→ 使用者站進來立刻看到「AI 看到我了」。**不引入 detector/update**（只畫骨架、不判定）。
3. **缺件 UI／語音與實際 gate idxs 同源（互審 BLOCKING #1）**：`all` 判定用 `spec.gateLandmarks || spec.requiredLandmarks`，故**檢查燈與缺件播報也必須用同一組 idxs 分組**，不得固定「肩/髖/膝」三列——否則開合跳/伏地挺身（需手腕/腳踝/手肘）會「三列全綠仍卡 gate」。作法：新增 `LM_GROUP` 把 landmark 索引映射到人話部位（肩膀/髖部/膝蓋/手臂/腳踝…），`framingReady` 依 spec idxs 動態產出「缺哪些部位群」清單；檢查燈渲染這份動態清單、語音播報「看不到 X，請調整」也讀同一份。gateHtml 的三列改為由 JS 依 spec 動態填充（R1 靜態三列僅作預設殼）。
4. **語音引導**：進 gate 時 `say('請站進畫面中，讓我看到全身', 'high')`；卡住期間每 4 秒對「缺的部位群」（三-3 同源清單）節流播報，用既有 coach 節流。
5. **逃生口（永不軟鎖鐵則；互審 BLOCKING #3）**：gate 顯示 10 秒仍未通過 → 顯現 Secondary 按鈕「跳過檢查，直接開始 ›」。token 契約——handler `if (live !== run) return; run.skipGate = true;`（**獨立旗標，不重用 skipRest**）；**只由 `waitForFraming` 的 rAF tick 消費**：tick 見 `run.skipGate` → `done(true)`，之後仍走既有 `preStart` 後的 token 二次檢查再進 countdown。handler **不得**直接啟動 countdown/loop。
6. **跳過鈕可點（互審 BLOCKING #2）**：`.lv-gate` 為 `pointer-events:none`——跳過鈕（或其容器）須 `pointer-events:auto`；同時不遮既有退出鈕（z 契約 lv-top=7 不變）。
7. 追蹤膠囊同步：gate 期間 hud.track 顯示 seek/缺件狀態（沿用既有 data-s 語彙）。

### F2：語音管線修復
1. **時基統一為 `Date.now()`**：handleResult 的 `CTX.coach.cue(res.cue, now)` 改傳 `Date.now()`（1 行；performance.now 僅供引擎/時鐘，語音節流一律 epoch）。根因收斂（互審 n2h）：混用**污染節流表**（epoch vs page-ms 差值恆負→守門失效）為確定成立的問題；「必然全場靜音」則需**混用＋`speechSynthesis.speaking/paused` 卡死**兩者疊加才發生——F2-1 修時基、F2-2 修卡死，雙管齊下。
2. **卡死 watchdog（coach.js 純新增，不改既有——互審 BLOCKING #4/#5）**：新增 export 方法 `nudge(tNow)`：**開頭早退 guard `if (!supported || !on) return false;`**（語音關閉時每幀不觸碰 speechSynthesis——互審 n2h）；(a) 若 `speechSynthesis.paused` → `resume()`（Chrome 長跑 paused 自癒——**移出 say()，只在 nudge 處理**，避免被 cooldown 擋掉的 say 也有喚醒副作用）；(b) 若 `speaking && tNow − lastAnyAt > 8000` → `cancel()`＋`currentPriority=0`。**say() 本體一行不改**（真正的「只增不改」）。
3. **nudge 掛載點涵蓋 gate（互審 BLOCKING #5）**：`waitForFraming` 的 rAF tick、`runCameraLoop`、`runDemoLoop` 三處每幀各呼叫 `CTX.coach.nudge(Date.now())`（成本＝屬性讀取＋偶發 cancel）——確保 gate 階段的語音卡死也救得到。
4. 既有優先級/去重/冷卻/挑聲線機制零改動。

### F3：零進度誤導修復（誠實回饋）
1. **回饋策略抽成純函式 `coachPolicy(state)`（互審 BLOCKING #6——可單元測試）**：不依賴 demo 序列碰運氣，把「該說稱讚還是指導」的決策抽成純函式放 `app/core/coach.js`（或新 `coach-policy.js`），輸入 `{ visible, hasCue, secsSinceValid, movingButNotTarget }`，輸出 `{ kind: 'cue'|'guide'|'praise'|'framing', text? }`。`handleResult` else 分支改呼叫它。
2. **策略規則**：`visible && !hasCue` 時——若 `secsSinceValid > 12 && movingButNotTarget`（在動但不達標）→ `guide`（'mid'、有語音）：「動作再做大一點——看右側深度條，要碰到白色達標線才算一下」；否則若「最近 12 秒內有過有效次」→ `praise`（GOOD_TIPS 輪播）；否則 `framing`（取景提示或中性正向）。**GOOD_TIPS 稱讚只在名副其實時出現**。
3. **判定資料**：`live.lastValidAt`（每次有效計次更新為 `Date.now()`）；`movingButNotTarget` = 12 秒窗內出現過 `res.signal >= live.ex.thresholds.attemptEnter`（**用動作自身門檻，非固定 0.25**——互審 n2h；深蹲 0.25、其他多 0.30）但無有效次。
4. 指導句一律走 `setCoach(text,'mid')`＋`coach.say`（節流由 coach 管）。
5. **新增單元測試**（tests/，只增）：`coachPolicy` 四情境——長時間 zero-valid+moving→guide；剛計次過→praise 可用；看不到人→framing；有 cue→cue。不依賴 demo 序列。

## 三、檔案三分

| 類別 | 檔案 | 範圍 |
|---|---|---|
| 可修改 | `workout.js` | waitForFraming（F1 全部）＋handleResult（F2-1 一行＋F3 else 分支）＋positiveTip 改造＋兩迴圈各加一行 `coach.nudge`＋gateHtml 加跳過鈕（hidden，10 秒後現身） |
| 可修改 | `app/core/coach.js` | **僅新增** `nudge(tNow)` 方法（含 paused resume＋speaking watchdog）＋`coachPolicy` 純函式（或另立 `coach-policy.js`）——say()/節流/評分/挑聲線**一行不改** |
| 可修改 | `workout.css` | 僅新增 gate 跳過鈕樣式＋`pointer-events:auto`（1 小段） |
| 可修改 | `tests/` | **僅新增** `coach-policy.test.js`（coachPolicy 四情境）＋workout 層可測項（framingReady 0.4 邊界/rows-all 同源）——舊斷言零改動 |
| 禁區 | engine/exercises/判定門檻、run-token 既有檢查點、組數狀態機（R3 剛驗收）、finishLive/commitSession、tests 舊斷言、vendor、renderResult/renderReward/goals.js | 不動 |

**明確不做**：不調引擎判定門檻（使用者「感覺標準但沒過」可能是動作深度真的不足——正確解法是把「差在哪」告訴他〔F3〕，不是放水門檻；門檻調整屬引擎邊界、需另立宣告輪）；不加新動畫；不動 Slice 1/2/4。

## 四、完成標準

1. demo 路徑零回歸：3 組課表照跑、`node tests/run.js` 全綠（41＋新增 coachPolicy/framingReady 斷言）、0 error。
2. gate（程式面可驗部分）：門檻 0.4；跳過鈕 10 秒現身且 `pointer-events:auto`、token 契約（skipGate 只由 tick 消費、mismatch 不進倒數）；骨架繪製呼叫存在於 gate 迴圈且不引入 update；檢查燈/播報依 spec idxs 同源。
3. 語音時基全檔統一 Date.now（grep 佐證）；nudge 掛入 gate＋兩迴圈三處；say() 本體 diff=0（只增不改佐證）。
4. F3：`coachPolicy` 單元測試綠——長時間 zero-valid+moving→guide、剛計次→praise、看不到人→framing、有 cue→cue。
5. **實機複測交付使用者**：站入→骨架立現＋語音引導→缺件燈/播報→倒數；若仍卡 10 秒→跳過鈕可進；訓練中做不到位時聽到「怎麼改」的語音、骨架三色、✓/✗ 閃現。

## 五、測試方式

1. `node tests/run.js`：舊 41 綠＋新增 coachPolicy（四情境）＋framingReady（0.4 邊界、rows/all 依 spec 同源）斷言。
2. demo 全流程一輪（回歸）＋F3 觀察（作弊段不稱讚）。
3. gate skipGate 契約：以臨時 debug 直呼 waitForFraming 驗「10 秒現身跳過鈕→點擊→done(true)→經 preStart token 檢查進倒數」＋「token mismatch→resolve false 不進倒數」，驗畢即刪（比照既有 hook 慣例）。
4. 語音：headless 無法驗發聲——以「coachPolicy 純函式測試＋say spy 呼叫＋時基一致 grep＋nudge 邏輯（paused→resume、speaking>8s→cancel）單測」代替；實機由使用者複測。
5. 交付使用者實機複測清單（四-5）。

<!-- cross-model-review: APPROVED reviewer=codex hash=493ec407dd32897e at=2026-07-05T18:01:45+08:00 -->
