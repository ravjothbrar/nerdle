import { useEffect, useRef, useState } from 'react';
import Mascot from './Mascot.jsx';
import { TileRow, HistoryGrid } from './Tiles.jsx';
import { explain, displayText } from '../game/equations.js';
import { shareText, dailyNumber } from '../game/share.js';

// ------------------------------------------------------------------ header

export function Header({ theme, onToggleTheme, muted, onToggleMute, onRules }) {
  return (
    <header className="header">
      <div className="brand">
        <LogoCube />
        <span className="brand__word">
          nerdle<span className="brand__dot">.</span> <span className="brand__rush">rush</span>
        </span>
      </div>
      <nav className="header__icons">
        <IconButton label="How to play" onClick={onRules}>
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 11 V17" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="12" cy="7.5" r="1.4" fill="currentColor" />
        </IconButton>
        <IconButton label={muted ? 'Unmute' : 'Mute'} onClick={onToggleMute} pressed={!muted}>
          <path d="M4 9 H8 L13 5 V19 L8 15 H4 Z" fill="currentColor" />
          {muted ? (
            <path d="M16 9 L21 15 M21 9 L16 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          ) : (
            <path d="M16 8.5 Q19 12 16 15.5 M18.5 6 Q23 12 18.5 18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          )}
        </IconButton>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </nav>
    </header>
  );
}

function IconButton({ label, onClick, children, pressed }) {
  return (
    <button className="icon-btn" onClick={onClick} aria-label={label} title={label} aria-pressed={pressed}>
      <svg viewBox="0 0 24 24" width="24" height="24">
        {children}
      </svg>
    </button>
  );
}

export function ThemeToggle({ theme, onToggle }) {
  const dark = theme === 'mathlete';
  return (
    <button
      className={`theme-toggle ${dark ? 'theme-toggle--dark' : ''}`}
      onClick={onToggle}
      role="switch"
      aria-checked={dark}
      aria-label="Mathlete dark mode"
      title={dark ? 'Switch to classic' : 'Switch to mathlete dark mode'}
    >
      <span className="theme-toggle__knob">{dark ? '☾' : '☀'}</span>
    </button>
  );
}

export function LogoCube({ size = 34 }) {
  return (
    <svg className="logo-cube" viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <path d="M6 10 L12 4 L36 4 L30 10 Z" fill="var(--mascot-top)" />
      <path d="M30 10 L36 4 L36 30 L30 36 Z" fill="var(--mascot-side)" />
      <rect x="4" y="10" width="26" height="26" rx="4" fill="var(--mascot-front)" />
      <path d="M10.5 31 V17 H20.5 a4 4 0 0 1 4 4 V31 H20.5 V21 H14.5 V31 Z" fill="#fff" />
    </svg>
  );
}

// ------------------------------------------------------------------ start

export function StartScreen({ onPlay, mode, onMode, best, dailyBest, theme, onToggleTheme, onRules, onTutorial, firstTime }) {
  const playRef = useRef(null);
  useEffect(() => playRef.current?.focus({ preventScroll: true }), []);
  return (
    <div className="overlay overlay--start">
      <div className="card card--start">
        <div className="start__hero">
          <Mascot facing="front" className="start__mascot" />
          <div>
            <h1 className="title">
              Nerdle <span>Rush</span>
            </h1>
            <p className="tagline">Swipe into the TRUE equation. Don&apos;t get caught out.</p>
          </div>
        </div>

        <div className="demo" aria-label="Example: three lanes, one true equation">
          <div className="demo__lane">
            <TileRow text="3×3=6" size="sm" />
          </div>
          <div className="demo__lane demo__lane--true">
            <TileRow text="2×4=8" size="sm" state="correct" />
            <span className="demo__tick">✓ TRUE</span>
          </div>
          <div className="demo__lane">
            <TileRow text="9-3=5" size="sm" />
          </div>
        </div>

        <div className="mode" role="radiogroup" aria-label="Game mode">
          <button role="radio" aria-checked={mode === 'endless'} className={`mode__opt ${mode === 'endless' ? 'mode__opt--on' : ''}`} onClick={() => onMode('endless')}>
            <b>Endless</b>
            <small>best {best.toLocaleString('en-US')}</small>
          </button>
          <button role="radio" aria-checked={mode === 'daily'} className={`mode__opt ${mode === 'daily' ? 'mode__opt--on' : ''}`} onClick={() => onMode('daily')}>
            <b>Daily #{dailyNumber()}</b>
            <small>{dailyBest != null ? `today ${dailyBest.toLocaleString('en-US')}` : 'same run for everyone'}</small>
          </button>
        </div>

        <button className="pill pill--play" ref={playRef} onClick={onPlay} data-testid="play">
          PLAY
        </button>
        {firstTime && <p className="start__first">First time? PLAY starts a 30-second tutorial.</p>}

        <div className="start__foot">
          <Controls />
          <div className="start__toggles">
            <button className="link-btn" onClick={onRules}>
              All rules
            </button>
            {!firstTime && (
              <button className="link-btn" onClick={onTutorial}>
                Tutorial
              </button>
            )}
            <label className="dark-label">
              <span>{theme === 'mathlete' ? 'Mathlete dark' : 'Classic'}</span>
              <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

function Controls() {
  return (
    <div className="controls">
      <span>
        <kbd>←</kbd>
        <kbd>→</kbd> steer
      </span>
      <span>
        <kbd>↑</kbd> jump
      </span>
      <span>
        <kbd>↓</kbd> duck
      </span>
      <span className="controls__touch">or swipe</span>
    </div>
  );
}

// ------------------------------------------------------------------ rules

export function RulesModal({ onClose, onTutorial }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay overlay--modal" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="rules-title">
      <div className="card card--rules" onClick={(e) => e.stopPropagation()}>
        <button className="close" ref={closeRef} onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 id="rules-title">How to play</h2>
        <ol className="rules">
          <li>
            <b>Three lanes, three equations.</b> Exactly one is true. Steer into it before it reaches you.
            <div className="rules__ex">
              <TileRow text="12+9=21" size="xs" state="correct" /> <span>true — collect the coin</span>
            </div>
            <div className="rules__ex">
              <TileRow text="12+9=23" size="xs" state="wrong" /> <span>false — run over</span>
            </div>
          </li>
          <li>
            <b>A false equation ends the run. Always.</b> No shield, no second chance — the maths is the point.
          </li>
          <li>
            <b>Jump hurdles, duck beams, dodge walls.</b> Walls fill a whole lane — switch lanes. You carry one
            shield for obstacles: the first hit costs the shield and your streak, the second ends the run.
          </li>
          <li>
            <b>Equation or obstacle?</b> Some rows put an equation next to a hurdle or a wall. Run through the
            equation only if it’s true — otherwise take the other route.
          </li>
          <li>
            <b>Build a streak.</b> Every 5 true lanes in a row raises your multiplier (up to ×5). Each coin is
            worth 10 × multiplier.
          </li>
          <li>
            <b>It gets faster — and sneakier.</b> + and − to start, × arrives at 20s, ÷ at 45s. Decoys start
            obvious; as your score climbs they become near-misses and classic slips (a forgotten carry, the wrong
            times-table row). Past 40 correct, overdrive kicks in and the track keeps accelerating.
          </li>
        </ol>
        <div className="rules__keys">
          <Controls />
          <span>
            <kbd>P</kbd> / <kbd>Esc</kbd> pause
          </span>
        </div>
        {onTutorial && (
          <button className="pill pill--teal rules__tutorial" onClick={onTutorial}>
            Play the tutorial
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tutorial done

export function TutorialComplete({ onPlay, onReplay }) {
  const ref = useRef(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <div className="overlay overlay--pause">
      <div className="card card--done" data-testid="tutorial-done">
        <Mascot facing="front" mood="wow" className="done__mascot" />
        <h2>Tutorial complete!</h2>
        <p>
          From here on it’s real: <b>one false lane ends the run</b>. It starts gentle and speeds up as your score
          climbs.
        </p>
        <button className="pill pill--play" ref={ref} onClick={onPlay} data-testid="start-run">
          Start your run
        </button>
        <button className="link-btn" onClick={onReplay}>
          Replay tutorial
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pause

export function PauseOverlay({ onResume, onQuit }) {
  const ref = useRef(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="overlay overlay--pause">
      <div className="card card--pause">
        <h2>Paused</h2>
        <button className="pill pill--play" ref={ref} onClick={onResume}>
          Resume
        </button>
        <button className="pill pill--ghost" onClick={onQuit}>
          Quit to menu
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ game over

export function GameOver({ summary, best, isNewBest, mode, onAgain, onMenu }) {
  const againRef = useRef(null);
  const [copied, setCopied] = useState('');
  useEffect(() => {
    againRef.current?.focus({ preventScroll: true });
  }, []);

  const d = summary.death;
  const url = typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : '';
  const text = shareText(summary, { mode, url });

  const share = async () => {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied('Copied to clipboard!');
    } catch {
      setCopied('Couldn’t copy — select the text below');
    }
    setTimeout(() => setCopied(''), 2200);
  };

  return (
    <div className="overlay overlay--over">
      <div className="card card--over" data-testid="game-over">
        {d?.cause === 'equation' ? <CaughtOut death={d} /> : <Crashed kind={d?.kind} />}

        <div className="stats">
          <Stat label="score" value={summary.score.toLocaleString('en-US')} big />
          <Stat label="distance" value={`${summary.distance.toLocaleString('en-US')}m`} />
          <Stat label="coins" value={summary.coins} />
          <Stat label="best streak" value={summary.bestStreak} />
          <Stat label="time" value={`${summary.time.toFixed(1)}s`} />
        </div>
        <div className="best">
          {isNewBest ? <span className="best__new">★ New best!</span> : <span>Best {best.toLocaleString('en-US')}</span>}
        </div>

        <div className="sharecard">
          <div className="sharecard__head">
            <LogoCube size={22} />
            <span>{mode === 'daily' ? `Nerdle Rush Daily #${dailyNumber()}` : 'Nerdle Rush'}</span>
          </div>
          <HistoryGrid history={summary.history} />
          <div className="sharecard__line">
            {summary.score.toLocaleString('en-US')} pts · {summary.distance}m · streak {summary.bestStreak}
          </div>
        </div>

        <div className="over__buttons">
          <button className="pill pill--play" ref={againRef} onClick={onAgain} data-testid="again">
            Play again
          </button>
          <button className="pill pill--teal" onClick={share}>
            Share
          </button>
          <button className="pill pill--ghost" onClick={onMenu}>
            Menu
          </button>
        </div>
        <div className="copied" role="status">
          {copied}
        </div>
      </div>
    </div>
  );
}

function CaughtOut({ death }) {
  const e = explain(death.equation);
  const resultStart = death.equation.text.indexOf('=') + 1;
  return (
    <div className="caught">
      <div className="caught__face">
        <Mascot facing="front" mood="dead" />
      </div>
      <h2>Caught out!</h2>
      <p className="caught__sentence" data-testid="death-sentence">
        You picked <b>{e.picked}</b> — it&apos;s actually <b className="teal">{e.actual}</b>
      </p>
      <div className="caught__rows">
        <div className="caught__row">
          <span className="caught__tag caught__tag--wrong">you picked</span>
          <TileRow text={death.equation.text} state="wrong" />
        </div>
        <div className="caught__row">
          <span className="caught__tag caught__tag--fix">should be</span>
          <TileRow
            text={e.corrected}
            state="ghost"
            highlight={{ state: 'correct', match: (i) => i >= resultStart }}
          />
        </div>
        <div className="caught__row">
          <span className="caught__tag caught__tag--true">true lane</span>
          <TileRow text={death.trueEquation.text} state="correct" />
        </div>
      </div>
      {death.equation.kind === 'swap' && death.equation.swappedFrom && (
        <p className="caught__note">
          Sneaky — a swapped operator. {displayText(`${death.equation.a}${death.equation.swappedFrom}${death.equation.b}=${death.equation.result}`)} would have been true.
        </p>
      )}
    </div>
  );
}

function Crashed({ kind }) {
  return (
    <div className="caught">
      <div className="caught__face">
        <Mascot facing="front" mood="dead" />
      </div>
      <h2>Crashed!</h2>
      <p className="caught__sentence">
        {
          {
            beam: 'You needed to duck under that beam',
            barrier: 'You needed to jump that hurdle',
            wall: 'Walls can’t be jumped — you needed to switch lanes',
          }[kind] ?? 'You hit an obstacle'
        }{' '}
        — and your shield was already gone.
      </p>
    </div>
  );
}

function Stat({ label, value, big }) {
  return (
    <div className={`stat ${big ? 'stat--big' : ''}`}>
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}
