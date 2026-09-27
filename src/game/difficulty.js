// Every knob that makes a run harder lives here, as pure functions of the
// seconds survived and/or the number of correct lanes (coins). Keeping the curve in one place makes it easy to tune (and
// to test) without touching the engine or the equation generator.

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * Maths levels. Only the SUMS change between them — the track speed,
 * obstacles and scoring are identical, so a level is purely "how hard is the
 * arithmetic?".
 *
 *   easy    + and − within 20; × up to 5×5 later; no ÷. Decoys stay
 *           obviously wrong (never sharper than off-by-2ish).
 *   medium  the standard game.
 *   hard    two-digit numbers from the first row, × at 8s and ÷ at 20s with
 *           tables to 12, and decoys that start sharp (near-misses, carries).
 */
export const LEVELS = {
  easy: {
    id: 'easy',
    label: 'Easy',
    blurb: '+ and − to 20, small times tables',
    example: '8+5=13',
    unlock: { multiply: 25, divide: Infinity },
    ranges: {
      add: { min: [1, 1], max: [6, 10] },
      sub: { aMin: [2, 2], bMin: [1, 1], max: [10, 20] },
      mul: { min: [2, 2], aMax: [4, 5], bMax: [4, 5] },
      div: { divisorMax: [2, 2], quotientMax: [2, 2] },
    },
    sharp: { start: 0, byTime: 240, byCoins: 90, cap: 0.35 },
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    blurb: 'up to 99, × and ÷ tables to 12',
    example: '27+18=45',
    unlock: { multiply: 20, divide: 45 },
    ranges: {
      add: { min: [1, 1], max: [9, 49] },
      sub: { aMin: [2, 2], bMin: [1, 1], max: [18, 99] },
      mul: { min: [2, 2], aMax: [6, 9], bMax: [6, 12] },
      div: { divisorMax: [5, 9], quotientMax: [6, 12] },
    },
    sharp: { start: 0, byTime: 120, byCoins: 45, cap: 1 },
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    blurb: 'two-digit sums, full tables, sneaky decoys',
    example: '9×12=108',
    unlock: { multiply: 8, divide: 20 },
    ranges: {
      add: { min: [11, 14], max: [49, 49] },
      sub: { aMin: [21, 30], bMin: [6, 11], max: [60, 99] },
      mul: { min: [3, 4], aMax: [9, 12], bMax: [9, 12] },
      div: { divisorMax: [9, 12], quotientMax: [9, 12] },
    },
    sharp: { start: 0.4, byTime: 90, byCoins: 30, cap: 1 },
  },
};
export const LEVEL_IDS = ['easy', 'medium', 'hard'];
export const DEFAULT_LEVEL = 'medium';
const lv = (level) => LEVELS[level] ?? LEVELS[DEFAULT_LEVEL];

/** @deprecated medium-level unlock times, kept for reference in docs/tests. */
export const TIER_TIMES = LEVELS.medium.unlock;

/** Operators allowed at time `t` (seconds) on a given level. */
export function operatorsAt(t, level = DEFAULT_LEVEL) {
  const u = lv(level).unlock;
  const ops = ['+', '-'];
  if (t >= u.multiply) ops.push('×');
  if (t >= u.divide) ops.push('÷');
  return ops;
}

/** Seconds between rows: 2.5s at the start, easing towards 1.0s. */
export function gateIntervalAt(t) {
  return 1.0 + 1.5 * Math.exp(-t / 55);
}

/**
 * Seconds a row takes to travel from the horizon to the runner. The view
 * reaches far ahead (like Subway Surfers), so a row is on screen for 5.9s at
 * the start, tightening towards ~2.4s. World speed (units/s) is derived from
 * it: SPAWN_D / travelTimeAt(t).
 */
export const VIEW_SCALE = 100 / 75;
export function travelTimeAt(t) {
  return (1.8 + 2.6 * Math.exp(-t / 60)) * VIEW_SCALE;
}

/**
 * How "sharp" decoys are, 0..1. Driven by whichever is further along: time
 * survived or correct answers — so a player who is racking up a big score
 * gets close-cut decoys quickly, rather than waiting for the clock.
 */
export function decoyProgress(t, coins = 0, level = DEFAULT_LEVEL) {
  const k = lv(level).sharp;
  return Math.min(k.cap, clamp01(k.start + Math.max(t / k.byTime, coins / k.byCoins)));
}

/**
 * How far an 'offset' decoy's result may be from the real value, given
 * decoy progress `p`. Early decoys are off by a lot (3–8, easy to spot),
 * sharp ones are off by just 1–2.
 */
export function decoyMargin(p) {
  return { min: Math.round(3 - 2 * p), max: Math.round(8 - 6 * p) };
}

/**
 * Probability a decoy is a "classic slip" — the kind of mistake a person
 * actually makes: a forgotten carry (47+28=65) or a times-table neighbour
 * (7×8=48). These keep the last digit plausible, so the lazy units-digit
 * check stops working as the score climbs.
 */
export function classicSlipChance(p) {
  return 0.1 + 0.4 * p;
}

/** Probability a decoy uses a swapped operator instead (9+3=6). */
export function operatorSwapChance(p) {
  return 0.08 + 0.14 * p;
}

/**
 * Operand ranges grow over time. Equations are capped at 8 tiles — the same
 * length as a classic Nerdle row.
 */
export function operandRangesAt(t, level = DEFAULT_LEVEL) {
  const p = clamp01(t / 90);
  const r = lv(level).ranges;
  const lerp = ([a, b]) => Math.round(a + (b - a) * p);
  return {
    add: { min: lerp(r.add.min), max: lerp(r.add.max) }, // a + b, each operand min..max
    sub: { aMin: lerp(r.sub.aMin), bMin: lerp(r.sub.bMin), max: lerp(r.sub.max) }, // a − b: aMin ≤ a ≤ max, b ≥ bMin
    mul: { min: lerp(r.mul.min), aMax: lerp(r.mul.aMax), bMax: lerp(r.mul.bMax) },
    div: { divisorMax: lerp(r.div.divisorMax), quotientMax: lerp(r.div.quotientMax) },
  };
}

/**
 * Overdrive: once the score is really high (40+ correct lanes) the run keeps
 * accelerating past the normal time curve — up to 1.5× — so strong players
 * never plateau. Multiplies world speed and divides the gate interval.
 */
export const OVERDRIVE_FROM = 40;
export const OVERDRIVE_STEP = 15;

export function overdrive(coins) {
  return 1 + Math.min(0.5, Math.max(0, coins - OVERDRIVE_FROM) * 0.0125);
}

/** 0 before overdrive, then 1, 2, 3… every OVERDRIVE_STEP more correct lanes. */
export function speedLevel(coins) {
  return coins < OVERDRIVE_FROM ? 0 : 1 + Math.floor((coins - OVERDRIVE_FROM) / OVERDRIVE_STEP);
}
