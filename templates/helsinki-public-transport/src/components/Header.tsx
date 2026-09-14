import { SPEED_LEGEND } from '@/theme';

interface HeaderProps {
  live: boolean;
  updatedAt: number | null;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

function relativeTime(updatedAt: number | null): string {
  if (!updatedAt) return 'connecting...';
  const seconds = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  if (seconds < 2) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

export function Header({ live, updatedAt, theme, onToggleTheme }: HeaderProps) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
      <div className="flex items-center gap-2">
        <h1 className="text-[15px] font-semibold tracking-tight">
          Helsinki Public Transport Realtime Tracker
        </h1>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
            live ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
          }`}
          data-testid="live-pill"
        >
          <span
            aria-hidden
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              live ? 'animate-pulse bg-emerald-400' : 'bg-amber-400'
            }`}
          />
          {live ? 'live' : 'stale'}
        </span>
        <span className="text-[11px] opacity-50">{relativeTime(updatedAt)}</span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <ul className="hidden items-center gap-2 md:flex" aria-label="Speed legend">
          {SPEED_LEGEND.map((entry) => (
            <li key={entry.label} className="flex items-center gap-1 text-[10px] opacity-60">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              {entry.label}
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={onToggleTheme}
          className="rounded-md border border-white/10 px-2 py-1 text-[11px] hover:bg-white/[0.06]"
        >
          {theme === 'dark' ? 'Light' : 'Dark'} mode
        </button>
      </div>
    </header>
  );
}
