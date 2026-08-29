// 深蹲：髖部低於膝蓋高度才達標；排除只彎腰、半蹲。
import { LM } from '../landmarks.js';
import { midpoint, norm, distance } from '../geometry.js';

// 膝內夾門檻：膝距低於踝距的此倍率即提示。工程判斷值，待真人樣本標定（見 evaluate 內註解）。
export const KNEE_VALGUS_KASR = 0.85;

// 軀幹前傾門檻：軀幹畫面投影長 ÷ 站立基準。低於此值判為彎腰代償。
// 依透視模型試算（軀幹 0.5m、距鏡頭 1.5–2.5m）：
//   正常深蹲之自然前傾 0–30° → 0.96–1.06（15–20° 時因靠近鏡頭放大而略大於 1）
//   彎腰代償 ≥50°           → <0.86
// 取 0.86 使兩者間留有緩衝。⚠️ 工程判斷值，待真人樣本標定。
export const TORSO_FOLD_RATIO = 0.86;

// 頭部側傾門檻：鼻相對肩中心的水平偏移 ÷ 肩寬。BSA ①「頭部位置」。
// ⚠️ 只測得到「側傾」——頭部前傾屬矢狀面，正面投影無水平位移，與 torso_lean 同類限制。
// ⚠️ 0.18 為工程判斷，未經真人標定。
export const HEAD_TILT_RATIO = 0.18;

// 骨盆傾斜門檻：左右髖的垂直落差 ÷ 肩寬。BSA ④「髖部位置（骨盆水平、對稱）」。
// ⚠️ 0.10 為工程判斷，未經真人標定。
export const HIP_UNEVEN_RATIO = 0.10;

export const squat = {
  id: 'squat', name: '深蹲', group: 'lower',
  met: 5.4, baseCoinPerRep: 10, intensity: 1.0,
  mode: 'cyclic',
  requiredLandmarks: [LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  // 入鏡判定不含腳踝：深度只看髖 vs 膝，腳被切到框外仍可練（腳踝僅用於估腿長，已有備援）
  gateLandmarks: [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE],
  thresholds: { attemptEnter: 0.25, targetEnter: 0.62, readyReturn: 0.20 },   // Demo 校準 0.75→0.62：真機低角度鏡頭髖顯偏高，標準/近平行蹲可過；半蹲峰值僅 0.28 仍遠低於門檻
  faultSeverity: {
    torso_lean: 'block',
    knee_valgus: 'advisory', head_tilt: 'advisory', hip_uneven: 'advisory', tempo_fast: 'advisory',
  },
  // 開啟節奏判定（BSA ⑩）。時序特徵，不受機位影響。
  tempoAdvisory: true,
  cues: {
    torso_lean: { text: '背部打直，不要彎腰，用臀部往後坐下', priority: 'high' },
    knee_valgus: { text: '膝蓋往外推，對齊腳尖方向', priority: 'high' },
    head_tilt: { text: '頭擺正，視線看前方', priority: 'mid' },
    hip_uneven: { text: '兩邊髖部放平，重心平均分配', priority: 'mid' },
    tempo_fast: { text: '下蹲慢一點，控制著往下', priority: 'mid' },
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
    // —— 軀幹前傾（彎腰代替下蹲）——
    // 規則依據（I 類）：Myer et al. (2014) Back Squat Assessment 第③項「軀幹位置」；
    //   CrossFit air squat 動作規範「chest up、維持腰椎曲線」。
    // ⚠️ 量測方式於 2026-08-28 更換，原因見 docs/verification/torso_lean_機位驗證.md：
    //   舊版用 vAngleFromVertical(肩,髖) 取肩髖連線與鉛直線的夾角，該角度由「水平位移」決定。
    //   但人繞髖在矢狀面前傾時，正面機位的水平位移恆為 0 —— 數學上不論前傾至 90° 都測得 0°，
    //   端對端驗證亦確認真實前傾 45°/60° 的樣本 5 次全被判為有效。舊版實際測到的是「側傾」，
    //   卻回饋「不要彎腰」，且為 block 級會取消該次。
    // 改用「軀幹畫面投影長 ÷ 站立基準」：前傾使軀幹投影縮短，此變化正面機位測得到。
    // ⚠️ 能力界線（必須對外揭露，兩點）：
    //  (1) 透視會部分抵消縮短（前傾使人靠近鏡頭而放大），故只分辨得出明顯彎腰。
    //      合成驗證（漸進式前傾，站直→蹲下才彎）：30° 不觸發、45°/60°/75° 皆觸發。
    //      完整的軀幹評估仍需側面機位，BSA 亦如此建議。
    //  (2) **基準污染**：若使用者「一開始站著就已駝背」，站立基準即在彎腰狀態下建立，
    //      比值恆為 1，系統偵測不到。本量測的是「相對於自己站姿的變化」，不是絕對姿勢。
    //      驗證中曾對全序列施加固定前傾，結果 45°/60° 完全無法偵測，即為此故。
    //      真人測試須將此情形納入：彎腰組的口令必須是「站直後、蹲下時才彎腰」，
    //      而非「全程駝背做完」——後者是本方法的已知盲區。
    const torsoRatio = s.torsoRatio ?? 1;
    // 閘門與 engine 的站立基準更新門檻一致（progress < 0.15 時更新基準、之後才判定），
    // 兩者互補不重疊。⚠️ 不可用較高的閘門（如 0.4）：彎腰代償的特徵正是「蹲不深卻前傾」，
    // 其 progress 峰值僅約 0.38，高閘門會讓最該抓的樣本剛好漏掉。
    if (progress >= 0.15 && torsoRatio < TORSO_FOLD_RATIO) faults.push('torso_lean');

    // —— 膝內夾（knee valgus）——
    // 規則依據（I 類）：NASM Overhead Squat Assessment 明列「knees moving inward」為代償項，
    //   其正面觀察判準為「膝蓋應與腳對齊」。OHSA 為徒手深蹲，與本動作同型。
    //   Myer et al. (2014) 亦將膝內夾與軀幹前傾、深度不足並列為需辨識矯正之技術缺陷 ——
    //   本作品企劃書第二章已引用該文獻，先前卻只實作了後兩項，此處補齊。
    // 量測方式：KASR（knee-to-ankle separation ratio，膝距 ÷ 踝距）。
    //   Mizner et al. 建議 KASR 與 FPPA 作為 3D 動力學的 2D 替代指標。
    //   選 KASR 而非 FPPA 的理由：只需膝與踝的水平座標，是正面深蹲最可靠的兩組點位；
    //   FPPA 需要髖-膝-踝三點夾角，髖點在深蹲時受衣物與骨盆前傾影響較大。
    // ⚠️ 門檻 0.85 為工程判斷（III 類），**沒有文獻依據**，不得對外描述為文獻值。
    //   合成器實測（2026-08-28，單次動作最深處）：clean 2.738 ／ half 1.782 ／
    //   compensation 2.738 ／ valgus 0.352。合成器的正常深蹲膝為外開（KASR≥1），
    //   真人不會如此，故此門檻在真人資料上的適切性未知。
    //   待標定來源：UI-PRMD 的 incorrect 含「knees not aligned」樣本，以及真人測試加拍之膝內夾組。
    // ⚠️ 刻意不列入 faultSeverity 的 block：門檻既無依據，就不應據以取消使用者的有效次數。
    //   目前僅輸出提示，標定完成後再決定是否升格為阻擋。
    // —— 頭部側傾（BSA ①）——
    // 依據：Myer et al. (2014) BSA 第①項「頭部位置」，正確為頸部垂直、目光向前，
    //   異常含頭部側傾。⚠️ 該項原文含「過度前傾、後仰」，但那屬矢狀面，
    //   正面機位測不到（與 torso_lean 同類限制），故本作品只實作「側傾」這一子項，
    //   不得對外宣稱已涵蓋 BSA ① 全部。
    const nose = f[LM.NOSE];
    if (progress >= 0.15 && (nose?.visibility ?? 0) >= 0.5 && s.shoulderWidth > 1e-6) {
      if (Math.abs(nose.x - shC.x) / s.shoulderWidth > HEAD_TILT_RATIO) faults.push('head_tilt');
    }

    // —— 骨盆水平（BSA ④）——
    // 依據：BSA 第④項「髖部位置」，正確為兩側髖平行於地面、對稱；異常為一側下降。
    // 正面機位可靠：左右髖的垂直落差是冠狀面的量，落在畫面平面內。
    if (progress >= 0.15 && s.shoulderWidth > 1e-6) {
      const dy = Math.abs(f[LM.LEFT_HIP].y - f[LM.RIGHT_HIP].y);
      if (dy / s.shoulderWidth > HIP_UNEVEN_RATIO) faults.push('hip_uneven');
    }

    const ankleSpan = Math.abs(f[LM.RIGHT_ANKLE].x - f[LM.LEFT_ANKLE].x);
    const kneeSpan = Math.abs(f[LM.RIGHT_KNEE].x - f[LM.LEFT_KNEE].x);
    // 只在蹲到一定深度後才判：站直時膝自然併攏，淺處判定會誤觸發。
    // 需 ankleReliable：踝點不可信時踝距失真，比值無意義。
    if (progress > 0.5 && ankleReliable && ankleSpan > 1e-6) {
      if (kneeSpan / ankleSpan < KNEE_VALGUS_KASR) faults.push('knee_valgus');
    }
    const legColor = gatePass ? 'green' : (progress > 0.3 ? 'yellow' : 'green');
    const segments = {
      torso: (progress >= 0.15 && torsoRatio < TORSO_FOLD_RATIO) ? 'red'
        : (progress >= 0.15 && torsoRatio < 0.93) ? 'yellow' : 'green',
      leftLeg: legColor, rightLeg: legColor, leftArm: 'green', rightArm: 'green',
    };
    return { progress, gatePass, faults, segments };
  },
};
