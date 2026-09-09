import type { DataTable } from "@/finance";

const SEGMENTS = ["Hardware", "Software", "Cloud", "Services", "Support"];
const REGIONS = ["Americas", "EMEA", "APAC"];
const CHANNELS = ["Direct", "Partner", "Online"];
const TIERS = ["Enterprise", "SMB", "Consumer"];

/** Deterministic illustrative dataset (NOT real financials) for grid/pivot/export/charts. */
function build(): DataTable {
  const rows: DataTable["rows"] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (const segment of SEGMENTS) {
    for (const region of REGIONS) {
      for (const channel of CHANNELS) {
        const tier = TIERS[Math.floor(rand() * TIERS.length)];
        const revenue = Math.round((2 + rand() * 18) * 1e9);
        const units = Math.round((0.4 + rand() * 6) * 1e6);
        const margin = +(28 + rand() * 22).toFixed(1);
        rows.push({ segment, region, channel, tier, revenue, units, margin });
      }
    }
  }
  return {
    columns: [
      { key: "segment", label: "Segment" },
      { key: "region", label: "Region" },
      { key: "channel", label: "Channel" },
      { key: "tier", label: "Customer Tier" },
      { key: "revenue", label: "Revenue", numeric: true },
      { key: "units", label: "Units", numeric: true },
      { key: "margin", label: "Margin %", numeric: true },
    ],
    rows,
  };
}

export const sampleData = build();

/**
 * Perf/stress hook: when the demo is loaded with `?rows=N` (e.g. `?rows=5000`),
 * synthesize N deterministic rows so the grid/pivot row-virtualization can be
 * exercised. No-op without the param, so the normal demo is unaffected. Capped
 * at 50k to keep the tab responsive.
 */
export function scaleForPerf(
  base: DataTable,
  search = typeof window !== "undefined" ? window.location.search : "",
): DataTable {
  const n = Number(new URLSearchParams(search).get("rows"));
  if (!Number.isFinite(n) || n <= base.rows.length) return base;
  const target = Math.min(Math.floor(n), 50_000);
  const rows: DataTable["rows"] = [];
  for (let i = 0; i < target; i++) {
    const src = base.rows[i % base.rows.length];
    const k = 1 + ((i * 2654435761) % 1000) / 1000;
    rows.push({
      ...src,
      segment: `${src.segment} ${Math.floor(i / base.rows.length) + 1}`,
      revenue: Math.round(Number(src.revenue) * k),
      units: Math.round(Number(src.units) * k),
      margin: +(Number(src.margin) * (0.9 + (k - 1) * 0.2)).toFixed(1),
    });
  }
  return { ...base, rows };
}
