"""
Roof colour, measured from the orthophoto rather than invented — PLAN §5.11.

Every building in this app is currently the same warm terracotta, and that is the last large thing
on screen that is not derived from a survey. This module fixes the half of it that CAN be measured.

**Why the orthophoto is the only honest source.** Two spikes settled it before any of this was
written:

  * `lod2_attribute_spike.py` — the Bavarian LoD2 CityGML carries 100 % roof/wall semantics, roof
    pitch and orientation per surface, function and roof-type codes, and **not one appearance,
    material or diffuseColor tag** across 13 223 buildings. The survey measured the shape of these
    roofs and never recorded their colour.
  * `osm_building_colour_spike.py` — OpenStreetMap has `building:colour` on 1 of 4295 buildings at
    Oberstdorf (0.02 %) and 136 of 4242 at the Tegelberg (3.2 %). Real, but far too sparse to
    colour a valley with.

What is left is the DOP20 orthophoto, which the app already downloads and already ships as the
terrain drape. A roof is the one part of a building an aerial photograph sees properly, so the
colour of the pixels inside a roof polygon IS the colour of that roof. Nothing here is guessed;
it is read off a photograph of the actual building.

**The drape is good enough, and that was measured too.** `roof_colour_spike2.py` sampled the same
3013 roofs from the shipped 1.17 m/px drape and from a fresh 20 cm DOP20 request:

    roof area      n     median Δ   p90 Δ   share > 25/255
    8–20 m²      782        7.7      20.7        6.3 %
    20–50 m²     962        5.7      16.0        3.5 %
    50–150 m²   1116        3.7      10.0        1.0 %
    >150 m²      153        3.0       8.3        0.7 %

A median roof gets 32 drape pixels. So this needs **no new download at all** — it reads the file
already in `public/terrain/<aoi>/`. That matters more than it sounds: it means the feature costs
nothing at build time, nothing at runtime, and cannot rot when a WMS changes.

⚠️ **Three things contaminate a naive sample, and all three are handled here rather than excused.**

  1. *Vegetation.* A tree overhanging a roof turns the median green. Roofs are never green, so
     green-dominant pixels are rejected — which took the count of green roofs in the test window
     from 5 to 0.
  2. *Shadow and highlight.* A chimney's shadow at one end and a sunlit metal flashing at the other
     both pull the median. The darkest and brightest fifths are trimmed.
  3. *The sun in the photograph.* This is the big one. The sampled value spans 0.36 to 0.90 (p05 to
     p95) purely because of which way each pitch faced on the morning of the flight — and the
     renderer then applies its OWN lighting on top, so an unnormalised sample is shaded twice and a
     north pitch reads as a hole. `to_albedo` keeps hue and saturation, which are what the roof
     *is*, and compresses value toward the population median, which is mostly what the weather was.
"""

from __future__ import annotations

import colorsys
import statistics
from dataclasses import dataclass

from PIL import Image, ImageDraw

#: Below this many usable pixels the sample is not a roof colour, it is noise. Such buildings are
#: reported as unmeasured and fall back, rather than being given a confident wrong colour.
MIN_PIXELS = 6

#: Where the population's brightness is re-centred once the aerial sun is taken out.
TARGET_VALUE = 0.56

#: How much of the original brightness spread survives. 0 would paint every roof the same
#: brightness; 1 would keep the aerial sun and shade everything twice.
VALUE_RETENTION = 0.70

#: How much of the atmosphere's flattening to undo.
#:
#: ⚠️ This was 1.12 and the result looked like a doll's house — measured, not guessed: the produced
#: palette had a MEDIAN SATURATION OF 0.14, with only 6.6 % of roofs above 0.30, where a real clay
#: tile sits near 0.60. Every red roof in the valley came out dusty pink. A vertical photograph
#: through a kilometre of summer haze, resampled to 1.17 m and JPEG-compressed, loses most of its
#: chroma, and the sampler has to put that back or it renders a village of pastels.
#:
#: The gain is MULTIPLICATIVE on purpose. Grey roofs sample near s = 0.04 and stay grey however
#: much they are multiplied, so the boost separates clay from slate instead of tinting everything.
SATURATION_GAIN = 2.2

#: A ceiling, so a roof that sampled unusually pure does not come out as a traffic cone.
SATURATION_CAP = 0.62


@dataclass
class DrapeRef:
    """The orthophoto and the georeferencing needed to find a building in it."""

    image: Image.Image
    resolution_m: float
    origin_easting: float
    #: Northing of the TOP edge — the drape is written with row 0 = north.
    top_northing: float

    def to_pixel(self, easting: float, northing: float) -> tuple[float, float]:
        return (
            (easting - self.origin_easting) / self.resolution_m,
            (self.top_northing - northing) / self.resolution_m,
        )


def is_vegetation(px: tuple[int, int, int]) -> bool:
    """Green-dominant, i.e. a tree standing between the camera and the roof."""
    r, g, b = px
    return g > r + 8 and g > b + 8


def _luma(px: tuple[int, int, int]) -> float:
    return 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]


def sample_polygons(
    drape: DrapeRef,
    rings: list[list[tuple[float, float]]],
    inset_px: float = 0.6,
) -> list[tuple[int, int, int]]:
    """Every drape pixel inside a building's roof outlines, eroded slightly at the edges.

    The erosion matters at this resolution: the ring of pixels straddling a roof edge is part roof
    and part whatever is next to it, and at 1.17 m/px that ring is most of a small roof's
    perimeter.
    """
    pixel_rings = [[drape.to_pixel(e, n) for e, n in ring] for ring in rings if len(ring) >= 3]
    if not pixel_rings:
        return []

    flat = [p for ring in pixel_rings for p in ring]
    x0 = max(int(min(p[0] for p in flat)) - 1, 0)
    y0 = max(int(min(p[1] for p in flat)) - 1, 0)
    x1 = min(int(max(p[0] for p in flat)) + 2, drape.image.width)
    y1 = min(int(max(p[1] for p in flat)) + 2, drape.image.height)
    if x1 <= x0 or y1 <= y0:
        return []

    mask = Image.new("L", (x1 - x0, y1 - y0), 0)
    draw = ImageDraw.Draw(mask)
    for ring in pixel_rings:
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        shrunk = []
        for x, y in ring:
            dx, dy = x - cx, y - cy
            length = max((dx * dx + dy * dy) ** 0.5, 1e-6)
            k = max(0.0, 1.0 - inset_px / length)
            shrunk.append((cx + dx * k - x0, cy + dy * k - y0))
        draw.polygon(shrunk, fill=255)

    crop = drape.image.crop((x0, y0, x1, y1))
    mask_px = mask.load()
    crop_px = crop.load()
    out: list[tuple[int, int, int]] = []
    for y in range(y1 - y0):
        for x in range(x1 - x0):
            if mask_px[x, y]:
                out.append(crop_px[x, y])
    return out


def robust_colour(pixels: list[tuple[int, int, int]]) -> tuple[int, int, int] | None:
    """The roof's colour, with vegetation rejected and the extremes trimmed off."""
    kept = [p for p in pixels if not is_vegetation(p)]
    if len(kept) < MIN_PIXELS:
        return None
    kept.sort(key=_luma)
    cut = len(kept) // 5
    trimmed = kept[cut : len(kept) - cut] or kept
    return tuple(int(statistics.median(p[i] for p in trimmed)) for i in range(3))  # type: ignore[return-value]


def to_albedo(rgb: tuple[int, int, int], population_value: float) -> tuple[int, int, int]:
    """Take the photograph's own sunlight back out, so the renderer can put its own in.

    Hue and saturation are the roof: clay is orange, slate is blue-grey, sheet metal is neutral,
    and none of that depends on the flight. Value is mostly the flight — which way the pitch faced,
    what the haze was doing, how the JPEG rolled off. So hue survives untouched, saturation gets a
    small lift to undo the atmosphere's flattening, and value is re-centred on the population while
    keeping enough spread that a dark slate is still darker than a whitewashed tile.
    """
    r, g, b = (c / 255 for c in rgb)
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    v = TARGET_VALUE + (v - population_value) * VALUE_RETENTION
    v = min(max(v, 0.24), 0.86)
    s = min(s * SATURATION_GAIN, SATURATION_CAP)
    # A strongly coloured roof is a dark roof: clay and weathered copper are nowhere near as bright
    # as the whitish sheet metal they sit next to, and lifting everything to one value is what made
    # the first attempt look like icing.
    v *= 1.0 - 0.22 * s
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return (round(r * 255), round(g * 255), round(b * 255))


def measure_roof_colours(
    drape: DrapeRef,
    roofs_per_building: list[list[list[tuple[float, float]]]],
) -> tuple[list[tuple[int, int, int] | None], dict]:
    """Colour every building from its own roof pixels; None where there were not enough.

    Sampling per BUILDING rather than per roof surface is deliberate and not merely cheaper: a
    gable has a sunlit pitch and a shaded one, and pooling them averages out the direction the
    house happens to face. That is exactly the quantity wanted — the roof's own colour rather than
    this morning's lighting of it.
    """
    raw: list[tuple[int, int, int] | None] = []
    for rings in roofs_per_building:
        raw.append(robust_colour(sample_polygons(drape, rings)) if rings else None)

    measured = [c for c in raw if c is not None]
    if not measured:
        return raw, {"measured": 0, "total": len(raw)}

    values = sorted(colorsys.rgb_to_hsv(*(c / 255 for c in rgb))[2] for rgb in measured)
    population_value = values[len(values) // 2]

    out = [to_albedo(c, population_value) if c is not None else None for c in raw]
    return out, {
        "measured": len(measured),
        "total": len(raw),
        "populationValue": round(population_value, 3),
    }


def fallback_colour(colours: list[tuple[int, int, int] | None]) -> tuple[int, int, int]:
    """What an unmeasured building gets: the median of the ones that WERE measured.

    Better than a constant, because it is still this valley's own roofs rather than a designer's
    idea of a roof, and it makes an unsampled building disappear into its neighbours instead of
    standing out as the one the pipeline missed.
    """
    measured = [c for c in colours if c is not None]
    if not measured:
        return (196, 170, 152)
    return tuple(int(statistics.median(c[i] for c in measured)) for i in range(3))  # type: ignore[return-value]


#: How different a single roof surface must be from the rest of its building before it is allowed
#: its own colour, and how much evidence it needs before it is allowed to ask.
#:
#: ⚠️ **The first thresholds were set from the spread measured across large buildings, and applied
#: to all of them — which was wrong, and the check caught it.** They fired on 44.9 % of buildings,
#: whose median vertex count was 108 against 96 for the population: ordinary gabled houses, not
#: complex roofs. Sampling noise scales as 1/√n and a small pitch gets a handful of drape pixels,
#: so a threshold calibrated on well-sampled large roofs is pure noise on small ones — and the
#: result would have been a seam down the middle of every plain gable in the valley.
#:
#: ⚠️ **The second attempt was still too loose, and this time the reason was a wrong assumption
#: rather than a wrong number.** `to_albedo` treats hue and saturation as what a roof IS and value
#: as the aerial sun — and that is only two-thirds true. Shadow strips chroma as well as
#: brightness, so a shaded pitch reads *less saturated* than its sunlit twin. The measured spread
#: within a single building says so plainly: hue 0.011 at the median but saturation 0.079, seven
#: times more variation in the channel that was supposed to be material. Leaning on saturation was
#: therefore leaning on the sun again, one step removed — which is how the Tegelberg, whose roofs
#: really are more saturated, ended up with 47.5 % of its buildings claiming a two-material roof.
#:
#: So **hue carries the decision**. A copper spire on a tiled nave, or a blue-black solar array on
#: an orange pitch, differ enormously in hue and not at all ambiguously. Saturation is kept only
#: for the one case hue cannot express — a grey metal section beside a coloured one, where grey has
#: no meaningful hue at all — and set well above the p90 of 0.185 so ordinary shading cannot reach
#: it.
MIN_SURFACE_PIXELS = 30
SURFACE_HUE_THRESHOLD = 0.075
SURFACE_SATURATION_THRESHOLD = 0.30


def surface_variant(
    surface_rgb: tuple[int, int, int],
    building_rgb: tuple[int, int, int],
    sample_size: int,
) -> tuple[int, int, int] | None:
    """A roof surface's own colour, or None if it is close enough to the building's to skip.

    ⚠️ **Hue and saturation come from the surface; value comes from the building.** That split is
    the whole point, and it follows the measurement: within one building the value spread between
    roof surfaces is 0.204 at the median — far larger than the hue spread of 0.011 — because value
    is which way a pitch faced when the aeroplane went over, and hue is what the pitch is made of.
    Taking the surface's value as well would paint the aerial sun onto the model and then light it
    a second time, which is the exact mistake `to_albedo` exists to prevent.
    """
    if sample_size < MIN_SURFACE_PIXELS:
        return None

    sh, ss, _ = colorsys.rgb_to_hsv(*(c / 255 for c in surface_rgb))
    bh, bs, bv = colorsys.rgb_to_hsv(*(c / 255 for c in building_rgb))

    hue_gap = abs(sh - bh) % 1.0
    hue_gap = min(hue_gap, 1.0 - hue_gap)
    # A near-grey surface has a meaningless hue, so only its saturation is allowed to speak.
    hue_matters = ss > 0.12 and bs > 0.12
    if (not hue_matters or hue_gap < SURFACE_HUE_THRESHOLD) and abs(
        ss - bs
    ) < SURFACE_SATURATION_THRESHOLD:
        return None

    r, g, b = colorsys.hsv_to_rgb(sh, min(ss, 0.62), bv)
    return (round(r * 255), round(g * 255), round(b * 255))
