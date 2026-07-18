# Slice 3 R3 施工前互審確認（2026-07-05）

<!-- cross-model-review: skip（本文件為施工前確認清單，非實作計畫；R3 的實作計畫＝已蓋章的 Slice3_R2_R3_迷你實作計畫.md） -->

> 目的：R3（全案最高風險輪）開工前的最後閘門——逐項確認 R2 完成、授權計畫有效、動工前必查事項（durationSec audit）已跑、下游保護清單就位。
> 本輪只做確認，未修改任何程式碼。
> 備註：模板第 3 節後半（summary 起）與第 4~5 節於使用者訊息中亂碼，依迷你計畫五/六節重建。

---

## 一、Slice 3 R2 是否已完成 ✅

| 檢查項 | 結果 |
|---|---|
| liveShell byte-diff | **IDENTICAL**（3020→3020 bytes，同步 tick 內抓取比對） |
| `node tests/run.js` | **41/41 綠**（本確認輪剛重跑一次仍綠） |
| console | **0 error**（含示範模式完整一輪＋結算兩幕＋回清單） |
| `drawProgressRing` 可獨立呼叫 | ✅（瀏覽器 import 實測：有像素輸出、clamp 餵 1.7/−0.3 不噴錯） |
| `drawCountdownRing` 舊簽名 | **未改**（feedback.js diff＝0 刪除行、8 新增行——純新增 export） |
| run-token／組數狀態機 | **未動**（workout.js 52 行 diff 全在 liveShell 模板段，時序關鍵字掃描=0） |
| debug hook 殘留 | 0 處（本確認輪 grep 複核） |

**R2 驗收：通過。**（`gateHtml()`/`restHtml({setIdx,totalSets,restSec,nextReps})` 已參數化——R3 接真資料只改呼叫端。）

## 二、R3 這輪要做什麼（規格＝迷你計畫三節，已蓋章凍結）

| # | 項目 | 規格出處 |
|---|---|---|
| 1 | **統一時鐘**：`live.elapsedMs` 重定義為累計 WORK 時間；時鐘契約=每幀無條件 `dt = now − lastFrameTs; lastFrameTs = now;`、僅 `WORK && !paused` 累加；迴圈進入與 resume 邊界強制重設（雙保險） | 3-2 |
| 2 | **組數狀態機**：`live.set{idx,total,target,baseValid,lastValid,phase,phaseStartTs,restSec}`；WORK→(組完成 snapshot setEndValid)→REST→(歸零/skipRest)→下一組；最後一組→finishLive | 3-2 |
| 3 | **gate 接線**：`waitForFraming(run): Promise<{ok}>`（必定 settle；mismatch→清理+false）＋呈現層 `framingReady(lm, spec)`（gateLandmarks 可見度≥0.5）＋全綠連續 2000ms（paused 不累積、resume 歸零）＋caller 二次 token 檢查；**僅 camera 路徑，demo 跳過（申報）** | 3-3 |
| 4 | **雙態倒數欄成對切換**：時間態（#m-cd＋倒數標籤）⇄次數態（lv-set-progress＋lv-set-label），四元素一次切、兩態互斥（R1 版型＋`.lv-cdmetric` selector 已備） | 3-2 |
| 5 | **90 秒安全網**：`SAFETY_SECONDS=90`（SET_SECONDS 退役）；WORK 工作時間≥90s 視同組完成；前 10 秒沿用 checkEndingCues 語彙 | 3-2 |
| 6 | **跳過休息綁事件**：token 契約——handler 只設 `run.skipRest` 旗標、迴圈內消費、進出 REST 綁定/解除 | 3-2 |
| 7 | **restHtml 接真資料**：`restHtml({setIdx, totalSets, restSec: ex.meta.restSec, nextReps: ex.meta.repsPerSet})` | 3-2 |
| 8 | **休息卡文案 planText(meta) 同源**：組數/次數/休息秒一律出自 `ex.meta`（planText 的資料源），不得另寫死 | 3-2＋五-12 |

環繪製：WORK=`drawProgressRing(ctx, clamp(setValid/target,0,1))`／REST=休息倒數環（沿用 drawCountdownRing）；REST 最後 3 秒 beep 用既有 `lastBeepSec` 秒邊界。

## 三、R3 絕對不能破壞什麼

1. Slice 1 首頁／今日層／島嶼主畫面。
2. Slice 2 今日推薦卡／訓練前流程（renderMenu/renderIntro/四純函式）。
3. Slice 4 兩幕結算流程與 CTA 契約（renderResult 僅接收、renderReward 零改動）。
4. Slice 4 R3：goals.js／nextGoal／canBuy 簽名與錨定、島嶼目標條。
5. 第二幕島嶼行「同函式同數字」。
6. **summary／session schema**：零改動（唯一申報項＝durationSec **語意**變為「有效運動時間」，值域 audit 見四節）。
7. `finishLive` 的 `!live.started` 守門與 `commitSession` 呼叫（一行不動）。
8. 既有 run-token 檢查點（7 處一個不能少；新增 3 處見五節）。
9. `drawCountdownRing` 簽名（CONTRACTS §9）；`coach.js` 只增不改（本輪不動）。
10. 相機拒絕→offerDemo 路徑；暫停「計數凍結」語義。
11. `app/core`／`tests` 舊斷言（41/41 基線）／`vendor`／CONTRACTS。
12. 防刷鐵則：金幣只由 commitSession 產生。

## 四、durationSec 值域 audit（迷你計畫六-0「動工前必查」——已跑，結果如下）

| 消費者 | 位置 | 判定 |
|---|---|---|
| `estimateCalories` | calories.js:3-4（durationSec/3600 線性） | ✅ 接受任意值域；active 時間讓卡路里更誠實 |
| `commitSession` | store.js:64/71/79（safeNum 消毒＋Math.round） | ✅ 無值域假設 |
| tracking 統計 | tracking.js:82/137-138（純分鐘加總） | ✅ **無「單次≤60s」假設** |
| 成績單時長格 | workout.js（fmtTime(session.durationSec)×2 處） | ✅ 顯示運動時間，語意更準 |
| `coinsFor`／`renderReward` | 不消費 duration | ✅ |
| workout.js 內部 | L576 pause handler／L637/644/724-725 兩迴圈時鐘／L661/743 收束／L818-819 remain／L823 kcal／L540 HUD 初值 | 全部在迷你計畫 3-2 改寫白名單內 |

**audit 附帶發現（施工注意）**：暫停 handler L576 的 `startTs = performance.now() − elapsedMs` 平移行，在累加制時鐘下需換成「resume 時 `lastFrameTs = performance.now()`」——**1 行級替換**，在計畫 3-4-6 容許範圍（超過 2 行才停工重審）內；另 L540 HUD 倒數格初值 `${SET_SECONDS}` 需同步改為次數態初值（`0/${target}`）。兩者列入施工清單，驗收報告申報。

## 五、run-token 檢查點與時序測試（引用迷你計畫五節，施工必勾）

- 檢查點 10 處：既有 7（startLive×3、preStart、runCountdown、兩迴圈頂部）＋新增 3（gate 迴圈每幀／gate 後 caller 二次檢查／skipRest handler 旗標）。
- 時序測試 14 條：載入中退出／gate 退出／暫停恢復／**組間退出結算**／跳過休息／完整 N 組（camera+demo）／90s 安全網／offerDemo／再一次／快速退出重進×3／gate 暫停凍結／REST 暫停凍結／**demo 零 catch-up（fed 差值=0）**／durationSec 抽查。
- Slice 4 下游驗證：結算數字=HUD 末值、三方金幣比對、第二幕島嶼行、目標條即時更新、**簡介承諾首次兌現**（3 組×12＋休息 30 秒＝實跑）。

## 六、最後判斷

**可以開始 Slice 3 R3 實作。** 理由：R2 驗收通過（一節）、授權計畫已蓋章且規格經 3 輪 8 BLOCKING 收斂、動工前必查（durationSec audit）已完成且全綠、下游保護與測試清單就位；無缺項。
**Codex 最終確認（同一互審脈絡）**：兩項 audit 附帶發現（pause handler 1 行替換、HUD 初值）均認可屬計畫內、不需重審——回覆原文：`GO: R3 APPROVED TO START`。

**R3 實作提示詞**（可直接貼）：

```
請只處理 Slice 3 R3：高風險接線輪（單獨施工，嚴禁夾帶其他改動）。

請閱讀：
1. docs/planning/Slice3_R2_R3_迷你實作計畫.md（已蓋章授權；三節=規格、五節=檢查點與測試清單、六節=下游驗證）
2. docs/planning/Slice3_R3_施工前互審確認.md（四節 audit 附帶發現：pause handler 1 行替換＋HUD 初值，須照做並申報）
3. docs/CONTRACTS.md（§5 Detector／§9 drawCountdownRing 不可改）

這次只做（規格一字不偏離迷你計畫 3-1～3-3）：
1. 統一時鐘：elapsedMs 改累計 WORK 時間；時鐘契約逐字實作（每幀無條件 dt/lastFrameTs 貼緊、僅 WORK&&!paused 累加、
   迴圈進入與 resume 邊界強制重設）；pause handler 的 startTs 平移行換成 resume 重設 lastFrameTs（1 行，申報）
2. 組數狀態機 live.set（WORK/REST、setEndValid snapshot、90s 安全網 SAFETY_SECONDS=90、SET_SECONDS 退役、
   HUD 倒數格初值改次數態 0/target）
3. gate 接線：waitForFraming(run) Promise 必 settle＋framingReady(lm, spec) 呈現層純函式＋全綠 2000ms
   （paused 不累積、resume 歸零）＋caller 二次 token 檢查；僅 camera 路徑、demo 跳過
4. 雙態倒數欄成對切換（四元素互斥）；WORK 環=drawProgressRing(clamp)、REST 環=休息倒數；REST 末 3 秒 beep 用 lastBeepSec
5. 跳過休息：handler 只設 run.skipRest 旗標（if (live !== run) return;）、迴圈內消費、進出 REST 綁定/解除
6. restHtml 接真資料（ex.meta 同源；勿另寫死）；demo 迴圈同步支援組結構

請不要：
1. 不要動 finishLive 守門/commitSession 呼叫、summary/session schema、renderResult/renderReward、goals.js
2. 不要改 drawCountdownRing 簽名、不要動 coach.js/app/core/tests 舊斷言/vendor/CONTRACTS
3. 不要刪任何既有 run-token 檢查點；新增僅限盤點表 #8~#10 三處
4. 若需偏離規格（如 pause 改動超過 2 行）→ 停工回報，回迷你計畫修訂重審

完成後請回報：
1. 五節 10 個檢查點逐一勾核＋14 條時序測試逐條結果
2. 六節下游驗證（結算=HUD 末值、三方金幣、第二幕/目標條、簡介承諾兌現）
3. durationSec 抽查值＋demo 零 catch-up 佐證（fed 差值）
4. node tests/run.js（41/41）＋console 0 error＋diff 範圍自查
5. 兩項申報（pause handler 1 行、HUD 初值）的實際 diff
```
