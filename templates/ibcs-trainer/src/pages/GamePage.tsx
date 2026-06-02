import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/hooks/AuthContext';
import { getRayfinClient } from '@/services/rayfinClient';

/** Shape posted by the game's `stats.publish()` (see public/game/ibcs_trainer.html). */
interface GameStatsPayload {
  player_name: string;
  timestamp: string;
  duration_seconds: number;
  score: number;
  won: boolean;
  lives_left: number;
  deaths_total: number;
  deaths_enemy: number;
  deaths_water: number;
  deaths_fall: number;
  deaths_lava: number;
  coins_collected: number;
  enemies_stomped: number;
  enemies_zapped: number;
  bosses_killed: number;
  attacks_used: number;
  jumps: number;
  forms_collected: string;
  final_form: string;
  max_x_reached: number;
  level_reached: number;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function GamePage() {
  const { user, signOut } = useAuth();
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastScore, setLastScore] = useState<number | null>(null);
  // Guard against the game re-publishing the same run twice.
  const lastSavedKey = useRef<string | null>(null);

  const saveRun = useCallback(
    async (payload: GameStatsPayload) => {
      if (!user) return;
      const key = `${payload.timestamp}|${payload.score}|${payload.level_reached}`;
      if (lastSavedKey.current === key) return;
      lastSavedKey.current = key;

      setSaveState('saving');
      try {
        await getRayfinClient().data.GameStats.create({
          player_name: payload.player_name,
          score: payload.score,
          won: payload.won,
          lives_left: payload.lives_left,
          duration_seconds: payload.duration_seconds,
          deaths_total: payload.deaths_total,
          deaths_enemy: payload.deaths_enemy,
          deaths_water: payload.deaths_water,
          deaths_fall: payload.deaths_fall,
          deaths_lava: payload.deaths_lava,
          coins_collected: payload.coins_collected,
          enemies_stomped: payload.enemies_stomped,
          enemies_zapped: payload.enemies_zapped,
          bosses_killed: payload.bosses_killed,
          attacks_used: payload.attacks_used,
          jumps: payload.jumps,
          forms_collected: payload.forms_collected,
          final_form: payload.final_form,
          max_x_reached: payload.max_x_reached,
          level_reached: payload.level_reached,
          playedAt: new Date(payload.timestamp),
          user_id: user.id,
        });
        setLastScore(payload.score);
        setSaveState('saved');
      } catch (err) {
        console.error('Failed to save game stats:', err);
        setSaveState('error');
      }
    },
    [user]
  );

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Same-origin iframe: only trust messages from our own window's children.
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; payload?: GameStatsPayload };
      if (data?.type === 'rayfin-game-stats' && data.payload) {
        void saveRun(data.payload);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [saveRun]);

  return (
    <div className="relative min-h-screen bg-[#0a0a1a] flex flex-col items-center justify-center">
      <header className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-3 text-white/80">
        <span className="text-sm font-semibold tracking-wide">IBCS Trainer</span>
        <div className="flex items-center gap-4 text-xs">
          <span aria-live="polite">
            {saveState === 'saving' && 'Saving run…'}
            {saveState === 'saved' &&
              `Run saved${lastScore !== null ? ` · score ${lastScore}` : ''}`}
            {saveState === 'error' && 'Could not save run'}
          </span>
          <button
            onClick={() => void signOut()}
            className="text-white/40 hover:text-white/80 transition-colors"
            aria-label="Sign out"
          >
            Sign out
          </button>
        </div>
      </header>

      <iframe
        src="/game/ibcs_trainer.html"
        title="IBCS Trainer"
        className="border-0 rounded-lg shadow-2xl"
        width={900}
        height={600}
        allow="autoplay"
      />
    </div>
  );
}
