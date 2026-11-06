import query from "./headline-tiles.dax?raw";
import { dateOf, numberOf, textOf, type ModelRow } from "../model-row";

export interface HeadlineTiles {
    storesInRegion: number;
    productsRunningLow: number;
    reordersSentToday: number;
    /** The region the signed-in manager covers, for the top bar. */
    region: string | null;
    /** The model's own notion of "now". */
    latestSalesDate: Date;
}

/** Column names copied verbatim from the model's query output. */
const columns = {
    storesInRegion: "[StoresInRegion]",
    productsRunningLow: "[ProductsRunningLow]",
    reordersSentToday: "[ReordersSentToday]",
    region: "[Region]",
    latestSalesDate: "[LatestSalesDate]",
} as const;

export function headlineTiles() {
    return {
        query,
        parse: (row: ModelRow): HeadlineTiles => ({
            storesInRegion: numberOf(row[columns.storesInRegion]),
            productsRunningLow: numberOf(row[columns.productsRunningLow]),
            reordersSentToday: numberOf(row[columns.reordersSentToday]),
            region: regionLabel(textOf(row[columns.region])),
            latestSalesDate: dateOf(row[columns.latestSalesDate]),
        }),
    };
}

/**
 * The model concatenates every region the manager can see.
 *
 * With the `RegionalManager` role assigned that is one name. Unassigned — the
 * state the model ships in — it is all of them, so say so rather than printing
 * a list that runs off the tile.
 */
function regionLabel(raw: string): string | null {
    const regions = raw
        .split(",")
        .map((region) => region.trim())
        .filter(Boolean);

    if (regions.length === 0) return null;
    if (regions.length === 1) return regions[0];

    return "All regions";
}
