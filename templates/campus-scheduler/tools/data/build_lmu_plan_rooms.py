"""Read LMU's own published floor plans into room outlines — `config/rooms-plan-lmu.json`.

⚠️ THIS PROJECT RECORDED FOR WEEKS THAT "LMU HAS NO PLANS AT ALL". It has them, on its own website,
and it publishes more than OTH does: `lmu.de/raumfinder` is an unauthenticated AngularJS app that
serves, per building, a floor plan as a tile pyramid AND every room's coordinate IN THAT PLAN'S
PIXEL FRAME. The assumption cost this site 8 790 invented interiors; one look at the network tab
replaced it.

What the Raumfinder serves (all read out of its own `build.js`, nothing guessed):

    data.js                                  `buildingsJSON` — 87 buildings, code `bw####`, lat/lng
    json/uniqueBuildingParts/<bw####>.json   floors: `fCode`, `mapUri`, `level`, mapSizeX/mapSizeY
    json/rooms/<bw####>.json                 every room: `rName`, `floorCode`, `pX`, `pY`
    <tiles>/v3/<mapUri sans .pdf>/<pct>/<x>/<y>.png    the plan, 256 px tiles, pct of mapSize

⚠️ THE `.pdf` IN `mapUri` IS A NAME, NOT A FILE. Every plausible PDF path 404s; the drawing exists
only as raster tiles. That is why this reads a mosaic rather than a vector page like the OTH sheets.

⚠️ AND THE SEEDS ARE PUBLISHED, NOT READ. The OTH pipeline OCRs a room number off the drawing and
then attaches captions to it, which is where most of its failures came from. Here LMU states where
each room is, so the seeding step — the one that produced a 1 260 m² K 033 — cannot go wrong in the
same way. Measured on the ground floor of Oettingenstr. 67: 285 of 285 published coordinates land
inside their own room.

Georeferencing is by NAMED CORRESPONDENCE, the strong anchor: 521 of the 526 rooms OpenStreetMap
has surveyed inside Oettingenstr. 67 carry a ref that is also a room name in the Raumfinder, so the
same room is identified on both sides and the transform is fitted to those pairs — not to an
outline, which is what just failed at Galgenbergstraße 30 for want of an unambiguous pose.

    python tools/data/build_lmu_plan_rooms.py
    python tools/data/build_lmu_plan_rooms.py --floor g707000 --debug
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_plan_rooms import (  # noqa: E402
    MAX_OUTLINE_RESIDUAL,
    MAX_ROOM_M2,
    MAX_ROOM_OUTSIDE,
    Refused,
    carve,
    fit_to_footprint,
    polygon_of,
    similarity,
    strays_outside,
)

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "config"
CACHE = ROOT / "data" / "lmu-plans"
OUT = CONFIG / "rooms-plan-lmu.json"

RAUMFINDER = "https://www.lmu.de/raumfinder/"
TILES = "https://cms-static.uni-muenchen.de/lmu-roomfinder-4b38a548/tiles/v3"
UA = {"User-Agent": "Campus-Scheduler/1.0 (+https://github.com/; contact via repo)"}

# ⚠️ 500, NOT 1000. The pyramid offers 12.5/25/50/100% of the plan. At 100% Oettingenstr. 67 is
# 9 925 × 7 017 px = 1 092 tiles per floor, and the extra resolution buys nothing: a wall is already
# several pixels wide at 50%, which is what the carve needs. 50% is 280 tiles and ~3 500 px across,
# the same order as the OTH sheets rendered at 300 dpi, so the same thresholds apply.
PERCENT = 500
TILE = 256
WALL_CUT = 200  # these plans are line work on white, not the grey-filled walls of the OTH sheets
BODY_CUT = 230  # anything darker than this is drawing rather than paper
SEED_MARGIN_PX = 120  # how far past the outermost room the building may extend
MIN_CORRESPONDENCES = 12


@dataclass(frozen=True)
class Floor:
    code: str  # `g707000`
    map_uri: str  # `7070_d_00`
    level: int  # storey, 0 = Erdgeschoss
    name: str  # `Erdgeschoss`
    width: int
    height: int


# ⚠️ ONE BUILDING, AND THE REASON IS THE ANCHOR RATHER THAN THE PLANS. Every one of the 70 LMU
# buildings inside the area of interest publishes a plan; only Oettingenstr. 67 also has surveyed
# indoor rooms to fit those plans TO. The others would have to be placed by matching a drawn
# outline to a footprint, which is exactly the fit that was refused at Galgenbergstraße 30 as
# ambiguous. Adding them is a question of finding a second anchor, not of fetching more sheets.
BUILDINGS: dict[str, str] = {"bw7070": "relation/116031"}

LEVEL_RE = re.compile(r"^(EG|OG|UG)\s*(\d+)?$", re.I)


def http(url: str) -> bytes:
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()


def raumfinder_json(path: str) -> dict:
    return json.loads(http(RAUMFINDER + path))


def level_of(raw: str) -> int:
    """`EG` → 0, `OG 01` → 1, `UG 01` → −1. Refuses anything it does not recognise rather than
    guessing a storey, because a floor on the wrong level stacks rooms through a ceiling."""
    m = LEVEL_RE.match(raw.strip())
    if not m:
        raise Refused(f"unrecognised level {raw!r}")
    kind, number = m.group(1).upper(), int(m.group(2) or 0)
    return {"EG": 0, "OG": number, "UG": -number}[kind]


def floors_of(code: str) -> list[Floor]:
    parts = raumfinder_json(f"json/uniqueBuildingParts/{code}.json")
    out = []
    for f_code, part in parts.items():
        out.append(
            Floor(
                code=f_code,
                map_uri=part["mapUri"].rsplit(".", 1)[0],
                level=level_of(part["level"]),
                name=part["fName"],
                width=int(part["mapSizeX"]),
                height=int(part["mapSizeY"]),
            )
        )
    return sorted(out, key=lambda f: f.level)


def stitch(floor: Floor) -> np.ndarray:
    """The floor plan as one image, cached on disk so a rebuild costs no requests."""
    cached = CACHE / f"{floor.map_uri}-{PERCENT}.png"
    if cached.exists():
        return cv2.imread(str(cached))

    width = int(floor.width * PERCENT / 1000)
    height = int(floor.height * PERCENT / 1000)
    cols, rows = -(-width // TILE), -(-height // TILE)
    canvas = np.full((height, width, 3), 255, np.uint8)

    def fetch(xy: tuple[int, int]):
        x, y = xy
        try:
            return xy, http(f"{TILES}/{floor.map_uri}/{PERCENT}/{x}/{y}.png")
        except urllib.error.HTTPError as exc:
            return xy, exc.code

    missing = 0
    with ThreadPoolExecutor(max_workers=12) as pool:
        for (x, y), body in pool.map(fetch, [(x, y) for x in range(cols) for y in range(rows)]):
            if not isinstance(body, bytes):
                missing += 1
                continue
            tile = cv2.imdecode(np.frombuffer(body, np.uint8), cv2.IMREAD_COLOR)
            if tile is None:
                missing += 1
                continue
            y0, x0 = y * TILE, x * TILE
            th, tw = tile.shape[:2]
            canvas[y0 : y0 + th, x0 : x0 + tw] = tile[: height - y0, : width - x0]
    if missing:
        # A hole in the mosaic is a hole in the building: the carve would flood through it.
        raise Refused(f"{floor.map_uri}: {missing} of {cols * rows} tiles did not load")

    CACHE.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(cached), canvas)
    return canvas


def drawn_outline(page: np.ndarray, seeds: dict[str, np.ndarray]) -> np.ndarray:
    """The floor's own boundary, found around the rooms rather than around the page.

    ⚠️ THE SHEET IS NOT ONLY THE BUILDING. It carries a title block, a legend and a north arrow,
    all of them solid ink, and the largest dark contour on the page is not reliably the floor. The
    OTH pipeline solves this with a hard-coded drawing window, which works because every OTH sheet
    has the same layout; LMU's do not. But LMU has already said where the rooms are, so the
    building is the region AROUND ITS OWN ROOMS: take the bounding box of the published
    coordinates, allow a margin for the walls outside the outermost room, and look for the drawing
    only there. It cannot pick up the legend, and it needs no per-sheet tuning.
    """
    points = np.array(list(seeds.values()))
    lo = np.maximum(points.min(axis=0) - SEED_MARGIN_PX, 0).astype(int)
    hi = np.minimum(points.max(axis=0) + SEED_MARGIN_PX, page.shape[1::-1]).astype(int)

    gray = cv2.cvtColor(page, cv2.COLOR_BGR2GRAY)
    body = (gray < BODY_CUT).astype(np.uint8)
    window = np.zeros_like(body)
    window[lo[1] : hi[1], lo[0] : hi[0]] = 1
    closed = cv2.morphologyEx(body * window, cv2.MORPH_CLOSE, np.ones((45, 45), np.uint8))
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise Refused("no drawing found around the published room coordinates")
    return max(contours, key=cv2.contourArea).reshape(-1, 2).astype(float)


def survey_centroids(osm_rooms: list[dict], building_osm_id: str) -> dict[str, np.ndarray]:
    """Where OpenStreetMap says each surveyed room is, in UTM 32 — one point per ref."""
    out: dict[str, np.ndarray] = {}
    for room in osm_rooms:
        if room.get("buildingOsmId") != building_osm_id or not room.get("polygonUtm32"):
            continue
        poly = np.asarray(room["polygonUtm32"], dtype=float)
        out[room["ref"]] = poly.mean(axis=0)
    return out


def footprint_ring(building_osm_id: str) -> np.ndarray:
    data = json.loads((CONFIG / "buildings-lmu.json").read_text(encoding="utf-8"))
    records = data["buildings"] if isinstance(data, dict) else data
    match = next((b for b in records if b.get("osmId") == building_osm_id), None)
    if match is None or not match.get("polygonUtm32"):
        raise SystemExit(f"no surveyed footprint for {building_osm_id}")
    poly = match["polygonUtm32"]
    return np.asarray(poly[0] if isinstance(poly[0][0], list) else poly, dtype=float)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--floor", help="only this floor code, e.g. g707000")
    parser.add_argument("--debug", action="store_true", help="write a carve overlay per floor")
    args = parser.parse_args()

    osm_rooms = json.loads((CONFIG / "rooms-osm-lmu.json").read_text(encoding="utf-8"))["rooms"]
    rooms_out: list[dict] = []
    skipped: list[tuple[str, str]] = []

    for code, building_osm_id in BUILDINGS.items():
        survey = survey_centroids(osm_rooms, building_osm_id)
        ring = footprint_ring(building_osm_id)
        published = raumfinder_json(f"json/rooms/{code}.json")
        print(f"{code}: {len(published)} published rooms, {len(survey)} surveyed by OpenStreetMap")

        for floor in floors_of(code):
            if args.floor and floor.code != args.floor:
                continue
            try:
                here = {
                    v["rName"]: np.array(
                        [int(v["pX"]) * PERCENT / 1000, int(v["pY"]) * PERCENT / 1000]
                    )
                    for v in published.values()
                    if v["floorCode"] == floor.code
                }
                if not here:
                    raise Refused("no published room coordinates on this floor")

                page = stitch(floor)
                gray = cv2.cvtColor(page, cv2.COLOR_BGR2GRAY)
                walls = (gray < WALL_CUT).astype(np.uint8)
                outline = drawn_outline(page, here)
                inside = np.zeros(walls.shape, np.uint8)
                cv2.fillPoly(inside, [outline.astype(np.int32)], 1)
                print(
                    f"{floor.code} ({floor.name}, level {floor.level}): {len(here)} rooms, "
                    f"{page.shape[1]}x{page.shape[0]} px, drawing covers "
                    f"{inside.mean() * 100:.0f}% of the sheet"
                )

                masks = carve(walls, here, [], inside)

                # ── georeference on the rooms both sources name ──────────────────────────────
                centres = {
                    name: np.asarray(np.nonzero(mask)[::-1]).mean(axis=1)
                    for name, mask in masks.items()
                    if mask.any()
                }
                shared = sorted(set(centres) & set(survey))
                if len(shared) < MIN_CORRESPONDENCES:
                    raise Refused(
                        f"only {len(shared)} rooms are named by both sources — too few to fit"
                    )
                src = np.array([centres[r] for r in shared])
                dst = np.array([survey[r] for r in shared])

                # A page's y axis runs down and northing runs up, so one of the two reflections is
                # right. Which one is decided by the residual, never assumed — the OTH pipeline
                # learned that with a 26 m error hiding behind a plausible-looking fit.
                options = []
                for flip in (np.array([1.0, 1.0]), np.array([1.0, -1.0])):
                    s, r, t = similarity(src * flip, dst)
                    err = np.linalg.norm((s * (src * flip) @ r.T + t) - dst, axis=1)
                    options.append((float(np.sqrt((err**2).mean())), flip, s, r, t))
                options.sort(key=lambda o: o[0])
                rms, flip, scale, rot, shift = options[0]
                print(
                    f"          {len(shared)} named correspondences, RMS {rms:.2f} m "
                    f"(other reflection {options[1][0]:.1f} m), {scale * 1000:.2f} mm/px"
                )

                refined, residual = fit_to_footprint(outline, (scale, rot, shift, flip), ring)
                scale, rot, shift, flip = refined
                print(
                    f"          outline fitted to the surveyed footprint: mean {residual:.2f} m, "
                    f"{scale * 1000:.2f} mm/px"
                )
                if residual > MAX_OUTLINE_RESIDUAL:
                    raise Refused(f"outline sits {residual:.2f} m off the footprint")

                to_world = lambda p, s=scale, r=rot, t=shift, f=flip: (s * (p * f) @ r.T) + t
                probe = to_world(np.array([[0.0, 0.0], [1.0, 0.0]]))
                metres_per_px = float(np.linalg.norm(probe[1] - probe[0]))

                kept, refused, strayed, oversized = 0, [], [], []
                for name, mask in sorted(masks.items()):
                    shaped = polygon_of(mask, to_world, metres_per_px)
                    if not shaped:
                        refused.append(name)
                        continue
                    polygon, area = shaped
                    if area > MAX_ROOM_M2:
                        oversized.append((name, area))
                        continue
                    stray = strays_outside(polygon, ring)
                    if stray > MAX_ROOM_OUTSIDE:
                        strayed.append((name, stray))
                        continue
                    rooms_out.append(
                        {
                            "ref": name,
                            "building": code,
                            "level": floor.level,
                            "usage": None,
                            "areaM2": area,
                            "polygonUtm32": polygon,
                            "sheet": floor.map_uri,
                        }
                    )
                    kept += 1

                moved = (scale * (src * flip) @ rot.T) + shift
                print(
                    f"          named rooms now sit a median "
                    f"{np.median(np.linalg.norm(moved - dst, axis=1)):.2f} m from their OSM twins"
                )
                print(f"          {kept} rooms extracted" + (f", {len(refused)} refused" if refused else ""))
                if strayed:
                    worst = ", ".join(f"{c} {d:.0f} m" for c, d in sorted(strayed, key=lambda s: -s[1])[:5])
                    print(f"          {len(strayed)} dropped for sitting outside the footprint: {worst}")
                if oversized:
                    worst = ", ".join(f"{c} {a:.0f} m²" for c, a in sorted(oversized, key=lambda s: -s[1])[:5])
                    print(f"          {len(oversized)} dropped for being too big to be a room: {worst}")

                if args.debug:
                    CACHE.mkdir(parents=True, exist_ok=True)
                    overlay = page.copy()
                    rng = np.random.default_rng(7)
                    for mask in masks.values():
                        colour = tuple(int(c) for c in rng.integers(60, 255, 3))
                        overlay[mask > 0] = (
                            0.5 * overlay[mask > 0] + 0.5 * np.array(colour)
                        ).astype(np.uint8)
                    cv2.imwrite(str(CACHE / f"debug-{floor.map_uri}.png"), overlay)
            except Refused as exc:
                # A refusal is about this floor, never about the run — the same rule the OTH
                # extractor learned when one bad sheet threw away the floors that had passed.
                print(f"{floor.code}: REFUSED — {exc}")
                skipped.append((floor.code, str(exc)))

    payload = {
        "source": "LMU München, Raumfinder (lmu.de/raumfinder) — floor plans and room coordinates "
        "published by the university, room outlines carved from the plan tiles",
        # ⚠️ Refs are unique inside a BUILDING, not inside the site: LMU numbers by Trakt, so `A 001`
        # exists in Oettingenstr. 67 and in the Hauptgebäude. The generator has to namespace them,
        # exactly as it already does for the surveyed rooms — 125 duplicate room ids were found the
        # last time that was assumed away.
        "refScope": "building",
        "buildings": {code: osm for code, osm in BUILDINGS.items()},
        "sheets": sorted({r["sheet"] for r in rooms_out}),
        "sheetsRefused": [{"sheet": name, "reason": why} for name, why in skipped],
        "count": len(rooms_out),
        "rooms": rooms_out,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nwrote {OUT.relative_to(ROOT)} — {len(rooms_out)} rooms")
    for name, why in skipped:
        print(f"  refused: {name} — {why}")


if __name__ == "__main__":
    main()
