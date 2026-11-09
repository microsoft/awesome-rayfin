import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Light mode remaps Tailwind's colour ramps — and this test exists because it has silently
 * failed to remap one twice.
 *
 * ⚠️ THE SAME BUG SHIPPED TWICE, AND BOTH TIMES IT HID THE WARNING RATHER THAN THE DECORATION.
 * `main.css` inverts the stone ramp so the whole UI re-colours, and it inverts the PALE accent
 * steps (50–300) because those are used as TEXT: on a dark page `text-red-200` is a legible pink,
 * on paper it is pink on pink. `--color-red-100` was missed once — a conflict message rendered
 * nearly invisible on its own panel. `--color-red-200` was missed again, and it is the colour the
 * walk list paints "this professor cannot make it between these two rooms" in: three warnings that
 * were the least readable rows on screen, in the mode the app starts in.
 *
 * Neither was caught by the rendered-contrast e2e test, because both live in views that test never
 * opens (a conflict panel, a walk list for a cohort that crosses campus). A screenshot only checks
 * what it happens to be looking at. Reading the SOURCE checks all of them, costs milliseconds, and
 * cannot be dodged by a view being closed — so the rule is enforced where the rule lives.
 */

// ⚠️ THE PROJECT ROOT COMES FROM THE RUNNER, NOT FROM `import.meta.url`. Vitest transforms this
// file through Vite's dev server, so its module URL is an **http** one whose pathname is
// `/@fs/C:/…`: stripping a leading drive letter off that leaves `C:\@fs\C:\…` and `fileURLToPath`
// refuses it outright ("The URL must be of scheme file"). Both attempts died on the import, before
// a single assertion ran — a test that cannot load is indistinguishable from one that passes if
// nobody reads the summary. Vitest sets the working directory to the project root, which is the
// one path that is true under both the runner and a plain `node`.
const ROOT = process.cwd();
const css = readFileSync(join(ROOT, 'src', 'main.css'), 'utf8');

/** Every pale step of a non-stone ramp used as a text colour anywhere in the app. */
const PALE_TEXT = /\btext-(amber|emerald|red|sky|rose|lime|teal|indigo|violet|orange|yellow|green|blue)-(50|100|200|300)\b/g;

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : sources(path);
    return /\.(tsx?|css)$/.test(entry) && entry !== 'main.css' ? [path] : [];
  });

/** The variables a `:root[data-theme='…']` block declares. */
const declared = (theme: string): Set<string> => {
  const start = css.indexOf(`:root[data-theme='${theme}']`);
  expect(start, `no ${theme} theme block in main.css`).toBeGreaterThan(-1);
  const block = css.slice(start, css.indexOf('\n}', start));
  return new Set([...block.matchAll(/--color-([a-z]+-\d+)\s*:/g)].map((m) => m[1]));
};

describe('the light theme covers every colour it has to invert', () => {
  const used = new Set<string>();
  for (const file of sources(join(ROOT, 'src'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(PALE_TEXT)) {
      used.add(`${match[1]}-${match[2]}`);
    }
  }

  it('finds the pale accent text colours the app actually uses', () => {
    // A guard that matched nothing would pass forever. This asserts the scan still works.
    //
    // ⚠️ RE-BASED, NOT RELAXED. This used to demand more than five tokens and to pin `red-200`,
    // both of which were facts about the university cockpit that has since been deleted from this
    // repository — a week grid, a conflict banner and five lens panels between them used most of
    // the pale ramp. The logistics shell uses two. Keeping the old numbers would have meant either
    // a permanently red test or re-introducing colours nothing needs; the honest move is to assert
    // against what the app contains now, and to keep the anti-idle guard that matters.
    expect(used.size).toBeGreaterThan(1);
    expect(used).toContain('emerald-300');
  });

  it('declares each of them in light mode, where pale on pale is invisible', () => {
    const light = declared('light');
    expect([...used].filter((token) => !light.has(token)).sort()).toEqual([]);
  });

  it('restores each of them in dark mode, so the two themes read side by side', () => {
    // Dark states Tailwind's own ramp in full rather than relying on the default. A token present
    // in one block and absent from the other is how a colour ends up frozen at whatever the last
    // theme set it to when the user toggles.
    const dark = declared('dark');
    expect([...declared('light')].filter((token) => !dark.has(token)).sort()).toEqual([]);
  });
});
