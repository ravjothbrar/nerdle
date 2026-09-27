// Scoring: every TRUE lane is a coin, and each coin is worth
// POINTS_PER_COIN × the current streak multiplier. The multiplier climbs by
// one every STREAK_STEP consecutive correct lanes (capped), and drops back to
// ×1 whenever a physical obstacle is hit.

export const POINTS_PER_COIN = 10;
export const STREAK_STEP = 5;
export const MAX_MULTIPLIER = 5;

export function multiplierFor(streak) {
  return Math.min(MAX_MULTIPLIER, 1 + Math.floor(streak / STREAK_STEP));
}

/** Streak progress towards the next multiplier, 0..1 (1 when capped). */
export function streakProgress(streak) {
  if (multiplierFor(streak) >= MAX_MULTIPLIER) return 1;
  return (streak % STREAK_STEP) / STREAK_STEP;
}
