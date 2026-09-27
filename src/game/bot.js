// A tiny autopilot. It powers the attract-mode run behind the start screen
// and, in tests, proves every generated run is physically survivable.

import { JUMP_TIME, DUCK_TIME } from './engine.js';

export function createBot({ reaction = 0 } = {}) {
  let cooldown = 0;
  return function think(g, dt) {
    const actions = [];
    if (g.status !== 'running') return actions;
    cooldown -= dt;
    const p = g.player;

    // Steer one lane at a time towards the TRUE lane of the next gate — but
    // only once it has been on screen for `reaction` seconds.
    const gate = g.gates
      .filter((x) => !x.resolved && g.t - x.spawnedAt >= reaction)
      .sort((a, b) => a.d - b.d)[0];
    if (gate && cooldown <= 0 && p.lane !== gate.trueLane) {
      actions.push(gate.trueLane < p.lane ? 'left' : 'right');
      cooldown = 0.12;
    }

    const ob = g.obstacles.filter((x) => !x.resolved).sort((a, b) => a.d - b.d)[0];
    if (ob) {
      const eta = ob.d / g.speed;
      if (ob.kind === 'barrier' && p.jumpT < 0 && eta < JUMP_TIME * 0.45) actions.push('jump');
      if (ob.kind === 'beam' && p.duckT < 0 && eta < DUCK_TIME * 0.4) actions.push('duck');
    }
    return actions;
  };
}
