// ModelDocumentation — PKG-8 / C8.
//
// Turns the connected model into a self-documenting one and (optionally) drops a
// ready-made documentation page into the connected report. Three cards:
//   1. Add documentation tables  — _Tables / _Columns / _DAX Measures /
//      _Relationships calculated tables built from INFO.VIEW.*.
//   2. Refresh documentation tables — full-refresh the calc tables so they
//      populate after they were added.
//   3. Add documentation page — merge the bundled template page (8 visuals,
//      4 bookmarks) into the connected PBIR report.

import { useCallback, useState } from 'react';
import {
  Button,
  Spinner,
  Text,
  MessageBar,
  MessageBarBody,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  DocumentBulletList20Regular,
  Table20Regular,
  ArrowSync20Regular,
  DocumentArrowRight20Regular,
  BookInformation20Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, ICON_ACCENT, GRAY_COLOR } from '@/explorer/theme';
import {
  addDocumentationTables,
  refreshDocumentationTables,
  addDocumentationPage,
} from '@/services/modelDocumentation';

export interface ModelDocumentationProps {
  workspaceId: string;
  datasetId: string;
  datasetName: string;
  reportId: string;
  reportName: string;
}

interface Result {
  ok: boolean;
  text: string;
}

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, ...shorthands.gap('10px') },
  toolbar: { display: 'flex', alignItems: 'center', ...shorthands.gap('10px'), flexWrap: 'wrap', flexShrink: 0 },
  status: { fontSize: '12px', color: GRAY_COLOR },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', ...shorthands.gap('14px') },
  card: {
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: '#ffffff',
    ...shorthands.padding('14px', '16px'),
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('10px'),
  },
  cardHead: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px') },
  cardTitle: { fontSize: '14px', fontWeight: '700' },
  cardHint: { fontSize: '12px', color: GRAY_COLOR },
  row: { display: 'flex', alignItems: 'center', ...shorthands.gap('12px'), flexWrap: 'wrap' },
  tableList: { fontSize: '12px', color: '#333', margin: 0, paddingLeft: '18px' },
});

export function ModelDocumentation({
  workspaceId,
  datasetId,
  datasetName,
  reportId,
  reportName,
}: ModelDocumentationProps) {
  const styles = useStyles();
  const modelReady = !!datasetId;
  const reportReady = !!reportId;

  const [tablesBusy, setTablesBusy] = useState(false);
  const [tablesResult, setTablesResult] = useState<Result | null>(null);

  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshResult, setRefreshResult] = useState<Result | null>(null);

  const [pageBusy, setPageBusy] = useState(false);
  const [pageResult, setPageResult] = useState<Result | null>(null);

  const runAddTables = useCallback(async () => {
    setTablesBusy(true);
    setTablesResult(null);
    try {
      const r = await addDocumentationTables(workspaceId, datasetId);
      setTablesResult({ ok: r.changed > 0 || r.created.length === 0, text: r.detail });
    } catch (e) {
      setTablesResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTablesBusy(false);
    }
  }, [workspaceId, datasetId]);

  const runRefresh = useCallback(async () => {
    setRefreshBusy(true);
    setRefreshResult(null);
    try {
      const r = await refreshDocumentationTables(workspaceId, datasetId);
      setRefreshResult({ ok: true, text: r.detail });
    } catch (e) {
      setRefreshResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setRefreshBusy(false);
    }
  }, [workspaceId, datasetId]);

  const runAddPage = useCallback(async () => {
    setPageBusy(true);
    setPageResult(null);
    try {
      const r = await addDocumentationPage(workspaceId, reportId);
      setPageResult({ ok: r.added, text: r.detail });
    } catch (e) {
      setPageResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setPageBusy(false);
    }
  }, [workspaceId, reportId]);

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <DocumentBulletList20Regular style={{ color: ICON_ACCENT }} />
        <span className={styles.status}>
          {modelReady ? `Model documentation · ${datasetName}` : 'Select a semantic model first.'}
        </span>
      </div>

      <div className={styles.body}>
        {/* 1 — Documentation tables */}
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <Table20Regular style={{ color: ICON_ACCENT }} />
            <span className={styles.cardTitle}>Add documentation tables</span>
          </div>
          <Text className={styles.cardHint}>
            Adds four calculated tables built from the <code>INFO.VIEW.*</code> functions so the
            model documents itself:
          </Text>
          <ul className={styles.tableList}>
            <li>
              <code>_Tables</code> — name, description, data category, storage mode, expression
            </li>
            <li>
              <code>_Columns</code> — name, table, data type, expression, format string, sort-by
            </li>
            <li>
              <code>_DAX Measures</code> — name, table, expression, format string, display folder
            </li>
            <li>
              <code>_Relationships</code> — from / to table, column and cardinality
            </li>
          </ul>
          <div className={styles.row}>
            <Button
              appearance="primary"
              icon={tablesBusy ? <Spinner size="tiny" /> : <Table20Regular />}
              disabled={!modelReady || tablesBusy}
              onClick={runAddTables}
            >
              Add documentation tables
            </Button>
          </div>
          {tablesResult && (
            <MessageBar intent={tablesResult.ok ? 'success' : 'error'}>
              <MessageBarBody>{tablesResult.text}</MessageBarBody>
            </MessageBar>
          )}
        </div>

        {/* 2 — Refresh */}
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <ArrowSync20Regular style={{ color: ICON_ACCENT }} />
            <span className={styles.cardTitle}>Refresh documentation tables</span>
          </div>
          <Text className={styles.cardHint}>
            Calculated tables only populate after a refresh. Run this once the tables have been
            added to fill them with the current model metadata.
          </Text>
          <div className={styles.row}>
            <Button
              appearance="secondary"
              icon={refreshBusy ? <Spinner size="tiny" /> : <ArrowSync20Regular />}
              disabled={!modelReady || refreshBusy}
              onClick={runRefresh}
            >
              Refresh documentation tables
            </Button>
          </div>
          {refreshResult && (
            <MessageBar intent={refreshResult.ok ? 'success' : 'error'}>
              <MessageBarBody>{refreshResult.text}</MessageBarBody>
            </MessageBar>
          )}
        </div>

        {/* 3 — Documentation page */}
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <DocumentArrowRight20Regular style={{ color: ICON_ACCENT }} />
            <span className={styles.cardTitle}>Add documentation page to the report</span>
          </div>
          <Text className={styles.cardHint}>
            Merges a ready-made <strong>Documentation</strong> page (8 visuals + 4 bookmarks) into
            the connected report. The page binds to the four documentation tables above, so add and
            refresh them first.
          </Text>
          <div className={styles.row}>
            <BookInformation20Regular style={{ color: ICON_ACCENT }} />
            <span className={styles.status}>
              {reportReady ? `Target report · ${reportName}` : 'Select a report to enable this.'}
            </span>
          </div>
          <div className={styles.row}>
            <Button
              appearance="primary"
              icon={pageBusy ? <Spinner size="tiny" /> : <DocumentArrowRight20Regular />}
              disabled={!reportReady || pageBusy}
              onClick={runAddPage}
            >
              Add documentation page
            </Button>
          </div>
          {pageResult && (
            <MessageBar intent={pageResult.ok ? 'success' : 'error'}>
              <MessageBarBody>{pageResult.text}</MessageBarBody>
            </MessageBar>
          )}
        </div>
      </div>
    </div>
  );
}
