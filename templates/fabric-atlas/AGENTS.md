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
- `rayfin/data/` contains the persisted entity model.
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
- Deploy with `npx rayfin up --tenant <tenant-id> --workspace <workspace-name>`.

## Repository layout

```text
src/
  atlas/
    views/          UI pages
    backend.ts      Rayfin persistence
    live-sync.ts    Fabric UDF client
    lineage.ts      lineage normalization and layout
    model.ts        shared types and preview data
    store.tsx       application state
  components/       authentication shell components
  hooks/            auth and theme hooks
  lib/              Rayfin client
  services/         authentication services
rayfin/              Rayfin app and entity configuration
fabric/              Fabric User Data Function source
docs/                architecture and deployment documentation
scripts/             local Fabric portal tooling
```
