import type { CaldovaModelSchema } from "../../rayfin/connectors/caldovaModel/schema";

/**
 * Connectors declared in `rayfin/rayfin.yml`.
 *
 * `caldovaModel` points at the `caldova-operations` semantic model and runs
 * with delegated auth, so the model's `RegionalManager` row-level security
 * scopes every query to the stores the signed-in manager is responsible for.
 */
export type AppConnectorsSchema = {
    caldovaModel: CaldovaModelSchema;
};
