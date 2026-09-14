"""Turn filtered AIS positions into replayable vessel tracks.

PLAN §9 phase 3. Input is the AOI-filtered CSV from `fetch_ais.py`; output is a planar binary the
browser can scrub through, plus a JSON index.

🔴 **AtoN messages are dropped.** 624 of the day's rows are *Aids to Navigation* — buoys, beacons
and light structures, which broadcast on AIS but are not vessels. Left in, they become stationary
"tracks", several of them standing on land, and they would fail the registration gate for a reason
that has nothing to do with registration. That is worth stating plainly: the gate is only
trustworthy if what it tests is what it claims to test.

🔴 **Identity is decided upstream, at ingest, and this stage only carries what it is given.**
`fetch_ais.py --identity` chooses between a real MMSI plus name, call sign, IMO, destination and
draught, and a per-day salted pseudonym. Both shapes flow through here unchanged: a track whose
source row had no name simply has no name, which is also what every mode produces for a vessel
that never transmitted a static report. Keeping the decision in one place stops this stage from
quietly applying a second, different rule.

Encoding: planar int16 x, int16 z (metres from the AOI centre, quantised), uint16 t (2 s from the
start of the day, so a full day fits), uint8 speed (0.2 kn). 10 bytes per position.

Usage
  python tools/ais/build_tracks.py
  python tools/ais/build_tracks.py --date 2026-07-01 --gap-minutes 20
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import struct
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "geodata"))

from aoi import bbox_wsen, cache_dir, load_aoi, terrain_dir  # noqa: E402
from utm import bbox_to_utm32, wgs84_to_utm32  # noqa: E402

#: Ship types whose dimensions are not exported. A pleasure craft's length is a step towards
#: identifying it; a container ship's is a fact about a commercial vehicle.
PRIVATE_TYPES = {"Pleasure", "Sailing", "Undefined", "Other", ""}

TIME_STEP_S = 2
SPEED_STEP_KN = 0.2


def parse_time(text: str) -> datetime | None:
    try:
        return datetime.strptime(text, "%d/%m/%Y %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="kieler-foerde")
    parser.add_argument("--date", default="2026-07-01")
    parser.add_argument("--gap-minutes", type=float, default=20.0,
                        help="a silence longer than this starts a new track")
    parser.add_argument("--min-points", type=int, default=6)
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    west, south, east, north = bbox_wsen(cfg, "core")
    e0, n0, e1, n1 = bbox_to_utm32(west, south, east, north)
    centre_e = (e0 + e1) / 2
    centre_n = (n0 + n1) / 2

    source = cache_dir("ais") / f"{args.date}_{cfg['id']}.csv"
    if not source.exists():
        raise SystemExit(f"no filtered AIS at {source} — run tools/ais/fetch_ais.py first")

    by_vessel: dict[str, list[dict]] = defaultdict(list)
    dropped_aton = 0
    with source.open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row["mobile"] == "AtoN":
                dropped_aton += 1
                continue
            when = parse_time(row["time"])
            if when is None:
                continue
            try:
                lat, lon = float(row["lat"]), float(row["lon"])
            except ValueError:
                continue
            by_vessel[row["vessel"]].append({
                "t": when, "lat": lat, "lon": lon,
                "sog": float(row["sog"] or 0.0),
                "type": row["shiptype"] or "",
                "length": row["length"] or "",
                "width": row["width"] or "",
                # Absent when the ingest ran anonymously, and absent for a vessel that never sent
                # a static report even when it did not. `.get` rather than `[]` so an older CSV
                # still builds.
                "mmsi": row.get("mmsi", ""),
                "name": row.get("name", ""),
                "callsign": row.get("callsign", ""),
                "imo": row.get("imo", ""),
                "destination": row.get("destination", ""),
                "draught": row.get("draught", ""),
            })

    print(f"AIS {args.date}: {len(by_vessel)} vessels "
          f"({dropped_aton} AtoN rows dropped — navigation marks are not vessels)")

    day_start = datetime.strptime(args.date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    xs: list[int] = []
    zs: list[int] = []
    ts: list[int] = []
    ss: list[int] = []
    tracks: list[dict] = []
    reach = 0.0

    for vessel, points in by_vessel.items():
        points.sort(key=lambda p: p["t"])
        segments: list[list[dict]] = [[]]
        for point in points:
            if segments[-1] and (point["t"] - segments[-1][-1]["t"]).total_seconds() \
                    > args.gap_minutes * 60:
                segments.append([])
            segments[-1].append(point)

        for segment in segments:
            if len(segment) < args.min_points:
                continue
            start = len(xs)
            for point in segment:
                easting, northing = wgs84_to_utm32(point["lon"], point["lat"])
                x = easting - centre_e
                z = centre_n - northing  # +z south, matching terrain and buildings
                reach = max(reach, abs(x), abs(z))
                xs.append(int(round(x)))
                zs.append(int(round(z)))
                ts.append(max(0, min(65535, int(
                    (point["t"] - day_start).total_seconds() / TIME_STEP_S))))
                ss.append(max(0, min(255, int(round(point["sog"] / SPEED_STEP_KN)))))
            ship_type = segment[0]["type"] or "Undefined"
            record = {
                "vessel": vessel,
                "type": ship_type,
                "start": start,
                "count": len(xs) - start,
                "fromS": int((segment[0]["t"] - day_start).total_seconds()),
                "toS": int((segment[-1]["t"] - day_start).total_seconds()),
            }
            # Dimensions only for commercial traffic — see the privacy note.
            if ship_type not in PRIVATE_TYPES:
                for key in ("length", "width"):
                    if segment[0][key]:
                        record[key] = int(float(segment[0][key]))

            # ⚠️ Take identity from the first report in the segment that actually carries it, not
            # from `segment[0]`. A static report arrives every few minutes while positions arrive
            # every few seconds, so the first row of a passage very often has an empty name while
            # the vessel is perfectly well identified thirty seconds later.
            for key, field in (("mmsi", "mmsi"), ("name", "name"), ("callSign", "callsign"),
                              ("imo", "imo"), ("destination", "destination"),
                              ("draughtM", "draught")):
                value = next((p[field] for p in segment if p.get(field)), "")
                if value:
                    record[key] = value
            tracks.append(record)

    if not tracks:
        raise SystemExit("no tracks survived segmentation — check the gap and point thresholds")

    # int16 metres reaches ±32.7 km, which covers this AOI plus its margin comfortably. Asserted
    # rather than assumed, because a wider AOI would wrap silently.
    if reach > 32767:
        raise SystemExit(f"track vertices reach {reach:.0f} m — beyond int16 metres")

    payload = (struct.pack(f"<{len(xs)}h", *xs)
               + struct.pack(f"<{len(zs)}h", *zs)
               + struct.pack(f"<{len(ts)}H", *ts)
               + struct.pack(f"<{len(ss)}B", *ss))
    blob = gzip.compress(payload, 6)

    out = terrain_dir(cfg)
    out.mkdir(parents=True, exist_ok=True)
    (out / "tracks.binz").write_bytes(blob)

    by_type: dict[str, int] = {}
    for track in tracks:
        by_type[track["type"]] = by_type.get(track["type"], 0) + 1

    meta = {
        "aoi": cfg["id"],
        "date": args.date,
        "trackCount": len(tracks),
        "pointCount": len(xs),
        "vesselCount": len(by_vessel),
        "namedTrackCount": sum(1 for t in tracks if t.get("name")),
        "byType": dict(sorted(by_type.items(), key=lambda kv: -kv[1])),
        "encoding": ("planar int16 x (m), int16 z (m), uint16 t "
                     f"({TIME_STEP_S} s from 00:00 UTC), uint8 speed ({SPEED_STEP_KN} kn); "
                     "+x east, +z south"),
        "timeStepS": TIME_STEP_S,
        "speedStepKn": SPEED_STEP_KN,
        "originUtm": {"easting": centre_e, "northing": centre_n},
        # 🔴 The same origin in geographic terms. The relay's `--replay` mode has to turn these
        # planar metres back into degrees, because the wire format a real feed uses is degrees and
        # short-circuiting that would leave the live path's projection untested. It used to do so
        # against a hard-coded 54.383/10.175 — the first AOI's centre — so replaying a *second*
        # AOI's day placed every vessel about 30 km from where it sailed, in the wrong inlet, with
        # no error anywhere. The centre now travels with the data that needs it.
        "originLonLat": {"lon": round((west + east) / 2, 6), "lat": round((south + north) / 2, 6)},
        "file": "tracks.binz",
        "bytes": len(payload),
        "compressedBytes": len(blob),
        "gapMinutes": args.gap_minutes,
        "atonRowsDropped": dropped_aton,
        "source": "Danish Maritime Authority — historical AIS, free for download",
        "attribution": "AIS-Daten: Danish Maritime Authority (aisdata.ais.dk), frei verfügbar",
        "identityNote": (
            "Vessel identity is carried as published by the source. MMSI, name, call sign, IMO "
            "number, destination and draught are transmitted in clear by every vessel under "
            "SOLAS and are republished openly by the Danish Maritime Authority; this file "
            "reproduces a bounding-box subset of that open archive. Rebuild with "
            "`fetch_ais.py --identity commercial` to pseudonymise pleasure and sailing craft, or "
            "`--identity anonymous` for a per-day salted pseudonym throughout."),
        "identifiedTracks": sum(1 for t in tracks if t.get("name")),
        "builtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "tracks": tracks,
    }
    (out / "tracks.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")

    print(f"  {len(tracks)} tracks, {len(xs):,} positions")
    print(f"  {meta['namedTrackCount']} tracks carry a vessel name")
    print(f"  by type: {', '.join(f'{k} {v}' for k, v in list(meta['byType'].items())[:8])}")
    print(f"  tracks.binz  {len(payload) / 1e6:.2f} MB raw -> {len(blob) / 1e6:.2f} MB gzipped")
    print(f"  written to {out}")


if __name__ == "__main__":
    main()
