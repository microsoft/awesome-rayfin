"""Fetch OTH's published PER-FLOOR room plans and render them for extraction.

These are VECTOR CAD exports. What differs between them is only whether the room labels survived
as text: the six Universitaetsstrasse 31 sheets carry a text layer giving room number, usage and
surveyed area, while the other twenty had their labels converted to glyph outlines - legible on
screen, but `page.get_fonts()` returns nothing, so no parser can read them.

⚠️ THIS DOCSTRING PREVIOUSLY CLAIMED THE PLANS WERE RASTER, on the strength of counting
'/Subtype/Image', '/Font' and path operators in the raw PDF bytes. Content streams are compressed,
so those counts measured nothing at all. Measured properly (2026-08-02, PyMuPDF): Galgenbergstr 32
EG alone holds 16,923 vector drawings and 61,404 line segments, its only images being a 281x53 pt
title block, and vector geometry covers 94.6% of the page.

One page is one ADDRESS on one LEVEL, not one building: Seybothstrasse 2 alone carries Gebaeude
Q, R, S, T, V, W and Y. So a page is a site floor plan and the extraction has to segment
buildings out of it, which is also why the alignment target is the campus footprint set rather
than a single outline.

  python tools/data/fetch_oth_floorplans.py            # fetch + render all
  python tools/data/fetch_oth_floorplans.py --only k   # just Gebaeude K
"""

from __future__ import annotations

import argparse
import urllib.request
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "oth-plans"
RENDER = OUT / "render"
UA = {"User-Agent": "Mozilla/5.0 (compatible; campus-scheduler/0.1)"}
BASE = "https://www.oth-regensburg.de/fileadmin/Bereiche/Gebaeude-Lageplan/"

# level: the storey the page shows, in the twin's numbering (UG = -1, EG = 0, OG1 = 1, ...).
# buildings: which Gebaeude appear on that page, from OTH's own address groupings.
PLANS = [
    # Galgenbergstrasse 32 — Gebaeude K (Informatik und Mathematik) and L (Architektur).
    # ⚠️ THE MOST VALUABLE PAGE IN THE SET: K's ground floor is ALSO surveyed in OpenStreetMap
    # (28 rooms), so an extraction here can be scored against independent geometry.
    ("k_eg",  "Galgenbergstrasse_32/Galgenbergstr_32_K_EG_.pdf",  0, ["K", "L"]),
    ("k_og1", "Galgenbergstrasse_32/Galgenbergstr_32_K_OG1.pdf",  1, ["K", "L"]),
    ("k_og2", "Galgenbergstrasse_32/Galgenbergstr_32_K_OG2.pdf",  2, ["K", "L"]),
    # Seybothstrasse 2 — Q, R, S, T, V, W, Y
    ("seyboth_ug",  "Seybothstrasse_2/Seyboth_UG.pdf",  -1, ["Q", "R", "S", "T", "V", "W", "Y"]),
    ("seyboth_eg",  "Seybothstrasse_2/Seyboth_EG.pdf",   0, ["Q", "R", "S", "T", "V", "W", "Y"]),
    ("seyboth_og1", "Seybothstrasse_2/Seyboth_OG1.pdf",  1, ["Q", "R", "S", "T", "V", "W", "Y"]),
    ("seyboth_og2", "Seybothstrasse_2/Seyboth_OG2.pdf",  2, ["Q", "R", "S", "T", "V", "W", "Y"]),
    ("seyboth_og3", "Seybothstrasse_2/Seyboth_OG3.pdf",  3, ["Q", "R", "S", "T", "V", "W", "Y"]),
    # Galgenbergstrasse 30 — A, B, C, D, E (+ Haus der Technik G, H, I, J as its own set)
    ("galgen30_ug",  "Galgenbergstrasse_30/Galgenbergstrasse_UG.pdf",  -1, ["A", "B", "C", "D", "E"]),
    ("galgen30_eg",  "Galgenbergstrasse_30/Galgenbergstrasse_EG.pdf",   0, ["A", "B", "C", "D", "E"]),
    ("galgen30_og1", "Galgenbergstrasse_30/Galgenbergstrasse_1OG.pdf",  1, ["A", "B", "C", "D", "E"]),
    ("galgen30_og2", "Galgenbergstrasse_30/Galgenbergstrasse_2OG.pdf",  2, ["A", "B", "C", "D", "E"]),
    ("hdt_eg",  "Galgenbergstrasse_30/Haus_der_Technik_EG__1_.pdf",  0, ["G", "H", "I", "J"]),
    ("hdt_og1", "Galgenbergstrasse_30/Haus_der_Technik_OG1__1_.pdf", 1, ["G", "H", "I", "J"]),
    ("hdt_og2", "Galgenbergstrasse_30/Haus_der_Technik_OG2__1_.pdf", 2, ["G", "H", "I", "J"]),
    # Pruefeninger Strasse 58 — Gebaeude P
    ("pruefening_ug",  "Pruefeningerstrasse_58/Pruefening_UG.pdf",  -1, ["P"]),
    ("pruefening_eg",  "Pruefeningerstrasse_58/Pruefening_EG.pdf",   0, ["P"]),
    ("pruefening_og1", "Pruefeningerstrasse_58/Pruefening_OG1.pdf",  1, ["P"]),
    ("pruefening_og2", "Pruefeningerstrasse_58/Pruefening_OG2.pdf",  2, ["P"]),
    # Universitaetsstrasse 31 — the ONLY sheets with a readable text layer, and ⚠️ NOT an OTH
    # building. That address is the Universitaet Regensburg campus: all 29 OSM objects there carry
    # operator=Universitaet Regensburg, and RUWG is the Recht Und Wirtschaft Gebaeude
    # (way/28996029, building:levels=7, matching the seven storeys these sheets imply). It is not
    # present in config/buildings-oth.json, and no OTH building carries ref=U — the "Gebaeude U"
    # label here was invented by me, not taken from OTH. Left in place because these six sheets
    # are the extraction testbed, but they must not be attributed to OTH.
    ("uni31_00", "Universitaetsstrasse_31/RUWG_D_00.pdf", 0, ["U"]),
    ("uni31_02", "Universitaetsstrasse_31/RUWG_D_02.pdf", 1, ["U"]),
    ("uni31_03", "Universitaetsstrasse_31/RUWG_D_03.pdf", 2, ["U"]),
    ("uni31_04", "Universitaetsstrasse_31/RUWG_D_04.pdf", 3, ["U"]),
    ("uni31_05", "Universitaetsstrasse_31/RUWG_D_05.pdf", 4, ["U"]),
    ("uni31_06", "Universitaetsstrasse_31/RUWG_D_06.pdf", 5, ["U"]),
]

# 300 dpi. High enough that a 10 cm wall is ~1.2 px at 1:100 and room numbers stay legible for a
# later OCR pass; low enough that a page stays well under 100 MB in memory.
DPI = 300


def fetch(rel: str, dest: Path) -> bytes:
    if dest.exists():
        return dest.read_bytes()
    req = urllib.request.Request(BASE + rel, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:  # noqa: S310
        blob = r.read()
    dest.write_bytes(blob)
    return blob


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", help="substring of the plan key, e.g. 'k_eg'")
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    RENDER.mkdir(parents=True, exist_ok=True)

    for key, rel, level, buildings in PLANS:
        if args.only and args.only not in key:
            continue
        pdf = OUT / f"{key}.pdf"
        try:
            blob = fetch(rel, pdf)
        except Exception as exc:  # noqa: BLE001
            print(f"  FAILED {key}: {exc}")
            continue

        doc = fitz.open(stream=blob, filetype="pdf")
        page = doc[0]
        pix = page.get_pixmap(dpi=DPI)
        png = RENDER / f"{key}.png"
        pix.save(png)
        # The page box is in points (1/72 in); at 1:100 a metre is 10 mm on paper = 28.35 pt.
        w_mm = page.rect.width / 72 * 25.4
        h_mm = page.rect.height / 72 * 25.4
        print(
            f"  {key:16} level {level:>2}  {', '.join(buildings):<22} "
            f"{len(blob)/1024:6.0f} KB  page {w_mm:.0f}x{h_mm:.0f} mm  "
            f"render {pix.width}x{pix.height}px  chars={len(page.get_text().strip())}"
        )
        doc.close()

    print(f"\nrenders -> {RENDER}")


if __name__ == "__main__":
    main()
