/**
 * Configuration for the standalone Python Fabric User Data Functions backend
 * (Option B). All values are injected at build time via Vite env vars.
 *
 * Required env vars (set in `.env` / `.env.local` or the Fabric build):
 *   VITE_FABRIC_TENANT_ID         Entra tenant id (authority)
 *   VITE_FABRIC_SPA_CLIENT_ID     Entra SPA app registration client id
 *   VITE_UDF_LIST_WORKSPACES_URL  Public URL of the list_workspaces function
 *   VITE_UDF_LIST_REPORTS_URL     Public URL of the list_reports function
 *   VITE_UDF_APPLY_FIXER_URL      Public URL of the apply_report_fixer function
 */
export interface UdfConfig {
  tenantId: string;
  clientId: string;
  urls: {
    listWorkspaces: string;
    listReports: string;
    applyReportFixer: string;
    fabricProxy: string;
    githubDeviceStart: string;
    githubDevicePoll: string;
    githubTranslate: string;
    githubCommentM: string;
    githubLandingHtml: string;
    githubTidyWorkspace: string;
  };
}

export function getUdfConfig(): UdfConfig {
  const tenantId = import.meta.env.VITE_FABRIC_TENANT_ID as string | undefined;
  const clientId = import.meta.env.VITE_FABRIC_SPA_CLIENT_ID as string | undefined;
  const listWorkspaces = import.meta.env.VITE_UDF_LIST_WORKSPACES_URL as string | undefined;
  const listReports = import.meta.env.VITE_UDF_LIST_REPORTS_URL as string | undefined;
  const applyReportFixer = import.meta.env.VITE_UDF_APPLY_FIXER_URL as string | undefined;

  if (!tenantId || !clientId) {
    throw new Error(
      'Missing Entra config. Set VITE_FABRIC_TENANT_ID and VITE_FABRIC_SPA_CLIENT_ID.'
    );
  }
  if (!listWorkspaces || !listReports || !applyReportFixer) {
    throw new Error(
      'Missing UDF function URLs. Set VITE_UDF_LIST_WORKSPACES_URL, VITE_UDF_LIST_REPORTS_URL and VITE_UDF_APPLY_FIXER_URL.'
    );
  }

  // The generic proxy lives on the same UDF item — derive its URL from the
  // list_workspaces URL unless an explicit override is provided.
  const fabricProxy =
    (import.meta.env.VITE_UDF_FABRIC_PROXY_URL as string | undefined) ||
    listWorkspaces.replace('/list_workspaces/invoke', '/fabric_proxy/invoke');

  // GitHub device-flow + Copilot translate functions live on the same UDF
  // item too — derive each from the list_workspaces URL.
  const deriveUdf = (fn: string) =>
    listWorkspaces.replace('/list_workspaces/invoke', `/${fn}/invoke`);
  const githubDeviceStart = deriveUdf('github_device_start');
  const githubDevicePoll = deriveUdf('github_device_poll');
  const githubTranslate = deriveUdf('github_translate');
  const githubCommentM = deriveUdf('github_comment_m');
  const githubLandingHtml = deriveUdf('github_landing_html');
  const githubTidyWorkspace = deriveUdf('github_tidy_workspace');

  return {
    tenantId,
    clientId,
    urls: {
      listWorkspaces,
      listReports,
      applyReportFixer,
      fabricProxy,
      githubDeviceStart,
      githubDevicePoll,
      githubTranslate,
      githubCommentM,
      githubLandingHtml,
      githubTidyWorkspace,
    },
  };
}
