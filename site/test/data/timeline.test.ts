import { describe, it, expect } from 'vitest';
import { frontFrame, orgDeployment, monthLabel, clampT, FOG } from '../../src/data/timeline';
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
  it('fades a unit in as it arrives (presence 0→1, c scaled from 0)', () => {
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
});

describe('monthLabel', () => {
  it('formats the current whole month as YYYY.MM', () => {
    const w = makeWorld();
    expect(monthLabel(w, 0)).toBe('2025.01');
    expect(monthLabel(w, 1.99)).toBe('2025.02');
    expect(monthLabel(w, 3)).toBe('2025.04');
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
