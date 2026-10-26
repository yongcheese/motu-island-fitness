# TODO_PLAN — Island Fitness AI｜深蹲計次修正＋筆電放桌上也能用
<!-- cross-model-review: skip（2026-09-24 使用者裁示：本專案不送 Codex 審） -->

> 產生時間：2026-10-11
> 需求來源：`REQUIREMENT.md`（第 2 節使用者拍板：側身要支援、深度標準維持 A、多算必修、急件）
> 技術棧：健身核心 `app/`（純 ES modules）；整合版 `motu-app/` 以 `@fitness` 引用，本次不改其檔案
> 測試指令：根目錄 `npm test`；`cd motu-app && npm run lint && npm run test:fitness && npm run build`；真人錄影重播 `tools/replay/replay.html`

## 需求檔位
- **檔位**：S
- **判定理由**：一般功能從 S 起算；命中「改動的介面有多個消費端」（engine.js 為四個動作共用）+1 → S。不碰持久化、無新依賴、關注點 3 個（判定規則／引擎掛鉤／取景文案）未達 +1。
- **本檔位規格**：Slice 數 2–4 ｜ slice-reviewer 收尾一次＋碰共用檔的 Slice 即時審（Slice 2 碰 engine.js）｜ 完整 build 收尾一次 ｜ context 隔離：主線 inline
- **流程說明**：使用者要求急件、同意「照你的做法」，本次 review-spec 重點已併入 REQUIREMENT 第 1 節診斷（無 Critical：免費、無付費服務、不碰 Protected Areas），計畫與施工連續執行，未在各 Slice 間停下等確認。

## 設計鐵律速查
- 沿用整合版 Motu 設計（深藍字、--motu-color-* 變數），不新增顏色與圖示

## 設計顧問輸入（ui-ux-pro-max，全專案只查這一次）
- N/A ｜ 本次 UI 只多一行說明文字，沿用既有 `.lv-gate-s` 的字級與顏色階層，不做新的設計決策

## 進度總覽
- 總 Slice 數：3
- 已完成：3 / 3
- 平行組：無

---

### [x] Slice 1 — 深蹲側身也能判定並關掉側身誤報的提示
- **目標**：側身深蹲遠側膝被擋住時照樣計次；側身時不再叫使用者「頭擺正」「膝蓋外推」
- **範圍內**：`squat.gatePairs`（肩、髖、膝）；`isSideView`／`SIDE_VIEW_SWR` 0.30；evaluate 中頭側傾、膝內夾在側身時不判
- **範圍外**：深度門檻數值、改用單側量深度（重播證實中點已足夠）
- **改動檔案**：`app/core/exercises/squat.js`（修改）、`tests/squat-desk.test.js`（新增）
- **設計要點**：N/A ｜ 純邏輯
- **UI Slice?**：NO
- **驗收標準**：
  - [x] 右膝可見度 0.2 時 3 次合成深蹲全計到；拿掉 gatePairs 的對照組 0 次
  - [x] 左右膝都看不清時仍停止判定
  - [x] 側身＋鼻在肩前方不報頭側傾；正面同樣偏移要報（對照）
  - [x] 真人 s2 側身：看不到幀 90.8% → 18.7%，有效 0 → 8
- **測試策略**：`tests/squat-desk.test.js` 前 5 條，含對照組證明測試會在修改前失敗
- **完成定義**：Type Check N/A（JS）＋ npm test PASS ＋ 重播達標
- **對外介面**：`squat.gatePairs`；`export SIDE_VIEW_SWR`、`export isSideView(s)`
- **依賴**：無
- **平行組**：獨立

### [x] Slice 2 — 擋掉上下顛倒的骨架幀
- **目標**：MediaPipe 把骨架估成上下顛倒時不再多算一下
- **範圍內**：engine 新增選用掛鉤 `spec.plausible(frame, { standTorso })`，不合理的幀當取景壞幀處理（凍結、在 stableScale 前攔）；深蹲實作 `squatPlausible`、`TORSO_FLIP_RATIO` 0.35
- **範圍外**：其他三個動作（未提供 plausible，行為不變）
- **改動檔案**：`app/core/engine.js`（修改，共用檔）、`app/core/exercises/squat.js`（修改）、`tests/squat-desk.test.js`（修改）
- **設計要點**：N/A ｜ 純邏輯
- **UI Slice?**：NO
- **驗收標準**：
  - [x] 真人估錯幀（s1 #3743 座標）不通過、真人站立幀通過、合成正常深蹲每幀通過
  - [x] 站著 → 顛倒 6 幀 → 站回：0 次；拿掉檢查的對照組 ≥1 次
  - [x] 真人 s1：249.9 秒那次誤計消失，其餘 14 次有效逐次不變
- **測試策略**：`tests/squat-desk.test.js` 後 4 條
- **完成定義**：npm test PASS ＋ 重播達標 ＋ slice-reviewer（碰共用檔 engine.js）
- **對外介面**：engine spec 選用欄位 `plausible(frame, { standTorso }) → boolean`；`report.issue` 新值 `'implausible'`；`export squatPlausible`、`export TORSO_FLIP_RATIO`
- **依賴**：無
- **平行組**：獨立

### [x] Slice 3 — 取景關卡加上筆電放桌上的擺法提示並留下驗證紀錄
- **目標**：使用者一進取景關卡就知道筆電放桌上怎麼擺
- **範圍內**：`gateHtml` 加 `.lv-gate-tip` 一行、CSS；重播工具記錄座標與被擋幀；驗證文件
- **範圍外**：取景判定邏輯（已允許腳從下緣出框）
- **改動檔案**：`app/features/workout/workout.js`（修改）、`app/features/workout/workout.css`（修改）、`tools/replay/replay.html`（修改）、`docs/verification/深蹲桌面機位重播.md`（新增）
- **設計要點**：次要文字用 `--motu-color-text-muted` 13px，排在「全部打勾並站穩 2 秒」下方
- **UI Slice?**：YES
- **驗收標準**：
  - [x] 375px 與 1280px 截圖：提示正常換行、不擠壓檢查清單（主線以 playwright 截 gateHtml 模板目視，截圖在 scratchpad 未進 repo）
  - [x] 既有 workout-layout 測試仍綠
- **測試策略**：既有 `tests/workout-layout.test.js`；截圖目視
- **完成定義**：npm test PASS ＋ motu-app lint／test:fitness／build PASS（主線 10-11 實跑：530/530、lint exit 0、41/41、build ✓）
- **對外介面**：CSS class `.lv-gate-tip`
- **依賴**：無
- **平行組**：獨立
