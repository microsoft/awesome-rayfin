import rawQuery from "./sales-rate.dax?raw";
import { withParameters } from "../dax-literals";
import { numberOf, type ModelRow } from "../model-row";

/** The period a manager can switch the detail view between. */
export type Period = "week" | "month";

export interface SalesRate {
    storeWeek: number;
    storeMonth: number;
    regionWeek: number;
    regionMonth: number;
    suggestedUnits: number;
    daysOfStock: number;
    targetCoverDays: number;
    thresholdDays: number;
}

/** Column names copied verbatim from the model's query output. */
const columns = {
    storeWeek: "[StoreWeek]",
    storeMonth: "[StoreMonth]",
    regionWeek: "[RegionWeek]",
    regionMonth: "[RegionMonth]",
    suggestedUnits: "[SuggestedUnits]",
    daysOfStock: "[DaysOfStock]",
    targetCoverDays: "[TargetCoverDays]",
    thresholdDays: "[ThresholdDays]",
} as const;

export function salesRate(sku: string, storeId: string) {
    return {
        query: withParameters(rawQuery, { sku, storeId }),
        parse: (row: ModelRow): SalesRate => ({
            storeWeek: numberOf(row[columns.storeWeek]),
            storeMonth: numberOf(row[columns.storeMonth]),
            regionWeek: numberOf(row[columns.regionWeek]),
            regionMonth: numberOf(row[columns.regionMonth]),
            suggestedUnits: Math.round(numberOf(row[columns.suggestedUnits])),
            daysOfStock: numberOf(row[columns.daysOfStock]),
            targetCoverDays: numberOf(row[columns.targetCoverDays]),
            thresholdDays: numberOf(row[columns.thresholdDays]),
        }),
    };
}

/** The rate for the selected period, at this store and across the region. */
export function forPeriod(rate: SalesRate, period: Period) {
    return period === "week"
        ? { store: rate.storeWeek, region: rate.regionWeek }
        : { store: rate.storeMonth, region: rate.regionMonth };
}
