# Fabric Atlas agent guide

## Purpose

Fabric Atlas is a React and Rayfin Data App that indexes Microsoft Fabric
workspace metadata. It visualizes catalog items, lineage, access, sensitivity,
jobs, configuration and team notes. It never stores workspace business data.

## Architecture

- `src/App.tsx` owns the application shell and hash-based navigation.
- `src/atlas/model.ts` defines the UI data model and preview data.
- `src/atlas/browser-collector-sync.ts` runs synchronization through typed Rayfin
  collectors and plans the exact Python compatibility calls that remain.
- `src/atlas/live-sync.ts` owns the snapshot contracts, merge logic and the
  compatibility User Data Function client.
- `src/atlas/backend.ts` persists synchronized metadata through Rayfin.
- `src/atlas/store.tsx` owns hydration, synchronization and comments.
- `src/atlas/scout*.ts` and `src/atlas/views/Scout.tsx` implement the Atlas
  Scout chat client for the published Fabric Data Agent.
- `src/atlas/openlineage.ts` and `src/atlas/external-lineage*.ts` import and
  export OpenLineage events and link external datasets to catalog items.
- `src/atlas/lineage.ts` normalizes and lays out lineage graphs.
- `src/atlas/views/` contains the application pages.
- `src/atlas/mcp/` defines the read-only Atlas MCP contract and evidence tools;
  `src/mcp/` is its local stdio entry point. Keep every tool read-only and
  scoped to selected workspaces, and keep the snapshot, source, coverage and
  limitation fields in every response.
- `rayfin/data/` contains the persisted entity model.
- `rayfin/functions/` contains the typed Rayfin metadata collectors, which are
  the primary synchronization path; its `src/types.ts` and
  `runtimemetadata.json` are generated, so never edit them by hand.
- `fabric/udf/atlas_sync_functions/` is the Python compatibility collector,
  limited to the Power BI scanner, PBIR-Legacy pages, Kusto live metadata and
  rollback.
- `fabric/data-agent/atlas-scout/` versions the Atlas Scout Data Agent
  definition.

## Rules

- Use real Fabric or Rayfin metadata; never add mock production data.
- Keep dark and light themes working through semantic tokens in `src/global.css`.
- Use the existing spacing, typography, color and radius tokens.
- Keep source comments in English.
- Preserve the first-sync gate and staged synchronization progress.
- Keep the configured synchronizer contact visible when another user is blocked
  by the first-sync gate.
- Treat synchronized catalog reads and team notes as shared with the complete
  authenticated app audience; keep personal review state user-scoped.
- Keep team notes append-only unless a reviewed update/delete policy and UX are
  introduced together.
- Keep grouped lists collapsed by default unless the user is actively searching.
- Normalize lineage from source to consumer and keep node positions stable when
  selection changes.
- Add focused tests for new state or graph logic.
- Use Node 24 (pinned in `.nvmrc`); newer versions break the jsdom tests.
- Validate with `npm run typecheck`, `npm test`, `npm run lint` and
  `npm run build`.
- Deploy with `npx rayfin up --tenant <tenant-id> --workspace-id <workspace-id>`.

## Repository layout

```text
src/
  App.tsx           application shell and hash navigation
  ErrorFallback.tsx top-level error boundary fallback
  atlas/
    views/          UI pages
    components/     shared Atlas UI components
    mcp/            read-only Atlas MCP contract and evidence tools
    backend.ts      Rayfin persistence
    browser-collector-sync.ts  in-browser metadata collection
    catalog-objects.ts         Asset Catalog object model
    catalog-search.ts          catalog search
    domain-governance.ts       Fabric domains and per-domain posture
    governance.ts   findings and governance rules
    history.ts      snapshot history and comparison
    item-metadata.ts           item metadata projection
    live-sync.ts    snapshot contracts and compatibility UDF client
    item-passport.ts item identity sheet and Ask Scout item question
    lineage.ts      lineage normalization and layout
    model.ts        shared types and preview data
    openlineage.ts  OpenLineage import and export
    radar.ts        Governance Radar scoring
    release.ts      app version and in-app release notes
    routing.ts      hash routes
    scout.ts        Atlas Scout Data Agent client
    store.tsx       application state
    sync-brief.ts   latest-sync summary and Markdown export
  components/       authentication shell components
  dev/              local development helpers
  hooks/            auth and theme hooks
  lib/              Rayfin client
  mcp/              local stdio entry point for Atlas MCP
  services/         authentication services
  test/             shared test setup
rayfin/
  data/             persisted entity model
  functions/src/    Rayfin Functions: metadata collectors, search, AI
                    suggestions, Teams notifications and sync/ orchestration
fabric/udf/atlas_sync_functions/  Python compatibility collector and its pytest suite
fabric/data-agent/atlas-scout/    Atlas Scout Data Agent definition
docs/                architecture, deployment and whitepaper documentation
  fabric-atlas-whitepaper/  whitepaper assets and LaTeX header
  screenshots/      README screenshots
  openlineage/      Fabric Atlas OpenLineage facet schema
  archive/          superseded design spikes
samples/openlineage/ sample OpenLineage import files
prez/                developer architecture deck (PPTX and PDF)
scripts/             local Fabric portal tooling
.agents/             agent skills used to work on this repository
```
