# Phase 2 — buildings, land cover, trees

**Date** 2026-07-29 · **Gate** PLAN §9: *rendered frame reviewed — this is where "photoreal" is won
or lost* · **Status: buildings built and verified. Land cover and trees outstanding.**

```bash
python tools/geodata/fetch_lvermgeo.py --product lod2   # 171 tiles, 1.25 GB
python tools/geodata/build_lod2_mesh.py                 # 54 323 buildings
```

---

## 1. Buildings

**54 323 buildings · 13 936 647 vertices · 4 645 549 triangles · 83.62 MB raw, 31.53 MB gzipped.**

Dropped on the way: 15 628 under 20 m² (garages, sheds), 3 718 outside the terrain extent — the
1 km tile band reaches past the AOI and those buildings would have no ground under them.

### The registration check that settles it

Verified against the land/sea mask, which comes from a completely different pipeline:

```
vertices inside the heightmap:  99.96 %
vertices standing on land:      99.97 %
```

**99.97 % of building vertices stand on land.** A mirrored mesh, a wrong axis convention or a
metre-scale offset would drop a large share of a coastal city into the fjord, so this is a far
stronger statement than any coordinate comparison. The rendered frame agrees: buildings hug the
coastline, fill the city and the villages, line the canal, and there are none in the water.

The axis convention it confirms: **+x east, +z south, y up.** The terrain raster has row 0 at the
north, so z must grow southwards or every building sits mirrored against its own ground.

⚠️ Ground elevations run **−6.5 … 56.8 m**, median 22.0. The negative end is not a defect — there
are structures inside the canal locks, below sea level, and DGM1 agrees.

## 2. 🔴 The payload is 4× the plan's estimate, and both obvious fixes fail

PLAN §4.3.2 estimated 10–20 MB for buildings and flagged it as *the* payload risk. Measured:
**83.62 MB raw.** Two reductions were tried and neither survives measurement:

| Lever | Result | Why it fails |
|---|---|---|
| **Indexed geometry** | 83.62 → **76.22 MB** | Only 24.5 % of vertex positions are unique, so dedup looks like an easy 4×. But 13.9 M **uint32 indices cost 55.7 MB**, more than the 20.5 MB of shared vertices saves. A whole new asset format for 9 %. |
| **Drop small buildings** | 83.62 → **65.2 MB** at −43 % of the stock | The payload is spread evenly, not concentrated in a tail: the largest 25 % of buildings hold only 49.4 % of the vertices. |

**The mesh is large because there are genuinely 54 000 buildings.** What does pay is gzip on the
wire — **2.7×, so the download is 31.53 MB** while the GPU buffer stays the raw figure. For scale, a
sibling repo ships 3.6 M triangles at 61.7 MB and holds 16.7 ms on the same class of integrated GPU,
so 4.6 M triangles is in known-working territory rather than in new risk.

Distribution, for anyone tempted to try again: median 198 vertices per building, mean 257, p90 429,
max 10 158.

## 3. 🔴 The same appended-HTML trap, in a second file format

The download service appends the website's HTML footer to **everything** it serves. On the `.xyz`
terrain tiles that shows up as `</html>` on the last line; on CityGML the XML parser rejects the
entire file with *"junk after document element"*. The builder cuts each document at its own closing
`</core:CityModel>` tag — cutting rather than filtering, so a genuinely truncated download still
fails loudly instead of parsing as a short building list.

Three catalogued LoD2 tiles were also not served at all (`LoD2_32_571_6035`, `572_6026`, `578_6029`),
the same behaviour as the missing DGM1 tile. Reported by name, never skipped silently.

## 4. Privacy: the exporter is the boundary

CityGML is cadastral data. Every building carries a cadastral identifier (`gml:id`), a municipality
key and an ALKIS function code, and the source also holds the exact footprint rings. **None of it is
exported.** What ships is geometry, a ground elevation and a vertex range.

This is written where the file is created rather than where it is displayed, because a sibling repo
published exactly this combination — cadastral id, footprint and building function for 2 080 real
buildings — answering HTTP 200 to anyone, precisely because the code that dropped those fields lived
in the UI. `buildings_lod2.json` carries a `privacyNote` recording the decision.

## 5. Land cover: **deliberately not built**

The plan lists a land-cover raster, inherited from sibling repos where it is the layer that stops
bare elevation shading reading as bare stone. **This AOI has something better and it is already
shipping: a 20 cm orthophoto.**

A classified tint over a photograph would be strictly worse — it replaces measured colour with
guessed colour, it fights the image it sits on, and it adds a pipeline stage and a payload for a
result the drape already delivers at higher fidelity. The rendered frames make this obvious: fields,
woodland, roads, quays and the harbour basins all read clearly, because they are photographed rather
than inferred.

**What land cover would genuinely buy is not colour.** It is surface type for the visibility model
— and that model is explicitly geometric, with no clutter term, so it does not want one either.

## 6. Trees: measured, then deferred with a reason

Trees are not cosmetic here. Vegetation height is **load-bearing for the Phase 4 visibility model**:
a 25 m tree line blocks a low sensor's line of sight exactly as a hill does, and leaving it out
would overstate what a site can see.

So the cost was measured rather than assumed:

| | |
|---|---|
| bDOM tile | **104.9 MB**, 5000 × 5000 float32 at 20 cm |
| Tiles over the AOI | **213** |
| **Total download** | **~22 GB** |

**22 GB for a layer nothing currently consumes is not a defensible spend.** The decision was to
build it in Phase 4, once something actually consumed it, rather than speculatively now. One tile
was cached so the format was known and the method ready.

**Phase 4 took it.** `fetch_bdom.py` streams all 213 tiles, reduces each 20 cm → 1 m → 4 m by block
maximum and **discards it** — the repository grows by 6.8 MB, not 22 GB, and the deferral cost
nothing but a rebuild. See [phase4-visibility.md](phase4-visibility.md).

## 7. Harbour

No separate layer. The quays, basins, piers and locks are in the LoD2 building model and in the
20 cm drape, and both are already rendering. The city's own open WFS (140 feature types, including
`Hafengebiet` and `Hafenanlagen`) stays on the list for when something needs harbour *semantics*
rather than harbour *geometry*.

## 8. Phase 2 outcome

**Built:** 54 323 LoD2 buildings, verified and rendering in the deployed app.
**Deliberately not built:** land cover (the drape supersedes it), trees (22 GB, deferred to the
phase that needs them), harbour (already covered by two layers that exist).

The gate — *rendered frame reviewed* — is met against the deployed app, not a build-time preview.
See `docs/deployment.md`.
