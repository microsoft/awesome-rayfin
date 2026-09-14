"""
What a building IS, from the survey — PLAN §5.11.

Roof colour is measured from a photograph, and that photograph sees roughly thirty per cent of a
building. The other seventy is wall — 68–71 % of 3D surface area in every height band. A lecture
hall that is 68 % wall is barely touched by a roof sample, however good that sample is.

Walls cannot be measured: they are invisible from directly above, and OpenStreetMap carries
`building:colour` for a fraction of a per cent. But *what the building is* very much can be.
Bavarian LoD2 carries the ALKIS `bldg:function` code on every building, plus a measured height and
footprint, and a lecture hall is not a bin store is not a church.

⚠️ **THE CODES BELOW WERE READ OFF THIS REGION'S OWN DATA, not off a code list or off the version of
this file written for the Allgäu.** Catalogue versions differ, and the differences here were not
cosmetic — see the two warnings below. Confirmed against 31 386 buildings around Regensburg and
41 863 around Munich, using the survey's own `gml:name` values:

    code          Regensburg              Munich                  names seen
    31001_1000    14342  130 m²  10.9 m   16406  214 m²  18.9 m   Arnulfsplatz
    31001_2000     6985   31 m²   3.4 m   11149   38 m²   3.4 m   —
    31001_2463     5546   31 m²   2.9 m     315   43 m²   2.9 m   —
    51009_1610     3280   12 m²   4.4 m    2031   24 m²   3.9 m   Carport, Parkhaus
    31001_9998      244  257 m²  13.9 m   10635  233 m²  19.6 m   Frauenklinik, Berufsfachschule
    31001_3000      169  438 m²  12.4 m     335  652 m²  21.0 m   Westbad, Deutsches Theater
    31001_3020      154 1188 m²  15.6 m     227  876 m²  19.4 m   Fachhochschule, Klenze-Gymnasium
    31001_3041       57  649 m²  26.2 m      97  598 m²  23.7 m   Mariä Himmelfahrt, St. Stephan
    31001_3065       53  459 m²   7.3 m      76  356 m²   7.6 m   Kindergarten St. Bonifaz
    31001_3052       34  878 m²  15.2 m      11  687 m²  16.1 m   Bezirksklinikum
    31001_3051       21 1407 m²  12.7 m     142  471 m²  17.3 m   Krankenhaus Barmherzige Brüder
    31001_3043       22   66 m²   9.1 m      12  169 m²   8.5 m   Kapelle, Ölbergkapelle
    31001_2461       14 2359 m²  14.4 m       4  973 m²   4.4 m   Parkhaus, Lodenfrey Parkhaus
    31001_3071        3  836 m²  17.6 m      58  582 m²  16.7 m   Polizeiinspektion
    31001_3048        3  567 m²  17.6 m      14  460 m²  18.4 m   Karmelitenkloster, Angerkloster
    31001_3018        6 1019 m²  18.3 m      25  311 m²  23.5 m   Regierung der Oberpfalz, Maximilianeum
    31001_3012        2 1051 m²  19.2 m      10  468 m²  30.3 m   Neues Rathaus, Altes Rathaus
    31001_3031        1 4719 m²  29.8 m       3 2105 m²  28.0 m   Schloss St. Emmeram, Residenz München
    31001_3072       10  203 m²   7.5 m       5 1506 m²  21.2 m   Feuerwache 1 — Hauptfeuerwache
    31001_3075        9  291 m²  16.0 m       1  355 m²  16.1 m   JVA Regensburg
    31001_3091        2 1527 m²  17.9 m      11  949 m²  19.7 m   München Hauptbahnhof
    31001_3042        1  482 m²  14.8 m       1  720 m²  20.3 m   Ohel-Jakob-Synagoge
    53001_1800       67  705 m²   6.9 m     121  323 m²   1.3 m   —

⚠️ **`31001_2000` IS THE SAME TRAP HERE AS IN THE ALLGÄU.** It reads as "Gebäude für Wirtschaft oder
Gewerbe" — hotels and shops — and at a median of 31–38 m² and 3.4 m tall it is overwhelmingly bin
stores, garages and workshops. Together with `31001_2463` it is a quarter of Regensburg. The rule
therefore uses the code **and** the measured size, because the code alone puts a garden shed and a
supermarket in the same bucket.

⚠️ **BUT THE ALLGÄU'S ANSWER TO THAT TRAP IS WRONG HERE.** There, small-and-low meant an alpine hut
and was painted as weathered board. These are two Bavarian *cities*: the same size signature is a
garage, a substation or a bin store, and boarding them would put a hay barn behind the Regierung der
Oberpfalz. The class exists, but it is rendered blockwork, not timber.

⚠️ **AND THE CODE ALONE FAILS LMU BADLY.** At OTH the university's own buildings are `31001_3020`
("Schule, Fachhochschule") and the rule catches them. At LMU **1 249 of 3 644 buildings on campus —
34 % — are `31001_9998`, "unspecified"**, and their names are `Frauenklinik`, `Klinik und Poliklinik
für Dermatologie`, `Staatl. Berufsfachschule für Hebammen`. The cadastre simply does not say what
they are, so the most important buildings in the app would have been painted as flats. `9998`
cannot be *assumed* institutional — plenty of it is housing — so instead the caller passes
`institutional=True` for buildings the site's OWN ownership test already accepted
(`config/buildings-<site>.json`, from OSM `operator`). That is measured evidence from a different
source, not a guess about a code that says nothing.

⚠️ **BADEN-WÜRTTEMBERG PUBLISHES A FINER CATALOGUE, AND THE BAVARIAN SET DOES NOT COVER IT.**
Measured the same way on the 18 269 LGL buildings around Tübingen (2026-08-03). Bavaria writes the
university as one coarse `31001_3020`; the LGL splits the same idea across several codes, and
**not one of them appears in Regensburg or Munich**, so left alone the entire university would have
been painted as housing — the same failure as LMU, arriving by a different route:

    code          Tübingen                names the survey itself wrote
    31001_1010     7436  110 m²  10.9 m   Whs, Karl-Heim-Haus            (Wohnhaus — the old town)
    31001_2463     4520   27 m²   3.0 m   —                              (already known: garages)
    51009_1610     1589   10 m²   4.5 m   —                              (already known: carports)
    31001_2723     1383   15 m²   3.2 m   —
    31001_1123      624  159 m²  15.3 m   Nonnenhaus, Kirch am Eck
    31001_1313      591   13 m²   3.6 m   —
    31001_2112      453   96 m²   5.9 m   Städtischer Fuhrpark, Bundesbahnbetriebswerk
    31001_3024       71  475 m²  14.6 m   Institut für Hirnforschung, Alte Anatomie,
                                          Alte Universitätsapotheke, Institut für Tropenmedizin
    31001_3065       47  229 m²   7.1 m   Kinderhaus Lindenbrunnen
    31001_3010       45  437 m²  15.0 m   Landratsamt, Regierungspräsidium, Bürgeramt
    31001_3021       41  533 m²   9.0 m   Uhland-Gymnasium, Aischbachschule
    31001_3210       28  235 m²   6.0 m   Turnhalle Aischbachschule, Sporthalle Feuerhägle
    31001_3051       25 1006 m²  19.1 m   Augenklinik, CRONA Kliniken
    31001_3023       25  629 m²  24.2 m   Anatomisches Institut, Evangelisches Stift, Mensa II
    31001_3036       17  218 m²   8.7 m   Mensa, Landestheater, Salzstadel
    31001_3041       16  411 m²  13.0 m   Stephanuskirche, Jakobuskirche
    31001_3044       10  191 m²  13.8 m   Gemeindehaus Jakobus, Kath. Gemeindezentrum

Only 1.1 % of LGL buildings carry a `gml:name` at all — but the ones that do are overwhelmingly the
public buildings, exactly as in Rhineland-Palatinate, so the codes that matter are the codes that
can be confirmed. `31001_1312`/`1313` sit in the *dwelling* branch of the catalogue and are unnamed,
so they are judged the way `31001_2000` is: at a median of 13–27 m² and 3.6 m they are garden houses
and are treated as such, not as homes.

**What is measured and what is convention, stated plainly.** The class is measured: cadastral
function, the survey's own dimensions, and the operator tag. The colour each class is painted is a
convention, chosen to match Bavarian urban practice, and is not a claim about any individual wall.
"""

from __future__ import annotations

#: Wall treatments. Small integers because they cross to the browser in JSON once per building;
#: the names travel in the metadata block so the file stays readable.
RENDER = 0
"""Warm off-white render — the Bavarian urban default, and most of both cities."""

UTILITY = 1
"""Bin stores, garages, substations, carports. Grey blockwork, not a house colour."""

WHITEWASH = 2
"""The brighter, cooler lime of a church, chapel, synagogue or monastery."""

CIVIC = 3
"""Institutional: universities, clinics, schools, government, museums. Flatter and cooler."""

CONCRETE = 4
"""Parking decks and transport works. Bare grey, and deliberately not a building colour."""

WALL_CLASS_NAMES = {
    RENDER: "render",
    UTILITY: "utility",
    WHITEWASH: "whitewash",
    CIVIC: "civic",
    CONCRETE: "concrete",
}

#: Places of worship and religious houses — confirmed by name in both AOIs.
_WORSHIP = {
    "31001_3041",  # church — Mariä Himmelfahrt, St. Stephan
    "31001_3043",  # chapel — Kapelle, Ölbergkapelle
    "31001_3042",  # synagogue — Ohel-Jakob-Synagoge
    "31001_3048",  # monastery — Karmelitenkloster, Angerkloster
}

#: Institutional. Every one of these is confirmed by a named building in Regensburg, Munich or
#: Tübingen — the Baden-Württemberg codes are marked, because none of them occurs in Bavaria.
_CIVIC = {
    "31001_3000",  # public building — Westbad, Deutsches Theater, museums
    "31001_3010",  # BW: public administration — Landratsamt, Regierungspräsidium, Bürgeramt
    "31001_3012",  # town hall — Neues Rathaus, Altes Rathaus
    "31001_3017",  # district administration — Landratsamt
    "31001_3018",  # regional government — Regierung der Oberpfalz, Maximilianeum
    "31001_3020",  # school / university — Fachhochschule, Pathologisches Institut
    "31001_3021",  # BW: school — Uhland-Gymnasium, Aischbachschule, Ludwig-Krapf-Schule
    "31001_3023",  # BW: research / university — Anatomisches Institut, Evangelisches Stift
    "31001_3024",  # BW: university institute — Institut für Hirnforschung, Alte Anatomie
    "31001_3031",  # palace / museum — Residenz München, Schloss St. Emmeram, Schloß Hohentübingen
    "31001_3034",  # BW: historic public — Kornhaus, Hölderlinturm
    "31001_3036",  # BW: public assembly — Mensa, Landestheater, Salzstadel
    "31001_3037",  # BW: library — Universitätsbibliothek, Stadtbücherei
    "31001_3044",  # BW: parish centre — Gemeindehaus Jakobus, Kath. Gemeindezentrum
    "31001_3051",  # hospital — Krankenhaus Barmherzige Brüder, Augenklinik, CRONA Kliniken
    "31001_3052",  # clinic — Bezirksklinikum
    "31001_3065",  # kindergarten
    "31001_3071",  # police
    "31001_3072",  # fire station
    "31001_3075",  # prison — JVA Regensburg
    "31001_3091",  # station / large public — München Hauptbahnhof
    "31001_3210",  # BW: sports hall — Turnhalle Aischbachschule, Sporthalle Feuerhägle
    "31001_3211",  # BW: sports hall — Paul Horn-Arena, Hermann-Hepper-Turnhalle
    "31001_3221",  # BW: public baths — Uhlandbad (Bavaria files the Westbad under 3000)
    "51001_1008",  # BW: tower — Österbergturm
    "51001_1009",  # BW: tower — Fünf-Eck-Turm, Haspelturm (both belong to Schloß Hohentübingen)
}

#: Parking decks and transport works. Concrete in life, and large enough to matter in view.
_CONCRETE = {
    "31001_2461",  # multi-storey car park — "Parkhaus", "Lodenfrey Parkhaus"
    "53001_1800",  # transport works
    "53009_2050",
    "52003_1020",
}

#: Open structures — carports, canopies, covered ways.
_SHELTER = {"51009_1610", "51009_1700", "51007_1500"}

#: "Trade or commerce" and its neighbours: the group the size test exists for.
#:
#: The Baden-Württemberg entries are unnamed in the survey, so they are admitted on their measured
#: size alone — which is the whole point of this group: `31001_2723` has a median footprint of
#: 15 m², `31001_1313` of 13 m². Nothing that small is a shop or a home. Where one of them IS large
#: (a works rather than a lock-up) the size test below still sends it to RENDER, so admitting them
#: here costs nothing if the reading is wrong.
_TRADE = {
    "31001_2000",
    "31001_2463",
    "31001_2465",
    "31001_2513",
    "31001_2523",
    "31001_2072",
    "31001_1312",  # BW, 27 m² / 4.1 m
    "31001_1313",  # BW, 13 m² / 3.6 m
    "31001_2112",  # BW, 96 m² / 5.9 m — Städtischer Fuhrpark, Bundesbahnbetriebswerk
    "31001_2120",  # BW, 71 m² / 5.6 m
    "31001_2130",  # BW, 154 m² / 4.0 m
    "31001_2140",  # BW, 33 m² / 5.6 m
    "31001_2612",  # BW, 15 m² / 3.1 m
    "31001_2721",  # BW, 70 m² / 10.5 m
    "31001_2723",  # BW, 15 m² / 3.2 m
    "31001_2724",  # BW, 20 m² / 5.0 m
    "31001_2740",  # BW, 137 m² / 3.8 m
}

#: Above this footprint or height, a "trade" building is a hall or a works rather than a shed.
#: Set above the 31–43 m² median of that group and below anything that could be commercial.
_SHED_FOOTPRINT_M2 = 120.0
_SHED_HEIGHT_M = 7.0


def wall_class(
    function_code: str,
    footprint_m2: float,
    height_m: float,
    institutional: bool = False,
) -> int:
    """Which wall treatment a building gets, from its cadastral class and its measured size.

    `institutional` comes from the site's own ownership test rather than from the cadastre, and it
    fills the cadastre's SILENCE — see the module note. Without it a third of LMU's campus, tagged
    `31001_9998`, would be painted as housing while carrying names like `Frauenklinik`.

    ⚠️ **OWNERSHIP ANSWERS "THE CADASTRE DOES NOT SAY", NOT "THE CADASTRE IS WRONG."** It used to
    be tested second, ahead of every code, and at Garching — where the OSM campus outline is 80 ha
    and swallows the whole research park — that painted **301 of 353 buildings civic**, including
    the bike shelters, the bin stores and the multi-storey car park. Being inside a university
    fence does not make a carport a lecture hall. So ownership is now consulted where the code has
    nothing specific to say, and the specific, visible classes still win.
    """
    if function_code in _WORSHIP:
        return WHITEWASH
    if function_code in _CIVIC:
        return CIVIC
    if function_code in _CONCRETE:
        return CONCRETE
    if function_code in _SHELTER:
        return UTILITY

    if function_code in _TRADE:
        # Small and low is a garage or a bin store; big is a hall or a works, and those are
        # rendered or clad rather than left as blockwork.
        small = footprint_m2 < _SHED_FOOTPRINT_M2 and height_m < _SHED_HEIGHT_M
        return UTILITY if small else RENDER

    # Here the cadastre has said nothing useful: dwellings, `9998` unspecified, and whatever the
    # catalogue grows later. THIS is where the ownership evidence belongs — a large unspecified
    # building inside the university's own outline is a university building.
    if institutional:
        return CIVIC

    # In a city the unspecified group is dominated by ordinary urban blocks, which is what RENDER is.
    return RENDER
