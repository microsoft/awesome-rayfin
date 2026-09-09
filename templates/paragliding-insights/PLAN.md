# Gleitschirm-Insights — Plan

> **Status** v0.2 — planning · **Owner** Alexander Korn · **Created** 2026-07-29 · **Revised** 2026-07-29 (decision rounds 2–4)
> **Repo** [`KornAlexander/Gleitschirm-Insights`](https://github.com/KornAlexander/Gleitschirm-Insights) — the app this gallery template was packaged from.
> **Lineage** scaffolded from `Flut-Insights` — same engine, different subject, opposite mood.

---

## 0. TL;DR

A **Fabric App** that turns the airspace over Oberstdorf and the Nebelhorn into a live, photoreal 3D flying map.

The terrain is real: LDBV DGM1 at 1 m, a 20 cm orthophoto drape, LoD2 buildings, individual trees from the Bavarian tree cadastre, and the Nebelhornbahn where it actually runs. The flying is real too: paraglider tracks from IGC logs, live traffic from the Open Glider Network when the sky cooperates.

**What it is for.** This is a *generic capability demo* — the subject is paragliding, but the point is what Fabric can do: Real-Time Intelligence, Direct Lake, Notebooks and Pipelines, and above all a **Fabric App** as the delivery vehicle. It has to survive being shown to any customer and being put on a conference stage. The Allgäu is the story that makes people lean forward; Fabric is what they take home.

Four things a person can do with it:

1. **Look at the mountain.** True scale — Oberstdorf at 813 m, the Nebelhorn ridge at 2 224 m, 1 400 m of relief between them.
2. **Replay a flight.** Drop in an IGC, watch the track draw itself coloured by climb rate, scrub the barogram, see where the thermals were — and see the **wind that flight actually flew in**, derived from the track itself.
3. **Watch who is flying right now.** Live gliders from FANET/FLARM, with climb rate, altitude and glide ratio.
4. **Ask it questions.** A voice and chat assistant over the same data.

Tone throughout: sunny, alpine, positive. **This is a sport, not an incident.**

---

## 1. Locked decisions

Three rounds of decisions, 2026-07-29. These are settled; changing one means revisiting this plan, not quietly coding around it.

### Round 1 — shape of the thing

| # | Decision | Choice |
|---|---|---|
| 1 | Repo | New repo `Gleitschirm-Insights`, scaffolded from `Flut-Insights`. The running Flut-Insights build is never touched. |
| 2 | Name / tone | Positive, sunny, sport framing. No remembrance screen, no disclaimer-first flow, no muted documentary palette. |
| 3 | AOI (phase 1) | Oberstdorf + Nebelhorn. *(Revised in round 4 — see decision 18.)* |
| 4 | Terrain realism | Full stack: DGM1 hillshade + ALKIS land cover + DOP20 orthophoto drape + LoD2 buildings + trees from `einzelbaeume`. Staged in that order. |
| 5 | Live source | Both. OGN (FANET + FLARM) via a relay in `server/`; IGC replay as the guaranteed fallback so the app is always demoable. |
| 6 | Historical flights | Own IGC files. *(Revised in round 3 — see decision 16.)* |
| 7 | Fabric depth | Lakehouse + Direct Lake semantic model for flight statistics **and** Eventhouse/RTI for live telemetry. |
| 8 | Language | German default, English toggle — the existing `src/i18n/` carries over unchanged. |

### Round 2 — purpose and fidelity

| # | Decision | Choice |
|---|---|---|
| 9 | **Audience** | Generic capability demo for **any** customer, *and* a conference talk / community demo. Not built for one account. |
| 10 | **Meteorology** | In scope, full: wind field, thermal conditions, cloud base. Source DWD ICON-D2. *(The archive problem and its resolution: §5.5.)* |
| 11 | **Airspace** | Later phase. Deferred deliberately — §2.2.2 governs it if it lands. |
| 12 | **Camera** | Observer camera first; free-fly camera as the follow-on. |
| 13 | **Sky** | Gradient sky + aerial haze on distant ridges. **No HDRI, no volumetric cumulus.** Scope is bounded on purpose. |
| 14 | **Deployment reach** | Fabric App, shared with customers and colleagues. Not published to the open internet. |
| 15 | **Mode priority** | **Replay leads.** Live traffic is a bonus if the sky cooperates — so the fallback must be first-class, not an apology. |

### Round 3 — the Fabric story, and the details that change architecture

| # | Decision | Choice |
|---|---|---|
| 16 | **IGC source** | The local archive `E:\Alex\01. Privat\02. Paragliding\igcs` first (inventoried — §5.4); DHV-XC via Playwright only if that is not enough. |
| 17 | **Hero capability** | All four: Real-Time Intelligence / Eventhouse · Direct Lake · Notebooks + Pipelines (the weather ingestion) · Fabric App / Rayfin as the delivery vehicle. **"Fabric App is the main point."** |
| 18 | **Voice assistant** | Yes — reuse the Azure AI Foundry realtime voice + chat assistant from the ancestor repos. |
| 19 | **Drone mode** (the free camera) | No terrain collision, no simulated wing physics. Fly through the mountain if you want to. It is a camera, not a simulator. **Named "drone mode" from 2026-07-29**, in the interface and in the code — "free camera" described what it is not, and everyone was going to call it the drone anyway. |
| 20 | **Deadline** | None. Build it properly. |
| 21 | **Second site** | Yes — a second AOI ships, to prove the AOI-as-config architecture on stage. |

### Round 4 — consequences of looking at the actual data

| # | Decision | Choice |
|---|---|---|
| 22 | **AOI structure** | **Two-tier.** High-resolution photoreal core (8 × 9 km) inside a coarse terrain shell (~30 × 33 km) so a real cross-country flight never runs off the edge of the map. §4.1. |
| 23 | **Second site** | **Tegelberg / Schwangau.** Same LDBV pipeline, its own cableway, and a landmark nobody needs introduced. §4.4. |
| 24 | **Pilot identity** | **Anonymous.** No pilot name anywhere, including Alexander's own flights. They ship as *"Beispielflug"*. §2.2.3. |
| 25 | **Cableway** | Render the Nebelhornbahn — cable line and stations, from OSM. It is how every pilot gets to launch, and it anchors the scene. §5.7. |

### Round 5 — looking out of the window *(added 2026-07-30)*

| # | Decision | Choice |
|---|---|---|
| 26 | **Live webcams** | **Yes, as markers in the 3D scene** — placed at the camera's real position and clickable to open the live image. **Hard gate: no camera ships until its licence is checked and written into `NOTICE.md`.** §5.9. |
| 27 | **Live wind** | **Yes, at the launches** — but **not** from the OGN feed. Measured 2026-07-30: one reporting station in a 70 km radius covering both AOIs, inside neither core. A real station network is needed. §5.10. |
| 28 | **Building colour** | **Roofs measured from the DOP20 orthophoto the app already ships** — 99.3 % / 99.7 % coverage, no new download. The LoD2 survey records no colour at all and OSM has it for 0.02 % of buildings here. **Walls are a regional palette and are labelled as not measured.** §5.11. |

---

## 2. Principles

### 2.1 The framing rule

The feeling to hit is **"a good day in the Allgäu"** — high pressure, cumulus over the Nebelhorn, thermals working by ten.

Palette: real orthophoto colour, warm sun, blue sky gradient, soft haze on the far ridges. Copy is active and enthusiastic — *"1 850 m über Grund"*, *"+3,2 m/s"*, *"Basis heute 2 900 m"*. Real umlauts and ß throughout. No alarm styling anywhere; airspace or terrain proximity is informational, never a siren.

⚠️ **This is the one place the inheritance from Flut-Insights actively fought the brief, and it took a deliberate pass to undo.** That app's palette was muted, unsaturated and paper-like *on purpose* — it would have been glib to render the night of the flood in cheerful greens. Every one of those constants carried over and quietly said the wrong thing here: a grey mountain is a claim about the weather, and the day this is built around was a 1 900 m climb to 2 692 m in April. The pass that fixed it:

- **Warm sun, cool shadow.** Shading was one neutral grey ramp. It is now tinted — warm where the sun reaches, blue where only skylight does — which is both what happens outdoors and the single cheapest change that makes a render read as sunny rather than overcast.
- **A high ambient floor** (0.68, against 0.58). On a clear day the sky is an enormous light source and Alpine shadows are bright and blue. A low floor is what makes rendered mountains look like bad weather.
- **Brighter albedo** across the hypsometric ramp and the land cover — spring pasture, spruce, sunlit limestone.
- **A real gradient sky** (decision 13), replacing a flat clear colour. Bounded scope: a gradient and a broad sun glow, no HDRI and no volumetric cumulus.
- **Buildings shaded per face**, from screen-space derivatives of world position. The mesh carries no normals and adding them would inflate the download by half; derivatives give exact flat-shaded normals for free, which is all a LoD2 building needs because its faces *are* flat.

The ceiling rule from §8 still holds and is now enforced by construction: `ambient + gain ≤ 1.0`, and no tint exceeds 1.0 in any channel, so nothing can clip to white.

The sun direction, the two tints, the light ramp, the sky colours and the haze colour are **one shared set of constants** used by the terrain, the shell, the buildings and the sky. They were literals repeated per shader, which is fine until one is edited — at which point the tiers light differently and the boundary between them glows.

### 2.2 Non-negotiable rules

1. **Privacy first — honour the OGN opt-out.** The device database carries per-device flags: `no-track` means *do not display at all*; `no-identify` means *show the aircraft but never the pilot or registration*. **Enforced in the relay, server-side**, so a flagged device never reaches the browser. An unknown device is treated as anonymous.

2. **Not a navigation instrument.** Persistent footer note, DE + EN: *"Demonstrations- und Anschauungszweck. Keine Navigations- oder Flugvorbereitungsgrundlage. Für die Flugvorbereitung gelten ausschließlich die amtlichen Quellen (DFS, AIP, NOTAM)."* Any airspace geometry shown is illustrative and dated.

3. **No identifiable pilots — including the author.** Statistics are aggregate; a leaderboard of named humans is out, *"how did the day go"* is in. Decision 24 extends this to the bundled flights: an IGC is personal location history — where somebody was, on which day, for how long. Ours ship **anonymised**, labelled *"Beispielflug"*, with the `HFPLT` pilot record stripped at import. It is the consistent position, and it means the question never has to be answered awkwardly on stage.

4. **Attribution is mandatory.** Every source registered in `NOTICE.md` before it is used (§5.8). Bavarian geodata is CC BY 4.0 — free, but the attribution is the price.

5. **No redistribution of scraped flight archives.** Own IGCs and openly licensed samples only.

6. **No invented data.** Inherited from Flut-Insights and the reason §5.5 is written the way it is. If a source does not exist, the app says so rather than interpolating something plausible. A demo that quietly fabricates is worse than a demo with a gap.

---

## 3. The experience

One scene, one time scrubber, several modes on the same map.

### Mode A — **Das Gelände** *(phase 1, ships first)*

The mountain, alone. Photoreal Allgäu on a true-scale 1 m terrain model. Oberstdorf in LoD2, forest as real trees, the Nebelhorn ridge line where it actually is, the Nebelhornbahn climbing out of the valley. Orbit, zoom, fly.

**Deliberately the first shippable thing.** If this does not look good, nothing built on top of it will.

Named on the map: Oberstdorf, Nebelhorn (2 224 m), Höfatsblick, Koblat, the Trettachtal.

**Camera** (decision 12 + 19): the **observer camera** ships first — orbit, pan, zoom, framed presets for the summit, the valley and the launch. **Drone mode** follows: WASD-style flight with **no terrain collision and no wing physics**. It is a camera, not a simulator; flying through a ridge is allowed and is not a bug. What it does have is mass, a throttle and an altimeter — see phase 3.

### Mode B — **Der Flug** *(phase 2 — the lead mode)*

Decision 15 puts replay first, so this is the mode the app opens in and the mode a demo starts with.

Drop an IGC file — or pick one of the bundled anonymised flights. The track draws itself as a ribbon through the valley, coloured by vertical speed (blue sink → white → orange climb). A barogram runs underneath, linked to the same scrubber. Thermal cores show as helices where the pilot circled. The camera can lock to the glider, to the valley, or stay free.

**And the wind.** Where the pilot circled, the circle drifted — and that drift *is* a wind measurement. Stack those measurements by altitude and the flight yields its own wind profile: speed and direction at every height it visited, labelled *"aus dem Flug abgeleitet"*. No model, no archive, no invention. §5.5 explains why this is the honest answer rather than a compromise.

### Mode C — **Jetzt in der Luft** *(phase 3 — the bonus)*

Live gliders as the network reports them: position, altitude, climb rate, ground speed, aircraft type. Click one, follow it. Trails fade over the last 20 minutes.

When no live traffic is in range — which in the Allgäu means most winter evenings, and quite possibly the moment you are on stage — the app **falls back to Mode B**, clearly badged *"Aufzeichnung"*. Decision 15 makes that fallback a first-class path, not an error state: it is tested, it is styled, and it is what most viewers will actually see.

### Mode D — **Der Tag** *(phase 5, Fabric)*

Aggregate: how many flights, how high the day went, where the climbs were, which hour worked, what the wind did. Driven by a **Direct Lake** semantic model over the flight lakehouse — one of the four named hero capabilities.

### Mode E — **Frag den Berg** *(phase 6)*

Voice and chat assistant over the same data (decision 18) — Azure AI Foundry realtime, reused from the ancestor repos. *"Wie hoch war die Basis am 24. April?"* · *"Zeig mir den stärksten Bart des Tages."* · *"Wo ist der Startplatz?"* The assistant can move the camera, set the scrubber and switch modes, so it is a way of driving the app rather than a chat window bolted onto the side.

### Mode F — **Jetzt am Berg** *(phase 9 — decisions 26 and 27)*

The one question every pilot actually asks first, and the one thing a terrain model cannot answer: **what is it like up there right now?**

Two layers, both anchored to real positions in the scene rather than parked in a side panel:

* **Webcams.** A small marker stands at the camera's surveyed position, oriented along its actual view direction. Click it and the live image opens. Standing *inside the model* at the same spot and comparing it with the photograph is the strongest thing this app can do: it is the model checking itself against reality, live, in front of the audience.
* **Wind at the launches.** Direction, mean and gust at the launch sites and the summit, as a windsock or arrow at the place it was measured — not a number floating over the valley. This is the missing half of Mode D: the forecast said what the day *should* do; the station says what it *is* doing.

Both are **live ground truth**, and that is exactly why they are dangerous. Everything else in this app comes from a survey and is reproducible; these two are read from somebody else's sensor, over the network, at the moment you look. So they carry the same rules as Mode C: **stale is not shown as current, missing is said out loud, and nothing is interpolated.** A wind arrow with no reading behind it is worse than no wind arrow, for the same reason a borrowed flight track was worse than no flight.

---

## 4. Area of interest

### 4.1 Two-tier structure *(decision 22)*

The archive scan (§5.4) settled this. The one flight in Alexander's logs that reaches Oberstdorf spans **47.3646 – 47.5412 N / 10.1653 – 10.3887 E** — roughly 20 × 17 km. The original 8 × 9 km box contains **24 %** of it. A track that flies off the edge of the terrain looks broken, and enlarging the photoreal box to fit would multiply the DOP20 download by four or five.

So the map has two tiers:

| Tier | Extent | Source | Posting | Content |
|---|---|---|---|---|
| **Core** | 8.0 × 9.1 km | LDBV DGM1 | 4 m render / 16 m mesh | DGM1 + DOP20 20 cm drape + LoD2 buildings + individual trees + cableway |
| **Shell** | ~30 × 33 km | Copernicus DEM GLO-30 | 30 m source / ~80 m mesh | Terrain only, hypsometric + hillshade, fading into aerial haze |

The shell is not just a container for long flights — it is the **horizon**. A photoreal box that ends in a cliff of nothing reads as a diorama; the Alps continuing into the distance read as the Alps. Decision 13 already committed to aerial haze, and the shell is what the haze is applied to.

**Core** (`config/aoi/oberstdorf.json`, EPSG:4326):

| | |
|---|---|
| west | **10.274** |
| east | **10.380** |
| south | **47.355** |
| north | **47.437** |

Everything that matters is inside it: Oberstdorf centre, the Nebelhorn summit, Höfatsblick, and both ends of the Nebelhornbahn (valley station ≈ 10.285 E — comfortably inside the western edge). All of it is Bavarian territory, so LDBV covers it completely.

**Shell:** west **10.10** · east **10.50** · south **47.30** · north **47.60** ≈ 30 × 33 km. This deliberately crosses into **Austria** (Kleinwalsertal, Tirol), where LDBV stops — which is precisely why the shell uses a pan-European source instead of stitching a second national portal onto the fetcher (§5.2).

Working CRS **EPSG:25832** (UTM 32N — the existing `tools/geodata/utm.py` is valid for Bavaria unchanged). Vertical datum **DHHN2016** for the core. Relief range ≈ 800 m → 2 224 m in the core, up to ~2 650 m in the shell. **True scale, and not adjustable** — the vertical-exaggeration lever was removed in full (2026-07-29): uniform, per-layer setters, config key and UI. It existed because the Ahr AOI needed help to make 85 m of relief readable; an Alpine valley with 1 400 m of it does not, and the only thing the lever could do here was make an honest mountain look like a video game.

⚠️ **The two tiers do not share a vertical datum.** DGM1 is DHHN2016 bare earth; Copernicus DEM is EGM2008 and is a **DSM** (canopy and buildings included). Two consequences, both handled rather than ignored:
- **Datum offset:** measure the mean difference in the overlap ring and shift the shell by it. Do not assume zero.
- **Surface vs. terrain:** the shell sits a tree-height high. At 30 m posting and 10 km away this is invisible; at the seam it is not. Blend across a transition ring rather than butting the two together.

### 4.2 Focus places — **verified, not recalled**

Resolved from OpenStreetMap, 2026-07-29. *(The prior Flut-Insights lesson applies: a recalled coordinate for Oberstdorf was 4.4 km off, which would have framed the camera on the wrong valley. Nothing goes into config that was not looked up.)*

| id | name | lat | lon | source |
|---|---|---|---|---|
| `oberstdorf` | Oberstdorf | 47.3708539 | 10.3119292 | OSM |
| `nebelhorn` | Nebelhorn | 47.4218727 | 10.3423461 | OSM |
| `hoefatsblick` | Höfatsblick (Bergstation, `aerialway=station`) | 47.4139230 | 10.3465665 | OSM |
| `nebelhornbahn_tal` | Nebelhornbahn, Talstation vicinity | 47.4049420 | 10.2854139 | OSM (ticket office node) |

Outside the core box, inside the shell, kept for the later extension: Söllereck 47.3716886 / 10.2356574 · Fellhorn 47.3449986 / 10.2236908.

⚠️ **Still open:** the launch sites proper (Nebelhorn Gipfel, Koblat) and the official landing zone need real coordinates from OSM (`aeroway=*`, `paragliding` tags) or the DHV site database, and the Nebelhornbahn valley station needs its actual `aerialway=station` node rather than the ticket office beside it. **Resolved in phase 2 from Overpass — not invented.**

### 4.3 Grids and budget

Core: source 1 m · render 4 m · mesh decimated 4× → **16 m posting**, ≈ 285 k vertices — comfortably inside the budget the Ahr AOI proved out.

Shell: source 30 m · render 30 m · mesh decimated ~3× → **~90 m posting**, ≈ 120 k vertices. Cheap, and it buys the horizon.

#### Can the core cover the whole valley? *(measured 2026-07-29, `tools/geodata/coverage_probe.py`)*

Yes — but not by scaling everything up, and the thing that stops it is not the one you would guess.

| | current core | valley + Söllereck | whole valley system |
|---|---|---|---|
| Extent | 9.4 × 8.3 km · 78 km² | 12.8 × 10.6 km · 135 km² | 15.1 × 14.4 km · 218 km² |
| LDBV DGM1 tiles available | 99/99 | 166/168 | **253/272 (93 %)** |
| Mesh vertices | 307 k | 528 k | 851 k |
| Heightmap VRAM | 10 MB | 17 MB | 27 MB |
| Land cover VRAM | 20 MB | 34 MB | 54 MB |
| Trees | 223 k | 384 k | 618 k |
| **Drape VRAM at 1.17 m/px** | **306 MB** | **527 MB** | **848 MB** |

⚠️ **The drape is the entire constraint.** Everything else grows by a factor the GPU will not
notice — the measured scene has ≥3× fragment headroom, vertices are one draw call, and the trees
are already chunk-culled per kilometre so off-screen forest costs memory and not draw time. The
orthophoto is different: it is 306 MB of texture *today*, and holding its ground resolution across
2.8× the area asks for 848 MB, which is where a laptop's shared memory stops being amusing.

**The fix is to budget the drape in pixels rather than in metres.** Keeping today's 8192 × 7272 and
spreading it over the whole valley gives **1.91 m/px** — identical VRAM, identical 12 MB download.
And it costs almost nothing visually: the mesh posting is 16 m, so even at 1.91 m the photo is still
eight times finer than the geometry it is painted on. The only place the difference is visible is
drone mode below ~100 m AGL.

**Austria is a smaller problem than expected.** The west side of this valley is Vorarlberg and LDBV
stops at the border, but only **19 of 272** tiles are missing — the Kleinwalsertal and the western
Fellhorn flank. The German valley is essentially fully surveyed, and the shell already covers the
Austrian side.

⏳ **Not done:** first load would go from 37 MB to roughly 90 MB, which is the real reason this is a
decision rather than a setting. Two things to fix first — `heightmap_4m_nodata.u8` ships **4.85 MB
uncompressed** while the land-cover raster beside it gets 27:1 out of gzip for the same kind of
content, and the heightmap itself is served raw.

### 4.4 Second site — Tegelberg / Schwangau *(decision 23)* — **built 2026-07-29**

`config/aoi/tegelberg.json`, shipped to prove that the AOI is genuinely configuration and not a set of constants that happen to live in a JSON file. Same state, same LDBV pipeline, **zero new fetcher work** — including the shell, which falls inside the same Copernicus `N47_E010` tile Oberstdorf already uses.

Verified from OSM via `tools/geodata/probe_site.py`, 2026-07-29 — 140 elements, every id looked at:

| id | name | lat | lon | OSM |
|---|---|---|---|---|
| `hohenschwangau` | Hohenschwangau | 47.5551938 | 10.7394834 | node/75901923 |
| `neuschwanstein` | Schloss Neuschwanstein | 47.5575482 | 10.7495224 | way/221601969 |
| `tegelberg_berg` | Tegelbergbahn (Bergstation) | 47.5596223 | 10.7789855 | node/266995159 |
| `tegelberg_tal` | Tegelbergbahn (Talstation) | 47.5681888 | 10.7562201 | node/266995158 |
| `saeuling` | Säuling (2048 m) | 47.5349891 | 10.7552771 | node/495075191 |

**The proposed box was wrong and was corrected before use.** The draft above suggested 10.700–10.820 / 47.520–47.610 and said Neuschwanstein and Hohenschwangau were "very likely" inside — exactly the assumption §4.2 forbids. Probing first moved the box to **10.705–10.805 E / 47.525–47.590 N** (≈ 7.5 × 7.2 km): the northern strip was spent on farmland, while the Säuling — the dominant peak and the Tirol border — sat 5 km south of the drafted southern edge.

The probe also found paraglider infrastructure at 47.606–47.613 / 10.799–10.811. It is **not** Tegelberg's: it belongs to Buching / Buchenberg, 6 km NE. `flyingSites` therefore ships empty rather than plausible.

Measured result: 66 of 72 DGM1 tiles published (92 %), terrain 1922 × 1849 at 4 m, 93.2 % coverage, 773.16–2047.05 m. **Registration check passed** — modelled Säuling 2046.7 m against a published 2048 m (Δ −1.3 m), 33 peaks, median −0.94 m. 3736 LoD2 buildings, 229 007 trees, land cover 93.5 % mapped, drape 0.94 m/px. Every asset is smaller than Oberstdorf's.

Built **after** the Oberstdorf core was finished. It is a proof, not a second project.

#### What the second site actually proved *(and it was not what the phase expected)*

The swap itself was undramatic. The value was in five things that **silently did not swap**, every one of which produced a page that looked entirely normal:

1. **The guided tour** was a constant in `src/twin3d/tour.ts` listing Oberstdorf place ids. `createTour` skips stops the AOI does not have — good behaviour on its own — so the second site got a tour of *zero* stops: a button that ran, did nothing, and reported no error. Tours are now per-AOI config.
2. **The flight loader** took `flights[0]` from a global index, so a site whose config says it has no flight displayed the *other* site's 98 km cross-country — scrubber, barogram and all — drawn through terrain 35 km from where it was flown. Now keyed by `flights.heroFlight`.
3. **The cable-car layer toggle** read "Nebelhornbahn" on a mountain served by the Tegelbergbahn. Now "Seilbahn" / "Cable car".
4. **The tab title** named Oberstdorf whichever site was open. Now set from the AOI.
5. **The canvas `aria-label`** — the only description of the map a screen-reader user gets — also named Oberstdorf, and additionally had no `role`, so the label was ignorable. Now interpolated and `role="img"`.

All five are covered by `e2e/aoi.spec.ts`, which asserts *content per site* rather than the switcher widget: a test that only checked the dropdown had two entries would have passed against all five bugs.

#### Two more, found straight afterwards — in the parts the browser cannot check

The five above are all in the front end, and all were found by opening the page. The next two were not, because both live on the other side of a network boundary where the app simply believes what it is told.

6. **Mode D aggregated every site at once.** `tools/fabric/export_day.py --aoi` selected *nothing*: it named the output file and stamped the JSON, while the DAX summed the whole `Wetter` table. With one site loaded that is accidentally correct, which is how it passed phase 5 and a review. With two it averages two mountain ranges 35 km apart and writes the result into a file that names one of them — and **Mode E then quotes those numbers as measured fact**. Every query is now filtered on `'Wetter'[Gebiet]` / `'Flug'[Gebiet]`, from an id validated against `config/aoi/` before it reaches a DAX string.

    Verified rather than assumed, in three steps: the filtered queries run; the Oberstdorf payload is **byte-identical** to the pre-fix one (no regression); and exporting `--aoi tegelberg` now returns *zero rows* and refuses to write a file. That last one is the proof the filter discriminates — before the fix, the same command would have written `tegelberg.json` full of Oberstdorf's weather.

7. **The live relay's AOI was independent of the browser's.** `server/ogn/relay.js` takes its own `--aoi` and had no way to say which one, so pointing a Tegelberg page at an Oberstdorf relay produced real, correctly decoded, live aircraft plotted onto the wrong mountain. Nothing about it looks like a failure — the trails even move. The relay now announces `area.id`, and the client refuses a mismatch outright: no markers, and a `wrong-area` state that names the fix. A relay too old to announce its area is still trusted, since an absent field is not a claim.

    ⚠️ **Tested against a stub, not the live sky, and deliberately so.** Running the mismatch for real at midnight proves nothing: the relay holds zero aircraft, so the guard passes without ever refusing anything. `src/live/__tests__/wrongArea.test.ts` sends aircraft on demand, so "the traffic was refused" is asserted rather than being an accident of the hour.

**Mode D is absent on the Tegelberg, on purpose.** It has no weather rows, and the panel simply does not render — the same choice as its missing flight. Giving it Mode D is a one-off harvest and load whenever it is wanted; it needs no schedule and no standing resource.

---

## 5. Data sources

### 5.1 Core terrain and imagery — LDBV Bayern *(verified 2026-07-29)*

All products below are **CC BY 4.0**, attribution *Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de*.

Catalogue: `https://geodaten.bayern.de/opengeodata/` → `json/opengeodata_produkte.json` (35 products). Per-municipality **Metalink XML** catalogues carry per-tile size, SHA-256 and two mirrors (`download1/2.bayernwolke.de`) — **architecturally identical to the Rhineland-Palatinate pattern `fetch_dgm1.py` already parses.**

| Product | Metalink route under `https://geodaten.bayern.de/odd/` | Tile | Est. for the core |
|---|---|---|---|
| **DGM1** 1 m terrain | `a/dgm/dgm1/meta/metalink/<AGS>.meta4` | 1 km GeoTIFF, ~3.3 MB | ~85 tiles, **~280 MB** |
| **DOP20** 20 cm orthophoto | `a/dop20/meta/metalink/<AGS>.meta4` | 1 km GeoTIFF, ~60 MB | ~85 tiles, **~5 GB raw** ⚠️ |
| **LoD2** buildings | `a/lod2/citygml/meta/metalink/<AGS>.meta4` | 2 km CityGML | ~8 tiles, **~90 MB** |
| **einzelbaeume** single trees | KML index `m/8/baeume3d/kml/Einzelbaumstandorte.kml?service=kml` | — | small |
| **tatsaechlichenutzung** ALKIS land use | `m/3/daten/tn/Nutzung_kreis.gpkg` | — | moderate |

Tile filenames encode **UTM32 easting/northing in km** (`595_5259.tif`) → the tile list is derived arithmetically from the bbox; the Metalink catalogue supplies the **hashes and mirrors**, not the discovery. Direct tile URL confirmed working: `https://download1.bayernwolke.de/a/dgm/dgm1/595_5259.tif`.

⚠️ **AGS caveat.** `09780139` returns 74 tiles ≈ 74 km², but Oberstdorf municipality is ~230 km² — so that AGS is probably a *neighbouring* Oberallgäu municipality. **Resolve in phase 1**, or side-step it entirely by driving tile selection from the bbox and taking hashes from the Landkreis-level catalogue.

~~⚠️ **DOP20 is the resource risk.** 5 GB raw for the core, needing a streaming tile-by-tile fetcher.~~ **Wrong — resolved in phase 1.** DOP20 is not tile-addressable at all; it is served by **WMS** (`by_dop20c`), so the drape is a single request at the resolution you ask for and the whole thing costs **12.8 MB**. No streaming, no mosaic, no temp-file dance. ⚠️ The trap is that a generic layer name (`DOP20`, `dop20`) returns a **5 KB placeholder image** rather than an error — a failure that looks like success until you open it.

### 5.2 Shell terrain — Copernicus DEM GLO-30 *(verified 2026-07-29)*

Chosen because the shell crosses the Austrian border and a pan-European source has no seam there, where stitching Vorarlberg and Tirol portals onto the fetcher would have been three sources and three licences for terrain nobody looks at closely.

- **Access:** AWS Open Data, anonymous, no key. `https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/Copernicus_DSM_COG_10_N47_00_E010_00_DEM/Copernicus_DSM_COG_10_N47_00_E010_00_DEM.tif`
- **Verified:** HTTP 200, `image/tiff`, **39.8 MB**, 1° × 1° tile. A 90 m variant exists at 4.9 MB if 30 m proves excessive.
- **One tile covers the entire shell** (N47/E010 spans 47–48 N, 10–11 E). It is a **Cloud-Optimized GeoTIFF**, so the fetcher range-requests the AOI window instead of pulling 40 MB.
- **Licence:** free reuse with attribution — *"© DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018 provided under COPERNICUS by the European Union and ESA."* Registered in `NOTICE.md` before first use.
- **Caveats** (both handled in §4.1): it is a **DSM**, not bare earth, and it is on **EGM2008**, not DHHN2016.

### 5.3 Live tracking — Open Glider Network

**What OGN actually carries:** FLARM (sailplanes) **and FANET** — which is what Alpine paraglider instruments transmit: Skytraxx, XCTracer, Naviter, Burnair. Oberstdorf/Nebelhorn is well covered by receivers.

- Transport is **APRS-IS over TCP** (`aprs.glidernet.org`, filtered port `14580`, full feed `10152`) → **not reachable from a browser.** Needs a relay: the repo already has `server/`, so the relay lives there and re-broadcasts to the app over WebSocket/SSE.
- The device database (DDB) is fetched at relay start and refreshed periodically for the privacy flags (§2.2.1).
- ✅ **Phase-4 spike passed 2026-07-29.** Host, port and filter syntax confirmed; 5.9 reports/s over a 23 km radius; 7 paragliders airborne. See phase 4 for the two findings that changed the design — the transmitter prefix does not identify a paraglider, and one aircraft arrives under two callsigns.

Because decision 15 demotes live traffic to a bonus, a disappointing spike result is **survivable** — it costs the app a mode, not its reason to exist.

**Alternatives evaluated:** SkyLines (`skylines.aero`, AGPL-3.0, `skylines-project/skylines`) is a real open live-tracking + flight-database platform and is the fallback. Livetrack24 and PureTrack are further options; XContest Live is access-restricted. None of their HTTP APIs are verified yet.

#### Hosting the relay — the one long-lived process this project needs *(2026-08-01)*

Mode C had never worked on the **published** app, only in dev. The reason is structural rather than a bug: the deploy is static hosting, APRS-IS is a persistent TCP connection, and the browser is fed by Server-Sent Events. Neither end survives a request/response function, so this is the one component that genuinely justifies a container.

Shipped as an **Azure Container App**, `ca-gleitschirm-relay` in the existing `cae-flutinsights-swc` environment (Sweden Central, the same region as the Fabric app — no cross-region hop, and no new environment to pay for).

| setting | value | why |
|---|---|---|
| min / max replicas | **0 / 1** | scale to zero when nobody is looking; **max 1 because each replica would hold its own APRS connection**, and two viewers would then see different subsets of the sky |
| resources | 0.25 vCPU, 0.5 GiB | the relay has **zero npm dependencies** — node builtins only |
| ingress | external, CORS pinned to the published origin | the stream is public and anonymised, but there is no reason to let any origin embed it |

**Cost.** Container Apps consumption bills vCPU-seconds and GiB-seconds against a monthly free grant (shared across the subscription). Continuously running would be roughly **€10–15/month** at list prices; with scale-to-zero it only runs while a browser is connected, which for demo use is minutes a day and lands **inside the free grant** — call it **≈ €0**. The registry and the environment already existed. *(List-price estimate, not a quoted bill.)*

The trade-off is honest and worth stating: **scale-to-zero means no history.** The relay keeps 20 minutes of trails while it lives, so the first viewer after an idle period gets a sky that fills in over the following minute rather than one that is already populated. Paying ~€12/month would fix that, and for a demo it is not worth it.

⚠️ **The wrong-area guard nearly rejected the only relay that can work.** A relay has one upstream filter and announces one area; since phase 8 the browser's active site *changes as the camera flies*. Matching on the site id alone would have refused the correct relay at whichever site it was not named after — live traffic silently missing at one of the two, with the panel confidently explaining that the relay was watching somewhere else. So the relay now takes `--world`, filters on the union (**r/47.51/10.525/40 km**, spanning both sites) and announces the **world** id; the client accepts its own site id *or* its world's.

### 5.4 Historical flights — IGC *(archive inventoried 2026-07-29)*

The local archive at `E:\Alex\01. Privat\02. Paragliding\igcs` holds **20 flights**, all XCTracer, 2021-04 to 2022-04. Every one was parsed and tested against the AOI. The result reshaped §4.1:

| Flight | Points | Extent | Alt (m) | In core | Note |
|---|---|---|---|---|---|
| **2021-04-24** | 12 586 | 47.365–47.541 N / 10.165–10.389 E | 797 – **2 692** | **24 %** | The Allgäu XC. **The hero flight.** |
| 2021-04-25-03 | 1 329 | 47.457–47.465 N / 10.203–10.238 E | 875 – 1 713 | 0 % | ~7 km NW of the core; inside the shell. |
| 8 × Swabian Alb | — | 48.55 N / 9.40 E | 420 – 958 | — | Home site. Out of area. |
| 2021-08-12-02 | 11 383 | 46.82–47.00 N / 11.80–12.08 E | 955 – **3 592** | — | Tyrol. Highest in the archive. |
| others | — | Tegernsee, Chiemgau, Dolomites, Rheintal | — | — | Out of area. |

**Consequences:**
- **`2021-04-24` is the demo flight.** 12 586 points, nearly 1 900 m of height gain, 20 km of ground — and with the shell in place it now fits on the map end to end.
- **Bundled anonymised**, per decision 24: `HFPLT` stripped at import, shipped as *"Beispielflug 24. April"*.
- The archive is **thin for Oberstdorf specifically** — one flight. If Mode B needs variety (several flights on one day, a thermal heat map that is not a single line), that comes from **DHV-XC via Playwright**, per decision 16. `.gitignore`d output, **never committed with data**, login requested from Alexander rather than automated around.
- Parsing happens **entirely in the browser** for drag & drop. No upload, no server, no licensing question.

### 5.5 Meteorology — and the archive problem *(decision 10; resolution delegated, "you decide")*

Decision 10 put wind, thermals and cloud base in scope from DWD ICON-D2. Investigation turned up a hard constraint:

> **DWD OpenData publishes ICON-D2 as a rolling ~24-hour window, not an archive.**

There is no free way to fetch the wind field over the Nebelhorn for **24 April 2021**. Overlaying a model wind on a flight from last spring would mean inventing it — which §2.2.6 forbids. So the answer is two tracks, and neither of them pretends:

**Track 1 — historical wind comes from the flight itself.** *(Ships with Mode B, phase 2.)*
When a pilot thermals, the circle drifts downwind. Fit the drift vector across each full 360° turn and you have wind speed and direction **at that altitude, at that moment, measured**. Stack them up the climb and the flight yields its own wind profile.

This is not a workaround. It is:
- **honest** — measured from the actual flight, not modelled onto it;
- **zero-dependency** — no API, no key, no archive, no ingestion job, works offline;
- **universal** — every historical flight carries it, including flights from ten years ago;
- **what pilots actually do** — reading drift is basic airmanship, so it is legible to the audience who knows the sport.

Labelled *"aus dem Flug abgeleitet"*, with an honest confidence indicator: it only exists where the pilot circled, so gliding legs have no wind data and the app says so rather than interpolating.

**Track 2 — ICON-D2 is harvested forward into Fabric.** *(Phase 5.)*
A **Notebook on a scheduled Pipeline** pulls the current ICON-D2 run from `opendata.dwd.de`, clips it to the AOI, and lands it in the Lakehouse. Nothing is available for the past — but from day one of the harvest, *we* have an archive, and it grows.

This is deliberately the shape of the **Notebooks + Pipelines** hero capability (decision 17). It is a real ingestion pipeline solving a real problem — GRIB2 decode, spatial subsetting, incremental Delta writes, scheduled orchestration, late/missing-run handling — rather than a toy job invented to have something to show. It feeds live mode, today's forecast, and Mode D's "what was the air doing" once the archive has depth.

🟡 **To size in the spike.** ICON-D2 is served as one GRIB2 file per parameter, per level, per step. Pulling 20 model levels × 5 parameters × 24 steps means ~2 400 files a day to extract a few MB of AOI subset — the *stored* volume is trivial (~1–3 MB/day, ~1 GB/year), the *transfer* is not. Mitigations to evaluate: fewer levels, 3-hourly steps, pressure-level products instead of model levels, one run per day. **Measure before scheduling it.**

✅ **Measured 2026-07-29.** The fear was justified — the naive harvest is **23.9 GB/day**. The shipped
strategy is **181 MB/day across 250 files**: ten single-level parameters hourly over the flyable
window, plus five pressure levels of u/v/t three-hourly. See phase 5 for the two things the spike
corrected in this section — `hbas_con` does not exist, and zero does not mean ground level.

**Explicitly not doing:** pretending a reanalysis exists. ERA5 (Copernicus CDS) is genuine and reaches back to 1940, but at ~31 km it cannot resolve an Allgäu thermal — it could only ever give synoptic context ("what kind of day was it"), never the local wind. Noted as a possible later addition, **not promised**.

### 5.6 Land cover and buildings

ALKIS `tatsaechlichenutzung` for land cover classes, LoD2 CityGML for buildings — both LDBV, both covered by §5.1. OSM supplements where LDBV has nothing: place labels, paths, the landing field, and the cableway below.

#### Buildings are rendered at true height *(corrected 2026-07-30)*

⚠️ **They were not, for the whole of phases 1–7.** `src/twin3d/buildings.ts` multiplied every building's height above ground by **1.35** in the vertex shader, justified by a comment stating that LoD2 stores eaves heights and that a village at true height would read as flat against 1 400 m of relief.

The comment was wrong, and the source data says so plainly:

| check | result |
|---|---|
| `bldg:RoofSurface` elements, 3 Tegelberg tiles | **6 545** across 2 702 buildings |
| genuinely pitched (ridge above eaves) | **2 160** of 2 702 |
| derived height vs the survey's own `bldg:measuredHeight` | **median difference 0.00 m**, max 0.83 m |

`build_lod2_mesh.py` fan-triangulates *every* posList in the building, roof surfaces included, so the mesh already reached the ridge. The 1.35 was not a correction for missing roof geometry — it added 35 % on top of a measured value. The median house was drawn at 8.7 m instead of 6.5 m, and Neuschwanstein, modelled at 88.8 m from the foot of its rock spur, was drawn at **119.8 m**.

**Where it came from:** inherited by fork from Flut-Insights, where the *terrain* is vertically exaggerated (`uVerticalExaggeration`) and buildings genuinely do need stretching to keep up with it. Oberstdorf removed the terrain lever as unnecessary in the Alps; the building one survived that refactor and acquired a plausible-sounding justification that was never true here.

The lesson is the phase 7 one again, in a different disguise: **a constant that arrived with a rationale attached will keep the rationale long after the reason has gone.** The terrain exaggeration and the building exaggeration were one decision; only half of it was undone, and the surviving half was documented as if it had always stood on its own.

*The same constant is still present in Flut-Insights, Campus-Insights and Campus-Scheduler — deliberately not touched here.*

### 5.7 The Nebelhornbahn *(decision 25)*

OSM `aerialway=cable_car` for the line geometry plus `aerialway=station` for the terminals, via Overpass — `tools/geodata/build_cableway.py`. Rendered as a catenary between pylons with simple station volumes.

Cheap, and it does real work: it explains how a pilot gets to 1 932 m without flying, it gives the eye a vertical line to read the relief against, and it makes the scene recognisable to anyone who has been there. The Tegelbergbahn gets the same treatment in the second AOI. OSM data is **ODbL** — attribution registered in `NOTICE.md`.

### 5.8 `NOTICE.md`

Every source registered **before** first use, with authority, licence, URL, acquisition date and required attribution string. At v0.2 that is: LDBV Bayern (CC BY 4.0) · Copernicus DEM (ESA/DLR/Airbus terms) · OpenStreetMap (ODbL) · Open Glider Network · DWD ICON-D2 (GeoNutzV) · the bundled IGC. Carried over from Flut-Insights as a hard rule.

### 5.9 Live webcams *(decision 26)*

A webcam is the only layer in this app that can be checked against reality by looking at it. That is the whole appeal, and it is also the whole risk: it is somebody else's image, on somebody else's server, under somebody else's licence.

**The licence is the hard gate, not an afterthought.** Alpine webcams are overwhelmingly published under terms that are *not* automatically compatible with a Microsoft demo, and the most common restrictions are the most awkward ones:

* **`NC` (non-commercial)** clauses are widespread. A sales-and-marketing demo is commercial use, whatever the intent.
* **`ND` (no derivatives)** forbids cropping, projecting onto terrain, or compositing into the scene — which rules out the visually interesting treatments.
* **Hotlinking** is separately forbidden by many operators even where the image itself is freely licensed, because it moves bandwidth cost onto them.

⚠️ **No camera ships until its terms have been read and recorded — and this section deliberately names no operator.** Listing "the usual Alpine networks" here from memory would be the §4.2 mistake in a new place: a plausible, specific, unverified assertion, and a licensing one at that. For each candidate, before any code: operator, exact page, licence text **quoted rather than summarised**, whether embedding is permitted, whether a link-out is required, whether written permission is needed. That goes into `NOTICE.md` next to the LDBV and Copernicus notices. **Do not infer a licence from another camera on the same network** — operators mix terms per camera.

**Where permission is unclear, the fallback is a link, not an embed.** A marker that opens the operator's own page in a new tab needs no licence at all, sends them the traffic, and still demonstrates the idea. That is the default; embedding is a per-camera upgrade once terms allow it.

**Placement must be verified like everything else (§4.2).** A webcam marker asserts *"the camera is here, looking that way"*. Guessing puts a plausible, precise, wrong object into a model whose entire claim is that it does not do that. Position and bearing come from the operator's own metadata, or from matching the image against the terrain model — and where the bearing cannot be established, the marker is a point without a direction rather than an invented one.

**Freshness is part of the data.** Every image carries its capture time, shown beside it, and an image older than a threshold is labelled stale rather than presented as *now*. Alpine cams commonly refresh on a ~10-minute cycle and many go dark overnight or in cloud. *"The mountain is in cloud"* is a true and interesting answer — and it has to be distinguishable from *"the feed is broken"*.

#### The gate, run 2026-08-02 — **and this half passes**

Cameras first, licence second, in that order — because a camera nobody can point at is not worth reading terms for.

**Both sites have a mapped camera, and it is essentially standing at the launch.** Resolved from OpenStreetMap (`tools/geodata/webcam_spike.py`), 14 mapped cameras around Oberstdorf and 5 around the Tegelberg. The two that matter:

| site | camera | OSM | distance to the launch | bearing | elevation |
|---|---|---|---|---|---|
| Oberstdorf | Nebelhorn, Gipfelstation | `node/9569388012` | **≈ 30 m** | 130° | 2 224 m |
| Tegelberg | Tegelberghaus | `node/9569388015` | **≈ 80 m** | 290° | 1 707 m |

The bearing is OSM's `camera:direction`, and it **cross-checks against the operator's own caption** in each case — 130° against *"Blick nach Südosten"*, 290° against *"Blick auf Füssen, Schwangau und den Forggensee"*, all of which lie WNW of the Tegelberg. Two independent statements of the same fact agreeing is the difference between a verified bearing and a plausible one.

Thirty metres is the interesting number. It means the demonstration is not "here is a webcam somewhere on this mountain" but **standing at the launch inside the model and opening the same view as a photograph** — the model checking itself against reality, from the same spot, live.

**The licence is exactly the case §5.9 anticipated.** From foto-webcam.eu's Impressum, quoted rather than summarised:

> „Die Inhalte und Bilder unserer Website unterliegen — sofern nicht anders gekennzeichnet — unserem Urheberrecht und dürfen **ohne vorherige schriftliche Zustimmung weder als Ganzes noch in Teilen verbreitet, verändert oder kopiert werden.** **Links auf diese Website und deren Unterseiten sind generell gestattet und auch erwünscht.**"

So: **embedding, hotlinking the JPG, projecting onto terrain and compositing are all out** without written consent — and **linking is explicitly invited.** That is the fallback this section already chose as the default, arrived at from the operator's own words rather than from an assumption, and it needs no permission request at all. Both AOI configs carry `"use": "link-only"` for that reason.

One more camera exists at the Nebelhorn — `node/12174047614`, a 360° Panomax run by ok-bergbahnen. Different operator, different terms, **not adopted**: §5.9's rule against inferring a licence from a neighbouring camera applies just as much to a neighbouring camera on the same summit.

⚠️ **Re-verified against a second service, because the first one stopped answering.** Re-running the spike to confirm the recorded ids, Overpass returned `504 Gateway Timeout` for the Tegelberg bbox on four consecutive attempts — so the Tegelberg camera could not be reproduced by the tool that found it. A node id is a precise claim about the world, and "it was there when I looked" is not a check. Both were therefore confirmed one object at a time against the **OSM API** (`api.openstreetmap.org/api/0.6/node/<id>.json`), which is a different service with a different failure mode: positions, `camera:direction` and `ele` all match the configs exactly, and both operator pages return `200 text/html`. Worth remembering generally — **when the source that produced a fact is unavailable, a second source is usually one HTTP call away, and re-running the same failing query is not verification.**

**What this unblocks.** The webcam half of Mode F is buildable now, with no email and no waiting: markers at two verified positions, oriented by two verified bearings, opening the operator's own page in a new tab. What it will not do is show the picture in-app, and that limitation is the operator's decision rather than a missing feature.

### 5.10 Live wind *(decision 27)*

#### The obvious source does not work — measured 2026-07-30, `tools/ogn/weather_spike.py`

The tempting answer was that this is nearly free. The relay already holds an APRS-IS connection, FANET+ weather stations are common at launches, and `server/ogn/aprs.js` **already sees and discards** their beacons — its parser drops anything without a device id, and a ground station has none. One parser change and the data would apparently be there.

It is not. Probing the live feed directly:

| filter | window | position packets | **weather stations reporting** |
|---|---|---|---|
| Oberstdorf, r = 40 km | 75 s | 1 087 | **1** |
| Tegelberg, r = 40 km | 75 s | 797 | **2** — one sending `.../...g...t...`, i.e. no measurement at all |
| **Tegelberg core, r = 25 km** | 60 s | 384 | **0** |
| both sites, r = 70 km | 90 s | 2 920 | **1** |

The single station that actually reports is `FNTFD0006` at **47.5912 / 10.2935** — about 16 km north of the Oberstdorf core and 34 km from the Tegelberg, so it lies **inside neither AOI**. It beacons roughly once a minute. Both 40 km probes found the *same* station, because two 40 km circles 37 km apart overlap almost entirely; tightened to 25 km around the Tegelberg, the count drops to zero.

So OGN offers one sensor, in the wrong place, for two sites — and nothing at all for the second one. It stays as a **bonus layer if it ever falls inside a view** — free, already connected — but it cannot be the foundation of a wind mode.

⚠️ **Its encoding is a trap as well.** The raw comment reads `290/001g003t146h00b63319`. Three things in that string are not what they look like:

* wind speed and gust are in **miles per hour** — not knots, not m/s;
* `h00` means **100 % humidity**, not 0 % — an APRS convention;
* `t146` cannot be 146 °F; read as tenths of a degree Celsius it is 14.6 °C, which is plausible for the altitude and season — **but that is inference, not documentation.** Nothing ships on it until it is confirmed against the station's own published reading.

This is the `hbas_sc` lesson from phase 5 again (§5.5): *a field that decodes to a plausible number is the most dangerous kind of wrong.*

#### What to evaluate instead — **evaluated 2026-08-01, and none of it is free**

Needed: a station **at or near the launches**, reporting at least every few minutes, under terms that permit use. Both licensed candidates were checked, and both fail — on different axes.

**DWD is licensed but in the wrong place vertically.** Already a source here (§5.5) under GeoNutzV, no permission needed, 10-minute cadence published openly. Measured against the station list for the 10-minute wind observations, the nearest stations to each launch are:

| launch | nearest DWD station | station altitude | difference |
|---|---|---|---|
| Nebelhorn, 2 220 m | Oberstdorf, 5.6 km | **806 m** | **1 414 m below** |
| Tegelberg Bergstation, 1 715 m | Halblech-Bayerniederhofen, 7.6 km | **808 m** | **907 m below** |

Both are valley-floor stations. The next station at flying altitude is the **Zugspitze (2 956 m)** — 48 km from the Nebelhorn and 22 km from the Tegelberg, i.e. the right altitude on the wrong mountain. This is the same failure as OGN with the axis rotated: OGN's sensor is in the wrong valley, DWD's is in the right valley and 1 km too low. A valley reading presented as launch wind would be a precise, plausible, wrong number — §2.2 again.

DWD remains genuinely useful for **valley** wind and pressure, and may be worth showing *as that*, at the station, labelled with its 806 m. It is not launch wind and must never be drawn as if it were.

**Holfuy is in the right place but needs permission, and its terms forbid even surveying it.** Quoted from the Terms (2021-09-24), rather than summarised:

> **APIs** — "We can offer direct API access to one or more station's data for free of charge. […] If an other website than Holfuy uses and shows the data from Holfuy it should name Holfuy as the source of the data and add a link for the station's data monitor page as the source next to the data."

> **Data collection** — "Without prior consultation and agreement it is **forbidden to download or collect any weather data or website content from Holfuy (e.g. by automated scripts)**. Except the station owners for their stations' weather data, and **API users who has a valid API key** for the data they are collecting."

Two consequences, and the second is the awkward one:

1. Access is **free but granted**, not open. It needs a request to `info@holfuy.hu`, and attribution plus a link to each station's monitor page wherever the data is shown.
2. **Whether a station even exists at these launches cannot be established with a script**, because enumerating their map is itself "collect[ing] … website content … by automated scripts". So the availability question and the permission question are the *same* question, and it is a human one.

⚠️ **This is the phase-9a gate failing, and it fails usefully.** Mode F's wind half is not blocked on code; it is blocked on an email. Nothing licensed and openly collectable sits at either launch, so building the renderer first would mean building a windsock with nothing to put in it.

**Next action is not code:** ask Holfuy for API access for the two sites (and, if they have no station at the Tegelberg, the Tegelbergbahn operator is the other candidate). Until then the wind half stays unbuilt — which is the same call as the Tegelberg's missing flight and its missing Mode D: **a site ships without the layer and says so.**

**Selection rule, in order: licensed → at the site → frequent → convenient.** A convenient feed with unclear terms, or a well-documented sensor 15 km away, fails — which is exactly what the OGN measurement above demonstrates.

**Wind is shown where it was measured, or not at all.** One station does not describe a valley, and rendering a single reading as a general wind field would be the "mean of two valleys" error that Mode D's AOI filter was fixed for (§4.4). Each station is its own marker, with its own reading and its own age.

---

### 5.11 Building colour *(decision 28)*

Every building in the valley was the same warm terracotta — `vec3(0.78, 0.68, 0.60)`, brightened with height as a stand-in for "roofs are lighter than walls". It was the last large thing on screen not derived from a survey, and in an app whose whole claim is that the numbers come from somewhere, 5926 identical houses is a claim of its own.

**Two of the three plausible sources were ruled out by measurement, not by taste.**

| source | what it actually carries | verdict |
|---|---|---|
| LoD2 CityGML | 100 % roof/wall semantics, roof pitch and orientation per surface, function and roof-type codes — and **not one** `Appearance`, `X3DMaterial` or `diffuseColor` across 13 223 buildings | shape yes, colour **no** |
| OpenStreetMap | `building:colour` on **1 of 4295** buildings at Oberstdorf (0.02 %) and 136 of 4242 at the Tegelberg (3.2 %); `roof:material` on 0 and 17 | real, far too sparse |
| DOP20 orthophoto | a photograph of every roof, already downloaded, already shipped as the terrain drape | **this one** |

The survey measured the *shape* of these roofs to the centimetre and never recorded their colour. A vertical aerial photograph records exactly the part of a building that a survey does not: the roof. So the colour of the pixels inside a roof polygon **is** the colour of that roof, and the app already had the photograph.

**The drape already in the repository is good enough, and that was measured rather than hoped.** The same 3013 roofs sampled from the shipped 1.17 m/px JPEG and from a fresh 20 cm DOP20 request:

| roof area | n | median Δ | p90 Δ | share > 25/255 |
|---|---|---|---|---|
| 8–20 m² | 782 | 7.7 | 20.7 | 6.3 % |
| 20–50 m² | 962 | 5.7 | 16.0 | 3.5 % |
| 50–150 m² | 1116 | 3.7 | 10.0 | 1.0 % |
| >150 m² | 153 | 3.0 | 8.3 | 0.7 % |

A median roof gets 32 drape pixels. **So this needs no new download at all** — which matters more than it sounds: nothing to re-fetch, nothing to rot when a WMS changes, and the buildings are lit by the same photograph as the ground they stand on, so they sit in the scene instead of on it. Result: **99.3 % of Oberstdorf and 99.7 % of the Tegelberg measured.**

**Three contaminants, all handled rather than excused.** A tree over a roof turns the median green — green-dominant pixels are rejected, which took green roofs in the test window from 5 to 0. A chimney's shadow and a sunlit flashing pull the median from both ends — the darkest and brightest fifths are trimmed. And the photograph contains the sun: sampled value spans 0.36–0.90 p05–p95 purely from which way each pitch faced on the morning of the flight, and the renderer then applies its *own* lighting, so an unnormalised sample is shaded twice and a north pitch reads as a hole.

⚠️ **The first result looked like a doll's house, and the numbers said so before the eye was trusted.** The produced palette had a **median saturation of 0.14** with only 6.6 % of roofs above 0.30, where a real clay tile sits near 0.60 — every red roof in the valley came out dusty pink. A vertical photograph through a kilometre of summer haze, resampled and JPEG-compressed, loses most of its chroma, and the sampler has to put it back. The gain is multiplicative on purpose: grey roofs sample near s = 0.04 and stay grey however much they are multiplied, so it separates clay from slate instead of tinting everything.

⚠️ **And then a correct result was nearly "fixed".** After the correction the two sites disagreed sharply — Oberstdorf 44 % strongly coloured, the Tegelberg 81 % — which looked like a per-flight colour cast, and the obvious response was to normalise saturation per AOI the way value already is. Measuring the two drapes first showed they are balanced almost identically (r/g 0.918 vs 0.926, b/g 0.800 vs 0.830, whole-image saturation 0.242 vs 0.250). **There is no cast. Hohenschwangau really does have more red tile than Oberstdorf**, which is full of modern metal-roofed hotel blocks. Normalising would have deleted a true, measured difference between two real villages to make a statistic look tidy.

**Roof and wall are now the CityGML's own classification.** `bldg:RoofSurface` / `bldg:WallSurface` were being thrown away by a parser that read every `gml:posList` in document order; both are present on **every** building in both AOIs. The triangles are now emitted walls-and-ground first, then roofs, with one split index per building — so the client rebuilds a per-vertex roof flag from four bytes per building instead of a byte per vertex, and the whole colour payload is **23 KB** rather than three megabytes.

⚠️ **Wall colour is NOT measured, and the code says so in as many words.** A wall is not visible in a vertical aerial photograph and OSM has nothing. Walls use a regional render palette — Alpine Bavarian is overwhelmingly white to cream with a minority of timber, a range narrow enough that a plausible guess is close to a safe one — varied by a stable hash of the building index so the same house is the same colour on every load. It is plausible, it is explicitly not a survey, and it is labelled that way in `buildings_lod2.json`, in `NOTICE.md` and in the shader.

**Portability.** The sampler is `tools/geodata/roof_colour.py`, a single file with no dependency on this app: give it a georeferenced image and a list of roof outlines and it returns colours. Campus-Insights and Campus-Scheduler are independent copies of this code — verified, not assumed: three separate `buildings.ts` and three separate `build_lod2_mesh.py`, no shared package, no workspace links — so nothing here reaches them until it is deliberately carried across.

#### 5.11.1 Combining the survey with the photograph

The orthophoto answers "what colour is that roof". It says nothing about the rest of the building, and the rest of the building turned out to be most of it.

⚠️ **Measured: wall is 68–71 % of a building's 3D surface area, in every height band.** Under 8 m, 8–12 m, 12–20 m, over 20 m — the share barely moves. So the roof sample, however good, governs about a third of what the eye sees. The extremes are worse: St. Johannes Baptist is 68 % wall at 62.3 m, and the two thinnest towers in the AOI are **95 % and 97 % wall**. For those buildings the photograph is almost irrelevant.

**What the survey knows and the renderer was ignoring.** Every LoD2 building carries an ALKIS `bldg:function` code, a `measuredHeight` and a footprint; 50 of them carry a `gml:name`. The codes were decoded **from the data rather than from a code list**, using those names as the check:

| code | n | median | named examples | reading |
|---|---|---|---|---|
| `31001_1000` | 2403 | 132 m², 9.3 m | Pfarrhof, Obere Lugenalpe | dwelling |
| `31001_2000` | 3341 | **43 m², 4.2 m** | Wankhütte, Untere Lugenalpe, Elektrizitäts- und Wasserwerk | trade / farm |
| `51009_1610` | 296 | 32 m², 3.9 m | Carport, Brennholzüberdachung | open shelter |
| `31001_3041` | 3 | 372 m², 26.1 m | St. Johannes Baptist, Christuskirche | church |
| `31001_3043` | 15 | 60 m², 9.3 m | St. Maria, Klausenkapelle | chapel |
| `31001_3020` | 4 | 1857 m², 14.6 m | Gertrud-von-le-Fort-Gymnasium | school |
| `31001_3052` | 13 | 242 m², 12.1 m | Stillachhaus Klinik, Adula-Klinik | clinic |
| `31001_3000` | 24 | 338 m², 9.1 m | Rathaus, Heimatmuseum | public |

⚠️ **`31001_2000` was nearly mis-read, and only the size distribution caught it.** The code means *"Gebäude für Wirtschaft oder Gewerbe"*, which in a resort town reads naturally as hotels and shops — and that reading is wrong. At a median of 43 m² and 4.2 m, with names like *Wankhütte*, the bulk of these 3341 buildings are sheds, hay barns and alpine huts. They are the **largest single group in the valley** and they were all wearing the same cream render as the houses. So the rule uses the code *and* the measured size, because the code alone puts a barn and a supermarket in one bucket.

**Result: 48.6 % of Oberstdorf's buildings changed wall treatment** (49.7 % at the Tegelberg) — 2443 render→timber, and 318 that the old 11 %-at-random hash had made timber are correctly rendered again.

**Per-surface roof material, for the roofs that have more than one.** Roof colour is pooled per building on purpose (§5.11: pooling averages a gable's sunlit and shaded pitches, which is how the aerial sun is removed). But a copper spire on a tiled nave is genuinely two materials. So a roof surface may now claim its own colour — **hue and saturation from the surface, value from the building**, so material survives and the sun does not.

⚠️ **Getting the threshold right took two corrections, both caught by checking rather than looking.** Calibrated on large buildings it fired on **44.9 %** of all buildings, whose median vertex count was 108 against 96 for the population — ordinary gabled houses, because sampling noise scales as 1/√n and a small pitch gets a handful of pixels. That would have drawn a seam down every plain gable in the valley. Then the second attempt leaned on saturation, and **saturation carries the sun too**: shadow strips chroma, and the measured within-building spread is 0.011 for hue against 0.079 for saturation — seven times more variation in the channel that was supposed to be material. That is why the Tegelberg, whose roofs really are more saturated, reached 47.5 %. Hue now carries the decision; saturation is kept only for grey-beside-coloured, where hue means nothing. Final: **7.9 % of Oberstdorf's buildings**, median vertex count 144 against 96 — the large and complex ones, as intended.

⚠️ **A missing optional file does not 404.** The app is a single-page app, so an unknown path returns `index.html` with HTTP 200 — the live deployment cheerfully reported a spans file that had never been built. Read as little-endian vertex offsets, HTML repaints scattered triangles in colours taken from `<!doctype html>`, which looks like a rendering glitch rather than a missing file. Optional payloads are now validated by **shape**, not by status.

**Is it better? Honestly: more correct, and only subtly more striking.** A camera-matched A/B against the previous deployment (mean difference 0.69/255 over the frame, so the two cameras genuinely agree) shows the change is real but quiet at village scale — because the buildings that changed most are small sheds, largely hidden between the houses. The visible wins are the named landmarks and the farm fabric, not the skyline.

---

## 6. Fabric architecture

Decision 17 says the Fabric App is the main point, so this is not an appendix.

| Capability | What it actually does here | Phase |
|---|---|---|
| **Fabric App** (Rayfin) | The delivery vehicle. The whole 3D experience ships as a Fabric App, shared with customers and colleagues (decision 14). This is the thing being demonstrated. | 1 → 7 |
| **Lakehouse + Delta** | Flight tracks as Delta tables — points, derived vario, derived wind, per-flight summaries. Plus the harvested ICON-D2 grids. | 5 |
| **Direct Lake** semantic model | Mode D. Aggregate day statistics with no import step and no refresh window. To be authored in phase 5 — the inherited insurance model was deleted rather than adapted. | 5 |
| **Eventhouse / RTI** | The live OGN stream. Schema in `fabric/kql/`, provisioned by `tools/fabric/setup_eventhouse.py`. Genuinely real-time telemetry, which is exactly what RTI is for. | 4 |
| **Notebooks + Pipelines** | The ICON-D2 harvest (§5.5). Scheduled, incremental, with real failure modes. | 5 |
| **Foundry realtime assistant** | Mode E. Voice + chat over the semantic model and the scene. | 6 |

The honest framing for a customer: *the mountain is why you are still watching; the Fabric underneath it is what you would build.*

---

## 7. Phases

### Phase 0 — Scaffold *(no downloads, safe to run now)* — **done**

Flood modules removed rather than re-skinned: the hydrograph, the WSE profile, the chainage flow
field, the hazard classes and the what-if levers all encoded "a river rising over time", which has
no paragliding analogue. `App`, `TwinShell`, `scene`, `Twin3DView`, `facts`, both i18n bundles and
the e2e specs were rewritten; `README` / `NOTICE` / `LICENSE` / `AGENTS` are still outstanding.

`facts.ts` is deliberately **empty** of figures. No alpine numbers were invented to replace the
flood ones, and `isReleaseReady()` returns false for an empty registry — `[].every()` is true, so
the naive gate would have given a clean bill of health to an app that had registered nothing.

**Result: it builds and shows an empty scene.** ✅

### Phase 1 — **Das Gelände** *(the plain map first)* — **done, bar the drape**

1. ✅ `tools/geodata/fetch_bvv.py` — tile list derived arithmetically from the bbox; structural
   verification (float32, right size, right UTM origin) because the real failure mode is a mirror
   answering with an HTML error page saved as `.tif`. **Edge tiles are clipped to the state border**
   — `604_5245` is 936×1000 px — so extents come from the GeoTIFF tiepoint, never the filename.
2. ✅ `tools/geodata/fetch_copdem.py` — a real COG window read: 34 KB of header, then 4 of 16 tiles
   by byte range instead of 40 MB. ⚠️ TIFF **predictor 3** stores byte planes most-significant-first;
   un-shuffling them in natural order does not fail, it silently returns elevations spanning
   ±3.4e38. There is now a sanity gate on the decode.
3. ✅ DGM1 → `heightmap_4m.u16` + nodata mask, nearest-neighbour filled.
4. ✅ Shell heightmap with the seam offset **measured** in the overlap ring. The measurement split
   itself in two and the split mattered: **+3.16 m over all cells (canopy), −0.07 m over open
   ground (datum)**. Applying the former would have pushed every open valley three metres
   underground to make the forests line up. Only the datum component is removed globally.
5. ✅ Alpine palette, re-ranged from the AOI's own elevation range rather than fixed metres; ramp
   goes *paler* with height because above the treeline the Allgäu limestone is bare rock. Aerial
   haze shared by both tiers and **fading to the sky colour** — anything else and the shell's outer
   edge paints itself as a hard diagonal.
6. ✅ Land cover from OpenStreetMap, faded out over the transition band so core and shell also meet
   in the same *colour*. (ALKIS `tatsaechlichenutzung` remains the better source; OSM was already
   wired and is good enough to judge the scene by.)
7. ✅ **Registration proof** — `tools/geodata/verify_registration.py`, and it is a gate, not a
   report. 79 published peaks, **median residual −0.44 m, spread 3.79 m, no correlation with
   easting or northing**, plus a longitudinal profile climbing 1415 m from Oberstdorf to the summit.
8. ✅ LoD2 → quantised mesh (5926 buildings, 253 k triangles). ⚠️ The quantisation scales are now
   **derived from the data**: a fixed 1 cm y-scale spans only 655 m in a uint16, which is ample for
   a river valley and nowhere near enough for an AOI running from an 800 m valley floor to a
   mountain station at 1930 m. The first run aborted on a rooftop at 1497 m, which is the guard
   doing its job. ✅ Nebelhornbahn from OSM — all three sections, 23 pylons, 10 stations.
   ✅ **Individual trees** — 222 908 of them, every one a surveyed position and a measured height
   from the LDBV `einzelbaeume` cadastre. ⚠️ The dataset records position, ground height and tree
   height and **nothing else** — no species, no crown radius — so the crowns are drawn as one
   neutral form with the radius estimated from the height, and the app never names a species or
   implies one with a recognisable silhouette.
9. ✅ DOP20 drape. ⚠️ **This turned out not to need the streaming fetcher §5.1 designed.** DOP20 is
   not published as addressable tiles at all — the catalogue offers it by municipality, by district,
   or as a **WMS**. A WMS request specifies the extent *and the output resolution*, so instead of
   pulling ~6 GB at 20 cm and discarding 97 % of it, the fetcher asks once for the AOI at the
   resolution the browser will actually use: 8192 px on the long side, about 1.2 m per pixel,
   **12.8 MB**. Finer would be pointless — the mesh underneath is at 16 m posting, and 20 cm over
   this AOI would be a two-gigapixel texture.
10. ✅ Observer camera with framed presets from the AOI config.

⚠️ **The AOI was wrong and the terrain caught it.** The config's `Oberstdorf` was a place node
4.6 km SSE of the town; the freshly built heightmap put it at **1115 m**, against a published 813 m.
Re-resolved from OSM to 47.4104347/10.2774409, and the core bbox was re-centred because it had been
drawn around the wrong point — the real subject sat in its northern quarter with the town centre
260 m from the western edge. `nebelhornbahn_tal` was likewise the ticket office, not the station.
This is exactly the failure §4.2 warned about, and it happened anyway; the lesson is that a
coordinate is only verified once something independent agrees with it.

**Gate: Alexander looks at it and says it looks like the Allgäu.** ← *awaiting sign-off*

### Phase 2 — **Der Flug** *(the lead mode)* — **done**

✅ IGC parser in the browser (B records, day rollover, 2D fixes dropped), ✅ vario derived from
**pressure** altitude — GPS vertical noise is several metres and uncorrelated, so differentiating it
at 1 Hz invents ±3 m/s on a glide — ✅ track ribbon coloured by climb and sink, drawn only as far as
the replay head so the ending is not given away, ✅ barogram that *is* the scrubber, ✅ follow
camera, ✅ drag & drop that never leaves the browser, ✅ launch and landing sites resolved from
Overpass into `flyingSites`.

✅ **Track-derived wind** (§5.5 track 1). The turn endpoint is interpolated to exactly 360° —
without that the overshoot measured a known 5.0 m/s wind as 4.76 m/s, and there is a test that
pins it. Directions are averaged as vectors, never as degrees. Bands the pilot never circled in
stay **empty** rather than interpolated.

✅ `2021-04-24` bundled as *Beispielflug*, anonymised at import. ⚠️ The IGC **A record carries the
logger serial** (`AXTR8792F7BA787F`) — the first version stripped it from the filename and left it
in the file, which achieves nothing. There is now a residual check that deletes the output if any
identifier survives.

⏳ Thermal-core helices as an explicit layer — the circles are visible in the ribbon, but not
abstracted.

### Phase 3 — Drone mode and polish of the scene — **mostly done**

✅ **Drone mode** (`src/twin3d/droneCamera.ts`) — WASD, Q/E, arrow keys or drag to look, Shift to
boost, wheel for cruise speed. **No collision and no physics**, per decision 19: it is a camera, not
a simulator. The orbit controls are hard-disabled while it is active, because OrbitControls rewrites
the camera every frame from its own target and would drag the drone back as fast as the keys pushed
it away.

✅ **Given mass, a throttle and an altimeter** (2026-07-29), because the first version teleported
rather than flew. Three changes, each addressing something specific:

- **Inertia.** Velocity eases toward what the keys ask for and eases back down when they are
  released, frame-rate-independently. Braking (τ 0.16 s) is deliberately quicker than accelerating
  (τ 0.28 s): coasting is what makes the camera feel like it weighs something, but coasting *past*
  what you were trying to look at is just a fight.
- **A smoothed gimbal.** The look direction chases the pointer with ~70 ms of lag instead of being
  pinned to it. Small, and the whole difference between "mouse attached to eyeballs" and "camera on
  a stabiliser".
- **Speed scaled by height above ground.** The AOI is 30 km across with 1 400 m of relief, so no
  single speed is right: what crosses the valley in seconds makes it impossible to ease along a
  ridge. Height above the terrain sets the scale (0.22× to 2.6× around a 400 m reference), so
  "close to the ground" and "precise" become the same thing without the viewer managing anything.
  The terrain is sampled straight from the heightmap array the shader already uses — raycasting
  285 k vertices every frame to answer "how high am I" would be absurd when the mesh *is* that array.

✅ **A HUD** — altitude AMSL, height above ground, speed, heading, and the throttle as a bar. Polled
at 10 Hz rather than pushed from the render loop, which is a legibility decision before it is a
performance one: numbers changing sixty times a second are a blur nobody can read. ⚠️ Height above
ground is allowed to go **negative** and is shown that way, because decision 19 permits flying
inside the mountain and a viewer who ends up there sees an unlit void and reasonably concludes the
app has broken. One negative number turns that from a bug into a position.

⚠️ **Still no roll**, and it stays that way even though banking into a turn is the most drone-like
touch available. A tilted horizon in a terrain app reads as *the terrain* being wrong, and this
app's entire claim is that the mountain is where the survey says it is.

✅ Place labels — settlements, stations, and the four launch sites and two landing zones, all
projected into the terrain metadata by the build so the front end carries no projection code.
Drawn as **HTML positioned over the canvas**, not as sprites: text is the one thing the browser
does better than WebGL, and the positions are written straight to `style.transform` from the render
loop rather than through React state — a dozen labels at 60 fps would otherwise be 720 re-renders a
second to do nothing useful.

✅ Sky and haze tuned: the haze colour is now **the same as the clear colour**, because the shell is
finite and fading to anything else paints its outer edge as a hard diagonal against the background.

✅ **Guided tour** — six stops following the arc a pilot's day actually takes: the valley, the
cable car, the mid-station launch, the summit launch, the ridge, the landing field. Three rules,
all of them about not being a video: it stops the instant anyone touches the controls, it only
points at places already in the AOI config (so it cannot drift out of step with the map, and a
second site with no cable car gets a shorter tour rather than a broken one), and it honours
`prefers-reduced-motion`.

⚠️ **A performance investigation that was wrong, recorded so it is not repeated.** The scene
measured **1 fps** on an Adreno X1-85. That looks exactly like the SwiftShader symptom in §8, so
the shell's fragment `discard` was replaced with a clip-space vertex cull on the theory that
discard was disabling early-Z on a tile-based GPU. It made no difference — and it introduced a
visible white gap along the core boundary, where the shell stopped a fraction before the core
began. The actual cause: **Chromium throttles requestAnimationFrame to ~1 Hz for an *occluded*
window while still reporting `document.visibilityState === 'visible'`**. The discriminating test is
cheap and should come first next time: compare rAF cadence against `setTimeout` — 1/s against 46/s
settled it in one call. The shader is reverted; the reasoning about discard and early-Z is sound in
general and is left as a comment, clearly marked as not having been the problem here.

✅ **Measured properly, 2026-07-29 — on the same Adreno X1-85.**

| | |
|---|---|
| Frame rate | **59.5 fps**, vsync-locked |
| Median frame | **16.7 ms** · p95 17.4 ms · worst 18.0 ms |
| At 3× the pixels (1.55 → 4.78 Mpx) | **unchanged**, still 16.7 ms |
| Occlusion check | rAF 59.5/s vs `setTimeout` 42.1/s — not throttled |

So the scene is comfortably inside budget with **at least 3× fragment headroom**, and the "1 fps"
figure is now dead rather than merely explained. Scene at the time: 307 k core vertices, ~120 k
shell, 5 926 buildings, 222 908 trees in 99 culled chunks, and a 306 MB drape.

### Phase 4 — **Jetzt in der Luft** — **done**

✅ **The spike passed, decisively** (`tools/ogn/spike.py`, 2026-07-29 15:30 local, 75 s window).
APRS-IS reachable on `aprs.glidernet.org:14580`, anonymous `pass -1` login accepted, range filter
honoured. **439 aircraft position reports from 18 aircraft, 5.9/s** — and critically **7 paragliders
airborne over the Nebelhorn**, thermalling between 2 260 m and 2 950 m. The bonus mode has something
to show.

⚠️ **The spike also killed the filter this phase was going to be built on.** §5.3 says FANET is what
paraglider instruments transmit, which is true and does *not* mean paragliders arrive with an `FNT`
callsign. Only 3 of the 7 did; the rest were decoded by FLARM receivers and arrived as `FLR*`.
Filtering on the transmitter prefix — the obvious reading of the plan — would have dropped more than
half the traffic this app exists to show, and it would have looked like poor coverage rather than
like a bug. **The authoritative signal is the aircraft-type nibble in the `id` field**, and nothing
keys on the callsign.

⚠️ **One aircraft, two callsigns, 134 m apart.** Device `1164F8` was relayed simultaneously as
`FNT1164F8` and `FLR1164F8` with altitudes of 2 260 m and 2 394 m. Keyed on the callsign it is two
paragliders; keyed on the device id but accepting both feeds, it is one paraglider whose trail
oscillates by more than the height of the launch above the valley. The relay picks one source per
device and releases it only after 45 s of silence, because that source is a receiver the aircraft
will eventually fly out of range of.

✅ **Relay** in `server/ogn/` — APRS-IS client with capped exponential backoff, DDB privacy filter,
trail state, SSE fan-out. **Zero dependencies**: Node's standard library only. SSE rather than
WebSocket (§5.3 allowed either) because the traffic is strictly one-way, `EventSource` reconnects
without a line of code, and a back-channel would have bought nothing.

✅ **Privacy enforced server-side**, and one step further than the plan asked. Suppressing the
registration of a `no-identify` device is not enough while its raw device id still goes out: the OGN
database is public, so the client could look the pilot up itself. Anonymous aircraft leave under a
salted hash, salt rotated per relay start. Of 36 126 registered devices, 350 have opted out of
tracking and 472 of identification — and the relay suppressed traffic in its first minute of
operation.

✅ **Live layer** — one instanced mesh and one line buffer for the whole sky, rather than an object
per aircraft, because the set churns constantly as gliders move in and out of receiver range.
Chevrons point where the aircraft is going and are coloured by climb rate on the *same* ramp as the
flight ribbon, which is now shared in `src/twin3d/vario.ts` rather than copied into each shader.

✅ **Fallback tested, not merely designed.** With no relay running the app reports *Aufzeichnung*,
explains why in one sentence, and shows the recorded flight — and the client stops retrying after
two failed attempts instead of 404-ing every few seconds for as long as the tab is open. This is the
normal state of the deployed build, since static hosting cannot hold a TCP socket open.

✅ **RTI** — `fabric/kql/01_live_traffic.kql` deployed as a definition part of the KQL database, so
the database and its schema are created in one Fabric call and no second token audience is needed.
The relay spools NDJSON and `tools/fabric/ingest_live.py` uploads it, deliberately keeping an Azure
credential out of a process whose only other job is to hold an anonymous socket open.

⏳ **Not yet created:** the Eventhouse itself. The scripts are written and dry-run clean; an
Eventhouse draws capacity continuously, so provisioning it is a decision rather than a step.

### Phase 5 — **Der Tag** *(Fabric depth)* — **done, bar the schedule**

✅ **The sizing gate passed** (`tools/weather/spike_icond2.py`). §5.5 said measure before scheduling,
and it was right to: the naive harvest — 20 model levels × 5 parameters × 49 steps — measures
**23.9 GB/day**. Ten single-level parameters over the flyable window plus a five-level wind profile
three-hourly costs **181 MB/day across 250 files**. **132× cheaper**, and it answers more of what a
pilot asks.

⚠️ **`hbas_con` does not exist.** §5.5 named it; DWD publishes 129 parameters and that is not one of
them. The cloud base is **`hbas_sc`** — base of *shallow* convection, which is precisely the cumulus
a thermal day is made of. Found by listing what is published (`tools/weather/probe_params.py`)
rather than by guessing a second time. Every parameter also has a `regular-lat-lon` variant, so the
icosahedral grid never has to be unpicked.

⚠️ **Zero does not mean ground level.** The first harvest reported a cloud base of **113 m** over the
AOI with a maximum of 3 234 m. The mean was not a cloud base — it was mostly cells with no shallow
convection, reported as `0` and averaged in as though the cloud were on the deck. Mode D would have
announced *"Basis heute 113 m"* on a day with cumulus at 3 200 m, which is exactly the confidently
wrong number §2.2.6 exists to prevent. The mean is now taken over cells where the parameter exists,
and the **area fraction travels with it** — a base over 4 % of the valley is a different day from one
over two thirds of it, and the table, the model and the panel all say which.

✅ **Curated flight tables** — `tools/flights/curate.ts`, which **runs the app's own code**.
`parseIgc`, `buildTrack` and `deriveWind` are imported from `src/flight/`, not reimplemented: Mode D
aggregates the same flights Mode B replays, and a Python port of a 200-line angle-wrapping
derivation with a known 5 % failure mode would have drifted within a release.

⚠️ **A flight id that looks like a date is not a string.** `flight_id` of `2021-04-24` loaded as a
**dateTime** — while `2021-04-25-03`, which the archive also holds for a second flight on one day,
would load as a string. The relationship key would have changed type the moment a second flight was
curated, and Direct Lake would have stopped framing with no error at all. Ids are now AOI-qualified
(`oberstdorf:2021-04-24`), which also makes them unique across the second site.

✅ **Lakehouse + Delta** — `flight_fix` (12 586), `flight_summary`, `flight_wind`, `weather`.

✅ **Direct Lake semantic model** — German Title Case tables (`Flug`, `Flugpunkt`, `Windprofil`,
`Wetter`), every measure on a dedicated `Measure` table, partitions with **no `schemaName`**.
Column types are **read from the Delta log** rather than declared, because a TMDL type that
disagrees with the Parquet is the other silent way Direct Lake fails.

⚠️ **Read the *newest* `metaData` action, not the oldest.** Reading log entry 0 gives the schema the
table was *created* with — which is stale the moment anything overwrites it, and an overwrite is how
these tables reload. It produced a model still describing a column as `dateTime` after the source
had been fixed to `string`, with no error anywhere.

⚠️ **TMDL takes a description as a `///` comment before the object**, not as a `description:`
property. The property form fails the entire import with `UnknownKeyword`.

✅ **Verified by querying it** (`tools/fabric/verify_model.py`), per §8 — not by the deploy
succeeding. All four tables framed, row counts match the CSVs exactly, and the ceiling measure
agrees with the source at 2 692 m.

✅ **Mode D in the app** — `DayPanel`, reading a snapshot exported from the semantic model by DAX
(`tools/fabric/export_day.py`). ⚠️ A **snapshot, and it says so**: static hosting cannot hold a
Fabric token, so the panel names the ICON-D2 run it came from. The numbers still come out of Direct
Lake — reading the curated CSVs instead would have been easier and would have made the mode a claim
rather than a demonstration.

✅ **Harvest notebook** — `fabric/notebooks/harvest_icond2.ipynb`, idempotent by model run: a re-run
replaces its own rows and leaves the rest of the archive alone. A job that appends blindly grows
duplicates on every retry; one that overwrites throws away the archive it exists to build.

⏳ **Not done:** scheduling it. The notebook starts consuming capacity the moment it runs on a
timer, so turning it on is a decision rather than a step — as with the Eventhouse in phase 4.

⏳ **Mode D is thin on flights, honestly.** The archive drive was not mounted, so the Lakehouse holds
**one** flight. The weather side grows by a run a day from now on; the flight side needs §5.4's
archive, and the model already handles many flights across many sites.

### Phase 6 — **Frag den Berg** — **done**

✅ **The gate passed** (`tools/voice/spike_realtime.py`). Phases 4 and 5 both had one, so this did
too: an ephemeral client secret was minted against a real Foundry realtime deployment before a line
of assistant UI existed.

✅ **No new Azure resource.** `aif-flutinsights-swc` — the sibling project's Foundry resource —
already carries `gpt-voice` (gpt-realtime-2). Realtime is billed per use, so an idle deployment
costs nothing and provisioning a second one to hold the same model would have been ceremony.

✅ **The key never reaches the browser.** `server/voice/mint.js` exchanges an **Azure CLI token** for
a ten-minute ephemeral secret; the browser then opens WebRTC **straight to Foundry**. Audio does not
pass through our server, which is why one small process serves a whole room. There is no key in a
file to leak, none in the repo to redact, and none in devtools to read. The same code path works
with a managed identity when hosted — `az` is simply what a laptop has.

✅ **Instructions are set server-side, in the mint request.** They are the assistant's brief *and*
its guardrails, and a client that could rewrite them could talk the model out of every rule in
§2.2 — including the one about never naming a pilot. The browser chooses only what the assistant
**can do**; it does not choose what it is told.

✅ **It drives the app.** Six tools: list places, fly to one, run the tour, enter drone mode, control
the replay, and fetch the facts. "Zeig mir den Startplatz" moves the mountain rather than describing
it. The actions are the *same functions the buttons call*, so the assistant cannot drift from what
the interface does.

✅ **It may not invent a number.** Every factual tool returns data the app already holds — the Mode D
snapshot out of Direct Lake, the live traffic, the flight's derived figures — and the instructions
forbid answering a numeric question from memory. §2.2.6 applied to a component whose entire failure
mode is fluent invention: a paragliding app that confidently states a wrong cloud base is worse than
one that says it does not know. The day snapshot moved to `src/day/snapshot.ts` so the assistant and
the panel read the *same* numbers rather than two copies that could drift.

⚠️ **`VOICE_BY_LOCALE` was wrong and would have 400'd.** It carried
`de-DE-SeraphinaMultilingualNeural` under a comment calling it the realtime voice. That is an Azure
**Speech** name; the realtime API has its own short list (`marin`, `cedar`, …) and rejects anything
else. The realtime voices now live in `src/voice/assistant.ts`; the model speaks whatever language
it is addressed in, so the locale picks a timbre and the instructions pick the language.

⚠️ **`getUserMedia` does not reject when the permission prompt is ignored.** It never settles, and
the panel sat on "connecting" for as long as the tab was open — which reads as a hang rather than as
a question waiting to be answered. Found by driving it from Playwright, where the prompt is never
answered at all. There is now a distinct *"Mikrofon freigeben"* state and a 20-second bound on the
whole connect.

⏳ **Usually unavailable in the published app**, like Mode C and Mode D: static hosting cannot mint a
secret. Third time this pattern appears, same answer each time — state the limitation, keep
everything else working.

### Phase 7 — Second site and deploy — **done, bar the deploy sign-off**

`config/aoi/tegelberg.json`, full pipeline run, the swap demonstrated. i18n sweep (DE/EN), a11y, Playwright e2e **with the mandatory GPU launch flags**, then `npx rayfin up`.

**Outcome and measurements: §4.4.** The site itself was cheap — one JSON file, no new fetchers, all assets smaller than Oberstdorf's. The expensive part was the five AOI leaks it exposed, listed there.

**Four pipeline bugs surfaced too, three of which had been latent since earlier phases** and were invisible only because Oberstdorf's assets were already cached:

- **`fetch_osm_landuse.py` imported a module deleted in the flood-residue cleanup.** Never noticed, because the step had already run for the only site that existed. Fixed by extracting `tools/geodata/overpass_client.py` as the one shared Overpass client.
- **`build_landuse.py` had an unterminated docstring** — my own cleanup edit closed a docstring mid-sentence, orphaning the rest of it as code. Same reason it stayed hidden.
- **The pipeline ran steps with `cwd=tools/geodata`**, so every step with a repo-root-relative default wrote into `tools/geodata/data/...` and then failed to find its own output, blaming the previous step. Now `cwd=ROOT` plus `os.chdir(ROOT)`, and a `preflight()` that **compiles every step and checks its imports before anything is downloaded** — the three bugs above would all have been caught in two seconds instead of after a 568 MB download.
- **Land cover was not per-AOI.** `data/raw/osm/landuse.json` was one shared file, so the second site painted the first site's polygons onto its own grid and reported `mapped 0.0% of the AOI` while cheerfully claiming to have painted 1087 rings. Now `data/raw/osm/<aoi>/landuse.json`; Tegelberg maps 93.5 %.

Also: **`fetch_trees.py` and `build_vegetation.py` were never pipeline steps.** Both were already `--aoi`-aware, had been run by hand once for Oberstdorf, and were then forgotten — which is indistinguishable from working until there is a second site to build. A second site would have shipped without a single tree. Both are registered steps now.

The pattern in all six: **one instance of anything cannot tell you whether it is configurable.** The second AOI was worth building for the bugs alone.

*Airspace (decision 11) attaches here or later, if it attaches at all.*

### Phase 8 — One world, both sites — **done 2026-07-30**

The two AOIs are one continuous terrain. Choosing another site **flies the camera** across the 24 km between them instead of reloading the page — a reload asserts two separate maps; a flight shows the ground that connects them.

#### The gate: does 2× the geometry still hold 60 fps? **Yes.**

Measured with a temporary spike (`?spike=<aoi>` in `scene.ts`) that loaded and correctly placed the second core in the live scene — real data, real textures, real placement, rather than a synthetic benchmark. Both samples taken **after a 9-second settle**, same session, same 1600 × 900 viewport:

| | one core (today) | **both cores** | cost |
|---|---|---|---|
| frame rate | 60.0 fps | **60.1 fps** | — |
| median | 16.7 ms | 16.7 ms | vsync-capped |
| p99 | 18.6 ms | **19.0 ms** | +0.4 ms |
| frames over 20 ms | 0 % | **0 %** | — |
| JS heap | 114 MB | **132 MB** | +18 MB |

⚠️ **The first attempt at this measurement was wrong, and it was wrong in the direction that would have killed the phase.** Sampling immediately after load gave a p95 of 50 ms and 40 % of frames over 20 ms — an apparently disqualifying result. Re-measuring the *baseline* under the same conditions produced the same jank (p90 49.5 ms, 16.5 % of frames over 33 ms), which proved the tail was environmental contention and not the second core at all. **A one-sided measurement of a regression is not evidence of a regression.** The rule from §8 about foreground windows was not enough here: the window *was* foreground and rAF was *not* throttled — it simply needed a settle period and a like-for-like control.

The spike has been removed. It answered its question, and a debug path behind a URL flag is how dead code survives.

#### What the gate did *not* buy — the real scope, measured

The cores are 24.4 km apart and **the two shells miss each other by 3.8 km**, so there is a genuine hole between the sites rather than a seam to delete. A union shell is therefore required, not optional:

| | value |
|---|---|
| union shell extent | 10.10–10.95 E, 47.30–47.72 N — **63.9 × 46.8 km** |
| mesh at 30 m, 3× decimation | **368k vertices** (replaces both existing shells) |
| Copernicus tiles needed | `N47_E010` — **already downloaded**, no new fetch |

The remaining work is a real refactor, and the awkward part is the shader rather than the loader:

1. **`shellMaterial.ts` assumes exactly one core.** It takes `uCoreHeight`, `uCoreRect` and `uBandM`, discards the shell inside the core rectangle, and feathers shell elevation into the core's edge over a 1 200 m band. Two cores means two rectangles and two heightmap samplers. Tractable because the cores are 24 km apart — a fragment is near **at most one** of them, so it is a selection rather than a blend — but it is shader work on the piece that hides the seam, which is the most visually unforgiving part of the app.
2. **`build_shell.py` is per-AOI end to end** — it resamples that AOI's Copernicus window and measures the seam offset against that AOI's core. A union shell needs a union resample and a **per-core** offset (measured: −0.07 m at Oberstdorf, −0.55 m at the Tegelberg), applied near each core rather than one global figure.
3. **Loading.** Both sites' assets already ship (the deploy is 64.7 MB), but a session currently fetches ~38 MB. Loading both cores eagerly would roughly double first paint, so the far core should stream while the camera flies — the flight is several seconds, which is close to the budget the 28 MB core needs. **The flight pays for the load.**
4. **The dropdown** stops calling `switchAoi()` (which reloads) and becomes a camera flight; `?aoi=` keeps working as the initial target.

Two things improve as a side effect: Mode C's wrong-area guard (§4.4) becomes unnecessary *by construction*, because one world means one relay filter rather than two that can disagree; and the AOI-as-configuration claim gets **stronger** — "add a JSON file and a new region appears in the same world" beats "reload into a different world".

The known weakness: between the cores you would fly over 24 km of shell with no drape. That boundary exists today and the transition band was tuned for it, but today nobody ever crosses it — in one world it becomes the centrepiece of the demo.

#### What was built

`config/world/allgaeu.json` defines the world: the sites in it and the union shell. It is deliberately shaped like an AOI config, so every Python helper works on it unchanged — the only genuinely new concept is `sites`.

| piece | what changed |
|---|---|
| `build_shell.py --world` | resamples the union window and measures the seam against **every** site's core |
| `shellMaterial.ts` | two core slots, selected by nearest — `uCoreCount` promotes from 1 to 2 |
| `terrainLoader.ts` | a core can take its shell from the world, or skip the shell entirely |
| `scene.ts` | far cores stream in after first paint; `flyToSite()`; places resolve per site |
| `TwinShell.tsx` | the switcher sets state instead of reloading, and keeps the URL in step |

**The seam offset is pooled, not per site.** Measured: −0.07 m at Oberstdorf, −0.55 m at the Tegelberg, and −0.29 m applied world-wide over 58 841 pooled ring cells. What is being removed is the systematic EGM2008-vs-DHHN2016 datum difference, which is a property of the region rather than of one valley; the sub-metre residual at each boundary is what the 1 200 m transition band already absorbs. The per-site figures reproduce the single-site builds **exactly**, which is the check that the union resample did not shift anything.

**The far core loads after the first frame, not before it.** Both sites' assets already ship, but a session only needs the one you are looking at to draw; fetching a mountain 24 km away up front would roughly double time-to-first-paint. Until it arrives the shell simply covers that ground — truthful rather than merely tolerable, because with no core loaded there the shell **is** the terrain.

#### What broke the moment the reload went away

⚠️ **The §4.4 AOI leak came straight back, in a form only this change could produce.** A reload used to guarantee that the previous site's content was gone — the browser threw the whole app away. Flying keeps the component mounted, so arriving at the Tegelberg left **Oberstdorf's 98 km flight and its barogram on screen**, under a header naming a different mountain. `DayPanel` had the same fault one component along: it read the AOI once with an empty dependency list, which was only ever correct because switching site reloaded.

Both are fixed by clearing on the way in *and* on the way out, and `e2e/aoi.spec.ts` now pins it with a sentinel that cannot survive a page load — so the test proves both that the content followed **and** that nothing reloaded. Found by looking at the screen, not by a failing test, which is the third time this class of bug has been caught that way.

The lesson generalises: **removing a teardown removes every cleanup that was silently relying on it.** The reload was doing work nobody had written down.

### Phase 9 — **Jetzt am Berg**: live webcams and live wind *(Mode F, decisions 26 and 27)*

The first thing in this app that is **live ground truth rather than survey**, and it inverts the usual risk. Everything so far is reproducible: run the pipeline again and get the same terrain. These two layers are read from somebody else's sensor, over the network, at the instant you look — and they will be wrong, stale or missing on stage at some point, so that path is designed first rather than patched in later.

**Gate order matters here, and it is not the fun order.**

**9a — Licence and availability, before any code.** Both halves are blocked on the same question, and it is the one most likely to kill a feature outright:

1. For each candidate webcam: operator, exact URL, licence text quoted, embedding permitted?, link-out required?, permission needed? → `NOTICE.md`. **§5.9 names no operator on purpose; that list gets built by looking, not by remembering.** ✅ **Run 2026-08-02 — and it passes.** A camera stands ≈ 30 m from the Nebelhorn launch and ≈ 80 m from the Tegelbergbahn Bergstation, with bearings that cross-check against the operators' own captions. Links are explicitly welcomed; embedding needs written consent. §5.9 has the quotation and both AOI configs carry the positions.
2. For wind: does a licensed station actually exist *at* the Nebelhorn and Tegelberg launches?

✅ **The wind half of 9a has been run, and it failed — usefully.** §5.10 has the measurements. In short: OGN is in the wrong valley, **DWD is in the right valley and 907–1 414 m too low**, and Holfuy is the only candidate in the right place but forbids automated collection without a granted key — so its availability and its permission are one question, and that question is an email rather than a script. **Mode F's wind half is blocked on `info@holfuy.hu`, not on code.**

✅ **The webcam half has been run too, and it passes.** §5.9 has the detail. A camera sits ≈ 30 m from the Nebelhorn launch and ≈ 80 m from the Tegelbergbahn Bergstation, both with verified bearings, from an operator who forbids copying the images and **explicitly welcomes links**. So Mode F ships **asymmetrically at first**: webcams now, wind when somebody answers an email.

That asymmetry is worth stating rather than smoothing over, because it is the phase doing its job. Two halves of one mode, gated the same way, and the gate returned different answers — one buildable today, one not buildable at all yet. Building both blind would have produced a working camera marker beside a windsock with nothing in it.

That is the phase working as intended. The cost of finding out was one afternoon of reading terms and one station-list download; the cost of not finding out would have been a windsock with nothing to put in it.

If a site has no licensed camera or no station at the launch, **it ships without one and says so.** Mode F is allowed to be asymmetric between the two AOIs; it is not allowed to invent coverage. This is the same call as the Tegelberg's missing flight and its missing Mode D (§4.4) — absence stated plainly beats a borrowed substitute.

**9b — Placement, verified not recalled (§4.2).** A webcam marker asserts *"the camera is here, looking that way"*; a windsock asserts *"this is the wind at this launch"*. Both are precise claims about the world and both are resolved from operator metadata or OSM, never estimated. Where a bearing cannot be established, the marker has no direction rather than a plausible one.

✅ **Built for the webcam half, 2026-08-02.** `src/twin3d/webcamLayer.ts` draws both cameras from the positions and bearings §5.9 verified against the OSM API, `WebcamCard` opens the operator's page in a new tab, and a `Webcams` toggle sits with the other layers. **One layer for the whole world, not one per site** — positions are absolute WGS84 projected into world metres exactly as live traffic is, which removes the per-site code path that has broken on the second site four times already (the tour, the far core's layers, Mode D's aggregation, the layer toggles).

⚠️ **Two things were wrong and only flying there found them**, which is the argument for the render check rather than the type check:

* The marker floor was 25 m. The geometry is ~1.3 units tall, so that drew an eight-storey post on a mountain top. Now 8 m; past ~730 m the screen-fraction rule takes over and nothing looks smaller at a distance.
* "Camera position" was read as *behind the camera*, and the field-of-view wedge — 27 m of flat amber lying in exactly the direction the button wants you to look — spread across half the panorama. The wedge is a label for someone looking at the camera **from outside**; from the camera's own viewpoint it is only in the way. The eye now goes slightly in front of the marker, and the view opens clean.

The obstruction in that view turned out to be **two** objects, and separating them mattered: the dark band across the frame was the **cableway**, not the marker. Toggling one layer at a time is how that was established rather than guessed.

Tested at four bearings, and the bearing assertion was **mutation-checked** (`Math.PI -` → `Math.PI +` makes it fail with `expected -1 to be close to 1`) because a mirrored yaw draws a perfectly confident wedge pointing at the wrong valley and nothing about the picture says so.

**9c — Freshness as a first-class state.** Every reading carries its own timestamp and is rendered with it. Three states, all styled and all tested: **current**, **stale** (shown, clearly marked, with its age), **absent** (said out loud). Reuse the Mode C vocabulary — this is the same problem, and the `wrong-area` guard is the precedent for refusing rather than displaying.

**9d — Rendering.** Webcam markers as clickable objects at their surveyed positions; wind as an arrow or sock at the station, scaled by speed with gust shown separately. Both are per-AOI config, like everything else since phase 7 — a new site brings its own cameras and stations in its JSON, or brings none.

✅ **Webcam half done** (see 9b). Verified in the browser at **both** sites: markers render with the direction wedge, clicking one opens its card with the right page, the toggle hides them and closes the card, and a hidden marker is **also unpickable** — an invisible object that still answers clicks is a trap, not a feature. Wind half still waits on the email.

**9e — Mode E must not guess.** The assistant is instructed never to state a figure it was not given. Live wind hands it a number that is **only valid for a few minutes**, which is a new failure mode: quoting a correct-but-stale reading as current. The `fakten` payload carries the age, and the assistant reports the age with the number or declines.

**Explicitly not doing:** interpolating a wind field between stations, projecting webcam images onto the terrain (an `ND` licence forbids it and a bad projection looks like a survey product), or storing webcam images. Wind readings *may* later flow into the lakehouse to give Mode D a measured-versus-forecast comparison — that is a genuine Fabric story, but it is phase 9's sequel, not phase 9, and it needs the schedule question settled first.

⚠️ **Nothing here draws standing capacity.** No Eventhouse, no scheduled job — live means fetched on demand while the page is open.

---

## 8. Carried-over engineering rules

Non-negotiable, learned the hard way in Flut-Insights:

- **The three.js scene has no lights.** Every material bakes its own shading. A `MeshLambertMaterial` renders black.
- Heightmap is **mirrored N–S** under `PlaneGeometry` + `rotateX(-π/2)` → sample `vec2(u, 1.0 - v)`.
- Never size a progress bar from `Content-Length`. Derive expected bytes from metadata and declare every size before fetching.
- Never name a pre-compressed asset `.gz` — Vite sets `Content-Encoding`, the Fabric static host does not. Use `.u8z` and sniff the `1f 8b` magic.
- Don't scale object heights by terrain exaggeration; pass `aGround` per vertex/instance.
- Chunk InstancedMeshes per ~1 km cell with their own bounding spheres.
- E2E: never assert animation progress after a fixed wait — `expect.poll` with a 30–40 s budget. Compare frames **inside** the browser; never colour-classify pixels.
- Playwright GPU flags are mandatory: `--use-angle=default --enable-gpu --ignore-gpu-blocklist` + `ignoreDefaultArgs: ['--disable-gpu']`. Without them the suite runs on SwiftShader at 884 ms/frame.
- **Never measure frame rate in a browser window that is not in the foreground.** Chromium throttles requestAnimationFrame to ~1 Hz for an occluded window and still reports `visibilityState: 'visible'`, which is indistinguishable from a catastrophic rendering bug. Check rAF against `setTimeout` before touching a shader.
- Windows: multi-line inline PowerShell in the terminal tool is mangled — write a `.ps1` and run `pwsh -NoProfile -File`. Force UTF-8 no BOM on every file write.
- **No coordinate enters config without being looked up.** A recalled Oberstdorf was 4.4 km off.

**Fabric-specific, carried forward from the deleted flood scripts** (the scripts were an insurance portfolio model and an Ahr gauge feed, so they went — these lessons did not):

- **Direct Lake partitions must OMIT `schemaName` on a non-schema-enabled Lakehouse.** Tables sit at `Tables/{name}`; writing `schemaName: dbo` points at a non-existent `Tables/dbo/{name}` and every table **silently fails to frame** — no error, just empty visuals.
- **Table names are German Title Case with spaces**, and **every measure lives on a dedicated `Measure` table.** The model is what a business user sees, not a database.
- `az rest --subscription` silently resolves to the **CORP** tenant. Acquire tokens explicitly for the MCAPS tenant instead.
- **Token audiences are not guessable — measure them.** For the MCAPS tenant: `https://api.fabric.microsoft.com` ✅ and `https://kusto.kusto.windows.net` ✅, but `https://kusto.fabric.microsoft.com` ❌ is not a resource principal in the tenant at all (AADSTS500011), despite being the obvious-looking audience for a Fabric Eventhouse.
- Verify the model by **querying its measures and comparing against the source**, not by checking the deploy succeeded. A misconfigured Direct Lake partition returns empty rather than failing.
- **A `color` attribute is not optional once `vertexColors` is on.** Setting `vertexColors: true` to get per-instance colours on an `InstancedMesh` switches on the shader's `USE_COLOR` path, which multiplies by the geometry's `color` attribute — and with no such attribute it reads as zero and every instance renders **black**, with the instance colours computed and uploaded perfectly and then multiplied away.
- **A licence can constrain the architecture, not just the footer.** OGN is ODbL *plus* "no redistribution of data older than 24 hours" — which is a statement about **retention**, and therefore about the KQL table, the caching period and what Mode D is allowed to read. It costs nothing until somebody stores the stream, and then it is breached silently. Raw fixes live 1 day; anything longer is an aggregate. Read the terms **before** designing the store, not when writing `NOTICE.md`.
- **Attribution strings are often conditional on what you did to the data.** Copernicus prescribes one notice for redistributing GLO-30 as received and a different one, beginning "produced using Copernicus WorldDEM-30", where it has been adapted. This app resamples and datum-shifts it, so the plain form was the wrong string.

---

## 9. Open questions

**Resolved along the way, kept for the record:**

- ~~AGS for Oberstdorf~~ — never needed. Tile names encode UTM easting/northing in kilometres, so
  the tile list is arithmetic and the Metalink catalogue is only an optional integrity check.
- ~~Launch and landing coordinates~~ — resolved from Overpass in phase 2: four launches and two
  landing zones, all inside the core, all with published elevations to check the terrain against.
- ~~DOP20 streaming fetcher~~ — unnecessary. DOP20 is served by a WMS, so the drape is requested at
  the AOI extent and the resolution actually used: 12.8 MB rather than ~6 GB.

**Still open:**

1. **Does OGN actually show FANET traffic over the Nebelhorn, and at what rate?** (Phase-4 spike.)
   Survivable either way since decision 15.
2. **ICON-D2 harvest sizing** (§5.5) — how many levels, steps and runs before the daily transfer
   becomes unreasonable. Measure first.
3. **Voice assistant hosting** — where the Foundry realtime backend runs given the app ships as a
   Fabric App, and how the key is kept out of the browser.
4. **Does the Tegelberg box contain Neuschwanstein and Hohenschwangau?** Verify before writing the
   config.
5. **Is one Oberstdorf flight enough for Mode B**, or does DHV-XC need harvesting for a day with
   several flights on it.
6. **Version control.** The repository is not under git and has no remote. Nothing is recoverable
   if the working tree is lost, and `public/terrain/` is gitignored, so a clone rebuilds it from
   the pipeline rather than downloading it.
7. ~~**Is there a licensed webcam at either site?**~~ **Answered 2026-08-02, and this one is a
   yes — for links.** A mapped camera stands ≈ 30 m from the Nebelhorn launch and ≈ 80 m from the
   Tegelbergbahn Bergstation, both with `camera:direction` bearings that cross-check against the
   operator's own captions. foto-webcam.eu forbids copying or altering the images without written
   consent and **explicitly welcomes links**, so the link-out design ships and the embed does not.
   Positions are in both AOI configs. §5.9.
8. ~~**Is there a licensed wind station AT the launches?**~~ **Answered 2026-08-01, and the answer
   is no — not one that can be used without asking.** OGN was already ruled out by measurement
   (one reporting station in a 70 km radius, inside neither AOI). DWD is licensed but its nearest
   stations sit **1 414 m and 907 m BELOW** the two launches — valley floor, not launch. Holfuy is
   the only candidate in the right place, and its terms forbid automated collection without a
   granted API key, so availability and permission are the same question. **The remaining step is
   an email to `info@holfuy.hu`, not code.** §5.10.
9. **What does `t146` mean in an OGN weather beacon?** (§5.10.) Read as tenths of a degree Celsius
   it gives a plausible 14.6 °C, but that is inference. Confirm against the station's own
   published reading before any temperature is displayed — `hbas_sc` is the precedent.
10. ~~**Does the hosted relay show a sky with aircraft in it?**~~ **Answered 2026-08-02: yes.** The
    deployed app was seen carrying two airliners over the Nebelhorn at 12 122 m and 11 495 m, from
    the hosted relay. The empty state and the populated state are now both proven.

---

## 10. Resource discipline

The geodata is regenerated by `python tools/geodata/pipeline.py`, which downloads roughly 400 MB
and produces about 36 MB of browser assets. Everything in `public/terrain/` is gitignored and
reproducible, so a fresh clone shows the setup notice until the pipeline has run once.

The two heavy steps are the DGM1 tiles (~380 MB, cached in `data/`) and the DOP20 drape (a few
minutes of WMS requests). Neither needs repeating unless the AOI changes.
