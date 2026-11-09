// dwg: React-Hülle um @visuals. Rendert ChartKitchen bzw. P&L mit dem Original-Code.
// Von `dwg app page` geschrieben, wird bei jedem Lauf ersetzt.

import { useEffect, useRef } from 'react';

import {
  mountVisual,
  type MountOptions,
  type VisualHandle,
} from '../vendor/dwg-visuals/dwg-visuals.js';

type Props = Omit<MountOptions, 'theme'> & {
  isDark: boolean;
  /** Erhöhen, um die Auswahl im Visual aufzuheben (z. B. über den Filter-Chip). */
  clearToken?: number;
  className?: string;
};

export function DwgVisual({ isDark, clearToken = 0, className, ...opts }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const handle = useRef<VisualHandle | null>(null);
  const latest = useRef({ ...opts, isDark });

  // jüngste Props für Callbacks und das asynchrone Einhängen
  useEffect(() => {
    latest.current = { ...opts, isDark };
  });

  const { visual } = opts;
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let alive = true;
    let mounted: VisualHandle | null = null;
    // Die Shell skaliert die Seite per CSS-Transform. Das Visual misst seinen Container mit getBoundingClientRect
    // (transformierte, also skalierte Größe); es soll aber in Seitenpixeln rechnen, damit Skalen und Schriften
    // stabil bleiben. Deshalb liefert der Container hier seine Layoutgröße (offsetWidth/offsetHeight).
    const measured = node.getBoundingClientRect.bind(node);
    node.getBoundingClientRect = () => {
      const r = measured();
      if (typeof DOMRect !== 'function' || !node.offsetWidth || !node.offsetHeight) return r;
      return new DOMRect(r.x, r.y, node.offsetWidth, node.offsetHeight);
    };
    const p = latest.current;
    void mountVisual(node, {
      visual,
      table: p.table,
      bindings: p.bindings,
      objects: p.objects,
      formats: p.formats,
      displayNames: p.displayNames,
      columnTypes: p.columnTypes,
      locale: p.locale ?? 'de-DE',
      theme: p.isDark ? 'dark' : 'light',
      interactive: p.interactive,
      onSelect: (keys) => latest.current.onSelect?.(keys),
      onPersist: (objects) => latest.current.onPersist?.(objects),
      onContextMenu: (keys, pos) => latest.current.onContextMenu?.(keys, pos),
      onRendered: (ms) => latest.current.onRendered?.(ms),
      onError: (err) => latest.current.onError?.(err),
    }).then((h) => {
      if (!alive) {
        h.destroy();
        return;
      }
      mounted = h;
      handle.current = h;
      // Daten können sich geändert haben, während der Visual-Code nachgeladen wurde
      const q = latest.current;
      h.update({ table: q.table, bindings: q.bindings, objects: q.objects, theme: q.isDark ? 'dark' : 'light' });
    });
    return () => {
      alive = false;
      mounted?.destroy();
      handle.current = null;
    };
  }, [visual]);

  const { table, bindings, objects, displayNames, formats, columnTypes } = opts;
  useEffect(() => {
    handle.current?.update({ table, bindings, objects, displayNames, formats, columnTypes, theme: isDark ? 'dark' : 'light' });
  }, [table, bindings, objects, displayNames, formats, columnTypes, isDark]);

  useEffect(() => {
    if (clearToken > 0) handle.current?.clearSelection();
  }, [clearToken]);

  return <div ref={el} className={className} style={{ width: '100%', height: '100%' }} />;
}
