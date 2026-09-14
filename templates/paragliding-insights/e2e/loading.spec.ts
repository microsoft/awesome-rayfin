import { expect, test, type Page } from '@playwright/test';

/**
 * Tens of megabytes arrive before there is anything to look at, and for most of that time the
 * canvas is an empty pale rectangle. Without an indicator the page reads as broken rather than
 * busy, which is what these tests are here to prevent.
 *
 * Serial, and deliberately throttled: at full speed on a local dev server the whole load is over
 * in a few seconds, and a test that races it would catch one stage on a fast machine and none on
 * a slow one.
 */
test.describe.configure({ mode: 'serial' });

async function throttle(page: Page, megabitsPerSecond: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 20,
    downloadThroughput: (megabitsPerSecond * 1024 * 1024) / 8,
    uploadThroughput: (megabitsPerSecond * 1024 * 1024) / 8,
  });
}

interface Sample {
  stage: string;
  percent: number | null;
  loadedBytes: number;
}

/** Read the indicator, or null once it has gone. */
async function sample(page: Page): Promise<Sample | null> {
  return page.evaluate(() => {
    const box = document.querySelector('[data-testid="twin3d-loading"]');
    if (!box) return null;
    const bar = document.querySelector<HTMLElement>('[data-testid="twin3d-loading-bar"]');
    const bytes = document.querySelector('[data-testid="twin3d-loading-bytes"]')?.textContent ?? '';
    // "12,3 / 26,0 MB" in German, "12.3 / 26.0 MB" in English — take the first number either way.
    const loaded = Number((bytes.split('/')[0] ?? '').replace(',', '.').trim());
    const width = bar?.style.width ?? '';
    return {
      stage: box.getAttribute('data-stage') ?? '',
      percent: width.endsWith('%') ? Number(width.slice(0, -1)) : null,
      loadedBytes: Number.isFinite(loaded) ? loaded : 0,
    };
  });
}

test('the map says it is loading, and keeps saying how far along it is', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await throttle(page, 30);
  await page.goto('/');

  await expect(page.getByTestId('twin3d-loading')).toBeVisible();

  const samples: Sample[] = [];
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    const state = await sample(page);
    if (!state) break;
    samples.push(state);
    await page.waitForTimeout(120);
  }

  await expect(page.getByTestId('twin3d-canvas')).toHaveAttribute('data-ready', 'true', {
    timeout: 180_000,
  });
  await expect(page.getByTestId('twin3d-loading')).toHaveCount(0);

  // It has to actually move. A spinner proves nothing about whether bytes are still arriving,
  // and "is it stuck?" is the only question this element exists to answer.
  const withBytes = samples.filter((s) => s.loadedBytes > 0);
  expect(withBytes.length).toBeGreaterThan(5);
  expect(Math.max(...withBytes.map((s) => s.loadedBytes))).toBeGreaterThan(
    Math.min(...withBytes.map((s) => s.loadedBytes))
  );

  // Every stage is named, so the wait is legible rather than an opaque bar.
  const stages = [...new Set(samples.map((s) => s.stage))];
  expect(stages).toContain('terrain');

  // ⚠️ Regression guard. The land-cover descriptor used to be read lazily, part way through the
  // terrain stage, so the declared total grew and the bar fell back from 100 % to 90 %. Within a
  // stage the percentage must never decrease.
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1];
    const current = samples[i];
    if (previous.stage !== current.stage) continue;
    if (previous.percent === null || current.percent === null) continue;
    expect(current.percent).toBeGreaterThanOrEqual(previous.percent);
  }
});

test('the controls stay out of the way until there is something to control', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await throttle(page, 30);
  await page.goto('/');

  // A full panel over an empty canvas — place buttons and layer toggles, all of them inert — is
  // what made the page look broken rather than busy in the first place.
  await expect(page.getByTestId('twin3d-loading')).toBeVisible();
  await expect(page.getByTestId('twin3d-controls')).toHaveCount(0);
  await expect(page.getByTestId('twin3d-model-notice')).toHaveCount(0);

  await expect(page.getByTestId('twin3d-canvas')).toHaveAttribute('data-ready', 'true', {
    timeout: 180_000,
  });

  // And they all come back the moment the scene exists.
  await expect(page.getByTestId('twin3d-controls')).toBeVisible();
  await expect(page.getByTestId('twin3d-model-notice')).toBeVisible();
});
