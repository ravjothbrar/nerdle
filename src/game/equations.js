// Equation generation — the heart of Nerdle Rush.
//
// Each gate shows three equations, exactly one of which is TRUE. Decoys are
// never random noise: every decoy starts life as a real, correct equation
// that is then perturbed — its result nudged by a small offset, or its
// operator swapped — so it *looks* right at a glance.
//
// Crucially, each lane gets its own base equation. If both decoys were
// derived from the true equation (7×8=56 / 7×8=54 / 7+8=56) the answer could
// be found without doing any maths: just pick the lane that shares the most
// with the other two. Independent bases make every lane an honest
// true-or-false check.

import {
  operatorsAt,
  operandRangesAt,
  decoyProgress,
  decoyMargin,
  classicSlipChance,
  operatorSwapChance,
} from './difficulty.js';

export const MAX_TILES = 8;

/** Evaluate `a op b`. Returns NaN for non-integer / undefined results. */
export function evaluate(a, op, b) {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '×':
      return a * b;
    case '÷':
      return b !== 0 && a % b === 0 ? a / b : NaN;
    default:
      throw new Error(`Unknown operator ${op}`);
  }
}

/** Build an equation object from its parts. */
export function makeEquation(a, op, b, result, kind = 'true') {
  const actual = evaluate(a, op, b);
  const text = `${a}${op}${b}=${result}`;
  return {
    a,
    op,
    b,
    result,
    actual,
    isTrue: actual === result,
    kind,
    text,
    tokens: [...text],
  };
}

/** Text with the ASCII minus replaced by a proper minus sign, for display. */
export const displayToken = (ch) => (ch === '-' ? '−' : ch);
export const displayText = (text) => [...text].map(displayToken).join('');

/** A random TRUE equation using one of the operators in `ops`. */
export function randomTrueEquation(rng, t, ops = operatorsAt(t)) {
  const r = operandRangesAt(t);
  for (;;) {
    const op = rng.pick(ops);
    let a;
    let b;
    switch (op) {
      case '+':
        a = rng.int(1, r.add.max);
        b = rng.int(1, r.add.max);
        break;
      case '-':
        a = rng.int(2, r.sub.max);
        b = rng.int(1, a - 1);
        break;
      case '×':
        a = rng.int(2, r.mul.aMax);
        b = rng.int(2, r.mul.bMax);
        if (rng.chance(0.5)) [a, b] = [b, a];
        break;
      case '÷': {
        b = rng.int(2, r.div.divisorMax);
        const q = rng.int(2, r.div.quotientMax);
        a = b * q;
        break;
      }
      default:
        throw new Error(op);
    }
    const eq = makeEquation(a, op, b, evaluate(a, op, b));
    if (eq.tokens.length <= MAX_TILES) return eq;
  }
}

const digits = (n) => String(n).length;

/**
 * Turn a TRUE equation into a plausible FALSE one. `p` (0..1) is decoy
 * sharpness — see decoyProgress(). Strategies:
 *  - 'offset': result nudged by the current margin (3–8 early, 1–2 sharp),
 *    keeping the digit count where possible
 *  - 'carry' : a forgotten carry/borrow — 47+28=65, 52−17=45 — which keeps
 *    the units digit right, so a quick last-digit check doesn't catch it
 *  - 'table' : a times-table neighbour — 7×8=48 (that's 6×8), 56÷8=6
 *  - 'swap'  : operator swapped, result kept — 9+3=6 (that's 9−3)
 * Returns null if no valid decoy exists for this base (caller retries).
 */
export function makeDecoy(rng, base, p, ops = ['+', '-', '×', '÷']) {
  const order = [];
  if (rng.chance(classicSlipChance(p))) order.push(slipDecoy);
  if (rng.chance(operatorSwapChance(p))) order.push(swapDecoy);
  order.push(offsetDecoy, swapDecoy);
  for (const strategy of order) {
    const d = strategy(rng, base, p, ops);
    if (d && !d.isTrue && d.result >= 0 && d.tokens.length <= MAX_TILES) return d;
  }
  return null;
}

function offsetDecoy(rng, base, p) {
  const { min, max } = decoyMargin(p);
  const candidates = [];
  for (let k = min; k <= max; k++) {
    for (const sign of [-1, 1]) {
      const r = base.actual + sign * k;
      if (r >= 0) candidates.push(r);
    }
  }
  // Prefer results with the same number of digits so the tile length does
  // not give the game away.
  const same = candidates.filter((r) => digits(r) === digits(base.actual));
  const pool = same.length ? same : candidates;
  if (!pool.length) return null;
  return makeEquation(base.a, base.op, base.b, rng.pick(pool), 'offset');
}

function slipDecoy(rng, base) {
  const { a, b, op, actual } = base;
  let r = null;
  const multiDigit = Math.max(a, b) >= 10;
  if (op === '+' && multiDigit && (a % 10) + (b % 10) >= 10) r = actual - 10; // forgot to carry
  else if (op === '-' && multiDigit && a % 10 < b % 10) r = actual + 10; // forgot to borrow
  else if (op === '×') r = actual + (rng.chance(0.5) ? a : -a); // neighbouring row
  else if (op === '÷') r = actual + (rng.chance(0.5) ? 1 : -1); // neighbouring row
  if (r == null || r < 0 || r === actual || digits(r) !== digits(actual)) return null;
  const eq = makeEquation(a, op, b, r, op === '×' || op === '÷' ? 'table' : 'carry');
  return eq;
}

function swapDecoy(rng, base, _p, ops) {
  const options = ops.filter((op) => {
    if (op === base.op) return false;
    const v = evaluate(base.a, op, base.b);
    // The "it's actually…" value must be a clean non-negative integer, and
    // the lie must be believable: 29×8=21 fools nobody.
    if (!Number.isInteger(v) || v < 0 || v === base.actual) return false;
    return v <= 3 * base.actual + 10 && base.actual <= 3 * v + 10;
  });
  if (!options.length) return null;
  const eq = makeEquation(base.a, rng.pick(options), base.b, base.actual, 'swap');
  eq.swappedFrom = base.op;
  return eq;
}

/**
 * Generate a gate: three equations, exactly one true. `t` (seconds) decides
 * which operators and operand sizes appear; `p` (0..1) how sharp the decoys
 * are. Returns { lanes: [eq, eq, eq], trueLane }.
 */
export function generateGate(rng, t, p = decoyProgress(t)) {
  const ops = operatorsAt(t);
  const truth = randomTrueEquation(rng, t, ops);
  const texts = new Set([truth.text]);
  const decoys = [];

  let attempts = 0;
  while (decoys.length < 2) {
    attempts++;
    const base = randomTrueEquation(rng, t, ops);
    const decoy = makeDecoy(rng, base, p, ops);
    if (!decoy || texts.has(decoy.text)) continue;
    // Match tile length with the true equation so length is not a tell.
    // After many attempts accept ±1 tile, then anything (never observed in
    // practice, but guarantees termination).
    const diff = Math.abs(decoy.tokens.length - truth.tokens.length);
    if (diff > 0 && attempts < 60) continue;
    if (diff > 1 && attempts < 120) continue;
    texts.add(decoy.text);
    decoys.push(decoy);
  }

  const trueLane = rng.int(0, 2);
  const lanes = [];
  let di = 0;
  for (let i = 0; i < 3; i++) lanes.push(i === trueLane ? truth : decoys[di++]);
  return { lanes, trueLane };
}

/** Human explanation for a false equation, e.g. "7×8=54 — it's actually 56". */
export function explain(eq) {
  const lhs = displayText(`${eq.a}${eq.op}${eq.b}`);
  return {
    picked: displayText(eq.text),
    lhs,
    actual: eq.actual,
    corrected: `${lhs}=${eq.actual}`,
    sentence: `${displayText(eq.text)} — it's actually ${eq.actual}`,
  };
}
