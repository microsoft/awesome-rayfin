import { beforeEach, describe, expect, it, vi } from 'vitest';

import { connectLiveTraffic, type LiveAircraft, type LiveStatus } from '../ogn';

/**
 * The relay does not know which mountain the browser is showing — PLAN §4.4.
 *
 * ⚠️ **This is tested here rather than against a live relay on purpose.** Pointing a Tegelberg page
 * at an Oberstdorf relay does prove the status wiring, but only if somebody happens to be flying:
 * at night the relay holds zero aircraft and the test passes without ever exercising the thing it
 * exists to check. A stub sends aircraft on demand, so "the traffic was refused" is actually
 * asserted instead of being an accident of the hour.
 */

type Listener = (event: MessageEvent) => void;

class FakeEventSource {
  static last: FakeEventSource | null = null;
  readonly listeners = new Map<string, Listener[]>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }

  addEventListener(type: string, listener: Listener) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  close() {
    this.closed = true;
  }

  /** Deliver a server-sent event, exactly as the relay would. */
  emit(type: string, payload: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(payload) } as MessageEvent);
    }
  }
}

const aircraft = (id: string) => ({
  id,
  type: 'paraglider',
  t: 1_700_000_000,
  lat: 47.42,
  lon: 10.28,
  altM: 2100,
  climbMs: 1.4,
  groundMs: 9,
  trackDeg: 180,
});

describe('live traffic, when the relay is watching a different area', () => {
  beforeEach(() => {
    FakeEventSource.last = null;
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  it('refuses the traffic instead of drawing it on the wrong mountain', () => {
    const statuses: LiveStatus[] = [];
    const traffic: LiveAircraft[][] = [];

    connectLiveTraffic('/ogn/stream', {
      aoiId: 'tegelberg',
      onStatus: (status) => statuses.push(status),
      onTraffic: (list) => traffic.push(list),
    });

    const source = FakeEventSource.last!;
    source.emit('status', { area: { id: 'oberstdorf', name: 'Oberstdorf / Nebelhorn' } });

    // The relay then does exactly what it always does: sends its aircraft.
    source.emit('snapshot', { t: 1, aircraft: [aircraft('a'), aircraft('b')] });
    source.emit('update', { aircraft: [aircraft('c')], removed: [] });

    expect(statuses).toContain('wrong-area');
    expect(statuses).not.toContain('live');

    // Nothing from the wrong area may ever reach the scene.
    expect(traffic.flat()).toHaveLength(0);

    // And the stream is dropped rather than left running and ignored.
    expect(source.closed).toBe(true);
  });

  it('accepts traffic when the relay is watching this area', () => {
    const statuses: LiveStatus[] = [];
    const traffic: LiveAircraft[][] = [];

    connectLiveTraffic('/ogn/stream', {
      aoiId: 'oberstdorf',
      onStatus: (status) => statuses.push(status),
      onTraffic: (list) => traffic.push(list),
    });

    const source = FakeEventSource.last!;
    source.emit('status', { area: { id: 'oberstdorf' } });
    source.emit('snapshot', { t: 1, aircraft: [aircraft('a'), aircraft('b')] });

    expect(statuses).toContain('live');
    expect(statuses).not.toContain('wrong-area');
    expect(traffic.at(-1)).toHaveLength(2);
    expect(source.closed).toBe(false);
  });

  it('trusts a relay that is too old to announce its area', () => {
    const statuses: LiveStatus[] = [];
    const traffic: LiveAircraft[][] = [];

    connectLiveTraffic('/ogn/stream', {
      aoiId: 'tegelberg',
      onStatus: (status) => statuses.push(status),
      onTraffic: (list) => traffic.push(list),
    });

    const source = FakeEventSource.last!;
    source.emit('status', { upstream: 'connected' });
    source.emit('snapshot', { t: 1, aircraft: [aircraft('a')] });

    // Refusing here would break every relay predating the guard, and an absent field is not a
    // claim about the area — unlike a field that names a different one.
    expect(statuses).not.toContain('wrong-area');
    expect(traffic.at(-1)).toHaveLength(1);
  });

  /**
   * The hosted relay serves the WHOLE WORLD — PLAN §8.
   *
   * ⚠️ This guard came within one line of rejecting the only relay that can actually work. A relay
   * has one upstream filter and announces one area, while the browser's active site now CHANGES as
   * the camera flies. Matching on the site id alone would have refused the correct relay at
   * whichever site it was not named after — live traffic silently absent at one of the two, with a
   * panel confidently explaining that the relay was watching somewhere else.
   */
  it('accepts a relay that serves the whole world this site belongs to', () => {
    const statuses: LiveStatus[] = [];
    const traffic: LiveAircraft[][] = [];

    connectLiveTraffic('/ogn/stream', {
      aoiId: 'tegelberg',
      worldId: 'allgaeu',
      onStatus: (status) => statuses.push(status),
      onTraffic: (list) => traffic.push(list),
    });

    const source = FakeEventSource.last!;
    source.emit('status', { area: { id: 'allgaeu', name: 'Allgäuer Alpen' } });
    source.emit('snapshot', { t: 1, aircraft: [aircraft('a'), aircraft('b')] });

    expect(statuses).toContain('live');
    expect(statuses).not.toContain('wrong-area');
    expect(traffic.at(-1)).toHaveLength(2);
    expect(source.closed).toBe(false);
  });

  it('still refuses a different world', () => {
    const statuses: LiveStatus[] = [];
    const traffic: LiveAircraft[][] = [];

    connectLiveTraffic('/ogn/stream', {
      aoiId: 'tegelberg',
      worldId: 'allgaeu',
      onStatus: (status) => statuses.push(status),
      onTraffic: (list) => traffic.push(list),
    });

    const source = FakeEventSource.last!;
    source.emit('status', { area: { id: 'dolomiten' } });
    source.emit('snapshot', { t: 1, aircraft: [aircraft('a')] });

    expect(statuses).toContain('wrong-area');
    expect(traffic.flat()).toHaveLength(0);
  });
});
