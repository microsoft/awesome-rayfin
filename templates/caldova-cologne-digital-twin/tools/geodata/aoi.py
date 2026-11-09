"""Load the area-of-interest configuration.

PLAN §14 Q2: Gleitschirm-Insights is a reusable vertical asset. No coordinate, place name or site
id belongs in a source file — it all comes from config/aoi/<id>.json. Oberstdorf/Nebelhorn is the
first instance of this app, not the app itself.

The AOI has two tiers (PLAN §4.1), and every helper here takes the tier as an argument rather than
assuming one:

  core   the photoreal box — LDBV DGM1, buildings, trees, land cover
  shell  the coarse horizon — Copernicus DEM, terrain only, crosses into Austria
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Literal

import utm

CONFIG_DIR = Path(__file__).resolve().parents[2] / "config" / "aoi"

Tier = Literal["core", "shell"]

# Which config key holds each tier's bounding box. The core keeps the plain name `bbox` because it
# is what almost every step wants; only the terrain build ever asks for the shell.
_BBOX_KEY: dict[str, str] = {"core": "bbox", "shell": "shell"}


def load_aoi(aoi_id: str = "koeln-messe") -> dict[str, Any]:
    path = CONFIG_DIR / f"{aoi_id}.json"
    if not path.exists():
        available = ", ".join(sorted(p.stem for p in CONFIG_DIR.glob("*.json"))) or "none"
        raise FileNotFoundError(f"No AOI config '{aoi_id}'. Available: {available}")
    cfg: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    _bind_utm_zone(cfg)
    return cfg


def _bind_utm_zone(cfg: dict[str, Any]) -> None:
    """Point the UTM helpers at this AOI's working CRS.

    ⚠️ THIS IS DELIBERATELY A SIDE EFFECT OF LOADING THE CONFIG, and the reason is that it is the
    only way to make it impossible to forget. Every pipeline step obtains its AOI through
    `load_aoi`, so binding here means no step can project a coordinate before the zone is known.
    The alternative — threading a `zone` argument through twenty scripts — has the property that
    the ONE call site somebody misses keeps working and returns coordinates that are wrong by
    metres, silently. See the module docstring in `utm.py`.

    Zone 32 covered every site up to TU Berlin, which is EPSG:25833.
    """
    crs = cfg.get("workingCrs")
    if not crs:
        raise KeyError(
            f"AOI '{cfg.get('id')}' has no 'workingCrs' — it decides which UTM zone every "
            "coordinate in this build is projected into, so there is no safe default."
        )
    zone = utm.crs_to_zone(str(crs))
    _check_zone_is_usable(cfg, zone, str(crs))
    utm.set_active_zone(zone)


def _check_zone_is_usable(cfg: dict[str, Any], zone: int, crs: str) -> None:
    """Reject a `workingCrs` that the AOI's own geometry cannot tolerate.

    ⚠️ NOT AN EQUALITY TEST AGAINST `zone_for_lon`. That was the first version and it is wrong:
    Bavaria publishes the whole state in zone 32 although it runs to 13.8°E, so OTH Regensburg at
    12.10°E is nominally zone 33 and correctly configured as EPSG:25832. An equality check rejects
    a site that has been building correctly for months.

    What is actually worth checking is the thing that breaks: whether projecting THIS box into
    THIS zone distorts lengths by more than the registration gate downstream is willing to accept.
    A Berlin box left on EPSG:25832 after a copy-paste fails here, on the first line of the first
    step, instead of producing a build that is quietly a few metres out everywhere.
    """
    box = cfg.get("bbox") or {}
    if not {"west", "east", "south", "north"} <= box.keys():
        return

    centre_lat = (float(box["south"]) + float(box["north"])) / 2
    # The worst corner, not the centre: the error grows away from the central meridian, so a box
    # whose centre is comfortable can still have an edge that is not.
    worst = max(
        abs(utm.scale_error_m_per_km(float(box[side]), centre_lat, zone)) for side in ("west", "east")
    )

    # Span the distortion acts over. Campus separation dominates where there is one — that is the
    # longest measured distance the build has to get right, and at a multi-campus site it is the
    # number the whole shuttle story rests on.
    span_km = max(
        _bbox_diagonal_km(box),
        float(((cfg.get("campusSeparation") or {}).get("straightLineKm")) or 0.0),
    )
    tolerance_m = float((cfg.get("verification") or {}).get("toleranceM") or 3.0)
    error_m = worst * span_km

    if error_m > tolerance_m:
        nominal = utm.zone_for_lon((float(box["west"]) + float(box["east"])) / 2)
        raise ValueError(
            f"AOI '{cfg.get('id')}' declares {crs} (UTM zone {zone}), but projecting its own "
            f"{span_km:.1f} km extent into that zone distorts lengths by {error_m:.1f} m "
            f"({worst:.2f} m/km), over the {tolerance_m:.1f} m tolerance in its verification "
            f"block. Zone {nominal} (EPSG:{25800 + nominal}) is the nominal zone here."
        )


def _bbox_diagonal_km(box: dict[str, Any]) -> float:
    """Rough great-circle diagonal of a small geographic box, in kilometres."""
    centre_lat = math.radians((float(box["south"]) + float(box["north"])) / 2)
    dx = math.radians(float(box["east"]) - float(box["west"])) * 6371.0 * math.cos(centre_lat)
    dy = math.radians(float(box["north"]) - float(box["south"])) * 6371.0
    return math.hypot(dx, dy)


def bbox(cfg: dict[str, Any], tier: Tier = "core") -> dict[str, float]:
    """Return the raw bbox mapping for a tier."""
    key = _BBOX_KEY[tier]
    if key not in cfg:
        raise KeyError(f"AOI '{cfg.get('id')}' has no '{key}' bbox — required for tier '{tier}'")
    return cfg[key]


def bbox_tuple(cfg: dict[str, Any], tier: Tier = "core") -> tuple[float, float, float, float]:
    """Return (south, west, north, east) — the order Overpass expects."""
    b = bbox(cfg, tier)
    return (b["south"], b["west"], b["north"], b["east"])


def bbox_wsen(cfg: dict[str, Any], tier: Tier = "core") -> tuple[float, float, float, float]:
    """Return (west, south, east, north) — the order the UTM helpers expect."""
    b = bbox(cfg, tier)
    return (b["west"], b["south"], b["east"], b["north"])


def grids(cfg: dict[str, Any], tier: Tier = "core") -> dict[str, Any]:
    """Return the grid settings for a tier."""
    return cfg["grids"] if tier == "core" else cfg["shellGrids"]


def terrain_dir(cfg: dict[str, Any]) -> Path:
    """Where generated browser assets for this AOI are written."""
    return Path(__file__).resolve().parents[2] / "public" / "terrain" / cfg["id"]


def cache_dir(*parts: str) -> Path:
    """Where downloaded source tiles are cached. Gitignored, and safe to delete."""
    path = Path(__file__).resolve().parents[2] / "data" / Path(*parts)
    path.mkdir(parents=True, exist_ok=True)
    return path
