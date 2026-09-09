# Demo assets

Produces [media/campus-insights-demo.mp4](../../media/campus-insights-demo.mp4) (68 s, narrated)
and [media/campus-insights-demo.gif](../../media/campus-insights-demo.gif) (17 s, silent).

The recording is made against the **deployed** app, not the dev server, so what the video shows
is what a viewer would get from the Fabric App URL.

## Two stages, on purpose

| | Script | Cost | Re-run when |
|---|---|---|---|
| A — record | `record-campus.mjs` | minutes | the visuals or the beats change |
| B — dress | `build-campus.ps1` | seconds | narration, voice, pacing or the GIF window change |

Stage A writes a raw `.webm`. Stage B never re-records — it trims, speeds, muxes and quantises
that same file. Iterating narration is therefore cheap, which is the whole point of the split.

## Running it

```powershell
# 0. voice-over (edge-tts, in the repo venv)
python -m edge_tts --voice en-US-AndrewNeural --file narration-campus.txt --write-media vo-campus.mp3

# 1. stage A — needs a Fabric-authenticated Edge profile
node record-campus.mjs

# 2. stage B — re-derive the cut points first (see below), then
powershell -File build-campus.ps1 -WorkDir C:\Users\alkorn\repos\temp\rec
```

`ffmpeg`/`ffprobe` must be on PATH. `-WorkDir` is where the raw capture, the voice-over and `out/`
live; it defaults to `CAMPUS_REC_OUT`, then to `temp/rec`. The recorder profile defaults to a
signed-in copy under `temp/rec/`; override with `CAMPUS_REC_PROFILE`, `CAMPUS_REC_BASE`,
`CAMPUS_REC_ACCOUNT`, `CAMPUS_REC_OUT`.

## The cut points are not arbitrary

`build-campus.ps1` defaults to the cut points of one particular take. If stage A is re-run they
**must** be re-derived, because the raw take drifts by seconds between runs. Pass them as
parameters (`-Raw`, `-A0`, `-A1`, `-B0`, `-B1`, `-ASpeed`, `-BSpeed`) or edit the defaults. The
method:

1. **Find the narration beats.** `ffmpeg -i vo-campus.mp3 -af silencedetect=noise=-40dB:d=0.35`
   prints the pauses. The isolated 0.75 s clip at 45.95–46.70 is `"Now switch site."` — that is
   the moment the picture has to change, and everything else is fitted around it.
2. **Find the dead frames.** Sample the raw file one frame per second and look at PNG file
   sizes; a black canvas is ~200 KB against ~1.8 MB for a rendered one. This is much faster than
   watching, and it is how the Tübingen load window is found each time.
3. **Fit each segment to its own beats.** Segment A must play at **1.0×**: it is timed against
   narration that starts at zero, so any speed change slides the site cut off the words. Segment
   B is then fitted independently, so the Sanierungsstau beat and the closing line land where the
   voice expects them.

For the take the defaults describe:

```
A  raw 32.747 → 78.6     Garching: wide shot → explode → rooms → flow      1.000×
   raw 78.6   → 85.6     CUT — site load, black canvas
B  raw 85.6   → 111.5    Tübingen: reveal → condition lens → 2040 → settled  1.113×
```

⚠️ **Do not expect the two speeds to come out equal.** One earlier take happened to fit a single
uniform speed once the black was excised, and that got written down here as if it were a property
of the method. It is not — it depends entirely on how long the Tübingen half happens to run. What
is fixed is that A is 1.0× and B absorbs the difference.

## Things that cost time here

- **Don't verify a render by watching it.** Extract frames and check them, or check sizes.
- **A warmed site still switches slowly.** Loading Tübingen once beforehand avoids the 27 MB
  download but not the scene rebuild — the canvas is still black for ~7 s.
- **Keep rolling past the last scripted action.** The best frame in the take is the settled
  Altstadt shot *after* `WALK-END`, and the finished cut uses it.
- **Long chained ffmpeg invocations break in PowerShell.** That is why stage B is a script file
  and not a command line.
- **Re-record after any change to how the scene LOOKS.** The first cut of this video outlived a
  flow-visibility fix and a building-height correction, and for a while the repo was shipping a
  demo that rendered buildings 35% taller than the app does — in a project whose whole claim is
  that the numbers come from a survey. Stage A is cheap enough that there is no excuse.
