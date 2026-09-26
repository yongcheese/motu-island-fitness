// 從正式 app/core/engine.js 產生「可存檔／讀檔」的副本 src/engine-snap.js
// 只做兩件事：①把相對 import 改指回 app/core ②在 return 前插入 snapshot()/restore()
// 判定邏輯一個字都不改；正式引擎改版後重跑本腳本即可同步
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../../app/core/engine.js', import.meta.url), 'utf8');
const RET = '  return { update, summary, reset, spec };';
if (!src.includes(RET)) throw new Error('engine.js 的 return 行變了，請更新本腳本');

const SNAP = `
  // ── spike：存檔／讀檔（拆段複驗用）。清單必須涵蓋 createDetector 內所有可變狀態 ──
  function snapshot() {
    return {
      v: 1, validReps, invalidReps, attempts,
      faultCounts: { ...faultCounts }, advisoryCounts: { ...advisoryCounts },
      lockoutSeen, lockoutPending, pendingCue, lastCountTime, lastSide, visStreak,
      unconfirmedFirstAlt, prevAttemptSide, framingWin: [...framingWin], lostSinceMs, lastResult,
      scaleEma, standTorso, standSpan, standThigh, standHipY, standKneeY, standThighRaw,
      tracks: Object.fromEntries(Object.entries(tracks).map(([k, t]) => [k, {
        ...t, faults: [...t.faults], buf: [...t.buf],
        tk: { active: t.tk.active, reachedTarget: t.tk.reachedTarget, atTarget: t.tk.atTarget, phase: t.tk.phase },
      }])),
    };
  }
  function restore(s) {
    if (s.v !== 1) throw new Error('snapshot version');
    ({ validReps, invalidReps, attempts, lockoutSeen, lockoutPending, pendingCue, lastCountTime, lastSide, visStreak,
      unconfirmedFirstAlt, prevAttemptSide, lostSinceMs, lastResult,
      scaleEma, standTorso, standSpan, standThigh, standHipY, standKneeY, standThighRaw } = s);
    framingWin = [...s.framingWin];
    for (const k of Object.keys(faultCounts)) delete faultCounts[k];
    Object.assign(faultCounts, s.faultCounts);
    for (const k of Object.keys(advisoryCounts)) delete advisoryCounts[k];
    Object.assign(advisoryCounts, s.advisoryCounts);
    for (const [k, st] of Object.entries(s.tracks)) {
      const t = tracks[k];
      const { tk, faults, buf, ...rest } = st;
      Object.assign(t, rest);
      t.faults = new Set(faults); t.buf = [...buf];
      Object.assign(t.tk, tk);
    }
  }
  return { update, summary, reset, spec, snapshot, restore };`;

const out = '// ⚠️ 自動產生，勿手改：來源 app/core/engine.js，產生器 make-snap-engine.mjs\n' +
  src.replace(/from '\.\/([a-z-]+\.js)'/g, "from '../../../app/core/$1'").replace(RET, SNAP);
writeFileSync(new URL('./src/engine-snap.js', import.meta.url), out);
console.log('已產生 src/engine-snap.js');
