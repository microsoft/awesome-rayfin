"""Write the room and booking data into the Lakehouse as Delta tables.

PLAN Phase 4. The app ships its own baked assets and will keep doing so (decision D4: the demo has
to survive a conference network). This step publishes the SAME facts into Fabric so the campus can
be queried with DAX, reported on, and asked questions in natural language — and so the two can be
proved to agree, which `verify_model_agreement.py` then does as a gate.

⚠️ **The source of truth is `public/terrain/<aoi>/rooms.json`, not the raw API caches.** Building
the Lakehouse from the same artefact the browser loads is what makes agreement meaningful. Building
it from the upstream JSON instead would let the two drift through any bug in `build_rooms.py` and
still report a match.

Tables (Delta, snake_case — the semantic model renames them to Title Case):
  building     one row per building
  room         one row per room, with area, seats and whether it has a calendar
  usage_type   the controlled vocabulary, with its teaching/service classification
  time_slot    the 70 hours of the teaching week, as a dimension
  room_hour    SPARSE fact: one row per (room, slot) that was ever booked
  course       what is timetabled in each room, with how often

Usage
  python tools/fabric/build_lakehouse_tables.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pyarrow as pa
from deltalake import write_deltalake

ROOT = Path(__file__).resolve().parents[2]
AOI = "garching"

from fabric_ids import lakehouse_id, workspace_id

WORKSPACE_ID = workspace_id()
LAKEHOUSE_ID = lakehouse_id()

AZ = shutil.which("az") or "az"

DAY_NAMES_DE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"]
DAY_NAMES_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]

TEACHING = (
    "hörsaal",
    "seminarraum",
    "unterrichtsraum",
    "übungsraum",
    "zeichensaal",
    "praktikumsraum",
    "studentenarbeitsraum",
    "lesesaal",
)
SERVICE = (
    "flur",
    "gang",
    "treppe",
    "aufzug",
    "schacht",
    "wc",
    "dusche",
    "sanitär",
    "putz",
    "lager",
    "installation",
    "leittechnik",
    "heizung",
    "lüftung",
    "klima",
    "strom",
    "technik",
    "müll",
    "abstell",
    "windfang",
    "vorraum",
    "schleuse",
    "garage",
)


def classify(usage: str | None) -> str:
    """Teaching, service or other — the same three buckets the renderer uses.

    ⚠️ Kept deliberately in step with `TEACHING` and `SERVICE` in `src/twin3d/rooms.ts`. If these
    drift, the model and the app will disagree about what counts as a teaching room and the
    agreement gate will fail — which is the intended outcome, but the fix belongs here.
    """
    if not usage:
        return "other"
    lowered = usage.lower()
    if any(hint in lowered for hint in TEACHING):
        return "teaching"
    if any(hint in lowered for hint in SERVICE):
        return "service"
    return "other"


def token(resource: str) -> str:
    out = subprocess.run(  # noqa: S603
        [AZ, "account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"],
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.strip()


def write(name: str, table: pa.Table, options: dict) -> None:
    # ⚠️ `Tables/<name>`, NOT `Tables/dbo/<name>`. A schema-qualified path produces a Lakehouse the
    # semantic model cannot bind to in Direct Lake mode, and the failure only appears at query time.
    root = f"abfss://{WORKSPACE_ID}@onelake.dfs.fabric.microsoft.com/{LAKEHOUSE_ID}"
    write_deltalake(
        f"{root}/Tables/{name}",
        table,
        mode="overwrite",
        schema_mode="overwrite",
        storage_options=options,
    )
    print(f"  {name:<12} {table.num_rows:>7,} rows  x {table.num_columns} cols")


def main() -> None:
    source = ROOT / "public" / "terrain" / AOI / "rooms.json"
    if not source.exists():
        raise SystemExit(f"{source} not found — run tools/geodata/build_rooms.py first")
    meta = json.loads(source.read_text(encoding="utf-8"))
    rooms = meta["rooms"]
    grid = meta["occupancyGrid"]
    slots = int(grid["slots"])
    hours = int(grid["hours"])
    first_hour = int(grid["firstHour"])

    occupancy_path = ROOT / "public" / "terrain" / AOI / "occupancy.bin"
    occupancy = occupancy_path.read_bytes() if occupancy_path.exists() else b""

    print(f"source: {source.name} — {len(rooms)} room polygons, {meta['withOccupancy']} with bookings")

    # ── room ────────────────────────────────────────────────────────────────────────────
    # ⚠️ Keyed on the room CODE, one row each — not one row per polygon.
    #
    # OpenStreetMap draws 5532.Z1.003 as two polygons on the same level. The renderer wants both,
    # because that is what the floor looks like; a dimension table cannot have both, and Direct
    # Lake says so bluntly — the first attempt at this model failed *every* query with "contains a
    # duplicate value '5532.Z1.003' ... not allowed for columns on the one side of a many-to-one
    # relationship". The agreement gate found it before a human did, which is what it is for.
    #
    # Areas are summed across a code's polygons. If they are two halves of one room that is right;
    # if it is a tagging slip it double-counts about 34 m² out of ~190 000. `polygon_count` keeps
    # that ambiguity visible instead of resolving it silently.
    merged: dict[str, dict] = {}
    for room in rooms:
        entry = merged.get(room["code"])
        if entry is None:
            merged[room["code"]] = {
                "room_code": room["code"],
                "building_code": room["building"],
                "level": int(room["level"]),
                "usage": room["usage"],
                "category": classify(room["usage"]),
                "room_name": room.get("name"),
                "area_m2": float(room["areaM2"]),
                "seats_synthetic": room.get("seats"),
                "has_calendar": room.get("occupancy") is not None,
                "polygon_count": 1,
            }
            continue
        entry["area_m2"] += float(room["areaM2"])
        entry["polygon_count"] += 1
        if room.get("seats") is not None:
            entry["seats_synthetic"] = (entry["seats_synthetic"] or 0) + room["seats"]
        entry["has_calendar"] = entry["has_calendar"] or room.get("occupancy") is not None

    extra = sum(e["polygon_count"] - 1 for e in merged.values())
    print(f"  {len(merged)} distinct room codes ({extra} extra polygon(s) merged into their code)")

    room_columns = [
        "room_code", "building_code", "level", "usage", "category",
        "room_name", "area_m2", "seats_synthetic", "has_calendar", "polygon_count",
    ]
    room_table = pa.table(
        {name: [entry[name] for entry in merged.values()] for name in room_columns},
        schema=pa.schema(
            [
                ("room_code", pa.string()),
                ("building_code", pa.string()),
                ("level", pa.int32()),
                ("usage", pa.string()),
                ("category", pa.string()),
                ("room_name", pa.string()),
                ("area_m2", pa.float64()),
                ("seats_synthetic", pa.int32()),
                ("has_calendar", pa.bool_()),
                ("polygon_count", pa.int32()),
            ]
        ),
    )

    # ── building ────────────────────────────────────────────────────────────────────────
    # Built from the merged rooms, so a building's room count is distinct rooms rather than
    # polygons and agrees with what the Room table holds.
    by_building: dict[str, dict] = {}
    for entry in merged.values():
        agg = by_building.setdefault(
            entry["building_code"], {"rooms": 0, "area": 0.0, "levels": set(), "with_calendar": 0}
        )
        agg["rooms"] += 1
        agg["area"] += entry["area_m2"]
        agg["levels"].add(entry["level"])
        if entry["has_calendar"]:
            agg["with_calendar"] += 1

    building_table = pa.table(
        {
            "building_code": list(by_building),
            "room_count": [v["rooms"] for v in by_building.values()],
            "area_m2": [round(v["area"], 1) for v in by_building.values()],
            "level_count": [len(v["levels"]) for v in by_building.values()],
            "rooms_with_calendar": [v["with_calendar"] for v in by_building.values()],
        },
        schema=pa.schema(
            [
                ("building_code", pa.string()),
                ("room_count", pa.int32()),
                ("area_m2", pa.float64()),
                ("level_count", pa.int32()),
                ("rooms_with_calendar", pa.int32()),
            ]
        ),
    )

    # ── usage_type ──────────────────────────────────────────────────────────────────────
    usages = sorted({room["usage"] for room in rooms if room["usage"]})
    usage_table = pa.table(
        {"usage": usages, "category": [classify(u) for u in usages]},
        schema=pa.schema([("usage", pa.string()), ("category", pa.string())]),
    )

    # ── time_slot ───────────────────────────────────────────────────────────────────────
    slot_table = pa.table(
        {
            "slot": list(range(slots)),
            "weekday": [s // hours for s in range(slots)],
            "day_de": [DAY_NAMES_DE[s // hours] for s in range(slots)],
            "day_en": [DAY_NAMES_EN[s // hours] for s in range(slots)],
            "hour": [(s % hours) + first_hour for s in range(slots)],
            "label": [
                f"{DAY_NAMES_DE[s // hours][:2]} {((s % hours) + first_hour):02d}:00"
                for s in range(slots)
            ],
        },
        schema=pa.schema(
            [
                ("slot", pa.int32()),
                ("weekday", pa.int32()),
                ("day_de", pa.string()),
                ("day_en", pa.string()),
                ("hour", pa.int32()),
                ("label", pa.string()),
            ]
        ),
    )

    # ── room_hour ───────────────────────────────────────────────────────────────────────
    # Sparse on purpose: only hours that were actually booked get a row. 3 921 rooms x 70 slots
    # would be 274 470 rows of mostly zeroes, and "no row" is the honest encoding of "never booked".
    #
    # Iterated per distinct code, like the Room table, so a room drawn as two polygons does not
    # contribute its booked hours twice.
    calendar_of: dict[str, int] = {}
    for room in rooms:
        if room.get("occupancy") is not None:
            calendar_of.setdefault(room["code"], int(room["occupancy"]))

    fact = {"room_code": [], "slot": [], "weeks_booked": []}
    for code, index in calendar_of.items():
        if not occupancy:
            break
        base = index * slots
        for slot in range(slots):
            weeks = occupancy[base + slot]
            if weeks:
                fact["room_code"].append(code)
                fact["slot"].append(slot)
                fact["weeks_booked"].append(int(weeks))

    room_hour_table = pa.table(
        fact,
        schema=pa.schema(
            [("room_code", pa.string()), ("slot", pa.int32()), ("weeks_booked", pa.int32())]
        ),
    )

    # ── course ──────────────────────────────────────────────────────────────────────────
    seen_courses: set[tuple[str, str]] = set()
    course = {"room_code": [], "title": [], "bookings": []}
    for room in rooms:
        for entry in room.get("courses") or []:
            key = (room["code"], entry["title"])
            if key in seen_courses:
                continue
            seen_courses.add(key)
            course["room_code"].append(room["code"])
            course["title"].append(entry["title"])
            course["bookings"].append(int(entry["count"]))

    course_table = pa.table(
        course,
        schema=pa.schema(
            [("room_code", pa.string()), ("title", pa.string()), ("bookings", pa.int32())]
        ),
    )

    # ── publish ─────────────────────────────────────────────────────────────────────────
    options = {
        "bearer_token": token("https://storage.azure.com"),
        "use_fabric_endpoint": "true",
    }
    print(f"\nwriting to {LAKEHOUSE_ID}:")
    write("building", building_table, options)
    write("room", room_table, options)
    write("usage_type", usage_table, options)
    write("time_slot", slot_table, options)
    write("room_hour", room_hour_table, options)
    write("course", course_table, options)

    print(
        f"\n{room_hour_table.num_rows:,} booked hours across {len(calendar_of)} rooms "
        f"({room_hour_table.num_rows / max(len(calendar_of), 1) / slots:.1%} of their teaching week)"
    )


if __name__ == "__main__":
    main()
