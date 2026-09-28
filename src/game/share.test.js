import { describe, it, expect } from 'vitest';
import { historyRows, shareText, dailyNumber, todayKey, load, save } from './share.js';
import { makeEquation } from './equations.js';
import { multiplierFor, streakProgress } from './scoring.js';

describe('share card', () => {
  it('renders Nerdle-style rows of 10', () => {
    const h = [...Array(12).fill('correct'), 'shield', 'wrong'];
    expect(historyRows(h)).toEqual(['🟩'.repeat(10), '🟩🟩🟨🟪']);
  });

  it('collapses long runs', () => {
    const h = [...Array(150).fill('correct'), 'crash'];
    const rows = historyRows(h);
    expect(rows[0]).toBe('🟩×131');
    expect([...rows.slice(1).join('')]).toHaveLength(20);
    expect(rows.at(-1).endsWith('⬛')).toBe(true);
  });

  it('builds the share text with the killer equation', () => {
    const text = shareText(
      {
        score: 1240,
        distance: 312,
        coins: 40,
        bestStreak: 22,
        history: ['correct', 'wrong'],
        death: { cause: 'equation', equation: makeEquation(9, '-', 3, 5) },
      },
      { mode: 'daily', url: 'https://ravjothbrar.com/nerdle/', date: '2026-09-29' },
    );
    expect(text).toBe(
      [
        'Nerdle Rush Daily #3 🏃',
        '1,240 pts · 312m · 40 ✓ · best streak 22',
        '🟩🟪',
        'Caught out by 9−3=5',
        'https://ravjothbrar.com/nerdle/',
      ].join('\n'),
    );
  });

  it('names the maths level', () => {
    const summary = { score: 10, distance: 5, coins: 1, bestStreak: 1, history: ['correct'], level: 'hard' };
    expect(shareText(summary).split('\n')[0]).toBe('Nerdle Rush · Hard 🏃');
    expect(shareText(summary, { mode: 'daily', date: '2026-09-27' }).split('\n')[0]).toBe('Nerdle Rush Daily #1 · Hard 🏃');
  });

  it('numbers daily runs from launch day', () => {
    expect(dailyNumber('2026-09-27')).toBe(1);
    expect(dailyNumber('2027-09-27')).toBe(366);
    expect(todayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('persists values and survives bad storage', () => {
    save('x', { a: 1 });
    expect(load('x', null)).toEqual({ a: 1 });
    localStorage.setItem('nerdle-rush:bad', '{nope');
    expect(load('bad', 7)).toBe(7);
  });
});

describe('multiplier', () => {
  it('steps every 5 correct lanes, capped at ×5', () => {
    expect([0, 4, 5, 9, 10, 19, 20, 99].map(multiplierFor)).toEqual([1, 1, 2, 2, 3, 4, 5, 5]);
    expect(streakProgress(7)).toBeCloseTo(0.4);
    expect(streakProgress(50)).toBe(1);
  });
});
