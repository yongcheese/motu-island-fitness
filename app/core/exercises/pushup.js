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
  // 逐幀不要求看到頭：下壓到底時臉朝地板，鼻/耳可見度常掉，若逐幀強制會在動作最深處把人判成
  // 「看不到」而中止那一下。太近的把關對伏地挺身另有更強的訊號 —— gate 已含雙腕與雙踝，
  // 取景一近就會有點出框而被攔下。開始前的取景關卡仍會檢查頭部（那時人是靜態撐住的）。
  requireHead: false,
  // 伏地挺身是唯一「側面拍」的動作，遠側肢體必然被身體擋住 —— 舊版要求左右兩側全部看得見，
  // 實測遠側可見度一掉到 0.4 以下就整場停擺（0/4 計次、144 幀中斷）。
  // 改為每一對左右關節「至少一側」可信即可。防作弊零損失：sag 用肩/髖/踝的中點算，
  // 遠側被擋住時 MediaPipe 仍會估出位置，實測遠側可見度 0.15 時塌腰照樣 0 valid、4 次 sag。
  gatePairs: [
    [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER], [LM.LEFT_ELBOW, LM.RIGHT_ELBOW],
    [LM.LEFT_WRIST, LM.RIGHT_WRIST], [LM.LEFT_HIP, LM.RIGHT_HIP],
    [LM.LEFT_ANKLE, LM.RIGHT_ANKLE],
  ],
  // targetEnter 0.75：手肘壓到 ≈109° 即達標（原 0.80≈105°，實機側面角度常量不足）；半程樣本(≈0.45)仍被拒
  thresholds: { attemptEnter: 0.30, targetEnter: 0.75, readyReturn: 0.25 },
  faultSeverity: { sag: 'block' },
  cues: {
    sag: { text: '核心收緊，臀部不要塌下或翹高，身體保持一直線', priority: 'high' },
    deeper: { text: '手肘彎曲，胸口往下壓到接近地面，再撐起來', priority: 'mid' },
  },
  phaseCues: {
    READY: '身體打直，開始往下壓',
    CONCENTRIC: '胸口再往下壓一點',
    TARGET: '到底了！用力撐起來',
    ECCENTRIC: '手臂打直，準備下一下',
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
    // —— 塌腰（sagging hips）——
    // 規則依據（I 類）：美軍 AFT／ACFT Hand-Release Push-Up 官方標準（goarmy.com，2026-08-28 查證原文）
    //   「The Soldier will maintain a generally straight body alignment from the top of the head to the ankles.」
    //   「Failing to maintain a generally straight alignment during a repetition will cause that repetition to not count.」
    //   直接針對伏地挺身，且明文「未維持直線對位即該次不計」，與本系統設為 block 一致。
    // ⚠️ 官方原文未使用 "sagging hips" 一詞（那是二手網站轉述），對外描述應採「未維持整體直線對位」。
    // ⚠️ HRP 額外要求底部雙手離地成 T 字，與一般伏地挺身非完全同一動作；共通者為「維持身體直線」此項要求。
    // ⚠️ 界線：軍方標準規範的是「怎樣算一次」，不是傷害研究。不得對外宣稱「塌腰會造成傷害」——
    //   直接針對伏地挺身塌腰之傷害研究，本團隊未查得。
    // ⚠️ 門檻 0.18 為工程判斷（III 類），無外部依據：軍方以目視判斷「是否成一直線」，未給量化閾值。
    //   待標定來源：真人測試加拍之塌腰組。
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
