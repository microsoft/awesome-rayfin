// Workspace editor — copy / move / delete workspace items.
//
// All operations route through the server-side `fabric_proxy` UDF (the static
// app cannot call the Fabric REST API directly). No UDF change is required —
// every endpoint used here is a plain Fabric Core REST call that the generic
// proxy already forwards (it also resolves the 202 long-running operations that
// getDefinition / createItem return).
//
// Copy is implemented as getDefinition → createItem (the portable "clone"
// pattern): the source item's definition is exported and a brand-new item is
// created from it. Only definition-backed item types support this; for the
// rest (Lakehouse, Warehouse, SQL endpoint, …) copy is reported as unsupported
// rather than silently doing nothing.

import { udf } from './udfClient';

export interface WorkspaceItem {
  id: string;
  displayName: string;
  type: string;
  description?: string;
  folderId?: string;
  /** Display-folder path, e.g. "Finance / Monthly". Empty for workspace root. */
  folderPath: string;
}

export interface WorkspaceFolder {
  id: string;
  displayName: string;
  parentFolderId?: string;
  /** Full display path, e.g. "Finance / Monthly". */
  path: string;
}

export interface WorkspaceContents {
  items: WorkspaceItem[];
  folders: WorkspaceFolder[];
}

interface RawItem {
  id: string;
  displayName: string;
  type: string;
  description?: string;
  folderId?: string;
}
interface RawFolder {
  id: string;
  displayName: string;
  parentFolderId?: string;
}

/**
 * Item types that expose a portable definition (getDefinition / createItem) and
 * can therefore be copied. Types that store data or are system-managed
 * (Lakehouse, Warehouse, SQLEndpoint, Dashboard, …) are intentionally excluded.
 */
export const COPYABLE_TYPES = new Set<string>([
  'Report',
  'SemanticModel',
  'Notebook',
  'DataPipeline',
  'SparkJobDefinition',
  'KQLQueryset',
  'KQLDashboard',
  'Eventstream',
  'VariableLibrary',
  'Reflex',
  'GraphQLApi',
  'Dataflow',
  'MirroredDatabase',
  'CopyJob',
]);

export function isCopyable(type: string): boolean {
  return COPYABLE_TYPES.has(type);
}

function buildPath(folderId: string | undefined, byId: Map<string, RawFolder>): string {
  const parts: string[] = [];
  let cur = folderId ? byId.get(folderId) : undefined;
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    parts.unshift(cur.displayName);
    cur = cur.parentFolderId ? byId.get(cur.parentFolderId) : undefined;
  }
  return parts.join(' / ');
}

/** List every item and folder in a workspace, each annotated with its folder path. */
export async function loadWorkspaceContents(workspaceId: string): Promise<WorkspaceContents> {
  const [foldersResp, itemsResp] = await Promise.all([
    udf
      .fabricProxy<{ value: RawFolder[] }>('fabric', `/workspaces/${workspaceId}/folders`)
      .catch(() => ({ value: [] as RawFolder[] })),
    udf.fabricProxy<{ value: RawItem[] }>('fabric', `/workspaces/${workspaceId}/items`),
  ]);

  const byId = new Map<string, RawFolder>();
  for (const f of foldersResp.value ?? []) byId.set(f.id, f);

  const folders: WorkspaceFolder[] = (foldersResp.value ?? [])
    .map((f) => ({
      id: f.id,
      displayName: f.displayName,
      parentFolderId: f.parentFolderId,
      path: buildPath(f.id, byId),
    }))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));

  const items: WorkspaceItem[] = (itemsResp.value ?? [])
    .map((it) => ({
      id: it.id,
      displayName: it.displayName,
      type: it.type,
      description: it.description,
      folderId: it.folderId,
      folderPath: buildPath(it.folderId, byId),
    }))
    .sort(
      (a, b) =>
        a.folderPath.localeCompare(b.folderPath, undefined, { sensitivity: 'base' }) ||
        a.type.localeCompare(b.type) ||
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
    );

  return { items, folders };
}

interface DefinitionPayload {
  definition?: { parts?: { path: string; payload: string; payloadType: string }[] };
}

/**
 * Copy one item into the same workspace via getDefinition → createItem.
 * `targetFolderId` places the copy in a folder (omit for workspace root).
 * Returns the new item's id + name.
 */
export async function copyItem(
  workspaceId: string,
  item: WorkspaceItem,
  newName: string,
  targetFolderId?: string
): Promise<{ id: string; displayName: string }> {
  if (!isCopyable(item.type)) {
    throw new Error(`Copy is not supported for ${item.type} items (no portable definition).`);
  }

  // 1. Export the source definition (heavyweight LRO, resolved by the proxy).
  const def = await udf.fabricProxy<DefinitionPayload>(
    'fabric',
    `/workspaces/${workspaceId}/items/${item.id}/getDefinition`,
    'POST'
  );
  const parts = def.definition?.parts;
  if (!parts || parts.length === 0) {
    throw new Error(`Could not export a definition for "${item.displayName}".`);
  }

  // 2. Create a brand-new item from that definition. Fabric assigns a fresh id;
  //    the copied `.platform` part is harmless (its logicalId is regenerated).
  const body: Record<string, unknown> = {
    displayName: newName,
    type: item.type,
    definition: { parts },
  };
  if (targetFolderId) body.folderId = targetFolderId;

  const created = await udf.fabricProxy<{ id: string; displayName?: string }>(
    'fabric',
    `/workspaces/${workspaceId}/items`,
    'POST',
    body
  );
  return { id: created.id, displayName: created.displayName ?? newName };
}

/** Move one item to a folder within the same workspace (omit target = root). */
export async function moveItem(
  workspaceId: string,
  itemId: string,
  targetFolderId?: string
): Promise<void> {
  await udf.fabricProxy(
    'fabric',
    `/workspaces/${workspaceId}/items/${itemId}/move`,
    'POST',
    targetFolderId ? { targetFolderId } : {}
  );
}

/** Permanently delete one item. Caller MUST guard against bulk/all-item deletes. */
export async function deleteItem(workspaceId: string, itemId: string): Promise<void> {
  await udf.fabricProxy('fabric', `/workspaces/${workspaceId}/items/${itemId}`, 'DELETE');
}

/** Create a folder, optionally nested under `parentFolderId`. */
export async function createFolder(
  workspaceId: string,
  displayName: string,
  parentFolderId?: string
): Promise<WorkspaceFolder> {
  const f = await udf.fabricProxy<RawFolder>(
    'fabric',
    `/workspaces/${workspaceId}/folders`,
    'POST',
    parentFolderId ? { displayName, parentFolderId } : { displayName }
  );
  return {
    id: f.id,
    displayName: f.displayName,
    parentFolderId: f.parentFolderId,
    path: f.displayName,
  };
}
