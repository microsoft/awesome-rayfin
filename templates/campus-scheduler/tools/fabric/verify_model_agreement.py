"""Prove the app and the semantic model agree.

PLAN Phase 4 exit criterion: *a KPI in the 3D panel and the same KPI in a DAX query agree to the
decimal.*

This is a gate, not a report. Two implementations of the same question are computed independently
and compared:

  * **app side** — Python, reading the very assets the browser downloads
    (`public/terrain/<aoi>/rooms.json` and `occupancy.bin`), re-implementing what
    `src/twin3d/rooms.ts` and the occupancy panel do
  * **model side** — DAX, over Direct Lake tables in Fabric

They share no code. If a measure is defined differently from the app — and the obvious way to
define utilisation, total booked hours over total available hours, IS different from what the app
does — this is what catches it.

Usage
  python tools/fabric/verify_model_agreement.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AOI = "garching"

from fabric_ids import workspace_id

WORKSPACE_ID = workspace_id()
MODEL_NAME = "Campus Scheduler — Raum & Belegung"
WEEK_SLOTS = 70

#: Absolute tolerance. Counts must match exactly; shares are compared at four decimals, which is
#: far tighter than anything the UI displays.
TOLERANCE = 1e-4

AZ = shutil.which("az") or "az"

TEACHING = (
    "hörsaal", "seminarraum", "unterrichtsraum", "übungsraum",
    "zeichensaal", "praktikumsraum", "studentenarbeitsraum", "lesesaal",
)


def token(resource: str) -> str:
    out = subprocess.run(  # noqa: S603
        [AZ, "account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"],
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.strip()


def model_id() -> str:
    headers = {"Authorization": f"Bearer {token('https://api.fabric.microsoft.com')}"}
    listing = json.loads(
        urllib.request.urlopen(  # noqa: S310
            urllib.request.Request(
                f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}/semanticModels",
                headers=headers,
            ),
            timeout=120,
        ).read()
    )
    match = next((m for m in listing.get("value", []) if m["displayName"] == MODEL_NAME), None)
    if not match:
        raise SystemExit(f"no semantic model named {MODEL_NAME} — run build_semantic_model.py")
    return match["id"]


def dax(dataset: str, query: str) -> list[dict]:
    body = json.dumps(
        {"queries": [{"query": query}], "serializerSettings": {"includeNulls": True}}
    ).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.powerbi.com/v1.0/myorg/datasets/{dataset}/executeQueries",
        data=body,
        headers={
            "Authorization": f"Bearer {token('https://analysis.windows.net/powerbi/api')}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:  # noqa: S310
            return json.loads(response.read())["results"][0]["tables"][0]["rows"]
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"DAX failed: {exc.code}\n{exc.read().decode('utf-8', 'replace')[:1200]}")


def is_teaching(usage: str | None) -> bool:
    return bool(usage) and any(hint in usage.lower() for hint in TEACHING)


def from_app() -> dict[str, float]:
    """The figures as the browser computes them, from the assets the browser loads.

    Everything is counted per distinct room CODE, because that is what a room is. `rooms.json`
    holds POLYGONS, and one room on this campus (5532.Z1.003) is drawn as two of them.
    """
    meta = json.loads((ROOT / "public" / "terrain" / AOI / "rooms.json").read_text(encoding="utf-8"))
    occupancy = (ROOT / "public" / "terrain" / AOI / "occupancy.bin").read_bytes()
    slots = int(meta["occupancyGrid"]["slots"])

    by_code: dict[str, dict] = {}
    for polygon in meta["rooms"]:
        room = by_code.get(polygon["code"])
        if room is None:
            by_code[polygon["code"]] = {
                "building": polygon["building"],
                "usage": polygon["usage"],
                "areaM2": float(polygon["areaM2"]),
                "occupancy": polygon.get("occupancy"),
            }
            continue
        room["areaM2"] += float(polygon["areaM2"])
        if room["occupancy"] is None:
            room["occupancy"] = polygon.get("occupancy")

    def booked(room: dict) -> int:
        base = room["occupancy"] * slots
        return sum(1 for s in range(slots) if occupancy[base + s])

    rooms = list(by_code.values())
    with_calendar = [(r, booked(r)) for r in rooms if r["occupancy"] is not None]
    teaching_with_calendar = [(r, b) for r, b in with_calendar if is_teaching(r["usage"])]

    utilisation = [b / WEEK_SLOTS for _, b in with_calendar]
    teaching_utilisation = [b / WEEK_SLOTS for _, b in teaching_with_calendar]
    hero = [b / WEEK_SLOTS for r, b in teaching_with_calendar if r["building"] == "5506"]

    return {
        "Räume": len(rooms),
        "Gebäude": len({r["building"] for r in rooms}),
        "Räume mit Kalender": len(with_calendar),
        "Lehrräume": sum(1 for r in rooms if is_teaching(r["usage"])),
        "Fläche m2": round(sum(r["areaM2"] for r in rooms), 1),
        "Belegte Stunden": sum(b for _, b in with_calendar),
        "Zeitliche Auslastung %": sum(utilisation) / len(utilisation) if utilisation else 0.0,
        "Zeitliche Auslastung Lehrräume %": (
            sum(teaching_utilisation) / len(teaching_utilisation) if teaching_utilisation else 0.0
        ),
        "Räume ohne Belegung": sum(1 for _, b in with_calendar if b == 0),
        "5506 Lehrräume %": sum(hero) / len(hero) if hero else 0.0,
    }


def from_model(dataset: str) -> dict[str, float]:
    rows = dax(
        dataset,
        """
        EVALUATE ROW(
            "Räume", [Räume],
            "Gebäude", [Gebäude],
            "Räume mit Kalender", [Räume mit Kalender],
            "Lehrräume", [Lehrräume],
            "Fläche m2", [Fläche m2],
            "Belegte Stunden", [Belegte Stunden],
            "Zeitliche Auslastung %", [Zeitliche Auslastung %],
            "Zeitliche Auslastung Lehrräume %", [Zeitliche Auslastung Lehrräume %],
            "Räume ohne Belegung", [Räume ohne Belegung]
        )
        """,
    )
    values = {key.strip("[]"): value for key, value in rows[0].items()}

    hero = dax(
        dataset,
        """
        EVALUATE
        CALCULATETABLE(
            ROW("v", [Zeitliche Auslastung Lehrräume %]),
            'Building'[building_code] = "5506"
        )
        """,
    )
    values["5506 Lehrräume %"] = list(hero[0].values())[0]
    return values


def main() -> None:
    dataset = model_id()
    print(f"model: {dataset}\n")

    app = from_app()
    model = from_model(dataset)

    print(f"{'measure':<36} {'app':>14} {'model':>14}   verdict")
    print("-" * 84)
    failures: list[str] = []
    for key, expected in app.items():
        actual = model.get(key)
        if actual is None:
            failures.append(f"{key}: the model returned nothing")
            print(f"{key:<36} {expected:>14.4f} {'—':>14}   MISSING")
            continue
        ok = abs(float(actual) - float(expected)) <= TOLERANCE
        if not ok:
            failures.append(f"{key}: app {expected} vs model {actual}")
        print(f"{key:<36} {expected:>14.4f} {float(actual):>14.4f}   {'ok' if ok else 'MISMATCH'}")

    print()
    if failures:
        print(f"AGREEMENT FAILED ({len(failures)}):\n")
        for problem in failures:
            print(f"  - {problem}")
        print(
            "\nThe app and the model are computing different things. Fix the measure or the app,\n"
            "not this test."
        )
        sys.exit(1)

    print(f"app and model agree on all {len(app)} figures, to {TOLERANCE:g}")


if __name__ == "__main__":
    main()
