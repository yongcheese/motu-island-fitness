// 邏輯層：通用動作狀態機 + 六層防作弊 + 計次冷卻。瀏覽器 + Node 共用。
import { bodyScale, minVisibility } from './normalize.js';
import { LM } from './landmarks.js';

const SEG_KEYS = ['torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
const sevRank = { green: 0, yellow: 1, red: 2 };

// 入鏡失敗時：依「缺哪個 gate 關節點」給具體取景指引，取代通用的「請後退一步」。
const PART_NAME = {
  [LM.LEFT_SHOULDER]: '肩膀', [LM.RIGHT_SHOULDER]: '肩膀',
  [LM.LEFT_ELBOW]: '手肘', [LM.RIGHT_ELBOW]: '手肘',
  [LM.LEFT_WRIST]: '手腕', [LM.RIGHT_WRIST]: '手腕',
  [LM.LEFT_HIP]: '髖部', [LM.RIGHT_HIP]: '髖部',
  [LM.LEFT_KNEE]: '膝蓋', [LM.RIGHT_KNEE]: '膝蓋',
  [LM.LEFT_ANKLE]: '腳踝', [LM.RIGHT_ANKLE]: '腳踝',
};
function framingCue(frame, gateLandmarks, visMin) {
  const missing = [...new Set(gateLandmarks
    .filter(i => (frame[i]?.visibility ?? 0) < visMin)
    .map(i => PART_NAME[i]).filter(Boolean))];
  if (!missing.length) return '請站到鏡頭中、保持全身入鏡';
  return `看不到您的${missing.join('、')}，請把鏡頭放低或後退一步（Mac 請關閉控制中心的「人物置中」）`;
}

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

function makeTrack(th) { return { tk: new CycleTracker(th), faults: new Set(), peakSig: -1, gateAtPeak: true, buf: [] }; }

export function createDetector(spec, opts = {}) {
  const cfg = {
    visMin: 0.4,          // layer2 入鏡判定門檻（gate 已只看核心點，故維持 0.4 兼顧寬鬆與抗噪；末端點出框由 gateLandmarks 處理）
    smooth: 5,            // layer3 移動平均視窗
    visStreakNeed: 2,     // 連續 N 幀可見才判定（2：短暫遮擋後更快恢復，仍擋單幀誤偵測）
    cooldownMs: 300,      // layer6 動態冷卻
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
  let lastCountTime = -1e9, lastSide = null, visStreak = 0;
  let lastResult = idleResult();

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
  const bump = (f) => { faultCounts[f] = (faultCounts[f] || 0) + 1; };

  // 處理一條 track 一幀；回傳 close 事件或 null
  function feed(track, raw, gatePass, frameFaults) {
    const sig = smooth(track, raw);
    const ev = track.tk.step(sig);
    if (ev.justStarted) { track.faults.clear(); track.peakSig = -1; track.gateAtPeak = true; }
    if (track.tk.active) {
      for (const f of frameFaults) track.faults.add(f);
      // 品質 gate 取「動作最深處(峰值)」採樣，避免目標進入瞬間因平滑延遲誤判
      if (sig > track.peakSig) { track.peakSig = sig; track.gateAtPeak = gatePass; }
    }
    if (ev.justClosed) {
      const gateFailed = ev.reachedTarget && !track.gateAtPeak;
      const blocking = [...track.faults].some(f => spec.faultSeverity[f] === 'block') || gateFailed;
      return { closed: true, reachedTarget: ev.reachedTarget, blocking, faults: [...track.faults] };
    }
    return { closed: false, phase: ev.phase, sig };
  }

  function classify(side, ev, tMs) {
    // 冷卻：在冷卻窗內的關閉事件視為底部抖動，忽略
    if (tMs - lastCountTime < cfg.cooldownMs) return;
    if (!ev.reachedTarget) {
      invalidReps++; attempts++; bump('half_rep');
      for (const f of ev.faults) bump(f);
      lastCountTime = tMs; return _counted(false);
    }
    const alternationOK = !alt || side !== lastSide;
    const valid = !ev.blocking && alternationOK;
    attempts++; lastCountTime = tMs;
    if (valid) { validReps++; if (alt) lastSide = side; return _counted(true); }
    invalidReps++;
    for (const f of ev.faults) bump(f);
    if (!alternationOK) bump('no_alternation');
    if (ev.faults.length === 0 && alternationOK) bump('form'); // 達標但 gate 失敗
    return _counted(false);
  }
  let _flag = null;
  function _counted(valid) { _flag = { counted: true, valid }; }

  function update(frame, tMs) {
    _flag = null;
    const scale = stableScale(frame);
    const vis = minVisibility(frame, gateLandmarks);
    if (vis >= cfg.visMin) visStreak++; else visStreak = 0;
    const visible = visStreak >= cfg.visStreakNeed;

    if (!visible) {
      scaleEma = null;   // 重新進入畫面時重新校準尺度
      for (const k in tracks) { tracks[k].tk.abort(); tracks[k].buf = []; tracks[k].faults.clear(); }
      const seg = {}; for (const k of SEG_KEYS) seg[k] = 'red';
      lastResult = {
        phase: 'IDLE', color: 'red', segments: seg, visible: false, signal: 0,
        repCountedThisFrame: false, repValidThisFrame: false, faults: ['not_visible'],
        cue: { key: 'not_visible', text: framingCue(frame, gateLandmarks, cfg.visMin), priority: 'high' },
        reps: { valid: validReps, invalid: invalidReps },
      };
      return lastResult;
    }

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
      faults: ev.faults,
      cue,
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
    };
  }

  function reset() {
    validReps = invalidReps = attempts = 0; lastCountTime = -1e9; lastSide = null; visStreak = 0; scaleEma = null;
    for (const k in faultCounts) delete faultCounts[k];
    for (const k in tracks) { tracks[k].tk.reset(); tracks[k].buf = []; tracks[k].faults.clear(); }
  }

  return { update, summary, reset, spec };
}
