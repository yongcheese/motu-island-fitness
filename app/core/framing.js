// 取景品質判定（純函式；瀏覽器 + Node 共用，零 DOM 依賴）。
//
// 動機（實機回報的兩個 bug）：
//  Bug1 使用者太近時「硬是辨識下去」。成因：舊判定只看 `visibility ≥ visMin`，而 MediaPipe 對
//       出框的關節點會「外插」座標並仍給出不低的 visibility → 頭已經出畫面，判定卻認為看得到。
//       這裡加上兩道與 visibility 互相獨立的訊號：
//         (1) 座標必須真的落在畫面內（inFrame）
//         (2) 人體跨幅不得佔滿整個畫面（bodyBox.span）
//       並且第一次把「頭部」納入把關（舊版四個動作的 gate 都沒有任何頭部節點）。
//  Bug2 動態動作（開合跳）軀幹還沒抓準就開始判定，骨架扭曲跳動。
//       createStabilityTracker 提供「軀幹尺度是否已經穩定」的判斷，讓取景關卡要求
//       「位置抓好 + 尺度穩定」兩者同時成立才放行。
//
// 本模組只回報「取景好不好」，不碰計次、不碰防作弊、不碰任何動作門檻。
import { LM } from './landmarks.js';

export const FRAMING = {
  visMin: 0.4,        // 與 engine cfg.visMin 對齊（呼叫端可覆寫；UI 不得比引擎嚴）
  outTol: 0.02,       // 座標超出 [0,1] 多少才算出框（容忍 MediaPipe 邊緣誤差）
  maxSpan: 0.95,      // 人體跨幅佔畫面比例上限 → 超過＝太近
  minSpan: 0.30,      // 下限 → 低於＝太遠
  // 跳躍類動作需要的上緣留白：站姿時頭頂到畫面上緣至少留這麼多。
  // 0.10 → 0.18：互審實測真人騰空高度落在 0.10~0.15 畫面高，門檻等於騰空高度＝零安全邊際
  // （0.12 就會開始整組計不到次）。0.18 留出約一個頭的空間。
  headroom: 0.18,
  footroom: 0.02,     // 下緣留白
};

// 頭部節點：鼻或任一耳（只要其中一個「可見且在框內」就算抓得到頭）
export const HEAD_LANDMARKS = [LM.NOSE, LM.LEFT_EAR, LM.RIGHT_EAR];

// 量人體跨幅/上下緣時取樣的核心點（不含手指腳趾等末端，避免揮手就被判太近）
export const BODY_LANDMARKS = [
  LM.NOSE, LM.LEFT_EAR, LM.RIGHT_EAR,
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];
// 軀幹＋四肢主幹（不含頭：頭由 requireHead 單獨管，跳躍類動作會刻意放行）。
// 用來擋「身體有一部分在畫面外」——這件事與各 spec 的 gate 無關，不該因為某個動作
// 沒把那個點列進 gate 就靜默放行。
export const CORE_LANDMARKS = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

// 「可以從畫面下緣出去」的點。
//
// 實機回報：「需要拉到很遠、還要放在地上才能用，無法正常放在桌上。」
// 成因就在上面那條 CORE_LANDMARKS 檢查：它硬性要求**腳踝**在畫面內，
// 但深蹲的 gateLandmarks 根本不含腳踝，squat.js 也早就寫了腳踝不可信時的替代算法
// （用髖→膝距離 ×2 估腿長）。也就是說**判定不需要腳踝，取景關卡卻擋著不放行**，
// 還回覆「請往後退一步或把鏡頭放低」—— 使用者照做，就被推去「拉很遠 + 放地上」。
//
// 筆電放在桌上時，站姿最先出框的一定是腳。只要該動作的判定用不到腳踝，
// 就不該因此擋人。但**只放行從下緣出去**：從上緣或左右出去代表取景真的歪了或人太近。
export const BOTTOM_OPTIONAL = [LM.LEFT_ANKLE, LM.RIGHT_ANKLE, LM.LEFT_HEEL, LM.RIGHT_HEEL,
  LM.LEFT_FOOT_INDEX, LM.RIGHT_FOOT_INDEX];

/** 這個點是否只是「從畫面下緣出去」（而非上緣或左右）。 */
export function outBottomOnly(p, tol = FRAMING.outTol) {
  return !!p && p.y > 1 + tol && p.x >= -tol && p.x <= 1 + tol;
}

// landmark 索引 → 人話部位（給使用者看的取景訊息用）
export const PART_NAME = {
  [LM.NOSE]: '頭部', [LM.LEFT_EAR]: '頭部', [LM.RIGHT_EAR]: '頭部',
  [LM.LEFT_SHOULDER]: '肩膀', [LM.RIGHT_SHOULDER]: '肩膀',
  [LM.LEFT_ELBOW]: '手肘', [LM.RIGHT_ELBOW]: '手肘',
  [LM.LEFT_WRIST]: '手腕', [LM.RIGHT_WRIST]: '手腕',
  [LM.LEFT_HIP]: '髖部', [LM.RIGHT_HIP]: '髖部',
  [LM.LEFT_KNEE]: '膝蓋', [LM.RIGHT_KNEE]: '膝蓋',
  [LM.LEFT_ANKLE]: '腳踝', [LM.RIGHT_ANKLE]: '腳踝',
};
const partsOf = (idx) => [...new Set(idx.map(i => PART_NAME[i]).filter(Boolean))];
// MediaPipe 的成對關節：奇數=左、偶數=右（11 起）。用來分辨「整個半身看不到」＝側身站，
// 這種情況叫使用者「把鏡頭放低或後退」完全沒用，該說的是「請正對鏡頭」。
const sideOf = (i) => (i >= 11 ? (i % 2 ? 'L' : 'R') : null);
function oneSidedMissing(idx) {
  const sides = new Set(idx.map(sideOf).filter(Boolean));
  return idx.length >= 2 && sides.size === 1;
}

/** 座標是否真的落在畫面內。與 visibility 無關 —— 這是「太近/出框」的獨立訊號。 */
export function inFrame(p, tol = FRAMING.outTol) {
  return !!p && p.x >= -tol && p.x <= 1 + tol && p.y >= -tol && p.y <= 1 + tol;
}
/** 一個點是否「可信且在框內」。取景判定的最小單位，engine 與 UI 共用。 */
export function landmarkOk(p, visMin = FRAMING.visMin, tol = FRAMING.outTol) {
  return !!p && (p.visibility ?? 0) >= visMin && inFrame(p, tol);
}

/** 以「可信且在框內」的核心點量人體外框。
 *  span 取 max(寬, 高)：站姿看高度、伏地挺身（水平姿勢）看寬度，同一組門檻兩種姿勢都適用。 */
export function bodyBox(frame, { visMin = FRAMING.visMin, tol = FRAMING.outTol, indices = BODY_LANDMARKS } = {}) {
  // 註：只採計「在框內」的點。腳從下緣出框時人體高度會被低估 —— 這正是 too_far 改用
  // 站立基準（baselineSpan）而非逐幀跨幅的另一個理由，見 framingReport 的 too_far 註解。
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0, n = 0;
  for (const i of indices) {
    const p = frame?.[i];
    if (!landmarkOk(p, visMin, tol)) continue;
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    n++;
  }
  if (n < 3) return { n, w: 0, h: 0, span: 0, top: 0, bottom: 1 };
  const w = x1 - x0, h = y1 - y0;
  return { n, w, h, span: Math.max(w, h), top: y0, bottom: y1, left: x0, right: x1 };
}

function fail(issue, parts, text, span = 0) { return { ok: false, issue, parts, text, span }; }

/**
 * 取景總判定。判定順序＝「最能解釋使用者處境」的順序，第一個成立的就回報。
 *
 * @param {Array} frame 33 點
 * @param {object} opts
 *   gateLandmarks  該動作真正需要看到的核心點（engine 的 gate 同一份）
 *   gatePairs      成對的左右關節，每一對「至少一側」可信即可。側面拍攝（伏地挺身）時
 *                  遠側肢體被身體擋住是正常的，要求兩側都看得見會讓整場停擺。
 *                  出現在 gatePairs 裡的索引，不再被當成 gateLandmarks 逐點硬性檢查。
 *   visMin         可見度門檻
 *   requireHead    是否要求看得到頭（預設 true —— Bug1(a) 的直接修正）
 *   needsHeadroom  跳躍類動作：額外要求上緣留白，讓人跳起來時頭不會衝出畫面（Bug2(c)）
 *   baselineSpan   使用者「站直時」的人體跨幅（由 engine 以站立基準 EMA 提供，未建立時為 null）。
 *                  提供且已達 minSpan 時，不再逐幀判「太遠」—— 理由見下方 too_far 的註解。
 * @returns {{ok, issue, parts, text, span}}
 *   issue ∈ null | 'no_pose' | 'no_head' | 'too_close' | 'missing' | 'turned_away'
 *                | 'too_far' | 'no_headroom' | 'no_footroom'
 */
export function framingReport(frame, opts = {}) {
  const {
    gateLandmarks = [], gatePairs = [], visMin = FRAMING.visMin, tol = FRAMING.outTol,
    requireHead = true, needsHeadroom = false,
    maxSpan = FRAMING.maxSpan, minSpan = FRAMING.minSpan,
    headroom = FRAMING.headroom, footroom = FRAMING.footroom,
    baselineSpan = null,
  } = opts;

  if (!frame || !frame.length) return fail('no_pose', [], '找不到人，請站到鏡頭中');

  // 1) 頭部 —— 抓不到頭就不該繼續辨識（Bug1(a)）
  if (requireHead) {
    const headInFrame = HEAD_LANDMARKS.some(i => landmarkOk(frame[i], visMin, tol));
    if (!headInFrame) {
      // 「看得到但在框外」＝典型的太近；「根本看不到」＝角度或遮擋問題，訊息要分開講
      const headSeen = HEAD_LANDMARKS.some(i => (frame[i]?.visibility ?? 0) >= visMin);
      return headSeen
        ? fail('too_close', ['頭部'], '太近了 —— 看不到您的頭，請往後退一步，讓頭到腳都在畫面裡')
        : fail('no_head', ['頭部'], '看不到您的頭部，請正對鏡頭，或把鏡頭放低一點');
    }
  }

  // 成對關節（gatePairs）改「至少一側」判定；其餘 gate 點仍逐點硬性要求。
  const paired = new Set(gatePairs.flat());
  const singles = gateLandmarks.filter(i => !paired.has(i));

  // 2) gate 關節點「有偵測到、但座標已經在畫面外」→ 太近／取景偏掉
  const out = singles.filter(i => (frame[i]?.visibility ?? 0) >= visMin && !inFrame(frame[i], tol));
  if (out.length) {
    const parts = partsOf(out);
    return fail('too_close', parts, `您的${parts.join('、')}超出畫面了，請往後退一步或把鏡頭放低`);
  }

  // 2b) 核心身體點出框（與 spec 的 gate 無關）。必要性：bodyBox 會把出框的點排除，
  //     所以「身體有一部分在畫面外」若不在這裡攔下，就會被算成「一個比較小、取景良好的人」
  //     而通過第 4 條的跨幅檢查。深蹲的 gate 不含腳踝，人太近導致腳出框正是 Bug1 的原始情境。
  //     ⚠️ 但**不要比判定本身更嚴**：該動作的 gate 用不到的點，若只是從畫面**下緣**出去
  //     （筆電放桌上時腳一定先出框），就不該擋 —— 那正是「必須放地上」的來源。
  //     「人太近」的保護其實已由前面兩關涵蓋：太近時最先出框的是**頭**（第 1 關）或
  //     **該動作 gate 需要的關節**（第 2 關與下面這行的 gateNeeds），兩者都會擋下。
  //     真正只剩下「腳踝從下緣出去、其餘全部在框內」這一種情形 —— 那就是桌面鏡頭的俯角，
  //     而非距離問題。故此處只針對「非 gate 且從下緣出去」的末端點放行。
  //     ⚠️ 刻意不用 bodyBox 的跨幅來分辨遠近：bodyBox 會排除出框的點，
  //     人愈近、被排除的點愈多，量到的跨幅反而愈小，拿它判「太近」會得到相反的結論。
  const gateNeeds = new Set([...gateLandmarks, ...gatePairs.flat()]);
  const bodyOut = CORE_LANDMARKS.filter(i => {
    if ((frame[i]?.visibility ?? 0) < visMin || inFrame(frame[i], tol)) return false;
    if (gateNeeds.has(i)) return true;                                  // 判定需要 → 一定要在框內
    return !(BOTTOM_OPTIONAL.includes(i) && outBottomOnly(frame[i], tol));
  });
  if (bodyOut.length) {
    const parts = partsOf(bodyOut);
    return fail('too_close', parts, `您的${parts.join('、')}超出畫面了，請往後退一步或把鏡頭放低`);
  }

  // 3) gate 關節點看不清 —— 沿用既有的具體取景指引（不是通用的「請後退」）
  //    成對關節：兩側都不可信才算缺件（側面拍攝時遠側被擋住是正常的）
  const miss = [
    ...singles.filter(i => (frame[i]?.visibility ?? 0) < visMin),
    ...gatePairs.filter(pr => !pr.some(i => landmarkOk(frame[i], visMin, tol))).map(pr => pr[0]),
  ];
  if (miss.length) {
    const parts = partsOf(miss);
    // 缺的全在同一側 → 是側身站（自己擋住自己），不是取景高低的問題。
    // 指引方向必須跟成因對應，否則使用者照著調只會愈調愈錯。
    return oneSidedMissing(miss)
      ? fail('turned_away', parts, `看不到您的另一側身體（${parts.join('、')}），請正對鏡頭站好`)
      : fail('missing', parts,
        `看不到您的${parts.join('、')}，請把鏡頭放低或後退一步（Mac 請關閉控制中心的「人物置中」）`);
  }

  // 4) 跨幅：所有點都在框內時才有意義（太近時點會先被第 2 條攔下）
  const box = bodyBox(frame, { visMin, tol });
  // 可信的核心點太少 → fail-closed。資料不足就放行等於整段距離判定靜默失效。
  if (box.n < 3) return fail('missing', [], '看不清楚您的身體，請站到鏡頭中、讓全身入鏡');
  if (box.span > maxSpan) return fail('too_close', [], '太近了，請往後退一步讓全身入鏡', box.span);
  // 「太遠」是**站姿時**的前置條件，不是逐幀條件 —— 與上方 needsHeadroom 同一個道理。
  // 深蹲到最低點時人體高度會少掉一半以上（UI-PRMD 真人實測：站立 span 0.67 → 蹲底 0.29），
  // 逐幀判的話，蹲底那幾幀與「站得很遠」在數值上完全一樣，於是引擎正好在最該判定的
  // 深處停止判定。故一旦站立基準已確認距離足夠，就不再用當幀跨幅判太遠。
  // 使用者真的走遠時仍會被抓到：站立基準只在身體直立時更新，人走遠後站著，基準會隨之下降。
  const farRef = baselineSpan == null ? box.span : Math.max(box.span, baselineSpan);
  if (farRef < minSpan) return fail('too_far', [], '離鏡頭有點遠，請往前一步', box.span);
  // 5) 跳躍類動作的上下留白：站姿就貼著畫面邊緣的話，一跳起來就會出框、偵測會亂掉。
  //    上下緣分開回報 —— 問題在腳卻叫使用者「讓頭頂留空間」，使用者只會愈調愈錯。
  if (needsHeadroom) {
    if (box.top < headroom) {
      return fail('no_headroom', [], '這個動作會跳起來 —— 請再後退一點，讓頭頂上方留出約一個頭的空間', box.span);
    }
    if (box.bottom > 1 - footroom) {
      return fail('no_footroom', [], '腳快超出畫面下緣了 —— 請把鏡頭往上抬一點，或再後退一步', box.span);
    }
  }

  return { ok: true, issue: null, parts: [], text: '', span: box.span };
}

/** 軀幹尺度穩定度追蹤（Bug2(a)：等軀幹抓準再開始）。
 *  用「肩寬」與「軀幹長」在滾動視窗內的變異係數判斷 —— 兩者都是平移不變量，
 *  站著準備時本該幾乎不變；骨架亂跳時會明顯放大。
 *  任何一幀四個軀幹點不可信就清空視窗（不讓壞資料混進統計）。 */
export function createStabilityTracker({ window: win = 12, maxCv = 0.10, visMin = FRAMING.visMin, tol = FRAMING.outTol } = {}) {
  let buf = [];
  const cvOf = (arr) => {
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    if (!(m > 1e-6)) return 1;
    const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length;
    return Math.sqrt(v) / m;
  };
  return {
    reset() { buf = []; },
    get size() { return buf.length; },
    /** @returns {{ready:boolean, stable:boolean, cv:number}} ready=視窗已集滿 */
    push(frame) {
      const ls = frame?.[LM.LEFT_SHOULDER], rs = frame?.[LM.RIGHT_SHOULDER];
      const lh = frame?.[LM.LEFT_HIP], rh = frame?.[LM.RIGHT_HIP];
      if (![ls, rs, lh, rh].every(p => landmarkOk(p, visMin, tol))) { buf = []; return { ready: false, stable: false, cv: 1 }; }
      const sw = Math.hypot(ls.x - rs.x, ls.y - rs.y);
      const tl = Math.hypot((ls.x + rs.x) / 2 - (lh.x + rh.x) / 2, (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2);
      buf.push([sw, tl]);
      if (buf.length > win) buf.shift();
      if (buf.length < win) return { ready: false, stable: false, cv: 1 };
      const cv = Math.max(cvOf(buf.map(b => b[0])), cvOf(buf.map(b => b[1])));
      return { ready: true, stable: cv <= maxCv, cv };
    },
  };
}
