# Slice 3 取景顏色語意補修計畫（P1 真機回報第二輪）（2026-07-05）

> 觸發：P1 修正後真機測試——gate 取景階段顏色已對（青），但**站到正確位置、準備開始那一刻，畫面又變回綠色**，仍讓使用者誤以為「姿勢正確」。
> 本文件為**實作計畫**，動工前須經 cross-model 互審蓋章。本輪只做取景顏色補修，不碰辨識門檻/detector/signal/depth/angle/語音/app-core/run-token/組數狀態機/結算。
> 依據：`Slice3_體驗校準最小修正計畫.md`（P1）、`Design_System_收斂版.md`（§三 frame-* token 已立）、`docs/CONTRACTS.md`（§5 FrameResult：`res.phase` 已存在）。

---

## 一、漏點診斷（讀碼定位）

P1 只改了 **gate 等待階段**（骨架 ALL_FRAME 藍、檢查燈 --frame-ok、追蹤膠囊 frame-*）。但綠色其實漏在**下一個階段**：gate 通過（全綠 2 秒）→ 321 倒數 →「開始！」→ `runCameraLoop` 第一幀 `handleResult` 執行時，使用者**只是站著、還沒開始做動作**，此時：

| 綠色來源 | 程式（互審修正落點） | 為何綠 |
|---|---|---|
| **骨架**（最顯眼） | **相機迴圈** `runCameraLoop` L817 `drawSkeleton(live.ctx, lm, res.segments, ...)`（**不是 handleResult**——互審 BLOCKING #1：骨架在呼叫 handleResult 前就畫完了） | 站著無錯誤→`res.segments` 全綠 |
| **週期燈「起始」** | `handleResult` L951 `st = res.visible ? STAGE_OF[res.phase] : undefined` | `res.phase='READY'`→index 0 亮綠（`.lv-stages span.on` = `--green`） |
| **深度量表 fill** | `handleResult` L955 `hud.gfill.dataset.c = res.color` | 站著 `res.color='green'`＋預設 `background: var(--green)` |
| **倒數「開始！」**（互審 BLOCKING #3 補列） | `runCountdown` 的 `.lv-count.go`（workout.css L150 `color: var(--green)`） | 「開始！」字是綠——正是「準備開始那一刻」的綠 |

**根因**：`res.phase` 有 `IDLE/READY`（站著、未開始動作）vs `CONCENTRIC/TARGET/ECCENTRIC`（動作進行中）之分，但**呈現層對兩者一視同仁上綠**——於是「站著準備」被畫成「姿勢正確」的綠。

**關鍵洞見**：顏色（紅黃綠）只有在「**有動作可評估**」時才有意義。站著不動（IDLE/READY）＝還在準備＝應維持取景藍，不是綠。

## 二、補修規格（純呈現層，讀 `res.phase`，零 app/core）

**核心規則（互審 BLOCKING #2：必須加 `visible` guard——`IDLE` 也代表「看不到人/入鏡失敗」，不可被藍色蓋掉 warn/red/coach）**：
定義單一判斷 `framingPose(res) = res.visible !== false && (res.phase === 'IDLE' || res.phase === 'READY')`（helper，兩處共用）：
- **取景態**（`framingPose` 為真＝**看得到人**且站著未做動作）：骨架 **ALL_FRAME 藍**、週期燈**不亮**、量表 fill **取景藍**、倒數「開始！」**藍**。
- **看不到人**（`res.visible === false`）：**維持現行**——warn 膠囊/coach 提示不被覆蓋（藍只在看得到人時套）。
- **動作進行態**（看得到人＋`CONCENTRIC/TARGET/ECCENTRIC`）：**維持現行**——骨架 `res.segments` 紅黃綠、週期燈 STAGE_OF 亮、量表 `res.color` 三色。

四處落點：
1. **骨架**（互審 #1：改**相機迴圈** L817，非 handleResult——骨架在呼叫 handleResult 前就畫完）：`drawSkeleton(live.ctx, lm, framingPose(res) ? ALL_FRAME : res.segments, {...})`。
2. **週期燈**（handleResult L951）：`const st = (res.visible !== false && !framingPose(res)) ? STAGE_OF[res.phase] : undefined;`——取景態不亮、看不到人維持 undefined、動作態照亮。
3. **深度量表**（handleResult L955）：`hud.gfill.dataset.c = framingPose(res) ? 'frame' : res.color;`——取景態藍、其餘維持 `res.color`。
4. **倒數「開始！」**（互審 #3）：`.lv-count.go` 由 `color: var(--green)` → `var(--frame-ok)`（藍）——「準備開始」轉場提示、非姿勢判定。

**追蹤膠囊**：訓練中「● 追蹤中·33 點」維持 `ok`（綠）——**這是對的**（那是「系統看得到你」的狀態指示，非姿勢判定；DS 元件 #6 訓練 ok=green 保留）。**不改**。

**✓/✗ 計次閃現**：維持——`✓ +1` 綠是「這一下有效」的計次結果（真的有動作、真的計次了），語意正確、保留。

## 三、檔案三分

| 類別 | 檔案 | 範圍 |
|---|---|---|
| 可修改 | `workout.js` | 新增 `framingPose(res)` helper；相機迴圈骨架 site（L817）＋handleResult 週期燈（L951）/量表（L955）三處套 helper（`res.phase/visible` CONTRACTS 已有、ALL_FRAME 已存在） |
| 可修改 | `workout.css` | 新增 `.lv-gauge-track i[data-c="frame"]`（藍）＋`.lv-count.go` 由 `--green`→`--frame-ok`——既有 green/yellow/red 規則不動 |
| 禁區 | `app/core/**`、detector/signal/depth/angle/門檻、drawSkeleton 簽名與訓練預設、run-token、組數狀態機、finishLive/結算、語音、tests 舊斷言、vendor、訓練三色 token | 不動 |

**不做**：不改引擎如何產 segments/phase/color（照吃）；不動門檻；不碰語音；不加動畫；不動 gate 等待階段（P1 已對）。

## 四、完成標準

1. **準備態（站著）＝藍**：訓練一開始站著不動時，骨架/週期燈/量表**不是綠**（藍/灰）。
2. **動作態＝紅黃綠**：真正做深蹲時（下蹲→到底→起身），骨架與量表回三色、週期燈亮——訓練判定回饋完整保留。
3. gate 等待階段（P1）不受影響。
4. `res.phase` 只讀不改；detector/signal/門檻零觸碰。
5. `node tests/run.js` 46/46；0 console error。
6. Slice 1/2/4/4R3、run-token、組數狀態機、結算未破壞。
7. 交付使用者真機複測：站著準備＝藍、開始做動作才紅黃綠、做對一下 `✓+1` 綠閃現照常。

## 五、測試方式

1. `node tests/run.js` 46/46。
2. 骨架色切換以真機/相機路徑驗證（demo 主要 render 3D avatar 不走相機骨架繪製）；週期燈/量表色切換 demo 仍可 phase 取樣觀察。
3. headless computed style：`.lv-gauge-track i[data-c="frame"]` = 藍；訓練 green/yellow/red 規則值不變。
4. Slice 4 下游鏈 demo 跑完照常（結算/島嶼）。
5. 交付真機複測清單（四-7）。

## 六、下一步實作提示詞（只做本補修）

```
請只處理 Slice3 取景顏色補修：準備態（站著未做動作）不要綠色。

請閱讀：
1. docs/planning/Slice3_取景顏色補修計畫.md（本次唯一範圍）
2. docs/CONTRACTS.md（§5 FrameResult：res.phase IDLE/READY/CONCENTRIC/TARGET/ECCENTRIC——只讀）

這次只做：相機骨架 site + handleResult HUD 依 framingPose(res) 分流顏色——站著(看得到人+IDLE/READY)用取景藍，做動作(CONCENTRIC/TARGET/ECCENTRIC)才用訓練紅黃綠。

請完成：
1. workout.js：新增 helper framingPose(res) = res.visible !== false && (res.phase==='IDLE' || res.phase==='READY')
   - 骨架（相機迴圈 L817，非 handleResult）：drawSkeleton(live.ctx, lm, framingPose(res) ? ALL_FRAME : res.segments, {w,h,mirror})
   - 週期燈（handleResult L951）：const st = (res.visible !== false && !framingPose(res)) ? STAGE_OF[res.phase] : undefined
   - 深度量表（handleResult L955）：hud.gfill.dataset.c = framingPose(res) ? 'frame' : res.color
2. workout.css：新增 .lv-gauge-track i[data-c="frame"] { background: var(--frame-ok); box-shadow: 0 0 12px color-mix(in srgb, var(--frame-ok) 55%, transparent); }
   ＋.lv-count.go 由 color: var(--green) → var(--frame-ok)——既有 green/yellow/red 不動

請不要：
1. 不要改 app/core、detector/signal/depth/angle/門檻、drawSkeleton 簽名與訓練預設
2. 不要改 run-token、組數狀態機、finishLive/結算、語音
3. 不要動 gate 等待階段（P1 已對）、不要動追蹤膠囊訓練 ok=green、不要動 ✓/✗ 閃現
6. 不可讓「看不到人」(res.visible===false) 被藍色覆蓋——藍只在 framingPose(看得到人+IDLE/READY) 時套
4. 不要改訓練三色 token、tests 舊斷言、vendor
5. 不要破壞 Slice 1/2/4/4R3

完成後回報：
1. 修改檔案與 diff（runCameraLoop 骨架 site＋handleResult 兩處＋framingPose helper＋CSS 兩條）
2. 準備態藍、動作態紅黃綠（demo phase 取樣或截圖）
3. node tests/run.js（46/46）＋0 error
4. 是否需真機複測
```

<!-- cross-model-review: APPROVED reviewer=codex hash=73467239dacfa0e9 at=2026-07-05T20:34:15+08:00 -->
