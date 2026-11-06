// Erzeugt von `dwg mockup build` aus assets/mockup/pixelgrid.js im Kitchen-Repo. Nicht von Hand ändern, dort ändern und neu holen.
/* MockupKitchen · Pixelraster (pixelgrid.js), Konzept: KONZEPT-PIXELRASTER.md („Linienraster im Pitch-Raum")
   Reines Rechenmodul ohne DOM und ohne Abhängigkeiten: Zonen (Kopfband, Nav, Filter, Fußleiste), Ränder je Achse,
   Linien als Ganzzahl-Brüche, Kacheln aus Brüchen, Übertragung zwischen Auflösungen, Slicer-Stapel.
   EINE Quelle für MockupKitchen (Browser: <script> vor gridcheck.js und app.js, window.MK_PIXELGRID) und die dwg cli
   im Repo Fabric-Apps-Demo (`dwg mockup build` erzeugt daraus dwg/layout/pixelgrid.mjs als ES-Modul für Generator,
   Fabric App und PBIP). Nicht kopieren und dort ändern, sondern hier ändern und in dwg neu holen.
   Typen: pixelgrid.d.ts. Tests: pixelgrid-test.js (Kitchen), dwg/layout/test.mjs (dwg).

   Regel: k = clamp(W/1280; 0,6; 3,2), R(x) = floor(x + 0,5), Zwischenraum g = R(12·k), Rand m0 = R(18·k).
   Je Achse liegen die Ränder mL ∈ [m0-3; m0+3], mR ∈ {mL; mL+1} so, dass der Schritt P = Zone - mL - mR + g durch
   n (12) teilbar ist; Vorrang P mod 2n = 0, dann symmetrisch, dann nah an m0. Linie L(a/d) = floor((2·a·P + d) / (2·d)),
   ganzzahlig (BigInt). Kachel über a..b: x = content.x + L(a), w = L(b) - L(a) - g. Gleicher Bruch heißt gleiches
   Pixel, jeder Zwischenraum ist genau g, die äußeren Kacheln sind bündig mit dem Inhaltsrand.

   Ohne Raster (opts.legacy) liefert zones() byte-gleich die Zonen von MockupKitchen bis 0.6.2 (fester Rand). */
(function (root) {
  'use strict';

  /** Basismaße bei 1280 px Breite (k = 1) */
  const SPACING = { margin: 18, gutter: 12 };
  /** Chrome wie MockupKitchen defaultState: Kopf 56, Filter rechts 200, Fuß 24, Navigation aus */
  const MOCKUP_CHROME = {
    header: { on: true, h: 56 },
    nav: { on: false, w: 64 },
    filter: { on: true, side: 'right', w: 200, topH: 56 },
    footer: { on: true, h: 24 },
  };
  /** Chrome der dwg-Shell (Fabric App, PBIP): Kopf höher für Seitentitel und Erklärtext, Filter-Panel links */
  const DWG_CHROME = {
    header: { on: true, h: 64 },
    nav: { on: false, w: 64 },
    filter: { on: true, side: 'left', w: 200, topH: 56 },
    footer: { on: true, h: 24 },
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  /** Rundung wie im Konzept (nicht Python-round, nicht Bankers Rounding) */
  const R = x => Math.floor(x + 0.5);
  /** Skalierungsfaktor der Canvas-Breite */
  const kOf = width => clamp(width / 1280, 0.6, 3.2);

  // ---- Brüche (BigInt, gekürzt) ----------------------------------------------
  const big = v => (typeof v === 'bigint' ? v : BigInt(v));
  const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { const t = a % b; a = b; b = t; } return a || 1n; };
  function frac(n, d) { n = big(n); d = big(d === undefined ? 1 : d); if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d); return { n: n / g, d: d / g }; }
  const fAdd = (a, b) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
  const fSub = (a, b) => frac(a.n * b.d - b.n * a.d, a.d * b.d);
  const fMulInt = (a, num, den) => frac(a.n * big(num), a.d * big(den));
  const asFrac = f => (Array.isArray(f) ? frac(f[0], f[1]) : (f && typeof f === 'object' ? frac(f.n, f.d) : frac(f, 1)));
  const isInt = v => typeof v === 'bigint' || Number.isInteger(v);

  /** Linie als Ganzzahl-Bruch: L(num/den) = floor((2·num·P + den) / (2·den)); exakt auch bei großen Nennern */
  function line(num, den, P) {
    if (!(isInt(num) && isInt(den) && isInt(P))) return Math.floor((2 * num * P + den) / (2 * den));   // Kommazahlen: wie bisher
    const N = big(num), D = big(den), p = big(P);
    let a = 2n * N * p + D, b = 2n * D;
    if (b < 0n) { a = -a; b = -b; }
    let q = a / b; if (a % b !== 0n && a < 0n) q -= 1n;   // floor auch für negative Werte
    return Number(q);
  }
  const lineF = (f, P) => line(f.n, f.d, P);

  /** Ränder einer Achse über der Zonenlänge span. @returns {mL, mR, P}, P = span - mL - mR + g, durch n teilbar */
  function solveMargins(span, m0, g, n) {
    n = n || 12;
    let best = null;
    for (let mL = Math.max(0, m0 - 3); mL <= m0 + 3; mL++) {
      for (const mR of [mL, mL + 1]) {
        const P = span - mL - mR + g;
        if (P <= 0 || P % n !== 0) continue;
        const rank = [P % (2 * n) === 0 ? 0 : 1, mL === mR ? 0 : 1, Math.abs(mL - m0) + Math.abs(mR - m0)];
        const i = best ? rank.findIndex((v, j) => v !== best.rank[j]) : -1;
        if (!best || (i >= 0 && rank[i] < best.rank[i])) best = { mL, mR, P, rank };
      }
    }
    // ohne Lösung (Rand unter 3 px): fester Rand, der Rest bleibt im Schritt (±1 px)
    return best ? { mL: best.mL, mR: best.mR, P: best.P } : { mL: m0, mR: m0, P: span - 2 * m0 + g };
  }

  const box = (x, y, w, h) => ({ x, y, w, h });

  /**
   * Raster einer Fläche (nach Kopf, Fuß, Filter und Nav, ohne Rand).
   * @returns {k, g, m0, n, area, margins, pitch, content, exact}
   */
  function lattice(area, k, opts) {
    const o = opts || {}, n = o.n || 12;
    const g = R((o.gutter == null ? SPACING.gutter : o.gutter) * k), m0 = R((o.margin == null ? SPACING.margin : o.margin) * k);
    const mx = solveMargins(area.w, m0, g, n), my = solveMargins(area.h, m0, g, n);
    return {
      k, g, m0, n, area,
      margins: { l: mx.mL, r: mx.mR, t: my.mL, b: my.mR },
      pitch: { x: mx.P, y: my.P },
      content: box(area.x + mx.mL, area.y + my.mL, area.w - mx.mL - mx.mR, area.h - my.mL - my.mR),
      exact: mx.P % n === 0 && my.P % n === 0,
    };
  }

  /**
   * Zonen einer Canvas wie MockupKitchen zones(): Navigation links über die volle Höhe, Kopfband und Fußleiste rechts
   * davon, Filter rechts, links oder oben (burger: keine Zone), dazwischen der Inhalt mit Rändern nach dem Raster.
   * chrome mit Basismaßen bei 1280 px; Teile ohne on gelten als aus.
   * @param opts { margin, gutter, n } Basiswerte; { legacy: true, margin } = fester Rand wie MockupKitchen bis 0.6.2
   * @returns Raster: { k, g, m0, n, nav?, header?, footer?, filter?, area, margins, pitch, content, exact }
   *          legacy: { nav?, header?, footer?, filter?, area, content }
   */
  function zones(canvas, chrome, opts) {
    const o = opts || {}, c = chrome === undefined ? MOCKUP_CHROME : (chrome || {});
    const w = canvas.w, h = canvas.h, k = kOf(w);
    const on = part => !!(c[part] && c[part].on);
    let top = 0, bottom = h, left = 0, right = w; const z = {};
    if (on('nav')) { const nw = R(c.nav.w * k); z.nav = box(0, 0, nw, h); left = nw; }
    if (on('header')) { const hh = R(c.header.h * k); z.header = box(left, 0, w - left, hh); top = hh; }
    if (on('footer')) { const fh = R(c.footer.h * k); z.footer = box(left, h - fh, w - left, fh); bottom = h - fh; }
    if (on('filter')) {
      const f = c.filter;
      if (f.side === 'right') { const fw = R(f.w * k); z.filter = box(w - fw, top, fw, bottom - top); right = w - fw; }
      else if (f.side === 'left') { const fw = R(f.w * k); z.filter = box(left, top, fw, bottom - top); left += fw; }
      else if (f.side === 'top') { const fh = R((f.topH || 56) * k); z.filter = box(left, top, right - left, fh); top += fh; }
      // burger: keine Zone, Button im Kopfband; Panel entsteht per Lesezeichen
    }
    z.area = box(left, top, right - left, bottom - top);
    if (o.legacy) {
      const m = R((o.margin || 0) * k);
      z.content = box(left + m, top + m, Math.max(40, right - left - 2 * m), Math.max(40, bottom - top - 2 * m));
      return z;
    }
    const L = lattice(z.area, k, o);
    return Object.assign({ k: L.k, g: L.g, m0: L.m0, n: L.n }, z, { margins: L.margins, pitch: L.pitch, content: L.content, exact: L.exact });
  }

  /** Kachel über die Spalten a..b und Zeilen c..d (Brüche mit Nenner den, Standard z.n). @returns [x, y, Breite, Höhe] */
  function place(z, a, b, c, d, den) {
    den = den || z.n;
    const cx = z.content.x, cy = z.content.y;
    const x0 = cx + line(a, den, z.pitch.x), x1 = cx + line(b, den, z.pitch.x);
    const y0 = cy + line(c, den, z.pitch.y), y1 = cy + line(d, den, z.pitch.y);
    return [x0, y0, x1 - x0 - z.g, y1 - y0 - z.g];
  }
  /** Wie place, aber mit beliebigen Brüchen je Kante ([Zähler, Nenner], Zahl oder {n, d}). @returns {x, y, w, h} */
  function placeFrac(z, x0, x1, y0, y1) {
    const c = z.content, g = z.g;
    const ax = lineF(asFrac(x0), z.pitch.x), bx = lineF(asFrac(x1), z.pitch.x), ay = lineF(asFrac(y0), z.pitch.y), by = lineF(asFrac(y1), z.pitch.y);
    return { x: c.x + ax, y: c.y + ay, w: bx - ax - g, h: by - ay - g };
  }

  /** Gewichteter Split (Konzept 2b): Gewichte („Kachel plus ein Zwischenraum") über [from; to]. @returns je Kind [Anfang, Ende] */
  function spans(weights, from, to) {
    from = from == null ? 0 : from; to = to == null ? 1 : to;
    const S = weights.reduce((s, v) => s + v, 0);
    let acc = 0;
    return weights.map(wt => { const a = from + (to - from) * acc / S; acc += wt; return [a, from + (to - from) * acc / S]; });
  }

  /** Lage eines Rechtecks im Raster (Zellen a..b, c..d mit Nenner den), wenn alle vier Kanten auf Linien liegen, sonst null */
  function cellOf(z, rect, den) {
    den = den || z.n;
    const x = rect[0], y = rect[1], w = rect[2], h = rect[3];
    const find = (pos, origin, P) => { for (let i = 0; i <= den; i++) { if (origin + line(i, den, P) === pos) return i; } return -1; };
    const a = find(x, z.content.x, z.pitch.x), b = find(x + w + z.g, z.content.x, z.pitch.x);
    const c = find(y, z.content.y, z.pitch.y), d = find(y + h + z.g, z.content.y, z.pitch.y);
    return [a, b, c, d].some(v => v < 0) ? null : { a, b, c, d, den };
  }

  /** Rechteck aus einer Canvas in eine andere: über das Raster, wenn es darauf liegt (pixelgenau), sonst proportional */
  function transfer(rect, from, to) {
    for (const den of [from.n, 2 * from.n]) {
      const cell = cellOf(from, rect, den);
      if (cell) return place(to, cell.a, cell.b, cell.c, cell.d, den);
    }
    const x = rect[0], y = rect[1], w = rect[2], h = rect[3];
    const sx = to.content.w / from.content.w, sy = to.content.h / from.content.h;
    return [R(to.content.x + (x - from.content.x) * sx), R(to.content.y + (y - from.content.y) * sy), R(w * sx), R(h * sy)];
  }

  /** Slicer-Stapel im Filter-Panel: Einzug gleich Rand, Abstand g, Oberkante auf content.y, Höhe R(52·k) */
  function slicerStack(z, count, height) {
    const f = z.filter || z.area, h = R((height || 52) * z.k);
    return Array.from({ length: count }, (_, i) => [f.x + z.m0, z.content.y + i * (h + z.g), f.w - 2 * z.m0, h]);
  }

  /** Liegt das Rechteck ganz im Inhaltsbereich? */
  function inside(z, rect) {
    const c = z.content;
    return rect[0] >= c.x && rect[1] >= c.y && rect[0] + rect[2] <= c.x + c.w && rect[1] + rect[3] <= c.y + c.h;
  }

  // Gewichte als ganze Zahlen („Kachel plus ein Zwischenraum"); Kommazahlen aus dem freien Ziehen auf 1/1000 genau
  function intWeights(arr) {
    const list = (arr || []).map(v => (Number.isFinite(v) && v > 0 ? v : 0));
    const ints = list.every(v => Number.isInteger(v)) ? list : list.map(v => Math.round(v * 1000));
    const out = ints.map(v => BigInt(v));
    return out.some(v => v > 0n) ? out : out.map(() => 1n);
  }
  function bounds(weights, a, b) {
    // Grenzen C(0..n) über [a; b]: a + (b - a)·C(i)/S
    const S = weights.reduce((s, v) => s + v, 0n), d = fSub(b, a); let acc = 0n; const out = [a];
    weights.forEach(v => { acc += v; out.push(fAdd(a, fMulInt(d, acc, S))); });
    return out;
  }

  /**
   * Rechtecke eines Layoutbaums im Raster (split/grid/leaf wie MockupKitchen), gleiche Form wie layoutRects() in app.js:
   * leaves [{node, rect, cell}] und gutters (Zwischenräume zum Ziehen). cell = Brüche der Kachel im Pitch-Raum.
   */
  function layout(tree, z) {
    const out = { leaves: [], gutters: [] }, g = z.g, c = z.content;
    const Lx = f => c.x + lineF(f, z.pitch.x), Ly = f => c.y + lineF(f, z.pitch.y);
    const fs = f => [Number(f.n), Number(f.d)];
    function walk(node, x0, x1, y0, y1) {
      if (!node) return;
      if (node.type === 'leaf' || !node.children) {
        const r = placeFrac(z, x0, x1, y0, y1);
        out.leaves.push({ node, rect: { x: r.x, y: r.y, w: Math.max(8, r.w), h: Math.max(8, r.h) }, cell: { x: [fs(x0), fs(x1)], y: [fs(y0), fs(y1)] } });
        return;
      }
      if (node.type === 'grid') {
        const X = bounds(intWeights(node.cols), x0, x1), Y = bounds(intWeights(node.rows), y0, y1);
        const nc = X.length - 1, nr = Y.length - 1;
        const cx0 = cl => X[Math.min(nc, cl.c)], cx1 = cl => X[Math.min(nc, cl.c + cl.cs)];
        const cy0 = cl => Y[Math.min(nr, cl.r)], cy1 = cl => Y[Math.min(nr, cl.r + cl.rs)];
        node.children.forEach(cl => walk(cl.node, cx0(cl), cx1(cl), cy0(cl), cy1(cl)));
        node.children.forEach(A => node.children.forEach(B => {
          if (A.c + A.cs === B.c) { const t0 = Math.max(Ly(cy0(A)), Ly(cy0(B))), t1 = Math.min(Ly(cy1(A)), Ly(cy1(B))) - g; if (t1 > t0) out.gutters.push({ grid: node, axis: 'col', boundary: B.c, cells: [A, B], dir: 'row', rect: { x: Lx(cx0(B)) - g, y: t0, w: g, h: t1 - t0 } }); }
          if (A.r + A.rs === B.r) { const t0 = Math.max(Lx(cx0(A)), Lx(cx0(B))), t1 = Math.min(Lx(cx1(A)), Lx(cx1(B))) - g; if (t1 > t0) out.gutters.push({ grid: node, axis: 'row', boundary: B.r, cells: [A, B], dir: 'col', rect: { x: t0, y: Ly(cy0(B)) - g, w: t1 - t0, h: g } }); }
        }));
        return;
      }
      const row = node.dir === 'row';
      const B = bounds(intWeights(node.children.map(ch => ch.size)), row ? x0 : y0, row ? x1 : y1);
      node.children.forEach((ch, i) => {
        if (row) walk(ch.node, B[i], B[i + 1], y0, y1); else walk(ch.node, x0, x1, B[i], B[i + 1]);
        if (i < node.children.length - 1) {
          const rect = row
            ? { x: Lx(B[i + 1]) - g, y: Ly(y0), w: g, h: Ly(y1) - Ly(y0) - g }
            : { x: Lx(x0), y: Ly(B[i + 1]) - g, w: Lx(x1) - Lx(x0) - g, h: g };
          out.gutters.push({ parent: node, index: i, dir: node.dir, rect });
        }
      });
    }
    walk(tree, frac(0), frac(1), frac(0), frac(1));
    return out;
  }

  /** Linienpositionen einer Achse (linke bzw. obere Kanten) für 1/n und 1/2n, aufsteigend */
  function lines(z, axis) {
    const P = z.pitch[axis], start = z.content[axis], set = new Set();
    [z.n, 2 * z.n].forEach(n => { for (let j = 0; j <= n; j++) set.add(start + line(j, n, P)); });
    return Array.from(set).sort((a, b) => a - b);
  }

  /** Block für die Spec (canvas.pixel), wie im Konzept Abschnitt 5 */
  function pixelBlock(z) {
    return { mode: 'lattice', n: z.n, pitchX: z.pitch.x / z.n, pitchY: z.pitch.y / z.n, gutter: z.g, margins: Object.assign({}, z.margins), exact: z.exact };
  }

  const api = { SPACING, MOCKUP_CHROME, DWG_CHROME, R, clamp, kOf, frac, line, solveMargins, lattice, zones, place, placeFrac, spans, cellOf, transfer, slicerStack, inside, layout, lines, pixelBlock };
  // (CommonJS-Export entfällt im ES-Modul, siehe unten)
  root.MK_PIXELGRID = api;
})(typeof window !== 'undefined' ? window : globalThis);

// ---- ES-Modul (dwg mockup build) ----
const MK_PIXELGRID = (typeof window !== 'undefined' ? window : globalThis).MK_PIXELGRID;
export const { SPACING, MOCKUP_CHROME, DWG_CHROME, R, clamp, kOf, frac, line, solveMargins, lattice, zones, place, placeFrac, spans, cellOf, transfer, slicerStack, inside, layout, lines, pixelBlock } = MK_PIXELGRID;
export default MK_PIXELGRID;
