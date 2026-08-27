// 訓練畫面顏色語意的鎖。使用者裁定：
//   藍 = 動作開始／取景準備　　黃/紅 = 各關節的錯誤程度　　綠 = 該關節沒問題
// 最容易犯的錯（已犯過一次）：把「還沒達標」也塗黃 —— 那會讓每一下正常動作全身變黃，
// 黃色就不再代表「這裡有問題」。「做到哪了」是深度量表的職責，不是骨架顏色的。
import { test, eq, assert } from './harness.js';
import { framingPose, displaySegments, gaugeColor, phaseCueText, MOVE_SIGNAL } from '../app/ui/display-colors.js';
import { createDetector } from '../app/core/engine.js';
import { EXERCISES } from '../app/core/exercises/index.js';
import { makeSequence } from '../app/core/synth.js';

const res = (o) => ({ visible: true, phase: 'CONCENTRIC', signal: 0.5, color: 'green', segments: {}, ...o });
const allSame = (segs, c) => Object.values(segs).every(v => v === c);

/* ---------- 藍：只在取景／準備 ---------- */
test('藍色只出現在「取景/準備」：看不到人、IDLE、或 READY 且幾乎沒動', () => {
  eq(allSame(displaySegments(res({ visible: false })), 'frame'), true, '看不到人 → 藍');
  eq(allSame(displaySegments(res({ phase: 'IDLE', signal: 0 })), 'frame'), true, 'IDLE → 藍');
  eq(allSame(displaySegments(res({ phase: 'READY', signal: 0.02 })), 'frame'), true, '站著沒動 → 藍');
});

test('一開始做動作就離開藍色（門檻低於引擎的 attemptEnter，否則會「一直藍」）', () => {
  assert(MOVE_SIGNAL < 0.25, '顯示門檻必須低於最小的 attemptEnter(0.25)，不然中間一大段全是藍的');
  const moving = res({ phase: 'READY', signal: MOVE_SIGNAL + 0.01, segments: { torso: 'green' } });
  eq(framingPose(moving), false);
  eq(displaySegments(moving).torso, 'green', '開始動了就該顯示關節的真實狀態');
});

/* ---------- 黃/紅：只代表關節錯誤程度 ---------- */
test('黃/紅原樣反映各關節判定，不因「還沒達標」而改色', () => {
  const segs = { torso: 'yellow', leftArm: 'green', rightArm: 'green', leftLeg: 'red', rightLeg: 'green' };
  // 同一組關節判定，訊號高低都不該改變骨架顏色
  for (const signal of [0.2, 0.5, 0.99]) {
    const d = displaySegments(res({ signal, segments: segs }));
    eq(d.torso, 'yellow', `signal=${signal}`);
    eq(d.leftLeg, 'red', `signal=${signal}`);
    eq(d.leftArm, 'green', `signal=${signal}：沒問題的關節不該因為未達標被降成黃`);
  }
});

// 這條是使用者親自指出的錯誤的回歸鎖。
test('回歸鎖: 乾淨動作進行中，骨架不得整片變黃（黃色要留給真的有問題的關節）', () => {
  for (const id of Object.keys(EXERCISES)) {
    const det = createDetector(EXERCISES[id]);
    const seq = makeSequence(id, { reps: 3, variant: 'clean' });
    let t = 0, allYellowFrames = 0, movingFrames = 0;
    for (const f of seq.frames) {
      const r = det.update(f, t); t += seq.dtMs;
      if (r.visible === false || framingPose(r)) continue;
      movingFrames++;
      if (allSame(displaySegments(r), 'yellow')) allYellowFrames++;
    }
    assert(movingFrames > 0, `${id}: 測試前提——要有做動作的幀`);
    eq(allYellowFrames, 0, `${id}: 乾淨動作有 ${allYellowFrames} 幀整片黃`);
  }
});

/* ---------- 深度量表：這裡才是「進度」語意 ---------- */
test('深度量表有藍→黃→綠的過渡（使用者說的「狀態條」）', () => {
  const ex = EXERCISES.squat;
  eq(gaugeColor(res({ phase: 'IDLE', signal: 0 }), ex), 'frame', '準備 → 藍');
  eq(gaugeColor(res({ signal: 0.4 }), ex), 'yellow', '進行中 → 黃');
  eq(gaugeColor(res({ signal: 0.95 }), ex), 'green', '達標 → 綠');
  eq(gaugeColor(res({ signal: 0.95, color: 'red' }), ex), 'red', '有錯誤 → 紅（優先於達標）');
});

test('量表在同一下之內確實走過三種顏色（不是一直藍然後直接跳綠）', () => {
  const det = createDetector(EXERCISES.squat);
  const seq = makeSequence('squat', { reps: 2, variant: 'clean' });
  let t = 0; const seen = new Set();
  for (const f of seq.frames) { const r = det.update(f, t); t += seq.dtMs; if (r.visible !== false) seen.add(gaugeColor(r, EXERCISES.squat)); }
  for (const c of ['frame', 'yellow', 'green']) assert(seen.has(c), `量表缺少 ${c} 這一段（實得 ${[...seen]}）`);
});

/* ---------- 動作指引字卡 ---------- */
test('字卡隨相位切換；看不到人時不留殘字', () => {
  const ex = EXERCISES.jumpingjack;
  eq(phaseCueText(res({ phase: 'TARGET' }), ex), ex.phaseCues.TARGET);
  eq(phaseCueText(res({ phase: 'ECCENTRIC' }), ex), ex.phaseCues.ECCENTRIC);
  eq(phaseCueText(res({ phase: 'IDLE', signal: 0 }), ex), ex.phaseCues.READY, '準備態顯示起手指引');
  eq(phaseCueText(res({ visible: false }), ex), '', '看不到人就不該留著上一句');
  eq(phaseCueText(res({}), { }), '', '沒有 phaseCues 的動作要安全退場');
});

test('全部函式對殘缺輸入安全（idleResult / 尚未有 framing 欄位時）', () => {
  for (const bad of [null, undefined, {}, { visible: true }]) {
    displaySegments(bad); gaugeColor(bad, EXERCISES.squat); phaseCueText(bad, EXERCISES.squat); framingPose(bad);
  }
});
