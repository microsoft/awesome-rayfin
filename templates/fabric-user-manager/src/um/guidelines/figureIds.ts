/** The drawings of the guide. Kept apart so the content stays free of components. */
export const FIGURE_IDS = [
  'storage-modes',
  'logic-upstream',
  'cardinality',
  'schema-shapes',
  'shared-dimensions',
  'filter-direction',
  'dax-divide',
  'dax-var',
  'dax-switch',
  'measure-folders',
  'hidden-keys',
  'name-pairs',
  'measure-anatomy',
  'title-concept',
  'filter-pane',
  'canvas-share',
  'three-layers',
  'deviation-table',
  'page-density',
  'orientation',
  'time-deviations',
  'scenarios',
  'density',
  'kpi-card',
  'deviation-colors',
  'format-cards',
] as const;

export type FigureId = (typeof FIGURE_IDS)[number];

/**
 * Where each drawing is shown: with a topic (`2.5`) or right under one of its
 * rules (`2.5/7`, the seventh rule of the topic). One list for both languages,
 * so a drawing cannot sit in different places in German and English.
 */
export const FIGURE_PLACES: Record<string, FigureId[]> = {
  '1.1': ['storage-modes'],
  '1.2/3': ['cardinality'],
  '1.3/1': ['logic-upstream'],
  '2.1/1': ['schema-shapes'],
  '2.1/2': ['shared-dimensions'],
  '2.2/2': ['filter-direction'],
  '2.4/1': ['hidden-keys'],
  '2.5/2': ['measure-folders'],
  '2.6/1': ['dax-divide'],
  '2.6/2': ['dax-var'],
  '2.6/3': ['dax-switch'],
  '2.7': ['format-cards'],
  '2.10/7': ['measure-anatomy'],
  // Above the groups of the style guide: the drawing shows the standard itself, not an organization's version of it.
  '2.11': ['name-pairs'],
  '3.1/1': ['three-layers', 'deviation-table'],
  '3.1/2': ['title-concept'],
  '3.1/3': ['page-density'],
  '3.2/1': ['filter-pane', 'canvas-share'],
  '3.3/1': ['time-deviations'],
  '3.3/2': ['orientation'],
  '3.3/3': ['scenarios'],
  '3.3/4': ['deviation-colors'],
  '3.3/5': ['density'],
  '3.3/6': ['kpi-card'],
};
