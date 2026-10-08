import { describe, it, expect } from 'vitest';
import { parseWorld } from '../../src/data/load';
import { makeWorld } from '../fixtures/world';

describe('parseWorld', () => {
  it('accepts a well-formed world', () => {
    const w = makeWorld();
    expect(parseWorld(w)).toBe(w);
  });
  it('throws when a series is shorter than months', () => {
    const w = makeWorld();
    w.series.general.gpt = w.series.general.gpt.slice(0, 2);
    expect(() => parseWorld(w)).toThrow('world.json: months/series length mismatch for general.gpt');
  });
  it('throws on a missing front', () => {
    const w = makeWorld() as unknown as { series: Record<string, unknown> };
    delete w.series.music;
    expect(() => parseWorld(w)).toThrow('world.json: missing front music');
  });
  it('throws when there are no months', () => {
    expect(() => parseWorld({})).toThrow('world.json: no months');
  });
});
