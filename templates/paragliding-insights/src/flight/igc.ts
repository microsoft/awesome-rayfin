/**
 * IGC flight-log parsing — PLAN §7 phase 2.
 *
 * Parsing happens **entirely in the browser**, for both the bundled flight and anything the viewer
 * drags in. That is not a shortcut: a dropped IGC is personal location history, and a design where
 * it never leaves the machine has no upload, no retention question and no licence question to
 * answer. It also means there is exactly one parser to get right.
 *
 * The format is fixed-width ASCII, one record per line, tagged by its first character:
 *
 *   A  logger manufacturer and serial   (the serial is stripped from bundled files at import)
 *   H  headers — date, pilot, glider, instrument
 *   B  a fix: time, position, pressure altitude, GPS altitude
 *
 * Only A, H and B are read. I/J extension records describe extra per-fix fields that XCTracer and
 * most instruments do not fill with anything this app uses.
 */

/** One fix, exactly as recorded. Nothing here is derived. */
export interface IgcFix {
  /** Seconds since midnight UTC, with day rollover already resolved. */
  seconds: number;
  lat: number;
  lon: number;
  /**
   * Pressure altitude, metres above the 1013.25 hPa datum.
   *
   * ⚠️ Not height above sea level, and not comparable with the terrain model. It is the better
   * signal for *vertical speed* — it is smooth and it is what a vario responds to — but reading it
   * as an altitude on the day's actual pressure will be wrong by tens of metres.
   */
  pressureM: number;
  /** GPS altitude, metres on the WGS84 ellipsoid as the receiver reports it. */
  gpsM: number;
  /** False for a 2D fix, where the altitude is not trustworthy. */
  valid: boolean;
}

export interface IgcFlight {
  /** ISO date from the HFDTE header, or '' when absent. */
  date: string;
  fixes: IgcFix[];
  /** Instrument family, from the A record. Kept because it explains how the fixes behave. */
  logger: string;
  /**
   * True when the file still carries pilot or glider identification.
   *
   * Bundled flights are anonymised at import, so this is false for them. A file the viewer drags
   * in may well carry a name — it stays in the browser either way, and the UI never displays it.
   */
  identified: boolean;
}

const B_RECORD =
  /^B(\d{2})(\d{2})(\d{2})(\d{2})(\d{5})([NS])(\d{3})(\d{5})([EW])([AV])(-\d{4}|\d{5})(-\d{4}|\d{5})/;

export class IgcParseError extends Error {}

/**
 * Parse an IGC file.
 *
 * Malformed lines are skipped rather than fatal. Instruments append all sorts of proprietary
 * records, and a file with a few unreadable lines is still a perfectly good flight — refusing it
 * would reject real logs for no benefit.
 */
export function parseIgc(text: string): IgcFlight {
  const lines = text.split(/\r?\n/);

  let date = '';
  let logger = '';
  let identified = false;
  const fixes: IgcFix[] = [];

  // IGC times are seconds since midnight UTC with no date, so a flight running past midnight
  // restarts at zero. Tracking the previous value and adding a day on a backwards jump keeps the
  // timeline monotonic. Rare for a paraglider, catastrophic for the scrubber when it happens.
  let previousSeconds = -1;
  let dayOffset = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('A') && !logger) {
      logger = line.slice(1, 4);
      continue;
    }

    if (line.startsWith('HFDTE')) {
      const digits = line.slice(5).replace(/\D/g, '').slice(0, 6);
      if (digits.length === 6) {
        // DDMMYY. Two-digit years in this format are 2000-based; IGC predates the convention
        // being a problem and no paraglider log predates 2000.
        date = `20${digits.slice(4, 6)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
      }
      continue;
    }

    if (line.startsWith('HFPLT') || line.startsWith('HFGID')) {
      const value = line.slice(5).split(':').slice(1).join(':').trim();
      if (value) identified = true;
      continue;
    }

    const match = B_RECORD.exec(line);
    if (!match) continue;

    const [, hh, mm, ss, latDeg, latMin, latHem, lonDeg, lonMin, lonHem, fix, pressure, gps] =
      match;

    let seconds = Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
    if (previousSeconds >= 0 && seconds + dayOffset < previousSeconds - 43200) {
      dayOffset += 86400;
    }
    seconds += dayOffset;
    previousSeconds = seconds;

    // Coordinates are degrees plus thousandths of a minute, packed without a separator.
    let lat = Number(latDeg) + Number(latMin) / 60000;
    let lon = Number(lonDeg) + Number(lonMin) / 60000;
    if (latHem === 'S') lat = -lat;
    if (lonHem === 'W') lon = -lon;

    fixes.push({
      seconds,
      lat,
      lon,
      pressureM: Number(pressure),
      gpsM: Number(gps),
      valid: fix === 'A',
    });
  }

  if (fixes.length < 2) {
    throw new IgcParseError('no usable B records — this does not look like a flight log');
  }

  return { date, fixes, logger, identified };
}
