// Opens the PBIR/TMDL source editor in a standalone browser window via the
// /source route, so it can sit beside the main app as its own window. The MSAL
// session is shared across same-origin windows through the localStorage cache.
import type { DefinitionKind } from '@/services/fabricRest';

export interface SourceWindowParams {
  workspaceId: string;
  kind: DefinitionKind;
  reportId?: string;
  datasetId?: string;
  name?: string;
  /** Optional deep-link: pre-select this definition part path. */
  path?: string;
  /** Optional deep-link: scroll to / highlight this 1-based line. */
  line?: number;
}

export interface SourceWindowResult {
  /** The fully-qualified /source URL (also useful as a copy-able fallback). */
  url: string;
  /** True when the popup opened; false when the browser/iframe blocked it. */
  opened: boolean;
}

export function buildSourceUrl(p: SourceWindowParams): string {
  const q = new URLSearchParams();
  q.set('ws', p.workspaceId);
  q.set('kind', p.kind);
  if (p.reportId) q.set('report', p.reportId);
  if (p.datasetId) q.set('dataset', p.datasetId);
  if (p.name) q.set('name', p.name);
  if (p.path) q.set('path', p.path);
  if (p.line && p.line > 0) q.set('line', String(p.line));
  return `${window.location.origin}/source?${q.toString()}`;
}

/**
 * Try to open the source editor in a new window. Returns the URL plus whether
 * the popup actually opened — Fabric's portal iframe frequently blocks
 * `window.open`, in which case callers can fall back to copying the URL.
 */
export function openSourceWindow(p: SourceWindowParams): SourceWindowResult {
  const url = buildSourceUrl(p);
  const target = `pbir-source-${p.kind}-${p.reportId ?? p.datasetId ?? 'item'}`;
  let win: Window | null = null;
  try {
    win = window.open(url, target, 'noopener,noreferrer,width=1500,height=950');
  } catch {
    win = null;
  }
  return { url, opened: !!win };
}
