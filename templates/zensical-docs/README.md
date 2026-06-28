# Zensical Docs

A documentation site built with [Zensical](https://zensical.org/) and deployed to [Microsoft Fabric](https://learn.microsoft.com/en-us/fabric/apps/project-structure) as a static app via [Rayfin](https://github.com/microsoft/rayfin).

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) (for `npm` and `npx`)
- Python and [Zensical](https://zensical.org/) installed
- Access to a Microsoft Fabric workspace

### Install dependencies

```bash
npm install
```

### Run locally

```bash
npm run dev
```

Opens the Zensical dev server at `http://0.0.0.0:8000` with live reload.

### Build

```bash
npm run build
```

Generates the static site into `site/`.

### Deploy to Microsoft Fabric

1. Set `site_url` in `zensical.toml` to your Fabric App URL.
2. Set `allowedRedirectUris` in `rayfin/rayfin.yml` to the same URL.
3. Sign in:

   ```bash
   npx rayfin login
   ```

4. Deploy:

   ```bash
   npm run up
   ```

## Project structure

```
├── docs/               # Markdown source pages
│   ├── index.md        # Home page
│   ├── getting-started.md
│   └── md-demo.md      # Markdown feature showcase
├── rayfin/
│   ├── rayfin.yml      # Rayfin deployment configuration
│   └── tsconfig.json   # TypeScript config for the rayfin/ directory
├── site/               # Generated static output (build artefact, do not edit)
├── zensical.toml       # Zensical project configuration
└── package.json        # npm scripts and metadata
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the Zensical local dev server with live reload |
| `npm run build` | Generate the static site into `site/` |
| `npm run up` | Deploy to Microsoft Fabric via `rayfin up` |
