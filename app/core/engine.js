// 邏輯層：通用動作狀態機 + 六層防作弊 + 計次冷卻。瀏覽器 + Node 共用。
import { bodyScale } from './normalize.js';
import { framingReport } from './framing.js';

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

// unseen：這一下進行中有沒有出現「沒被判定到」的幀（取景壞掉而凍結、或看不到人）。
// 有的話就不能算有效——那些幀裡可能正好藏著姿勢錯誤，我們沒看到就不該給過。
function makeTrack(th) { return { tk: new CycleTracker(th), faults: new Set(), peakSig: -1, gateAtPeak: true, buf: [], unseen: false }; }

export function createDetector(spec, opts = {}) {
  const cfg = {
    visMin: 0.4,          // layer2 入鏡判定門檻（gate 已只看核心點，故維持 0.4 兼顧寬鬆與抗噪；末端點出框由 gateLandmarks 處理）
    smooth: 5,            // layer3 移動平均視窗
    visStreakNeed: 2,     // 連續 N 幀「取景合格」才開始判定（2：短暫遮擋後更快恢復，仍擋單幀誤偵測）
    // layer6 動態冷卻：兩次計次的最小間隔，擋機械式快速抖動。
    // ⚠️ 300 為工程判斷，非取自任何標準。可比對的參照：美軍 FM 7-22 之訓練節奏
    //   slow 50 counts/min、moderate 80 counts/min（伏地挺身採 moderate，約每 1.5 秒一次）。
    //   300ms 相當於每分鐘 200 次，較該標準寬鬆約 5 倍，故只擋明顯超出人類正常速度者。
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
  function stableScale(frame) {
    const s = bodyScale(frame);
    if (!scaleEma) {
      scaleEma = { shoulderWidth: s.shoulderWidth, hipWidth: s.hipWidth, torsoLength: s.torsoLength, legLength: s.legLength };
    } else {
      const a = 0.12;
      for (const k of ['shoulderWidth', 'hipWidth', 'torsoLength', 'legLength']) scaleEma[k] = a * s[k] + (1 - a) * scaleEma[k];
    }
    return { ...s, ...scaleEma };
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
  function feed(track, raw, gatePass, frameFaults) {
    const sig = smooth(track, raw);
    const ev = track.tk.step(sig);
    if (ev.justStarted) { track.faults.clear(); track.peakSig = -1; track.gateAtPeak = true; track.unseen = false; }
    if (track.tk.active) {
      for (const f of frameFaults) track.faults.add(f);
      // 品質 gate 取「動作最深處(峰值)」採樣，避免目標進入瞬間因平滑延遲誤判
      if (sig > track.peakSig) { track.peakSig = sig; track.gateAtPeak = gatePass; }
    }
    if (ev.justClosed) {
      const gateFailed = ev.reachedTarget && !track.gateAtPeak;
      const blocking = [...track.faults].some(f => spec.faultSeverity[f] === 'block') || gateFailed;
      return { closed: true, reachedTarget: ev.reachedTarget, blocking, unseen: track.unseen, faults: [...track.faults] };
    }
    return { closed: false, phase: ev.phase, sig };
  }

  function classify(side, ev, tMs) {
    // 冷卻：在冷卻窗內的關閉事件視為底部抖動，忽略
    if (tMs - lastCountTime < cfg.cooldownMs) return;
    // advisory 在此統計：不論該次最終有效或無效都要記錄，因為它描述的是姿勢品質，
    // 不是計次結果。放在冷卻檢查之後，避免底部抖動造成的重複關閉事件被重複計入。
    for (const f of ev.faults) if (isAdvisory(f)) advisoryCounts[f] = (advisoryCounts[f] || 0) + 1;
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
    const report = framingReport(frame, framingOpts);
    framingWin.push(report.ok ? 0 : 1);
    if (framingWin.length > cfg.framingWindow) framingWin.shift();
    const framingBad = framingWin.reduce((a, b) => a + b, 0) >= cfg.framingBadNeed;
    if (framingBad) visStreak = 0;          // 視窗內壞幀夠多 → 停止判定（含「一好一壞交替」）
    else if (report.ok) visStreak++;        // 只有合格幀才累積；壞幀不累積也不歸零＝遲滯
    const visible = visStreak >= cfg.visStreakNeed;

    // 這一幀不會被判定 → 記在「進行中的那一下」上，收尾時不給有效（見 classify 的 unseen）
    if (!visible || !report.ok) { for (const k in tracks) if (tracks[k].tk.active) tracks[k].unseen = true; }

    if (!visible) {
      // 短暫掉幀 vs 真的離開畫面：前者只是凍結（保住進行中的那一下），後者才重置狀態機。
      if (lostSinceMs === null) lostSinceMs = tMs;
      if (tMs - lostSinceMs >= cfg.abortAfterMs) {
        scaleEma = null;   // 重新進入畫面時重新校準尺度
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
    let phase = 'READY';
    let signal = 0;

    if (alt) {
      const rl = feed(tracks.L, ev.progressL ?? 0, ev.side === 'L' ? ev.gatePass : true, ev.faults);
      const rr = feed(tracks.R, ev.progressR ?? 0, ev.side === 'R' ? ev.gatePass : true, ev.faults);
      if (rl.closed) classify('L', rl, tMs);
      if (rr.closed) classify('R', rr, tMs);
      phase = tracks.L.tk.phase !== 'READY' ? tracks.L.tk.phase : tracks.R.tk.phase;
      signal = Math.max(ev.progressL ?? 0, ev.progressR ?? 0);
    } else {
      const r = feed(tracks.C, ev.progress ?? 0, ev.gatePass, ev.faults);
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
      // 取最高嚴重度的 fault 對應提示
      const f = ev.faults.find(x => spec.cues[x]) || ev.faults[0];
      if (spec.cues[f]) cue = { key: f, ...spec.cues[f] };
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
      advisoryCounts: { ...advisoryCounts },
    };
  }

  function reset() {
    validReps = invalidReps = attempts = 0; lastCountTime = -1e9; lastSide = null; visStreak = 0; scaleEma = null;
    unconfirmedFirstAlt = false; prevAttemptSide = null;
    framingWin = []; lostSinceMs = null;
    for (const k in faultCounts) delete faultCounts[k];
    for (const k in advisoryCounts) delete advisoryCounts[k];
    for (const k in tracks) { tracks[k].tk.reset(); tracks[k].buf = []; tracks[k].faults.clear(); }
  }

  return { update, summary, reset, spec };
}
