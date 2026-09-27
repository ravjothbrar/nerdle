import { useCallback, useEffect, useMemo, useState } from 'react';
import GameView from './components/GameView.jsx';
import {
  Header,
  StartScreen,
  GameOver,
  RulesModal,
  PauseOverlay,
  TutorialComplete,
} from './components/Screens.jsx';
import { createAudio } from './audio.js';
import { load, save, todayKey } from './game/share.js';

export default function App() {
  const audio = useMemo(() => createAudio(), []);
  const [screen, setScreen] = useState('start'); // start | tutorial | tutorialDone | playing | over
  const [tutorialDone, setTutorialDone] = useState(() => load('tutorialDone', false));
  const [theme, setTheme] = useState(() => load('theme', prefersDark() ? 'mathlete' : 'classic'));
  const [muted, setMuted] = useState(() => load('muted', false));
  const [mode, setMode] = useState(() => load('mode', 'endless'));
  const [best, setBest] = useState(() => load('best', 0));
  const [dailyBest, setDailyBest] = useState(() => load(`daily:${todayKey()}`, null));
  const [runId, setRunId] = useState(0);
  const [summary, setSummary] = useState(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [paused, setPaused] = useState(false);
  const [rules, setRules] = useState(false);
  const reducedMotion = useMemo(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'mathlete' ? '#1e1e2e' : '#ffffff');
    save('theme', theme);
  }, [theme]);
  useEffect(() => {
    audio.setMuted(muted);
    save('muted', muted);
  }, [muted, audio]);
  useEffect(() => save('mode', mode), [mode]);

  const seed = useMemo(
    () => (mode === 'daily' ? `daily:${todayKey()}` : Math.floor(Math.random() * 2 ** 31)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, runId],
  );

  const startRun = useCallback(
    (kind) => {
      audio.unlock();
      audio.start();
      setSummary(null);
      setPaused(false);
      setRules(false);
      setRunId((n) => n + 1);
      setScreen(kind);
    },
    [audio],
  );

  // First ever PLAY goes through the tutorial; after that, straight in.
  const play = useCallback(() => startRun(tutorialDone ? 'playing' : 'tutorial'), [startRun, tutorialDone]);
  const replayTutorial = useCallback(() => startRun('tutorial'), [startRun]);

  const finishTutorial = useCallback(() => {
    setTutorialDone(true);
    save('tutorialDone', true);
  }, []);
  const onTutorialDone = useCallback(() => {
    finishTutorial();
    setScreen('tutorialDone');
  }, [finishTutorial]);
  const skipTutorial = useCallback(() => {
    finishTutorial();
    startRun('playing');
  }, [finishTutorial, startRun]);

  const onOver = useCallback(
    (s) => {
      setSummary(s);
      const newBest = s.score > best;
      setIsNewBest(newBest && s.score > 0);
      if (newBest) {
        setBest(s.score);
        save('best', s.score);
      }
      if (mode === 'daily' && (dailyBest == null || s.score > dailyBest)) {
        setDailyBest(s.score);
        save(`daily:${todayKey()}`, s.score);
      }
      setScreen('over');
    },
    [best, dailyBest, mode],
  );

  // Enter / Space starts a run from the menus.
  useEffect(() => {
    if (screen === 'playing' || screen === 'tutorial' || rules) return undefined;
    const onKey = (e) => {
      if ((e.code === 'Enter' || e.code === 'Space') && document.activeElement?.tagName !== 'BUTTON') {
        e.preventDefault();
        if (screen === 'tutorialDone') startRun('playing');
        else play();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, rules, play, startRun]);

  const toggleTheme = () => setTheme((t) => (t === 'mathlete' ? 'classic' : 'mathlete'));
  const inRun = screen === 'playing' || screen === 'over';
  const inTutorial = screen === 'tutorial' || screen === 'tutorialDone';
  const immersive = screen === 'playing' || screen === 'tutorial';

  return (
    <div className={`app app--${screen}`}>
      {!immersive && (
        <Header
          theme={theme}
          onToggleTheme={toggleTheme}
          muted={muted}
          onToggleMute={() => setMuted((m) => !m)}
          onRules={() => setRules(true)}
        />
      )}
      <main className="main">
        <GameView
          key={inRun ? `run-${runId}` : inTutorial ? `tutorial-${runId}` : 'attract'}
          mode={inRun ? 'play' : inTutorial ? 'tutorial' : 'attract'}
          seed={inRun ? seed : inTutorial ? 'tutorial' : 'attract'}
          theme={theme}
          audio={audio}
          paused={paused || rules}
          onPauseChange={setPaused}
          onOver={onOver}
          onTutorialDone={onTutorialDone}
          onSkipTutorial={skipTutorial}
          reducedMotion={reducedMotion}
        />
        {screen === 'start' && (
          <StartScreen
            onPlay={play}
            mode={mode}
            onMode={setMode}
            best={best}
            dailyBest={dailyBest}
            theme={theme}
            onToggleTheme={toggleTheme}
            onRules={() => setRules(true)}
            onTutorial={replayTutorial}
            firstTime={!tutorialDone}
          />
        )}
        {immersive && paused && !rules && (
          <PauseOverlay onResume={() => setPaused(false)} onQuit={() => { setPaused(false); setScreen('start'); }} />
        )}
        {screen === 'tutorialDone' && (
          <TutorialComplete onPlay={() => startRun('playing')} onReplay={replayTutorial} />
        )}
        {screen === 'over' && summary && (
          <GameOver
            summary={summary}
            best={best}
            isNewBest={isNewBest}
            mode={mode}
            onAgain={play}
            onMenu={() => setScreen('start')}
          />
        )}
      </main>
      {rules && <RulesModal onClose={() => setRules(false)} onTutorial={replayTutorial} />}
    </div>
  );
}

const prefersDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
