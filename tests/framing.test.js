// 取景把關的回歸測試（實機兩個 bug）。
// Bug1 太近時「硬是辨識下去」：舊判定只看 visibility，而 MediaPipe 對出框的點會外插座標
//      並仍給不低的 visibility → 頭已經出畫面卻照樣判定。
// Bug2 開合跳一舉手就掉線：手腕在正常取景下必然衝出畫面上緣，而它被列進了入鏡判定。
import { test, eq, assert } from './harness.js';
import { framingReport, createStabilityTracker, inFrame, landmarkOk, cameraHeightHint} from '../app/core/framing.js';
import { createDetector } from '../app/core/engine.js';
import { EXERCISES } from '../app/core/exercises/index.js';
import { makeSequence, baseSkeleton, _internal } from '../app/core/synth.js';
import { LM } from '../app/core/landmarks.js';

const SQUAT_GATE = EXERCISES.squat.gateLandmarks;
const shift = (sk, dy) => sk.map(p => ({ ...p, y: p.y + dy }));
// 出框裁切模型：真實相機看不到畫面外的東西，MediaPipe 對這些點的 visibility 會掉下來。
// synth 是純幾何（平移對相對量量測完全隱形），不加這個模型就永遠重現不出實機的掉線。
const clip = (sk, vis = 0.03) => sk.map(p => (p && !inFrame(p) ? { ...p, visibility: vis } : p));

/* ---------- framingReport：基本判定 ---------- */
test('framing: 乾淨站姿 → ok', () => {
  const r = framingReport(baseSkeleton(), { gateLandmarks: SQUAT_GATE });
  eq(r.ok, true, r.issue || '');
});

test('framing: 頭出畫面上緣 → too_close（Bug1(a) 主鎖）', () => {
  const r = framingReport(shift(baseSkeleton(), -0.20), { gateLandmarks: SQUAT_GATE });
  eq(r.ok, false);
  eq(r.issue, 'too_close');
  assert(/後退/.test(r.text), '訊息要告訴使用者「往後退」，而不是通用的入鏡不完整');
});

test('framing: 頭部可見度全滅（但在框內）→ no_head，與 too_close 分開', () => {
  const sk = baseSkeleton();
  for (const i of [LM.NOSE, LM.LEFT_EAR, LM.RIGHT_EAR]) sk[i] = { ...sk[i], visibility: 0.05 };
  const r = framingReport(sk, { gateLandmarks: SQUAT_GATE });
  eq(r.issue, 'no_head');
});

test('framing: requireHead=false 時不檢查頭部（保留 spec 覆寫能力）', () => {
  const sk = baseSkeleton();
  for (const i of [LM.NOSE, LM.LEFT_EAR, LM.RIGHT_EAR]) sk[i] = { ...sk[i], visibility: 0.05 };
  eq(framingReport(sk, { gateLandmarks: SQUAT_GATE, requireHead: false }).ok, true);
});

test('framing: gate 關節點出框 → too_close 且指名部位', () => {
  const sk = baseSkeleton();
  sk[LM.LEFT_KNEE] = { ...sk[LM.LEFT_KNEE], y: 1.25 };   // 膝蓋掉出畫面下緣
  const r = framingReport(sk, { gateLandmarks: SQUAT_GATE });
  eq(r.issue, 'too_close');
  assert(r.parts.includes('膝蓋'), '要講出是哪個部位出框');
});

test('framing: 太遠 → too_far', () => {
  const r = framingReport(_internal.transform(baseSkeleton(), { scale: 0.3 }), { gateLandmarks: SQUAT_GATE });
  eq(r.issue, 'too_far');
});

// —— 2026-08-29：too_far 改以「站立基準跨幅」判定 ——
// 起因（UI-PRMD 真人資料）：深蹲最低點的人體外框會縮到站立的一半以下
//（實測 span 0.67 → 0.29，低於 minSpan 0.30），逐幀判會在動作最深處誤判成「站太遠」，
// 影響 19.3% 的幀。與 needsHeadroom 當初改為「站姿驗一次」是同一個道理。
// 以下兩條把「修好了」與「沒修壞」同時鎖住。
test('framing: 有站立基準時，動作中途縮小的外框不得被誤判為太遠', () => {
  // scale 0.35 → span 0.283（實測），低於 minSpan 0.30；比例接近真人蹲底時的縮小幅度
  const small = _internal.transform(baseSkeleton(), { scale: 0.35 });
  const bare = framingReport(small, { gateLandmarks: SQUAT_GATE });
  eq(bare.issue, 'too_far', '前提：沒有基準時這種跨幅確實會被判太遠');
  const withBase = framingReport(small, { gateLandmarks: SQUAT_GATE, baselineSpan: 0.66 });
  eq(withBase.ok, true, `站立時距離足夠，蹲下不該被判太遠（實得 ${withBase.issue}）`);
});

test('framing: 站立基準本身就不足時，仍要判太遠（使用者真的走遠）', () => {
  const small = _internal.transform(baseSkeleton(), { scale: 0.3 });
  const r = framingReport(small, { gateLandmarks: SQUAT_GATE, baselineSpan: 0.24 });
  eq(r.issue, 'too_far', '基準也不足＝人真的離太遠，不得因為有基準就放行');
});

// 這條是 Bug1 的根因鎖：舊版只看 visibility，這種幀會被判「看得到人」而繼續辨識。
test('framing 回歸鎖: visibility 全 1 但座標在畫面外 → 仍判 too_close', () => {
  const sk = shift(baseSkeleton(), -0.20).map(p => ({ ...p, visibility: 1 }));
  eq(landmarkOk(sk[LM.NOSE]), false, 'visibility 高不代表在畫面內');
  eq(framingReport(sk, { gateLandmarks: SQUAT_GATE }).issue, 'too_close');
});

/* ---------- needsHeadroom：跳躍類的上緣留白（開始前的前置條件） ---------- */
test('framing: 跳躍類站姿貼著上緣 → no_headroom；有留白 → ok', () => {
  const tight = _internal.transform(baseSkeleton(), { scale: 1.06 });   // 頭幾乎貼上緣
  eq(framingReport(tight, { gateLandmarks: [], needsHeadroom: true }).issue, 'no_headroom');
  // headroom=0.18（互審校準：真人騰空高度 0.10~0.15 畫面高，門檻必須高於它才有安全邊際）
  const roomy = _internal.transform(baseSkeleton(), { scale: 0.7 });    // 上緣留白 0.21
  eq(framingReport(roomy, { gateLandmarks: [], needsHeadroom: true }).ok, true);
  // 邊界鎖：留白 0.13 落在「舊門檻 0.10 會放行、但真人騰空 0.10~0.15 會出框」的危險帶，必須擋下。
  // 沒有這條，把 headroom 調回 0.10 測試照樣會綠。
  const risky = _internal.transform(baseSkeleton(), { scale: 0.8, dy: -0.05 });
  eq(framingReport(risky, { gateLandmarks: [], needsHeadroom: true }).issue, 'no_headroom');
});

test('framing: needsHeadroom 只影響跳躍類，一般動作同一取景仍放行', () => {
  const tight = _internal.transform(baseSkeleton(), { scale: 1.06 });
  eq(framingReport(tight, { gateLandmarks: SQUAT_GATE }).ok, true);
});

test('framing: 腳貼近下緣 → no_footroom，訊息要講腳不是講頭頂', () => {
  const low = _internal.transform(baseSkeleton(), { scale: 0.75, dy: 0.19 });
  const r = framingReport(low, { gateLandmarks: [], needsHeadroom: true });
  eq(r.issue, 'no_footroom');
  assert(/腳/.test(r.text) && !/頭頂/.test(r.text), '問題在腳就不能叫使用者去處理頭頂空間');
});

// fail-open 修補：bodyBox 會把出框的點排除，若不另外攔下，「身體有一部分在畫面外」
// 會被算成「一個比較小、取景良好的人」而通過跨幅檢查。
//
// ⚠️ 2026-09-17 修正：「腳出下緣」有兩種成因，原本一律擋下，害得筆電放桌上無法使用
//    （實機回報「需要拉到很遠以及需要放在地上才能用」）。兩種情境現在分開處理，
//    以下兩條測試各鎖一邊 —— 只留其中一條的話，修好一邊就會弄壞另一邊。
test('framing: 人太近（頭或膝也出框）→ 仍要擋', () => {
  // 太近時最先出框的是頭與 gate 關節，這兩關本來就會攔下 —— 放行腳踝不會開後門。
  const headOut = baseSkeleton();
  for (const i of [LM.NOSE, LM.LEFT_EAR, LM.RIGHT_EAR]) headOut[i] = { ...headOut[i], y: -0.08 };
  for (const i of [LM.LEFT_ANKLE, LM.RIGHT_ANKLE]) headOut[i] = { ...headOut[i], y: 1.09 };
  assert(!framingReport(headOut, { gateLandmarks: SQUAT_GATE }).ok, '頭出框時不得放行');

  const kneeOut = baseSkeleton();
  for (const i of [LM.LEFT_KNEE, LM.RIGHT_KNEE]) kneeOut[i] = { ...kneeOut[i], y: 1.09 };
  for (const i of [LM.LEFT_ANKLE, LM.RIGHT_ANKLE]) kneeOut[i] = { ...kneeOut[i], y: 1.2 };
  const r = framingReport(kneeOut, { gateLandmarks: SQUAT_GATE });
  assert(!r.ok, '膝蓋是深蹲 gate 的必要點，出框時不得放行');
  assert(r.parts.includes('膝蓋'), `要指名是膝蓋，實得 [${r.parts}]`);
});

test('framing: 鏡頭放桌上、身體舒適入鏡、僅腳出下緣 → 放行（判定用不到腳踝）', () => {
  // 縮小並上移，模擬「站得夠遠、但桌面俯角把腳切掉」
  const sk = _internal.transform(baseSkeleton(), { scale: 0.80, dy: -0.06 });
  for (const i of [LM.LEFT_ANKLE, LM.RIGHT_ANKLE]) sk[i] = { ...sk[i], y: 1.09 };
  const r = framingReport(sk, { gateLandmarks: SQUAT_GATE });
  assert(r.ok,
    `腳踝不在深蹲 gate 內、squat.js 也有腳踝不可信時的替代算法，`
    + `取景關卡不該比判定更嚴。實得 ${r.issue}：${r.text}`);
});

test('framing: 判定真的需要腳踝時，腳出下緣仍要擋', () => {
  const sk = _internal.transform(baseSkeleton(), { scale: 0.80, dy: -0.06 });
  for (const i of [LM.LEFT_ANKLE, LM.RIGHT_ANKLE]) sk[i] = { ...sk[i], y: 1.09 };
  const r = framingReport(sk, { gateLandmarks: [...SQUAT_GATE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE] });
  assert(!r.ok, '腳踝列進 gate 就代表判定需要它，此時不得放行');
  assert(r.parts.includes('腳踝'), '要指名是腳踝');
});

test('framing: 腳從左右或上緣出框 → 一律擋（那不是桌面俯角造成的）', () => {
  const sk = _internal.transform(baseSkeleton(), { scale: 0.80, dy: -0.06 });
  for (const i of [LM.LEFT_ANKLE, LM.RIGHT_ANKLE]) sk[i] = { ...sk[i], x: 1.12, y: 0.9 };
  const r = framingReport(sk, { gateLandmarks: SQUAT_GATE });
  assert(!r.ok, '從側邊出框代表取景歪了，不在放行範圍內');
});

/* ---------- 軀幹穩定度（Bug2(a)：等抓準軀幹再開始） ---------- */
test('stability: 站著不動 → stable；軀幹尺度亂跳 → not stable', () => {
  const st = createStabilityTracker();
  let last;
  for (let i = 0; i < 20; i++) last = st.push(baseSkeleton());
  eq(last.stable, true, `穩定站姿應判 stable (cv=${last.cv})`);

  const jitter = createStabilityTracker();
  for (let i = 0; i < 20; i++) {
    const sk = baseSkeleton();
    const k = i % 2 ? 1.35 : 0.7;                       // 肩寬逐幀劇烈跳動＝骨架扭曲
    sk[LM.LEFT_SHOULDER] = { ...sk[LM.LEFT_SHOULDER], x: 0.5 - 0.08 * k };
    sk[LM.RIGHT_SHOULDER] = { ...sk[LM.RIGHT_SHOULDER], x: 0.5 + 0.08 * k };
    last = jitter.push(sk);
  }
  eq(last.stable, false, `亂跳的軀幹不該放行 (cv=${last.cv})`);
});

test('stability: 軀幹點不可信時清空視窗，不讓壞資料混進統計', () => {
  const st = createStabilityTracker();
  for (let i = 0; i < 20; i++) st.push(baseSkeleton());
  const sk = baseSkeleton();
  sk[LM.LEFT_HIP] = { ...sk[LM.LEFT_HIP], visibility: 0.1 };
  eq(st.push(sk).ready, false);
  eq(st.size, 0);
});

/* ---------- spec 契約鎖 ---------- */
test('開合跳 gate 不得含手腕、必須含髖（Bug2 P0 回歸鎖）', () => {
  const g = EXERCISES.jumpingjack.gateLandmarks;
  assert(Array.isArray(g), 'jumpingjack 必須顯式宣告 gateLandmarks，不能退回含手腕的 requiredLandmarks');
  assert(!g.includes(LM.LEFT_WRIST) && !g.includes(LM.RIGHT_WRIST), '手腕舉過頭必然出框，不可放進入鏡判定');
  assert(g.includes(LM.LEFT_HIP) && g.includes(LM.RIGHT_HIP), '髖要在 gate 內，畫面上的軀幹骨架才不會亂跳');
});

// 顏色語意不變量：紅＝真的做錯。乾淨動作的任何一幀都不該出現紅色，否則使用者只會看到
// 顏色亂跳、卻不知道哪裡錯（正是實機回報的「顏色沒有意義」）。
test('顏色語意: 乾淨動作全程不得出現紅色（四個動作）', () => {
  for (const id of Object.keys(EXERCISES)) {
    const det = createDetector(EXERCISES[id]);
    const seq = makeSequence(id, { reps: 3, variant: 'clean' });
    let t = 0;
    seq.frames.forEach((f) => {
      const res = det.update(f, t); t += seq.dtMs;
      if (res.visible === false) return;                    // 暖機幾幀本來就不可見
      const red = Object.entries(res.segments).filter(([, c]) => c === 'red').map(([k]) => k);
      assert(!red.length, `${id} 乾淨動作出現紅色段：${red.join(',')}（signal=${res.signal.toFixed(2)}）`);
    });
  }
});

// limb_desync 門檻 0.5→0.35 的邊界鎖：armP 與 legP 的正規化窗口不對齊，0.5 會把
// 「腳張開幅度中等但完全合格」的使用者每一下都判 block，而且給的提示是「手和腳要同時打開」，
// 與真正的問題不符。實測分界：踝距 1.33× 肩寬時，0.35 通過、0.5 每一下都 block。
test('開合跳: 腳張開 1.33× 肩寬（合格但不誇張）不得被判 limb_desync', () => {
  const narrow = (sk, k) => sk.map((p, i) => ([27, 28, 29, 30, 31, 32].includes(i)
    ? { ...p, x: 0.5 + (p.x - 0.5) * k } : p));
  const seq = makeSequence('jumpingjack', { reps: 5, variant: 'clean' });
  const det = createDetector(EXERCISES.jumpingjack);
  let t = 0;
  for (const f of seq.frames) { det.update(narrow(f, 0.85), t); t += seq.dtMs; }
  const s = det.summary();
  eq(s.faultCounts.limb_desync || 0, 0, '腳有確實張開超過肩寬，不該判手腳不同步');
  eq(s.validReps, 5, '應該正常計次');
});

test('顏色語意: 開合跳只揮手（真的做錯）時，紅色標在拖後腿的那一邊', () => {
  const det = createDetector(EXERCISES.jumpingjack);
  const seq = makeSequence('jumpingjack', { reps: 3, variant: 'armsonly' });
  let t = 0, sawRedLeg = false;
  for (const f of seq.frames) {
    const res = det.update(f, t); t += seq.dtMs;
    if (res.visible === false) continue;                    // 暖機幾幀的全紅是「看不到人」的佔位值
    if (res.segments.leftLeg === 'red') sawRedLeg = true;
    assert(res.segments.leftArm !== 'red', '手有動，不該把手標紅');
  }
  assert(sawRedLeg, '只揮手不張腳 → 腿要被標紅，使用者才知道要改什麼');
});

test('每個動作都有 phaseCues（Bug2(b)：使用者要知道下一步做什麼）', () => {
  for (const [id, ex] of Object.entries(EXERCISES)) {
    for (const k of ['READY', 'CONCENTRIC', 'TARGET', 'ECCENTRIC']) {
      assert(ex.phaseCues?.[k], `${id} 缺少 phaseCues.${k}`);
    }
  }
});

/* ---------- engine 端到端 ---------- */
// 2026-08-29：squat 的 torso_lean 已由 block 降為 advisory（真人 3D 驗證顯示該量會隨
// 鏡頭高度大幅漂移，不該有權取消有效次數；理由見 squat.js 的註解）。
// 但以下幾個測試守的是**引擎層機制**（unseen 記帳、repReason 的優先序），
// 需要一個 block 級 fault 才能驗證。故在測試內把嚴重度覆寫回 block ——
// 這是刻意的機制隔離，不代表正式設定，也不得反過來當成「深蹲該用 block」的依據。
const SQUAT_BLOCKING = {
  ...EXERCISES.squat,
  faultSeverity: { ...EXERCISES.squat.faultSeverity, torso_lean: 'block' },
};

const runSeq = (id, seq, opts) => {
  const det = createDetector(EXERCISES[id], opts);
  let t = 0, last;
  for (const f of seq.frames) { last = det.update(f, t); t += seq.dtMs; }
  return { s: det.summary(), last };
};

test('engine: 頭全程在畫面外 → 0 valid，且提示為 too_close（不是硬算下去）', () => {
  const seq = makeSequence('squat', { reps: 5, variant: 'clean', scale: 1.5, dy: -0.28 });
  const { s, last } = runSeq('squat', seq);
  eq(s.validReps, 0, '取景不合格就不該計次');
  eq(last.visible, false);
  eq(last.cue.key, 'too_close');
});

test('engine: 尺度不變性在「仍在框內」的近距離維持（1.06×）', () => {
  const seq = makeSequence('squat', { reps: 5, variant: 'clean', scale: 1.06 });
  eq(runSeq('squat', seq).s.validReps, 5, '框內的遠近差異不該影響計次');
});

// synth 保真度缺口：合成的開合跳手腕只舉到顱頂上方約 5% 身高，真人是 20%+（指尖 28%）。
// 不補這段校正，合成序列永遠重現不出實機「舉手→手腕出框」的情境。
// 做法：把「手腕高於肩」的那一段幅度放大 1.5 倍，讓峰值落在顱頂上方約 20% 身高。
// 註：armRaise 峰值本來就已經讓 armP clamp 到 1，放大後 progress 訊號不變 —— 只改幾何位置。
function realArmRaise(sk) {
  const shY = (sk[LM.LEFT_SHOULDER].y + sk[LM.RIGHT_SHOULDER].y) / 2;
  const lift = (p) => (p.y < shY ? { ...p, y: shY - (shY - p.y) * 1.5 } : p);
  const out = sk.map(p => ({ ...p }));
  for (const i of [LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.LEFT_ELBOW, LM.RIGHT_ELBOW]) out[i] = lift(out[i]);
  return out;
}

// Bug2 的核心回歸：舊 gate 含手腕，舉手出框 → 當幀判「看不到人」→ 整下被記成 half_rep。
test('engine 回歸鎖: 開合跳舉手時手腕出框，仍應正常計次', () => {
  const build = () => {
    const seq = makeSequence('jumpingjack', { reps: 5, variant: 'clean' });
    seq.frames = seq.frames.map(f => clip(realArmRaise(f)));   // 出框的點 visibility 掉到 0.03
    return seq;
  };
  const seq = build();
  assert(seq.frames.some(f => (f[LM.LEFT_WRIST].visibility ?? 1) < 0.4), '測試前提：手腕確實會出框');
  assert(seq.frames.every(f => (f[LM.LEFT_HIP].visibility ?? 1) >= 0.4), '前提：髖/肩/踝全程都在框內');

  // 逐幀跑，同時量「計次」與「偵測有沒有中斷」——後者才是使用者眼睛看到的症狀
  // （畫面翻成警告色、反饋消失、骨架亂跳）。
  // lost 只數「暖機之後」的中斷：頭幾幀 visStreak 還沒集滿本來就是 not visible，那不是 bug。
  const WARMUP = 6;
  const feed = (spec, opts) => {
    const d = createDetector(spec, opts);
    let t = 0, lost = 0, i = 0;
    for (const f of build().frames) { if (d.update(f, t).visible === false && i >= WARMUP) lost++; t += seq.dtMs; i++; }
    return { valid: d.summary().validReps, half: d.summary().faultCounts.half_rep || 0, lost };
  };

  const now = feed(EXERCISES.jumpingjack);
  eq(now.valid, 5, '手腕出框不該讓整下報銷');
  eq(now.half, 0, '不該被誤記成半程');
  eq(now.lost, 0, '修正後：舉手過頭時偵測不該中斷');

  // 對照組＝修正前的行為（gate 含手腕）。這條讓回歸鎖有意義：證明差異來自 gate，
  // 不是別的東西剛好讓它過。註：此合成序列的出框窗剛好落在動作峰值，abort 後下降段
  // 仍高於 targetEnter 而重新達標，所以「次數」僥倖沒掉 —— 但偵測確實中斷了，
  // 這正是使用者回報的「跳起來就辨識不到、反饋大亂」。
  const oldSpec = { ...EXERCISES.jumpingjack, gateLandmarks: EXERCISES.jumpingjack.requiredLandmarks };
  assert(feed(oldSpec).lost > 0, '對照組（修正前）應該出現偵測中斷');
});

// P0（互審發現）：把 requireHead 逐幀套在跳躍類動作上，等於用「頭」重演一次原本
// 「手腕出框 → 整下報銷」的 bug —— 騰空頂點時頭本來就會越過畫面上緣。
// 互審實測：額外騰空 0.12 畫面高時 valid 從 5/5 斷崖掉到 0/5（全 half_rep）。
test('engine 回歸鎖: 開合跳騰空時不得因為頭越過上緣而中止判定', () => {
  const hop = (sk, dy) => sk.map(p => ({ ...p, y: p.y - dy }));
  for (const h of [0.12, 0.20]) {                      // 真人騰空高度約 0.10~0.15 畫面高
    const seq = makeSequence('jumpingjack', { reps: 5, variant: 'clean' });
    const det = createDetector(EXERCISES.jumpingjack);
    let t = 0, lost = 0;
    seq.frames.forEach((f, i) => {
      const g = clip(hop(f, h * Math.sin(Math.PI * seq.meta[i].d)));   // 跳躍與動作深度同步
      if (det.update(g, t).visible === false && i >= 6) lost++;
      t += seq.dtMs;
    });
    eq(det.summary().validReps, 5, `騰空 ${h} 時應正常計次`);
    eq(lost, 0, `騰空 ${h} 時不該出現偵測中斷`);
  }
});

// 掉幀容忍：診斷實測「掉 1 幀就毀掉一下」的機率達 40%（落在下降段時會被重記成 half_rep）。
// 短暫掉幀的主要保護來自遲滯視窗（要 framingBadNeed 幀不合格才停），abortAfterMs 是第二道；
// 兩者的邊界分別由這條與下面「持續看不到人」那條各自鎖住。
const dropFrames = (seq, idx) => ({
  ...seq,
  frames: seq.frames.map((f, i) => (idx.includes(i) ? f.map(p => ({ ...p, visibility: 0.05 })) : f)),
});
test('engine: 動作中途短暫掉幀不應把那一下整個吞掉', () => {
  const seq = makeSequence('squat', { reps: 3, variant: 'clean' });
  const base = runSeq('squat', seq).s;
  eq(base.attempts, 3);
  // 凍結的語意（重要）：那一下仍然「成立、被計入 attempts」，但因為有幀沒看到，
  // 不給有效 —— 記成 unseen。凍結保住的是「不要被吞掉／不要被誤報成半程」，不是免驗放行。
  for (const idx of [[28, 29], [28, 29, 30]]) {
    const s = runSeq('squat', dropFrames(seq, idx)).s;
    eq(s.attempts, 3, `掉 ${idx.length} 幀：那一下仍應成立`);
    eq(s.faultCounts.unseen || 0, 1, `掉 ${idx.length} 幀：應誠實記成沒看清楚`);
    eq(s.faultCounts.half_rep || 0, 0, `掉 ${idx.length} 幀：不該被誤報成半程`);
  }
  // 邊界鎖：abortAfterMs=0（＝修正前「當幀就 abort」）會讓那一下憑空消失（attempts 少一次）。
  // 沒有這條，把 abortAfterMs 調小或刪掉測試照樣會綠（互審抓到的假陽性）。
  assert(runSeq('squat', dropFrames(seq, [28, 29, 30]), { abortAfterMs: 0 }).s.attempts < 3,
    '對照組（當幀就 abort）應該把那一下整個吞掉');
});

// 防作弊：凍結的幀等於「沒看到」，那段裡可能正好是姿勢跑掉的瞬間 —— 不能因為沒看到就給過。
// 這是「凍結」機制帶進來的風險，必須由 unseen 旗標擋住。
test('engine 防作弊: 錯誤發生的那幾幀剛好掉幀，不得把無效的一下升級成有效', () => {
  // 正面機位的彎腰：繞髖前傾使軀幹的畫面投影縮短，水平位置不動。
  // ⚠️ 舊版以 x += k 注入 —— 那是側傾。2026-08-28 判定改用投影長度比後，
  //   側傾不再觸發 torso_lean，故注入方式必須一併修正（見 docs/verification/）。
  // 2026-08-29：門檻由 0.86 改為 0.58（依 UI-PRMD 真人資料重新標定），且合成器的正常深蹲
  //   已加入自然前傾（投影比約 0.79），兩者相乘後 40° 不再足以觸發 —— 注入角度隨之上調。
  //   實測掃描（45/50/55/60/65°）皆為「有效 2、torso_lean 1、unseen 0」，取 55° 居中留餘裕。
  const lean = (f, deg) => {
    const o = f.map(p => ({ ...p }));
    const hipY = (o[LM.LEFT_HIP].y + o[LM.RIGHT_HIP].y) / 2;
    const k = Math.cos(deg * Math.PI / 180);
    for (const i of [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.NOSE, LM.LEFT_EAR, LM.RIGHT_EAR]) {
      o[i] = { ...o[i], y: hipY - (hipY - o[i].y) * k };
    }
    return o;
  };
  const seq = makeSequence('squat', { reps: 3, variant: 'clean' });
  // 找出第二下的達標幀，只在那兩幀彎腰（block 級 fault）
  const probe = createDetector(EXERCISES.squat);
  let t = 0; const peak = [];
  seq.frames.forEach((f) => { if (probe.update(f, t).phase === 'TARGET') peak.push(seq.frames.indexOf(f)); t += seq.dtMs; });
  const inject = [peak[2], peak[3]];
  const runBlocking = (sq) => {
    const det = createDetector(SQUAT_BLOCKING);
    let tt = 0;
    for (const f of sq.frames) { det.update(f, tt); tt += sq.dtMs; }
    return det.summary();
  };
  const withFault = { ...seq, frames: seq.frames.map((f, i) => (inject.includes(i) ? lean(f, 55) : f)) };
  const faulted = runBlocking(withFault);
  eq(faulted.validReps, 2, '前提：這個彎腰確實會讓那一下無效');
  eq(faulted.faultCounts.torso_lean || 0, 1);
  // 把「彎腰的那兩幀」變成看不到 —— 有效次數不得因此變多
  const hidden = dropFrames(withFault, inject);
  const s = runBlocking(hidden);
  eq(s.validReps, 2, '沒看到的那一下不該被升級成有效');
  eq(s.faultCounts.unseen || 0, 1, '應誠實記成沒看清楚');
});

// 遲滯窗內要「凍結」而不是「照算」：拿壞座標去評估會把雜訊灌進平滑緩衝與尺度 EMA。
test('engine: 遲滯窗內的壞幀被凍結，不把雜訊灌進判定', () => {
  const seq = makeSequence('squat', { reps: 3, variant: 'clean' });
  const BAD = [30, 31];
  const det = createDetector(EXERCISES.squat);
  let t = 0, before = null, during = [];
  seq.frames.forEach((f, i) => {
    // 讓髖部飛出畫面外（visibility 仍高）——正是 MediaPipe 對出框點的外插行為
    const frame = BAD.includes(i) ? f.map((p, j) => (j === LM.LEFT_HIP ? { ...p, y: -0.9 } : p)) : f;
    const res = det.update(frame, t); t += seq.dtMs;
    if (i === BAD[0] - 1) before = res.signal;
    if (BAD.includes(i)) during.push(res);
  });
  for (const r of during) {
    eq(r.signal, before, '凍結幀的訊號應維持前一幀，不受壞座標影響');
    eq(r.repCountedThisFrame, false, '凍結幀不得產生計次事件');
    eq(r.framing.issue, 'too_close', '凍結幀仍要回報原因，UI 才能提示');
  }
  const sum = det.summary();
  eq(sum.attempts, 3, '那一下仍應成立、不被吞掉');
  eq(sum.faultCounts.unseen || 0, 1, '有幀沒看到就誠實記下，不給有效');
});

test('engine: 持續看不到人（超過容忍時間）仍會中止週期', () => {
  const seq = makeSequence('squat', { reps: 3, variant: 'clean' });
  const gone = dropFrames(seq, [...Array(40).keys()].map(i => i + 20));
  const withAbort = runSeq('squat', gone).s;
  assert(withAbort.validReps < 3, '長時間消失不該還照算');
  // 邊界鎖：容忍時間拉到極大就不會中止（那一下會被凍結保留成 unseen 而非消失），
  // 證明這條測的真的是 abortAfterMs。
  const noAbort = runSeq('squat', gone, { abortAfterMs: 6e4 }).s;
  assert(noAbort.attempts > withAbort.attempts, 'abortAfterMs 應該是決定中止與否的那個參數');
  eq(noAbort.faultCounts.unseen || 0, 1);
});

// P0（互審發現）：連續計數式的遲滯會被抖動完全繞過 —— 壞幀只要不連續就永遠不會停，
// 而那正是「站在太近的臨界、頭在畫面上緣進進出出」的樣態，也就是 Bug1 的主場景。
test('engine: 一好一壞交替的取景（50% 壞幀）必須停止判定', () => {
  const seq = makeSequence('squat', { reps: 5, variant: 'clean' });
  // -0.45：深蹲時上半身會下沉約 0.27，位移不夠大的話「壞幀」在蹲低時頭又回到框內而變成好幀。
  // 這個量確保交替的那一半幀「全程」頭都在畫面外，才是真正的 50% 壞幀。
  const bad = (f) => shift(f, -0.45);
  const det = createDetector(EXERCISES.squat);
  let t = 0, lost = 0;
  seq.frames.forEach((f, i) => {
    if (det.update(i % 2 ? bad(f) : f, t).visible === false) lost++;
    t += seq.dtMs;
  });
  assert(lost > seq.frames.length * 0.5, `50% 壞幀卻幾乎全程判定為看得到人＝ Bug1 主場景沒關上（lost=${lost}/${seq.frames.length}）`);
  eq(det.summary().validReps, 0, '取景在臨界抖動時不該照常計次');
});

/* ---------- 拒絕原因必須誠實（使用者提問：不給過會不會提醒？） ---------- */
// 根因鎖：一下是在「回到起始位置」時才結算，那時瞬間發生的錯誤已經消失。
// 若 UI 讀「當下這一幀的 faults」，瞬間彎腰/掉幀都會退回顯示「半程未達標」——
// 使用者蹲夠深了卻被告知沒蹲夠，會照著錯的方向改。
test('repReason: 瞬間發生的錯誤不得被誤報成「半程未達標」', () => {
  // 正面機位的彎腰：繞髖前傾使軀幹的畫面投影縮短，水平位置不動。
  // ⚠️ 舊版以 x += k 注入 —— 那是側傾。2026-08-28 判定改用投影長度比後，
  //   側傾不再觸發 torso_lean，故注入方式必須一併修正（見 docs/verification/）。
  // 2026-08-29：門檻由 0.86 改為 0.58（依 UI-PRMD 真人資料重新標定），且合成器的正常深蹲
  //   已加入自然前傾（投影比約 0.79），兩者相乘後 40° 不再足以觸發 —— 注入角度隨之上調。
  //   實測掃描（45/50/55/60/65°）皆為「有效 2、torso_lean 1、unseen 0」，取 55° 居中留餘裕。
  const lean = (f, deg) => {
    const o = f.map(p => ({ ...p }));
    const hipY = (o[LM.LEFT_HIP].y + o[LM.RIGHT_HIP].y) / 2;
    const k = Math.cos(deg * Math.PI / 180);
    for (const i of [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.NOSE, LM.LEFT_EAR, LM.RIGHT_EAR]) {
      o[i] = { ...o[i], y: hipY - (hipY - o[i].y) * k };
    }
    return o;
  };
  const seq = makeSequence('squat', { reps: 3, variant: 'clean' });
  const probe = createDetector(EXERCISES.squat);
  let t = 0; const peak = [];
  seq.frames.forEach((f, i) => { if (probe.update(f, t).phase === 'TARGET') peak.push(i); t += seq.dtMs; });
  const inject = [peak[2], peak[3]];

  const reasonsOf = (frames) => {
    const det = createDetector(SQUAT_BLOCKING);
    let tt = 0; const out = [];
    for (const f of frames) {
      const r = det.update(f, tt); tt += seq.dtMs;
      if (r.repCountedThisFrame && !r.repValidThisFrame) out.push(r.repReason);
    }
    return out;
  };
  // 只在最深處彎腰 → 原因要是 torso_lean，不是 half_rep
  const leaned = seq.frames.map((f, i) => (inject.includes(i) ? lean(f, 55) : f));
  eq(reasonsOf(leaned)[0], 'torso_lean', '蹲夠深了卻被說沒蹲夠，使用者會照錯的方向改');
  // 那幾幀剛好掉幀 → 原因要是 unseen
  const hidden = leaned.map((f, i) => (inject.includes(i) ? f.map(p => ({ ...p, visibility: 0.05 })) : f));
  eq(reasonsOf(hidden)[0], 'unseen');
});

test('repReason: 真的沒做到底時才回報 half_rep', () => {
  const det = createDetector(EXERCISES.squat);
  const seq = makeSequence('squat', { reps: 3, variant: 'half' });
  let t = 0; const reasons = [];
  for (const f of seq.frames) {
    const r = det.update(f, t); t += seq.dtMs;
    if (r.repCountedThisFrame && !r.repValidThisFrame) reasons.push(r.repReason);
  }
  assert(reasons.length >= 2, '半程動作應該有結算事件');
  assert(reasons.every(x => x === 'half_rep'), `實得 ${reasons}`);
});

test('repReason: 持續性的錯誤（塌腰／手腳不同步）指名該錯誤', () => {
  for (const [id, variant, want] of [['pushup', 'sag', 'sag'], ['jumpingjack', 'armsonly', 'limb_desync']]) {
    const det = createDetector(EXERCISES[id]);
    const seq = makeSequence(id, { reps: 3, variant });
    let t = 0; const reasons = [];
    for (const f of seq.frames) {
      const r = det.update(f, t); t += seq.dtMs;
      if (r.repCountedThisFrame && !r.repValidThisFrame) reasons.push(r.repReason);
    }
    assert(reasons.length > 0, `${id}/${variant} 應有結算事件`);
    assert(reasons.every(x => x === want), `${id}/${variant} 實得 ${reasons}`);
  }
});

// 沒有逐下結算事件的作弊（坐姿抬腿：週期根本不成立），必須靠過程中的持續提示告知，
// 否則使用者做半天完全不知道為什麼沒有計次。
// 坐著交替抬膝（藏住支撐腳沒打直這件事）必須擋下，而且要讓使用者知道原因。
//
// ⚠️ 2026-09-17：本測試原本斷言 `repCountedThisFrame === 0`，那是在鎖「這個作弊連一次
//    嘗試都構不成」的**附帶前提**，不是它真正要保障的事。抬膝量測改為大腿投影縮短率後，
//    坐姿抬腿會構成一次嘗試、再被 no_support 擋下 —— 使用者因此拿到「0 有效 / N 無效
//    ＋ 原因」，比原本的靜默失敗更好。故本測試改鎖真正的意圖：
//      (1) 一次都不得計為有效　(2) 必須持續告知原因
test('坐著抬腿的作弊：不得計為有效，且必須持續告知原因', () => {
  const det = createDetector(EXERCISES.highknees);
  const seq = makeSequence('highknees', { reps: 4, variant: 'sitting' });
  let t = 0, valid = 0, supportCues = 0;
  for (const f of seq.frames) {
    const r = det.update(f, t); t += seq.dtMs;
    if (r.repValidThisFrame) valid++;
    if (r.cue?.key === 'no_support') supportCues++;
  }
  const s = det.summary();
  eq(valid, 0, '坐著抬腿一次都不得計為有效');
  eq(s.validReps, 0, `summary 的有效次數也必須是 0，實得 ${s.validReps}`);
  assert((s.faultCounts?.no_support ?? 0) > 0, '必須記錄 no_support 為無效原因');
  assert(supportCues > 20, `必須持續提示使用者原因，實得 ${supportCues} 幀`);
});

/* ---------- 「高抬腿同類」全動作稽核後補的修正 ---------- */

// 伏地挺身是唯一側面拍的動作，遠側肢體必然被身體擋住。
// 舊版要求左右兩側全部看得見 → 遠側可見度掉到 0.4 以下就整場停擺（實測 0/4、144 幀中斷）。
test('伏地挺身: 側面拍時遠側肢體被擋住，仍應正常計次（gatePairs）', () => {
  const FAR = [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST, LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE];
  const occludeFar = (seq, v) => ({ ...seq, frames: seq.frames.map(f => f.map((p, i) => (FAR.includes(i) ? { ...p, visibility: v } : p))) });
  for (const v of [0.35, 0.15, 0.05]) {
    const clean = runSeq('pushup', occludeFar(makeSequence('pushup', { reps: 4, variant: 'clean' }), v));
    eq(clean.s.validReps, 4, `遠側可見度 ${v}：乾淨動作應正常計次`);
    // 防作弊零損失：sag 用肩/髖/踝中點算，遠側被擋住時仍擋得下塌腰
    const sag = runSeq('pushup', occludeFar(makeSequence('pushup', { reps: 4, variant: 'sag' }), v));
    eq(sag.s.validReps, 0, `遠側可見度 ${v}：塌腰仍必須擋下`);
    assert((sag.s.faultCounts.sag || 0) > 0, `遠側可見度 ${v}：要記錄 sag`);
  }
});

test('伏地挺身 gatePairs 契約：五對關節、每對至少一側即可', () => {
  const pairs = EXERCISES.pushup.gatePairs;
  assert(Array.isArray(pairs) && pairs.length === 5, '側面拍的動作必須宣告 gatePairs');
  assert(pairs.every(p => p.length === 2), '每項都要是左右一對');
});

// 指引方向必須跟成因對應，否則使用者照著調只會愈調愈錯。
test('framing: 整個半身看不到 → turned_away（叫他正對鏡頭，不是叫他調鏡頭高低）', () => {
  const sk = baseSkeleton().map((p, i) => ([LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.RIGHT_KNEE].includes(i)
    ? { ...p, visibility: 0.1 } : p));
  const r = framingReport(sk, { gateLandmarks: SQUAT_GATE });
  eq(r.issue, 'turned_away');
  assert(/正對鏡頭/.test(r.text) && !/放低/.test(r.text), '側身站叫他「把鏡頭放低」完全沒用');
});

test('framing: 只缺單一部位仍是 missing（不該一有缺件就說側身）', () => {
  const sk = baseSkeleton();
  sk[LM.RIGHT_KNEE] = { ...sk[LM.RIGHT_KNEE], visibility: 0.1 };
  eq(framingReport(sk, { gateLandmarks: SQUAT_GATE }).issue, 'missing');
});

// 高抬腿跟開合跳同類：原地彈跳，取景太緊時頭會衝出上緣。
test('高抬腿: 需要上緣留白（與開合跳同類）', () => {
  eq(EXERCISES.highknees.needsHeadroom, true);
  const tight = _internal.transform(baseSkeleton(), { scale: 1.0 });
  eq(framingReport(tight, { gateLandmarks: EXERCISES.highknees.gateLandmarks, needsHeadroom: true }).issue, 'no_headroom');
});

test('彈跳類動作: 從通過關卡的取景起算，騰空 0.15 畫面高仍零中斷', () => {
  const clip = (sk) => sk.map(p => (p && !inFrame(p) ? { ...p, visibility: 0.03 } : p));
  for (const id of ['highknees', 'jumpingjack']) {
    const seq = makeSequence(id, { reps: 4, variant: 'clean' });
    const det = createDetector(EXERCISES[id]);
    let t = 0, lost = 0;
    seq.frames.forEach((f0, i) => {
      const hop = 0.15 * Math.sin(Math.PI * seq.meta[i].d);
      const f = clip(_internal.transform(f0, { scale: 0.75 }).map(p => ({ ...p, y: p.y - hop })));
      if (det.update(f, t).visible === false && i >= 6) lost++;
      t += seq.dtMs;
    });
    eq(lost, 0, `${id}: 騰空時不該中斷`);
    eq(det.summary().validReps, 4, `${id}: 騰空時應正常計次`);
  }
});

// 提示方向錯誤會害人：用彎腰代替下蹲的人被告知「再往下蹲」，只會彎得更厲害。
test('repReason: 做不到底但同時有 block 級錯誤時，回報那個錯誤而不是「半程」', () => {
  const det = createDetector(SQUAT_BLOCKING);
  const seq = makeSequence('squat', { reps: 4, variant: 'compensation' });
  let t = 0; const reasons = [];
  for (const f of seq.frames) {
    const r = det.update(f, t); t += seq.dtMs;
    if (r.repCountedThisFrame && !r.repValidThisFrame) reasons.push(r.repReason);
  }
  assert(reasons.length > 0, '彎腰代償應有結算事件');
  assert(reasons.every(x => x === 'torso_lean'), `該說「背打直」而不是「再往下蹲」，實得 ${reasons}`);
});

// 全動作迴歸：正常取景下四個動作都不得有任何偵測中斷
test('全動作迴歸: 正常取景零中斷、乾淨動作全計次', () => {
  for (const id of Object.keys(EXERCISES)) {
    const seq = makeSequence(id, { reps: 4, variant: 'clean' });
    const det = createDetector(EXERCISES[id]);
    let t = 0, lost = 0, unseen = 0;
    seq.frames.forEach((f, i) => { if (det.update(f, t).visible === false && i >= 6) lost++; t += seq.dtMs; });
    unseen = det.summary().faultCounts.unseen || 0;
    eq(lost, 0, `${id}: 正常取景不該中斷`);
    eq(unseen, 0, `${id}: 正常取景不該有「沒看清楚」的誤判`);
    eq(det.summary().validReps, 4, `${id}: 應全數計次`);
  }
});

/* ---------- 桌面機位：腳在畫面外仍應正常計次（實機回報「偷扣次數」的成因） ---------- */

// 實機回報：「需要拉到很遠以及需要放在地上才能使用」「明明做對一下卻偷扣使用者次數」。
// 這兩件事是同一個成因：筆電放桌上時，站姿的腳會落在畫面下緣之外。
// 舊版 framing.js 的 CORE_LANDMARKS 硬性要求腳踝在框內 → 每一幀 report.ok 都是 false
// → 引擎把進行中的每一下都標記 unseen → 全部判為無效。
// 使用者看到的就是「我明明蹲對了，次數卻不算」。
test('桌面機位: 腳踝在畫面下緣外，深蹲仍應正常計次', () => {
  const seq = makeSequence('squat', { reps: 3, variant: 'clean' });
  // 把整個人往下移，讓腳踝落到畫面外（模擬鏡頭放在桌上、俯角切掉腳）
  const desk = {
    ...seq,
    frames: seq.frames.map(f => f.map((p, i) => (
      [LM.LEFT_ANKLE, LM.RIGHT_ANKLE, LM.LEFT_HEEL, LM.RIGHT_HEEL,
        LM.LEFT_FOOT_INDEX, LM.RIGHT_FOOT_INDEX].includes(i)
        ? { ...p, y: p.y + 0.22 }        // 推到 y > 1
        : p))),
  };
  const outOfFrame = desk.frames[0][LM.LEFT_ANKLE].y;
  assert(outOfFrame > 1.02, `前提：腳踝要真的在畫面外，實得 y=${outOfFrame.toFixed(3)}`);

  const s = runSeq('squat', desk).s;
  eq(s.validReps, 3,
    `腳踝不在深蹲的 gate 內、squat.js 也有腳踝不可信時的替代算法，`
    + `不該因為腳出畫面就把每一下都作廢。實得有效 ${s.validReps}、無效 ${s.invalidReps}、`
    + `unseen ${s.faultCounts?.unseen || 0}`);
  eq(s.faultCounts?.unseen || 0, 0, '不該有任何一下被記成「沒看清楚」');
});

test('桌面機位: 判定真的需要腳踝的動作，腳出框時仍應停止判定（不得一併放寬）', () => {
  // 高抬腿的支撐腳檢查會用到腳踝，但它是非 gate 點（看不清時走替代路徑），
  // 故這裡改用「把腳踝列進 gate」的方式驗證放寬沒有波及到真的需要腳踝的情形。
  const sk = _internal.transform(baseSkeleton(), { scale: 0.80, dy: -0.06 });
  for (const i of [LM.LEFT_ANKLE, LM.RIGHT_ANKLE]) sk[i] = { ...sk[i], y: 1.09 };
  const withAnkle = framingReport(sk, { gateLandmarks: [...SQUAT_GATE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE] });
  assert(!withAnkle.ok, '腳踝列進 gate 時必須維持原本的嚴格判定');
});

/* ---------- 鏡頭高度粗估（只提醒，不擋人、不調門檻） ---------- */
test('cameraHint: 頭肩段比例偏低 → 提醒鏡頭偏高', () => {
  const sk = baseSkeleton();
  const sc = { x: (sk[LM.LEFT_SHOULDER].x + sk[LM.RIGHT_SHOULDER].x) / 2,
    y: (sk[LM.LEFT_SHOULDER].y + sk[LM.RIGHT_SHOULDER].y) / 2 };
  const hc = { x: (sk[LM.LEFT_HIP].x + sk[LM.RIGHT_HIP].x) / 2,
    y: (sk[LM.LEFT_HIP].y + sk[LM.RIGHT_HIP].y) / 2 };
  const torso = Math.hypot(sc.x - hc.x, sc.y - hc.y);
  // 把鼻子壓到離肩很近（＝俯角大、頭肩段被壓扁）
  sk[LM.NOSE] = { ...sk[LM.NOSE], x: sc.x, y: sc.y - torso * 0.30 };
  const r = cameraHeightHint(sk);
  assert(r.high, `頭肩比 ${r.ratio?.toFixed(3)} 應判為鏡頭偏高`);
  assert(/放低|後站|遠/.test(r.text), '提醒必須給出可執行的動作');
});

test('cameraHint: 正常機位不得誤報', () => {
  const sk = baseSkeleton();
  const sc = { x: (sk[LM.LEFT_SHOULDER].x + sk[LM.RIGHT_SHOULDER].x) / 2,
    y: (sk[LM.LEFT_SHOULDER].y + sk[LM.RIGHT_SHOULDER].y) / 2 };
  const hc = { x: (sk[LM.LEFT_HIP].x + sk[LM.RIGHT_HIP].x) / 2,
    y: (sk[LM.LEFT_HIP].y + sk[LM.RIGHT_HIP].y) / 2 };
  const torso = Math.hypot(sc.x - hc.x, sc.y - hc.y);
  sk[LM.NOSE] = { ...sk[LM.NOSE], x: sc.x, y: sc.y - torso * 0.43 };   // 約 750mm 機位的實測值
  const r = cameraHeightHint(sk);
  assert(!r.high, `頭肩比 ${r.ratio?.toFixed(3)}（約對應 750mm）不該被提醒`);
  eq(r.text, '');
});

test('cameraHint: 關節點不可信時回報 null，不得瞎猜', () => {
  const sk = baseSkeleton();
  sk[LM.NOSE] = { ...sk[LM.NOSE], visibility: 0.05 };
  const r = cameraHeightHint(sk);
  eq(r.ratio, null);
  eq(r.high, false, '量不到就不要提醒');
});
