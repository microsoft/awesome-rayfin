"""Build the room geometry the exploding-building view renders.

Emits the three files `src/twin3d/rooms.ts` already knows how to read:

  rooms.json      metadata + one record per room
  rooms.bin       Int32 (x, z) outline vertices in scene metres / xzScaleM
  occupancy.bin   Uint8, one row per room: how booked each hour of the teaching week is

TWO KINDS OF ROOM, and the difference is the point:

  measured   Gebäude K's ground floor — 28 outlines OpenStreetMap actually surveyed, with real
             areas and, for 25 of them, real names. Drawn exactly as mapped.
  generated  everything else — plates laid out inside the building's REAL footprint polygon at
             the right storey count. Correct count, correct area, correct floor; arranged, not
             surveyed. Badged `generated` on every record so the UI can say so.

Occupancy is NOT invented separately: it is read off the 983 timetabled sessions, so the colour a
room takes is the plan the solver is working on. That is what makes the 3D view an answer rather
than a decoration.

    python tools/data/build_room_geometry.py --site oth
    python tools/data/build_room_geometry.py --site lmu
"""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "geodata"))
sys.path.insert(0, str(ROOT / "tools" / "data"))
from sites import add_site_argument, load_site  # noqa: E402
from utm import wgs84_to_utm32  # noqa: E402

# Bound in main() from --site. Module-level because every helper below reads them and threading a
# site object through all of them would obscure the geometry, which is the interesting part.
SITE = load_site("oth")
AOI: dict = SITE.aoi()
BUILDINGS: dict = {}
OSM_ROOMS: dict = {}
PLAN_ROOMS: dict = {}
SYNTH: Path = SITE.synth
OUT: Path = SITE.terrain_dir()

XZ_SCALE = 0.01  # centimetre quantisation — a room outline does not need more
# ⚠️ ASSUMED, and read from the AOI so the assumption is per-site. LoD2 gives building heights but
# not floor-to-floor pitch. Get it wrong and exploded floors interpenetrate.
STOREY_M = 3.5

# The hourly grid the room shader expects. Our blocks are 90 minutes, so a booked block paints
# the hour cells it overlaps; 08:00-20:00 covers every block in the scheme.
DAYS = ["Mo", "Di", "Mi", "Do", "Fr"]
FIRST_HOUR = 8
HOURS = 12
SLOTS = len(DAYS) * HOURS


def load(name: str) -> list[dict]:
    return json.loads((SYNTH / f"{name}.json").read_text(encoding="utf-8"))


def world_extent() -> tuple[float, float, float, float]:
    """Exactly the transform `src/geo/world.ts` uses. Any drift here puts rooms beside buildings."""
    b = AOI["bbox"]
    corners = [
        wgs84_to_utm32(b["west"], b["south"]),
        wgs84_to_utm32(b["west"], b["north"]),
        wgs84_to_utm32(b["east"], b["north"]),
        wgs84_to_utm32(b["east"], b["south"]),
    ]
    eastings = [c[0] for c in corners]
    northings = [c[1] for c in corners]
    min_e, max_e = min(eastings), max(eastings)
    min_n, max_n = min(northings), max(northings)
    return min_e, max_n, max_e - min_e, max_n - min_n


class Terrain:
    """Ground elevation, sampled from the heightmap the pipeline already built."""

    def __init__(self) -> None:
        meta = json.loads((OUT / "heightmap.json").read_text(encoding="utf-8"))
        self.w, self.h = meta["width"], meta["height"]
        self.res = meta["resolutionM"]
        self.ox = meta["origin"]["easting"]
        self.oy = meta["origin"]["northing"]
        lo, hi = meta["heightMinM"], meta["heightMaxM"]
        raw = np.fromfile(OUT / "heightmap.u16", dtype="<u2").reshape(self.h, self.w)
        self.elev = lo + (raw.astype(np.float64) / 65535.0) * (hi - lo)

    def at(self, easting: float, northing: float) -> float:
        col = int(round((easting - self.ox) / self.res))
        row = int(round((self.oy + self.h * self.res - northing) / self.res))
        col = max(0, min(self.w - 1, col))
        row = max(0, min(self.h - 1, row))
        return float(self.elev[row, col])


def point_in_polygon(x: float, y: float, poly: list[list[float]]) -> bool:
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            if x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                inside = not inside
    return inside


def plates_in_footprint(poly: list[list[float]], n_rooms: int, mean_area: float) -> list[list[list[float]]]:
    """Lay `n_rooms` rectangular plates inside a real footprint.

    A grid clipped to the polygon, not a subdivision of its bounding box: an L-shaped or
    courtyard building would otherwise get rooms hanging in the open air. Cell size starts from
    the mean room area and shrinks until enough cells fall inside the outline — buildings are not
    rectangles and a fixed guess either overflows or leaves half the floor empty.
    """
    if n_rooms <= 0 or len(poly) < 3:
        return []
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    min_x, max_x, min_y, max_y = min(xs), max(xs), min(ys), max(ys)

    side = max(3.0, math.sqrt(max(mean_area, 9.0)))
    for _ in range(8):
        cells: list[list[list[float]]] = []
        nx = max(1, int((max_x - min_x) // side))
        ny = max(1, int((max_y - min_y) // side))
        for iy in range(ny):
            for ix in range(nx):
                cx = min_x + (ix + 0.5) * side
                cy = min_y + (iy + 0.5) * side
                if not point_in_polygon(cx, cy, poly):
                    continue
                # ⚠️ LEAVE ROOM FOR THE CORRIDOR, OR THE FLOOR READS AS ONE SHEET.
                #
                # This was a flat 0.35 m inset, which on a ~6 m cell leaves the plate covering
                # ~78% of its cell and the floor covering ~55% of the footprint. The only floors
                # this project can MEASURE — the published plans — put rooms at 32-40% of the
                # footprint, the rest being corridors, stairs, walls and WCs. So a generated floor
                # drawn the old way was half as dense again as any real floor beside it, and from
                # above it read as a slab: that is what "the rooms look weird" was pointing at when
                # invented storeys sat over Prüfening's real ground floor.
                #
                # A PROPORTIONAL inset keeps the grid legible at any cell size and lands the floor
                # inside the measured band. The plate is a schematic of a room either way — its
                # stated area comes from the dataset, not from this rectangle — so narrowing it
                # costs no accuracy it ever had.
                h = side * 0.36
                cells.append([[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]])
        if len(cells) >= n_rooms:
            # Take the cells nearest the middle first, so a partially-filled floor looks occupied
            # rather than randomly speckled.
            mid_x, mid_y = (min_x + max_x) / 2, (min_y + max_y) / 2
            cells.sort(key=lambda c: (c[0][0] - mid_x) ** 2 + (c[0][1] - mid_y) ** 2)
            return cells[:n_rooms]
        side *= 0.8
    return cells[:n_rooms]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    add_site_argument(parser)
    args = parser.parse_args()

    global SITE, AOI, BUILDINGS, OSM_ROOMS, PLAN_ROOMS, SYNTH, OUT, STOREY_M
    SITE = load_site(args.site)
    AOI = SITE.aoi()
    BUILDINGS = SITE.read_json(SITE.buildings) or {"buildings": []}
    OSM_ROOMS = SITE.read_json(SITE.osm_rooms) or {"rooms": []}
    # Rooms read off the university's own published floor plans.
    PLAN_ROOMS = (SITE.read_json(SITE.plan_rooms) if SITE.plan_rooms else None) or {"rooms": []}
    SYNTH = SITE.synth
    OUT = SITE.terrain_dir()
    STOREY_M = float(AOI.get("rooms", {}).get("storeyHeightM", STOREY_M))
    min_e, max_n, width_m, depth_m = world_extent()
    terrain = Terrain()

    rooms = load("room")
    slots = {s["slotId"]: s for s in load("time_slot")}
    sessions = {s["sessionId"]: s for s in load("course_session")}
    courses = {c["courseId"]: c for c in load("course")}
    assignments = load("plan_assignment")
    buildings_synth = {b["buildingId"]: b for b in load("building")}

    by_osm = {b["osmId"]: b for b in BUILDINGS["buildings"]}
    # ⚠️ JOIN ON THE OSM ID, NOT THE ROOM CODE. This was keyed on `roomId` -> survey `ref`, which
    # worked at OTH only because the two happened to be the same string there. The moment LMU's
    # room codes were namespaced by building to stop 125 duplicates ('ax A 001' rather than
    # 'A 001'), every one of its 520 surveyed outlines stopped matching — and the lookup failed
    # SILENTLY, so the build reported "0 vermessen, 8796 generiert" and cheerfully drew generated
    # plates over the only real interior on the site. An id that survives a renaming is the only
    # honest key here.
    real_by_osm = {r["osmId"]: r for r in OSM_ROOMS["rooms"] if r.get("osmId")}
    real_by_ref = {r["ref"]: r for r in OSM_ROOMS["rooms"]}
    # ⚠️ Keyed by (ref, building, level), not by ref alone. Room codes repeat between buildings and
    # between sites, and this file is OTH's; a bare-ref lookup is how the surveyed-room join once
    # failed SILENTLY and drew generated plates over the only real interior on the site.
    drawn_by_key = {
        (r["ref"], r["building"], r["level"]): r for r in PLAN_ROOMS.get("rooms", [])
    }
    unmatched_measured: list[str] = []

    # ── occupancy from the actual plan ──────────────────────────────────────────────────
    booked: dict[str, list[int]] = defaultdict(lambda: [0] * SLOTS)
    room_courses: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for a in assignments:
        slot = slots.get(a["slotId"])
        sess = sessions.get(a["sessionId"])
        if not slot or not sess:
            continue
        day_i = DAYS.index(slot["day"]) if slot["day"] in DAYS else 0
        start_h = int(slot["startTime"].split(":")[0])
        start_min = int(slot["startTime"].split(":")[1])
        end_h = int(slot["endTime"].split(":")[0])
        end_min = int(slot["endTime"].split(":")[1])
        first = start_h
        last = end_h if end_min > 0 else end_h - 1
        for hour in range(first, last + 1):
            idx = day_i * HOURS + (hour - FIRST_HOUR)
            if 0 <= hour - FIRST_HOUR < HOURS:
                booked[a["roomId"]][idx] = 1
        title = courses.get(sess["courseId"], {}).get("title", sess["courseId"])
        room_courses[a["roomId"]][title] += 1

    # ── geometry ────────────────────────────────────────────────────────────────────────
    vertices: list[tuple[int, int]] = []
    records: list[dict] = []
    occupancy_rows: list[list[int]] = []
    coverage: list[dict] = []

    rooms_by_building: dict[str, list[dict]] = defaultdict(list)
    for r in rooms:
        rooms_by_building[r["buildingId"]].append(r)

    for building_id, building_rooms in sorted(rooms_by_building.items()):
        synth = buildings_synth.get(building_id)
        if not synth:
            continue
        source = by_osm.get(synth["osmId"])
        poly = (source or {}).get("polygonUtm32")
        if not poly:
            continue

        ground = terrain.at(synth["easting"], synth["northing"])
        built = 0

        by_level: dict[int, list[dict]] = defaultdict(list)
        for r in building_rooms:
            by_level[r["level"]].append(r)

        # ⚠️ INVENTED FLOORS ARE DRAWN AGAIN, INCLUDING ABOVE A PUBLISHED ONE.
        #
        # This used to skip any floor with no evidence in a building whose other floors had some,
        # because an invented grid sitting on an architect's drawing read as a solid slab: a
        # published floor covers 34-40% of the footprint in irregular rooms with corridors, while
        # the generated grid covered 49-59% in rooms that abut.
        #
        # That diagnosis was half right. The grid was dense because the TIMETABLE was sizing it for
        # the whole building and placing it on the one or two open storeys — three floors of stock
        # on one floor. That sizing bug is fixed (`len(open_levels)` in generate_timetable), and
        # skipping the floors as well took the building's remaining storeys out of the model
        # entirely: opening Prüfening's `a` showed sixteen plates in a dimmed void, because one of
        # its three storeys existed. A building with nothing above its ground floor looks broken in
        # a way the slab never did.
        #
        # So the floors come back, sized correctly, and each room still carries its own provenance
        # so the plan-derived outlines remain distinguishable from the generated plates.
        for level, level_rooms in sorted(by_level.items()):
            outlines: list[tuple[dict, list[list[float]]]] = []

            # A room the architect drew beats one OpenStreetMap sketched, which beats a plate we
            # laid out ourselves. The plan carries its own area, so the figure the panel prints is
            # the area of the polygon actually on screen rather than the dataset's estimate of it.
            measured, generated = [], []
            for r in level_rooms:
                # ⚠️ THE PLAN'S BUILDING LETTER IS NOT ALWAYS THE DATASET'S, AND NEITHER IS ITS ROOM
                # NUMBER. OTH publishes the whole Prüfening complex as one plan and numbers its
                # rooms `P …`; the dataset files them under the six surveyed polygons that actually
                # contain them. LMU numbers by Trakt, so `A 001` is not unique across the city and
                # the dataset namespaces it to `ax A 001`. The room row therefore carries BOTH the
                # published building and the published ref for exactly this join — keying on the
                # dataset's own ids would find nothing and the drawn outlines would silently be
                # replaced by generated plates, the same failure the OSM-id note above records.
                drawn = drawn_by_key.get(
                    (
                        r.get("planRef") or r["roomId"],
                        r.get("planBuilding") or building_id,
                        level,
                    )
                )
                if drawn:
                    outlines.append(
                        ({**r, "provenance": "plan", "areaM2": drawn["areaM2"]}, drawn["polygonUtm32"])
                    )
                elif r.get("provenance") == "measured":
                    measured.append(r)
                else:
                    generated.append(r)

            for r in measured:
                real = real_by_osm.get(r.get("osmId")) or real_by_ref.get(r["roomId"])
                if real:
                    outlines.append((r, real["polygonUtm32"]))
                else:
                    unmatched_measured.append(r["roomId"])

            if generated:
                mean_area = sum(r["areaM2"] for r in generated) / len(generated)
                plates = plates_in_footprint(poly, len(generated), mean_area)
                outlines.extend(zip(generated, plates))

            for room, outline in outlines:
                if len(outline) < 3:
                    continue
                offset = len(vertices)
                for e, n in outline:
                    x = e - min_e - width_m / 2
                    z = max_n - n - depth_m / 2
                    vertices.append((int(round(x / XZ_SCALE)), int(round(z / XZ_SCALE))))

                grid = booked.get(room["roomId"])
                occ_index = None
                if grid and any(grid):
                    occ_index = len(occupancy_rows)
                    occupancy_rows.append(grid)

                titles = sorted(room_courses.get(room["roomId"], {}).items(),
                                key=lambda kv: -kv[1])
                records.append({
                    "code": room["roomId"],
                    "building": building_id,
                    "level": level,
                    "usage": room["roomType"],
                    "name": room.get("displayName"),
                    "areaM2": room["areaM2"],
                    "seats": room["capacity"],
                    "baseM": round(ground + level * STOREY_M, 2),
                    "heightM": STOREY_M - 0.4,
                    "vertexOffset": offset,
                    "vertexCount": len(outline),
                    "occupancy": occ_index,
                    "courses": [{"title": t, "count": c} for t, c in titles[:6]] or None,
                    "provenance": room.get("provenance", "generated"),
                })
                built += 1

        coverage.append({"building": building_id, "expected": len(building_rooms), "built": built})

    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / "rooms.bin").open("wb") as fh:
        # ⚠️ Int32, and NO clamping.
        #
        # This used to pack Int16 with `max(-32768, min(32767, x))`. Scene coordinates run to
        # ±1535 m for this AOI, so at 1 cm quantisation every value is ~±153500 and the clamp
        # silently mapped ALL of them to 32767 — every room in the campus collapsed onto one
        # point, the exploded view rendered degenerate triangles, and the room COUNT still
        # looked right because it comes from the JSON. The clamp was presumably there to stop
        # struct.error; it converted a loud crash into invisible corruption.
        #
        # A range check that raises is the point: if the data ever outgrows the format again,
        # the build stops instead of shipping a flat campus.
        limit = 2**31 - 1
        for x, z in vertices:
            if not (-limit <= x <= limit and -limit <= z <= limit):
                raise SystemExit(
                    f"room vertex {(x, z)} exceeds int32 at {XZ_SCALE} m quantisation — "
                    "coarsen XZ_SCALE or store coordinates relative to each building"
                )
            fh.write(struct.pack("<ii", x, z))
    with (OUT / "occupancy.bin").open("wb") as fh:
        for row in occupancy_rows:
            fh.write(bytes(row))

    measured_n = sum(1 for r in records if r["provenance"] == "measured")
    plan_n = sum(1 for r in records if r["provenance"] == "plan")

    # ── how much of the building stock exists in the model at all ───────────────────────────────
    #
    # ⚠️ MEASURED FROM THE OUTPUT, NOT FROM THE STEP THAT DROPPED IT. The floors missing here were
    # removed by two different decisions in two different files — the timetable stopped giving
    # plan-covered buildings any invented rooms, and this file skips invented floors above a real
    # one — so counting either one alone under-reports. Comparing the levels that ended up with
    # rooms against the levels the building actually has is indifferent to which step is
    # responsible, and stays correct if a third one is added.
    levels_drawn: dict[str, set] = defaultdict(set)
    for r in records:
        levels_drawn[r["building"]].add(r.get("level"))
    total_levels = 0
    unmodelled_levels = 0
    partial_buildings: list[str] = []
    by_building: dict[str, dict[str, int]] = {}
    per_campus: dict[str, dict[str, int]] = {}
    for bid, b in sorted(buildings_synth.items()):
        have = b.get("levels") or 0
        got = len(levels_drawn.get(bid, ()))
        total_levels += have
        camp = str(b.get("campusId") or "")
        stat = per_campus.setdefault(camp, {"levels": 0, "modelled": 0, "partialBuildings": 0})
        stat["levels"] += have
        stat["modelled"] += got
        if got < have:
            unmodelled_levels += have - got
            partial_buildings.append(f"{bid} ({got}/{have})")
            by_building[bid] = {"levels": have, "modelled": got}
            stat["partialBuildings"] += 1

    if unmatched_measured:
        raise SystemExit(
            f"{len(unmatched_measured)} rooms are marked `measured` in the dataset but no surveyed "
            f"outline could be found for them, e.g. {unmatched_measured[:5]}.\n"
            "Refusing to write: the alternative is drawing generated plates over real geometry and "
            "reporting it as a complete build, which is what this check exists to stop."
        )
    meta = {
        "aoi": SITE.aoi_id,
        "count": len(records),
        "buildings": len({r["building"] for r in records}),
        "withUsage": len(records),
        "withOccupancy": len(occupancy_rows),
        "quantisation": {"xzScaleM": XZ_SCALE, "yScaleM": 0.01},
        "occupancyGrid": {
            "days": len(DAYS),
            "firstHour": FIRST_HOUR,
            "hours": HOURS,
            "slots": SLOTS,
            "meaning": "1 = in dieser Stunde belegt, 0 = frei (eine repräsentative Semesterwoche)",
            "semester": "synthetisch, ein Planungslauf",
        },
        "provenance": {
            # ⚠️ THE PLAN SOURCE IS READ FROM THE PLAN FILE, NOT WRITTEN HERE. This sentence used
            # to be hardcoded to "OTH Regensburg, veröffentlichte Geschosspläne … CAD-Zeichnung des
            # Architekten" while the line below already parameterised `SITE.label`. Run for LMU it
            # therefore credited OTH Regensburg with LMU's 686 plan rooms, and named the wrong
            # method too: LMU's outlines come from the Raumfinder's plan tiles, not from an
            # architect's CAD sheet. Both files already declare their own `source`, correctly and
            # differently — so use it. A provenance field that lies is worse than none, because it
            # is the field a reader trusts to know what is real.
            "outlines (Bauplan)": (
                f"{PLAN_ROOMS.get('source', SITE.label)} — {plan_n} Räume"
            ),
            "outlines (vermessen)": (
                f"OpenStreetMap indoor=room, ODbL — {measured_n} vermessene Räume "
                f"({SITE.label})"
            ),
            "outlines (alle übrigen)": "generiert: Raster im ECHTEN Gebäudeumriss, richtige Anzahl "
                                        "und Fläche, aber nicht vermessen",
            # ⚠️ SAY WHAT IS MISSING, NOT JUST WHAT IS THERE. Where a building has a published
            # plan, the storeys without one are left undrawn rather than filled with a grid — an
            # invented floor sitting on top of the architect's own drawing looked like a solid slab
            # over a real floor plan, and invited the reader to take both for measurements.
            #
            # ⚠️ AND THIS SENTENCE USED TO COUNT THE WRONG THING. It reported the floors skipped
            # HERE, at drawing time — which became 0 the moment the timetable stopped inventing
            # rooms for plan-covered buildings at all. "0 Geschoss(e) bleiben leer" is true and
            # reads as "nothing is missing", while Prüfening's six buildings are three storeys each
            # and only the published ground floor of any of them exists anywhere in the model. The
            # honest figure is how much of the building stock is MODELLED, which is measured below
            # and does not depend on which upstream step dropped it.
            "nicht gezeichnete Geschosse": (
                f"{unmodelled_levels} von {total_levels} Geschoss(en) in "
                f"{len(partial_buildings)} Gebäude(n) sind nicht modelliert — für sie liegt kein "
                "Plan vor, und es wird kein Grundriss erfunden, wo ein echter danebenliegt. "
                f"Betroffen: {', '.join(partial_buildings[:8])}"
                + (" …" if len(partial_buildings) > 8 else "")
            ),
            "Gebäudeumrisse": "OpenStreetMap, ODbL",
            "Geschosshöhe": f"angenommen {STOREY_M} m",
            "Belegung": "aus dem synthetischen Stundenplan (plan_assignment), nicht separat erfunden",
        },
        "coverage": coverage,
        # ⚠️ THE SAME FACT AS THE PROVENANCE SENTENCE, IN A FORM THE APP CAN READ. The sentence is
        # for a human reading the file; a panel that wants to warn "this campus is modelled to a
        # third of its height" must not have to parse German prose to find that out. Per campus,
        # because the gap is not spread evenly: at OTH it is almost entirely Prüfening.
        "levelCoverage": {
            "levels": total_levels,
            "modelled": total_levels - unmodelled_levels,
            "partialBuildings": len(partial_buildings),
            "byCampus": per_campus,
            # Only the buildings that ARE partial. Listing all 23 would make the common case —
            # a building modelled to its full height — indistinguishable from the exception.
            "byBuilding": by_building,
        },
        "rooms": records,
    }
    (OUT / "rooms.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")

    # ⚠️ Count each provenance rather than subtracting one from the total. Written as
    # "len(records) - measured_n = generiert" this reported 2093 generated the moment plan-derived
    # rooms appeared, when 2026 were — a summary that quietly absorbs anything it does not know
    # about is exactly the kind of reassuring number that hides a regression.
    generated_n = len(records) - measured_n - plan_n
    print(
        f"rooms      {len(records)}  ({plan_n} aus Bauplan, {measured_n} vermessen, "
        f"{generated_n} generiert)"
    )
    print(f"buildings  {meta['buildings']}")
    print(
        f"levels     {meta['levelCoverage']['modelled']}/{meta['levelCoverage']['levels']} "
        f"modelled, {meta['levelCoverage']['partialBuildings']} building(s) below their own height"
    )
    print(f"vertices   {len(vertices)}  -> rooms.bin {len(vertices) * 8 / 1024:.0f} KB")
    print(f"occupancy  {len(occupancy_rows)} rooms with bookings -> occupancy.bin "
          f"{len(occupancy_rows) * SLOTS / 1024:.0f} KB")
    print(f"json       {(OUT / 'rooms.json').stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
