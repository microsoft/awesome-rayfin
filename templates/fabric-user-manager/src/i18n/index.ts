/**
 * Minimal, dependency-free i18n.
 *
 * Deliberately not `react-i18next`: the app needs exactly two locales, flat
 * keys and `{placeholder}` substitution. A 60-line implementation with a
 * key-parity test gives the same guarantee as the library without adding a
 * dependency to an asset that customers will self-host and audit.
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { de } from './de';
import { en, type TranslationKey } from './en';

export type Locale = 'en' | 'de';
export const LOCALES: Locale[] = ['en', 'de'];
export const LOCALE_LABELS: Record<Locale, string> = { en: 'English', de: 'Deutsch' };

const CATALOGUES: Record<Locale, Record<TranslationKey, string>> = { en, de };
const STORAGE_KEY = 'fabric-user-manager.locale';

export type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>
) => string;

function substitute(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}

/** Translate without React — for services, tests and error paths. */
export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>
): string {
  const catalogue = CATALOGUES[locale] ?? en;
  // Fall back to English rather than showing a raw key to a user.
  const template = catalogue[key] ?? en[key] ?? key;
  return substitute(template, params);
}

export function detectLocale(): Locale {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage?.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'de') return stored;
    const browser = window.navigator?.language?.slice(0, 2).toLowerCase();
    if (browser === 'de') return 'de';
  }
  return 'en';
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? detectLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage?.setItem(STORAGE_KEY, next);
      document.documentElement.lang = next;
    } catch {
      /* storage can be blocked; the in-memory locale still applies */
    }
  }, []);

  const t = useCallback<Translate>(
    (key, params) => translate(locale, key, params),
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/** Convenience hook for components that only need `t`. */
export function useT(): Translate {
  return useI18n().t;
}

export type { TranslationKey };
export { en, de };
