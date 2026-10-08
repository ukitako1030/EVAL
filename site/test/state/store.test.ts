import { describe, it, expect, vi } from 'vitest';
import { createStore, defaultState } from '../../src/state/store';

describe('store', () => {
  it('merges patches, notifies with (state, prev) and skips no-op patches', () => {
    const s = createStore(defaultState(10));
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.set({ t: 3 });
    expect(s.get().t).toBe(3);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][1].t).toBe(10);
    s.set({ t: 3 });
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    s.set({ t: 4 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('a throwing subscriber does not stop the others, and the state is still updated', () => {
    const errors: unknown[] = [];
    const s = createStore(defaultState(10), { onError: (e) => errors.push(e) });
    const before = vi.fn();
    const after = vi.fn();
    s.subscribe(before);
    s.subscribe(() => {
      throw new Error('bad subscriber');
    });
    s.subscribe(after);
    expect(() => s.set({ t: 2 })).not.toThrow();
    expect(s.get().t).toBe(2);
    expect(before).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(after.mock.calls[0][0].t).toBe(2);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('bad subscriber');
    // and it keeps working on the next change
    s.set({ t: 3 });
    expect(after).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(2);
  });
  it('by default logs each distinct subscriber error once', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const s = createStore(defaultState(10));
      let n = 0;
      s.subscribe(() => {
        throw new Error(n++ < 2 ? 'same' : 'other');
      });
      s.set({ t: 1 });
      s.set({ t: 2 });
      s.set({ t: 3 });
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
  it('defaultState starts at the last month, paused, galaxy view, Japanese, sorted by strength', () => {
    expect(defaultState(46)).toEqual({ t: 46, playing: false, speed: 1, front: null, lang: 'ja', hoverOrg: null, selectedUnit: null, sortBy: 'strength', reducedMotion: false, intro: false });
  });
});
