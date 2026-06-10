/// <reference types="@angular/build" />

interface ImportMetaEnv {
  readonly VITE_RAYFIN_API_URL?: string;
  readonly VITE_RAYFIN_PUBLISHABLE_KEY?: string;
  readonly VITE_RAYFIN_FUNCTIONS_URL?: string;
  readonly VITE_FABRIC_WORKSPACE_ID?: string;
  readonly VITE_FABRIC_ITEM_ID?: string;
  readonly VITE_FABRIC_PORTAL_URL?: string;
  readonly VITE_SYNC_MODE?: string;
  readonly VITE_GITHUB_REPO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
