import { displayToken } from '../game/equations.js';

/** A row of Nerdle tiles. `state`: idle | correct | wrong | ghost. */
export function TileRow({ text, state = 'idle', size = 'md', label, highlight }) {
  const tokens = [...text];
  return (
    <div className={`tiles tiles--${size}`} aria-label={label ?? text.replace(/-/g, '−')} role="img">
      {tokens.map((ch, i) => (
        <span
          key={i}
          className={`tile tile--${highlight?.match(i) ? highlight.state : state}`}
          style={{ '--i': i }}
          aria-hidden="true"
        >
          {displayToken(ch)}
        </span>
      ))}
    </div>
  );
}

/** The share-card grid: one mini tile per resolved gate / hit. */
export function HistoryGrid({ history, max = 60 }) {
  const shown = history.length > max ? history.slice(-max) : history;
  return (
    <div className="history" aria-label={`${history.length} results`}>
      {history.length > max && <span className="history__more">+{history.length - max}</span>}
      {shown.map((h, i) => (
        <span key={i} className={`history__cell history__cell--${h}`} style={{ '--i': i }} />
      ))}
    </div>
  );
}
