import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration.
 *
 * ⚠️ `package.json` advertised `npm run test:e2e` long before this file existed, so the command
 * failed for anyone who tried it — the same broken promise as the pipeline runner. These specs
 * exist for one class of defect that unit tests structurally cannot catch: **things that are
 * rendered but cannot be reached.** A control can be present in the DOM, carry the right handler,
 * be covered by a passing unit test, and still be impossible to click because it sits below the
 * fold of a panel that does not scroll. That is exactly how the site optimiser looked broken while
 * working perfectly.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["line"]],
  use: {
    baseURL: "http://localhost:5173",
    // A small viewport on purpose: the panel fits on a large screen and hides its own bottom on a
    // laptop, which is the machine a demo is actually given from.
    viewport: { width: 1280, height: 800 },
    // 🔴 **Headed, deliberately.** This is a WebGL app: headless Chromium falls back to software
    // rasterisation, and the same specs that pass in 53 s with a GPU time out at 120 s without
    // one. Running headless here would not be testing the app, it would be testing SwiftShader.
    // Measured: all four specs pass headed and all four time out headless on the same commit.
    headless: false,
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 5173",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
