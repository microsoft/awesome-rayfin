/**
 * No Rayfin-managed data entities.
 *
 * This template does not use the Rayfin BaaS data service. It reads a Fabric
 * *semantic model* at runtime via host-brokered Fabric auth (see
 * `services.auth.fabric` in `rayfin.yml`) and `@microsoft/fabric-app-data` —
 * not decorator-defined entities. The bundled demo runs entirely on sample
 * data, so no schema is required.
 *
 * If you later add Rayfin-managed entities (e.g. saved views), define the
 * decorated entity classes here, set `services.data.enabled: true` in
 * `rayfin.yml`, and flip `services.data` to `true` in `manifest.json`.
 */
export const schema = [] as const;

export type Schema = Record<string, never>;
