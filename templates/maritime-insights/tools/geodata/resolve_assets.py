"""Resolve the AOI's protected assets from OpenStreetMap — verified, never recalled.

PLAN §4.4's rule is absolute: **no coordinate enters the built assets without a query whose result
a human has looked at.** This script is that query for the counter-UAS scenario, which needs to
point at real critical infrastructure rather than at a plausible-looking dot.

🔴 **Civil infrastructure only, by choice.** The queries also return military installations. They
are deliberately excluded and filtered out below: a demo that paints a protection ring over a real
military site is a bad idea whatever the licence says, and nothing in the story needs it.

What the app does with them is geometry and nothing more: it asks whether a notional sensor could
see a drone at a given height above the ground on the way in. There is no detection model here.

⚠️ **This script used to be about one place.** Its query window defaulted to the Kieler Förde's
bounding box whichever `--aoi` was passed, the asset ids and names were literals (`edhk`,
`nok-schleusen`, `uksh-helipad`), and it raised `SystemExit` when no aerodrome was found. Run
against a second AOI it therefore wrote *the first AOI's airport* into the second one's assets
file — quietly, and with provenance metadata stating otherwise. That is exactly the failure PLAN §4
exists to prevent, and it survived because there was only ever one AOI to catch it. Everything
below now derives from the AOI config, and an asset class that is absent is **omitted rather than
invented**.

Output goes to public/terrain/<aoi>/assets.json, with provenance in the file.

Usage
  python tools/geodata/resolve_assets.py --aoi kieler-foerde
  python tools/geodata/resolve_assets.py --aoi schlei
"""

from __future__ import annotations

import argparse
import json
import math
import re
import time
from pathlib import Path

from aoi import bbox_tuple, load_aoi
from resolve_places import overpass

#: Notional planning radii per asset class, in metres. 🔴 Demo planning values the user can move on
#: screen. They cite no regulation, and the payload says so in `radiusNote`.
DEFAULT_RADIUS_M = {
    "aerodrome": 3000,
    "lock": 1500,
    "helipad": 1000,
    "bridge": 1000,
}

#: Tag values that mark something as military. Anything matching is dropped before it can reach the
#: payload — see the module docstring.
MILITARY_HINTS = ("bundeswehr", "military", "navy", "luftwaffe", "nato")

#: Two bridge ways closer than this belong to one structure. A road bascule, its footway and the
#: `man_made=bridge` polygon over both sit within a few tens of metres; two genuinely separate
#: crossings on the same inlet are kilometres apart, so there is a wide margin either side.
CLUSTER_RADIUS_M = 300.0

#: German type name per OSM `bridge:movable` value, for captioning an unnamed structure.
#: ⚠️ A swing bridge is a Drehbrücke, not a Klappbrücke. The first version of this labelled every
#: movable bridge "Klappbrücke" and produced "Klappbrücke Mönkeberg" for a swing bridge — a caption
#: that is wrong in a way only a local would notice, which is the worst kind.
BRIDGE_TYPE_DE = {
    "bascule": "Klappbrücke",
    "folding": "Klappbrücke",
    "swing": "Drehbrücke",
    "lift": "Hubbrücke",
    "drawbridge": "Zugbrücke",
    "submersible": "Senkbrücke",
    "transporter": "Schwebefähre",
    "retractable": "Schubbrücke",
}


def metres(a: tuple[float, float], b: tuple[float, float], lat0: float) -> float:
    """Great-circle distance, flat-earth approximation. Fine over a runway or a bridge."""
    dlat = (b[0] - a[0]) * 111_320.0
    dlon = (b[1] - a[1]) * 111_320.0 * math.cos(math.radians(lat0))
    return math.hypot(dlat, dlon)


def bearing_deg(a: tuple[float, float], b: tuple[float, float], lat0: float) -> float:
    dlat = (b[0] - a[0]) * 111_320.0
    dlon = (b[1] - a[1]) * 111_320.0 * math.cos(math.radians(lat0))
    return (math.degrees(math.atan2(dlon, dlat)) + 360.0) % 360.0


def centroid(element: dict) -> tuple[float, float] | None:
    """Centre of a way's geometry, or a node's own position."""
    geometry = element.get("geometry")
    if geometry:
        return (sum(p["lat"] for p in geometry) / len(geometry),
                sum(p["lon"] for p in geometry) / len(geometry))
    if "lat" in element and "lon" in element:
        return (element["lat"], element["lon"])
    return None


def is_military(tags: dict) -> bool:
    if tags.get("military") or tags.get("landuse") == "military":
        return True
    haystack = " ".join(str(tags.get(key, "")) for key in ("operator", "name", "owner")).lower()
    return any(hint in haystack for hint in MILITARY_HINTS)


def slug(text: str) -> str:
    """A stable id from a name. Ids end up in URLs and filenames, so ASCII only."""
    folded = (text.lower()
              .replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss"))
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", folded)).strip("-") or "asset"


def cluster_by_distance(elements: list[dict], radius_m: float,
                        lat0: float) -> list[list[dict]]:
    """Group elements whose centroids are within `radius_m` of an existing group member.

    Single-link clustering, which is the right shape here: a bridge is a chain of ways laid end to
    end, so members are near their neighbours rather than near a common centre.
    """
    groups: list[list[dict]] = []
    centres: list[list[tuple[float, float]]] = []
    for element in elements:
        point = centroid(element)
        if not point:
            continue
        for index, members in enumerate(centres):
            if any(metres(point, other, lat0) <= radius_m for other in members):
                groups[index].append(element)
                members.append(point)
                break
        else:
            groups.append([element])
            centres.append([point])
    return groups


def nearest_place(cfg: dict, lat: float, lon: float) -> str | None:
    """Nearest reviewed place from the AOI config — used only to caption an unnamed object."""
    places = cfg.get("focusPlaces") or []
    if not places:
        return None
    best = min(places, key=lambda p: metres((lat, lon), (p["lat"], p["lon"]), lat))
    return best["name"]


def derived_name(cfg: dict, kind_de: str, lat: float, lon: float) -> str:
    """Caption an object OSM left unnamed, from its type and the nearest reviewed place.

    🔴 The *coordinate* is always measured; only the caption is inferred, and every asset built
    this way carries `nameDerived: true` plus its OSM ids so the inference can be checked. Without
    this the most prominent structure in an AOI gets silently dropped — neither Kappeln bascule way
    carries a name, and only a nearby bus stop does.
    """
    place = nearest_place(cfg, lat, lon)
    if not place:
        return kind_de
    # Do not stutter when the place is already named after the structure ("Schleusen Holtenau").
    return place if kind_de.rstrip("n").lower() in place.lower() else f"{kind_de} {place}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="kieler-foerde")
    parser.add_argument("--bbox", nargs=4, type=float, metavar=("S", "W", "N", "E"),
                        help="override the AOI's own bbox (south west north east)")
    parser.add_argument("--pad-deg", type=float, default=0.0,
                        help="widen the AOI bbox, for assets just outside it that still matter")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    # 🔴 The window comes from the AOI unless explicitly overridden. This one line is the whole bug
    # described in the module docstring.
    s, w, n, e = args.bbox if args.bbox else bbox_tuple(cfg, "core")
    s, w, n, e = s - args.pad_deg, w - args.pad_deg, n + args.pad_deg, e + args.pad_deg
    lat0 = (s + n) / 2
    box = f"{s},{w},{n},{e}"

    # ONE combined query — Overpass is donation-funded and shared.
    query = f"""
    [out:json][timeout:180];
    (
      way["aeroway"="aerodrome"]({box});
      way["aeroway"="runway"]({box});
      way["aeroway"="helipad"]({box});
      way["waterway"="lock_gate"]({box});
      way["bridge:movable"]({box});
      way["bridge"="movable"]({box});
      way["man_made"="bridge"]["bridge:movable"]({box});
    );
    out geom tags;
    """
    print(f"AOI {cfg['id']}: querying Overpass for {box}")
    data = overpass(query)
    elements = data.get("elements", [])
    print(f"  {len(elements)} elements")

    by_kind: dict[str, list[dict]] = {}
    for element in elements:
        tags = element.get("tags", {})
        movable = tags.get("bridge:movable") or (tags.get("bridge") == "movable")
        kind = (tags.get("aeroway") or tags.get("waterway")
                or ("movable_bridge" if movable else "other"))
        by_kind.setdefault(kind, []).append(element)

    assets: list[dict] = []

    # ── aerodromes ──────────────────────────────────────────────────────────
    # ICAO-tagged fields only, so an unnamed airstrip cannot become "the airport".
    for field in by_kind.get("aerodrome", []):
        ftags = field.get("tags", {})
        if not ftags.get("icao") or is_military(ftags):
            continue
        centre = centroid(field)
        if not centre:
            continue

        # The runway arrives as several ways along one centreline, so the ends are the two extreme
        # points of the union rather than the ends of any single way.
        runway_points: list[tuple[float, float]] = []
        runway_ref = None
        for way in by_kind.get("runway", []):
            runway_points += [(p["lat"], p["lon"]) for p in way.get("geometry", [])]
            runway_ref = runway_ref or way.get("tags", {}).get("ref")
        runway = None
        if len(runway_points) >= 2:
            longest, ends = 0.0, (runway_points[0], runway_points[1])
            for i in range(len(runway_points)):
                for j in range(i + 1, len(runway_points)):
                    d = metres(runway_points[i], runway_points[j], lat0)
                    if d > longest:
                        longest, ends = d, (runway_points[i], runway_points[j])
            runway = {
                "ref": runway_ref,
                "lengthM": round(longest),
                "bearingDeg": round(bearing_deg(ends[0], ends[1], lat0), 1),
                "ends": [[round(ends[0][0], 6), round(ends[0][1], 6)],
                         [round(ends[1][0], 6), round(ends[1][1], 6)]],
            }
            print(f"\naerodrome  {ftags.get('name')}  {ftags.get('icao')}")
            print(f"  centre   {centre[0]:.6f},{centre[1]:.6f}")
            print(f"  runway   {runway_ref}  {longest:.0f} m, bearing {runway['bearingDeg']:.0f}°")

        assets.append({
            "id": (ftags.get("icao") or slug(ftags.get("name", "aerodrome"))).lower(),
            "name": ftags.get("name") or f"Flugplatz {ftags.get('icao')}",
            "kind": "aerodrome",
            "osm": f"way/{field['id']}",
            "icao": ftags.get("icao"),
            "iata": ftags.get("iata"),
            "lat": round(centre[0], 6),
            "lon": round(centre[1], 6),
            "protectionRadiusM": DEFAULT_RADIUS_M["aerodrome"],
            **({"runway": runway} if runway else {}),
        })

    # ── locks ───────────────────────────────────────────────────────────────
    # Gates cluster into one installation; the name comes from the gates themselves.
    gates = [g for g in by_kind.get("lock_gate", []) if not is_military(g.get("tags", {}))]
    gate_points = [c for c in (centroid(g) for g in gates) if c]
    if gate_points:
        lock_lat = sum(p[0] for p in gate_points) / len(gate_points)
        lock_lon = sum(p[1] for p in gate_points) / len(gate_points)
        name = next((g["tags"]["name"] for g in gates if g.get("tags", {}).get("name")), None)
        derived = name is None
        if derived:
            name = derived_name(cfg, "Schleuse", lock_lat, lock_lon)
        print(f"\nlocks      {name} — {len(gates)} lock gates"
              f"{', name derived' if derived else ''}")
        print(f"  centre   {lock_lat:.6f},{lock_lon:.6f}")
        assets.append({
            "id": slug(name),
            "name": name,
            "kind": "lock",
            "osm": ",".join(f"way/{g['id']}" for g in gates),
            "lat": round(lock_lat, 6),
            "lon": round(lock_lon, 6),
            "protectionRadiusM": DEFAULT_RADIUS_M["lock"],
            **({"nameDerived": True} if derived else {}),
        })

    # ── movable bridges ─────────────────────────────────────────────────────
    # A lifting or bascule bridge over a navigable channel is exactly what this scenario is about:
    # published, unmistakable, and a genuine single point of failure for the road and the waterway
    # at the same time.
    #
    # 🔴 Two things about OSM make the naive read wrong, and both were caught by looking at the
    # answer rather than trusting it:
    #   * **One bridge is many ways.** Kappeln returns three bascule ways plus two `man_made=bridge`
    #     polygons for a single structure — five protection rings stacked on one spot. They are
    #     clustered by proximity below.
    #   * **The way usually carries no name.** Neither Kappeln bascule way is named; only a bus
    #     stop nearby is. Requiring a name would silently drop the most prominent object in the
    #     AOI, so an unnamed cluster is labelled from the AOI's own nearest resolved place and
    #     flagged `nameDerived` — the coordinate stays measured, only the caption is inferred, and
    #     the OSM ids are in the payload so anyone can check it.
    for cluster in cluster_by_distance(by_kind.get("movable_bridge", []), CLUSTER_RADIUS_M, lat0):
        members = [m for m in cluster if not is_military(m.get("tags", {}))]
        if not members:
            continue
        points = [c for c in (centroid(m) for m in members) if c]
        if not points:
            continue
        lat = sum(p[0] for p in points) / len(points)
        lon = sum(p[1] for p in points) / len(points)
        mechanism = next((m["tags"]["bridge:movable"] for m in members
                          if m.get("tags", {}).get("bridge:movable")), "movable")
        name = next((m["tags"]["name"] for m in members if m.get("tags", {}).get("name")), None)
        derived = name is None
        if derived:
            name = derived_name(cfg, BRIDGE_TYPE_DE.get(mechanism, "Bewegliche Brücke"), lat, lon)
        print(f"\nbridge     {name}  {lat:.6f},{lon:.6f}  ({mechanism}, {len(members)} ways"
              f"{', name derived' if derived else ''})")
        assets.append({
            "id": slug(name),
            "name": name,
            "kind": "bridge",
            "osm": ",".join(f"way/{m['id']}" for m in members),
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "protectionRadiusM": DEFAULT_RADIUS_M["bridge"],
            "note": f"bewegliche Brücke ({mechanism})",
            **({"nameDerived": True} if derived else {}),
        })

    # ── helipads ────────────────────────────────────────────────────────────
    # Named civil pads only; unnamed pads and anything military are dropped.
    for pad in by_kind.get("helipad", []):
        tags = pad.get("tags", {})
        name = tags.get("name") or tags.get("ref")
        centre = centroid(pad)
        if not name or not centre or is_military(tags):
            continue
        print(f"\nhelipad    {name}  {centre[0]:.6f},{centre[1]:.6f}")
        assets.append({
            "id": f"{slug(name)}-helipad",
            "name": f"Hubschrauberlandeplatz {name}",
            "kind": "helipad",
            "osm": f"way/{pad['id']}",
            "lat": round(centre[0], 6),
            "lon": round(centre[1], 6),
            "protectionRadiusM": DEFAULT_RADIUS_M["helipad"],
        })

    # 🔴 An AOI with no protected assets is a legitimate answer, not an error. The counter-UAS
    # scenario simply has nothing to point at there, and the app already handles a missing assets
    # file by saying so. Failing here — as this script used to — is what pushes the next person
    # towards pasting in a coordinate that "looks about right".
    if not assets:
        print("\nno civil protected assets found in this AOI — writing an empty list, which is an "
              "honest answer and leaves the counter-UAS scenario without a target here")

    payload = {
        "aoi": cfg["id"],
        "bbox": {"south": s, "west": w, "north": n, "east": e},
        "queriedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "OpenStreetMap contributors",
        "licence": "ODbL 1.0",
        "attribution": "Schutzobjekte: © OpenStreetMap-Mitwirkende, ODbL",
        "radiusNote": "Schutzradien sind frei gewählte Planungswerte, keine Rechtsvorschrift.",
        "excluded": "Militärische Anlagen sind bewusst nicht enthalten.",
        "assets": assets,
    }

    out = Path("public/terrain") / cfg["id"] / "assets.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n{len(assets)} assets written to {out}")
    review = Path("data/osm") / cfg["id"] / "assets-raw.json"
    review.parent.mkdir(parents=True, exist_ok=True)
    review.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"raw Overpass answer kept for review at {review}")


if __name__ == "__main__":
    main()
