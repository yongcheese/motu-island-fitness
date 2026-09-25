// 合體第二階段 Slice 10：訓練計次的畫面回饋。
//   ① 「+1」連續兩下都要閃（舊寫法 class 字串相同 → 動畫不重播）
//   ② 高抬腿撤銷上一下（有效次數 −1）時，畫面要明講 −1，不能只閃「✗」讓數字悄悄變少
import { test, eq, assert } from './harness.js';
import { repFlash, popRepFlash } from '../app/features/workout/workout.js';
import { makeSequence } from '../app/core/synth.js';
import { createDetector } from '../app/core/engine.js';
import { EXERCISES } from '../app/core/exercises/index.js';

const res = (over) => ({ repCountedThisFrame: true, repValidThisFrame: false, repReason: null, reps: { valid: 3, invalid: 0 }, ...over });

test('repFlash：沒有結算的幀不閃', () => {
  eq(repFlash(res({ repCountedThisFrame: false }), 3), null);
  eq(repFlash(null, 3), null);
});

test('repFlash：有效的一下 → ✓ +1', () => {
  const f = repFlash(res({ repValidThisFrame: true, reps: { valid: 4 } }), 3);
  eq(f.kind, 'ok'); eq(f.text, '✓ +1');
});

test('repFlash：無效且次數沒變 → ✗ 引擎給的原因', () => {
  const f = repFlash(res({ repReason: 'torso_lean' }), 3);
  eq(f.kind, 'bad'); assert(f.text.startsWith('✗ ') && f.text.includes('彎腰'), f.text);
});

test('repFlash：有效次數比上一幀少（撤銷）→ 明講 −1，不是 ✗', () => {
  const f = repFlash(res({ repReason: 'no_alternation', reps: { valid: 2 } }), 3);
  eq(f.kind, 'bad'); assert(f.text.startsWith('−1'), f.text);
});

test('repFlash：第一幀（沒有上一幀紀錄）不會誤判成撤銷', () => {
  const f = repFlash(res({ reps: { valid: 0 } }), undefined);
  assert(f.text.startsWith('✗'), f.text);
});

// 假元素：記錄 class 操作與 reflow 的先後順序
function fakeEl(initial = []) {
  const cls = new Set(initial), log = [];
  return {
    log, cls, textContent: '',
    classList: {
      remove: (...c) => { c.forEach(x => cls.delete(x)); log.push('remove'); },
      add: (...c) => { c.forEach(x => cls.add(x)); log.push('add:' + c.join(',')); },
    },
    get offsetWidth() { log.push(cls.has('pop') ? 'reflow(pop還在)' : 'reflow'); return 100; },
  };
}

test('popRepFlash：先拿掉 pop → reflow → 再加回 pop（連續同種結果也會重播動畫）', () => {
  const el = fakeEl(['lv-repflash', 'pop', 'ok']);
  popRepFlash(el, { kind: 'ok', text: '✓ +1' });
  const iRemove = el.log.indexOf('remove'), iReflow = el.log.indexOf('reflow'), iAdd = el.log.findIndex(x => x.startsWith('add'));
  assert(iRemove >= 0 && iRemove < iReflow && iReflow < iAdd, el.log.join(' → '));
  assert(el.cls.has('pop') && el.cls.has('ok') && el.cls.has('lv-repflash'), [...el.cls].join(' '));
  eq(el.textContent, '✓ +1');
});

test('popRepFlash：ok → bad 切換時不會同時留著兩種顏色', () => {
  const el = fakeEl(['lv-repflash', 'pop', 'ok']);
  popRepFlash(el, { kind: 'bad', text: '✗ x' });
  assert(el.cls.has('bad') && !el.cls.has('ok'), [...el.cls].join(' '));
});

// 端到端（引擎＋畫面判斷）：每一次有效次數改變，畫面都有對應的閃字，且方向一致
for (const [id, variant] of [['squat', 'clean'], ['squat', 'half'], ['highknees', 'clean'], ['highknees', 'singleleg'], ['jumpingjack', 'clean'], ['pushup', 'clean']]) {
  test(`計次回饋與數字一致：${id}/${variant}（+1 必閃 ✓、−1 必閃 −1、沒變就不閃 ✓）`, () => {
    const seq = makeSequence(id, { reps: 8, variant, framesPerRep: 26, seed: 7 });
    const d = createDetector(EXERCISES[id]);
    let shown, t = 0, ups = 0, downs = 0;
    for (const f of seq.frames) {
      const r = d.update(f, t); t += 33;
      const fl = repFlash(r, shown);
      const delta = shown == null ? r.reps.valid : r.reps.valid - shown;
      if (delta > 0) { ups++; eq(fl?.text, '✓ +1', `次數 +${delta} 卻閃 ${fl?.text}`); }
      else if (delta < 0) { downs++; assert(fl?.text?.startsWith('−1'), `次數 ${delta} 卻閃 ${fl?.text}`); }
      else assert(!fl || fl.kind === 'bad', `次數沒變卻閃 ${fl?.text}`);
      shown = r.reps.valid;
    }
    if (variant === 'clean') assert(ups >= 6, `乾淨動作只數到 ${ups} 下`);
    if (variant === 'singleleg') assert(downs >= 1, '單腳連抬應觸發撤銷（測試前提）');
  });
}
