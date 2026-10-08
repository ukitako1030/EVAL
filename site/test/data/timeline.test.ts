import { describe, it, expect } from 'vitest';
import { frontFrame, orgDeployment, orgDeploymentFrom, allFrames, createFrameSource, monthLabel, clampT, FOG } from '../../src/data/timeline';
import { makeWorld } from '../fixtures/world';

describe('frontFrame', () => {
  const w = makeWorld();
  it('returns integer-month values sorted by strength with 1-based ranks', () => {
    const f = frontFrame(w, 'general', 0);
    expect(f.map((u) => [u.id, u.s, u.rank])).toEqual([['gpt', 100, 1], ['claude', 80, 2]]);
    expect(f[0]).toMatchObject({ org: 'openai', name: 'GPT', color: '#19c37d', c: 70, q: 'high', fog: 0, presence: 1 });
  });
  it('interpolates s and c between months; q switches at the midpoint', () => {
    const f = frontFrame(w, 'general', 0.5);
    const claude = f.find((u) => u.id === 'claude')!;
    expect(claude.s).toBeCloseTo(85, 10);
    expect(claude.q).toBe('medium');
    const g = frontFrame(w, 'general', 2.75).find((u) => u.id === 'gemini')!;
    expect(g.s).toBeCloseTo(81.25, 10);
    expect(g.q).toBe('reconstructed');
  });
  it('fades a unit in as it arrives (presence 0→1; s and c keep their full values)', () => {
    const g = frontFrame(w, 'general', 1.25).find((u) => u.id === 'gemini')!;
    expect(g.presence).toBeCloseTo(0.25, 10);
    expect(g.c).toBe(12);
    expect(frontFrame(w, 'general', 1).find((u) => u.id === 'gemini')).toBeUndefined();
  });
  it('rankDelta compares with the previous whole month (positive = moved up)', () => {
    const f = frontFrame(w, 'general', 2);
    expect(f.map((u) => [u.id, u.rank, u.rankDelta])).toEqual([['claude', 1, 1], ['gpt', 2, -1], ['gemini', 3, 0]]);
  });
  it('can sort by scale', () => {
    expect(frontFrame(w, 'general', 2, 'scale').map((u) => u.id)).toEqual(['gpt', 'claude', 'gemini']);
  });
  it('maps confidence to fog density', () => {
    expect(FOG).toEqual({ high: 0, medium: 0.25, reconstructed: 0.5, estimated: 0.8 });
    expect(frontFrame(w, 'general', 2).find((u) => u.id === 'gemini')!.fog).toBe(0.8);
  });
  it('clamps t to the month range', () => {
    expect(clampT(w, -3)).toBe(0);
    expect(clampT(w, 99)).toBe(3);
    expect(frontFrame(w, 'general', 99).map((u) => u.id)).toEqual(['claude', 'gpt', 'gemini']);
  });
  it('treats a non-finite t as the last month (never NaN)', () => {
    for (const t of [NaN, Infinity, -Infinity]) expect(clampT(w, t)).toBe(3);
    expect(frontFrame(w, 'general', NaN)).toEqual(frontFrame(w, 'general', 3));
    expect(frontFrame(w, 'general', NaN).every((u) => Number.isFinite(u.s) && Number.isFinite(u.c))).toBe(true);
  });
});

describe('frontFrame interpolation polish', () => {
  const w = makeWorld();
  it('fogBlend interpolates between the two months while q and fog switch at the midpoint', () => {
    const at = (t: number) => frontFrame(w, 'general', t).find((u) => u.id === 'gemini')!;
    // gemini: estimated (0.8) at month 2 → reconstructed (0.5) at month 3
    expect(at(2).fogBlend).toBeCloseTo(0.8, 10);
    expect(at(2.25)).toMatchObject({ q: 'estimated', fog: 0.8 });
    expect(at(2.25).fogBlend).toBeCloseTo(0.725, 10);
    expect(at(2.5).fogBlend).toBeCloseTo(0.65, 10);
    expect(at(2.75)).toMatchObject({ q: 'reconstructed', fog: 0.5 });
    expect(at(2.75).fogBlend).toBeCloseTo(0.575, 10);
    expect(at(3).fogBlend).toBeCloseTo(0.5, 10);
  });
  it('fogBlend is the unit\'s own fog while it arrives (no neighbour to blend with)', () => {
    expect(frontFrame(w, 'general', 1.5).find((u) => u.id === 'gemini')!.fogBlend).toBe(0.8);
  });
  it('clamps the interpolation fraction to >= 0 just below a whole month', () => {
    const t = 2 - 5e-10; // floor(t + 1e-9) is 2, so t - 2 is slightly negative
    const gpt = frontFrame(w, 'general', t).find((u) => u.id === 'gpt')!;
    expect(gpt.s).toBe(90);
    expect(gpt.c).toBe(60);
    expect(gpt.presence).toBe(1);
  });
  it('keeps presence within [0, 1] for a leaving unit', () => {
    const x = makeWorld();
    x.series.general.gemini[3] = null; // gemini leaves after month 2
    const g = frontFrame(x, 'general', 2 - 5e-10).find((u) => u.id === 'gemini')!;
    expect(g.presence).toBe(1);
    expect(frontFrame(x, 'general', 2.25).find((u) => u.id === 'gemini')!.presence).toBeCloseTo(0.75, 10);
    expect(frontFrame(x, 'general', 3).find((u) => u.id === 'gemini')).toBeUndefined();
  });
  it('an almost invisible arriving unit does not rank at full strength (rank uses s × presence)', () => {
    const x = makeWorld();
    x.series.general.gemini[2] = { s: 101, c: 90, q: 'high', qs: 'high', qc: 'high' };
    const f = frontFrame(x, 'general', 1.25); // gemini arrives at presence 0.25; gpt ≈ 97.5, claude ≈ 92.5
    const g = f.find((u) => u.id === 'gemini')!;
    expect(g).toMatchObject({ s: 101, c: 90, presence: 0.25 }); // displayed values are not scaled
    expect(f.map((u) => u.id)).toEqual(['gpt', 'claude', 'gemini']);
    expect(f.map((u) => u.rank)).toEqual([1, 2, 3]);
    // fully present, the same values do rank first
    expect(frontFrame(x, 'general', 2).map((u) => u.id)).toEqual(['gemini', 'claude', 'gpt']);
  });
  it('an almost invisible leaving unit does not rank at full strength, and scale ranking uses c × presence', () => {
    const x = makeWorld();
    x.series.general.gemini[2] = { s: 99, c: 90, q: 'high', qs: 'high', qc: 'high' };
    x.series.general.gemini[3] = null;
    const bySt = frontFrame(x, 'general', 2.75); // presence 0.25: 99 × 0.25 < gpt ≈ 91.5
    expect(bySt.map((u) => u.id)).toEqual(['claude', 'gpt', 'gemini']);
    const byC = frontFrame(x, 'general', 2.75, 'scale'); // gpt c ≈ 58.5, claude ≈ 28: gemini 90 × 0.25 = 22.5 is last
    expect(byC.map((u) => u.id)).toEqual(['gpt', 'claude', 'gemini']);
  });
});

describe('monthLabel', () => {
  it('formats the current whole month as YYYY.MM', () => {
    const w = makeWorld();
    expect(monthLabel(w, 0)).toBe('2025.01');
    expect(monthLabel(w, 1.99)).toBe('2025.02');
    expect(monthLabel(w, 3)).toBe('2025.04');
  });
  it('never sees NaN: a non-finite t labels the last month', () => {
    const w = makeWorld();
    expect(monthLabel(w, NaN)).toBe('2025.04');
    expect(monthLabel(w, Infinity)).toBe('2025.04');
  });
});

describe('orgDeployment', () => {
  it('lists each org with the fronts it is present on, widest first', () => {
    const d = orgDeployment(makeWorld(), 3);
    expect(d[0]).toMatchObject({ org: 'google', fronts: ['general', 'image'] });
    expect(d[0].totalShare).toBeCloseTo(115, 10);
    expect(d.map((x) => x.org)).toEqual(['google', 'openai', 'anthropic']);
  });
});

describe('deterministic ordering', () => {
  const tied = () => {
    const w = makeWorld();
    const flat = { s: 50, c: 40, q: 'high', qs: 'high', qc: 'high' } as const;
    w.orgs.a = { name: 'a-org', color: '#111111' };
    w.orgs.B = { name: 'B-org', color: '#222222' };
    w.orgs.Z = { name: 'Z-org', color: '#333333' };
    w.units.code = { a: { org: 'a', name: 'a', since: '2025-01' }, B: { org: 'B', name: 'B', since: '2025-01' }, Z: { org: 'Z', name: 'Z', since: '2025-01' } };
    w.series.code = Object.fromEntries(['a', 'B', 'Z'].map((id) => [id, [flat, flat, flat, flat]]));
    return w;
  };
  it('breaks ties by code-unit order (uppercase before lowercase), independent of locale', () => {
    const f = frontFrame(tied(), 'code', 1);
    expect(f.map((u) => [u.id, u.rank])).toEqual([['B', 1], ['Z', 2], ['a', 3]]);
    expect(frontFrame(tied(), 'code', 1, 'scale').map((u) => u.id)).toEqual(['B', 'Z', 'a']);
  });
  it('orders orgs with equal reach and share the same way', () => {
    // 'a-org' etc. only exist on the code front, one front each, equal share
    expect(orgDeployment(tied(), 1).filter((d) => ['a', 'B', 'Z'].includes(d.org)).map((d) => d.org)).toEqual(['B', 'Z', 'a']);
  });
});

describe('shared frames', () => {
  it('allFrames holds every front; orgDeploymentFrom matches orgDeployment in either sort order', () => {
    const w = makeWorld();
    for (const t of [0, 1.5, 3]) {
      const fs = allFrames(w, t, 'scale');
      expect(Object.keys(fs).sort()).toEqual(w.fronts.map((f) => f.id).sort());
      expect(fs.general).toEqual(frontFrame(w, 'general', t, 'scale'));
      expect(orgDeploymentFrom(w, fs)).toEqual(orgDeployment(w, t));
    }
  });
  it('createFrameSource computes once per (t, sortBy)', () => {
    const w = makeWorld();
    const src = createFrameSource(w);
    const a = src(1.25, 'strength');
    expect(src(1.25, 'strength')).toBe(a);
    const b = src(1.5, 'strength');
    expect(b).not.toBe(a);
    expect(b.general).toEqual(frontFrame(w, 'general', 1.5, 'strength'));
    const c = src(1.5, 'scale');
    expect(c).not.toBe(b);
    expect(c.general).toEqual(frontFrame(w, 'general', 1.5, 'scale'));
  });
});
