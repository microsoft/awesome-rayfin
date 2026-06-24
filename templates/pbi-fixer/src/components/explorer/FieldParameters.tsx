// FieldParameters — scaffold a Power BI field parameter from selected fields.
//
// PKG-13 (MA6). Scan the model for measures and report-usable columns, let the
// author pick the ones to expose, give the parameter a name, and write a
// three-column field-parameter calc-table (display / fields / order) with the
// ParameterMetadata extended property in a single lossless TMDL round-trip.

import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Spinner,
  Text,
  Badge,
  Input,
  Checkbox,
  Dropdown,
  Option,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import {
  Options20Regular,
  ArrowSync20Regular,
  Add20Regular,
  ArrowUp16Regular,
  ArrowDown16Regular,
  Dismiss16Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, GRAY_COLOR, SECTION_BG } from '@/explorer/theme';
import {
  scanFieldParamCandidates,
  addFieldParameter,
  type FieldParamCandidate,
  type FieldParamField,
} from '@/services/ibcsModel';

export interface FieldParametersProps {
  workspaceId: string;
  datasetId: string;
  datasetName: string;
}

type KindFilter = 'all' | 'measures' | 'columns';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, ...shorthands.gap('10px') },
  toolbar: { display: 'flex', alignItems: 'center', ...shorthands.gap('10px'), flexWrap: 'wrap', flexShrink: 0 },
  grow: { flex: 1 },
  status: { fontSize: '12px', color: GRAY_COLOR },
  err: { fontSize: '12px', color: tokens.colorPaletteRedForeground1 },
  ok: { fontSize: '12px', color: tokens.colorPaletteGreenForeground1 },
  body: { flex: 1, minHeight: 0, display: 'flex', ...shorthands.gap('10px') },
  pane: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('8px'),
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: SECTION_BG,
    ...shorthands.padding('10px', '12px'),
  },
  paneHead: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px'), fontWeight: '600', flexShrink: 0 },
  list: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
  candidate: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('8px'),
    ...shorthands.padding('4px', '2px'),
    ...shorthands.borderBottom('1px', 'solid', BORDER_COLOR),
  },
  cName: { fontSize: '12px', fontWeight: '600', wordBreak: 'break-word' },
  cTable: { fontSize: '11px', color: GRAY_COLOR, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  selRow: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('6px'),
    ...shorthands.padding('4px', '2px'),
    ...shorthands.borderBottom('1px', 'solid', BORDER_COLOR),
  },
  labelInput: { flex: 1, minWidth: 0 },
  empty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    ...shorthands.gap('8px'),
    ...shorthands.padding('30px'),
    textAlign: 'center',
    color: GRAY_COLOR,
  },
});

export function FieldParameters({ workspaceId, datasetId, datasetName }: FieldParametersProps) {
  const styles = useStyles();

  const [candidates, setCandidates] = useState<FieldParamCandidate[]>([]);
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [done, setDone] = useState(false);

  const [filter, setFilter] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [paramName, setParamName] = useState('Parameter');

  // Selected candidate keys in display order; per-key custom labels.
  const [selected, setSelected] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});

  const byKey = useMemo(() => {
    const m = new Map<string, FieldParamCandidate>();
    for (const c of candidates) m.set(c.key, c);
    return m;
  }, [candidates]);

  const ready = !!workspaceId && !!datasetId;

  const scan = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError('');
    setStatus('');
    setDone(false);
    try {
      const res = await scanFieldParamCandidates(workspaceId, datasetId);
      const all = [...res.measures, ...res.columns];
      setCandidates(all);
      setScanned(true);
      setSelected((prev) => prev.filter((k) => all.some((c) => c.key === k)));
      setStatus(`Found ${res.measures.length} measure(s) and ${res.columns.length} column(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [ready, workspaceId, datasetId]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return candidates.filter((c) => {
      if (kindFilter === 'measures' && c.kind !== 'measure') return false;
      if (kindFilter === 'columns' && c.kind !== 'column') return false;
      if (q && !(`${c.table} ${c.name}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [candidates, filter, kindFilter]);

  const toggle = useCallback((key: string, on: boolean) => {
    setSelected((prev) => (on ? (prev.includes(key) ? prev : [...prev, key]) : prev.filter((k) => k !== key)));
  }, []);

  const move = useCallback((key: string, dir: -1 | 1) => {
    setSelected((prev) => {
      const i = prev.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  const create = useCallback(async () => {
    if (!ready) return;
    const name = paramName.trim();
    if (!name) {
      setError('Enter a parameter name.');
      return;
    }
    const fields: FieldParamField[] = selected
      .map((k) => byKey.get(k))
      .filter((c): c is FieldParamCandidate => !!c)
      .map((c) => ({
        kind: c.kind,
        table: c.table,
        name: c.name,
        label: (labels[c.key] ?? c.name).trim() || c.name,
      }));
    if (fields.length === 0) {
      setError('Select at least one field.');
      return;
    }
    setBusy(true);
    setError('');
    setStatus('');
    setDone(false);
    try {
      const res = await addFieldParameter(workspaceId, datasetId, { name, fields });
      if (res.created) {
        setDone(true);
        setStatus(res.detail);
        setSelected([]);
      } else {
        setError(res.detail);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [ready, paramName, selected, byKey, labels, workspaceId, datasetId]);

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Options20Regular />
        <Text weight="semibold">Field parameters</Text>
        <Badge appearance="tint" color="informative">
          {datasetName || 'model'}
        </Badge>
        <Button
          appearance="primary"
          icon={loading ? <Spinner size="tiny" /> : <ArrowSync20Regular />}
          disabled={!ready || loading || busy}
          onClick={scan}
        >
          {scanned ? 'Rescan' : 'Scan model'}
        </Button>
        <div className={styles.grow} />
        {status && !error && <span className={done ? styles.ok : styles.status}>{status}</span>}
        {error && <span className={styles.err}>{error}</span>}
      </div>

      {!scanned ? (
        <div className={styles.empty}>
          <Options20Regular style={{ fontSize: 32 }} />
          <Text>Scan the model to list measures and columns you can expose through a field parameter.</Text>
        </div>
      ) : (
        <div className={styles.body}>
          {/* Candidate picker */}
          <div className={styles.pane}>
            <div className={styles.paneHead}>
              <Text weight="semibold">Fields</Text>
              <Badge appearance="outline">{filtered.length}</Badge>
              <div className={styles.grow} />
              <Dropdown
                size="small"
                value={kindFilter === 'all' ? 'All' : kindFilter === 'measures' ? 'Measures' : 'Columns'}
                selectedOptions={[kindFilter]}
                onOptionSelect={(_, d) => setKindFilter((d.optionValue as KindFilter) ?? 'all')}
                style={{ minWidth: 120 }}
              >
                <Option value="all">All</Option>
                <Option value="measures">Measures</Option>
                <Option value="columns">Columns</Option>
              </Dropdown>
              <Input
                size="small"
                placeholder="Filter…"
                value={filter}
                onChange={(_, d) => setFilter(d.value)}
                style={{ minWidth: 140 }}
              />
            </div>
            <div className={styles.list}>
              {filtered.map((c) => (
                <label key={c.key} className={styles.candidate}>
                  <Checkbox
                    checked={selected.includes(c.key)}
                    onChange={(_, d) => toggle(c.key, !!d.checked)}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div className={styles.cName}>
                      {c.name}{' '}
                      <Badge size="small" appearance="tint" color={c.kind === 'measure' ? 'brand' : 'informative'}>
                        {c.kind}
                      </Badge>
                    </div>
                    <div className={styles.cTable}>{c.table}</div>
                  </div>
                </label>
              ))}
              {filtered.length === 0 && <div className={styles.status}>No fields match the filter.</div>}
            </div>
          </div>

          {/* Selection + create */}
          <div className={styles.pane}>
            <div className={styles.paneHead}>
              <Text weight="semibold">Parameter</Text>
              <Badge appearance="outline">{selected.length}</Badge>
            </div>
            <Input
              value={paramName}
              onChange={(_, d) => setParamName(d.value)}
              placeholder="Parameter name"
              disabled={busy}
            />
            <div className={styles.list}>
              {selected.map((k, idx) => {
                const c = byKey.get(k);
                if (!c) return null;
                return (
                  <div key={k} className={styles.selRow}>
                    <Text size={200} style={{ width: 18, textAlign: 'right', color: GRAY_COLOR }}>
                      {idx + 1}
                    </Text>
                    <Input
                      className={styles.labelInput}
                      size="small"
                      value={labels[k] ?? c.name}
                      onChange={(_, d) => setLabels((prev) => ({ ...prev, [k]: d.value }))}
                      disabled={busy}
                    />
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<ArrowUp16Regular />}
                      disabled={idx === 0 || busy}
                      onClick={() => move(k, -1)}
                      aria-label="Move up"
                    />
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<ArrowDown16Regular />}
                      disabled={idx === selected.length - 1 || busy}
                      onClick={() => move(k, 1)}
                      aria-label="Move down"
                    />
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<Dismiss16Regular />}
                      disabled={busy}
                      onClick={() => toggle(k, false)}
                      aria-label="Remove"
                    />
                  </div>
                );
              })}
              {selected.length === 0 && (
                <div className={styles.status}>Tick fields on the left to build the parameter.</div>
              )}
            </div>
            <Button
              appearance="primary"
              icon={busy ? <Spinner size="tiny" /> : <Add20Regular />}
              disabled={!ready || busy || selected.length === 0 || !paramName.trim()}
              onClick={create}
            >
              Create field parameter
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
