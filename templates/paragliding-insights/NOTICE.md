# NOTICE — data sources, licences and attribution

Gleitschirm-Insights is built entirely from **openly licensed data**. This file is the licence
register. Every source used anywhere in the repo must appear here **before** the data is committed
or processed — see [PLAN.md](PLAN.md) §2.2 rule 4 and §5.8.

That rule exists because attribution is the price of the data, not a courtesy. Bavarian geodata is
free to use commercially and to redistribute; it is free *on condition* that the notice below
travels with it. Dropping the footer from a deployment is a licence breach, not a cosmetic
regression, which is why an end-to-end test asserts it is there.

---

## Attribution block (verbatim, app footer)

```
Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de [Daten bearbeitet]
© DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.
© OpenStreetMap contributors (ODbL)
```

The first two strings are **prescribed by their licences** and are quoted from
`config/aoi/<id>.json` rather than retyped in the interface, so there is one place they can be
wrong. The DWD line joins the block when the weather ingestion lands (§5.5, phase 5).

**The Open Glider Network is credited in the live panel rather than in this footer**, and shown
only while live positions are actually on screen. That is the same rule that took DWD out of the
block: a footer that credits a source the app is not reading is a statement about provenance that
happens to be false, and it makes the whole block worth less. Live traffic is intermittent by
nature — most of the time there is no relay and nothing to credit.

---

## Source register

| Source | Products used | Licence | Root URL | Status |
|---|---|---|---|---|
| **Bayerische Vermessungsverwaltung (LDBV)** | **DGM1** — 1 m terrain, 99 tiles for the core AOI · **LoD2 CityGML** — 30 tiles, 5 926 buildings · **Einzelbäume** — 3D tree cadastre, 222 908 trees in the core · **DOP20** — 20 cm orthophotos, drawn as a 1.2 m drape via the WMS | **CC BY 4.0** | <https://geodaten.bayern.de/opengeodata/> · tiles via <https://download1.bayernwolke.de/> · imagery via <https://geoservices.bayern.de/od/wms/dop/v1/dop20> | ✅ downloaded and structurally verified 2026-07-29 |
| **Copernicus DEM GLO-30** (ESA / DLR / Airbus DS) | 30 m global surface model, one 1°×1° tile read as a windowed COG for the coarse shell | Copernicus DEM **free licence** — worldwide, free reuse; commercial use not excluded; prescribed notice required | <https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/> | ✅ verified live 2026-07-28, anonymous access |
| **OpenStreetMap** | Land cover and transport network; settlements, peaks, aerialway lines and stations; free-flying launch sites and landing zones | **ODbL 1.0** — commercial use allowed, share-alike on derivative *databases* | <https://overpass-api.de/> | ✅ verified live 2026-07-28 |
| **Own IGC flight log** | One flight, 2021-04-24, 12 586 fixes | Author's own recording, released here anonymised | — | ✅ bundled, anonymised at import |
| **Deutscher Wetterdienst (DWD)** | ICON-D2 — cloud base, CAPE, cloud cover, surface wind and gusts, freezing level, and a five-level wind profile, clipped to the AOI and harvested forward into the Lakehouse | **GeoNutzV** — commercial use allowed with source attribution | <https://opendata.dwd.de/> | ✅ in use since phase 5, verified live 2026-07-29 |
| **Open Glider Network** | Live FANET/FLARM aircraft positions via APRS-IS (`aprs.glidernet.org:14580`, read-only); the device database for the opt-out flags | **ODbL 1.0**, plus two OGN rules: honour the DDB privacy choices, and **do not redistribute data older than 24 hours** | <https://www.glidernet.org/ogn-data-usage/> · DDB <https://ddb.glidernet.org/> | ✅ in use since phase 4, verified live 2026-07-29 |
| **SkyLines** | Fallback live-tracking source if the OGN spike disappoints | AGPL-3.0 | <https://skylines.aero/> | 🟡 evaluated only, not integrated |
| **foto-webcam.eu** (Keuschnig & Radlherr) | **Link only** — two cameras, at the Nebelhorn Gipfelstation and the Tegelberghaus, opened in a new tab from a marker in the scene. **No image is fetched, embedded, stored or altered by this app.** | **All rights reserved**, with one explicit permission: *"Die Inhalte und Bilder … dürfen ohne vorherige schriftliche Zustimmung weder als Ganzes noch in Teilen verbreitet, verändert oder kopiert werden. **Links auf diese Website und deren Unterseiten sind generell gestattet und auch erwünscht.**"* | <https://www.foto-webcam.eu/> · Impressum <https://www.foto-webcam.eu/impressum/> | 🟡 terms read and quoted 2026-08-02; positions in the AOI configs, renderer not built yet |
| **ok-bergbahnen / Panomax** | A second Nebelhorn camera (360°), found while surveying | Not read — **deliberately not adopted.** A licence is not inheritable from a neighbouring camera, even on the same summit | <https://ok-bergbahnen.panomax.com/nebelhorn> | ⛔ not used |

Rows marked 🟡 are registered ahead of use so that the register is a plan of record rather than a
retrospective. Nothing in the repo reads them yet.

⚠️ **The webcam row is a licence to LINK, and nothing more.** It is recorded here in the same
register as the data sources because it is the same kind of obligation, but the permission it
carries is unusually narrow: hotlinking the JPEG, drawing the image on the terrain, caching it, or
showing it inside the app would all need written consent that has not been asked for. If a future
change makes the app *display* a camera image rather than link to one, this row stops being
sufficient and the operator has to be contacted first.

---

## Is this usable commercially?

**Every source here permits commercial use.** None of them is non-commercial-only, and none of them
requires a negotiated agreement. But "open" is not one thing, and three of them carry conditions
that bite in a commercial setting rather than in a demo:

| Source | Commercial? | The condition that actually matters |
|---|---|---|
| LDBV Bayern | ✅ | CC BY 4.0 — attribution **and a link to the licence**, and modification must be declared |
| Copernicus DEM GLO-30 | ✅ | The **adapted-data** notice, verbatim. Not the same string as the unmodified one |
| OpenStreetMap | ✅ | ODbL **share-alike** — applies to a distributed Derivative Database, not to a rendered picture |
| Own IGC | ✅ | The author's own recording |
| DWD (planned) | ✅ | GeoNutzV — source attribution |
| **Open Glider Network** | ✅ ODbL | ⚠️ **No redistribution of data older than 24 hours**, and DDB privacy choices must be honoured |

⚠️ **The OGN 24-hour rule is the one that constrains the architecture**, and it is easy to breach by
accident: it costs nothing until someone stores the stream, and then it is breached silently. The
KQL retention is therefore **1 day** on raw fixes, and anything longer-lived is an aggregate
(`DailySummary`) rather than a position. See `fabric/kql/01_live_traffic.kql`.

⚠️ **ODbL share-alike is unresolved for the derived land-cover raster.** `landuse_2m.u8z` is built
from OSM and shipped with the app. If it counts as a **Produced Work** — a rendered map, in effect,
since it only ever colours pixels and no figure in the app reads it — attribution is enough. If it
counts as a **Derivative Database**, distributing it obliges the same ODbL terms on it. The reading
here is Produced Work, and it is the reading most rendered tiles rely on, but it is a judgement
rather than a certainty and it is worth confirming before anyone sells this. The same question
applies, more sharply, to the cableway geometry, which stays vector.

⚠️ **Licensing is not the only question live tracking raises.** OGN positions are the locations of
identifiable people; honouring the DDB opt-out is OGN's requirement, not a GDPR basis. A demo and a
product are in different positions here, and the difference is a legal question rather than a
technical one.

Two gaps to close before a commercial release, both small:

1. The footer names the Bavarian source but does not **link the CC BY 4.0 licence**, which the
   licence asks for. The URL is already in `config/aoi/*.json` as `licenceUrl`; it is simply not
   rendered.
2. The Copernicus **free-licence PDF** itself was not read end to end — the terms above come from
   ESA's published dataset page and its stated user obligations. Worth a lawyer's eye if this
   becomes a product rather than a demo.

**None of this is legal advice**, and none of it has been reviewed by anyone qualified to give it.

---

## Derived layers

Several things in the app are **computed** from those sources rather than taken from them. Each is
labelled as derived where it appears, because a derived figure that looks like a measurement is the
failure mode this project cares most about.

* **Core terrain** — DGM1 mosaicked and resampled to a 4 m grid (`tools/geodata/build_terrain.py`).
  Cells with no measurement are filled from the nearest measured cell and flagged in a nodata mask,
  never filled with a constant.

* **Terrain shell** — Copernicus DEM resampled onto the same UTM grid at 30 m
  (`tools/geodata/build_shell.py`) and shifted onto the core's vertical datum by an offset
  **measured in the overlap ring**. ⚠️ The two tiers do not measure the same surface: the core is
  bare earth on DHHN2016, the shell a surface model on EGM2008. The measurement splits accordingly
  — +3.16 m over all cells, which is canopy, and −0.07 m over open ground, which is datum. Only the
  datum component is removed. It is a seam alignment and **must not be cited as a geodetic datum
  determination**.

* **Land cover** — OpenStreetMap `landuse`, `natural` and `leisure` polygons plus the `highway` and
  `railway` network, rasterised to a 2 m class grid (`tools/geodata/build_landuse.py`) and shipped
  gzipped, because a class raster compresses roughly 27:1. It colours the surface and nothing else:
  no elevation, statistic or derived figure reads it. It also shows land cover **as mapped today**,
  which for a flight from 2021 is a caveat the app states rather than hides.

* **The cableway** — the Nebelhornbahn's ground track and its stations are from OpenStreetMap.
  ⚠️ **The height of the cable is not surveyed.** OSM does not record where the rope hangs, so it is
  interpolated between station elevations and lifted clear of the terrain. It is a schematic of
  where the cableway runs, not a measurement of where the rope is, and
  `tools/geodata/build_cableway.py` writes that sentence into the output.

* **Trees** — every tree is a real, individually surveyed tree from the LDBV `einzelbaeume`
  cadastre: its position and its height are measured (`tools/geodata/build_vegetation.py`).
  ⚠️ **The species is not.** The dataset records position, ground height and tree height, and
  nothing else — no species, no crown radius. So the crowns are drawn as one neutral form with the
  radius estimated from the measured height, and the app never names a species or implies one by
  drawing a recognisable silhouette. Every tree is *somewhere real and some real height*; what it
  looks like is a rendering convention.

* **The orthophoto drape** — DOP20 requested through the LDBV WMS at the extent of the generated
  heightmap (`tools/geodata/fetch_dop20.py`). The source is 20 cm; the drape is about 1.2 m per
  pixel, because the terrain beneath it is at 16 m posting and 20 cm over this AOI would be a
  two-gigapixel texture. Its acquisition date varies by tile and is not recorded per pixel, so it
  shows the ground *around* the time of flying rather than on any particular day.

  ⚠️ **This entry used to say "nothing is derived from it, and no figure anywhere in the app reads
  a pixel of it". That is no longer true, and the sentence has been removed rather than left to
  age.** Building roof colour is now read from these pixels — see below. No *figure* is derived
  from the imagery: nothing numeric, nothing measured, nothing the app states as a fact. What is
  derived is a colour.

* **Building roof colour** — measured from the drape above, per building, by
  `tools/geodata/roof_colour.py`. The pixels inside each building's LoD2 roof outline are sampled,
  green-dominant pixels are rejected as vegetation over the roof, the darkest and brightest fifths
  are trimmed, and the median is re-centred in brightness to take out the aerial sun so the
  renderer's own lighting is not applied twice. **99.3 % of Oberstdorf's buildings and 99.7 % of
  the Tegelberg's** got a colour this way; the rest fall back to the median of those that did.

  This is honest as far as it goes, and its limits should be stated. It is a **photograph taken on
  one morning**, not a survey of materials: a roof re-tiled since the flight is shown as it was, a
  roof in deep shadow is a weaker measurement than one in full sun, and the saturation lost to haze
  and JPEG compression is put back by a fixed gain rather than by colorimetric correction. It is
  *this roof's colour from the air*, which is a great deal more than the single invented terracotta
  it replaced, and rather less than a claim about the building's material.

  ⚠️ **Wall colour is NOT measured and is not presented as though it were.** A wall does not appear
  in a vertical aerial photograph, and OpenStreetMap carries `building:colour` for 1 of 4295
  buildings at Oberstdorf and 136 of 4242 at the Tegelberg — real, but far too sparse to colour a
  valley with. Walls therefore use a **regional render palette**: Alpine Bavarian is overwhelmingly
  white to cream with a minority of timber, varied per building by a stable hash so the same house
  looks the same on every load. It is a plausible convention, exactly like the tree silhouettes
  above, and it is not a measurement of anything.

* **Vertical speed** — derived from **pressure** altitude, not GPS altitude. GPS vertical error is
  several metres and largely uncorrelated between fixes, so differentiating it at 1 Hz produces a
  vario signal that is mostly invention. Pressure altitude is smooth, and while its absolute value
  is referenced to 1013.25 hPa rather than to the day's pressure, its *derivative* is exactly right.

* **Wind** — measured from the flight itself. Where the pilot flew a complete 360° turn, the circle
  drifted, and that drift is the wind at that altitude at that moment. There is no model and no
  forecast behind it. ⚠️ It exists **only where the pilot circled**: a glide contributes nothing, and
  altitude bands the flight never circled in stay empty rather than being interpolated across.

* **Live positions** — received, not derived. Position, altitude, climb rate, ground speed and
  course are reported by the aircraft's own instrument and passed through unchanged; the relay adds
  no smoothing and no dead reckoning, so an aircraft that stops being heard simply stops moving and
  is removed after three minutes. ⚠️ **This shows what the receiver network hears, not what is
  flying.** Reception is line of sight, and a paraglider low in a side valley disappears from the
  map while remaining very much airborne. ⚠️ Altitude is treated as orthometric, comparable with the
  terrain; if any transmitter in the chain reports ellipsoidal height instead, that aircraft sits
  tens of metres off. Nothing in the app measures anything from it.

* **The day's soaring conditions** — an ICON-D2 *forecast*, aggregated over the AOI, not an
  observation. ⚠️ **Cloud base is reported only where the model computes cumulus at all.** ICON-D2
  writes `0` where there is no shallow convection, and averaging those cells in produced a "cloud
  base" of 113 m on a day with cumulus at 3 080 m. The mean is taken over the cells where the
  parameter exists, and the **fraction of the area that had any** is shown beside it — a base over
  4 % of the valley is a different day from one over two thirds, and the app is not allowed to
  present them identically. ⚠️ There is **no historical weather**: DWD publishes a rolling ~24-hour
  window, so the archive begins the day the harvest does and nothing earlier can be reconstructed.
  Wind for a past flight comes from the flight itself, above.

---

## Privacy

An IGC file is personal location history — where somebody was, on which day, for how long, and how
they flew. Two rules follow, and both are enforced in code rather than by intention:

* **Bundled flights are anonymised at import**, not merely hidden in the interface.
  `tools/flights/anonymise_igc.py` blanks the pilot and glider records **and** redacts the logger
  serial from the IGC `A` record, which is a stable per-device identifier and the one that is
  easiest to miss — the first version of that script stripped it from the filename and left it in
  the file, which achieves nothing. The script re-reads what it wrote and deletes the output if any
  identifier survived.

* **A file the viewer drops in never leaves the browser.** It is parsed locally, and there is no
  upload path to disable. That is a design choice, not a limitation.

Live tracking honours the OGN device database **server-side**, in `server/ogn/ddb.js`: a `no-track`
device is dropped in the relay and never reaches the browser, a `no-identify` device is shown
without pilot or registration, and an unknown device is treated as anonymous rather than as
consenting. The in-band stealth and no-track bits in the APRS packet are honoured too, and they
outrank the database — they come from the aircraft itself, which the database may never have heard
of.

⚠️ **An unidentified aircraft is also given a new id.** Suppressing the registration is not enough
on its own: the device id is a stable hardware address and the OGN database is public, so a client
holding the real id could look the pilot up itself and the flag would mean nothing. Anonymous
aircraft therefore leave the relay under a salted hash, with the salt regenerated on every restart
— stable enough for a trail to accumulate during a session, useless for linking one session to the
next.

Of the 36 126 devices in the database on 2026-07-29, **350 had opted out of tracking and 472 out of
identification**, and the relay suppressed traffic within the first minute of its first run. This is
not a hypothetical rule being written for form's sake.

---

## What is not here

* **No scraped flight archives.** Own recordings and openly licensed samples only (PLAN §2.2.5).
* **No orthophoto imagery yet.** DOP20 is CC BY 4.0 like the rest of the LDBV catalogue and is
  registered above under that authority; it is simply not downloaded yet.
* **No airspace data.** Deferred (decision 11). If it lands, §2.2.2 governs how it is shown: any
  airspace geometry is illustrative and dated, and the app is not a navigation instrument.
