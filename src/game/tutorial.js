// First-play tutorial: a scripted, forgiving run that teaches the verbs
// (steer, jump, duck) and the rules that matter (a false equation ends the
// run; walls must be steered round; an equation beside an obstacle is only
// worth taking if it's true). It drives the real engine — it just places rows
// itself and *holds* the world still at each teaching moment until the player
// does the right thing. Nothing can kill you in here.
//
// Usage per fixed tick:   actions = tutorial.update(game, dt, actions)
//                         step(game, dt, actions)

import { makeEquation } from './equations.js';
import { spawnRow, jumpHeight, isSafeSlot, JUMP_TIME, DUCK_TIME, BARRIER_CLEARANCE } from './engine.js';

const eq = (a, op, b, r) => ({ type: 'eq', eq: makeEquation(a, op, b, r) });
const wall = () => ({ type: 'wall', variant: 0 });
const barrier = () => ({ type: 'barrier' });
const beam = () => ({ type: 'beam' });

// The script. Each lesson is one row plus what to say around it. `holdAt` is
// the depth at which the world freezes if the runner is in an unsafe lane.
export const LESSONS = [
  {
    kind: 'maths',
    lanes: [eq(5, '+', 3, 9), eq(6, '-', 2, 3), eq(4, '+', 3, 7)], // true on the right
    intro: ['Three lanes, three equations', 'Only ONE of them is true.'],
    holdAt: 34,
    prompt: ['Steer into the TRUE equation', 'Which one adds up?'],
    after: ['+10 — every true equation is a coin', 'Chain them for a streak multiplier (up to ×5).', 'good'],
    pause: 2.4,
  },
  {
    kind: 'maths',
    lanes: [eq(9, '-', 4, 5), eq(7, '+', 2, 8), eq(8, '-', 3, 6)], // true on the left
    intro: ['Your turn — no pause this time', 'Read all three, pick the true one.'],
    holdAt: 14,
    prompt: ['Quick — which one is true?', 'Steer into it before it reaches you.'],
    after: ['⚠ In a real run, one false equation ends it', 'No shield, no second chance — the maths is the point.', 'warn'],
    pause: 3.2,
  },
  {
    kind: 'obstacles',
    lanes: [barrier(), barrier(), barrier()],
    intro: ['Obstacles test reflexes, not maths', 'Hurdles, beams and walls.'],
    after: ['Nice jump!', 'Next: a beam.', 'good'],
    pause: 1.4,
  },
  {
    kind: 'obstacles',
    lanes: [beam(), beam(), beam()],
    intro: null,
    after: ['Smooth!', 'Now — walls.', 'good'],
    pause: 1.4,
  },
  {
    kind: 'obstacles',
    lanes: [wall(), wall(), { type: 'empty' }], // only the right lane is open
    intro: ['Walls fill a whole lane', 'You can’t jump or duck them.'],
    holdAt: 30,
    prompt: ['Walls block the lane — switch!', 'Find the open lane.'],
    after: ['That’s it', 'Last one: maths OR an obstacle.', 'good'],
    pause: 1.6,
  },
  {
    kind: 'mixed',
    lanes: [eq(6, '+', 7, 12), barrier(), wall()], // the equation is FALSE: take the hurdle
    intro: ['An equation OR an obstacle', 'Go through the equation only if it’s TRUE.'],
    holdAt: 34,
    prompt: ['Is 6+7=12 true?', 'If it is, run through it. If not, take the hurdle.'],
    after: ['Exactly — 6+7 is 13', 'When the maths is wrong, take the other route.', 'good'],
    pause: 2.6,
  },
];

export function createTutorial() {
  const t = {
    step: 'intro',
    lesson: -1,
    timer: 0,
    message: null, // { title, body, tone: 'info'|'good'|'warn'|'bad', key?: 'steer'|'jump'|'duck' }
    done: false,
    row: null,
    holdReason: null, // 'lane' | 'jump' | 'duck'
    update,
  };

  const say = (title, body, tone = 'info', key) => {
    t.message = { title, body, tone, key };
  };
  const go = (step) => {
    t.step = step;
    t.timer = 0;
  };

  function startLesson(g, i) {
    t.lesson = i;
    const L = LESSONS[i];
    // Fresh slot objects each time so a replayed tutorial is clean.
    t.row = spawnRow(g, L.lanes.map((s) => ({ ...s })), L.kind);
    if (L.intro) say(...L.intro);
    go('row');
  }

  function update(g, dt, actions) {
    t.timer += dt;
    // Obstacles can never end the tutorial: the shield is always topped up.
    g.shields = Math.max(g.shields, 1);

    switch (t.step) {
      case 'intro':
        if (!t.message) say('Welcome to Nerdle Rush!', 'You’re the cube. Here comes the track…');
        if (t.timer > 1.6) startLesson(g, 0);
        break;

      case 'row':
        runLesson(g, actions);
        break;

      case 'between': {
        const L = LESSONS[t.lesson];
        if (t.timer > L.pause) {
          if (t.lesson + 1 < LESSONS.length) startLesson(g, t.lesson + 1);
          else {
            say(
              'You carry 1 shield for obstacles',
              'Hit one and you lose it (and your streak). Hit another and the run is over.',
            );
            go('shield');
          }
        }
        break;
      }

      case 'shield':
        if (t.timer > 3.6) {
          say('You’re ready!', 'Soft on reflexes, hard on maths. It speeds up as your score climbs.', 'good');
          go('ready');
        }
        break;

      case 'ready':
        if (t.timer > 2.4 && !t.done) {
          t.done = true;
          t.message = null;
        }
        break;

      default:
    }
    return actions;
  }

  function runLesson(g, actions) {
    const L = LESSONS[t.lesson];
    const row = t.row;
    const p = g.player;

    if (row.resolved) {
      g.hold = false;
      say(...L.after);
      go('between');
      return;
    }

    const lane = predictLane(p.lane, actions);
    const slot = row.lanes[lane];

    if (g.hold && t.holdReason === 'lane') {
      if (actions.some((a) => a === 'left' || a === 'right')) {
        if (isSafeSlot(slot)) {
          g.hold = false;
          if (slot.type === 'eq') say(`✓ ${pretty(slot.eq.text)} — that’s the one!`, 'Hold that lane.', 'good');
          else if (slot.type === 'empty') say('✓ Open lane', 'Straight through.', 'good');
          else say('✓ Good call', slot.type === 'barrier' ? 'Now get ready to jump.' : 'Now get ready to duck.', 'good');
        } else if (slot.type === 'wall') {
          say('✗ That’s a wall', 'Walls can’t be jumped. Try another lane.', 'bad', 'steer');
        } else {
          const e = slot.eq;
          say(`✗ ${pretty(e.text)} is false`, `${pretty(`${e.a}${e.op}${e.b}`)} is ${e.actual}. Try another lane.`, 'bad', 'steer');
        }
      }
      return;
    }
    if (g.hold && (t.holdReason === 'jump' || t.holdReason === 'duck')) {
      if (actions.includes(t.holdReason)) g.hold = false;
      return;
    }

    // Not frozen: decide whether to freeze.
    if (L.holdAt != null && row.d <= L.holdAt && !isSafeSlot(slot)) {
      g.hold = true;
      t.holdReason = 'lane';
      say(L.prompt[0], L.prompt[1], 'info', 'steer');
      return;
    }
    const eta = row.d / g.speed;
    if (slot.type === 'barrier' && eta <= 0.24) {
      // Projected to the moment the hurdle arrives, so a jump that would
      // land short still counts as "not yet".
      const ok = p.jumpT >= 0 && jumpHeight(Math.min(0.999, p.jumpT + eta / JUMP_TIME)) >= BARRIER_CLEARANCE;
      if (!ok) {
        g.hold = true;
        t.holdReason = 'jump';
        say('Jump!', 'Clear the hurdle.', 'info', 'jump');
      }
    } else if (slot.type === 'beam' && eta <= 0.2) {
      const ok = p.duckT >= 0 && p.duckT + eta / DUCK_TIME < 1;
      if (!ok) {
        g.hold = true;
        t.holdReason = 'duck';
        say('Duck!', 'Get under the beam.', 'info', 'duck');
      }
    }
  }

  return t;
}

function predictLane(lane, actions) {
  let l = lane;
  for (const a of actions) {
    if (a === 'left') l = Math.max(0, l - 1);
    if (a === 'right') l = Math.min(2, l + 1);
  }
  return l;
}

const pretty = (text) => text.replace(/-/g, '−');
