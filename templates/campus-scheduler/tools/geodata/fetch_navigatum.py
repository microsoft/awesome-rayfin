"""Download room semantics from the NavigaTUM API.

PLAN Phase 2, step 2. OpenStreetMap supplies the room polygons; this supplies what each room
actually *is* — its usage type, its official code and, for teaching rooms, the calendar that Phase
3 turns into utilisation.

⚠️ **Be a good citizen.** NavigaTUM is run by students, is donation-funded and carries no SLA. The
naive implementation fetches `/api/locations/{code}` once per room, which is ~3 900 requests for
this campus. Instead the room list for a whole building comes back from ONE search request with
`limit_rooms` raised, so the entire campus costs about 25 requests. Detail is then fetched only for
teaching rooms, because those are the ones the occupancy lens is actually about.

⚠️ **Usage type has to come from the room's own endpoint.** The search result carries a string in
parentheses — `5606.02.020 (Seminarraum)` — which looks like a usage type and is not one. It is
TUMonline's free-text room NAME, and across this campus it takes 1 900 distinct values including
`Prüflabor Ofenraum` and `Chemisches Syntheselabor 1`. Classifying rooms by keyword-matching that
would be guesswork dressed as data. The controlled vocabulary — `Hörsaal`, `Seminarraum`, `Büro`,
the same one the campus summary counts by — is only on `/locations/{code}` as `type_common_name`.

So detail IS fetched per room, but only for the rooms that will actually be rendered: those that
OpenStreetMap has a polygon for. That is ~3 900 requests rather than ~14 000, it is cached to disk
line by line so an interrupted run resumes, and it happens once.

Output (data/raw/navigatum/<aoi>/):
  rooms.json      every room: code, name, usage, building, whether a calendar exists
  buildings.json  the building tree that was walked
  detail.jsonl    resumable cache of per-room detail fetches

Usage
  python tools/geodata/fetch_navigatum.py --aoi garching
"""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from aoi import cache_dir, load_aoi

USER_AGENT = "Campus-Insights/0.1 (open geodata pipeline; academic demo)"

#: A leaf building is a four-digit Gebäudekennung; anything else is a group (`mw`, `physik`, ...).
BUILDING_CODE = re.compile(r"^\d{4}$")

#: The usage names that make a room part of the occupancy story. Matched case-insensitively
#: against the parsed display name, so `Unterrichtsraum ohne Infrastruktur` matches too.
TEACHING_HINTS = (
    "hörsaal",
    "seminarraum",
    "übungsraum",
    "unterrichtsraum",
    "praktikumsraum",
    "studentenarbeitsraum",
    "zeichensaal",
    "lesesaal",
)

#: Extracts the parenthetical from `5606.02.020 (Seminarraum)`.
DISPLAY_NAME = re.compile(r"^\S+\s+\((.*)\)\s*$")


def api(path: str, attempts: int = 4) -> dict:
    url = f"https://nav.tum.de/api{path}"
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=90) as response:  # noqa: S310
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise
            last = exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
        wait = 5 * (attempt + 1)
        print(f"    retrying {path} in {wait}s ({last})")
        time.sleep(wait)
    raise RuntimeError(f"NavigaTUM failed for {path}: {last}")


def walk_buildings(root_id: str) -> list[dict]:
    """Every leaf building under a campus, depth-first.

    The campus endpoint lists a mixture of individual buildings and groups (`mw` covers 5501-5510),
    so groups have to be descended rather than assumed to be buildings.
    """
    found: dict[str, dict] = {}
    queue = [root_id]
    seen: set[str] = set()

    while queue:
        current = queue.pop(0)
        if current in seen:
            continue
        seen.add(current)
        try:
            node = api(f"/locations/{urllib.parse.quote(current)}")
        except urllib.error.HTTPError:
            continue

        overview = node.get("sections", {}).get("buildings_overview", {})
        entries = overview.get("entries", [])
        for entry in entries:
            entry_id = str(entry.get("id", ""))
            if BUILDING_CODE.match(entry_id):
                found[entry_id] = {"code": entry_id, "name": entry.get("name"), "parent": current}
            elif entry_id and entry_id not in seen:
                queue.append(entry_id)

        # A node with no children that is itself a building code is a leaf.
        if BUILDING_CODE.match(current) and current not in found:
            found[current] = {"code": current, "name": node.get("name"), "parent": root_id}
        time.sleep(0.2)

    return sorted(found.values(), key=lambda b: b["code"])


def rooms_of(code: str) -> list[dict]:
    """Every room in one building, from a single search request.

    ⚠️ **Both `limit_rooms` and `limit_all` are required.** `limit_rooms` alone looks like it
    works and does not: the response still reports the true hit count in `estimatedTotalHits`
    while returning the default nine entries, because `limit_all` caps the total across all
    facets. The first run of this script collected 457 rooms out of 14 151 and printed a tidy
    "9 rooms" for almost every building, which is exactly what a silent truncation looks like.
    """
    query = urllib.parse.quote(code)
    data = api(f"/search?q={query}&limit_rooms=1000&limit_all=1000")
    rooms = []
    truncated = False
    for section in data.get("sections", []):
        if section.get("facet") != "rooms":
            continue
        entries = section.get("entries", [])
        # If the service ever returns fewer than it claims to have, say so rather than quietly
        # building a partial campus.
        if len(entries) < int(section.get("estimatedTotalHits", 0)):
            truncated = True
        for entry in entries:
            room_id = str(entry.get("id", ""))
            # The search is fuzzy, so a query for 5606 also returns 5607. Keep only this building.
            if not room_id.startswith(f"{code}."):
                continue
            display = str(entry.get("name", ""))
            match = DISPLAY_NAME.match(display)
            rooms.append(
                {
                    "code": room_id,
                    "building": code,
                    "display": display,
                    "usage": match.group(1).strip() if match else None,
                }
            )
    if truncated:
        print(f"    ⚠️ {code}: the search returned fewer rooms than it reported having")
    return rooms


def is_teaching(usage: str | None) -> bool:
    if not usage:
        return False
    lowered = usage.lower()
    return any(hint in lowered for hint in TEACHING_HINTS)


def osm_building_codes(aoi_id: str, ref_key: str) -> set[str]:
    """Building codes that appear as a prefix of an OSM room reference."""
    return {code.split(".")[0] for code in osm_room_codes(aoi_id, ref_key) if "." in code}


def osm_room_codes(aoi_id: str, ref_key: str) -> set[str]:
    """Room codes OpenStreetMap has a polygon for — the set the app will actually draw."""
    path = cache_dir("raw", "osm", aoi_id) / "indoor.json"
    if not path.exists():
        return set()
    data = json.loads(path.read_text(encoding="utf-8"))
    codes = set()
    for element in data.get("elements", []):
        tags = element.get("tags", {})
        if tags.get("indoor") != "room":
            continue
        ref = tags.get(ref_key)
        if ref:
            codes.add(str(ref).strip())
    return codes


def load_detail_cache(path) -> dict[str, dict]:
    """Per-room detail fetched by an earlier run. One JSON object per line, so a run that is
    interrupted after 2 000 requests does not start again from zero."""
    cache: dict[str, dict] = {}
    if not path.exists():
        return cache
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        cache[record["code"]] = record
    return cache


def fetch_detail(code: str) -> dict:
    node = api(f"/locations/{urllib.parse.quote(code)}")
    props = node.get("props", {}) or {}
    computed = {c.get("name"): c.get("text") for c in (props.get("computed") or [])}
    return {
        "code": code,
        "name": node.get("name"),
        "usage": node.get("type_common_name"),
        "floorName": computed.get("Stockwerk"),
        "address": computed.get("Adresse"),
        "hasCalendar": bool(props.get("calendar_url")),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="garching")
    parser.add_argument("--force", action="store_true")
    parser.add_argument(
        "--detail",
        choices=("osm", "none"),
        default="osm",
        help="fetch authoritative per-room detail for rooms with OSM geometry (default), or skip",
    )
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    rooms_cfg = cfg.get("rooms")
    if not rooms_cfg:
        print(f"AOI '{cfg['id']}' declares no `rooms` block — nothing to fetch.")
        return

    out_dir = cache_dir("raw", "navigatum", cfg["id"])
    rooms_path = out_dir / "rooms.json"
    buildings_path = out_dir / "buildings.json"
    if rooms_path.exists() and not args.force:
        cached = json.loads(rooms_path.read_text(encoding="utf-8"))
        print(f"cached: {rooms_path} ({len(cached)} rooms, --force to re-query)")
        return

    campus = rooms_cfg["navigatumCampusId"]
    ref_key = rooms_cfg.get("osmRefKey", "ref:tum")

    print(f"walking the building tree under '{campus}'...")
    walked = walk_buildings(campus)
    print(f"  {len(walked)} buildings from the tree")

    # ⚠️ **The tree is not enough, and the gap is exactly the interesting part.**
    #
    # `mw` and `mi` are `type=joined_building`: they represent a whole connected complex, carry
    # only a `rooms_overview`, and expose NO child buildings. So a pure tree walk can never reach
    # 5501-5510 or 5601-5613 — which are precisely the buildings OpenStreetMap has mapped indoors,
    # and the only ones the occupancy lens can use. The first run of this script walked 56
    # buildings, enumerated 6 526 rooms, and matched 35 of the 3 929 rooms that have geometry.
    #
    # Building codes therefore come from three sources unioned together: the tree, the prefixes of
    # the OSM room references, and the AOI config's explore list. Each covers a different failure.
    codes: dict[str, dict] = {b["code"]: b for b in walked}
    for code in sorted(osm_building_codes(cfg["id"], ref_key)):
        codes.setdefault(code, {"code": code, "name": None, "parent": "osm"})
    for entry in rooms_cfg.get("exploreBuildings", []):
        codes.setdefault(
            entry["code"], {"code": entry["code"], "name": entry.get("name"), "parent": "config"}
        )

    buildings = sorted(codes.values(), key=lambda b: b["code"])
    from_osm = sum(1 for b in buildings if b["parent"] == "osm")
    print(f"  {len(buildings)} buildings after adding {from_osm} discovered from OSM references")
    buildings_path.write_text(json.dumps(buildings, ensure_ascii=False, indent=2), encoding="utf-8")

    all_rooms: list[dict] = []
    for index, building in enumerate(buildings, start=1):
        found = rooms_of(building["code"])
        all_rooms.extend(found)
        print(f"  [{index:>2}/{len(buildings)}] {building['code']} "
              f"{str(building['name'])[:40]:<42} {len(found):>4} rooms")
        time.sleep(0.3)

    teaching = [r for r in all_rooms if is_teaching(r["usage"])]
    print(f"\n{len(all_rooms)} rooms enumerated")

    # ── Authoritative usage, for the rooms that will actually be drawn ────────────────────
    renderable = osm_room_codes(cfg["id"], ref_key)
    if renderable:
        targets = [r for r in all_rooms if r["code"] in renderable]
        print(f"{len(renderable)} codes have OSM geometry; {len(targets)} of them are in the "
              f"enumerated set")
    else:
        # No indoor data fetched yet — fall back to the rooms that look like teaching space, so
        # this script is still useful on its own.
        targets = teaching
        print(f"no OSM indoor data yet — falling back to {len(targets)} teaching-looking rooms")

    if args.detail != "none" and targets:
        detail_path = out_dir / "detail.jsonl"
        cache = load_detail_cache(detail_path)
        todo = [r for r in targets if r["code"] not in cache]
        print(f"detail: {len(cache)} cached, {len(todo)} to fetch")

        with detail_path.open("a", encoding="utf-8") as sink:
            for index, room in enumerate(todo, start=1):
                try:
                    record = fetch_detail(room["code"])
                except urllib.error.HTTPError:
                    record = {"code": room["code"], "usage": None, "missing": True}
                cache[room["code"]] = record
                sink.write(json.dumps(record, ensure_ascii=False) + "\n")
                sink.flush()
                if index % 100 == 0 or index == len(todo):
                    print(f"    {index}/{len(todo)}")
                time.sleep(0.12)

        applied = 0
        for room in all_rooms:
            record = cache.get(room["code"])
            if not record or record.get("missing"):
                continue
            # The controlled vocabulary replaces the free-text room name; the name is kept.
            room["name"] = record.get("name") or room.get("display")
            room["usage"] = record.get("usage") or room["usage"]
            room["floorName"] = record.get("floorName")
            room["address"] = record.get("address")
            room["hasCalendar"] = record.get("hasCalendar", False)
            room["authoritative"] = True
            applied += 1
        print(f"  applied authoritative usage to {applied} rooms")

    with_calendar = sum(1 for r in all_rooms if r.get("hasCalendar"))
    print(f"  {with_calendar} rooms publish a calendar")

    usage_counts: dict[str, int] = {}
    for room in all_rooms:
        if not room.get("authoritative"):
            continue
        key = room["usage"] or "(unknown)"
        usage_counts[key] = usage_counts.get(key, 0) + 1
    print("\ntop usage types (authoritative only):")
    for usage, count in sorted(usage_counts.items(), key=lambda kv: -kv[1])[:14]:
        print(f"  {usage[:44]:<46} {count:>5}")

    rooms_path.write_text(json.dumps(all_rooms, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {rooms_path} ({rooms_path.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
