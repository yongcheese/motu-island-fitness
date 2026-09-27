# TODO_PLAN — Island Fitness AI｜合體第二階段（整合）：健身頁導入遊戲組元件
<!-- cross-model-review: skip（2026-09-24 使用者裁示：本專案不送 Codex 審） -->

> 產生時間：2026-09-26
> 需求來源：`REQUIREMENT.md`（第 6 節拍板 9 條、第 7 節驗收標準）
> 前一份看板：第二階段前段 14/14，封存為 `TODO_PLAN_合體第二階段前段.md`（最後 commit `f5b6661`）。**它的收尾 Final Validation 尚未做，併入本看板的收尾總驗證一起跑。**
> 動工前備份：`../育秀杯_備份/健身組_加入遊戲組元件前_20260926-2200/`（含 `.git`，commit `099299a`）
> 技術棧：
>   - **整合版**（新）：`motu-app/`＝遊戲組原始碼（`Motu-島嶼健身-原始碼-最新版/`，git 95d63eb）的工作複本，React 19＋TS＋Vite＋Tailwind 4＋R3F，three r184；由本 repo 追蹤
>   - **健身核心**（既有）：`app/` 純 ES Modules，整合版以 Vite 別名**直接引用**，不複製第二份
> 測試指令：
>   - 我方：`npm test`（基線 **462/462 綠**，只增不減）
>   - 整合版：`cd motu-app && npx tsc --noEmit`、`npm run test:workout-rewards`（基線 61/61）、本看板新增的 `npm run test:fitness`
>   - 完整 build：`cd motu-app && npx vite build`
> 執行方式：整合版 `cd motu-app && npm run dev` → `http://localhost:3000`（訪客登入，存檔只在本機瀏覽器）；我方舊版 `python3 serve.py 8080` 仍可獨立運作

## 需求檔位
- **檔位**：L
- **判定理由**：從 S 起算，加分清單命中 4 條 →
  ①碰持久化／經濟：結算改由遊戲端發金幣、經驗、碎片（寫 `users/{uid}` 或本機存檔）；
  ②介面多個消費端：訓練頁 `ctx`（`store`／`setChrome`／`navigate`）要同時服務我方舊外殼與整合版宿主；
  ③brownfield 且耦合未完全掌握：遊戲組 `Avatar.tsx` 4311 行、角色骨架與穿著系統、`useWorkoutRewards` 發獎流程皆為他人程式；
  ⑤橫跨 5 個以上關注點：建置整合、3D 角色、動作轉換、SVG 動畫、發獎、動畫序列、結算版面。
  （④新依賴：不新增 npm 套件，整合版沿用遊戲組既有依賴，未命中。）
- **本檔位規格**：Slice 數 13 ｜ slice-reviewer **逐 Slice**（L 檔） ｜ 完整 build（`vite build`）每個平行組一次＋動到建置設定時＋收尾 ｜ context 隔離：半自動每 2–3 個 Slice 換一次對話（或 `/run-slice N --isolate`）
- **UI 骨架 Slice：有（Slice 1）**。三件套獨立：骨架＝Slice 1、視覺美學＝Slice 12、微互動＝Slice 13。

## 架構決策（本看板的地基）
1. **單一原始碼**：整合版 `vite.config.ts` 加別名 `@fitness` → `../app`，並開 `server.fs.allow` 到上一層；`app/` 仍是我方唯一的健身原始碼，舊版 :8080 與 462 條測試照跑。
2. **vendor 靜態資源**：MediaPipe wasm／模型以宿主提供的絕對路徑 `/vendor/...` 供應（`server.ts` 靜態掛載＋ build 時複製），`app/core/pose.js` 改為可由 `ctx` 注入資產根目錄，預設值維持 `./vendor`（舊版不受影響）。
3. **宿主 `FitnessHost.tsx`** 取代遊戲組 `FitnessView`（App.tsx 只換一行掛載；`FitnessView.tsx` 保留不刪）：
   - 以 ref 容器呼叫 `workout.mount(el, ctx)`，卸載時 `unmount()`；
   - `ctx.setChrome(false)` → `setIsWorkoutActive(true)`（遊戲端既有的全螢幕隱藏 HUD 機制）；
   - `ctx.navigate('island')` → 切回遊戲主頁。
4. **健身頁 ↔ 遊戲端契約**（`ctx.game`，選配；沒有時訓練頁走舊行為，舊版與測試不受影響）：
   - `ctx.game.balances()` / `subscribe(fn)`：金幣、碎片、經驗、等級（讀遊戲組 profile）
   - `ctx.game.settle(summary) → Promise<Award[]>`：以**有效次數與時間**呼叫 `reportWorkoutCompletion`（金幣／經驗照遊戲端 `payoutForWorkout`）＋碎片照遊戲端 `fragmentsForWorkout`／`grantFragments`
   - `ctx.game.claim(awards) → Promise<void>`：播逐項領獎序列，玩家按下「任意鍵以繼續」後 resolve
   - `ctx.slots.mount(name, el, props)` / `unmount(name)`：訓練頁在自己的 DOM 留插槽，宿主用 React portal 把遊戲元件（主角、阿肌背景、對話框、資源列）畫進去
   - `ctx.events.emit(type, payload)`：`rep`（每計一下）、`phase`（準備／進行／休息／結束）、`milestone`（達標、剩最後幾下）
5. **金額以遊戲端為準**：我方 `coinsFor` 只留在舊版；整合版的顯示與發放一律走 `ctx.game`（遵守藍圖「資源怎麼發是遊戲端的事」）。訓練統計仍只算 AI 判定的有效次數。
6. **我方判定引擎 `app/core/` 不動**。
7. **健身頁關在 Shadow DOM 裡**（Slice 1 施工時確立）：兩邊 CSS 互相衝突（我方有 `:root`／`body`／`* {}`／`button {}` 全域規則，遊戲端有 Tailwind preflight），直接同頁載入會互相打壞。做法：
   - `FitnessHost` 在宿主元素上開 shadow root，結構同舊版 `#app > #view`；
   - 我方樣式以 `?raw` 讀入，經 `fitnessStyles.ts` 的 `toShadowCss()` 改寫（`:root`→`:host`、`html`／`body`→`.fx-body`、`@font-face` 抽出掛到 `document.head`，字型網址改為 `/vendor/…`），測試 `scripts/test-fitness-shadow-css.ts`；
   - 遊戲端樣式（`document.head` 的 style／link）複製一份進 shadow root，讓畫進插槽的遊戲元件有 Tailwind 樣式；遊戲的 `:root` 變數靠 CSS 自訂屬性繼承穿過 shadow 邊界。
   - 後續 Slice 的遊戲元件一律用 `createPortal` 畫進插槽或 `.fx-overlay` 層（都在 shadow 內）。
8. **回島嶼的方式**：遊戲端分頁列只在主頁顯示（`App.tsx`：`currentView === View.HOME`），其他頁面各自有右上角關閉鍵。健身頁照健康頁、設定頁的做法，由 `FitnessHost` 在非全螢幕時顯示右上角關閉鍵回主頁。

## 本次的不變量（任何 Slice 都不得破壞）
1. 判定引擎（`app/core/` 的判定、計次、門檻）不動；`pose.js` 只允許新增「資產根目錄」參數且預設值不變。
2. 骨架判定色（藍綠黃紅＋色盲配色）保持我方的。
3. 我方 `npm test` 只增不減（462 起算）；不新增 skip/only；既有斷言只有在需求變更時才可改寫，且須在下方申報。
4. 遊戲組原始碼交付資料夾 `Motu-島嶼健身-原始碼-最新版/` **不修改**（唯讀參考）；所有改動都在 `motu-app/`。
5. `motu-app/` 裡遊戲組既有檔案：只允許改 `App.tsx`（掛載一行）、`vite.config.ts`、`server.ts`（靜態掛載）、`tsconfig.json`（`@fitness/*` 路徑對應，Slice 1 申報：沒有它 TS 解析不到別名）、`package.json`（新增 script）、`CoachSprite.tsx`（新增姿勢，既有姿勢外觀不變；Slice 1 申報：嘴型 `motion.path` 補 `initial`，修正遊戲組原有的 console 錯誤 `attribute d: "undefined"`，該錯誤在遊戲端新手引導同樣會出現，外觀不變）；其他一律新增檔案。改檔時保留原檔的 CRLF 換行，避免整檔差異。遊戲組的 `test:workout-rewards` 61/61 不得退步。
6. 免費優先；不新增 npm 套件、不接付費服務；不 push。
7. 企劃書截圖以整合版畫面為正式畫面（REQUIREMENT 第 6 節第 9 條）。

**已申報的需求變更（既有斷言改寫）**：
- （施工時回填，例：結算頁移除金幣／經驗 → `tests/session-rewards.test.js`、`tests/game-resource-card.test.js` 相關斷言；今日推薦卡移除太陽 → `tests/workout-visual.test.js`）
- Slice 4（2026-09-27）：`tests/icons.test.js`「icon() 輸出…」的內容斷言由較新版 Lucide coins（`<circle cx="16" cy="8" r="6"`）改為遊戲組 0.546 版（`<circle cx="8" cy="8" r="6"`）—— 需求：金幣圖示與遊戲端同方向。太陽與標語為新增斷言，未改寫既有斷言。

## 設計鐵律速查（本專案版，覆蓋 make-plan 預設）
- 視覺系統＝遊戲組 **Motu**：整合版內一律用遊戲組既有的 Tailwind `island-*` 色與 DesignKit 元件（`HintBubble`、`ModalOverlay`、`PortholeFrame`…）；我方 `app/` 內沿用 `--motu-*` token。make-plan 預設的 neutral/zinc 灰階**不適用**。
- 圖示：整合版用 `lucide-react`（遊戲組既有）；我方 `app/` 用 `app/ui/icons.js` 的本機 Lucide 字串，**`coins` 路徑換成遊戲組 lucide-react 0.546 版本**，兩邊方向一致。
- 文字只用深藍／深藍淡／深青（第一階段對比規則）；金、海洋青只當填色與圖示。
- 動效用遊戲組既有節奏（`motion/react`、`canvas-confetti`），全部尊重 `prefers-reduced-motion`。
- Motu 只有淺色，不做深色模式。不出現 emoji。

## 設計顧問輸入（ui-ux-pro-max）
- **沿用第一階段查詢結果**（2026-09-23，見 `TODO_PLAN_合體第一階段.md` 同名區塊），本次不重新查詢。理由：本次所有新元素（主角、阿肌、對話框、金幣、領獎動畫）都是**直接採用遊戲組現成元件**，UI Authority 第 1–3 順位（需求＋既有設計系統）已決定外觀，重新查詢只會產生不一致的建議。
- **沿用的採納項**：`no-emoji-icons`／`icon-style-consistent`；`color-contrast`；`color-not-only`（資源一律圖示＋數字）；`touch-target-size` ≥44px；`focus-states`；`duration-timing` 150–300ms（領獎序列的揭曉動畫例外，照遊戲組 `DailyClaimReveal` 約 0.9s 的節奏）。
- **本次補充（依需求與既有規範推導，非新查詢）**：
  - 訓練畫面背景「明亮活潑」：以遊戲組淺色系（奶油、薄荷、淺海洋青、淡金）做漸層＋柔和圖形，**相機畫面周圍保持低對比**，不與骨架判定色搶注意力；阿肌只放在相機畫面外側。
  - 「按任意鍵」：同時接受點擊、觸控、鍵盤；提示字用深藍淡、呼吸式透明度（減少動畫時固定不閃）。
  - 對話框報讀：主角台詞容器 `role="status" aria-live="polite"`，避免打斷語音教練。
- **駁回**：自動配色與字型推薦（遊戲組已定案）；新增圖示庫；深色模式。
> 下游的 run-slice 與 slice-builder 一律沿用本區塊，不得重新調用 ui-ux-pro-max。

## 進度總覽
- 總 Slice 數：13
- 已完成：12 / 13
- 平行組：P1 = {Slice 2, Slice 3}（兩者都只新增純函式檔與測試檔，檔案兩兩不相交、互不依賴）

---

### [x] Slice 1 — 建立整合版並刻出健身頁新畫面骨架
- **目標**：在遊戲組系統裡點「健身」就進到我方訓練頁，而且所有新元素的位置都先用寫死資料擺出來，讓使用者先看流程與版面。
- **範圍內**：
  - 複製 `Motu-島嶼健身-原始碼-最新版/` → `motu-app/`（排除 `node_modules`、`dist`），`.gitignore` 補 `motu-app/node_modules`、`motu-app/dist`、`motu-app/.env`；`npm install`
  - `vite.config.ts` 別名 `@fitness` → `../app`、`server.fs.allow`；`server.ts` 靜態掛載 `/vendor` → `../vendor`
  - `app/core/pose.js` 新增可注入資產根目錄（預設 `./vendor` 不變）
  - 新增 `src/components/fitness/FitnessHost.tsx`：掛載 `workout.js`、`setChrome` → `setIsWorkoutActive`、`navigate('island')` → 主頁；`App.tsx` 改掛 `FitnessHost`
  - 新增 `ctx.slots` 最小實作＋訓練頁插槽：初始頁「主角」「資源列」、訓練中「背景」「陪伴主角＋對話框」
  - 骨架佔位（**寫死資料**）：資源列（金幣 1,234／碎片 56，遊戲組圖示）、主角位置（灰色剪影框）、亮色背景色塊＋阿肌靜態 SVG、右上主角框＋一句寫死台詞的遊戲組對話框、數據列與控制鈕的新位置（使用者截圖標註的調整）、結束後三張可點擊的領獎佔位卡（金幣→經驗→碎片→「按下任意鍵以繼續」）→ 結算頁（金幣／經驗區塊先隱藏、左側新增欄位佔位）
- **範圍外**：真實存檔、真實主角與穿著、任何動畫（阿肌動作、飛入、彩帶、進場）、對話內容邏輯、發獎、減少動畫、效能、視覺細修。全部留給 Slice 2–13。
- **改動檔案**：`motu-app/**`（新增，複本）、`motu-app/vite.config.ts`、`motu-app/server.ts`、`motu-app/tsconfig.json`、`motu-app/package.json`、`motu-app/src/App.tsx`、`motu-app/src/components/UI/CoachSprite.tsx`（見不變量 5 申報）、`motu-app/src/components/fitness/FitnessHost.tsx`（新增）、`motu-app/src/components/fitness/fitnessStyles.ts`（新增）、`motu-app/src/components/fitness/skeleton/*.tsx`（新增，佔位）、`motu-app/scripts/test-fitness-shadow-css.ts`（新增）、`app/core/pose.js`、`app/features/workout/workout.js`（插槽節點與版面位置）、`app/features/workout/workout.css`、`.gitignore`、`tests/pose-assets.test.js`（新增）、`tests/workout-slots.test.js`（新增）
- **設計要點**：佔位用遊戲組 `island-*` 色與 DesignKit；版面照 `photo/修改照片.jpg` 標註調整；只做 `focus-visible`，不做其他動畫。
- **UI Slice?**：YES
- **驗收標準**：
  - [x] `cd motu-app && npm run dev` 後以訪客登入，點底部「健身」看到我方動作清單，可進入訓練（相機或示範模式）、全螢幕時遊戲端 HUD 隱藏、離開後恢復
  - [x] 上述每個新元素都有佔位且位置正確；結束後可依序點過三張領獎卡→按任意鍵→結算頁
  - [x] 我方舊版 `:8080` 照常運作（沒有 `ctx.game`／`ctx.slots` 時不出現佔位）
  - [x] console 0 error（兩個版本）
- **測試策略**：`tests/pose-assets.test.js`（新增）— 資產根目錄預設為 `./vendor`、注入 `/vendor` 時路徑正確、空字串邊界；`tests/workout-slots.test.js`（新增）— 無 `ctx.slots` 時不產生插槽節點、有時產生指定插槽；`motu-app/scripts/test-fitness-shadow-css.ts`（新增，`npm run test:fitness`）— Shadow DOM 樣式改寫（架構決策 7）。整合版 `npx tsc --noEmit` 通過。
- **完成定義**：`npm test` 全綠（≥462＋新增）＋`tsc --noEmit` PASS＋`vite build` PASS（動到建置設定）＋dev server 截圖；**回報後停下來，等使用者看過流程與版面才往下**。
- **對外介面**：
  - `app/features/workout/workout.js`：export `slotHtml(slots, name)`（無 slots 回 `''`）、`previewAwards(session) → [{kind:'coins'|'xp', amount}]`（骨架用，Slice 9 改走 `ctx.game.settle`）。
  - 訓練頁讀的 ctx 選配欄位：`ctx.slots.set(Record<名稱, HTMLElement>)`（每次重畫整批交出，卸載時交 `{}`）；`ctx.game.claim(awards) → Promise<void>`（有則結束時先領獎再進結算、結算頁隱藏獎勵區並顯示 `.wk-sum-more`）；`ctx.assetRoot`（MediaPipe 資產根目錄）。
  - 插槽名稱：`wallet`（選單頂端）、`hero`（今日推薦卡縮圖）、`backdrop`（訓練畫面底層）、`companion`（訓練畫面右上）。訓練畫面有插槽時 `.lv-wrap` 加 class `lv-fx`。
  - `app/core/pose.js`：export `poseAssetPaths(root = './vendor') → { wasm, model: { lite, full } }`；`createPose({ assetRoot })`。
  - `motu-app/src/components/fitness/FitnessHost.tsx`：export `FitnessHost`（App.tsx 在 `View.FITNESS` 掛載）；非全螢幕時右上關閉鍵回 `View.HOME`；`setChrome(v)` → `setIsWorkoutActive(!v)`。
  - `motu-app/src/components/fitness/fitnessStyles.ts`：export `toShadowCss(css) → { css, fontFaces }`、型別 `ShadowCss`。
  - `motu-app/src/components/fitness/skeleton/FitnessSkeleton.tsx`：`WalletSkeleton`、`HeroSkeleton`、`BackdropSkeleton`、`CompanionSkeleton`、`ClaimSkeleton({awards, onDone})`、型別 `ClaimAward {kind:'coins'|'xp'|'fragments'; amount}`（後續 Slice 逐一替換，全部換完刪檔）。
  - `motu-app/package.json`：script `test:fitness`（目前跑 `scripts/test-fitness-shadow-css.ts`，後續 Slice 的測試腳本串接在後）。
- **骨架確認回饋**：2026-09-26 使用者看過骨架後定案：數據列**留在底部**，但排在暫停／語音／靜音按鈕的**下方**（貼底），控制鈕移到數據列上方（原提案「數據列移到左側直排」作廢）。已改 `workout.css` 的 `.lv-fx` 規則，1440×900 與 390×844 實測量框：提示 → 控制鈕 → 數據列由上而下、互不重疊。
  同日追加：①底部四格字放大（電腦 38px／16px、手機約 27px／13px，`--lv-hud-h` 一個變數推算控制鈕與展示台位置）；②示範模式人物的圓形展示台收到控制鈕上方、下緣淡出，不再壓到四格；③骨架阿肌移到控制鈕上方，不和按鈕、四格重疊。實測量框全數通過。
- **審查紀錄**：2026-09-26 slice-reviewer 第 1 輪 BLOCK（pose.js 注入與其測試未做、.gitignore 未補、tsconfig／CoachSprite 未申報、Shadow DOM 決策未寫回看板；另兩項疑慮〔dist 未排除、領獎遮罩未壓暗〕經 `git check-ignore` 與實測 hit-test 查證為誤判，審查員自行撤回）→ 修正後第 2 輪 **PASS**。
- **施工備忘**：`npm ci` 的 prepare 腳本（`scripts/setup-hooks.mjs`）會把**本 repo** 的 `core.hooksPath` 設成 `scripts/hooks`（motu-app 沒有自己的 .git），已 `git config --local --unset core.hooksPath` 還原；之後在 motu-app 重裝套件要再檢查一次。已知留給後續：真實 4:3 相機在 1440 寬時兩側只剩約 120px，阿肌會被相機畫面蓋住一半（Slice 6）；手機寬度阿肌與底部數據列重疊（Slice 6／8）；領獎時背後訓練畫面的提示文字仍透出（Slice 10）；整合版 console 只剩遊戲組原有的 favicon.ico 404。
- **依賴**：無
- **平行組**：獨立

### [x] Slice 2 — 定義健身頁與遊戲端的資料契約
- **目標**：把「遊戲存檔 → 健身頁看得懂的數字」與「一次訓練 → 該領哪些獎勵」變成可測的純函式。
- **範圍內**：新增 `motu-app/src/components/fitness/gameContract.ts`：
  - `balancesFromProfile(profile)` → `{ coins, fragments, xp, level }`（用遊戲組 `getBalance`、`profileLevel`；profile 為空時全為 0）
  - `completionFromSession(session, userId)` → `WorkoutCompletion`（repCount＝**有效次數**、durationSeconds＝實際秒數、來源標為 AI 相機；示範模式／手動計數回傳 `null` 不發獎，依藍圖「只統計相機真人」）
  - `awardQueue({ payout, fragments })` → 依序 `[金幣, 經驗, 碎片]`，數量 0 的項目剔除；全空回傳 `[]`（0 下有效跳過領獎）
- **範圍外**：實際呼叫存檔、UI。
- **改動檔案**：`motu-app/src/components/fitness/gameContract.ts`（新增）、`motu-app/scripts/test-fitness-contract.ts`（新增）
- **設計要點**：N/A ｜ 純邏輯
- **UI Slice?**：NO
- **驗收標準**：
  - [x] 三個函式的型別與行為符合上述定義
  - [x] 示範模式、0 下有效、碎片 0、profile 為 null 皆有明確結果
- **測試策略**：`scripts/test-fitness-contract.ts` — 正常一輪、0 下、只有金幣、示範模式回 null、profile null、超過遊戲端單次上限（交由 `payoutForWorkout` 截斷）。
- **完成定義**：`npx tsx scripts/test-fitness-contract.ts` PASS＋`tsc --noEmit` PASS
- **對外介面**：
  - `motu-app/src/components/fitness/gameContract.ts`：
    - `balancesFromProfile(profile: UserProfile | null | undefined) → FitnessBalances`，型別 `FitnessBalances { coins; fragments; xp; level }`（profile 為空時全 0，含等級）
    - `completionFromSession(session: FitnessSession | null | undefined, userId: string) → WorkoutCompletion | null`；型別 `FitnessSession { id?; dateISO?; exercise; exerciseName?; durationSec; validReps; mode?: FitnessMode }`、`FitnessMode = 'camera'|'demo'|'manual'`。`mode` 不在我方 `commitSession()` 回傳值裡，**呼叫端要從 `live.mode` 補上**；只有 `mode==='camera'` 且有效次數 ≥1 才回傳事件，其餘（示範／手動／未標／0 下）一律 `null`＝不發獎、不播領獎。`workoutType` 用中文動作名（退回動作 id）；有 session id 時 `workoutId = 'fx-' + id`（重送可去重）。
    - `awardQueue({ payout: WorkoutPayout | null | undefined, fragments: number | null | undefined }) → Award[]`，型別 `Award { kind: AwardKind; amount }`、`AwardKind = 'coins'|'xp'|'fragments'`；順序金幣→經驗→碎片，非正數剔除、取整。金額由呼叫端先用遊戲端 `payoutForWorkout`、`fragmentsForWorkout` 算好再傳入。
  - `motu-app/package.json`：`test:fitness` 串接 `scripts/test-fitness-contract.ts`（`&&`）。
- **施工決策**：
  - `source` 固定 `'prototype'`（非字面「AI 相機」）：遊戲端 `WorkoutSource` 只有 prototype／external-api／admin-test，不變量 5 不允許改遊戲組型別；遊戲端發獎與驗證都不依 source 分流。Slice 9 呼叫 `reportWorkoutCompletion` 時不要自行換 source。
  - **0 下有效 → `completionFromSession` 回 `null`**（原草稿是照發依時間計算的金幣經驗）：REQUIREMENT 第 6 節第 7 條「0 下有效則跳過領獎直接進結算」；若照發，會變成錢入帳卻沒有領獎演出。
- **審查紀錄**：2026-09-27 slice-reviewer 第 1 輪 **PASS**（觸發條件：L 檔、新增 export 型別、改 `package.json`）。
- **依賴**：Slice 1
- **平行組**：P1

### [x] Slice 3 — 把我方動作資料轉成遊戲角色的關節旋轉
- **目標**：遊戲組主角可以用我方的深蹲、伏地挺身、開合跳、高抬腿動作來動。
- **範圍內**：新增 `motu-app/src/components/fitness/poseToRig.ts`：輸入我方 `makeSequence` 產生的 33 點 landmarks 一幀 → 輸出 `{ torso, head, leftArm, rightArm, leftLeg, rightLeg }` 的歐拉旋轉（對應遊戲組 `CharacterRig` 只吃旋轉的規則），含身體下沉量（torso 的 y 位移，給深蹲用）；關鍵點缺失時回傳站姿。
- **範圍外**：畫出角色、接進畫面。
- **改動檔案**：`motu-app/src/components/fitness/poseToRig.ts`（新增）、`motu-app/scripts/test-fitness-pose-to-rig.ts`（新增）
- **設計要點**：N/A ｜ 純邏輯
- **UI Slice?**：NO
- **驗收標準**：
  - [x] 站姿 → 四肢旋轉接近 0；深蹲最低點 → 大腿旋轉 > 60°、身體下沉；開合跳張開 → 雙臂外展 > 120°
  - [x] 缺點（visibility 低）時不產生 NaN
- **測試策略**：`scripts/test-fitness-pose-to-rig.ts` — 用 `app/core/synth.js` 產生四種動作的關鍵幀驗證角度範圍；NaN／缺點邊界案例。
- **完成定義**：測試 PASS＋`tsc --noEmit` PASS
- **對外介面**：
  - `motu-app/src/components/fitness/poseToRig.ts`：
    - `poseToRig(frame: PoseFrame | null | undefined, ref?: RigReference | null, prev?: RigPose | null) → RigPose`。**逐幀驅動角色時務必傳 `prev`（上一幀結果）**，四肢歐拉角才連續（同一方向有兩組解，不傳時合成開合跳在頂端會跳 169°，做插值平滑會甩手）。
    - `rigReference(standingFrame) → RigReference | null`：從一幀正面站姿量肢段比例（以雙肩距離為 1），側面或缺點回 `null`；不給 `ref` 時用 `DEFAULT_RIG_REFERENCE`（粗估、**未經真人驗證**，會低估往前抬）。Slice 7 應在訓練開始時先校正。
    - `standingRig() → RigPose`（全 0、`view:'none'`）。
    - 型別：`RigPose { torso; head; leftArm; rightArm; leftLeg; rightLeg: RigEuler; torsoDrop: number; view: 'front'|'side'|'none' }`、`RigEuler { x; y; z }`（弧度，three 預設 XYZ）、`PoseLandmark`、`PoseFrame`、`RigReference { torso; arm; thigh; shank }`、`RigView`。
    - 慣例（照遊戲組 `Avatar.tsx` 實際寫入）：四肢、軀幹、頭都是角色根節點下的平行節點，角度皆為絕對值；四肢下垂＝0、`x` 負＝往前抬、`z` 左負右正＝往外張；軀幹 `x` 正＝前傾、`z` 正＝往角色左側倒；頭只給左右歪頭 `z`。
    - `torsoDrop` 單位是「腿長」（0 站直～1），呼叫端乘角色腿長後從軀幹 `position.y` 扣掉；只在正面機位計算，**伏地挺身（側面）恆為 0**，要讓角色趴低需另外處理根節點（Slice 6／7）。
    - 側面機位（伏地挺身）輸出的是「漂在空中的平板」：軀幹前傾約 80°、雙腿往後、手臂朝下；角色整體要轉向與貼地由呼叫端處理。
    - 正面只能看到投影：往前抬的量靠投影縮短推算，一律假設「往前」（不會判成往後）。
  - `motu-app/package.json`：`test:fitness` 串接 `scripts/test-fitness-pose-to-rig.ts`。
- **施工決策**：
  - 驗收「站姿四肢接近 0」以中性站姿（`baseSkeleton`）驗；深蹲預備是寬站距（合成器踝距＝肩寬 1.85 倍），大腿本來就往外斜約 24°，另外驗「只往外、不往前」。
  - 新增選配參數 `prev`（原規格只有一幀輸入）：測試發現合成開合跳的歐拉解會在頂端換組，數值跳 169°。方向不受影響，但下游一做平滑就會甩手，故在本 Slice 解決。
  - 施工時 Circuit Breaker 共 2 次（上述 2 項測試紅燈；`synth.js` 的 JSDoc 使 `makeSequence` 被推成 `any[]`，測試端以明確型別接住，`app/core` 未改）。
- **審查紀錄**：2026-09-27 slice-reviewer 第 1 輪 **PASS**（觸發條件：L 檔、新增 export 型別、改 `package.json`、觸發過 Circuit Breaker）。
- **依賴**：Slice 1
- **平行組**：P1

### [x] Slice 4 — 健身初始頁換上島嶼主角並拿掉太陽與標語、換遊戲組金幣
- **目標**：初始頁的推薦卡角色變成使用者在島嶼上的主角（同一套穿著），做我方的示範動作。
- **範圍內**：
  - 新增 `FitnessCharacter.tsx`：R3F 畫布＋遊戲組 `CharacterModel`，穿著由 profile `equippedItems` 經 `resolveCharacterOutfit` 取得（profile 變動即重算＝與島嶼同步），關節由 Slice 3 `poseToRig` 驅動
  - 推薦卡插槽換成 `FitnessCharacter`（我方舊版維持藍色小人）
  - 拿掉今日推薦卡的太陽圖示；`app/ui/icons.js` 的 `coins` 路徑換成遊戲組 lucide-react 0.546 版本
  - 刪除動作清單標題下的標語「AI 即時判定動作品質 — 只有正確動作才換得到金幣」整行（2026-09-26 使用者追加，併入本 Slice；兩個版本都刪）
- **範圍外**：訓練中陪伴主角（Slice 7）、資源列（Slice 5）。
- **改動檔案**：`motu-app/src/components/fitness/FitnessCharacter.tsx`（新增）、`motu-app/src/components/fitness/FitnessHost.tsx`、`app/features/workout/workout.js`、`app/ui/icons.js`、`tests/icons.test.js`（新增案例）、`tests/workout-visual.test.js`（申報：太陽斷言）
- **設計要點**：角色置於推薦卡原 3D 位置，背景透明；WebGL 失敗時顯示遊戲組 `AvatarIcon` 替代。
- **UI Slice?**：YES
- **驗收標準**：
  - [x] 在島嶼更衣室換裝 → 切到健身頁，推薦卡主角穿著一致
  - [x] 推薦卡無太陽；金幣圖示與遊戲端 HUD 相同方向
  - [x] 動作清單標題下不再有「AI 即時判定動作品質…」標語
  - [x] 主角以我方動作循環播放；離開頁面 WebGL 資源釋放（無記憶體持續上升）
- **測試策略**：`tests/icons.test.js` — `coins` 路徑等於遊戲組版本；`tests/workout-visual.test.js` — 推薦卡不含 `sun`、選單模板不含該標語；整合版以 dev server 實機換裝驗證並截圖。
- **完成定義**：`npm test`＋`tsc --noEmit` PASS＋截圖
- **對外介面**：
  - `motu-app/src/components/fitness/FitnessCharacter.tsx`：export `FitnessCharacter({ exercise: string })`。穿著讀 `useApp().profile.equippedItems`（以 id 清單字串為 key，換裝即重算）；模型用 `useCharacterModel()`；動作 `demoPose` → `poseToRig`（含 `prev`）；WebGL 不支援或畫布內出錯 → 遊戲組 `AvatarIcon`（`profile.avatar`）。
  - **全頁共用單一 renderer**（模組層級 `createRoot`）：canvas 在各掛載點之間搬家，沒有掛載點時 `frameloop:'never'`，不銷毀。**Slice 7（訓練中陪伴主角）不要各自開 `<Canvas>`**：遊戲組角色零件是跨畫布共用的快取，每個卸載的 renderer 都會被快取的 dispose 監聽留住（實測每次卸載洩漏 1 個 WebGL context）；應沿用或擴充這個共用 root（目前一次只服務一個掛載點，尺寸跟最新掛載點）。
  - 畫布內元件接不到 AppContext（不在 App 的 React 樹裡），需要的資料由外層以 props 傳入。
  - `FitnessHost.tsx`：`hero` 插槽改掛 `FitnessCharacter`，動作 id 取自插槽所在 `.wk-rec[data-rec-id]`（預設 `squat`）。`HeroSkeleton` 仍給 `CompanionSkeleton` 使用。
  - `app/ui/icons.js`：`ICONS.coins` 改為 lucide-react 0.546 版（整合版與舊版一起生效）。
  - `app/features/workout/workout.js`：推薦卡徽章只剩「今日推薦」字；`renderMenu` 移除 `.wk-sub` 標語行。
- **施工決策**：
  - 不掛遊戲組 `Avatar`（島上操控器，讀鍵盤／playerBus／地形），只借模型層 `CharacterModel`＋`resolveCharacterOutfit`，與 Avatar.tsx 同一套穿著翻譯。角色轉 3/4 側面（正面看不出深蹲的大腿前抬）。
  - WebGL 支援偵測整頁只做一次、測完即 `loseContext`（原本每次掛載多開 1–2 個 context）。
  - `workout.css` 的 `.wk-sub .icon` 兩條規則已無對象，檔案不在本 Slice 改動清單，留著未刪（無副作用）。
- **UI QA 紀錄**（無頭 Chrome，整合版 :3000）：訪客用管理員測試模式「擁有全部商品」後，在背包穿上草帽＋海島襯衫，健身頁推薦卡主角同款並持續做深蹲；1440 與 390 寬截圖。進出健身頁 12 輪（含篩選鈕重畫選單）後存活的 WebGL2 context 固定 2 個（島嶼＋主角），heap 40 輪 112→117MB 後段持平（無主角對照組 20 輪 110→114MB，原本就有的緩升，來源不在本 Slice）。舊版 :8080 推薦卡仍是藍色小人、無太陽、無標語、console 0 error。整合版 console 只剩進健身頁前就出現的 2 個 404（遊戲端開場資源）與「Multiple instances of Three.js」警告（我方 `vendor/three` 與遊戲組 npm three 並存，Slice 1 起即有）。
  - 已知留給 Slice 12：390 寬時推薦卡只有 84px 寬，草帽帽簷左右被裁一點；深蹲時單節式的腿往前伸，縮圖看起來比較像「坐下」。
- **審查紀錄**：2026-09-27 slice-reviewer 第 1 輪 **PASS**（觸發條件：L 檔、新增 export 元件、觸發過 Circuit Breaker）。施工時 Circuit Breaker 1 次（實測發現每次卸載洩漏 1 個 WebGL context → 改為共用單一 renderer）。
- **依賴**：Slice 2、Slice 3
- **平行組**：獨立

### [x] Slice 5 — 健身頁新增金幣與碎片數量列並與島嶼同步
- **目標**：健身初始頁看得到跟島嶼一樣的金幣與碎片數字，任一邊變動另一邊立刻更新。
- **範圍內**：新增 `FitnessWallet.tsx`（遊戲組 `Coins` 金色、`Gem` 深青圖示＋數字，樣式同遊戲組 `CurrencyChips`），掛進資源列插槽，數字來自 `balancesFromProfile`；並提供 `ctx.game.balances()`／`subscribe()`，讓我方頁面內原本顯示金幣的地方改讀遊戲端數字。
- **範圍外**：領獎飛入動畫（Slice 10）。
- **改動檔案**：`motu-app/src/components/fitness/FitnessWallet.tsx`（新增）、`motu-app/src/components/fitness/FitnessHost.tsx`、`app/features/workout/workout.js`
- **設計要點**：數字用深藍、`aria-label="金幣 N"`；大數字用遊戲組 `shortNumber` 規則。
- **UI Slice?**：YES
- **驗收標準**：
  - [x] 健身頁數字＝島嶼 HUD 數字；在管理員面板調整金幣後健身頁即時更新
  - [x] 無 `ctx.game` 時（舊版）行為不變
- **測試策略**：`tests/workout-slots.test.js` 新增：有 `ctx.game` 時金幣顯示取自 `balances()`；整合版實機比對截圖。
- **完成定義**：`npm test`＋`tsc --noEmit` PASS＋截圖
- **對外介面**：
  - `motu-app/src/components/fitness/FitnessWallet.tsx`：
    - `FitnessWallet({ feed: BalanceFeed })`：資源列元件（`useSyncExternalStore` 訂閱），`role="group" aria-label="島嶼資源"`，金幣／碎片各自 `aria-label="金幣 N"`（完整數字）、畫面顯示 `shortNumber` 縮寫。
    - `createBalanceFeed(initial: FitnessBalances) → BalanceFeed`；型別 `BalanceFeed { balances(): FitnessBalances; subscribe(fn: BalanceListener): () => void; publish(next): void }`、`BalanceListener = (b: FitnessBalances) => void`。`publish` 四個數字都沒變就不通知、`balances()` 回同一物件；`subscribe` 不會立刻回呼（要現值讀 `balances()`），回傳取消訂閱函式。
    - `shortNumber(n)`：照抄遊戲組 TopBar（未 export、不可改）的縮寫規則。
  - 訓練頁可讀的 ctx 欄位（新增）：`ctx.game.balances() → { coins, fragments, xp, level }`、`ctx.game.subscribe(fn) → unsubscribe`。與資源列同一條訊息，來源＝`useApp().profile` 經 `balancesFromProfile`，profile 一換即發布。
  - `FitnessHost.tsx`：`wallet` 插槽改掛 `FitnessWallet`（`WalletSkeleton` 已無使用者，骨架檔統一在全部換完後刪）。
  - `motu-app/package.json`：`test:fitness` 串接 `scripts/test-fitness-wallet.ts`。
- **施工決策**：
  - **`app/features/workout/workout.js` 與 `tests/workout-slots.test.js` 未改動**（原列於改動檔案與測試策略）：查證後，整合版內我方頁面已沒有「顯示餘額」的地方 —— 初始頁餘額自 Slice 1 起就是純插槽；結算頁唯一讀 `s.wallet` 的區塊在有 `ctx.game` 時早已隱藏（Slice 1）。`ctx.game.balances／subscribe` 先開好介面，目前由資源列經同一條訊息消費，**workout.js 尚未呼叫**；第一個 app/ 端消費者（預計 Slice 9／11）要驗證這條路徑。測試改以 `scripts/test-fitness-wallet.ts`（20 條：縮寫邊界、訊息通知／去重／取消訂閱、畫面數字、profile 為 null）鎖住。
  - 數字依文字對比規則用深藍（遊戲組 TopBar 用金色字，這裡只讓圖示帶金／深青）。
  - Circuit Breaker 1 次：`renderToStaticMarkup` 測試要求 `useSyncExternalStore` 的第三個參數 `getServerSnapshot`，補上同一個 `balances`。
- **UI QA 紀錄**（無頭瀏覽器，整合版 :3000）：訪客初始健身頁 100／0＝島嶼 HUD；停在健身頁以管理員面板金幣 +10,000、碎片 +100 → 立即變「10.1K／100」，回島嶼 HUD 為 10,100／100。1440 與 390 寬截圖（`.playwright-mcp/slice5-*.png`，已被 .gitignore 排除）。console 只剩遊戲組原有 favicon.ico 404。舊版 `app/` 未改動，`npm test` 475/475。
- **審查紀錄**：2026-09-27 slice-reviewer 第 1 輪 **PASS**（觸發條件：L 檔、新增 export 型別／ctx 介面、改 `package.json`、觸發過 Circuit Breaker）。審查員建議把 workout.js 未改的落差寫進施工決策（已補）。
- **依賴**：Slice 4
- **平行組**：獨立

### [x] Slice 6 — 訓練畫面換成亮色背景並讓阿肌做健身動作
- **目標**：訓練中相機畫面周圍不再是單調深青，而是明亮背景＋教練阿肌輪流做深蹲、開合跳。
- **範圍內**：
  - `CoachSprite.tsx` 新增 `pose="squat"`、`pose="jack"` 兩個循環動作（沿用他既有的畫法規則：雙層描邊、各部位獨立節奏；既有 `idle`／`cheer` 不變）
  - 新增 `CoachBackdrop.tsx`：淺色漸層＋柔和圖形，阿肌在相機畫面外側輪播兩個動作；掛進背景插槽
- **範圍外**：減少動畫與效能降級（Slice 13）。
- **改動檔案**：`motu-app/src/components/UI/CoachSprite.tsx`、`motu-app/src/components/fitness/CoachBackdrop.tsx`（新增）、`motu-app/src/components/fitness/FitnessHost.tsx`、`app/features/workout/workout.css`（背景透出）
- **設計要點**：背景低對比、不遮相機；阿肌大小不超過畫面高度 35%。
- **UI Slice?**：YES
- **驗收標準**：
  - [x] 訓練中背景為亮色、阿肌依序做深蹲與開合跳，動作可辨識
  - [x] 新手引導的阿肌（`idle`／`cheer`）外觀不變
- **測試策略**：`scripts/test-fitness-coach-poses.ts` — 姿勢清單包含 squat／jack、未知姿勢退回 idle（純資料部分）；實機截圖比對新手引導未退步。
- **完成定義**：`tsc --noEmit` PASS＋測試 PASS＋截圖
- **對外介面**：
  - `motu-app/src/components/UI/CoachSprite.tsx`（遊戲組檔案，不變量 5 允許新增姿勢）：
    - `CoachSprite({ className?, pose?: CoachPose })`：`CoachPose = 'idle'|'cheer'|'squat'|'jack'`；不認得的姿勢退回 `idle`。
    - export `COACH_POSES`、`COACH_EXERCISE_POSES`（`['squat','jack']`）、型別 `CoachExercisePose`、`resolveCoachPose(p: unknown) → CoachPose`。
    - export `COACH_EXERCISES: Record<CoachExercisePose, CoachExercise>`（`frames`／`times`／`duration` 秒／`hop`）、型別 `CoachFrame`（`drop`、`knee`、`ankle`、`shoe`、`elbow`、`fist`，x 為離中線距離）、`COACH_SHOULDER`、`COACH_HIP`、`coachLimbPaths(frame, dir)`。深蹲一循環 2.2 秒、開合跳 1.3 秒。
  - `motu-app/src/components/fitness/CoachBackdrop.tsx`：
    - `CoachBackdrop()`（無 props）：掛在 `backdrop` 插槽；自行找同一個 `.lv-wrap` 裡的 `video`（讀 `videoWidth/Height`，沒有影像以 4:3 估算）與 `.lv-ctrls`（上緣當阿肌腳底上限），ResizeObserver＋video `loadedmetadata`／`resize` 重算。
    - export `coachPlacement(StageMetrics) → CoachPlacement { size, left, top, area:'side'|'below' }`、`COACH_MAX_HEIGHT_RATIO`（0.35）、`COACH_MIN_SIZE`（72）、`COACH_ROTATION`（深蹲 6.6 秒 → 開合跳 6.5 秒）、`nextRotationIndex(i)`。
  - `FitnessHost.tsx`：`backdrop` 插槽改掛 `CoachBackdrop`（`BackdropSkeleton` 已無使用者，骨架檔統一在全部換完後刪）。
  - `motu-app/package.json`：`test:fitness` 串接 `scripts/test-fitness-coach-poses.ts`。
- **施工決策**：
  - 健身姿勢不沿用 idle 的「繞 viewBox 支點旋轉」：蹲下時上半身要整體下移，旋轉支點寫死在 viewBox 座標上，身體一移就轉錯點。改成每個關鍵影格直接給關節座標、四肢以 `d` 補間，軀幹／頭／頭帶尾巴只平移；保留雙層描邊、頭帶、腕帶。
  - 為了共用軀幹、頭的畫法，把 idle 分支內聯的 JSX 原樣抽成常數（`defs`／`halo`／`tailsArt`／`torsoArt`／`headArt`／`sparkles`），idle／cheer 輸出以動工前原檔產生的基準 `scripts/fixtures/coach-sprite-baseline.json` 逐字比對（審查員另以 `git show HEAD` 版本獨立重產驗證基準確實來自原檔）。
  - 開合跳原本兩格內插時拳頭從臉前穿過（實機逐格截圖發現），加一格「雙手平舉」讓手臂畫弧，並加測試鎖住。
  - 阿肌位置依「相機實際比例＋畫面尺寸＋控制鈕位置」計算：寬螢幕站在相機左側空白、手機直式站在相機下方與控制鈕之間；擠不下時縮到 72px，被相機蓋住一部分也不會反過來遮到相機（背景層在相機之下）。
  - **`app/features/workout/workout.css` 未改動**（原列於改動檔案）：背景透出所需的 `.lv-fx #lv-video { background: transparent; }` 在 Slice 1 已加好，實機確認整個訓練畫面透出亮色背景。
- **UI QA 紀錄**（無頭瀏覽器，整合版 :3000，**無實體相機**，停在「啟動相機中…」狀態，阿肌位置以 4:3 估算）：1440×900 阿肌 88px 寬站在左側 120px 空白、腳底在控制鈕上方；390×844 阿肌 97px 在相機區下緣（568）之下、控制鈕上緣（688）之上（實測 top 574、底 674）。放大逐格截圖確認深蹲（屈膝外推、雙拳收胸前）與開合跳（平舉→過頭、腳打開）可辨識，輪播深蹲→開合跳→深蹲正常。以 `replay-newbie-tour` 重播新手引導，阿肌仍是原本的雙手二頭肌姿勢。console 只剩遊戲組原有 favicon.ico 404 與遊戲音效的 AudioContext 自動播放警告（自動化導覽無使用者手勢造成）。截圖 `.playwright-mcp/slice6-*.png`（已被 .gitignore 排除）。
  - 已知留給後續：真實相機下的位置尚未實機驗證（需有相機的電腦；16:9 相機時左右無空白，阿肌會縮到 72px 並被相機蓋住一部分）；手機寬度下教練提示字（`.lv-coach`，置中、最寬 80%）文字長時可能與左側阿肌重疊（Slice 8 的「互不重疊」範圍）；1440 寬時阿肌只有 88px（空白就這麼寬）。
- **審查紀錄**：2026-09-27 slice-reviewer 第 1 輪 **PASS**（觸發條件：L 檔、改遊戲組共用元件 `CoachSprite.tsx`、新增 export、改 `package.json`）。審查員建議回填對外介面（已補）。
- **依賴**：Slice 1
- **平行組**：獨立

### [x] Slice 7 — 訓練中加入跟著使用者動的主角與加油對話框
- **目標**：右上角的主角隨使用者計次做同一個動作，並用遊戲組對話框說鼓勵的話。
- **範圍內**：
  - 陪伴插槽掛 `FitnessCharacter`（mode＝sync：每收到 `rep` 事件播一次該動作循環；說話時改做加油動作）
  - 新增純函式 `cheerLine(event, state)`：開始、每 5 下、剩最後 3 下、達標、休息、動作失誤連續 3 次等情境各有台詞，同一句不連續重複
  - 對話框用遊戲組 `HintBubble`（名字小字＋內容＋箭頭），`role="status"`
  - `workout.js` 透過 `ctx.events` 發 `rep`／`phase`／`milestone`
- **範圍外**：語音（沿用我方語音教練）、動畫細修。
- **改動檔案**：`motu-app/src/components/fitness/CompanionCoach.tsx`（新增）、`motu-app/src/components/fitness/cheerLines.ts`（新增）、`motu-app/scripts/test-fitness-cheer.ts`（新增）、`motu-app/src/components/fitness/FitnessHost.tsx`、`app/features/workout/workout.js`；施工時追加（見施工決策）：`motu-app/src/components/fitness/FitnessCharacter.tsx`、`motu-app/package.json`、`tests/workout-slots.test.js`
- **設計要點**：主角與對話框不遮擋相機中央區域與骨架；台詞 ≤ 16 字。
- **UI Slice?**：YES
- **驗收標準**：
  - [x] 每計一下主角做一下；達標、休息時說對應台詞
  - [x] 事件只在 `ctx.events` 存在時發送，舊版不受影響
- **測試策略**：`scripts/test-fitness-cheer.ts` — 各情境台詞、不連續重複、未知事件回 null；`tests/workout-slots.test.js` — 計次時發出 `rep` 事件、次數正確。
- **完成定義**：`npm test`＋測試＋`tsc --noEmit` PASS＋截圖
- **對外介面**：
  - 訓練頁可發的 ctx 欄位（新增，選配）：`ctx.events.emit(type, payload)`。事件：
    - `phase`：`{ phase: 'ready'|'work'|'rest'|'end', exercise, setIdx, totalSets }`；`ready` 在 `startLive` 交出插槽的同一刻發（早於陪伴元件掛上），`work` 在每組開始（含第 1 組）、`rest` 進休息、`end` 在 `finishLive` 結算前。
    - `rep`：`{ valid, setValid, target, total }`，每計一下都發（含沒算到的 `valid:false`）；`setValid` 為本組有效次數。
    - `milestone`：`{ kind: 'last3'|'target', setIdx, totalSets }`，只在有效的那一下發；目標 ≤3 的組不發 `last3`。
  - `app/features/workout/workout.js`：export `emitLive(events, list) → 送出筆數`（沒有 `emit` 回 0）、`liveRepEvents(res, set) → 事件陣列`（純函式）。
  - `motu-app/src/components/fitness/cheerLines.ts`：`cheerLine(event: unknown, state?) → { line: string|null; state: CheerState }`（不說話或認不得回 `line:null`，狀態一律用回傳值）；`initialCheerState()`；型別 `CheerEvent`、`CheerState { lastLine; missStreak; turn }`、`CheerResult`、`CheerPhase`、`CheerMilestone`；常數 `CHEER_LINES`、`CHEER_MAX_CHARS`(16)、`MISS_STREAK_LIMIT`(3)、`PRAISE_EVERY`(5)。
  - `motu-app/src/components/fitness/CompanionCoach.tsx`：`CompanionCoach({ feed })`（掛 `companion` 插槽）；`createCompanionFeed() → CompanionFeed { emit; subscribe(fn) → unsubscribe; lastPhase() }`、型別 `CompanionEvent { type; payload }`、`CompanionListener`；常數 `LINE_MIN_MS`(1600)、`LINE_SHOW_MS`(3200)、`LINE_QUEUE`(2)。對話框名字＝`profile.displayName`（空則「島嶼主角」）。
  - `motu-app/src/components/fitness/FitnessCharacter.tsx`：props 擴充為 `FitnessCharacter({ exercise, mode?: 'loop'|'sync', reps?, cheering? })`、export 型別 `FitnessCharacterMode`。`sync`：`reps` 每加一做一下（1.0 秒，最多排隊 2 下），`cheering` 時雙手舉高揮動；仍共用同一個 renderer。
  - `FitnessHost.tsx`：`ctx.events` → 陪伴訊息；`companion` 插槽改掛 `CompanionCoach`（`CompanionSkeleton`／`HeroSkeleton` 已無使用者，骨架檔統一在全部換完後刪）。
  - `motu-app/package.json`：`test:fitness` 串接 `scripts/test-fitness-cheer.ts`。
- **施工決策**：
  - **追加改 `FitnessCharacter.tsx`**：Slice 4 對外介面要求陪伴主角沿用共用 renderer、不可自開 `<Canvas>`，因此 sync 模式只能加在這支檔案。`tests/workout-slots.test.js` 原本就在測試策略內；`package.json` 照 Slice 5／6 慣例串 script（保留 CRLF，整檔差異已還原）。
  - **主角只在「有效」的一下做動作**：沒算到的那一下仍發 `rep`（`valid:false`），供「連續失誤 3 次」台詞使用，但主角不跟做。驗收寫的「每計一下」＝畫面上的有效次數。
  - 大部分計次不說話，只有每 5 下、剩 3 下、達標、休息、組開始、結束、連續 3 下沒算到才開口，避免對話框一直閃、蓋過語音教練。台詞輪替、同句不連續。
  - 台詞最少停留 1.6 秒、最多排 2 句：實機發現第 12 下的「達標」與「休息」同一幀發生，原本後一句直接蓋掉前一句，改排隊後兩句依序出現。
  - 陪伴欄靠右對齊、箭頭自畫對準主角中線（樣式同 `HintBubble` 的 arrow）：原本置中對齊時，對話框出現／消失會讓主角左右跳；實測改後主角位置固定。
- **UI QA 紀錄**（無頭瀏覽器，整合版 :3000，無相機 → 以拒絕相機進示範模式）：深蹲一整場（3 組×12 下）逐 0.2 秒記錄：準備 →「第一下，穩穩來！」→ 第 5 下「5 下達成，繼續！」→ 第 9 下「最後 3 下，撐住！」→ 第 10 下 → 第 12 下「漂亮，這組完成！」→ 1.6 秒後「休息一下，深呼吸」→ 第 2 組「第 2 組開始，加油！」且次數從本組 0 起算 → 結束「全部完成，辛苦了！」（領獎遮罩下）。1440×900 與 390×844 截圖：主角與對話框在右上，不壓相機中央的示範人物；主角做深蹲。舊版 :8080 示範模式計次正常、0 個插槽、console 0 error。整合版 console 只剩遊戲組原有 favicon.ico 404。`vite build` PASS。截圖 `.playwright-mcp/slice7-*.png`（已被 .gitignore 排除）。
  - 已知留給後續：陪伴主角在 112×128 框裡只有約 40px 高，偏小（Slice 12）；伏地挺身時主角是漂在空中的平板（Slice 3 已知）；深蹲單節式腿看起來像坐下（Slice 4 已知）；真實相機下尚未實機驗證；減少動畫模式下的主角與加油動作（Slice 13）。
- **審查紀錄**：2026-09-27 slice-reviewer 第 1 輪 **PASS**（觸發條件：L 檔、新增 export／ctx 介面、改 `package.json`、改動檔案與 Slice 4 交集）。審查員建議把追加的改動檔案回填看板（已補）。
- **依賴**：Slice 4、Slice 6
- **平行組**：獨立

### [x] Slice 8 — 依骨架確認結果定案訓練畫面的數據列與控制鈕位置
- **目標**：把 Slice 1 使用者看過後確認的數據列、控制鈕、「找不到人」提示位置正式化（含 RWD）。使用者已定案：數據列在底部、位於控制鈕下方（見 Slice 1「骨架確認回饋」）；本 Slice 補齊各寬度細節與版位測試。
- **範圍內**：`workout.js`／`workout.css` 版面調整（電腦版與手機直式）、提示與控制鈕不重疊。
- **範圍外**：判定、計次邏輯。
- **改動檔案**：`app/features/workout/workout.js`、`app/features/workout/workout.css`、`tests/workout-layout.test.js`
- **設計要點**：按鈕 ≥44px；數據列不蓋住骨架腳部區域。
- **UI Slice?**：YES
- **驗收標準**：
  - [x] 1440／390 寬度下數據列、控制鈕、提示互不重疊，且不遮擋主角與阿肌
- **測試策略**：`tests/workout-layout.test.js` 新增新版位結構斷言；實機兩種寬度截圖。
- **完成定義**：`npm test` PASS＋截圖
- **對外介面**：
  - `app/features/workout/workout.js`：訓練畫面模板新增容器 `.lv-prompts`（依序包 `#lv-next`、`#lv-coach`，位在 `#lv-status` 之前）；兩個 id 與 `hud.next`／`setCoach` 接線不變，無新增 export。
  - `app/features/workout/workout.css`：舊版 `.lv-prompts { display: contents }`（位置照舊）；整合版 `.lv-fx .lv-prompts` 絕對定位在 `calc(var(--lv-ctrls-bottom) + 48px + 16px)`、直排堆疊（指引在上、提示在下），取代原本的 `.lv-fx .lv-coach { bottom }`。手機（≤620px）提示欄讓出左側 `16px + 30vw + 8px`（阿肌，依賴 `CoachBackdrop` 阿肌寬度上限 `W * 0.3`）與右側 64px（深度量表）；`.lv-fx .lv-gauge` 改由頂端 340px 起、軌道 `min(160px, 22vh)`。後續 Slice 若改阿肌寬度上限或陪伴主角高度，要同步這兩條（`tests/workout-layout.test.js` 已鎖住）。
- **施工決策**：
  - 修改前實測：1440 寬已無重疊；390 寬有兩處 —— 教練提示框蓋住阿肌右半邊、深度量表頂端壓到陪伴主角 10px。
  - 指引與提示原本各自 `absolute` 固定 bottom，提示折成 3～4 行時會頂到指引；改成同一欄 flex 堆疊，高度變化自動互推（「找不到人」同樣走 `#lv-coach`，一併涵蓋）。
  - 舊版以 `display: contents` 包裝，不改既有定位規則，:8080 實測提示仍距底 168px。
- **UI QA 紀錄**（無頭瀏覽器、無實體相機 → 示範模式，腳本 `.playwright-mcp/s8-after.js` 兩兩外框重疊檢查）：整合版 1440×900、390×844、768×1024、360×740 數據列／暫停／語音／提示／指引／量表／陪伴主角／阿肌 **0 組重疊**；控制鈕高 48px；數據列上緣（390：751）在展示台腳部下緣（676）之下。舊版 :8080 1440／390：0 個插槽、`.lv-prompts` 為 contents、提示距底 168px、console 0 error。整合版 console 只剩遊戲組原有 favicon.ico 404。截圖 `.playwright-mcp/slice8-{before,after,legacy}-*.png`（已被 .gitignore 排除）。新增 7 條測試，以改動前 CSS 回跑有 5 條紅（確認能抓退步）。
  - 已知留給後續：真實相機（尤其 16:9）下的位置尚未實機驗證。
- **審查紀錄**：2026-09-27 slice-reviewer 第 1 輪 **PASS**（觸發條件：L 檔）。觀察（不阻擋）：舊版 :8080 控制鈕與數據列間距偏擠，屬既有 base 規則、本 Slice 未動。
- **依賴**：Slice 7
- **平行組**：獨立

### [x] Slice 9 — 結束訓練改由遊戲端發放金幣、經驗與碎片
- **目標**：整合版結算的金幣、經驗、碎片真的寫進遊戲存檔，島嶼那邊立刻看得到。
- **範圍內**：`ctx.game.settle(summary)`：`completionFromSession` → `reportWorkoutCompletion`、`payoutForWorkout` 取得顯示值、`fragmentsForWorkout`＋`rollWorkoutFragmentItem`＋`grantFragments` 發碎片 → 回傳 `awardQueue`；`workout.js` 結束時若有 `ctx.game` 則呼叫它（我方 `commitSession` 仍記錄訓練統計，但整合版不再自行加金幣）。
- **範圍外**：領獎動畫（Slice 10）。
- **改動檔案**：`motu-app/src/components/fitness/FitnessHost.tsx`、`motu-app/src/components/fitness/useFitnessSettle.ts`（新增）、`app/features/workout/workout.js`、`app/state/store.js`（`commitSession` 新增「不發金幣」選項，預設行為不變）、`tests/session-rewards.test.js`（新增案例）；施工時追加（見施工決策）：`motu-app/scripts/test-fitness-contract.ts`（測試策略內）、`motu-app/src/components/fitness/skeleton/FitnessSkeleton.tsx`（一行）
- **設計要點**：N/A ｜ 資料流
- **UI Slice?**：NO
- **驗收標準**：
  - [x] 做完 10 下有效 → 島嶼 HUD 金幣、經驗增加量＝遊戲端公式；碎片進背包（⚠️ 存檔增加量＝公式；HUD 剛發完獎會暫時顯示雙倍、重整後正確 —— 遊戲組 `useWorkoutRewards.ts` 既有問題，見施工決策）
  - [x] 示範模式／0 下 → 不發獎、不報錯
  - [x] 重複觸發結束（連點）只發一次（遊戲端去重＋前端鎖）
  - [x] `npm run test:workout-rewards` 仍 61/61
- **測試策略**：`tests/session-rewards.test.js` — `commitSession({ grantCoins:false })` 不動錢包但記錄統計；`scripts/test-fitness-contract.ts` 補連點去重案例；實機驗證。
- **完成定義**：`npm test`＋整合版測試＋`tsc --noEmit` PASS
- **對外介面**：
  - 訓練頁讀的 ctx 欄位（新增）：`ctx.game.settle(session & { mode }) → Promise<Award[]>`。宿主以遊戲端發放金幣／經驗（`reportWorkoutCompletion`，顯示值＝`payoutForWorkout` 基礎值）與**商品碎片**（`grantFragments`，數量＝真的留在商品上的 `kept`，溢出換抽獎券的部分不演出），回傳 `awardQueue`；非相機、0 下有效、profile 未載入 → `[]`。同一 `workoutId`（`fx-` + session id）只結算一次，重複呼叫回同一個 Promise。
  - `motu-app/src/components/fitness/useFitnessSettle.ts`：`createFitnessSettle(deps: SettleDeps) → FitnessSettle`（純工廠，測試用）、`useFitnessSettle(profile, grantFragments) → FitnessSettle`（宿主用，一個生命週期一個，每次呼叫讀最新 profile）；型別 `SettleDeps { getProfile; report; grantFragments; random? }`、`FitnessSettle = (session) => Promise<Award[]>`。
  - `app/state/store.js`：`commitSession(result, opts?)`，`opts.grantCoins === false` 時不動錢包／XP／等級、不消耗雙倍卡旗標，照記 history／連續天數／成就；回傳 `coinsEarned`、`xpGain` 為 0。session 新增欄位 `walletGranted: boolean`（純追加）。只有明確 `false` 才停發。
  - `app/features/workout/workout.js`：export `claimRewards(game, session, mode) → Promise<Award[]>`（有 settle → settle 後把非空清單交給 claim；只有 claim → `previewAwards` 相容路徑；沒有 game → `[]`；失敗會丟出，`finishLive` 接住後照樣進結算頁）。`finishLive` 在有 `ctx.game.settle` 時以 `{ grantCoins: false }` 結算。
  - `FitnessHost.tsx`：`ctx.game.settle` 已接上。
  - `FitnessSkeleton.tsx`：`ClaimSkeleton` 改為只播傳入的清單（原本寫死補一張「+3 碎片」）。
- **施工決策**：
  - **兩種「碎片」**：遊戲端資源列顯示的是錢包碎片（`wallet.fragments`），遊戲規則規定**只能來自訓練以外**（`constants/currency.ts`）；訓練發的是商品碎片（`itemFragments`，集滿換商品），同遊戲組原型 `FitnessView`。本 Slice 照看板與遊戲端規則發商品碎片 → **Slice 10「飛入資源列」的碎片目的地要重新決定**（資源列的碎片數字不會因訓練增加）。
  - `grantFragments` 本身沒有去重（金幣經驗有 `processedIds`），所以前端以 `workoutId` 加鎖；`finishLive` 原本就有 `live.finished` 鎖。
  - 碎片發放失敗或 `ok:false` → 金幣經驗照發、碎片不進領獎清單（畫面不能說拿到了背包卻沒有）。
  - **追加改 `FitnessSkeleton.tsx` 一行**：骨架寫死補一張「+3 碎片」，settle 回傳真碎片後會多演一張假卡；Slice 10 會整個換掉骨架。
  - **遊戲組既有問題（未修，不變量 5 不可改）**：`useWorkoutRewards.ts` 寫入後對本機 profile 做樂觀疊加（`currencyPatch(live, …, getBalance(live) + coins)`），疊在可能已被存檔監聽更新過的 profile 上 → 發完獎島嶼 HUD 暫時顯示雙倍（實測存檔 110/64、HUD 120/LV2，重整後正確）。**不經過健身頁**直接呼叫 `reportWorkoutCompletion` 同樣重現，非本 Slice 造成。需轉給遊戲組修。
  - Circuit Breaker 1 次：新增的接線測試用 `indexOf('stopLive();')` 抓到「未開始就退出」那行而誤紅，改為從 `emitPhase('end'` 之後找，斷言強度不變。
  - **補記 Slice 8**：依 L 檔規則獨立 Slice 應跑 `vite build`，Slice 8 當時誤判為留待收尾；本 Slice 的 build（PASS）已涵蓋 Slice 8 的改動。
- **UI QA 紀錄**（無頭瀏覽器、無實體相機；存檔以遊戲端 firebase 層 `getDoc` 讀取）：
  - 真人計次路徑：Playwright 在網路層把送到瀏覽器的 `workout.js` 中 `live.mode = 'demo'` 改成 `'camera'`（原始碼未改），示範動作計次走完真實流程：10 下有效、連點結束 3 次 → 領獎卡 +10 金幣／+64 經驗／+6 碎片＝`payoutForWorkout(同一 completion)` {10, 64}；存檔金幣 100→110、經驗 0→64、`itemFragments` +6、`processedIds` 1 筆、`completedCount` 1；之後進結算頁；遊戲端新手獎勵（毛帽）照常跳出；console 0 error。腳本 `.playwright-mcp/s9-e2e.js`。
  - 示範模式（不改寫）：10 下後結束 → 沒有領獎卡、直接進結算頁、存檔不變、未送完成事件、console 0 error（`.playwright-mcp/s9-demo.js`）。
  - 已知留給後續：真實相機下未實機驗證；HUD 雙倍顯示待遊戲組修。
- **審查紀錄**：2026-09-27 slice-reviewer 第 1 輪 **PASS**（觸發條件：L 檔、新增 ctx 介面／export、改動檔案與其他 Slice 交集〔`workout.js`、`FitnessHost.tsx`〕、觸發過 Circuit Breaker）。審查員獨立讀 `useWorkoutRewards.ts` 佐證 HUD 雙倍為遊戲端既有問題；建議回填追加的改動檔案與記錄該問題（皆已補）。
- **依賴**：Slice 2、Slice 5
- **平行組**：獨立

### [x] Slice 10 — 做出逐項領獎動畫與飛入資源列
- **目標**：按結束後依序跳出金幣、經驗、碎片的揭曉動畫，每項按任意鍵後飛到頂端資源列，最後出現「按下任意鍵以繼續」。
- **範圍內**：新增 `ClaimSequence.tsx`（`ctx.game.claim`）：
  - 揭曉：參考遊戲組 `DailyClaimReveal`（旋轉登場、閃光、光環、彩帶、數字重擊）；經驗用遊戲組經驗條樣式、碎片用 `FragmentShard`
  - 飛入：參考 `DailyLoginPanel` 的飛幣，飛到頂端暫時滑入的資源列（金幣／經驗／碎片），抵達時數字滾動
  - 輸入閘：動畫落定後才接受下一次輸入；點擊、觸控、鍵盤皆可；最後顯示半透明「按下任意鍵以繼續」
  - 空佇列直接 resolve
- **範圍外**：減少動畫降級細節（Slice 13）。
- **改動檔案**：`motu-app/src/components/fitness/ClaimSequence.tsx`（新增）、`motu-app/src/components/fitness/claimMachine.ts`（新增，純狀態機）、`motu-app/scripts/test-fitness-claim.ts`（新增）、`motu-app/src/components/fitness/FitnessHost.tsx`、`app/features/workout/workout.js`；施工時追加（見施工決策）：`motu-app/package.json`（串 script）、刪除 `motu-app/src/components/fitness/skeleton/FitnessSkeleton.tsx`
- **設計要點**：遮罩用遊戲組 `ModalOverlay`；提示字深藍淡。
- **UI Slice?**：YES
- **驗收標準**：
  - [x] 三種獎勵依序出現、各自飛到正確欄位、數字跟著更新
  - [x] 動畫進行中連按不會跳過項目；最後按任意鍵進結算頁
  - [x] 只有金幣時只跳一次；0 下直接進結算
- **測試策略**：`scripts/test-fitness-claim.ts` — 狀態機：揭曉→可領→飛行→下一項→結尾；飛行中輸入被忽略；空佇列直接結束。實機錄影／截圖。
- **完成定義**：測試＋`tsc --noEmit` PASS＋截圖
- **對外介面**：
  - `motu-app/src/components/fitness/claimMachine.ts`（純函式）：`initialClaim(queue) → ClaimState`（空清單＝`done`）、`stepClaim(state, event, queue) → ClaimState`（不合法事件回傳同一參考）、`acceptsInput(state)`、`landedTotals(queue, landed)`、`claimBarValues(before, queue, landed) → { coins, xp, fragments }`、`claimBarKinds(queue) → AwardKind[]`；型別 `ClaimPhase = 'reveal'|'ready'|'flying'|'outro-in'|'outro'|'done'`、`ClaimState { phase; index; landed }`、`ClaimEvent = 'settled'|'input'|'landed'`。
  - `motu-app/src/components/fitness/ClaimSequence.tsx`：`ClaimSequence({ awards: Award[], before: { coins, xp }, onDone })`（`role="dialog"`、`z-reveal`、畫進 `.fx-overlay`）；常數 `CLAIM_SETTLE_MS`(900)、`CLAIM_READY_MS`(1300)、`FLIGHT_COUNT`(6)、`FLIGHT_LANDED_MS`(915)、`OUTRO_READY_MS`(500)。沿用遊戲組 index.css 的 `.daily-reveal-*`、`.daily-coin-fly`、`.daily-wallet-hit`（未改遊戲組檔案）。
  - `FitnessHost.tsx`：`ctx.game.claim(awards)` 改掛 `ClaimSequence`；`ctx.game.settle` 包一層，呼叫前記下 `balanceFeed.balances()` 當作領獎資源列起點（介面不變）。
  - `app/features/workout/workout.js`：`finishLive` 在有 `ctx.game` 時，領獎前把 `.lv-prompts`、`.lv-ctrls` 設為 `visibility:hidden`（結算頁重畫即消失）；無新增 export。
  - `motu-app/package.json`：`test:fitness` 串接 `scripts/test-fitness-claim.ts`。
  - 骨架檔 `skeleton/FitnessSkeleton.tsx` 已刪除（所有佔位元件皆已被取代，`ClaimAward` 型別改用 `gameContract` 的 `Award`）。
- **施工決策**：
  - **碎片的飛入目的地**（Slice 9 留下的決定）：領獎資源列是領獎專用的暫時列（不是初始頁的 `FitnessWallet`），第三欄為「商品碎片」（`FragmentShard` 圖示），數字只算**本次**拿到的（`+N`，從 0 起算）；不碰錢包碎片（`Gem`），遵守遊戲端「錢包碎片只來自訓練以外」的規則。資源列只列清單裡有的種類。
  - 金幣、經驗的起點＝發獎**前**的餘額＋已飛抵的獎勵，不讀發獎後的 profile，避開遊戲組 HUD 暫時雙倍的問題（Slice 9 施工決策），畫面數字剛好等於公式值。
  - `DailyClaimReveal` 綁死每日登入的獎勵型別與文案（「第 N 天登入獎勵」），不能直接掛；其 `BigCoin`／`BigMedallion` 未 export 且不變量 5 不可改，故在 `ClaimSequence.tsx` 照原畫法重畫一份，動畫全數沿用遊戲組 CSS。碎片用遊戲組 `FragmentShard`（`lit`）、經驗用青色徽章＋TopBar「經驗 XP」同款經驗條。
  - 「按任意鍵」提示放在白色膠囊上、字用深藍淡（設計要點；深色舞台上直接用深藍淡字看不見），呼吸閃爍沿用 `.daily-reveal-hint`。
  - 輸入閘：鍵盤忽略 `e.repeat`（按住不放不算連按）；點擊與觸控走同一個 `onClick`。
  - **實機發現、已修**：①背後訓練畫面的提示框與控制鈕透出遮罩，1440 寬時「站直站穩」與「按任意鍵領取」位置重疊（Slice 1 標記留給本 Slice）→ `workout.js` 領獎前隱藏；②飛行顆粒抵達後沒從 DOM 清掉（清除計時器被階段切換取消）→ 改在抵達那一刻一併清除。兩者皆非測試紅燈，未計入 Circuit Breaker。
  - 只有金幣一項的實機情境難以用示範動作湊出（10 下必有經驗與碎片），以狀態機與靜態輸出測試覆蓋。
- **UI QA 紀錄**（無頭瀏覽器、無實體相機；以網路層把示範模式標成相機，原始碼未改，腳本 `.playwright-mcp/s10-e2e.js`）：1440×900 與 390×844（觸控）各跑一輪 10 下有效：揭曉中連按空白 5 下不前進；落定（約 1.3 秒）後才出現「按任意鍵領取」；滑鼠點擊領第 1 項 → 6 枚金幣飛入頂端資源列，飛行中按 Enter／a 被忽略，抵達時金幣 100→110；第 2 項經驗 +64（LV 1、64/100 經驗條）；第 3 項商品碎片 +6（390 寬用觸控點擊領取）；「獎勵已全部入袋／按下任意鍵以繼續」→ 空白鍵 → 對話框消失、進結算頁。存檔 100/0/0 → 110/64/碎片 6＝`payoutForWorkout` {10, 64}。示範模式（不改寫，`s9-demo.js`）：不出現領獎、直接進結算、存檔不變。兩個寬度 console 0 error。截圖 `.playwright-mcp/slice10-{reveal,fly,xp,frag,outro}-{1440,390}.png`（已被 .gitignore 排除）。`vite build` PASS。
  - 已知留給後續：減少動畫模式下飛入改淡入、資源列不滑（Slice 13）；真實相機下未實機驗證。
- **審查紀錄**：2026-09-27 slice-reviewer 第 1 輪 **PASS**（觸發條件：L 檔、新增 export、改動檔案與其他 Slice 交集〔`FitnessHost.tsx`、`workout.js`〕、改 `package.json`）。觀察（不阻擋）：量測不到元素位置時該格不播飛行但流程照常推進；隱藏的提示／控制鈕由結算頁整段重畫移除。
- **依賴**：Slice 9
- **平行組**：獨立

### [x] Slice 11 — 結算頁拿掉金幣經驗並擴增左側表現數據
- **目標**：結算頁專心呈現「做得怎麼樣」，獎勵已在領獎序列領過。
- **範圍內**：`workout.js` 結算頁：整合版（有 `ctx.game`）移除金幣、經驗區塊與飛幣；左側達標率區擴增總時間、各組次數、最佳一組、錯誤類型分布（皆取自既有 summary）。舊版維持原結算頁。
- **範圍外**：判定。
- **改動檔案**：`app/features/workout/workout.js`、`app/features/workout/workout.css`、`tests/game-resource-card.test.js`（申報）、`tests/session-rewards.test.js`（新增案例）
- **設計要點**：沿用現有卡片樣式；數據用圖示＋數字。
- **UI Slice?**：YES
- **驗收標準**：
  - [x] 整合版結算頁無金幣、經驗；左側顯示四項新增數據且數值正確
  - [x] 舊版結算頁不變
- **測試策略**：模板函式測試：有／無 `game` 旗標兩種輸出；各組次數與最佳一組計算（含只做一組的邊界）。
- **完成定義**：`npm test` PASS＋截圖
- **對外介面**：
  - `app/features/workout/workout.js`（新增 export，純函式）：`setRepsOf(set) → number[]`（各組有效次數：休息開始時收進的組＋結束時仍在做的組；新組 0 下不列，除非整場只有這一組；`set` 為空回 `[]`）、`bestSetOf(setReps) → { idx, reps } | null`（最多者、同分取較早、全 0 為 null）、`sumMoreHtml(session, setReps = []) → string`（整合版結算左側四格：總時間／各組次數／最佳一組／失誤分布，失誤依次數排序、0 次不列、條長依最多者比例、數字必寫出）。
  - 組別狀態 `run.set` 新增欄位 `done: number[]`（模組內部；`emitPhase` 對外 payload 不變）。
  - `renderResult(ex, summary, session, setReps = [])`（模組內部，新增第 4 參數）。
  - CSS：`.wk-sum-more` 改三欄等分；新增 `.wk-sum-more-c.wide`、`.wk-sum-dist`（皆只在整合版出現）。無新 storage key、無路由變更。
- **施工決策**：
  - 引擎 `summary()` 沒有分組資料（不變量 1 不可改引擎）→ 改由訓練頁既有的組別狀態記錄：`enterRest` 時收進 `setEndValid - baseValid`。只記有效次數（組別狀態本來就只追蹤有效次數）。
  - 金幣／經驗區、彩帶、飛幣在 Slice 1／10 已對整合版關閉，本 Slice 補上真實數據並以測試鎖住該分支。
  - `tests/game-resource-card.test.js` 預先申報但**實際不需改動**（資源卡只在舊版分支渲染），未改寫任何既有斷言。
  - 實機發現：原本 `auto-fit` 格線在 1440 右側空一格、390 有一格落單 → 改三欄等分、失誤分布獨佔一列（非測試紅燈，未計入 Circuit Breaker）。
- **UI QA 紀錄**（無頭瀏覽器、網路層把示範標成相機，原始碼未改，腳本 `.playwright-mcp/s11-e2e.js`）：1440×900 與 390×844 各跑一輪：第 1 組 12 下 → 跳過休息 → 第 2 組 4 下結束 → 領獎 → 結算頁：無獎勵區；四格＝總時間 0:23／各組 12 / 4（共 2 組）／最佳 12 下（第 1 組）／失誤「動作半程未達標 4」，與上方「16 下有效、4 下沒算到」一致；無橫向捲動；console 0 error。截圖 `.playwright-mcp/slice11-{result,hero}-{1440,390}.png`。舊版結算頁由原始碼分支測試與既有 504 條測試覆蓋，未另跑 :8080 實機。`vite build` PASS。
- **審查紀錄**：2026-09-27 slice-reviewer 第 1 輪 **PASS**（觸發條件：L 檔、新增 export、改動檔案與其他 Slice 交集〔`workout.js`、`workout.css`〕）。觀察：`game-resource-card.test.js` 為過度申報、非違規。
- **依賴**：Slice 10
- **平行組**：獨立

### [x] Slice 12 — 打磨健身頁新元素的視覺
- **目標**：主角、阿肌背景、對話框、資源列、領獎畫面與遊戲端其他畫面看起來是同一個產品。
- **範圍內**：間距、陰影、字重、角色取景與光線、背景配色細修；1440／1920／390 截圖逐一比對遊戲端畫面。
- **範圍外**：動畫節奏（Slice 13）。
- **改動檔案**：`motu-app/src/components/fitness/*.tsx`、`app/features/workout/workout.css`；實際：`CompanionCoach.tsx`、`CoachBackdrop.tsx`、`FitnessCharacter.tsx`、`workout.css`，外加測試策略指定的 `tests/contrast.test.js`
- **設計要點**：依「設計顧問輸入」；對比組合納入 `tests/contrast.test.js`。
- **UI Slice?**：YES
- **驗收標準**：
  - [x] 三種寬度截圖無破版；新增文字／底色組合對比合格
- **測試策略**：`tests/contrast.test.js` 新增組合；截圖。
- **完成定義**：`npm test`＋`tsc --noEmit` PASS＋截圖
- **對外介面**：
  - 無新 export、無新 storage key、無路由變更。
  - `FitnessCharacter`：畫布尺寸改以掛載點的版面尺寸（`clientWidth`／`clientHeight`）為準，不再含祖先 transform —— 之後把主角放進有 `scale()` 的容器也會填滿框（props 不變）。
  - `CompanionCoach`：主角框 `lg`（≥1024px）起由 112×128 放大為 144×160；對話框箭頭同步移到 `lg:right-[66px]`。下游（Slice 13 效能降級）若要縮主角畫布解析度，框尺寸以此為準。
  - CSS：`.fx-slot-wallet` 在 ≥1100px 取消 72px 右側讓位。
  - `tests/contrast.test.js` 新增 ⑥ 區：`islandColor(name)`／`classColor(cls, under)`（測試檔內部）；整合版新增文字／底色組合時要加進 `FX_PAIRS`。
- **施工決策**：
  - 改前截圖比對出的問題（`.playwright-mcp/s12-before-*`）：①資源列在 1440／1920 右緣比內容欄內縮 72px（為關閉鍵讓位，但寬螢幕欄外已放得下）→ ≥1100px 對齊內容欄；②陪伴主角在 1920 只有阿肌的一半高 → `lg` 放大一級；③主角與阿肌站在淺色背景上沒有落地感 → 各加一圈淡陰影（`rgba(38,70,83,.2)` 徑向漸層）。
  - 對話框直角、資源列數字用深藍而非遊戲組 TopBar 的金字：前者與遊戲端 `HintBubble` 一致（島嶼主頁的互動提示同樣是直角），後者依本專案文字對比規則（金在白底 < 4.5），皆維持不改。
  - **追加改 `FitnessCharacter.tsx`**（審查第 1 輪 BLOCK 後找到的根因）：`fit()` 原用 `getBoundingClientRect()`，含手機版陪伴主角容器的 `scale(.85)` → 畫布只填框的 85%、貼左上，主角偏上偏左、陰影對不準。改用 `clientWidth/clientHeight`。修後實測（隱藏陰影找最低深色像素）四種寬度腳底皆在框高 80–81%、陰影中心差 ≤1.7px、主角水平偏 1px。
  - Circuit Breaker 1 次（審查 BLOCK：陰影與腳底懸空）。
  - 截圖腳本遇到遊戲端新手引導視窗延遲跳出擋住點擊（間歇、與本 Slice 無關），腳本改為點掉視窗再進健身頁。
- **UI QA 紀錄**（無頭瀏覽器、無相機、網路層把示範標成相機，原始碼未改；腳本 `.playwright-mcp/s12-shots.js`）：1440×900、1920×1080、390×844 各拍島嶼主頁／健身初始頁／訓練中（含對話框）／領獎揭曉／領獎資源列／結算頁，改前 `s12-before-*`、改後 `s12-after-*`；三種寬度無橫向捲動、console 0 error。陪伴主角局部量測 `s12-fix-companion-{1920,1440,768,390}.png`。`vite build` PASS。
  - 已知留給後續：真實相機下未實機驗證；動畫節奏與減少動畫（Slice 13）。
- **審查紀錄**：2026-09-27 slice-reviewer 第 1 輪 **BLOCK**（陪伴主角陰影與腳底懸空，三種寬度重現）→ 修正 `FitnessCharacter.tsx` 量測方式＋陰影位置 → 第 2 輪 **PASS**（觸發條件：L 檔、改動檔案與其他 Slice 交集〔`workout.css`、`CompanionCoach.tsx`〕、觸發過 Circuit Breaker）。審查員確認 `FitnessCharacter.tsx`、`CompanionCoach.tsx`、`CoachBackdrop.tsx` 皆為本專案新增檔，不受不變量 5 限制；對比測試非湊數。
- **依賴**：Slice 11
- **平行組**：獨立

### [ ] Slice 13 — 補齊微互動、減少動畫模式與效能底線
- **目標**：動畫順、會尊重「減少動畫」偏好，而且訓練中不拖慢骨架辨識。
- **範圍內**：資源列滑入／收起、對話框進出場、`prefers-reduced-motion` 下停阿肌循環與彩帶、飛入改淡入；訓練中量測 fps，低於 24 時先暫停阿肌動畫、再降主角畫布解析度。
- **範圍外**：新功能。
- **改動檔案**：`motu-app/src/components/fitness/*.tsx`、`motu-app/src/components/fitness/perfGuard.ts`（新增）、`motu-app/scripts/test-fitness-perf.ts`（新增）
- **設計要點**：150–300ms；按壓 `scale(.98)`。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 減少動畫開啟時無循環動畫；筆電訓練中 ≥ 24fps（實測數字寫回看板）
- **測試策略**：`scripts/test-fitness-perf.ts` — 降級決策純函式（fps 門檻、遲滯避免來回切換）。
- **完成定義**：測試＋`tsc --noEmit` PASS＋實測 fps
- **對外介面**：
- **依賴**：Slice 12
- **平行組**：獨立

---

## 收尾總驗證（全部 Slice 完成後）
- 我方 `npm test`、整合版 `tsc --noEmit`＋`vite build`＋`test:workout-rewards`＋`test:fitness`
- 補做前一份看板（第二階段前段）的 Final Validation
- 批次審未觸發即時審查的 Slice（本檔位為逐 Slice 審，預期無剩餘）
- 驗收標準 REQUIREMENT 第 7 節逐條實機驗證＋企劃書用截圖
