# Phase 0 — source verification

**Date** 2026-07-29 · **Gate** PLAN §9: *every source in §5 confirmed open and reachable, or the
AOI changes* · **Result: gate met, AOI unchanged.**

Reproduce with `python tools/geodata/verify_sources.py` (13/15 probes reachable; the two failures
are redundant Overpass mirrors while the primary answers).

The plan's own risk table called Schleswig-Holstein geodata a **blocker**, on the grounds that a
pipeline written against one state survey office does not transfer to another. That was correct,
and this is what asking the servers produced.

---

## 1. Everything the terrain needs is open, and one thing more than expected

All four products are published by LVermGeo SH under **CC BY 4.0**, confirmed from the portal's own
dataset record rather than from a claim on a web page.

| Product | Tiles over a 6 × 6 km test window | Acquisition |
|---|---|---|
| DGM1 (terrain, 1 m) | 161 over 132 km² | 2023 |
| bDOM (surface model) | 161 | — |
| DOP20 (orthophoto) | 161 | — |
| **LoD2 (3D buildings)** | 150 | **2024** |

🔴 **LoD2 exists, and I had already concluded it did not.** Searching the open data portal for
*Gebäudemodell*, *LoD1*, *CityGML* and *3D-Gebäude* returned nothing from the survey office, and the
draft conclusion was that buildings would have to be extruded from 2D ALKIS footprints against the
bDOM. Querying the download index directly returned **150 LoD2 tiles** for the same window. The
portal's search index is not a statement about what the portal serves. **Ask the download service,
not the catalogue.**

The vertical datum came from the data rather than an assumption: every DGM1 tile record carries
`hoehenbezu = DHHN2016_NH` and `quasigeoid = DE_AdV_GCG2016_QGH`.

## 2. The tile index is a bbox query, and it was recovered by watching the network

The download app is a minified bundle, so reading its source found nothing usable — the same
situation, and the same fix, as the sibling repo's gauge portal. Loading the page in a browser and
capturing the network revealed:

```
GET https://geodaten.schleswig-holstein.de/gaialight-sh/_apps/dladownload/_ajax/overview.php
      ?bbox[]=<minE>&bbox[]=<minN>&bbox[]=<maxE>&bbox[]=<maxN>
      &crs=EPSG:25832&type[]=<dgm1|bdom|dop20|lod2>
```

It returns a GeoJSON FeatureCollection in EPSG:25832, one feature per 1 km tile, carrying
`filepath`, `jahr`, `ogc_fid` and a tile name.

⚠️ **The four products do not share a property schema.** `dgm1` carries `kaname` *and*
`kachelname`; `bdom`, `dop20` and `lod2` carry `kachel_n`; only `lod2` carries `d_format`. Only
`filepath` is common to all four. A fetcher must not infer one shape from having seen another.

## 3. 🔴 Two sources answer "success" while returning nothing

This is the most transferable finding here, and both instances cost real time.

- **`overpass.osm.ch`** returns **HTTP 200 with zero elements** for a German bounding box, because
  it is a regional instance. The first place-resolution run reported *"0 elements"* for the whole
  Kiel Fjord and wrote an empty file — with no error anywhere.
- **`overview.php`** returns `{"success": true, ... "features": []}` when it is throttling. A
  sequence of index queries that had just returned 176 tiles began returning zero, successfully.

**Reachability is not availability.** Both the probe tool and `resolve_places.py` now treat an
empty payload as a failure worth retrying elsewhere, and the mirror list uses a query whose answer
is known to be non-empty rather than a count.

## 4. Still open — one item, with a known route

**The per-tile download call.** The index is solved; the download is an asynchronous job API
(`multi.php?action=start` → `action=status&job=…` → `action=download&job=…`), and the shape of the
job payload is not yet known. Every parameter name and value tried was rejected identically
(*"Objekttyp ist für Mehrfachdownload ungültig"*), which suggests the request is not a GET of the
shape being guessed.

**Next action, and it is the same technique that solved §2:** open the download page, select one
tile, click download, and capture the exact request. Ten minutes, and it closes Phase 1's only
dependency. Guessing further is not worth another hour.

The orthophoto does not depend on this at all — **`WMS_SH_DOP20col_OpenGBD` on `dienste.gdi-sh.de`
serves DOP20 as a live WMS**, which is exactly how the sibling repo already builds its drape.

## 5. Measured facts worth keeping

- **Copernicus DEM GLO-30 tile N54/E010**: HTTP 206, `image/tiff`, **14 644 958 bytes**, range
  requests honoured — so the COG reader can fetch only the tiles the shell needs. This AOI's shell
  spans four one-degree tiles, so it needs real mosaicking, unlike the single-tile sibling.
- **Danish open AIS, one day: 724 753 358 bytes** (`aisdk-YYYY-MM-DD.zip`, containing a CSV).
  Predictable daily naming. Redistribution terms still to be confirmed.
- **PEGELONLINE** returned HTTP 503 on one probe and full station data on another the same day —
  intermittent, so cache rather than depend on it live.
- **Core AOI measured**: 11.33 × 17.65 km = **200 km²**, UTM32 570654/6018005 → 581985/6035657.
  Heightmap at 4 m = 2833 × 4413 = 12.5 M cells = **25 MB raw uint16**.
- 🔴 **The heightmap must ship compressed.** Well over half of those cells are water and therefore
  a constant, which gzip removes almost entirely. Use a neutral extension and detect the `1f 8b`
  magic by content — never name it `.gz`, because dev servers set `Content-Encoding` on that and
  production hosts do not.
- **Drape resolution follows the texture cap**: a single 8192 px texture across an 11.33 km core is
  1.38 m/px; 2 × 2 tiles give **0.69 m/px**. With KTX2 that costs the same VRAM (PLAN §4.3.1).

## 6. AOI

`config/aoi/kieler-foerde.json`, written **after** resolving places, not before. 121 OSM elements
came back for the first-pass window; twelve became camera bookmarks, ordered along the fjord from
the harbour head outwards.

The northern edge holds **Bülk** on purpose: it is the terrain that casts the shadow the whole demo
is about, and trimming the box to save area would remove the subject.

⚠️ **Only one seamark light inside the window carries a published height** (Holtenauer Schleusen,
31 m). One vertical check is thin. Look for more in the official light list before Phase 1 closes —
and lean on the check that costs nothing: **any AIS track on rendered land means the terrain, the
coastline or the projection is wrong.**
