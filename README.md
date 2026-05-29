<!-- markdownlint-disable MD033 MD041 -->

<div align="center">

  <h1>🐟 Awesome Rayfin</h1>
  <p>A curated gallery of templates and community resources for Project Rayfin — the Backend-as-a-Service platform built for the agentic era.</p>

  <a href="#-templates">Templates</a> •
  <a href="#-resources">Resources</a> •
  <a href="CONTRIBUTING.md">Contribute</a>
</div>

---

```bash
npm create @microsoft/rayfin -- --template https://github.com/microsoft/awesome-rayfin
```

## What is Rayfin?

Project Rayfin is a modern **Backend-as-a-Service (BaaS)** platform that helps teams build and ship applications faster. Define your data model with TypeScript decorators, and Rayfin handles the backend — auth, data API, storage, and hosting.

```bash
npm create @microsoft/rayfin@latest    # scaffold from an official template
npx rayfin up                          # deploy and run
```

## Using This Gallery

Point the Rayfin CLI at this repo to scaffold any template from the gallery:

```bash
npm create @microsoft/rayfin -- --template https://github.com/microsoft/awesome-rayfin
```

```bash
# OR from a local clone
npm create @microsoft/rayfin -- --template ./awesome-rayfin
```

The CLI reads `rayfin-template.yml` at the repo root and presents an interactive picker when multiple templates are available.

---

## 📦 Templates

| Template | Description | Auth | Data | Stack |
|----------|-------------|:----:|:----:|-------|
| **[Events App](./templates/events-app)** | Events management app with scheduling, listings, and Fabric authentication | ✅ | ✅ | React, Vite, Tailwind |
| **[Field Engineer](./templates/field-engineer)** | Field engineer task management app with Fabric authentication, data tracking, and React + Vite | ✅ | ✅ | React, Vite, Tailwind |
| **[Todo App](./templates/todo-app)** | Full-stack todo app with categories, auth, and Docker local development | ✅ | ✅ | React, Vite, Tailwind |

> **Adding a template?** See the [Contributing Guide](CONTRIBUTING.md).

---

## 📚 Resources

### Packages

| Package | Description |
|---------|-------------|
| `@microsoft/rayfin-core` | Entity decorators, schema definitions, and core types |
| `@microsoft/rayfin-client` | Typed data client for querying and mutating entities |
| `@microsoft/rayfin-cli` | CLI for scaffolding, deploying, and managing Rayfin apps |
| `@microsoft/create-rayfin` | `npm create` initializer for scaffolding new projects |

### Key Concepts

- **Data Modeling** — Define entities with `@entity()`, `@text()`, `@boolean()`, `@date()`, and other decorators from `@microsoft/rayfin-core`
- **Authentication** — Fabric Entra SSO in production, mock email/password locally
- **Typed Data Access** — Schema-driven GraphQL client with compile-time type checking
- **Static Hosting** — Deploy frontends with `rayfin up staticapp deploy`

### Agent Skills

Teach your AI coding assistant to build with Rayfin. The `rayfin` skill is a lightweight
bootstrap: it scaffolds a project with the CLI, then hands off to the version-locked skill,
MCP docs, and `rayfin docs` CLI that ship inside every scaffolded project.

```bash
# CLI tools (Copilot CLI, Codex, Cursor, Gemini, Claude Code, …) — open agent-skills ecosystem
npx skills add microsoft/awesome-rayfin
```

```bash
# Claude Code (and other plugin-aware tools)
/plugin marketplace add microsoft/awesome-rayfin
/plugin install rayfin@awesome-rayfin
```

The marketplace manifest lives at [`.claude-plugin/marketplace.json`](./.claude-plugin/marketplace.json)
and also wires up the `rayfin` [MCP server](https://github.com/modelcontextprotocol) for in-editor docs.

---

## 🌊 Community

We welcome community-contributed templates! See the [Contributing Guide](CONTRIBUTING.md) for how to submit your own template to this gallery.

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services.
Authorized use of Microsoft trademarks or logos must follow the [Microsoft Trademark and Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos is subject to those third parties' policies.

## License

[MIT](LICENSE)
