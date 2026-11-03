import assert from 'node:assert/strict';
import { cameraWheelZoomDelta, movementKey, MovementKeys } from '../src/lib/gameInput';
import { isDragStartButton } from '../src/lib/inputManager';

const event = (code: string, key = code) => ({ code, key });
const keys = new MovementKeys();

for (const [code, direction] of [
  ['ArrowUp', 'w'], ['ArrowLeft', 'a'], ['ArrowDown', 's'], ['ArrowRight', 'd'],
] as const) {
  assert.equal(keys.set(event(code), true), direction);
  assert.equal(keys[direction], true, `${code} starts movement`);
  keys.set(event(code), false);
  assert.equal(keys[direction], false, `${code} stops movement`);
}

assert.equal(movementKey(event('KeyW', 'ㄊ')), 'w', 'physical WASD survives an input-method layout');
assert.equal(movementKey(event('', 'W')), 'w', 'older events without code still work');
assert.equal(movementKey(event('Space', ' ')), null, 'jump is not movement');
keys.set(event('KeyW', 'w'), true);
keys.set(event('ArrowUp'), true);
keys.set(event('KeyW', 'w'), false);
assert.equal(keys.w, true, 'releasing one alias keeps the other held');
keys.set(event('ArrowRight'), true);
assert.equal(keys.d, true, 'diagonal movement holds both axes');
keys.reset();
assert.equal(keys.w || keys.a || keys.s || keys.d, false, 'focus/view reset clears every key');
keys.set(event('ArrowUp'), true);
keys.set(event('ArrowUp'), false);
assert.equal(keys.w, false, 'reset also clears aliases hidden inside the held-key set');

const zoom = (deltaY: number, deltaMode = 0, ctrlKey = false) =>
  cameraWheelZoomDelta({ deltaY, deltaMode, ctrlKey }, 800);
assert.equal(zoom(-100), 0.05, 'a normal mouse-wheel notch retains its step');
assert.ok(Math.abs(zoom(-100) - Array.from({ length: 100 }, () => zoom(-1)).reduce((a, b) => a + b, 0)) < 1e-9,
  'one trackpad gesture gives the same zoom however many events it emits');
assert.equal(zoom(0), 0, 'horizontal-only scroll does not zoom out');
assert.equal(zoom(1), -zoom(-1), 'zoom is symmetric');
assert.equal(zoom(-3, 1), zoom(-48), 'line and pixel wheel units agree');
assert.equal(zoom(-1, 2), zoom(-800), 'page wheel units use the canvas height');
assert.ok(zoom(-1, 0, true) > zoom(-1), 'trackpad pinch has its own usable sensitivity');
assert.ok(zoom(-100000) <= 0.2, 'large events cannot jump through the entire zoom range');

assert.equal(isDragStartButton({ pointerType: 'mouse', button: 0 }), true, 'primary tap can select/drag');
assert.equal(isDragStartButton({ pointerType: 'mouse', button: 2 }), false, 'right drag belongs to the camera');
assert.equal(isDragStartButton({ pointerType: 'mouse', button: 0, ctrlKey: true }), false,
  'macOS secondary click must not start moving furniture');
assert.equal(isDragStartButton({ pointerType: 'mouse', button: 0, altKey: true }), false,
  'Option/Alt camera look must not start moving furniture');
assert.equal(isDragStartButton({ pointerType: 'touch', button: 0 }), true, 'touch dragging stays available');

console.log('PASS laptop controls: arrow keys, aliases, input methods, proportional scroll/pinch, and drag ownership');
