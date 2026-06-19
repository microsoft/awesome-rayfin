// Sempy Runner — pick a sempy / sempy-labs function from a curated catalog,
// auto-bind workspace / report / dataset params from the connection bar, preview
// the generated Python, then either:
//   • Create + open a Fabric notebook (manual "Run all"), or
//   • Run it on Fabric now (on-demand RunNotebook job) and see the result inline.
//
// Ported from the Fabric Developer Hub "Sempy Runner" page, adapted to this
// app's `udf` service (server-side Fabric proxy + udf.runNotebook) instead of
// the AgentHub workloadClient. Fabric Spark ships sempy preinstalled; a `%pip
// install semantic-link-labs` cell is injected automatically when the snippet
// imports sempy_labs.

import React, { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Combobox,
  Option,
  Field,
  Input,
  Switch,
  Spinner,
  Text,
  Textarea,
  Title3,
  Badge,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Tooltip,
  Link,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import {
  Copy20Regular,
  ArrowDownload20Regular,
  Open20Regular,
  PlayCircle20Regular,
  TextWrap20Regular,
  TextWrapOff20Regular,
} from '@fluentui/react-icons';
import { udf, type NotebookRunResult } from '@/services/udfClient';
import {
  SEMPY_CATALOG,
  generateSempyCode,
  codeToNotebookJson,
  type SempyCategory,
  type SempyFunction,
  type SempyParam,
  type SempyArgValues,
} from '@/services/sempyCatalog';

const BLUE = {
  deep: '#1e3a8a',
  brand: '#2563eb',
  bright: '#3b82f6',
  soft: '#eff6ff',
  border: '#dbe6f5',
  borderStrong: '#bfdbfe',
  slate: '#1e293b',
  slateBar: '#0f172a',
};

const useStyles = makeStyles({
  root: {
    display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
    ...shorthands.gap('14px'),
    overflowX: 'hidden', overflowY: 'auto',
    paddingRight: '4px',
  },

  // Hero banner
  hero: {
    display: 'flex', alignItems: 'center', ...shorthands.gap('14px'),
    ...shorthands.padding('16px', '20px'),
    ...shorthands.borderRadius('12px'),
    backgroundImage: `linear-gradient(120deg, ${BLUE.deep} 0%, ${BLUE.brand} 55%, ${BLUE.bright} 100%)`,
    color: '#ffffff',
    boxShadow: '0 6px 20px rgba(37, 99, 235, 0.25)',
  },
  heroIcon: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '46px', height: '46px', flexShrink: 0,
    ...shorthands.borderRadius('12px'),
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    fontSize: '20px', color: '#ffffff',
  },
  heroText: { display: 'flex', flexDirection: 'column', ...shorthands.gap('3px') },
  heroTitle: { fontSize: '20px', fontWeight: 700, lineHeight: '24px', color: '#ffffff' },
  heroSub: { fontSize: '13px', lineHeight: '18px', color: 'rgba(255, 255, 255, 0.9)', maxWidth: '760px' },
  heroSpacer: { flexGrow: 1 },
  heroPill: {
    ...shorthands.padding('5px', '12px'),
    ...shorthands.borderRadius('999px'),
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    color: '#ffffff', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap',
  },

  // Card
  card: {
    display: 'flex', flexDirection: 'column', ...shorthands.gap('12px'),
    ...shorthands.padding('14px', '16px'),
    ...shorthands.borderRadius('10px'),
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
  },
  sectionLabel: {
    display: 'flex', alignItems: 'center', ...shorthands.gap('8px'),
    color: BLUE.brand, fontSize: '12px', fontWeight: 700,
    letterSpacing: '0.05em', textTransform: 'uppercase',
  },
  sectionBar: {
    width: '3px', height: '14px', ...shorthands.borderRadius('2px'),
    backgroundImage: `linear-gradient(${BLUE.brand}, ${BLUE.bright})`,
  },

  builder: { display: 'flex', ...shorthands.gap('12px'), flexWrap: 'wrap' },

  fnDesc: {
    display: 'flex', alignItems: 'center', ...shorthands.gap('8px'), flexWrap: 'wrap',
    ...shorthands.padding('10px', '12px'),
    ...shorthands.borderRadius('8px'),
    ...shorthands.border('1px', 'solid', 'rgba(37, 99, 235, 0.25)'),
    backgroundColor: 'rgba(37, 99, 235, 0.08)',
    fontSize: '13px',
  },
  fnCode: {
    fontFamily: 'Cascadia Code, Consolas, ui-monospace, monospace',
    fontSize: '12px', color: BLUE.brand,
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.padding('1px', '6px'),
    ...shorthands.borderRadius('5px'),
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
  },

  paramGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    ...shorthands.gap('14px'),
  },
  emptyParams: { color: tokens.colorNeutralForeground3, fontSize: '13px', fontStyle: 'italic' },

  codeWrap: {
    display: 'flex', flexDirection: 'column',
    ...shorthands.borderRadius('10px'),
    ...shorthands.border('1px', 'solid', BLUE.slateBar),
    backgroundColor: BLUE.slate,
    overflowX: 'hidden', overflowY: 'hidden',
    boxShadow: '0 4px 14px rgba(15, 23, 42, 0.18)',
  },
  codeToolbar: {
    display: 'flex', alignItems: 'center', ...shorthands.gap('8px'),
    ...shorthands.padding('8px', '12px'),
    backgroundColor: BLUE.slateBar,
    borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  langPill: {
    ...shorthands.padding('1px', '8px'),
    ...shorthands.borderRadius('999px'),
    backgroundColor: 'rgba(59, 130, 246, 0.22)',
    color: '#93c5fd', fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em',
  },
  codeToolbarSpacer: { flexGrow: 1 },
  codeBlock: {
    minHeight: '240px', maxHeight: '480px',
    overflowX: 'auto', overflowY: 'auto',
    ...shorthands.margin('0'),
    ...shorthands.padding('14px', '16px'),
    fontFamily: 'Cascadia Code, Consolas, ui-monospace, monospace',
    fontSize: '13px', lineHeight: '20px', whiteSpace: 'pre',
    color: '#e2e8f0',
  },
  resultBlock: {
    maxHeight: '320px', overflowX: 'auto', overflowY: 'auto',
    ...shorthands.margin('0'),
    ...shorthands.padding('14px', '16px'),
    fontFamily: 'Cascadia Code, Consolas, ui-monospace, monospace',
    fontSize: '12.5px', lineHeight: '19px',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    color: '#e2e8f0',
  },

  runRow: {
    display: 'flex', alignItems: 'center', ...shorthands.gap('12px'), flexWrap: 'wrap',
  },
  runHint: { color: tokens.colorNeutralForeground3, fontSize: '12px', flexGrow: 1, minWidth: '220px' },
  primaryBtn: {
    backgroundImage: `linear-gradient(120deg, ${BLUE.brand}, ${BLUE.bright})`,
    color: '#ffffff',
    ...shorthands.borderColor('transparent'),
    ':hover': {
      backgroundImage: `linear-gradient(120deg, ${BLUE.deep}, ${BLUE.brand})`,
      color: '#ffffff',
    },
    ':hover:active': {
      backgroundImage: `linear-gradient(120deg, ${BLUE.deep}, ${BLUE.deep})`,
      color: '#ffffff',
    },
  },
  secondaryBtn: {
    backgroundColor: tokens.colorNeutralBackground1,
    color: BLUE.brand,
    ...shorthands.borderColor(BLUE.borderStrong),
    ':hover': { backgroundColor: 'rgba(37, 99, 235, 0.12)', color: BLUE.bright },
  },

  empty: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    height: '100%', ...shorthands.padding('40px'), ...shorthands.gap('10px'),
    textAlign: 'center',
  },
  emptyIcon: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '64px', height: '64px', ...shorthands.borderRadius('16px'),
    backgroundImage: `linear-gradient(120deg, ${BLUE.deep}, ${BLUE.bright})`,
    color: '#ffffff', fontSize: '28px',
    boxShadow: '0 6px 20px rgba(37, 99, 235, 0.28)',
  },
});

const CATEGORIES: (SempyCategory | 'All')[] = [
  'All', 'Workspace', 'Capacity', 'Model', 'Report', 'Refresh', 'Vertipaq',
  'Lakehouse', 'DirectLake', 'Git', 'Notebook', 'Deployment', 'Admin', 'Misc',
];

function downloadBlob(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function b64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

interface CreatedNotebook {
  id: string;
  portalUrl: string;
}

/** Create a Fabric notebook from an .ipynb JSON string via the server proxy. */
async function createNotebook(
  workspaceId: string,
  displayName: string,
  ipynb: string
): Promise<CreatedNotebook> {
  const body = {
    displayName,
    description: 'Generated by Power BI Fixer · Sempy Runner',
    definition: {
      format: 'ipynb',
      parts: [{ path: 'notebook-content.ipynb', payload: b64(ipynb), payloadType: 'InlineBase64' }],
    },
  };
  const created = await udf.fabricProxy<{ id?: string; objectId?: string }>(
    'fabric',
    `/workspaces/${workspaceId}/notebooks`,
    'POST',
    body
  );
  const id = created?.id ?? created?.objectId ?? '';
  const portalUrl = id
    ? `https://app.powerbi.com/groups/${workspaceId}/synapsenotebooks/${id}`
    : `https://app.powerbi.com/groups/${workspaceId}/list`;
  return { id, portalUrl };
}

export interface SempyRunnerTabProps {
  workspaceId: string;
  workspaceName?: string;
  datasetName?: string;
  reportName?: string;
}

export const SempyRunnerTab: React.FC<SempyRunnerTabProps> = ({
  workspaceId,
  workspaceName,
  datasetName,
  reportName,
}) => {
  const styles = useStyles();
  const [category, setCategory] = useState<SempyCategory | 'All'>('All');
  const [subcategory, setSubcategory] = useState<string>('All');
  const [fnId, setFnId] = useState<string>(SEMPY_CATALOG[0]?.id ?? '');
  const [overrides, setOverrides] = useState<SempyArgValues>({});
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<
    (NotebookRunResult & { notebookId: string; notebookName: string; portalUrl: string }) | null
  >(null);
  const [status, setStatus] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  // Wrap long lines by default so nothing is clipped off the right edge; the
  // user can switch to no-wrap (horizontal scroll) for copy-faithful layout.
  const [wrapCode, setWrapCode] = useState(true);

  // Sub-categories available inside the current category ("All" wins until
  // a real category is picked). Always includes a leading "All".
  const subcategories = useMemo(() => {
    const inCat = category === 'All'
      ? SEMPY_CATALOG
      : SEMPY_CATALOG.filter((f) => f.category === category);
    const set = new Set<string>();
    inCat.forEach((f) => { if (f.subcategory) set.add(f.subcategory); });
    return ['All', ...Array.from(set).sort()];
  }, [category]);

  const visibleFns = useMemo(() => {
    const byCat = category === 'All'
      ? SEMPY_CATALOG
      : SEMPY_CATALOG.filter((f) => f.category === category);
    return subcategory === 'All' ? byCat : byCat.filter((f) => f.subcategory === subcategory);
  }, [category, subcategory]);

  const fn: SempyFunction | undefined = useMemo(
    () => SEMPY_CATALOG.find((f) => f.id === fnId),
    [fnId]
  );

  /** Auto-bound value for a typed param from the connection bar. */
  const autoValue = useCallback((p: SempyParam): string | undefined => {
    switch (p.kind) {
      case 'workspace': return workspaceName || workspaceId || undefined;
      case 'report':    return reportName || undefined;
      case 'dataset':   return datasetName || undefined;
      default:          return undefined;
    }
  }, [workspaceName, workspaceId, reportName, datasetName]);

  /** Effective value for a param: explicit user override → auto-bind → default. */
  const valueFor = useCallback((p: SempyParam): string | number | boolean | undefined => {
    const ov = overrides[p.name];
    if (ov !== undefined && ov !== '') return ov;
    const auto = autoValue(p);
    if (auto !== undefined && auto !== '') return auto;
    return p.default;
  }, [overrides, autoValue]);

  const code = useMemo(() => {
    if (!fn) return '';
    const values: SempyArgValues = {};
    for (const p of fn.params) {
      const v = valueFor(p);
      if (v !== undefined && v !== '') values[p.name] = v as string | number | boolean;
    }
    return generateSempyCode(fn, values);
  }, [fn, valueFor]);

  const safeFnName = (fn?.name ?? 'sempy_call').replace(/[^A-Za-z0-9_]+/g, '_');
  const notebookTitle = `${fn?.module ?? 'sempy'} · ${fn?.name ?? ''}`;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setStatus('Copied to clipboard.');
    } catch (e) {
      setErrorMsg(`Clipboard write failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onDownloadPy = () => {
    downloadBlob(`${safeFnName}.py`, code, 'text/x-python');
    setStatus(`Downloaded ${safeFnName}.py.`);
  };

  const onCreateNotebook = async () => {
    if (!fn || !workspaceId) return;
    setCreating(true);
    setErrorMsg('');
    setStatus('');
    try {
      const ipynb = codeToNotebookJson(code, notebookTitle);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const displayName = `Sempy Runner · ${fn.name} · ${stamp}`;
      const created = await createNotebook(workspaceId, displayName, ipynb);
      setStatus(`Created notebook "${displayName}". Opening in Fabric…`);
      if (created.portalUrl) window.open(created.portalUrl, '_blank', 'noopener');
    } catch (e) {
      setErrorMsg(`Notebook create failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreating(false);
    }
  };

  // Create the notebook AND execute it on Fabric via an on-demand RunNotebook
  // job, then surface the terminal status inline. The server proxy blocks on
  // the job until it reaches Completed / Failed, so this can take 1-3 min while
  // a Spark session spins up.
  const onRunOnFabric = async () => {
    if (!fn || !workspaceId) return;
    setRunning(true);
    setErrorMsg('');
    setStatus('');
    setRunResult(null);
    try {
      // captureExit injects a trailing cell that serialises `result` and returns
      // it via notebookutils.notebook.exit(...) so we can render it inline.
      const ipynb = codeToNotebookJson(code, notebookTitle, { captureExit: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const displayName = `Sempy Runner · ${fn.name} · ${stamp}`;
      setStatus('Creating notebook…');
      const created = await createNotebook(workspaceId, displayName, ipynb);
      setStatus('Running on Fabric — a Spark session may take 1-3 min to start…');
      const run = await udf.runNotebook(workspaceId, created.id);
      setRunResult({ ...run, notebookId: created.id, notebookName: displayName, portalUrl: created.portalUrl });
      setStatus('');
    } catch (e) {
      setErrorMsg(`Run failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  if (!workspaceId) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>{'\u25B6'}</div>
        <Title3>Sempy Runner</Title3>
        <Text style={{ color: tokens.colorNeutralForeground2, maxWidth: 440 }}>
          Select a workspace above to build a sempy / sempy-labs call and run it on Fabric.
        </Text>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {/* ── Hero ────────────────────────────────────────────── */}
      <div className={styles.hero}>
        <div className={styles.heroIcon}>{'\u25B6'}</div>
        <div className={styles.heroText}>
          <span className={styles.heroTitle}>Sempy Runner</span>
          <span className={styles.heroSub}>
            Build a <strong>sempy</strong> / <strong>sempy-labs</strong> call from the curated
            catalog, preview the generated Python, then run it on Fabric Spark or drop it into a
            notebook.
          </span>
        </div>
        <div className={styles.heroSpacer} />
        <span className={styles.heroPill}>{SEMPY_CATALOG.length} functions</span>
      </div>

      {/* ── Builder ─────────────────────────────────────────── */}
      <div className={styles.card}>
        <div className={styles.sectionLabel}>
          <span className={styles.sectionBar} />
          Choose a function
        </div>
        <div className={styles.builder}>
        <Field label="Category" style={{ minWidth: 160 }}>
          <Combobox
            value={category}
            selectedOptions={[category]}
            onOptionSelect={(_, d) => {
              const v = (d.optionValue || 'All') as SempyCategory | 'All';
              setCategory(v);
              setSubcategory('All');
              const next = (v === 'All' ? SEMPY_CATALOG : SEMPY_CATALOG.filter((f) => f.category === v))[0];
              if (next) setFnId(next.id);
            }}
          >
            {CATEGORIES.map((c) => <Option key={c} value={c}>{c}</Option>)}
          </Combobox>
        </Field>
        <Field label="Subcategory" style={{ minWidth: 160 }}>
          <Combobox
            value={subcategory}
            selectedOptions={[subcategory]}
            disabled={subcategories.length <= 1}
            onOptionSelect={(_, d) => {
              const v = d.optionValue || 'All';
              setSubcategory(v);
              const pool = category === 'All'
                ? SEMPY_CATALOG
                : SEMPY_CATALOG.filter((f) => f.category === category);
              const next = (v === 'All' ? pool : pool.filter((f) => f.subcategory === v))[0];
              if (next) setFnId(next.id);
            }}
          >
            {subcategories.map((s) => <Option key={s} value={s}>{s}</Option>)}
          </Combobox>
        </Field>
        <Field label="Function" style={{ minWidth: 320, flex: 1 }}>
          <Combobox
            value={fn ? `${fn.module}.${fn.name}` : ''}
            selectedOptions={fn ? [fn.id] : []}
            onOptionSelect={(_, d) => {
              if (d.optionValue) {
                setFnId(d.optionValue);
                setOverrides({});
                setStatus('');
                setErrorMsg('');
              }
            }}
          >
            {visibleFns.map((f) => (
              <Option key={f.id} value={f.id} text={`${f.module}.${f.name}`}>
                {f.module}.{f.name} — {f.description}
              </Option>
            ))}
          </Combobox>
        </Field>
        </div>

        {fn && (
          <div className={styles.fnDesc}>
            <Badge appearance="filled" color="brand">{fn.category}</Badge>
            {fn.subcategory && (
              <Badge appearance="tint" color="informative">{fn.subcategory}</Badge>
            )}
            <code className={styles.fnCode}>{fn.module}.{fn.name}</code>
            <span style={{ color: tokens.colorNeutralForeground2 }}>{fn.description}</span>
            {fn.docUrl && <Link href={fn.docUrl} target="_blank">docs</Link>}
          </div>
        )}
      </div>

      {fn && (
        <>
          {/* ── Parameters ───────────────────────────────────── */}
          <div className={styles.card}>
            <div className={styles.sectionLabel}>
              <span className={styles.sectionBar} />
              Parameters
            </div>
          {(() => {
            // Hide params already auto-bound from the connection bar (workspace /
            // dataset / report); still render if the auto-bind is empty.
            const visibleParams = fn.params.filter((p) => {
              const isConnectionBound = p.kind === 'workspace' || p.kind === 'dataset' || p.kind === 'report';
              return !(isConnectionBound && (autoValue(p) ?? '') !== '');
            });
            return visibleParams.length > 0 ? (
              <div className={styles.paramGrid}>
                {visibleParams.map((p) => {
                  const auto = autoValue(p);
                  const ov = overrides[p.name];
                  const effective = ov !== undefined ? ov : (auto ?? (p.default !== undefined ? String(p.default) : ''));
                  const label = `${p.name}${p.required ? ' *' : ''}${p.kind !== 'text' && p.kind !== 'multiline' ? ` (${p.kind === 'dataset' ? 'semantic model' : p.kind})` : ''}`;
                  if (p.kind === 'bool') {
                    return (
                      <Field key={p.name} label={label} hint={p.hint}>
                        <Switch
                          checked={effective === true || effective === 'true' || effective === 'True'}
                          onChange={(_, d) => setOverrides((o) => ({ ...o, [p.name]: !!d.checked }))}
                          label={effective === true || effective === 'true' || effective === 'True' ? 'True' : 'False'}
                        />
                      </Field>
                    );
                  }
                  if (p.kind === 'multiline') {
                    return (
                      <Field key={p.name} label={label} hint={p.hint} style={{ gridColumn: '1 / -1' }}>
                        <Textarea
                          value={String(effective ?? '')}
                          onChange={(_, d) => setOverrides((o) => ({ ...o, [p.name]: d.value }))}
                          rows={5}
                          resize="vertical"
                          style={{ fontFamily: 'Cascadia Code, Consolas, ui-monospace, monospace', fontSize: '12px' }}
                        />
                      </Field>
                    );
                  }
                  const placeholder = auto ? `auto: ${auto}` : (p.default !== undefined ? `default: ${p.default}` : '');
                  const hint = p.hint || (auto ? 'Auto-bound from connection bar — override if needed.' : '\u00a0');
                  return (
                    <Field key={p.name} label={label} hint={hint}>
                      <Input
                        value={ov !== undefined ? String(ov) : (auto ?? (p.default !== undefined ? String(p.default) : ''))}
                        placeholder={placeholder}
                        type={p.kind === 'number' ? 'number' : 'text'}
                        onChange={(_, d) => setOverrides((o) => ({ ...o, [p.name]: d.value }))}
                      />
                    </Field>
                  );
                })}
              </div>
            ) : (
              <div className={styles.emptyParams}>
                {fn.params.length === 0
                  ? 'No parameters — this function takes no arguments.'
                  : 'All parameters are auto-bound from the connection bar above.'}
              </div>
            );
          })()}
          </div>

          {/* ── Code preview ─────────────────────────────────── */}
          <div className={styles.codeWrap}>
            <div className={styles.codeToolbar}>
              <span className={styles.langPill}>PYTHON</span>
              <Tooltip content="Generated Python — sent into the new notebook as cell #1." relationship="label">
                <Text style={{ color: '#94a3b8', fontSize: 12 }}>cell #1 of the generated notebook</Text>
              </Tooltip>
              <div className={styles.codeToolbarSpacer} />
              <Tooltip
                content={wrapCode ? 'Wrapping long lines — click for no-wrap (horizontal scroll)' : 'No-wrap — click to wrap long lines'}
                relationship="label"
              >
                <Button
                  size="small"
                  appearance="subtle"
                  icon={wrapCode ? <TextWrap20Regular /> : <TextWrapOff20Regular />}
                  onClick={() => setWrapCode((w) => !w)}
                  style={{ color: '#cbd5e1' }}
                >
                  {wrapCode ? 'Wrap' : 'No wrap'}
                </Button>
              </Tooltip>
              <Button size="small" appearance="subtle" icon={<Copy20Regular />} onClick={onCopy} style={{ color: '#cbd5e1' }}>
                Copy
              </Button>
              <Button size="small" appearance="subtle" icon={<ArrowDownload20Regular />} onClick={onDownloadPy} style={{ color: '#cbd5e1' }}>
                .py
              </Button>
            </div>
            <pre
              className={styles.codeBlock}
              style={wrapCode ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } : undefined}
            >
              {code}
            </pre>
          </div>

          {/* ── Run pane ─────────────────────────────────────── */}
          <div className={styles.card}>
            <div className={styles.sectionLabel}>
              <span className={styles.sectionBar} />
              Run
            </div>
            <div className={styles.runRow}>
            <Button
              appearance="primary"
              className={styles.primaryBtn}
              icon={running ? <Spinner size="tiny" /> : <PlayCircle20Regular />}
              onClick={onRunOnFabric}
              disabled={running || creating || !workspaceId}
            >
              {running ? 'Running on Fabric…' : 'Run on Fabric'}
            </Button>
            <Button
              appearance="secondary"
              className={styles.secondaryBtn}
              icon={creating ? <Spinner size="tiny" /> : <Open20Regular />}
              onClick={onCreateNotebook}
              disabled={running || creating || !workspaceId}
            >
              {creating ? 'Creating notebook…' : 'Create + open notebook'}
            </Button>
            <span className={styles.runHint}>
              Drops a Synapse notebook into the workspace and executes it on Fabric Spark (sempy +
              sempy-labs ready), then shows the run status below.
            </span>
            {status && (
              <Badge appearance="tint" color={running ? 'informative' : 'success'} icon={running ? <Spinner size="tiny" /> : <Open20Regular />}>
                {status}
              </Badge>
            )}
          </div>

          {/* ── Run result ───────────────────────────────────── */}
          {runResult && (() => {
            const jobOk = runResult.status === 'Completed' || runResult.status === 'Succeeded';
            const durationMs = runResult.startTimeUtc && runResult.endTimeUtc
              ? new Date(runResult.endTimeUtc).getTime() - new Date(runResult.startTimeUtc).getTime()
              : undefined;
            const durationText = durationMs !== undefined && durationMs >= 0
              ? `${(durationMs / 1000).toFixed(1)}s`
              : undefined;
            // The run notebook exits with a JSON envelope { ok, result | error }.
            // ok:false means the snippet raised but was captured cleanly — we
            // surface the Python traceback inline instead of an opaque failure.
            const rawExit = runResult.exitValue?.trim();
            let exitResult: string | undefined;   // successful payload (pretty-printed)
            let exitError: string | undefined;    // captured Python traceback
            if (rawExit) {
              let envelope: { ok?: boolean; result?: unknown; error?: unknown } | undefined;
              try {
                const parsed = JSON.parse(rawExit);
                if (parsed && typeof parsed === 'object' && 'ok' in parsed) envelope = parsed;
              } catch { /* not the structured envelope — treat as a raw string below */ }
              if (envelope) {
                if (envelope.ok === false) {
                  exitError = typeof envelope.error === 'string' ? envelope.error : JSON.stringify(envelope.error, null, 2);
                } else {
                  const r = envelope.result;
                  const rStr = typeof r === 'string' ? r : JSON.stringify(r, null, 2);
                  try { exitResult = JSON.stringify(JSON.parse(rStr), null, 2); } catch { exitResult = rStr; }
                }
              } else {
                // Legacy / non-envelope exit value — show the raw string.
                try { exitResult = JSON.stringify(JSON.parse(rawExit), null, 2); } catch { exitResult = rawExit; }
              }
            }
            // Overall success = job completed AND the snippet didn't raise.
            const ok = jobOk && !exitError;
            const failBody = exitError
              ? 'The notebook ran but the call raised an error — the Python traceback is shown below.'
              : runResult.failureReason?.message
                ? `${runResult.failureReason.errorCode ? `[${runResult.failureReason.errorCode}] ` : ''}${runResult.failureReason.message}`
                : 'The run did not complete successfully — open the notebook for details.';
            return (
              <>
                <MessageBar intent={ok ? 'success' : 'warning'}>
                  <MessageBarBody>
                    <MessageBarTitle>
                      {exitError ? 'Run completed with an error' : `Run ${runResult.status}`}
                      {durationText ? ` · ${durationText}` : ''}
                    </MessageBarTitle>
                    {ok
                      ? exitResult
                        ? 'The notebook executed on Fabric. The returned result is shown below.'
                        : 'The notebook executed on Fabric. Open it to inspect cell output (the run result is rendered inside the notebook).'
                      : failBody}
                    {' '}
                    <Link onClick={() => window.open(runResult.portalUrl, '_blank', 'noopener')}>
                      Open “{runResult.notebookName}” in Fabric
                    </Link>
                  </MessageBarBody>
                </MessageBar>
                {ok && exitResult && (
                  <div className={styles.codeWrap}>
                    <div className={styles.codeToolbar}>
                      <span className={styles.langPill}>RESULT</span>
                      <Text style={{ color: '#94a3b8', fontSize: 12 }}>notebook exit value</Text>
                      <div className={styles.codeToolbarSpacer} />
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<Copy20Regular />}
                        onClick={() => navigator.clipboard?.writeText(exitResult!)}
                        style={{ color: '#cbd5e1' }}
                      >
                        Copy
                      </Button>
                    </div>
                    <pre className={styles.resultBlock}>{exitResult}</pre>
                  </div>
                )}
                {exitError && (
                  <div className={styles.codeWrap}>
                    <div className={styles.codeToolbar}>
                      <span className={styles.langPill}>TRACEBACK</span>
                      <Text style={{ color: '#94a3b8', fontSize: 12 }}>Python error from the run</Text>
                      <div className={styles.codeToolbarSpacer} />
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<Copy20Regular />}
                        onClick={() => navigator.clipboard?.writeText(exitError!)}
                        style={{ color: '#cbd5e1' }}
                      >
                        Copy
                      </Button>
                    </div>
                    <pre className={styles.resultBlock}>{exitError}</pre>
                  </div>
                )}
              </>
            );
          })()}

          {errorMsg && (
            <MessageBar intent="error">
              <MessageBarBody>
                <MessageBarTitle>Failed</MessageBarTitle>
                {errorMsg}
              </MessageBarBody>
            </MessageBar>
          )}
          </div>
        </>
      )}
    </div>
  );
};
