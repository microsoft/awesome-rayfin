"""Fetch the floor/site plans OTH actually publishes.

PLAN §5.4 said option 1 was "ask OTH for floor plans". It turns out they are on the public
website, which also means the generator's claim that "OTH's real letters are not public" is
false and has to be corrected.

  https://www.oth-regensburg.de/die-oth/standort-und-raumplaene

Downloads what is linked there and reports what each file actually is, so the next decision is
made on the file rather than on its name.
"""

from __future__ import annotations

import urllib.request
from pathlib import Path

OUT = Path(r"C:\Users\alkorn\repos\Campus-Scheduler\data\oth-plans")
UA = {"User-Agent": "Mozilla/5.0 (compatible; campus-scheduler/0.1)"}

FILES = {
    "campus_galgenberg_uebersicht.pdf":
        "https://www.oth-regensburg.de/fileadmin/Bereiche/Gebaeude-Lageplan/Galgenbergstrasse_30/2024_OTH_Campusuebersicht.pdf",
    "pruefeninger_strasse_2d.png":
        "https://www.oth-regensburg.de/fileadmin/Bereiche/Gebaeude-Lageplan/2D_DARSTELLUNGSPLAN_Pruefeninger-Strasse_RZ_01.png",
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, url in FILES.items():
        dest = OUT / name
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r:  # noqa: S310
                blob = r.read()
            dest.write_bytes(blob)
            head = blob[:8]
            kind = (
                "PDF" if head.startswith(b"%PDF") else
                "PNG" if head.startswith(b"\x89PNG") else
                "JPEG" if head.startswith(b"\xff\xd8") else
                f"unknown ({head!r})"
            )
            print(f"  ok   {name:<40} {len(blob) / 1024:8.0f} KB  {kind}")
        except Exception as exc:  # noqa: BLE001
            print(f"  FAIL {name:<40} {exc}")

    print(f"\n-> {OUT}")


if __name__ == "__main__":
    main()
