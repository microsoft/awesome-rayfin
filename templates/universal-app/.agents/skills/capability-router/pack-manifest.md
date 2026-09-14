# Pack manifests — how a capability turns itself on

This universal app grows by **capability packs**. A pack is a skill under
`.agents/skills/<pack>/` that can ship a **`pack.json` manifest** describing,
declaratively, everything needed to turn it on. One command applies it:

```sh
npm run pack:add -- <pack>        # e.g. analytics
```

`scripts/scaffold.mjs` reads `.agents/skills/<pack>/pack.json` and, in one
**idempotent** pass: patches Fabric service flags, merges dependencies + scripts
into `package.json`, copies the pack's kit files into the project, then runs
`npm install`. This replaces "copy dozens of files by hand + install
dozens of packages + rewire scripts" — the slow part of a build.

> **This is the general mechanism, not an analytics feature.** New connectors and
> capabilities should ship a `pack.json` so they enable the same fast way.
> `analytics` is just the first pack to adopt it.

## `pack.json` schema

```jsonc
{
  "name": "analytics",
  "description": "One-line summary shown while scaffolding.",

  // 1) Fabric service flags — edits rayfin/rayfin.yml. Only set what changes;
  //    auth + staticHosting are on by default, data is on by default.
  "rayfin": { "services": { "data": { "enabled": false } } },

  // 2) npm packages to ADD. Pin analytics-/pack-specific packages only; the base
  //    template owns the shared toolchain (react, vite, typescript, eslint,
  //    tailwind, graphein, rayfin-*). Don't re-pin those here — it causes churn.
  "dependencies":    { "framer-motion": "^12.40.0" },
  "devDependencies": { "@graphein/node": ">=0.16.0" },

  // 3) package.json scripts to set (overwrites those keys).
  "scripts": { "gallery": "vite" },

  // 4) Files to copy. `from` is relative to the pack dir, `to` to the repo root.
  //    A directory `from` merges recursively (pack-owned files overwrite on
  //    re-run; sibling files are untouched). A file `from` copies to `to`.
  "copy": [
    { "from": "kit/lib", "to": "src/lib" },
    { "from": "kit/global.css", "to": "src/global.css" },

    // Seed files replace the BASE starter, then never clobber your edits. The
    // pack records the sha256 of each base starter it is allowed to replace, so
    // "is this still the untouched base file?" is answered by content, not by
    // guesswork: written only if the destination is missing or its digest is
    // listed here. List more than one to cover several base revisions.
    // `npm test` fails with the expected digest whenever a base starter changes.
    {
      "from": "kit/app/App.tsx",
      "to": "src/App.tsx",
      "seedReplaceIfPristine": ["9b24f4eb…"]
    }
  ],

  // 5) Skills to read next, printed after scaffolding (build in this order).
  "next": ["build-workflow", "visuals", "dax"]
}
```

> **Never key a seed on a substring.** The earlier `seedReplaceIfContains` did,
> and it silently destroyed real work: its markers (`HomePage`, `./main.css`)
> survive exactly the edits worth protecting, so an `App.tsx` that had been given
> an auth route guard still "contained `HomePage`" and was overwritten without a
> word. The key is no longer honored — a manifest still using it keeps the user's
> file and prints a migration notice.

## Guarantees

- **Idempotent.** Re-running `pack:add` sets the same flags, adds no duplicate
  deps, and re-copies pack-owned kit files. A seed whose destination already
  matches the pack's own copy is a silent no-op.
- **Non-destructive.** A seed is replaced only when the destination is provably
  the untouched base starter. Anything else is yours: the scaffolder keeps it and
  prints the kit path to merge from. `--force-seeds` overrides this.
- **Lean base.** A pack adds only what it needs. The base stays universal; the
  shared toolchain and lockfile live in the base, so pack installs are small and
  deterministic.

## Flags

- `--no-install` — apply everything except `npm install` (install yourself later).
- `--dry-run` — print the planned actions and write nothing.
- `--force-seeds` — overwrite seed files even if you've customized them.

## Adding a pack manifest

1. Put the pack's copy-in files under `.agents/skills/<pack>/kit/**`.
2. Write `.agents/skills/<pack>/pack.json` per the schema above.
3. For any seed file, record the base starter's digest in `seedReplaceIfPristine`.
   Run `npm test` — it asserts the recorded digests still match the base starters
   and prints the expected value when they don't.
4. Test with `npm run pack:add -- <pack> --dry-run`, then for real on a scratch
   copy. Verify twice: once over the untouched base (the seed lands) and once
   over a customized file (the seed is kept back). Keep it idempotent.
