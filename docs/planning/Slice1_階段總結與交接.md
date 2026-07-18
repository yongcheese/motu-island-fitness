# Slice 1 階段總結與交接（2026-07-05）

<!-- cross-model-review: skip（本文件為總結交接文檔，非實作計畫） -->

> 彙整自：`Slice1_第一輪實作計畫.md`（已蓋 codex marker）、`Slice1_第一輪驗收報告.md`（判定：通過）、`Slice_Workflows_重整版.md`、`Design_System_收斂版.md` 與實際改動檔案。
> 本輪只做總結與交接，未修改任何程式。

---

## 一、Slice 1 已完成內容（第一輪：UI 結構與第一印象）

| # | 項目 | 完成狀況 |
|---|---|---|
| 1 | 首屏資訊架構 | ✅ 開 App 落在「今日層」：問候＋日期＋循環標語 → 今日任務卡 → 島嶼入口卡 → 週目標佔位 → 唯一 Primary CTA；四分頁降為導覽（tab 首位=今日） |
| 2 | 島嶼主畫面 | ✅（採定案設計）今日層為主畫面、島嶼以「入口卡」呈現（真實建築數＋去看看→島嶼分頁）；**不掛雙 3D**（效能/生命週期決策）；島嶼分頁本身零改動 |
| 3 | 今日任務 | ✅ 任務卡＋進度環 0/20＋AI 品質語言（「蹲到髖低於膝才算有效」）；⚠️ 資料為寫死常數（R3 接真資料，`TODO(R3)` 已標注於 today.js 檔首） |
| 4 | 金幣／XP／等級 | ✅ 沿用全域 topbar（Lv/XP 條/金幣 `--gold`）不重複呈現＋streak 火焰徽章讀真值（store.streak.current） |
| 5 | 訓練 CTA | ✅ 整屏唯一 Primary（實測 primaryCount=1）、54px 高、`--grad-accent`＋glow、navigate('workout') 實測通 |
| 6 | Empty／Loading／Error | ✅ Empty：從未訓練 → 任務卡自動變「完成你的第一次訓練」首訓引導（空＝下一步）；Loading/Error：今日層無非同步，N/A（符合計畫） |
| 7 | Design System 對齊 | ✅ 8 項檢查全過：零硬編碼色票、全共用類（.card/.btn/.pill/.section-title）、字級間距在 DS 區間、無新風格、390/1200 兩檔可讀 |

## 二、實際修改檔案

| 檔案 | 動作 | 目的 |
|---|---|---|
| `app/features/today/today.js` | **新增** | 今日層 feature（五欄位契約；store 唯讀 getState+subscribe；unmount 清 unsubscribe） |
| `app/features/today/today.css` | **新增** | 今日層樣式（全 Lumina tokens、390 單欄/920 雙欄） |
| `app/main.js` | 修改 | 註冊 today（FEATURES＋TABS 首位）、預設頁改 `show('today')` |
| `index.html` | 修改 | 加一行 today.css `<link>` |
| `app/styles/app.css` | 修改（申報偏差） | `.tabbar` 4→5 欄（新增 tab 的必要後果；最小 diff 1 值） |

- 新增檔案：2（today.js／today.css）。刪除檔案：**無**。

## 三、禁止區域檢查

| 區域 | 結果 |
|---|---|
| `app/core/**`（引擎/動作規格/正規化/合成器/pose） | **未修改** |
| `tests/**` 舊斷言 | **未修改**（34/34 綠） |
| `vendor/**` | **未修改** |
| `docs/CONTRACTS.md` 既有簽名 | **未修改**（today 完全遵循既有 feature 契約） |
| `store.js`（含 commitSession 防刷鐵則） | **未修改**（僅唯讀呼叫） |
| 其他 Slice 功能（workout/island/tracking/settings） | **未修改**（island 僅不再是開場頁，行為實測一致） |

## 四、驗收結果摘要

- **判定：通過**（詳見 `Slice1_第一輪驗收報告.md`）。
- 13 條驗收清單全過（含 Codex 互審補強的三條：生命週期 ×10、預設頁副作用、契約檢查表）。
- `node tests/run.js` 34/34 綠（施工後與收尾各一次）；瀏覽器 console 0 error。
- 已知教訓入檔：驗收腳本勿持有舊 DOM 引用（renderTabbar 會重建按鈕）。

## 五、遺留與未完成內容（皆為計畫內既定，非缺陷）

1. 任務資料寫死常數 → **R3**（store 任務欄位＋深合併；今日層接真資料）
2. 週目標條靜態佔位（「進度追蹤即將開通」徽章）→ **R3**
3. CTA 未帶任務參數 → **Slice 2**（推薦邏輯）
4. 打勾/環填充動畫 → **R4**
5. 流程改善建議：後續輪次計畫的白名單要納入「全域佈局對新增元素的承載」（本輪 tabbar 折行教訓）

## 六、下一步

**進 Slice 2：選擇訓練（從型錄到邀請）**——第一輪：UI 結構整理。
（備註：Vertical_Slices 總執行序原建議先 Slice 4；本交接依使用者指示改推 Slice 2。Slice 2 與 Slice 1 的依賴已有退化設計：任務欄位未接前，推薦邏輯以「寫死推薦深蹲」起步，不阻塞。）

Slice 2 第一輪要點（詳見 Slice_Workflows_重整版 §Slice 2）：
- 在 `workout.js` renderMenu 頂部加「今日推薦」大卡（暫寫死推薦深蹲＋理由佔位文案）
- 型錄清單保持原功能、位於推薦區之下
- 只動 renderMenu/renderIntro 呈現層＋workout.css；**不碰 startLive 之後任何時序邏輯、不動 3D 卡片管線**

## 七、給 compact 後新上下文的交接摘要

> **專案**：育秀盃「Island Fitness AI」——AI 健身品質判定（MediaPipe＋自建防作弊引擎）× 3D 島嶼養成的純前端離線 SPA（`/Users/yongcheese/Documents/code/claude/育秀杯`，`python3 serve.py 8080` 啟動）。核心循環：正確訓練→AI 判定有效→金幣→島嶼成長→想再訓練。
>
> **規劃文件已完成**（開工前必讀）：`docs/planning/` 內 現況盤點／企劃書落差分析／重整策略／本專案專用規劃_重整版（含「六-補」運動終止邏輯決策：次數為主、90 秒安全網、倒數環雙語意）／Vertical_Slices_重整版（6 條 Slice）／Slice_Workflows_重整版（每條 5 輪施工＋可貼提示詞）；`docs/ai-rules/Design_System_收斂版.md`（Lumina tokens 為唯一權威、17 元件規則）。Slice 實作計畫需經 cross-model 互審蓋章（cmr marker）。
>
> **Slice 1 第一輪已完成並驗收通過**：新增 `app/features/today/`（今日層首屏：問候／今日任務卡-假資料-`TODO(R3)`／島嶼入口卡-真建築數／週目標佔位／唯一 CTA），main.js 註冊 today 為首 tab＋預設頁，index.html 加 link，app.css tabbar 4→5 欄。34 測試綠、0 console error、DS 對齊全過。
>
> **不能動的核心區**：`app/core/**`（判定引擎/動作規格/正規化/合成器）、`tests/**` 舊斷言（只准新增）、`vendor/**`、`docs/CONTRACTS.md` 既有簽名、`store.commitSession` 防刷鐵則（金幣唯一入口）、store schema 只准「新增欄位＋深合併預設」。`workout.js` 的 run-token 時序區屬高風險（Slice 3 才動、需先互審）。每輪結束必跑 `node tests/run.js`（34/34）。
>
> **下一步：Slice 2「選擇訓練」第一輪（UI 結構）**。目標：訓練清單從「十張卡型錄」變「今日推薦置頂的邀請」——renderMenu 頂部加今日推薦大卡（暫寫死深蹲＋理由文案，金色描邊＋「今日推薦」徽章，樣式見 DS §七-Slice2），型錄其下原樣保留；只動 workout.js 呈現層（renderMenu/renderIntro）＋workout.css，不碰 startLive 後的任何時序邏輯與 3D 卡片管線；動工前先為該輪寫實作計畫並送 codex 互審蓋章。
