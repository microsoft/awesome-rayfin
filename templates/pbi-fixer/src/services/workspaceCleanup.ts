// Workspace cleanup — organise loose items into freshly created folders.
//
// Builds on the primitives in `workspaceEditor` (createFolder / moveItem). The
// cleanup only ever touches items that sit *directly* in the chosen scope (the
// workspace root or a single selected folder) — items already tucked inside
// subfolders are left alone. For each computed group a folder is created inside
// the scope (or an existing same-named folder in scope is reused) and the
// group's items are moved into it.
//
// Two non-AI grouping strategies are offered:
//   • 'type' — group by Fabric item type (Reports, Semantic models, …). The
//     recommended default: predictable and complete.
//   • 'name' — group by a shared leading name token (everything before the
//     first space / "-" / "_"); singletons fall into an "Other" bucket.
//
// An AI strategy delegates the grouping to GitHub Copilot via the
// `github_tidy_workspace` UDF, which returns a folder name per item.

import { createFolder, moveItem, type WorkspaceFolder, type WorkspaceItem } from './workspaceEditor';
import { getGithubToken } from './githubAuth';
import { GithubAuthRequiredError } from './mCommenter';
import { udf } from './udfClient';

export type CleanupMode = 'type' | 'name';

export interface CleanupGroup {
  /** Target folder name (created in scope, or an existing one reused). */
  folder: string;
  items: WorkspaceItem[];
}

export interface CleanupResult {
  name: string;
  ok: boolean;
  folder: string;
  detail?: string;
}

/** Friendly, pluralised folder names for the common Fabric item types. */
const TYPE_FOLDER: Record<string, string> = {
  Report: 'Reports',
  PaginatedReport: 'Paginated reports',
  SemanticModel: 'Semantic models',
  Notebook: 'Notebooks',
  DataPipeline: 'Data pipelines',
  Lakehouse: 'Lakehouses',
  Warehouse: 'Warehouses',
  SQLEndpoint: 'SQL endpoints',
  SQLDatabase: 'SQL databases',
  KQLDatabase: 'KQL databases',
  KQLQueryset: 'KQL querysets',
  KQLDashboard: 'KQL dashboards',
  Eventstream: 'Eventstreams',
  Eventhouse: 'Eventhouses',
  Dataflow: 'Dataflows',
  Datamart: 'Datamarts',
  Dashboard: 'Dashboards',
  SparkJobDefinition: 'Spark job definitions',
  MLModel: 'ML models',
  MLExperiment: 'ML experiments',
  MirroredDatabase: 'Mirrored databases',
  VariableLibrary: 'Variable libraries',
  Reflex: 'Data activators',
  GraphQLApi: 'GraphQL APIs',
  CopyJob: 'Copy jobs',
  Environment: 'Environments',
};

/** Map a Fabric item type to a tidy, pluralised folder name. */
export function typeFolderName(type: string): string {
  const known = TYPE_FOLDER[type];
  if (known) return known;
  // Fallback: split PascalCase into words and pluralise.
  const spaced = (type || 'Other').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return /s$/i.test(spaced) ? spaced : `${spaced}s`;
}

/** Leading name token, e.g. "Sales - Monthly" → "Sales", "fin_budget" → "fin". */
function leadingToken(name: string): string {
  const trimmed = (name || '').trim();
  const token = trimmed.split(/\s*[-_\s]\s*/)[0]?.trim();
  return token || trimmed || 'Other';
}

function sortGroups(map: Map<string, WorkspaceItem[]>): CleanupGroup[] {
  return [...map.entries()]
    .map(([folder, items]) => ({ folder, items }))
    .sort((a, b) => a.folder.localeCompare(b.folder, undefined, { sensitivity: 'base' }));
}

/** Group items by Fabric item type (recommended default). */
function planByType(items: WorkspaceItem[]): CleanupGroup[] {
  const map = new Map<string, WorkspaceItem[]>();
  for (const it of items) {
    const key = typeFolderName(it.type);
    const arr = map.get(key) ?? [];
    arr.push(it);
    map.set(key, arr);
  }
  return sortGroups(map);
}

/** Group items by a shared leading name token; singletons go to "Other". */
function planByName(items: WorkspaceItem[]): CleanupGroup[] {
  // Bucket case-insensitively, but keep the first-seen original casing.
  const buckets = new Map<string, { label: string; items: WorkspaceItem[] }>();
  for (const it of items) {
    const token = leadingToken(it.displayName);
    const key = token.toLowerCase();
    const b = buckets.get(key) ?? { label: token, items: [] };
    b.items.push(it);
    buckets.set(key, b);
  }
  const map = new Map<string, WorkspaceItem[]>();
  for (const b of buckets.values()) {
    if (b.items.length >= 2) {
      map.set(b.label, b.items);
    } else {
      const other = map.get('Other') ?? [];
      other.push(...b.items);
      map.set('Other', other);
    }
  }
  return sortGroups(map);
}

/** Compute a non-AI cleanup plan for the given items. */
export function planCleanup(items: WorkspaceItem[], mode: CleanupMode): CleanupGroup[] {
  return mode === 'name' ? planByName(items) : planByType(items);
}

/** Build cleanup groups from explicit `{ id → folder }` assignments. */
export function groupsFromAssignments(
  items: WorkspaceItem[],
  assignments: { id: string; folder: string }[]
): CleanupGroup[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const map = new Map<string, WorkspaceItem[]>();
  const seen = new Set<string>();
  for (const a of assignments) {
    const it = byId.get(a.id);
    const folder = (a.folder || '').trim();
    if (!it || !folder || seen.has(it.id)) continue;
    const arr = map.get(folder) ?? [];
    arr.push(it);
    map.set(folder, arr);
    seen.add(it.id);
  }
  // Anything the AI skipped lands in "Other" so nothing is silently dropped.
  const leftover = items.filter((i) => !seen.has(i.id));
  if (leftover.length) {
    const arr = map.get('Other') ?? [];
    arr.push(...leftover);
    map.set('Other', arr);
  }
  return sortGroups(map);
}

/**
 * AI-authored cleanup plan. Calls the `github_tidy_workspace` UDF with the item
 * names + types and turns the returned per-item folder assignments into groups.
 * Requires a GitHub sign-in (throws {@link GithubAuthRequiredError} when no
 * token is held).
 */
export async function buildAiCleanupPlan(items: WorkspaceItem[]): Promise<CleanupGroup[]> {
  const token = getGithubToken();
  if (!token) throw new GithubAuthRequiredError();
  if (items.length === 0) return [];
  const { assignments } = await udf.githubTidyWorkspace(
    token,
    items.map((it) => ({ id: it.id, name: it.displayName, type: it.type }))
  );
  return groupsFromAssignments(items, assignments ?? []);
}

/**
 * Apply a cleanup plan: create each target folder inside `scopeFolderId`
 * (undefined = workspace root), reusing an existing same-named folder in scope
 * when present, then move the group's items into it. Returns a flat per-item
 * result list. Groups with a single empty folder name are skipped defensively.
 */
export async function applyCleanupPlan(
  workspaceId: string,
  plan: CleanupGroup[],
  scopeFolderId: string | undefined,
  existingFolders: WorkspaceFolder[]
): Promise<CleanupResult[]> {
  const results: CleanupResult[] = [];
  for (const group of plan) {
    const folderName = (group.folder || '').trim();
    if (!folderName || group.items.length === 0) continue;

    let folderId: string | undefined;
    try {
      const existing = existingFolders.find(
        (f) =>
          f.displayName.toLowerCase() === folderName.toLowerCase() &&
          (f.parentFolderId ?? undefined) === scopeFolderId
      );
      folderId = existing
        ? existing.id
        : (await createFolder(workspaceId, folderName, scopeFolderId)).id;
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message : String(e);
      for (const it of group.items) {
        results.push({ name: it.displayName, ok: false, folder: folderName, detail: `Folder: ${detail}` });
      }
      continue;
    }

    for (const it of group.items) {
      try {
        await moveItem(workspaceId, it.id, folderId);
        results.push({ name: it.displayName, ok: true, folder: folderName });
      } catch (e: unknown) {
        results.push({
          name: it.displayName,
          ok: false,
          folder: folderName,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
  return results;
}
