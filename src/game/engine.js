// The simulation. No DOM, no canvas, no React: `createGame` builds a plain
// state object and `step` advances it by `dt` seconds given a list of player
// actions. Rendering, audio and UI all *read* this state (plus the `events`
// array each step emits) — which keeps the game logic fully unit-testable and
// lets the attract-mode bot drive the exact same code as a human.

import { createRng } from './rng.js';
import { generateGate } from './equations.js';
import {
  gateIntervalAt,
  travelTimeAt,
  operatorsAt,
  obstacleGapAt,
  decoyProgress,
  overdrive,
  speedLevel,
  FIRST_OBSTACLE_AT,
} from './difficulty.js';
import { multiplierFor, POINTS_PER_COIN } from './scoring.js';

// World geometry. Depth `d` is measured in world units ahead of the runner:
// things spawn at SPAWN_D and are resolved when they reach 0.
export const SPAWN_D = 75;
export const DESPAWN_D = -14;
export const LANES = 3;

export const JUMP_TIME = 0.62; // seconds airborne
export const DUCK_TIME = 0.62; // seconds ducking
export const BARRIER_CLEARANCE = 0.3; // jump height (0..1) needed to clear a barrier
export const INVULN_TIME = 1.2; // seconds of invulnerability after losing the shield
export const START_SHIELDS = 1;
export const DEATH_DELAY = 1.1; // seconds of death animation before "over"
export const INPUT_BUFFER = 0.14; // seconds a jump/duck press is remembered

/** Metres of "distance" per world unit, purely for the stats readout. */
export const METRES_PER_UNIT = 0.5;

/**
 * `scripted: true` turns off automatic spawning (the tutorial places gates and
 * obstacles itself with spawnGate / spawnObstacle).
 */
export function createGame({ seed = Date.now(), firstGateDelay = 0.35, scripted = false } = {}) {
  return {
    seed,
    rng: createRng(seed),
    status: 'running', // 'running' | 'dying' | 'over'
    scripted,
    hold: false, // tutorial freeze: the world stops, the runner can still steer
    t: 0,
    distance: 0,
    speed: SPAWN_D / travelTimeAt(0),
    player: {
      lane: 1,
      laneVisual: 1,
      jumpT: -1, // 0..1 while airborne, -1 when grounded
      duckT: -1, // 0..1 while ducking, -1 otherwise
      bufferedJump: 0,
      bufferedDuck: 0,
      invuln: 0,
    },
    shields: START_SHIELDS,
    streak: 0,
    bestStreak: 0,
    multiplier: 1,
    coins: 0,
    score: 0,
    gates: [],
    obstacles: [],
    nextGateAt: scripted ? Infinity : firstGateDelay,
    nextObstacleAt: scripted ? Infinity : FIRST_OBSTACLE_AT,
    speedLevel: 0,
    nextId: 1,
    opsUnlocked: operatorsAt(0).length,
    history: [], // one entry per resolved gate / hit: 'correct' | 'wrong' | 'shield' | 'crash'
    death: null,
    deathTimer: 0,
    firstBarrierSeen: false,
    firstBeamSeen: false,
    events: [],
  };
}

/** Height of the runner (0..1) for a given jump phase. */
export function jumpHeight(jumpT) {
  if (jumpT < 0) return 0;
  return 4 * jumpT * (1 - jumpT);
}

/**
 * Advance the game by `dt` seconds.
 * `actions` is an array of 'left' | 'right' | 'jump' | 'duck'.
 * Returns the events produced during this step (also stored on state.events).
 */
export function step(g, dt, actions = []) {
  g.events = [];
  if (g.status === 'over') return g.events;
  if (g.status === 'dying') {
    g.deathTimer += dt;
    if (g.deathTimer >= DEATH_DELAY) {
      g.status = 'over';
      g.events.push({ type: 'over' });
    }
    return g.events;
  }

  applyActions(g, actions);
  if (g.hold) {
    tweenLane(g.player, dt);
    return g.events;
  }
  g.t += dt;
  g.speed = worldSpeed(g);
  const dd = g.speed * dt;
  g.distance += dd * METRES_PER_UNIT;

  updatePlayer(g, dt);
  spawn(g);

  // Move the world towards the runner and resolve anything that reached it.
  for (const gate of g.gates) {
    const before = gate.d;
    gate.d -= dd;
    if (!gate.resolved && before > 0 && gate.d <= 0) resolveGate(g, gate);
    if (g.status !== 'running') break;
  }
  if (g.status === 'running') {
    for (const ob of g.obstacles) {
      const before = ob.d;
      ob.d -= dd;
      if (!ob.resolved && before > 0 && ob.d <= 0) resolveObstacle(g, ob);
      if (g.status !== 'running') break;
    }
  }

  g.gates = g.gates.filter((x) => x.d > DESPAWN_D);
  g.obstacles = g.obstacles.filter((x) => x.d > DESPAWN_D);
  return g.events;
}

function applyActions(g, actions) {
  const p = g.player;
  for (const a of actions) {
    if (a === 'left' || a === 'right') {
      const lane = Math.max(0, Math.min(LANES - 1, p.lane + (a === 'left' ? -1 : 1)));
      if (lane !== p.lane) {
        p.lane = lane;
        g.events.push({ type: 'lane', lane });
      } else {
        g.events.push({ type: 'bump', dir: a });
      }
    } else if (a === 'jump') {
      p.bufferedJump = INPUT_BUFFER;
    } else if (a === 'duck') {
      p.bufferedDuck = INPUT_BUFFER;
    }
  }
}

/** World speed (units/s): the time curve, boosted by overdrive at high scores. */
export function worldSpeed(g) {
  return (SPAWN_D / travelTimeAt(g.t)) * overdrive(g.coins);
}

function tweenLane(p, dt) {
  // Smooth lane tween (visual only — the logical lane switches instantly).
  const k = 1 - Math.exp(-dt * 22);
  p.laneVisual += (p.lane - p.laneVisual) * k;
  if (Math.abs(p.lane - p.laneVisual) < 0.001) p.laneVisual = p.lane;
}

function updatePlayer(g, dt) {
  const p = g.player;
  tweenLane(p, dt);

  if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);

  if (p.jumpT >= 0) {
    p.jumpT += dt / JUMP_TIME;
    if (p.jumpT >= 1) p.jumpT = -1;
  }
  if (p.duckT >= 0) {
    p.duckT += dt / DUCK_TIME;
    if (p.duckT >= 1) p.duckT = -1;
  }

  if (p.bufferedDuck > 0) {
    // Duck always wins: mid-air it slams you back to the ground (fast-fall).
    p.jumpT = -1;
    p.duckT = 0;
    p.bufferedDuck = 0;
    p.bufferedJump = 0;
    g.events.push({ type: 'duck' });
  } else if (p.bufferedJump > 0) {
    if (p.jumpT < 0) {
      p.duckT = -1;
      p.jumpT = 0;
      p.bufferedJump = 0;
      g.events.push({ type: 'jump' });
    } else {
      p.bufferedJump = Math.max(0, p.bufferedJump - dt);
    }
  }
}

function spawn(g) {
  if (g.scripted) return;
  if (g.t >= g.nextGateAt) {
    const { lanes, trueLane } = generateGate(g.rng, g.t, decoyProgress(g.t, g.coins));
    spawnGate(g, lanes, trueLane);
    g.nextGateAt = g.t + gateInterval(g);
    const ops = operatorsAt(g.t);
    if (ops.length > g.opsUnlocked) {
      g.opsUnlocked = ops.length;
      g.events.push({ type: 'unlock', op: ops[ops.length - 1] });
    }
  }

  if (g.t >= g.nextObstacleAt) {
    // Keep jumps/ducks well clear of lane decisions so both are always
    // physically possible: no obstacle reaches the runner within `gapT`
    // seconds of a gate.
    const gapT = Math.min(0.42, gateInterval(g) * 0.4);
    const gapD = gapT * g.speed;
    const nearGate = g.gates.some((x) => Math.abs(x.d - SPAWN_D) < gapD);
    const gateSoon = g.nextGateAt - g.t < gapT;
    if (nearGate || gateSoon) return; // try again next frame

    spawnObstacle(g, g.rng.chance(0.5) ? 'barrier' : 'beam');
    const { min, max } = obstacleGapAt(g.t);
    g.nextObstacleAt = g.t + min + g.rng.next() * (max - min);
  }
}

function gateInterval(g) {
  return gateIntervalAt(g.t) / overdrive(g.coins);
}

export function spawnGate(g, lanes, trueLane) {
  const gate = { id: g.nextId++, d: SPAWN_D, lanes, trueLane, resolved: false, spawnedAt: g.t };
  g.gates.push(gate);
  return gate;
}

export function spawnObstacle(g, kind) {
  const tutorial = (kind === 'barrier' && !g.firstBarrierSeen) || (kind === 'beam' && !g.firstBeamSeen);
  if (kind === 'barrier') g.firstBarrierSeen = true;
  else g.firstBeamSeen = true;
  const ob = { id: g.nextId++, kind, d: SPAWN_D, resolved: false, hit: false, tutorial };
  g.obstacles.push(ob);
  return ob;
}

function resolveGate(g, gate) {
  gate.resolved = true;
  gate.chosen = g.player.lane;
  const eq = gate.lanes[gate.chosen];
  if (eq.isTrue) {
    gate.result = 'correct';
    g.streak++;
    g.bestStreak = Math.max(g.bestStreak, g.streak);
    const prev = g.multiplier;
    g.multiplier = multiplierFor(g.streak);
    g.coins++;
    const points = POINTS_PER_COIN * g.multiplier;
    g.score += points;
    g.history.push('correct');
    g.events.push({ type: 'coin', gateId: gate.id, lane: gate.chosen, points, multiplier: g.multiplier, streak: g.streak });
    if (g.multiplier > prev) g.events.push({ type: 'multiplier', multiplier: g.multiplier });
    const level = speedLevel(g.coins);
    if (level > g.speedLevel) {
      g.speedLevel = level;
      g.events.push({ type: 'speedup', level });
    }
  } else {
    gate.result = 'wrong';
    g.history.push('wrong');
    die(g, {
      cause: 'equation',
      equation: eq,
      trueEquation: gate.lanes[gate.trueLane],
      lane: gate.chosen,
      gateId: gate.id,
    });
  }
}

function resolveObstacle(g, ob) {
  ob.resolved = true;
  const p = g.player;
  const cleared =
    ob.kind === 'barrier' ? jumpHeight(p.jumpT) >= BARRIER_CLEARANCE : p.duckT >= 0;
  if (cleared) {
    ob.cleared = true;
    g.events.push({ type: 'cleared', kind: ob.kind });
    return;
  }
  if (p.invuln > 0) return; // still flashing from the last hit
  ob.hit = true;
  if (g.shields > 0) {
    g.shields--;
    g.streak = 0;
    g.multiplier = 1;
    p.invuln = INVULN_TIME;
    g.history.push('shield');
    g.events.push({ type: 'shield', kind: ob.kind });
  } else {
    g.history.push('crash');
    die(g, { cause: 'obstacle', kind: ob.kind });
  }
}

function die(g, death) {
  g.status = 'dying';
  g.death = death;
  g.deathTimer = 0;
  g.events.push({ type: 'death', ...death });
}

/** Everything the game-over screen needs, detached from live state. */
export function summarize(g) {
  return {
    score: g.score,
    coins: g.coins,
    distance: Math.round(g.distance),
    time: g.t,
    bestStreak: g.bestStreak,
    history: g.history.slice(),
    death: g.death,
    seed: g.seed,
  };
}
