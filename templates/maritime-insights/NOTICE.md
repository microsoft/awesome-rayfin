# NOTICE — data sources and licences

Every source used by this project is registered here **before** it is used. This file is a gate,
not documentation: if a dataset is not in this table, it does not enter the pipeline.

Verification state as of **2026-07-29** (Phase 0). Reproduce it with:

```bash
python tools/geodata/verify_sources.py
```

---

## Terrain, surface model, buildings, orthophoto — Schleswig-Holstein

**Landesamt für Vermessung und Geoinformation Schleswig-Holstein (LVermGeo SH)**, published as
open data through the state geodata portal.

| Product | Use | Licence |
|---|---|---|
| DGM1 — Digitales Geländemodell, 1 m | core terrain | **CC BY 4.0** |
| bDOM — bildbasiertes Digitales Oberflächenmodell, 20 cm | blocking surface — trees and unmodelled structures, **on land only** | **CC BY 4.0** |
| LoD2 — 3D-Gebäudemodell | buildings | **CC BY 4.0** |
| DOP20 — Digitale Orthophotos, 20 cm | photoreal drape | **CC BY 4.0** |

🔴 **bDOM is used on land only, and that is a correctness decision rather than a licence one.** It
is image-matched, so over water it returns wave texture, wakes and moored boats. Admitting that
into the blocking surface would invent obstructions **on the fjord itself** — the one place this
app must never put a phantom shadow, because every figure it publishes is about seeing ships. The
land mask decides, and `fetch_bdom.py` records how many cells were dropped for this reason.

Licence confirmed from the portal's own dataset record
(`opendata.schleswig-holstein.de`, `license_id = http://dcat-ap.de/def/licenses/cc-by/4.0`).

**Attribution to be carried in the app and on every derived asset:**

> Datenquelle: Landesamt für Vermessung und Geoinformation Schleswig-Holstein (LVermGeo SH),
> CC BY 4.0 [Daten bearbeitet]

Vertical datum stated by the source itself, per tile: `DHHN2016_NH`, quasigeoid
`DE_AdV_GCG2016_QGH`. Acquisition year of the DGM1 tiles over this AOI: **2023**; LoD2: **2024**.

Both areas of interest lie in Schleswig-Holstein and draw on this same source under the same
licence: **Kieler Förde** (201 DGM1 tiles, 213 bDOM tiles) and **Schlei** (224 DGM1 tiles, 224 bDOM
tiles). Choosing the second AOI inside the same federal state was deliberate — it keeps one
provenance chain and one licence rather than adding a second data platform for one demo.

---

## Coarse terrain shell — Copernicus DEM GLO-30
ESA / DLR / Airbus Defence and Space, Copernicus DEM GLO-30, free reuse with attribution.

> © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018 provided under COPERNICUS by
> the European Union and ESA; all rights reserved.

⚠️ It is a **DSM** (canopy and buildings included) on **EGM2008**, while the core is bare earth on
DHHN2016. The two tiers do not share a datum; the offset is measured in the overlap ring over open
ground only and never assumed to be zero.

---

## Land cover, roads, harbour, coastline, places, seamarks — OpenStreetMap

© OpenStreetMap contributors, **ODbL 1.0**. Queried through Overpass.

> © OpenStreetMap-Mitwirkende, ODbL

---

## Protected objects (counter-UAS scenario) — OpenStreetMap

`public/terrain/<aoi>/assets.json`, resolved by `tools/geodata/resolve_assets.py` and carrying the
OSM way id of every entry so each one can be checked.

**Kieler Förde**

| Object | OSM | What is real |
|---|---|---|
| Flughafen Kiel-Holtenau | `way/31869542` | Position, ICAO `EDHK`, IATA `KEL`, runway `08/26` at its surveyed 1380 m and 262°/82° |
| Schleusen Holtenau | 4 × `waterway=lock_gate` | Position of the Nord-Ostsee-Kanal lock group |
| Hörnbrücke | 2 × `bridge:movable=folding` | Position of the folding bridge at the harbour head |
| Drehbrücke Mönkeberg | `bridge:movable=swing` | Position of the swing bridge |
| Hubschrauberlandeplatz UKSH | `way/1038279386` | Position of the hospital pad |

**Schlei**

| Object | OSM | What is real |
|---|---|---|
| Klappbrücke Kappeln | 5 × `bridge:movable=bascule` | Position of the bascule bridge group over the Schlei |
| Lindaunisbrücke | 3 × `bridge:movable=bascule` | Position and name of the road/rail bascule bridge |

⚠️ Two of these carry `nameDerived: true` in the asset file. OSM leaves the Kappeln bascule ways
and the Holtenau lock gates **unnamed**, so the caption is composed from the structure's own
`bridge:movable` mechanism plus the nearest reviewed place from the AOI config. **The coordinates
are measured; only the label is inferred**, and the OSM ids are published above and in the file so
the inference can be checked. Requiring a name would have silently dropped the most prominent
structure in the Schlei.

🔴 **What is not real:** the **protection radius** is a planning value the user drags. It cites no
regulation and no air-law distance. The **sensor** remains user-placed and notional, as everywhere
else in this app.

🔴 **Military sites are excluded at the source.** The same bounding box returns a Bundeswehr
helipad; `resolve_assets.py` filters it out by operator and says why. Nothing in the story needs
it, and painting a protection ring over a real military installation is a bad idea whatever the
licence permits.

---

## Vessel movements — AIS

| Source | Use | Terms |
|---|---|---|
| Danish Maritime Authority open AIS archive (`aisdata.ais.dk`) | historical replay — **in use**, `aisdk-2026-07-01` | ✅ DMA: *"Historical AIS-data are free for down-load"*. Attributed in the app footer. |
| `aisstream.io` | live stream, free API key — **in use** | 🔴 **browser connections forbidden** — consumed only by the relay in `server/ais/`, which runs as a container the browser talks to over SSE. The key lives as a container secret and is never part of the bundle. Beta, no SLA. Credited in the app footer whenever live traffic is on screen. |

**What actually ships** (`tracks.binz` + `tracks.json`, 0.16 MB): position, time, speed, vessel
type and — in the default `--identity full` build — MMSI, vessel name, call sign, IMO number,
destination and draught for 233 of 261 passages. Aids to navigation are excluded. The asset states
which mode built it in its own `identityNote`.

🔴 **Why identity ships, stated so the choice is checkable.** Every one of those fields is
broadcast in clear by the vessel under SOLAS, and the Danish Maritime Authority republishes them
for whole days at a time — the same 725 MB file this asset is filtered from. Withholding them buys
no privacy the source has not already given away, while making it impossible to say which ship the
model is talking about. What ships here is a bounding-box subset of an already-open archive.

⚠️ **The distinction that still carries weight is commercial versus pleasure.** A cargo ship's name
is a company asset; a named private yacht plus a day of positions is a person's location history,
and this build names 57 sailing and pleasure craft. `fetch_ais.py --identity commercial` keeps
names for commercial traffic and pseudonymises the rest; `--identity anonymous` restores the
original behaviour throughout. The live relay takes the same three values through `AIS_IDENTITY`.
If this material is ever published somewhere the *subjects* matter more than the demonstration,
rebuild — the switch exists for exactly that.

🔴 **Naval vessels are pseudonymised in every mode**, because PLAN §3.2 rule 3 — *never a way to
find a warship* — was not withdrawn along with the identity rule, and this is a demonstration
shown to defence customers. Detected both by the self-reported `Military` ship type and by the
naming convention warships use on AIS precisely because they are obscuring themselves
(`GERMAN WARSHIP A511`). They remain in the traffic picture and in every coverage figure — only
their identity is withheld. `--include-naval` overrides this deliberately and visibly.

---

## Water level

**PEGELONLINE**, Wasserstraßen- und Schifffahrtsverwaltung des Bundes (WSV), open REST API.
Reachable and returning station data (2026-07-29; an earlier probe the same day returned HTTP 503,
so treat availability as intermittent and cache).

---

## Bathymetry *(optional in v1)*

**EMODnet Bathymetry** (WCS, reachable) and **BSH GeoSeaPortal**. Licences to be recorded here
before either is used — neither has been fetched yet.

---

## Not used, and why

- **`overpass.osm.ch`** — answers HTTP 200 and returns **zero elements** for a German bounding box,
  because it is a regional instance. Removed from the mirror list; a reachability probe passes on
  it while the data is silently absent.
- **`web.ais.dk`** — TLS certificate does not match the hostname. The archive lives at
  `aisdata.ais.dk`.
