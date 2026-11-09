// dwg: one page of the app spec. Every tile queries the semantic model with DAX
// (daxQuery), a click in one tile filters the others (TREATAS), the filter chip
// clears the selection. Filters from outside (slicers in the filter panel of DwgShell) apply to
// every tile. With `fixedWidth` the page sits in stage pixels (DwgShell scales it as a whole),
// otherwise it scales to the measured width. Written by `dwg app page`, replaced on every run;
// patched by tools/finance/dwg-english.mjs.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { useSemanticModelQuery } from '@finance/hooks/use-semantic-model-query';

import { daxQuery, type DaxFilter, type SelectionKey } from '../vendor/dwg-visuals/dwg-visuals.js';
import {
  pageHeight,
  pageRegion,
  selectionLabel,
  tileBox,
  tileFilters,
  withoutHeaders,
  type DwgBox,
  type DwgPageSpec,
  type DwgSelection,
  type DwgTileSpec,
} from './dwg-page';
import { DwgVisual } from './DwgVisual';

function friendly(message: string): string {
  if (/401|403|forbidden|permission|unauthori/i.test(message))
    return 'No permission on the semantic model (read and build needed).';
  if (/capacity|429|throttl/i.test(message))
    return 'The Fabric capacity is busy right now. Please reload in a moment.';
  return message;
}

interface TileProps {
  tile: DwgTileSpec;
  page: DwgPageSpec;
  connection: string;
  selection: DwgSelection | null;
  extraFilters: DaxFilter[];
  clearToken: number;
  isDark: boolean;
  hideHeaders: boolean;
  onSelect: (tile: string, keys: SelectionKey[]) => void;
}

function DwgTile({ tile, page, connection, selection, extraFilters, clearToken, isDark, hideHeaders, onSelect }: TileProps) {
  const filters = useMemo(
    () => tileFilters(page, tile.id, selection, extraFilters),
    [page, tile.id, selection, extraFilters]
  );
  const q = useMemo(
    () =>
      daxQuery(tile.visual, tile.bindings, {
        filters,
        sortBy: tile.sortBy,
        showItemsWithNoData: tile.showItemsWithNoData,
      }),
    [tile, filters]
  );
  const { data, isLoading, error, refetch } = useSemanticModelQuery({ connection, query: q.query });
  const table = data?.status === 'success' ? data.table : undefined;
  // render error (e.g. the result does not fit the roles), per query
  const [renderError, setRenderError] = useState<{ query: string; message: string } | null>(null);
  const message = error
    ? friendly(error.message)
    : data?.status === 'error'
      ? friendly(data.error.message)
      : renderError?.query === q.query
        ? renderError.message
        : null;
  const displayNames = useMemo(() => ({ ...q.displayNames, ...tile.displayNames }), [q.displayNames, tile.displayNames]);
  // headers off: format pane override only, no new query
  const objects = useMemo(
    () => (hideHeaders ? withoutHeaders(tile.visual, tile.objects) : tile.objects),
    [hideHeaders, tile.visual, tile.objects]
  );

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }} data-dwg-tile={tile.id}>
      {table && (
        <DwgVisual
          visual={tile.visual}
          table={table}
          bindings={q.bindings}
          displayNames={displayNames}
          formats={tile.formats}
          locale="en-GB"
          objects={objects}
          isDark={isDark}
          clearToken={clearToken}
          onSelect={(keys) => onSelect(tile.id, keys)}
          onError={(err) => setRenderError({ query: q.query, message: err instanceof Error ? err.message : String(err) })}
        />
      )}
      {isLoading && (
        <div
          className="rounded-full bg-accent px-300 py-100 text-100 text-accent-foreground"
          style={{ position: 'absolute', top: 8, right: 8 }}
        >
          loading…
        </div>
      )}
      {message && (
        <div
          role="alert"
          className="p-400 text-center text-200"
          style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}
        >
          <div>
            <p className="mb-200 font-semibold">{tile.title ?? tile.id}: no data</p>
            <p className="mb-300 text-foreground/70">{message}</p>
            <button type="button" className="rounded-md border border-border px-300 py-100" onClick={() => void refetch()}>
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const NO_FILTERS: DaxFilter[] = [];

interface PageProps {
  page: DwgPageSpec;
  connection: string;
  isDark: boolean;
  /** filters for every tile, e.g. from the slicers; keep the same reference, otherwise every tile queries again */
  filters?: DaxFilter[];
  /** visible page region in page pixels (default: whole page), e.g. without the shell's frame zones */
  region?: DwgBox;
  /** fixed width in stage pixels instead of measuring (shell resolution mode); tiles on whole pixels */
  fixedWidth?: number;
  /** border and fill per tile (e.g. from DwgShell), on top of the Tailwind classes */
  tileStyle?: CSSProperties;
  /** position of the filter chip (e.g. absolute in the stage header); default: row above the tiles */
  chipStyle?: CSSProperties;
  /** hide the visuals' title blocks and toolbars */
  hideVisualHeaders?: boolean;
}

export function DwgPage({
  page,
  connection,
  isDark,
  filters = NO_FILTERS,
  region,
  fixedWidth,
  tileStyle,
  chipStyle,
  hideVisualHeaders = false,
}: PageProps) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [selection, setSelection] = useState<DwgSelection | null>(null);
  const [clearToken, setClearToken] = useState(0);

  useEffect(() => {
    const node = box.current;
    // measure with fixedWidth too: switching to the fluid mode then already has the width
    if (!node) return;
    // ignore width 0 (page briefly hidden): otherwise the tiles unmount and query again
    const measure = () => {
      const w = Math.floor(node.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };
    if (typeof ResizeObserver === 'undefined') {
      // e.g. jsdom in tests: measure once and follow the window size
      const frame = requestAnimationFrame(measure);
      window.addEventListener('resize', measure);
      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener('resize', measure);
      };
    }
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const onSelect = (tile: string, keys: SelectionKey[]) => setSelection(keys.length ? { tile, keys } : null);
  const clear = () => {
    setSelection(null);
    setClearToken((t) => t + 1);
  };
  const w = fixedWidth ?? width;
  const narrow = !fixedWidth && w > 0 && w < 900;
  const area = region ?? pageRegion(page);
  const label = selectionLabel(selection);
  const box0 = (tile: DwgTileSpec) => {
    const b = tileBox(tile, page, w, 900, area);
    return fixedWidth
      ? { ...b, left: Math.round(b.left ?? 0), top: Math.round(b.top ?? 0), width: Math.round(b.width), height: Math.round(b.height) }
      : b;
  };

  return (
    <div className="flex flex-col gap-300">
      <div className="flex min-h-[32px] flex-wrap items-center gap-200" aria-live="polite" style={chipStyle}>
        {label && (
          <button
            type="button"
            className="rounded-full border border-primary px-300 py-100 text-200 text-primary"
            title="Clear the filter"
            onClick={clear}
          >
            {label} ×
          </button>
        )}
      </div>
      <div
        ref={box}
        style={
          narrow
            ? { display: 'flex', flexDirection: 'column', gap: 12 }
            : { position: 'relative', height: Math.round(pageHeight(page, w, area)), ...(fixedWidth ? { width: fixedWidth } : {}) }
        }
      >
        {w > 0 &&
          page.tiles.map((tile) => (
            <section
              key={tile.id}
              aria-label={tile.title ?? tile.id}
              className="overflow-hidden rounded-lg border border-border bg-card p-200"
              style={{ ...tileStyle, ...box0(tile), boxSizing: 'border-box' }}
            >
              <DwgTile
                tile={tile}
                page={page}
                connection={connection}
                selection={selection}
                extraFilters={filters}
                clearToken={clearToken}
                isDark={isDark}
                hideHeaders={hideVisualHeaders}
                onSelect={onSelect}
              />
            </section>
          ))}
      </div>
    </div>
  );
}
