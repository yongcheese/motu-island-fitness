// 邏輯層：通用動作狀態機 + 六層防作弊 + 計次冷卻。瀏覽器 + Node 共用。
import { bodyScale } from './normalize.js';

// 下蹲:上升的最小時間比。低於此值代表下放太快（沒有控制離心）。依據見 classify() 內註解。
//
// ⚠️ 本值不等於文獻的 2:1 —— 引擎量到的是「動作開始（attemptEnter）→最深處」與
//    「最深處→動作結束（readyReturn）」，兩端各被門檻截掉一段，故測得的比值
//    **系統性地小於真實比值**。合成器實測：真實幀數比 2.0 時引擎測得約 1.875，
//    真實 3.0 時測得約 3.08。
//    因此取 1.7 作為引擎基準的門檻，約對應真實的 2:1，避免誤報節奏正常的使用者。
// ⚠️ 此值仍為工程判斷，未經真人標定。真人標定時應直接採用引擎的量測基準，
//    偏差會自動被吸收，不需再換算。
export const TEMPO_MIN_RATIO = 1.7;
import { framingReport } from './framing.js';
import { LM } from './landmarks.js';
import { distance as dist2 } from './geometry.js';

const SEG_KEYS = ['torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
const sevRank = { green: 0, yellow: 1, red: 2 };

// 單一訊號的週期追蹤器：READY→CONCENTRIC→TARGET→ECCENTRIC→(close)
class CycleTracker {
  constructor(th) { this.th = th; this.reset(); }
  reset() { this.active = false; this.reachedTarget = false; this.atTarget = false; this.phase = 'READY'; }
  abort() { this.reset(); }
  step(sig) {
    let justStarted = false, justClosed = false;
    this.atTarget = false;
    if (!this.active) {
      if (sig >= this.th.attemptEnter) { this.active = true; this.reachedTarget = false; justStarted = true; this.phase = 'CONCENTRIC'; }
      else this.phase = 'READY';
    }
    if (this.active) {
      if (sig >= this.th.targetEnter) { this.reachedTarget = true; this.atTarget = true; this.phase = 'TARGET'; }
      else this.phase = this.reachedTarget ? 'ECCENTRIC' : 'CONCENTRIC';
      if (sig <= this.th.readyReturn) { justClosed = true; this.active = false; this.phase = 'READY'; }
    }
    return { justStarted, justClosed, reachedTarget: this.reachedTarget, atTarget: this.atTarget, phase: this.phase };
  }
}

// unseen：這一下進行中「沒被判定到」的幀（取景壞掉而凍結、或看不到人）。
// 有漏看就不能無條件給過 —— 那些幀裡可能正好藏著姿勢錯誤。
//
// ⚠️ 2026-09-17：原本是布林值，**只要有任何一幀漏看，整下就作廢**。
//    實機回報「明明做對一下卻偷扣使用者次數」的主因就在這裡：
//    真實使用中關節可見度會因動態模糊短暫掉到門檻以下，掉個一兩幀是常態，
//    而那樣就會讓一次完全正確的動作變成無效。
//    改為依**漏看發生在哪裡**判定。
//
// 關鍵區分：姿勢錯誤幾乎都發生在動作的深處（各 spec 的 fault 檢查也多半只在
// progress 高於某個值時才生效）。因此：
//   · 漏看落在**關鍵窗**（訊號接近達標）→ 無法查證那一下有沒有做錯 → 不給有效
//   · 漏看落在動作頭尾（訊號低）→ 那裡本來就沒有東西要查 → 可以容忍
// 再加上整體比例與連續長度兩道上限當保險。
//
// 這個區分是有實據的：防作弊測試「錯誤發生的那幾幀剛好掉幀」注入的正是達標幀，
// 落在關鍵窗內，仍會被擋下；而使用者回報被偷扣的情境是動作尾段掉一兩幀，落在窗外。
// 關鍵窗取**絕對訊號值**而非 targetEnter 的倍數。
// 理由：各 spec 的 fault 檢查多半從 progress≈0.15 就開始生效，若照那個範圍算，
// 幾乎整下都是關鍵窗，等於沒有放寬。真正非看不可的是**最深處** ——
// 深度達標與最嚴重的姿勢代償都發生在那裡；離峰值還有一段距離的幀，
// 漏看一兩幀不影響能否查證這一下。
// 實測（合成深蹲，3 次）：最深處(訊號 0.99/0.90)掉幀仍判無效；
// 動作尾段(0.43/0.34)與起始段(0.04)掉幀則放行。
const UNSEEN_CRITICAL = 0.85;
const UNSEEN_MAX_RATIO = 0.25;   // 漏看幀數佔該次動作的比例上限
const UNSEEN_MAX_RUN = 4;        // 最長連續漏看幀數（30fps 下約 0.13 秒）
function makeTrack(th) {
  return {
    tk: new CycleTracker(th), faults: new Set(), peakSig: -1, gateAtPeak: true, buf: [],
    unseenCount: 0, unseenRun: 0, unseenMaxRun: 0, seenCount: 0, unseenCritical: 0, lastSig: 0,
    // 節奏量測：下蹲（起始→最深處）與上升（最深處→回到起始）各花多久。
    // 屬時序特徵，不受機位影響 —— 這是少數在正面機位也完全可靠的量。
    tStart: null, tPeak: null,

  };
}

export function createDetector(spec, opts = {}) {
  const cfg = {
    visMin: 0.4,          // layer2 入鏡判定門檻（gate 已只看核心點，故維持 0.4 兼顧寬鬆與抗噪；末端點出框由 gateLandmarks 處理）
    smooth: 5,            // layer3 移動平均視窗
    visStreakNeed: 2,     // 連續 N 幀「取景合格」才開始判定（2：短暫遮擋後更快恢復，仍擋單幀誤偵測）
    // layer6 動態冷卻：兩次計次的最小間隔，擋機械式快速抖動。
    // ⚠️ 300 為工程判斷，無任何外部依據或參照。
    //   曾引「美軍 FM 7-22 節奏 slow 50／moderate 80 counts/min」作為寬鬆度參照，
    //   但官方 PDF 查證時回傳 404，該數字實出自考試準備網站，無法驗證，該論證已撤回。
    // ⚠️ 舊版曾以「0.6 秒為人類動作節奏下限」描述此類門檻——該說法為撰寫時自行加上、
    //   無任何來源，已於 2026-08-25 移除。不得再以類似說法描述本值。
    cooldownMs: 300,
    // 取景遲滯用「滾動視窗合格率」，不用連續計數。
    // 連續計數會被抖動完全繞過：只要壞幀不連續，單一合格幀就把計數歸零 —— 互審實測「每 2 幀壞 1 幀」
    // （50% 壞幀）時 visible 全程為 true、照常計次，而那正是「站在太近的臨界、頭在畫面上緣進出」
    // 的典型樣態，也就是 Bug1 的主場景。改成：最近 framingWindow 幀內有 framingBadNeed 幀不合格就停。
    framingWindow: 12,    // ≈0.4s @30fps
    framingBadNeed: 3,    // 同時涵蓋「連續 3 幀壞」與「25% 壞幀率」兩種樣態
    // 短暫掉幀不中止進行中的一下：診斷實測「掉 1 幀就毀掉整下」的機率達 40%（落在下降段時
    // 會被重新記成 half_rep，直接拉低有效率）。
    // 這個值必須大於「視窗排空時間」（framingWindow 幀 ≈ 400ms @30fps），否則形同虛設 ——
    // 壞幀會在視窗裡停留整個 framingWindow，visible 一直是 false，abort 必定先觸發。
    // 實測：250ms 與 0 的結果完全相同（都掉一次計次），400ms 起才真的保住那一下。
    // 安全性：躲出畫面無法用來跳過動作最深處 —— 週期在不可見期間凍結、不推進，
    // 沒有可信幀達標的話那一下最後會被記成 half_rep 而非有效（互審已實測驗證）。
    // 注意：visible=false 仍當幀回報（HUD/語音要即時說「看不到你」），只有「abort 週期」被延後。
    abortAfterMs: 500,
    ...opts,
  };
  // 入鏡判定只看「核心關節點」(gateLandmarks)；末端點(如腳踝)出框不該讓整個判定停擺。
  // 動作仍以各自 evaluate 計算；未指定 gateLandmarks 時退回完整 requiredLandmarks。
  const gateLandmarks = spec.gateLandmarks || spec.requiredLandmarks;
  const th = spec.thresholds;
  const alt = spec.mode === 'alternating';
  const tracks = alt ? { L: makeTrack(th), R: makeTrack(th) } : { C: makeTrack(th) };

  let validReps = 0, invalidReps = 0, attempts = 0;
  const faultCounts = {};
  // advisory：觀察到但「不取消有效次數」的姿勢提醒。與 faultCounts 分開統計，
  // 因為後者的語意是「這一下為何無效」——把不阻擋的項目混進去會讓結算的無效原因失真。
  // 用途：門檻尚未由真人樣本標定的規則（如深蹲膝內夾），先提示不阻擋，標定後再決定是否升格。
  const advisoryCounts = {};
  // 頂點伸展的追蹤。刻意放在動作週期**之外** ——
  // 週期由 attemptEnter 起、readyReturn 止，而「手臂完全伸直」是 READY 的起始姿勢，
  // 位於兩次動作之間，週期內根本觀察不到（實測週期內肘角僅 104–146°，永不及 160°）。
  let lockoutSeen = false;      // 自上次動作結束以來，是否見過完全伸展的一幀
  let lockoutPending = false;   // 有一次動作已結束，等下次開始時回頭判定
  // 「上一次動作」層級的提示佇列。
  // tempo_fast 與 no_lockout 都是**整次動作結算後**才知道的判定（要比較兩段耗時、
  // 要看動作之間有沒有伸直），無法像姿勢類 fault 那樣逐幀產生。
  // 若只寫進結算統計，使用者在訓練當下完全聽不到 —— 而本作品的核心是「做錯當下就糾正」，
  // 事後才知道等於沒糾正。故在下一次動作期間持續提示，直到該次結束。
  let pendingCue = null;
  // ⚠️ 這兩個是 detector 層級的單一狀態，**不支援交替動作**（alt = 有 L/R 兩條 track）。
  //    交替時一側結束的瞬間另一側往往已開始，active 恆為 true，lockoutSeen 永遠更新不到，
  //    會導致全數誤報。目前唯一的交替動作 highknees 未使用本功能，故無實害。
  //    若日後要為交替動作加上此判定，必須改為 per-track 狀態 —— 有測試鎖住這個前提。
  if (spec.checksLockout && alt) {
    console.warn('[engine] checksLockout 目前不支援交替動作，將導致誤報。需改為 per-track 狀態。');
  }
  let lastCountTime = -1e9, lastSide = null, visStreak = 0;
  // 交替動作的第一下沒有前例可比，只能先放行（否則每組都會冤枉第一下）。
  // 但「一直抬同一隻腳」的作弊也是從這一下開始的，所以先記著它是「未經交替證實」的，
  // 等下一下揭曉：真的換邊 → 證實有效；又是同一邊 → 回溯撤銷（見 classify）。
  let unconfirmedFirstAlt = false, prevAttemptSide = null;
  let framingWin = [], lostSinceMs = null;   // framingWin：最近數幀「是否不合格」(1/0)
  let lastResult = idleResult();
  // 取景要求：頭部一律要看得到（Bug1(a)），可由 spec 覆寫。
  // 刻意「不」在這裡驗 needsHeadroom —— 上緣留白是「開始訓練前」的前置條件（由 waitForFraming
  // 在站姿時驗一次），不是每幀條件；跳到最高點時人本來就會貼近上緣，逐幀驗會把每一下都判失敗。
  const framingOpts = {
    gateLandmarks, gatePairs: spec.gatePairs || [], visMin: cfg.visMin,
    requireHead: spec.requireHead !== false,
  };

  // 尺度正規化做 EMA：身形尺寸本不該逐幀劇變，平滑分母可大幅穩定 progress、減少誤判。
  // 位置(center)仍取當幀，身體移動才跟得上。
  let scaleEma = null;
  // 站立基準軀幹投影長：偵測矢狀面前傾用。
  // 為何不能沿用 scaleEma：其 a=0.12，半衰期約 5 幀，彎腰持續一秒基準就跟著縮短，
  // 比值恆為 1，等於量不到。故另立一個「只在身體直立時才更新」的基準。
  let standTorso = null;
  // 站立基準人體跨幅：判「離鏡頭太遠」用。與 standTorso 同一個道理 ——
  // 深蹲/伏地挺身會讓當幀跨幅大幅縮小，逐幀判距離會在動作最深處誤判成「站太遠」。
  // （UI-PRMD 真人實測：站立 0.67 → 蹲底 0.29，minSpan 0.30，19.3% 的幀因此停止判定）
  let standSpan = null;
  // 站立基準「大腿投影長」（左右各一）：高抬腿判抬膝高度用。
  // 為何需要它：抬膝的高低關係（膝相對髖）隨鏡頭高度嚴重漂移 —— UI-PRMD 實測，
  // 同一批動作的峰值由地板機位的 +0.323 掉到 1000mm 的 **−0.008**（數值翻負，
  // 等於在桌面高度以上永遠判定不到抬膝）。改量「大腿投影縮短率」：抬腿時大腿轉向鏡頭，
  // 其畫面投影隨之縮短。同一批資料實測五機位僅衰減 12%、逐段 CV 0.032。
  // 與 standTorso 同理，只在身體直立、動作尚未展開時更新。
  let standThigh = null;
  // 站立基準「髖、膝高度」與「大腿投影長（未正規化）」：深蹲的朝向不變深度訊號用（2026-09-25）。
  // 下降量 = [(當幀髖 y − 站立髖 y) − (當幀膝 y − 站立膝 y)] ÷ 站立大腿長。
  // 與「同幀髖 vs 膝」不同：比的是各自相對站立時移動了多少，膝往前靠近鏡頭造成的透視偏移
  // 只剩「膝的位移量」那一小部分，不再是整個高低關係（這正是「正對鏡頭蹲到底也不計次」的根因）。
  // 扣掉膝的位移也讓整體平移完全抵消。UI-PRMD 十二種機位×朝向實測 AUC 皆 1.000，
  // 見 docs/verification/深蹲朝向驗證.md。與 standTorso 同理，只在直立時更新。
  // 兩者都用原始影像座標（不正規化）：分子分母同單位，且分母取站立時的值，不會隨蹲下縮短。
  let standHipY = null, standKneeY = null, standThighRaw = null;
  function stableScale(frame) {
    const s = bodyScale(frame);
    if (!scaleEma) {
      scaleEma = { shoulderWidth: s.shoulderWidth, hipWidth: s.hipWidth, torsoLength: s.torsoLength, legLength: s.legLength };
    } else {
      const a = 0.12;
      for (const k of ['shoulderWidth', 'hipWidth', 'torsoLength', 'legLength']) scaleEma[k] = a * s[k] + (1 - a) * scaleEma[k];
    }
    // frameTorso 為「當幀」軀幹投影長（未平滑）；torsoRatio 為其與站立基準之比值。
    // 直立時 ≈1；前傾時軀幹投影縮短使其下降。透視會部分抵消（前傾使人靠近鏡頭而放大），
    // 故本量只能分辨明顯前傾，詳見 squat.js 之註解與 docs/verification/。
    const frameTorso = s.torsoLength;
    // 當幀左右大腿投影長，以及相對站立基準的「縮短率」（0＝站直，越大代表大腿越朝向鏡頭）。
    //
    // ⚠️ 2026-09-19：大腿長必須先以「同一幀的軀幹長」正規化，才能與站立基準相比。
    //    修正前兩者都是**未經正規化的像素長度**：使用者相對建立基準時的位置前後移動，
    //    分子隨距離縮放、分母卻是舊的 → 比值失真。
    //      靠近 → 當幀大腿變長 → 縮短率偏小 → 做對了卻不計次
    //      退後 → 當幀大腿變短 → 縮短率偏大 → 沒做到卻計次
    //    實測（UI-PRMD m02 跨欄步，段中疊加尺度擾動）：靠近 20% 時抬膝量偏誤 11.3%，
    //    靠近 30% 時後半段整組計不到次（99 → 0）。高抬腿是原地彈跳動作，本來就會前後飄。
    //
    //    用「同一幀的軀幹長」而非 EMA 平滑值當分母，是刻意的：分子分母取自同一幀，
    //    任何距離造成的等比縮放會**當場完全抵消**，不必等 EMA 追上。
    //    軀幹長在高抬腿期間幾乎不變（見 highknees.js 的實測：四種機位差異僅 0.001），
    //    故它在本動作是合格的尺度基準 —— 但同一句話在深蹲不成立（軀幹會大幅下沉）。
    const unit = frameTorso > 1e-6 ? frameTorso : 1;
    const thighL = dist2(frame[LM.LEFT_HIP], frame[LM.LEFT_KNEE]) / unit;
    const thighR = dist2(frame[LM.RIGHT_HIP], frame[LM.RIGHT_KNEE]) / unit;
    const foreshorten = (v) => (standThigh && standThigh > 1e-6 ? Math.max(0, 1 - v / standThigh) : 0);
    const hipY = (frame[LM.LEFT_HIP].y + frame[LM.RIGHT_HIP].y) / 2;
    const kneeY = (frame[LM.LEFT_KNEE].y + frame[LM.RIGHT_KNEE].y) / 2;
    const thighRaw = Math.max(thighL, thighR) * unit;
    return {
      ...s, ...scaleEma, frameTorso,
      torsoRatio: standTorso ? frameTorso / standTorso : 1,
      thighForeL: foreshorten(thighL), thighForeR: foreshorten(thighR),
      // 供 update() 更新站立基準用：已正規化，與 standThigh 同一個單位
      frameThighMax: Math.max(thighL, thighR),
      standThigh,
      // 髖相對膝的下降量（站立基準建立前為 null，由動作自行退回其他訊號）。
      // 必須扣掉膝的下降量：只看髖的話，整個人或鏡頭在畫面上快速上下移動（鏡頭被碰到、
      // 腳架晃動）就會被當成蹲下 —— 這是跨時間訊號，不像同幀相對量天生不受平移影響。
      // 扣掉膝之後整體平移完全抵消（2026-09-25 slice-reviewer 抓到）。
      hipDrop: (standHipY !== null && standThighRaw > 1e-6)
        ? ((hipY - standHipY) - (kneeY - standKneeY)) / standThighRaw : null,
      frameHipY: hipY, frameKneeY: kneeY, frameThighRaw: thighRaw,
    };
  }
  /** 由 update 在確認身體直立（動作尚未展開）時呼叫，緩慢更新站立基準。 */
  function updateStandBaseline(frameTorso, isUpright, frameSpan, frameThigh, frameHipY, frameKneeY, frameThighRaw) {
    if (!isUpright) return;
    if (Number.isFinite(frameHipY) && Number.isFinite(frameKneeY) && Number.isFinite(frameThighRaw) && frameThighRaw > 1e-6) {
      standHipY = standHipY === null ? frameHipY : 0.05 * frameHipY + 0.95 * standHipY;
      standKneeY = standKneeY === null ? frameKneeY : 0.05 * frameKneeY + 0.95 * standKneeY;
      standThighRaw = standThighRaw === null ? frameThighRaw : 0.05 * frameThighRaw + 0.95 * standThighRaw;
    }
    standTorso = standTorso === null ? frameTorso : 0.05 * frameTorso + 0.95 * standTorso;
    if (Number.isFinite(frameSpan) && frameSpan > 0) {
      standSpan = standSpan === null ? frameSpan : 0.05 * frameSpan + 0.95 * standSpan;
    }
    // 大腿基準取左右較長者：站姿時兩腿等長，取 max 可避開單側被遮擋而偏短的情形。
  // ⚠️ frameThigh 必須是**已用當幀軀幹長正規化**的值（由 stableScale 算好傳入），
  //    與 standThigh 同單位。傳原始像素長度會讓整個比值失去意義。
    if (Number.isFinite(frameThigh) && frameThigh > 1e-6) {
      standThigh = standThigh === null ? frameThigh : 0.05 * frameThigh + 0.95 * standThigh;
    }
  }

  function idleResult() {
    const seg = {}; for (const k of SEG_KEYS) seg[k] = 'green';
    return {
      phase: 'IDLE', color: 'green', segments: seg, visible: false, signal: 0,
      repCountedThisFrame: false, repValidThisFrame: false, faults: [], cue: null,
      reps: { valid: 0, invalid: 0 },
    };
  }
  const smooth = (track, raw) => {
    track.buf.push(raw); if (track.buf.length > cfg.smooth) track.buf.shift();
    return track.buf.reduce((a, b) => a + b, 0) / track.buf.length;
  };
  const isAdvisory = (f) => spec.faultSeverity?.[f] === 'advisory';
  const bump = (f) => { if (isAdvisory(f)) return; faultCounts[f] = (faultCounts[f] || 0) + 1; };

  // 處理一條 track 一幀；回傳 close 事件或 null
  function feed(track, raw, gatePass, frameFaults, tMs) {
    const sig = smooth(track, raw);
    const ev = track.tk.step(sig);
    if (ev.justStarted) {
      // 先清掉上一輪的提醒（已說過一輪），再判定本輪 —— 順序不可顛倒，
      // 否則會把剛設起的提醒立刻清掉。
      pendingCue = null;
      // 新動作開始 → 回頭判定「上一次結束到現在」是否曾完全伸展
      if (spec.checksLockout && lockoutPending && !lockoutSeen) {
        advisoryCounts.no_lockout = (advisoryCounts.no_lockout || 0) + 1;
        if (spec.cues?.no_lockout) pendingCue = { key: 'no_lockout', ...spec.cues.no_lockout };
      }
      lockoutPending = false; lockoutSeen = false;
      track.faults.clear(); track.peakSig = -1; track.gateAtPeak = true;
      track.unseenCount = 0; track.unseenRun = 0; track.unseenMaxRun = 0; track.seenCount = 0;
      track.unseenCritical = 0; track.lastSig = 0;
      track.tStart = tMs; track.tPeak = null;
    }
    if (track.tk.active) {
      track.seenCount++;
      track.unseenRun = 0;                       // 這一幀有判定到 → 連續漏看中斷
      track.lastSig = sig;                       // 供漏看時判斷「當時做到哪了」
      for (const f of frameFaults) track.faults.add(f);
      // 品質 gate 取「動作最深處(峰值)」採樣，避免目標進入瞬間因平滑延遲誤判
      if (sig > track.peakSig) { track.peakSig = sig; track.gateAtPeak = gatePass; track.tPeak = tMs; }
    }
    if (ev.justClosed) {
      const gateFailed = ev.reachedTarget && !track.gateAtPeak;
      const blocking = [...track.faults].some(f => spec.faultSeverity[f] === 'block') || gateFailed;
      // 下蹲耗時 = 起始→最深處；上升耗時 = 最深處→回到起始
      if (spec.checksLockout) { lockoutPending = true; lockoutSeen = false; }
      const downMs = (track.tPeak != null && track.tStart != null) ? track.tPeak - track.tStart : null;
      const upMs = (track.tPeak != null) ? tMs - track.tPeak : null;
      const total = track.seenCount + track.unseenCount;
      // ⚠️ 維持「有漏看就不給有效」的嚴格語意 —— 不要為了少扣幾次而放寬。
      // 曾評估過三種放寬（比例上限／連續長度上限／依訊號高低的關鍵窗），
      // 全部都會讓防作弊測試「錯誤發生的那幾幀剛好掉幀」漏掉，因為姿勢錯誤本來就
      // 發生在訊號高的那段，與「該容忍的短暫掉幀」在訊號軸上分不開。
      // 實機回報的「偷扣次數」另有成因（取景關卡對腳踝的硬性要求，已於 framing.js 修正）——
      // 修因不修果。unseenCount/unseenRatio 保留給 UI 說明「這一下為什麼沒算」。
      const unseen = track.unseenCount > 0;
      return {
        closed: true, reachedTarget: ev.reachedTarget, blocking, unseen,
        unseenCount: track.unseenCount, unseenRatio: total ? track.unseenCount / total : 0,
        faults: [...track.faults], downMs, upMs,
      };
    }
    return { closed: false, phase: ev.phase, sig };
  }

  function classify(side, ev, tMs) {
    // 冷卻：在冷卻窗內的關閉事件視為底部抖動，忽略
    if (tMs - lastCountTime < cfg.cooldownMs) return;
    // advisory 在此統計：不論該次最終有效或無效都要記錄，因為它描述的是姿勢品質，
    // 不是計次結果。放在冷卻檢查之後，避免底部抖動造成的重複關閉事件被重複計入。
    for (const f of ev.faults) if (isAdvisory(f)) advisoryCounts[f] = (advisoryCounts[f] || 0) + 1;

    // —— 動作節奏（BSA ⑩ Ascent）——
    // 依據：Myer et al. (2014) Back Squat Assessment。⚠️ 該文兩處敘述方向相反：
    //   Ascent 項寫「Ascent: Descent timing ratio is at least 2:1」，
    //   Descent 項寫「no less than 2:1 (descent: ascent) up to a 4:1 ratio」。
    // 採後者 —— 其表述完整無歧義（明寫 descent:ascent），且符合「離心慢、向心快」的領域常識。
    // 此歧義必須據實記錄，不得對外宣稱原文明確要求某一方向。
    // ⚠️ 門檻為工程判斷，未經真人標定；且節奏不影響「動作是否成立」，故一律 advisory。
    // —— 頂點未回到完全伸展位（極值判定）——
    // 依據：美軍 AFT／ACFT 要求每次推起須「fully extending the elbows」。
    // ⚠️ 設為 advisory 而非 block：AFT 的 HRP 另有雙手離地成 T 字的要求，與本作品的
    //   一般伏地挺身非同一動作；且門檻值為本團隊自訂（AFT 以目視判斷），標定前不取消次數。


    if (spec.tempoAdvisory && ev.downMs != null && ev.upMs != null && ev.upMs > 0 && ev.downMs > 0) {
      // 只在兩段都有實際耗時時判定，避免除以零與單幀動作的假陽性
      if (ev.downMs / ev.upMs < TEMPO_MIN_RATIO) {
        advisoryCounts.tempo_fast = (advisoryCounts.tempo_fast || 0) + 1;
        if (spec.cues?.tempo_fast) pendingCue = { key: 'tempo_fast', ...spec.cues.tempo_fast };
      }
    }
    // 上一次「有結算」的側別（不論有效與否）。撤銷第一下時要看它而不是 lastSide：
    // lastSide 只在有效時更新，若中間夾一下換邊但無效的動作（L 有效 → R 塌腰 → L），
    // 用 lastSide 判會誤以為使用者一直同側，把無辜的第一下也撤掉。
    const sameAsPrevAttempt = (side === prevAttemptSide);
    prevAttemptSide = side;
    if (!ev.reachedTarget) {
      invalidReps++; attempts++; bump('half_rep');
      for (const f of ev.faults) bump(f);
      lastCountTime = tMs;
      // 沒做到底時，若這一下同時累積了 block 級錯誤，要回報那個錯誤而不是「半程」——
      // 因為那個錯誤正是「做不到底」的原因。典型：用彎腰代替下蹲的人做不到深度，
      // 若跟他說「再往下蹲」，他只會彎得更厲害；該說的是「背打直、用臀部往後坐」。
      const blocker = ev.faults.find(f => spec.faultSeverity[f] === 'block');
      return _counted(false, blocker || 'half_rep');
    }
    const alternationOK = !alt || side !== lastSide;
    // unseen：這一下有幀沒被判定到（取景壞掉而凍結）。那些幀裡可能正好是姿勢跑掉的瞬間，
    // 沒看到就不該算過 —— 否則「剛好在做錯的瞬間掉幀」會把無效的一下升級成有效的。
    // 凍結機制保住的是「不要被誤記成半程」，不是「免驗放行」。
    const valid = !ev.blocking && alternationOK && !ev.unseen;
    attempts++; lastCountTime = tMs;
    // 回溯撤銷：這一下與上一下同側，而上一下正是「未經交替證實」的第一下 → 連它一起作廢。
    // 不這樣做的話，「一直抬同一隻腳」永遠會有第一下漏過去，「阻擋所有作弊動作」就不成立。
    let revoked = false;
    if (alt && !alternationOK && sameAsPrevAttempt && unconfirmedFirstAlt) {
      validReps--; revoked = true; unconfirmedFirstAlt = false;
    }
    if (valid) {
      validReps++;
      if (alt) { unconfirmedFirstAlt = (lastSide === null); lastSide = side; }
      return _counted(true);
    }
    invalidReps++;
    for (const f of ev.faults) bump(f);
    if (ev.unseen && !ev.blocking) bump('unseen');
    if (!alternationOK) { bump('no_alternation'); if (revoked) bump('no_alternation'); }
    if (ev.faults.length === 0 && alternationOK && !ev.unseen) bump('form'); // 達標但 gate 失敗
    // 拒絕原因要跟著結算事件走。不能讓 UI 自己去讀「當下這一幀的 faults」——
    // 一下是在回到起始位置時才結算，那時瞬間發生的錯誤（如最深處彎腰）早就消失了，
    // UI 會退回顯示「半程未達標」，等於告訴使用者一個錯的原因。
    const blocker = ev.faults.find(f => spec.faultSeverity[f] === 'block');
    return _counted(false, blocker
      || (!alternationOK ? 'no_alternation'
        : ev.unseen ? 'unseen'
          : (ev.faults[0] || 'form')));
  }
  let _flag = null;
  function _counted(valid, reason = null) { _flag = { counted: true, valid, reason }; }

  function update(frame, tMs) {
    _flag = null;
    // 取景判定（framing.js 單一事實來源）：可見度 + 座標真的在框內 + 頭部 + 跨幅。
    // 舊版只看 visibility，MediaPipe 對出框點的外插值會讓「人太近」照樣通過 —— 這是 Bug1 的根因。
    const report = framingReport(frame, { ...framingOpts, baselineSpan: standSpan });
    framingWin.push(report.ok ? 0 : 1);
    if (framingWin.length > cfg.framingWindow) framingWin.shift();
    const framingBad = framingWin.reduce((a, b) => a + b, 0) >= cfg.framingBadNeed;
    if (framingBad) visStreak = 0;          // 視窗內壞幀夠多 → 停止判定（含「一好一壞交替」）
    else if (report.ok) visStreak++;        // 只有合格幀才累積；壞幀不累積也不歸零＝遲滯
    const visible = visStreak >= cfg.visStreakNeed;

    // 這一幀不會被判定 → 累計在「進行中的那一下」上（見 makeTrack 的 unseen 註解）
    if (!visible || !report.ok) {
      const critical = UNSEEN_CRITICAL;
      for (const k in tracks) {
        const t = tracks[k];
        if (!t.tk.active) continue;
        t.unseenCount++; t.unseenRun++;
        if (t.unseenRun > t.unseenMaxRun) t.unseenMaxRun = t.unseenRun;
        // 以「漏看前最後一次看到的訊號」判斷這一幀落在動作的哪個階段
        if (t.lastSig >= critical) t.unseenCritical++;
      }
    }

    if (!visible) {
      // 短暫掉幀 vs 真的離開畫面：前者只是凍結（保住進行中的那一下），後者才重置狀態機。
      if (lostSinceMs === null) lostSinceMs = tMs;
      if (tMs - lostSinceMs >= cfg.abortAfterMs) {
        scaleEma = null; standTorso = null; standSpan = null; standThigh = null; standHipY = null; standKneeY = null; standThighRaw = null;   // 重新進入畫面時重新校準尺度與站立基準
        for (const k in tracks) { tracks[k].tk.abort(); tracks[k].buf = []; tracks[k].faults.clear(); }
      }
      const seg = {}; for (const k of SEG_KEYS) seg[k] = 'red';
      lastResult = {
        phase: 'IDLE', color: 'red', segments: seg, visible: false, signal: 0,
        repCountedThisFrame: false, repValidThisFrame: false, faults: ['not_visible'],
        cue: { key: report.issue || 'not_visible', text: report.text || '請站到鏡頭中、保持全身入鏡', priority: 'high' },
        framing: report,
        reps: { valid: validReps, invalid: invalidReps },
      };
      return lastResult;
    }
    // 遲滯窗內：取景剛壞掉、但還沒壞到要停止判定。這時「凍結」——不中止進行中的那一下，
    // 也不拿壞掉的座標去評估（否則雜訊會灌進平滑緩衝與尺度 EMA，正是「軀幹扭曲跳動」的來源）。
    // 凍結對防作弊是安全的：週期不前進，就不可能靠短暫消失跳過動作最深處——沒有可信幀達標，
    // 那一下最後會被記成 half_rep 而非有效。
    if (!report.ok) {
      lastResult = { ...lastResult, repCountedThisFrame: false, repValidThisFrame: false, framing: report };
      return lastResult;
    }
    lostSinceMs = null;

    const scale = stableScale(frame);   // 只用取景合格的幀更新尺度 EMA
    const ev = spec.evaluate(frame, scale);
    // 頂點伸展：只在動作未進行時（READY）觀察，見上方宣告處的說明
    if (spec.checksLockout) {
      const active = alt ? (tracks.L.tk.active || tracks.R.tk.active) : tracks.C.tk.active;
      if (!active && ev.lockoutOk) lockoutSeen = true;
      if (!active && lockoutPending) {
        // 動作已結束且已回到 READY：此時仍未見伸展 → 等下次動作開始時判定
        // （不在此處立即判，因為使用者可能正緩慢推起中）
      }
    }
    // 站立基準只在「動作尚未展開」時更新：progress 低代表人還站著，
    // 此時的軀幹投影長才是直立基準。動作進行中更新會讓基準被彎腰污染。
    updateStandBaseline(
      scale.frameTorso,
      (ev.progress ?? Math.max(ev.progressL ?? 0, ev.progressR ?? 0)) < 0.15,
      report.span,
      // 已以當幀軀幹長正規化（見 stableScale）—— 不可改回傳原始像素長度，
      // 那會讓基準與當幀值單位不一致，比值恆為錯。
      scale.frameThighMax,
      scale.frameHipY, scale.frameKneeY, scale.frameThighRaw,
    );
    let phase = 'READY';
    let signal = 0;

    if (alt) {
      const rl = feed(tracks.L, ev.progressL ?? 0, ev.side === 'L' ? ev.gatePass : true, ev.faults, tMs);
      const rr = feed(tracks.R, ev.progressR ?? 0, ev.side === 'R' ? ev.gatePass : true, ev.faults, tMs);
      if (rl.closed) classify('L', rl, tMs);
      if (rr.closed) classify('R', rr, tMs);
      phase = tracks.L.tk.phase !== 'READY' ? tracks.L.tk.phase : tracks.R.tk.phase;
      signal = Math.max(ev.progressL ?? 0, ev.progressR ?? 0);
    } else {
      const r = feed(tracks.C, ev.progress ?? 0, ev.gatePass, ev.faults, tMs);
      if (r.closed) classify('C', r, tMs);
      phase = tracks.C.tk.phase;
      signal = ev.progress ?? 0;
    }

    // 顏色：取各段最嚴重者
    const segments = ev.segments || Object.fromEntries(SEG_KEYS.map(k => [k, 'green']));
    let color = 'green';
    for (const k in segments) if (sevRank[segments[k]] > sevRank[color]) color = segments[k];

    // 教練提示
    let cue = null;
    if (spec.cues && ev.faults.length) {
      // 取最高嚴重度的 fault 對應提示。當下的姿勢問題優先於上一次的節奏提醒 ——
      // 使用者正在做錯的事，比剛才做錯的事更急。
      const f = ev.faults.find(x => spec.cues[x]) || ev.faults[0];
      if (spec.cues[f]) cue = { key: f, ...spec.cues[f] };
    } else if (pendingCue) {
      cue = pendingCue;      // 上一次動作的節奏／伸展提醒，在這一次進行中補說
    } else if (phase === 'CONCENTRIC' && spec.cues?.deeper && color === 'yellow') {
      cue = { key: 'deeper', ...spec.cues.deeper };
    }

    lastResult = {
      phase, color, segments, visible: true, signal,
      repCountedThisFrame: !!_flag?.counted,
      repValidThisFrame: !!_flag?.valid,
      repReason: _flag?.reason ?? null,   // 這一下被判無效的真正原因（給 UI 顯示，見 classify）
      faults: ev.faults,
      cue,
      framing: report,
      reps: { valid: validReps, invalid: invalidReps },
    };
    return lastResult;
  }

  function summary() {
    const total = validReps + invalidReps;
    return {
      validReps, invalidReps, attempts,
      targetRate: total ? validReps / total : 0,
      validRate: total ? validReps / total : 0,
      faultCounts: { ...faultCounts },
      // 最後一次動作沒有「下一次」可回頭判定，故在此補算。
      // 刻意不寫回 advisoryCounts —— summary() 可能被多次呼叫，寫回會重複累加。
      advisoryCounts: (spec.checksLockout && lockoutPending && !lockoutSeen)
        ? { ...advisoryCounts, no_lockout: (advisoryCounts.no_lockout || 0) + 1 }
        : { ...advisoryCounts },
    };
  }

  function reset() {
    validReps = invalidReps = attempts = 0; lastCountTime = -1e9; lastSide = null; visStreak = 0; scaleEma = null;
    unconfirmedFirstAlt = false; prevAttemptSide = null; standTorso = null; standSpan = null; standThigh = null; standHipY = null; standKneeY = null; standThighRaw = null;
    framingWin = []; lostSinceMs = null;
    for (const k in faultCounts) delete faultCounts[k];
    for (const k in advisoryCounts) delete advisoryCounts[k];
    lockoutSeen = false; lockoutPending = false; pendingCue = null;
    for (const k in tracks) { tracks[k].tk.reset(); tracks[k].buf = []; tracks[k].faults.clear(); }
  }

  return { update, summary, reset, spec };
}
