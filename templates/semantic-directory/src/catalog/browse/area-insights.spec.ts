//-----------------------------------------------------------------------
// Semantic Directory — tests for family collapsing (the 37-row-wall fix).
//-----------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { groupFamilies } from "@/catalog/browse/area-insights";
import type { MeasureMeta } from "@/catalog/model/types";

/** Minimal MeasureMeta factory — only the fields groupFamilies reads. */
function measure(partial: Partial<MeasureMeta> & { key: string; displayName: string }): MeasureMeta {
    return {
        kind: "measure",
        name: partial.displayName,
        table: "M",
        ...partial,
    } as MeasureMeta;
}

describe("groupFamilies", () => {
    it("collapses a family into one lead plus sorted variants", () => {
        const ms = [
            measure({ key: "agr-target", displayName: "Total Sales Target", familyId: "fam:agr" }),
            measure({ key: "agr", displayName: "Total Sales", familyId: "fam:agr" }),
            measure({ key: "agr-qtd", displayName: "Total Sales QTD", familyId: "fam:agr" }),
        ];
        const groups = groupFamilies(ms);
        expect(groups).toHaveLength(1);
        // Lead = fewest words / shortest → "Total Sales".
        expect(groups[0].lead.key).toBe("agr");
        expect(groups[0].variants.map((v) => v.displayName)).toEqual([
            "Total Sales QTD",
            "Total Sales Target",
        ]);
    });

    it("keeps measures without a familyId as their own solo groups", () => {
        const ms = [
            measure({ key: "a", displayName: "Alpha" }),
            measure({ key: "b", displayName: "Bravo" }),
        ];
        const groups = groupFamilies(ms);
        expect(groups).toHaveLength(2);
        expect(groups.every((g) => g.variants.length === 0)).toBe(true);
        expect(groups.map((g) => g.key).sort()).toEqual(["solo:a", "solo:b"]);
    });

    it("ranks a high-trust, larger family ahead of a bare solo measure", () => {
        const ms = [
            measure({ key: "solo", displayName: "Zzz Lonely" }),
            measure({
                key: "rev",
                displayName: "Net Revenue",
                familyId: "fam:rev",
                trust: { level: "high", hasStaleSource: false },
            }),
            measure({ key: "rev-tgt", displayName: "Net Revenue Target", familyId: "fam:rev" }),
        ];
        const groups = groupFamilies(ms);
        expect(groups[0].lead.key).toBe("rev");
    });
});
