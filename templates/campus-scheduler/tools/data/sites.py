"""Which files belong to which university.

Campus-Scheduler started as a single-customer tool for OTH Regensburg, and the phase-0 data
scripts each opened `config/aoi/oth-regensburg.json` and `config/buildings-oth.json` by name. That
is the trap `src/config/aoi.ts` warns about in its module note — "components had simply imported
the one JSON file by name" — and it was live on the Python side too. This registry closes it: a
second university is an ENTRY here, not a copied script.

⚠️ OTH keeps its original, unprefixed paths on purpose. Renaming `data/synthetic/` to
`data/synthetic/oth/` would be tidier and would also rewrite files that the running backend and a
parallel piece of work both read. Tidiness is not worth a moving target, so the legacy layout is
recorded rather than corrected, and only new sites get the systematic naming.

Usage
    from sites import SITES, load_site
    site = load_site("lmu")
    aoi = site.aoi()
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "config"


@dataclass(frozen=True)
class Site:
    """Everything that is site-specific about the data pipeline, in one place."""

    id: str
    aoi_id: str
    label: str
    theme: str
    buildings: Path
    """Real buildings fetched from OSM — written by fetch_buildings.py."""
    letters: Path
    """Published building designations, if the university publishes any. May not exist."""
    osm_rooms: Path
    """Surveyed indoor rooms, if OSM has any. May not exist."""
    academic: Path
    """Faculties, programmes, subjects, block scheme — the invented half of the dataset.

    ⚠️ May not exist. TUM does not have one, because TUM does not need one: its timetable is real,
    so there is no curriculum to invent a timetable from. `academic_or_none()` is how a caller asks
    for it without assuming every university is generated.
    """
    synth: Path
    """Where the generated timetable is written."""
    plan_rooms: Path | None = None
    """Rooms read off the university's own published floor plans — written by build_plan_rooms.py.

    ⚠️ BETTER EVIDENCE THAN THE OSM SURVEY, and it was previously used for GEOMETRY ONLY. These
    outlines are the architect's, and the refs are the numbers on the door: `P 001A` is what OTH
    calls that room. Feeding them only to `build_room_geometry.py` meant the shapes could be drawn
    but the ROOM did not exist in the timetable, so nothing could ever be scheduled into it — the
    `planRooms` test calls that decoration, correctly. Declared here so the generator can treat a
    published plan as a room source, exactly as it already treats the survey.

    Last field on purpose: it is the only optional one, and a defaulted field may not precede a
    required one.
    """

    def aoi(self) -> dict[str, Any]:
        return json.loads((CONFIG / "aoi" / f"{self.aoi_id}.json").read_text(encoding="utf-8"))

    def terrain_dir(self) -> Path:
        return ROOT / "public" / "terrain" / self.aoi_id

    def read_json(self, path: Path, default: Any = None) -> Any:
        """Read an optional site file. Absence is a fact, not an error — LMU publishes no
        building letters and OTH has almost no surveyed indoor rooms, and both have to work."""
        if not path.exists():
            return default
        return json.loads(path.read_text(encoding="utf-8"))

    @property
    def is_generated(self) -> bool:
        """Is this university's TIMETABLE invented, or is it the real published one?

        ⚠️ THE DIFFERENCE MATTERS EVERYWHERE DOWNSTREAM. OTH and LMU have no published timetable
        to obtain, so theirs is generated from an academic profile and placed by the solver, and
        every session carries `provenance: generated`. TUM Garching publishes its real bookings via
        TUMonline, so its sessions are `measured` and no solver runs at build time. A caller that
        assumes "dataset" means "generated" will badge real data as invented, which is the one
        mistake this project cannot afford to make.
        """
        return self.academic.exists()


SITES: dict[str, Site] = {
    "oth": Site(
        id="oth",
        aoi_id="oth-regensburg",
        label="OTH Regensburg",
        theme="oth",
        buildings=CONFIG / "buildings-oth.json",
        letters=CONFIG / "oth-building-letters.json",
        osm_rooms=CONFIG / "rooms-osm.json",
        plan_rooms=CONFIG / "rooms-plan.json",
        academic=CONFIG / "academic" / "oth.json",
        synth=ROOT / "data" / "synthetic",
    ),
    "lmu": Site(
        id="lmu",
        aoi_id="lmu-muenchen",
        label="LMU München",
        theme="lmu",
        buildings=CONFIG / "buildings-lmu.json",
        letters=CONFIG / "lmu-building-letters.json",
        osm_rooms=CONFIG / "rooms-osm-lmu.json",
        plan_rooms=CONFIG / "rooms-plan-lmu.json",
        academic=CONFIG / "academic" / "lmu.json",
        synth=ROOT / "data" / "synthetic-lmu",
    ),
    # ⚠️ THE ODD ONE OUT, AND DELIBERATELY SO. TUM is the only site whose timetable is REAL —
    # 24 063 teaching bookings published by TUMonline, reshaped by `build_tum_dataset.py` rather
    # than invented by `generate_timetable.py`. It therefore has no academic profile and no
    # published floor plans; its rooms come from NavigaTUM's survey, which is already the richest
    # of the three (3 921 rooms with real seat counts). `synth` still names the output directory
    # even though almost nothing in it is synthetic — the word is the layout's, not a claim.
    "tum": Site(
        id="tum",
        aoi_id="garching",
        label="TUM Garching",
        theme="tum",
        buildings=CONFIG / "campus-garching.json",
        letters=CONFIG / "tum-building-letters.json",  # not published; absence handled
        osm_rooms=CONFIG / "rooms-osm-tum.json",       # NavigaTUM supplies these instead
        academic=CONFIG / "academic" / "tum.json",     # intentionally absent — see is_generated
        synth=ROOT / "data" / "tum",
    ),
}

DEFAULT_SITE = "oth"


def load_site(site_id: str = DEFAULT_SITE) -> Site:
    if site_id not in SITES:
        raise SystemExit(f"Unknown site '{site_id}'. Known: {', '.join(sorted(SITES))}")
    return SITES[site_id]


def add_site_argument(parser) -> None:  # noqa: ANN001 - argparse.ArgumentParser
    parser.add_argument(
        "--site",
        default=DEFAULT_SITE,
        choices=sorted(SITES),
        help="Which university to build. Defaults to the first customer.",
    )


def is_university_building(row: dict[str, Any]) -> bool:
    """Does this OSM building belong to the university?

    ⚠️ TWO KEYS, ONE QUESTION. The OTH fetcher wrote `insideOthOutline`, which names the FIRST
    of the three signals it ended up using rather than the answer it was giving. The site-agnostic
    fetcher writes `isUniversityBuilding`. Both files are real and in use, so this is the one
    place that knows about the older name — nothing downstream should ever test either key
    directly.
    """
    if "isUniversityBuilding" in row:
        return bool(row["isUniversityBuilding"])
    return bool(row.get("insideOthOutline"))
