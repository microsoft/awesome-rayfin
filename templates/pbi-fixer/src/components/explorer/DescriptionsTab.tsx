// DescriptionsTab — export / import / fill / AI-generate object descriptions.
//
// PKG-12 (MA7 + B12 + C10). One model-tools panel covering three jobs:
//   • Descriptions grid — scan every table / column / measure, edit inline,
//     export the lot to JSON, import a JSON document, and apply changes back in
//     a single lossless TMDL round-trip.
//   • Quick fills — fill empty measure descriptions from their DAX (B12, no AI),
//     or ask GitHub Copilot to draft one-line descriptions for empty objects
//     (reuses the describe-only commenter UDF — proposals are previewed, never
//     written blind).
//   • Prep for AI — read / edit / save the Copilot "custom instructions" stored
//     in the model culture file (C10).

import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Spinner,
  Switch,
  Text,
  Badge,
  Textarea,
  Dropdown,
  Option,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import {
  DocumentText20Regular,
  Sparkle20Regular,
  ArrowDownload20Regular,
  ArrowUpload20Regular,
  Save20Regular,
  ArrowSync20Regular,
  Info20Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, GRAY_COLOR, SECTION_BG } from '@/explorer/theme';
import {
  scanDescriptions,
  applyDescriptions,
  exportDescriptionsJson,
  parseDescriptionsImport,
  fillEmptyMeasureDescriptionsFromDax,
  generateDescriptionsAI,
  keyOf,
  type DescriptionEntry,
  type DescObjectType,
} from '@/services/descriptions';
import { readPrepForAI, writePrepForAI } from '@/services/prepForAI';
import {
  isGithubSignedIn,
  signOutGithub,
  startGithubDeviceFlow,
  type DeviceFlowHandle,
} from '@/services/githubAuth';
import { GithubAuthRequiredError } from '@/services/mCommenter';

export interface DescriptionsTabProps {
  workspaceId: string;
  datasetId: string;
  datasetName: string;
}

type TypeFilter = 'All' | DescObjectType;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, ...shorthands.gap('10px') },
  toolbar: { display: 'flex', alignItems: 'center', ...shorthands.gap('10px'), flexWrap: 'wrap', flexShrink: 0 },
  grow: { flex: 1 },
  status: { fontSize: '12px', color: GRAY_COLOR },
  err: { fontSize: '12px', color: tokens.colorPaletteRedForeground1 },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', ...shorthands.gap('10px') },
  section: {
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: SECTION_BG,
    ...shorthands.padding('10px', '12px'),
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('8px'),
    flexShrink: 0,
  },
  sectionHead: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px'), fontWeight: '600' },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    ...shorthands.gap('8px'),
    ...shorthands.padding('6px', '0'),
    ...shorthands.borderBottom('1px', 'solid', BORDER_COLOR),
  },
  rowMeta: { display: 'flex', flexDirection: 'column', ...shorthands.gap('3px'), minWidth: '210px', flexShrink: 0 },
  rowName: { fontWeight: '600', fontSize: '12px', wordBreak: 'break-word' },
  rowTable: { fontSize: '11px', color: GRAY_COLOR, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  descInput: { flex: 1, minWidth: '220px' },
  dirty: { color: tokens.colorPaletteRedForeground1, fontWeight: '700' },
  hint: { fontSize: '11px', color: GRAY_COLOR },
  empty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    ...shorthands.gap('10px'),
    ...shorthands.padding('40px'),
    textAlign: 'center',
  },
  code: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    backgroundColor: tokens.colorNeutralBackground3,
    ...shorthands.padding('1px', '5px'),
    ...shorthands.borderRadius('3px'),
  },
});

const badgeColor: Record<DescObjectType, 'brand' | 'success' | 'warning'> = {
  Table: 'brand',
  Column: 'success',
  Measure: 'warning',
};

export function DescriptionsTab({ workspaceId, datasetId, datasetName }: DescriptionsTabProps) {
  const styles = useStyles();

  // --- Descriptions grid --------------------------------------------------- //
  const [entries, setEntries] = useState<DescriptionEntry[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All');
  const [onlyEmpty, setOnlyEmpty] = useState(false);

  // --- GitHub sign-in (AI) ------------------------------------------------- //
  const [signedIn, setSignedIn] = useState<boolean>(isGithubSignedIn());
  const [flow, setFlow] = useState<DeviceFlowHandle | null>(null);

  // --- Prep for AI --------------------------------------------------------- //
  const [prepText, setPrepText] = useState('');
  const [prepCulture, setPrepCulture] = useState('');
  const [prepLoaded, setPrepLoaded] = useState(false);
  const [prepBusy, setPrepBusy] = useState(false);
  const [prepStatus, setPrepStatus] = useState<string | null>(null);

  const ready = !!workspaceId && !!datasetId;

  const runScan = useCallback(async () => {
    if (!ready) return;
    setScanning(true);
    setErr(null);
    setStatus(null);
    try {
      const found = await scanDescriptions(workspaceId, datasetId);
      setEntries(found);
      const map: Record<string, string> = {};
      for (const e of found) map[keyOf(e)] = e.description;
      setEdits(map);
      const empties = found.filter((e) => !e.description.trim()).length;
      setStatus(
        `${found.length} object${found.length === 1 ? '' : 's'} · ${empties} without a description.`
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [ready, workspaceId, datasetId]);

  const dirtyEdits = useMemo(() => {
    const out: { objectType: DescObjectType; table: string; name: string; description: string }[] = [];
    for (const e of entries) {
      const k = keyOf(e);
      const next = edits[k] ?? '';
      if (next.trim() !== e.description.trim()) {
        out.push({ objectType: e.objectType, table: e.table, name: e.name, description: next });
      }
    }
    return out;
  }, [entries, edits]);

  const runApply = useCallback(async () => {
    if (!dirtyEdits.length) return;
    setApplying(true);
    setErr(null);
    setStatus(null);
    try {
      const res = await applyDescriptions(workspaceId, datasetId, dirtyEdits);
      setStatus(res.detail);
      await runScan();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }, [dirtyEdits, workspaceId, datasetId, runScan]);

  const onExport = useCallback(async () => {
    const merged: DescriptionEntry[] = entries.map((e) => ({
      ...e,
      description: edits[keyOf(e)] ?? e.description,
    }));
    const json = exportDescriptionsJson(merged);
    const copied = await copyText(json);
    downloadJson(`${datasetName || 'model'}-descriptions.json`, json);
    setStatus(copied ? 'Descriptions copied to clipboard and downloaded.' : 'Descriptions downloaded.');
  }, [entries, edits, datasetName]);

  const onImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = parseDescriptionsImport(String(reader.result ?? ''));
          setEdits((prev) => {
            const next = { ...prev };
            let matched = 0;
            for (const r of parsed.rows) {
              const k = `${r.objectType}\u0001${r.table}\u0001${r.name}`;
              if (k in next) {
                next[k] = r.description;
                matched++;
              }
            }
            setStatus(`Imported ${matched} of ${parsed.rows.length} descriptions — review, then Apply.`);
            return next;
          });
          setErr(null);
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, []);

  const onFillFromDax = useCallback(async () => {
    if (!ready) return;
    setApplying(true);
    setErr(null);
    setStatus(null);
    try {
      const res = await fillEmptyMeasureDescriptionsFromDax(workspaceId, datasetId);
      setStatus(res.detail);
      await runScan();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }, [ready, workspaceId, datasetId, runScan]);

  const startSignIn = useCallback(async () => {
    setErr(null);
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
          setErr(e instanceof Error ? e.message : String(e));
          setFlow(null);
        });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const onGenerateAI = useCallback(async () => {
    const targets = entries.filter((e) => !(edits[keyOf(e)] ?? '').trim());
    if (!targets.length) {
      setStatus('No empty descriptions to generate.');
      return;
    }
    setApplying(true);
    setErr(null);
    setStatus(null);
    try {
      const proposals = await generateDescriptionsAI(targets);
      setEdits((prev) => {
        const next = { ...prev };
        for (const p of proposals) next[`${p.objectType}\u0001${p.table}\u0001${p.name}`] = p.description;
        return next;
      });
      setStatus(`Drafted ${proposals.length} description(s) — review, then Apply.`);
    } catch (e) {
      if (e instanceof GithubAuthRequiredError) {
        setErr('Sign in to GitHub first to generate descriptions with Copilot.');
        void startSignIn();
      } else {
        setErr(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setApplying(false);
    }
  }, [entries, edits, startSignIn]);

  const loadPrep = useCallback(async () => {
    if (!ready) return;
    setPrepBusy(true);
    setErr(null);
    setPrepStatus(null);
    try {
      const state = await readPrepForAI(workspaceId, datasetId);
      setPrepText(state.customInstructions);
      setPrepCulture(state.culture);
      setPrepLoaded(true);
      setPrepStatus(
        state.customInstructions.trim()
          ? `Loaded custom instructions from ${state.culture}.`
          : `No custom instructions set for ${state.culture} yet.`
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPrepBusy(false);
    }
  }, [ready, workspaceId, datasetId]);

  const savePrep = useCallback(async () => {
    if (!ready) return;
    setPrepBusy(true);
    setErr(null);
    setPrepStatus(null);
    try {
      const res = await writePrepForAI(workspaceId, datasetId, prepText);
      setPrepStatus(res.detail);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPrepBusy(false);
    }
  }, [ready, workspaceId, datasetId, prepText]);

  const visible = useMemo(() => {
    return entries.filter((e) => {
      if (typeFilter !== 'All' && e.objectType !== typeFilter) return false;
      if (onlyEmpty && (edits[keyOf(e)] ?? '').trim()) return false;
      return true;
    });
  }, [entries, edits, typeFilter, onlyEmpty]);

  if (!ready) {
    return (
      <div className={styles.empty}>
        <DocumentText20Regular style={{ width: 32, height: 32, color: GRAY_COLOR }} />
        <Text>
          Select a workspace and a semantic model in the connection bar, then scan to view and edit
          object descriptions.
        </Text>
      </div>
    );
  }

  const busy = scanning || applying;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Button
          appearance="primary"
          icon={scanning ? <Spinner size="tiny" /> : <ArrowSync20Regular />}
          disabled={busy}
          onClick={runScan}
        >
          {entries.length ? 'Rescan' : 'Scan descriptions'}
        </Button>
        <Button icon={<ArrowDownload20Regular />} disabled={!entries.length || busy} onClick={onExport}>
          Export
        </Button>
        <Button icon={<ArrowUpload20Regular />} disabled={!entries.length || busy} onClick={onImport}>
          Import
        </Button>
        <Button
          appearance="primary"
          icon={<Save20Regular />}
          disabled={!dirtyEdits.length || busy}
          onClick={runApply}
        >
          Apply{dirtyEdits.length ? ` (${dirtyEdits.length})` : ''}
        </Button>
        <div className={styles.grow} />
        {entries.length > 0 && (
          <>
            <Dropdown
              size="small"
              value={typeFilter}
              selectedOptions={[typeFilter]}
              onOptionSelect={(_, d) => setTypeFilter((d.optionValue as TypeFilter) ?? 'All')}
              style={{ minWidth: 110 }}
            >
              <Option value="All">All types</Option>
              <Option value="Table">Tables</Option>
              <Option value="Column">Columns</Option>
              <Option value="Measure">Measures</Option>
            </Dropdown>
            <Switch label="Only empty" checked={onlyEmpty} onChange={(_, d) => setOnlyEmpty(!!d.checked)} />
          </>
        )}
      </div>

      {status && <div className={styles.status}>{status}</div>}
      {err && <div className={styles.err}>{err}</div>}

      <div className={styles.body}>
        {/* Quick fills + AI */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <Sparkle20Regular /> Quick fills
          </div>
          <div className={styles.toolbar}>
            <Button icon={<DocumentText20Regular />} disabled={busy} onClick={onFillFromDax}>
              Fill empty measures from DAX
            </Button>
            <Button
              icon={<Sparkle20Regular />}
              disabled={busy || !entries.length}
              onClick={onGenerateAI}
            >
              {flow ? `Authorize: ${flow.userCode}` : 'AI-generate empty (Copilot)'}
            </Button>
            {signedIn && !flow && (
              <Button
                appearance="subtle"
                size="small"
                onClick={() => {
                  signOutGithub();
                  setSignedIn(false);
                }}
              >
                Sign out GitHub
              </Button>
            )}
          </div>
          <div className={styles.hint}>
            "Fill from DAX" sets each empty measure description to its formula (no AI). "AI-generate"
            asks GitHub Copilot to draft a one-line description for every empty object — proposals
            appear in the grid for review before you Apply.
          </div>
        </div>

        {/* Prep for AI */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <Info20Regular /> Prep for AI — Copilot custom instructions
            {prepCulture && (
              <Badge appearance="tint" color="informative">
                {prepCulture}
              </Badge>
            )}
          </div>
          {!prepLoaded ? (
            <div>
              <Button icon={<ArrowSync20Regular />} disabled={prepBusy} onClick={loadPrep}>
                Load custom instructions
              </Button>
            </div>
          ) : (
            <>
              <Textarea
                value={prepText}
                onChange={(_, d) => setPrepText(d.value)}
                placeholder="e.g. - For revenue, always filter to fiscal year. - 'Top customers' means ranked by total sales."
                rows={4}
                disabled={prepBusy}
              />
              <div className={styles.toolbar}>
                <Button
                  appearance="primary"
                  icon={prepBusy ? <Spinner size="tiny" /> : <Save20Regular />}
                  disabled={prepBusy}
                  onClick={savePrep}
                >
                  Save instructions
                </Button>
                <Button appearance="subtle" size="small" disabled={prepBusy} onClick={loadPrep}>
                  Reload
                </Button>
              </div>
            </>
          )}
          {prepStatus && <div className={styles.status}>{prepStatus}</div>}
        </div>

        {/* Descriptions grid */}
        {entries.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <DocumentText20Regular /> Descriptions ({visible.length})
            </div>
            {visible.map((e) => {
              const k = keyOf(e);
              const value = edits[k] ?? '';
              const isDirty = value.trim() !== e.description.trim();
              return (
                <div key={k} className={styles.row}>
                  <div className={styles.rowMeta}>
                    <Badge appearance="tint" color={badgeColor[e.objectType]}>
                      {e.objectType}
                    </Badge>
                    <span className={styles.rowName}>
                      {isDirty && <span className={styles.dirty}>● </span>}
                      {e.name}
                    </span>
                    <span className={styles.rowTable}>{e.table}</span>
                  </div>
                  <Textarea
                    className={styles.descInput}
                    value={value}
                    onChange={(_, d) => setEdits((prev) => ({ ...prev, [k]: d.value }))}
                    placeholder="No description"
                    resize="vertical"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
