import { describe, expect, it, vi } from 'vitest';

import { requireIdentity, resetMine, sentToday, toLiveReorder, unitsOnOrder, type LiveClient, type LiveReorder } from '../live';
import { rowsOf, type Snapshot } from '../snapshot';
import { salesRate } from '../../reorder/queries/product-detail/sales-rate';
import { lowStockQueue } from '../../reorder/queries/regional-dashboard/low-stock-queue';

const snapshot: Snapshot = {
  version: 'test',
  modelId: 'm',
  latestSalesDate: '2026-10-16T00:00:00',
  bakedAt: '2026-10-19T00:00:00Z',
  stores: { P001: { name: 'Caldova Partner Pharmacy 001', region: 'Innenstadt' } },
  products: { 'PAIN-003': { name: 'Ibuprofen 400 mg' } },
  queries: {
    lowStockQueue: {
      columns: ['Stores[store_id]', 'Stores[name]', 'Products[sku]', 'Products[name]', '[DaysOfStock]', '[StockStatus]', '[OnHandUnits]', '[SuggestedReorderUnits]'],
      rows: [[0, 0, 0, 0, 1.25, 0, 3, 41.6]],
      dict: {
        'Stores[store_id]': ['P001'],
        'Stores[name]': ['Caldova Partner Pharmacy 001'],
        'Products[sku]': ['PAIN-003'],
        'Products[name]': ['Ibuprofen 400 mg'],
        '[StockStatus]': ['Critical'],
      },
    },
    salesRate: {
      columns: ['Products[sku]', 'Stores[store_id]', '[StoreWeek]', '[StoreMonth]', '[RegionWeek]', '[RegionMonth]', '[SuggestedUnits]', '[DaysOfStock]', '[TargetCoverDays]', '[ThresholdDays]'],
      rows: [
        [0, 0, 2.5, 2.1, 80, 75, 42, 1.25, 21, 7],
        [0, 1, 9, 9, 80, 75, 0, 30, 21, 7],
      ],
      dict: { 'Products[sku]': ['PAIN-003'], 'Stores[store_id]': ['P001', 'P002'] },
    },
  },
};

describe('snapshot loader', () => {
  it('decodes dictionary columns back to the model column names the parsers expect', () => {
    const [item] = rowsOf(snapshot, 'lowStockQueue').map(lowStockQueue().parse);
    expect(item).toEqual({
      storeId: 'P001',
      storeName: 'Caldova Partner Pharmacy 001',
      sku: 'PAIN-003',
      productName: 'Ibuprofen 400 mg',
      daysOfStock: 1.25,
      stockStatus: 'Critical',
      onHandUnits: 3,
      suggestedReorderUnits: 42,
    });
  });

  it('answers salesRate|sku|store from the combined table, without the key columns', () => {
    const rows = rowsOf(snapshot, 'salesRate|PAIN-003|P001');
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0])).not.toContain('Products[sku]');
    expect(salesRate('PAIN-003', 'P001').parse(rows[0]).suggestedUnits).toBe(42);
    expect(rowsOf(snapshot, 'salesRate|PAIN-003|P002')[0]['[DaysOfStock]']).toBe(30);
  });

  it('fails loudly on a key the snapshot does not have', () => {
    expect(() => rowsOf(snapshot, 'demandTrend')).toThrow(/no demandTrend/);
  });
});

const r = (over: Partial<LiveReorder>): LiveReorder => ({
  id: 'x',
  storeId: 'P001',
  sku: 'PAIN-003',
  units: 10,
  requestedBy: 'a@b',
  requestedById: 'u1',
  requestedAt: new Date('2026-10-19T08:00:00Z'),
  status: 'submitted',
  ...over,
});

describe('live reorders', () => {
  it('counts only submitted units as on order, per pharmacy and product', () => {
    const m = unitsOnOrder([r({ units: 10 }), r({ units: 5 }), r({ status: 'fulfilled', units: 99 }), r({ sku: 'X', units: 1 })]);
    expect(m.get('P001:PAIN-003')).toBe(15);
    expect(m.get('P001:X')).toBe(1);
  });

  it('counts "today" in UTC, like the model measure', () => {
    const now = new Date('2026-10-19T00:30:00Z');
    expect(sentToday([r({ requestedAt: new Date('2026-10-19T00:10:00Z') }), r({ requestedAt: new Date('2026-10-18T23:50:00Z') })], now)).toBe(1);
  });

  it('accepts the requested_at as Date or ISO text', () => {
    expect(toLiveReorder({ id: 1, store_id: 'P001', sku: 'S', qty: '4', requested_at: '2026-10-19T08:00:00Z', status: 'fulfilled' })).toMatchObject({
      id: '1',
      units: 4,
      status: 'fulfilled',
    });
  });

  it('reads a naked datetime text as UTC, not local time', () => {
    const naked = toLiveReorder({ id: 1, store_id: 'P', sku: 'S', qty: 1, requested_at: '2026-10-19T23:30:00', status: 'submitted' });
    expect(naked.requestedAt.toISOString()).toBe('2026-10-19T23:30:00.000Z');
  });

  it('refuses to write or reset without an identity (an empty id would match every orphan row)', async () => {
    expect(() => requireIdentity({ id: '', email: 'a@b' })).toThrow(/no user id/);
    expect(() => requireIdentity({ id: 'u1', email: ' ' })).toThrow(/no user id/);
    const del = vi.fn();
    const client = { data: { RestockRequest: { delete: del } } } as unknown as LiveClient;
    await expect(resetMine(client, '', [r({ requestedById: '' })])).rejects.toThrow();
    expect(del).not.toHaveBeenCalled();
  });

  it('resets only the caller own reorders', async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const client = { data: { RestockRequest: { delete: del } } } as unknown as LiveClient;
    const n = await resetMine(client, 'u1', [r({ id: 'a' }), r({ id: 'b', requestedById: 'seed' })]);
    expect(n).toBe(1);
    expect(del).toHaveBeenCalledWith({ id: 'a' });
  });
});

describe('original screens: class merging', () => {
  it('keeps the hero font size next to a colour (twMerge read text-hero-800 as a colour)', async () => {
    const { cn } = await import('../../reorder/lib/utils');
    expect(cn('text-hero-800 font-bold', 'text-critical')).toBe('text-hero-800 font-bold text-critical');
    expect(cn('text-400', 'text-500')).toBe('text-500');
  });
});

describe('reorder design tokens stay inside the reorder screens', () => {
  it('no twin source outside src/reorder uses the original\'s token classes', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    // The tokens are GLOBAL (Tailwind v4 @theme): a twin component writing `bg-primary` would silently
    // turn Caldova navy. Port review: guard it mechanically.
    const TOKEN = /\b(?:bg|text|border|ring)-(?:primary|secondary|muted|muted-foreground|card|card-foreground|critical|warning|success|destructive|foreground|background|border-strong|hover|brand)\b/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          // src/finance uses the same token NAMES with its own values, scoped in finance.css (checked below).
          if (name !== 'reorder' && name !== 'finance' && name !== '__tests__') walk(full);
        } else if (/\.tsx?$/.test(name) && TOKEN.test(readFileSync(full, 'utf8'))) {
          offenders.push(full);
        }
      }
    };
    walk(join(process.cwd(), 'src'));
    expect(offenders).toEqual([]);
  });
});

describe('Finance tab tokens are scoped, never global', () => {
  it('finance.css overrides the shared token names only under [data-tab=finance], with no :root rule', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const raw = readFileSync(join(process.cwd(), 'src', 'finance', 'finance.css'), 'utf8');
    // Comments explain the :root rule of Tailwind; only real rules count.
    let css = '';
    for (let at = 0; at < raw.length; ) {
      const open = raw.indexOf('/*', at);
      if (open < 0) { css += raw.slice(at); break; }
      css += raw.slice(at, open);
      at = raw.indexOf('*/', open + 2) + 2;
    }
    const block = (selector: string) => {
      const at = css.indexOf(`${selector} {`);
      return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
    };
    const theme = block('@theme');
    const scoped = block("[data-tab='finance']");
    // Shared names (primary, card, border …) in an @theme would be set on :root for the whole app.
    for (const shared of ['--color-primary', '--color-card', '--color-border', '--color-background', '--font-base', '--radius-xl']) {
      expect(theme.includes(`${shared}:`), `${shared} in @theme would leak to the whole app`).toBe(false);
      expect(scoped.includes(`${shared}:`), `${shared} missing in the [data-tab='finance'] override`).toBe(true);
    }
    expect(css.includes(':root')).toBe(false);
  });
});
