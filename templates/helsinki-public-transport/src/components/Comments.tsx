import { useState } from 'react';

import { useVehicleComments } from '@/hooks/useVehicleComments';

interface CommentsProps {
  vehicleId: string;
  route: string;
  /** Signed-in user id, used to decide whose comments show a delete affordance. */
  currentUserId: string | null;
}

function timeAgo(value: Date | string): string {
  const then = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(then.getTime())) return '';
  const seconds = Math.max(0, Math.round((Date.now() - then.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return then.toLocaleDateString();
}

export function Comments({ vehicleId, route, currentUserId }: CommentsProps) {
  const { comments, loading, error, saving, add, remove } = useVehicleComments(vehicleId);
  const [draft, setDraft] = useState('');

  const submit = async () => {
    if (!draft.trim() || saving) return;
    await add(draft);
    setDraft('');
  };

  return (
    <section className="mt-3 border-t border-white/10 pt-3" data-testid="vehicle-comments">
      <h3 className="text-[10px] tracking-wider opacity-50">
        COMMENTS <span className="tabular-nums">({comments.length})</span>
      </h3>

      <div className="mt-2 flex items-center gap-1">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="Add a comment..."
          aria-label={`Add a comment about route ${route || vehicleId}`}
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[12px] placeholder:opacity-40 focus:border-white/25 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!draft.trim() || saving}
          aria-label="Post comment"
          className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-[12px] transition-colors hover:bg-white/[0.08] disabled:opacity-30"
        >
          {saving ? '...' : '\u27a4'}
        </button>
      </div>

      {error ? (
        <p className="mt-2 text-[10px] text-amber-300/80">
          Comments unavailable - {error}
        </p>
      ) : null}

      {loading && comments.length === 0 ? (
        <p className="mt-2 text-[11px] opacity-40">Loading...</p>
      ) : null}

      {!loading && !error && comments.length === 0 ? (
        <p className="mt-2 text-[11px] opacity-40">No comments yet</p>
      ) : null}

      <ul className="mt-2 space-y-2">
        {comments.map((comment) => (
          <li key={comment.id} className="rounded-md bg-white/[0.04] px-2 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[11px] font-medium opacity-80">{comment.author}</span>
              <span className="shrink-0 text-[10px] opacity-40">{timeAgo(comment.createdAt)}</span>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px]">{comment.body}</p>
            {currentUserId && comment.user_id === currentUserId ? (
              <button
                type="button"
                onClick={() => void remove(comment.id)}
                className="mt-1 text-[10px] opacity-40 hover:opacity-100"
              >
                Delete
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
