import { describe, it, expect, afterEach, vi } from 'vitest';
import { initialPlayback, safeLocalStorage, VISITED_KEY } from '../../src/state/intro';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('initialPlayback', () => {
  it('plays the war from the first month on the first visit, then starts at the present', () => {
    const s = mem();
    expect(initialPlayback(s, 46)).toEqual({ t: 0, playing: true, intro: true });
    expect(s.getItem(VISITED_KEY)).toBe('1');
    expect(initialPlayback(s, 46)).toEqual({ t: 46, playing: false, intro: false });
  });
  it('starts at the present when storage is missing or throws', () => {
    expect(initialPlayback(null, 46)).toEqual({ t: 46, playing: false, intro: false });
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => {} };
    expect(initialPlayback(broken, 46)).toEqual({ t: 46, playing: false, intro: false });
  });
});

describe('initialPlayback with a shared link', () => {
  it('starts at the present, paused, and does not mark the visit', () => {
    const s = mem();
    expect(initialPlayback(s, 46, { sharedLink: true })).toEqual({ t: 46, playing: false, intro: false });
    expect(s.getItem(VISITED_KEY)).toBeNull();
    // the person's first plain visit still gets the opening sequence
    expect(initialPlayback(s, 46)).toEqual({ t: 0, playing: true, intro: true });
    expect(s.getItem(VISITED_KEY)).toBe('1');
  });
  it('is the same for a returning visitor and for missing storage', () => {
    const s = mem();
    initialPlayback(s, 46);
    expect(initialPlayback(s, 46, { sharedLink: true })).toEqual({ t: 46, playing: false, intro: false });
    expect(initialPlayback(null, 46, { sharedLink: true })).toEqual({ t: 46, playing: false, intro: false });
    expect(initialPlayback(s, 46, { sharedLink: false })).toEqual({ t: 46, playing: false, intro: false });
  });
  it('never touches storage for a shared link', () => {
    const spy = { getItem: vi.fn(() => null), setItem: vi.fn() };
    initialPlayback(spy, 46, { sharedLink: true });
    expect(spy.getItem).not.toHaveBeenCalled();
    expect(spy.setItem).not.toHaveBeenCalled();
  });
});

describe('safeLocalStorage', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('returns window.localStorage when it is accessible', () => {
    const store = mem();
    vi.stubGlobal('window', { localStorage: store });
    expect(safeLocalStorage()).toBe(store);
  });
  it('returns null when accessing window.localStorage throws (blocked cookies, sandboxed iframe)', () => {
    vi.stubGlobal('window', {
      get localStorage(): never {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    expect(safeLocalStorage()).toBeNull();
  });
  it('returns null when there is no window or no storage object', () => {
    expect(safeLocalStorage()).toBeNull(); // vitest runs in node: no window
    vi.stubGlobal('window', { localStorage: null });
    expect(safeLocalStorage()).toBeNull();
  });
});
