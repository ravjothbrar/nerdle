import { streakProgress, MAX_MULTIPLIER } from '../game/scoring.js';

export default function Hud({ score, coins, multiplier, streak, shields, toasts, hint, coach, lesson, onSkip, onPause }) {
  return (
    <div className="hud" aria-live="polite">
      <div className="hud__left">
        <div className="hud__label">score</div>
        <div className="hud__score" data-testid="score">
          {score.toLocaleString('en-US')}
        </div>
        <div className={`hud__mult ${multiplier > 1 ? 'hud__mult--on' : ''}`} key={multiplier}>
          <span>×{multiplier}</span>
          <span className="hud__streakbar" aria-label={`streak ${streak}`}>
            <span style={{ width: `${streakProgress(streak) * 100}%` }} />
          </span>
          {multiplier >= MAX_MULTIPLIER && <span className="hud__max">max</span>}
        </div>
      </div>

      <button className="hud__pause" onClick={onPause} aria-label="Pause">
        <svg viewBox="0 0 24 24" width="18" height="18">
          <rect x="6" y="5" width="4" height="14" rx="1.5" fill="currentColor" />
          <rect x="14" y="5" width="4" height="14" rx="1.5" fill="currentColor" />
        </svg>
      </button>

      <div className="hud__right">
        <div className="hud__coins" data-testid="coins">
          <span className="coin" aria-hidden="true">✓</span>
          {coins}
        </div>
        <div className="hud__shields" aria-label={`${shields} shield${shields === 1 ? '' : 's'}`}>
          <Shield on={shields > 0} />
        </div>
      </div>

      {lesson && (
        <div className={`lesson lesson--${lesson.tone}`} key={lesson.title} role="status">
          <div className="lesson__title">{lesson.title}</div>
          <div className="lesson__body">{lesson.body}</div>
          {lesson.key && <LessonKeys verb={lesson.key} />}
        </div>
      )}
      {onSkip && (
        <button className="lesson__skip" onClick={onSkip}>
          Skip tutorial ›
        </button>
      )}
      {coach && (
        <div className="hud__coach" key={coach}>
          <CoachText kind={coach} />
        </div>
      )}
      {hint && !coach && (
        <div className="hud__hint">
          {isTouch() ? 'Swipe' : (
            <>
              <kbd>←</kbd> <kbd>→</kbd> Steer
            </>
          )}{' '}
          into the <b>TRUE</b> equation
        </div>
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function Shield({ on }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" className={`shield ${on ? 'shield--on' : ''}`}>
      <path
        d="M12 2 L20 5 V11 C20 16.5 16.5 20.5 12 22 C7.5 20.5 4 16.5 4 11 V5 Z"
        fill={on ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {!on && <path d="M6 6 L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

const isTouch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

function LessonKeys({ verb }) {
  const touch = isTouch();
  if (verb === 'steer')
    return (
      <div className="lesson__keys">
        {touch ? (
          <span>Swipe ← or →</span>
        ) : (
          <>
            <kbd>←</kbd> <kbd>→</kbd> <span>or</span> <kbd>A</kbd> <kbd>D</kbd>
          </>
        )}
      </div>
    );
  if (verb === 'jump')
    return <div className="lesson__keys">{touch ? <span>Swipe up ↑</span> : <><kbd>↑</kbd> <span>or</span> <kbd>W</kbd> <span>/</span> <kbd>Space</kbd></>}</div>;
  return <div className="lesson__keys">{touch ? <span>Swipe down ↓</span> : <><kbd>↓</kbd> <span>or</span> <kbd>S</kbd></>}</div>;
}

function CoachText({ kind }) {
  const touch = isTouch();
  if (kind === 'barrier')
    return (
      <>
        <kbd>↑</kbd> {touch ? 'Swipe up to jump!' : 'Jump the hurdle!'}
      </>
    );
  if (kind === 'beam')
    return (
      <>
        <kbd>↓</kbd> {touch ? 'Swipe down to duck!' : 'Duck under the beam!'}
      </>
    );
  if (kind === 'wall') return <>🧱 Walls can’t be jumped — switch lanes!</>;
  return <>Take the equation only if it’s TRUE — else the other route</>;
}
