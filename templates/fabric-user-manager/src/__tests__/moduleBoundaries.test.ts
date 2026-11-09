import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The i18n rule: no user-visible literal strings in components. (The Governance Hub this app grew out
 * of also checked its module boundaries here; the template has no modules, so only this rule is left.)
 */
const SRC = resolve(import.meta.dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('no literal user-facing strings in components', () => {
  // Cheap stand-in for eslint-plugin-i18next: catch JSX text nodes that contain
  // real words. Deliberately narrow (>= 4 letters) to avoid punctuation noise.
  //
  // The negative lookbehind skips `=>` and `/>`, so TypeScript generics such as
  // `) => Promise<boolean>` are not mistaken for JSX text.
  const JSX_TEXT =
    /(?<![=/])>\s*([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß' ]{3,})\s*</g;
  const ALLOWLIST = new Set<string>([]);

  // The drawings of the Power BI guidelines are part of the guideline content.
  // Their labels are written in English in the file and looked up in
  // `um/guidelines/figures.de.ts` for German; a test of their own
  // (umGuidelines) fails when a German wording is missing.
  const ENGLISH_CONTENT = /guidelines[\\/]figures(More)?\.tsx$/;

  const files = walk(SRC).filter(
    (f) =>
      f.endsWith('.tsx') &&
      !f.includes('__tests__') &&
      !f.includes('AuthPage') &&
      !ENGLISH_CONTENT.test(f)
  );

  it.each(files.map((f) => relative(SRC, f)))('%s uses t() for visible text', (rel) => {
    const source = readFileSync(join(SRC, rel), 'utf8');
    const hits = [...source.matchAll(JSX_TEXT)]
      .map((m) => m[1].trim())
      .filter((text) => !ALLOWLIST.has(text));
    expect(hits, `literal strings found: ${hits.join(' | ')}`).toEqual([]);
  });
});
