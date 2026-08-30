// 伏地挺身：手肘下壓達標、全身一直線；排除半程、塌腰撅臀。
import { LM } from '../landmarks.js';
import { midpoint, angle, distance, norm } from '../geometry.js';

// 點 P 到線段 AB 所在直線的垂直距離
function pointLineDist(P, A, B) {
  const dx = B.x - A.x, dy = B.y - A.y;
  const len = Math.hypot(dx, dy) || 1e-6;
  return Math.abs((P.x - A.x) * dy - (P.y - A.y) * dx) / len;
}

// 頂點伸展角度：一次動作中肘角須至少回到此值，才算「推到頂手臂打直」。
// 依據：美軍 AFT／ACFT 官方標準「fully extending the elbows (front leaning rest)」。
// ⚠️ 160 為工程判斷 —— AFT 以目視判斷伸直與否，未給角度值。未經真人標定。
// ⚠️ 必須用「該次是否曾達到」判定，不能逐幀判也不能用 progress 推斷：
//    progress 經平滑與 clamp，且動作週期在 readyReturn 就結束，永遠降不到對應的值。
export const LOCKOUT_ANGLE = 160;

// 頭頸前伸門檻：耳相對肩的水平偏移 ÷ 軀幹長。NASM Pushing Assessment 列
// 「head jutting forward」為代償項。⚠️ 0.35 為工程判斷，未經真人標定。
export const HEAD_FORWARD_RATIO = 0.35;

// 塌腰門檻：髖偏離「肩—踝」連線的距離 ÷ 軀幹長。詳細標定依據見 evaluate 內註解。
export const SAG_RATIO = 0.30;

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
  faultSeverity: { sag: 'block', no_lockout: 'advisory', head_forward: 'advisory' },
  checksLockout: true,
  cues: {
    sag: { text: '核心收緊，臀部不要塌下或翹高，身體保持一直線', priority: 'high' },
    deeper: { text: '手肘彎曲，胸口往下壓到接近地面，再撐起來', priority: 'mid' },
    no_lockout: { text: '推到頂時手臂完全打直', priority: 'mid' },
    head_forward: { text: '頭別往前伸，脖子跟身體保持一直線', priority: 'mid' },
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
    // 門檻 SAG_RATIO：軍方以目視判斷「是否成一直線」，未給量化閾值，故數值須自行標定。
    //
    // ✅ 2026-08-30 已用真人資料標定（前一版 0.18 為工程判斷，實測證明過緊）：
    //   資料 REHAB24-6（DOI 10.5281/zenodo.13305826，CC BY-NC 4.0），Ex3 桌上伏地挺身，
    //   10 位受試者、46 次正確 + 50 次不正確，物理治療師標註正確與否，光學動捕 3D 真值。
    //   實測（每次動作取峰值）：正確組 中位 0.167／p95 0.283；不正確組 中位 0.361。
    //     · 舊門檻 0.18 恰好落在正確組的中位數上 → **在正確動作上誤判 45.7%**，
    //       而本項是 block 級（會取消使用者的有效次數）。
    //     · 0.30 取正確組 p95 附近：誤判 4.3%，仍觸發 62% 的不正確動作。
    //
    // ✅ 本量對機位穩健（與深蹲深度、高抬腿抬腿高度形成對比）：
    //   側面機位高度 0.6／1.0／1.5 m 三種下，正確組中位數差異僅 0.0015；
    //   且投影量到的值（0.166）與 3D 真值（0.167）幾乎相同。
    //   原因：它是沿身體長軸的形狀比值，側面機位正對該平面，不受俯角影響。
    //   故維持 block 級是站得住的 —— 與 torso_lean 因機位不穩而降級的情況不同。
    //
    // ⚠️ 限制：REHAB24-6 的 Ex3 是**桌上**伏地挺身（身體與鉛垂線夾約 43°），
    //   非本 App 預期的地板平板姿勢。地板姿勢下重力對身體的垂直分量較大，
    //   正確動作的自然下沉可能高於此處實測值，門檻仍須以真人測試複核。
    // ⚠️ 只有誤判率經標定；「不正確組觸發率 62%」不等於塌腰偵測率（該組未細分錯誤型別）。
    const gatePass = sagRatio < SAG_RATIO;
    const faults = [];


    // —— 頭頸前伸（NASM Pushing Assessment）——
    // 側面機位即矢狀面，故此量可靠。耳相對肩的水平偏移，以軀幹長正規化。
    // ⚠️ NASM 該評估使用站姿推舉而非伏地挺身，屬相鄰動作之外推，已於依據總表記錄。
    const ear = f[LM.LEFT_EAR]?.visibility >= (f[LM.RIGHT_EAR]?.visibility ?? 0)
      ? f[LM.LEFT_EAR] : f[LM.RIGHT_EAR];
    if ((ear?.visibility ?? 0) >= 0.5 && torso > 1e-6) {
      // 側面拍攝時身體沿 x 軸水平：頭在肩的前方（x 較小），偏移過大即前伸
      if ((shC.x - ear.x) / torso > HEAD_FORWARD_RATIO) faults.push('head_forward');
    }
    if (sagRatio >= SAG_RATIO) faults.push('sag');
    const armColor = progress >= 0.8 ? 'green' : (progress > 0.4 ? 'yellow' : 'green');
    const segments = {
      torso: sagRatio >= SAG_RATIO ? 'red' : (sagRatio > SAG_RATIO * 0.55 ? 'yellow' : 'green'),
      leftArm: armColor, rightArm: armColor, leftLeg: 'green', rightLeg: 'green',
    };
    return { progress, gatePass, faults, segments, lockoutOk: elbowAngle >= LOCKOUT_ANGLE };
  },
};
