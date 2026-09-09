import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useI18n } from '@/i18n';
import type { GuideContext, GuidePlacement, GuideStep } from '@/guide/guideSteps';

/**
 * A spotlight over the part being explained, and a card beside it.
 *
 * ⚠️ THE SPOTLIGHT IS A HOLE, NOT A HIGHLIGHT. Drawing a bright ring around the target still
 * leaves the rest of a busy 3D scene competing for attention; punching a hole in a dim layer with
 * one enormous box-shadow dims everything else instead, which is what makes the eye go to the
 * right place. It also costs one element and no canvas work.
 *
 * ⚠️ AND IT IS RE-READ EVERY FRAME. The targets move: the drawer slides open, the camera flies,
 * the panel is resizable, the window resizes. Wiring listeners for each of those is how a
 * spotlight ends up half a second behind the thing it points at; a rAF loop over one
 * `getBoundingClientRect` is cheap and cannot fall out of step.
 */

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;
const GAP = 16;
const CARD_WIDTH = 340;
const MARGIN = 12;

/**
 * The scrim, stated once and NOT taken from the theme.
 *
 * ⚠️ A DIM MUST BE DARK IN BOTH THEMES, and a stone token cannot promise that. `main.css` inverts
 * the stone ramp for light mode, so `bg-stone-950/70` — which is nearly black on the dark theme —
 * resolves to `#eeebe7` on paper and washes the page out instead of dimming it. Caught by looking
 * at it: the first render of this overlay in light mode made the campus look bleached rather than
 * backgrounded. This is the same trap that made a conflict message invisible twice before.
 * Spotlighting is not theming: the scrim is always dark, so it is written out.
 */
const SCRIM = 'rgb(12 10 9 / 0.72)';

function readRect(selector: string | null): Rect | null {
  if (!selector) return null;
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** Where the card goes, clamped so it can never leave the viewport. */
function placeCard(rect: Rect | null, placement: GuidePlacement, height: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxTop = Math.max(MARGIN, vh - height - MARGIN);
  const clampTop = (t: number) => Math.min(maxTop, Math.max(MARGIN, t));
  const clampLeft = (l: number) => Math.min(vw - CARD_WIDTH - MARGIN, Math.max(MARGIN, l));

  if (!rect) {
    return { top: clampTop(vh / 2 - height / 2), left: clampLeft(vw / 2 - CARD_WIDTH / 2) };
  }

  const spot = {
    top: rect.top - PAD,
    left: rect.left - PAD,
    right: rect.left + rect.width + PAD,
    bottom: rect.top + rect.height + PAD,
  };

  // `auto` picks whichever side has room, preferring the one with the most.
  const room = {
    right: vw - spot.right,
    left: spot.left,
    bottom: vh - spot.bottom,
    top: spot.top,
  };
  let side = placement;
  if (side === 'auto' || side === undefined) {
    side =
      room.right >= CARD_WIDTH + GAP
        ? 'right'
        : room.left >= CARD_WIDTH + GAP
          ? 'left'
          : room.bottom >= height + GAP
            ? 'bottom'
            : 'top';
  }

  switch (side) {
    case 'right':
      return { top: clampTop(spot.top), left: clampLeft(spot.right + GAP) };
    case 'left':
      return { top: clampTop(spot.top), left: clampLeft(spot.left - GAP - CARD_WIDTH) };
    case 'bottom':
      return { top: clampTop(spot.bottom + GAP), left: clampLeft(spot.left) };
    default:
      return { top: clampTop(spot.top - GAP - height), left: clampLeft(spot.left) };
  }
}

export function GuideOverlay({
  steps,
  open,
  onClose,
  getContext,
  vars,
}: {
  steps: GuideStep[];
  open: boolean;
  onClose: () => void;
  getContext: () => GuideContext;
  /**
   * Values the copy may interpolate — currently just the university on screen.
   *
   * ⚠️ THE OPENING LINE NAMES THE CUSTOMER, so it cannot be a literal. It read "Timetabling at
   * OTH Regensburg is still largely manual" while the same build also serves three other
   * universities, which makes the very first sentence of the tour false on three of four sites.
   * The name comes from the AOI that is actually loaded.
   */
  vars?: Record<string, string | number>;
}) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardHeight, setCardHeight] = useState(220);
  const cardRef = useRef<HTMLDivElement>(null);
  const activeStep = useRef<GuideStep | null>(null);

  const total = steps.length;
  const step = steps[index];

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // ⚠️ `onLeave` runs from the cleanup, so a step that revealed something restores it even when
  // the tour is closed mid-way rather than stepped through to the end.
  useEffect(() => {
    if (!open || !step) return;
    activeStep.current = step;
    step.onEnter?.(getContext());
    return () => {
      const leaving = activeStep.current;
      activeStep.current = null;
      leaving?.onLeave?.(getContext());
    };
  }, [open, step, getContext]);

  useLayoutEffect(() => {
    if (!open || !step) return;
    let raf = 0;
    const tick = () => {
      setRect((prev) => {
        const next = readRect(step.target);
        if (
          prev?.top === next?.top &&
          prev?.left === next?.left &&
          prev?.width === next?.width &&
          prev?.height === next?.height
        ) {
          return prev;
        }
        return next;
      });
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [open, step]);

  useLayoutEffect(() => {
    if (!open) return;
    const h = cardRef.current?.offsetHeight;
    if (h && h !== cardHeight) setCardHeight(h);
  }, [open, index, rect, cardHeight]);

  const goNext = useCallback(() => {
    setIndex((i) => {
      if (i >= total - 1) {
        onClose();
        return i;
      }
      return i + 1;
    });
  }, [total, onClose]);

  const goBack = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, goNext, goBack]);

  if (!open || !step) return null;

  const card = placeCard(rect, step.placement ?? 'auto', cardHeight);
  const isLast = index === total - 1;

  return (
    <div
      data-testid="guide-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('guide.title')}
      className="pointer-events-none fixed inset-0 z-50"
    >
      {rect ? (
        <div
          data-testid="guide-spotlight"
          className="pointer-events-none absolute rounded-lg ring-2 ring-amber-400/70 transition-all duration-200"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: `0 0 0 9999px ${SCRIM}`,
          }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0" style={{ background: SCRIM }} />
      )}

      <div
        ref={cardRef}
        data-testid="guide-card"
        className="pointer-events-auto absolute rounded-lg border border-stone-700 bg-stone-900 p-4 shadow-2xl"
        style={{ top: card.top, left: card.left, width: CARD_WIDTH }}
      >
        <div className="flex items-start justify-between gap-2">
          <span
            data-testid="guide-source"
            className="rounded bg-stone-800 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-[0.14em] text-stone-400"
          >
            {t(`guide.source.${step.source}`)}
          </span>
          <button
            type="button"
            data-testid="guide-close"
            onClick={onClose}
            aria-label={t('guide.close')}
            className="-mt-1 rounded px-1 text-lg leading-none text-stone-500 hover:text-stone-300"
          >
            ×
          </button>
        </div>

        <strong className="mt-2 block text-sm text-stone-100">
          {t(`guide.step.${step.id}.title`, vars)}
        </strong>
        <p
          data-testid="guide-body"
          aria-live="polite"
          className="mt-1.5 text-[0.72rem] leading-relaxed text-stone-300"
        >
          {t(`guide.step.${step.id}.body`, vars)}
        </p>

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[0.65rem] tabular-nums text-stone-500">
            {index + 1} / {total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="guide-back"
              onClick={goBack}
              disabled={index === 0}
              className="rounded border border-stone-700 px-2 py-1 text-[0.68rem] text-stone-300 disabled:opacity-40"
            >
              {t('guide.back')}
            </button>
            <button
              type="button"
              data-testid="guide-next"
              onClick={goNext}
              className="rounded bg-amber-500 px-2.5 py-1 text-[0.68rem] font-medium text-ink"
            >
              {isLast ? t('guide.done') : t('guide.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
