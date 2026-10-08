# TODO_PLAN — Island Fitness AI｜第三階段：健身設定進遊戲設定頁、紀錄來源欄、關於頁
<!-- cross-model-review: skip（2026-09-24 使用者裁示：本專案不送 Codex 審） -->

> 產生時間：2026-10-08
> 需求來源：`REQUIREMENT.md`（第 8 節拍板：本次範圍＝G3、G4、G5；健康頁 G1／G2 暫緩、G6 不做）
> 前一份看板：`docs/開發紀錄/TODO_PLAN_合體第二階段整合.md`（13/13）
> 技術棧：整合版 `motu-app/`（React 19＋TS＋Vite＋Tailwind 4，遊戲組 Motu 設計系統）＋健身核心 `app/`（純 ES Modules，`@fitness` 別名直接引用）
> 測試指令：
>   - 我方：`npm test`（基線 **521/521**，只增不減）
>   - 整合版：`cd motu-app && npx tsc --noEmit`、`npm run test:fitness`、`npm run test:workout-rewards`（基線 61/61）
>   - 完整 build：`cd motu-app && npx vite build`
> 執行方式：`cd motu-app && npm run dev` → `http://localhost:3000`（Firebase 已接遊戲組正式專案；訪客登入亦可）

## 需求檔位
- **檔位**：L
- **判定理由**：從 S 起算，命中 4 條 →
  ①碰持久化：健身偏好改存遊戲存檔 `users/{uid}/settings`（雲端），訓練紀錄 `workout_logs` 加欄位；
  ②介面多個消費端：`AppSettings` 型別同時被遊戲設定頁、`AppContext` 預設值、健身外框使用；`WorkoutCompletion` 被遊戲發獎服務與健身結算共用；
  ③brownfield 耦合部分未知：遊戲組 `useWorkoutRewards.ts`、`AppContext.tsx` 的設定讀寫流程；
  ⑤橫跨 3 個以上關注點：型別＋雙向同步邏輯＋兩個設定畫面＋紀錄欄位。
  （④新依賴：不新增套件，未命中。）
- **本檔位規格**：Slice 數 9 ｜ slice-reviewer **逐 Slice** ｜ 完整 build 收尾＋動到建置設定時 ｜ context 隔離：半自動每 2–3 個 Slice 換對話（或 `/run-slice N --isolate`）
- **UI 三件套獨立**：骨架＝Slice 1、視覺美學＝Slice 7、微互動＝Slice 8。

## 架構決策
1. **遊戲存檔為唯一來源**：整合版的健身偏好存在 `users/{uid}/settings`（`AppSettings` 新增選填欄位 `fitnessDifficulty`、`fitnessColorMode`、`fitnessMirror`、`fitnessBgm`）。語音沿用既有 `voiceGuideEnabled`、熱身沿用既有 `warmupEnabled`（拍板 4：合併）。
2. **健身頁本身不改讀法**：`app/` 照舊讀 `store.prefs`。由 `FitnessHost` 做雙向同步橋：遊戲設定 → `store.updatePrefs()`；健身頁內自己改的偏好（目前只有簡介頁的熱身勾選 `workout.js:418`）→ `updateSettings()`。兩個方向都先比對值，相同就不寫，防止來回觸發。
3. **配色模式由外框套用**：整合版目前**沒有呼叫 `setPalette()`**（舊版在 `app/main.js` 呼叫），所以色盲配色在整合版一直沒生效 —— 一併在同步橋修正。
4. **紀錄來源**：不改 `WorkoutSource`（拍板 5）；`WorkoutCompletion` 新增選填 `detector`，健身結算填 `'ai-camera'`，`useWorkoutRewards` 寫 `workout_logs` 時一併寫入。雲端規則（ruleset `9d568a85`）不禁止多加欄位，已查證。
5. **設定頁分類**：「畫面」「操作」原本就已隱藏（`settingsCategories.ts` 的 `available: false`），不需動；「關於」改 `available: true` 並補內容；新增 `fitness` 分類。
6. **舊版 :8080 不受影響**：它仍用 `localStorage` 的 `store.prefs` 與自己的設定頁。

## 本次的不變量
1. 判定引擎 `app/core/` 不動；骨架判定色本身不改（只是讓整合版也套用已有的配色模式）。
2. 測試只增不減：我方 521、`test:workout-rewards` 61/61、`test:fitness` 全綠；不新增 skip/only。
3. 改遊戲組既有檔案要在下方申報，並保留 CRLF 換行（拍板 6）。
4. 不新增 npm 套件、不接付費服務、不 push、不部署 Firebase 規則。
5. 健康頁（`components/health/`）**不碰**（G1／G2 暫緩）。

**已申報的遊戲組檔案改動**（施工時回填）：
- （例：`types.ts` AppSettings 新增選填欄位、`GeneralCategory.tsx` 移除 AI 語音引導列）

## 設計鐵律速查
- 沿用遊戲組 Motu 設計系統：`island-*` token、`SettingsSection`／`SettingRow`／`Toggle`（`DesignKit.tsx`）、`rounded-2xl`／`rounded-xl` ｜ `lucide-react` `size={18}` ｜ 免費優先

## 設計顧問輸入（ui-ux-pro-max，全專案只查這一次）
- **採納**：
  - 三選一（難度、骨架配色）用**分段選擇器**，選項全部攤開看得到，不用下拉（選項 ≤3、需比較時下拉會藏資訊）；以 `role="radiogroup"`＋`aria-checked`，方向鍵可切換。
  - 觸控區 ≥44×44px、目標間距 ≥8px；每列有可見文字標籤與一行說明（不是只有圖示）。
  - 即時儲存要有回饋：改完在該列顯示短暫「已儲存」勾號（`aria-live="polite"`，不搶焦點），失敗時在同列顯示原因＋重試，不只放頁頂。
  - 色盲配色選項旁附小色票預覽，且**不只靠顏色**：色票上同時寫字（例：好／注意／錯）。
  - 過場 150–300ms、只動 opacity/transform、尊重 `prefers-reduced-motion`；`focus-visible` 焦點框保留。
- **駁回**：
  - 技能預設的 `neutral`／`zinc` 中性灰主色與單一強調色（理由：UI Authority 第 3 位「既有 Design System」優先，設定頁必須和遊戲組其他設定分類一致，用 `island-*` token）。
  - `dark:` 成對撰寫（理由：遊戲組設定頁與整套 Motu 介面沒有深色模式，單獨給兩個分類加深色會和其他分類不一致）。
  - Phosphor 圖示庫（理由：專案統一 `lucide-react`）。
  - 震動回饋（理由：桌機網頁為主，設定切換不屬重要確認動作）。
> 下游的 run-slice 與 slice-builder 一律沿用本區塊，不得重新調用 ui-ux-pro-max。

## 進度總覽
- 總 Slice 數：9
- 已完成：0 / 9
- 平行組：無（全部序列）

---

### [ ] Slice 1 — 刻出設定頁健身分類與關於頁的骨架
- **目標**：設定頁導覽多一格「健身」、「關於」也出現，點進去看得到所有設定列與關於頁的版面（資料寫死、不存檔）。
- **範圍內**：`settingsCategories.ts` 新增 `fitness`（圖示 `Dumbbell`，放在「一般」之後）並把 `about` 設為可見；新增 `FitnessCategory.tsx`：難度（輕鬆／標準／挑戰）、骨架配色（三色 `tricolor`／單色 `mono`／高對比 `high`，名稱沿用舊版設定頁 `app/features/settings/settings.js:146`）兩組分段選擇器，鏡像、熱身、訓練音樂、語音教練四個開關，用既有 `SettingsSection`／`SettingRow`／`Toggle`；`AboutCategory.tsx` 換成版面骨架（版本、團隊、資料來源三個區塊，文字先放佔位）；`SettingsView.tsx` 掛上 `fitness`。
- **範圍外**：讀寫真實設定、即時生效、儲存回饋、色票預覽、進場與 hover 動畫、錯誤與載入狀態、關於頁真實內容。
- **改動檔案**：`motu-app/src/components/UI/settings/settingsCategories.ts`（修改）、`motu-app/src/components/UI/settings/FitnessCategory.tsx`（新增）、`motu-app/src/components/UI/settings/AboutCategory.tsx`（修改）、`motu-app/src/components/SettingsView.tsx`（修改）
- **設計要點**：沿用一般／音效分類的列高、間距、字級；分段選擇器每格 ≥44px 高。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 設定頁導覽依序出現「一般、健身、音效、帳號、關於」，「畫面」「操作」仍不出現
  - [ ] 健身分類顯示 2 組分段選擇器＋4 個開關，可點、可用鍵盤 Tab 走到
  - [ ] 關於頁顯示三個區塊骨架
- **測試策略**：`motu-app/scripts/test-fitness-settings-view.ts` — 導覽清單順序與可見性（`VISIBLE_SETTINGS_CATEGORIES` 含 fitness／about、不含 graphics／controls）；邊界：分類 id 不重複
- **完成定義**：Type Check PASS + 指定測試 PASS + dev server 截圖 → **停下來請使用者看過版面再往下**
- **對外介面**：
- **依賴**：無
- **平行組**：獨立

### [ ] Slice 2 — 定義健身偏好與遊戲設定的對應表
- **目標**：一份純函式對應表，能把遊戲設定轉成健身頁的 `prefs`，也能把 `prefs` 的變更轉成遊戲設定的寫入內容。
- **範圍內**：`types.ts` 的 `AppSettings` 新增選填 `fitnessDifficulty`、`fitnessColorMode`、`fitnessMirror`、`fitnessBgm`；新增 `fitnessPrefs.ts`：`prefsFromSettings(settings)`（缺欄位或未知值用 `app/state/store.js` 的預設值；語音←`voiceGuideEnabled`、熱身←`warmupEnabled`）、`settingsPatchFromPrefs(prev, next)`（只回傳有變的欄位，沒變回 `null`）。
- **範圍外**：接上 FitnessHost、畫面讀寫。
- **改動檔案**：`motu-app/src/types.ts`（修改，申報）、`motu-app/src/components/fitness/fitnessPrefs.ts`（新增）、`motu-app/scripts/test-fitness-prefs.ts`（新增）、`motu-app/package.json`（修改：`test:fitness` 串上新腳本）
- **設計要點**：N/A ｜ 純邏輯
- **UI Slice?**：NO
- **驗收標準**：
  - [ ] 空設定（新玩家／舊存檔）→ 回傳與 `store.js` 預設相同的 prefs
  - [ ] 未知的難度或配色字串 → 回預設值，不會把壞值傳進健身頁
  - [ ] patch 只含有變動的欄位；完全沒變回 `null`
- **測試策略**：`test-fitness-prefs.ts` — 雙向往返（settings→prefs→patch 為 null）、語音／熱身合併對應、邊界：`null` 設定、型別錯誤的值（字串 `'true'`）
- **完成定義**：Type Check PASS + `test:fitness` PASS
- **對外介面**：
- **依賴**：無
- **平行組**：獨立

### [ ] Slice 3 — 讓健身頁跟著遊戲設定走並套用配色模式
- **目標**：在遊戲設定改了偏好，健身頁立刻照新值運作；健身頁內改的熱身勾選也會寫回遊戲存檔；色盲配色在整合版開始生效。
- **範圍內**：新增 `useFitnessPrefsBridge.ts`：訂閱 `useApp().settings` → `store.updatePrefs(prefsFromSettings(...))`；訂閱 `store` → `settingsPatchFromPrefs` 有變才 `updateSettings()`；兩向都比對值防迴圈；配色變了就呼叫 `setPalette()`；`FitnessHost.tsx` 掛上這個 hook，語音教練 `coach.setEnabled`（若 coach 沒有此方法則重建，施工時查證）。
- **範圍外**：設定頁畫面讀寫（Slice 4）。
- **改動檔案**：`motu-app/src/components/fitness/useFitnessPrefsBridge.ts`（新增）、`motu-app/src/components/fitness/FitnessHost.tsx`（修改）、`motu-app/scripts/test-fitness-prefs-bridge.ts`（新增）、`motu-app/package.json`（修改）
- **設計要點**：N/A ｜ 狀態同步
- **UI Slice?**：NO
- **驗收標準**：
  - [ ] 遊戲設定改難度 → `store.getState().prefs.difficulty` 跟著變
  - [ ] 健身頁改熱身勾選 → 呼叫一次 `updateSettings({ warmupEnabled })`，且不會無限來回
  - [ ] 配色改成單色或高對比 → `setPalette` 被呼叫一次，骨架用新色
  - [ ] 設定尚未載入（`settings` 為 `null`）時健身頁照預設值正常運作
- **測試策略**：`test-fitness-prefs-bridge.ts` — 用假的 settings 來源與假 store 驅動橋的核心函式（把 hook 的邏輯抽成可測的 `createPrefsBridge()`）；邊界：連續兩次相同更新只寫一次、更新來源互相觸發時次數上限
- **完成定義**：Type Check PASS + `test:fitness` PASS + 我方 `npm test` PASS（`app/` 未改應維持 521）
- **對外介面**：
- **依賴**：Slice 2
- **平行組**：獨立

### [ ] Slice 4 — 設定頁健身分類接上真實存檔
- **目標**：在設定頁「健身」改任何一項，會存進遊戲存檔、重新整理仍在，進健身頁立即生效。
- **範圍內**：`FitnessCategory.tsx` 讀 `useApp().settings`（經 `prefsFromSettings` 取顯示值）、寫 `updateSettings()`；`GeneralCategory.tsx` 移除重複的「AI 語音引導」列（語音統一放健身分類，拍板 4；申報）。
- **範圍外**：儲存回饋與失敗提示（Slice 8、9）、視覺打磨（Slice 7）。
- **改動檔案**：`motu-app/src/components/UI/settings/FitnessCategory.tsx`（修改）、`motu-app/src/components/UI/settings/GeneralCategory.tsx`（修改，申報）
- **設計要點**：沿用 Slice 1 骨架版面，不改外觀。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 改 6 項任一項後重新整理，值仍保留（訪客模式與 Google 登入各測一次；Google 登入由使用者實測）
  - [ ] 設定頁改配色 → 進健身頁骨架顏色已換
  - [ ] 「一般」分類不再有語音列，語音只在「健身」出現一次
- **測試策略**：`test-fitness-settings-view.ts` 增加：顯示值來自 `prefsFromSettings`；無頭瀏覽器實測改值 → 重新整理 → 值還在
- **完成定義**：Type Check PASS + 指定測試 PASS + UI QA（截圖）PASS
- **對外介面**：
- **依賴**：Slice 1、Slice 3
- **平行組**：獨立

### [ ] Slice 5 — 訓練紀錄寫入 AI 相機來源欄
- **目標**：每一筆健身頁產生的訓練紀錄都帶 `detector: 'ai-camera'`，之後健康頁能分辨。
- **範圍內**：`constants/workoutRewards.ts` 的 `WorkoutCompletion` 新增選填 `detector?: string`（`makeWorkoutCompletion` 透傳）；`gameContract.ts` 的 `completionFromSession` 填 `'ai-camera'`；`context/useWorkoutRewards.ts` 寫 `workout_logs` 時，有 `detector` 才寫入。
- **範圍外**：健康頁顯示來源（G2，暫緩）；改 `WorkoutSource`。
- **改動檔案**：`motu-app/src/constants/workoutRewards.ts`（修改，申報）、`motu-app/src/context/useWorkoutRewards.ts`（修改，申報）、`motu-app/src/components/fitness/gameContract.ts`（修改）、`motu-app/scripts/test-fitness-contract.ts`（修改）
- **設計要點**：N/A ｜ 資料欄位
- **UI Slice?**：NO
- **驗收標準**：
  - [ ] 相機 session → completion 帶 `detector: 'ai-camera'`
  - [ ] 遊戲組其他來源（原型、管理員測試）不帶此欄，寫出的紀錄與改前相同
  - [ ] `test:workout-rewards` 仍 61/61
- **測試策略**：`test-fitness-contract.ts` 新增 detector 斷言；邊界：示範模式與 0 下有效仍回 `null`（不寫紀錄）
- **完成定義**：Type Check PASS + `test:fitness` PASS + `test:workout-rewards` 61/61
- **對外介面**：
- **依賴**：無
- **平行組**：獨立

### [ ] Slice 6 — 填入關於頁的真實內容
- **目標**：「關於」顯示系統版本、團隊分工、資料與技術來源，每一條都有出處。
- **範圍內**：版本（取 build 時間或 git commit 短碼，施工時決定，不寫死）；團隊（健身組／遊戲組與各自負責區塊，**不寫個人姓名**，除非使用者提供）；資料來源（國健署、WHO 運動建議，沿用 `app/features/workout/safety.js` 已查證的 `SAFETY_SOURCES`；MediaPipe Pose 與授權；Three.js 等主要開源套件與授權，從 `package.json`／`vendor/` 實際讀出）。
- **範圍外**：視覺打磨、動畫。
- **改動檔案**：`motu-app/src/components/UI/settings/AboutCategory.tsx`（修改）、`motu-app/src/components/UI/settings/aboutContent.ts`（新增）、`motu-app/scripts/test-fitness-about.ts`（新增）、`motu-app/package.json`（修改）
- **設計要點**：沿用 Slice 1 骨架；外部連結 `target="_blank" rel="noopener noreferrer"`。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 每一條資料來源都有名稱＋網址；運動建議與健身頁「運動前須知」同一份來源
  - [ ] 版本不是寫死字串
  - [ ] 沒有未查證的敘述
- **測試策略**：`test-fitness-about.ts` — 每筆來源有 name/url、網址為 https、來源清單包含 `SAFETY_SOURCES` 全部項目
- **完成定義**：Type Check PASS + 指定測試 PASS + UI QA PASS
- **對外介面**：
- **依賴**：Slice 1
- **平行組**：獨立

### [ ] Slice 7 — 打磨健身分類與關於頁的視覺
- **目標**：兩個新分類看起來跟遊戲組其他分類是同一套，分段選擇器與色票預覽到位。
- **範圍內**：分段選擇器選中態、色盲配色色票預覽（色票上同時寫字）、說明文字層級、關於頁區塊間距與連結樣式；寬窄螢幕都不跑版。
- **範圍外**：動畫與儲存回饋（Slice 8）、錯誤狀態（Slice 9）。
- **改動檔案**：`FitnessCategory.tsx`（修改）、`AboutCategory.tsx`（修改）
- **設計要點**：見「設計顧問輸入」採納項；對比 ≥4.5:1（沿用前階段結論：海洋青／金／珊瑚不當小字）。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 截圖與「一般」「音效」分類並排，字級、間距、圓角一致
  - [ ] 色票不只靠顏色辨識
  - [ ] 375px 寬不出現水平捲動
- **測試策略**：無頭瀏覽器截圖（1440 與 375 寬）＋對比檢查
- **完成定義**：Type Check PASS + UI QA PASS
- **對外介面**：
- **依賴**：Slice 4、Slice 6
- **平行組**：獨立

### [ ] Slice 8 — 加上儲存回饋與切換微互動
- **目標**：改設定時有清楚但不打擾的回饋。
- **範圍內**：該列短暫「已儲存」勾號（`aria-live="polite"`）、分段選擇器切換過場、hover／active／focus-visible、`prefers-reduced-motion` 時關閉過場、分段選擇器方向鍵操作。
- **範圍外**：錯誤處理（Slice 9）。
- **改動檔案**：`FitnessCategory.tsx`（修改）
- **設計要點**：150–300ms、只動 opacity/transform。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 改值後 1 秒內出現已儲存提示並自動消失，不搶焦點
  - [ ] 鍵盤能完成所有設定（Tab＋方向鍵＋空白鍵）
  - [ ] 開啟減少動態效果時沒有過場
- **測試策略**：無頭瀏覽器鍵盤操作走一遍；`emulateMedia reducedMotion`
- **完成定義**：Type Check PASS + UI QA PASS
- **對外介面**：
- **依賴**：Slice 7
- **平行組**：獨立

### [ ] Slice 9 — 處理設定未載入與寫入失敗
- **目標**：網路或權限出問題時，設定頁與健身頁都不會卡住或顯示錯誤值。
- **範圍內**：設定尚未載入 → 健身分類顯示載入骨架；`updateSettings` 失敗 → 該列顯示失敗原因＋重試，畫面值回到存檔值；健身頁照目前的 prefs 繼續可用。
- **範圍外**：離線佇列重送（遊戲組 Firestore 本身的離線快取已處理）。
- **改動檔案**：`FitnessCategory.tsx`（修改）、`useFitnessPrefsBridge.ts`（修改）、`scripts/test-fitness-prefs-bridge.ts`（修改）
- **設計要點**：錯誤訊息在該列下方，寫清楚原因與怎麼辦。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 模擬 `updateSettings` 拒絕 → 該列顯示失敗＋重試，值回復
  - [ ] 橋在寫入失敗時不會重試成無限迴圈
- **測試策略**：`test-fitness-prefs-bridge.ts` 新增寫入失敗案例；無頭瀏覽器以假失敗驗證畫面
- **完成定義**：Type Check PASS + `test:fitness` PASS + UI QA PASS
- **對外介面**：
- **依賴**：Slice 8
- **平行組**：獨立

---

## 收尾總驗證（全部 Slice 完成後）
- 我方 `npm test`、整合版 `tsc`／`test:fitness`／`test:workout-rewards`／`vite build` 全綠
- 無頭瀏覽器完整走一次：登入 → 主頁 → 設定改健身偏好 → 健身頁確認生效 → 完成一次訓練（測試腳本模擬相機 session）→ 紀錄帶 `detector` → 重新整理偏好仍在
- 列出 console 的既有警告（Three.js 多重載入、`THREE.Clock` 已淘汰），確認沒有新增錯誤
- 批次審未當場審的 Slice（L 檔逐 Slice 審，理論上無）
