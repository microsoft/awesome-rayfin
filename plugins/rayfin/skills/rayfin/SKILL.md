---
name: rayfin
description: "Use when a Rayfin task comes up. Routes you to the authoritative, version-locked rayfin skill, MCP, and docs that live inside a Rayfin project — scaffolding a new project with the Rayfin CLI first if you aren't in one yet. Triggers: build a Rayfin app, start a Rayfin project, add to a Rayfin app, create-rayfin, npm create @microsoft/rayfin, rayfin init, scaffold rayfin, Rayfin BaaS, Fabric app backend, rayfin template, awesome-rayfin gallery, rayfin, Project Rayfin"
metadata:
  author: microsoft
  version: "0.1.0"
---

# Rayfin (Getting Started)

Rayfin is a Backend-as-a-Service: define your data model with TypeScript decorators and
Rayfin provides auth, a typed data API, storage, and Fabric hosting.

This skill only routes you to the real guidance. The authoritative, version-locked Rayfin
skill ships **inside every project** at `.agents/skills/rayfin/SKILL.md`, alongside the
`rayfin` MCP server and the `rayfin docs` CLI — all matched to the installed CLI/SDK versions.
Your job: get into a project, then load and follow that skill. Don't write Rayfin code from
memory.

## Already in a Rayfin project?

A directory is a Rayfin project if it has a `rayfin/` folder with `rayfin.yml`, or a
`package.json` depending on `@microsoft/rayfin-*`.

- **Yes →** load `.agents/skills/rayfin/SKILL.md` and use the `rayfin` MCP / `rayfin docs`.
  That skill owns the workflow from here. Stop using this one.
- **No →** scaffold a project first (below), then `cd` in and do the above.

## Scaffold a new project

```bash
# List the Awesome Rayfin gallery templates, then create from the closest fit
npm create @microsoft/rayfin@latest -- --list-templates
npm create @microsoft/rayfin@latest <app-name> --template-name "<Template Display Name>"

# Or add Rayfin into an existing/empty directory
npx rayfin init [directory]
```

Prefer a gallery template that matches the user's domain (events, field service, todo, CRUD)
over an empty project — it ships a working data model, auth, and UI. After scaffolding, `cd`
into the project and load its `.agents/skills/rayfin/SKILL.md`.

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
