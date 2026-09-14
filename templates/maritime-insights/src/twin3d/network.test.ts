import { describe, expect, it } from "vitest";
import { summariseNetwork } from "./network";

/**
 * These are hand-worked examples, not values read off the implementation. Each mask is written in
 * binary so the expected answer can be counted by eye: bit 0 is site A, bit 1 site B, bit 2 site C.
 */
describe("summariseNetwork", () => {
  it("reports nothing observed for a network with no sites", () => {
    const n = summariseNetwork([0, 0, 0], 0);
    expect(n.passages).toBe(3);
    expect(n.observedPassages).toBe(0);
    expect(n.missedPassages).toBe(3);
    expect(n.passageShare).toBe(0);
    expect(n.perSite).toEqual([]);
  });

  it("counts a passage once however many sites hold it", () => {
    // Both sites see both passages.
    const n = summariseNetwork([0b11, 0b11], 2);
    expect(n.observedPassages).toBe(2);
    expect(n.passageShare).toBe(1);
    // Every passage is held twice, so nothing is a single point of failure.
    expect(n.redundantPassages).toBe(2);
    expect(n.singleCoverPassages).toBe(0);
  });

  it("splits observed passages into redundant and single-cover, exhaustively", () => {
    //       A      A+B     B      none    A+B+C
    const masks = [0b001, 0b011, 0b010, 0b000, 0b111];
    const n = summariseNetwork(masks, 3);
    expect(n.passages).toBe(5);
    expect(n.observedPassages).toBe(4);
    expect(n.missedPassages).toBe(1);
    expect(n.redundantPassages).toBe(2);      // 0b011 and 0b111
    expect(n.singleCoverPassages).toBe(2);    // 0b001 and 0b010
    // The two must account for every observed passage, with nothing double-counted.
    expect(n.redundantPassages + n.singleCoverPassages).toBe(n.observedPassages);
  });

  it("credits a site only for passages nothing else sees", () => {
    //        A      A+B     A+B     B
    const masks = [0b01, 0b11, 0b11, 0b10];
    const n = summariseNetwork(masks, 2);
    const [a, b] = n.perSite;
    expect(a.observedPassages).toBe(3);
    expect(b.observedPassages).toBe(3);
    // Each site is the sole holder of exactly one passage.
    expect(a.uniquePassages).toBe(1);
    expect(b.uniquePassages).toBe(1);
    expect(a.uniqueShare).toBeCloseTo(0.25, 6);
  });

  it("gives a fully redundant site zero unique contribution", () => {
    // 🔴 The case the combined figure hides: site B sees a lot and adds nothing. Removing it
    // would not cost a single passage, and the headline percentage would not move.
    const masks = [0b11, 0b11, 0b01];
    const n = summariseNetwork(masks, 2);
    expect(n.perSite[1].observedPassages).toBe(2);
    expect(n.perSite[1].uniquePassages).toBe(0);
    expect(n.perSite[0].uniquePassages).toBe(1);
    expect(n.worstCaseLossPassages).toBe(1);
  });

  it("reports the worst single-site loss, not the average one", () => {
    //        A only x3               B only x1        A+B
    const masks = [0b01, 0b01, 0b01, 0b10, 0b11];
    const n = summariseNetwork(masks, 2);
    expect(n.perSite[0].uniquePassages).toBe(3);
    expect(n.perSite[1].uniquePassages).toBe(1);
    expect(n.worstCaseLossPassages).toBe(3);
    expect(n.worstCaseLossShare).toBeCloseTo(3 / 5, 6);
  });

  it("keeps every share against passages that entered the area, not against those observed", () => {
    // One of the four never enters anyone's field. Shares must be out of 4, not out of 3.
    const n = summariseNetwork([0b01, 0b01, 0b11, 0b00], 2);
    expect(n.passageShare).toBeCloseTo(3 / 4, 6);
    expect(n.redundantShare).toBeCloseTo(1 / 4, 6);
  });

  it("is consistent with the single-site figure when there is one site", () => {
    const masks = [0b1, 0b0, 0b1, 0b1];
    const n = summariseNetwork(masks, 1);
    expect(n.passageShare).toBeCloseTo(3 / 4, 6);
    // With one site, everything it sees is its own and nothing is redundant.
    expect(n.redundantPassages).toBe(0);
    expect(n.perSite[0].uniquePassages).toBe(3);
    expect(n.worstCaseLossShare).toBeCloseTo(3 / 4, 6);
  });
});
