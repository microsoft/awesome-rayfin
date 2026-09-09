import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The translation contract.
 *
 * ⚠️ **This exists because a raw i18n key shipped to the screen.** The flow panel asked for
 * `occupancy.days.thu` when the catalogue says `occupancy.day.thu`, and the app rendered the key
 * itself — visible in a screenshot, invisible to `tsc`, and invisible to every e2e test because
 * the element was present and non-empty. A missing translation is not a typo, it is a defect that
 * reaches the user, and it needs to fail the build rather than the demo.
 *
 * Two checks, both cheap:
 *
 *   * **parity** — German and English carry exactly the same keys, so adding a string in one
 *     language and forgetting the other is a failure rather than a silent fallback
 *   * **reachability** — every key any component asks for actually exists
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const SRC = join(ROOT, 'src');

function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>)
    // `$comment` keys document the catalogue and are deliberately not translated.
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

const de = JSON.parse(readFileSync(join(SRC, 'i18n', 'de.json'), 'utf-8'));
const en = JSON.parse(readFileSync(join(SRC, 'i18n', 'en.json'), 'utf-8'));

describe('translation catalogues', () => {
  it('carry exactly the same keys in both languages', () => {
    const german = flatten(de).sort();
    const english = flatten(en).sort();
    expect(german.filter((k) => !english.includes(k)), 'missing from en.json').toEqual([]);
    expect(english.filter((k) => !german.includes(k)), 'missing from de.json').toEqual([]);
  });

  it('use real umlauts in German, never ae/oe/ue transliterations', () => {
    // The project writes German with ä ö ü ß. A transliteration usually means someone worked
    // around an encoding problem rather than fixing it, and the encoding problem is the real bug.
    const raw = readFileSync(join(SRC, 'i18n', 'de.json'), 'utf-8');
    const suspicious = raw.match(/\b(Gebaeude|Raeume|Flaeche|fuer|ueber|groesse|Strasse)\b/gi);
    expect(suspicious ?? []).toEqual([]);
  });

  it('resolve every key the components ask for', () => {
    const known = new Set(flatten(de));
    const missing: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf-8');
      // Literal calls only. Template keys are built at runtime and are checked below.
      for (const match of text.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'\s*[,)]/g)) {
        if (!known.has(match[1])) missing.push(`${file.slice(ROOT.length + 1)}: ${match[1]}`);
      }
      // Interpolated keys such as t(`condition.scenarios.${id}`) — check the fixed PREFIX exists,
      // which is what catches `occupancy.days.` against a catalogue that spells it `occupancy.day.`
      for (const match of text.matchAll(/\bt\(\s*`([a-zA-Z0-9_.]+)\.\$\{/g)) {
        const prefix = match[1];
        if (![...known].some((key) => key.startsWith(`${prefix}.`))) {
          missing.push(`${file.slice(ROOT.length + 1)}: ${prefix}.* (no such group)`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('interpolate the same placeholders in both languages', () => {
    // A German string that omits a {{key}} the English one fills renders the literal braces on
    // screen, which reads as broken data rather than a missing translation.
    const placeholders = (path: string, tree: unknown) => {
      let node: unknown = tree;
      for (const key of path.split('.')) node = (node as Record<string, unknown>)?.[key];
      if (typeof node !== 'string') return '';
      return [...node.matchAll(/\{\{(\w+)\}\}/g)]
        .map((m) => m[1])
        .sort()
        .join();
    };
    const differing = flatten(de)
      .filter((path) => flatten(en).includes(path))
      .filter((path) => placeholders(path, de) !== placeholders(path, en));
    expect(differing).toEqual([]);
  });

  it('resolve the keys the error mapper produces', () => {
    // ⚠️ These keys are chosen at RUNTIME from the backend's error code, so `t(...)` never sees a
    // literal and the reachability scan above cannot see them either. A typo here would surface
    // only as a raw key on screen, at the exact moment something else has already gone wrong.
    const known = new Set(flatten(de));
    const source = readFileSync(join(SRC, 'api', 'apiError.ts'), 'utf-8');
    const referenced = [...source.matchAll(/'(calendar\.[a-zA-Z0-9_.]+)'/g)].map((m) => m[1]);

    expect(referenced.length).toBeGreaterThan(4);
    expect(referenced.filter((key) => !known.has(key))).toEqual([]);
  });
});

/**
 * ⚠️ NO IT JARGON IN TEXT A PLANNER READS.
 *
 * "Solver" shipped twice and had to be reported twice by the person using the app — the second
 * time in a sentence that literally promises "kein Fachbegriff" and then uses one. Nobody outside
 * this repository knows what a solver is, and worse, the word does not say what it DOES: it plans.
 * The same goes for "Backend", which appeared in the site-mismatch banner a demo audience sees.
 *
 * These words are all perfectly good in the source. The rule is only about strings that reach a
 * screen, which is why this test reads the catalogues and not the code.
 *
 * ⚠️ KEYS ARE EXEMPT, VALUES ARE NOT. The catalogue has a `backend` namespace and a `draft`
 * namespace; those are identifiers a developer types, not prose anybody reads. Matching on the
 * flattened key would fail this test on its own structure and teach the next person to weaken it.
 */
const JARGON = [
  'solver',
  'backend',
  'frontend',
  'endpoint',
  'payload',
  'cache',
  'constraint',
  'proposal-id',
  'uuid',
  'bounding box',
  'deterministisch',
  'bestätigungstor',
];

describe('the language a planner actually reads', () => {
  const valueAt = (catalogue: unknown, key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => {
      if (typeof node !== 'object' || node === null) return undefined;
      return (node as Record<string, unknown>)[part];
    }, catalogue);

  for (const [lang, catalogue] of [
    ['de', de],
    ['en', en],
  ] as const) {
    it(`${lang}.json uses no IT jargon in anything on screen`, () => {
      const offences: string[] = [];
      for (const key of flatten(catalogue)) {
        const value = valueAt(catalogue, key);
        if (typeof value !== 'string') continue;
        const haystack = value.toLowerCase();
        for (const word of JARGON) {
          // `notConfigured` names the environment variable a deployer has to set. That one is
          // addressed to whoever deployed the app rather than to a planner, and the variable is
          // useless if it is paraphrased — so the VALUE may contain it, spelled as the variable.
          if (word === 'backend' && value.includes('VITE_SCHEDULER_API')) continue;
          if (haystack.includes(word)) offences.push(`${key}: ${word}`);
        }
      }
      expect(offences, `jargon reaching the screen in ${lang}.json`).toEqual([]);
    });
  }
});
