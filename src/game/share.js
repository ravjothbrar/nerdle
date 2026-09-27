// Share card + persistence helpers.

export const SQUARES = { correct: '🟩', wrong: '🟪', shield: '🟨', crash: '⬛' };
export const LAUNCH_DAY = '2026-09-27';
const MAX_SQUARES = 30;

/** Local calendar date as YYYY-MM-DD. */
export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Daily Rush number: #1 on launch day, like Nerdle's puzzle numbers. */
export function dailyNumber(key = todayKey()) {
  const ms = Date.parse(`${key}T00:00:00Z`) - Date.parse(`${LAUNCH_DAY}T00:00:00Z`);
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

/**
 * Condense the run history into Nerdle-style rows of squares. Long runs
 * collapse their opening into a count so the card stays postable.
 */
export function historyRows(history) {
  let items = history.map((h) => SQUARES[h] ?? '⬜');
  let lead = null;
  if (items.length > MAX_SQUARES) {
    const hidden = items.length - (MAX_SQUARES - 10);
    const hiddenCorrect = history.slice(0, hidden).filter((h) => h === 'correct').length;
    lead = `${SQUARES.correct}×${hiddenCorrect}`;
    items = items.slice(hidden);
  }
  const rows = [];
  for (let i = 0; i < items.length; i += 10) rows.push(items.slice(i, i + 10).join(''));
  return lead ? [lead, ...rows] : rows;
}

export function shareText(summary, { mode = 'endless', url = '', date = todayKey() } = {}) {
  const title =
    mode === 'daily' ? `Nerdle Rush Daily #${dailyNumber(date)}` : 'Nerdle Rush';
  const lines = [
    `${title} 🏃`,
    `${summary.score.toLocaleString('en-US')} pts · ${summary.distance}m · ${summary.coins} ✓ · best streak ${summary.bestStreak}`,
    ...historyRows(summary.history),
  ];
  if (summary.death?.cause === 'equation') {
    lines.push(`Caught out by ${summary.death.equation.text.replace(/-/g, '−')}`);
  }
  if (url) lines.push(url);
  return lines.join('\n');
}

// -- persistence (localStorage can throw in private mode / sandboxes) ----

export function load(key, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem(`nerdle-rush:${key}`);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    globalThis.localStorage?.setItem(`nerdle-rush:${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
