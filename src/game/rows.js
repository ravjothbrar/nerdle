// Row generation. Everything on the track arrives as a *row*: three lane
// slots side by side, all reaching the runner at the same moment. A slot is
// one of:
//
//   { type: 'eq', eq }   an equation panel — run through it: TRUE = coin,
//                        FALSE = the run is over (always)
//   { type: 'wall' }     a tall block — can't be jumped or ducked; steer round
//   { type: 'barrier' }  a low hurdle — jump it
//   { type: 'beam' }     an overhead bar — duck under it
//   { type: 'empty' }    open track
//
// Row kinds:
//   'maths'     three equations, exactly one true (the core of the game)
//   'mixed'     equations next to physical obstacles — e.g. a true and a false
//               equation beside a wall, or one equation (true OR false) beside
//               a hurdle and a wall: take the equation only if it's true,
//               otherwise take the jump
//   'obstacles' no maths at all — Subway-Surfers-style walls/hurdles/beams
//
// Every row always has at least one lane you can get through without losing
// your shield (a true equation, an open lane, a hurdle or a beam), and walls
// never fill all three lanes.

import { generateGate } from './equations.js';

export const WALL_LEN = 5; // world units a wall extends along the track

/** Seconds into a run before anything but maths rows can appear. */
export const MIXED_FROM = 8;

export const isSafeSlot = (slot) =>
  slot.type === 'empty' ||
  slot.type === 'barrier' ||
  slot.type === 'beam' ||
  (slot.type === 'eq' && slot.eq.isTrue);

const eqSlot = (eq) => ({ type: 'eq', eq });
const slot = (type) => ({ type });

/**
 * Pick the next row. `recent` is the list of recent row kinds (newest last),
 * used to keep maths rows the majority: never more than two non-maths rows in
 * a row.
 */
export function generateRow(rng, t, p, recent = [], level) {
  const nonMathsStreak = countTrailing(recent, (k) => k !== 'maths');
  let kind = 'maths';
  if (t >= MIXED_FROM && nonMathsStreak < 2) {
    const r = rng.next();
    if (r < 0.2) kind = 'mixed';
    else if (r < 0.45) kind = 'obstacles';
  }
  if (kind === 'maths') {
    return { kind, lanes: generateGate(rng, t, p, level).lanes.map(eqSlot) };
  }
  if (kind === 'mixed') return { kind, lanes: mixedLanes(rng, t, p, level) };
  return { kind, lanes: obstacleLanes(rng, t) };
}

function mixedLanes(rng, t, p, level) {
  const { lanes, trueLane } = generateGate(rng, t, p, level);
  const truth = lanes[trueLane];
  const decoy = lanes[(trueLane + 1) % 3];
  if (rng.chance(0.5)) {
    // Two equations and a wall: pick the true one.
    return rng.shuffle([eqSlot(truth), eqSlot(decoy), slot('wall')]);
  }
  // One equation — maybe true, maybe not — beside a hurdle/beam and a wall.
  const eq = rng.chance(0.5) ? truth : decoy;
  return rng.shuffle([eqSlot(eq), slot(rng.chance(0.5) ? 'barrier' : 'beam'), slot('wall')]);
}

function obstacleLanes(rng, t) {
  const r = rng.next();
  const late = t > 35;
  if (r < (late ? 0.12 : 0.22)) return [slot('barrier'), slot('barrier'), slot('barrier')];
  if (r < (late ? 0.24 : 0.44)) return [slot('beam'), slot('beam'), slot('beam')];
  if (r < (late ? 0.44 : 0.72)) {
    // Two walls and a gap — the gap may itself need a jump or a duck.
    const gap = rng.pick(late ? ['empty', 'barrier', 'beam'] : ['empty', 'empty', 'barrier']);
    return rng.shuffle([slot('wall'), slot('wall'), slot(gap)]);
  }
  // Free mix, one of everything-ish.
  for (;;) {
    const lanes = [0, 1, 2].map(() => slot(rng.pick(['wall', 'wall', 'barrier', 'beam', 'empty'])));
    const walls = lanes.filter((s) => s.type === 'wall').length;
    const empties = lanes.filter((s) => s.type === 'empty').length;
    if (walls >= 1 && walls <= 2 && empties <= 1) return lanes;
  }
}

function countTrailing(list, pred) {
  let n = 0;
  for (let i = list.length - 1; i >= 0 && pred(list[i]); i--) n++;
  return n;
}
