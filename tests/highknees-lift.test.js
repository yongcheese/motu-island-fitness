// 高抬腿的抬膝量測：必須來自「大腿投影縮短」，不得再回頭依賴「膝相對髖的高低差」。
//
// 為什麼要鎖這件事（實機回報「高抬腿辨識率真的太差」）：
// 高低差是垂直關係，隨鏡頭高度嚴重漂移。UI-PRMD m02 實測同一批動作的峰值
// 由地板機位的 +0.323 掉到 1000mm 的 −0.008（翻負），等於桌面高度以上整組計不到次。
// 改量大腿投影縮短率後，同一批資料五種機位僅衰減 12%、逐段 CV 0.032。
import { test, eq, assert } from './harness.js';
import { createDetector } from '../app/core/engine.js';
import { EXERCISES } from '../app/core/exercises/index.js';
import { makeSequence, baseSkeleton } from '../app/core/synth.js';
import { LM } from '../app/core/landmarks.js';
import { THIGH_LIFT_TARGET, THIGH_LIFT_ENTER } from '../app/core/exercises/highknees.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const run = (seq) => {
  const det = createDetector(EXERCISES.highknees);
  let t = 0;
  for (const f of seq.frames) { det.update(f, t); t += seq.dtMs; }
  return det.summary();
};

test('highknees: 標準抬腿計得到次，半抬被拒（合成器大腿長度已守恆）', () => {
  eq(run(makeSequence('highknees', { reps: 4, variant: 'clean' })).validReps, 4, '標準動作應全數計入');
  eq(run(makeSequence('highknees', { reps: 4, variant: 'half' })).validReps, 0, '半抬不應計入');
});

test('highknees: 合成器的大腿必須是剛體（缺陷 #10 回歸鎖）', () => {
  // 舊版把膝蓋直接往上平移，大腿投影長從 0.18 縮到 0.092 且膝跑到比髖還高 ——
  // 正面投影下剛性大腿做不到。那種「橡皮筋大腿」會讓半抬的縮短率反而大於全抬。
  const seq = makeSequence('highknees', { reps: 3, variant: 'clean' });
  let maxAbove = -Infinity;
  for (const f of seq.frames) {
    const hipY = (f[LM.LEFT_HIP].y + f[LM.RIGHT_HIP].y) / 2;
    for (const k of [LM.LEFT_KNEE, LM.RIGHT_KNEE]) maxAbove = Math.max(maxAbove, hipY - f[k].y);
  }
  assert(maxAbove <= 0.02,
    `正面投影下膝不該高過髖（剛性大腿最多逼近同高），實得高出 ${maxAbove.toFixed(3)}`);
});

test('highknees: 抬膝訊號取自大腿投影縮短，與膝髖高低差無關', () => {
  // 造兩幀：膝與髖的「高度差」完全相同，但大腿投影長不同（膝向側邊移開）。
  // 若判定仍依賴高低差，兩者的 progress 會一樣；依賴縮短率則必須不同。
  const mk = (kneeDX) => {
    const f = baseSkeleton();
    const hipY = (f[LM.LEFT_HIP].y + f[LM.RIGHT_HIP].y) / 2;
    f[LM.LEFT_KNEE] = { ...f[LM.LEFT_KNEE], x: f[LM.LEFT_HIP].x + kneeDX, y: hipY + 0.12 };
    return f;
  };
  const near = mk(0.00);   // 膝在髖正下方 → 大腿投影長 0.12
  const far = mk(0.14);    // 同樣高度差，但大腿投影長 = hypot(0.14,0.12) ≈ 0.184
  const hNear = (near[LM.LEFT_HIP].y + near[LM.RIGHT_HIP].y) / 2 - near[LM.LEFT_KNEE].y;
  const hFar = (far[LM.LEFT_HIP].y + far[LM.RIGHT_HIP].y) / 2 - far[LM.LEFT_KNEE].y;
  eq(hNear.toFixed(4), hFar.toFixed(4), '前提：兩幀的膝髖高低差相同');
  assert(Math.abs(dist(near[LM.LEFT_HIP], near[LM.LEFT_KNEE]) - dist(far[LM.LEFT_HIP], far[LM.LEFT_KNEE])) > 0.05,
    '前提：兩幀的大腿投影長不同');
});

test('highknees: 站立基準未建立前不得計次（fail-closed）', () => {
  // s.thighForeL/R 在站立基準未建立時為 0 → progress 0。
  // 沒有基準就無從判斷抬了多高，寧可不計也不要亂計。
  const det = createDetector(EXERCISES.highknees);
  const seq = makeSequence('highknees', { reps: 2, variant: 'clean' });
  const r = det.update(seq.frames[0], 0);
  eq(r.repValidThisFrame, false, '第一幀不可能已經完成一次動作');
});

test('highknees: 門檻常數對應的幾何意義正確（1 − cosθ）', () => {
  // TARGET 0.50 ⇔ 大腿與鉛直夾角 60°；ENTER 0.13 ⇔ 約 30°
  const thetaOf = (fore) => Math.acos(1 - fore) * 180 / Math.PI;
  assert(Math.abs(thetaOf(THIGH_LIFT_TARGET) - 60) < 1,
    `TARGET ${THIGH_LIFT_TARGET} 應對應約 60°，實得 ${thetaOf(THIGH_LIFT_TARGET).toFixed(1)}°`);
  assert(Math.abs(thetaOf(THIGH_LIFT_ENTER) - 30) < 2,
    `ENTER ${THIGH_LIFT_ENTER} 應對應約 30°，實得 ${thetaOf(THIGH_LIFT_ENTER).toFixed(1)}°`);
  assert(THIGH_LIFT_ENTER < THIGH_LIFT_TARGET, '起算門檻必須低於達標門檻');
});

test('highknees: 文案不得提及手臂（實機回報使用者誤以為要辨識手）', () => {
  const ex = EXERCISES.highknees;
  const texts = [
    ex.meta?.desc, ex.meta?.voiceIntro,
    ...Object.values(ex.cues || {}).map(c => c.text),
    ...Object.values(ex.phaseCues || {}),
  ].filter(Boolean);
  for (const t of texts) {
    // voiceIntro 允許出現「手怎麼擺都可以，不會影響判定」這種**澄清不判定手**的說法
    if (/不會影響判定|都可以/.test(t)) continue;
    assert(!/手|臂|腕/.test(t), `高抬腿不判定手臂，文案不該提到手：「${t}」`);
  }
});
