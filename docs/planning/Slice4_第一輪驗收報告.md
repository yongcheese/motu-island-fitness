# Slice 4 第一輪驗收報告（2026-07-05）

<!-- cross-model-review: skip（本文件為驗收報告，非實作計畫） -->

> 驗收對象：Slice 4「訓練結算／金幣獎勵／島嶼回饋」第一輪（結算第二幕 UI 結構），依 `Slice4_第一輪實作計畫.md`（已蓋 codex APPROVED marker，三輪互審、4 個 BLOCKING 收斂）執行。
> 驗收方式：實作當輪以「示範模式 60 秒全流程 E2E＋防刷數字比對＋debug hook 兩變體驗證＋單元測試」完整驗證；本報告為結果整理，本輪未修改任何程式。
> 備註：驗收模板中段（一節第 5 項、二節、五節第 7 項、六七節、十節結尾）於使用者訊息中亂碼，依前三份驗收報告結構重建為十節。

---

## 一、實際修改摘要

1. **實際修改檔案：2 個**（與計畫白名單完全一致）——`workout.js`（結算段，45 行 diff）＋`workout.css`（檔尾 `.wk-rw` 區塊）。
2. **各改了什麼**：
   - `workout.js`：① `renderResult` 內 2 行級改動——Primary「完成」→「領取獎勵 ›」、onclick 從「toast＋renderMenu」改為 `renderReward(ex, session)`（toast 移除，資訊由畫面承載）②新增 `renderReward(ex, session)`：金幣大數字（`session.coinsEarned`）、Lv/XP 條（`store.derived.xpProgress()` 真 ratio＋clamp 0~1）、「+N XP」（validReps×5，已加註解「依 commitSession 現行契約推導」）、🏠 已建 N 棟真值、CTA 契約兩變體。
   - `workout.css`：`.wk-rw` 前綴規則（金數字 `--gold`＋光暈、XP 條 `--surface-2` 底＋`--grad-teal` 填充、tabular-nums、390 直排/桌機 560px 限寬置中）——零硬編碼色票。
3. 新增檔案：**無**（僅截圖存證 2 張）。
4. 刪除檔案：**無**。
5. **是否修改不該動的區域：無**——並含一項計畫勘誤申明：計畫引用的 API 名 `store.helpers.xpProgress` 實際為 `store.derived.xpProgress`（首次 E2E 時 TypeError 抓到），實作已按正確名稱使用；**意圖不變（唯讀衍生資料）、非範圍偏差**。臨時 debug hook（計畫九-16 授權）驗畢已刪，diff 自查 `__debugRenderReward` 為 0 處。

## 二、是否符合第一輪目標（重建章節）

| # | 目標 | 判定 | 說明 |
|---|---|---|---|
| 1 | 訓練完成後有清楚結算畫面 | **已完成** | 第一幕成績單資訊無損（A 級評級圓/六格/常見問題實測照常） |
| 2 | 知道自己完成了什麼 | **已完成** | 第一幕原樣（有效 43/無效 10/達標率 81%） |
| 3 | 有效次數/時間/卡路里/品質回饋 | **已完成** | 六格＋常見問題全在 |
| 4 | 金幣/XP/獎勵回饋 | **已完成** | 第二幕：+493 大數字（gold）＋Lv.3＋「+215 XP」＋XP 條真填充＋「再 N XP 升級」 |
| 5 | 獎勵與島嶼成長有關 | **已完成** | 🏝️ 視覺＋「金幣已存入錢包 · 去島上蓋新建築吧」＋已建 3 棟真值；「下一個解鎖目標」依計畫留 R3（不放假資訊） |
| 6 | 結算後自然回到島嶼 | **已完成** | Primary「🏝️ 去蓋房子」實測落在島嶼分頁、topbar 金幣即時更新 |
| 7 | 黃金路徑打通 | **已完成** | E2E 實測：今日層 CTA→推薦卡→簡介→示範模式 60 秒→第一幕→領取獎勵→第二幕→去蓋房子→島嶼——全程零人工解說可理解 |
| 8 | 對齊 Design System | **已完成** | 見七節 |

## 三、workout.js 修改範圍檢查

1. **本輪有修改 workout.js**——僅結算段（renderResult 2 行級＋新增 renderReward），45 行 diff 全落在計畫界定範圍。
2. **run-token 判斷點**：未修改（一個都沒少）。
3. **組數狀態機**：未修改（不存在的功能也未提前實作——歸 Slice 3）。
4. **Slice 3 預定的 AI Coach HUD 時序**：未修改（liveShell/handleResult/drawRingAndHud/checkEndingCues 零觸碰）。
5. **Slice 4 與 Slice 3 工作未混合**：renderReward 活在 `stopLive()` 之後的同步世界，與時序區零交集；`finishLive`（含 `!live.started` 守門、commitSession 呼叫）一行未動。
6. **原本訓練流程穩定性**：保留——實測「啟動相機中按結束」正確走守門回選單不結算；示範模式計次/HUD/語音/結算入帳全部照常。

## 四、Slice 1 保護檢查

1. 首頁／今日層：✅ 正常（實測 `.today` 渲染、streak 徽章讀真值）。
2. 島嶼主畫面：✅ 正常（island.js 時間戳 6/19 未動；「去蓋房子」導入後 3D 場景照常）。
3. 今日任務：✅ 正常。
4. 金幣／XP／等級：✅ 正常且**更活**——第二幕數字全來自 store 真值，topbar 同步更新（80→573→1066 兩輪實測）。
5. 回到島嶼 CTA：✅ 正確落在島嶼分頁（`ctx.navigate('island')` 既有 API）。
6. Slice 1 UI 被不必要修改：✅ 無（today/main/index/app.css 時間戳全停在 Slice 1 施工時間）。

**結論：Slice 1 未被破壞。**

## 五、Slice 2 保護檢查

1. 今日推薦訓練：✅ 正常（第二幕「完成」回清單後推薦卡在頂）。
2. 訓練卡片：✅ 正常（10 張齊、3D 動畫照常）。
3. 動作目的／難度／時長／目標部位：✅ 正常。
4. 獎勵提示（🪙/🔥 徽章）：✅ 正常。
5. 開始訓練 CTA：✅ 正常（本輪 E2E 就是從推薦卡進的）。
6. 返回首頁／今日層：✅ 正常。
7. Slice 2 UI 被不必要修改：✅ 無（renderMenu/renderIntro/卡片四純函式零觸碰——diff 全在結算段）。

**結論：Slice 2 未被破壞。**

## 六、禁止修改區域檢查（重建章節）

| 區域 | 結果 |
|---|---|
| `app/core`（AI 偵測核心/判定引擎） | **未修改**（時間戳 7/2） |
| `tests` 舊斷言 | **未修改**（6/23；34/34 綠） |
| `vendor` | **未修改**（6/19） |
| `docs/CONTRACTS.md` 既有簽名 | **未修改** |
| `finishLive`/`commitSession`（含呼叫參數）/加幣路徑 | **未修改**（先 commit 後演出——第二幕純表現層，實測錢包增量=493=session） |
| `island.js` | **未修改**（6/19；下一解鎖目標歸 R3） |
| `store.js` | **未修改**（6/30；僅唯讀 getState/derived.xpProgress） |
| run-token／時序區／Coach HUD | **未修改** |

無風險項。

## 七、Design System 對齊檢查（重建章節）

1. 元件 #8 Coin Reward Card：✅ 金幣大數字（HUD Number、`--gold`、`tabular-nums`、clamp 字級）＋XP 條；飛行粒子依規則歸 R4。
2. 元件 #7 Result Card：✅ 第一幕零改動、評級圓錨點維持。
3. 色彩：✅ 新增 CSS 全 tokens（`--gold`/`--teal`/`--grad-teal`/`--surface-2`/`--muted`/`--faint`）＋`color-mix` 光暈，零硬編碼色票。
4. §七-Slice 4 規則：✅ 第二幕停在 Primary「去蓋房子」；金幣一律 gold；儀式動畫 1–4 秒的預算留給 R4（本輪無動畫，DS 十一-8 天然滿足）。
5. 一屏一 Primary：✅ 第一幕=領取獎勵›／第二幕正常變體=去蓋房子／Empty 變體=再一次——實測各畫面 primaryCount=1。
6. Empty State（元件 #15 空＝引導）：✅ 0 金幣變體「這次沒有獲得金幣——只有有效動作才換得到金幣，再試一次！」＋Primary 再一次、無 +0 慶祝、無死路島嶼鈕。
7. 字級/間距/圓角：✅ 卡 padding 20–24、gap 14、`.card/.btn/.pill` 全復用。

## 八、功能與測試檢查

1. **現有測試**：`node tests/run.js` 施工後與收尾各一次——**34/34 passed**；ESM 語法檢查過。
2. **E2E（Playwright，兩輪完整跑）**：今日層 CTA→推薦卡→簡介→立即開始→（覆寫 getUserMedia 模擬拒絕）→offerDemo→示範模式跑滿 60 秒→第一幕→領取獎勵›→第二幕→去蓋房子→島嶼。**防刷比對：第二幕 +493＝第一幕金幣格＝session.coinsEarned＝錢包增量（573→1066 第二輪同樣吻合）**。
3. 兩變體驗證：正常變體（真 session）與 0 金幣 Empty 變體（債務 hook＋構造假 session，只驗呈現不寫 store）全過；hook 驗畢已刪。
4. 手動重現：`python3 serve.py 8080` → 今日層 CTA → 推薦卡 → 簡介 → 立即開始 →（真機可用相機或改示範模式）→ 跑滿 → 領取獎勵 → 去蓋房子。
5. 從首頁進訓練：✅（實測）。6. 從 Slice 2 開始訓練：✅。7. 完成後進結算：✅。8. 結算後回島嶼：✅。9. 再訓練 CTA：✅（第一幕「再一次」零變更＋Empty 變體 Primary 再一次）。
10. 手機 390px：✅ 直排、CTA 拇指區、截圖 `screenshots/slice4-r1-reward-390.png`。
11. 桌機 1200px：✅ 限寬置中一屏內、截圖 `screenshots/slice4-r1-reward-1200.png`。
12. console：本輪程式碼路徑 **0 error**（實測中出現的 2 個 error 均判定為既有 island.js 競態，見九-4，與本輪 diff 無關且不經獎勵畫面可重現）。

## 九、目前還剩下的問題

| 分類 | 項目 |
|---|---|
| **1. 必須在 Slice 4 第二輪處理** | 元件抽出：金幣大數字／XP 條／（R4 要用的）滾動計數抽成函式，與 Slice 5 目標環共用語彙（Workflows §Slice 4 R2 既定） |
| **2. 可以留到 Slice 3 處理** | 結算數字的「組×次」語意（目前 60 秒單組制；六-補終止邏輯落地後，結算欄位語意由 Slice 3 對齊——本輪刻意未動） |
| **3. 可以留到其他 Slice／輪次** | Slice 4 R3：第二幕接 island「下一個解鎖目標（差 XX🪙）」＋island HUD 目標條＋雙向引流；Slice 4 R4：金幣飛行/計數滾動/落袋音/可跳過、升級特效；橫切：workout.css 硬編碼色掃收 |
| **4. 暫時不用處理（待使用者裁決）** | ①**既有 island.js 競態**：`island.js:145` `setTimeout(S.resize, 30)` 在進島後 30ms 內切走 → null error（6/19 舊碼；不經獎勵畫面、快速切 tab 即可重現；正常人手速不會觸發；一行 null-guard 可修，但 island.js 屬禁區需宣告式變更）②型錄卡難度恆顯 1 點（Slice 2 R2 已記錄）③XP 顯示公式與 commitSession 重複（已加註解，後續可讓 commitSession 回傳 xpGain） |

## 十、是否可以進入 Slice 4 第二輪或 Slice 3

1. **可以進入 Slice 4 第二輪**：R1 通過、零範圍偏差、黃金路徑已通——R2（元件抽出、畫面不變）是低風險內部品質輪，隨時可做。
2. **技術上也可以進入 Slice 3**：Slice 4 的結算段改動與 Slice 3 時序區零交集（本輪刻意設計），不構成阻擋。
3. **建議優先序**：**Slice 4 R3（島嶼端目標＋雙向引流）> Slice 4 R2 > Slice 3**。理由：R3 補完「島嶼成長→拉回訓練」的循環最後一步（目前去蓋房子後沒有「下一個目標」的鉤子），是評審可見價值；R2 是內部品質輪可與 R3 合併規劃；Slice 3 高風險應在 Slice 4 全部收口後單獨進場（總執行序 1→4→2→3 的精神）。
4. **若進 Slice 3 的理由**：黃金路徑已通、時序區至今零改動、呈現層邊界已由 Slice 2 R2 整理清楚——前置條件都齊。
5. **進 Slice 3 前要注意**：R1/R2 純靜態輪安全；**R3（組數狀態機接時序）動工前必須另寫迷你實作計畫送 cross-model 互審**（Workflows 明定）；run-token/`live!==run` 判斷點一個不能少；`finishLive` 守門不能繞；SET_SECONDS 語義改變需同步示範模式與 checkEndingCues；每輪必跑時序清單（載入中退出/暫停恢復/再一次/組間退出/完整 3 組）；不得與 Slice 6-R3 同週。
6. **Slice 3 不可破壞的成果**：
   - Slice 1：今日層預設頁/五 tab/`setChrome` 契約。
   - Slice 2：推薦卡與 `data-rec-id` hook、四個純模板函式簽名（`planText(meta)` 是休息卡文案預定單一來源）、金幣估算公式凍結。
   - **Slice 4（本輪新增的保護對象）**：`renderResult`→`renderReward` 兩幕流程與 CTA 契約（含 0 金幣變體）、「先 commit 後演出」原則、第二幕數字=store 真值——Slice 3 改組數結構後，**傳入 renderResult/renderReward 的 summary/session 欄位語意若變，必須在 Slice 3 計畫中申報並同步驗證第二幕**。
   - 通用：commitSession 防刷鐵則、34 測試、示範模式全流程、相機拒絕→offerDemo。

**驗收結論：Slice 4 第一輪通過。**（黃金路徑 E2E 實測打通；防刷數字三方吻合；核心/時序零觸碰；一項計畫勘誤已申明。）
