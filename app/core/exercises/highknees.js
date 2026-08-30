// 高抬腿：膝達髖高、左右交替；排除坐著抬腿、不交替。
import { LM } from '../landmarks.js';
import { midpoint, angle, norm } from '../geometry.js';

// 軀幹挺直門檻：軀幹畫面投影長 ÷ 站立基準。與深蹲 TORSO_FOLD_RATIO 同一方法。
// 依據：田徑與健身教學材料通行描述「torso upright / 保持軀幹挺直」（II 類，僅教學慣例）。
//
// ✅ 2026-08-30 已用真人資料驗證（UI-PRMD m02 跨欄步，Vicon 3D，10 位受試者）：
//    正確動作的軀幹投影比 p01=0.962、中位 0.985 → **本門檻誤判 0.0%**（800mm 與 1150mm 兩機位皆是）。
//
// ⚠️ 為什麼深蹲的同一個量出了大問題、這裡卻沒有 —— 這個區別很重要，別誤刪：
//    torsoRatio 會漂移的成因是**軀幹在動作中大幅上下移動**（人下沉時俯角變大，
//    軀幹投影本來就縮短，與前傾無關）。深蹲軀幹下沉逾 500mm，故其門檻隨機位由
//    0.892(地板) 漂到 0.618(1500mm)；高抬腿軀幹幾乎不下沉，實測同一量在四種機位
//    的差異僅 0.001。故「torsoRatio 不可靠」只成立於軀幹有大幅垂直位移的動作。
export const TORSO_UPRIGHT_RATIO = 0.80;

export const highknees = {
  id: 'highknees', name: '高抬腿', group: 'cardio',
  met: 8.0, baseCoinPerRep: 5, intensity: 1.1,
  mode: 'alternating',
  requiredLandmarks: [LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE],
  // 入鏡判定不含腳踝：核心訊號是膝抬到髖高（髖+膝）；腳踝僅用於支撐腳打直檢查
  gateLandmarks: [LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE],
  // 高抬腿是原地彈跳的有氧動作，跟開合跳同類：騰空超過畫面高 0.12 時頭會衝出上緣，
  // 逐幀的頭部把關就會讓整組計不到次（實測 0.12 → valid 0/4、112 幀中斷）。
  // 在取景關卡先要求上緣留白，就不會發生。
  needsHeadroom: true,
  // targetEnter 0.80：真人膝蓋接近髖高即達標（0.85 在實機常差一口氣不計次）；半程樣本(≈0.45)仍被拒
  thresholds: { attemptEnter: 0.30, targetEnter: 0.80, readyReturn: 0.25 },
  faultSeverity: { no_support: 'block', torso_lean: 'advisory' },
  cues: {
    no_support: { text: '請站直，支撐腳打直，不要坐著抬腿', priority: 'high' },
    deeper: { text: '把膝蓋抬高到髖部的高度，左右輪流', priority: 'mid' },
    torso_lean: { text: '上半身挺直，不要往前彎', priority: 'mid' },
  },
  phaseCues: {
    READY: '開始原地交替抬膝',
    CONCENTRIC: '膝蓋再抬高一點 —— 抬到髖部高度',
    TARGET: '很好！換另一腳',
    ECCENTRIC: '放下，換腳抬起',
  },
  meta: { desc: '原地交替抬膝至髖部高度', target: '核心、髖屈肌', sets: 3, repsPerSet: 30, restSec: 20, difficulty: 2,
    tempo: 'fast',              // 節奏快 → 抑制閒聊型語音，改以字卡提示（Bug2(c)）
    voiceIntro: '開始高抬腿。原地左右輪流，把膝蓋抬高到髖部的高度，上半身保持挺直。' },
  evaluate(f, s) {
    const hipC = midpoint(f[LM.LEFT_HIP], f[LM.RIGHT_HIP]);
    // ⚠️ 抬腿深度與深蹲的深度判定同屬「垂直高低關係」，同樣受鏡頭高度影響（2026-08-30 實測）：
    //    同一個真實動作的 progress 峰值 p05 在 800mm 為 0.517、在 1150mm 只剩 0.305，
    //    達 targetEnter(0.80) 的比例由 100%(地板) 掉到 60%(1500mm)。
    //    與深蹲相同，此偏差無法從畫面消除 → 靠設定要求控制機位（鏡頭放低約 0.8–1.0m）。
    const kneeAbove = (kY) => norm((hipC.y - kY) / s.torsoLength, -0.6, 0.0);
    const progressL = kneeAbove(f[LM.LEFT_KNEE].y);
    const progressR = kneeAbove(f[LM.RIGHT_KNEE].y);
    const side = progressL >= progressR ? 'L' : 'R';
    // 支撐腳（未抬起那側）膝角應接近打直。腳踝為非 gate 點：看不清時跳過此檢查（不誤判 block）。
    // ✅ 2026-08-30 真人驗證（同上資料）：正確動作的支撐腳膝角 p05=167.8°、中位 169.5°，
    //    對門檻 150° 有 18° 餘裕，**誤判 0.0%**；且四種機位間的差異僅 0.4°，
    //    是本專案目前**唯一對鏡頭高度近乎完全不敏感**的判定量（因為量的是角度不是高低關係）。
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

    // —— 軀幹挺直 ——
    // 沿用深蹲已驗證的「軀幹投影長度比」：正面機位下前傾使軀幹投影縮短。
    // 直接量肩髖連線的傾角在正面是無效的（見 docs/verification/torso_lean_機位驗證.md）。
    // ⚠️ 同樣有基準污染的盲區：使用者一開始就駝背站著時偵測不到。
    const torsoRatio = s.torsoRatio ?? 1;
    if (active > 0.4 && torsoRatio < TORSO_UPRIGHT_RATIO) faults.push('torso_lean');
    const lc = (p) => p >= 0.7 ? 'green' : (p > 0.4 ? 'yellow' : 'green');
    const segments = {
      torso: gatePass ? 'green' : 'red',
      leftLeg: lc(progressL), rightLeg: lc(progressR), leftArm: 'green', rightArm: 'green',
    };
    return { progressL, progressR, side, gatePass, faults, segments };
  },
};
