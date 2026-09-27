// Pseudo-3D camera. World depth `d` (units ahead of the runner) maps to a
// perspective scale s = CAM / (CAM + d): s = 1 at the runner, shrinking
// towards the horizon. A fairly "long lens" (large CAM relative to SPAWN_D)
// keeps equation tiles legible for most of their approach.

import { SPAWN_D } from '../game/engine.js';
import { MAX_TILES } from '../game/equations.js';

export const CAM = 40;
export const LANE_UNITS = 4; // world width of a lane

export function createView(width, height) {
  const narrow = width < 600;
  // On phones the track is slightly wider than the screen: side lanes are
  // fully visible while equations are being read and only clip at the very
  // last moment, which buys ~20% bigger tiles.
  const trackW = Math.min(920, narrow ? width * 1.2 : width * 0.96);
  const laneW = trackW / 3;
  const groundY = height * (narrow ? 0.84 : 0.86);
  const horizonY = height * (narrow ? 0.3 : 0.28);
  const ppu = laneW / LANE_UNITS; // pixels per world unit at the runner

  // Tile layout for signs: one Nerdle-style row if tiles are big enough,
  // otherwise split at "=" into two rows (7×8 / =56).
  const signW = laneW * 0.92;
  const oneRowTile = signW / (MAX_TILES + (MAX_TILES - 1) * 0.12 + 0.4);
  const twoRows = oneRowTile < 30;

  return {
    width,
    height,
    narrow,
    trackW,
    laneW,
    groundY,
    horizonY,
    ppu,
    signW,
    twoRows,
    cx: width / 2,
    spawnScale: CAM / (CAM + SPAWN_D),
  };
}

export const scaleAt = (d) => CAM / (CAM + Math.max(d, -CAM * 0.85));

/** Screen y of the ground at depth d. */
export function groundYAt(v, d) {
  const s = scaleAt(d);
  return v.horizonY + (v.groundY - v.horizonY) * s;
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
