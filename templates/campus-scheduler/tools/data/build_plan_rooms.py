"""Turn OTH's published floor plans into real room outlines.

WHAT THIS REPLACES. Until now every room in the app except 25 was a `generated` plate: the right
count, the right total area and the right storey, arranged inside the real footprint but not
surveyed. The 25 exceptions were OpenStreetMap's indoor survey of Gebäude K's ground floor. OTH
publishes CAD floor plans for its buildings, and those are the architect's own geometry — this
reads the rooms straight off them.

WHY IT NEEDED OCR. The sheets have no text layer at all: `get_text()` returns nothing and
`get_fonts()` is empty, because the labels are outlined glyphs. My notes recorded that as "room
names are unreachable by any parser", which was true and misleading — unreachable by a PARSER is
not unreachable. Rendering the page and reading it back gets 24 room numbers off the ground floor
at 0.90–1.00 confidence, and those labels are what make the whole thing work: they name the rooms,
and they anchor the sheet to the world.

HOW A SHEET IS GEOREFERENCED. Two ways, and each is cross-checked before it is used:

  ground floor   Every OCR'd room number is matched BY NAME to the OpenStreetMap room of the same
                 ref, and a least-squares similarity transform is fitted to the 24 pairs. Named
                 correspondence settles the reflection outright — the previous attempt scored blob
                 overlap instead, chose the wrong mirror, and put the two wings the wrong way
                 round. Here the mirrored fit is worse by an order of magnitude (RMS 26.2 m against
                 1.83 m), so there is nothing to decide.

  upper floors   No surveyed rooms exist, so the floor is aligned to the already-georeferenced
                 ground floor by the overlap of the drawn walls — the same building, drawn upright
                 on the same template, so only scale and offset differ. ⚠️ ACCEPTED ONLY IF a
                 SECOND, independent estimate agrees: the scale implied by the floor covering the
                 known 4,406 m² footprint. OG1 agrees to 0.5% and is used. OG2 disagrees by 9.2%
                 and is REFUSED — see SHEETS below.

HOW A ROOM IS CUT OUT. Every labelled space seeds a region and they grow together against the
walls, so each one stops where it meets its neighbour. Three things had to be right, and each was
wrong first:

  * the wall threshold. The sheets use discrete greys — 0 and 103 for line work, 147 for the wall
    FILL, 198 for corridor floor shading, 255 for paper. Cutting at 120 missed the 147 fill, which
    is 5.4% of the page and most of the barrier, so every room leaked into every other and all 24
    fused into one region. The cut has to sit above 147 and below 198.
  * what watershed is fed. On the rendered page every door swing, chair and dimension line is a
    gradient ridge, so rooms stopped at the furniture: median 0.52 of true area. It must see the
    wall mask, where the only ridges are walls.
  * seeding the corridor. Run with room seeds alone, the foyer belongs to nobody and the rooms
    flood through the doorways and carve it up between them — that gave K 033 1260 m², forty times
    its real size. Foyer, Innenhof, WCs and stairs seed regions too; then the rooms simply stop.

Captions attach to their NEAREST room number rather than being clustered together: a room is
labelled over two or three lines ("K 011" / "Samm-" / "lung") and seeding each line separately
splits the room in half, but merging by proximity in a chain swallowed the six offices K 027…K 033,
which are stacked barely further apart than the lines of a single caption.

    python tools/data/build_plan_rooms.py            # all usable sheets
    python tools/data/build_plan_rooms.py --sheet k_eg --debug
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path

import cv2
import fitz
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PLANS = ROOT / "data" / "oth-plans"
LABELS = PLANS / "labels"
CONFIG = ROOT / "config"
OUT = CONFIG / "rooms-plan.json"

DPI = 300
WALL_CUT = 170  # above the 147 wall fill, below the 198 floor shading
CAPTION_RADIUS = 120  # px at 300 dpi; a caption line sits ~50 px from its room number
SCALE_TOLERANCE = 0.03  # two independent scale estimates must agree this closely
MAX_FOOTPRINT_SHIFT = 4.0  # m; beyond this a "correction" is moving the building, not nudging it
MAX_OUTLINE_RESIDUAL = 2.5  # m; mean distance from the drawn outline to the surveyed footprint
ICP_KEEP = 0.80  # fraction of outline points the footprint fit trusts; the rest is neighbouring built form
MIN_ROOM_M2 = 5.0  # below this it is a shaft, a nook or a tracing artefact, not a room
MAX_ROOM_M2 = 400.0  # above this it is a foyer or a run of corridor the carve joined up, not a room
MAX_ROOM_OUTSIDE = 1.0  # m a room may reach past the surveyed footprint — a wall's thickness, not a fudge
PIP_PX = 100  # centimetre resolution for the inside-the-footprint test

# An upper floor that does not cover the whole building — see `accept_partial_floor`.
MIN_PARTIAL_DICE = 0.60  # wall overlap with the floor below; K's FULL first floor manages 0.554
MIN_PARTIAL_COVER = 0.10  # of the surveyed footprint; below this the fit has collapsed, not shrunk
MAX_PARTIAL_OVERHANG = 3.0  # m the drawn floor may reach past the building beneath it

# Fitting a floor with no surveyed rooms to help it — see `fit_from_scratch`.
UNION_PX = 0.25  # m per pixel when several surveyed polygons are merged into one ring
UNION_CLOSE = 9  # px ≈ 2 m; bridges the hairline between polygons that share a wall
SEED_STEP_DEG = 10  # the pose sweep; finer than the ICP's own basin of attraction
SEED_SCALE_BAND = 0.25  # a fit that leaves this band has collapsed, not found a rival pose
SEED_MARGIN = 2.0  # the winner must beat the best DIFFERENT pose by this much, or it is refused
SEED_DISTINCT_DEG = 20  # closer than this to the winner is the same pose, not a rival


class Refused(Exception):
    """This sheet cannot be georeferenced honestly. Raised per sheet, caught per sheet."""


@dataclass(frozen=True)
class Sheet:
    name: str
    building: str
    level: int
    anchor: str  # "survey", "footprint", or the name of an already-georeferenced sheet


@dataclass(frozen=True)
class Target:
    """The surveyed footprint a drawn floor is fitted TO, named in one of two ways.

    ⚠️ ONE BUILDING IS NOT ALWAYS ONE POLYGON. Gebäude K is a single OpenStreetMap relation that
    carries `ref=K`, so naming it by ref is exact. The Prüfening campus is mapped as fourteen
    separate polygons, none of which carries a ref at all, and the sheet draws the lot as one
    connected complex — so its target is their UNION, and asking for any single one of them would
    be fitting a whole building to a fragment of itself.
    """

    ref: str | None = None
    campus: str | None = None


# ⚠️ ONLY 21 OF THE 623 SURVEYED BUILDINGS CARRY A `ref`, AND ALL OF THEM ARE ON THE SEYBOTH
# CAMPUS. That is the real limit on how much of this campus can be read off the plans: a floor
# needs BOTH readable room numbers AND something surveyed to fit them to, and for a long time the
# only building satisfying both was K. Prüfening satisfies it through the union above.
TARGETS: dict[str, Target] = {
    "K": Target(ref="K"),
    "P": Target(campus="pruefening"),
}


# ⚠️ k_og2 IS DELIBERATELY ABSENT. Its labels read fine (36 room numbers), but the two independent
# scale estimates disagree by 9.2% — wall alignment says 36.04 mm/px, the footprint says 39.71 —
# and its best-fitting alignment sat against the edge of the search range, which is what a search
# does when the answer is not inside it. A 9% scale error is a 19% area error: rooms that look
# convincing and are wrong. It stays generated until the disagreement is explained.
#
# ⚠️ THE SEYBOTH SHEETS ARE ABSENT FOR A DIFFERENT REASON, AND IT IS NOT A MISSING TARGET. Their
# room numbers are printed WITHOUT a building letter — `212A`, `0225`, `313`, `8308A` — because one
# sheet draws six buildings at once and the header names them all: *Gebäudeteile "Seybothstraße"
# (Q, R, S, SM, T, Y)*. `REF` requires a leading letter, so `seyboth_og2` and `og3` score zero refs
# from perfectly legible labels, and `seyboth_eg` scores two. Relaxing the pattern is not the fix:
# a bare `212A` cannot be attributed to one of six buildings, and guessing would put a room in the
# wrong building while looking exactly as confident as a correct one. `seyboth_ug` is the exception
# — 23 of its labels DO carry a letter (S, R, T) — and it is the honest place to start on this
# campus once each of those buildings has a fit target of its own.
# The Haus-der-Technik sheets (G, H, I, J) are pure raster: `get_drawings()` returns 0 items.
#
# ⚠️ THE GALGENBERGSTRASSE 30 SHEETS ARE THE LARGEST UNTAPPED SET AND ARE BLOCKED ONLY ON A TARGET.
# `galgen30_og1` alone reads 67 refs across A, B, C, D and E, `og2` 19 and `eg` 10. What is missing
# is something surveyed to fit them TO: OpenStreetMap has that site as `Fakultät Maschinenbau`
# (relation/59801, 8 146 m², the largest OTH building) plus two Hörsaal buildings, and OTH's own
# letters split the first of those into A, B and C. That is the Prüfening problem mirrored — the
# publisher splits what the survey merges — and it needs a union target naming those polygons.
# ⚠️ pruefening_og1 AND og2 ARE LISTED AND STILL REFUSED, AND THE REASON IS NOW A MEASUREMENT.
# They used to be turned away by the footprint-area cross-check, which cannot judge a floor that
# does not cover the whole building — see `accept_partial_floor`. With that check replaced they get
# as far as being placed, and the placement is what fails: the first floor lands 6.4 m outside the
# complex it stands on and the second 35.2 m. The cause is visible in the numbers next to it — a
# partial floor is a small cluster of ink on a mostly blank page, and `matchTemplate` slides such a
# cluster almost anywhere while still reporting a high overlap (og2 scores 0.815 and is 35 m out).
# Anchoring to the floor below cannot place them; each needs to be fitted to the ONE surveyed
# polygon of the six that it actually occupies. They are kept in the list on purpose, so every run
# re-states that 112 legible rooms are waiting on that work rather than letting the gap go quiet.
#
# ⚠️ pruefening_ug IS ABSENT for a related reason: it is a basement, so the same area check is
# equally inapplicable, and it would meet the same placement problem with 73 refs at stake.
SHEETS = (
    Sheet("k_eg", "K", 0, "survey"),
    Sheet("k_og1", "K", 1, "k_eg"),
    Sheet("pruefening_eg", "P", 0, "footprint"),
    Sheet("pruefening_og1", "P", 1, "pruefening_eg"),
    Sheet("pruefening_og2", "P", 2, "pruefening_eg"),
)

# ⚠️ THIS PATTERN WAS TOO STRICT AND IT COST 157 ROOMS. It used to be `^([A-Z])\s?([O0-9]{2,3})$`,
# which is how Gebäude K numbers its rooms — and only how K numbers them. Prüfening hyphenates
# (`P-172`) and Galgenbergstraße suffixes (`E101B`, `C102A`), so `pruefening_ug` scored ZERO refs
# from 99 perfectly legible labels and read as a sheet with no room numbers on it.
# The suffix is part of the room's identity, not noise: `P-149A` and `P-149B` are two rooms.
REF = re.compile(r"^([A-Z])[-\s]?([O0-9]{2,3})([A-Z])?$")


def render(sheet: str) -> tuple[np.ndarray, np.ndarray]:
    """The page as RGB, and its wall mask."""
    page = fitz.open(PLANS / f"{sheet}.pdf")[0]
    pix = page.get_pixmap(dpi=DPI)
    rgb = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    return rgb, (gray < WALL_CUT).astype(np.uint8)


def read_labels(sheet: str, rgb: np.ndarray) -> list[dict]:
    """OCR the sheet, cached beside the PDFs so a rebuild needs no OCR engine."""
    cache = LABELS / f"{sheet}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))

    from rapidocr_onnxruntime import RapidOCR  # optional: only needed to (re)build the cache

    result, _ = RapidOCR()(rgb)
    found = [
        {
            "text": text,
            "conf": round(float(conf), 3),
            "px": [round(v, 1) for v in np.asarray(box, dtype=float).mean(axis=0).tolist()],
        }
        for box, text, conf in (result or [])
    ]
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(found, indent=1, ensure_ascii=False), encoding="utf-8")
    return found


def drawing_window(shape: tuple[int, ...]) -> tuple[int, int, int, int]:
    """Top, bottom, left, right of the drawing — excludes the header and the rotated legend."""
    return 900, shape[0] - 360, 380, shape[1] - 160


def seeds_from(labels: list[dict], shape: tuple[int, ...]) -> tuple[dict[str, np.ndarray], list[np.ndarray], dict[str, str]]:
    top, bottom, left, right = drawing_window(shape)
    refs: list[tuple[str, np.ndarray]] = []
    loose: list[tuple[str, np.ndarray]] = []
    for label in labels:
        x, y = label["px"]
        if not (top < y < bottom and left < x < right):
            continue
        clean = re.sub(r"\s+", " ", label["text"]).strip().upper()
        hit = REF.match(clean)
        if hit:
            # The suffix stays: `P-149A` and `P-149B` are two rooms, and dropping it would collide
            # them onto one seed and lose whichever lost the race.
            code = f"{hit.group(1)} {hit.group(2).replace('O', '0').zfill(3)}{hit.group(3) or ''}"
            refs.append((code, np.array([x, y])))
        elif clean:
            loose.append((clean, np.array([x, y])))

    named = dict(refs)
    other, usage = [], {}
    for text, point in loose:
        if not refs:
            other.append(point)
            continue
        code, distance = min(
            ((c, float(np.linalg.norm(point - p))) for c, p in refs), key=lambda kv: kv[1]
        )
        if distance <= CAPTION_RADIUS:
            usage[code] = (usage.get(code, "") + " " + text.title()).strip()
        else:
            other.append(point)
    return named, other, usage


def carve(
    walls: np.ndarray,
    named: dict[str, np.ndarray],
    other: list[np.ndarray],
    inside: np.ndarray | None = None,
) -> dict[str, np.ndarray]:
    """Grow every labelled space at once; return one mask per room number.

    ⚠️ `inside` IS THE BUILDING, AND WITHOUT IT THE ROOMS ESCAPE THE PAGE. Watershed grows a region
    until it meets another region or a ridge, and open paper is neither. On the Gebäude K sheets
    the drawing fills its page, so nothing ever grew far; Prüfening sits in a wide white margin and
    the perimeter rooms poured straight out of the building — over Uhlandstraße, over the title
    block, to the paper edge. MEASURED before it was believed: `P 052` covered 22.96% of the
    drawing window and 63% of its pixels lay OUTSIDE that window, and the carved regions summed to
    128% of it. The overlay showed the interior carved correctly the whole time.

    So the boundary is stated: everything outside the drawn floor is background, and a room cannot
    reach it. `building_outline` supplies that outline and is the same one the footprint fit uses.
    """
    free = walls == 0
    markers = np.zeros(walls.shape, dtype=np.int32)
    if inside is None:
        markers[0, 0] = 1
    else:
        # Background is the paper AROUND the building, claimed up front so no room can take it.
        markers[(inside == 0) & free] = 1
        free = free & (inside > 0)

    def nearest_free(point: np.ndarray) -> tuple[int, int] | None:
        x, y = int(point[0]), int(point[1])
        r = 60
        patch = free[max(0, y - r) : y + r, max(0, x - r) : x + r]
        if not patch.any():
            return None
        ys, xs = np.nonzero(patch)
        d = (xs - min(x, r)) ** 2 + (ys - min(y, r)) ** 2
        i = int(d.argmin())
        return int(max(0, y - r) + ys[i]), int(max(0, x - r) + xs[i])

    index: dict[int, str] = {}
    next_id = 2
    for code in sorted(named):
        spot = nearest_free(named[code])
        if spot is None:
            continue
        cv2.circle(markers, (spot[1], spot[0]), 6, next_id, -1)
        index[next_id] = code
        next_id += 1
    for point in other:
        spot = nearest_free(point)
        if spot is not None:
            cv2.circle(markers, (spot[1], spot[0]), 6, next_id, -1)
            next_id += 1
    # ⚠️ WALLS ONLY. This used to read `markers[~free] = 0`, which was the same thing while `free`
    # meant "not a wall" — and stopped being the same thing the moment `free` also excluded the
    # paper outside the building: it then erased the background markers set above, and the rooms
    # flooded out again, worse than before (148% of the drawing window against 128%).
    markers[walls != 0] = 0

    grown = markers.copy()
    cv2.watershed(cv2.cvtColor(walls * 255, cv2.COLOR_GRAY2BGR), grown)
    return {code: (grown == idx).astype(np.uint8) for idx, code in index.items()}


def similarity(src: np.ndarray, dst: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
    src_c, dst_c = src.mean(0), dst.mean(0)
    a, b = src - src_c, dst - dst_c
    u, s, vt = np.linalg.svd(b.T @ a / len(src))
    d = np.diag([1.0, np.sign(np.linalg.det(u @ vt))])
    rot = u @ d @ vt
    scale = float((s * np.diag(d)).sum() / (a**2).sum() * len(src))
    return scale, rot, dst_c - scale * rot @ src_c


def survey_centroids() -> dict[str, np.ndarray]:
    data = json.loads((CONFIG / "rooms-osm.json").read_text(encoding="utf-8"))
    out = {}
    for room in data["rooms"]:
        ref, poly = room.get("ref"), room.get("polygonUtm32")
        if ref and poly:
            out[ref] = np.asarray(poly, dtype=float).mean(axis=0)
    return out


def align_to(base_walls: np.ndarray, walls: np.ndarray, shrink: int = 4) -> tuple[float, tuple[int, int], float]:
    """Scale and offset putting `walls` on top of `base_walls`, plus the wall overlap achieved.

    ⚠️ CROPPING TO THE DRAWING WINDOW FIRST SOUNDS RIGHT AND MEASURES WORSE — tried, kept the
    result, reverted the change. The argument for it is good: both sheets carry the same header,
    legend and border, so a correlation over the whole page could be won by furniture that is
    identical between two different floors. The argument is testable, because Gebäude K's first
    floor is a case where the footprint check IS valid, and there cropping moved the alignment's
    scale estimate from 0.4% away from the surveyed footprint to 2.0% away. Whatever the page
    furniture contributes, removing it costs more than it saves, so the whole page is matched.
    """
    small = lambda m: cv2.resize(m, None, fx=1 / shrink, fy=1 / shrink, interpolation=cv2.INTER_AREA)
    base, moving = small(base_walls), small(walls)
    best = None
    for scale in np.arange(0.70, 1.26, 0.005):
        scaled = cv2.resize(moving, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        if scaled.shape[0] > base.shape[0] or scaled.shape[1] > base.shape[1]:
            continue
        peak_map = cv2.matchTemplate(base.astype(np.float32), scaled.astype(np.float32), cv2.TM_CCORR_NORMED)
        _, peak, _, loc = cv2.minMaxLoc(peak_map)
        if best is None or peak > best[0]:
            best = (peak, float(scale), loc, scaled)
    peak, scale, loc, scaled = best
    window = base[loc[1] : loc[1] + scaled.shape[0], loc[0] : loc[0] + scaled.shape[1]]
    dice = 2 * np.logical_and(window > 0, scaled > 0).sum() / ((window > 0).sum() + (scaled > 0).sum())
    return scale, (loc[0] * shrink, loc[1] * shrink), float(dice)


def nearest_on_ring(points: np.ndarray, ring: np.ndarray) -> np.ndarray:
    """For each point, the closest point anywhere on the ring's edges."""
    best = np.empty_like(points)
    best_d = np.full(len(points), np.inf)
    for i in range(len(ring)):
        a, b = ring[i], ring[(i + 1) % len(ring)]
        ab = b - a
        span = float(ab @ ab)
        t = np.zeros(len(points)) if span == 0 else np.clip(((points - a) @ ab) / span, 0, 1)
        proj = a + t[:, None] * ab
        d = np.linalg.norm(points - proj, axis=1)
        closer = d < best_d
        best[closer] = proj[closer]
        best_d = np.minimum(best_d, d)
    return best


def fit_to_footprint(outline_px: np.ndarray, start, ring: np.ndarray, rounds: int = 40):
    """Refine a transform so the DRAWN outline lands on the SURVEYED footprint.

    ⚠️ THE FOOTPRINT IS THE BEST-SURVEYED THING AVAILABLE, and until now it only nudged the plate
    sideways. Rotation and scale came from 24 OpenStreetMap room quads — hand-drawn 5-vertex
    sketches that are ~35% shallower than the rooms the architect drew, and skewed relative to the
    walls. Deriving the building's ORIENTATION from those, then drawing the result on top of the
    very footprint they disagree with, is how the floor ended up visibly out of true with the
    building around it.

    So the room matches now do only what they are good for — resolving the reflection and giving a
    starting position — and the outline is fitted to the footprint by iterated closest point.

    ⚠️ TRIMMED, because the drawing is not only this building. The k_eg sheet covers Gebäude K AND
    its neighbour L, plus canopies and steps that are not in K's footprint at all, and a plain
    least-squares fit lets those outliers drag the whole floor: the ground floor settled at 0.75 m
    mean while the first floor, which has no such intruders, reached 0.04 m. Fitting on the best
    -matching majority ignores geometry that was never K's to begin with.

    Returns the transform plus the trimmed mean residual, so a fit that wanders can be rejected.
    """
    scale, rot, shift, flip = start
    keep = max(8, int(len(outline_px) * ICP_KEEP))
    for _ in range(rounds):
        moved = (scale * (outline_px * flip) @ rot.T) + shift
        target = nearest_on_ring(moved, ring)
        order = np.argsort(np.linalg.norm(moved - target, axis=1))[:keep]
        scale, rot, shift = similarity(outline_px[order] * flip, target[order])
    moved = (scale * (outline_px * flip) @ rot.T) + shift
    distances = np.sort(np.linalg.norm(moved - nearest_on_ring(moved, ring), axis=1))
    return (scale, rot, shift, flip), float(distances[:keep].mean())


def fit_from_scratch(outline_px: np.ndarray, ring: np.ndarray) -> tuple[tuple, float]:
    """Georeference a floor with NO surveyed rooms to help it — the footprint decides alone.

    Gebäude K resolves its reflection by matching 24 OCR'd room numbers to the OpenStreetMap rooms
    of the same ref. No other building on this campus has surveyed rooms, so for those the pose has
    to come out of the shape itself: sweep every rotation and both reflections, run the same trimmed
    ICP from each, and see whether one pose wins.

    ⚠️ TWO THINGS MUST BE CHECKED, AND I INITIALLY CHECKED ONLY THE SECOND, WHICH GAVE THE WRONG
    ANSWER ON A CORRECT FIT.

      * A FIT CAN COLLAPSE. ICP is free to shrink the drawing until it sits inside one wing of the
        footprint and report a small residual for it. On Prüfening the runner-up scored 1.16 m at
        5.70 mm/px — an EIGHTH of the real 48.40 — which is not a rival pose but a degenerate one.
        Comparing residuals alone called a clean fit ambiguous and would have refused it. So a
        candidate is only a candidate if its scale stays near the one the footprint AREA implies.
      * A TIE IS A REFUSAL. With the collapses excluded, the winner still has to beat the best
        MATERIALLY DIFFERENT pose by a clear margin. A 180° tie would place the floor upside down
        and mirror the room numbering — plausible-looking, and wrong in a way nobody would notice.

    Returns the transform and its residual, or raises rather than guessing.
    """
    area_m2 = abs(cv2.contourArea(ring.astype(np.float32)))
    base = float(np.sqrt(area_m2 / abs(cv2.contourArea(outline_px.astype(np.float32)))))
    low, high = base * (1 - SEED_SCALE_BAND), base * (1 + SEED_SCALE_BAND)
    src_c, dst_c = polygon_centroid(outline_px), polygon_centroid(ring)

    candidates: list[tuple[float, float, float, tuple]] = []
    collapsed = 0
    for flip_y in (1.0, -1.0):
        flip = np.array([1.0, flip_y])
        for degrees in range(0, 360, SEED_STEP_DEG):
            theta = np.radians(degrees)
            rot = np.array([[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]])
            shift = dst_c - base * (src_c * flip) @ rot.T
            refined, residual = fit_to_footprint(outline_px, (base, rot, shift, flip), ring)
            scale, settled = refined[0], refined[1]
            if not low <= scale <= high:
                collapsed += 1
                continue
            angle = float(np.degrees(np.arctan2(settled[1, 0], settled[0, 0])) % 360)
            candidates.append((residual, angle, flip_y, refined))

    if not candidates:
        raise Refused("no seed produced a fit at a plausible scale — the sheet is not this building")
    candidates.sort(key=lambda c: c[0])
    best = candidates[0]

    rival = next(
        (
            c
            for c in candidates
            if c[2] != best[2] or abs(((c[1] - best[1] + 180) % 360) - 180) > SEED_DISTINCT_DEG
        ),
        None,
    )
    print(
        f"          {len(candidates)} plausible poses ({collapsed} collapsed), "
        f"best {best[0]:.2f} m at {best[1]:.1f}°, {best[3][0] * 1000:.2f} mm/px"
    )
    if rival is None:
        print("          every plausible seed converged on that pose")
    else:
        print(f"          best different pose {rival[0]:.2f} m at {rival[1]:.1f}° — {rival[0] / best[0]:.1f}× worse")
        if rival[0] < SEED_MARGIN * best[0]:
            raise Refused(
                f"two poses fit almost equally well ({best[0]:.2f} m at {best[1]:.1f}° vs "
                f"{rival[0]:.2f} m at {rival[1]:.1f}°) — refusing rather than risking a mirrored floor"
            )
    return best[3], best[0]


def polygon_centroid(poly: np.ndarray) -> np.ndarray:
    """Area centroid — NOT the mean of the vertices, which weights wherever points are dense.

    ⚠️ Run about a local origin. `x·y' − x'·y` on a UTM coordinate is ~10¹² while the polygon's own
    contribution is ~10², so in double precision the shoelace returns mostly cancellation error —
    metres of it on a room, and this centroid is what the footprint fit is anchored to. Translating
    first leaves the result unchanged mathematically and the terms four orders smaller.
    """
    origin = poly[0]
    x, y = poly[:, 0] - origin[0], poly[:, 1] - origin[1]
    cross = x * np.roll(y, -1) - np.roll(x, -1) * y
    area = cross.sum() / 2
    if abs(area) < 1e-9:
        return poly.mean(axis=0)
    cx = ((x + np.roll(x, -1)) * cross).sum() / (6 * area)
    cy = ((y + np.roll(y, -1)) * cross).sum() / (6 * area)
    return np.array([cx, cy]) + origin


def building_outline(rgb: np.ndarray) -> np.ndarray:
    """The drawn floor's outer boundary, in page pixels."""
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    body = (gray < 210).astype(np.uint8)
    top, bottom, left, right = drawing_window(gray.shape)
    keep = np.zeros_like(body)
    keep[top:bottom, left:right] = 1
    body = cv2.morphologyEx(body * keep, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
    contours, _ = cv2.findContours(body, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return max(contours, key=cv2.contourArea).reshape(-1, 2).astype(float)


def footprint_ring(building: str) -> np.ndarray:
    """The surveyed outline this building's floors are fitted to, in UTM 32.

    A `ref` target is one polygon and is returned as it stands. A `campus` target is the union of
    every surveyed polygon there that the buildings file marks as the university's: rasterise them,
    close the hairline seams between polygons that share a wall, and take the outer contour back
    out. Merging in raster rather than by polygon arithmetic keeps this to OpenCV — the alternative
    is a geometry library the rest of the pipeline does not need.
    """
    target = TARGETS.get(building)
    if target is None:
        raise SystemExit(f"no surveyed fit target declared for building {building}")

    data = json.loads((CONFIG / "buildings-oth.json").read_text(encoding="utf-8"))
    records = data["buildings"] if isinstance(data, dict) else data

    def ring_of(b: dict) -> np.ndarray:
        poly = b["polygonUtm32"]
        return np.asarray(poly[0] if isinstance(poly[0][0], list) else poly, dtype=float)

    if target.ref:
        match = next(b for b in records if isinstance(b, dict) and b.get("ref") == target.ref)
        return ring_of(match)

    polys = [
        ring_of(b)
        for b in records
        if str(b.get("campusId")) == target.campus
        and (b.get("othEvidence") or b.get("isUniversityBuilding"))
    ]
    if not polys:
        raise SystemExit(f"campus {target.campus} has no surveyed university buildings")

    points = np.vstack(polys)
    lo = points.min(axis=0) - 5
    size = np.ceil(((points.max(axis=0) + 5) - lo) / UNION_PX).astype(int)[::-1]
    mask = np.zeros(size, np.uint8)
    for ring in polys:
        cv2.fillPoly(mask, [np.round((ring - lo) / UNION_PX).astype(np.int32)], 1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((UNION_CLOSE, UNION_CLOSE), np.uint8))

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    parts = sorted(contours, key=cv2.contourArea, reverse=True)
    # If the campus does not close into ONE piece the sheet is not drawing one complex, and
    # fitting it to the largest fragment would be quietly wrong rather than loudly.
    if len(parts) > 1 and cv2.contourArea(parts[1]) > 0.05 * cv2.contourArea(parts[0]):
        raise Refused(
            f"campus {target.campus} does not merge into one outline — "
            f"{len(parts)} pieces, second is {cv2.contourArea(parts[1]) * UNION_PX**2:.0f} m²"
        )
    return parts[0].reshape(-1, 2).astype(float) * UNION_PX + lo


def accept_partial_floor(sheet, rgb, composed, ring, by_align, by_footprint, dice):
    """Judge a floor that does not cover the whole building, and return its transform.

    ⚠️ THE AREA CROSS-CHECK IS NOT WRONG HERE, IT IS INAPPLICABLE, and the difference matters.
    `footprint_scale` asks "what scale would make this drawing cover the surveyed footprint", which
    is a real second opinion only while the floor DOES cover it. Pruëfening's first and second
    floors sit on part of the complex, so that question has no answer and its 44% and 60%
    disagreements measured the building's shape, not the fit. Refusing on them threw away 112
    legible rooms to protect against an error that had not happened. The file already recorded this
    reasoning for the basement and then applied the check to the upper floors anyway.

    What replaces it has to be evidence, not a lowered bar, so three things are asked instead — and
    each is a measurement this sheet could fail:

    1. **The drawn floor must be SMALLER than the building, not larger.** A partial floor explains a
       drawing that covers less than the footprint. Nothing explains one that covers more, so that
       direction stays a refusal.
    2. **Its walls must land on the walls of the floor below.** That is where the scale comes from,
       and it is an independent measurement rather than an assumption — the anchor floor is already
       georeferenced. The bar is set ABOVE the 0.554 that Gebäude K's accepted first floor scores,
       so a partial floor has to align BETTER than a full one that is already trusted.
    3. **It must sit inside the building.** A storey cannot overhang the footprint it stands on, and
       a fit that has slid onto the wrong part of a complex shows up here immediately.
    """
    if by_footprint <= by_align:
        raise Refused(
            f"{sheet.name}: the drawing covers MORE than the surveyed footprint "
            f"({by_align:.1f} vs {by_footprint:.1f} mm/px) — a storey cannot be bigger than its building"
        )

    covered = (by_align / by_footprint) ** 2
    scale, rot, shift, flip = composed
    outline = (scale * (building_outline(rgb) * flip) @ rot.T) + shift
    overhang = strays_outside(outline.tolist(), ring)
    print(
        f"          treating it as a PARTIAL floor: covers {covered * 100:.0f}% of the footprint, "
        f"overhangs it by {overhang:.2f} m"
    )

    if dice < MIN_PARTIAL_DICE:
        raise Refused(
            f"{sheet.name}: only {dice:.3f} wall overlap with {sheet.anchor} — too little to place "
            f"a floor the footprint cannot check"
        )
    if covered < MIN_PARTIAL_COVER:
        raise Refused(
            f"{sheet.name}: the drawing covers {covered * 100:.0f}% of the footprint — that is a "
            f"collapsed fit, not a smaller storey"
        )
    if overhang > MAX_PARTIAL_OVERHANG:
        raise Refused(
            f"{sheet.name}: the floor reaches {overhang:.1f} m past the building beneath it, refusing"
        )
    return composed


def strays_outside(polygon: list[list[float]], ring: np.ndarray) -> float:
    """How far this room's worst vertex reaches past the surveyed footprint, in metres.

    ⚠️ THE CARVE CAN INVENT ROOMS WHERE THE BUILDING IS NOT. Watershed fills whatever it is given,
    so a region that escapes the drawn outline — into a page margin, a title block, a neighbouring
    complex on the same sheet — comes back looking exactly like a room: a plausible area, a closed
    ring, a room number OCR read nearby. Nothing downstream can tell it apart, and the 3D view will
    happily draw it hanging in mid-air beside the building. Measured against the footprint the
    sheet was georeferenced TO, it is obvious: on Gebäude K a third of the carved rooms sat up to
    35 m outside their own building.

    ⚠️ Vertices, not the centroid. A ring that pokes out of the building has a centroid that does
    not, and the vertices are what actually gets drawn. `planRooms.test.ts` asks the same question
    the same way, so the test is a contract on this gate rather than a second opinion about it.
    """
    lo = ring.min(axis=0)
    contour = np.round((ring - lo) * PIP_PX).astype(np.int32).reshape(-1, 1, 2)
    worst = 0.0
    for x, y in polygon:
        signed = cv2.pointPolygonTest(
            contour, (float((x - lo[0]) * PIP_PX), float((y - lo[1]) * PIP_PX)), True
        )
        worst = max(worst, -signed / PIP_PX)
    return max(worst, 0.0)


def footprint_scale(rgb: np.ndarray, building: str) -> float:
    """mm/px implied by this floor covering the building's known footprint."""
    area = abs(cv2.contourArea(footprint_ring(building).astype(np.float32)))
    return float(np.sqrt(area / cv2.contourArea(building_outline(rgb).astype(np.float32))) * 1000)


def is_simple(poly: np.ndarray) -> bool:
    """Does the ring avoid crossing itself? O(n²), and n is a few dozen."""

    def crosses(p, p2, q, q2) -> bool:
        def side(a, b, c):
            return np.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))

        d1, d2 = side(p, p2, q), side(p, p2, q2)
        d3, d4 = side(q, q2, p), side(q, q2, p2)
        return d1 != d2 and d3 != d4

    n = len(poly)
    for i in range(n):
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue  # neighbours through the closing edge
            if crosses(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n]):
                return False
    return True


def polygon_of(mask: np.ndarray, to_world, metres_per_px: float) -> tuple[list[list[float]], float] | None:
    """Trace one room, keeping the simplest ring that still describes the pixels it came from.

    ⚠️ SIMPLIFYING A CONTOUR CAN FOLD IT, and a folded ring is not a harmless cosmetic defect: its
    area centroid can land outside its own bounding box, which is how these were finally caught
    (K 013's sat 13 m outside). Two gates that looked reasonable did NOT catch it —

      * comparing the ring's area to the `areaM2` stored beside it is circular; both are the same
        shoelace over the same bad ring, so they agreed perfectly and said nothing;
      * asking whether the ring contains its own centroid fails too, because ray-casting parity is
        undefined on a self-intersecting ring and cheerfully returns "yes".

    So simplification is ATTEMPTED and verified, never assumed: the coarsest epsilon that leaves
    the ring simple and area-faithful wins, and the raw contour — simple by construction — is the
    fallback rather than a folded approximation of it.
    """
    cleaned = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    if not cleaned.any():
        return None
    contours, _ = cv2.findContours(cleaned, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    biggest = max(contours, key=cv2.contourArea)

    pixel_area = float(cleaned.sum()) * metres_per_px**2
    if pixel_area < MIN_ROOM_M2:
        return None

    candidates = [cv2.approxPolyDP(biggest, e, True).reshape(-1, 2).astype(float) for e in (4.0, 2.0, 1.0)]
    candidates.append(biggest.reshape(-1, 2).astype(float))
    for approx in candidates:
        if len(approx) < 3:
            continue
        world = to_world(approx)
        x, y = world[:, 0], world[:, 1]
        area = 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))
        if abs(area - pixel_area) > 0.15 * pixel_area or not is_simple(world):
            continue
        return [[round(float(e), 3), round(float(n), 3)] for e, n in world], round(float(area), 1)
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract room outlines from OTH's floor plans.")
    parser.add_argument("--sheet", help="only this sheet")
    parser.add_argument("--debug", action="store_true", help="write an overlay per sheet")
    args = parser.parse_args()

    survey = survey_centroids()
    fitted: dict[str, tuple] = {}
    skipped: list[tuple[str, str]] = []
    rendered: dict[str, np.ndarray] = {}
    rooms_out: list[dict] = []

    for sheet in SHEETS:
        if args.sheet and sheet.name != args.sheet:
            continue
        rgb, walls = render(sheet.name)
        rendered[sheet.name] = walls
        labels = read_labels(sheet.name, rgb)
        named, other, usage = seeds_from(labels, walls.shape)

        # The drawn floor bounds the carve — see `carve`. Rasterised from the same outline the
        # footprint fit uses, so the two cannot disagree about where the building is.
        inside = np.zeros(walls.shape, np.uint8)
        cv2.fillPoly(inside, [building_outline(rgb).astype(np.int32)], 1)

        masks = carve(walls, named, other, inside)

        try:
            if sheet.anchor == "survey":
                shared = sorted(set(named) & set(survey))
                if len(shared) < 6:
                    raise Refused(f"{sheet.name}: only {len(shared)} rooms match the survey")

                # ⚠️ ANCHOR ON THE CARVED ROOMS, NOT ON THE LABELS.
                #
                # Fitting label centroids to room centroids works, but a caption is not printed at the
                # centre of its room — on these sheets it sits high and left — so the fit absorbs that
                # placement bias as a translation. It showed up as a 3.28 m median offset between each
                # extracted room and the OpenStreetMap room of the SAME ref, with four first-floor
                # rooms pushed outside the building footprint entirely. Centroid-to-centroid removes
                # the bias: the same quantity is compared on both sides.
                centres = {
                    code: np.asarray(np.nonzero(mask)[::-1]).mean(axis=1)
                    for code, mask in masks.items()
                    if mask.any()
                }
                shared = [c for c in shared if c in centres]
                src = np.array([centres[r] for r in shared])
                dst = np.array([survey[r] for r in shared])

                # A page's y axis runs down; UTM northing runs up, so fitting to eastings and northings
                # needs the reflection that fitting to scene z did not. Hard-coding the unmirrored fit
                # gave RMS 26.2 m and 21.36 mm/px against the footprint's 44.76 — caught only because
                # the two scale estimates are cross-checked. The residual decides.
                options = []
                for flip in (np.array([1.0, 1.0]), np.array([1.0, -1.0])):
                    s, r, t = similarity(src * flip, dst)
                    err = np.linalg.norm((s * (src * flip) @ r.T + t) - dst, axis=1)
                    options.append((float(np.sqrt((err**2).mean())), flip, s, r, t))
                options.sort(key=lambda o: o[0])
                rms, flip, scale, rot, shift = options[0]
                print(
                    f"{sheet.name}: {len(shared)} named correspondences, RMS {rms:.2f} m "
                    f"(other reflection {options[1][0]:.1f} m), {scale * 1000:.2f} mm/px"
                )

                # ⚠️ NOW HAND THE ORIENTATION TO THE FOOTPRINT. The room matches have done their job:
                # they resolved the reflection and put the plate roughly in place. They are a poor
                # guide to the building's ANGLE, being 5-vertex sketches that sit skewed against the
                # walls, and a floor drawn out of true with the building around it is visible at a
                # glance. The footprint is one carefully surveyed 21-vertex polygon; fit to that.
                ring = footprint_ring(sheet.building)
                refined, residual = fit_to_footprint(building_outline(rgb), (scale, rot, shift, flip), ring)
                scale, rot, shift, flip = refined
                print(
                    f"          outline fitted to the surveyed footprint: mean {residual:.2f} m, "
                    f"{scale * 1000:.2f} mm/px"
                )
                if residual > MAX_OUTLINE_RESIDUAL:
                    raise Refused(f"{sheet.name}: outline sits {residual:.2f} m off the footprint, refusing")

                check = footprint_scale(rgb, sheet.building)
                drift = abs(scale * 1000 - check) / check
                print(f"          footprint area implies {check:.2f} mm/px — {drift * 100:.1f}% apart")
                if drift > SCALE_TOLERANCE:
                    raise Refused(f"{sheet.name}: the two scale estimates disagree, refusing")

                # How far the named rooms ended up from their OSM twins under the footprint fit —
                # reported, not enforced: the two sources genuinely disagree about room depth.
                moved = (scale * (src * flip) @ rot.T) + shift
                print(
                    f"          named rooms now sit a median "
                    f"{np.median(np.linalg.norm(moved - dst, axis=1)):.2f} m from their OSM twins"
                )

                fitted[sheet.name] = (scale, rot, shift, flip)
                to_world = lambda pts, s=scale, r=rot, t=shift, f=flip: (s * (pts * f) @ r.T) + t
            elif sheet.anchor == "footprint":
                # No surveyed rooms anywhere in this building, so the shape of the footprint is the
                # only evidence of where the floor goes. `fit_from_scratch` refuses if it is not enough.
                print(f"{sheet.name}: no surveyed rooms — fitting the outline to the footprint alone")
                refined, residual = fit_from_scratch(building_outline(rgb), footprint_ring(sheet.building))
                scale, rot, shift, flip = refined
                if residual > MAX_OUTLINE_RESIDUAL:
                    raise Refused(f"{sheet.name}: outline sits {residual:.2f} m off the footprint, refusing")

                fitted[sheet.name] = (scale, rot, shift, flip)
                to_world = lambda pts, s=scale, r=rot, t=shift, f=flip: (s * (pts * f) @ r.T) + t
            else:
                base_scale, base_rot, base_shift, base_flip = fitted[sheet.anchor]
                rel, offset, dice = align_to(rendered[sheet.anchor], walls)
                by_align = base_scale * 1000 * rel
                by_footprint = footprint_scale(rgb, sheet.building)
                drift = abs(by_align - by_footprint) / by_footprint
                print(
                    f"{sheet.name}: aligned to {sheet.anchor} at scale {rel:.3f}, wall Dice {dice:.3f}\n"
                    f"          {by_align:.2f} mm/px by alignment vs {by_footprint:.2f} by footprint "
                    f"— {drift * 100:.1f}% apart"
                )
                # Compose "into the anchor's pixel frame, then through the anchor's transform" into a
                # single similarity, so this floor can be fitted to the footprint exactly like the
                # ground floor rather than inheriting whatever the wall-overlap search settled on.
                #   world = s · ((p·rel + off)·f) · Rᵀ + t
                #         = (s·rel) · (p·f) · Rᵀ + (s · (off·f) · Rᵀ + t)
                composed = (
                    base_scale * rel,
                    base_rot,
                    base_scale * (np.array(offset) * base_flip) @ base_rot.T + base_shift,
                    base_flip,
                )
                ring = footprint_ring(sheet.building)

                if drift <= SCALE_TOLERANCE:
                    refined, residual = fit_to_footprint(building_outline(rgb), composed, ring)
                    scale, rot, shift, flip = refined
                    print(
                        f"          outline fitted to the surveyed footprint: mean {residual:.2f} m, "
                        f"{scale * 1000:.2f} mm/px"
                    )
                    if residual > MAX_OUTLINE_RESIDUAL:
                        raise Refused(
                            f"{sheet.name}: outline sits {residual:.2f} m off the footprint, refusing"
                        )
                else:
                    scale, rot, shift, flip = accept_partial_floor(
                        sheet, rgb, composed, ring, by_align, by_footprint, dice
                    )

                to_world = lambda pts, s=scale, r=rot, t=shift, f=flip: (s * (pts * f) @ r.T) + t
        except Refused as exc:
            # ⚠️ A REFUSAL IS ABOUT THIS FLOOR, NOT ABOUT THE RUN. Every check that rejects a
            # sheet has already proved something specific about that sheet; none of them says
            # anything about the others, and treating one as fatal threw away floors that had
            # passed. Refused sheets are named at the end so a skip can never be mistaken for
            # a sheet nobody tried.
            print(f"{sheet.name}: REFUSED — {exc}")
            skipped.append((sheet.name, str(exc)))
            continue


        kept, refused, strayed, oversized = 0, [], [], []
        # Metres per pixel on THIS sheet, taken from the transform actually in use rather than
        # restated, so the area gate cannot drift away from the geometry it is checking.
        probe = to_world(np.array([[0.0, 0.0], [1.0, 0.0]]))
        metres_per_px = float(np.linalg.norm(probe[1] - probe[0]))
        fit_ring = footprint_ring(sheet.building)

        for code, mask in sorted(masks.items()):
            shaped = polygon_of(mask, to_world, metres_per_px)
            if not shaped:
                refused.append(code)
                continue
            polygon, area = shaped
            # ⚠️ A ROOM TOO BIG TO BE A ROOM IS THE CARVE'S OLDEST FAILURE, and it is silent: seeding
            # rooms but not the foyer let K 033 flood the corridor and come back as 1 260 m², forty
            # times its size, with a closed ring and a confident room number. The largest space OTH
            # actually labels on these sheets is the Großer Hörsaal at 151 m², so a carved region
            # several times that is a foyer or a run of corridor that found no seed of its own.
            # `planRooms.test.ts` asserts the same ceiling, which makes it a contract on this line.
            if area > MAX_ROOM_M2:
                oversized.append((code, area))
                continue
            stray = strays_outside(polygon, fit_ring)
            if stray > MAX_ROOM_OUTSIDE:
                strayed.append((code, stray))
                continue
            rooms_out.append(
                {
                    "ref": code,
                    "building": sheet.building,
                    "level": sheet.level,
                    "usage": usage.get(code) or None,
                    "areaM2": area,
                    "polygonUtm32": polygon,
                    "sheet": sheet.name,
                }
            )
            kept += 1
        print(f"          {kept} rooms extracted" + (f", {len(refused)} refused {refused}" if refused else ""))
        if strayed:
            worst = ", ".join(f"{c} {d:.0f} m" for c, d in sorted(strayed, key=lambda s: -s[1])[:6])
            print(f"          {len(strayed)} dropped for sitting outside the footprint: {worst}")
        if oversized:
            worst = ", ".join(f"{c} {a:.0f} m²" for c, a in sorted(oversized, key=lambda s: -s[1])[:6])
            print(f"          {len(oversized)} dropped for being too big to be a room: {worst}")

        if args.debug:
            out = cv2.cvtColor(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY), cv2.COLOR_GRAY2BGR)
            rng = np.random.default_rng(11)
            for mask in masks.values():
                colour = tuple(int(c) for c in rng.integers(60, 255, 3))
                out[mask > 0] = (0.55 * out[mask > 0] + 0.45 * np.array(colour)).astype(np.uint8)
            cv2.imwrite(str(PLANS / f"debug-{sheet.name}.png"), out)

    OUT.write_text(
        json.dumps(
            {
                "source": "OTH Regensburg, published floor plans (oth-regensburg.de), room outlines "
                "read from the CAD sheets",
                # The sheets that actually produced rooms — NOT the sheets that were attempted. A refused
                # sheet listed here would claim provenance the file does not have.
                "sheets": sorted({r["sheet"] for r in rooms_out}),
                "sheetsRefused": [{"sheet": n, "reason": r} for n, r in skipped],
                "count": len(rooms_out),
                "rooms": rooms_out,
            },
            indent=1,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"\nwrote {OUT.relative_to(ROOT)} — {len(rooms_out)} rooms")
    for name, reason in skipped:
        print(f"  refused: {name} — {reason}")


if __name__ == "__main__":
    main()
