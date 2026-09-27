// The simulation. No DOM, no canvas, no React: `createGame` builds a plain
// state object and `step` advances it by `dt` seconds given a list of player
// actions. Rendering, audio and UI all *read* this state (plus the `events`
// array each step emits) — which keeps the game logic fully unit-testable and
// lets the attract-mode bot drive the exact same code as a human.

import { createRng } from './rng.js';
import { generateRow, WALL_LEN, isSafeSlot } from './rows.js';
import { gateIntervalAt, travelTimeAt, operatorsAt, decoyProgress, overdrive, speedLevel } from './difficulty.js';
import { multiplierFor, POINTS_PER_COIN } from './scoring.js';

export { WALL_LEN, isSafeSlot };

// World geometry. Depth `d` is measured in world units ahead of the runner:
// rows spawn at SPAWN_D and are resolved when their front edge reaches 0.
export const SPAWN_D = 100;
export const DESPAWN_D = -14;
export const LANES = 3;

export const JUMP_TIME = 0.62; // seconds airborne
export const DUCK_TIME = 0.62; // seconds ducking
export const BARRIER_CLEARANCE = 0.3; // jump height (0..1) needed to clear a hurdle
export const INVULN_TIME = 1.2; // seconds of invulnerability after losing the shield
export const START_SHIELDS = 1;
export const DEATH_DELAY = 1.1; // seconds of death animation before "over"
export const INPUT_BUFFER = 0.14; // seconds a jump/duck press is remembered

/** Metres of "distance" per world unit, purely for the stats readout. */
export const METRES_PER_UNIT = 0.4;

/**
 * `scripted: true` turns off automatic spawning (the tutorial places rows
 * itself with spawnRow).
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
    rows: [],
    recentKinds: [],
    nextRowAt: scripted ? Infinity : firstGateDelay,
    speedLevel: 0,
    nextId: 1,
    opsUnlocked: operatorsAt(0).length,
    history: [], // 'correct' | 'wrong' | 'shield' | 'crash', in order
    death: null,
    deathTimer: 0,
    seen: {}, // first-time flags for coach hints: barrier, beam, wall, mixed
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
  for (const row of g.rows) {
    const before = row.d;
    row.d -= dd;
    if (!row.resolved && before > 0 && row.d <= 0) resolveRow(g, row);
    if (g.status !== 'running') break;
  }

  g.rows = g.rows.filter((r) => r.d + (r.hasWall ? WALL_LEN : 0) > DESPAWN_D);
  return g.events;
}

function applyActions(g, actions) {
  const p = g.player;
  for (const a of actions) {
    if (a === 'left' || a === 'right') {
      const lane = Math.max(0, Math.min(LANES - 1, p.lane + (a === 'left' ? -1 : 1)));
      if (lane !== p.lane && wallAlongside(g, lane)) {
        // You can't sidestep into the flank of a wall that's passing you.
        g.events.push({ type: 'bump', dir: a, wall: true });
      } else if (lane !== p.lane) {
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

/** Is a wall's body currently right beside the runner in `lane`? */
export function wallAlongside(g, lane) {
  return g.rows.some((r) => r.lanes[lane].type === 'wall' && r.d <= 0.6 && r.d + WALL_LEN > -0.4);
}

function spawn(g) {
  if (g.scripted || g.t < g.nextRowAt) return;
  if (g.nextId === 1) {
    // Open with a row already part-way down the track, so the first
    // equation reaches you in ~3.5s rather than a full horizon-to-feet trip.
    const lead = generateRow(g.rng, g.t, decoyProgress(g.t, g.coins), g.recentKinds);
    spawnRow(g, lead.lanes, lead.kind, SPAWN_D - g.speed * rowInterval(g));
    g.recentKinds.push(lead.kind);
  }
  const { kind, lanes } = generateRow(g.rng, g.t, decoyProgress(g.t, g.coins), g.recentKinds);
  spawnRow(g, lanes, kind);
  g.recentKinds = [...g.recentKinds.slice(-4), kind];
  g.nextRowAt = g.t + rowInterval(g);
  const ops = operatorsAt(g.t);
  if (ops.length > g.opsUnlocked) {
    g.opsUnlocked = ops.length;
    g.events.push({ type: 'unlock', op: ops[ops.length - 1] });
  }
}

/** Seconds between rows: the time curve, tightened further by overdrive. */
export function rowInterval(g) {
  return gateIntervalAt(g.t) / overdrive(g.coins);
}

/** Put a row on the track at the horizon. */
export function spawnRow(g, lanes, kind = 'maths', d = SPAWN_D) {
  const trueLane = lanes.findIndex((s) => s.type === 'eq' && s.eq.isTrue);
  const hasWall = lanes.some((s) => s.type === 'wall');
  // First sighting of each thing gets a one-off coach hint in the HUD.
  let coach = null;
  if (kind === 'mixed' && !g.seen.mixed) coach = 'mixed';
  else if (hasWall && !g.seen.wall) coach = 'wall';
  else {
    for (const s of lanes) {
      if ((s.type === 'barrier' || s.type === 'beam') && !g.seen[s.type]) coach = s.type;
    }
  }
  if (coach) g.seen[coach] = true;
  for (const s of lanes) if (s.type === 'wall' && s.variant == null) s.variant = g.nextId % 3;
  const row = {
    id: g.nextId++,
    kind,
    d,
    lanes,
    trueLane,
    hasWall,
    coach,
    resolved: false,
    spawnedAt: g.t,
  };
  g.rows.push(row);
  return row;
}

function resolveRow(g, row) {
  row.resolved = true;
  row.chosen = g.player.lane;
  const s = row.lanes[row.chosen];
  const p = g.player;

  if (s.type === 'eq') {
    if (s.eq.isTrue) {
      row.result = 'correct';
      collect(g, row);
    } else {
      row.result = 'wrong';
      g.history.push('wrong');
      const truth = row.trueLane >= 0 ? row.lanes[row.trueLane].eq : null;
      die(g, { cause: 'equation', equation: s.eq, trueEquation: truth, lane: row.chosen, rowId: row.id });
    }
    return;
  }
  if (s.type === 'empty') {
    row.result = 'passed';
    return;
  }
  const cleared =
    (s.type === 'barrier' && jumpHeight(p.jumpT) >= BARRIER_CLEARANCE) || (s.type === 'beam' && p.duckT >= 0);
  if (cleared) {
    row.result = 'cleared';
    g.events.push({ type: 'cleared', kind: s.type, lane: row.chosen });
    return;
  }
  row.result = 'hit';
  if (p.invuln > 0) return; // still flashing from the last hit
  if (g.shields > 0) {
    g.shields--;
    g.streak = 0;
    g.multiplier = 1;
    p.invuln = INVULN_TIME;
    g.history.push('shield');
    g.events.push({ type: 'shield', kind: s.type, lane: row.chosen });
  } else {
    g.history.push('crash');
    die(g, { cause: 'obstacle', kind: s.type, lane: row.chosen, rowId: row.id });
  }
}

function collect(g, row) {
  g.streak++;
  g.bestStreak = Math.max(g.bestStreak, g.streak);
  const prev = g.multiplier;
  g.multiplier = multiplierFor(g.streak);
  g.coins++;
  const points = POINTS_PER_COIN * g.multiplier;
  g.score += points;
  g.history.push('correct');
  g.events.push({ type: 'coin', rowId: row.id, lane: row.chosen, points, multiplier: g.multiplier, streak: g.streak });
  if (g.multiplier > prev) g.events.push({ type: 'multiplier', multiplier: g.multiplier });
  const level = speedLevel(g.coins);
  if (level > g.speedLevel) {
    g.speedLevel = level;
    g.events.push({ type: 'speedup', level });
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
