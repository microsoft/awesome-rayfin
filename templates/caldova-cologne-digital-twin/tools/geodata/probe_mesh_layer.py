"""Phase 1 step 0: read the NRW 3D-Mesh layer definition BEFORE decoding any geometry.

Prints the spatial reference, the height model, the geometry and texture definitions and the node
page layout, and writes them to `cache/mesh/<slpk>.layer.json`. Nothing downstream may assume a
CRS, a vertical datum or a geometry buffer layout that this probe has not printed.

Usage:  python tools/geodata/probe_mesh_layer.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from slpk_remote import CACHE, RemoteSlpk  # noqa: E402

URL = "https://www.opengeodata.nrw.de/produkte/geobasis/lusat/akt/3dmesh/3dmesh/Mesh_KB1450T12_nw_2025.slpk"


def main() -> None:
    slpk = RemoteSlpk(URL)
    print("entries:", len(slpk.entries))
    tops = sorted({n for n in slpk.entries if not n.startswith("nodes/")})
    print("non-node members (first 40):", tops[:40], "… total", len(tops))
    layer_name = next(n for n in ("3dSceneLayer.json.gz", "3dSceneLayer.json") if slpk.has(n))
    layer = slpk.read_json(layer_name)
    keep = {k: layer.get(k) for k in (
        "id", "version", "layerType", "spatialReference", "heightModelInfo", "fullExtent",
        "nodePages", "materialDefinitions", "textureSetDefinitions", "geometryDefinitions",
        "store", "capabilities", "attributeStorageInfo",
    )}
    print(json.dumps(keep, indent=1)[:6000])
    page0 = slpk.read_json("nodepages/0.json.gz")
    nodes = page0.get("nodes", [])
    print("nodepage 0 nodes:", len(nodes))
    print(json.dumps(nodes[:3], indent=1)[:2500])
    meta = slpk.read_json("metadata.json") if slpk.has("metadata.json") else None
    print("metadata.json:", json.dumps(meta)[:800] if meta else None)
    out = CACHE / f"{slpk.name}.layer.json"
    out.write_text(json.dumps({"layer": keep, "metadata": meta, "nodepage0_sample": nodes[:5]}, indent=1), encoding="utf-8")
    print("written", out)


if __name__ == "__main__":
    main()
