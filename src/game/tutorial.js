// First-play tutorial: a scripted, forgiving run that teaches the three
// verbs (steer, jump, duck) and the one rule that matters (a false lane ends
// the run). It drives the real engine — it just places gates and obstacles
// itself and *holds* the world still at each teaching moment until the
// player does the right thing. Nothing can kill you in here.
//
// Usage per fixed tick:   actions = tutorial.update(game, dt, actions)
//                         step(game, dt, actions)

import { makeEquation } from './equations.js';
import { spawnGate, spawnObstacle, jumpHeight, JUMP_TIME, DUCK_TIME, BARRIER_CLEARANCE } from './engine.js';

const eq = (a, op, b, r) => makeEquation(a, op, b, r);

// Hand-picked gates. Gate A is true on the right (you start in the middle),
// gate B on the left — so both steering directions get practised.
export const TUTORIAL_GATES = [
  { lanes: [eq(5, '+', 3, 9), eq(6, '-', 2, 3), eq(4, '+', 3, 7)], trueLane: 2 },
  { lanes: [eq(9, '-', 4, 5), eq(7, '+', 2, 8), eq(8, '-', 3, 6)], trueLane: 0 },
];

const HOLD_A_AT = 26; // world units: gate A freezes here, big and readable
const HOLD_B_AT = 13; // gate B only freezes as a last-moment safety net
const JUMP_ETA = 0.24; // seconds before a barrier the world freezes for "Jump!"
const DUCK_ETA = 0.2;

export function createTutorial() {
  const t = {
    step: 'intro',
    timer: 0,
    message: null, // { title, body, tone: 'info'|'good'|'warn'|'bad', key?: 'steer'|'jump'|'duck' }
    done: false,
    gate: null,
    obstacle: null,
    update,
  };

  const say = (title, body, tone = 'info', key) => {
    t.message = { title, body, tone, key };
  };
  const go = (step) => {
    t.step = step;
    t.timer = 0;
  };

  function update(g, dt, actions) {
    t.timer += dt;
    // Obstacles can never end the tutorial: the shield is always topped up.
    g.shields = Math.max(g.shields, 1);
    switch (t.step) {
      case 'intro':
        if (!t.message) say('Welcome to Nerdle Rush!', 'You’re the cube. Equations are coming…');
        if (t.timer > 1.6) {
          t.gate = spawnGate(g, TUTORIAL_GATES[0].lanes, TUTORIAL_GATES[0].trueLane);
          say('Three lanes, three equations', 'Only ONE of them is true.');
          go('gateA');
        }
        break;

      case 'gateA':
      case 'gateB': {
        const gate = t.gate;
        const holdAt = t.step === 'gateA' ? HOLD_A_AT : HOLD_B_AT;
        if (g.hold) {
          // While frozen, react to the player's steering.
          const moved = actions.some((a) => a === 'left' || a === 'right');
          if (moved) {
            const lane = predictLane(g.player.lane, actions);
            const pick = gate.lanes[lane];
            if (lane === gate.trueLane) {
              g.hold = false;
              say(`✓ ${pretty(pick.text)} — that’s the one!`, 'Hold that lane.', 'good');
            } else {
              say(`✗ ${pretty(pick.text)} is false`, `${pretty(`${pick.a}${pick.op}${pick.b}`)} is ${pick.actual}. Try another lane.`, 'bad', 'steer');
            }
          }
        } else if (!gate.resolved && gate.d <= holdAt && predictLane(g.player.lane, actions) !== gate.trueLane) {
          // (Uses the lane *after* this tick's input, so even a last-instant
          // swerve into a false lane gets caught and frozen, never punished.)
          g.hold = true;
          if (t.step === 'gateA') say('Steer into the TRUE equation', 'Which one adds up?', 'info', 'steer');
          else say('Quick — which one is true?', 'Steer into it before it reaches you.', 'info', 'steer');
        }
        if (gate.resolved) {
          if (t.step === 'gateA') {
            say('+10 — every true lane is a coin', 'Chain them for a streak multiplier (up to ×5).', 'good');
            go('coinA');
          } else {
            say('⚠ In a real run, one false lane ends it', 'No shield, no second chance — the maths is the point.', 'warn');
            go('warn');
          }
        }
        break;
      }

      case 'coinA':
        if (t.timer > 2.4) {
          t.gate = spawnGate(g, TUTORIAL_GATES[1].lanes, TUTORIAL_GATES[1].trueLane);
          say('Your turn — no pause this time', 'Read all three, pick the true one.');
          go('gateB');
        }
        break;

      case 'warn':
        if (t.timer > 3.4) {
          t.obstacle = spawnObstacle(g, 'barrier');
          say('Obstacles test reflexes, not maths', 'Barriers and beams span every lane.');
          go('barrier');
        }
        break;

      case 'barrier':
      case 'beam': {
        const ob = t.obstacle;
        const isBarrier = t.step === 'barrier';
        const verb = isBarrier ? 'jump' : 'duck';
        if (g.hold) {
          if (actions.includes(verb)) g.hold = false;
        } else if (!ob.resolved) {
          const eta = ob.d / g.speed;
          // Already doing the right thing, in time? (Projected to the moment
          // the obstacle arrives, so a jump that would land short still counts
          // as "not yet".)
          const p = g.player;
          const already = isBarrier
            ? p.jumpT >= 0 && jumpHeight(Math.min(0.999, p.jumpT + eta / JUMP_TIME)) >= BARRIER_CLEARANCE
            : p.duckT >= 0 && p.duckT + eta / DUCK_TIME < 1;
          if (eta <= (isBarrier ? JUMP_ETA : DUCK_ETA) && !already) {
            g.hold = true;
            say(isBarrier ? 'Jump!' : 'Duck!', isBarrier ? 'Clear the barrier.' : 'Get under the beam.', 'info', verb);
          }
        }
        if (ob.resolved) {
          if (isBarrier) {
            say(ob.cleared ? 'Nice jump!' : 'Ouch!', 'Next: a beam.', ob.cleared ? 'good' : 'warn');
            go('beamWait');
          } else {
            say(
              'You carry 1 shield for obstacles',
              'Hit one and you lose the shield (and your streak). Hit another and it’s over.',
              'info',
            );
            go('shield');
          }
        }
        break;
      }

      case 'beamWait':
        if (t.timer > 1.3) {
          t.obstacle = spawnObstacle(g, 'beam');
          go('beam');
        }
        break;

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
