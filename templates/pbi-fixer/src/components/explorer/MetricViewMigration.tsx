// MetricViewMigration — convert a Databricks Unity Catalog *metric view*
// (YAML) into a Power BI Direct Lake semantic-model table (PKG-15 · D6).
//
// Paste the metric-view definition, hit Migrate, and the tool parses the
// dimensions / measures, translates the SQL aggregate expressions into DAX,
// and emits a downloadable TMDL table (Direct Lake partition). Pure
// client-side — no Databricks connection required.

import { useState } from 'react';
import {
  Button,
  Textarea,
  Input,
  Text,
  Tooltip,
  MessageBar,
  MessageBarBody,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  Wand20Regular,
  ArrowDownload20Regular,
  DocumentAdd20Regular,
  Copy20Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, GRAY_COLOR, SECTION_BG } from '@/explorer/theme';
import {
  parseMetricView,
  migrateMetricView,
  downloadTmdl,
  SAMPLE_METRIC_VIEW,
  type MigrationResult,
} from '@/services/metricViewMigration';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, ...shorthands.gap('12px') },
  intro: { fontSize: '12px', color: GRAY_COLOR, lineHeight: '17px' },
  toolbar: { display: 'flex', alignItems: 'center', ...shorthands.gap('10px'), flexWrap: 'wrap', flexShrink: 0 },
  spacer: { flex: 1 },
  nameField: { display: 'flex', alignItems: 'center', ...shorthands.gap('6px') },
  body: { display: 'flex', ...shorthands.gap('14px'), flex: 1, minHeight: 0 },
  pane: { display: 'flex', flexDirection: 'column', ...shorthands.gap('6px'), minHeight: 0, minWidth: 0 },
  paneInput: { flex: '0 0 42%' },
  paneOut: { flex: 1 },
  label: { fontSize: '12px', fontWeight: 600 },
  yaml: { flex: 1, minHeight: 0, fontFamily: 'Consolas, monospace', fontSize: '12px' },
  outBox: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: SECTION_BG,
    ...shorthands.padding('10px', '12px'),
  },
  sectionTitle: { fontSize: '12px', fontWeight: 600, marginTop: '8px', marginBottom: '4px' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
  th: {
    textAlign: 'left',
    ...shorthands.borderBottom('1px', 'solid', BORDER_COLOR),
    ...shorthands.padding('3px', '6px'),
    color: GRAY_COLOR,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  td: {
    ...shorthands.borderBottom('1px', 'solid', BORDER_COLOR),
    ...shorthands.padding('3px', '6px'),
    verticalAlign: 'top',
  },
  mono: { fontFamily: 'Consolas, monospace', fontSize: '11.5px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  hiddenTag: { color: GRAY_COLOR, fontStyle: 'italic' },
  tmdlPre: {
    fontFamily: 'Consolas, monospace',
    fontSize: '11.5px',
    whiteSpace: 'pre',
    overflowX: 'auto',
    ...shorthands.margin(0),
    ...shorthands.padding('8px', '10px'),
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('6px'),
    backgroundColor: '#ffffff',
  },
  placeholder: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: GRAY_COLOR,
    fontSize: '13px',
  },
});

export interface MetricViewMigrationProps {
  workspaceId: string;
  datasetId: string;
  datasetName: string;
}

export function MetricViewMigration(_props: MetricViewMigrationProps) {
  const styles = useStyles();
  const [yaml, setYaml] = useState('');
  const [tableName, setTableName] = useState('');
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const migrate = () => {
    setError(null);
    setCopied(false);
    try {
      const view = parseMetricView(yaml);
      const res = migrateMetricView(view, tableName);
      setResult(res);
      if (!res.entityName && res.columns.length === 0 && res.measures.length === 0) {
        setError('Nothing was parsed from the metric view. Check the YAML structure.');
      }
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const loadSample = () => {
    setYaml(SAMPLE_METRIC_VIEW);
    setError(null);
    setResult(null);
  };

  const download = () => {
    if (result) downloadTmdl(`${result.tableName}.tmdl`, result.tmdl);
  };

  const copyTmdl = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.tmdl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <div className={styles.root}>
      <Text className={styles.intro}>
        Convert a Databricks Unity Catalog metric view into a Power BI Direct Lake table. Dimensions
        become columns, measures are translated from SQL aggregates to DAX, and a Direct Lake
        partition is generated from the metric view&apos;s source. Paste the YAML definition below.
      </Text>

      <div className={styles.toolbar}>
        <Tooltip content="Load a sample metric view" relationship="label">
          <Button appearance="subtle" icon={<DocumentAdd20Regular />} onClick={loadSample}>
            Sample
          </Button>
        </Tooltip>
        <Button appearance="primary" icon={<Wand20Regular />} onClick={migrate} disabled={!yaml.trim()}>
          Migrate to Direct Lake
        </Button>
        <div className={styles.nameField}>
          <Text size={200}>Table name</Text>
          <Input
            size="small"
            placeholder="(from source)"
            value={tableName}
            onChange={(_, d) => setTableName(d.value)}
            style={{ width: '160px' }}
          />
        </div>
        <div className={styles.spacer} />
        <Button
          appearance="subtle"
          icon={<Copy20Regular />}
          onClick={copyTmdl}
          disabled={!result}
        >
          {copied ? 'Copied' : 'Copy TMDL'}
        </Button>
        <Button
          appearance="subtle"
          icon={<ArrowDownload20Regular />}
          onClick={download}
          disabled={!result}
        >
          Download .tmdl
        </Button>
      </div>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {result && result.warnings.length > 0 && (
        <MessageBar intent="warning">
          <MessageBarBody>
            {result.warnings.length} note(s): {result.warnings[0]}
            {result.warnings.length > 1 ? ` (+${result.warnings.length - 1} more)` : ''}
          </MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.body}>
        <div className={`${styles.pane} ${styles.paneInput}`}>
          <Text className={styles.label}>Metric view (YAML)</Text>
          <Textarea
            className={styles.yaml}
            textarea={{ style: { fontFamily: 'Consolas, monospace', fontSize: '12px', minHeight: '100%' } }}
            value={yaml}
            onChange={(_, d) => setYaml(d.value)}
            placeholder={'version: 0.1\nsource: catalog.schema.table\ndimensions:\n  - name: Region\n    expr: region\nmeasures:\n  - name: Revenue\n    expr: SUM(amount)'}
            resize="none"
          />
        </div>

        <div className={`${styles.pane} ${styles.paneOut}`}>
          <Text className={styles.label}>Generated semantic model</Text>
          <div className={styles.outBox}>
            {!result ? (
              <div className={styles.placeholder}>
                Paste a metric view and choose “Migrate to Direct Lake”.
              </div>
            ) : (
              <>
                <Text size={200} style={{ color: GRAY_COLOR }}>
                  Table <b>{result.tableName}</b> · Direct Lake entity <b>{result.entityName}</b>
                  {result.schemaName ? ` · schema ${result.schemaName}` : ''}
                </Text>

                <div className={styles.sectionTitle}>Columns ({result.columns.length})</div>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Name</th>
                      <th className={styles.th}>Source</th>
                      <th className={styles.th}>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.columns.map((c) => (
                      <tr key={c.name}>
                        <td className={styles.td}>
                          {c.name}
                          {c.hidden && <span className={styles.hiddenTag}> (hidden)</span>}
                        </td>
                        <td className={styles.td}>
                          <span className={styles.mono}>{c.sourceColumn}</span>
                        </td>
                        <td className={styles.td}>{c.dataType}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className={styles.sectionTitle}>Measures ({result.measures.length})</div>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Name</th>
                      <th className={styles.th}>DAX</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.measures.map((m) => (
                      <tr key={m.name}>
                        <td className={styles.td}>{m.name}</td>
                        <td className={styles.td}>
                          <span className={styles.mono}>{m.dax}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className={styles.sectionTitle}>TMDL</div>
                <pre className={styles.tmdlPre}>{result.tmdl}</pre>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
