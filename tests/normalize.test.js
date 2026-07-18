import { test, approx, assert } from './harness.js';
import { bodyScale } from '../app/core/normalize.js';
import { baseSkeleton, _internal } from '../app/core/synth.js';

test('bodyScale: shoulder width ~0.16 on base skeleton', () => {
  const s = bodyScale(baseSkeleton());
  approx(s.shoulderWidth, 0.16, 0.01);
});

test('bodyScale: scale-invariant ratios', () => {
  const base = bodyScale(baseSkeleton());
  const scaled = bodyScale(_internal.transform(baseSkeleton(), { scale: 1.5 }));
  // 絕對肩寬會變，但 hipWidth/shoulderWidth 比例應一致
  const r1 = base.hipWidth / base.shoulderWidth;
  const r2 = scaled.hipWidth / scaled.shoulderWidth;
  approx(r2, r1, 1e-6, 'ratio should be scale invariant');
  // 放大後肩寬應約 1.5×
  approx(scaled.shoulderWidth / base.shoulderWidth, 1.5, 0.02);
});

test('bodyScale: torso & leg length positive', () => {
  const s = bodyScale(baseSkeleton());
  assert(s.torsoLength > 0 && s.legLength > 0, 'lengths positive');
});
