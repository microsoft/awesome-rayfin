"""WGS84 <-> UTM zone 32N conversion, without a projection library.

Standard Transverse Mercator on the GRS80/WGS84 ellipsoid (Krüger series, 6th order), which is
what EPSG:25832 uses. Accurate to a few millimetres across a UTM zone — far beyond what a 1 m
terrain grid needs.

Implemented here rather than pulled in as a dependency: `pyproj` ships large binary wheels, and
this repo is destined for public packaging (PLAN §14 Q6), so the fewer heavy dependencies the
better. This is the only projection maths the project needs.
"""

from __future__ import annotations

import math

# GRS80 / WGS84 ellipsoid
_A = 6378137.0
_F = 1 / 298.257222101
_E2 = _F * (2 - _F)
_N = _F / (2 - _F)

_K0 = 0.9996
_FALSE_EASTING = 500000.0
_FALSE_NORTHING = 0.0  # northern hemisphere

UTM_ZONE = 32
_LON_ORIGIN = math.radians(6 * UTM_ZONE - 183)  # zone 32 -> 9°E

# Meridional arc coefficients
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


def wgs84_to_utm32(lon: float, lat: float) -> tuple[float, float]:
    """Return (easting, northing) in metres, EPSG:25832."""
    phi = math.radians(lat)
    lam = math.radians(lon) - _LON_ORIGIN

    t = math.sinh(math.atanh(math.sin(phi)) - 2 * math.sqrt(_N) / (1 + _N) * math.atanh(2 * math.sqrt(_N) / (1 + _N) * math.sin(phi)))
    xi = math.atan(t / math.cos(lam))
    eta = math.atanh(math.sin(lam) / math.sqrt(1 + t * t))

    easting = _K0 * _A_BAR * eta
    northing = _K0 * _A_BAR * xi
    for j, alpha in enumerate(_ALPHA, start=1):
        easting += _K0 * _A_BAR * alpha * math.cos(2 * j * xi) * math.sinh(2 * j * eta)
        northing += _K0 * _A_BAR * alpha * math.sin(2 * j * xi) * math.cosh(2 * j * eta)

    return easting + _FALSE_EASTING, northing + _FALSE_NORTHING


def utm32_to_wgs84(easting: float, northing: float) -> tuple[float, float]:
    """Return (lon, lat) in degrees from EPSG:25832 coordinates."""
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
    return math.degrees(lam + _LON_ORIGIN), math.degrees(phi)


def bbox_to_utm32(
    west: float, south: float, east: float, north: float
) -> tuple[float, float, float, float]:
    """Project a geographic bbox, taking the envelope of all four corners.

    The corners are used rather than just SW/NE because a geographic rectangle is not a rectangle
    in UTM — the top and bottom edges bow. Taking the envelope guarantees full coverage.
    """
    corners = [
        wgs84_to_utm32(west, south),
        wgs84_to_utm32(east, south),
        wgs84_to_utm32(west, north),
        wgs84_to_utm32(east, north),
    ]
    eastings = [c[0] for c in corners]
    northings = [c[1] for c in corners]
    return min(eastings), min(northings), max(eastings), max(northings)


def utm32_to_wgs84_array(easting, northing):  # type: ignore[no-untyped-def]
    """Vectorised `utm32_to_wgs84` for numpy arrays. Returns (lon, lat) in degrees.

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
    return np.degrees(lam + _LON_ORIGIN), np.degrees(phi)
