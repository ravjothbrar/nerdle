// Keyboard + swipe input, normalised to the engine's action vocabulary:
// 'left' | 'right' | 'jump' | 'duck'.

const KEYMAP = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'jump',
  KeyW: 'jump',
  Space: 'jump',
  ArrowDown: 'duck',
  KeyS: 'duck',
};

export function actionForKey(code) {
  return KEYMAP[code] ?? null;
}

/**
 * Classify a swipe vector. Fires as soon as the finger has travelled
 * `threshold` px — waiting for touchend would add ~100ms of lag.
 */
export function classifySwipe(dx, dy, threshold = 22) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < threshold) return null;
  if (ax > ay) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'jump' : 'duck';
}

/**
 * Attach swipe handling to an element. Exactly ONE action per touch: a long
 * or fast swipe still only moves one lane — lift and swipe again to move two.
 * It fires as soon as the finger crosses the threshold (no waiting for
 * touchend), and a very quick flick that only registers on release still
 * counts. Each finger is tracked separately.
 */
export function attachSwipe(el, onAction) {
  const strokes = new Map(); // pointerId -> { x, y, fired }
  const down = (e) => {
    strokes.set(e.pointerId, { x: e.clientX, y: e.clientY, fired: false });
  };
  const check = (e) => {
    const s = strokes.get(e.pointerId);
    if (!s || s.fired) return;
    const action = classifySwipe(e.clientX - s.x, e.clientY - s.y);
    if (action) {
      s.fired = true;
      onAction(action);
    }
  };
  const up = (e) => {
    check(e);
    strokes.delete(e.pointerId);
  };
  const cancel = (e) => strokes.delete(e.pointerId);
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', check);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', check);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
  };
}
