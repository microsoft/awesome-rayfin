/**
 * Anchored time-intelligence for the statements dataset.
 *
 * Unlike the shell's wall-clock `period.ts`, these presets resolve against the
 * dataset's `asOf` anchor and an explicit fiscal calendar, so the demo is stable
 * forever (a fixed fixture never "runs out" of data). Monthly grain only — MTD is
 * intentionally absent because it is meaningless with monthly observations.
 */

import { AS_OF, CALENDAR, PERIODS, type FiscalCalendar } from "../data/statementFacts";
import type { PeriodValue } from "@/finance";

export type StatementPreset = "month" | "qtd" | "ytd" | "fy" | "last12m";

/** Map the shell's global period preset onto the statement's anchored presets. */
export function mapGlobalPreset(p?: PeriodValue): StatementPreset | undefined {
  if (!p) return undefined;
  switch (p.preset) {
    case "qtd":
      return "qtd";
    case "ytd":
      return "ytd";
    case "mtd":
      return "month";
    case "last12m":
    case "last4q":
      return "last12m";
    case "all":
      return "fy";
    default:
      return undefined;
  }
}

export interface PresetDef {
  id: StatementPreset;
  label: string;
  /** Short chip label. */
  short: string;
}

export const STATEMENT_PRESETS: PresetDef[] = [
  { id: "month", label: "Current month", short: "MTH" },
  { id: "qtd", label: "Quarter to date", short: "QTD" },
  { id: "ytd", label: "Year to date", short: "YTD" },
  { id: "fy", label: "Full year", short: "FY" },
  { id: "last12m", label: "Last 12 months", short: "L12M" },
];

function ym(period: string): { y: number; m: number } {
  const [y, m] = period.split("-").map(Number);
  return { y, m };
}

function key(y: number, m: number): string {
  // Normalise month overflow/underflow into calendar years.
  const d = new Date(y, m - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Shift a period key by a number of months (can be negative). */
export function shiftPeriod(period: string, months: number): string {
  const { y, m } = ym(period);
  return key(y, m + months);
}

/** Fiscal year label for a period (calendar-aligned here, but calendar-aware). */
export function fiscalYearOf(period: string, cal: FiscalCalendar = CALENDAR): number {
  const { y, m } = ym(period);
  return m >= cal.fyStartMonth ? y : y - 1;
}

/** First period of the fiscal quarter containing `period`. */
function quarterStart(period: string, cal: FiscalCalendar): string {
  const { m } = ym(period);
  const monthsIntoFy = (m - cal.fyStartMonth + 12) % 12;
  const qOffset = monthsIntoFy % 3;
  return shiftPeriod(period, -qOffset);
}

/** First period of the fiscal year containing `period`. */
function fyStart(period: string, cal: FiscalCalendar): string {
  const { y, m } = ym(period);
  const fy = m >= cal.fyStartMonth ? y : y - 1;
  return key(fy, cal.fyStartMonth);
}

/**
 * Resolve a preset to the ordered list of period keys it covers, anchored at
 * `asOf`. `fy` returns all 12 months of the fiscal year (including forward
 * months that only carry Budget/Forecast); every other preset stops at `asOf`.
 */
export function resolveWindow(
  preset: StatementPreset,
  asOf: string = AS_OF,
  cal: FiscalCalendar = CALENDAR,
): string[] {
  const all = PERIODS;
  const inRange = (from: string, to: string) => all.filter((p) => p >= from && p <= to);
  switch (preset) {
    case "month":
      return [asOf];
    case "qtd":
      return inRange(quarterStart(asOf, cal), asOf);
    case "ytd":
      return inRange(fyStart(asOf, cal), asOf);
    case "fy": {
      const start = fyStart(asOf, cal);
      const end = shiftPeriod(start, 11);
      return inRange(start, end);
    }
    case "last12m":
      return inRange(shiftPeriod(asOf, -11), asOf);
    default:
      return [asOf];
  }
}

/** The prior-year window: the same window shifted back 12 months. */
export function priorYearWindow(window: string[]): string[] {
  return window.map((p) => shiftPeriod(p, -12));
}

/** Human summary for a scope chip, e.g. "Year to date · through Aug 2024". */
export function windowSummary(preset: StatementPreset, asOf: string = AS_OF): string {
  const def = STATEMENT_PRESETS.find((p) => p.id === preset);
  const { y, m } = ym(asOf);
  const month = new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
  return `${def?.label ?? preset} · through ${month}`;
}
