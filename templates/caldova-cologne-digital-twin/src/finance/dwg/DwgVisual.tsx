// dwg: React wrapper around @dwg/visuals. Renders ChartKitchen or P&L with the original code.
// Written by `dwg app page`, replaced on every run; patched by tools/finance/dwg-english.mjs.

import { useEffect, useRef } from 'react';

import {
  mountVisual,
  type MountOptions,
  type VisualHandle,
} from '../vendor/dwg-visuals/dwg-visuals.js';

type Props = Omit<MountOptions, 'theme'> & {
  isDark: boolean;
  /** increase to clear the selection in the visual (e.g. from the filter chip). */
  clearToken?: number;
  className?: string;
};

export function DwgVisual({ isDark, clearToken = 0, className, ...opts }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const handle = useRef<VisualHandle | null>(null);
  const latest = useRef({ ...opts, isDark });

  // latest props for callbacks and the asynchronous mount
  useEffect(() => {
    latest.current = { ...opts, isDark };
  });

  const { visual } = opts;
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let alive = true;
    let mounted: VisualHandle | null = null;
    // The shell scales the page with a CSS transform. The visual measures its container with getBoundingClientRect
    // (the transformed, i.e. scaled size); it should compute in page pixels though, so scales and fonts
    // stay stable. That is why the container reports its layout size here (offsetWidth/offsetHeight).
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
      locale: p.locale ?? 'en-GB',
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
      // data may have changed while the visual code was loading
      const q = latest.current;
      h.update({ table: q.table, bindings: q.bindings, objects: q.objects, theme: q.isDark ? 'dark' : 'light' });
    });
    return () => {
      alive = false;
      mounted?.destroy();
      handle.current = null;
    };
  }, [visual]);

  const { table, bindings, objects, displayNames, formats } = opts;
  useEffect(() => {
    handle.current?.update({ table, bindings, objects, displayNames, formats, theme: isDark ? 'dark' : 'light' });
  }, [table, bindings, objects, displayNames, formats, isDark]);

  useEffect(() => {
    if (clearToken > 0) handle.current?.clearSelection();
  }, [clearToken]);

  return <div ref={el} className={className} style={{ width: '100%', height: '100%' }} />;
}
