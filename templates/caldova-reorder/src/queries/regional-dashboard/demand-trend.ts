import query from "./demand-trend.dax?raw";
import { numberOf, textOf, type ModelRow } from "../model-row";

export interface DemandPoint {
    /** ISO date as the model returns it, ready for a temporal encoding. */
    date: string;
    units: number;
}

/** Column names copied verbatim from the model's query output. */
const columns = {
    date: "Sales[date]",
    units: "[UnitsSold]",
} as const;

export function demandTrend() {
    return {
        query,
        parse: (row: ModelRow): DemandPoint => ({
            date: textOf(row[columns.date]).slice(0, 10),
            units: numberOf(row[columns.units]),
        }),
    };
}
