import { defineConfig, devices } from '@playwright/test';

/**
 * The dev-server port for e2e.
 *
 * ⚠️ This was 4175, which Campus-Insights — the twin this app was forked from, in the same
 * workspace — also uses. `reuseExistingServer` does not check *which* application answers on the
 * port, so whichever of the two had a server up first served the other's specs, which then failed
 * looking for elements that exist in neither app. A collision that reads as a regression.
 *
 * A port nothing else in the workspace claims, and an override for when something does.
 *
 * ⚠️ THAT NOTE PROTECTS AGAINST THE WRONG APP, NOT AGAINST A SECOND RUN OF THIS ONE.
 * `reuseExistingServer` also means two concurrent `playwright test` runs of THIS repo attach to
 * one vite server and one machine — which happened while the second site was being added, with
 * another session running its own specs at the same time. The symptom is maddening and looks
 * exactly like a broken feature: the heaviest specs (LMU, 37 MB of assets) failed 6 of 7 while
 * the lighter ones passed, and the same 7 passed alone a minute later. If a run goes red on
 * timeouts rather than on assertions, check whether something else is driving the browser before
 * believing it. `CS_E2E_PORT` gives a second run its own server.
 */
const PORT = process.env.CS_E2E_PORT ?? '4177';
const ORIGIN = `http://127.0.0.1:${PORT}`;

/**
 * The fast lane.
 *
 * `npm run e2e` runs THESE files and takes about 80 seconds; `npm run e2e:full` runs everything.
 * The split exists because a suite you only run before a commit is a suite that tells you about a
 * mistake an hour after you made it.
 *
 * ⚠️ CHOSEN ON MEASURED TIME AND ON VALUE, NOT ON SPEED ALONE. Every file below was timed
 * individually (see the table in PLAN §30); the set sums to ~65 s of test time and ~1.3 min of
 * wall clock once the vite server is up. `german` (19.7 s), `calendar` (21.7 s), `drawer`
 * (21.9 s) and `confirm gate` (22.4 s) are all excluded for one reason: each would spend a third
 * of the budget. They run in the full lane, which is where a suite that takes minutes belongs.
 *
 * What the fast lane deliberately keeps despite costing time:
 *   * `site-guard`  — answering for the wrong university is this project's worst failure mode
 *   * `replan`      — the product
 *   * `move`, `walk`, `flow` — the interactions a planner actually performs
 *
 * ⚠️ IT IS A SMOKE LANE, NOT A LICENCE. Green here means "nothing obvious broke in the last few
 * minutes". Before deploying, run `e2e:full`.
 */
const FAST_LANE = [
  'site-guard.spec.ts',
  'replan.spec.ts',
  'move.spec.ts',
  'rail.spec.ts',
  'loading.spec.ts',
  'clearChat.spec.ts',
  'walk.spec.ts',
  'flow.spec.ts',
  // 7.4 s measured, the cheapest file in the lane. It earns the slot on the same rule as the
  // rest: it guards the load boundary — the national map must NOT pull a campus down when you
  // select one — and that is a property a screenshot cannot see and a regression would not
  // announce.
  'national.spec.ts',
];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // ⚠️ ONE WORKER, AND IT USED TO BE TWO. The original note said two was "comfortable once the GPU
  // is doing the rasterising", and that was true — measured against ONE site, whose assets come to
  // about 20 MB. A second site landed at 37 MB, so two workers now hold two large WebGL scenes at
  // once and the machine cannot keep up: `panel.spec.ts` failed 2 of 5 at two workers and passed
  // 5 of 5 at one, with the failure always "campus-canvas not visible in 30 s" — resource
  // starvation, not a defect in what the test asserts.
  //
  // The alternative was to raise the timeouts and keep the parallelism, which buys speed by making
  // every future failure ambiguous. This suite's whole argument (see the header of render.spec.ts)
  // is that a suite expected to be red stops being read; an intermittently red one is worse,
  // because it teaches you to re-run rather than to look.
  //
  // ⚠️ AND THE REAL COST WAS NEVER THE WORKER COUNT. The full run had grown to 27 minutes because
  // `activeAoi()` handed React a new object every render and the whole WebGL scene was being
  // rebuilt about once a second (PLAN §28). One worker was compensating for that bug as much as
  // for the renderer. Do not raise this without measuring — and without checking that nothing else
  // is driving the machine at the time, which is how the 19 "failures" in that 27-minute run were
  // manufactured.
  workers: 1,
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
  projects: [
    {
      name: 'fast',
      use: { ...devices['Desktop Chrome'] },
      testMatch: FAST_LANE,
    },
    {
      // Everything, including the fast lane — so `e2e:full` is genuinely the whole suite and not
      // "the rest", which would let a fast-lane spec rot unnoticed if the two ever diverged.
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
