import { WHEEL_ZOOM_STEP } from '../constants/cameraZoom';

type MovementKey = 'w' | 'a' | 's' | 'd';
type KeyEvent = Pick<KeyboardEvent, 'code' | 'key'>;

const MOVEMENT_CODES: Record<string, MovementKey> = {
  KeyW: 'w', ArrowUp: 'w',
  KeyA: 'a', ArrowLeft: 'a',
  KeyS: 's', ArrowDown: 's',
  KeyD: 'd', ArrowRight: 'd',
};

function movementCode(event: KeyEvent): string {
  if (MOVEMENT_CODES[event.code]) return event.code;
  if (MOVEMENT_CODES[event.key]) return event.key;
  return `Key${event.key.toUpperCase()}`;
}

/** Physical WASD keys also work with a Chinese input method selected. */
export function movementKey(event: KeyEvent): MovementKey | null {
  return MOVEMENT_CODES[movementCode(event)] ?? null;
}

/** Keep aliases independent: releasing W must not release a still-held ArrowUp. */
export class MovementKeys {
  w = false;
  a = false;
  s = false;
  d = false;
  private held = new Set<string>();

  set(event: KeyEvent, down: boolean): MovementKey | null {
    const code = movementCode(event);
    const direction = MOVEMENT_CODES[code];
    if (!direction) return null;
    if (down) this.held.add(code);
    else this.held.delete(code);
    this[direction] = [...this.held].some(key => MOVEMENT_CODES[key] === direction);
    return direction;
  }

  reset(): void {
    this.held.clear();
    this.w = this.a = this.s = this.d = false;
  }
}

/** Typing and browser shortcuts must not move the character behind a panel. */
export function acceptsGameKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false;
  const target = event.target;
  return !(target instanceof Element && target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"]',
  ));
}

/**
 * A 100px wheel notch keeps its old step. Trackpad scroll/pinch uses distance,
 * so splitting one gesture into many tiny events cannot multiply its zoom.
 * Browsers report a trackpad pinch as ctrl+wheel; consume it on the canvas only.
 */
export function cameraWheelZoomDelta(
  event: Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey'>,
  pageHeight: number,
): number {
  if (event.deltaY === 0) return 0;
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1;
  const sensitivity = event.ctrlKey ? 0.005 : WHEEL_ZOOM_STEP / 100;
  return Math.max(-0.2, Math.min(0.2, -event.deltaY * unit * sensitivity));
}
