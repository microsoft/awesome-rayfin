/**
 * Function schema types for RayfinClient.
 *
 * AUTO-GENERATED — do not edit manually.
 * Re-generated automatically when function source files change.
 *
 * If this file is not updating automatically, run:
 *   rayfin functions typegen --watch
 *
 * The schema is a closed object type: only the function names listed
 * below are accepted by RayfinClient.functions.<name>.invoke(...).
 * Adding, renaming, or changing the signature of a udf.func() call
 * regenerates this file and surfaces type errors at every consumer.
 *
 * IMPORTANT: This file must NOT import any Node.js packages — it is
 * resolved by the frontend app's TypeScript compiler.
 */

export type AppFunctionsSchema = {
  listWorkspaces: {
    input: Record<string, never>;
    output: { id: string; displayName: string }[];
  };
  listReports: {
    input: { workspaceId: string };
    output: { id: string; displayName: string }[];
  };
  applyReportFixer: {
    input: { workspaceId: string; reportId: string; fixerId: string; scanOnly: boolean };
    output: {
  fixerId: string;
  scanOnly: boolean;
  matched: number;
  changed: number;
  findings: { path: string; detail: string }[];
  applied: boolean;
};
  };
};
