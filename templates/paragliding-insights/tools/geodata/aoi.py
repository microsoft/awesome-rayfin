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
from pathlib import Path
from typing import Any, Literal

CONFIG_DIR = Path(__file__).resolve().parents[2] / "config" / "aoi"
WORLD_DIR = Path(__file__).resolve().parents[2] / "config" / "world"

Tier = Literal["core", "shell"]

# Which config key holds each tier's bounding box. The core keeps the plain name `bbox` because it
# is what almost every step wants; only the terrain build ever asks for the shell.
_BBOX_KEY: dict[str, str] = {"core": "bbox", "shell": "shell"}


def load_aoi(aoi_id: str = "oberstdorf") -> dict[str, Any]:
    path = CONFIG_DIR / f"{aoi_id}.json"
    if not path.exists():
        available = ", ".join(sorted(p.stem for p in CONFIG_DIR.glob("*.json"))) or "none"
        raise FileNotFoundError(f"No AOI config '{aoi_id}'. Available: {available}")
    return json.loads(path.read_text(encoding="utf-8"))


def load_world(world_id: str = "allgaeu") -> dict[str, Any]:
    """
    Load a world — one continuous terrain containing several AOIs (PLAN §8).

    A world config is deliberately shaped like an AOI config: it has an `id`, a `shell` bbox,
    `shellGrids` and `shellGeobasis`, so every helper here works on it unchanged. What it does not
    have is a `bbox` — a world has no core of its own, it has `sites` that do.
    """
    path = WORLD_DIR / f"{world_id}.json"
    if not path.exists():
        available = ", ".join(sorted(p.stem for p in WORLD_DIR.glob("*.json"))) or "none"
        raise FileNotFoundError(f"No world config '{world_id}'. Available: {available}")
    return json.loads(path.read_text(encoding="utf-8"))



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
