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
- 已完成：2 / 13
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

### [ ] Slice 3 — 把我方動作資料轉成遊戲角色的關節旋轉
- **目標**：遊戲組主角可以用我方的深蹲、伏地挺身、開合跳、高抬腿動作來動。
- **範圍內**：新增 `motu-app/src/components/fitness/poseToRig.ts`：輸入我方 `makeSequence` 產生的 33 點 landmarks 一幀 → 輸出 `{ torso, head, leftArm, rightArm, leftLeg, rightLeg }` 的歐拉旋轉（對應遊戲組 `CharacterRig` 只吃旋轉的規則），含身體下沉量（torso 的 y 位移，給深蹲用）；關鍵點缺失時回傳站姿。
- **範圍外**：畫出角色、接進畫面。
- **改動檔案**：`motu-app/src/components/fitness/poseToRig.ts`（新增）、`motu-app/scripts/test-fitness-pose-to-rig.ts`（新增）
- **設計要點**：N/A ｜ 純邏輯
- **UI Slice?**：NO
- **驗收標準**：
  - [ ] 站姿 → 四肢旋轉接近 0；深蹲最低點 → 大腿旋轉 > 60°、身體下沉；開合跳張開 → 雙臂外展 > 120°
  - [ ] 缺點（visibility 低）時不產生 NaN
- **測試策略**：`scripts/test-fitness-pose-to-rig.ts` — 用 `app/core/synth.js` 產生四種動作的關鍵幀驗證角度範圍；NaN／缺點邊界案例。
- **完成定義**：測試 PASS＋`tsc --noEmit` PASS
- **對外介面**：
- **依賴**：Slice 1
- **平行組**：P1

### [ ] Slice 4 — 健身初始頁換上島嶼主角並拿掉太陽與標語、換遊戲組金幣
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
  - [ ] 在島嶼更衣室換裝 → 切到健身頁，推薦卡主角穿著一致
  - [ ] 推薦卡無太陽；金幣圖示與遊戲端 HUD 相同方向
  - [ ] 動作清單標題下不再有「AI 即時判定動作品質…」標語
  - [ ] 主角以我方動作循環播放；離開頁面 WebGL 資源釋放（無記憶體持續上升）
- **測試策略**：`tests/icons.test.js` — `coins` 路徑等於遊戲組版本；`tests/workout-visual.test.js` — 推薦卡不含 `sun`、選單模板不含該標語；整合版以 dev server 實機換裝驗證並截圖。
- **完成定義**：`npm test`＋`tsc --noEmit` PASS＋截圖
- **對外介面**：
- **依賴**：Slice 2、Slice 3
- **平行組**：獨立

### [ ] Slice 5 — 健身頁新增金幣與碎片數量列並與島嶼同步
- **目標**：健身初始頁看得到跟島嶼一樣的金幣與碎片數字，任一邊變動另一邊立刻更新。
- **範圍內**：新增 `FitnessWallet.tsx`（遊戲組 `Coins` 金色、`Gem` 深青圖示＋數字，樣式同遊戲組 `CurrencyChips`），掛進資源列插槽，數字來自 `balancesFromProfile`；並提供 `ctx.game.balances()`／`subscribe()`，讓我方頁面內原本顯示金幣的地方改讀遊戲端數字。
- **範圍外**：領獎飛入動畫（Slice 10）。
- **改動檔案**：`motu-app/src/components/fitness/FitnessWallet.tsx`（新增）、`motu-app/src/components/fitness/FitnessHost.tsx`、`app/features/workout/workout.js`
- **設計要點**：數字用深藍、`aria-label="金幣 N"`；大數字用遊戲組 `shortNumber` 規則。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 健身頁數字＝島嶼 HUD 數字；在管理員面板調整金幣後健身頁即時更新
  - [ ] 無 `ctx.game` 時（舊版）行為不變
- **測試策略**：`tests/workout-slots.test.js` 新增：有 `ctx.game` 時金幣顯示取自 `balances()`；整合版實機比對截圖。
- **完成定義**：`npm test`＋`tsc --noEmit` PASS＋截圖
- **對外介面**：
- **依賴**：Slice 4
- **平行組**：獨立

### [ ] Slice 6 — 訓練畫面換成亮色背景並讓阿肌做健身動作
- **目標**：訓練中相機畫面周圍不再是單調深青，而是明亮背景＋教練阿肌輪流做深蹲、開合跳。
- **範圍內**：
  - `CoachSprite.tsx` 新增 `pose="squat"`、`pose="jack"` 兩個循環動作（沿用他既有的畫法規則：雙層描邊、各部位獨立節奏；既有 `idle`／`cheer` 不變）
  - 新增 `CoachBackdrop.tsx`：淺色漸層＋柔和圖形，阿肌在相機畫面外側輪播兩個動作；掛進背景插槽
- **範圍外**：減少動畫與效能降級（Slice 13）。
- **改動檔案**：`motu-app/src/components/UI/CoachSprite.tsx`、`motu-app/src/components/fitness/CoachBackdrop.tsx`（新增）、`motu-app/src/components/fitness/FitnessHost.tsx`、`app/features/workout/workout.css`（背景透出）
- **設計要點**：背景低對比、不遮相機；阿肌大小不超過畫面高度 35%。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 訓練中背景為亮色、阿肌依序做深蹲與開合跳，動作可辨識
  - [ ] 新手引導的阿肌（`idle`／`cheer`）外觀不變
- **測試策略**：`scripts/test-fitness-coach-poses.ts` — 姿勢清單包含 squat／jack、未知姿勢退回 idle（純資料部分）；實機截圖比對新手引導未退步。
- **完成定義**：`tsc --noEmit` PASS＋測試 PASS＋截圖
- **對外介面**：
- **依賴**：Slice 1
- **平行組**：獨立

### [ ] Slice 7 — 訓練中加入跟著使用者動的主角與加油對話框
- **目標**：右上角的主角隨使用者計次做同一個動作，並用遊戲組對話框說鼓勵的話。
- **範圍內**：
  - 陪伴插槽掛 `FitnessCharacter`（mode＝sync：每收到 `rep` 事件播一次該動作循環；說話時改做加油動作）
  - 新增純函式 `cheerLine(event, state)`：開始、每 5 下、剩最後 3 下、達標、休息、動作失誤連續 3 次等情境各有台詞，同一句不連續重複
  - 對話框用遊戲組 `HintBubble`（名字小字＋內容＋箭頭），`role="status"`
  - `workout.js` 透過 `ctx.events` 發 `rep`／`phase`／`milestone`
- **範圍外**：語音（沿用我方語音教練）、動畫細修。
- **改動檔案**：`motu-app/src/components/fitness/CompanionCoach.tsx`（新增）、`motu-app/src/components/fitness/cheerLines.ts`（新增）、`motu-app/scripts/test-fitness-cheer.ts`（新增）、`motu-app/src/components/fitness/FitnessHost.tsx`、`app/features/workout/workout.js`
- **設計要點**：主角與對話框不遮擋相機中央區域與骨架；台詞 ≤ 16 字。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 每計一下主角做一下；達標、休息時說對應台詞
  - [ ] 事件只在 `ctx.events` 存在時發送，舊版不受影響
- **測試策略**：`scripts/test-fitness-cheer.ts` — 各情境台詞、不連續重複、未知事件回 null；`tests/workout-slots.test.js` — 計次時發出 `rep` 事件、次數正確。
- **完成定義**：`npm test`＋測試＋`tsc --noEmit` PASS＋截圖
- **對外介面**：
- **依賴**：Slice 4、Slice 6
- **平行組**：獨立

### [ ] Slice 8 — 依骨架確認結果定案訓練畫面的數據列與控制鈕位置
- **目標**：把 Slice 1 使用者看過後確認的數據列、控制鈕、「找不到人」提示位置正式化（含 RWD）。使用者已定案：數據列在底部、位於控制鈕下方（見 Slice 1「骨架確認回饋」）；本 Slice 補齊各寬度細節與版位測試。
- **範圍內**：`workout.js`／`workout.css` 版面調整（電腦版與手機直式）、提示與控制鈕不重疊。
- **範圍外**：判定、計次邏輯。
- **改動檔案**：`app/features/workout/workout.js`、`app/features/workout/workout.css`、`tests/workout-layout.test.js`
- **設計要點**：按鈕 ≥44px；數據列不蓋住骨架腳部區域。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 1440／390 寬度下數據列、控制鈕、提示互不重疊，且不遮擋主角與阿肌
- **測試策略**：`tests/workout-layout.test.js` 新增新版位結構斷言；實機兩種寬度截圖。
- **完成定義**：`npm test` PASS＋截圖
- **對外介面**：
- **依賴**：Slice 7
- **平行組**：獨立

### [ ] Slice 9 — 結束訓練改由遊戲端發放金幣、經驗與碎片
- **目標**：整合版結算的金幣、經驗、碎片真的寫進遊戲存檔，島嶼那邊立刻看得到。
- **範圍內**：`ctx.game.settle(summary)`：`completionFromSession` → `reportWorkoutCompletion`、`payoutForWorkout` 取得顯示值、`fragmentsForWorkout`＋`rollWorkoutFragmentItem`＋`grantFragments` 發碎片 → 回傳 `awardQueue`；`workout.js` 結束時若有 `ctx.game` 則呼叫它（我方 `commitSession` 仍記錄訓練統計，但整合版不再自行加金幣）。
- **範圍外**：領獎動畫（Slice 10）。
- **改動檔案**：`motu-app/src/components/fitness/FitnessHost.tsx`、`motu-app/src/components/fitness/useFitnessSettle.ts`（新增）、`app/features/workout/workout.js`、`app/state/store.js`（`commitSession` 新增「不發金幣」選項，預設行為不變）、`tests/session-rewards.test.js`（新增案例）
- **設計要點**：N/A ｜ 資料流
- **UI Slice?**：NO
- **驗收標準**：
  - [ ] 做完 10 下有效 → 島嶼 HUD 金幣、經驗增加量＝遊戲端公式；碎片進背包
  - [ ] 示範模式／0 下 → 不發獎、不報錯
  - [ ] 重複觸發結束（連點）只發一次（遊戲端去重＋前端鎖）
  - [ ] `npm run test:workout-rewards` 仍 61/61
- **測試策略**：`tests/session-rewards.test.js` — `commitSession({ grantCoins:false })` 不動錢包但記錄統計；`scripts/test-fitness-contract.ts` 補連點去重案例；實機驗證。
- **完成定義**：`npm test`＋整合版測試＋`tsc --noEmit` PASS
- **對外介面**：
- **依賴**：Slice 2、Slice 5
- **平行組**：獨立

### [ ] Slice 10 — 做出逐項領獎動畫與飛入資源列
- **目標**：按結束後依序跳出金幣、經驗、碎片的揭曉動畫，每項按任意鍵後飛到頂端資源列，最後出現「按下任意鍵以繼續」。
- **範圍內**：新增 `ClaimSequence.tsx`（`ctx.game.claim`）：
  - 揭曉：參考遊戲組 `DailyClaimReveal`（旋轉登場、閃光、光環、彩帶、數字重擊）；經驗用遊戲組經驗條樣式、碎片用 `FragmentShard`
  - 飛入：參考 `DailyLoginPanel` 的飛幣，飛到頂端暫時滑入的資源列（金幣／經驗／碎片），抵達時數字滾動
  - 輸入閘：動畫落定後才接受下一次輸入；點擊、觸控、鍵盤皆可；最後顯示半透明「按下任意鍵以繼續」
  - 空佇列直接 resolve
- **範圍外**：減少動畫降級細節（Slice 13）。
- **改動檔案**：`motu-app/src/components/fitness/ClaimSequence.tsx`（新增）、`motu-app/src/components/fitness/claimMachine.ts`（新增，純狀態機）、`motu-app/scripts/test-fitness-claim.ts`（新增）、`motu-app/src/components/fitness/FitnessHost.tsx`、`app/features/workout/workout.js`
- **設計要點**：遮罩用遊戲組 `ModalOverlay`；提示字深藍淡。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 三種獎勵依序出現、各自飛到正確欄位、數字跟著更新
  - [ ] 動畫進行中連按不會跳過項目；最後按任意鍵進結算頁
  - [ ] 只有金幣時只跳一次；0 下直接進結算
- **測試策略**：`scripts/test-fitness-claim.ts` — 狀態機：揭曉→可領→飛行→下一項→結尾；飛行中輸入被忽略；空佇列直接結束。實機錄影／截圖。
- **完成定義**：測試＋`tsc --noEmit` PASS＋截圖
- **對外介面**：
- **依賴**：Slice 9
- **平行組**：獨立

### [ ] Slice 11 — 結算頁拿掉金幣經驗並擴增左側表現數據
- **目標**：結算頁專心呈現「做得怎麼樣」，獎勵已在領獎序列領過。
- **範圍內**：`workout.js` 結算頁：整合版（有 `ctx.game`）移除金幣、經驗區塊與飛幣；左側達標率區擴增總時間、各組次數、最佳一組、錯誤類型分布（皆取自既有 summary）。舊版維持原結算頁。
- **範圍外**：判定。
- **改動檔案**：`app/features/workout/workout.js`、`app/features/workout/workout.css`、`tests/game-resource-card.test.js`（申報）、`tests/session-rewards.test.js`（新增案例）
- **設計要點**：沿用現有卡片樣式；數據用圖示＋數字。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 整合版結算頁無金幣、經驗；左側顯示四項新增數據且數值正確
  - [ ] 舊版結算頁不變
- **測試策略**：模板函式測試：有／無 `game` 旗標兩種輸出；各組次數與最佳一組計算（含只做一組的邊界）。
- **完成定義**：`npm test` PASS＋截圖
- **對外介面**：
- **依賴**：Slice 10
- **平行組**：獨立

### [ ] Slice 12 — 打磨健身頁新元素的視覺
- **目標**：主角、阿肌背景、對話框、資源列、領獎畫面與遊戲端其他畫面看起來是同一個產品。
- **範圍內**：間距、陰影、字重、角色取景與光線、背景配色細修；1440／1920／390 截圖逐一比對遊戲端畫面。
- **範圍外**：動畫節奏（Slice 13）。
- **改動檔案**：`motu-app/src/components/fitness/*.tsx`、`app/features/workout/workout.css`
- **設計要點**：依「設計顧問輸入」；對比組合納入 `tests/contrast.test.js`。
- **UI Slice?**：YES
- **驗收標準**：
  - [ ] 三種寬度截圖無破版；新增文字／底色組合對比合格
- **測試策略**：`tests/contrast.test.js` 新增組合；截圖。
- **完成定義**：`npm test`＋`tsc --noEmit` PASS＋截圖
- **對外介面**：
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
