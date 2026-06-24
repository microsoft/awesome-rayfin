// ReversePrototype — load an existing PBI report (PBIR), extract its pages and
// visuals (position / size / type / title) into a portable layout document,
// render a read-only wireframe gallery, then export it as a real, deployable
// PBIP project (.pbip.zip), an Excalidraw scene, or an SVG that drag-drops into
// Figma.
//
// Adapted from the Fabric Developer Hub "Reverse Prototype" page. Driven by the
// workspaceId + reportId selected in the connection bar; reads the PBIR
// definition through the server-side fabric_proxy UDF (same path the Report
// Explorer uses). Field bindings are not extracted — re-bind in the target tool.

import React, { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Spinner,
  Switch,
  Text,
  Badge,
  MessageBar,
  MessageBarBody,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  ArrowClockwise20Regular,
  ArrowDownload20Regular,
  ArrowImport20Regular,
} from '@fluentui/react-icons';
import type { ReportData } from '@/explorer/types';
import { BORDER_COLOR, ICON_ACCENT, GRAY_COLOR, SECTION_BG } from '@/explorer/theme';
import { loadReportDefinition } from '@/services/fabricRest';
import {
  reportToPrototypeDocument,
  exportPrototypeToExcalidraw,
  exportPrototypeToSvg,
  downloadText,
  PROTOTYPE_VISUAL_FILL,
  type PrototypeDocument,
} from '@/services/prototypeApi';
import { downloadPrototypePbip } from '@/services/pbirExport';
import type { DownloadResult } from '@/services/download';

/**
 * When the app is embedded in the Fabric portal iframe the browser cannot save
 * a file directly, so the download is routed to a new top-level tab. Tell the
 * user where to look (and to allow pop-ups) so the export never feels silent.
 */
function tabHint(res: DownloadResult): string {
  return res.via === 'tab'
    ? ' (opened in a new browser tab — allow pop-ups if you do not see it)'
    : '';
}

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, ...shorthands.gap('8px') },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('10px'),
    flexWrap: 'wrap',
    flexShrink: 0,
  },
  grow: { flex: 1 },
  stats: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('12px'),
    flexShrink: 0,
    fontSize: '12px',
    color: GRAY_COLOR,
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    ...shorthands.padding('8px'),
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: SECTION_BG,
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('16px'),
  },
  pageCard: {
    backgroundColor: '#ffffff',
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    ...shorthands.padding('12px'),
  },
  pageHeader: {
    display: 'flex',
    alignItems: 'baseline',
    ...shorthands.gap('8px'),
    marginBottom: '8px',
  },
  pageTitle: { fontWeight: '600', fontSize: '15px' },
  pageMeta: { color: GRAY_COLOR, fontSize: '12px' },
  canvasWrap: { width: '100%', overflowX: 'auto' },
  canvas: {
    position: 'relative',
    backgroundColor: '#ffffff',
    ...shorthands.border('1px', 'solid', '#cbd5e1'),
    ...shorthands.borderRadius('4px'),
  },
  visual: {
    position: 'absolute',
    boxSizing: 'border-box',
    ...shorthands.border('1px', 'solid', '#475569'),
    ...shorthands.borderRadius('4px'),
    ...shorthands.padding('6px', '8px'),
    fontSize: '11px',
    color: '#0f172a',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('2px'),
  },
  visualTitle: { fontWeight: '600', fontSize: '12px', lineHeight: '14px' },
  visualType: { fontSize: '10px', color: '#475569', lineHeight: '12px' },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    ...shorthands.padding('32px'),
    ...shorthands.gap('8px'),
    color: GRAY_COLOR,
    textAlign: 'center',
  },
});

/** Cap the on-screen canvas width so very wide reports don't blow out the
 *  layout. Exports always use the original page dimensions. */
const PREVIEW_MAX_W = 900;

interface ReversePrototypeProps {
  workspaceId: string;
  reportId: string;
  reportName: string;
}

export const ReversePrototype: React.FC<ReversePrototypeProps> = ({
  workspaceId,
  reportId,
  reportName,
}) => {
  const styles = useStyles();
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [includeHidden, setIncludeHidden] = useState(false);
  const [status, setStatus] = useState('');

  const loadReport = useCallback(async () => {
    if (!workspaceId || !reportId) return;
    setLoading(true);
    setErr('');
    setStatus('');
    try {
      const r = await loadReportDefinition(workspaceId, reportId);
      setReport(r);
      const pageCount = Object.keys(r.pages).length;
      const visualCount = Object.values(r.pages).reduce(
        (n, p) => n + Object.keys(p.visuals).length,
        0
      );
      setStatus(
        `Loaded ${pageCount} page${pageCount === 1 ? '' : 's'} / ${visualCount} visual${visualCount === 1 ? '' : 's'}.`
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, reportId]);

  const doc: PrototypeDocument | null = useMemo(() => {
    if (!report) return null;
    return reportToPrototypeDocument(report, reportName || 'Reverse-prototype', { includeHidden });
  }, [report, reportName, includeHidden]);

  const pageCount = doc?.pages.length ?? 0;
  const visualCount = useMemo(
    () => doc?.pages.reduce((n, p) => n + p.visuals.length, 0) ?? 0,
    [doc]
  );

  const safeName = (reportName || 'report').replace(/[^A-Za-z0-9._-]+/g, '_') || 'report';

  const onExportPbir = () => {
    if (!doc) return;
    const { size, via } = downloadPrototypePbip(doc, `${safeName}.reverse`);
    setStatus(
      `Exported ${safeName}.reverse.pbip.zip (${(size / 1024).toFixed(1)} KB)${tabHint({ via })} — unzip, then open the .pbip in Power BI Desktop or import the .Report into a Fabric workspace.`
    );
  };
  const onExportExcalidraw = () => {
    if (!doc) return;
    const scene = exportPrototypeToExcalidraw(doc);
    const res = downloadText(`${safeName}.reverse.excalidraw`, scene, 'application/json');
    setStatus(
      `Exported ${safeName}.reverse.excalidraw${tabHint(res)} — open at excalidraw.com (File ▸ Open).`
    );
  };
  const onExportSvg = () => {
    if (!doc) return;
    const svg = exportPrototypeToSvg(doc);
    const res = downloadText(`${safeName}.reverse.svg`, svg, 'image/svg+xml');
    setStatus(
      `Exported ${safeName}.reverse.svg${tabHint(res)} — drag onto a Figma canvas to import.`
    );
  };

  if (!workspaceId || !reportId) {
    return (
      <div className={styles.empty}>
        <ArrowImport20Regular style={{ fontSize: '32px', color: ICON_ACCENT }} />
        <Text weight="semibold">Reverse Prototype</Text>
        <Text>Select a workspace and a report above to extract its layout.</Text>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Button
          appearance="primary"
          icon={<ArrowClockwise20Regular />}
          onClick={() => void loadReport()}
          disabled={loading || !workspaceId || !reportId}
        >
          {loading ? 'Loading…' : report ? 'Reload report' : 'Load report'}
        </Button>
        <Switch
          checked={includeHidden}
          onChange={(_, d) => setIncludeHidden(!!d.checked)}
          label="Include hidden"
          disabled={loading}
        />
        <div className={styles.grow} />
        <Button
          icon={<ArrowDownload20Regular />}
          appearance="primary"
          onClick={onExportPbir}
          disabled={!doc || pageCount === 0}
          title="Deployable PBIP project (.pbip.zip) — open in Power BI Desktop"
        >
          Export PBIR
        </Button>
        <Button
          icon={<ArrowDownload20Regular />}
          onClick={onExportExcalidraw}
          disabled={!doc || pageCount === 0}
          title="Excalidraw scene (.excalidraw)"
        >
          Export Excalidraw
        </Button>
        <Button
          icon={<ArrowDownload20Regular />}
          onClick={onExportSvg}
          disabled={!doc || pageCount === 0}
          title="SVG — drag onto a Figma canvas"
        >
          Export SVG (Figma)
        </Button>
      </div>

      <div className={styles.stats}>
        {loading && (
          <>
            <Spinner size="tiny" />
            <span>Loading report definition…</span>
          </>
        )}
        {!loading && doc && (
          <>
            <Badge appearance="tint" color="informative">
              {pageCount} page{pageCount === 1 ? '' : 's'} / {visualCount} visual
              {visualCount === 1 ? '' : 's'}
            </Badge>
            <span>·</span>
            <span>{reportName}</span>
            {status && (
              <>
                <span>·</span>
                <span>{status}</span>
              </>
            )}
          </>
        )}
        {!loading && !doc && !err && <span>Click “Load report” to extract the layout.</span>}
      </div>

      {err && (
        <MessageBar intent="error">
          <MessageBarBody>{err}</MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.body}>
        {!loading && doc && pageCount === 0 && (
          <Text>No pages found in the report definition.</Text>
        )}
        {doc?.pages.map((pg) => {
          const scale = Math.min(1, PREVIEW_MAX_W / Math.max(pg.width, 1));
          return (
            <div key={pg.id} className={styles.pageCard}>
              <div className={styles.pageHeader}>
                <span className={styles.pageTitle}>{pg.name}</span>
                <span className={styles.pageMeta}>
                  {pg.width} × {pg.height} · {pg.visuals.length} visual
                  {pg.visuals.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className={styles.canvasWrap}>
                <div
                  className={styles.canvas}
                  style={{ width: pg.width * scale, height: pg.height * scale }}
                >
                  {pg.visuals.map((v) => (
                    <div
                      key={v.id}
                      className={styles.visual}
                      style={{
                        left: v.x * scale,
                        top: v.y * scale,
                        width: v.width * scale,
                        height: v.height * scale,
                        backgroundColor: PROTOTYPE_VISUAL_FILL[v.type] ?? '#e5e7eb',
                      }}
                      title={`${v.title} (${v.type})`}
                    >
                      <div className={styles.visualTitle}>{v.title}</div>
                      <div className={styles.visualType}>{v.type}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
