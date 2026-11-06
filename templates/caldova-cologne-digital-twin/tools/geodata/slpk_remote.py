"""Random access into a REMOTE SLPK (I3S Scene Layer Package) over HTTP Range — PLAN Phase 1.

The NRW 3D-Mesh for Köln is one 220.8 GB SLPK (`Mesh_KB1450T12_nw_2025.slpk`). We need perhaps
0.1 % of it. An SLPK is a ZIP64 archive whose members are STORED (the payloads are already gzip or
jpeg), so a member can be read with two range requests: its local header, then its bytes.

⚠️ THE CENTRAL DIRECTORY IS 140 MB AND 1,355,033 ENTRIES. It is fetched ONCE and cached as a
compact JSON index under `cache/` (gitignored). Every later run reads the index, never the remote
directory again — the server is a public authority's, and being polite is what keeps it open.

⚠️ ZIP64 IS NOT OPTIONAL HERE. Offsets past 4 GiB are stored as 0xFFFFFFFF in the 32-bit fields and
the real value lives in the zip64 extra field (header id 0x0001), in the order
uncompressed, compressed, local-header-offset — but ONLY the fields that overflowed are present.
Reading the extra field as a fixed triple silently yields the wrong offset for most entries.
"""
from __future__ import annotations

import gzip
import json
import struct
import time
import urllib.request
from pathlib import Path

USER_AGENT = "caldova-cologne-digital-twin/0.1 (open geodata pipeline; +https://www.opengeodata.nrw.de)"
ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "cache" / "mesh"


def _get(url: str, start: int, end: int, tries: int = 5) -> bytes:
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Range": f"bytes={start}-{end}"})
            with urllib.request.urlopen(req, timeout=180) as r:
                if r.status != 206:
                    raise IOError(f"expected 206, got {r.status}")
                data = r.read()
            if len(data) != end - start + 1:
                raise IOError(f"short read {len(data)} of {end - start + 1}")
            return data
        except Exception:  # noqa: BLE001 - retried, then re-raised
            if attempt == tries - 1:
                raise
            time.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def _size(url: str) -> int:
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        return int(r.headers["Content-Length"])


class RemoteSlpk:
    def __init__(self, url: str):
        self.url = url
        self.name = url.rsplit("/", 1)[-1]
        self.index_path = CACHE / f"{self.name}.index.json"
        self.entries: dict[str, tuple[int, int, int]] = {}  # name -> (local header offset, csize, method)
        self._load_or_build_index()

    # ── index ────────────────────────────────────────────────────────────────────────────────────
    def _load_or_build_index(self) -> None:
        if self.index_path.exists():
            raw = json.loads(self.index_path.read_text(encoding="utf-8"))
            self.entries = {k: tuple(v) for k, v in raw["entries"].items()}
            return
        size = _size(self.url)
        tail = _get(self.url, size - 65536, size - 1)
        i = tail.rfind(b"PK\x06\x06")
        if i < 0:
            raise ValueError("no zip64 end-of-central-directory record")
        n_entries, cd_size, cd_off = struct.unpack_from("<QQQ", tail, i + 32)
        CACHE.mkdir(parents=True, exist_ok=True)
        cd = bytearray()
        chunk = 16 * 1024 * 1024
        for a in range(cd_off, cd_off + cd_size, chunk):
            b = min(a + chunk, cd_off + cd_size) - 1
            cd += _get(self.url, a, b)
        p = 0
        while p + 46 <= len(cd) and cd[p:p + 4] == b"PK\x01\x02":
            method = struct.unpack_from("<H", cd, p + 10)[0]
            csize, usize = struct.unpack_from("<II", cd, p + 20)
            n, e, c = struct.unpack_from("<HHH", cd, p + 28)
            off = struct.unpack_from("<I", cd, p + 42)[0]
            name = cd[p + 46:p + 46 + n].decode("utf-8")
            extra = cd[p + 46 + n:p + 46 + n + e]
            if 0xFFFFFFFF in (csize, usize, off):
                q = 0
                while q + 4 <= len(extra):
                    hid, hlen = struct.unpack_from("<HH", extra, q)
                    if hid == 0x0001:
                        r = q + 4
                        if usize == 0xFFFFFFFF:
                            usize = struct.unpack_from("<Q", extra, r)[0]; r += 8
                        if csize == 0xFFFFFFFF:
                            csize = struct.unpack_from("<Q", extra, r)[0]; r += 8
                        if off == 0xFFFFFFFF:
                            off = struct.unpack_from("<Q", extra, r)[0]; r += 8
                        break
                    q += 4 + hlen
            self.entries[name] = (off, csize, method)
            p += 46 + n + e + c
        if len(self.entries) != n_entries:
            raise ValueError(f"parsed {len(self.entries)} of {n_entries} directory entries")
        self.index_path.write_text(json.dumps({"url": self.url, "entries": self.entries}), encoding="utf-8")

    # ── members ──────────────────────────────────────────────────────────────────────────────────
    def read(self, name: str) -> bytes:
        """The member's stored bytes (still gzip/jpeg as packaged)."""
        if name.startswith(("/", "\\")) or ".." in Path(name).parts:
            raise ValueError(f"unsafe member name {name!r}")
        cached = CACHE / self.name / name
        if cached.exists():
            return cached.read_bytes()
        off, csize, method = self.entries[name]
        if method != 0:
            raise ValueError(f"{name}: compression method {method}, expected STORED")
        head = _get(self.url, off, off + 29)
        if head[:4] != b"PK\x03\x04":
            raise ValueError(f"{name}: bad local header at {off}")
        n, e = struct.unpack_from("<HH", head, 26)
        start = off + 30 + n + e
        data = _get(self.url, start, start + csize - 1) if csize else b""
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(data)
        return data

    def read_json(self, name: str) -> dict:
        data = self.read(name)
        if name.endswith(".gz"):
            data = gzip.decompress(data)
        return json.loads(data.decode("utf-8"))

    def has(self, name: str) -> bool:
        return name in self.entries
