// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { formatRoute, historyInit, historyPush, historyRedo, historyReplace, historyUndo, parseRoute } from './route';

describe('route', () => {
  it('round-trips the new scheme', () => {
    const r = { page: 'guv' as const, qs: 'j=2026&m=ytd' };
    expect(parseRoute(formatRoute(r))).toEqual(r);
    expect(parseRoute('#/cockpit')).toEqual({ page: 'cockpit', qs: '' });
  });

  it('falls back to the cockpit for unknown pages and empty hashes', () => {
    expect(parseRoute('')).toEqual({ page: 'cockpit', qs: '' });
    expect(parseRoute('#/nope?x=1')).toEqual({ page: 'cockpit', qs: '' });
  });

  it('migrates legacy links of the three former apps', () => {
    // the former DWG pages open the original visual inside GuV & Simulation
    expect(parseRoute('#statement')).toEqual({ page: 'guv', qs: 'pv=visual' });
    expect(parseRoute('#baum')).toEqual({ page: 'guv', qs: 'pv=visual' });
    expect(parseRoute('#/statement')).toEqual({ page: 'guv', qs: 'pv=visual' });
    expect(parseRoute('#/baum?x=1')).toEqual({ page: 'guv', qs: 'pv=visual' });
    expect(parseRoute('#j=2026&sim=%7B%7D')).toEqual({ page: 'guv', qs: 'j=2026&sim=%7B%7D' });
    expect(parseRoute('#m=ytd')).toEqual({ page: 'guv', qs: 'm=ytd' });
    expect(parseRoute('#period=fy&m=USA%7CChina')).toEqual({ page: 'cockpit', qs: 'period=fy&m=USA%7CChina' });
  });
});

describe('history', () => {
  it('pushes, undoes and redoes', () => {
    let h = historyInit('a');
    h = historyPush(h, 'b', 1000);
    h = historyPush(h, 'c', 5000);
    expect(h.past).toEqual(['a', 'b']);
    h = historyUndo(h);
    expect(h.present).toBe('b');
    h = historyRedo(h);
    expect(h.present).toBe('c');
    h = historyUndo(historyUndo(h));
    expect(h.present).toBe('a');
    expect(historyUndo(h)).toBe(h);
  });

  it('coalesces rapid changes and clears the redo stack on a new change', () => {
    let h = historyInit('a');
    h = historyPush(h, 'b', 1000);
    h = historyPush(h, 'b2', 1200);
    h = historyPush(h, 'b3', 1400);
    expect(h.past).toEqual(['a']);
    expect(h.present).toBe('b3');
    h = historyUndo(h);
    h = historyPush(h, 'x', 9000);
    expect(h.future).toEqual([]);
    expect(historyPush(h, 'x', 9500)).toBe(h);
  });

  it('never coalesces page switches, so undo returns to the filtered state', () => {
    let h = historyInit('#/cockpit', 1000);
    h = historyPush(h, '#/cockpit?m=USA', 5000);
    h = historyPush(h, '#/guv', 5100, { coalesce: false });
    expect(h.past).toEqual(['#/cockpit', '#/cockpit?m=USA']);
    h = historyUndo(h);
    expect(h.present).toBe('#/cockpit?m=USA');
    h = historyPush(h, '#/cockpit?m=USA%7CChina', 5200);
    expect(h.past).toEqual(['#/cockpit', '#/cockpit?m=USA']);
  });

  it('replaces without adding history', () => {
    const h = historyReplace(historyPush(historyInit('a', 1), 'b', 5000), 'b2');
    expect(h.past).toEqual(['a']);
    expect(h.present).toBe('b2');
  });
});
