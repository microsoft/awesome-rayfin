# AGENTS.md — Finance Analytics (Rayfin template)

Guidance for AI coding agents working in this repository.

## What this is

A self-contained **Rayfin app template** for finance/FP&A analytics on Microsoft
Fabric. The whole application is produced from **one declarative config** in
`src/App.tsx` via `createFabricStandardApp(...)`. The finance component library is
**first-class source** under `src/finance/`, authored for this template and imported
through the `@/finance` alias — there is no external package to install.

## Project map

| Path | What lives there |
| --- | --- |
| `src/App.tsx` | The app config — pages, KPIs, charts, filters, exports. Start here. |
| `src/data/sampleFinance.ts` | Deterministic offline sample dataset for the demo. |
| `src/main.tsx` / `src/main.css` | React entry + Tailwind v4 source scan + theme import. |
| `src/finance/` | Finance component library (charts, tables, shell, export) — first-class template source. |
| `src/finance/index.ts` | The library's public surface — the only thing App should import. |
| `rayfin/` | Rayfin service config (`rayfin.yml`) + empty data schema (data disabled). |
| `manifest.json`, `rayfin-template.yml` | Gallery/template metadata. |

## Conventions

- **Import components from `@/finance`** (the library barrel), never by deep path.
- **`src/finance/` is the shared component library** — prefer extending or composing it
  from `src/` (App.tsx, `src/fpa/`) so the library stays reusable, but it's first-class
  template source you can edit when a fix belongs there. It's linted and tested like the
  rest of the app.
- Add a page by pushing a `PageDef` onto `pages` in `src/App.tsx`.
- Add a chart by returning another spec from a page's `charts(t)` function.
- Charts/tables/grid default to accessible custom rendering; opt into the official
  Fabric engine (Vega / DataGrid) per-visual with `engine="fabric"` /
  `gridEngine: "fabric"`.
- Keep secrets out of source — Fabric auth is host-brokered at runtime.

## Gates (run before you finish)

```bash
npm run typecheck   # tsc -b (project refs)
npm run lint        # eslint (whole template, including src/finance)
npm run build       # tsc -b && vite build
npm test            # vitest run
```

All four must pass. The demo must still run offline (`npm run dev`) with no Fabric
workspace.
