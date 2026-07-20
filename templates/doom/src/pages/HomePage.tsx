import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/hooks/AuthContext';
import { getRayfinClient } from '@/services/rayfinClient';
import { watchDoomStats, type LevelResult, type StatsWatcher } from '@/game/doomStats';
import { createSaveManager, type SaveManager } from '@/game/doomSaves';

// Self-hosted, fully free stack (no external calls, no purchased game data):
//  - js-dos / DOSBox runtime (GPL) served from this app's own origin
//  - id Software's SHAREWARE DOOM (engine + DOOM1.WAD, Episode 1), which id
//    licenses for free redistribution, packaged as the DOS bundle below.
// 100% shareware content: the Ultimate engine needs an M_EPI4 episode-menu
// graphic that the shareware WAD lacks, so we synthesise it from the WAD's own
// M_EPI3 lump — no third-party (Freedoom/commercial) assets are bundled.
// Version query cache-busts the non-hashed public asset across redeploys.
// jQuery must load first: in the Fabric app runtime, js-dos-api.js's bundled
// jqlite fails to self-install its global `$`, so we supply real jQuery.
const JQUERY_SCRIPT = '/jsdos/jquery.min.js';
const JS_DOS_SCRIPT = '/jsdos/js-dos-api.js?v=4';
const DOOM_ZIP = '/game/doom.zip';
const DOOM_EXE = './DOOM/DOOM.EXE';

function waitForDosbox(timeout = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const check = () => {
      const Dosbox = (window as any).Dosbox;
      if (typeof Dosbox === 'function') {
        resolve(Dosbox);
        return;
      }

      if (Date.now() - start >= timeout) {
        reject(new Error('Dosbox did not become available within timeout.'));
        return;
      }

      window.setTimeout(check, 100);
    };

    check();
  });
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

// episode*10 + map -> "E1M3" (0 = no level finished yet).
function levelLabel(rank: number): string {
  if (rank <= 0) return '\u2014';
  return `E${Math.floor(rank / 10)}M${rank % 10}`;
}

type BoardRow = {
  name: string;
  farthest: number; // episode*10 + map, for ranking
  totalKills: number; // sum of kills_pct across completed levels
  playtime: number; // seconds
};

export function HomePage() {
  const doomRef = useRef<HTMLDivElement | null>(null);
  const dosboxRef = useRef<any>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      (window as unknown as { __doomSetMuted?: (v: boolean) => void }).__doomSetMuted?.(next);
      return next;
    });
  }, []);

  // Keep the latest signed-in user reachable from the one-shot init effect.
  const { user } = useAuth();
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Session-recording refs. DOSBox can't emit DOOM's in-game score, so we log
  // the play session (who / when / how long) instead.
  const sessionIdRef = useRef<string | null>(null);
  const startTimeRef = useRef<number | null>(null);

  // Per-level stats read off DOOM's "FINISHED" screen (see game/doomStats.ts).
  const watcherRef = useRef<StatsWatcher | null>(null);

  // Persists DOOM save games across reloads (see game/doomSaves.ts).
  const saveMgrRef = useRef<SaveManager | null>(null);

  // Shared leaderboard: farthest level reached + kills, with playtime alongside.
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);

  const loadBoard = useCallback(async () => {
    setBoardLoading(true);
    try {
      const client = getRayfinClient();
      const [levels, sessions] = await Promise.all([
        client.data.DoomLevelResult.select([
          'player_name',
          'user_id',
          'episode',
          'map',
          'kills_pct',
        ]).execute() as Promise<
          Array<{
            player_name?: string;
            user_id?: string;
            episode?: number;
            map?: number;
            kills_pct?: number;
          }>
        >,
        client.data.DoomSession.select([
          'player_name',
          'duration_seconds',
          'user_id',
        ]).execute() as Promise<
          Array<{ player_name?: string; user_id?: string; duration_seconds?: number }>
        >,
      ]);

      const byPlayer = new Map<string, BoardRow>();
      const get = (key: string, name: string) => {
        let entry = byPlayer.get(key);
        if (!entry) {
          entry = { name, farthest: 0, totalKills: 0, playtime: 0 };
          byPlayer.set(key, entry);
        } else if (name && entry.name === 'Player') {
          entry.name = name;
        }
        return entry;
      };

      for (const r of levels) {
        const key = r.user_id || r.player_name || 'unknown';
        const entry = get(key, r.player_name || 'Player');
        const rank = (r.episode || 1) * 10 + (r.map || 0);
        if (rank > entry.farthest) entry.farthest = rank;
        entry.totalKills += r.kills_pct || 0;
      }
      for (const s of sessions) {
        const key = s.user_id || s.player_name || 'unknown';
        const entry = get(key, s.player_name || 'Player');
        entry.playtime += s.duration_seconds || 0;
      }

      const ranked = [...byPlayer.values()].sort(
        (a, b) =>
          b.farthest - a.farthest || b.totalKills - a.totalKills || b.playtime - a.playtime
      );
      setBoard(ranked.slice(0, 10));
    } catch (err) {
      console.error('Failed to load leaderboard:', err);
    } finally {
      setBoardLoading(false);
    }
  }, []);

  const toggleBoard = useCallback(() => {
    setBoardOpen((open) => {
      const next = !open;
      if (next) void loadBoard();
      return next;
    });
  }, [loadBoard]);

  useEffect(() => {
    let cancelled = false;
    let heartbeat: number | null = null;
    let autostart: number | null = null;

    // Update the current session's duration + end time (best-effort).
    const flush = async () => {
      const id = sessionIdRef.current;
      if (!id || startTimeRef.current == null) return;
      const seconds = Math.round((Date.now() - startTimeRef.current) / 1000);
      try {
        await getRayfinClient().data.DoomSession.update(
          { id },
          { duration_seconds: seconds, ended_at: new Date() }
        );
      } catch (err) {
        console.error('Failed to update Doom session:', err);
      }
    };

    // Create one session row when DOOM.EXE actually starts, then heartbeat.
    const startSession = async () => {
      const u = userRef.current;
      if (!u || sessionIdRef.current) return;
      startTimeRef.current = Date.now();
      try {
        const created = (await getRayfinClient().data.DoomSession.create({
          player_name: u.name,
          duration_seconds: 0,
          booted: true,
          started_at: new Date(),
          ended_at: new Date(),
          user_id: u.id,
        })) as { id?: string };
        if (created?.id) {
          sessionIdRef.current = created.id;
          heartbeat = window.setInterval(() => void flush(), 10000);
        }
      } catch (err) {
        console.error('Failed to start Doom session:', err);
      }
    };

    const onBeforeUnload = () => {
      void flush();
      void saveMgrRef.current?.flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    // Mirrors DOOM's save files to the backend so they survive reloads.
    const saveManager = createSaveManager({
      getModule: () => dosboxRef.current?.module,
      getUser: () => userRef.current,
    });
    saveMgrRef.current = saveManager;

    // Save one row per completed level, read off DOOM's FINISHED screen.
    const saveLevelResult = async (r: LevelResult) => {
      const u = userRef.current;
      if (!u) return;
      try {
        await getRayfinClient().data.DoomLevelResult.create({
          player_name: u.name,
          episode: r.episode,
          map: r.map,
          kills_pct: r.kills,
          items_pct: r.items,
          secrets_pct: r.secrets,
          time_seconds: r.timeSeconds,
          completed_at: new Date(),
          user_id: u.id,
        });
        console.log(
          `Recorded DOOM level E${r.episode}M${r.map}: ${r.kills}% kills / ${r.items}% items / ${r.secrets}% secret / ${r.timeSeconds}s`
        );
      } catch (err) {
        console.error('Failed to save Doom level result:', err);
      }
    };

    const startWatcher = () => {
      if (watcherRef.current) return;
      watcherRef.current = watchDoomStats({
        getCanvas: () => doomRef.current?.querySelector('canvas') ?? null,
        onLevelComplete: (r) => void saveLevelResult(r),
      });
    };

    async function initDoom() {
      try {
        await loadScript(JQUERY_SCRIPT);
        await loadScript(JS_DOS_SCRIPT);
        const Dosbox = await waitForDosbox();

        if (cancelled || !doomRef.current) {
          return;
        }

        dosboxRef.current = new Dosbox({
          id: 'DOOM',
          onload(dosbox: any) {
            dosbox.run(DOOM_ZIP, DOOM_EXE);
          },
          onrun(_dosbox: any, app: string) {
            console.log(`App '${app}' is runned`);
            void startSession();
            startWatcher();
            // Restore persisted saves into the emulator FS, then watch for new ones.
            void saveManager.restore();
            saveManager.start();
          },
        });

        // Auto-launch: click the js-dos "Click to start" overlay for the user.
        // (Audio stays suspended until the first real keypress, per browser policy.)
        autostart = window.setInterval(() => {
          const startEl = doomRef.current?.querySelector<HTMLElement>('.dosbox-start');
          if (startEl) {
            startEl.click();
            if (autostart) { window.clearInterval(autostart); autostart = null; }
          }
        }, 150);

      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to initialize DOOM.';
        setErrorMessage(message);
        console.error('Unable to load Doom JS-DOS:', error);
      }
    }

    initDoom();

    return () => {
      cancelled = true;
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (heartbeat) clearInterval(heartbeat);
      if (autostart) clearInterval(autostart);
      watcherRef.current?.stop();
      watcherRef.current = null;
      saveManager.stop();
      void saveManager.flush();
      void flush();
      if (dosboxRef.current?.destroy) {
        try {
          dosboxRef.current.destroy();
        } catch {
          // ignore cleanup errors
        }
      }
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#121212] text-white">
      <style>{`
        body { background-color: #121212; color: white; }
        /* Fill the frame, but center the game and keep its aspect ratio
           (scale to height, letterbox the sides) so it isn't stretched wide. */
        #DOOM,
        #DOOM > .dosbox-container {
          width: 100% !important;
          height: 100% !important;
        }
        #DOOM > .dosbox-container {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          background: #000 !important;
        }
        #DOOM > .dosbox-container > .dosbox-canvas,
        #DOOM > .dosbox-container > canvas {
          width: auto !important;
          height: 100% !important;
          max-width: 100% !important;
          max-height: 100% !important;
          image-rendering: pixelated;
        }
        #DOOM > .dosbox-container > .dosbox-overlay {
          background: #101010;
        }
        /* js-dos renders the "Click to start" label empty under real jQuery,
           so provide the prompt ourselves. */
        #DOOM .dosbox-start:empty::after {
          content: 'Click to start';
        }
        .doom-link {
          color: white;
          text-decoration: underline;
        }
        .doom-button {
          border-radius: 0.75rem;
          background-color: rgba(90, 90, 90, 0.85);
          color: white;
          border: 1px solid rgba(255, 255, 255, 0.12);
          padding: 0.75rem 1.5rem;
          font-weight: 600;
          cursor: pointer;
        }
        .doom-button:hover {
          background-color: rgba(255, 255, 255, 0.08);
        }
      `}</style>
      <div className="mx-auto flex min-h-screen w-full max-w-[1800px] flex-col items-center px-2 py-2 text-center sm:px-4 sm:py-3">

        <div className="relative mb-2 h-[calc(100vh-110px)] min-h-[420px] w-full overflow-hidden rounded-2xl border border-white/10 bg-black p-0 shadow-2xl shadow-black/30">
          <div id="DOOM" className="dosbox-default h-full w-full" ref={doomRef} />
          <button
            type="button"
            onClick={toggleMute}
            className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/50 text-base text-white/80 backdrop-blur transition-colors hover:bg-black/70 hover:text-white"
            title={muted ? 'Unmute' : 'Mute'}
            aria-label={muted ? 'Unmute sound' : 'Mute sound'}
          >
            {muted ? '\u{1F507}' : '\u{1F50A}'}
          </button>
        </div>
        {errorMessage ? (
          <div className="mb-4 rounded-2xl bg-red-950/70 p-4 text-left text-sm text-red-200">
            <strong>Error loading DOOM:</strong>
            <p>{errorMessage}</p>
          </div>
        ) : (
          <p className="mb-2 text-xs text-slate-400">
            <span className="text-slate-300">Controls:</span> Arrow keys move &amp; turn ·{' '}
            <span className="text-slate-300">Space</span> shoots ·{' '}
            <span className="text-slate-300">W</span> opens doors ·{' '}
            <span className="text-slate-300">Shift</span> runs ·{' '}
            <span className="text-slate-300">Esc</span> menu — shareware Episode 1 (Knee-Deep in the Dead)
          </p>
        )}

        <div className="mt-2 flex w-full items-start justify-between gap-4 text-xs text-slate-500">
          <div className="relative">
            <button
              type="button"
              onClick={toggleBoard}
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-white/15 text-slate-400 hover:bg-white/10 hover:text-white"
              title="Leaderboard"
              aria-label="Leaderboard"
              aria-expanded={boardOpen}
            >
              🏆
            </button>
            {boardOpen && (
              <div className="absolute bottom-full left-0 z-20 mb-2 min-w-[340px] rounded-lg border border-white/10 bg-black/90 p-3 text-left shadow-xl backdrop-blur">
                <div className="mb-2 flex items-center justify-between gap-4">
                  <span className="font-medium text-slate-300">🏆 Leaderboard</span>
                  <button
                    type="button"
                    onClick={() => setBoardOpen(false)}
                    className="flex h-5 w-5 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white"
                    title="Close"
                    aria-label="Close leaderboard"
                  >
                    ✕
                  </button>
                </div>
                {boardLoading ? (
                  <p className="text-slate-400">Loading…</p>
                ) : board.length === 0 ? (
                  <p className="text-slate-400">No runs recorded yet — play a round!</p>
                ) : (
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="text-slate-400">
                        <th className="pr-3 text-left font-medium">#</th>
                        <th className="pr-3 text-left font-medium">Player</th>
                        <th className="pr-3 text-left font-medium">Level</th>
                        <th className="pr-3 text-right font-medium">Kills</th>
                        <th className="text-right font-medium">Playtime</th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.map((row, i) => (
                        <tr key={row.name + i} className="text-slate-200">
                          <td className="pr-3">{i + 1}</td>
                          <td className="pr-3">{row.name}</td>
                          <td className="pr-3 tabular-nums text-slate-300">{levelLabel(row.farthest)}</td>
                          <td className="pr-3 text-right tabular-nums">{row.totalKills}</td>
                          <td className="text-right tabular-nums">{formatDuration(row.playtime)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>

          <details>
            <summary
              className="flex h-6 w-6 cursor-pointer list-none items-center justify-center rounded-full border border-white/15 text-slate-400 hover:bg-white/10 hover:text-white"
              title="Credits & licence"
              aria-label="Credits and licence"
            >
              &#9432;
            </summary>
            <div className="mt-2 max-w-md text-left leading-relaxed">
              Based on{' '}
              <a className="doom-link" href="https://github.com/sandervandevelde/Play-Doom-On-Microsoft-Fabric" target="_blank" rel="noreferrer">Play-Doom-On-Microsoft-Fabric</a>{' '}
              · DOSBox-in-browser by{' '}
              <a className="doom-link" href="https://github.com/thedoggybrad/doom_on_js-dos" target="_blank" rel="noreferrer">thedoggybrad</a>{' '}
              · DOOM shareware © id Software (redistributed under its shareware licence)
            </div>
          </details>
        </div>
      </div>
    </main>
  );
}
