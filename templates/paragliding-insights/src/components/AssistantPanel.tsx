import { useI18n } from '@/i18n';
import type { AssistantStatus } from '@/voice/assistant';

/**
 * Mode E — the assistant, as a control rather than a chat window (PLAN §3).
 *
 * Deliberately small. The transcript exists so a listener can see it understood correctly, not so
 * anyone reads a conversation — the interesting output of this mode is the *map moving*, and a
 * panel large enough to read comfortably would compete with the thing it is driving.
 *
 * ⚠️ Usually unavailable, and it says so. The published app is static hosting and cannot mint a
 * realtime secret, exactly as it cannot hold an OGN socket or a Fabric token. Third time this
 * pattern appears in this app, and the answer is the same each time: state the limitation, keep
 * everything else working.
 */
export function AssistantPanel({
  status,
  detail,
  transcript,
  onToggle,
}: {
  status: AssistantStatus;
  detail?: string;
  transcript: { role: 'user' | 'assistant'; text: string }[];
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const active = status === 'listening' || status === 'connecting';

  return (
    <div data-testid="assistant-panel" data-status={status} className="text-sm text-stone-700">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.16em] text-stone-500">{t('assistant.label')}</p>
        <span
          className={`text-[0.65rem] uppercase tracking-[0.12em] ${
            status === 'listening' ? 'text-emerald-700' : 'text-stone-500'
          }`}
        >
          {t(`assistant.status_${status}`)}
        </span>
      </div>

      <button
        type="button"
        data-testid="assistant-toggle"
        onClick={onToggle}
        aria-pressed={active}
        className={`mt-2 flex w-full items-center justify-between rounded px-2 py-1 text-left transition-colors ${
          active ? 'bg-stone-800 text-stone-50' : 'hover:bg-stone-200/70'
        }`}
      >
        <span>{active ? t('assistant.stop') : t('assistant.start')}</span>
        <span className="text-xs opacity-70">{active ? '■' : '🎙'}</span>
      </button>

      {status === 'unavailable' && (
        <p className="mt-2 text-[0.7rem] leading-relaxed text-stone-500">
          {t('assistant.unavailable')}
          {detail ? ` (${detail})` : ''}
        </p>
      )}

      {transcript.length > 0 && (
        <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-[0.7rem] leading-relaxed">
          {transcript.slice(-6).map((line, index) => (
            <li
              key={`${index}-${line.text.slice(0, 12)}`}
              className={line.role === 'user' ? 'text-stone-500' : 'text-stone-800'}
            >
              <span className="opacity-50">{line.role === 'user' ? '▸ ' : '◂ '}</span>
              {line.text}
            </li>
          ))}
        </ul>
      )}

      {active && (
        <p className="mt-2 text-[0.7rem] leading-relaxed text-stone-500">{t('assistant.hint')}</p>
      )}

      <p className="mt-2 text-[0.7rem] leading-relaxed text-stone-500">{t('assistant.notice')}</p>
    </div>
  );
}
