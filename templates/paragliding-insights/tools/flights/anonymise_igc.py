"""Bundle an IGC flight with its identifying records removed.

PLAN §2.2.3 and decision 24. An IGC file is personal location history: where somebody was, on
which day, for how long, and how they flew. Every bundled flight therefore ships **anonymised at
import**, not merely hidden in the interface — the identifying records are removed from the file
that is committed, so there is no version of it in the repository that still carries them.

That applies to the author's own flights too. "It's my own track" is exactly the reasoning that
puts personal data in a public repo.

⚠️ This script deliberately does NOT reproject, resample or re-encode the track. The file that
ships is still a valid IGC that any flight-analysis tool can read, and the browser parses it with
the same code path it uses for a file the viewer drags in. One parser, one set of edge cases, one
thing to get right.

Usage
  python tools/flights/anonymise_igc.py --source "E:/.../igcs" --flight 2021-04-24
  python tools/flights/anonymise_igc.py --source "E:/.../igcs" --list
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DESTINATION = REPO / "public" / "flights"

#: Header records that identify a person or an individual aircraft.
#:
#: `HFPLT` is the pilot's name and `HFGID` the glider's registration — between them they identify
#: both the human and the wing. `HFCM2` is the second crew member, `HFGTY` the wing model. The
#: model is not personal data on its own, but combined with a date, a launch site and a landing
#: time it narrows a public XC listing to one person, so it goes too.
IDENTIFYING = ("HFPLT", "HFCM2", "HFGID", "HFGTY", "HFCID", "HFCCL")

#: Anything in an L (logbook/comment) record is free text written by the instrument or the pilot,
#: so it cannot be checked field by field. Dropped wholesale.
DROP_PREFIXES = ("L",)

#: ⚠️ The A record carries the LOGGER SERIAL NUMBER and is the easiest identifier to miss.
#:
#: It is the first line of the file and looks innocuous — `AXTR8792F7BA787F` — but everything after
#: the three-character manufacturer code is a stable, unique per-device id. Two flights carrying
#: the same A record are provably the same instrument, and therefore the same pilot, which is
#: precisely the linkage stripping `HFPLT` is meant to prevent. The first version of this script
#: removed the serial from the FILENAME and left it in the file, which achieves nothing.
#:
#: The manufacturer code is kept because it says which instrument family produced the fixes, which
#: is genuinely relevant to how the altitudes should be read. The id is replaced with `000`, the
#: three characters the format requires.
A_RECORD = re.compile(r"^A(?P<manufacturer>[A-Z0-9]{3})(?P<loggerId>.*)$")

B_RECORD = re.compile(
    r"^B(?P<h>\d{2})(?P<m>\d{2})(?P<s>\d{2})"
    r"(?P<latDeg>\d{2})(?P<latMin>\d{5})(?P<latHem>[NS])"
    r"(?P<lonDeg>\d{3})(?P<lonMin>\d{5})(?P<lonHem>[EW])"
    r"(?P<fix>[AV])(?P<pressure>[-\d]\d{4})(?P<gps>[-\d]\d{4})"
)


def parse_b_record(line: str) -> dict | None:
    match = B_RECORD.match(line)
    if not match:
        return None
    g = match.groupdict()
    lat = int(g["latDeg"]) + int(g["latMin"]) / 60000.0
    lon = int(g["lonDeg"]) + int(g["lonMin"]) / 60000.0
    if g["latHem"] == "S":
        lat = -lat
    if g["lonHem"] == "W":
        lon = -lon
    return {
        "seconds": int(g["h"]) * 3600 + int(g["m"]) * 60 + int(g["s"]),
        "lat": lat,
        "lon": lon,
        "pressureM": int(g["pressure"]),
        "gpsM": int(g["gps"]),
        "valid": g["fix"] == "A",
    }


def summarise(lines: list[str]) -> dict:
    points = [p for line in lines if (p := parse_b_record(line))]
    if not points:
        raise ValueError("no B records — this is not a track log")
    lats = [p["lat"] for p in points]
    lons = [p["lon"] for p in points]
    alts = [p["gpsM"] for p in points]
    date = ""
    for line in lines:
        if line.startswith("HFDTE"):
            digits = re.sub(r"\D", "", line[5:])[:6]
            if len(digits) == 6:
                date = f"20{digits[4:6]}-{digits[2:4]}-{digits[0:2]}"
            break
    duration = points[-1]["seconds"] - points[0]["seconds"]
    return {
        "date": date,
        "points": len(points),
        "durationS": duration,
        "latMin": min(lats),
        "latMax": max(lats),
        "lonMin": min(lons),
        "lonMax": max(lons),
        "altMinM": min(alts),
        "altMaxM": max(alts),
    }


def anonymise(lines: list[str]) -> tuple[list[str], list[str]]:
    """Return (cleaned lines, what was removed)."""
    cleaned: list[str] = []
    removed: list[str] = []
    for line in lines:
        stripped = line.rstrip("\r\n")
        if not stripped:
            continue
        if stripped.startswith("A") and (match := A_RECORD.match(stripped)):
            if match.group("loggerId") not in ("", "000"):
                removed.append(stripped)
            cleaned.append(f"A{match.group('manufacturer')}000")
            continue
        if stripped.startswith(IDENTIFYING):
            # Keep the record but blank its value, so the file stays structurally a valid IGC and
            # a reader can see the field was deliberately emptied rather than never present.
            key = stripped[:5]
            label = stripped[5:].split(":")[0]
            if stripped[5:] not in ("", f"{label}:"):
                removed.append(stripped)
            cleaned.append(f"{key}{label}:")
            continue
        if stripped.startswith(DROP_PREFIXES):
            removed.append(stripped)
            continue
        cleaned.append(stripped)
    return cleaned, removed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="folder of .igc files")
    parser.add_argument("--flight", default=None, help="date prefix, e.g. 2021-04-24")
    parser.add_argument("--label", default=None, help="public name, default 'Beispielflug'")
    parser.add_argument("--list", action="store_true", help="summarise every flight and stop")
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(f"{args.source} not found")

    files = sorted(p for p in args.source.iterdir() if p.suffix.lower() == ".igc")
    if not files:
        raise SystemExit(f"no .igc files in {args.source}")

    if args.list:
        print(f"{len(files)} flights in {args.source}\n")
        for path in files:
            try:
                info = summarise(path.read_text(encoding="latin-1").splitlines())
            except ValueError as exc:
                print(f"  {path.name}: {exc}")
                continue
            print(
                f"  {path.name:<42} {info['points']:>6} pts  "
                f"{info['durationS'] // 60:>4} min  "
                f"{info['altMinM']:>5}-{info['altMaxM']:>5} m  "
                f"{info['latMin']:.3f}-{info['latMax']:.3f} N / "
                f"{info['lonMin']:.3f}-{info['lonMax']:.3f} E"
            )
        return

    if not args.flight:
        raise SystemExit("--flight is required unless --list is given")

    matches = [p for p in files if p.name.startswith(args.flight)]
    if not matches:
        raise SystemExit(f"no flight starting with '{args.flight}'")
    if len(matches) > 1:
        raise SystemExit(f"'{args.flight}' matches {len(matches)} files: {[p.name for p in matches]}")
    source = matches[0]

    lines = source.read_text(encoding="latin-1").splitlines()
    info = summarise(lines)
    cleaned, removed = anonymise(lines)

    DESTINATION.mkdir(parents=True, exist_ok=True)
    # ⚠️ Named for the DATE ONLY. The source filename embeds the instrument's serial number
    # (`...-XTR-8792F7BA787F-01.IGC`), which is a stable per-device identifier — carrying it into a
    # public repository would undo the anonymisation the rest of this script performs.
    target = DESTINATION / f"{info['date']}.igc"
    target.write_text("\n".join(cleaned) + "\n", encoding="ascii", errors="replace")

    print(f"source : {source.name}")
    print(f"target : {target.relative_to(REPO)}")
    print(f"points : {info['points']}   duration {info['durationS'] // 60} min")
    print(f"extent : {info['latMin']:.4f}-{info['latMax']:.4f} N / {info['lonMin']:.4f}-{info['lonMax']:.4f} E")
    print(f"height : {info['altMinM']} - {info['altMaxM']} m")
    print(f"removed: {len(removed)} identifying or free-text records")
    for line in removed[:10]:
        print(f"   - {line[:70]}")

    # A residual check on the file that actually ships, rather than on the intent.
    written = target.read_text(encoding="ascii")
    leaked = [
        key
        for key in IDENTIFYING
        if any(
            line.startswith(key) and line[5:].split(":", 1)[-1].strip()
            for line in written.splitlines()
        )
    ]
    for line in written.splitlines():
        if line.startswith("A") and (match := A_RECORD.match(line)):
            if match.group("loggerId") != "000":
                leaked.append(f"A record logger id {match.group('loggerId')!r}")
            break
    # The serial should not survive anywhere else in the file either — some instruments repeat it
    # in an I or J extension record.
    original_serial = ""
    for line in lines:
        if line.startswith("A") and (match := A_RECORD.match(line.strip())):
            original_serial = match.group("loggerId")
            break
    if original_serial and original_serial in written:
        leaked.append(f"logger serial {original_serial!r} still present in the file body")

    if leaked:
        target.unlink()
        raise SystemExit(f"identifying records survived anonymisation: {leaked} — file deleted")

    index_path = DESTINATION / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"flights": []}
    index["flights"] = [f for f in index["flights"] if f["id"] != info["date"]]
    index["flights"].append(
        {
            "id": info["date"],
            "file": target.name,
            "label": args.label or "Beispielflug",
            "date": info["date"],
            "points": info["points"],
            "durationS": info["durationS"],
            "altMinM": info["altMinM"],
            "altMaxM": info["altMaxM"],
            "bounds": {
                "south": round(info["latMin"], 6),
                "north": round(info["latMax"], 6),
                "west": round(info["lonMin"], 6),
                "east": round(info["lonMax"], 6),
            },
            "anonymised": True,
            "note": (
                "Pilot and glider records removed at import (PLAN §2.2.3). The instrument serial "
                "number is not part of the filename for the same reason."
            ),
        }
    )
    index["flights"].sort(key=lambda f: f["id"])
    index_path.write_text(json.dumps(index, indent=2), encoding="utf-8")
    print(f"index  : {index_path.relative_to(REPO)} ({len(index['flights'])} flights)")


if __name__ == "__main__":
    sys.exit(main())
