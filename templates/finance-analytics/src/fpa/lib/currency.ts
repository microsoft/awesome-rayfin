/**
 * Reporting-currency translation for the P&L.
 *
 * SCOPE (kept deliberately honest): the demo translates the income statement at
 * the period-AVERAGE rate — the correct convention for P&L flows. Balance-sheet
 * closing-rate translation and cumulative-translation-adjustment are out of scope
 * for a template fixture and are NOT implied. Values are stored in USD (base);
 * translation multiplies by an average rate for the selected window.
 */

import { fxRates, type CurrencyCode } from "../data/statementFacts";

const CURRENCY_LABEL: Record<CurrencyCode, string> = {
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
};

const CURRENCY_PREFIX: Record<CurrencyCode, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
};

export function currencyLabel(c: CurrencyCode): string {
  return CURRENCY_LABEL[c];
}

export function currencyPrefix(c: CurrencyCode): string {
  return CURRENCY_PREFIX[c];
}

const rateIndex = new Map<string, number>();
for (const r of fxRates) rateIndex.set(`${r.period}|${r.currency}`, r.avgRate);

/**
 * Window-average translation factor from base (USD) into `currency`. Averaging
 * the monthly average rates is a transparent, documented simplification suitable
 * for a demo — a real app would weight by monthly flow.
 */
export function translationFactor(window: string[], currency: CurrencyCode): number {
  if (currency === "USD") return 1;
  const rates = window.map((p) => rateIndex.get(`${p}|${currency}`)).filter((v): v is number => v != null);
  if (rates.length === 0) return 1;
  return rates.reduce((s, v) => s + v, 0) / rates.length;
}
