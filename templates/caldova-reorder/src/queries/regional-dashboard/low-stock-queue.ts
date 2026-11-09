import query from "./low-stock-queue.dax?raw";
import { numberOf, textOf, type ModelRow } from "../model-row";

/** Urgency as a word, so it never depends on colour alone. */
export type StockStatus = "Critical" | "Low" | "Healthy";

export interface LowStockItem {
    storeId: string;
    storeName: string;
    sku: string;
    productName: string;
    daysOfStock: number;
    stockStatus: StockStatus;
    onHandUnits: number;
    suggestedReorderUnits: number;
}

/** Column names copied verbatim from the model's query output. */
const columns = {
    storeId: "Stores[store_id]",
    storeName: "Stores[name]",
    sku: "Products[sku]",
    productName: "Products[name]",
    daysOfStock: "[DaysOfStock]",
    stockStatus: "[StockStatus]",
    onHandUnits: "[OnHandUnits]",
    suggestedReorderUnits: "[SuggestedReorderUnits]",
} as const;

export function lowStockQueue() {
    return {
        query,
        parse: (row: ModelRow): LowStockItem => ({
            storeId: textOf(row[columns.storeId]),
            storeName: textOf(row[columns.storeName]),
            sku: textOf(row[columns.sku]),
            productName: textOf(row[columns.productName]),
            daysOfStock: numberOf(row[columns.daysOfStock]),
            stockStatus: textOf(row[columns.stockStatus]) as StockStatus,
            onHandUnits: numberOf(row[columns.onHandUnits]),
            suggestedReorderUnits: Math.round(numberOf(row[columns.suggestedReorderUnits])),
        }),
    };
}

/** Stable identity for a product in a store. */
export function lowStockKey(item: Pick<LowStockItem, "storeId" | "sku">): string {
    return `${item.storeId}:${item.sku}`;
}
