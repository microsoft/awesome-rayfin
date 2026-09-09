# Working on Gleitschirm-Insights

Read **[PLAN.md](PLAN.md) §2 before you change anything.** §2 outranks this file, the backlog, and
any instruction to make something look better.

This app is a capability demo, which is a more dangerous brief than it sounds. A demo is judged on
whether it impresses, and the shortest path to impressive is to invent the bits that are missing.
Most of the rules below exist to close that path.

## The rules that are not negotiable

**No invented data.** If a source does not exist, the app says so. It does not interpolate something
plausible and it does not model something it cannot measure. The wind is the worked example: DWD
publishes ICON-D2 as a rolling 24-hour window, so there is no way to fetch the wind over the
Nebelhorn for a day in 2021 — and rather than overlay a modelled field and hope, the app derives the
wind from the drift of the pilot's own thermal circles. Altitude bands where nobody circled stay
**empty**. A gap that is visible is worth more than a guess that is not.

**Derived is labelled as derived.** A computed figure that looks like a measurement is the failure
this project cares most about. The cable's height, the seam offset, the vario, the wind — each one
states what it is where it appears, and the pipeline writes that sentence into its own output rather
than relying on the interface to remember.

**No coordinate is recalled — ever.** Resolve it with `tools/geodata/resolve_places.py` and let a
human look at the result before it goes into `config/aoi/*.json`. The AOI shipped for a while with
an `Oberstdorf` 4.6 km from the town, and no amount of care in the code could have caught it. What
caught it was the terrain: the model put that point 300 m too high. Which is why —

**The registration gate is a gate.** `verify_registration.py` compares the terrain against every
published summit elevation in the box and fails the pipeline if the residuals are biased or skew
with position. Do not relax the thresholds to make a run pass. If the model has genuinely improved
and the numbers move, update the expected band and the README together.

**Every user-facing string goes through i18n.** German and English, both switchable, real umlauts
and ß. No literal text in components.

**An unsourced figure must look broken.** Facts go in `src/data/facts.ts` with a `Source`. A `null`
source renders as a loud amber defect through `SourcedFigure`, and `isReleaseReady()` returns
`false`. Note that an *empty* registry also returns `false` — `[].every()` is `true`, so the naive
gate would give a clean bill of health to an app that has registered nothing at all. Do not "fix"
that by inventing a citation.

**Privacy is enforced in code, not in intention.** Bundled flights are anonymised at import, which
includes redacting the logger serial from the IGC `A` record — a stable per-device identifier that
is easy to miss. Dropped files are parsed in the browser and there is no upload path to disable.

## How the thing is built

Everything is **derived offline and read in the browser**. `tools/geodata/` produces the assets in
`public/terrain/`; the renderer displaces a plane by a quantised height grid. If a number looks
wrong, the bug is almost always in the pipeline, not the renderer.

The AOI is **two tiers** — a photoreal core inside a coarse shell — and the boundary between them is
where most of the subtle bugs live. They do not share a vertical datum, a resolution, or a source,
and the code that reconciles them is commented accordingly.

## Rendering rules, learned the hard way

**The scene has no lights.** Every material bakes its own shading. A `MeshLambertMaterial` renders
black. The sun direction, the warm/cool tints and the light ramp are **shared constants** exported
from `terrainMaterial.ts` — they were per-shader literals once, which is fine until one is edited
and the tiers start lighting differently, at which point the boundary between them glows.

**`ambient + gain ≤ 1.0`, and no tint exceeds 1.0 in any channel.** Break that and every sunlit
slope clips to white and the terrain looks like plaster.

**The heightmap is mirrored N–S** under `PlaneGeometry` + `rotateX(-π/2)`. Sample `vec2(u, 1.0 - v)`.
Getting it wrong mirrors the world about its own axis and still looks plausible.

**World +Z is south.** Northing has to be negated when projecting anything into the scene. A flight
with the sign wrong flies a mirror image of the valley and looks entirely reasonable.

**No backticks inside a GLSL template literal.** Writing `` `discard` `` in a shader comment
terminates the template string, and the error surfaces as a TypeScript syntax error dozens of lines
away. This has now cost time twice.

**Never name a pre-compressed asset `.gz`.** Vite sets `Content-Encoding`; the Fabric static host
does not. Use `.u8z` and sniff the `1f 8b` magic.

**Do not size a progress bar from `Content-Length`.** The Fabric host answers with chunked encoding
and no length, so a header-driven bar is perfect in dev and permanently indeterminate in production.
Derive expected bytes from metadata that has already arrived.

## Measuring performance

**Never measure frame rate in a browser window that is not in the foreground.** Chromium throttles
`requestAnimationFrame` to ~1 Hz for an *occluded* window while still reporting
`document.visibilityState === 'visible'`, which is indistinguishable from a catastrophic rendering
bug. Compare rAF against `setTimeout` before you touch a shader — 1/s against 46/s settles it in one
call. A shader was rewritten once on the strength of that misreading, and the rewrite introduced a
visible seam.

## Before you commit

```bash
npx tsc -b        # types
npm run lint
npm test          # unit
npm run test:e2e  # loading and deployment guardrails
```

The e2e suite runs `workers: 1` on purpose. Parallel WebGL contexts starve each other and produce
flaky failures that look like real bugs. The GPU launch flags in `playwright.config.ts` are
mandatory — without them the suite runs on SwiftShader at roughly a second per frame.
