/**
 * The two small charts around the guidelines: how far the tailoring is, and
 * one bar per row. They carry no text of their own; labels come from the caller.
 */
const INK = '#1e293b';
const GRID = '#e2e8f0';
const MUTED = '#64748b';
const FONT = { fontFamily: '"Segoe UI", system-ui, sans-serif' };

/** How far the tailoring is: a ring with the count in the middle. */
export function ProgressRing({ answered, total, label, size = 88, onDark }: { answered: number; total: number; label: string; size?: number; onDark?: boolean }) {
  const r = 34;
  const circumference = 2 * Math.PI * r;
  const share = total > 0 ? answered / total : 0;
  return (
    <svg viewBox="0 0 88 88" width={size} height={size} role="img" aria-label={label} style={FONT}>
      <circle cx={44} cy={44} r={r} fill="none" stroke={onDark ? 'rgba(255,255,255,0.25)' : GRID} strokeWidth={8} />
      {share > 0 && (
        <circle
          cx={44}
          cy={44}
          r={r}
          fill="none"
          stroke={onDark ? '#fff' : '#2563eb'}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${share * circumference} ${circumference}`}
          transform="rotate(-90 44 44)"
        />
      )}
      <text x={44} y={43} textAnchor="middle" fontSize={20} fontWeight={600} fill={onDark ? '#fff' : INK}>
        {answered}
      </text>
      <text x={44} y={58} textAnchor="middle" fontSize={10} fill={onDark ? 'rgba(255,255,255,0.8)' : MUTED}>
        {`/ ${total}`}
      </text>
    </svg>
  );
}

/** One line per row: name, a bar, the value. Used for rules per area and answers per category. */
export function MeterList({ rows, onDark }: { rows: { name: string; value: number; of?: number; text: string }[]; onDark?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.of ?? r.value));
  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li key={row.name} className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto] items-center gap-2 text-xs">
          <span className={`truncate ${onDark ? 'text-white/90' : 'text-slate-700'}`} title={row.name}>
            {row.name}
          </span>
          <span className={`block h-2 overflow-hidden rounded-full ${onDark ? 'bg-white/20' : 'bg-slate-200'}`} aria-hidden="true">
            <span className={`block h-full rounded-full ${onDark ? 'bg-white' : 'bg-blue-600'}`} style={{ width: `${(row.value / (row.of ?? max)) * 100}%` }} />
          </span>
          <span className={`min-w-6 text-right tabular-nums ${onDark ? 'text-white' : 'text-slate-900'}`}>{row.text}</span>
        </li>
      ))}
    </ul>
  );
}
