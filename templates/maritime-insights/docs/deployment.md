# Deployment — Rayfin Apps

**Date** 2026-07-29 · **Status: live, rendered, and measured.**

> Tenant, workspace and item identifiers are deliberately not recorded here — they are specific to
> one deployment and this repo is published as a template. Substitute your own.

| | |
|---|---|
| App URL | `https://<your-app>.webapp.fabricapps.net` |
| Workspace | your Rayfin Apps workspace |
| Tenant | your tenant id |
| Item | `maritime-insights` |
| Payload | **53.2 MB, 11 files** |

```bash
npx rayfin up --tenant <tenant-id> --workspace "<workspace-name>" --yes
```

---

## 1. ⚠️ `auth.enabled: false` is rejected by the platform

The first deploy failed at the very last step:

```
[rayfin up] Runtime settings failed: Runtime settings sync failed: 400 Bad Request
   Details: Auth Settings need to be enabled.
```

The item is created before this happens, so a failed deploy still leaves an item behind. The auth
**service** has to be enabled even for an app that never signs anyone in — this app performs no
sign-in of its own and the hosted URL opens without a prompt. `rayfin.yml` records the reason at
the setting, so nobody removes it again.

## 2. What the live app measures

Read from the deployed page, not from the dev server:

| | |
|---|---|
| Renderer | `ANGLE (Qualcomm Adreno X1-85, Direct3D11)` — a real GPU, **not SwiftShader** |
| `MAX_TEXTURE_SIZE` | **16 384** — the 8192 drape is safely inside it |
| Triangles | **6 203 779** |
| Draw calls | **3** (terrain, sea, buildings) |
| **Time to first frame** | **10 761 ms** |
| Canvas pixels | non-black share **1.00**, mean luminance **127** |
| Loading panel / error panel | 0 / 0 |
| Disclaimer present | yes |

**The pixel check is the one that matters.** `data-ready="true"` only says the code ran; reading
back the framebuffer says the GPU actually drew something. A black canvas would pass every DOM
assertion in this list, which is exactly how a sibling repo shipped an entire valley rendered wrong
with 54 unit tests and 57 e2e tests green.

## 3. 🔴 First frame is 10.8 seconds, and that is a real problem

PLAN §4.3 ranks *time to first meaningful frame in a customer meeting* third among the constraints
that actually bind, above deploy time and far above bandwidth. **10.8 s is over budget**, and it is
now a measured number rather than a worry. Three contributors, in the order worth attacking:

1. **13.9 M building vertices are dequantised on the CPU** into a `Float32Array` before the first
   render — three passes over 42 M numbers in JavaScript. This is almost certainly the bulk of it
   and it is fixable: dequantise in the vertex shader from the int16/uint16 attributes directly,
   which is what the quantisation was for.
2. **53.2 MB of payload**, of which 30 MB is buildings.
3. The drape decode (5260 × 8192 JPEG).

The loading indicator exists and reports four stages, so the app reads as busy rather than broken
while this happens — but the fix is real work, not presentation.

## 4. 🔴 The defect the first deploy revealed, and the fix

The first live render showed **a band of speckle along the shallow coast and over the water**.

Cause, and it follows directly from the Phase 1 finding that DGM1 is *not* constant under water:
the survey carries real values there and they **straddle zero** (−11.38 … +0.05 m). At 16 m render
posting, individual shallow cells sit fractionally above the sea plane and poke through it, wearing
the drape's photograph of open water.

**Fix: the land mask decides what is ground.** Sea cells are pushed to 0.5 m below the sea plane
rather than drawn at their measured height. The measured data is untouched — only the rendered
surface is corrected — and this is the same conclusion the drape's WMS banding pointed at:
*the drape is a photograph of the ground, and the sea is not ground.*

Verified by redeploy: the coastline is clean and the water is a single surface.

## 5. The horizon shell, and two rendering faults it exposed

The first deploys ended in a cliff: the photoreal core sat on the sea as a slab. The Copernicus
shell now surrounds it — decimated to 90 m posting, with the core's rectangle cut out rather than
drawn over, and shifted onto the core by a seam offset **measured over land only: +0.581 m**.
(Over *all* overlap cells the median is +0.181 m. Here the water pulls that figure down, where in an
alpine AOI canopy pushed it up by 3.16 m. Either way the all-cells number is not a datum.)

Adding it exposed two faults, both only visible on a rendered frame:

- 🔴 **The shell painted the Baltic as green land.** The sea plane had been sized to the core; the
  shell reaches 79 km. The plane now spans the shell.
- 🔴 **Depth-buffer speckle across the water.** Sea cells were hidden 0.5 m under the plane, which
  is ample in principle and useless in practice: with a 90 km far plane the depth buffer cannot
  separate two surfaces half a metre apart at fjord range, so they fought and the water rendered as
  a field of blue-and-olive noise. **Fixed by separation, not precision** — hidden geometry is
  pushed 25 m down, where nobody can see how far down it is.

And one number worth keeping: at full 30 m posting the shell alone was **14.5 M triangles**, taking
the scene to 20.2 M for a tier that is deliberately out of focus. At 90 m the whole scene is
**7.76 M** and looks the same at the range the shell is seen from.

## 6. Still open

- **First frame is 11.6 s.** The stage timings now attribute it: heightmap 1.4 s · land mask 0.5 ·
  shell 1.1 · drape 1.9 · buildings 3.0 = **~7.9 s of loading**, leaving ~3.7 s in scene assembly.
  So it is not one hotspot but the whole chain, and the honest fixes are progressive rendering
  (show terrain before buildings) and GPU-side dequantisation.
- **The seam is a step, not a blend.** The two tiers meet without a transition band, so the core's
  edge reads as a low cliff against the shell.
- The drape is still JPEG at 2.16 m/px; KTX2 and 2 × 2 tiling would double the ground resolution
  for the same VRAM (PLAN §4.3.1).
