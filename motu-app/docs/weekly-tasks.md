# 每週任務 ＋ 健康頁

「追蹤」改名為「健康」，那一頁重新分區，並新增玩家自訂的每週任務。

## 檔案地圖

| 檔案 | 負責什麼 |
|---|---|
| `src/constants/civilTime.ts` | 行事曆：遊戲時區、日曆日、日期運算。從 `dailyLogin.ts` 抽出來，原檔 re-export。 |
| `src/constants/weeklyTasks.ts` | 規則：週期、目標類型、進度計算、驗證、存檔正規化。沒有 React、沒有 Firestore。 |
| `src/lib/healthData.ts` | 資料來源的抽象層（`HealthDataAdapter`）＋ 目前的實作（讀 `workout_logs`）。 |
| `src/context/useWeeklyTasks.ts` | 服務：建立／編輯／刪除的寫入，並把定義與活動紀錄湊成進度。 |
| `src/components/health/` | 畫面：`HealthView` 殼 ＋ 三個分頁 ＋ 任務卡 ＋ 表單。 |
| `scripts/test-weekly-tasks.ts` | 規格。`npm run test:weekly-tasks`。 |
| `src/constants/weeklyTaskRewards.ts` | 完成獎勵的規則：獎勵表、報價、領取帳、每週上限、狀態。 |
| `src/components/health/TaskRewardStrip.tsx` | 任務卡上的「完成獎勵」那一條、獎勵圖示、首頁摘要的小徽章。 |
| `scripts/test-weekly-task-rewards.ts` | 獎勵的規格。`npm run test:weekly-task-rewards`。 |

## 名字改了哪些、沒改哪些

**改了**（玩家看得到的每一處）：導覽列按鈕、頁面標題、新手引導的說明、`View.TRACKER` →
`View.HEALTH`（值 `'tracker'` → `'health'`）、元件 `TrackerView` → `HealthView`、
兩處註解裡列出的畫面清單。

**沒改**，而且是刻意的：Firestore 的 `workout_logs` 集合、`WorkoutLog` 型別、`firestore.rules`
裡對應的規則。那些名字寫在每一份既有存檔裡，改名等於一次資料遷移；而且它們本來就叫「運動紀
錄」而不是「追蹤」—— 名字沒有錯。

`View.HEALTH` 的**值**跟著改了，因為它沒有離開過記憶體：不寫進存檔、不出現在網址、不在任何
API 合約裡。留一個跟畫面上四個字對不起來的內部名字，只會讓下一個人先去找「追蹤」在哪裡。

## 頁面怎麼分

三個分頁（`components/health/healthSections.ts`），對應三種「我現在想做什麼」：

1. **總覽** — 本週四個數字、每週任務進度（前兩個）、最近三筆活動、以及唯一會主動說話的重要提醒
   （只在有任務剩不到兩天又還沒完成時出現）。每一區都只放摘要，後面接一條通往完整分頁的路。
2. **每週任務** — 任務清單、建立／編輯／刪除。
3. **活動紀錄** — 最近 14 天的每日動作次數圖、運動項目篩選、依日分組的清單。

原本還有第四個「資料與說明」分頁（資料來源、目標類型支援狀況、週期定義），已經移除：它一頁只有
靜態說明、沒有任何操作，卻在導覽列上佔掉四分之一的寬度。其中唯一真正必要的內容 ——「哪些目標類
型還沒有資料來源」—— 本來就在建立任務的表單裡講了（灰掉的選項下面就寫著原因），而那正是玩家會
問這個問題的時刻。

改版前那一頁是一張 `h-[85vh]` 的卡片，裡面是三個數字加一張「最近 10 次」的折線圖。固定高度在
1366×768 的筆電與橫著拿的手機上會把圖表壓成一條線，所以現在整頁是自然流動的捲動頁。

## 進度是算出來的，不是存起來的

這是整個功能唯一真正重要的設計決定。

任務只存**定義**（名字、目標類型、目標數值）。目前進度永遠由
`computeWeeklyTaskProgress()` 從 `workout_logs` 重新算出來。因此：

- 沒有任何一個地方可以把進度 +1 —— 根本沒有進度欄位可以被加。規格裡「進度來自實際的健康／運動
  紀錄，而不是單純由前端手動增加數字」因此是結構性的，不是一條要靠紀律維持的規定。
- 重新整理、關掉遊戲、換裝置都不會弄丟進度，因為紀錄本來就在存檔裡。
- 跨週不需要任何寫入。週期是從時鐘推導的，星期一凌晨零點一到，本週的分母自己就換了一批紀錄。

唯一存起來的進度相關欄位是 `completedWeeks`：已經達標過的那幾週。它不是進度來源，用途是
(a) 跨週之後仍然知道上週有沒有完成（因為更早的紀錄已經超出 `ACTIVITY_FETCH_LIMIT` 的視窗），
(b) 讓達標的慶祝一週只出現一次。寫入是冪等的，失敗也不影響進度。

## 週期與日期

- 一週從**星期一**凌晨零點到**星期日**結束，全部以 `Asia/Taipei`（+08:00，無 DST）計算。
  常數在 `constants/civilTime.ts`，跟每日登入共用同一本行事曆 —— 整個遊戲只有一個「今天」。
- 時間區間是半開的 `[週一午夜, 下週一午夜)`。閉區間會讓同一次運動被算進相鄰的兩週。
- **剩餘天數含今天**，而且四種狀態各有各的講法（`components/health/healthFormat.ts`）：

  | 狀況 | 顯示 |
  |---|---|
  | 還有兩天以上 | 本週還剩 N 天 |
  | 只剩今天 | 今天是本週最後一天 |
  | 已過期（只會出現在回看過去週期時） | 已結束 N 天 |
  | 已完成 | 本週目標已達成 |

  「剩 1 天」這句話永遠不會出現：在星期六它聽起來像還有一整天緩衝，而星期六其實還有兩天。

- 畫面每 60 秒確認一次日期有沒有變（`useWeeklyTasks` 的 `clockKey`），只有真的跨日／跨週才會
  重算。遊戲被開著過夜也不會停在昨天的答案。

## 目標類型

| 類型 | 單位 | 狀態 | 資料來自 |
|---|---|---|---|
| 每週運動次數 | 次 | ✅ | 一筆 `workout_logs` = 1 |
| 每週運動時間 | 分鐘 | ✅ | `duration` |
| 每週累積動作次數 | 下 | ✅ | `counts` |
| 每週完成指定運動 | 次 | ✅ | `type` 字串比對 |
| **每週累積步數** | 步 | ❌ **尚未支援** | 沒有計步資料來源 |

步數留在 `METRIC_SPECS` 裡而不是刪掉，並且**在建立任務的表單上**被灰掉、寫明原因。這是規格「清楚標示目前可用
與尚未支援的目標類型」的做法：把它藏起來只會讓玩家一直問遊戲能不能算步數。接上計步資料的那一
天，改動是那一列的 `available: true` 加上 `lib/healthData.ts` 裡的一個轉接器。

`measureActivity()` 對 `steps` 回傳 0 —— 不是一個看起來合理的假數字。

## 資料來源的抽象層

```
健身原型 →  workout_logs  ─┐
                            ├→ HealthDataAdapter → HealthActivity[] → 進度 / 總覽 / 歷史
未來的健康 API →  (轉接器) ─┘
```

`HealthActivity` 刻意不是 `WorkoutLog`：後者的欄位名（`counts`、`goldEarned`）帶著這個原型自己
的歷史。翻譯只在 `activityFromWorkoutLog()` 做一次，所以換資料來源是改一個檔案。

目前的 `workoutLogAdapter` 走 `lib/firebase.ts` 的門面，所以訪客（localStorage）與登入帳號
（Firestore）是同一段程式碼。

## 存檔

`profile.weeklyTasks = { tasks: WeeklyTaskDefinition[] }` —— 一個巢狀 map，理由跟
`workoutRewards` / `islandState` 一樣：在 `firestore.rules` 裡是一個 key、在每一份寫入白名單裡
是一個項目。上限 `MAX_WEEKLY_TASKS = 8`。

在這個功能之前寫下的存檔都沒有這個欄位，而那跟一個還沒建過任務的新玩家是同一件事。不需要
migration。

讀取時一律先過 `normalizeWeeklyTaskState()`：`target` 是字串、`metric` 是未知值、重複的
`taskId`、整個陣列不是陣列 —— 全部丟掉。一個 `NaN` 的進度不會拋錯，它會安靜地畫出一條空白的
條，那是最難發現的錯。

### ⚠️ 需要部署 rules

`firestore.rules` 新增了 `weeklyTasks` 的驗證與白名單。**在部署之前，登入帳號的玩家建立任務會
被 `permission-denied` 擋下來**（畫面會顯示「沒有存檔成功」）。訪客（本機存檔）不受影響。

```bash
firebase deploy --only firestore:rules
```

## 完成獎勵

2026-09-28 加上。每張任務卡在進度條下面多一條「完成獎勵」：還沒完成時顯示「完成後可領取」＋會拿到
什麼，完成後變成「領取獎勵」按鈕，領完顯示「✓ 已領取」＋實際入帳的東西。

### 資料流

```
任務定義 ──→ computeWeeklyTaskProgress ──→ completed?
   │                                          │
   └─→ rewardForTask（唯一的報價）──→ rewardStatusFor(進度, 領取帳) ──→ 卡片
                    │                                             │
                    └──────── buildTaskRewardClaim ←── 按「領取獎勵」
                                     │
                        一次 updateDoc：領取帳 ＋ 碎片 ＋ XP ＋ 功能卡（＋商品）
```

- **顯示 = 發放。** 卡片上那排獎勵與寫入的內容都是 `rewardForTask()` 的回傳值；領完之後卡片改讀
  領取紀錄裡**結算後實際入帳**的數字。`scripts/test-weekly-task-rewards.ts` 直接呼叫
  `buildTaskRewardClaim()`，逐欄比對它要寫的東西與報價。
- **「可以領」是算出來的。** 沒有任何 `claimable` 旗標存在存檔裡：完成與否來自進度（本來就是算的），
  領過與否來自領取帳。兩者不可能不同步。
- **一次寫入。** 領取帳與入帳在同一個 `updateDoc`，所以沒有「記了領過但沒入帳」或反過來。沒有
  樂觀更新：寫入成功才改畫面。連點由 in-flight 的 ref 擋。

### 獎勵表

獎勵等級由「目標值 ÷ 該目標類型的預設目標」決定 —— 任務是玩家自己設的，一樣多的獎勵會讓「建八個
每週運動 1 次」變成最划算的玩法。

| 等級 | 條件 | 獎勵 |
|---|---|---|
| 輕量 | < 1 倍預設 | 5 碎片、20 XP |
| 標準 | ≥ 1 倍 | 15 碎片、50 XP |
| 挑戰 | ≥ 2 倍 | 30 碎片、100 XP、雙倍金幣券 ×1 |

改數字或加一種獎勵（例如某一級送一件造型）只改 `WEEKLY_TASK_REWARD_TIERS`。UI 畫得出所有
`Reward`（貨幣、XP、功能卡、商品縮圖），`isPayableTaskReward()` 會擋掉領取流程付不出來的東西，
測試會對整張表跑一次。

**沒有金幣**：任務的來源是 `quest`，而 `SOURCE_CURRENCY_POLICY` 只讓它發碎片。這是經濟系統的規則
（見 `docs/economy.md`），不是這個功能的選擇。

### 每週上限與領取帳

`profile.weeklyTasks.rewardClaims = { week, claims: { [taskId]: { claimedAt, tier, rewards, taskName } } }`，
只留當週。每週最多領 `WEEKLY_TASK_REWARD_CLAIMS_PER_WEEK = 3` 次。

帳**不跟著任務走**：刪掉一個領過的任務，帳上那一筆還在，所以「領完、刪掉、用同樣目標重建、再領」
會停在上限。跨週不需要寫入 —— 帳是別週的就當作空的，下一次領取整本換掉。獎勵要在當週領，跨週後
上一週沒領的就過期了（任務頁底下有寫）。

`weeklyTasks.tasks` 與 `weeklyTasks.rewardClaims` 各自是一條 dotted path。以前 `writeTasks` 整個
`weeklyTasks` 一起覆寫；多了領取帳之後，那樣做會讓每次編輯任務（以及自動記錄達標）清掉這一週的
帳 —— 等於讓獎勵可以重領。

### rules

新增 `rewardClaims` 的形狀檢查與一條領取用的白名單子句（`weeklyTasks`、`wallet`、`currentXp`、
`utilityCards`、`inventory`，沒有 `balanceGold`）。領取寫入本來就落在既有的 superset 白名單裡，
所以**沒部署也能用**（2026-09-28 對目前線上的 rules 實測過）；部署之後多的是形狀檢查。

## 測了什麼、沒測什麼

`npm run test:weekly-task-rewards` —— 113 項檢查：獎勵表的每一項都付得出來而且沒有金幣、等級邊界、
沒有資料來源的類型沒有獎勵、未開始／進行中／完成／超額的狀態、**領取寫入與報價逐欄一致**、重複
領取被拒、重新整理（JSON 來回）後狀態不變、領完再改目標不會重新開放、每週上限、刪除重建仍受上限、
跨週重置、功能卡背包滿時紀錄只寫實際入帳的、各種獎勵類型的發放計畫、壞掉的領取帳（壞掉的一筆
**仍算領過**，不會重發）。

`npm run test:weekly-tasks` —— 114 項檢查，涵蓋：週的邊界（跨月、跨年、閏日）、時區（台北時間
星期日 23:30 與星期一 00:30 必須落在不同週）、半開區間、五種目標類型的計算、超額完成（原始值不
夾、進度條夾）、四種剩餘天數措辭、跨週、達標紀錄的冪等與上限、每一種無效輸入（空值、非數字、
零、負數、小數、超上限、NaN、Infinity、重複名稱、未支援的類型、數量上限）、壞掉的存檔、轉接器
的欄位翻譯。

**沒有**涵蓋寫入路徑的並行情況（一邊寫一邊建立、寫入被拒）—— 那是 `useWeeklyTasks.ts` 與
Firestore 的性質，不是這些函式的。瀏覽器實測涵蓋了建立／編輯／刪除／驗證錯誤／空狀態／達標自動
記錄／桌機與 375px 手機版面。
