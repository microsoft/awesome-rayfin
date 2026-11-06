"""WGS84 <-> UTM conversion for any northern-hemisphere zone, without a projection library.

Standard Transverse Mercator on the GRS80/WGS84 ellipsoid (Krüger series, 6th order), which is
what EPSG:258xx uses. Accurate to a few millimetres across a UTM zone — far beyond what a 1 m
terrain grid needs.

Implemented here rather than pulled in as a dependency: `pyproj` ships large binary wheels, and
this repo is destined for public packaging (PLAN §14 Q6), so the fewer heavy dependencies the
better. This is the only projection maths the project needs.

⚠️ **THE ZONE IS A PROPERTY OF THE AOI, NOT OF THIS MODULE.** Until TU Berlin the whole repo was
zone 32 (EPSG:25832) and this file hard-coded `UTM_ZONE = 32`. Berlin's survey data is EPSG:25833,
and the reason that matters is not mainly distortion — it is that **the source tiles are indexed by
zone-33 eastings**. The fetchers discover tiles by arithmetic on the coordinate (see `fetch_bvv.py`:
"tile discovery is arithmetic, not a catalogue"), so reading a Berlin easting as if it were zone 32
does not produce a slightly shifted tile, it produces a tile several hundred kilometres away or no
tile at all.

The distortion is the secondary argument and it is smaller than it first looks: measured across a
4 km baseline over TU Berlin, zone 32 is **+0.66 m per kilometre**, not the ~2.7 m/km a naive
"offset from the central meridian" estimate suggests, because the k0 = 0.9996 deficit cancels much
of the growth. It is still enough to spend a 5 km campus separation's whole ≤3.0 m budget in
`verify_registration.py`, but it is the tile indexing that makes zone 33 mandatory rather than
preferable.

⚠️ **A ZONE IS NOT DECIDED BY LONGITUDE.** `zone_for_lon` gives the nominal zone, and German
survey authorities do not follow it: Bavaria publishes the whole state in zone 32 although it
reaches 13.8°E, so OTH Regensburg (12.10°E) is correctly EPSG:25832 despite nominally falling in
zone 33. Any consistency check against the nominal zone must therefore be a tolerance question,
not an equality — see `_bind_utm_zone` in `aoi.py`.

⚠️ **THE `*_utm32` NAMES WERE DELETED RATHER THAN ALIASED TO ZONE 32.** Keeping them as
zone-32 shims was the obvious migration, and it is exactly wrong: any call site missed during the
migration would keep importing successfully and keep returning confidently wrong coordinates for
Berlin. Removing the names turns every missed call site into an ImportError at startup. Fail
loudly at import, never quietly by metres.

Only the central meridian depends on the zone. The ellipsoid and the meridional-arc coefficients
below are the same for every zone, so there is nothing per-zone to cache.
"""

from __future__ import annotations

import math
import re

# GRS80 / WGS84 ellipsoid
_A = 6378137.0
_F = 1 / 298.257222101
_E2 = _F * (2 - _F)
_N = _F / (2 - _F)

_K0 = 0.9996
_FALSE_EASTING = 500000.0
_FALSE_NORTHING = 0.0  # northern hemisphere

# The zone used when a caller does not name one. `load_aoi()` in `aoi.py` rebinds this from the
# AOI's `workingCrs` on every load, which is the only funnel through which an AOI config can be
# obtained — so a pipeline step cannot forget to set it. Scripts that run BEFORE an AOI exists
# (`probe_site.py`, `locate_campuses.py`, `find_campus_areas.py`) have no config to read and must
# pass `zone=` explicitly, usually from `zone_for_lon()`.
_DEFAULT_ZONE = 32
_active_zone = _DEFAULT_ZONE


def _lon_origin(zone: int) -> float:
    """Central meridian of a UTM zone, in radians. Zone 32 -> 9°E, zone 33 -> 15°E."""
    return math.radians(6 * zone - 183)


def zone_for_lon(lon: float) -> int:
    """The NOMINAL UTM zone a longitude falls in.

    ⚠️ This is the textbook zone, and several German states deliberately ignore it — Bavaria
    publishes as far east as 13.8°E in zone 32. Use it for pre-AOI discovery tools that have a
    coordinate and no config yet, and as one input to a tolerance check; never as a test of whether
    a `workingCrs` is correct.
    """
    return int(math.floor((lon + 180) / 6)) + 1


def scale_error_m_per_km(lon: float, lat: float, zone: int | None = None) -> float:
    """Signed length error, in metres per kilometre, of projecting near (lon, lat) into `zone`.

    Measured rather than derived: project a short east-west baseline and compare it with its true
    ellipsoidal length. That keeps the number honest about the k0 = 0.9996 deficit, which cancels a
    good part of the growth away from the central meridian and which a textbook
    `1 + x²/2R²` estimate overstates by a factor of four at Berlin.
    """
    z = _zone(zone)
    half = 0.005  # ~340 m either side; short enough to be locally linear
    e1, n1 = wgs84_to_utm(lon - half, lat, z)
    e2, n2 = wgs84_to_utm(lon + half, lat, z)
    projected = math.hypot(e2 - e1, n2 - n1)

    phi = math.radians(lat)
    w = math.sqrt(1 - _E2 * math.sin(phi) ** 2)
    true = math.radians(2 * half) * (_A / w) * math.cos(phi)
    return (projected / true - 1) * 1000.0


def crs_to_zone(crs: str) -> int:
    """Extract the UTM zone from an ETRS89 / WGS84 UTM CRS code such as `EPSG:25833`.

    Accepts the 258xx (ETRS89 / UTM zone xxN) and 326xx (WGS84 / UTM zone xxN) families, which is
    everything German survey authorities publish. Anything else raises rather than guessing — a
    silently wrong zone is the failure this module exists to prevent.
    """
    match = re.fullmatch(r"(?:EPSG:)?(258|326)(\d{2})", crs.strip(), re.IGNORECASE)
    if not match:
        raise ValueError(
            f"Cannot read a UTM zone from CRS {crs!r}. "
            "Expected an ETRS89 (EPSG:258xx) or WGS84 (EPSG:326xx) UTM zone code, "
            "e.g. 'EPSG:25832' for zone 32 or 'EPSG:25833' for zone 33."
        )
    return int(match.group(2))


def set_active_zone(zone: int) -> None:
    """Bind the zone used by calls that do not name one. Called by `aoi.load_aoi()`."""
    global _active_zone
    if not 1 <= zone <= 60:
        raise ValueError(f"UTM zone {zone} is out of range 1..60")
    _active_zone = zone


def active_zone() -> int:
    """The zone currently bound. Reported by pipeline steps so a run says which zone it used."""
    return _active_zone


def _zone(zone: int | None) -> int:
    return _active_zone if zone is None else zone


# Meridional arc coefficients — ellipsoid only, identical for every zone.
_A_BAR = _A / (1 + _N) * (1 + _N**2 / 4 + _N**4 / 64)
_ALPHA = (
    _N / 2 - 2 / 3 * _N**2 + 5 / 16 * _N**3,
    13 / 48 * _N**2 - 3 / 5 * _N**3,
    61 / 240 * _N**3,
)
_BETA = (
    _N / 2 - 2 / 3 * _N**2 + 37 / 96 * _N**3,
    1 / 48 * _N**2 + 1 / 15 * _N**3,
    17 / 480 * _N**3,
)
_DELTA = (
    2 * _N - 2 / 3 * _N**2 - 2 * _N**3,
    7 / 3 * _N**2 - 8 / 5 * _N**3,
    56 / 15 * _N**3,
)


def wgs84_to_utm(lon: float, lat: float, zone: int | None = None) -> tuple[float, float]:
    """Return (easting, northing) in metres for the given UTM zone.

    ⚠️ LONGITUDE FIRST (PLAN §6463). Passing `(lat, lon)` raises nothing and returns a plausible
    pair of numbers a few hundred kilometres away.
    """
    phi = math.radians(lat)
    lam = math.radians(lon) - _lon_origin(_zone(zone))

    t = math.sinh(math.atanh(math.sin(phi)) - 2 * math.sqrt(_N) / (1 + _N) * math.atanh(2 * math.sqrt(_N) / (1 + _N) * math.sin(phi)))
    xi = math.atan(t / math.cos(lam))
    eta = math.atanh(math.sin(lam) / math.sqrt(1 + t * t))

    easting = _K0 * _A_BAR * eta
    northing = _K0 * _A_BAR * xi
    for j, alpha in enumerate(_ALPHA, start=1):
        easting += _K0 * _A_BAR * alpha * math.cos(2 * j * xi) * math.sinh(2 * j * eta)
        northing += _K0 * _A_BAR * alpha * math.sin(2 * j * xi) * math.cosh(2 * j * eta)

    return easting + _FALSE_EASTING, northing + _FALSE_NORTHING


def utm_to_wgs84(easting: float, northing: float, zone: int | None = None) -> tuple[float, float]:
    """Return (lon, lat) in degrees from UTM coordinates in the given zone."""
    xi = (northing - _FALSE_NORTHING) / (_K0 * _A_BAR)
    eta = (easting - _FALSE_EASTING) / (_K0 * _A_BAR)

    xi_p = xi
    eta_p = eta
    for j, beta in enumerate(_BETA, start=1):
        xi_p -= beta * math.sin(2 * j * xi) * math.cosh(2 * j * eta)
        eta_p -= beta * math.cos(2 * j * xi) * math.sinh(2 * j * eta)

    chi = math.asin(math.sin(xi_p) / math.cosh(eta_p))
    phi = chi
    for j, delta in enumerate(_DELTA, start=1):
        phi += delta * math.sin(2 * j * chi)

    lam = math.atan(math.sinh(eta_p) / math.cos(xi_p))
    return math.degrees(lam + _lon_origin(_zone(zone))), math.degrees(phi)


def bbox_to_utm(
    west: float, south: float, east: float, north: float, zone: int | None = None
) -> tuple[float, float, float, float]:
    """Project a geographic bbox, taking the envelope of all four corners.

    The corners are used rather than just SW/NE because a geographic rectangle is not a rectangle
    in UTM — the top and bottom edges bow. Taking the envelope guarantees full coverage.
    """
    z = _zone(zone)
    corners = [
        wgs84_to_utm(west, south, z),
        wgs84_to_utm(east, south, z),
        wgs84_to_utm(west, north, z),
        wgs84_to_utm(east, north, z),
    ]
    eastings = [c[0] for c in corners]
    northings = [c[1] for c in corners]
    return min(eastings), min(northings), max(eastings), max(northings)


def utm_to_wgs84_array(easting, northing, zone=None):  # type: ignore[no-untyped-def]
    """Vectorised `utm_to_wgs84` for numpy arrays. Returns (lon, lat) in degrees.

    Resampling the Copernicus shell onto a UTM grid needs the inverse projection once per output
    cell — on the order of a million calls. The scalar version is a few microseconds each, which
    turns a one-second array operation into a half-minute Python loop. Same series, same
    coefficients, same results to floating-point noise; the only difference is that `math.` becomes
    `np.`.
    """
    import numpy as np

    xi = (np.asarray(northing, dtype=np.float64) - _FALSE_NORTHING) / (_K0 * _A_BAR)
    eta = (np.asarray(easting, dtype=np.float64) - _FALSE_EASTING) / (_K0 * _A_BAR)

    xi_p = xi.copy()
    eta_p = eta.copy()
    for j, beta in enumerate(_BETA, start=1):
        xi_p -= beta * np.sin(2 * j * xi) * np.cosh(2 * j * eta)
        eta_p -= beta * np.cos(2 * j * xi) * np.sinh(2 * j * eta)

    chi = np.arcsin(np.sin(xi_p) / np.cosh(eta_p))
    phi = chi.copy()
    for j, delta in enumerate(_DELTA, start=1):
        phi += delta * np.sin(2 * j * chi)

    lam = np.arctan2(np.sinh(eta_p), np.cos(xi_p))
    return np.degrees(lam + _lon_origin(_zone(zone))), np.degrees(phi)


def wgs84_to_utm_array(lon, lat, zone=None):  # type: ignore[no-untyped-def]
    """Vectorised `wgs84_to_utm` for numpy arrays. Returns (easting, northing).

    Needed to read a source published in a DIFFERENT zone than the AOI works in (TINITALY is zone
    32 for the whole of Italy; Rome works in zone 33): one forward projection per output cell.
    Same series and coefficients as the scalar version.
    """
    import numpy as np

    phi = np.radians(np.asarray(lat, dtype=np.float64))
    lam = np.radians(np.asarray(lon, dtype=np.float64)) - _lon_origin(_zone(zone))
    c = 2 * math.sqrt(_N) / (1 + _N)
    t = np.sinh(np.arctanh(np.sin(phi)) - c * np.arctanh(c * np.sin(phi)))
    xi = np.arctan(t / np.cos(lam))
    eta = np.arctanh(np.sin(lam) / np.sqrt(1 + t * t))
    easting = _K0 * _A_BAR * eta
    northing = _K0 * _A_BAR * xi
    for j, alpha in enumerate(_ALPHA, start=1):
        easting = easting + _K0 * _A_BAR * alpha * np.cos(2 * j * xi) * np.sinh(2 * j * eta)
        northing = northing + _K0 * _A_BAR * alpha * np.sin(2 * j * xi) * np.cosh(2 * j * eta)
    return easting + _FALSE_EASTING, northing + _FALSE_NORTHING


def tm_forward_array(lon, lat, lon0: float, lat0: float, k0: float, fe: float, fn: float):  # type: ignore[no-untyped-def]
    """Any Transverse Mercator on GRS80, vectorised: (easting, northing) from degrees.

    The same Krüger series as the UTM functions, with the central meridian, scale and origin
    latitude as parameters. Exists for national grids that a source publishes in and a WMS offers
    INSTEAD of UTM, e.g. Portugal's PT-TM06 (EPSG:3763), the only projected CRS DGT's orthophoto
    service answers in. Northings count from `lat0` on the central meridian, plus `fn`.
    """
    import numpy as np

    c = 2 * math.sqrt(_N) / (1 + _N)

    def series(phi, lam):  # type: ignore[no-untyped-def]
        t = np.sinh(np.arctanh(np.sin(phi)) - c * np.arctanh(c * np.sin(phi)))
        xi = np.arctan(t / np.cos(lam))
        eta = np.arctanh(np.sin(lam) / np.sqrt(1 + t * t))
        e = eta + 0.0
        n = xi + 0.0
        for j, alpha in enumerate(_ALPHA, start=1):
            e = e + alpha * np.cos(2 * j * xi) * np.sinh(2 * j * eta)
            n = n + alpha * np.sin(2 * j * xi) * np.cosh(2 * j * eta)
        return k0 * _A_BAR * e, k0 * _A_BAR * n

    phi = np.radians(np.asarray(lat, dtype=np.float64))
    lam = np.radians(np.asarray(lon, dtype=np.float64)) - math.radians(lon0)
    easting, northing = series(phi, lam)
    _, origin = series(np.radians(np.float64(lat0)), np.float64(0.0))
    return easting + fe, northing - origin + fn


def pt_tm06_array(lon, lat):  # type: ignore[no-untyped-def]
    """ETRS89 / Portugal TM06 (EPSG:3763) from degrees: lon0 8°07'59.19"W, lat0 39°40'05.73"N, k0 1."""
    return tm_forward_array(lon, lat, -8.133108333333333, 39.66825833333333, 1.0, 0.0, 0.0)
