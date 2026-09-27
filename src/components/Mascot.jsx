// The Nerdle cube: a plum rounded cube with little legs. From behind (while
// running) it wears the white "n" logo; from the front it has a face.

export default function Mascot({ facing = 'front', mood = 'happy', running = false, className = '', style }) {
  return (
    <svg
      className={`mascot ${running ? 'mascot--running' : ''} ${className}`}
      style={style}
      viewBox="0 0 100 124"
      role="img"
      aria-label="Nerdle cube mascot"
    >
      {/* legs */}
      <g className="mascot__legs" stroke="var(--mascot-limb)" strokeWidth="6" strokeLinecap="round" fill="none">
        <path className="mascot__leg mascot__leg--l" d="M38 92 L34 108 L28 112" />
        <path className="mascot__leg mascot__leg--r" d="M62 92 L66 108 L72 112" />
      </g>
      {/* arms */}
      <g stroke="var(--mascot-limb)" strokeWidth="5" strokeLinecap="round" fill="none">
        <path className="mascot__arm mascot__arm--l" d="M18 62 L8 72 L10 80" />
        <path className="mascot__arm mascot__arm--r" d="M82 62 L92 72 L90 80" />
      </g>
      {/* cube: top, side, front */}
      <g stroke="var(--mascot-outline, none)" strokeWidth="3" strokeLinejoin="round">
        <path d="M22 26 L34 14 L90 14 L78 26 Z" fill="var(--mascot-top)" />
        <path d="M78 26 L90 14 L90 78 L78 92 Z" fill="var(--mascot-side)" />
        <rect x="14" y="26" width="66" height="66" rx="10" fill="var(--mascot-front)" />
      </g>
      {facing === 'back' ? (
        // nerdle "n" logo
        <path
          d="M31 78 V44 H55 a9 9 0 0 1 9 9 V78 H55 V54 H40 V78 Z"
          fill="#fff"
        />
      ) : (
        <g>
          {mood === 'dead' ? (
            <g stroke="#fff" strokeWidth="4.5" strokeLinecap="round">
              <path d="M28 44 L38 54 M38 44 L28 54" />
              <path d="M56 44 L66 54 M66 44 L56 54" />
            </g>
          ) : (
            <g>
              <rect x="25" y="40" width="16" height="17" rx="4" fill="#fff" />
              <rect x="53" y="40" width="16" height="17" rx="4" fill="#fff" />
              <rect className="mascot__pupil" x="31" y="45" width="7" height="8" rx="2" fill="#1b0b16" />
              <rect className="mascot__pupil" x="59" y="45" width="7" height="8" rx="2" fill="#1b0b16" />
            </g>
          )}
          {mood === 'dead' ? (
            <path d="M34 76 q6 -6 12 0 q6 6 12 0" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" />
          ) : mood === 'wow' ? (
            <ellipse cx="47" cy="74" rx="6" ry="7" fill="#fff" />
          ) : (
            <path d="M34 68 q13 14 26 0" stroke="#fff" strokeWidth="4.5" fill="none" strokeLinecap="round" />
          )}
        </g>
      )}
    </svg>
  );
}
