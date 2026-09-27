import { describe, it, expect } from 'vitest';
import {
  createGame,
  step,
  jumpHeight,
  summarize,
  spawnRow,
  wallAlongside,
  SPAWN_D,
  START_SHIELDS,
  INVULN_TIME,
  WALL_LEN,
} from './engine.js';
import { createBot } from './bot.js';
import { gateIntervalAt, travelTimeAt, operatorsAt, overdrive, speedLevel, OVERDRIVE_FROM } from './difficulty.js';
import { multiplierFor, POINTS_PER_COIN } from './scoring.js';
import { makeEquation } from './equations.js';

const DT = 1 / 60;
const eq = (a, op, b, r) => ({ type: 'eq', eq: makeEquation(a, op, b, r) });
const S = (type) => ({ type });

/** Step until the first row exists, returning it. */
function firstRow(g) {
  while (!g.rows.length) step(g, DT);
  return g.rows[0];
}

/** Next unresolved row (spawning one if needed). */
function nextRow(g) {
  for (;;) {
    const r = g.rows.filter((x) => !x.resolved).sort((a, b) => a.d - b.d)[0];
    if (r) return r;
    step(g, DT);
  }
}

/** Step until a row is resolved, holding the runner in `lane`. */
function driveThrough(g, row, lane, actions = []) {
  while (!row.resolved && g.status === 'running') {
    g.player.lane = lane;
    step(g, DT, actions);
  }
}

/** A game with scripted rows only (nothing spawns on its own). */
const scripted = (seed = 1) => createGame({ seed, scripted: true });


describe('maths rows', () => {
  it('TRUE lane: coin, points, streak', () => {
    const g = createGame({ seed: 1 });
    const row = firstRow(g);
    expect(row.kind).toBe('maths');
    driveThrough(g, row, row.trueLane);
    expect(row.result).toBe('correct');
    expect(g.status).toBe('running');
    expect(g.coins).toBe(1);
    expect(g.streak).toBe(1);
    expect(g.score).toBe(POINTS_PER_COIN);
  });

  it('FALSE lane: instant death, even with a shield', () => {
    const g = createGame({ seed: 1 });
    const row = firstRow(g);
    const wrong = [0, 1, 2].find((l) => l !== row.trueLane);
    driveThrough(g, row, wrong);
    expect(g.status).toBe('dying');
    expect(g.shields).toBe(START_SHIELDS); // shield never protects from maths
    expect(g.death.cause).toBe('equation');
    expect(g.death.equation).toBe(row.lanes[wrong].eq);
    expect(g.death.trueEquation.isTrue).toBe(true);
    expect(g.death.rowId).toBe(row.id);
  });

  it('FALSE lane kills late into a long run too', () => {
    const g = createGame({ seed: 9 });
    const bot = createBot();
    while (g.streak < 30) step(g, DT, bot(g, DT));
    // Wait until the *nearest* row has a false equation in it, then steer into it.
    let row;
    for (;;) {
      row = g.rows.filter((r) => !r.resolved).sort((a, b) => a.d - b.d)[0];
      if (row && row.lanes.some((x) => x.type === 'eq' && !x.eq.isTrue)) break;
      step(g, DT, bot(g, DT));
    }
    const wrong = row.lanes.findIndex((x) => x.type === 'eq' && !x.eq.isTrue);
    driveThrough(g, row, wrong);
    expect(g.status).toBe('dying');
    expect(g.shields).toBe(START_SHIELDS);
  });

  it('goes from dying to over after the death animation', () => {
    const g = createGame({ seed: 1 });
    const row = firstRow(g);
    driveThrough(g, row, (row.trueLane + 1) % 3);
    for (let i = 0; i < 120; i++) step(g, DT);
    expect(g.status).toBe('over');
    expect(summarize(g).history.at(-1)).toBe('wrong');
  });

  it('the lane at the moment of crossing is what counts', () => {
    const g = createGame({ seed: 1 });
    const row = firstRow(g);
    g.player.lane = (row.trueLane + 1) % 3;
    while (row.d - g.speed * DT > 0) step(g, DT);
    g.player.lane = row.trueLane;
    step(g, DT);
    expect(row.result).toBe('correct');
  });

  it('streak multiplier scales coin value', () => {
    const g = createGame({ seed: 3 });
    const bot = createBot();
    let expected = 0;
    let seen = 0;
    while (g.coins < 12) {
      step(g, DT, bot(g, DT));
      while (seen < g.coins) expected += POINTS_PER_COIN * multiplierFor(++seen);
    }
    expect(g.score).toBe(expected);
    expect(g.multiplier).toBe(3);
  });
});

describe('lanes', () => {
  it('clamps to the three lanes', () => {
    const g = scripted();
    step(g, DT, ['left', 'left', 'left']);
    expect(g.player.lane).toBe(0);
    step(g, DT, ['right', 'right', 'right', 'right']);
    expect(g.player.lane).toBe(2);
  });
});

describe('physical obstacles', () => {
  const rowAt = (lanes, d = 10, seed = 2) => {
    const g = scripted(seed);
    const row = spawnRow(g, lanes, 'obstacles');
    row.d = d;
    return { g, row };
  };

  it('a well-timed jump clears a hurdle', () => {
    const { g, row } = rowAt([S('barrier'), S('barrier'), S('barrier')]);
    while (!row.resolved) step(g, DT, row.d / g.speed < 0.25 && g.player.jumpT < 0 ? ['jump'] : []);
    expect(row.result).toBe('cleared');
    expect(g.shields).toBe(START_SHIELDS);
  });

  it('a well-timed duck clears a beam', () => {
    const { g, row } = rowAt([S('beam'), S('beam'), S('beam')]);
    while (!row.resolved) step(g, DT, row.d / g.speed < 0.2 && g.player.duckT < 0 ? ['duck'] : []);
    expect(row.result).toBe('cleared');
  });

  it('ducking does not clear a hurdle, jumping does not clear a beam', () => {
    for (const [kind, action] of [
      ['barrier', 'duck'],
      ['beam', 'jump'],
    ]) {
      const { g, row } = rowAt([S(kind), S(kind), S(kind)]);
      while (!row.resolved) step(g, DT, row.d / g.speed < 0.2 ? [action] : []);
      expect(row.result).toBe('hit');
    }
  });

  it('walls cannot be jumped or ducked', () => {
    for (const action of ['jump', 'duck']) {
      const { g, row } = rowAt([S('wall'), S('wall'), S('empty')]);
      while (!row.resolved) step(g, DT, row.d / g.speed < 0.2 ? [action] : []);
      expect(row.result).toBe('hit');
      expect(g.shields).toBe(0);
    }
  });

  it('an open lane is a clean pass', () => {
    const { g, row } = rowAt([S('wall'), S('empty'), S('wall')]);
    while (!row.resolved) step(g, DT);
    expect(row.result).toBe('passed');
    expect(g.shields).toBe(START_SHIELDS);
  });

  it('you cannot sidestep into the flank of a passing wall', () => {
    const { g, row } = rowAt([S('wall'), S('empty'), S('empty')], 1);
    while (row.d > -WALL_LEN / 2) step(g, DT);
    expect(wallAlongside(g, 0)).toBe(true);
    const events = step(g, DT, ['left']);
    expect(g.player.lane).toBe(1);
    expect(events).toContainEqual({ type: 'bump', dir: 'left', wall: true });
    while (row.d + WALL_LEN > -1) step(g, DT);
    step(g, DT, ['left']);
    expect(g.player.lane).toBe(0);
  });

  it('first hit costs the shield and the multiplier, not the run', () => {
    const { g, row } = rowAt([S('barrier'), S('barrier'), S('barrier')]);
    g.streak = 12;
    g.multiplier = 3;
    while (!row.resolved) step(g, DT);
    expect(g.status).toBe('running');
    expect(g.shields).toBe(0);
    expect(g.streak).toBe(0);
    expect(g.multiplier).toBe(1);
    expect(g.player.invuln).toBeGreaterThan(INVULN_TIME - 0.1);
    expect(g.history).toEqual(['shield']);
  });

  it('second hit with no shield ends the run', () => {
    const { g, row } = rowAt([S('beam'), S('beam'), S('beam')]);
    g.shields = 0;
    while (!row.resolved) step(g, DT);
    expect(g.status).toBe('dying');
    expect(g.death).toMatchObject({ cause: 'obstacle', kind: 'beam' });
  });

  it('invulnerability frames ignore an immediate second hit', () => {
    const { g } = rowAt([S('barrier'), S('barrier'), S('barrier')], 10);
    const second = spawnRow(g, [S('beam'), S('beam'), S('beam')], 'obstacles');
    second.d = 12;
    while (g.rows.some((r) => !r.resolved)) step(g, DT);
    expect(g.status).toBe('running');
    expect(g.shields).toBe(0);
  });

  it('duck in mid-air fast-falls; jump from a duck cancels it', () => {
    const g = scripted();
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
});

describe('mixed rows', () => {
  it('a false equation beside a hurdle: the hurdle is the way through', () => {
    const g = scripted();
    const row = spawnRow(g, [eq(6, '+', 7, 12), S('barrier'), S('wall')], 'mixed');
    row.d = 10;
    expect(row.trueLane).toBe(-1);
    while (!row.resolved) step(g, DT, row.d / g.speed < 0.25 && g.player.jumpT < 0 ? ['jump'] : []);
    expect(row.result).toBe('cleared');
    expect(g.status).toBe('running');
  });

  it('running through a false equation in a mixed row still ends the run', () => {
    const g = scripted();
    const row = spawnRow(g, [eq(6, '+', 7, 12), S('barrier'), S('wall')], 'mixed');
    row.d = 5;
    g.player.lane = 0;
    while (!row.resolved) step(g, DT);
    expect(g.status).toBe('dying');
    expect(g.death.trueEquation).toBe(null);
  });

  it('a true equation beside obstacles is a coin', () => {
    const g = scripted();
    const row = spawnRow(g, [S('wall'), eq(6, '+', 7, 13), S('beam')], 'mixed');
    row.d = 5;
    while (!row.resolved) step(g, DT);
    expect(row.result).toBe('correct');
    expect(g.coins).toBe(1);
  });
});

describe('generated runs', () => {
  it('open with maths rows, then mix in obstacles and mixed rows; maths stays the majority', () => {
    const bot = createBot();
    const kinds = [];
    const g2 = createGame({ seed: 5 });
    const seen = new Set();
    while (g2.t < 180 && g2.status === 'running') {
      step(g2, DT, bot(g2, DT));
      for (const r of g2.rows) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          kinds.push([r.kind, r.spawnedAt]);
        }
      }
    }
    expect(kinds.filter(([, t]) => t < 8).every(([k]) => k === 'maths')).toBe(true);
    const count = (k) => kinds.filter(([x]) => x === k).length;
    expect(count('obstacles')).toBeGreaterThan(5);
    expect(count('mixed')).toBeGreaterThan(3);
    expect(count('maths')).toBeGreaterThan(kinds.length * 0.5);
    // Never three non-maths rows in a row.
    for (let i = 2; i < kinds.length; i++) {
      expect([kinds[i - 2][0], kinds[i - 1][0], kinds[i][0]].some((k) => k === 'maths')).toBe(true);
    }
  });

  it('rows arrive on an even beat — never bunched together', () => {
    const g = createGame({ seed: 6 });
    const bot = createBot();
    let last = null;
    let minGap = Infinity;
    const seen = new Set();
    while (g.t < 150 && g.status === 'running') {
      step(g, DT, bot(g, DT));
      for (const r of g.rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        if (last) minGap = Math.min(minGap, r.d - last.d);
        last = r;
      }
    }
    // At least ~30 world units between consecutive rows, whatever the speed.
    expect(minGap).toBeGreaterThan(30);
  });

  it('a perfect player can survive 3 minutes on any seed (runs are fair)', () => {
    for (let seed = 0; seed < 12; seed++) {
      const g = createGame({ seed });
      const bot = createBot();
      while (g.t < 180 && g.status === 'running') step(g, DT, bot(g, DT));
      expect(g.status, `seed ${seed} died: ${JSON.stringify(g.death)}`).toBe('running');
      expect(g.shields, `seed ${seed} lost its shield`).toBe(START_SHIELDS);
      expect(g.coins).toBeGreaterThan(60);
    }
  });

  it('same seed → identical run (Daily Rush is the same for everyone)', () => {
    const run = (seed) => {
      const g = createGame({ seed });
      const bot = createBot();
      const seen = [];
      while (g.t < 60) {
        step(g, DT, bot(g, DT));
        for (const r of g.rows) {
          const key = `${r.id}:${r.lanes.map((s) => (s.type === 'eq' ? s.eq.text : s.type)).join('|')}`;
          if (!seen.includes(key)) seen.push(key);
        }
      }
      return seen.join();
    };
    expect(run('2026-09-27')).toBe(run('2026-09-27'));
    expect(run('2026-09-27')).not.toBe(run('2026-09-28'));
  });
});

describe('difficulty over a run', () => {
  it('row interval ramps from 2.5s towards 1s, travel time shrinks', () => {
    expect(gateIntervalAt(0)).toBeCloseTo(2.5);
    expect(gateIntervalAt(300)).toBeLessThan(1.02);
    for (let t = 0; t < 300; t += 5) {
      expect(gateIntervalAt(t + 5)).toBeLessThan(gateIntervalAt(t));
      expect(travelTimeAt(t + 5)).toBeLessThan(travelTimeAt(t));
    }
  });

  it('announces × and ÷ unlocks', () => {
    const g = createGame({ seed: 1 });
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

  it('overdrive: speeds up further once the score gets really high', () => {
    expect(overdrive(0)).toBe(1);
    expect(overdrive(OVERDRIVE_FROM)).toBe(1);
    expect(overdrive(OVERDRIVE_FROM + 20)).toBeCloseTo(1.25);
    expect(overdrive(500)).toBe(1.5);
    expect([0, 39, 40, 54, 55, 70].map(speedLevel)).toEqual([0, 0, 1, 1, 2, 3]);
    const a = scripted(4);
    const b = scripted(4);
    b.coins = 80;
    step(a, DT);
    step(b, DT);
    expect(b.speed / a.speed).toBeCloseTo(1.5, 2);
  });

  it('announces each speed-up level', () => {
    const g = scripted(5);
    g.coins = OVERDRIVE_FROM - 1;
    const row = spawnRow(g, [eq(1, '+', 1, 2), eq(1, '+', 1, 3), eq(1, '+', 1, 4)], 'maths');
    row.d = 5;
    g.player.lane = 0;
    const seen = [];
    while (!row.resolved) for (const e of step(g, DT)) seen.push(e);
    expect(seen.find((e) => e.type === 'speedup')).toEqual({ type: 'speedup', level: 1 });
  });

  it('opens with two rows on the track: the first equation arrives in ~3.5s', () => {
    const g = createGame({ seed: 1 });
    const row = firstRow(g);
    expect(g.t).toBeLessThan(0.5);
    expect(g.rows).toHaveLength(2);
    expect(g.rows[1].d).toBeCloseTo(SPAWN_D, 0);
    expect(g.rows[1].d - row.d).toBeGreaterThan(30); // same beat as every other row
    const bot = createBot();
    while (!row.resolved) step(g, DT, bot(g, DT));
    expect(g.t).toBeGreaterThan(2.5);
    expect(g.t).toBeLessThan(4.5);
    expect(travelTimeAt(0)).toBeGreaterThan(5);
  });

  it('first sightings get a one-off coach hint', () => {
    const g = scripted();
    expect(spawnRow(g, [S('barrier'), S('barrier'), S('barrier')], 'obstacles').coach).toBe('barrier');
    expect(spawnRow(g, [S('barrier'), S('barrier'), S('barrier')], 'obstacles').coach).toBe(null);
    expect(spawnRow(g, [S('wall'), S('empty'), S('wall')], 'obstacles').coach).toBe('wall');
    expect(spawnRow(g, [eq(1, '+', 1, 2), S('beam'), S('wall')], 'mixed').coach).toBe('mixed');
  });
});
