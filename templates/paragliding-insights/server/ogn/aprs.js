/**
 * APRS-IS / OGN line parser — pure, no I/O, so it can be tested against real captured traffic.
 *
 * Written against a real 75-second capture over the Nebelhorn (2026-07-29, `tools/ogn/spike.py`)
 * rather than against the wiki, which is how the two surprises below were found.
 *
 * ⚠️ **The transmitter prefix is a red herring.** PLAN §5.3 frames this as "FANET is what
 * paraglider instruments transmit", which is true but does not mean paragliders arrive with an
 * `FNT` callsign. In the capture, 7 paragliders were airborne and only 3 appeared as `FNT*`; the
 * rest came through as `FLR*`, because a FLARM-protocol receiver decoded them. Filtering on the
 * prefix would have silently dropped more than half the traffic the app exists to show. The
 * authoritative signal is the **aircraft-type nibble in the `id` field**, and that is what this
 * parser reports.
 *
 * ⚠️ **The same aircraft is relayed under two callsigns.** Device `1164F8` appeared as both
 * `FNT1164F8` and `FLR1164F8` within one second — and with altitudes 134 m apart (2260 m vs
 * 2394 m). Keying anything on the callsign would put one paraglider on the map twice, joined by a
 * trail that jumps back and forth by the height of a church spire. The device id is the identity;
 * `traffic.js` picks one source per device and ignores the other.
 */

/**
 * Position lines look like:
 *   FNT1164F8>OGNFNT,qAS,EDMC:/132950h4723.95N/01019.95Eg276/010/A=007416 !W57! id1E1164F8 +374fpm
 *
 * The `!W57!` is a precision enhancement and is not optional in practice — without it, positions
 * are quantised to 1/100 of a minute, which is ~18 m of latitude. A glider on a 3D map at that
 * quantisation visibly stair-steps along its own trail.
 */
const POSITION_RE = new RegExp(
  '^(?<src>[A-Za-z0-9-]{1,9})>(?<dst>[A-Za-z0-9-]+),(?<path>[^:]*):' +
    '/(?<time>\\d{6})h' +
    '(?<lat>\\d{4}\\.\\d{2})(?<ns>[NS])' +
    '(?<symtab>.)' +
    '(?<lon>\\d{5}\\.\\d{2})(?<ew>[EW])' +
    '(?<sym>.)' +
    '(?:(?<course>\\d{3})/(?<speed>\\d{3}))?' +
    '/A=(?<alt>-?\\d{6})' +
    '(?<rest>.*)$'
);

const ID_RE = /id([0-9A-Fa-f]{2})([0-9A-Fa-f]{6})/;
const PRECISION_RE = /!W(\d)(\d)!/;
const CLIMB_RE = /([+-]\d+)fpm/;
const TURN_RE = /([+-][\d.]+)rot/;

const KNOTS_TO_MS = 0.514444;
const FEET_TO_M = 0.3048;
const FPM_TO_MS = 0.00508;

/**
 * Bits 2–5 of the id byte. The names are OGN's; only free flight matters to this app, but every
 * type is named so that a filter decision is made on a word rather than on a magic number.
 */
export const AIRCRAFT_TYPE = {
  0: 'unknown',
  1: 'glider',
  2: 'towplane',
  3: 'helicopter',
  4: 'parachute',
  5: 'dropplane',
  6: 'hangglider',
  7: 'paraglider',
  8: 'aircraft',
  9: 'jet',
  10: 'ufo',
  11: 'balloon',
  12: 'airship',
  13: 'uav',
  15: 'static',
};

/** The types this app is about. Everything else is traffic, not free flight. */
export const FREE_FLIGHT = new Set(['paraglider', 'hangglider', 'glider']);

const ADDRESS_TYPE = { 0: 'random', 1: 'icao', 2: 'flarm', 3: 'ogn' };

/**
 * APRS packs latitude as `ddmm.mm` and longitude as `dddmm.mm`, with an optional third minute
 * digit carried separately in the `!W..!` field.
 */
function degreesFrom(value, hemisphere, extraDigit) {
  const dot = value.indexOf('.');
  const degrees = Number(value.slice(0, dot - 2));
  const minutes = Number(value.slice(dot - 2) + (extraDigit ?? ''));
  const decimal = degrees + minutes / 60;
  return hemisphere === 'S' || hemisphere === 'W' ? -decimal : decimal;
}

/** Seconds since UTC midnight, from the `hhmmss` stamp APRS carries. */
function secondsFromHms(hms) {
  return Number(hms.slice(0, 2)) * 3600 + Number(hms.slice(2, 4)) * 60 + Number(hms.slice(4, 6));
}

/**
 * Parse one line.
 *
 * Returns `null` for anything that is not an aircraft position — server comments, receiver status
 * beacons, weather, and the receivers' own position reports. Receivers are excluded by requiring
 * an `id` field: a ground station has no device id, and this app has no use for one that did.
 */
export function parseAprsLine(line) {
  if (!line || line.startsWith('#')) return null;

  const match = POSITION_RE.exec(line);
  if (!match) return null;

  const g = match.groups;

  // Receivers relay aircraft with `qAS`; they send their own beacons with `TCPIP*`. Keeping those
  // would add a few dozen stationary "aircraft" sitting on hilltops.
  if (g.path.includes('TCPIP*')) return null;

  const id = ID_RE.exec(g.rest);
  if (!id) return null;

  const flags = parseInt(id[1], 16);
  const deviceId = id[2].toUpperCase();

  const precision = PRECISION_RE.exec(g.rest);
  const lat = degreesFrom(g.lat, g.ns, precision?.[1]);
  const lon = degreesFrom(g.lon, g.ew, precision?.[2]);

  const climb = CLIMB_RE.exec(g.rest);
  const turn = TURN_RE.exec(g.rest);

  return {
    /** Hardware device address — the identity. Never the callsign; see the header note. */
    deviceId,
    /** Which protocol carried this report. Kept only so one source per device can be chosen. */
    source: g.src.slice(0, 3).toUpperCase(),
    addressType: ADDRESS_TYPE[flags & 0x03] ?? 'unknown',
    aircraftType: AIRCRAFT_TYPE[(flags >> 2) & 0x0f] ?? 'unknown',
    /**
     * The pilot asked not to be tracked, in-band. Independent of the device database, and honoured
     * even when the database says nothing — PLAN §2.2.1.
     */
    stealth: Boolean(flags & 0x80),
    noTrack: Boolean(flags & 0x40),
    lat,
    lon,
    /**
     * Metres above mean sea level, converted from the feet APRS carries.
     *
     * ⚠️ OGN documents `/A=` as MSL and receivers report their geoid separation separately
     * (`EGM96:+48m` appears in their status beacons), so this is treated as orthometric and
     * therefore comparable with the DHHN2016 terrain. The residual uncertainty is of order the
     * geoid separation — tens of metres — if any transmitter in the chain reports ellipsoidal
     * height instead. It is not enough to matter for "is that glider above the ridge", and the app
     * does not use it for anything finer.
     */
    altM: Number(g.alt) * FEET_TO_M,
    courseDeg: g.course ? Number(g.course) : null,
    groundMs: g.speed ? Number(g.speed) * KNOTS_TO_MS : null,
    /** Positive up. Reported by the device, not differentiated from position by us. */
    climbMs: climb ? Number(climb[1]) * FPM_TO_MS : null,
    /** Half-turns per minute, signed. Positive is a right turn. */
    turnRate: turn ? Number(turn[1]) : null,
    /** Seconds since UTC midnight. */
    timeS: secondsFromHms(g.time),
  };
}
