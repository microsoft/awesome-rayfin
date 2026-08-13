/**
 * Curate the flight archive into the tables the Lakehouse loads — PLAN §6, phase 5.
 *
 * ⚠️ **This deliberately runs the app's own code.** `parseIgc`, `buildTrack` and `deriveWind` are
 * imported from `src/flight/`, not reimplemented here, and that is the whole point: Mode D reports
 * aggregates of the same flights Mode B replays, so if the two ever disagreed the app would be
 * arguing with itself in front of an audience. A Python port of the wind derivation would have
 * been the obvious shape and would have drifted from the original within a release — that
 * algorithm is 200 lines of angle wrapping and interpolation with a known 5 % failure mode if the
 * turn endpoint is not split exactly (see `wind.ts`).
 *
 * Node 24 runs TypeScript directly, but the app's own imports omit file extensions (`./utm`, not
 * `./utm.ts`) because Vite resolves them — and Node's ESM loader does not. Rather than add
 * extensions across `src/` to suit a build tool, this is bundled with esbuild first, which is
 * already present as a Vite dependency. `npm run curate` does both steps.
 *
 * Output — three tidy tables, one row per thing, ready for `tools/fabric/load_tables.py`:
 *
 *   flight_fix.csv      one row per recorded fix
 *   flight_summary.csv  one row per flight
 *   flight_wind.csv     one row per measured altitude band
 *
 * Usage
 *   npm run curate
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { parseIgc } from '../../src/flight/igc.ts';
import { buildTrack, type FlightTrack, type WorldOrigin } from '../../src/flight/track.ts';
import { deriveWind } from '../../src/flight/wind.ts';

/** Bundled output lives elsewhere, so paths resolve from the working directory: the repo root. */
const ROOT = process.cwd();

interface Args {
  flights: string;
  out: string;
  aoi: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { flights: 'public/flights', out: 'data/curated', aoi: 'oberstdorf' };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    const value = argv[i + 1];
    if (key === 'flights') args.flights = value;
    else if (key === 'out') args.out = value;
    else if (key === 'aoi') args.aoi = value;
  }
  return args;
}

/**
 * The same world origin the scene computes.
 *
 * Read from the generated terrain descriptor rather than restated, because the wind derivation
 * works in world metres and a different origin would be a different — silently wrong — answer.
 */
function worldOriginFor(aoi: string): WorldOrigin {
  const path = join(ROOT, 'public', 'terrain', aoi, 'heightmap_4m.json');
  if (!existsSync(path)) {
    throw new Error(
      `no terrain for '${aoi}' — run tools/geodata/pipeline.py first, since the flight tables are ` +
        `projected into the same metres the terrain uses`
    );
  }
  const meta = JSON.parse(readFileSync(path, 'utf8'));
  return {
    centreEasting: meta.origin.easting + (meta.width * meta.resolutionM) / 2,
    centreNorthing: meta.origin.northing + (meta.height * meta.resolutionM) / 2,
  };
}

/** RFC 4180 enough for the Fabric Load Table API: quote anything with a comma or a quote. */
function csv(rows: (string | number | null)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell === null || cell === undefined) return '';
          const text = String(cell);
          return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
        })
        .join(',')
    )
    .join('\n');
}

/** ISO instant for a fix, from the flight's date and the fix's seconds since UTC midnight. */
function instant(date: string, seconds: number): string {
  const base = Date.parse(`${date}T00:00:00Z`);
  return new Date(base + seconds * 1000).toISOString().replace('.000Z', 'Z');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const origin = worldOriginFor(args.aoi);
  const flightsDir = join(ROOT, args.flights);
  const outDir = join(ROOT, args.out);
  mkdirSync(outDir, { recursive: true });

  const files = readdirSync(flightsDir).filter((f) => f.toLowerCase().endsWith('.igc'));
  if (files.length === 0) throw new Error(`no IGC files in ${flightsDir}`);

  const fixRows: (string | number | null)[][] = [
    ['flight_id', 'ts', 't_s', 'lat', 'lon', 'alt_m', 'vario_ms', 'ground_ms'],
  ];
  const summaryRows: (string | number | null)[][] = [
    [
      'flight_id', 'aoi', 'flight_date', 'fixes', 'duration_s', 'alt_min_m', 'alt_max_m',
      'height_gain_m', 'vario_max_ms', 'vario_min_ms', 'net_distance_m', 'track_distance_m',
      'wind_bands', 'logger',
    ],
  ];
  const windRows: (string | number | null)[][] = [
    ['flight_id', 'band_alt_m', 'speed_ms', 'from_deg', 'samples'],
  ];

  for (const file of files.sort()) {
    const stem = file.replace(/\.igc$/i, '');

    // ⚠️ **AOI-qualified, and deliberately not a bare date.** Two reasons, one of which bit
    // immediately. The Fabric CSV loader infers column types, and a `flight_id` of `2021-04-24`
    // loads as a **dateTime** — while `2021-04-25-03`, which the archive also contains for a second
    // flight on one day, loads as a string. The relationship key would therefore change type as
    // soon as a second flight was curated, and Direct Lake would stop framing with no error. The
    // second reason is plainer: a second AOI ships in phase 7, and an id that is only unique within
    // one valley is not an id.
    const id = `${args.aoi}:${stem}`;
    const parsed = parseIgc(readFileSync(join(flightsDir, file), 'utf8'));

    // ⚠️ PLAN §2.2.3: an IGC is personal location history. The bundled files are anonymised at
    // import, but a file that slipped in unanonymised must not be quietly curated into a
    // warehouse — that is exactly how personal data ends up somewhere nobody remembers putting it.
    if (parsed.identified) {
      console.warn(`  ⚠️ ${file} still carries pilot identification — skipped. Run tools/flights/anonymise_igc.py.`);
      continue;
    }

    const track: FlightTrack = buildTrack(parsed, origin, id);
    const wind = deriveWind(track.points);
    for (const p of track.points) {
      fixRows.push([
        id,
        instant(track.date, parsed.fixes[0].seconds + p.t),
        Math.round(p.t),
        p.lat.toFixed(7),
        p.lon.toFixed(7),
        Math.round(p.altM),
        p.varioMs.toFixed(2),
        p.groundMs.toFixed(2),
      ]);
    }

    for (const band of wind.bands) {
      windRows.push([
        id,
        Math.round(band.altM),
        band.speedMs.toFixed(2),
        Math.round(band.fromDeg),
        band.samples,
      ]);
    }

    summaryRows.push([
      id,
      args.aoi,
      track.date,
      track.points.length,
      Math.round(track.durationS),
      Math.round(track.altMinM),
      Math.round(track.altMaxM),
      Math.round(track.altMaxM - track.altMinM),
      track.varioMaxMs.toFixed(2),
      track.varioMinMs.toFixed(2),
      Math.round(track.netDistanceM),
      Math.round(track.trackDistanceM),
      wind.bands.length,
      parsed.logger,
    ]);

    console.log(
      `  ${stem}: ${track.points.length} fixes · ${Math.round(track.altMaxM)} m ceiling · ` +
        `${(track.trackDistanceM / 1000).toFixed(1)} km · ${wind.bands.length} wind bands`
    );
  }

  writeFileSync(join(outDir, 'flight_fix.csv'), csv(fixRows), 'utf8');
  writeFileSync(join(outDir, 'flight_summary.csv'), csv(summaryRows), 'utf8');
  writeFileSync(join(outDir, 'flight_wind.csv'), csv(windRows), 'utf8');

  console.log(
    `\n${summaryRows.length - 1} flight(s) → ${args.out}\n` +
      `  flight_fix.csv      ${fixRows.length - 1} rows\n` +
      `  flight_summary.csv  ${summaryRows.length - 1} rows\n` +
      `  flight_wind.csv     ${windRows.length - 1} rows`
  );
}

main();
