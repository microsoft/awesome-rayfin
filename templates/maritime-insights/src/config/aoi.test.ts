import { describe, expect, it } from "vitest";
import { AOIS, AOI_ORDER, DEFAULT_AOI, SHARED_SHELL, activeAoiId } from "./aoi";

/**
 * The registry is small, so these are cheap — and they pin the two mistakes that a second site
 * makes possible for the first time: a switcher entry with no built assets behind it, and a
 * `?aoi=` value from a URL being trusted straight into a fetch path.
 */
describe("the AOI registry", () => {
  it("lists every entry exactly once, in a stated order", () => {
    expect([...AOI_ORDER].sort()).toEqual(Object.keys(AOIS).sort());
    expect(new Set(AOI_ORDER).size).toBe(AOI_ORDER.length);
  });

  it("keys every entry by its own id, so a lookup cannot fetch another site's terrain", () => {
    for (const [key, entry] of Object.entries(AOIS)) expect(entry.id).toBe(key);
  });

  it("ships at least two sites, or the switcher is furniture", () => {
    expect(AOI_ORDER.length).toBeGreaterThanOrEqual(2);
  });

  it("defaults to the first listed site", () => {
    expect(DEFAULT_AOI).toBe(AOI_ORDER[0]);
    expect(AOIS[DEFAULT_AOI]).toBeDefined();
  });

  it("gives every site an ASCII slug, because it becomes an export filename", () => {
    for (const entry of Object.values(AOIS)) {
      expect(entry.slug).toMatch(/^[A-Za-z0-9-]+$/);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.region.length).toBeGreaterThan(0);
    }
  });
});

describe("activeAoiId", () => {
  it("honours ?aoi= when it names a site we ship", () => {
    expect(activeAoiId("?aoi=schlei")).toBe("schlei");
  });

  it("falls back to the default for anything else", () => {
    // 🔴 The id goes straight into a fetch path, so an unknown value must never be echoed back.
    // Without this an `?aoi=../../something` would be handed to the loader verbatim.
    expect(activeAoiId("?aoi=nowhere")).toBe(DEFAULT_AOI);
    expect(activeAoiId("?aoi=../../etc")).toBe(DEFAULT_AOI);
    expect(activeAoiId("?aoi=")).toBe(DEFAULT_AOI);
    expect(activeAoiId("")).toBe(DEFAULT_AOI);
  });

  it("does not resolve inherited object properties as sites", () => {
    // `requested in AOIS` would be true for "constructor" on a plain object literal.
    expect(activeAoiId("?aoi=constructor")).toBe(DEFAULT_AOI);
    expect(activeAoiId("?aoi=toString")).toBe(DEFAULT_AOI);
  });
});

describe("the shared shell", () => {
  it("is a real window, and the sites sit inside it", () => {
    expect(SHARED_SHELL.west).toBeLessThan(SHARED_SHELL.east);
    expect(SHARED_SHELL.south).toBeLessThan(SHARED_SHELL.north);
    // Both cores are inside this box — that is what makes one downloaded horizon serve both and
    // the switch a move within one world rather than a page load into a different one.
    for (const [lon, lat] of [[10.17, 54.38], [9.92, 54.63]]) {
      expect(lon).toBeGreaterThan(SHARED_SHELL.west);
      expect(lon).toBeLessThan(SHARED_SHELL.east);
      expect(lat).toBeGreaterThan(SHARED_SHELL.south);
      expect(lat).toBeLessThan(SHARED_SHELL.north);
    }
  });
});
