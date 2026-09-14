"""Build the Delta tables behind the semantic model (PLAN §8, Phase 6).

🔴 **The source is the shipped asset, not a re-derivation.** These tables are built from exactly
the bytes the browser downloads — `tracks.binz` and `tracks.json` — rather than from the original
725 MB archive. That is deliberate and it is the whole point of the phase gate: if the model were
rebuilt from the raw feed it could agree with the *data* while disagreeing with the *app*, and the
number on the slide would not be the number on the screen.

Grain, stated plainly because it is the thing most likely to be misread: **one row per position,
one row per passage.** A passage is one vessel's continuous transit through the AOI. The shipped
asset carries no vessel identity at all — Phase 3 dropped MMSI, name, call sign, IMO and
destination at ingest — so the model cannot count *distinct vessels* and does not pretend to. It
counts passages, exactly as the app does.

Privacy therefore needs no new enforcement here: there is nothing left to strip. That is what
filtering at the exporter buys you a phase later.
"""

from __future__ import annotations

import argparse
import gzip
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pyarrow as pa
from deltalake import write_deltalake

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools" / "geodata"))
from utm import utm32_to_wgs84_array  # noqa: E402

import ids  # noqa: E402

WORKSPACE_ID = ids.workspace_id()
LAKEHOUSE_ID = ids.lakehouse_id()
AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"

#: Vessel classes that ship without dimensions (Phase 3 privacy rule). Carried into the model so a
#: report can explain the gap rather than leave a reader wondering why a length is missing.
PRIVATE_TYPES = {"Pleasure", "Sailing", "Undefined", "Other", ""}


def onelake_token() -> str:
    out = subprocess.run(
        [AZ, "account", "get-access-token", "--resource", "https://storage.azure.com",
         "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.strip()


def load_tracks(base: Path) -> tuple[dict, dict[str, np.ndarray]]:
    meta = json.loads((base / "tracks.json").read_text(encoding="utf-8"))
    raw = gzip.decompress((base / meta["file"]).read_bytes())
    n = meta["pointCount"]
    return meta, {
        "x": np.frombuffer(raw, dtype="<i2", count=n, offset=0).astype(np.float64),
        "z": np.frombuffer(raw, dtype="<i2", count=n, offset=2 * n).astype(np.float64),
        "t": np.frombuffer(raw, dtype="<u2", count=n, offset=4 * n).astype(np.int64),
        "speed": np.frombuffer(raw, dtype=np.uint8, count=n, offset=6 * n).astype(np.float64),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="kieler-foerde")
    parser.add_argument("--dry-run", action="store_true",
                        help="build and report the tables without writing to OneLake")
    args = parser.parse_args()

    base = REPO / "public" / "terrain" / args.aoi
    meta, cols = load_tracks(base)
    n = meta["pointCount"]
    print(f"source: {meta['file']} — {meta['trackCount']} passages, {n:,} positions, "
          f"day {meta['date']}")

    second_of_day = cols["t"] * meta["timeStepS"]
    speed_kn = np.round(cols["speed"] * meta["speedStepKn"], 2)

    # Scene metres back to UTM, then to WGS84 — the exact inverse of what build_tracks.py did, so
    # a point on the Power BI map is the same point the 3D scene draws.
    centre_e = meta["originUtm"]["easting"]
    centre_n = meta["originUtm"]["northing"]
    easting = centre_e + cols["x"]
    northing = centre_n - cols["z"]          # +z is south
    lon, lat = utm32_to_wgs84_array(easting, northing)

    # A coarse grid for the report map. 44 084 individual points is far past what the map visual
    # will plot, and summing latitudes to "aggregate" them is meaningless — it produces one
    # bubble in the Atlantic. Binning to ~550 m gives a few hundred cells that read as a density
    # picture of the fairway, which is what the map is actually for.
    CELL_DEG = 0.005
    cell_lat = np.round(lat / CELL_DEG) * CELL_DEG
    cell_lon = np.round(lon / CELL_DEG) * CELL_DEG
    cell_key = [f"{la:.3f},{lo:.3f}" for la, lo in zip(cell_lat, cell_lon)]

    track_key = np.zeros(n, dtype=np.int32)
    vessel_type = np.empty(n, dtype=object)
    for index, track in enumerate(meta["tracks"]):
        start, count = track["start"], track["count"]
        track_key[start:start + count] = index
        vessel_type[start:start + count] = track["type"] or "Undefined"

    day = datetime.strptime(meta["date"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    timestamps = [day + timedelta(seconds=int(s)) for s in second_of_day]

    position = pa.table({
        "position_key": pa.array(np.arange(n, dtype=np.int32)),
        "track_key": pa.array(track_key),
        "vessel_type": pa.array(vessel_type.tolist(), pa.string()),
        "observed_at": pa.array(timestamps, pa.timestamp("us", tz="UTC")),
        "second_of_day": pa.array(second_of_day.astype(np.int32)),
        "hour_of_day": pa.array((second_of_day // 3600).astype(np.int32)),
        "latitude": pa.array(np.round(lat, 6)),
        "longitude": pa.array(np.round(lon, 6)),
        "cell_latitude": pa.array(np.round(cell_lat, 4)),
        "cell_longitude": pa.array(np.round(cell_lon, 4)),
        "cell_key": pa.array(cell_key, pa.string()),
        "scene_x_m": pa.array(cols["x"].astype(np.float32)),
        "scene_z_m": pa.array(cols["z"].astype(np.float32)),
        "speed_kn": pa.array(speed_kn),
    })

    tracks = meta["tracks"]
    track = pa.table({
        "track_key": pa.array(np.arange(len(tracks), dtype=np.int32)),
        "vessel_type": pa.array([t["type"] or "Undefined" for t in tracks], pa.string()),
        "from_second": pa.array([t["fromS"] for t in tracks], pa.int32()),
        "to_second": pa.array([t["toS"] for t in tracks], pa.int32()),
        "duration_s": pa.array([t["toS"] - t["fromS"] for t in tracks], pa.int32()),
        "position_count": pa.array([t["count"] for t in tracks], pa.int32()),
        "started_at": pa.array([day + timedelta(seconds=int(t["fromS"])) for t in tracks],
                               pa.timestamp("us", tz="UTC")),
    })

    # Disconnected hour dimension. The app's "vessels under way" is an INTERVAL OVERLAP, not a
    # group-by on the positions — a passage counts for an hour it crosses even if it happens to
    # report no position inside it. A dimension with no relationship is what lets the DAX express
    # that, and getting this wrong is the single most likely way for the two to disagree.
    hours = np.arange(24, dtype=np.int32)
    hour = pa.table({
        "hour_of_day": pa.array(hours),
        "hour_label": pa.array([f"{h:02d}:00" for h in hours], pa.string()),
        "hour_start_second": pa.array((hours * 3600).astype(np.int32)),
        "hour_end_second": pa.array(((hours + 1) * 3600).astype(np.int32)),
    })

    types = sorted({t["type"] or "Undefined" for t in tracks})
    vessel_class = pa.table({
        "vessel_type": pa.array(types, pa.string()),
        "is_commercial": pa.array([t not in PRIVATE_TYPES for t in types], pa.bool_()),
        "carries_dimensions": pa.array([t not in PRIVATE_TYPES for t in types], pa.bool_()),
    })

    tables = {
        "vessel_position": position,
        "vessel_track": track,
        "hour_of_day": hour,
        "vessel_class": vessel_class,
    }

    print("\ntables:")
    for name, table in tables.items():
        print(f"  {name:18} {table.num_rows:>7,} rows  {len(table.column_names)} cols")

    # A last guard at the boundary rather than a comment claiming there is nothing to guard.
    banned = {"mmsi", "name", "callsign", "call_sign", "imo", "destination", "vessel_id",
              "vessel_name", "ship_name"}
    for name, table in tables.items():
        leaked = banned.intersection({c.lower() for c in table.column_names})
        if leaked:
            raise SystemExit(f"{name} would publish identifying columns: {sorted(leaked)}")
    print("  no identifying column in any table")

    if args.dry_run:
        print("\ndry run — nothing written")
        return

    token = onelake_token()
    root = f"abfss://{WORKSPACE_ID}@onelake.dfs.fabric.microsoft.com/{LAKEHOUSE_ID}"
    options = {"bearer_token": token, "use_fabric_endpoint": "true"}
    print(f"\nwriting to {root}/Tables/")
    for name, table in tables.items():
        write_deltalake(f"{root}/Tables/{name}", table, mode="overwrite",
                        storage_options=options, schema_mode="overwrite")
        print(f"  wrote {name}")
    print("done")


if __name__ == "__main__":
    main()
