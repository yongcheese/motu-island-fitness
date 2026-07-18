# 訓練體驗重造 v3：Coach HUD + 3D Avatar

## 問題（使用者原話）
「辨識時沒有即時反饋，不知道哪裡出錯、要修什麼，甚至不知道它有沒有在辨識。」
→ 根因不是引擎沒資料，而是 **UI 是黑箱**：引擎每幀都算出 phase/signal/faults/visible，但畫面上只有骨架顏色和一行小字。

## 企劃書依據（docx 抽取）
- 5.1 三色視覺反饋（紅=錯誤/黃=接近/綠=正確）
- 5.2 分級語音提示（高/中/低優先）
- 2.3 動作狀態機：完整週期才計次（起始→發力→達標→回復）
- 「有效次數 = 完整週期 + 達標深度 + 無代償」
- 附錄 A：33 關鍵點 X/Y/Z + 信心值（→ 3D 化正當性）

## 方案
### A. Coach HUD（workout.js live 畫面重造）— 讓引擎「開口說話」
1. **追蹤狀態膠囊**（永遠可見，左上）：🔍 尋找人體… / ⚠️ 部分入鏡（缺：膝蓋…）/ ● 追蹤中。
   解決「不知道有沒有在辨識」。
2. **動作週期燈**（企劃 2.3 的狀態機視覺化）：起始 → 發力 → 達標 → 回復 四顆燈，
   依 res.phase（READY/CONCENTRIC/TARGET/ECCENTRIC）即時點亮。解決「不知道系統在想什麼」。
3. **深度量表**（右側直條）：res.signal 0→1 即時填充、標出達標線（spec.targetEnter）、
   顏色跟三色回饋走。使用者蹲下去看得到條在動 → 立刻知道「有在辨識」與「還差多深」。
4. **計次即時判定**（畫面中央大字閃現）：有效 → 「✓ +1」綠色；無效 → 「✗ 原因」（半程未達標/彎腰…）。
   解決「不知道哪裡出錯」。
5. **取景引導**：用 landmark bbox 自動提示「請後退（人太大）/ 請靠近（人太小）/ 缺哪個部位」。
6. 保留：三色全身骨架疊圖、語音教練、倒數環。

### B. 3D Avatar（新檔 app/ui/avatar3d.js）— Three.js 真 3D 模型
- 用已 vendor 的 three.module.min.js（島嶼已在用）程序化組裝低多邊形 3D 人偶：
  膠囊四肢+球關節+軀幹網格，方向光+半球光+接觸陰影+地面，鏡頭緩慢環繞。
- 由 33 landmark 驅動（示範模式餵 synth 幀；synth z=0，以每關節固定 z 模板給出前後層次）。
- 取代示範模式/簡介頁的 2D canvas 人偶（訓練卡片小圖維持 2D，效能考量）。
- 不抓外部 GLB：綁骨動畫重定向到 landmark 驅動系統風險高（動作клипы不齊、授權/離線問題），
  程序化 3D 同樣達到「真 3D 光影模型」且能被同一套 landmark 資料驅動。

### C. 辨識最佳化（MediaPipe 為核心，額外方案輔助）
- pose.js 輸出 worldLandmarks（3D 公尺座標）供 avatar/未來角度計算。
- bbox 取景品質偵測（太小/太大/出框）→ 主動引導，從源頭提高輸入品質（辨識差常是取景差）。
- 沿用既有：One-Euro 平滑、尺度 EMA、gateLandmarks、full 模型、GPU→CPU 後備。

## 不變更
- 引擎判定邏輯/門檻（34 測試 + 攻擊矩陣把關，不動）。
- commitSession 金幣鐵則、run-token 防競態。

## 驗收
- 34/34 測試綠；示範模式全程：狀態膠囊→週期燈隨動作走→量表隨深度動→✓/✗ 閃現→結算。
- 0 console error；手機版可用。

## 審後補充（Codex 收斂點的落實說明）
1. **Teardown 契約**：`avatar3d.dispose()` = traverse dispose 所有 geometry/material + `renderer.dispose()` + 移除 DOM canvas。
   avatar 無內部 rAF/listener（render 由外部迴圈驅動,該迴圈由 demoRaf / live.raf 取消）。
   釋放時機：renderMenu / startLive / unmount（introAv）與 stopLive（live.avatar）。實測 4 次建立/釋放無 GL 洩漏。
2. **分級語音**：沿用 coach.js 既有機制——cue 帶 priority(high/mid)、內建節流去重、高優先蓋過低優先；HUD 不改動語音層。
3. **週期燈文案**：採 Codex 建議改為動作中性詞「起始→進行→達標→回復」（原「發力」對深蹲下降段語意不準）。
4. **z 座標範圍**：示範模式用固定 z 模板（synth z=0）；live 相機模式目前不掛 3D avatar（主畫面=實拍+骨架疊圖）,
   pose.js 已輸出 worldLandmarks 供未來 live avatar 直接吃真 3D 座標（缺失時 fallback z 模板）。

<!-- cross-model-review: APPROVED reviewer=codex hash=e531bbac9a0b4e9e at=2026-07-02T10:16:39+08:00 -->
