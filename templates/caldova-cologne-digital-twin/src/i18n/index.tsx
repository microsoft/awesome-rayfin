import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

import en from './en.json';

/**
 * The interface ships in English only. The catalogue plumbing stays so every string still lives in
 * one place (`en.json`) and a reachability test can catch a key that does not exist.
 */
export type Locale = 'en';

/** The `Intl` formatting locale for numbers and dates in the twin and the Reorder tab. */
export const NUMBER_LOCALE = 'en-GB';

type Bundle = typeof en;

function lookup(bundle: Bundle, path: string): string {
  const value = path
    .split('.')
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], bundle);
  return typeof value === 'string' ? value : path;
}

interface I18nValue {
  locale: Locale;
  /** Translate a dotted key, optionally interpolating `{{name}}` placeholders. */
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    let text = lookup(en, key);
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{{${name}}}`, String(value));
      }
    }
    return text;
  }, []);

  const value = useMemo<I18nValue>(() => ({ locale: 'en', t }), [t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
