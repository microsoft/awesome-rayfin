import { getRayfinClient } from '@/services/rayfinClient';

/**
 * Persists DOOM save games across reloads.
 *
 * js-dos/DOSBox runs on an in-memory Emscripten filesystem, so DOOM's native
 * DOOMSAV*.DSG files vanish on every reload. This manager reads those bytes out
 * of the emulator FS after the player saves and mirrors them to the backend
 * (one DoomSave row per slot), then writes them back into the FS on the next
 * boot — so Save/Load survives reloads and follows the player across devices.
 *
 * The emulator Module (with its `.FS`) is reachable via the js-dos wrapper:
 * `dosboxInstance.module` is the Emscripten module (see public/jsdos/js-dos-api.js
 * `_jsdos_init`, which runs the runtime with `Module = module`).
 */

// Emscripten FS is untyped here; keep a narrow local shape.
type EmFS = {
  readdir(path: string): string[];
  stat(path: string): { mode: number; size: number };
  isDir(mode: number): boolean;
  isFile(mode: number): boolean;
  readFile(path: string, opts: { encoding: 'binary' }): Uint8Array;
  writeFile(path: string, data: Uint8Array, opts: { encoding: 'binary' }): void;
  unlink?: (path: string) => void;
  mkdirTree?: (path: string) => void;
  mkdir?: (path: string) => void;
  analyzePath?: (path: string) => { exists: boolean };
};
type EmModule = { FS?: EmFS } | null | undefined;

const SAVE_RE = /DOOMSAV(\d+)\.DSG$/i;
const DOOM_EXE_RE = /^DOOM\.EXE$/i;
const SKIP_DIRS = new Set(['/dev', '/proc', '/tmp', '/home']);
const SAVE_NAME_LEN = 24; // DOOM SAVESTRINGSIZE

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function checksum(bytes: Uint8Array): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `${bytes.length}:${h}`;
}

function saveName(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < SAVE_NAME_LEN && i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}

function listFiles(FS: EmFS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = ['/'];
  let guard = 0;
  while (stack.length && guard++ < 5000) {
    const dir = stack.pop() as string;
    let entries: string[];
    try {
      entries = FS.readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name === '.' || name === '..') continue;
      const p = (dir === '/' ? '' : dir) + '/' + name;
      if (seen.has(p)) continue;
      seen.add(p);
      let mode: number;
      try {
        mode = FS.stat(p).mode;
      } catch {
        continue;
      }
      if (FS.isDir(mode)) {
        if (!SKIP_DIRS.has(p)) stack.push(p);
      } else if (FS.isFile(mode)) {
        out.push(p);
      }
    }
  }
  return out;
}

function findSaves(FS: EmFS): Array<{ path: string; slot: number }> {
  const result: Array<{ path: string; slot: number }> = [];
  for (const path of listFiles(FS)) {
    const m = path.match(SAVE_RE);
    if (m) result.push({ path, slot: parseInt(m[1], 10) });
  }
  return result;
}

function findDoomDir(FS: EmFS): string | null {
  for (const path of listFiles(FS)) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (DOOM_EXE_RE.test(name)) return path.slice(0, path.lastIndexOf('/')) || '/';
  }
  return null;
}

function ensureDir(FS: EmFS, dir: string) {
  if (!dir || dir === '/') return;
  if (FS.mkdirTree) {
    try {
      FS.mkdirTree(dir);
      return;
    } catch {
      /* ignore */
    }
  }
  const parts = dir.split('/').filter(Boolean);
  let cur = '';
  for (const part of parts) {
    cur += '/' + part;
    try {
      FS.mkdir?.(cur);
    } catch {
      /* already exists */
    }
  }
}

export type SaveManager = {
  restore: () => Promise<void>;
  flush: () => Promise<void>;
  start: () => void;
  stop: () => void;
};

export function createSaveManager(opts: {
  getModule: () => EmModule;
  getUser: () => { id: string; name: string } | null;
  intervalMs?: number;
}): SaveManager {
  const slotRowId = new Map<number, string>();
  const lastSum = new Map<number, string>();
  let timer: number | null = null;

  const flush = async () => {
    const FS = opts.getModule()?.FS;
    const u = opts.getUser();
    if (!FS || !u) return;
    let saves: Array<{ path: string; slot: number }>;
    try {
      saves = findSaves(FS);
    } catch {
      return;
    }
    const client = getRayfinClient();
    for (const { path, slot } of saves) {
      let bytes: Uint8Array;
      try {
        bytes = FS.readFile(path, { encoding: 'binary' });
      } catch {
        continue;
      }
      if (!bytes || !bytes.length) continue;
      const sum = checksum(bytes);
      if (lastSum.get(slot) === sum) continue;
      const data = bytesToBase64(bytes);
      const name = saveName(bytes);
      try {
        const existing = slotRowId.get(slot);
        if (existing) {
          await client.data.DoomSave.update(
            { id: existing },
            { data, path, name, updated_at: new Date() }
          );
        } else {
          const created = (await client.data.DoomSave.create({
            user_id: u.id,
            slot,
            name,
            path,
            data,
            updated_at: new Date(),
          })) as { id?: string };
          if (created?.id) slotRowId.set(slot, created.id);
        }
        lastSum.set(slot, sum);
        console.log(`Persisted DOOM save slot ${slot} "${name}" (${bytes.length}B)`);
      } catch (err) {
        console.error('Failed to persist DOOM save:', err);
      }
    }
  };

  const restore = async () => {
    const FS = opts.getModule()?.FS;
    const u = opts.getUser();
    if (!FS || !u) return;
    let rows: Array<{ id: string; slot: number; name?: string; path?: string; data?: string }>;
    try {
      rows = (await getRayfinClient()
        .data.DoomSave.select(['id', 'slot', 'name', 'path', 'data'])
        .where({ user_id: { eq: u.id } })
        .execute()) as typeof rows;
    } catch (err) {
      console.error('Failed to load DOOM saves:', err);
      return;
    }
    for (const r of rows) {
      slotRowId.set(r.slot, r.id);
      if (!r.data || !r.path) continue;
      try {
        const bytes = base64ToBytes(r.data);
        ensureDir(FS, r.path.slice(0, r.path.lastIndexOf('/')));
        FS.writeFile(r.path, bytes, { encoding: 'binary' });
        lastSum.set(r.slot, checksum(bytes)); // don't immediately re-upload
        console.log(`Restored DOOM save slot ${r.slot} -> ${r.path} (${bytes.length}B)`);
      } catch (err) {
        console.error('Failed to restore DOOM save:', err);
      }
    }
  };

  const start = () => {
    if (timer == null) timer = window.setInterval(() => void flush(), opts.intervalMs ?? 4000);
  };
  const stop = () => {
    if (timer != null) {
      window.clearInterval(timer);
      timer = null;
    }
  };

  // Debug hook: inspect the FS and force save/restore during testing.
  (window as unknown as { __doomSaves?: unknown }).__doomSaves = {
    fs: () => {
      const FS = opts.getModule()?.FS;
      if (!FS) return { noModuleFS: true };
      try {
        return { doomDir: findDoomDir(FS), saves: findSaves(FS), files: listFiles(FS) };
      } catch (e) {
        return { error: String(e) };
      }
    },
    inject: (slot = 0, name = 'TEST SAVE') => {
      const FS = opts.getModule()?.FS;
      if (!FS) return 'no FS';
      const dir = findDoomDir(FS) || '/DOOM';
      const buf = new Uint8Array(256);
      const nm = name.slice(0, SAVE_NAME_LEN - 1);
      for (let i = 0; i < nm.length; i++) buf[i] = nm.charCodeAt(i);
      for (let i = SAVE_NAME_LEN; i < buf.length; i++) buf[i] = (i * 7) & 255;
      const p = `${dir}/DOOMSAV${slot}.DSG`;
      FS.writeFile(p, buf, { encoding: 'binary' });
      return p;
    },
    purge: async () => {
      const u = opts.getUser();
      if (!u) return 'no user';
      const client = getRayfinClient();
      const rows = (await client.data.DoomSave.select(['id'])
        .where({ user_id: { eq: u.id } })
        .execute()) as Array<{ id: string }>;
      for (const r of rows) await client.data.DoomSave.delete({ id: r.id });
      slotRowId.clear();
      // Remove the FS copies too, so the poller doesn't re-upload them.
      const FS = opts.getModule()?.FS;
      if (FS) {
        try {
          for (const { path } of findSaves(FS)) FS.unlink?.(path);
        } catch {
          /* ignore */
        }
      }
      lastSum.clear();
      return `deleted ${rows.length}`;
    },
    flush,
    restore,
  };

  return { restore, flush, start, stop };
}
