import query from "./low-stock-trend.dax?raw";
import { dateOf, numberOf, type ModelRow } from "../model-row";

export interface LowStockPoint {
    date: string;
    runningLow: number;
}

/** Column names copied verbatim from the model's query output. */
const columns = {
    date: "Sales[date]",
    runningLow: "[RunningLow]",
} as const;

export function lowStockTrend() {
    return {
        query,
        parse: (row: ModelRow): LowStockPoint => ({
            date: dateOf(row[columns.date]).toISOString().slice(0, 10),
            runningLow: numberOf(row[columns.runningLow]),
        }),
    };
}
