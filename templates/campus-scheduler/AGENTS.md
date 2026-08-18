# Working on Campus Scheduler

Notes for whoever — or whatever — edits this template next. They are the things that are not
visible from the code, and most of them were learned by getting them wrong first.

## The one rule that outranks the others

**Do not attach fiction to fact.**

This app draws real buildings, at true scale, with their real room numbers on them. Every figure it
shows is therefore read as the university's own. So each dataset carries a provenance stamp
(`measured` / `derived` / `synthetic`), the UI badges anything invented, and several features are
deliberately *withheld* rather than approximated:

- A room with no calendar is **grey, never 0 %** — "unknown" and "empty" are different answers.
- Where lecturers are invented over a real timetable, the app **refuses lecturer-scoped questions**
  and hides the control rather than answering plausibly (`inventedAttributes` in the API response
  says exactly which fields to hide — a list, not a boolean, so the UI hides those and nothing more).
- No course titles are ever generated. A made-up lecture name on a real, checkable room number is
  a false statement about a real place; a badged percentage is not.

If you are about to add a number, decide first whether it is measured, derived or invented, and
make the app say so.

## `config/release.json` — read this before touching data

Three levers decide what a build may carry. The file explains itself at length; the short version:

| Lever | Question |
|---|---|
| `navigatumData` | May the TUM campus's interiors be real, invented, or absent? |
| `excludeAois` | Should a site appear at all? |
| `realCustomerData` | May a university's own timetable export ship? |

**Both halves read the same file** — `src/config/release.ts` for the app and
`tools/geodata/pipeline.py` for the build — because the failure mode this exists to prevent is a
build that withholds a source in the UI and ships the assets anyway.

**Every lever fails closed.** An unrecognised value, a typo, a missing key: all withhold. Withholding
too much is a visible, harmless mistake. The other direction is not.

Two gates check the result, and they answer different questions:

```bash
npm run check:release                      # is the switch set correctly, and does the disk agree?
python tools/verify_publishable.py         # is there anything in this tree we do not know about?
```

The second one opens **every file git would carry, as bytes** — no extension filter, no folder
skipping. Narrower versions of that idea have passed in this codebase's history while the withheld
name was still on screen. Generated assets and compiled bundles are exactly where a name re-enters
after somebody fixes a generator's *output* instead of the generator.

## Testing

```bash
npx tsc -b                                 # types
npx vitest run                             # unit
npx playwright test --project=fast         # the quick e2e project
python tools/tests/test_<name>.py          # ⚠️ the Python suites are SCRIPTS, not pytest
```

`pytest tools/tests` collects **0 tests and exits 5**. Run each file directly. Set
`PYTHONIOENCODING=utf-8` on Windows or they die printing an arrow.

Playwright runs at `workers: 1` **deliberately** — two workers hold two large WebGL scenes at once
and the machine cannot keep up. Raising it buys speed by making the suite lie.

### What a test here is expected to do

- **Assert rendered state, not the flag.** A lens test that checks `aria-pressed` passes just as
  happily with 6 417 buildings still tinted. Sample the canvas.
- **Carry a mirror.** A test that something is withheld should be paired with one that the
  equivalent thing is still *offered* where it should be — otherwise blanking the feature
  everywhere passes.
- **Be sabotage-checked before it is trusted.** Break the thing on purpose, watch the test fail,
  put it back. Several guards in this repo were written, passed, and were later found to be
  incapable of failing.
- **Derive its fixtures from the data**, not from a seed value. The datasets are regenerated; a
  test pinned to a lecturer id fails for a *correction* and reads as a regression.

## Building the geodata

```bash
python tools/geodata/pipeline.py --aoi oth-regensburg --list   # what runs, and what is skipped
python tools/geodata/pipeline.py --aoi oth-regensburg
```

Everything comes from official open data — no map service, no tile server, no token, at build time
or at run time. Sources and licences are in [NOTICE.md](NOTICE.md); the third-party Python
dependency list is numpy, pillow and scipy, and that is all of it.

`tools/geodata/verify_registration.py` runs as part of the pipeline and **fails the build** if the
generated terrain disagrees with published elevation references. Georeferencing errors are
otherwise completely silent: everything renders, and it is in the wrong place.

⚠️ `public/terrain/` is gitignored, so **git cannot undo a bad rebuild**. Snapshot before, hash-diff
after.

## Things that will cost you an afternoon

- **`npx vite` / `npx tsc -b` directly.** The npm scripts have Rayfin pre-hooks that want auth.
- **Backticks inside a GLSL template literal terminate the string.** Recorded four times.
- **`THREE.Texture.flipY` defaults to `true`, `THREE.DataTexture.flipY` to `false`.** Mixing them
  renders one raster mirrored, and it looks like a coordinate bug in the layer that is correct.
- **A drape shipped with mipmaps renders BLACK** at every distance, with no error and nothing
  logged.
- **`RawShaderMaterial` declares nothing.** Using `normal` without `in vec3 normal;` fails to
  compile, draws nothing, and leaves `mesh.visible === true`. Never assert a renderer on
  `.visible`; assert on pixels.
- **The frontend and the backend deploy separately.** A container image proves nothing about the
  bundle, and vice versa. Deploy both, then verify the running system —
  `node tools/verify_deploy.mjs --url <hosting URL>`.
