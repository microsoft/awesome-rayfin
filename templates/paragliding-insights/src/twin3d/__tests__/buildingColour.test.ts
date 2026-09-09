import { describe, expect, it } from 'vitest';

import {
  buildColourAttribute,
  plausiblePayload,
  SPAN_STRIDE,
  WALL_TIMBER,
  WALL_WHITEWASH,
  type Lod2Meta,
} from '../buildings';

/**
 * Every building wearing its own roof — PLAN §5.11.
 *
 * The pipeline measures each roof from the orthophoto and ships four bytes per building; the
 * client expands them across that building's vertices, using the CityGML roof/wall split to decide
 * which faces are roof. Three things can go wrong there and not one of them throws:
 *
 *   * the split lands one vertex out and a wall wears roof colour,
 *   * the byte order and the `buildings` order drift apart and every house gets its neighbour's
 *     roof — plausible, confident and wrong,
 *   * an older build without the split gets treated as all-roof, smearing one colour over the
 *     walls too.
 *
 * None of that is visible on screen: the valley still looks like a valley. So it is asserted here.
 */

function meta(buildings: Lod2Meta['buildings'], fallback?: [number, number, number]): Pick<Lod2Meta, 'buildings' | 'roofColour'> {
  return {
    buildings,
    roofColour: fallback
      ? { file: 'buildings_colour.bin', measured: 0, total: buildings.length, fallback }
      : undefined,
  };
}

/** rgb + roof flag of one vertex. */
function at(colours: Uint8Array, vertex: number): [number, number, number, number] {
  return [
    colours[vertex * 4],
    colours[vertex * 4 + 1],
    colours[vertex * 4 + 2],
    colours[vertex * 4 + 3],
  ];
}

describe('building colour expansion', () => {
  it('puts roof colour on roof faces and leaves the walls alone', () => {
    // One building, six vertices: three wall, three roof.
    const buildings = [
      { village: 'x', groundElevM: 800, vertexStart: 0, vertexCount: 6, roofVertexStart: 3 },
    ];
    const roofBytes = new Uint8Array([180, 90, 70, 255]);

    const { colours, measured } = buildColourAttribute(meta(buildings), 6, roofBytes);

    expect(measured).toBe(1);
    for (const v of [0, 1, 2]) {
      expect(at(colours, v)[3]).toBe(0);
      // The wall is emphatically not the roof: this is the assertion that catches an off-by-one
      // in the split, which is otherwise invisible.
      expect(at(colours, v).slice(0, 3)).not.toEqual([180, 90, 70]);
    }
    for (const v of [3, 4, 5]) {
      expect(at(colours, v)).toEqual([180, 90, 70, 255]);
    }
  });

  it('gives each building its own roof, not its neighbour’s', () => {
    const buildings = [
      { village: 'a', groundElevM: 800, vertexStart: 0, vertexCount: 4, roofVertexStart: 2 },
      { village: 'b', groundElevM: 800, vertexStart: 4, vertexCount: 4, roofVertexStart: 6 },
    ];
    const roofBytes = new Uint8Array([200, 60, 40, 255, 90, 95, 100, 255]);

    const { colours } = buildColourAttribute(meta(buildings), 8, roofBytes);

    expect(at(colours, 2).slice(0, 3)).toEqual([200, 60, 40]);
    expect(at(colours, 3).slice(0, 3)).toEqual([200, 60, 40]);
    expect(at(colours, 6).slice(0, 3)).toEqual([90, 95, 100]);
    expect(at(colours, 7).slice(0, 3)).toEqual([90, 95, 100]);
  });

  it('falls back without claiming the colour was measured', () => {
    const buildings = [
      { village: 'a', groundElevM: 800, vertexStart: 0, vertexCount: 4, roofVertexStart: 2 },
    ];
    // Flag 0: the sampler could not find enough usable pixels for this one.
    const roofBytes = new Uint8Array([150, 130, 120, 0]);

    const { colours, measured } = buildColourAttribute(meta(buildings), 4, roofBytes);

    // The colour is still used — it is the valley's own median, which is the point of shipping it —
    // but it must not be counted as measured, because that count is what the app reports.
    expect(at(colours, 2).slice(0, 3)).toEqual([150, 130, 120]);
    expect(measured).toBe(0);
  });

  it('survives a build made before roof colour existed', () => {
    const buildings = [
      { village: 'a', groundElevM: 800, vertexStart: 0, vertexCount: 4, roofVertexStart: 2 },
    ];

    const { colours, measured } = buildColourAttribute(meta(buildings, [199, 174, 153]), 4, null);

    expect(measured).toBe(0);
    expect(at(colours, 2).slice(0, 3)).toEqual([199, 174, 153]);
    expect(at(colours, 0)[3]).toBe(0);
  });

  it('refuses to guess which faces are roofs when the split is missing', () => {
    // Metadata from before the pipeline kept the CityGML semantics.
    const buildings = [{ village: 'a', groundElevM: 800, vertexStart: 0, vertexCount: 4 }];
    const roofBytes = new Uint8Array([200, 60, 40, 255]);

    const { colours } = buildColourAttribute(meta(buildings), 4, roofBytes);

    // Everything is wall. Smearing the sampled roof colour over the whole block instead would be
    // the confidently-wrong option.
    for (const v of [0, 1, 2, 3]) {
      expect(at(colours, v)[3]).toBe(0);
      expect(at(colours, v).slice(0, 3)).not.toEqual([200, 60, 40]);
    }
  });

  it('gives the same building the same wall every time', () => {
    const buildings = [
      { village: 'a', groundElevM: 800, vertexStart: 0, vertexCount: 2, roofVertexStart: 2 },
      { village: 'b', groundElevM: 800, vertexStart: 2, vertexCount: 2, roofVertexStart: 4 },
    ];

    const first = buildColourAttribute(meta(buildings), 4, null).colours;
    const second = buildColourAttribute(meta(buildings), 4, null).colours;

    // A random wall colour would shimmer between loads and between the two sites.
    expect(Array.from(first)).toEqual(Array.from(second));
    // Neighbours should not be identical either, or the palette is doing nothing.
    expect(at(first, 0).slice(0, 3)).not.toEqual(at(first, 2).slice(0, 3));
  });
});

/**
 * The measured half of the wall — PLAN §5.11.
 *
 * Wall colour is a convention, but WHICH convention a building gets is measured: the ALKIS
 * function code and the survey's own footprint and height. 48.6 % of Oberstdorf's buildings changed
 * treatment when this replaced the old 11 %-at-random hash, so the mapping is load-bearing.
 */
describe('wall class', () => {
  const two = (aClass: number, bClass: number) => [
    { village: 'a', groundElevM: 800, vertexStart: 0, vertexCount: 2, roofVertexStart: 2, wall: aClass },
    { village: 'b', groundElevM: 800, vertexStart: 2, vertexCount: 2, roofVertexStart: 4, wall: bClass },
  ];

  it('paints a church differently from a shed', () => {
    const { colours } = buildColourAttribute(meta(two(WALL_WHITEWASH, WALL_TIMBER)), 4, null);
    const church = at(colours, 0).slice(0, 3);
    const shed = at(colours, 2).slice(0, 3);

    expect(church).not.toEqual(shed);
    // A whitewashed church is emphatically lighter than a boarded hay barn; if these ever cross,
    // the classes have been swapped somewhere and every village will look wrong in a way that is
    // hard to name and easy to miss.
    const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(luma(church)).toBeGreaterThan(luma(shed) + 60);
  });

  it('treats a build without classes as render rather than guessing', () => {
    const noClass = [
      { village: 'a', groundElevM: 800, vertexStart: 0, vertexCount: 2, roofVertexStart: 2 },
    ];
    const withRender = [
      { village: 'a', groundElevM: 800, vertexStart: 0, vertexCount: 2, roofVertexStart: 2, wall: 0 },
    ];

    expect(Array.from(buildColourAttribute(meta(noClass), 2, null).colours)).toEqual(
      Array.from(buildColourAttribute(meta(withRender), 2, null).colours)
    );
  });
});

/**
 * Per-surface roof material — PLAN §5.11.
 *
 * Most roofs are one material and get nothing; the minority that are two — a copper spire on a
 * tiled nave, a solar array on one pitch — get a span each. The dangerous part is the run length:
 * a span runs until the next span starts, and if that is allowed to cross into the next building
 * it paints somebody else's roof with this building's material.
 */
describe('per-surface roof spans', () => {
  function spanBytes(records: [number, number, number, number][]): Uint8Array {
    const bytes = new Uint8Array(records.length * SPAN_STRIDE);
    const view = new DataView(bytes.buffer);
    records.forEach(([start, r, g, b], i) => {
      view.setUint32(i * SPAN_STRIDE, start, true);
      bytes[i * SPAN_STRIDE + 4] = r;
      bytes[i * SPAN_STRIDE + 5] = g;
      bytes[i * SPAN_STRIDE + 6] = b;
    });
    return bytes;
  }

  it('overpaints only the surface it names', () => {
    const buildings = [
      { village: 'a', groundElevM: 800, vertexStart: 0, vertexCount: 8, roofVertexStart: 2, wall: 0 },
    ];
    const roofBytes = new Uint8Array([200, 60, 40, 255]);
    // A second material starting at vertex 5.
    const spans = spanBytes([[5, 20, 90, 60]]);

    const { colours, surfaces } = buildColourAttribute(meta(buildings), 8, roofBytes, spans);

    expect(surfaces).toBe(1);
    expect(at(colours, 0)[3]).toBe(0); // wall, untouched
    expect(at(colours, 4).slice(0, 3)).toEqual([200, 60, 40]); // roof before the span
    expect(at(colours, 5).slice(0, 3)).toEqual([20, 90, 60]);
    expect(at(colours, 7).slice(0, 3)).toEqual([20, 90, 60]);
  });

  it('never lets a span bleed into the next building', () => {
    const buildings = [
      { village: 'a', groundElevM: 800, vertexStart: 0, vertexCount: 4, roofVertexStart: 2, wall: 0 },
      { village: 'b', groundElevM: 800, vertexStart: 4, vertexCount: 4, roofVertexStart: 6, wall: 0 },
    ];
    const roofBytes = new Uint8Array([200, 60, 40, 255, 90, 95, 100, 255]);
    // One span, in the FIRST building, with no span after it. Unclipped it would run to the end of
    // the buffer and repaint the neighbour's roof with this building's copper.
    const spans = spanBytes([[2, 20, 90, 60]]);

    const { colours } = buildColourAttribute(meta(buildings), 8, roofBytes, spans);

    expect(at(colours, 2).slice(0, 3)).toEqual([20, 90, 60]);
    expect(at(colours, 3).slice(0, 3)).toEqual([20, 90, 60]);
    // The neighbour keeps its own measured roof.
    expect(at(colours, 6).slice(0, 3)).toEqual([90, 95, 100]);
    expect(at(colours, 7).slice(0, 3)).toEqual([90, 95, 100]);
  });

  it('ignores spans when the pipeline has not written any', () => {
    const buildings = [
      { village: 'a', groundElevM: 800, vertexStart: 0, vertexCount: 4, roofVertexStart: 2, wall: 0 },
    ];
    const roofBytes = new Uint8Array([200, 60, 40, 255]);

    const { surfaces } = buildColourAttribute(meta(buildings), 4, roofBytes, null);
    expect(surfaces).toBe(0);
  });

  it('keeps a span that begins exactly on a building boundary', () => {
    // Building b is all roof, so its first roof surface starts at the same vertex where building a
    // ends. Searching for the first building end >= that index instead of > it finds a's end,
    // clips the run to nothing and drops the material without a word.
    const buildings = [
      { village: 'a', groundElevM: 800, vertexStart: 0, vertexCount: 4, roofVertexStart: 2, wall: 0 },
      { village: 'b', groundElevM: 800, vertexStart: 4, vertexCount: 4, roofVertexStart: 4, wall: 0 },
    ];
    const roofBytes = new Uint8Array([200, 60, 40, 255, 90, 95, 100, 255]);
    const spans = spanBytes([[4, 20, 90, 60]]);

    const { colours, surfaces } = buildColourAttribute(meta(buildings), 8, roofBytes, spans);

    expect(surfaces).toBe(1);
    expect(at(colours, 4).slice(0, 3)).toEqual([20, 90, 60]);
    expect(at(colours, 7).slice(0, 3)).toEqual([20, 90, 60]);
    // And building a is untouched by its neighbour's span.
    expect(at(colours, 2).slice(0, 3)).toEqual([200, 60, 40]);
  });
});

/**
 * ⚠️ The single-page fallback returns index.html with HTTP 200 for a file that does not exist, so
 * `response.ok` is not evidence of anything. Found by probing the live deployment, which cheerfully
 * reported a spans file that had never been built.
 */
describe('optional payload validation', () => {
  it('rejects an HTML fallback served in place of a binary', () => {
    const html = new TextEncoder().encode('<!doctype html><html><body>…</body></html>');
    expect(plausiblePayload(html, (n) => n % SPAN_STRIDE === 0)).toBeNull();
  });

  it('rejects a colour file that does not match the building count', () => {
    const bytes = new Uint8Array(4 * 5);
    expect(plausiblePayload(bytes, (n) => n === 6 * 4)).toBeNull();
    expect(plausiblePayload(bytes, (n) => n === 5 * 4)).toBe(bytes);
  });

  it('treats an empty file as absent', () => {
    expect(plausiblePayload(new Uint8Array(0), () => true)).toBeNull();
    expect(plausiblePayload(null, () => true)).toBeNull();
  });
});
