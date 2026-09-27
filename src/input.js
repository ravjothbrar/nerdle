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
 * Attach swipe handling to an element. One stroke can chain moves
 * (swipe left-left across two lanes) because the origin resets after each
 * recognised gesture.
 */
export function attachSwipe(el, onAction) {
  let origin = null;
  const down = (e) => {
    origin = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const move = (e) => {
    if (!origin || e.pointerId !== origin.id) return;
    const action = classifySwipe(e.clientX - origin.x, e.clientY - origin.y);
    if (action) {
      onAction(action);
      origin = { x: e.clientX, y: e.clientY, id: e.pointerId };
    }
  };
  const up = () => {
    origin = null;
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
}
