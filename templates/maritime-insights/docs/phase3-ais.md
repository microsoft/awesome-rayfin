# Phase 3 — vessel movement over the terrain

The terrain is static and verifiable. This phase adds the one thing that makes a coastal twin
worth looking at twice: a day of real vessel movement, replayed over it.

## What was built

| Artefact | Size (gz) | What it is |
| --- | --- | --- |
| `tracks.binz` | 0.16 MB | 44 084 positions in 261 passages |
| `tracks.json` | 34 KB | per-track intervals, quantisation, attribution |

A day of shipping costs **0.16 MB** — 0.3 % of the 57 MB payload. The terrain is the expensive
part; movement is nearly free.

## Source and licence

Danish Maritime Authority open AIS, `aisdk-2026-07-01.zip` (725 MB). The DMA states
*"Historical AIS-data are free for down-load"*. Attribution is carried in the app footer.

The Danish feed covers the Kieler Förde because the Baltic approaches are within range of Danish
coastal receivers. That was worth checking rather than assuming, and the check is below.

## Identity: the exporter is the boundary

⚠️ **Revised 2026-08-04.** This section used to read "MMSI, vessel name, call sign, IMO number and
destination are dropped **at ingest**". They no longer are, by default — see PLAN §14.12 for why
that rule was withdrawn. The boundary is still the exporter; what changed is that it now takes a
setting instead of a constant.

`fetch_ais.py --identity` chooses:

| Mode | MMSI, name, call sign, IMO, destination, draught |
|---|---|
| `full` *(default)* | kept for every vessel, as transmitted |
| `commercial` | kept for commercial traffic; pleasure and sailing craft get a per-day pseudonym |
| `anonymous` | discarded; salted truncated blake2s digest, meaningless outside the day |

The reason the default flipped: every one of those fields is broadcast in clear under SOLAS and
republished by the Danish Maritime Authority as one open file per day, so dropping them protected
nothing while making the app unable to name the ship it was describing. Re-deriving what had been
discarded took a 22-second download of the same archive this file is filtered from.

Measured on `2026-07-01` in `full` mode: **233 of 261 passages carry a vessel name** (154 distinct
vessels) for the Förde, and 206 of 208 for the Schlei. The 28 unnamed passages are not anonymised —
AIS sends static data every few minutes against a position every few seconds, so a short passage
can be tracked throughout and never be named. The app distinguishes the two states on screen.

Vessel *type* is kept in every mode because it is what makes traffic legible.

🔴 **Naval vessels are pseudonymised in every mode** (`--include-naval` overrides). PLAN §3.2
rule 3 — *never a way to find a warship* — is a separate rule and was not withdrawn with the
identity one. Detected both by the self-reported `Military` ship type and by the naming convention
warships use on AIS precisely because they are obscuring themselves (`GERMAN WARSHIP A511`). They
stay in the traffic picture and in every coverage figure; only the identity is withheld.

⚠️ **Both the naval test and the ship-type lookup are resolved once per MMSI, not per row.** The
identity fields ride on sparse static messages, so a per-row test marks a warship's static rows
naval and its position rows not — one hull under two keys. Measured when this was wrong: the Förde
went from 174 vessels / 261 passages to **176 / 262**, silently, with a plausible-looking asset.
That is why the ingest buffers the AOI rows instead of streaming them straight to disk.

624 aids-to-navigation (buoys, beacons) were dropped: they are transmitters, not traffic.

Only **0.22 %** of the day's 20 627 893 rows survive the AOI filter. The filter runs while
streaming the archive, so the full national feed is never held in memory or written out.

## The check that mattered: AIS as a witness

A ship cannot drive across a field. So every position is a free, independent test of whether the
terrain is registered correctly — data nobody involved in building the heightmap ever saw.

**First result: 7.27 % of positions landed on a cell the mask calls land.** My first instinct was
to explain it away as moored vessels sitting against quays, and to accept a tolerance. That
explanation was cheap, so I tested it:

- Those positions move at a **median 5.0 knots**. Moored vessels do not.
- **6.0 %** of positions above 8 knots are also "on land".

So the moorings story was wrong. The real question is not *how many* positions are on land but
*how far inland* they are, and that changes the answer completely:

| Measure | Value |
| --- | --- |
| Median distance inland | **4 m** |
| p90 | **27 m** |
| Maximum | 310 m |
| Within 40 m of water | **91.3 %** |

They hug the coastline. This is the land mask's edge precision at a 4 m posting with a 0.05 m sea
threshold — quays, narrow channels and the canal are exactly where a binary land/sea call at 4 m
is least certain. A terrain that was genuinely shifted, flipped or mis-projected would put ships
hundreds of metres to kilometres inland, not four.

**So the share was the wrong statistic and I replaced it with the right one.** The gate now
requires **p90 distance inland ≤ 120 m**, which passes at 27 m and would fail loudly on any real
registration error. A share-based threshold would have been a number tuned until it went green.

```
4. AIS witness (any track on land means the terrain is wrong)
   ok   27,068 positions in the grid, 1,967 on a land cell (7.27 %)
        those sit median 4 m inland, p90 27 m (threshold p90 ≤ 120 m)

registration gate PASSED
```

## A second correction, from the render

The first zoomed screenshot showed an empty inner fjord at 17:00, which looked wrong for Kiel. I
suspected the tracks were drawn in the wrong coordinate frame — the track origin is the AOI
centre while the heightmap origin is its south-west corner.

They were not. The terrain plane is *centred* on the AOI centre, so the scene's world frame and
the track frame already agree; my diagnostic had compared track coordinates against a `0..width`
grid that the scene never uses. Measured correctly:

| Where | Positions in the core | Share |
| --- | --- | --- |
| Outer bay / mouth | 11 418 | 42.2 % |
| Mid fjord | 13 278 | 49.1 % |
| Inner fjord / port | 2 359 | 8.7 % |

62 of 261 passages reach the inner third. Coverage is real; 17:00 at Holtenau was simply a quiet
moment in a quiet spot. **The suspected bug was my own measurement.**

## Rendering: the clock is a uniform

44 084 positions with a 24-hour scrubber invites rebuilding buffers every frame. The data never
changes — only the window over it does — so positions, times and speeds are uploaded once and the
clock is a single uniform. Two draw calls: trails as indexed `LineSegments`, current positions as
`Points`, both filtering by age in the shader.

Segment indices are built per track, so no line is ever drawn between one vessel's last report and
another's first. Trails are drawn 2 m above the water plane rather than on it — coincident
geometry would z-fight, which is the lesson the submerged terrain already taught, applied before
it could bite.

Colour encodes speed (cool → warm), the one attribute that is both measured and readable at a
glance. Fade encodes age within a 30-minute trail.

Cost: **6 draw calls total** (up from 4), tracks load in **691 ms**, first frame **11.3 s**.

## Story beats are derived, not written

The app computes the first movement, the quietest hour and the traffic peak from the track
intervals at load time. For this day it finds **07:00 quietest, 19:00 peak** — the evening ferry
departures — which matches the independent offline count. Hard-coding "the peak is at 19:00"
would be a caption pretending to be a finding; as written, the beats follow whatever day is
loaded.

## Verified live

Deployed and checked in a browser, not just in tests: replay panel present, clock and vessel count
respond to scrubbing, framebuffer content differs between times of day, and the peak view shows
lanes converging at the fjord mouth and funnelling into the port.

## Known limits

- **One day.** Seasonality and weather effects are invisible.
- **AIS is self-reported.** Vessels not transmitting do not appear; this is a traffic picture, not
  a surveillance picture, and the app must never be presented as the latter.
- Trails are 1 px lines — WebGL ignores `linewidth` on most platforms. Ribbon geometry would fix
  this if it ever matters.
