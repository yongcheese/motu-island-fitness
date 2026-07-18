# Slice 3 R2＋R3 迷你實作計畫 — 版型函式化＋高風險接線（2026-07-05）

> 依據：`Slice3_第一輪驗收報告.md`（通過；九節接線清單、十-3 明定 R3 需迷你計畫互審）、`Slice3_第一輪實作計畫.md`、`本專案專用規劃_重整版.md`（六-補：次數為主／90 秒安全網／倒數環雙語意）、`Slice_Workflows_重整版.md`（Slice 3 §6 最嚴禁區、§9 時序清單）、Slice 1/2/4/4R3 驗收報告（下游保護）、`docs/CONTRACTS.md`（§5 Detector／§9 drawCountdownRing）、`docs/SPEC.md`（§4.2 FSM／§3.1-5）。
> **本文件定位**：即 Workflows 要求的「R3 動工前迷你實作計畫」——蓋章後 R2 與 R3 均以本文件為授權依據，**分兩輪執行**（先 R2 後 R3），不需再另立計畫（除非 R2 實作中發現規格需修訂→回來改本文件並重審）。
> 本輪只建立本計畫：不修改任何程式碼。
> 備註：模板中段（一節、五節、六節開頭）於使用者訊息中亂碼，依可見節號重建為七節。

---

## 一、現況與本計畫定位（重建章節）

- R1 已交付三個靜態版型（`#lv-gate`／`#lv-rest`／`.lv-cdmetric` 雙態成對 sibling），全部預設 hidden、零邏輯，41/41 綠、預設流程零差異。
- 時序區現況（已精讀原始碼）：camera 與 demo 各一個**單 rAF 迴圈**（頂部 `live !== run` 檢查、`!live.paused` 閘、`elapsedMs ≥ SET_SECONDS*1000 → finishLive()`）；camera 路徑 `startLive→相機→模型→(暖身)→preStart(說明+321)→runCameraLoop(started=true)`；demo 路徑 `offerDemo→runDemoLoop(preStart→started=true→時間驅動追補迴圈)`；每個 await 後都有 run-token 檢查。
- 本計畫涵蓋 R2（低風險版型函式化）與 R3（高風險接線）的完整規格與風險盤點，互審蓋章後 R2 可即刻動工、R3 於 R2 驗收後單獨施工。

## 二、Slice 3 R2 目標：版型函式化（低風險、零行為變化）

**1. 可能新增哪些函式**（全部純模板/純繪製，不接邏輯）：
- `gateHtml()`／`restHtml()`——把 R1 寫在 liveShell 內的兩段靜態 DOM 抽成純模板函式（吃參數回字串：restHtml 接受 `{setIdx, totalSets, restSec, nextReps}`，R2 仍以 R1 的寫死值呼叫——輸出逐字相同）；
- `drawProgressRing(ctx, ratio, opts)`——**新函式**繪製「次數進度環」（與 drawCountdownRing 同視覺語彙、`--grad-teal` 語意），放 `app/ui/feedback.js` **新增 export**（CONTRACTS §9 只增不改——`drawCountdownRing` 舊簽名零改動）；R2 只新增函式與其單元可呼叫性，**不在任何迴圈呼叫**（接線歸 R3）。

**2. 可能修改哪些檔案**：`workout.js`（liveShell 內兩段 DOM 換成 `${gateHtml()}`/`${restHtml(...)}`）；`app/ui/feedback.js`（僅新增 export，不動既有函式）；`docs/CONTRACTS.md` **不改**（新函式屬內部增項，待 R3 穩定後若要入契約另議）。

**3. 只整理、不改行為**：輸出 HTML 與 R1 逐字相同（比照 Slice 2 R2 的 byte-diff 驗證法）；三畫面仍預設 hidden；`[hidden]` 保護與層級契約不動。

**4. 完成標準**：重構前後 liveShell 輸出字串 byte-diff=IDENTICAL；41/41 綠；0 error；`drawProgressRing` 可獨立呼叫（Node 或瀏覽器 smoke）；不碰 run-token/時序/組數（diff 關鍵字掃描=0）。

**5. 測試方式**：`node tests/run.js`；liveShell 輸出比對（進 live 前後抓 innerHTML diff）；示範模式跑一輪照常；截圖與 R1 存檔比對。

## 三、Slice 3 R3 目標：高風險接線（規格定案，本輪不實作）

### 3-1. 設計總原則（把 token 表面積壓到最小）
**gate 與 rest 一律長在「既有單 rAF 迴圈模式」內**（每幀頂部 `if (live !== run) return;`），**不新增任何 await/setTimeout 鏈**——run-token 檢查點只增加「gate 等待迴圈」一處，其餘複用既有迴圈的檢查點。

### 3-2. 組數狀態機（六-補決策落地；含互審 6 項 BLOCKING 修訂）
- `live.set = { idx:1, total:ex.meta.sets, target:ex.meta.repsPerSet, baseValid:0, lastValid:0, phase:'WORK'|'REST', phaseStartTs, restSec:ex.meta.restSec }`。
- **統一時鐘裁決（互審 #3/#6 一次解）**：`live.elapsedMs` **重定義為「累計 WORK 時間」**——累加制取代 `now − startTs` 差值制。**時鐘契約（互審二修，寫死不得偏離）**：**每個 rAF 幀無條件執行 `const dt = now − live.lastFrameTs; live.lastFrameTs = now;`（含 paused/REST/gate 幀——lastFrameTs 永遠貼著當前幀）**；僅當 `phase === 'WORK' && !live.paused` 才 `elapsedMs += dt`。如此任何相位/暫停邊界的第一個 WORK 幀，dt 都只是上一幀到本幀的間隔（毫秒級），**整段休息/暫停時間不可能被吃進來**；為保險，`runCameraLoop`/`runDemoLoop` 進入時與 pause→resume 邊界仍強制 `lastFrameTs = performance.now()`（雙保險）。效果鏈：①demo 追補 target=`elapsedMs/FRAME_MS` 自然不含休息——**休息結束零 catch-up**、不污染下一組；②`finishLive` 的 `durationSec = elapsedMs/1000` **一行不動**，語意自然變為「有效運動時間（不含休息）」——卡路里不虛胖（MET×時間不計休息）；③HUD 時間格=真運動時間（休息時凍結，UX 合理）。**申報**：durationSec 語意由「總經過」精緻化為「運動時間」，值域=1～sets×90 秒，下游 audit 見六節。
- **WORK**：每幀 detector.update 後維護 `set.lastValid = res.reps.valid`；`setValid = lastValid − baseValid`；HUD 倒數格切**次數態**（成對切換 R1 版型）；邊框環改畫 `drawProgressRing(ctx, clamp(setValid/target, 0, 1))`（**明定 clamp**——同幀跨過 target 時 ratio>1 防出界）。`setValid ≥ target` → 組完成：`idx < total` → 進 REST（**snapshot `setEndValid = lastValid`**）；`idx === total` → `finishLive()`。
- **90 秒安全網**：WORK 態工作時間（phase 累計，同受 paused 凍結）≥ 90_000 → 視同組完成；前 10 秒沿用 checkEndingCues 提示語彙（改綁安全網剩餘）。
- **REST**：顯示 `#lv-rest`（restHtml 以真資料呼叫：組序＋`planText(meta)` 同源的次數/休息秒）；HUD 倒數格切回時間態顯示休息剩餘；`restRemain` 以 REST phase 累計時間計（受 paused 凍結）；歸零或 `run.skipRest` → 下一組：`idx++`、**`baseValid = setEndValid`（互審 #2——固定用 snapshot，不依賴當幀 res、不用 summary()）**、phase='WORK'、隱藏 rest、切次數態。REST 期間不餵 detector（camera 停 detect、demo 停追補——由統一時鐘自動保證）。最後 3 秒嗶聲沿用既有 `lastBeepSec` 秒邊界機制（**防每幀連 beep**）。
- **跳過休息的 token 契約（互審 #4）**：skip 鈕 handler 於進入 REST 時綁定：`onclick = () => { if (live !== run) return; run.skipRest = true; }`——**只設當前 run 的旗標**，消費在迴圈內（下一幀讀旗標轉 WORK）；離開 REST 時解除綁定或旗標歸零。不直接在 handler 內改 phase/DOM。
- **SET_SECONDS 退役**：改名 `SAFETY_SECONDS = 90`（單組安全上限）；兩迴圈的 `elapsedMs ≥ SET_SECONDS*1000 → finishLive()` 由狀態機取代（本輪唯一允許改動的既有收束條件）；`drawRingAndHud` remain 依 phase（WORK=進度環/REST=休息環）；`checkEndingCues` 重綁（簽名不變）。
- **暫停/恢復影響表（互審 #5——五個時間量全盤點）**：

| 時間量 | 暫停時 | 恢復時 |
|---|---|---|
| `elapsedMs`（累計 WORK 時間＝duration） | 凍結（累加制天然凍結） | 繼續累加 |
| WORK phase 工作時間（90s 安全網） | 凍結 | 平移繼續 |
| REST 剩餘秒 | 凍結 | 平移繼續 |
| gate「全綠連續 2000ms」判定 | 凍結（paused 幀不累積 ready 時長——互審 n2h #3） | 歸零重新累積（保守：暫停後重新確認取景） |
| demo detector feed clock（=elapsedMs 派生） | 凍結 | 繼續、零 catch-up |

### 3-3. 取景關卡接線（僅 camera 路徑）
- 位置：`preStart` 說明後、`runCountdown(321)` **前**插入 gate 等待：**`waitForFraming(run): Promise<{ok:boolean}>`（互審 #1——完成/取消契約明定）**——內部 rAF 迴圈每幀 `pose.detect` 取 lm → 呈現層純函式 `framingReady(lm, spec)`（`spec.gateLandmarks`（無則 requiredLandmarks）的 `visibility ≥ 0.5` 判全綠）→ 逐列點亮檢查燈；全綠連續 2000ms（paused 幀不累積）→ **resolve `{ok:true}`＋關 gate**；`live !== run` → **清理 gate UI／取消 rAF → resolve `{ok:false}`（Promise 必定 settle，無懸掛 async）**。caller：`const g = await waitForFraming(run); if (live !== run || !g.ok) return;` **再進 runCountdown**（gate 後、倒數前的二次 token 檢查）。期間退出走既有 `!live.started` 守門（不結算）。
- **不動 engine**：`framingReady` 是呈現層函式、只讀 spec 欄位與 lm visibility——detector 不提前餵幀（避免污染 FSM）。
- **demo 路徑跳過 gate**（申報）：合成幀永遠全可見，關卡無意義；示範模式維持 preStart→321 直入。

### 3-4. 風險分析（使用者六問）
1. **碰 workout.js 高風險時序的地方**：兩迴圈的收束條件（SET_SECONDS→狀態機）、drawRingAndHud、checkEndingCues、preStart（插 gate）——全部在本計畫 3-2/3-3 白名單內，逐一列管。
2. **碰 run-token 的地方**：不修改任何既有檢查點；新增 1 個（gate 迴圈每幀）。實作後必須逐點盤點：startLive 4 處＋preStart/runCountdown 各處＋兩迴圈頂部＋gate 迴圈——**清單見五節，驗收逐一勾**。
3. **組數狀態機**：全新增（live.set），不動 detector/FSM/engine——引擎照常吃幀計次，狀態機只在呈現層消費 `res.reps.valid`。
4. **可能破壞 Slice 4 結算的地方**：`finishLive` 觸發點改變（次數/安全網收束 vs 時間收束）——`finishLive` 本身與 `commitSession` 呼叫**一行不動**；但因 `live.elapsedMs` 改為 active clock，**`durationSec` 語意改為「有效運動時間（不含休息）」**（與 3-2 統一時鐘一致），下游值域 audit 見六-0。
5. **summary/session 欄位語意**：schema **零改動**（不加 sets 欄位）；`durationSec` **語意申報**（見 3-2 統一時鐘）：由「總經過（≤60s）」變「有效運動時間（1～sets×90s）」——值域變化的下游 audit 列入六節必查。
6. **一定要先互審的**：本計畫全文（即本次互審）；若 R3 實作中發現需偏離 3-2/3-3 規格（如 pause 平移需改既有 handler 超過 2 行）→ 停工、回本文件修訂重審。

## 四、R2 與 R3 是否可以合併實作

1. **R2 可以先做**：零行為變化、byte-diff 可證，蓋章後即可動工。
2. **R3 必須獨立做**：全案最高風險輪，需完整時序實測窗口，嚴禁與任何其他改動同輪（含 Slice 6-R3 不同週規則）。
3. **裁決：計畫合併、實作分輪**——本文件一次互審兩輪規格；執行順序 R2（半天級）→ R2 驗收（byte-diff＋測試）→ R3（單獨施工＋五節清單全跑）→ R3 驗收。R2 先行的價值：restHtml 參數化後，R3 接真資料只改呼叫端，接線 diff 更小更可審。

## 五、run-token 檢查點盤點與時序測試清單（重建章節）

**檢查點盤點（R3 驗收逐一勾）**：
| # | 位置 | 既有/新增 |
|---|---|---|
| 1 | startLive：相機 await 後 | 既有 |
| 2 | startLive：模型 await 後 | 既有 |
| 3 | startLive：暖身後／preStart 後 | 既有 |
| 4 | preStart：說明 sleep 後 | 既有 |
| 5 | runCountdown：每秒＋結尾 | 既有 |
| 6 | runCameraLoop：每幀頂部 | 既有 |
| 7 | runDemoLoop：preStart 後＋每幀頂部 | 既有 |
| 8 | **gate 等待迴圈：每幀頂部（waitForFraming 內；mismatch→清理＋resolve {ok:false}）** | **新增** |
| 9 | **gate 之後、runCountdown 之前（caller 二次檢查）** | **新增** |
| 10 | **skip rest handler：`if (live !== run) return;` 只設 run.skipRest 旗標** | **新增** |

**時序測試清單（R3 每次施工必跑；Workflows §9＋六-補）**：
1. 載入相機中退出 → 不結算、回選單（`!live.started` 守門）。
2. gate 階段退出 → 不結算（started 仍 false）。
3. 暫停→恢復：計數與組進度凍結、phaseStartTs 正確平移。
4. **組間休息時退出 → 以已完成次數結算**（session=detector.summary 現值）。
5. 跳過休息 → 立即進下一組、baseValid 正確。
6. 完整 N 組跑完（camera 與 demo 各一次）→ 結算＋Slice 4 兩幕＋島嶼目標條全鏈照常。
7. 90 秒安全網：站著不動 → 組強制收束、流程不卡死。
8. 相機拒絕 → offerDemo → demo 組結構照常（demo 無 gate）。
9. 「再一次」→ 簡介 → 重新開始，無舊 run 污染。
10. 快速退出重進 ×3 → 無 GL/相機洩漏、無懸掛 gate Promise、0 error。
11. **gate 期間暫停 → ready 累積凍結**、恢復後歸零重新確認（不會暫停中通過關卡）。
12. **REST 期間暫停 → 休息秒凍結**、恢復平移不跳秒。
13. **demo 零 catch-up**：休息 30 秒結束後下一組首幀 fed 追補量=0（統一時鐘佐證，可 console 記錄 fed 差值驗證）。
14. **durationSec 抽查**：3 組跑完的 session.durationSec ≈ 累計 WORK 時間（明顯小於總牆鐘時間），卡路里與時長格一致。

## 六、Slice 4 下游同步驗證（重建章節）

0. **durationSec 值域 audit（互審 #6——schema 不變仍需查值域消費者）**：R3 動工前全案搜尋 `durationSec/elapsedMs/SET_SECONDS` 消費者逐一確認接受新值域（含休息的總長不再存在、active 時間可達 sets×90s）：`estimateCalories`（MET×時間——active 時間更誠實，✓ 預期無害）、`commitSession`（safeNum 消毒，✓）、成績單時長格 `fmtTime`（✓ 顯示運動時間）、`tracking.js` 統計圖（時長加總/趨勢——確認無「單次≤60s」假設）、`coinsFor`（不吃 duration，✓）、`renderReward`（不吃 duration，✓）。audit 結果寫入 R3 驗收報告。
1. summary/session schema：零改動——驗收時 diff store.js=0、session 欄位逐一比對；durationSec 語意變化依 0 項 audit 佐證。
2. 是否影響 Slice 4 結算：`finishLive`/`commitSession` 一行不動；R3 驗收必重跑「結算第一幕數字=HUD 末值」比對。
3. 是否影響第二幕：金幣=session=錢包增量三方比對重跑；`rewardIslandLine`/nextGoal 同數字重驗。
4. 島嶼目標條：R3 跑完一輪後目標條即時更新照常。
5. 簡介頁承諾兌現：R3 後「3 組 × 12 下 · 組間休息 30 秒」（planText 同源）與實際流程**首次一致**——這是 Slice 2/3 跨 Slice 的驗收亮點，驗收報告需記錄。

## 七、建議下一步

1. **下一步先做 Slice 3 R2**：是——本計畫蓋章後即可動工（低風險、半天級）。
2. **暫時不要做 R3**：對——R3 等 R2 驗收（byte-diff=IDENTICAL＋41/41）後單獨開工。
3. **R3 何時可以開始**：R2 驗收通過即符合全部前置條件（版型凍結＋函式化＋本計畫已審）。
4. **R3 開始前需要補的計畫/互審**：**不需再補**——本文件三/五/六節即為 Workflows 要求的迷你計畫；唯一例外：實作中發現需偏離規格 → 回本文件修訂重審。
5. **R2 實作提示詞**（可直接貼）：

```
請只處理 Slice 3 R2：版型函式化（零行為變化）。

請閱讀：
1. docs/planning/Slice3_R2_R3_迷你實作計畫.md（本輪唯一依據；只做二節 R2，不做三節 R3）
2. docs/planning/Slice3_第一輪驗收報告.md（R1 基準：三畫面版型與層級契約不得改變）
3. docs/CONTRACTS.md（§9：drawCountdownRing 舊簽名不可改）

這次只做：
1. workout.js：liveShell 內 #lv-gate/#lv-rest 兩段 DOM 抽成 gateHtml()/restHtml({setIdx,totalSets,restSec,nextReps})
   純模板函式（R2 以寫死值呼叫，輸出 HTML 與 R1 逐字相同——重構前先抓 liveShell 輸出做 byte-diff 基準）
2. app/ui/feedback.js：僅新增 export drawProgressRing(ctx, ratio, opts)（次數進度環繪製；本輪不在任何迴圈呼叫），
   既有函式與簽名零改動

請不要：
1. 不要接任何邏輯（gate 判定/組數/雙態切換/跳過休息——全部歸 R3）
2. 不要碰 run-token、startLive～finishLive 任何邏輯行、SET_SECONDS、checkEndingCues、drawRingAndHud
3. 不要修改 app/core、tests 舊斷言（41/41 基線）、vendor、CONTRACTS、store
4. 不要破壞 Slice 1/2/4/4R3 與 Slice 3 R1 成果（三畫面預設 hidden/層級契約/[hidden] 保護原樣）

完成後請回報：
1. liveShell 輸出 byte-diff 結果（必須 IDENTICAL）
2. node tests/run.js（41/41）＋console 0 error＋示範模式一輪照常
3. drawProgressRing 可獨立呼叫的驗證
4. diff 範圍自查（僅 liveShell 模板段函式化＋feedback.js 新增 export）
```

<!-- cross-model-review: APPROVED reviewer=codex hash=a227e231b119bc1a at=2026-07-05T13:28:24+08:00 -->
