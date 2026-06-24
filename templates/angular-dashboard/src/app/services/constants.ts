// Well-known UUIDs used by the app.

// The single AppConfig row's primary key. There is only ever one config
// row; we look it up by this fixed id so the lookup is deterministic.
export const APP_CONFIG_ID = '00000000-0000-0000-0000-000000000001';

// Namespace UUID for deterministic v5 ids of synced Task rows.
// Task id = uuidv5(`${repo}#${number}`, TASK_NAMESPACE_UUID).
export const TASK_NAMESPACE_UUID = '5b3c8a9e-7d2f-4c1b-9e6a-1f8d4c5b7a2e';

// Project id for the synced "GitHub" project. One project per repo; the
// repo identity is stored on the row, the id is deterministic from the repo.
export const PROJECT_NAMESPACE_UUID = '9a1d2b3c-4e5f-6789-abcd-ef0123456789';

// Sync freshness window: dashboard auto-runs the sync if the last
// successful sync is older than this.
export const SYNC_STALE_MS = 24 * 60 * 60 * 1000;

// GitHub REST API caps per sync (10 pages * 100 items).
export const GITHUB_MAX_PAGES = 10;
export const GITHUB_PAGE_SIZE = 100;
