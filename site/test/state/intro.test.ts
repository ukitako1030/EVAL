import { describe, it, expect } from 'vitest';
import { initialPlayback, VISITED_KEY } from '../../src/state/intro';

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
