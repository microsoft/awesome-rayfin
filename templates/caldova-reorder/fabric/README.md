# Caldova semantic model

The Fabric semantic model behind the LTG291 demo. It is where Caldova's numbers are *defined* — the app, the regional dashboard and any analytics all read the same definitions from here, which is why their numbers cannot disagree.

## What is in here

| Path | Purpose |
| --- | --- |
| `caldova-operations.SemanticModel/` | The model definition, in TMDL (required for Direct Lake) |
| `dax/` | Queries used to smoke-test the deployment, and handy to run on stage |

The model reads four Delta tables in the lakehouse, loaded from `data/generated/`:

| Model table | Delta table |
| --- | --- |
| `Stores` | `stores` |
| `Products` | `products` |
| `Inventory` | `inventory` |
| `Sales` | `sales` |

`RestockRequests` is different: it is not seeded. The app in this template's root folder writes reorders into its own Fabric SQL database, which Fabric mirrors into OneLake as Delta, and the model reads that copy with Direct Lake. A reorder a manager sends therefore lands in the model without a refresh or a copy step, which is what makes the dashboard number move on stage.

## The definitions that matter

Every measure lives in the model, not in application code. Change one here and every consumer changes with it, with no redeploy.

| Measure | What it means |
| --- | --- |
| `Latest Sales Date` | The most recent day the sales data covers. The model's own notion of "now". |
| `Avg Daily Demand` | Units sold per day over the trailing 28 days, for this product in this store. |
| `Days of Stock` | On-hand units divided by average daily demand. The number the low-stock queue is ranked by. |
| `Low Stock Threshold Days` | **7.** Caldova's definition of "running low". |
| `Is Low Stock` | Whether this product in this store is below that threshold. |
| `Stock Status` | `Critical`, `Low` or `Healthy` — urgency as a word, so it does not depend on colour. |
| `Products Running Low` | How many product-store combinations are running low. |
| `Stores Under Pressure` | How many stores have at least one product running low. |
| `Suggested Reorder Units` | The quantity to pre-fill on a reorder, to restore `Target Cover Days` plus safety stock. |
| `Avg Daily Sales` | Units per day over whatever window the caller filters to. Over 28 days it reproduces `Avg Daily Demand` exactly. |
| `Estimated Stock` | Stock as it stood on a past day, worked back from today's count by adding sales since. |
| `Estimated Days of Stock` | The same, expressed as days of cover. |
| `Estimated Products Running Low` | How many product-store pairs were running low on a past day — the trend behind the app's headline tile. |
| `Reorders Sent Today` | Requests made today, in UTC. Reads zero before the first reorder of the day. |
| `Open Restock Requests` | Requests sent to purchasing but not yet fulfilled. |

The three `Estimated …` measures exist because `inventory` is a **snapshot**: it carries no
history, so a stock trend has to be reconstructed rather than read. They add sales back on to
today's count, which assumes no deliveries arrived during the window — fine for judging a week's
movement on a product that is running low, and not a stock ledger. Each measure says so in its
own description, and the app repeats it wherever the numbers are shown.

Demand is anchored on `Latest Sales Date` rather than `TODAY()` on purpose. The generated sales window is fixed, so by demo day it is already in the past; anchoring keeps `Days of Stock` meaningful whenever the model is queried. `Reorders Sent Today` is the deliberate exception — it uses the real current date, so the tile reads `0` at the start of the demo and moves the moment a live reorder lands.

## Row-level security

The model defines a `RegionalManager` role that scopes `Stores` to the regions the signed-in user manages, matched on `manager_upn` against `USERPRINCIPALNAME()`. This is where "a manager sees only their own region" belongs — in the model, not in the app.

The role ships **unassigned**, so it has no effect until someone is added to it. To try it:

```
fabio semantic-model add-role-member --workspace <workspace> --id <model> --role RegionalManager --member <upn>
```

Assign it only to a test identity that exists in `stores.csv`. A user who manages no store will see an empty model.

## Deploying

Use `deploy.sh` (macOS, Linux) or `deploy.ps1` (Windows) from the repository root. Both do the same thing: load the CSVs into Delta tables, bind this model to the lakehouse and to the app's SQL database, deploy it, refresh it to frame Direct Lake, and smoke-test it.

Deploy the Rayfin app **first**, because the model binds to its SQL database:

```bash
npx rayfin up      # from the template root: creates the app and its SQL database
fabio item list --workspace <workspace> --all # find the caldova-reorder SQLDatabase + SQLEndpoint ids
```

Put those two ids in `.env` as `RAYFIN_SQL_DATABASE_ID` and `RAYFIN_SQL_ENDPOINT_ID`, then:

```bash
cp .env.example .env     # then fill it in
./deploy.sh --dry-run    # check everything locally first
./deploy.sh
```

```powershell
Copy-Item .env.example .env
./deploy.ps1 -DryRun
./deploy.ps1
```

The scripts require an existing workspace and never create or delete one. They also never sign you in — authenticate fabio yourself first and they will check with `fabio auth status`.

### Storage mode

`FABRIC_MODEL_STORAGE_MODE` in `.env` decides how the model reads the lakehouse:

- `onelake` (default) — Direct Lake straight onto the OneLake Delta files. Recommended, and keeps the SQL analytics endpoint off the critical path.
- `sql` — Direct Lake through the SQL analytics endpoint. The fallback if the OneLake binding misbehaves.

`definition/model.tmdl` carries a `{{DATABASE_QUERY_SOURCE}}` placeholder that the deploy script fills in with the right source for the chosen mode. The committed definition is therefore not directly deployable by hand — deploy through the script.

## Running the queries by hand

```
fabio semantic-model query --workspace <workspace> --id <model> --file fabric/dax/low-stock-queue.dax
```

- `smoke-test.dax` — one row proving every measure family answers. Run by the deploy script.
- `low-stock-queue.dax` — the worst-first list a regional manager acts on.
- `headline-tiles.dax` — the header tiles, plus the anchor date and threshold behind them.
- `recent-restock-requests.dax` — the governed reorder record, newest first.

## Resetting

```bash
./deploy.sh --reset
```

Deletes the named semantic model and lakehouse, and nothing else. The workspace is always left in place.
