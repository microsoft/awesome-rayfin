import type { DeckSections } from "./deck";

export interface DeckTemplate {
  id: string;
  label: string;
  description: string;
  sections: DeckSections;
}

/** One-click Deck Builder presets. Each maps to a full set of slide toggles the
 *  user can still fine-tune before generating the PowerPoint. */
export const DECK_TEMPLATES: DeckTemplate[] = [
  {
    id: "full-detail",
    label: "Full detail",
    description: "Cover, takeaways, KPIs, chart and the data table.",
    sections: { cover: true, summary: true, kpis: true, chart: true, table: true, pageNumbers: true },
  },
  {
    id: "exec-summary",
    label: "Executive summary",
    description: "Cover, cited takeaways and KPIs — no data table.",
    sections: { cover: true, summary: true, kpis: true, chart: true, table: false, pageNumbers: true },
  },
  {
    id: "charts-only",
    label: "Charts only",
    description: "Cover plus the headline chart — skip tables and bullets.",
    sections: { cover: true, summary: false, kpis: false, chart: true, table: false, pageNumbers: true },
  },
  {
    id: "one-pager",
    label: "Leadership 1-pager",
    description: "Cover and the KPI summary — nothing else.",
    sections: { cover: true, summary: false, kpis: true, chart: false, table: false, pageNumbers: false },
  },
];

/** Estimate the rendered slide count from the chosen sections + available data.
 *  The data table pages at 14 rows/slide, so pass `tableRows` for an exact count. */
export function estimateDeckSlides(
  sections: DeckSections,
  has: { summary: boolean; kpis: boolean; chart: boolean; table: boolean },
  tableRows = 0,
): number {
  let n = 0;
  if (sections.cover) n += 1;
  for (const key of ["summary", "kpis", "chart"] as const) {
    if (sections[key] && has[key]) n += 1;
  }
  if (sections.table && has.table) {
    n += Math.max(1, Math.ceil(tableRows / 14));
  }
  return n;
}
