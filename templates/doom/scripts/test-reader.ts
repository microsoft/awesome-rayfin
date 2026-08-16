/**
 * Offline self-test for the intermission reader.
 *
 * Synthesises a 640x400 (2x) DOOM "FINISHED" screen by drawing the WAD glyphs at
 * the exact positions DOOM's WI_stuff.c uses, then checks readStatsFrame() decodes
 * them. The reader SCANS for the glyphs (it does not hard-code these positions),
 * so this validates matching, digit assembly, level detection and time parsing.
 *
 * Run:  npx tsx scripts/test-reader.ts
 */
import { readStatsFrame } from '../src/game/doomStats';
import { GLYPHS, PALETTE, type Glyph } from '../src/game/doomGlyphs';

const DW = 320;
const CW = 640;
const CH = 400;
const SCALE = 2;

const buf = new Uint8ClampedArray(CW * CH * 4);
// Fill with a brown-ish map background (distinct from the bright-red font).
for (let i = 0; i < buf.length; i += 4) {
  buf[i] = 70;
  buf[i + 1] = 50;
  buf[i + 2] = 34;
  buf[i + 3] = 255;
}

function setPx(sx: number, sy: number, r: number, g: number, b: number) {
  for (let yy = 0; yy < SCALE; yy++) {
    for (let xx = 0; xx < SCALE; xx++) {
      const cx = sx * SCALE + xx;
      const cy = sy * SCALE + yy;
      if (cx < 0 || cy < 0 || cx >= CW || cy >= CH) continue;
      const o = (cy * CW + cx) * 4;
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
      buf[o + 3] = 255;
    }
  }
}

function drawPatch(g: Glyph, x: number, y: number) {
  const p = g.px;
  for (let i = 0; i < p.length; i += 3) {
    const sx = x - g.xoff + p[i];
    const sy = y - g.yoff + p[i + 1];
    const idx = p[i + 2];
    setPx(sx, sy, PALETTE[idx * 3], PALETTE[idx * 3 + 1], PALETTE[idx * 3 + 2]);
  }
}

const FONTW = GLYPHS.WINUM0.w;

function drawNum(x: number, y: number, n: number, digits: number): number {
  if (digits < 0) digits = n ? Math.floor(Math.log10(n)) + 1 : 1;
  while (digits-- > 0) {
    x -= FONTW;
    drawPatch(GLYPHS[`WINUM${n % 10}`], x, y);
    n = Math.floor(n / 10);
  }
  return x;
}

function drawPercent(x: number, y: number, p: number) {
  drawPatch(GLYPHS.WIPCNT, x, y);
  drawNum(x, y, p, -1);
}

function drawTime(x: number, y: number, t: number) {
  let div = 1;
  do {
    const n = Math.floor(t / div) % 60;
    x = drawNum(x, y, n, 2) - GLYPHS.WICOLON.w;
    div *= 60;
    if (div === 60 || Math.floor(t / div)) drawPatch(GLYPHS.WICOLON, x, y);
  } while (Math.floor(t / div));
}

// --- Draw a fake "E1M3 FINISHED" screen: 83% / 10% / 0%, time 02:16 ------------
const banner = GLYPHS.WILV02; // E1M3
drawPatch(banner, Math.floor((DW - banner.w) / 2), 2);

drawPercent(DW - 50, 50, 83); // kills
drawPercent(DW - 50, 68, 10); // items
drawPercent(DW - 50, 86, 0); // secret

drawTime(DW / 2 - 16, 200 - 32, 136); // 2:16

const img = { data: buf, width: CW, height: CH } as ImageData;
const result = readStatsFrame(img);

const expected = { episode: 1, map: 3, kills: 83, items: 10, secrets: 0, timeSeconds: 136 };
console.log('expected:', expected);
console.log('got:     ', result);

let ok = !!result;
if (result) {
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (result[key] !== expected[key]) {
      ok = false;
      console.error(`  MISMATCH ${key}: got ${result[key]}, expected ${expected[key]}`);
    }
  }
}
console.log(ok ? '\n✅ PASS' : '\n❌ FAIL');
process.exit(ok ? 0 : 1);
