// Semantic-model refresh actions (PKG-10 / MA5).
//
// Triggers a Power BI *enhanced* (asynchronous) refresh via the dataset
// `/refreshes` endpoint, routed through the same server-side `fabric_proxy`
// UDF every other Fabric/PBI call uses. The enhanced API (selected by sending
// a `type` in the body) lets us scope the refresh to the whole model, a set of
// tables, or individual partitions through its `objects` array.
//
// For Direct Lake models a refresh re-frames the model (and the targeted
// tables); for Import models it reloads the data. Either way this is an
// explicit, user-initiated action surfaced as a right-click menu entry in the
// Model Explorer tree.

import { udf } from './udfClient';

/** A single refresh target. Omitting `partition` refreshes the whole table. */
export interface RefreshObject {
  table: string;
  partition?: string;
}

/** Enhanced-refresh processing type (Tabular `RefreshType`). */
export type RefreshType =
  | 'full'
  | 'automatic'
  | 'dataOnly'
  | 'calculate'
  | 'clearValues'
  | 'defragment';

export interface RefreshResult {
  detail: string;
}

/** One row of the dataset refresh history. */
export interface RefreshHistoryEntry {
  requestId?: string;
  refreshType?: string;
  startTime?: string;
  endTime?: string;
  status?: string;
}

/** Human label for a refresh scope, used in status messages. */
function scopeLabel(objects?: RefreshObject[]): string {
  if (!objects || objects.length === 0) return 'the whole model';
  if (objects.length === 1) {
    const o = objects[0];
    return o.partition ? `partition "${o.table}"[${o.partition}]` : `table "${o.table}"`;
  }
  return `${objects.length} objects`;
}

/**
 * Trigger an enhanced (async) refresh. When `objects` is supplied the refresh
 * is scoped to those tables / partitions, otherwise the entire model is
 * refreshed. Resolves once the request has been accepted by the service (the
 * refresh itself continues server-side).
 */
export async function triggerRefresh(
  workspaceId: string,
  datasetId: string,
  objects?: RefreshObject[],
  type: RefreshType = 'full'
): Promise<RefreshResult> {
  if (!workspaceId || !datasetId) {
    return { detail: 'Select a workspace and a semantic model first.' };
  }
  const body: Record<string, unknown> = { type };
  if (objects && objects.length > 0) {
    body.objects = objects.map((o) =>
      o.partition ? { table: o.table, partition: o.partition } : { table: o.table }
    );
  }
  await udf.fabricProxy(
    'pbi',
    `/groups/${workspaceId}/datasets/${datasetId}/refreshes`,
    'POST',
    body
  );
  return { detail: `Refresh of ${scopeLabel(objects)} started.` };
}

/**
 * Read the most recent refresh-history entries for a dataset (newest first).
 * Useful to surface the last refresh status / time. Returns an empty array when
 * the dataset has no recorded refreshes.
 */
export async function getRefreshHistory(
  workspaceId: string,
  datasetId: string,
  top = 5
): Promise<RefreshHistoryEntry[]> {
  if (!workspaceId || !datasetId) return [];
  const data = await udf.fabricProxy<{ value?: RefreshHistoryEntry[] }>(
    'pbi',
    `/groups/${workspaceId}/datasets/${datasetId}/refreshes?$top=${top}`
  );
  return data.value ?? [];
}
