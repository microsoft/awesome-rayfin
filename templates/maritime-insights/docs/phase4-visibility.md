# Phase 4 — the visibility model

The reason the app exists. Everything before this phase was building a place accurate enough for
this question to be worth asking: **from a mast here, what can you not see?**

## What ships

- **Mode C.** Double-click anywhere to drop a notional site. Two levers — mast height and target height —
  and the coverage field re-solves in **14–31 ms**, so the shadow moves while the slider moves.
- **Mode D.** A toggle that leaves only the traffic *outside* the modelled coverage, with a caption
  that refuses to interpret it.
- `los_16m.u16z`, **0.52 MB gzipped**: the surface a sight line actually has to clear.

## The model, and what it is not

Line of sight against a measured surface under standard refraction, using a 4/3 effective earth
radius. That is the entire physics. It contains no radar cross-section, no sea clutter, no
multipath, no ducting, no rain attenuation and no detection probability, and the app says so in a
permanent panel.

That restraint is not modesty, it is the product. The physics of a real sensor belongs to the
people who build them, and guessing it badly in front of those people loses the room. Geometry, by
contrast, is checkable by anyone in the room on a phone.

### Verified against a formula it never refers to

`src/twin3d/viewshed.test.ts` — 14 tests against the **shipped** solver, not a Python twin that
could drift from it:

| What is pinned | How |
| --- | --- |
| The effective earth radius | 8 494 678 m, i.e. 4/3 × IUGG mean |
| The 4.12 coefficient | derived as `√(2·R_eff)/1000`, not typed in |
| Curvature drop | 19.1 m at 18 km |
| **The visible edge over open water** | within **1 %** of `4.12·(√h₁+√h₂)` |
| Target height as a real lever | extra reach equals `4.12·(√20−√2)` |
| Shadow behaviour | a wall casts one; raising the mast shortens it |

The horizon is never applied as a cap. It *falls out* of marching a straight ray over a curved
earth — which is why matching the textbook figure is a real test rather than a tautology.

## The blocking surface: bare earth is not enough

DGM1 is a *ground* model, so a 30 m silo on the pier is not in it and a model built on bare earth
alone claims sight lines straight through the harbour. The LoD2 buildings were already paid for in
Phase 2, so they are burned into the surface: **554 964 cells raised, median +3.5 m, p90 +12.8 m,
max +102.3 m** — that maximum being about the height of Kiel's town-hall tower.

Two choices push the model towards claiming *less*:

- **Downsampling takes the maximum, not the mean.** A mean erases ridges, and a ridge is exactly
  what casts a shadow. Measured: block-max sits **4.94 m** above block-mean at p90 — that is the
  shadow an average would have quietly deleted.
- **Buildings contribute their roof height to every cell they touch.**

## 🔴 What the model could not see — measured first, then bought

Vegetation was **deferred**, because the surface model that carries tree heights is ~22 GB for this
AOI. Phase 2 deferred it on that measurement. Phase 4 needed to know what the deferral costs, so
`verify_visibility.py` measured it on the one square where both products were cached:

| On tile 570/6018 | |
| --- | --- |
| Cells carrying something over 2 m | **36.1 %** |
| Object height | median 7.5 m, p90 16.1 m, max 29.9 m |
| At 16 m, cells that would rise | **90.8 %** |
| By how much | **median +9.6 m**, p90 +18.0 m, max +29.7 m |

That is not a rounding error, and the omission was **directional**: every one of those metres was a
sight line the model granted and reality blocks. So the coverage figure was an **upper bound**, and
the app said exactly that, with the number, in the panel.

I checked whether a scoped fetch could fix it, since the app's argument is coastal sight lines
rather than inland forest. It cannot, cheaply — the fjord is long and winding, so the coastline
touches most tiles:

| Land within … of water | Tiles | Download |
| --- | --- | --- |
| 250 m | 82 | ~8.4 GB |
| 500 m | 99 | ~10.1 GB |
| 1 km | 118 | ~12.1 GB |
| any land at all | 201 | ~20.6 GB |

**8.4 GB was a decision, not a detail** — so it was left open rather than taken silently, and then
taken deliberately.

### The caveat, retired

`fetch_bdom.py` streams all **213 tiles / 22.3 GB** of the 20 cm bDOM at 16–27 MB/s, reduces each
tile 20 cm → 1 m → 4 m by **block maximum**, accumulates into a grid aligned to `heightmap_4m` and
**discards each tile after use** — the repository gains 6.8 MB, not 22 GB. `build_los_surface.py`
then folds that surface top in by maximum, after buildings.

| Full AOI, measured | |
| --- | --- |
| Tiles placed | 213 over 12,386,021 cells |
| Land cells that rise | **5,161,692 (54.1 % of land)** |
| Lift over bare earth | median **+5.5 m**, p90 **+20.6 m**, max **+109.4 m** |
| Beyond building height (at 16 m) | 4,935,163 cells, median +4.9 m, p90 +20.8 m |
| Dropped as implausible | 9 |
| Dropped **over water** | 2,845,642 |

🔴 **The land-only gate is the load-bearing part.** Image matching over water returns wave texture,
not a surface — a phantom obstruction on the fjord would silently corrupt every coverage figure
this app publishes. The gate uses `landmask_4m`, and the count of what it dropped is printed and
stored in the descriptor rather than left to trust.

Two bugs worth recording: `tile_origin()` already returns **metres**, and multiplying by 1000 again
placed every window 570,000 km east — nothing was placed and *nothing complained*, which is why the
script now asserts grid/tile alignment instead of assuming it.

### 🔴 The bug the layer created: a mast standing on the canopy

Adding an obstruction made the model see **more**, and no percentage showed it.

The site's own elevation was read out of the raster the sight lines are blocked by. That was
harmless while the raster was bare earth plus buildings. The moment the canopy went in, every mast
placed in a wood stood on top of it — handed a median **+5.5 m** of free antenna by the change that
was supposed to take coverage away.

`LosGrid` therefore carries two rasters now: `surfaceM` blocks a sight line, `groundM` is what a
mast stands on. `groundM` is resampled from the 4 m heightmap already in memory, so it costs no
download, and it takes the **centre** of each block — not the maximum, which would put the mast on
the highest point within 16 m, and not the mean, which invents an elevation that exists nowhere.
Four tests pin the two apart, including the invariant that was violated: a site in a wood must see
**less** than the same site in the open.

| Measured after the fix | Before vegetation | After |
|---|---|---|
| Best single 25 m mast | 96 % (131 / 137) | **87 %** (119 / 137) |
| Its position | a 33 m rise inland | a 7 m shoreline cell |
| Three-site network | 100 % | **97 %** (133 / 137) |

Coverage **fell**, and the optimiser's recommendation **moved**: the inland rise it used to like
cannot see past its own tree line. That is the 22 GB earning its place.

## 🔴 The validation the plan wanted, and why it is refused

PLAN §7 hoped to compare each modelled shadow against observed AIS coverage and report the
disagreement rather than tune it. **That comparison cannot be made honestly here:**

- the Danish archive is an **aggregate** of many shore receivers plus satellites, and publishes no
  receiver positions;
- our shadow is cast for **one** user-placed notional site, so the two share no geometry;
- AIS reception is a VHF radio question, not a pure line-of-sight one.

A correlation computed anyway would look rigorous and mean nothing. Recorded as unavailable and
left open, which is the honest state.

## 🔴 A defect the tests tolerated and a rendered frame caught

The first deploy showed a **radial moiré** fanning across the water. It looked like a property of
the terrain; it was a property of the sampling. A radial sweep leaves holes two ways — *along* a
ray, because stepping a whole cell diagonally advances only 0.7 cells per axis and skips the ones
between, and *between* rays, because they diverge with range.

The uncomfortable part: there **was** a test for this, asserting unevaluated cells stayed under
0.5 %. It passed. The threshold was loose enough to admit a defect that was obvious on screen, and
it was measured on a small square grid rather than the real 708 × 1103 one.

Fixed by stepping half a cell and filling residual holes only where all neighbours agree — a cell
on a shadow boundary has disagreeing neighbours and is deliberately left alone, so tidying the
sampling can never move the edge of a shadow. The test now runs at the real grid size with a
0.05 % bound, plus one that asserts the shadow edge stays sharp.

The measured effect: evaluated area went from 160.8 km² to **199.3 km²** of a 199 km² grid. **19 %
of the field had been silently unclaimed.**

## Numbers from the deployed app

Site on the water mid-fjord, ground −0.1 m, eye 24.9 m, horizon 26.4 km:

| Lever | Visible | Solve time |
| --- | --- | --- |
| Mast 5 m | 22.8 km² | 19 ms |
| Mast 25 m | 36.5 km² | 28 ms |
| Mast 120 m | 94.5 km² | 31 ms |
| Mast 25 m, target 30 m | 106.7 km² | 15 ms |

Worth sitting with: **raising the target from 2 m to 30 m buys more coverage than raising the mast
from 25 m to 120 m.** That is the entire small-target-detection conversation, and it is pure
geometry — no product performance claim anywhere near it.

## Guardrails held

- No site exists until the user places one; it carries no name and is labelled *fiktiver Standort*.
- No real installation is depicted anywhere.
- Mode D shows the gap and refuses to interpret it: *"Eine Lücke ist kein unentdecktes Schiff."*
- Repo remains account-neutral.

## Open

- ~~The 8.4 GB coastal vegetation fetch~~ — taken, and larger than that: all 213 tiles / 22.3 GB,
  streamed and discarded. The "upper bound" caveat is retired.
- The AIS validation, refused for now and reopenable with a feed that publishes receiver positions.
- The viewshed runs on the main thread. At ~30 ms nothing stutters; a worker is the answer if the
  grid ever gets finer.
