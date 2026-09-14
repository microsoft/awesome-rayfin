import { defineConfig, devices } from '@playwright/test';

/**
 * The dev-server port for e2e.
 *
 * ⚠️ This was 4175, which the two Campus twins in the same workspace also use.
 * `reuseExistingServer` does not check *which* application answers on the port, so when one of
 * those had a server up first, this suite loaded that app instead: the first spec failed looking
 * for `twin3d-canvas`, and once that foreign server exited the rest failed on ECONNREFUSED. Five
 * failures that looked like a regression and were a port collision.
 *
 * A port nothing else in the workspace claims, and an override for when something does.
 */
const PORT = process.env.GS_E2E_PORT ?? '4176';
const ORIGIN = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // The 3D specs drive a live WebGL2 scene: a 14 MB heightmap and ~4 100 LoD2 buildings. Two
  // workers is comfortable once the GPU is doing the rasterising (see launchOptions below);
  // beyond that the specs contend for the GPU and fail on timeouts unrelated to what they assert.
  workers: 2,
  timeout: 90_000,
  reporter: 'list',
  use: {
    baseURL: ORIGIN,
    trace: 'on-first-retry',
    launchOptions: {
      // Headless Chromium defaults to SwiftShader, so WebGL is rasterised on the CPU. For this
      // scene that is roughly 900 ms per frame, and because rendering blocks the main thread every
      // `evaluate`, click and wheel event queues behind it — 90 s timeouts were being blown by a
      // handful of interactions that take milliseconds in a real browser. Handing the work to the
      // GPU takes the median frame from ~880 ms to ~16 ms. Where no GPU is available (most CI
      // images) Chromium silently falls back to SwiftShader, so this is safe to set unconditionally.
      args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
      ignoreDefaultArgs: ['--disable-gpu'],
    },
  },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT}`,
    url: `${ORIGIN}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
