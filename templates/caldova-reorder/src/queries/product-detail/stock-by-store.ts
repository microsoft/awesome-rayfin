import rawQuery from "./stock-by-store.dax?raw";
import { withParameters } from "../dax-literals";
import { dateOf, numberOf, textOf, type ModelRow } from "../model-row";

export interface StorePoint {
    storeId: string;
    storeName: string;
    date: string;
    stock: number;
    cover: number;
}

/** Column names copied verbatim from the model's query output. */
const columns = {
    storeId: "Stores[store_id]",
    storeName: "Stores[name]",
    date: "Sales[date]",
    stock: "[Stock]",
    cover: "[Cover]",
} as const;

export function stockByStore(sku: string) {
    return {
        query: withParameters(rawQuery, { sku }),
        parse: (row: ModelRow): StorePoint => ({
            storeId: textOf(row[columns.storeId]),
            storeName: textOf(row[columns.storeName]),
            date: dateOf(row[columns.date]).toISOString().slice(0, 10),
            stock: numberOf(row[columns.stock]),
            cover: numberOf(row[columns.cover]),
        }),
    };
}

export interface StoreSeries {
    storeId: string;
    storeName: string;
    /** Stock at the end of the most recent day in the window. */
    currentStock: number;
    currentCover: number;
    points: { date: string; value: number }[];
}

/**
 * Group the flat result into one series per store, worst cover first, so the
 * shops that need attention are read before the ones that do not.
 */
export function groupByStore(points: StorePoint[]): StoreSeries[] {
    const byStore = new Map<string, StoreSeries>();

    for (const point of points) {
        const series = byStore.get(point.storeId);

        if (series) {
            series.points.push({ date: point.date, value: point.stock });
        } else {
            byStore.set(point.storeId, {
                storeId: point.storeId,
                storeName: point.storeName,
                currentStock: point.stock,
                currentCover: point.cover,
                points: [{ date: point.date, value: point.stock }],
            });
        }
    }

    for (const series of byStore.values()) {
        series.points.sort((a, b) => a.date.localeCompare(b.date));
        const last = series.points.at(-1);
        if (last) series.currentStock = last.value;

        const latest = points
            .filter((point) => point.storeId === series.storeId)
            .sort((a, b) => a.date.localeCompare(b.date))
            .at(-1);
        if (latest) series.currentCover = latest.cover;
    }

    return [...byStore.values()].sort((a, b) => a.currentCover - b.currentCover);
}
