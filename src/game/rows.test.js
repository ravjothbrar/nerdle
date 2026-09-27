import { describe, it, expect } from 'vitest';
import { createRng } from './rng.js';
import { generateRow, isSafeSlot, MIXED_FROM } from './rows.js';

const sample = (seed, t, n = 3000, p = 0.5) => {
  const rng = createRng(seed);
  const out = [];
  let recent = [];
  for (let i = 0; i < n; i++) {
    const row = generateRow(rng, t, p, recent);
    recent = [...recent.slice(-4), row.kind];
    out.push(row);
  }
  return out;
};

describe('generateRow', () => {
  it('only maths rows before MIXED_FROM', () => {
    expect(sample(1, MIXED_FROM - 0.1, 500).every((r) => r.kind === 'maths')).toBe(true);
  });

  it('every row has at least one lane you can survive, and never three walls', () => {
    for (const t of [10, 40, 120]) {
      for (const row of sample(2, t)) {
        expect(row.lanes).toHaveLength(3);
        expect(row.lanes.some(isSafeSlot)).toBe(true);
        expect(row.lanes.filter((s) => s.type === 'wall').length).toBeLessThan(3);
      }
    }
  });

  it('maths rows: three equations, exactly one true', () => {
    for (const row of sample(3, 60).filter((r) => r.kind === 'maths')) {
      expect(row.lanes.every((s) => s.type === 'eq')).toBe(true);
      expect(row.lanes.filter((s) => s.eq.isTrue)).toHaveLength(1);
    }
  });

  it('mixed rows: equations beside a wall; at most one true; both flavours appear', () => {
    const mixed = sample(4, 60).filter((r) => r.kind === 'mixed');
    let pair = 0;
    let gamble = 0;
    let gambleFalse = 0;
    for (const row of mixed) {
      const eqs = row.lanes.filter((s) => s.type === 'eq');
      expect(row.lanes.some((s) => s.type === 'wall')).toBe(true);
      expect(eqs.filter((s) => s.eq.isTrue).length).toBeLessThanOrEqual(1);
      if (eqs.length === 2) {
        pair++;
        expect(eqs.filter((s) => s.eq.isTrue)).toHaveLength(1);
      } else {
        gamble++;
        expect(eqs).toHaveLength(1);
        expect(row.lanes.some((s) => s.type === 'barrier' || s.type === 'beam')).toBe(true);
        if (!eqs[0].eq.isTrue) gambleFalse++;
      }
    }
    expect(pair).toBeGreaterThan(50);
    expect(gamble).toBeGreaterThan(50);
    // The lone equation is a genuine gamble: sometimes true, sometimes not.
    expect(gambleFalse / gamble).toBeGreaterThan(0.3);
    expect(gambleFalse / gamble).toBeLessThan(0.7);
  });

  it('obstacle rows mix walls, hurdles and beams across lanes', () => {
    const obs = sample(5, 60).filter((r) => r.kind === 'obstacles');
    const types = new Set(obs.flatMap((r) => r.lanes.map((s) => s.type)));
    expect([...types].sort()).toEqual(['barrier', 'beam', 'empty', 'wall']);
    const mixedLanes = obs.filter((r) => new Set(r.lanes.map((s) => s.type)).size > 1);
    expect(mixedLanes.length / obs.length).toBeGreaterThan(0.4);
  });

  it('maths stays the majority, and never three non-maths rows in a row', () => {
    const rows = sample(6, 60);
    const maths = rows.filter((r) => r.kind === 'maths').length;
    expect(maths / rows.length).toBeGreaterThan(0.5);
    for (let i = 2; i < rows.length; i++) {
      expect([rows[i - 2], rows[i - 1], rows[i]].some((r) => r.kind === 'maths')).toBe(true);
    }
  });
});
