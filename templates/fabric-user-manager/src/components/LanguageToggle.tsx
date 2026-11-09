import { LOCALES, LOCALE_LABELS, useI18n } from '@/i18n';

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t('common.language')}</span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as (typeof LOCALES)[number])}
        className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-gray-700"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_LABELS[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
