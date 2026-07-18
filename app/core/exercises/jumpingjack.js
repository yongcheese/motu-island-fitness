// 開合跳：手過肩 + 腳超肩寬（同時）；排除只揮手、只張腳。
import { LM } from '../landmarks.js';
import { midpoint, distance, norm } from '../geometry.js';

export const jumpingjack = {
  id: 'jumpingjack', name: '開合跳', group: 'cardio',
  met: 8.0, baseCoinPerRep: 6, intensity: 1.1,
  mode: 'cyclic',
  requiredLandmarks: [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.LEFT_ANKLE, LM.RIGHT_ANKLE],
  thresholds: { attemptEnter: 0.30, targetEnter: 0.70, readyReturn: 0.25 },
  faultSeverity: { limb_desync: 'block' },
  cues: {
    limb_desync: { text: '手和腳要同時打開、同時收回', priority: 'mid' },
    deeper: { text: '雙手舉過頭頂，雙腳跳開超過肩寬', priority: 'mid' },
  },
  meta: { desc: '雙手過頭擊掌、雙腳同時跳開', target: '全身有氧', sets: 3, repsPerSet: 20, restSec: 20, difficulty: 1,
    voiceIntro: '開始開合跳。雙手向上舉過頭頂、同時雙腳向外跳開，再一起收回，保持穩定節奏。' },
  evaluate(f, s) {
    const shC = midpoint(f[LM.LEFT_SHOULDER], f[LM.RIGHT_SHOULDER]);
    const wristC = midpoint(f[LM.LEFT_WRIST], f[LM.RIGHT_WRIST]);
    const armRaise = (shC.y - wristC.y) / s.shoulderWidth;       // 手腕高於肩 → 正
    const legSpread = distance(f[LM.LEFT_ANKLE], f[LM.RIGHT_ANKLE]) / s.shoulderWidth;
    const armP = norm(armRaise, -1.5, 1.0);
    const legP = norm(legSpread, 0.7, 1.4);                      // 1.1× 肩寬達標
    const progress = Math.max(armP, legP);
    // 解耦兩種把關：
    //  bothHalf — 手腳同步檢查(沿用舊 0.5 門檻,上升途中不會誤判 clean)
    //  gatePass — 峰值品質,要求手腕高於肩(armRaise>0 ⟺ armP>0.6),排除「腳全開但手未過肩」
    const bothHalf = armP >= 0.5 && legP >= 0.5;
    const gatePass = armP > 0.6 && legP >= 0.5;
    const faults = [];
    if (progress > 0.6 && !bothHalf) faults.push('limb_desync');
    const segments = {
      torso: 'green',
      leftArm: armP >= 0.6 ? 'green' : (armP > 0.3 ? 'yellow' : 'red'),
      rightArm: armP >= 0.6 ? 'green' : (armP > 0.3 ? 'yellow' : 'red'),
      leftLeg: legP >= 0.6 ? 'green' : (legP > 0.3 ? 'yellow' : 'red'),
      rightLeg: legP >= 0.6 ? 'green' : (legP > 0.3 ? 'yellow' : 'red'),
    };
    return { progress, gatePass, faults, segments };
  },
};
