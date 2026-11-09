"""Top-of-mesh height lookup over the baked NRW 3D-Mesh tiles (core + ring), in UTM metres.

Used offline only (bridge decks in generate_operations.py, gates). Near-horizontal triangles only,
binned on a 25 m grid, so a vertical ray at (E, N) finds the surface it would hit — a deck, a roof,
a road — without walls. `top(e, n, lo, hi)` returns the highest such surface inside [lo, hi], so a
caller can ask for "the deck near where I expect it" and not get a pylon top or the river below.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from verify_mesh_registration import read_glb

CELL = 25.0


class MeshSurface:
    def __init__(self, terrain_dir: Path):
        meta = json.loads((terrain_dir / "heightmap.json").read_text(encoding="utf-8"))
        self.w = meta["width"] * meta["resolutionM"]
        self.d = meta["height"] * meta["resolutionM"]
        self.e0 = meta["origin"]["easting"]
        self.n0 = meta["origin"]["northing"]
        files = sorted((terrain_dir / "mesh").glob("*.glb")) + sorted((terrain_dir / "mesh-ring").glob("*.glb"))
        tris = np.concatenate([read_glb(f) for f in files]) if files else np.zeros((0, 3, 3))
        a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
        nrm = np.cross(b - a, c - a)
        ln = np.linalg.norm(nrm, axis=1)
        tris = tris[(ln > 1e-9) & (np.abs(nrm[:, 1]) > 0.7 * ln)]
        self.tris = tris
        self.bins: dict[tuple[int, int], list[int]] = {}
        x0, x1 = tris[:, :, 0].min(1), tris[:, :, 0].max(1)
        z0, z1 = tris[:, :, 2].min(1), tris[:, :, 2].max(1)
        for i in range(len(tris)):
            for gx in range(int(x0[i] // CELL), int(x1[i] // CELL) + 1):
                for gz in range(int(z0[i] // CELL), int(z1[i] // CELL) + 1):
                    self.bins.setdefault((gx, gz), []).append(i)

    def top(self, e: float, n: float, lo: float = -1e9, hi: float = 1e9) -> float | None:
        x = e - self.e0 - self.w / 2
        z = (self.n0 + self.d) - n - self.d / 2
        best = None
        for i in self.bins.get((int(x // CELL), int(z // CELL)), ()):
            (ax, ay, az), (bx, by, bz), (cx, cy, cz) = self.tris[i]
            den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
            if abs(den) < 1e-12:
                continue
            l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den
            l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den
            l3 = 1 - l1 - l2
            if l1 >= 0 and l2 >= 0 and l3 >= 0:
                y = float(l1 * ay + l2 * by + l3 * cy)
                if lo <= y <= hi and (best is None or y > best):
                    best = y
        return best
