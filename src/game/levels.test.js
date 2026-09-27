import { describe, it, expect } from 'vitest';
import { createRng } from './rng.js';
import { generateGate } from './equations.js';
import { LEVELS, LEVEL_IDS, operatorsAt, decoyProgress, decoyMargin } from './difficulty.js';
import { createGame, step } from './engine.js';
import { createBot } from './bot.js';

/** Every equation (true and false) shown over a stretch of a run. */
function sample(level, t, n = 800, seed = 1) {
  const rng = createRng(seed);
  const eqs = [];
  for (let i = 0; i < n; i++) {
    const p = decoyProgress(t, 0, level);
    eqs.push(...generateGate(rng, t, p, level).lanes);
  }
  return eqs;
}
const opsIn = (eqs) => new Set(eqs.map((e) => e.op));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('maths levels', () => {
  it('there are exactly three, easy → medium → hard', () => {
    expect(LEVEL_IDS).toEqual(['easy', 'medium', 'hard']);
    for (const id of LEVEL_IDS) expect(LEVELS[id].label).toBeTruthy();
  });

  it('easy: + and − within 20, × up to 5×5 later, never ÷', () => {
    for (const t of [0, 10, 60, 200]) {
      for (const e of sample('easy', t)) {
        if (e.op === '+' || e.op === '-') {
          expect(e.a).toBeLessThanOrEqual(20);
          expect(e.b).toBeLessThanOrEqual(20);
          expect(e.actual).toBeLessThanOrEqual(20);
        }
        if (e.op === '×') {
          expect(e.a).toBeLessThanOrEqual(5);
          expect(e.b).toBeLessThanOrEqual(5);
        }
        expect(e.op).not.toBe('÷');
      }
    }
    expect([...opsIn(sample('easy', 0))].sort()).toEqual(['+', '-']);
    expect(opsIn(sample('easy', 30)).has('×')).toBe(true);
    expect(operatorsAt(1000, 'easy')).not.toContain('÷');
  });

  it('easy decoys stay obviously wrong: never closer than 2 off', () => {
    expect(decoyProgress(1000, 1000, 'easy')).toBeLessThanOrEqual(0.35);
    expect(decoyMargin(decoyProgress(1000, 1000, 'easy')).min).toBeGreaterThanOrEqual(2);
    for (const e of sample('easy', 500)) {
      if (!e.isTrue && e.kind === 'offset') expect(Math.abs(e.result - e.actual)).toBeGreaterThanOrEqual(2);
    }
  });

  it('medium is the standard game (× at 20s, ÷ at 45s)', () => {
    expect(operatorsAt(19, 'medium')).toEqual(['+', '-']);
    expect(operatorsAt(20, 'medium')).toEqual(['+', '-', '×']);
    expect(operatorsAt(45, 'medium')).toEqual(['+', '-', '×', '÷']);
    expect(operatorsAt(45)).toEqual(operatorsAt(45, 'medium')); // default
  });

  it('hard: two-digit sums from the first row, × at 8s, ÷ at 20s', () => {
    for (const e of sample('hard', 0)) {
      // (Swapped-operator decoys borrow another sum's numbers — that's the trick.)
      if (e.op === '+' && e.kind !== 'swap') {
        expect(e.a).toBeGreaterThanOrEqual(10);
        expect(e.b).toBeGreaterThanOrEqual(10);
      }
      if (e.op === '-' && e.kind !== 'swap') {
        expect(e.a).toBeGreaterThanOrEqual(20);
        expect(e.b).toBeGreaterThanOrEqual(6);
      }
    }
    expect(operatorsAt(7.9, 'hard')).toEqual(['+', '-']);
    expect(operatorsAt(8, 'hard')).toContain('×');
    expect(operatorsAt(20, 'hard')).toContain('÷');
  });

  it('the numbers get bigger from easy to medium to hard', () => {
    const size = (level) => mean(sample(level, 30).map((e) => Math.max(e.a, e.b, e.actual)));
    const [easy, medium, hard] = LEVEL_IDS.map(size);
    expect(easy).toBeLessThan(medium);
    expect(medium).toBeLessThan(hard);
  });

  it('decoys are sharper on hard from the very first row', () => {
    const [easy, medium, hard] = LEVEL_IDS.map((l) => decoyProgress(0, 0, l));
    expect(easy).toBe(0);
    expect(medium).toBe(0);
    expect(hard).toBeGreaterThan(0.3);
    // …and hard reaches full sharpness sooner.
    expect(decoyProgress(0, 30, 'hard')).toBe(1);
    expect(decoyProgress(0, 30, 'medium')).toBeLessThan(1);
  });

  it('every level keeps equations to 8 tiles, whole numbers, one true lane', () => {
    for (const level of LEVEL_IDS) {
      const rng = createRng(3);
      for (let i = 0; i < 500; i++) {
        const t = i % 120;
        const { lanes } = generateGate(rng, t, decoyProgress(t, 0, level), level);
        expect(lanes.filter((e) => e.isTrue)).toHaveLength(1);
        for (const e of lanes) {
          expect(e.tokens.length).toBeLessThanOrEqual(8);
          for (const n of [e.a, e.b, e.result, e.actual]) expect(Number.isInteger(n) && n >= 0).toBe(true);
        }
      }
    }
  });

  it('only the sums change: speed and row timing are identical across levels', () => {
    const runs = LEVEL_IDS.map((level) => {
      const g = createGame({ seed: 7, level });
      const bot = createBot();
      const spawns = [];
      const seen = new Set();
      while (g.t < 60 && g.status === 'running') {
        step(g, 1 / 60, bot(g, 1 / 60));
        for (const r of g.rows) if (!seen.has(r.id)) seen.add(r.id) && spawns.push(r.spawnedAt.toFixed(2));
      }
      return { speed: g.speed.toFixed(3), status: g.status, spawns: spawns.slice(0, 8).join() };
    });
    for (const r of runs) expect(r.status).toBe('running');
    // Same speed curve (coins can differ, so compare early spawn times).
    expect(new Set(runs.map((r) => r.spawns.split(',').slice(0, 4).join())).size).toBe(1);
  });

  it('the engine records the level and announces its own unlocks', () => {
    const g = createGame({ seed: 2, level: 'hard' });
    const bot = createBot();
    const unlocks = [];
    while (g.t < 25) for (const e of step(g, 1 / 60, bot(g, 1 / 60))) if (e.type === 'unlock') unlocks.push([e.op, Math.round(g.t)]);
    expect(g.level).toBe('hard');
    expect(unlocks.map((u) => u[0])).toEqual(['×', '÷']);
    expect(unlocks[0][1]).toBeLessThan(12);
  });
});
