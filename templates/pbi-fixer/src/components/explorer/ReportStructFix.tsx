// ReportStructFix — PKG-5 report structural fixers.
//
//   A7 — Visual alignment (tolerance snap of chart x/y/width/height)
//   A5 — Hide visual-level filters
//   A6 — Disable "Show items with no data"
//   A9 — Remove unused custom visuals
//   A8 — Migrate report-level measures into the semantic model
//   A11 — Upgrade report from PBIRLegacy to PBIR format
//
// Each section follows the preview-then-apply pattern used by the IBCS chart
// fixer: a scan shows what would change, and nothing is written until apply.

import { useCallback, useState } from 'react';
import {
  Button,
  Spinner,
  Text,
  Badge,
  Input,
  Label,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  AlignSpaceEvenlyHorizontal20Regular,
  Filter20Regular,
  DataBarVertical20Regular,
  PuzzlePiece20Regular,
  Database20Regular,
  Info20Regular,
  ArrowUp20Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, GRAY_COLOR, SECTION_BG } from '@/explorer/theme';
import {
  scanAlignment,
  applyAlignment,
  scanHideFilters,
  applyHideFilters,
  scanShowItems,
  applyShowItems,
  scanUnusedCustomVisuals,
  applyUnusedCustomVisuals,
  scanReportLevelMeasures,
  applyReportLevelMeasures,
  scanReportFormat,
  applyUpgradeToPbir,
  type AlignScan,
  type HideFilterScan,
  type ShowItemsScan,
  type CustomVisualScan,
  type ReportMeasureScan,
  type ReportFormatScan,
} from '@/services/reportStructFix';

export interface ReportStructFixProps {
  workspaceId: string;
  reportId: string;
  reportName?: string;
  datasetId?: string;
  datasetName?: string;
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    overflowY: 'auto',
    ...shorthands.gap('12px'),
  },
  group: {
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: SECTION_BG,
    overflow: 'hidden',
  },
  groupHead: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('10px'),
    ...shorthands.padding('8px', '12px'),
    ...shorthands.borderBottom('1px', 'solid', BORDER_COLOR),
    fontWeight: '600',
  },
  grow: { flex: 1 },
  status: { fontSize: '12px', color: GRAY_COLOR },
  body: { ...shorthands.padding('8px', '12px'), display: 'flex', flexDirection: 'column', ...shorthands.gap('6px') },
  desc: { color: GRAY_COLOR, fontSize: '12px' },
  row: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('8px'),
    fontSize: '12px',
  },
  mono: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '11px',
    color: GRAY_COLOR,
    minWidth: '160px',
    flexShrink: 0,
  },
  list: { maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', ...shorthands.gap('4px') },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('8px'),
    ...shorthands.padding('8px', '12px'),
    ...shorthands.borderTop('1px', 'solid', BORDER_COLOR),
  },
  err: { color: '#b10e1c', fontSize: '12px' },
  tolInput: { width: '70px' },
});

export function ReportStructFix({
  workspaceId,
  reportId,
  reportName,
  datasetId,
  datasetName,
}: ReportStructFixProps) {
  const styles = useStyles();
  const ready = !!workspaceId && !!reportId;

  // --- A7 Visual alignment ---
  const [alignScan, setAlignScan] = useState<AlignScan | null>(null);
  const [tol, setTol] = useState('2');
  const [alignBusy, setAlignBusy] = useState(false);
  const [alignStatus, setAlignStatus] = useState<string | null>(null);
  const [alignErr, setAlignErr] = useState<string | null>(null);

  const tolNum = Math.max(0.1, Math.min(20, Number(tol) || 2));

  const runAlignScan = useCallback(async () => {
    setAlignBusy(true);
    setAlignErr(null);
    setAlignStatus(null);
    try {
      const r = await scanAlignment(workspaceId, reportId, tolNum);
      setAlignScan(r);
      setAlignStatus(`${r.total} edge${r.total === 1 ? '' : 's'} would be snapped (tolerance ${tolNum}%).`);
    } catch (e) {
      setAlignErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAlignBusy(false);
    }
  }, [workspaceId, reportId, tolNum]);

  const runAlignApply = useCallback(async () => {
    setAlignBusy(true);
    setAlignErr(null);
    try {
      const res = await applyAlignment(workspaceId, reportId, tolNum);
      setAlignStatus(res.detail);
      setAlignScan(await scanAlignment(workspaceId, reportId, tolNum));
    } catch (e) {
      setAlignErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAlignBusy(false);
    }
  }, [workspaceId, reportId, tolNum]);

  // --- A5 Hide visual filters ---
  const [filterScan, setFilterScan] = useState<HideFilterScan | null>(null);
  const [filterBusy, setFilterBusy] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterErr, setFilterErr] = useState<string | null>(null);

  const runFilterScan = useCallback(async () => {
    setFilterBusy(true);
    setFilterErr(null);
    setFilterStatus(null);
    try {
      const r = await scanHideFilters(workspaceId, reportId);
      setFilterScan(r);
      setFilterStatus(`${r.total} visual${r.total === 1 ? '' : 's'} with visible filters.`);
    } catch (e) {
      setFilterErr(e instanceof Error ? e.message : String(e));
    } finally {
      setFilterBusy(false);
    }
  }, [workspaceId, reportId]);

  const runFilterApply = useCallback(async () => {
    setFilterBusy(true);
    setFilterErr(null);
    try {
      const res = await applyHideFilters(workspaceId, reportId);
      setFilterStatus(res.detail);
      setFilterScan(await scanHideFilters(workspaceId, reportId));
    } catch (e) {
      setFilterErr(e instanceof Error ? e.message : String(e));
    } finally {
      setFilterBusy(false);
    }
  }, [workspaceId, reportId]);

  // --- A6 Show items with no data ---
  const [itemsScan, setItemsScan] = useState<ShowItemsScan | null>(null);
  const [itemsBusy, setItemsBusy] = useState(false);
  const [itemsStatus, setItemsStatus] = useState<string | null>(null);
  const [itemsErr, setItemsErr] = useState<string | null>(null);

  const runItemsScan = useCallback(async () => {
    setItemsBusy(true);
    setItemsErr(null);
    setItemsStatus(null);
    try {
      const r = await scanShowItems(workspaceId, reportId);
      setItemsScan(r);
      setItemsStatus(`${r.total} visual${r.total === 1 ? '' : 's'} have "Show items with no data" on.`);
    } catch (e) {
      setItemsErr(e instanceof Error ? e.message : String(e));
    } finally {
      setItemsBusy(false);
    }
  }, [workspaceId, reportId]);

  const runItemsApply = useCallback(async () => {
    setItemsBusy(true);
    setItemsErr(null);
    try {
      const res = await applyShowItems(workspaceId, reportId);
      setItemsStatus(res.detail);
      setItemsScan(await scanShowItems(workspaceId, reportId));
    } catch (e) {
      setItemsErr(e instanceof Error ? e.message : String(e));
    } finally {
      setItemsBusy(false);
    }
  }, [workspaceId, reportId]);

  // --- A9 Unused custom visuals ---
  const [cvScan, setCvScan] = useState<CustomVisualScan | null>(null);
  const [cvBusy, setCvBusy] = useState(false);
  const [cvStatus, setCvStatus] = useState<string | null>(null);
  const [cvErr, setCvErr] = useState<string | null>(null);

  const runCvScan = useCallback(async () => {
    setCvBusy(true);
    setCvErr(null);
    setCvStatus(null);
    try {
      const r = await scanUnusedCustomVisuals(workspaceId, reportId);
      setCvScan(r);
      setCvStatus(`${r.declared} declared · ${r.unused} unused.`);
    } catch (e) {
      setCvErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCvBusy(false);
    }
  }, [workspaceId, reportId]);

  const runCvApply = useCallback(async () => {
    setCvBusy(true);
    setCvErr(null);
    try {
      const res = await applyUnusedCustomVisuals(workspaceId, reportId);
      setCvStatus(res.detail);
      setCvScan(await scanUnusedCustomVisuals(workspaceId, reportId));
    } catch (e) {
      setCvErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCvBusy(false);
    }
  }, [workspaceId, reportId]);

  // --- A8 Migrate report-level measures ---
  const [rlmScan, setRlmScan] = useState<ReportMeasureScan | null>(null);
  const [rlmBusy, setRlmBusy] = useState(false);
  const [rlmStatus, setRlmStatus] = useState<string | null>(null);
  const [rlmErr, setRlmErr] = useState<string | null>(null);

  const runRlmScan = useCallback(async () => {
    setRlmBusy(true);
    setRlmErr(null);
    setRlmStatus(null);
    try {
      const r = await scanReportLevelMeasures(workspaceId, reportId);
      setRlmScan(r);
      setRlmStatus(`${r.total} report-level measure${r.total === 1 ? '' : 's'} found.`);
    } catch (e) {
      setRlmErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRlmBusy(false);
    }
  }, [workspaceId, reportId]);

  const runRlmApply = useCallback(async () => {
    setRlmBusy(true);
    setRlmErr(null);
    try {
      const res = await applyReportLevelMeasures(workspaceId, reportId, datasetId ?? '');
      setRlmStatus(res.detail);
      if (res.skipped.length > 0) setRlmErr(res.skipped.join('  •  '));
      setRlmScan(await scanReportLevelMeasures(workspaceId, reportId));
    } catch (e) {
      setRlmErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRlmBusy(false);
    }
  }, [workspaceId, reportId, datasetId]);

  // --- A11 Upgrade to PBIR ---
  const [pbirScan, setPbirScan] = useState<ReportFormatScan | null>(null);
  const [pbirBusy, setPbirBusy] = useState(false);
  const [pbirStatus, setPbirStatus] = useState<string | null>(null);
  const [pbirErr, setPbirErr] = useState<string | null>(null);

  const runPbirScan = useCallback(async () => {
    setPbirBusy(true);
    setPbirErr(null);
    setPbirStatus(null);
    try {
      const r = await scanReportFormat(workspaceId, reportId);
      setPbirScan(r);
      setPbirStatus(
        r.alreadyPbir
          ? 'Already in PBIR format — no upgrade needed.'
          : r.eligible
            ? 'PBIRLegacy — eligible for upgrade to PBIR.'
            : `Format "${r.format || 'unknown'}" — cannot upgrade.`
      );
    } catch (e) {
      setPbirErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPbirBusy(false);
    }
  }, [workspaceId, reportId]);

  const runPbirApply = useCallback(async () => {
    setPbirBusy(true);
    setPbirErr(null);
    try {
      const res = await applyUpgradeToPbir(workspaceId, reportId);
      setPbirStatus(res.detail);
      setPbirScan(await scanReportFormat(workspaceId, reportId));
    } catch (e) {
      setPbirErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPbirBusy(false);
    }
  }, [workspaceId, reportId]);

  if (!ready) {
    return (
      <div className={styles.body}>
        <Text className={styles.desc}>
          Select a workspace and a report in the connection bar to preview the report structural fixers.
        </Text>
      </div>
    );
  }

  const alignApplyCount = alignScan?.total ?? 0;
  const filterApplyCount = filterScan?.total ?? 0;
  const itemsApplyCount = itemsScan?.total ?? 0;
  const cvApplyCount = cvScan?.unused ?? 0;
  const rlmApplyCount = rlmScan?.total ?? 0;

  return (
    <div className={styles.root}>
      {/* A7 — Visual alignment */}
      <div className={styles.group}>
        <div className={styles.groupHead}>
          <AlignSpaceEvenlyHorizontal20Regular />
          <span>Visual alignment</span>
          <Badge appearance="tint" color="brand">
            A7
          </Badge>
          <span className={styles.grow} />
          {alignStatus && <span className={styles.status}>{alignStatus}</span>}
        </div>
        <div className={styles.body}>
          <Text className={styles.desc}>
            Snaps nearly-aligned chart visuals on each page to a shared x / y position and
            width / height. Two visuals whose edge or size differ by less than the tolerance
            (as a percentage of the page dimension) are pulled to the first one. {reportName}
          </Text>
          {alignErr && <span className={styles.err}>{alignErr}</span>}
          {alignScan && alignScan.changes.length > 0 && (
            <div className={styles.list}>
              {alignScan.changes.slice(0, 60).map((c, i) => (
                <div key={i} className={styles.row}>
                  <span className={styles.mono}>{c.visual}</span>
                  <Badge appearance="outline" color="brand">
                    {c.axis}
                  </Badge>
                  <span className={styles.desc}>
                    {Math.round(c.from)} → {Math.round(c.to)} · {c.page}
                  </span>
                </div>
              ))}
            </div>
          )}
          {alignScan && alignScan.total === 0 && (
            <span className={styles.row}>
              <Info20Regular style={{ color: '#107c10' }} /> All chart visuals already aligned.
            </span>
          )}
        </div>
        <div className={styles.toolbar}>
          <Label size="small">Tolerance %</Label>
          <Input
            className={styles.tolInput}
            size="small"
            type="number"
            value={tol}
            disabled={alignBusy}
            onChange={(_, d) => setTol(d.value)}
          />
          <Button
            icon={alignBusy ? <Spinner size="tiny" /> : <AlignSpaceEvenlyHorizontal20Regular />}
            disabled={alignBusy}
            onClick={() => void runAlignScan()}
          >
            {alignScan === null ? 'Preview' : 'Re-scan'}
          </Button>
          <span className={styles.grow} />
          {alignApplyCount > 0 && (
            <Button appearance="primary" disabled={alignBusy} onClick={() => void runAlignApply()}>
              Apply ({alignApplyCount})
            </Button>
          )}
        </div>
      </div>

      {/* A5 — Hide visual filters */}
      <div className={styles.group}>
        <div className={styles.groupHead}>
          <Filter20Regular />
          <span>Hide visual-level filters</span>
          <Badge appearance="tint" color="brand">
            A5
          </Badge>
          <span className={styles.grow} />
          {filterStatus && <span className={styles.status}>{filterStatus}</span>}
        </div>
        <div className={styles.body}>
          <Text className={styles.desc}>
            Sets <code>isHiddenInViewMode</code> on every visual-level filter so it does not
            appear in the end-user filter pane. Visuals with query fields but no filter config
            get one built from their projections.
          </Text>
          {filterErr && <span className={styles.err}>{filterErr}</span>}
          {filterScan && filterScan.visuals.length > 0 && (
            <div className={styles.list}>
              {filterScan.visuals.slice(0, 60).map((v) => (
                <div key={`${v.page}/${v.visual}`} className={styles.row}>
                  <span className={styles.mono}>{v.visual}</span>
                  <Badge appearance="tint" color="warning">
                    {v.visible} visible
                  </Badge>
                  {v.created && (
                    <Badge appearance="outline" color="informative">
                      new config
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
          {filterScan && filterScan.total === 0 && (
            <span className={styles.row}>
              <Info20Regular style={{ color: '#107c10' }} /> All visual-level filters already hidden.
            </span>
          )}
        </div>
        <div className={styles.toolbar}>
          <Button
            icon={filterBusy ? <Spinner size="tiny" /> : <Filter20Regular />}
            disabled={filterBusy}
            onClick={() => void runFilterScan()}
          >
            {filterScan === null ? 'Preview' : 'Re-scan'}
          </Button>
          <span className={styles.grow} />
          {filterApplyCount > 0 && (
            <Button appearance="primary" disabled={filterBusy} onClick={() => void runFilterApply()}>
              Apply ({filterApplyCount})
            </Button>
          )}
        </div>
      </div>

      {/* A6 — Show items with no data */}
      <div className={styles.group}>
        <div className={styles.groupHead}>
          <DataBarVertical20Regular />
          <span>Disable "Show items with no data"</span>
          <Badge appearance="tint" color="brand">
            A6
          </Badge>
          <span className={styles.grow} />
          {itemsStatus && <span className={styles.status}>{itemsStatus}</span>}
        </div>
        <div className={styles.body}>
          <Text className={styles.desc}>
            Strips every <code>showAll</code> property from visual projections. "Show items with
            no data" forces extra cross-join queries and can hurt performance on large models.
          </Text>
          {itemsErr && <span className={styles.err}>{itemsErr}</span>}
          {itemsScan && itemsScan.visuals.length > 0 && (
            <div className={styles.list}>
              {itemsScan.visuals.slice(0, 60).map((v) => (
                <div key={`${v.page}/${v.visual}`} className={styles.row}>
                  <span className={styles.mono}>{v.visual}</span>
                  <Badge appearance="tint" color="warning">
                    {v.count}×
                  </Badge>
                </div>
              ))}
            </div>
          )}
          {itemsScan && itemsScan.total === 0 && (
            <span className={styles.row}>
              <Info20Regular style={{ color: '#107c10' }} /> No visual has "Show items with no data" on.
            </span>
          )}
        </div>
        <div className={styles.toolbar}>
          <Button
            icon={itemsBusy ? <Spinner size="tiny" /> : <DataBarVertical20Regular />}
            disabled={itemsBusy}
            onClick={() => void runItemsScan()}
          >
            {itemsScan === null ? 'Preview' : 'Re-scan'}
          </Button>
          <span className={styles.grow} />
          {itemsApplyCount > 0 && (
            <Button appearance="primary" disabled={itemsBusy} onClick={() => void runItemsApply()}>
              Apply ({itemsApplyCount})
            </Button>
          )}
        </div>
      </div>

      {/* A9 — Unused custom visuals */}
      <div className={styles.group}>
        <div className={styles.groupHead}>
          <PuzzlePiece20Regular />
          <span>Remove unused custom visuals</span>
          <Badge appearance="tint" color="brand">
            A9
          </Badge>
          <span className={styles.grow} />
          {cvStatus && <span className={styles.status}>{cvStatus}</span>}
        </div>
        <div className={styles.body}>
          <Text className={styles.desc}>
            Prunes <code>publicCustomVisuals</code> entries in report.json whose visual type is
            not referenced by any visual on any page.
          </Text>
          {cvErr && <span className={styles.err}>{cvErr}</span>}
          {cvScan && cvScan.visuals.length > 0 && (
            <div className={styles.list}>
              {cvScan.visuals.map((v) => (
                <div key={v.guid} className={styles.row}>
                  <span className={styles.mono}>{v.guid}</span>
                  {v.used ? (
                    <Badge appearance="tint" color="success">
                      used
                    </Badge>
                  ) : (
                    <Badge appearance="tint" color="warning">
                      unused
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
          {cvScan && cvScan.declared === 0 && (
            <span className={styles.row}>
              <Info20Regular style={{ color: '#107c10' }} /> No custom visuals declared.
            </span>
          )}
        </div>
        <div className={styles.toolbar}>
          <Button
            icon={cvBusy ? <Spinner size="tiny" /> : <PuzzlePiece20Regular />}
            disabled={cvBusy}
            onClick={() => void runCvScan()}
          >
            {cvScan === null ? 'Preview' : 'Re-scan'}
          </Button>
          <span className={styles.grow} />
          {cvApplyCount > 0 && (
            <Button appearance="primary" disabled={cvBusy} onClick={() => void runCvApply()}>
              Remove ({cvApplyCount})
            </Button>
          )}
        </div>
      </div>

      {/* A8 — Migrate report-level measures */}
      <div className={styles.group}>
        <div className={styles.groupHead}>
          <Database20Regular />
          <span>Migrate report-level measures</span>
          <Badge appearance="tint" color="brand">
            A8
          </Badge>
          <span className={styles.grow} />
          {rlmStatus && <span className={styles.status}>{rlmStatus}</span>}
        </div>
        <div className={styles.body}>
          <Text className={styles.desc}>
            Moves report-level measures out of <code>reportExtensions.json</code> and into the
            bound semantic model{datasetName ? ` ("${datasetName}")` : ''}, then removes the
            redundant report-level copy. It is a best practice to keep measures in the model.
            {!datasetId && ' Requires a report whose semantic model is selectable in the same workspace.'}
          </Text>
          {rlmErr && <span className={styles.err}>{rlmErr}</span>}
          {rlmScan && rlmScan.measures.length > 0 && (
            <div className={styles.list}>
              {rlmScan.measures.slice(0, 60).map((m) => (
                <div key={`${m.table}/${m.measure}`} className={styles.row}>
                  <span className={styles.mono}>{m.measure}</span>
                  <Badge appearance="outline" color="brand">
                    {m.table}
                  </Badge>
                  {m.multiline && (
                    <Badge appearance="tint" color="informative">
                      multi-line
                    </Badge>
                  )}
                  <span className={styles.desc}>{m.exprLen} chars</span>
                </div>
              ))}
            </div>
          )}
          {rlmScan && rlmScan.total === 0 && (
            <span className={styles.row}>
              <Info20Regular style={{ color: '#107c10' }} /> No report-level measures in this report.
            </span>
          )}
        </div>
        <div className={styles.toolbar}>
          <Button
            icon={rlmBusy ? <Spinner size="tiny" /> : <Database20Regular />}
            disabled={rlmBusy}
            onClick={() => void runRlmScan()}
          >
            {rlmScan === null ? 'Preview' : 'Re-scan'}
          </Button>
          <span className={styles.grow} />
          {rlmApplyCount > 0 && (
            <Button
              appearance="primary"
              disabled={rlmBusy || !datasetId}
              onClick={() => void runRlmApply()}
            >
              Migrate ({rlmApplyCount})
            </Button>
          )}
        </div>
      </div>

      {/* A11 — Upgrade report to PBIR */}
      <div className={styles.group}>
        <div className={styles.groupHead}>
          <ArrowUp20Regular />
          <span>Upgrade report to PBIR format</span>
          <Badge appearance="tint" color="brand">
            A11
          </Badge>
          <span className={styles.grow} />
          {pbirStatus && <span className={styles.status}>{pbirStatus}</span>}
        </div>
        <div className={styles.body}>
          <Text className={styles.desc}>
            Converts a legacy report (PBIRLegacy) to the enhanced PBIR report format via a
            getDefinition → updateDefinition round-trip. PBIR is required by the other report
            fixers and unlocks per-visual source control. Reports already in PBIR are left
            untouched.
          </Text>
          {pbirErr && <span className={styles.err}>{pbirErr}</span>}
          {pbirScan && (
            <span className={styles.row}>
              <Info20Regular
                style={{ color: pbirScan.alreadyPbir ? '#107c10' : pbirScan.eligible ? '#b88217' : '#a4262c' }}
              />{' '}
              Current format:&nbsp;<span className={styles.mono}>{pbirScan.format || 'unknown'}</span>
            </span>
          )}
        </div>
        <div className={styles.toolbar}>
          <Button
            icon={pbirBusy ? <Spinner size="tiny" /> : <ArrowUp20Regular />}
            disabled={pbirBusy}
            onClick={() => void runPbirScan()}
          >
            {pbirScan === null ? 'Preview' : 'Re-check'}
          </Button>
          <span className={styles.grow} />
          {pbirScan?.eligible && (
            <Button
              appearance="primary"
              disabled={pbirBusy}
              onClick={() => void runPbirApply()}
            >
              Upgrade to PBIR
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
