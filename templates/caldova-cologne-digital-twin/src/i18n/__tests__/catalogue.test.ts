import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The translation contract. The interface ships in English only, from `src/i18n/en.json`.
 *
 * ⚠️ **This exists because a raw i18n key shipped to the screen once.** A panel asked for a key
 * the catalogue spelled differently, and the app rendered the key itself: visible in a screenshot,
 * invisible to `tsc`, and invisible to every e2e test because the element was present and
 * non-empty. A missing string is a defect that reaches the user, so it fails the build.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const SRC = join(ROOT, 'src');

function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>)
    // `$comment` keys document the catalogue and are deliberately not shown.
    .filter(([key]) => !key.startsWith('$'))
    .flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

const en = JSON.parse(readFileSync(join(SRC, 'i18n', 'en.json'), 'utf-8'));

describe('translation catalogue', () => {
  it('is the only catalogue (English only)', () => {
    const catalogues = readdirSync(join(SRC, 'i18n')).filter((f) => f.endsWith('.json'));
    expect(catalogues).toEqual(['en.json']);
  });

  it('resolves every key the components ask for', () => {
    const known = new Set(flatten(en));
    const missing: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf-8');
      // Literal calls only. Template keys are built at runtime and are checked below.
      for (const match of text.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'\s*[,)]/g)) {
        if (!known.has(match[1])) missing.push(`${file.slice(ROOT.length + 1)}: ${match[1]}`);
      }
      // Interpolated keys such as t(`dc.events.${id}`): check the fixed PREFIX exists.
      for (const match of text.matchAll(/\bt\(\s*`([a-zA-Z0-9_.]+)\.\$\{/g)) {
        const prefix = match[1];
        if (![...known].some((key) => key.startsWith(`${prefix}.`))) {
          missing.push(`${file.slice(ROOT.length + 1)}: ${prefix}.* (no such group)`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

/**
 * ⚠️ NO IT JARGON IN TEXT A USER READS.
 *
 * These words are all perfectly good in the source. The rule is only about strings that reach a
 * screen, which is why this test reads the catalogue and not the code. Keys are exempt, values are
 * not.
 */
const JARGON = ['solver', 'backend', 'frontend', 'endpoint', 'payload', 'cache', 'constraint', 'uuid', 'bounding box'];

describe('the language a user actually reads', () => {
  const valueAt = (catalogue: unknown, key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => {
      if (typeof node !== 'object' || node === null) return undefined;
      return (node as Record<string, unknown>)[part];
    }, catalogue);

  it('en.json uses no IT jargon in anything on screen', () => {
    const offences: string[] = [];
    for (const key of flatten(en)) {
      const value = valueAt(en, key);
      if (typeof value !== 'string') continue;
      const haystack = value.toLowerCase();
      for (const word of JARGON) {
        if (haystack.includes(word)) offences.push(`${key}: ${word}`);
      }
    }
    expect(offences, 'jargon reaching the screen in en.json').toEqual([]);
  });
});
