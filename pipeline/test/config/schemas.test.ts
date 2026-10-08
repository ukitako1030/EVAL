import { describe, it, expect } from 'vitest';
import { AnnouncementsSchema, MethodSchema, UnitSchema, UnitsFileSchema } from '../../src/config/schemas';

describe('AnnouncementsSchema', () => {
  const ann = (url: string) => ({ series: { chatgpt: { metric: 'WAU', points: [{ date: '2023-11-06', value: 1, url }] } } });
  it('accepts http(s) urls', () => {
    expect(AnnouncementsSchema.safeParse(ann('https://example.com/a')).success).toBe(true);
    expect(AnnouncementsSchema.safeParse(ann('http://example.com/a')).success).toBe(true);
  });
  it('rejects non-http(s) urls', () => {
    expect(AnnouncementsSchema.safeParse(ann('javascript:alert(1)')).success).toBe(false);
    expect(AnnouncementsSchema.safeParse(ann('ftp://example.com/a')).success).toBe(false);
  });
});

describe('UnitSchema', () => {
  const unit = (extra: Record<string, unknown>) => ({ org: 'x', name: 'X', since: '2023-05', ...extra });
  it('accepts until >= since', () => {
    expect(UnitSchema.safeParse(unit({ until: '2023-05' })).success).toBe(true);
    expect(UnitSchema.safeParse(unit({ until: '2024-01' })).success).toBe(true);
    expect(UnitSchema.safeParse(unit({})).success).toBe(true);
  });
  it('rejects until < since', () => {
    expect(UnitSchema.safeParse(unit({ until: '2023-04' })).success).toBe(false);
  });
});

describe('UnitsFileSchema', () => {
  const file = (extra: Record<string, unknown>) => ({ orgs: {}, fronts: {}, ...extra });
  it('defaults exclude to an empty list and accepts a list of regex strings', () => {
    expect(UnitsFileSchema.parse(file({})).exclude).toEqual([]);
    expect(UnitsFileSchema.parse(file({ exclude: ['nemotron', ' \\+ '] })).exclude).toEqual(['nemotron', ' \\+ ']);
  });
  it('rejects an exclude that is not a list of strings', () => {
    expect(UnitsFileSchema.safeParse(file({ exclude: 'nemotron' })).success).toBe(false);
    expect(UnitsFileSchema.safeParse(file({ exclude: [1] })).success).toBe(false);
  });
});

describe('MethodSchema', () => {
  const method = (percent: { clampLo: number; clampHi: number }) => ({
    start: '2022-11',
    strength: {
      minUnits: 2,
      snapshotMaxAgeDays: 92,
      releaseActiveMonths: 3,
      kinds: { elo: { scale: 400 }, percent, minutes: { kappa: 1 }, eci: { tau: 8 } },
      estimate: { floor: 60, step: 6 },
      weights: { general: { 'arena-text': 0.5 } },
    },
    scale: {
      smoothingMonths: 3,
      announcementStaleMonths: 6,
      metricFactors: { MAU: 1, WAU: 1.4, DAU: 2.5 },
      floorFactor: 0.5,
      components: { users: { weight: 0.45, signals: ['announcements'] } },
      base: ['users'],
    },
    events: { newModelMinDelta: 3, surgeStrength: 5, surgeScale: 5, leadHysteresis: 1, maxPerFrontMonth: 3 },
  });
  it('accepts 0 < clampLo < clampHi < 100', () => {
    expect(MethodSchema.safeParse(method({ clampLo: 0.5, clampHi: 99.5 })).success).toBe(true);
  });
  it.each([
    ['clampLo = 0', { clampLo: 0, clampHi: 99.5 }],
    ['clampLo negative', { clampLo: -1, clampHi: 99.5 }],
    ['clampHi = 100', { clampLo: 0.5, clampHi: 100 }],
    ['clampHi > 100', { clampLo: 0.5, clampHi: 120 }],
    ['clampLo = clampHi', { clampLo: 50, clampHi: 50 }],
    ['clampLo > clampHi', { clampLo: 90, clampHi: 10 }],
  ])('rejects percent clamp with %s', (_label, percent) => {
    expect(MethodSchema.safeParse(method(percent)).success).toBe(false);
  });
});
