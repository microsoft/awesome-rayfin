# Finance tab: source and licences

The Finance tab (code folder `src/finance`) is a port of Michael Tenner's IBCS Finance Cockpit onto the
Caldova finance model `caldova-cologne-finance`. Values derived from the twin, otherwise synthetic.

## Where it comes from

| Part | Source | Revision |
|---|---|---|
| Cockpit app (pages, components, hooks, lib, queries) | github.com/Losveratos/Fabric-Apps-Demo, `apps/datenwg-finance-cockpit`, branch `finance-cockpit-ibcs` | 97b1d79 (2026-10-20), plus d1e86b2 (grass green #4CAF50), 847afc8 (order PL, PY, AC, FC) 6ad0648 (neutral ink accent #2B2B2B, variance sentence with the absolute delta), 1b23b46 (P&L statement and P&L tree as the original visual behind a switch in P&L & Simulation), a392659 (variance direction by sign, colour by impact) and 5394e02 (opaque, back-to-front trend columns) |
| `dwg/` (DwgPage, DwgVisual, dwg-page.ts) and `dwg/pages/*` | same repo, branch `showcase`, generated with `node dwg/dwg.mjs app page` from `tools/finance/guv-spec.json` | c5438fd |
| `vendor/dwg-visuals` (ChartKitchen byDatenWG 1.52.2, P&L Statement byDatenWG 1.5.2) and `vendor/dwg-pixelgrid` | same repo, branch `showcase` | c5438fd |

Credit: Michael Tenner, DatenWG. IBCS® is a registered trademark of the IBCS Institute; the pages are
based on IBCS, not certified.

## Licences

- `LICENSE.cockpit-template`: MIT, Copyright (c) Microsoft Corporation (the Fabric Apps template the
  cockpit is built on).
- `LICENSE.datenwg`: MIT, Copyright (c) 2026 Michael Tenner (the repo, the dwg generator and the visuals).

The vendored visual code under `vendor/` and `dwg/` is redistributed here under Michael Tenner's MIT licence
(`LICENSE.datenwg`, also reproduced in `public/THIRD-PARTY-NOTICES.txt`). Keep that notice with any copy.

## What the port changed

- **Data:** no semantic-model connector and no Functions. `hooks/use-semantic-model-query.ts` answers
  from `public/data/finance/snapshot.json` (`lib/snapshot.ts`), baked by
  `tools/fabric/bake_finance_snapshot.py`; the deploy's drift gate re-runs every query (`--check`). A
  delegated connector would make the app open only for its owner.
- **Cut:** Data Agent panel, story mode and videos, comments, sign-off, month scrubber, time travel,
  command palette, "Share scenario" (the route is in memory, a link cannot restore it), palette switch
  (fixed IBCS green/red), dark mode, writeback (`hooks/use-writeback.tsx`
  is a stub; the forecast panel only downloads Excel), speed badge.
- **Simulation:** volume and price levers per category only; cost and tax levers removed.
- **Names:** Caldova's line names in `lib/pnl/engine.ts` (Revenue, Cost of goods sold, Merchandise,
  Operating expenses, Financial result, Income taxes, EBT), default unit kEUR, KPIs Revenue, COGS,
  Gross Profit, Logistics Cost, Profit, Units Sold, Drops, Tour km. `lib/pnl/engine.spec.ts` uses those
  names with Michael's expected values unchanged.
- **Language:** the UI is English with en-GB number and date formats. The generated `dwg/` files are
  patched to English by `tools/finance/dwg-english.mjs` after every `dwg app page` run; the vendored
  visuals fall back to their own English strings.
- **Shell:** `FinanceApp.tsx` replaces the cockpit's app shell: in-memory routes with undo/redo, filter
  breadcrumb, keys only while the tab is visible. Two pages (KPI Cockpit, P&L & Simulation); Michael's
  P&L visual sits behind the 'Table | Original visual' switch (`components/guv/OriginalPnl.tsx`). Caldova
  difference: the spec is laid out on the Full HD pixel grid, so OriginalPnl draws only its content zone
  (`region={pageRegion(spec, true)}`) and collapses the empty chip row; the visual scrolls inside its tile.
- **Styles:** `finance.css` overrides the shared token names only under `[data-tab='finance']`; only
  names unique to the cockpit go into `@theme` (a test checks this).
- **Removed specs:** `charts.spec.tsx` and `TimeChart.spec.tsx` (they need @testing-library, which this
  repo does not use).
- **Imports:** `@/` rewritten to `@finance/`.
- **File and identifier names:** the boundary to the rest of the twin is English (folder `src/finance`,
  alias `@finance`, `FinanceApp`, tab id `finance`, `public/data/finance`, `tools/finance`). Inside the
  port, Michael's own German file and identifier names stay as they are (`pages/GuvPage.tsx`,
  `components/guv`, `queries/guv/konten.dax`, `queries/cockpit/maerkte.dax`, `konten`, `werte`,
  `monate`, `land`, `kategorie`, `produkt`, `wuerfel`, `vorjahr` and so on), so that his upstream diffs
  still apply file by file. Everything the user sees is English.

## Re-sync with a newer cockpit or showcase

1. In a worktree of Michael's repo (never his `main`): `git diff 5394e02..<new> -- apps/datenwg-finance-cockpit/packages/frontend/src`
   and apply what touches files kept here (his `src/` is `src/finance/` here), keeping the cuts above.
2. dwg pages: in a showcase worktree run
   `node dwg/dwg.mjs app page --app <stage> --spec tools/finance/guv-spec.json --connector guv --model fabric/caldova-cologne-finance.SemanticModel`
   and copy `dwg/`, `dwg/pages/*` and both `vendor/` folders over, run `node tools/finance/dwg-english.mjs`
   and update the revisions in this file.
3. Re-bake (`python tools/fabric/bake_finance_snapshot.py`), then `npx vitest run` and `npx tsc -b`.
