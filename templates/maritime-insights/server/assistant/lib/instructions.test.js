import { describe, expect, it } from "vitest";
import { buildInstructions } from "./instructions.mjs";

const AREA = {
  id: "kieler-foerde",
  date: "2026-07-01",
  trackCount: 261,
  transitCount: 153,
  namedTrackCount: 228,
  los: { includesVegetation: false },
};

/**
 * 🔴 These are guardrail tests, not prose tests.
 *
 * Every rule in PLAN §3.2 is enforced somewhere in code except inside the model, where the only
 * enforcement is the instruction text. If a refactor drops one of these lines the app keeps
 * building, keeps passing every other test, and starts confidently describing radar performance.
 */
describe("assistant instructions", () => {
  const text = buildInstructions(AREA, { aoi: "kieler-foerde", sites: [] });

  it("forbids sensor-performance answers", () => {
    expect(text).toMatch(/NOT a radar model/i);
    expect(text).toMatch(/detection range/i);
    expect(text).toMatch(/probability of detection/i);
  });

  it("forbids inventing numbers and pins coverage to the app's own state", () => {
    expect(text).toMatch(/Never invent a number/i);
    expect(text).toMatch(/get_current_view/);
  });

  it("keeps the two denominators apart", () => {
    // The failure it prevents: dividing an observed-transit count by the 153 total, producing a
    // coverage percentage that is wrong and looks arithmetically sound.
    expect(text).toMatch(/two denominators/i);
    expect(text).toMatch(/never divide a coverage count by/i);
  });

  it("refuses to help find a warship", () => {
    expect(text).toMatch(/[Nn]aval vessels are deliberately pseudonymised/);
    expect(text).toMatch(/decline/i);
  });

  it("states the upper bound when the surface carries no vegetation", () => {
    expect(text).toMatch(/UPPER BOUND/);
  });

  it("does not claim an upper bound when vegetation IS modelled", () => {
    // ⚠️ The caveat has to follow the data. Printing it unconditionally would be the same class of
    // error as the identity notice that outlived the identity rule.
    const withVeg = buildInstructions(
      { ...AREA, los: { includesVegetation: true } }, { aoi: "kieler-foerde" });
    expect(withVeg).not.toMatch(/UPPER BOUND/);
    expect(withVeg).toMatch(/includes terrain, buildings and measured vegetation/);
  });

  it("says a missing vessel name is not anonymisation", () => {
    expect(text).toMatch(/does NOT\s*\n?\s*mean the vessel is unidentifiable|not anonymisation/i);
  });

  it("tells the user how to get coverage when no site is placed", () => {
    expect(text).toMatch(/No sensor site has been placed/);
    expect(text).toMatch(/double-click|optimiser/i);
  });

  it("survives having no data at all rather than inventing a day", () => {
    const empty = buildInstructions(null, null);
    expect(empty).toMatch(/No recorded day is loaded/);
    expect(empty).toMatch(/NOT a radar model/i);
  });
});
