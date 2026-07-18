# Slice 3 R3 驗收報告（2026-07-05）

<!-- cross-model-review: skip（本文件為驗收報告，非實作計畫） -->

> 驗收對象：Slice 3 R3「高風險接線」——統一時鐘／組數狀態機／gate 取景關卡／雙態切換／90s 安全網／跳過休息，依 `Slice3_R2_R3_迷你實作計畫.md`（已蓋章，三輪互審 8 BLOCKING 收斂）＋`Slice3_R3_施工前互審確認.md`（Codex `GO: R3 APPROVED TO START`）執行。
> 驗收方式：demo 路徑三輪實測（含 324 筆密集取樣）＋確定性雙重比對＋run-token/凍結區 diff 掃描；本報告為結果整理，本輪未修改任何程式。
> 備註：驗收模板多處於使用者訊息中亂碼，依可見節號重建為十三節。

---

## 一、實際修改摘要（重建後半）

| 檔案 | 改動 |
|---|---|
| `workout.js`（229 行 diff，全在授權範圍） | ①`SET_SECONDS` 退役→`SAFETY_SECONDS=90` ②live 初始化加 `set/lastFrameTs/skipRest` ③pause handler 1 行（申報：startTs 平移→resume 重設 lastFrameTs）④preStart 插 gate（僅 camera；demo 跳過）＋`waitForFraming`/`framingReady`/`GATE_ROWS` ⑤狀態機五函式（initSetState/setCdMode/enterRest/enterWork/advanceSetPhase）⑥兩迴圈改統一時鐘＋相位分流（含 REST 幀 clearRect——施工自查追加，防環殘影）⑦drawRingAndHud 相位感知（WORK=drawProgressRing/REST=休息倒數環）⑧liveShell 倒數格初值改次數態 `0/${target}`（申報） |
| `workout.css` | 1 行：hidden 保護整併為 `.lv-cdmetric > [hidden]`（涵蓋雙態四元素） |

新增/刪除檔案：無。三項申報（pause 1 行／HUD 初值／REST clearRect+CSS 整併）均為規格自然組成，前兩項 Codex 施工前已認可。

## 二、是否符合 R3 規格（重建章節）

迷你計畫三節 8 項全數落地：統一時鐘（時鐘契約逐字實作）✅、組數狀態機 ✅、gate 全綠 2 秒 ✅（實作面；端到端見五節）、雙態成對切換 ✅、90s 安全網 ✅、skipRest token 旗標 ✅、restHtml 真資料 ✅（「第 1 組完成／30 秒／下一組：第 2 組 · 12 下」實測）、planText 同源 ✅（全部出自 ex.meta）。

## 三、run-token 與流程穩定檢查

1. **run-token 判斷點保留**：既有 7 處一個未動（diff 掃描）；全檔 `live !== run` 現為 17 處（含新增 3 檢查點與其輔助）。
2. **未繞過 run-token**：gate/skip/狀態機全部長在既有單迴圈模式或 Promise 契約內；waitForFraming mismatch→清理+resolve false；caller 二次檢查後才進倒數。
3. **無不受控流程**：未新增任何 await/setTimeout 鏈（gate 為 rAF＋必 settle Promise）。
4. **startLive/finishLive 穩定**：finishLive 本體零改動（`live.finished` 防重入＋`!live.started` 守門均在）；快速退出重進 ×3 實測 0 error。
5. **完成判定正確**：demo 3 組×12 → 恰 36 valid 結算（兩輪逐位元一致：36/50s/414🪙/A——確定性合成序列雙重佐證）。
6. **90s 安全網不誤觸發**：workMs 僅於 `WORK && !paused` 累加——REST/暫停不可能推進；實測全程未誤觸（每組 ~15-18s 遠低於 90）。
7. **跳過休息不跳過結算**：skip 只做 REST→WORK 轉換（旗標消費在迴圈內）；結算唯一入口仍是 `advanceSetPhase` 回傳 'finish' → finishLive。
8. **無重複完成/重複結算**：'finish' 分支 `return finishLive()` 直接退出迴圈；finishLive 首行 `live.finished` 防重入。

## 四、組數狀態機檢查

1. **狀態**：`WORK`／`REST`（僅二態；gate 是進迴圈前的等待，不屬狀態機）。
2. **進入條件**：WORK＝initSetState（第 1 組）或 REST 結束（第 2+ 組）；REST＝setValid≥target 或 workMs≥90s 且 idx<total。
3. **離開條件**：WORK→REST（上述）或 WORK→finish（idx===total 且達標/安全網）；REST→WORK（restRemain≤0 或 skipRest）。
4. **訓練→休息**：組完成 → snapshot `setEndValid=lastValid` → enterRest（重繪休息卡真資料＋綁 skip＋切時間態＋cue 旗標重置）。
5. **休息→下一組**：enterWork（idx++、`baseValid=setEndValid`、切次數態、隱藏休息卡）。
6. **最後一組→完成**：`idx≥total` 時不進 REST、直接 `return finishLive()`。
7. **90s 安全網介入點**：advanceSetPhase 的 WORK 分支（與達標判定同一處，or 條件）。
8. **跳過休息**：handler 只設當前 run 旗標；下一幀 REST 分支消費 → enterWork。實測進度歸零正確（8/12↔總 20、1/12↔總 25）。
9. **可能卡死？否**——WORK 有 90s 上界、REST 有 restSec 上界（或 skip）、兩者皆受 paused 凍結但恢復即續走；每相位皆有必然出口。
10. **可能重複結算？否**——見三-8（單一出口＋防重入旗標）。

## 五、gate 取景關卡檢查

1. gate 只在需要取景時顯示：✅ 條件 `run.mode !== 'demo' && run.pose`（demo 合成幀恆可見故跳過——已申報；相機/模型失敗無 pose 也不顯示）。
2. 全綠 2 秒才通過：✅ `readyMs` 累積制、任一燈滅即歸零、paused 幀不累積且歸零（保守）。
3. 遮罩 `pointer-events: none`：✅（R1 CSS 未動）。
4. gate 顯示時退出鈕可點：✅（R1 已實測 elementFromPoint 命中；本輪 CSS 零改動）。
5. 不阻擋頂欄：✅（z 契約 4<7 未動）。
6. 失敗/未取到鏡頭：✅ 相機失敗走既有 offerDemo（gate 根本不啟動）；版型缺失時 `resolve({ok:true})` 保守放行不擋流程；token 失效 `resolve({ok:false})` 清理退出。
7. ⚠️ **誠實聲明：camera 路徑 gate 端到端未實測**——headless 環境無法產生真 landmark（getUserMedia 無真影像）。已完成：規格逐字實作＋`framingReady` 純函式邏輯＋Promise 契約自查＋demo 跳過驗證。**需使用者開真相機實測一次**：站入框→三燈逐一點亮→全綠 2 秒→自動 321 倒數；以及 gate 中退出/暫停。列為本驗收唯一保留項。

## 六、統一時鐘與 durationSec 檢查（重建章節）

1. 時鐘契約逐字落地：每幀無條件 `dt/lastFrameTs` 貼緊；僅 `WORK && !paused` 累加。
2. **REST 中 m-time 完全凍結**：324 筆取樣、兩段 REST 各單一值、`restChanges=0`（首測 false 經密集取樣定性為邊界幀 artifact，非缺陷）。
3. **demo 零 catch-up**：跳過/休息結束瞬間總次數零暴增（≤1=進行中動作自然收尾）；feed target 派生自 active clock。
4. **durationSec=有效運動時間**：3 組跑完 50s（15+17+18）vs 牆鐘 >110s；組間退出場景 16s——值域與語意全符合申報；卡路里以 active 時間計不虛胖。
5. 暫停影響表五時間量實測：elapsedMs 凍結、REST 剩餘凍結且恢復不跳秒（r3==r4、resume 平移）✅；WORK 安全網與 demo feed clock 由同一機制保證；gate 暫停歸零屬五-7 保留項。

## 七、雙態倒數欄與休息卡檢查（重建章節）

1. 初值即次數態 `0/12`（申報項落地）；WORK 顯示 `setValid/target` 逐幀更新。
2. REST 切時間態：`#m-cd` 顯示休息剩餘秒、次數對隱藏——四元素成對互斥（R1 驗證器同款檢查邏輯）。
3. 休息卡真資料：組序/秒數/下一組次數全出自 `ex.meta`（planText 同源）；每次進 REST 以 restHtml 重繪。
4. 環雙語意：WORK=`drawProgressRing`（teal、clamp）／REST=`drawCountdownRing` 消退；REST 幀 clearRect 防殘影（申報）。
5. 截圖：`screenshots/slice3-r3-rest-live-1200.png`（真流程休息卡）。

## 八、Slice 4 兩幕結算保護檢查

1~5. 結算第一幕資訊/評級/六格：✅（12 與 36 valid 兩種場景皆與 HUD 末值一致）。
6. 第二幕島嶼行：✅ 「已建 3 棟 · 能量塔：完成 10 次訓練解鎖」照常。
7. 回島 CTA：✅ 去蓋房子→島嶼、目標條同文案。
8. 再訓練 CTA：✅。防刷三方比對：+414＝session＝錢包增量 ✅。

**結論：Slice 4 兩幕結算流程未被破壞。**

## 九、Slice 1／Slice 2／Slice 4 R3 保護檢查

**Slice 1**：今日層/島嶼主畫面/任務卡/金幣 XP 等級/CTA——✅ 全部照常（實測）。
**Slice 2**：推薦卡（三輪 E2E 均由此進入）/型錄/開始 CTA/返回——✅。
**Slice 4 R3**：goals.js 時間戳未動；nextGoal/canBuy 錨定測試綠；目標條照常；第二幕同函式同數字 ✅；garden/dock/windmill 可購買測試綠。

**結論：Slice 1／Slice 2／Slice 4 R3 成果未被破壞。**

## 十、禁止修改區域檢查

| 區域 | 結果 |
|---|---|
| `app/core`（7/2）／`tests` 舊斷言（run.js 6/15）／`vendor`（6/19） | **未修改**；41/41 綠 |
| `docs/CONTRACTS.md` 既有簽名 | **未修改**（drawCountdownRing 原樣；drawProgressRing 為 R2 新增項） |
| `store.js`（6/30）／summary/session schema | **未修改**（durationSec 僅語意申報，audit 全綠） |
| `finishLive` 本體/`commitSession`/renderResult/renderReward/goals.js | **未修改**（diff 中 `finishLive()` 僅 4 處呼叫點＝授權的收束替換） |
| coach.js | **未修改**（僅呼叫既有 say API，與現行用法一致） |
| 健康頁／設定頁 | **未修改** |

## 十一、功能與測試檢查（重建章節）

- `node tests/run.js`：**41/41**（施工後與收尾各一次）；ESM 語法檢查過；console 全程 **0 error**。
- 時序測試 14 條結果：#1 守門 ✅／#3 暫停恢復 ✅／#4 組間退出結算 ✅（12 valid/16s）／#5 跳過休息 ✅／#6 完整 3 組 ✅（demo；**camera 版待實機**）／#9 再一次 ✅／#10 快速重進×3 ✅／#12 REST 暫停凍結 ✅／#13 零 catch-up ✅／#14 durationSec ✅／補：REST m-time 凍結 ✅；**#2 gate 退出、#7 90s 安全網實測、#11 gate 暫停＝待真相機**（安全網「不誤觸發」已由時鐘機制＋全程未誤觸佐證；「會觸發」需站著不動的真人場景）。
- 跨 Slice 亮點達成：**簡介頁承諾首次兌現**——「3 組 × 12 下 · 組間休息 30 秒」＝實跑流程（企劃落差分析最老的矛盾閉合）。

## 十二、遺留問題分類（重建前半）

| 分類 | 項目 |
|---|---|
| 1. 必須優先處理（實機驗證） | **gate 端到端真相機實測**（五-7；含 gate 退出/暫停/90s 安全網觸發）——使用者一次實測即可銷項 |
| 2. 可以留到 Slice 3 R4 | 教練文案人格化、低優先語音總結、休息環動畫、組完成慶祝、REST 期 checkEndingCues 的「最後十秒加油」文案在休息語境的措辭微調 |
| 3. 可以留到 Slice 4 R4 | 金幣飛行/計數滾動/落袋音（結算儀式） |
| 4. 可以留到 Slice 4 R2 | 金幣大數字/XP 條元件抽出 |
| 5. 可以留到其他 Slice | Slice 1 R3（任務欄位）、Slice 2 R3（推薦接任務）、Slice 5/6、橫切掃收（workout.css 硬編碼色+雙 :root） |
| 6. 暫時不用處理 | 型錄卡難度恆 1 點、XP 公式重複（均已標記待裁決） |

## 十三、是否可以進入下一階段

1. **Slice 3 R3：通過**（附一項保留：gate 真相機實測——不影響 demo 路徑與全部下游的通過判定）。
2. **需要補修嗎**：不需要——零缺陷；唯一保留項是「驗證」不是「修復」。
3. **可進 Slice 3 R4**：可以（低風險文案/動畫輪）。
4/5. **Slice 4 R4／R2**：均可（互不衝突；R4 儀式動畫是評審可見度最高的剩餘項）。
6. **下一步建議**：**先請使用者開真相機實測 gate 一次**（5 分鐘銷掉唯一保留項，也是 Demo 前必做的實機煙霧測試）→ 然後 **Slice 4 R4（結算儀式動畫）**——理由：Slice 3 的體驗骨架已完整（取景→組×次→休息→結算），剩餘輪次都是加分項；儀式動畫是「評審第一眼 wow」投報比最高的一項，且 R4 純表現層低風險；Slice 3 R4 文案可與其同週交錯進行（不同檔案區段）。
7. **為什麼**：黃金路徑＋訓練中核心體驗均已閉環，接下來的優先序應以「Demo 現場感染力」排序——儀式動畫 > 教練語氣 > 元件內部品質。

**驗收結論：Slice 3 R3 通過（保留 gate 實機驗證一項）。** 全案唯一高風險重構落地：時間制→課表制、儀表板→教練流程，34→41 測試與六個已完成 Slice 全數無損。
