# Helsinki Public Transport

Live map of a city's public transport, built as a **Microsoft Fabric App** (Rayfin) on top of a
**Real-Time Intelligence** stack in Microsoft Fabric.

> **Author: Kevin Thomas** - the original Helsinki real-time transit solution, its Real-Time
> Intelligence architecture, the Fabric portal host-bridge data path and the app's feature set
> are his.
>
> Packaged as a template by **Alexander Korn**, who added a token-free photoreal 3D city twin and
> some minor changes.

Vehicle positions come from the public [HSL GTFS-RT feeds](https://hsldevcom.github.io/gtfs_rt/)
(Helsingin seudun liikenne, the Helsinki region transport authority). No API key is required.

## Screenshots

Live in the Fabric portal - 1,181 vehicles, no second sign-in, DAX served over the host bridge:

![The app running inside the Fabric portal](docs/screenshots/01-portal-live.webp)

`CityGML` surface with the tree models on - semantic LoD2 buildings plus the city's tree catalogue:

![CityGML buildings with the tree models](docs/screenshots/02-citygml-trees.webp)

Low pass over the Esplanadi on the 2017 reality mesh - note that the canopy is already baked into
the photogrammetry, which is why the Trees toggle is disabled in mesh mode:

![Street-level detail on the photogrammetric mesh](docs/screenshots/03-mesh-street-level.webp)

## Architecture

```mermaid
flowchart LR
  HSL["GTFS-RT feeds<br/>vehicle-positions - trip-updates"]
  NB["Notebook<br/>producer"]
  ES["Eventstream<br/>(custom endpoint)"]
  EH["Eventhouse<br/>raw_events -> update policies -><br/>vehicle_positions / trip_updates / alerts<br/>+ MV last_vehicle_position"]
  SM["Semantic model<br/>DirectQuery over Kusto"]
  APP["Fabric App<br/>helsinki-public-transport<br/>React + Leaflet + CesiumJS"]

  HSL -->|"poll 1.2 s / 11 s"| NB --> ES --> EH --> SM -->|"DAX"| APP
```

The app never talks to Kusto directly - it only ever issues DAX against the semantic model, and the
semantic model's Kusto datasource is configured for end-user SSO, so every user reads the
Eventhouse under their own identity.

### How the browser reaches the semantic model

`src/services/daxGateway.ts` picks a transport at runtime and falls through in this order:

| # | Transport | When it applies |
| --- | --- | --- |
| 1 | **Fabric host bridge** (`src/services/fabricHostBridge.ts`) | The app is embedded in the Fabric portal. The portal exposes a `postMessage` channel (`fabric-app-data-semantic-model`, method `semanticModel.executeDaxJson`) and runs the DAX server-side as the signed-in portal user. **No second sign-in, no token in the browser.** |
| 2 | **Rayfin connector** (`fabric-semanticmodel`) | Server-side execution through the Rayfin backend, using the ids in `rayfin/rayfin.yml`. Experimental SDK surface. |
| 3 | **Power BI REST** (`src/services/powerBiDirect.ts`) | The app is opened standalone, outside the portal. MSAL acquires a Power BI token - silent SSO first, interactive only if that fails - and calls `executeQueries`. |

The host bridge is tried first on purpose: inside the portal it is both the fastest path and the
only one that does not ask the user to sign in a second time.

## The 3D photorealistic view

The `3D photoreal` mode renders vehicles on the City of Helsinki's own photogrammetric city model -
**with no Cesium ion token and no Google Maps API key**. Every layer is CC BY 4.0 open data streamed
straight from `kartta.hel.fi`, which sends CORS headers, so nothing has to be re-hosted or baked:

| Layer | Source |
| --- | --- |
| Reality mesh (2017) | 3D Tiles, 42k aerial photos, ~7.5 cm/px |
| Textured semantic LoD2 buildings | CityGML converted to 3D Tiles |
| Park and street trees | 3D Tiles |
| Terrain | quantized-mesh (2021) |
| Base imagery | `Ortoilmakuva_2025_5cm` orthophoto WMS, 5 cm/px |

The **Trees** toggle only applies to the `CityGML` surface. The photogrammetric mesh is built from
aerial photos and already contains the canopy, so the separate tree models sit inside it and are
invisible - the checkbox is therefore disabled while a mesh vintage is selected.

### Why only two surfaces

The city publishes three mesh vintages. Offered as a control they were archaeology rather than a
feature, and one of them was expensive. Measured from an identical view on a cold cache:

| Surface | Settles in | GPU memory | Frame rate while loading |
| --- | --- | --- | --- |
| Mesh 2017 | 7.9 s | 52 MB | 47.6 |
| Mesh 2024 | 10.6 s | **406 MB** | 35.9 |
| Mesh 2015 | 2.0 s | 53 MB | 48.8 |
| CityGML | 2.5 s | 57 MB | 47.3 |

2024 costs eight times the GPU memory and a quarter of the frame rate for detail that is invisible
at the altitudes this app is flown at; 2015 is the blurrier survey 2017 replaced. Both URLs are
still in `src/cesium/helsinkiOpenData.ts`, one line from being offered again.

What is left is the choice that means something - photogrammetry, or the lightweight semantic
buildings, which settle roughly five times quicker and double as the fast option on a slow link.

Tuning the tileset was **not** the lever: with a cold cache and the same view, `maximumScreenSpaceError`
16 / 24 / 32 settled in 13.7 s / 12.1 s / 12.9 s, and `skipLevelOfDetail` made it worse. The time
goes on fetching tiles from `kartta.hel.fi`. Nor are the vehicles a cost - 1,420 ground-clamped
points render at the same 60 fps as 120.

Cesium's default credit is the Cesium *ion* logo, which would be misleading here - `Ion.defaultAccessToken`
is blanked, the credit container is hidden, and attribution is rendered in the app chrome instead.

Attribution: *Source: 3D models of Helsinki, Helsingin kaupunginkanslia, CC BY 4.0.*

A Cesium ion / Google Photorealistic 3D Tiles variant is deliberately **not** wired up yet - it is a
later phase, and it swaps a free licence-clean source for a metered one.

## Layout

| Path | What |
| --- | --- |
| `src/data/queries.ts` | the three DAX queries the app issues |
| `src/data/model.ts` | row decoding (`[alias]` vs `'Table'[alias]` keys) and domain types |
| `src/hooks/useDaxQuery.ts` | generic polling DAX hook (reschedules *after* each response) |
| `src/hooks/useFleet.ts` | vehicles, fleet stats, counters, selected-vehicle track |
| `src/services/daxGateway.ts` | transport selection - host bridge, connector, Power BI REST |
| `src/services/fabricHostBridge.ts` | `postMessage` DAX bridge used when embedded in the portal |
| `src/services/powerBiDirect.ts` | MSAL + `executeQueries` fallback for standalone use |
| `src/components/MapView.tsx` | Leaflet map; markers are moved, not rebuilt, each poll |
| `src/components/CesiumView.tsx` | token-free 3D scene over the Helsinki open geodata |
| `src/cesium/helsinkiOpenData.ts` | every Helsinki endpoint, in one place |
| `src/dev/CesiumPreview.tsx` | dev-only 3D harness (see below) |
| `scripts/copy-cesium.mjs` | copies Cesium's runtime assets into `public/cesium/` |
| `rayfin/rayfin.yml` | services + the `hslModel` connector declaration |
| `rayfin/connectors/schema.ts` | typed connector schema for the SDK |
| `fabric/` | definitions of the Fabric items backing the app |
| `fabric/deploy/` | scripted, idempotent provisioning of those items (see [Deploy](#deploy)) |
| `tools/verify_publishable.py` | audits the tree for tenant-specific values before you share it |

## Develop

```bash
npm install
npm run dev      # rayfin up (backend only) + vite
```

The 3D scene can be checked without going through Fabric sign-in:

```bash
npm run cesium:assets
node node_modules/vite/bin/vite.js . --port 5199
# then open http://localhost:5199/?preview=cesium
```

That harness renders `CesiumView` with synthetic vehicles. It is guarded by `import.meta.env.DEV`,
so it is compiled out of production builds.

## Deploy

The app is one of two halves. The **back end** (Eventhouse, Eventstream, producer notebook,
semantic model) has to exist first; the **front end** is then a single `rayfin up`.

### Back end

`fabric/deploy/` provisions everything from the definitions in `fabric/`. The scripts need nothing
but Python 3.10+ and the Azure CLI - no SDK, no secrets. Each one is idempotent: it looks for an
existing item by display name and updates rather than duplicating, so a failed run can simply be
repeated. Ids are recorded in `fabric/deploy/.state.json` and picked up by the following steps.

```powershell
az login --tenant <tenant-id>

$env:FABRIC_TENANT_ID    = "<tenant-id>"
$env:FABRIC_WORKSPACE_ID = "<workspace-id>"
$env:FABRIC_FOLDER_ID    = "<folder-id>"   # optional

cd fabric/deploy
python 01_eventhouse.py        # Eventhouse + KQL database, records the cluster URI
python 02_kql_schema.py        # tables, parse functions, update policies, the MV
python 03_eventstream.py       # custom endpoint -> Eventhouse, fresh node GUIDs
python 04_notebook.py          # producer notebook, eventstream ids patched in
python 05_semantic_model.py    # TMDL repointed at the new cluster and database
python 06_bind_credentials.py  # <- the step everything else depends on
python 07_schedule.py          # hourly trigger for the notebook
python 09_verify.py            # end-to-end check
```

Step 6 is the one that is easy to miss. Without it `executeQueries` returns HTTP 400
`DatasetExecuteQueriesError` and the app shows zeros with no useful message. It takes ownership of
the dataset, seeds the gateway datasource with a real Kusto token, then switches it to end-user
SSO so nothing stored can expire.

Step 8 is optional and only matters for the standalone sign-in path:

```powershell
$env:PBI_CLIENT_ID = "<spa-app-registration-id>"
$env:APP_ORIGINS   = "https://<app>.webapp.fabricapps.net,http://localhost:5173"
python 08_entra_redirects.py
```

Inside the Fabric portal the host bridge is used and no token is acquired in the browser at all,
so that step can be skipped entirely.

`09_verify.py` checks the eventstream topology, Kusto freshness and the app's own DAX, in that
order. If it reports a node that is not `Running`, re-run it with `--resume`: pausing the capacity
pauses the Eventhouse *destination*, and resuming the capacity does not resume it - the producer
keeps running and the events have nowhere to land.

`fabric/eventhouse/RealTimeDashboard.json` is not provisioned by any of these steps. It is a
Real-Time Dashboard the app does not depend on; import it by hand if you want it.

### Front end

```bash
npx rayfin up --workspace-id <workspace-id> --tenant <tenant-id> -y
```

Point the app at the model created above via `VITE_PBI_DATASET_ID` (see `.env.example`) and the
connector entry in `rayfin/rayfin.yml`.

### Deploying a second instance into another workspace

The same front end can run against an existing back end in a different workspace - or a different
tenant - without disturbing the first deployment. `rayfin/.deployments.json` keys each deployment
by workspace name, so both coexist.

```bash
npx rayfin up --workspace-id <other-workspace-id> --tenant <other-tenant-id> -y
```

Two things have to be pointed at the other workspace's semantic model before the build, because
they are baked into the bundle:

- `VITE_PBI_DATASET_ID` - put it in `.env.production.local`, which Vite loads *after* the
  generated `.env.local` and therefore wins. `VITE_FABRIC_WORKSPACE_ID` needs no attention: the
  CLI writes it before it builds.
- `connectors.hslModel.config` in `rayfin/rayfin.yml`.

Afterwards the CLI leaves `rayfin/.env`, `.env.local` and the active deployment pointing at the
new target. Restore them if the original workspace should stay the default.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | `rayfin up` (backend only) + Vite dev server on 5173 |
| `npm run build` | TypeScript project build + Vite production build |
| `npm run build:fabric` | Same, but copies the Cesium runtime assets first - used by Fabric static hosting |
| `npm run cesium:assets` | Copies Cesium's `Assets/ThirdParty/Widgets/Workers` into `public/cesium/` |
| `npm run lint` | ESLint 9 flat config |
| `npm test` | Vitest unit tests |
| `npm run preview` | Serves the production build locally |

## Licence and attribution

MIT, see [LICENSE](LICENSE). The app renders open data it does not own - the HSL GTFS-RT feed and
the City of Helsinki 3D city model, both CC BY 4.0, both fetched live from the publisher. See
[NOTICE.md](NOTICE.md).

## Notes

- The producer notebook runs on an **hourly schedule** with a 58 min runtime budget, so runs hand
  over without overlapping. It also stands down if an older run is still active.
- The notebook holds **no secrets**: it resolves the Eventstream connection string at run time from
  `GET /v1/workspaces/{ws}/eventstreams/{id}/sources/{sourceId}/connection` using its own identity.
- The semantic model's Kusto datasource uses **end-user SSO**, so every app user queries the
  Eventhouse under their own identity and no stored token can expire.
- Requires Rayfin **1.34.0-beta.1** or newer - the semantic model connector runtime does not exist
  in 1.33.x.
- CesiumJS is code-split into its own chunk, so opening the default 2D map never downloads it.
- `public/cesium/` is generated by `scripts/copy-cesium.mjs` and git-ignored. `vite-plugin-cesium`
  sets `CESIUM_BASE_URL` but does not serve those files in dev, which makes Cesium parse Vite's
  SPA fallback HTML as JSON and die - hence the explicit copy.
