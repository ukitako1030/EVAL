import { describe, it, expect } from 'vitest';
import { createBannerQueue, selectEvents } from '../../src/events/queue';
import { makeWorld } from '../fixtures/world';
import type { WorldEvent } from '../../src/data/types';

const ev = (unit: string): WorldEvent => ({ month: '2025-03', front: 'general', unit, type: 'new_model', text: { ja: unit, en: unit } });

describe('selectEvents', () => {
  const w = makeWorld();
  it('galaxy view: everything except surges on non-general fronts; focused view: that front only', () => {
    expect(selectEvents(w, 2, null).map((e) => e.unit)).toEqual(['claude', 'nb']);
    expect(selectEvents(w, 3, null).map((e) => e.type)).toEqual(['surge']); // general-front surge is kept
    expect(selectEvents(w, 2, 'image').map((e) => e.unit)).toEqual(['nb']);
    expect(selectEvents(w, 0, null).map((e) => e.type)).toEqual(['custom']);
  });
});

describe('banner queue', () => {
  it('shows at most maxVisible banners, staggered, then frees slots when they expire', () => {
    const q = createBannerQueue({ maxVisible: 2, seconds: 4, maxPending: 6, stagger: 0.35 });
    q.push([ev('a'), ev('b'), ev('c')]);
    expect(q.update(0).map((b) => b.event.unit)).toEqual(['a']);
    expect(q.update(0.4).map((b) => b.event.unit)).toEqual(['a', 'b']);
    // 'a' ended at 4.0; 'c' is scheduled at max(4.1, 0.35 + 0.35) = 4.1
    expect(q.update(4.1).map((b) => b.event.unit)).toEqual(['b', 'c']);
  });
  it('keeps only the newest maxPending events and can be cleared', () => {
    const q = createBannerQueue({ maxVisible: 1, seconds: 4, maxPending: 2, stagger: 0 });
    q.push([ev('a'), ev('b'), ev('c'), ev('d')]);
    expect(q.update(0).map((b) => b.event.unit)).toEqual(['c']);
    q.clear();
    expect(q.update(10)).toEqual([]);
  });
});
