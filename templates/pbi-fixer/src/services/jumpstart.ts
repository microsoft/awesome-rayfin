/**
 * Microsoft Fabric Jumpstart catalog + one-click deploy.
 *
 * The Fabric Jumpstart project (https://jumpstart.fabric.microsoft.com) ships a
 * PyPI package `fabric-jumpstart` whose install pattern is:
 *
 *     import fabric_jumpstart as jumpstart
 *     jumpstart.install("<slug>")
 *
 * "Deploying" a jumpstart from this app therefore creates a Fabric notebook in
 * the selected workspace that pip-installs the package and runs `install(slug)`.
 * The user opens the notebook and runs it separately (it provisions lakehouses,
 * eventhouses, reports, etc. into the workspace, which can take several minutes).
 */
import { udf } from './udfClient';

export type JumpstartType = 'Accelerator' | 'Demo' | 'Tutorial';
export type JumpstartDifficulty = 'Beginner' | 'Intermediate' | 'Advanced';

export interface Jumpstart {
  /** Catalog slug used by `fabric_jumpstart.install(...)` and the docs URL. */
  slug: string;
  name: string;
  description: string;
  type: JumpstartType;
  difficulty: JumpstartDifficulty;
  /** Fabric workloads the jumpstart touches (for display tags). */
  workloads: string[];
}

export const JUMPSTART_CATALOG_URL = 'https://jumpstart.fabric.microsoft.com/catalog';

export function jumpstartDocUrl(slug: string): string {
  return `https://jumpstart.fabric.microsoft.com/catalog/${slug}/`;
}

/**
 * Thumbnail image for a jumpstart — the catalog's architecture-diagram SVG.
 * Both `_light` and `_dark` variants are published for every slug, so the card
 * can match the app theme.
 */
export function jumpstartImageUrl(slug: string, dark = false): string {
  return `https://jumpstart.fabric.microsoft.com/images/diagrams/${slug}_${dark ? 'dark' : 'light'}.svg`;
}

/**
 * Curated mirror of the public Fabric Jumpstart catalog. Slugs match the
 * `install(...)` identifiers exactly. Cost Analysis is listed first as it is
 * the most common starting point.
 */
export const JUMPSTARTS: Jumpstart[] = [
  {
    slug: 'fabric-cost-analysis',
    name: 'Fabric Cost Analysis',
    description:
      'Holistic cost monitoring for Microsoft Fabric using Fabric itself. Combines Azure Cost Management with enriched data for high-level insights and deep dives into usage, quotas, reservations and platform specifics.',
    type: 'Accelerator',
    difficulty: 'Beginner',
    workloads: ['Power BI', 'Data Engineering', 'Data Factory', 'Data Science', 'Real-Time Intelligence'],
  },
  {
    slug: 'fpm-capacity-events',
    name: 'Fabric Platform Monitoring – Capacity Events',
    description:
      'Monitor Fabric capacity utilization in real time. Ingest capacity telemetry into an Eventhouse via Eventstream and visualize resource consumption trends on live KQL dashboards.',
    type: 'Accelerator',
    difficulty: 'Beginner',
    workloads: ['Real-Time Intelligence', 'Data Factory'],
  },
  {
    slug: 'fpm-activity-events',
    name: 'Fabric Platform Monitoring – Activity Events',
    description:
      'Extract and store semi-structured platform activity events in an Eventhouse for near real-time analysis, with a KQL dashboard and a schedulable Data Pipeline for recurring pulls.',
    type: 'Accelerator',
    difficulty: 'Beginner',
    workloads: ['Real-Time Intelligence', 'Data Factory'],
  },
  {
    slug: 'fpm-fabric-inventory',
    name: 'Fabric Platform Monitoring – Fabric Inventory',
    description:
      'Catalog your entire Fabric tenant inventory in a semi-structured format. Three pipeline-scheduled notebooks pull from the Fabric Admin REST API into an Eventhouse-backed KQL database with a real-time dashboard.',
    type: 'Accelerator',
    difficulty: 'Beginner',
    workloads: ['Real-Time Intelligence', 'Data Factory'],
  },
  {
    slug: 'fpm-gateway-monitoring',
    name: 'Fabric Platform Monitoring – Gateway Monitoring',
    description:
      'Monitor on-premises data gateway performance and usage with real-time ingestion into Fabric. Track gateway health, query execution metrics and resource utilization through a live Power BI report.',
    type: 'Accelerator',
    difficulty: 'Beginner',
    workloads: ['Real-Time Intelligence', 'Data Factory', 'Power BI'],
  },
  {
    slug: 'fpm-workspace-item-events',
    name: 'Fabric Platform Monitoring – Workspace Item Events',
    description:
      'Monitor workspace item events in real time. Ingest item-level telemetry into an Eventhouse via Eventstream and visualize activity patterns on live KQL dashboards.',
    type: 'Accelerator',
    difficulty: 'Intermediate',
    workloads: ['Real-Time Intelligence', 'Data Factory', 'Power BI'],
  },
  {
    slug: 'multivariate-anomaly-detection',
    name: 'Multivariate Anomaly Detection',
    description:
      'Monitor high-value industrial equipment and detect subtle anomalies using advanced algorithms, with automated alerts and visualization to facilitate diagnostics and root cause analysis.',
    type: 'Accelerator',
    difficulty: 'Intermediate',
    workloads: ['Real-Time Intelligence', 'Power BI', 'Data Science'],
  },
  {
    slug: 'spark-monitoring-and-optimization',
    name: 'Spark Monitoring and Optimization',
    description:
      'Monitor Spark workloads with Fabric Real-Time Intelligence. Track Spark job performance metrics, visualize data streams on live dashboards and gain operational insights to optimize data engineering pipelines.',
    type: 'Accelerator',
    difficulty: 'Intermediate',
    workloads: ['Data Engineering', 'Real-Time Intelligence'],
  },
  {
    slug: 'grid-intelligence',
    name: 'Real-Time Grid Intelligence',
    description:
      'Monitor electrical grids, coordinate response to weather-related outages and optimize quality of service using Advanced Metering Infrastructure (AMI) data fused with weather data and vehicle telematics.',
    type: 'Demo',
    difficulty: 'Intermediate',
    workloads: ['Real-Time Intelligence', 'Power BI'],
  },
  {
    slug: 'real-time-manufacturing',
    name: 'Real-Time Manufacturing',
    description:
      'Monitor manufacturing operations in real time, combining data from quality test benches and IoT sensors with SAP ERP master data. Ask an AI agent questions and do advanced analytics with Power BI reports.',
    type: 'Demo',
    difficulty: 'Intermediate',
    workloads: ['Real-Time Intelligence', 'Power BI', 'Data Engineering', 'Data Science'],
  },
  {
    slug: 'telecom-call-data-records',
    name: 'Real-Time Telecom Call Data Records',
    description:
      'Monitor real-time telecom call data records with Fabric Real-Time Intelligence. Stream call data through Eventstream into an Eventhouse and visualize usage patterns on live KQL dashboards.',
    type: 'Demo',
    difficulty: 'Beginner',
    workloads: ['Real-Time Intelligence'],
  },
  {
    slug: 'banking-loan-fraud',
    name: 'Real-Time Banking Loan Fraud Detection',
    description:
      'Detect fraudulent activities in banking loan applications in real time. Stream loan application data through Eventstream into an Eventhouse and visualize fraud patterns on live KQL dashboards.',
    type: 'Demo',
    difficulty: 'Beginner',
    workloads: ['Real-Time Intelligence'],
  },
  {
    slug: 'retail-sales',
    name: 'Real-Time Retail Sales Monitoring',
    description:
      'Experience real-time retail sales monitoring. Streaming sales data from multiple stores flows into an Eventhouse and powers live KQL dashboards for instant business insights.',
    type: 'Demo',
    difficulty: 'Beginner',
    workloads: ['Real-Time Intelligence'],
  },
  {
    slug: 'healthcare-billing-system',
    name: 'Real-Time Healthcare Billing System',
    description:
      'Integrate real-time AI-driven intelligence into a patient billing system. Stream billing events to detect anomalies, enhance accuracy, reduce disputes and streamline payments with live KQL dashboards.',
    type: 'Demo',
    difficulty: 'Beginner',
    workloads: ['Real-Time Intelligence'],
  },
  {
    slug: 'materialized-lake-views',
    name: 'Getting Started with Materialized Lake Views',
    description:
      'Build a bronze-to-gold medallion pipeline using materialized lake views in a Fabric lakehouse. Create source tables, define materialized views with automatic refresh and explore lineage tracking.',
    type: 'Tutorial',
    difficulty: 'Beginner',
    workloads: ['Data Engineering'],
  },
  {
    slug: 'stateful-streaming-rocksdb',
    name: 'Spark Stateful Streaming with RocksDB',
    description:
      'Learn stateful, low-latency (sub-second) stream processing with Spark Structured Streaming and RocksDB. Monitor heartbeat events, track health state transitions and visualize results on a companion website.',
    type: 'Tutorial',
    difficulty: 'Intermediate',
    workloads: ['Data Engineering', 'Real-Time Intelligence'],
  },
  {
    slug: 'stateful-streaming-lakehouse',
    name: 'Stateful Streaming Lakehouse',
    description:
      'Discover how Spark Structured Streaming powers a stateful lakehouse for industrial sales and shipment data. Process incremental events from OneLake and Eventstream in a production-ready reference implementation.',
    type: 'Tutorial',
    difficulty: 'Advanced',
    workloads: ['Data Engineering', 'Real-Time Intelligence'],
  },
];

export interface JumpstartDeployResult {
  notebookId: string;
  notebookName: string;
  portalUrl: string;
}

function toSourceLines(text: string): string[] {
  // Jupyter `source` is an array of lines, each (except the last) ending in \n.
  const lines = text.split('\n');
  return lines.map((l, i) => (i < lines.length - 1 ? `${l}\n` : l));
}

function b64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

/** Build a minimal Fabric-compatible ipynb that installs the jumpstart. */
function buildNotebookIpynb(js: Jumpstart): string {
  const intro = [
    `# ${js.name}`,
    '',
    js.description,
    '',
    `**Type:** ${js.type} · **Difficulty:** ${js.difficulty}`,
    '',
    `[Open in the Fabric Jumpstart catalog](${jumpstartDocUrl(js.slug)})`,
    '',
    'This notebook was generated by **Power BI Fixer**. Run all cells to deploy',
    `the **${js.name}** jumpstart into this workspace. Provisioning can take a few`,
    'minutes and creates several Fabric items (lakehouses, eventhouses, reports, …).',
  ].join('\n');

  const install = '%pip install fabric-jumpstart --quiet';

  const run = [
    'import fabric_jumpstart as jumpstart',
    '',
    '# Optional: browse the full catalog before installing',
    '# jumpstart.list()',
    '',
    `jumpstart.install("${js.slug}")`,
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
      { cell_type: 'markdown', id: 'js-intro', metadata: {}, source: toSourceLines(intro) },
      {
        cell_type: 'code',
        id: 'js-install',
        metadata: {},
        execution_count: null,
        outputs: [],
        source: toSourceLines(install),
      },
      {
        cell_type: 'code',
        id: 'js-run',
        metadata: {},
        execution_count: null,
        outputs: [],
        source: toSourceLines(run),
      },
    ],
  };

  return JSON.stringify(notebook, null, 1);
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Display name of the workspace folder all deployed jumpstarts are placed into. */
const JUMPSTART_FOLDER_NAME = 'Fabric Jumpstart';

interface FabricFolder {
  id: string;
  displayName: string;
}

/**
 * Resolve the id of the "Fabric Jumpstart" workspace folder, creating it if
 * missing. Returns `null` when the folder cannot be created or found — for
 * example when the signed-in user's token lacks the `Workspace.ReadWrite.All`
 * scope required by the Fabric Folders create API. Folder placement is a
 * nice-to-have, so a failure here must never abort the deploy: the caller falls
 * back to creating the notebook at the workspace root.
 */
async function ensureJumpstartFolder(workspaceId: string): Promise<string | null> {
  // Listing folders only needs Workspace.Read.All, which the app always has.
  let existing: FabricFolder | undefined;
  try {
    const list = await udf.fabricProxy<{ value?: FabricFolder[] }>(
      'fabric',
      `/workspaces/${workspaceId}/folders`,
      'GET'
    );
    existing = list?.value?.find((f) => f.displayName === JUMPSTART_FOLDER_NAME);
  } catch {
    // Couldn't even list folders — give up on folder placement.
    return null;
  }
  if (existing?.id) return existing.id;

  // Folder doesn't exist yet — try to create it. This needs
  // Workspace.ReadWrite.All and may fail with InsufficientScopes; that's fine.
  try {
    const created = await udf.fabricProxy<{ id?: string }>(
      'fabric',
      `/workspaces/${workspaceId}/folders`,
      'POST',
      { displayName: JUMPSTART_FOLDER_NAME }
    );
    if (created?.id) return created.id;
  } catch {
    // Either a name conflict from a concurrent deploy, or missing scope.
    // Re-list once: if a parallel deploy created it, use that; otherwise null.
  }

  try {
    const relist = await udf.fabricProxy<{ value?: FabricFolder[] }>(
      'fabric',
      `/workspaces/${workspaceId}/folders`,
      'GET'
    );
    const found = relist?.value?.find((f) => f.displayName === JUMPSTART_FOLDER_NAME);
    if (found?.id) return found.id;
  } catch {
    /* ignore */
  }
  return null;
}

// Share a single folder-ensure operation per workspace so parallel deploys don't
// each create a duplicate folder. A null result (folder unavailable) is cached
// too, so we don't repeatedly hit a folder API the user has no rights to.
const folderEnsureCache = new Map<string, Promise<string | null>>();

function getJumpstartFolderId(workspaceId: string): Promise<string | null> {
  let p = folderEnsureCache.get(workspaceId);
  if (!p) {
    p = ensureJumpstartFolder(workspaceId).catch(() => null);
    folderEnsureCache.set(workspaceId, p);
  }
  return p;
}

/**
 * Create a Fabric notebook in `workspaceId` that installs the jumpstart. The
 * Fabric REST `createNotebook` call is a 202 long-running operation which the
 * UDF proxy resolves server-side, returning the created notebook item.
 */
export async function deployJumpstart(
  workspaceId: string,
  js: Jumpstart,
  onProgress?: (msg: string) => void
): Promise<JumpstartDeployResult> {
  onProgress?.('Preparing notebook definition…');
  const ipynb = buildNotebookIpynb(js);
  const notebookName = `${js.name} (Jumpstart ${stamp()})`;

  onProgress?.(`Placing into the "${JUMPSTART_FOLDER_NAME}" folder…`);
  const folderId = await getJumpstartFolderId(workspaceId);

  const body: Record<string, unknown> = {
    displayName: notebookName,
    description: `Fabric Jumpstart "${js.slug}". Run all cells to deploy into this workspace.`,
    definition: {
      format: 'ipynb',
      parts: [{ path: 'notebook-content.ipynb', payload: b64(ipynb), payloadType: 'InlineBase64' }],
    },
  };
  // Only set folderId when we actually have one; the Fabric Folders create API
  // needs Workspace.ReadWrite.All, so on tenants/users without that scope the
  // notebook is created at the workspace root instead of aborting the deploy.
  if (folderId) body.folderId = folderId;

  onProgress?.('Creating the Fabric notebook — long-running operation, this can take a minute…');
  const created = await udf.fabricProxy<{ id?: string; objectId?: string }>(
    'fabric',
    `/workspaces/${workspaceId}/notebooks`,
    'POST',
    body
  );
  onProgress?.('Notebook created — finalising…');
  const notebookId = created?.id ?? created?.objectId ?? '';
  const portalUrl = notebookId
    ? `https://app.powerbi.com/groups/${workspaceId}/synapsenotebooks/${notebookId}`
    : `https://app.powerbi.com/groups/${workspaceId}/list`;
  return { notebookId, notebookName, portalUrl };
}
