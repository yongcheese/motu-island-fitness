// 高抬腿在「真人節奏 × 低幀率」下必須計得到次（2026-10-29 實機回報「高抬腿完全辨識不了」）。
//
// 舊合成樣本是「抬一腳 → 放下 → 休息 → 換腳」，跟真人的連續快速交替差很遠，所以測試全綠、實機全壞。
// 兩個成因（以 MediaPipe 實跑真人正面影片確認）：
//   1. 平滑視窗以幀數計：15fps 時 5 幀＝333ms，把一下 0.3 秒的抬腿峰值抹平 → 整串判半程。
//      真人影片同一段 31 下：30fps 有效 28、15fps 只剩 1。
//   2. 冷卻左右共用：左右腳結束只差約 0.27 秒，右腳那下被當抖動丟掉 → 下一下又判「未交替」。
// 本檔用「左右連續交替」的合成序列鎖住這兩件事，並確認防作弊（只抬同一腳）沒有因此放寬。
import { test, eq, assert } from './harness.js';
import { createDetector } from '../app/core/engine.js';
import { EXERCISES, LOCKED } from '../app/core/exercises/index.js';
import { demoPose } from '../app/core/synth.js';
import { LM } from '../app/core/landmarks.js';

const RIGHT_LEG = [LM.RIGHT_KNEE, LM.RIGHT_ANKLE, LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX];

/** 連續原地高抬腿：spm＝每分鐘總下數（左右合計），peak＝抬腿幅度（1＝90°）。
 *  singleLeg 時只有左腳在抬（右腳一直站著）。前 2 秒站立，讓引擎建立站立基準。 */
// peak 0.95＝玩偶抬到約 86°（1＝90°）：2026-10-31 計次標準改為接近水平（約 75°），測試動作要符合新標準
function runContinuous({ spm, fps, peak = 0.95, secs = 12, singleLeg = false }) {
  const det = createDetector(EXERCISES.highknees);
  const dt = 1000 / fps;
  const standFrames = fps * 2;
  for (let i = 0; i < standFrames; i++) det.update(demoPose('highknees', 0, 'L'), i * dt);
  for (let i = 0; i < secs * fps; i++) {
    const ph = 2 * Math.PI * (spm / 2 / 60) * (i * dt / 1000);
    const dL = Math.max(0, Math.sin(ph)) * peak;
    const dR = singleLeg ? 0 : Math.max(0, -Math.sin(ph)) * peak;
    const a = demoPose('highknees', dL, 'L');
    const b = demoPose('highknees', dR, 'R');
    det.update(a.map((p, k) => (RIGHT_LEG.includes(k) ? { ...b[k] } : { ...p })), (standFrames + i) * dt);
  }
  return det.summary();
}

test('highknees: 15fps、每分鐘 140 下的連續交替要計得到（舊版只剩 1 下）', () => {
  const s = runContinuous({ spm: 140, fps: 15 });
  assert(s.validReps >= 26, `應計入約 28 下，實得有效 ${s.validReps}、無效 ${s.invalidReps} ${JSON.stringify(s.faultCounts)}`);
});

test('highknees: 每分鐘 180 下的快速交替，15／20／30fps 都不能被冷卻吃掉', () => {
  for (const fps of [15, 20, 30]) {
    const s = runContinuous({ spm: 180, fps });
    assert(s.validReps >= 34, `${fps}fps 應計入約 36 下，實得有效 ${s.validReps} ${JSON.stringify(s.faultCounts)}`);
    eq(s.faultCounts.no_alternation || 0, 0, `${fps}fps 不該出現「未交替」連鎖誤判`);
  }
});

test('highknees: 只抬同一隻腳仍然不計（防作弊沒有因冷卻分邊而放寬）', () => {
  for (const fps of [15, 30]) {
    const s = runContinuous({ spm: 140, fps, singleLeg: true });
    eq(s.validReps, 0, `${fps}fps 只抬左腳不應計入`);
  }
});

test('highknees: 時間型平滑只套用在高抬腿，深蹲等動作維持原本的 5 幀平滑', () => {
  eq(EXERCISES.highknees.smoothMs, 100);
  for (const id of ['squat', 'jumpingjack', 'pushup']) eq(EXERCISES[id].smoothMs, undefined, id);
});

test('demo 鎖定：只開放深蹲與高抬腿，鎖定名單裡的動作都還在 EXERCISES（判定保留）', () => {
  assert(!LOCKED.has('squat') && !LOCKED.has('highknees'), '深蹲、高抬腿必須開放');
  assert(LOCKED.has('jumpingjack') && LOCKED.has('pushup'), '開合跳、伏地挺身必須鎖定');
  for (const id of LOCKED) assert(EXERCISES[id], `${id} 的判定程式應保留`);
});
