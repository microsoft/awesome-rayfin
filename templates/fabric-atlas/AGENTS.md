# Fabric Atlas agent guide

## Purpose

Fabric Atlas is a React and Rayfin Data App that indexes Microsoft Fabric
workspace metadata. It visualizes catalog items, lineage, access, sensitivity,
jobs, configuration and team notes. It never stores workspace business data.

## Architecture

- `src/App.tsx` owns the application shell and hash-based navigation.
- `src/atlas/model.ts` defines the UI data model and preview data.
- `src/atlas/live-sync.ts` invokes the published Fabric User Data Function.
- `src/atlas/backend.ts` persists synchronized metadata through Rayfin.
- `src/atlas/store.tsx` owns hydration, synchronization and comments.
- `src/atlas/lineage.ts` normalizes and lays out lineage graphs.
- `src/atlas/views/` contains the application pages.
- `src/atlas/mcp/` defines the read-only Atlas MCP contract and evidence tools;
  `src/mcp/` is its local stdio entry point. Keep every tool read-only and
  scoped to selected workspaces, and keep the snapshot, source, coverage and
  limitation fields in every response.
- `rayfin/data/` contains the persisted entity model.
- `rayfin/functions/` contains Rayfin Functions; its `src/types.ts` and
  `runtimemetadata.json` are generated, so never edit them by hand.
- `fabric/udf/atlas_sync_functions/` contains the server-side Fabric metadata sync.

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
- Validate with `npm test`, `npm run lint` and `npm run build`.
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
    live-sync.ts    Fabric UDF client
    lineage.ts      lineage normalization and layout
    model.ts        shared types and preview data
    radar.ts        Governance Radar scoring
    release.ts      app version and in-app release notes
    routing.ts      hash routes
    store.tsx       application state
  components/       authentication shell components
  hooks/            auth and theme hooks
  lib/              Rayfin client
  mcp/              local stdio entry point for Atlas MCP
  services/         authentication services
  test/             shared test setup
rayfin/
  data/             persisted entity model
  functions/src/    Rayfin Functions: metadata collectors and sync/
fabric/udf/atlas_sync_functions/  Fabric User Data Function and its pytest suite
docs/                architecture, deployment and whitepaper documentation
  fabric-atlas-whitepaper/  whitepaper assets and LaTeX header
  screenshots/      README screenshots
  archive/          superseded design spikes
prez/                developer architecture deck (PPTX and PDF)
scripts/             local Fabric portal tooling
.agents/             agent skills used to work on this repository
```
