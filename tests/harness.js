// 極簡零依賴測試框架
const registry = [];
export function test(name, fn) { registry.push({ name, fn }); }
export function getTests() { return registry; }

export function assert(cond, msg) {
  if (!cond) throw new Error('assert failed: ' + (msg || ''));
}
export function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)} ${msg ? '— ' + msg : ''}`);
}
export function approx(actual, expected, tol, msg) {
  if (Math.abs(actual - expected) > tol) throw new Error(`expected ~${expected}±${tol} got ${actual} ${msg ? '— ' + msg : ''}`);
}
export function between(actual, lo, hi, msg) {
  if (actual < lo || actual > hi) throw new Error(`expected ${actual} in [${lo},${hi}] ${msg ? '— ' + msg : ''}`);
}

// 把整段序列灌進 detector，回傳 summary 與每幀結果
export function runSequence(detector, seq) {
  let t = 0;
  const perFrame = [];
  for (const frame of seq.frames) {
    perFrame.push(detector.update(frame, t));
    t += seq.dtMs;
  }
  return { summary: detector.summary(), perFrame };
}
