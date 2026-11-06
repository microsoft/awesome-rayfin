import { useI18n } from '@/i18n';
import { useTheme } from '@/theme';

/**
 * Light / dark switch, sitting beside the language switch because it is the same kind of choice:
 * how the interface presents itself, changeable at any point rather than only on the way in.
 *
 * A single button rather than a two-option group. The language switch shows DE and EN together
 * because neither is the obvious default; here there are only two states and the current one is
 * visible on screen already, so the control says what it will DO rather than where it is.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { t } = useI18n();
  const { theme, toggle } = useTheme();
  const label = theme === 'dark' ? t('theme.toLight') : t('theme.toDark');

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      data-theme-state={theme}
      onClick={toggle}
      title={label}
      aria-label={label}
      className={`rounded px-2 py-1 text-xs text-stone-400 transition hover:bg-stone-800 hover:text-stone-100 ${className}`}
    >
      {/* Drawn rather than an icon font: two glyphs, no dependency, and they scale with the text. */}
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
        {theme === 'dark' ? (
          // A sun: what the button switches TO.
          <>
            <circle cx="10" cy="10" r="4" />
            <path
              d="M10 1v2.2M10 16.8V19M19 10h-2.2M3.2 10H1M16.4 3.6l-1.6 1.6M5.2 14.8l-1.6 1.6M16.4 16.4l-1.6-1.6M5.2 5.2 3.6 3.6"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </>
        ) : (
          // A crescent moon.
          <path d="M16.5 12.4A7.2 7.2 0 0 1 7.6 3.5a7.2 7.2 0 1 0 8.9 8.9Z" />
        )}
      </svg>
    </button>
  );
}
