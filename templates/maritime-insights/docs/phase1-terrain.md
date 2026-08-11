# Phase 1 — terrain

**Date** 2026-07-29 · **Gate** PLAN §9: *registration gate passes; measured VRAM and first-frame
time recorded* · **Status: registration gate PASSES. Renderer not yet built, so VRAM and
first-frame time remain open.**

```bash
python tools/geodata/fetch_lvermgeo.py --product dgm1   # 205 tiles, 5.7 GB
python tools/geodata/fetch_copdem.py                    # shell, 2 tiles mosaicked
python tools/geodata/fetch_dop20.py                     # drape from the WMS
python tools/geodata/build_terrain.py                   # heightmap + land/sea mask + preview
python tools/geodata/verify_registration.py             # the gate
```

---

## 1. The registration gate passes

```
1. focus places on plausible ground        12/12 ok
2. published light height (a bound)         ok — ground 3.82 m under a 31 m focal plane
3. the coastline straddles zero             ok — 1727 vertices, median +0.37 m,
                                                 p10 −0.03, p90 +2.02 (tolerance ±3.0)
4. AIS witness                              UNAVAILABLE — needs Phase 3. Not a pass.
```

**Check 3 is the one that carries the weight.** OpenStreetMap digitises the coastline from imagery,
entirely independently of the state survey, and a bare-earth model's zero contour is the waterline.
Their agreeing to a median of **+0.37 m** over 1727 vertices constrains the horizontal placement,
the vertical datum and the raster orientation at once. A mirrored raster, a wrong origin or a
metre-scale shift all break it, and none of them would break the place check.

**Check 4 reports as unavailable rather than passing.** A check that silently does nothing is worse
than a check that is missing — a lesson this repo family paid for in an overlap test that matched no
elements and passed vacuously for weeks.

Sampled grounds, for the record: Kiel 2.07 m · Hörn 0.02 m · Holtenau 16.12 · Friedrichsort 3.82 ·
Mönkeberg 30.62 · Heikendorf 11.77 · Laboe 22.37 · Schilksee 22.62 · Strande 2.82 · Bülk 3.82.

## 2. 🔴 The plan's compression premise was wrong, and measuring it is what showed that

The plan asserted the heightmap would compress heavily *"because most of the AOI is water and
therefore a constant"*. Both halves are false:

- **DGM1 is not constant over water.** It carries real varying values across the fjord —
  **−11.38 to 0.05 m, standard deviation 4.59 m**, over 23.7 % of the grid.
- **Flattening the sea anyway barely helped**: 21.11 → 18.14 MB. The payload is dominated by *land*
  detail, so the water was never the lever. A separate bathymetry layer would cost 2.78 MB, which is
  worth knowing for the marine-research door but does not change this decision.

## 3. ✅ The lever that worked is an honesty argument, not a compression trick

The builder had been spreading the full 16-bit range across a 72 m span — a **1.1 mm** vertical
step. DGM1's stated height accuracy is of the order of a decimetre, so that was storing measurement
noise and calling it terrain. Measured, gzipped:

| step | payload | |
|---|---|---|
| 0.001 m | 21.19 MB | precision the survey does not have |
| 0.01 m | 15.89 MB | |
| 0.02 m | 13.49 MB | |
| **0.05 m** | **9.79 MB** | ← chosen, inside DGM1's own accuracy |
| 0.10 m | 7.05 MB | terracing starts to show on gentle ground |

**Less than half the payload, and not one millimetre of real information given up.**

## 4. Source realities that only appear when you actually download it

- 🔴 **The catalogue lists a tile the server will not serve.** `dgm1_32_581_6034_1_sh_2006` answers
  962 bytes. Skipping it is right; skipping it *silently* is not — it now surfaces as a named
  warning and reaches the coverage figure.
- 🔴 **Not every tile is a complete 1000 × 1000 grid.** The 2023 tiles are; the 2006 tiles over the
  northern water are not (`dgm1_32_577_6032_1_sh_2006` carries 999 999 points). An equality check
  rejected a perfectly usable tile and killed the whole build. Gaps are now nodata and are reported.
- 🔴 **`http.client.IncompleteRead` is not an `OSError`**, so a truncated chunked response killed a
  5.6 GB download at tile 205 of 206. Retries now cover it, the declared length is checked, and
  tiles are written through a temporary name so a partial file can never be cached as a good one.
- ⚠️ **The AOI's north-east corner has no DGM1 at all** — open Baltic beyond the survey, **4.94 %**
  of the grid. That is a real data boundary, not a fetch failure, and it is visible as the red block
  in `public/terrain/kieler-foerde/preview.png`.
- **Acquisition years are mixed**: 2023 over almost all of the AOI, 2006 for a strip in the
  north-east. The catalogue holds several vintages per square, so the fetcher takes the newest —
  taking whatever came first would have mixed a twenty-year span into one model.

## 5. Performance

- ⚡ **The resample was `np.add.at` over a million indices per tile and had not finished 205 tiles
  after several minutes.** The source is 1 m, the render grid is a whole multiple of it and both are
  snapped to the same modulus, so a tile maps onto an exact block of render cells: the same
  arithmetic is a reshape-and-mean. **3 seconds.** Alignment is asserted, not assumed — if it ever
  fails, the fast path would silently shift the terrain by up to one cell.
- Parsing 28 MB of ASCII per tile costs ~10 s, so decoding is spread across cores and cached as
  `.npy`. One-time cost; rebuilds are seconds.

## 6. The drape, and a decision that falls out of looking at it

`drape.jpg`, 5260 × 8192 at **2.16 m/px**, 9.07 MB, from `WMS_SH_DOP20col_OpenGBD`. Registration is
visually unambiguous — harbour, canal entrance, fjord and headland all sit where the terrain puts
them.

Two defects, both only visible because this AOI is mostly water:

1. **A white rectangle in the north-east** where DOP20 coverage ends — the same open-Baltic boundary
   as the missing DGM1 tiles.
2. **Horizontal banding across the water**, where the WMS request strips meet. Invisible over land;
   obvious over a uniform surface.

Both point at the same answer, and it is the honest one rather than a patch: **the drape is a
photograph of the ground, and the sea is not ground.** Rendering the sea as its own surface, masked
by `landmask_4m.u8z`, removes the banding and the white gap together. Recorded here rather than
implemented, because it belongs to the renderer.

## 6a. 🔴 The water rule, and why one threshold was never going to hold

The mask above decides which cells are pushed under the water plane instead of being drawn on top
of it, so getting it wrong is not cosmetic — it is the difference between an inlet and a dark
smear. The original rule was one line: *sea is elevation ≤ 0.05 m*. It was tuned on the first AOI,
whose Baltic values straddle zero, and it held there.

**On the second AOI it failed, visibly.** The Schlei's surveyed water surface sits at **+0.07 m**
over whole areas — 572 707 cells at exactly that height. Two centimetres above the cut, so every
one of them was classified *land*, drawn at its measured height on top of the water plane, and
textured with the orthophoto's photograph of water. The inlet rendered as a dark, speckled band
with blue only where a cell happened to dip below the line.

The diagnostic that settled it was a picture, not a threshold sweep: colouring every land cell at
or below 0.10 m showed a **coherent water body** — the inner Schlei and the Baltic fringe — and the
boundary between the correct and incorrect regions was a **straight diagonal line**. That is a
lidar acquisition seam. The water level differed between flights, so **no constant can be right for
every block**, and nudging 0.05 upward would only move the failure somewhere else.

The rule is therefore not a threshold but a definition: **water is what sits at water level *and*
connects to water.**

```
seed      = elevation ≤ 0.05 m                    # confidently water
reachable = elevation ≤ 0.20 m                    # could be water
sea       = binary_propagation(seed, mask=reachable)
```

0.20 m is the repo's own stated figure for how tideless the Baltic is: wind set-up in a tideless
basin is of that order, so a legitimate water surface can sit that far off datum. The connectivity
requirement is what stops a low inland field at +0.15 m from becoming a lake — it has to be
reachable from open water.

| | Kieler Förde | Schlei |
|---|---|---|
| Sea, before | 23.3 % | 9.6 % |
| Sea, after | 24.9 % | **14.7 %** |
| Cells recovered | 152 747 | **650 180** |
| Land cells left at ≤ 0.10 m | 0.9 % → **0.0 %** | 4.3 % → **0.0 %** |

🔴 **The AIS witness confirms it independently.** Ships are in the water, and that check knows
nothing about elevations or thresholds:

| AIS positions landing on a "land" cell | Before | After |
|---|---|---|
| Schlei | 29.90 % (p90 **75 m** inland) | **9.16 %** (p90 **16 m**) |
| Kieler Förde | — | 2.33 % (p90 **9 m**) |

⚠️ **A gate applied at fetch time goes stale.** `fetch_bdom.py` already drops the measured surface
top over water, but it did so against the mask that existed when it streamed 23 GB — and nobody
re-streams 23 GB because the mask improved. Once the water rule was corrected, canopy heights were
left sitting on newly-classified water: phantom obstructions floating on the inlet, blocking sight
lines across the very water the app measures. `build_los_surface.py` now re-applies the land gate
**where the data is consumed**, and reports what it drops: 18 092 cells on the Schlei, 12 426 on
the Förde.

No published coverage figure moved. The frame is also bit-identical across two seconds with the
clock and vessels frozen, close in and at range — measured rather than asserted, because "it looks
stable now" is how the first speckle survived review.

## 7. Outstanding for Phase 1

- KTX2 drape and 2 × 2 tiling (PLAN §4.3.1) — the drape is still JPEG at 2.16 m/px.
- The shell packed for the browser; it is fetched and mosaicked but not yet written as an asset.
- The sea surface, and with it the drape masking above.
- The renderer, and with it the two gate items still open: **measured VRAM and first-frame time**.
