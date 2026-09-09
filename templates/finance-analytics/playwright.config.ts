import { defineConfig, devices } from "@playwright/test";

// E2E + accessibility smoke for the demo app. Boots the Vite dev server on a
// fixed port so CI and local runs are deterministic. Kept intentionally small —
// this is a gallery template, so the value is a fast "does it load, navigate and
// pass axe" signal, not exhaustive coverage.
const PORT = 5199;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
