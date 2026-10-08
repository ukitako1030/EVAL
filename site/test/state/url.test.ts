import { describe, it, expect } from 'vitest';
import { decodeUrl, encodeUrl } from '../../src/state/url';
import { makeWorld } from '../fixtures/world';

describe('url state', () => {
  const w = makeWorld();
  it('round-trips front, month and language', () => {
    const q = encodeUrl({ front: 'image', t: 2.6, lang: 'en' }, w);
    expect(q).toBe('?front=image&t=2025-03&lang=en');
    expect(decodeUrl(q, w)).toEqual({ front: 'image', t: 2, lang: 'en' });
  });
  it('omits front in galaxy view and ignores unknown values', () => {
    expect(encodeUrl({ front: null, t: 0, lang: 'ja' }, w)).toBe('?t=2025-01&lang=ja');
    expect(decodeUrl('?front=nope&t=1999-01&lang=fr', w)).toEqual({});
  });
  it('encodes a non-finite t as the last month, never "undefined"', () => {
    expect(encodeUrl({ front: null, t: NaN, lang: 'en' }, w)).toBe('?t=2025-04&lang=en');
    expect(encodeUrl({ front: null, t: Infinity, lang: 'en' }, w)).toBe('?t=2025-04&lang=en');
  });
});
