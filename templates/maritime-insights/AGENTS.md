# AGENTS.md — working rules for this repository

Read `PLAN.md` before changing anything. §1.0 and §3 are binding and outrank convenience.

## The three rules that are not negotiable

1. **No customer, account, company or programme name.** Not in code, plans, comments, tests, fixtures
   or **commit messages**. Value is expressed by buyer archetype (PLAN §1.1–1.2). The repo is headed
   for a public template and git history cannot be cleaned later without a rewrite.
2. **Geometry, not a radar model.** The app computes a 4/3-earth horizon against measured terrain.
   No RCS, no clutter, no propagation anomaly, no detection probability, no product performance —
   in any build, including one running in a customer's own tenant. That physics is theirs to model.
3. **No invented data.** If a figure is not published, the app says so rather than interpolating
   something plausible. A demo that quietly fabricates is worse than a demo with a visible gap.

## Data rules

- **Register a source in `NOTICE.md` before using it.** That file is a gate, not documentation.
- **No coordinate is ever recalled.** Everything in `config/aoi/*.json` comes out of
  `tools/geodata/resolve_places.py` and carries the OSM element it came from.
- **Reachability is not availability.** Two sources here answer HTTP 200 with an empty payload
  (a regional Overpass mirror, and the tile index when throttling). Treat empty as failure.
- **Vessel identity is a build setting, not a constant.** `fetch_ais.py --identity` and the
  relay's `AIS_IDENTITY` choose between `full` (MMSI, name, call sign, IMO, destination, draught —
  the default), `commercial` (identity for commercial traffic, pseudonyms for pleasure and sailing
  craft) and `anonymous`. All three are supported; the app reads what the data carries and says
  which it is. **Never write a claim about identity that the setting could falsify** — a notice
  saying "no names, deliberately" beside a named ship costs the reader's trust in every other
  notice on the page.
- **Naval vessels are pseudonymised in every mode.** Rule 3 of PLAN §3.2 — never a way to find a
  warship — outranks the identity setting and was not withdrawn with it. Detected by ship type
  *and* by name (`GERMAN WARSHIP …`), decided **per vessel, never per row**: identity fields only
  appear on sparse static messages, so a per-row test splits one hull across two keys and silently
  changes every passage count downstream.
- **`public/` is the public internet.** Anything §3 forbids showing must not live under it, and
  the Entra gate protects the *app*, not the bytes. In `full` mode `public/terrain/*/tracks.json`
  carries vessel names — a bounding-box subset of an archive the Danish Maritime Authority already
  publishes openly. If that ever stops being the intent, rebuild with `--identity commercial`.

## Engineering rules inherited from the sibling repos, already paid for

- **Registration is a build gate, not a report.** A coverage shadow over a misregistered coast looks
  authoritative, which is worse than no map. The cheapest check here is free: **any AIS track on
  rendered land means something is wrong.**
- **True scale by default.** Exaggeration is a claim the survey does not make — and with only ~90 m
  of relief in this AOI, exaggerating the coast would exaggerate the shadow the demo is about.
- **VRAM, not megabytes, is the ceiling.** A 12 MB drape JPEG is 238 MB of RGBA on the GPU. Ship
  KTX2. A texture over `MAX_TEXTURE_SIZE` fails *silently* — assert dimensions in code.
- **Never name a pre-compressed asset `.gz`.** Dev servers set `Content-Encoding` on it and
  production hosts do not; same file, opposite behaviour. Use a neutral extension and detect the
  `1f 8b` magic by content.
- **Custom-shader scenes have no lights.** A standard material renders black. Repeat the same sun
  vector in every material.
- **Verify rendered output with rendered pixels.** In a sibling repo, type-checking, 54 unit tests,
  57 e2e tests and lint were all green while the app drew the entire valley wrong.
- **A minified bundle will not give up its endpoints to static analysis.** Load the page and capture
  the network. That is how this repo's tile index was found, and it takes minutes.

## Python tooling

Standard library plus `numpy`, `pillow`, `scipy` — see `tools/requirements.txt`. No GDAL, no pyproj,
no rasterio: the UTM transform is implemented directly in `tools/geodata/utm.py` so that nothing
stands between a fresh checkout and a working pipeline.

⚠️ On Windows, write scripts to a file and run them; PowerShell mangles multi-line `python -c` with
quotes, and PowerShell 5.1 file I/O is cp1252 unless told otherwise, which silently corrupts umlauts
on a round trip.
