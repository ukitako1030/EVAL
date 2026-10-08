import { describe, it, expect } from 'vitest';
import { createBannerQueue, holdCounts, holdMonths, selectEvents } from '../../src/events/queue';
import { makeWorld } from '../fixtures/world';
import type { WorldEvent } from '../../src/data/types';

const ev = (unit: string): WorldEvent => ({ month: '2025-03', front: 'general', unit, type: 'new_model', major: false, text: { ja: unit, en: unit } });

describe('selectEvents', () => {
  const w = makeWorld();
  it('galaxy view: major events only; focused view: every event of that front', () => {
    expect(selectEvents(w, 2, null).map((e) => e.unit)).toEqual(['claude']); // the image new_unit is not major
    expect(selectEvents(w, 3, null)).toEqual([]); // the general-front surge is not major
    expect(selectEvents(w, 2, 'image').map((e) => e.unit)).toEqual(['nb']);
    expect(selectEvents(w, 3, 'general').map((e) => e.type)).toEqual(['surge']);
    expect(selectEvents(w, 0, null).map((e) => e.type)).toEqual(['custom']);
    expect(selectEvents(w, 1, null)).toEqual([]);
  });
});

describe('holdCounts', () => {
  const w = makeWorld();
  it('maps each month index to the number of banners selectEvents returns for it', () => {
    expect(holdCounts(w, null)).toEqual(new Map([[0, 1], [2, 1]]));
    expect(holdCounts(w, 'image')).toEqual(new Map([[2, 1]]));
    expect(holdCounts(w, 'general')).toEqual(new Map([[0, 1], [2, 1], [3, 1]]));
    expect(holdCounts(w, 'code').size).toBe(0);
  });
  it('counts every banner of a month', () => {
    const x = makeWorld();
    x.events.push({ ...x.events[1], unit: 'gpt', type: 'new_model' }, { ...x.events[1], unit: 'gemini', type: 'surge' });
    expect(holdCounts(x, null).get(2)).toBe(3);
    expect(holdCounts(x, 'image').get(2)).toBe(1);
  });
  it('agrees with selectEvents for every month and view', () => {
    for (const front of [null, 'general', 'image', 'code'] as const) {
      const counts = holdCounts(w, front);
      w.months.forEach((_, i) => expect(counts.get(i) ?? 0).toBe(selectEvents(w, i, front).length));
    }
  });
  it('ignores events whose month is not on the timeline', () => {
    const x = makeWorld();
    x.events.push({ month: '2030-01', front: 'general', unit: 'gpt', type: 'custom', major: true, text: { ja: '', en: '' } });
    expect(holdCounts(x, null)).toEqual(new Map([[0, 1], [2, 1]]));
  });
});

describe('holdMonths', () => {
  const w = makeWorld();
  it('is the set of month indices that have at least one event selectEvents returns', () => {
    expect([...holdMonths(w, null)].sort((a, b) => a - b)).toEqual([0, 2]);
    expect([...holdMonths(w, 'image')]).toEqual([2]);
    expect([...holdMonths(w, 'general')].sort((a, b) => a - b)).toEqual([0, 2, 3]);
    expect(holdMonths(w, 'code').size).toBe(0);
  });
  it('agrees with selectEvents for every month and view', () => {
    for (const front of [null, 'general', 'image', 'code'] as const) {
      const held = holdMonths(w, front);
      w.months.forEach((_, i) => expect(held.has(i)).toBe(selectEvents(w, i, front).length > 0));
    }
  });
  it('ignores events whose month is not on the timeline', () => {
    const x = makeWorld();
    x.events.push({ month: '2030-01', front: 'general', unit: 'gpt', type: 'custom', major: true, text: { ja: '', en: '' } });
    expect([...holdMonths(x, null)].sort((a, b) => a - b)).toEqual([0, 2]);
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
