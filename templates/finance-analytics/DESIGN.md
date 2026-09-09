# Design decisions & known limitations

This template is a working artifact, not a polished product — this file records the
decisions behind it and the things it deliberately does *not* solve, so a reviewer can
evaluate the judgment, not just the output.

## Design principles

**One declarative config → a whole app.** The entire application (shell, routing,
filters, KPIs, charts, tables, export) is produced from a single
`createFabricStandardApp(...)` call in `src/App.tsx`. Adding a page is pushing a
`PageDef`; adding a chart is returning another spec from a page's `charts(t)`. The goal
is that a finance team can stand up a standardized Fabric app without hand-wiring a
React tree.

**Respect the platform seam.** The app reads data through a `DataSource` interface.
Offline it uses `staticDataSource(...)` over bundled sample rows; live it swaps to
`fabricDataSource(...)` against a Fabric semantic model. The seam is explicit and
documented (see README → *Connect a real semantic model*) rather than hidden behind an
"it just works" claim — because wiring a live model is real work the adopter owns.

**Opt-in Fabric engine with a built-in fallback.** Visuals and grids default to a
dependency-free built-in engine. Pages opt into the official Fabric engine per-surface
(`engine="fabric"` / `gridEngine="fabric"`), which renders on `@microsoft/fabric-datagrid`
and the Vega `VegaVisual`. The demo's Detail Grid opts in; remove that opt-in and the
`@microsoft/fabric-*` packages can be dropped entirely and the app still runs.

## Positioning

This is a **Fabric app template**, not a standalone static site — a deliberate, consistent
stance across `manifest.json` and `rayfin/rayfin.yml`:

- **Auth: Fabric, host-brokered.** Deployed to Fabric static hosting, the portal supplies
  the token at runtime (no secrets in source). Local `npm run dev` needs no auth because it
  runs entirely on bundled sample data.
- **Data: reads a semantic model; nothing Rayfin-managed** (`data: false`). The offline demo
  reads `staticDataSource(...)`; wiring a live model via `fabricDataSource(...)` is a real,
  documented adopter step (README → *Connect a real semantic model*).
- **Static hosting: yes** — `npm run build` → `dist/`.
- **Self-contained clone.** `package-lock.json` is committed and every dependency resolves
  from the public npm registry, so `npm ci` works on a clean checkout with no private feed.

So the shipped experience is an offline, deterministic **showcase** of a Fabric FP&A app.
The live-data path is real and exported but adopter-wired — and the UI says so (the header
reads *"Sample · FinanceModel"* with a *"Public — Sample Data"* badge) rather than implying
"it just works".

## Decisions & tradeoffs

| Decision | Why | Tradeoff accepted |
| --- | --- | --- |
| **Finance components as first-class source** (`src/finance/`) | The component library is original work authored for this template; shipping it as source (rather than an external dependency) keeps the template self-contained and runnable the moment you clone it | A substantial shared surface (~99 files); it's linted and tested with the rest of the template and consumed only through the `@/finance` barrel |
| **Derived metrics, not hardcoded** | A KPI literal that contradicts the underlying rows is a credibility landmine | Gross Margin is revenue-weighted from the data so it can never drift from the table |
| **YoY figures are illustrative** | The bundled sample has no time dimension | KPI deltas/prior-year are labeled placeholders in-code; adopters replace them with real prior-period measures on live wiring |
| **Host-brokered auth** | Fabric supplies the token at runtime | No secrets in source; nothing to configure locally, but you can't exercise the live path without a Fabric host |
| **Lazy-loaded Vega chart chunk** | The Fabric visual engine is large (~820 KB) | Accepted a chunk-size build warning in exchange for keeping it off the initial route |
| **FP&A statements module in its own `src/fpa/`** | The board-ready statements workspace is a distinct domain (multi-scenario fixtures, reconciliation math) — keeping it in `src/fpa/` leaves the general-purpose `src/finance/` library focused rather than absorbing app-specific statement logic | New surface authored fresh instead of extending the shared library; kept dependency-free and reuses the finance charts/export rather than adding libs |
| **Statements page owns its data with *local* controls** | A `custom` page can't honestly claim the shell's snapshot filters apply to a different (multi-scenario, dated) dataset | Controls are labelled "(local)"; the page is a self-contained workspace rather than being wired into global cross-filtering |
| **Board pack = scoped `@media print`** | A board-ready PDF without a heavy PDF dependency | Relies on the browser's native "Save as PDF"; print rules are scoped under `.fpa-board` so they never affect on-screen layout |

## FP&A statements module — deliberate scope

The Financial Statements workspace (`src/fpa/`) is built to *reconcile*, and its
boundaries are drawn on purpose so nothing is overstated:

- **Fully interactive, wired to the shell's intelligence rail.** Clicking a P&L
  line, an IBCS scenario column, a revenue-bridge waterfall step, a product mover
  or a rolling-forecast point pushes a `VisualSelection` (derived insights +
  an `ExplainInput`) into the shared `visualSelectionStore`, so the right-hand
  drawer drills into exactly what was clicked — the same channel the visuals
  gallery uses. Rows and bars carry rich hover tooltips (the `Tooltip` primitive
  and SVG `<title>`), and the statement uses in-cell variance heat bars for a
  dense, scan-friendly read.
- **Period follows the toolbar; comparison & currency stay local.** The page maps
  the shell's global period scope onto its anchored presets (`mapGlobalPreset`),
  so the toolbar's period genuinely filters the statement, while comparison and
  reporting-currency remain page-local (and are labelled as such — no false claim
  that segment/region filters, which target a different dataset, apply here).
- **Prior year is derived, not a scenario**; revenue reconciles to `units × price`
  product drivers (so the Price/Volume/Mix bridge ties out exactly); cash flow is
  the indirect method from explicit working-capital/capex inputs (not re-derived
  from the P&L). These invariants are asserted in `src/fpa/__tests__`.
- **"IBCS-inspired," not IBCS-certified.** It implements the scenario-notation
  fills (grayscale-safe, colour reserved for variance) but does not claim full
  IBCS compliance (scaling, labelling and ordering rules are only partially applied).
- **Currency** translates the P&L at period-average rates only (the PVM bridge and
  cash flow are scaled by the same factor); balance-sheet closing-rate translation
  and CTA are out of scope for a fixture.
- **Board pack print is dense on purpose.** A print-only cover header plus scoped
  `@media print` rules strip card chrome, tighten every table cell and cap chart
  heights, so the exported PDF reads like a real board pack rather than a
  screenshot with wide margins.
- **Balance Sheet & Liquidity completes the three-statement story.** The balance
  sheet is *articulated* — derived from the same reconciled P&L and cash-flow facts
  rather than invented — so Assets = Liabilities + Equity holds for every period and
  preset (asserted in `src/fpa/__tests__/balance-sheet.test.ts`). It presents
  point-in-time as of the latest actual month; the liquidity ratios (current, quick,
  DSO/DIO/DPO, CCC, NWC) use the selected window's *actual-only* flows, and the
  cash-conversion-cycle bridge + working-capital trend both drill the rail via a
  balance-sheet-specific, tone-neutral selection builder (raw balances aren't
  "higher = better", so no false ahead/behind framing). Balance-sheet is USD-only —
  closing-rate translation/CTA stay out of scope.
- **What-if Scenario Planner is a linear, reconciling model.** The base case is the
  current full-year outlook (actuals-to-date blended with forecast). Four levers
  (volume ±12%, price ±5%, gross-margin ±2pp, OpEx ±8%) drive a live EBIT bridge, a
  sensitivity tornado *re-centred on the live scenario*, scenario KPIs and a mini
  scenario P&L — all reconciling exactly (WhatIfPanel driver-math parity is
  unit-tested). The FCF figure is an explicitly-labelled proxy (EBIT × YTD cash
  conversion), not a re-derived cash flow.
- **Mobile-aware intelligence rail.** The desktop rail is hidden below `lg`, so a
  floating "Insights" button + focus-trapped bottom sheet surface the same drill
  selections on phones, auto-opening whenever a new selection is raised; interactive
  controls carry ≥36 px touch targets.
- **Explain-this-number drawer with inline visuals — and honest gates.** Clicking a
  number opens a scorecard header (status chip + trend arrow + an *attainment/rank
  dial only when the reading is genuinely like-for-like*), a short computed summary,
  and inline SVG mini-visuals: an Actual-vs-plan bar group (zero-baseline aware), a
  gap-preserving trend sparkline (plotted by original index with a median line), an
  outlier gauge with a true median ± 3.5·MAD band, and a composition breakdown. The
  honesty rules are enforced in the kernel (`src/finance/lib/insights-kernel.ts`):
  a window *aggregate* is never ranked against its own finer-grained series
  (percentile + anomaly are gated on a `pointInSeries` flag); a `directionality`
  flag (`higher-better` / `lower-better` / `neutral`) means balance-sheet balances
  never read as "favorable/unfavorable" or "ahead/behind"; the outlier status needs
  ≥6 comparable points and a non-degenerate scale; and the dial shows the true
  percentage (only the bar length is clamped). The panel and its SVGs live in a lazy
  chunk (`explain-panel`), off the initial-JS budget.
- **Step through siblings without leaving the drawer.** A statement row-click hands
  the rail the whole sibling set as one *atomic, immutable snapshot*
  (`visualSelectionStore.selectAt`), so a compact "‹ i of N ›" stepper walks every
  P&L / balance-sheet line; boundary buttons disable, a filter/period change starts a
  fresh scope rather than stepping through stale siblings, and the snapshot is cloned
  so later caller mutation can't corrupt navigation.
- **Deliberately omitted** (would overstate a template's capability): browser-local
  commentary, an ad-hoc formula/calculated-column engine, a Web Worker for pivoting
  (the bundled data is small; virtualization already covers rendering), and the
  direct cash-flow method.

## Density & the intelligence rail as a real drawer

Finance users live on-screen all day, so the shell is tuned for *screen real estate*
first — the critique was that the header, filters and KPI cards pushed every insight
below the fold, and the rail read as a stack of floating cards.

- **Compact is the default density.** `readDensity()` / the no-flash inline init in
  `index.html` now default to `compact` (an explicit `comfortable` still opts out and
  persists), and the type scale itself was pulled in (`--text-500/600/hero-700` →
  18/20/24 px with paired line-heights). KPI cards were flattened — no gradient fill,
  no decorative blur sheen, `rounded-xl`, tighter padding — so a row of them reads as
  quiet data, not chrome. Readability floors are respected (narrative/stat ≥13 px,
  controls ≥12 px, 10–11 px only for non-essential labels) and the duplicate breadcrumb
  (it only restated the page H1) was removed.
- **The rail scrolls independently.** Both the desktop nav and the right rail are
  `position: sticky` under a shared `--fabric-header-h` offset and capped at
  `calc(100dvh - var(--fabric-header-h))`, with a pinned header (`shrink-0`) over a
  `min-h-0 flex-1 overflow-y-auto` body — so the page and the rail each own their
  scrollbar and the rail never runs off the bottom of a long statement.
- **Flat, dense insight rows — not cards.** `IntelligenceRail` renders each insight as a
  hairline-separated row (tone dot/icon + title + metric on one line, a muted body, a
  tiny inline confidence meter, an inline source chip and a right-aligned action) with a
  tone filter. A `showHeading` prop lets the shell own the "Intelligence" label so it
  isn't printed twice.
- **Drill panel renders first, under a pinned context header.** `VisualDrillRail` mounts
  the numbers-first `ExplainPanel` *as the primary content* (not beneath a generic
  insight list) whenever a selection carries an `explain` payload, under a sticky
  "Inspecting · <visual>" header that keeps the `‹ i of N ›` stepper and close button in
  view while the deep-dive scrolls. Selections without an `explain` payload (bridge
  steps, movers, forecast points) fall back to their derived insight rows.

## Resting-rail insights: orient around any number, honestly

The overview rail doesn't wait for a click. Before you select anything, it surfaces
*honest, schema-derived* signals so a finance user can orient immediately — and every
one of them carries the evidence that justifies it, never a fabricated confidence score.

- **Concentration primitive (`lib/concentration.ts`).** A tiny, eager-safe HHI/Pareto
  helper (kept *out* of the lazy drill kernel so the app graph stays lean). It always
  reports the raw Herfindahl index **against its equal-share floor** (`evenHhi = 1/n`),
  the **effective number of groups** (`1/HHI`), the normalized 0–1 value, the vital-few
  count that first reaches 80%, and top share. A near-even 5-way split reads as
  "~5 effective" — it is never mislabelled "concentrated."
- **Schema-specific overview generator (`lib/overview-insights.ts`).** Three signals,
  each column-gated: revenue concentration by segment (share-bars + drill), a
  revenue-weighted margin leaders/laggards diverging strip (no drill — margins don't
  sum), and geographic revenue mix by region (share-bars + drill). The generic
  `generateInsights` gives the same treatment to any table.
- **Coverage guards keep drills honest.** A "break down" drill is only offered when every
  group is a finite, positive part that sums to the whole; if any group is negative or
  dropped, the composition drill is withheld rather than silently claiming to cover the
  whole "portfolio." The revenue-weighted margin insight is skipped entirely if any
  revenue-bearing row can't be weighted, so share denominators are never understated.
- **Inline micro-visuals (`features/insight-visuals.tsx`).** `share-bars`,
  `diverging-bars` (value vs a live center line), and a min–max `distribution` strip with
  a percentile dot — each `role="img"` with a spoken-sentence `aria-label`, and each
  rejecting non-finite centers/points. No `sparkline` on the overview (there is no time
  axis to honor).
- **Point-in-series ranking is time-truthful.** Clicking a realised month on the rolling
  forecast ranks it only against the periods that *preceded* it (the series is sliced
  through the click), so it is never scored against actuals that weren't known yet. A
  future forecast point keeps its qualitative WAPE/bias read-out instead of a false
  rank, and a genuine gap (no actual *and* no forecast) says "no data" rather than
  fabricating a zero. The drill's distribution strip and dial both read from the single
  shared `historyRank()` helper (prior-only, gated ≥6 points), so the ring, the summary
  text and the strip can never disagree.

## Per-page `scope`: every visible control is honest and live

The shell chrome (dimension filters, period, the live row count, the revalidation
banner and the resting rail insights) describes the *shell's* globally-filtered table.
Pages that render their own local dataset — the FP&A boards read bundled, reconciled
fixtures; the Feature Catalog is a static reference — used to show that same chrome even
though none of it drove their data. Filtering by Segment did nothing on the P&L, Period
was printed twice, and the rail showed model insights unrelated to the statement on
screen. That is exactly the "control that doesn't control" dishonesty this template
otherwise works hard to avoid.

- **`PageScope` capability contract (`app/page-types.ts`).** Each `PageDef` may declare a
  `scope`: `dimensions` (`"global"` \| `"none"`), `period` (`"global"` \| `"none"`),
  `showRowCount`, `standardRefresh`, `baseInsights` (`"on"` \| `"off"`) and a short
  `note`. Every field defaults to the fully-global behaviour, so pages that omit `scope`
  are unchanged. The shell reads it once (`fabric-standard-app.tsx`) and suppresses
  exactly the affordances that don't apply, then renders the `note` in the context header
  so the suppression is explicit ("Global filters paused · this board reads its own
  reconciled FP&A dataset").
- **Two-zone context header.** A real `<h1>` + one-line description sit left; the live
  controls (period, filters, row count or scope note) sit right and wrap on medium
  widths. Main padding was pulled to `py-3`, and the duplicate data-source badge removed,
  so the first substantive insight (KPI scorecard) clears the fold on every page at
  1440×900 compact — verified by a headless first-content-position measurement.
- **`baseInsights: "off"` keeps drill, drops mismatch.** Local pages emit no *resting*
  rail insights (they'd be sourced from the unrelated shell snapshot); instead the rail
  shows an inviting "Explore this view" prompt. Click-to-drill still works — a clicked KPI
  or statement line pushes its own scoped `VisualSelection`.
- **Semantic print rhythm (`.fpa-board-stack`).** Board vertical rhythm is a named class,
  not a literal `space-y-*`, so both the density toggle and the `@media print` override
  retarget it without fighting Tailwind utilities. A regression test
  (`__tests__/page-scope.test.tsx`) asserts a scoped page shows no dimension filter and no
  row count but does show its scope note, while an un-scoped page keeps both.

## Known limitations (honest inventory)

- **Live semantic-model path is not exercised end-to-end** in this repo — `fabricDataSource`
  is a real exported adapter, but the surrounding `fabric.yaml` / Rayfin `client` / columns
  map are adopter-supplied. The offline path is the one that's fully verified here.
- **Sample data is synthetic and deterministic** — clearly labeled, not real financials.

## Verification

`npm run typecheck && npm run lint && npm test && npm run build` all pass; `npm run
test:e2e` runs a Playwright smoke + axe accessibility scan. The gallery's repo-level
workflows run lint, build, and test for every template on each PR.
