import { useCallback, useEffect, useRef, useState } from 'react';

import {
  availabilityTemplateUrl,
  getAvailability,
  importAvailability,
  setAvailability,
  type AvailabilityClash,
  type AvailabilityImport,
  type AvailabilitySlot,
  type AvailabilityView,
} from '@/api/scheduler';
import { planStoreIdentity, saveAvailability } from '@/api/planStore';
import { useI18n } from '@/i18n';

/**
 * WHEN ONE LECTURER CAN TEACH — the editable half of the constraint the whole product turns on.
 *
 * ⚠️ THIS PANEL CHANGES WHAT THE PLAN IS JUDGED AGAINST, NOT THE PLAN. Blocking a Monday does not
 * move a lecture; it makes the existing one illegal. So the panel's job is not "save" — it is to
 * show, immediately and in the same breath, which sessions the change has just put in conflict.
 * A green tick here with nothing else on screen would hide the only fact the planner needed.
 *
 * ⚠️ THE STATES ARE THE DATASET'S, THE WORDS ARE NOT. `verfuegbar` / `eingeschraenkt` /
 * `nicht_verfuegbar` are identifiers the solver compares against; every string a human reads comes
 * from the catalogue. This project has already shipped German prose written by a Python generator
 * into an English build once.
 */

const STATES = ['verfuegbar', 'eingeschraenkt', 'nicht_verfuegbar'] as const;
type State = (typeof STATES)[number];

/** Clicking cycles. Three states, one control, and the order runs from most to least available. */
const NEXT: Record<State, State> = {
  verfuegbar: 'eingeschraenkt',
  eingeschraenkt: 'nicht_verfuegbar',
  nicht_verfuegbar: 'verfuegbar',
};

const CELL: Record<State, string> = {
  verfuegbar: 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25',
  eingeschraenkt: 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25',
  nicht_verfuegbar: 'bg-red-500/20 text-red-300 hover:bg-red-500/30',
};

export interface AvailabilityPanelProps {
  site: string;
  /** Whoever the week is currently showing — an id or a name, both resolve server-side. */
  teacher: string;
  /** So the shell can re-read the calendar once availability has moved under it. */
  onChanged?: () => void;
}

export function AvailabilityPanel({ site, teacher, onChanged }: AvailabilityPanelProps) {
  const { t } = useI18n();
  const [view, setView] = useState<AvailabilityView | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [clashes, setClashes] = useState<AvailabilityClash[]>([]);
  const [preview, setPreview] = useState<AvailabilityImport | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** The file the preview belongs to, kept so "apply" uploads the same bytes the planner saw. */
  const pending = useRef<File | null>(null);

  const load = useCallback(async () => {
    if (!site || !teacher) {
      setView(null);
      return;
    }
    setLoading(true);
    try {
      const v = await getAvailability(site, teacher);
      setView(v);
    } catch {
      // ⚠️ The reason goes to the console, never to the screen — the server writes English.
      setView(null);
      setNote(t('availability.errLoad'));
    } finally {
      setLoading(false);
    }
  }, [site, teacher, t]);

  useEffect(() => {
    void load();
    setClashes([]);
    setNote(null);
    setPreview(null);
  }, [load]);

  const days: string[] = [];
  const blocks: number[] = [];
  for (const s of view?.slots ?? []) {
    if (!days.includes(s.day)) days.push(s.day);
    if (!blocks.includes(s.block)) blocks.push(s.block);
  }
  blocks.sort((a, b) => a - b);
  const at = (day: string, block: number): AvailabilitySlot | undefined =>
    view?.slots.find((s) => s.day === day && s.block === block);

  /** Write one cell, then say what it broke. */
  const toggle = useCallback(
    async (slot: AvailabilitySlot) => {
      if (!view || busy) return;
      const next = NEXT[slot.state as State];
      setBusy(true);
      // Optimistic, because a 35-cell grid that waits for a round trip per click feels broken.
      // The server's answer replaces it either way, so a refused write cannot survive as a tick.
      setView({
        ...view,
        slots: view.slots.map((s) => (s.slotId === slot.slotId ? { ...s, state: next } : s)),
      });
      try {
        const result = await setAvailability(site, view.teacherId, [
          { slotId: slot.slotId, state: next },
        ], planStoreIdentity() ?? '');
        setClashes(result.nowInConflict ?? []);
        setNote(
          result.nowInConflict?.length
            ? t('availability.savedWithClash', { count: String(result.nowInConflict.length) })
            : t('availability.saved')
        );
        // ⚠️ Durability is a separate write, exactly as it is for a published plan: the backend
        // scales to zero, so SQL is what makes this survive. Reported, never assumed.
        const identity = planStoreIdentity();
        if (identity) {
          const out = await saveAvailability(
            site,
            view.teacherId,
            [{ slotId: slot.slotId, state: next }],
            'ui',
            identity
          );
          if (out.failed) setNote(t('availability.savedNotStored'));
        } else {
          setNote(t('availability.savedNotStored'));
        }
        onChanged?.();
      } catch {
        setNote(t('availability.errSave'));
        void load();
      } finally {
        setBusy(false);
      }
    },
    [busy, load, onChanged, site, t, view]
  );

  /** Read a returned spreadsheet — and do nothing with it yet. */
  const inspect = useCallback(
    async (file: File) => {
      setBusy(true);
      setNote(null);
      try {
        const result = await importAvailability(site, file, false, planStoreIdentity() ?? '');
        pending.current = file;
        setPreview(result);
        if (result.error) setNote(t(`availability.importErr.${result.error}`));
      } catch {
        setNote(t('availability.errImport'));
      } finally {
        setBusy(false);
      }
    },
    [site, t]
  );

  /** Apply the file the planner has just looked at. */
  const applyImport = useCallback(async () => {
    const file = pending.current;
    if (!file) return;
    setBusy(true);
    try {
      const identity = planStoreIdentity() ?? '';
      const result = await importAvailability(site, file, true, identity);
      setClashes(result.nowInConflict ?? []);
      setNote(
        t('availability.imported', {
          teachers: String(result.teachersChanged),
          clashes: String(result.nowInConflict?.length ?? 0),
        })
      );
      if (identity) {
        for (const c of result.changes) {
          await saveAvailability(site, c.teacherId, c.entries, 'import', identity);
        }
      }
      setPreview(null);
      pending.current = null;
      if (fileRef.current) fileRef.current.value = '';
      await load();
      onChanged?.();
    } catch {
      setNote(t('availability.errImport'));
    } finally {
      setBusy(false);
    }
  }, [load, onChanged, site, t]);

  if (!teacher) return <p className="text-xs text-stone-400">{t('availability.pickTeacher')}</p>;

  return (
    <div data-testid="availability-panel" className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xs font-semibold text-stone-200" data-testid="availability-teacher">
          {view?.teacher ?? (loading ? t('availability.loading') : '—')}
        </span>
        <span className="text-[0.7rem] text-stone-500">{t('availability.intro')}</span>
      </div>

      {view && (
        <table className="w-full table-fixed text-[0.68rem]" data-testid="availability-grid">
          <thead>
            <tr className="text-stone-500">
              <th className="w-14" />
              {days.map((d) => (
                <th key={d} className="pb-1 font-normal uppercase tracking-wider">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b}>
                <th className="pr-2 text-right align-middle font-normal tabular-nums text-stone-500">
                  {at(days[0], b)?.startTime ?? b}
                </th>
                {days.map((d) => {
                  const slot = at(d, b);
                  if (!slot) return <td key={d} />;
                  const state = slot.state as State;
                  return (
                    <td key={d} className="p-0.5">
                      <button
                        type="button"
                        data-testid={`availability-cell-${slot.slotId}`}
                        aria-label={`${slot.slotId} ${t(`availability.state.${state}`)}`}
                        title={
                          slot.teaches
                            ? t('availability.teachesHere', { session: slot.teaches })
                            : t(`availability.state.${state}`)
                        }
                        disabled={busy}
                        onClick={() => void toggle(slot)}
                        className={`w-full rounded px-1 py-1.5 transition disabled:opacity-60 ${CELL[state]}`}
                      >
                        {/*
                          ⚠️ A dot, not a word: the cell is ~40 px wide and any label would be
                          truncated into ambiguity. The colour carries the state, the tooltip and
                          the aria-label carry it in words, and the legend below names all three.
                        */}
                        {slot.teaches ? '●' : '·'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.65rem] text-stone-500">
        {STATES.map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span className={`inline-block h-2.5 w-2.5 rounded ${CELL[s].split(' ')[0]}`} />
            {t(`availability.state.${s}`)}
          </span>
        ))}
        <span className="flex items-center gap-1">● {t('availability.teaches')}</span>
      </div>

      {/*
        ⚠️ THE CONFLICTS ARE THE POINT OF THIS PANEL, so they sit under the grid rather than in a
        toast that disappears. Nothing has moved — the rule these sessions are judged by changed.
      */}
      {clashes.length > 0 && (
        <div data-testid="availability-clashes" className="rounded border border-red-500/40 bg-red-500/10 p-2">
          <p className="text-[0.7rem] font-semibold text-red-300">
            {t('availability.clashTitle', { count: String(clashes.length) })}
          </p>
          <ul className="mt-1 space-y-0.5">
            {clashes.map((c) => (
              <li key={c.sessionId} className="flex items-baseline gap-2 text-[0.68rem] text-stone-300">
                <span className="font-mono text-red-300">{c.slotId}</span>
                <span className="truncate">{c.course}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[0.65rem] text-stone-400">{t('availability.clashHint')}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-stone-800 pt-2">
        {/*
          ⚠️ NO LECTURER, NO PER-PERSON LINK — it must not fall back to "everybody".
          `availabilityTemplateUrl(site, undefined)` is the ALL-lecturers URL, so whenever `view`
          failed to load this button silently handed over a 414-row workbook labelled "Vorlage für
          diese Person". That is how a wrong `site` (the panel was asking `oth-real` for an `oth`
          teacher id) turned into "the download is broken" instead of "that teacher is not on this
          site". A disabled control states the problem; a working one that does something else
          hides it.
        */}
        {view?.teacherId ? (
          <a
            data-testid="availability-template"
            href={availabilityTemplateUrl(site, view.teacherId)}
            className="rounded border border-stone-700 px-2 py-1 text-[0.7rem] text-stone-300 hover:border-amber-500/50 hover:text-amber-300"
          >
            {t('availability.download')}
          </a>
        ) : (
          <span
            data-testid="availability-template"
            aria-disabled="true"
            title={t('availability.downloadNoTeacher')}
            className="cursor-not-allowed rounded border border-stone-800 px-2 py-1 text-[0.7rem] text-stone-600"
          >
            {t('availability.download')}
          </span>
        )}
        <a
          data-testid="availability-template-all"
          href={availabilityTemplateUrl(site)}
          className="text-[0.68rem] text-stone-500 hover:text-stone-300"
        >
          {t('availability.downloadAll')}
        </a>
        <button
          type="button"
          data-testid="availability-upload"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="ml-auto rounded border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-[0.7rem] font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
        >
          {t('availability.upload')}
        </button>
        <input
          ref={fileRef}
          data-testid="availability-file"
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void inspect(f);
          }}
        />
      </div>

      {/*
        ⚠️ UPLOAD IS TWO STEPS AND THIS IS THE FIRST. The file has been round-tripped through
        somebody's laptop; what it would do is shown BEFORE it does it. A one-click import of a
        spreadsheet nobody has looked at is how a lecturer quietly loses a morning they said they
        could not teach.
      */}
      {preview && !preview.error && (
        <div data-testid="availability-preview" className="rounded border border-amber-500/40 bg-amber-500/5 p-2">
          <p className="text-[0.7rem] text-amber-200">
            {t('availability.previewTitle', {
              file: preview.fileName,
              read: String(preview.teachersRead),
              changed: String(preview.teachersChanged),
            })}
          </p>
          <ul className="mt-1 max-h-28 space-y-0.5 overflow-auto">
            {preview.changes.map((c) => (
              <li key={c.teacherId} className="text-[0.68rem] text-stone-300">
                {c.teacher} — {t('availability.previewRow', { count: String(c.changed) })}
              </li>
            ))}
          </ul>
          {preview.unknownTeachers.length > 0 && (
            <p className="mt-1 text-[0.65rem] text-stone-400">
              {t('availability.previewUnknown', {
                names: preview.unknownTeachers.slice(0, 3).join(', '),
                count: String(preview.unknownTeachers.length),
              })}
            </p>
          )}
          {preview.badValues.length > 0 && (
            <p className="mt-1 text-[0.65rem] text-red-300" data-testid="availability-preview-bad">
              {t('availability.previewBad', {
                count: String(preview.badValues.length),
                sample: preview.badValues
                  .slice(0, 2)
                  .map((b) => `${b.slotId}: "${b.value}"`)
                  .join(', '),
              })}
            </p>
          )}
          {/*
            ⚠️ THE CONSEQUENCE, NOT THE EDIT COUNT. "12 Änderungen" is a fact about the file;
            "4 Termine werden dadurch ungültig" is the fact somebody is deciding on. The server
            computes this without writing, so it can be shown BEFORE the apply button rather than
            explained afterwards — which is the whole reason the import has two steps.

            It is not a refusal: making the current plan illegal is the first half of the cascade
            this product exists for. It just may not happen silently.
          */}
          {(preview.wouldConflict?.length ?? 0) > 0 && (
            <p
              className="mt-1 text-[0.68rem] font-medium text-amber-200"
              data-testid="availability-preview-clash"
            >
              {t('availability.previewClash', {
                count: String(preview.wouldConflict?.length ?? 0),
                sample: (preview.wouldConflict ?? [])
                  .slice(0, 2)
                  .map((c) => `${c.slotId} ${c.course}`)
                  .join(', '),
              })}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              data-testid="availability-apply"
              disabled={busy || preview.teachersChanged === 0}
              onClick={() => void applyImport()}
              className="rounded border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-[0.7rem] font-medium text-amber-200 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:border-stone-700 disabled:bg-transparent disabled:text-stone-600"
            >
              {t('availability.apply', { count: String(preview.teachersChanged) })}
            </button>
            <button
              type="button"
              data-testid="availability-discard"
              onClick={() => {
                setPreview(null);
                pending.current = null;
                if (fileRef.current) fileRef.current.value = '';
              }}
              className="text-[0.68rem] text-stone-500 hover:text-stone-300"
            >
              {t('availability.discard')}
            </button>
          </div>
        </div>
      )}

      {note && (
        <p data-testid="availability-note" className="text-[0.7rem] text-amber-200">
          {note}
        </p>
      )}
    </div>
  );
}
