// LandingPage — generate an HTML landing page and inject it as a new first
// page of the report. Two flavours:
//
//   • Create landing page — a deterministic template built from the report's
//     pages and top measures.
//   • Create with AI — a bespoke page authored by the github_landing_html UDF
//     (requires a GitHub sign-in).
//
// Both build a single full-bleed "HTML Content" visual bound to a report-level
// "Landingpage" measure, written through `injectLandingPage`. A live preview of
// the generated HTML is shown before/after applying.

import { useCallback, useState } from 'react';
import {
  Button,
  Spinner,
  Text,
  Input,
  Label,
  Link,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  Sparkle20Regular,
  DocumentText20Regular,
  Open20Regular,
  Info20Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, GRAY_COLOR, SECTION_BG } from '@/explorer/theme';
import {
  gatherLandingContext,
  buildTemplateHtml,
  buildAiHtml,
  injectLandingPage,
} from '@/services/landingPage';
import { GithubAuthRequiredError } from '@/services/mCommenter';
import { isGithubSignedIn, startGithubDeviceFlow } from '@/services/githubAuth';

export interface LandingPageProps {
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
    ...shorthands.gap('14px'),
  },
  group: {
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: SECTION_BG,
    ...shorthands.padding('14px', '16px'),
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('10px'),
  },
  desc: { color: GRAY_COLOR, fontSize: '12px' },
  controls: { display: 'flex', alignItems: 'flex-end', ...shorthands.gap('12px'), flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', ...shorthands.gap('4px') },
  nameInput: { width: '220px' },
  actions: { display: 'flex', ...shorthands.gap('8px') },
  status: { fontSize: '12px', color: GRAY_COLOR },
  err: { color: '#b10e1c', fontSize: '12px' },
  signin: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('6px'),
    ...shorthands.padding('10px', '12px'),
    ...shorthands.border('1px', 'dashed', BORDER_COLOR),
    ...shorthands.borderRadius('6px'),
  },
  code: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '16px',
    fontWeight: 700,
    letterSpacing: '0.15em',
  },
  previewWrap: { display: 'flex', flexDirection: 'column', ...shorthands.gap('6px') },
  preview: {
    width: '100%',
    aspectRatio: '16 / 9',
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: '#0b1d3a',
  },
});

type BusyMode = 'template' | 'ai' | null;

function previewDoc(html: string): string {
  return `<!doctype html><html style="height:100%"><head><meta charset="utf-8"></head><body style="height:100%;margin:0"><div style="position:relative;width:100%;height:100%">${html}</div></body></html>`;
}

export function LandingPage({ workspaceId, reportId, reportName, datasetId }: LandingPageProps) {
  const styles = useStyles();
  const ready = !!workspaceId && !!reportId;

  const [pageName, setPageName] = useState('Home');
  const [busy, setBusy] = useState<BusyMode>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [device, setDevice] = useState<{ userCode: string; verificationUri: string } | null>(null);

  const beginSignIn = useCallback(async () => {
    setDevice(null);
    try {
      const handle = await startGithubDeviceFlow();
      setDevice({ userCode: handle.userCode, verificationUri: handle.verificationUri });
      handle.completion
        .then(() => {
          setDevice(null);
          setError('Signed in to GitHub. Click "Create with AI" to generate the page.');
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const generate = useCallback(
    async (mode: 'template' | 'ai') => {
      if (!ready) return;
      setBusy(mode);
      setError(null);
      setStatus(null);
      try {
        const ctx = await gatherLandingContext(workspaceId, reportId, reportName, datasetId);
        const html = mode === 'ai' ? await buildAiHtml(ctx) : buildTemplateHtml(ctx);
        setPreviewHtml(html);
        const res = await injectLandingPage(workspaceId, reportId, html, pageName.trim() || 'Home');
        setStatus(res.detail);
      } catch (e) {
        if (e instanceof GithubAuthRequiredError) {
          await beginSignIn();
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setBusy(null);
      }
    },
    [ready, workspaceId, reportId, reportName, datasetId, pageName, beginSignIn]
  );

  return (
    <div className={styles.root}>
      <div className={styles.group}>
        <Text weight="semibold">Landing page generator</Text>
        <Text className={styles.desc}>
          Build a full-bleed HTML landing page and add it as the report's first page. The page is an
          HTML Content visual bound to a report-level "Landingpage" measure — no change to the
          semantic model. The template version is built from the report's pages and top measures;
          the AI version writes a bespoke page from the same context.
        </Text>

        <div className={styles.controls}>
          <div className={styles.field}>
            <Label htmlFor="lp-name" size="small">
              New page name
            </Label>
            <Input
              id="lp-name"
              className={styles.nameInput}
              value={pageName}
              onChange={(_, d) => setPageName(d.value)}
              disabled={busy !== null}
            />
          </div>
          <div className={styles.actions}>
            <Button
              appearance="primary"
              icon={busy === 'template' ? <Spinner size="tiny" /> : <DocumentText20Regular />}
              disabled={!ready || busy !== null}
              onClick={() => generate('template')}
            >
              Create landing page
            </Button>
            <Button
              icon={busy === 'ai' ? <Spinner size="tiny" /> : <Sparkle20Regular />}
              disabled={!ready || busy !== null}
              onClick={() => generate('ai')}
            >
              Create with AI{isGithubSignedIn() ? '' : ' (sign in)'}
            </Button>
          </div>
        </div>

        {device && (
          <div className={styles.signin}>
            <Text size={200} weight="semibold">
              Sign in to GitHub
            </Text>
            <Text size={200}>
              Enter this code at{' '}
              <Link href={device.verificationUri} target="_blank" rel="noreferrer">
                {device.verificationUri} <Open20Regular />
              </Link>
            </Text>
            <span className={styles.code}>{device.userCode}</span>
          </div>
        )}

        {status && (
          <Text className={styles.status}>
            <Info20Regular style={{ verticalAlign: 'middle', marginRight: 4 }} />
            {status}
          </Text>
        )}
        {error && <Text className={styles.err}>{error}</Text>}
        {!ready && <Text className={styles.err}>Select a workspace and report first.</Text>}
      </div>

      {previewHtml && (
        <div className={styles.group}>
          <div className={styles.previewWrap}>
            <Text weight="semibold">Preview</Text>
            <iframe
              className={styles.preview}
              title="Landing page preview"
              sandbox=""
              srcDoc={previewDoc(previewHtml)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
