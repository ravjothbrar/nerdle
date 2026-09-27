import { describe, it, expect } from 'vitest';
import { createGame, step, isSafeSlot } from './engine.js';
import { createTutorial, LESSONS } from './tutorial.js';
import { bestLane } from './bot.js';

const DT = 1 / 60;

/** Run the tutorial with a scripted "player" function until done or timeout. */
function play(player, maxSeconds = 90) {
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

/** A player who only reacts once the world freezes, and then does it right. */
const patient = (g, tut) => {
  if (!g.hold) return [];
  const k = tut.message?.key;
  if (k === 'steer') {
    const target = bestLane(tut.row, g.player.lane);
    return [target < g.player.lane ? 'left' : 'right'];
  }
  if (k === 'jump') return ['jump'];
  if (k === 'duck') return ['duck'];
  return [];
};

describe('tutorial', () => {
  it('every lesson row has a safe lane; maths lessons have exactly one true equation', () => {
    for (const L of LESSONS) {
      expect(L.lanes.some(isSafeSlot)).toBe(true);
      if (L.kind === 'maths') expect(L.lanes.filter((s) => s.eq.isTrue)).toHaveLength(1);
    }
    // The mixed lesson's equation is deliberately false.
    const mixed = LESSONS.find((L) => L.kind === 'mixed');
    expect(mixed.lanes.find((s) => s.type === 'eq').eq.isTrue).toBe(false);
  });

  it('waits for the player at every teaching moment, then completes', () => {
    const { g, tut, log } = play(patient);
    expect(tut.done).toBe(true);
    expect(g.coins).toBe(2);
    // gate A, gate B (safety net), jump, duck, wall, mixed (lane), mixed (jump)
    expect(log.holds).toBe(7);
    for (const m of ['Steer into the TRUE equation', 'Jump!', 'Duck!', 'Walls block the lane — switch!', 'Is 6+7=12 true?', 'You’re ready!']) {
      expect(log.messages).toContain(m);
    }
    expect(log.messages.at(-1)).toBe('You’re ready!');
    expect(g.rows.every((r) => r.result !== 'hit')).toBe(true);
  });

  it('a wrong lane is explained, never fatal', () => {
    let explained = null;
    let wrongTried = false;
    const { tut } = play((g, tut) => {
      if (g.hold && tut.message?.key === 'steer' && !wrongTried) {
        wrongTried = true;
        return ['left']; // middle → left: the first lesson's left lane (5+3=9) is false
      }
      if (g.hold && tut.message?.tone === 'bad' && !explained) explained = tut.message;
      return patient(g, tut);
    });
    expect(explained.title).toBe('✗ 5+3=9 is false');
    expect(explained.body).toBe('5+3 is 8. Try another lane.');
    expect(tut.done).toBe(true);
  });

  it('explains walls when you steer into one', () => {
    const msgs = [];
    const { tut } = play((g, tut) => {
      if (tut.message?.tone === 'bad') msgs.push(tut.message.title);
      // At the wall lesson, go the wrong way first.
      if (g.hold && tut.lesson === 4 && tut.message?.key === 'steer' && !msgs.length) return ['right'];
      return patient(g, tut);
    });
    expect(msgs).toContain('✗ That’s a wall');
    expect(tut.done).toBe(true);
  });

  it('a player who already knows what to do is never frozen', () => {
    const { tut, log } = play((g) => {
      const row = g.rows.find((x) => !x.resolved);
      if (!row) return [];
      const acts = [];
      const target = bestLane(row, g.player.lane);
      if (target !== g.player.lane) acts.push(target < g.player.lane ? 'left' : 'right');
      const s = row.lanes[g.player.lane];
      const eta = row.d / g.speed;
      if (s.type === 'barrier' && g.player.jumpT < 0 && eta < 0.3) acts.push('jump');
      if (s.type === 'beam' && g.player.duckT < 0 && eta < 0.3) acts.push('duck');
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
    // Never dies (asserted every tick inside play()).
    expect(typeof tut.done).toBe('boolean');
  });
});
