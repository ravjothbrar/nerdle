import { describe, it, expect, vi } from 'vitest';
import { actionForKey, classifySwipe, attachSwipe } from './input.js';

describe('keyboard', () => {
  it('maps arrows and WASD', () => {
    expect(actionForKey('ArrowLeft')).toBe('left');
    expect(actionForKey('KeyA')).toBe('left');
    expect(actionForKey('ArrowRight')).toBe('right');
    expect(actionForKey('KeyD')).toBe('right');
    expect(actionForKey('ArrowUp')).toBe('jump');
    expect(actionForKey('KeyW')).toBe('jump');
    expect(actionForKey('ArrowDown')).toBe('duck');
    expect(actionForKey('KeyS')).toBe('duck');
    expect(actionForKey('KeyQ')).toBeNull();
  });
});

describe('swipes', () => {
  it('classifies by dominant axis', () => {
    expect(classifySwipe(-40, 5)).toBe('left');
    expect(classifySwipe(40, -5)).toBe('right');
    expect(classifySwipe(3, -40)).toBe('jump');
    expect(classifySwipe(3, 40)).toBe('duck');
    expect(classifySwipe(5, 5)).toBeNull();
  });

  it('chains two lane changes in one stroke', () => {
    const el = document.createElement('div');
    const onAction = vi.fn();
    attachSwipe(el, onAction);
    const ev = (type, x, y) => {
      const e = new Event(type);
      Object.assign(e, { clientX: x, clientY: y, pointerId: 1 });
      el.dispatchEvent(e);
    };
    ev('pointerdown', 200, 200);
    ev('pointermove', 170, 200);
    ev('pointermove', 140, 202);
    ev('pointerup', 140, 202);
    expect(onAction.mock.calls.map((c) => c[0])).toEqual(['left', 'left']);
  });
});
