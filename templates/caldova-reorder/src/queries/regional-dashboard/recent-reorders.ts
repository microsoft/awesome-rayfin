import query from "./recent-reorders.dax?raw";
import { dateOf, numberOf, textOf, type ModelRow } from "../model-row";

export interface Reorder {
    requestId: string;
    storeName: string;
    productName: string;
    units: number;
    requestedBy: string;
    requestedAt: Date;
}

/** Column names copied verbatim from the model's query output. */
const columns = {
    requestId: "[RequestId]",
    storeName: "[Store]",
    productName: "[Product]",
    units: "[Units]",
    requestedBy: "[RequestedBy]",
    requestedAt: "[RequestedAt]",
} as const;

export function recentReorders() {
    return {
        query,
        parse: (row: ModelRow): Reorder => ({
            requestId: textOf(row[columns.requestId]),
            storeName: textOf(row[columns.storeName]),
            productName: textOf(row[columns.productName]),
            units: numberOf(row[columns.units]),
            requestedBy: textOf(row[columns.requestedBy]),
            requestedAt: dateOf(row[columns.requestedAt]),
        }),
    };
}
