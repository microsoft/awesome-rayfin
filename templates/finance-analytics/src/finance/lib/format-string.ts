/**
 * Model format-string engine — renders a cell value using the VBA / ECMA-376
 * number-format string a semantic model carries on each measure/column
 * (e.g. `"#,##0"`, `"$#,##0.00"`, `"0.0%"`, `"#,##0,,"`, `"yyyy-mm-dd"`).
 *
 * This is the object-row counterpart to the official `formatValue` the SDK
 * applies inside `VegaVisual` / `DataGrid`. We re-implement a focused subset
 * here (per the same reimplement-don't-import convention as `fabric-interop.ts`)
 * so every object-row surface — the custom grid, pivot, finance tables, export —
 * renders numbers the way the model author declared, WITHOUT a runtime SDK
 * dependency. Anything we can't parse falls back to a sensible default, exactly
 * like `formatValue` returns the original value on an unknown format.
 *
 * Supported number grammar (the finance-common slice):
 *  - grouping `#,##0`, decimals `0.00`, min-integer `000`
 *  - currency / literal prefix + suffix: `$#,##0`, `#,##0" M"`, `\$0`
 *  - percent `0.0%` (scales the ratio ×100)
 *  - scaling commas `#,##0,,` (÷1000 per trailing comma → thousands / millions)
 *  - positive;negative sections `#,##0;(#,##0)` (parens or `-` for negatives)
 *  - a light date path (`yyyy`, `yy`, `mmmm`, `mmm`, `mm`, `m`, `dd`, `d`)
 */
import { formatNumber } from "./format";

interface NumberFormatSpec {
  prefix: string;
  suffix: string;
  useGrouping: boolean;
  minFrac: number;
  maxFrac: number;
  minInt: number;
  scaleDivisor: number;
  isPercent: boolean;
}

const PLACEHOLDER = /[0#]/;

/** Strip the quoting a format literal may carry: `"M"` → `M`, `\$` → `$`. */
function unquote(literal: string): string {
  return literal.replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1");
}

/** Parse one format section (already split on `;`) into a numeric spec, or null
 *  if it carries no numeric placeholders (e.g. a pure date/text section). */
function parseNumberSection(section: string): NumberFormatSpec | null {
  const first = section.search(PLACEHOLDER);
  if (first === -1) return null;
  // Index of the last `0`/`#`.
  let last = -1;
  for (let i = section.length - 1; i >= 0; i--) {
    if (PLACEHOLDER.test(section[i])) { last = i; break; }
  }
  // Trailing scaling commas immediately after the last placeholder.
  let scaleCommas = 0;
  let after = last + 1;
  while (after < section.length && section[after] === ",") { scaleCommas++; after++; }

  const prefix = unquote(section.slice(0, first));
  const suffix = unquote(section.slice(after));
  const core = section.slice(first, last + 1);
  const dot = core.indexOf(".");
  const intCore = dot === -1 ? core : core.slice(0, dot);
  const fracCore = dot === -1 ? "" : core.slice(dot + 1);

  const minFrac = (fracCore.match(/0/g) ?? []).length;
  const maxFrac = (fracCore.match(/[0#]/g) ?? []).length;
  const minInt = (intCore.match(/0/g) ?? []).length;

  return {
    prefix,
    suffix,
    useGrouping: intCore.includes(","),
    minFrac,
    maxFrac,
    minInt,
    scaleDivisor: Math.pow(1000, scaleCommas),
    isPercent: section.includes("%"),
  };
}

function renderNumber(value: number, spec: NumberFormatSpec, locale?: string): string {
  let n = value;
  if (spec.isPercent) n *= 100;
  if (spec.scaleDivisor > 1) n /= spec.scaleDivisor;
  const body = Math.abs(n).toLocaleString(locale, {
    style: "decimal",
    minimumFractionDigits: spec.minFrac,
    maximumFractionDigits: Math.max(spec.minFrac, spec.maxFrac),
    minimumIntegerDigits: Math.max(1, spec.minInt),
    useGrouping: spec.useGrouping,
  });
  return spec.prefix + body + spec.suffix;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function looksLikeDateFormat(fmt: string): boolean {
  return !PLACEHOLDER.test(fmt) && /[dmy]/i.test(fmt) && !fmt.includes("%");
}

function renderDate(value: string | number | Date, fmt: string): string | null {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (x: number) => String(x).padStart(2, "0");
  // Order matters: longest tokens first so `mmmm` isn't eaten by `mm`.
  return fmt.replace(/yyyy|yy|mmmm|mmm|mm|m|dd|d/gi, (tok) => {
    switch (tok.toLowerCase()) {
      case "yyyy": return String(d.getFullYear());
      case "yy": return pad(d.getFullYear() % 100);
      case "mmmm": return MONTHS[d.getMonth()];
      case "mmm": return MONTHS[d.getMonth()].slice(0, 3);
      case "mm": return pad(d.getMonth() + 1);
      case "m": return String(d.getMonth() + 1);
      case "dd": return pad(d.getDate());
      case "d": return String(d.getDate());
      default: return tok;
    }
  });
}

/**
 * Format a single cell value using its column's model format string. Falls back
 * to `formatNumber` (for numbers) or `String` (for everything else) when there is
 * no format, when the format can't be parsed, or when the value isn't numeric.
 *
 * @param value  the raw cell value (number, numeric string, ISO date string, …)
 * @param format the VBA/ECMA-376 format string from the model column, if any
 * @param opts   optional locale for grouping/decimal rendering
 */
export function formatCell(
  value: unknown,
  format?: string,
  opts?: { locale?: string },
): string {
  if (value == null || value === "") return "";

  const fmt = format?.trim();

  // Date path — only when the value parses to a date and the format has date tokens.
  if (fmt && looksLikeDateFormat(fmt) && (typeof value === "string" || value instanceof Date)) {
    const dated = renderDate(value as string | Date, fmt);
    if (dated != null) return dated;
  }

  // Numeric path.
  const num = typeof value === "number" ? value : Number(value);
  const isNumeric = typeof value === "number" || (typeof value === "string" && value.trim() !== "" && !Number.isNaN(num));

  if (!isNumeric || Number.isNaN(num)) return String(value);

  if (!fmt || fmt.toLowerCase() === "general") return formatNumber(num);

  const sections = fmt.split(";");
  const positive = parseNumberSection(sections[0]);
  if (!positive) return formatNumber(num);

  if (num < 0) {
    const negSection = sections[1];
    if (negSection != null) {
      const negSpec = parseNumberSection(negSection);
      // A negative section already encodes its own sign/parens → render its magnitude.
      if (negSpec) return renderNumber(Math.abs(num), negSpec);
      // Non-numeric negative section (rare) → fall through to signed default.
    }
    return "-" + renderNumber(Math.abs(num), positive, opts?.locale);
  }

  return renderNumber(num, positive, opts?.locale);
}
