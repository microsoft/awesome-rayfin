# Phase 6 — semantic model and Power BI surface

The gate: **model and app agree on every headline figure.** Easy to claim, rarely checked, and the
whole reason this phase exists — a number quoted in a meeting should be the number on the screen.

## The gate is a script, not an assertion

`tools/fabric/verify_model_agreement.py` computes every headline figure **twice, independently**:

* the **app** side, in Python, transliterating `deriveBeats()` and the `App.tsx` definitions, read
  from the same shipped asset the browser downloads;
* the **model** side, in DAX over Direct Lake tables in Fabric.

```
headline figures
  ok    Fahrten                            app=261        model=261
  ok    Positionen                         app=44084      model=44084
  ok    Verkehrsspitze (Stunde)            app=19:00      model=19:00
  ok    Verkehrsspitze (Schiffe)           app=63         model=63
  ok    Ruhigste Stunde                    app=07:00      model=07:00
  ok    Ruhigste Stunde (Schiffe)          app=16         model=16
  ok    Ø Geschwindigkeit (kn)             app=7.7        model=7.7
  ok    Gewerbliche Fahrten                app=101        model=101
  ok    Median Fahrtdauer (min)            app=61.0       model=61.0

vessels under way, every hour of the day
  ok    all 24 hours agree  (min 16, max 63)

vessel class mix
  ok    all 13 classes agree

PHASE 6 GATE PASSED — model and app agree on every headline figure
```

It exits non-zero on any disagreement. It is designed to fail if either implementation drifts.

## 🔴 The source is the shipped asset, not the raw feed

The Delta tables are built from **exactly the bytes the browser downloads** — `tracks.binz` and
`tracks.json` — not from the original 725 MB archive. That is deliberate: a model rebuilt from the
raw feed could agree with the *data* while disagreeing with the *app*, and the gate would pass
while the point of the gate failed.

## The definition that would have broken it

`Vessels Under Way` is an **interval overlap**: a passage counts for an hour it crosses, even if it
happens to report no position inside that hour. Grouping positions by hour is the obvious
implementation, it is easy, it produces plausible numbers, and it is wrong. That is why `Hour` is a
**disconnected** dimension and the measure filters passages by their own interval:

```dax
Vessels Under Way =
VAR HourStart = MIN('Hour'[hour_start_second])
VAR HourEnd   = MAX('Hour'[hour_end_second])
RETURN
CALCULATE(
    COUNTROWS('Passage'),
    FILTER(ALL('Passage'), 'Passage'[from_second] < HourEnd && 'Passage'[to_second] >= HourStart)
)
```

Two implementations of one definition, checked against each other. Without the check this is where
the numbers would silently part company.

## Grain, stated because it is easy to misread

**One row per position, one row per passage.** The shipped asset carries no vessel identity at all —
Phase 3 dropped MMSI, name, call sign, IMO and destination at ingest — so the model **cannot count
distinct vessels and does not pretend to.** It counts passages, exactly as the app does, and the
report footnote says so.

Privacy therefore needed no new enforcement here: there is nothing left to strip. That is what
filtering at the exporter buys you three phases later. The builder still asserts it, rather than
trusting the claim.

## What was built

| Item | |
| --- | --- |
| Lakehouse | `MaritimeInsightsLakehouse` |
| Delta tables | `vessel_position` 44 084 · `vessel_track` 261 · `hour_of_day` 24 · `vessel_class` 13 |
| Semantic model | Direct Lake on OneLake, 12 measures on a dedicated `Measure` table |
| Report | one page, IBCS hourly profile + class mix + AIS density map |

Written straight to OneLake with delta-rs over `abfss://` — no staging, no Spark session.

## Chart choice

The house IBCS rule: the category is time, so the hourly profile is a **column** chart. The
reference tier is **the day's own average**, not a prior period — with a single day there is no
prior period, and manufacturing one would be notation without information. Variance against the
daily mean is a real comparison, and the profile genuinely varies around it: red below the mean all
night, green from noon, peaking at 19:00.

Class mix is a structural category, so it is a bar chart. Same rule, other branch.

## 🔴 Six failures worth recording

1. **TMDL multi-line measures.** Everything after `=` on the same line is the whole expression, so
   a multi-line measure must put *nothing* after the `=` and indent its body. Otherwise the second
   line parses as a property: `UnsupportedObjectType — VAR is not a supported property`.

2. **DAX resolves model column names, not `sourceColumn`.** `'Position'[speed_kn]` deploys happily
   and fails only at query time; the model column is `Speed kn`. TMDL will not catch this.

3. **A Direct Lake model must be framed before it can be queried.** Deploy reports *Succeeded*,
   the tables sit in the definition, and every query returns `Cannot find table` — which reads
   exactly like broken TMDL and is not. `build_semantic_model.py` now reframes as part of
   deploying, because this is not something to remember.

4. **`resourcePackages` item type is `CustomVisualMetadata`**, with `name == path ==
   "<GUID>.pbiviz.json"`. Wrong type fails the import with a bare *"does not match any schemas
   from 'anyOf'"*.

5. **The IBCS data role is lowercase `category`** with `active: true`. Title-cased `Category`
   imports cleanly and renders **"No data"**.

6. **`general.maxVisibleCategories` defaults to 10.** The chart showed 00:00–09:00 at *any* width
   and looked like a complete day — while omitting its own peak. The visual's capabilities allow
   30 000 categories; the display cap is what clips. This is the most dangerous kind of defect,
   because nothing errors.

Also: the map. Binding latitude into `Category` makes the visual treat it as Location and refuse to
plot pairs; binding `Sum(latitude)` puts one bubble in the Atlantic. Positions are now binned to a
~550 m grid, which is both a sane cardinality and the right visual — a density picture of the
fairway rather than 44 084 unplottable points.

## Verified in the Service

Report opened in Power BI, screenshotted, and checked for error tiles and "No data" — a REST
publish succeeds happily on a broken report. The chart's own numbers were then cross-checked
against DAX rather than read off the image: 18:00 = 38, **19:00 = 63**, 20:00 = 55, matching the
column heights and the gate.

## Reproducing

```bash
python tools/fabric/build_lakehouse_tables.py     # shipped asset → Delta on OneLake
python tools/fabric/build_semantic_model.py --deploy   # TMDL → Direct Lake model, then reframe
python tools/fabric/build_report.py --deploy      # PBIR + bundled IBCS visual
python tools/fabric/verify_model_agreement.py     # the gate
```

## Open

- **One page.** Port dwell, canal queue length and a passage-duration distribution are the obvious
  next analytics, and the model already carries what they need.
- The visibility figures (`km² einsehbar`) are computed per user-placed site in the browser and are
  deliberately **not** in the model — there is no site until someone places one, so there is
  nothing to precompute. Phase 8's reporting layer is where that would change.
- Vessel-level analytics remain impossible by construction, and should stay that way.
