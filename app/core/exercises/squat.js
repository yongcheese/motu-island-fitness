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
  // Bug2(b)：每一幀都告訴使用者「現在該做什麼」，不用等語音。
  phaseCues: {
    READY: '臀部往後坐，開始往下蹲',
    CONCENTRIC: '繼續往下 —— 髖部要低於膝蓋',
    TARGET: '夠低了！用力站起來',
    ECCENTRIC: '站直站穩，準備下一下',
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
    // 門檻 45°。以下為 2026-08-22 實測值（跑合成序列逐幀量 vAngleFromVertical 取峰值）：
    //   clean 0.00° ／ half 0.00° ／ compensation 46.42°
    // ⚠️ 兩件事必須寫清楚，不要再被舊註解誤導：
    //  (1) 判別餘裕只有 1.42°（46.42 − 45）。對照同檔的深度規則：clean 峰值 +0.129、
    //      half −0.330，門檻 −0.10 落在兩者中間、兩側各約 0.23 的餘裕。本規則的餘裕遠小於它，
    //      真人資料進來很容易翻。
    //  (2) 合成器產生的正常深蹲軀幹「完全打直」（恆為 0°），根本不模擬真人的自然前傾。
    //      因此「真人自然前傾常達 40°+、42° 會誤殺」這類說法在目前的測試裡得不到任何支持 ——
    //      舊註解曾這樣寫，但那是工程判斷，不是實測結論，已刪除。
    // 真人正常深蹲的前傾分佈仍未知；若其落在 45° 附近，就會與代償樣本的 46.42° 重疊而分不開。
    // 這正是必須做真人測試的理由之一（見《現狀盤點與改善規劃》C-3、B-3）。在那之前不動此值。
    if (torsoLean > 45) faults.push('torso_lean');
    const legColor = gatePass ? 'green' : (progress > 0.3 ? 'yellow' : 'green');
    const segments = {
      torso: torsoLean > 45 ? 'red' : (torsoLean > 32 ? 'yellow' : 'green'),
      leftLeg: legColor, rightLeg: legColor, leftArm: 'green', rightArm: 'green',
    };
    return { progress, gatePass, faults, segments };
  },
};
