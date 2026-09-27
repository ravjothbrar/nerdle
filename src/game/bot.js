// A tiny autopilot. It powers the attract-mode run behind the start screen
// and, in tests, proves every generated run is physically survivable.

import { JUMP_TIME, DUCK_TIME, isSafeSlot } from './engine.js';

/** How much the bot likes a lane slot (higher is better; -1 = never). */
function slotScore(s) {
  if (s.type === 'eq') return s.eq.isTrue ? 3 : -1; // coins!
  if (s.type === 'empty') return 2;
  if (s.type === 'barrier' || s.type === 'beam') return 1;
  return -1; // wall
}

/** Best lane for a row from `from`: highest score, then fewest moves. */
export function bestLane(row, from) {
  let best = from;
  let bestKey = -Infinity;
  for (let lane = 0; lane < 3; lane++) {
    const s = row.lanes[lane];
    if (!isSafeSlot(s)) continue;
    const key = slotScore(s) * 10 - Math.abs(lane - from);
    if (key > bestKey) {
      bestKey = key;
      best = lane;
    }
  }
  return best;
}

export function createBot({ reaction = 0 } = {}) {
  let cooldown = 0;
  return function think(g, dt) {
    const actions = [];
    if (g.status !== 'running') return actions;
    cooldown -= dt;
    const p = g.player;

    const row = g.rows
      .filter((x) => !x.resolved && g.t - x.spawnedAt >= reaction)
      .sort((a, b) => a.d - b.d)[0];
    if (!row) return actions;

    // Steer one lane at a time towards the best lane of the next row.
    const target = bestLane(row, p.lane);
    if (cooldown <= 0 && p.lane !== target) {
      actions.push(target < p.lane ? 'left' : 'right');
      cooldown = 0.1;
    }

    // Jump / duck for whatever is in our lane.
    const s = row.lanes[p.lane];
    const eta = row.d / g.speed;
    if (s.type === 'barrier' && p.jumpT < 0 && eta < JUMP_TIME * 0.45) actions.push('jump');
    if (s.type === 'beam' && p.duckT < 0 && eta < DUCK_TIME * 0.4) actions.push('duck');
    return actions;
  };
}
