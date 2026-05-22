<!-- markdownlint-disable MD033 MD041 -->

<div align="center">

  <h1>🐟 Awesome Rayfin</h1>
  <p>A curated gallery of templates, samples, and community resources for <a href="https://github.com/microsoft/project-rayfin">Project Rayfin</a> — the Backend-as-a-Service platform built for the agentic era.</p>

  <a href="#-official-templates">Templates</a> •
  <a href="#-samples">Samples</a> •
  <a href="#-resources">Resources</a> •
  <a href="CONTRIBUTING.md">Contribute</a>
</div>

---

## What is Rayfin?

[Project Rayfin](https://github.com/microsoft/project-rayfin) is a modern **Backend-as-a-Service (BaaS)** platform that helps teams build and ship applications faster. Define your data model with TypeScript decorators, and Rayfin handles the backend — auth, data API, storage, and hosting.

```bash
npm create @microsoft/rayfin@latest    # scaffold a new project from a template
npx rayfin up                          # deploy and run
```

## Contents

- [Official Templates](#-official-templates)
- [Samples](#-samples)
- [Resources](#-resources)
- [Community](#-community)

---

## 📦 Official Templates

These templates can be scaffolded directly with the Rayfin CLI:

```bash
npm create @microsoft/rayfin@latest          # interactive template picker
npm create @microsoft/rayfin@latest --template <name>  # scaffold a specific template
```

| Template | Description | Auth | Data | Stack |
|----------|-------------|:----:|:----:|-------|
| **[Blank App](https://github.com/microsoft/project-rayfin/tree/main/samples/blank-app)** | Bare-bones Fabric-authenticated React + Vite app. Sign-in, routing, and a placeholder home page — no data layer to delete before you start. | ✅ | — | React, Vite |
| **[Data App](https://github.com/microsoft/project-rayfin/tree/main/samples/data-app)** | React + Vite starter wired for Rayfin data. Add an entity in `rayfin/data/` and the SDK generates a typed GraphQL client. | ✅ | ✅ | React, Vite |
| **[Todo App](https://github.com/microsoft/project-rayfin/tree/main/samples/todo-app-template)** | End-to-end Fabric-authenticated todo CRUD with a Rayfin data model and per-user row-level security. | ✅ | ✅ | React, Vite |
| **[Getting Started with Auth](https://github.com/microsoft/project-rayfin/tree/main/samples/getting-started-auth)** | Todo app with Fabric Entra authentication, Tailwind CSS, and shadcn/Radix UI components. Demonstrates a production-first workflow. | ✅ | ✅ | React, Vite, Tailwind, Radix UI |

> **Tip:** Run `npm create @microsoft/rayfin@latest --list-templates` to see all available templates from your installed CLI version.

---

## 🧪 Samples

Full application samples maintained in the [project-rayfin](https://github.com/microsoft/project-rayfin) monorepo. These are contributor-oriented examples that run inside the Rush workspace.

| Sample | Description | Features |
|--------|-------------|----------|
| **[Todo App (Full)](https://github.com/microsoft/project-rayfin/tree/main/samples/todo-app)** | Full-featured todo app demonstrating clean service architecture, React hooks, and Rayfin auth/data/storage integration. Includes categories, profile images, and mock mode. | Auth, Data, Storage, Mock services |
| **[Notes App](https://github.com/microsoft/project-rayfin/tree/main/samples/notes-app)** | Note-taking app with Markdown support, notebooks, search, pinning, and color-coded organization. Shows Rayfin decorator patterns with related entities. | Auth, Data, Rich editor |
| **[E-Shop](https://github.com/microsoft/project-rayfin/tree/main/samples/eshop)** | Full e-commerce reference app with complex data models and service patterns. | Auth, Data, Routing |
| **[Events App](https://github.com/microsoft/project-rayfin/tree/main/samples/events-app)** | Events management sample focused on scheduling and event listings. | Auth, Data |
| **[Welcome App (React + Auth)](https://github.com/microsoft/project-rayfin/tree/main/samples/welcome-app-react-auth)** | Timestamp tracker with dual auth (local + Fabric Entra), user-owned data via DAB policies, and 45+ Radix UI components. | Auth, Data, Radix UI |
| **[Welcome App (React)](https://github.com/microsoft/project-rayfin/tree/main/samples/welcome-app-react-no-auth)** | Minimal React welcome app — the simplest possible Rayfin starting point. | — |
| **[Welcome App (TypeScript)](https://github.com/microsoft/project-rayfin/tree/main/samples/welcome-app-typescript)** | Plain TypeScript app with a timestamp tracker. Great for learning the data API without a framework. | Data |

---

## 📚 Resources

### Official Documentation

- **[Builder Guide](https://github.com/microsoft/project-rayfin/tree/main/packages/guide)** — Getting started, CLI reference, data modeling, auth, hosting, and more
- **[CLI Reference](https://github.com/microsoft/project-rayfin/tree/main/packages/tools/cli)** — `rayfin init`, `rayfin up`, `rayfin deploy`, database migrations
- **[TypeScript SDK](https://github.com/microsoft/project-rayfin/tree/main/packages/typescript-sdk)** — Typed data client, decorators, and entity definitions

### Key Concepts

- **Data Modeling** — Define entities with `@entity()`, `@text()`, `@boolean()`, `@date()`, and other decorators from `@microsoft/rayfin-core`
- **Authentication** — Fabric Entra SSO in production, mock email/password locally
- **Typed Data Access** — Schema-driven GraphQL client with compile-time type checking
- **Static Hosting** — Deploy frontends with `rayfin up staticapp deploy`

### Packages

| Package | Description |
|---------|-------------|
| [`@microsoft/rayfin-core`](https://github.com/microsoft/project-rayfin/tree/main/packages/typescript-sdk) | Entity decorators, schema definitions, and core types |
| [`@microsoft/rayfin-client`](https://github.com/microsoft/project-rayfin/tree/main/packages/typescript-sdk) | Typed data client for querying and mutating entities |
| [`@microsoft/rayfin-cli`](https://github.com/microsoft/project-rayfin/tree/main/packages/tools/cli) | CLI for scaffolding, deploying, and managing Rayfin apps |
| [`@microsoft/create-rayfin`](https://github.com/microsoft/project-rayfin/tree/main/packages/tools/create-rayfin) | `npm create` initializer for scaffolding new projects |

### Tools

- **[VS Code Extension](https://github.com/microsoft/project-rayfin/tree/main/packages/tools/vscode)** — Rayfin commands and IntelliSense inside VS Code
- **[MCP Server](https://github.com/microsoft/project-rayfin/tree/main/packages/tools/mcp)** — Model Context Protocol tooling for AI-assisted development

---

## 🌊 Community

### Contributing Templates

We welcome community-contributed templates! See the [Contributing Guide](CONTRIBUTING.md) for how to submit your own template to this gallery.

### Get Help

- [Open an issue](https://github.com/microsoft/project-rayfin/issues/new/choose) on the main Rayfin repo
- Review the [Builder Guide](https://github.com/microsoft/project-rayfin/tree/main/packages/guide) for documentation

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services.
Authorized use of Microsoft trademarks or logos must follow the [Microsoft Trademark and Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos is subject to those third parties' policies.

## License

[MIT](LICENSE)
