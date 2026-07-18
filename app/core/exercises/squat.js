// 深蹲：髖部低於膝蓋高度才達標；排除只彎腰、半蹲。
import { LM } from '../landmarks.js';
import { midpoint, vAngleFromVertical, norm, distance } from '../geometry.js';

export const squat = {
  id: 'squat', name: '深蹲', group: 'lower',
  met: 5.4, baseCoinPerRep: 10, intensity: 1.0,
  mode: 'cyclic',
  requiredLandmarks: [LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  // 入鏡判定不含腳踝：深度只看髖 vs 膝，腳被切到框外仍可練（腳踝僅用於估腿長，已有備援）
  gateLandmarks: [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE],
  thresholds: { attemptEnter: 0.25, targetEnter: 0.62, readyReturn: 0.20 },   // Demo 校準 0.75→0.62：真機低角度鏡頭髖顯偏高，標準/近平行蹲可過；半蹲峰值僅 0.28 仍遠低於門檻
  faultSeverity: { torso_lean: 'block' },
  cues: {
    torso_lean: { text: '背部打直，不要彎腰，用臀部往後坐下', priority: 'high' },
    deeper: { text: '再往下蹲，讓髖部低於膝蓋', priority: 'mid' },
  },
  meta: { desc: '雙腳與肩同寬，臀部後坐下蹲', target: '臀腿、股四頭肌', sets: 3, repsPerSet: 12, restSec: 30, difficulty: 1,
    voiceIntro: '開始深蹲。雙腳與肩同寬，腳尖微微朝外，臀部向後向下蹲，蹲到髖部低於膝蓋，再用力站起來。' },
  evaluate(f, s) {
    const hipC = midpoint(f[LM.LEFT_HIP], f[LM.RIGHT_HIP]);
    const kneeC = midpoint(f[LM.LEFT_KNEE], f[LM.RIGHT_KNEE]);
    const kneeY = kneeC.y;
    const shC = midpoint(f[LM.LEFT_SHOULDER], f[LM.RIGHT_SHOULDER]);
    // 腳踝為非 gate 點：看不清時用「髖→膝距離 ×2」估腿長，避免被估歪的腳踝污染深度。
    const ankleReliable = Math.min(f[LM.LEFT_ANKLE]?.visibility ?? 0, f[LM.RIGHT_ANKLE]?.visibility ?? 0) >= 0.5;
    const legLen = ankleReliable ? s.legLength : (distance(hipC, kneeC) * 2 || s.legLength);
    // 深度：髖相對膝（以腿長正規化），髖越低值越大
    const depth = (hipC.y - kneeY) / legLen;
    const progress = norm(depth, -0.5, 0.1);
    const gatePass = depth >= -0.10;             // Demo 校準 -0.02→-0.10：允許髖到近膝(近平行蹲)，半蹲峰值 depth≈-0.33 仍被擋
    const torsoLean = vAngleFromVertical(shC, hipC); // 軀幹傾角
    const faults = [];
    // 45°：真人深蹲自然前傾常達 40°+（尤其筆電低角度鏡頭），42° 誤殺率高；
    // 合成「只彎腰」代償樣本傾角 ≈48° 仍會被擋（測試把關）。
    if (torsoLean > 45) faults.push('torso_lean');
    const legColor = gatePass ? 'green' : (progress > 0.3 ? 'yellow' : 'green');
    const segments = {
      torso: torsoLean > 45 ? 'red' : (torsoLean > 32 ? 'yellow' : 'green'),
      leftLeg: legColor, rightLeg: legColor, leftArm: 'green', rightArm: 'green',
    };
    return { progress, gatePass, faults, segments };
  },
};
