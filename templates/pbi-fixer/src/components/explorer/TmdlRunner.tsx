// TmdlRunner — paste arbitrary TMDL and execute it against Fabric: either
// create a brand-new semantic model from the pasted `table` block(s), or add
// those tables to an existing model in the workspace. A power-user companion to
// the Metric View Migration tab; both share the engine in `services/tmdlRunner`.

import { useEffect, useState } from 'react';
import {
  Button,
  Textarea,
  Input,
  Text,
  Radio,
  RadioGroup,
  Select,
  Spinner,
  Tooltip,
  MessageBar,
  MessageBarBody,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  PlayCircle20Regular,
  DocumentAdd20Regular,
  ChevronDown20Regular,
  ChevronRight20Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, GRAY_COLOR } from '@/explorer/theme';
import { listSemanticModels } from '@/services/fabricRest';
import { createSemanticModel, addTablesToModel } from '@/services/tmdlRunner';

const SAMPLE_TMDL = `table SalesByRegion
	column Region
		dataType: string
		summarizeBy: none
		sourceColumn: Region

	column Revenue
		dataType: double
		summarizeBy: sum
		sourceColumn: Revenue

	measure 'Total Revenue' = SUM(SalesByRegion[Revenue])
		formatString: #,0

	partition SalesByRegion = entity
		mode: directLake
		source
			entityName: sales_by_region
			schemaName: dbo
			expressionSource: LakehouseSource`;

const SAMPLE_EXPR = `expression LakehouseSource =
		let
			Source = AzureStorage.DataLake("https://onelake.dfs.fabric.microsoft.com/<workspaceId>/<lakehouseId>", [HierarchicalNavigation=true])
		in
			Source`;

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, ...shorthands.gap('12px') },
  intro: { fontSize: '12px', color: GRAY_COLOR, lineHeight: '17px' },
  toolbar: { display: 'flex', alignItems: 'center', ...shorthands.gap('10px'), flexWrap: 'wrap', flexShrink: 0 },
  spacer: { flex: 1 },
  modeRow: { display: 'flex', alignItems: 'center', ...shorthands.gap('16px'), flexWrap: 'wrap', flexShrink: 0 },
  targetRow: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px'), flexWrap: 'wrap', flexShrink: 0 },
  label: { fontSize: '12px', fontWeight: 600 },
  body: { display: 'flex', flexDirection: 'column', ...shorthands.gap('6px'), flex: 1, minHeight: 0 },
  tmdl: { flex: 1, minHeight: 0, fontFamily: 'Consolas, monospace', fontSize: '12px' },
  exprToggle: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('4px'),
    cursor: 'pointer',
    color: GRAY_COLOR,
    fontSize: '12px',
    fontWeight: 600,
    ...shorthands.border('none'),
    backgroundColor: 'transparent',
    ...shorthands.padding('2px', '0'),
    alignSelf: 'flex-start',
  },
  exprBox: {
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('6px'),
    fontFamily: 'Consolas, monospace',
    fontSize: '12px',
  },
});

export interface TmdlRunnerProps {
  workspaceId: string;
  datasetId: string;
  datasetName: string;
}

type Mode = 'new' | 'existing';

export function TmdlRunner(props: TmdlRunnerProps) {
  const { workspaceId, datasetId } = props;
  const styles = useStyles();

  const [tmdl, setTmdl] = useState('');
  const [mode, setMode] = useState<Mode>('new');
  const [modelName, setModelName] = useState('');
  const [targetId, setTargetId] = useState(datasetId);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const [showExpr, setShowExpr] = useState(false);
  const [expressions, setExpressions] = useState('');

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load the workspace's semantic models for the "add to existing" picker.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    setLoadingModels(true);
    listSemanticModels(workspaceId)
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        setTargetId((cur) => cur || datasetId || list[0]?.id || '');
      })
      .catch(() => {
        /* leave the list empty — the picker just shows no options */
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, datasetId]);

  const loadSample = () => {
    setTmdl(SAMPLE_TMDL);
    setExpressions(SAMPLE_EXPR);
    setShowExpr(true);
    setModelName((n) => n || 'Sales Model');
    setError(null);
    setSuccess(null);
  };

  const run = async () => {
    setError(null);
    setSuccess(null);
    setRunning(true);
    try {
      const opts = expressions.trim() ? { expressionsTmdl: expressions } : {};
      if (mode === 'new') {
        const res = await createSemanticModel(workspaceId, modelName, tmdl, opts);
        setSuccess(
          `Created semantic model “${res.name}” (${res.id}) with ${res.tables.length} table(s): ${res.tables.join(', ')}.`
        );
      } else {
        if (!targetId) throw new Error('Select a target semantic model.');
        const res = await addTablesToModel(workspaceId, targetId, tmdl, opts);
        const parts: string[] = [];
        if (res.added.length) parts.push(`added ${res.added.join(', ')}`);
        if (res.updated.length) parts.push(`updated ${res.updated.join(', ')}`);
        const name = models.find((m) => m.id === targetId)?.name ?? targetId;
        setSuccess(`Saved to “${name}”: ${parts.join('; ') || 'no changes'}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const canRun =
    !running &&
    !!tmdl.trim() &&
    (mode === 'new' ? !!modelName.trim() : !!targetId) &&
    !!workspaceId;

  return (
    <div className={styles.root}>
      <Text className={styles.intro}>
        Paste one or more TMDL <code>table</code> blocks, then either create a new semantic model or
        add the tables to an existing one. Direct Lake partitions need a matching shared
        <code> expression</code> — add it under “Shared expressions”. Each <code>table</code> block
        becomes its own definition part; existing tables with the same name are overwritten.
      </Text>

      <div className={styles.toolbar}>
        <Tooltip content="Load a sample table + Direct Lake expression" relationship="label">
          <Button appearance="subtle" icon={<DocumentAdd20Regular />} onClick={loadSample}>
            Sample
          </Button>
        </Tooltip>
        <Button
          appearance="primary"
          icon={running ? <Spinner size="tiny" /> : <PlayCircle20Regular />}
          onClick={run}
          disabled={!canRun}
        >
          {mode === 'new' ? 'Create semantic model' : 'Add to model'}
        </Button>
      </div>

      <div className={styles.modeRow}>
        <RadioGroup
          layout="horizontal"
          value={mode}
          onChange={(_, d) => setMode(d.value as Mode)}
        >
          <Radio value="new" label="New semantic model" />
          <Radio value="existing" label="Add to existing model" />
        </RadioGroup>

        {mode === 'new' ? (
          <div className={styles.targetRow}>
            <Text className={styles.label}>Name</Text>
            <Input
              size="small"
              placeholder="New model name"
              value={modelName}
              onChange={(_, d) => setModelName(d.value)}
              style={{ width: '220px' }}
            />
          </div>
        ) : (
          <div className={styles.targetRow}>
            <Text className={styles.label}>Target</Text>
            <Select
              value={targetId}
              onChange={(_, d) => setTargetId(d.value)}
              disabled={loadingModels}
              style={{ minWidth: '240px' }}
            >
              {models.length === 0 && <option value="">{loadingModels ? 'Loading…' : 'No models found'}</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {success && (
        <MessageBar intent="success">
          <MessageBarBody>{success}</MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.body}>
        <Text className={styles.label}>TMDL (one or more table blocks)</Text>
        <Textarea
          className={styles.tmdl}
          textarea={{ style: { fontFamily: 'Consolas, monospace', fontSize: '12px', minHeight: '100%' } }}
          value={tmdl}
          onChange={(_, d) => setTmdl(d.value)}
          placeholder={'table MyTable\n\tcolumn Id\n\t\tdataType: int64\n\t\tsourceColumn: Id\n\n\tpartition MyTable = entity\n\t\tmode: directLake\n\t\tsource\n\t\t\tentityName: my_table\n\t\t\texpressionSource: LakehouseSource'}
          resize="none"
        />

        <button
          type="button"
          className={styles.exprToggle}
          onClick={() => setShowExpr((s) => !s)}
        >
          {showExpr ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
          Shared expressions (M) — optional
        </button>
        {showExpr && (
          <Textarea
            className={styles.exprBox}
            textarea={{ style: { fontFamily: 'Consolas, monospace', fontSize: '12px', minHeight: '120px' } }}
            value={expressions}
            onChange={(_, d) => setExpressions(d.value)}
            placeholder={'expression LakehouseSource =\n\t\tlet\n\t\t\tSource = AzureStorage.DataLake("https://onelake.dfs.fabric.microsoft.com/<ws>/<lakehouse>", [HierarchicalNavigation=true])\n\t\tin\n\t\t\tSource'}
            resize="vertical"
          />
        )}
      </div>
    </div>
  );
}
