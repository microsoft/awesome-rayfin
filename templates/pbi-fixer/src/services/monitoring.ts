/**
 * Workspace monitoring helpers.
 *
 * Enabling workspace monitoring (provisioning the system Monitoring Eventhouse
 * + read-only monitoring KQL database) is a portal-only action — there is no
 * supported public Fabric/Power BI REST operation for it. So this service:
 *
 *   1. Detects whether monitoring is already enabled for a workspace, by
 *      looking for the system "Monitoring Eventhouse" item and reading its
 *      query URI (the value the Power BI report template needs).
 *   2. Detects whether the Fabric Toolbox "Workspace Monitoring" Power BI
 *      report template has already been deployed into the workspace.
 *
 * The UI uses this to show status badges, deep-link the user to the supported
 * portal toggle, and guide deployment of the report template (download +
 * pre-filled parameters), per the Fabric Toolbox how-to.
 */
import { udf } from './udfClient';

const TOOLBOX_REPO = 'https://github.com/microsoft/fabric-toolbox';
const TOOLBOX_DASHBOARDS = `${TOOLBOX_REPO}/blob/main/monitoring/workspace-monitoring-dashboards`;

/** Direct download of the .pbit Power BI report template. */
export const MONITORING_REPORT_PBIT_URL = `${TOOLBOX_REPO}/raw/main/monitoring/workspace-monitoring-dashboards/Fabric%20Workspace%20Monitoring%20Report.pbit`;
/** How-to: deploy the Power BI report template. */
export const MONITORING_REPORT_HOWTO_URL = `${TOOLBOX_DASHBOARDS}/how-to/How_to_deploy_Workspace_Monitoring_PBI_Report.md`;
/** How-to: deploy the Real-Time dashboard template. */
export const MONITORING_DASHBOARD_HOWTO_URL = `${TOOLBOX_DASHBOARDS}/how-to/How_to_deploy_Workspace_Monitoring_RTI_Dashboard.md`;
/** Microsoft Learn: enable workspace monitoring. */
export const ENABLE_MONITORING_DOC_URL =
  'https://learn.microsoft.com/fabric/fundamentals/enable-workspace-monitoring';

/** Default display name of the system monitoring eventhouse / database. */
export const MONITORING_EVENTHOUSE_NAME = 'Monitoring Eventhouse';
/** Default display name of the report created from the template. */
export const MONITORING_REPORT_NAME = 'Fabric Workspace Monitoring Report';

// --- FUAM (Fabric Unified Admin Monitoring) — tenant-level monitoring -------
const FUAM_ROOT = `${TOOLBOX_REPO}/blob/main/monitoring/fabric-unified-admin-monitoring`;
/** FUAM overview / README. */
export const FUAM_README_URL = `${FUAM_ROOT}/README.md`;
/** How-to: deploy and configure FUAM (prerequisites, SPN, connections). */
export const FUAM_DEPLOY_HOWTO_URL = `${FUAM_ROOT}/how-to/How_to_deploy_FUAM.md`;
/** The official FUAM deployment notebook (raw .ipynb on GitHub). */
export const FUAM_DEPLOY_NOTEBOOK_URL =
  'https://raw.githubusercontent.com/microsoft/fabric-toolbox/main/monitoring/fabric-unified-admin-monitoring/scripts/Deploy_FUAM.ipynb';
/** Core item FUAM provisions — its presence means FUAM is already deployed. */
const FUAM_MARKER_ITEMS = ['FUAM_Lakehouse', 'Load_FUAM_Data_E2E'];

export interface MonitoringStatus {
  /** Monitoring eventhouse found → monitoring is enabled. */
  enabled: boolean;
  eventhouseId: string | null;
  eventhouseName: string | null;
  /** Cluster query URI — the "Query URI" parameter for the report template. */
  queryUri: string | null;
  /** The monitoring report template is already present in the workspace. */
  reportDeployed: boolean;
  reportName: string | null;
  /** FUAM (tenant-level admin monitoring) is deployed somewhere the user can see. */
  fuamDeployed: boolean;
  /** FUAM items exist in the currently selected workspace. */
  fuamInThisWorkspace: boolean;
  /** Workspace where FUAM was detected (its own dedicated workspace, tenant-wide). */
  fuamWorkspaceId: string | null;
  fuamWorkspaceName: string | null;
}

export interface FuamDeployResult {
  notebookId: string;
  notebookName: string;
  portalUrl: string;
}

export interface MonitoringReportDeployResult {
  reportId: string;
  reportName: string;
  portalUrl: string;
  sourceWorkspaceId: string;
  sourceReportId: string;
  sourceReportName: string;
}

interface NamedItem {
  id?: string;
  displayName?: string;
}

interface Eventhouse extends NamedItem {
  properties?: { queryServiceUri?: string };
}

/**
 * Workspace that already contains a working monitoring sample report, used as
 * the clone source for the one-click "deploy from demo" shortcut. Configurable
 * via `VITE_DEMO_WORKSPACE_ID` so the public sample ships no private workspace
 * id. When unset, the shortcut is disabled and the manual `.pbit` import path
 * is used instead.
 */
const DEMO_WORKSPACE_ID = (import.meta.env.VITE_DEMO_WORKSPACE_ID as string | undefined) ?? '';

/** Candidate report names to locate the source monitoring sample in Demo. */
const MONITORING_SAMPLE_NAME_CANDIDATES = [
  MONITORING_REPORT_NAME,
  'Workspace Monitoring Report',
  'Fabric Workspace Monitoring',
  'Monitoring Report',
];

/** Fabric portal deep-link to the workspace (open Settings ⚙ → Monitoring). */
export function portalWorkspaceUrl(workspaceId: string): string {
  return `https://app.fabric.microsoft.com/groups/${workspaceId}/list`;
}

export function portalReportUrl(workspaceId: string, reportId: string): string {
  return `https://app.powerbi.com/groups/${workspaceId}/reports/${reportId}`;
}

function isMonitoringEventhouse(name: string | undefined): boolean {
  return (name ?? '').trim().toLowerCase() === MONITORING_EVENTHOUSE_NAME.toLowerCase();
}

/**
 * Whether a report looks like a deployed Workspace Monitoring report. The
 * template is frequently renamed on publish (e.g. "Demo Workspace Monitoring"),
 * so match on the default name, the known sample-name candidates, or any report
 * whose name contains "monitoring" — rather than an exact default-name match.
 */
function isMonitoringReportName(name: string | undefined): boolean {
  const n = (name ?? '').trim().toLowerCase();
  if (!n) return false;
  if (MONITORING_SAMPLE_NAME_CANDIDATES.some((c) => c.toLowerCase() === n)) return true;
  return n.includes('monitoring');
}

/** True if a workspace's item list contains one of FUAM's core provisioned items. */
function hasFuamMarkers(list: NamedItem[] | undefined): boolean {
  const markers = FUAM_MARKER_ITEMS.map((m) => m.toLowerCase());
  return (list ?? []).some((i) => markers.includes((i.displayName ?? '').trim().toLowerCase()));
}

/**
 * FUAM is tenant-level monitoring and is conventionally deployed into its own
 * dedicated workspace (named "FUAM"), not the report workspace the user happens
 * to have selected. So look beyond the current workspace: scan accessible
 * workspaces whose name hints at FUAM for the marker items. Returns the first
 * workspace that actually contains FUAM, or null.
 */
async function findFuamWorkspace(excludeId?: string): Promise<{ id: string; name: string } | null> {
  const workspaces = await udf.listWorkspaces().catch(() => [] as NamedItem[]);
  const candidates = (workspaces ?? []).filter(
    (w) => w.id && w.id !== excludeId && /fuam/i.test(w.displayName ?? '')
  );
  for (const w of candidates) {
    const res = await udf
      .fabricProxy<{ value?: NamedItem[] }>('fabric', `/workspaces/${w.id}/items`)
      .catch(() => ({ value: [] as NamedItem[] }));
    if (hasFuamMarkers(res.value)) return { id: w.id!, name: w.displayName ?? 'FUAM' };
  }
  return null;
}

/**
 * Inspect a workspace and report whether monitoring is enabled (and surface the
 * query URI the report template needs) and whether the template report is
 * already deployed. Read-only — issues no provisioning calls.
 */
export async function getMonitoringStatus(workspaceId: string): Promise<MonitoringStatus> {
  // 1. Find the system monitoring eventhouse.
  const ehList = await udf
    .fabricProxy<{ value?: Eventhouse[] }>('fabric', `/workspaces/${workspaceId}/eventhouses`)
    .catch(() => ({ value: [] as Eventhouse[] }));
  const monitoring = (ehList.value ?? []).find((e) => isMonitoringEventhouse(e.displayName));

  let eventhouseId: string | null = null;
  let eventhouseName: string | null = null;
  let queryUri: string | null = null;

  if (monitoring?.id) {
    eventhouseId = monitoring.id;
    eventhouseName = monitoring.displayName ?? MONITORING_EVENTHOUSE_NAME;
    queryUri = monitoring.properties?.queryServiceUri ?? null;
    if (!queryUri) {
      // The list response may omit properties — fetch the item for the URI.
      const detail = await udf
        .fabricProxy<Eventhouse>('fabric', `/workspaces/${workspaceId}/eventhouses/${monitoring.id}`)
        .catch(() => ({}) as Eventhouse);
      queryUri = detail.properties?.queryServiceUri ?? null;
    }
  }

  // 2. Find the monitoring report template (renamed copies are common, so
  //    match leniently rather than on the exact default name).
  const reports = await udf
    .fabricProxy<{ value?: NamedItem[] }>('fabric', `/workspaces/${workspaceId}/reports`)
    .catch(() => ({ value: [] as NamedItem[] }));
  const report = (reports.value ?? []).find((r) => isMonitoringReportName(r.displayName));

  // 3. Detect FUAM by its core provisioned items. FUAM is tenant-level and
  //    usually lives in its own dedicated workspace, so check the selected
  //    workspace first, then fall back to a tenant-wide scan.
  const items = await udf
    .fabricProxy<{ value?: NamedItem[] }>('fabric', `/workspaces/${workspaceId}/items`)
    .catch(() => ({ value: [] as NamedItem[] }));
  const fuamInThisWorkspace = hasFuamMarkers(items.value);
  let fuamWorkspaceId: string | null = fuamInThisWorkspace ? workspaceId : null;
  let fuamWorkspaceName: string | null = null;
  if (!fuamInThisWorkspace) {
    const found = await findFuamWorkspace(workspaceId);
    if (found) {
      fuamWorkspaceId = found.id;
      fuamWorkspaceName = found.name;
    }
  }
  const fuamDeployed = fuamInThisWorkspace || !!fuamWorkspaceId;

  return {
    enabled: !!monitoring,
    eventhouseId,
    eventhouseName,
    queryUri,
    reportDeployed: !!report,
    reportName: report?.displayName ?? null,
    fuamDeployed,
    fuamInThisWorkspace,
    fuamWorkspaceId,
    fuamWorkspaceName,
  };
}

/**
 * One-click deployment path for the monitoring report: clone the already
 * working monitoring report from the Demo workspace into `workspaceId`.
 *
 * This avoids the manual Power BI Desktop `.pbit` import flow while still
 * giving users a ready-to-open report in one click.
 */
export async function deployMonitoringReportFromDemo(
  workspaceId: string
): Promise<MonitoringReportDeployResult> {
  if (!workspaceId) throw new Error('Workspace id is required.');

  if (!DEMO_WORKSPACE_ID) {
    throw new Error(
      'No demo source workspace configured. Set VITE_DEMO_WORKSPACE_ID to a workspace that holds a monitoring sample report, or use the manual .pbit import path.'
    );
  }

  // 1) Find the source monitoring report in Demo.
  const srcReports = await udf
    .fabricProxy<{ value?: NamedItem[] }>('fabric', `/workspaces/${DEMO_WORKSPACE_ID}/reports`)
    .catch(() => ({ value: [] as NamedItem[] }));
  const reports = srcReports.value ?? [];

  const byExact = reports.find((r) =>
    MONITORING_SAMPLE_NAME_CANDIDATES.some(
      (n) => (r.displayName ?? '').trim().toLowerCase() === n.toLowerCase()
    )
  );
  const byContains = reports.find((r) => /monitor/i.test(r.displayName ?? ''));
  const source = byExact ?? byContains;

  if (!source?.id) {
    throw new Error(
      'No monitoring sample report found in the Demo workspace. Open Demo and ensure at least one Monitoring report exists.'
    );
  }

  // 2) Clone it into the selected workspace.
  const clone = await udf.fabricProxy<{ id?: string; reportId?: string; name?: string }>(
    'pbi',
    `/groups/${DEMO_WORKSPACE_ID}/reports/${source.id}/Clone`,
    'POST',
    {
      name: MONITORING_REPORT_NAME,
      targetWorkspaceId: workspaceId,
    }
  );

  const reportId = clone?.id ?? clone?.reportId ?? '';
  if (!reportId) {
    throw new Error('Clone call returned no report id.');
  }

  return {
    reportId,
    reportName: clone?.name ?? MONITORING_REPORT_NAME,
    portalUrl: portalReportUrl(workspaceId, reportId),
    sourceWorkspaceId: DEMO_WORKSPACE_ID,
    sourceReportId: source.id,
    sourceReportName: source.displayName ?? 'Monitoring sample',
  };
}

// --- FUAM one-click deploy ---------------------------------------------------

function toSourceLines(text: string): string[] {
  // Jupyter `source` is an array of lines, each (except the last) ending in \n.
  const lines = text.split('\n');
  return lines.map((l, i) => (i < lines.length - 1 ? `${l}\n` : l));
}

function b64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * Build a small bootstrap notebook that deploys FUAM. When run, it installs the
 * Fabric CLI, downloads the latest official `Deploy_FUAM.ipynb` from
 * microsoft/fabric-toolbox and executes its code cells — provisioning the FUAM
 * lakehouse, pipelines, semantic models and reports into this workspace. This
 * mirrors the documented FUAM flow (import the deploy notebook + Run all) but
 * always pulls the current upstream version.
 */
function buildFuamBootstrapIpynb(): string {
  const intro = [
    '# Deploy FUAM — Fabric Unified Admin Monitoring',
    '',
    'This notebook was generated by **Power BI Fixer**. Click **Run all** to deploy the latest',
    `[FUAM](${FUAM_README_URL}) (Fabric Unified Admin Monitoring) accelerator into **this** workspace.`,
    '',
    'It installs the Fabric CLI, downloads the official `Deploy_FUAM.ipynb` from',
    '`microsoft/fabric-toolbox`, and runs it — provisioning the FUAM lakehouse, pipelines,',
    'semantic models and reports. The initial deployment takes several minutes.',
    '',
    '## Prerequisites',
    '- This workspace is backed by a **Fabric / Power BI Premium (F or P)** capacity (PPU/Pro are not supported).',
    '- You are a **Fabric Administrator** (or use a Service Principal via Azure Key Vault).',
    '- Tenant settings enabled: *Users can create Fabric items* and *Allow XMLA endpoints*.',
    '',
    '## After running',
    '1. The notebook creates two cloud connections (without credentials): **fuam pbi-service-api admin** and **fuam fabric-service-api admin**.',
    '2. Go to **Settings → Manage connections and gateways** and add your **Service Principal** credentials to both.',
    '3. Configure a **Fabric Capacity Metrics** app, then open and run the **Load_FUAM_Data_E2E** pipeline.',
    '',
    `Full guide: ${FUAM_DEPLOY_HOWTO_URL}`,
  ].join('\n');

  const install = '%pip install ms-fabric-cli --quiet';

  const run = [
    'import requests',
    '',
    `DEPLOY_NOTEBOOK_URL = "${FUAM_DEPLOY_NOTEBOOK_URL}"`,
    '',
    'print("Downloading the official FUAM deployment notebook…")',
    'resp = requests.get(DEPLOY_NOTEBOOK_URL, timeout=180)',
    'resp.raise_for_status()',
    'cells = resp.json().get("cells", [])',
    '',
    'blocks = []',
    'for cell in cells:',
    '    if cell.get("cell_type") != "code":',
    '        continue',
    '    src = cell.get("source", "")',
    '    if isinstance(src, list):',
    '        src = "".join(src)',
    '    # Drop notebook magics (%pip / !) — the Fabric CLI is installed in the cell above.',
    '    body = "\\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith(("%", "!")))',
    '    if body.strip():',
    '        blocks.append(body)',
    '',
    'script = "\\n\\n".join(blocks)',
    'print(f"Running FUAM deployment ({len(blocks)} code blocks)…")',
    'exec(compile(script, "Deploy_FUAM", "exec"), globals())',
    'print("FUAM deployment finished. Add Service Principal credentials to the two FUAM connections, then run the Load_FUAM_Data_E2E pipeline.")',
  ].join('\n');

  const notebook = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      language_info: { name: 'python' },
      kernelspec: { name: 'synapse_pyspark', display_name: 'Synapse PySpark' },
      microsoft: { language: 'python' },
    },
    cells: [
      { cell_type: 'markdown', id: 'fuam-intro', metadata: {}, source: toSourceLines(intro) },
      {
        cell_type: 'code',
        id: 'fuam-install',
        metadata: {},
        execution_count: null,
        outputs: [],
        source: toSourceLines(install),
      },
      {
        cell_type: 'code',
        id: 'fuam-run',
        metadata: {},
        execution_count: null,
        outputs: [],
        source: toSourceLines(run),
      },
    ],
  };

  return JSON.stringify(notebook, null, 1);
}

/**
 * Create the FUAM deployment notebook in `workspaceId`. The Fabric REST
 * createNotebook call is a 202 long-running operation the UDF proxy resolves
 * server-side, returning the created item. The user then opens the notebook and
 * clicks "Run all" to provision FUAM.
 */
export async function deployFuam(workspaceId: string): Promise<FuamDeployResult> {
  const ipynb = buildFuamBootstrapIpynb();
  const notebookName = `Deploy_FUAM (${stamp()})`;
  const body = {
    displayName: notebookName,
    description:
      'One-click FUAM deployment (Power BI Fixer). Run all cells to provision Fabric Unified Admin Monitoring into this workspace.',
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
  const notebookId = created?.id ?? created?.objectId ?? '';
  const portalUrl = notebookId
    ? `https://app.powerbi.com/groups/${workspaceId}/synapsenotebooks/${notebookId}`
    : `https://app.powerbi.com/groups/${workspaceId}/list`;
  return { notebookId, notebookName, portalUrl };
}
