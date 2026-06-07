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
| **[API Key Management Starter](./templates/api-key-management-starter)** | Starter for issuing, listing, and revoking application API keys with Rayfin auth and data | ✅ | ✅ | React, Vite, Tailwind |
| **[Field Technician App](./templates/field-technician)** | Field service management app with role-based dashboards for dispatchers and technicians, job tracking, customer lookup, and dual-mode auth (local password + Fabric) | ✅ | ✅ | React, Vite, Tailwind |
| **[IBCS Trainer](./templates/ibcs-trainer)** | HTML5 Canvas platformer that teaches IBCS chart rules level by level, embedded in a Fabric-authenticated Rayfin app; each play-through is persisted to a typed GameStats entity | ✅ | ✅ | React, Vite, Tailwind |
| **[Slide Deck](./templates/slide-deck)** | Interactive slide deck presenter with sessions, live slide tracking, and audience chat | ✅ | ✅ | React, Vite, Tailwind |
| **[[Experimental] Todo app with full local dev](./templates/todo-local-experimental)** | End-to-end todo CRUD with username/password auth, a Rayfin data model, and Docker local development — a working starter that exercises the full data path without Fabric | ✅ | ✅ | React, Vite, Tailwind |

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
