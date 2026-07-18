# Demo 最終打磨計畫（上台前最後一輪）（2026-07-18）

> 目標：以「評審上台視角」修掉核心循環最後的可見破綻。基線：git tag `demo-v1`（可回溯）、46/46 測試綠。
> 本文件為**實作計畫**，動工前送 codex 互審蓋章。流程：spec→impact→task split→test first→patch→overall review→trace。

---

## 一、Spec：三個破綻（依評審可見度排序）

### P0 今日任務接真資料（循環第一步目前是假的——最大破綻）
- **現況**：today.js 任務卡寫死 `TASK.done=0`——評審跑完一輪 36 個有效深蹲回今日層，任務環仍是 0/20 紋絲不動 → 循環第一步「選任務→完成→打勾」當場穿幫。
- **Spec**：`done` = **當日** history 中 `exercise==='squat'` 的 `validReps` 加總（cap 於 target=20）；達標 → 任務卡打勾態（標題前 ✅、卡片邊線轉 `--green`、副文案「今日任務完成！」——DS 元件 #3 完成態）；環填滿。已有的 `store.subscribe` 改為**整卡就地重繪**（今日層無輸入框，重繪安全）。
- **方案關鍵**：**零 store schema 變更、零 core 變更**——純 today.js 呈現層讀 `history`（session 已有 `date`(todayISO)/`exercise`/`validReps` 欄位）。原規劃的 store `daily` 欄位（Slice1-R3）不做——demo 不需要跨日重置持久化，直接由 history 推導最誠實。
- **一致性**：推薦卡理由文案「完成今日任務：20 個有效深蹲」與此同口徑，無需改。
- **已知限制（互審記錄）**：「今日」採 UTC 日期（與 store todayISO 一致）；台北 00:00–07:59 訓練會歸前一 UTC 日。本輪只求與 store 同源一致（demo 在白天進行不受影響）；徹底修正需 session 存本地日＋遷移，列後續。

### P1 兩個一行級污點
1. finishLive 語音「**時間到**，這組完成」→「這組完成，做得很好！」（課表制已無時間收束，舊文案穿幫）。
2. 型錄卡難度恆顯 1 點（`e.difficulty||1` 讀不到 `meta.difficulty`——伏地挺身難度 3 顯示 1）→ cardHtml 的 fallback 改 `e.meta?.difficulty || e.difficulty || 1`（與推薦卡同鏈；已於 Slice2-R2 記錄待裁決，現裁決：修）。

### P2 組內進度語音（AI 教練臨場感）
- WORK 態剩 3 下 →「還剩三下」（mid）；剩 1 下 →「最後一下，加油」（**high**，可搶佔進行中語音，不被 speaking 態吞掉）。落點：advanceSetPhase WORK 分支——**不動組數轉移邏輯本身，只加語音旁路**。
- **觸發契約（互審修訂）**：精確數字觸發＋成功才設旗標——`remain = set.target − setValid`；`remain===3 && setValid>0 && !set.cue3` → say('還剩三下','mid')，**say() 回傳 true 才設 cue3**（false 則下一幀重試；remain 一變即停止重試→永不報錯數字）；`remain===1 && !set.cue1` → say('最後一下，加油','high') 同規則。旗標 `set.cue3/cue1` 在 initSetState 初始 false、enterWork 重置（每組各觸發一次）。
- **跳幀取捨**：單幀 4→2 時「還剩三下」直接略過（不喊錯數字）；「最後一下」以 **high 優先搶佔並在 remain===1 期間持續重試**（非絕對必達：使用者若在重試前完成最後一下則自然略過）。coach.say 冷卻為逐句文字計（lastSpokenAt keyed by text），兩句互不節流。
- **可測性（互審修訂）**：cue 決策抽為 `coach-policy.js` 純函式 `repCountdownCue(set)`——輸入 set 快照，回傳 `{text, priority, flag}` 或 null；workout.js 只負責 `if (cue && run.voice && CTX.coach.say(text, priority)) set[flag]=true`（say 成功才設旗標）。

## 二、Impact 分析
| 改動 | 檔案 | 風險 | 禁區確認 |
|---|---|---|---|
| P0 | `today.js`（＋today.css 完成態樣式 2-3 行） | 低（純呈現、唯讀 history） | 不動 store/commitSession/core |
| P1-1 | `workout.js` finishLive 內 1 字串 | 零 | 不動守門/commit 呼叫 |
| P1-2 | `workout.js` cardHtml 1 行 | 零（宣告式視覺修正） | 不動判定 |
| P2 | `workout.js` 語音旁路＋`live.set` 加 2 旗標 | 低 | 不動狀態轉移/run-token/門檻/core |

不做（風險>收益）：金幣飛行動畫、設定頁接線、store daily 欄位、任何 app/core 改動。

## 三、Task Split ＋ Test First
1. **T1 今日任務**：today.js `todayValidSquats(state)` 純函式＋render 接真值＋完成態；**「今日」判定必須與 store 同算法**——`new Date().toISOString().slice(0,10)`（UTC 日期，store todayISO 同式；session.date 即此格式，直接字串比對）——不得用本地日期，否則 UTC+8 時區在 08:00 前錯位；**新增 Node 測試**（tests/ 只增）：純函式對「今日 squat 兩筆 12+8→20 cap」「昨日紀錄不算」「其他動作不算」「空 history→0」四斷言。
2. **T2 文案/難度**：兩處一行修；難度以瀏覽器 computed 驗證（伏地挺身卡 3 點）。
3. **T3 進度語音**：**Node 純函式測試**（tests/coach-policy 增測）驗 `repCountdownCue` 契約——(a) remain===3 回 cue3(mid)；(b) 模擬 say(false)→旗標不設→同狀態下一幀**再回同 cue（重試）**；(c) say(true)→設旗標→之後回 null（不重播）；(d) remain===1 回 cue1 且 priority==='high'；(e) 跳幀 4→2 回 null（略過不喊錯）；(f) setValid===0 不觸發。另 demo E2E 全程 0 error＋say spy 觀察實際觸發。
4. **總驗證**：`node tests/run.js` 全量測試全綠；demo 完整 E2E（訓練→結算→島嶼→**回今日層任務環前進**——循環四步一鏡到底）；Slice 1/2/4 保護快檢；完成後 git commit（demo-v1 tag 保留回溯）。

## 四、驗收標準（上台劇本）
1. 開 App 今日層：任務 N/20（讀真值，若當日已練則非 0）。
2. 推薦卡→訓練→做 12 個有效深蹲（或 demo 模式）→聽到「還剩三下」「最後一下」。
3. 結算→獎勵→回今日層：**任務環前進 12/20**；再一輪→**20/20 打勾、卡片轉綠**。
4. 型錄卡難度點數正確（深蹲 1、伏地挺身 3）。
5. 全量測試綠、0 console error、防刷不變。

<!-- cross-model-review: APPROVED reviewer=codex hash=d947f1de2b6f25fc at=2026-07-18T21:59:02+08:00 -->
