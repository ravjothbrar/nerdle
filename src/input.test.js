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

  const rig = () => {
    const el = document.createElement('div');
    const calls = [];
    attachSwipe(el, (a) => calls.push(a));
    const ev = (type, x, y, id = 1) => {
      const e = new Event(type);
      Object.assign(e, { clientX: x, clientY: y, pointerId: id });
      el.dispatchEvent(e);
    };
    return { ev, calls };
  };

  it('one swipe moves exactly one lane, however long it is', () => {
    const { ev, calls } = rig();
    ev('pointerdown', 300, 400);
    for (let x = 290; x >= 20; x -= 10) ev('pointermove', x, 402); // a long, sweeping swipe
    ev('pointerup', 20, 402);
    expect(calls).toEqual(['left']);
  });

  it('two lanes takes two swipes', () => {
    const { ev, calls } = rig();
    for (let i = 0; i < 2; i++) {
      ev('pointerdown', 200, 400);
      ev('pointermove', 160, 400);
      ev('pointerup', 150, 400);
    }
    expect(calls).toEqual(['left', 'left']);
  });

  it('changing direction mid-swipe does not add a second move', () => {
    const { ev, calls } = rig();
    ev('pointerdown', 200, 400);
    ev('pointermove', 240, 400); // right
    ev('pointermove', 150, 400); // then back left past the start
    ev('pointermove', 150, 300); // then up
    ev('pointerup', 150, 300);
    expect(calls).toEqual(['right']);
  });

  it('a quick flick that only registers on release still counts', () => {
    const { ev, calls } = rig();
    ev('pointerdown', 200, 400);
    ev('pointerup', 200, 340);
    expect(calls).toEqual(['jump']);
  });

  it('a tap does nothing', () => {
    const { ev, calls } = rig();
    ev('pointerdown', 200, 400);
    ev('pointermove', 205, 403);
    ev('pointerup', 205, 403);
    expect(calls).toEqual([]);
  });

  it('two fingers are two independent swipes', () => {
    const { ev, calls } = rig();
    ev('pointerdown', 100, 400, 1);
    ev('pointerdown', 300, 400, 2);
    ev('pointermove', 60, 400, 1);
    ev('pointermove', 340, 400, 2);
    ev('pointerup', 60, 400, 1);
    ev('pointerup', 340, 400, 2);
    expect(calls).toEqual(['left', 'right']);
  });
});
