---
name: app-validation
description: >
  What to validate and how to drive Playwright for this template's app. 
  Use alongside the playwright-cli skill — playwright-cli covers the tool's 
  commands; this skill covers performance rules, the required validation checklist, 
  the Fabric portal embed flow, and spec file guidance.
---

# App Validation

Use this skill **together with** the [playwright-cli](../playwright-cli/SKILL.md) skill when validating the running app in a browser. The playwright-cli skill is upstream-managed and only covers the tool itself; this skill captures everything specific to this template. This app can **only** be tested and validated with the Fabric portal embed flow. See [Testing inside the Fabric portal embed](#testing-inside-the-fabric-portal-embed).
**NEVER** test directly against `localhost` - the app will not work correctly.

## Performance Rules

### Use minimal initial_wait

**Always use `initial_wait: 1`** for all playwright-cli tool calls to avoid unnecessary delays. Do not increase it unless explicitly required.

> **Carve-out:** the **first** `open` against the Fabric portal embed (`*.fabric.microsoft.com/...?devUri=...`) takes 20–40s to render the appbackend chrome. Use `initial_wait: 30` once for that call, then `1` afterward. See [Testing inside the Fabric portal embed](#testing-inside-the-fabric-portal-embed).

### Skip auth — always

**NEVER interact with or validate the token/auth prompt page.** Inside your `run-code` call, inject the auth token via `sessionStorage.setItem` (or `localStorage.setItem`) and mock API responses with `page.route()` **before** calling `page.reload()`. The app must skip the auth prompt and render actual content immediately.

> **Carve-out:** this rule applies to apps that gate themselves behind a token check the agent controls. For real AAD redirects (e.g. the Fabric portal sign-in flow at `login.microsoftonline.com`), do **not** click sign-in buttons or fill credentials, and do **not** mock `sessionStorage` — use a `--persistent` profile instead so the user signs in once and cookies replay on subsequent runs. See [Testing inside the Fabric portal embed](#testing-inside-the-fabric-portal-embed).

### Skip screenshots unless asked

Only take a screenshot if the user explicitly requests one. Use `snapshot` (YAML accessibility tree) for validation.

## Required Checks

- UI elements render correctly and are visible.
- Text meets accessibility standards.
- No console errors from the app. Ignore Fabric portal noise - see [console-error-filter](#console-error-filter).

## Visual Consistency Checks

- Verify key layout containers have non-zero computed padding and gap values. Zero spacing usually indicates an invalid token class mapping.
- Verify chart background matches parent card background color.
- Verify bar and arc stroke colors match card background (not primary text color).
- Verify axis label and data-label colors are consistent across charts using shared foreground-secondary semantics.
- Verify grouped/multi-series bar charts do not show auto-injected data labels unless explicitly requested by design.
- Verify chart render height is healthy for each chart canvas/SVG. Treat charts rendering below ~100px as suspicious and below ~50px as likely squished.
- Verify standalone (non-grid) chart sections use definite `height` instead of only `minHeight` when chart wrappers use `h-full`.
- Compare computed `fontSize`, `fontFamily`, and `color` across related `input`, `select`, and `button` controls in the same toolbar/filter row.
- Include a `page.evaluate` style check in validation runs that reports spacing/token and form typography mismatches as structured failures.
- Include a `page.evaluate` chart-height check that inspects chart canvas/SVG client heights and reports squished-chart mismatches.

## Testing inside the Fabric portal embed

The URL under test should be `*.fabric.microsoft.com` and contain `devUri=`, so the app is being rendered **inside the Fabric portal as a deeply-nested iframe** (`portal → *pbiabd.powerbi.com/appbackend → http://localhost:5173`). Use the template's wired-up flow instead of the generic `open` recipe.

### One-liner

```bash
npm run test:fabric
```

This runs `scripts/open-fabric-portal.mjs` which composes the embed URL from the `VITE_FABRIC_*` env vars (written into `.env.local` / `.env.fabric` by `npx rayfin up`) and launches a named persistent session with the right Chromium flags:

```bash
playwright-cli -s=fabric open --persistent --config=.playwright-config.json "<embed-url>"
```

### Why three pieces are required

| Piece | Reason |
| --- | --- |
| `--persistent` profile | Real AAD sign-in cannot be mocked. The user signs in once; cookies persist for subsequent `playwright-cli -s=fabric open` calls. |
| `.playwright-config.json` Chromium flag | Disables `BlockInsecurePrivateNetworkRequests` / `LocalNetworkAccessChecks` so the HTTPS Fabric portal can iframe `http://localhost:5173`. Header-based opt-in does **not** work for top-level iframe navigations. |
| Vite `localNetworkAccessPlugin` | Sends `Access-Control-Allow-Private-Network: true` and answers LNA preflights, so fetch/XHR subresources from the embedded app pass. Belt-and-suspenders with the browser flag. |

### Frame discovery snippet

The app loads three frames deep. Use this single `run-code` to locate it:

```js
async page => {
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('iframe')).some(i => i.src.includes('localhost:5173')),
    { timeout: 30000 }
  );
  await page.waitForTimeout(3000);
  const f = page.frames().find(x => x.url().startsWith('http://localhost:5173'));
  const errFrame = page.frames().find(x => x.url().startsWith('chrome-error'));
  return {
    loaded: !!f,
    blockedByLNA: !!errFrame,
    title: f ? await f.title() : null,
  };
}
```

If `blockedByLNA: true`, the Chromium flag isn't taking effect — confirm `--config=.playwright-config.json` was passed.

### Console error filter

The Fabric portal emits its own errors that are **not app bugs**. Treat as portal noise (ignore) - only errors where the source URL starts with `http://localhost:5173` count as app errors.

See [`references/fabric-embed.md`](references/fabric-embed.md) for the full frame walker, `classifyConsoleMessages` helper, and troubleshooting matrix.

## Spec Files

Add spec files alongside source files as needed — for components, hooks, utilities, and query factory functions. Co-locate each spec file with the file it tests.

**When to add spec files:**
- **Always** for pure utility functions in `src/lib/` — these are easiest to unit-test and most likely to have edge cases.
- **Always** for query factory functions in `src/queries/` — verify that parameter combinations produce the correct query string, column metadata, and spec modifications.
- **As needed** — for hooks, test state transitions, returned values, and side effects using a React hooks testing library.
- **As needed** — for components, add spec files when the component contains non-trivial logic (e.g., conditional rendering, derived state, error states). Simple presentational components with no logic do not need a spec file.

**Key rules:**
- Never create a spec file just to satisfy coverage targets. Write tests only when they document expected behavior or guard against regressions.
- Tests must not use mock or hardcoded data to stand in for real query results — use representative fixture data that matches the real column shape.
- Keep each spec focused on one unit; do not write integration tests that span multiple layers.
