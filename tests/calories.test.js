import { test, approx, eq } from './harness.js';
import { estimateCalories, grade } from '../app/core/calories.js';

test('METs formula: squat 70kg 10min targetRate=1 ≈ 63 kcal', () => {
  // kcal = MET(5.4) × 70 × (10/60) ≈ 63
  const kcal = estimateCalories({ met: 5.4, weightKg: 70, durationSec: 600, targetRate: 1 });
  approx(kcal, 63, 2);
});

test('targetRate weighting reduces half-rep energy', () => {
  const full = estimateCalories({ met: 8, weightKg: 70, durationSec: 600, targetRate: 1 });
  const half = estimateCalories({ met: 8, weightKg: 70, durationSec: 600, targetRate: 0.5 });
  if (!(half < full)) throw new Error('half-rep should burn less');
});

test('grade thresholds S/A/B/C', () => {
  eq(grade({ targetRate: 0.95, validRate: 0.95 }), 'S');
  eq(grade({ targetRate: 0.80, validRate: 0.80 }), 'A');
  eq(grade({ targetRate: 0.65, validRate: 0.65 }), 'B');
  eq(grade({ targetRate: 0.40, validRate: 0.40 }), 'C');
});
