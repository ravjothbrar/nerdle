import { describe, it, expect } from 'vitest';
import {
  createGame,
  step,
  jumpHeight,
  summarize,
  SPAWN_D,
  START_SHIELDS,
  INVULN_TIME,
} from './engine.js';
import { createBot } from './bot.js';
import { gateIntervalAt, travelTimeAt, operatorsAt, overdrive, speedLevel, OVERDRIVE_FROM } from './difficulty.js';
import { multiplierFor, POINTS_PER_COIN } from './scoring.js';

const DT = 1 / 60;

/** Run until the first gate exists, returning it. */
function firstGate(g) {
  while (!g.gates.length) step(g, DT);
  return g.gates[0];
}

/** Step until a given gate is resolved, holding the runner in `lane`. */
function driveThroughGate(g, gate, lane, actionsEachFrame = []) {
  g.player.lane = lane;
  while (!gate.resolved && g.status === 'running') {
    g.player.lane = lane;
    step(g, DT, actionsEachFrame);
  }
}

/** A game with obstacles pushed far into the future. */
const calmGame = (seed = 1) => {
  const g = createGame({ seed });
  g.nextObstacleAt = Infinity;
  return g;
};

describe('equation gates', () => {
  it('TRUE lane: coin, points, streak', () => {
    const g = calmGame();
    const gate = firstGate(g);
    driveThroughGate(g, gate, gate.trueLane);
    expect(gate.result).toBe('correct');
    expect(g.status).toBe('running');
    expect(g.coins).toBe(1);
    expect(g.streak).toBe(1);
    expect(g.score).toBe(POINTS_PER_COIN);
    expect(g.events.some((e) => e.type === 'coin')).toBe(true);
  });

  it('FALSE lane: instant death, even with a shield', () => {
    const g = calmGame();
    expect(g.shields).toBe(START_SHIELDS);
    const gate = firstGate(g);
    const wrong = [0, 1, 2].find((l) => l !== gate.trueLane);
    driveThroughGate(g, gate, wrong);
    expect(g.status).toBe('dying');
    expect(g.shields).toBe(START_SHIELDS); // shield never protects from maths
    expect(g.death.cause).toBe('equation');
    expect(g.death.equation).toBe(gate.lanes[wrong]);
    expect(g.death.equation.isTrue).toBe(false);
    expect(g.death.trueEquation.isTrue).toBe(true);
  });

  it('FALSE lane kills late into a long run too', () => {
    const g = calmGame(9);
    for (let i = 0; i < 30; i++) {
      const gate = g.gates.find((x) => !x.resolved) ?? firstGate(g);
      driveThroughGate(g, gate, gate.trueLane);
    }
    expect(g.streak).toBe(30);
    const gate = g.gates.find((x) => !x.resolved) ?? (step(g, 3), g.gates.find((x) => !x.resolved));
    driveThroughGate(g, gate, (gate.trueLane + 1) % 3);
    expect(g.status).toBe('dying');
  });

  it('goes from dying to over after the death animation', () => {
    const g = calmGame();
    const gate = firstGate(g);
    driveThroughGate(g, gate, (gate.trueLane + 1) % 3);
    for (let i = 0; i < 120; i++) step(g, DT);
    expect(g.status).toBe('over');
    const s = summarize(g);
    expect(s.history.at(-1)).toBe('wrong');
  });

  it('the lane at the moment of crossing is what counts', () => {
    const g = calmGame();
    const gate = firstGate(g);
    const wrong = (gate.trueLane + 1) % 3;
    g.player.lane = wrong;
    // Sit in the wrong lane until the last frame, then dodge into the truth.
    while (gate.d - g.speed * DT > 0) step(g, DT);
    g.player.lane = gate.trueLane;
    step(g, DT);
    expect(gate.result).toBe('correct');
  });

  it('streak multiplier scales coin value', () => {
    const g = calmGame(3);
    let expected = 0;
    for (let i = 1; i <= 12; i++) {
      const gate = g.gates.find((x) => !x.resolved) ?? firstGate(g);
      driveThroughGate(g, gate, gate.trueLane);
      expected += POINTS_PER_COIN * multiplierFor(i);
    }
    expect(g.score).toBe(expected);
    expect(g.multiplier).toBe(3);
  });
});

describe('lanes', () => {
  it('clamps to the three lanes', () => {
    const g = calmGame();
    step(g, DT, ['left', 'left', 'left']);
    expect(g.player.lane).toBe(0);
    step(g, DT, ['right', 'right', 'right', 'right']);
    expect(g.player.lane).toBe(2);
  });
});

describe('physical obstacles', () => {
  const withObstacle = (kind) => {
    const g = createGame({ seed: 2, firstGateDelay: Infinity });
    g.nextObstacleAt = Infinity;
    g.obstacles.push({ id: 99, kind, d: 10, resolved: false });
    return g;
  };
  /** Let the first obstacle reach the runner with no input at all. */
  const runUntilResolved = (g) => {
    const ob = g.obstacles[0];
    while (!ob.resolved) step(g, DT);
    return ob;
  };

  it('a well-timed jump clears a barrier', () => {
    const g = withObstacle('barrier');
    const ob = g.obstacles[0];
    while (!ob.resolved) {
      const eta = ob.d / g.speed;
      step(g, DT, eta < 0.25 && g.player.jumpT < 0 ? ['jump'] : []);
    }
    expect(ob.cleared).toBe(true);
    expect(g.shields).toBe(START_SHIELDS);
  });

  it('a well-timed duck clears a beam', () => {
    const g = withObstacle('beam');
    const ob = g.obstacles[0];
    while (!ob.resolved) {
      const eta = ob.d / g.speed;
      step(g, DT, eta < 0.2 && g.player.duckT < 0 ? ['duck'] : []);
    }
    expect(ob.cleared).toBe(true);
  });

  it('ducking does not clear a barrier, jumping does not clear a beam', () => {
    for (const [kind, action] of [
      ['barrier', 'duck'],
      ['beam', 'jump'],
    ]) {
      const g = withObstacle(kind);
      const ob = g.obstacles[0];
      while (!ob.resolved) step(g, DT, ob.d / g.speed < 0.2 ? [action] : []);
      expect(ob.hit).toBe(true);
    }
  });

  it('first hit costs the shield and the multiplier, not the run', () => {
    const g = withObstacle('barrier');
    g.streak = 12;
    g.multiplier = 3;
    runUntilResolved(g);
    expect(g.status).toBe('running');
    expect(g.shields).toBe(0);
    expect(g.streak).toBe(0);
    expect(g.multiplier).toBe(1);
    expect(g.player.invuln).toBeGreaterThan(INVULN_TIME - 0.1);
    expect(g.history).toEqual(['shield']);
  });

  it('second hit with no shield ends the run', () => {
    const g = withObstacle('beam');
    g.shields = 0;
    runUntilResolved(g);
    expect(g.status).toBe('dying');
    expect(g.death).toEqual({ cause: 'obstacle', kind: 'beam' });
  });

  it('invulnerability frames ignore an immediate second hit', () => {
    const g = withObstacle('barrier');
    g.obstacles.push({ id: 100, kind: 'beam', d: 12, resolved: false });
    while (g.obstacles.some((o) => !o.resolved)) step(g, DT);
    expect(g.status).toBe('running');
    expect(g.shields).toBe(0);
  });

  it('duck in mid-air fast-falls; jump from a duck cancels it', () => {
    const g = calmGame();
    step(g, DT, ['jump']);
    expect(g.player.jumpT).toBeGreaterThanOrEqual(0);
    step(g, DT, ['duck']);
    expect(g.player.jumpT).toBe(-1);
    expect(g.player.duckT).toBeGreaterThanOrEqual(0);
    step(g, DT, ['jump']);
    expect(g.player.duckT).toBe(-1);
    expect(g.player.jumpT).toBeGreaterThanOrEqual(0);
  });

  it('jump height peaks at 1 mid-jump', () => {
    expect(jumpHeight(-1)).toBe(0);
    expect(jumpHeight(0.5)).toBe(1);
  });

  it('never lands an obstacle on top of a gate', () => {
    for (let seed = 0; seed < 10; seed++) {
      const g = createGame({ seed });
      const bot = createBot();
      const crossings = { gate: [], ob: [] };
      while (g.t < 150 && g.status === 'running') {
        const gates = g.gates.filter((x) => !x.resolved);
        const obs = g.obstacles.filter((x) => !x.resolved);
        step(g, DT, bot(g, DT));
        gates.filter((x) => x.resolved).forEach(() => crossings.gate.push(g.t));
        obs.filter((x) => x.resolved).forEach(() => crossings.ob.push(g.t));
      }
      for (const to of crossings.ob) {
        for (const tg of crossings.gate) expect(Math.abs(to - tg)).toBeGreaterThan(0.3);
      }
    }
  });
});

describe('difficulty over a run', () => {
  it('spawn interval ramps from 2.5s towards 1s, travel time shrinks', () => {
    expect(gateIntervalAt(0)).toBeCloseTo(2.5);
    expect(gateIntervalAt(300)).toBeLessThan(1.02);
    for (let t = 0; t < 300; t += 5) {
      expect(gateIntervalAt(t + 5)).toBeLessThan(gateIntervalAt(t));
      expect(travelTimeAt(t + 5)).toBeLessThan(travelTimeAt(t));
    }
  });

  it('announces × and ÷ unlocks', () => {
    const g = calmGame();
    const unlocks = [];
    const bot = createBot();
    while (g.t < 50 && g.status === 'running') {
      for (const e of step(g, DT, bot(g, DT))) if (e.type === 'unlock') unlocks.push([e.op, g.t]);
    }
    expect(unlocks.map((u) => u[0])).toEqual(['×', '÷']);
    expect(unlocks[0][1]).toBeGreaterThanOrEqual(20);
    expect(unlocks[1][1]).toBeGreaterThanOrEqual(45);
    expect(operatorsAt(g.t)).toHaveLength(4);
  });

  it('a perfect player can survive 3 minutes on any seed (runs are fair)', () => {
    for (let seed = 0; seed < 12; seed++) {
      const g = createGame({ seed });
      const bot = createBot();
      while (g.t < 180 && g.status === 'running') step(g, DT, bot(g, DT));
      expect(g.status, `seed ${seed} died: ${JSON.stringify(g.death)}`).toBe('running');
      expect(g.shields).toBe(START_SHIELDS);
      expect(g.coins).toBeGreaterThan(100);
    }
  });

  it('overdrive: speeds up further once the score gets really high', () => {
    expect(overdrive(0)).toBe(1);
    expect(overdrive(OVERDRIVE_FROM)).toBe(1);
    expect(overdrive(OVERDRIVE_FROM + 20)).toBeCloseTo(1.25);
    expect(overdrive(500)).toBe(1.5);
    expect([0, 39, 40, 54, 55, 70].map(speedLevel)).toEqual([0, 0, 1, 1, 2, 3]);

    // Two games at the same moment in time: the high scorer moves faster.
    const a = calmGame(4);
    const b = calmGame(4);
    b.coins = 80;
    step(a, DT);
    step(b, DT);
    expect(b.speed / a.speed).toBeCloseTo(1.5, 2);
  });

  it('announces each speed-up level', () => {
    const g = calmGame(5);
    g.coins = OVERDRIVE_FROM - 1;
    g.streak = 0;
    const gate = firstGate(g);
    g.player.lane = gate.trueLane;
    const seen = [];
    while (!gate.resolved) for (const e of step(g, DT)) seen.push(e);
    expect(seen.find((e) => e.type === 'speedup')).toEqual({ type: 'speedup', level: 1 });
  });

  it('first gate appears almost immediately and has time to be read', () => {
    const g = createGame({ seed: 1 });
    const gate = firstGate(g);
    expect(g.t).toBeLessThan(0.5);
    expect(gate.d).toBeCloseTo(SPAWN_D, 0);
    expect(travelTimeAt(0)).toBeGreaterThan(4);
  });

  it('same seed → identical run (Daily Rush is the same for everyone)', () => {
    const run = (seed) => {
      const g = createGame({ seed });
      const bot = createBot();
      const seen = [];
      while (g.t < 60) {
        step(g, DT, bot(g, DT));
        for (const x of g.gates) if (!seen.includes(x.lanes[0].text + x.id)) seen.push(x.lanes[0].text + x.id);
      }
      return seen.join();
    };
    expect(run('2026-09-27')).toBe(run('2026-09-27'));
    expect(run('2026-09-27')).not.toBe(run('2026-09-28'));
  });
});
