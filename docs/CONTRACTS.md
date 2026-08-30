# TOOL CONTRACTS — Gate 4

模組間公開介面（由 Gate 3 測試凍結）。任何 feature/UI agent 只能依賴這些介面。

## 1. 資料型別
```ts
type Landmark = { x:number; y:number; z:number; visibility:number }; // 正規化 [0,1]，y 下為正
type Frame = Landmark[];        // 長度 33（附錄 A 索引）
type Color = 'red'|'yellow'|'green';
type Phase = 'IDLE'|'READY'|'CONCENTRIC'|'TARGET'|'ECCENTRIC';
type Scale = { shoulderWidth:number; hipWidth:number; torsoLength:number; legLength:number; center:{x,y} };
```

## 2. core/geometry.js（pure）
- `angle(a,b,c): number` — ∠ABC，單位度數 [0,180]。
- `distance(a,b): number`
- `midpoint(a,b): {x,y}`
- `vAngleFromVertical(top,bottom): number` — 線段相對「鉛直線」的傾角（0=直立、90=水平）。

## 3. core/normalize.js（pure）
- `bodyScale(frame): Scale` — 比例尺；缺點時以可得點估算。

## 3b. core/framing.js（pure）— 取景品質判定
判定「看不看得到人」的單一事實來源，engine 逐幀判定與 UI 取景關卡共用同一份，避免兩邊門檻不一致。
關鍵：除了 `visibility`，還要求座標**真的落在畫面內**——MediaPipe 對出框的點會外插座標並仍給出
不低的 visibility，只看可見度會讓「人太近、頭已出框」照樣通過判定。
- `inFrame(p, tol?): boolean` — 座標是否在畫面內（tol 預設 0.02）
- `landmarkOk(p, visMin?, tol?): boolean` — 可信 **且** 在框內
- `bodyBox(frame, opts?): { n,w,h,span,top,bottom }` — 以可信且在框內的核心點量外框；
  `span = max(w,h)`，故站姿看高度、伏地挺身（水平姿勢）看寬度都適用
- `framingReport(frame, { gateLandmarks, visMin?, requireHead?, needsHeadroom? }): FramingReport`
  判定順序：頭部 → **核心身體點出框**（與 spec 的 gate 無關）→ gate 點出框 → gate 點看不清
  → 跨幅過大/過小 → 上下緣留白。「核心身體點出框」不可省略：`bodyBox` 會把出框的點排除，
  少了這道，「身體有一部分在畫面外」會被算成「一個比較小、取景良好的人」而放行。
```ts
FramingReport {
  ok:boolean;
  issue:null|'no_pose'|'no_head'|'too_close'|'missing'|'turned_away'
       |'too_far'|'no_headroom'|'no_footroom';
  // turned_away = 缺件全在同一側 ⇒ 側身站（自己擋住自己）。
  // 指引方向必須跟成因對應：這時說「把鏡頭放低或後退」沒用，要說「請正對鏡頭」。
  parts:string[];    // 出問題的人話部位，如 ['膝蓋']
  text:string;       // 給使用者看的具體指引
  span:number;
}
```
- `createStabilityTracker(opts?): { push(frame), reset(), size }` — 以「肩寬／軀幹長」在滾動視窗內的
  變異係數判斷軀幹尺度是否已穩定；供取景關卡做到「等抓準軀幹再開始辨識」。

## 4. core/exercises/*  與 index.js
- `EXERCISES: Record<id, ExerciseSpec>`，id ∈ squat|jumpingjack|highknees|pushup|...
- `ExerciseSpec`:
```ts
{
  id, name, group, met:number, baseCoinPerRep:number, intensity:number,
  mode:'cyclic'|'alternating',
  requiredLandmarks:number[],            // evaluate() 計算會用到的點
  gateLandmarks?:number[],               // 入鏡判定只看這些核心點；未指定則退回 requiredLandmarks
                                         //   注意：末端點（手腕/腳踝）若動作中必然出框，不得放進來
  gatePairs?:number[][],                 // 成對左右關節，每對「至少一側」可信即可。
                                         //   側面拍攝（伏地挺身）遠側肢體必被身體擋住，
                                         //   要求兩側全看得見會整場停擺。列在這裡的索引
                                         //   不再被 gateLandmarks 逐點硬性檢查。
  requireHead?:boolean,                  // 預設 true。逐幀是否要求看得到頭；伏地挺身設 false
                                         //   （下壓到底臉朝地，鼻/耳可見度會掉）
  needsHeadroom?:boolean,                // 彈跳類動作（開合跳/高抬腿）：開始前的取景關卡要求
                                         //   上緣留白（非逐幀條件）。門檻 0.18 畫面高，
                                         //   實測可容忍騰空 0.15 而零中斷。
  thresholds:{ attemptEnter:number; targetEnter:number; readyReturn:number },
  evaluate(frame:Frame, scale:Scale): {
    progress:number;                     // cyclic 用，0..1
    progressL?:number; progressR?:number;// alternating 用
    side?:'L'|'R';
    gatePass:boolean;                    // 達標品質 gate（如髖低於膝）
    faults:string[];                     // 本幀違規（如 'torso_lean','sag'）
    segments:Record<string,Color>;       // 各身體段顏色（torso/leftArm/...）
  },
  faultSeverity:Record<string,'block'|'warn'>,  // block=判無效
  cues?:Record<string,{text:string;priority:'high'|'mid'|'low'}>,
  phaseCues?:Record<'READY'|'CONCENTRIC'|'TARGET'|'ECCENTRIC', string>,
                                         // 「現在該做什麼」的即時字卡（快節奏動作靠語音來不及）
  meta:{ desc, target, sets, repsPerSet, restSec, difficulty, tempo?:'fast' }
                                         // tempo:'fast' → 抑制閒聊型語音，改以短音效＋字卡回饋
}
```

## 5. core/engine.js
- `createDetector(spec, opts?) : Detector`
- `Detector.update(frame:Frame, tMs:number): FrameResult`
```ts
FrameResult {
  phase:Phase; color:Color; segments:Record<string,Color>;
  visible:boolean; signal:number;
  repCountedThisFrame:boolean; repValidThisFrame:boolean;
  faults:string[];
  cue:{ key:string; text:string; priority:'high'|'mid'|'low' } | null;
  repReason:string|null;                 // 這一下被判無效的原因（僅在計次事件當幀有值）
  framing:FramingReport;                 // 本幀取景判定（見 §3b），UI 據此顯示具體原因
  reps:{ valid:number; invalid:number };
}
```
- 取景遲滯（`opts.framingWindow`=12 / `opts.framingBadNeed`=3）：**滾動視窗合格率**，不是連續計數。
  連續計數會被抖動繞過（壞幀只要不連續就永遠不停，實測 50% 壞幀仍全程照常計次）。
  未達門檻時「凍結」——不中止進行中的那一下，也不拿壞座標評估。
- 掉幀容忍（`opts.abortAfterMs`，預設 500）：`visible:false` 當幀即回報，但週期 abort 延後到
  持續看不到人超過這個時間才執行（跳躍最高點的短暫掉幀不該讓整下報銷）。
  **此值必須大於視窗排空時間**（`framingWindow` 幀 ≈ 400ms @30fps），否則形同虛設。
- **UI 顯示拒絕原因必須用 `repReason`，不可讀 `faults`**：一下是在「回到起始位置」時才結算，
  瞬間發生的錯誤（如最深處彎腰）那時已經消失，讀當幀會退回顯示「半程未達標」而告知錯誤的原因。
  `repReason` 取值序：block 級 fault → `no_alternation` → `unseen` → 首個 fault → `form`。
  未達標時：**若同時累積了 block 級 fault，回報那個 fault 而不是 `half_rep`** ——
  那個錯誤正是做不到底的原因（用彎腰代替下蹲的人被告知「再往下蹲」只會彎得更厲害）。
- `unseen`：這一下進行中有幀沒被判定到（取景壞掉而凍結）。**一律不給有效** ——
  那些幀裡可能正好是姿勢跑掉的瞬間，沒看到就不該給過。
- `Detector.summary(): { validReps, invalidReps, attempts, targetRate, faultCounts }`
- `Detector.reset()`

## 6. core/rewards.js（pure）
> 原 `core/calories.js`。熱量估算（`estimateCalories`）已於 2026-08-25 移除——該數字由 METs 公式推算、
> 未納入個體代謝差異，屬本系統無法驗證的量。對外量化一律改用可精確判定的項目。

- `grade({ targetRate, validRate }): 'S'|'A'|'B'|'C'`
- `coinsFor({ validReps, baseCoinPerRep, targetRate, streakDays }): number`
- `shardsFor({ validReps }): number` — 本次獲得碎片數（非餘額）
- `ticketsFor({ validReps, targetRate }): number` — 本次獲得抽獎券數（非餘額）
- 常數：`SHARD_PER_VALID_REPS`、`TICKET_MIN_VALID_REPS`、`TICKET_MIN_TARGET_RATE`
  ⚠️ 三者為**暫定值**，發放規則尚待與遊戲組議定（見《現狀盤點》E-7）。議定後只需改這三個常數。

## 7. core/pose.js（browser only）
- `createPose({ modelUrl, wasmDir, numPoses=1, delegate }) : Promise<Pose>`
- `Pose.detect(videoEl, tMs): Frame|null`
- `Pose.close()`

## 8. state/store.js（single source of truth）

### 讀取
| 方法 | 回傳 | 說明 |
|---|---|---|
| `store.getState()` | State | 整份狀態（唯讀取用，勿直接改寫） |
| `store.subscribe(fn)` | `()=>void` | 任何狀態變更時呼叫 `fn(state)`；回傳解除訂閱函式 |
| `store.isBoostArmed()` | boolean | 下一次結算是否將套用雙倍金幣卡 |
| `store.derived.xpProgress()` | `{cur, need, ratio}` | 當前等級的經驗值進度 |
| `store.derived.levelFromXp(xp)` / `xpForLevel(lv)` | number | 等級與經驗值換算 |

### 寫入
| 方法 | 回傳 | 說明 |
|---|---|---|
| `store.commitSession(result)` | Session | **唯一**能增加金幣／XP／history 的入口 |
| `store.consumeBoost()` | boolean | 宣告使用一張雙倍金幣卡。**零參數**；true=已設起，false=已有一張生效中（不疊加） |
| `store.spendCoins(n)` | boolean | 扣款；餘額不足回 false |
| `store.placeBuilding(b)` / `moveBuilding(id,x,y)` / `removeBuilding(id)` / `unlock(type)` | — | 島嶼建物 |
| `store.updateProfile(p)` / `updatePrefs(p)` | — | 個人資料／偏好設定 |
| `store.exportJSON()` / `importJSON(json)` / `reset()` | — | 存檔管理 |

### `commitSession(result)` 的回傳（遊戲端依賴的對外契約）
```ts
{
  id, dateISO, date, exercise, exerciseName,   // 識別
  durationSec, validReps, invalidReps, targetRate, coinsEarned, grade, faults,  // 既有 12 欄
  xpGain,             // 本次經驗值增量
  shards, tickets,    // 本次獲得量 —— 非餘額
  coinBoostApplied,   // 本次是否套用雙倍卡
}
```
⚠️ **前 12 個欄位為凍結契約**，名稱、型別、語意不得更動。新增一律純追加。

### wallet 只有三個欄位
`{ coins, xp, level }`。**碎片與抽獎券不在其中**——由遊戲端記帳，健身端只在結算畫面顯示。

### 常數（export）
`STREAK_MIN_VALID_REPS`（連續天數的當日有效次數門檻）、`COIN_BOOST_MULTIPLIER`（雙倍卡倍率）、`ACHIEVEMENTS`

## 9. ui/feedback.js（browser）
- `drawSkeleton(ctx, frame, segments, opts)` — 依 segments 上色畫骨架。
- `drawCountdownRing(ctx, ratio, opts)` — 倒數邊框。

## 10. feature 模組契約（遊戲端接入點）

> ⚠️ 2026-08-29 更正：本節前一版依 `main.js` 的註解撰寫，把 `label`、`icon`、`needsTopbar`
> 列為契約的一部分。經查 `main.js` 的實際消費方式（`show()`，第 100–109 行），
> **這三個欄位從未被讀取**。分頁列的文字與圖示來自 `main.js` 內獨立的 `TABS` 常數。
> 依實際行為更正如下，並已同步修正 `main.js` 的註解。

### 模組必須提供

```js
// 採 default export
export default {
  mount(root, ctx) { /* 掛載到 root（即 #view）*/ },   // 必要
  unmount() { /* 清乾淨 timer／事件／WebGL 資源 */ },   // 必要
  onShow() { /* 每次切到本頁時呼叫，在 mount 之後 */ }, // 選用
};
```

| 成員 | 必要性 | 簽名 | 說明 |
|---|---|---|---|
| `mount` | **必要** | `(root: HTMLElement, ctx: Ctx) => void` | `root` 為 `#view`。拋錯會被 catch 並顯示「模組載入失敗」訊息，不會白畫面 |
| `unmount` | **必要** | `() => void` | 切離本頁時呼叫。**務必釋放 WebGL context 與 rAF**，否則切回來會累積 |
| `onShow` | 選用 | `() => void` | `mount` 之後呼叫；用 `?.()` 呼叫，未提供不會出錯 |

### 模組**不需要**提供
`label`、`icon`、`needsTopbar` —— 這些不會被讀取。分頁列由 `main.js` 的 `TABS` 常數決定；
若要改島嶼分頁的名稱或圖示，請改 `TABS`，不是模組。

### 生命週期（`main.js:100-109`）
```
切頁 → prev.unmount()（若有，包在 try/catch）
     → setChrome(true)
     → feat.mount(#view, ctx)（包在 try/catch，失敗顯示錯誤訊息）
     → feat.onShow?.()
```

### `ctx` 提供的內容（`main.js:52-65`）
| 欄位 | 型別 | 說明 |
|---|---|---|
| `ctx.store` | Store 或受限介面 | 上述 store，**唯一**的狀態來源。⚠️ **島嶼分頁例外**，見下方「島嶼插槽的受限介面」 |
| `ctx.coach` | Coach | 語音教練：`say(text, priority)`、`stop()` |
| `ctx.navigate(id)` | `(string) => void` | 切換到指定分頁 |
| `ctx.toast(msg)` | `(string) => void` | 顯示 2.2 秒提示 |
| `ctx.setChrome(visible)` | `(boolean) => void` | 隱藏／顯示 topbar 與 tabbar（全螢幕沉浸用） |

#### 島嶼插槽的受限介面（Slice 8，2026-08-30）

島嶼分頁是本系統**唯一開放替換**的插槽（遊戲組模組將掛載於此，見 `features/island/registry.js`）。
該插槽的 `ctx.store` **不是完整 store**，而是 `state/island-facade.js` 產生的白名單介面。

| | 內容 |
|---|---|
| **可用** | `getState`、`subscribe`、`spendCoins`、`consumeBoost`、`isBoostArmed`、`placeBuilding`、`moveBuilding`、`removeBuilding`、`unlock`、`derived`（唯讀複本） |
| **不可用** | `commitSession`（唯一的金幣與經驗值產出入口）、`importJSON`（可整包覆寫含 wallet）、`reset`、`exportJSON`、`updateProfile`、`updatePrefs` |

實作要點：
- **白名單而非黑名單** —— 名單外的方法在介面上**根本不存在**（不是丟錯）。
  故 `typeof ctx.store.commitSession === 'function'` 為 `false`，模組不會誤以為可用。
- 介面經 `Object.freeze`，掛載的模組無法自行補上被擋掉的方法。
- 其餘四個分頁（today／workout／tracking／settings）仍取得完整 store ——
  `workout` 需要 `commitSession`，`settings` 需要匯入匯出與重設。

⚠️ **界線（對外描述不得放大）**：純前端網頁擋不了 DevTools、直接修改 localStorage、
或使用者自行注入腳本。本介面防的是**合作模組的誤用與越權**，**不是惡意使用者**。
對外只能說「在正常應用流程與模組權限邊界內成立」。

⚠️ 白名單的擴充規則：遊戲組若需更多權限，逐項評估後加入 `ISLAND_ALLOWED`；
但 `ISLAND_DENIED` 上的方法**永遠不得加入** —— 它們是「金幣唯一來源為訓練結算」這條承諾的守門本身。
`tests/island-facade.test.js` 有一條靜態核對：我方 island 模組若用到白名單外的方法會立刻紅燈。

### 五個現有分頁
`today`（今日 ☀️）、`island`（島嶼 🏝️）、`workout`（訓練 🏋️）、`tracking`（健康 📊）、`settings`（設定 ⚙️）

遊戲端要替換的是 **`island`**。切換方式見 `main.js` 的 `ISLAND_SOURCE` 常數。

### CSS 與資產如何隨模組切換
本專案**無打包步驟**，故：
- **CSS**：模組自行在 `mount()` 內以 `<link>` 或 `<style>` 注入，並於 `unmount()` 移除。
  全域樣式變數見 `app/styles/lumina.css`（`--green`／`--coral`／`--gold` 等語意色票）。
- **靜態資產**（模型、貼圖、音效）：放在 `vendor/` 或自建目錄，以相對路徑引用。
  ⚠️ 不得使用 CDN —— 本作品需離線可用，這是企劃書已對外的承諾。
- **three.js**：不要自帶。改為 `import * as THREE from '<相對路徑>/vendor/three/three.module.min.js'`，
  與我方共用同一份（r161），避免兩份 three 同時載入。

---

## 10b. State schema

```js
{
  schema: 1,
  profile: { nickname, avatar, height_cm, weight_kg, age, sex },
  prefs:   { voice, bgm, difficulty, mirror, colorMode, dailyGoalMin, weeklyGoalDays, warmup },
  wallet:  { coins, xp, level },              // 只有這三個欄位
  island:  { placed: Building[], unlocked: string[] },
  streak:  { current, lastActiveDate, longest },
  boost:   { coinNext: boolean },             // 雙倍卡的一次性旗標
  history: Session[],                          // 每次結算一筆，見第 8 節
  achievements: string[],
}

// Building
{ id: string, type: string, x: number, y: number, rot: number }
```

⚠️ **遊戲端的資料請放在自己的 namespace**，不要往上述子樹塞欄位——
`importJSON()` 為淺層合併，結構衝突會很難查。

### 寫入 API 的輸入與失敗語意
| 方法 | 輸入 | 回傳 | 失敗時 |
|---|---|---|---|
| `spendCoins(n)` | `n > 0` 的有限數 | `boolean` | 餘額不足或 `n` 非法 → 回 `false`，**狀態完全不變** |
| `consumeBoost()` | 無 | `boolean` | 已有一張生效中 → 回 `false`，**不疊加、不扣任何東西** |
| `placeBuilding(b)` | `{ type, x, y, rot }` | — | 不驗證重疊或範圍（由呼叫端負責）；`id` 由 store 產生 |
| `moveBuilding(id, x, y)` | 既有 id | — | id 不存在 → **靜默 no-op** |
| `removeBuilding(id)` | 既有 id | — | id 不存在 → 靜默 no-op |
| `unlock(type)` | string | — | 已解鎖過 → no-op（不重複加入） |
| `updatePrefs(p)` / `updateProfile(p)` | 部分欄位物件 | — | 淺層合併，未提供的欄位保留 |
| `importJSON(json)` | JSON 字串 | `boolean` | 解析失敗 → 回 `false`，狀態不變 |

⚠️ `getState()` 回傳的是**可變參考**，請勿直接改寫其內容——所有變更都應經由上述方法，
否則不會觸發 `subscribe` 通知，畫面不會更新。

## 11. 遊戲端不可做的事

以下每一條都對應企劃書中已對外承諾的內容，違反即等於該承諾失效。

| 禁止 | 理由 |
|---|---|
| **不得自行保存金幣副本** | 兩端共用同一份 store。另存副本會產生兩個真實來源，同步一旦落差就無法判斷哪個是對的 |
| **不得繞過 `commitSession()` 增加金幣或經驗值** | 企劃書第四章：「介面中不存在增加金幣之方法」。這是「金幣僅由 AI 驗證產生」在架構層面的實現——非依約定，而是以介面設計使違規成為不可能 |
| **不得讓碎片或抽獎券回流成金幣或經驗值** | 08/21 兩組議定的底線。一旦可回流，核心資源就有了第二條產出管道 |
| **不得扣減經驗值** | 雙方議定經驗值只增不減。最高稀有度商品以「達等級門檻解鎖並直接獲得」，不扣經驗值、不另付金幣 |
| **不得指定雙倍卡的倍率** | `consumeBoost()` 為零參數，倍率寫死於健身端。若由呼叫端指定，等於開了「說幾倍就幾倍」的加值路徑 |
| **不得在主畫面常駐顯示碎片與抽獎券** | 議定僅於結算畫面與遊戲端提示中顯示 |

### 經濟面的約束（給遊戲端定價時參考）
功能卡的售價**必須高於一次結算的金幣增量**，否則會形成「買卡 → 賺更多金幣 → 再買卡」的自我增殖迴圈。

---

## 12. 技術環境

| 項目 | 我方現況 |
|---|---|
| 模組系統 | 原生 ES Modules，**無打包步驟**（無 webpack／vite） |
| three.js | **r161**，本地 vendor 引入（`vendor/three/three.module.min.js`），非 CDN |
| 執行方式 | `python3 serve.py 8080`，開瀏覽器即可 |
| 後端 | **無**。全部在瀏覽器內執行，不需伺服器 |
| 持久化 | `localStorage`，單一 key |

⚠️ 遊戲端若使用不同的 three.js 版本，合併後會有兩份 three 同時載入。**版本必須對齊 r161。**

---

## Gate 4 結論