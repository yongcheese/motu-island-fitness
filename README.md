# Island Fitness AI — AI 健身辨識與島嶼建設連動系統

> 育秀盃創意獎 · AI 應用類　|　可實機展示的網頁應用（單鏡頭 · 零額外硬體 · 可離線）

把「一支家裡就有的鏡頭」變成準教練級的即時動作矯正；並以島嶼建設遊戲把運動成果視覺化，
建立「**正確訓練 → 金幣 → 島嶼成長 → 再訓練**」的正向循環。
核心理念：**不是計次，而是品質確認**——只有「完整週期＋達標深度＋無代償」的動作才算有效，才換得到金幣。

---

## 🚀 快速啟動（評審 / Demo）

```bash
bash serve.sh            # 或: python3 serve.py 8080；也可雙擊「啟動 Island Fitness AI.command」
```
瀏覽器開啟 **http://localhost:8080** 。建議用 Chrome / Edge / Safari，允許相機權限。

- 全部 AI 模型與函式庫已 vendor 至 `vendor/`，**斷網也能完整運作**。
- 無相機時會自動提供「**示範模式**」，用合成動作序列餵入同一套 AI 引擎，眼見為憑。
- 相機影像只在瀏覽器端處理，**不上傳**；資料以 localStorage 存於本機。

## ✅ 驗證（最硬的證據）

```bash
npm test                 # = node tests/run.js
```
56 項確定性測試全綠：四項動作（深蹲／開合跳／高抬腿／伏地挺身）的計次、半程/代償/作弊判否、
**鏡頭遠近與站位平移不變性**（標準化層）、防抖、遮擋暫停、計次冷卻、METs 熱量與 S/A/B/C 評級、
以及混合正負樣本 **≥ 90% 判定準確率**。

## 🧩 五大功能（底部 Tab）

| Tab | 功能 | 重點 |
|----|------|------|
| ☀️ 今日 | 首屏：今日任務與推薦 | 接真實訓練資料；一鍵進入推薦訓練 |
| 🏝️ 島嶼 | 用金幣建設等距島嶼 | 金幣只來自有效訓練（防刷）；成就解鎖主題建築 |
| 🏋️ 訓練 | **核心**：AI 即時判定＋矯正＋結算 | 三色骨架、分級語音、倒數光環、結算評級 |
| 📊 健康 | 訓練數據視覺化 | 本週 vs 上週對比、卡路里趨勢、達標率、常見錯誤 |
| ⚙️ 設定 | 個人化 | 身高體重 → 影響標準化與熱量；隱私匯出/刪除 |

## 🏗️ 技術架構（對應企劃「五層判定防線」）

```
互動層   三色骨架 / 分級語音教練 / 結算報告 / 島嶼遊戲
邏輯層   動作狀態機 FSM + 六層防作弊 + 計次冷卻
標準化層 肩寬/腿長比例尺 → 動態判定門檻（系統關鍵層）
辨識層   MediaPipe Pose 33 點 + 信心值過濾 + 入鏡檢查
輸入層   webcam 取像 / 鏡像 / 多人排除
```

- **核心引擎為純函式**（`app/core/`），瀏覽器與 Node 共用 → 可做確定性測試。
- MediaPipe Pose（`@mediapipe/tasks-vision`）即時擷取 33 關鍵點；規則式狀態機計次。
- 圖表用 Chart.js（已 vendor）。無框架、無打包步驟、原生 ES Modules。

## 📁 專案結構
```
index.html              app shell
serve.py                本機伺服器（no-cache＋正確 MIME；serve.sh 與 .command 都呼叫它）
app/main.js             導覽外殼：掛載各 feature、topbar / tabbar / toast
app/core/               純函式引擎：geometry / normalize / engine / exercises / calories / coach / pose / synth
app/ui/                 渲染元件：feedback（三色骨架）/ pose3d / avatar3d / character
app/state/store.js      單一狀態源 + localStorage（commitSession 為唯一加幣入口）
app/features/           today / island / workout / tracking / settings 五大分頁
tests/                  Node 可跑的 eval 套件（合成 landmark，npm test）
vendor/                 MediaPipe WASM/模型、Chart.js、Three.js、字型（離線）
docs/                   文件；先看 docs/README.md 文件地圖（現行 vs 歷史）
企劃文件/                競賽企劃書、DEMO PPT 來源稿
```

## 📐 動作判定（首期 10 項，MVP 完整實作＋測試前 4 項）
深蹲 · 開合跳 · 高抬腿 · 伏地挺身（已實作並測試）；弓箭步 · 波比跳 · 仰臥起坐 · 捲腹 · 臀橋 · 側弓步（規格規劃中）。

---
本作品為育秀盃企劃之**可實機原型**。判定門檻以人體幾何比例表示，對不同身形與鏡頭距離維持一致。
