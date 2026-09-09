import { useI18n, type Locale } from '@/i18n';

/**
 * DE / EN switch.
 *
 * Shared rather than local to one screen, so the language can be changed at any point rather than
 * only on the way in. PLAN §14 Q5 wants one switch driving the interface *and*, later, the
 * assistant voice — so it has to be reachable throughout.
 *
 * The label is the two codes rather than a flag: flags are countries, not languages.
 */
export function LanguageToggle({ className = '' }: { className?: string }) {
  const { locale, setLocale } = useI18n();

  return (
    <div
      data-testid="language-toggle"
      className={`flex gap-1 text-xs ${className}`}
      role="group"
      aria-label="Sprache / Language"
    >
      {(['de', 'en'] as const satisfies readonly Locale[]).map((code) => (
        <button
          key={code}
          type="button"
          data-testid={`lang-${code}`}
          aria-pressed={locale === code}
          lang={code}
          onClick={() => setLocale(code)}
          className={
            locale === code
              ? 'rounded bg-stone-200 px-2.5 py-1 text-stone-800'
              : 'rounded px-2.5 py-1 text-stone-500 hover:text-stone-700'
          }
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
