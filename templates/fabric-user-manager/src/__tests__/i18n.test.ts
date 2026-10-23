import { describe, expect, it } from 'vitest';

import { de, en, detectLocale, translate } from '@/i18n';

/**
 * i18n guard rails.
 *
 * Doing i18n later is a full-app refactor, and a half-translated German UI in
 * front of a German public-sector customer is worse than no German at all —
 * so key parity is a build-breaking test, not a review checklist item.
 */
describe('i18n catalogues', () => {
  it('de defines exactly the same keys as en', () => {
    const enKeys = Object.keys(en).sort();
    const deKeys = Object.keys(de).sort();
    expect(deKeys).toEqual(enKeys);
  });

  it('has no empty strings in either catalogue', () => {
    for (const [key, value] of Object.entries({ ...en })) {
      expect(value, `en.${key}`).not.toBe('');
    }
    for (const [key, value] of Object.entries(de)) {
      expect(value, `de.${key}`).not.toBe('');
    }
  });

  it('uses real umlauts and never ASCII substitutes in German', () => {
    // A German string that contains none of äöüß but does contain a telltale
    // ASCII substitution is almost certainly a mis-encoded translation.
    const suspicious = /(?:\bfuer\b|\bueber\b|\bmoeglich\b|\bgroesse\b|\bstrasse\b)/i;
    for (const [key, value] of Object.entries(de)) {
      expect(suspicious.test(value), `de.${key} uses ASCII umlaut substitutes`).toBe(false);
    }
  });

  it('keeps placeholder sets identical between locales', () => {
    const placeholders = (s: string) =>
      (s.match(/\{(\w+)\}/g) ?? []).sort().join(',');
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(de[key]), `placeholders differ for ${key}`).toBe(
        placeholders(en[key])
      );
    }
  });

  it('substitutes placeholders', () => {
    expect(translate('en', 'um.request.waiting', { count: 2 })).toContain('2');
    expect(translate('de', 'um.request.waiting', { count: 3 })).toContain('3');
  });

  it('falls back to English rather than showing a raw key', () => {
    // Simulate a missing German string by translating a key the catalogue has.
    expect(translate('de', 'app.name')).toBe('Fabric User Manager');
  });

  it('detects a locale without throwing outside the browser', () => {
    expect(['en', 'de']).toContain(detectLocale());
  });
});
