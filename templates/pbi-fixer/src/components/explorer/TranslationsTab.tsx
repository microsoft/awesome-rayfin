// Translations tab — AI-assisted semantic-model translations.
//
// GitHub device-flow sign-in (the same flow the Developer Hub uses) → load the
// semantic model → pick scope + target culture → Generate proposals with real
// AI (GitHub Copilot, server-side via the UDF) → review / edit in a grid →
// Apply, which writes the accepted captions into the model's TMDL
// `definition/cultures/<culture>.tmdl` part.

import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Combobox,
  Option,
  Field,
  Input,
  Spinner,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Text,
  Title3,
  Checkbox,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogTrigger,
  Card,
  Tooltip,
  makeStyles,
  shorthands,
  tokens,
  mergeClasses,
} from '@fluentui/react-components';
import {
  ArrowDownload20Regular,
  ArrowUpload20Regular,
  Sparkle20Regular,
  Checkmark20Regular,
  Dismiss20Regular,
  ArrowClockwise20Regular,
  Open20Regular,
  SignOut20Regular,
} from '@fluentui/react-icons';

import { loadModelData } from '@/services/fabricRest';
import type { ModelData } from '@/explorer/types';
import {
  proposeTranslations,
  applyTranslations,
  type TranslationProposalItem,
  type TranslationSourceItem,
  type TranslationObjectType,
} from '@/services/translationsApi';
import {
  isGithubSignedIn,
  signOutGithub,
  startGithubDeviceFlow,
  type DeviceFlowHandle,
} from '@/services/githubAuth';
import { ICON_ACCENT, SECTION_BG, BORDER_COLOR } from '@/explorer/theme';

const CULTURES = [
  { code: 'de-DE', label: 'German (de-DE)' },
  { code: 'fr-FR', label: 'French (fr-FR)' },
  { code: 'es-ES', label: 'Spanish (es-ES)' },
  { code: 'it-IT', label: 'Italian (it-IT)' },
  { code: 'pt-PT', label: 'Portuguese (pt-PT)' },
  { code: 'nl-NL', label: 'Dutch (nl-NL)' },
  { code: 'pl-PL', label: 'Polish (pl-PL)' },
  { code: 'ja-JP', label: 'Japanese (ja-JP)' },
  { code: 'zh-CN', label: 'Chinese, Simplified (zh-CN)' },
  { code: 'zh-TW', label: 'Chinese, Traditional (zh-TW)' },
  { code: 'ar-SA', label: 'Arabic (ar-SA)' },
];

type Scope = 'all' | 'tables' | 'columns' | 'measures';

interface Row extends TranslationProposalItem {
  accepted: boolean;
  edited: boolean;
}

/**
 * Copy text to the clipboard, with a fallback for the Fabric iframe where the
 * async Clipboard API is frequently blocked by permissions policy. Returns true
 * when the copy succeeded by either path.
 */
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to execCommand fallback */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, ...shorthands.gap('12px') },
  authCard: { ...shorthands.padding('16px'), ...shorthands.gap('10px'), maxWidth: '560px', flexShrink: 0 },
  authRow: { display: 'flex', alignItems: 'center', ...shorthands.gap('10px'), flexWrap: 'wrap' },
  codeBox: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '22px',
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: '3px',
    ...shorthands.padding('6px', '12px'),
    backgroundColor: tokens.colorNeutralBackground3,
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    borderRadius: tokens.borderRadiusMedium,
  },
  toolbar: { display: 'flex', alignItems: 'flex-end', ...shorthands.gap('12px'), flexWrap: 'wrap', ...shorthands.padding('8px', '4px') },
  actions: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px'), marginLeft: 'auto' },
  gridWrap: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  gridTable: { width: '100%', borderCollapse: 'collapse', fontSize: tokens.fontSizeBase200, fontFamily: tokens.fontFamilyBase },
  th: {
    textAlign: 'left',
    ...shorthands.padding('6px', '10px'),
    position: 'sticky',
    top: 0,
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    fontWeight: tokens.fontWeightSemibold,
    zIndex: 1,
  },
  td: { ...shorthands.padding('4px', '10px'), borderBottom: `1px solid ${tokens.colorNeutralStroke3}`, verticalAlign: 'middle' },
  tdObject: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground2 },
  tdExistingFallback: { color: tokens.colorNeutralForeground3, fontStyle: 'italic' },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    ...shorthands.padding('2px', '6px'),
    borderRadius: tokens.borderRadiusMedium,
    fontSize: '11px',
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: '16px',
  },
  badgeNew: { backgroundColor: 'rgba(15, 123, 15, 0.12)', color: '#0f7b0f' },
  badgeOver: { backgroundColor: 'rgba(180, 100, 30, 0.15)', color: '#8a4500' },
  badgeUnchg: { backgroundColor: 'rgba(0, 95, 170, 0.1)', color: '#004c87' },
  editInput: { width: '100%', minWidth: '180px' },
  filterBar: { display: 'flex', alignItems: 'center', ...shorthands.gap('10px'), ...shorthands.padding('6px', '4px'), flexWrap: 'wrap' },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    ...shorthands.padding('32px'),
    ...shorthands.gap('8px'),
    color: tokens.colorNeutralForeground3,
    textAlign: 'center',
  },
});

export interface TranslationsTabProps {
  workspaceId: string;
  datasetId: string;
  datasetName: string;
}

export function TranslationsTab({ workspaceId, datasetId, datasetName }: TranslationsTabProps) {
  const styles = useStyles();

  // --- GitHub sign-in ------------------------------------------------------ //
  const [signedIn, setSignedIn] = useState<boolean>(isGithubSignedIn());
  const [flow, setFlow] = useState<DeviceFlowHandle | null>(null);
  const [authError, setAuthError] = useState<string>('');
  const [codeCopied, setCodeCopied] = useState<boolean>(false);

  const startSignIn = useCallback(async () => {
    setAuthError('');
    try {
      const handle = await startGithubDeviceFlow();
      setFlow(handle);
      window.open(handle.verificationUri, '_blank', 'noopener,noreferrer');
      handle.completion
        .then(() => {
          setSignedIn(true);
          setFlow(null);
        })
        .catch((e) => {
          setAuthError(e instanceof Error ? e.message : String(e));
          setFlow(null);
        });
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const cancelSignIn = useCallback(() => {
    flow?.cancel();
    setFlow(null);
  }, [flow]);

  const handleSignOut = useCallback(() => {
    signOutGithub();
    setSignedIn(false);
  }, []);

  const copyCode = useCallback(() => {
    if (!flow) return;
    const ok = () => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    };
    void copyTextToClipboard(flow.userCode).then((copied) => {
      if (copied) ok();
    });
  }, [flow]);

  // --- Model + proposal state ---------------------------------------------- //
  const [model, setModel] = useState<ModelData | null>(null);
  const [modelError, setModelError] = useState<string>('');
  const [modelLoading, setModelLoading] = useState<boolean>(false);

  const [scope, setScope] = useState<Scope>('all');
  const [targetCulture, setTargetCulture] = useState<string>('de-DE');
  const [proposing, setProposing] = useState<boolean>(false);
  const [proposeError, setProposeError] = useState<string>('');
  const [rows, setRows] = useState<Row[]>([]);
  const [filterText, setFilterText] = useState<string>('');
  const [showChangedOnly, setShowChangedOnly] = useState<boolean>(false);
  const [showEmptyOnly, setShowEmptyOnly] = useState<boolean>(false);

  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [applyError, setApplyError] = useState<string>('');
  const [applyInfo, setApplyInfo] = useState<string>('');
  const [applying, setApplying] = useState<boolean>(false);

  const loadModel = useCallback(async () => {
    if (!workspaceId || !datasetId) {
      setModel(null);
      return;
    }
    setModelLoading(true);
    setModelError('');
    try {
      const m = await loadModelData(workspaceId, datasetId, datasetName ?? '');
      setModel(m);
    } catch (e) {
      setModelError(e instanceof Error ? e.message : String(e));
    } finally {
      setModelLoading(false);
    }
  }, [workspaceId, datasetId, datasetName]);

  const sourceItems: TranslationSourceItem[] = useMemo(() => {
    if (!model) return [];
    const items: TranslationSourceItem[] = [];
    for (const [tName, t] of Object.entries(model.tables)) {
      if (t.isHidden) continue;
      if (scope === 'all' || scope === 'tables') {
        items.push({ objectType: 'Table' as TranslationObjectType, objectPath: tName, sourceCaption: tName });
      }
      if (scope === 'all' || scope === 'columns') {
        for (const [cName, c] of Object.entries(t.columns)) {
          if (c.isHidden) continue;
          items.push({ objectType: 'Column' as TranslationObjectType, objectPath: `${tName}[${cName}]`, sourceCaption: cName });
        }
      }
      if (scope === 'all' || scope === 'measures') {
        for (const [mName, m] of Object.entries(t.measures)) {
          if (m.isHidden) continue;
          items.push({ objectType: 'Measure' as TranslationObjectType, objectPath: `${tName}[${mName}]`, sourceCaption: mName });
        }
      }
    }
    return items;
  }, [model, scope]);

  const handleGenerate = useCallback(async () => {
    if (!workspaceId || !datasetId) return;
    if (sourceItems.length === 0) {
      setProposeError('No objects in scope — load a model and pick a scope first.');
      return;
    }
    setProposing(true);
    setProposeError('');
    setApplyInfo('');
    setApplyError('');
    try {
      const proposals = await proposeTranslations(workspaceId, datasetId, targetCulture, sourceItems);
      setRows(
        proposals.map((it) => ({
          ...it,
          accepted: (it.proposedCaption ?? '') !== (it.existingCaption ?? it.sourceCaption),
          edited: false,
        }))
      );
    } catch (e) {
      setProposeError(e instanceof Error ? e.message : String(e));
    } finally {
      setProposing(false);
    }
  }, [workspaceId, datasetId, targetCulture, sourceItems]);

  const visibleRows = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    return rows.filter((r) => {
      if (
        needle &&
        !(
          r.objectPath.toLowerCase().includes(needle) ||
          r.sourceCaption.toLowerCase().includes(needle) ||
          r.proposedCaption.toLowerCase().includes(needle)
        )
      )
        return false;
      if (showChangedOnly && r.proposedCaption === (r.existingCaption ?? r.sourceCaption)) return false;
      if (showEmptyOnly && (r.existingCaption ?? '').trim().length > 0) return false;
      return true;
    });
  }, [rows, filterText, showChangedOnly, showEmptyOnly]);

  const acceptedCount = useMemo(() => rows.reduce((n, r) => n + (r.accepted ? 1 : 0), 0), [rows]);

  const setRowAt = useCallback((idx: number, patch: Partial<Row>) => {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }, []);

  const acceptAll = useCallback(() => setRows((prev) => prev.map((r) => ({ ...r, accepted: true }))), []);
  const rejectAll = useCallback(() => setRows((prev) => prev.map((r) => ({ ...r, accepted: false }))), []);

  const handleExportJson = useCallback(() => {
    const acceptedRows = rows.filter((r) => r.accepted);
    const payload = {
      workspaceId,
      datasetId,
      culture: targetCulture,
      items: acceptedRows.map(({ accepted: _a, edited: _e, ...rest }) => rest),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `translations-${targetCulture}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows, workspaceId, datasetId, targetCulture]);

  const handleExportCsv = useCallback(() => {
    const acceptedRows = rows.filter((r) => r.accepted);
    const esc = (s: string) => `"${(s ?? '').replace(/"/g, '""')}"`;
    const header = ['objectType', 'objectPath', 'sourceCaption', 'existingCaption', 'proposedCaption'].join(',');
    const lines = acceptedRows.map((r) =>
      [r.objectType, r.objectPath, r.sourceCaption, r.existingCaption ?? '', r.proposedCaption].map(esc).join(',')
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `translations-${targetCulture}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows, targetCulture]);

  const handleImportJson = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as { items?: TranslationProposalItem[] };
        if (!parsed.items || !Array.isArray(parsed.items)) {
          setProposeError('Imported JSON has no `items` array');
          return;
        }
        setRows(parsed.items.map((it) => ({ ...it, accepted: true, edited: false })));
        setProposeError('');
      } catch (e) {
        setProposeError(e instanceof Error ? e.message : String(e));
      }
    };
    input.click();
  }, []);

  const handleApply = useCallback(async () => {
    setApplyError('');
    setApplyInfo('');
    setConfirmOpen(false);
    setApplying(true);
    const toApply = rows.filter((r) => r.accepted).map(({ accepted: _a, edited: _e, ...rest }) => rest);
    try {
      const res = await applyTranslations(workspaceId, datasetId, targetCulture, toApply);
      const created = res.createdCultureFile ? ' (new culture file created)' : '';
      setApplyInfo(`Applied ${res.applied} translation(s) to ${targetCulture}${created}.`);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }, [rows, workspaceId, datasetId, targetCulture]);

  // -------------------------------------------------------------------------- //
  if (!workspaceId || !datasetId) {
    return (
      <div className={styles.empty}>
        <Title3>Translations</Title3>
        <Text>Select a workspace and a semantic model in the connection bar above to begin.</Text>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {/* GitHub sign-in panel */}
      {!signedIn && (
        <Card className={styles.authCard}>
          <Text weight="semibold">Sign in to GitHub to use AI translations</Text>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            Translations are generated by GitHub Copilot. Authorise once with the device flow — the same
            sign-in the Developer Hub uses. Your GitHub Copilot subscription powers the AI.
          </Text>
          {!flow ? (
            <div className={styles.authRow}>
              <Button appearance="primary" style={{ backgroundColor: ICON_ACCENT, borderColor: ICON_ACCENT }} onClick={startSignIn}>
                Sign in with GitHub
              </Button>
            </div>
          ) : (
            <div className={styles.authRow}>
              <Tooltip content="Click to copy" relationship="label">
                <span className={styles.codeBox} onClick={copyCode} role="button" tabIndex={0}>
                  {flow.userCode}
                </span>
              </Tooltip>
              <Button size="small" icon={codeCopied ? <Checkmark20Regular /> : undefined} onClick={copyCode}>
                {codeCopied ? 'Copied' : 'Copy code'}
              </Button>
              <Button
                appearance="primary"
                icon={<Open20Regular />}
                style={{ backgroundColor: ICON_ACCENT, borderColor: ICON_ACCENT }}
                onClick={() => window.open(flow.verificationUri, '_blank', 'noopener,noreferrer')}
              >
                Open GitHub
              </Button>
              <Spinner size="tiny" label="Waiting for authorisation…" />
              <Button size="small" appearance="subtle" onClick={cancelSignIn}>
                Cancel
              </Button>
            </div>
          )}
          {flow && (
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              Enter the code at <strong>{flow.verificationUri}</strong>, then return here — this panel updates
              automatically once you authorise.
            </Text>
          )}
          {authError && (
            <MessageBar intent="error">
              <MessageBarBody>
                <MessageBarTitle>Sign-in failed</MessageBarTitle> {authError}
              </MessageBarBody>
            </MessageBar>
          )}
        </Card>
      )}

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <Field label="Target culture">
          <Combobox
            value={CULTURES.find((c) => c.code === targetCulture)?.label ?? targetCulture}
            selectedOptions={[targetCulture]}
            onOptionSelect={(_, d) => d.optionValue && setTargetCulture(d.optionValue)}
            placeholder="Pick a culture"
          >
            {CULTURES.map((c) => (
              <Option key={c.code} value={c.code}>
                {c.label}
              </Option>
            ))}
          </Combobox>
        </Field>

        <Field label="Scope">
          <Combobox value={scope} selectedOptions={[scope]} onOptionSelect={(_, d) => d.optionValue && setScope(d.optionValue as Scope)}>
            <Option value="all">All</Option>
            <Option value="tables">Tables</Option>
            <Option value="columns">Columns</Option>
            <Option value="measures">Measures</Option>
          </Combobox>
        </Field>

        <Button appearance="primary" icon={<ArrowClockwise20Regular />} onClick={loadModel} disabled={modelLoading || !workspaceId || !datasetId}>
          {modelLoading ? 'Loading model…' : model ? 'Reload model' : 'Load model'}
        </Button>

        <Button appearance="primary" icon={<Sparkle20Regular />} disabled={!signedIn || modelLoading || proposing || sourceItems.length === 0} onClick={handleGenerate}>
          {proposing ? 'Generating…' : `Generate proposal (${sourceItems.length})`}
        </Button>

        <div className={styles.actions}>
          {signedIn && (
            <Button size="small" appearance="subtle" icon={<SignOut20Regular />} onClick={handleSignOut}>
              GitHub: sign out
            </Button>
          )}
          <Button icon={<ArrowDownload20Regular />} onClick={handleExportJson} disabled={acceptedCount === 0}>
            Export JSON
          </Button>
          <Button icon={<ArrowDownload20Regular />} onClick={handleExportCsv} disabled={acceptedCount === 0}>
            Export CSV
          </Button>
          <Button icon={<ArrowUpload20Regular />} onClick={handleImportJson}>
            Import JSON
          </Button>
          <Button
            appearance="primary"
            disabled={acceptedCount === 0}
            onClick={() => setConfirmOpen(true)}
          >
            Apply {acceptedCount > 0 ? `(${acceptedCount})` : ''}
          </Button>
        </div>
      </div>

      {modelLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Spinner size="tiny" /> <Text>Loading model…</Text>
        </div>
      )}
      {modelError && (
        <MessageBar intent="error">
          <MessageBarBody>
            <MessageBarTitle>Model load failed</MessageBarTitle> {modelError}
          </MessageBarBody>
        </MessageBar>
      )}
      {proposeError && (
        <MessageBar intent="error">
          <MessageBarBody>
            <MessageBarTitle>Propose failed</MessageBarTitle> {proposeError}
          </MessageBarBody>
        </MessageBar>
      )}
      {applying && (
        <MessageBar intent="info">
          <MessageBarBody>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Spinner size="tiny" />
              <span>
                Applying {acceptedCount} translation(s) to {targetCulture}…
              </span>
            </span>
          </MessageBarBody>
        </MessageBar>
      )}
      {!applying && applyInfo && (
        <MessageBar intent="success">
          <MessageBarBody>{applyInfo}</MessageBarBody>
        </MessageBar>
      )}
      {applyError && (
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>Apply failed</MessageBarTitle> {applyError}
          </MessageBarBody>
        </MessageBar>
      )}

      {rows.length > 0 && (
        <>
          <div className={styles.filterBar}>
            <Input
              placeholder="Filter by object, source or proposed caption…"
              value={filterText}
              onChange={(_, d) => setFilterText(d.value)}
              contentBefore={<span style={{ color: tokens.colorNeutralForeground3 }}>🔍</span>}
            />
            <Checkbox label="Changed only" checked={showChangedOnly} onChange={(_, d) => setShowChangedOnly(!!d.checked)} />
            <Checkbox label="Empty existing only" checked={showEmptyOnly} onChange={(_, d) => setShowEmptyOnly(!!d.checked)} />
            <span style={{ flex: 1 }} />
            <Button size="small" icon={<Checkmark20Regular />} onClick={acceptAll}>
              Accept all
            </Button>
            <Button size="small" icon={<Dismiss20Regular />} onClick={rejectAll}>
              Reject all
            </Button>
            <Text size={200}>
              {visibleRows.length} of {rows.length} shown · {acceptedCount} accepted
            </Text>
          </div>

          <div className={styles.gridWrap}>
            <table className={styles.gridTable}>
              <thead>
                <tr>
                  <th className={styles.th}>Type</th>
                  <th className={styles.th}>Object</th>
                  <th className={styles.th}>Source</th>
                  <th className={styles.th}>Existing</th>
                  <th className={styles.th}>Proposed</th>
                  <th className={styles.th}>Diff</th>
                  <th className={styles.th}>Accept</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => {
                  const idx = rows.indexOf(r);
                  const hasExisting = (r.existingCaption ?? '').trim().length > 0;
                  const changed = r.proposedCaption !== (r.existingCaption ?? r.sourceCaption);
                  const diffClass = !hasExisting
                    ? mergeClasses(styles.badge, styles.badgeNew)
                    : changed
                      ? mergeClasses(styles.badge, styles.badgeOver)
                      : mergeClasses(styles.badge, styles.badgeUnchg);
                  const diffLabel = !hasExisting ? 'new' : changed ? 'overwrite' : 'unchanged';
                  return (
                    <tr key={`${r.objectType}::${r.objectPath}`}>
                      <td className={styles.td}>{r.objectType}</td>
                      <td className={mergeClasses(styles.td, styles.tdObject)}>{r.objectPath}</td>
                      <td className={styles.td}>{r.sourceCaption}</td>
                      <td className={styles.td}>
                        {hasExisting ? r.existingCaption : <span className={styles.tdExistingFallback}>{r.sourceCaption}</span>}
                      </td>
                      <td className={styles.td}>
                        <Input
                          className={styles.editInput}
                          value={r.proposedCaption}
                          onChange={(_, d) => setRowAt(idx, { proposedCaption: d.value, edited: true })}
                        />
                      </td>
                      <td className={styles.td}>
                        <span className={diffClass}>{diffLabel}</span>
                      </td>
                      <td className={styles.td}>
                        <Checkbox checked={r.accepted} onChange={(_, d) => setRowAt(idx, { accepted: !!d.checked })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {rows.length === 0 && !proposing && (
        <div className={styles.empty} style={{ backgroundColor: SECTION_BG, borderRadius: 6 }}>
          <Text>
            {signedIn
              ? 'Load the model, pick a scope and culture, then Generate proposal to get AI translations.'
              : 'Sign in to GitHub above, then load the model and generate AI translations.'}
          </Text>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={(_, d) => setConfirmOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Apply translations?</DialogTitle>
            <DialogContent>
              <Text>
                This will write <strong>{acceptedCount}</strong> translation(s) to culture{' '}
                <strong>{targetCulture}</strong> in the selected model. The change is applied directly to the
                semantic model's TMDL culture file via the Fabric REST API.
              </Text>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary">Cancel</Button>
              </DialogTrigger>
              <Button appearance="primary" disabled={applying} onClick={handleApply}>
                Apply
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
