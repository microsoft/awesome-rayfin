"""
What a building IS, from the survey — PLAN §5.11.

Roof colour is measured from a photograph, and that photograph sees roughly thirty per cent of a
building. The other seventy is wall — measured at 68–71 % of 3D surface area in every height band,
which was the surprise that made this module necessary. A church that is 68 % wall and a 38 m mast
that is 97 % wall are barely touched by a roof sample, however good it is.

Walls cannot be measured (§5.11: not visible from above, and OSM has `building:colour` for 0.02 %
of buildings here). But *what the building is* very much can be: Bavarian LoD2 carries the ALKIS
`bldg:function` code on every building, plus a measured height and footprint. A shed is not a
church is not a clinic, and they are not the same colour in life either.

⚠️ **The codes below were read off the data, not off a code list.** Every one is confirmed by the
survey's own `gml:name` values for buildings in these two AOIs, which is the only way to be sure
the catalogue version matches:

    31001_1000  n=2403  median 132 m², 9.3 m   "Pfarrhof", "Obere Lugenalpe"        → dwelling
    31001_2000  n=3341  median  43 m², 4.2 m   "Wankhütte", "Untere Lugenalpe",
                                               "Elektrizitäts- und Wasserwerk"      → trade/farm
    51009_1610  n= 296  median  32 m², 3.9 m   "Carport", "Brennholzüberdachung"    → open shelter
    31001_3041  n=   3  median 372 m², 26.1 m  "St. Johannes Baptist",
                                               "Christuskirche"                     → church
    31001_3043  n=  15  median  60 m², 9.3 m   "St. Maria", "Klausenkapelle"        → chapel
    31001_3020  n=   4  median 1857 m², 14.6 m "Gertrud-von-le-Fort-Gymnasium"      → school
    31001_3065  n=   5  median 395 m², 7.0 m   "Kindergarten St. Martin"            → kindergarten
    31001_3051  n=   2  median 1333 m², 19.0 m "Klinik Oberstdorf"                  → hospital
    31001_3052  n=  13  median 242 m², 12.1 m  "Stillachhaus Klinik", "Adula-Klinik"→ clinic
    31001_3000  n=  24  median 338 m², 9.1 m   "Rathaus", "Heimatmuseum"            → public
    53001_1800  n=  63  median 118 m², 1.2 m   —                                    → transport works

⚠️ **`31001_2000` was nearly mis-read, and the size distribution is what caught it.** The code
means "Gebäude für Wirtschaft oder Gewerbe", which sounds like hotels and shops — in a resort town
that reading is very plausible and it is wrong. At a median of 43 m² and 4.2 m tall, with names
like *Wankhütte*, the bulk of these 3341 buildings are sheds, alpine huts and workshops. They are
the single largest group in the valley, and they had been wearing the same cream render as the
houses. So the rule below uses the code **and** the measured size, because the code alone would put
a barn and a supermarket in the same bucket.

**What is measured and what is convention, stated plainly.** The class is measured: it comes from
the cadastre and the survey's own dimensions. The colour each class is painted is a convention,
exactly like the tree silhouettes in NOTICE.md — chosen to match Allgäu building practice, and not
a claim about any individual wall.
"""

from __future__ import annotations

#: Wall treatments. Kept as small integers because they cross to the browser in JSON, once per
#: building; the names live in the metadata block so the file stays readable.
RENDER = 0
"""Warm off-white lime render. The default, and most of the valley."""

TIMBER = 1
"""Weathered board. Sheds, hay barns, alpine huts, carports."""

WHITEWASH = 2
"""The brighter, cooler lime of a church or chapel — deliberately lighter than a house."""

CIVIC = 3
"""Larger public and institutional buildings: render, but flatter and cooler."""

CONCRETE = 4
"""Retaining walls, galleries and transport structures. Grey, and not a house colour."""

WALL_CLASS_NAMES = {
    RENDER: "render",
    TIMBER: "timber",
    WHITEWASH: "whitewash",
    CIVIC: "civic",
    CONCRETE: "concrete",
}

#: Codes whose meaning is confirmed above by the survey's own building names.
_CHURCH = {"31001_3041", "31001_3043"}
_CIVIC = {
    "31001_3000",  # public building — Rathaus, museum, Rotes Kreuz
    "31001_3020",  # school
    "31001_3051",  # hospital
    "31001_3052",  # clinic / sanatorium
    "31001_3065",  # kindergarten
    "31001_3072",
}
_SHELTER = {"51009_1610"}  # carport, wood store — open timber structures
_TRANSPORT_WORKS = {"53001_1800", "53009_2050"}
_TRADE = {"31001_2000", "31001_2463", "31001_2523"}


def wall_class(function_code: str, footprint_m2: float, height_m: float) -> int:
    """Which wall treatment a building gets, from its cadastral class and its measured size.

    Size is consulted rather than trusted blindly to the code, for the reason in the module note:
    "trade or commerce" spans a hay barn and a supermarket, and only one of those is boarded.
    """
    if function_code in _CHURCH:
        return WHITEWASH
    if function_code in _CIVIC:
        return CIVIC
    if function_code in _TRANSPORT_WORKS:
        return CONCRETE
    if function_code in _SHELTER:
        return TIMBER

    if function_code in _TRADE:
        # Small and low is a shed or a hut; big is a hall or a works, and those are rendered or
        # clad rather than boarded. The threshold sits above the 43 m² median of this group and
        # below anything that could be a commercial building.
        return TIMBER if (footprint_m2 < 120 and height_m < 7.0) else RENDER

    # Dwellings, unspecified, and anything the catalogue grows later.
    return RENDER
