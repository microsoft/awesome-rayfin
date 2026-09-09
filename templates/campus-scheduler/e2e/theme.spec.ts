import { expect, test, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * Light by default, dark on request.
 *
 * ⚠️ These check RENDERED COLOURS, not class names. The theme works by remapping the stone scale's
 * CSS variables rather than by adding `dark:` variants, so a class-name assertion would pass even
 * if the remapping never reached the page — the markup is identical in both themes. Reading back
 * `getComputedStyle` is the only check that can actually fail.
 *
 * The screenshots are a by-product for eyeballing, not the assertion.
 */

const SHOTS = 'C:/Users/alkorn/repos/temp';

async function waitForScene(page: Page) {
  await waitForCampusReady(page);
  await page.waitForTimeout(9000);
}

/**
 * Perceived lightness 0–1 of a computed colour string, or null if it is fully transparent.
 *
 * ⚠️ MUST HANDLE oklab(). Tailwind v4 implements every `/opacity` variant as
 * `color-mix(in oklab, …)`, and Chromium hands that back from `getComputedStyle` as
 * `oklab(0.505 0.169 0.088 / 0.7)` rather than `rgba(…)`. The first version of this helper matched
 * bare numbers and treated them as 0–255 channels, so an oklab colour scored about 0.0007 whatever
 * it actually looked like — which is how "nicht verfügbar" got reported as invisible when it is
 * perfectly legible. Two colours parsed that way differ by a rounding error, so the check failed
 * against itself rather than against the app.
 *
 * oklab's first component IS perceptual lightness, so it needs no conversion; rgb gets Rec. 709.
 */
function parseColour(raw: string): { lightness: number; alpha: number } | null {
  if (!raw) return null;
  const numbers = (raw.match(/[\d.]+/g) ?? []).map(Number);
  if (!numbers.length) return null;

  if (raw.startsWith('oklab') || raw.startsWith('oklch')) {
    const alpha = raw.includes('/') ? numbers[numbers.length - 1] : 1;
    return alpha === 0 ? null : { lightness: numbers[0], alpha };
  }

  const [r, g, b] = numbers;
  const alpha = numbers.length > 3 ? numbers[3] : 1;
  if (r === undefined || alpha === 0) return null;
  return { lightness: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, alpha };
}

/**
 * Flatten a stack of semi-transparent layers into the lightness actually seen.
 *
 * ⚠️ Stopping at the first non-transparent background is not good enough. The "Fragen" button is
 * `bg-amber-500/10` over the panel: a 10% tint is visually almost nothing, but taken as THE
 * surface it made light text look as though it sat on a bright amber field, and the button was
 * reported as the worst contrast in the app at 0.126. Layers arrive in paint order, outermost
 * first.
 */
function flatten(layers: Array<{ lightness: number; alpha: number }>): number {
  let result = layers.length ? layers[0].lightness : 1;
  for (const layer of layers) result = layer.alpha * layer.lightness + (1 - layer.alpha) * result;
  return result;
}

/** The text colour, and every background layer between the element and the first opaque one. */
async function colourPairs(page: Page, selector?: string) {
  return page.evaluate((sel) => {
    const alphaOf = (raw: string) => {
      const numbers = (raw.match(/[\d.]+/g) ?? []).map(Number);
      if (!numbers.length) return 0;
      if (raw.startsWith('oklab') || raw.startsWith('oklch')) {
        return raw.includes('/') ? numbers[numbers.length - 1] : 1;
      }
      return numbers.length > 3 ? numbers[3] : 1;
    };

    const scope = sel ? Array.from(document.querySelectorAll(sel as string)) : null;
    const targets =
      scope ??
      Array.from(document.querySelectorAll('h1, h2, p, button, span, td, th, li')).filter((el) => {
        const text = (el.textContent ?? '').trim();
        if (!text || el.children.length) return false;
        const box = el.getBoundingClientRect();
        if (box.width < 4 || box.height < 4) return false;
        // ⚠️ Map labels are exempt, and not as a convenience. They are positioned over the WebGL
        // canvas from the render loop and carry their own light halo (see .gs-label in main.css),
        // so what is behind them is photoreal terrain — which this walk cannot see, because a
        // canvas has no CSS background to find. Measuring them reports the shell's colour instead
        // and calls a perfectly legible label invisible. They are also theme-independent by
        // design: the terrain does not change when the chrome does.
        return !el.closest('.gs-labels') && !el.classList.contains('gs-label');
      });

    return targets.map((el) => {
      const layers: string[] = [];
      let node: Element | null = el;
      while (node) {
        const value = getComputedStyle(node).backgroundColor;
        const alpha = alphaOf(value);
        if (alpha > 0) {
          layers.unshift(value); // outermost ends up first
          if (alpha >= 0.999) break;
        }
        node = node.parentElement;
      }
      return {
        tag: el.tagName,
        classes: el.getAttribute('class') ?? '',
        text: (el.textContent ?? '').trim().slice(0, 32),
        front: getComputedStyle(el).color,
        layers,
      };
    });
  }, selector);
}

/**
 * The worst text-against-its-own-background separation anywhere in the visible chrome.
 *
 * This is the failure mode of theming by variable: markup is identical in both themes, so an
 * element whose text colour flips while its surface does not (or vice versa) looks completely
 * normal in the DOM and is invisible on screen. Walking the rendered tree is the only way to catch
 * it, and it has to run in BOTH themes — the first version only ever checked light, which is
 * exactly the half that was already known to be fine.
 *
 * ⚠️ Backgrounds are resolved by walking UP the tree, because most elements have none of their
 * own. Reading `backgroundColor` directly gave `rgba(0,0,0,0)` for the header, which failed the
 * light assertion honestly and passed the DARK one for a bogus reason: transparent scores 0, and
 * 0 is convincingly "dark".
 */
async function worstContrast(page: Page) {
  const pairs = await colourPairs(page);
  let smallest = 1;
  let offender = '';
  for (const pair of pairs) {
    const front = parseColour(pair.front);
    const layers = pair.layers
      .map(parseColour)
      .filter((c): c is { lightness: number; alpha: number } => c !== null);
    if (!front || !layers.length) continue;
    const back = flatten(layers);
    // Text can be semi-transparent too, and composites onto whatever it sits on.
    const effective = front.alpha * front.lightness + (1 - front.alpha) * back;
    const gap = Math.abs(effective - back);
    if (gap < smallest) {
      smallest = gap;
      offender = `${pair.tag} "${pair.text}" [${pair.classes}] — text ${pair.front} over ${pair.layers.join(' / ')}`;
    }
  }
  return { smallest, offender };
}

/** Lightness of one element's text, or of the surface it sits on. */
async function luminanceOf(page: Page, selector: string, prop: 'color' | 'backgroundColor') {
  const [pair] = await colourPairs(page, selector);
  if (!pair) return null;
  if (prop === 'color') return parseColour(pair.front)?.lightness ?? null;
  const layers = pair.layers
    .map(parseColour)
    .filter((c): c is { lightness: number; alpha: number } => c !== null);
  return layers.length ? flatten(layers) : null;
}

/** Colour transitions run for ~150 ms; a screenshot taken before they settle is a lie. */
async function settle(page: Page) {
  await page.waitForTimeout(500);
}

test.describe('Theme', () => {
  test('starts light, and the shell really is painted light', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Captured before the assertions, so a failure still leaves something to look at.
    await page.screenshot({ path: `${SHOTS}/theme-light.png` });

    const background = await luminanceOf(page, 'header', 'backgroundColor');
    const text = await luminanceOf(page, 'header h1', 'color');
    expect(background).toBeGreaterThan(0.8);
    expect(text).toBeLessThan(0.25);
  });

  test('the toggle switches to dark and back', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await settle(page);

    await page.screenshot({ path: `${SHOTS}/theme-dark.png` });

    const background = await luminanceOf(page, 'header', 'backgroundColor');
    const text = await luminanceOf(page, 'header h1', 'color');
    expect(background).toBeLessThan(0.2);
    expect(text).toBeGreaterThan(0.75);

    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('remembers the choice across a reload', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await waitForCampusReady(page);
    // Applied as the module loads, so it is already right on the first paint rather than
    // corrected after one — a dark-mode visitor should never see a white flash.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('nothing ends up invisible against its own background, in either theme', async ({
    page,
  }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);
    await page.getByTestId('calendar-open').click();
    await expect(page.getByTestId('calendar-panel')).toBeVisible();
    await settle(page);

    const light = await worstContrast(page);
    expect(light.smallest, `light mode, lowest separation on: ${light.offender}`).toBeGreaterThan(
      0.15
    );

    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await settle(page);

    const dark = await worstContrast(page);
    expect(dark.smallest, `dark mode, lowest separation on: ${dark.offender}`).toBeGreaterThan(
      0.15
    );
  });
});
