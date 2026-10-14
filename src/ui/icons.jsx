
/** Small engraved-looking note icon used across the ribbon and palettes. */
export function NoteIcon({ base = 4, dots = 0, size = 22, color = 'currentColor' }) {
  const filled = base >= 4;
  const stem = base >= 2;
  const flags = { 8: 1, 16: 2, 32: 3, 64: 4 }[base] || 0;
  const paths = [];
  for (let i = 0; i < flags; i++) {
    const y = 3 + i * 4.2;
    paths.push(
      <path
        key={i}
        d={`M11.2 ${y} c4.2 1.6 5.6 4.4 4.2 7.4 c.9 -3.4 -.9 -5 -4.2 -6.1 z`}
        fill={color}
      />,
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
      <g transform="translate(0,1)">
        <ellipse
          cx="6.4" cy="15.4" rx="5" ry="3.5"
          transform="rotate(-22 6.4 15.4)"
          fill={filled ? color : 'none'}
          stroke={color}
          strokeWidth={filled ? 0 : 1.6}
        />
        {stem && <rect x="10.6" y="2.4" width="1.5" height="13.2" fill={color} />}
        {paths}
        {Array.from({ length: dots }).map((_, i) => (
          <circle key={i} cx={14.6 + i * 3.2} cy="14.2" r="1.35" fill={color} />
        ))}
      </g>
    </svg>
  );
}

export function RestIcon({ base = 4, size = 22, color = 'currentColor' }) {
  if (base === 1 || base === 2) {
    return (
      <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
        <rect x="5" y={base === 1 ? 8 : 10.5} width="12" height="4" fill={color} />
        <rect x="4" y={base === 1 ? 7.4 : 14} width="14" height="1" fill={color} opacity=".5" />
      </svg>
    );
  }
  if (base === 4) {
    return (
      <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
        <path
          d="M8 3 l4 5 -3.4 3.2 4.4 4.6 c-2.6 -1.6 -5 -1 -5.6 1 -.5 1.7 .6 3.2 2 3.9 -3 -.6 -4.6 -2.7 -4.2 -5 .3 -1.8 1.9 -2.7 3.6 -2.6 l-3.6 -4.4 3.2 -3.1 z"
          fill={color}
        />
      </svg>
    );
  }
  const hooks = { 8: 1, 16: 2, 32: 3, 64: 4 }[base] || 1;
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
      <path d={`M13.6 ${3.5 + hooks * 0.6} L7 19`} stroke={color} strokeWidth="1.5" fill="none" />
      {Array.from({ length: hooks }).map((_, i) => (
        <g key={i} transform={`translate(0 ${i * 4})`}>
          <circle cx="8.6" cy="5.6" r="1.7" fill={color} />
          <path d="M9.4 4.4 c2.6 -1.4 4.4 -1.2 5 .4" stroke={color} strokeWidth="1.3" fill="none" />
        </g>
      ))}
    </svg>
  );
}

export function Glyph({ children, size = 17 }) {
  return <span className="glyph" style={{ fontSize: size }}>{children}</span>;
}
