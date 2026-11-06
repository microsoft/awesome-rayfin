import query from "./product-demand.dax?raw";
import { numberOf, textOf, type ModelRow } from "../model-row";
import { lowStockKey } from "./low-stock-queue";

export interface ProductDemandPoint {
    storeId: string;
    sku: string;
    date: string;
    units: number;
}

/** Column names copied verbatim from the model's query output. */
const columns = {
    storeId: "Stores[store_id]",
    sku: "Products[sku]",
    date: "Sales[date]",
    units: "[Units]",
} as const;

export function productDemand() {
    return {
        query,
        parse: (row: ModelRow): ProductDemandPoint => ({
            storeId: textOf(row[columns.storeId]),
            sku: textOf(row[columns.sku]),
            date: textOf(row[columns.date]).slice(0, 10),
            units: numberOf(row[columns.units]),
        }),
    };
}

export type DemandByProduct = Map<string, { date: string; value: number }[]>;

/**
 * Index the flat result by store and product, so each queue row can pick up its
 * own series without a query of its own.
 */
export function indexProductDemand(points: ProductDemandPoint[]): DemandByProduct {
    const byProduct: DemandByProduct = new Map();

    for (const point of points) {
        const key = lowStockKey(point);
        const series = byProduct.get(key);
        const entry = { date: point.date, value: point.units };

        if (series) {
            series.push(entry);
        } else {
            byProduct.set(key, [entry]);
        }
    }

    return byProduct;
}
