import { describe, it, expect } from 'vitest';
import { createRng } from './rng.js';
import {
  evaluate,
  makeEquation,
  generateGate,
  randomTrueEquation,
  makeDecoy,
  explain,
  MAX_TILES,
} from './equations.js';
import { decoyMargin, decoyProgress } from './difficulty.js';

const TIMES = [0, 5, 19, 20, 30, 44, 45, 60, 90, 150, 300];

describe('evaluate', () => {
  it('computes the four operators', () => {
    expect(evaluate(4, '+', 3)).toBe(7);
    expect(evaluate(9, '-', 3)).toBe(6);
    expect(evaluate(7, '×', 8)).toBe(56);
    expect(evaluate(56, '÷', 8)).toBe(7);
  });
  it('treats non-integer division as invalid', () => {
    expect(evaluate(7, '÷', 2)).toBeNaN();
    expect(evaluate(7, '÷', 0)).toBeNaN();
  });
});

describe('makeEquation', () => {
  it('flags truth and builds tiles', () => {
    const eq = makeEquation(7, '×', 8, 54);
    expect(eq.isTrue).toBe(false);
    expect(eq.actual).toBe(56);
    expect(eq.tokens).toEqual(['7', '×', '8', '=', '5', '4']);
  });
});

describe('generateGate', () => {
  it('always has exactly one TRUE lane, at trueLane', () => {
    const rng = createRng(1);
    for (const t of TIMES) {
      for (let i = 0; i < 400; i++) {
        const { lanes, trueLane } = generateGate(rng, t);
        expect(lanes).toHaveLength(3);
        const trues = lanes.map((e, idx) => (e.isTrue ? idx : -1)).filter((x) => x >= 0);
        expect(trues).toEqual([trueLane]);
        // Every displayed equation is recomputed from scratch here, not
        // trusted from the generator's own flag.
        for (const eq of lanes) {
          expect(evaluate(eq.a, eq.op, eq.b) === eq.result).toBe(eq.isTrue);
        }
      }
    }
  });

  it('never shows negative numbers, fractions, or more than 8 tiles', () => {
    const rng = createRng(2);
    for (const t of TIMES) {
      for (let i = 0; i < 400; i++) {
        for (const eq of generateGate(rng, t).lanes) {
          for (const n of [eq.a, eq.b, eq.result, eq.actual]) {
            expect(Number.isInteger(n)).toBe(true);
            expect(n).toBeGreaterThanOrEqual(0);
          }
          expect(eq.tokens.length).toBeLessThanOrEqual(MAX_TILES);
        }
      }
    }
  });

  it('shows three distinct equations', () => {
    const rng = createRng(3);
    for (let i = 0; i < 1000; i++) {
      const texts = generateGate(rng, i % 120).lanes.map((e) => e.text);
      expect(new Set(texts).size).toBe(3);
    }
  });

  it('keeps lanes the same tile length (length is not a tell)', () => {
    const rng = createRng(4);
    let same = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const lens = generateGate(rng, i % 150).lanes.map((e) => e.tokens.length);
      if (new Set(lens).size === 1) same++;
      expect(Math.max(...lens) - Math.min(...lens)).toBeLessThanOrEqual(1);
    }
    expect(same / N).toBeGreaterThan(0.99);
  });

  it('puts the TRUE lane in each position roughly equally often', () => {
    const rng = createRng(5);
    const counts = [0, 0, 0];
    for (let i = 0; i < 3000; i++) counts[generateGate(rng, 10).trueLane]++;
    for (const c of counts) expect(c).toBeGreaterThan(850);
  });

  it('uses independent equations per lane (no "odd one out" shortcut)', () => {
    // If decoys were built from the true equation, the true lane would share
    // its left-hand side with a decoy far more often than decoys do with
    // each other. Check that sharing is rare and not biased to the truth.
    const rng = createRng(6);
    let trueShares = 0;
    for (let i = 0; i < 2000; i++) {
      const { lanes, trueLane } = generateGate(rng, 60);
      const lhs = lanes.map((e) => `${e.a}${e.op}${e.b}`);
      if (lhs.filter((x, j) => j !== trueLane).includes(lhs[trueLane])) trueShares++;
    }
    expect(trueShares / 2000).toBeLessThan(0.03);
  });
});

describe('difficulty tiers', () => {
  const opsSeen = (t) => {
    const rng = createRng(7);
    const seen = new Set();
    for (let i = 0; i < 600; i++) for (const e of generateGate(rng, t).lanes) seen.add(e.op);
    return seen;
  };
  it('starts with + and − only', () => {
    expect([...opsSeen(0)].sort()).toEqual(['+', '-']);
    expect([...opsSeen(19.9)].sort()).toEqual(['+', '-']);
  });
  it('introduces × at 20s', () => {
    expect(opsSeen(20).has('×')).toBe(true);
    expect(opsSeen(44).has('÷')).toBe(false);
  });
  it('introduces ÷ at 45s', () => {
    expect(opsSeen(45).has('÷')).toBe(true);
  });
});

describe('decoys', () => {
  it('are off by a lot early; sharp ones are off by 1–2, a classic slip, or a swapped operator', () => {
    const rng = createRng(8);
    for (const [t, p] of [
      [0, 0],
      [120, 1],
    ]) {
      const { min, max } = decoyMargin(p);
      for (let i = 0; i < 3000; i++) {
        const base = randomTrueEquation(rng, t);
        const d = makeDecoy(rng, base, p);
        if (!d) continue;
        expect(d.isTrue).toBe(false);
        expect(d.a).toBe(base.a);
        expect(d.b).toBe(base.b);
        const off = Math.abs(d.result - d.actual);
        switch (d.kind) {
          case 'offset':
            expect(off).toBeGreaterThanOrEqual(min);
            expect(off).toBeLessThanOrEqual(max);
            break;
          case 'carry':
            // forgot to carry / borrow: exactly 10 out, units digit intact
            expect(off).toBe(10);
            expect(d.result % 10).toBe(d.actual % 10);
            break;
          case 'table':
            // a neighbouring row of the times table
            if (d.op === '×') expect(off).toBe(d.a);
            else expect(off).toBe(1);
            break;
          case 'swap':
            expect(d.op).not.toBe(base.op);
            expect(d.result).toBe(base.actual);
            expect(d.swappedFrom).toBe(base.op);
            break;
          default:
            throw new Error(`unknown decoy kind ${d.kind}`);
        }
      }
    }
    expect(decoyMargin(0).min).toBeGreaterThanOrEqual(3);
    expect(decoyMargin(1)).toEqual({ min: 1, max: 2 });
  });

  it('swapped operators are still believable (no 29×8=21)', () => {
    const rng = createRng(10);
    for (let i = 0; i < 3000; i++) {
      const base = randomTrueEquation(rng, 90);
      const d = makeDecoy(rng, base, 1);
      if (d?.kind !== 'swap') continue;
      expect(d.actual).toBeLessThanOrEqual(3 * d.result + 10);
      expect(d.result).toBeLessThanOrEqual(3 * d.actual + 10);
    }
  });

  it('get sharper as the score climbs, not just the clock', () => {
    // Same time on the clock, different scores.
    expect(decoyProgress(10, 0)).toBeLessThan(0.1);
    expect(decoyProgress(10, 45)).toBe(1);
    const closeShare = (p) => {
      const rng = createRng(11);
      let close = 0;
      let n = 0;
      for (let i = 0; i < 1500; i++) {
        for (const e of generateGate(rng, 30, p).lanes) {
          if (e.isTrue) continue;
          n++;
          // "close cut": within 2, or a slip that keeps the units digit
          if (Math.abs(e.result - e.actual) <= 2 || e.result % 10 === e.actual % 10) close++;
        }
      }
      return close / n;
    };
    const easy = closeShare(0);
    const sharp = closeShare(1);
    expect(easy).toBeLessThan(0.45);
    expect(sharp).toBeGreaterThan(0.75);
  });

  it('prefer keeping the result digit count', () => {
    const rng = createRng(9);
    const base = makeEquation(6, '+', 4, 10);
    for (let i = 0; i < 200; i++) {
      const d = makeDecoy(rng, base, 0, ['+']);
      expect(String(d.result)).toHaveLength(2);
    }
  });
});

describe('explain', () => {
  it('produces the game-over sentence', () => {
    const e = explain(makeEquation(7, '×', 8, 54));
    expect(e.sentence).toBe("7×8=54 — it's actually 56");
    expect(e.corrected).toBe('7×8=56');
  });
  it('uses a real minus sign', () => {
    expect(explain(makeEquation(9, '-', 3, 5)).picked).toBe('9−3=5');
  });
});
