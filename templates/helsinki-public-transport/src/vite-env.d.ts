/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RAYFIN_API_URL?: string;
  readonly VITE_RAYFIN_PUBLISHABLE_KEY?: string;
  readonly VITE_FABRIC_WORKSPACE_ID?: string;
  readonly VITE_FABRIC_ITEM_ID?: string;
  readonly VITE_FABRIC_PORTAL_URL?: string;
  readonly VITE_FABRIC_TENANT_ID?: string;
  /** Fallback Power BI data path - see src/services/powerBiDirect.ts. */
  readonly VITE_PBI_CLIENT_ID?: string;
  readonly VITE_PBI_TENANT_ID?: string;
  readonly VITE_PBI_DATASET_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
