import { describe, expect, it } from "vitest";
import { coverageOf, greedyMaxCoverage, type CoverageCandidate } from "./optimise";

/** Build a candidate from a string mask: "1101" observes passages 0, 1 and 3. */
function candidate(id: number, mask: string): CoverageCandidate {
  return { id, observes: Uint8Array.from([...mask].map((c) => (c === "1" ? 1 : 0))) };
}

describe("greedyMaxCoverage", () => {
  it("takes the single best candidate when only one may be picked", () => {
    const picks = greedyMaxCoverage([
      candidate(1, "1100"),
      candidate(2, "1110"),
      candidate(3, "0001"),
    ], 4, 1);
    expect(picks).toHaveLength(1);
    expect(picks[0].id).toBe(2);
    expect(picks[0].newlyCovered).toBe(3);
    expect(picks[0].cumulative).toBe(3);
  });

  it("values the second pick by what it ADDS, not by what it covers", () => {
    // 🔴 The whole point. Candidate 2 covers more passages than candidate 3, but everything it
    // covers is already held — so the greedy step must prefer 3.
    const picks = greedyMaxCoverage([
      candidate(1, "1111000"),
      candidate(2, "1110000"),
      candidate(3, "0000110"),
    ], 7, 2);
    expect(picks.map((p) => p.id)).toEqual([1, 3]);
    expect(picks[1].newlyCovered).toBe(2);
    expect(picks[1].cumulative).toBe(6);
  });

  it("stops early rather than recommending a mast that adds nothing", () => {
    const picks = greedyMaxCoverage([
      candidate(1, "1111"),
      candidate(2, "1100"),
      candidate(3, "0011"),
    ], 4, 3);
    // The first pick already covers everything; a second would be a recommendation with no
    // support behind it.
    expect(picks).toHaveLength(1);
    expect(picks[0].cumulative).toBe(4);
  });

  it("returns nothing when no candidate observes anything", () => {
    const picks = greedyMaxCoverage([candidate(1, "000"), candidate(2, "000")], 3, 2);
    expect(picks).toEqual([]);
  });

  it("is reproducible: ties go to the earlier candidate", () => {
    // A recommendation that changes between runs on identical input cannot go in a document.
    const sets = [candidate(7, "1100"), candidate(9, "0011"), candidate(3, "1100")];
    for (let i = 0; i < 5; i += 1) {
      expect(greedyMaxCoverage(sets, 4, 1)[0].id).toBe(7);
    }
  });

  it("never counts a passage twice across picks", () => {
    const picks = greedyMaxCoverage([
      candidate(1, "11110000"),
      candidate(2, "00111100"),
      candidate(3, "00000011"),
    ], 8, 3);
    const sum = picks.reduce((total, p) => total + p.newlyCovered, 0);
    expect(sum).toBe(picks[picks.length - 1].cumulative);
    expect(sum).toBeLessThanOrEqual(8);
  });

  it("does not exceed the requested number of picks", () => {
    const picks = greedyMaxCoverage([
      candidate(1, "10000"), candidate(2, "01000"), candidate(3, "00100"),
      candidate(4, "00010"), candidate(5, "00001"),
    ], 5, 2);
    expect(picks).toHaveLength(2);
    expect(picks[1].cumulative).toBe(2);
  });
});

describe("coverageOf", () => {
  it("counts the union, so a hand-placed network can be scored the same way", () => {
    expect(coverageOf([candidate(1, "1100"), candidate(2, "0110")], 4)).toBe(3);
  });

  it("is zero for an empty network", () => {
    expect(coverageOf([], 5)).toBe(0);
  });
});
