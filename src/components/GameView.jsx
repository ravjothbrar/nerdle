// Hosts one run: owns the engine instance, the rAF loop, input, the canvases
// and the mascot. React state is only touched when HUD values change, so the
// 60fps loop never re-renders the component tree.

import { useEffect, useRef, useState, useCallback } from 'react';
import { createGame, step, summarize, jumpHeight } from '../game/engine.js';
import { createBot } from '../game/bot.js';
import { createTutorial } from '../game/tutorial.js';
import { createRenderer } from '../render/renderer.js';
import { laneXAt } from '../render/projection.js';
import { THEMES } from '../render/theme.js';
import { actionForKey, attachSwipe } from '../input.js';
import Mascot from './Mascot.jsx';
import Hud from './Hud.jsx';

const FIXED_DT = 1 / 120;

export default function GameView({
  mode, // 'play' | 'tutorial' | 'attract'
  seed,
  theme,
  audio,
  paused,
  onPauseChange,
  onOver,
  onTutorialDone,
  onSkipTutorial,
  reducedMotion,
}) {
  const stageRef = useRef(null);
  const backRef = useRef(null);
  const frontRef = useRef(null);
  const mascotRef = useRef(null);
  const gameRef = useRef(null);
  const actionsRef = useRef([]);
  const pausedRef = useRef(paused);
  const themeRef = useRef(THEMES[theme]);
  const [hud, setHud] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [mascotMood, setMascotMood] = useState('run');
  const [hint, setHint] = useState(mode === 'play');

  const [ready, setReady] = useState(false);
  const [coach, setCoach] = useState(null); // 'barrier' | 'beam' | 'wall' | 'mixed' on first sighting
  const [lesson, setLesson] = useState(null); // tutorial coach message
  const attract = mode === 'attract';
  const tutorialMode = mode === 'tutorial';
  const holdRef = useRef(null);

  pausedRef.current = paused;
  themeRef.current = THEMES[theme];

  const toast = useCallback((text, kind = 'info', ms = 1400) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);

  const push = useCallback((a) => {
    if (!pausedRef.current) actionsRef.current.push(a);
  }, []);

  // Keyboard + swipe.
  useEffect(() => {
    if (attract) return undefined;
    const onKey = (e) => {
      if (e.repeat && (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'KeyA' || e.code === 'KeyD')) return;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        onPauseChange?.(!pausedRef.current);
        e.preventDefault();
        return;
      }
      const a = actionForKey(e.code);
      if (a) {
        e.preventDefault();
        push(a);
      }
    };
    window.addEventListener('keydown', onKey);
    const detach = attachSwipe(stageRef.current, push);
    return () => {
      window.removeEventListener('keydown', onKey);
      detach();
    };
  }, [attract, push, onPauseChange]);

  // Auto-pause when the tab is hidden.
  useEffect(() => {
    if (attract) return undefined;
    const onVis = () => document.hidden && onPauseChange?.(true);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [attract, onPauseChange]);

  // The game loop.
  useEffect(() => {
    const g = createGame({ seed, firstGateDelay: attract ? 0.2 : 0.35, scripted: tutorialMode });
    const tutorial = tutorialMode ? createTutorial() : null;
    let lastLesson = null;
    let tutorialSent = false;
    gameRef.current = g;
    // Test hook for the end-to-end smoke test (`?e2e` in the URL only).
    if (!attract && typeof location !== 'undefined' && location.search.includes('e2e')) window.__rush = g;
    const renderer = createRenderer(backRef.current, frontRef.current);
    const bot = attract ? createBot({ reaction: 0.6 }) : null;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastHudKey = '';
    let lastCoach = null;
    let overSent = false;

    const resize = () => {
      const el = stageRef.current;
      if (!el) return;
      renderer.resize(el.clientWidth, el.clientHeight, window.devicePixelRatio || 1);
    };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(stageRef.current);
    // Sprites are rasterised once, so re-rasterise after the web font lands.
    const fontsReady = () => {
      renderer.invalidate();
      setReady(true);
    };
    if (document.fonts?.load) {
      Promise.all([document.fonts.load('900 24px Nunito'), document.fonts.load('800 24px Nunito')]).then(fontsReady, fontsReady);
    } else fontsReady();

    // Adaptive quality: if frames run long for a sustained stretch, drop the
    // canvas resolution a notch (and creep back up when there is headroom).
    let avgFrame = 16.7;
    let slowFor = 0;
    let fastFor = 0;
    const adapt = (ms) => {
      if (ms <= 4 || ms > 120) return; // ignore pauses, tab switches, jitter
      avgFrame += (ms - avgFrame) * 0.05;
      if (avgFrame > 19.5) {
        slowFor += ms;
        fastFor = 0;
        if (slowFor > 1200 && renderer.quality > 0.5) {
          renderer.setQuality(renderer.quality - 0.15);
          slowFor = 0;
          avgFrame = 16.7;
        }
      } else if (avgFrame < 17 && renderer.quality < 1) {
        fastFor += ms;
        slowFor = 0;
        // Step back up only after a long calm stretch, so quality doesn't
        // flip-flop on a device that's right on the edge.
        if (fastFor > 15000) {
          renderer.setQuality(renderer.quality + 0.1);
          fastFor = 0;
        }
      } else {
        slowFor = 0;
      }
    };

    const handleEvents = (events) => {
      if (!events.length) return;
      renderer.onEvents(g, events, themeRef.current);
      if (attract) return;
      for (const e of events) {
        switch (e.type) {
          case 'coin':
            audio.coin(e.streak);
            setHint(false);
            break;
          case 'multiplier':
            audio.multiplier();
            toast(`×${e.multiplier} streak!`, 'good');
            break;
          case 'lane':
            audio.lane();
            break;
          case 'bump':
            audio.bump();
            if (e.wall) shake(5);
            break;
          case 'jump':
            audio.jump();
            break;
          case 'duck':
            audio.duck();
            break;
          case 'shield':
            audio.shield();
            buzz(60);
            toast('Shield lost! Multiplier reset', 'warn', 1800);
            shake(10);
            break;
          case 'speedup':
            audio.multiplier();
            toast(`⚡ Speed up! Level ${e.level}`, 'speed', 1800);
            break;
          case 'unlock':
            audio.unlockOp();
            toast(`${e.op} unlocked!`, 'unlock', 2000);
            break;
          case 'death':
            audio.death();
            buzz([90, 40, 140]);
            setMascotMood(e.cause === 'equation' ? 'caught' : 'crash');
            shake(18);
            break;
          case 'over':
            break;
          default:
        }
      }
    };

    const shake = (px) => {
      if (reducedMotion || !stageRef.current) return;
      stageRef.current.animate(
        [0, 1, 2, 3, 4, 5].map((i) => ({
          transform: i === 5 ? 'none' : `translate(${(Math.random() - 0.5) * px}px, ${(Math.random() - 0.5) * px}px)`,
        })),
        { duration: 320, easing: 'ease-out' },
      );
    };

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const ms = now - last;
      let dt = Math.min(0.1, ms / 1000);
      last = now;
      if (!pausedRef.current) adapt(ms);
      if (pausedRef.current) dt = 0;
      acc += dt;
      while (acc >= FIXED_DT) {
        acc -= FIXED_DT;
        let actions = bot ? bot(g, FIXED_DT) : actionsRef.current.splice(0);
        if (tutorial) actions = tutorial.update(g, FIXED_DT, actions);
        handleEvents(step(g, FIXED_DT, actions));
      }
      if (attract && g.status === 'over') {
        // Attract mode loops forever: quietly start a fresh run.
        Object.assign(g, createGame({ seed: Math.random() * 1e9, firstGateDelay: 0.2 }));
        renderer.reset();
      }
      renderer.draw(g, themeRef.current, dt);
      placeMascot(g, renderer.view);

      if (tutorial) {
        if (tutorial.message !== lastLesson) {
          lastLesson = tutorial.message;
          setLesson(tutorial.message);
          if (tutorial.message?.tone === 'good') audio.coin(3);
          if (tutorial.message?.tone === 'bad') audio.bump();
        }
        if (tutorial.done && !tutorialSent) {
          tutorialSent = true;
          onTutorialDone?.();
        }
      }
      if (holdRef.current) holdRef.current.classList.toggle('stage__hold--on', g.hold);
      stageRef.current?.classList.toggle('stage--held', g.hold);

      if (!attract) {
        const key = `${g.score}|${g.coins}|${g.multiplier}|${g.streak}|${g.shields}|${g.status}`;
        if (key !== lastHudKey) {
          lastHudKey = key;
          setHud({ score: g.score, coins: g.coins, multiplier: g.multiplier, streak: g.streak, shields: g.shields });
        }
        const first = g.status === 'running' && g.rows.find((r) => r.coach && !r.resolved && r.d < 70);
        const nextCoach = first ? first.coach : null;
        if (nextCoach !== lastCoach) {
          lastCoach = nextCoach;
          setCoach(nextCoach);
        }
        if (g.status === 'over' && !overSent) {
          overSent = true;
          onOver?.(summarize(g));
        }
      }
    };

    const placeMascot = (game, view) => {
      const el = mascotRef.current;
      if (!el) return;
      const p = game.player;
      const w = view.laneW * 0.4;
      const x = laneXAt(view, p.laneVisual, 0) - w / 2;
      const lift = jumpHeight(p.jumpT) * view.ppu * 2.3;
      const y = view.groundY - w * 1.24 - lift + w * 0.02;
      const tilt = (p.laneVisual - p.lane) * -18;
      const duck = p.duckT >= 0 ? 0.45 : 1;
      let extra = '';
      if (game.status !== 'running' && game.death?.cause === 'obstacle') {
        const k = Math.min(1, game.deathTimer * 3);
        extra = ` rotate(${-70 * k}deg)`;
      }
      el.style.width = `${w}px`;
      el.style.transform = `translate(${x}px, ${y}px) rotate(${tilt}deg) scale(${1 + (1 - duck) * 0.2}, ${duck})${extra}`;
      el.style.opacity = p.invuln > 0 && Math.floor(p.invuln * 12) % 2 ? '0.35' : '1';
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
    // A new seed means a new run; everything else is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, attract, tutorialMode]);

  const running = mascotMood === 'run' && !paused;
  return (
    <div className={`stage ${attract ? 'stage--attract' : ''} ${ready ? 'stage--ready' : ''}`} ref={stageRef} data-testid="stage">
      <canvas ref={backRef} className="stage__canvas" />
      <div className="stage__mascot" ref={mascotRef}>
        {/* Caught out by the maths: the cube spins round to face you, aghast. */}
        <Mascot
          facing={mascotMood === 'caught' ? 'front' : 'back'}
          mood={mascotMood === 'caught' ? 'wow' : 'happy'}
          running={running}
          className={mascotMood === 'caught' ? 'mascot--turn' : ''}
        />
      </div>
      <div className="stage__hold" ref={holdRef} />
      <canvas ref={frontRef} className="stage__canvas stage__canvas--front" />
      {!attract && hud && (
        <Hud
          {...hud}
          toasts={toasts}
          hint={hint && !tutorialMode}
          coach={tutorialMode ? null : coach}
          lesson={lesson}
          onSkip={tutorialMode ? onSkipTutorial : null}
          onPause={() => onPauseChange?.(true)}
        />
      )}
    </div>
  );
}

/** Haptic feedback on phones that support it (Android Chrome); no-op elsewhere. */
function buzz(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}
