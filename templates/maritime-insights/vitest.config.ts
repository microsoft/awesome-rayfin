import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The drone camera binds to window/DOM events, so it is tested in a DOM rather than mocked
    // away — the event plumbing is exactly where a free camera goes wrong.
    environment: "jsdom",
    // ⚠️ `e2e/` is Playwright's, and vitest's default glob claims every `*.spec.ts` in the repo.
    // Without this the unit run imports `@playwright/test` and fails a whole file while reporting
    // every individual test as passing — a red suite with no red test in it.
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
});
