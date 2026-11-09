/** Every drawing by its id, shown in the language of the interface. */
import type { ReactElement } from 'react';

import type { Locale } from '@/i18n';

import type { FigureId } from './figureIds';
import {
  Cardinality,
  DaxDivide,
  DE_WORDS,
  Density,
  DeviationColors,
  EN_WORDS,
  KpiCard,
  MeasureFolders,
  Orientation,
  Scenarios,
  SchemaShapes,
  StorageModes,
  ThreeLayers,
  TitleConcept,
  WordsContext,
  type FigureProps,
} from './figures';
import {
  CanvasShare,
  DaxSwitch,
  DaxVar,
  DeviationTable,
  FilterDirection,
  FilterPane,
  FormatCards,
  HiddenKeys,
  LogicUpstream,
  MeasureAnatomy,
  NamePairs,
  PageDensity,
  SharedDimensions,
  TimeDeviations,
} from './figuresMore';

const FIGURES: Record<FigureId, (props: FigureProps) => ReactElement> = {
  'storage-modes': StorageModes,
  'logic-upstream': LogicUpstream,
  cardinality: Cardinality,
  'schema-shapes': SchemaShapes,
  'shared-dimensions': SharedDimensions,
  'filter-direction': FilterDirection,
  'dax-divide': DaxDivide,
  'dax-var': DaxVar,
  'dax-switch': DaxSwitch,
  'measure-folders': MeasureFolders,
  'hidden-keys': HiddenKeys,
  'name-pairs': NamePairs,
  'measure-anatomy': MeasureAnatomy,
  'title-concept': TitleConcept,
  'filter-pane': FilterPane,
  'canvas-share': CanvasShare,
  'three-layers': ThreeLayers,
  'deviation-table': DeviationTable,
  'page-density': PageDensity,
  orientation: Orientation,
  'time-deviations': TimeDeviations,
  scenarios: Scenarios,
  density: Density,
  'kpi-card': KpiCard,
  'deviation-colors': DeviationColors,
  'format-cards': FormatCards,
};

export function Figure({ id, team, stored, locale = 'en' }: { id: FigureId; locale?: Locale } & FigureProps) {
  const Drawing = FIGURES[id];
  return (
    <WordsContext.Provider value={locale === 'de' ? DE_WORDS : EN_WORDS}>
      <Drawing team={team} stored={stored} />
    </WordsContext.Provider>
  );
}
