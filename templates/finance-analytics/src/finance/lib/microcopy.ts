/**
 * Central micro-copy registry. Keeping standard explanatory strings here (rather
 * than inline per app) makes tone consistent org-wide and easy to localize later.
 * Consumers can spread-override any entry when constructing their app config.
 */
export const MICROCOPY = {
  freshness: (rel: string) => `Data as of ${rel}. Use Refresh to pull the latest.`,
  staleBanner: "Refreshing data — showing the last loaded snapshot.",
  confidence: "How strongly the underlying signal supports this insight.",
  crossFilter: "Select a segment to filter the whole page by it.",
  deckNative: "Charts are inserted as native, editable PowerPoint objects — not images.",
  exportScope: "Exports reflect the current filters and only the columns shown.",
  emptyFiltered: "No rows match the current filters. Clear one to see more.",
  truncated: (shown: number, total: number) =>
    `Showing ${shown.toLocaleString()} of ${total.toLocaleString()} rows. Refine filters or export for the full set.`,
  errorRecovery: "Something went wrong loading this. Try Refresh; if it persists, contact the app owner.",
} as const;

export type MicrocopyKey = keyof typeof MICROCOPY;
