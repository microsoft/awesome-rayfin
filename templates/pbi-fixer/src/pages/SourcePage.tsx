// SourcePage — standalone, full-window PBIR/TMDL source editor. Opened from the
// Model / Report Explorer "Pop out" button via the /source route so the raw
// definition can live in its own browser window alongside the main app. Reads
// the target from query params (ws, kind, report, dataset, name) and shares the
// MSAL session with the opener through the same-origin localStorage cache.
import { FluentProvider, webLightTheme, Text, makeStyles, shorthands } from '@fluentui/react-components';
import { useSearchParams } from 'react-router-dom';

import { DefinitionSource } from '@/components/explorer/DefinitionSource';
import type { DefinitionKind } from '@/services/fabricRest';
import { ICON_ACCENT } from '@/explorer/theme';

const useStyles = makeStyles({
  shell: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#f7f7f8',
    color: '#1a1a1a',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('10px'),
    flexShrink: 0,
    ...shorthands.padding('10px', '20px'),
    backgroundColor: '#ffffff',
    ...shorthands.borderBottom('1px', 'solid', '#e5e5e5'),
  },
  dot: { width: '10px', height: '10px', borderRadius: '50%', backgroundColor: ICON_ACCENT },
  body: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.padding('12px', '16px'),
  },
});

export function SourcePage() {
  const styles = useStyles();
  const [params] = useSearchParams();

  const ws = params.get('ws') ?? '';
  const kind: DefinitionKind = params.get('kind') === 'model' ? 'model' : 'report';
  const reportId = params.get('report') ?? undefined;
  const datasetId = params.get('dataset') ?? undefined;
  const name = params.get('name') ?? '';
  const initialPath = params.get('path') ?? undefined;
  const lineParam = Number(params.get('line'));
  const initialLine = Number.isFinite(lineParam) && lineParam > 0 ? lineParam : undefined;
  const formatLabel = kind === 'model' ? 'TMDL' : 'PBIR';
  const itemId = kind === 'model' ? datasetId : reportId;
  const fallbackTitle = kind === 'model' ? 'Semantic model' : 'Report';

  return (
    <FluentProvider theme={webLightTheme}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <span className={styles.dot} />
          <Text size={400} weight="semibold">
            {(name || fallbackTitle)} — {formatLabel} source
          </Text>
        </header>
        <main className={styles.body}>
          {ws && itemId ? (
            <DefinitionSource
              workspaceId={ws}
              reportId={reportId}
              datasetId={datasetId}
              only={kind}
              autoLoad
              initialPath={initialPath}
              initialLine={initialLine}
            />
          ) : (
            <Text>Missing parameters. Open this window from the Model or Report Explorer.</Text>
          )}
        </main>
      </div>
    </FluentProvider>
  );
}
