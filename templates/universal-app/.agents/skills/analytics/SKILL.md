---
name: analytics
description: Enable on demand for Power BI, semantic model, dataset, DAX, analytics dashboard, KPI dashboard, report, measure, business intelligence, or BI requests.
---

# Analytics capability pack

Power BI / semantic-model analytics dashboard (read-only). The `kit/**` tree is
**dormant reference code** — don't import it from the base app; scaffold it in.

## Turn it on — one command

```sh
npm run pack:add -- analytics
```

That runs the scaffolder (`scripts/scaffold.mjs`) against this pack's manifest
(`pack.json`) and, in one idempotent pass:

- disables the `data` service in `rayfin/rayfin.yml` (read-only analytics; `auth`
  + `staticHosting` stay on),
- adds the pinned analytics dependencies **and** the `build:fabric` / `preview` /
  `gallery` scripts to `package.json`,
- copies the whole dashboard kit into `src/` (`components/dashboard`, `hooks`,
  `lib`, `demo`, `global.css`, `fabric.generated.ts`), `fabric.yaml` to the root,
  and the headless-preview script to `scripts/`,
- seeds a runnable `src/App.tsx` + `src/main.tsx` (bundled Graphein demo over
  inlined data — never blank), leaving them alone if you've already edited them,
- runs a single `npm install`.

Flags: `--no-install` (skip install), `--dry-run` (print the plan, write nothing),
`--force-seeds` (overwrite seed files you've customized).

> **If you wired authentication first**, the scaffolder keeps your `src/App.tsx`
> and `src/main.tsx` and tells you so. That is deliberate — it will not throw away
> your `AuthProvider` or route guard. But the kit's versions carry the theme,
> selection, and filter providers the dashboard needs, so merge them in by hand:
> take the provider tree from `.agents/skills/analytics/kit/app/App.tsx` and the
> font/`global.css` imports from `kit/app/main.tsx`, and keep your auth wiring
> wrapped around them.

You now have a **runnable starter dashboard**: `npm run gallery` to view it,
`npm run preview -- --spec <file>` for headless visual checks, `npm run rayfin:up`
to deploy.

## Then build the real thing

1. **Connect the semantic model** — edit `fabric.yaml`, then regenerate
   `src/fabric.generated.ts` (`npm run build:fabric` runs `fabric-app-data
   generate`). See `fabric-data`.
2. **Build the dashboard** — follow `build-workflow` (hero slice → preview →
   deploy once → iterate), pulling in `visuals`, `dax`, `headless-preview`, and
   `app-design` as each phase needs them. Keep imports like
   `@/components/dashboard` unchanged.

`pack.json` is the source of truth for what gets installed and copied;
`MODULES.md` documents the dependency set and why.
