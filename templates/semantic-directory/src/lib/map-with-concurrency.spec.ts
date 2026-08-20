//-----------------------------------------------------------------------
// Semantic Directory — tests for the bounded-concurrency async map.
//-----------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "@/lib/map-with-concurrency";

describe("mapWithConcurrency", () => {
    it("preserves input order regardless of completion order", async () => {
        const items = [30, 10, 20, 0];
        const results = await mapWithConcurrency(items, 2, async (ms) => {
            await new Promise((r) => setTimeout(r, ms));
            return ms;
        });
        expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([
            30, 10, 20, 0,
        ]);
    });

    it("never runs more than `limit` tasks at once", async () => {
        let active = 0;
        let peak = 0;
        await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 5));
            active--;
            return true;
        });
        expect(peak).toBeLessThanOrEqual(2);
    });

    it("captures per-item failures without rejecting the whole batch", async () => {
        const results = await mapWithConcurrency([1, 2, 3], 3, async (n) => {
            if (n === 2) throw new Error("boom");
            return n * 10;
        });
        expect(results[0]).toEqual({ status: "fulfilled", value: 10 });
        expect(results[1].status).toBe("rejected");
        expect(results[2]).toEqual({ status: "fulfilled", value: 30 });
    });

    it("handles an empty input list", async () => {
        const results = await mapWithConcurrency([], 4, async () => 1);
        expect(results).toEqual([]);
    });

    it("clamps a limit larger than the item count", async () => {
        const results = await mapWithConcurrency([1, 2], 99, async (n) => n);
        expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([1, 2]);
    });
});
