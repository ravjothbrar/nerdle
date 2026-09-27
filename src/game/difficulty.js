// Every knob that makes a run harder lives here, as pure functions of the
// seconds survived and/or the number of correct lanes (coins). Keeping the curve in one place makes it easy to tune (and
// to test) without touching the engine or the equation generator.

export const TIER_TIMES = { multiply: 20, divide: 45 };

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Operators allowed at time `t` (seconds). */
export function operatorsAt(t) {
  if (t < TIER_TIMES.multiply) return ['+', '-'];
  if (t < TIER_TIMES.divide) return ['+', '-', '×'];
  return ['+', '-', '×', '÷'];
}

/** Seconds between equation gates: 2.5s at the start, easing towards 1.0s. */
export function gateIntervalAt(t) {
  return 1.0 + 1.5 * Math.exp(-t / 55);
}

/**
 * Seconds a gate takes to travel from the horizon to the runner. This is the
 * player's whole reading window, so it starts generous (4.4s) and tightens
 * towards ~1.8s. The world speed is derived from it.
 */
export function travelTimeAt(t) {
  return 1.8 + 2.6 * Math.exp(-t / 60);
}

/**
 * How "sharp" decoys are, 0..1. Driven by whichever is further along: time
 * survived or correct answers — so a player who is racking up a big score
 * gets close-cut decoys quickly, rather than waiting for the clock.
 */
export function decoyProgress(t, coins = 0) {
  return clamp01(Math.max(t / 120, coins / 45));
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
export function operandRangesAt(t) {
  const p = clamp01(t / 90);
  const lerp = (a, b) => Math.round(a + (b - a) * p);
  return {
    add: { max: lerp(9, 49) }, // a + b, each operand 1..max
    sub: { max: lerp(18, 99) }, // a - b, a up to max
    mul: { aMax: lerp(6, 9), bMax: lerp(6, 12) },
    div: { divisorMax: lerp(5, 9), quotientMax: lerp(6, 12) },
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

/** Physical obstacles (jump / duck) start after a short grace period. */
export const FIRST_OBSTACLE_AT = 7;

/** [min, max] seconds between physical obstacles. */
export function obstacleGapAt(t) {
  const p = clamp01((t - FIRST_OBSTACLE_AT) / 100);
  return { min: 3.6 - 1.6 * p, max: 6 - 2.6 * p };
}
