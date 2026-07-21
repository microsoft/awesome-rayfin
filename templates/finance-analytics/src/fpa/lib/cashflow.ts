/**
 * Indirect-method cash flow, built from EXPLICIT reconciled inputs (working-capital
 * balances + capex in `wcFacts`) rather than re-derived from the P&L. Only the
 * indirect method is provided (the direct method is intentionally out of scope).
 *
 * Net income is proxied by Operating Income (EBIT) — interest and tax are not
 * modeled in this fixture, and the header note in the UI says so. Working-capital
 * movement uses closing balances: Δ = close(window) − close(month before window).
 */

import { isActualPeriod, wcFacts } from "../data/statementFacts";
import { actualOf } from "./statement-model";
import { resolveWindow, shiftPeriod, type StatementPreset } from "./time-aggregation";

export interface CashflowLine {
  id: string;
  label: string;
  /** Signed cash impact (source +, use −). */
  value: number;
  kind: "line" | "subtotal";
  emphasis?: boolean;
}

const wcIndex = new Map<string, (typeof wcFacts)[number]>();
for (const w of wcFacts) wcIndex.set(w.period, w);

function closing(period: string): { ar: number; inventory: number; ap: number } {
  const w = wcIndex.get(period);
  return w ? { ar: w.ar, inventory: w.inventory, ap: w.ap } : { ar: 0, inventory: 0, ap: 0 };
}

export function buildCashflow(preset: StatementPreset, scale = 1): CashflowLine[] {
  const window = resolveWindow(preset).filter(isActualPeriod);
  if (window.length === 0) return [];

  const first = window[0];
  const last = window[window.length - 1];
  const open = closing(shiftPeriod(first, -1));
  const close = closing(last);

  const ni = actualOf("ebit", preset) ?? 0;
  const daSigned = actualOf("da", preset) ?? 0; // negative in signed space
  const daAddback = Math.abs(daSigned);

  const dAr = close.ar - open.ar; // increase in AR uses cash
  const dInv = close.inventory - open.inventory; // increase in inventory uses cash
  const dAp = close.ap - open.ap; // increase in AP is a source of cash
  const capex = window.reduce((s, p) => s + (wcIndex.get(p)?.capex ?? 0), 0);

  const cfo = ni + daAddback - dAr - dInv + dAp;
  const fcf = cfo - capex;

  const rows: CashflowLine[] = [
    { id: "ni", label: "Operating income (EBIT)", value: ni, kind: "line" },
    { id: "da", label: "Depreciation & amortization", value: daAddback, kind: "line" },
    { id: "d_ar", label: "Change in accounts receivable", value: -dAr, kind: "line" },
    { id: "d_inv", label: "Change in inventory", value: -dInv, kind: "line" },
    { id: "d_ap", label: "Change in accounts payable", value: dAp, kind: "line" },
    { id: "cfo", label: "Cash from operations", value: cfo, kind: "subtotal", emphasis: true },
    { id: "capex", label: "Capital expenditure", value: -capex, kind: "line" },
    { id: "fcf", label: "Free cash flow", value: fcf, kind: "subtotal", emphasis: true },
  ];

  return scale === 1 ? rows : rows.map((r) => ({ ...r, value: r.value * scale }));
}
