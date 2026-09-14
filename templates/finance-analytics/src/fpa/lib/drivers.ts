/**
 * Price / Volume / Mix decomposition of a revenue change between two scenarios.
 *
 * Reconciliation guarantee (verified by unit tests):
 *   ΔRevenue = Price + Volume + Mix
 * where, aggregating product facts over a window:
 *   priceEffect  = Σ_p (P_act_p − P_base_p) · U_act_p
 *   volume+mix   = Σ_p (U_act_p − U_base_p) · P_base_p        (per-product)
 *   pureVolume   = (ΣU_act − ΣU_base) · blendedBasePrice       blended = ΣRev_base/ΣU_base
 *   mix          = (volume+mix) − pureVolume                    (residual, exact)
 * Base can be Budget (BU) or the Forecast (FC); the same math also drives an
 * AC-vs-PY bridge when the caller passes a prior-year window.
 */

import { productFacts, type ProductName, type Scenario } from "../data/statementFacts";

export interface BridgeStep {
  label: string;
  /** Signed contribution to ΔRevenue. */
  value: number;
  kind: "base" | "delta" | "total";
}

export interface ProductDriver {
  product: ProductName;
  /** Signed total revenue delta for this product (act − base). */
  delta: number;
  price: number;
  volume: number;
  mix: number;
}

export interface PvmResult {
  base: number;
  actual: number;
  price: number;
  volume: number;
  mix: number;
  /** Waterfall-ready steps: Base → Volume → Mix → Price → Actual. */
  steps: BridgeStep[];
  /** Per-product ranked contributions (largest magnitude first). */
  drivers: ProductDriver[];
}

interface Agg {
  units: number;
  revenue: number;
}

/** Aggregate units & revenue per product for a scenario over a window. */
function aggregate(window: string[], scenario: Scenario): Map<ProductName, Agg> {
  const out = new Map<ProductName, Agg>();
  for (const f of productFacts) {
    if (f.scenario !== scenario || !window.includes(f.period)) continue;
    const cur = out.get(f.product) ?? { units: 0, revenue: 0 };
    cur.units += f.units;
    cur.revenue += f.units * f.price;
    out.set(f.product, cur);
  }
  return out;
}

/**
 * Decompose Actual-vs-base revenue over the actual window. When comparing to PY,
 * pass the prior-year window as `baseWindow` and scenario "AC".
 */
export function decomposePvm(
  actualWindow: string[],
  baseWindow: string[],
  baseScenario: Scenario,
  actualScenario: Scenario = "AC",
  /** Multiply every monetary output (e.g. FX translation factor). */
  scale = 1,
): PvmResult {
  const act = aggregate(actualWindow, actualScenario);
  const base = aggregate(baseWindow, baseScenario);
  const products = Array.from(new Set([...act.keys(), ...base.keys()]));

  let price = 0;
  let volMix = 0;
  const drivers: ProductDriver[] = [];

  for (const p of products) {
    const a = act.get(p) ?? { units: 0, revenue: 0 };
    const b = base.get(p) ?? { units: 0, revenue: 0 };
    const pAct = a.units ? a.revenue / a.units : 0;
    const pBase = b.units ? b.revenue / b.units : 0;
    const priceEffect = (pAct - pBase) * a.units;
    const volMixEffect = (a.units - b.units) * pBase;
    price += priceEffect;
    volMix += volMixEffect;
    drivers.push({ product: p, delta: a.revenue - b.revenue, price: priceEffect, volume: volMixEffect, mix: 0 });
  }

  const totalUnitsAct = sum(Array.from(act.values()).map((v) => v.units));
  const totalUnitsBase = sum(Array.from(base.values()).map((v) => v.units));
  const totalRevBase = sum(Array.from(base.values()).map((v) => v.revenue));
  const blendedBasePrice = totalUnitsBase ? totalRevBase / totalUnitsBase : 0;
  const pureVolume = (totalUnitsAct - totalUnitsBase) * blendedBasePrice;
  const mix = volMix - pureVolume;

  const baseRev = totalRevBase;
  const actualRev = sum(Array.from(act.values()).map((v) => v.revenue));

  // Split each product's volume+mix into pure-volume vs mix proportionally so
  // the per-product view reconciles with the portfolio mix figure.
  const volMixTotal = volMix || 1;
  for (const d of drivers) {
    const share = d.volume / volMixTotal;
    d.mix = mix * share;
    d.volume = d.volume - d.mix;
  }
  drivers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const s = scale;
  return {
    base: baseRev * s,
    actual: actualRev * s,
    price: price * s,
    volume: pureVolume * s,
    mix: mix * s,
    steps: [
      { label: "Base", value: baseRev * s, kind: "base" },
      { label: "Volume", value: pureVolume * s, kind: "delta" },
      { label: "Mix", value: mix * s, kind: "delta" },
      { label: "Price", value: price * s, kind: "delta" },
      { label: "Actual", value: actualRev * s, kind: "total" },
    ],
    drivers: drivers.map((d) => ({
      product: d.product,
      delta: d.delta * s,
      price: d.price * s,
      volume: d.volume * s,
      mix: d.mix * s,
    })),
  };
}

function sum(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0);
}
