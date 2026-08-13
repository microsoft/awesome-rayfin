/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the live AIS relay, e.g. http://127.0.0.1:8788. See server/ais/relay.js. */
  readonly VITE_AIS_RELAY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
