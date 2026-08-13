"""Build the cableway layer from OpenStreetMap — PLAN §5.7, decision 25.

The Nebelhornbahn runs right through the AOI and is how every pilot actually reaches the launch.
Drawing it does real work: it explains how somebody gets to 1930 m without flying, it gives the eye
a vertical line to read 1400 m of relief against, and it makes the scene recognisable to anyone who
has been there.

⚠️ **The cable height is modelled, not surveyed, and the app says so.** OpenStreetMap gives the
line's ground track and its stations' elevations; it does not say how high the rope hangs. The
model here is deliberately simple and stated rather than dressed up:

  * the cable is interpolated between station elevations along the run, which is what a taut rope
    between two fixed points approximately does;
  * it is then lifted wherever that would put it underground, to a fixed clearance above the
    terrain, because a cable car that disappears into a ridge is obviously wrong.

Pylon positions are taken from OSM where they are mapped. They are not invented where they are not.

Output (public/terrain/<aoi>/):
  cableway.json   lines and stations in world metres, ready to draw

Usage
  python tools/geodata/build_cableway.py
"""

from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

from aoi import bbox_tuple, cache_dir, load_aoi, terrain_dir
from utm import wgs84_to_utm32

OVERPASS = "https://overpass-api.de/api/interpreter"
USER_AGENT = "Gleitschirm-Insights/0.1 (open geodata pipeline)"

#: Metres the cable is lifted above the ground where interpolation would bury it. A real gondola
#: span clears the terrain by a good margin; this is a plausible minimum, not a measurement.
MIN_CLEARANCE_M = 25.0

#: Nominal height of a pylon above the ground it stands on, for the towers OSM does map.
PYLON_HEIGHT_M = 22.0


class Terrain:
    """The generated heightmap, with just enough sampling to place things on the ground."""

    def __init__(self, aoi_id: str) -> None:
        directory = terrain_dir({"id": aoi_id})
        meta_path = directory / "heightmap_4m.json"
        if not meta_path.exists():
            raise SystemExit(f"{meta_path} not found — run tools/geodata/build_terrain.py first")
        self.meta = json.loads(meta_path.read_text(encoding="utf-8"))
        raw = (directory / self.meta["file"]).read_bytes()

        self.width = int(self.meta["width"])
        self.height = int(self.meta["height"])
        self.resolution = float(self.meta["resolutionM"])
        self.origin_e = float(self.meta["origin"]["easting"])
        self.origin_n = float(self.meta["origin"]["northing"])
        self.top_n = self.origin_n + self.height * self.resolution
        self.width_m = self.width * self.resolution
        self.depth_m = self.height * self.resolution

        quantised = np.frombuffer(raw, dtype="<u2").reshape(self.height, self.width)
        self.grid = (
            quantised.astype(np.float32) * float(self.meta["heightScale"])
            + float(self.meta["heightMinM"])
        )

    def sample(self, easting: float, northing: float) -> float:
        col = int(np.clip((easting - self.origin_e) / self.resolution, 0, self.width - 1))
        row = int(np.clip((self.top_n - northing) / self.resolution, 0, self.height - 1))
        return float(self.grid[row, col])

    def to_world(self, easting: float, northing: float) -> tuple[float, float]:
        """World metres: x east of the terrain centre, z south of it."""
        return (
            easting - self.origin_e - self.width_m / 2,
            (self.top_n - northing) - self.depth_m / 2,
        )

    def contains(self, easting: float, northing: float) -> bool:
        return (
            self.origin_e <= easting <= self.origin_e + self.width_m
            and self.origin_n <= northing <= self.top_n
        )


def overpass(query: str) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode()
    request = urllib.request.Request(OVERPASS, data=body, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=240) as response:
        return json.loads(response.read())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oberstdorf")
    parser.add_argument("--force", action="store_true", help="re-query Overpass")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    terrain = Terrain(cfg["id"])
    south, west, north, east = bbox_tuple(cfg, "core")
    box = f"{south},{west},{north},{east}"

    cache = cache_dir("osm", cfg["id"]) / "cableway.json"
    if cache.exists() and not args.force:
        print(f"using cached Overpass response: {cache}")
        data = json.loads(cache.read_text(encoding="utf-8"))
    else:
        print(f"querying Overpass for aerialways in {box}")
        # `out geom` rather than `out center`: the line's shape is the whole point, and a centroid
        # would place a 4 km cable car at a single dot halfway up the mountain.
        data = overpass(
            f"""[out:json][timeout:180];
            (
              way["aerialway"~"^(cable_car|gondola|chair_lift|mixed_lift)$"]({box});
              node["aerialway"="station"]({box});
              node["aerialway"="pylon"]({box});
            );
            out geom;"""
        )
        cache.write_text(json.dumps(data), encoding="utf-8")
        print(f"cached {len(data['elements'])} elements")

    configured = {c["id"]: c for c in cfg.get("cableways", [])}
    wanted_names = {c["name"] for c in configured.values()}

    lines: list[dict] = []
    stations: list[dict] = []

    for element in data["elements"]:
        tags = element.get("tags", {})
        name = tags.get("name", "")

        if element["type"] == "way" and "geometry" in element:
            # Only the cableways the AOI config names. Oberstdorf has a dozen drag lifts and
            # chairlifts in the ski area; drawing all of them would clutter the mountain with
            # infrastructure nobody flies from.
            if wanted_names and not any(w in name for w in wanted_names):
                continue

            points: list[list[float]] = []
            for node in element["geometry"]:
                easting, northing = wgs84_to_utm32(node["lon"], node["lat"])
                if not terrain.contains(easting, northing):
                    continue
                x, z = terrain.to_world(easting, northing)
                points.append([round(x, 1), round(terrain.sample(easting, northing), 2), round(z, 1)])

            if len(points) < 2:
                continue

            # Interpolate a taut rope between the ends, then lift it clear of the ground.
            #
            # Cumulative ground distance is used rather than vertex index: OSM digitises curves with
            # closely spaced nodes and straight runs with far-apart ones, so interpolating by index
            # would bend the cable towards wherever the mapper happened to click.
            distances = [0.0]
            for a, b in zip(points, points[1:]):
                distances.append(distances[-1] + ((b[0] - a[0]) ** 2 + (b[2] - a[2]) ** 2) ** 0.5)
            total = distances[-1] or 1.0

            start_y = points[0][1] + PYLON_HEIGHT_M
            end_y = points[-1][1] + PYLON_HEIGHT_M
            for point, distance in zip(points, distances):
                straight = start_y + (end_y - start_y) * (distance / total)
                point[1] = round(max(straight, point[1] + MIN_CLEARANCE_M), 2)

            lines.append(
                {
                    "id": f"{element['type']}/{element['id']}",
                    "name": name or "(unnamed)",
                    "kind": tags.get("aerialway", "cable_car"),
                    "lengthM": round(total, 1),
                    "points": points,
                }
            )

        elif element["type"] == "node" and tags.get("aerialway") in ("station", "pylon"):
            easting, northing = wgs84_to_utm32(element["lon"], element["lat"])
            if not terrain.contains(easting, northing):
                continue
            if tags.get("aerialway") == "station" and wanted_names and not name:
                continue
            x, z = terrain.to_world(easting, northing)
            ground = terrain.sample(easting, northing)
            published = tags.get("ele")
            stations.append(
                {
                    "id": f"node/{element['id']}",
                    "name": name or "",
                    "kind": tags["aerialway"],
                    "x": round(x, 1),
                    "groundM": round(ground, 2),
                    "z": round(z, 1),
                    "publishedEleM": float(published) if published else None,
                }
            )

    if not lines:
        raise SystemExit(
            "no cableway matched the AOI config — check the `cableways` names against OSM"
        )

    named_stations = [s for s in stations if s["kind"] == "station" and s["name"]]
    print(f"\n{len(lines)} lines, {len(named_stations)} named stations, "
          f"{sum(1 for s in stations if s['kind'] == 'pylon')} pylons")
    for line in lines:
        print(f"  {line['name']:<32} {line['lengthM'] / 1000:.2f} km, {len(line['points'])} vertices")
    for station in named_stations:
        published = station["publishedEleM"]
        delta = f"  (published {published:.0f} m, Δ {station['groundM'] - published:+.1f} m)" if published else ""
        print(f"  {station['name']:<32} ground {station['groundM']:.0f} m{delta}")

    out_dir = terrain_dir(cfg)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "cableway.json"
    path.write_text(
        json.dumps(
            {
                "aoi": cfg["id"],
                "lines": lines,
                "stations": stations,
                "pylonHeightM": PYLON_HEIGHT_M,
                "minClearanceM": MIN_CLEARANCE_M,
                "source": "OpenStreetMap",
                "licence": "ODbL",
                "attribution": "© OpenStreetMap contributors (ODbL)",
                "heightNote": (
                    "The ground track and the station positions are from OpenStreetMap. The height "
                    "of the cable itself is NOT surveyed: it is interpolated between the stations "
                    f"and lifted to at least {MIN_CLEARANCE_M:.0f} m above the terrain. It is a "
                    "schematic of where the cableway runs, not a measurement of where the rope is."
                ),
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(f"\nwrote {path} ({path.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
