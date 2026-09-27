import { describe, it, expect } from 'vitest';
import { createGame, step } from './engine.js';
import { createTutorial, TUTORIAL_GATES } from './tutorial.js';

const DT = 1 / 60;

/** Run the tutorial with a scripted "player" function until done or timeout. */
function play(player, maxSeconds = 60) {
  const g = createGame({ seed: 1, scripted: true });
  const tut = createTutorial();
  const log = { holds: 0, messages: [] };
  let wasHeld = false;
  for (let i = 0; i < maxSeconds / DT && !tut.done; i++) {
    const actions = tut.update(g, DT, player(g, tut) ?? []);
    step(g, DT, actions);
    if (g.hold && !wasHeld) log.holds++;
    wasHeld = g.hold;
    const m = tut.message?.title;
    if (m && log.messages.at(-1) !== m) log.messages.push(m);
    expect(g.status).toBe('running');
  }
  return { g, tut, log };
}

describe('tutorial', () => {
  it('hand-picked gates each have exactly one true lane', () => {
    for (const { lanes, trueLane } of TUTORIAL_GATES) {
      expect(lanes.filter((e) => e.isTrue)).toHaveLength(1);
      expect(lanes[trueLane].isTrue).toBe(true);
    }
  });

  it('waits for the player at every teaching moment, then completes', () => {
    // A player who only reacts once the world freezes.
    const { g, tut, log } = play((g, tut) => {
      if (!g.hold) return [];
      const k = tut.message?.key;
      if (k === 'steer') return [tut.gate.trueLane < g.player.lane ? 'left' : 'right'];
      if (k === 'jump') return ['jump'];
      if (k === 'duck') return ['duck'];
      return [];
    });
    expect(tut.done).toBe(true);
    expect(g.coins).toBe(2);
    expect(log.holds).toBe(4); // gate A, gate B (safety net), jump, duck
    expect(log.messages).toContain('Steer into the TRUE equation');
    expect(log.messages).toContain('Jump!');
    expect(log.messages).toContain('Duck!');
    expect(log.messages.at(-1)).toBe('You’re ready!');
    expect(g.obstacles.every((o) => !o.hit)).toBe(true);
  });

  it('a wrong lane is explained, never fatal', () => {
    let explained = null;
    let wrongTried = false;
    const { tut } = play((g, tut) => {
      if (!g.hold || tut.message?.key !== 'steer') {
        if (g.hold && tut.message?.key) return [tut.message.key];
        return [];
      }
      if (!wrongTried) {
        wrongTried = true;
        return ['left']; // middle → left: gate A's left lane (5+3=9) is false
      }
      if (tut.message.tone === 'bad' && !explained) explained = tut.message;
      return [tut.gate.trueLane < g.player.lane ? 'left' : 'right'];
    });
    expect(explained.title).toBe('✗ 5+3=9 is false');
    expect(explained.body).toBe('5+3 is 8. Try another lane.');
    expect(tut.done).toBe(true);
  });

  it('a player who already knows what to do is never frozen', () => {
    const { tut, log } = play((g) => {
      const gate = g.gates.find((x) => !x.resolved);
      const acts = [];
      if (gate && gate.trueLane !== g.player.lane) acts.push(gate.trueLane < g.player.lane ? 'left' : 'right');
      const ob = g.obstacles.find((x) => !x.resolved);
      if (ob && ob.d / g.speed < 0.3) {
        if (ob.kind === 'barrier' && g.player.jumpT < 0) acts.push('jump');
        if (ob.kind === 'beam' && g.player.duckT < 0) acts.push('duck');
      }
      return acts;
    });
    expect(tut.done).toBe(true);
    expect(log.holds).toBe(0);
  });

  it('cannot be failed by mashing random inputs', () => {
    const inputs = ['left', 'right', 'jump', 'duck'];
    let seed = 3;
    const { tut } = play(() => {
      seed = (seed * 16807) % 2147483647;
      return seed % 5 === 0 ? [inputs[seed % 4]] : [];
    }, 400);
    // Random mashing might take a while, but must never end the run
    // (asserted every tick inside play()).
    expect(typeof tut.done).toBe('boolean');
  });
});
