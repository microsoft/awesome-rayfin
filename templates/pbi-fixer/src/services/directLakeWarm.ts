/**
 * Direct Lake cache warm-up.
 *
 * Direct Lake semantic models page column data into memory on demand, so the
 * first query after a refresh (or after columns are evicted) pays a cold-cache
 * penalty. "Warming" the cache pre-loads the working-set columns so users hit a
 * warm model.
 *
 * This service generates a self-contained Fabric notebook that uses
 * `semantic-link-labs` to:
 *   1. Verify the model is Direct Lake.
 *   2. Ensure a `_CacheWarmUp` perspective exists (creating it from the columns
 *      currently resident in memory — falling back to *all* columns when the
 *      model is cold — plus relationship key columns).
 *   3. Warm the cache via `warm_direct_lake_cache_perspective(..., add_dependencies=True)`.
 *
 * Two entry points mirror the rest of the app:
 *   - `createWarmNotebook` — create + open the notebook (user clicks "Run all").
 *   - `runWarmNotebook`    — create the notebook *and* run it on Fabric now,
 *     returning the terminal job result (incl. the warmed-column count the
 *     notebook reports back via `notebookutils.notebook.exit`).
 */
import { udf, type NotebookRunResult } from './udfClient';

export interface WarmNotebookRef {
  notebookId: string;
  notebookName: string;
  /** Power BI portal deep-link to open the notebook. */
  portalUrl: string;
}

export interface WarmRunResult extends WarmNotebookRef {
  /** Terminal Fabric job-instance result of the on-demand run. */
  run: NotebookRunResult;
  /** Parsed `notebookutils.notebook.exit(...)` payload, when the run produced one. */
  summary: WarmSummary | null;
}

/** Shape of the JSON the warm notebook serialises via `notebook.exit(...)`. */
export interface WarmSummary {
  dataset: string;
  perspective: string;
  status: 'completed' | 'skipped' | 'started' | string;
  message?: string;
  columns_warmed?: number;
  perspective_columns?: number;
  elapsed_seconds?: number;
}

/** The perspective the warm-up notebook creates / reuses. */
export const CACHE_WARMUP_PERSPECTIVE = '_CacheWarmUp';

// --- notebook codegen -------------------------------------------------------

function toSourceLines(text: string): string[] {
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

/** Python literal for a string (single-quoted, escaped). */
function pyStr(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** The main warm-up code cell (Direct Lake check → perspective → warm). */
function buildWarmCode(workspaceId: string, datasetId: string, datasetName: string): string {
  return [
    'import json, time',
    'import sempy.fabric as fabric',
    '',
    `WORKSPACE_ID = ${pyStr(workspaceId)}`,
    `DATASET_ID = ${pyStr(datasetId)}`,
    `DATASET_NAME = ${pyStr(datasetName)}`,
    `PERSPECTIVE = ${pyStr(CACHE_WARMUP_PERSPECTIVE)}`,
    '',
    'result = {"dataset": DATASET_NAME, "perspective": PERSPECTIVE, "status": "started"}',
    '',
    '# 1. Direct Lake guard ----------------------------------------------------',
    'dfP = fabric.list_partitions(dataset=DATASET_ID, workspace=WORKSPACE_ID)',
    'is_direct_lake = any(r["Mode"] == "DirectLake" for _, r in dfP.iterrows())',
    '',
    'if not is_direct_lake:',
    '    result["status"] = "skipped"',
    '    result["message"] = f"\'{DATASET_NAME}\' is not a Direct Lake model — nothing to warm."',
    '    print(result["message"])',
    'else:',
    '    # 2. Ensure the _CacheWarmUp perspective covers the working set --------',
    '    dfPersp = fabric.list_perspectives(dataset=DATASET_ID, workspace=WORKSPACE_ID)',
    '    has_persp = bool(len(dfPersp)) and (dfPersp["Perspective Name"] == PERSPECTIVE).any()',
    '',
    '    if not has_persp:',
    '        print(f"Creating \'{PERSPECTIVE}\' perspective…")',
    '        dfC = fabric.list_columns(dataset=DATASET_ID, workspace=WORKSPACE_ID, extended=True)',
    '        if "Is Resident" in dfC.columns:',
    '            resident = dfC[dfC["Is Resident"] == True]',
    '        else:',
    '            resident = dfC.iloc[0:0]',
    '        # Warm the resident working set; if the model is cold, warm everything.',
    '        base = resident if len(resident) else dfC',
    '        cols = list(zip(base["Table Name"], base["Column Name"]))',
    '        # Add relationship key columns so joins stay warm.',
    '        dfR = fabric.list_relationships(dataset=DATASET_ID, workspace=WORKSPACE_ID)',
    '        tabset = {t for t, _ in cols}',
    '        for _, r in dfR.iterrows():',
    '            if r["From Table"] in tabset and r["To Table"] in tabset:',
    '                cols.append((r["From Table"], r["From Column"]))',
    '                cols.append((r["To Table"], r["To Column"]))',
    '        cols = sorted(set(cols))',
    '',
    '        from sempy_labs.tom import connect_semantic_model',
    '        import Microsoft.AnalysisServices.Tabular as TOM',
    '        with connect_semantic_model(dataset=DATASET_ID, readonly=False, workspace=WORKSPACE_ID) as tom:',
    '            old = tom.model.Perspectives.Find(PERSPECTIVE)',
    '            if old is not None:',
    '                tom.model.Perspectives.Remove(old)',
    '            persp = TOM.Perspective()',
    '            persp.Name = PERSPECTIVE',
    '            persp.Description = "Auto-generated by Power BI Fixer for Direct Lake cache warming. Do not delete."',
    '            tom.model.Perspectives.Add(persp)',
    '            pt_map = {}',
    '            for tname, cname in cols:',
    '                tobj = tom.model.Tables.Find(tname)',
    '                if tobj is None:',
    '                    continue',
    '                if tname not in pt_map:',
    '                    pt = TOM.PerspectiveTable()',
    '                    pt.Table = tobj',
    '                    persp.PerspectiveTables.Add(pt)',
    '                    pt_map[tname] = pt',
    '                cobj = tobj.Columns.Find(cname)',
    '                if cobj is None:',
    '                    continue',
    '                pc = TOM.PerspectiveColumn()',
    '                pc.Column = cobj',
    '                pt_map[tname].PerspectiveColumns.Add(pc)',
    '        result["perspective_columns"] = len(cols)',
    '        print(f"Perspective \'{PERSPECTIVE}\' created with {len(cols)} column(s).")',
    '    else:',
    '        print(f"Perspective \'{PERSPECTIVE}\' already exists — reusing it.")',
    '',
    '    # 3. Warm the cache ---------------------------------------------------',
    '    from sempy_labs.directlake import warm_direct_lake_cache_perspective',
    '    t0 = time.time()',
    '    df_warm = warm_direct_lake_cache_perspective(',
    '        dataset=DATASET_ID,',
    '        perspective=PERSPECTIVE,',
    '        add_dependencies=True,',
    '        workspace=WORKSPACE_ID,',
    '    )',
    '    elapsed = round(time.time() - t0, 1)',
    '    result["status"] = "completed"',
    '    result["columns_warmed"] = int(len(df_warm))',
    '    result["elapsed_seconds"] = elapsed',
    '    result["message"] = f"Warmed {len(df_warm)} column(s) in {elapsed}s."',
    '    print(result["message"])',
    '    display(df_warm)',
  ].join('\n');
}

function buildWarmIpynb(
  workspaceId: string,
  datasetId: string,
  datasetName: string,
  run: boolean
): string {
  const intro = [
    `# Warm Direct Lake cache — ${datasetName}`,
    '',
    'Generated by **Power BI Fixer**. This notebook pre-loads the Direct Lake working set',
    `into memory via [semantic-link-labs](https://github.com/microsoft/semantic-link-labs), using a \`${CACHE_WARMUP_PERSPECTIVE}\` perspective`,
    'that captures the columns currently resident in memory (plus relationship keys). If the',
    'model is cold, it warms every column.',
    run
      ? '\nThis notebook was **run on Fabric** when it was created. You can re-run it any time, or schedule it (Run → Schedule) to keep the cache warm after refreshes.'
      : '\nClick **Run all** to warm the cache now. You can also schedule it (Run → Schedule) to keep the cache warm after refreshes.',
  ].join('\n');

  const install = '%pip install semantic-link-labs --quiet';
  const code = buildWarmCode(workspaceId, datasetId, datasetName);

  const cells: unknown[] = [
    { cell_type: 'markdown', id: 'warm-intro', metadata: {}, source: toSourceLines(intro) },
    {
      cell_type: 'code',
      id: 'warm-install',
      metadata: {},
      execution_count: null,
      outputs: [],
      source: toSourceLines(install),
    },
    {
      cell_type: 'code',
      id: 'warm-run',
      metadata: {},
      execution_count: null,
      outputs: [],
      source: toSourceLines(code),
    },
  ];

  // On the run path, surface the result back to the app via notebook.exit.
  if (run) {
    const exitCode = ['import json', 'notebookutils.notebook.exit(json.dumps(result))'].join('\n');
    cells.push({
      cell_type: 'code',
      id: 'warm-exit',
      metadata: {},
      execution_count: null,
      outputs: [],
      source: toSourceLines(exitCode),
    });
  }

  const notebook = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      language_info: { name: 'python' },
      kernelspec: { name: 'synapse_pyspark', display_name: 'Synapse PySpark' },
      microsoft: { language: 'python' },
    },
    cells,
  };

  return JSON.stringify(notebook, null, 1);
}

async function createWarmNotebookItem(
  workspaceId: string,
  datasetId: string,
  datasetName: string,
  run: boolean
): Promise<WarmNotebookRef> {
  const ipynb = buildWarmIpynb(workspaceId, datasetId, datasetName, run);
  const safeName = (datasetName || 'Model').replace(/\s+/g, '_');
  const notebookName = `_CacheWarmUp_${safeName} (${stamp()})`;
  const body = {
    displayName: notebookName,
    description: `Direct Lake cache warm-up for '${datasetName}'. Auto-generated by Power BI Fixer.`,
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

/**
 * Create the Direct Lake warm-up notebook in the workspace and open it. The
 * user clicks "Run all" to warm the cache.
 */
export function createWarmNotebook(
  workspaceId: string,
  datasetId: string,
  datasetName: string
): Promise<WarmNotebookRef> {
  return createWarmNotebookItem(workspaceId, datasetId, datasetName, false);
}

/**
 * Create the Direct Lake warm-up notebook *and* run it on Fabric now, waiting
 * for the run to finish. Returns the notebook reference plus the terminal job
 * result and the parsed warm summary the notebook reports back.
 */
export async function runWarmNotebook(
  workspaceId: string,
  datasetId: string,
  datasetName: string
): Promise<WarmRunResult> {
  const ref = await createWarmNotebookItem(workspaceId, datasetId, datasetName, true);
  const run = await udf.runNotebook(workspaceId, ref.notebookId);

  let summary: WarmSummary | null = null;
  if (run.exitValue) {
    try {
      summary = JSON.parse(run.exitValue) as WarmSummary;
    } catch {
      summary = null;
    }
  }
  return { ...ref, run, summary };
}
