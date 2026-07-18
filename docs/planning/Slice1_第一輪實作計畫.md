# Slice 1 第一輪實作計畫（今日層／首屏體驗／島嶼主畫面，2026-07-04）

> 依據：本專案專用規劃_重整版／Vertical_Slices_重整版／Slice_Workflows_重整版（Slice 1 章節）／Design_System_收斂版／SPEC／CONTRACTS／UI_REDESIGN_BRIEF。
> 本文件為「第一輪：UI 結構整理」的實作計畫；**本輪產出計畫，不改程式**。

---

## 一、Slice 1 目標

**解決的問題**：打開 App 的前 30 秒沒有故事——開場是安靜的 3D 島，沒有目標、沒有引導、看不出產品定位（企劃循環第 1 步「選擇訓練任務」斷裂；評審第一印象殺傷力排名第 1）。

**Slice 1 完成後的樣子**：打開 App，3 秒內看懂「我是誰（等級/金幣/連續天數）、今天要做什麼（今日任務）、做了有什麼好處（島嶼成長）」，並有一顆唯一的大 CTA「開始訓練」。

**第一輪（本計畫）的目標**：只做 **UI 結構與第一印象**——新增「今日」首屏的**靜態版**（任務資料寫死、玩家資料唯讀顯示），不做任務邏輯、不改 store schema、不做完整功能重寫。

## 二、第一輪任務範圍（做什麼）

1. 新增 `app/features/today/`（today.js＋today.css）：靜態今日層畫面。
2. `app/main.js`：註冊 today 為第一個 tab 並設為**預設頁**（取代現行預設 island）。
3. `index.html`：加一行 today.css 的 `<link>`（比照其他 feature CSS 的載入方式）。
4. 玩家狀態（金幣/等級/XP/連續天數）**唯讀**取自 `store.getState()`＋`subscribe`（display-only；不新增欄位、不寫入）。**生命週期鐵則**：`unmount()` 必須呼叫 `subscribe` 回傳的 unsubscribe；DOM 事件用 root 內事件委派或於 unmount 隨 innerHTML 清除——today 是首屏、會被反覆 mount/unmount，洩漏會累積重複 render。
5. 今日任務卡內容第一輪**寫死假資料**（例：「完成 20 個有效深蹲」進度 0/20），標注 TODO 於第三輪接真資料。
6. 島嶼視覺區塊：以**靜態樣式卡**呈現「我的島嶼」入口（漸層底＋文案＋建築數摘要（可讀 store.island.placed.length）＋「去看看」次要鈕→navigate('island')）。**不在今日層掛 Three.js**（避免雙 3D 場景的效能與生命週期問題；是否做即時縮圖留待後續輪次評估）。

## 三、不要做的事（本輪禁令）

1. 不要重寫 AI 偵測
2. 不要處理訓練流程（workout.js 一行都不動）
3. 不要處理結算流程
4. 不要處理健康頁
5. 不要處理設定頁
6. 不要加後端
7. 不要新增假資料庫（假資料只允許以常數寫在 today.js 內，不建任何持久化）
8. 不要一次大量動畫（只允許沿用既有 fadeUp 進場；打勾/環填充動畫屬第四輪）
9. 不要改 store schema（任務欄位是第三輪的事）
10. 不要動島嶼分頁本體（開場改由 main.js 預設 tab 決定，island.js 零修改）

## 四、預計修改檔案

### 1. 可能需要修改
| 檔案 | 原因 |
|---|---|
| `app/features/today/today.js`（新增） | 今日層 feature 本體（mount/unmount 契約同其他 feature） |
| `app/features/today/today.css`（新增） | 今日層樣式（只用 Design System tokens） |
| `app/main.js` | FEATURES/TABS 註冊 today、`show('today')` 取代 `show('island')` 為預設 |
| `index.html` | 加 today.css link（一行） |

### 2. 只讀不改
| 檔案 | 原因 |
|---|---|
| `app/state/store.js` | 只呼叫 getState/subscribe 顯示錢包/連續天數/島嶼建築數；不新增欄位不寫入 |
| `app/styles/lumina.css`、`app/styles/app.css` | 引用 tokens；雙 :root 裁決屬橫切掃收，不在本輪 |
| `docs/CONTRACTS.md` | 遵循 feature 契約（id/label/icon/mount/unmount/onShow）與 store API |
| `app/features/island/island.js` | 讀其分頁 id 供 navigate；本體零修改 |

### 3. 禁止修改
| 檔案 | 原因 |
|---|---|
| `app/core/**` | 核心引擎紅線（通用鐵則） |
| `tests/**` | 舊斷言不可動；本輪也不需新增測試（無邏輯變更） |
| `vendor/**` | 離線資產 |
| `app/features/workout|tracking|settings/**` | 其他 Slice 範圍 |
| `app/ui/**` | 公仔/回饋渲染與本輪無關 |

## 五、保留規則（必須原樣保留）

1. 核心 AI 邏輯：引擎、動作規格、正規化、合成器——零觸碰。
2. `app/core/`：唯讀。
3. `tests/`：34/34 綠是本輪完成的必要條件。
4. `vendor/`：不增不減不換版。
5. `docs/CONTRACTS.md`：feature 契約與 store API 簽名不變；today 必須完全符合既有 feature 介面（`{ id, label, icon, mount(root, ctx), unmount() }`；main.js 的 `onShow?()` 為選用欄位，**本輪不實作、不依賴**）。
6. 已穩定的島嶼資料/狀態：`island.placed/unlocked` 只讀不寫；島嶼分頁行為與現在完全一致。
7. 已存在且可用的金幣/XP/streak 資料邏輯：`wallet.*`、`streak.*` 只讀；**commitSession 防刷鐵則不受任何影響**（本輪甚至不呼叫它）。

## 六、UI 重整方向（依 Design_System_收斂版）

1. **首屏區塊順序**（上→下）：問候列（「早安，島主」＋日期）→ 今日任務卡（Mission Card）→ 島嶼視覺區塊（我的島嶼入口卡）→ 週目標橫條（靜態佔位）→ 主 CTA「開始訓練」。頂部全域狀態列（頭像/等級/XP/金幣）沿用現有 topbar，不重做。
2. **島嶼視覺區塊**：全寬卡、`--grad-card` 底＋薄荷光暈點綴；左側文案（「你的島嶼・已建 N 棟」）右側「去看看」Secondary 鈕；高度 ≤120px，不喧賓奪主。
3. **今日任務卡**：Design System 元件 #3（Mission Card）——大卡 24px padding、左任務文字＋進度句（「還差 20 個有效深蹲」）、右 goalRing 環（靜態 0%）；假資料常數集中檔首標注 `// TODO(R3): 接 store 任務欄位`。
4. **玩家狀態卡**：不另做卡——沿用全域 topbar（等級/XP 條/金幣）＋任務卡下方一枚 streak 火焰徽章（`🔥 連續 N 天`，讀 store.streak.current）。避免資訊重複。
5. **金幣/XP 顯示**：金幣一律 `--gold`（語意鐵律）；XP 沿用 topbar 進度條；今日層不再重複大金幣數字。
6. **訓練 CTA**：整屏**唯一 Primary**（`--grad-accent`＋`--glow-primary`、高 ≥52px、拇指區）；文案「開始訓練」；行為 `ctx.navigate('workout')`（本輪不帶任務參數）。
7. **Bottom Tab／Sidebar 配合**：TABS 順序改為 `今日 → 島嶼 → 訓練 → 健康 → 設定`（icon 建議 ☀️ 或 🎯）；active 樣式沿用；訓練 live 隱藏 chrome 的 setChrome 契約不受影響。
8. **手機版優先**：390px 單欄、卡片滿版、CTA 固定於內容流末端（不做懸浮，避免與訓練頁 FAB 混淆）；間距用 16/12 階梯。
9. **桌機展示**：≥920px 內容 `--maxw` 置中；任務卡與島嶼卡可並排雙欄；側邊欄第一項為「今日」。

## 七、施工步驟（建議執行序）

1. 建 `today.css`（純樣式先行，tokens only）。
2. 建 `today.js`：`render()` 靜態模板 → mount/unmount → store.subscribe 更新 streak/金幣顯示。
3. `main.js` 註冊＋預設頁改 today。
4. `index.html` 加 link。
5. 兩檔 RWD 手動驗證＋跑測試＋console 檢查。

## 八、完成標準

- 開 App 直接落在今日層，四要素齊：任務卡（假資料）、島嶼入口卡（真建築數）、streak 徽章（真資料）、唯一 Primary CTA。
- 五個 tab 全部可切換往返，island/workout/tracking/settings 行為與改動前完全一致。
- 樣式零硬編碼色（全 tokens）；390/1200 兩檔可讀可操作。
- `node tests/run.js` 34/34 綠；0 console error。

## 九、驗收清單

1. 檢查首屏區塊順序（問候→任務卡→島嶼卡→週目標佔位→CTA）
2. 檢查島嶼視覺區塊（建築數正確、去看看→島嶼分頁）
3. 檢查今日任務卡（假資料呈現、goalRing 靜態 0%、TODO 標注存在）
4. 檢查玩家狀態（topbar 不重複、streak 徽章讀真值）
5. 檢查訓練 CTA（唯一 Primary、navigate('workout') 正常、樣式符合元件 #1）
6. 檢查手機版（390px 截圖：單欄、CTA ≥44px 觸控、無橫向捲動）
7. 檢查桌機版（1200px 截圖：置中 maxw、雙欄、側邊欄含「今日」）
8. 確認 `app/core` 未修改（git diff 或檔案時間戳）
9. 確認 `tests` 舊斷言未修改
10. 執行現有測試：`node tests/run.js` → 34/34 passed；瀏覽器 console 0 error
11. **生命週期檢查**（Codex 補強）：unmount 有呼叫 unsubscribe；五個 tab 來回切換 10 次後 console 0 error、今日層資料仍正確更新（無重複 render 疊加）
12. **預設頁副作用檢查**（Codex 補強）：只有「首次載入」落在今日層；手動切到其他 tab 後不會被自動導回；進出訓練 live（setChrome 隱藏/恢復）後 tab bar 與 active 樣式恢復正常；today 的 active 樣式正確
13. **手動契約檢查表**（因本輪不新增測試）：FEATURES/TABS 含 today 且排第一；today 僅實作五欄位契約（不含 onShow）；mount 後兩顆導流鈕可用

## 十、下一步實作提示詞（可直接貼給 Codex / Cursor / Claude Code）

```
請只處理 Slice 1：今日層／首屏體驗，且只做「第一輪：UI 結構整理」。

請先閱讀：
1. docs/planning/Slice1_第一輪實作計畫.md（本輪唯一規格，含檔案白名單與驗收清單）
2. docs/ai-rules/Design_System_收斂版.md（三、四、五節 tokens 與元件 #1/#2/#3/#11/#12）
3. docs/CONTRACTS.md（feature 契約與 store 唯讀 API）

這次只做：Slice 1 第一輪——新增靜態「今日層」並設為預設首屏。

請完成：
1. 新增 app/features/today/today.js：實作 feature 契約 { id:'today', label:'今日', icon, mount, unmount }；
   畫面由上而下＝問候列＋日期 → 今日任務卡（假資料常數：完成 20 個有效深蹲，進度 0/20，goalRing 靜態，
   檔首標注 // TODO(R3): 接 store 任務欄位）→ 島嶼入口卡（讀 store.getState().island.placed.length 顯示
   「已建 N 棟」＋「去看看」Secondary 鈕 → ctx.navigate('island')）→ 週目標橫條靜態佔位 →
   唯一 Primary CTA「開始訓練」→ ctx.navigate('workout')。
   streak 徽章讀 store.getState().streak.current，並以 store.subscribe 保持更新。
2. 新增 app/features/today/today.css：樣式只用既有 tokens（--green/--gold/--grad-accent/--grad-card/
   --stroke/--radius/--muted 等），禁止硬編碼色票；RWD：390px 單欄、≥920px 雙欄置中 --maxw。
3. 修改 app/main.js：FEATURES 與 TABS 加入 today（排第一），預設頁 show('island') 改為 show('today')。
4. 修改 index.html：加入 today.css 的 <link>（比照其他 feature css）。

請不要：
1. 不要修改 app/core（任何檔案）
2. 不要修改 tests 舊斷言（本輪也不需新增測試）
3. 不要修改 vendor
4. 不要處理其他 Slice（workout/island/tracking/settings 的 js 與 css 一律不動）
5. 不要修改 app/state/store.js（只准 getState/subscribe 唯讀）
6. 不要新增任何持久化或假資料庫（假資料只能是 today.js 內的常數）
7. 不要加大量動畫（只允許沿用既有 fadeUp 進場 class）
8. 不要改 docs/CONTRACTS.md

完成後請回報：
1. 修改了哪些檔案（完整清單＋每檔一句話說明）
2. 保留了哪些功能（確認 island 開場行為外零變更）
3. 重做了哪些 UI（今日層四要素）
4. 補強了哪些互動（兩顆導流鈕）
5. 如何測試：node tests/run.js 結果（需 34/34）＋瀏覽器手動步驟
   （開 App→今日層→五 tab 往返→CTA 導流→390/1200 兩檔截圖）＋console 0 error 證明
```

<!-- cross-model-review: APPROVED reviewer=codex hash=f545d362663bf85e at=2026-07-04T13:57:55+08:00 -->
