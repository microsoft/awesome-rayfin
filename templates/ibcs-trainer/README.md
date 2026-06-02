# IBCS Trainer (Rayfin)

A single-file HTML5 Canvas platformer
([`ibcs_trainer.html`](public/game/ibcs_trainer.html)) that teaches IBCS chart
rules level by level, embedded in a Fabric-authenticated Rayfin app. You play a
data analyst who conquers bad chart types: pie charts explode, the wrong chart
for a time series must be destroyed, and colorful clutter gives way to clean
black-and-grey notation. It runs in an `<iframe>` and reports each finished
play-through to the host, which persists it to a typed `GameStats` entity
through the Rayfin data client.

## Install this template

```bash
npm create @microsoft/rayfin@latest -- --template https://github.com/microsoft/awesome-rayfin --template-name "IBCS Trainer"
```

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173, sign in, and play. When a run ends (win or game
over), the game posts its stats to the React host and the header shows
"Run saved".

> This app is fully self-contained — it depends only on the published
> `@microsoft/rayfin-*` packages (v1.33.x) from the public npm registry, so it
> installs and runs on its own without the `project-rayfin` monorepo.

## How the migration works

| Original (Fabric notebook) | This app |
|---|---|
| Game played via `displayHTML()` in a notebook cell | Game served from `public/game/` and rendered in an `<iframe>` |
| Game-over JSON hand-pasted into a Save cell | `stats.publish()` posts the JSON via `window.parent.postMessage` |
| JSON appended to a `game_stats` Delta table | `GamePage` calls `client.data.GameStats.create(...)` |

The only change to the game file is in `stats.publish()`, which now also
`postMessage`s the payload to the parent window.

## Project structure

```text
├── public/game/ibcs_trainer.html     # The game (reports stats via postMessage)
├── rayfin/
│   ├── rayfin.yml                    # Fabric service config (auth + data + hosting)
│   └── data/
│       ├── GameStats.ts              # One row per play-through
│       └── schema.ts                 # Registers GameStats
├── src/
│   ├── main.tsx                      # Entry point + Rayfin client bootstrap
│   ├── App.tsx                       # Routes and auth gate
│   ├── pages/GamePage.tsx            # Embeds the game + saves stats
│   ├── hooks/AuthContext.tsx         # Auth context
│   ├── components/AuthPage.tsx       # Sign-in UI
│   └── services/                     # Auth + typed Rayfin client wiring
└── package.json
```

## The data model

`GameStats` (`rayfin/data/GameStats.ts`) mirrors the game's `stats.toJSON()`
payload (score, deaths by cause, coins, jumps, attacks, forms collected, final
form, level reached, duration). Each record is scoped to the signed-in player
via `user_id` (from the JWT `sub` claim), so a player only sees their own runs.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Deploy app to Fabric and start local dev server |
| `npm run build` | Production build |
| `npm run build:fabric` | Build for Fabric deployment |
| `npm run lint` | Lint with ESLint |
| `npm run test` | Run unit tests with Vitest |
| `npm run rayfin:up` | Deploy app to Fabric (no local dev server) |