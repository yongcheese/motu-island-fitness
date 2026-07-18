import { test, approx, eq } from './harness.js';
import { angle, distance, midpoint, vAngleFromVertical } from '../app/core/geometry.js';

test('distance: 3-4-5', () => {
  approx(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5, 1e-9);
});

test('angle: right angle = 90deg', () => {
  // ∠ABC with A=(0,1) B=(0,0) C=(1,0) → 90°
  approx(angle({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 90, 1e-6);
});

test('angle: straight line = 180deg', () => {
  approx(angle({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 180, 1e-6);
});

test('angle: 45deg', () => {
  approx(angle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }), 45, 1e-6);
});

test('midpoint', () => {
  const m = midpoint({ x: 0, y: 0 }, { x: 2, y: 4 });
  eq(m.x, 1); eq(m.y, 2);
});

test('vAngleFromVertical: vertical torso ~0deg, horizontal ~90deg', () => {
  // y down. shoulder above hip = vertical
  approx(vAngleFromVertical({ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.5 }), 0, 1e-6);
  approx(vAngleFromVertical({ x: 0.2, y: 0.5 }, { x: 0.5, y: 0.5 }), 90, 1e-6);
});
