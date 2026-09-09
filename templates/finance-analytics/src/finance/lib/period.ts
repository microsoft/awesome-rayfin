import type { DataTable } from "./types";

/** Time grain the app rolls up to. */
export type Granularity = "day" | "week" | "month" | "quarter";

/** Named relative range presets, finance-oriented. */
export type PeriodPresetId =
  | "mtd"
  | "qtd"
  | "ytd"
  | "last12m"
  | "last4q"
  | "all"
  | "custom";

export interface PeriodValue {
  preset: PeriodPresetId;
  granularity: Granularity;
  /** ISO dates, only meaningful when `preset === "custom"`. */
  start?: string;
  end?: string;
}

export const PERIOD_PRESETS: { id: PeriodPresetId; label: string }[] = [
  { id: "mtd", label: "Month to date" },
  { id: "qtd", label: "Quarter to date" },
  { id: "ytd", label: "Year to date" },
  { id: "last12m", label: "Last 12 months" },
  { id: "last4q", label: "Last 4 quarters" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom range" },
];

export const GRANULARITIES: { id: Granularity; short: string; label: string }[] = [
  { id: "day", short: "D", label: "Daily" },
  { id: "week", short: "W", label: "Weekly" },
  { id: "month", short: "M", label: "Monthly" },
  { id: "quarter", short: "Q", label: "Quarterly" },
];

export const DEFAULT_PERIOD: PeriodValue = { preset: "ytd", granularity: "month" };

const presetLabel = (id: PeriodPresetId) => PERIOD_PRESETS.find((p) => p.id === id)?.label ?? id;
const granLabel = (id: Granularity) => GRANULARITIES.find((g) => g.id === id)?.label ?? id;

/** Short human summary for a scope chip, e.g. "Year to date · Monthly". */
export function periodSummary(v: PeriodValue): string {
  if (v.preset === "custom" && v.start && v.end) return `${v.start} → ${v.end} · ${granLabel(v.granularity)}`;
  return `${presetLabel(v.preset)} · ${granLabel(v.granularity)}`;
}

function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), q, 1);
}

/** Resolve a preset to a concrete `[start, end]` window. `null` means "all time". */
export function resolvePeriodRange(v: PeriodValue, now: Date = new Date()): { start: Date; end: Date } | null {
  const end = now;
  switch (v.preset) {
    case "mtd":
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end };
    case "qtd":
      return { start: startOfQuarter(now), end };
    case "ytd":
      return { start: new Date(now.getFullYear(), 0, 1), end };
    case "last12m":
      return { start: new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()), end };
    case "last4q": {
      const qStart = startOfQuarter(now);
      return { start: new Date(qStart.getFullYear(), qStart.getMonth() - 9, 1), end };
    }
    case "custom":
      if (v.start && v.end) return { start: new Date(v.start), end: new Date(v.end) };
      return null;
    case "all":
    default:
      return null;
  }
}

/** Keep only rows whose date `column` falls within the resolved period window. */
export function filterByPeriod(table: DataTable, column: string, v: PeriodValue, now?: Date): DataTable {
  const range = resolvePeriodRange(v, now);
  if (!range) return table;
  const from = range.start.getTime();
  const to = range.end.getTime();
  return {
    columns: table.columns,
    rows: table.rows.filter((r) => {
      const raw = r[column];
      if (raw == null) return false;
      const t = new Date(raw as string | number).getTime();
      return Number.isFinite(t) && t >= from && t <= to;
    }),
  };
}

/** Serialize for a URL param: `preset:granularity` (+ `:start:end` for custom). */
export function encodePeriod(v: PeriodValue): string {
  const base = `${v.preset}:${v.granularity}`;
  return v.preset === "custom" && v.start && v.end ? `${base}:${v.start}:${v.end}` : base;
}

export function decodePeriod(param: string, fallback: PeriodValue = DEFAULT_PERIOD): PeriodValue {
  if (!param) return fallback;
  const [preset, granularity, start, end] = param.split(":");
  const presetOk = PERIOD_PRESETS.some((p) => p.id === preset);
  const granOk = GRANULARITIES.some((g) => g.id === granularity);
  if (!presetOk || !granOk) return fallback;
  return { preset: preset as PeriodPresetId, granularity: granularity as Granularity, start, end };
}
