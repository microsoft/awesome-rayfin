---
name: rayfin
description: "Use to get started building a Rayfin app from any AI coding assistant, or when a Rayfin task comes up but you are NOT yet inside a Rayfin project. This is a bootstrap skill — it scaffolds a project, then hands off to the version-locked rayfin skill, MCP, and docs that ship inside the project. Triggers: build a Rayfin app, start a Rayfin project, create-rayfin, npm create @microsoft/rayfin, rayfin init, scaffold rayfin, new Rayfin backend, Rayfin BaaS, Fabric app backend, rayfin template, awesome-rayfin gallery, set up rayfin, rayfin getting started, rayfin, Project Rayfin"
metadata:
  author: microsoft
  version: "0.1.0"
---

# Rayfin (Getting Started)

Rayfin is a Backend-as-a-Service for the agentic era: define your data model with
TypeScript decorators and Rayfin provides auth, a typed data API, storage, and Fabric
hosting.

This skill is a **bootstrap**. Its only job is to get you into a real Rayfin project and
then get out of the way. The authoritative, version-locked Rayfin skill ships **inside
every scaffolded project** at `.agents/skills/rayfin/SKILL.md`, alongside the `rayfin` MCP
server and the `rayfin docs` CLI. Those match the exact CLI/SDK versions installed in the
project — this skill does not, so it deliberately stays thin.

## Step 0 — Is this just a docs or syntax question?

If the user only wants Rayfin information (decorator syntax, an API signature, a concept) and
is **not** asking you to build, scaffold, or change an app, you do not need to scaffold a
project. Answer from the docs:

- **Preferred — the `rayfin` MCP server** (if connected): `search_docs(query: '<topic>', module: 'guide')`
  (or `module: 'ts-sdk'`) and `get_doc(symbol: '<decorator or class>')`. It queries the live docs
  service, so it works without a project.
- **`rayfin docs` CLI**: resolves against the Rayfin packages installed in the current project,
  so run it from inside a Rayfin project root:
  `npx -y @microsoft/rayfin-cli docs search '<topic>' --module guide`. Use
  `rayfin docs discover '<topic>'` to locate the right package when the installed corpus does
  not cover it.

Only continue to Step 1 when the user actually wants to build or modify a Rayfin app. If
neither the MCP nor a project is available, scaffold a minimal project first (Step 2) and
query its docs from there rather than answering decorator/API specifics from memory.

## Step 1 — Are you already in a Rayfin project?

A directory is a Rayfin project if it contains a `rayfin/` folder with `rayfin.yml`, or a
`package.json` that depends on `@microsoft/rayfin-*`.

- **Yes → stop using this skill.** Defer to the project's own `.agents/skills/rayfin/SKILL.md`
  (load it if your agent has not), the `rayfin` MCP server, and `rayfin docs`. They are
  version-matched to the installed packages; this skill is not. Do not write entity, schema, or
  client code from memory — load that skill and the docs first.
- **No → scaffold one first (Step 2).** Do not hand-write `rayfin.yml`, entity decorators,
  or client setup from memory — the scaffolder generates correct boilerplate (tsconfig with
  `ESNext.Decorators`, schema, auth wiring) that is easy to get subtly wrong by hand.

## Step 2 — Scaffold a project

Prefer the official initializer. Pick the option that fits the request:

```bash
# Interactive create from an official template
npm create @microsoft/rayfin@latest <app-name>

# Pick a template from the Awesome Rayfin gallery (events-app, field-engineer, todo, …)
npm create @microsoft/rayfin -- --template https://github.com/microsoft/awesome-rayfin

# Add Rayfin into an existing/empty directory
npx rayfin init [directory]
```

If the user described a domain (events, field service, todo, CRUD app), scaffold from the
closest gallery template rather than an empty project — it ships a working data model, auth,
and UI to build on. List what the gallery offers before choosing:

```bash
npm create @microsoft/rayfin@latest -- --list-templates
```

## Step 3 — Hand off to the in-project tooling

After scaffolding, `cd` into the project. From here, **the project owns the workflow**:

- **Skill** — load `.agents/skills/rayfin/SKILL.md` for the full, version-correct rules on
  data modeling, decorators, permissions, querying, storage, and deployment.
- **Docs** — use the `rayfin` MCP server when connected:
  - `search_docs(query: '<topic>', module: 'guide')` — builder guides
  - `search_docs(query: '<topic>', module: 'ts-sdk')` — TypeScript SDK reference
  - `get_doc(symbol: '<decorator or class>')` — resolve a symbol
  - `discover_packages(query: '<topic>')` — find a Rayfin package the installed docs don't cover
  - Fallback when MCP is unavailable: `npx -y @microsoft/rayfin-cli docs search '<topic>' --module guide`
    (run from the project root so the project's installed docs win).
- **Deploy** — `rayfin login` → `rayfin up` → `rayfin up status`. `rayfin up` builds the app,
  deploys it, and applies pending schema migrations in one step.

## Minimal guardrails before the project skill loads

Just enough to avoid early mistakes — the in-project skill and docs are the source of truth:

- Rayfin uses TC39 Stage 3 decorators. Never enable `experimentalDecorators` or
  `emitDecoratorMetadata`; the scaffolder configures this correctly.
- Every entity needs an explicit permission decorator (`@role`, `@anonymous`,
  `@authenticated`) — entities without one are inaccessible.
- On MSSQL, always give `@text()` a `max` (e.g. `@text({ max: 200 })`); `NVARCHAR(MAX)`
  breaks GraphQL schema generation.
- Use the typed client (`client.data.<Entity>`) for data access — never raw `fetch()` or
  hand-built GraphQL.
- Before designing entities, check known limitations via the docs
  (`search_docs(query: 'known limitations', module: 'guide')`).

## Installing this skill

This skill is published from the Awesome Rayfin gallery and works in any agent that supports
the open agent-skills ecosystem:

```bash
# CLI tools (Copilot CLI, Codex, Cursor, Gemini, Claude Code, …)
npx skills add microsoft/awesome-rayfin

# Claude Code (and other plugin-aware tools)
/plugin marketplace add microsoft/awesome-rayfin
/plugin install rayfin@awesome-rayfin
```
