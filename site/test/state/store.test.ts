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
  it('defaultState starts at the last month, paused, galaxy view, Japanese, sorted by strength', () => {
    expect(defaultState(46)).toEqual({ t: 46, playing: false, speed: 1, front: null, lang: 'ja', hoverOrg: null, selectedUnit: null, sortBy: 'strength', reducedMotion: false, intro: false });
  });
});
