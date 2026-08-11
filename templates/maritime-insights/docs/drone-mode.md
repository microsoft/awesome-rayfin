# Drone mode — the free camera

Ported from the sibling alpine app rather than reinvented, because its design decisions had already
been argued out and they hold here unchanged.

## What it is, and firmly is not

**No collision and no flight physics.** It is a camera, not a simulator. Flying through a headland
is allowed and is not a bug: collision would strand the viewer on geometry while they were trying
to look at something, and physics would be a claim about how an aircraft flies that this app never
makes. A test asserts the camera can descend through the sea surface, so the decision cannot be
"fixed" by accident later.

**No roll**, which is the most drone-like touch available and stays out on purpose. A tilted horizon
in a terrain app reads as *the terrain* being wrong, and this app's entire claim is that the coast
is where the survey says it is.

What it does have is the three things that separate a camera that flies from one that teleports:
inertia, a smoothed gimbal (~70 ms of lag — the difference between "mouse attached to eyeballs" and
"camera on a stabiliser"), and speed that scales with height above the surface.

## 🔴 What had to change for the coast

The alpine AOI is 30 km across with 1 400 m of relief; this one is 11 × 18 km with about 70 m.
Reusing the original constants would have been the lazy port and a bad one.

| | Alpine | Here |
| --- | --- | --- |
| Reference height | 400 m | **25 m** |
| Cruise range | 25–900 m/s | **8–400 m/s** |
| Height scale clamp | 0.22 – 2.6 | **0.3 – 14** |

The reference height is the altitude at which the cruise setting means exactly what it says. Here
that is deliberately **a mast top over the water** — the altitude a viewer spends most of their time
at when checking what a site can see. At the alpine value of 400 m, every mast from 2 m to 120 m
would have sat on the bottom clamp and felt identical.

## 🔴 Over water, the surface is the water

The height-above-ground sampler returns the **water plane**, not the seabed. The heightmap carries
real bathymetry down to −11.4 m, but the scene draws an opaque sea at zero and hides it — a sampler
that reported the seabed would make the camera silently speed up as it crossed the coast, for a
reason invisible on screen. The land mask already decides what counts as ground everywhere else in
the renderer, so it decides it here too. There is a test that pins exactly this.

The sampler reads the elevation array rather than raycasting the mesh: the terrain is a displaced
plane whose displacement *is* that array, and raycasting millions of vertices per frame to answer
"how high am I" would be absurd.

## The reason it earns its place here

Drone mode in a sightseeing app is a nice-to-have. Wired to the Phase 4 coverage field it is
something else: **the HUD reports which side of the modelled coverage the camera is standing on.**

Fly out from the mast and the readout says *einsehbar*. Cross the shoreline and it flips to
*abgeschattet*. The coverage field stops being a coloured overlay and becomes somewhere you can go
and stand — which is a far better answer to "what does this site not see" than a number.

Two actions make that loop quick:

- **Auf Mastspitze** — puts the camera exactly at the eye height the viewshed was solved for. This
  is the one viewpoint from which the coverage field is not an abstraction.
- **Standort hier setzen** — drops the notional site beneath the camera, so you can fly to a
  headland, place a site, and look.

In drone mode a click is a look, not a placement: the pointer is the gimbal.

## Verified

**11 unit tests** in a jsdom environment — the camera binds real `window` and pointer events, and
event plumbing is exactly where a free camera goes wrong. They cover the things that are tedious to
notice by flying: that it has mass and then fully stops rather than creeping, that a diagonal is not
faster than a straight line, that it slows near the surface, that a stuck key after focus loss does
not fly the camera away forever, that it never rolls, and that it still refuses to collide.

**Live on the deployed app**, which is where the interesting evidence came from. Flying west from a
mast at 25 m, boosted, sampling the HUD once a second:

```
agl=25 einsehbar   agl=25 einsehbar   agl=25 einsehbar   agl=25 einsehbar
agl=17 einsehbar   agl=19 abgeschattet   agl=17 einsehbar   agl=14 abgeschattet
agl=17 abgeschattet   agl=21 abgeschattet   agl=23 abgeschattet   agl=24 abgeschattet
```

Height above ground is a constant 25 over water and starts varying the moment the camera crosses
the coast — which is the terrain sampler working. Coverage flips at the shoreline — which is the
Phase 4 tie-in working. And the single `einsehbar` in the middle of the shadowed run is not noise:
it is a low gap where the sight line gets through, exactly what a viewshed over real terrain should
produce.

Also measured live: 0 → 208 km/h → coasting back to a full stop, and a descent to −15 m altitude
with AGL −15 m, confirming the no-collision decision survived the port.

## Controls

`W`/`S` forward and back · `A`/`D` strafe · `Q`/`E` down and up · `Shift` boost · drag to look ·
arrow keys to look, for trackpads · wheel for cruise speed.
