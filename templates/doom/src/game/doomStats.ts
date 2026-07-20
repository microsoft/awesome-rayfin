import { GLYPHS, PALETTE, type Glyph } from './doomGlyphs';

/**
 * Reads DOOM's level-completion ("FINISHED") intermission screen straight off
 * the game canvas.
 *
 * DOSBox is a black box, so the only way to capture DOOM's per-level stats
 * (kills/items/secrets %, time, which level) is to recognise them on screen.
 * The js-dos canvas renders DOOM's 320x200 framebuffer at an exact integer
 * scale with nearest-neighbour scaling, so we can template-match the game's own
 * number font (extracted from the WAD, see scripts/extract-glyphs.py) pixel- and
 * colour-exactly against fixed screen positions taken from DOOM's WI_stuff.c.
 */

export type LevelResult = {
  episode: number;
  map: number;
  /** 0-100, or -1 if unread */
  kills: number;
  items: number;
  secrets: number;
  /** completion time in seconds, or -1 if unread */
  timeSeconds: number;
};

const DIGITS: Glyph[] = Array.from({ length: 10 }, (_, i) => GLYPHS[`WINUM${i}`]);
const PCT = GLYPHS.WIPCNT;
const COLON = GLYPHS.WICOLON;
const BANNERS: Glyph[] = Array.from({ length: 9 }, (_, i) => GLYPHS[`WILV0${i}`]);

// DOOM logical screen size.
const DW = 320;

// WI_stuff.c geometry (single-player stats screen).
const STAT_RIGHT = DW - 50; // WI_drawPercent anchor x (right edge of the number)
const STAT_Y0 = 50; // kills row; items/secret follow at +18, +36
const FONTW = 11; // num[0]->width — digit advance
const TITLE_Y = 2; // WI_TITLEY — level-name banner top
const TIME_Y = 200 - 32; // SP_TIMEY

// Per-channel colour tolerance (absorbs any DOSBox gamma; rendering is otherwise
// palette-exact because scaling is nearest-neighbour).
const TOL = 40;

function paletteRGB(idx: number): [number, number, number] {
  return [PALETTE[idx * 3], PALETTE[idx * 3 + 1], PALETTE[idx * 3 + 2]];
}

/**
 * Score a glyph drawn at DOOM DrawPatch-anchor (gx, gy) against the canvas.
 * Returns the fraction of the glyph's opaque pixels whose canvas colour matches.
 */
function scoreGlyph(
  data: Uint8ClampedArray,
  cw: number,
  ch: number,
  sx: number,
  sy: number,
  glyph: Glyph,
  gx: number,
  gy: number
): number {
  const p = glyph.px;
  const total = p.length / 3;
  if (total === 0) return 0;
  let ok = 0;
  for (let i = 0; i < p.length; i += 3) {
    const screenX = gx - glyph.xoff + p[i];
    const screenY = gy - glyph.yoff + p[i + 1];
    const cx = ((screenX + 0.5) * sx) | 0;
    const cy = ((screenY + 0.5) * sy) | 0;
    if (cx < 0 || cy < 0 || cx >= cw || cy >= ch) continue;
    const o = (cy * cw + cx) * 4;
    const [r, g, b] = paletteRGB(p[i + 2]);
    if (
      Math.abs(data[o] - r) <= TOL &&
      Math.abs(data[o + 1] - g) <= TOL &&
      Math.abs(data[o + 2] - b) <= TOL
    ) {
      ok++;
    }
  }
  return ok / total;
}

/** Best-matching digit 0-9 at anchor (gx, gy), or -1. */
function readDigit(
  data: Uint8ClampedArray,
  cw: number,
  ch: number,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  threshold = 0.85
): number {
  let best = -1;
  let bestScore = threshold;
  for (let d = 0; d < 10; d++) {
    const s = scoreGlyph(data, cw, ch, sx, sy, DIGITS[d], gx, gy);
    if (s > bestScore) {
      bestScore = s;
      best = d;
    }
  }
  return best;
}

/** Read the variable-length number drawn to the LEFT of a percent sign at rightX. */
function readPercentValue(
  data: Uint8ClampedArray,
  cw: number,
  ch: number,
  sx: number,
  sy: number,
  rightX: number,
  y: number
): number {
  let value = 0;
  let mult = 1;
  let x = rightX - FONTW;
  for (let k = 0; k < 3; k++) {
    const d = readDigit(data, cw, ch, sx, sy, x, y);
    if (d < 0) break;
    value += d * mult;
    mult *= 10;
    x -= FONTW;
  }
  return value;
}

/**
 * Locate the three percent signs on the stats screen (kills/items/secret),
 * top-to-bottom. Returns their anchor positions, or null if this isn't the
 * stats screen.
 */
function findPercents(
  data: Uint8ClampedArray,
  cw: number,
  ch: number,
  sx: number,
  sy: number
): Array<{ x: number; y: number }> | null {
  const hits: Array<{ x: number; y: number }> = [];
  for (let y = STAT_Y0 - 6; y <= STAT_Y0 + 42; y++) {
    let hitX = -1;
    for (let x = STAT_RIGHT - 16; x <= STAT_RIGHT + 12 && hitX < 0; x++) {
      if (scoreGlyph(data, cw, ch, sx, sy, PCT, x, y) >= 0.85) hitX = x;
    }
    if (hitX >= 0) {
      // de-dupe adjacent y hits (glyph is 12px tall)
      if (hits.length === 0 || y - hits[hits.length - 1].y > 6) hits.push({ x: hitX, y });
    }
  }
  return hits.length === 3 ? hits : null;
}

/** Which E1 level banner is shown at the top, or -1. Returns 0-based map index. */
function detectMap(
  data: Uint8ClampedArray,
  cw: number,
  ch: number,
  sx: number,
  sy: number
): number {
  for (let i = 0; i < BANNERS.length; i++) {
    const g = BANNERS[i];
    if (!g) continue;
    const cx = Math.floor((DW - g.w) / 2);
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (scoreGlyph(data, cw, ch, sx, sy, g, cx + dx, TITLE_Y + dy) >= 0.9) return i;
      }
    }
  }
  return -1;
}

/** Read MM:SS completion time in seconds, or -1. */
function readTime(
  data: Uint8ClampedArray,
  cw: number,
  ch: number,
  sx: number,
  sy: number
): number {
  for (let gy = TIME_Y - 4; gy <= TIME_Y + 4; gy++) {
    for (let gx = 90; gx <= 150; gx++) {
      if (scoreGlyph(data, cw, ch, sx, sy, COLON, gx, gy) >= 0.85) {
        const secTens = readDigit(data, cw, ch, sx, sy, gx + 5, gy);
        const secUnits = readDigit(data, cw, ch, sx, sy, gx + 16, gy);
        if (secTens < 0 || secUnits < 0) return -1;
        const minUnits = readDigit(data, cw, ch, sx, sy, gx - 11, gy);
        const minTens = readDigit(data, cw, ch, sx, sy, gx - 22, gy);
        const seconds = secTens * 10 + secUnits;
        const minutes = Math.max(0, minTens) * 10 + Math.max(0, minUnits);
        return minutes * 60 + seconds;
      }
    }
  }
  return -1;
}

/**
 * Try to read a complete FINISHED stats screen from an ImageData frame.
 * Returns null when the frame isn't the stats screen (or isn't readable yet).
 */
export function readStatsFrame(img: ImageData): LevelResult | null {
  const { data, width: cw, height: ch } = img;
  const sx = cw / DW;
  const sy = ch / 200;

  const rows = findPercents(data, cw, ch, sx, sy);
  if (!rows) return null;

  const [k, it, sec] = rows;
  const kills = readPercentValue(data, cw, ch, sx, sy, k.x, k.y);
  const items = readPercentValue(data, cw, ch, sx, sy, it.x, it.y);
  const secrets = readPercentValue(data, cw, ch, sx, sy, sec.x, sec.y);

  const mapIdx = detectMap(data, cw, ch, sx, sy);
  const timeSeconds = readTime(data, cw, ch, sx, sy);

  return {
    episode: 1,
    map: mapIdx >= 0 ? mapIdx + 1 : -1,
    kills,
    items,
    secrets,
    timeSeconds,
  };
}

function sameResult(a: LevelResult, b: LevelResult): boolean {
  return (
    a.map === b.map &&
    a.kills === b.kills &&
    a.items === b.items &&
    a.secrets === b.secrets &&
    a.timeSeconds === b.timeSeconds
  );
}

export type StatsWatcher = { stop: () => void };

/**
 * Poll the DOOM canvas and fire `onLevelComplete` once per level, after the
 * animated count-up has settled (two consecutive identical reads).
 */
export function watchDoomStats(opts: {
  getCanvas: () => HTMLCanvasElement | null;
  onLevelComplete: (r: LevelResult) => void;
  intervalMs?: number;
}): StatsWatcher {
  const interval = opts.intervalMs ?? 600;
  let lastRead: LevelResult | null = null;
  let firedThisScreen = false;
  let scratch: HTMLCanvasElement | null = null;

  const tick = () => {
    const canvas = opts.getCanvas();
    if (!canvas || !canvas.width || !canvas.height) return;

    let img: ImageData;
    try {
      // js-dos uses a software (2D) surface, so we can read it directly; fall
      // back to a scratch copy if the live context isn't 2D-readable.
      const ctx = canvas.getContext('2d');
      if (ctx) {
        img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } else {
        if (!scratch) scratch = document.createElement('canvas');
        scratch.width = canvas.width;
        scratch.height = canvas.height;
        const sctx = scratch.getContext('2d');
        if (!sctx) return;
        sctx.drawImage(canvas, 0, 0);
        img = sctx.getImageData(0, 0, canvas.width, canvas.height);
      }
    } catch {
      return;
    }

    const result = readStatsFrame(img);
    if (!result) {
      // Not on the stats screen — arm the next completion.
      lastRead = null;
      firedThisScreen = false;
      return;
    }

    if (lastRead && sameResult(lastRead, result)) {
      // Stable (count-up finished).
      if (!firedThisScreen && result.map > 0) {
        firedThisScreen = true;
        opts.onLevelComplete(result);
      }
    } else {
      lastRead = result;
    }
  };

  const id = window.setInterval(tick, interval);

  // Debug hook: lets us query the reader against the current frame at runtime.
  (window as unknown as { __doomReadStatsNow?: () => unknown }).__doomReadStatsNow = () => {
    const canvas = opts.getCanvas();
    if (!canvas) return { error: 'no canvas' };
    const ctx = canvas.getContext('2d');
    if (!ctx) return { error: 'no 2d ctx' };
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { size: [canvas.width, canvas.height], result: readStatsFrame(img) };
  };

  return {
    stop: () => window.clearInterval(id),
  };
}
