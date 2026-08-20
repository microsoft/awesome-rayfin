//-----------------------------------------------------------------------
// Semantic Directory — model configuration detection.
//
// The template ships with a placeholder connection (all-zero GUIDs) so it can
// boot into a self-contained DEMO experience with zero setup. The moment a real
// workspace + semantic model is wired into `fabric.yaml` (and regenerated into
// `fabric.generated.ts`), the app flips to LIVE mode and introspects THAT model.
//
// This helper is the single source of truth for "is a real model connected?".
//-----------------------------------------------------------------------

import { fabricConfig } from "@/fabric.generated";
import { CONNECTION } from "@/queries/metadata";

/** The placeholder GUID shipped in the template's fabric.yaml (= not configured). */
const PLACEHOLDER_GUID = "00000000-0000-0000-0000-000000000000";

type SemanticModelRef = { workspaceId?: string; itemId?: string };

/**
 * True when the primary connection points at a real workspace + semantic model
 * (i.e. the template has been configured for live use), false while it still
 * carries the demo placeholder GUIDs.
 */
export function isModelConfigured(): boolean {
    const models = fabricConfig.semanticModels as
        | Record<string, SemanticModelRef>
        | undefined;
    const model = models?.[CONNECTION];
    if (!model) return false;
    const ws = (model.workspaceId ?? "").trim();
    const item = (model.itemId ?? "").trim();
    return (
        ws.length > 0 &&
        item.length > 0 &&
        ws !== PLACEHOLDER_GUID &&
        item !== PLACEHOLDER_GUID
    );
}
