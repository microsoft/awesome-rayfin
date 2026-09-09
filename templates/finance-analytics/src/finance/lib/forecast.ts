/**
 * Lightweight, dependency-free forecast diagnostics used by the line chart and the
 * intelligence rail. Two distinct ideas that are often conflated:
 *
 *   • Accuracy (backward-looking): how close past forecasts were to actuals —
 *     MAPE / WAPE / bias / MAE. A grade of forecast quality.
 *   • Confidence band (forward-looking): the uncertainty envelope around a future
 *     forecast — sized *from* historical accuracy (worse track record ⇒ wider band).
 *
 * So the "confidence score" is not MAPE itself; MAPE (better: WAPE) is the input
 * that sizes the band. We surface both: a WAPE/bias accuracy chip and a shaded band.
 */

export interface ForecastAccuracy {
  /** Mean Absolute Percentage Error (0..1). Sensitive to near-zero actuals. */
  mape: number;
  /** Weighted Absolute Percentage Error (0..1) — $-weighted, stable. Preferred headline. */
  wape: number;
  /** Mean Percentage Error (signed) — +ve = forecast runs high, -ve = runs low. */
  bias: number;
  /** Mean Absolute Error in value units. */
  mae: number;
  /** Number of overlapping points scored. */
  n: number;
}

/** Score forecast vs actual over the periods where both are present. */
export function forecastAccuracy(
  actual: (number | null)[],
  forecast: (number | null)[],
): ForecastAccuracy {
  let absErr = 0;
  let pctErrSum = 0;
  let signedPctSum = 0;
  let actualAbsSum = 0;
  let n = 0;
  for (let i = 0; i < Math.min(actual.length, forecast.length); i++) {
    const a = actual[i];
    const f = forecast[i];
    if (a == null || f == null) continue;
    const err = f - a;
    absErr += Math.abs(err);
    actualAbsSum += Math.abs(a);
    if (a !== 0) {
      pctErrSum += Math.abs(err / a);
      signedPctSum += err / a;
    }
    n++;
  }
  if (n === 0) return { mape: 0, wape: 0, bias: 0, mae: 0, n: 0 };
  return {
    mape: pctErrSum / n,
    wape: actualAbsSum ? absErr / actualAbsSum : 0,
    bias: signedPctSum / n,
    mae: absErr / n,
    n,
  };
}

export interface Band {
  lower: (number | null)[];
  upper: (number | null)[];
}

/**
 * Build a confidence envelope around a forecast series. Width = value × relErr,
 * widening with the forecast horizon (uncertainty compounds the further out we
 * project, ~√step). `relErr` is typically the historical WAPE; `z` scales the
 * interval (≈1.28 ≈ 80%, ≈1.64 ≈ 90%).
 */
export function confidenceBand(
  forecast: (number | null)[],
  relErr: number,
  z = 1.28,
): Band {
  const lower: (number | null)[] = [];
  const upper: (number | null)[] = [];
  let step = 0;
  const floor = Math.max(relErr, 0.02); // never render a hairline-thin band
  for (const v of forecast) {
    if (v == null) {
      lower.push(null);
      upper.push(null);
      continue;
    }
    step++;
    const halfWidth = Math.abs(v) * floor * z * Math.sqrt(step);
    lower.push(v - halfWidth);
    upper.push(v + halfWidth);
  }
  return { lower, upper };
}
