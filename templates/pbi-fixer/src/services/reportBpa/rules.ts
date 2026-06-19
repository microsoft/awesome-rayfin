// Report BPA rules — faithful TS port of `sempy_labs.report._report_bpa_rules`.
//
// Nine of the ten source rules are reproduced. The tenth ("Fix report objects
// which reference invalid semantic model objects") needs live model resolution
// and is out of scope for the in-browser PBIR pass.
//
// Predicates read the camelCase fields the engine attaches to each scope
// object (mirroring the Python `df["…"]` columns):
//   Page    → visibleVisualCount, height
//   Visual  → objectCount, showItemsWithNoData
//   Filter  → objectType, filterType
//   Custom Visual / Report Level Measure → flagged unconditionally / by usage

import type { ReportBpaRule, PageObj, VisualObj, CustomVisualObj, FilterObj } from './types';

const VISIBLE_VISUALS_LIMIT = 15;
const VISUAL_OBJECT_LIMIT = 5;
const TALL_PAGE_LIMIT = 720;

export const REPORT_BPA_RULES: ReportBpaRule[] = [
  {
    category: 'Performance',
    scope: 'Custom Visual',
    severity: 'Warning',
    name: 'Remove custom visuals which are not used in the report',
    description:
      'Removing unused custom visuals from a report may lead to faster report performance.',
    predicate: (o) => (o as CustomVisualObj).usedInReport === false,
  },
  {
    category: 'Performance',
    scope: 'Page',
    severity: 'Warning',
    name: 'Reduce the number of visible visuals on the page',
    description: `Reducing the number of visible visuals on a page will lead to faster report performance. This rule flags pages with over ${VISIBLE_VISUALS_LIMIT} visible visuals.`,
    predicate: (o) => (o as PageObj).visibleVisualCount > VISIBLE_VISUALS_LIMIT,
  },
  {
    category: 'Performance',
    scope: 'Visual',
    severity: 'Warning',
    name: 'Reduce the number of objects within visuals',
    description:
      'Reducing the number of objects (i.e. measures, columns) which are used in a visual will lead to faster report performance.',
    predicate: (o) => (o as VisualObj).objectCount > VISUAL_OBJECT_LIMIT,
  },
  {
    category: 'Performance',
    scope: ['Report Filter', 'Page Filter', 'Visual Filter'],
    severity: 'Warning',
    name: 'Reduce usage of filters on measures',
    description:
      'Measure filters may cause performance degradation, especially against a large semantic model.',
    predicate: (o) => (o as FilterObj).objectType === 'Measure',
  },
  {
    category: 'Performance',
    scope: 'Visual',
    severity: 'Warning',
    name: "Avoid setting 'Show items with no data' on columns",
    description:
      'This setting will show all column values for all columns in the visual which may lead to performance degradation.',
    url: 'https://learn.microsoft.com/power-bi/create-reports/desktop-show-items-no-data',
    predicate: (o) => (o as VisualObj).showItemsWithNoData === true,
  },
  {
    category: 'Performance',
    scope: 'Page',
    severity: 'Warning',
    name: 'Avoid tall report pages with vertical scrolling',
    description:
      'Report pages are designed to be in a single view and not scroll. Pages with scrolling is an indicator that the page has too many elements.',
    predicate: (o) => (o as PageObj).height > TALL_PAGE_LIMIT,
  },
  {
    category: 'Performance',
    scope: 'Custom Visual',
    severity: 'Info',
    name: 'Reduce usage of custom visuals',
    description: 'Using custom visuals may lead to performance degradation.',
    predicate: () => true,
  },
  {
    category: 'Maintenance',
    scope: 'Report Level Measure',
    severity: 'Info',
    name: 'Move report-level measures into the semantic model.',
    description:
      'It is a best practice to keep measures defined in the semantic model and not in the report.',
    predicate: () => true,
  },
  {
    category: 'Performance',
    scope: ['Report Filter', 'Page Filter', 'Visual Filter'],
    severity: 'Info',
    name: 'Reduce usage of TopN filtering within visuals',
    description:
      'TopN filtering may cause performance degradation, especially against a high cardinality column.',
    predicate: (o) => (o as FilterObj).filterType === 'TopN',
  },
];
