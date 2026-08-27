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

## 6. core/calories.js（pure）
- `estimateCalories({ met, weightKg, durationSec, targetRate }): number`
- `grade({ targetRate, validRate }): 'S'|'A'|'B'|'C'`
- `coinsFor({ validReps, baseCoinPerRep, targetRate, streakBonus? }): number`

## 7. core/pose.js（browser only）
- `createPose({ modelUrl, wasmDir, numPoses=1, delegate }) : Promise<Pose>`
- `Pose.detect(videoEl, tMs): Frame|null`
- `Pose.close()`

## 8. state/store.js（single source of truth）
- `store.getState()`, `store.subscribe(fn)→unsub`
- `store.commitSession(sessionResult)` — **唯一**能加金幣/XP/history 的入口（防刷）。
- `store.spendCoins(n)→bool`、`store.placeBuilding(b)`、`store.removeBuilding(id)`
- `store.updateProfile(p)`、`store.updatePrefs(p)`
- `store.exportJSON()`、`store.importJSON()`、`store.reset()`
- 事件名：`change`（任何狀態變更）。

## 9. ui/feedback.js（browser）
- `drawSkeleton(ctx, frame, segments, opts)` — 依 segments 上色畫骨架。
- `drawCountdownRing(ctx, ratio, opts)` — 倒數邊框。

## Gate 4 結論
契約與測試一致、職責單一、防刷由 `commitSession` 把關。PASS，進入 Gate 5。
