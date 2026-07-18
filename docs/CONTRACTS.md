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

## 4. core/exercises/*  與 index.js
- `EXERCISES: Record<id, ExerciseSpec>`，id ∈ squat|jumpingjack|highknees|pushup|...
- `ExerciseSpec`:
```ts
{
  id, name, group, met:number, baseCoinPerRep:number, intensity:number,
  mode:'cyclic'|'alternating',
  requiredLandmarks:number[],            // 必須可見才判定
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
  meta:{ desc, target, sets, repsPerSet, restSec, difficulty }
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
  reps:{ valid:number; invalid:number };
}
```
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
