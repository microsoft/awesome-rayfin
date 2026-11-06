import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * No human-formatted numbers typed into the panel.
 *
 * ⚠️ THIS EXISTS BECAUSE THE BUG IT CATCHES SHIPPED ONCE. `DcShell` carried `value="3.539 m²"`,
 * `value="88,99 – 103,10 m ü. NHN"`, `value="0,50 m/px"` and `'49,7 Mrd. €'`: German decimal
 * commas, German thousands separators and a German magnitude word, hard-coded into a component
 * that renders in English. The i18n catalogue test could not see them: they were never `t()` calls,
 * so there was no key to be missing.
 *
 * The rule is therefore mechanical: a `value=` on a `<Fact>` may be a computed expression or a
 * catalogue lookup, but never a literal containing a digit.
 *
 * The one exception is an address, which is a proper noun and does not reformat.
 */

const ROOT = process.cwd();
const SHELL = readFileSync(join(ROOT, 'src', 'components', 'DcShell.tsx'), 'utf8');

/** `value="…"`: a string literal, as opposed to `value={…}`, which is an expression. */
const LITERAL_VALUES = /value="([^"]*)"/g;

const ALLOWED_LITERALS = new Set([
  // An address. See the note above.
  'Koelnmesse, 50679 Cologne-Deutz',
]);

describe('the panel never hard-codes a formatted number', () => {
  const literals = [...SHELL.matchAll(LITERAL_VALUES)].map((m) => m[1]);

  it('finds the literal values at all, so the scan cannot idle', () => {
    // If `Fact value="…"` ever stops existing the regex would match nothing and this file would
    // pass forever while guarding nothing. Assert the scan still sees the known exception.
    expect(literals.length).toBeGreaterThan(0);
    expect(literals).toContain('Koelnmesse, 50679 Cologne-Deutz');
  });

  it('has no digit-bearing literal outside the allowed list', () => {
    const offenders = literals.filter((v) => /\d/.test(v) && !ALLOWED_LITERALS.has(v));
    expect(
      offenders,
      'hard-coded numbers render in one language only — compute them, or put both renderings in the catalogue'
    ).toEqual([]);
  });

  it('has no German magnitude or datum words left in the source', () => {
    // These are the specific words that were wrong before: they belong in the catalogue, never in a
    // component. Matched as whole words so a comment explaining the rule does not trip it.
    const banned = [/value="[^"]*\bMrd\b/, /value="[^"]*\bü\. NHN\b/, /value="[^"]*\bRund\b/];
    const hits = banned.filter((re) => re.test(SHELL)).map((re) => re.source);
    expect(hits).toEqual([]);
  });
});
