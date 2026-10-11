// 2026-10-11 真人錄影（MacBook 內建鏡頭、筆電放桌上）逐格重播找到的兩個深蹲 bug：
//   ① 側身深蹲一下都算不到：遠側膝蓋被擋住（可見度中位 0.23），深蹲卻要求左右膝都看得見。
//   ② 雙手舉高站著時多算一下：MediaPipe 把骨架估成上下顛倒，hipDrop 灌到 1.37。
// 重播工具與完整數字見 tools/replay/replay.html、docs/verification/深蹲桌面機位重播.md。
import { test, eq, assert } from './harness.js';
import { makeSequence } from '../app/core/synth.js';
import { createDetector } from '../app/core/engine.js';
import { EXERCISES } from '../app/core/exercises/index.js';
import { squatPlausible, isSideView, SIDE_VIEW_SWR } from '../app/core/exercises/squat.js';
import { LM } from '../app/core/landmarks.js';

const squat = EXERCISES.squat;
function run(frames, spec = squat) {
  const d = createDetector(spec); let t = 0;
  for (const f of frames) { d.update(f, t); t += 33; }
  return d.summary();
}
const clean = (reps) => makeSequence('squat', { reps, variant: 'clean' }).frames;

/* ---------- ① 側身：遠側膝蓋被擋住 ---------- */
test('側身：右膝可見度 0.2（被身體擋住）時，3 次深蹲仍全部計到（修改前 0 次）', () => {
  const frames = clean(3).map(f => f.map((p, i) => (i === LM.RIGHT_KNEE ? { ...p, visibility: 0.2 } : p)));
  eq(run(frames).validReps, 3);
});

test('對照：拿掉「至少一側」設定，同一段資料一次都計不到 —— 證明上一條測的是這個修正', () => {
  const frames = clean(3).map(f => f.map((p, i) => (i === LM.RIGHT_KNEE ? { ...p, visibility: 0.2 } : p)));
  const { gatePairs, ...noPairs } = squat;
  eq(run(frames, noPairs).validReps, 0);
});

test('側身：左右膝都看不清楚時仍然停止判定（不是無條件放行）', () => {
  const frames = clean(3).map(f => f.map((p, i) => (i === LM.RIGHT_KNEE || i === LM.LEFT_KNEE ? { ...p, visibility: 0.2 } : p)));
  eq(run(frames).validReps, 0);
});

// 把骨架左右壓扁＝側身時肩寬在畫面上縮成一小段；鼻子往前移＝側身時鼻子本來就在肩的前方
const sideOn = (f, noseDx) => {
  const cx = (f[LM.LEFT_SHOULDER].x + f[LM.RIGHT_SHOULDER].x) / 2;
  return f.map((p, i) => ({ ...p, x: cx + (p.x - cx) * 0.15 + (i === LM.NOSE ? noseDx : 0) }));
};

test('側身判定：肩寬÷軀幹長 < 0.30 才算側身；正面合成骨架不算', () => {
  eq(SIDE_VIEW_SWR, 0.30);
  assert(isSideView({ shoulderWidth: 0.02, torsoLength: 0.25 }), '側身沒被認出來');
  assert(!isSideView({ shoulderWidth: 0.15, torsoLength: 0.25 }), '正面被當成側身');
  assert(!isSideView({ shoulderWidth: 0.1, torsoLength: 0 }), '軀幹長 0 時不可判成側身');
});

test('側身時不報「頭側傾」：鼻子在肩前方是側身的正常樣子（正面同樣偏移則要報，當對照）', () => {
  const side = run(clean(3).map(f => sideOn(f, 0.03)));
  eq(side.validReps, 3);
  eq(side.advisoryCounts.head_tilt || 0, 0);
  const front = run(clean(3).map(f => f.map((p, i) => (i === LM.NOSE ? { ...p, x: p.x + 0.06 } : p))));
  assert((front.advisoryCounts.head_tilt || 0) > 0, '對照組：正面頭偏一側應該要報，否則上面的 0 證明不了什麼');
});

/* ---------- ② 骨架上下顛倒 ---------- */
// 真人錄影 s1 第 3737（正常站立）與 3743（估錯）幀的 y 座標：[左肩,右肩,左髖,右髖,左膝,右膝,左踝,右踝]
const REAL = {
  stand: [0.093, 0.107, 0.353, 0.354, 0.556, 0.555, 0.759, 0.767],
  flipped: [0.486, 0.462, 0.311, 0.316, 0.239, 0.25, 0.151, 0.155],
};
const withY = (ys) => {
  const f = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE]
    .forEach((k, i) => { f[k] = { x: i % 2 ? 0.55 : 0.45, y: ys[i], z: 0, visibility: 0.9 }; });
  return f;
};

test('合理性：真人站立幀通過；真人估錯的上下顛倒幀不通過', () => {
  const standTorso = 0.25;
  assert(squatPlausible(withY(REAL.stand), { standTorso }), '正常站立被擋');
  assert(!squatPlausible(withY(REAL.flipped), { standTorso }), '上下顛倒沒被擋');
  // 站立基準建立前：只靠「腳踝在膝上方」這條也擋得下
  assert(!squatPlausible(withY(REAL.flipped)), '沒有站立基準時就放行了顛倒幀');
});

test('合理性：合成的正常深蹲（含蹲到最低點）每一幀都通過', () => {
  const frames = clean(2);
  const mid = (f, a, b) => ({ x: (f[a].x + f[b].x) / 2, y: (f[a].y + f[b].y) / 2 });
  const f0 = frames[0], sh = mid(f0, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER), hp = mid(f0, LM.LEFT_HIP, LM.RIGHT_HIP);
  const standTorso = Math.hypot(sh.x - hp.x, sh.y - hp.y);   // 與引擎的站立軀幹基準同一個量
  frames.forEach((f, i) => assert(squatPlausible(f, { standTorso }), `第 ${i} 幀正常深蹲被擋`));
  // 用引擎實際的站立基準量：整段計次不受影響
  eq(run(frames).validReps, 2);
});

// 站著 → 骨架突然上下顛倒 6 幀（30fps 約 0.2 秒；重播中故障持續 5 幀＝15fps 約 0.33 秒）→ 站回來
const flipFrame = (f) => {
  const hipY = (f[LM.LEFT_HIP].y + f[LM.RIGHT_HIP].y) / 2;
  return f.map(p => ({ ...p, y: 2 * hipY - p.y }));
};
function standFlipStand() {
  const stand = makeSequence('squat', { reps: 0, restFrames: 60 }).frames;
  return [...stand, ...stand.slice(0, 6).map(flipFrame), ...stand];
}

test('站著時骨架被估成上下顛倒幾幀：不計次（修改前會多算 1 下）', () => {
  eq(run(standFlipStand()).validReps, 0);
});

test('對照：拿掉合理性檢查，同一段資料確實會多算 —— 證明上一條測的是這個修正', () => {
  const { plausible, ...noGuard } = squat;
  assert(run(standFlipStand(), noGuard).validReps >= 1, '沒有合理性檢查也不多算，這個夾具重現不了 bug');
});
