"""Bake the fetched NRW 3D-Mesh nodes into static GLB tiles in the scene's own frame — PLAN Phase 1.

Input:  cache/mesh/selection/<aoi>.nodes.json + the cached node members (fetch_nrw_mesh.py).
Output: public/terrain/<aoi>/mesh/<node>.glb + mesh.json (manifest the app reads).

Frame (src/geo/world.ts): metres, AOI core centred on the origin, +x east, +z SOUTH, y = absolute
height. The layer is EPSG:25832 + DHHN2016 (vcsWkid 7837), the same as DGM1, so y needs no shift.

Measured buffer layout (geometry 0, I3S 1.7 legacy, 2026-10-17): 8-byte header (vertexCount,
featureCount), then position f32x3 for every vertex, then uv0 f32x2. Positions are OFFSETS from the
node's OBB centre. Topology is a plain triangle list (PerAttributeArray), so no index buffer.

⚠️ TRIANGLES ARE CLIPPED TO THE CORE BOX. Selected nodes overhang the box by up to a node's width;
outside the box the coarse shell terrain takes over, and an overhanging mesh would z-fight it.
⚠️ TEXTURES ARE DOWNSAMPLED to the node's target texel (fetch_nrw_mesh.SPOTS): this is where the
texture budget is actually enforced. The selection only decides geometry detail.
"""
from __future__ import annotations

import argparse
import gzip
import io
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_nrw_mesh import URL, core_box_utm, load_aoi, node_texel  # noqa: E402
from slpk_remote import CACHE, ROOT  # noqa: E402

JPEG_QUALITY = 85
CLIP_MARGIN_M = 5.0
RING_TEXEL_NOTE = "4.9 m (measured LoD level, fetch_nrw_mesh.RING_TEXEL)"


def world_extent(aoi: dict) -> dict:
    """The SCENE's frame, which is the terrain grid's, not the bbox's.

    ⚠️ scene.ts centres the world on the generated heightmap (origin + width x resolution), and the
    pipeline snaps that origin to whole metres. Centring on the bbox instead put the mesh ~0.3 m off
    the terrain, buildings and every place marker — small, but it is exactly the drift the
    registration gate exists to refuse. So read the heightmap's own extent.
    """
    meta = json.loads((ROOT / "public" / "terrain" / aoi["id"] / "heightmap.json").read_text(encoding="utf-8"))
    w = meta["width"] * meta["resolutionM"]
    d = meta["height"] * meta["resolutionM"]
    return {"minEasting": meta["origin"]["easting"], "maxNorthing": meta["origin"]["northing"] + d, "widthM": w, "depthM": d}


def read_node(slpk_dir: Path, node: dict) -> tuple[np.ndarray, np.ndarray, Image.Image]:
    raw = gzip.decompress((slpk_dir / f"nodes/{node['mesh']['geometry']['resource']}/geometries/0.bin.gz").read_bytes())
    n, _features = struct.unpack_from("<II", raw, 0)
    if n != node["mesh"]["geometry"]["vertexCount"]:
        raise ValueError(f"node {node['index']}: header says {n} vertices, node page says {node['mesh']['geometry']['vertexCount']}")
    if n % 3:
        raise ValueError(f"node {node['index']}: {n} vertices is not a triangle list")
    pos = np.frombuffer(raw, dtype="<f4", count=n * 3, offset=8).reshape(-1, 3).astype(np.float64)
    uv = np.frombuffer(raw, dtype="<f4", count=n * 2, offset=8 + n * 12).reshape(-1, 2).copy()
    img = Image.open(io.BytesIO((slpk_dir / f"nodes/{node['mesh']['material']['resource']}/textures/0.jpg").read_bytes()))
    img.load()
    return pos, uv, img.convert("RGB")


def to_world(pos_rel: np.ndarray, centre: list[float], ext: dict) -> np.ndarray:
    e = pos_rel[:, 0] + centre[0]
    nn = pos_rel[:, 1] + centre[1]
    h = pos_rel[:, 2] + centre[2]
    x = e - ext["minEasting"] - ext["widthM"] / 2
    z = ext["maxNorthing"] - nn - ext["depthM"] / 2
    return np.stack([x, h, z], axis=1).astype(np.float32)


def clip(world: np.ndarray, uv: np.ndarray, ext: dict, ring: dict | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Core tier: keep the core box (+margin). Ring tier: keep the ring box but NOT the core box,
    so the two tiers overlap only in the core's 5 m margin."""
    tri = world.reshape(-1, 3, 3)
    cx, cz = tri[:, :, 0].mean(1), tri[:, :, 2].mean(1)
    if ring is not None:
        in_ring = (cx >= ring["x0"]) & (cx <= ring["x1"]) & (cz >= ring["z0"]) & (cz <= ring["z1"])
        # ⚠️ 5 m INSIDE the core edge, mirroring the core's 5 m margin outside it. Dropping every ring
        # triangle whose centroid was inside the core left a seam where neither tier had geometry; a
        # bridge-deck ray at the Zoobrücke ramp fell through it onto the road 11 m below (2026-10-17).
        in_core = (np.abs(cx) <= ext["widthM"] / 2 - CLIP_MARGIN_M) & (np.abs(cz) <= ext["depthM"] / 2 - CLIP_MARGIN_M)
        keep = in_ring & ~in_core
        return tri[keep].reshape(-1, 3), uv.reshape(-1, 3, 2)[keep].reshape(-1, 2)
    # A 5 m margin: dropping every triangle whose centroid is outside left a sky sliver one triangle
    # wide at the edge, because the shell has a hole exactly at the core.
    keep = (np.abs(cx) <= ext["widthM"] / 2 + CLIP_MARGIN_M) & (np.abs(cz) <= ext["depthM"] / 2 + CLIP_MARGIN_M)
    return tri[keep].reshape(-1, 3), uv.reshape(-1, 3, 2)[keep].reshape(-1, 2)


def resize(img: Image.Image, native: float, target: float) -> Image.Image:
    if native >= target:
        return img
    f = native / target
    w, h = max(16, int(round(img.width * f))), max(16, int(round(img.height * f)))
    return img.resize((w, h), Image.LANCZOS)


def index_vertices(pos: np.ndarray, uv: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Collapse the triangle list's repeated vertices. Exact (pos, uv) matches only — a seam where
    the uv differs must stay split, or the texture tears along it."""
    key = np.ascontiguousarray(np.concatenate([pos, uv.astype(np.float32)], axis=1)).view(
        np.dtype((np.void, 5 * 4))).ravel()
    _, first, inverse = np.unique(key, return_index=True, return_inverse=True)
    return pos[first], uv[first], inverse.astype(np.uint32)


def write_glb(path: Path, pos: np.ndarray, uv: np.ndarray, jpeg: bytes) -> int:
    """glTF 2.0 binary with KHR_mesh_quantization: int16 positions under a node transform,
    normalised uint16 uvs, an index buffer and one JPEG texture. Returns the vertex count."""
    def pad(b: bytes, fill: bytes = b"\x00") -> bytes:
        return b + fill * ((4 - len(b) % 4) % 4)

    pos, uv, idx = index_vertices(pos, uv)
    lo, hi = pos.min(0).astype(np.float64), pos.max(0).astype(np.float64)
    scale = np.maximum(hi - lo, 1e-3) / 65534.0
    centre = (lo + hi) / 2
    q = np.round((pos - centre) / scale).clip(-32767, 32767).astype("<i2")
    q4 = np.zeros((len(q), 4), dtype="<i2")  # int16 VEC3 must be padded to 4-byte stride
    q4[:, :3] = q
    # ⚠️ uv0 runs slightly outside [0, 1] (measured -0.0015 .. 1.0032); a normalised uint16 cannot hold
    # that, so it is clamped — at 1024 px that is under two texels at the very edge of a node.
    quv = np.round(np.clip(uv, 0.0, 1.0) * 65535).astype("<u2")
    index_type, index_dtype = (5123, "<u2") if len(pos) < 65536 else (5125, "<u4")

    views, blob = [], b""
    for data, stride in ((q4.tobytes(), 8), (quv.tobytes(), None), (idx.astype(index_dtype).tobytes(), None), (jpeg, None)):
        view = {"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)}
        if stride:
            view["byteStride"] = stride
        views.append(view)
        blob = pad(blob + data)
    gltf = {
        "asset": {"version": "2.0", "generator": "caldova-cologne-digital-twin bake_nrw_mesh.py"},
        "extensionsUsed": ["KHR_mesh_quantization"], "extensionsRequired": ["KHR_mesh_quantization"],
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "translation": centre.tolist(), "scale": scale.tolist()}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "TEXCOORD_0": 1}, "indices": 2, "material": 0, "mode": 4}]}],
        "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0.0, "roughnessFactor": 1.0}, "doubleSided": True}],
        "textures": [{"source": 0, "sampler": 0}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
        "images": [{"bufferView": 3, "mimeType": "image/jpeg"}],
        "accessors": [
            {"bufferView": 0, "componentType": 5122, "count": len(q), "type": "VEC3",
             "min": q.min(0).astype(int).tolist(), "max": q.max(0).astype(int).tolist()},
            {"bufferView": 1, "componentType": 5123, "normalized": True, "count": len(quv), "type": "VEC2"},
            {"bufferView": 2, "componentType": index_type, "count": len(idx), "type": "SCALAR"},
        ],
        "bufferViews": views,
        "buffers": [{"byteLength": len(blob)}],
    }
    js = pad(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    total = 12 + 8 + len(js) + 8 + len(blob)
    with path.open("wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(blob), 0x004E4942) + blob)
    return len(pos)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", default="koeln-messe")
    ap.add_argument("--tier", choices=["core", "ring"], default="core")
    args = ap.parse_args()

    aoi = load_aoi(args.aoi)
    ext = world_extent(aoi)
    suffix = "" if args.tier == "core" else ".ring"
    nodes = json.loads((CACHE / "selection" / f"{args.aoi}{suffix}.nodes.json").read_text(encoding="utf-8"))
    slpk_dir = CACHE / URL.rsplit("/", 1)[-1]
    ring = None
    if args.tier == "ring":
        from fetch_nrw_mesh import shell_box_utm  # noqa: PLC0415
        e0, n0, e1, n1 = shell_box_utm(aoi)
        cx0 = ext["minEasting"] + ext["widthM"] / 2
        cz0 = ext["maxNorthing"] - ext["depthM"] / 2
        ring = {"x0": e0 - cx0, "x1": e1 - cx0, "z0": cz0 - n1, "z1": cz0 - n0}
    out = ROOT / "public" / "terrain" / args.aoi / ("mesh" if args.tier == "core" else "mesh-ring")
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.glb"):
        old.unlink()

    tiles, texels, verts, nbytes = [], 0, 0, 0
    ymin, ymax = math.inf, -math.inf
    for node in nodes:
        pos_rel, uv, img = read_node(slpk_dir, node)
        world = to_world(pos_rel, node["obb"]["center"], ext)
        world, uv = clip(world, uv, ext, ring)
        if len(world) == 0:
            continue
        native = node_texel(node)
        img = resize(img, native, node["_targetTexel"])
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=JPEG_QUALITY, optimize=True)
        name = f"n{node['index']}.glb"
        unique = write_glb(out / name, world, uv, buf.getvalue())
        size = (out / name).stat().st_size
        tiles.append({
            "file": name, "node": node["index"], "vertices": int(unique), "triangles": int(len(world) // 3),
            "texture": [img.width, img.height], "texelM": round(max(native, node["_targetTexel"]), 3),
            "min": world.min(0).round(2).tolist(), "max": world.max(0).round(2).tolist(), "bytes": size,
        })
        texels += img.width * img.height
        verts += unique
        nbytes += size
        ymin, ymax = min(ymin, float(world[:, 1].min())), max(ymax, float(world[:, 1].max()))

    summary = {"tiles": tiles, "totals": {"tiles": len(tiles), "vertices": int(verts), "texels": int(texels), "bytes": int(nbytes),
                                          "heightMinM": round(ymin, 2), "heightMaxM": round(ymax, 2)}}
    mpath = out.parent / "mesh.json"
    if args.tier == "ring":
        manifest = json.loads(mpath.read_text(encoding="utf-8"))
        manifest["ring"] = {**summary, "dir": "mesh-ring", "box": ring, "texelM": RING_TEXEL_NOTE,
                            "clippedAgainstCore": {"minEasting": ext["minEasting"], "maxNorthing": ext["maxNorthing"],
                                                   "widthM": ext["widthM"], "depthM": ext["depthM"]}}
        mpath.write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"baked ring {len(tiles)} tiles, {verts:,} vertices, {texels / 1e6:.1f} Mtexel, {nbytes / 1e6:.1f} MB")
        return
    previous_ring = json.loads(mpath.read_text(encoding="utf-8")).get("ring") if mpath.exists() else None
    manifest = {
        "aoi": args.aoi,
        "source": "3D-Mesh NRW, Geobasis NRW (Bezirksregierung Köln), Bildflug 2025-05-11, Mesh_KB1450T12_nw_2025",
        "sourceUrl": URL,
        "crs": "EPSG:25832", "verticalDatum": "DHHN2016 (vcsWkid 7837)",
        "frame": "scene metres, core centred, +x east, +z south, y absolute height",
        "attribution": "Datenquelle: Land NRW (Geobasis NRW) — 3D-Mesh",
        "tiles": tiles,
        "totals": {"tiles": len(tiles), "vertices": int(verts), "texels": int(texels), "bytes": int(nbytes),
                   "heightMinM": round(ymin, 2), "heightMaxM": round(ymax, 2)},
    }
    if previous_ring:
        was = previous_ring.get("clippedAgainstCore")
        now = {"minEasting": ext["minEasting"], "maxNorthing": ext["maxNorthing"], "widthM": ext["widthM"], "depthM": ext["depthM"]}
        if was != now:
            print("  ⚠️ the ring was clipped against a different core rectangle — re-bake it: --tier ring")
        manifest["ring"] = previous_ring
    mpath.write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"baked {len(tiles)} tiles, {verts:,} vertices, {texels / 1e6:.1f} Mtexel, {nbytes / 1e6:.1f} MB, "
          f"heights {ymin:.1f}..{ymax:.1f} m")


if __name__ == "__main__":
    main()
