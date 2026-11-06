import query from "./open-reorders.dax?raw";
import { numberOf, textOf, type ModelRow } from "../model-row";
import { lowStockKey } from "./low-stock-queue";

export interface OpenReorder {
    storeId: string;
    sku: string;
    unitsOnOrder: number;
}

/** Column names copied verbatim from the model's query output. */
const columns = {
    storeId: "RestockRequests[store_id]",
    sku: "RestockRequests[sku]",
    unitsOnOrder: "[UnitsOnOrder]",
} as const;

export function openReorders() {
    return {
        query,
        parse: (row: ModelRow): OpenReorder => ({
            storeId: textOf(row[columns.storeId]),
            sku: textOf(row[columns.sku]),
            unitsOnOrder: numberOf(row[columns.unitsOnOrder]),
        }),
    };
}

/** Units already on order, keyed by product and store. */
export type UnitsOnOrder = Map<string, number>;

export function indexOpenReorders(reorders: OpenReorder[]): UnitsOnOrder {
    return new Map(reorders.map((reorder) => [lowStockKey(reorder), reorder.unitsOnOrder]));
}
