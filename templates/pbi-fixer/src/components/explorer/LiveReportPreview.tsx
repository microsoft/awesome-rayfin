// LiveReportPreview — embeds the actual rendered Power BI report using the
// powerbi-client SDK (loaded from CDN) and the signed-in user's AAD token
// (organization embed, `tokenType: Aad` — no capacity-bound embed token needed).
// On any failure it reports back via `onError` so the caller can fall back to
// the lightweight wireframe preview.

import React, { useEffect, useRef, useState } from 'react';
import { makeStyles, shorthands, Spinner } from '@fluentui/react-components';
import { BORDER_COLOR } from '@/explorer/theme';
import { getReportEmbedInfo } from '@/services/fabricRest';
import { getFabricToken } from '@/services/fabricAuth';

// powerbi-client UMD bundle. Exposes a global `window.powerbi` service instance
// and `window['powerbi-client']` (models, etc.). No npm dependency required.
const PBI_CLIENT_SRC = 'https://cdn.jsdelivr.net/npm/powerbi-client@2.23.1/dist/powerbi.min.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyWindow = typeof window & {
  powerbi?: any;
  ['powerbi-client']?: any;
};

let pbiLoadPromise: Promise<void> | null = null;
function loadPbiClient(): Promise<void> {
  const w = window as AnyWindow;
  if (w.powerbi && w['powerbi-client']) return Promise.resolve();
  if (pbiLoadPromise) return pbiLoadPromise;
  pbiLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PBI_CLIENT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      pbiLoadPromise = null;
      reject(new Error('Failed to load the Power BI client SDK from CDN'));
    };
    document.head.appendChild(script);
  });
  return pbiLoadPromise;
}

const useStyles = makeStyles({
  wrap: { position: 'relative', width: '100%' },
  embed: {
    width: '100%',
    height: '480px',
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('4px'),
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    // The SDK injects an <iframe> that should fill the container with no border.
    '& iframe': { border: '0', width: '100%', height: '100%' },
  },
  loading: {
    position: 'absolute',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
});

export interface LiveReportPreviewProps {
  workspaceId: string;
  reportId: string;
  /** PBIR page (section) name to navigate to, when known. */
  pageName?: string | null;
  onError?: (message: string) => void;
}

export const LiveReportPreview: React.FC<LiveReportPreviewProps> = ({
  workspaceId,
  reportId,
  pageName,
  onError,
}) => {
  const styles = useStyles();
  const containerRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<any>(null);
  const loadedRef = useRef(false);
  const [loading, setLoading] = useState(true);

  // (Re)embed whenever the report changes.
  useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    setLoading(true);

    void (async () => {
      try {
        await loadPbiClient();
        const [info, token] = await Promise.all([
          getReportEmbedInfo(workspaceId, reportId),
          getFabricToken(),
        ]);
        if (cancelled || !containerRef.current) return;

        const w = window as AnyWindow;
        const pbi = w.powerbi;
        const models = w['powerbi-client'].models;

        pbi.reset(containerRef.current);
        const report = pbi.embed(containerRef.current, {
          type: 'report',
          id: reportId,
          embedUrl: info.embedUrl,
          accessToken: token,
          tokenType: models.TokenType.Aad,
          settings: {
            panes: { filters: { visible: false } },
          },
        });
        reportRef.current = report;

        report.off('loaded');
        report.on('loaded', () => {
          if (cancelled) return;
          loadedRef.current = true;
          setLoading(false);
        });
        report.off('rendered');
        report.on('rendered', () => {
          if (cancelled) return;
          loadedRef.current = true;
          setLoading(false);
        });
        report.off('error');
        report.on('error', (event: any) => {
          if (cancelled) return;
          const detail = event?.detail;
          const errorCode = typeof detail === 'object' ? detail?.errorCode : undefined;
          const baseMsg =
            typeof detail === 'string' ? detail : detail?.message || 'Live report embed failed';
          const msg = errorCode && !baseMsg.includes(errorCode) ? `${baseMsg} (${errorCode})` : baseMsg;

          // Power BI fires `error` events for non-fatal, per-visual problems too
          // (e.g. a single visual referencing a missing field → `Missing_References`).
          // The rest of the report still renders, so once the report has loaded we
          // keep the live view instead of tearing it down for the wireframe. Only
          // errors that occur *before* the report loads are treated as fatal.
          if (loadedRef.current) {
            setLoading(false);
            // eslint-disable-next-line no-console
            console.warn('[LiveReportPreview] non-fatal report error:', msg, detail);
            return;
          }
          onError?.(msg);
        });
      } catch (err) {
        if (!cancelled) onError?.(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      const w = window as AnyWindow;
      if (w.powerbi && containerRef.current) {
        try {
          w.powerbi.reset(containerRef.current);
        } catch {
          // ignore teardown errors
        }
      }
      reportRef.current = null;
    };
  }, [workspaceId, reportId, onError]);

  // Navigate to the selected page (best effort).
  useEffect(() => {
    const report = reportRef.current;
    if (!report || !pageName) return;
    void Promise.resolve(report.setPage(pageName)).catch(() => {
      // page navigation is best-effort; ignore failures
    });
  }, [pageName]);

  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.embed} />
      {loading && (
        <div className={styles.loading}>
          <Spinner size="tiny" label="Loading live report…" />
        </div>
      )}
    </div>
  );
};
