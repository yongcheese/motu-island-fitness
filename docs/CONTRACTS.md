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

`app/main.js` 的 `FEATURES` 註冊表接受符合下列形狀的物件：

```ts
{
  id: string;                          // 對應 TABS 的 id
  label: string;                       // 分頁列顯示文字
  icon: string;                        // 分頁列圖示（emoji）
  mount(root: HTMLElement, ctx): void;  // 掛載；root 為 #view
  unmount(): void;                      // 卸載；須清乾淨 timer／事件／WebGL 資源
  onShow?(): void;                      // 每次切換到本頁時呼叫（mount 之後）
  needsTopbar?: boolean;
}
```

生命週期（`main.js:82-90`）：切頁時先呼叫前一個模組的 `unmount()`，
再 `setChrome(true)`、`mount(view, ctx)`、`onShow?.()`。

### `ctx` 提供的內容（`main.js:34-47`）
| 欄位 | 說明 |
|---|---|
| `ctx.store` | 上述 store，**唯一**的狀態來源 |
| `ctx.coach` | 語音教練（`say(text, priority)` / `stop()`） |
| `ctx.navigate(id)` | 切換到指定分頁 |
| `ctx.toast(msg)` | 顯示 2.2 秒的提示 |
| `ctx.setChrome(visible)` | 隱藏／顯示 topbar 與 tabbar（全螢幕沉浸用） |

### 五個現有分頁
| id | label | icon |
|---|---|---|
| `today` | 今日 | ☀️ |
| `island` | 島嶼 | 🏝️ |
| `workout` | 訓練 | 🏋️ |
| `tracking` | 健康 | 📊 |
| `settings` | 設定 | ⚙️ |

遊戲端要替換的是 **`island`** 這一個。

---

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