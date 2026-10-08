import { afterEach, describe, it, expect, vi } from 'vitest';
import { DEBUG_KEYS, nextSearch, syncUrl, URL_THROTTLE_MS } from '../../src/state/urlSync';
import { decodeUrl } from '../../src/state/url';
import { createStore, defaultState, type AppState } from '../../src/state/store';
import { makeWorld } from '../fixtures/world';

function setup(search = '', patch: Partial<AppState> = {}, keepDebug = false) {
  const world = makeWorld();
  const store = createStore<AppState>({ ...defaultState(world.months.length - 1), ...patch });
  let url = search;
  const writes: string[] = [];
  const stop = syncUrl(store, world, {
    read: () => url,
    write: (s) => {
      url = s;
      writes.push(s);
    },
    keepDebug,
  });
  return { world, store, writes, stop, url: () => url };
}

afterEach(() => vi.useRealTimers());

describe('nextSearch', () => {
  it('puts the shareable state first, keeps other parameters, drops a stale front', () => {
    const w = makeWorld();
    expect(nextSearch({ front: 'code', t: 2.6, lang: 'en' }, w, '')).toBe('?front=code&t=2025-03&lang=en');
    expect(nextSearch({ front: null, t: 1, lang: 'ja' }, w, '?front=code&t=2025-04&lang=en&utm_source=x')).toBe('?t=2025-02&lang=ja&utm_source=x');
    // round trip
    expect(decodeUrl(nextSearch({ front: 'image', t: 3, lang: 'en' }, w, '?hover=google'), w)).toEqual({ front: 'image', t: 3, lang: 'en' });
  });
  it('drops the debug switches unless asked to keep them (dev builds)', () => {
    const w = makeWorld();
    expect([...DEBUG_KEYS].sort()).toEqual(['debugFlash', 'hover', 'quality']);
    const cur = '?front=code&t=2025-04&lang=en&quality=1&debugFlash&hover=google&x=1';
    expect(nextSearch({ front: null, t: 1, lang: 'ja' }, w, cur)).toBe('?t=2025-02&lang=ja&x=1');
    expect(nextSearch({ front: null, t: 1, lang: 'ja' }, w, cur, { keepDebug: true })).toBe('?t=2025-02&lang=ja&quality=1&debugFlash=&hover=google&x=1');
  });
});

describe('syncUrl', () => {
  it('writes the starting state at once, so a fresh address bar already shows t / front / lang', () => {
    vi.useFakeTimers();
    const { writes } = setup('', { t: 1, front: 'code' });
    expect(writes).toEqual(['?front=code&t=2025-02&lang=ja']);
  });

  it('does not rewrite an address that already says the same', () => {
    vi.useFakeTimers();
    const { writes } = setup('?t=2025-02&lang=ja', { t: 1 });
    expect(writes).toEqual([]);
  });

  it('the starting write drops debug switches in production and keeps them in dev', () => {
    vi.useFakeTimers();
    expect(setup('?quality=2&hover=google', { t: 0 }).writes).toEqual(['?t=2025-01&lang=ja']);
    expect(setup('?quality=2&hover=google', { t: 0 }, true).writes).toEqual(['?t=2025-01&lang=ja&quality=2&hover=google']);
  });

  it('writes on front / whole month / language changes only', () => {
    vi.useFakeTimers();
    const { store, writes } = setup('', { t: 1 });
    expect(writes).toEqual(['?t=2025-02&lang=ja']); // the starting state
    store.set({ t: 1.4, hoverOrg: 'openai', selectedUnit: 'gpt', sortBy: 'scale' }); // same month, other state
    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(1);
    store.set({ front: 'video' });
    vi.advanceTimersByTime(0);
    expect(writes.slice(1)).toEqual(['?front=video&t=2025-02&lang=ja']);
    vi.advanceTimersByTime(1000);
    store.set({ t: 2.1 });
    vi.advanceTimersByTime(0);
    store.set({ front: null });
    vi.advanceTimersByTime(1000);
    store.set({ lang: 'en' });
    vi.advanceTimersByTime(1000);
    expect(writes.slice(1)).toEqual(['?front=video&t=2025-02&lang=ja', '?front=video&t=2025-03&lang=ja', '?t=2025-03&lang=ja', '?t=2025-03&lang=en']);
  });

  it(`writes at most once per ${URL_THROTTLE_MS} ms and always ends on the latest state`, () => {
    vi.useFakeTimers();
    const { store, writes, url } = setup('?quality=2', { t: 0 }, true);
    expect(writes).toHaveLength(1); // the starting state
    expect(URL_THROTTLE_MS).toBeGreaterThanOrEqual(300);
    store.set({ t: 1 });
    vi.advanceTimersByTime(0);
    expect(writes).toHaveLength(2);
    // playback crossing months quickly: 2, 3 within the throttle window
    store.set({ t: 2 });
    vi.advanceTimersByTime(100);
    store.set({ t: 3 });
    vi.advanceTimersByTime(URL_THROTTLE_MS - 101);
    expect(writes).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(writes).toHaveLength(3);
    expect(url()).toBe('?t=2025-04&lang=ja&quality=2');
    vi.advanceTimersByTime(5000);
    expect(writes).toHaveLength(3);
  });

  it('stops when asked', () => {
    vi.useFakeTimers();
    const { store, writes, stop } = setup();
    expect(writes).toHaveLength(1); // the starting state
    store.set({ front: 'code' });
    stop();
    vi.advanceTimersByTime(1000);
    store.set({ front: 'image' });
    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(1);
  });
});
