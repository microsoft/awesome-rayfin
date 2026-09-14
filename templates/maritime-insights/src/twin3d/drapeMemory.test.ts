import { describe, expect, it } from "vitest";
import { drapeMemoryPlan } from "./scene";

/**
 * 🔴 The defect this pins shipped, and it made the entire core terrain black.
 *
 * The Förde drape is 5260 × 8192 — 172 MB as RGBA, ~230 MB with a mip chain. On a shared-memory
 * integrated GPU `generateMipmap` on that surface produced a texture that sampled **zero**, with
 * no exception, no warning and no GL error. Sky, sea, horizon shell and buildings all kept
 * rendering, so the app looked *deliberate* rather than broken.
 *
 * Measured, one variable at a time: mipmaps on → 0/3 land points lit, 0.366 of the frame near
 * black, first frame 38 s (133 s with anisotropy off). Mipmaps off → 3/3 lit, 0.001 near black,
 * first frame 7.5 s.
 */
describe("drapeMemoryPlan", () => {
  const MAX = 16384;

  it("gives up the mip chain for the Förde drape rather than rendering black", () => {
    const plan = drapeMemoryPlan(5260, 8192, MAX);
    expect(plan.mipmaps).toBe(false);
    expect(plan.oversize).toBe(false);
    expect(Math.round(plan.bytes / 1024 / 1024)).toBe(164);
  });

  it("keeps mipmaps for a drape small enough to afford them", () => {
    // Dropping mipmaps costs minification aliasing at range, so it must be a budget and not a
    // blanket ban — a smaller site has no reason to pay that.
    const plan = drapeMemoryPlan(2048, 2048, MAX);
    expect(plan.mipmaps).toBe(true);
    expect(plan.note).toContain("mipmaps kept");
  });

  it("puts the budget between the two, so the boundary is a decision and not an accident", () => {
    expect(drapeMemoryPlan(4096, 4096, MAX).mipmaps).toBe(true);   // 64 MB, exactly the budget
    expect(drapeMemoryPlan(4096, 4097, MAX).mipmaps).toBe(false);  // one row over
  });

  it("reports an over-large texture as an ERROR case, never silently", () => {
    // PLAN §10: "a texture over MAX_TEXTURE_SIZE fails silently — assert the dimensions in code".
    const plan = drapeMemoryPlan(20000, 8192, MAX);
    expect(plan.oversize).toBe(true);
    expect(plan.mipmaps).toBe(false);
    expect(plan.note).toContain("MAX_TEXTURE_SIZE");
    expect(plan.note).toContain("will not render");
  });

  it("always explains itself in words the next reader can act on", () => {
    // The failure mode was silence. Every branch has to produce a sentence.
    for (const [w, h] of [[5260, 8192], [2048, 2048], [20000, 20000]]) {
      const plan = drapeMemoryPlan(w, h, MAX);
      expect(plan.note.length).toBeGreaterThan(30);
      expect(plan.note).toContain(`${w}x${h}`);
    }
  });
});
