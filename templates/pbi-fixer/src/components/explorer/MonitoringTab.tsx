import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Text,
  Badge,
  Spinner,
  MessageBar,
  MessageBarBody,
  MessageBarActions,
  Link,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  Open20Regular,
  ArrowClockwise20Regular,
  ArrowDownload20Regular,
  Copy20Regular,
  Checkmark20Regular,
  Rocket20Regular,
} from '@fluentui/react-icons';

import {
  getMonitoringStatus,
  deployFuam,
  portalWorkspaceUrl,
  MONITORING_REPORT_PBIT_URL,
  MONITORING_REPORT_HOWTO_URL,
  MONITORING_DASHBOARD_HOWTO_URL,
  ENABLE_MONITORING_DOC_URL,
  MONITORING_EVENTHOUSE_NAME,
  MONITORING_REPORT_NAME,
  deployMonitoringReportFromDemo,
  FUAM_README_URL,
  FUAM_DEPLOY_HOWTO_URL,
  type MonitoringStatus,
  type FuamDeployResult,
  type MonitoringReportDeployResult,
} from '@/services/monitoring';
import { PbiSignInRequiredError } from '@/services/fabricAuth';
import { BORDER_COLOR, SECTION_BG, GRAY_COLOR } from '@/explorer/theme';

interface MonitoringTabProps {
  workspaceId: string;
  workspaceName: string;
}

const useStyles = makeStyles({
  root: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', ...shorthands.gap('12px'), overflowY: 'auto', ...shorthands.padding('2px') },
  intro: { display: 'flex', flexDirection: 'column', ...shorthands.gap('4px') },
  toolbar: { display: 'flex', alignItems: 'center', ...shorthands.gap('10px'), flexWrap: 'wrap' },
  card: { flexShrink: 0, display: 'flex', flexDirection: 'column', ...shorthands.gap('10px'), ...shorthands.padding('16px') },
  cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...shorthands.gap('8px') },
  field: { display: 'flex', flexDirection: 'column', ...shorthands.gap('2px') },
  fieldLabel: { fontSize: '11px', color: GRAY_COLOR, textTransform: 'uppercase', letterSpacing: '0.04em' },
  uriRow: { display: 'flex', alignItems: 'center', ...shorthands.gap('6px') },
  uriValue: {
    fontFamily: 'Consolas, monospace',
    fontSize: '12px',
    backgroundColor: SECTION_BG,
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('4px'),
    ...shorthands.padding('4px', '8px'),
    overflowWrap: 'anywhere',
    flex: 1,
  },
  actions: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px'), flexWrap: 'wrap' },
  hint: { color: '#555', fontSize: '13px' },
});

export function MonitoringTab({ workspaceId, workspaceName }: MonitoringTabProps) {
  const styles = useStyles();
  const [status, setStatus] = useState<MonitoringStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deployBusy, setDeployBusy] = useState(false);
  const [deployResult, setDeployResult] = useState<MonitoringReportDeployResult | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [fuamBusy, setFuamBusy] = useState(false);
  const [fuamResult, setFuamResult] = useState<FuamDeployResult | null>(null);
  const [fuamError, setFuamError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    if (!workspaceId) {
      setStatus(null);
      return;
    }
    setBusy(true);
    setError(null);
    setNeedsSignIn(false);
    try {
      setStatus(await getMonitoringStatus(workspaceId));
    } catch (e: unknown) {
      if (e instanceof PbiSignInRequiredError) setNeedsSignIn(true);
      else setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void scan();
  }, [scan]);

  const copyUri = useCallback(async () => {
    if (!status?.queryUri) return;
    try {
      await navigator.clipboard.writeText(status.queryUri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  }, [status]);

  const runFuamDeploy = useCallback(async () => {
    if (!workspaceId) return;
    setFuamBusy(true);
    setFuamError(null);
    setFuamResult(null);
    try {
      setFuamResult(await deployFuam(workspaceId));
    } catch (e: unknown) {
      if (e instanceof PbiSignInRequiredError) setNeedsSignIn(true);
      else setFuamError(e instanceof Error ? e.message : String(e));
    } finally {
      setFuamBusy(false);
    }
  }, [workspaceId]);

  const runMonitoringDeploy = useCallback(async () => {
    if (!workspaceId) return;
    setDeployBusy(true);
    setDeployError(null);
    setDeployResult(null);
    try {
      const res = await deployMonitoringReportFromDemo(workspaceId);
      setDeployResult(res);
      await scan();
    } catch (e: unknown) {
      if (e instanceof PbiSignInRequiredError) setNeedsSignIn(true);
      else setDeployError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeployBusy(false);
    }
  }, [workspaceId, scan]);

  const enabled = status?.enabled ?? false;
  const reportDeployed = status?.reportDeployed ?? false;
  const fuamDeployed = status?.fuamDeployed ?? false;
  const fuamInThisWorkspace = status?.fuamInThisWorkspace ?? false;
  const fuamWorkspaceId = status?.fuamWorkspaceId ?? null;
  const fuamWorkspaceName = status?.fuamWorkspaceName ?? null;

  return (
    <div className={styles.root}>
      <div className={styles.intro}>
        <Text weight="semibold" size={400}>
          Workspace monitoring
        </Text>
        <Text size={200} style={{ color: GRAY_COLOR }}>
          Check and enable monitoring for the selected workspace, then deploy the Fabric Toolbox{' '}
          <Link href={MONITORING_REPORT_HOWTO_URL} target="_blank" rel="noreferrer">
            Power BI report template
          </Link>{' '}
          to visualize the monitoring data. Enabling provisions a read-only monitoring Eventhouse —
          a portal-only toggle, so the button below takes you straight there.{' '}
          <Link href={ENABLE_MONITORING_DOC_URL} target="_blank" rel="noreferrer">
            Learn more
          </Link>
          .
        </Text>
      </div>

      {!workspaceId && (
        <MessageBar intent="info">
          <MessageBarBody>Select a workspace above to check its monitoring status.</MessageBarBody>
        </MessageBar>
      )}

      {needsSignIn && (
        <MessageBar intent="warning">
          <MessageBarBody>
            Sign in to Power BI (top of the page) before checking — the same account you use in the
            Fabric portal.
          </MessageBarBody>
        </MessageBar>
      )}

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {workspaceId && (
        <div className={styles.toolbar}>
          <Button
            appearance="subtle"
            size="small"
            icon={busy ? <Spinner size="tiny" /> : <ArrowClockwise20Regular />}
            disabled={busy}
            onClick={() => void scan()}
          >
            {busy ? 'Checking…' : 'Refresh'}
          </Button>
          <Text size={200} style={{ color: GRAY_COLOR }}>
            {workspaceName ? `Workspace: ${workspaceName}` : ''}
          </Text>
        </div>
      )}

      {/* Combined readiness — monitoring is only "ready" when it is enabled AND
          the report template is deployed. */}
      {workspaceId && !busy && status && (
        <MessageBar intent={enabled && reportDeployed ? 'success' : 'warning'}>
          <MessageBarBody>
            {enabled && reportDeployed ? (
              <>Monitoring is fully set up: the Eventhouse is active and the report template is deployed.</>
            ) : (
              <>
                Monitoring is not fully set up yet — {enabled ? 'Eventhouse active' : 'Eventhouse not enabled'}
                {' · '}
                {reportDeployed ? 'report deployed' : 'report not deployed'}. Complete the steps below.
              </>
            )}
          </MessageBarBody>
        </MessageBar>
      )}

      {/* Monitoring status / enable */}
      {workspaceId && (
        <Card className={styles.card}>
          <div className={styles.cardHead}>
            <Text weight="semibold">Monitoring</Text>
            <Badge appearance="tint" color={enabled ? 'success' : 'warning'}>
              {enabled ? 'Enabled' : 'Not enabled'}
            </Badge>
          </div>

          {enabled ? (
            <>
              <Text className={styles.hint}>
                Monitoring is enabled. The values below are the parameters for the report template.
              </Text>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Eventhouse name</span>
                <Text>{status?.eventhouseName ?? MONITORING_EVENTHOUSE_NAME}</Text>
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Query URI</span>
                <div className={styles.uriRow}>
                  <span className={styles.uriValue}>{status?.queryUri ?? '—'}</span>
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={copied ? <Checkmark20Regular /> : <Copy20Regular />}
                    disabled={!status?.queryUri}
                    onClick={() => void copyUri()}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <Text className={styles.hint}>
              Monitoring isn’t enabled yet. Open the workspace, go to <b>Workspace settings ⚙ →
              Monitoring</b>, and select <b>+ Eventhouse</b> to provision the monitoring database.
              You need the <b>Admin</b> role on the workspace.
            </Text>
          )}

          <div className={styles.actions}>
            <Button
              appearance={enabled ? 'secondary' : 'primary'}
              icon={<Open20Regular />}
              as="a"
              href={portalWorkspaceUrl(workspaceId)}
              target="_blank"
            >
              {enabled ? 'Open workspace' : 'Enable in portal'}
            </Button>
          </div>
        </Card>
      )}

      {/* Report template deployment */}
      {workspaceId && (
        <Card className={styles.card}>
          <div className={styles.cardHead}>
            <Text weight="semibold">Monitoring report template</Text>
            <Badge appearance="tint" color={reportDeployed ? 'success' : 'informative'}>
              {reportDeployed ? 'Deployed' : 'Not found'}
            </Badge>
          </div>

          {reportDeployed ? (
            <MessageBar intent="success">
              <MessageBarBody>
                “{status?.reportName ?? MONITORING_REPORT_NAME}” is already in this workspace.
              </MessageBarBody>
              <MessageBarActions>
                <Button
                  appearance="transparent"
                  size="small"
                  icon={<Open20Regular />}
                  as="a"
                  href={portalWorkspaceUrl(workspaceId)}
                  target="_blank"
                >
                  Open workspace
                </Button>
              </MessageBarActions>
            </MessageBar>
          ) : (
            <Text className={styles.hint}>
              Deploy the Fabric Toolbox Power BI report to visualize this workspace’s monitoring
              data. Download the template, open it in Power BI Desktop, paste the parameters below,
              then publish it to this workspace.
            </Text>
          )}

          {deployError && (
            <MessageBar intent="error">
              <MessageBarBody>{deployError}</MessageBarBody>
            </MessageBar>
          )}

          {deployResult && (
            <MessageBar intent="success">
              <MessageBarBody>
                Deployed “{deployResult.reportName}” by cloning the Demo sample
                “{deployResult.sourceReportName}”.
              </MessageBarBody>
              <MessageBarActions>
                <Button
                  appearance="transparent"
                  size="small"
                  icon={<Open20Regular />}
                  as="a"
                  href={deployResult.portalUrl}
                  target="_blank"
                >
                  Open report
                </Button>
              </MessageBarActions>
            </MessageBar>
          )}

          <div className={styles.field}>
            <span className={styles.fieldLabel}>Eventhouse name parameter</span>
            <Text>{status?.eventhouseName ?? MONITORING_EVENTHOUSE_NAME}</Text>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Query URI parameter</span>
            <span className={styles.uriValue}>
              {enabled ? (status?.queryUri ?? '—') : 'Enable monitoring first to get the Query URI'}
            </span>
          </div>

          <div className={styles.actions}>
            <Button
              appearance="primary"
              icon={deployBusy ? <Spinner size="tiny" /> : <Rocket20Regular />}
              disabled={deployBusy || reportDeployed}
              onClick={() => void runMonitoringDeploy()}
            >
              {deployBusy ? 'Deploying…' : reportDeployed ? 'Monitoring report deployed' : 'One-click deploy report'}
            </Button>
            <Button
              appearance="secondary"
              icon={<ArrowDownload20Regular />}
              as="a"
              href={MONITORING_REPORT_PBIT_URL}
              target="_blank"
            >
              Download .pbit
            </Button>
            <Link href={MONITORING_REPORT_HOWTO_URL} target="_blank" rel="noreferrer">
              Deployment guide
            </Link>
            <Link href={MONITORING_DASHBOARD_HOWTO_URL} target="_blank" rel="noreferrer">
              Real-Time dashboard option
            </Link>
          </div>
        </Card>
      )}

      {/* FUAM — tenant-level admin monitoring */}
      {workspaceId && (
        <Card className={styles.card}>
          <div className={styles.cardHead}>
            <Text weight="semibold">Tenant monitoring (FUAM)</Text>
            <Badge appearance="tint" color={fuamDeployed ? 'success' : 'informative'}>
              {fuamDeployed ? 'Deployed' : 'Not deployed'}
            </Badge>
          </div>

          <Text className={styles.hint}>
            <Link href={FUAM_README_URL} target="_blank" rel="noreferrer">
              FUAM
            </Link>{' '}
            (Fabric Unified Admin Monitoring) extends monitoring to the whole tenant — capacity,
            activity, inventory, sharing and more. One-click deploy drops a deployment notebook into
            this workspace; open it and click <b>Run all</b> to provision the FUAM lakehouse,
            pipelines, semantic models and reports.
          </Text>

          {fuamDeployed && (
            <MessageBar intent="success">
              <MessageBarBody>
                {fuamInThisWorkspace
                  ? 'FUAM items were found in this workspace.'
                  : `FUAM is already deployed in workspace “${fuamWorkspaceName ?? 'FUAM'}”. It is tenant-level monitoring, so a single deployment covers the whole tenant.`}
              </MessageBarBody>
              <MessageBarActions>
                <Button
                  appearance="transparent"
                  size="small"
                  icon={<Open20Regular />}
                  as="a"
                  href={portalWorkspaceUrl(fuamWorkspaceId ?? workspaceId)}
                  target="_blank"
                >
                  Open workspace
                </Button>
              </MessageBarActions>
            </MessageBar>
          )}

          {fuamError && (
            <MessageBar intent="error">
              <MessageBarBody>{fuamError}</MessageBarBody>
            </MessageBar>
          )}

          {fuamResult && (
            <MessageBar intent="success">
              <MessageBarBody>
                Created “{fuamResult.notebookName}”. Open it and click <b>Run all</b> to deploy FUAM,
                then add Service Principal credentials to the two FUAM connections.
              </MessageBarBody>
              {fuamResult.notebookId && (
                <MessageBarActions>
                  <Button
                    appearance="transparent"
                    size="small"
                    icon={<Open20Regular />}
                    as="a"
                    href={fuamResult.portalUrl}
                    target="_blank"
                  >
                    Open notebook
                  </Button>
                </MessageBarActions>
              )}
            </MessageBar>
          )}

          <Text className={styles.hint} style={{ fontSize: '12px' }}>
            Requires a <b>Premium (F/P) capacity</b>, <b>Fabric Administrator</b> rights and a
            Service Principal. Review the prerequisites before deploying.
          </Text>

          <div className={styles.actions}>
            <Button
              appearance="primary"
              icon={fuamBusy ? <Spinner size="tiny" /> : <Rocket20Regular />}
              disabled={fuamBusy}
              onClick={() => void runFuamDeploy()}
            >
              {fuamBusy ? 'Deploying…' : fuamDeployed ? 'Redeploy / update FUAM' : 'One-click deploy FUAM'}
            </Button>
            <Link href={FUAM_DEPLOY_HOWTO_URL} target="_blank" rel="noreferrer">
              Deployment guide
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
