# Caldova demo data

This folder contains the deterministic synthetic dataset for the LTG291 Caldova pharmacy operations demo. It represents OTC retail inventory and sales only; it contains no patient or clinical data.

Run the generator with:

```bash
npm run generate
```

The fixed seed in `generate.js` produces the same five CSV files on every run:

| File | Shape | Purpose |
| --- | ---: | --- |
| `stores.csv` | 15 stores | Store, region, city, and fictional manager identity |
| `products.csv` | 60 SKUs | OTC product catalog and pricing |
| `inventory.csv` | 900 rows | Store-by-SKU stock, reorder point, and safety stock |
| `sales.csv` | 63,000 rows | 70 days of store-by-SKU sales |
| `restock_requests.csv` | 8 rows | Seeded reorder history, loaded into the app's SQL database — not the lakehouse |

Several fixed store/SKU pairs are deliberately kept below 1.6 days of stock so the live demo always has obvious action candidates. `test/generator.test.js` captures the deterministic shape and hero-SKU invariants.

## Restock requests

`restock_requests.csv` carries the governed record of a reorder: `request_id`, `store_id`, `sku`,
`qty`, `requested_by`, `requested_by_id`, `requested_at` (ISO 8601 UTC), `status` and `note`.

Unlike the other four files it is **not** loaded into the lakehouse. Reorders are written by the
app into its own Fabric SQL database, which Fabric mirrors into OneLake for the semantic model to
read; seeding this history anywhere else would put the same record in two places. `deploy.sh` and
`deploy.ps1` load it there via [`reorder-seed.js`](reorder-seed.js), which deletes the seeded ids
before inserting them so a repeat deploy cannot double the history.

The seed rows exist for two reasons. They give the app's "recent reorders" list something to show before the live reorder lands, and they give Fabric real values to infer Delta column types from — a header-only file would produce an unusable table.
