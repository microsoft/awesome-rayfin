export function formatNumber(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Compact currency-ish formatting: 45200000000 -> "45.2B". */
export function formatCompact(v: number, prefix = ""): string {
  const abs = Math.abs(v);
  const units: [number, string][] = [
    [1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"],
  ];
  for (const [factor, suffix] of units) {
    if (abs >= factor) return `${prefix}${(v / factor).toFixed(1)}${suffix}`;
  }
  return `${prefix}${formatNumber(v)}`;
}

/** Signed percent from a ratio: 0.062 -> "+6.2%", -0.014 -> "-1.4%". */
export function formatSignedPercent(ratio: number, fractionDigits = 1): string {
  const pct = ratio * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(fractionDigits)}%`;
}

/** Compact value with an explicit sign: 4200 -> "+$4.2K", -900 -> "-$900". */
export function formatSignedCompact(v: number, prefix = ""): string {
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${formatCompact(Math.abs(v), prefix)}`;
}
