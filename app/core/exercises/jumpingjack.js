// 開合跳：手過肩 + 腳超肩寬（同時）；排除只揮手、只張腳。
import { LM } from '../landmarks.js';
import { midpoint, distance, norm } from '../geometry.js';

export const jumpingjack = {
  id: 'jumpingjack', name: '開合跳', group: 'cardio',
  met: 8.0, baseCoinPerRep: 6, intensity: 1.1,
  mode: 'cyclic',
  requiredLandmarks: [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.LEFT_ANKLE, LM.RIGHT_ANKLE],
  // 入鏡判定「不含手腕」（實機 bug 主因）：開合跳舉手時手腕會高到顱頂上方 20%+ 身高，
  // 在正常取景下必然衝出畫面上緣。舊版沒宣告 gateLandmarks → 退回含手腕的 requiredLandmarks
  // → 手腕一出框當幀就判「看不到人」並中止整下。診斷量測：B=92%/headroom=2% 的取景下
  // valid 0/3（全被記成 half_rep），把手腕移出 gate 後 3/3。
  // 改用「肩＋髖＋踝」：髖同時解決軀幹骨架亂跳（畫面上的軀幹四邊形正是肩＋髖）。
  // 手腕仍由 evaluate 用來算 armRaise（MediaPipe 對略微出框的點仍會外插，足以判斷「手過頭」）。
  gateLandmarks: [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_ANKLE, LM.RIGHT_ANKLE],
  needsHeadroom: true,          // 跳躍類：取景關卡額外要求上緣留白，跳起時核心關節才不會出框
  // 逐幀不要求看到頭：騰空頂點時頭本來就會貼近／越過畫面上緣，若逐幀硬性要求，就會用「頭」
  // 重演一次原本「手腕出框 → 整下報銷」的 bug。互審實測：額外騰空 0.12 畫面高時，
  // requireHead 逐幀生效 → valid 0/5（全 half_rep）；改 false → 5/5、零中斷。
  // 「太近」對開合跳另有把關：取景關卡（站姿）仍檢查頭部＋上緣留白，逐幀則有 gate 點出框判定。
  requireHead: false,
  thresholds: { attemptEnter: 0.30, targetEnter: 0.70, readyReturn: 0.25 },
  faultSeverity: { limb_desync: 'block' },
  cues: {
    limb_desync: { text: '手和腳要同時打開、同時收回', priority: 'mid' },
    deeper: { text: '雙手舉過頭頂，雙腳跳開超過肩寬', priority: 'mid' },
  },
  // Bug2(b)：動態動作靠語音來不及，改用「當下該做什麼」的即時字卡（依週期相位切換）。
  phaseCues: {
    READY: '往上跳 —— 雙手舉過頭、雙腳同時跳開',
    CONCENTRIC: '手再舉高、腳再跳開一點',
    TARGET: '到位了！收回來',
    ECCENTRIC: '雙手放下、雙腳併攏',
  },
  meta: { desc: '雙手過頭擊掌、雙腳同時跳開', target: '全身有氧', sets: 3, repsPerSet: 20, restSec: 20, difficulty: 1,
    tempo: 'fast',              // 節奏快 → 抑制閒聊型語音，改以字卡＋短音提示（Bug2(c)）
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
    //  bothActive — 手腳同步檢查。門檻 0.5→0.35：armP 與 legP 的正規化窗口本來就不對齊
    //    （armRaise 用 [-1.5,1.0]、legSpread 用 [0.7,1.4]），真人在同一瞬間兩者不會同時過 0.5。
    //    診斷實測：腳張開 <1.6× 肩寬的使用者「每一下」都被誤判 limb_desync（block 級）而不計次，
    //    而且拿到的提示是「手和腳要同時打開」——與真正的問題不符，使用者根本不知道怎麼改。
    //    0.35 仍能擋住真正的代償（只揮手 legP≈0、只張腳 armP≈0），達標品質另由 gatePass 把關。
    //  gatePass — 峰值品質,要求手腕高於肩(armRaise>0 ⟺ armP>0.6),排除「腳全開但手未過肩」
    const bothActive = armP >= 0.35 && legP >= 0.35;
    const gatePass = armP > 0.6 && legP >= 0.5;
    const faults = [];
    if (progress > 0.6 && !bothActive) faults.push('limb_desync');
    // 顏色語意對齊另外三個動作：紅＝真的做錯，不是「還沒做到位」。
    // 舊版把 armP/legP ≤ 0.3 一律畫紅，於是每一下的起手與收回都會閃紅 —— 使用者看到顏色亂跳、
    // 卻沒有任何東西真的做錯（深蹲/高抬腿/伏地挺身在同樣情況都是回綠）。
    // 紅色改為只在 limb_desync 成立時、標在「拖後腿的那一邊」，讓使用者知道要改什麼。
    const desync = faults.includes('limb_desync');
    const armColor = (desync && armP < 0.35) ? 'red' : (armP >= 0.6 ? 'green' : (armP > 0.3 ? 'yellow' : 'green'));
    const legColor = (desync && legP < 0.35) ? 'red' : (legP >= 0.6 ? 'green' : (legP > 0.3 ? 'yellow' : 'green'));
    const segments = {
      torso: 'green',
      leftArm: armColor, rightArm: armColor,
      leftLeg: legColor, rightLeg: legColor,
    };
    return { progress, gatePass, faults, segments };
  },
};
