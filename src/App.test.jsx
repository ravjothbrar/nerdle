import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import App from './App.jsx';
import { GameOver } from './components/Screens.jsx';
import { makeEquation } from './game/equations.js';

describe('App', () => {
  it('shows the start screen with title, tagline and PLAY', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /nerdle rush/i })).toBeTruthy();
    expect(screen.getByText(/Swipe into the TRUE equation\. Don't get caught out\./)).toBeTruthy();
    expect(screen.getByTestId('play').textContent).toBe('PLAY');
  });

  it('toggles mathlete dark mode and remembers it', () => {
    render(<App />);
    const toggle = screen.getAllByRole('switch', { name: /mathlete/i })[0];
    const before = document.documentElement.dataset.theme;
    fireEvent.click(toggle);
    const after = document.documentElement.dataset.theme;
    expect(after).not.toBe(before);
    expect(JSON.parse(localStorage.getItem('nerdle-rush:theme'))).toBe(after);
  });

  it('opens and closes the rules', () => {
    render(<App />);
    fireEvent.click(screen.getByText('All rules'));
    expect(screen.getByRole('dialog', { name: /how to play/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('first PLAY opens the tutorial; skipping it starts a real run and is remembered', async () => {
    localStorage.clear();
    render(<App />);
    expect(screen.getByText(/First time\? PLAY starts a 30-second tutorial/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId('play'));
      await new Promise((r) => setTimeout(r, 50));
    });
    const skip = screen.getByRole('button', { name: /skip tutorial/i });
    await act(async () => {
      fireEvent.click(skip);
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByRole('button', { name: /skip tutorial/i })).toBeNull();
    expect(JSON.parse(localStorage.getItem('nerdle-rush:tutorialDone'))).toBe(true);
  });

  it('after the tutorial, PLAY goes straight into a run', async () => {
    localStorage.setItem('nerdle-rush:tutorialDone', 'true');
    render(<App />);
    expect(screen.queryByText(/First time\?/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Tutorial' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId('play'));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByRole('button', { name: /skip tutorial/i })).toBeNull();
    expect(screen.getByTestId('score').textContent).toBe('0');
  });

  it('starts a run with a HUD', async () => {
    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('play'));
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(screen.queryByTestId('play')).toBeNull();
    expect(screen.getByTestId('score').textContent).toBe('0');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });
});

describe('GameOver', () => {
  const summary = {
    score: 120,
    coins: 9,
    distance: 250,
    time: 31.4,
    bestStreak: 9,
    history: [...Array(9).fill('correct'), 'wrong'],
    death: {
      cause: 'equation',
      equation: makeEquation(7, '×', 8, 54, 'offset'),
      trueEquation: makeEquation(6, '×', 9, 54),
    },
  };

  it('explains exactly why the picked equation was false', () => {
    render(<GameOver summary={summary} best={120} isNewBest mode="endless" onAgain={() => {}} onMenu={() => {}} />);
    expect(screen.getByTestId('death-sentence').textContent).toBe("You picked 7×8=54 — it's actually 56");
    expect(screen.getByRole('img', { name: '7×8=56' })).toBeTruthy();
    expect(screen.getByRole('img', { name: '6×9=54' })).toBeTruthy();
    expect(screen.getByText(/New best/)).toBeTruthy();
    expect(screen.getByText('250m')).toBeTruthy();
  });

  it('points out swapped operators', () => {
    const eq = makeEquation(9, '+', 3, 6, 'swap');
    eq.swappedFrom = '-';
    render(
      <GameOver
        summary={{ ...summary, death: { ...summary.death, equation: eq } }}
        best={500}
        isNewBest={false}
        mode="daily"
        onAgain={() => {}}
        onMenu={() => {}}
      />,
    );
    expect(screen.getByTestId('death-sentence').textContent).toBe("You picked 9+3=6 — it's actually 12");
    expect(screen.getByText(/9−3=6 would have been true/)).toBeTruthy();
    expect(screen.getByText(/Nerdle Rush Daily #/)).toBeTruthy();
  });

  it('describes obstacle deaths', () => {
    render(
      <GameOver
        summary={{ ...summary, death: { cause: 'obstacle', kind: 'beam' } }}
        best={0}
        isNewBest={false}
        mode="endless"
        onAgain={() => {}}
        onMenu={() => {}}
      />,
    );
    expect(screen.getByText('Crashed!')).toBeTruthy();
    expect(screen.getByText(/duck under that beam/)).toBeTruthy();
  });

  it('explains wall crashes', () => {
    render(
      <GameOver
        summary={{ ...summary, death: { cause: 'obstacle', kind: 'wall' } }}
        best={0}
        isNewBest={false}
        mode="endless"
        onAgain={() => {}}
        onMenu={() => {}}
      />,
    );
    expect(screen.getByText(/Walls can’t be jumped — you needed to switch lanes/)).toBeTruthy();
  });
});
