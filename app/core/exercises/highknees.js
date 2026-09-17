// 高抬腿：膝達髖高、左右交替；排除坐著抬腿、不交替。
import { LM } from '../landmarks.js';
import { midpoint, angle, norm } from '../geometry.js';
import { landmarkOk } from '../framing.js';

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

// 抬膝達標門檻：大腿投影縮短率（0＝站直，越大代表大腿越朝向鏡頭＝抬得越高）。
//
// ⚠️ 2026-09-17 量測方式更換。原本量「膝相對髖的高度差 ÷ 軀幹長」，
//    那是垂直高低關係，隨鏡頭高度嚴重漂移。UI-PRMD m02 實測同一批動作的峰值：
//      地板 +0.323 ／ 750mm +0.074 ／ 1000mm **−0.008** ／ 1150mm −0.058 ／ 1500mm −0.172
//    數值在桌面高度就翻成負的 —— 等於「膝蓋永遠沒抬過髖部」，整組計不到次。
//    這正是實機回報「高抬腿辨識率真的太差」的成因。
//
// 改量大腿投影縮短率：抬腿時大腿在矢狀面轉向鏡頭，其畫面投影隨之縮短。
// 同一批資料實測五種機位僅衰減 12%、逐段變異係數 0.032 —— 是四個候選量中最穩的。
//
// 幾何意義：大腿與鉛直線夾角 θ 時，正面投影長 ≈ L·cosθ，故縮短率 = 1 − cosθ。
//   θ=30° → 0.13 ／ θ=45° → 0.29 ／ θ=60° → 0.50 ／ θ=90°（水平）→ 1.00
// TARGET 取 0.50，即**大腿抬到與鉛直夾角 60°以上**。
//
// ⚠️ 這是幾何推導的工程判斷，**不是以標註過的高抬腿資料標定的**。
//    可用的公開資料集沒有高抬腿（UI-PRMD m02 跨欄步只是近似動作，慢、單次、抬得特別高，
//    其峰值 0.68–0.77 遠高於本門檻），故本門檻的誤判率與靈敏度**均未標定**。
//    對外不得宣稱本項已驗證。真人測試時應優先確認此值。
// ⚠️ 隨之更新對外文案：不再宣稱「膝蓋抬到髖部高度」，改為「大腿抬到接近水平」——
//    門檻訂在 60° 就不該說成 90°。
export const THIGH_LIFT_TARGET = 0.50;
export const THIGH_LIFT_ENTER = 0.13;   // θ≈30°，開始算一次嘗試

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
  thresholds: { attemptEnter: 0.30, targetEnter: 0.80, readyReturn: 0.25 },
  // 訓練中不強制看到頭：本動作的判定只用到髖與膝（見 gateLandmarks），
  // 而原地抬膝時頭部常會短暫衝出畫面上緣 —— 逐幀要求看到頭會讓整組計不到次。
  // 開始前的取景關卡仍硬性要求頭部（workout.js 寫死 requireHead:true），
  // 「太近」的保護因此不受影響。
  requireHead: false,
  judgedSegments: ['torso', 'leftLeg', 'rightLeg'],   // 手臂不判定（跑步擺臂怎麼擺都可以）
  faultSeverity: { no_support: 'block', torso_lean: 'advisory' },
  // 文案原則（實機回報「提示會讓使用者誤會，不知道該怎麼做」）：
  //  · 只講腿，不提任何與手有關的事 —— 本動作完全不判定手臂。
  //  · 動作標準改用「大腿抬到接近水平」，與實際門檻（60°）一致，不再說「抬到髖部高度」。
  //  · 每句都是可直接執行的指令，不用抽象詞。
  cues: {
    no_support: { text: '站著做 —— 支撐的那隻腳要打直，不要坐著或蹲著抬腿', priority: 'high' },
    deeper: { text: '大腿再抬高一點，抬到接近與地面平行', priority: 'mid' },
    torso_lean: { text: '上半身站直，不要往前彎腰', priority: 'mid' },
  },
  phaseCues: {
    READY: '站直，原地左右輪流抬腿',
    CONCENTRIC: '大腿再抬高 —— 抬到接近水平',
    TARGET: '很好！換另一隻腳',
    ECCENTRIC: '放下，換腳抬起',
  },
  meta: { desc: '原地站著，左右輪流把大腿抬到接近水平', target: '核心、髖屈肌', sets: 3, repsPerSet: 30, restSec: 20, difficulty: 2,
    tempo: 'fast',              // 節奏快 → 抑制閒聊型語音，改以字卡提示（Bug2(c)）
    voiceIntro: '開始高抬腿。站直，原地左右輪流抬腿，大腿抬到接近與地面平行，上半身保持挺直。手怎麼擺都可以，不會影響判定。' },
  evaluate(f, s) {
    const hipC = midpoint(f[LM.LEFT_HIP], f[LM.RIGHT_HIP]);
    // 抬膝高度：改用「大腿投影縮短率」，理由與實測數據見上方 THIGH_LIFT_TARGET 註解。
    // s.thighForeL/R 由 engine 依站立基準算出（站直＝0）。站立基準尚未建立時為 0，
    // 此時 progress 恆為 0、不會計次 —— 這是刻意的 fail-closed：
    // 沒有基準就無從判斷抬了多高，寧可不計也不要亂計。
    const lift = (v) => norm(v, THIGH_LIFT_ENTER, THIGH_LIFT_TARGET);
    const progressL = lift(s.thighForeL ?? 0);
    const progressR = lift(s.thighForeR ?? 0);
    const side = progressL >= progressR ? 'L' : 'R';
    // 支撐腳（未抬起那側）膝角應接近打直。腳踝為非 gate 點：看不清時跳過此檢查（不誤判 block）。
    // ✅ 2026-08-30 真人驗證（同上資料）：正確動作的支撐腳膝角 p05=167.8°、中位 169.5°，
    //    對門檻 150° 有 18° 餘裕，**誤判 0.0%**；且四種機位間的差異僅 0.4°，
    //    是本專案目前**唯一對鏡頭高度近乎完全不敏感**的判定量（因為量的是角度不是高低關係）。
    const standAnkle = side === 'L' ? f[LM.RIGHT_ANKLE] : f[LM.LEFT_ANKLE];
    const standKnee = side === 'L' ? f[LM.RIGHT_KNEE] : f[LM.LEFT_KNEE];
    const standHip = side === 'L' ? f[LM.RIGHT_HIP] : f[LM.LEFT_HIP];
    // 同 squat.js：必須一併確認座標在畫面內。出框的關節點會被外插，
    // 拿它算支撐腳膝角會得到假的角度，可能誤判 no_support（block 級，會扣掉有效次數）。
    const ankleReliable = landmarkOk(standAnkle, 0.5);
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
