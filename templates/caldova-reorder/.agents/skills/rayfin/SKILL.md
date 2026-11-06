---
name: rayfin
description: "Use when doing ANY task involving Rayfin — scaffolding, data models, decorators, auth, deployment, CLI commands, or client setup. Triggers: rayfin, rayfin init, rayfin up, rayfin login, RayfinClient, @entity, @role, @anonymous, @authenticated, @text, @uuid, @int, @decimal, @boolean, @date, @email, @set, @one, @many, DAB, Data API Builder, rayfin.yml, publishableKey, signUp, signIn, signOut, sendMagicLink, handleMagicLinkCallback, ensureSignedInWithFabric, Fabric SSO, Entra ID, rayfin up db apply, rayfin up staticapp deploy, schema.ts, OpaqueSession, onSessionChange, GraphQL select, GraphQL create, GraphQL update, GraphQL delete, findById, executePaginated, RLS policy, row-level security, claims.sub, claims.email, TC39 decorators, config generation, dialect, mssql, postgresql"
metadata:
  author: microsoft
  version: 0.3.0
rayfin-managed: true
---
# Rayfin

## Rayfin Docs

Rayfin's documentation is available via MCP tools and the `rayfin docs` CLI.
Use these for code examples, API details, and troubleshooting — not this skill.
Docs are version-locked to the Rayfin packages installed in the user's project.
Run MCP and CLI lookups from the project root so local `node_modules` wins whether the CLI/MCP package is installed locally, globally, or through `npx`.

**MCP tools** (if the `rayfin` MCP server is connected):

- `search_docs(query: '<topic>', module: 'guide')` — builder guides and tutorials
- `search_docs(query: '<topic>', module: 'ts-sdk')` — TypeScript SDK API reference
- `get_doc(symbol: '<decorator or class>')` — resolve a symbol to its docs
- `discover_packages(query: '<topic>')` — find missing or too-old Rayfin packages when installed docs do not cover the task

**CLI fallback** (when MCP is unavailable):

- `rayfin docs search '<topic>' --module guide` — builder guides and tutorials
- `rayfin docs search '<topic>' --module ts-sdk` — TypeScript SDK API reference
- `rayfin docs get --symbol '<decorator or class>'` — resolve a symbol to its docs
- `rayfin docs discover '<topic>'` — find a Rayfin package when installed docs do not cover the task

If `rayfin` is not on `PATH`, use `npx -y @microsoft/rayfin-cli docs ...` from the project root.

Key doc topics:

- Known limitations — FK naming, constraint limits, relationship rules
- Data permissions — `@role` decorator, policy DSL, field visibility
- GraphQL data access — RayfinClient setup, query chain, mutations
- Auth overview — auth methods, session handling
- Fabric deployment — workspace and static app deployment workflow

**Before creating entities or writing queries**, check known limitations:

```text
search_docs(query: 'known limitations', module: 'guide')
# or: npx -y @microsoft/rayfin-cli docs search 'known limitations' --module guide
```

## Rules

### Platform

- Rayfin uses TC39 Stage 3 decorators — never enable `experimentalDecorators` or `emitDecoratorMetadata`.
- Include `ESNext.Decorators` in the tsconfig `lib` array.
- Two deployment targets: Rayfin Local (Docker, MSSQL or PostgreSQL) and Fabric Apps (managed, MSSQL only).
- Prefer `npm create @microsoft/rayfin@latest` for new projects — it generates correct tsconfig and schema boilerplate.

### Security

- Every entity must have an explicit permission decorator (`@role`, `@anonymous`, `@authenticated`) — entities without one are inaccessible.
- Add `policy: (claims, item) => claims.sub.eq(item.user_id)` for row-level filtering on user-scoped data.
- Use `exclude` in role options to hide sensitive fields (e.g., `exclude: ['secret']`).
- Publishable keys (`pk-*`) are safe for client-side code — never expose service secrets or connection strings.
- Keep `allowedRedirectUris` in `rayfin.yml` tightly scoped to your app's origin.
- Email/password auth is local development only — deployed Fabric apps support Fabric SSO (Entra ID) exclusively.
- Fabric SSO only works inside the Fabric Portal — do not attempt it in local development.

### Data Modeling

- Define entities with `@entity()` in `rayfin/data/` and register them in `rayfin/data/schema.ts` as `type AppSchema = { Name: Name }`.
- Every field needs exactly one decorator: `@uuid`, `@text`, `@int`, `@decimal`, `@boolean`, `@date`, `@email`, `@set`.
- Fields are required by default — use `{ optional: true }` and `?` together for nullable fields.
- `@text()` length option is `max` (not `maxLength`) — e.g., `@text({ max: 200 })`.
- Use `@one(() => Target)` with lazy arrow functions for relationships — Rayfin auto-generates FK columns named `{property}_id`.
- Use `import` (not `import type`) for entity classes referenced in `@one()`/`@many()` arrow functions — decorators need the runtime class value.
- FK columns referencing another entity (`{property}_id`) must use `@uuid()` to match the PK type. Auth-based fields like `user_id` from `claims.sub` use `@text()`.
- Many-to-many requires an explicit join entity with two `@one()` fields.
- Use `@many(() => Target)` for the inverse side of relationships.

### Querying

- Query chain: `.select()` → `.where()` → `.orderBy()` → `.execute()`.
- Single record by ID: `client.data.Entity.findById('uuid-here')` — not `findByPk`.
- Filter by FK columns using `{property}_id` (e.g., `customer_id`), not dot-path (e.g., `customer.id`).
- Dot-paths are for `.select()` only (e.g., `customer.companyName`).
- Use `.first(n).executePaginated()` for cursor-based pagination.
- Sort directions must be lowercase: `'asc'` or `'desc'`.

### Schema

- **For Fabric:** `rayfin up` is the canonical command for "deploy this change," "apply this schema change," or "push my entity update" — it deploys the app and applies pending schema migrations in a single step. Recommend it on every deploy, including incremental schema changes after the initial deploy.
- `rayfin up db apply` is a narrow advanced subcommand that applies schema-only without touching the static build — only recommend it when the user explicitly asks to skip the static deploy step.
- `--force` permits destructive changes (drop table, drop column, alter type) — never use without review.
- `--gen-config-only` generates the underlying API config without applying — use to inspect before applying.

### Deployment

- When the user asks to "build and deploy," "make it live," or "deploy this change" (including schema-only changes like adding a column), execute the full workflow — do not present steps as instructions for the user to run manually.
- Workflow: `rayfin login` → `rayfin up` → `rayfin up status`. `rayfin up` builds the static app, deploys it, and applies any pending schema migrations.
- `rayfin up status` checks endpoint health — run after deployment to verify.
- Deployment metadata is written to `rayfin/.deployments.json` (per-workspace record: `fabricItemId`, `hostingUrl`, `publishableKey`, etc.). The deploy also appends the live hosting URL to `allowedRedirectUris` in `rayfin.yml`.

## Anti-Patterns

- Never use raw `fetch()` or hand-built GraphQL for data operations — always use `client.data.<Entity>` (provides type-safe queries and automatic auth).
- Never omit permission decorators on entities — always add an explicit `@permissions(...)`. Forgetting silently applies `authenticated: *` (full CRUD for any signed-in user), which is usually too permissive for production data.
- Never use `@text()` without `max` on MSSQL — always set `@text({ max: N })` (e.g. `max: 200` for typical strings). `NVARCHAR(MAX)` breaks GraphQL schema generation and cannot be uniquely indexed.
- Never use `@text()` for FK columns that reference another entity's `@uuid()` PK — use `@uuid()` to match types. (`user_id` from `claims.sub` is `@text()`, not a FK.)
- Never skip `search_docs('known limitations')` before implementing entities — always run it first to surface platform constraints (text length caps, supported scalar types, MSSQL-specific gotchas) that affect entity design.

## CLI Quick Reference

```bash
# Scaffold
npm create @microsoft/rayfin@latest <name>   # Create from template
npx rayfin init [directory]                   # Interactive setup

# Deploy to Fabric (default workflow)
npx rayfin login                              # Sign in with Entra ID
npx rayfin up                                 # Deploy app + apply schema (canonical)
npx rayfin up status                          # Check deployment health
npx rayfin up db apply                        # Schema-only, skip static deploy (advanced)
npx rayfin up staticapp deploy                # Redeploy static content
```
