// 伏地挺身：手肘下壓達標、全身一直線；排除半程、塌腰撅臀。
import { LM } from '../landmarks.js';
import { midpoint, angle, distance, norm } from '../geometry.js';

// 點 P 到線段 AB 所在直線的垂直距離
function pointLineDist(P, A, B) {
  const dx = B.x - A.x, dy = B.y - A.y;
  const len = Math.hypot(dx, dy) || 1e-6;
  return Math.abs((P.x - A.x) * dy - (P.y - A.y) * dx) / len;
}

export const pushup = {
  id: 'pushup', name: '伏地挺身', group: 'upper',
  met: 8.0, baseCoinPerRep: 8, intensity: 1.05,
  mode: 'cyclic',
  // 伏地挺身為水平姿勢，自然取景容得下全身：要求看到肩/肘/腕/髖/踝（含左右兩側，
  // sag 直線判定用到雙髖、雙踝），才能可靠做「塌腰一直線」防作弊。
  requiredLandmarks: [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST, LM.LEFT_HIP, LM.LEFT_ANKLE,
    LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST, LM.RIGHT_HIP, LM.RIGHT_ANKLE],
  // targetEnter 0.75：手肘壓到 ≈109° 即達標（原 0.80≈105°，實機側面角度常量不足）；半程樣本(≈0.45)仍被拒
  thresholds: { attemptEnter: 0.30, targetEnter: 0.75, readyReturn: 0.25 },
  faultSeverity: { sag: 'block' },
  cues: {
    sag: { text: '核心收緊，臀部不要塌下或翹高，身體保持一直線', priority: 'high' },
    deeper: { text: '手肘彎曲，胸口往下壓到接近地面，再撐起來', priority: 'mid' },
  },
  meta: { desc: '雙手撐地，身體成棒式下壓', target: '胸、肩、三頭肌', sets: 3, repsPerSet: 10, restSec: 40, difficulty: 3,
    voiceIntro: '開始伏地挺身。雙手撐地與肩同寬，身體從頭到腳保持一直線，手肘彎曲把胸口下壓，再撐起來。' },
  evaluate(f, s) {
    const elbowAngle = (
      angle(f[LM.LEFT_SHOULDER], f[LM.LEFT_ELBOW], f[LM.LEFT_WRIST]) +
      angle(f[LM.RIGHT_SHOULDER], f[LM.RIGHT_ELBOW], f[LM.RIGHT_WRIST])
    ) / 2;
    const progress = norm(165 - elbowAngle, 0, 75);   // 165°→0，90°→1
    const shC = midpoint(f[LM.LEFT_SHOULDER], f[LM.RIGHT_SHOULDER]);
    const hipC = midpoint(f[LM.LEFT_HIP], f[LM.RIGHT_HIP]);
    const ankC = midpoint(f[LM.LEFT_ANKLE], f[LM.RIGHT_ANKLE]);
    const torso = distance(shC, hipC) || 1e-6;
    const sagRatio = pointLineDist(hipC, shC, ankC) / torso; // 髖偏離肩—踝連線
    const gatePass = sagRatio < 0.18;
    const faults = [];
    if (sagRatio >= 0.18) faults.push('sag');
    const armColor = progress >= 0.8 ? 'green' : (progress > 0.4 ? 'yellow' : 'green');
    const segments = {
      torso: sagRatio >= 0.18 ? 'red' : (sagRatio > 0.1 ? 'yellow' : 'green'),
      leftArm: armColor, rightArm: armColor, leftLeg: 'green', rightLeg: 'green',
    };
    return { progress, gatePass, faults, segments };
  },
};
