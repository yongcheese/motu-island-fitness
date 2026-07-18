# TASK SPLIT + 分工 — Gate 2

## 1. 模組地圖與負責角色
編排策略：**核心引擎 + 契約 + 測試由 orchestrator 親自實作**（正確性最高槓桿、需確定性驗證），**四大功能 UI 由 sub-agents 依契約並行實作**，最後整合 + review。

```
app/
  main.js              [orchestrator] 啟動、tab 導覽、模組裝配
  state/store.js       [orchestrator] 中央狀態 + localStorage + 事件匯流排（契約核心）
  core/
    geometry.js        [orchestrator] 純數學：角度/距離/向量（測試覆蓋）
    normalize.js       [orchestrator] 比例正規化（測試覆蓋）
    engine.js          [orchestrator] 通用動作狀態機 + 六層防作弊（測試覆蓋）
    exercises/*.js     [orchestrator] 各動作判定 spec（測試覆蓋 4 項）
    calories.js        [orchestrator] METs 熱量 + 評級（測試覆蓋）
    coach.js           [orchestrator] 分級語音搶佔
    pose.js            [orchestrator] MediaPipe 包裝 → 統一 landmark 介面
    synth.js           [orchestrator] 合成 landmark 產生器（測試 + 示範模式共用）
  ui/
    feedback.js        [orchestrator] 三色骨架 canvas 渲染器
    components.js      [agent-shell] 共用 UI 元件/圖示
  features/
    workout/           [agent-workout] Tab2：分類→清單→簡介→偵測→結算
    island/            [agent-island] Tab1：等距島嶼建設遊戲
    tracking/          [agent-tracking] Tab3：Chart.js 圖表儀表板
    settings/          [agent-settings] Tab4：個人化設定
  styles/              [agent-shell] 全域設計系統 + 各頁樣式
tests/                 [orchestrator] Node eval 套件
```

## 2. 依賴順序（關鍵路徑）
1. **CONTRACTS（契約）** 先凍結 → 所有人照同一介面。
2. **synth + tests（Gate 3）** 先寫 → 定義引擎正確行為。
3. **core engine（Gate 5）** 實作至測試全綠。
4. **features UI（Gate 6）** 並行，僅依賴 `store` 與 `core` 的公開契約 + mock 資料即可開發。
5. **整合 + review（Gate 7）**、**trace/eval（Gate 8）**。

## 3. Sub-agent 分派（Gate 6 並行）
| Agent | 範圍 | 輸入契約 | 不可碰 |
|-------|------|---------|--------|
| agent-shell | `index.html`、設計系統 CSS、底部 tab bar、共用元件、品牌/loading | store API、設計 token | core 邏輯 |
| agent-workout | Tab2 全流程 UI + 接 pose/engine/coach/feedback + 結算 | core engine 契約、store | engine 內部 |
| agent-island | Tab1 等距島嶼遊戲、商店、放置、成就 | store.island/wallet API | wallet 直接加幣（禁止） |
| agent-tracking | Tab3 圖表（Chart.js）+ 對比 | store.history API | 寫入 history |
| agent-settings | Tab4 設定 + 影響 profile/prefs | store.profile/prefs API | — |

每個 agent 收斂為「**只透過 store 事件與 core 公開 API 互動**」，避免整合衝突。

## 4. 整合風險與對策
- **CSS 衝突**：採 BEM-ish 命名 + 每 feature 命名空間 `.wk- .isl- .trk- .set-`；共用 token 在 `:root`。
- **狀態競態**：store 為單一真實來源，feature 只 dispatch action + 訂閱；不互相直接呼叫。
- **金幣防刷**：`store.addCoins` 設為 internal，只有 `store.commitSession(result)` 能加幣；island 只能 `store.spendCoins`。

## 5. 里程碑與 Gate 對應
- G3 tests 全列（紅燈）→ G5 轉綠 → G6 UI → G7 review → G8 trace。
- 每 Gate 產出一段「進度 / 問題 / 下一步」摘要回報。

## Gate 2 結論
分工正交、依賴清楚、整合風險有對策。**PASS**，進入 Gate 3（test-first）。
