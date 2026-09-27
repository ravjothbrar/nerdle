// Pseudo-3D camera. World depth `d` (units ahead of the runner) maps to a
// perspective scale s = CAM / (CAM + d): s = 1 at the runner, shrinking
// towards the horizon.
//
// Subway-Surfers framing: the horizon sits high on the screen and the track
// runs down almost the whole height, so you can see a long way ahead and
// consecutive rows are spread out vertically instead of stacking on top of
// each other. (In camera terms: a high camera looking down the track —
// eye height ≈ (groundY − horizonY) / ppu ≈ 7 lane-quarters on a laptop,
// more on a phone.)

import { MAX_TILES } from '../game/equations.js';

// A fairly long lens: far rows stay large enough to read early, which is
// what buys reading time (without slowing the game down).
export const CAM = 55;
export const LANE_UNITS = 4; // world width of a lane
export const TILE_GAP = 0.07; // gap between tiles, as a fraction of tile size
export const PANEL_PAD = 0.16; // panel border around the tiles, as a fraction of tile size

export function createView(width, height) {
  const portrait = height > width * 1.1;
  const narrow = width < 600;
  // Track width at the runner. On phones it's a touch wider than the screen:
  // side lanes are fully visible while you read ahead and only clip at the
  // very last moment, which buys noticeably bigger tiles.
  const trackW = narrow ? width * 1.28 : Math.min(width * 0.97, height * 1.45, 1400);
  const laneW = trackW / 3;
  const horizonY = height * (portrait ? 0.12 : 0.08);
  const groundY = height * (portrait ? 0.87 : 0.9);
  const ppu = laneW / LANE_UNITS; // pixels per world unit at the runner

  // Equation panel layout — read left to right wherever the screen allows:
  //   'row'    7×8=56 on one line (only when even that gives big tiles)
  //   'two'    7×8 / =56 — laptops and tablets (portrait too)
  //   'column' 7 / ×8 / =56, right-aligned like written column arithmetic —
  //            phones only, where it roughly doubles the digit size compared
  //            with a horizontal layout in a lane that narrow
  const signW = laneW * 0.96;
  const tileFor = (cols) => signW / (cols + (cols - 1) * TILE_GAP + PANEL_PAD * 2);
  let signLayout = 'column';
  if (tileFor(MAX_TILES) >= 56) signLayout = 'row';
  else if (tileFor(5) >= 36) signLayout = 'two';

  return {
    width,
    height,
    narrow,
    portrait,
    trackW,
    laneW,
    groundY,
    horizonY,
    ppu,
    signW,
    signLayout,
    tileFor,
    cx: width / 2,
  };
}

export const scaleAt = (d) => CAM / (CAM + Math.max(d, -CAM * 0.85));

/** Screen y of the ground at depth d. */
export function groundYAt(v, d) {
  return v.horizonY + (v.groundY - v.horizonY) * scaleAt(d);
}

/** Screen x of a lane position (0..2, may be fractional) at depth d. */
export function laneXAt(v, lane, d) {
  return v.cx + (lane - 1) * v.laneW * scaleAt(d);
}

/** Project a world point (lane position, height in units, depth). */
export function project(v, lane, h, d) {
  const s = scaleAt(d);
  return { x: laneXAt(v, lane, d), y: groundYAt(v, d) - h * v.ppu * s, s };
}

/**
 * Split an equation's tokens into display rows for a layout.
 *   row    → [[7,×,8,=,5,6]]
 *   two    → [[7,×,8],[=,5,6]]
 *   column → [[7],[×,8],[=,5,6]]  (right-aligned when drawn)
 */
export function layoutTokens(tokens, layout) {
  if (layout === 'row') return [tokens];
  const eqAt = tokens.indexOf('=');
  if (layout === 'two') return [tokens.slice(0, eqAt), tokens.slice(eqAt)];
  const opAt = tokens.findIndex((c, i) => i > 0 && '+-×÷'.includes(c));
  return [tokens.slice(0, opAt), tokens.slice(opAt, eqAt), tokens.slice(eqAt)];
}
