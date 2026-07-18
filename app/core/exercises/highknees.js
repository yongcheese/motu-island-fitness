// 高抬腿：膝達髖高、左右交替；排除坐著抬腿、不交替。
import { LM } from '../landmarks.js';
import { midpoint, angle, norm } from '../geometry.js';

export const highknees = {
  id: 'highknees', name: '高抬腿', group: 'cardio',
  met: 8.0, baseCoinPerRep: 5, intensity: 1.1,
  mode: 'alternating',
  requiredLandmarks: [LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE],
  // 入鏡判定不含腳踝：核心訊號是膝抬到髖高（髖+膝）；腳踝僅用於支撐腳打直檢查
  gateLandmarks: [LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE],
  // targetEnter 0.80：真人膝蓋接近髖高即達標（0.85 在實機常差一口氣不計次）；半程樣本(≈0.45)仍被拒
  thresholds: { attemptEnter: 0.30, targetEnter: 0.80, readyReturn: 0.25 },
  faultSeverity: { no_support: 'block' },
  cues: {
    no_support: { text: '請站直，支撐腳打直，不要坐著抬腿', priority: 'high' },
    deeper: { text: '把膝蓋抬高到髖部的高度，左右輪流', priority: 'mid' },
  },
  meta: { desc: '原地交替抬膝至髖部高度', target: '核心、髖屈肌', sets: 3, repsPerSet: 30, restSec: 20, difficulty: 2,
    voiceIntro: '開始高抬腿。原地左右輪流，把膝蓋抬高到髖部的高度，上半身保持挺直。' },
  evaluate(f, s) {
    const hipC = midpoint(f[LM.LEFT_HIP], f[LM.RIGHT_HIP]);
    const kneeAbove = (kY) => norm((hipC.y - kY) / s.torsoLength, -0.6, 0.0);
    const progressL = kneeAbove(f[LM.LEFT_KNEE].y);
    const progressR = kneeAbove(f[LM.RIGHT_KNEE].y);
    const side = progressL >= progressR ? 'L' : 'R';
    // 支撐腳（未抬起那側）膝角應接近打直。腳踝為非 gate 點：看不清時跳過此檢查（不誤判 block）。
    const standAnkle = side === 'L' ? f[LM.RIGHT_ANKLE] : f[LM.LEFT_ANKLE];
    const standKnee = side === 'L' ? f[LM.RIGHT_KNEE] : f[LM.LEFT_KNEE];
    const standHip = side === 'L' ? f[LM.RIGHT_HIP] : f[LM.LEFT_HIP];
    const ankleReliable = (standAnkle?.visibility ?? 0) >= 0.5;
    // 站姿驗證：腳踝可見→用支撐腳膝角(精準);腳踝不可見→改用「支撐腳膝明顯低於髖」
    // (只需髖+膝,皆在 gate 內),仍能擋住「藏住腳、坐著交替抬膝」的繞路。
    const gatePass = ankleReliable
      ? angle(standHip, standKnee, standAnkle) > 150
      : (standKnee.y - hipC.y) / s.torsoLength > 0.45;
    const faults = [];
    const active = Math.max(progressL, progressR);
    if (active > 0.5 && !gatePass) faults.push('no_support');
    const lc = (p) => p >= 0.7 ? 'green' : (p > 0.4 ? 'yellow' : 'green');
    const segments = {
      torso: gatePass ? 'green' : 'red',
      leftLeg: lc(progressL), rightLeg: lc(progressR), leftArm: 'green', rightArm: 'green',
    };
    return { progressL, progressR, side, gatePass, faults, segments };
  },
};
